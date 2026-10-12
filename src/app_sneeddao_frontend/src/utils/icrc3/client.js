// Generic ICRC-3 client: talks to any canister that implements the standard
// block log interface, follows archive callbacks, verifies the certified tip
// and hashes blocks the way the standard prescribes.
import { Actor, HttpAgent, Certificate, Cbor, reconstruct, lookup_path, lookupResultToBuffer } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';
import { sha256 } from '@noble/hashes/sha256';

export const HOST = 'https://icp-api.io';

// ---- Candid ----

export const Value = IDL.Rec();
Value.fill(IDL.Variant({
    Blob: IDL.Vec(IDL.Nat8), Text: IDL.Text, Nat: IDL.Nat, Int: IDL.Int,
    Array: IDL.Vec(Value), Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)),
}));
export const GetBlocksArgs = IDL.Vec(IDL.Record({ start: IDL.Nat, length: IDL.Nat }));
export const GetBlocksResult = IDL.Rec();
GetBlocksResult.fill(IDL.Record({
    log_length: IDL.Nat,
    blocks: IDL.Vec(IDL.Record({ id: IDL.Nat, block: Value })),
    archived_blocks: IDL.Vec(IDL.Record({ args: GetBlocksArgs, callback: IDL.Func([GetBlocksArgs], [GetBlocksResult], ['query']) })),
}));

const MetadataValue = IDL.Variant({ Nat: IDL.Nat, Int: IDL.Int, Text: IDL.Text, Blob: IDL.Vec(IDL.Nat8) });

export const icrc3IdlFactory = ({ IDL }) => IDL.Service({
    icrc3_get_blocks: IDL.Func([GetBlocksArgs], [GetBlocksResult], ['query']),
    icrc3_get_archives: IDL.Func([IDL.Record({ from: IDL.Opt(IDL.Principal) })], [IDL.Vec(IDL.Record({ canister_id: IDL.Principal, start: IDL.Nat, end: IDL.Nat }))], ['query']),
    icrc3_get_tip_certificate: IDL.Func([], [IDL.Opt(IDL.Record({ certificate: IDL.Vec(IDL.Nat8), hash_tree: IDL.Vec(IDL.Nat8) }))], ['query']),
    icrc3_supported_block_types: IDL.Func([], [IDL.Vec(IDL.Record({ block_type: IDL.Text, url: IDL.Text }))], ['query']),
    icrc10_supported_standards: IDL.Func([], [IDL.Vec(IDL.Record({ name: IDL.Text, url: IDL.Text }))], ['query']),
    icrc1_supported_standards: IDL.Func([], [IDL.Vec(IDL.Record({ name: IDL.Text, url: IDL.Text }))], ['query']),
    icrc1_metadata: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Text, MetadataValue))], ['query']),
});

export const archiveIdlFactory = ({ IDL }) => IDL.Service({
    icrc3_get_blocks: IDL.Func([GetBlocksArgs], [GetBlocksResult], ['query']),
});

// One agent per canister: agent-js keeps a single certificate-time watermark
// per agent, and canisters on different subnets certify slightly different
// times, so a shared agent can reject a lagging subnet's answer as a replay.
const agents = new Map();
export const getAgent = (canisterId = '') => {
    const key = String(canisterId);
    if (!agents.has(key)) agents.set(key, HttpAgent.create({ host: HOST }));
    return agents.get(key);
};

export async function createIcrc3Actor(canisterId) {
    const agent = await getAgent(canisterId);
    return Actor.createActor(icrc3IdlFactory, { agent, canisterId });
}

const archiveActors = new Map();
async function archiveActor(canisterId, method) {
    const key = `${canisterId.toText()}:${method}`;
    if (!archiveActors.has(key)) {
        const agent = await getAgent(canisterId);
        const idl = ({ IDL }) => IDL.Service({ [method]: IDL.Func([GetBlocksArgs], [GetBlocksResult], ['query']) });
        archiveActors.set(key, Actor.createActor(idl, { agent, canisterId }));
    }
    return archiveActors.get(key);
}

/// Swallow "method not found" style rejections and return `fallback`.
const optional = async (p, fallback) => { try { return await p; } catch (e) { return fallback; } };

/// Everything the browser shows in the status bar, with every optional
/// endpoint tolerated.
export async function fetchOverview(canisterId) {
    const actor = await createIcrc3Actor(canisterId);
    const head = await actor.icrc3_get_blocks([]); // log_length only
    const [archives, blockTypes, standards10, standards1, metadata] = await Promise.all([
        optional(actor.icrc3_get_archives({ from: [] }), []),
        optional(actor.icrc3_supported_block_types(), []),
        optional(actor.icrc10_supported_standards(), null),
        optional(actor.icrc1_supported_standards(), null),
        optional(actor.icrc1_metadata(), null),
    ]);
    return {
        logLength: head.log_length,
        archives,
        blockTypes,
        standards: standards10 || standards1 || [],
        metadata: metadata ? Object.fromEntries(metadata.map(([k, v]) => [k, Object.values(v)[0]])) : null,
    };
}

