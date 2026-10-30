// The phase-2 write tools (Sneedex after-sale actions, Sneed Lock withdraw/change/fee deposit,
// Monitor, forum votes and deletes, nicknames, neuron names, avatars, Premium, Notifications,
// wallet_send) through the real preview/confirm protocol against Candid-faithful fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { primeTokenInfo } from '../src/format.js';
import { configureIc } from '../src/ic.js';
import { sneedexWrites, bidEscrowState } from '../src/tools/w_sneedex.js';
import { lockWrites, lockedNow, lockWalletFree, lockChangeProblems } from '../src/tools/w_lock.js';
import { monWrites, watchPatch } from '../src/tools/w_mon.js';
import { forumWrites } from '../src/tools/w_social.js';
import { nameWrites } from '../src/tools/w_names.js';
import { accountWrites, walletSend, premiumTopUp, registerAccountWrites } from '../src/tools/w_account.js';
import { principalSubaccount } from '../src/chain.js';
import { idlFactory as sneedexIdl } from '../src/idl/sneedex.did.js';
import { idlFactory as icrc1Idl } from '../src/idl/icrc1_ledger.did.js';
import { idlFactory as lockIdl } from '../src/idl/sneed_lock.did.js';
import { idlFactory as monIdl } from '../src/idl/sneed_mon.did.js';
import { idlFactory as forumIdl } from '../src/idl/sneed_sns_forum.did.js';
import { idlFactory as govIdl } from '../src/idl/sns_governance.did.js';
import { idlFactory as pidNicknamesIdl } from '../src/idl/sneed_pid_nicknames.did.js';
import { idlFactory as neuronNamesIdl } from '../src/idl/sneed_neuron_names.did.js';
import { idlFactory as pidNamesIdl } from '../src/idl/sneed_pid_names.did.js';
import { idlFactory as icrc7Idl } from '../src/idl/icrc7.did.js';
import { idlFactory as premiumIdl } from '../src/idl/sneed_premium.did.js';
import { idlFactory as notifIdl } from '../src/idl/sneed_notifications.did.js';
import { fake, useFakes, previewConfirm, ledgerImpl, def, retType, P, sub, tool } from './candid-fake.mjs';

const ICP = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const SNEED = 'hvgxa-wqaaa-aaaaq-aacia-cai';
const DEX = 'igm46-laaaa-aaaae-qgwra-cai';
const LOCK = '25fsc-7yaaa-aaaal-qjt5q-cai';
const MON = 'v53u4-6iaaa-aaaay-aadva-cai';
const FORUM = 'nrtf2-wiaaa-aaaad-aankq-cai';
const NICK = 'ronf3-cyaaa-aaaad-ag6mq-cai';
const NNAMES = 'rjmdp-paaaa-aaaad-ag6ma-cai';
const PNAMES = 'qechb-aiaaa-aaaad-ag6lq-cai';
const PREM = 'sf5tm-dqaaa-aaaae-qgyla-cai';
const NOTIF = 'uqvqs-raaaa-aaaay-aadsq-cai';
const ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
const GOV = 'fi3zi-fyaaa-aaaaq-aachq-cai';
const NFT = 'tsdbx-ayaaa-aaaal-qxogq-cai';
const ME = 'zcwrc-qhmeq-amaxy-5vluk-urvu5-bfuwr-l6t2t-63udo-vllgu-fdlsm-2ae';
const OTHER = 'tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae';
const E8 = 100_000_000n;
const FEE = 10_000n;
const NOW_NS = () => BigInt(Date.now()) * 1_000_000n;
configureIc({
  host: 'http://127.0.0.1:9',
  canisters: { sneedex: DEX, sneed_lock: LOCK, sneed_mon: MON, sneed_sns_forum: FORUM, sneed_pid_nicknames: NICK, sneed_neuron_names: NNAMES, sneed_pid_names: PNAMES, sneed_premium: PREM, sneed_notifications: NOTIF },
});
primeTokenInfo({ ledger: ICP, name: 'Internet Computer', symbol: 'ICP', decimals: 8, fee: '10000' });
primeTokenInfo({ ledger: SNEED, name: 'Sneed', symbol: 'SNEED', decimals: 8, fee: '1000' });
const CAPS = { caps: { [ICP]: '1', [SNEED]: '1000' } };
const methodsCalled = (a) => a.__calls.map((c) => c.method);

