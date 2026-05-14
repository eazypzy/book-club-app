/**
 * Leaderboard stats for a book club.
 *
 * Aggregates each member's reading across every book the club has touched
 * (current + finished) and ranks them.
 */

export type LeaderboardBook = {
  id: string;
  status: string; // 'current' | 'finished' | 'planned'
  page_count: number | null;
  start_date: string | null;
  end_date: string | null;
};

export type LeaderboardProgress = {
  user_id: string;
  book_id: string;
  current_page: number | null;
  progress_pct: number | null;
  updated_at: string | null;
};

export type LeaderboardMember = {
  userId: string;
  name: string;
};

export type LeaderboardRow = {
  userId: string;
  name: string;
  pagesRead: number;
  booksRead: number;
  pagesPerDay: number; // 0 when we can't compute
  activeDays: number;
};

const FINISHED_THRESHOLD_PCT = 90;
const ONE_DAY_MS = 24 * 3600 * 1000;

function pagesReadOnBook(
  p: LeaderboardProgress | undefined,
  pageCount: number | null
): number {
  if (!p) return 0;
  const fromPct =
    p.progress_pct != null && pageCount
      ? (Number(p.progress_pct) / 100) * pageCount
      : 0;
  const fromPage = p.current_page ?? 0;
  return Math.max(0, Math.round(Math.max(fromPct, fromPage)));
}

function pctOnBook(
  p: LeaderboardProgress | undefined,
  pageCount: number | null
): number {
  if (!p) return 0;
  if (p.progress_pct != null) return Number(p.progress_pct);
  if (pageCount && p.current_page) {
    return Math.min(100, (p.current_page / pageCount) * 100);
  }
  return 0;
}

function readingDaysForBook(
  book: LeaderboardBook,
  p: LeaderboardProgress | undefined
): number {
  if (!p) return 0;
  const start = book.start_date ? new Date(book.start_date + "T00:00:00") : null;
  if (!start) return 0;
  const endIso =
    book.status === "finished" && book.end_date
      ? book.end_date + "T23:59:59"
      : p.updated_at ?? new Date().toISOString();
  const end = new Date(endIso);
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(ms / ONE_DAY_MS));
}

export function computeLeaderboard(opts: {
  members: LeaderboardMember[];
  books: LeaderboardBook[];
  progress: LeaderboardProgress[];
}): LeaderboardRow[] {
  const { members, books, progress } = opts;
  const progressByMemberBook = new Map<string, LeaderboardProgress>();
  for (const p of progress) {
    progressByMemberBook.set(`${p.user_id}|${p.book_id}`, p);
  }

  const rows = members.map((m) => {
    let pagesRead = 0;
    let booksRead = 0;
    let totalDays = 0;

    for (const b of books) {
      if (b.status === "planned") continue;
      const p = progressByMemberBook.get(`${m.userId}|${b.id}`);
      if (!p) continue;

      const pages = pagesReadOnBook(p, b.page_count);
      pagesRead += pages;

      const pct = pctOnBook(p, b.page_count);
      // A book is "read" if the member crossed the threshold, OR if the
      // club has marked the book finished and the member has any progress
      // logged (a soft credit for participating to the end).
      if (pct >= FINISHED_THRESHOLD_PCT) {
        booksRead += 1;
      } else if (b.status === "finished" && b.page_count && pages >= b.page_count) {
        booksRead += 1;
      }

      totalDays += readingDaysForBook(b, p);
    }

    const pagesPerDay = totalDays > 0 ? pagesRead / totalDays : 0;
    return {
      userId: m.userId,
      name: m.name,
      pagesRead,
      booksRead,
      pagesPerDay: Math.round(pagesPerDay * 10) / 10,
      activeDays: totalDays
    };
  });

  rows.sort((a, b) => {
    if (b.booksRead !== a.booksRead) return b.booksRead - a.booksRead;
    if (b.pagesRead !== a.pagesRead) return b.pagesRead - a.pagesRead;
    return b.pagesPerDay - a.pagesPerDay;
  });

  return rows;
}
