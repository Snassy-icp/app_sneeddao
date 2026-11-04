// The Sneed Diamond Club on ICRC-7 (spec/diamond_club_icrc7.md): the sneed_nft collection canister
// and its one-way swap from the old EXT collection. One canister serves both networks (staging
// and ic); its interface is public/api-docs/sneed_nft.md.
//
// Swap by send: the holder sends EXT cards to their swap address (an EXT account identifier of
// the canister), then claim_swap(p) delivers ICRC-7 token index + 1 to p. Proof by payment: a
// wallet that cannot send NFTs pays a little SNEED to p's proof address, and claim_by_proof
// delivers every card the paying wallet holds and retires the old ones.
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { idlFactory, canisterId as envId } from 'declarations/sneed_nft';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';

// dfx bakes a made-up 8-byte id into the bundle for a canister missing on the network
const realCanisterId = (text) => {
    try { const b = Principal.fromText(text).toUint8Array(); return b.length === 10 && b[9] === 1 ? text : null; } catch { return null; }
};

/// The collection canister on this build's network, or null.
export const SNEED_NFT_ID = envId ? realCanisterId(envId) : null;
/// The mainnet canister (images are served from it on every network).
export const SNEED_NFT_MAINNET = 'v7b6c-niaaa-aaaac-bgiiq-cai';
export const DC_EXT_ID = 'gjv36-laaaa-aaaah-adyza-cai';
export const SNEED_LEDGER = 'hvgxa-wqaaa-aaaaq-aacia-cai';
export const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
/// The index canisters the page reads payments from (SNEED: the Sneed SNS index; ICP: the NNS ICP index).
export const INDEX_OF = { [SNEED_LEDGER]: 'h3e2i-naaaa-aaaaq-aacja-cai', [ICP_LEDGER]: 'qhbym-qaaaa-aaaaa-aaafq-cai' };
export const DC_SUPPLY = 1000;
export const SWAP_PAGE = '/diamond-club';
/// The canister reads the EXT registry at most once per 30 s for all callers.
export const REGISTRY_CACHE_MS = 30_000;

/// Card n's picture (n = EXT index + 1): 'web' (800 px), 'thumb' (256 px) or null (the 2000 px original).
export const cardImageUrl = (n, size = 'web') => `https://${SNEED_NFT_ID || SNEED_NFT_MAINNET}.icp0.io/card/${n}.jpg${size ? `?size=${size}` : ''}`;
export const cardNumber = (extIndex) => Number(extIndex) + 1;

const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';

async function agentFor(identity) {
    const agent = await HttpAgent.create({ host, ...(identity ? { identity } : {}) });
    if (isLocal) await agent.fetchRootKey();
    return agent;
}
/// An actor for the collection, signed by `identity` (anonymous without one).
export async function sneedNftActor(identity = null) {
    if (!SNEED_NFT_ID) throw new Error('The Diamond Club collection canister is not on this network');
    return Actor.createActor(idlFactory, { agent: await agentFor(identity), canisterId: SNEED_NFT_ID });
}
/// The HttpAgent the EXT helpers take (signed when `identity` is given).
export const extAgent = (identity = null) => agentFor(identity);

const toPrincipal = (p) => (typeof p === 'string' ? Principal.fromText(p) : p);
export const variantName = (v) => Object.keys(v || {})[0] || '';
export const toHex = (bytes) => Array.from(bytes || [], (b) => b.toString(16).padStart(2, '0')).join('');

// ---- Reads ----

export const getStatus = async () => (await sneedNftActor()).status();
export const getSwapAddress = async (p) => (await sneedNftActor()).swap_address(toPrincipal(p));
/// { account: { owner, subaccount: [bytes] }, account_id }
export const getProofAddress = async (p) => (await sneedNftActor()).proof_address(toPrincipal(p));

/// Is the swap open? { open, reason } from status().
export function swapState(status) {
    if (!status) return { open: false, reason: 'Reading the collection…' };
    if (!status.metadata_frozen || !status.minting_locked) return { open: false, reason: 'The swap opens once the collection is final: metadata frozen and minting locked.' };
    if (status.swaps_paused) return { open: false, reason: 'The swap is paused for now.' };
    return { open: true, reason: '' };
}

/// The ICRC-7 token ids `p` holds (its default account), ascending.
export async function tokensOf(p) {
    const a = await sneedNftActor();
    const account = { owner: toPrincipal(p), subaccount: [] };
    const out = [];
    let prev = [];
    for (let page = 0; page < 20; page++) {
        const chunk = await a.icrc7_tokens_of(account, prev, [500n]);
        out.push(...chunk);
        if (chunk.length < 500) break;
        prev = [chunk[chunk.length - 1]];
    }
    return out.map(Number).sort((x, y) => x - y);
}

