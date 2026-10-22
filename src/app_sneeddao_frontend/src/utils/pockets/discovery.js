// Finding the user's wallet pockets (spec/programmable_accounts.md §4.8), per ledger, in order:
//   1. remember first: the registry (§4.7) and its local mirror;
//   2. index: where the ledger has an ICRC index-ng canister, list_subaccounts({ owner = me; start }),
//      paged; found subaccounts with a balance go into the registry in one batched set_pockets;
//   3. ICP: the ICP index works on account identifiers, so no listing: remembered pockets plus a
//      manual "check pocket #N" (and "#1-#20"), cheap icrc1_balance_of queries;
//   4. no index: an opt-in deep scan of the ledger's history (§4.9; waits for utils/ledgerHistory/);
//   5. hosted and service pockets: each adapter's listMyAccounts (adapters/index.js listHosted).
import { canonical, isDefault, numberToSubaccount, toOpt } from './subaccount.js';
import { accountKey, KIND } from './model.js';

const ICP_LEDGER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const text = (p) => (typeof p === 'string' ? p : p.toText());
const big = (v) => { try { return BigInt(v); } catch { return 0n; } };

export const INDEX_PAGE_LIMIT = 50; // pages of list_subaccounts (the index answers up to 1,000 a page)
export const CHECK_RANGE_MAX = 20;

/// The ledger's index canister: ctx.indexFor (SNS data), else ICRC-106 on the ledger; null when none.
/// `probe: false` skips the ICRC-106 call (the wallet's automatic pass reads known indexes only).
export async function findIndex(ctx, ledger, { probe = true } = {}) {
    const l = text(ledger);
    if (l === text(ctx.canisterIds?.icp_ledger || ICP_LEDGER_ID)) return null; // account identifiers only
    if (ctx.indexFor) { const known = await ctx.indexFor(l); if (known) return text(known); }
    if (!probe) return null;
    try {
        const r = await ctx.actor('icrc106', l).icrc106_get_index_principal();
        return 'Ok' in r ? text(r.Ok) : null;
    } catch { return null; }
}

/// Every non-default subaccount of `me` the index knows, paged.
export async function listIndexSubaccounts(ctx, indexId, { maxPages = INDEX_PAGE_LIMIT } = {}) {
    const index = ctx.actor('index', indexId);
    const out = [];
    let start = [];
    for (let page = 0; page < maxPages; page++) {
        const subs = await index.list_subaccounts({ owner: ctx.me, start });
        const fresh = subs.map((s) => (s instanceof Uint8Array ? s : Uint8Array.from(s)));
        for (const s of fresh) if (!isDefault(s)) out.push(canonical(s));
        if (fresh.length === 0) break;
        const last = fresh[fresh.length - 1];
        if (start.length && accountKey({ owner: ctx.me, subaccount: start[0] }) === accountKey({ owner: ctx.me, subaccount: last })) break;
        start = [last];
    }
    // the index pages by "start", which some versions include: dedupe
    const seen = new Set();
    return out.filter((s) => { const k = accountKey({ owner: ctx.me, subaccount: s }); if (seen.has(k)) return false; seen.add(k); return true; });
}

/// Balances of `me` on these subaccounts: [{ subaccount, balance }].
export async function balancesOf(ctx, ledger, subaccounts) {
    const l = ctx.actor('ledger', text(ledger));
    return Promise.all(subaccounts.map(async (s) => ({ subaccount: canonical(s), balance: big(await l.icrc1_balance_of({ owner: ctx.me, subaccount: toOpt(s) })) })));
}

/// "Check pocket #N" (ICP and any ledger): the balances of numbered pockets.
export async function checkNumbers(ctx, ledger, numbers) {
    const subs = numbers.map((n) => numberToSubaccount(n));
    if (subs.some((s) => !s)) throw new Error('A pocket number is a whole number >= 1');
    const r = await balancesOf(ctx, ledger, subs);
    return r.map((x, i) => ({ ...x, number: Number(numbers[i]) }));
}

