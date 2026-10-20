// Sneed Hub's service worker. It makes Sneed Hub installable as an app (Add to Home Screen) and
// shows push notifications from Sneed Notifications. It caches nothing on purpose: every page and
// script comes fresh from the asset canister, so a deploy shows up at once, as in the browser.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A push from the Sneed Notifications relay: { title, body, link, tag }.
self.addEventListener('push', (event) => {
    let m = { title: 'Sneed Hub', body: '', link: '/notifications' };
    try { m = { ...m, ...event.data.json() }; } catch { /* a push without data still shows */ }
    event.waitUntil(self.registration.showNotification(m.title, { body: m.body, tag: m.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { link: m.link } }));
});

// Tapping it opens the link in Sneed Hub (an open window if there is one).
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const link = event.notification.data?.link || '/notifications';
    const url = new URL(link, self.location.origin);
    event.waitUntil((async () => {
        const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const same = wins.find((w) => new URL(w.url).origin === url.origin);
        if (same && url.origin === self.location.origin) {
            // navigate() is refused for windows this worker doesn't control (and on some iOS versions):
            // then tell the page where to go, and open a window if even focusing fails
            try { await same.focus(); } catch { return self.clients.openWindow(url.href); }
            try { return await same.navigate(url.href); } catch { same.postMessage({ type: 'sneed-open', url: url.pathname + url.search }); return same; }
        }
        return self.clients.openWindow(url.href);
    })());
});
