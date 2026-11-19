/*
 * Long-term caching for the site (Site settings > General > Keep files on
 * visitors' devices). GitHub Pages lets browsers keep files for 10 minutes
 * only; this keeps them on the device so repeat visits load from it.
 *
 *  - Files whose address changes when they change (?v=<hash> on CSS/JS,
 *    fonts, versioned libraries) are kept as they are, for good.
 *  - Images show at once from the device and are refreshed in the background.
 *  - Pages are always checked with the site (revalidated), so a published
 *    edit shows at once;
 *    the saved copy is used only when offline.
 *  - The CMS (/admin/, /__cms/) is never touched.
 *
 * Bump VERSION to drop everything kept by an older version.
 */
const VERSION = "1";
const CACHE = "site-" + VERSION;
const MAX_ITEMS = 400;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

const scope = new URL(self.registration.scope);
const local = (url) => url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
const path = (url) => "/" + url.pathname.slice(scope.pathname.length);

function kindOf(request) {
  const url = new URL(request.url);
  if (request.method !== "GET") return null;
  if (local(url)) {
    const p = path(url);
    if (/^\/(admin|__cms)(\/|$)/.test(p)) return null;
    // Video is streamed in byte ranges; Safari refuses media that comes through a service worker.
    if (request.headers.has("range") || /\.(mp4|webm|mov|m4v)$/i.test(p)) return null;
    if (request.mode === "navigate") return "page";
    if (/[?&]v=[0-9a-f]{8,}/.test(url.search) || /^\/assets\/fonts\//.test(p) || /^\/assets\/js\/lenis-[\d.]+\.min\.js$/.test(p)) return "forever";
    if (/^\/assets\/(img|responsive|uploads)\//.test(p)) return "fresh";
    return null;
  }
  // Libraries at a fixed version never change.
  if (/^https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/.+@\d/.test(url.href)) return "forever";
  if (/^https:\/\/prod\.spline\.design\//.test(url.href)) return "fresh";
  return null;
}

async function keep(request, response) {
  if (!response || !response.ok) return; // never opaque responses: they count as ~7 MB each
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ITEMS; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const kind = kindOf(event.request);
  if (!kind) return;
  const { request } = event;

  if (kind === "page") {
    event.respondWith((async () => {
      try {
        // Ask the server every time ("no-cache" revalidates, a cheap 304 when
        // unchanged), so a published edit shows at once rather than after the
        // host's 10-minute browser cache.
        const response = await fetch(request, { cache: "no-cache" });
        event.waitUntil(keep(request, response.clone()));
        return response;
      } catch (err) {
        return (await caches.match(request)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const fromNetwork = () => fetch(request).then((response) => { event.waitUntil(keep(request, response.clone())); return response; });
    if (cached) {
      if (kind === "fresh") event.waitUntil(fromNetwork().catch(() => {}));
      return cached;
    }
    return fromNetwork();
  })());
});
