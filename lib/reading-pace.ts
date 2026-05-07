/**
 * Reading-pace planner.
 *
 * Given total pages, a start date, and a list of meeting dates (each may have
 * a target page), compute per-segment pages-per-day so that you arrive at each
 * meeting having read the assigned pages.
 */

export type Meeting = {
  id: string;
  scheduledAt: string; // ISO
  pageTarget: number | null;
  title: string;
};

export type Segment = {
  meetingId: string;
  meetingTitle: string;
  meetingAt: string;
  fromDay: string; // ISO date
  toDay: string;   // ISO date
  daysInclusive: number;
  startPage: number;
  endPage: number;
  pagesToRead: number;
  pagesPerDay: number;
  pagesPerWeek: number;
};

function dayCountInclusive(a: Date, b: Date): number {
  const oneDay = 24 * 3600 * 1000;
  const ms = b.getTime() - a.getTime();
  return Math.max(1, Math.ceil(ms / oneDay) + 1);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * If meetings have no page targets, evenly distribute pages.
 * If some have explicit targets, use them in order; the rest default to evenly
 * spaced across the remaining pages.
 */
export function computeSchedule(opts: {
  totalPages: number;
  startDate: string; // ISO date "YYYY-MM-DD"
  meetings: Meeting[];
}): Segment[] {
  const { totalPages } = opts;
  if (!totalPages || totalPages <= 0) return [];

  const meetings = [...opts.meetings].sort(
    (a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt)
  );
  if (meetings.length === 0) return [];

  // Resolve page targets: fill in nulls by evenly spacing remaining pages.
  const targets: number[] = new Array(meetings.length);
  let cursor = 0;
  for (let i = 0; i < meetings.length; i++) {
    const m = meetings[i];
    if (m.pageTarget != null) {
      targets[i] = Math.min(totalPages, Math.max(cursor + 1, m.pageTarget));
      cursor = targets[i];
    } else {
      // count remaining unassigned including this one
      let unassigned = 0;
      for (let j = i; j < meetings.length; j++) {
        if (meetings[j].pageTarget == null) unassigned++;
        else break;
      }
      const remaining = totalPages - cursor;
      const stride = Math.max(1, Math.floor(remaining / unassigned));
      for (let j = 0; j < unassigned; j++) {
        targets[i + j] =
          j === unassigned - 1 && i + j === meetings.length - 1
            ? totalPages
            : Math.min(totalPages, cursor + stride * (j + 1));
      }
      cursor = targets[i + unassigned - 1];
      i += unassigned - 1;
    }
  }

  const segments: Segment[] = [];
  let prevPage = 0;
  let prevDate = new Date(opts.startDate + "T00:00:00");

  for (let i = 0; i < meetings.length; i++) {
    const m = meetings[i];
    const meetingDate = new Date(m.scheduledAt);
    // Reading window ends the day BEFORE the meeting (so you finish before).
    const endDay = new Date(meetingDate.getTime() - 24 * 3600 * 1000);
    if (endDay < prevDate) endDay.setTime(prevDate.getTime());

    const days = dayCountInclusive(prevDate, endDay);
    const pagesToRead = Math.max(0, targets[i] - prevPage);
    const ppd = pagesToRead / days;

    segments.push({
      meetingId: m.id,
      meetingTitle: m.title,
      meetingAt: m.scheduledAt,
      fromDay: isoDay(prevDate),
      toDay: isoDay(endDay),
      daysInclusive: days,
      startPage: prevPage,
      endPage: targets[i],
      pagesToRead,
      pagesPerDay: Math.round(ppd * 10) / 10,
      pagesPerWeek: Math.round(ppd * 7 * 10) / 10
    });

    prevPage = targets[i];
    prevDate = new Date(meetingDate.getTime() + 24 * 3600 * 1000);
  }

  return segments;
}
