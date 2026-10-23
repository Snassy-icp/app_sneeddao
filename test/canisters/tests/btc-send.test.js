// Native Bitcoin sending, phases A0 + A2 (spec/sneed_wallet.md §5.3-§5.5, §7, §8): pure
// frontend logic with mocked canisters, no PocketIC. Every money-moving decision is covered:
//   - UTXO selection, vsize/fee math, the change/dust rule (checked against a model of the
//     Chain Fusion Signer's own builder, tx_utils.rs), max/sweep, coin control;
//   - expectedTxid against real mainnet transactions of the signer's shape (golden vectors,
//     read from mempool.space 2026-10-23, blocks 900000-900002);
//   - fee-rate source (mempool.space) bounds and privacy of the request, custom rates;
//   - signing credit: signer cost table (methods.rs), allowance math (cycles-ledger
//     withdraw_from = amount + fee), the exact approve, revoke;
//   - the send call (request shape, CallerPaysIcrc2Cycles, record written before the call),
//     outcomes, error texts, recovery decisions, re-issue, the address check;
//   - ICP → cycles-ledger mint (CMC notify_mint_cycles) through utils/cyclesTopUp.js;
//   - history v1 and the signer IDL.
import { describe, it, expect, beforeEach } from 'vitest';
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';
import {
    txVsize, feeFor, spendable, planSend, planShown, parseBtcAmount, satsToBtcText, CHANGE_MIN_SATS, MIN_SEND_SATS,
} from '../../../src/app_sneeddao_frontend/src/utils/btc/select.js';
import { computeTxid, expectedTxid, scriptPubKey, txidToInternal, serializeNonWitness } from '../../../src/app_sneeddao_frontend/src/utils/btc/txid.js';
import {
    parseRecommended, validateCustomRate, feeNeedsExtraConfirm, fetchFeeRates, clearFeeCache, feeLookupDisabled, setFeeLookupDisabled, MEMPOOL_API,
} from '../../../src/app_sneeddao_frontend/src/utils/btc/fees.js';
import {
    sendCycles, creditPlan, approveArgs, revokeArgs, approveSigner, revokeSigner, readCredit, sendsAffordable, cyclesForIcp, icpForCycles, formatCycles,
    CYCLES_LEDGER_FEE, ADDRESS_CYCLES, APPROVAL_TTL_NS, TYPICAL_SEND_CYCLES,
} from '../../../src/app_sneeddao_frontend/src/utils/btc/credit.js';
import {
    loadRecords, saveRecords, lockedOutpoints, newRecord, updateRecord, reconcile, reconcileAll, canReissue, storeKey, REISSUE_AFTER_MS, DROP_AFTER_MS,
} from '../../../src/app_sneeddao_frontend/src/utils/btc/pending.js';
import {
    buildSendRequest, executeSend, reissueSend, makeStore, verifySignerAddress, isAddressVerified, PAY_WITH_CYCLES, requestFromRecord,
} from '../../../src/app_sneeddao_frontend/src/utils/btc/send.js';
import { sendErrorInfo, addressErrorText } from '../../../src/app_sneeddao_frontend/src/utils/btc/errors.js';
import { mergeReceives, buildHistory, ownTxids, checkTxOnMempool } from '../../../src/app_sneeddao_frontend/src/utils/btc/history.js';
import { signerIdl } from '../../../src/app_sneeddao_frontend/src/utils/btc/signerIdl.js';
import { deriveBtcAddress } from '../../../src/app_sneeddao_frontend/src/utils/btc/address.js';
import { outpointKey } from '../../../src/app_sneeddao_frontend/src/utils/btc/utxos.js';
import { mintCyclesWithIcp, finishPendingTopUp, getPendingTopUp, mintKey, MINT_MEMO, CMC_CANISTER_ID_TEXT } from '../../../src/app_sneeddao_frontend/src/utils/cyclesTopUp.js';

const B = 1_000_000_000n;
const ME = Principal.selfAuthenticating(new TextEncoder().encode('sneed wallet send test')).toText();
const OWN = deriveBtcAddress(ME, 'testnet').address;
const OTHER = deriveBtcAddress(Principal.selfAuthenticating(new Uint8Array(32).fill(7)).toText(), 'testnet').address;
const hex64 = (n) => n.toString(16).padStart(64, '0');
const utxo = (n, value, confirmations = 3, height = 100) => ({ txid: hex64(n), vout: n % 3, value: BigInt(value), height, confirmations });

function memStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
const brokenStorage = () => ({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} });

/// What the signer's build_p2wpkh_transaction does with a request: outputs as given, then change
/// when the remainder is ≥ 1,000 sats (tx_utils.rs DUST_THRESHOLD), or NotEnoughFunds.
function signerBuild({ inputs, outputs, fee }) {
    const total = inputs.reduce((t, u) => t + BigInt(u.value), 0n);
    const sent = outputs.reduce((t, o) => t + BigInt(o.value), 0n);
    const remaining = total - sent - BigInt(fee);
    if (remaining < 0n) return { err: 'NotEnoughFunds' };
    return { change: remaining >= 1000n ? remaining : 0n, effectiveFee: remaining >= 1000n ? BigInt(fee) : BigInt(fee) + remaining };
}

// ------------------------------------------------------------------ selection and fee math

describe('vsize and fee math (spec §5.3 step 2)', () => {
    it('uses 11 + 68·inputs + output sizes by type', () => {
        expect(txVsize(1, ['p2wpkh', 'p2wpkh'])).toBe(141); // the spec's "1 input → 1 + change ≈ 141 vB"
        expect(txVsize(2, ['p2wpkh', 'p2wpkh'])).toBe(209);
        expect(txVsize(1, ['p2pkh'])).toBe(113);
        expect(txVsize(1, ['p2sh'])).toBe(111);
        expect(txVsize(1, ['p2wsh'])).toBe(122);
        expect(txVsize(1, ['p2tr'])).toBe(122);
        expect(() => txVsize(1, ['op_return'])).toThrow();
    });
    it('rounds the fee up, also for fractional rates', () => {
        expect(feeFor(141, 1)).toBe(141n);
        expect(feeFor(141, 2.5)).toBe(353n); // 352.5 → 353
        expect(feeFor(141, 0.1)).toBe(15n); // 14.1 → 15
        expect(() => feeFor(141, 0)).toThrow();
        expect(() => feeFor(141, NaN)).toThrow();
    });
});

describe('spendable coins', () => {
    it('drops unconfirmed and locked coins and sorts largest first, deterministically', () => {
        const us = [utxo(1, 5000), utxo(2, 9000), utxo(3, 9000, 10), utxo(4, 50_000, 0), utxo(5, 7000)];
        const locked = new Set([outpointKey(us[4])]);
        const s = spendable(us, { locked });
        expect(s.map((u) => u.txid)).toEqual([hex64(3), hex64(2), hex64(1)]);
    });
});