// ---------------- Sneedex ----------------

const OFFER_T = retType(sneedexIdl, 'queryOffer', { unwrap: 1 });
const BID_T = retType(sneedexIdl, 'queryBid', { unwrap: 1 });
const offer = (o = {}) => ({ ...def(OFFER_T), id: 7n, creator: P(OTHER), price_token_ledger: P(ICP), fee_rate_bps: 500n, assets: [{ asset: { ICRC1Token: { ledger_canister_id: P(SNEED), amount: E8 } }, escrowed: true }], ...o });
const bid = (b = {}) => ({ ...def(BID_T), id: 3n, offer_id: 7n, bidder: P(ME), amount: E8, tokens_escrowed: true, state: { Pending: null }, ...b });
const dexFake = ({ o = offer(), bids = [], settlement = null, extra = {} } = {}) => fake(sneedexIdl, {
  getOfferView: () => [{ offer: o, bids, highest_bid: bids.length ? [bids[0]] : [] }],
  getSettlement: () => (settlement ? [settlement] : []),
  queryOffer: () => [o],
  queryBid: (id) => bids.filter((b) => b.id === id).map((b) => b),
  getBidEscrowSubaccount: () => sub(3),
  getOfferCreationPaymentSubaccount: () => sub(4),
  ...extra,
});

test('sneedex_offer_action cancel: the seller previews cancelOffer and runs it; anyone else is blocked', async () => {
  const dex = dexFake({ o: offer({ creator: P(ME) }), bids: [bid({ bidder: P(OTHER) })], extra: { cancelOffer: () => ({ ok: null }) } });
  useFakes(ME, { [DEX]: dex, [ICP]: fake(icrc1Idl, ledgerImpl({})) }, CAPS);
  const r = await previewConfirm(tool(sneedexWrites, 'sneedex_offer_action'), { offer_id: 7, action: 'cancel' });
  assert.match(r.preview, /cancelOffer\(\[7\]\)/);
  assert.match(r.preview, /1 standing bid\(s\) are refunded automatically/);
  assert.match(r.preview, /Spends: none/);
  assert.ok(!r.isError, r.done);
  assert.match(r.done, /cancelOffer\(7\) done/);
  assert.ok(methodsCalled(dex).includes('cancelOffer'));
  useFakes(ME, { [DEX]: dexFake(), [ICP]: fake(icrc1Idl, ledgerImpl({})) }, CAPS);
  const b = await previewConfirm(tool(sneedexWrites, 'sneedex_offer_action'), { offer_id: 7, action: 'cancel' });
  assert.match(b.preview, /BLOCKED[\s\S]*Only the seller/);
  assert.equal(b.done, undefined);
});

test('sneedex_offer_action: claim_payment when paid, process_expiration too early, settle with nothing left are blocked', async () => {
  const won = bid({ state: { ClaimedBySeller: null } });
  const settled = { state: { Claimed: null }, winning_bid: [won], delivered_asset_indices: [0n], settlement_in_progress: false };
  useFakes(ME, { [DEX]: dexFake({ o: offer({ creator: P(ME), state: { Claimed: null } }), settlement: settled }), [ICP]: fake(icrc1Idl, ledgerImpl({})) }, CAPS);
  assert.match((await previewConfirm(tool(sneedexWrites, 'sneedex_offer_action'), { offer_id: 7, action: 'claim_payment' })).preview, /BLOCKED[\s\S]*paid already/);
  assert.match((await previewConfirm(tool(sneedexWrites, 'sneedex_offer_action'), { offer_id: 7, action: 'settle' })).preview, /BLOCKED[\s\S]*Nothing to settle/);
  useFakes(ME, { [DEX]: dexFake({ o: offer({ expiration: [NOW_NS() + 3_600_000_000_000n] }) }), [ICP]: fake(icrc1Idl, ledgerImpl({})) }, CAPS);
  assert.match((await previewConfirm(tool(sneedexWrites, 'sneedex_offer_action'), { offer_id: 7, action: 'process_expiration' })).preview, /BLOCKED[\s\S]*not expired yet/);
});

