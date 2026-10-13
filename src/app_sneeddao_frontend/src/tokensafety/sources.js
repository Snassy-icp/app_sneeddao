// Data sources for the money graph. Both answer the same questions: what do
// we know about a node, and which edges touch it.
//
// - scanSource: the full transfer graph from a block scan (token safety page).
//   Everything is known up front, including holder shares and the sleuthing
//   overlay (satellites, hubs, genesis accounts).
// - indexSource: lazy, stateless, from an ICRC index canister. A node's edges
//   are fetched when it is expanded; nothing is known about nodes nobody has
//   expanded. Works for every ledger with an index-ng (SNS tokens, ckBTC …).
import { Principal } from '@dfinity/principal';
import { padIdl, PAD_CANISTER_ID } from './padIdl.js';
import { actor, ledgerIdl, IDL } from '../health/agent.js';
import { holdersByOwner } from './scan.js';

export const nsToMs = (ns) => (ns ? Number(BigInt(ns) / 1000000n) : null);

const kindOf = (id, tag, origin, funders) => {
    if (id === 'mint' || tag === 'minting account') return 'mint';
    if (id === 'burn') return 'burn';
    if (tag?.startsWith('ICPSwap pool')) return 'pool';
    if (tag?.includes('Sneed Lock')) return 'lock';
    if (tag) return 'dao';
    if (origin?.satelliteOf?.has(id)) return 'satellite';
    if ((funders?.get(id)?.count || 0) >= 5) return 'hub';
    if ((origin?.sprayTo?.get(id) || 0) >= (origin?.sprayThreshold || 10)) return 'spray';
    if (origin?.genesisOwners?.has(id)) return 'genesis';
    return 'node';
};

/// The whole graph from a scan.
export function scanSource(scan, tags, origin, token) {
    const balances = new Map(holdersByOwner(scan).map((h) => [h.owner, h.balance]));
    const nodes = new Map();
    const node = (id) => { let n = nodes.get(id); if (!n) { n = { id, balance: balances.get(id) || 0n, out: [], in: [], sent: 0n, received: 0n }; nodes.set(id, n); } return n; };
    let minTs = null; let maxTs = null;
    for (const e of scan.edges.values()) {
        const a = node(e.from); const b = node(e.to);
        a.out.push(e); b.in.push(e); a.sent += e.amount; b.received += e.amount;
        const f = nsToMs(e.firstTs); const l = nsToMs(e.lastTs);
        if (f !== null && (minTs === null || f < minTs)) minTs = f;
        if (l !== null && (maxTs === null || l > maxTs)) maxTs = l;
    }
    const funders = origin?.funders || new Map();
    for (const n of nodes.values()) {
        n.tag = tags?.get(n.id) || null;
        n.kind = kindOf(n.id, n.tag, origin, funders);
        n.satellites = funders.get(n.id)?.count || 0;
        n.satelliteOf = origin?.satelliteOf?.get(n.id) || null;
        n.sprayTo = origin?.sprayTo?.get(n.id) || 0;
        n.inCount = n.in.length; n.outCount = n.out.length;
    }
    const holders = [...nodes.values()].filter((n) => !['mint', 'burn'].includes(n.id)).sort((a, b) => (a.balance < b.balance ? 1 : -1)).slice(0, 15);
    const hubs = [...nodes.values()].filter((n) => n.satellites > 0).sort((a, b) => b.satellites - a.satellites).slice(0, 10);
    return {
        kind: 'scan', token, totalSupply: scan.netSupply > 0n ? scan.netSupply : null, timeRange: minTs !== null ? { minTs, maxTs } : null,
        candidates: { holders, hubs, mint: true }, hasOrigin: !!origin, nodeCount: nodes.size, edgeCount: scan.edges.size,
        getNode: (id) => nodes.get(id) || null,
        edgesOf: async (id) => { const n = nodes.get(id); return n ? [...n.out, ...n.in] : []; },
    };
}

// ---- ICRC index-ng ----
const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const Tx = IDL.Record({
    kind: IDL.Text, timestamp: IDL.Nat64,
    mint: IDL.Opt(IDL.Record({ to: Account, amount: IDL.Nat })),
    burn: IDL.Opt(IDL.Record({ from: Account, amount: IDL.Nat })),
    transfer: IDL.Opt(IDL.Record({ from: Account, to: Account, amount: IDL.Nat })),
    approve: IDL.Opt(IDL.Record({ from: Account, amount: IDL.Nat })),
});
const indexIdl = ({ IDL }) => IDL.Service({
    get_account_transactions: IDL.Func([IDL.Record({ account: Account, start: IDL.Opt(IDL.Nat), max_results: IDL.Nat })], [IDL.Variant({ Ok: IDL.Record({ balance: IDL.Nat, transactions: IDL.Vec(IDL.Record({ id: IDL.Nat, transaction: Tx })), oldest_tx_id: IDL.Opt(IDL.Nat) }), Err: IDL.Record({ message: IDL.Text }) })], ['query']),
    list_subaccounts: IDL.Func([IDL.Record({ owner: IDL.Principal, start: IDL.Opt(IDL.Vec(IDL.Nat8)) })], [IDL.Vec(IDL.Vec(IDL.Nat8))], ['query']),
});
const tokenIdl = ({ IDL }) => IDL.Service({
    icrc1_total_supply: IDL.Func([], [IDL.Nat], ['query']),
    icrc1_minting_account: IDL.Func([], [IDL.Opt(Account)], ['query']),
    icrc106_get_index_principal: IDL.Func([], [IDL.Variant({ Ok: IDL.Principal, Err: IDL.Reserved })], ['query']),
});