describe('planSend', () => {
    const rate = 2;
    it('picks the largest coin first and returns change ≥ 1,000 sats', () => {
        const us = [utxo(1, 20_000), utxo(2, 100_000), utxo(3, 30_000)];
        const p = planSend({ utxos: us, amount: 50_000n, feeRate: rate, destType: 'p2wpkh' });
        expect(p.ok).toBe(true);
        expect(p.inputs.map((u) => u.value)).toEqual([100_000n]);
        expect(p.vsize).toBe(141);
        expect(p.fee).toBe(282n);
        expect(p.change).toBe(100_000n - 50_000n - 282n);
        expect(p.hasChange).toBe(true);
        expect(p.dustToFee).toBe(0n);
    });

    it('adds coins until amount + fee fits, and needs fewer coins when it can', () => {
        const us = [utxo(1, 40_000), utxo(2, 30_000), utxo(3, 20_000), utxo(4, 10_000)];
        const p = planSend({ utxos: us, amount: 65_000n, feeRate: rate, destType: 'p2wpkh' });
        expect(p.inputs.map((u) => u.value)).toEqual([40_000n, 30_000n]);
        expect(p.fee).toBe(feeFor(txVsize(2, ['p2wpkh', 'p2wpkh']), rate));
    });

    it('turns a remainder below 1,000 sats into fee and says how much (the signer would anyway)', () => {
        // 10,000 in; 8,500 out at 2 sat/vB: with change the fee is 282 → change 1,218 ≥ 1,000 → change
        // 8,800 out: with change 282 → 918 < 1,000; without change fee 220 → remainder 980 → all fee
        const us = [utxo(1, 10_000)];
        const p = planSend({ utxos: us, amount: 8_800n, feeRate: rate, destType: 'p2wpkh' });
        expect(p.ok).toBe(true);
        expect(p.change).toBe(0n);
        expect(p.estimatedFee).toBe(220n);
        expect(p.fee).toBe(1_200n);
        expect(p.dustToFee).toBe(980n);
        expect(p.amount + p.fee).toBe(10_000n);
    });

    it('always agrees with the signer: no surprise change, no surprise fee (property check)', () => {
        let seed = 42;
        const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
        for (let i = 0; i < 2000; i++) {
            const us = Array.from({ length: 1 + rnd(6) }, (_, j) => utxo(j + 1, 1000 + rnd(200_000)));
            const r = 1 + rnd(50) / 10;
            const destType = ['p2wpkh', 'p2pkh', 'p2sh', 'p2wsh', 'p2tr'][rnd(5)];
            const max = rnd(5) === 0;
            const p = planSend({ utxos: us, amount: max ? null : BigInt(1000 + rnd(300_000)), max, feeRate: r, destType });
            if (!p.ok) continue;
            const built = signerBuild({ inputs: p.inputs, outputs: [{ value: p.amount }], fee: p.fee });
            expect(built.err).toBeUndefined();
            expect(built.change).toBe(p.change); // the change the signer makes is exactly ours
            expect(built.effectiveFee).toBe(p.fee); // nothing silently added to the fee
            // the real rate is never below the chosen one
            expect(Number(p.fee) / p.vsize).toBeGreaterThanOrEqual(r - 1e-9);
            if (p.change > 0n) expect(p.change >= CHANGE_MIN_SATS).toBe(true);
            expect(p.amount >= MIN_SEND_SATS).toBe(true);
        }
    });

    it('Max sweeps every spendable coin with no change', () => {
        const us = [utxo(1, 20_000), utxo(2, 30_000), utxo(3, 999_999, 0)];
        const p = planSend({ utxos: us, max: true, feeRate: 3, destType: 'p2tr' });
        expect(p.inputs.length).toBe(2);
        expect(p.change).toBe(0n);
        expect(p.fee).toBe(feeFor(txVsize(2, ['p2tr']), 3));
        expect(p.amount).toBe(50_000n - p.fee);
    });

    it('refuses too-small amounts, an empty wallet, a bad rate and shortfalls with numbers', () => {
        const us = [utxo(1, 5_000)];
        expect(planSend({ utxos: us, amount: 999n, feeRate: 1, destType: 'p2wpkh' }).code).toBe('below_min');
        expect(planSend({ utxos: [], amount: 5_000n, feeRate: 1, destType: 'p2wpkh' }).code).toBe('no_funds');
        expect(planSend({ utxos: us, amount: 2_000n, feeRate: 0, destType: 'p2wpkh' }).code).toBe('bad_rate');
        const s = planSend({ utxos: us, amount: 4_950n, feeRate: 1, destType: 'p2wpkh' });
        expect(s.code).toBe('insufficient');
        expect(s.available).toBe(5_000n);
        expect(s.needed).toBe(4_950n + 110n);
        expect(planSend({ utxos: [utxo(1, 1_100)], max: true, feeRate: 2, destType: 'p2wpkh' }).code).toBe('max_too_small');
    });

    it('never spends a coin locked by a pending send, even through coin control', () => {
        const us = [utxo(1, 50_000), utxo(2, 40_000)];
        const locked = new Set([outpointKey(us[0])]);
        const p = planSend({ utxos: us, locked, amount: 10_000n, feeRate: 1, destType: 'p2wpkh' });
        expect(p.inputs.map(outpointKey)).toEqual([outpointKey(us[1])]);
        expect(planSend({ utxos: us, locked, amount: 10_000n, feeRate: 1, destType: 'p2wpkh', inputs: [us[0]] }).code).toBe('locked_input');
    });

    it('coin control spends exactly the chosen coins', () => {
        const us = [utxo(1, 50_000), utxo(2, 40_000), utxo(3, 30_000)];
        const p = planSend({ utxos: us, amount: 10_000n, feeRate: 1, destType: 'p2wpkh', inputs: [us[2], us[1]] });
        expect(p.inputs.map((u) => u.value)).toEqual([40_000n, 30_000n]);
    });
});

describe('amount parsing', () => {
    it('reads BTC with up to 8 decimals', () => {
        expect(parseBtcAmount('0.001')).toEqual({ ok: true, sats: 100_000n });
        expect(parseBtcAmount('1')).toEqual({ ok: true, sats: 100_000_000n });
        expect(parseBtcAmount('.5').sats).toBe(50_000_000n);
        expect(parseBtcAmount('0.000000001').ok).toBe(false);
        expect(parseBtcAmount('abc').ok).toBe(false);
        expect(parseBtcAmount('0').ok).toBe(false);
        expect(satsToBtcText(123_456_789n)).toBe('1.23456789');
        expect(satsToBtcText(100_000_000n)).toBe('1');
    });
});

// ------------------------------------------------------------------ expected txid

