-- Migration 002 — fix invite-code lookup
-- Without this, non-members can't resolve an invite code into a club id
-- because the clubs RLS policy hides clubs they don't belong to yet.

create or replace function public.find_club_by_invite_code(code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.clubs
  where invite_code = upper(trim(code))
  limit 1;
$$;

-- Restrict to signed-in users only.
revoke all on function public.find_club_by_invite_code(text) from public;
grant execute on function public.find_club_by_invite_code(text) to authenticated;
