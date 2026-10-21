// sneed_pad special prices (spec/special_prices.md): an admin price and partner prices for the
// token launch fee, the index fee and the Sneed DAO handover fee, next to the regular and premium
// fees. Defaults change nothing; the admin price is for admins who are people (never a canister or
// SNS governance); a partner price only for that principal and until its expiry; the lowest
// applicable fee wins; only admins set them; every change is a sneedpad_config_update block and
// launches record (and log) the tiers they paid; an upgrade from the code before special prices
// (build/sneed_pad_presp.wasm, commit f9d8db0b) keeps its configuration and starts with none.
// PAD_WASM=sneed_pad_presp npx vitest run tests/sneed-pad-special-prices.test.js runs it against
// that code (where the special-price tests fail).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Principal } from '@icp-sdk/core/principal';
import {
  createPic, install, actorAs, account, admin, alice, bob, carol, user, ICP_LEDGER_ID, SNEED_GOVERNANCE, SNEED_SNS_ROOT, T, unwrap, errOf, BUILD, wasm, refusedAtIngress,
} from '../lib/pic.js';
import { ledgerIdl, ledgerInit, snsWasmIdl, premiumIdl, sneedAppIdl } from '../lib/idl.js';
import { btype, txField } from '../lib/icrc3.js';
import { idlFactory as padIdl } from '../build/sneed_pad.did.js';

const PAD_WASM = process.env.PAD_WASM || 'sneed_pad';
const ICP_FEE = 10_000n;
const ICP = 100_000_000n;
const NS = 1_000_000_000n;
const HOUR = 3600;
const ledgerGz = resolve(BUILD, 'ledger.wasm.gz');
const indexGz = resolve(BUILD, 'index.wasm.gz');
const haveWasms = existsSync(ledgerGz) && existsSync(indexGz);
const sha256 = (bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest());
const hex = (b) => Buffer.from(b).toString('hex');
const dave = user('dave');
const partnerCanister = Principal.fromUint8Array(Uint8Array.from([0, 0, 0, 0, 0, 0, 0x30, 0x09, 1, 1])); // "a partner game canister"
const adminCanister = Principal.fromUint8Array(Uint8Array.from([0, 0, 0, 0, 0, 0, 0x30, 0x0a, 1, 1]));

let pic, icpId, padId, govId;
let icp;
const as = (p, id = padId) => actorAs(pic, padIdl, id, p);
const config = (over = {}) => ({
  name: 'Test Token', symbol: 'TST', decimals: 8, transfer_fee: 10_000n, logo: [],
  allocations: [{ account: account(alice), amount: 1_000_000_000_000n }],
  minting: { nobody: null }, fee_collector: [], control: { keep: null }, with_index: false,
  ...over,
});
const DAO = { control: { sneed_dao: null }, minting: { sneed_dao: null } };
const opt = (v) => (v === null || v === undefined ? [] : [v]);
const prices = ({ creation = null, index = null, control = null } = {}) => ({ creation_fee_e8s: opt(creation), index_creation_fee_e8s: opt(index), sneed_dao_control_fee_e8s: opt(control) });
const entry = (label, p, expires = null) => ({ label, prices: prices(p), expires_at: opt(expires) });
const quote = (p, over = {}) => as(p).get_quote(config(over)).then(unwrap);
const indexQuote = (p) => as(p).get_index_quote({ ledger: icpId, control: { keep: null } }).then(unwrap);
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const blocks = async () => (await as(admin).icrc3_get_blocks([{ start: 0n, length: 10_000n }])).blocks.map((b) => b.block);
const tierKey = (t) => Object.keys(t)[0];
const configUpdate = (over = {}) => ({ guardians: [], index_creation_fee_e8s: [], premium_index_creation_fee_e8s: [], creation_fee_e8s: [], premium_creation_fee_e8s: [], sneed_dao_control_fee_e8s: [], ledger_cycles: [], index_cycles: [], fee_destination: [], cycle_reserve: [], paused: [], follow_nns: [], ...over });

