// Sneed Hub pockets, the pure modules (spec/programmable_accounts.md §3, §4.1, §4.3, §4.6, §4.8,
// §4.10): the subaccount codec (number, hex, text, bytes, principal + index, the vault layout for
// 1-, 10- and 29-byte principals), "numbered never equals classic or vault", null = the zero
// subaccount, the same bytes as the parsers it replaces (pages/ToolsAccount.jsx,
// SneedMonService.parseSubaccountInput, AccountParser.resolveSubaccount), display names, the merge
// of registry, discovery and adapters, totals with hidden pockets, holders, the switcher and the
// next free number. No canister: these are plain functions.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Principal } from '@dfinity/principal';
import { user } from '../lib/pic.js';

const FE = (p) => fileURLToPath(new URL(`../../../src/app_sneeddao_frontend/src/${p}`, import.meta.url));
let S, M, AP, MON, TA;

const me = user('pockets-me');
const P1 = Principal.fromUint8Array(new Uint8Array([0x2a])); // a 1-byte principal (not anonymous)
const P10 = Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai'); // a canister id, 10 bytes
const P29 = user('pockets-29'); // self-authenticating, 29 bytes
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const L1 = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const L2 = 'hvgxa-wqaaa-aaaaq-aacia-cai';

/// The helper block pages/ToolsAccount.jsx had before it moved to the shared codec (module-private;
/// commit d20ab1bf), evaluated as it was, so the codec is checked against the code it replaced.
function toolsAccountHelpers() {
  const src = execFileSync('git', ['show', 'd20ab1bf:src/app_sneeddao_frontend/src/pages/ToolsAccount.jsx'], { cwd: FE('.'), encoding: 'utf8' });
  const start = src.indexOf('// --- Subaccount conversion helpers ---');
  const end = src.indexOf('const INPUT_MODES');
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const body = src.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function('Principal', 'bytesToHex', `${body}\nreturn { numberToSubaccount, textToSubaccount, hexToSubaccount, byteArrayToSubaccount, principalWithIndexToSubaccount, subaccountToPrincipalInfo };`)(Principal, AP.bytesToHex);
}

/// A module as it was at commit d20ab1bf (before it delegated to the codec), written next to the
/// build so its imports resolve.
async function oldModule(path, name) {
  const { writeFileSync } = await import('node:fs');
  const src = execFileSync('git', ['show', `d20ab1bf:src/app_sneeddao_frontend/src/${path}`], { cwd: FE('.'), encoding: 'utf8' });
  const out = fileURLToPath(new URL(`../build/old_${name}.mjs`, import.meta.url));
  writeFileSync(out, src);
  return import(out);
}
let OLD_AP, OLD_MON_PARSE;

beforeAll(async () => {
  OLD_AP = await oldModule('utils/AccountParser.js', 'AccountParser');
  {
    const src = execFileSync('git', ['show', 'd20ab1bf:src/app_sneeddao_frontend/src/utils/SneedMonService.js'], { cwd: FE('.'), encoding: 'utf8' });
    const fn = src.slice(src.indexOf('export function parseSubaccountInput'), src.indexOf('export const subaccountHex')).replace('export function', 'function');
    // eslint-disable-next-line no-new-func
    OLD_MON_PARSE = new Function(`${fn}\nreturn parseSubaccountInput;`)();
  }
  S = await import('../../../src/app_sneeddao_frontend/src/utils/pockets/subaccount.js');
  M = await import('../../../src/app_sneeddao_frontend/src/utils/pockets/model.js');
  AP = await import('../../../src/app_sneeddao_frontend/src/utils/AccountParser.js');
  MON = await import('../../../src/app_sneeddao_frontend/src/utils/SneedMonService.js');
  TA = toolsAccountHelpers();
});

