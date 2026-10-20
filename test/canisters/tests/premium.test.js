// Integration tests of the sneed_premium canister on PocketIC with a mock ICP
// ledger (at the real ICP ledger id) and a mock SNS governance: the init
// config, admin guards, ICP tiers and purchases through the deposit
// subaccount (payment forwarded to the recipient, renewals, wrong amounts,
// ledger outage), membership states across time, admin grants, voting power
// claims from neurons, promo codes, the claim and payment logs and an upgrade.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import {
  createPic, install, actorAs, account, principalToSubaccount,
  admin, alice, bob, carol, user, ICP_LEDGER_ID, SNEED_GOVERNANCE, T, unwrap, errOf, wasm, refusedAtIngress,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { rllGovernanceIdl, neuronSpec } from '../lib/idl-rll.js';
import { idlFactory as premiumIdl, init as premiumInit } from '../build/sneed_premium.did.js';

const ICP = 100_000_000n;
const ICP_FEE = 10_000n;
const SEC = 1_000_000_000n;
const DAY = 86_400n * SEC;
const MONTH = 30n * DAY;
const YEAR = 365n * DAY;
const dave = user('dave');

let pic, appSubnet;
let icpId, govId, premiumId;
let icp, gov, premium, premiumAlice, premiumBob, premiumCarol, premiumAnon;

const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const nowSec = async () => (await nowNs()) / SEC;
const balance = (acct) => icp.icrc1_balance_of(acct);
const depositAccount = (p) => account(premiumId, principalToSubaccount(p));
const advance = async (ns) => { await pic.advanceTime(Number(ns / 1_000_000n)); await pic.tick(2); };
const initConfig = () => ({
  admins: [bob], icpLedgerId: icpId, sneedGovernanceId: govId,
  paymentRecipient: account(carol), minClaimIntervalNs: DAY,
});

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  govId = await install(pic, { name: 'MockRllGovernance', targetSubnetId: appSubnet });
  premiumId = await install(pic, { name: 'sneed_premium', initTypes: premiumInit({ IDL }), initArgs: [[initConfig()]], cycles: 20n * T, targetSubnetId: appSubnet });
  icp = actorAs(pic, ledgerIdl, icpId, admin);
  gov = actorAs(pic, rllGovernanceIdl, govId, admin);
  premium = actorAs(pic, premiumIdl, premiumId, admin);
  premiumAlice = actorAs(pic, premiumIdl, premiumId, alice);
  premiumBob = actorAs(pic, premiumIdl, premiumId, bob);
  premiumCarol = actorAs(pic, premiumIdl, premiumId, carol);
  premiumAnon = actorAs(pic, premiumIdl, premiumId, Principal.anonymous());
});

afterAll(async () => { await pic?.tearDown(); });

const maxN = (a, b) => (a > b ? a : b);

describe('fresh install', () => {
  it('runs with the init config and nothing else', async () => {
    const cfg = await premium.getConfig();
    expect(cfg.admins.map((p) => p.toText())).toEqual([bob.toText()]);
    expect(cfg.icpLedgerId.toText()).toBe(icpId.toText());
    expect(cfg.sneedGovernanceId.toText()).toBe(govId.toText());
    expect(cfg.paymentRecipient.owner.toText()).toBe(carol.toText());
    expect(cfg.minClaimIntervalNs).toBe(DAY);
    expect(await premium.getIcpTiers()).toEqual([]);
    expect(await premium.getAllIcpTiers()).toEqual([]);
    expect(await premium.getVotingPowerTiers()).toEqual([]);
    expect(await premium.getAllVotingPowerTiers()).toEqual([]);
    expect(await premium.getActivePremiumMembers()).toEqual([]);
    expect(await premium.getAllMemberships()).toEqual([]);
    expect(await premium.checkMembership(alice)).toEqual({ NotFound: null });
    expect((await premium.getCanisterId()).toText()).toBe(premiumId.toText());
    const stats = await premium.getPaymentStats();
    expect(stats).toEqual({ total_icp_payments: 0n, total_claims: 0n, payment_log_size: 0n, total_promo_claims: 0n, total_icp_collected_e8s: 0n, total_vp_claims: 0n, claim_log_size: 0n });
  });

  it('falls back to the mainnet ids and a placeholder recipient without an init config', async () => {
    const bareId = await install(pic, { name: 'sneed_premium', initTypes: premiumInit({ IDL }), initArgs: [[]], cycles: 5n * T, targetSubnetId: appSubnet });
    const bare = actorAs(pic, premiumIdl, bareId, admin);
    const cfg = await bare.getConfig();
    expect(cfg.admins).toEqual([]);
    expect(cfg.icpLedgerId.toText()).toBe(ICP_LEDGER_ID.toText());
    expect(cfg.sneedGovernanceId.toText()).toBe(SNEED_GOVERNANCE.toText());
    expect(cfg.paymentRecipient).toEqual({ owner: Principal.fromText('aaaaa-aa'), subaccount: [] });
    expect(cfg.minClaimIntervalNs).toBe(DAY);
    expect(await bare.isCallerAdmin()).toBe(true); // the controller
    expect(await actorAs(pic, premiumIdl, bareId, alice).isCallerAdmin()).toBe(false);
  });

  it('derives the deposit account from the principal (length byte, bytes, zero padding)', async () => {
    const acct = await premium.getDepositAccount(alice);
    expect(acct.owner.toText()).toBe(premiumId.toText());
    expect(Array.from(acct.subaccount[0])).toEqual(Array.from(principalToSubaccount(alice)));
    const bytes = alice.toUint8Array();
    expect(acct.subaccount[0][0]).toBe(bytes.length);
    expect(acct.subaccount[0]).toHaveLength(32);
  });

  it('treats the controller and the configured admins as admins, nobody else', async () => {
    expect(await premium.isCallerAdmin()).toBe(true);
    expect(await premiumBob.isCallerAdmin()).toBe(true);
    expect(await premiumAlice.isCallerAdmin()).toBe(false);
    expect(await premiumAnon.isCallerAdmin()).toBe(false);
  });
});

