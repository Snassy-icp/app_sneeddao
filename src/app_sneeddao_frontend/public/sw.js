// Sneed Hub's service worker. It makes Sneed Hub installable as an app (Add to Home Screen) and
// shows push notifications from Sneed Notifications. It caches nothing on purpose: every page and
// script comes fresh from the asset canister, so a deploy shows up at once, as in the browser.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const PUSH_CACHE = 'sneed-push';
const LAST_CODE = '/__sneed/last-code';

// A push from the Sneed Notifications relay: { title, body, link, tag }.
self.addEventListener('push', (event) => {
    let m = { title: 'Sneed Hub', body: '', link: '/notifications' };
    try { m = { ...m, ...event.data.json() }; } catch { /* a push without data still shows */ }
    // a verification code is also kept on this device, so Sneed Hub can show it however it is opened
    // (tapping a notification only dismisses it on some phones); it proves the push reached this device
    const code = /^Your code: (\d{6})$/.exec(m.title || '')?.[1];
    const keep = code ? caches.open(PUSH_CACHE).then((c) => c.put(LAST_CODE, new Response(JSON.stringify({ code, at: Date.now() })))).catch(() => {}) : Promise.resolve();
    event.waitUntil(Promise.all([keep, self.registration.showNotification(m.title, { body: m.body, tag: m.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { link: m.link } })]));
});

// Tapping it opens the link in Sneed Hub (an open window if there is one).
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const link = event.notification.data?.link || '/notifications';
    const url = new URL(link, self.location.origin);
    event.waitUntil((async () => {
        const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const same = url.origin === self.location.origin ? wins.find((w) => new URL(w.url).origin === url.origin) : null;
        // 1. an open window this worker controls: take it there
        if (same) {
            try { const w = await same.navigate(url.href); if (w) { try { await w.focus(); } catch { /* already in front */ } return w; } } catch { /* not controlled, or iOS */ }
        }
        // 2. open the page (on iOS this brings the installed app forward at that page, even when a
        //    suspended window is around that would ignore focus/navigate)
        try { const w = await self.clients.openWindow(url.href); if (w) return w; } catch { /* refused */ }
        // 3. last resort: bring the window forward and ask the page to go there itself
        if (same) { try { await same.focus(); } catch { /* ignore */ } same.postMessage({ type: 'sneed-open', url: url.pathname + url.search }); return same; }
        return null;
    })());
});
