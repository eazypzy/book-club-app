-- Migration 003 — in-app EPUB reader: track progress as % and last EPUB CFI
-- Run this once in the Supabase SQL editor.

alter table public.reading_progress
  add column if not exists progress_pct numeric(5,2) check (progress_pct >= 0 and progress_pct <= 100),
  add column if not exists last_location text;

-- progress_pct supersedes current_page when present (the in-app reader writes
-- both; the manual "current page" form keeps writing only current_page).
-- last_location stores an epub.js CFI so the reader can resume exactly where
-- the user left off.
