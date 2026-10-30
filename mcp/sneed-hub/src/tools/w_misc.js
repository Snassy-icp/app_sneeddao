// Write tools: Sneed Lock token lock (pages/LockWizard.jsx), Sneed Monitor watch/unwatch
// (components/SneedMonitorSection.jsx), Sneed Notifications app permission and channel routing
// (pages/Notifications.jsx), RLL reward claims (pages/Rewards.jsx).
import { z } from 'zod';
import { idlFactory as lockIdl } from '../idl/sneed_lock.did.js';
import { idlFactory as icrc1Idl } from '../idl/icrc1_ledger.did.js';
import { idlFactory as monIdl } from '../idl/sneed_mon.did.js';
import { idlFactory as notifIdl } from '../idl/sneed_notifications.did.js';
import { idlFactory as rllIdl } from '../idl/rll.did.js';
import { idlFactory as govIdl } from '../idl/sns_governance.did.js';
import { CANISTERS, opt, toPrincipal, canisterId } from '../ic.js';
import { defineWrite, unwrapResult } from '../writes.js';
import { spend, toBaseUnits, ledgerFee, fmt, link, principalSubaccount, toHex, balanceProblems } from '../chain.js';
import { tokenInfo, plain, nsDuration, shortErr } from '../format.js';
import { specialPricesFor, effectivePrice, premiumStatus } from '../prices.js';

const ICP_T = { decimals: 8, symbol: 'ICP' };

// ---------------- Sneed Lock ----------------

