// Book Club service worker — keeps the app loadable in airplane mode.
//
// Strategy:
//   1. /_next/static/* + icons + manifest → cache-first (immutable, hashed).
//   2. Same-origin HTML navigations → network-first, fall back to last cached
//      copy of that exact URL. So once a page has been visited online, you
//      can reopen it offline.
//   3. Everything else (Supabase API, external covers, fonts) → pass through.
//      Those endpoints handle their own offline behaviour (IndexedDB cache
//      for EPUBs, queued progress writes, etc.).
//
// Bump CACHE_VERSION whenever the SW logic changes so old caches are purged
// on activation.

const CACHE_VERSION = "v1";
const STATIC_CACHE = `bookclub-static-${CACHE_VERSION}`;
const PAGES_CACHE = `bookclub-pages-${CACHE_VERSION}`;

self.addEventListener("install", (event) => {
  // Take over as soon as the new SW is installed — no waiting for tabs to
  // close. Pair with clients.claim() in activate.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== STATIC_CACHE && n !== PAGES_CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

// Helper: is this a navigation request for a same-origin HTML page?
function isHtmlNavigation(request, url) {
  if (request.method !== "GET") return false;
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  return (
    url.origin === self.location.origin && accept.includes("text/html")
  );
}

// Helper: is this a hashed Next.js static asset / icon / manifest?
function isStaticAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/_next/static/")) return true;
  if (url.pathname === "/manifest.webmanifest") return true;
  if (url.pathname === "/icon.png" || url.pathname === "/apple-icon.png") {
    return true;
  }
  // Common static file extensions Next emits to /public.
  return /\.(?:css|js|woff2?|ttf|otf|svg|png|jpg|jpeg|webp|ico)$/.test(
    url.pathname
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never cache POST/PUT/DELETE
  const url = new URL(request.url);

  // Skip /_next/data/* — that's the per-page RSC payload, not safe to cache
  // across deploys (its hash changes), and the HTML response covers it for
  // offline-load purposes.
  if (url.pathname.startsWith("/_next/data/")) return;

  // Supabase / external APIs handle their own offline path. Never intercept.
  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  if (isHtmlNavigation(request, url)) {
    event.respondWith(networkFirstHtml(request));
    return;
  }
  // Default: just pass through. Don't accidentally cache things like POST
  // responses or auth callbacks.
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    // Only cache successful, same-origin, opaque-free responses.
    if (res && res.ok && res.type === "basic") {
      cache.put(request, res.clone());
    }
    return res;
  } catch (e) {
    // No network and nothing cached — bubble up the failure to the page.
    throw e;
  }
}

async function networkFirstHtml(request) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === "basic") {
      // Stash a copy of the rendered HTML so we can serve it next time the
      // user opens this exact URL offline. Strip the search string off the
      // cache key — query params change page state but the shell is the same.
      const url = new URL(request.url);
      const cacheKey = new Request(url.origin + url.pathname, {
        method: "GET",
        headers: request.headers
      });
      cache.put(cacheKey, res.clone());
    }
    return res;
  } catch (e) {
    // Offline. Try the exact URL first, then the path-without-query, then
    // the root as a last-resort landing page.
    const url = new URL(request.url);
    const pathOnly = new Request(url.origin + url.pathname, { method: "GET" });
    const cached =
      (await cache.match(request)) ||
      (await cache.match(pathOnly)) ||
      (await cache.match(new Request(url.origin + "/", { method: "GET" })));
    if (cached) return cached;
    // Truly nothing cached for this URL — return a minimal offline placeholder
    // so the browser doesn't show its default network-error chrome.
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Offline</title>
       <style>body{font-family:system-ui;margin:2rem;color:#1a1a1a;background:#fbf8f1}</style>
       <h1>You're offline</h1>
       <p>This page hasn't been visited yet on this device, so it can't be
       loaded without a network connection. Open the app once on wifi to
       cache it, then it'll work in airplane mode.</p>`,
      { headers: { "content-type": "text/html; charset=utf-8" }, status: 200 }
    );
  }
}

// Allow the page to ask the SW to update itself immediately (used by the
// register-and-reload flow on new deploys).
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