/// The swap records of some EXT indexes: Map(index -> Swap | null).
export async function swapsOf(indexes) {
    const out = new Map();
    if (!indexes.length) return out;
    const a = await sneedNftActor();
    for (let i = 0; i < indexes.length; i += 500) {
        const batch = indexes.slice(i, i + 500);
        const r = await a.get_swaps(batch.map(Number));
        batch.forEach((idx, k) => out.set(Number(idx), r[k]?.[0] || null));
    }
    return out;
}
export const getSwap = async (extIndex) => (await (await sneedNftActor()).get_swap(Number(extIndex)))[0] || null;

/// Every retired EXT card (swapped by proof), ascending by EXT index.
export async function listRetired() {
    const a = await sneedNftActor();
    const out = [];
    let prev = [];
    for (let page = 0; page < 20; page++) {
        const chunk = await a.list_retired(prev, [1000n]);
        out.push(...chunk);
        if (chunk.length < 1000) break;
        prev = [chunk[chunk.length - 1].ext_index];
    }
    return out;
}

/// The proofs made for recipient `p`, newest first.
export async function proofsFor(p) {
    const a = await sneedNftActor();
    const me = toPrincipal(p).toText();
    const out = [];
    for (let start = 0; start < 20_000; start += 1000) {
        const chunk = await a.list_proofs(BigInt(start), [1000n]);
        out.push(...chunk.filter((x) => x.recipient.toText() === me));
        if (chunk.length < 1000) break;
    }
    return out.sort((x, y) => Number(y.at - x.at));
}
export const getProof = async (ledger, block) => (await (await sneedNftActor()).get_proof(toPrincipal(ledger), BigInt(block)))[0] || null;

/// { symbol, decimals, fee } of a proof ledger.
export async function ledgerInfo(ledger) {
    const l = createLedgerActor(typeof ledger === 'string' ? ledger : ledger.toText(), { agent: await agentFor(null) });
    const [symbol, decimals, fee] = await Promise.all([l.icrc1_symbol(), l.icrc1_decimals(), l.icrc1_fee()]);
    return { symbol, decimals: Number(decimals), fee };
}

// ---- Updates ----

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const resultOf = (r) => { if ('err' in r) throw new Error(r.err); return r.ok; };

/// claim_swap(p), signed by `identity`. A claim arriving while the canister reads the EXT registry
/// for someone else is asked to come back: retried a few times, a few seconds apart.
export async function claimSwap(identity, p) {
    const a = await sneedNftActor(identity);
    for (let attempt = 0; ; attempt++) {
        const r = await a.claim_swap(toPrincipal(p));
        if ('err' in r && /being read/i.test(r.err) && attempt < 4) { await wait(5000); continue; }
        return resultOf(r);
    }
}

/// claim_by_proof(p, ledger, block, sender): `sender` only for an ICP payment ({ owner, subaccount: [] }).
export async function claimByProof(identity, p, ledger, block, sender = null) {
    const a = await sneedNftActor(identity);
    return resultOf(await a.claim_by_proof(toPrincipal(p), toPrincipal(ledger), BigInt(block), sender ? [sender] : []));
}
export async function retryRefund(identity, ledger, block) {
    const a = await sneedNftActor(identity);
    return resultOf(await a.retry_refund(toPrincipal(ledger), BigInt(block)));
}

/// A refund state for people: { label, tone, retry }.
export function refundState(proof) {
    const r = proof?.refund || {};
    const k = variantName(r);
    const stale = k === 'in_flight' && proof.refund_attempted_at?.[0] != null && Date.now() - Number(proof.refund_attempted_at[0] / 1_000_000n) > 10 * 60_000;
    switch (k) {
        case 'done': return { label: `Refunded (ledger block ${r.done.block.toString()})`, tone: 'success', retry: false };
        case 'none': return { label: 'No refund: the payment did not cover the ledger fee', tone: 'muted', retry: false };
        case 'pending': return { label: 'Refund waiting to be sent', tone: 'pending', retry: true };
        case 'in_flight': return { label: stale ? 'Refund attempt did not finish' : 'Refund being sent…', tone: stale ? 'warning' : 'pending', retry: stale };
        case 'failed': return { label: `Refund failed: ${r.failed}`, tone: 'error', retry: true };
        case 'needs_admin': return { label: `Refund needs an admin: ${r.needs_admin}`, tone: 'warning', retry: false };
        default: return { label: k || 'unknown', tone: 'muted', retry: false };
    }
}