// regular 5 ICP, premium 2.5, index 1 / 0.5, handover 1
describe.skipIf(!haveWasms)('sneed_pad special prices', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
    const cmcId = await install(pic, { name: 'MockCmc' });
    const snsWasmId = await install(pic, { name: 'MockSnsWasm' });
    govId = await install(pic, { name: 'MockSnsGovernance', targetCanisterId: SNEED_GOVERNANCE });
    const premiumId = await install(pic, { name: 'MockPremium' });
    const sneedAppId = await install(pic, { name: 'MockSneedApp' });
    padId = await install(pic, { name: PAD_WASM, cycles: 200n * T });
    icp = actorAs(pic, ledgerIdl, icpId, admin);
    const ledgerBytes = readFileSync(ledgerGz); const indexBytes = readFileSync(indexGz);
    const snsWasm = actorAs(pic, snsWasmIdl, snsWasmId, admin);
    await snsWasm.set_wasm(sha256(ledgerBytes), Uint8Array.from(ledgerBytes));
    await snsWasm.set_wasm(sha256(indexBytes), Uint8Array.from(indexBytes));
    await snsWasm.set_latest([['Root', '00'], ['Ledger', hex(sha256(ledgerBytes))], ['Ledger Index', hex(sha256(indexBytes))]]);
    unwrap(await as(admin).admin_set_canisters({ icp_ledger: [icpId], cmc: [cmcId], sns_wasm: [snsWasmId], governance: [govId], root: [SNEED_SNS_ROOT], blackhole: [carol], sneed_premium: [[premiumId]], sneedapp: [[sneedAppId]] }));
    await actorAs(pic, sneedAppIdl, sneedAppId, admin).set_authorized([padId]);
    unwrap(await as(admin).admin_set_config(configUpdate({ sneed_dao_control_fee_e8s: [ICP], fee_destination: [account(dave)] })));
    await actorAs(pic, premiumIdl, premiumId, admin).set_member(bob, (await nowNs()) + 365n * 86_400n * NS);
    unwrap(await as(admin).admin_add_admin(carol));
    await icp.mint(account(alice), 100n * ICP);
    await icp.mint(account(carol), 100n * ICP);
    await icp.mint(account(partnerCanister), 100n * ICP);
    unwrap(await as(alice).refresh_wasms());
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('charges exactly as before by default: regular, premium for members, nothing special for admins', async () => {
    expect((await quote(alice)).creation_fee_e8s).toBe(5n * ICP);
    expect((await quote(bob)).creation_fee_e8s).toBe(250_000_000n);
    expect((await quote(carol)).creation_fee_e8s).toBe(5n * ICP);
    expect((await quote(carol, DAO)).control_fee_e8s).toBe(ICP);
    expect((await indexQuote(alice)).creation_fee_e8s).toBe(ICP);
    expect((await indexQuote(bob)).creation_fee_e8s).toBe(ICP / 2n);
    const sp = await as(alice).get_special_prices();
    expect(sp.admin_prices).toEqual(prices());
    expect(sp.partners).toEqual([]);
    expect((await as(alice).get_special_prices_for(carol)).partner).toEqual([]);
  });

  it('lets only admins (or SNS governance) set special prices', async () => {
    expect(errOf(await as(alice).set_admin_prices(prices({ creation: 1n })))).toMatch(/admin only/);
    expect(errOf(await as(dave).set_partner_prices(partnerCanister, entry('a partner game canister', { creation: 1n })))).toMatch(/admin only/);
    expect(errOf(await as(bob).remove_partner_prices(partnerCanister))).toMatch(/admin only/);
    unwrap(await as(SNEED_GOVERNANCE).set_admin_prices(prices()));
  });

  it('gives the admin price to admins who are people, per fee', async () => {
    unwrap(await as(carol).set_admin_prices(prices({ creation: 1_000_000n, control: 2_000_000n })));
    let q = await quote(carol, DAO);
    expect(q.creation_fee_e8s).toBe(1_000_000n);
    expect(q.control_fee_e8s).toBe(2_000_000n);
    expect(q.total_e8s).toBe(1_000_000n + 2_000_000n + q.icp_for_cycles_e8s + 3n * ICP_FEE);
    expect((await indexQuote(carol)).creation_fee_e8s).toBe(ICP); // no index override: regular
    expect((await quote(carol)).control_fee_e8s).toBe(0n); // no handover, no handover fee
    expect((await quote(alice, DAO)).creation_fee_e8s).toBe(5n * ICP);
    expect((await quote(alice, DAO)).control_fee_e8s).toBe(ICP);
    expect((await as(alice).get_special_prices_for(carol)).admin_prices[0].creation_fee_e8s).toEqual([1_000_000n]);
    expect((await as(alice).get_special_prices_for(alice)).admin_prices).toEqual([]);
    // a canister on the admin list (or SNS governance) never gets it
    unwrap(await as(carol).admin_add_admin(adminCanister));
    expect((await quote(adminCanister)).creation_fee_e8s).toBe(5n * ICP);
    expect((await as(alice).get_special_prices_for(adminCanister)).admin_prices).toEqual([]);
    expect((await as(alice).get_special_prices_for(SNEED_GOVERNANCE)).admin_prices).toEqual([]);
    unwrap(await as(carol).admin_remove_admin(adminCanister));
  });

  it('gives a partner price to that principal only, until it expires', async () => {
    const expires = (await nowNs()) + BigInt(HOUR) * NS;
    unwrap(await as(carol).set_partner_prices(partnerCanister, entry('a partner game canister', { creation: 3_000_000n, index: 4_000_000n }, expires)));
    expect((await quote(partnerCanister)).creation_fee_e8s).toBe(3_000_000n);
    expect((await indexQuote(partnerCanister)).creation_fee_e8s).toBe(4_000_000n);
    expect((await quote(partnerCanister, DAO)).control_fee_e8s).toBe(ICP); // no handover override
    expect((await quote(alice)).creation_fee_e8s).toBe(5n * ICP);
    const listed = (await as(dave).get_special_prices()).partners;
    expect(listed.length).toBe(1);
    expect(listed[0].principal.toText()).toBe(partnerCanister.toText());
    expect(listed[0].label).toBe('a partner game canister');
    expect(listed[0].expires_at).toEqual([expires]);
    await pic.advanceTime(2 * HOUR * 1000); await pic.tick(2);
    expect((await quote(partnerCanister)).creation_fee_e8s).toBe(5n * ICP);
    expect((await as(alice).get_special_prices_for(partnerCanister)).partner).toEqual([]);
    expect((await as(alice).get_special_prices()).partners.length).toBe(1);
  });

  it('charges the lowest applicable fee', async () => {
    unwrap(await as(carol).set_partner_prices(bob, entry('above premium', { creation: 300_000_000n })));
    expect((await quote(bob)).creation_fee_e8s).toBe(250_000_000n);
    unwrap(await as(carol).set_partner_prices(bob, entry('below premium', { creation: 200_000_000n })));
    expect((await quote(bob)).creation_fee_e8s).toBe(200_000_000n);
    unwrap(await as(carol).set_partner_prices(carol, entry('admin and partner', { creation: 500_000n, control: 9_000_000n })));
    const q = await quote(carol, DAO);
    expect(q.creation_fee_e8s).toBe(500_000n); // partner below admin
    expect(q.control_fee_e8s).toBe(2_000_000n); // admin below partner
    for (const p of [bob, carol]) unwrap(await as(carol).remove_partner_prices(p));
  });

  it('validates partner entries', async () => {
    expect(errOf(await as(carol).set_partner_prices(partnerCanister, entry('', { creation: 1n })))).toMatch(/label/);
    expect(errOf(await as(carol).set_partner_prices(partnerCanister, entry('old', { creation: 1n }, (await nowNs()) - NS)))).toMatch(/past/);
    expect(errOf(await as(carol).set_partner_prices(Principal.anonymous(), entry('anon', { creation: 1n })))).toMatch(/anonymous/);
    expect(await refusedAtIngress(as(carol).set_partner_prices(partnerCanister, entry('x'.repeat(101), { creation: 1n })))).toBe(true);
    expect(errOf(await as(carol).remove_partner_prices(dave))).toMatch(/no partner/);
  });

  it('records the tiers a launch paid, in the launch and the log, and logs every change', async () => {
    unwrap(await as(carol).set_partner_prices(partnerCanister, entry('a partner game canister', { creation: 3_000_000n, index: 4_000_000n })));
    // the partner launches a token handed to Sneed DAO: partner launch fee, regular handover fee
    const q = await quote(partnerCanister, DAO);
    const icpPartner = actorAs(pic, ledgerIdl, icpId, partnerCanister);
    unwrap(await icpPartner.icrc2_approve({ from_subaccount: [], spender: account(padId), amount: 10n * ICP, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    const feeBefore = await icp.icrc1_balance_of(account(dave));
    const launch = unwrap(await as(partnerCanister).create_token(config({ ...DAO, symbol: 'PRT' })));
    expect(launch.quote.creation_fee_e8s).toBe(3_000_000n);
    expect(launch.paid_e8s).toBe(q.total_e8s);
    expect((await icp.icrc1_balance_of(account(dave))) - feeBefore).toBe(3_000_000n + ICP - ICP_FEE);
    const tiers = (await as(alice).get_launch_price_tiers(launch.id))[0];
    expect(tierKey(tiers.creation_fee)).toBe('partner');
    expect(tierKey(tiers.control_fee)).toBe('regular');
    // the admin creates an index: regular index fee (no admin override for it)
    const icpCarol = actorAs(pic, ledgerIdl, icpId, carol);
    unwrap(await icpCarol.icrc2_approve({ from_subaccount: [], spender: account(padId), amount: 10n * ICP, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] }));
    const il = unwrap(await as(carol).create_index({ ledger: icpId, control: { keep: null } }));
    expect(tierKey((await as(alice).get_index_launch_price_tiers(il.id))[0].creation_fee)).toBe('regular');
    unwrap(await as(carol).remove_partner_prices(partnerCanister));

    const all = await blocks();
    const tokenBlock = all.filter((b) => btype(b) === 'sneedpad_token_create').pop();
    expect(txField(tokenBlock, 'price_tier').Text).toBe('partner');
    expect(txField(tokenBlock, 'control_price_tier').Text).toBe('regular');
    const indexBlock = all.filter((b) => btype(b) === 'sneedpad_index_create' && txField(b, 'standalone')).pop();
    expect(txField(indexBlock, 'price_tier').Text).toBe('regular');
    const cfg = all.filter((b) => btype(b) === 'sneedpad_config_update');
    const adminBlock = cfg.filter((b) => txField(b, 'key').Text === 'admin_prices').pop();
    expect(txField(adminBlock, 'value').Map).toEqual([['creation_fee_e8s', { Nat: 1_000_000n }], ['sneed_dao_control_fee_e8s', { Nat: 2_000_000n }]]);
    expect(txField(adminBlock, 'old_value').Map).toEqual([]);
    const partnerBlocks = cfg.filter((b) => txField(b, 'key').Text === 'partner_prices' && Buffer.from(txField(b, 'partner').Blob).equals(Buffer.from(partnerCanister.toUint8Array())));
    const set = Object.fromEntries(txField(partnerBlocks[partnerBlocks.length - 2], 'value').Map);
    expect(set.label.Text).toBe('a partner game canister');
    expect(set.prices.Map).toEqual([['creation_fee_e8s', { Nat: 3_000_000n }], ['index_creation_fee_e8s', { Nat: 4_000_000n }]]);
    expect(txField(partnerBlocks[partnerBlocks.length - 1], 'value').Text).toBe('removed');
  });

  it('upgrades from the code before special prices, keeping its configuration and starting with none', async () => {
    const oldId = await install(pic, { name: 'sneed_pad_presp', cycles: 20n * T });
    const old = as(admin, oldId);
    unwrap(await old.admin_set_config(configUpdate({ creation_fee_e8s: [7n * ICP], premium_creation_fee_e8s: [3n * ICP] })));
    unwrap(await old.admin_add_admin(carol));
    const before = await old.get_config();
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm(PAD_WASM) });
    const neu = as(admin, oldId);
    const after = await neu.get_config();
    expect(after.creation_fee_e8s).toBe(7n * ICP);
    expect(after.premium_creation_fee_e8s).toBe(3n * ICP);
    expect(after.fee_destination).toEqual(before.fee_destination);
    expect((await neu.get_admins()).map(String)).toEqual((await old.get_admins()).map(String));
    const sp = await neu.get_special_prices();
    expect(sp.admin_prices).toEqual(prices());
    expect(sp.partners).toEqual([]);
    expect(await neu.get_launch_price_tiers(1n)).toEqual([]);
  });
});
