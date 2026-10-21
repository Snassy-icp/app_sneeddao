// Pure helpers checked against the repository's vectors (test/canisters/motoko/ext.test.mo) and the
// frontend's rules (minimum bid, votable proposals, special prices).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountId, extTokenIdentifier, principalSubaccount } from '../src/chain.js';
import { minimumNextBid } from '../src/tools/w_sneedex.js';
import { votableNeurons, acceptingVotes, neuronIdHex } from '../src/tools/w_gov.js';
import { effectivePrice } from '../src/prices.js';

test('account ids (EXT / ICP) match the Motoko and frontend vectors', () => {
  assert.equal(accountId('2vxsx-fae'), '1c7a48ba6a562aa9eaa2481a9049cdf0433b9738c992d698c31d8abf89cadc79');
  assert.equal(accountId('ejz7n-lyaaa-aaaad-qmkzq-cai'), '57b5c336d5d863d011359c711130005b4a4714b4e8ec410a953e9cd3372bab1f');
  assert.equal(accountId('h4a5i-5vcfo-5rusv-fmb6m-vrkia-mjnkc-jpoow-h5mam-nthnm-ldqlr-bqe'), '722488363080fac9465ab57bdeee0d5d7284afcdbb166873b8955a3c1464ce64');
  const sub = new Uint8Array(32); sub[31] = 7;
  assert.equal(accountId('2vxsx-fae', sub), '24384226d8f679235b95a44562e147a4a7069251644833ba86a1e80ab18e95bd');
  assert.equal(accountId('2vxsx-fae', new Uint8Array(32)), accountId('2vxsx-fae'));
});

test('EXT token identifiers match the vectors', () => {
  assert.equal(extTokenIdentifier('gjv36-laaaa-aaaah-adyza-cai', 0), '2so2y-oykor-uwiaa-aaaaa-bya6g-iaqca-aaaaa-a');
  assert.equal(extTokenIdentifier('gjv36-laaaa-aaaah-adyza-cai', 42), 'b4tgl-3ikor-uwiaa-aaaaa-bya6g-iaqca-aaaav-a');
  assert.throws(() => extTokenIdentifier('gjv36-laaaa-aaaah-adyza-cai', -1));
});

test('wallet subaccount: length byte then the principal', () => {
  const s = principalSubaccount('ejz7n-lyaaa-aaaad-qmkzq-cai');
  assert.equal(s[0], 10);
  assert.equal(s.length, 32);
});

const view = ({ min, buyout, highest, mult }) => ({ offer: { min_bid_price: min != null ? [min] : [], buyout_price: buyout != null ? [buyout] : [], min_bid_increment_fee_multiple: mult != null ? [mult] : [] }, highest_bid: highest != null ? [{ amount: highest }] : [] });
test('minimum next bid mirrors SneedexOffer.jsx', () => {
  assert.equal(minimumNextBid(view({ min: 100n, buyout: 1000n }), 10n), 100n);
  assert.equal(minimumNextBid(view({ buyout: 1000n }), 10n), 1000n);
  assert.equal(minimumNextBid(view({ min: 100n, highest: 150n }), 10n), 151n);
  assert.equal(minimumNextBid(view({ min: 100n, highest: 150n, mult: 5n }), 10n), 200n);
  assert.equal(minimumNextBid(view({ min: 100n, highest: 995n, buyout: 1000n, mult: 5n }), 10n), 1000n);
});

const neuron = (hex) => ({ id: [{ id: Uint8Array.from(Buffer.from(hex, 'hex')) }] });
test('votable neurons: an uncast ballot exists', () => {
  const p = { ballots: [['aa', { cast_timestamp_seconds: 0n }], ['bb', { cast_timestamp_seconds: 5n }]] };
  assert.deepEqual(votableNeurons(p, [neuron('aa'), neuron('bb'), neuron('cc')]).map(neuronIdHex), ['aa']);
});
test('accepting votes until the (wait-for-quiet) deadline', () => {
  assert.equal(acceptingVotes({ wait_for_quiet_state: [{ current_deadline_timestamp_seconds: 200n }] }, 199), true);
  assert.equal(acceptingVotes({ wait_for_quiet_state: [{ current_deadline_timestamp_seconds: 200n }] }, 200), false);
  assert.equal(acceptingVotes({ wait_for_quiet_state: [], proposal_creation_timestamp_seconds: 100n, initial_voting_period_seconds: 50n }, 120), true);
});

test('effective price: lowest of regular, premium (members), admin, unexpired partner', () => {
  const now = 1000n;
  assert.deepEqual(effectivePrice({ regular: 100n, premium: 60n, isPremium: false, field: 'f', nowNs: now }), { price: 100n, tier: 'regular' });
  assert.equal(effectivePrice({ regular: 100n, premium: 60n, isPremium: true, field: 'f', nowNs: now }).price, 60n);
  assert.equal(effectivePrice({ regular: 100n, special: { admin: { f: [10n] } }, field: 'f', nowNs: now }).tier, 'admin');
  const partner = (exp) => ({ partner: { label: 'P', prices: { f: [20n] }, expires_at: exp } });
  assert.equal(effectivePrice({ regular: 100n, special: partner([2000n]), field: 'f', nowNs: now }).price, 20n);
  assert.equal(effectivePrice({ regular: 100n, special: partner([500n]), field: 'f', nowNs: now }).price, 100n);
  assert.equal(effectivePrice({ regular: 100n, special: partner([]), field: 'f', nowNs: now }).price, 20n);
});
