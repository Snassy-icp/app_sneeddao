// The token safety tree for one ICRC ledger. Gates first (controllers,
// code): everything a ledger reports is only a claim unless its code is known
// and nobody unexpected can replace it. Then the dimensions behind the gates:
// minting, supply, distribution, locks, liquidity, cycles. See
// spec/token_safety.md for the model.
import { CanisterStatus } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { decodeIcrcAccount } from '@dfinity/ledger-icrc';
import { idlFactory as snswIdl } from 'declarations/nns_snsw/nns_snsw.did.js';
import { idlFactory as rootIdl } from 'external/sns_root/sns_root.did.js';
import { idlFactory as factoryIdl } from 'external/icp_swap_factory/icp_swap_factory.did.js';
import { idlFactory as poolIdl } from 'external/icp_swap/icp_swap.did.js';
import { idlFactory as sneedLockIdl } from 'declarations/sneed_lock/sneed_lock.did.js';
import { actor, getAgent, ledgerIdl, IDL } from '../health/agent.js';
import { verifyTip, createIcrc3Actor } from '../utils/icrc3/client.js';
import { holdersByOwner } from './scan.js';
import { scanLedgerOffThread } from './scanClient.js';
import { idlFactory as governanceIdl } from 'external/sns_governance/sns_governance.did.js';

export const IDS = {
    snsw: 'qaa6y-5yaaa-aaaaa-aaafa-cai',
    nnsRoot: 'r7inp-6aaaa-aaaaa-aaabq-cai',
    icpLedger: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
    sneedLock: 'pqsms-lqaaa-aaaal-ajjza-cai',
    sneedRoot: 'fp274-iaaaa-aaaaq-aacha-cai',
    icpswapFactory: '4mmnk-kiaaa-aaaag-qbllq-cai',
    ckusdc: 'xevnm-gaaaa-aaaar-qafnq-cai',
};
/// NNS system canisters: nothing can transact as them, so a minting account
/// owned by one of them can never mint.
export const NNS_SYSTEM = { 'r7inp-6aaaa-aaaaa-aaabq-cai': 'NNS root', 'rno2w-sqaaa-aaaaa-aaacq-cai': 'NNS lifeline', 'rrkah-fqaaa-aaaaa-aaaaq-cai': 'NNS governance', 'rwlgt-iiaaa-aaaaa-aaaaa-cai': 'NNS registry', 'rkp4c-7iaaa-aaaaa-aaaca-cai': 'cycles minting canister', 'ryjl3-tyaaa-aaaaa-aaaba-cai': 'ICP ledger', 'qaa6y-5yaaa-aaaaa-aaafa-cai': 'SNS wasm canister', 'qoctq-giaaa-aaaaa-aaaea-cai': 'NNS dapp' };
/// The blackhole canisters: immutable controllers that expose canister_status.
export const BLACKHOLES = { 'e3mmv-5qaaa-aaaah-aadma-cai': 'blackhole v0', '5vdms-kaaaa-aaaap-aa3uq-cai': 'blackhole v2' };
export const DASHBOARD = (id) => `https://dashboard.internetcomputer.org/canister/${id}`;
const T = 1e12;
const SCAN_TIMEOUT_MS = 20 * 60 * 1000; // leaves that wait for the block scan

const pass = (summary, details, link) => ({ status: 'pass', summary, details, link });
const warn = (summary, details, link) => ({ status: 'warn', summary, details, link });
const fail = (summary, details, link) => ({ status: 'fail', summary, details, link });
const skip = (summary, details, link) => ({ status: 'skip', summary, details, link });
const opt = (v) => (Array.isArray(v) ? v[0] : v);
const fmtT = (c) => `${(Number(c) / T).toFixed(2)} T`;
const fmtBytes = (n) => { const x = Number(n); return x >= 1e9 ? `${(x / 1e9).toFixed(2)} GB` : x >= 1e6 ? `${(x / 1e6).toFixed(1)} MB` : `${Math.round(x / 1e3)} kB`; };
const fmtUnits = (n, decimals, digits = 2) => (Number(n) / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: digits });
const pct = (part, whole) => (whole > 0n ? Number((part * 10000n) / whole) / 100 : 0);
const days = (ms) => Math.round(ms / 86400e3);
const nsToMs = (ns) => Number(BigInt(ns) / 1000000n);
const hexOf = (v) => (typeof v === 'string' ? v : v ? Array.from(new Uint8Array(v), (b) => b.toString(16).padStart(2, '0')).join('') : null);

// ---- small interfaces ----
const blackholeIdl = ({ IDL }) => IDL.Service({
    canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [IDL.Record({
        status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }), memory_size: IDL.Nat, cycles: IDL.Nat,
        settings: IDL.Record({ freezing_threshold: IDL.Nat, controllers: IDL.Vec(IDL.Principal), memory_allocation: IDL.Nat, compute_allocation: IDL.Nat }),
        module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
    })], []),
});
const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const tokenIdl = ({ IDL }) => IDL.Service({
    icrc1_metadata: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Text, IDL.Variant({ Nat: IDL.Nat, Int: IDL.Int, Text: IDL.Text, Blob: IDL.Vec(IDL.Nat8) })))], ['query']),
    icrc1_total_supply: IDL.Func([], [IDL.Nat], ['query']),
    icrc1_minting_account: IDL.Func([], [IDL.Opt(Account)], ['query']),
    icrc1_supported_standards: IDL.Func([], [IDL.Vec(IDL.Record({ name: IDL.Text, url: IDL.Text }))], ['query']),
    icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ['query']),
    icrc3_get_archives: IDL.Func([IDL.Record({ from: IDL.Opt(IDL.Principal) })], [IDL.Vec(IDL.Record({ canister_id: IDL.Principal, start: IDL.Nat, end: IDL.Nat }))], ['query']),
    archives: IDL.Func([], [IDL.Vec(IDL.Record({ canister_id: IDL.Principal, block_range_start: IDL.Nat, block_range_end: IDL.Nat }))], ['query']),
    icrc106_get_index_principal: IDL.Func([], [IDL.Variant({ Ok: IDL.Principal, Err: IDL.Reserved })], ['query']),
});

const quiet = async (p, fallback) => { try { return await p; } catch { return fallback; } };

