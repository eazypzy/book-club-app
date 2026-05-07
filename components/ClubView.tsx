"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BookSearchModal, { type OpenLibraryBook } from "./BookSearchModal";
import MeetingForm from "./MeetingForm";
import ReadingPace from "./ReadingPace";
import ProgressPanel from "./ProgressPanel";
import Discussions from "./Discussions";
import EpubManager from "./EpubManager";
import { formatDateTime } from "@/lib/utils";

export default function ClubView({
  club,
  currentUserId,
  members,
  books,
  meetings,
  currentBook,
  progress,
  discussions
}: {
  club: any;
  currentUserId: string;
  members: any[];
  books: any[];
  meetings: any[];
  currentBook: any | null;
  progress: any[];
  discussions: any[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [showSearch, setShowSearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const isOwner = club.created_by === currentUserId;
  const upcomingMeetings = useMemo(
    () =>
      meetings
        .filter((m) => new Date(m.scheduled_at) >= new Date())
        .sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at)),
    [meetings]
  );

  async function pickBook(b: OpenLibraryBook) {
    setBusy(true);
    // Mark previous current book as finished.
    if (currentBook) {
      await supabase
        .from("books")
        .update({ status: "finished" })
        .eq("id", currentBook.id);
    }
    await supabase.from("books").insert({
      club_id: club.id,
      title: b.title,
      author: b.author,
      cover_url: b.coverUrl,
      page_count: b.pageCount,
      open_library_id: b.olid,
      status: "current",
      start_date: new Date().toISOString().slice(0, 10)
    });
    setShowSearch(false);
    setBusy(false);
    router.refresh();
  }

  async function leaveClub() {
    if (!confirm("Leave this club?")) return;
    await supabase
      .from("club_members")
      .delete()
      .eq("club_id", club.id)
      .eq("user_id", currentUserId);
    router.push("/clubs");
  }

  function copyInvite() {
    const url = `${window.location.origin}/join?code=${club.invite_code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopyMsg("Copied!");
      setTimeout(() => setCopyMsg(null), 1500);
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">{club.name}</h1>
          <div className="muted text-sm">
            Invite code:{" "}
            <button
              onClick={copyInvite}
              className="font-mono tracking-widest text-ink underline-offset-2 hover:underline"
              title="Copy invite link"
            >
              {club.invite_code}
            </button>
            {copyMsg && <span className="ml-2 text-green-700">{copyMsg}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <a className="btn-ghost" href={`/api/clubs/${club.id}/calendar.ics`}>
            Export .ics
          </a>
          <button className="btn-ghost" onClick={leaveClub}>
            Leave
          </button>
        </div>
      </header>

      <section className="grid lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="h2">Current book</h2>
            <button
              className="btn-primary"
              onClick={() => setShowSearch(true)}
              disabled={busy}
            >
              {currentBook ? "Change book" : "Pick a book"}
            </button>
          </div>
          {currentBook ? (
            <>
              <div className="flex gap-4">
                {currentBook.cover_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={currentBook.cover_url}
                    alt={currentBook.title}
                    className="h-32 rounded shadow-sm"
                  />
                )}
                <div className="space-y-1">
                  <div className="font-serif text-lg">{currentBook.title}</div>
                  {currentBook.author && (
                    <div className="muted">by {currentBook.author}</div>
                  )}
                  {currentBook.page_count && (
                    <div className="muted text-sm">
                      {currentBook.page_count} pages
                    </div>
                  )}
                  {currentBook.start_date && (
                    <div className="muted text-sm">
                      Started {currentBook.start_date}
                    </div>
                  )}
                </div>
              </div>
              <EpubManager
                clubId={club.id}
                bookId={currentBook.id}
                bookTitle={currentBook.title}
                epubPath={currentBook.epub_path ?? null}
                epubSizeBytes={currentBook.epub_size_bytes ?? null}
              />
            </>
          ) : (
            <p className="muted">No book picked yet.</p>
          )}
        </div>

        <div className="card">
          <h2 className="h2 mb-2">Members ({members.length})</h2>
          <ul className="space-y-1 text-sm">
            {members.map((m: any) => (
              <li key={m.user_id} className="flex items-center justify-between">
                <span>
                  {m.profiles?.display_name ?? m.profiles?.email ?? m.user_id.slice(0, 8)}
                </span>
                <span className="muted text-xs">{m.role}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid lg:grid-cols-2 gap-4">
        <div className="card space-y-3">
          <h2 className="h2">Meetings</h2>
          <MeetingForm
            clubId={club.id}
            bookId={currentBook?.id ?? null}
            maxPages={currentBook?.page_count ?? null}
          />
          {upcomingMeetings.length === 0 ? (
            <p className="muted">No meetings scheduled.</p>
          ) : (
            <ul className="space-y-2">
              {upcomingMeetings.map((m) => (
                <li key={m.id} className="border-t border-black/10 pt-2 text-sm">
                  <div className="font-medium">{m.title}</div>
                  <div className="muted">{formatDateTime(m.scheduled_at)}</div>
                  {m.location && <div className="muted">{m.location}</div>}
                  {m.page_target != null && (
                    <div className="muted">Read through page {m.page_target}</div>
                  )}
                  <button
                    className="text-xs text-red-600 hover:underline mt-1"
                    onClick={async () => {
                      if (!confirm("Delete this meeting?")) return;
                      await supabase.from("meetings").delete().eq("id", m.id);
                      router.refresh();
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card space-y-3">
          <h2 className="h2">Reading pace</h2>
          {currentBook ? (
            <ReadingPace
              totalPages={currentBook.page_count ?? 0}
              startDate={currentBook.start_date ?? new Date().toISOString().slice(0, 10)}
              meetings={meetings.map((m) => ({
                id: m.id,
                title: m.title,
                scheduledAt: m.scheduled_at,
                pageTarget: m.page_target
              }))}
            />
          ) : (
            <p className="muted">Pick a book and add meetings to compute pace.</p>
          )}
        </div>
      </section>

      {currentBook && (
        <section className="grid lg:grid-cols-2 gap-4">
          <ProgressPanel
            book={currentBook}
            members={members}
            progress={progress}
            currentUserId={currentUserId}
          />
          <Discussions
            clubId={club.id}
            bookId={currentBook.id}
            currentUserId={currentUserId}
            initial={discussions}
          />
        </section>
      )}

      {showSearch && (
        <BookSearchModal
          onClose={() => setShowSearch(false)}
          onPick={pickBook}
          busy={busy}
        />
      )}
    </div>
  );
}
