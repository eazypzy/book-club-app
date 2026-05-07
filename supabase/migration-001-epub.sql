-- Migration 001 — add EPUB upload/download support
-- Run this once in the Supabase SQL editor.

-- 1. Add a column on books to track the storage path of the uploaded EPUB.
alter table public.books
  add column if not exists epub_path text,
  add column if not exists epub_size_bytes bigint,
  add column if not exists epub_uploaded_by uuid references auth.users(id) on delete set null,
  add column if not exists epub_uploaded_at timestamptz;

-- 2. Create the private storage bucket for book files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'book-files',
  'book-files',
  false,
  52428800, -- 50 MB cap per file
  array['application/epub+zip', 'application/epub', 'application/octet-stream']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 3. RLS policies on storage.objects for the book-files bucket.
-- Path convention: <club_id>/<book_id>.epub  (first folder = club_id)

drop policy if exists "book-files: members read" on storage.objects;
create policy "book-files: members read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'book-files'
  and (
    select public.is_club_member(((storage.foldername(name))[1])::uuid)
  )
);

drop policy if exists "book-files: members upload" on storage.objects;
create policy "book-files: members upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'book-files'
  and (
    select public.is_club_member(((storage.foldername(name))[1])::uuid)
  )
);

drop policy if exists "book-files: members update" on storage.objects;
create policy "book-files: members update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'book-files'
  and (
    select public.is_club_member(((storage.foldername(name))[1])::uuid)
  )
);

drop policy if exists "book-files: members delete" on storage.objects;
create policy "book-files: members delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'book-files'
  and (
    select public.is_club_member(((storage.foldername(name))[1])::uuid)
  )
);
