// The DAO health check tree. Every leaf is an independent test with a `run`
// that returns { status, summary, details?, link? }; groups take the worst
// status of their children (see runner.js). Data that several leaves need is
// loaded once per run through ctx.load(key, loader).
import { idlFactory as rootIdl } from 'external/sns_root/sns_root.did.js';
import { idlFactory as governanceIdl } from 'external/sns_governance/sns_governance.did.js';
import { idlFactory as indexIdl } from 'external/sns_index/sns_index.did.js';
import { idlFactory as nnsGovIdl } from 'external/nns_gov/nns_gov.did.js';
import { idlFactory as vectorIdl } from 'external/icrc55_vector/icrc55_vector.did.js';
import { idlFactory as exVectorIdl } from 'external/icrc55_exvector/icrc55_exvector.did.js';
import { idlFactory as poolIdl } from 'external/icp_swap/icp_swap.did.js';
import { idlFactory as rllIdl } from 'declarations/rll/rll.did.js';
import { verifyTip } from '../utils/icrc3/client.js';
import { actor, withTimeout, ledgerIdl, swapIdl, pingIdl, archiveStatusIdl, sneedLockHealthIdl, stakingBotIdl, backendTokenListIdl, icpIndexIdl, accountIdentifierHex, hex, isMissingMethod, IDL, Principal } from './agent.js';
import { GUARDIANS, guardianIdl } from '../tokensafety/guardianIdl.js';
import { idlFactory as sneedLockFullIdl } from 'declarations/sneed_lock/sneed_lock.did.js';
import { getActiveTokenLocks, getActivePositionLocks } from '../utils/sneedLockLists';

// ---- the DAO as the checks know it ----

export const IDS = {
    root: 'fp274-iaaaa-aaaaq-aacha-cai',
    governance: 'fi3zi-fyaaa-aaaaq-aachq-cai',
    ledger: 'hvgxa-wqaaa-aaaaq-aacia-cai',
    index: 'h3e2i-naaaa-aaaaq-aacja-cai',
    icpLedger: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
    icpIndex: 'qhbym-qaaaa-aaaaa-aaafq-cai',
    nnsGovernance: 'rrkah-fqaaa-aaaaa-aaaaq-cai',
    backend: 'g7s5u-tqaaa-aaaad-qhktq-cai',
    sneedLock: 'pqsms-lqaaa-aaaal-ajjza-cai',
    rll: 'lvc4n-7aaaa-aaaam-adm6a-cai',
    premium: '7gump-4aaaa-aaaal-qtyka-cai',
    sms: 'zelpl-7yaaa-aaaad-abtcq-cai',
    forum: 'mcigm-4aaaa-aaaad-qhlkq-cai',
    sneedex: '7bvk3-ryaaa-aaaal-qtykq-cai',
    sneedapp: 'sfamc-kyaaa-aaaau-adnpq-cai',
    sgldt: 'i2s4q-syaaa-aaaan-qz4sq-cai',
    defi: 'ok64y-uiaaa-aaaag-qdcbq-cai',
    swaprunner: 'tt72q-zqaaa-aaaaj-az4va-cai',
    stakingBot: 'utrgg-zqaaa-aaaad-aduma-cai',
    neuronManager: 'trw7l-7iaaa-aaaad-admeq-cai',
    neuronVector: '6jvpj-sqaaa-aaaaj-azwnq-cai',   // Neutrinite pylon: ICP neuron (node 1), ICP splitter (6), SNEED splitter (45)
    buybackVector: 'togwv-zqaaa-aaaal-qr7aa-cai',  // ICPCoins exchange pylon: SNEED buyback (node 18; the pylon hides its nodes from anonymous callers)
    sneedIcpPool: 'osyzs-xiaaa-aaaag-qc76q-cai',
};

export const NAMES = {
    [IDS.root]: 'SNS root', [IDS.governance]: 'SNS governance', [IDS.ledger]: 'SNEED ledger', [IDS.index]: 'SNEED index',
    'h4f44-ayaaa-aaaaq-aacjq-cai': 'SNEED ledger archive', 'hshru-3iaaa-aaaaq-aaciq-cai': 'SNS swap',
    [IDS.backend]: 'App backend', [IDS.sneedLock]: 'Sneed Lock', [IDS.rll]: 'RLL (rewards)', [IDS.premium]: 'Sneed Premium',
    [IDS.sms]: 'Sneed SMS', [IDS.forum]: 'Sneed Forum', [IDS.sneedex]: 'Sneedex', [IDS.sneedapp]: 'Sneedapp (bot factory)',
    [IDS.sgldt]: 'sGLDT', [IDS.defi]: 'Sneed DeFi canister', 'pxtkg-giaaa-aaaal-ajjzq-cai': 'App frontend',
    [IDS.stakingBot]: 'ICP staking bot', [IDS.neuronManager]: 'ICP neuron manager', 'pojsz-fqaaa-aaaad-adoga-cai': 'Trading bot',
    [IDS.swaprunner]: 'Swaprunner', 's4yi7-yiaaa-aaaar-qacpq-cai': 'OpenChat escrow',
};
export const nameOf = (id) => NAMES[id] || id;

const NEURON_2Y = 4000934039483276792n;
const EIGHT_YEARS_S = 8n * 365n * 24n * 3600n + 2n * 24n * 3600n; // 252_460_800 as the NNS counts it
const TREASURY_SNEED_SUB = '8b0805942c48b3420d6edffecbb685e8c39ef574612a5d8a911fb068bf6648de';
const EXPECTED_LP_POSITIONS = [24n, 25n, 26n];
const DASHBOARD = (id) => `https://dashboard.internetcomputer.org/canister/${id}`;

// ---- helpers ----

