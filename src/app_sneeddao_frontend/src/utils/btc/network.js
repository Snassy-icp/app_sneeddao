// Native Bitcoin (spec/sneed_wallet.md): which Bitcoin network this build uses, and the feature
// flag that keeps the native-BTC UI, every native-BTC canister call and every address derivation
// off where they must not happen.
//
// Staging (unchanged): ON with Bitcoin testnet (testnet4, worthless coins; staging-no-real-money)
// when three independent checks all pass:
//   1. the build was made for staging (process.env.DFX_NETWORK === 'staging', baked in by Vite);
//   2. the build's own frontend canister id is not the prod frontend's;
//   3. at run time, the page is not served from a prod host (app.sneeddao.com or the prod
//      frontend canister's URLs), so a staging bundle copied to prod still stays off.
// Mainnet developer mode (below): on staging only, for allowlisted test identities that opt in,
// the network is mainnet (real BTC) so sending can be tested; see btcNativeStatus.
//
// Prod (Bitcoin beta, decided 2026-10-23): a prod build (DFX_NETWORK === 'ic' AND the prod
// frontend id) offers an explicit "Bitcoin (beta)" switch, default OFF, remembered per browser
// (localStorage BETA_KEY). Off: enabled = false, so nothing derives an address or calls the
// Bitcoin canister or the signer; the UI shows only the explanation and the switch. On: Bitcoin
// MAINNET with the normal UI (BTC_MAINNET_BETA: a small "Beta" badge, no developer banners).
// Prod is never testnet and never developer mode.
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

/// The ck pair each Bitcoin network moves to and from (spec/sneed_wallet.md §6, phase A3). Checked
/// anonymously on 2026-10-23: the ckTESTBTC minter ml52i (dashboard: network testnet = testnet4,
/// ledger mc6ru, 4 confirmations, check fee 100, min deposit 300, min retrieve 5,000 sats) has the
/// same candid as the ckBTC minter mqygn for every method Sneed Wallet calls.
export const CK_PAIRS = Object.freeze({
    mainnet: Object.freeze({ symbol: 'ckBTC', ledger: 'mxzaz-hqaaa-aaaar-qaada-cai', minter: 'mqygn-kiaaa-aaaar-qaadq-cai' }),
    testnet: Object.freeze({ symbol: 'ckTESTBTC', ledger: 'mc6ru-gyaaa-aaaar-qaaaq-cai', minter: 'ml52i-qqaaa-aaaar-qaaba-cai' }),
});

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
        ck: CK_PAIRS.mainnet,
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
        ck: CK_PAIRS.testnet,
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

/// Prod Bitcoin beta: mainnet with the normal UI, marked so surfaces show the small "Beta" badge.
export const BTC_MAINNET_BETA = Object.freeze({ ...BTC_NETWORKS.mainnet, beta: true });
/// This browser's Bitcoin (beta) switch on prod (localStorage, '1' = on; default off).
export const BETA_KEY = 'sneed_btc_beta_v1';

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

/// The Bitcoin (beta) switch of this browser (false when storage is blocked).
export function betaOptIn(storage = defaultStorage()) {
    try { return storage?.getItem(BETA_KEY) === '1'; } catch { return false; }
}
/// Remember the switch. The page must reload afterwards: the network is decided once per load.
export function setBetaOptIn(on, storage = defaultStorage()) {
    try { if (on) storage?.setItem(BETA_KEY, '1'); else storage?.removeItem(BETA_KEY); } catch { /* storage blocked: not remembered */ }
}

/// True for the prod build: DFX_NETWORK 'ic' and the prod frontend's own canister id.
export const isProdBuild = (vars) => vars?.DFX_NETWORK === 'ic' && vars?.CANISTER_ID_APP_SNEEDDAO_FRONTEND === PROD_FRONTEND_CANISTER;

