-- Book Club App schema
-- Run this once in the Supabase SQL editor for a fresh project.
-- Re-running is safe due to "if not exists" guards, but RLS policies will throw
-- if they already exist, so drop them first or run on a clean project.

create extension if not exists "pgcrypto";

-- profiles: lightweight mirror of auth.users so we can show names
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

-- clubs
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- club_members
create table if not exists public.club_members (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

-- books
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null,
  author text,
  cover_url text,
  page_count int,
  open_library_id text,
  status text not null default 'current', -- 'current' | 'finished' | 'planned'
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);

-- meetings
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  book_id uuid references public.books(id) on delete set null,
  title text not null,
  scheduled_at timestamptz not null,
  location text,
  description text,
  page_target int,
  created_at timestamptz not null default now()
);

-- reading_progress
create table if not exists public.reading_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  current_page int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

-- discussions
create table if not exists public.discussions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  book_id uuid references public.books(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  chapter_label text,
  body text not null,
  has_spoilers boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_books_club on public.books(club_id);
create index if not exists idx_meetings_club on public.meetings(club_id);
create index if not exists idx_meetings_when on public.meetings(scheduled_at);
create index if not exists idx_discussions_book on public.discussions(book_id);

-- ---------------------------------------------------------------------------
-- Auth: keep public.profiles in sync with auth.users via trigger
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.clubs             enable row level security;
alter table public.club_members      enable row level security;
alter table public.books             enable row level security;
alter table public.meetings          enable row level security;
alter table public.reading_progress  enable row level security;
alter table public.discussions       enable row level security;

-- helper: is user a member of given club?
create or replace function public.is_club_member(c_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_members
    where club_id = c_id and user_id = auth.uid()
  );
$$;

-- profiles: anyone signed in can read profiles of co-members; users can update their own
drop policy if exists "profiles read all" on public.profiles;
create policy "profiles read all" on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (id = auth.uid());

-- clubs
drop policy if exists "clubs members can read" on public.clubs;
create policy "clubs members can read" on public.clubs
  for select using (public.is_club_member(id) or created_by = auth.uid());

drop policy if exists "clubs anyone can insert" on public.clubs;
create policy "clubs anyone can insert" on public.clubs
  for insert with check (created_by = auth.uid());

drop policy if exists "clubs creator can update" on public.clubs;
create policy "clubs creator can update" on public.clubs
  for update using (created_by = auth.uid());

drop policy if exists "clubs creator can delete" on public.clubs;
create policy "clubs creator can delete" on public.clubs
  for delete using (created_by = auth.uid());

-- club_members: members can read; users can insert themselves
drop policy if exists "members read if same club" on public.club_members;
create policy "members read if same club" on public.club_members
  for select using (public.is_club_member(club_id) or user_id = auth.uid());

drop policy if exists "members self insert" on public.club_members;
create policy "members self insert" on public.club_members
  for insert with check (user_id = auth.uid());

drop policy if exists "members self delete" on public.club_members;
create policy "members self delete" on public.club_members
  for delete using (user_id = auth.uid());

-- books
drop policy if exists "books members read" on public.books;
create policy "books members read" on public.books
  for select using (public.is_club_member(club_id));

drop policy if exists "books members write" on public.books;
create policy "books members write" on public.books
  for insert with check (public.is_club_member(club_id));

drop policy if exists "books members update" on public.books;
create policy "books members update" on public.books
  for update using (public.is_club_member(club_id));

drop policy if exists "books members delete" on public.books;
create policy "books members delete" on public.books
  for delete using (public.is_club_member(club_id));

-- meetings
drop policy if exists "meetings members read" on public.meetings;
create policy "meetings members read" on public.meetings
  for select using (public.is_club_member(club_id));

drop policy if exists "meetings members write" on public.meetings;
create policy "meetings members write" on public.meetings
  for insert with check (public.is_club_member(club_id));

drop policy if exists "meetings members update" on public.meetings;
create policy "meetings members update" on public.meetings
  for update using (public.is_club_member(club_id));

drop policy if exists "meetings members delete" on public.meetings;
create policy "meetings members delete" on public.meetings
  for delete using (public.is_club_member(club_id));

-- reading_progress
drop policy if exists "rp members read" on public.reading_progress;
create policy "rp members read" on public.reading_progress
  for select using (
    exists (
      select 1
      from public.books b
      where b.id = book_id and public.is_club_member(b.club_id)
    )
  );

drop policy if exists "rp self upsert" on public.reading_progress;
create policy "rp self upsert" on public.reading_progress
  for insert with check (user_id = auth.uid());

drop policy if exists "rp self update" on public.reading_progress;
create policy "rp self update" on public.reading_progress
  for update using (user_id = auth.uid());

-- discussions
drop policy if exists "disc members read" on public.discussions;
create policy "disc members read" on public.discussions
  for select using (public.is_club_member(club_id));

drop policy if exists "disc members write" on public.discussions;
create policy "disc members write" on public.discussions
  for insert with check (public.is_club_member(club_id) and author_id = auth.uid());

drop policy if exists "disc author delete" on public.discussions;
create policy "disc author delete" on public.discussions
  for delete using (author_id = auth.uid());
