// The revenue loop's four stations and their on-chain history, read from the
// ICP and SNEED index canisters: the 2-year neuron's vector, the ICP splitter,
// the SNEED buyback vector and the SNEED splitter. Pure data; the page
// /rll_ledger renders it.
import { Principal } from '@dfinity/principal';
import { idlFactory as indexIdl } from 'external/sns_index/sns_index.did.js';
import { idlFactory as nnsGovIdl } from 'external/nns_gov/nns_gov.did.js';
import { idlFactory as vectorIdl } from 'external/icrc55_vector/icrc55_vector.did.js';
import { idlFactory as exVectorIdl } from 'external/icrc55_exvector/icrc55_exvector.did.js';
import { actor, icpIndexIdl, accountIdentifierHex, hex } from '../health/agent.js';
import { parseExtendedAddress } from './AccountParser';

export const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
export const ICP_INDEX = 'qhbym-qaaaa-aaaaa-aaafq-cai';
export const SNEED_LEDGER = 'hvgxa-wqaaa-aaaaq-aacia-cai';
export const SNEED_INDEX = 'h3e2i-naaaa-aaaaq-aacja-cai';
export const SNEED_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
export const GOVERNANCE = 'fi3zi-fyaaa-aaaaq-aachq-cai';
export const NNS_GOVERNANCE = 'rrkah-fqaaa-aaaaa-aaaaq-cai';
export const NEURON_2Y = 4000934039483276792n;
export const PYLON = '6jvpj-sqaaa-aaaaj-azwnq-cai';
export const BUYBACK_PYLON = 'togwv-zqaaa-aaaal-qr7aa-cai';
export const TREASURY_SNEED_SUB = '8b0805942c48b3420d6edffecbb685e8c39ef574612a5d8a911fb068bf6648de';
export const RLL = 'lvc4n-7aaaa-aaaam-adm6a-cai';
export const DEFI = 'ok64y-uiaaa-aaaag-qdcbq-cai';
export const SNEED_ICP_POOL = 'osyzs-xiaaa-aaaag-qc76q-cai';

/// The four stations. `account` is the vector node's ICRC-1 account (textual form).
export const STATIONS = {
    neuron: { key: 'neuron', name: '2-year ICP neuron', token: 'ICP', account: '6jvpj-sqaaa-aaaaj-azwnq-cai-wu6phoy.100000000010000000000000000000000000000000000000000000000000000', nodeId: 1, pylon: PYLON, link: `https://vectors.neuronpool.com/vectors/${GOVERNANCE}/1`, dashboard: `https://dashboard.internetcomputer.org/neuron/${NEURON_2Y}` },
    icpSplitter: { key: 'icpSplitter', name: 'ICP splitter', token: 'ICP', account: '6jvpj-sqaaa-aaaaj-azwnq-cai-m7u3kpi.100000000060000000000000000000000000000000000000000000000000000', nodeId: 6, pylon: PYLON, link: `https://vectors.neuronpool.com/vectors/${GOVERNANCE}/6` },
    buyback: { key: 'buyback', name: 'SNEED buyback vector', token: 'ICP', token2: 'SNEED', account: 'togwv-zqaaa-aaaal-qr7aa-cai-ihr3xbq.100000000120000000000000000000000000000000000000000000000000000', nodeId: 18, pylon: BUYBACK_PYLON, exchange: true, link: `https://beta.icpcoins.com/#/vector/modify/${BUYBACK_PYLON}/exchange/18` },
    sneedSplitter: { key: 'sneedSplitter', name: 'SNEED splitter', token: 'SNEED', account: '6jvpj-sqaaa-aaaaj-azwnq-cai-vilbrxq.1000000002d0000000000000000000000000000000000000000000000000000', nodeId: 45, pylon: PYLON, link: `https://vectors.neuronpool.com/vectors/${GOVERNANCE}/45` },
};

export const parseStationAccount = (text) => {
    const p = parseExtendedAddress(text);
    const owner = p.principal;
    const sub = p.subaccount?.resolved ? Uint8Array.from(p.subaccount.resolved) : null;
    return { owner, sub, key: `${owner.toText()}:${sub ? hex(sub) : ''}`, icpHex: accountIdentifierHex(owner, sub) };
};

