// Support-audit fixes in Sneed Notifications (spec/support_audit.md P0-8, P1-9, P2-19):
// - top-ups (user and app) pull with a memo and created_at_time, and each is recorded per payer
//   with its ledger block;
// - admin_credit(p, amount, block) credits a top-up whose outcome the canister never learned,
//   only after reading the block on the ledger (from p's account to this canister, exactly that
//   amount; the ICP ledger through query_blocks, other ledgers through ICRC-3), at most once per
//   block (blocks credited by a top-up included), never for a block older than the top-up
//   records, with an ICRC-3 block;
// - admin_get_user(p): balance, settings, channels, apps, top-ups, history and pending deliveries;
// - admin_remove_app leaves the app's balance for its recorded owner (claim_removed_app_balance);
// - pruning old notifications refunds paid deliveries that never became final;
// - a trap after the delivery timer's await no longer leaves `ticking` set (deliveries went on
//   being skipped for good); stats shows last_tick_at;
// - new admin methods: admin-only, queries refused as updates;
// - an upgrade with keep from the production build (src/sneed_notifications at d20ab1bf, module
//   hash e78123ff…, build/sneed_notifications_preaudit.wasm) keeps balances, apps and the log,
//   records the top-ups its log holds (so admin_credit refuses them) and begins the records at the
//   log's first block.
// The ledger is the real ICRC ledger (build/ledger.wasm.gz), so memos and created_at_time are what
// a ledger records; a mock of the ICP ledger's query_blocks sits at the ICP ledger's id.
// NOTIF_WASM=sneed_notifications_preaudit npx vitest run tests/notifications-support.test.js runs it
// against the production code: every test but the last fails there.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, unwrap, errOf, wasm, refusedAtIngress, asUpdates, account, ICP_LEDGER_ID, T, BUILD } from '../lib/pic.js';
import { GetBlocksArgs, GetBlocksResult, icrc3Service, field, btype, tx } from '../lib/icrc3.js';
import { idlFactory as notifIdl } from '../build/sneed_notifications.did.js';

const NOTIF_WASM = process.env.NOTIF_WASM || 'sneed_notifications';
const KEEP = { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] };
const PRICE = 2_000_000n; // a Discord delivery here: 0.02 ICP
const FEE = 10_000n;
const E8S = 100_000_000n;
const relay = user('notif-support-discord-relay');
const dave = user('notif-support-dave');
const erin = user('notif-support-erin');
const frank = user('notif-support-frank');
const minter = user('notif-support-minter');
const ledgerGz = resolve(BUILD, 'ledger.wasm.gz');
const haveLedger = existsSync(ledgerGz);

const hex = (b) => Buffer.from(b).toString('hex');
const P = (p) => hex(p.toUint8Array());
const plain = (v) => {
  if (v === undefined) return undefined;
  if ('Nat' in v) return v.Nat;
  if ('Int' in v) return v.Int;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return hex(v.Blob);
  if ('Array' in v) return v.Array.map(plain);
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};
const ser = (x) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const utf8 = (s) => hex(new TextEncoder().encode(s));

