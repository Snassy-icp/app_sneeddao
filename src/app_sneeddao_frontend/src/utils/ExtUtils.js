// EXT NFTs (the Toniq / Entrepot standard, e.g. the Sneed Diamond Club): read and send.
// Self-contained (no React, no other app modules) so scripts/ext-check.mjs can run it in node.
//
// EXT identifies a holder by an ICP-style account identifier (hex text of
// crc32 + sha224("\x0Aaccount-id" + principal + subaccount)) and a token by a
// TokenIdentifier: the principal-text encoding of "\x0Atid" + canister bytes + 4-byte
// big-endian token index. Collections differ in which optional methods they answer, so
// every optional read has a fallback: tokens_ext -> tokens, getTokensByIds -> metadata(tid).
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { bigEndianCrc32 } from '@dfinity/utils';
import { sha224 } from '@noble/hashes/sha256';

/// EXT collections every wallet knows about, before the user adds any.
export const KNOWN_EXT_COLLECTIONS = [
    { canisterId: 'gjv36-laaaa-aaaah-adyza-cai', name: 'Sneed Diamond Club', symbol: 'SDC', standard: 'EXT', supply: 1000 },
];
export const EXT_COLLECTIONS_STORAGE_KEY = 'ext_nft_collections';

// ---- Candid (the standard EXT interface, only the methods used here) ----
export const extIdlFactory = ({ IDL }) => {
    const AccountIdentifier = IDL.Text;
    const TokenIdentifier = IDL.Text;
    const TokenIndex = IDL.Nat32;
    const CommonError = IDL.Variant({ InvalidToken: TokenIdentifier, Other: IDL.Text });
    const Metadata = IDL.Variant({
        fungible: IDL.Record({ name: IDL.Text, symbol: IDL.Text, decimals: IDL.Nat8, metadata: IDL.Opt(IDL.Vec(IDL.Nat8)) }),
        nonfungible: IDL.Record({ metadata: IDL.Opt(IDL.Vec(IDL.Nat8)) }),
    });
    const User = IDL.Variant({ address: AccountIdentifier, principal: IDL.Principal });
    const TransferRequest = IDL.Record({
        from: User, to: User, token: TokenIdentifier, amount: IDL.Nat,
        memo: IDL.Vec(IDL.Nat8), notify: IDL.Bool, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    });
    const TransferResponse = IDL.Variant({
        ok: IDL.Nat,
        err: IDL.Variant({
            Unauthorized: AccountIdentifier, InsufficientBalance: IDL.Null, Rejected: IDL.Null,
            InvalidToken: TokenIdentifier, CannotNotify: AccountIdentifier, Other: IDL.Text,
        }),
    });
    return IDL.Service({
        extensions: IDL.Func([], [IDL.Vec(IDL.Text)], ['query']),
        // the listing and the blob differ between marketplaces; only the index is used
        tokens_ext: IDL.Func([AccountIdentifier], [IDL.Variant({ ok: IDL.Vec(IDL.Tuple(TokenIndex, IDL.Opt(IDL.Reserved), IDL.Opt(IDL.Reserved))), err: CommonError })], ['query']),
        tokens: IDL.Func([AccountIdentifier], [IDL.Variant({ ok: IDL.Vec(TokenIndex), err: CommonError })], ['query']),
        getRegistry: IDL.Func([], [IDL.Vec(IDL.Tuple(TokenIndex, AccountIdentifier))], ['query']),
        getTokensByIds: IDL.Func([IDL.Vec(TokenIndex)], [IDL.Vec(IDL.Tuple(TokenIndex, Metadata))], ['query']),
        metadata: IDL.Func([TokenIdentifier], [IDL.Variant({ ok: Metadata, err: CommonError })], ['query']),
        bearer: IDL.Func([TokenIdentifier], [IDL.Variant({ ok: AccountIdentifier, err: CommonError })], ['query']),
        transfer: IDL.Func([TransferRequest], [TransferResponse], []),
    });
};

const actorOf = (canisterId, agent) => Actor.createActor(extIdlFactory, { agent, canisterId });
const isMissingMethod = (e) => /has no (query|update) method|method not found|IC0536|IC0537|no method|did not find method/i.test(String(e?.message || e));
const errText = (err) => { const k = Object.keys(err)[0]; const v = err[k]; return v === null || v === undefined ? k : `${k}: ${v}`; };

