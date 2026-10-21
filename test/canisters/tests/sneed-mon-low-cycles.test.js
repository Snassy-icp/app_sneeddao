// sneed_mon when the IC refuses to send a call (ic0.call_perform fails: the call expression throws
// "could not perform remote call"). Each call in flight holds a reservation for its largest
// possible response, so a canister with few cycles above its freezing threshold can't have many
// in flight: on staging (2026-10-21) every round that read the ballots of the Sneed SNS's 40 open
// proposals (20 get_proposal calls at once) died with "round: could not perform remote call",
// no proposal was ever matched and nobody was told. A round must send what the cycles allow,
// await it, go on with the rest, and record a call it could not send on that proposal, never
// abort. Here sneed_mon runs on just enough cycles for a few calls in flight.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPic, install, actorAs, admin, user, unwrap, account, principalToSubaccount } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { idlFactory as monIdl } from '../build/sneed_mon.did.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';

const bob = user('mon-lowcyc-bob');
const DAY = 86_400n;
const OPEN = 40; // open proposals, as on the Sneed SNS
const VOTED = 10; // bob's neuron voted on the first ten already
// the cycles sneed_mon runs on: after install, room for a few calls in flight above the freezing
// threshold (each get_proposal holds ~82B cycles in flight on PocketIC's 13-node subnet)
const CYCLES = BigInt(process.env.MON_LOW_CYCLES ?? 600_000_000_000);

const permission = ({ IDL }) => IDL.Record({ principal: IDL.Opt(IDL.Principal), permission_type: IDL.Vec(IDL.Int32) });
const snsIdl = ({ IDL }) => IDL.Service({
  set_name: IDL.Func([IDL.Text], [], []),
  set_neurons: IDL.Func([IDL.Vec(IDL.Record({ id: IDL.Vec(IDL.Nat8), permissions: IDL.Vec(permission({ IDL })) }))], [], []),
  add_proposal: IDL.Func([IDL.Nat64, IDL.Text, IDL.Nat64, IDL.Nat64, IDL.Vec(IDL.Vec(IDL.Nat8))], [], []),
  set_vote: IDL.Func([IDL.Nat64, IDL.Vec(IDL.Nat8), IDL.Int32], [], []),
  counters: IDL.Func([], [IDL.Record({ list_proposals: IDL.Nat, get_proposal: IDL.Nat, list_neurons: IDL.Nat })], ['query']),
});
const snswIdl = ({ IDL }) => IDL.Service({ set_instances: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal))], [], []) });

let pic, monId, notifId, icpId, snsId, snswId;
let mon, notif, icp, sns;
const BOB_NEURON = new Uint8Array([3, 3]);

async function drain() {
  for (let i = 0; i < 60 && (await mon.get_status()).running; i++) { await pic.advanceTime(1_500); await pic.tick(2); }
  expect((await mon.get_status()).running).toBe(false);
}
async function round() {
  await drain();
  unwrap(await mon.admin_run_now());
  await drain();
}

describe('sneed_mon on few cycles', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    notifId = await install(pic, { name: 'sneed_notifications' });
    snswId = await install(pic, { name: 'MockForumSnsW' });
    snsId = await install(pic, { name: 'MockMonSns' });
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }] });
    monId = await install(pic, { name: 'sneed_mon', cycles: CYCLES });
    mon = actorAs(pic, monIdl, monId, admin);
    notif = (p) => actorAs(pic, notifIdl, notifId, p);
    icp = actorAs(pic, ledgerIdl, icpId, admin);
    sns = actorAs(pic, snsIdl, snsId, admin);
    await actorAs(pic, snswIdl, snswId, admin).set_instances([[snsId, snsId]]);
    await sns.set_name('Sneedish DAO');
    const cfg = await mon.get_config();
    unwrap(await mon.admin_set_config({ ...cfg.core, notifications: [notifId], sns_wasm: snswId }));
    unwrap(await mon.admin_set_billing({ ...cfg.billing, icp_ledger: icpId, fee_destination: [] }));
    const appId = unwrap(await mon.admin_register_with_notifications());
    unwrap(await notif(bob).allow_app(appId, true));
    await icp.mint(account(monId, principalToSubaccount(bob)), 1_000_000n);
    unwrap(await actorAs(pic, monIdl, monId, bob).credit_deposit());
    await sns.set_neurons([{ id: BOB_NEURON, permissions: [{ principal: [bob], permission_type: [4] }] }]);
    unwrap(await actorAs(pic, monIdl, monId, bob).watch({ sns: snsId }));
    const t = BigInt(Math.floor((await pic.getTime()) / 1000));
    for (let i = 1; i <= OPEN; i++) {
      await sns.add_proposal(BigInt(i), `Proposal ${i}`, t - 100n, t + 4n * DAY, [BOB_NEURON]);
      if (i <= VOTED) await sns.set_vote(BigInt(i), BOB_NEURON, 1);
    }
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('reads the ballots of every open proposal in one round, never aborting it', async () => {
    const before = await sns.counters();
    await round();
    const st = await mon.get_status();
    // every proposal's ballots were read (once each) and matched
    const after = await sns.counters();
    expect(after.get_proposal - before.get_proposal).toBe(BigInt(OPEN));
    const [ti] = await mon.get_targets();
    expect(ti.open.length).toBe(OPEN);
    expect(ti.open.every((p) => p.new_done)).toBe(true);
    // bob heard once, about the 30 he can still vote on (not the 10 he voted on)
    const hist = (await notif(bob).get_my_history(200n)).filter((h) => h.app_name === 'Sneed Monitor' && h.topic === 'proposals');
    expect(hist.length).toBe(1);
    expect(hist[0].title).toBe(`${OPEN - VOTED} proposals to vote on in Sneedish DAO`);
    expect(hist[0].body).toMatch(/^#11 Proposal 11: 1 of your neurons/);
    // no round died on a call it could not send
    expect(st.last_error.length === 0 || !/round/.test(st.last_error[0][1])).toBe(true);
    const errs = await mon.get_recent_errors();
    expect(errs.map(([, m]) => m).filter((m) => /round aborted|round:/.test(m))).toEqual([]);
    // the class of failure did happen (and was recorded on the proposal's target, with the cycles)
    expect(errs.some(([, m]) => /^match: get_proposal \d+ not sent \(\d+ cycles left, ~\d+ held per call in flight\): could not perform remote call/.test(m))).toBe(true);
    expect(ti.errors).toBeGreaterThan(0n);
    expect(st.sent).toBe(1n);
  });
});
