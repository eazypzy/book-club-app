"use client";

import { useEffect, useState } from "react";

export type OpenLibraryBook = {
  olid: string;
  title: string;
  author: string;
  pageCount: number | null;
  coverUrl: string | null;
};

export default function BookSearchModal({
  onClose,
  onPick,
  busy
}: {
  onClose: () => void;
  onPick: (b: OpenLibraryBook) => void | Promise<void>;
  busy?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<OpenLibraryBook[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualPages, setManualPages] = useState<Record<string, string>>({});

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=12`
      );
      if (!res.ok) throw new Error(`Open Library returned ${res.status}`);
      const data = await res.json();
      const docs: any[] = data.docs ?? [];
      const mapped: OpenLibraryBook[] = docs.map((d) => ({
        olid: d.key, // e.g. "/works/OL12345W"
        title: d.title,
        author: (d.author_name?.[0] ?? "").toString(),
        pageCount: d.number_of_pages_median ?? null,
        coverUrl: d.cover_i
          ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`
          : null
      }));
      setResults(mapped);
    } catch (err: any) {
      setError(err.message ?? "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-black/10">
          <form onSubmit={search} className="flex gap-2">
            <input
              autoFocus
              className="input"
              placeholder="Search Open Library by title or author..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="btn-primary" disabled={loading}>
              {loading ? "..." : "Search"}
            </button>
            <button type="button" className="btn-ghost" onClick={onClose}>
              Close
            </button>
          </form>
          {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        </div>
        <div className="p-4 overflow-auto flex-1">
          {results.length === 0 ? (
            <p className="muted text-sm">Try a search above.</p>
          ) : (
            <ul className="space-y-3">
              {results.map((b) => {
                const needsPages = b.pageCount == null;
                const manual = manualPages[b.olid] ?? "";
                const finalPages = b.pageCount ?? (manual ? Number(manual) : null);
                return (
                  <li
                    key={b.olid}
                    className="flex gap-3 border-b border-black/10 pb-3"
                  >
                    {b.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={b.coverUrl}
                        alt={b.title}
                        className="h-20 rounded shadow-sm"
                      />
                    ) : (
                      <div className="h-20 w-14 bg-black/10 rounded" />
                    )}
                    <div className="flex-1">
                      <div className="font-medium">{b.title}</div>
                      {b.author && (
                        <div className="muted text-sm">by {b.author}</div>
                      )}
                      {b.pageCount ? (
                        <div className="muted text-xs">{b.pageCount} pages</div>
                      ) : (
                        <div className="flex items-center gap-2 mt-1">
                          <input
                            className="input w-28"
                            placeholder="Pages"
                            type="number"
                            min={1}
                            value={manual}
                            onChange={(e) =>
                              setManualPages((m) => ({ ...m, [b.olid]: e.target.value }))
                            }
                          />
                          <span className="muted text-xs">no page count from API</span>
                        </div>
                      )}
                    </div>
                    <button
                      className="btn-primary self-start"
                      disabled={busy || (needsPages && !finalPages)}
                      onClick={() =>
                        onPick({
                          ...b,
                          pageCount: finalPages
                        })
                      }
                    >
                      Pick
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
