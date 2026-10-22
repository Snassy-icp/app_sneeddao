// Support-audit fixes in the Sneed Hub backend (spec/support_audit.md P0-7, P1-9):
// - save_jailbreak_config takes a per-caller lock: two saves at once charge once (before, both
//   passed the duplicate check before their awaits and both charged);
// - its fee transfer carries created_at_time (the ledger deduplicates a resend) and the ICP ledger
//   block is kept with the payment log entry;
// - admins look up one principal's jailbreak payments (with ledger blocks and price tiers), saved
//   jailbreak configurations and donations, paged and newest first; the lookups are queries,
//   refused as update calls and to non-admins;
// - an upgrade with keep from the production build (src/app_sneeddao_backend at d20ab1bf, module
//   hash 3d2a5468…, build/app_sneeddao_backend_preaudit.wasm) keeps payments, configs and donations
//   and fills in the ledger blocks of payments made since the ICRC-3 log from its blocks.
// The ICP ledger here is the real ICRC ledger (build/ledger.wasm.gz) at the ICP ledger's id, so
// created_at_time and memos are what a ledger records.
// BACKEND_WASM=app_sneeddao_backend_preaudit npx vitest run tests/backend-support.test.js runs it
// against the production code: the lock, created_at_time and lookup tests fail there.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDL } from '@icp-sdk/core/candid';
import {
  createPic, actorAs, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, SNEED_SNS_ROOT, T, unwrap, errOf, wasm, BUILD, install,
  refusedAtIngress, asUpdates,
} from '../lib/pic.js';
import { ser, upgradeHub } from '../lib/hub.js';
import { GetBlocksArgs, GetBlocksResult, field, btype } from '../lib/icrc3.js';
import { idlFactory as hubIdl } from '../build/app_sneeddao_backend.did.js';

const BACKEND_WASM = process.env.BACKEND_WASM || 'app_sneeddao_backend';
const ICP_FEE = 10_000n;
const E8S = 100_000_000n;
const dave = user('support-dave');
const ledgerGz = resolve(BUILD, 'ledger.wasm.gz');
const haveLedger = existsSync(ledgerGz);

// "\njailbreak" then the principal's bytes, cut or zero-padded to 32
const jailbreakSub = (p) => { const out = new Uint8Array(32); const b = [0x0a, ...new TextEncoder().encode('jailbreak'), ...p.toUint8Array()]; out.set(b.slice(0, 32)); return out; };

// the backend's interface plus the support lookups (so the test runs against a build without them, and fails there)
const fullIdl = ({ IDL: I }) => {
  const Tier = I.Variant({ regular: I.Null, premium: I.Null, admin: I.Null, partner: I.Text });
  const Config = I.Record({ id: I.Nat, sns_root_canister_id: I.Principal, neuron_id_hex: I.Text, target_principal: I.Principal, created_at: I.Int });
  const Payment = I.Record({
    id: I.Nat, user: I.Principal, config_id: I.Nat, sns_root_canister_id: I.Principal, neuron_id_hex: I.Text, target_principal: I.Principal,
    amount_e8s: I.Nat, is_premium: I.Bool, timestamp: I.Int, block_index: I.Opt(I.Nat), price_tier: Tier,
  });
  const base = Object.fromEntries(hubIdl({ IDL: I })._fields);
  const donationsPage = base.admin_get_donations.retTypes[0];
  return I.Service({
    ...base,
    admin_get_jailbreak_payments_for: I.Func([I.Principal, I.Nat, I.Nat], [I.Variant({ ok: I.Record({ payments: I.Vec(Payment), total: I.Nat }), err: I.Text })], ['query']),
    admin_get_jailbreak_configs_for: I.Func([I.Principal, I.Nat, I.Nat], [I.Variant({ ok: I.Record({ configs: I.Vec(Config), total: I.Nat }), err: I.Text })], ['query']),
    admin_get_donations_by: I.Func([I.Principal, I.Nat, I.Nat], [donationsPage], ['query']),
    icrc3_get_blocks: I.Func([GetBlocksArgs], [GetBlocksResult], ['query']),
  });
};

// the real ICRC ledger
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
  icrc3_get_blocks: I.Func([GetBlocksArgs], [GetBlocksResult], ['query']),
});

