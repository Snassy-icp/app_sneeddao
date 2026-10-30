// Fixes from the phase-1 live run's report, each with a test that fails on the old code:
// the buyout summary, the sns_vote link of another SNS, refused confirmations not audited, and
// mon_read's "next check null".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { primeTokenInfo } from '../src/format.js';
import { handleWrite } from '../src/writes.js';
import { configureIc } from '../src/ic.js';
import { sneedexWrites } from '../src/tools/w_sneedex.js';
import { govWrites } from '../src/tools/w_gov.js';
import { idlFactory as sneedexIdl } from '../src/idl/sneedex.did.js';
import { idlFactory as icrc1Idl } from '../src/idl/icrc1_ledger.did.js';
import { idlFactory as govIdl } from '../src/idl/sns_governance.did.js';
import { idlFactory as premiumIdl } from '../src/idl/sneed_premium.did.js';
import { snsWasmIdlFactory } from '../src/chain.js';
import { fake, useFakes, previewConfirm, ledgerImpl, def, retType, P, sub, tool } from './candid-fake.mjs';

const ICP = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const DEX = 'igm46-laaaa-aaaae-qgwra-cai';
const ME = 'zcwrc-qhmeq-amaxy-5vluk-urvu5-bfuwr-l6t2t-63udo-vllgu-fdlsm-2ae';
const SELLER = 'tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae';
const E8 = 100_000_000n;
configureIc({ host: 'http://127.0.0.1:9', canisters: { sneedex: DEX, sneed_premium: 'sf5tm-dqaaa-aaaae-qgyla-cai' } });
primeTokenInfo({ ledger: ICP, name: 'Internet Computer', symbol: 'ICP', decimals: 8, fee: '10000' });

const offerView = (state = { Active: null }) => ({
  ...def(retType(sneedexIdl, 'getOfferView', { unwrap: 1 })),
  offer: { ...def(retType(sneedexIdl, 'queryOffer', { unwrap: 1 })), id: 7n, creator: P(SELLER), price_token_ledger: P(ICP), buyout_price: [E8 / 10n], state, assets: [] },
});

test('sneedex_buyout: the summary says the offer was bought out, not "bid N placed"', async () => {
  let state = { Active: null };
  const dex = fake(sneedexIdl, {
    getOfferView: () => [offerView(state)],
    reserveBid: () => ({ ok: 12n }),
    getBidEscrowSubaccount: () => sub(5),
    confirmBid: () => { state = { Completed: { winning_bid_id: 12n, completion_time: 1n } }; return { ok: null }; },
    queryOffer: () => [offerView(state).offer],
  });
  useFakes(ME, { [DEX]: dex, [ICP]: fake(icrc1Idl, ledgerImpl({ [`${ME}/`]: E8 })) }, { caps: { [ICP]: '1' } });
  const r = await previewConfirm(tool(sneedexWrites, 'sneedex_buyout'), { offer_id: 7 });
  assert.ok(!r.isError, r.done);
  assert.match(r.done, /offer 7 bought out \(bid 12\): the offer is completed/);
  assert.doesNotMatch(r.done, /bid 12 placed/);
});

test('sneedex_create_offer: a Premium member\'s creation fee is labelled premium, not "regular" (found live)', async () => {
  const PREM = 'sf5tm-dqaaa-aaaae-qgyla-cai';
  const SNEED = 'hvgxa-wqaaa-aaaaq-aacia-cai';
  primeTokenInfo({ ledger: SNEED, name: 'Sneed', symbol: 'SNEED', decimals: 8, fee: '1000' });
  const dex = fake(sneedexIdl, {
    getFeeConfig: () => ({ regularCreationFeeE8s: 1_000_000n, premiumCreationFeeE8s: 0n, regularAuctionCutBps: 250n, premiumAuctionCutBps: 175n }),
    getOfferCreationPaymentSubaccount: () => sub(2),
    get_special_prices_for: () => ({ admin_prices: [], partner: [] }),
  });
  const premium = fake(premiumIdl, { checkMembership: () => ({ Active: { expiration: 1n } }) });
  useFakes(ME, { [DEX]: dex, [PREM]: premium, [ICP]: fake(icrc1Idl, ledgerImpl({ [`${ME}/`]: E8 })), [SNEED]: fake(icrc1Idl, ledgerImpl({ [`${ME}/`]: E8 })) }, { caps: { [ICP]: '1', [SNEED]: '1000' } });
  const r = await handleWrite(tool(sneedexWrites, 'sneedex_create_offer'), { assets: [{ type: 'token', ledger: SNEED, amount: '0.01' }], buyout: '1' });
  const p = r.content[0].text;
  assert.match(p, /Creation fee: 0 ICP \(premium, Premium member\)/);
  assert.doesNotMatch(p, /\(regular, Premium member\)/);
});

