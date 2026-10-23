// Native Bitcoin, mainnet developer mode (utils/btc/network.js; spec/sneed_wallet.md): on a
// staging build only, an allowlisted test principal that opts in (toggle in localStorage, or
// btcnet=mainnet in the URL) gets Bitcoin mainnet so sending can be tested with a little real BTC.
// Prod builds and prod hosts stay off whatever the principal, toggle or URL say; every other
// principal stays on testnet4. Pure frontend logic, no PocketIC.
import { describe, it, expect } from 'vitest';
import { Principal } from '@dfinity/principal';
import {
    btcNativeStatus, BTC_NETWORKS, BTC_MAINNET_DEV, PROD_FRONTEND_CANISTER, PROD_HOSTS, MAINNET_DEV_PRINCIPALS, MAINNET_DEV_KEY,
    isMainnetDevPrincipal, mainnetDevOptIn, setMainnetDevOptIn, urlNetParam, urlWithoutNetParam,
} from '../../../src/app_sneeddao_frontend/src/utils/btc/network.js';
import { deriveBtcAddress } from '../../../src/app_sneeddao_frontend/src/utils/btc/address.js';
import { btcConfigFor, btcNativeAdapter, readNative } from '../../../src/app_sneeddao_frontend/src/utils/pockets/adapters/btc_native.js';
import { storeKey } from '../../../src/app_sneeddao_frontend/src/utils/btc/pending.js';
import { receivesKey } from '../../../src/app_sneeddao_frontend/src/utils/btc/history.js';
import { verifiedKey, buildSendRequest } from '../../../src/app_sneeddao_frontend/src/utils/btc/send.js';
import { parseBtcAddress } from '../../../src/app_sneeddao_frontend/src/utils/ckAddress.js';

const DEV = 'tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae';
const OTHER = 'nggqm-p5ozz-i5hfv-bejmq-2gtow-4dtqw-vjatn-4b4yw-s5mzs-i46su-6ae';
const STAGING = { DFX_NETWORK: 'staging', CANISTER_ID_APP_SNEEDDAO_FRONTEND: '2icdp-6qaaa-aaaal-qjt6a-cai' };
const STAGING_HOST = '2icdp-6qaaa-aaaal-qjt6a-cai.icp0.io';

const mem = (init = {}) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const ON = () => mem({ [MAINNET_DEV_KEY]: '1' });
const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };

describe('mainnet developer mode: the flag matrix', () => {
    it('allowlists exactly the test identity', () => {
        expect(MAINNET_DEV_PRINCIPALS).toEqual([DEV]);
        expect(isMainnetDevPrincipal(DEV)).toBe(true);
        expect(isMainnetDevPrincipal(Principal.fromText(DEV))).toBe(true);
        expect(isMainnetDevPrincipal(OTHER)).toBe(false);
        expect(isMainnetDevPrincipal('2vxsx-fae')).toBe(false);
        expect(isMainnetDevPrincipal(null)).toBe(false);
        expect(isMainnetDevPrincipal('')).toBe(false);
    });

    it('prod build, prod frontend id or prod host: off, whatever the principal, toggle or URL', () => {
        const builds = [
            { e: { DFX_NETWORK: 'ic', CANISTER_ID_APP_SNEEDDAO_FRONTEND: PROD_FRONTEND_CANISTER }, hostname: 'app.sneeddao.com' },
            { e: { DFX_NETWORK: 'ic', CANISTER_ID_APP_SNEEDDAO_FRONTEND: '2icdp-6qaaa-aaaal-qjt6a-cai' }, hostname: STAGING_HOST },
            { e: { DFX_NETWORK: 'local' }, hostname: 'localhost' },
            { e: {}, hostname: '' },
            { e: { ...STAGING, CANISTER_ID_APP_SNEEDDAO_FRONTEND: PROD_FRONTEND_CANISTER }, hostname: STAGING_HOST },
            ...PROD_HOSTS.map((h) => ({ e: STAGING, hostname: h })),
        ];
        for (const b of builds) {
            for (const principal of [DEV, Principal.fromText(DEV), OTHER, null]) {
                for (const storage of [ON(), mem(), null]) {
                    for (const url of ['', '?btcnet=mainnet', '#send&btcnet=mainnet']) {
                        const s = btcNativeStatus({ ...b, principal, storage, url });
                        expect(s, JSON.stringify(b)).toMatchObject({ enabled: false, network: null, config: null, devAllowed: false, devMainnet: false });
                    }
                }
            }
        }
    });

    it('staging + a non-allowlisted principal: testnet4 even with the toggle and the URL parameter', () => {
        for (const principal of [OTHER, '2vxsx-fae', Principal.fromText(OTHER)]) {
            for (const url of ['', '?btcnet=mainnet', '#send&btcnet=mainnet']) {
                const s = btcNativeStatus({ e: STAGING, hostname: STAGING_HOST, principal, storage: ON(), url });
                expect(s).toMatchObject({ enabled: true, network: 'testnet', devAllowed: false, devMainnet: false });
                expect(s.config).toBe(BTC_NETWORKS.testnet);
            }
        }
    });

    it('staging while logged out: testnet4 (nothing can be mainnet before the principal is known)', () => {
        for (const url of ['', '?btcnet=mainnet']) {
            const s = btcNativeStatus({ e: STAGING, hostname: STAGING_HOST, principal: null, storage: ON(), url });
            expect(s).toMatchObject({ enabled: true, network: 'testnet', devAllowed: false, devMainnet: false });
        }
    });

    it('staging + the allowlisted principal without the opt-in: testnet4, but the option is offered', () => {
        for (const storage of [mem(), mem({ [MAINNET_DEV_KEY]: '0' }), null, blocked]) {
            const s = btcNativeStatus({ e: STAGING, hostname: STAGING_HOST, principal: DEV, storage, url: '' });
            expect(s).toMatchObject({ enabled: true, network: 'testnet', devAllowed: true, devMainnet: false, devSource: null });
            expect(s.config).toBe(BTC_NETWORKS.testnet);
        }
    });

    it('staging + the allowlisted principal + the toggle: mainnet, marked as developer mode', () => {
        const s = btcNativeStatus({ e: STAGING, hostname: STAGING_HOST, principal: Principal.fromText(DEV), storage: ON(), url: '' });
        expect(s).toMatchObject({ enabled: true, network: 'mainnet', devAllowed: true, devMainnet: true, devSource: 'toggle' });
        expect(s.config).toBe(BTC_MAINNET_DEV);
        expect(s.config).toMatchObject({ network: 'mainnet', bitcoinCanister: 'ghsi2-tqaaa-aaaan-aaaca-cai', pseudoLedger: 'btc:mainnet', hrp: 'bc', explorer: 'https://mempool.space', symbol: 'BTC', testnet: false, devMode: true });
    });

    it('staging + the allowlisted principal + btcnet=mainnet in the query or hash: mainnet; btcnet=testnet overrides the toggle', () => {
        for (const url of ['?btcnet=mainnet', '?x=1&btcnet=mainnet', '#btcnet=mainnet', '#send&btcnet=mainnet', '?a=b#send&btcnet=mainnet']) {
            const s = btcNativeStatus({ e: STAGING, hostname: STAGING_HOST, principal: DEV, storage: mem(), url });
            expect(s, url).toMatchObject({ network: 'mainnet', devMainnet: true, devSource: 'param' });
        }
        expect(btcNativeStatus({ e: STAGING, hostname: STAGING_HOST, principal: DEV, storage: ON(), url: '#send&btcnet=testnet' })).toMatchObject({ network: 'testnet', devAllowed: true, devMainnet: false });
        // look-alikes do not count
        for (const url of ['?xbtcnet=mainnet', '?btcnet=mainnetx', '?btcnet=Mainnet', '?btcnet=']) {
            expect(btcNativeStatus({ e: STAGING, hostname: STAGING_HOST, principal: DEV, storage: mem(), url }).network, url).toBe('testnet');
        }
    });

    it('this test process (no staging build) is off for the allowlisted principal too', () => {
        if (process.env.DFX_NETWORK === 'staging') return;
        expect(btcNativeStatus({ principal: DEV, storage: ON(), url: '?btcnet=mainnet' }).enabled).toBe(false);
    });
});

