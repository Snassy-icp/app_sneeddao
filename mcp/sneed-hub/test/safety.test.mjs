// The write safety layer: tokens, expiry, binding, caps, the transfer switch, the audit log, and the
// write protocol (handleWrite) with a fake tool and a fake signer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WriteGuard, TOKEN_TTL_MS, hashOf, parseUnits } from '../src/safety.js';
import { handleWrite, setGuard, setContextFactory, getGuard as getGuardForTest } from '../src/writes.js';

const ICP = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const SNEED = 'hvgxa-wqaaa-aaaaq-aacia-cai';
const OTHER = 'mxzaz-hqaaa-aaaar-qaada-cai';
const dir = () => mkdtempSync(join(tmpdir(), 'sneed-mcp-test-'));
const icpSpend = (amount, extra = {}) => ({ ledger: ICP, symbol: 'ICP', decimals: 8, amount: BigInt(amount), what: 'test', ...extra });
const plan = (spends = [], calls = [{ canister: 'aaaaa-aa', method: 'm', args: [1] }]) => ({ principal: 'me', calls, spends });

const clock = () => { let t = Date.UTC(2026, 9, 21, 12); return { now: () => t, advance: (ms) => { t += ms; } }; };
const guard = (opts = {}) => new WriteGuard({ caps: { [ICP]: '1', SNEED: '1000' }, ...opts });

test('parseUnits', () => {
  assert.equal(parseUnits('1', 8), 100000000n);
  assert.equal(parseUnits('0.00000001', 8), 1n);
  assert.equal(parseUnits('1000', 8), 100000000000n);
  assert.throws(() => parseUnits('0.000000001', 8));
  assert.throws(() => parseUnits('-1', 8));
  assert.throws(() => parseUnits('1e3', 8));
});

test('hashOf is stable across key order and distinguishes bigints, principals and bytes', () => {
  assert.equal(hashOf({ a: 1, b: 2n }), hashOf({ b: 2n, a: 1 }));
  assert.notEqual(hashOf({ a: 1n }), hashOf({ a: 2n }));
  assert.notEqual(hashOf({ a: new Uint8Array([1]) }), hashOf({ a: new Uint8Array([2]) }));
});

test('a token confirms exactly once', () => {
  const g = guard();
  const p = plan();
  const { token } = g.issue('t', { x: 1 }, p);
  assert.equal(g.consume('t', { x: 1 }, token, p), true);
  assert.throws(() => g.consume('t', { x: 1 }, token, p), /already used/);
});

test('an unknown token is refused', () => {
  assert.throws(() => guard().consume('t', {}, 'deadbeef', plan()), /Unknown or already used/);
});

test('a token expires after 10 minutes', () => {
  const c = clock();
  const g = guard({ now: c.now });
  const p = plan();
  const a = g.issue('t', {}, p);
  const b = g.issue('t', {}, p);
  c.advance(TOKEN_TTL_MS - 1);
  assert.equal(g.consume('t', {}, a.token, p), true);
  c.advance(2);
  assert.throws(() => g.consume('t', {}, b.token, p), /expired/);
});

test('a token is bound to the tool, the arguments, the signer and the plan', () => {
  const g = guard();
  const p = plan();
  let t = g.issue('forum_post', { body: 'hi' }, p).token;
  assert.throws(() => g.consume('sms_send', { body: 'hi' }, t, p), /issued for forum_post/);
  t = g.issue('forum_post', { body: 'hi' }, p).token;
  assert.throws(() => g.consume('forum_post', { body: 'hello' }, t, p), /arguments differ/);
  t = g.issue('forum_post', { body: 'hi' }, p).token;
  assert.throws(() => g.consume('forum_post', { body: 'hi' }, t, { ...p, principal: 'someone-else' }), /identity changed/);
  t = g.issue('forum_post', { body: 'hi' }, p).token;
  assert.throws(() => g.consume('forum_post', { body: 'hi' }, t, plan([], [{ canister: 'aaaaa-aa', method: 'm', args: [2] }])), /state changed/);
  t = g.issue('forum_post', { body: 'hi' }, plan([icpSpend(10)])).token;
  assert.throws(() => g.consume('forum_post', { body: 'hi' }, t, plan([icpSpend(11)])), /state changed/);
});

test('a failed confirmation burns the token', () => {
  const g = guard();
  const t = g.issue('t', { a: 1 }, plan()).token;
  assert.throws(() => g.consume('t', { a: 2 }, t, plan()));
  assert.throws(() => g.consume('t', { a: 1 }, t, plan()), /already used/);
});