// ---- sns_vote on another SNS: the link names that SNS's root ----
const OTHER_GOV = 'zqfso-syaaa-aaaaq-aaafq-cai';
const OTHER_ROOT = 'zxeu2-7aaaa-aaaaq-aaafa-cai';
const SNS_W = 'qaa6y-5yaaa-aaaaa-aaafa-cai';

test('sns_vote: the proposal link of another SNS names its root, not Sneed DAO\'s', async () => {
  const nid = Uint8Array.from([0xaa, 0x01]);
  const neuron = { ...def(retType(govIdl, 'list_neurons')._fields.find(([k]) => k === 'neurons')[1]._type), id: [{ id: nid }], permissions: [{ principal: [P(ME)], permission_type: [3, 4] }] };
  const proposal = {
    ...def(retType(govIdl, 'get_proposal')._fields[0][1]._type._fields.find(([k]) => k === 'Proposal')[1]),
    id: [{ id: 3n }], proposal: [{ title: 'Other', url: '', summary: '', action: [] }],
    ballots: [['aa01', { vote: 0, voting_power: 1n, cast_timestamp_seconds: 0n }]],
    proposal_creation_timestamp_seconds: BigInt(Math.floor(Date.now() / 1000)) - 10n, initial_voting_period_seconds: 86400n,
  };
  const gov = fake(govIdl, {
    list_neurons: () => ({ neurons: [neuron] }),
    get_proposal: () => ({ result: [{ Proposal: proposal }] }),
    manage_neuron: () => ({ command: [{ RegisterVote: {} }] }),
  });
  const snsw = fake(snsWasmIdlFactory, { list_deployed_snses: () => ({ instances: [{ root_canister_id: [P(OTHER_ROOT)], governance_canister_id: [P(OTHER_GOV)], index_canister_id: [], swap_canister_id: [], ledger_canister_id: [] }] }) });
  useFakes(ME, { [OTHER_GOV]: gov, [SNS_W]: snsw });
  const r = await previewConfirm(tool(govWrites, 'sns_vote'), { proposal_id: 3, vote: 'yes', governance: OTHER_GOV });
  assert.ok(!r.isError, r.done);
  assert.match(r.done, new RegExp(`/proposal\\?proposalid=3&sns=${OTHER_ROOT}`));
  assert.doesNotMatch(r.done, /fp274-iaaaa-aaaaq-aacha-cai/);
});

test('a refused confirmation is audited, without the token', async () => {
  const dex = fake(sneedexIdl, { getOfferView: () => [offerView()] });
  const g = useFakes(ME, { [DEX]: dex, [ICP]: fake(icrc1Idl, ledgerImpl({ [`${ME}/`]: E8 })) }, { caps: { [ICP]: '1' } });
  const token = 'deadbeefdeadbeefdeadbeef';
  const r = await handleWrite(tool(sneedexWrites, 'sneedex_buyout'), { offer_id: 7, confirm: token });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Not executed: Unknown or already used confirmation token/);
  const entries = g.memAudit ?? [];
  assert.equal(entries.length, 1, 'one audit entry for the refused confirm');
  assert.equal(entries[0].tool, 'sneedex_buyout');
  assert.match(entries[0].refused, /Unknown or already used/);
  assert.doesNotMatch(JSON.stringify(entries[0], (k, v) => (typeof v === 'bigint' ? String(v) : v)), new RegExp(token));
});

test('mon_read: a watch not checked yet says so instead of "next check null"', async () => {
  const reads = await import('../src/tools/reads.js');
  assert.equal(typeof reads.monWatchLine, 'function', 'mon_read formats a watch with monWatchLine');
  const w = { name: 'Sneed', target: { sns: P('fp274-iaaaa-aaaaq-aacha-cai') }, next_check_at: 0n, price_per_check_e8s: 1000n, settings: { every_min: 60n } };
  const line = reads.monWatchLine(w);
  assert.doesNotMatch(line, /null/);
  assert.match(line, /first check pending/);
  assert.match(reads.monWatchLine({ ...w, next_check_at: 1_800_000_000_000_000_000n }), /next check 2027-/);
  assert.match(reads.monWatchLine(w, { paused: true }), /checks paused/);
});
