"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getCachedBook, putCachedBook } from "@/lib/offline/bookCache";
import {
  enqueueProgress,
  flushQueue,
  queueSize
} from "@/lib/offline/progressQueue";

type Theme = "day" | "night" | "sepia";

const THEMES: Record<Theme, { bg: string; color: string; label: string }> = {
  day: { bg: "#ffffff", color: "#1a1a1a", label: "Day" },
  sepia: { bg: "#f4ecd8", color: "#3a2f1d", label: "Sepia" },
  night: { bg: "#111111", color: "#dddddd", label: "Night" }
};

export default function EpubReader({
  bookId,
  bookTitle,
  pageCount,
  epubPath,
  initialLocation,
  currentUserId,
  onClose
}: {
  bookId: string;
  bookTitle: string;
  pageCount: number | null;
  epubPath: string;
  initialLocation: string | null;
  currentUserId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<any>(null);
  const renditionRef = useRef<any>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<{ cfi: string | null; pct: number | null }>({
    cfi: null,
    pct: null
  });
  // Holds the most recent (cfi, pct) seen so we can flush them on close even
  // if the debounced save hasn't fired yet.
  const pendingRef = useRef<{ cfi: string; pct: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pct, setPct] = useState<number>(0);
  const [chapterLabel, setChapterLabel] = useState<string>("");
  const [toc, setToc] = useState<Array<{ label: string; href: string; level: number }>>([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [currentHref, setCurrentHref] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [pendingSync, setPendingSync] = useState<number>(0);
  // Chrome = the top/bottom UI bars. Kindle/Apple-Books style: tap center to
  // toggle, default visible so first-time readers see the close button.
  const [chromeVisible, setChromeVisible] = useState<boolean>(true);
  // Portals need access to document.body, so wait until mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "day";
    return (localStorage.getItem("bookclub_reader_theme") as Theme) || "day";
  });
  const [fontSize, setFontSize] = useState<number>(() => {
    if (typeof window === "undefined") return 110;
    return Number(localStorage.getItem("bookclub_reader_fontsize")) || 110;
  });

  // Persist theme/fontsize choice
  useEffect(() => {
    localStorage.setItem("bookclub_reader_theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("bookclub_reader_fontsize", String(fontSize));
  }, [fontSize]);

  // Lock background scroll while reader is open. On iOS Safari, just setting
  // `overflow: hidden` doesn't prevent the page underneath from showing
  // through the address bar / rubber-banding. The position:fixed-with-top
  // trick is the standard iOS-safe scroll lock — and we restore the
  // scroll position on close so the user lands back where they were.
  useEffect(() => {
    const scrollY = window.scrollY;
    const prev = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
      overflow: document.body.style.overflow
    };
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    return () => {
      Object.assign(document.body.style, prev);
      window.scrollTo(0, scrollY);
    };
  }, []);

  // Write progress to Supabase. If offline or the request fails, enqueue
  // locally so we can flush on reconnect. Always returns once the row is
  // either persisted or safely queued — callers can await on close.
  async function writeProgress(cfi: string, percentage: number) {
    if (
      lastSavedRef.current.cfi === cfi &&
      lastSavedRef.current.pct === percentage
    )
      return;
    lastSavedRef.current = { cfi, pct: percentage };
    pendingRef.current = null;
    const computedPage = pageCount
      ? Math.round((percentage / 100) * pageCount)
      : null;
    const pct2 = Number(percentage.toFixed(2));

    const tryRemote = async () => {
      const { error } = await supabase.from("reading_progress").upsert(
        {
          user_id: currentUserId,
          book_id: bookId,
          progress_pct: pct2,
          last_location: cfi,
          current_page: computedPage ?? undefined,
          updated_at: new Date().toISOString()
        },
        { onConflict: "user_id,book_id" }
      );
      return !error;
    };

    let ok = false;
    if (typeof navigator !== "undefined" && navigator.onLine !== false) {
      try {
        ok = await tryRemote();
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      await enqueueProgress({
        user_id: currentUserId,
        book_id: bookId,
        progress_pct: pct2,
        last_location: cfi,
        current_page: computedPage
      });
      try {
        setPendingSync(await queueSize());
      } catch {}
      return;
    }
    // Successful write — opportunistically drain any prior queued rows.
    try {
      const { remaining } = await flushQueue(supabase);
      setPendingSync(remaining);
    } catch {}
  }

  // Save progress (debounced).
  function scheduleSave(cfi: string, percentage: number) {
    pendingRef.current = { cfi, pct: percentage };
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      writeProgress(cfi, percentage);
    }, 1500);
  }

  // Cancel any pending debounced save and write the latest location now.
  // Called on Close so quick exits don't lose progress.
  async function flushSave() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending) {
      await writeProgress(pending.cfi, pending.pct);
    }
  }

  // Load EPUB and wire up the reader.
  useEffect(() => {
    let cancelled = false;
    let book: any = null;
    let rendition: any = null;

    async function load() {
      setLoading(true);
      setError(null);

      // 1. Try the offline cache first — lets users reopen books with no network.
      let buf: ArrayBuffer | null = null;
      try {
        buf = await getCachedBook(epubPath);
      } catch {}

      // 2. Cache miss → fetch via signed URL and write back to the cache.
      if (!buf) {
        const { data: signed, error: sErr } = await supabase.storage
          .from("book-files")
          .createSignedUrl(epubPath, 3600);
        if (sErr || !signed?.signedUrl) {
          if (!cancelled) {
            setError(
              navigator.onLine === false
                ? "You're offline and this book isn't cached yet."
                : sErr?.message ?? "Could not load EPUB."
            );
            setLoading(false);
          }
          return;
        }
        try {
          const res = await fetch(signed.signedUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          buf = await res.arrayBuffer();
        } catch (e: any) {
          if (!cancelled) {
            setError(e?.message ?? "Network error fetching EPUB.");
            setLoading(false);
          }
          return;
        }
        // Persist for next time — fire-and-forget.
        if (buf) putCachedBook(epubPath, buf);
      }
      if (cancelled || !buf) return;

      // 3. Init epub.js — dynamic import keeps it out of the server bundle.
      const ePub = (await import("epubjs")).default;
      book = ePub(buf);
      bookRef.current = book;

      if (!containerRef.current) return;

      rendition = book.renderTo(containerRef.current, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: "auto",
        allowScriptedContent: false
      });
      renditionRef.current = rendition;

      // Apply themes. A taller line-height plus comfortable paragraph
      // margins make the rendered text feel less cramped — and more
      // importantly give epub.js's column-based pagination room to break
      // cleanly, so the last visible line doesn't get half-clipped at the
      // bottom of the page.
      Object.entries(THEMES).forEach(([name, t]) => {
        rendition.themes.register(name, {
          body: {
            background: t.bg,
            color: t.color,
            "line-height": "1.55"
          },
          a: { color: t.color },
          "p, span, div, li": { color: t.color },
          p: {
            "margin-top": "0.7em",
            "margin-bottom": "0.7em"
          }
        });
      });
      rendition.themes.select(theme);
      rendition.themes.fontSize(`${fontSize}%`);

      // Display from saved location if any.
      try {
        await rendition.display(initialLocation || undefined);
      } catch {
        await rendition.display();
      }

      // Track the most recent CFI separately so we can recompute % once
      // locations finish generating (generation is async; first relocated
      // events fire before % is computable from the location index).
      let currentCfi: string | null = null;
      let locationsReady = false;

      function pctFromCfi(cfi: string | null): number {
        if (!cfi) return 0;
        // Prefer the locations index (accurate, char-based) when ready.
        if (locationsReady) {
          try {
            const v = book.locations.percentageFromCfi(cfi);
            if (typeof v === "number" && !Number.isNaN(v)) {
              return Math.max(0, Math.min(100, v * 100));
            }
          } catch {}
        }
        // Fallback before locations are ready: estimate from spine position.
        try {
          const spine: any = book.spine;
          const items: any[] = (spine as any).items ?? (spine as any).spineItems ?? [];
          if (items.length > 0) {
            const item = book.spine.get(cfi);
            if (item && typeof item.index === "number") {
              return (item.index / items.length) * 100;
            }
          }
        } catch {}
        return 0;
      }

      rendition.on("relocated", (location: any) => {
        const cfi = location?.start?.cfi;
        if (!cfi) return;
        currentCfi = cfi;
        const percentage = pctFromCfi(cfi);
        setPct(percentage);
        if (locationsReady) {
          try {
            const idx = book.locations.locationFromCfi(cfi);
            if (typeof idx === "number") setCurrentPage(idx + 1);
          } catch {}
        }
        scheduleSave(cfi, percentage);
      });

      // Chapter label + TOC from nav
      try {
        const nav = await book.loaded.navigation;
        // Flatten nested TOC, preserving depth for indentation.
        const flat: Array<{ label: string; href: string; level: number }> = [];
        const walk = (items: any[], level: number) => {
          for (const it of items || []) {
            if (it?.label && it?.href) {
              flat.push({ label: it.label.trim(), href: it.href, level });
            }
            if (it?.subitems?.length) walk(it.subitems, level + 1);
          }
        };
        walk(nav.toc, 0);
        if (!cancelled) setToc(flat);

        rendition.on("relocated", (location: any) => {
          const href = location?.start?.href;
          if (!href) return;
          const base = href.split("#")[0];
          const item =
            flat.find((t) => t.href.split("#")[0] === base) ??
            flat.find((t) => href.includes(t.href.split("#")[0])) ??
            null;
          if (item) {
            setChapterLabel(item.label);
            setCurrentHref(item.href);
          }
        });
      } catch {}

      // Keyboard navigation
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setTocOpen((open) => {
            if (open) return false;
            return open;
          });
        }
        if (e.key === "ArrowRight" || e.key === "PageDown") rendition.next();
        if (e.key === "ArrowLeft" || e.key === "PageUp") rendition.prev();
      };
      window.addEventListener("keydown", onKey);

      // Swipe-to-turn gestures. epub.js renders each spine item into an
      // iframe, so touch events fire on the iframe's document and never
      // bubble to the parent. Register a content hook to attach handlers to
      // every rendered iframe.
      const SWIPE_MIN_PX = 50;
      const SWIPE_RATIO = 1.5; // dx must dominate dy to count as horizontal
      const SWIPE_MAX_MS = 600;
      function attachSwipe(target: EventTarget) {
        let startX = 0;
        let startY = 0;
        let startT = 0;
        let tracking = false;
        const onStart = (ev: Event) => {
          const e = ev as TouchEvent;
          if (e.touches.length !== 1) {
            tracking = false;
            return;
          }
          const t = e.touches[0];
          startX = t.clientX;
          startY = t.clientY;
          startT = Date.now();
          tracking = true;
        };
        const onEnd = (ev: Event) => {
          if (!tracking) return;
          tracking = false;
          const e = ev as TouchEvent;
          const t = e.changedTouches[0];
          if (!t) return;
          const dx = t.clientX - startX;
          const dy = t.clientY - startY;
          const dt = Date.now() - startT;
          if (dt > SWIPE_MAX_MS) return;
          if (Math.abs(dx) < SWIPE_MIN_PX) return;
          if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
          if (dx < 0) rendition.next();
          else rendition.prev();
        };
        target.addEventListener("touchstart", onStart, { passive: true } as any);
        target.addEventListener("touchend", onEnd, { passive: true } as any);
        target.addEventListener("touchcancel", () => {
          tracking = false;
        }, { passive: true } as any);
      }
      rendition.hooks.content.register((contents: any) => {
        try {
          attachSwipe(contents.document);
        } catch {}
      });
      // Also handle swipes that start in the page margins outside the iframe.
      if (containerRef.current) attachSwipe(containerRef.current);

      // Resize / orientation handling. epub.js's paginated flow needs an
      // explicit resize when the container's dimensions change; without it,
      // rotating to landscape and back leaves the rendition with stale
      // pagination and broken layout. Debounced via rAF so a flurry of
      // resize events from rotation only triggers one re-layout.
      let resizeRaf: number | null = null;
      const onResize = () => {
        if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          const el = containerRef.current;
          if (!el || !renditionRef.current) return;
          try {
            renditionRef.current.resize(el.clientWidth, el.clientHeight);
          } catch {}
          // Re-display at the last known CFI so we don't end up on the wrong
          // page after the relayout.
          if (currentCfi) {
            try {
              renditionRef.current.display(currentCfi);
            } catch {}
          }
        });
      };
      window.addEventListener("resize", onResize);
      window.addEventListener("orientationchange", onResize);

      // Compute the locations index for accurate percentage tracking. This
      // can take a few seconds on big books; once it's done, recompute and
      // emit the current page's % so the progress bar updates immediately.
      try {
        await book.locations.generate(1600);
        if (cancelled) return;
        locationsReady = true;
        const total = book.locations.length();
        if (typeof total === "number" && total > 0) setTotalPages(total);
        if (currentCfi) {
          const percentage = pctFromCfi(currentCfi);
          setPct(percentage);
          try {
            const idx = book.locations.locationFromCfi(currentCfi);
            if (typeof idx === "number") setCurrentPage(idx + 1);
          } catch {}
          scheduleSave(currentCfi, percentage);
        }
      } catch {}

      // Forward keypresses from inside the iframe (epub.js renders in iframes)
      rendition.on("keyup", onKey);

      if (!cancelled) setLoading(false);

      // Cleanup
      (rendition as any)._cleanup = () => {
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("orientationchange", onResize);
        if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
      };
    }

    load();

    return () => {
      cancelled = true;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      try {
        (rendition as any)?._cleanup?.();
        rendition?.destroy?.();
        book?.destroy?.();
      } catch {}
      bookRef.current = null;
      renditionRef.current = null;
    };
    // We deliberately don't depend on theme/fontSize — they're applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epubPath]);

  // Apply theme changes without reloading the book
  useEffect(() => {
    renditionRef.current?.themes?.select(theme);
  }, [theme]);
  useEffect(() => {
    renditionRef.current?.themes?.fontSize(`${fontSize}%`);
  }, [fontSize]);

  // When the chrome toggles, the page surface grows or shrinks. epub.js
  // doesn't auto-relayout on container size changes, so trigger a resize
  // after the chrome transition settles.
  useEffect(() => {
    const r = renditionRef.current;
    const el = containerRef.current;
    if (!r || !el) return;
    const t = setTimeout(() => {
      try {
        r.resize(el.clientWidth, el.clientHeight);
      } catch {}
    }, 200);
    return () => clearTimeout(t);
  }, [chromeVisible]);

  const [closing, setClosing] = useState(false);
  async function close() {
    if (closing) return;
    setClosing(true);
    // Persist the latest location before unmounting; otherwise quick exits
    // lose the page the user was on.
    try {
      await flushSave();
    } catch {}
    router.refresh();
    onClose();
  }

  // Track online status and drain queued progress writes on reconnect.
  useEffect(() => {
    let cancelled = false;
    queueSize()
      .then((n) => {
        if (!cancelled) setPendingSync(n);
      })
      .catch(() => {});

    async function drain() {
      try {
        const { remaining } = await flushQueue(supabase);
        if (!cancelled) setPendingSync(remaining);
      } catch {}
    }
    if (typeof navigator !== "undefined" && navigator.onLine) drain();

    function onOnline() {
      setIsOnline(true);
      drain();
    }
    function onOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush on tab hide / pagehide too — covers users who background the app
  // or close the tab without hitting the Close button.
  useEffect(() => {
    function onHide() {
      const pending = pendingRef.current;
      if (!pending) return;
      // Fire-and-forget; the page may be unloading.
      writeProgress(pending.cfi, pending.pct);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") onHide();
    });
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const t = THEMES[theme];

  // max() gives the dynamic island / notch some breathing room when the
  // browser doesn't expose a safe-area inset (e.g. older iOS, desktop).
  const PAD_TOP = "max(env(safe-area-inset-top, 0px), 14px)";
  const PAD_BOTTOM = "max(env(safe-area-inset-bottom, 0px), 8px)";

  if (!mounted) return null;

  const ui = (
    <div
      className="flex flex-col"
      style={{
        // Hard-pin to the viewport so no parent stacking context, transform,
        // or scroll position can let the underlying page peek through.
        position: "fixed",
        inset: 0,
        zIndex: 2147483000,
        background: t.bg,
        color: t.color,
        // 100dvh accounts for the iOS URL-bar collapse without leaving a
        // gap behind the home indicator.
        height: "100dvh",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
        // Top/bottom padding lives on the inner bars so the reading surface
        // can still extend edge-to-edge when chrome is hidden.
        overscrollBehavior: "contain",
        touchAction: "manipulation"
      }}
    >
      <header
        className="flex items-center justify-between gap-2 px-3 border-b transition-[opacity,transform] duration-200"
        style={{
          borderColor: theme === "night" ? "#333" : "rgba(0,0,0,0.1)",
          paddingTop: `calc(${PAD_TOP} + 6px)`,
          paddingBottom: "8px",
          opacity: chromeVisible ? 1 : 0,
          transform: chromeVisible ? "translateY(0)" : "translateY(-100%)",
          pointerEvents: chromeVisible ? "auto" : "none",
          background: t.bg,
          // Hover the header above the reading area so its hide animation
          // doesn't push the page surface around mid-read.
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          zIndex: 2
        }}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate flex items-center gap-2">
            <span className="truncate">{bookTitle}</span>
            {!isOnline && (
              <span
                className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border opacity-80"
                style={{ borderColor: "currentColor" }}
                title="You're offline — progress will sync when you reconnect."
              >
                ● Offline
              </span>
            )}
            {isOnline && pendingSync > 0 && (
              <span
                className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border opacity-80"
                style={{ borderColor: "currentColor" }}
                title={`${pendingSync} progress update${pendingSync === 1 ? "" : "s"} syncing…`}
              >
                Syncing {pendingSync}…
              </span>
            )}
          </div>
          {chapterLabel && (
            <div className="text-xs opacity-70 truncate">{chapterLabel}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-sm">
          <button
            className="px-2 py-1 rounded border"
            style={{ borderColor: "currentColor" }}
            onClick={() => setTocOpen(true)}
            title="Contents"
            disabled={toc.length === 0}
          >
            ☰
          </button>
          <button
            className="px-2 py-1 rounded border"
            style={{ borderColor: "currentColor" }}
            onClick={() => setFontSize((v) => Math.max(80, v - 10))}
            title="Smaller text"
          >
            A−
          </button>
          <button
            className="px-2 py-1 rounded border"
            style={{ borderColor: "currentColor" }}
            onClick={() => setFontSize((v) => Math.min(200, v + 10))}
            title="Larger text"
          >
            A+
          </button>
          <select
            className="px-2 py-1 rounded border bg-transparent"
            style={{ borderColor: "currentColor", color: "currentColor" }}
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
          >
            {(Object.keys(THEMES) as Theme[]).map((name) => (
              <option key={name} value={name} style={{ color: "#000" }}>
                {THEMES[name].label}
              </option>
            ))}
          </select>
          <button
            className="px-3 py-1 rounded border"
            style={{ borderColor: "currentColor" }}
            onClick={close}
            disabled={closing}
          >
            {closing ? "…" : "Done"}
          </button>
        </div>
      </header>

      <main className="relative flex-1 overflow-hidden min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm opacity-70">
            Loading…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm">
            <div className="space-y-2 text-center">
              <div className="text-red-600">{error}</div>
              <button
                className="px-3 py-1 rounded border"
                style={{ borderColor: "currentColor" }}
                onClick={close}
              >
                Close
              </button>
            </div>
          </div>
        )}
        {/*
          Page surface. The header and footer are absolutely-positioned
          overlays, so the reading container must reserve room beneath
          them — otherwise the first/last line of text sits behind the
          chrome bars and gets clipped. We carve out ~64px top / ~52px
          bottom when chrome is visible, and just enough room for the
          dynamic island when it's hidden. The container resizes via
          rendition.resize() on chrome toggle so epub.js re-paginates
          against the new height.
        */}
        <div
          ref={containerRef}
          className="absolute"
          style={{
            top: chromeVisible
              ? `calc(${PAD_TOP} + 64px)`
              : `calc(${PAD_TOP} + 20px)`,
            bottom: chromeVisible
              ? `calc(${PAD_BOTTOM} + 52px)`
              : `calc(${PAD_BOTTOM} + 20px)`,
            left: 14,
            right: 14,
            transition: "top 200ms ease, bottom 200ms ease"
          }}
        />

        {/*
          Invisible tap/swipe overlay covering the reading surface. Only
          swipes turn pages — page-turn-by-tap was removed because brushing
          the edges with a thumb mid-scroll was too easy to do by accident.
          Any tap toggles the top/bottom chrome.
        */}
        <TapSwipeLayer
          onSwipeLeft={() => renditionRef.current?.next()}
          onSwipeRight={() => renditionRef.current?.prev()}
          onTap={() => setChromeVisible((v) => !v)}
        />
      </main>

      <footer
        className="px-3 border-t flex items-center gap-3 text-xs shrink-0 transition-[opacity,transform] duration-200"
        style={{
          borderColor: theme === "night" ? "#333" : "rgba(0,0,0,0.1)",
          paddingTop: "8px",
          paddingBottom: `calc(${PAD_BOTTOM} + 6px)`,
          opacity: chromeVisible ? 1 : 0,
          transform: chromeVisible ? "translateY(0)" : "translateY(100%)",
          pointerEvents: chromeVisible ? "auto" : "none",
          background: t.bg,
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 2
        }}
      >
        <div
          className="flex-1 h-1.5 rounded overflow-hidden"
          style={{
            background: theme === "night" ? "#333" : "rgba(0,0,0,0.1)"
          }}
        >
          <div
            className="h-full"
            style={{
              width: `${Math.max(0, Math.min(100, pct))}%`,
              background: theme === "night" ? "#dddddd" : "#1a1a1a",
              transition: "width 200ms"
            }}
          />
        </div>
        <span className="tabular-nums opacity-80">
          {totalPages
            ? `Page ${currentPage ?? "—"} of ${totalPages} • ${pct.toFixed(1)}%`
            : `${pct.toFixed(1)}% • Calculating pages…`}
        </span>
      </footer>

      {tocOpen && (
        <div
          className="fixed inset-0 flex"
          style={{ zIndex: 2147483001 }}
          onClick={() => setTocOpen(false)}
        >
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.4)" }}
          />
          <aside
            className="relative w-80 max-w-[85vw] h-full overflow-y-auto shadow-xl"
            style={{
              background: t.bg,
              color: t.color,
              paddingTop: PAD_TOP,
              paddingBottom: PAD_BOTTOM
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="sticky flex items-center justify-between px-3 py-2 border-b"
              style={{
                top: 0,
                background: t.bg,
                borderColor: theme === "night" ? "#333" : "rgba(0,0,0,0.1)"
              }}
            >
              <div className="text-sm font-medium">Contents</div>
              <button
                className="px-2 py-1 rounded border text-sm"
                style={{ borderColor: "currentColor" }}
                onClick={() => setTocOpen(false)}
              >
                Close
              </button>
            </div>
            {toc.length === 0 ? (
              <div className="px-3 py-4 text-sm opacity-70">
                No chapters found.
              </div>
            ) : (
              <ul className="py-2">
                {toc.map((item, i) => {
                  const isCurrent =
                    currentHref &&
                    item.href.split("#")[0] === currentHref.split("#")[0];
                  return (
                    <li key={`${item.href}-${i}`}>
                      <button
                        className="w-full text-left px-3 py-2 text-sm hover:opacity-80"
                        style={{
                          paddingLeft: `${12 + item.level * 16}px`,
                          background: isCurrent
                            ? theme === "night"
                              ? "rgba(255,255,255,0.08)"
                              : "rgba(0,0,0,0.06)"
                            : "transparent",
                          fontWeight: isCurrent ? 600 : 400
                        }}
                        onClick={async () => {
                          try {
                            await renditionRef.current?.display(item.href);
                          } catch {}
                          setTocOpen(false);
                        }}
                      >
                        {item.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  );

  // Portal to body so the reader cannot inherit a parent stacking context,
  // transform, or filter — any of which would make `position: fixed`
  // resolve to that ancestor and let the underlying app header bleed
  // through.
  return createPortal(ui, document.body);
}

function TapSwipeLayer({
  onSwipeLeft,
  onSwipeRight,
  onTap
}: {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onTap: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let sx = 0;
    let sy = 0;
    let st = 0;
    let tracking = false;
    const SWIPE_MIN = 50;
    const SWIPE_RATIO = 1.5;
    const SWIPE_MAX_MS = 600;
    const TAP_MAX_MS = 350;
    const TAP_MAX_MOVE = 10;

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      const t = e.touches[0];
      sx = t.clientX;
      sy = t.clientY;
      st = Date.now();
      tracking = true;
    };
    const end = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      const dt = Date.now() - st;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);

      // Swipe: dominant horizontal motion within a short window.
      if (
        dt <= SWIPE_MAX_MS &&
        adx >= SWIPE_MIN &&
        adx >= ady * SWIPE_RATIO
      ) {
        if (dx < 0) onSwipeLeft();
        else onSwipeRight();
        return;
      }
      // Tap: minimal movement, short duration. Toggles chrome only —
      // page turns are reserved for swipes so the edges aren't a trap.
      if (dt <= TAP_MAX_MS && adx <= TAP_MAX_MOVE && ady <= TAP_MAX_MOVE) {
        onTap();
      }
    };
    const cancel = () => {
      tracking = false;
    };
    // Mouse clicks for desktop just toggle chrome too. Page turns on
    // desktop come from keyboard arrows (handled inside the rendition).
    const click = () => onTap();

    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchend", end, { passive: true });
    el.addEventListener("touchcancel", cancel, { passive: true });
    el.addEventListener("click", click);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", cancel);
      el.removeEventListener("click", click);
    };
  }, [onSwipeLeft, onSwipeRight, onTap]);

  return (
    <div
      ref={ref}
      className="absolute inset-0"
      style={{
        // Sits above the iframe; transparent so the page shows through.
        zIndex: 1,
        background: "transparent",
        touchAction: "pan-y",
        cursor: "pointer",
        userSelect: "none"
      }}
    />
  );
}
