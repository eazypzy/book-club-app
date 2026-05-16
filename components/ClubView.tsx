"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BookSearchModal, { type OpenLibraryBook } from "./BookSearchModal";
import ClubTabs from "./ClubTabs";
import MeetingForm from "./MeetingForm";
import ReadingPace from "./ReadingPace";
import ProgressPanel from "./ProgressPanel";
import Discussions from "./Discussions";
import EpubManager from "./EpubManager";
import { parseEpubMetadata } from "@/lib/epub-metadata";
import { formatDateTime } from "@/lib/utils";

const MAX_EPUB_BYTES = 50 * 1024 * 1024; // mirrors EpubManager

export default function ClubView({
  club,
  currentUserId,
  members,
  books,
  meetings,
  currentBooks,
  progressByBook,
  discussionsByBook
}: {
  club: any;
  currentUserId: string;
  members: any[];
  books: any[];
  meetings: any[];
  currentBooks: any[];
  progressByBook: Record<string, any[]>;
  discussionsByBook: Record<string, any[]>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [showSearch, setShowSearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [epubUploadStatus, setEpubUploadStatus] = useState<string | null>(null);
  const [epubUploadError, setEpubUploadError] = useState<string | null>(null);
  const directEpubInputRef = useRef<HTMLInputElement>(null);

  const self = members.find((m: any) => m.user_id === currentUserId);
  const selfDisplayName: string =
    self?.profiles?.display_name ?? self?.profiles?.email ?? "";

  function startEditName() {
    setNameInput(selfDisplayName);
    setEditingName(true);
  }

  async function saveName() {
    const name = nameInput.trim();
    if (!name) return;
    setSavingName(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: name })
      .eq("id", currentUserId);
    setSavingName(false);
    if (error) {
      alert(error.message);
      return;
    }
    setEditingName(false);
    router.refresh();
  }

  async function pickBook(b: OpenLibraryBook) {
    setBusy(true);
    // Multiple "current" books are allowed (e.g. a fiction + non-fiction
    // track). Just insert the new one — don't auto-finish anything.
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

  async function onPickEpubDirect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (directEpubInputRef.current) directEpubInputRef.current.value = "";
    setEpubUploadError(null);

    if (!file.name.toLowerCase().endsWith(".epub")) {
      setEpubUploadError("Pick a .epub file.");
      return;
    }
    if (file.size > MAX_EPUB_BYTES) {
      setEpubUploadError(
        `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; max is 50 MB.`
      );
      return;
    }

    setBusy(true);
    try {
      // 1. Parse metadata before touching the DB so we can use it on insert.
      setEpubUploadStatus("Reading EPUB…");
      const meta = await parseEpubMetadata(file).catch(() => null);
      const fallbackTitle = file.name.replace(/\.epub$/i, "").trim() || "Untitled";
      const title = meta?.title?.trim() || fallbackTitle;

      // 2. Insert the new book alongside any existing current books.
      setEpubUploadStatus("Creating book…");
      const { data: inserted, error: insertErr } = await supabase
        .from("books")
        .insert({
          club_id: club.id,
          title,
          author: meta?.author ?? null,
          cover_url: meta?.coverDataUrl ?? null,
          page_count: meta?.pageCount ?? null,
          status: "current",
          start_date: new Date().toISOString().slice(0, 10)
        })
        .select("id")
        .single();
      if (insertErr || !inserted) {
        throw new Error(insertErr?.message ?? "Could not create book.");
      }
      const newBookId: string = inserted.id;

      // 3. Upload the EPUB into the book-files bucket.
      setEpubUploadStatus("Uploading EPUB…");
      const path = `${club.id}/${newBookId}.epub`;
      const { error: upErr } = await supabase.storage
        .from("book-files")
        .upload(path, file, {
          upsert: true,
          contentType: "application/epub+zip"
        });
      if (upErr) {
        // Roll back the book row so the club doesn't get a current book with
        // no file attached.
        await supabase.from("books").delete().eq("id", newBookId);
        throw new Error(upErr.message);
      }

      // 4. Link the file back to the book row.
      const { data: userData } = await supabase.auth.getUser();
      const { error: linkErr } = await supabase
        .from("books")
        .update({
          epub_path: path,
          epub_size_bytes: file.size,
          epub_uploaded_by: userData.user?.id ?? null,
          epub_uploaded_at: new Date().toISOString()
        })
        .eq("id", newBookId);
      if (linkErr) throw new Error(linkErr.message);

      setEpubUploadStatus(null);
      router.refresh();
    } catch (err: any) {
      setEpubUploadError(err?.message ?? "Upload failed.");
      setEpubUploadStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function markFinished(bookId: string, title: string) {
    if (!confirm(`Mark "${title}" as finished?`)) return;
    const { error } = await supabase
      .from("books")
      .update({
        status: "finished",
        end_date: new Date().toISOString().slice(0, 10)
      })
      .eq("id", bookId);
    if (error) {
      alert(error.message);
      return;
    }
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

  const addBookHeader = (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <h2 className="h2">
        {currentBooks.length === 0
          ? "Pick a book"
          : `Current books (${currentBooks.length})`}
      </h2>
      <div className="flex items-center gap-2">
        <label
          className={`btn-ghost text-sm cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}
          title="Upload an EPUB — title, author, cover, and page count are detected automatically."
        >
          {epubUploadStatus ?? "Upload EPUB"}
          <input
            ref={directEpubInputRef}
            type="file"
            accept=".epub,application/epub+zip"
            className="hidden"
            onChange={onPickEpubDirect}
            disabled={busy}
          />
        </label>
        <button
          className="btn-primary"
          onClick={() => setShowSearch(true)}
          disabled={busy}
        >
          {currentBooks.length === 0 ? "Pick a book" : "Add another"}
        </button>
      </div>
    </div>
  );

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

      <ClubTabs clubId={club.id} />

      <section className="card space-y-3">
        {addBookHeader}
        {epubUploadError && (
          <div className="text-xs text-red-600">{epubUploadError}</div>
        )}
        {currentBooks.length === 0 && (
          <p className="muted">
            No book picked yet. Add a fiction and a non-fiction book to read
            them in parallel — each gets its own meetings, discussion, and
            pace.
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="h2 mb-2">Members ({members.length})</h2>
        <ul className="space-y-1 text-sm">
          {members.map((m: any) => {
            const isSelf = m.user_id === currentUserId;
            const displayName =
              m.profiles?.display_name ?? m.profiles?.email ?? m.user_id.slice(0, 8);
            return (
              <li key={m.user_id} className="flex items-center justify-between gap-2">
                {isSelf && editingName ? (
                  <span className="flex items-center gap-1 flex-1">
                    <input
                      autoFocus
                      className="input text-sm py-1 px-2 flex-1"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveName();
                        if (e.key === "Escape") setEditingName(false);
                      }}
                      maxLength={60}
                      disabled={savingName}
                    />
                    <button
                      type="button"
                      className="text-xs text-accent hover:underline disabled:opacity-50"
                      onClick={saveName}
                      disabled={savingName || !nameInput.trim()}
                    >
                      {savingName ? "..." : "save"}
                    </button>
                    <button
                      type="button"
                      className="text-xs muted hover:underline"
                      onClick={() => setEditingName(false)}
                      disabled={savingName}
                    >
                      cancel
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span>{displayName}</span>
                    {isSelf && (
                      <button
                        type="button"
                        className="text-xs muted hover:underline"
                        onClick={startEditName}
                        title="Change your display name"
                      >
                        edit
                      </button>
                    )}
                  </span>
                )}
                <span className="muted text-xs">{m.role}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {currentBooks.map((book) => (
        <BookTrack
          key={book.id}
          club={club}
          book={book}
          members={members}
          currentUserId={currentUserId}
          meetings={meetings.filter((m) => m.book_id === book.id)}
          progress={progressByBook[book.id] ?? []}
          discussions={discussionsByBook[book.id] ?? []}
          onMarkFinished={() => markFinished(book.id, book.title)}
        />
      ))}

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

function BookTrack({
  club,
  book,
  members,
  currentUserId,
  meetings,
  progress,
  discussions,
  onMarkFinished
}: {
  club: any;
  book: any;
  members: any[];
  currentUserId: string;
  meetings: any[];
  progress: any[];
  discussions: any[];
  onMarkFinished: () => void;
}) {
  const upcomingMeetings = useMemo(
    () =>
      meetings
        .filter((m) => new Date(m.scheduled_at) >= new Date())
        .sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at)),
    [meetings]
  );

  return (
    <section className="space-y-4">
      <div className="card space-y-3">
        <div className="flex gap-4">
          {book.cover_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.cover_url}
              alt={book.title}
              className="h-32 rounded shadow-sm"
            />
          )}
          <div className="space-y-1 flex-1 min-w-0">
            <div className="font-serif text-lg">{book.title}</div>
            {book.author && <div className="muted">by {book.author}</div>}
            {book.page_count && (
              <div className="muted text-sm">{book.page_count} pages</div>
            )}
            {book.start_date && (
              <div className="muted text-sm">Started {book.start_date}</div>
            )}
          </div>
          <button
            className="text-xs muted hover:text-ink self-start"
            onClick={onMarkFinished}
            title="Move this book to History"
          >
            Mark finished
          </button>
        </div>
        <EpubManager
          clubId={club.id}
          bookId={book.id}
          bookTitle={book.title}
          pageCount={book.page_count ?? null}
          epubPath={book.epub_path ?? null}
          epubSizeBytes={book.epub_size_bytes ?? null}
          currentUserId={currentUserId}
          myLastLocation={
            progress.find((p: any) => p.user_id === currentUserId)
              ?.last_location ?? null
          }
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card space-y-3">
          <h2 className="h2">Meetings</h2>
          <MeetingForm
            clubId={club.id}
            bookId={book.id}
            maxPages={book.page_count ?? null}
          />
          {upcomingMeetings.length === 0 ? (
            <p className="muted">No meetings scheduled.</p>
          ) : (
            <ul className="space-y-2">
              {upcomingMeetings.map((m) => (
                <MeetingItem key={m.id} meeting={m} />
              ))}
            </ul>
          )}
        </div>

        <div className="card space-y-3">
          <h2 className="h2">Reading pace</h2>
          <ReadingPace
            totalPages={book.page_count ?? 0}
            startDate={book.start_date ?? new Date().toISOString().slice(0, 10)}
            meetings={meetings.map((m) => ({
              id: m.id,
              title: m.title,
              scheduledAt: m.scheduled_at,
              pageTarget: m.page_target
            }))}
          />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <ProgressPanel
          book={book}
          members={members}
          progress={progress}
          currentUserId={currentUserId}
        />
        <Discussions
          clubId={club.id}
          bookId={book.id}
          currentUserId={currentUserId}
          initial={discussions}
        />
      </div>
    </section>
  );
}

function MeetingItem({ meeting }: { meeting: any }) {
  const router = useRouter();
  const supabase = createClient();
  return (
    <li className="border-t border-black/10 pt-2 text-sm">
      <div className="font-medium">{meeting.title}</div>
      <div className="muted">{formatDateTime(meeting.scheduled_at)}</div>
      {meeting.location && <div className="muted">{meeting.location}</div>}
      {meeting.page_target != null && (
        <div className="muted">Read through page {meeting.page_target}</div>
      )}
      <button
        className="text-xs text-red-600 hover:underline mt-1"
        onClick={async () => {
          if (!confirm("Delete this meeting?")) return;
          await supabase.from("meetings").delete().eq("id", meeting.id);
          router.refresh();
        }}
      >
        Delete
      </button>
    </li>
  );
}
