"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import EpubReader from "./EpubReader";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function EpubManager({
  clubId,
  bookId,
  bookTitle,
  pageCount,
  epubPath,
  epubSizeBytes,
  currentUserId,
  myLastLocation
}: {
  clubId: string;
  bookId: string;
  bookTitle: string;
  pageCount: number | null;
  epubPath: string | null;
  epubSizeBytes: number | null;
  currentUserId: string;
  myLastLocation: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"idle" | "uploading" | "downloading" | "removing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (!file.name.toLowerCase().endsWith(".epub")) {
      setError("Pick a .epub file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`File is ${formatBytes(file.size)}; max is 50 MB.`);
      return;
    }

    setBusy("uploading");
    const path = `${clubId}/${bookId}.epub`;
    const { error: upErr } = await supabase.storage
      .from("book-files")
      .upload(path, file, {
        upsert: true,
        contentType: "application/epub+zip"
      });
    if (upErr) {
      setError(upErr.message);
      setBusy("idle");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const { error: dbErr } = await supabase
      .from("books")
      .update({
        epub_path: path,
        epub_size_bytes: file.size,
        epub_uploaded_by: userData.user?.id ?? null,
        epub_uploaded_at: new Date().toISOString()
      })
      .eq("id", bookId);
    if (dbErr) {
      setError(dbErr.message);
      setBusy("idle");
      return;
    }

    setBusy("idle");
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  async function download() {
    if (!epubPath) return;
    setBusy("downloading");
    setError(null);
    const { data, error: sErr } = await supabase.storage
      .from("book-files")
      .createSignedUrl(epubPath, 60);
    if (sErr || !data?.signedUrl) {
      setError(sErr?.message ?? "Could not get download link.");
      setBusy("idle");
      return;
    }
    // Trigger a real download with a sane filename.
    const safeTitle = bookTitle.replace(/[^a-z0-9 _-]+/gi, "").trim().slice(0, 60) || "book";
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = `${safeTitle}.epub`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setBusy("idle");
  }

  async function remove() {
    if (!epubPath) return;
    if (!confirm("Remove the uploaded EPUB? Other members won't be able to download it anymore.")) return;
    setBusy("removing");
    setError(null);
    const { error: rmErr } = await supabase.storage
      .from("book-files")
      .remove([epubPath]);
    if (rmErr) {
      setError(rmErr.message);
      setBusy("idle");
      return;
    }
    const { error: dbErr } = await supabase
      .from("books")
      .update({
        epub_path: null,
        epub_size_bytes: null,
        epub_uploaded_by: null,
        epub_uploaded_at: null
      })
      .eq("id", bookId);
    if (dbErr) {
      setError(dbErr.message);
      setBusy("idle");
      return;
    }
    setBusy("idle");
    router.refresh();
  }

  return (
    <div className="border-t border-black/10 pt-3 mt-3 space-y-2">
      <div className="text-sm font-medium">EPUB</div>
      {epubPath ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="muted">
            Uploaded
            {epubSizeBytes != null ? ` • ${formatBytes(epubSizeBytes)}` : null}
          </span>
          <button
            className="btn-primary text-sm"
            onClick={() => setReading(true)}
            disabled={busy !== "idle"}
          >
            Read
          </button>
          <button
            className="btn-ghost text-sm"
            onClick={download}
            disabled={busy !== "idle"}
          >
            {busy === "downloading" ? "Preparing..." : "Download"}
          </button>
          <label className="btn-ghost text-sm cursor-pointer">
            {busy === "uploading" ? "Uploading..." : "Replace"}
            <input
              ref={fileRef}
              type="file"
              accept=".epub,application/epub+zip"
              className="hidden"
              onChange={onPickFile}
              disabled={busy !== "idle"}
            />
          </label>
          <button
            className="text-xs text-red-600 hover:underline"
            onClick={remove}
            disabled={busy !== "idle"}
          >
            {busy === "removing" ? "Removing..." : "Remove"}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          <label className="btn-ghost text-sm cursor-pointer">
            {busy === "uploading" ? "Uploading..." : "Upload .epub"}
            <input
              ref={fileRef}
              type="file"
              accept=".epub,application/epub+zip"
              className="hidden"
              onChange={onPickFile}
              disabled={busy !== "idle"}
            />
          </label>
          <span className="muted text-xs">Max 50 MB</span>
        </div>
      )}
      {error && <div className="text-xs text-red-600">{error}</div>}
      {reading && epubPath && (
        <EpubReader
          bookId={bookId}
          bookTitle={bookTitle}
          pageCount={pageCount}
          epubPath={epubPath}
          initialLocation={myLastLocation}
          currentUserId={currentUserId}
          onClose={() => setReading(false)}
        />
      )}
    </div>
  );
}