const fullIdl = ({ IDL: I }) => I.Service({ ...Object.fromEntries(notifIdl({ IDL: I })._fields), ...icrc3Service(I) });
const senderIdl = ({ IDL: I }) => I.Service({ forward: I.Func([I.Principal, I.Text, I.Vec(I.Nat8)], [I.Vec(I.Nat8)], []) });
const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const MetadataValue = IDL.Variant({ Nat: IDL.Nat, Int: IDL.Int, Text: IDL.Text, Blob: IDL.Vec(IDL.Nat8) });
const LedgerArg = IDL.Variant({
  Init: IDL.Record({
    minting_account: Account, transfer_fee: IDL.Nat, decimals: IDL.Opt(IDL.Nat8), token_symbol: IDL.Text, token_name: IDL.Text,
    metadata: IDL.Vec(IDL.Tuple(IDL.Text, MetadataValue)), initial_balances: IDL.Vec(IDL.Tuple(Account, IDL.Nat)),
    feature_flags: IDL.Opt(IDL.Record({ icrc2: IDL.Bool })),
    archive_options: IDL.Record({ num_blocks_to_archive: IDL.Nat64, trigger_threshold: IDL.Nat64, controller_id: IDL.Principal, cycles_for_archive_creation: IDL.Opt(IDL.Nat64) }),
  }),
  Upgrade: IDL.Opt(IDL.Record({})),
});
const icrcIdl = ({ IDL: I }) => I.Service({
  icrc1_balance_of: I.Func([Account], [I.Nat], ['query']),
  icrc1_transfer: I.Func([I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), to: Account, amount: I.Nat, fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  icrc2_approve: I.Func([I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), spender: Account, amount: I.Nat, expected_allowance: I.Opt(I.Nat), expires_at: I.Opt(I.Nat64), fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  icrc2_transfer_from: I.Func([I.Record({ spender_subaccount: I.Opt(I.Vec(I.Nat8)), from: Account, to: Account, amount: I.Nat, fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Reserved })], []),
  icrc3_get_blocks: I.Func([GetBlocksArgs], [GetBlocksResult], ['query']),
});
const mockIcpIdl = ({ IDL: I }) => I.Service({
  test_transfer_from: I.Func([Account, Account, Account, I.Nat], [I.Nat], []),
  icrc1_transfer: I.Func([I.Record({ from_subaccount: I.Opt(I.Vec(I.Nat8)), to: Account, amount: I.Nat, fee: I.Opt(I.Nat), memo: I.Opt(I.Vec(I.Nat8)), created_at_time: I.Opt(I.Nat64) })], [I.Variant({ Ok: I.Nat, Err: I.Variant({ GenericError: I.Record({ error_code: I.Nat, message: I.Text }) }) })], []),
});

let pic, appSubnet, notifId, ledgerId, senderId, sender2Id, badSmsId, appId, preInstall;
const as = (p, id = notifId) => actorAs(pic, fullIdl, id, p);
const ledger = (p) => actorAs(pic, icrcIdl, ledgerId, p);
const mockIcp = () => actorAs(pic, mockIcpIdl, ICP_LEDGER_ID, admin);
const svc = notifIdl({ IDL });
const asApp = async (name, id, ...args) => {
  const f = svc._fields.find(([k]) => k === name)[1];
  return IDL.decode(f.retTypes, await actorAs(pic, senderIdl, senderId, alice).forward(id, name, IDL.encode(f.argTypes, args)))[0];
};
let seq = 0;
const notify = (over = {}, id = notifId) => asApp('notify', id, { user: bob, topic: 'alert', title: 'Hello', body: 'Body', link: [], dedupe: [`d${seq++}`], sponsored: false, ...over });
const approve = async (who, amount, id = notifId) => unwrap(await ledger(who).icrc2_approve({ from_subaccount: [], spender: account(id), amount: amount + FEE, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
const send = async (who, to, amount) => unwrap(await ledger(who).icrc1_transfer({ from_subaccount: [], to: account(to), amount, fee: [], memo: [], created_at_time: [] }));
const ledgerTx = async (index) => plain(field((await ledger(admin).icrc3_get_blocks([{ start: index, length: 1n }])).blocks[0].block, 'tx'));
const logBlocks = async (id = notifId) => (await as(admin, id).icrc3_get_blocks([{ start: 0n, length: 1000n }])).blocks.map((b) => ({ t: btype(b.block).replace(/^sneednotif_/, ''), ...plain(tx(b.block)) }));
const TOPICS = [{ id: 'alert', title: 'Alert', description: 'Something to know', level: { urgent: null } }];
const balance = async (who, id = notifId) => (await as(who, id).get_my_settings()).balance_e8s;

/// a user with a verified Discord channel as the only channel, generous caps, no low-balance alert
async function setUser(who, id = notifId, app = appId) {
  unwrap(await as(who, id).allow_app(app, true));
  const [[, p]] = await as(who, id).get_my_apps();
  unwrap(await as(who, id).set_permission(app, { ...p, daily_cap: 10_000n, daily_spend_cap_e8s: 100_000_000_000n }));
  unwrap(await as(who, id).set_low_balance_alert(0n));
  const ch = unwrap(await as(who, id).add_channel({ discord: null }, 'my discord', new TextEncoder().encode(`enc-address-of-${who.toText()}`)));
  const jobs = await as(relay, id).relay_pull(10n);
  await as(relay, id).relay_ack(jobs.map((j) => [j.id, { ok: null }]));
  const job = jobs.find((j) => new TextDecoder().decode(j.address) === `enc-address-of-${who.toText()}` && /\d{6}/.test(j.title));
  unwrap(await as(who, id).verify_channel(ch, job.title.match(/(\d{6})/)[1]));
  const mine = await as(who, id).get_my_settings();
  unwrap(await as(who, id).set_settings({ ...mine.settings, always_copy: [], defaults: { urgent: [ch], normal: [], info: [] } }));
  return ch;
}

async function configure(id) {
  const n = as(admin, id);
  const c = await n.get_config();
  unwrap(await n.admin_set_config({ ...c, icp_ledger: ledgerId, relays: [[relay, { discord: null }]], prices_e8s: c.prices_e8s.map(([k, p]) => ('discord' in k ? [k, PRICE] : [k, p])) }));
}
const setConfig = async (over) => unwrap(await as(admin).admin_set_config({ ...(await as(admin).get_config()), ...over }));

beforeAll(async () => {
  if (!haveLedger) return;
  ({ pic, appSubnet } = await createPic());
  ledgerId = await pic.createCanister({ sender: admin, cycles: 100n * T, targetSubnetId: appSubnet, controllers: [admin] });
  await pic.installCode({ sender: admin, canisterId: ledgerId, wasm: readFileSync(ledgerGz), arg: IDL.encode([LedgerArg], [{ Init: {
    minting_account: account(minter), transfer_fee: FEE, decimals: [8], token_symbol: 'ICP', token_name: 'Internet Computer', metadata: [],
    initial_balances: [alice, bob, carol, dave, frank].map((p) => [account(p), 100n * E8S]), feature_flags: [{ icrc2: true }],
    archive_options: { num_blocks_to_archive: 1000n, trigger_threshold: 2000n, controller_id: admin, cycles_for_archive_creation: [10n * T] },
  } }]) });
  await install(pic, { name: 'MockIcpLedger', targetCanisterId: ICP_LEDGER_ID });
  senderId = await install(pic, { name: 'MockNotifySender', controllers: [alice], sender: alice });
  sender2Id = await install(pic, { name: 'MockNotifySender', controllers: [alice], sender: alice });
  badSmsId = await install(pic, { name: 'MockSmsBadReply', targetSubnetId: appSubnet });
  // bob pays this canister before it runs any code: a block older than its top-up records
  notifId = await pic.createCanister({ sender: admin, cycles: 20n * T, targetSubnetId: appSubnet, controllers: [admin] });
  preInstall = await send(bob, notifId, 7_000_000n);
  await pic.advanceTime(5_000); await pic.tick();
  await pic.installCode({ sender: admin, canisterId: notifId, wasm: wasm(NOTIF_WASM), arg: IDL.encode([], []) });
  await configure(notifId);
  appId = unwrap(await as(alice).register_app({ name: 'Support Test', logo: [], description: '', canisters: [senderId], topics: TOPICS }));
  await setUser(bob);
}, 180_000);
afterAll(async () => { await pic?.tearDown(); });

describe.skipIf(!haveLedger)('top-ups (P0-8)', () => {
  it('pull with a memo and created_at_time; each top-up is recorded with its ledger block', async () => {
    await approve(bob, 30_000_000n);
    const b1 = unwrap(await as(bob).top_up(30_000_000n));
    await approve(alice, 20_000_000n);
    unwrap(await as(alice).top_up_app(appId, 20_000_000n));
    const log = (await logBlocks()).filter((b) => b.t === 'top_up' || b.t === 'app_top_up');
    expect(log.map((b) => [b.t, b.caller])).toEqual([['top_up', P(bob)], ['app_top_up', P(alice)]]);
    const [userTx, appTx] = [await ledgerTx(log[0].ledger_block), await ledgerTx(log[1].ledger_block)];
    expect(userTx).toMatchObject({ op: 'xfer', from: [P(bob)], to: [P(notifId)], amt: 30_000_000n, spender: [P(notifId)], memo: utf8('sneednotif:top_up') });
    expect(appTx).toMatchObject({ op: 'xfer', from: [P(alice)], to: [P(notifId)], amt: 20_000_000n, memo: utf8('sneednotif:app_top_up') });
    // created_at_time: the ledger keeps it as tx.ts
    expect(typeof userTx.ts).toBe('bigint');
    expect(typeof appTx.ts).toBe('bigint');
    const bobView = unwrap(await as(admin).admin_get_user(bob, 10n));
    expect(bobView.balance_e8s).toBe(b1);
    expect(bobView.top_ups.map((t) => [t.ledger_block, t.amount_e8s, Object.keys(t.via)[0], t.app])).toEqual([[log[0].ledger_block, 30_000_000n, 'top_up', []]]);
    expect(unwrap(await as(admin).admin_get_user(alice, 10n)).top_ups.map((t) => [t.ledger_block, Object.keys(t.via)[0], t.app])).toEqual([[log[1].ledger_block, 'app_top_up', [appId]]]);
  });
});

describe.skipIf(!haveLedger)('admin_credit (P0-8)', () => {
  it('credits a payment from the principal to this canister after reading its block, once; refuses everything else', async () => {
    const before = await balance(bob);
    const direct = await send(bob, notifId, 4_000_000n); // e.g. a top-up the canister never heard back from
    unwrap(await ledger(bob).icrc2_approve({ from_subaccount: [], spender: account(carol), amount: E8S, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    const viaApproval = unwrap(await ledger(carol).icrc2_transfer_from({ spender_subaccount: [], from: account(bob), to: account(notifId), amount: 3_000_000n, fee: [], memo: [], created_at_time: [] }));
    const elsewhere = await send(bob, carol, 1_000_000n);
    const credited = (await logBlocks()).find((b) => b.t === 'top_up').ledger_block;
    const mark = (await logBlocks()).length;

    expect(await refusedAtIngress(as(bob).admin_credit(bob, 4_000_000n, direct))).toBe(true);
    expect(errOf(await as(admin).admin_credit(bob, 4_000_001n, direct))).toMatch(/moved 4000000 e8s/);
    expect(errOf(await as(admin).admin_credit(alice, 4_000_000n, direct))).toMatch(/not sent from that principal/);
    expect(errOf(await as(admin).admin_credit(bob, 1_000_000n, elsewhere))).toMatch(/not sent to this canister/);
    expect(errOf(await as(admin).admin_credit(bob, 30_000_000n, credited))).toMatch(/already credited/); // credited by its top-up
    expect(errOf(await as(admin).admin_credit(bob, 7_000_000n, preInstall))).toMatch(/older than the top-up records/);
    expect(errOf(await as(admin).admin_credit(bob, 1n, 999_999n))).toMatch(/no block/);
    expect(await balance(bob)).toBe(before);
    expect((await logBlocks()).length).toBe(mark); // refusals log nothing

    expect(unwrap(await as(admin).admin_credit(bob, 4_000_000n, direct))).toBe(before + 4_000_000n);
    expect(errOf(await as(admin).admin_credit(bob, 4_000_000n, direct))).toMatch(/already credited/);
    unwrap(await as(admin).admin_add_admin(dave));
    expect(unwrap(await as(dave).admin_credit(bob, 3_000_000n, viaApproval))).toBe(before + 7_000_000n);
    expect(await balance(bob)).toBe(before + 7_000_000n);
    expect((await logBlocks()).slice(mark).filter((b) => b.t === 'admin_credit')).toEqual([
      { t: 'admin_credit', caller: P(admin), principal: P(bob), amount_e8s: 4_000_000n, ledger_block: direct, balance_e8s: before + 4_000_000n },
      { t: 'admin_credit', caller: P(dave), principal: P(bob), amount_e8s: 3_000_000n, ledger_block: viaApproval, balance_e8s: before + 7_000_000n },
    ]);
    const ups = unwrap(await as(admin).admin_get_user(bob, 0n)).top_ups;
    expect(ups.slice(0, 2).map((t) => [t.ledger_block, Object.keys(t.via)[0]])).toEqual([[viaApproval, 'admin_credit'], [direct, 'admin_credit']]);
    // the books still balance: the credits are liabilities backed by the ICP that arrived
    const ff = await as(admin).get_fee_forwarding();
    expect(ff.liabilities_e8s).toBeLessThanOrEqual(await ledger(admin).icrc1_balance_of(account(notifId)));
  });

  it('reads the ICP ledger through query_blocks (transfers made with an approval included)', async () => {
    const c = await as(admin).get_config();
    await setConfig({ icp_ledger: ICP_LEDGER_ID });
    try {
      const before = await balance(carol);
      const i = await mockIcp().test_transfer_from(account(carol), account(notifId), account(notifId), 5_000_000n);
      const other = await mockIcp().test_transfer_from(account(carol), account(alice), account(alice), 5_000_000n);
      expect(errOf(await as(admin).admin_credit(carol, 5_000_000n, other))).toMatch(/not sent to this canister/);
      expect(errOf(await as(admin).admin_credit(bob, 5_000_000n, i))).toMatch(/not sent from that principal/);
      expect(unwrap(await as(admin).admin_credit(carol, 5_000_000n, i))).toBe(before + 5_000_000n);
      expect(errOf(await as(admin).admin_credit(carol, 5_000_000n, i))).toMatch(/already credited/);
    } finally {
      unwrap(await as(admin).admin_set_config(c));
    }
  });
});

describe.skipIf(!haveLedger)('admin_get_user (P1-9)', () => {
  it('one user\'s balance, settings, channels, apps, history and pending deliveries; admins only, as a query', async () => {
    expect((await notify()).ok.deliveries).toBe(1n);
    const v = unwrap(await as(admin).admin_get_user(bob, 5n));
    const own = await as(bob).get_my_settings();
    expect(v.balance_e8s).toBe(own.balance_e8s);
    expect(v.settings).toEqual(own.settings);
    expect(v.channels).toEqual(own.channels);
    expect(v.apps.map(([a]) => a.id)).toEqual([appId]);
    expect(v.history).toEqual(await as(bob).get_my_history(5n));
    expect(v.history[0].title).toBe('Hello');
    expect(v.pending_jobs).toBe(1n);
    expect(v.reserved_e8s).toBe(PRICE);
    expect(v.low_balance_alert).toEqual({ threshold_e8s: 0n, alerted: false });
    // the verification code is for the channel's owner only, here as well
    expect(v.history.find((h) => h.topic === 'verify').title).toBe('Your Sneed Notifications code (sent to the channel only)');
    expect(errOf(await as(bob).admin_get_user(bob, 5n))).toMatch(/Admins only/);
    expect(await refusedAtIngress(actorAs(pic, asUpdates(fullIdl), notifId, admin).admin_get_user(bob, 5n))).toBe(true);
    expect(unwrap(await as(admin).admin_get_user(user('nobody'), 5n))).toMatchObject({ balance_e8s: 0n, apps: [], top_ups: [], history: [], pending_jobs: 0n });
    const jobs = await as(relay).relay_pull(10n);
    expect(jobs).toHaveLength(1);
    await as(relay).relay_ack([[jobs[0].id, { ok: null }]]);
  });
});

describe.skipIf(!haveLedger)('removed apps (P2-19)', () => {
  it('admin_remove_app logs the app balance and leaves it for the owner to claim, once', async () => {
    const app2 = unwrap(await as(alice).register_app({ name: 'Removed', logo: [], description: '', canisters: [sender2Id], topics: TOPICS }));
    await approve(dave, 10_000_000n);
    unwrap(await as(dave).top_up_app(app2, 10_000_000n)); // anyone may fund an app
    unwrap(await as(admin).admin_remove_app(app2));
    expect(await as(alice).get_app(app2)).toEqual([]);
    expect(await as(alice).get_app_balance(app2)).toBe(10_000_000n);
    expect((await logBlocks()).filter((b) => b.t === 'app_remove').at(-1)).toMatchObject({ app_id: app2, owner: P(alice), app_balance_e8s: 10_000_000n });
    expect((await as(admin).admin_get_removed_app(app2))[0].owner.toText()).toBe(alice.toText());
    expect(errOf(await as(carol).claim_removed_app_balance(app2))).toMatch(/Only the app's owner/);
    expect(errOf(await as(alice).claim_removed_app_balance(appId))).toMatch(/No removed app/);
    const before = await balance(alice);
    expect(unwrap(await as(alice).claim_removed_app_balance(app2))).toBe(before + 10_000_000n);
    expect(await as(alice).get_app_balance(app2)).toBe(0n);
    expect(errOf(await as(alice).claim_removed_app_balance(app2))).toMatch(/Nothing to claim/);
    expect((await logBlocks()).filter((b) => b.t === 'app_balance_claim')).toEqual([
      { t: 'app_balance_claim', caller: P(alice), app_id: app2, owner: P(alice), amount_e8s: 10_000_000n, balance_e8s: before + 10_000_000n },
    ]);
    expect(await refusedAtIngress(actorAs(pic, asUpdates(fullIdl), notifId, admin).admin_get_removed_app(app2))).toBe(true);
  });
});

describe.skipIf(!haveLedger)('pruning (P2-19)', () => {
  it('a paid delivery that never became final is refunded to its payer when its notification is pruned', async () => {
    await setUser(frank);
    await approve(frank, 10_000_000n);
    unwrap(await as(frank).top_up(10_000_000n));
    const full = await balance(frank);
    expect((await notify({ user: frank })).ok.deliveries).toBe(1n);
    expect(await balance(frank)).toBe(full - PRICE); // charged when queued; the relay never takes it
    await setConfig({ retention_ns: 60_000_000_000n });
    // pruning runs every 120th delivery timer run (every 30 s)
    for (let i = 0; i < 130 && (await as(frank).get_my_history(5n)).length > 0; i++) { await pic.advanceTime(30_000); await pic.tick(); }
    expect(await as(frank).get_my_history(5n)).toEqual([]);
    expect(await balance(frank)).toBe(full);
    expect((await logBlocks()).filter((b) => b.t === 'refund').at(-1)).toMatchObject({ via: 'timer', amount_e8s: PRICE, paid_by: 'user' });
    await setConfig({ retention_ns: 30n * 86_400_000_000_000n });
  }, 240_000);
});

describe.skipIf(!haveLedger)('the delivery timer (P2-19)', () => {
  it('a trap after its await no longer stops it for good; stats shows when it last ran', async () => {
    const c = await as(admin).get_config();
    unwrap(await as(erin).allow_app(appId, true)); // default settings: a copy to Sneed SMS
    await setConfig({ sneed_sms: badSmsId });
    expect((await notify({ user: erin })).ok.deliveries).toBe(1n);
    await pic.advanceTime(1_000); await pic.tick(5); // the delivery runs: Sneed SMS answers with something that does not decode, a trap after the await
    expect((await as(erin).get_my_history(1n))[0].deliveries.map((d) => Object.keys(d.state)[0])).toEqual(['queued']);
    // the next runs must go on: Sneed SMS is now a canister without the method (a reject, a retry), one attempt only
    await setConfig({ sneed_sms: ledgerId, max_attempts: 1n });
    await pic.advanceTime(31_000); await pic.tick(5);
    expect((await as(erin).get_my_history(1n))[0].deliveries.map((d) => Object.keys(d.state)[0])).toEqual(['failed']);
    const s = await as(alice).stats();
    expect(s.ticking).toBe(false);
    expect(Number(s.last_tick_at / 1_000_000n)).toBeGreaterThan((await pic.getTime()) - 60_000);
    unwrap(await as(admin).admin_set_config(c));
  });
});

describe.skipIf(!haveLedger)('upgrade', () => {
  it('from the production build with keep: balances, apps and the log stay; logged top-ups are recorded and the records begin at the first log block', async () => {
    const oldId = await pic.createCanister({ sender: admin, cycles: 20n * T, targetSubnetId: appSubnet, controllers: [admin] });
    await pic.installCode({ sender: admin, canisterId: oldId, wasm: wasm('sneed_notifications_preaudit'), arg: IDL.encode([], []) });
    const o = (p) => as(p, oldId);
    const early = await send(dave, oldId, 2_000_000n); // before the log's first block
    await pic.advanceTime(5_000); await pic.tick();
    await configure(oldId); // the log's first block
    const a = unwrap(await o(alice).register_app({ name: 'Old', logo: [], description: '', canisters: [sender2Id], topics: TOPICS }));
    await approve(dave, 6_000_000n, oldId);
    unwrap(await o(dave).top_up(6_000_000n));
    await approve(alice, 4_000_000n, oldId);
    unwrap(await o(alice).top_up_app(a, 4_000_000n));
    const late = await send(dave, oldId, 3_000_000n); // never credited
    const [up, appUp] = (await logBlocks(oldId)).filter((b) => b.t === 'top_up' || b.t === 'app_top_up');
    const snapshot = async () => ser({
      dave: (await o(dave).get_my_settings()).balance_e8s, app: await o(alice).get_app(a), appBalance: await o(alice).get_app_balance(a),
      fees: await o(admin).get_fee_forwarding().then((f) => [f.liabilities_e8s, f.earned_e8s, f.refunded_e8s, f.forwarded_e8s]), log: (await o(admin).icrc3_log_status()).log_length, apps: await o(alice).list_apps(0n, 10n),
    });
    const before = await snapshot();
    await expect(o(admin).admin_get_user(dave, 1n)).rejects.toThrow(); // production has no support methods

    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(NOTIF_WASM), upgradeModeOptions: KEEP });
    await pic.tick(2);
    // the same, except the bootstrap admin the upgrade hook adds to the log
    expect(await snapshot()).toBe(before.replace(/"log":"(\d+)"/, (_, n) => `"log":"${Number(n) + 1}"`));
    expect(unwrap(await o(admin).admin_get_user(dave, 0n)).top_ups.map((t) => [t.ledger_block, t.amount_e8s, Object.keys(t.via)[0]])).toEqual([[up.ledger_block, 6_000_000n, 'top_up']]);
    expect(unwrap(await o(admin).admin_get_user(alice, 0n)).top_ups.map((t) => [t.ledger_block, Object.keys(t.via)[0], t.app])).toEqual([[appUp.ledger_block, 'app_top_up', [a]]]);
    expect(errOf(await o(admin).admin_credit(dave, 6_000_000n, up.ledger_block))).toMatch(/already credited/);
    expect(errOf(await o(admin).admin_credit(alice, 4_000_000n, appUp.ledger_block))).toMatch(/already credited/);
    expect(errOf(await o(admin).admin_credit(dave, 2_000_000n, early))).toMatch(/older than the top-up records/);
    expect(unwrap(await o(admin).admin_credit(dave, 3_000_000n, late))).toBe(9_000_000n);
    // a second upgrade records nothing twice
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(NOTIF_WASM), upgradeModeOptions: KEEP });
    expect(unwrap(await o(admin).admin_get_user(dave, 0n)).top_ups).toHaveLength(2);
    expect(await o(dave).get_my_settings()).toMatchObject({ balance_e8s: 9_000_000n });
  }, 240_000);
});