test('daily caps: per ledger, summed within a plan, across calls, reset at UTC midnight', () => {
  const c = clock();
  const g = guard({ now: c.now });
  assert.deepEqual(g.checkSpends(plan([icpSpend(100000000)])), []);
  assert.match(g.checkSpends(plan([icpSpend(60000000), icpSpend(50000000)]))[0], /Daily cap for ICP/);
  g.recordSpends(plan([icpSpend(70000000)]));
  assert.equal(g.spentToday(ICP), 70000000n);
  assert.match(g.checkSpends(plan([icpSpend(40000000)]))[0], /70000000 already spent/);
  assert.deepEqual(g.checkSpends(plan([icpSpend(30000000)])), []);
  c.advance(24 * 3600_000);
  assert.equal(g.spentToday(ICP), 0n);
  assert.deepEqual(g.checkSpends(plan([icpSpend(100000000)])), []);
});

test('caps by symbol, and no cap means no spending', () => {
  const g = guard();
  assert.deepEqual(g.checkSpends(plan([{ ledger: SNEED, symbol: 'SNEED', decimals: 8, amount: 1000n * 100000000n }])), []);
  assert.match(g.checkSpends(plan([{ ledger: SNEED, symbol: 'SNEED', decimals: 8, amount: 1000n * 100000000n + 1n }]))[0], /Daily cap/);
  assert.match(g.checkSpends(plan([{ ledger: OTHER, symbol: 'ckBTC', decimals: 8, amount: 1n }]))[0], /No daily cap is configured for ckBTC/);
});

test('plain transfers to arbitrary accounts are off unless allowed', () => {
  assert.match(guard().checkSpends(plan([icpSpend(1, { arbitraryTransfer: true })]))[0], /SNEED_MCP_ALLOW_TRANSFERS/);
  assert.deepEqual(guard({ allowTransfers: true }).checkSpends(plan([icpSpend(1, { arbitraryTransfer: true })])), []);
});

test('consume enforces the caps at confirmation time', () => {
  const g = guard();
  const p = plan([icpSpend(90000000)]);
  const t = g.issue('t', {}, p).token;
  g.recordSpends(plan([icpSpend(20000000)])); // spent elsewhere meanwhile
  assert.throws(() => g.consume('t', {}, t, p), /Daily cap/);
});

test('spending and the audit log persist to files with mode 600', () => {
  const d = dir();
  const g = guard({ spendPath: join(d, 'spend.json'), auditPath: join(d, 'audit.jsonl') });
  g.recordSpends(plan([icpSpend(5)]));
  const g2 = guard({ spendPath: join(d, 'spend.json') });
  assert.equal(g2.spentToday(ICP), 5n);
  g.audit({ tool: 't', outcome: { ok: true, n: 7n } });
  g.audit({ tool: 'u', outcome: { ok: false } });
  const lines = readFileSync(join(d, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].tool, 't');
  assert.deepEqual(lines[0].outcome.n, { $big: '7' });
  assert.equal(statSync(join(d, 'audit.jsonl')).mode & 0o777, 0o600);
  assert.equal(statSync(join(d, 'spend.json')).mode & 0o777, 0o600);
});

// ---------- the protocol ----------

const fakeCtx = (over = {}) => ({ who: { mode: 'own', label: 'as test', principal: 'me' }, principal: 'me', signed: async () => ({}), anon: async () => ({}), ...over });
const textOf = (r) => r.content.map((c) => c.text).join('\n');
const tokenFrom = (r) => textOf(r).match(/confirm: "([0-9a-f]+)"/)[1];

const spec = (over = {}) => {
  const calls = [];
  return {
    calls,
    name: 'fake_write',
    build: async (args) => ({ summary: `say ${args.text}`, calls: [{ canister: 'aaaaa-aa', method: 'say', args: [args.text] }], spends: args.spend ? [icpSpend(args.spend)] : [] }),
    run: async (args) => { calls.push(args); return { ok: true, summary: 'said', spent: Boolean(args.spend) }; },
    ...over,
  };
};