// Real mainnet transactions spending only P2WPKH inputs (mempool.space, blocks 900000-900002):
// [txid, version, locktime, sequence, inputs [txid, vout, value], outputs [address, value, script]]
const VECTORS = [
    {
        txid: 'b45991a21a1118300d3dd9f567eab2a8972bd99c7ec14e12cc1472c1d9865dbd', version: 2, locktime: 0, sequence: 4294967295,
        inputs: [['3642276751a522911bbd7c1dd45760a8ef01c9b8c2e2e82a424be04de7a21a98', 1, 8460], ['d886243a553aafbab5ac7754459047d4eddbf85f41cf2cf350d0662a68c34b04', 2, 3312]],
        outputs: [['bc1qggrvcdv95frry88l2yvp2vy20ah7a8v4wcsvwe', 8000, '00144206cc3585a246321cff511815308a7f6fee9d95'], ['bc1qu0lmw6fc9f75zjek4gfum5q8cf8vnh8xzdkta8', 2936, '0014e3ffb769382a7d414b36aa13cdd007c24ec9dce6']],
    },
    {
        txid: '28af2bbdd1d61b80acf9cd550a7f56f03540f90cf0d97e7326fb7dafc1623ab4', version: 2, locktime: 0, sequence: 4294967295,
        inputs: [['200fa596cd2477934296d81269581ac22b0cc123039015892e6ff6e7e0b68bf3', 2, 10153713], ['8901d1d42b95cce422bf29126a7f51447d4033572bc759fd3c83db668c269b07', 17, 3151793], ['e5505487704aa3c11ce8044b8d813370f643f5d1205c700c8f3d7a5236c306c0', 37, 1942451], ['be8cae661a41cc223d3f520b686ae4130a3a9e0c5abe1b6bb3d21c4d06e002e0', 4, 1063600], ['38d1e511419996409423ea558d8b2c3f581a3344295c253cf647f148cff00e30', 19, 1194168], ['48f856144ae7444a2c5bdbd346b6b2fad7a64984c6d9800e6be2c2e188401af6', 2, 11563], ['07ddaf9e148d22c11711a0c6bf4b6241ed30d2457250f5869de0bc1769fc3282', 34, 10000000], ['f0e51509b49ce617a326ffb591f6df0b5a77a82deb1d6214289423a1803db56b', 6, 65835], ['e4109fd0076279cfc83f55199b1d5917dfb284754f1f5efc26ec547274e951ac', 3, 11226667], ['56117567180c13132320e0095959059221a30460f84f54a545b61b3dc4b50be2', 14, 1573553], ['5e1400773ed4007a9329215e348f29ee0fd63cf9e28e44b3bbee98b3f153e007', 1, 16374]],
        outputs: [['3GMx8tuwj338wdmuzL1d9pLuyPCTe7WuhS', 40396553, 'a914a0eed27d796d128cf2221fe4f63b5bcb25f019a887']],
    },
    {
        txid: '4d24489f4ca608eaf82ca38cf9643f8ecf6cfbd90455180213fafdc9b3bcc7f6', version: 2, locktime: 0, sequence: 4294967295,
        inputs: [['fca3fe7a963862c44b4399287db154251fbdcfbdb03a809f4d9dfa03adf2e110', 1, 64661189]],
        outputs: [['1BsV7yrNQQtXsT3U6vz3Kf2zvcdMgxWZjw', 8482, '76a914773d8794a2c32d14283b8d5c7a7f3b6c6117b20088ac'], ['bc1q2z0sujksq98gdcch88jre7zdhhup8ycjjhu7pl', 64652191, '0014509f0e4ad0014e86e31739e43cf84dbdf8139312']],
    },
    {
        txid: '02a8ee66a741a06ef1734a439e50b74447cd217ca7317fc8daca7ee8078d6a1b', version: 1, locktime: 0, sequence: 4294967295,
        inputs: [['3254a7738f7bb8375c1e249bc1164a7b25f4c91a87208be16acbd3a2897aeb4a', 1, 649121366]],
        outputs: [['1Gn2CvQiiKRsgU9u364sffhTc3DsCtMK2Z', 142186, '76a914ad0d9c8261543bafd6de7430854d5575b6ef8bf188ac'], ['bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h', 26573908, '0014dc6bf86354105de2fcd9868a2b0376d6731cb92f'], ['bc1pzzvwst76ss382ng379l39wrgu3z4uqx5hmncpzlz96r6fzn05zmsrytj38', 2405588, '51201098e82fda8422754d11f17f12b868e4455e00d4bee7808be22e87a48a6fa0b7'], ['3KcipYvVV5RjcoCDMu263Ad3Zy25b2qJNo', 261218, 'a914c4a252b88ad1522b1cd93e58a9957c317a414a6e87'], ['bc1q6mt2zv34xg8njq9mxun35kc0df0n6sc6k3m8w7', 7296000, '0014d6d6a13235320f3900bb37271a5b0f6a5f3d431a'], ['37hryBD1qqnVhbVDJLgo6fwxgc97qAcJJp', 76486, 'a91441f9b21bed2d26dcca38b53a45d2a30ca28ba7ef87'], ['bc1qjpjac6dhk46qcs4v23trjghdq0tr8h97j5mhn0', 28000, '00149065dc69b7b5740c42ac54563922ed03d633dcbe'], ['3CrQDnz7PhGMgTyUMwwFBaZYLfeqzLL48s', 3421534, 'a9147a6fbd7f0dc625e730de34ca0798b339ea53bd5d87'], ['bc1qhwjt8pmpael2h4d77uls6tq9rpxewcwl98p5ya', 16979, '0014bba4b38761ee7eabd5bef73f0d2c05184d9761df'], ['1F8smVCmzeB4o1Pbwg3JuqWVVZYkVLoUjq', 54351, '76a9149b0f0d0597cde9d9d592ae7adab6255f0ae133cb88ac'], ['3MsKwJp8smFSat9cxTbUYqwXL1dJoDvCfd', 608313356, 'a914dd55b64160f3ec0d2a82af28d76524d368c124d587'], ['bc1q6p44qlhfza6pxugmw77zu5tdulpr9wlea7sqvq', 24000, '0014d06b507ee9177413711b77bc2e516de7c232bbf9'], ['3KqyYWNhyDaXvSMdLnYDa4sCWMW71wun37', 502710, 'a914c724056634022d555be6dc8328259442747fdeb587']],
    },
    {
        txid: '64d2a1d272a7b9af75e84251e96306db8a13fca6ca532ec3d4da36faaf10886a', version: 2, locktime: 0, sequence: 4294967295,
        inputs: [['48877a9f4023dc0c1454ce2c87cba9436595c639a75b9ddb9c0753d92ecaa6ba', 1, 148452]],
        outputs: [['bc1qe4wuvxm2sscqpuq80s0dhzzkcxjznpcl7wt0ns3j67l95mn9lqhqwfveg3', 8703, '0020cd5dc61b6a843000f0077c1edb8856c1a429871ff396f9c232d7be5a6e65f82e'], ['bc1qw7tfxals8rv7twau0y22ymls0kre6rw0e37n7a', 138643, '001477969377f038d9e5bbbc7914a26ff07d879d0dcf']],
    },
    {
        txid: '643f88a142d2603e1bf9dc8bdb19499fb648219041a1b206e7d0d6c01c327f14', version: 2, locktime: 0, sequence: 4294967293,
        inputs: [['352f8aec94934191e0f9455b078c472699699f62c6ba8b97fe67dcbe4da9cef9', 0, 1040400]],
        outputs: [['bc1pm49gntjnran8tdvaaf5y2dtxfhn7zx47xuftvkvlaa38qghfudfq8mpq7p', 547, '5120dd4a89ae531f6675b59dea684535664de7e11abe3712b6599fef627022e9e352'], ['bc1qqqlhxarpd4cr57ezwq3r5gnnwf3j6v3sygkzymmsygazyarjv9hq6a5ted', 330, '0020003f7374616d703a7b2270223a227372632d3230222c226f70223a227472616e'], ['bc1qwdnx2u3z9s38g6trdv3r5gjzf4t5kg3vyfsk6apz8genqvpsxqcqlmc99q', 330, '002073666572222c227469636b223a22424d574b222c22616d74223a333030303030'], ['bc1q05qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqdr9xvt', 330, '00207d00000000000000000000000000000000000000000000000000000000000000'], ['bc1qrd4a0ujts8vuadhc6k95u7ju4h77y28wy04ssm', 997097, '00141b6bd7f24b81d9ceb6f8d58b4e7a5cadfde228ee'], ['bc1qlh7pfsrhn7sjp87pk5886s3jryjcyr7gdn2ezq', 40800, '0014fdfc14c0779fa1209fc1b50e7d42321925820fc8']],
    },
];

