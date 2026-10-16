// The revenue loop's books, read from the ICP and SNEED index canisters.
//
// How the pylons move money (checked against the indexes on 2026-10-14):
// a Neutrinite/ICPCoins pylon keeps ONE main account per ledger. Every node
// has a "source" subaccount (01 00 00 00 00 <node>) where deposits land; the
// pylon sweeps each deposit into its main account at once, and from then on
// balances are virtual. A transfer from one node to another node of the SAME
// pylon never touches the ledger. A transfer to another pylon or to an
// outside account is sent FROM the pylon's main account. The NNS mints the
// neuron's maturity into a separate maturity subaccount of the neuron node
// (01 01 00 00 00 01), which is swept the same way.
//
// So the loop is measured where it is visible: maturity = the mints; the ICP
// splitter's outputs = what arrives at the buyback's source account and at
// the DAO's ICP account from the pylon main; the SNEED splitter's outputs =
// the burns and the transfers to the treasury and the RLL from the pylon's
// main SNEED account. The 25% the ICP splitter sends back into the neuron
// stays inside the pylon and leaves no transaction.
import { Principal } from '@dfinity/principal';
import { idlFactory as indexIdl } from 'external/sns_index/sns_index.did.js';
import { idlFactory as nnsGovIdl } from 'external/nns_gov/nns_gov.did.js';
import { idlFactory as vectorIdl } from 'external/icrc55_vector/icrc55_vector.did.js';
import { idlFactory as exVectorIdl } from 'external/icrc55_exvector/icrc55_exvector.did.js';
import { actor, icpIndexIdl, accountIdentifierHex, hex } from '../health/agent.js';

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

const nodeSub = (node, prefix = [1, 0]) => { const s = new Uint8Array(32); s[0] = prefix[0]; s[1] = prefix[1]; s[5] = node; return s; };
const hexSub = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const principalSub = (p) => { const b = Principal.fromText(p).toUint8Array(); const s = new Uint8Array(32); s[0] = b.length; s.set(b, 1); return s; };

/// Accounts the loop touches. `key` is the ICRC key owner:subhex; `icpHex` the ICP account identifier.
const mk = (name, ledger, owner, sub) => ({ name, ledger, owner, sub, key: `${owner}:${sub ? hex(sub) : ''}`, icpHex: accountIdentifierHex(owner, sub) });
export const ACCOUNTS = {
    maturity: mk('2-year neuron: maturity account', ICP_LEDGER, PYLON, nodeSub(1, [1, 1])),
    neuronSource: mk('2-year neuron: stake deposit account', ICP_LEDGER, PYLON, nodeSub(1)),
    splitterSource: mk('ICP splitter: deposit account', ICP_LEDGER, PYLON, nodeSub(6)),
    buybackSource: mk('SNEED buyback: deposit account', ICP_LEDGER, BUYBACK_PYLON, nodeSub(18)),
    treasuryIcp: mk('DAO treasury (ICP)', ICP_LEDGER, GOVERNANCE, null),
    pylonMainIcp: mk('Neutrinite pylon main account', ICP_LEDGER, PYLON, null),
    buybackPylonMainIcp: mk('ICPCoins pylon main account', ICP_LEDGER, BUYBACK_PYLON, null),
    // read in full (no row cap): only the loop uses it, two rows per buyback delivery, and the
    // buyback's average price needs its whole history
    sneedSplitterSource: { ...mk('SNEED splitter: deposit account', SNEED_LEDGER, PYLON, nodeSub(45)), full: true },
    pylonMainSneed: mk('Neutrinite pylon main account', SNEED_LEDGER, PYLON, null),
    buybackPylonMainSneed: mk('ICPCoins pylon main account', SNEED_LEDGER, BUYBACK_PYLON, null),
    treasurySneed: mk('DAO treasury (SNEED)', SNEED_LEDGER, GOVERNANCE, hexSub(TREASURY_SNEED_SUB)),
    mintingSneed: mk('SNEED minting account (burn)', SNEED_LEDGER, GOVERNANCE, null),
    rll: mk('RLL rewards (member rewards)', SNEED_LEDGER, RLL, null),
    defi: mk('Sneed DeFi canister', ICP_LEDGER, DEFI, null),
    defiFees: mk('Sneed DeFi canister (its ICPSwap fee subaccount)', ICP_LEDGER, DEFI, principalSub(DEFI)),
};
const byIcpHex = new Map(); const byKey = new Map();
for (const a of Object.values(ACCOUNTS)) { byIcpHex.set(a.icpHex, a.name); byKey.set(a.key, a.name); }
const byOwner = new Map([[SNEED_ICP_POOL, 'SNEED/ICP pool (ICPSwap)'], [NNS_GOVERNANCE, 'NNS governance'], [PYLON, 'Neutrinite pylon (another node)'], [BUYBACK_PYLON, 'ICPCoins pylon (another node)'], [DEFI, 'Sneed DeFi canister (a subaccount)']]);

