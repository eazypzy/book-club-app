// Client-side EPUB inspection — pulls title, author, page count (via the
// epub.js locations index) and a cover image (as a data URL we can stash in
// the books.cover_url text column without a public bucket).

export type EpubMetadata = {
  title: string | null;
  author: string | null;
  pageCount: number | null;
  coverDataUrl: string | null;
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function parseEpubMetadata(
  source: File | ArrayBuffer
): Promise<EpubMetadata> {
  const buf = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const ePub = (await import("epubjs")).default;
  const book: any = ePub(buf);

  let title: string | null = null;
  let author: string | null = null;
  let pageCount: number | null = null;
  let coverDataUrl: string | null = null;

  try {
    await book.ready;

    try {
      const meta = await book.loaded.metadata;
      const t = (meta?.title ?? "").toString().trim();
      const a = (meta?.creator ?? "").toString().trim();
      if (t) title = t;
      if (a) author = a;
    } catch {}

    try {
      await book.locations.generate(1600);
      const n = book.locations.length();
      if (typeof n === "number" && n > 0) pageCount = n;
    } catch {}

    try {
      const coverUrl: string | null = await book.coverUrl();
      if (coverUrl) {
        const res = await fetch(coverUrl);
        if (res.ok) {
          const blob = await res.blob();
          // Keep covers small enough to live in a row. Most EPUB covers are
          // already <200KB; we skip caching anything absurd.
          if (blob.size <= 500 * 1024) {
            coverDataUrl = await blobToDataUrl(blob);
          }
        }
      }
    } catch {}
  } finally {
    try {
      book.destroy?.();
    } catch {}
  }

  return { title, author, pageCount, coverDataUrl };
}
