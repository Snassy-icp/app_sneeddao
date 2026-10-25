// sneed_drive, Sneed Drive phase 0 (spec/sneed_drive_phase0.md): a notes-first drive canister.
// The /drive section (pages/Drive.jsx) is hidden: it shows only for Sneed Hub admins (the
// backend's caller_is_admin, as /admin) who turned the "Sneed Drive (beta)" switch on in this
// browser (localStorage, like the Bitcoin beta switch). The canister enforces access itself.
//
// The canister id comes from the build's environment (CANISTER_ID_SNEED_DRIVE, written by dfx from
// canister_ids.json for the network built for). Where it has none, `driveEnabled` is false and the
// section says so (same rule as SneedMonService).
import { Principal } from '@dfinity/principal';
import { createActor, canisterId as driveEnv } from 'declarations/sneed_drive';

const realCanisterId = (text) => {
    try { const b = Principal.fromText(text).toUint8Array(); return b.length === 10 && b[9] === 1 ? text : null; } catch { return null; }
};
export const driveId = realCanisterId(driveEnv);
export const driveEnabled = Boolean(driveId);

const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';

export const driveActor = (identity) => createActor(driveId, { agentOptions: { host, identity: identity || undefined } });

// the admin feature flag (per browser)
export { DRIVE_FLAG_KEY, driveFlagOn, setDriveFlag } from './driveFlag';

// ---- results and errors ----

export const ROOT = 0n;

/// A DriveError as a sentence.
export function errorText(err) {
    if (!err) return 'Unknown error';
    const [k, v] = Object.entries(err)[0];
    switch (k) {
        case 'not_found': return 'Not found (or not shared with you).';
        case 'forbidden': return 'You do not have access to do that here.';
        case 'not_signed_in': return 'Please sign in.';
        case 'in_trash': return 'This is in the trash. Restore it first.';
        case 'not_in_trash': return 'This is not in the trash.';
        case 'name_taken': return 'That name is taken in this folder.';
        case 'conflict': return 'Someone saved a newer version in the meantime. Reload it before saving.';
        case 'invalid': return v;
        case 'limit': return v;
        default: return k;
    }
}

/// `{ ok } | { err }` as its value, or a thrown Error carrying the DriveError.
export function unwrap(r) {
    if (r && 'err' in r) { const e = new Error(errorText(r.err)); e.drive = r.err; throw e; }
    return r.ok;
}

export const opt = (v) => (v === null || v === undefined ? [] : [v]);
export const fromOpt = (o) => (o && o.length ? o[0] : null);

export const isFolder = (n) => 'folder' in n.kind;
export const isNote = (n) => !isFolder(n) && (n.mime === 'text/markdown' || n.mime.startsWith('text/') || /\.(md|markdown|txt)$/i.test(n.name));
export const accessOf = (n) => Object.keys(n.my_access)[0]; // read | write | manage | owner
export const canWrite = (n) => ['write', 'manage', 'owner'].includes(accessOf(n));
export const canManage = (n) => ['manage', 'owner'].includes(accessOf(n));
export const isOwnerOf = (n) => accessOf(n) === 'owner';

export const nsDate = (ns) => new Date(Number(BigInt(ns) / 1_000_000n));
export const fmtWhen = (ns) => nsDate(ns).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const fmtBytes = (n) => {
    const b = Number(n);
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KiB`;
    if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} MiB`;
    return `${(b / 1024 ** 3).toFixed(2)} GiB`;
};

/// "Untitled.md", "Untitled 2.md", … free among `names` (case-insensitive).
export function freeNoteName(names, base = 'Untitled') {
    const taken = new Set(names.map((n) => n.toLowerCase()));
    for (let i = 1; i < 10_000; i++) {
        const name = `${base}${i === 1 ? '' : ` ${i}`}.md`;
        if (!taken.has(name.toLowerCase())) return name;
    }
    return `${base} ${Date.now()}.md`;
}

/// The title of a note: its first markdown heading, else its file name without the extension.
export const noteTitle = (name) => name.replace(/\.(md|markdown|txt)$/i, '');

/// Comma or space separated tags as the canister keeps them (trimmed, lowercase, unique).
export function parseTags(input) {
    return [...new Set(String(input || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

// ---- paged reads: follow `next` to the end (bounded) ----

/// Every child of a folder (pages of 200, at most `max`).
export async function listAllChildren(actor, folder, max = 5_000) {
    const out = [];
    let after = [];
    while (out.length < max) {
        const page = unwrap(await actor.list_children({ folder, after, limit: 200n }));
        out.push(...page.items);
        if (!page.next.length) break;
        after = page.next;
    }
    return out;
}

/// Search, following the scan cursor until `want` hits or the end (at most `maxCalls` calls).
export async function searchAll(actor, { query = '', tags = [], under = null, kind = null, inContent = true, includeTrash = false }, want = 100, maxCalls = 40) {
    const hits = [];
    let after = [];
    for (let i = 0; i < maxCalls && hits.length < want; i++) {
        const page = unwrap(await actor.search({ query, tags, under: opt(under), kind: kind ? [{ [kind]: null }] : [], in_content: inContent, include_trash: includeTrash, after, limit: BigInt(Math.min(100, want - hits.length)) }));
        hits.push(...page.hits);
        if (!page.next.length) break;
        after = page.next;
    }
    return hits;
}

/// All tags the caller can see with their counts (merging the scan pages).
export async function listAllTags(actor, maxCalls = 40) {
    const counts = new Map();
    let after = [];
    for (let i = 0; i < maxCalls; i++) {
        const page = unwrap(await actor.list_tags({ after }));
        for (const { tag, count } of page.tags) counts.set(tag, (counts.get(tag) || 0n) + count);
        if (!page.next.length) break;
        after = page.next;
    }
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
}

export async function listAllTrash(actor, max = 2_000) {
    const out = [];
    let after = [];
    while (out.length < max) {
        const page = unwrap(await actor.list_trash({ after, limit: 200n }));
        out.push(...page.items);
        if (!page.next.length) break;
        after = page.next;
    }
    return out;
}

export async function listAllShared(actor) {
    const out = [];
    let after = [];
    for (let i = 0; i < 10; i++) {
        const page = unwrap(await actor.list_shared_with_me({ after, limit: 200n }));
        out.push(...page.items);
        if (!page.next.length) break;
        after = page.next;
    }
    return out;
}

export const textContent = (c) => (c.text.length ? c.text[0] : null);
export const ROLES = [
    { key: 'read', label: 'Can read' },
    { key: 'write', label: 'Can edit' },
    { key: 'manage', label: 'Can edit and share' },
];
export const roleLabel = (r) => ROLES.find((x) => x.key === Object.keys(r)[0])?.label || Object.keys(r)[0];