describe('admin guards', () => {
  const tier = { name: 'x', amountE8s: ICP, durationNs: MONTH, active: true };
  const vpTier = { name: 'x', minVotingPowerE8s: 1n, durationNs: MONTH, active: true };
  it('refuse every mutation from a non-admin', async () => {
    const calls = [
      premiumAlice.removeIcpTier(0n), premiumAlice.removeVpTier(0n),
      premiumAlice.setMembershipAdmin(alice, 1n), premiumAlice.extendMembershipAdmin(alice, 1n), premiumAlice.revokeMembership(bob),
      premiumAlice.addAdmin(alice), premiumAlice.removeAdmin(bob),
      premiumAlice.setIcpLedgerId(alice), premiumAlice.setSneedGovernanceId(alice), premiumAlice.setPaymentRecipient(account(alice)), premiumAlice.setMinClaimInterval(1n),
    ];
    for (const r of await Promise.all(calls)) expect(errOf(r)).toEqual({ NotAuthorized: null });
    // the admin tools with free-form content are refused at ingress
    for (const call of [
      () => premiumAlice.addIcpTier(tier), () => premiumAlice.updateIcpTier(0n, tier), () => premiumAlice.addVpTier(vpTier), () => premiumAlice.updateVpTier(0n, vpTier),
      () => premiumAlice.updateConfig(initConfig()), () => premiumAlice.createPromoCode({ durationNs: DAY, maxClaims: 1n, expiration: [], notes: [] }),
      () => premiumAlice.deactivatePromoCode('X'), () => premiumAlice.reactivatePromoCode('X'), () => premiumAlice.deletePromoCode('X'),
    ]) expect(await refusedAtIngress(call())).toBe(true);
    expect(await premium.getAllIcpTiers()).toEqual([]);
    expect(await premium.getAllVotingPowerTiers()).toEqual([]);
    expect((await premium.getConfig()).admins.map((p) => p.toText())).toEqual([bob.toText()]);
  });

  it('hide the admin queries from non-admins', async () => {
    expect(await premiumAlice.getAllMemberships()).toEqual([]);
    expect(errOf(await premiumAlice.getPromoCodes())).toEqual({ NotAuthorized: null });
    expect(errOf(await premiumAlice.getPromoCodeClaims('X'))).toEqual({ NotAuthorized: null });
    // these assert instead of returning an error: the query is rejected
    await expect(premiumAlice.getClaimLog(0n, 10n)).rejects.toThrow();
    await expect(premiumAlice.getIcpPaymentLog(0n, 10n)).rejects.toThrow();
    await expect(premiumAlice.getClaimLogCount()).rejects.toThrow();
    await expect(premiumAlice.getIcpPaymentLogCount()).rejects.toThrow();
    // the payment totals are public (the /revenue page); the logs stay admin only
    expect(await premiumAlice.getPaymentStats()).toHaveProperty('total_icp_collected_e8s');
    expect(await premiumAnon.getAllMemberships()).toEqual([]);
  });
});

describe('ICP tiers', () => {
  it('need a positive amount and duration', async () => {
    expect(errOf(await premium.addIcpTier({ name: 'zero', amountE8s: 0n, durationNs: MONTH, active: true }))).toEqual({ InvalidInput: 'Amount and duration must be positive' });
    expect(errOf(await premium.addIcpTier({ name: 'zero', amountE8s: ICP, durationNs: 0n, active: true }))).toEqual({ InvalidInput: 'Amount and duration must be positive' });
    expect(await premium.getAllIcpTiers()).toEqual([]);
  });

  it('are listed in order, active ones publicly, all of them to the admin view', async () => {
    unwrap(await premium.addIcpTier({ name: '1 Month', amountE8s: ICP, durationNs: MONTH, active: true }));
    unwrap(await premiumBob.addIcpTier({ name: '1 Year', amountE8s: 10n * ICP, durationNs: YEAR, active: true }));
    unwrap(await premium.addIcpTier({ name: 'Old promo', amountE8s: 5n * ICP, durationNs: YEAR, active: false }));
    expect((await premium.getIcpTiers()).map((t) => t.name)).toEqual(['1 Month', '1 Year']);
    expect((await premium.getAllIcpTiers()).map((t) => t.name)).toEqual(['1 Month', '1 Year', 'Old promo']);
  });

  it('are updated and removed by index', async () => {
    expect(errOf(await premium.updateIcpTier(3n, { name: 'x', amountE8s: ICP, durationNs: MONTH, active: true }))).toEqual({ NotFound: null });
    expect(errOf(await premium.removeIcpTier(3n))).toEqual({ NotFound: null });
    unwrap(await premium.updateIcpTier(2n, { name: 'Old promo', amountE8s: 5n * ICP, durationNs: YEAR, active: true }));
    expect((await premium.getIcpTiers()).map((t) => t.name)).toEqual(['1 Month', '1 Year', 'Old promo']);
    unwrap(await premium.removeIcpTier(2n));
    expect((await premium.getAllIcpTiers()).map((t) => t.name)).toEqual(['1 Month', '1 Year']);
  });
});

