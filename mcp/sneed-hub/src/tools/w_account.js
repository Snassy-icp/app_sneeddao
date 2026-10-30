// Write tools: Sneed Premium (pages/Premium.jsx: pay a tier's ICP into your deposit subaccount, then
// purchaseWithIcp; claimWithVotingPower; withdrawDeposit), Sneed Notifications quiet hours and per-app
// settings (pages/Notifications.jsx: set_settings, set_permission), and the gated plain transfer
// wallet_send (only registered with SNEED_MCP_ALLOW_TRANSFERS=1).
import { z } from 'zod';
import { idlFactory as premiumIdl } from '../idl/sneed_premium.did.js';
import { idlFactory as notifIdl } from '../idl/sneed_notifications.did.js';
import { idlFactory as icrc1Idl } from '../idl/icrc1_ledger.did.js';
import { CANISTERS, opt, toPrincipal } from '../ic.js';
import { defineWrite, unwrapResult } from '../writes.js';
import { spend, toBaseUnits, ledgerFee, fmt, link, toHex, fromHex, balanceProblems, acct } from '../chain.js';
import { tokenInfo, plain, nsDuration, shortErr } from '../format.js';

const ICP_T = { decimals: 8, symbol: 'ICP' };
const variantErr = (e) => { const k = Object.keys(e)[0]; const v = e[k]; return v == null ? k : `${k}: ${typeof v === 'object' ? JSON.stringify(plain(v)) : v}`; };
const nsIso = (ns) => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();

// ---------------- Premium ----------------

/// The ICP tiers at the signer's prices (get_icp_tier_prices_for; an older canister: getIcpTiers).
const tiersFor = async (p, principal) => {
  try {
    const prices = await p.get_icp_tier_prices_for(toPrincipal(principal));
    return prices.map((x) => ({ ...x.tier, price: BigInt(x.price_e8s), priceTier: Object.keys(x.price_tier)[0] }));
  } catch {
    return (await p.getIcpTiers()).map((t) => ({ ...t, price: BigInt(t.amountE8s), priceTier: 'regular' }));
  }
};

/// What to send so the deposit subaccount holds exactly the tier's price (purchaseWithIcp matches
/// the whole deposit to a tier). { send } or { problem }.
export const premiumTopUp = (deposit, price) => {
  if (deposit === price) return { send: 0n };
  if (deposit < price) return { send: price - deposit };
  return { problem: `Your Premium deposit already holds ${fmt(deposit, ICP_T)}, more than this tier's ${fmt(price, ICP_T)}, so no tier would match. Withdraw it first with premium_withdraw_deposit.` };
};