test('sneedex_offer_action claim_assets: only the winner, and the expected payout of claim_payment is shown', async () => {
  const w = bid({ state: { Won: null } });
  const settlement = { state: { Completed: { winning_bid_id: 3n, completion_time: 1n } }, winning_bid: [w], delivered_asset_indices: [], settlement_in_progress: false };
  const dex = dexFake({ o: offer({ state: { Completed: { winning_bid_id: 3n, completion_time: 1n } } }), bids: [w], settlement, extra: { claimAssets: () => ({ ok: null }) } });
  useFakes(ME, { [DEX]: dex, [ICP]: fake(icrc1Idl, ledgerImpl({})) }, CAPS);
  const r = await previewConfirm(tool(sneedexWrites, 'sneedex_offer_action'), { offer_id: 7, action: 'claim_assets' });
  assert.match(r.preview, /1 of 1 asset\(s\) still to hand over/);
  assert.ok(!r.isError, r.done);
  useFakes(OTHER, { [DEX]: dex, [ICP]: fake(icrc1Idl, ledgerImpl({})) }, CAPS);
  const pay = await previewConfirm(tool(sneedexWrites, 'sneedex_offer_action'), { offer_id: 7, action: 'claim_payment' });
  // 1 ICP less the 5% cut and one fee
  assert.match(pay.preview, /You get about 0\.9499 ICP/);
  assert.match((await previewConfirm(tool(sneedexWrites, 'sneedex_offer_action'), { offer_id: 7, action: 'claim_assets' })).preview, /BLOCKED[\s\S]*Only the winning bidder/);
});

test('bidEscrowState: a standing bid keeps its amount, the withdrawal pays one fee, a won bid gives nothing', () => {
  assert.equal(bidEscrowState({ bid: bid(), balance: 12n * E8 / 10n, fee: FEE }).max, 2n * E8 / 10n - FEE);
  assert.equal(bidEscrowState({ bid: bid({ state: { Refunded: null } }), balance: 5000n * 10n, fee: FEE }).max, 40_000n);
  assert.equal(bidEscrowState({ bid: bid({ state: { Won: null } }), balance: 2n * E8, fee: FEE }).max, 0n);
});

test('sneedex_bid_action withdraw: defaults to the most that can leave; above it is blocked', async () => {
  const b = bid();
  const dex = dexFake({ bids: [b], extra: { withdrawBidEscrow: (id, amt) => ({ ok: 99n }) } });
  const ledger = fake(icrc1Idl, ledgerImpl({ [`${DEX}/${Buffer.from(sub(3)).toString('hex')}`]: 12n * E8 / 10n }));
  useFakes(ME, { [DEX]: dex, [ICP]: ledger }, CAPS);
  const r = await previewConfirm(tool(sneedexWrites, 'sneedex_bid_action'), { bid_id: 3, action: 'withdraw' });
  assert.match(r.preview, /Withdraw 0\.1999 ICP from the escrow of bid 3/);
  assert.ok(!r.isError, r.done);
  assert.match(r.done, /ledger block 99/);
  assert.deepEqual(dex.__calls.find((c) => c.method === 'withdrawBidEscrow').args, [3n, 19_990_000n]);
  const over = await previewConfirm(tool(sneedexWrites, 'sneedex_bid_action'), { bid_id: 3, action: 'withdraw', amount: '0.5' });
  assert.match(over.preview, /BLOCKED[\s\S]*At most 0\.1999 ICP/);
  const refund = await previewConfirm(tool(sneedexWrites, 'sneedex_bid_action'), { bid_id: 3, action: 'refund' });
  assert.match(refund.preview, /BLOCKED[\s\S]*Only a lost bid can be refunded; this one is Pending/);
});