describe('expectedTxid (non-witness serialisation) against real transactions', () => {
    it('reproduces every txid, for every output type (P2PKH, P2SH, P2WPKH, P2WSH, P2TR)', () => {
        const types = new Set();
        for (const v of VECTORS) {
            const outputs = v.outputs.map(([address, value, script]) => {
                const s = scriptPubKey(address, 'mainnet');
                expect(Buffer.from(s).toString('hex'), address).toBe(script);
                types.add(script.slice(0, 4));
                return { script: s, value };
            });
            const inputs = v.inputs.map(([txid, vout]) => ({ txid, vout }));
            expect(computeTxid({ inputs, outputs, version: v.version, locktime: v.locktime, sequence: v.sequence })).toBe(v.txid);
        }
        expect(types.size).toBeGreaterThanOrEqual(5);
    });

    it("computes the signer's txid (v2, locktime 0, nSequence 0xFFFFFFFF, change last) before signing", () => {
        const signerShaped = VECTORS.filter((v) => v.version === 2 && v.locktime === 0 && v.sequence === 0xffffffff && v.outputs.length === 2);
        expect(signerShaped.length).toBeGreaterThanOrEqual(3);
        for (const v of signerShaped) {
            const [own, change] = v.outputs[1];
            const r = expectedTxid({
                inputs: v.inputs.map(([txid, vout]) => ({ txid, vout })),
                outputs: [{ address: v.outputs[0][0], value: v.outputs[0][1] }],
                change: BigInt(change), ownAddress: own, network: 'mainnet',
            });
            expect(r).toEqual({ txid: v.txid, changeVout: 1 });
        }
        const one = VECTORS.find((v) => v.txid.startsWith('28af2bbd')); // 11 inputs, 1 output, no change
        expect(expectedTxid({ inputs: one.inputs.map(([txid, vout]) => ({ txid, vout })), outputs: [{ address: one.outputs[0][0], value: one.outputs[0][1] }], change: 0n, ownAddress: 'unused', network: 'mainnet' }).txid).toBe(one.txid);
    });

    it('builds testnet scripts and refuses wrong-network or invalid addresses', () => {
        expect(scriptPubKey(OWN, 'testnet')[0]).toBe(0);
        expect(scriptPubKey(OWN, 'testnet').length).toBe(22);
        expect(() => scriptPubKey(OWN, 'mainnet')).toThrow();
        expect(() => scriptPubKey('bc1qwug6tj9z7tgvsp4u8sfzvjzatzs9rmwwck6qky', 'testnet')).toThrow();
        expect(() => scriptPubKey('tb1qnotanaddress', 'testnet')).toThrow();
    });

    it('serialises the txid in internal byte order', () => {
        const t = hex64(1);
        expect(Array.from(txidToInternal(t))[0]).toBe(1);
        const ser = serializeNonWitness({ inputs: [{ txid: t, vout: 0 }], outputs: [] });
        expect(Array.from(ser.slice(0, 4))).toEqual([2, 0, 0, 0]);
        expect(ser[5]).toBe(1); // first byte of the reversed txid
    });
});

// ------------------------------------------------------------------ fee rates

describe('fee rates from mempool.space (Q4)', () => {
    beforeEach(() => clearFeeCache());

    it('maps tiers, raises to 1 sat/vB and keeps them monotone', () => {
        expect(parseRecommended({ fastestFee: 12, halfHourFee: 8, hourFee: 5, economyFee: 3, minimumFee: 1 })).toEqual({ ok: true, tiers: { slow: 5, normal: 8, fast: 12 }, minimum: 1 });
        expect(parseRecommended({ fastestFee: 3, halfHourFee: 4, hourFee: 0.5, economyFee: 0.2, minimumFee: 0.1 }).tiers).toEqual({ slow: 1, normal: 4, fast: 4 });
    });

    it('refuses implausible or broken answers', () => {
        expect(parseRecommended(null).ok).toBe(false);
        expect(parseRecommended({ fastestFee: 'x', halfHourFee: 1, hourFee: 1, minimumFee: 1 }).ok).toBe(false);
        expect(parseRecommended({ fastestFee: 5000, halfHourFee: 1, hourFee: 1, minimumFee: 1 }).ok).toBe(false);
        expect(parseRecommended({ fastestFee: -1, halfHourFee: 1, hourFee: 1, minimumFee: 1 }).ok).toBe(false);
    });

    it('asks only the generic endpoint, without credentials or referrer, and caches', async () => {
        const calls = [];
        const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ fastestFee: 3, halfHourFee: 2, hourFee: 1, economyFee: 1, minimumFee: 1 }) }; };
        const r = await fetchFeeRates('testnet', { fetchImpl });
        expect(r.ok).toBe(true);
        expect(calls[0].url).toBe('https://mempool.space/testnet4/api/v1/fees/recommended');
        expect(calls[0].opts).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
        await fetchFeeRates('testnet', { fetchImpl });
        expect(calls.length).toBe(1);
        expect(MEMPOOL_API.mainnet).toBe('https://mempool.space/api');
    });

    it('reports failures instead of guessing a fee', async () => {
        expect((await fetchFeeRates('testnet', { fetchImpl: async () => { throw new Error('offline'); } })).ok).toBe(false);
        expect((await fetchFeeRates('testnet', { fetchImpl: async () => ({ ok: false, status: 503 }) })).ok).toBe(false);
        expect((await fetchFeeRates('regtest', { fetchImpl: async () => ({}) })).ok).toBe(false);
    });

    it('custom rates: refuse nonsense, warn on unusual but valid values', () => {
        const tiers = { slow: 2, normal: 4, fast: 6 };
        expect(validateCustomRate('', tiers).ok).toBe(false);
        expect(validateCustomRate('abc', tiers).ok).toBe(false);
        expect(validateCustomRate('0', tiers).ok).toBe(false);
        expect(validateCustomRate('20000', tiers).ok).toBe(false);
        expect(validateCustomRate('5', tiers)).toEqual({ ok: true, rate: 5, warn: null });
        const low = validateCustomRate('0.5', tiers);
        expect(low.ok).toBe(true);
        expect(low.warn).toMatch(/relay/);
        expect(validateCustomRate('25', tiers).warn).toMatch(/3×/);
        expect(validateCustomRate('600').warn).toMatch(/very high/);
    });

    it('fat-finger guard: fee above 10% of the amount or rate above 3× fast', () => {
        expect(feeNeedsExtraConfirm({ fee: 100n, amount: 10_000n, feeRate: 2, tiers: { fast: 5 } })).toEqual([]);
        expect(feeNeedsExtraConfirm({ fee: 1_001n, amount: 10_000n, feeRate: 2, tiers: { fast: 5 } }).length).toBe(1);
        expect(feeNeedsExtraConfirm({ fee: 100n, amount: 10_000n, feeRate: 16, tiers: { fast: 5 } }).length).toBe(1);
    });

    it('"Don\'t look up fees" is remembered and survives blocked storage', () => {
        const s = memStorage();
        expect(feeLookupDisabled(s)).toBe(false);
        setFeeLookupDisabled(true, s);
        expect(feeLookupDisabled(s)).toBe(true);
        setFeeLookupDisabled(false, s);
        expect(feeLookupDisabled(s)).toBe(false);
        expect(feeLookupDisabled(brokenStorage())).toBe(false);
        expect(() => setFeeLookupDisabled(true, brokenStorage())).not.toThrow();
    });
});

