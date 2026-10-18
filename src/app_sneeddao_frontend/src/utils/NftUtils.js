import { createActor as createIcrc7Actor } from '../../../external/icrc7_ledger';
import { Principal } from '@dfinity/principal';
import { Actor, HttpAgent } from '@dfinity/agent';

// The demo collection's (and the coming launchpad's) minting interface: not part of ICRC-7.
const adminIdl = ({ IDL }) => {
    const Value = IDL.Rec();
    Value.fill(IDL.Variant({ Blob: IDL.Vec(IDL.Nat8), Text: IDL.Text, Nat: IDL.Nat, Int: IDL.Int, Array: IDL.Vec(Value), Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)) }));
    const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
    return IDL.Service({
        get_admins: IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
        mint: IDL.Func([Account, IDL.Vec(IDL.Tuple(IDL.Text, Value))], [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text })], []),
    });
};
/// Admins of a collection that exposes get_admins (our demo); [] for every other implementation.
export async function fetchCollectionAdmins(canisterId, agent) {
    try { return (await Actor.createActor(adminIdl, { agent, canisterId }).get_admins()).map((p) => p.toText()); } catch { return []; }
}
/// Mint on a collection with our demo's interface. `fields`: { name, description, image, attributes: [{ trait_type, value }] }.
export async function mintNft(canisterId, toPrincipalText, fields, agent) {
    const md = [];
    if (fields.name) md.push(['name', { Text: fields.name }]);
    if (fields.description) md.push(['description', { Text: fields.description }]);
    if (fields.image) md.push(['image', { Text: fields.image }]);
    if (fields.attributes?.length) md.push(['attributes', { Array: fields.attributes.filter((a) => a.trait_type).map((a) => ({ Map: [['trait_type', { Text: a.trait_type }], ['value', { Text: String(a.value ?? '') }]] })) }]);
    const r = await Actor.createActor(adminIdl, { agent, canisterId }).mint({ owner: Principal.fromText(toPrincipalText), subaccount: [] }, md);
    if ('Err' in r) throw new Error(r.Err);
    return r.Ok;
}

// ---- ICRC-37 approvals ----
const errOfResult = (r) => { const x = r?.[0]?.[0]; if (!x) throw new Error('no answer'); if ('Err' in x) { const k = Object.keys(x.Err)[0]; const v = x.Err[k]; throw new Error(v && typeof v === 'object' && v.message ? v.message : k); } return x.Ok; };
const nowNs = () => BigInt(Date.now()) * 1_000_000n;
/// Approvals on the user's tokens and on the whole collection; empty when the collection has no ICRC-37.
export async function fetchApprovals(canisterId, account, tokenIds, agent) {
    const actor = createIcrc7Actor(canisterId, { agent });
    const byToken = new Map();
    let collection = [];
    try {
        for (let i = 0; i < tokenIds.length; i += 50) {
            let prev = [];
            for (let page = 0; page < 50; page++) {
                const chunk = await actor.icrc37_get_token_approvals(tokenIds.slice(i, i + 50), prev, [100n]);
                for (const a of chunk) { const k = a.token_id.toString(); if (!byToken.has(k)) byToken.set(k, []); byToken.get(k).push(a.approval_info); }
                if (chunk.length < 100) break;
                prev = [chunk[chunk.length - 1]];
            }
        }
        collection = await actor.icrc37_get_collection_approvals(account, [], [100n]);
    } catch { return { supported: false, byToken, collection: [] }; }
    return { supported: true, byToken, collection };
}
export async function approveToken(canisterId, tokenId, spenderText, expiresAtMs, agent) {
    const actor = createIcrc7Actor(canisterId, { agent });
    const r = await actor.icrc37_approve_tokens([{ token_id: tokenId, approval_info: { spender: { owner: Principal.fromText(spenderText), subaccount: [] }, from_subaccount: [], expires_at: expiresAtMs ? [BigInt(expiresAtMs) * 1_000_000n] : [], memo: [], created_at_time: nowNs() } }]);
    return errOfResult(r);
}
export async function revokeTokenApproval(canisterId, tokenId, spenderText, agent) {
    const actor = createIcrc7Actor(canisterId, { agent });
    const r = await actor.icrc37_revoke_token_approvals([{ spender: spenderText ? [{ owner: Principal.fromText(spenderText), subaccount: [] }] : [], from_subaccount: [], token_id: tokenId, memo: [], created_at_time: [] }]);
    return errOfResult(r);
}
export async function approveCollection(canisterId, spenderText, expiresAtMs, agent) {
    const actor = createIcrc7Actor(canisterId, { agent });
    const r = await actor.icrc37_approve_collection([{ approval_info: { spender: { owner: Principal.fromText(spenderText), subaccount: [] }, from_subaccount: [], expires_at: expiresAtMs ? [BigInt(expiresAtMs) * 1_000_000n] : [], memo: [], created_at_time: nowNs() } }]);
    return errOfResult(r);
}
export async function revokeCollectionApproval(canisterId, spenderText, agent) {
    const actor = createIcrc7Actor(canisterId, { agent });
    const r = await actor.icrc37_revoke_collection_approvals([{ spender: spenderText ? [{ owner: Principal.fromText(spenderText), subaccount: [] }] : [], from_subaccount: [], memo: [], created_at_time: [] }]);
    return errOfResult(r);
}