test('sneedex_withdraw_fee_deposit: blocked at or below one fee, else runs withdrawOfferCreationPayment', async () => {
  const dex = dexFake({ extra: { withdrawOfferCreationPayment: () => ({ ok: 990_000n }) } });
  const key = `${DEX}/${Buffer.from(sub(4)).toString('hex')}`;
  useFakes(ME, { [DEX]: dex, [ICP]: fake(icrc1Idl, ledgerImpl({ [key]: FEE })) }, CAPS);
  assert.match((await previewConfirm(tool(sneedexWrites, 'sneedex_withdraw_fee_deposit'), {})).preview, /BLOCKED[\s\S]*Nothing to withdraw/);
  useFakes(ME, { [DEX]: dex, [ICP]: fake(icrc1Idl, ledgerImpl({ [key]: 1_000_000n })) }, CAPS);
  const r = await previewConfirm(tool(sneedexWrites, 'sneedex_withdraw_fee_deposit'), {});
  assert.match(r.preview, /You get 0\.0099 ICP/);
  assert.match(r.done, /withdrew 0\.0099 ICP/);
});

// ---------------- Sneed Lock ----------------

test('lockedNow counts only unexpired locks of that ledger; lockWalletFree leaves one fee', () => {
  const now = NOW_NS();
  const locks = [[1n, P(SNEED), 5n * E8, now + 1000n], [2n, P(SNEED), 3n * E8, now - 1000n], [3n, P(ICP), E8, now + 1000n]];
  assert.equal(lockedNow(locks, SNEED, now), 5n * E8);
  assert.equal(lockWalletFree({ balance: 8n * E8, locked: 5n * E8, fee: 1000n }), 3n * E8 - 1000n);
  assert.equal(lockWalletFree({ balance: 5n * E8, locked: 5n * E8, fee: 1000n }), 0n);
});

test('sneed_lock_withdraw: previews transfer_tokens to your main account for all that is free, and runs it', async () => {
  const lockSub = Buffer.from(principalSubaccount(ME)).toString('hex');
  const lock = fake(lockIdl, {
    get_token_locks: () => [[1n, P(SNEED), 5n * E8, NOW_NS() + 10n ** 15n], [2n, P(SNEED), E8, NOW_NS() - 1n]],
    transfer_tokens: () => ({ Ok: 777n }),
  });
  useFakes(ME, { [LOCK]: lock, [SNEED]: fake(icrc1Idl, ledgerImpl({ [`${LOCK}/${lockSub}`]: 8n * E8 })) }, CAPS);
  const r = await previewConfirm(tool(lockWrites, 'sneed_lock_withdraw'), { ledger: SNEED });
  assert.match(r.preview, /Withdraw 2\.99999 SNEED from your Sneed Lock wallet/);
  assert.match(r.preview, /locked 5 SNEED/);
  assert.ok(!r.isError, r.done);
  const call = lock.__calls.find((c) => c.method === 'transfer_tokens');
  assert.equal(call.args[0].toText(), ME);
  assert.deepEqual(call.args[1], []);
  assert.equal(call.args[3], 3n * E8 - 1000n);
  assert.match(r.done, /ledger block 777/);
});

const lockState = (s = {}) => ({ ...def(retType(lockIdl, 'get_lock_state', { unwrap: 1 })), lock_id: 9n, owner: P(ME), locked: true, lock_end: NOW_NS() + 86_400_000_000_000n, dissolve_delay: 3_600_000_000_000n, ...s });

test('lockChangeProblems mirrors the dissolve panel', () => {
  const st = lockState();
  assert.match(lockChangeProblems(st, ME, 'start_dissolving').join(), /when the lock period ends/);
  assert.deepEqual(lockChangeProblems(lockState({ lock_end: NOW_NS() - 1n }), ME, 'start_dissolving'), []);
  assert.match(lockChangeProblems(lockState({ dissolving_until: [NOW_NS() + 5n] }), ME, 'extend_lock', { newEndNs: NOW_NS() * 2n }).join(), /Stop dissolving first/);
  assert.match(lockChangeProblems(st, OTHER, 'stop_dissolving').join(), /not yours/);
  assert.match(lockChangeProblems(st, ME, 'stop_dissolving').join(), /not dissolving/);
});

