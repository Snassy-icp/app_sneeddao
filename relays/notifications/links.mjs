// Where a relayed notification links to (pure, so links.test.mjs can check it without keys or network).

// Hosts whose links are Sneed Hub pages. Senders write prod links (Sneed SMS: https://app.sneeddao.com/msg/<id>);
// the relay moves them onto the Sneed Hub it serves, so the staging relay opens staging.
const HUB_HOSTS = ['app.sneeddao.com'];

/// The job's link as a page of `hub`, or null when it is not a Sneed Hub link (off-site, or not a URL).
export function hubLink(link, hub) {
    let u;
    try { u = new URL(String(link || '')); } catch { return null; }
    const hubUrl = new URL(hub);
    if (u.protocol !== 'https:' && u.origin !== hubUrl.origin) return null;
    if (!HUB_HOSTS.includes(u.hostname) && u.host !== hubUrl.host) return null;
    return `${hubUrl.origin}${u.pathname}${u.search}${u.hash}`;
}

// The notification's own page in Sneed Hub (the full message, its link as a button, where it was
// delivered). A relay job carries no notification id, so the page finds it in the user's history by
// its time and a hash of its title (src/app_sneeddao_frontend/src/utils/notificationInbox.js, titleHash).
export function titleHash(text) {
    let h = 0x811c9dc5;
    for (const b of Buffer.from(String(text || ''), 'utf8')) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
}
// Link to the single-notification page only where that frontend has it (notificationPages);
// otherwise to /notifications, which every deployed frontend has.
export const notificationPage = (job, hub, notificationPages) => (notificationPages ? `${hub}/notifications/push?t=${String(job.created_at)}&h=${titleHash(job.title)}` : `${hub}/notifications`);

/// What tapping a push opens: the job's own link when it is a Sneed Hub page (a new Sneed SMS opens
/// the message), else the notification's page. A push never opens an off-site link straight away;
/// that link is a button on the notification's page.
export const pushLink = (job, hub, notificationPages) => hubLink(job.link?.[0], hub) || notificationPage(job, hub, notificationPages);

/// The job's link as shown in a Discord message: a Sneed Hub link on `hub`, any other link as sent.
export const shownLink = (job, hub) => (job.link?.[0] ? hubLink(job.link[0], hub) || job.link[0] : null);