const premiumBuy = {
  name: 'premium_buy',
  title: 'Sneed Premium: buy or extend membership with ICP',
  description: 'Buy (or extend) Sneed Premium with ICP, as the Premium page does: an ICP transfer of the tier\'s price (your price: admin/partner prices applied) into your Premium deposit subaccount, then sneed_premium.purchaseWithIcp. If the deposit already holds part of the price, only the rest is sent. Counts toward the daily ICP cap.',
  inputSchema: { tier: z.string().describe('Tier name (e.g. "1 Month Pass") or its number in premium_status\'s list, starting at 1') },
  async build({ tier }, ctx) {
    const p = await ctx.anon(premiumIdl, CANISTERS.sneed_premium);
    const [tiers, dep, status] = await Promise.all([tiersFor(p, ctx.principal), p.getDepositAccount(toPrincipal(ctx.principal)), p.checkMembership(toPrincipal(ctx.principal))]);
    const active = tiers.filter((t) => t.active);
    const t = /^\d+$/.test(tier.trim()) ? active[Number(tier) - 1] : active.find((x) => x.name.toLowerCase() === tier.trim().toLowerCase());
    if (!t) throw new Error(`No active tier "${tier}". Tiers: ${active.map((x, i) => `${i + 1}. ${x.name} (${fmt(x.price, ICP_T)}, ${nsDuration(x.durationNs)})`).join('; ')}`);
    const deposit = await (await ctx.anon(icrc1Idl, CANISTERS.icp_ledger)).icrc1_balance_of(dep);
    const fee = await ledgerFee(CANISTERS.icp_ledger);
    const top = premiumTopUp(deposit, t.price);
    const problems = top.problem ? [top.problem] : [];
    const calls = [];
    const spends = [];
    if (top.send > 0n) {
      calls.push({ canister: CANISTERS.icp_ledger, method: 'icrc1_transfer', args: { to: { owner: dep.owner.toText(), subaccount: opt(dep.subaccount) ? [toHex(opt(dep.subaccount))] : [] }, amount: top.send, fee: [], memo: [], from_subaccount: [], created_at_time: [] }, note: 'into your Premium deposit subaccount' });
      spends.push(await spend(CANISTERS.icp_ledger, top.send + fee, `Premium "${t.name}" + ledger fee`, 'Sneed Premium deposit'));
      problems.push(...await balanceProblems(ctx, spends));
    }
    calls.push({ canister: CANISTERS.sneed_premium, method: 'purchaseWithIcp', args: [] });
    const until = 'Active' in status ? ` Your membership runs until ${nsIso(status.Active.expiration)}; this extends it by ${nsDuration(t.durationNs)}.` : '';
    return {
      summary: `Sneed Premium "${t.name}" for ${fmt(t.price, ICP_T)}${t.priceTier !== 'regular' ? ` (${t.priceTier} price)` : ''}: ${nsDuration(t.durationNs)}`,
      calls, spends, problems,
      notes: [`${deposit > 0n ? `Your deposit holds ${fmt(deposit, ICP_T)} already. ` : ''}The payment goes to the DAO.${until}`, 'Membership is public.'],
      _dep: dep, _send: top.send,
    };
  },
  async run(a, ctx, plan) {
    const steps = [];
    let spent = false;
    if (plan._send > 0n) {
      const tr = await (await ctx.signed(icrc1Idl, CANISTERS.icp_ledger)).icrc1_transfer({ to: plan._dep, amount: plan._send, fee: [], memo: [], from_subaccount: [], created_at_time: [] });
      if ('Err' in tr) return { ok: false, error: `transfer refused, nothing sent: ${JSON.stringify(plain(tr.Err))}` };
      spent = true;
      steps.push(`paid into your Premium deposit (ICP block ${tr.Ok})`);
    }
    const p = await ctx.signed(premiumIdl, CANISTERS.sneed_premium);
    let r;
    try { r = await p.purchaseWithIcp(); } catch (e) {
      return { ok: false, spent, steps, error: shortErr(e), recovery: 'The ICP is in your Premium deposit: call premium_buy again with the same tier (nothing more is sent), or premium_withdraw_deposit.' };
    }
    if ('err' in r) return { ok: false, spent, steps, error: `purchaseWithIcp: ${variantErr(r.err)}`, recovery: 'The ICP stays in your Premium deposit: premium_buy again, or premium_withdraw_deposit.' };
    steps.push(`member until ${nsIso(r.ok.expiration)}`);
    return { ok: true, spent, summary: `Sneed Premium until ${nsIso(r.ok.expiration)}`, steps, links: [link('/premium')] };
  },
};