// ------------------------------------------------------------------ signing credit

describe('signing credit (cycles ledger + Chain Fusion Signer)', () => {
    const NOW = 1_800_000_000_000_000_000n;

    it("prices sends like the signer's methods.rs (outputs + 1 always)", () => {
        expect(sendCycles(1, 1)).toBe(134n * B); // the spec's 1 input → 1 + change
        expect(sendCycles(2, 1)).toBe(171n * B); // the signer's grace default (2 in, 2 out)
        expect(sendCycles(3, 1)).toBe(208n * B);
        expect(sendCycles(1, 2)).toBe(135n * B);
        expect(TYPICAL_SEND_CYCLES).toBe(134n * B);
        expect(ADDRESS_CYCLES).toBe(79_000_000n);
    });

    it('needs charge + 0.1B allowance per call, plus 0.1B balance for a new approve', () => {
        const p = creditPlan({ balance: 500n * B, allowance: { allowance: 0n, expiresAt: null }, charges: [134n * B, ADDRESS_CYCLES], nowNs: NOW });
        expect(p.allowanceNeeded).toBe(134n * B + ADDRESS_CYCLES + 2n * CYCLES_LEDGER_FEE);
        expect(p.approveNeeded).toBe(true);
        expect(p.balanceNeeded).toBe(p.allowanceNeeded + CYCLES_LEDGER_FEE);
        expect(p.shortfall).toBe(0n);
        expect(p.totalCycles).toBe(134n * B + ADDRESS_CYCLES + 3n * CYCLES_LEDGER_FEE);
    });

    it('reuses a big-enough allowance that is not about to expire; renews one that is', () => {
        const need = 134n * B + CYCLES_LEDGER_FEE;
        expect(creditPlan({ balance: need, allowance: { allowance: need, expiresAt: NOW + APPROVAL_TTL_NS }, charges: [134n * B], nowNs: NOW }).approveNeeded).toBe(false);
        expect(creditPlan({ balance: need, allowance: { allowance: need, expiresAt: NOW + 60n * 1_000_000_000n }, charges: [134n * B], nowNs: NOW }).approveNeeded).toBe(true);
        expect(creditPlan({ balance: need, allowance: { allowance: need - 1n, expiresAt: null }, charges: [134n * B], nowNs: NOW }).approveNeeded).toBe(true);
    });

    it('reports the shortfall when the balance is too low', () => {
        const p = creditPlan({ balance: 100n * B, charges: [134n * B], nowNs: NOW });
        expect(p.shortfall).toBe(134n * B + 2n * CYCLES_LEDGER_FEE - 100n * B);
    });

    it('approves exactly the needed amount for the signer, for one hour, guarded by the old allowance', () => {
        const a = approveArgs({ amount: 134_100_000_000n, nowNs: NOW, expected: 5n });
        expect(a.spender.owner.toText()).toBe('grghe-syaaa-aaaar-qabyq-cai');
        expect(a.spender.subaccount).toEqual([]);
        expect(a.amount).toBe(134_100_000_000n);
        expect(a.expires_at).toEqual([NOW + 3_600n * 1_000_000_000n]);
        expect(a.expected_allowance).toEqual([5n]);
        expect(a.fee).toEqual([CYCLES_LEDGER_FEE]);
        expect(a.from_subaccount).toEqual([]);
        const r = revokeArgs({ nowNs: NOW });
        expect(r.amount).toBe(0n);
        expect(r.spender.owner.toText()).toBe('grghe-syaaa-aaaar-qabyq-cai');
    });

    it('approve / revoke / read through a mocked cycles ledger', async () => {
        const calls = [];
        const ledger = {
            async icrc2_approve(a) { calls.push(a); return calls.length === 1 ? { Ok: 7n } : calls.length === 2 ? { Err: { Duplicate: { duplicate_of: 7n } } } : { Err: { InsufficientFunds: { balance: 1n } } }; },
            async icrc1_balance_of() { return 300n * B; },
            async icrc2_allowance() { return { allowance: 5n, expires_at: [NOW] }; },
        };
        expect(await approveSigner(ledger, { amount: 1n, nowNs: NOW })).toEqual({ ok: true, block: 7n });
        expect(await approveSigner(ledger, { amount: 1n, nowNs: NOW })).toEqual({ ok: true, block: 7n });
        const bad = await revokeSigner(ledger, { nowNs: NOW });
        expect(bad.ok).toBe(false);
        expect(bad.error).toMatch(/Not enough signing credit/);
        expect(await readCredit(ledger, ME)).toEqual({ balance: 300n * B, allowance: 5n, expiresAt: NOW });
    });

    it('converts ICP and cycles at the CMC rate, rounding ICP up', () => {
        // 1 ICP at 4.5 XDR/ICP (45,000 permyriad) = 4.5T cycles
        expect(cyclesForIcp(100_000_000n, 45_000n)).toBe(4_500_000_000_000n);
        expect(icpForCycles(134n * B, 45_000n)).toBe(2_977_778n);
        expect(cyclesForIcp(icpForCycles(134n * B, 45_000n), 45_000n) >= 134n * B).toBe(true);
        expect(sendsAffordable(0n)).toBe(0);
        expect(sendsAffordable(1_000n * B)).toBe(7);
        expect(formatCycles(134n * B)).toBe('134B');
        expect(formatCycles(130n * B)).toBe('130B');
        expect(formatCycles(1_250n * B)).toBe('1.25T');
        expect(formatCycles(79_000_000n)).toBe('79M');
    });
});

