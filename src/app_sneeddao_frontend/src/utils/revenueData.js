// What the DAO earns, for /revenue, /rll_info and /rll_ledger, all through the shared cache in
// revenueStore.js so a page shows at once what another page already loaded.
//
// Two sources: each product's own counters (its canister's lifetime totals of what it charged),
// and the loop's books (utils/rllLedger.js: what reached the ICP splitter and moved on, read from
// the ledger indexes). Product fees are mostly paid straight into the splitter's deposit account
// by the user, so the ledger cannot tell products apart: the counters do that, the books confirm
// the sum.
import { createActor as createSneedappActor, canisterId as sneedappId } from 'declarations/sneedapp';
import { createActor as createLockActor, canisterId as lockId } from 'declarations/sneed_lock';
import { createActor as createSneedexActor, canisterId as sneedexId } from 'declarations/sneedex';
import { createActor as createBackendActor, canisterId as backendId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createSneedPremiumActor } from './SneedPremiumUtils';
import { get_token_conversion_rate } from './TokenUtils';
import { load, peek, hasValue, useResource } from './revenueStore';
import { SECTIONS, PERIODS, DEFAULT_PERIOD, ICP_LEDGER, SNEED_LEDGER, loadSectionLines, fetchNeuron, fetchSplits } from './rllLedger';

export { DEFAULT_PERIOD, PERIODS };

const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';
const anon = { agentOptions: { host } };

// ---- tokens ----
const KNOWN = { [ICP_LEDGER]: { symbol: 'ICP', decimals: 8 }, [SNEED_LEDGER]: { symbol: 'SNEED', decimals: 8 } };

/// { symbol, decimals } of a ledger, from its metadata (cached).
export function loadTokenMeta(ledger) {
    if (KNOWN[ledger]) return Promise.resolve(KNOWN[ledger]);
    return load(`token:${ledger}`, async () => {
        const md = await createLedgerActor(ledger, anon).icrc1_metadata();
        const get = (k) => md.find(([key]) => key === k)?.[1];
        return { symbol: get('icrc1:symbol')?.Text || ledger.slice(0, 5), decimals: Number(get('icrc1:decimals')?.Nat ?? 8) };
    }, { ttl: Infinity });
}
export const tokenMeta = (ledger) => KNOWN[ledger] || peek(`token:${ledger}`).value || null;

/// Today's price of a token in USD, or null (cached).
export function loadPrice(ledger) {
    return load(`price:${ledger}`, async () => {
        const meta = await loadTokenMeta(ledger);
        const p = await get_token_conversion_rate(ledger, meta.decimals);
        return p ? Number(p) : null;
    });
}
export const priceOf = (ledger) => peek(`price:${ledger}`).value ?? null;

/// The USD value of [{ ledger, amount }], counting only tokens whose price and decimals are known;
/// `complete` says whether every token was counted.
export function usdOf(amounts) {
    let usd = 0; let complete = true;
    for (const { ledger, amount } of amounts) {
        if (!amount) continue;
        const meta = tokenMeta(ledger); const p = priceOf(ledger);
        if (!meta || p == null) { complete = false; continue; }
        usd += (Number(amount) / 10 ** meta.decimals) * p;
    }
    return { usd, complete };
}

/// Amounts in a token, as text: "12.5 ICP".
export function fmtAmount(amount, ledger, max = 2) {
    const meta = tokenMeta(ledger);
    if (!meta) return '…';
    return `${(Number(amount) / 10 ** meta.decimals).toLocaleString('en-US', { maximumFractionDigits: max })} ${meta.symbol}`;
}

// ---- products ----
// A summary is { amounts: [{ ledger, amount }] (what the DAO received, by token), parts: [{ label,
// amounts, note? }], stats: [{ label, value }], hidden?: true (the canister keeps its totals to its
// admins), note? }.
const notPublic = (e) => /assert|unauthori[sz]ed|not authori[sz]ed|admin/i.test(e?.message || String(e));
const add = (list, ledger, amount) => {
    if (!amount) return;
    const e = list.find((x) => x.ledger === ledger);
    if (e) e.amount += BigInt(amount); else list.push({ ledger, amount: BigInt(amount) });
};

