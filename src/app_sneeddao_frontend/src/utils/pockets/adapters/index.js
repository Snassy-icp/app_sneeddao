// The pocket adapters (spec/programmable_accounts.md §4.2) and the runner that reads them. A
// failing or slow adapter never breaks the wallet: each call has a timeout, and its rows show
// "couldn't read <host>" while the rest loads.
import { walletAdapter } from './wallet.js';
import { sneedLockAdapter } from './sneed_lock.js';
import { sneedexAdapter } from './sneedex.js';
import { icpswapAdapter } from './icpswap.js';
import { sneedMonAdapter } from './sneed_mon.js';
import { sneedNotificationsAdapter } from './sneed_notifications.js';
import { tacoAdapter } from './taco.js';
import { KIND } from '../model.js';

export { walletAdapter, sneedLockAdapter, sneedexAdapter, icpswapAdapter, sneedMonAdapter, sneedNotificationsAdapter, tacoAdapter };

/// Hosted and service adapters, in the order their pockets list.
export const ADAPTERS = [sneedLockAdapter, sneedexAdapter, icpswapAdapter, sneedMonAdapter, sneedNotificationsAdapter, tacoAdapter];

export const DEFAULT_TIMEOUT_MS = 15_000;

const byId = new Map([walletAdapter, ...ADAPTERS].map((a) => [a.id, a]));
export const adapterById = (id) => byId.get(id) || null;
/// The adapter that handles a pocket (wallet pockets: the built-in wallet adapter).
export const adapterFor = (pocket) => (pocket.kind === KIND.wallet ? walletAdapter : adapterById(pocket.adapterId));

/// The adapters this context can use (canister ids known, flags on).
export const enabledAdapters = (ctx, adapters = ADAPTERS) => adapters.filter((a) => (typeof a.enabled === 'function' ? a.enabled(ctx) : true));

/// `promise`, or a rejection after `ms`.
export function withTimeout(promise, ms, label = 'call') {
    let timer;
    const t = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); });
    return Promise.race([Promise.resolve(promise), t]).finally(() => clearTimeout(timer));
}

/// Every adapter's listMyAccounts, in parallel: [{ adapter, items } | { adapter, error }] for mergePockets.
export async function listHosted(ctx, { adapters = enabledAdapters(ctx), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return Promise.all(adapters.map(async (adapter) => {
        try {
            const items = await withTimeout(adapter.listMyAccounts(ctx), timeoutMs, `${adapter.name}`);
            return { adapter, items: items || [] };
        } catch (error) {
            return { adapter, error };
        }
    }));
}

/// The ledgers to read for a pocket: its own list, else the wallet's (`walletLedgers`).
const ledgersToRead = (pocket, walletLedgers) => (pocket.ledgers?.length ? pocket.ledgers : walletLedgers);

/// Balances of every pocket in every ledger it may hold, in parallel:
/// Map<pocketId, Map<ledger, balance | { error }>>. Pockets in error state are skipped.
/// `skip(pocket, ledger)` leaves out reads the caller already has (Main and Sneed Lock from the
/// wallet's token list). Wallet pockets read the ledgers they are known on, else every wallet ledger.
export async function readBalances(ctx, pockets, walletLedgers = [], { timeoutMs = DEFAULT_TIMEOUT_MS, skip = null } = {}) {
    const out = new Map();
    await Promise.all(pockets.map(async (p) => {
        const adapter = adapterFor(p);
        if (!adapter || p.status === 'error' || typeof adapter.balance !== 'function') return;
        const m = new Map();
        out.set(p.id, m);
        const ledgers = ledgersToRead(p, walletLedgers).filter((l) => !skip || !skip(p, l));
        await Promise.all(ledgers.map(async (l) => {
            try { m.set(l, await withTimeout(adapter.balance(ctx, p, l), timeoutMs, `${adapter.name} balance`)); } catch (error) { m.set(l, { error: String(error?.message || error) }); }
        }));
    }));
    return out;
}

/// Plain balances only (errors dropped), for mergePockets / withBalance.
export function okBalances(read) {
    const out = new Map();
    for (const [id, m] of read) {
        const ok = new Map();
        for (const [l, b] of m) if (!b?.error) ok.set(l, b);
        out.set(id, ok);
    }
    return out;
}

/// Move `amount` of `ledger` between two pockets behind one button (§4.3): wallet → wallet is a
/// transfer, wallet → hosted the host's deposit, hosted → wallet its withdraw, hosted → hosted
/// withdraw to Main then deposit (two steps, two fees). Returns the steps to take, in order.
export function movePlan(from, to) {
    if (from.kind === KIND.wallet && to.kind === KIND.wallet) return [{ step: 'send', adapter: walletAdapter }];
    if (from.kind === KIND.wallet) return [{ step: 'deposit', adapter: adapterFor(to) }];
    if (to.kind === KIND.wallet) return [{ step: 'withdraw', adapter: adapterFor(from), viaMain: adapterFor(from)?.withdrawTo === 'main' && to.account?.subaccount != null }];
    return [{ step: 'withdraw', adapter: adapterFor(from) }, { step: 'deposit', adapter: adapterFor(to) }];
}
