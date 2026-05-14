"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

  // Lock background scroll while reader is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Write progress to Supabase (always returns the promise so the caller can
  // await it on close).
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
    await supabase.from("reading_progress").upsert(
      {
        user_id: currentUserId,
        book_id: bookId,
        progress_pct: Number(percentage.toFixed(2)),
        last_location: cfi,
        // Keep current_page in sync so the leaderboard works for both
        // manual-entry users and reader users.
        current_page: computedPage ?? undefined,
        updated_at: new Date().toISOString()
      },
      { onConflict: "user_id,book_id" }
    );
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

      // 1. Get a signed URL we can fetch from.
      const { data: signed, error: sErr } = await supabase.storage
        .from("book-files")
        .createSignedUrl(epubPath, 3600);
      if (sErr || !signed?.signedUrl) {
        if (!cancelled) {
          setError(sErr?.message ?? "Could not load EPUB.");
          setLoading(false);
        }
        return;
      }

      // 2. Fetch into an ArrayBuffer (epub.js handles ArrayBuffers reliably).
      let buf: ArrayBuffer;
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
      if (cancelled) return;

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

      // Apply themes
      Object.entries(THEMES).forEach(([name, t]) => {
        rendition.themes.register(name, {
          body: { background: t.bg, color: t.color },
          a: { color: t.color },
          "p, span, div, li": { color: t.color }
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

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background: t.bg,
        color: t.color,
        // Use dynamic viewport height so Safari's address bar collapse doesn't
        // hide the footer behind the home indicator.
        height: "100dvh",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)"
      }}
    >
      <header
        className="flex items-center justify-between gap-2 px-3 py-2 border-b flex-wrap sm:flex-nowrap"
        style={{ borderColor: theme === "night" ? "#333" : "rgba(0,0,0,0.1)" }}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{bookTitle}</div>
          {chapterLabel && (
            <div className="text-xs opacity-70 truncate">{chapterLabel}</div>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            className="px-2 py-1 rounded border"
            style={{ borderColor: "currentColor" }}
            onClick={() => setTocOpen(true)}
            title="Contents"
            disabled={toc.length === 0}
          >
            ☰ Contents
          </button>
          <button
            className="px-2 py-1 rounded border"
            style={{ borderColor: "currentColor" }}
            onClick={() => setFontSize((v) => Math.max(80, v - 10))}
            title="Smaller"
          >
            A−
          </button>
          <button
            className="px-2 py-1 rounded border"
            style={{ borderColor: "currentColor" }}
            onClick={() => setFontSize((v) => Math.min(200, v + 10))}
            title="Larger"
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
            {closing ? "Saving…" : "Close"}
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
        {/* Page surface — inset slightly so text doesn't get clipped by rounded
            phone corners and so the iOS edge-swipe zone doesn't eat taps. */}
        <div ref={containerRef} className="absolute inset-x-3 inset-y-2" />
        <button
          aria-label="Previous page"
          onClick={() => renditionRef.current?.prev()}
          className="absolute left-0 top-0 bottom-0 w-10 flex items-center justify-center text-2xl opacity-40 active:opacity-100 hover:opacity-100 transition-opacity touch-manipulation"
          style={{ color: "currentColor" }}
        >
          ‹
        </button>
        <button
          aria-label="Next page"
          onClick={() => renditionRef.current?.next()}
          className="absolute right-0 top-0 bottom-0 w-10 flex items-center justify-center text-2xl opacity-40 active:opacity-100 hover:opacity-100 transition-opacity touch-manipulation"
          style={{ color: "currentColor" }}
        >
          ›
        </button>
      </main>

      <footer
        className="px-3 py-2 border-t flex items-center gap-3 text-xs shrink-0"
        style={{ borderColor: theme === "night" ? "#333" : "rgba(0,0,0,0.1)" }}
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
          className="fixed inset-0 z-[60] flex"
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
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "env(safe-area-inset-bottom)"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="sticky top-0 flex items-center justify-between px-3 py-2 border-b"
              style={{
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
}
