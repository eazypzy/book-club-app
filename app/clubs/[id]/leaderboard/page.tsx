import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ClubTabs from "@/components/ClubTabs";
import Leaderboard from "@/components/Leaderboard";
import BooksFinishedRanking from "@/components/BooksFinishedRanking";
import { computeLeaderboard } from "@/lib/leaderboard";

export default async function ClubLeaderboardPage({
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

  const [{ data: members }, { data: books }] = await Promise.all([
    supabase
      .from("club_members")
      .select("user_id, profiles(id, display_name, email)")
      .eq("club_id", club.id),
    supabase
      .from("books")
      .select("id, status, page_count, start_date, end_date")
      .eq("club_id", club.id)
  ]);

  const bookIds = (books ?? []).map((b: any) => b.id);
  let progress: any[] = [];
  if (bookIds.length > 0) {
    const { data: pRes } = await supabase
      .from("reading_progress")
      .select("user_id, book_id, current_page, progress_pct, updated_at")
      .in("book_id", bookIds);
    progress = pRes ?? [];
  }

  const rows = computeLeaderboard({
    members: (members ?? []).map((m: any) => ({
      userId: m.user_id,
      name: m.profiles?.display_name ?? m.profiles?.email ?? "Member"
    })),
    books: (books ?? []) as any[],
    progress: progress as any[]
  });

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={`/clubs/${club.id}`}
          className="muted text-xs hover:text-ink"
        >
          ← {club.name}
        </Link>
        <h1 className="h1 mt-1">Leaderboard</h1>
      </header>
      <ClubTabs clubId={club.id} />
      <BooksFinishedRanking rows={rows} currentUserId={user.id} />
      <Leaderboard rows={rows} currentUserId={user.id} />
    </div>
  );
}