let pic, appSubnet, hubId, tokId;
const as = (p, id = hubId) => actorAs(pic, fullIdl, id, p);
const icpAs = (p) => actorAs(pic, icrcIdl, ICP_LEDGER_ID, p);
const tokAs = (p) => actorAs(pic, icrcIdl, tokId, p);
const icpBalance = (owner, sub) => icpAs(admin).icrc1_balance_of(account(owner, sub));
const deposit = async (who, amount, id = hubId) => unwrap(await icpAs(alice).icrc1_transfer({ from_subaccount: [], to: account(id, jailbreakSub(who)), amount, fee: [], memo: [], created_at_time: [] }));
const ledgerBlock = async (ledger, index) => (await ledger.icrc3_get_blocks([{ start: index, length: 1n }])).blocks.find((b) => b.id === index).block;
const lastBlock = async (ledger) => (await ledger.icrc3_get_blocks([{ start: 0n, length: 0n }])).log_length - 1n;
const plain = (v) => {
  if (v === undefined) return undefined;
  if ('Nat' in v) return v.Nat;
  if ('Int' in v) return v.Int;
  if ('Text' in v) return v.Text;
  if ('Blob' in v) return Buffer.from(v.Blob).toString('hex');
  if ('Array' in v) return v.Array.map(plain);
  return Object.fromEntries(v.Map.map(([k, x]) => [k, plain(x)]));
};
const hex = (b) => Buffer.from(b).toString('hex');

async function installLedger(canisterId, initial) {
  await pic.installCode({ sender: admin, canisterId, wasm: readFileSync(ledgerGz), arg: IDL.encode([LedgerArg], [{ Init: {
    minting_account: account(user('support-minter')), transfer_fee: ICP_FEE, decimals: [8], token_symbol: 'ICP', token_name: 'Internet Computer', metadata: [],
    initial_balances: initial, feature_flags: [{ icrc2: true }],
    archive_options: { num_blocks_to_archive: 1000n, trigger_threshold: 2000n, controller_id: admin, cycles_for_archive_creation: [10n * T] },
  } }]) });
}

/// Submits the same call twice before either finishes, then awaits both (decoded).
async function twoAtOnce(sender, method, types, args, retTypes) {
  const arg = IDL.encode(types, args);
  const a = await pic.submitCall({ canisterId: hubId, method, arg, sender });
  const b = await pic.submitCall({ canisterId: hubId, method, arg, sender });
  const ra = await pic.awaitCall(a);
  const rb = await pic.awaitCall(b);
  return [IDL.decode(retTypes, ra)[0], IDL.decode(retTypes, rb)[0]];
}

beforeAll(async () => {
  if (!haveLedger) return;
  ({ pic, appSubnet } = await createPic());
  const icpId = await pic.createCanister({ sender: admin, cycles: 100n * T, targetCanisterId: ICP_LEDGER_ID, controllers: [admin] });
  await installLedger(icpId, [[account(alice), 1_000n * E8S]]);
  tokId = await pic.createCanister({ sender: admin, cycles: 100n * T, targetSubnetId: appSubnet, controllers: [admin] });
  await installLedger(tokId, [[account(alice), 1_000n * E8S], [account(bob), 1_000n * E8S]]);
  hubId = await install(pic, { name: BACKEND_WASM, cycles: 20n * T, targetSubnetId: appSubnet });
  await as(admin).add_admin(dave);
  // the regular price: 1 ICP to carol
  unwrap(await as(admin).set_jailbreak_fee_settings([E8S / 2n], [E8S], [[carol]], []));
}, 180_000);
afterAll(async () => { await pic?.tearDown(); });

