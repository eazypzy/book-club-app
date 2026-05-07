import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function ClubsPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Find clubs this user is a member of.
  const { data: memberships } = await supabase
    .from("club_members")
    .select("club_id, clubs(id, name, invite_code)")
    .eq("user_id", user.id);

  const clubs =
    memberships
      ?.map((m: any) => m.clubs)
      .filter(Boolean)
      .sort((a: any, b: any) => a.name.localeCompare(b.name)) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="h1">My clubs</h1>
        <div className="flex gap-2">
          <Link href="/join" className="btn-ghost">Join with code</Link>
          <Link href="/clubs/new" className="btn-primary">New club</Link>
        </div>
      </div>

      {clubs.length === 0 ? (
        <div className="card">
          <p className="muted">
            You&apos;re not in any clubs yet. Create one or join with an invite
            code.
          </p>
        </div>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3">
          {clubs.map((c: any) => (
            <li key={c.id}>
              <Link href={`/clubs/${c.id}`} className="card block hover:shadow-md transition">
                <div className="font-serif text-lg">{c.name}</div>
                <div className="muted text-xs mt-1">Invite code: {c.invite_code}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