// ---- names for counterparties ----
const subHex = (s) => (s && s.length ? hex(Uint8Array.from(s)) : '');
const known = (() => {
    const byIcp = new Map(); // ICP account-id hex -> name
    const byIcrc = new Map(); // owner:subhex -> name
    const byOwner = new Map(); // owner -> name (any subaccount)
    const add = (ownerText, sub, name) => {
        const owner = Principal.fromText(ownerText);
        const subBytes = sub ? Uint8Array.from(sub.match(/../g).map((h) => parseInt(h, 16))) : null;
        byIcp.set(accountIdentifierHex(owner, subBytes), name);
        byIcrc.set(`${ownerText}:${subBytes ? hex(subBytes) : ''}`, name);
    };
    for (const s of Object.values(STATIONS)) { const a = parseStationAccount(s.account); byIcp.set(a.icpHex, s.name); byIcrc.set(a.key, s.name); }
    add(GOVERNANCE, null, 'SNS governance (treasury ICP / SNEED minting account)');
    add(GOVERNANCE, TREASURY_SNEED_SUB, 'DAO treasury (SNEED)');
    add(RLL, null, 'RLL rewards (member rewards)');
    add(DEFI, null, 'Sneed DeFi canister');
    byOwner.set(SNEED_ICP_POOL, 'SNEED/ICP pool (ICPSwap)');
    byOwner.set(NNS_GOVERNANCE, 'NNS governance');
    add(PYLON, null, 'Neutrinite pylon (its own account: fees)');
    add(BUYBACK_PYLON, null, 'ICPCoins pylon (its own account: fees)');
    byOwner.set(PYLON, 'Neutrinite pylon (other node)');
    byOwner.set(BUYBACK_PYLON, 'ICPCoins pylon (other node)');
    return { byIcp, byIcrc, byOwner };
})();

/// Human name for a counterparty of a row ({ hex } for ICP, { owner, sub } for ICRC), or null.
export function nameFor(cp) {
    if (!cp) return null;
    if (cp.hex) return known.byIcp.get(cp.hex) || null;
    const k = `${cp.owner}:${cp.sub || ''}`;
    return known.byIcrc.get(k) || known.byOwner.get(cp.owner) || null;
}

// ---- history ----
const cache = new Map(); // key -> { at, rows }
const TTL = 10 * 60 * 1000;
const MAX_ROWS = 4000;

/// Every transaction of `stationKey` on `ledger` since `sinceMs` (0 = all), newest first:
/// { id, at (ms), kind, dir ('in'|'out'|'self'), amount (bigint, base units), fee, cp: counterparty, memo }.
export async function fetchStationHistory(stationKey, ledger, sinceMs, onProgress) {
    const st = STATIONS[stationKey];
    const acct = parseStationAccount(st.account);
    const ck = `${stationKey}:${ledger}:${sinceMs}`;
    const c = cache.get(ck);
    if (c && Date.now() - c.at < TTL) return c.rows;
    const rows = [];
    let start = [];
    const page = 500n;
    while (rows.length < MAX_ROWS) {
        let txs; let oldest;
        if (ledger === ICP_LEDGER) {
            const index = await actor(icpIndexIdl, ICP_INDEX);
            const r = await index.get_account_transactions({ account: { owner: acct.owner, subaccount: acct.sub ? [acct.sub] : [] }, start, max_results: page });
            if ('Err' in r) throw new Error(r.Err.message);
            txs = r.Ok.transactions.map(({ id, transaction: t }) => {
                const k = Object.keys(t.operation)[0]; const op = t.operation[k];
                const at = Number(t.timestamp?.[0]?.timestamp_nanos ?? 0n) / 1e6;
                const from = op.from || null; const to = op.to || null;
                const isOut = from === acct.icpHex; const isIn = to === acct.icpHex;
                return { id: BigInt(id), at, kind: k.toLowerCase(), dir: isOut && isIn ? 'self' : isOut ? 'out' : 'in', amount: BigInt(op.amount?.e8s ?? 0n), fee: BigInt(op.fee?.e8s ?? 0n), cp: isOut ? (to ? { hex: to } : null) : (from ? { hex: from } : null), memo: t.memo ? t.memo.toString() : '' };
            }).filter((t) => t.kind !== 'approve');
            oldest = r.Ok.oldest_tx_id?.[0];
        } else {
            const index = await actor(indexIdl, SNEED_INDEX);
            const r = await index.get_account_transactions({ account: { owner: acct.owner, subaccount: acct.sub ? [acct.sub] : [] }, start, max_results: page });
            if ('Err' in r) throw new Error(r.Err.message);
            txs = r.Ok.transactions.map(({ id, transaction: t }) => {
                const x = t.transfer?.[0] || t.mint?.[0] || t.burn?.[0];
                const key = (a) => (a ? `${a.owner.toText()}:${subHex(a.subaccount?.[0])}` : null);
                const from = x?.from ? key(x.from) : null; const to = x?.to ? key(x.to) : null;
                const isOut = from === acct.key; const isIn = to === acct.key;
                const cpAcc = isOut ? x?.to : x?.from;
                return { id: BigInt(id), at: Number(t.timestamp) / 1e6, kind: t.kind, dir: isOut && isIn ? 'self' : isOut ? 'out' : 'in', amount: BigInt(x?.amount ?? 0n), fee: BigInt(x?.fee?.[0] ?? 0n), cp: cpAcc ? { owner: cpAcc.owner.toText(), sub: subHex(cpAcc.subaccount?.[0]) } : null, memo: '' };
            }).filter((t) => t.kind !== 'approve');
            oldest = r.Ok.oldest_tx_id?.[0];
        }
        for (const t of txs) { if (sinceMs && t.at < sinceMs) { txs = null; break; } rows.push(t); }
        onProgress?.(rows.length);
        if (txs === null || txs.length === 0) break;
        const minId = rows[rows.length - 1].id;
        if (oldest === undefined || oldest === null || BigInt(oldest) >= minId || minId === 0n) break;
        start = [minId - 1n];
    }
    cache.set(ck, { at: Date.now(), rows });
    return rows;
}