describe('purchasing with ICP', () => {
  let firstExpiration;

  it('refuses anonymous callers and empty deposit accounts', async () => {
    expect(errOf(await premiumAnon.purchaseWithIcp())).toEqual({ NotAuthorized: null });
    expect(errOf(await premiumAlice.purchaseWithIcp())).toEqual({ InvalidTier: null });
    expect(await premium.checkMembership(alice)).toEqual({ NotFound: null });
  });

  it('matches the deposited amount to a tier exactly: a partial deposit stays in the subaccount', async () => {
    await icp.mint(depositAccount(alice), ICP / 2n);
    expect(errOf(await premiumAlice.purchaseWithIcp())).toEqual({ InvalidTier: null });
    expect(await balance(depositAccount(alice))).toBe(ICP / 2n);
    expect(await balance(account(carol))).toBe(0n);
  });

  it('forwards the deposit minus the ledger fee to the recipient and grants the tier duration', async () => {
    await icp.mint(depositAccount(alice), ICP / 2n); // tops up to exactly 1 ICP
    const m = unwrap(await premiumAlice.purchaseWithIcp());
    expect(m.principal.toText()).toBe(alice.toText());
    expect(m.expiration).toBe(m.lastUpdated + MONTH);
    expect(m.lastUpdated - (await nowNs())).toBeLessThan(10n * SEC);
    firstExpiration = m.expiration;
    expect(await balance(depositAccount(alice))).toBe(0n);
    expect(await balance(account(carol))).toBe(ICP - ICP_FEE);
    expect(await premium.checkMembership(alice)).toEqual({ Active: { expiration: firstExpiration } });
    expect((await premium.getActivePremiumMembers()).map((p) => p.toText())).toEqual([alice.toText()]);
    const log = await premium.getIcpPaymentLog(0n, 10n);
    expect(log.total_count).toBe(1n);
    expect(log.has_more).toBe(false);
    expect(log.payments[0]).toMatchObject({ id: 0n, payer: alice, amountE8s: ICP, netAmountE8s: ICP - ICP_FEE, tierName: '1 Month', durationGrantedNs: MONTH });
    const txs = await icp.get_transactions();
    expect(log.payments[0].icpTransactionId).toBe(txs.at(-1).index);
    expect(txs.at(-1).to).toEqual(account(carol));
    const claims = await premium.getClaimLog(0n, 10n);
    expect(claims.claims[0]).toMatchObject({ id: 0n, claimant: alice, claimType: { IcpPayment: null }, tierName: '1 Month', previousExpiration: 0n, newExpiration: firstExpiration, icpAmountE8s: [ICP], votingPowerE8s: [], promoCode: [] });
    expect(await premium.getPaymentStats()).toMatchObject({ total_icp_payments: 1n, total_icp_collected_e8s: ICP, total_claims: 1n, claim_log_size: 1n, payment_log_size: 1n });
  });

  it('adds a renewal on top of the running membership', async () => {
    await icp.mint(depositAccount(alice), 10n * ICP);
    const m = unwrap(await premiumAlice.purchaseWithIcp());
    expect(m.expiration).toBe(firstExpiration + YEAR); // additive, not from now
    expect(await balance(account(carol))).toBe(11n * ICP - 2n * ICP_FEE);
    expect(await premium.checkMembership(alice)).toEqual({ Active: { expiration: firstExpiration + YEAR } });
    expect((await premium.getIcpPaymentLog(0n, 10n)).payments.map((p) => p.tierName)).toEqual(['1 Year', '1 Month']); // newest first
    expect(await premium.getIcpPaymentLogCount()).toBe(2n);
  });

  it('keeps the deposit and the membership when the ledger refuses the transfer', async () => {
    await icp.mint(depositAccount(bob), ICP);
    await icp.set_paused(true);
    expect(errOf(await premiumBob.purchaseWithIcp())).toEqual({ TransferFailed: 'Temporarily unavailable' });
    await icp.set_paused(false);
    expect(await balance(depositAccount(bob))).toBe(ICP);
    expect(await premium.checkMembership(bob)).toEqual({ NotFound: null });
    expect(await premium.getIcpPaymentLogCount()).toBe(2n);
    const m = unwrap(await premiumBob.purchaseWithIcp());
    expect(m.expiration).toBe(m.lastUpdated + MONTH);
    expect(await balance(depositAccount(bob))).toBe(0n);
  });

  it('refuses a tier that is not active', async () => {
    unwrap(await premium.updateIcpTier(0n, { name: '1 Month', amountE8s: ICP, durationNs: MONTH, active: false }));
    await icp.mint(depositAccount(carol), ICP);
    expect(errOf(await premiumCarol.purchaseWithIcp())).toEqual({ InvalidTier: null });
    unwrap(await premium.updateIcpTier(0n, { name: '1 Month', amountE8s: ICP, durationNs: MONTH, active: true }));
    unwrap(await premiumCarol.purchaseWithIcp());
    expect(await balance(account(carol))).toBe(12n * ICP - 4n * ICP_FEE + ICP); // recipient is carol herself: her own payment came back minus the fee
  });

  it('reports InsufficientPayment only when a tier amount does not even cover the ledger fee', async () => {
    unwrap(await premium.addIcpTier({ name: 'dust', amountE8s: ICP_FEE, durationNs: DAY, active: true }));
    await icp.mint(depositAccount(dave), ICP_FEE);
    const premiumDave = actorAs(pic, premiumIdl, premiumId, dave);
    expect(errOf(await premiumDave.purchaseWithIcp())).toEqual({ InsufficientPayment: { required: ICP_FEE, received: ICP_FEE } });
    unwrap(await premium.removeIcpTier(2n));
  });
});

