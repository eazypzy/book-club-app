// Quick sanity test. Run with: node lib/reading-pace.test.mjs
// (Mirrors lib/reading-pace.ts in plain JS so we don't need a TS runner.)

function dayCountInclusive(a, b) {
  const oneDay = 24 * 3600 * 1000;
  const ms = b.getTime() - a.getTime();
  return Math.max(1, Math.ceil(ms / oneDay) + 1);
}
function isoDay(d) { return d.toISOString().slice(0, 10); }

function computeSchedule({ totalPages, startDate, meetings }) {
  if (!totalPages || totalPages <= 0) return [];
  meetings = [...meetings].sort((a,b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
  if (meetings.length === 0) return [];
  const targets = new Array(meetings.length);
  let cursor = 0;
  for (let i = 0; i < meetings.length; i++) {
    const m = meetings[i];
    if (m.pageTarget != null) {
      targets[i] = Math.min(totalPages, Math.max(cursor + 1, m.pageTarget));
      cursor = targets[i];
    } else {
      let unassigned = 0;
      for (let j = i; j < meetings.length; j++) {
        if (meetings[j].pageTarget == null) unassigned++; else break;
      }
      const remaining = totalPages - cursor;
      const stride = Math.max(1, Math.floor(remaining / unassigned));
      for (let j = 0; j < unassigned; j++) {
        targets[i + j] = (j === unassigned - 1 && i + j === meetings.length - 1)
          ? totalPages
          : Math.min(totalPages, cursor + stride * (j + 1));
      }
      cursor = targets[i + unassigned - 1];
      i += unassigned - 1;
    }
  }
  const segs = [];
  let prevPage = 0;
  let prevDate = new Date(startDate + "T00:00:00");
  for (let i = 0; i < meetings.length; i++) {
    const m = meetings[i];
    const meetingDate = new Date(m.scheduledAt);
    const endDay = new Date(meetingDate.getTime() - 24*3600*1000);
    if (endDay < prevDate) endDay.setTime(prevDate.getTime());
    const days = dayCountInclusive(prevDate, endDay);
    const pagesToRead = Math.max(0, targets[i] - prevPage);
    const ppd = pagesToRead / days;
    segs.push({
      meetingId: m.id, meetingTitle: m.title, meetingAt: m.scheduledAt,
      fromDay: isoDay(prevDate), toDay: isoDay(endDay), daysInclusive: days,
      startPage: prevPage, endPage: targets[i], pagesToRead,
      pagesPerDay: Math.round(ppd*10)/10, pagesPerWeek: Math.round(ppd*7*10)/10
    });
    prevPage = targets[i];
    prevDate = new Date(meetingDate.getTime() + 24*3600*1000);
  }
  return segs;
}

function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
}

// Case 1: 300-page book, 3 evenly-spaced meetings, no targets => evenly split
const segs1 = computeSchedule({
  totalPages: 300,
  startDate: "2026-06-01",
  meetings: [
    { id: "a", title: "M1", scheduledAt: "2026-06-15T18:00:00Z", pageTarget: null },
    { id: "b", title: "M2", scheduledAt: "2026-06-29T18:00:00Z", pageTarget: null },
    { id: "c", title: "M3", scheduledAt: "2026-07-13T18:00:00Z", pageTarget: null },
  ],
});
assert(segs1.length === 3, "3 segments");
assert(segs1[2].endPage === 300, "final segment ends at total pages");
assert(segs1[0].startPage === 0, "first segment starts at 0");
console.log("Case 1: even split ->", segs1.map(s => `${s.endPage}p @ ${s.pagesPerDay}/d`));

// Case 2: explicit targets
const segs2 = computeSchedule({
  totalPages: 400,
  startDate: "2026-06-01",
  meetings: [
    { id: "a", title: "M1", scheduledAt: "2026-06-15T18:00:00Z", pageTarget: 100 },
    { id: "b", title: "M2", scheduledAt: "2026-06-29T18:00:00Z", pageTarget: 250 },
    { id: "c", title: "M3", scheduledAt: "2026-07-13T18:00:00Z", pageTarget: null },
  ],
});
assert(segs2[0].endPage === 100, "honor explicit target 1");
assert(segs2[1].endPage === 250, "honor explicit target 2");
assert(segs2[2].endPage === 400, "auto-fill final to total");
console.log("Case 2: explicit ->", segs2.map(s => `${s.startPage+1}-${s.endPage} @ ${s.pagesPerDay}/d`));

// Case 3: edge — single meeting, no target
const segs3 = computeSchedule({
  totalPages: 200,
  startDate: "2026-06-01",
  meetings: [{ id: "x", title: "Mx", scheduledAt: "2026-06-30T18:00:00Z", pageTarget: null }]
});
assert(segs3.length === 1 && segs3[0].endPage === 200, "single meeting covers all pages");
console.log("Case 3: single ->", segs3[0].pagesPerDay, "pages/day");

console.log("OK");