const lockBuild = async ({ ledger, amount, lock_days, dissolve_delay_days }, ctx) => {
  const lockId = CANISTERS.sneed_lock;
  const anonLock = await ctx.anon(lockIdl, lockId);
  const signedLock = await ctx.signed(lockIdl, lockId); // caller-scoped queries
  const me = toPrincipal(ctx.principal);
  const ledgerId = toPrincipal(ledger, 'ledger').toText();
  const { amount: base, token } = await toBaseUnits(ledgerId, amount);
  if (base <= 0n) throw new Error('Amount must be positive.');
  const fee = await ledgerFee(ledgerId);
  const icpFee = await ledgerFee(CANISTERS.icp_ledger);
  const problems = [];
  // fee (getEffectiveLockFee is an update call; the preview computes it from queries the same way and
  // the run checks it with getEffectiveLockFee before moving anything)
  const [fees, paySub, limits, special] = await Promise.all([anonLock.get_lock_fees_icp(), anonLock.getPaymentSubaccount(me), anonLock.get_lock_limits(), specialPricesFor(anonLock, ctx.principal)]);
  let isPremium = false;
  try { isPremium = (await premiumStatus(ctx.principal, ctx.anon)).active; } catch { /* regular */ }
  const eff = effectivePrice({ regular: fees.token_lock_fee_icp_e8s, premium: fees.premium_token_lock_fee_icp_e8s, isPremium, special, field: 'token_lock_fee_icp_e8s' });
  const icp = await ctx.anon(icrc1Idl, CANISTERS.icp_ledger);
  const payBal = await icp.icrc1_balance_of({ owner: toPrincipal(lockId), subaccount: [paySub] });
  const needFee = eff.price > payBal ? eff.price - payBal : 0n;
  // tokens: free balance in the caller's Sneed Lock wallet subaccount counts first
  const sub = principalSubaccount(me);
  const l = await ctx.anon(icrc1Idl, ledgerId);
  const [backendBal, summed] = await Promise.all([
    l.icrc1_balance_of({ owner: toPrincipal(lockId), subaccount: [sub] }),
    signedLock.get_summed_locks().catch(() => []),
  ]);
  const lockedSum = summed.filter(([t]) => t.toText() === ledgerId).reduce((s, [, b]) => s + BigInt(b), 0n);
  const available = backendBal > lockedSum ? backendBal - lockedSum : 0n;
  const toSend = base > available ? base - available : 0n;
  // lock period
  const days = lock_days ?? 0;
  const delayNs = dissolve_delay_days ? BigInt(Math.round(dissolve_delay_days * 86400)) * 1_000_000_000n : null;
  const periodNs = BigInt(Math.round(days * 86400)) * 1_000_000_000n;
  const total = periodNs + (delayNs ?? 0n);
  if (!days && !delayNs) problems.push('Give lock_days, dissolve_delay_days, or both.');
  if (total < BigInt(limits.min_lock_length_ns)) problems.push(`Shorter than the minimum lock (${nsDuration(limits.min_lock_length_ns)}).`);
  if (total > BigInt(limits.max_lock_length_ns)) problems.push(`Longer than the maximum lock (${nsDuration(limits.max_lock_length_ns)}).`);
  const calls = [];
  const spends = [];
  if (needFee > 0n) {
    calls.push({ canister: CANISTERS.icp_ledger, method: 'icrc1_transfer', args: { to: { owner: lockId, subaccount: [toHex(paySub)] }, amount: needFee, fee: [], memo: [], from_subaccount: [], created_at_time: [] }, note: `lock fee (${eff.tier} price ${fmt(eff.price, ICP_T)}, ${fmt(payBal, ICP_T)} already deposited)` });
    spends.push(await spend(CANISTERS.icp_ledger, needFee + icpFee, 'Sneed Lock fee + ledger fee', 'Sneed Lock payment subaccount'));
  }
  if (toSend > 0n) {
    calls.push({ canister: ledgerId, method: 'icrc1_transfer', args: { to: { owner: lockId, subaccount: [toHex(sub)] }, amount: toSend, fee: [], memo: [], from_subaccount: [], created_at_time: [] }, note: 'into your Sneed Lock wallet subaccount' });
    spends.push(await spend(ledgerId, toSend + fee, `${fmt(toSend, token)} into your Sneed Lock wallet + ledger fee`, 'your Sneed Lock wallet subaccount'));
  }
  calls.push({ canister: lockId, method: 'create_lock', args: [base, ledgerId, days ? `<now + ${days} d, ns>` : 0, delayNs != null ? [delayNs] : []] });
  // the ICP lock fee and the tokens (both ICP when locking ICP) come from your main account
  problems.push(...await balanceProblems(ctx, spends));
  return {
    summary: `Lock ${fmt(base, token)} for ${days ? `${days} day(s)` : 'no fixed period'}${delayNs ? ` with a ${dissolve_delay_days}-day dissolve delay` : ''}`,
    calls,
    spends,
    notes: [
      `Lock fee: ${fmt(eff.price, ICP_T)} (${eff.tier}${isPremium ? ', Premium member' : ''}).`,
      available > 0n ? `${fmt(available < base ? available : base, token)} comes from your free Sneed Lock wallet balance.` : null,
      'Locked tokens cannot be withdrawn before the lock ends (and the dissolve delay has run). Locks are public.',
    ].filter(Boolean),
    problems,
    _base: base, _ledger: ledgerId, _fee: eff.price, _needFee: needFee, _paySub: paySub, _toSend: toSend, _sub: sub, _days: days, _delay: delayNs,
  };
};

