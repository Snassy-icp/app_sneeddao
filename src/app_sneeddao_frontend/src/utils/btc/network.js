// Native Bitcoin (spec/sneed_wallet.md, phase A1): which Bitcoin network this build uses, and the
// feature flag that keeps the whole native-BTC UI off where it must not appear yet.
//
// Sending (A2) is not built. A user who receives BTC at their Sneed Wallet address could not move
// it, so the native-BTC UI is OFF on prod and ON only on staging, where it uses Bitcoin testnet
// (testnet4, worthless coins; staging-no-real-money). Three independent checks, all must pass:
//   1. the build was made for staging (process.env.DFX_NETWORK === 'staging', baked in by Vite);
//   2. the build's own frontend canister id is not the prod frontend's;
//   3. at run time, the page is not served from a prod host (app.sneeddao.com or the prod
//      frontend canister's URLs), so a staging bundle copied to prod still stays off.
// When A2 ships, prod gets its own switch here (mainnet), still default off until launch (A4).
//
// Pure apart from reading process.env and window.location; tests pass `env` / `hostname`.

export const PROD_FRONTEND_CANISTER = 'pxtkg-giaaa-aaaal-ajjzq-cai';
export const PROD_HOSTS = Object.freeze([
    'app.sneeddao.com',
    'www.app.sneeddao.com',
    `${PROD_FRONTEND_CANISTER}.icp0.io`,
    `${PROD_FRONTEND_CANISTER}.ic0.app`,
    `${PROD_FRONTEND_CANISTER}.raw.icp0.io`,
    `${PROD_FRONTEND_CANISTER}.raw.ic0.app`,
]);

/// The Chain Fusion Signer (NNS-governed) that holds every Sneed Wallet BTC key.
export const SIGNER_CANISTER = 'grghe-syaaa-aaaar-qabyq-cai';

/// Per network: the IC Bitcoin canister, the signer's network variant, the pseudo-ledger key the
/// pockets model uses for native balances, the explorer, and how the UI names it.
export const BTC_NETWORKS = Object.freeze({
    mainnet: Object.freeze({
        network: 'mainnet',
        bitcoinCanister: 'ghsi2-tqaaa-aaaan-aaaca-cai',
        pseudoLedger: 'btc:mainnet',
        hrp: 'bc',
        explorer: 'https://mempool.space',
        symbol: 'BTC',
        label: 'Bitcoin',
        testnet: false,
    }),
    // The IC's Bitcoin testnet canister follows testnet4 (its candid: "testnet; // Bitcoin
    // testnet4"; get_config on g4xu7 reports network = testnet, height ~157k in Oct 2026). The
    // signer's `testnet` uses the same threshold key (key_1) and only changes the address prefix.
    testnet: Object.freeze({
        network: 'testnet',
        bitcoinCanister: 'g4xu7-jiaaa-aaaan-aaaaq-cai',
        pseudoLedger: 'btc:testnet',
        hrp: 'tb',
        explorer: 'https://mempool.space/testnet4',
        symbol: 'tBTC',
        label: 'Bitcoin testnet4',
        testnet: true,
    }),
});

const currentHost = () => { try { return typeof window !== 'undefined' ? String(window.location.hostname || '').toLowerCase() : ''; } catch { return ''; } };

/// True when `hostname` is one the prod frontend is served from.
export const isProdHost = (hostname) => PROD_HOSTS.includes(String(hostname || '').toLowerCase());

/// The flag and the network: { enabled, network, config, reason }.
///   e = { DFX_NETWORK, CANISTER_ID_APP_SNEEDDAO_FRONTEND } (defaults: the build's process.env)
///   hostname (default: window.location.hostname)
export function btcNativeStatus({ e = null, hostname = null } = {}) {
    const vars = e || {
        // Vite replaces these two literal expressions at build time (vite-plugin-environment);
        // keep them literal, as every other DFX_NETWORK check in the app does
        DFX_NETWORK: process.env.DFX_NETWORK,
        CANISTER_ID_APP_SNEEDDAO_FRONTEND: process.env.CANISTER_ID_APP_SNEEDDAO_FRONTEND,
    };
    const host = hostname == null ? currentHost() : String(hostname).toLowerCase();
    const off = (reason) => ({ enabled: false, network: null, config: null, reason });
    if (vars.DFX_NETWORK !== 'staging') return off('native Bitcoin is not available on this build yet');
    if (vars.CANISTER_ID_APP_SNEEDDAO_FRONTEND === PROD_FRONTEND_CANISTER) return off('prod frontend build');
    if (isProdHost(host)) return off('prod host');
    return { enabled: true, network: 'testnet', config: BTC_NETWORKS.testnet, reason: 'staging: Bitcoin testnet4 preview' };
}

let cached = null;
/// The status for this page (computed once).
export function btcNative() {
    if (!cached) cached = btcNativeStatus();
    return cached;
}

/// The flag for this page.
export const btcNativeEnabled = () => btcNative().enabled;