// added 2026-10-20: a deposit that matches no tier used to be stranded in the deposit subaccount
describe('withdrawing a deposit', () => {
  const eve = user('eve');
  const premiumEve = () => actorAs(pic, premiumIdl, premiumId, eve);

  it('refuses the anonymous principal and a subaccount holding no more than the fee', async () => {
    expect(errOf(await premiumAnon.withdrawDeposit())).toEqual({ NotAuthorized: null });
    expect(errOf(await premiumEve().withdrawDeposit())).toEqual({ NothingToWithdraw: { balance: 0n, fee: ICP_FEE } });
    expect(errOf(await actorAs(pic, premiumIdl, premiumId, dave).withdrawDeposit())).toEqual({ NothingToWithdraw: { balance: ICP_FEE, fee: ICP_FEE } }); // the dust above
  });

  it('returns an unmatched deposit, minus the fee, to the caller and touches nobody else', async () => {
    await icp.mint(depositAccount(eve), (7n * ICP) / 10n);
    await icp.mint(depositAccount(bob), ICP / 3n);
    const carolBefore = await balance(account(carol));
    expect(errOf(await premiumEve().purchaseWithIcp())).toEqual({ InvalidTier: null });
    const w = unwrap(await premiumEve().withdrawDeposit());
    expect(w.amountE8s).toBe((7n * ICP) / 10n - ICP_FEE);
    expect(w.to).toEqual(account(eve));
    const txs = await icp.get_transactions();
    expect(txs.at(-1).index).toBe(w.blockIndex);
    expect(await balance(depositAccount(eve))).toBe(0n);
    expect(await balance(account(eve))).toBe((7n * ICP) / 10n - ICP_FEE);
    expect(await balance(depositAccount(bob))).toBe(ICP / 3n);
    expect(await balance(account(carol))).toBe(carolBefore);
    expect(await premium.checkMembership(eve)).toEqual({ NotFound: null });
    unwrap(await premiumBob.withdrawDeposit());
    expect(await balance(depositAccount(bob))).toBe(0n);
  });

  it('keeps the deposit when the ledger refuses', async () => {
    await icp.mint(depositAccount(eve), ICP / 5n);
    await icp.set_paused(true);
    expect(errOf(await premiumEve().withdrawDeposit())).toHaveProperty('TransferFailed');
    await icp.set_paused(false);
    expect(await balance(depositAccount(eve))).toBe(ICP / 5n);
    unwrap(await premiumEve().withdrawDeposit());
  });

  it('runs one purchase or withdrawal per caller at a time', async () => {
    await icp.mint(depositAccount(eve), ICP / 5n);
    const d = pic.createDeferredActor({ idlFactory: premiumIdl, canisterId: premiumId }); d.setPrincipal(eve);
    const first = await d.withdrawDeposit();
    const second = await d.withdrawDeposit();
    const third = await d.purchaseWithIcp();
    const [r1, r2, r3] = [await first(), await second(), await third()];
    expect(r1).toHaveProperty('ok');
    expect(r2).toEqual({ err: { InProgress: null } });
    expect(r3.err.InternalError).toMatch(/in progress/);
    expect(await balance(depositAccount(eve))).toBe(0n);
    expect(await balance(account(eve))).toBe((7n * ICP) / 10n - ICP_FEE + ICP / 5n - ICP_FEE + ICP / 5n - ICP_FEE);
    // the lock is released afterwards
    await icp.mint(depositAccount(eve), ICP / 5n);
    unwrap(await premiumEve().withdrawDeposit());
  });
});

describe('membership over time', () => {
  it('expires and comes back from the active list, and a renewal after expiry starts from now', async () => {
    const before = await premium.checkMembership(bob);
    const expiration = before.Active.expiration;
    await advance(MONTH + 60n * SEC);
    expect(await premium.checkMembership(bob)).toEqual({ Expired: { expiredAt: expiration } });
    expect(await premium.checkMembership(carol)).toHaveProperty('Expired'); // her month ran out too
    expect((await premium.getActivePremiumMembers()).map((p) => p.toText())).toEqual([alice.toText()]);
    expect(await premium.getMembershipDetails(bob)).toEqual([{ principal: bob, expiration, lastUpdated: expect.any(BigInt) }]);
    await icp.mint(depositAccount(bob), ICP);
    const m = unwrap(await premiumBob.purchaseWithIcp());
    expect(m.expiration).toBe(m.lastUpdated + MONTH);
    expect(m.expiration).toBeGreaterThan(expiration + MONTH);
    expect((await premium.getClaimLog(0n, 1n)).claims[0]).toMatchObject({ previousExpiration: expiration, newExpiration: m.expiration });
  });

  it('shows the details to the member and admins only', async () => {
    expect(await premiumBob.getMembershipDetails(bob)).toHaveLength(1);
    expect(await premium.getMembershipDetails(bob)).toHaveLength(1);
    expect(await premiumAlice.getMembershipDetails(bob)).toEqual([]);
    expect(await premiumAlice.getMembershipDetails(alice)).toHaveLength(1);
    expect(await premiumAlice.getMembershipDetails(dave)).toEqual([]);
  });
});