const lockRun = async (args, ctx, plan) => {
  const lockId = CANISTERS.sneed_lock;
  const lock = await ctx.signed(lockIdl, lockId);
  const me = toPrincipal(ctx.principal);
  const steps = [];
  let spent = false;
  try {
    const eff = await lock.getEffectiveLockFee(me, false);
    if (BigInt(eff.fee_e8s) !== plan._fee) return { ok: false, error: `The lock fee is ${fmt(eff.fee_e8s, ICP_T)}, not the previewed ${fmt(plan._fee, ICP_T)}. Nothing was sent; preview again.` };
    if (plan._needFee > 0n) {
      const icp = await ctx.signed(icrc1Idl, CANISTERS.icp_ledger);
      const tr = await icp.icrc1_transfer({ to: { owner: toPrincipal(lockId), subaccount: [plan._paySub] }, amount: plan._needFee, fee: [], memo: [], from_subaccount: [], created_at_time: [] });
      if ('Err' in tr) throw new Error(`fee payment refused, nothing sent: ${JSON.stringify(plain(tr.Err))}`);
      spent = true;
      steps.push(`lock fee paid (ICP block ${tr.Ok})`);
    }
    if (plan._toSend > 0n) {
      const l = await ctx.signed(icrc1Idl, plan._ledger);
      const tr = await l.icrc1_transfer({ to: { owner: toPrincipal(lockId), subaccount: [plan._sub] }, amount: plan._toSend, fee: [], memo: [], from_subaccount: [], created_at_time: [] });
      if ('Err' in tr) throw new Error(`token transfer refused: ${JSON.stringify(plain(tr.Err))}`);
      spent = true;
      steps.push(`tokens deposited into your Sneed Lock wallet (block ${tr.Ok})`);
    }
    const expires = plan._days ? (BigInt(Date.now()) + BigInt(Math.round(plan._days * 86400_000))) * 1_000_000n : 0n;
    const r = await lock.create_lock(plan._base, toPrincipal(plan._ledger), expires, plan._delay != null ? [plan._delay] : []);
    if ('Err' in r) throw new Error(`create_lock: ${r.Err.message}`);
    steps.push(`lock ${r.Ok} created`);
    return { ok: true, spent, summary: `lock ${r.Ok} created`, steps, links: [link(`/lock/${r.Ok}`)] };
  } catch (e) {
    return { ok: false, spent, steps, error: shortErr(e), recovery: spent ? `Anything sent stays in your Sneed Lock wallet / fee deposit (nothing is lost): check ${link('/sneedlock')} before retrying (create_lock is not idempotent).` : undefined };
  }
};

// ---------------- Sneed Monitor ----------------

const target = (t) => (t === 'nns' ? { nns: null } : { sns: toPrincipal(t, 'SNS root canister id') });
const targetText = (t) => (t === 'nns' ? 'the NNS' : `SNS ${t}`);
const monTarget = z.string().describe(`"nns" or an SNS root canister id (Sneed DAO: ${CANISTERS.sneed_sns_root})`);

// ---------------- RLL ----------------

/// Sneed neurons of a principal and of the owners of those neurons (NeuronUtils.fetchUserNeuronsForSns).
export const userNeurons = async (ctx, principal) => {
  const gov = await ctx.anon(govIdl, CANISTERS.sneed_sns_governance);
  const first = (await gov.list_neurons({ of_principal: [toPrincipal(principal)], limit: 100, start_page_at: [] })).neurons;
  const owners = new Set();
  for (const n of first) for (const p of n.permissions) if (p.permission_type.includes(2) && opt(p.principal)) owners.add(opt(p.principal).toText());
  owners.delete(principal);
  const all = new Map(first.map((n) => [toHex(opt(n.id).id), n]));
  for (const o of owners) {
    const r = (await gov.list_neurons({ of_principal: [toPrincipal(o)], limit: 100, start_page_at: [] })).neurons;
    for (const n of r) all.set(toHex(opt(n.id).id), n);
  }
  return [...all.values()];
};