/// The flag and the network: { enabled, network, config, reason, devAllowed, devMainnet, devSource,
/// betaAvailable, betaOn }. betaAvailable: this is the prod build, which offers the Bitcoin (beta)
/// switch; betaOn: this browser turned it on (then enabled, mainnet, BTC_MAINNET_BETA).
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
    const off = (reason, betaAvailable = false) => ({ enabled: false, network: null, config: null, reason, devAllowed: false, devMainnet: false, devSource: null, betaAvailable, betaOn: false });
    const st = storage === undefined ? defaultStorage() : storage;
    if (isProdBuild(vars)) {
        // prod: only the browser's own switch; principal, developer toggle and URL play no part
        if (!betaOptIn(st)) return off('Bitcoin (beta) is off in this browser', true);
        return { enabled: true, network: 'mainnet', config: BTC_MAINNET_BETA, reason: 'Bitcoin (beta), mainnet', devAllowed: false, devMainnet: false, devSource: null, betaAvailable: true, betaOn: true };
    }
    if (vars.DFX_NETWORK !== 'staging') return off('native Bitcoin is not available on this build yet');
    if (vars.CANISTER_ID_APP_SNEEDDAO_FRONTEND === PROD_FRONTEND_CANISTER) return off('prod frontend build');
    if (isProdHost(host)) return off('prod host');
    const testnet = (devAllowed) => ({ enabled: true, network: 'testnet', config: BTC_NETWORKS.testnet, reason: 'staging: Bitcoin testnet4 preview', devAllowed, devMainnet: false, devSource: null, betaAvailable: false, betaOn: false });
    if (!isMainnetDevPrincipal(principal)) return testnet(false);
    const param = urlNetParam(url == null ? currentUrlParams() : url);
    const source = param === 'mainnet' ? 'param' : param === 'testnet' ? null : mainnetDevOptIn(st) ? 'toggle' : null;
    if (!source) return testnet(true);
    return { enabled: true, network: 'mainnet', config: BTC_MAINNET_DEV, reason: 'staging: Bitcoin MAINNET developer mode (real BTC)', devAllowed: true, devMainnet: true, devSource: source, betaAvailable: false, betaOn: false };
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
/// The Bitcoin row or its beta switch appears on this page: the flag is on, or this is the prod
/// build that offers the Bitcoin (beta) switch.
export const btcNativeShown = () => { const s = btcNative(); return s.enabled || s.betaAvailable; };

/// What a surface may do with `status` (one rule for the Bitcoin card, the pockets adapter and
/// btc.html):
///   cfg     the network config, or null: nothing native-BTC happens without it
///   active  derive the address, read the Bitcoin canister, create signer actors: needs cfg AND a
///           signed-in principal
///   offer   show the Bitcoin (beta) explanation and switch instead (prod, switch off)
///   betaSwitch  the switch exists on this build (prod), to turn it on or off
///   intro   show the first-time beta explanation (prod, switch on)
export function btcSurface(status, signedIn = false) {
    const cfg = status?.enabled ? status.config : null;
    return {
        cfg,
        active: Boolean(cfg && signedIn),
        offer: Boolean(status?.betaAvailable && !status.betaOn),
        betaSwitch: Boolean(status?.betaAvailable),
        intro: Boolean(cfg?.beta),
    };
}

/// Native ↔ ck moves (phase A3) for `status`: the network's ck pair, or null. Null whenever the
/// Bitcoin surface is off (prod with the beta switch off, other builds), so no move button, minter
/// or ledger call exists there.
export const ckMoveFor = (status) => (status?.enabled && status.config?.ck ? status.config.ck : null);
/// The "Move to my Bitcoin address" button belongs on the row of the ck token `ledger` only when
/// that ledger is this network's pair (on staging testnet4 the pair is ckTESTBTC, not the ckBTC
/// card's token, so the ckBTC row gets no button there).
export const ckRowMoveShown = (status, ledger) => { const ck = ckMoveFor(status); return Boolean(ck && String(ledger) === ck.ledger); };
/// The btc.html address for a tab (send, move, move-tobtc, credit, activity), keeping the headless
/// developer-mode parameter when this page load was switched to mainnet by it.
export const btcPageHref = (status, tab) => (status?.devSource === 'param' ? `/btc.html?btcnet=mainnet#${tab}` : `/btc.html#${tab}`);

/// The first-time beta explanation was dismissed in this browser.
export const BETA_INTRO_KEY = 'sneed_btc_beta_intro_seen_v1';
export function betaIntroSeen(storage = defaultStorage()) {
    try { return storage?.getItem(BETA_INTRO_KEY) === '1'; } catch { return false; }
}
export function setBetaIntroSeen(storage = defaultStorage()) {
    try { storage?.setItem(BETA_INTRO_KEY, '1'); } catch { /* storage blocked: shown again next time */ }
}

/// Turn the Bitcoin (beta) switch on or off in this browser and reload (the network and the
/// pockets adapters are decided once per page load).
export function flipBeta(on, storage = defaultStorage()) {
    setBetaOptIn(on, storage);
    try { window.location.reload(); } catch { /* not in a browser */ }
}