/// Fetch blocks [start, start+length) following archive callbacks. Returns
/// an array sorted by id; ids outside the log are simply absent.
export async function fetchBlocks(canisterId, start, length) {
    const actor = await createIcrc3Actor(canisterId);
    const out = new Map();
    const want = [{ start: BigInt(start), length: BigInt(length) }];
    const res = await actor.icrc3_get_blocks(want);
    for (const b of res.blocks) out.set(b.id, b.block);
    await Promise.all(res.archived_blocks.map(async (ab) => {
        const [id, method] = ab.callback;
        const archive = await archiveActor(id, method);
        // archives may cap responses; loop until the requested ranges are served
        let args = ab.args;
        for (let guard = 0; guard < 20 && args.length > 0; guard++) {
            const r = await archive[method](args);
            if (r.blocks.length === 0) break;
            for (const b of r.blocks) out.set(b.id, b.block);
            args = args.flatMap((a) => {
                const end = a.start + a.length;
                let maxServed = a.start - 1n;
                for (const b of r.blocks) if (b.id >= a.start && b.id < end && b.id > maxServed) maxServed = b.id;
                return maxServed + 1n < end && maxServed >= a.start ? [{ start: maxServed + 1n, length: end - maxServed - 1n }] : [];
            });
        }
    }));
    return [...out.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([id, block]) => ({ id, block }));
}

// ---- hashing (ICRC-3 representation-independent hash) ----

const leb128 = (n) => { n = BigInt(n); const out = []; do { let byte = Number(n & 0x7fn); n >>= 7n; if (n !== 0n) byte |= 0x80; out.push(byte); } while (n !== 0n); return Uint8Array.from(out); };
const sleb128 = (n) => { n = BigInt(n); const out = []; for (;;) { let byte = Number(n & 0x7fn); n >>= 7n; const sign = (byte & 0x40) !== 0; if ((n === 0n && !sign) || (n === -1n && sign)) { out.push(byte); return Uint8Array.from(out); } out.push(byte | 0x80); } };
const concat = (parts) => { const total = parts.reduce((n, p) => n + p.length, 0); const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const compareBytes = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; };

export function hashValue(v) {
    if ('Blob' in v) return sha256(Uint8Array.from(v.Blob));
    if ('Text' in v) return sha256(new TextEncoder().encode(v.Text));
    if ('Nat' in v) return sha256(leb128(v.Nat));
    if ('Int' in v) return sha256(sleb128(v.Int));
    if ('Array' in v) return sha256(concat(v.Array.map(hashValue)));
    if ('Map' in v) {
        const pairs = v.Map.map(([k, val]) => concat([sha256(new TextEncoder().encode(k)), hashValue(val)]));
        pairs.sort(compareBytes);
        return sha256(concat(pairs));
    }
    throw new Error('unknown value');
}

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const bytesEqual = (a, b) => a.length === b.length && compareBytes(a, b) === 0;

/// Verify the tip certificate against the IC root key. Returns
/// { lastIndex, lastHash } or throws.
export async function verifyTip(canisterId) {
    const actor = await createIcrc3Actor(canisterId);
    const tip = await actor.icrc3_get_tip_certificate();
    if (tip.length === 0) return null;
    const agent = await getAgent(canisterId);
    const { certificate, hash_tree } = tip[0];
    const cert = await Certificate.create({ certificate: new Uint8Array(certificate).buffer, rootKey: agent.rootKey, canisterId });
    const certified = lookupResultToBuffer(cert.lookup(['canister', canisterId.toUint8Array(), 'certified_data']));
    const tree = Cbor.decode(new Uint8Array(hash_tree));
    const root = new Uint8Array(await reconstruct(tree));
    if (!certified || !bytesEqual(new Uint8Array(certified), root)) throw new Error('certified data does not match the hash tree');
    const idxBytes = new Uint8Array(lookupResultToBuffer(lookup_path(['last_block_index'], tree)));
    // ICRC-3 says LEB128; older ledger-suite versions wrote a big-endian u64.
    // A valid LEB128 sets the continuation bit on every byte but the last.
    const isLeb = idxBytes.length > 0 && idxBytes.every((b, i) => (i < idxBytes.length - 1) === ((b & 0x80) !== 0));
    let lastIndex = 0n;
    if (isLeb) { let shift = 0n; for (const b of idxBytes) { lastIndex |= BigInt(b & 0x7f) << shift; shift += 7n; } }
    else for (const b of idxBytes) lastIndex = (lastIndex << 8n) | BigInt(b);
    const lastHash = new Uint8Array(lookupResultToBuffer(lookup_path(['last_block_hash'], tree)));
    return { lastIndex, lastHash };
}

export const parsePrincipal = (text) => { try { return Principal.fromText(text.trim()); } catch { return null; } };
