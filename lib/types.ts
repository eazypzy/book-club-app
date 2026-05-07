export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
};

export type Club = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
  created_at: string;
};

export type ClubMember = {
  club_id: string;
  user_id: string;
  role: string;
  joined_at: string;
};

export type Book = {
  id: string;
  club_id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  page_count: number | null;
  open_library_id: string | null;
  status: "current" | "finished" | "planned";
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

export type Meeting = {
  id: string;
  club_id: string;
  book_id: string | null;
  title: string;
  scheduled_at: string;
  location: string | null;
  description: string | null;
  page_target: number | null;
  created_at: string;
};

export type ReadingProgress = {
  user_id: string;
  book_id: string;
  current_page: number;
  updated_at: string;
};

export type Discussion = {
  id: string;
  club_id: string;
  book_id: string | null;
  author_id: string;
  chapter_label: string | null;
  body: string;
  has_spoilers: boolean;
  created_at: string;
};
