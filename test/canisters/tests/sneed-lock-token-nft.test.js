// Token locks as NFTs (spec/sneed_lock_v2.md, section 4): every live token lock is an ICRC-7
// NFT. A transfer between principals moves the locked amount between Sneed wallets; its ledger
// fee comes from the owner's free balance, else from the lock's gas tank (which anyone can fund,
// two fees per transfer), else the transfer is refused and nothing moves.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, account, principalToSubaccount, admin, alice, bob, carol, ICP_LEDGER_ID, T, unwrap, errOf, wasm } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import { btype, txField } from '../lib/icrc3.js';
import { idlFactory as sneedLockIdl } from '../build/sneed_lock.did.js';

const FEE = 1_000n;
const DAY_NS = 86_400n * 1_000_000_000n;
const sub = (n) => new Uint8Array(32).fill(n);
const acc = (owner, s) => ({ owner, subaccount: s ? [s] : [] });

let pic, appSubnet, lockId, tokenId;
let token, lock, lockAlice, lockBob, lockCarol;
const nowNs = async () => BigInt(Math.round(await pic.getTime())) * 1_000_000n;
const wallet = (p) => account(lockId, principalToSubaccount(p));
const bal = (a) => token.icrc1_balance_of(a);
const lastBlocks = async (n) => {
  const s = await lock.icrc3_log_status();
  return (await lock.icrc3_get_blocks([{ start: s.log_length - BigInt(n), length: BigInt(n) }])).blocks.map((b) => b.block);
};
const ownerOf = async (id) => { const [o] = (await lock.icrc7_owner_of([id]))[0]; return o ? `${o.owner.toText()}${o.subaccount.length ? `.${o.subaccount[0][0]}` : ''}` : null; };
const send = (actor, id, to, extra = {}) => actor.icrc7_transfer([{ from_subaccount: [], to, token_id: id, memo: [], created_at_time: [], ...extra }]).then((r) => r[0][0]);
const gasAccount = async (id) => (await lock.get_lock_gas(id))[0].account;
/** A lock of `amount` for `who`, with exactly `free` left over in the Sneed wallet. */
async function newLock(who, actor, amount, free, delay = []) {
  const before = await bal(wallet(who));
  const locked = (await actor.get_summed_locks()).find(([l]) => l.toText() === tokenId.toText())?.[1] ?? 0n;
  const have = before - locked;
  const need = amount + free;
  if (have < need) await token.mint(wallet(who), need - have);
  else if (have > need) unwrap(await actor.transfer_tokens(admin, [], tokenId, have - need - FEE));
  return unwrap(await actor.create_lock(amount, tokenId, (await nowNs()) + DAY_NS, delay));
}

beforeAll(async () => {
  ({ pic, appSubnet } = await createPic());
  await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
  tokenId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: FEE, symbol: 'AAA', decimals: 8 }], targetSubnetId: appSubnet });
  lockId = await install(pic, { name: 'sneed_lock', cycles: 20n * T, targetSubnetId: appSubnet });
  token = actorAs(pic, ledgerIdl, tokenId, admin);
  lock = actorAs(pic, sneedLockIdl, lockId, admin);
  lockAlice = actorAs(pic, sneedLockIdl, lockId, alice);
  lockBob = actorAs(pic, sneedLockIdl, lockId, bob);
  lockCarol = actorAs(pic, sneedLockIdl, lockId, carol);
  await pic.tick(3);
});
afterAll(async () => { await pic?.tearDown(); });