/// An anonymous agent on mainnet (or the local replica) for read-only calls.
export function anonymousExtAgent(host) {
    let net; try { net = process.env.DFX_NETWORK; } catch { net = undefined; } // Vite replaces it at build time
    const h = host || (net === 'ic' || net === 'staging' || !net ? 'https://icp0.io' : 'http://localhost:4943');
    return HttpAgent.createSync({ host: h, shouldFetchRootKey: h.startsWith('http://localhost') });
}

// ---- Identifiers ----
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));

/// The ICP-style account identifier (64 hex chars) of a principal and optional 32-byte subaccount.
export function accountId(principal, subaccount = null) {
    const p = (typeof principal === 'string' ? Principal.fromText(principal) : principal).toUint8Array();
    const sub = subaccount && subaccount.length ? Uint8Array.from(subaccount) : new Uint8Array(32);
    if (sub.length !== 32) throw new Error('A subaccount is 32 bytes');
    const digest = sha224(new Uint8Array([0x0a, ...new TextEncoder().encode('account-id'), ...p, ...sub]));
    return toHex(new Uint8Array([...bigEndianCrc32(digest), ...digest]));
}

/// The account id that holds EXT tokens escrowed for a Sneedex offer: Sneedex's principal with the
/// offer's escrow subaccount (Sneedex's getOfferEscrowSubaccount; it also answers the id itself with
/// getOfferEscrowAccountId, which callers should compare with this).
export function escrowAccountId(sneedexPrincipal, subaccount) {
    return accountId(sneedexPrincipal, Uint8Array.from(subaccount || []));
}

/// 64 hex characters whose first 4 bytes are the CRC32 of the other 28.
export function isValidAccountId(text) {
    const t = String(text || '').trim().toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{64}$/.test(t)) return false;
    const bytes = fromHex(t);
    return toHex(bigEndianCrc32(bytes.slice(4))) === t.slice(0, 8);
}

/// The EXT TokenIdentifier of token `index` in `canisterId`.
export function tokenIdentifier(canisterId, index) {
    const c = (typeof canisterId === 'string' ? Principal.fromText(canisterId) : canisterId).toUint8Array();
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i > 0xffffffff) throw new Error(`Not an EXT token index: ${index}`);
    const idx = [(i >>> 24) & 0xff, (i >>> 16) & 0xff, (i >>> 8) & 0xff, i & 0xff];
    return Principal.fromUint8Array(new Uint8Array([0x0a, 0x74, 0x69, 0x64, ...c, ...idx])).toText();
}

/// { canisterId, index } from a TokenIdentifier, or null if it is not one.
export function decodeTokenIdentifier(tid) {
    try {
        const b = Principal.fromText(tid).toUint8Array();
        if (b.length < 9 || b[0] !== 0x0a || b[1] !== 0x74 || b[2] !== 0x69 || b[3] !== 0x64) return null;
        const c = b.slice(4, b.length - 4); const x = b.slice(b.length - 4);
        return { canisterId: Principal.fromUint8Array(c).toText(), index: ((x[0] << 24) | (x[1] << 16) | (x[2] << 8) | x[3]) >>> 0 };
    } catch { return null; }
}

/// The picture route most EXT canisters serve over HTTP.
export const extImageUrl = (canisterId, index, thumbnail = false) => `https://${canisterId}.raw.icp0.io/?tokenid=${tokenIdentifier(canisterId, index)}${thumbnail ? '&type=thumbnail' : ''}`;

// ---- Reads ----

/// The token indices `owner` holds (principal: its default account; or an account id hex).
export async function listTokens(canisterId, owner, agent) {
    const aid = typeof owner === 'string' && isValidAccountId(owner) ? owner.toLowerCase() : accountId(owner);
    const actor = actorOf(canisterId, agent);
    const unwrap = (r, map) => {
        if ('ok' in r) return map(r.ok);
        // EXT answers "no tokens" with an error
        if (r.err.Other !== undefined) return [];
        throw new Error(errText(r.err));
    };
    let ids;
    try { ids = unwrap(await actor.tokens_ext(aid), (v) => v.map((t) => Number(t[0]))); }
    catch (e) {
        if (!isMissingMethod(e) && !/decode|type|subtype|IDL/i.test(String(e?.message || e))) throw e;
        ids = unwrap(await actor.tokens(aid), (v) => v.map(Number));
    }
    return [...new Set(ids)].sort((a, b) => a - b);
}

const registryCache = new Map(); // canisterId -> Promise<[{ index, accountId }]>
/// Every token and its holder's account id, ascending by index (cached for the session).
export function fetchRegistry(canisterId, agent, { refresh = false } = {}) {
    if (refresh || !registryCache.has(canisterId)) {
        const p = actorOf(canisterId, agent).getRegistry().then((r) => r.map(([i, a]) => ({ index: Number(i), accountId: String(a).toLowerCase() })).sort((a, b) => a.index - b.index));
        p.catch(() => registryCache.delete(canisterId));
        registryCache.set(canisterId, p);
    }
    return registryCache.get(canisterId);
}

