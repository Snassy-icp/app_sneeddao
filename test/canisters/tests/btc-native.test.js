// Native Bitcoin, phase A1 (spec/sneed_wallet.md §3.1, §5.2, §10): pure frontend logic, no
// PocketIC canisters.
//   - the offline address derivation (utils/btc/address.js) against DFINITY's @dfinity/ic-pub-key
//     1.0.2 (the library the spec names) and its published Chain Fusion Signer vectors, for
//     mainnet, testnet (testnet4) and regtest, and the raw key derivation for arbitrary paths;
//   - UTXO parsing, paging and the balance summary (utils/btc/utxos.js), with a real testnet4
//     response of the IC Bitcoin canister (g4xu7, read 2026-10-23) as fixture;
//   - the feature flag (utils/btc/network.js): on only for a staging build off the prod hosts;
//   - the btc_native pocket adapter and the chain pocket in the pockets model.
import { describe, it, expect } from 'vitest';
import { Principal } from '@dfinity/principal';
import { btc as icPubKeyBtc } from '@dfinity/ic-pub-key/signer';
import { secp256k1 as icPubKeyEcdsa } from '@dfinity/ic-pub-key/ecdsa';
import {
    deriveBtcAddress, deriveSubkey, p2wpkhAddress, btcAddressFor, bitcoinUri, toHex, SIGNER_PUBKEY_HEX, SIGNER_CHAINCODE_HEX,
} from '../../../src/app_sneeddao_frontend/src/utils/btc/address.js';
import { parseBtcAddress } from '../../../src/app_sneeddao_frontend/src/utils/ckAddress.js';
import {
    txidHex, parseUtxo, parseUtxoPages, summarizeUtxos, fetchUtxos, fetchBalance, readAddress, outpointKey, networkVariant,
} from '../../../src/app_sneeddao_frontend/src/utils/btc/utxos.js';
import { btcNativeStatus, isProdHost, BTC_NETWORKS, PROD_FRONTEND_CANISTER } from '../../../src/app_sneeddao_frontend/src/utils/btc/network.js';
import { btcNativeAdapter, btcConfigFor, readNative } from '../../../src/app_sneeddao_frontend/src/utils/pockets/adapters/btc_native.js';
import { listHosted, readBalances, okBalances, enabledAdapters, ADAPTERS } from '../../../src/app_sneeddao_frontend/src/utils/pockets/adapters/index.js';
import * as M from '../../../src/app_sneeddao_frontend/src/utils/pockets/model.js';

const hexToBytes = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));

// Principals of every shape: self-authenticating (29 bytes), canister ids (10 bytes), anonymous,
// management, and the one in ic-pub-key's own vectors.
const PRINCIPALS = [
    'nggqm-p5ozz-i5hfv-bejmq-2gtow-4dtqw-vjatn-4b4yw-s5mzs-i46su-6ae',
    Principal.selfAuthenticating(new Uint8Array(44).fill(1)).toText(),
    Principal.selfAuthenticating(new TextEncoder().encode('sneed wallet test key')).toText(),
    'grghe-syaaa-aaaar-qabyq-cai',
    'mxzaz-hqaaa-aaaar-qaada-cai',
    'ryjl3-tyaaa-aaaaa-aaaba-cai',
    '2vxsx-fae',
    'aaaaa-aa',
];

