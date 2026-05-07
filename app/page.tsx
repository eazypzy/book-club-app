import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (user) redirect("/clubs");

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="h1">Read together. Stay on pace.</h1>
        <p className="muted max-w-prose">
          Pick a book, schedule the meeting, and the app figures out how many
          pages you need to read each day to show up ready. Bring your friends.
        </p>
        <div className="flex gap-2">
          <Link href="/login" className="btn-primary">
            Get started
          </Link>
          <Link href="/join" className="btn-ghost">
            I have an invite code
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="card">
          <h2 className="h2 mb-2">Set the book</h2>
          <p className="muted">
            Search Open Library, pick the cover, and lock in the page count.
          </p>
        </div>
        <div className="card">
          <h2 className="h2 mb-2">Schedule meetings</h2>
          <p className="muted">
            Add discussion dates with optional page targets. Export to your
            calendar.
          </p>
        </div>
        <div className="card">
          <h2 className="h2 mb-2">Get a pace</h2>
          <p className="muted">
            See exactly how many pages per day or per week to make each meeting
            on time.
          </p>
        </div>
      </section>
    </div>
  );
}