const T = 1e12;
export const fmtT = (c) => `${(Number(c) / T).toFixed(2)} T`;
export const fmtUnits = (n, decimals = 8, digits = 2) => (Number(n) / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: digits });
export const fmtBytes = (n) => { const x = Number(n); return x >= 1e9 ? `${(x / 1e9).toFixed(2)} GB` : x >= 1e6 ? `${(x / 1e6).toFixed(1)} MB` : `${Math.round(x / 1e3)} kB`; };
export const ago = (ms) => {
    if (!ms) return 'never';
    const d = Date.now() - ms; const a = Math.abs(d);
    const [u, l] = a < 60e3 ? [1e3, 's'] : a < 3600e3 ? [60e3, 'm'] : a < 86400e3 ? [3600e3, 'h'] : [86400e3, 'd'];
    const n = Math.round(a / u);
    return d >= 0 ? `${n}${l} ago` : `in ${n}${l}`;
};
const nsToMs = (ns) => Number(BigInt(ns) / 1_000_000n);
const sToMs = (s) => Number(s) * 1000;
/// Vectors and canisters mix seconds, milliseconds and nanoseconds; guess by magnitude.
const tsMs = (x) => { const n = Number(x); if (!n) return 0; return n > 1e17 ? n / 1e6 : n > 1e14 ? n / 1e3 : n > 1e11 ? n : n * 1000; };
const PYLONS = { '6jvpj-sqaaa-aaaaj-azwnq-cai': 'Neutrinite pylon', 'togwv-zqaaa-aaaal-qr7aa-cai': 'ICPCoins pylon' };
const pylonIdl = (canister) => (canister === IDS.buybackVector ? exVectorIdl : vectorIdl);
/// A pylon account subaccount names the node it belongs to: byte 0 is 1, the node id follows.
const nodeIdOfSubaccount = (sub) => { const b = sub ? Uint8Array.from(sub) : null; if (!b || b.length !== 32 || b[0] !== 1) return null; return b[5] | (b[6] << 8) | (b[7] << 16) | (b[8] << 24); };
const accountKey = (a) => { const sub = opt(a.subaccount); return `${a.owner.toText()}:${sub && Array.from(sub).some((b) => b !== 0) ? hex(sub) : ''}`; };
const SYMBOLS = { 'ryjl3-tyaaa-aaaaa-aaaba-cai': 'ICP', 'hvgxa-wqaaa-aaaaq-aacia-cai': 'SNEED' };
const nodeType = (node) => { const c = opt(node?.custom); return c ? Object.keys(c)[0].replace(/^devefi_(jes1_)?/, '') : 'unknown'; };
const opt = (v) => (Array.isArray(v) ? v[0] : v);
const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
const pass = (summary, details, link) => ({ status: 'pass', summary, details, link });
const warn = (summary, details, link) => ({ status: 'warn', summary, details, link });
const fail = (summary, details, link) => ({ status: 'fail', summary, details, link });
const skip = (summary, details, link) => ({ status: 'skip', summary, details, link });
/// A registered canister with no code: a dapp that was frozen and deleted, or never installed.
const IGNORED_SUMMARY = 'No code installed; ignored (deregister it from the SNS to clean up)';
const DEFAULT_WASM_MEMORY_LIMIT = 3n * 1024n ** 3n; // the IC default when a canister sets none
/// The hard cap this canister's memory_size runs into first.
const memoryLimit = (st) => {
    if (st.memoryAllocation > 0n) return { limit: st.memoryAllocation, kind: 'memory allocation' };
    if (st.wasmMemoryLimit > 0n) return { limit: st.wasmMemoryLimit, kind: 'Wasm memory limit' };
    return { limit: DEFAULT_WASM_MEMORY_LIMIT, kind: 'IC default Wasm memory limit' };
};
const cyclesStatus = (cycles, orangeT, redT) => (Number(cycles) < redT * T ? 'fail' : Number(cycles) < orangeT * T ? 'warn' : 'pass');

// ---- shared loaders ----

const loaders = {
    summary: async (ctx) => {
        const root = await actor(rootIdl, IDS.root);
        const res = await ctx.call(root.get_sns_canisters_summary({ update_canister_list: [] }), 'SNS root canister summary', 90);
        const entries = [];
        const add = (s, role) => {
            const id = opt(s?.canister_id);
            if (!id) return;
            const st = opt(s.status);
            entries.push({
                id: id.toText(), role,
                status: st ? {
                    running: Object.keys(st.status)[0], cycles: st.cycles, memory: st.memory_size, idleBurn: st.idle_cycles_burned_per_day,
                    moduleHash: opt(st.module_hash) ? Array.from(opt(st.module_hash), (b) => b.toString(16).padStart(2, '0')).join('') : null,
                    controllers: st.settings.controllers.map((p) => p.toText()),
                    memoryAllocation: opt(st.settings.memory_allocation) ?? 0n,
                    wasmMemoryLimit: opt(st.settings.wasm_memory_limit) ?? 0n,
                } : null,
            });
        };
        for (const role of ['root', 'swap', 'ledger', 'index', 'governance']) add(opt(res[role]), role);
        for (const s of res.archives) add(s, 'ledger archive');
        for (const s of res.dapps) add(s, 'dapp');
        return entries;
    },
    snsCanisters: async (ctx) => {
        const root = await actor(rootIdl, IDS.root);
        return ctx.call(root.list_sns_canisters({}), 'SNS root canister list');
    },
    rllLoop: async (ctx) => ctx.call((await actor(rllIdl, IDS.rll)).get_main_loop_status(), 'RLL loop status'),
    rllEvents: async (ctx) => ctx.call((await actor(rllIdl, IDS.rll)).get_distribution_events(), 'RLL distribution events'),
    lockStatus: async (ctx) => {
        const lock = await actor(sneedLockHealthIdl, IDS.sneedLock);
        try { return await ctx.call(lock.icrc3_log_status(), 'Sneed Lock log status'); } catch (e) { if (isMissingMethod(e)) return null; throw e; }
    },
    lockRegistration: async (ctx) => {
        const lock = await actor(sneedLockHealthIdl, IDS.sneedLock);
        try { return await ctx.call(lock.icrc3_registration_status(), 'Sneed Lock registration status'); } catch (e) { if (isMissingMethod(e)) return null; throw e; }
    },
    vectorNode: (canister, nodeId) => async (ctx) => {
        const pylon = await actor(pylonIdl(canister), canister);
        const nodes = await ctx.call(pylon.icrc55_get_nodes([{ id: nodeId }]), `vector node ${nodeId}`);
        return opt(nodes[0]) || null;
    },
    /// Every vector node the DAO (governance) controls, on every pylon we know.
    daoNodes: async (ctx) => {
        const out = [];
        await Promise.all(Object.keys(PYLONS).map(async (canister) => {
            const pylon = await actor(pylonIdl(canister), canister);
            const nodes = await ctx.call(pylon.icrc55_get_controller_nodes({ id: { owner: Principal.fromText(IDS.governance), subaccount: [] }, start: 0, length: 200 }), `${PYLONS[canister]} nodes`);
            for (const node of nodes) out.push({ canister, node });
        }));
        return out.sort((a, b) => a.canister.localeCompare(b.canister) || Number(a.node.id) - Number(b.node.id));
    },
    /// Recent transactions of one account, newest first, normalised across the
    /// ICP index (account identifiers) and the SNEED index (ICRC-1 accounts):
    /// { self, balance, txs: [{ at, from, to, fromOwner, amount }] }, keys being
    /// account-identifier hex on ICP and "owner:subaccount-hex" on SNEED. Null
    /// when no index is known for the ledger.
    accountTxs: (ledgerId, owner, subaccount, max = 40) => async (ctx) => {
        const sub = subaccount && subaccount.some((b) => b !== 0) ? Uint8Array.from(subaccount) : null;
        if (ledgerId === IDS.icpLedger) {
            const index = await actor(icpIndexIdl, IDS.icpIndex);
            const r = await ctx.call(index.get_account_transactions({ account: { owner, subaccount: sub ? [sub] : [] }, start: [], max_results: BigInt(max) }), 'ICP index');
            if ('Err' in r) throw new Error(r.Err.message);
            const txs = r.Ok.transactions.map(({ transaction: t }) => {
                const k = Object.keys(t.operation)[0]; const op = t.operation[k];
                return { at: Number(opt(t.timestamp)?.timestamp_nanos ?? 0n) / 1e6, kind: k, from: op.from || null, to: op.to || null, fromOwner: null, amount: op.amount?.e8s ?? 0n };
            }).filter((t) => t.kind !== 'Approve');
            return { self: accountIdentifierHex(owner, sub), balance: r.Ok.balance, txs };
        }
        if (ledgerId === IDS.ledger) {
            const index = await actor(indexIdl, IDS.index);
            const r = await ctx.call(index.get_account_transactions({ account: { owner, subaccount: sub ? [sub] : [] }, start: [], max_results: BigInt(max) }), 'SNEED index');
            if ('Err' in r) throw new Error(r.Err.message);
            const txs = r.Ok.transactions.map(({ transaction: t }) => {
                const x = opt(t.transfer) || opt(t.mint) || opt(t.burn);
                return { at: Number(t.timestamp) / 1e6, kind: t.kind, from: x?.from ? accountKey(x.from) : null, to: x?.to ? accountKey(x.to) : null, fromOwner: x?.from ? x.from.owner.toText() : null, amount: x?.amount ?? 0n };
            }).filter((t) => t.kind !== 'approve');
            return { self: accountKey({ owner, subaccount: sub ? [sub] : [] }), balance: r.Ok.balance, txs };
        }
        return null;
    },
    nnsNeuron: async (ctx) => {
        const gov = await actor(nnsGovIdl, IDS.nnsGovernance);
        const r = await ctx.call(gov.get_neuron_info(NEURON_2Y), 'NNS neuron info');
        if ('Err' in r) throw new Error(r.Err.error_message || 'NNS governance returned an error');
        return r.Ok;
    },
    ledgerInfo: async (ctx) => {
        const ledger = await actor(ledgerIdl, IDS.ledger);
        const [head, decimals] = await Promise.all([ctx.call(ledger.icrc3_get_blocks([]), 'SNEED ledger'), ctx.call(ledger.icrc1_decimals(), 'SNEED decimals')]);
        return { logLength: head.log_length, decimals: Number(decimals) };
    },
};