/// Human name for a counterparty ({ hex } on ICP, { owner, sub } on SNEED), or null.
export function nameFor(cp) {
    if (!cp) return null;
    if (cp.hex) return byIcpHex.get(cp.hex) || null;
    return byKey.get(`${cp.owner}:${cp.sub || ''}`) || byOwner.get(cp.owner) || null;
}
export const isPylonMain = (cp) => !!cp && (cp.hex ? [ACCOUNTS.pylonMainIcp.icpHex, ACCOUNTS.buybackPylonMainIcp.icpHex].includes(cp.hex) : [ACCOUNTS.pylonMainSneed.key, ACCOUNTS.buybackPylonMainSneed.key].includes(`${cp.owner}:${cp.sub || ''}`));
const cpIs = (cp, acct) => !!cp && (cp.hex ? cp.hex === acct.icpHex : `${cp.owner}:${cp.sub || ''}` === acct.key);

// ---- reading an account's history ----
const cache = new Map();
const TTL = 10 * 60 * 1000;
const MAX_ROWS = 6000;
const subHex = (s) => (s && s.length ? hex(Uint8Array.from(s)) : '');

/// Every transaction of an account since `sinceMs` (0 = all), newest first:
/// { rows: [{ id, at (ms), kind, dir ('in'|'out'|'self'), amount, fee, cp }], cutAt }.
/// `cutAt` is null when the period was read in full; when the account has more than MAX_ROWS
/// transactions in it (and is not marked `full`), the rows stop at the newest MAX_ROWS and
/// `cutAt` is the time (ms) of the oldest row read.
export async function fetchAccountRows(acct, sinceMs, onProgress) {
    const ck = `${acct.key}:${acct.ledger}:${sinceMs}`;
    const c = cache.get(ck);
    if (c && Date.now() - c.at < TTL) return c.read;
    const owner = Principal.fromText(acct.owner);
    const rows = [];
    let start = [];
    const page = 500n;
    let complete = false;
    const max = acct.full ? Infinity : MAX_ROWS;
    while (rows.length < max) {
        let txs; let oldest;
        if (acct.ledger === ICP_LEDGER) {
            const index = await actor(icpIndexIdl, ICP_INDEX);
            const r = await index.get_account_transactions({ account: { owner, subaccount: acct.sub ? [acct.sub] : [] }, start, max_results: page });
            if ('Err' in r) throw new Error(r.Err.message);
            txs = r.Ok.transactions.map(({ id, transaction: t }) => {
                const k = Object.keys(t.operation)[0]; const op = t.operation[k];
                const at = Number(t.timestamp?.[0]?.timestamp_nanos ?? 0n) / 1e6;
                const from = op.from || null; const to = op.to || null;
                const isOut = from === acct.icpHex; const isIn = to === acct.icpHex;
                return { id: BigInt(id), at, kind: k.toLowerCase(), dir: isOut && isIn ? 'self' : isOut ? 'out' : 'in', amount: BigInt(op.amount?.e8s ?? 0n), fee: BigInt(op.fee?.e8s ?? 0n), cp: isOut ? (to ? { hex: to } : null) : (from ? { hex: from } : null) };
            }).filter((t) => t.kind !== 'approve');
            oldest = r.Ok.oldest_tx_id?.[0];
        } else {
            const index = await actor(indexIdl, SNEED_INDEX);
            const r = await index.get_account_transactions({ account: { owner, subaccount: acct.sub ? [acct.sub] : [] }, start, max_results: page });
            if ('Err' in r) throw new Error(r.Err.message);
            txs = r.Ok.transactions.map(({ id, transaction: t }) => {
                const x = t.transfer?.[0] || t.mint?.[0] || t.burn?.[0];
                const key = (a) => (a ? `${a.owner.toText()}:${subHex(a.subaccount?.[0])}` : null);
                const from = x?.from ? key(x.from) : null; const to = x?.to ? key(x.to) : null;
                const isOut = from === acct.key; const isIn = to === acct.key;
                const cpAcc = isOut ? x?.to : x?.from;
                return { id: BigInt(id), at: Number(t.timestamp) / 1e6, kind: t.kind, dir: isOut && isIn ? 'self' : isOut ? 'out' : t.kind === 'burn' && isOut ? 'out' : 'in', amount: BigInt(x?.amount ?? 0n), fee: BigInt(x?.fee?.[0] ?? 0n), cp: cpAcc ? { owner: cpAcc.owner.toText(), sub: subHex(cpAcc.subaccount?.[0]) } : (t.kind === 'burn' ? { owner: GOVERNANCE, sub: '' } : null) };
            }).filter((t) => t.kind !== 'approve');
            oldest = r.Ok.oldest_tx_id?.[0];
        }
        for (const t of txs) { if (sinceMs && t.at < sinceMs) { txs = null; break; } rows.push(t); }
        onProgress?.(rows.length);
        if (txs === null || txs.length === 0) { complete = true; break; }
        const minId = rows[rows.length - 1].id;
        if (oldest === undefined || oldest === null || BigInt(oldest) >= minId || minId === 0n) { complete = true; break; }
        start = [minId - 1n];
    }
    const read = { rows, cutAt: complete || !rows.length ? null : rows[rows.length - 1].at };
    cache.set(ck, { at: Date.now(), read });
    return read;
}

