// The write safety layer: two-step preview/confirm with one-time tokens bound to the exact
// arguments and plan, daily spending caps per ledger, the transfer switch, and an audit log.
//
// A write tool builds a plan: the exact calls it will make (canister, method, decoded args) and the
// tokens it will spend (ledger, amount incl. fees). Called without `confirm`, the tool returns the
// preview and a token. Called again with `confirm: <token>` (and the same arguments), it rebuilds the
// plan; it runs only when the token exists, is unexpired and unused, was issued for this tool with
// these arguments, the plan is unchanged, and the spends fit today's caps.
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export const TOKEN_TTL_MS = 10 * 60 * 1000;

const canon = (v) => {
  if (typeof v === 'bigint') return { $big: v.toString() };
  if (v == null) return null;
  if (v instanceof Uint8Array) return { $hex: Buffer.from(v).toString('hex') };
  if (v && typeof v === 'object' && v._isPrincipal) return { $p: v.toText() };
  if (Array.isArray(v)) return v.map(canon);
  if (typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canon(v[k])]));
  return v;
};
/// Stable hash of any value (bigints, principals and bytes included).
export const hashOf = (v) => createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');

/// Whole-token cap text ("1.5") to base units.
export const parseUnits = (text, decimals) => {
  const s = String(text).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`bad amount "${text}"`);
  const [w, f = ''] = s.split('.');
  if (f.length > decimals) throw new Error(`"${text}" has more than ${decimals} decimals`);
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
};

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

export class WriteGuard {
  /// opts: { caps: {ledgerIdOrSymbol: wholeTokens}, allowTransfers, spendPath, auditPath, now: () => ms }
  constructor({ caps = {}, allowTransfers = false, spendPath = null, auditPath = null, now = () => Date.now() } = {}) {
    this.caps = caps;
    this.allowTransfers = allowTransfers;
    this.spendPath = spendPath;
    this.auditPath = auditPath;
    this.now = now;
    this.tokens = new Map();
  }

  // ---- spending ----
  _loadSpend() {
    if (!this.spendPath || !existsSync(this.spendPath)) return this._memSpend ?? {};
    try { return JSON.parse(readFileSync(this.spendPath, 'utf8')); } catch { return {}; }
  }
  _saveSpend(s) {
    if (!this.spendPath) { this._memSpend = s; return; }
    mkdirSync(dirname(this.spendPath), { recursive: true, mode: 0o700 });
    writeFileSync(this.spendPath, JSON.stringify(s, null, 2), { mode: 0o600 });
  }
  /// Base units spent today on `ledger` by `principal`'s writes through this server.
  spentToday(ledger) {
    const s = this._loadSpend();
    return BigInt(s[utcDay(this.now())]?.[ledger] ?? '0');
  }
  /// The cap for a spend in base units, or null when none is configured.
  capFor({ ledger, symbol, decimals }) {
    const c = this.caps[ledger] ?? (symbol ? this.caps[symbol] ?? this.caps[String(symbol).toUpperCase()] : undefined);
    if (c == null || decimals == null) return null;
    return parseUnits(c, decimals);
  }
  /// Problems with the plan's spends ([] when it fits): unknown caps, over the cap, disabled transfers.
  checkSpends(plan) {
    const problems = [];
    const totals = new Map();
    for (const sp of plan.spends ?? []) {
      if (sp.arbitraryTransfer && !this.allowTransfers) {
        problems.push('Plain ledger transfers to arbitrary accounts are disabled. Set SNEED_MCP_ALLOW_TRANSFERS=1 (or "allow_transfers": true in the config) to allow them.');
      }
      const prev = totals.get(sp.ledger) ?? { ...sp, amount: 0n };
      prev.amount += BigInt(sp.amount);
      totals.set(sp.ledger, prev);
    }
    for (const [ledger, sp] of totals) {
      const cap = this.capFor(sp);
      const label = sp.symbol ?? ledger;
      if (cap == null) {
        problems.push(`No daily cap is configured for ${label} (${ledger}), so this server will not spend it. Add "caps": {"${ledger}": "<whole tokens per day>"} to the config file or SNEED_MCP_CAPS.`);
        continue;
      }
      const spent = this.spentToday(ledger);
      if (spent + sp.amount > cap) {
        problems.push(`Daily cap for ${label}: this needs ${sp.amount} base units, ${spent} already spent today (UTC), cap ${cap} base units. Raise the cap in the config to continue.`);
      }
    }
    return [...new Set(problems)];
  }
  recordSpends(plan) {
    if (!plan.spends?.length) return;
    const s = this._loadSpend();
    const day = utcDay(this.now());
    s[day] ??= {};
    for (const sp of plan.spends) s[day][sp.ledger] = (BigInt(s[day][sp.ledger] ?? '0') + BigInt(sp.amount)).toString();
    // keep a week
    for (const d of Object.keys(s)) if (d < utcDay(this.now() - 7 * 86400_000)) delete s[d];
    this._saveSpend(s);
  }

  // ---- tokens ----
  /// Issue a one-time confirmation token for this tool, these input args and this plan.
  issue(tool, args, plan) {
    const now = this.now();
    for (const [t, v] of this.tokens) if (v.expires <= now) this.tokens.delete(t);
    const token = randomBytes(12).toString('hex');
    this.tokens.set(token, { tool, argsHash: hashOf(args), planHash: hashOf(plan.calls ?? []), spendsHash: hashOf(plan.spends ?? []), principal: plan.principal, expires: now + TOKEN_TTL_MS });
    return { token, expires: new Date(now + TOKEN_TTL_MS).toISOString() };
  }
  /// Check and consume a token. Throws a readable error when it does not authorise this call.
  consume(tool, args, token, plan) {
    const t = this.tokens.get(token);
    if (!t) throw new Error('Unknown or already used confirmation token. Call the tool again without `confirm` for a new preview.');
    this.tokens.delete(token); // one-time, whatever happens next
    if (t.expires <= this.now()) throw new Error('This confirmation token expired (tokens last 10 minutes). Call the tool again without `confirm` for a new preview.');
    if (t.tool !== tool) throw new Error(`This confirmation token was issued for ${t.tool}, not ${tool}.`);
    if (t.argsHash !== hashOf(args)) throw new Error('The arguments differ from the previewed ones. Call the tool again without `confirm` to preview these arguments.');
    if (t.principal !== plan.principal) throw new Error('The signing identity changed since the preview. Preview again.');
    if (t.planHash !== hashOf(plan.calls ?? []) || t.spendsHash !== hashOf(plan.spends ?? [])) {
      throw new Error('On-chain state changed since the preview (fees, amounts or calls are different now). Call the tool again without `confirm` for a new preview.');
    }
    const problems = this.checkSpends(plan);
    if (problems.length) throw new Error(problems.join('\n'));
    return true;
  }

  // ---- audit ----
  audit(entry) {
    if (!this.auditPath) { (this.memAudit ??= []).push(entry); return; }
    mkdirSync(dirname(this.auditPath), { recursive: true, mode: 0o700 });
    const line = JSON.stringify(canon({ at: new Date(this.now()).toISOString(), ...entry })) + '\n';
    appendFileSync(this.auditPath, line, { mode: 0o600 });
    try { chmodSync(this.auditPath, 0o600); } catch { /* ignore */ }
  }
}