export const miscWrites = [
  {
    name: 'sneed_lock_create_token_lock',
    title: 'Sneed Lock: lock tokens',
    description: 'Lock ICRC-1 tokens in Sneed Lock, as the lock wizard does: pay the ICP lock fee into your payment subaccount if the deposit is short (Premium/special prices applied), move the missing tokens into your Sneed Lock wallet subaccount, then create_lock(amount, ledger, expiry, dissolve delay). Counts toward the daily cap.',
    inputSchema: {
      ledger: z.string().describe('Token ledger canister id'),
      amount: z.string().describe('Whole tokens to lock'),
      lock_days: z.number().min(0).max(36500).optional().describe('Lock for this many days'),
      dissolve_delay_days: z.number().min(0).max(36500).optional().describe('Optional dissolve delay in days (counts from when you start dissolving)'),
    },
    build: lockBuild,
    run: lockRun,
  },
  {
    name: 'mon_watch',
    title: 'Sneed Monitor: watch proposals',
    description: 'Watch the proposals of an SNS (or the NNS) with Sneed Monitor; alerts arrive through Sneed Notifications. Paid per check from your prepaid Monitor balance: optional top_up_icp moves ICP into your deposit account and credits it first. Also allows the Monitor app in Sneed Notifications, as Sneed Hub does. Needs a configured Sneed Monitor canister id.',
    inputSchema: { target: monTarget, top_up_icp: z.string().optional().describe('ICP to add to your Monitor balance first') },
    async build({ target: t, top_up_icp }, ctx) {
      const monId = canisterId('sneed_mon');
      const mon = await ctx.signed(monIdl, monId);
      const [bal, status, watches] = await Promise.all([mon.get_my_balance(), mon.get_status(), mon.get_my_watches()]);
      const calls = [];
      const spends = [];
      const problems = [];
      if (watches.some((w) => JSON.stringify(plain(w.target)) === JSON.stringify(plain(target(t))))) problems.push(`You already watch ${targetText(t)}.`);
      let top = 0n;
      const fee = await ledgerFee(CANISTERS.icp_ledger);
      if (top_up_icp) {
        top = (await toBaseUnits(CANISTERS.icp_ledger, top_up_icp)).amount;
        calls.push({ canister: CANISTERS.icp_ledger, method: 'icrc1_transfer', args: { to: { owner: bal.deposit_account.owner.toText(), subaccount: opt(bal.deposit_account.subaccount) ? [toHex(opt(bal.deposit_account.subaccount))] : [] }, amount: top + fee, fee: [], memo: [] } });
        calls.push({ canister: monId, method: 'credit_deposit', args: [] });
        spends.push(await spend(CANISTERS.icp_ledger, top + 2n * fee, 'Sneed Monitor top-up (+ the credit move fee) + ledger fee', 'your Monitor deposit account'));
        problems.push(...await balanceProblems(ctx, spends));
      } else if (BigInt(bal.balance_e8s) === 0n) problems.push('Your Sneed Monitor balance is 0: pass top_up_icp.');
      if (t === 'nns') problems.push('Watching the NNS also needs your NNS neuron ids (set_nns_neurons); do it on Sneed Hub /notifications for now.');
      calls.push({ canister: monId, method: 'watch', args: [plain(target(t))] });
      const appId = opt(status.app_id);
      if (appId != null) calls.push({ canister: CANISTERS.sneed_notifications, method: 'allow_app', args: [appId, true], note: 'so the alerts are delivered' });
      return {
        summary: `Watch ${targetText(t)} with Sneed Monitor`,
        calls, spends, problems,
        notes: [`Balance ${fmt(bal.balance_e8s, ICP_T)}; costs about ${fmt(bal.per_day_e8s, ICP_T)}/day now (more with each watch).`],
        _top: top, _fee: fee, _dep: bal.deposit_account, _app: appId,
      };
    },
    async run({ target: t }, ctx, plan) {
      const monId = canisterId('sneed_mon');
      const mon = await ctx.signed(monIdl, monId);
      const steps = [];
      let spent = false;
      try {
        if (plan._top > 0n) {
          const icp = await ctx.signed(icrc1Idl, CANISTERS.icp_ledger);
          const tr = await icp.icrc1_transfer({ to: plan._dep, amount: plan._top + plan._fee, fee: [], memo: [], from_subaccount: [], created_at_time: [] });
          if ('Err' in tr) throw new Error(`top-up refused: ${JSON.stringify(plain(tr.Err))}`);
          spent = true;
          steps.push(`top-up sent to your Monitor deposit account (ICP block ${tr.Ok})`);
          const c = unwrapResult(await mon.credit_deposit(), 'credit_deposit');
          steps.push(`credited ${fmt(c.credited_e8s, ICP_T)}`);
        }
        unwrapResult(await mon.watch(target(t)), 'watch');
        steps.push(`watching ${targetText(t)}`);
        if (plan._app != null) {
          const n = await ctx.signed(notifIdl, CANISTERS.sneed_notifications);
          try { unwrapResult(await n.allow_app(plan._app, true), 'allow_app'); steps.push('Monitor allowed in Sneed Notifications'); } catch (e) { steps.push(`allow_app failed (${shortErr(e)}); allow it on ${link('/notifications')}`); }
        }
        return { ok: true, spent, summary: `watching ${targetText(t)}`, steps, links: [link('/notifications')] };
      } catch (e) { return { ok: false, spent, steps, error: shortErr(e) }; }
    },
  },
  {
    name: 'mon_unwatch',
    title: 'Sneed Monitor: stop watching',
    description: 'Stop watching an SNS (or the NNS) with Sneed Monitor (unwatch). Your prepaid balance stays.',
    inputSchema: { target: monTarget },
    async build({ target: t }, ctx) {
      const monId = canisterId('sneed_mon');
      const watches = await (await ctx.signed(monIdl, monId)).get_my_watches();
      // unwatch answers ok("Not watching") for a target you do not watch: say so before, not "stopped"
      const problems = watches.some((w) => JSON.stringify(plain(w.target)) === JSON.stringify(plain(target(t)))) ? [] : [`You do not watch ${targetText(t)}.`];
      return { summary: `Stop watching ${targetText(t)}`, calls: [{ canister: monId, method: 'unwatch', args: [plain(target(t))] }], problems };
    },
    async run({ target: t }, ctx) {
      const mon = await ctx.signed(monIdl, canisterId('sneed_mon'));
      const r = unwrapResult(await mon.unwatch(target(t)), 'unwatch');
      return { ok: true, summary: `${targetText(t)}: ${r}` };
    },
  },
  {
    name: 'notifications_allow_app',
    title: 'Sneed Notifications: allow or block an app',
    description: 'Allow or block an app (by id, see notifications_read) sending you notifications (sneed_notifications.allow_app).',
    inputSchema: { app_id: z.number().int().min(0).describe('App id'), allow: z.boolean().describe('true = allow, false = block') },
    async build({ app_id, allow }, ctx) {
      const n = await ctx.anon(notifIdl, CANISTERS.sneed_notifications);
      const app = opt(await n.get_app(BigInt(app_id)));
      return { summary: `${allow ? 'Allow' : 'Block'} notifications from app ${app_id}${app ? ` (${app.name})` : ''}`, calls: [{ canister: CANISTERS.sneed_notifications, method: 'allow_app', args: [app_id, allow] }], problems: app ? [] : [`No app ${app_id}.`] };
    },
    async run({ app_id, allow }, ctx) {
      const n = await ctx.signed(notifIdl, CANISTERS.sneed_notifications);
      return { ok: true, summary: String(unwrapResult(await n.allow_app(BigInt(app_id), allow), 'allow_app')), links: [link('/notifications')] };
    },
  },
  {
    name: 'notifications_set_channels',
    title: 'Sneed Notifications: route levels to channels',
    description: 'Choose which of your verified channels (ids from notifications_read) receive urgent / normal / info notifications, and optionally snooze everything for some hours (sneed_notifications.set_settings with your other settings unchanged). Adding new channels (email, Telegram, …) needs encryption to the relay key: do that on Sneed Hub /notifications.',
    inputSchema: {
      urgent: z.array(z.number().int().min(0)).optional().describe('Channel ids for urgent'),
      normal: z.array(z.number().int().min(0)).optional().describe('Channel ids for normal'),
      info: z.array(z.number().int().min(0)).optional().describe('Channel ids for info'),
      snooze_hours: z.number().min(0).max(720).optional().describe('Snooze all for this many hours (0 = end snooze)'),
    },
    async build(a, ctx) {
      const n = await ctx.signed(notifIdl, CANISTERS.sneed_notifications);
      const mine = await n.get_my_settings();
      const ids = new Set(mine.channels.map((c) => String(c.id)));
      const problems = [];
      for (const k of ['urgent', 'normal', 'info']) for (const id of a[k] ?? []) if (!ids.has(String(id))) problems.push(`Channel ${id} is not one of yours.`);
      const s = mine.settings;
      const next = {
        ...s,
        defaults: { urgent: a.urgent ?? s.defaults.urgent, normal: a.normal ?? s.defaults.normal, info: a.info ?? s.defaults.info },
        snooze_until: a.snooze_hours == null ? s.snooze_until : a.snooze_hours === 0 ? [] : ['<now + ' + a.snooze_hours + ' h, ns>'],
      };
      return { summary: 'Update notification routing', calls: [{ canister: CANISTERS.sneed_notifications, method: 'set_settings', args: plain(next) }], problems, _next: next };
    },
    async run(a, ctx, plan) {
      const n = await ctx.signed(notifIdl, CANISTERS.sneed_notifications);
      const next = { ...plan._next, defaults: { urgent: plan._next.defaults.urgent.map(BigInt), normal: plan._next.defaults.normal.map(BigInt), info: plan._next.defaults.info.map(BigInt) } };
      if (a.snooze_hours) next.snooze_until = [(BigInt(Date.now()) + BigInt(Math.round(a.snooze_hours * 3600_000))) * 1_000_000n];
      return { ok: true, summary: String(unwrapResult(await n.set_settings(next), 'set_settings')), links: [link('/notifications')] };
    },
  },
  {
    name: 'rll_claim',
    title: 'Claim Sneed DAO voting rewards',
    description: 'Claim RLL rewards (Sneed DAO\'s distribution to neuron holders) to the signing principal\'s main account: one rll.claim_full_balance_of_hotkey(ledger, fee) per token with a balance above its ledger fee (or only `ledger`). The signer must hold a permission (e.g. hotkey) on a Sneed neuron. You receive the balance minus one ledger fee.',
    inputSchema: { ledger: z.string().optional().describe('Only this token') },
    async build({ ledger }, ctx) {
      const rll = await ctx.anon(rllIdl, CANISTERS.rll);
      const neurons = await userNeurons(ctx, ctx.principal);
      const balances = neurons.length ? await rll.balances_of_hotkey_neurons(neurons) : [];
      const calls = [];
      const notes = [];
      for (const [l, amt] of balances) {
        if (ledger && l.toText() !== toPrincipal(ledger).toText()) continue;
        const t = await tokenInfo(l);
        const fee = await ledgerFee(l);
        if (BigInt(amt) <= fee) { notes.push(`${fmt(amt, t)} is not above the fee; skipped.`); continue; }
        calls.push({ canister: CANISTERS.rll, method: 'claim_full_balance_of_hotkey', args: [l.toText(), fee], note: `receive ${fmt(BigInt(amt) - fee, t)}` });
      }
      const problems = [];
      if (!neurons.length) problems.push(`${ctx.principal} has no Sneed neuron permissions; add it as a hotkey on your neuron (${link('/neurons')}).`);
      else if (!calls.length) problems.push('Nothing to claim.');
      return { summary: `Claim rewards in ${calls.length} token(s)`, calls, notes, problems };
    },
    async run(a, ctx, plan) {
      const rll = await ctx.signed(rllIdl, CANISTERS.rll);
      const steps = [];
      let ok = 0;
      for (const c of plan.calls) {
        const r = await rll.claim_full_balance_of_hotkey(toPrincipal(c.args[0]), BigInt(c.args[1]));
        if ('Ok' in r) { ok += 1; steps.push(`${c.args[0]}: claimed (block ${r.Ok})`); } else steps.push(`${c.args[0]}: ${JSON.stringify(plain(r.Err))}`);
      }
      return { ok: ok > 0, summary: `claimed ${ok} of ${plan.calls.length}`, error: ok ? undefined : 'no claim succeeded', steps, links: [link('/rewards')] };
    },
  },
];

export const registerMiscWrites = (server) => miscWrites.forEach((w) => defineWrite(server, w));