// ---- the flows: what each station really receives and sends ----
/// A line is one measurable flow: rows of one account, filtered. `virtual` lines are inside a
/// pylon and leave no transactions: they are shown as a note, never summed.
export const SECTIONS = [
    {
        key: 'neuron', title: '1 · The 2-year ICP neuron', token: 'ICP',
        intro: 'The DAO\'s NNS neuron, controlled by a Neutrinite vector. The NNS mints its maturity into the node\'s maturity account about once a day; the pylon sweeps it into its main account and hands it to the ICP splitter inside the pylon, where it leaves no transaction. A quarter comes back to the neuron as new stake.',
        account: ACCOUNTS.maturity, link: `https://vectors.neuronpool.com/vectors/${GOVERNANCE}/1`, dashboard: `https://dashboard.internetcomputer.org/neuron/${NEURON_2Y}`,
        lines: [
            { key: 'maturity', title: 'Maturity minted by the NNS', dir: 'in', account: ACCOUNTS.maturity, keep: (r) => r.kind === 'mint' },
            { key: 'stake', title: 'Stake deposits (the DAO\'s original stake, swept into the neuron)', dir: 'in', account: ACCOUNTS.neuronSource, keep: (r) => r.dir === 'in' && !isPylonMain(r.cp), aside: true },
        ],
        virtual: ['A quarter of the ICP splitter\'s output is staked back into this neuron inside the pylon (no transaction).'],
    },
    {
        key: 'icpSplitter', title: '2 · The ICP splitter', token: 'ICP',
        intro: 'Splits what it gets by the configured shares: half to the SNEED buyback vector on the ICPCoins pylon, a quarter to the DAO\'s ICP treasury, a quarter back into the neuron. The maturity reaches it inside the pylon; product revenue reaches it as deposits to its account. Its outputs are visible where they land.',
        account: ACCOUNTS.splitterSource, link: `https://vectors.neuronpool.com/vectors/${GOVERNANCE}/6`, splitsNode: 6,
        lines: [
            { key: 'maturity', title: 'Maturity from the neuron (inside the pylon)', dir: 'in', account: ACCOUNTS.maturity, keep: (r) => r.kind === 'mint' },
            { key: 'deposits', title: 'Deposits: product revenue and other ICP sent here', dir: 'in', account: ACCOUNTS.splitterSource, keep: (r) => r.dir === 'in' && !isPylonMain(r.cp) },
            { key: 'toBuyback', title: 'To the SNEED buyback vector', dir: 'out', account: ACCOUNTS.buybackSource, keep: (r) => r.dir === 'in' && cpIs(r.cp, ACCOUNTS.pylonMainIcp), dest: ACCOUNTS.buybackSource },
            { key: 'toTreasury', title: 'To the DAO\'s ICP treasury', dir: 'out', account: ACCOUNTS.treasuryIcp, keep: (r) => r.dir === 'in' && cpIs(r.cp, ACCOUNTS.pylonMainIcp), dest: ACCOUNTS.treasuryIcp },
        ],
        virtual: ['The quarter that goes back into the neuron stays inside the pylon: it never appears on the ledger, so "out" below is the other three quarters.'],
    },
    {
        key: 'buyback', title: '3 · The SNEED buyback vector', token: 'ICP', token2: 'SNEED',
        intro: 'ICP arriving at its account on the ICPCoins pylon is swept and spent on the SNEED/ICP pool from the pylon\'s main account, so the swaps themselves are not separable on the ledger. What the swaps bought is: the SNEED that the ICPCoins pylon sends on to the SNEED splitter.',
        account: ACCOUNTS.buybackSource, link: `https://beta.icpcoins.com/#/vector/modify/${BUYBACK_PYLON}/exchange/18`,
        lines: [
            { key: 'icpIn', title: 'ICP handed to the buyback', dir: 'in', account: ACCOUNTS.buybackSource, keep: (r) => r.dir === 'in' && !isPylonMain(r.cp) || (r.dir === 'in' && cpIs(r.cp, ACCOUNTS.pylonMainIcp)) },
            { key: 'sneedOut', title: 'SNEED bought and sent to the SNEED splitter', dir: 'out', token: 'SNEED', account: ACCOUNTS.sneedSplitterSource, keep: (r) => r.dir === 'in' && cpIs(r.cp, ACCOUNTS.buybackPylonMainSneed), dest: ACCOUNTS.sneedSplitterSource },
        ],
    },
    {
        key: 'sneedSplitter', title: '4 · The SNEED splitter', token: 'SNEED',
        intro: 'Splits the bought SNEED by the configured shares: burned (sent to the ledger\'s minting account, which destroys it), kept in the DAO treasury, and paid to the RLL rewards canister for voters. The deposit arrives at its account; the three outputs leave from the pylon\'s main SNEED account.',
        account: ACCOUNTS.sneedSplitterSource, link: `https://vectors.neuronpool.com/vectors/${GOVERNANCE}/45`, splitsNode: 45,
        lines: [
            { key: 'in', title: 'SNEED from the buyback', dir: 'in', account: ACCOUNTS.sneedSplitterSource, keep: (r) => r.dir === 'in' && !isPylonMain(r.cp) || (r.dir === 'in' && cpIs(r.cp, ACCOUNTS.buybackPylonMainSneed)) },
            { key: 'burn', title: 'Burned', dir: 'out', account: ACCOUNTS.pylonMainSneed, keep: (r) => r.kind === 'burn', dest: ACCOUNTS.mintingSneed, burn: true },
            { key: 'treasury', title: 'To the DAO\'s SNEED treasury', dir: 'out', account: ACCOUNTS.pylonMainSneed, keep: (r) => r.dir === 'out' && cpIs(r.cp, ACCOUNTS.treasurySneed), dest: ACCOUNTS.treasurySneed },
            { key: 'rll', title: 'To RLL rewards', dir: 'out', account: ACCOUNTS.pylonMainSneed, keep: (r) => r.dir === 'out' && cpIs(r.cp, ACCOUNTS.rll), dest: ACCOUNTS.rll },
        ],
        note: 'The burns, treasury and RLL transfers are read from the Neutrinite pylon\'s main SNEED account; Sneed\'s splitter is the only node known to send SNEED to those three places.',
    },
];