test('handleWrite: preview first, nothing executed; confirm executes once and audits', async () => {
  const d = dir();
  const g = guard({ auditPath: join(d, 'audit.jsonl') });
  setGuard(g);
  setContextFactory(() => fakeCtx());
  const s = spec();
  const prev = await handleWrite(s, { text: 'hi', spend: 1000 });
  assert.match(textOf(prev), /PREVIEW of fake_write: nothing has been sent yet/);
  assert.match(textOf(prev), /say\(\["hi"\]\)/);
  assert.match(textOf(prev), /0\.00001 ICP/);
  assert.equal(s.calls.length, 0);
  const token = tokenFrom(prev);
  const done = await handleWrite(s, { text: 'hi', spend: 1000, confirm: token });
  assert.ok(!done.isError, textOf(done));
  assert.match(textOf(done), /Done: said/);
  assert.equal(s.calls.length, 1);
  assert.equal(g.spentToday(ICP), 1000n);
  const again = await handleWrite(s, { text: 'hi', spend: 1000, confirm: token });
  assert.ok(again.isError);
  assert.equal(s.calls.length, 1);
  const audit = readFileSync(join(d, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  // the executed write, then the refused replay (audited as refused, without the token)
  assert.equal(audit.length, 2);
  assert.equal(audit[0].tool, 'fake_write');
  assert.equal(audit[0].input.text, 'hi');
  assert.equal(audit[0].outcome.ok, true);
  assert.match(audit[1].refused, /Unknown or already used/);
  assert.equal(audit[1].outcome, undefined);
  assert.ok(!JSON.stringify(audit[1]).includes(token));
});

test('handleWrite: changed arguments with a valid token do not execute', async () => {
  setGuard(guard());
  setContextFactory(() => fakeCtx());
  const s = spec();
  const token = tokenFrom(await handleWrite(s, { text: 'hi' }));
  const r = await handleWrite(s, { text: 'bye', confirm: token });
  assert.ok(r.isError);
  assert.match(textOf(r), /arguments differ/);
  assert.equal(s.calls.length, 0);
});

test('handleWrite: over the cap is shown as BLOCKED and refused on confirm', async () => {
  setGuard(guard());
  setContextFactory(() => fakeCtx());
  const s = spec();
  const prev = await handleWrite(s, { text: 'x', spend: 200000000 });
  assert.match(textOf(prev), /BLOCKED/);
  assert.match(textOf(prev), /No confirmation token was issued/);
  // a token from an unblocked preview of the same call cannot push it over the cap either
  const ok = tokenFrom(await handleWrite(s, { text: 'x', spend: 90000000 }));
  getGuardForTest().recordSpends({ spends: [icpSpend(20000000)] });
  const r = await handleWrite(s, { text: 'x', spend: 90000000, confirm: ok });
  assert.ok(r.isError);
  assert.match(textOf(r), /Daily cap/);
  assert.equal(s.calls.length, 0);
});

test('handleWrite: act-as-me delegations that do not cover a canister block the write', async () => {
  setGuard(guard());
  setContextFactory(() => fakeCtx({ who: { mode: 'delegation', label: 'as me (you)', principal: 'me', targets: ['bbbbb-bb'] } }));
  const s = spec();
  const prev = await handleWrite(s, { text: 'x' });
  assert.match(textOf(prev), /as me \(you\)/);
  assert.match(textOf(prev), /delegation does not cover aaaaa-aa/);
  assert.doesNotMatch(textOf(prev), /confirm: "/);
  const r = await handleWrite(s, { text: 'x', confirm: 'abcdef' });
  assert.ok(r.isError);
  assert.equal(s.calls.length, 0);
});

test('handleWrite: a run that failed after spending still counts the spend and is audited', async () => {
  const d = dir();
  const g = guard({ auditPath: join(d, 'a.jsonl') });
  setGuard(g);
  setContextFactory(() => fakeCtx());
  const s = spec({ run: async () => ({ ok: false, spent: true, error: 'second step failed', recovery: 'do X' }) });
  const token = tokenFrom(await handleWrite(s, { text: 'x', spend: 500 }));
  const r = await handleWrite(s, { text: 'x', spend: 500, confirm: token });
  assert.ok(r.isError);
  assert.match(textOf(r), /FAILED: second step failed[\s\S]*Recovery: do X/);
  assert.equal(g.spentToday(ICP), 500n);
  assert.equal(JSON.parse(readFileSync(join(d, 'a.jsonl'), 'utf8')).outcome.ok, false);
});

test('handleWrite: a build error is returned, no token issued', async () => {
  setGuard(guard());
  setContextFactory(() => fakeCtx());
  const r = await handleWrite(spec({ build: async () => { throw new Error('No post 5.'); } }), { text: 'x' });
  assert.ok(r.isError);
  assert.match(textOf(r), /No post 5/);
});