// ---- leaf builders ----

const vectorLink = (canister, nodeId) => (canister === IDS.buybackVector ? `https://beta.icpcoins.com/#/vector/modify/${canister}/exchange/${nodeId}` : `https://vectors.neuronpool.com/vectors/${IDS.governance}/${nodeId}`);

function vectorLeaf({ id, name, canister, node, link, extra }) {
    return {
        id, name, link: link || vectorLink(canister, node.id),
        run: async (ctx) => {
            const frozen = node.billing?.frozen === true;
            const details = {
                pylon: `${PYLONS[canister] || canister} node ${node.id}`, type: nodeType(node), active: node.active, frozen,
                billing_balance: node.billing?.current_balance?.toString(), cost_per_day: node.billing?.cost_per_day?.toString(),
                expires: opt(node.billing?.expires) ? new Date(tsMs(opt(node.billing.expires))).toISOString() : null,
                sources: (node.sources || []).map((s) => `${s.name || 'source'}: ${s.balance.toString()}`),
                destinations: (node.destinations || []).map((d) => { const a = opt(d.endpoint?.ic?.account); return `${d.name}: ${a ? a.owner.toText() : '?'}${a && opt(a.subaccount) ? ' (sub)' : ''}`; }),
                modified: node.modified ? new Date(tsMs(node.modified)).toISOString() : null,
            };
            if (!node.active) return fail('Vector is inactive', details);
            if (frozen) return fail('Vector is frozen (billing)', details);
            if (opt(node.billing?.expires)) return warn(`Vector billing expires ${ago(tsMs(opt(node.billing.expires)))}`, details);
            return extra ? extra(node, details, ctx) : pass('Active and funded', details);
        },
    };
}

const lastActivity = (log) => {
    if (!log || log.length === 0) return null;
    const last = log[log.length - 1];
    const k = Object.keys(last)[0];
    return { ok: k === 'Ok', operation: last[k].operation, msg: last[k].msg, at: tsMs(last[k].timestamp) };
};

/// Extra checks per vector type.
const vectorExtras = {
    icpneuron: (c) => (node, details) => {
        const neuron = opt(node.custom)?.devefi_jes1_icpneuron;
        const maturity = opt(neuron.cache?.maturity_e8s_equivalent);
        const stake = opt(neuron.cache?.cached_neuron_stake_e8s);
        const act = lastActivity(neuron.log);
        Object.assign(details, { maturity_icp: maturity !== undefined ? fmtUnits(maturity) : null, stake_icp: stake !== undefined ? fmtUnits(stake) : null, neuron_id: opt(neuron.cache?.neuron_id)?.toString(), dissolve_delay_days: opt(neuron.cache?.dissolve_delay_seconds) !== undefined ? Number(opt(neuron.cache.dissolve_delay_seconds)) / 86400 : null, last_activity: act ? `${act.ok ? 'ok' : 'error'} ${act.operation} ${ago(act.at)}${act.msg ? `: ${act.msg}` : ''}` : null, updating: neuron.internals?.updating ? Object.keys(neuron.internals.updating)[0] : null, disbursements_in_progress: opt(neuron.cache?.maturity_disbursements_in_progress)?.length ?? 0 });
        if (act && !act.ok) return warn(`Last operation failed: ${act.operation} (${act.msg})`, details);
        const okAt = [...(neuron.log || [])].reverse().find((e) => 'Ok' in e)?.Ok?.timestamp;
        if (!okAt) return warn('No successful operation in the vector log', details);
        if (Date.now() - tsMs(okAt) > c.vectorActivityDays * 86400e3) return warn(`Last successful operation ${ago(tsMs(okAt))}`, details);
        const lastDisburse = [...(neuron.log || [])].reverse().find((e) => e.Ok?.operation === 'disburse_maturity')?.Ok?.timestamp;
        return pass(`Stake ${stake !== undefined ? fmtUnits(stake, 8, 0) : '?'} ICP, maturity ${maturity !== undefined ? fmtUnits(maturity) : '?'} ICP, last disbursement ${lastDisburse ? ago(tsMs(lastDisburse)) : 'never'}`, details);
    },
    exchange: (c) => (node, details) => {
        const ex = opt(node.custom)?.exchange;
        const { internals: i, variables: v } = ex;
        const lastBuy = tsMs(i.last_buy); const nextBuy = tsMs(i.next_buy); const interval = Number(v.buy_interval_seconds) * 1000;
        const balance = node.sources?.[0]?.balance ?? 0n;
        Object.assign(details, { last_buy: lastBuy ? new Date(lastBuy).toISOString() : null, next_buy: nextBuy ? new Date(nextBuy).toISOString() : null, buy_interval_h: interval / 3600e3, buy_for_icp: fmtUnits(v.buy_for_amount), source_icp: fmtUnits(balance), rate: opt(i.current_rate), last_error: opt(i.last_error) || null, last_run: i.last_run ? ago(tsMs(i.last_run)) : null });
        if (opt(i.last_error)) return warn(`Last run reported: ${opt(i.last_error)}`, details);
        const idle = BigInt(balance) < BigInt(v.buy_for_amount);
        if (!lastBuy) return idle ? pass('No buy yet; waiting for ICP to arrive', details) : warn('Funded but has never bought', details);
        if (Date.now() - lastBuy > c.buybackSlackFactor * interval && !idle) return warn(`Funded but last buy ${ago(lastBuy)} (interval ${interval / 3600e3} h)`, details);
        return pass(`Last buy ${ago(lastBuy)}, ${fmtUnits(balance)} ICP waiting`, details);
    },
    split: (c) => async (node, details, ctx) => {
        // Every destination that points at a pylon node must point at a node
        // that exists and is active. A pylon that hides its nodes (the ICPCoins
        // pylon answers null for every id) is checked through the ledger
        // instead: what the splitter delivered there must have been picked up.
        const shares = opt(node.custom)?.devefi_split?.variables?.split || [];
        const problems = [];
        const warnings = [];
        const notes = [];
        let i = 0;
        for (const d of node.destinations || []) {
            const a = opt(d.endpoint?.ic?.account);
            const share = shares[i] !== undefined ? `${shares[i]}%` : d.name;
            i += 1;
            if (!a) continue;
            const owner = a.owner.toText();
            const nodeId = PYLONS[owner] ? nodeIdOfSubaccount(opt(a.subaccount)) : null;
            if (nodeId === null) continue;
            const where = `${share} to ${PYLONS[owner]} node ${nodeId}`;
            const target = await ctx.load(`vector:${owner}:${nodeId}`, loaders.vectorNode(owner, nodeId));
            if (target) {
                if (!target.active) problems.push(`${where}, which is inactive`);
                continue;
            }
            const ledgerId = opt(d.endpoint?.ic?.ledger)?.toText?.() || d.endpoint?.ic?.ledger?.toText?.();
            const v = await deliveryByLedger(ctx, c, ledgerId, a);
            (v.status === 'fail' ? problems : v.status === 'warn' ? warnings : notes).push(`${where}: ${v.text}`);
        }
        details.split = shares.map((x) => `${x}%`).join(' / ');
        if (notes.length) details.verified_by_ledger = notes;
        if (problems.length) return fail(problems.join('; '), details);
        if (warnings.length) return warn(warnings.join('; '), details);
        return pass(`Active, splits ${details.split}${notes.length ? ` (${notes.length} destination${notes.length > 1 ? 's' : ''} verified by ledger)` : ''}`, details);
    },
};

