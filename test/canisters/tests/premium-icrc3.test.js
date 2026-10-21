// The Sneed Premium ICRC-3 activity log (spec/sneed_premium_icrc3.md): an empty log with the
// documented catalogue; one block per tier and config change, ICP purchase (with the ledger
// block of the sweep), deposit withdrawal, voting power claim, promo code create / claim /
// deactivate / reactivate / delete, admin set / extend / revoke; nothing for refused or failed
// calls; promo code texts never appear in any block (codes are logged by id); the hash chain
// and certified tip verify (lib/icrc3.js); spills into archives co-controlled by SNS root and
// registered through a hotkeyed neuron; the ingress guard; an upgrade keeps the log; and an
// upgrade from the production build (src/sneed_premium at 25b88246, module hash 1c403b42…,
// build/sneed_premium_prod.wasm) keeps memberships, tiers, promo codes, deposits, logs and
// config, gives the existing codes ids and starts an empty log.
// PREMIUM_WASM=sneed_premium_prod npx vitest run tests/premium-icrc3.test.js runs it against the production code.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import {
  createPic, install, actorAs, account, principalToSubaccount, admin, alice, bob, carol, user, ICP_LEDGER_ID, SNEED_SNS_ROOT, T,
  unwrap, errOf, wasm, refusedAtIngress, asUpdates,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { rllGovernanceIdl, neuronSpec, hex } from '../lib/idl-rll.js';
import { archiveIdl, btype, tx, verifyLog, icrc3Service } from '../lib/icrc3.js';
import { idlFactory as premiumIdl, init as premiumInit } from '../build/sneed_premium.did.js';

const PREMIUM_WASM = process.env.PREMIUM_WASM || 'sneed_premium';
const BLOCK_TYPES_URL = 'https://app.sneeddao.com/api/sneed_premium#block-types';
const CATALOGUE = [
  'premium_icp_purchase', 'premium_vp_claim', 'premium_deposit_withdraw',
  'premium_promo_create', 'premium_promo_claim', 'premium_promo_deactivate', 'premium_promo_reactivate', 'premium_promo_delete',
  'premium_admin_set', 'premium_admin_extend', 'premium_admin_revoke',
  'premium_tier_add', 'premium_tier_update', 'premium_tier_remove', 'premium_config_update',
];
const ICP = 100_000_000n;
const ICP_FEE = 10_000n;
const SEC = 1_000_000_000n;
const DAY = 86_400n * SEC;
const MONTH = 30n * DAY;
const YEAR = 365n * DAY;
const dave = user('dave');
const eve = user('eve');

// the canister's interface plus the log's (so the test runs against a build without it, and fails there)
const AdminError = IDL.Variant({ NotAuthorized: IDL.Null, NotFound: IDL.Null, InvalidInput: IDL.Text });
const fullIdl = ({ IDL }) => {
  const fields = Object.fromEntries(premiumIdl({ IDL })._fields);
  return IDL.Service({
    ...fields,
    ...icrc3Service(IDL),
    getPromoCodeIds: IDL.Func([], [IDL.Variant({ ok: IDL.Vec(IDL.Tuple(IDL.Text, IDL.Nat)), err: AdminError })], ['query']),
  });
};

let pic, rootKey, appSubnet;
let icpId, govId, premiumId;
let icp, gov, premium;