/// Totals and a per-day series for one line's rows.
export function summarizeLine(rows, decimals) {
    let total = 0n; let fees = 0n;
    const byDay = new Map();
    for (const r of rows) {
        total += r.amount; fees += r.fee;
        const day = new Date(r.at).toISOString().slice(0, 10);
        byDay.set(day, (byDay.get(day) || 0) + Number(r.amount) / 10 ** decimals);
    }
    return { total, fees, n: rows.length, byDay };
}

/// The NNS neuron's facts.
export async function fetchNeuron() {
    const gov = await actor(nnsGovIdl, NNS_GOVERNANCE);
    const r = await gov.get_neuron_info(NEURON_2Y);
    if ('Err' in r) throw new Error(r.Err.error_message || 'NNS governance returned an error');
    return r.Ok;
}

/// A splitter node's live destinations with shares: [{ owner, sub, ledger, pct, name }].
export async function fetchSplits(node, exchange = false) {
    const a = await actor(exchange ? exVectorIdl : vectorIdl, exchange ? BUYBACK_PYLON : PYLON);
    const nodes = await a.icrc55_get_nodes([{ id: node }]);
    const info = nodes?.[0]?.[0];
    if (!info) return [];
    const shares = info.custom?.[0]?.devefi_split?.variables?.split || [];
    return (info.destinations || []).map((d, i) => {
        const acc = d.endpoint?.ic?.account?.[0];
        const owner = acc?.owner?.toText?.() || '';
        const sub = acc?.subaccount?.[0] ? hex(Uint8Array.from(acc.subaccount[0])) : '';
        const ledger = d.endpoint?.ic?.ledger?.toText?.() || '';
        const pct = Number(shares[i] ?? parseFloat(d.name) ?? 0);
        return { owner, sub, ledger, pct, key: `${owner}:${sub}`, name: nameFor({ owner, sub }) || d.name || owner };
    }).filter((d) => d.pct > 0);
}