/// When a pylon does not show a destination node, the ledger tells whether
/// the node is alive: a live node sweeps what the splitter delivers.
async function deliveryByLedger(ctx, c, ledgerId, account) {
    const sub = opt(account.subaccount);
    const r = await ctx.load(`txs:${ledgerId}:${account.owner.toText()}:${sub ? hex(sub) : ''}`, loaders.accountTxs(ledgerId, account.owner, sub));
    const symbol = SYMBOLS[ledgerId] || 'tokens';
    if (!r) {
        // No index for this ledger: the balance alone tells whether something is stuck.
        const l = await actor(ledgerIdl, ledgerId);
        const balance = await ctx.call(l.icrc1_balance_of({ owner: account.owner, subaccount: sub ? [Uint8Array.from(sub)] : [] }), 'destination balance');
        if (balance === 0n) return { status: 'pass', text: 'the pylon does not show this node; nothing is waiting on its account' };
        return { status: 'warn', text: `the pylon does not show this node and ${balance.toString()} base units of ledger ${ledgerId} are waiting on its account (no index to tell since when)` };
    }
    const lastIn = r.txs.find((t) => t.to === r.self);
    const lastOut = r.txs.find((t) => t.from === r.self);
    if (!lastIn) return { status: 'pass', text: 'the pylon does not show this node; it has never received anything, nothing to verify' };
    const delivered = `${fmtUnits(lastIn.amount)} ${symbol} delivered ${ago(lastIn.at)}`;
    if (lastOut && lastOut.at >= lastIn.at) return { status: 'pass', text: `the pylon does not show this node, but the ledger does: ${delivered}, picked up ${ago(lastOut.at)}` };
    const waiting = Date.now() - lastIn.at;
    const text = `${delivered} and not picked up yet (${fmtUnits(r.balance)} ${symbol} on the account)`;
    return { status: waiting > c.pickupHours * 3600e3 ? 'fail' : 'pass', text: waiting > c.pickupHours * 3600e3 ? `the pylon does not show this node and ${text}` : `the pylon does not show this node; ${text}, within the ${c.pickupHours} h allowed` };
}


// ---- the tree ----