/// "Check #1-#20": numbered pockets from..to (at most CHECK_RANGE_MAX at once).
export async function checkRange(ctx, ledger, from = 1, to = CHECK_RANGE_MAX) {
    if (to < from || to - from + 1 > CHECK_RANGE_MAX) throw new Error(`Check at most ${CHECK_RANGE_MAX} pockets at once`);
    return checkNumbers(ctx, ledger, Array.from({ length: to - from + 1 }, (_, i) => from + i));
}

/// The deep scan (§4.8 step 4) reads the ledger's whole history through the shared ledger history
/// cache (§4.9, build step g). Until that lands it is not offered.
export const deepScanAvailable = false;
export async function deepScan() {
    throw new Error('The deep scan needs the ledger history cache (utils/ledgerHistory/), which is not built yet');
}

/// Discovery for one ledger: the registry's wallet pockets, then the index (or, for ICP, nothing
/// automatic). Returns { discovered: [{ subaccount, ledger, balance }], via: 'index' | 'none' |
/// 'icp', recorded }. With a registry and `record` (default: on, §4.8 step 2; Q16), found
/// subaccounts with a balance are remembered in one batched update.
export async function discoverLedger(ctx, ledger, { registry = null, record = true, maxPages, probe = true } = {}) {
    const l = text(ledger);
    const remembered = (registry?.entries() || [])
        .filter((e) => e.pocket && !e.pocket.host && text(e.account.owner) === text(ctx.me) && !isDefault(e.account.subaccount))
        .map((e) => canonical(e.account.subaccount));
    let via = 'none';
    let found = [];
    const indexId = await findIndex(ctx, l, { probe });
    if (indexId) {
        found = await listIndexSubaccounts(ctx, indexId, { maxPages });
        via = 'index';
    } else if (l === text(ctx.canisterIds?.icp_ledger || ICP_LEDGER_ID)) {
        via = 'icp';
    }
    const keys = new Set();
    const all = [...remembered, ...found].filter((s) => { const k = accountKey({ owner: ctx.me, subaccount: s }); if (keys.has(k)) return false; keys.add(k); return true; });
    const withBalances = await balancesOf(ctx, l, all);
    const discovered = withBalances.map((x) => ({ ...x, ledger: l }));
    let recorded = [];
    if (registry && record) {
        const rememberedKeys = new Set(remembered.map((s) => accountKey({ owner: ctx.me, subaccount: s })));
        const toRecord = discovered.filter((d) => d.balance > 0n && !rememberedKeys.has(accountKey({ owner: ctx.me, subaccount: d.subaccount })));
        // pockets already remembered gain this ledger in their list (registry.remember merges)
        const gaining = discovered.filter((d) => d.balance > 0n && rememberedKeys.has(accountKey({ owner: ctx.me, subaccount: d.subaccount })));
        const items = [...toRecord, ...gaining].map((d) => ({ account: { owner: ctx.me, subaccount: d.subaccount }, ledgers: [l] }));
        if (items.length) { try { recorded = await registry.remember(items); } catch { /* the wallet works without the registry */ } }
    }
    return { discovered, via, recorded };
}

/// Discovery over several ledgers: the `discovered` list for mergePockets and per-ledger notes.
export async function discoverWallet(ctx, ledgers, opts = {}) {
    const results = await Promise.all(ledgers.map(async (l) => {
        try { return { ledger: text(l), ...(await discoverLedger(ctx, l, opts)) }; } catch (error) { return { ledger: text(l), discovered: [], via: 'error', error: String(error?.message || error) }; }
    }));
    return { discovered: results.flatMap((r) => r.discovered), byLedger: results };
}

/// Wallet pockets of a merged list whose balances were not read for a ledger (for "check" buttons).
export const walletPocketsOf = (pockets) => pockets.filter((p) => p.kind === KIND.wallet);