describe('offline Sneed Wallet BTC address (signer path [0x00, principal], P2WPKH)', () => {
    it("matches ic-pub-key's published Chain Fusion Signer vectors (test/cli.json, src/signer/btc.test.ts)", () => {
        const p = 'nggqm-p5ozz-i5hfv-bejmq-2gtow-4dtqw-vjatn-4b4yw-s5mzs-i46su-6ae';
        expect(deriveBtcAddress(p, 'mainnet').address).toBe('bc1qwug6tj9z7tgvsp4u8sfzvjzatzs9rmwwck6qky');
        expect(deriveBtcAddress(p, 'testnet').address).toBe('tb1qwug6tj9z7tgvsp4u8sfzvjzatzs9rmwwjspndh');
        expect(deriveBtcAddress(p, 'regtest').address).toBe('bcrt1qwug6tj9z7tgvsp4u8sfzvjzatzs9rmwwsec767');
    });

    it("uses the signer key and chain code the library publishes", () => {
        expect(SIGNER_PUBKEY_HEX).toBe(icPubKeyBtc.CHAIN_FUSION_SIGNER_PUBKEY.toHex());
        expect(SIGNER_CHAINCODE_HEX).toBe(icPubKeyBtc.CHAIN_FUSION_SIGNER_CHAINCODE.toHex());
        expect(Array.from(icPubKeyBtc.CHAIN_FUSION_SIGNER_BTC_DOMAIN_SEPARATOR)).toEqual([0x00]);
    });

    it('agrees with @dfinity/ic-pub-key 1.0.2 for every principal shape on every network', () => {
        for (const t of PRINCIPALS) {
            for (const network of ['mainnet', 'testnet', 'regtest']) {
                const ours = deriveBtcAddress(t, network).address;
                // the library's Principal is a different major version; it only calls toUint8Array()
                const theirs = icPubKeyBtc.chainFusionSignerBtcAddressFor(Principal.fromText(t), network).response.btc_address;
                expect(ours, `${t} ${network}`).toBe(theirs);
            }
        }
    });

    it('is a valid P2WPKH address of the right network (the minter-compatible parser agrees)', () => {
        for (const t of PRINCIPALS.slice(0, 3)) {
            expect(parseBtcAddress(deriveBtcAddress(t, 'mainnet').address, 'mainnet')).toMatchObject({ ok: true, type: 'p2wpkh', network: 'mainnet' });
            expect(parseBtcAddress(deriveBtcAddress(t, 'testnet').address, 'testnet')).toMatchObject({ ok: true, type: 'p2wpkh', network: 'testnet' });
            // a testnet address is refused where mainnet is expected: nobody can pay it real BTC
            expect(parseBtcAddress(deriveBtcAddress(t, 'testnet').address, 'mainnet').ok).toBe(false);
        }
    });

    it("derives the same subkeys as ic-pub-key's DerivationPath for arbitrary paths (mainnet key_1 master)", () => {
        const master = icPubKeyEcdsa.PublicKeyWithChainCode.forMainnetKey('key_1');
        const paths = [
            [],
            [Uint8Array.of(0)],
            [Uint8Array.of(1), Principal.fromText(PRINCIPALS[1]).toUint8Array()],
            [new TextEncoder().encode('sneed'), Uint8Array.of(0xff, 0x00, 0x7f), new Uint8Array(32).fill(9)],
        ];
        for (const path of paths) {
            const theirs = master.deriveSubkeyWithChainCode(new icPubKeyEcdsa.DerivationPath(path));
            const ours = deriveSubkey(master.public_key.bytes, master.chain_code.bytes, path);
            expect(toHex(ours.publicKey)).toBe(theirs.public_key.toHex());
            expect(toHex(ours.chainCode)).toBe(theirs.chain_code.toHex());
        }
    });

    it('P2WPKH encoding matches BIP-173 (the generator point vector)', () => {
        const g = hexToBytes('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
        expect(p2wpkhAddress(g, 'mainnet')).toBe('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
        expect(p2wpkhAddress(g, 'testnet')).toBe('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx');
        expect(() => p2wpkhAddress(g, 'testnet3')).toThrow(/Unknown Bitcoin network/);
        expect(() => p2wpkhAddress(g.slice(1), 'mainnet')).toThrow(/compressed/);
    });

    it('caches per principal and network; the QR carries a bitcoin: URI', () => {
        const p = PRINCIPALS[0];
        expect(btcAddressFor(p, 'testnet')).toBe('tb1qwug6tj9z7tgvsp4u8sfzvjzatzs9rmwwjspndh');
        expect(btcAddressFor(Principal.fromText(p), 'testnet')).toBe('tb1qwug6tj9z7tgvsp4u8sfzvjzatzs9rmwwjspndh');
        expect(btcAddressFor(p, 'mainnet')).toBe('bc1qwug6tj9z7tgvsp4u8sfzvjzatzs9rmwwck6qky');
        expect(bitcoinUri('tb1qx')).toBe('bitcoin:tb1qx');
    });
});

// ---- UTXOs ----

// The first two UTXOs and the tip of the IC Bitcoin testnet canister's answer to
// bitcoin_get_utxos_query({ network = testnet; address = "tb1qur7330emxypadqvr0mu4989sfzw32gpkxgyd2m" })
// on 2026-10-23 (coinbase outputs; mempool.space/testnet4 shows block 157346's coinbase as d083c4…fff8).
const TIP_HASH = hexToBytes('be6ce672a5beea940f466f83cd15badc3ad37edd8ab7f68001e4e50700000000');
const REAL = {
    tip_height: 157_355,
    tip_block_hash: TIP_HASH,
    next_page: [],
    utxos: [
        { height: 157_346, value: 5_000_000_000n, outpoint: { txid: hexToBytes('f8ffd746506a54159d2302987cb419d8e179843defa270baf1b01a3722c483d0'), vout: 0 } },
        { height: 157_345, value: 5_000_000_000n, outpoint: { txid: hexToBytes('e6cb46a89fe174db5bec2efc6db73585fa512455c4d5afb5d5f003c71b016bd7'), vout: 0 } },
    ],
};

const raw = (txByte, vout, value, height) => ({ outpoint: { txid: new Uint8Array(32).fill(txByte), vout }, value: BigInt(value), height });

describe('UTXOs and balance from the Bitcoin canister', () => {
    it('parses a real testnet4 answer: display txid reversed, confirmations = tip − height + 1', () => {
        const { utxos, tipHeight, tipHash } = parseUtxoPages([REAL]);
        expect(tipHeight).toBe(157_355);
        expect(tipHash).toBe('00000000' + '07e5e40180f6b78add7ed33adcba15cd836f460f94eabea572e66cbe'); // block hashes display reversed too
        expect(utxos[0]).toEqual({ txid: 'd083c422371ab0f1ba70a2ef3d8479e1d819b47c9802239d15546a5046d7fff8', vout: 0, value: 5_000_000_000n, height: 157_346, confirmations: 10 });
        expect(utxos[1].confirmations).toBe(11);
        expect(summarizeUtxos(utxos)).toEqual({ confirmed: 10_000_000_000n, pending: 0n, locked: 0n, total: 10_000_000_000n, count: 2, settling: 0n });
    });

    it('confirmations: the tip block counts 1, a height above the tip (a lagging replica) counts 0', () => {
        expect(parseUtxo(raw(1, 0, 10, 100), 100).confirmations).toBe(1);
        expect(parseUtxo(raw(1, 0, 10, 95), 100).confirmations).toBe(6);
        expect(parseUtxo(raw(1, 0, 10, 101), 100).confirmations).toBe(0);
    });

    it('summary: confirmed vs pending by min confirmations, locked outpoints apart, settling under 6', () => {
        const tip = 1000;
        const us = [raw(1, 0, 100_000, 1000), raw(2, 1, 20_000, 990), raw(3, 0, 5_000, 1001)].map((r) => parseUtxo(r, tip));
        // 1 conf, 11 confs, 0 confs
        expect(summarizeUtxos(us)).toMatchObject({ confirmed: 120_000n, pending: 5_000n, total: 125_000n, settling: 100_000n });
        expect(summarizeUtxos(us, { minConfirmations: 6 })).toMatchObject({ confirmed: 20_000n, pending: 105_000n });
        const locked = new Set([outpointKey(us[1])]);
        expect(summarizeUtxos(us, { locked })).toMatchObject({ confirmed: 100_000n, pending: 5_000n, locked: 20_000n, total: 125_000n });
        expect(summarizeUtxos([])).toEqual({ confirmed: 0n, pending: 0n, locked: 0n, total: 0n, count: 0, settling: 0n });
    });

    it('pages until next_page is null, sending the page blob back, and de-duplicates outpoints', async () => {
        const calls = [];
        const pages = [
            { tip_height: 50, tip_block_hash: TIP_HASH, next_page: [Uint8Array.of(7, 7)], utxos: [raw(1, 0, 1, 50), raw(2, 0, 2, 49)] },
            { tip_height: 50, tip_block_hash: TIP_HASH, next_page: [], utxos: [raw(2, 0, 2, 49), raw(3, 4, 3, 40)] },
        ];
        const actor = { bitcoin_get_utxos_query: async (req) => { calls.push(req); return pages[calls.length - 1]; } };
        const r = await fetchUtxos(actor, { network: 'testnet', address: 'tb1qx' });
        expect(calls.map((c) => c.filter)).toEqual([[], [{ page: Uint8Array.of(7, 7) }]]);
        expect(calls[0]).toMatchObject({ network: { testnet: null }, address: 'tb1qx' });
        expect(r.complete).toBe(true);
        expect(r.pages).toBe(2);
        expect(r.utxos.map((u) => u.value)).toEqual([1n, 2n, 3n]);
        expect(r.utxos[2].confirmations).toBe(11);
    });

    it('starts over once when the tip moves between pages, and gives up the second time', async () => {
        let n = 0;
        const seq = [
            { tip_height: 10, tip_block_hash: TIP_HASH, next_page: [Uint8Array.of(1)], utxos: [raw(1, 0, 1, 10)] },
            { tip_height: 11, tip_block_hash: TIP_HASH, next_page: [], utxos: [] },               // moved
            { tip_height: 11, tip_block_hash: TIP_HASH, next_page: [], utxos: [raw(1, 0, 1, 10)] }, // retry, one page
        ];
        const r = await fetchUtxos({ bitcoin_get_utxos_query: async () => seq[n++] }, { network: 'mainnet', address: 'bc1qx' });
        expect(r.tipHeight).toBe(11);
        expect(r.utxos[0].confirmations).toBe(2);
        let h = 0;
        const always = { bitcoin_get_utxos_query: async () => ({ tip_height: h++, tip_block_hash: TIP_HASH, next_page: [Uint8Array.of(1)], utxos: [] }) };
        await expect(fetchUtxos(always, { network: 'mainnet', address: 'bc1qx' })).rejects.toThrow(/moved/);
    });

    it('stops after maxPages and says the list is incomplete', async () => {
        const actor = { bitcoin_get_utxos_query: async () => ({ tip_height: 5, tip_block_hash: TIP_HASH, next_page: [Uint8Array.of(1)], utxos: [raw(9, 0, 1, 5)] }) };
        const r = await fetchUtxos(actor, { network: 'testnet', address: 'tb1qx', maxPages: 3 });
        expect(r).toMatchObject({ complete: false, pages: 3 });
    });

    it('balance query and the cross-check flag a disagreement with the UTXO sum', async () => {
        const actor = (bal) => ({
            bitcoin_get_utxos_query: async () => REAL,
            bitcoin_get_balance_query: async (req) => { expect(req).toEqual({ network: { testnet: null }, address: 'tb1qx', min_confirmations: [1] }); return bal; },
        });
        expect(await fetchBalance(actor(5n), { network: 'testnet', address: 'tb1qx', minConfirmations: 1 })).toBe(5n);
        expect((await readAddress(actor(10_000_000_000n), { network: 'testnet', address: 'tb1qx' })).mismatch).toBe(false);
        expect((await readAddress(actor(1n), { network: 'testnet', address: 'tb1qx' })).mismatch).toBe(true);
        const failing = { bitcoin_get_utxos_query: async () => REAL, bitcoin_get_balance_query: async () => { throw new Error('down'); } };
        const r = await readAddress(failing, { network: 'testnet', address: 'tb1qx' });
        expect(r).toMatchObject({ canisterBalance: null, mismatch: false });
        expect(r.summary.confirmed).toBe(10_000_000_000n);
    });

    it('txids and network variants', () => {
        expect(txidHex(Uint8Array.of(1, 2, 0xab))).toBe('ab0201');
        expect(networkVariant('testnet')).toEqual({ testnet: null });
        expect(() => networkVariant('testnet4')).toThrow();
    });
});

// ---- the flag ----

describe('feature flag: native BTC only on a staging build, never on prod', () => {
    const staging = { DFX_NETWORK: 'staging', CANISTER_ID_APP_SNEEDDAO_FRONTEND: '2icdp-6qaaa-aaaal-qjt6a-cai' };
    it('is on for the staging build on the staging host, with Bitcoin testnet4', () => {
        const s = btcNativeStatus({ e: staging, hostname: '2icdp-6qaaa-aaaal-qjt6a-cai.icp0.io' });
        expect(s).toMatchObject({ enabled: true, network: 'testnet' });
        expect(s.config).toBe(BTC_NETWORKS.testnet);
        expect(s.config).toMatchObject({ bitcoinCanister: 'g4xu7-jiaaa-aaaan-aaaaq-cai', pseudoLedger: 'btc:testnet', testnet: true });
    });
    it('is off for the prod build, a local build, and no build info', () => {
        expect(btcNativeStatus({ e: { DFX_NETWORK: 'ic', CANISTER_ID_APP_SNEEDDAO_FRONTEND: PROD_FRONTEND_CANISTER }, hostname: 'app.sneeddao.com' }).enabled).toBe(false);
        expect(btcNativeStatus({ e: { DFX_NETWORK: 'ic' }, hostname: 'localhost' }).enabled).toBe(false);
        expect(btcNativeStatus({ e: { DFX_NETWORK: 'local' }, hostname: 'localhost' }).enabled).toBe(false);
        expect(btcNativeStatus({ e: {}, hostname: '' }).enabled).toBe(false);
    });
    it('is off when a staging build carries the prod frontend id or runs on a prod host', () => {
        expect(btcNativeStatus({ e: { ...staging, CANISTER_ID_APP_SNEEDDAO_FRONTEND: PROD_FRONTEND_CANISTER }, hostname: 'x.icp0.io' }).enabled).toBe(false);
        for (const h of ['app.sneeddao.com', 'APP.SNEEDDAO.COM', `${PROD_FRONTEND_CANISTER}.icp0.io`, `${PROD_FRONTEND_CANISTER}.raw.ic0.app`]) {
            expect(isProdHost(h), h).toBe(true);
            expect(btcNativeStatus({ e: staging, hostname: h }).enabled, h).toBe(false);
        }
    });
    it.skipIf(process.env.DFX_NETWORK === 'staging')('this test process (no DFX_NETWORK=staging) leaves the adapter out of ADAPTERS', () => {
        expect(btcNativeStatus().enabled).toBe(false);
        expect(ADAPTERS.map((a) => a.id)).not.toContain('btc_native');
        expect(btcConfigFor({ flags: {} })).toBe(null);
        expect(enabledAdapters({ flags: {}, canisterIds: {} }, [btcNativeAdapter])).toEqual([]);
    });
});

// ---- the adapter and the model ----

const ME = PRINCIPALS[1];
function ctxWith({ network = 'testnet', utxos = REAL, balance = 10_000_000_000n } = {}) {
    const calls = [];
    const bitcoin = {
        bitcoin_get_utxos_query: async (req) => { calls.push(req); return utxos; },
        bitcoin_get_balance_query: async () => balance,
    };
    return {
        calls,
        ctx: {
            me: Principal.fromText(ME),
            flags: { btcNative: { network } },
            canisterIds: {},
            actor: (kind, id) => { expect(kind).toBe('bitcoin'); expect(id).toBe(BTC_NETWORKS[network].bitcoinCanister); return bitcoin; },
        },
    };
}

describe('btc_native pocket adapter and the chain pocket', () => {
    it('lists one chain pocket: the derived address, the pseudo-ledger, receive only', async () => {
        const { ctx } = ctxWith();
        expect(btcNativeAdapter.enabled(ctx)).toBe(true);
        const [item] = await btcNativeAdapter.listMyAccounts(ctx);
        expect(item).toMatchObject({ hostKey: 'testnet', account: null, ledgers: ['btc:testnet'] });
        expect(item.meta).toMatchObject({ address: deriveBtcAddress(ME, 'testnet').address, network: 'testnet', testnet: true });
        const hosted = await listHosted(ctx, { adapters: [btcNativeAdapter] });
        const pockets = M.mergePockets({ me: ME, hosted });
        const p = pockets.find((x) => x.kind === M.KIND.chain);
        expect(p.id).toBe('c:btc_native:testnet');
        expect(p.caps).toMatchObject({ receive: true, send: false, withdraw: false, deposit: false, approve: false, readOnly: true });
        expect(M.receiveAccount(p)).toBe(null);
    });

    it('reads the balance through the Bitcoin canister query, once per 20 s for both readers', async () => {
        const { ctx, calls } = ctxWith({ network: 'mainnet' });
        const hosted = await listHosted(ctx, { adapters: [btcNativeAdapter] });
        let pockets = M.mergePockets({ me: ME, hosted });
        const balances = okBalances(await readBalances(ctx, pockets));
        pockets = M.mergePockets({ me: ME, hosted, balances });
        const p = pockets.find((x) => x.kind === M.KIND.chain);
        expect(M.balanceOf(p, 'btc:mainnet')).toEqual({ total: 10_000_000_000n, available: 10_000_000_000n });
        expect(calls[0]).toMatchObject({ network: { mainnet: null }, address: deriveBtcAddress(ME, 'mainnet').address });
        const r = await readNative(ctx);
        expect(r.summary.confirmed).toBe(10_000_000_000n);
        expect(calls.length).toBe(1); // shared read
        await readNative(ctx, { fresh: true });
        expect(calls.length).toBe(2);
        expect(await btcNativeAdapter.balance(ctx, p, 'mxzaz-hqaaa-aaaar-qaada-cai')).toEqual({ total: 0n, available: 0n });
    });

    it('a failing Bitcoin canister marks only that row', async () => {
        const { ctx } = ctxWith({ network: 'testnet' });
        const broken = { ...ctx, me: Principal.fromText(PRINCIPALS[2]), actor: () => ({ bitcoin_get_utxos_query: async () => { throw new Error('replica down'); }, bitcoin_get_balance_query: async () => 0n }) };
        const hosted = await listHosted(broken, { adapters: [btcNativeAdapter] });
        const pockets = M.mergePockets({ me: PRINCIPALS[2], hosted });
        const read = await readBalances(broken, pockets);
        const p = pockets.find((x) => x.kind === M.KIND.chain);
        expect(read.get(p.id).get('btc:testnet').error).toMatch(/replica down/);
        expect(read.get(M.MAIN_ID)).toBeDefined(); // the wallet's own rows still read
    });

    it('chain pockets stay out of ICRC lists, pickers and the switcher; only mainnet sats count on the Bitcoin card', () => {
        const mk = (network) => {
            const cfg = BTC_NETWORKS[network];
            const base = M.adapterPocket(btcNativeAdapter, { hostKey: network, account: null, ledgers: [cfg.pseudoLedger], meta: { testnet: cfg.testnet } });
            return M.withBalance(base, cfg.pseudoLedger, 50_000n);
        };
        const main = M.withBalance(M.walletPocket(ME), 'mxzaz-hqaaa-aaaar-qaada-cai', 7n);
        const test = mk('testnet');
        const real = mk('mainnet');
        const all = [main, test, real];
        expect(test.kind).toBe(M.KIND.chain);
        expect(M.isListed(test)).toBe(false);
        expect(M.listed(all).map((p) => p.id)).toEqual([M.MAIN_ID]);
        expect(M.hasExtraPockets(all)).toBe(false);
        for (const f of ['from', 'to', 'receive', 'approve']) expect(M.pickable(all, 'btc:mainnet', f).some((p) => p.kind === M.KIND.chain)).toBe(false);
        expect(M.holders(all, 'mxzaz-hqaaa-aaaar-qaada-cai').map((p) => p.id)).toEqual([M.MAIN_ID]);
        expect(M.otherPocketsTotal(all, 'mxzaz-hqaaa-aaaar-qaada-cai')).toBe(0n);
        expect(M.nativeBtcForCard([main, test])).toBe(0n);           // testnet coins never count
        expect(M.nativeBtcForCard(all)).toBe(50_000n);               // mainnet BTC does
        expect(M.sortPockets([real, main]).map((p) => p.id)).toEqual([M.MAIN_ID, real.id]);
    });
});
