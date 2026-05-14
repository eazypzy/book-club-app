// Quick sanity test. Run with: node lib/leaderboard.test.mjs
// (Mirrors lib/leaderboard.ts in plain JS so we don't need a TS runner.)

const FINISHED_THRESHOLD_PCT = 90;
const ONE_DAY_MS = 24 * 3600 * 1000;

function pagesReadOnBook(p, pageCount) {
  if (!p) return 0;
  const fromPct = p.progress_pct != null && pageCount
    ? (Number(p.progress_pct) / 100) * pageCount
    : 0;
  const fromPage = p.current_page ?? 0;
  return Math.max(0, Math.round(Math.max(fromPct, fromPage)));
}

function pctOnBook(p, pageCount) {
  if (!p) return 0;
  if (p.progress_pct != null) return Number(p.progress_pct);
  if (pageCount && p.current_page) return Math.min(100, (p.current_page / pageCount) * 100);
  return 0;
}

function readingDaysForBook(book, p) {
  if (!p) return 0;
  const start = book.start_date ? new Date(book.start_date + "T00:00:00") : null;
  if (!start) return 0;
  const endIso = (book.status === "finished" && book.end_date)
    ? book.end_date + "T23:59:59"
    : (p.updated_at ?? new Date().toISOString());
  const end = new Date(endIso);
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(ms / ONE_DAY_MS));
}

function computeLeaderboard({ members, books, progress }) {
  const map = new Map();
  for (const p of progress) map.set(`${p.user_id}|${p.book_id}`, p);
  const rows = members.map((m) => {
    let pagesRead = 0, booksRead = 0, totalDays = 0;
    for (const b of books) {
      if (b.status === "planned") continue;
      const p = map.get(`${m.userId}|${b.id}`);
      if (!p) continue;
      const pages = pagesReadOnBook(p, b.page_count);
      pagesRead += pages;
      const pct = pctOnBook(p, b.page_count);
      if (pct >= FINISHED_THRESHOLD_PCT) booksRead += 1;
      else if (b.status === "finished" && b.page_count && pages >= b.page_count) booksRead += 1;
      totalDays += readingDaysForBook(b, p);
    }
    const pagesPerDay = totalDays > 0 ? pagesRead / totalDays : 0;
    return {
      userId: m.userId, name: m.name, pagesRead, booksRead,
      pagesPerDay: Math.round(pagesPerDay * 10) / 10, activeDays: totalDays
    };
  });
  rows.sort((a, b) => {
    if (b.booksRead !== a.booksRead) return b.booksRead - a.booksRead;
    if (b.pagesRead !== a.pagesRead) return b.pagesRead - a.pagesRead;
    return b.pagesPerDay - a.pagesPerDay;
  });
  return rows;
}

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
}

// Setup: 2 members, 2 books — one finished, one current.
const members = [
  { userId: "u1", name: "Alice" },
  { userId: "u2", name: "Bob" }
];
const books = [
  { id: "b1", status: "finished", page_count: 300, start_date: "2026-04-01", end_date: "2026-05-01" },
  { id: "b2", status: "current",  page_count: 200, start_date: "2026-05-02", end_date: null }
];
const progress = [
  // Alice finished book 1, halfway through book 2 (via reader pct)
  { user_id: "u1", book_id: "b1", current_page: 300, progress_pct: 100, updated_at: "2026-05-01T00:00:00Z" },
  { user_id: "u1", book_id: "b2", current_page: 100, progress_pct: 50,  updated_at: "2026-05-14T00:00:00Z" },
  // Bob abandoned book 1 at 50%, just started book 2
  { user_id: "u2", book_id: "b1", current_page: 150, progress_pct: 50,  updated_at: "2026-04-20T00:00:00Z" },
  { user_id: "u2", book_id: "b2", current_page: 20,  progress_pct: null, updated_at: "2026-05-10T00:00:00Z" }
];

const rows = computeLeaderboard({ members, books, progress });
console.log("Rows:", rows);

assert(rows[0].userId === "u1", "Alice leads");
assert(rows[0].booksRead === 1, "Alice has 1 book finished");
assert(rows[0].pagesRead === 400, "Alice read 300+100=400 pages");
assert(rows[1].booksRead === 0, "Bob has no books finished");
assert(rows[1].pagesRead === 170, "Bob read 150+20=170 pages");
assert(rows[0].pagesPerDay > 0, "Alice has positive pace");

// Edge: no progress at all
const empty = computeLeaderboard({
  members,
  books,
  progress: []
});
assert(empty.every((r) => r.pagesRead === 0 && r.booksRead === 0 && r.pagesPerDay === 0),
  "no progress -> all zeros");

// Edge: planned book is excluded
const planned = computeLeaderboard({
  members: [{ userId: "u1", name: "Alice" }],
  books: [{ id: "bp", status: "planned", page_count: 500, start_date: "2026-06-01", end_date: null }],
  progress: [{ user_id: "u1", book_id: "bp", current_page: 100, progress_pct: 20, updated_at: "2026-06-05T00:00:00Z" }]
});
assert(planned[0].pagesRead === 0, "planned books excluded");

console.log("OK");