const premiumWrites = [
  premiumBuy,
  {
    name: 'premium_claim_vp',
    title: 'Sneed Premium: claim with voting power',
    description: 'Claim Sneed Premium for free with the voting power of your SNEED neurons (sneed_premium.claimWithVotingPower), as the Premium page does. The neurons must list the signer (e.g. as hotkey); a claim can be repeated only after the tier\'s interval.',
    inputSchema: {},
    async build(a, ctx) {
      const p = await ctx.anon(premiumIdl, CANISTERS.sneed_premium);
      const vp = (await p.getVotingPowerTiers()).filter((t) => t.active);
      return {
        summary: 'Claim Sneed Premium with your SNEED voting power',
        calls: [{ canister: CANISTERS.sneed_premium, method: 'claimWithVotingPower', args: [] }],
        notes: [vp.length ? `Tiers: ${vp.map((t) => `${t.name}: ${fmt(t.minVotingPowerE8s, { decimals: 8, symbol: 'VP' })} for ${nsDuration(t.durationNs)}`).join('; ')}. The canister reads your neurons' voting power.` : 'No voting-power tiers are active.'],
        problems: vp.length ? [] : ['No voting-power tiers are active.'],
      };
    },
    async run(a, ctx) {
      const r = await (await ctx.signed(premiumIdl, CANISTERS.sneed_premium)).claimWithVotingPower();
      if ('err' in r) return { ok: false, error: `claimWithVotingPower: ${variantErr(r.err)}` };
      return { ok: true, summary: `Sneed Premium until ${nsIso(r.ok.expiration)}`, links: [link('/premium')] };
    },
  },
  {
    name: 'premium_withdraw_deposit',
    title: 'Sneed Premium: withdraw my deposit',
    description: 'Take back ICP sitting in your Sneed Premium deposit subaccount (sneed_premium.withdrawDeposit: all of it less one ledger fee, to your main account), e.g. a payment that matched no tier.',
    inputSchema: {},
    async build(a, ctx) {
      const p = await ctx.anon(premiumIdl, CANISTERS.sneed_premium);
      const dep = await p.getDepositAccount(toPrincipal(ctx.principal));
      const bal = await (await ctx.anon(icrc1Idl, CANISTERS.icp_ledger)).icrc1_balance_of(dep);
      const fee = await ledgerFee(CANISTERS.icp_ledger);
      return {
        summary: `Withdraw your Sneed Premium deposit (${fmt(bal, ICP_T)})`,
        calls: [{ canister: CANISTERS.sneed_premium, method: 'withdrawDeposit', args: [] }],
        notes: bal > fee ? [`You get ${fmt(bal - fee, ICP_T)} at your main account.`] : [],
        problems: bal > fee ? [] : [`Nothing to withdraw: the deposit holds ${fmt(bal, ICP_T)}.`],
      };
    },
    async run(a, ctx) {
      const r = await (await ctx.signed(premiumIdl, CANISTERS.sneed_premium)).withdrawDeposit();
      if ('err' in r) return { ok: false, error: `withdrawDeposit: ${variantErr(r.err)}` };
      return { ok: true, summary: `withdrew ${fmt(r.ok.amountE8s, ICP_T)} (ICP block ${r.ok.blockIndex})`, links: [link('/premium')] };
    },
  },
];

// ---------------- Notifications ----------------

const hhmm = (text, what) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`${what} must be a time like 22:00.`);
  return BigInt(Number(m[1]) * 60 + Number(m[2]));
};


