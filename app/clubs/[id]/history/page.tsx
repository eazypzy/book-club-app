import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ClubTabs from "@/components/ClubTabs";
import BookHistory from "@/components/BookHistory";

export default async function ClubHistoryPage({
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

  // Finished books — newest first (by end_date when present, else created_at).
  const { data: finishedBooks } = await supabase
    .from("books")
    .select(
      "id, title, author, cover_url, page_count, start_date, end_date, takeaways, created_at"
    )
    .eq("club_id", club.id)
    .eq("status", "finished")
    .order("end_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const bookIds = (finishedBooks ?? []).map((b: any) => b.id);

  // Pull all discussions for the finished books in one query, then bucket by
  // book_id client-side. Way fewer round trips than per-book.
  let discussionsByBook = new Map<string, any[]>();
  if (bookIds.length > 0) {
    const { data: discs } = await supabase
      .from("discussions")
      .select("*, profiles(display_name)")
      .in("book_id", bookIds)
      .order("created_at", { ascending: false });
    for (const d of discs ?? []) {
      const list = discussionsByBook.get(d.book_id) ?? [];
      list.push(d);
      discussionsByBook.set(d.book_id, list);
    }
  }

  const books = (finishedBooks ?? []).map((b: any) => ({
    ...b,
    discussions: discussionsByBook.get(b.id) ?? []
  }));

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={`/clubs/${club.id}`}
          className="muted text-xs hover:text-ink"
        >
          ← {club.name}
        </Link>
        <h1 className="h1 mt-1">History</h1>
      </header>
      <ClubTabs clubId={club.id} />
      <BookHistory books={books} currentUserId={user.id} />
    </div>
  );
}
