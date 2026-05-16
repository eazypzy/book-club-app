import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ClubView from "@/components/ClubView";

export default async function ClubPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: club } = await supabase
    .from("clubs")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (!club) notFound();

  const [{ data: members }, { data: books }, { data: meetings }] = await Promise.all([
    supabase
      .from("club_members")
      .select("user_id, role, profiles(id, display_name, email)")
      .eq("club_id", club.id),
    supabase
      .from("books")
      .select("*")
      .eq("club_id", club.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("meetings")
      .select("*")
      .eq("club_id", club.id)
      .order("scheduled_at", { ascending: true })
  ]);

  const currentBooks = (books ?? []).filter((b: any) => b.status === "current");
  const currentIds = currentBooks.map((b: any) => b.id);

  let progressByBook: Record<string, any[]> = {};
  let discussionsByBook: Record<string, any[]> = {};
  if (currentIds.length > 0) {
    const [pRes, dRes] = await Promise.all([
      supabase
        .from("reading_progress")
        .select("user_id, book_id, current_page, progress_pct, last_location, updated_at")
        .in("book_id", currentIds),
      supabase
        .from("discussions")
        .select("*, profiles(display_name)")
        .in("book_id", currentIds)
        .order("created_at", { ascending: false })
        .limit(50 * currentIds.length)
    ]);
    for (const id of currentIds) {
      progressByBook[id] = (pRes.data ?? []).filter((p: any) => p.book_id === id);
      discussionsByBook[id] = (dRes.data ?? []).filter((d: any) => d.book_id === id);
    }
  }

  return (
    <ClubView
      club={club}
      currentUserId={user.id}
      members={members ?? []}
      books={books ?? []}
      meetings={meetings ?? []}
      currentBooks={currentBooks}
      progressByBook={progressByBook}
      discussionsByBook={discussionsByBook}
    />
  );
}