describe.skipIf(!haveLedger)('save_jailbreak_config (P0-7)', () => {
  it('two saves at once charge once: the second is refused while the first is in flight', async () => {
    await deposit(bob, 3n * E8S);
    const before = await icpBalance(carol);
    const save = hubIdl({ IDL })._fields.find(([k]) => k === 'save_jailbreak_config')[1];
    const [r1, r2] = await twoAtOnce(bob, 'save_jailbreak_config', save.argTypes, [SNEED_SNS_ROOT, 'abcdef01', bob], save.retTypes);
    const oks = [r1, r2].filter((r) => 'ok' in r);
    expect(oks).toHaveLength(1);
    expect(errOf([r1, r2].find((r) => 'err' in r))).toMatch(/already in progress/);
    // one fee to carol, one fee and one ledger fee out of bob's deposit
    expect(await icpBalance(carol) - before).toBe(E8S);
    expect(await icpBalance(hubId, jailbreakSub(bob))).toBe(3n * E8S - E8S - ICP_FEE);
    expect(unwrap(await as(admin).get_jailbreak_payment_logs(0n, 10n)).total).toBe(1n);
    expect(await as(bob).get_my_jailbreak_configs()).toHaveLength(1);
    // the lock is released: the same config again is free, another one is charged
    expect(unwrap(await as(bob).save_jailbreak_config(SNEED_SNS_ROOT, 'abcdef01', bob))).toBe(oks[0].ok);
    unwrap(await as(bob).save_jailbreak_config(SNEED_SNS_ROOT, 'abcdef02', bob));
    expect(await icpBalance(carol) - before).toBe(2n * E8S);
    // other callers are not held up by bob's lock
    await deposit(alice, E8S + ICP_FEE);
    const [a1, b1] = await Promise.all([as(alice).save_jailbreak_config(SNEED_SNS_ROOT, 'aa', alice), as(bob).get_my_jailbreak_configs()]);
    unwrap(a1);
    expect(b1).toHaveLength(2);
  }, 120_000);

  it('the fee transfer carries created_at_time and the "jailbreak" memo, and its ledger block is kept with the payment', async () => {
    const page = unwrap(await as(admin).admin_get_jailbreak_payments_for(bob, 0n, 10n));
    expect(page.total).toBe(2n);
    expect(page.payments.map((p) => p.neuron_id_hex)).toEqual(['abcdef02', 'abcdef01']); // newest first
    for (const p of page.payments) {
      expect(p.user.toText()).toBe(bob.toText());
      expect(p.price_tier).toEqual({ regular: null });
      expect(p.block_index).toHaveLength(1);
      const b = await ledgerBlock(icpAs(admin), p.block_index[0]);
      const t = plain(field(b, 'tx'));
      expect(t).toMatchObject({ op: 'xfer', amt: E8S, from: [hex(hubId.toUint8Array()), hex(jailbreakSub(bob))], to: [hex(carol.toUint8Array())], memo: hex(new TextEncoder().encode('jailbreak')) });
      // created_at_time: the ledger keeps it as tx.ts, close to the payment's own timestamp
      expect(typeof t.ts).toBe('bigint');
      expect(Number(t.ts / 1_000_000_000n)).toBeCloseTo(Number(BigInt(p.timestamp) / 1_000_000_000n), -1);
    }
    // the log's jailbreak_payment blocks name the same ledger blocks
    const log = (await as(admin).icrc3_get_blocks([{ start: 0n, length: 100n }])).blocks.map((b) => b.block).filter((b) => btype(b) === 'sneedbackend_jailbreak_payment');
    const fromLog = Object.fromEntries(log.map((b) => [plain(field(field(b, 'tx'), 'payment_id')), plain(field(field(b, 'tx'), 'icp_tx'))]));
    for (const p of page.payments) expect(fromLog[p.id]).toBe(p.block_index[0]);
    // paging
    const one = unwrap(await as(dave).admin_get_jailbreak_payments_for(bob, 1n, 1n));
    expect(one.payments.map((p) => p.neuron_id_hex)).toEqual(['abcdef01']);
    expect(unwrap(await as(admin).admin_get_jailbreak_payments_for(bob, 5n, 10n)).payments).toEqual([]);
    expect(unwrap(await as(admin).admin_get_jailbreak_payments_for(carol, 0n, 10n))).toEqual({ payments: [], total: 0n });
  });
});

describe.skipIf(!haveLedger)('support lookups by principal (P1-9)', () => {
  it('admins read one principal\'s jailbreak configurations, newest first and paged', async () => {
    const all = unwrap(await as(admin).admin_get_jailbreak_configs_for(bob, 0n, 10n));
    expect(all.total).toBe(2n);
    expect(ser(all.configs)).toBe(ser([...(await as(bob).get_my_jailbreak_configs())].reverse()));
    expect(unwrap(await as(admin).admin_get_jailbreak_configs_for(bob, 1n, 5n)).configs.map((c) => c.neuron_id_hex)).toEqual(['abcdef01']);
    expect(unwrap(await as(admin).admin_get_jailbreak_configs_for(carol, 0n, 5n))).toEqual({ configs: [], total: 0n });
  });

  it('admins read one donor\'s donations, hidden ones included, newest first and paged', async () => {
    await as(admin).add_whitelisted_token({ ledger_id: tokId, decimals: 8, fee: ICP_FEE, name: 'Token', symbol: 'TOK', standard: 'ICRC1' });
    unwrap(await as(admin).admin_set_donation_account([account(dave)]));
    const give = async (who, amount) => {
      const block = unwrap(await tokAs(who).icrc1_transfer({ from_subaccount: [], to: account(dave), amount, fee: [], memo: [], created_at_time: [] }));
      return unwrap(await as(who).register_donation({ ledger: tokId, block_index: block, from_subaccount: [], message: [] }));
    };
    const d1 = await give(alice, 1n * E8S);
    const d2 = await give(bob, 2n * E8S);
    const d3 = await give(alice, 3n * E8S);
    unwrap(await as(admin).admin_set_donation_hidden(d3.id, true));
    const mine = unwrap(await as(admin).admin_get_donations_by(alice, 0n, 10n));
    expect(mine.total).toBe(2n);
    expect(mine.donations.map((d) => [d.id, d.amount, d.hidden])).toEqual([[d3.id, 3n * E8S, true], [d1.id, E8S, false]]);
    expect(unwrap(await as(admin).admin_get_donations_by(alice, 1n, 1n)).donations.map((d) => d.id)).toEqual([d1.id]);
    expect(unwrap(await as(dave).admin_get_donations_by(bob, 0n, 10n)).donations.map((d) => d.id)).toEqual([d2.id]);
    expect(unwrap(await as(admin).admin_get_donations_by(carol, 0n, 10n))).toEqual({ total: 0n, donations: [] });
  });

  it('the lookups are admin-only queries: refused to others and refused as update calls', async () => {
    expect(errOf(await as(alice).admin_get_jailbreak_payments_for(bob, 0n, 10n))).toMatch(/Not authorized/);
    expect(errOf(await as(bob).admin_get_jailbreak_configs_for(bob, 0n, 10n))).toMatch(/Not authorized/);
    expect(errOf(await as(alice).admin_get_donations_by(alice, 0n, 10n))).toMatch(/Only admins/);
    const upd = (p) => actorAs(pic, asUpdates(fullIdl), hubId, p);
    expect(await refusedAtIngress(upd(admin).admin_get_jailbreak_payments_for(bob, 0n, 10n))).toBe(true);
    expect(await refusedAtIngress(upd(admin).admin_get_jailbreak_configs_for(bob, 0n, 10n))).toBe(true);
    expect(await refusedAtIngress(upd(admin).admin_get_donations_by(bob, 0n, 10n))).toBe(true);
  });
});

