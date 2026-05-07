"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function MeetingForm({
  clubId,
  bookId,
  maxPages
}: {
  clubId: string;
  bookId: string | null;
  maxPages: number | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [location, setLocation] = useState("");
  const [pageTarget, setPageTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("meetings").insert({
      club_id: clubId,
      book_id: bookId,
      title,
      scheduled_at: new Date(when).toISOString(),
      location: location || null,
      page_target: pageTarget ? Number(pageTarget) : null
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setTitle("");
    setWhen("");
    setLocation("");
    setPageTarget("");
    setOpen(false);
    setBusy(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button className="btn-ghost w-full" onClick={() => setOpen(true)}>
        + Add meeting
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-black/10 pt-3">
      <div>
        <label className="label">Title</label>
        <input
          className="input"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Chapters 1-5 discussion"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">When</label>
          <input
            type="datetime-local"
            className="input"
            required
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </div>
        <div>
          <label className="label">
            Page target {maxPages ? `(of ${maxPages})` : ""}
          </label>
          <input
            type="number"
            min={1}
            max={maxPages ?? undefined}
            className="input"
            value={pageTarget}
            onChange={(e) => setPageTarget(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>
      <div>
        <label className="label">Location / link</label>
        <input
          className="input"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Zoom link, cafe, etc."
        />
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>
          {busy ? "Saving..." : "Save meeting"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
