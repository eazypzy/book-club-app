import { STORE_BOOKS, tx } from "./idb";

type CachedBook = {
  path: string;
  bytes: ArrayBuffer;
  updatedAt: number;
};

export async function getCachedBook(path: string): Promise<ArrayBuffer | null> {
  try {
    const row = await tx<CachedBook | undefined>(STORE_BOOKS, "readonly", (s) =>
      s.get(path)
    );
    return row?.bytes ?? null;
  } catch {
    return null;
  }
}

export async function putCachedBook(
  path: string,
  bytes: ArrayBuffer
): Promise<void> {
  try {
    await tx<IDBValidKey>(STORE_BOOKS, "readwrite", (s) =>
      s.put({ path, bytes, updatedAt: Date.now() })
    );
  } catch {
    // Quota or other IDB errors — caching is best-effort, swallow.
  }
}