async function loadApps() {
    const a = createSneedappActor(sneedappId, anon);
    const [apps, stats, dao] = await Promise.all([a.getApps(), a.getAllAppRevenueStats(), a.getDaoRevenueStats()]);
    const parts = stats
        .filter((s) => s.totalDaoCutE8s > 0n || s.mintCount > 0n)
        .sort((x, y) => Number(y.totalDaoCutE8s - x.totalDaoCutE8s))
        .map((s) => {
            const app = apps.find((x) => x.numericAppId === s.numericAppId);
            return { label: app?.name || `App ${s.numericAppId}`, amounts: [{ ledger: ICP_LEDGER, amount: s.totalDaoCutE8s }], note: `${Number(s.mintCount).toLocaleString()} minted`, link: app ? `/sneedapp/app/${encodeURIComponent(app.appId)}` : null };
        });
    const minted = stats.reduce((n, s) => n + Number(s.mintCount), 0);
    return { amounts: [{ ledger: ICP_LEDGER, amount: dao.totalRevenueE8s }], parts, stats: [{ label: 'Bots minted', value: minted.toLocaleString() }] };
}

async function loadLock() {
    const s = await createLockActor(lockId, anon).get_lock_fee_stats();
    return {
        amounts: [{ ledger: ICP_LEDGER, amount: s.total_fees_collected_e8s }],
        parts: [
            { label: 'Token locks', amounts: [{ ledger: ICP_LEDGER, amount: s.total_token_lock_fees_collected_e8s }] },
            { label: 'LP position locks', amounts: [{ ledger: ICP_LEDGER, amount: s.total_position_lock_fees_collected_e8s }] },
        ],
        stats: [],
    };
}

async function loadSneedex() {
    const a = createSneedexActor(sneedexId, anon);
    const market = await a.getMarketStats().catch(() => null);
    const stats = market ? [{ label: 'Offers', value: Number(market.total_offers).toLocaleString() }, { label: 'Completed', value: Number(market.completed_offers).toLocaleString() }, { label: 'Bids', value: Number(market.total_bids).toLocaleString() }] : [];
    let s;
    try { s = await a.getPaymentStats(); } catch (e) { if (notPublic(e)) return { amounts: [], parts: [], stats, hidden: true }; throw e; }
    const amounts = [];
    add(amounts, ICP_LEDGER, s.total_creation_fees_collected_e8s);
    for (const [ledger, amount] of s.cuts_by_ledger) add(amounts, ledger.toText(), amount);
    await Promise.all(amounts.map((x) => loadTokenMeta(x.ledger).catch(() => null)));
    return {
        amounts,
        parts: [
            { label: 'Offer creation fees', amounts: [{ ledger: ICP_LEDGER, amount: s.total_creation_fees_collected_e8s }], note: `${Number(s.total_creation_fee_payments).toLocaleString()} paid` },
            { label: 'Cut of completed sales', amounts: s.cuts_by_ledger.map(([l, amount]) => ({ ledger: l.toText(), amount })), note: `${Number(s.total_cut_payments).toLocaleString()} sales` },
        ],
        stats,
    };
}

async function loadPremium() {
    let s;
    try { s = await (await createSneedPremiumActor()).getPaymentStats(); } catch (e) { if (notPublic(e)) return { amounts: [], parts: [], stats: [], hidden: true }; throw e; }
    return {
        amounts: [{ ledger: ICP_LEDGER, amount: s.total_icp_collected_e8s }],
        parts: [{ label: 'Memberships paid in ICP', amounts: [{ ledger: ICP_LEDGER, amount: s.total_icp_collected_e8s }], note: `${Number(s.total_icp_payments).toLocaleString()} payments` }],
        stats: [{ label: 'Claimed with voting power', value: Number(s.total_vp_claims).toLocaleString() }, { label: 'Promo codes', value: Number(s.total_promo_claims).toLocaleString() }],
    };
}

async function loadJailbreak() {
    const r = await createBackendActor(backendId, anon).get_jailbreak_payment_stats();
    if ('err' in r) { if (notPublic(r.err)) return { amounts: [], parts: [], stats: [], hidden: true }; throw new Error(r.err); }
    const s = r.ok;
    return {
        amounts: [{ ledger: ICP_LEDGER, amount: s.total_revenue_e8s }],
        parts: [
            { label: 'Regular fee', amounts: [{ ledger: ICP_LEDGER, amount: s.regular_revenue_e8s }], note: `${Number(s.total_regular_payments).toLocaleString()} payments` },
            { label: 'Premium fee', amounts: [{ ledger: ICP_LEDGER, amount: s.premium_revenue_e8s }], note: `${Number(s.total_premium_payments).toLocaleString()} payments` },
        ],
        stats: [{ label: 'Scripts made', value: Number(s.total_scripts_created).toLocaleString() }, { label: 'Users', value: Number(s.unique_users).toLocaleString() }],
    };
}

