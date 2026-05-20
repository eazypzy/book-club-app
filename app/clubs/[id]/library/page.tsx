import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ClubTabs from "@/components/ClubTabs";
import LibraryView from "@/components/LibraryView";

export default async function ClubLibraryPage({
  params
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: club } = await supabase
    .from("clubs")
    .select("id, name")
    .eq("id", params.id)
    .maybeSingle();

  if (!club) notFound();

  // Library shows every book in the club that has an EPUB attached and isn't
  // finished. Current-status books appear with a "Reading now" badge so you
  // can see what's active alongside everything else available to pick up.
  const { data: books } = await supabase
    .from("books")
    .select(
      "id, title, author, cover_url, page_count, status, epub_path, epub_size_bytes, epub_uploaded_at, start_date, created_at"
    )
    .eq("club_id", club.id)
    .neq("status", "finished")
    .order("created_at", { ascending: false });

  const withEpub = (books ?? []).filter((b: any) => b.epub_path);
  const ids = withEpub.map((b: any) => b.id);

  // Self progress so we can resume from the right spot when opening from
  // Library. Other members' progress isn't needed on this view.
  let myProgress: Record<string, { last_location: string | null; progress_pct: number | null }> = {};
  if (ids.length > 0) {
    const { data: rp } = await supabase
      .from("reading_progress")
      .select("book_id, last_location, progress_pct")
      .eq("user_id", user.id)
      .in("book_id", ids);
    for (const r of rp ?? []) {
      myProgress[r.book_id] = {
        last_location: r.last_location,
        progress_pct: r.progress_pct
      };
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={`/clubs/${club.id}`}
          className="muted text-xs hover:text-ink"
        >
          ← {club.name}
        </Link>
        <h1 className="h1 mt-1">Library</h1>
      </header>
      <ClubTabs clubId={club.id} />
      <LibraryView
        clubId={club.id}
        currentUserId={user.id}
        books={withEpub}
        myProgress={myProgress}
      />
    </div>
  );
}