describe('admin grants', () => {
  it('set, extend and revoke memberships', async () => {
    const exp = (await nowNs()) + 7n * DAY;
    const set = unwrap(await premium.setMembershipAdmin(dave, exp));
    expect(set).toMatchObject({ principal: dave, expiration: exp });
    expect(await premium.checkMembership(dave)).toEqual({ Active: { expiration: exp } });
    const ext = unwrap(await premiumBob.extendMembershipAdmin(dave, 3n * DAY));
    expect(ext.expiration).toBe(exp + 3n * DAY);
    unwrap(await premium.revokeMembership(dave));
    expect(await premium.checkMembership(dave)).toEqual({ NotFound: null });
    expect(unwrap(await premium.revokeMembership(dave))).toBeNull(); // revoking a non-member is a no-op
    // extending a non-member starts from now
    const fresh = unwrap(await premium.extendMembershipAdmin(dave, DAY));
    expect(fresh.expiration).toBe(fresh.lastUpdated + DAY);
    unwrap(await premium.revokeMembership(dave));
    expect((await premium.getAllMemberships()).map(([p]) => p.toText()).sort()).toEqual([alice, bob, carol].map((p) => p.toText()).sort());
  });
});

describe('claiming with voting power', () => {
  // parameters: dissolve bonus up to 100% at 1000 s, min 100 s to vote, age bonus up to 25% at 1000 s
  const P = { md: 1000n, mb: 100n, min: 100n, ma: 1000n, ab: 25n };
  const vp = (stake, dissolve) => {
    if (dissolve < P.min) return 0n;
    const d = dissolve > P.md ? P.md : dissolve;
    const withDissolve = stake + (stake * d * P.mb) / (100n * P.md);
    return withDissolve + (withDissolve * P.ma * P.ab) / (100n * P.ma); // aging since 0: age capped at max
  };
  const N1 = [1, 1, 1], N2 = [2, 2, 2], N3 = [3, 3, 3];
  let firstClaimExpiration;

  beforeAll(async () => {
    await gov.set_parameters({ max_dissolve_delay_seconds: P.md, max_dissolve_delay_bonus_percentage: P.mb, neuron_minimum_dissolve_delay_to_vote_seconds: P.min, max_neuron_age_for_age_bonus: P.ma, max_age_bonus_percentage: P.ab });
    await gov.add_neuron(neuronSpec({ id: N1, owner: alice, stake: 10n * ICP, dissolve: 500n }));
    await gov.add_neuron(neuronSpec({ id: N2, owner: bob, hotkeys: [alice], stake: 2n * ICP, dissolve: 50n })); // below the minimum dissolve delay
    await gov.add_neuron(neuronSpec({ id: N3, owner: bob, hotkeys: [alice], hotkeysFirst: true, stake: ICP, dissolve: 5000n })); // capped at the max
  });

  it('needs an active tier, then neurons', async () => {
    expect(errOf(await premiumAlice.claimWithVotingPower())).toEqual({ NoActiveTiers: null });
    unwrap(await premium.addVpTier({ name: 'inactive', minVotingPowerE8s: 0n, durationNs: 1000n * DAY, active: false }));
    expect(errOf(await premiumAlice.claimWithVotingPower())).toEqual({ NoActiveTiers: null });
    expect(errOf(await premium.addVpTier({ name: 'bad', minVotingPowerE8s: 0n, durationNs: 0n, active: true }))).toEqual({ InvalidInput: 'Duration must be positive' });
    unwrap(await premium.addVpTier({ name: 'Bronze', minVotingPowerE8s: 10n * ICP, durationNs: MONTH, active: true }));
    unwrap(await premium.addVpTier({ name: 'Silver', minVotingPowerE8s: 20n * ICP, durationNs: 3n * MONTH, active: true }));
    unwrap(await premium.addVpTier({ name: 'Gold', minVotingPowerE8s: 50n * ICP, durationNs: YEAR, active: true }));
    expect((await premium.getVotingPowerTiers()).map((t) => t.name)).toEqual(['Bronze', 'Silver', 'Gold']);
    expect((await premium.getAllVotingPowerTiers()).map((t) => t.name)).toEqual(['inactive', 'Bronze', 'Silver', 'Gold']);
    expect(errOf(await premiumAnon.claimWithVotingPower())).toEqual({ NotAuthorized: null });
    expect(errOf(await premiumCarol.claimWithVotingPower())).toEqual({ NoEligibleNeurons: null });
  });

  it('sums the voting power of owned and hotkeyed neurons and grants the most exclusive tier reached', async () => {
    const expected = vp(10n * ICP, 500n) + vp(2n * ICP, 50n) + vp(ICP, 5000n);
    expect(expected).toBe(2_125_000_000n);
    const before = (await premium.getMembershipDetails(alice))[0].expiration;
    expect(before).toBeGreaterThan(await nowNs()); // alice holds a paid membership
    const m = unwrap(await premiumAlice.claimWithVotingPower());
    const current = (await premium.getMembershipDetails(alice))[0];
    expect(m.expiration).toBe(current.expiration);
    // capped, not additive: now + the tier's 3 months, or the running membership if that is later
    expect(m.expiration).toBe(maxN(before, m.lastUpdated + 3n * MONTH));
    firstClaimExpiration = m.expiration;
    const entry = (await premium.getClaimLog(0n, 1n)).claims[0];
    expect(entry).toMatchObject({ claimant: alice, claimType: { VotingPower: null }, tierName: 'Silver', durationGrantedNs: 3n * MONTH, votingPowerE8s: [expected], previousExpiration: before, newExpiration: m.expiration });
    expect(await premium.getPaymentStats()).toMatchObject({ total_vp_claims: 1n });
  });

  it('rate limits claims per principal by the configured interval', async () => {
    const err = errOf(await premiumAlice.claimWithVotingPower());
    expect(err.AlreadyClaimedRecently.intervalNs).toBe(DAY);
    expect(err.AlreadyClaimedRecently.nextClaimTime).toBe(err.AlreadyClaimedRecently.lastClaimTime + DAY);
    expect((await premium.getMembershipDetails(alice))[0].expiration).toBe(firstClaimExpiration); // the refused claim added nothing
    await advance(DAY + SEC);
    const m = unwrap(await premiumAlice.claimWithVotingPower());
    expect(m.expiration).toBe(maxN(firstClaimExpiration, m.lastUpdated + 3n * MONTH)); // a later claim cannot bank time
    expect(await premium.getPaymentStats()).toMatchObject({ total_vp_claims: 2n });
  });

  it('grants only one of two claims sent at once (the rate limit is checked again after the governance calls)', async () => {
    await advance(DAY + SEC);
    const before = (await premium.getMembershipDetails(alice))[0].expiration;
    const d = pic.createDeferredActor({ idlFactory: premiumIdl, canisterId: premiumId }); d.setPrincipal(alice);
    const first = await d.claimWithVotingPower();
    const second = await d.claimWithVotingPower();
    const results = [await first(), await second()];
    expect(results.filter((r) => 'ok' in r)).toHaveLength(1);
    expect(results.filter((r) => 'err' in r)[0].err).toHaveProperty('AlreadyClaimedRecently');
    const granted = results.find((r) => 'ok' in r).ok;
    expect((await premium.getMembershipDetails(alice))[0].expiration).toBe(maxN(before, granted.lastUpdated + 3n * MONTH));
    expect(await premium.getPaymentStats()).toMatchObject({ total_vp_claims: 3n });
  });

  it('sets the expiration to now + the tier duration, never shortening a running membership', async () => {
    // bob owns N2 (no VP: dissolve delay under the minimum) and N3
    const bobVp = vp(2n * ICP, 50n) + vp(ICP, 5000n);
    expect(bobVp).toBe(250_000_000n);
    expect(errOf(await premiumBob.claimWithVotingPower())).toEqual({ InsufficientVotingPower: { required: 10n * ICP, found: bobVp } });
    unwrap(await premium.updateVpTier(1n, { name: 'Bronze', minVotingPowerE8s: 2n * ICP, durationNs: 2n * MONTH, active: true }));
    const before = (await premium.getMembershipDetails(bob))[0].expiration;
    const m = unwrap(await premiumBob.claimWithVotingPower());
    expect(before).toBeGreaterThan(m.lastUpdated); // bob's membership is still running
    expect(m.expiration).toBe(maxN(before, m.lastUpdated + 2n * MONTH));
    expect((await premium.getClaimLog(0n, 1n)).claims[0]).toMatchObject({ claimant: bob, tierName: 'Bronze', previousExpiration: before, newExpiration: m.expiration });
  });

  it('counts only neurons the caller is listed on', async () => {
    // carol gets a hotkey on N1 after the fact: she now sees alice's neuron VP
    await gov.add_neuron(neuronSpec({ id: N1, owner: alice, hotkeys: [carol], stake: 10n * ICP, dissolve: 500n }));
    const m = unwrap(await premiumCarol.claimWithVotingPower());
    expect((await premium.getClaimLog(0n, 1n)).claims[0]).toMatchObject({ claimant: carol, tierName: 'Bronze', votingPowerE8s: [vp(10n * ICP, 500n)] });
    expect(m.expiration).toBeGreaterThan(m.lastUpdated);
    unwrap(await premium.removeVpTier(0n)); // drop the inactive one
    expect((await premium.getAllVotingPowerTiers()).map((t) => t.name)).toEqual(['Bronze', 'Silver', 'Gold']);
    expect(errOf(await premium.removeVpTier(5n))).toEqual({ NotFound: null });
    expect(errOf(await premium.updateVpTier(5n, { name: 'x', minVotingPowerE8s: 1n, durationNs: 1n, active: true }))).toEqual({ NotFound: null });
  });

  it('honours a changed claim interval', async () => {
    unwrap(await premium.setMinClaimInterval(60n * SEC));
    expect((await premium.getConfig()).minClaimIntervalNs).toBe(60n * SEC);
    expect(errOf(await premiumCarol.claimWithVotingPower())).toHaveProperty('AlreadyClaimedRecently');
    await advance(61n * SEC);
    unwrap(await premiumCarol.claimWithVotingPower());
    expect(firstClaimExpiration).toBeGreaterThan(0n);
  });
});

