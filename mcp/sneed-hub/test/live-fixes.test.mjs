// Bugs found by driving the write tools live against the staging canisters on mainnet
// (2026-10-30), each with a test that fails on the old code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Principal } from '@dfinity/principal';
import { QueryCallRejectedError, UpdateCallRejectedError } from '@dfinity/agent';
import { shortErr, primeTokenInfo } from '../src/format.js';
import { handleWrite, setGuard, setContextFactory } from '../src/writes.js';
import { WriteGuard } from '../src/safety.js';
import { configureIc } from '../src/ic.js';
import { miscWrites } from '../src/tools/w_misc.js';
import { sneedexWrites } from '../src/tools/w_sneedex.js';

const CID = Principal.fromText('uqvqs-raaaa-aaaay-aadsq-cai');

test('shortErr shows the reject message of a rejected query (agent-js 2 "Message")', () => {
  const e = new QueryCallRejectedError(CID, 'get_my_settings', { status: 'rejected', reject_code: 2, reject_message: 'Canister uqvqs-raaaa-aaaay-aadsq-cai is unable to process query calls because it\'s frozen.' });
  assert.equal(shortErr(e), 'Canister uqvqs-raaaa-aaaay-aadsq-cai is unable to process query calls because it\'s frozen.');
});

test('shortErr shows the reject message of a rejected update, quotes included', () => {
  const e = new UpdateCallRejectedError(CID, 'allow_app', new Uint8Array([1, 2]), { status: 200, statusText: 'OK', body: {} }, 5, 'Canister trapped: "app 3" is unknown', 'IC0503');
  assert.equal(shortErr(e), 'Canister trapped: "app 3" is unknown');
});

test('shortErr keeps the polling format and plain errors', () => {
  assert.equal(shortErr(new Error('Call was rejected:\n  Request ID: ab\n  Reject code: 5\n  Reject text: boom\n')), 'boom');
  assert.equal(shortErr(new Error('first line\nsecond')), 'first line');
  assert.equal(shortErr('just text'), 'just text');
});

// ---- write tools against fake actors (canister id -> methods), through the real write protocol ----

const ICP = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const SNEED = 'hvgxa-wqaaa-aaaaq-aacia-cai';
const MON = 'v53u4-6iaaa-aaaay-aadva-cai';
const NOTIF = 'uqvqs-raaaa-aaaay-aadsq-cai';
const LOCK = '25fsc-7yaaa-aaaal-qjt5q-cai';
const DEX = 'igm46-laaaa-aaaae-qgwra-cai';
const ME = 'zcwrc-qhmeq-amaxy-5vluk-urvu5-bfuwr-l6t2t-63udo-vllgu-fdlsm-2ae';
const E8 = 100_000_000n;
// nothing may reach the network: premium lookups fail fast, so the regular price applies
configureIc({ host: 'http://127.0.0.1:9', canisters: { sneed_mon: MON, sneed_notifications: NOTIF, sneed_lock: LOCK, sneedex: DEX, sneed_premium: 'sf5tm-dqaaa-aaaae-qgyla-cai' } });
primeTokenInfo({ ledger: ICP, name: 'Internet Computer', symbol: 'ICP', decimals: 8, fee: '10000' });
primeTokenInfo({ ledger: SNEED, name: 'Sneed', symbol: 'SNEED', decimals: 8, fee: '1000' });

/// A fake ICRC-1 ledger: balances by "owner/subaccount hex", transfers recorded.
const fakeLedger = (balances) => {
  const key = ({ owner, subaccount }) => `${String(owner.toText?.() ?? owner)}/${subaccount?.[0] ? Buffer.from(subaccount[0]).toString('hex') : ''}`;
  const transfers = [];
  return {
    transfers,
    icrc1_balance_of: async (a) => balances[key(a)] ?? 0n,
    icrc1_transfer: async (t) => { transfers.push(t); return { Ok: 4242n }; },
  };
};
const useFakes = (fakes) => {
  setGuard(new WriteGuard({ caps: { [ICP]: '1', [SNEED]: '1000' } }));
  const get = async (idl, id) => { const f = fakes[String(id)]; if (!f) throw new Error(`no fake for ${id}`); return f; };
  setContextFactory(() => ({ who: { mode: 'own', label: `as ${ME}` }, principal: ME, anon: get, signed: get }));
};
const tool = (list, name) => list.find((w) => w.name === name);
const run = async (spec, args) => {
  const p = (await handleWrite(spec, args)).content[0].text;
  const token = p.match(/confirm: "([0-9a-f]+)"/)?.[1];
  if (!token) return { preview: p };
  const d = await handleWrite(spec, { ...args, confirm: token });
  return { preview: p, done: d.content[0].text, isError: d.isError };
};
const sub = (b) => { const s = new Uint8Array(32); s[31] = b; return s; };
const monFake = ({ watches = [], balance = 0n, unwatchReply = 'Stopped watching' } = {}) => ({
  get_my_watches: async () => watches,
  get_my_balance: async () => ({ balance_e8s: balance, per_day_e8s: 0n, deposit_account: { owner: Principal.fromText(MON), subaccount: [sub(9)] } }),
  get_status: async () => ({ app_id: [2n] }),
  credit_deposit: async () => ({ ok: { credited_e8s: 500_000n, balance_e8s: 500_000n, paused: false } }),
  watch: async () => ({ ok: 'Watching' }),
  unwatch: async () => ({ ok: unwatchReply }),
});

