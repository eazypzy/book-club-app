"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import EpubReader from "./EpubReader";
import { parseEpubMetadata } from "@/lib/epub-metadata";
import {
  getCachedBook,
  putCachedBook,
  removeCachedBook
} from "@/lib/offline/bookCache";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — mirrors EpubManager & storage bucket cap.

type EpubMetaSafe = {
  title: string | null;
  author: string | null;
  pageCount: number | null;
  coverDataUrl: string | null;
};

type LibraryBook = {
  id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  page_count: number | null;
  status: string;
  epub_path: string | null;
  epub_size_bytes: number | null;
  epub_uploaded_at: string | null;
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function LibraryView({
  clubId,
  currentUserId,
  books,
  myProgress
}: {
  clubId: string;
  currentUserId: string;
  books: LibraryBook[];
  myProgress: Record<
    string,
    { last_location: string | null; progress_pct: number | null }
  >;
}) {
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<LibraryBook | null>(null);
  // Which epub_paths are present in the on-device IndexedDB cache. Drives the
  // "Available offline" badge so users know which books they can open on a
  // plane.
  const [offlinePaths, setOfflinePaths] = useState<Set<string>>(new Set());

  // Probe the cache once on mount and again whenever the book list changes
  // (uploads / deletes). Best-effort — IDB can be unavailable in private mode.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      const next = new Set<string>();
      for (const b of books) {
        if (!b.epub_path) continue;
        try {
          const bytes = await getCachedBook(b.epub_path);
          if (bytes) next.add(b.epub_path);
        } catch {}
      }
      if (!cancelled) setOfflinePaths(next);
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [books]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setError(null);

    if (!file.name.toLowerCase().endsWith(".epub")) {
      setError("Pick a .epub file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`File is ${formatBytes(file.size)}; max is 50 MB.`);
      return;
    }

    setBusy(true);
    try {
      // Read the file once and reuse the buffer for upload, offline cache,
      // and metadata parsing. File.arrayBuffer() can be slow on phones, no
      // sense doing it twice.
      setStatus("Reading file…");
      const buf = await file.arrayBuffer();

      // Kick off metadata parsing in the background with a hard timeout —
      // book.locations.generate() can take 30s+ on a big book, and we don't
      // want the upload blocked on it. If it stalls, we fall back to using
      // the filename as the title.
      const fallbackTitle =
        file.name.replace(/\.epub$/i, "").trim() || "Untitled";
      const metaPromise: Promise<EpubMetaSafe> = Promise.race([
        parseEpubMetadata(buf).then((m) => ({
          title: m.title,
          author: m.author,
          pageCount: m.pageCount,
          coverDataUrl: m.coverDataUrl
        })),
        new Promise<EpubMetaSafe>((resolve) =>
          setTimeout(
            () =>
              resolve({
                title: null,
                author: null,
                pageCount: null,
                coverDataUrl: null
              }),
            8000
          )
        )
      ]).catch(
        (): EpubMetaSafe => ({
          title: null,
          author: null,
          pageCount: null,
          coverDataUrl: null
        })
      );

      // 1. Insert a book row right away so we have an id to key the upload
      //    against. Use the filename as title; we'll patch in real metadata
      //    once parsing finishes.
      setStatus("Adding to library…");
      const { data: inserted, error: insertErr } = await supabase
        .from("books")
        .insert({
          club_id: clubId,
          title: fallbackTitle,
          status: "library",
          start_date: new Date().toISOString().slice(0, 10)
        })
        .select("id")
        .single();
      if (insertErr || !inserted) {
        throw new Error(
          insertErr?.message ?? "Could not create book row."
        );
      }
      const newBookId: string = inserted.id;

      // 2. Upload to Supabase Storage. This is the critical step — if it
      //    fails we roll back the book row so we don't leave an orphan.
      setStatus("Uploading…");
      const path = `${clubId}/${newBookId}.epub`;
      const { error: upErr } = await supabase.storage
        .from("book-files")
        .upload(path, buf, {
          upsert: true,
          contentType: "application/epub+zip"
        });
      if (upErr) {
        await supabase.from("books").delete().eq("id", newBookId);
        throw new Error(upErr.message);
      }

      // 3. Link the file path and merge in any metadata we managed to parse
      //    (or null fields if parsing timed out).
      setStatus("Finalising…");
      const { data: userData } = await supabase.auth.getUser();
      const meta = await metaPromise;
      const patch: Record<string, any> = {
        epub_path: path,
        epub_size_bytes: file.size,
        epub_uploaded_by: userData.user?.id ?? null,
        epub_uploaded_at: new Date().toISOString()
      };
      if (meta.title?.trim()) patch.title = meta.title.trim();
      if (meta.author) patch.author = meta.author;
      if (meta.coverDataUrl) patch.cover_url = meta.coverDataUrl;
      if (meta.pageCount) patch.page_count = meta.pageCount;
      const { error: linkErr } = await supabase
        .from("books")
        .update(patch)
        .eq("id", newBookId);
      if (linkErr) throw new Error(linkErr.message);

      // 4. Stash the bytes in IndexedDB for airplane-mode reading.
      try {
        await putCachedBook(path, buf);
      } catch {}

      setStatus(null);
      router.refresh();
    } catch (err: any) {
      const msg =
        err?.message ||
        err?.error_description ||
        (typeof err === "string" ? err : null) ||
        "Upload failed.";
      setError(msg);
      setStatus(null);
      // Surface the full error in the console too — handy for diagnosing
      // RLS / storage errors that have terse messages.
      // eslint-disable-next-line no-console
      console.error("Library upload failed:", err);
    } finally {
      setBusy(false);
    }
  }

  async function startReading(book: LibraryBook) {
    if (book.status === "current") return;
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("books")
      .update({
        status: "current",
        start_date:
          book.status === "library" || !book.status
            ? new Date().toISOString().slice(0, 10)
            : undefined
      })
      .eq("id", book.id);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  async function pauseReading(book: LibraryBook) {
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("books")
      .update({ status: "library" })
      .eq("id", book.id);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  async function downloadForOffline(book: LibraryBook) {
    if (!book.epub_path) return;
    setBusy(true);
    setError(null);
    try {
      const { data: signed, error: sErr } = await supabase.storage
        .from("book-files")
        .createSignedUrl(book.epub_path, 3600);
      if (sErr || !signed?.signedUrl) {
        throw new Error(sErr?.message ?? "Could not fetch download link.");
      }
      const res = await fetch(signed.signedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      await putCachedBook(book.epub_path, buf);
      setOfflinePaths((prev) => {
        const next = new Set(prev);
        next.add(book.epub_path!);
        return next;
      });
    } catch (e: any) {
      setError(e?.message ?? "Could not save for offline.");
    } finally {
      setBusy(false);
    }
  }

  async function removeOfflineCopy(book: LibraryBook) {
    if (!book.epub_path) return;
    try {
      await removeCachedBook(book.epub_path);
      setOfflinePaths((prev) => {
        const next = new Set(prev);
        next.delete(book.epub_path!);
        return next;
      });
    } catch (e: any) {
      setError(e?.message ?? "Could not clear offline copy.");
    }
  }

  async function deleteBook(book: LibraryBook) {
    if (
      !confirm(
        `Delete "${book.title}" from the library? This removes the EPUB file and the book row for everyone in the club.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      if (book.epub_path) {
        const { error: rmErr } = await supabase.storage
          .from("book-files")
          .remove([book.epub_path]);
        if (rmErr) throw new Error(rmErr.message);
        try {
          await removeCachedBook(book.epub_path);
        } catch {}
      }
      const { error: dbErr } = await supabase
        .from("books")
        .delete()
        .eq("id", book.id);
      if (dbErr) throw new Error(dbErr.message);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h2 className="h2">Your library</h2>
            <p className="muted text-sm">
              Upload EPUBs here, then start reading one. Files are saved on
              your device so you can read in airplane mode.
            </p>
          </div>
          <label
            className={`btn-primary cursor-pointer ${
              busy ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            {status ?? "Upload EPUB"}
            <input
              ref={fileRef}
              type="file"
              accept=".epub,application/epub+zip"
              className="hidden"
              onChange={onPickFile}
              disabled={busy}
            />
          </label>
        </div>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <div className="muted text-xs">
          50 MB max per file • Supabase free tier gives 1 GB total — use Delete
          to free space.
        </div>
      </section>

      {books.length === 0 ? (
        <section className="card">
          <p className="muted">
            No books yet. Upload your first EPUB to get started.
          </p>
        </section>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3">
          {books.map((book) => {
            const isCurrent = book.status === "current";
            const cached =
              book.epub_path != null && offlinePaths.has(book.epub_path);
            const pct = myProgress[book.id]?.progress_pct ?? null;
            return (
              <li key={book.id} className="card space-y-3">
                <div className="flex gap-3">
                  {book.cover_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={book.cover_url}
                      alt={book.title}
                      className="h-28 rounded shadow-sm shrink-0"
                    />
                  ) : (
                    <div className="h-28 w-20 rounded shadow-sm shrink-0 bg-black/5 flex items-center justify-center text-xs muted">
                      No cover
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-serif text-base truncate">
                      {book.title}
                    </div>
                    {book.author && (
                      <div className="muted text-sm truncate">
                        by {book.author}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {isCurrent && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-accent text-accent">
                          Reading now
                        </span>
                      )}
                      {cached ? (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded border border-green-700 text-green-700"
                          title="Saved on this device — works in airplane mode."
                        >
                          ● Offline
                        </span>
                      ) : (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded border opacity-60"
                          title="Not yet downloaded to this device."
                        >
                          ○ Online only
                        </span>
                      )}
                    </div>
                    <div className="muted text-xs pt-1">
                      {book.page_count ? `${book.page_count} pages` : null}
                      {book.epub_size_bytes != null
                        ? `${book.page_count ? " • " : ""}${formatBytes(
                            book.epub_size_bytes
                          )}`
                        : null}
                    </div>
                    {pct != null && (
                      <div className="muted text-xs">
                        {pct.toFixed(1)}% read
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {isCurrent ? (
                    <button
                      className="btn-ghost text-sm"
                      onClick={() => pauseReading(book)}
                      disabled={busy}
                      title="Move back to library without finishing"
                    >
                      Pause
                    </button>
                  ) : (
                    <button
                      className="btn-primary text-sm"
                      onClick={() => startReading(book)}
                      disabled={busy}
                    >
                      Start reading
                    </button>
                  )}
                  <button
                    className="btn-ghost text-sm"
                    onClick={() => setReading(book)}
                    disabled={busy || !book.epub_path}
                  >
                    Read
                  </button>
                  {cached ? (
                    <button
                      className="text-xs muted hover:text-ink"
                      onClick={() => removeOfflineCopy(book)}
                      disabled={busy}
                      title="Remove the on-device copy. The book stays in your library."
                    >
                      Clear offline
                    </button>
                  ) : (
                    <button
                      className="text-xs muted hover:text-ink"
                      onClick={() => downloadForOffline(book)}
                      disabled={busy}
                      title="Save to this device so it works in airplane mode."
                    >
                      Save offline
                    </button>
                  )}
                  <button
                    className="text-xs text-red-600 hover:underline ml-auto"
                    onClick={() => deleteBook(book)}
                    disabled={busy}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {reading && reading.epub_path && (
        <EpubReader
          bookId={reading.id}
          bookTitle={reading.title}
          pageCount={reading.page_count}
          epubPath={reading.epub_path}
          initialLocation={myProgress[reading.id]?.last_location ?? null}
          currentUserId={currentUserId}
          onClose={() => setReading(null)}
        />
      )}
    </div>
  );
}
