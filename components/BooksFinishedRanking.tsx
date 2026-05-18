import type { LeaderboardRow } from "@/lib/leaderboard";

export default function BooksFinishedRanking({
  rows,
  currentUserId
}: {
  rows: LeaderboardRow[];
  currentUserId: string;
}) {
  if (rows.length === 0) return null;

  const ranked = [...rows].sort((a, b) => {
    if (b.booksRead !== a.booksRead) return b.booksRead - a.booksRead;
    return a.name.localeCompare(b.name);
  });

  const max = Math.max(...ranked.map((r) => r.booksRead), 0);
  const totalAcrossMembers = ranked.reduce((s, r) => s + r.booksRead, 0);

  return (
    <div className="card space-y-3">
      <header className="flex items-baseline justify-between">
        <h2 className="h2">Books finished</h2>
        <span className="muted text-xs">
          {totalAcrossMembers} total across the club
        </span>
      </header>

      <ol className="space-y-2">
        {ranked.map((r, i) => {
          const isMe = r.userId === currentUserId;
          const barPct = max > 0 ? (r.booksRead / max) * 100 : 0;
          return (
            <li
              key={r.userId}
              className={`flex flex-col gap-1 border-t border-black/10 pt-2 ${
                i === 0 ? "border-t-0 pt-0" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="muted font-mono text-xs w-6 text-right">
                    {i + 1}.
                  </span>
                  <span
                    className={`truncate ${isMe ? "font-medium text-ink" : ""}`}
                  >
                    {r.name}
                    {isMe && <span className="muted text-xs ml-1">(you)</span>}
                  </span>
                </div>
                <div className="text-sm tabular-nums">
                  <strong>{r.booksRead}</strong>{" "}
                  <span className="muted text-xs">
                    book{r.booksRead === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              {max > 0 && (
                <div className="h-1.5 bg-black/10 rounded overflow-hidden">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${Math.max(2, barPct)}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="muted text-xs">
        Counts any book a member has finished in this club (≥90% complete).
      </p>
    </div>
  );
}
