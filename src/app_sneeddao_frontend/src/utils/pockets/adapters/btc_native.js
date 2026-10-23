// Native Bitcoin as a pocket (spec/sneed_wallet.md §10, phase A1): the user's own Bitcoin address,
// held by the Chain Fusion Signer's threshold key for their principal. A pocket of kind `chain`:
// no ICRC account (`account: null`), an `address`, and balances keyed by the pseudo-ledger
// `btc:<network>`. A1 is receive-only: caps { receive } and nothing else; sending (A2) and moves to
// ckBTC (A3) come later.
//
// Behind the feature flag (utils/btc/network.js): on staging with Bitcoin testnet4 (mainnet only
// in developer mode, for an allowlisted principal that opted in); on prod off until this browser
// turns on the Bitcoin (beta) switch, then mainnet. Off means no address and no read at all.
// Tests turn it on with ctx.flags.btcNative = { network: 'testnet' | 'mainnet' }.
//
// Reads use the Bitcoin canister's free queries through ctx.actor('bitcoin', id); one read per
// address is shared for 20 s between the pockets model and the Bitcoin row (readNative).
import { btcNative, BTC_NETWORKS } from '../../btc/network.js';
import { btcAddressFor } from '../../btc/address.js';
import { readAddress } from '../../btc/utxos.js';

export const BTC_NATIVE_ID = 'btc_native';

/// This context's network config, or null when the flag is off.
export function btcConfigFor(ctx) {
    const f = ctx?.flags?.btcNative;
    if (f === false) return null;
    if (f && typeof f === 'object') return BTC_NETWORKS[f.network] || null;
    if (f === true) return BTC_NETWORKS.testnet;
    // the network depends on who is signed in (mainnet developer mode, utils/btc/network.js)
    const s = btcNative(ctx?.me ?? null);
    return s.enabled ? s.config : null;
}

const CACHE_MS = 20_000;
const reads = new Map();

/// UTXOs + summary for this user's address (cached for 20 s; `fresh` forces a new read).
export function readNative(ctx, { fresh = false } = {}) {
    const cfg = btcConfigFor(ctx);
    if (!cfg) return Promise.reject(new Error('Native Bitcoin is off'));
    const address = btcAddressFor(ctx.me, cfg.network);
    const key = `${cfg.network}:${address}`;
    const hit = reads.get(key);
    if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
    const promise = readAddress(ctx.actor('bitcoin', cfg.bitcoinCanister), { network: cfg.network, address })
        .then((r) => ({ ...r, address, network: cfg.network, config: cfg, readAt: Date.now() }));
    reads.set(key, { at: Date.now(), promise });
    promise.catch(() => { if (reads.get(key)?.promise === promise) reads.delete(key); });
    return promise;
}

export const btcNativeAdapter = {
    id: BTC_NATIVE_ID,
    name: 'Bitcoin address',
    kind: 'chain',
    receivesDirectly: true,
    caps: { receive: true, send: false, convert: false, deposit: false, withdraw: false, approve: false, readOnly: true },
    enabled: (ctx) => Boolean(btcConfigFor(ctx)),
    async listMyAccounts(ctx) {
        const cfg = btcConfigFor(ctx);
        if (!cfg) return [];
        const address = btcAddressFor(ctx.me, cfg.network);
        return [{
            hostKey: cfg.network,
            account: null,
            label: cfg.testnet ? 'Bitcoin address (testnet4)' : cfg.devMode ? 'Bitcoin address (MAINNET developer mode)' : 'Bitcoin address',
            ledgers: [cfg.pseudoLedger],
            meta: { address, network: cfg.network, testnet: cfg.testnet, devMode: Boolean(cfg.devMode), pseudoLedger: cfg.pseudoLedger },
        }];
    },
    /// { total, available } in sats for the pseudo-ledger; 0 for any other ledger.
    async balance(ctx, pocket, ledger) {
        const cfg = btcConfigFor(ctx);
        if (!cfg || String(ledger) !== cfg.pseudoLedger) return { total: 0n, available: 0n };
        const r = await readNative(ctx);
        const { confirmed, pending } = r.summary;
        return { total: confirmed, available: confirmed, ...(pending > 0n ? { note: `${pending} sats pending` } : {}) };
    },
};

export default btcNativeAdapter;
