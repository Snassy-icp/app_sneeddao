// Write tools for Sneed Monitor beyond watch/unwatch, as components/SneedMonitorSection.jsx makes
// them: withdraw the prepaid balance (withdraw_balance), a watch's tier, topics and reminders
// (update_watch, with the reminder window moved up with a slower tier as setFrequency does), the
// NNS neurons to check (set_nns_neurons), and auto top-up (an ICP allowance for sneed_mon with
// icrc2_approve, then set_auto_top_up; off: set_auto_top_up(null), then the allowance back to 0).
import { z } from 'zod';
import { idlFactory as monIdl } from '../idl/sneed_mon.did.js';
import { idlFactory as icrc1Idl } from '../idl/icrc1_ledger.did.js';
import { CANISTERS, opt, toPrincipal, canisterId } from '../ic.js';
import { defineWrite, unwrapResult, getGuard } from '../writes.js';
import { spend, toBaseUnits, ledgerFee, fmt, link, toHex, fromHex, balanceProblems } from '../chain.js';
import { plain } from '../format.js';
import { target, targetText, monTarget } from './w_misc.js';

const ICP_T = { decimals: 8, symbol: 'ICP' };
const sameTarget = (a, b) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));
/// Reminder windows the page offers (utils/SneedMonService.js REMINDER_WINDOWS), in seconds.
export const REMINDER_WINDOWS_S = [3600, 14400, 43200, 86400, 172800];
const mon = (ctx) => ctx.signed(monIdl, canisterId('sneed_mon'));

/// The update_watch patch for the requested changes: every field optional; a reminder window
/// shorter than the new check interval moves up to the first window that covers it (setFrequency).
export const watchPatch = (current, { every_min, new_proposals, reminders, reminder_hours, topics }) => {
  const patch = { every_min: [], topics: [], new_proposals: [], reminders: [], reminder_window_s: [] };
  if (every_min != null) patch.every_min = [BigInt(every_min)];
  if (new_proposals != null) patch.new_proposals = [new_proposals];
  if (reminders != null) patch.reminders = [reminders];
  if (reminder_hours != null) patch.reminder_window_s = [BigInt(Math.round(reminder_hours * 3600))];
  if (topics != null) patch.topics = [topics === 'all' || (Array.isArray(topics) && topics.length === 0) ? { all: null } : { only: topics }];
  const window = patch.reminder_window_s.length ? patch.reminder_window_s[0] : BigInt(current.reminder_window_s);
  if (every_min != null && window < BigInt(every_min) * 60n) {
    const up = REMINDER_WINDOWS_S.find((s) => s >= every_min * 60);
    patch.reminder_window_s = [BigInt(up ?? every_min * 60)];
  }
  return patch;
};