test('mon_unwatch: a target you do not watch is blocked (the canister would answer ok "Not watching")', async () => {
  useFakes({ [MON]: monFake({ watches: [], unwatchReply: 'Not watching' }) });
  const r = await run(tool(miscWrites, 'mon_unwatch'), { target: 'fp274-iaaaa-aaaaq-aacha-cai' });
  assert.match(r.preview, /BLOCKED/);
  assert.match(r.preview, /You do not watch SNS fp274-iaaaa-aaaaq-aacha-cai/);
  assert.equal(r.done, undefined);
});

test('mon_watch: the top-up block index is reported and a refused allow_app is one readable line', async () => {
  useFakes({
    [MON]: monFake(),
    [ICP]: fakeLedger({ [`${ME}/`]: E8 }),
    [NOTIF]: { allow_app: async () => { throw new UpdateCallRejectedError(CID, 'allow_app', new Uint8Array([1]), { status: 200, statusText: 'OK', body: {} }, 2, 'Canister uqvqs-raaaa-aaaay-aadsq-cai is out of cycles', 'IC0207'); } },
  });
  const r = await run(tool(miscWrites, 'mon_watch'), { target: 'fp274-iaaaa-aaaaq-aacha-cai', top_up_icp: '0.005' });
  assert.ok(!r.isError, r.done);
  assert.match(r.done, /top-up sent to your Monitor deposit account \(ICP block 4242\)/);
  assert.match(r.done, /allow_app failed \(Canister uqvqs-raaaa-aaaay-aadsq-cai is out of cycles\); allow it on/);
  assert.doesNotMatch(r.done, /Call failed|Request ID/);
});

test('mon_watch: a top-up above the ICP balance is blocked before anything is sent', async () => {
  useFakes({ [MON]: monFake(), [ICP]: fakeLedger({ [`${ME}/`]: 100_000n }) });
  const r = await run(tool(miscWrites, 'mon_watch'), { target: 'fp274-iaaaa-aaaaq-aacha-cai', top_up_icp: '0.005' });
  assert.match(r.preview, /BLOCKED[\s\S]*Balance 0.001 ICP is below the 0.0052 ICP this needs/);
  assert.equal(r.done, undefined);
});

const lockFake = () => ({
  get_lock_fees_icp: async () => ({ token_lock_fee_icp_e8s: 10_000_000n, premium_token_lock_fee_icp_e8s: 0n }),
  getPaymentSubaccount: async () => sub(1),
  get_lock_limits: async () => ({ min_lock_length_ns: 5_000_000_000n, max_lock_length_ns: 10n ** 18n }),
  get_summed_locks: async () => [],
});

test('sneed_lock_create_token_lock: an ICP balance below the lock fee is blocked (only the tokens were checked)', async () => {
  useFakes({ [LOCK]: lockFake(), [ICP]: fakeLedger({ [`${ME}/`]: 5_000_000n }), [SNEED]: fakeLedger({ [`${ME}/`]: E8 }) });
  const r = await run(tool(miscWrites, 'sneed_lock_create_token_lock'), { ledger: SNEED, amount: '0.01', lock_days: 1 });
  assert.match(r.preview, /BLOCKED[\s\S]*Balance 0.05 ICP is below the 0.1001 ICP this needs/);
  assert.equal(r.done, undefined);
});

test('sneed_lock_create_token_lock: locking ICP needs the lock fee and the tokens together', async () => {
  // 0.15 ICP covers the 0.1 fee or the 0.1 lock, not both
  useFakes({ [LOCK]: lockFake(), [ICP]: fakeLedger({ [`${ME}/`]: 15_000_000n }) });
  const r = await run(tool(miscWrites, 'sneed_lock_create_token_lock'), { ledger: ICP, amount: '0.1', lock_days: 1 });
  assert.match(r.preview, /BLOCKED[\s\S]*Balance 0.15 ICP is below the 0.2002 ICP this needs/);
});

test('sneedex_create_offer: the ICP creation fee and an ICP asset are checked together against the balance', async () => {
  useFakes({
    [DEX]: { getFeeConfig: async () => ({ regularCreationFeeE8s: 1_000_000n, premiumCreationFeeE8s: 0n }), getOfferCreationPaymentSubaccount: async () => sub(2) },
    [ICP]: fakeLedger({ [`${ME}/`]: 5_500_000n }), // 0.055 ICP: enough for the 0.05 asset or the 0.01 fee, not both
  });
  const r = await run(tool(sneedexWrites, 'sneedex_create_offer'), { assets: [{ type: 'token', ledger: ICP, amount: '0.05' }], price_ledger: SNEED, buyout: '1' });
  assert.match(r.preview, /BLOCKED[\s\S]*Balance 0.055 ICP is below the 0.0602 ICP this needs/);
  assert.equal(r.done, undefined);
});
