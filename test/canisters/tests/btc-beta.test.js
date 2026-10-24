// Native Bitcoin on prod as a BETA (utils/btc/network.js; spec/sneed_wallet.md §12, decided
// 2026-10-23): a prod build offers an explicit "Bitcoin (beta)" switch, default off, remembered
// per browser in localStorage. Off: no network, so no address derivation and no native-BTC call
// anywhere (Bitcoin card, pockets adapter, btc.html). On: Bitcoin mainnet with the normal UI.
// Prod is never testnet and never developer mode; staging is unchanged. Pure frontend logic.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Principal } from '@dfinity/principal';
import {
    btcNativeStatus, btcSurface, isProdBuild, BTC_NETWORKS, BTC_MAINNET_BETA, BTC_MAINNET_DEV, PROD_FRONTEND_CANISTER, PROD_HOSTS,
    MAINNET_DEV_KEY, BETA_KEY, BETA_INTRO_KEY, betaOptIn, setBetaOptIn, betaIntroSeen, setBetaIntroSeen,
} from '../../../src/app_sneeddao_frontend/src/utils/btc/network.js';

const SRC = '../../../src/app_sneeddao_frontend/src/';
const DEV = 'tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae';
const OTHER = 'nggqm-p5ozz-i5hfv-bejmq-2gtow-4dtqw-vjatn-4b4yw-s5mzs-i46su-6ae';
const PROD = { DFX_NETWORK: 'ic', CANISTER_ID_APP_SNEEDDAO_FRONTEND: PROD_FRONTEND_CANISTER };
const STAGING = { DFX_NETWORK: 'staging', CANISTER_ID_APP_SNEEDDAO_FRONTEND: '2icdp-6qaaa-aaaal-qjt6a-cai' };
const STAGING_HOST = '2icdp-6qaaa-aaaal-qjt6a-cai.icp0.io';

const mem = (init = {}) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
const BETA_ON = () => mem({ [BETA_KEY]: '1' });
const ALL_ON = () => mem({ [BETA_KEY]: '1', [MAINNET_DEV_KEY]: '1' });
const PROD_HOSTNAMES = [...PROD_HOSTS, 'localhost', ''];
const PRINCIPALS = [DEV, Principal.fromText(DEV), OTHER, null];
const URLS = ['', '?btcnet=mainnet', '#send&btcnet=mainnet', '?btcnet=testnet', '#send&btcnet=testnet'];

