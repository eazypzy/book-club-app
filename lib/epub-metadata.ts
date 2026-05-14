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

// epub.js's book.coverUrl() resolves to null for any EPUB whose cover isn't
// tagged the way it expects (very common). This walks the OPF manifest as a
// fallback and pulls the image out via the archive.
async function extractCoverBlob(book: any): Promise<Blob | null> {
  try {
    const url: string | null = await book.coverUrl();
    if (url) {
      const res = await fetch(url);
      if (res.ok) return await res.blob();
    }
  } catch {}

  try {
    const manifest = book.packaging?.manifest;
    if (!manifest) return null;
    const items = Object.values(manifest) as any[];
    const item =
      items.find((i: any) => i?.properties?.includes?.("cover-image")) ??
      items.find(
        (i: any) =>
          typeof i?.id === "string" &&
          i.id.toLowerCase().includes("cover") &&
          typeof i?.type === "string" &&
          i.type.startsWith("image/")
      ) ??
      items.find(
        (i: any) =>
          typeof i?.type === "string" && i.type.startsWith("image/")
      );
    if (!item?.href) return null;
    const archive: any = book.archive;
    if (archive?.createUrl) {
      const url = await archive.createUrl(item.href);
      const res = await fetch(url);
      if (res.ok) return await res.blob();
    }
    if (typeof archive?.getBlob === "function") {
      const blob = await archive.getBlob(item.href);
      if (blob) return blob as Blob;
    }
  } catch {}

  return null;
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
      const blob = await extractCoverBlob(book);
      // Cap at 2 MB so the cover_url row stays reasonable. Most EPUB covers
      // are well under that; anything bigger we just skip.
      if (blob && blob.size <= 2 * 1024 * 1024) {
        coverDataUrl = await blobToDataUrl(blob);
      }
    } catch {}
  } finally {
    try {
      book.destroy?.();
    } catch {}
  }

  return { title, author, pageCount, coverDataUrl };
}
