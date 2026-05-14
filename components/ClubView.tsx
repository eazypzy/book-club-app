"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import BookSearchModal, { type OpenLibraryBook } from "./BookSearchModal";
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

      // 2. Mark previous current book as finished, then insert the new one.
      setEpubUploadStatus("Creating book…");
      if (currentBook) {
        const { error: finishErr } = await supabase
          .from("books")
          .update({ status: "finished" })
          .eq("id", currentBook.id);
        if (finishErr) throw new Error(finishErr.message);
      }
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
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="h2">Current book</h2>
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
                {currentBook ? "Change book" : "Pick a book"}
              </button>
            </div>
          </div>
          {epubUploadError && (
            <div className="text-xs text-red-600">{epubUploadError}</div>
          )}
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
                pageCount={currentBook.page_count ?? null}
                epubPath={currentBook.epub_path ?? null}
                epubSizeBytes={currentBook.epub_size_bytes ?? null}
                currentUserId={currentUserId}
                myLastLocation={
                  progress.find((p: any) => p.user_id === currentUserId)
                    ?.last_location ?? null
                }
              />
            </>
          ) : (
            <p className="muted">No book picked yet.</p>
          )}
        </div>

        <div className="card">
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
