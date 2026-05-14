"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Discussion = {
  id: string;
  body: string;
  chapter_label: string | null;
  has_spoilers: boolean;
  created_at: string;
  author_id: string;
  profiles?: { display_name: string | null } | null;
};

type FinishedBook = {
  id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  page_count: number | null;
  start_date: string | null;
  end_date: string | null;
  takeaways: string | null;
  discussions: Discussion[];
};

export default function BookHistory({
  books,
  currentUserId
}: {
  books: FinishedBook[];
  currentUserId: string;
}) {
  if (books.length === 0) {
    return (
      <div className="card">
        <p className="muted">
          No finished books yet. When you switch to a new book, the previous
          one will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {books.map((b) => (
        <FinishedBookCard key={b.id} book={b} currentUserId={currentUserId} />
      ))}
    </div>
  );
}

function FinishedBookCard({
  book,
  currentUserId
}: {
  book: FinishedBook;
  currentUserId: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [takeaways, setTakeaways] = useState(book.takeaways ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [showDiscussions, setShowDiscussions] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  async function saveTakeaways() {
    if ((book.takeaways ?? "") === takeaways) return;
    setSaveState("saving");
    const { error } = await supabase
      .from("books")
      .update({ takeaways: takeaways.trim() ? takeaways : null })
      .eq("id", book.id);
    if (error) {
      setSaveState("error");
      return;
    }
    setSaveState("saved");
    book.takeaways = takeaways; // mirror so we don't double-save
    setTimeout(() => setSaveState("idle"), 1500);
    router.refresh();
  }

  const dateRange =
    book.start_date && book.end_date
      ? `${book.start_date} → ${book.end_date}`
      : book.end_date
        ? `Finished ${book.end_date}`
        : book.start_date
          ? `Started ${book.start_date}`
          : null;

  return (
    <div className="card space-y-3">
      <div className="flex gap-4">
        {book.cover_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={book.cover_url}
            alt={book.title}
            className="h-24 rounded shadow-sm shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-serif text-lg leading-tight">{book.title}</div>
          {book.author && <div className="muted text-sm">by {book.author}</div>}
          <div className="muted text-xs mt-1 flex flex-wrap gap-x-3">
            {dateRange && <span>{dateRange}</span>}
            {book.page_count && <span>{book.page_count} pages</span>}
            <span>
              {book.discussions.length} comment
              {book.discussions.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Takeaways</label>
          <span className="text-xs muted">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && "Saved ✓"}
            {saveState === "error" && (
              <span className="text-red-600">Save failed</span>
            )}
          </span>
        </div>
        <textarea
          className="input min-h-[80px] text-sm"
          placeholder="What stuck with the group? Big ideas, favorite passages, questions worth carrying forward…"
          value={takeaways}
          onChange={(e) => setTakeaways(e.target.value)}
          onBlur={saveTakeaways}
        />
      </div>

      {book.discussions.length > 0 && (
        <div>
          <button
            type="button"
            className="text-sm muted hover:text-ink"
            onClick={() => setShowDiscussions((v) => !v)}
          >
            {showDiscussions ? "Hide" : "Show"} discussion ({book.discussions.length})
          </button>
          {showDiscussions && (
            <ul className="mt-2 space-y-3">
              {book.discussions.map((d) => {
                const author = d.profiles?.display_name ?? "Member";
                const r = revealed[d.id];
                return (
                  <li
                    key={d.id}
                    className="border-t border-black/10 pt-2 text-sm"
                  >
                    <div className="flex justify-between">
                      <div>
                        <strong>{author}</strong>
                        {d.chapter_label && (
                          <span className="muted text-xs ml-2">
                            {d.chapter_label}
                          </span>
                        )}
                      </div>
                      <span className="muted text-xs">
                        {new Date(d.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">
                      {d.has_spoilers ? (
                        <span
                          className={`spoiler ${r ? "revealed" : ""}`}
                          onClick={() =>
                            setRevealed((s) => ({ ...s, [d.id]: !s[d.id] }))
                          }
                          title={r ? "Hide" : "Click to reveal spoiler"}
                        >
                          {r ? d.body : "[spoiler — click to reveal]"}
                        </span>
                      ) : (
                        d.body
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