/// Totals and a per-day series for a list of rows.
export function summarize(rows, decimals, sinceMs) {
    let inn = 0n; let out = 0n; let fees = 0n; let nIn = 0; let nOut = 0;
    const byDay = new Map();
    const byCp = new Map(); // outflows per counterparty
    for (const r of rows) {
        const day = new Date(r.at).toISOString().slice(0, 10);
        const d = byDay.get(day) || { day, in: 0, out: 0 };
        if (r.dir === 'in') { inn += r.amount; nIn++; d.in += Number(r.amount) / 10 ** decimals; }
        else if (r.dir === 'out') { out += r.amount; fees += r.fee; nOut++; d.out += Number(r.amount) / 10 ** decimals; const k = r.cp ? (r.cp.hex || `${r.cp.owner}:${r.cp.sub || ''}`) : '?'; const c = byCp.get(k) || { cp: r.cp, amount: 0n, n: 0 }; c.amount += r.amount; c.n++; byCp.set(k, c); }
        byDay.set(day, d);
    }
    const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    const spanDays = Math.max(1, Math.round(((rows.length ? Date.now() : 0) - (sinceMs || (rows.length ? rows[rows.length - 1].at : Date.now()))) / 86_400_000));
    return { in: inn, out, fees, nIn, nOut, days, spanDays, byCp: [...byCp.values()].sort((a, b) => (b.amount > a.amount ? 1 : -1)) };
}

/// The NNS neuron's facts.
export async function fetchNeuron() {
    const gov = await actor(nnsGovIdl, NNS_GOVERNANCE);
    const r = await gov.get_neuron_info(NEURON_2Y);
    if ('Err' in r) throw new Error(r.Err.error_message || 'NNS governance returned an error');
    return r.Ok;
}

/// A splitter node's live destinations with shares: [{ owner, sub, ledger, pct, name }].
export async function fetchSplits(stationKey) {
    const st = STATIONS[stationKey];
    const a = await actor(st.exchange ? exVectorIdl : vectorIdl, st.pylon);
    const nodes = await a.icrc55_get_nodes([{ id: st.nodeId }]);
    const info = nodes?.[0]?.[0];
    if (!info) return [];
    const shares = info.custom?.[0]?.devefi_split?.variables?.split || [];
    return (info.destinations || []).map((d, i) => {
        const acc = d.endpoint?.ic?.account?.[0];
        const owner = acc?.owner?.toText?.() || '';
        const sub = acc?.subaccount?.[0] ? hex(Uint8Array.from(acc.subaccount[0])) : '';
        const ledger = d.endpoint?.ic?.ledger?.toText?.() || '';
        const pct = Number(shares[i] ?? parseFloat(d.name) ?? 0);
        return { owner, sub, ledger, pct, name: nameFor({ owner, sub }) || d.name || owner };
    }).filter((d) => d.pct > 0);
}
