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

  const total = book.page_count ?? 0;

  // Build a leaderboard. progress_pct (set by the in-app reader) wins over
  // current_page (set by the manual form) when present.
  const rows = members
    .map((m: any) => {
      const p = progress.find((p: any) => p.user_id === m.user_id);
      const pct =
        p?.progress_pct != null
          ? Number(p.progress_pct)
          : total && p?.current_page
          ? Math.min(100, (p.current_page / total) * 100)
          : 0;
      const page =
        p?.current_page ??
        (total && p?.progress_pct != null
          ? Math.round((Number(p.progress_pct) / 100) * total)
          : 0);
      return {
        userId: m.user_id,
        name: m.profiles?.display_name ?? m.profiles?.email ?? "Member",
        page,
        pct,
        viaReader: p?.progress_pct != null,
        updated: p?.updated_at ?? null
      };
    })
    .sort((a, b) => b.pct - a.pct);

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
      <p className="muted text-xs">
        Or open the book with <strong>Read</strong> above and your progress
        updates automatically.
      </p>
      <ul className="space-y-1 text-sm">
        {rows.map((r) => {
          const pctRounded = Math.round(r.pct);
          return (
            <li key={r.userId}>
              <div className="flex justify-between">
                <span>{r.name}</span>
                <span className="muted">
                  {total ? `p.${r.page} / ${total} ` : ""}
                  ({pctRounded}%)
                </span>
              </div>
              <div className="h-1.5 bg-black/10 rounded overflow-hidden">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.min(100, r.pct)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
