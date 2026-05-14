-- Migration 004 — book takeaways for the history page
-- Run this once in the Supabase SQL editor.

-- One shared takeaways note per book (any club member can edit). Lives on
-- the books row so it tracks the book through its lifecycle (current →
-- finished). The history page surfaces it alongside the discussions.

alter table public.books
  add column if not exists takeaways text;