describe.skipIf(!haveLedger)('upgrade', () => {
  it('from the production build with keep: payments, configs and donations stay, and payments get their ledger blocks from the log', async () => {
    const oldId = await install(pic, { name: 'app_sneeddao_backend_preaudit', cycles: 20n * T, targetSubnetId: appSubnet });
    const o = (p) => as(p, oldId);
    await expect(o(admin).admin_get_jailbreak_payments_for(bob, 0n, 10n)).rejects.toThrow(); // production has no lookups
    unwrap(await o(admin).set_jailbreak_fee_settings([E8S / 2n], [E8S], [[carol]], []));
    await deposit(bob, 3n * E8S + 3n * ICP_FEE, oldId);
    unwrap(await o(bob).save_jailbreak_config(SNEED_SNS_ROOT, 'beef', bob));
    const blk = await lastBlock(icpAs(admin));
    unwrap(await o(bob).save_jailbreak_config(SNEED_SNS_ROOT, 'cafe', alice));
    const blk2 = await lastBlock(icpAs(admin));
    await o(admin).add_whitelisted_token({ ledger_id: tokId, decimals: 8, fee: ICP_FEE, name: 'Token', symbol: 'TOK', standard: 'ICRC1' });
    unwrap(await o(admin).admin_set_donation_account([account(dave)]));
    const dblock = unwrap(await tokAs(bob).icrc1_transfer({ from_subaccount: [], to: account(dave), amount: E8S, fee: [], memo: [], created_at_time: [] }));
    const d = unwrap(await o(bob).register_donation({ ledger: tokId, block_index: dblock, from_subaccount: [], message: [] }));
    const snapshot = async () => ser({
      payments: await o(admin).get_jailbreak_payment_logs(0n, 10n), stats: await o(admin).get_jailbreak_payment_stats(),
      tiers: await o(admin).get_jailbreak_payment_price_tiers([1n, 2n]),
      configs: await o(bob).get_my_jailbreak_configs(), donations: await o(admin).admin_get_donations(0n, 10n),
      fees: await o(admin).get_jailbreak_fee_settings(), admins: await o(admin).get_admins(), log: await o(admin).icrc3_log_status(),
    });
    const before = await snapshot();

    await upgradeHub(pic, oldId, admin, wasm(BACKEND_WASM));
    await pic.tick(2);
    expect(await snapshot()).toBe(before);
    const page = unwrap(await o(admin).admin_get_jailbreak_payments_for(bob, 0n, 10n));
    expect(page.payments.map((p) => [p.neuron_id_hex, p.block_index])).toEqual([['cafe', [blk2]], ['beef', [blk]]]);
    expect(unwrap(await o(admin).admin_get_jailbreak_configs_for(bob, 0n, 10n)).total).toBe(2n);
    expect(unwrap(await o(admin).admin_get_donations_by(bob, 0n, 10n)).donations.map((x) => x.id)).toEqual([d.id]);
    // a payment after the upgrade is recorded directly; a second upgrade changes nothing
    unwrap(await o(bob).save_jailbreak_config(SNEED_SNS_ROOT, 'f00d', bob));
    const blk3 = await lastBlock(icpAs(admin));
    await upgradeHub(pic, oldId, admin, wasm(BACKEND_WASM));
    await pic.tick(2);
    expect(unwrap(await o(admin).admin_get_jailbreak_payments_for(bob, 0n, 10n)).payments.map((p) => p.block_index)).toEqual([[blk3], [blk2], [blk]]);
  }, 240_000);
});