const notifWrites = [
  {
    name: 'notifications_set_quiet_hours',
    title: 'Sneed Notifications: quiet hours',
    description: 'Hold notifications during quiet hours (sneed_notifications.set_settings with your other settings unchanged), as the Notifications page does: from/to as HH:MM in your time zone (utc_offset_minutes, e.g. 60 for UTC+1), urgent_passes lets urgent ones through. off: true removes quiet hours. Sneed SMS copies arrive anyway; other channels wait.',
    inputSchema: {
      off: z.boolean().optional().describe('Remove quiet hours'),
      from: z.string().optional().describe('Start, HH:MM (default 22:00)'),
      to: z.string().optional().describe('End, HH:MM (default 07:00)'),
      utc_offset_minutes: z.number().int().min(-720).max(840).optional().describe('Your time zone as minutes from UTC, e.g. 60 for UTC+1 (needed unless off)'),
      urgent_passes: z.boolean().optional().describe('Let urgent notifications through (default true)'),
    },
    async build(a, ctx) {
      const n = await ctx.signed(notifIdl, CANISTERS.sneed_notifications);
      const s = (await n.get_my_settings()).settings;
      if (!a.off && a.utc_offset_minutes == null) throw new Error('Give utc_offset_minutes (your time zone as minutes from UTC), or off: true.');
      const quiet = a.off ? [] : [{ start_min: hhmm(a.from ?? '22:00', 'from'), end_min: hhmm(a.to ?? '07:00', 'to'), utc_offset_min: BigInt(a.utc_offset_minutes), urgent_passes: a.urgent_passes ?? true }];
      const next = { ...s, quiet };
      return {
        summary: a.off ? 'Remove quiet hours' : `Quiet hours ${a.from ?? '22:00'} to ${a.to ?? '07:00'} (UTC${a.utc_offset_minutes >= 0 ? '+' : ''}${a.utc_offset_minutes / 60})${quiet[0]?.urgent_passes ? ', urgent gets through' : ''}`,
        calls: [{ canister: CANISTERS.sneed_notifications, method: 'set_settings', args: plain(next) }],
        problems: a.off && !s.quiet.length ? ['You have no quiet hours.'] : [],
        _next: next,
      };
    },
    async run(a, ctx, plan) {
      const n = await ctx.signed(notifIdl, CANISTERS.sneed_notifications);
      return { ok: true, summary: String(unwrapResult(await n.set_settings(plan._next), 'set_settings')), links: [link('/notifications')] };
    },
  },
  {
    name: 'notifications_app_settings',
    title: 'Sneed Notifications: an app\'s settings',
    description: 'Change how an app you allowed may notify you (sneed_notifications.set_permission with the rest unchanged), as the Notifications page does: demote (everything one level down), copy_only (only to your copy channel), daily_cap (messages a day), daily_spend_cap_icp (what its messages may cost you a day), topics ({topic id: "default" | "urgent" | "normal" | "info" | "mute"}). Allow or block the app with notifications_allow_app.',
    inputSchema: {
      app_id: z.number().int().min(0).describe('App id (notifications_read)'),
      demote: z.boolean().optional(),
      copy_only: z.boolean().optional(),
      daily_cap: z.number().int().min(1).max(1000).optional(),
      daily_spend_cap_icp: z.string().optional(),
      topics: z.record(z.enum(['default', 'urgent', 'normal', 'info', 'mute'])).optional().describe('Per-topic rule by topic id'),
    },
    async build(a, ctx) {
      const n = await ctx.signed(notifIdl, CANISTERS.sneed_notifications);
      const mine = (await n.get_my_apps()).find(([app]) => BigInt(app.id) === BigInt(a.app_id));
      if (!mine) throw new Error(`App ${a.app_id} is not among your apps (allow it first with notifications_allow_app).`);
      const [app, p] = mine;
      const problems = [];
      let topics = p.topics;
      for (const [id, v] of Object.entries(a.topics ?? {})) {
        if (!app.topics.some((t) => t.id === id)) { problems.push(`${app.name} has no topic "${id}"; its topics: ${app.topics.map((t) => t.id).join(', ')}.`); continue; }
        topics = topics.filter(([t]) => t !== id);
        if (v !== 'default') topics = [...topics, [id, v === 'mute' ? { mute: null } : { level: { [v]: null } }]];
      }
      const next = {
        ...p,
        demote: a.demote ?? p.demote,
        copy_only: a.copy_only ?? p.copy_only,
        daily_cap: a.daily_cap != null ? BigInt(a.daily_cap) : p.daily_cap,
        daily_spend_cap_e8s: a.daily_spend_cap_icp != null ? (await toBaseUnits(CANISTERS.icp_ledger, a.daily_spend_cap_icp)).amount : p.daily_spend_cap_e8s,
        topics,
      };
      if (['demote', 'copy_only', 'daily_cap', 'daily_spend_cap_icp', 'topics'].every((k) => a[k] == null)) problems.push('Nothing to change.');
      return {
        summary: `Settings of ${app.name} (app ${a.app_id})`,
        calls: [{ canister: CANISTERS.sneed_notifications, method: 'set_permission', args: [a.app_id, plain(next)] }],
        problems,
        _next: next,
      };
    },
    async run(a, ctx, plan) {
      const n = await ctx.signed(notifIdl, CANISTERS.sneed_notifications);
      return { ok: true, summary: String(unwrapResult(await n.set_permission(BigInt(a.app_id), plan._next), 'set_permission')), links: [link('/notifications')] };
    },
  },
];