describe('token locks as NFTs', () => {
  let id;

  it('create_lock mints the NFT; the metadata names the amount and the gas account', async () => {
    id = await newLock(alice, lockAlice, 123_456_789_000n, 10_000n);
    expect(await ownerOf(id)).toBe(alice.toText());
    const mint = (await lastBlocks(2)).find((b) => btype(b) === '7mint');
    expect(txField(mint, 'tid')).toEqual({ Nat: id });
    expect(txField(mint, 'meta').Map.find(([k]) => k === 'sneedlock:kind')[1]).toEqual({ Text: 'token' });
    await pic.tick(3); // symbol, decimals and fee are fetched on a timer
    const m = Object.fromEntries((await lock.icrc7_token_metadata([id]))[0][0]);
    expect(m['icrc7:name']).toEqual({ Text: '1,234.5678 AAA lock' }); // rounded down: a name never overstates
    expect(m['sneedlock:amount']).toEqual({ Nat: 123_456_789_000n });
    expect(m['sneedlock:gas_owner']).toEqual({ Text: lockId.toText() });
    const g = await gasAccount(id);
    expect(m['sneedlock:gas_subaccount']).toEqual({ Blob: g.subaccount[0] });
    expect(g.subaccount[0][0]).toBe(0xfe); // never a wallet subaccount (byte 0 there is a length <= 29)
    expect(m['sneedlock:transfer_fee']).toEqual({ Nat: FEE });
    expect(decodeURIComponent(m['icrc7:image'].Text)).toContain('1,234.5678 AAA');
    expect(await lock.icrc7_tokens_of(acc(alice), [], [])).toContain(id);
  });

  it('the owner pays the fee from free balance; the lock, its amount and the tokens move', async () => {
    const [a0, b0] = [await bal(wallet(alice)), await bal(wallet(bob))];
    const r = await send(lockAlice, id, acc(bob, sub(4)));
    expect(r).toHaveProperty('Ok');
    expect(await ownerOf(id)).toBe(`${bob.toText()}.4`);
    expect(await bal(wallet(alice))).toBe(a0 - 123_456_789_000n - FEE);
    expect(await bal(wallet(bob))).toBe(b0 + 123_456_789_000n);
    const st = (await lock.get_lock_state(id))[0];
    expect(st.amount).toEqual([123_456_789_000n]); // never shrinks
    expect(st.owner.toText()).toBe(bob.toText());
    expect(st.owner_subaccount).toEqual([sub(4)]);
    const [legacy, xfer] = await lastBlocks(2);
    expect(btype(legacy)).toBe('sneedlock_token_lock_transfer');
    expect(txField(legacy, 'gas_source')).toEqual({ Text: 'owner' });
    expect(btype(xfer)).toBe('7xfer');
    // bob's tokens are locked: he cannot take them out
    expect(errOf(await lockBob.transfer_tokens(bob, [], tokenId, 1n))).toHaveProperty('GenericError');
  });

  it('a move between accounts of one principal changes only the label: no ledger call, no gas', async () => {
    const b0 = await bal(wallet(bob));
    expect(await send(lockBob, id, acc(bob), { from_subaccount: [sub(4)] })).toHaveProperty('Ok');
    expect(await ownerOf(id)).toBe(bob.toText());
    expect(await bal(wallet(bob))).toBe(b0);
    expect(btype((await lastBlocks(1))[0])).toBe('7xfer');
  });

  it('without gas the transfer is refused and nothing moves', async () => {
    // bob has no free balance in his Sneed wallet, and the tank is empty
    const [b0, c0] = [await bal(wallet(bob)), await bal(wallet(carol))];
    const locked = (await lockBob.get_summed_locks()).find(([l]) => l.toText() === tokenId.toText())[1];
    expect(b0).toBe(locked);
    const r = await send(lockBob, id, acc(carol));
    expect(r.Err.GenericError.error_code).toBe(7n);
    expect(r.Err.GenericError.message).toMatch(/needs gas/);
    expect(await ownerOf(id)).toBe(bob.toText());
    expect([await bal(wallet(bob)), await bal(wallet(carol))]).toEqual([b0, c0]);
  });

  it('anyone can fund the gas tank; the tank then pays two fees and the owner nothing', async () => {
    const tank = await gasAccount(id);
    await token.mint(account(carol), 100_000n);
    unwrap(await actorAs(pic, ledgerIdl, tokenId, carol).icrc1_transfer({ from_subaccount: [], to: tank, amount: 5n * FEE, fee: [], memo: [], created_at_time: [] }));
    const [b0, t0] = [await bal(wallet(bob)), await bal(tank)];
    const r = await send(lockBob, id, acc(carol));
    expect(r).toHaveProperty('Ok');
    expect(await ownerOf(id)).toBe(carol.toText());
    expect(await bal(tank)).toBe(t0 - 2n * FEE);
    expect(await bal(wallet(bob))).toBe(b0 - 123_456_789_000n); // bob's free balance is untouched
    const legacy = (await lastBlocks(2))[0];
    expect(txField(legacy, 'gas_source')).toEqual({ Text: 'tank' });
  });

  it('a tank with less than two fees does not pay', async () => {
    const id2 = await newLock(alice, lockAlice, 50_000n, 0n);
    const tank = await gasAccount(id2);
    await token.mint(tank, 2n * FEE - 1n);
    expect((await send(lockAlice, id2, acc(bob))).Err.GenericError.error_code).toBe(7n);
    expect(await bal(tank)).toBe(2n * FEE - 1n);
  });

  it('only the owner takes the gas back, less one fee', async () => {
    const tank = await gasAccount(id);
    const t0 = await bal(tank);
    expect(await lockBob.withdraw_lock_gas(id, account(bob))).toEqual({ Err: "Only the lock's owner can take its gas back" });
    const c0 = await bal(account(carol));
    expect(await lockCarol.withdraw_lock_gas(id, account(carol))).toHaveProperty('Ok');
    expect(await bal(account(carol))).toBe(c0 + t0 - FEE);
    expect(await bal(tank)).toBe(0n);
    expect(btype((await lastBlocks(1))[0])).toBe('sneedlock_gas_withdraw');
  });

  it('transfer_token_lock_ownership uses the tank too when the owner has no free balance', async () => {
    const id3 = await newLock(alice, lockAlice, 70_000n, 0n);
    expect(errOf(await lockAlice.transfer_token_lock_ownership(bob, tokenId, id3)).message).toMatch(/needs gas/);
    await token.mint(await gasAccount(id3), 2n * FEE);
    expect(await lockAlice.transfer_token_lock_ownership(bob, tokenId, id3)).toEqual({ Ok: null });
    expect(await ownerOf(id3)).toBe(bob.toText());
    expect(btype((await lastBlocks(1))[0])).toBe('7xfer'); // the NFT went along
  });

  it('an approved spender pulls a token lock into its own subaccount', async () => {
    const id4 = await newLock(alice, lockAlice, 60_000n, 5n * FEE);
    unwrap((await lockAlice.icrc37_approve_tokens([{ token_id: id4, approval_info: { spender: acc(carol), from_subaccount: [], expires_at: [], memo: [], created_at_time: await nowNs() } }]))[0][0]);
    const r = (await lockCarol.icrc37_transfer_from([{ spender_subaccount: [], from: acc(alice), to: acc(carol, sub(9)), token_id: id4, memo: [], created_at_time: [] }]))[0][0];
    expect(r).toHaveProperty('Ok');
    expect(await ownerOf(id4)).toBe(`${carol.toText()}.9`);
    expect(btype((await lastBlocks(1))[0])).toBe('37xfer');
  });

  it('a dissolving lock transfers; an unlocked one is refused and burned when archived', async () => {
    const HOUR = 3600n * 1_000_000_000n;
    await token.mint(wallet(alice), 40_000n + 5n * FEE);
    const id5 = unwrap(await lockAlice.create_lock(40_000n, tokenId, 0n, [HOUR]));
    expect((await lockAlice.start_dissolving(id5))).toHaveProperty('Ok');
    expect(await send(lockAlice, id5, acc(bob))).toHaveProperty('Ok');
    await pic.advanceTime(2 * 3600 * 1000); await pic.tick();
    expect((await send(lockBob, id5, acc(carol))).Err.GenericError.error_code).toBe(8n);
    expect(await ownerOf(id5)).toBe(bob.toText()); // until archived
    await lockBob.clear_expired_locks();
    expect(await ownerOf(id5)).toBe(null);
    const burn = (await lastBlocks(4)).find((b) => btype(b) === '7burn' && txField(b, 'tid').Nat === id5);
    expect(burn).toBeDefined();
    expect((await lock.icrc7_token_metadata([id5]))[0]).toEqual([]);
    // its gas can still be taken back by its last owner
    expect((await lock.get_lock_gas(id5))[0].ledger.toText()).toBe(tokenId.toText());
  });

  it('lists token locks and LP locks in one collection', async () => {
    const all = await lock.icrc7_tokens([], []);
    expect(all.length).toBeGreaterThan(3);
    expect(BigInt(all.length)).toBe(await lock.icrc7_total_supply());
    expect(await lock.icrc7_balance_of([acc(carol, sub(9))])).toEqual([1n]);
  });
});