test('sneed_lock_change increase_dissolve_delay: previews and runs with the hours in ns', async () => {
  const st = lockState();
  const lock = fake(lockIdl, {
    get_lock_state: () => [st],
    get_lock_limits: () => ({ min_lock_length_ns: 1n, max_lock_length_ns: 10n ** 18n }),
    increase_dissolve_delay: (id, add) => ({ Ok: { ...st, dissolve_delay: st.dissolve_delay + add } }),
  });
  useFakes(ME, { [LOCK]: lock }, CAPS);
  const r = await previewConfirm(tool(lockWrites, 'sneed_lock_change'), { lock_id: 9, action: 'increase_dissolve_delay', add_hours: 2 });
  assert.match(r.preview, /Add 2 hour\(s\) to the dissolve delay of lock 9/);
  assert.ok(!r.isError, r.done);
  assert.deepEqual(lock.__calls.find((c) => c.method === 'increase_dissolve_delay').args, [9n, 7_200_000_000_000n]);
  assert.match(r.done, /dissolve delay 3h 0m/);
});

// ---------------- Monitor ----------------

const myBalance = (b = {}) => ({ ...def(retType(monIdl, 'get_my_balance')), deposit_account: { owner: P(MON), subaccount: [sub(9)] }, ...b });

test('mon_withdraw: to yourself by default; to someone else only with transfers allowed', async () => {
  const mon = fake(monIdl, { get_my_balance: () => myBalance({ balance_e8s: 5_000_000n }), withdraw_balance: () => ({ ok: 55n }) });
  useFakes(ME, { [MON]: mon }, CAPS);
  const r = await previewConfirm(tool(monWrites, 'mon_withdraw'), {});
  assert.match(r.preview, /Withdraw 0\.05 ICP from your Sneed Monitor balance to your main account/);
  assert.ok(!r.isError, r.done);
  assert.equal(mon.__calls.find((c) => c.method === 'withdraw_balance').args[1].owner.toText(), ME);
  const other = await previewConfirm(tool(monWrites, 'mon_withdraw'), { to: OTHER });
  assert.match(other.preview, /BLOCKED[\s\S]*plain transfer to an arbitrary account/);
  useFakes(ME, { [MON]: mon }, { ...CAPS, allowTransfers: true });
  assert.doesNotMatch((await previewConfirm(tool(monWrites, 'mon_withdraw'), { to: OTHER })).preview, /BLOCKED/);
});

test('watchPatch: a slower tier moves a too-short reminder window up, as setFrequency does', () => {
  const p = watchPatch({ reminder_window_s: 3600n }, { every_min: 360 });
  assert.deepEqual(p.every_min, [360n]);
  assert.deepEqual(p.reminder_window_s, [43200n]);
  assert.deepEqual(watchPatch({ reminder_window_s: 86400n }, { every_min: 60 }).reminder_window_s, []);
  assert.deepEqual(watchPatch({ reminder_window_s: 86400n }, { topics: ['a'] }).topics, [{ only: ['a'] }]);
});

test('mon_auto_top_up: the allowance counts toward the daily ICP cap and is approved before set_auto_top_up', async () => {
  const at = { ...def(retType(monIdl, 'get_my_balance')._fields.find(([k]) => k === 'auto_top_up')[1]), min_amount_e8s: 100_000n, max_amount_e8s: 10n * E8, spender: { owner: P(MON), subaccount: [] } };
  const mon = fake(monIdl, { get_my_balance: () => myBalance({ auto_top_up: at }), set_auto_top_up: () => ({ ok: 'Auto top-up on' }) });
  const icp = fake(icrc1Idl, ledgerImpl({ [`${ME}/`]: E8 }));
  useFakes(ME, { [MON]: mon, [ICP]: icp }, CAPS);
  const big = await previewConfirm(tool(monWrites, 'mon_auto_top_up'), { amount_icp: '0.5', cap_icp: '1' });
  assert.match(big.preview, /BLOCKED[\s\S]*Daily cap for ICP/);
  const r = await previewConfirm(tool(monWrites, 'mon_auto_top_up'), { amount_icp: '0.1', when_below_icp: '0.02' });
  assert.ok(!r.isError, r.done);
  assert.deepEqual(methodsCalled(icp).slice(-1), ['icrc2_approve']);
  const approve = icp.__calls.find((c) => c.method === 'icrc2_approve').args[0];
  assert.equal(approve.amount, 50_000_000n + 5n * FEE); // 0.5 ICP cap + one fee per pull (5 pulls)
  assert.equal(approve.spender.owner.toText(), MON);
  assert.ok(methodsCalled(mon).indexOf('set_auto_top_up') > -1);
});

