// Sneed Premium without the whole member list (spec/paging_audit.md, premium): Sneed Hub used to
// load getActivePremiumMembers (every active member) on every page. Clients now ask for the
// principals they show with checkMemberships (at most 500 per call), and integrators page the
// members with getActivePremiumMembersPage (capped at 500, with a cursor and the active total).
// checkMembership, the inter-canister premium check, reads a map index instead of scanning the
// member list; the index is transient, rebuilt from the stable list at upgrade, and kept in step by
// admin set / extend / revoke. The upgrade test installs the build production runs
// (build/sneed_premium_prepaging.wasm: src at 1788bfee, module hash 506fde4b…) and upgrades it.
// PREMIUM_WASM=sneed_premium_prepaging npx vitest run tests/premium-paging.test.js runs it against
// the production code (the new methods are missing there, so it fails).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, T, unwrap, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { ledgerInit } from '../lib/idl.js';
import { idlFactory as premiumIdl, init as premiumInit } from '../build/sneed_premium.did.js';

const PREMIUM_WASM = process.env.PREMIUM_WASM || 'sneed_premium';
const SEC = 1_000_000_000n;
const DAY = 86_400n * SEC;

let pic, appSubnet, icpId, govId;
const as = (id, p) => actorAs(pic, premiumIdl, id, p);
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const initConfig = () => ({ admins: [bob], icpLedgerId: icpId, sneedGovernanceId: govId, paymentRecipient: account(carol), minClaimIntervalNs: DAY });
const newPremium = (name = PREMIUM_WASM) => install(pic, { name, initTypes: premiumInit({ IDL }), initArgs: [[initConfig()]], cycles: 50n * T, targetSubnetId: appSubnet });
const members = Array.from({ length: 30 }, (_, i) => user(`pm-${i}`));
const status = (s) => Object.keys(s)[0];

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  govId = await install(pic, { name: 'MockRllGovernance', targetSubnetId: appSubnet });
}, 120_000);
afterAll(async () => { await pic?.tearDown(); });

describe('sneed_premium: members without the whole list', () => {
  let id, premium;
  beforeAll(async () => {
    id = await newPremium();
    premium = as(id, admin);
    const t = await nowNs();
    // 30 members: the even ones active, the odd ones expired
    for (const [i, p] of members.entries()) unwrap(await premium.setMembershipAdmin(p, i % 2 === 0 ? t + 30n * DAY : t - DAY));
  });

  it('checks a batch of principals in one query, in order', async () => {
    const asked = [members[0], members[1], alice, members[2]];
    const got = await as(id, alice).checkMemberships(asked);
    expect(got.map(status)).toEqual(['Active', 'Expired', 'NotFound', 'Active']);
    // the same answers as one checkMembership each
    for (const [i, p] of asked.entries()) expect(await as(id, alice).checkMembership(p)).toEqual(got[i]);
    expect(await as(id, alice).checkMemberships([])).toEqual([]);
    // at most 500 at once
    expect((await as(id, alice).checkMemberships(Array(500).fill(alice))).length).toBe(500);
    await expect(as(id, alice).checkMemberships(Array(501).fill(alice))).rejects.toThrow(/At most 500/);
  });

  it('pages the active members with a cursor and the active total', async () => {
    const active = members.filter((_, i) => i % 2 === 0).map(String);
    const seen = [];
    let start = 0n, pages = 0;
    for (;;) {
      const page = await as(id, alice).getActivePremiumMembersPage({ start, limit: 4n });
      expect(page.total_active).toBe(15n);
      expect(page.items.length).toBeLessThanOrEqual(4);
      for (const it of page.items) expect(it.expiration > (await nowNs())).toBe(true);
      seen.push(...page.items.map((x) => x.principal.toText()));
      pages++;
      if (page.next.length === 0) break;
      start = page.next[0];
    }
    expect(pages).toBe(4);
    expect(seen).toEqual(active);
    // the same set as the old full list
    expect((await as(id, alice).getActivePremiumMembers()).map(String).sort()).toEqual([...active].sort());
    // limit 0 means 100, and the limit is capped at 500
    expect((await as(id, alice).getActivePremiumMembersPage({ start: 0n, limit: 0n })).items.length).toBe(15);
    expect((await as(id, alice).getActivePremiumMembersPage({ start: 0n, limit: 1_000_000n })).items.length).toBe(15);
  });

  it('keeps the index in step with set, extend and revoke', async () => {
    const p = user('pm-new');
    expect(status((await as(id, alice).checkMemberships([p]))[0])).toBe('NotFound');
    unwrap(await premium.setMembershipAdmin(p, (await nowNs()) + DAY));
    expect(status((await as(id, alice).checkMemberships([p]))[0])).toBe('Active');
    unwrap(await premium.extendMembershipAdmin(members[1], 60n * DAY)); // an expired one comes back
    expect(status((await as(id, alice).checkMembership(members[1])))).toBe('Active');
    unwrap(await premium.revokeMembership(p));
    expect(status((await as(id, alice).checkMemberships([p]))[0])).toBe('NotFound');
    expect(status(await as(id, alice).checkMembership(p))).toBe('NotFound');
  });

  it('answers the new reads only as queries', async () => {
    const upd = actorAs(pic, asUpdates(premiumIdl), id, alice);
    expect(await refusedAtIngress(upd.checkMemberships([alice]))).toBe(true);
    expect(await refusedAtIngress(upd.getActivePremiumMembersPage({ start: 0n, limit: 10n }))).toBe(true);
  });
});

describe('sneed_premium: upgrade from production', () => {
  it('rebuilds the index from the kept member list', async () => {
    const id = await newPremium('sneed_premium_prepaging');
    const premium = as(id, admin);
    const t = await nowNs();
    for (const [i, p] of members.slice(0, 6).entries()) unwrap(await premium.setMembershipAdmin(p, i < 4 ? t + 10n * DAY : t - DAY));
    const before = await premium.checkMembership(members[0]);

    await pic.upgradeCanister({ sender: admin, canisterId: id, wasm: wasm(PREMIUM_WASM), arg: IDL.encode(premiumInit({ IDL }), [[]]) });

    expect(await premium.checkMembership(members[0])).toEqual(before);
    expect((await premium.checkMemberships(members.slice(0, 7))).map(status)).toEqual(['Active', 'Active', 'Active', 'Active', 'Expired', 'Expired', 'NotFound']);
    const page = await premium.getActivePremiumMembersPage({ start: 0n, limit: 10n });
    expect(page.total_active).toBe(4n);
    expect(page.items.map((x) => x.principal.toText())).toEqual(members.slice(0, 4).map(String));
    // writes after the upgrade reach the index
    unwrap(await premium.revokeMembership(members[0]));
    expect(status(await premium.checkMembership(members[0]))).toBe('NotFound');
  });
});