const as = (p, id = premiumId) => actorAs(pic, fullIdl, id, p);
const archiveActor = (id) => actorAs(pic, archiveIdl, id, admin);
const P = (p) => hex(p.toUint8Array());
const A = (owner, sub = null) => (sub ? [P(owner), hex(sub)] : [P(owner)]);
const plain = (v) => {
  if ('Nat' in v) return v.Nat;
  if ('Int' in v) return v.Int;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return hex(v.Blob);
  if ('Array' in v) return v.Array.map(plain);
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const advance = async (ns, ticks = 2) => { await pic.advanceTime(Number(ns / 1_000_000n)); await pic.tick(ticks); };
const depositAccount = (p, id = premiumId) => account(id, principalToSubaccount(p));
const initConfig = () => ({ admins: [bob], icpLedgerId: icpId, sneedGovernanceId: govId, paymentRecipient: account(carol), minClaimIntervalNs: DAY });

/// The whole log, verified (certificate, tree, phash chain, catalogue), as plain records { i, t, ts, ...tx }.
const rawLog = async (id = premiumId) => (await verifyLog(as(admin, id), id, rootKey, archiveActor)).blocks;
const verifiedLog = async (id = premiumId) => (await rawLog(id)).map((b, i) => ({ i, t: btype(b), ...plain(tx(b)) }));
const logLength = async (id = premiumId) => Number((await as(admin, id).icrc3_log_status()).log_length);
const since = async (mark, id = premiumId) => (await verifiedLog(id)).slice(mark);
const icpTier = (name, amount, duration, active = true) => ({ name, amountE8s: amount, durationNs: duration, active });
const vpTier = (name, min, duration, active = true) => ({ name, minVotingPowerE8s: min, durationNs: duration, active });
const icpTierV = (t) => ({ name: t.name, amount_e8s: t.amountE8s, duration_ns: t.durationNs, active: t.active ? 1n : 0n });
const vpTierV = (t) => ({ name: t.name, min_voting_power_e8s: t.minVotingPowerE8s, duration_ns: t.durationNs, active: t.active ? 1n : 0n });
const lastTx = async () => (await icp.get_transactions()).at(-1);

const codes = []; // every promo code text created in this file, checked against every block at the end

beforeAll(async () => {
  ({ pic, appSubnet, rootKey } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  govId = await install(pic, { name: 'MockRllGovernance', targetSubnetId: appSubnet });
  premiumId = await install(pic, { name: PREMIUM_WASM, initTypes: premiumInit({ IDL }), initArgs: [[initConfig()]], cycles: 50n * T, targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  gov = actorAs(pic, rllGovernanceIdl, govId, admin);
  premium = as(admin);
}, 120_000);

afterAll(async () => { await pic?.tearDown(); });

describe('fresh install', () => {
  it('has an empty log, the documented catalogue and ICRC-3 among its standards', async () => {
    expect(await as(alice).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], history_imported: false, last_block_hash: [] });
    expect(await as(alice).icrc3_get_tip_certificate()).toEqual([]);
    expect(await as(alice).icrc3_supported_block_types()).toEqual(CATALOGUE.map((block_type) => ({ block_type, url: BLOCK_TYPES_URL })));
    expect((await as(alice).icrc10_supported_standards()).map((s) => s.name)).toEqual(['ICRC-3', 'ICRC-10']);
    expect(await as(alice).icrc3_get_blocks([{ start: 0n, length: 10n }])).toEqual({ log_length: 0n, blocks: [], archived_blocks: [] });
    expect(await as(alice).icrc3_get_archives({ from: [] })).toEqual([]);
  });
});

describe('tiers and configuration', () => {
  it('log nothing for refused calls', async () => {
    const mark = await logLength();
    expect(errOf(await as(alice).removeIcpTier(0n))).toEqual({ NotAuthorized: null });
    expect(errOf(await as(alice).addAdmin(alice))).toEqual({ NotAuthorized: null });
    expect(errOf(await as(alice).setMinClaimInterval(1n))).toEqual({ NotAuthorized: null });
    expect(errOf(await as(alice).setMembershipAdmin(alice, 1n))).toEqual({ NotAuthorized: null });
    expect(errOf(await as(alice).revokeMembership(bob))).toEqual({ NotAuthorized: null });
    expect(errOf(await premium.addIcpTier(icpTier('zero', 0n, MONTH)))).toHaveProperty('InvalidInput');
    expect(errOf(await premium.addVpTier(vpTier('zero', 1n, 0n)))).toHaveProperty('InvalidInput');
    expect(errOf(await premium.updateIcpTier(9n, icpTier('x', ICP, MONTH)))).toEqual({ NotFound: null });
    expect(errOf(await premium.removeVpTier(9n))).toEqual({ NotFound: null });
    expect(errOf(await premium.createPromoCode({ durationNs: 0n, maxClaims: 1n, expiration: [], notes: [] }))).toHaveProperty('InvalidInput');
    expect(errOf(await premium.deactivatePromoCode('NOPE'))).toEqual({ NotFound: null });
    const none = { max_live_blocks: [5n], spill_batch_size: [], archive_max_blocks: [], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] };
    expect(errOf(await as(alice).admin_set_icrc3_settings(none))).toMatch(/admins/);
    expect(errOf(await as(alice).admin_icrc3_spill_now())).toMatch(/admins/);
    expect(errOf(await as(alice).admin_set_icrc3_proposal_neuron([]))).toMatch(/admins/);
    expect(errOf(await as(alice).admin_icrc3_register_archives_now())).toMatch(/admins/);
    expect(errOf(await as(alice).admin_icrc3_reset_archive_registration(alice))).toMatch(/admins/);
    expect(errOf(await as(alice).getPromoCodeIds())).toEqual({ NotAuthorized: null });
    expect(await logLength()).toBe(mark);
  });

  it('log every tier added, updated and removed, with the old tier', async () => {
    const mark = await logLength();
    const month = icpTier('1 Month', ICP, MONTH), year = icpTier('1 Year', 10n * ICP, YEAR), odd = icpTier('Odd', 3n * ICP, DAY, false);
    unwrap(await premium.addIcpTier(month));
    unwrap(await as(bob).addIcpTier(year));
    unwrap(await premium.addIcpTier(odd));
    const odd2 = icpTier('Odd', 3n * ICP, 2n * DAY, true);
    unwrap(await premium.updateIcpTier(2n, odd2));
    unwrap(await premium.removeIcpTier(2n));
    const bronze = vpTier('Bronze', 10n * ICP, MONTH);
    unwrap(await premium.addVpTier(bronze));
    const blocks = await since(mark);
    expect(blocks.map((b) => [b.t, b.kind, b.index, b.caller])).toEqual([
      ['premium_tier_add', 'icp', 0n, P(admin)], ['premium_tier_add', 'icp', 1n, P(bob)], ['premium_tier_add', 'icp', 2n, P(admin)],
      ['premium_tier_update', 'icp', 2n, P(admin)], ['premium_tier_remove', 'icp', 2n, P(admin)], ['premium_tier_add', 'vp', 0n, P(admin)],
    ]);
    expect(blocks[0].tier).toEqual(icpTierV(month));
    expect(blocks[2].tier).toEqual(icpTierV(odd));
    expect(blocks[3]).toMatchObject({ tier: icpTierV(odd2), old_tier: icpTierV(odd) });
    expect(blocks[4].old_tier).toEqual(icpTierV(odd2));
    expect(blocks[4].tier).toBeUndefined();
    expect(blocks[5].tier).toEqual(vpTierV(bronze));
  });

  it('log config changes with old values, and nothing for a change that changes nothing', async () => {
    const mark = await logLength();
    unwrap(await premium.addAdmin(dave));
    unwrap(await premium.addAdmin(dave)); // already an admin: nothing changed
    unwrap(await premium.removeAdmin(dave));
    unwrap(await premium.removeAdmin(dave)); // not an admin: nothing changed
    unwrap(await premium.setMinClaimInterval(2n * DAY));
    unwrap(await premium.setPaymentRecipient(account(dave, new Uint8Array(32).fill(1))));
    unwrap(await premium.setSneedGovernanceId(alice));
    unwrap(await premium.setIcpLedgerId(alice));
    unwrap(await as(bob).updateConfig({ ...initConfig(), admins: [bob, eve] })); // back, plus eve
    unwrap(await as(bob).updateConfig({ ...initConfig(), admins: [bob, eve] })); // the same again
    unwrap(await premium.removeAdmin(eve));
    const blocks = await since(mark);
    expect(blocks.every((b) => b.t === 'premium_config_update')).toBe(true);
    expect(blocks.map((b) => [b.caller, b.key, b.value, b.old_value])).toEqual([
      [P(admin), 'admin_added', P(dave), undefined],
      [P(admin), 'admin_removed', P(dave), undefined],
      [P(admin), 'min_claim_interval_ns', 2n * DAY, DAY],
      [P(admin), 'payment_recipient', A(dave, new Uint8Array(32).fill(1)), A(carol)],
      [P(admin), 'sneed_governance_id', P(alice), P(govId)],
      [P(admin), 'icp_ledger_id', P(alice), P(icpId)],
      [P(bob), 'admins', [P(bob), P(eve)], [P(bob)]],
      [P(bob), 'icp_ledger_id', P(icpId), P(alice)],
      [P(bob), 'sneed_governance_id', P(govId), P(alice)],
      [P(bob), 'payment_recipient', A(carol), A(dave, new Uint8Array(32).fill(1))],
      [P(bob), 'min_claim_interval_ns', DAY, 2n * DAY],
      [P(admin), 'admin_removed', P(eve), undefined],
    ]);
  });
});

describe('ICP purchases', () => {
  it('log nothing for refused or failed purchases', async () => {
    const mark = await logLength();
    expect(errOf(await as(Principal.anonymous()).purchaseWithIcp())).toEqual({ NotAuthorized: null });
    expect(errOf(await as(alice).purchaseWithIcp())).toEqual({ InvalidTier: null }); // nothing deposited
    await icp.mint(depositAccount(alice), ICP / 2n);
    expect(errOf(await as(alice).purchaseWithIcp())).toEqual({ InvalidTier: null }); // no tier of that amount
    await icp.mint(depositAccount(alice), ICP / 2n);
    await icp.set_paused(true);
    expect(errOf(await as(alice).purchaseWithIcp())).toHaveProperty('TransferFailed');
    await icp.set_paused(false);
    expect(await logLength()).toBe(mark);
    expect(await as(alice).checkMembership(alice)).toEqual({ NotFound: null });
  });

  it('log the sweep with its ledger block and the expirations, after the transfer', async () => {
    const mark = await logLength();
    const m = unwrap(await as(alice).purchaseWithIcp());
    const sweep = await lastTx();
    expect(sweep.to).toEqual(account(carol));
    await icp.mint(depositAccount(alice), 10n * ICP);
    const m2 = unwrap(await as(alice).purchaseWithIcp());
    const sweep2 = await lastTx();
    const blocks = await since(mark);
    expect(blocks).toEqual([
      { i: mark, t: 'premium_icp_purchase', caller: P(alice), tier: '1 Month', duration_ns: MONTH, amount_e8s: ICP, fee_e8s: ICP_FEE, to: A(carol), icp_tx: sweep.index, price_tier: 'regular', new_expiration: m.expiration },
      { i: mark + 1, t: 'premium_icp_purchase', caller: P(alice), tier: '1 Year', duration_ns: YEAR, amount_e8s: 10n * ICP, fee_e8s: ICP_FEE, to: A(carol), icp_tx: sweep2.index, price_tier: 'regular', previous_expiration: m.expiration, new_expiration: m2.expiration },
    ]);
    expect(m2.expiration).toBe(m.expiration + YEAR);
  });
});

describe('deposit withdrawals', () => {
  it('log nothing when there is nothing to withdraw or the ledger refuses', async () => {
    const mark = await logLength();
    expect(errOf(await as(Principal.anonymous()).withdrawDeposit())).toEqual({ NotAuthorized: null });
    expect(errOf(await as(eve).withdrawDeposit())).toHaveProperty('NothingToWithdraw');
    await icp.mint(depositAccount(eve), ICP / 3n);
    await icp.set_paused(true);
    expect(errOf(await as(eve).withdrawDeposit())).toHaveProperty('TransferFailed');
    await icp.set_paused(false);
    expect(await logLength()).toBe(mark);
  });

  it('log the transfer back with its ledger block', async () => {
    const mark = await logLength();
    const w = unwrap(await as(eve).withdrawDeposit());
    expect(await since(mark)).toEqual([
      { i: mark, t: 'premium_deposit_withdraw', caller: P(eve), amount_e8s: ICP / 3n - ICP_FEE, fee_e8s: ICP_FEE, to: A(eve), icp_tx: w.blockIndex },
    ]);
  });
});

describe('voting power claims', () => {
  const N1 = [1, 1, 1];
  beforeAll(async () => {
    await gov.set_parameters({ max_dissolve_delay_seconds: 1000n, max_dissolve_delay_bonus_percentage: 0n, neuron_minimum_dissolve_delay_to_vote_seconds: 100n, max_neuron_age_for_age_bonus: 1000n, max_age_bonus_percentage: 0n });
    await gov.add_neuron(neuronSpec({ id: N1, owner: bob, stake: 20n * ICP, dissolve: 500n }));
    await gov.add_neuron(neuronSpec({ id: [2, 2, 2], owner: dave, stake: ICP, dissolve: 500n }));
  });

  it('log nothing for refused claims', async () => {
    const mark = await logLength();
    expect(errOf(await as(Principal.anonymous()).claimWithVotingPower())).toEqual({ NotAuthorized: null });
    expect(errOf(await as(carol).claimWithVotingPower())).toEqual({ NoEligibleNeurons: null });
    expect(errOf(await as(dave).claimWithVotingPower())).toHaveProperty('InsufficientVotingPower');
    expect(await logLength()).toBe(mark);
  });

  it('log the voting power, the tier and the expirations; a rate-limited retry logs nothing', async () => {
    const mark = await logLength();
    const m = unwrap(await as(bob).claimWithVotingPower());
    expect(errOf(await as(bob).claimWithVotingPower())).toHaveProperty('AlreadyClaimedRecently');
    expect(await since(mark)).toEqual([
      { i: mark, t: 'premium_vp_claim', caller: P(bob), voting_power: 20n * ICP, tier: 'Bronze', duration_ns: MONTH, new_expiration: m.expiration },
    ]);
    await advance(DAY + SEC);
    const m2 = unwrap(await as(bob).claimWithVotingPower());
    const [b] = await since(mark + 1);
    expect(b).toMatchObject({ t: 'premium_vp_claim', caller: P(bob), previous_expiration: m.expiration, new_expiration: m2.expiration });
  });
});

describe('promo codes', () => {
  let first, second;
  it('log creation by id, never the code', async () => {
    const mark = await logLength();
    const exp = (await nowNs()) + 30n * DAY;
    first = unwrap(await as(bob).createPromoCode({ durationNs: 10n * DAY, maxClaims: 2n, expiration: [], notes: ['secret admin note'] }));
    second = unwrap(await premium.createPromoCode({ durationNs: DAY, maxClaims: 5n, expiration: [exp], notes: [] }));
    codes.push(first.code, second.code);
    expect(await since(mark)).toEqual([
      { i: mark, t: 'premium_promo_create', caller: P(bob), code_id: 0n, duration_ns: 10n * DAY, max_claims: 2n },
      { i: mark + 1, t: 'premium_promo_create', caller: P(admin), code_id: 1n, duration_ns: DAY, max_claims: 5n, code_expiration: exp },
    ]);
    expect(unwrap(await as(bob).getPromoCodeIds())).toEqual([[first.code, 0n], [second.code, 1n]]);
  });

  it('log claims with the claim count and expirations; refused claims log nothing', async () => {
    const mark = await logLength();
    const before = (await premium.getMembershipDetails(alice))[0].expiration;
    const m = unwrap(await as(alice).claimPromoCode(first.code));
    expect(errOf(await as(alice).claimPromoCode(first.code))).toEqual({ AlreadyClaimed: null });
    expect(errOf(await as(alice).claimPromoCode('WRONGCODE'))).toEqual({ InvalidCode: null });
    expect(errOf(await as(Principal.anonymous()).claimPromoCode(first.code))).toEqual({ NotAuthorized: null });
    const d = unwrap(await as(dave).claimPromoCode(first.code));
    expect(errOf(await as(carol).claimPromoCode(first.code))).toEqual({ CodeFullyClaimed: null });
    expect(await since(mark)).toEqual([
      { i: mark, t: 'premium_promo_claim', caller: P(alice), code_id: 0n, duration_ns: 10n * DAY, claim_count: 1n, previous_expiration: before, new_expiration: m.expiration },
      { i: mark + 1, t: 'premium_promo_claim', caller: P(dave), code_id: 0n, duration_ns: 10n * DAY, claim_count: 2n, new_expiration: d.expiration },
    ]);
  });

  it('log deactivation, reactivation and deletion by id', async () => {
    const mark = await logLength();
    unwrap(await premium.deactivatePromoCode(second.code));
    expect(errOf(await as(carol).claimPromoCode(second.code))).toEqual({ CodeInactive: null });
    unwrap(await as(bob).reactivatePromoCode(second.code));
    unwrap(await as(carol).claimPromoCode(second.code));
    unwrap(await premium.deletePromoCode(second.code));
    expect(errOf(await premium.deletePromoCode(second.code))).toEqual({ NotFound: null });
    expect(errOf(await premium.reactivatePromoCode(second.code))).toEqual({ NotFound: null });
    expect((await since(mark)).map((b) => [b.t, b.caller, b.code_id, b.claim_count])).toEqual([
      ['premium_promo_deactivate', P(admin), 1n, undefined],
      ['premium_promo_reactivate', P(bob), 1n, undefined],
      ['premium_promo_claim', P(carol), 1n, 1n],
      ['premium_promo_delete', P(admin), 1n, 1n],
    ]);
    expect(unwrap(await premium.getPromoCodeIds())).toEqual([[first.code, 0n]]);
    // a new code gets the next id, never a deleted one's
    const third = unwrap(await premium.createPromoCode({ durationNs: DAY, maxClaims: 1n, expiration: [], notes: [] }));
    codes.push(third.code);
    expect((await since(mark + 4))[0]).toMatchObject({ t: 'premium_promo_create', code_id: 2n });
  });
});

describe('admin grants', () => {
  it('log set, extend and revoke with old and new expirations; revoking a non-member logs nothing', async () => {
    const mark = await logLength();
    const exp = (await nowNs()) + 7n * DAY;
    unwrap(await premium.setMembershipAdmin(eve, exp));
    const ext = unwrap(await as(bob).extendMembershipAdmin(eve, 3n * DAY));
    unwrap(await premium.revokeMembership(eve));
    unwrap(await premium.revokeMembership(eve)); // not a member any more
    const fresh = unwrap(await premium.extendMembershipAdmin(eve, DAY));
    const later = exp + YEAR;
    unwrap(await premium.setMembershipAdmin(eve, later));
    expect(await since(mark)).toEqual([
      { i: mark, t: 'premium_admin_set', caller: P(admin), principal: P(eve), new_expiration: exp },
      { i: mark + 1, t: 'premium_admin_extend', caller: P(bob), principal: P(eve), duration_ns: 3n * DAY, previous_expiration: exp, new_expiration: ext.expiration },
      { i: mark + 2, t: 'premium_admin_revoke', caller: P(admin), principal: P(eve), previous_expiration: ext.expiration },
      { i: mark + 3, t: 'premium_admin_extend', caller: P(admin), principal: P(eve), duration_ns: DAY, new_expiration: fresh.expiration },
      { i: mark + 4, t: 'premium_admin_set', caller: P(admin), principal: P(eve), previous_expiration: fresh.expiration, new_expiration: later },
    ]);
  });
});

describe('verification and ingress', () => {
  it('verifies the whole log: certificate, tree, hash chain and catalogue', async () => {
    const blocks = await verifiedLog();
    expect(blocks).toHaveLength(await logLength());
    expect(new Set(blocks.map((b) => b.t))).toEqual(new Set(CATALOGUE));
  });

  it('never carries a promo code text, in any field, as text or bytes', async () => {
    expect(codes.length).toBe(3);
    const texts = [], blobs = [];
    const walk = (v) => {
      if ('Text' in v) texts.push(v.Text);
      else if ('Blob' in v) blobs.push(Buffer.from(v.Blob));
      else if ('Array' in v) v.Array.forEach(walk);
      else if ('Map' in v) v.Map.forEach(([k, x]) => { texts.push(k); walk(x); });
    };
    for (const b of await rawLog()) walk(b);
    for (const code of codes) {
      expect(texts.some((t) => t.includes(code))).toBe(false);
      expect(blobs.some((b) => b.includes(Buffer.from(code)))).toBe(false);
    }
    expect(texts.some((t) => t.includes('secret admin note'))).toBe(false);
  });

  it('refuses the log queries as update calls and oversized admin arguments at ingress', async () => {
    const u = actorAs(pic, asUpdates(fullIdl), premiumId, bob);
    expect((await as(bob).icrc3_log_status()).log_length).toEqual(expect.any(BigInt)); // answered as a query
    expect(await as(bob).icrc3_registration_status()).toHaveProperty('registrations');
    expect(await refusedAtIngress(u.icrc3_get_blocks([{ start: 0n, length: 1n }]))).toBe(true);
    expect(await refusedAtIngress(u.icrc3_get_archives({ from: [] }))).toBe(true);
    expect(await refusedAtIngress(u.icrc3_get_tip_certificate())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_supported_block_types())).toBe(true);
    expect(await refusedAtIngress(u.icrc10_supported_standards())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_log_status())).toBe(true);
    expect(await refusedAtIngress(u.icrc3_registration_status())).toBe(true);
    expect(await refusedAtIngress(u.getPromoCodeIds())).toBe(true);
    expect(await refusedAtIngress(premium.admin_set_icrc3_proposal_neuron([new Uint8Array(10_000)]))).toBe(true);
  }, 60_000);
});