// ---- loaders (memoised per run through ctx.load) ----
const loaders = {
    meta: (ledgerId) => async (ctx) => {
        const l = await actor(tokenIdl, ledgerId);
        let metadata, supply, minting, standards;
        try {
            [metadata, supply, minting, standards] = await Promise.all([
                ctx.call(l.icrc1_metadata(), 'metadata'), ctx.call(l.icrc1_total_supply(), 'total supply'),
                quiet(ctx.call(l.icrc1_minting_account(), 'minting account'), null), quiet(ctx.call(l.icrc1_supported_standards(), 'standards'), []),
            ]);
        } catch (e) {
            // Say why, not just "call failed": a deleted ledger has no code.
            const st = await quiet(ctx.load(`status:${ledgerId}`, loaders.status(ledgerId)), null);
            if (st && !st.moduleHash) throw new Error('The ledger has no code installed: the token is dead');
            throw new Error(`The ledger does not answer as an ICRC-1 ledger (${e?.message || e})`);
        }
        const m = Object.fromEntries(metadata.map(([k, v]) => [k, Object.values(v)[0]]));
        return {
            symbol: m['icrc1:symbol'] || '?', name: m['icrc1:name'] || '?', decimals: Number(m['icrc1:decimals'] ?? 8), fee: BigInt(m['icrc1:fee'] ?? 0),
            supply, minting: opt(minting) || null, standards: standards.map((s) => s.name), metadata: m,
        };
    },
    status: (canisterId) => async () => {
        const m = await CanisterStatus.request({ canisterId: Principal.fromText(canisterId), agent: getAgent(canisterId), paths: ['controllers', 'module_hash'] });
        return { controllers: (m.get('controllers') || []).map((p) => p.toText()), moduleHash: hexOf(m.get('module_hash')) };
    },
    /// Every ledger-suite version the NNS ever approved, plus every deployed SNS.
    snsw: async (ctx) => {
        const w = await actor(snswIdl, IDS.snsw);
        const [steps, deployed] = await Promise.all([
            ctx.call(w.list_upgrade_steps({ limit: 500, starting_at: [], sns_governance_canister_id: [] }), 'SNS-W upgrade steps'),
            ctx.call(w.list_deployed_snses({}), 'deployed SNSes'),
        ]);
        const ledger = new Map(); const archive = new Map(); const index = new Map();
        steps.steps.forEach((s, i) => {
            const v = opt(s.pretty_version); if (!v) return;
            if (!ledger.has(v.ledger_wasm_hash)) ledger.set(v.ledger_wasm_hash, i);
            if (!archive.has(v.archive_wasm_hash)) archive.set(v.archive_wasm_hash, i);
            if (!index.has(v.index_wasm_hash)) index.set(v.index_wasm_hash, i);
        });
        const snses = deployed.instances.map((d) => ({ root: opt(d.root_canister_id)?.toText(), governance: opt(d.governance_canister_id)?.toText(), ledger: opt(d.ledger_canister_id)?.toText(), index: opt(d.index_canister_id)?.toText(), swap: opt(d.swap_canister_id)?.toText() }));
        return { ledger, archive, index, versions: steps.steps.length, snses, byRoot: new Map(snses.map((s) => [s.root, s])), byLedger: new Map(snses.map((s) => [s.ledger, s])) };
    },
    archives: (ledgerId) => async (ctx) => {
        const l = await actor(tokenIdl, ledgerId);
        const a3 = await quiet(ctx.call(l.icrc3_get_archives({ from: [] }), 'icrc3 archives'), null);
        if (a3) return a3.map((a) => ({ id: a.canister_id.toText(), start: a.start, end: a.end }));
        const legacy = await quiet(ctx.call(l.archives(), 'archives'), []);
        return legacy.map((a) => ({ id: a.canister_id.toText(), start: a.block_range_start, end: a.block_range_end }));
    },
    index: (ledgerId) => async (ctx) => {
        const l = await actor(tokenIdl, ledgerId);
        const r = await quiet(ctx.call(l.icrc106_get_index_principal(), 'index principal'), null);
        if (r && 'Ok' in r) return { id: r.Ok.toText(), how: 'ICRC-106' };
        const sns = (await ctx.load('snsw', loaders.snsw)).byLedger.get(ledgerId);
        if (sns?.index) return { id: sns.index, how: 'SNS registry' };
        return null;
    },
    scan: (ledgerId) => async (ctx) => {
        try { return await scanLedgerOffThread(ledgerId, { maxBlocks: ctx.config.maxScanBlocks, onProgress: ctx.config.onProgress, timeoutMs: ctx.config.callTimeoutSec * 1000 }); }
        catch (e) { return { skipped: true, total: null, reason: `the log could not be read (${e?.message || e})` }; }
    },
    /// Supply the log does not account for, and the accounts that reveal it:
    /// anyone who spent tokens the log never gave them was seeded at genesis.
    /// Their real balances are queried so the distribution can include them.
    untracked: (ledgerId) => async (ctx) => {
        const [m, scan] = await Promise.all([ctx.load('meta', loaders.meta(ledgerId)), ctx.load('scan', loaders.scan(ledgerId))]);
        if (scan.skipped) return null;
        const hidden = m.supply > scan.netSupply ? m.supply - scan.netSupply : 0n;
        const l = await actor(ledgerIdl, ledgerId);
        const deficits = [...scan.deficits.entries()].map(([key, min]) => ({ key, owner: scan.owners.get(key) || key, deficit: -min })).sort((a, b) => (a.deficit < b.deficit ? 1 : -1));
        await Promise.all(deficits.slice(0, 15).map(async (d) => {
            try {
                const a = decodeIcrcAccount(d.key);
                d.actual = await ctx.call(l.icrc1_balance_of({ owner: a.owner, subaccount: a.subaccount ? [a.subaccount] : [] }), `balance of ${d.key}`);
            } catch { d.actual = null; }
        }));
        return { hidden, share: pct(hidden, m.supply), deficits };
    },
    /// The DAO's name from its governance metadata.
    snsName: (sns) => async (ctx) => {
        const g = await actor(governanceIdl, sns.governance);
        const m = await quiet(ctx.call(g.get_metadata({}), 'SNS metadata'), null);
        return opt(m?.name) || null;
    },
    locks: (ledgerId) => async (ctx) => {
        const lock = await actor(sneedLockIdl, IDS.sneedLock);
        const all = await ctx.call(lock.get_ledger_token_locks(Principal.fromText(ledgerId)), 'Sneed Lock token locks');
        const now = Date.now();
        return all.map(([owner, , l]) => ({ owner: owner.toText(), amount: BigInt(l.amount), expiryMs: nsToMs(l.expiry), lockId: Number(l.lock_id) })).filter((l) => l.expiryMs > now);
    },
    positionLocks: (ledgerId) => async (ctx) => {
        const lock = await actor(sneedLockIdl, IDS.sneedLock);
        const all = await ctx.call(lock.get_token_position_locks(Principal.fromText(ledgerId)), 'Sneed Lock position locks');
        const now = Date.now();
        return all.map(([owner, pool, p]) => ({ owner: owner.toText(), pool: pool.toText(), positionId: BigInt(p.position_id), expiryMs: nsToMs(p.expiry), lockId: Number(p.lock_id), token0: p.token0.toText(), token1: p.token1.toText() })).filter((l) => l.expiryMs > now);
    },
    allPools: async (ctx) => {
        const f = await actor(factoryIdl, IDS.icpswapFactory);
        const r = await ctx.call(f.getPools(), 'ICPSwap pools', 90);
        if (!('ok' in r)) throw new Error('ICPSwap factory returned an error');
        return r.ok;
    },
    /// ICPSwap pools that trade this token, with live metadata and balances.
    pools: (ledgerId) => async (ctx) => {
        const all = await ctx.load('allPools', loaders.allPools);
        const mine = all.filter((p) => p.token0.address === ledgerId || p.token1.address === ledgerId);
        return Promise.all(mine.map(async (p) => {
            const id = p.canisterId.toText();
            const pool = await actor(poolIdl, id);
            const meta = await ctx.call(pool.metadata(), `pool ${id} metadata`);
            if (!('ok' in meta)) return { id, token0: p.token0.address, token1: p.token1.address, fee: Number(p.fee), error: 'metadata failed' };
            return { id, token0: p.token0.address, token1: p.token1.address, fee: Number(p.fee), tick: Number(meta.ok.tick), sqrtPriceX96: BigInt(meta.ok.sqrtPriceX96), liquidity: BigInt(meta.ok.liquidity) };
        }));
    },
    balance: (ledgerId, owner) => async (ctx) => {
        const l = await actor(ledgerIdl, ledgerId);
        return ctx.call(l.icrc1_balance_of({ owner: Principal.fromText(owner), subaccount: [] }), `balance of ${owner}`);
    },
    /// ICP in USD from the deepest ICPSwap ICP/ckUSDC pool (chain data, no oracle).
    icpUsd: async (ctx) => {
        const all = await ctx.load('allPools', loaders.allPools);
        const pairs = all.filter((p) => [p.token0.address, p.token1.address].includes(IDS.icpLedger) && [p.token0.address, p.token1.address].includes(IDS.ckusdc));
        if (pairs.length === 0) return null;
        const icp = await actor(ledgerIdl, IDS.icpLedger);
        const scored = await Promise.all(pairs.map(async (p) => ({ p, icpBal: await quiet(ctx.call(icp.icrc1_balance_of({ owner: p.canisterId, subaccount: [] }), 'pool ICP balance'), 0n) })));
        const best = scored.sort((a, b) => (a.icpBal < b.icpBal ? 1 : -1))[0].p;
        const pool = await actor(poolIdl, best.canisterId.toText());
        const meta = await ctx.call(pool.metadata(), 'ICP/ckUSDC pool metadata');
        if (!('ok' in meta)) return null;
        const raw = (Number(meta.ok.sqrtPriceX96) / 2 ** 96) ** 2; // token1 per token0 in base units
        const usdPerIcp = best.token0.address === IDS.icpLedger ? raw * 1e8 / 1e6 : (1 / raw) * 1e8 / 1e6;
        return Number.isFinite(usdPerIcp) && usdPerIcp > 0 ? usdPerIcp : null;
    },
    rootSummary: (rootId) => async (ctx) => {
        const root = await actor(rootIdl, rootId);
        const res = await ctx.call(root.get_sns_canisters_summary({ update_canister_list: [] }), 'SNS root canister summary', 90);
        const out = new Map();
        const add = (s) => { const id = opt(s?.canister_id); const st = opt(s?.status); if (id && st) out.set(id.toText(), { cycles: st.cycles, memory: st.memory_size, running: Object.keys(st.status)[0] }); };
        for (const role of ['root', 'swap', 'ledger', 'index', 'governance']) add(opt(res[role]));
        for (const s of res.archives) add(s);
        for (const s of res.dapps) add(s);
        return out;
    },
};

/// "Sneed DAO (SNS root fp274-…)" for a deployed SNS.
async function daoLabel(sns, ctx) {
    const name = await ctx.load(`snsname:${sns.root}`, loaders.snsName(sns));
    const base = name ? (/\bdao\b/i.test(name) ? name : `${name} DAO`) : 'an unnamed SNS DAO';
    return `${base} (SNS root ${sns.root})`;
}

// ---- controller classification ----
async function classifyControllers(controllers, ctx) {
    const snsw = await ctx.load('snsw', loaders.snsw);
    if (controllers.length === 0) return { grade: 'pass', label: 'Blackholed (no controllers)', kind: 'none' };
    if (controllers.every((c) => BLACKHOLES[c])) return { grade: 'pass', label: `Blackholed through ${controllers.map((c) => BLACKHOLES[c]).join(', ')} (status observable)`, kind: 'blackhole' };
    if (controllers.length === 1 && controllers[0] === IDS.nnsRoot) return { grade: 'pass', label: 'Controlled by the NNS (NNS root)', kind: 'nns' };
    if (controllers.length === 1 && snsw.byRoot.has(controllers[0])) {
        const sns = snsw.byRoot.get(controllers[0]);
        return { grade: 'pass', label: `Controlled by ${await daoLabel(sns, ctx)}`, kind: 'sns', sns };
    }
    const named = await Promise.all(controllers.map(async (c) => (BLACKHOLES[c] ? BLACKHOLES[c] : snsw.byRoot.has(c) ? await daoLabel(snsw.byRoot.get(c), ctx) : c === IDS.nnsRoot ? 'NNS root' : c)));
    const canisters = controllers.filter((c) => c.length === 27);
    const users = controllers.filter((c) => c.length !== 27);
    if (controllers.length > 1 && controllers.some((c) => BLACKHOLES[c] || snsw.byRoot.has(c))) {
        return { grade: 'fail', label: `Mixed controllers: ${named.join(', ')}. The DAO or blackhole does not control this alone`, kind: 'mixed' };
    }
    return { grade: 'fail', label: `Controlled by ${users.length ? `${users.length} user principal(s)` : ''}${users.length && canisters.length ? ' and ' : ''}${canisters.length ? `${canisters.length} canister(s)` : ''}: ${named.join(', ')}`, kind: 'other' };
}

function classifyHash(hash, kind, snsw, controllersKind) {
    if (!hash) return { grade: 'fail', label: 'No code installed' };
    const v = snsw[kind]?.get(hash);
    if (v !== undefined) return { grade: 'pass', label: `DFINITY ICRC ledger suite ${kind}, NNS-approved version ${v + 1} of ${snsw.versions}` };
    if (controllersKind === 'nns') return { grade: 'pass', label: 'Installed by NNS proposal (not in the SNS version list)' };
    return { grade: 'fail', label: 'Unknown wasm: not an NNS-approved ledger suite build. The registry will know more sources later' };
}

// ---- liquidity math (ICPSwap v3) ----
const sqrtAtTick = (tick) => 1.0001 ** (tick / 2);
function positionAmounts(liquidity, tickLower, tickUpper, sqrtPriceX96) {
    const L = Number(liquidity); const sp = Number(sqrtPriceX96) / 2 ** 96; const sl = sqrtAtTick(tickLower); const su = sqrtAtTick(tickUpper);
    if (sp <= sl) return { amount0: L * (su - sl) / (sl * su), amount1: 0, inRange: false };
    if (sp >= su) return { amount0: 0, amount1: L * (su - sl), inRange: false };
    return { amount0: L * (su - sp) / (sp * su), amount1: L * (sp - sl), inRange: true };
}

// ---- the tree ----
export function buildTokenTree(ledgerId, config) {
    const c = config;
    const meta = (ctx) => ctx.load('meta', loaders.meta(ledgerId));
    const status = (ctx, id) => ctx.load(`status:${id}`, loaders.status(id));

    const controllerLeaf = (id, name, idOf, extra) => ({
        id: `ctl:${name}`, name, run: async (ctx) => {
            const cid = idOf ? await idOf(ctx) : id;
            if (!cid) return extra?.missing ? skip(extra.missing) : fail('Canister not found');
            const st = await status(ctx, cid);
            const cls = await classifyControllers(st.controllers, ctx);
            const details = { canister: cid, controllers: st.controllers, module_hash: st.moduleHash };
            return { status: cls.grade, summary: cls.label, details, link: DASHBOARD(cid) };
        },
    });
    const codeLeaf = (kind, name, idOf) => ({
        id: `code:${name}`, name, run: async (ctx) => {
            const cid = idOf ? await idOf(ctx) : ledgerId;
            if (!cid) return skip('No such canister');
            const [st, snsw] = await Promise.all([status(ctx, cid), ctx.load('snsw', loaders.snsw)]);
            const cls = await classifyControllers(st.controllers, ctx);
            const h = classifyHash(st.moduleHash, kind, snsw, cls.kind);
            return { status: h.grade, summary: h.label, details: { canister: cid, module_hash: st.moduleHash }, link: DASHBOARD(cid) };
        },
    });

    const gates = {
        id: 'gates', name: 'Gates: who controls the code, and which code',
        children: [
            {
                id: 'controllers', name: 'Controllers',
                children: async (ctx) => {
                    const archives = await ctx.load('archives', loaders.archives(ledgerId));
                    return [
                        controllerLeaf(ledgerId, 'Ledger'),
                        ...(archives.length ? archives.map((a) => controllerLeaf(a.id, `Archive ${a.id}`)) : [{ id: 'ctl:noarchive', name: 'Archives', run: async () => pass('No archive canisters yet') }]),
                        controllerLeaf(null, 'Index', async (ctx2) => (await ctx2.load('index', loaders.index(ledgerId)))?.id, { missing: 'No index canister announced (ICRC-106) and not an SNS ledger' }),
                    ];
                },
            },
            {
                id: 'code', name: 'Code',
                children: async (ctx) => {
                    const archives = await ctx.load('archives', loaders.archives(ledgerId));
                    return [
                        codeLeaf('ledger', 'Ledger wasm'),
                        ...archives.map((a) => codeLeaf('archive', `Archive ${a.id} wasm`, async () => a.id)),
                        codeLeaf('index', 'Index wasm', async (ctx2) => (await ctx2.load('index', loaders.index(ledgerId)))?.id),
                        {
                            id: 'code:standards', name: 'Standards announced', run: async (ctx2) => {
                                const m = await meta(ctx2);
                                const has = (s) => m.standards.includes(s);
                                const details = { standards: m.standards };
                                if (!has('ICRC-1')) return fail('Does not announce ICRC-1', details);
                                if (!has('ICRC-3')) return warn(`ICRC-1${has('ICRC-2') ? ', ICRC-2' : ''} without ICRC-3: history cannot be verified against a certified log`, details);
                                return pass(m.standards.join(', '), details);
                            },
                        },
                        {
                            id: 'code:tip', name: 'Block log certified', run: async (ctx2) => {
                                const m = await meta(ctx2);
                                if (!m.standards.includes('ICRC-3')) return skip('No ICRC-3');
                                const tip = await ctx2.call(verifyTip(Principal.fromText(ledgerId)), 'tip certificate');
                                return tip ? pass(`Certified tip at block ${tip.lastIndex}`) : fail('No tip certificate');
                            },
                        },
                    ];
                },
            },
        ],
    };

    const minting = {
        id: 'minting', name: 'Minting',
        children: [
            {
                id: 'mint:account', name: 'Minting account cannot mint at will', run: async (ctx) => {
                    const m = await meta(ctx);
                    if (!m.minting) return pass('No minting account: nothing can mint');
                    const owner = m.minting.owner.toText();
                    const details = { minting_account: owner, subaccount: opt(m.minting.subaccount) ? 'set' : 'default' };
                    if (owner === ledgerId) return pass('The ledger itself: no one can transact as it', details);
                    if (owner === '2vxsx-fae') return pass('The anonymous principal: cannot hold or move tokens', details);
                    if (NNS_SYSTEM[owner]) return pass(`The ${NNS_SYSTEM[owner]}: an NNS system canister that never transfers tokens`, details);
                    if (BLACKHOLES[owner]) return pass(`The ${BLACKHOLES[owner]} canister: it never transfers tokens`, details);
                    if (owner.length !== 27) return fail('A user principal: its holder can mint without limit', details);
                    const snsw = await ctx.load('snsw', loaders.snsw);
                    const sns = snsw.snses.find((s) => s.governance === owner);
                    if (sns) return pass(`The SNS governance of ${await daoLabel(sns, ctx)}: minting takes a proposal`, details);
                    const st = await quiet(status(ctx, owner), null);
                    if (st) {
                        details.minting_canister_controllers = st.controllers;
                        const cls = await classifyControllers(st.controllers, ctx);
                        if (cls.grade === 'pass') return pass(`A canister ${cls.label.toLowerCase()}`, details);
                        return warn(`A canister whose controllers can change it: ${cls.label}`, details);
                    }
                    return warn('A canister we could not inspect', details);
                },
            },
            {
                id: 'mint:untracked', name: 'Supply created outside the log', timeoutMs: SCAN_TIMEOUT_MS, run: async (ctx) => {
                    const [m, u] = await Promise.all([meta(ctx), ctx.load('untracked', loaders.untracked(ledgerId))]);
                    if (!u) { const scan = await ctx.load('scan', loaders.scan(ledgerId)); return skip(scan.reason || 'Log not scanned'); }
                    const known = u.deficits.filter((d) => d.actual !== null && d.actual !== undefined);
                    const knownSum = known.reduce((a, d) => a + d.actual, 0n);
                    const details = {
                        reported_supply: fmtUnits(m.supply, m.decimals, 0), supply_per_log: fmtUnits(m.supply - u.hidden, m.decimals, 0), outside_the_log: fmtUnits(u.hidden, m.decimals, 0), share_pct: u.share,
                        accounts_that_spent_unlogged_tokens: u.deficits.length,
                        revealed_accounts: u.deficits.slice(0, 15).map((d) => `${d.key}: spent at least ${fmtUnits(d.deficit, m.decimals, 0)} never minted in the log; holds ${d.actual !== null && d.actual !== undefined ? fmtUnits(d.actual, m.decimals, 0) : '?'} today`),
                        note: 'Ledgers that seed balances from their init arguments (most Motoko ledgers) create supply with no block; the DFINITY ledger suite writes mint blocks instead. Such supply is only revealed when it moves.',
                    };
                    if (u.hidden * 1000n <= m.supply) return pass('Every token traces back to a mint block', details);
                    const s = u.share >= c.topHolderFailPct ? 'fail' : 'warn';
                    return { status: s, summary: `${u.share.toFixed(2)}% of supply was created outside the log at genesis; ${u.deficits.length} account(s) have moved some of it (holding ${fmtUnits(knownSum, m.decimals, 0)} today), the rest sits in accounts the log cannot see`, details };
                },
            },
            {
                id: 'mint:history', name: 'Mints after genesis', timeoutMs: SCAN_TIMEOUT_MS, run: async (ctx) => {
                    const [m, scan] = await Promise.all([meta(ctx), ctx.load('scan', loaders.scan(ledgerId))]);
                    if (scan.skipped) return skip(scan.reason || `Log of ${scan.total.toLocaleString('en-US')} blocks not scanned (limit ${c.maxScanBlocks.toLocaleString('en-US')})`);
                    const first = scan.firstTs ? nsToMs(scan.firstTs) : null;
                    const later = scan.mintEvents.filter((e) => e.ts && first !== null && nsToMs(e.ts) - first > 86400e3);
                    const laterAmt = later.reduce((a, e) => a + e.amt, 0n);
                    const details = { mints_total: scan.mints, minted_total: fmtUnits(scan.minted, m.decimals), burned_total: fmtUnits(scan.burned, m.decimals), mints_after_first_day: later.length, minted_after_first_day: fmtUnits(laterAmt, m.decimals), last_mint: scan.mintEvents.length ? new Date(nsToMs(scan.mintEvents[scan.mintEvents.length - 1].ts)).toISOString() : null };
                    if (later.length === 0) return pass(`${scan.mints} mint(s), all within the first day`, details);
                    const share = pct(laterAmt, m.supply);
                    return (share > 10 ? warn : pass)(`${later.length} mint(s) after the first day, ${share.toFixed(1)}% of today's supply`, details);
                },
            },
        ],
    };

    const supply = {
        id: 'supply', name: 'Supply and metadata',
        children: [
            { id: 'supply:info', name: 'Token', run: async (ctx) => { const m = await meta(ctx); return pass(`${m.name} (${m.symbol}), ${m.decimals} decimals, fee ${fmtUnits(m.fee, m.decimals, 8)}, supply ${fmtUnits(m.supply, m.decimals, 0)}`, { metadata: m.metadata }); } },
            {
                id: 'supply:age', name: 'Age', timeoutMs: SCAN_TIMEOUT_MS, run: async (ctx) => {
                    const scan = await ctx.load('scan', loaders.scan(ledgerId));
                    if (scan.skipped) return skip('Log not scanned');
                    if (!scan.firstTs) return skip('No timestamps in the log');
                    const age = Date.now() - nsToMs(scan.firstTs);
                    return (age < 30 * 86400e3 ? warn : pass)(`${days(age)} days since the first block, ${scan.total.toLocaleString('en-US')} blocks`, { first_block: new Date(nsToMs(scan.firstTs)).toISOString(), last_block: scan.lastTs ? new Date(nsToMs(scan.lastTs)).toISOString() : null });
                },
            },
        ],
    };

    /// Accounts whose balances are not "holders": pools, locks, treasuries.
    const tagsOf = async (ctx) => {
        const [m, snsw, pools] = await Promise.all([meta(ctx), ctx.load('snsw', loaders.snsw), quiet(ctx.load('pools', loaders.pools(ledgerId)), [])]);
        const tags = new Map();
        if (m.minting) tags.set(m.minting.owner.toText(), 'minting account');
        tags.set(IDS.sneedLock, 'Sneed Lock (locked)');
        tags.set(ledgerId, 'the ledger');
        const sns = snsw.byLedger.get(ledgerId);
        if (sns) { const dao = await daoLabel(sns, ctx); tags.set(sns.governance, `governance of ${dao} (treasury and neurons)`); tags.set(sns.swap, `swap of ${dao}`); tags.set(sns.root, `root of ${dao}`); }
        for (const p of pools) tags.set(p.id, `ICPSwap pool ${p.token0 === ledgerId ? p.token1 : p.token0}`);
        return tags;
    };

    const distribution = {
        id: 'distribution', name: 'Distribution',
        children: async (ctx) => {
            const scan = await ctx.load('scan', loaders.scan(ledgerId));
            if (scan.skipped) return [{ id: 'dist:skipped', name: 'Holders', run: async () => skip(scan.reason ? `Holders unknown: ${scan.reason}` : `Log of ${scan.total.toLocaleString('en-US')} blocks exceeds the scan limit of ${c.maxScanBlocks.toLocaleString('en-US')}; raise it in the thresholds or wait for the scanner canister`) }];
            const [m, tags, u] = await Promise.all([meta(ctx), tagsOf(ctx), ctx.load('untracked', loaders.untracked(ledgerId))]);
            // Accounts that revealed a genesis balance: use their real balance.
            for (const d of u?.deficits || []) if (d.actual !== null && d.actual !== undefined) { if (d.actual > 0n) scan.balances.set(d.key, d.actual); else scan.balances.delete(d.key); }
            const holders = holdersByOwner(scan);
            const visible = holders.reduce((a, h) => a + h.balance, 0n);
            const unseen = m.supply > visible ? m.supply - visible : 0n; // supply in accounts the log never mentions
            const unseenShare = pct(unseen, m.supply);
            const tagged = holders.filter((h) => tags.has(h.owner));
            const free = holders.filter((h) => !tags.has(h.owner));
            const taggedSum = tagged.reduce((a, h) => a + h.balance, 0n);
            const lockedByOwner = new Map();
            const locks = await quiet(ctx.load('locks', loaders.locks(ledgerId)), []);
            for (const l of locks) lockedByOwner.set(l.owner, (lockedByOwner.get(l.owner) || 0n) + l.amount);
            const show = (h) => `${h.owner}: ${fmtUnits(h.balance, m.decimals, 0)} (${pct(h.balance, m.supply).toFixed(2)}%)${lockedByOwner.has(h.owner) ? `, plus ${fmtUnits(lockedByOwner.get(h.owner), m.decimals, 0)} locked` : ''}`;
            const details = {
                blocks: scan.total, accounts_with_balance: scan.balances.size, owners_with_balance: holders.length,
                reconstructed_supply: fmtUnits(visible, m.decimals, 0), reported_supply: fmtUnits(m.supply, m.decimals, 0), in_accounts_the_log_never_mentions: `${fmtUnits(unseen, m.decimals, 0)} (${unseenShare.toFixed(2)}%)`, fee_collector: scan.feeCollector?.key || null,
                tagged: tagged.map((h) => `${tags.get(h.owner)} ${h.owner}: ${fmtUnits(h.balance, m.decimals, 0)} (${pct(h.balance, m.supply).toFixed(2)}%)`),
                top_holders: free.slice(0, 20).map(show),
            };
            const sumTop = (n) => free.slice(0, n).reduce((a, h) => a + h.balance, 0n);
            return [
                {
                    id: 'dist:recon', name: 'Holders rebuilt from the log', run: async () => {
                        const over = visible > m.supply ? visible - m.supply : 0n;
                        const details2 = { ...details, unknown_block_types: scan.unknown };
                        if (scan.unknown > 0) return warn(`${scan.unknown} block(s) of unknown type were ignored`, details2);
                        if (over * 1000n > m.supply) return fail(`Rebuilt balances exceed the reported supply by ${pct(over, m.supply).toFixed(2)}%: the log or the ledger is inconsistent`, details2);
                        const base = `${holders.length.toLocaleString('en-US')} owners across ${scan.balances.size.toLocaleString('en-US')} accounts, ${scan.total.toLocaleString('en-US')} blocks`;
                        if (unseen * 1000n > m.supply) return warn(`${base}; ${unseenShare.toFixed(2)}% of supply sits in accounts the log never mentions (seeded at genesis, never moved)`, details2);
                        return pass(`${base}, matches the reported supply`, details2);
                    },
                },
                {
                    id: 'dist:top1', name: 'Largest holder', run: async () => {
                        if (free.length === 0) return warn('No untagged holders', details);
                        const share = pct(free[0].balance, m.supply);
                        // Unseen supply could all sit with one party: it caps the grade.
                        const worst = Math.max(share, unseenShare);
                        const s = worst >= c.topHolderFailPct ? 'fail' : worst >= c.topHolderWarnPct ? 'warn' : 'pass';
                        const unseenNote = unseen * 1000n > m.supply ? `; ${unseenShare.toFixed(2)}% more is in accounts the log cannot see` : '';
                        return { status: s, summary: `${share.toFixed(2)}% of supply held by ${free[0].owner}${lockedByOwner.has(free[0].owner) ? ' (has locked tokens too)' : ''}${unseenNote}`, details, link: `/principal/${free[0].owner}` };
                    },
                },
                {
                    id: 'dist:top10', name: 'Ten largest holders', run: async () => {
                        const share = pct(sumTop(10), m.supply);
                        const worst = Math.max(share, unseenShare);
                        const s = worst >= c.top10FailPct ? 'fail' : worst >= c.top10WarnPct ? 'warn' : 'pass';
                        const unseenNote = unseen * 1000n > m.supply ? `; ${unseenShare.toFixed(2)}% more is in accounts the log cannot see` : '';
                        return { status: s, summary: `${share.toFixed(2)}% of supply (pools, locks and treasuries excluded: ${pct(taggedSum, m.supply).toFixed(2)}%)${unseenNote}`, details };
                    },
                },
                { id: 'dist:count', name: 'Number of holders', run: async () => (free.length < c.minHolders ? warn : pass)(`${free.length.toLocaleString('en-US')} owners with a balance`, details) },
            ];
        },
    };

    const locksGroup = {
        id: 'locks', name: 'Locks (Sneed Lock)',
        children: [
            {
                id: 'locks:share', name: 'Supply locked', link: '/sneedlock', run: async (ctx) => {
                    const [m, locks] = await Promise.all([meta(ctx), ctx.load('locks', loaders.locks(ledgerId))]);
                    const now = Date.now();
                    const long = locks.filter((l) => l.expiryMs - now >= c.minLockDays * 86400e3);
                    const total = locks.reduce((a, l) => a + l.amount, 0n);
                    const longSum = long.reduce((a, l) => a + l.amount, 0n);
                    const weighted = locks.reduce((a, l) => a + Number(l.amount) * Math.min(1, (l.expiryMs - now) / (365 * 86400e3)), 0);
                    const details = { active_locks: locks.length, locked: fmtUnits(total, m.decimals, 0), locked_at_least_min_days: fmtUnits(longSum, m.decimals, 0), year_weighted_locked: fmtUnits(BigInt(Math.round(weighted)), m.decimals, 0), largest: locks.sort((x, y) => (x.amount < y.amount ? 1 : -1)).slice(0, 10).map((l) => `#${l.lockId} ${l.owner}: ${fmtUnits(l.amount, m.decimals, 0)} until ${new Date(l.expiryMs).toISOString().slice(0, 10)}`) };
                    if (locks.length === 0) return warn('Nothing locked in Sneed Lock', details);
                    const share = pct(longSum, m.supply);
                    return (share >= c.lockedSupplyGoodPct ? pass : warn)(`${share.toFixed(2)}% of supply locked for at least ${c.minLockDays} days (${pct(total, m.supply).toFixed(2)}% in total, ${locks.length} locks)`, details);
                },
            },
            {
                id: 'locks:cliffs', name: 'Unlock cliffs ahead', run: async (ctx) => {
                    const [m, locks] = await Promise.all([meta(ctx), ctx.load('locks', loaders.locks(ledgerId))]);
                    const now = Date.now();
                    const soon = locks.filter((l) => l.expiryMs - now <= c.cliffWindowDays * 86400e3);
                    const sum = soon.reduce((a, l) => a + l.amount, 0n);
                    const share = pct(sum, m.supply);
                    const details = { window_days: c.cliffWindowDays, unlocking: soon.map((l) => `#${l.lockId} ${l.owner}: ${fmtUnits(l.amount, m.decimals, 0)} on ${new Date(l.expiryMs).toISOString().slice(0, 10)}`) };
                    if (soon.length === 0) return pass(`No unlocks in the next ${c.cliffWindowDays} days`, details);
                    return (share >= c.cliffWarnPct ? warn : pass)(`${share.toFixed(2)}% of supply unlocks within ${c.cliffWindowDays} days (${soon.length} lock(s))`, details);
                },
            },
        ],
    };

    const liquidity = {
        id: 'liquidity', name: 'Liquidity (ICPSwap)',
        children: async (ctx) => {
            const [m, pools, icpUsd] = await Promise.all([meta(ctx), ctx.load('pools', loaders.pools(ledgerId)), ctx.load('icpUsd', loaders.icpUsd)]);
            if (pools.length === 0) return [{ id: 'lp:none', name: 'Pool exists', run: async () => fail('No ICPSwap pool trades this token') }];
            // value each pool by its ledger balances; price from the ICP pool
            const valued = await Promise.all(pools.map(async (p) => {
                if (p.error) return { ...p, tvlUsd: null };
                const other = p.token0 === ledgerId ? p.token1 : p.token0;
                const [bal, balOther] = await Promise.all([quiet(ctx.load(`bal:${ledgerId}:${p.id}`, loaders.balance(ledgerId, p.id)), 0n), quiet(ctx.load(`bal:${other}:${p.id}`, loaders.balance(other, p.id)), 0n)]);
                const raw = (Number(p.sqrtPriceX96) / 2 ** 96) ** 2; // token1 per token0, base units
                let tokenPriceIcp = null;
                if (other === IDS.icpLedger) tokenPriceIcp = (p.token0 === ledgerId ? raw : 1 / raw) * 10 ** (m.decimals - 8);
                const tokenUsd = tokenPriceIcp !== null && icpUsd ? tokenPriceIcp * icpUsd : null;
                const tvlUsd = tokenUsd !== null ? Number(bal) / 10 ** m.decimals * tokenUsd + (other === IDS.icpLedger ? Number(balOther) / 1e8 * icpUsd : 0) : null;
                return { ...p, other, balance: bal, balanceOther: balOther, tokenPriceIcp, tokenUsd, tvlUsd };
            }));
            const icpPools = valued.filter((p) => p.other === IDS.icpLedger && !p.error);
            const main = (icpPools.length ? icpPools : valued).sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))[0];
            const mcap = main.tokenUsd !== null ? Number(m.supply) / 10 ** m.decimals * main.tokenUsd : null;
            const poolLink = `https://app.icpswap.com/liquidity/position?pool=${main.id}`;
            const details = { pools: valued.map((p) => `${p.id}: ${p.error || `${fmtUnits(p.balance, m.decimals, 0)} ${m.symbol} + ${p.other === IDS.icpLedger ? `${fmtUnits(p.balanceOther, 8)} ICP` : `other token ${p.other}`}${p.tvlUsd !== null ? `, about $${Math.round(p.tvlUsd).toLocaleString('en-US')}` : ''}`}`), token_price_icp: main.tokenPriceIcp, token_price_usd: main.tokenUsd, market_cap_usd: mcap !== null ? Math.round(mcap) : null, icp_usd: icpUsd };
            const leaves = [
                { id: 'lp:exists', name: 'Pool exists', link: poolLink, run: async () => pass(`${pools.length} pool(s); main pool ${main.id}${main.other === IDS.icpLedger ? ' against ICP' : ''}`, details) },
                {
                    id: 'lp:depth', name: 'Pool depth', link: poolLink, run: async () => {
                        if (main.tvlUsd === null) return skip(main.other !== IDS.icpLedger ? 'No ICP pool, so no USD valuation' : 'ICP price unavailable (no ICP/ckUSDC pool found)', details);
                        const rel = mcap ? (main.tvlUsd / mcap) * 100 : null;
                        const s = main.tvlUsd < c.minLiquidityUsd ? 'warn' : 'pass';
                        return { status: s, summary: `About $${Math.round(main.tvlUsd).toLocaleString('en-US')} in the main pool${rel !== null ? `, ${rel.toFixed(1)}% of a $${Math.round(mcap).toLocaleString('en-US')} market cap` : ''}`, details, link: poolLink };
                    },
                },
                {
                    id: 'lp:locked', name: 'Liquidity locked', link: '/sneedlock', run: async (ctx2) => {
                        const plocks = await ctx2.load('positionLocks', loaders.positionLocks(ledgerId));
                        const inMain = plocks.filter((l) => l.pool === main.id);
                        if (main.error) return skip('Main pool metadata unavailable');
                        const pool = await actor(poolIdl, main.id);
                        const now = Date.now();
                        const positions = await Promise.all(inMain.map(async (l) => {
                            const r = await quiet(ctx2.call(pool.getUserPosition(l.positionId), `position ${l.positionId}`), null);
                            if (!r || !('ok' in r)) return { ...l, error: 'position not found' };
                            const p = r.ok;
                            const amounts = positionAmounts(p.liquidity, Number(p.tickLower), Number(p.tickUpper), main.sqrtPriceX96);
                            return { ...l, liquidity: BigInt(p.liquidity), tickLower: Number(p.tickLower), tickUpper: Number(p.tickUpper), ...amounts, daysLeft: days(l.expiryMs - now) };
                        }));
                        const active = positions.filter((p) => !p.error && p.inRange && p.daysLeft >= c.minLockDays);
                        const lockedL = active.reduce((a, p) => a + p.liquidity, 0n);
                        const share = main.liquidity > 0n ? Number((lockedL * 10000n) / main.liquidity) / 100 : 0;
                        const details2 = { ...details, pool_active_liquidity: main.liquidity.toString(), current_tick: main.tick, locked_positions: positions.map((p) => p.error ? `#${p.lockId} position ${p.positionId}: ${p.error}` : `#${p.lockId} position ${p.positionId} by ${p.owner}: ${p.inRange ? 'in range' : 'OUT of range'} [${p.tickLower}, ${p.tickUpper}], ${p.daysLeft} days left, about ${fmtUnits(BigInt(Math.round(p.amount0)), main.token0 === ledgerId ? m.decimals : 8, 0)} / ${fmtUnits(BigInt(Math.round(p.amount1)), main.token1 === ledgerId ? m.decimals : 8, 0)}`) };
                        if (inMain.length === 0) {
                            const deep = main.tvlUsd !== null && main.tvlUsd >= c.minLiquidityUsd;
                            const why = plocks.length ? `Locked positions exist only in other pools (${plocks.length})` : 'No liquidity position of this token is locked in Sneed Lock';
                            return (deep ? warn : fail)(`${why}${deep ? '; the pool is deep today but all of it can be withdrawn' : ''}`, details2);
                        }
                        const s = share >= c.liquidityLockedGoodPct ? 'pass' : 'warn';
                        return { status: s, summary: `${share.toFixed(1)}% of the main pool's active liquidity is locked in range for at least ${c.minLockDays} days (${active.length} of ${inMain.length} locked positions count)`, details: details2, link: '/sneedlock' };
                    },
                },
            ];
            return leaves;
        },
    };

    const cycles = {
        id: 'cycles', name: 'Cycles and memory',
        children: async (ctx) => {
            const [archives, index] = await Promise.all([ctx.load('archives', loaders.archives(ledgerId)), ctx.load('index', loaders.index(ledgerId))]);
            const targets = [{ id: ledgerId, name: 'Ledger' }, ...archives.map((a) => ({ id: a.id, name: `Archive ${a.id}` })), ...(index ? [{ id: index.id, name: 'Index' }] : [])];
            return targets.map((t) => ({
                id: `cyc:${t.id}`, name: t.name, link: DASHBOARD(t.id), run: async (ctx2) => {
                    const st = await status(ctx2, t.id);
                    const cls = await classifyControllers(st.controllers, ctx2);
                    let s = null; let via = null;
                    if (cls.kind === 'blackhole') {
                        const bh = await actor(blackholeIdl, st.controllers[0]);
                        const r = await ctx2.call(bh.canister_status({ canister_id: Principal.fromText(t.id) }), 'blackhole status');
                        s = { cycles: r.cycles, memory: r.memory_size, running: Object.keys(r.status)[0] }; via = BLACKHOLES[st.controllers[0]];
                    } else if (cls.kind === 'sns') {
                        const summary = await ctx2.load(`root:${cls.sns.root}`, loaders.rootSummary(cls.sns.root));
                        s = summary.get(t.id) || null; via = 'SNS root';
                    }
                    if (!s) return skip(`Not observable: ${cls.kind === 'nns' ? 'NNS-controlled' : cls.kind === 'none' ? 'no controller to ask' : 'controllers do not publish status'}. A blackhole or DAO controller would make it visible`, { controllers: st.controllers });
                    const details = { via, cycles: s.cycles.toString(), memory: fmtBytes(s.memory), state: s.running };
                    const grade = Number(s.cycles) < c.cyclesRedT * T ? 'fail' : Number(s.cycles) < c.cyclesOrangeT * T ? 'warn' : s.running !== 'running' ? 'fail' : 'pass';
                    return { status: grade, summary: `${fmtT(s.cycles)}, ${fmtBytes(s.memory)}, ${s.running} (via ${via})`, details, link: DASHBOARD(t.id) };
                },
            }));
        },
    };

    return { id: 'token', name: `Token ${ledgerId}`, children: [gates, minting, supply, distribution, locksGroup, liquidity, cycles] };
}

/// Headline rating from the tree's statuses: gates cap everything.
export function rateTree(tree, statusOf) {
    const by = Object.fromEntries((tree.children || []).map((g) => [g.id, statusOf(g)]));
    const gates = (tree.children || []).find((g) => g.id === 'gates');
    const gateParts = Object.fromEntries((gates?.children || []).map((g) => [g.id, statusOf(g)]));
    if (['running', 'pending'].includes(by.gates) || Object.values(by).some((s) => ['running', 'pending'].includes(s))) return { label: 'Rating…', color: '#3b82f6', note: 'checks still running' };
    if (gateParts.controllers === 'fail' || gateParts.code === 'fail') {
        return { label: 'Unverifiable', color: '#ef4444', note: gateParts.code === 'fail' && gateParts.controllers === 'fail' ? 'unknown code that unknown principals can replace' : gateParts.code === 'fail' ? 'the code is not a known build' : 'someone other than a DAO or blackhole controls the code' };
    }
    const dims = ['minting', 'distribution', 'locks', 'liquidity', 'cycles'].map((k) => by[k]);
    const fails = dims.filter((s) => s === 'fail').length;
    const warns = dims.filter((s) => s === 'warn').length;
    if (fails === 0 && warns <= 1) return { label: 'Strong', color: '#22c55e', note: 'verified code under immutable or DAO control, with the dimensions behind it in good shape' };
    if (fails <= 1) return { label: 'Fair', color: '#f59e0b', note: 'verified code under safe control, but some dimensions need work' };
    return { label: 'Weak', color: '#ef4444', note: 'verified code under safe control, but several dimensions fail' };
}