describe('promo codes', () => {
  let code, limited;
  it('are created by admins with a positive duration and claim count', async () => {
    expect(errOf(await premium.createPromoCode({ durationNs: 0n, maxClaims: 1n, expiration: [], notes: [] }))).toEqual({ InvalidInput: 'Duration must be positive' });
    expect(errOf(await premium.createPromoCode({ durationNs: DAY, maxClaims: 0n, expiration: [], notes: [] }))).toEqual({ InvalidInput: 'Max claims must be positive' });
    const pc = unwrap(await premiumBob.createPromoCode({ durationNs: 10n * DAY, maxClaims: 2n, expiration: [], notes: ['launch party'] }));
    expect(pc.code).toMatch(/^[A-Z]{8}$/);
    expect(pc).toMatchObject({ durationNs: 10n * DAY, maxClaims: 2n, claimCount: 0n, expiration: [], notes: ['launch party'], createdBy: bob, active: true });
    code = pc.code;
    const second = unwrap(await premium.createPromoCode({ durationNs: DAY, maxClaims: 1n, expiration: [], notes: [] }));
    expect(second.code).not.toBe(code);
    limited = second.code;
    expect(unwrap(await premium.getPromoCodes()).map((p) => p.code)).toEqual([code, limited]);
  });

  // fixed 2026-10-20: codes came from an LCG seeded with Time.now(), i.e. from their createdAt
  it('are drawn from the IC randomness, not from the creation time', async () => {
    const fromClock = (t) => {
      let seed = t; let out = '';
      for (let i = 0; i < 8; i++) { out += String.fromCharCode(65 + Number(seed % 26n)); seed = (seed * 1103515245n + 12345n) / 65536n; }
      return out;
    };
    const made = [];
    for (let i = 0; i < 3; i++) made.push(unwrap(await premium.createPromoCode({ durationNs: DAY, maxClaims: 1n, expiration: [], notes: [] })));
    for (const pc of made) {
      expect(pc.code).toMatch(/^[A-Z]{8}$/);
      expect(pc.code).not.toBe(fromClock(pc.createdAt));
    }
    expect(new Set(made.map((pc) => pc.code)).size).toBe(3);
    for (const pc of made) unwrap(await premium.deletePromoCode(pc.code));
  });

  it('extend the claimant on top of a running membership, once per principal, up to the claim limit', async () => {
    const before = (await premium.getMembershipDetails(alice))[0].expiration;
    const m = unwrap(await premiumAlice.claimPromoCode(code));
    expect(m.expiration).toBe(before + 10n * DAY);
    expect(errOf(await premiumAlice.claimPromoCode(code))).toEqual({ AlreadyClaimed: null });
    expect(unwrap(await premium.getPromoCodes())[0].claimCount).toBe(1n);
    const d = unwrap(await actorAs(pic, premiumIdl, premiumId, dave).claimPromoCode(code)); // dave is not a member: starts from now
    expect(d.expiration).toBe(d.lastUpdated + 10n * DAY);
    expect(errOf(await premiumCarol.claimPromoCode(code))).toEqual({ CodeFullyClaimed: null });
    expect(errOf(await premiumCarol.claimPromoCode('NOPE'))).toEqual({ InvalidCode: null });
    const claims = unwrap(await premium.getPromoCodeClaims(code));
    expect(claims.map((c) => c.claimedBy.toText())).toEqual([alice.toText(), dave.toText()]);
    expect(claims[0]).toMatchObject({ code, durationGrantedNs: 10n * DAY });
    expect((await premium.getClaimLog(0n, 2n)).claims.map((c) => c.claimType)).toEqual([{ PromoCode: null }, { PromoCode: null }]);
    expect((await premium.getClaimLog(0n, 1n)).claims[0]).toMatchObject({ tierName: `Promo: ${code}`, promoCode: [code], claimant: dave });
    expect(await premium.getPaymentStats()).toMatchObject({ total_promo_claims: 2n });
  });

  it('can be deactivated, reactivated and deleted', async () => {
    unwrap(await premium.deactivatePromoCode(limited));
    expect(errOf(await premiumCarol.claimPromoCode(limited))).toEqual({ CodeInactive: null });
    expect(errOf(await premium.deactivatePromoCode('NOPE'))).toEqual({ NotFound: null });
    unwrap(await premium.reactivatePromoCode(limited));
    expect(errOf(await premium.reactivatePromoCode('NOPE'))).toEqual({ NotFound: null });
    unwrap(await premiumCarol.claimPromoCode(limited));
    unwrap(await premium.deletePromoCode(limited));
    expect(errOf(await premium.deletePromoCode(limited))).toEqual({ NotFound: null });
    expect(errOf(await premiumBob.claimPromoCode(limited))).toEqual({ InvalidCode: null });
    expect(unwrap(await premium.getPromoCodes()).map((p) => p.code)).toEqual([code]);
    expect(unwrap(await premium.getPromoCodeClaims(limited))).toHaveLength(1); // the claim record outlives the code
  });

  it('expire on their own expiration date', async () => {
    const pc = unwrap(await premium.createPromoCode({ durationNs: DAY, maxClaims: 5n, expiration: [(await nowNs()) + 3600n * SEC], notes: [] }));
    unwrap(await premiumBob.claimPromoCode(pc.code));
    await advance(3601n * SEC);
    expect(errOf(await premiumCarol.claimPromoCode(pc.code))).toEqual({ CodeExpired: null });
    unwrap(await premium.deletePromoCode(pc.code));
  });

  it('are refused to the anonymous principal', async () => {
    const pc = unwrap(await premium.createPromoCode({ durationNs: DAY, maxClaims: 1n, expiration: [], notes: [] }));
    expect(errOf(await premiumAnon.claimPromoCode(pc.code))).toEqual({ NotAuthorized: null });
    expect(await premium.getMembershipDetails(Principal.anonymous())).toEqual([]);
    expect(unwrap(await premium.getPromoCodes()).find((p) => p.code === pc.code).claimCount).toBe(0n);
    unwrap(await premium.deletePromoCode(pc.code));
  });
});

