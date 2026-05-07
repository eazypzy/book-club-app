"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function Discussions({
  clubId,
  bookId,
  currentUserId,
  initial
}: {
  clubId: string;
  bookId: string;
  currentUserId: string;
  initial: any[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [body, setBody] = useState("");
  const [chapter, setChapter] = useState("");
  const [spoiler, setSpoiler] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState(initial);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("discussions")
      .insert({
        club_id: clubId,
        book_id: bookId,
        author_id: currentUserId,
        chapter_label: chapter || null,
        body: body.trim(),
        has_spoilers: spoiler
      })
      .select("*, profiles(display_name)")
      .single();
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    setItems([data, ...items]);
    setBody("");
    setChapter("");
    setSpoiler(false);
    router.refresh();
  }

  async function del(id: string) {
    if (!confirm("Delete this comment?")) return;
    await supabase.from("discussions").delete().eq("id", id);
    setItems(items.filter((i) => i.id !== id));
    router.refresh();
  }

  return (
    <div className="card space-y-3">
      <h2 className="h2">Discussion</h2>
      <form onSubmit={post} className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <input
            className="input col-span-1"
            placeholder="Ch / pages (optional)"
            value={chapter}
            onChange={(e) => setChapter(e.target.value)}
          />
          <label className="flex items-center gap-2 col-span-2 text-sm">
            <input
              type="checkbox"
              checked={spoiler}
              onChange={(e) => setSpoiler(e.target.checked)}
            />
            Mark as spoiler
          </label>
        </div>
        <textarea
          className="input min-h-[70px]"
          placeholder="Share a thought..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button className="btn-primary" disabled={busy}>
          {busy ? "Posting..." : "Post"}
        </button>
      </form>

      <ul className="space-y-3">
        {items.length === 0 && (
          <p className="muted text-sm">No comments yet.</p>
        )}
        {items.map((d) => {
          const author = d.profiles?.display_name ?? "Member";
          const isOwn = d.author_id === currentUserId;
          const r = revealed[d.id];
          return (
            <li key={d.id} className="border-t border-black/10 pt-2 text-sm">
              <div className="flex justify-between">
                <div>
                  <strong>{author}</strong>
                  {d.chapter_label && (
                    <span className="muted text-xs ml-2">{d.chapter_label}</span>
                  )}
                </div>
                <span className="muted text-xs">
                  {new Date(d.created_at).toLocaleString()}
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
              {isOwn && (
                <button
                  className="text-xs text-red-600 hover:underline mt-1"
                  onClick={() => del(d.id)}
                >
                  Delete
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