export function buildTree(config) {
    const c = config;
    const ignored = (e) => c.ignoreEmptyCanisters && e.status && !e.status.moduleHash;
    const pingLeaf = (id, name, method, idl = pingIdl(method, (I) => I.Reserved), link) => ({
        id: `ping:${id}`, name, link: link || DASHBOARD(id),
        run: async (ctx) => {
            const a = await actor(idl, id);
            const t0 = Date.now();
            await ctx.call(a[method](), `${name}.${method}`);
            return pass(`Answered ${method} in ${Date.now() - t0} ms`);
        },
    });

    const canistersGroup = {
        id: 'canisters', name: 'Canisters', dynamic: true,
        children: async (ctx) => {
            const entries = await ctx.load('summary', loaders.summary);
            return [
                {
                    id: 'cycles', name: 'Cycles',
                    children: entries.map((e) => ({
                        id: `cycles:${e.id}`, name: nameOf(e.id), link: DASHBOARD(e.id),
                        run: async () => {
                            if (!e.status) return fail('SNS root could not read this canister');
                            if (ignored(e)) return skip(IGNORED_SUMMARY, { canister: e.id, role: e.role });
                            const s = cyclesStatus(e.status.cycles, c.cyclesOrangeT, c.cyclesRedT);
                            const days = Number(e.status.idleBurn) > 0 ? Math.round(Number(e.status.cycles) / Number(e.status.idleBurn)) : null;
                            return { status: s, summary: `${fmtT(e.status.cycles)}${days !== null ? `, about ${days} days at idle burn` : ''}`, details: { canister: e.id, role: e.role, idle_burn_per_day: e.status.idleBurn.toString() } };
                        },
                    })),
                },
                {
                    id: 'state', name: 'Running and controlled by the DAO',
                    children: entries.map((e) => ({
                        id: `state:${e.id}`, name: nameOf(e.id), link: DASHBOARD(e.id),
                        run: async () => {
                            if (!e.status) return fail('No status');
                            const details = { canister: e.id, state: e.status.running, controllers: e.status.controllers, memory: fmtBytes(e.status.memory), module_hash: e.status.moduleHash };
                            if (ignored(e)) return skip(IGNORED_SUMMARY, details);
                            if (e.status.running !== 'running') return fail(`Canister is ${e.status.running}`, details);
                            if (!e.status.moduleHash) return fail('No code installed', details);
                            const others = e.status.controllers.filter((p) => p !== IDS.root);
                            if (e.role !== 'root' && others.length > 0) return warn(`Controllers besides SNS root: ${others.join(', ')}`, details);
                            return pass(`Running, ${fmtBytes(e.status.memory)} memory`, details);
                        },
                    })),
                },
                {
                    id: 'memory', name: 'Memory',
                    children: entries.map((e) => ({
                        id: `memory:${e.id}`, name: nameOf(e.id), link: DASHBOARD(e.id),
                        run: async () => {
                            if (!e.status) return fail('SNS root could not read this canister');
                            if (ignored(e)) return skip(IGNORED_SUMMARY, { canister: e.id, role: e.role });
                            const { limit, kind } = memoryLimit(e.status);
                            const pct = (Number(e.status.memory) / Number(limit)) * 100;
                            const details = { canister: e.id, role: e.role, memory_size: fmtBytes(e.status.memory), limit: `${fmtBytes(limit)} (${kind})`, note: 'memory_size counts the Wasm heap, stable memory and the module together; the Wasm memory limit applies to the heap alone' };
                            const s = pct >= c.memoryRedPct ? 'fail' : pct >= c.memoryOrangePct ? 'warn' : 'pass';
                            return { status: s, summary: `${fmtBytes(e.status.memory)}, ${pct.toFixed(1)}% of ${fmtBytes(limit)}`, details };
                        },
                    })),
                },
            ];
        },
    };

    const servicesGroup = {
        id: 'services', name: 'Services responding',
        children: [
            { id: 'ping:frontend', name: 'App frontend', link: 'https://app.sneeddao.com', run: async (ctx) => { const t0 = Date.now(); const r = await ctx.call(fetch('/index.html', { cache: 'no-store' }), 'frontend'); return r.ok ? pass(`Served index.html in ${Date.now() - t0} ms`) : fail(`HTTP ${r.status}`); } },
            {
                id: 'tokens:refresh', name: 'Token list refreshed daily', link: DASHBOARD(IDS.backend), run: async (ctx) => {
                    // The backend imports ICPSwap's trusted token list and refreshes every token's metadata on a daily timer.
                    const b = await actor(backendTokenListIdl, IDS.backend);
                    let st;
                    try { st = await ctx.call(b.get_token_list_status(), 'token list status'); } catch (e) { if (isMissingMethod(e)) return skip('Backend build without the daily token list job (not upgraded yet)'); throw e; }
                    const nowNs = BigInt(Date.now()) * 1000000n;
                    const ageH = (t) => (t > 0n ? Number((nowNs - t) / 3600000000000n) : null);
                    const importAge = ageH(st.last_import); const doneAge = ageH(st.last_refresh_done);
                    const details = { tokens: Number(st.tokens), interval_hours: Number(st.interval_seconds) / 3600, timer_scheduled: st.timer_scheduled, refresh_running: st.refresh_running, last_import: st.last_import > 0n ? new Date(Number(st.last_import / 1000000n)).toISOString() : 'never', last_refresh_done: st.last_refresh_done > 0n ? new Date(Number(st.last_refresh_done / 1000000n)).toISOString() : 'never', last_error: st.last_error || null };
                    if (!st.timer_scheduled) return fail('The daily token list timer is not scheduled', details);
                    const intervalH = Number(st.interval_seconds) / 3600;
                    if (importAge === null) return warn(`Timer scheduled, first run pending (${details.tokens} tokens listed)`, details);
                    if (importAge > 7 * intervalH) return fail(`Last whitelist import ${importAge} h ago`, details);
                    if (importAge > 2 * intervalH || (doneAge !== null && doneAge > 2 * intervalH)) return warn(`Last whitelist import ${importAge} h ago, last metadata refresh ${doneAge ?? '?'} h ago`, details);
                    if (st.last_error) return warn(`Last run reported: ${st.last_error}`, details);
                    return pass(`${details.tokens} tokens; whitelist imported ${importAge} h ago, metadata refreshed ${doneAge ?? '?'} h ago`, details);
                },
            },
            pingLeaf(IDS.backend, 'App backend', 'get_admins'),
            pingLeaf(IDS.sneedLock, 'Sneed Lock', 'get_admin_list'),
            pingLeaf(IDS.rll, 'RLL (rewards)', 'get_main_loop_status'),
            pingLeaf(IDS.forum, 'Sneed Forum', 'get_current_counter'),
            pingLeaf(IDS.sms, 'Sneed SMS', 'get_admins'),
            pingLeaf(IDS.premium, 'Sneed Premium', 'getCanisterId'),
            pingLeaf(IDS.sneedex, 'Sneedex', 'getConfig'),
            ...GUARDIANS.map((g) => ({
                id: `custody:${g.id}`, name: `${g.name} (custody) and its children`, link: `/guardian?deployment=${g.key}`,
                run: async (ctx) => {
                    const a = await actor(guardianIdl, g.id);
                    const [cfg, rows] = await Promise.all([ctx.call(a.get_config(), `${g.name}.get_config`), ctx.call(a.get_cycles_report([]), `${g.name}.get_cycles_report`)]);
                    const ageH = cfg.status_last_run ? Math.round((Date.now() - Number(cfg.status_last_run) / 1e6) / 3_600_000) : null;
                    const low = rows.filter((r) => r.low); const errs = rows.filter((r) => r.error.length);
                    const details = { children: Number(cfg.children), open_ops: null, own_cycles: cfg.own_cycles.toString(), status_age_h: ageH, blessed_versions: cfg.blessed.ledger.length, blessed_error: cfg.blessed_error[0] || null, low: low.map((r) => `${r.title} ${r.canister_id.toText()}: ${(Number(r.cycles) / 1e12).toFixed(2)} T`), errors: errs.map((r) => `${r.title}: ${r.error[0]}`) };
                    if (low.length) return fail(`${low.length} canister(s) under ${(Number(cfg.low_cycles_threshold) / 1e12).toFixed(1)} T cycles`, details);
                    if (cfg.blessed_error.length) return warn(`Could not read the blessed versions: ${cfg.blessed_error[0]}`, details);
                    if (errs.length) return warn(`${errs.length} child status read(s) failed`, details);
                    if (ageH !== null && ageH > 2 * Number(cfg.status_interval_s) / 3600) return warn(`Last status run ${ageH} h ago`, details);
                    return pass(`${Number(cfg.children)} children, none low; own balance ${(Number(cfg.own_cycles) / 1e12).toFixed(2)} T`, details);
                },
            })),
            {
                id: `sneedex-timer:${IDS.sneedex}`, name: 'Sneedex expiration timer', link: DASHBOARD(IDS.sneedex),
                run: async (ctx) => {
                    const idl = ({ IDL }) => IDL.Service({
                        isExpirationTimerRunning: IDL.Func([], [IDL.Bool], ['query']),
                        isExpirationWorkerRunning: IDL.Func([], [IDL.Bool], ['query']),
                        getExpirationCheckInterval: IDL.Func([], [IDL.Nat], ['query']),
                        getActiveOffers: IDL.Func([], [IDL.Vec(IDL.Record({ id: IDL.Nat, expiration: IDL.Opt(IDL.Int) }))], ['query']),
                    });
                    const a = await actor(idl, IDS.sneedex);
                    const [running, working, interval, active] = await Promise.all([
                        ctx.call(a.isExpirationTimerRunning(), 'Sneedex.isExpirationTimerRunning'),
                        ctx.call(a.isExpirationWorkerRunning(), 'Sneedex.isExpirationWorkerRunning'),
                        ctx.call(a.getExpirationCheckInterval(), 'Sneedex.getExpirationCheckInterval'),
                        ctx.call(a.getActiveOffers(), 'Sneedex.getActiveOffers'),
                    ]);
                    const nowNs = BigInt(Date.now()) * 1_000_000n;
                    const intervalS = Number(interval);
                    // an offer is overdue when it ran out more than two timer intervals ago and is still Active
                    const overdue = active.filter((o) => o.expiration.length && o.expiration[0] + BigInt(2 * intervalS) * 1_000_000_000n < nowNs);
                    const details = { timer_running: running, worker_running: working, interval_s: intervalS, active_offers: active.length, overdue_offers: overdue.map((o) => Number(o.id)) };
                    if (!running) return fail('The expiration timer is not running (offers will not expire on their own)', details);
                    if (overdue.length) return warn(`${overdue.length} offer(s) ran out more than ${2 * intervalS} s ago and are still Active`, details);
                    return pass(`Timer running every ${intervalS} s; ${active.length} active offers, none overdue`, details);
                },
            },
            pingLeaf(IDS.sneedapp, 'Sneedapp (bot factory)', 'getCurrentVersion'),
            pingLeaf(IDS.sgldt, 'sGLDT', 'get_fee_collector'),
            pingLeaf(IDS.stakingBot, 'ICP staking bot', 'getVersion', stakingBotIdl),
            pingLeaf(IDS.neuronManager, 'ICP neuron manager', 'getVersion', stakingBotIdl),
            pingLeaf(IDS.ledger, 'SNEED ledger', 'icrc1_total_supply', ledgerIdl),
            pingLeaf(IDS.index, 'SNEED index', 'status', indexIdl),
            {
                id: `ping:${IDS.governance}`, name: 'SNS governance', link: DASHBOARD(IDS.governance),
                run: async (ctx) => { const g = await actor(governanceIdl, IDS.governance); const t0 = Date.now(); await ctx.call(g.get_running_sns_version({}), 'governance version'); return pass(`Answered get_running_sns_version in ${Date.now() - t0} ms`); },
            },
        ],
    };

    const snsGroup = {
        id: 'sns', name: 'SNS core',
        children: [
            {
                id: 'sns:mode', name: 'Governance in normal mode', link: 'https://nns.ic0.app/project/?project=fp274-iaaaa-aaaaq-aacha-cai',
                run: async (ctx) => { const g = await actor(governanceIdl, IDS.governance); const r = await ctx.call(g.get_mode({}), 'governance mode'); const mode = Number(opt(r.mode)); return mode === 1 ? pass('Normal mode') : fail(`Mode ${mode} (1 = normal, 2 = pre-initialization swap)`); },
            },
            {
                id: 'sns:rewards', name: 'Voting rewards distributed on schedule',
                run: async (ctx) => {
                    const g = await actor(governanceIdl, IDS.governance);
                    const [ev, params] = await Promise.all([ctx.call(g.get_latest_reward_event(), 'reward event'), ctx.call(g.get_nervous_system_parameters(null), 'nervous system parameters')]);
                    const vrp = opt(params.voting_rewards_parameters);
                    const round = Number(opt(vrp?.round_duration_seconds) || 86400);
                    const rate = Number(opt(vrp?.final_reward_rate_basis_points) ?? opt(vrp?.initial_reward_rate_basis_points) ?? 0);
                    const at = sToMs(ev.actual_timestamp_seconds);
                    if (rate === 0) return skip(`Voting rewards are switched off (0 basis points); last reward round ${ev.round} was ${ago(at)}`);
                    const details = { round: ev.round.toString(), last_event: new Date(at).toISOString(), round_duration_h: round / 3600, distributed_e8s: ev.distributed_e8s_equivalent.toString(), rounds_since_last_distribution: opt(ev.rounds_since_last_distribution)?.toString() };
                    if (Date.now() - at > 2 * round * 1000) return fail(`Last reward event ${ago(at)}, rounds are ${round / 3600} h`, details);
                    return pass(`Round ${ev.round}, last event ${ago(at)}`, details);
                },
            },
            {
                id: 'sns:proposals', name: 'Recent proposals executed without failure', link: 'https://nns.ic0.app/proposals/?project=fp274-iaaaa-aaaaq-aacha-cai',
                run: async (ctx) => {
                    const g = await actor(governanceIdl, IDS.governance);
                    const r = await ctx.call(g.list_proposals({ include_reward_status: [], before_proposal: [], limit: 50, exclude_type: [], include_status: [], include_topics: [] }), 'proposals');
                    const since = Date.now() / 1000 - c.proposalWindowDays * 86400;
                    const recent = r.proposals.filter((p) => Number(p.proposal_creation_timestamp_seconds) >= since);
                    const failed = recent.filter((p) => Number(p.failed_timestamp_seconds) > 0);
                    const open = recent.filter((p) => Number(p.decided_timestamp_seconds) === 0);
                    const details = { window_days: c.proposalWindowDays, proposals: recent.length, open: open.length, failed: failed.map((p) => `#${opt(p.id)?.id}: ${opt(p.proposal)?.title || ''} (${opt(p.failure_reason)?.error_message || 'failed'})`) };
                    if (failed.length) return warn(`${failed.length} failed proposal(s) in the last ${c.proposalWindowDays} days`, details);
                    return pass(`${recent.length} proposal(s) in the last ${c.proposalWindowDays} days, ${open.length} open, none failed`, details);
                },
            },
            {
                id: 'sns:tip', name: 'SNEED ledger tip certified', link: `/tools/icrc3?canister=${IDS.ledger}`,
                run: async (ctx) => { const tip = await ctx.call(verifyTip(Principal.fromText(IDS.ledger)), 'ledger tip'); return tip ? pass(`Certified tip at block ${tip.lastIndex}`) : fail('Ledger returned no tip certificate'); },
            },
            {
                id: 'sns:index', name: 'SNEED index in sync with the ledger', link: DASHBOARD(IDS.index),
                run: async (ctx) => {
                    const [{ logLength }, st] = await Promise.all([ctx.load('ledgerInfo', loaders.ledgerInfo), ctx.call((await actor(indexIdl, IDS.index)).status(), 'index status')]);
                    const lag = Number(logLength) - Number(st.num_blocks_synced);
                    const details = { ledger_blocks: logLength.toString(), index_synced: st.num_blocks_synced.toString(), lag };
                    return lag > c.indexLagBlocks ? warn(`Index trails the ledger by ${lag} blocks`, details) : pass(`${lag} block(s) behind the ledger`, details);
                },
            },
            {
                id: 'sns:swap', name: 'Decentralization swap committed',
                run: async (ctx) => {
                    const list = await ctx.load('snsCanisters', loaders.snsCanisters);
                    const swapId = opt(list.swap);
                    if (!swapId) return fail('SNS root lists no swap canister');
                    const s = await actor(swapIdl, swapId);
                    const r = await ctx.call(s.get_lifecycle({}), 'swap lifecycle');
                    const lc = Number(opt(r.lifecycle));
                    return lc === 3 ? pass('Lifecycle: committed') : warn(`Lifecycle ${lc} (3 = committed)`);
                },
            },
        ],
    };

    const revenueGroup = {
        id: 'revenue', name: 'Revenue loop', dynamic: true,
        children: async (ctx) => {
            const nodes = await ctx.load('daoNodes', loaders.daoNodes);
            const leaves = [{
                id: 'rev:neuron', name: 'DAO ICP neuron locked', link: `https://dashboard.internetcomputer.org/neuron/${NEURON_2Y}`,
                run: async (ctx2) => {
                    const n = await ctx2.load('nnsNeuron', loaders.nnsNeuron);
                    const dd = BigInt(n.dissolve_delay_seconds);
                    const details = { neuron: NEURON_2Y.toString(), stake_icp: fmtUnits(n.stake_e8s), dissolve_delay_days: Number(dd / 86400n), state: Number(n.state), age_days: Number(BigInt(n.age_seconds) / 86400n) };
                    if (Number(n.state) !== 1) return fail(`Neuron is not locked (state ${Number(n.state)})`, details);
                    if (dd < BigInt(Math.round(c.minNeuronDissolveDays)) * 86400n) return warn(`Dissolve delay is ${Number(dd / 86400n)} days, below the ${c.minNeuronDissolveDays} expected`, details);
                    return pass(`Locked for ${Number(dd / 86400n)} days with ${fmtUnits(n.stake_e8s, 8, 0)} ICP`, details);
                },
            }];
            const typeNames = { icpneuron: 'ICP neuron vector', snsneuron: 'SNS neuron vector', split: 'Splitter vector', exchange: 'Exchange vector (buyback)' };
            for (const { canister, node } of nodes) {
                const type = nodeType(node);
                const extra = vectorExtras[type]?.(c);
                const names = (node.destinations || []).map((d) => d.name).filter(Boolean);
                leaves.push(vectorLeaf({
                    id: `rev:vector:${canister}:${node.id}`, canister, node, extra,
                    name: `${typeNames[type] || `Vector (${type})`} #${node.id}${type === 'split' && names.length ? ` (${names.join('/')})` : ''}`,
                }));
            }
            leaves.push({
                id: 'rev:buyback', name: 'SNEED buyback delivering', link: 'https://beta.icpcoins.com/#/vectors',
                run: async (ctx2) => {
                    // The exchange vector lives on the ICPCoins pylon, which does
                    // not show its nodes to anonymous callers; the SNEED ledger
                    // shows its output: SNEED sent from that pylon to the DAO's
                    // SNEED splitter(s) on the Neutrinite pylon.
                    const ex = nodes.filter(({ node }) => nodeType(node) === 'exchange');
                    const sneedSplitters = nodes.filter(({ node }) => nodeType(node) === 'split' && opt(node.sources?.[0]?.endpoint?.ic)?.ledger?.toText?.() === IDS.ledger);
                    if (sneedSplitters.length === 0) return fail('No SNEED splitter vector controlled by governance, so there is nowhere a buyback could deliver to');
                    const buys = [];
                    for (const { node } of sneedSplitters) {
                        const a = opt(node.sources[0].endpoint.ic.account);
                        const sub = opt(a.subaccount);
                        const r = await ctx2.load(`txs:${IDS.ledger}:${a.owner.toText()}:${sub ? hex(sub) : ''}`, loaders.accountTxs(IDS.ledger, a.owner, sub));
                        for (const t of r.txs) if (t.to === r.self && t.fromOwner === IDS.buybackVector) buys.push({ ...t, splitter: node.id });
                    }
                    buys.sort((x, y) => y.at - x.at);
                    const dayAgo = Date.now() - 86400e3;
                    const recent = buys.filter((b) => b.at >= dayAgo);
                    const details = {
                        exchange_vectors_visible: ex.map(({ canister, node }) => `${PYLONS[canister]} node ${node.id}`),
                        note: 'The ICPCoins pylon does not show its nodes to anonymous callers; the buyback is verified by SNEED arriving from it at the DAO SNEED splitter.',
                        last_buys: buys.slice(0, 5).map((b) => `${new Date(b.at).toISOString()} ${fmtUnits(b.amount, 8, 4)} SNEED to splitter #${b.splitter}`),
                        buys_24h: recent.length, sneed_24h: fmtUnits(recent.reduce((acc, b) => acc + BigInt(b.amount), 0n), 8, 4),
                    };
                    if (buys.length === 0) return fail(`No SNEED from the ${PYLONS[IDS.buybackVector]} among the recent transfers of the DAO SNEED splitter(s)`, details);
                    const age = Date.now() - buys[0].at;
                    if (age > c.buybackMaxAgeHours * 3600e3) return warn(`Last buyback ${ago(buys[0].at)}, more than ${c.buybackMaxAgeHours} h ago`, details);
                    return pass(`Last buyback ${fmtUnits(buys[0].amount, 8, 4)} SNEED ${ago(buys[0].at)}; ${recent.length} buys (${details.sneed_24h} SNEED) in 24 h`, details);
                },
            });
            leaves.push(
                {
                    id: 'rev:treasury-icp', name: 'Treasury holds ICP', link: 'https://dashboard.internetcomputer.org/account/580deb37eb3583e5854516481bd52c2618ca73ef6ee1c2df2b556bf85c0ce5a9',
                    run: async (ctx2) => { const l = await actor(ledgerIdl, IDS.icpLedger); const b = await ctx2.call(l.icrc1_balance_of({ owner: Principal.fromText(IDS.governance), subaccount: [] }), 'treasury ICP'); const icp = Number(b) / 1e8; return icp < c.minTreasuryIcp ? warn(`${fmtUnits(b)} ICP`) : pass(`${fmtUnits(b)} ICP`); },
                },
                {
                    id: 'rev:treasury-sneed', name: 'Treasury holds SNEED',
                    run: async (ctx2) => { const l = await actor(ledgerIdl, IDS.ledger); const b = await ctx2.call(l.icrc1_balance_of({ owner: Principal.fromText(IDS.governance), subaccount: [hexToBytes(TREASURY_SNEED_SUB)] }), 'treasury SNEED'); return Number(b) > 0 ? pass(`${fmtUnits(b)} SNEED`) : warn('Treasury SNEED balance is zero'); },
                },
                {
                    id: 'rev:defi', name: 'DeFi canister holds SNEED', link: DASHBOARD(IDS.defi),
                    run: async (ctx2) => { const l = await actor(ledgerIdl, IDS.ledger); const b = await ctx2.call(l.icrc1_balance_of({ owner: Principal.fromText(IDS.defi), subaccount: [] }), 'DeFi SNEED'); return pass(`${fmtUnits(b)} SNEED`); },
                },
                {
                    id: 'rev:lp', name: 'SNEED/ICP liquidity positions held by the DeFi canister', link: `https://app.icpswap.com/liquidity/position?pool=${IDS.sneedIcpPool}`,
                    run: async (ctx2) => {
                        const pool = await actor(poolIdl, IDS.sneedIcpPool);
                        const r = await ctx2.call(pool.getUserPositionsByPrincipal(Principal.fromText(IDS.defi)), 'pool positions');
                        if ('err' in r) return fail(`Pool error: ${JSON.stringify(r.err)}`);
                        const ids = r.ok.map((p) => p.id);
                        const missing = EXPECTED_LP_POSITIONS.filter((e) => !ids.includes(e));
                        const details = { positions: r.ok.map((p) => ({ id: p.id.toString(), liquidity: p.liquidity.toString(), owed0: p.tokensOwed0.toString(), owed1: p.tokensOwed1.toString() })) };
                        if (missing.length) return warn(`Expected position(s) ${missing.join(', ')} not owned by the DeFi canister`, details);
                        return pass(`${ids.length} position(s), including ${EXPECTED_LP_POSITIONS.join(', ')}`, details);
                    },
                },
            );
            return leaves;
        },
    };

    const rllGroup = {
        id: 'rll', name: 'Rewards loop (RLL)',
        children: [
            {
                id: 'rll:running', name: 'Main loop flagged as running', link: '/rll',
                run: async (ctx) => { const s = await ctx.load('rllLoop', loaders.rllLoop); return s.is_running ? pass(`Running, period ${Number(s.frequency_seconds) / 3600} h`) : fail('Main loop is stopped', { last_stopped: opt(s.last_stopped) ? new Date(nsToMs(opt(s.last_stopped))).toISOString() : null }); },
            },
            {
                id: 'rll:scheduled', name: 'Next run scheduled and not overdue',
                run: async (ctx) => {
                    const s = await ctx.load('rllLoop', loaders.rllLoop);
                    const next = opt(s.next_scheduled); const now = nsToMs(s.current_time);
                    if (!next) return fail('No run scheduled');
                    const nextMs = nsToMs(next); const late = now - nextMs;
                    const details = { next_scheduled: new Date(nextMs).toISOString(), canister_time: new Date(now).toISOString() };
                    if (late > c.rllSlackHours * 3600e3) return fail(`Overdue by ${ago(nextMs).replace(' ago', '')}; a timer was probably lost in an upgrade`, details);
                    return pass(`Next run ${ago(nextMs)}`, details);
                },
            },
            {
                id: 'rll:cycle', name: 'Last distribution cycle completed in time',
                run: async (ctx) => {
                    const s = await ctx.load('rllLoop', loaders.rllLoop);
                    const period = Number(s.frequency_seconds) * 1000; const ended = opt(s.last_cycle_ended); const started = opt(s.last_cycle_started);
                    const details = { last_cycle_started: started ? new Date(nsToMs(started)).toISOString() : null, last_cycle_ended: ended ? new Date(nsToMs(ended)).toISOString() : null };
                    if (!ended) return warn('No completed cycle recorded', details);
                    const age = Date.now() - nsToMs(ended);
                    if (age > c.rllFailPeriods * period) return fail(`Last cycle ended ${ago(nsToMs(ended))}`, details);
                    if (age > period + c.rllSlackHours * 3600e3) return warn(`Last cycle ended ${ago(nsToMs(ended))}`, details);
                    return pass(`Last cycle ended ${ago(nsToMs(ended))}`, details);
                },
            },
            {
                id: 'rll:distributed', name: 'Tokens distributed in the last period', link: '/rll',
                run: async (ctx) => {
                    const [s, events] = await Promise.all([ctx.load('rllLoop', loaders.rllLoop), ctx.load('rllEvents', loaders.rllEvents)]);
                    const period = Number(s.frequency_seconds) * 1000;
                    if (events.length === 0) return fail('No distribution has ever been recorded');
                    const last = events.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
                    const at = nsToMs(last.timestamp); const age = Date.now() - at;
                    const recent = events.filter((e) => Date.now() - nsToMs(e.timestamp) <= period + c.rllSlackHours * 3600e3);
                    const details = { last_distribution: new Date(at).toISOString(), last_token: last.token_id.toText(), last_amount: last.amount.toString(), distributions_last_period: recent.length, total_events: events.length };
                    if (age > c.rllFailPeriods * period) return fail(`Last distribution ${ago(at)}`, details);
                    if (age > period + c.rllSlackHours * 3600e3) return warn(`Last distribution ${ago(at)}`, details);
                    return pass(`${recent.length} distribution(s) in the last period, latest ${ago(at)}`, details);
                },
            },
            {
                id: 'rll:stage', name: 'Import pipeline idle or progressing',
                run: async (ctx) => {
                    const rll = await actor(rllIdl, IDS.rll);
                    const [stage, s] = await Promise.all([ctx.call(rll.get_import_stage(), 'RLL stage'), ctx.load('rllLoop', loaders.rllLoop)]);
                    if (/^idle/i.test(stage)) return pass(stage);
                    const started = opt(s.last_cycle_started);
                    if (started && Date.now() - nsToMs(started) > 6 * 3600e3) return fail(`Stuck in "${stage}" since ${ago(nsToMs(started))}`);
                    return warn(`In progress: ${stage}`);
                },
            },
            {
                id: 'rll:claims', name: 'Reward claims succeeding', link: '/rll',
                run: async (ctx) => {
                    const rll = await actor(rllIdl, IDS.rll);
                    const events = await ctx.call(rll.get_claim_events(), 'RLL claim events');
                    const dayAgo = Date.now() - 86400e3;
                    const recent = events.filter((e) => nsToMs(e.timestamp) >= dayAgo);
                    const failed = recent.filter((e) => 'Failed' in e.status);
                    // a claim logs a Pending event first and a Success/Failed event with the same sequence number afterwards
                    const finished = new Set(events.filter((e) => !('Pending' in e.status)).map((e) => e.sequence_number.toString()));
                    const stuck = events.filter((e) => 'Pending' in e.status && !finished.has(e.sequence_number.toString()) && nsToMs(e.timestamp) < Date.now() - 3600e3);
                    const details = { claims_24h: recent.filter((e) => !('Pending' in e.status)).length, failed_24h: failed.length, unmatched_pending_over_1h: stuck.length, last_failures: failed.slice(-5).map((e) => `${e.token_id.toText()} ${e.amount.toString()}: ${opt(e.error_message) || ''}`) };
                    if (stuck.length) return warn(`${stuck.length} claim(s) pending for over an hour`, details);
                    if (failed.length) return warn(`${failed.length} of ${recent.filter((e) => !('Pending' in e.status)).length} claim(s) failed in the last 24 h`, details);
                    return pass(`${recent.filter((e) => !('Pending' in e.status)).length} claim(s) in the last 24 h, none failed`, details);
                },
            },
            {
                id: 'rll:tokens', name: 'Reward tokens configured',
                run: async (ctx) => { const rll = await actor(rllIdl, IDS.rll); const tokens = await ctx.call(rll.get_known_tokens(), 'RLL tokens'); return tokens.length ? pass(`${tokens.length} token(s): ${tokens.map(([, m]) => m.symbol).join(', ')}`) : fail('No reward tokens configured'); },
            },
        ],
    };

    const lockGroup = {
        id: 'lock', name: 'Sneed Lock', dynamic: true,
        children: async (ctx) => {
            const status = await ctx.load('lockStatus', loaders.lockStatus);
            const leaves = [
                {
                    id: 'lock:locks', name: 'Lock state readable', link: '/sneedlock_info',
                    run: async (ctx2) => { const lock = await actor(sneedLockFullIdl, IDS.sneedLock); const [t, p] = await Promise.all([ctx2.call(getActiveTokenLocks(lock), 'token locks'), ctx2.call(getActivePositionLocks(lock), 'position locks')]); return pass(`${t.length} active token lock(s), ${p.length} active position lock(s)`); },
                },
                {
                    id: 'lock:tip', name: 'Activity log tip certified', link: `/tools/icrc3?canister=${IDS.sneedLock}`,
                    run: async (ctx2) => {
                        if (!status) return skip('ICRC-3 log not deployed on this build yet');
                        const tip = await ctx2.call(verifyTip(Principal.fromText(IDS.sneedLock)), 'lock tip');
                        if (!tip) return status.log_length === 0n ? pass('Empty log') : fail('No tip certificate');
                        return tip.lastIndex + 1n === status.log_length ? pass(`Certified tip at block ${tip.lastIndex}, ${status.log_length} blocks`) : warn(`Certified tip ${tip.lastIndex} vs log length ${status.log_length}`);
                    },
                },
                {
                    id: 'lock:spill', name: 'Log spilling to archives on time',
                    run: async () => {
                        if (!status) return skip('ICRC-3 log not deployed on this build yet');
                        const details = { live_blocks: status.live_blocks.toString(), max_live_blocks: status.settings.max_live_blocks.toString(), archives: status.archives.length, spilling: status.spilling, history_imported: status.history_imported };
                        if (!status.history_imported) return warn('History import has not completed', details);
                        if (status.live_blocks > 2n * status.settings.max_live_blocks) return fail(`${status.live_blocks} live blocks, spill is not keeping up`, details);
                        return pass(`${status.live_blocks} live blocks, ${status.archives.length} archive(s)`, details);
                    },
                },
            ];
            if (status) {
                for (const a of status.archives) {
                    const id = a.canister_id.toText();
                    leaves.push({
                        id: `lock:archive:${id}`, name: `Archive ${id} (from block ${a.start})`, link: DASHBOARD(id),
                        run: async (ctx2) => {
                            const [st, reg] = await Promise.all([ctx2.call((await actor(archiveStatusIdl, id)).archive_status(), 'archive status'), ctx2.load('lockRegistration', loaders.lockRegistration)]);
                            const r = reg?.registrations.find((x) => x.canister_id.toText() === id);
                            const details = { cycles: fmtT(st.cycles), blocks: `${st.block_count} / ${st.max_blocks}`, data: fmtBytes(st.data_bytes), stable_memory: fmtBytes(st.stable_memory_bytes), heap: fmtBytes(st.heap_bytes), parent: st.parent.toText(), proposal: r ? (opt(r.proposal_id)?.toString() || `none (${r.attempts} attempt(s)${opt(r.last_error) ? `: ${opt(r.last_error)}` : ''})`) : 'unknown' };
                            const cs = cyclesStatus(st.cycles, c.archiveCyclesOrangeT, c.archiveCyclesRedT);
                            if (cs !== 'pass') return { status: cs, summary: `${fmtT(st.cycles)} cycles`, details };
                            if (st.parent.toText() !== IDS.sneedLock) return fail('Parent is not Sneed Lock', details);
                            if (reg && opt(reg.neuron) && r && !opt(r.proposal_id)) return warn('Not yet registered with the SNS', details);
                            return pass(`${fmtT(st.cycles)}, ${st.block_count} blocks, ${fmtBytes(st.stable_memory_bytes)} stable memory`, details);
                        },
                    });
                }
            }
            return leaves;
        },
    };

    return { id: 'dao', name: 'Sneed DAO', children: [canistersGroup, servicesGroup, snsGroup, revenueGroup, rllGroup, lockGroup] };
}