describe('Bitcoin beta on prod: the flag matrix', () => {
    it('recognises exactly the prod build', () => {
        expect(isProdBuild(PROD)).toBe(true);
        expect(isProdBuild({ DFX_NETWORK: 'ic', CANISTER_ID_APP_SNEEDDAO_FRONTEND: '2icdp-6qaaa-aaaal-qjt6a-cai' })).toBe(false);
        expect(isProdBuild({ ...STAGING, CANISTER_ID_APP_SNEEDDAO_FRONTEND: PROD_FRONTEND_CANISTER })).toBe(false);
        expect(isProdBuild({ DFX_NETWORK: 'local' })).toBe(false);
        expect(isProdBuild({})).toBe(false);
        expect(isProdBuild(null)).toBe(false);
    });

    it('off by default: no network, no config, only the switch is offered (any host, principal, URL, developer toggle)', () => {
        for (const storage of [mem(), mem({ [BETA_KEY]: '0' }), mem({ [MAINNET_DEV_KEY]: '1' }), null, blocked]) {
            for (const hostname of PROD_HOSTNAMES) {
                for (const principal of PRINCIPALS) {
                    for (const url of URLS) {
                        const s = btcNativeStatus({ e: PROD, hostname, principal, storage, url });
                        expect(s, JSON.stringify({ hostname, url })).toMatchObject({ enabled: false, network: null, config: null, devAllowed: false, devMainnet: false, betaAvailable: true, betaOn: false });
                        expect(btcSurface(s, true)).toEqual({ cfg: null, active: false, offer: true, betaSwitch: true, intro: false });
                    }
                }
            }
        }
    });

    it('on: mainnet with the beta config, whoever is signed in (or nobody yet)', () => {
        for (const hostname of PROD_HOSTNAMES) {
            for (const principal of PRINCIPALS) {
                const s = btcNativeStatus({ e: PROD, hostname, principal, storage: BETA_ON(), url: '' });
                expect(s).toMatchObject({ enabled: true, network: 'mainnet', devAllowed: false, devMainnet: false, devSource: null, betaAvailable: true, betaOn: true });
                expect(s.config).toBe(BTC_MAINNET_BETA);
            }
        }
        expect(BTC_MAINNET_BETA).toMatchObject({ network: 'mainnet', bitcoinCanister: 'ghsi2-tqaaa-aaaan-aaaca-cai', pseudoLedger: 'btc:mainnet', hrp: 'bc', explorer: 'https://mempool.space', symbol: 'BTC', label: 'Bitcoin', testnet: false, beta: true });
        expect(BTC_MAINNET_BETA.devMode).toBeFalsy();
        const on = btcNativeStatus({ e: PROD, hostname: 'app.sneeddao.com', principal: OTHER, storage: BETA_ON(), url: '' });
        expect(btcSurface(on, true)).toEqual({ cfg: BTC_MAINNET_BETA, active: true, offer: false, betaSwitch: true, intro: true });
        // logged out: the network is known but nothing is derived or called
        expect(btcSurface(on, false).active).toBe(false);
    });

    it('prod is never testnet and never developer mode', () => {
        for (const storage of [mem(), BETA_ON(), ALL_ON(), mem({ [MAINNET_DEV_KEY]: '1' }), null, blocked]) {
            for (const hostname of PROD_HOSTNAMES) {
                for (const principal of PRINCIPALS) {
                    for (const url of URLS) {
                        const s = btcNativeStatus({ e: PROD, hostname, principal, storage, url });
                        expect(s.network).not.toBe('testnet');
                        expect(s.config).not.toBe(BTC_NETWORKS.testnet);
                        expect(s.config).not.toBe(BTC_MAINNET_DEV);
                        expect(s.config?.testnet).toBeFalsy();
                        expect(s.config?.devMode).toBeFalsy();
                        expect(s.devAllowed).toBe(false);
                        expect(s.devMainnet).toBe(false);
                        expect(s.devSource).toBe(null);
                    }
                }
            }
        }
    });

    it('staging is unchanged by the beta switch: testnet4, developer mode as before, no beta', () => {
        for (const principal of [OTHER, null]) {
            const s = btcNativeStatus({ e: STAGING, hostname: STAGING_HOST, principal, storage: ALL_ON(), url: '?btcnet=mainnet' });
            expect(s).toMatchObject({ enabled: true, network: 'testnet', devMainnet: false, betaAvailable: false, betaOn: false });
            expect(s.config).toBe(BTC_NETWORKS.testnet);
        }
        const plain = btcNativeStatus({ e: STAGING, hostname: STAGING_HOST, principal: DEV, storage: BETA_ON(), url: '' });
        expect(plain).toMatchObject({ network: 'testnet', devAllowed: true, devMainnet: false, betaAvailable: false });
        const dev = btcNativeStatus({ e: STAGING, hostname: STAGING_HOST, principal: DEV, storage: ALL_ON(), url: '' });
        expect(dev).toMatchObject({ network: 'mainnet', devMainnet: true, devSource: 'toggle', betaAvailable: false, betaOn: false });
        expect(dev.config).toBe(BTC_MAINNET_DEV);
        expect(btcSurface(dev, true)).toMatchObject({ offer: false, betaSwitch: false, intro: false });
    });

    it('other builds stay off and never offer the switch, even with it remembered', () => {
        const builds = [
            { e: { DFX_NETWORK: 'ic', CANISTER_ID_APP_SNEEDDAO_FRONTEND: '2icdp-6qaaa-aaaal-qjt6a-cai' }, hostname: STAGING_HOST },
            { e: { DFX_NETWORK: 'local' }, hostname: 'localhost' },
            { e: {}, hostname: '' },
            { e: { ...STAGING, CANISTER_ID_APP_SNEEDDAO_FRONTEND: PROD_FRONTEND_CANISTER }, hostname: STAGING_HOST },
            ...PROD_HOSTS.map((h) => ({ e: STAGING, hostname: h })),
        ];
        for (const b of builds) {
            for (const principal of PRINCIPALS) {
                const s = btcNativeStatus({ ...b, principal, storage: ALL_ON(), url: '?btcnet=mainnet' });
                expect(s, JSON.stringify(b)).toMatchObject({ enabled: false, config: null, betaAvailable: false, betaOn: false, devMainnet: false });
                expect(btcSurface(s, true)).toEqual({ cfg: null, active: false, offer: false, betaSwitch: false, intro: false });
            }
        }
    });
});

