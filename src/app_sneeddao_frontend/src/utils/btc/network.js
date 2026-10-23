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
// Mainnet developer mode (below): on staging only, for allowlisted test identities that opt in,
// the network is mainnet (real BTC) so sending can be tested; see btcNativeStatus.
//
// Pure apart from reading process.env, window.location and localStorage; tests pass `e`,
// `hostname`, `principal`, `storage` and `url`.

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

/// Mainnet developer mode (staging only): the identities that may switch native Bitcoin to
/// mainnet (real BTC) to test sending, because testnet4 faucets are unusable. Mr Sneed, the test
/// identity, only. Anyone else on staging stays on testnet4 and never sees the option.
export const MAINNET_DEV_PRINCIPALS = Object.freeze([
    'tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae',
]);
/// This browser's opt-in (localStorage, '1' = on; default off).
export const MAINNET_DEV_KEY = 'sneed_btc_dev_mainnet_v1';
/// The URL parameter (query or hash) for headless test browsers: btcnet=mainnet turns the mode on
/// for this page load (still only for an allowlisted principal), btcnet=testnet forces it off.
export const MAINNET_DEV_PARAM = 'btcnet';

/// Mainnet in developer mode: the mainnet network, marked so every surface shows the red badge.
export const BTC_MAINNET_DEV = Object.freeze({ ...BTC_NETWORKS.mainnet, label: 'Bitcoin mainnet', devMode: true });

export const isMainnetDevPrincipal = (principal) => principal != null && MAINNET_DEV_PRINCIPALS.includes(String(principal));

const defaultStorage = () => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };
const currentUrlParams = () => {
    try { return typeof window !== 'undefined' ? `${window.location.search || ''}&${window.location.hash || ''}` : ''; } catch { return ''; }
};

/// 'mainnet' | 'testnet' | null: the btcnet value in a query/hash string ("?a=1#send&btcnet=mainnet").
export function urlNetParam(text) {
    const m = String(text || '').match(new RegExp(`(?:^|[?#&])${MAINNET_DEV_PARAM}=(mainnet|testnet)(?:$|[&#])`));
    return m ? m[1] : null;
}

/// `href` without a btcnet=… parameter (query or hash; the hash may be "#send&btcnet=mainnet").
export function urlWithoutNetParam(href) {
    try {
        const u = new URL(href);
        u.searchParams.delete(MAINNET_DEV_PARAM);
        const h = u.hash.replace(/^#/, '').split('&').filter((x) => x && !x.startsWith(`${MAINNET_DEV_PARAM}=`)).join('&');
        u.hash = h;
        return u.toString();
    } catch { return href; }
}

/// The browser's opt-in toggle (false when storage is blocked).
export function mainnetDevOptIn(storage = defaultStorage()) {
    try { return storage?.getItem(MAINNET_DEV_KEY) === '1'; } catch { return false; }
}
/// Remember the toggle. The page must reload afterwards: the network is decided once per load.
export function setMainnetDevOptIn(on, storage = defaultStorage()) {
    try { if (on) storage?.setItem(MAINNET_DEV_KEY, '1'); else storage?.removeItem(MAINNET_DEV_KEY); } catch { /* storage blocked: not remembered */ }
}

/// The flag and the network: { enabled, network, config, reason, devAllowed, devMainnet, devSource }.
///   e = { DFX_NETWORK, CANISTER_ID_APP_SNEEDDAO_FRONTEND } (defaults: the build's process.env)
///   hostname (default: window.location.hostname)
///   principal: the signed-in principal (text or Principal); null while logged out (testnet)
///   storage (default: localStorage) holds the opt-in; url (default: location.search + hash)
/// Mainnet developer mode needs ALL of: the base flag on (staging build, not prod id, not prod
/// host), an allowlisted principal, and the opt-in (toggle, or btcnet=mainnet in the URL).
export function btcNativeStatus({ e = null, hostname = null, principal = null, storage, url = null } = {}) {
    const vars = e || {
        // Vite replaces these two literal expressions at build time (vite-plugin-environment);
        // keep them literal, as every other DFX_NETWORK check in the app does
        DFX_NETWORK: process.env.DFX_NETWORK,
        CANISTER_ID_APP_SNEEDDAO_FRONTEND: process.env.CANISTER_ID_APP_SNEEDDAO_FRONTEND,
    };
    const host = hostname == null ? currentHost() : String(hostname).toLowerCase();
    const off = (reason) => ({ enabled: false, network: null, config: null, reason, devAllowed: false, devMainnet: false, devSource: null });
    if (vars.DFX_NETWORK !== 'staging') return off('native Bitcoin is not available on this build yet');
    if (vars.CANISTER_ID_APP_SNEEDDAO_FRONTEND === PROD_FRONTEND_CANISTER) return off('prod frontend build');
    if (isProdHost(host)) return off('prod host');
    const testnet = (devAllowed) => ({ enabled: true, network: 'testnet', config: BTC_NETWORKS.testnet, reason: 'staging: Bitcoin testnet4 preview', devAllowed, devMainnet: false, devSource: null });
    if (!isMainnetDevPrincipal(principal)) return testnet(false);
    const param = urlNetParam(url == null ? currentUrlParams() : url);
    const st = storage === undefined ? defaultStorage() : storage;
    const source = param === 'mainnet' ? 'param' : param === 'testnet' ? null : mainnetDevOptIn(st) ? 'toggle' : null;
    if (!source) return testnet(true);
    return { enabled: true, network: 'mainnet', config: BTC_MAINNET_DEV, reason: 'staging: Bitcoin MAINNET developer mode (real BTC)', devAllowed: true, devMainnet: true, devSource: source };
}

const cached = new Map();
/// The status for this page and `principal` (null while logged out: testnet), computed once per
/// principal per page load, so the network never changes under a running page.
export function btcNative(principal = null) {
    const k = principal == null ? '' : String(principal);
    if (!cached.has(k)) cached.set(k, btcNativeStatus({ principal: principal == null ? null : k }));
    return cached.get(k);
}

/// The flag for this page (independent of who is signed in).
export const btcNativeEnabled = () => btcNative().enabled;