describe('archives', () => {
  it('spill past the live limit into archives co-controlled by SNS root, and still verify', async () => {
    const before = await logLength();
    unwrap(await premium.admin_set_icrc3_settings({ max_live_blocks: [5n], spill_batch_size: [10n], archive_max_blocks: [20n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
    await advance(BigInt(15 * 60 + 5) * SEC, 100); // the 15-minute spill check
    const s = await premium.icrc3_log_status();
    expect(Number(s.log_length)).toBe(before + 3); // three settings changed
    expect(s.live_blocks).toBeLessThan(5n);
    expect(s.archives.length).toBeGreaterThanOrEqual(2);
    const archives = await as(bob).icrc3_get_archives({ from: [] });
    expect(archives.map((a) => a.canister_id.toText())).toEqual(s.archives.map((a) => a.canister_id.toText()));
    for (const a of archives) {
      expect((await pic.getControllers(a.canister_id)).map((p) => p.toText()).sort()).toEqual([premiumId.toText(), SNEED_SNS_ROOT.toText()].sort());
      expect((await archiveActor(a.canister_id).archive_status()).parent.toText()).toBe(premiumId.toText());
    }
    const r = await as(bob).icrc3_get_blocks([{ start: 0n, length: 3n }]);
    expect(r.blocks).toEqual([]);
    expect(r.archived_blocks).toHaveLength(1);
    const blocks = await verifiedLog(); // follows the callbacks into every archive
    expect(blocks).toHaveLength(Number(s.log_length));
    expect(blocks.slice(-3).map((b) => [b.t, b.key, b.caller])).toEqual([
      ['premium_config_update', 'icrc3_max_live_blocks', P(admin)], ['premium_config_update', 'icrc3_spill_batch_size', P(admin)], ['premium_config_update', 'icrc3_archive_max_blocks', P(admin)],
    ]);
    unwrap(await premium.admin_icrc3_spill_now());
    expect((await premium.icrc3_log_status()).live_blocks).toBe(0n);
    expect(await verifiedLog()).toHaveLength(Number(s.log_length));
  }, 120_000);

  it('registers its archives with the SNS through a hotkeyed neuron, and skips the step without one', async () => {
    const NEURON = new Uint8Array(32).fill(9);
    const archives = await as(bob).icrc3_get_archives({ from: [] });
    let s = await as(bob).icrc3_registration_status();
    expect(s.governance.toText()).toBe(govId.toText()); // the configured Sneed governance
    expect(s.neuron).toEqual([]);
    expect(unwrap(await premium.admin_icrc3_register_archives_now())).toBe(0n);
    expect(errOf(await premium.admin_set_icrc3_proposal_neuron([new Uint8Array(5)]))).toMatch(/32-byte/);
    await gov.add_hotkey(NEURON, premiumId);
    unwrap(await premium.admin_set_icrc3_proposal_neuron([NEURON]));
    expect((await verifiedLog()).at(-1)).toMatchObject({ t: 'premium_config_update', caller: P(admin), key: 'icrc3_proposal_neuron', value: hex(NEURON), old_value: 'none' });
    expect(unwrap(await premium.admin_icrc3_register_archives_now())).toBe(BigInt(archives.length));
    const proposals = await gov.list_proposals();
    expect(proposals.map((p) => p.canister_ids[0].toText())).toEqual(archives.map((a) => a.canister_id.toText()));
    for (const p of proposals) {
      expect(p.proposer.toText()).toBe(premiumId.toText());
      expect(p.title).toMatch(/^Register ICRC-3 archive .* of Sneed Premium$/);
      expect(p.url).toBe('https://app.sneeddao.com/api/sneed_premium#activity-log-icrc-3');
    }
    s = await as(bob).icrc3_registration_status();
    expect(s.registrations.map((x) => x.proposal_id[0])).toEqual(proposals.map((p) => p.id));
    expect(unwrap(await premium.admin_icrc3_register_archives_now())).toBe(0n);
    expect(unwrap(await premium.admin_icrc3_reset_archive_registration(archives[0].canister_id))).toBe(true);
    expect((await premium.admin_icrc3_repair_archive_controllers()).every(([, r]) => 'Ok' in r)).toBe(true);
    unwrap(await premium.admin_set_icrc3_settings({ max_live_blocks: [2000n], spill_batch_size: [500n], archive_max_blocks: [1_000_000n], archive_initial_cycles: [], archive_top_up_threshold: [], archive_top_up_amount: [] }));
  }, 120_000);
});

describe('upgrades', () => {
  it('keep the log, the archives and the certified tip', async () => {
    const before = await premium.icrc3_log_status();
    const blocksBefore = await verifiedLog();
    const ids = unwrap(await premium.getPromoCodeIds());
    await pic.upgradeCanister({ sender: admin, canisterId: premiumId, wasm: wasm(PREMIUM_WASM), arg: IDL.encode(premiumInit({ IDL }), [[]]) });
    await pic.tick(2);
    expect(await premium.icrc3_log_status()).toEqual(before);
    expect(await verifiedLog()).toEqual(blocksBefore); // the tip certificate is republished
    expect(unwrap(await premium.getPromoCodeIds())).toEqual(ids);
    unwrap(await premium.addAdmin(carol));
    const blocks = await verifiedLog();
    expect(blocks).toHaveLength(blocksBefore.length + 1);
    expect(blocks.at(-1)).toMatchObject({ t: 'premium_config_update', key: 'admin_added', value: P(carol) });
    unwrap(await premium.removeAdmin(carol));
  }, 120_000);

  it('from the production build keep memberships, tiers, promo codes, deposits, logs and config, and start an empty log', async () => {
    const oldId = await install(pic, { name: 'sneed_premium_prod', initTypes: premiumInit({ IDL }), initArgs: [[initConfig()]], cycles: 20n * T, targetSubnetId: appSubnet });
    const old = as(admin, oldId);
    await expect(old.icrc3_log_status()).rejects.toThrow(); // the production code has no log
    unwrap(await old.addIcpTier(icpTier('1 Month', ICP, MONTH)));
    unwrap(await old.addVpTier(vpTier('Bronze', 10n * ICP, MONTH)));
    await icp.mint(depositAccount(alice, oldId), ICP);
    unwrap(await as(alice, oldId).purchaseWithIcp());
    unwrap(await as(bob, oldId).claimWithVotingPower());
    const c1 = unwrap(await old.createPromoCode({ durationNs: DAY, maxClaims: 3n, expiration: [], notes: ['n'] }));
    const c2 = unwrap(await old.createPromoCode({ durationNs: 2n * DAY, maxClaims: 1n, expiration: [], notes: [] }));
    codes.push(c1.code, c2.code);
    unwrap(await as(dave, oldId).claimPromoCode(c1.code));
    unwrap(await old.setMembershipAdmin(eve, (await nowNs()) + YEAR));
    await icp.mint(depositAccount(carol, oldId), ICP / 4n); // a deposit that matches no tier, waiting
    const snapshot = async () => ({
      members: await old.getAllMemberships(),
      icpTiers: await old.getAllIcpTiers(),
      vpTiers: await old.getAllVotingPowerTiers(),
      codes: unwrap(await old.getPromoCodes()),
      claims: unwrap(await old.getPromoCodeClaims(c1.code)),
      claimLog: await old.getClaimLog(0n, 1000n),
      paymentLog: await old.getIcpPaymentLog(0n, 1000n),
      stats: await old.getPaymentStats(),
      config: await old.getConfig(),
    });
    const before = await snapshot();
    expect(before.members).toHaveLength(4);

    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(PREMIUM_WASM), arg: IDL.encode(premiumInit({ IDL }), [[]]) });
    await pic.tick(2);
    expect(await snapshot()).toEqual(before);
    expect(await as(alice, oldId).icrc3_log_status()).toMatchObject({ log_length: 0n, live_blocks: 0n, archives: [], last_block_hash: [], history_imported: false });
    expect(await as(alice, oldId).icrc3_get_tip_certificate()).toEqual([]);
    expect(unwrap(await old.getPromoCodeIds())).toEqual([[c1.code, 0n], [c2.code, 1n]]); // existing codes got ids in list order
    // the rate limit survives
    expect(errOf(await as(bob, oldId).claimWithVotingPower())).toHaveProperty('AlreadyClaimedRecently');

    // the first change after the upgrade is block 0, without phash; the log verifies
    unwrap(await as(carol, oldId).claimPromoCode(c1.code));
    const w = unwrap(await as(carol, oldId).withdrawDeposit()); // the waiting deposit comes back
    expect(w.amountE8s).toBe(ICP / 4n - ICP_FEE);
    unwrap(await old.deactivatePromoCode(c2.code));
    const c3 = unwrap(await old.createPromoCode({ durationNs: DAY, maxClaims: 1n, expiration: [], notes: [] }));
    codes.push(c3.code);
    const blocks = await verifiedLog(oldId);
    expect(blocks.map((b) => [b.t, b.code_id])).toEqual([
      ['premium_promo_claim', 0n], ['premium_deposit_withdraw', undefined], ['premium_promo_deactivate', 1n], ['premium_promo_create', 2n],
    ]);
    expect(blocks[0]).toMatchObject({ i: 0, caller: P(carol), claim_count: 2n });
    expect(blocks[1]).toMatchObject({ caller: P(carol), amount_e8s: ICP / 4n - ICP_FEE, icp_tx: w.blockIndex });
    expect((await rawLog(oldId))[0].Map.some(([k]) => k === 'phash')).toBe(false);
  }, 120_000);
});