// ---------------- forum ----------------

const POST_T = retType(forumIdl, 'get_post', { unwrap: 1 });
const neuron = (idHex, who) => ({ ...def(retType(govIdl, 'list_neurons')._fields.find(([k]) => k === 'neurons')[1]._type), id: [{ id: Uint8Array.from(Buffer.from(idHex, 'hex')) }], permissions: [{ principal: [P(who)], permission_type: [3, 4] }] });

test('forum_vote: votes with every neuron that lists you, in the thread\'s SNS', async () => {
  const forum = fake(forumIdl, {
    get_post: () => [{ ...def(POST_T), id: 5n, thread_id: 2n, created_by: P(OTHER) }],
    get_thread_context: () => [{ ...def(retType(forumIdl, 'get_thread_context', { unwrap: 1 })), sns_root_canister_id: [P(ROOT)] }],
    vote_on_post_with_neurons: () => ({ ok: null }),
  });
  const gov = fake(govIdl, { list_neurons: () => ({ neurons: [neuron('ab01', ME), neuron('cd02', ME)] }) });
  useFakes(ME, { [FORUM]: forum, [GOV]: gov }, CAPS);
  const r = await previewConfirm(tool(forumWrites, 'forum_vote'), { post_id: 5, vote: 'up' });
  assert.match(r.preview, /Upvote post 5 with 2 neuron\(s\)/);
  assert.ok(!r.isError, r.done);
  const call = forum.__calls.find((c) => c.method === 'vote_on_post_with_neurons');
  assert.deepEqual(call.args[1], { upvote: null });
  assert.deepEqual(call.args[2].map((n) => Buffer.from(n.id).toString('hex')), ['ab01', 'cd02']);
  useFakes(ME, { [FORUM]: forum, [GOV]: fake(govIdl, { list_neurons: () => ({ neurons: [] }) }) }, CAPS);
  assert.match((await previewConfirm(tool(forumWrites, 'forum_vote'), { post_id: 5, vote: 'down' })).preview, /BLOCKED[\s\S]*listed on no neuron/);
});

test('forum_delete: only your own post', async () => {
  const mk = (by) => fake(forumIdl, { get_post: () => [{ ...def(POST_T), id: 5n, created_by: P(by), body: 'hello' }], delete_post: () => ({ ok: null }) });
  useFakes(ME, { [FORUM]: mk(OTHER) }, CAPS);
  assert.match((await previewConfirm(tool(forumWrites, 'forum_delete'), { post_id: 5 })).preview, /BLOCKED[\s\S]*not by/);
  const mine = mk(ME);
  useFakes(ME, { [FORUM]: mine }, CAPS);
  const r = await previewConfirm(tool(forumWrites, 'forum_delete'), { post_id: 5 });
  assert.match(r.done, /post 5 deleted/);
  assert.ok(methodsCalled(mine).includes('delete_post'));
});

// ---------------- names ----------------

