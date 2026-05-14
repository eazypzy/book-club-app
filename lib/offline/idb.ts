// Tiny IndexedDB helper — one DB, two object stores: book bytes + progress queue.
// Keeps offline code dependency-free.

const DB_NAME = "bookclub-offline";
const DB_VERSION = 1;
export const STORE_BOOKS = "books";
export const STORE_QUEUE = "progress_queue";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: "path" });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        // Keyed by `${user_id}::${book_id}` so a newer write overwrites an
        // older queued one for the same book.
        db.createObjectStore(STORE_QUEUE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | Promise<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const result = fn(s);
        if (result instanceof Promise) {
          result.then(resolve, reject);
          return;
        }
        result.onsuccess = () => resolve(result.result as T);
        result.onerror = () => reject(result.error);
      })
  );
}