export const monWrites = [
  {
    name: 'mon_withdraw',
    title: 'Sneed Monitor: withdraw my balance',
    description: 'Withdraw ICP from your prepaid Sneed Monitor balance (sneed_mon.withdraw_balance(amount, to)); the ledger fee comes off the amount. Default: everything, to your own main account. Another recipient counts as a plain transfer and needs SNEED_MCP_ALLOW_TRANSFERS=1. Needs a configured Sneed Monitor canister id.',
    inputSchema: {
      amount: z.string().optional().describe('ICP to take off the balance, fee included (default: all of it)'),
      to: z.string().optional().describe('Receiving principal (default: you)'),
    },
    async build({ amount, to }, ctx) {
      const m = await mon(ctx);
      const bal = await m.get_my_balance();
      const fee = await ledgerFee(CANISTERS.icp_ledger);
      const want = amount ? (await toBaseUnits(CANISTERS.icp_ledger, amount)).amount : BigInt(bal.balance_e8s);
      const dest = to ? toPrincipal(to).toText() : ctx.principal;
      const problems = [];
      if (want > BigInt(bal.balance_e8s)) problems.push(`Your Sneed Monitor balance is ${fmt(bal.balance_e8s, ICP_T)}.`);
      if (want <= fee) problems.push(`Withdraw more than the ledger fee (${fmt(fee, ICP_T)}); the balance is ${fmt(bal.balance_e8s, ICP_T)}.`);
      if (dest !== ctx.principal && !getGuard().allowTransfers) problems.push('Withdrawing to someone else is a plain transfer to an arbitrary account, which is disabled. Set SNEED_MCP_ALLOW_TRANSFERS=1 to allow it, or withdraw to yourself.');
      return {
        summary: `Withdraw ${fmt(want, ICP_T)} from your Sneed Monitor balance to ${dest === ctx.principal ? 'your main account' : dest}`,
        calls: [{ canister: canisterId('sneed_mon'), method: 'withdraw_balance', args: [want, { owner: dest, subaccount: [] }] }],
        notes: [`${fmt(want > fee ? want - fee : 0n, ICP_T)} arrives (the ledger fee comes off).`, watchesNote(bal)].filter(Boolean),
        problems,
        _want: want, _to: dest,
      };
    },
    async run(a, ctx, plan) {
      const block = unwrapResult(await (await mon(ctx)).withdraw_balance(plan._want, { owner: toPrincipal(plan._to), subaccount: [] }), 'withdraw_balance');
      return { ok: true, summary: `withdrew ${fmt(plan._want, ICP_T)} from your Sneed Monitor balance (ICP block ${block})`, links: [link('/notifications')] };
    },
  },
  {
    name: 'mon_update_watch',
    title: 'Sneed Monitor: change a watch',
    description: 'Change how Sneed Monitor watches an SNS (or the NNS) for you (sneed_mon.update_watch): every_min (a tier from mon_read: how often it checks, which sets the price), new_proposals and reminders on/off, reminder_hours (how long before a deadline you are reminded), topics ("all" or a list of topic keys). Unchanged fields stay. A reminder window shorter than the check interval moves up with it, as on Sneed Hub.',
    inputSchema: {
      target: monTarget,
      every_min: z.number().int().positive().optional().describe('Check interval in minutes (one of the tiers)'),
      new_proposals: z.boolean().optional().describe('Alert on new proposals'),
      reminders: z.boolean().optional().describe('Remind before a vote deadline'),
      reminder_hours: z.number().positive().max(48).optional().describe('Reminder window in hours (1, 4, 12, 24 or 48 on Sneed Hub)'),
      topics: z.union([z.literal('all'), z.array(z.string()).max(50)]).optional().describe('"all" or topic keys'),
    },
    async build(a, ctx) {
      const m = await mon(ctx);
      const [watches, tiers] = await Promise.all([m.get_my_watches(), m.get_tiers()]);
      const w = watches.find((x) => sameTarget(x.target, target(a.target)));
      const problems = [];
      if (!w) throw new Error(`You do not watch ${targetText(a.target)} (mon_watch first).`);
      if (a.every_min != null && !tiers.tiers.some((t) => Number(t.every_min) === a.every_min)) problems.push(`No tier checks every ${a.every_min} min; the tiers are ${tiers.tiers.map((t) => `${t.every_min}`).join(', ')} min.`);
      if (Array.isArray(a.topics) && a.topics.length) {
        const known = opt(await m.get_target_topics(target(a.target)));
        if (known) { const keys = new Set(known.map((o) => o.key)); for (const k of a.topics) if (!keys.has(k)) problems.push(`Unknown topic "${k}"; known: ${[...keys].join(', ')}.`); }
      }
      if ([a.every_min, a.new_proposals, a.reminders, a.reminder_hours, a.topics].every((x) => x == null)) problems.push('Nothing to change: give every_min, new_proposals, reminders, reminder_hours or topics.');
      const patch = watchPatch(w.settings, a);
      const tier = a.every_min != null ? tiers.tiers.find((t) => Number(t.every_min) === a.every_min) : null;
      return {
        summary: `Change the watch of ${w.name} (${targetText(a.target)})`,
        calls: [{ canister: canisterId('sneed_mon'), method: 'update_watch', args: [plain(target(a.target)), plain(patch)] }],
        notes: [`Now: every ${w.settings.every_min} min at ${fmt(w.price_per_check_e8s, ICP_T)} a check${tier ? `; then every ${tier.every_min} min at about ${fmt(tier.per_check_e8s, ICP_T)} a check (${fmt(tier.daily_price_e8s, ICP_T)} a day)` : ''}.`],
        problems,
        _patch: patch,
      };
    },
    async run(a, ctx, plan) {
      const r = unwrapResult(await (await mon(ctx)).update_watch(target(a.target), plan._patch), 'update_watch');
      return { ok: true, summary: `${targetText(a.target)}: ${r}`, links: [link('/notifications')] };
    },
  },
  {
    name: 'mon_set_nns_neurons',
    title: 'Sneed Monitor: my NNS neurons',
    description: 'Set the NNS neuron ids Sneed Monitor checks for you when it watches the NNS (sneed_mon.set_nns_neurons; replaces the list, [] clears it). Neuron ids are public; they need not be yours, but alerts are about whether those neurons have voted.',
    inputSchema: { neuron_ids: z.array(z.string().regex(/^\d+$/)).max(100).describe('NNS neuron ids (numbers as text)') },
    async build({ neuron_ids }, ctx) {
      const m = await mon(ctx);
      const [cur, cfg] = await Promise.all([m.get_my_nns_neurons(), m.get_config()]);
      const ids = [...new Set(neuron_ids)];
      const max = Number(cfg.tuning.max_nns_neurons);
      return {
        summary: ids.length ? `Register ${ids.length} NNS neuron(s) with Sneed Monitor` : 'Clear your NNS neurons in Sneed Monitor',
        calls: [{ canister: canisterId('sneed_mon'), method: 'set_nns_neurons', args: [ids] }],
        notes: [`Now: ${cur.length ? cur.map(String).join(', ') : 'none'}.`],
        problems: ids.length > max ? [`At most ${max} neurons.`] : [],
      };
    },
    async run({ neuron_ids }, ctx) {
      const r = unwrapResult(await (await mon(ctx)).set_nns_neurons([...new Set(neuron_ids)].map((x) => BigInt(x))), 'set_nns_neurons');
      return { ok: true, summary: String(r), links: [link('/notifications')] };
    },
  },
  {
    name: 'mon_auto_top_up',
    title: 'Sneed Monitor: auto top-up',
    description: 'Let Sneed Monitor top up your balance from your ICP account, as Sneed Hub does: icrc2_approve on the ICP ledger for sneed_mon (the allowance is the total cap, plus one fee per pull, for `days`), then set_auto_top_up(amount, when_below). off: set_auto_top_up(null), then the allowance back to 0. Each approval costs one ICP ledger fee; the whole allowance counts toward the daily ICP cap because it can leave your account.',
    inputSchema: {
      off: z.boolean().optional().describe('Turn auto top-up off and withdraw the allowance'),
      amount_icp: z.string().optional().describe('Each top-up (at least 10 ledger fees)'),
      when_below_icp: z.string().optional().describe('Top up when the balance falls below this (default 0)'),
      cap_icp: z.string().optional().describe('Total allowance across all top-ups (default 0.5: the allowance counts toward the daily ICP cap, 1 by default)'),
      days: z.number().int().min(1).max(3650).optional().describe('How long the allowance lasts (default 90)'),
      from_subaccount: z.string().optional().describe('Pay from this subaccount of yours (64 hex characters; default main)'),
    },
    destructive: true,
    async build(a, ctx) {
      const m = await mon(ctx);
      const bal = await m.get_my_balance();
      const at = bal.auto_top_up;
      const cur = opt(at.settings);
      const fee = await ledgerFee(CANISTERS.icp_ledger);
      const spender = { owner: at.spender.owner.toText(), subaccount: opt(at.spender.subaccount) ? [toHex(opt(at.spender.subaccount))] : [] };
      const problems = [];
      const calls = [];
      const spends = [];
      if (a.off) {
        const sub = cur && opt(cur.from_subaccount) ? Uint8Array.from(opt(cur.from_subaccount)) : null;
        if (!cur) problems.push('Auto top-up is off already.');
        calls.push({ canister: canisterId('sneed_mon'), method: 'set_auto_top_up', args: [[]] });
        calls.push({ canister: CANISTERS.icp_ledger, method: 'icrc2_approve', args: { spender, amount: 0n, from_subaccount: sub ? [toHex(sub)] : [], expires_at: [] }, note: 'withdraw the allowance (one ledger fee)' });
        spends.push(await spend(CANISTERS.icp_ledger, fee, 'approval fee (allowance back to 0)', 'ICP ledger'));
        problems.push(...await balanceProblems(ctx, spends));
        return { summary: 'Turn Sneed Monitor auto top-up off', calls, spends, problems, _sub: sub };
      }
      if (!a.amount_icp) throw new Error('Give amount_icp (or off: true).');
      const amount = (await toBaseUnits(CANISTERS.icp_ledger, a.amount_icp)).amount;
      const below = a.when_below_icp ? (await toBaseUnits(CANISTERS.icp_ledger, a.when_below_icp)).amount : 0n;
      const cap = (await toBaseUnits(CANISTERS.icp_ledger, a.cap_icp ?? '0.5')).amount;
      const days = a.days ?? 90;
      const sub = a.from_subaccount ? fromHex(a.from_subaccount) : null;
      if (sub && sub.length !== 32) problems.push('from_subaccount is 32 bytes (64 hex characters).');
      if (amount < BigInt(at.min_amount_e8s)) problems.push(`Each top-up is at least ${fmt(at.min_amount_e8s, ICP_T)}.`);
      if (amount > BigInt(at.max_amount_e8s)) problems.push(`Each top-up is at most ${fmt(at.max_amount_e8s, ICP_T)}.`);
      if (cap < amount) problems.push('cap_icp must cover at least one top-up.');
      // each pull uses amount + one ledger fee of the allowance (allowAuto)
      const pulls = amount > 0n ? (cap + amount - 1n) / amount : 0n;
      const allowance = cap + pulls * fee;
      calls.push({ canister: CANISTERS.icp_ledger, method: 'icrc2_approve', args: { spender, amount: allowance, from_subaccount: sub ? [toHex(sub)] : [], expires_at: [`<now + ${days} d, ns>`] }, note: `allowance for sneed_mon: ${fmt(cap, ICP_T)} + ${pulls} pull fee(s)` });
      calls.push({ canister: canisterId('sneed_mon'), method: 'set_auto_top_up', args: [[{ amount_e8s: amount, when_below_e8s: below, from_subaccount: sub ? [toHex(sub)] : [] }]] });
      const feeSpend = await spend(CANISTERS.icp_ledger, fee, 'approval fee', 'ICP ledger');
      spends.push(feeSpend, await spend(CANISTERS.icp_ledger, allowance, `allowance sneed_mon may pull over ${days} day(s)`, 'sneed_mon (auto top-up)'));
      // only the fee leaves now; the allowance is pulled later, from the chosen account
      if (!sub) problems.push(...await balanceProblems(ctx, [feeSpend]));
      return {
        summary: `Auto top-up: ${fmt(amount, ICP_T)} whenever your Sneed Monitor balance falls below ${fmt(below, ICP_T)}, up to ${fmt(cap, ICP_T)} in all for ${days} day(s)`,
        calls, spends, problems,
        notes: [cur ? `Replaces: ${fmt(cur.amount_e8s, ICP_T)} below ${fmt(cur.when_below_e8s, ICP_T)}.` : 'Auto top-up is off now.', 'The allowance replaces any earlier one for sneed_mon from that account.'],
        _amount: amount, _below: below, _allowance: allowance, _days: days, _sub: sub,
      };
    },
    async run(a, ctx, plan) {
      const m = await mon(ctx);
      const icp = await ctx.signed(icrc1Idl, CANISTERS.icp_ledger);
      const bal = await m.get_my_balance();
      const spender = bal.auto_top_up.spender;
      const steps = [];
      const approve = async (amount, expires) => {
        const r = await icp.icrc2_approve({ from_subaccount: plan._sub ? [plan._sub] : [], spender, amount, expected_allowance: [], expires_at: expires ? [expires] : [], fee: [], memo: [], created_at_time: [] });
        if ('Err' in r) throw new Error(`the ledger refused the approval: ${JSON.stringify(plain(r.Err))}`);
        return r.Ok;
      };
      if (a.off) {
        unwrapResult(await m.set_auto_top_up([]), 'set_auto_top_up');
        steps.push('auto top-up off');
        try { steps.push(`allowance withdrawn (ICP block ${await approve(0n, null)})`); } catch (e) {
          return { ok: false, spent: false, steps, error: e.message, recovery: 'Auto top-up is off, but sneed_mon still has the allowance (it no longer pulls). Withdraw it on Sneed Hub /notifications or try again.' };
        }
        return { ok: true, spent: true, summary: 'auto top-up off and the allowance withdrawn', steps, links: [link('/notifications')] };
      }
      const expires = (BigInt(Date.now()) + BigInt(plan._days) * 86_400_000n) * 1_000_000n;
      const block = await approve(plan._allowance, expires);
      steps.push(`allowance of ${fmt(plan._allowance, ICP_T)} for sneed_mon (ICP block ${block})`);
      try {
        unwrapResult(await m.set_auto_top_up([{ amount_e8s: plan._amount, when_below_e8s: plan._below, from_subaccount: plan._sub ? [plan._sub] : [] }]), 'set_auto_top_up');
      } catch (e) {
        return { ok: false, spent: true, steps, error: e.message, recovery: 'The allowance is set but auto top-up is not on: call mon_auto_top_up again, or with off: true to withdraw the allowance.' };
      }
      steps.push('auto top-up on');
      return { ok: true, spent: true, summary: 'auto top-up on', steps, links: [link('/notifications')] };
    },
  },
];

const watchesNote = (bal) => (Number(bal.watches) > 0 ? `You still watch ${bal.watches} place(s); checks stop when the balance runs out.` : '');

export const registerMonWrites = (server) => monWrites.forEach((w) => defineWrite(server, w));
