// Proposal titles for forum lists (the Proposals topic, the feed): a thread made for a proposal is
// titled "<forum> Proposal #<id>" by the forum canister (create_proposal_thread), so the proposal id
// comes from the thread title without a call per row, and the titles come from the SNS governance
// canister in windows of list_proposals (one call per window of up to WINDOW consecutive ids), not
// one get_proposal per thread. Titles are cached for the session; a window is requested once.
// No imports, so node --test can load it (scripts/proposalTitles.test.mjs).

// Ids per list_proposals call: SNS governance returns at most 100, and every proposal comes with its
// summary, so a smaller window keeps a worst-case response well under the query reply limit
export const WINDOW = 50;
// list_proposals calls in flight at once
export const MAX_CONCURRENT = 3;

const THREAD_TITLE_RE = /Proposal #(\d+)\s*$/;

// The proposal id in a proposal thread's title ("Sneed DAO Proposal #888" -> 888), else null
export function proposalIdFromThreadTitle(title) {
    const text = Array.isArray(title) ? title[0] : title;
    if (typeof text !== 'string') return null;
    const m = text.match(THREAD_TITLE_RE);
    if (!m) return null;
    const id = Number(m[1]);
    return Number.isSafeInteger(id) ? id : null;
}

// Groups ids into list_proposals windows: highest first, each window covering ids in (top - size, top]
// -> [{ before: top + 1, limit, ids }]
export function proposalWindows(ids, size = WINDOW) {
    const sorted = [...new Set(ids.map(Number).filter(n => Number.isSafeInteger(n) && n >= 0))]
        .sort((a, b) => b - a);
    const windows = [];
    let i = 0;
    while (i < sorted.length) {
        const top = sorted[i];
        const group = [];
        while (i < sorted.length && sorted[i] > top - size) group.push(sorted[i++]);
        windows.push({ before: top + 1, limit: top - group[group.length - 1] + 1, ids: group });
    }
    return windows;
}

const keyOf = (governanceId, id) => `${governanceId}:${id}`;

// Session cache: key -> title (string), or null when governance has no such proposal
const titles = new Map();
// Keys of windows requested and not yet answered
const pending = new Set();
const listeners = new Set();

export function getCachedProposalTitle(governanceId, id) {
    return titles.get(keyOf(governanceId, id));
}

export function subscribeProposalTitles(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// Requests the titles not cached and not already requested. listProposals(governanceId, before, limit)
// resolves to ProposalData[] (list_proposals' proposals). A failed window is forgotten, so a later
// load may ask again; it is not retried here.
export async function loadProposalTitles(governanceId, ids, listProposals) {
    if (!governanceId || !ids?.length) return;
    const wanted = ids.filter(id => {
        const k = keyOf(governanceId, id);
        return !titles.has(k) && !pending.has(k);
    });
    const windows = proposalWindows(wanted);
    if (!windows.length) return;
    windows.forEach(w => w.ids.forEach(id => pending.add(keyOf(governanceId, id))));

    let next = 0;
    const worker = async () => {
        while (next < windows.length) {
            const w = windows[next++];
            try {
                const proposals = await listProposals(governanceId, w.before, w.limit);
                const found = new Map();
                (proposals || []).forEach(p => {
                    const id = p?.id?.[0]?.id;
                    const title = p?.proposal?.[0]?.title;
                    if (id !== undefined && typeof title === 'string') found.set(Number(id), title);
                });
                w.ids.forEach(id => titles.set(keyOf(governanceId, id), found.get(id) ?? null));
            } catch (e) {
                console.warn('Could not load proposal titles:', e);
            } finally {
                w.ids.forEach(id => pending.delete(keyOf(governanceId, id)));
            }
            listeners.forEach(l => l());
        }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, windows.length) }, worker));
}

// For tests
export function clearProposalTitleCache() {
    titles.clear();
    pending.clear();
}