/// Find the index canister of a ledger: ICRC-106, else the SNS registry.
export async function findIndex(ledgerId, snses) {
    const l = await actor(tokenIdl, ledgerId);
    try { const r = await l.icrc106_get_index_principal(); if ('Ok' in r) return r.Ok.toText(); } catch { /* no ICRC-106 */ }
    const sns = (snses || []).find((s) => s.ledger === ledgerId);
    if (sns?.index) return sns.index;
    return padIndexOf(ledgerId);
}

/// The launchpad's own record of a ledger it minted (for ledgers launched before the pad set ICRC-106).
export async function padIndexOf(ledgerId) {
    if (!PAD_CANISTER_ID) return null;
    try {
        const pad = await actor(padIdl, PAD_CANISTER_ID);
        const l = await pad.get_launch_by_ledger(Principal.fromText(ledgerId));
        return l[0]?.index[0]?.toText() || null;
    } catch { return null; }
}

/// Lazy graph over an index canister. `tags` maps principals to labels.
export async function indexSource({ ledgerId, indexId, tags, token, maxTxPerAccount = 1000, maxSubaccounts = 25 }) {
    const index = await actor(indexIdl, indexId);
    const ledger = await actor(tokenIdl, ledgerId);
    const [supply, mintingAcct] = await Promise.all([ledger.icrc1_total_supply().catch(() => null), ledger.icrc1_minting_account().catch(() => [])]);
    const minting = mintingAcct?.[0]?.owner?.toText?.() || null;
    const allTags = new Map(tags || []);
    if (minting) allTags.set(minting, 'minting account');
    const nodes = new Map();
    const node = (id) => { let n = nodes.get(id); if (!n) { n = { id, balance: null, out: [], in: [], sent: 0n, received: 0n, tag: allTags.get(id) || null, kind: kindOf(id, allTags.get(id) || null, null, null), satellites: 0, satelliteOf: null, inCount: 0, outCount: 0, expanded: false, truncated: false }; nodes.set(id, n); } return n; };
    const edgeKey = (a, b) => `${a}|${b}`;
    const edges = new Map();
    const addEdge = (from, to, amount, ts) => {
        if (from === to) return;
        const k = edgeKey(from, to);
        let e = edges.get(k);
        if (!e) { e = { from, to, count: 0, amount: 0n, firstTs: ts, lastTs: ts }; edges.set(k, e); node(from).out.push(e); node(to).in.push(e); }
        e.count += 1; e.amount += amount; if (ts !== null) { if (e.firstTs === null || ts < e.firstTs) e.firstTs = ts; if (e.lastTs === null || ts > e.lastTs) e.lastTs = ts; }
    };
    const seenTx = new Set();
    const ownerText = (a) => a.owner.toText();

    const expand = async (id) => {
        const n = node(id);
        if (n.expanded || id === 'burn') return;
        n.expanded = true;
        const owner = Principal.fromText(id);
        let subs = [];
        try { subs = (await index.list_subaccounts({ owner, start: [] })).slice(0, maxSubaccounts); } catch { /* index may not support it */ }
        const accounts = [[], ...subs.map((s) => [Uint8Array.from(s)])];
        let balance = 0n;
        for (const subaccount of accounts) {
            let start = []; let fetched = 0;
            for (let page = 0; page < 50; page++) {
                let r;
                try { r = await index.get_account_transactions({ account: { owner, subaccount }, start, max_results: 100n }); } catch { break; }
                if (!('Ok' in r)) break;
                if (page === 0) balance += r.Ok.balance;
                for (const { id: txId, transaction: t } of r.Ok.transactions) {
                    const key = txId.toString();
                    if (seenTx.has(key)) continue;
                    seenTx.add(key);
                    const ts = t.timestamp;
                    const x = t.transfer?.[0]; const mi = t.mint?.[0]; const bu = t.burn?.[0];
                    if (x) addEdge(ownerText(x.from), ownerText(x.to), x.amount, ts);
                    else if (mi) addEdge(minting || 'mint', ownerText(mi.to), mi.amount, ts);
                    else if (bu) addEdge(ownerText(bu.from), 'burn', bu.amount, ts);
                }
                fetched += r.Ok.transactions.length;
                if (r.Ok.transactions.length < 100 || fetched >= maxTxPerAccount) { if (fetched >= maxTxPerAccount && r.Ok.transactions.length === 100) n.truncated = true; break; }
                start = [r.Ok.transactions[r.Ok.transactions.length - 1].id];
            }
        }
        n.balance = balance;
        n.sent = n.out.reduce((a, e) => a + e.amount, 0n); n.received = n.in.reduce((a, e) => a + e.amount, 0n);
        n.inCount = n.in.length; n.outCount = n.out.length;
    };

    return {
        kind: 'index', token, totalSupply: supply, timeRange: null, candidates: { holders: [], hubs: [], mint: !!minting }, hasOrigin: false, ledgerId, indexId, minting,
        nodeCount: null, edgeCount: null,
        getNode: (id) => { const real = id === 'mint' && minting ? minting : id; return nodes.get(real) || node(real); },
        resolve: (id) => (id === 'mint' && minting ? minting : id),
        edgesOf: async (id) => { const real = id === 'mint' && minting ? minting : id; await expand(real); const n = nodes.get(real); return n ? [...n.out, ...n.in] : []; },
    };
}