/// The products that earn the DAO money. `node` is the product's node in the /rll_info diagram,
/// `token` what its fees are paid in (Various: the token of the sale).
export const PRODUCTS = [
    { id: 'apps', token: 'ICP', node: '15', name: 'Sneedapp', link: '/sneedapp', color: '#8b5cf6', load: loadApps,
        description: 'Staking and trading bots minted from the Sneedapp factory: the DAO earns the mint fee of every bot.' },
    { id: 'lock', token: 'ICP', node: '13', name: 'Sneed Lock', link: '/sneedlock', color: '#10b981', load: loadLock,
        description: 'Token and LP position locking: a fee in ICP for each new lock.' },
    { id: 'sneedex', token: 'Various', node: '16', name: 'Sneedex', link: '/sneedex', color: '#3b82f6', load: loadSneedex,
        description: 'The marketplace for neurons, canisters and tokens: an offer creation fee and a cut of each completed sale.' },
    { id: 'premium', token: 'ICP', node: '17', name: 'Sneed Premium', link: '/premium', color: '#f59e0b', load: loadPremium,
        description: 'Membership paid in ICP (or claimed with SNEED voting power) for lower fees across the products.' },
    { id: 'jailbreak', token: 'ICP', node: '18', name: 'SNS Jailbreak', link: '/tools/sns_jailbreak', color: '#ef4444', load: loadJailbreak,
        description: 'Scripts that let an SNS neuron be managed from a wallet: a fee in ICP for each script.' },
];
export const productKey = (id) => `revenue:product:${id}`;
export const loadProduct = (p, opts) => load(productKey(p.id), p.load, opts);
export const productEntry = (id) => peek(productKey(id));
export const useProduct = (p, opts) => useResource(productKey(p.id), p.load, opts);

/// Starts every product's load (and the prices its tokens need); cheap: a few queries each.
export function loadAllProducts(opts) {
    loadPrice(ICP_LEDGER).catch(() => {});
    loadPrice(SNEED_LEDGER).catch(() => {});
    return Promise.all(PRODUCTS.map((p) => loadProduct(p, opts).then((s) => { for (const a of s.amounts) loadPrice(a.ledger).catch(() => {}); }).catch(() => {})));
}

/// Sum over the products that have loaded: { amounts, loaded, hidden, total }.
export function productTotals() {
    const amounts = []; let loaded = 0; const hidden = [];
    for (const p of PRODUCTS) {
        const e = productEntry(p.id);
        if (!hasValue(e)) continue;
        loaded++;
        if (e.value.hidden) hidden.push(p);
        for (const a of e.value.amounts) add(amounts, a.ledger, a.amount);
    }
    return { amounts, loaded, hidden, total: PRODUCTS.length };
}

// ---- the loop's books ----
const periodOf = (key) => PERIODS.find((p) => p.key === key) || PERIODS.find((p) => p.key === DEFAULT_PERIOD);
export const sectionKey = (key, period) => `rll:section:${key}:${period}`;
const sectionFetcher = (key, period) => (progress) => loadSectionLines(SECTIONS.find((s) => s.key === key), periodOf(period).ms ? Date.now() - periodOf(period).ms : 0, progress);
export const loadSection = (key, period = DEFAULT_PERIOD, opts) => load(sectionKey(key, period), sectionFetcher(key, period), opts);
export const useSection = (key, period = DEFAULT_PERIOD, opts) => useResource(sectionKey(key, period), sectionFetcher(key, period), opts);
export const sectionEntry = (key, period = DEFAULT_PERIOD) => peek(sectionKey(key, period));
/// One line of a loaded section: { total, n, cutAt, token } or null while it loads.
export function lineOf(sectionKeyName, lineKey, period = DEFAULT_PERIOD) {
    const e = sectionEntry(sectionKeyName, period);
    const l = e.value?.find((x) => x.key === lineKey);
    if (!l) return null;
    const section = SECTIONS.find((s) => s.key === sectionKeyName);
    return { total: l.sum.total, n: l.sum.n, cutAt: l.cutAt, token: l.token || section.token, byDay: l.sum.byDay };
}