describe('subaccount codec', () => {
  it('numbers round-trip as 32 bytes big-endian; Main is not numbered', () => {
    for (const n of [1n, 2n, 255n, 256n, 65_535n, 4_294_967_295n, (1n << 200n) + 7n]) {
      const b = S.numberToSubaccount(n);
      expect(b.length).toBe(32);
      expect(S.subaccountToNumber(b)).toBe(n);
      expect(S.hexToSubaccount(n.toString(16))).toEqual(b);
    }
    expect(S.numberToSubaccount(3)[31]).toBe(3);
    expect(S.numberToSubaccount('256').slice(30)).toEqual(new Uint8Array([1, 0]));
    expect(S.numberToSubaccount(-1)).toBe(null);
    expect(S.numberToSubaccount(1n << 256n)).toBe(null);
    expect(S.numberToSubaccount('x')).toBe(null);
    expect(S.pocketNumber(S.numberToSubaccount(7))).toBe(7);
    expect(S.pocketNumber(null)).toBe(null);
    expect(S.pocketNumber(new Uint8Array(32))).toBe(null);
    expect(S.pocketNumber(S.numberToSubaccount(1n << 40n))).toBe(null); // exact, not numbered
  });

  it('null, [] and 32 zero bytes are the same (default) account', () => {
    const z = new Uint8Array(32);
    expect(S.isDefault(null)).toBe(true);
    expect(S.isDefault([])).toBe(true);
    expect(S.isDefault([z])).toBe(true);
    expect(S.isDefault(z)).toBe(true);
    expect(S.canonical(z)).toBe(null);
    expect(S.toOpt(z)).toEqual([]);
    expect(S.toOpt(S.numberToSubaccount(1))).toEqual([S.numberToSubaccount(1)]);
    expect(S.sameSubaccount(null, z)).toBe(true);
    expect(S.sameSubaccount([S.numberToSubaccount(1)], Array.from(S.numberToSubaccount(1)))).toBe(true);
    expect(S.sameSubaccount(null, S.numberToSubaccount(1))).toBe(false);
    expect(() => S.toBytes(new Uint8Array(31))).toThrow(/32 bytes/);
    expect(M.accountKey({ owner: me, subaccount: null })).toBe(M.accountKey({ owner: me, subaccount: [z] }));
    expect(M.walletPocketId(z)).toBe('w:0');
  });

  it('text, bytes and hex inputs', () => {
    const t = S.textToSubaccount('my-account');
    expect(new TextDecoder().decode(t.slice(0, 10))).toBe('my-account');
    expect(t.slice(10).every((x) => x === 0)).toBe(true);
    expect(S.textToSubaccount('')).toBe(null);
    expect(S.textToSubaccount('x'.repeat(33))).toBe(null);
    expect(S.byteListToSubaccount('1, 2')[31]).toBe(2);
    expect(S.byteListToSubaccount('1, 2', 'left')[0]).toBe(1);
    expect(S.byteListToSubaccount('256')).toBe(null);
    expect(S.hexToSubaccount('0x0a-0b')[31]).toBe(0x0b);
    expect(S.hexToSubaccount('g')).toBe(null);
    expect(S.hexToSubaccount('f'.repeat(65))).toBe(null);
    expect(S.hexToSubaccount('f'.repeat(65), { overlong: 'truncate' })).toEqual(new Uint8Array(32).fill(255));
  });

  it('the vault layout owned(P, i) for 1-, 10- and 29-byte principals, and parse', () => {
    for (const p of [P1, P10, P29]) {
      const L = p.toUint8Array().length;
      for (const i of [0, 1, 255, 256, 65_535]) {
        const s = S.ownedSubaccount(p, i);
        expect(s[0]).toBe(L);
        expect(s.slice(1, 1 + L)).toEqual(p.toUint8Array());
        expect(s.slice(1 + L, 30).every((x) => x === 0)).toBe(true);
        expect((s[30] << 8) | s[31]).toBe(i);
        const back = S.parseOwnedSubaccount(s);
        expect(back.owner.toText()).toBe(p.toText());
        expect(back.index).toBe(i);
      }
      // index 0 is the classic Sneed derivation
      expect(S.ownedSubaccount(p, 0)).toEqual(S.principalToSubaccount(p));
      expect(S.parseSubaccount({ type: 'vault', value: p.toText(), index: 3 })).toEqual(S.ownedSubaccount(p, 3));
    }
    expect([P1, P10, P29].map((p) => p.toUint8Array().length)).toEqual([1, 10, 29]);
    expect(() => S.ownedSubaccount(Principal.anonymous(), 0)).toThrow(/anonymous/);
    expect(() => S.ownedSubaccount(Principal.fromText('aaaaa-aa'), 0)).toThrow();
    expect(() => S.ownedSubaccount(P10, 65_536)).toThrow(/0\.\.65535/);
    // non-canonical: padding, anonymous, system subaccounts (byte 0 >= 0xF0), wrong size
    const bad = S.ownedSubaccount(P10, 1); bad[20] = 1;
    expect(S.parseOwnedSubaccount(bad)).toBe(null);
    const anon = new Uint8Array(32); anon[0] = 1; anon[1] = 4;
    expect(S.parseOwnedSubaccount(anon)).toBe(null);
    const fee = new Uint8Array(32); fee.set([0xf0, 0x66, 0x65, 0x65]);
    expect(S.parseOwnedSubaccount(fee)).toBe(null);
    expect(S.parseOwnedSubaccount(null)).toBe(null);
    expect(S.parseOwnedSubaccount(new Uint8Array(31))).toBe(null);
  });

  it('principal + index (the byte editor) right-aligns the index, so it equals the vault layout for indices up to 65,535', () => {
    // §4.10 says "only for 29-byte principals"; the editor right-aligns the index in the bytes after
    // the principal, so for any principal and index <= 65,535 the bytes are the vault's
    for (const p of [P1, P10, P29]) for (const i of [0, 5, 65_535]) expect(S.principalWithIndexToSubaccount(p, 'number', String(i))).toEqual(S.ownedSubaccount(p, i));
    // beyond 2 bytes the editor goes on (the vault has no such index)
    expect(S.principalWithIndexToSubaccount(P10, 'number', '65536')[29]).toBe(1);
    expect(S.parseOwnedSubaccount(S.principalWithIndexToSubaccount(P10, 'number', '65536'))).toBe(null);
    expect(S.principalWithIndexToSubaccount(P10, 'number', '')).toEqual(S.principalToSubaccount(P10));
  });

  it('a numbered pocket never equals a classic or vault subaccount (sampled principals)', () => {
    const principals = [P1, P10, P29, ...Array.from({ length: 40 }, (_, i) => user(`sample-${i}`)), ...Array.from({ length: 20 }, (_, i) => Principal.fromUint8Array(new Uint8Array([i, 0, 0, 0, 0, 0x10 + i, 0, 0, 1, 1])))];
    const numbered = new Set([1, 2, 3, 100, 65_535, 65_536, 4_294_967_295].map((n) => hex(S.numberToSubaccount(n))));
    for (const p of principals) {
      for (const i of [0, 1, 2, 3, 100, 65_535]) {
        const s = S.ownedSubaccount(p, i);
        expect(s[0]).toBeGreaterThan(0);
        expect(numbered.has(hex(s))).toBe(false);
      }
      expect(numbered.has(hex(S.principalToSubaccount(p)))).toBe(false);
    }
    for (const n of [1n, 1n << 100n, (1n << 248n) - 1n]) expect(S.numberToSubaccount(n)[0]).toBe(0);
  });

  it('ICRC-1 text: numbered #3 ends in ".3"; the ICP account identifier', () => {
    const t = S.encodeAccount({ owner: me, subaccount: S.numberToSubaccount(3) });
    expect(t.startsWith(`${me.toText()}-`)).toBe(true);
    expect(t.endsWith('.3')).toBe(true);
    const back = S.decodeAccount(t);
    expect(back.owner.toText()).toBe(me.toText());
    expect(S.pocketNumber(back.subaccount)).toBe(3);
    expect(S.encodeAccount({ owner: me, subaccount: new Uint8Array(32) })).toBe(me.toText());
    expect(S.decodeAccount(me.toText()).subaccount).toBe(null);
    // the well-known account id of the NNS governance canister's default account
    expect(S.accountIdentifierHex({ owner: Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai'), subaccount: null })).toMatch(/^[0-9a-f]{64}$/);
    expect(S.accountIdentifierHex({ owner: me, subaccount: null })).toBe(S.accountIdentifierHex({ owner: me, subaccount: new Uint8Array(32) }));
    expect(S.accountIdentifierHex({ owner: me, subaccount: S.numberToSubaccount(1) })).not.toBe(S.accountIdentifierHex({ owner: me, subaccount: null }));
  });
});

describe('the codec gives the same bytes as the copies it replaces', () => {
  const samplesNumber = ['0', '1', '3', '255', '256', '65535', '123456789012345678901234567890', '-1', 'abc', ''];
  const samplesHex = ['0x01', 'a1b2c3', 'ff-ff ff', '0'.repeat(64), 'f'.repeat(64), 'f'.repeat(65), 'xyz', '0x'];
  const samplesText = ['my-account', 'a', 'é', 'x'.repeat(32), 'x'.repeat(33)];
  const samplesBytes = ['0, 0, 0, 1', '1,2,3', '255', '256', '', 'a', Array.from({ length: 33 }, () => '1').join(',')];

  it('pages/ToolsAccount.jsx helpers', () => {
    for (const s of samplesNumber) expect(S.numberToSubaccount(s) ?? null, s).toEqual(s === '' ? TA.numberToSubaccount(s) ?? null : TA.numberToSubaccount(s));
    for (const s of samplesHex) expect(S.hexToSubaccount(s), s).toEqual(TA.hexToSubaccount(s));
    for (const s of samplesText) expect(S.textToSubaccount(s), s).toEqual(TA.textToSubaccount(s));
    for (const s of samplesBytes) for (const al of ['left', 'right']) expect(S.byteListToSubaccount(s, al), `${s} ${al}`).toEqual(TA.byteArrayToSubaccount(s, al));
    for (const p of [P1, P10, P29]) {
      for (const [f, v] of [['number', '5'], ['number', '70000'], ['hex', 'ff01'], ['bytes', '1, 2'], ['number', ''], ['hex', 'zz'], ['number', String(1n << 200n)]]) {
        expect(S.principalWithIndexToSubaccount(p.toText(), f, v), `${p.toText()} ${f} ${v}`).toEqual(TA.principalWithIndexToSubaccount(p.toText(), f, v));
      }
      for (const i of [0, 7]) expect(S.principalInfo(S.ownedSubaccount(p, i))).toEqual(TA.subaccountToPrincipalInfo(S.ownedSubaccount(p, i)));
    }
    expect(S.principalWithIndexToSubaccount('not a principal', 'number', '1')).toBe(TA.principalWithIndexToSubaccount('not a principal', 'number', '1'));
    expect(S.principalInfo(S.numberToSubaccount(9))).toEqual(TA.subaccountToPrincipalInfo(S.numberToSubaccount(9)));
  });

  it('SneedMonService.parseSubaccountInput (as it was, and as it now delegates)', () => {
    for (const s of ['', '  ', '0', '1', '42', '0x2a', '0x', '-', '2a', 'ff'.repeat(32), '1'.repeat(63), '1'.repeat(64)]) {
      expect(S.parseSubaccountInput(s), s).toEqual(OLD_MON_PARSE(s));
      expect(MON.parseSubaccountInput(s), s).toEqual(OLD_MON_PARSE(s));
    }
    for (const s of ['xyz', 'f'.repeat(65)]) {
      expect(() => OLD_MON_PARSE(s)).toThrow();
      expect(() => MON.parseSubaccountInput(s)).toThrow();
      expect(() => S.parseSubaccountInput(s)).toThrow();
    }
    expect(MON.subaccountHex(S.numberToSubaccount(1))).toBe('0'.repeat(63) + '1');
  });

  it('AccountParser as it was and as it now delegates: the same bytes', () => {
    const hexes = ['0x01', 'a1b2c3', 'f'.repeat(66), 'zz', '0x', '  ', '0X12', '12-34 56'];
    const lists = ['1, 2, 3', '255', '300', '', ' ', '1,,2', Array.from({ length: 33 }, () => '1').join(',')];
    for (const v of hexes) {
      expect(AP.hexToBytes(v), v).toEqual(OLD_AP.hexToBytes(v));
      expect(AP.resolveSubaccount({ type: 'hex', value: v }), v).toEqual(OLD_AP.resolveSubaccount({ type: 'hex', value: v }));
    }
    for (const v of lists) {
      expect(AP.parseByteString(v), v).toEqual(OLD_AP.parseByteString(v));
      expect(AP.resolveSubaccount({ type: 'bytes', value: v }), v).toEqual(OLD_AP.resolveSubaccount({ type: 'bytes', value: v }));
    }
    for (const v of [P1.toText(), P10.toText(), P29.toText(), 'nope']) {
      expect(AP.resolveSubaccount({ type: 'principal', value: v }), v).toEqual(OLD_AP.resolveSubaccount({ type: 'principal', value: v }));
    }
    expect(AP.hexToBytes(null)).toBe(OLD_AP.hexToBytes(null));
  });

  it('AccountParser.resolveSubaccount (its hex truncates, its bytes are left-aligned)', () => {
    for (const v of ['0x01', 'a1b2c3', 'f'.repeat(66), 'zz']) {
      expect(S.hexToSubaccount(v, { overlong: 'truncate' }), v).toEqual(AP.resolveSubaccount({ type: 'hex', value: v })?.resolved ?? null);
    }
    for (const v of ['1, 2, 3', '255', '300']) {
      expect(S.byteListToSubaccount(v, 'left'), v).toEqual(AP.resolveSubaccount({ type: 'bytes', value: v })?.resolved ?? null);
    }
    for (const p of [P10, P29]) {
      expect(S.principalToSubaccount(p.toText())).toEqual(AP.resolveSubaccount({ type: 'principal', value: p.toText() }).resolved);
    }
  });
});

// ---- the model ----

const sub = (n) => S.numberToSubaccount(n);
const lockAdapter = { id: 'sneed_lock', name: 'Sneed Lock', kind: 'hosted', receivesDirectly: true, withdraw() {}, deposit() {} };
const monAdapter = { id: 'sneed_mon', name: 'Sneed Monitor', kind: 'service', deposit() {}, withdraw() {} };
const swapAdapter = { id: 'icpswap', name: 'ICPSwap', kind: 'hosted', withdrawTo: 'main', withdraw() {} };
const LOCK = user('pockets-lock-canister');

describe('pockets model', () => {
  it('display names (§4.6)', () => {
    const main = M.walletPocket(me);
    expect(M.displayName(main)).toBe('Main');
    expect(M.displayName({ ...M.walletPocket(me, sub(7)) })).toBe('#7');
    expect(M.displayName({ ...M.walletPocket(me, sub(3)), nickname: 'Savings' })).toBe('Savings · #3');
    const exact = S.hexToSubaccount('0a1b'.padEnd(64, '0'));
    expect(M.displayName({ ...M.walletPocket(me, exact), nickname: 'Savings' })).toBe('Savings · #a1b0…');
    const lock = M.adapterPocket(lockAdapter, { hostKey: 'me', account: { owner: LOCK, subaccount: S.principalToSubaccount(me) }, label: 'Sneed Lock wallet' });
    expect(M.displayName(lock)).toBe('Sneed Lock wallet');
    expect(M.displayName({ ...lock, nickname: 'Bots' })).toBe('Bots · Sneed Lock');
    expect(M.badge(lock)).toBe('Sneed Lock');
    expect(M.badge(M.adapterPocket(monAdapter, { hostKey: 'me' }))).toBe('Service balance');
    expect(lock.caps).toMatchObject({ receive: true, deposit: true, withdraw: true, readOnly: false });
    expect(M.adapterPocket({ id: 'taco', name: 'TACO', kind: 'hosted' }, { hostKey: 'x' }).caps).toMatchObject({ withdraw: false, readOnly: true });
    expect(M.adapterPocket(swapAdapter, { hostKey: 'p' }).caps.withdrawTo).toBe('main');
  });

  it('merges registry, discovery and adapters, deduplicated by account', () => {
    const lockAccount = { owner: LOCK, subaccount: S.principalToSubaccount(me) };
    const registry = [
      { account: { owner: me, subaccount: sub(3) }, nickname: 'Savings', pocket: { host: [], ledgers: [], hidden: false, created_at: 1n } },
      { account: { owner: me, subaccount: sub(5) }, nickname: '', pocket: { host: null, ledgers: [L2], hidden: true, created_at: 1n } },
      { account: { owner: me, subaccount: null }, nickname: 'Daily', pocket: null }, // a name for Main
      { account: lockAccount, nickname: 'Bots', pocket: { host: 'sneed_lock', ledgers: [L1], hidden: false, created_at: 1n } },
      { account: { owner: user('friend'), subaccount: null }, nickname: 'Friend', pocket: null }, // just a name, not a pocket
      { account: { owner: LOCK, subaccount: sub(99) }, nickname: '', pocket: { host: 'sneedex', ledgers: [], hidden: false, created_at: 1n } }, // remembered, host down
    ].map((e) => ({ ...e, pocket: e.pocket && { ...e.pocket, host: Array.isArray(e.pocket.host) ? e.pocket.host[0] ?? null : e.pocket.host } }));
    const discovered = [{ subaccount: sub(3), ledger: L1, balance: 500n }, { subaccount: sub(4), ledger: L1, balance: 0n }, { subaccount: [new Uint8Array(32)], ledger: L1, balance: 1_000n }];
    const hosted = [
      { adapter: lockAdapter, items: [{ hostKey: 'me', account: lockAccount, label: 'Sneed Lock wallet', ledgers: [L1] }] },
      { adapter: monAdapter, items: [{ hostKey: 'me', label: 'Sneed Monitor balance', ledgers: [L1] }] },
      { adapter: { id: 'sneedex', name: 'Sneedex', kind: 'hosted' }, error: new Error('timeout') },
    ];
    const balances = new Map([['h:sneed_lock:me', new Map([[L1, { total: 300n, available: 100n, locked: 200n }]])]]);
    const ps = M.mergePockets({ me, registry, discovered, hosted, balances });
    const ids = ps.map((p) => p.id);
    expect(ids[0]).toBe('w:0');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([M.walletPocketId(sub(3)), M.walletPocketId(sub(4)), M.walletPocketId(sub(5)), 'h:sneed_lock:me', 's:sneed_mon:me', 'h:sneedex:*']));
    expect(ps.filter((p) => p.id === 'w:0')).toHaveLength(1); // [zero bytes] discovered = Main
    const byId = Object.fromEntries(ps.map((p) => [p.id, p]));
    expect(M.displayName(byId['w:0'])).toBe('Daily · Main');
    expect(M.displayName(byId[M.walletPocketId(sub(3))])).toBe('Savings · #3');
    expect(byId[M.walletPocketId(sub(5))].hidden).toBe(true);
    expect(M.displayName(byId['h:sneed_lock:me'])).toBe('Bots · Sneed Lock');
    expect(byId['h:sneed_lock:me'].balances.get(L1)).toEqual({ total: 300n, available: 100n, locked: 200n });
    expect(byId['h:sneedex:*'].status).toBe('error');
    expect(byId['h:sneedex:*'].error).toMatch(/timeout/);
    const remembered = ps.find((p) => p.adapterId === 'sneedex' && p.account);
    expect(remembered.status).toBe('error'); // its host failed: shown, marked
    expect(ps.some((p) => p.account && p.account.owner.toText() === user('friend').toText())).toBe(false);
    expect(byId['w:0'].balances.get(L1).total).toBe(1_000n);
  });

  it('a hosted pocket never shadows a wallet pocket with the same account', () => {
    const ps = M.mergePockets({ me, discovered: [{ subaccount: sub(1) }], hosted: [{ adapter: lockAdapter, items: [{ hostKey: 'x', account: { owner: me, subaccount: sub(1) } }] }] });
    expect(ps.map((p) => p.id)).toEqual(['w:0', M.walletPocketId(sub(1))]);
  });

  it('totals count hidden pockets; holders and the disclosure only visible ones', () => {
    let ps = M.mergePockets({ me, registry: [{ account: { owner: me, subaccount: sub(2) }, nickname: '', pocket: { host: null, ledgers: [], hidden: true, created_at: 1n } }], discovered: [{ subaccount: sub(1) }, { subaccount: sub(2) }] });
    ps = ps.map((p) => (p.id === 'w:0' ? M.withBalance(p, L1, 100n) : p.number === 1 ? M.withBalance(p, L1, 50n) : p.number === 2 ? M.withBalance(p, L1, 7n) : p));
    expect(M.total(ps, L1)).toBe(157n);
    expect(M.total(ps, L2)).toBe(0n);
    expect(M.holders(ps, L1).map((p) => p.number)).toEqual([null, 1]);
    expect(M.holders(ps, L1, { includeHidden: true })).toHaveLength(3);
    expect(M.showDisclosure(ps, L1)).toBe(true);
    const single = ps.map((p) => (p.number === 1 ? M.withBalance(p, L1, 0n) : p));
    expect(M.showDisclosure(single, L1)).toBe(false); // the hidden #2 doesn't count: one visible holder
    expect(M.total(single, L1)).toBe(107n);
  });

  it('lists: Main always, named even empty, unnamed only with a balance, hidden never', () => {
    let ps = M.mergePockets({
      me,
      registry: [{ account: { owner: me, subaccount: sub(4) }, nickname: 'Rent', pocket: { host: null, ledgers: [], hidden: false, created_at: 1n } }],
      discovered: [{ subaccount: sub(1), ledger: L1, balance: 0n }, { subaccount: sub(2), ledger: L1, balance: 3n }],
      hosted: [{ adapter: monAdapter, items: [{ hostKey: 'me' }] }],
    });
    const names = (xs) => M.sortPockets(xs).map((p) => M.displayName(p));
    expect(names(M.listed(ps))).toEqual(['Main', '#2', 'Rent · #4', 'Sneed Monitor']);
    expect(names(M.listed(ps, L2))).toEqual(['Main', 'Rent · #4', 'Sneed Monitor']);
    ps = ps.map((p) => (p.number === 2 ? { ...p, hidden: true } : p));
    expect(names(M.listed(ps))).toEqual(['Main', 'Rent · #4', 'Sneed Monitor']);
    expect(M.sortPockets([...ps].reverse()).map((p) => p.id)[0]).toBe('w:0');
  });

  it('the switcher: one pocket\'s balances, tokens it doesn\'t hold hidden (toggle); falls back to All', () => {
    let ps = M.mergePockets({ me, discovered: [{ subaccount: sub(1) }] });
    ps = ps.map((p) => (p.id === 'w:0' ? M.withBalance(M.withBalance(p, L1, 10n), L2, 20n) : M.withBalance(p, L1, 5n)));
    const one = M.walletPocketId(sub(1));
    expect(M.tokensForSelection(ps, [L1, L2], M.ALL)).toEqual([{ ledger: L1, balance: 15n }, { ledger: L2, balance: 20n }]);
    expect(M.tokensForSelection(ps, [L1, L2], one)).toEqual([{ ledger: L1, balance: 5n }]);
    expect(M.tokensForSelection(ps, [L1, L2], one, { hideEmpty: false })).toEqual([{ ledger: L1, balance: 5n }, { ledger: L2, balance: 0n }]);
    expect(M.validSelection(ps, one)).toBe(one);
    expect(M.validSelection(ps, 'w:gone')).toBe(M.ALL);
    expect(M.validSelection(ps.map((p) => ({ ...p, hidden: p.id === one })), one)).toBe(M.ALL);
    expect(M.pickable(ps, L2, 'from').map((p) => p.id)).toEqual(['w:0']);
    expect(M.pickable(ps, L2, 'to').map((p) => p.id)).toEqual(['w:0', one]);
  });

  it('the next free number skips numbers in use, from any source', () => {
    expect(M.nextFreeNumber([])).toBe(1);
    const ps = M.mergePockets({ me, discovered: [1, 2, 4].map((n) => ({ subaccount: sub(n) })) });
    expect(M.nextFreeNumber(ps)).toBe(3);
    expect(M.nextFreeNumber([1, 2, 3])).toBe(4);
    expect(M.nextFreeNumber(new Set([2]))).toBe(1);
    // exact (non-numbered) pockets don't take numbers
    const exact = M.mergePockets({ me, discovered: [{ subaccount: S.principalToSubaccount(P10) }] });
    expect(M.nextFreeNumber(exact)).toBe(1);
    expect(M.isPrincipalShaped(S.principalToSubaccount(P10))).toBe(true);
    expect(M.isPrincipalShaped(sub(1))).toBe(false);
  });
});

describe('pockets in the wallet (step d)', () => {
  let SP, MV;
  beforeAll(async () => {
    SP = await import('../../../src/app_sneeddao_frontend/src/utils/sendPlan.js');
    MV = await import('../../../src/app_sneeddao_frontend/src/utils/pockets/move.js');
  });
  const lockItemOf = () => ({ hostKey: 'wallet', account: { owner: LOCK, subaccount: S.principalToSubaccount(me) }, label: 'Sneed Lock wallet' });
  const base = () => M.mergePockets({ me, discovered: [{ subaccount: sub(1) }], hosted: [{ adapter: lockAdapter, items: [lockItemOf()] }, { adapter: monAdapter, items: [{ hostKey: 'balance' }] }] });

  it('Main and the Sneed Lock wallet come from the wallet\'s token list; other pockets add to the card total', () => {
    let ps = M.withWalletTokens(base(), [{ ledger: L1, balance: 100n, balance_backend: 50n, locked: 20n }, { ledger: L2, balance: 7n }]);
    const byId = Object.fromEntries(ps.map((p) => [p.id, p]));
    expect(byId['w:0'].balances.get(L1)).toEqual({ total: 100n, available: 100n });
    expect(byId['w:0'].balances.get(L2).total).toBe(7n);
    expect(byId[M.LOCK_POCKET_ID].balances.get(L1)).toEqual({ total: 50n, available: 30n, locked: 20n });
    expect(byId[M.LOCK_POCKET_ID].balances.has(L2)).toBe(false); // no balance_backend: not read
    expect(M.otherPocketsTotal(ps, L1)).toBe(0n);
    ps = ps.map((p) => (p.number === 1 ? M.withBalance(p, L1, 5n) : p.id === 's:sneed_mon:balance' ? M.withBalance(p, L1, 3n) : p));
    expect(M.otherPocketsTotal(ps, L1)).toBe(8n);
    expect(M.total(ps, L1)).toBe(100n + 50n + 8n);
    // hidden pockets still count in totals
    expect(M.otherPocketsTotal(ps.map((p) => (p.number === 1 ? { ...p, hidden: true } : p)), L1)).toBe(8n);
  });

  it('casual and pro: nothing new until a pocket besides Main and Sneed Lock is listed', () => {
    const casual = M.withWalletTokens(M.mergePockets({ me, hosted: [{ adapter: lockAdapter, items: [lockItemOf()] }] }), [{ ledger: L1, balance: 1n, balance_backend: 9n, locked: 0n }]);
    expect(M.hasExtraPockets(casual)).toBe(false);
    expect(M.hasExtraPockets(base())).toBe(true); // the Sneed Monitor service balance is listed
    const emptyNumbered = M.mergePockets({ me, discovered: [{ subaccount: sub(4) }] });
    expect(M.hasExtraPockets(emptyNumbered)).toBe(false); // empty and unnamed: out of sight
    expect(M.receiveAccount(M.walletPocket(me, sub(2))).subaccount).toEqual(sub(2));
    expect(M.receiveAccount(M.adapterPocket(monAdapter, { hostKey: 'b' }))).toBe(null);
  });

  it('sendPlan reads Main and Sneed Lock through the model, and plans a one-pocket send', () => {
    const token = { fee: 10n, balance: 1n, balance_backend: 0n, locked: 0n, decimals: 8 };
    const ps = M.withWalletTokens(base(), [{ ledger: L1, balance: 100n, balance_backend: 50n, locked: 20n }]);
    const t = SP.tokenWithPockets(token, ps, L1);
    expect([t.balance, t.balance_backend, t.locked]).toEqual([100n, 50n, 20n]);
    expect(SP.maxSendable(t)).toBe(90n + 20n); // (100 - fee) + (50 - 20 - fee)
    expect(SP.tokenWithPockets(token, ps, L2)).toBe(token); // the model doesn't know L2: the token's own fields
    expect(SP.tokenWithPockets(token, [], L1)).toBe(token);
    expect(SP.planFromPocket(40n, 40n)).toEqual({ amount: 40n, fees: 1 });
    expect(SP.planFromPocket(40n, 41n)).toBe(null);
    expect(SP.planFromPocket(40n, 0n)).toBe(null);
  });

  it('plans every kind of transfer with its steps and fees', () => {
    const ps = base();
    const byId = Object.fromEntries(ps.map((p) => [p.id, p]));
    const main = byId['w:0']; const one = byId[M.walletPocketId(sub(1))]; const lock = byId[M.LOCK_POCKET_ID]; const mon = byId['s:sneed_mon:balance'];
    const dexPay = M.adapterPocket({ id: 'sneedex', name: 'Sneedex', kind: 'hosted', withdrawTo: 'main', withdraw() {}, deposit() {} }, { hostKey: 'payment', account: { owner: LOCK, subaccount: sub(9) } });
    const kinds = (pl) => pl.steps.map((s) => s.kind + (s.toMain ? '>main' : ''));
    const someone = { owner: user('someone'), subaccount: null };
    expect(kinds(MV.planTransfer(one, someone, { me }))).toEqual(['send']);
    expect(kinds(MV.planTransfer(one, main, { me }))).toEqual(['send']);
    expect(kinds(MV.planTransfer(one, lock, { me }))).toEqual(['deposit']);
    expect(kinds(MV.planTransfer(lock, someone, { me }))).toEqual(['withdraw']);
    expect(kinds(MV.planTransfer(lock, one, { me }))).toEqual(['withdraw']);
    expect(kinds(MV.planTransfer(lock, mon, { me }))).toEqual(['withdraw>main', 'deposit']);
    expect(MV.planTransfer(lock, mon, { me }).fees).toBe(2);
    expect(kinds(MV.planTransfer(dexPay, main, { me }))).toEqual(['withdraw']); // pays Main: one step
    expect(kinds(MV.planTransfer(dexPay, one, { me }))).toEqual(['withdraw>main', 'send']);
    expect(kinds(MV.planTransfer(dexPay, someone, { me }))).toEqual(['withdraw>main', 'send']);
    expect(MV.canSendAnywhere(one)).toBe(true);
    expect(MV.canSendAnywhere(lock)).toBe(true);
    expect(MV.canSendAnywhere(dexPay)).toBe(false);
    // what can't be done, in words
    expect(MV.transferProblem(one, one, { me })).toMatch(/same pocket/);
    expect(MV.transferProblem(one, { owner: me, subaccount: sub(1) }, { me })).toMatch(/same account/);
    expect(MV.transferProblem(M.adapterPocket({ id: 'taco', name: 'TACO', kind: 'hosted' }, { hostKey: 'x' }), main, { me })).toMatch(/does not let tokens out/);
    const notif = M.adapterPocket({ id: 'sneed_notifications', name: 'Sneed Notifications', kind: 'service', deposit() {} }, { hostKey: 'balance' });
    expect(MV.transferProblem(one, notif, { me })).toMatch(/from Main only/);
    expect(MV.transferProblem(main, notif, { me })).toBe(null);
    const swap = M.adapterPocket(swapAdapter, { hostKey: 'p' });
    expect(MV.transferProblem(main, swap, { me })).toMatch(/can't be topped up/);
    expect(MV.transferProblem(null, main, { me })).toMatch(/Pick a pocket/);
  });
});

describe('quiet hosts: Sneedex escrows stay out of sight unless something can be withdrawn', () => {
  const dex = { id: 'sneedex', name: 'Sneedex', kind: 'hosted', quiet: true, withdrawTo: 'main', withdraw() {}, deposit() {} };
  const bidItem = (n) => ({ hostKey: `bid:${n}`, account: { owner: LOCK, subaccount: sub(100 + n) }, label: `Sneedex bid ${n}`, ledgers: [L1] });
  const make = (balances) => M.mergePockets({ me, hosted: [{ adapter: dex, items: [bidItem(1), bidItem(2)] }], balances });

  it('a bid escrow with nothing withdrawable is hidden, counts nothing, and lists nowhere', () => {
    const balances = new Map([
      ['h:sneedex:bid:1', new Map([[L1, { total: 2_000n, available: 0n }]])], // an active bid
      ['h:sneedex:bid:2', new Map([[L1, { total: 900n, available: 890n }]])], // lost bid: excess back
    ]);
    const raw = make(balances);
    expect(raw.find((p) => p.id === 'h:sneedex:bid:1').caps.quiet).toBe(true);
    const ps = M.applyQuiet(raw);
    const one = ps.find((p) => p.id === 'h:sneedex:bid:1');
    const two = ps.find((p) => p.id === 'h:sneedex:bid:2');
    expect([one.hidden, one.quietHidden]).toEqual([true, true]);
    expect(two.hidden).toBe(false);
    expect(M.holders(ps, L1).map((p) => p.id)).toEqual(['h:sneedex:bid:2']);
    expect(M.listed(ps).map((p) => p.id)).toEqual(['w:0', 'h:sneedex:bid:2']);
    expect(M.pickable(ps, L1, 'from').map((p) => p.id)).toEqual(['h:sneedex:bid:2']);
    // the card total counts what can leave (890), never the 2,000 committed to the active bid
    expect(M.otherPocketsTotal(ps, L1)).toBe(890n);
    expect(M.total(ps, L1)).toBe(890n);
    expect(M.hasExtraPockets(M.applyQuiet(make(new Map([['h:sneedex:bid:1', new Map([[L1, { total: 2_000n, available: 0n }]])]]))))).toBe(false);
  });

  it('"Show Sneedex escrows" brings them back; a name keeps one shown; the user\'s own hide survives', () => {
    const balances = new Map([['h:sneedex:bid:1', new Map([[L1, { total: 2_000n, available: 0n }]])]]);
    const shown = M.applyQuiet(make(balances), { showQuiet: true });
    expect(shown.find((p) => p.id === 'h:sneedex:bid:1').hidden).toBe(false);
    const named = M.applyQuiet(make(balances).map((p) => (p.id === 'h:sneedex:bid:1' ? { ...p, nickname: 'Big bid' } : p)));
    expect(named.find((p) => p.id === 'h:sneedex:bid:1').hidden).toBe(false);
    // quiet-hidden, then toggled on: back to the user's own hidden flag
    const userHidden = make(balances).map((p) => (p.id === 'h:sneedex:bid:1' ? { ...p, hidden: true } : p));
    const q = M.applyQuiet(userHidden);
    expect(M.applyQuiet(q, { showQuiet: true }).find((p) => p.id === 'h:sneedex:bid:1').hidden).toBe(true);
    expect(M.applyQuiet(M.applyQuiet(make(balances)), { showQuiet: true }).find((p) => p.id === 'h:sneedex:bid:1').hidden).toBe(false);
    // other hosts are not quiet
    expect(M.isQuiet(M.adapterPocket(lockAdapter, { hostKey: 'w' }))).toBe(false);
  });
});

describe('GLDT / sGLDT wrap actions with pockets, and ledger ids that lost their Principal', () => {
  let W, ID;
  const GLDT = '6c7su-kiaaa-aaaar-qaira-cai';
  const SGLDT = 'i2s4q-syaaa-aaaan-qz4sq-cai';
  beforeAll(async () => {
    W = await import('../../../src/app_sneeddao_frontend/src/utils/wrapActions.js');
    ID = await import('../../../src/app_sneeddao_frontend/src/utils/IdUtils.js');
  });

  it('a GLDT / sGLDT card with a Main balance keeps its Wrap / Unwrap button', () => {
    const g = W.wrapAction({ ledger_canister_id: Principal.fromText(GLDT), balance: 5n, available_backend: 0n });
    expect(g).toMatchObject({ kind: 'wrap', fromMain: 5n, needsMove: false, note: null });
    const s = W.wrapAction({ ledger_canister_id: SGLDT, balance: 9n });
    expect(s).toMatchObject({ kind: 'unwrap', needsMove: false });
    // the ledger id as the wallet cache used to bring it back ({ __principal__ }): still recognised
    expect(W.wrapAction({ ledger_canister_id: { __principal__: SGLDT }, balance: 9n }).kind).toBe('unwrap');
    expect(W.wrapAction({ ledger_canister_id: L1, balance: 9n })).toBe(null);
    expect(W.wrapAction({ ledger_canister_id: GLDT, balance: 0n })).toBe(null); // nothing anywhere
  });

  it('only in another pocket: "Move to Main to wrap" from the pocket that holds it', () => {
    const ps = M.mergePockets({ me, discovered: [{ subaccount: sub(3), ledger: SGLDT, balance: 70n }] });
    const a = W.wrapAction({ ledger_canister_id: SGLDT, balance: 0n }, { pockets: ps });
    expect(a).toMatchObject({ kind: 'unwrap', needsMove: true, elsewhere: 70n });
    expect(a.source.id).toBe(M.walletPocketId(sub(3)));
    expect(a.note).toMatch(/from Main/);
    // Main and a pocket: wraps Main's, says the rest stays
    expect(W.wrapAction({ ledger_canister_id: SGLDT, balance: 4n }, { pockets: ps }).note).toMatch(/other pockets stays/);
    // only in the Sneed Lock wallet (free part), no pockets model: move from Sneed Lock
    const l = W.wrapAction({ ledger_canister_id: GLDT, balance: 0n, available_backend: 30n });
    expect(l).toMatchObject({ needsMove: true, source: { id: M.LOCK_POCKET_ID } });
  });

  it('normalizeId reads Principals, { __principal__ }, { _arr } and raw bytes (never "[object Object]")', () => {
    const p = Principal.fromText(GLDT);
    expect(ID.normalizeId(p)).toBe(GLDT);
    expect(ID.normalizeId({ __principal__: GLDT })).toBe(GLDT);
    expect(ID.normalizeId({ _arr: p.toUint8Array() })).toBe(GLDT);
    expect(ID.normalizeId({ _arr: { ...Array.from(p.toUint8Array()) } })).toBe(GLDT); // a cached Uint8Array as an object
    expect(ID.normalizeId(p.toUint8Array())).toBe(GLDT);
    expect(ID.normalizeId(JSON.parse(JSON.stringify({ id: p })).id)).toBe(GLDT); // what JSON makes of a Principal
  });
});

describe('dust: hosted balances at or below the ledger fee stay out of sight', () => {
  it('drops them from unnamed hosted pockets only (not Main, numbered pockets, Sneed Lock or services)', () => {
    const swap = { id: 'icpswap', name: 'ICPSwap', kind: 'hosted', withdrawTo: 'main', withdraw() {} };
    let ps = M.mergePockets({ me, discovered: [{ subaccount: sub(1) }], hosted: [
      { adapter: swap, items: [{ hostKey: 'p1', ledgers: [L1, L2] }, { hostKey: 'p2', ledgers: [L1] }] },
      { adapter: lockAdapter, items: [{ hostKey: 'wallet', account: { owner: LOCK, subaccount: sub(50) } }] },
      { adapter: monAdapter, items: [{ hostKey: 'balance' }] },
    ] });
    ps = ps.map((p) => (p.hostKey === 'p1' ? M.withBalance(M.withBalance(p, L1, 311n), L2, 5_000n)
      : p.hostKey === 'p2' ? M.withBalance(p, L1, 1_000n)
        : p.number === 1 || p.id === M.LOCK_POCKET_ID || p.kind === 'service' ? M.withBalance(p, L1, 5n) : p));
    const fee = (l) => (l === L1 ? 1_000n : l === L2 ? 10n : null);
    const out = M.dropDust(ps, fee);
    const byId = Object.fromEntries(out.map((p) => [p.id, p]));
    expect([...byId['h:icpswap:p1'].balances.keys()]).toEqual([L2]); // 311 ≤ fee dropped, 5,000 kept
    expect(byId['h:icpswap:p2'].balances.size).toBe(0); // exactly the fee: can't be withdrawn either
    expect(M.holders(out, L1).map((p) => p.id)).not.toContain('h:icpswap:p2');
    expect(byId[M.walletPocketId(sub(1))].balances.get(L1).total).toBe(5n);
    expect(byId[M.LOCK_POCKET_ID].balances.get(L1).total).toBe(5n);
    expect(byId['s:sneed_mon:balance'].balances.get(L1).total).toBe(5n);
    // a named one keeps its dust; unknown fees keep everything
    const named = M.dropDust(ps.map((p) => (p.hostKey === 'p2' ? { ...p, nickname: 'Pool' } : p)), fee);
    expect(named.find((p) => p.hostKey === 'p2').balances.get(L1).total).toBe(1_000n);
    expect(M.dropDust(ps, () => null).find((p) => p.hostKey === 'p1').balances.size).toBe(2);
  });
});

describe('removing a pocket', () => {
  it('only remembered or named wallet pockets other than Main; empty ones remove, others empty first', () => {
    const ps = M.mergePockets({ me,
      registry: [{ account: { owner: me, subaccount: sub(5) }, nickname: 'Old', pocket: { host: null, ledgers: [], hidden: false } }],
      discovered: [{ subaccount: sub(6), ledger: L1, balance: 3n }],
      hosted: [{ adapter: lockAdapter, items: [{ hostKey: 'wallet', account: { owner: LOCK, subaccount: sub(50) } }] }] });
    const byNum = (n) => ps.find((p) => p.number === n);
    expect(M.canRemove(byNum(5))).toBe(true);
    expect(M.isEmpty(byNum(5))).toBe(true);
    expect(M.canRemove(byNum(6))).toBe(false); // found by discovery only: nothing to remove (it is not remembered)
    expect(M.isEmpty(byNum(6))).toBe(false);
    expect(M.canRemove(ps.find((p) => p.id === M.MAIN_ID))).toBe(false);
    expect(M.canRemove(ps.find((p) => p.id === M.LOCK_POCKET_ID))).toBe(false);
  });
});
