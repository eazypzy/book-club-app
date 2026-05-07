# Book Club

Multi-player book club app. Pick a book, schedule meetings, and the app calculates your daily/weekly reading pace so everyone shows up ready.

## Features

- Magic-link sign-in (Supabase Auth)
- Create clubs, share via 6-character invite codes
- Book search via Open Library (cover + page count auto-filled)
- Meetings with optional page targets
- Reading-pace calculator: pages/day and pages/week between meetings
- Per-member reading progress with a leaderboard bar
- Chapter-tagged discussions with click-to-reveal spoiler tags
- One-click `.ics` export for Google/Apple/Outlook calendar
- Row-level security so a member can only see clubs they belong to

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Supabase (Postgres + Auth) via `@supabase/ssr`
- `ics` for calendar export
- Open Library JSON API for book search

## Local setup

1. Create a free Supabase project at https://supabase.com.
2. In the Supabase dashboard, open the **SQL editor** and run the contents of `supabase/schema.sql`.
3. In **Authentication → URL Configuration**, set:
   - Site URL: `http://localhost:3000`
   - Additional redirect URLs: `http://localhost:3000/auth/callback`
4. Copy `.env.example` to `.env.local` and fill:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```
5. Install and run:
   ```
   npm install
   npm run dev
   ```
6. Open http://localhost:3000, sign in with your email, click the magic link.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import into Vercel (https://vercel.com/new). Framework auto-detects as Next.js.
3. Add the same three env vars in **Project Settings → Environment Variables**, but set `NEXT_PUBLIC_SITE_URL` to your Vercel URL (e.g. `https://book-club-xyz.vercel.app`).
4. In Supabase, add your Vercel URL and `<vercel-url>/auth/callback` to the **redirect URLs** list, and update **Site URL**.
5. Deploy. Magic-link emails will now send users back to your production URL.

## Inviting friends

Open a club, click the invite code in the header to copy a join link, and send it. Friends sign in with their email, then land on the join page with the code prefilled.

## Data model

See `supabase/schema.sql`. Tables: `profiles`, `clubs`, `club_members`, `books`, `meetings`, `reading_progress`, `discussions`. Row-level security restricts every read/write to club members via the `is_club_member()` helper.

## Notes

- Open Library is rate-limited but free, no key required.
- The reading-pace calculator distributes pages evenly across meetings, but if you set explicit `page_target` values on meetings, those are used instead and the rest are filled in automatically.
- The `.ics` export defaults each meeting to a 1-hour duration.