// ------------------------------------------------------------------ pending store and recovery

describe('pending store (localStorage for now)', () => {
    const key = storeKey('testnet', ME);
    it('blocks sends when storage is unreadable', () => {
        expect(loadRecords(brokenStorage(), key).ok).toBe(false);
        expect(loadRecords(null, key).ok).toBe(false);
        const s = memStorage();
        s.setItem(key, '{"not":"a list"}');
        expect(loadRecords(s, key).ok).toBe(false);
        expect(saveRecords(brokenStorage(), key, [])).toBe(false);
        expect(loadRecords(memStorage(), key)).toEqual({ ok: true, records: [] });
    });

    it('locks the inputs of submitting, broadcast and unknown sends only', () => {
        const rec = (id, state, n) => ({ id, state, request: { inputs: [{ txid: hex64(n), vout: 0 }] } });
        const l = lockedOutpoints(['submitting', 'broadcast', 'unknown', 'confirmed', 'failed', 'replaced', 'dropped'].map((s, i) => rec(String(i), s, i + 1)));
        expect([...l].sort()).toEqual([1, 2, 3].map((n) => `${hex64(n)}:0`));
    });
});

function makeRecord(over = {}) {
    const plan = planSend({ utxos: [utxo(1, 100_000), utxo(2, 2_000)], amount: 50_000n, feeRate: 2, destType: 'p2wpkh' });
    const outputs = [{ address: OTHER, value: plan.amount }];
    const expected = expectedTxid({ inputs: plan.inputs, outputs, change: plan.change, ownAddress: OWN, network: 'testnet' });
    return { ...newRecord({ id: 'r1', network: 'testnet', plan, outputs, ownAddress: OWN, expected, signingCycles: sendCycles(1, 1), now: 1000 }), ...over };
}

describe('recovery decisions (spec §8)', () => {
    const T0 = 1000;
    const keysWith = (r, extra = []) => new Set([...r.request.inputs.map(outpointKey), ...extra]);

    it('inputs gone: confirmed (by the change output when there is one)', () => {
        const r = makeRecord({ state: 'broadcast' });
        expect(reconcile(r, { utxoKeys: new Set([`${r.expectedTxid}:${r.changeVout}`]), now: T0 }).state).toBe('confirmed');
        expect(reconcile(r, { utxoKeys: new Set(), now: T0 }).state).toBe('confirmed');
    });

    it('some inputs gone, some not: replaced (it can never confirm)', () => {
        const r = makeRecord({ state: 'unknown' });
        r.request.inputs.push({ txid: hex64(9), vout: 0, value: '5000', height: 1 });
        expect(reconcile(r, { utxoKeys: new Set([`${hex64(9)}:0`]), now: T0 }).state).toBe('replaced');
    });

    it('a record left in submitting (page closed mid-call) becomes unknown, never failed', () => {
        const r = makeRecord();
        expect(r.state).toBe('submitting');
        expect(reconcile(r, { utxoKeys: keysWith(r), now: T0 + 1 }).state).toBe('unknown');
    });

    it('unknown: wait 30 minutes, then offer the identical re-issue; mempool sightings count', () => {
        const r = makeRecord({ state: 'unknown', lastAttemptAt: T0 });
        expect(reconcile(r, { utxoKeys: keysWith(r), now: T0 + REISSUE_AFTER_MS - 1 }).action).toBe('wait');
        expect(reconcile(r, { utxoKeys: keysWith(r), now: T0 + REISSUE_AFTER_MS }).action).toBe('offer_reissue');
        expect(reconcile(r, { utxoKeys: keysWith(r), now: T0 + REISSUE_AFTER_MS, mempool: { seen: true } })).toMatchObject({ state: 'broadcast', action: 'wait' });
        expect(canReissue(r, keysWith(r))).toBe(true);
        expect(canReissue(r, new Set())).toBe(false);
        expect(canReissue({ ...r, state: 'broadcast' }, keysWith(r))).toBe(false);
    });

    it('broadcast but unmined for 14 days: offer to mark dropped', () => {
        const r = makeRecord({ state: 'broadcast', broadcastAt: T0 });
        expect(reconcile(r, { utxoKeys: keysWith(r), now: T0 + DROP_AFTER_MS - 1 }).action).toBe('wait');
        expect(reconcile(r, { utxoKeys: keysWith(r), now: T0 + DROP_AFTER_MS }).action).toBe('offer_drop');
    });

    it('final states stay final; reconcileAll skips calls still running in this page', () => {
        for (const s of ['confirmed', 'failed', 'replaced', 'dropped']) expect(reconcile(makeRecord({ state: s }), { utxoKeys: new Set(), now: T0 }).state).toBe(s);
        const r = makeRecord();
        expect(reconcileAll([r], { utxoKeys: keysWith(r), now: T0, inFlight: new Set(['r1']) }).changed).toBe(false);
        const out = reconcileAll([r], { utxoKeys: keysWith(r), now: T0 });
        expect(out.records[0].state).toBe('unknown');
        expect(out.records[0].log.at(-1).event).toBe('-> unknown');
    });
});

// ------------------------------------------------------------------ the send call