/// ICRC-97: a token may point at a JSON document (or carry it inline) with name,
/// description, image and attributes. Returns the parsed object or null.
export async function fetchIcrc97(metadata) {
    if (!metadata) return null;
    const entry = metadata.find(([k]) => String(k).toLowerCase() === 'icrc97:metadata');
    if (!entry) return null;
    const v = entry[1];
    const toPlain = (val) => {
        if (val.Text !== undefined) return val.Text; if (val.Nat !== undefined) return val.Nat.toString(); if (val.Int !== undefined) return val.Int.toString();
        if (val.Array !== undefined) return val.Array.map(toPlain); if (val.Map !== undefined) return Object.fromEntries(val.Map.map(([k, x]) => [k, toPlain(x)])); return null;
    };
    if (v.Map !== undefined) return toPlain(v);
    if (v.Text !== undefined) {
        const url = v.Text.replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/');
        try { const r = await fetch(url); if (!r.ok) return { url, error: `HTTP ${r.status}` }; const j = await r.json(); return { url, ...j }; } catch (e) { return { url, error: e?.message || String(e) }; }
    }
    return null;
}
/// Attributes as [{ trait_type, value }], from ICRC-97 JSON or an inline `attributes` entry.
export function getNftAttributes(nft) {
    const out = [];
    const push = (a) => { if (a && typeof a === 'object') { const t = a.trait_type ?? a.name ?? a.key; if (t !== undefined) out.push({ trait_type: String(t), value: a.value !== undefined ? String(a.value) : '' }); } };
    if (Array.isArray(nft?.icrc97?.attributes)) nft.icrc97.attributes.forEach(push);
    const inline = (nft?.metadata || []).find(([k]) => String(k).toLowerCase() === 'attributes');
    if (inline && inline[1].Array !== undefined) {
        for (const v of inline[1].Array) if (v.Map !== undefined) push(Object.fromEntries(v.Map.map(([k, x]) => [k, x.Text ?? (x.Nat !== undefined ? x.Nat.toString() : x.Int !== undefined ? x.Int.toString() : '')])));
    }
    if (inline && inline[1].Map !== undefined) for (const [k, x] of inline[1].Map) out.push({ trait_type: k, value: x.Text ?? (x.Nat !== undefined ? x.Nat.toString() : x.Int !== undefined ? x.Int.toString() : '') });
    return out;
}
/// The NFT's sound, video or 3D model: `animation_url` (the ERC-721 / ICRC-97 metadata key), inline or in its ICRC-97 document.
/// Returns { url, kind: 'audio' | 'video' | 'model' } or null; the kind is read from the file's extension, as marketplaces do.
export function getNftMedia(nft) {
    const inline = (nft?.metadata || []).find(([k]) => String(k).toLowerCase() === 'animation_url');
    let url = inline && inline[1].Text !== undefined ? inline[1].Text : nft?.icrc97?.animation_url;
    if (!url || !/^(https?:|ipfs:)/i.test(url)) return null;
    url = String(url).replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/');
    const ext = (url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    if (['mp3', 'ogg', 'oga', 'wav', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return { url, kind: 'audio' };
    if (['mp4', 'webm', 'ogv', 'mov', 'm4v'].includes(ext)) return { url, kind: 'video' };
    if (['glb', 'gltf'].includes(ext)) return { url, kind: 'model' };
    return null;
}

/// Every URL-looking string in the metadata, so a picture the browser will not show can still be opened.
export function getNftLinks(nft) {
    const links = [];
    const walk = (entries, prefix) => { for (const [k, v] of entries) { const key = prefix ? `${prefix}.${k}` : k; if (v.Text !== undefined && /^(https?:|ipfs:)/i.test(v.Text)) links.push({ key, url: v.Text.replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/') }); if (v.Map !== undefined) walk(v.Map, key); if (v.Array !== undefined) v.Array.forEach((x, i) => { if (x.Map !== undefined) walk(x.Map, `${key}[${i}]`); if (x.Text !== undefined && /^(https?:|ipfs:)/i.test(x.Text)) links.push({ key: `${key}[${i}]`, url: x.Text }); }); } };
    walk(nft?.metadata || [], '');
    if (nft?.icrc97?.image && /^(https?:|ipfs:|data:)/i.test(nft.icrc97.image)) links.push({ key: 'icrc97 image', url: nft.icrc97.image });
    return links;
}

/**
 * Extract image URL from NFT metadata
 * Supports various metadata formats and standards
 */
export function getNftImage(metadata, nft) {
    if (nft?.icrc97?.image && /^(https?:|ipfs:|data:)/i.test(nft.icrc97.image)) return String(nft.icrc97.image).replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/');
    if (!metadata || metadata.length === 0) return null;
    // Collections disagree on where the picture lives: a top-level image/url key, an
    // ICRC-97 metadata map with assets, or a blob. Walk the whole value tree, keys first.
    const imageKeys = ['image', 'icrc7:image', 'url', 'icrc7:url', 'logo', 'icrc7:logo', 'thumbnail', 'asset'];
    const looksLikeUrl = (t) => typeof t === 'string' && (/^(https?:|data:image\/|ipfs:)/i.test(t));
    const blobToDataUrl = (blob) => { try { const bytes = new Uint8Array(blob); let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return `data:image/png;base64,${btoa(bin)}`; } catch { return null; } };
    const visit = (entries, depth) => {
        if (depth > 4) return null;
        for (const [key, value] of entries) {
            const lowerKey = String(key).toLowerCase();
            const keyed = imageKeys.some(k => lowerKey.includes(k));
            if (keyed && value.Text !== undefined && looksLikeUrl(value.Text)) return value.Text.replace(/^ipfs:\/\//, 'https://ipfs.io/ipfs/');
            if (keyed && value.Blob !== undefined) { const u = blobToDataUrl(value.Blob); if (u) return u; }
            if (value.Map !== undefined) { const r = visit(value.Map, depth + 1); if (r) return r; }
            if (value.Array !== undefined) { for (const v of value.Array) { if (v.Map !== undefined) { const r = visit(v.Map, depth + 1); if (r) return r; } if (keyed && v.Text !== undefined && looksLikeUrl(v.Text)) return v.Text; } }
        }
        // second pass: any URL-looking text at all
        for (const [, value] of entries) if (value.Text !== undefined && looksLikeUrl(value.Text) && /\.(png|jpe?g|gif|webp|svg)(\?|$)|^data:image/i.test(value.Text)) return value.Text;
        return null;
    };
    return visit(metadata, 0);
}

/**
 * Extract NFT name from metadata
 */
export function getNftName(metadata, tokenId, nft) {
    if (nft?.icrc97?.name) return String(nft.icrc97.name);
    if (!metadata || metadata.length === 0) return `NFT #${tokenId}`;
    
    const nameKeys = ['name', 'icrc7:name', 'title', 'icrc7:title'];
    
    for (const [key, value] of metadata) {
        const lowerKey = key.toLowerCase();
        
        if (nameKeys.some(k => lowerKey.includes(k))) {
            if (value.Text) return value.Text;
            if (value.Nat !== undefined) return `NFT #${value.Nat}`;
        }
    }
    
    return `NFT #${tokenId}`;
}

/**
 * Extract description from metadata
 */
export function getNftDescription(metadata, nft) {
    if (nft?.icrc97?.description) return String(nft.icrc97.description);
    if (!metadata || metadata.length === 0) return null;
    
    const descKeys = ['description', 'icrc7:description', 'desc'];
    
    for (const [key, value] of metadata) {
        const lowerKey = key.toLowerCase();
        
        if (descKeys.some(k => lowerKey.includes(k))) {
            if (value.Text) return value.Text;
        }
    }
    
    return null;
}

/**
 * Format Value type for display
 */
export function formatValue(value, depth = 0) {
    if (!value) return 'null';

    if (value.Text !== undefined) return value.Text;
    if (value.Nat !== undefined) return value.Nat.toString();
    if (value.Int !== undefined) return value.Int.toString();
    // short blobs (keys, hashes, subaccounts) as hex; long ones by size. Small arrays and maps show what is in them.
    if (value.Blob !== undefined) {
        const b = value.Blob;
        return b.length <= 32 ? Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') : `[Blob: ${b.length} bytes]`;
    }
    if (value.Array !== undefined) {
        if (depth < 2 && value.Array.length <= 8) return `[${value.Array.map((v) => formatValue(v, depth + 1)).join(', ')}]`;
        return `[Array: ${value.Array.length} items]`;
    }
    if (value.Map !== undefined) {
        if (depth < 2 && value.Map.length <= 8) return `{ ${value.Map.map(([k, v]) => `${k}: ${formatValue(v, depth + 1)}`).join(', ')} }`;
        return `[Map: ${value.Map.length} entries]`;
    }

    return JSON.stringify(value, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/**
 * Format metadata for display
 */
export function formatNftMetadata(metadata) {
    if (!metadata || metadata.length === 0) return [];
    
    return metadata.map(([key, value]) => ({
        key,
        value: formatValue(value),
        rawValue: value
    }));
}

/**
 * Load NFT collection data
 */
export const NFT_COLLECTIONS_STORAGE_KEY = 'nft_collections';

/// The collection canister ids the user added to the NFT wallet (kept in this browser).
export function getSavedNftCollections() {
    try { const v = JSON.parse(localStorage.getItem(NFT_COLLECTIONS_STORAGE_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }
    catch { return []; }
}

/// `onProgress({ stage, name?, symbol?, logo?, found?, total? })` reports the loading steps so a page can show them as they happen.
export async function loadNftCollection(canisterId, account, identity, agent, onProgress = null) {
    const progress = (p) => { try { onProgress?.(p); } catch { /* a progress listener never breaks the load */ } };
    try {
        const actor = createIcrc7Actor(canisterId, { agent });
        progress({ stage: 'Reading collection info…' });
        
        // Fetch collection metadata
        const [name, symbol, logo, totalSupply, description] = await Promise.all([
            actor.icrc7_name(),
            actor.icrc7_symbol(),
            actor.icrc7_logo(),
            actor.icrc7_total_supply(),
            actor.icrc7_description().catch(() => [])
        ]);
        
        // Fetch user's NFTs from this collection, page by page (ICRC-7 pages by the last id seen)
        const maxTake = Number((await actor.icrc7_max_take_value().catch(() => []))?.[0] ?? 100n) || 100;
        const take = BigInt(Math.min(maxTake, 200));
        const head = { name, symbol, logo: logo.length > 0 ? logo[0] : null, totalSupply };
        progress({ ...head, stage: 'Looking for your tokens…' });
        const tokenIds = [];
        let prev = [];
        for (let page = 0; page < 200; page++) {
            const chunk = await actor.icrc7_tokens_of(account, prev, [take]);
            if (chunk.length === 0) break;
            for (const id of chunk) if (!tokenIds.some((x) => x === id)) tokenIds.push(id);
            progress({ ...head, stage: `Found ${tokenIds.length} of yours…`, found: tokenIds.length });
            if (BigInt(chunk.length) < take) break; // a short page is the last page
            // the spec pages by the last id of an ascending page; use the largest id in case the ledger did not sort
            prev = [chunk.reduce((m, x) => (x > m ? x : m), chunk[0])];
        }
        
        // Fetch metadata for user's tokens (in batches to avoid limits)
        const batchSize = 50;
        const allMetadata = [];
        
        for (let i = 0; i < tokenIds.length; i += batchSize) {
            progress({ ...head, stage: `Reading metadata ${Math.min(i + batchSize, tokenIds.length)} / ${tokenIds.length}…`, found: tokenIds.length });
            const batch = tokenIds.slice(i, i + batchSize);
            const metadataBatch = await actor.icrc7_token_metadata(batch);
            allMetadata.push(...metadataBatch);
        }
        
        // Combine token data, then enrich from ICRC-97 documents where the token points at one
        const nfts = tokenIds.map((tokenId, index) => ({
            tokenId,
            metadata: allMetadata[index] && allMetadata[index].length > 0 ? allMetadata[index][0] : [],
            collectionName: name,
            collectionSymbol: symbol
        }));
        progress({ ...head, stage: tokenIds.length ? 'Fetching token documents…' : 'Checking standards…', found: tokenIds.length });
        await Promise.allSettled(nfts.map(async (n) => { const j = await fetchIcrc97(n.metadata); if (j) n.icrc97 = j; }));
        const std = await detectStandards(canisterId, agent);
        if (std.icrc37) progress({ ...head, stage: 'Reading approvals…', found: tokenIds.length });
        const supportsIcrc37 = std.icrc37;
        let approvals = { supported: false, byToken: new Map(), collection: [] };
        if (supportsIcrc37) approvals = await fetchApprovals(canisterId, account, tokenIds, agent);
        for (const n of nfts) n.approvals = approvals.byToken.get(n.tokenId.toString()) || [];
        
        return {
            canisterId,
            name,
            symbol,
            logo: logo.length > 0 ? logo[0] : null,
            totalSupply,
            description: description.length > 0 ? description[0] : null,
            nfts,
            userTokenCount: tokenIds.length,
            supportsIcrc37,
            supportsIcrc10: std.icrc10,
            collectionApprovals: approvals.collection
        };
    } catch (error) {
        console.error(`Error loading NFT collection ${canisterId}:`, error);
        throw error;
    }
}

// ---- Browsing a collection without owning anything in it ----

/// An anonymous agent for read-only browsing (the NFT browser works logged out).
export function anonymousNftAgent() {
    const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943';
    return HttpAgent.createSync({ host });
}

/// One page of a collection's token ids (ICRC-7 pages ascending by the last id seen).
export async function fetchCollectionTokenIds(canisterId, agent, prevId = null, take = 100) {
    const actor = createIcrc7Actor(canisterId, { agent });
    const maxTake = Number((await actor.icrc7_max_take_value().catch(() => []))?.[0] ?? 100n) || 100;
    const n = BigInt(Math.min(maxTake, take));
    const chunk = await actor.icrc7_tokens(prevId === null ? [] : [BigInt(prevId)], [n]);
    const ids = [...chunk];
    const last = ids.length ? ids.reduce((m, x) => (x > m ? x : m), ids[0]) : null; // largest, in case the ledger did not sort
    return { ids, last, done: BigInt(ids.length) < n };
}

/// Full detail of some tokens: metadata, ICRC-97 document, owner. Returns [{ tokenId, metadata, icrc97, owner }].
export async function fetchTokenDetails(canisterId, tokenIds, agent, { withOwner = true, withIcrc97 = true } = {}) {
    const actor = createIcrc7Actor(canisterId, { agent });
    const ids = tokenIds.map((x) => BigInt(x));
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const [metas, owners] = await Promise.all([
            actor.icrc7_token_metadata(batch),
            withOwner ? actor.icrc7_owner_of(batch).catch(() => batch.map(() => [])) : Promise.resolve(batch.map(() => [])),
        ]);
        batch.forEach((tokenId, j) => {
            const m = metas[j]; const o = owners[j];
            out.push({ tokenId, metadata: m && m.length ? m[0] : [], owner: o && o.length ? o[0] : null, exists: !!(m && m.length) });
        });
    }
    if (withIcrc97) await Promise.allSettled(out.map(async (n) => { const j = await fetchIcrc97(n.metadata); if (j) n.icrc97 = j; }));
    return out;
}

/// The owner account of one token, or null if it does not exist (or the collection does not answer).
export async function fetchTokenOwner(canisterId, tokenId, agent) {
    const actor = createIcrc7Actor(canisterId, { agent });
    const r = await actor.icrc7_owner_of([BigInt(tokenId)]);
    const o = r[0];
    return o && o.length ? o[0] : null;
}

/**
 * Transfer NFT
 */
export async function transferNft(canisterId, tokenId, toAccount, fromSubaccount, memo, identity, agent) {
    try {
        const actor = createIcrc7Actor(canisterId, { agent });
        
        const transferArg = {
            from_subaccount: fromSubaccount ? [fromSubaccount] : [],
            to: toAccount,
            token_id: tokenId,
            memo: memo ? [memo] : [],
            created_at_time: [BigInt(Date.now() * 1000000)] // current time in nanoseconds
        };
        
        const result = await actor.icrc7_transfer([transferArg]);
        
        if (result.length === 0) {
            throw new Error('No response from transfer');
        }
        
        const transferResult = result[0];
        
        if (!transferResult || transferResult.length === 0) {
            throw new Error('Transfer not processed');
        }
        
        const response = transferResult[0];
        
        if (response.Ok !== undefined) {
            return { success: true, transactionIndex: response.Ok };
        } else if (response.Err) {
            let errorMsg = 'Transfer failed';
            
            if (response.Err.NonExistingTokenId !== undefined) {
                errorMsg = 'Token does not exist';
            } else if (response.Err.InvalidRecipient !== undefined) {
                errorMsg = 'Invalid recipient';
            } else if (response.Err.Unauthorized !== undefined) {
                errorMsg = 'Unauthorized - you do not own this NFT';
            } else if (response.Err.TooOld !== undefined) {
                errorMsg = 'Transaction too old';
            } else if (response.Err.CreatedInFuture) {
                errorMsg = 'Transaction created in future';
            } else if (response.Err.Duplicate) {
                errorMsg = `Duplicate transaction (${response.Err.Duplicate.duplicate_of})`;
            } else if (response.Err.GenericError) {
                errorMsg = response.Err.GenericError.message;
            } else if (response.Err.GenericBatchError) {
                errorMsg = response.Err.GenericBatchError.message;
            }
            
            throw new Error(errorMsg);
        }
        
        throw new Error('Unknown transfer result');
    } catch (error) {
        console.error('Error transferring NFT:', error);
        throw error;
    }
}

/**
 * Verify if a canister implements ICRC-7
 */
/// ICRC-7 asks ledgers to announce themselves through icrc10_supported_standards, but
/// collections exist that answer every ICRC-7 query and lack that one method. So: the
/// announcement when it is there, otherwise the queries themselves.
export async function verifyIcrc7Support(canisterId, agent) {
    const actor = createIcrc7Actor(canisterId, { agent });
    try {
        const standards = await actor.icrc10_supported_standards();
        if (standards.some(s => s.name === 'ICRC-7')) return true;
    } catch { /* no ICRC-10: fall through to the queries */ }
    try {
        await Promise.all([actor.icrc7_name(), actor.icrc7_total_supply(), actor.icrc7_tokens([], [1n])]);
        return true;
    } catch (error) {
        console.error('Error verifying ICRC-7 support:', error);
        return false;
    }
}
/// Which standards a collection speaks, announced or probed: { icrc7, icrc37, icrc10 }.
export async function detectStandards(canisterId, agent) {
    const actor = createIcrc7Actor(canisterId, { agent });
    let announced = null;
    try { announced = (await actor.icrc10_supported_standards()).map(s => s.name); } catch { announced = null; }
    if (announced) return { icrc10: true, icrc7: announced.includes('ICRC-7'), icrc37: announced.includes('ICRC-37'), announced };
    const icrc7 = await verifyIcrc7Support(canisterId, agent);
    let icrc37 = false;
    try { await actor.icrc37_max_approvals_per_token_or_collection(); icrc37 = true; } catch { icrc37 = false; }
    return { icrc10: false, icrc7, icrc37, announced: [] };
}

/**
 * Fetch basic collection info (for preview when adding)
 */
export async function fetchCollectionInfo(canisterId, agent) {
    try {
        const actor = createIcrc7Actor(canisterId, { agent });
        
        const [name, symbol, logo, totalSupply, description, std] = await Promise.all([
            actor.icrc7_name().catch(() => 'Unknown'),
            actor.icrc7_symbol().catch(() => '???'),
            actor.icrc7_logo().catch(() => []),
            actor.icrc7_total_supply().catch(() => 0n),
            actor.icrc7_description().catch(() => []),
            detectStandards(canisterId, agent)
        ]);
        
        return {
            name,
            symbol,
            logo: logo.length > 0 ? logo[0] : null,
            totalSupply,
            description: description.length > 0 ? description[0] : null,
            isIcrc7: std.icrc7,
            standards: std
        };
    } catch (error) {
        console.error('Error fetching collection info:', error);
        throw error;
    }
}

