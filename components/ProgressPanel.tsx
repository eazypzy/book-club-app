"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ProgressPanel({
  book,
  members,
  progress,
  currentUserId
}: {
  book: any;
  members: any[];
  progress: any[];
  currentUserId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const myProgress = useMemo(
    () => progress.find((p: any) => p.user_id === currentUserId),
    [progress, currentUserId]
  );
  const [page, setPage] = useState<string>(
    myProgress?.current_page?.toString() ?? ""
  );
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const n = Math.max(0, Math.min(book.page_count ?? 99999, Number(page) || 0));
    await supabase.from("reading_progress").upsert(
      {
        user_id: currentUserId,
        book_id: book.id,
        current_page: n,
        updated_at: new Date().toISOString()
      },
      { onConflict: "user_id,book_id" }
    );
    setBusy(false);
    router.refresh();
  }

  // Build a leaderboard.
  const rows = members
    .map((m: any) => {
      const p = progress.find((p: any) => p.user_id === m.user_id);
      return {
        userId: m.user_id,
        name: m.profiles?.display_name ?? m.profiles?.email ?? "Member",
        page: p?.current_page ?? 0,
        updated: p?.updated_at ?? null
      };
    })
    .sort((a, b) => b.page - a.page);

  const total = book.page_count ?? 0;

  return (
    <div className="card space-y-3">
      <h2 className="h2">Reading progress</h2>
      <form onSubmit={save} className="flex items-end gap-2">
        <div className="flex-1">
          <label className="label">My current page</label>
          <input
            type="number"
            min={0}
            max={total || undefined}
            className="input"
            value={page}
            onChange={(e) => setPage(e.target.value)}
            placeholder="0"
          />
        </div>
        <button className="btn-primary" disabled={busy}>
          {busy ? "..." : "Update"}
        </button>
      </form>
      <ul className="space-y-1 text-sm">
        {rows.map((r) => {
          const pct = total ? Math.min(100, Math.round((r.page / total) * 100)) : 0;
          return (
            <li key={r.userId}>
              <div className="flex justify-between">
                <span>{r.name}</span>
                <span className="muted">
                  p.{r.page}
                  {total ? ` / ${total} (${pct}%)` : ""}
                </span>
              </div>
              <div className="h-1.5 bg-black/10 rounded overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
