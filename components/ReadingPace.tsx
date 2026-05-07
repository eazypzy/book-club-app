"use client";

import { computeSchedule, type Meeting } from "@/lib/reading-pace";
import { useMemo } from "react";

export default function ReadingPace({
  totalPages,
  startDate,
  meetings
}: {
  totalPages: number;
  startDate: string;
  meetings: Meeting[];
}) {
  const segments = useMemo(
    () => computeSchedule({ totalPages, startDate, meetings }),
    [totalPages, startDate, meetings]
  );

  if (!totalPages) {
    return <p className="muted">Set a page count on the book to compute pace.</p>;
  }
  if (segments.length === 0) {
    return <p className="muted">Add at least one meeting to see your pace.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="muted text-xs">
        Total: {totalPages} pages, starting {startDate}
      </div>
      <ul className="space-y-2">
        {segments.map((s) => (
          <li key={s.meetingId} className="border-t border-black/10 pt-2 text-sm">
            <div className="font-medium">{s.meetingTitle}</div>
            <div className="muted text-xs">
              {new Date(s.meetingAt).toLocaleString()}
            </div>
            <div className="mt-1">
              Read pages <strong>{s.startPage + 1}</strong> through{" "}
              <strong>{s.endPage}</strong> ({s.pagesToRead} pages over{" "}
              {s.daysInclusive} days)
            </div>
            <div className="muted text-xs">
              {s.pagesPerDay} pages/day &middot; {s.pagesPerWeek} pages/week
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