describe('logs', () => {
  it('page newest first with offsets', async () => {
    const total = await premium.getClaimLogCount();
    const all = await premium.getClaimLog(0n, 1000n);
    expect(all.total_count).toBe(total);
    expect(all.claims).toHaveLength(Number(total));
    expect(all.claims.map((c) => c.id)).toEqual([...all.claims].map((_, i) => total - 1n - BigInt(i)));
    const page = await premium.getClaimLog(0n, 2n);
    expect(page.claims.map((c) => c.id)).toEqual([total - 1n, total - 2n]);
    expect(page.has_more).toBe(true);
    const next = await premium.getClaimLog(2n, 2n);
    expect(next.claims.map((c) => c.id)).toEqual([total - 3n, total - 4n]);
    const last = await premium.getClaimLog(total - 1n, 10n);
    expect(last.claims.map((c) => c.id)).toEqual([0n]);
    expect(last.has_more).toBe(false);
    const past = await premium.getClaimLog(total, 10n);
    expect(past).toEqual({ claims: [], total_count: total, has_more: false });
    const payments = await premium.getIcpPaymentLog(1n, 1n);
    expect(payments.total_count).toBe(await premium.getIcpPaymentLogCount());
    expect(payments.payments[0].id).toBe(payments.total_count - 2n);
    const stats = await premium.getPaymentStats();
    expect(stats.total_claims).toBe(stats.total_icp_payments + stats.total_vp_claims + stats.total_promo_claims);
    expect(stats.claim_log_size).toBe(total);
    expect(stats.total_icp_collected_e8s).toBe(all.claims.filter((c) => c.icpAmountE8s.length).reduce((s, c) => s + c.icpAmountE8s[0], 0n));
  });
});