describe('Bitcoin beta: the switch in localStorage', () => {
    it('key, default off, per browser, and blocked storage', () => {
        expect(BETA_KEY).toBe('sneed_btc_beta_v1');
        expect(BETA_KEY).not.toBe(MAINNET_DEV_KEY);
        const st = mem();
        expect(betaOptIn(st)).toBe(false);
        setBetaOptIn(true, st);
        expect(st.m.get(BETA_KEY)).toBe('1');
        expect(betaOptIn(st)).toBe(true);
        expect(btcNativeStatus({ e: PROD, hostname: 'app.sneeddao.com', storage: st, url: '' }).betaOn).toBe(true);
        setBetaOptIn(false, st);
        expect(st.m.has(BETA_KEY)).toBe(false);
        expect(btcNativeStatus({ e: PROD, hostname: 'app.sneeddao.com', storage: st, url: '' }).enabled).toBe(false);
        for (const v of ['true', 'on', '0', '', 'yes']) expect(betaOptIn(mem({ [BETA_KEY]: v })), v).toBe(false);
        expect(betaOptIn(blocked)).toBe(false);
        expect(() => setBetaOptIn(true, blocked)).not.toThrow();
        expect(betaOptIn(null)).toBe(false);
    });
    it('the one-time explanation is remembered separately', () => {
        expect(BETA_INTRO_KEY).toBe('sneed_btc_beta_intro_seen_v1');
        const st = mem();
        expect(betaIntroSeen(st)).toBe(false);
        setBetaIntroSeen(st);
        expect(betaIntroSeen(st)).toBe(true);
        expect(betaOptIn(st)).toBe(false);
        expect(betaIntroSeen(blocked)).toBe(false);
        expect(() => setBetaIntroSeen(blocked)).not.toThrow();
    });
});

