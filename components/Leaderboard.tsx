import type { LeaderboardRow } from "@/lib/leaderboard";

export default function Leaderboard({
  rows,
  currentUserId
}: {
  rows: LeaderboardRow[];
  currentUserId: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="card">
        <p className="muted">No members yet.</p>
      </div>
    );
  }

  const anyActivity = rows.some(
    (r) => r.pagesRead > 0 || r.booksRead > 0
  );

  if (!anyActivity) {
    return (
      <div className="card">
        <p className="muted">
          No reading progress logged yet. As members read, their pages, books,
          and pace will show up here.
        </p>
      </div>
    );
  }

  const topPace = Math.max(...rows.map((r) => r.pagesPerDay), 0);

  return (
    <div className="card space-y-3">
      <header className="flex items-baseline justify-between">
        <h2 className="h2">Leaderboard</h2>
        <span className="muted text-xs">across all books in this club</span>
      </header>

      <ol className="space-y-2">
        {rows.map((r, i) => {
          const isMe = r.userId === currentUserId;
          const paceBar =
            topPace > 0 ? Math.max(2, (r.pagesPerDay / topPace) * 100) : 0;
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
                    {isMe && (
                      <span className="muted text-xs ml-1">(you)</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm shrink-0">
                  <span title="Books finished">
                    <strong>{r.booksRead}</strong>{" "}
                    <span className="muted text-xs">
                      book{r.booksRead === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span title="Total pages read across all books">
                    <strong>{r.pagesRead.toLocaleString()}</strong>{" "}
                    <span className="muted text-xs">pages</span>
                  </span>
                  <span
                    title={`Average pace, computed over ${r.activeDays} reading day${
                      r.activeDays === 1 ? "" : "s"
                    }`}
                  >
                    <strong>{r.pagesPerDay.toFixed(1)}</strong>{" "}
                    <span className="muted text-xs">p/day</span>
                  </span>
                </div>
              </div>
              {topPace > 0 && (
                <div className="h-1.5 bg-black/10 rounded overflow-hidden">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${Math.min(100, paceBar)}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="muted text-xs">
        Books read counts any book the member finished (≥90% complete). Pace is
        average pages per day across all books they’ve read.
      </p>
    </div>
  );
}