// ---- Finding proof payments (the ledgers' index canisters) ----

// Candid of the two index kinds, only the fields used (records decode with fewer fields).
const indexNgIdl = ({ IDL }) => {
    const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
    const Transfer = IDL.Record({ from: Account, to: Account, amount: IDL.Nat, spender: IDL.Opt(Account) });
    const Transaction = IDL.Record({ kind: IDL.Text, transfer: IDL.Opt(Transfer), timestamp: IDL.Nat64 });
    return IDL.Service({
        get_account_transactions: IDL.Func(
            [IDL.Record({ account: Account, start: IDL.Opt(IDL.Nat), max_results: IDL.Nat })],
            [IDL.Variant({ Ok: IDL.Record({ transactions: IDL.Vec(IDL.Record({ id: IDL.Nat, transaction: Transaction })) }), Err: IDL.Record({ message: IDL.Text }) })],
            ['query']),
    });
};
const icpIndexIdl = ({ IDL }) => {
    const Tokens = IDL.Record({ e8s: IDL.Nat64 });
    const TimeStamp = IDL.Record({ timestamp_nanos: IDL.Nat64 });
    const Operation = IDL.Variant({
        Approve: IDL.Record({}), Burn: IDL.Record({}), Mint: IDL.Record({}),
        Transfer: IDL.Record({ from: IDL.Text, to: IDL.Text, amount: Tokens, spender: IDL.Opt(IDL.Text) }),
        TransferFrom: IDL.Record({}),
    });
    const Transaction = IDL.Record({ operation: Operation, timestamp: IDL.Opt(TimeStamp), created_at_time: IDL.Opt(TimeStamp) });
    return IDL.Service({
        get_account_identifier_transactions: IDL.Func(
            [IDL.Record({ account_identifier: IDL.Text, start: IDL.Opt(IDL.Nat64), max_results: IDL.Nat64 })],
            [IDL.Variant({ Ok: IDL.Record({ transactions: IDL.Vec(IDL.Record({ id: IDL.Nat64, transaction: Transaction })) }), Err: IDL.Record({ message: IDL.Text }) })],
            ['query']),
    });
};

const sameBytes = (a, b) => toHex(a || []) === toHex(b || []);
const isDefaultSub = (s) => !s || !s.length || s[0].every((x) => x === 0);

/// Transfers into the proof address on one proof ledger, newest first (the last 50):
/// [{ ledger, kind, block, atMs, amount, fromPrincipal?, fromSubaccount?, fromAccountId, spender }].
/// `proofAddress` is proof_address(p)'s result.
export async function findPayments(ledger, kind, proofAddress) {
    const index = INDEX_OF[ledger];
    if (!index) throw new Error(`No index canister known for ledger ${ledger}`);
    const agent = await agentFor(null);
    const out = [];
    if (kind === 'icp') {
        const ix = Actor.createActor(icpIndexIdl, { agent, canisterId: index });
        const r = await ix.get_account_identifier_transactions({ account_identifier: proofAddress.account_id, start: [], max_results: 50n });
        if ('Err' in r) throw new Error(r.Err.message);
        for (const { id, transaction: t } of r.Ok.transactions) {
            const x = t.operation.Transfer;
            if (!x || x.to.toLowerCase() !== proofAddress.account_id.toLowerCase()) continue;
            const ts = t.timestamp[0] || t.created_at_time[0];
            out.push({ ledger, kind, block: id, atMs: ts ? Number(ts.timestamp_nanos / 1_000_000n) : null, amount: x.amount.e8s, fromAccountId: x.from.toLowerCase(), spender: x.spender[0] || null });
        }
    } else {
        const ix = Actor.createActor(indexNgIdl, { agent, canisterId: index });
        const r = await ix.get_account_transactions({ account: proofAddress.account, start: [], max_results: 50n });
        if ('Err' in r) throw new Error(r.Err.message);
        const own = proofAddress.account;
        for (const { id, transaction: t } of r.Ok.transactions) {
            const x = t.transfer[0];
            if (!x || x.to.owner.toText() !== own.owner.toText() || !sameBytes(x.to.subaccount[0], own.subaccount[0])) continue;
            out.push({
                ledger, kind, block: id, atMs: Number(t.timestamp / 1_000_000n), amount: x.amount,
                fromPrincipal: x.from.owner.toText(), fromSubaccount: isDefaultSub(x.from.subaccount) ? null : toHex(x.from.subaccount[0]),
                fromAccountId: null, spender: x.spender[0] ? x.spender[0].owner.toText() : null,
            });
        }
    }
    return out.sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
}