// ---- Revenue's three sources ----
// Revenue comes from the 2-year neuron's maturity, the ICPSwap LP's fees and the products. The
// first two are read from the loop ledger over all time and summarised like a product
// ({ amounts, parts, stats }), so the revenue page shows all three alike.
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const firstDay = (...lines) => lines.flatMap((l) => [...l.byDay.keys()]).sort()[0];
const lastDay = (...lines) => lines.flatMap((l) => [...l.byDay.keys()]).sort().pop();
export const SOURCES = [
    { id: 'neuron', section: 'neuron', name: '2-year ICP neuron', link: '/rll_ledger?period=all#neuron', color: '#2ecc71',
        description: 'The DAO\'s NNS neuron, locked for 2 years: the NNS pays it maturity for voting, about once a day. A quarter is staked back into the neuron, the rest goes on into the loop.',
        summary: () => {
            const m = lineOf('neuron', 'maturity', 'all');
            if (!m) return null;
            // the first payout the ledger shows (the vector's maturity account), or where a capped read stopped
            const since = m.n ? (m.cutAt ? dayOf(m.cutAt) : firstDay(m)) : null;
            return { amounts: [{ ledger: ICP_LEDGER, amount: m.total }], parts: [], stats: [{ label: 'Maturity payouts', value: m.n.toLocaleString() }, ...(since ? [{ label: m.cutAt ? 'Counted since' : 'Since', value: since }] : [])] };
        } },
    { id: 'lp', section: 'lpFees', name: 'ICPSwap LP', link: '/rll_ledger?period=all#lpFees', color: '#06b6d4',
        description: 'The DAO\'s liquidity on ICPSwap, held by the Sneed DeFi canister: the trading fees it earns are claimed about once a week and sent into the loop.',
        summary: () => {
            const [icp, clown, sneed] = ['icpSneedPool', 'icpClownPool', 'sneedSneedPool'].map((k) => lineOf('lpFees', k, 'all'));
            if (!icp || !clown || !sneed) return null;
            const any = [icp, clown, sneed].filter((l) => l.n);
            return {
                amounts: [{ ledger: ICP_LEDGER, amount: icp.total + clown.total }, { ledger: SNEED_LEDGER, amount: sneed.total }],
                parts: [
                    { label: 'SNEED/ICP pool', amounts: [{ ledger: ICP_LEDGER, amount: icp.total }, { ledger: SNEED_LEDGER, amount: sneed.total }] },
                    { label: 'ICP/CLOWN pool', amounts: [{ ledger: ICP_LEDGER, amount: clown.total }], note: 'its CLOWN not counted' },
                ],
                stats: any.length ? [{ label: 'First claim', value: firstDay(...any) }, { label: 'Last claim', value: lastDay(...any) }] : [],
            };
        } },
];
export const loadSource = (src, opts) => loadSection(src.section, 'all', opts);
export const sourceEntry = (src) => sectionEntry(src.section, 'all');
export function loadAllSources(opts) {
    loadPrice(ICP_LEDGER).catch(() => {});
    loadPrice(SNEED_LEDGER).catch(() => {});
    return Promise.all(SOURCES.map((src) => loadSource(src, opts).catch(() => {})));
}

/// Revenue over all time: the two ledger sources and the products, { amounts, sources, products }
/// (sources: [{ src, summary }], summary null while loading).
export function revenueTotals() {
    const products = productTotals();
    const sources = SOURCES.map((src) => ({ src, summary: src.summary() }));
    const amounts = [];
    for (const a of products.amounts) add(amounts, a.ledger, a.amount);
    for (const { summary } of sources) if (summary) for (const a of summary.amounts) add(amounts, a.ledger, a.amount);
    return { amounts, sources, products };
}

export const loadNeuron = (opts) => load('rll:neuron', () => fetchNeuron(), opts);
export const peekNeuron = () => peek('rll:neuron');
export const loadSplits = (node, opts) => load(`rll:splits:${node}`, () => fetchSplits(node), opts);
export const splitsEntry = (node) => peek(`rll:splits:${node}`);