describe('btc_caller_send request and outcomes', () => {
    const plan = planSend({ utxos: [utxo(1, 100_000, 3, 4321)], amount: 40_000n, feeRate: 3, destType: 'p2wpkh' });
    const base = () => {
        const storage = memStorage();
        return { storage, store: makeStore(storage, storeKey('testnet', ME)) };
    };

    it('builds the exact candid request: chosen coins (internal txid order), explicit fee, testnet', () => {
        const req = buildSendRequest({ inputs: plan.inputs, outputs: [{ address: OTHER, value: plan.amount }], fee: plan.fee, network: 'testnet' });
        expect(req.fee_satoshis).toEqual([plan.fee]);
        expect(req.network).toEqual({ testnet: null });
        expect(req.address_type).toEqual({ P2WPKH: null });
        expect(req.outputs).toEqual([{ destination_address: OTHER, sent_satoshis: 40_000n }]);
        expect(req.utxos_to_spend).toHaveLength(1);
        expect(req.utxos_to_spend[0].height).toBe(4321);
        expect(req.utxos_to_spend[0].value).toBe(100_000n);
        expect(req.utxos_to_spend[0].outpoint.vout).toBe(1);
        expect(Array.from(req.utxos_to_spend[0].outpoint.txid)).toEqual(Array.from(txidToInternal(hex64(1))));
        expect(PAY_WITH_CYCLES).toEqual([{ CallerPaysIcrc2Cycles: null }]);
        // it encodes with the signer's candid
        const svc = signerIdl({ IDL });
        const fn = svc._fields.find(([n]) => n === 'btc_caller_send')[1];
        const bytes = IDL.encode(fn.argTypes, [req, PAY_WITH_CYCLES]);
        const [back, pay] = IDL.decode(fn.argTypes, bytes);
        expect(back.fee_satoshis).toEqual([plan.fee]);
        expect(pay).toEqual([{ CallerPaysIcrc2Cycles: null }]);
    });

    it('writes the record BEFORE calling the signer, and marks broadcast on the expected txid', async () => {
        const { storage, store } = base();
        let seenAtCall = null;
        const expected = expectedTxid({ inputs: plan.inputs, outputs: [{ address: OTHER, value: plan.amount }], change: plan.change, ownAddress: OWN, network: 'testnet' });
        const signer = {
            async btc_caller_send(req, pay) {
                seenAtCall = loadRecords(storage, storeKey('testnet', ME)).records;
                expect(pay).toEqual([{ CallerPaysIcrc2Cycles: null }]);
                return { Ok: { txid: expected.txid } };
            },
        };
        const r = await executeSend({ signer, store, plan, toAddress: OTHER, network: 'testnet', ownAddress: OWN, id: 'a', now: () => 5 });
        expect(seenAtCall).toHaveLength(1);
        expect(seenAtCall[0]).toMatchObject({ id: 'a', state: 'submitting', expectedTxid: expected.txid });
        expect(r).toMatchObject({ state: 'broadcast', txid: expected.txid, drift: false });
        const saved = store.load().records[0];
        expect(saved.state).toBe('broadcast');
        expect(saved.signingCycles).toBe(String(134n * B));
        expect(lockedOutpoints([saved]).size).toBe(1);
    });

    it('records a different txid from the signer (builder drift) without losing the send', async () => {
        const { store } = base();
        const r = await executeSend({ signer: { btc_caller_send: async () => ({ Ok: { txid: 'f'.repeat(64) } }) }, store, plan, toAddress: OTHER, network: 'testnet', ownAddress: OWN, id: 'b' });
        expect(r.drift).toBe(true);
        expect(store.load().records[0]).toMatchObject({ state: 'broadcast', txid: 'f'.repeat(64), txidDrift: true });
    });

    it('a typed Err fails the record and unlocks the coins; payment errors say nothing was charged', async () => {
        const { store } = base();
        const r = await executeSend({ signer: { btc_caller_send: async () => ({ Err: { PaymentError: { InsufficientFunds: { needed: 134n * B, available: B } } } }) }, store, plan, toAddress: OTHER, network: 'testnet', ownAddress: OWN, id: 'c' });
        expect(r.state).toBe('failed');
        expect(r.info).toMatchObject({ charged: false, topUp: true });
        expect(lockedOutpoints(store.load().records).size).toBe(0);
        const { store: s2 } = base();
        const r2 = await executeSend({ signer: { btc_caller_send: async () => ({ Err: { BuildP2wpkhError: { WrongBitcoinNetwork: null } } }) }, store: s2, plan, toAddress: OTHER, network: 'testnet', ownAddress: OWN, id: 'd' });
        expect(r2.info.charged).toBe(true);
    });

    it('a thrown call leaves the send unknown with its coins locked', async () => {
        const { store } = base();
        const r = await executeSend({ signer: { btc_caller_send: async () => { throw new Error('Request timed out'); } }, store, plan, toAddress: OTHER, network: 'testnet', ownAddress: OWN, id: 'e' });
        expect(r.state).toBe('unknown');
        expect(r.error).toMatch(/may or may not/);
        expect(lockedOutpoints(store.load().records).size).toBe(1);
    });

    it('does not call the signer when the record cannot be saved', async () => {
        let called = false;
        const store = makeStore(brokenStorage(), 'k');
        const r = await executeSend({ signer: { btc_caller_send: async () => { called = true; return { Ok: { txid: 'x' } }; } }, store, plan, toAddress: OTHER, network: 'testnet', ownAddress: OWN, id: 'f' });
        expect(r.state).toBe('not_sent');
        expect(called).toBe(false);
    });

    it('re-issues exactly the same request for an unknown send, and refuses otherwise', async () => {
        const { store } = base();
        const reqs = [];
        const signer = { async btc_caller_send(req) { reqs.push(req); if (reqs.length === 1) throw new Error('lost'); return { Ok: { txid: 'abc' } }; } };
        const first = await executeSend({ signer, store, plan, toAddress: OTHER, network: 'testnet', ownAddress: OWN, id: 'g' });
        const rec = store.load().records[0];
        expect(rec.state).toBe('unknown');
        const keys = new Set(rec.request.inputs.map(outpointKey));
        const again = await reissueSend({ signer, store, record: rec, utxoKeys: keys });
        expect(again.state).toBe('broadcast');
        expect(reqs).toHaveLength(2);
        const norm = (x) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? Array.from(v) : v));
        expect(norm(reqs[1])).toBe(norm(reqs[0]));
        expect(norm(requestFromRecord(rec))).toBe(norm(reqs[0]));
        expect(store.load().records[0].attempts).toBe(2);
        expect(first.state).toBe('unknown');
        expect((await reissueSend({ signer, store, record: { ...rec, state: 'unknown' }, utxoKeys: new Set() })).state).toBe('refused');
    });
});

describe('address check against the signer (§5.2 step 1)', () => {
    it('passes and is remembered when the signer agrees', async () => {
        const storage = memStorage();
        const signer = { async btc_caller_address(req, pay) { expect(req).toEqual({ network: { testnet: null }, address_type: { P2WPKH: null } }); expect(pay).toEqual(PAY_WITH_CYCLES); return { Ok: { address: OWN } }; } };
        expect(await verifySignerAddress({ signer, network: 'testnet', expected: OWN, storage, principal: ME })).toEqual({ ok: true });
        expect(isAddressVerified(storage, 'testnet', ME, OWN)).toBe(true);
    });
    it('blocks on a mismatch and on errors', async () => {
        const storage = memStorage();
        const m = await verifySignerAddress({ signer: { btc_caller_address: async () => ({ Ok: { address: OTHER } }) }, network: 'testnet', expected: OWN, storage, principal: ME });
        expect(m).toMatchObject({ ok: false, mismatch: true });
        expect(isAddressVerified(storage, 'testnet', ME, OWN)).toBe(false);
        expect((await verifySignerAddress({ signer: { btc_caller_address: async () => ({ Err: { InternalError: { msg: 'x' } } }) }, network: 'testnet', expected: OWN })).ok).toBe(false);
        expect((await verifySignerAddress({ signer: { btc_caller_address: async () => { throw new Error('t'); } }, network: 'testnet', expected: OWN })).ok).toBe(false);
    });
});

