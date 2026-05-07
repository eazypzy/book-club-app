import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/components/SignOutButton";

export const metadata: Metadata = {
  title: "Book Club",
  description: "Read together. Stay on pace."
};

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-black/10 bg-paper">
          <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-serif text-xl text-ink">
              Book Club
            </Link>
            <nav className="flex items-center gap-3 text-sm">
              {user ? (
                <>
                  <Link href="/clubs" className="hover:underline">My clubs</Link>
                  <Link href="/join" className="hover:underline">Join with code</Link>
                  <span className="muted hidden sm:inline">{user.email}</span>
                  <SignOutButton />
                </>
              ) : (
                <Link href="/login" className="btn-primary">Sign in</Link>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 py-8 muted text-xs">
          Book covers via Open Library.
        </footer>
      </body>
    </html>
  );
}
