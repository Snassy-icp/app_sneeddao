// NFT avatars (sneed_pid_names `nft_avatar`): an account may show an ICRC-7 NFT that one of its
// principals owns. The naming canister checks ownership when it is set; here we check it again
// when it is shown (the NFT may have been sold since) and find its picture. An NFT that changed
// hands, or whose collection does not answer, resolves to null and the account's other avatar
// shows instead.
import { anonymousNftAgent, fetchTokenDetails, getNftImage } from './NftUtils';

const TTL_MS = 10 * 60 * 1000;
const CACHE_KEY = 'nft_avatars_v1';
const keyOf = (n) => `${n.collection}:${n.token_id}:${n.owner}`;

let memo = null; // Map<key, { url, at }>
const cache = () => {
    if (memo) return memo;
    memo = new Map();
    try {
        for (const [k, v] of JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')) if (Date.now() - v.at < TTL_MS) memo.set(k, v);
    } catch { /* an unreadable cache is just empty */ }
    return memo;
};
const persist = () => {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify([...cache().entries()].filter(([, v]) => !v.url || v.url.length < 2048))); } catch { /* storage full or blocked */ }
};

/// A candid `?NftAvatar` (or a plain one) as { collection, token_id, owner } texts, or null.
export const nftAvatarRef = (opt) => {
    const n = Array.isArray(opt) ? opt[0] : opt;
    if (!n) return null;
    return { collection: n.collection.toText(), token_id: n.token_id.toString(), owner: n.owner.toText() };
};

/// Resolve NFT avatars: Map<key of each ref, image url | null>. Ownership and pictures are read
/// anonymously from each collection, one batch per collection.
export async function resolveNftAvatars(refs) {
    const out = new Map();
    const todo = new Map(); // collection -> refs
    for (const r of refs) {
        const hit = cache().get(keyOf(r));
        if (hit && Date.now() - hit.at < TTL_MS) { out.set(keyOf(r), hit.url); continue; }
        if (!todo.has(r.collection)) todo.set(r.collection, []);
        todo.get(r.collection).push(r);
    }
    if (todo.size === 0) return out;
    const agent = anonymousNftAgent();
    await Promise.allSettled([...todo.entries()].map(async ([collection, list]) => {
        let details = [];
        try {
            details = await fetchTokenDetails(collection, [...new Set(list.map((r) => r.token_id))], agent, { withOwner: true, withIcrc97: true });
        } catch { /* the collection did not answer: no NFT avatar for now */ }
        for (const r of list) {
            const d = details.find((x) => x.tokenId.toString() === r.token_id);
            const owned = d?.owner && d.owner.owner.toText() === r.owner;
            const url = owned ? getNftImage(d.metadata, d) : null;
            out.set(keyOf(r), url || null);
            cache().set(keyOf(r), { url: url || null, at: Date.now() });
        }
    }));
    persist();
    return out;
}

export const nftAvatarKey = keyOf;

/// Forget what we resolved (after the user picked or dropped an NFT avatar).
export const forgetNftAvatars = () => { memo = new Map(); try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ } };
