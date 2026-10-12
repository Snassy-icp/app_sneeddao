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
import { actor, getAgent, ledgerIdl, IDL, hex, accountIdentifierHex } from '../health/agent.js';
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
        try {
            const m = await ctx.load('meta', loaders.meta(ledgerId));
            return await scanLedgerOffThread(ledgerId, { maxBlocks: ctx.config.maxScanBlocks, onProgress: ctx.config.onProgress, timeoutMs: ctx.config.callTimeoutSec * 1000, defaultFee: m.fee });
        }
        catch (e) {
            const msg = String(e?.message || e);
            const reason = /exposes none of/.test(msg) ? msg : `the log could not be read (${msg.split('\n')[0].slice(0, 160)})`;
            return { skipped: true, total: null, reason };
        }
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
        // Genesis balance of a revealed account = what it holds now minus what the log gave it (negative).
        let revealed = 0n;
        for (const d of deficits) if (d.actual !== null && d.actual !== undefined) { d.genesis = d.actual - (scan.rawFinal?.get(d.key) ?? 0n); if (d.genesis > 0n) revealed += d.genesis; }
        const unseen = hidden > revealed ? hidden - revealed : 0n;
        return { hidden, share: pct(hidden, m.supply), revealed, unseen, unseenShare: pct(unseen, m.supply), deficits };
    },
    snsParams: (sns) => async (ctx) => {
        const g = await actor(governanceIdl, sns.governance);
        return ctx.call(g.get_nervous_system_parameters(null), 'nervous system parameters');
    },
    /// Every neuron of the SNS, 100 per page, up to maxNeuronPages.
    neurons: (sns) => async (ctx) => {
        const g = await actor(governanceIdl, sns.governance);
        const out = []; let start = []; let truncated = false;
        for (let page = 0; ; page++) {
            if (page >= ctx.config.maxNeuronPages) { truncated = true; break; }
            const r = await ctx.call(g.list_neurons({ of_principal: [], limit: 100, start_page_at: start }), `neurons page ${page}`);
            out.push(...r.neurons);
            if (r.neurons.length < 100) break;
            const last = opt(r.neurons[r.neurons.length - 1].id); if (!last) break;
            start = [last];
        }
        return { neurons: out, truncated };
    },
    proposals: (sns) => async (ctx) => {
        const g = await actor(governanceIdl, sns.governance);
        const r = await ctx.call(g.list_proposals({ limit: 20, before_proposal: [], exclude_type: [], include_reward_status: [], include_status: [], include_topics: [] }), 'proposals');
        return r.proposals;
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
            const [meta, amounts] = await Promise.all([ctx.call(pool.metadata(), `pool ${id} metadata`), quiet(ctx.call(pool.getTokenAmountState(), `pool ${id} amounts`), null)]);
            if (!('ok' in meta)) return { id, token0: p.token0.address, token1: p.token1.address, fee: Number(p.fee), error: 'metadata failed' };
            // The pool's own accounting of what backs its liquidity; its ledger
            // balances also hold deposits and fees not yet claimed.
            const inPool = amounts && 'ok' in amounts ? { amount0: BigInt(amounts.ok.token0Amount), amount1: BigInt(amounts.ok.token1Amount) } : null;
            return { id, token0: p.token0.address, token1: p.token1.address, fee: Number(p.fee), tick: Number(meta.ok.tick), sqrtPriceX96: BigInt(meta.ok.sqrtPriceX96), liquidity: BigInt(meta.ok.liquidity), inPool };
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

// ---- SNS neurons: voting power and control ----
const SEC = 1000;
/// Seconds until a neuron's stake can be liquid: its dissolve delay, or the
/// time left when it is dissolving, plus any vesting still running.
function neuronLockSeconds(n, nowSec) {
    const ds = opt(n.dissolve_state);
    let lock = 0;
    if (ds && 'DissolveDelaySeconds' in ds) lock = Number(ds.DissolveDelaySeconds);
    else if (ds && 'WhenDissolvedTimestampSeconds' in ds) lock = Math.max(0, Number(ds.WhenDissolvedTimestampSeconds) - nowSec);
    const vesting = opt(n.vesting_period_seconds);
    if (vesting !== undefined) lock = Math.max(lock, Number(n.created_timestamp_seconds) + Number(vesting) - nowSec);
    return lock;
}
/// Voting power as governance computes it: stake times dissolve-delay and age bonuses.
function neuronVotingPower(n, params, nowSec) {
    const stake = Number(n.cached_neuron_stake_e8s) + Number(opt(n.staked_maturity_e8s_equivalent) ?? 0n);
    const ds = opt(n.dissolve_state);
    const dd = ds && 'DissolveDelaySeconds' in ds ? Number(ds.DissolveDelaySeconds) : ds ? Math.max(0, Number(ds.WhenDissolvedTimestampSeconds) - nowSec) : 0;
    const maxDd = Number(opt(params.max_dissolve_delay_seconds) ?? 0n); const maxDdBonus = Number(opt(params.max_dissolve_delay_bonus_percentage) ?? 0n);
    const maxAge = Number(opt(params.max_neuron_age_for_age_bonus) ?? 0n); const maxAgeBonus = Number(opt(params.max_age_bonus_percentage) ?? 0n);
    const minToVote = Number(opt(params.neuron_minimum_dissolve_delay_to_vote_seconds) ?? 0n);
    const ddBonus = maxDd > 0 ? Math.min(dd, maxDd) / maxDd * maxDdBonus / 100 : 0;
    const age = ds && 'DissolveDelaySeconds' in ds ? Math.max(0, nowSec - Number(n.aging_since_timestamp_seconds)) : 0;
    const ageBonus = maxAge > 0 ? Math.min(age, maxAge) / maxAge * maxAgeBonus / 100 : 0;
    const vp = stake * (1 + ddBonus) * (1 + ageBonus) * Number(n.voting_power_percentage_multiplier) / 100;
    return { stake, dd, vp, votable: dd >= minToVote && stake > 0 };
}
/// The principal that controls a neuron: one with ManagePrincipals (2), else the first listed.
function neuronController(n) {
    const perms = n.permissions.filter((p) => opt(p.principal));
    const manager = perms.find((p) => p.permission_type.some((t) => Number(t) === 2));
    return (manager || perms[0]) ? opt((manager || perms[0]).principal).toText() : null;
}
const neuronIdHex = (n) => { const id = opt(n.id); return id ? hex(id.id) : null; };

/// Everything the DAO checks need, computed once per run.
async function daoTable(ctx, sns) {
    const [params, { neurons, truncated }] = await Promise.all([ctx.load(`params:${sns.root}`, loaders.snsParams(sns)), ctx.load(`neurons:${sns.root}`, loaders.neurons(sns))]);
    const nowSec = Date.now() / SEC;
    const rows = neurons.map((n) => ({ id: neuronIdHex(n), principal: neuronController(n), created: Number(n.created_timestamp_seconds), vesting: Number(opt(n.vesting_period_seconds) ?? 0n), lockSec: neuronLockSeconds(n, nowSec), followsCatchAll: (n.followees.find(([f]) => Number(f) === 0)?.[1]?.followees || []).map((f) => hex(f.id)), ...neuronVotingPower(n, params, nowSec) }));
    const totalVp = rows.reduce((a, r) => a + (r.votable ? r.vp : 0), 0);
    const totalStake = rows.reduce((a, r) => a + r.stake, 0);
    const byPrincipal = new Map();
    for (const r of rows) { if (!r.votable) continue; const k = r.principal || 'unknown'; byPrincipal.set(k, (byPrincipal.get(k) || 0) + r.vp); }
    const principals = [...byPrincipal.entries()].sort((a, b) => b[1] - a[1]);
    // influence: a neuron's own power plus every votable neuron that follows it on the catch-all topic
    const influence = new Map(rows.filter((r) => r.votable && r.id).map((r) => [r.id, r.vp]));
    for (const r of rows) if (r.votable) for (const f of r.followsCatchAll) if (influence.has(f) && f !== r.id) influence.set(f, influence.get(f) + r.vp);
    const topInfluence = [...influence.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, v]) => ({ id, vp: v, principal: rows.find((r) => r.id === id)?.principal }));
    const earliest = rows.length ? Math.min(...rows.map((r) => r.created)) : null;
    const genesis = rows.filter((r) => earliest !== null && r.created - earliest < 86400 && r.vesting > 0);
    return { params, rows, truncated, totalVp, totalStake, principals, topInfluence, earliest, genesis, nowSec };
}

/// Which SNS stands behind this token: its own, or the one whose root controls the ledger.
async function snsBehind(ledgerId, ctx) {
    const snsw = await ctx.load('snsw', loaders.snsw);
    const own = snsw.byLedger.get(ledgerId);
    if (own) return { sns: own, how: 'its own token' };
    const st = await ctx.load(`status:${ledgerId}`, loaders.status(ledgerId));
    if (st.controllers.length === 1 && snsw.byRoot.has(st.controllers[0])) return { sns: snsw.byRoot.get(st.controllers[0]), how: 'controls the ledger' };
    return null;
}

/// Name, symbol and logo for the page header; null when the ledger does not answer.
export async function fetchTokenHeader(ledgerId) {
    try {
        const l = await actor(tokenIdl, ledgerId);
        const metadata = await l.icrc1_metadata();
        const m = Object.fromEntries(metadata.map(([k, v]) => [k, Object.values(v)[0]]));
        const logo = typeof m['icrc1:logo'] === 'string' ? m['icrc1:logo'] : null;
        return { name: m['icrc1:name'] || null, symbol: m['icrc1:symbol'] || null, decimals: Number(m['icrc1:decimals'] ?? 8), logo };
    } catch { return null; }
}

// ---- the tree ----
export function buildTokenTree(ledgerId, config, header = null) {
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
                    const details = {
                        reported_supply: fmtUnits(m.supply, m.decimals, 0), supply_per_log: fmtUnits(m.supply - u.hidden, m.decimals, 0), created_outside_the_log: `${fmtUnits(u.hidden, m.decimals, 0)} (${u.share.toFixed(2)}%)`,
                        traced_to_accounts_that_moved_it: `${fmtUnits(u.revealed, m.decimals, 0)} across ${u.deficits.length} account(s)`, still_unseen: `${fmtUnits(u.unseen, m.decimals, 0)} (${u.unseenShare.toFixed(2)}%)`,
                        revealed_accounts: u.deficits.slice(0, 15).map((d) => `${d.key}: started with about ${d.genesis !== undefined ? fmtUnits(d.genesis, m.decimals, 0) : `at least ${fmtUnits(d.deficit, m.decimals, 0)}`} outside the log; holds ${d.actual !== null && d.actual !== undefined ? fmtUnits(d.actual, m.decimals, 0) : '?'} today`),
                        note: 'Ledgers that seed balances from their init arguments (most Motoko ledgers) create supply with no block; the DFINITY ledger suite writes mint blocks instead. Such supply is only revealed when it moves.',
                        records_lost_in_archive: (await ctx.load('scan', loaders.scan(ledgerId))).gaps || 0,
                    };
                    if (u.hidden * 1000n <= m.supply) return pass('Every token traces back to a mint block', details);
                    // What matters is what still cannot be seen: supply seeded at genesis that never moved.
                    const s = u.unseenShare >= c.topHolderFailPct ? 'fail' : 'warn';
                    const traced = u.unseen * 1000n <= m.supply ? 'all of it has since been traced to the accounts that moved it' : `${pct(u.revealed, m.supply).toFixed(2)}% has been traced to ${u.deficits.length} account(s) that moved it, ${u.unseenShare.toFixed(2)}% still sits in accounts the log has never seen`;
                    return { status: s, summary: `${u.share.toFixed(2)}% of supply was created outside the log at genesis (no mint blocks); ${traced}`, details };
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
            if (scan.skipped) return [{ id: 'dist:skipped', name: 'Holders', run: async () => skip(scan.reason ? `Holders unknown: ${scan.reason}` : `Log of ${scan.total.toLocaleString('en-US')} blocks exceeds the scan limit of ${c.maxScanBlocks.toLocaleString('en-US')}; raise the limit in the thresholds (the scan runs in a worker and takes a few minutes per million blocks)`) }];
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

            // ---- distribution by origin: where each balance came from ----
            // A satellite received everything from one sender and never sent anything;
            // it is folded into its funder. Pools, locks and treasuries are never funders here.
            const originLeaves = () => {
                const stats = scan.accounts || new Map();
                const genesisOwners = new Set((u?.deficits || []).map((d) => d.owner));
                const poolOwners = new Set([...tags.entries()].filter(([, l]) => l.startsWith('ICPSwap pool')).map(([o]) => o));
                const ownerOf = (key) => scan.owners.get(key) || (stats.get(key)?.owner) || key;
                const folded = new Map(); // owner -> balance after folding satellites
                const satellites = new Map(); // funder owner -> { count, balance }
                let dormantOneSource = 0n; let bought = 0n; let mintedDirect = 0n; let fromGenesis = 0n; let fromOthers = 0n; let neverMoved = 0n;
                for (const [key, bal] of scan.balances) {
                    const owner = ownerOf(key);
                    if (tags.has(owner)) continue;
                    const st = stats.get(key);
                    const funder = st?.firstFrom && st.firstFrom !== 'mint' ? ownerOf(st.firstFrom) : null;
                    const viaPool = st ? [...st.senders].some((o) => poolOwners.has(o)) : false;
                    if (st && st.outCount === 0) neverMoved += bal;
                    if (viaPool) bought += bal; else if (st?.firstFrom === 'mint') mintedDirect += bal; else if (funder && genesisOwners.has(funder)) fromGenesis += bal; else fromOthers += bal;
                    const isSatellite = st && st.senders.size === 1 && st.outCount === 0 && funder && !tags.has(funder) && funder !== owner;
                    if (isSatellite) {
                        dormantOneSource += bal;
                        folded.set(funder, (folded.get(funder) || 0n) + bal);
                        const sat = satellites.get(funder) || { count: 0, balance: 0n }; sat.count += 1; sat.balance += bal; satellites.set(funder, sat);
                    } else folded.set(owner, (folded.get(owner) || 0n) + bal);
                }
                const foldedTop = [...folded.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1));
                const fanout = [...satellites.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);
                const odetails = {
                    method: 'A satellite account received its whole balance from one sender and never sent anything; it is counted as its funder\'s. Pools, locks and treasuries are excluded as funders.',
                    satellites: [...satellites.values()].reduce((a, v) => a + v.count, 0), supply_in_satellites: `${fmtUnits(dormantOneSource, m.decimals, 0)} (${pct(dormantOneSource, m.supply).toFixed(2)}%)`,
                    largest_funders: fanout.map(([f, v]) => `${f}: funded ${v.count} dormant account(s) holding ${fmtUnits(v.balance, m.decimals, 0)} (${pct(v.balance, m.supply).toFixed(2)}%)`),
                    top_after_folding: foldedTop.slice(0, 10).map(([o, b]) => `${o}: ${fmtUnits(b, m.decimals, 0)} (${pct(b, m.supply).toFixed(2)}%)${satellites.has(o) ? ` incl. ${satellites.get(o).count} satellite(s)` : ''}`),
                    by_origin: { bought_from_a_pool: `${pct(bought, m.supply).toFixed(2)}%`, minted_directly: `${pct(mintedDirect, m.supply).toFixed(2)}%`, received_from_a_genesis_account: `${pct(fromGenesis, m.supply).toFixed(2)}%`, received_from_other_holders: `${pct(fromOthers, m.supply).toFixed(2)}%` },
                    never_sent_anything: `${pct(neverMoved, m.supply).toFixed(2)}%`,
                };
                if (stats.size === 0) return [];
                const top1Folded = foldedTop.length ? pct(foldedTop[0][1], m.supply) : 0;
                const top10Folded = pct(foldedTop.slice(0, 10).reduce((a, [, b]) => a + b, 0n), m.supply);
                const rawTop1 = free.length ? pct(free[0].balance, m.supply) : 0;
                return [
                    {
                        id: 'dist:folded', name: 'Largest holder after folding satellites', run: async () => {
                            const worst = Math.max(top1Folded, unseenShare);
                            const sgrade = worst >= c.topHolderFailPct ? 'fail' : worst >= c.topHolderWarnPct ? 'warn' : 'pass';
                            const grew = top1Folded - rawTop1;
                            return { status: sgrade, summary: `${top1Folded.toFixed(2)}% held by ${foldedTop[0]?.[0] || 'nobody'}${grew > 0.5 ? ` (up from ${rawTop1.toFixed(2)}% once its ${satellites.get(foldedTop[0][0])?.count || 0} satellite accounts are counted)` : ''}; ten largest ${top10Folded.toFixed(2)}%`, details: odetails };
                        },
                    },
                    {
                        id: 'dist:origin', name: 'Where balances came from', run: async () => {
                            const dormantShare = pct(dormantOneSource, m.supply);
                            const sgrade = dormantShare >= c.dormantWarnPct ? 'warn' : 'pass';
                            return { status: sgrade, summary: `${pct(bought, m.supply).toFixed(1)}% bought from a pool, ${pct(mintedDirect, m.supply).toFixed(1)}% minted directly, ${pct(fromGenesis, m.supply).toFixed(1)}% from genesis accounts, ${pct(fromOthers, m.supply).toFixed(1)}% from other holders; ${dormantShare.toFixed(1)}% sits in single-source accounts that never moved`, details: odetails };
                        },
                    },
                ];
            };
            return [
                {
                    id: 'dist:recon', name: 'Holders rebuilt from the log', run: async () => {
                        const over = visible > m.supply ? visible - m.supply : 0n;
                        const details2 = { ...details, unknown_block_types: scan.unknown, records_lost_in_archive: scan.gaps || 0 };
                        if (scan.unknown > 0) return warn(`${scan.unknown} block(s) of unknown type were ignored`, details2);
                        if (over * 1000n > m.supply) return fail(`Rebuilt balances exceed the reported supply by ${pct(over, m.supply).toFixed(2)}%: the log or the ledger is inconsistent`, details2);
                        const base = `${holders.length.toLocaleString('en-US')} owners across ${scan.balances.size.toLocaleString('en-US')} accounts, ${scan.total.toLocaleString('en-US')} blocks${scan.gaps ? ` (${scan.gaps} record(s) lost in the ledger's archive)` : ''}`;
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
                ...originLeaves(),
            ];
        },
    };

    /// Everything the locked-supply rows share, computed once.
    const lockedSupply = (ctx) => ctx.load('lockedSupply', async () => {
        const [m, locks, snsRel] = await Promise.all([meta(ctx), ctx.load('locks', loaders.locks(ledgerId)), snsBehind(ledgerId, ctx)]);
        const now = Date.now();
        const minSec = c.minLockDays * 86400;
        const sl = { count: locks.length, total: locks.reduce((a, l) => a + l.amount, 0n), long: locks.filter((l) => l.expiryMs - now >= minSec * 1000).reduce((a, l) => a + l.amount, 0n), weighted: locks.reduce((a, l) => a + Number(l.amount) * Math.min(1, (l.expiryMs - now) / (365 * 86400e3)), 0), locks };
        let neurons = null;
        if (snsRel && snsRel.how === 'its own token') {
            const t = await daoTable(ctx, snsRel.sns);
            let total = 0n; let long = 0n; let weighted = 0;
            for (const r of t.rows) { const st = BigInt(Math.round(r.stake)); total += st; if (r.lockSec >= minSec) long += st; weighted += r.stake * Math.min(1, r.lockSec / (365 * 86400)); }
            neurons = { count: t.rows.length, total, long, weighted, truncated: t.truncated, table: t, dao: await daoLabel(snsRel.sns, ctx) };
        }
        return { m, sl, neurons, minSec, now };
    });
    const shareRow = (part, m) => `${fmtUnits(part, m.decimals, 0)} (${pct(part, m.supply).toFixed(2)}%)`;

    const locksGroup = {
        id: 'locks', name: 'Locked supply',
        children: [
            {
                id: 'locks:total', name: 'Locked for at least the minimum time', timeoutMs: SCAN_TIMEOUT_MS, run: async (ctx) => {
                    const { m, sl, neurons } = await lockedSupply(ctx);
                    const combined = sl.long + (neurons?.long ?? 0n);
                    const details = { minimum_days: c.minLockDays, sneed_lock: shareRow(sl.long, m), sns_neurons: neurons ? shareRow(neurons.long, m) : 'not an SNS token', combined: shareRow(combined, m) };
                    if (sl.count === 0 && !(neurons && neurons.total > 0n)) return warn('Nothing locked in Sneed Lock and no SNS neurons', details);
                    const parts = [];
                    if (sl.long > 0n) parts.push(`${pct(sl.long, m.supply).toFixed(2)}% in Sneed Lock`);
                    if (neurons && neurons.long > 0n) parts.push(`${pct(neurons.long, m.supply).toFixed(2)}% in SNS neurons`);
                    const share = pct(combined, m.supply);
                    return (share >= c.lockedSupplyGoodPct ? pass : warn)(`${share.toFixed(2)}% of supply locked for at least ${c.minLockDays} days${parts.length ? ` (${parts.join(' + ')})` : ''}`, details);
                },
            },
            {
                id: 'locks:sneedlock', name: 'In Sneed Lock', link: '/sneedlock', run: async (ctx) => {
                    const { m, sl } = await lockedSupply(ctx);
                    const details = { active_locks: sl.count, locked: shareRow(sl.total, m), locked_at_least_min_days: shareRow(sl.long, m), year_weighted: fmtUnits(BigInt(Math.round(sl.weighted)), m.decimals, 0), largest: [...sl.locks].sort((x, y) => (x.amount < y.amount ? 1 : -1)).slice(0, 10).map((l) => `#${l.lockId} ${l.owner}: ${fmtUnits(l.amount, m.decimals, 0)} until ${new Date(l.expiryMs).toISOString().slice(0, 10)}`) };
                    if (sl.count === 0) return skip('Nothing locked in Sneed Lock', details);
                    return pass(`${pct(sl.total, m.supply).toFixed(2)}% of supply in ${sl.count} lock(s), ${pct(sl.long, m.supply).toFixed(2)}% with at least ${c.minLockDays} days left`, details);
                },
            },
            {
                id: 'locks:neurons', name: 'In SNS neurons', timeoutMs: SCAN_TIMEOUT_MS, run: async (ctx) => {
                    const { m, neurons } = await lockedSupply(ctx);
                    if (!neurons) return skip('Not an SNS token: no neurons hold it');
                    const details = { dao: neurons.dao, neurons: neurons.count, truncated: neurons.truncated, staked: shareRow(neurons.total, m), staked_at_least_min_days: shareRow(neurons.long, m), year_weighted: fmtUnits(BigInt(Math.round(neurons.weighted)), m.decimals, 0), note: 'A neuron\'s lock is its dissolve delay, or the time left if it is dissolving, extended by vesting.' };
                    if (neurons.total === 0n) return skip('No stake in neurons', details);
                    return pass(`${pct(neurons.total, m.supply).toFixed(2)}% of supply staked in ${neurons.count.toLocaleString('en-US')} neurons, ${pct(neurons.long, m.supply).toFixed(2)}% with at least ${c.minLockDays} days of lock`, details);
                },
            },
            {
                id: 'locks:cliffs', name: 'Unlock cliffs ahead', timeoutMs: SCAN_TIMEOUT_MS, run: async (ctx) => {
                    const { m, sl, neurons, now } = await lockedSupply(ctx);
                    const windowSec = c.cliffWindowDays * 86400;
                    const soon = sl.locks.filter((l) => l.expiryMs - now <= windowSec * 1000);
                    let sum = soon.reduce((a, l) => a + l.amount, 0n);
                    const details = { window_days: c.cliffWindowDays, sneed_lock_unlocking: soon.map((l) => `#${l.lockId} ${l.owner}: ${fmtUnits(l.amount, m.decimals, 0)} on ${new Date(l.expiryMs).toISOString().slice(0, 10)}`) };
                    let dissolving = 0;
                    if (neurons) {
                        const ds = neurons.table.rows.filter((r) => r.lockSec > 0 && r.lockSec <= windowSec && r.stake > 0);
                        const dissolvingStake = ds.reduce((a, r) => a + BigInt(Math.round(r.stake)), 0n);
                        dissolving = ds.length;
                        sum += dissolvingStake;
                        details.sns_neurons_dissolving_in_window = { neurons: dissolving, stake: shareRow(dissolvingStake, m) };
                    }
                    const share = pct(sum, m.supply);
                    if (soon.length === 0 && dissolving === 0) return pass(`No unlocks in the next ${c.cliffWindowDays} days`, details);
                    return (share >= c.cliffWarnPct ? warn : pass)(`${share.toFixed(2)}% of supply unlocks within ${c.cliffWindowDays} days (${soon.length} lock(s)${dissolving ? `, ${dissolving} dissolving neuron(s)` : ''})`, details);
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
                let [bal, balOther] = await Promise.all([quiet(ctx.load(`bal:${ledgerId}:${p.id}`, loaders.balance(ledgerId, p.id)), 0n), quiet(ctx.load(`bal:${other}:${p.id}`, loaders.balance(other, p.id)), 0n)]);
                const ledgerBalances = { token: bal, other: balOther };
                if (p.inPool) { bal = p.token0 === ledgerId ? p.inPool.amount0 : p.inPool.amount1; balOther = p.token0 === ledgerId ? p.inPool.amount1 : p.inPool.amount0; }
                const raw = (Number(p.sqrtPriceX96) / 2 ** 96) ** 2; // token1 per token0, base units
                let tokenPriceIcp = null;
                if (other === IDS.icpLedger) tokenPriceIcp = (p.token0 === ledgerId ? raw : 1 / raw) * 10 ** (m.decimals - 8);
                const tokenUsd = tokenPriceIcp !== null && icpUsd ? tokenPriceIcp * icpUsd : null;
                const tvlUsd = tokenUsd !== null ? Number(bal) / 10 ** m.decimals * tokenUsd + (other === IDS.icpLedger ? Number(balOther) / 1e8 * icpUsd : 0) : null;
                return { ...p, other, balance: bal, balanceOther: balOther, ledgerBalances, tokenPriceIcp, tokenUsd, tvlUsd };
            }));
            const icpPools = valued.filter((p) => p.other === IDS.icpLedger && !p.error);
            const main = (icpPools.length ? icpPools : valued).sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))[0];
            const mcap = main.tokenUsd !== null ? Number(m.supply) / 10 ** m.decimals * main.tokenUsd : null;
            const poolLink = `https://app.icpswap.com/liquidity/position?pool=${main.id}`;
            const details = {
                pools: valued.map((p) => `${p.id}: ${p.error || `${fmtUnits(p.balance, m.decimals, 0)} ${m.symbol} + ${p.other === IDS.icpLedger ? `${fmtUnits(p.balanceOther, 8)} ICP` : `other token ${p.other}`}${p.tvlUsd !== null ? `, about $${Math.round(p.tvlUsd).toLocaleString('en-US')}` : ''}${p.inPool ? ` (pool accounting; ledger balances ${fmtUnits(p.ledgerBalances.token, m.decimals, 0)} ${m.symbol} + ${p.other === IDS.icpLedger ? `${fmtUnits(p.ledgerBalances.other, 8)} ICP` : 'other'} include unclaimed deposits and fees)` : ''}`}`),
                token_price_icp: main.tokenPriceIcp, token_price_usd: main.tokenUsd, market_cap_usd: mcap !== null ? Math.round(mcap) : null,
                icp_usd: icpUsd, icp_price_source: 'deepest ICPSwap ICP/ckUSDC pool',
            };
            const leaves = [
                { id: 'lp:exists', name: 'Pool exists', link: poolLink, run: async () => pass(`${pools.length} pool(s); main pool ${main.id}${main.other === IDS.icpLedger ? ' against ICP' : ''}`, details) },
                {
                    id: 'lp:depth', name: 'Pool depth', link: poolLink, run: async () => {
                        if (main.tvlUsd === null) return skip(main.other !== IDS.icpLedger ? 'No ICP pool, so no USD valuation' : 'ICP price unavailable (no ICP/ckUSDC pool found)', details);
                        const rel = mcap ? (main.tvlUsd / mcap) * 100 : null;
                        // Depth is judged against the market cap: a pool holding a large share of
                        // the token's value is deep however small the token. An absolute floor
                        // catches pools too thin to trade at all.
                        const s = main.tvlUsd < c.minLiquidityUsd ? 'warn' : (rel !== null && rel >= c.liquidityGoodPctOfMcap) || main.tvlUsd >= c.deepLiquidityUsd ? 'pass' : 'warn';
                        return { status: s, summary: `About $${Math.round(main.tvlUsd).toLocaleString('en-US')} in the main pool (${fmtUnits(main.balanceOther, 8, 0)} ICP + ${fmtUnits(main.balance, m.decimals, 0)} ${m.symbol} at $${icpUsd.toFixed(2)} per ICP)${rel !== null ? `, ${rel.toFixed(1)}% of a $${Math.round(mcap).toLocaleString('en-US')} market cap` : ''}`, details, link: poolLink };
                    },
                },
                {
                    id: 'lp:control', name: 'Liquidity under safe control', link: '/sneedlock', run: async (ctx2) => {
                        // Every position in the main pool is classified by who can withdraw it:
                        // Sneed Lock with time left, a DAO (SNS governance/root or a canister only
                        // an SNS root controls), nobody (burned), or immutable code known not to
                        // move positions. Everything else can be pulled by its owner.
                        if (main.error) return skip('Main pool metadata unavailable');
                        const pool = await actor(poolIdl, main.id);
                        const page = await ctx2.call(pool.getUserPositionWithTokenAmount(0n, 500n), 'pool positions');
                        if (!('ok' in page)) return fail('Could not list the pool\'s positions', details);
                        const all = page.ok.content.map((p) => ({ id: BigInt(p.id), liquidity: BigInt(p.liquidity), tickLower: Number(p.tickLower), tickUpper: Number(p.tickUpper), ...positionAmounts(p.liquidity, Number(p.tickLower), Number(p.tickUpper), main.sqrtPriceX96) }));
                        const live = all.filter((p) => p.liquidity > 0n).sort((a, b) => (a.liquidity < b.liquidity ? 1 : -1));
                        const inspect = live.slice(0, 60);
                        const [plocks, snsw, ownersHex] = await Promise.all([
                            ctx2.load('positionLocks', loaders.positionLocks(ledgerId)), ctx2.load('snsw', loaders.snsw),
                            Promise.all(inspect.map(async (p) => { const r = await quiet(ctx2.call(pool.getUserByPositionId(p.id), `owner of position ${p.id}`), null); return r && 'ok' in r ? r.ok : null; })),
                        ]);
                        // candidates whose ICP account identifier we can compute
                        const cand = new Map();
                        const addCand = (principal, label, cls) => { try { cand.set(accountIdentifierHex(principal, null), { principal, label, cls }); } catch { /* not a principal */ } };
                        addCand(IDS.sneedLock, 'Sneed Lock', 'sneedlock');
                        addCand('2vxsx-fae', 'the anonymous principal (nobody can act as it)', 'burned');
                        addCand(main.id, 'the pool itself', 'burned');
                        for (const [id, name] of Object.entries(BLACKHOLES)) addCand(id, `the ${name} canister (immutable, cannot move positions)`, 'immutable');
                        for (const sns of snsw.snses) { const nm = sns.root === IDS.sneedRoot ? 'Sneed DAO' : `the SNS with root ${sns.root}`; if (sns.governance) addCand(sns.governance, `governance of ${nm}`, 'dao'); if (sns.root) addCand(sns.root, `root of ${nm}`, 'dao'); }
                        addCand('ok64y-uiaaa-aaaag-qdcbq-cai', 'the Sneed DeFi canister (controlled only by Sneed root)', 'dao');
                        const now = Date.now();
                        const classified = inspect.map((p, i) => {
                            const hx = ownersHex[i];
                            const k = hx ? cand.get(hx) : null;
                            let cls = 'other'; let who = hx ? `account ${hx.slice(0, 10)}… (a user or a canister we cannot name)` : 'unknown';
                            if (k) { cls = k.cls; who = k.label; }
                            if (k?.cls === 'sneedlock') {
                                const lock = plocks.find((l) => l.pool === main.id && l.positionId === p.id);
                                if (!lock) { cls = 'other'; who = 'Sneed Lock, but no active lock on this position'; }
                                else if (lock.expiryMs - now < c.minLockDays * 86400e3) { cls = 'other'; who = `Sneed Lock, lock #${lock.lockId} ends in ${days(lock.expiryMs - now)} days (under ${c.minLockDays})`; }
                                else who = `Sneed Lock, lock #${lock.lockId} for ${days(lock.expiryMs - now)} more days`;
                            }
                            return { ...p, cls, who };
                        });
                        const safeCls = new Set(['sneedlock', 'dao', 'burned', 'immutable']);
                        const activeL = classified.filter((p) => p.inRange).reduce((a, p) => a + p.liquidity, 0n);
                        const safeL = classified.filter((p) => p.inRange && safeCls.has(p.cls)).reduce((a, p) => a + p.liquidity, 0n);
                        const share = main.liquidity > 0n ? Number((safeL * 10000n) / main.liquidity) / 100 : 0;
                        const byCls = {};
                        for (const p of classified) if (p.inRange) byCls[p.cls] = (byCls[p.cls] || 0n) + p.liquidity;
                        const details2 = {
                            ...details, pool_active_liquidity: main.liquidity.toString(), positions_with_liquidity: live.length, inspected: inspect.length, current_tick: main.tick,
                            in_range_liquidity_by_control: Object.fromEntries(Object.entries(byCls).map(([k, v]) => [k, main.liquidity > 0n ? `${(Number((v * 10000n) / main.liquidity) / 100).toFixed(1)}%` : '0%'])),
                            positions: classified.map((p) => `#${p.id}: ${p.inRange ? 'in range' : 'OUT of range'} [${p.tickLower}, ${p.tickUpper}], ${main.liquidity > 0n ? (Number((p.liquidity * 10000n) / main.liquidity) / 100).toFixed(1) : '0'}% of active liquidity, held by ${p.who}`),
                            note: 'Burned means no one can ever act as the owner. Immutable means code with no controllers that is known not to move positions. A canister with no controllers but unknown code is not safe: it may expose a method that transfers the position.',
                        };
                        if (live.length === 0) return fail('The pool has no positions with liquidity', details2);
                        if (activeL === 0n) return warn('No position is in range at the current price', details2);
                        const s = share >= c.liquidityLockedGoodPct ? 'pass' : safeL > 0n ? 'warn' : (main.tvlUsd !== null && main.tvlUsd >= c.minLiquidityUsd ? 'warn' : 'fail');
                        const parts = Object.entries(byCls).filter(([k]) => safeCls.has(k)).map(([k, v]) => `${(Number((v * 10000n) / (main.liquidity || 1n)) / 100).toFixed(1)}% ${k === 'sneedlock' ? 'in Sneed Lock' : k === 'dao' ? 'DAO-owned' : k}`);
                        return { status: s, summary: `${share.toFixed(1)}% of the main pool's active liquidity cannot be pulled by a private owner${parts.length ? ` (${parts.join(', ')})` : ''}; ${(100 - share).toFixed(1)}% can be withdrawn`, details: details2, link: '/sneedlock' };
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

    const dao = {
        id: 'dao', name: 'The DAO behind it (SNS governance)',
        children: async (ctx) => {
            const rel = await snsBehind(ledgerId, ctx);
            if (!rel) return [{ id: 'dao:none', name: 'SNS governance', run: async () => skip('No SNS stands behind this ledger (not an SNS token, and no SNS root controls it)') }];
            const label = await daoLabel(rel.sns, ctx);
            const link = `https://dashboard.internetcomputer.org/sns/${rel.sns.root}`;
            const T = (ctx2) => daoTable(ctx2, rel.sns);
            const sharePct = (v, t) => (t > 0 ? (v / t) * 100 : 0);
            const vpText = (v) => (v / 1e8).toLocaleString('en-US', { maximumFractionDigits: 0 });
            return [
                {
                    id: 'dao:info', name: 'DAO', link, run: async (ctx2) => {
                        const t = await T(ctx2);
                        const principals = t.principals.length;
                        const age = t.earliest ? days(Date.now() - t.earliest * SEC) : null;
                        const details = { dao: label, relation: rel.how, neurons: t.rows.length, truncated: t.truncated, principals_with_voting_power: principals, total_voting_power: vpText(t.totalVp), total_stake: vpText(t.totalStake), oldest_neuron_days: age, min_dissolve_delay_to_vote_days: Number(opt(t.params.neuron_minimum_dissolve_delay_to_vote_seconds) ?? 0n) / 86400 };
                        return pass(`${label}, ${rel.how}: ${t.rows.length.toLocaleString('en-US')} neurons, ${principals.toLocaleString('en-US')} voting principals, ${age !== null ? `${age} days old` : 'age unknown'}${t.truncated ? ' (first neuron pages only)' : ''}`, details);
                    },
                },
                {
                    id: 'dao:top', name: 'Largest voting principal', link, run: async (ctx2) => {
                        const t = await T(ctx2);
                        if (t.totalVp === 0) return fail('No votable voting power', { dao: label });
                        const [p, v] = t.principals[0];
                        const share = sharePct(v, t.totalVp);
                        const ten = sharePct(t.principals.slice(0, 10).reduce((a, [, x]) => a + x, 0), t.totalVp);
                        const details = { dao: label, largest: t.principals.slice(0, 10).map(([pp, vv]) => `${pp}: ${sharePct(vv, t.totalVp).toFixed(2)}% (${vpText(vv)})`), ten_largest_pct: ten.toFixed(2) };
                        const sgrade = share >= c.daoTopFailPct ? 'fail' : share >= c.daoTopWarnPct ? 'warn' : 'pass';
                        return { status: sgrade, summary: `${share.toFixed(2)}% of voting power controlled by ${p}${share >= 50 ? ': it can pass any proposal alone' : ''}; ten largest ${ten.toFixed(2)}%`, details, link };
                    },
                },
                {
                    id: 'dao:following', name: 'Influence after following', link, run: async (ctx2) => {
                        const t = await T(ctx2);
                        if (t.totalVp === 0) return skip('No votable voting power');
                        const top = t.topInfluence[0];
                        const share = top ? sharePct(top.vp, t.totalVp) : 0;
                        const details = { dao: label, note: 'A neuron\'s own voting power plus every neuron that follows it on the catch-all topic (one level).', most_influential: t.topInfluence.map((x) => `neuron ${x.id.slice(0, 12)}… (${x.principal || 'unknown principal'}): ${sharePct(x.vp, t.totalVp).toFixed(2)}%`) };
                        const sgrade = share >= c.daoInfluenceFailPct ? 'fail' : share >= c.daoTopWarnPct ? 'warn' : 'pass';
                        return { status: sgrade, summary: top ? `${share.toFixed(2)}% of voting power follows or is neuron ${top.id.slice(0, 12)}… (${top.principal || 'unknown principal'})` : 'No following', details, link };
                    },
                },
                {
                    id: 'dao:votable', name: 'Stake that can vote', link, run: async (ctx2) => {
                        const t = await T(ctx2);
                        const votable = t.rows.filter((r) => r.votable).reduce((a, r) => a + r.stake, 0);
                        const share = sharePct(votable, t.totalStake);
                        return (share < 50 ? warn : pass)(`${share.toFixed(1)}% of staked tokens sit in neurons with enough dissolve delay to vote`, { dao: label, votable_stake: vpText(votable), total_stake: vpText(t.totalStake) });
                    },
                },
                {
                    id: 'dao:genesis', name: 'Genesis (developer) neurons', link, run: async (ctx2) => {
                        const t = await T(ctx2);
                        const g = t.genesis;
                        const gStake = g.reduce((a, r) => a + r.stake, 0);
                        const share = sharePct(gStake, t.totalStake);
                        const latestVest = g.length ? Math.max(...g.map((r) => r.created + r.vesting)) : null;
                        const details = { dao: label, genesis_neurons_with_vesting: g.length, stake: vpText(gStake), share_of_stake_pct: share.toFixed(2), vesting_ends_latest: latestVest ? new Date(latestVest * SEC).toISOString().slice(0, 10) : null, by_principal: Object.entries(g.reduce((acc, r) => { acc[r.principal || 'unknown'] = (acc[r.principal || 'unknown'] || 0) + r.stake; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([pp, v]) => `${pp}: ${vpText(v)}`) };
                        if (g.length === 0) return pass('No vesting genesis neurons', details);
                        return (share >= c.topHolderWarnPct ? warn : pass)(`${g.length} genesis neuron(s) with vesting hold ${share.toFixed(1)}% of stake, vesting until ${details.vesting_ends_latest}`, details);
                    },
                },
                {
                    id: 'dao:participation', name: 'Participation in recent proposals', link, run: async (ctx2) => {
                        const [t, props] = await Promise.all([T(ctx2), ctx2.load(`proposals:${rel.sns.root}`, loaders.proposals(rel.sns))]);
                        if (props.length === 0) return warn('No proposals yet', { dao: label });
                        const rates = props.map((pr) => { const tally = opt(pr.latest_tally); if (!tally || Number(tally.total) === 0) return null; return (Number(tally.yes) + Number(tally.no)) / Number(tally.total) * 100; }).filter((x) => x !== null);
                        const avg = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
                        const recent = props.filter((pr) => Date.now() - Number(pr.proposal_creation_timestamp_seconds) * SEC < 30 * 86400e3).length;
                        const details = { dao: label, proposals_sampled: props.length, proposals_last_30_days: recent, cast_vs_total_pct_per_proposal: rates.map((r) => r.toFixed(1)) };
                        return (avg < c.daoLowParticipationPct ? warn : pass)(`On average ${avg.toFixed(1)}% of voting power was cast on the last ${rates.length} proposals; ${recent} proposal(s) in the last 30 days`, details);
                    },
                },
            ];
        },
    };

    const title = header?.name ? `${header.name}${header.symbol ? ` (${header.symbol})` : ''}, ledger ${ledgerId}` : `Token ${ledgerId}`;
    return { id: 'token', name: title, children: [gates, dao, minting, supply, distribution, locksGroup, liquidity, cycles] };
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
    if (by.dao === 'fail') return { label: 'Captured DAO', color: '#ef4444', note: 'one party controls the DAO that controls the code' };
    const dims = ['minting', 'distribution', 'locks', 'liquidity', 'cycles'].map((k) => by[k]);
    const fails = dims.filter((s) => s === 'fail').length;
    const warns = dims.filter((s) => s === 'warn').length;
    if (fails === 0 && warns <= 1) return { label: 'Strong', color: '#22c55e', note: 'verified code under immutable or DAO control, with the dimensions behind it in good shape' };
    if (fails <= 1) return { label: 'Fair', color: '#f59e0b', note: 'verified code under safe control, but some dimensions need work' };
    return { label: 'Weak', color: '#ef4444', note: 'verified code under safe control, but several dimensions fail' };
}