test('nickname_set sets a principal nickname; neuron_name_set needs a permission on the neuron', async () => {
  const nick = fake(pidNicknamesIdl, { set_nickname: () => ({ ok: 'Nickname set' }) });
  useFakes(ME, { [NICK]: nick }, CAPS);
  const r = await previewConfirm(tool(nameWrites, 'nickname_set'), { principal: OTHER, nickname: 'Pal' });
  assert.match(r.done, /Nickname set/);
  assert.equal(nick.__calls[0].args[0].toText(), OTHER);
  const getNeuron = (who) => fake(govIdl, { get_neuron: () => ({ result: [{ Neuron: neuron('ab01', who) }] }) });
  const names = fake(neuronNamesIdl, { get_names: (keys) => keys.map(() => []), set_name: () => ({ ok: 'Name set' }) });
  useFakes(ME, { [GOV]: getNeuron(OTHER), [NNAMES]: names }, CAPS);
  assert.match((await previewConfirm(tool(nameWrites, 'neuron_name_set'), { neuron_id: 'ab01', name: 'Whale' })).preview, /BLOCKED[\s\S]*no permission on neuron ab01/);
  useFakes(ME, { [GOV]: getNeuron(ME), [NNAMES]: names }, CAPS);
  const ok = await previewConfirm(tool(nameWrites, 'neuron_name_set'), { neuron_id: 'ab01', name: 'Whale' });
  assert.match(ok.done, /Name set/);
  assert.equal(Buffer.from(names.__calls.find((c) => c.method === 'set_name').args[0].neuron_id).toString('hex'), 'ab01');
});

test('avatar_set: an NFT you do not hold is blocked; an https link runs set_my_avatar', async () => {
  const pn = fake(pidNamesIdl, { set_my_avatar: () => ({ ok: 'Avatar set' }), set_my_nft_avatar: () => ({ ok: 'NFT avatar set' }) });
  const coll = fake(icrc7Idl, { icrc7_owner_of: () => [[{ owner: P(OTHER), subaccount: [] }]] });
  useFakes(ME, { [PNAMES]: pn, [NFT]: coll }, CAPS);
  assert.match((await previewConfirm(tool(nameWrites, 'avatar_set'), { nft_collection: NFT, nft_token_id: 1 })).preview, /BLOCKED[\s\S]*not held by/);
  assert.match((await previewConfirm(tool(nameWrites, 'avatar_set'), { url: 'http://x' })).preview, /BLOCKED[\s\S]*https/);
  const r = await previewConfirm(tool(nameWrites, 'avatar_set'), { url: 'https://example.org/a.png' });
  assert.match(r.done, /Avatar set/);
  assert.deepEqual(pn.__calls.find((c) => c.method === 'set_my_avatar').args[0], [{ url: 'https://example.org/a.png' }]);
});

// ---------------- Premium ----------------

test('premiumTopUp: only the rest of the price is sent; a deposit above the price is blocked', () => {
  assert.deepEqual(premiumTopUp(0n, 100_000n), { send: 100_000n });
  assert.deepEqual(premiumTopUp(40_000n, 100_000n), { send: 60_000n });
  assert.deepEqual(premiumTopUp(100_000n, 100_000n), { send: 0n });
  assert.match(premiumTopUp(150_000n, 100_000n).problem, /Withdraw it first/);
});

test('premium_buy: pays the tier price into the deposit, then purchaseWithIcp', async () => {
  const dep = { owner: P(PREM), subaccount: [sub(8)] };
  const tierT = retType(premiumIdl, 'get_icp_tier_prices_for', { unwrap: 1 });
  const prem = fake(premiumIdl, {
    get_icp_tier_prices_for: () => [{ ...def(tierT), tier: { name: '1 Day', active: true, amountE8s: 100_000n, durationNs: 86_400_000_000_000n }, price_e8s: 100_000n, price_tier: { regular: null } }],
    getDepositAccount: () => dep,
    checkMembership: () => ({ NotFound: null }),
    purchaseWithIcp: () => ({ ok: { ...def(retType(premiumIdl, 'purchaseWithIcp')._fields[0][1]), expiration: NOW_NS() + 86_400_000_000_000n } }),
  });
  const icp = fake(icrc1Idl, ledgerImpl({ [`${ME}/`]: E8 }));
  useFakes(ME, { [PREM]: prem, [ICP]: icp }, CAPS);
  const r = await previewConfirm(tool(accountWrites, 'premium_buy'), { tier: '1 day' });
  assert.match(r.preview, /Sneed Premium "1 Day" for 0\.001 ICP/);
  assert.match(r.preview, /0\.0011 ICP on ryjl3/);
  assert.ok(!r.isError, r.done);
  const tr = icp.__calls.find((c) => c.method === 'icrc1_transfer').args[0];
  assert.equal(tr.amount, 100_000n);
  assert.equal(Buffer.from(tr.to.subaccount[0]).toString('hex'), Buffer.from(sub(8)).toString('hex'));
  assert.match(r.done, /Sneed Premium until/);
});