// The real modules as a prod page loads them: process.env as Vite bakes it, window.localStorage
// and window.location; modules are re-imported per case because the network is decided once per
// page load.
describe('Bitcoin beta: the pockets adapter on a prod page', () => {
    const saved = { DFX_NETWORK: process.env.DFX_NETWORK, CANISTER_ID_APP_SNEEDDAO_FRONTEND: process.env.CANISTER_ID_APP_SNEEDDAO_FRONTEND, window: globalThis.window };
    afterEach(() => {
        for (const k of ['DFX_NETWORK', 'CANISTER_ID_APP_SNEEDDAO_FRONTEND']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
        if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window;
        vi.resetModules();
    });
    const prodPage = async (storage) => {
        process.env.DFX_NETWORK = 'ic';
        process.env.CANISTER_ID_APP_SNEEDDAO_FRONTEND = PROD_FRONTEND_CANISTER;
        globalThis.window = { localStorage: storage, location: { hostname: 'app.sneeddao.com', search: '', hash: '' } };
        vi.resetModules();
        const network = await import(`${SRC}utils/btc/network.js`);
        const adapter = await import(`${SRC}utils/pockets/adapters/btc_native.js`);
        const index = await import(`${SRC}utils/pockets/adapters/index.js`);
        return { network, adapter, index };
    };
    const spyCtx = () => {
        const calls = [];
        const bitcoin = {
            bitcoin_get_utxos_query: async (req) => { calls.push(['utxos', req]); return { utxos: [], tip_height: 900000, tip_block_hash: new Uint8Array(32), next_page: [] }; },
            bitcoin_get_balance_query: async (req) => { calls.push(['balance', req]); return 0n; },
        };
        return { calls, ctx: { me: Principal.fromText(OTHER), flags: {}, canisterIds: {}, actor: (kind, id) => { calls.push(['actor', kind, id]); return bitcoin; } } };
    };

    it('switch off: the adapter is not registered, derives nothing and calls nothing', async () => {
        const { network, adapter, index } = await prodPage(mem());
        expect(network.btcNative().betaAvailable).toBe(true);
        expect(network.btcNativeEnabled()).toBe(false);
        expect(network.btcNativeShown()).toBe(true);
        expect(index.ADAPTERS.map((a) => a.id)).not.toContain('btc_native');
        const { calls, ctx } = spyCtx();
        expect(adapter.btcConfigFor(ctx)).toBe(null);
        expect(adapter.btcNativeAdapter.enabled(ctx)).toBe(false);
        expect(await adapter.btcNativeAdapter.listMyAccounts(ctx)).toEqual([]);
        expect(await adapter.btcNativeAdapter.balance(ctx, null, 'btc:mainnet')).toEqual({ total: 0n, available: 0n });
        await expect(adapter.readNative(ctx, { fresh: true })).rejects.toThrow(/off/);
        expect(calls).toEqual([]);
    });

    it('switch on: registered, mainnet address and the mainnet Bitcoin canister', async () => {
        const { network, adapter, index } = await prodPage(BETA_ON());
        expect(network.btcNativeEnabled()).toBe(true);
        expect(index.ADAPTERS.map((a) => a.id)).toContain('btc_native');
        const { calls, ctx } = spyCtx();
        expect(adapter.btcConfigFor(ctx)).toBe(network.BTC_MAINNET_BETA);
        const [item] = await adapter.btcNativeAdapter.listMyAccounts(ctx);
        expect(item).toMatchObject({ hostKey: 'mainnet', label: 'Bitcoin address', ledgers: ['btc:mainnet'], meta: { network: 'mainnet', testnet: false, devMode: false } });
        expect(item.meta.address.startsWith('bc1q')).toBe(true);
        await adapter.readNative(ctx, { fresh: true });
        expect(calls[0]).toEqual(['actor', 'bitcoin', 'ghsi2-tqaaa-aaaan-aaaca-cai']);
        expect(calls.find((c) => c[0] === 'utxos')[1]).toMatchObject({ network: { mainnet: null }, address: item.meta.address });
    });
});

// Receive (the Bitcoin row) and send (btc.html) are React; they take their network, address and
// actors only through btcSurface / the adapter, which the cases above pin down. These checks keep
// them wired that way.
describe('Bitcoin beta: receive and send surfaces honour the switch', () => {
    const src = (p) => readFileSync(fileURLToPath(new URL(`${SRC}${p}`, import.meta.url)), 'utf8');
    it('btc.html: address and actors only when the surface is active; the offer replaces the send page', () => {
        const hook = src('btc/useBtcWallet.js');
        expect(hook).toMatch(/const surface = btcSurface\(status,/);
        expect(hook).toMatch(/surface\.active \? btcAddressFor\(/);
        expect(hook).toMatch(/surface\.active \? makeActors\(/);
        expect(hook).not.toMatch(/status\.enabled \? status\.config/);
        const app = src('btc/BtcApp.jsx');
        expect(app).toMatch(/!w\.cfg && w\.surface\.offer && <Card><BtcBetaOffer open \/><\/Card>/);
        expect(app).toMatch(/\{w\.cfg && isAuthenticated && \(/);
    });
    it('Bitcoin card: no read without a network and a principal; the offer while the switch is off', () => {
        const row = src('components/btc/BtcNativeSection.jsx');
        expect(row).toMatch(/useNativeBtc\(cfg && ctx\?\.me \? ctx : null\)/);
        expect(row).toMatch(/btcSurface\(btcNative\(ctx\?\.me \?\? null\)\)\.offer\) return hideButtons \? null : <BtcBetaOffer/);
        expect(row).toMatch(/btcSurface\(btcNative\(pk\.ctx\?\.me \?\? null\)\)\.offer/);
        expect(src('TokenCard.jsx')).toMatch(/btcBetaOffer = showPockets && pocketLedger === CKBTC\.ledger && !isBtcCard && !hideButtons && btcSurface\(btcNative\(\)\)\.offer/);
        expect(src('Wallet.jsx')).toMatch(/btcNativeShown\(\) &&/);
    });
    it('the switch reloads the page, and the send needs the real-bitcoin tick on the beta', () => {
        expect(src('components/btc/BtcBeta.jsx')).toMatch(/onChange=\{\(e\) => flipBeta\(e\.target\.checked\)\}/);
        expect(src('utils/btc/network.js')).toMatch(/setBetaOptIn\(on, storage\);\s*try \{ window\.location\.reload\(\); \}/);
        const send = src('components/btc/BtcSend.jsx');
        expect(send).toMatch(/const realBtc = Boolean\(cfg\.devMode \|\| cfg\.beta\);/);
        expect(send).toMatch(/if \(realBtc && !mainnetOk\) return;/);
        expect(send).toMatch(/\(realBtc && !mainnetOk\)( \|\| !sweepConfirmed)?\}>/); // A4: a sweep also needs its typed confirmation
    });
});