// ---------------- plain transfer (gated) ----------------

export const walletSend = {
  name: 'wallet_send',
  title: 'Wallet: send tokens',
  description: 'Send ICRC-1 tokens from your main account to any account (icrc1_transfer; you pay the ledger fee on top). A plain transfer: only available with SNEED_MCP_ALLOW_TRANSFERS=1, under the daily caps. Check the recipient carefully: transfers cannot be undone.',
  inputSchema: {
    ledger: z.string().describe(`Token ledger canister id (ICP ${CANISTERS.icp_ledger}, SNEED ${CANISTERS.sneed_ledger})`),
    to: z.string().describe('Recipient principal'),
    to_subaccount: z.string().optional().describe('Recipient subaccount, 64 hex characters'),
    amount: z.string().describe('Whole tokens'),
    memo: z.string().max(32).optional().describe('Optional memo text (up to 32 bytes)'),
  },
  destructive: true,
  async build({ ledger, to, to_subaccount, amount, memo }, ctx) {
    const ledgerId = toPrincipal(ledger, 'ledger').toText();
    const owner = toPrincipal(to, 'recipient principal').toText();
    const sub = to_subaccount ? fromHex(to_subaccount) : null;
    const problems = [];
    if (sub && sub.length !== 32) problems.push('to_subaccount is 32 bytes (64 hex characters).');
    if (memo && Buffer.byteLength(memo) > 32) problems.push('The memo is longer than 32 bytes.');
    const { amount: base, token } = await toBaseUnits(ledgerId, amount);
    if (base <= 0n) throw new Error('Amount must be positive.');
    const fee = await ledgerFee(ledgerId);
    if (owner === ctx.principal && !sub) problems.push('That is your own main account.');
    const spends = [await spend(ledgerId, base + fee, `send ${fmt(base, token)} + ledger fee`, acct(owner, sub), { arbitraryTransfer: true })];
    problems.push(...await balanceProblems(ctx, spends));
    return {
      summary: `Send ${fmt(base, token)} to ${acct(owner, sub)}`,
      calls: [{ canister: ledgerId, method: 'icrc1_transfer', args: { to: { owner, subaccount: sub ? [toHex(sub)] : [] }, amount: base, fee: [fee], memo: memo ? [memo] : [], from_subaccount: [], created_at_time: [] } }],
      spends, problems,
      notes: ['Transfers are final and public.'],
      _base: base, _fee: fee, _sub: sub,
    };
  },
  async run({ ledger, to, memo }, ctx, plan) {
    const l = await ctx.signed(icrc1Idl, toPrincipal(ledger));
    const tr = await l.icrc1_transfer({ to: { owner: toPrincipal(to), subaccount: plan._sub ? [plan._sub] : [] }, amount: plan._base, fee: [plan._fee], memo: memo ? [new TextEncoder().encode(memo)] : [], from_subaccount: [], created_at_time: [] });
    if ('Err' in tr) return { ok: false, error: `transfer refused, nothing sent: ${JSON.stringify(plain(tr.Err))}` };
    return { ok: true, spent: true, summary: `sent ${fmt(plan._base, await tokenInfo(ledger))} (ledger block ${tr.Ok})` };
  },
};

export const accountWrites = [...premiumWrites, ...notifWrites];

export const registerAccountWrites = (server, { allowTransfers = false } = {}) => {
  accountWrites.forEach((w) => defineWrite(server, w));
  if (allowTransfers) defineWrite(server, walletSend);
};

