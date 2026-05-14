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

  const currentBook = books?.find((b: any) => b.status === "current") ?? books?.[0] ?? null;

  let progress: any[] = [];
  let discussions: any[] = [];
  if (currentBook) {
    const [pRes, dRes] = await Promise.all([
      supabase
        .from("reading_progress")
        .select("user_id, current_page, progress_pct, last_location, updated_at")
        .eq("book_id", currentBook.id),
      supabase
        .from("discussions")
        .select("*, profiles(display_name)")
        .eq("book_id", currentBook.id)
        .order("created_at", { ascending: false })
        .limit(50)
    ]);
    progress = pRes.data ?? [];
    discussions = dRes.data ?? [];
  }

  return (
    <ClubView
      club={club}
      currentUserId={user.id}
      members={members ?? []}
      books={books ?? []}
      meetings={meetings ?? []}
      currentBook={currentBook}
      progress={progress}
      discussions={discussions}
    />
  );
}