describe('mainnet developer mode: opt-in storage and URL helpers', () => {
    it('remembers the toggle per browser, default off, and survives blocked storage', () => {
        const st = mem();
        expect(mainnetDevOptIn(st)).toBe(false);
        setMainnetDevOptIn(true, st);
        expect(st.m.get(MAINNET_DEV_KEY)).toBe('1');
        expect(mainnetDevOptIn(st)).toBe(true);
        setMainnetDevOptIn(false, st);
        expect(st.m.has(MAINNET_DEV_KEY)).toBe(false);
        expect(mainnetDevOptIn(blocked)).toBe(false);
        expect(() => setMainnetDevOptIn(true, blocked)).not.toThrow();
        expect(mainnetDevOptIn(null)).toBe(false);
    });
    it('reads and strips the btcnet parameter', () => {
        expect(urlNetParam('?btcnet=mainnet')).toBe('mainnet');
        expect(urlNetParam('&#send&btcnet=testnet')).toBe('testnet');
        expect(urlNetParam('#send')).toBe(null);
        expect(urlWithoutNetParam('https://x.icp0.io/btc.html?btcnet=mainnet#send')).toBe('https://x.icp0.io/btc.html#send');
        expect(urlWithoutNetParam('https://x.icp0.io/btc.html#send&btcnet=mainnet')).toBe('https://x.icp0.io/btc.html#send');
        expect(urlWithoutNetParam('https://x.icp0.io/wallet?a=1&btcnet=mainnet')).toBe('https://x.icp0.io/wallet?a=1');
        expect(urlWithoutNetParam('https://x.icp0.io/btc.html#send')).toBe('https://x.icp0.io/btc.html#send');
    });
});

describe('mainnet developer mode: storage keys and addresses per network', () => {
    it('pending, receives and address-verified keys never mix testnet and mainnet', () => {
        for (const k of [storeKey, receivesKey, verifiedKey]) {
            expect(k('mainnet', DEV)).not.toBe(k('testnet', DEV));
            expect(k('mainnet', DEV)).toContain(':mainnet:');
            expect(k('testnet', DEV)).toContain(':testnet:');
            expect(k(BTC_MAINNET_DEV.network, DEV)).toBe(k('mainnet', DEV));
        }
    });
    it('derives a bc1 address in developer mode and a tb1 address otherwise, for the same principal', () => {
        const main = deriveBtcAddress(DEV, BTC_MAINNET_DEV.network).address;
        const test = deriveBtcAddress(DEV, BTC_NETWORKS.testnet.network).address;
        expect(main.startsWith('bc1q')).toBe(true);
        expect(test.startsWith('tb1q')).toBe(true);
        expect(parseBtcAddress(main, 'mainnet')).toMatchObject({ ok: true, network: 'mainnet' });
        expect(parseBtcAddress(main, 'testnet').ok).toBe(false);
        // the same key: only the prefix and checksum differ
        expect(main.slice(4, -6)).toBe(test.slice(4, -6));
    });
    it('the adapter reads the mainnet Bitcoin canister with the mainnet variant and labels the pocket', async () => {
        const calls = [];
        const ids = [];
        const bitcoin = { bitcoin_get_utxos_query: async (req) => { calls.push(req); return { utxos: [], tip_height: 900000, tip_block_hash: new Uint8Array(32), next_page: [] }; }, bitcoin_get_balance_query: async () => 0n };
        const ctx = { me: Principal.fromText(DEV), flags: { btcNative: { network: 'mainnet' } }, canisterIds: {}, actor: (kind, id) => { ids.push(id); return bitcoin; } };
        expect(btcConfigFor(ctx).network).toBe('mainnet');
        await readNative(ctx, { fresh: true });
        expect(ids).toEqual(['ghsi2-tqaaa-aaaan-aaaca-cai']);
        expect(calls[0]).toMatchObject({ network: { mainnet: null }, address: deriveBtcAddress(DEV, 'mainnet').address });
        const [item] = await btcNativeAdapter.listMyAccounts(ctx);
        expect(item).toMatchObject({ hostKey: 'mainnet', ledgers: ['btc:mainnet'] });
        expect(buildSendRequest({ inputs: [], outputs: [], fee: 1n, network: BTC_MAINNET_DEV.network }).network).toEqual({ mainnet: null });
    });
    it('without a flag override the adapter follows the build flag for ctx.me (off in this process)', () => {
        if (process.env.DFX_NETWORK === 'staging') return;
        expect(btcConfigFor({ me: Principal.fromText(DEV), flags: {} })).toBe(null);
    });
});
