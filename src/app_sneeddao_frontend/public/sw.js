// Sneed Hub's service worker. It makes Sneed Hub installable as an app (Add to Home Screen) and
// will carry push notifications later. It caches nothing on purpose: every page and script comes
// fresh from the asset canister, so a deploy shows up at once, as in the browser.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
