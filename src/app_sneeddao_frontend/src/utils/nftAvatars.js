// NFT avatars (sneed_pid_names `nft_avatar`): an account may show an ICRC-7 or EXT NFT that one
// of its principals owns (`nft_avatar_standard`: "ICRC-7", or "EXT" for e.g. Sneed Diamond Club
// cards). The naming canister checks ownership when it is set; here we check it again when it is
// shown (the NFT may have been sold since) and find its picture: ICRC-7 with icrc7_owner_of,
// EXT with bearer(tokenIdentifier) == the owner's default account id. An NFT that changed hands,
// or whose collection does not answer, resolves to null and the account's other avatar shows.
import { anonymousNftAgent, fetchTokenDetails, getNftImage } from './NftUtils';
import { accountId as extAccountId, bearer as extBearer, tokenMetadata as extTokenMetadata } from './ExtUtils';

const TTL_MS = 10 * 60 * 1000;
const CACHE_KEY = 'nft_avatars_v2';
const keyOf = (n) => `${n.standard === 'EXT' ? 'ext:' : ''}${n.collection}:${n.token_id}:${n.owner}`;

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

/// A candid `?NftAvatar` (or a plain one) and its `?nft_avatar_standard` as
/// { collection, token_id, owner, standard } texts, or null. No standard means ICRC-7.
export const nftAvatarRef = (opt, standardOpt = []) => {
    const n = Array.isArray(opt) ? opt[0] : opt;
    if (!n) return null;
    const standard = (Array.isArray(standardOpt) ? standardOpt[0] : standardOpt) === 'EXT' ? 'EXT' : 'ICRC-7';
    return { collection: n.collection.toText(), token_id: n.token_id.toString(), owner: n.owner.toText(), standard };
};

/// EXT: the holder must still be the owner's default account; the card's own picture, else the EXT route.
async function resolveExt(collection, list, agent) {
    const indices = [...new Set(list.map((r) => Number(r.token_id)))].filter((i) => Number.isInteger(i) && i >= 0 && i <= 0xffffffff);
    const holders = new Map();
    await Promise.all(indices.map(async (i) => { try { holders.set(i, await extBearer(collection, i, agent)); } catch { holders.set(i, null); } }));
    const owned = list.filter((r) => { try { return holders.get(Number(r.token_id)) === extAccountId(r.owner); } catch { return false; } });
    let metas = new Map();
    if (owned.length) { try { metas = await extTokenMetadata(collection, [...new Set(owned.map((r) => Number(r.token_id)))], agent); } catch { /* the route below still shows it */ } }
    return new Map(list.map((r) => {
        if (!owned.includes(r)) return [r, null];
        const m = metas.get(Number(r.token_id));
        return [r, m?.image || m?.fallbackImage || null];
    }));
}

/// Resolve NFT avatars: Map<key of each ref, image url | null>. Ownership and pictures are read
/// anonymously from each collection, one batch per collection.
export async function resolveNftAvatars(refs) {
    const out = new Map();
    const todo = new Map(); // collection -> refs
    for (const r of refs) {
        const hit = cache().get(keyOf(r));
        if (hit && Date.now() - hit.at < TTL_MS) { out.set(keyOf(r), hit.url); continue; }
        const group = `${r.standard === 'EXT' ? 'ext:' : ''}${r.collection}`;
        if (!todo.has(group)) todo.set(group, []);
        todo.get(group).push(r);
    }
    if (todo.size === 0) return out;
    const agent = anonymousNftAgent();
    await Promise.allSettled([...todo.entries()].map(async ([group, list]) => {
        const collection = list[0].collection;
        if (group.startsWith('ext:')) {
            let urls = new Map();
            try { urls = await resolveExt(collection, list, agent); } catch { /* the collection did not answer */ }
            for (const r of list) {
                const url = urls.get(r) || null;
                out.set(keyOf(r), url);
                cache().set(keyOf(r), { url, at: Date.now() });
            }
            return;
        }
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
