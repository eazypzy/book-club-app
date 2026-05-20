"use client";

import { useEffect } from "react";

// Registers /sw.js once on mount. Kept intentionally tiny — the SW handles
// its own update lifecycle (skipWaiting + clients.claim) so we don't need
// to wire up "new version available" prompts here. In dev we skip
// registration so Next's HMR isn't intercepted.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => {
        // Registration failure shouldn't break the app — offline support is a
        // nice-to-have; the page already works online without it.
      });
  }, []);
  return null;
}
