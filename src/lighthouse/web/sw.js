// Cross-origin-isolation service worker.
//
// SharedArrayBuffer (the synchronous-input bridge) requires the page be
// cross-origin isolated, which needs COOP/COEP response headers. Static hosts
// (GitHub Pages, itch.io, S3) often cannot set headers, so this worker
// synthesizes them: it re-fetches each request and returns a response carrying
// the isolation headers. Registration + first-load reload lives in index.html.
// See devdocs/lighthouse.md and devdocs/sandbox.md.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
    const request = event.request;

    // Work around a Chromium devtools quirk that issues only-if-cached requests
    // outside same-origin mode; passing those to fetch() throws.
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
        return;
    }

    event.respondWith(
        fetch(request)
            .then((response) => {
                // Opaque responses (status 0) cannot be re-wrapped; pass through.
                if (response.status === 0) {
                    return response;
                }
                const headers = new Headers(response.headers);
                headers.set("Cross-Origin-Opener-Policy", "same-origin");
                headers.set("Cross-Origin-Embedder-Policy", "require-corp");
                // Lets COEP: require-corp accept every (same-origin) subresource in
                // the bundle without per-file CORP configuration.
                headers.set("Cross-Origin-Resource-Policy", "cross-origin");
                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers,
                });
            })
            .catch((err) => {
                console.error(err);
                throw err;
            })
    );
});