/// The account id holding a token, or null if the token does not exist.
export async function bearer(canisterId, index, agent) {
    const r = await actorOf(canisterId, agent).bearer(tokenIdentifier(canisterId, index));
    if ('ok' in r) return String(r.ok).toLowerCase();
    if (r.err.InvalidToken !== undefined) return null;
    throw new Error(errText(r.err));
}

const ipfs = (u) => (typeof u === 'string' ? u.replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/') : u);
const isUrl = (u) => typeof u === 'string' && /^(https?:|data:image\/|ipfs:)/i.test(u);
/// A token's metadata blob, read: JSON when it is JSON (name, description, image, url, thumb, attributes), else nothing.
export function parseExtMetadata(canisterId, index, metadata) {
    const out = { name: null, description: null, image: null, thumb: null, attributes: [], json: null, rawBytes: 0 };
    const blob = metadata?.nonfungible?.metadata?.[0] ?? metadata?.fungible?.metadata?.[0] ?? null;
    if (metadata?.fungible) out.name = metadata.fungible.name;
    if (blob && blob.length) {
        out.rawBytes = blob.length;
        try {
            const j = JSON.parse(new TextDecoder().decode(Uint8Array.from(blob)));
            if (j && typeof j === 'object') {
                out.json = j;
                if (j.name) out.name = String(j.name);
                if (j.description) out.description = String(j.description);
                const img = [j.image, j.url, j.image_url].find(isUrl);
                if (img) out.image = ipfs(img);
                const th = [j.thumb, j.thumbnail].find(isUrl);
                if (th) out.thumb = ipfs(th);
                const attrs = Array.isArray(j.attributes) ? j.attributes : Array.isArray(j.traits) ? j.traits : (j.attributes && typeof j.attributes === 'object' ? Object.entries(j.attributes).map(([k, v]) => ({ trait_type: k, value: v })) : []);
                out.attributes = attrs.filter((a) => a && typeof a === 'object').map((a) => ({ trait_type: String(a.trait_type ?? a.name ?? a.key ?? ''), value: a.value === undefined || a.value === null ? '' : String(a.value) })).filter((a) => a.trait_type);
            }
        } catch { /* not JSON: binary metadata, nothing to read */ }
    }
    out.fallbackImage = extImageUrl(canisterId, index);
    out.fallbackThumb = extImageUrl(canisterId, index, true);
    return out;
}

/// One token's parsed metadata through the standard metadata(TokenIdentifier) query.
export async function metadataByTid(canisterId, index, agent) {
    const r = await actorOf(canisterId, agent).metadata(tokenIdentifier(canisterId, index));
    if ('ok' in r) return { ...parseExtMetadata(canisterId, index, r.ok), exists: true };
    if (r.err.InvalidToken !== undefined) return { ...parseExtMetadata(canisterId, index, null), exists: false };
    throw new Error(errText(r.err));
}

const metaCache = new Map(); // `${canister}:${index}` -> parsed metadata (session)
/// Parsed metadata of some tokens: Map(index -> { name, description, image, thumb, attributes, json, fallbackImage, fallbackThumb, exists }).
export async function tokenMetadata(canisterId, indices, agent, { refresh = false } = {}) {
    const want = [...new Set(indices.map(Number))];
    const missing = refresh ? want : want.filter((i) => !metaCache.has(`${canisterId}:${i}`));
    const actor = actorOf(canisterId, agent);
    let byIds = true;
    for (let k = 0; k < missing.length && byIds; k += 100) {
        const batch = missing.slice(k, k + 100);
        try {
            const got = await actor.getTokensByIds(batch);
            const seen = new Set();
            for (const [i, m] of got) { seen.add(Number(i)); metaCache.set(`${canisterId}:${Number(i)}`, { ...parseExtMetadata(canisterId, Number(i), m), exists: true }); }
            for (const i of batch) if (!seen.has(i)) metaCache.set(`${canisterId}:${i}`, { ...parseExtMetadata(canisterId, i, null), exists: false });
        } catch (e) {
            if (!isMissingMethod(e)) throw e;
            byIds = false; // not every EXT canister has it: one metadata(tid) per token instead
        }
    }
    if (!byIds) {
        const rest = missing.filter((i) => refresh || !metaCache.has(`${canisterId}:${i}`));
        for (let k = 0; k < rest.length; k += 10) {
            await Promise.all(rest.slice(k, k + 10).map(async (i) => { metaCache.set(`${canisterId}:${i}`, await metadataByTid(canisterId, i, agent)); }));
        }
    }
    return new Map(want.map((i) => [i, metaCache.get(`${canisterId}:${i}`)]));
}

/// Does the canister speak EXT? (answers extensions(), or bearer() with an EXT result)
export async function isExtCollection(canisterId, agent) {
    const actor = actorOf(canisterId, agent);
    try { const x = await actor.extensions(); if (Array.isArray(x)) return true; } catch { /* try the next */ }
    try { const r = await actor.bearer(tokenIdentifier(canisterId, 0)); return 'ok' in r || 'err' in r; } catch { return false; }
}

export const knownExtCollection = (canisterId) => KNOWN_EXT_COLLECTIONS.find((c) => c.canisterId === canisterId) || null;

/// Collection facts for the add dialog and the browser: { name, symbol, logo, totalSupply, description, standard, standards, isExt }.
export async function fetchExtCollectionInfo(canisterId, agent, { withSupply = true } = {}) {
    const known = knownExtCollection(canisterId);
    let totalSupply = known?.supply !== undefined ? BigInt(known.supply) : null;
    if (withSupply) { try { totalSupply = BigInt((await fetchRegistry(canisterId, agent)).length); } catch { /* keep what we know */ } }
    return {
        canisterId, name: known?.name || `EXT collection ${canisterId.slice(0, 5)}…`, symbol: known?.symbol || 'EXT', logo: null,
        totalSupply, description: null, standard: 'EXT', isExt: true, isIcrc7: false, standards: { ext: true },
    };
}

/// A token shaped like an ICRC-7 token, so the existing card / page helpers read it unchanged:
/// `metadata` holds name, description, image (the card's own, else the EXT image route), thumb and attributes.
export function extTokenView(canisterId, index, meta, ownerAccountId = null) {
    const m = meta || parseExtMetadata(canisterId, index, null);
    const md = [];
    if (m.name) md.push(['name', { Text: m.name }]);
    if (m.description) md.push(['description', { Text: m.description }]);
    md.push(['image', { Text: m.image || m.fallbackImage }]);
    if (m.thumb) md.push(['thumb', { Text: m.thumb }]);
    if (m.attributes?.length) md.push(['attributes', { Array: m.attributes.map((a) => ({ Map: [['trait_type', { Text: a.trait_type }], ['value', { Text: a.value }]] })) }]);
    return {
        tokenId: BigInt(index), index: Number(index), tid: tokenIdentifier(canisterId, index), standard: 'EXT',
        metadata: md, owner: null, ownerAccountId, exists: m.exists !== false,
        fallbackImage: m.image ? m.fallbackImage : null, thumb: m.thumb || m.fallbackThumb,
    };
}

/// The wallet's view of one EXT collection for `principal` (its default account), shaped like loadNftCollection's.
export async function loadExtCollection(canisterId, principal, agent, onProgress = null, { refresh = false } = {}) {
    const progress = (p) => { try { onProgress?.(p); } catch { /* never breaks the load */ } };
    const info = await fetchExtCollectionInfo(canisterId, agent, { withSupply: false });
    const head = { name: info.name, symbol: info.symbol, logo: null };
    progress({ ...head, stage: 'Looking for your tokens…' });
    const me = accountId(principal);
    const indices = await listTokens(canisterId, me, agent);
    progress({ ...head, stage: indices.length ? `Reading ${indices.length} card${indices.length === 1 ? '' : 's'}…` : 'Done', found: indices.length });
    const metas = indices.length ? await tokenMetadata(canisterId, indices, agent, { refresh }) : new Map();
    const nfts = indices.map((i) => extTokenView(canisterId, i, metas.get(i), me));
    return { ...info, nfts, userTokenCount: nfts.length, supportsIcrc37: false, supportsIcrc10: false, collectionApprovals: [], accountId: me };
}

// ---- Send ----

const TRANSFER_ERRORS = {
    Unauthorized: (v) => `Not allowed: the collection says account ${v} may not move this token (you may no longer own it).`,
    InsufficientBalance: () => 'You do not hold this token any more.',
    Rejected: () => 'The collection rejected the transfer.',
    InvalidToken: (v) => `The collection does not know token ${v}.`,
    CannotNotify: (v) => `The recipient ${v} could not be notified.`,
    Other: (v) => `The collection refused: ${v}`,
};

/// Send one EXT NFT from `fromPrincipal`'s default account. `to` is { principal: Principal | text } or { address: account id hex }
/// (e.g. a Sneedex offer's escrow account id).
/// Checks first that the sender's account still holds it; afterwards reads the new holder back.
/// Options: `requireArrival` - throw unless the holder read back is the recipient (a lost answer is
/// resolved by that read: if the token arrived, the call counts as done).
/// Returns { ok: true, newBearer, expectedBearer }; throws with a readable message otherwise.
export async function transferExt(canisterId, index, fromPrincipal, to, agent, { requireArrival = false } = {}) {
    const from = typeof fromPrincipal === 'string' ? Principal.fromText(fromPrincipal) : fromPrincipal;
    let toUser; let expected;
    if (to?.principal !== undefined) {
        const p = typeof to.principal === 'string' ? Principal.fromText(to.principal.trim()) : to.principal;
        if (p.isAnonymous()) throw new Error('Refusing to send to the anonymous principal');
        toUser = { principal: p }; expected = accountId(p);
    } else if (to?.address !== undefined) {
        const a = String(to.address).trim().toLowerCase().replace(/^0x/, '');
        if (!isValidAccountId(a)) throw new Error('That is not a valid account id (64 hex characters with a matching checksum)');
        toUser = { address: a }; expected = a;
    } else throw new Error('No recipient');
    const mine = accountId(from);
    if (expected === mine) throw new Error('That is your own account');
    const holder = await bearer(canisterId, index, agent);
    if (holder !== mine) throw new Error(holder ? `You do not hold this token any more (it is held by account ${holder}).` : 'This token does not exist.');
    let r; let callError = null;
    try {
        r = await actorOf(canisterId, agent).transfer({
            from: { principal: from }, to: toUser, token: tokenIdentifier(canisterId, index),
            amount: 1n, memo: [], notify: false, subaccount: [],
        });
    } catch (e) { callError = e; }
    if (r && 'err' in r) {
        const k = Object.keys(r.err)[0];
        throw new Error((TRANSFER_ERRORS[k] || ((v) => `${k} ${v ?? ''}`))(r.err[k]));
    }
    let newBearer = null;
    try { newBearer = await bearer(canisterId, index, agent); } catch { /* the transfer itself answered ok */ }
    if (callError && newBearer !== expected) throw callError;
    if (requireArrival && newBearer !== expected) {
        throw new Error(`The collection did not confirm the transfer: token ${index} is held by account ${newBearer || 'unknown'}, not by ${expected}.`);
    }
    return { ok: true, newBearer, expectedBearer: expected };
}

// ---- The user's EXT collections (this browser; the built-in ones unless hidden) ----

function readStored() {
    try { const v = JSON.parse(localStorage.getItem(EXT_COLLECTIONS_STORAGE_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => x && typeof x.canisterId === 'string') : []; }
    catch { return []; }
}
function writeStored(list) { try { localStorage.setItem(EXT_COLLECTIONS_STORAGE_KEY, JSON.stringify(list)); } catch { /* storage blocked */ } }

/// [{ canisterId, name, symbol, standard: 'EXT', builtIn }]: the built-in ones first, then the added ones.
export function getExtCollections() {
    const stored = readStored();
    const hidden = new Set(stored.filter((x) => x.hidden).map((x) => x.canisterId));
    const out = KNOWN_EXT_COLLECTIONS.filter((c) => !hidden.has(c.canisterId)).map((c) => ({ ...c, builtIn: true }));
    for (const s of stored) if (!s.hidden && !out.some((c) => c.canisterId === s.canisterId)) out.push({ name: s.name || `EXT collection ${s.canisterId.slice(0, 5)}…`, symbol: 'EXT', ...s, standard: 'EXT', builtIn: false });
    return out;
}
export const isSavedExtCollection = (canisterId) => getExtCollections().some((c) => c.canisterId === canisterId);
/// Every EXT collection this browser knows of (built-in, added, or hidden), to route reads.
export const isKnownExtCollection = (canisterId) => !!knownExtCollection(canisterId) || readStored().some((x) => x.canisterId === canisterId);
export function addExtCollection(canisterId, name = null) {
    const stored = readStored().filter((x) => x.canisterId !== canisterId);
    if (!knownExtCollection(canisterId)) stored.push({ canisterId, standard: 'EXT', ...(name ? { name } : {}) });
    writeStored(stored);
}
export function removeExtCollection(canisterId) {
    const stored = readStored().filter((x) => x.canisterId !== canisterId);
    if (knownExtCollection(canisterId)) stored.push({ canisterId, standard: 'EXT', hidden: true });
    writeStored(stored);
}