describe('activation on upgrade', () => {
  it('mints every live token lock once, not archived ones', async () => {
    const oldId = await install(pic, { name: 'sneed_lock_v2a', cycles: 20n * T, targetSubnetId: appSubnet });
    await pic.tick(2);
    const o = (p) => actorAs(pic, sneedLockIdl, oldId, p);
    const w = (p) => account(oldId, principalToSubaccount(p));
    await token.mint(w(alice), 100_000n);
    const live = unwrap(await o(alice).create_lock(10_000n, tokenId, (await nowNs()) + DAY_NS, []));
    const short = unwrap(await o(alice).create_lock(10_000n, tokenId, (await nowNs()) + 3_600n * 1_000_000_000n, []));
    await pic.advanceTime(2 * 3600 * 1000); await pic.tick();
    await o(alice).clear_expired_locks(); // `short` is archived
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm('sneed_lock'), arg: IDL.encode([], []) });
    await pic.tick(3);
    const up = o(admin);
    expect(await up.icrc7_tokens([], [])).toEqual([live]);
    expect((await up.icrc7_owner_of([live, short])).map(([x]) => x?.owner.toText() ?? null)).toEqual([alice.toText(), null]);
    await pic.upgradeCanister({ sender: admin, canisterId: oldId, wasm: wasm('sneed_lock'), arg: IDL.encode([], []) });
    await pic.tick(3);
    const s = await up.icrc3_log_status();
    const mints = (await up.icrc3_get_blocks([{ start: 0n, length: s.log_length }])).blocks.map((x) => x.block).filter((x) => btype(x) === '7mint');
    expect(mints.map((m) => txField(m, 'tid').Nat)).toEqual([live]);
  });
});