// ---------------- Notifications ----------------

const settingsT = retType(notifIdl, 'get_my_settings');
test('notifications_set_quiet_hours keeps the other settings; notifications_app_settings sets a topic rule', async () => {
  const s = { ...def(settingsT), settings: { ...def(settingsT._fields.find(([k]) => k === 'settings')[1]), defaults: { urgent: [1n], normal: [1n], info: [] }, always_copy: [1n] } };
  const appT = retType(notifIdl, 'get_my_apps')._type._components;
  const app = { ...def(appT[0]), id: 2n, name: 'Monitor', topics: [{ id: 'proposals', title: 'Proposals', description: '', level: { normal: null } }] };
  const perm = { ...def(appT[1]), allowed: true, daily_cap: 50n };
  const n = fake(notifIdl, { get_my_settings: () => s, set_settings: () => ({ ok: 'Saved' }), get_my_apps: () => [[app, perm]], set_permission: () => ({ ok: 'Saved' }) });
  useFakes(ME, { [NOTIF]: n }, CAPS);
  const r = await previewConfirm(tool(accountWrites, 'notifications_set_quiet_hours'), { from: '23:00', to: '06:30', utc_offset_minutes: 60 });
  assert.ok(!r.isError, r.done);
  const set = n.__calls.find((c) => c.method === 'set_settings').args[0];
  assert.deepEqual(set.quiet, [{ start_min: 1380n, end_min: 390n, utc_offset_min: 60n, urgent_passes: true }]);
  assert.deepEqual(set.always_copy, [1n]);
  assert.deepEqual(set.defaults.urgent, [1n]);
  const a = await previewConfirm(tool(accountWrites, 'notifications_app_settings'), { app_id: 2, topics: { proposals: 'mute' } });
  assert.ok(!a.isError, a.done);
  const p = n.__calls.find((c) => c.method === 'set_permission').args[1];
  assert.deepEqual(p.topics, [['proposals', { mute: null }]]);
  assert.equal(p.daily_cap, 50n);
  assert.match((await previewConfirm(tool(accountWrites, 'notifications_app_settings'), { app_id: 2, topics: { nope: 'mute' } })).preview, /BLOCKED[\s\S]*no topic "nope"/);
});

// ---------------- wallet_send ----------------

test('wallet_send: registered only with transfers allowed; blocked by the guard otherwise; sends with the fee', async () => {
  const names = (allow) => { const got = []; registerAccountWrites({ registerTool: (n) => got.push(n) }, { allowTransfers: allow }); return got; };
  assert.ok(!names(false).includes('wallet_send'));
  assert.ok(names(true).includes('wallet_send'));
  const icp = fake(icrc1Idl, ledgerImpl({ [`${ME}/`]: E8 }));
  useFakes(ME, { [ICP]: icp }, CAPS);
  assert.match((await previewConfirm(walletSend, { ledger: ICP, to: OTHER, amount: '0.01' })).preview, /BLOCKED[\s\S]*Plain ledger transfers to arbitrary accounts are disabled/);
  useFakes(ME, { [ICP]: icp }, { ...CAPS, allowTransfers: true });
  const r = await previewConfirm(walletSend, { ledger: ICP, to: OTHER, amount: '0.01', memo: 'hi' });
  assert.match(r.preview, /0\.0101 ICP on ryjl3/);
  assert.ok(!r.isError, r.done);
  const tr = icp.__calls.find((c) => c.method === 'icrc1_transfer').args[0];
  assert.equal(tr.to.owner.toText(), OTHER);
  assert.equal(tr.amount, 1_000_000n);
  assert.deepEqual(tr.fee, [FEE]);
  assert.equal(Buffer.from(tr.memo[0]).toString(), 'hi');
  assert.match((await previewConfirm(walletSend, { ledger: ICP, to: OTHER, amount: '2' })).preview, /BLOCKED[\s\S]*(Balance|Daily cap)/);
});
