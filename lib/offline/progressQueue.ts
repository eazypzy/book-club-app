import type { SupabaseClient } from "@supabase/supabase-js";
import { STORE_QUEUE, tx } from "./idb";

export type QueuedProgress = {
  key: string; // `${user_id}::${book_id}` — collapses repeats for same book
  user_id: string;
  book_id: string;
  progress_pct: number;
  last_location: string;
  current_page: number | null;
  queuedAt: number;
};

function makeKey(user_id: string, book_id: string) {
  return `${user_id}::${book_id}`;
}

export async function enqueueProgress(
  row: Omit<QueuedProgress, "key" | "queuedAt">
): Promise<void> {
  const entry: QueuedProgress = {
    ...row,
    key: makeKey(row.user_id, row.book_id),
    queuedAt: Date.now()
  };
  await tx<IDBValidKey>(STORE_QUEUE, "readwrite", (s) => s.put(entry));
}

export async function queueSize(): Promise<number> {
  try {
    return await tx<number>(STORE_QUEUE, "readonly", (s) => s.count());
  } catch {
    return 0;
  }
}

async function listQueue(): Promise<QueuedProgress[]> {
  return tx<QueuedProgress[]>(STORE_QUEUE, "readonly", (s) => s.getAll());
}

async function deleteQueued(key: string): Promise<void> {
  await tx<undefined>(STORE_QUEUE, "readwrite", (s) => s.delete(key));
}

// Drain the queue, sending each entry to Supabase. Returns the number of
// rows successfully flushed. Stops on first failure so we don't burn through
// the queue against a dead network.
export async function flushQueue(
  supabase: SupabaseClient
): Promise<{ flushed: number; remaining: number }> {
  let entries: QueuedProgress[];
  try {
    entries = await listQueue();
  } catch {
    return { flushed: 0, remaining: 0 };
  }
  let flushed = 0;
  for (const e of entries) {
    const { error } = await supabase.from("reading_progress").upsert(
      {
        user_id: e.user_id,
        book_id: e.book_id,
        progress_pct: e.progress_pct,
        last_location: e.last_location,
        current_page: e.current_page ?? undefined,
        updated_at: new Date(e.queuedAt).toISOString()
      },
      { onConflict: "user_id,book_id" }
    );
    if (error) {
      return { flushed, remaining: entries.length - flushed };
    }
    await deleteQueued(e.key);
    flushed++;
  }
  return { flushed, remaining: 0 };
}