describe('configuration', () => {
  it('adds and removes admins without duplicates', async () => {
    unwrap(await premium.addAdmin(carol));
    unwrap(await premium.addAdmin(carol));
    expect((await premium.getConfig()).admins.map((p) => p.toText())).toEqual([bob.toText(), carol.toText()]);
    expect(await premiumCarol.isCallerAdmin()).toBe(true);
    unwrap(await premiumCarol.removeAdmin(carol)); // an admin may remove itself
    expect(await premiumCarol.isCallerAdmin()).toBe(false);
    unwrap(await premium.removeAdmin(carol)); // removing a non-admin is a no-op
    expect((await premium.getConfig()).admins.map((p) => p.toText())).toEqual([bob.toText()]);
  });

  it('changes one field at a time, and the whole config at once', async () => {
    unwrap(await premium.setPaymentRecipient(account(dave)));
    unwrap(await premium.setIcpLedgerId(alice));
    unwrap(await premium.setSneedGovernanceId(bob));
    let cfg = await premium.getConfig();
    expect(cfg.paymentRecipient).toEqual(account(dave));
    expect(cfg.icpLedgerId.toText()).toBe(alice.toText());
    expect(cfg.sneedGovernanceId.toText()).toBe(bob.toText());
    expect(cfg.admins.map((p) => p.toText())).toEqual([bob.toText()]);
    // a purchase now talks to a principal that is not a ledger
    await icp.mint(depositAccount(alice), ICP);
    await expect(premiumAlice.purchaseWithIcp()).rejects.toThrow();
    unwrap(await premiumBob.updateConfig({ ...initConfig(), minClaimIntervalNs: 60n * SEC }));
    cfg = await premium.getConfig();
    expect(cfg.icpLedgerId.toText()).toBe(icpId.toText());
    expect(cfg.paymentRecipient).toEqual(account(carol));
    const carolBefore = await balance(account(carol));
    unwrap(await premiumAlice.purchaseWithIcp());
    expect(await balance(account(carol))).toBe(carolBefore + ICP - ICP_FEE);
  });
});

describe('upgrade', () => {
  it('keeps members, tiers, codes, logs and config', async () => {
    unwrap(await premiumCarol.claimWithVotingPower()); // starts a 60 s rate limit window
    const members = await premium.getAllMemberships();
    const icpTiers = await premium.getAllIcpTiers();
    const vpTiers = await premium.getAllVotingPowerTiers();
    const codes = unwrap(await premium.getPromoCodes());
    const claimLog = await premium.getClaimLog(0n, 1000n);
    const paymentLog = await premium.getIcpPaymentLog(0n, 1000n);
    const stats = await premium.getPaymentStats();
    const cfg = await premium.getConfig();
    expect(members.length).toBeGreaterThan(2);
    await pic.upgradeCanister({ sender: admin, canisterId: premiumId, wasm: wasm('sneed_premium'), arg: IDL.encode(premiumInit({ IDL }), [[]]) });
    await pic.tick(2);
    expect(await premium.getAllMemberships()).toEqual(members);
    expect(await premium.getAllIcpTiers()).toEqual(icpTiers);
    expect(await premium.getAllVotingPowerTiers()).toEqual(vpTiers);
    expect(unwrap(await premium.getPromoCodes())).toEqual(codes);
    expect(await premium.getClaimLog(0n, 1000n)).toEqual(claimLog);
    expect(await premium.getIcpPaymentLog(0n, 1000n)).toEqual(paymentLog);
    expect(await premium.getPaymentStats()).toEqual(stats);
    expect(await premium.getConfig()).toEqual(cfg);
    for (const [p, m] of members) expect(await premium.checkMembership(p)).toEqual(m.expiration > (await nowNs()) ? { Active: { expiration: m.expiration } } : { Expired: { expiredAt: m.expiration } });
    // still operational, ids continue
    await icp.mint(depositAccount(alice), ICP);
    unwrap(await premiumAlice.purchaseWithIcp());
    expect(await premium.getClaimLogCount()).toBe(claimLog.total_count + 1n);
    expect((await premium.getClaimLog(0n, 1n)).claims[0].id).toBe(claimLog.total_count);
    // the rate limit survives too
    expect(errOf(await premiumCarol.claimWithVotingPower())).toHaveProperty('AlreadyClaimedRecently');
  });
});