describe('error texts', () => {
    it('maps every SendBtcError branch', () => {
        expect(sendErrorInfo({ BuildP2wpkhError: { NotEnoughFunds: { available: 5n, required: 10n } } }).text).toMatch(/5 sats/);
        expect(sendErrorInfo({ BuildP2wpkhError: { InvalidDestinationAddress: { address: 'zz' } } }).text).toMatch(/zz/);
        expect(sendErrorInfo({ InternalError: { msg: 'boom' } })).toMatchObject({ charged: true });
        expect(sendErrorInfo({ PaymentError: { LedgerWithdrawFromError: { ledger: Principal.anonymous(), error: { InsufficientAllowance: { allowance: 0n } } } } })).toMatchObject({ charged: false, reapprove: true });
        expect(sendErrorInfo({ PaymentError: { UnsupportedPaymentType: null } }).text).toMatch(/Nothing was sent/);
        expect(sendErrorInfo(undefined).text).toMatch(/Unknown/);
        expect(addressErrorText({ PaymentError: { InsufficientFunds: { needed: 1n, available: 0n } } })).toMatch(/signing credit/);
    });
});

// ------------------------------------------------------------------ ICP → signing credit (CMC mint)

describe('top up signing credit from ICP (notify_mint_cycles)', () => {
    const mockLedger = () => {
        const l = { transfers: [], async icrc1_transfer(a) { l.transfers.push(a); return { Ok: 77n }; } };
        return l;
    };
    it('sends ICP to the CMC subaccount of the user with memo MINT, then notifies', async () => {
        const storage = memStorage();
        const ledger = mockLedger();
        const notes = [];
        const cmc = { async notify_mint_cycles(a) { notes.push(a); return { Ok: { minted: 4_000n * B, balance: 4_100n * B, block_index: 9n } }; } };
        const r = await mintCyclesWithIcp({ ledger, cmc, owner: ME, amountE8s: 100_000_000n, storage, now: () => 1_760_000_000_000, processingRetries: 0 });
        expect(r).toMatchObject({ status: 'ok', cycles: 4_000n * B, balance: 4_100n * B, kind: 'mint' });
        const t = ledger.transfers[0];
        expect(t.to.owner.toText()).toBe(CMC_CANISTER_ID_TEXT);
        expect(Array.from(t.to.subaccount[0])).toEqual(Array.from(principalToSubAccount(Principal.fromText(ME))));
        expect(Array.from(t.memo[0])).toEqual(Array.from(MINT_MEMO));
        expect(Array.from(MINT_MEMO.slice(0, 4))).toEqual([...'MINT'].map((ch) => ch.charCodeAt(0)));
        expect(t.amount).toBe(100_000_000n);
        expect(notes[0]).toEqual({ block_index: 77n, to_subaccount: [], deposit_memo: [] });
        expect(getPendingTopUp(mintKey(ME), storage)).toBeNull();
    });
    it('keeps the record on Processing; only the same login may finish it', async () => {
        const storage = memStorage();
        const ledger = mockLedger();
        let n = 0;
        const cmc = { async notify_mint_cycles() { n++; return n === 1 ? { Err: { Processing: null } } : { Ok: { minted: 1n, balance: 1n, block_index: 1n } }; } };
        const r = await mintCyclesWithIcp({ ledger, cmc, owner: ME, amountE8s: 1_000_000n, storage, processingRetries: 0 });
        expect(r.status).toBe('processing');
        expect(getPendingTopUp(mintKey(ME), storage)).not.toBeNull();
        const other = await finishPendingTopUp({ ledger, cmc, canisterId: mintKey(ME), owner: '2vxsx-fae', storage, processingRetries: 0 });
        expect(other.status).toBe('needs_owner');
        expect(n).toBe(1); // another login never notifies (its InvalidTransaction would drop the record)
        const done = await finishPendingTopUp({ ledger, cmc, canisterId: mintKey(ME), owner: ME, storage, processingRetries: 0 });
        expect(done.status).toBe('ok');
        expect(ledger.transfers).toHaveLength(1); // finishing never pays twice
        // a second mint while one is pending finishes the pending one instead of paying again
    });
});

// ------------------------------------------------------------------ history v1 and opt-in lookup

describe('history v1', () => {
    it('lists receives that are not our own change, and keeps spent ones', () => {
        const own = ownTxids([{ txid: hex64(5), expectedTxid: hex64(5) }]);
        const first = mergeReceives([], [utxo(1, 10_000, 3, 100), utxo(5, 2_000, 1, 110)], own);
        expect(first.map((x) => x.txid)).toEqual([hex64(1)]);
        const later = mergeReceives(first, [utxo(2, 20_000, 1, 120)], own);
        expect(later.map((x) => x.txid)).toEqual([hex64(2), hex64(1)]);
        const h = buildHistory({ records: [makeRecord()], receives: later, tipHeight: 120, unspent: new Set([`${hex64(2)}:2`]) });
        expect(h.sends).toHaveLength(1);
        expect(h.receives[0]).toMatchObject({ confirmations: 1, spent: false });
        expect(h.receives[1]).toMatchObject({ confirmations: 21, spent: true });
    });
    it('the opt-in mempool.space lookup tells unknown (404) from seen', async () => {
        const f404 = async () => ({ status: 404, ok: false });
        expect(await checkTxOnMempool('testnet', hex64(1), { fetchImpl: f404 })).toEqual({ seen: false, confirmed: false });
        const fOk = async (url, opts) => { expect(url).toBe(`https://mempool.space/testnet4/api/tx/${hex64(1)}`); expect(opts.referrerPolicy).toBe('no-referrer'); return { status: 200, ok: true, json: async () => ({ status: { confirmed: true } }) }; };
        expect(await checkTxOnMempool('testnet', hex64(1), { fetchImpl: fOk })).toEqual({ seen: true, confirmed: true });
        expect((await checkTxOnMempool('testnet', 'not-a-txid', { fetchImpl: fOk })).error).toBeTruthy();
    });
});

describe('record bookkeeping', () => {
    it('stores amounts as strings and appends a capped event log', () => {
        let rs = [makeRecord()];
        expect(typeof rs[0].amount).toBe('string');
        for (let i = 0; i < 40; i++) rs = updateRecord(rs, 'r1', {}, { now: i, event: `e${i}` });
        expect(rs[0].log.length).toBe(30);
        expect(rs[0].log.at(-1).event).toBe('e39');
    });
});

describe('the send screen while signing (found in the real-sats test)', () => {
    it('keeps showing the plan being sent after its coins become reserved', () => {
        const utxos = [utxo(1, 63_451)];
        const reviewed = planSend({ utxos, amount: 10_000n, feeRate: 1, destType: 'p2wpkh' });
        expect(reviewed.ok).toBe(true);
        // mid-send the coin is reserved, so a freshly computed plan has nothing to spend
        const live = planSend({ utxos, locked: new Set(reviewed.inputs.map((u) => `${u.txid}:${u.vout}`)), amount: 10_000n, feeRate: 1, destType: 'p2wpkh' });
        expect(live.ok).toBe(false);
        const shown = planShown({ step: 'sending', sendingPlan: reviewed, livePlan: live });
        expect(shown.ok).toBe(true);
        expect(shown.amount).toBe(10_000n);
        // outside a send the live plan is shown, as before
        expect(planShown({ step: 'review', sendingPlan: reviewed, livePlan: live })).toBe(live);
    });
});
