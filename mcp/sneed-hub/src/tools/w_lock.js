// Write tools for Sneed Lock after a lock exists: withdraw free tokens from your Sneed Lock wallet
// (the wallet's Sneed Lock pocket: utils/pockets/adapters/sneed_lock.js -> transfer_tokens), change a
// lock's time (components/LockDissolvePanel.jsx: start_dissolving, stop_dissolving,
// increase_dissolve_delay, extend_lock), and withdraw the ICP lock-fee deposit
// (withdraw_payment_balance; no Sneed Hub button yet).
import { z } from 'zod';
import { idlFactory as lockIdl } from '../idl/sneed_lock.did.js';
import { idlFactory as icrc1Idl } from '../idl/icrc1_ledger.did.js';
import { CANISTERS, opt, toPrincipal } from '../ic.js';
import { defineWrite } from '../writes.js';
import { ledgerFee, fmt, link, principalSubaccount, toHex, toBaseUnits } from '../chain.js';
import { tokenInfo, plain, nsDuration } from '../format.js';

const ICP_T = { decimals: 8, symbol: 'ICP' };
const nowNs = () => BigInt(Date.now()) * 1_000_000n;
const lockErr = (e) => {
  if ('NotOwner' in e) return 'only the lock\'s owner can change it';
  if ('NotFound' in e) return 'no such lock';
  if ('InProgress' in e) return 'a transfer of this lock is in progress; try again in a moment';
  if ('Invalid' in e) return e.Invalid;
  return JSON.stringify(plain(e));
};
const isoNs = (ns) => new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();

/// Locked amount of `ledger` in the caller's Sneed Lock wallet: unexpired token locks only, as
/// transfer_tokens counts them after clearing expired ones (get_summed_locks still counts those).
export const lockedNow = (tokenLocks, ledger, now = nowNs()) =>
  tokenLocks.filter(([, l, , expiry]) => l.toText() === ledger && BigInt(expiry) > now).reduce((s, [, , amount]) => s + BigInt(amount), 0n);

/// What transfer_tokens lets leave now: balance - locked - one ledger fee (it pays the fee itself).
export const lockWalletFree = ({ balance, locked, fee }) => (BigInt(balance) > BigInt(locked) + BigInt(fee) ? BigInt(balance) - BigInt(locked) - BigInt(fee) : 0n);

const withdrawBuild = async ({ ledger, amount }, ctx) => {
  const lockId = CANISTERS.sneed_lock;
  const me = toPrincipal(ctx.principal);
  const ledgerId = toPrincipal(ledger, 'ledger').toText();
  const t = await tokenInfo(ledgerId);
  const fee = await ledgerFee(ledgerId);
  const [balance, locks] = await Promise.all([
    (await ctx.anon(icrc1Idl, ledgerId)).icrc1_balance_of({ owner: toPrincipal(lockId), subaccount: [principalSubaccount(me)] }),
    (await ctx.signed(lockIdl, lockId)).get_token_locks(),
  ]);
  const locked = lockedNow(locks, ledgerId);
  const free = lockWalletFree({ balance, locked, fee });
  const want = amount ? (await toBaseUnits(ledgerId, amount)).amount : free;
  const problems = [];
  if (free <= 0n) problems.push(`Nothing can be withdrawn: your Sneed Lock wallet holds ${fmt(balance, t)} of it, ${fmt(locked, t)} locked, and the ledger fee is ${fmt(fee, t)}.`);
  else if (want <= 0n) problems.push('Amount must be positive.');
  else if (want > free) problems.push(`At most ${fmt(free, t)} can be withdrawn now (${fmt(locked, t)} is locked; the ${fmt(fee, t)} fee comes out of the Sneed Lock wallet).`);
  return {
    summary: `Withdraw ${fmt(want, t)} from your Sneed Lock wallet to your main account`,
    calls: [{ canister: lockId, method: 'transfer_tokens', args: [ctx.principal, [], ledgerId, want], note: 'from your Sneed Lock wallet subaccount' }],
    notes: [`Sneed Lock wallet: ${fmt(balance, t)}, locked ${fmt(locked, t)}; the ledger fee of ${fmt(fee, t)} is paid from the Sneed Lock wallet, and ${fmt(want, t)} arrives at your main account.`],
    problems,
    _want: want,
  };
};

const withdrawRun = async ({ ledger }, ctx, plan) => {
  const lock = await ctx.signed(lockIdl, CANISTERS.sneed_lock);
  const r = await lock.transfer_tokens(toPrincipal(ctx.principal), [], toPrincipal(ledger), plan._want);
  if ('Err' in r) return { ok: false, error: `transfer_tokens: ${JSON.stringify(plain(r.Err))}` };
  return { ok: true, summary: `withdrew ${plan._want} base units from your Sneed Lock wallet (ledger block ${r.Ok})`, links: [link('/wallet')] };
};

export const LOCK_CHANGES = {
  start_dissolving: 'start_dissolving',
  stop_dissolving: 'stop_dissolving',
  increase_dissolve_delay: 'increase_dissolve_delay',
  extend_lock: 'extend_lock',
};

/// The panel's rules (LockDissolvePanel canStart/canStop/canIncrease/canExtend) as problems.
export const lockChangeProblems = (st, me, action, { addNs = 0n, newEndNs = 0n, now = nowNs(), maxNs = null } = {}) => {
  const p = [];
  if (st.owner.toText() !== me) p.push(`Lock ${st.lock_id} is ${st.owner.toText()}'s, not yours (${me}).`);
  if (!st.locked) p.push('The lock is no longer locked.');
  const delay = BigInt(st.dissolve_delay);
  const dissolving = st.dissolving_until.length > 0;
  const periodOver = BigInt(st.lock_end) <= now;
  if (action === 'start_dissolving') {
    if (delay === 0n) p.push('This lock has no dissolve delay (it unlocks at the end of its lock period).');
    else if (dissolving) p.push('It is dissolving already.');
    else if (!periodOver) p.push(`Dissolving can start when the lock period ends (${isoNs(st.lock_end)}).`);
  }
  if (action === 'stop_dissolving' && !dissolving) p.push('It is not dissolving.');
  if (action === 'increase_dissolve_delay' && addNs <= 0n) p.push('Give add_hours above 0.');
  if (action === 'extend_lock') {
    if (dissolving) p.push('Stop dissolving first: a dissolving lock\'s period cannot be extended.');
    if (newEndNs <= BigInt(st.lock_end)) p.push(`The new end must be after the current end of the lock period (${isoNs(st.lock_end)}).`);
    else if (maxNs != null && newEndNs - now > BigInt(maxNs)) p.push(`Longer than the maximum lock (${nsDuration(maxNs)} from now).`);
  }
  return p;
};

const changeBuild = async ({ lock_id, action, add_hours, new_lock_end }, ctx) => {
  const lock = await ctx.anon(lockIdl, CANISTERS.sneed_lock);
  const [stOpt, limits] = await Promise.all([lock.get_lock_state(BigInt(lock_id)), lock.get_lock_limits()]);
  const st = opt(stOpt);
  if (!st) throw new Error(`No lock ${lock_id}.`);
  const addNs = add_hours ? BigInt(Math.round(add_hours * 3600)) * 1_000_000_000n : 0n;
  let newEndNs = 0n;
  if (action === 'extend_lock') {
    const ms = Date.parse(new_lock_end ?? '');
    if (!Number.isFinite(ms)) throw new Error('extend_lock needs new_lock_end, a date and time such as "2027-01-31T12:00:00Z".');
    newEndNs = BigInt(ms) * 1_000_000n;
  }
  const problems = lockChangeProblems(st, ctx.principal, action, { addNs, newEndNs, maxNs: limits.max_lock_length_ns });
  const args = action === 'increase_dissolve_delay' ? [lock_id, addNs] : action === 'extend_lock' ? [lock_id, newEndNs] : [lock_id];
  const delay = BigInt(st.dissolve_delay);
  const what = {
    start_dissolving: `Start dissolving lock ${lock_id}: it unlocks in ${nsDuration(delay)}`,
    stop_dissolving: `Stop dissolving lock ${lock_id} (the time left becomes its delay again)`,
    increase_dissolve_delay: `Add ${add_hours ?? 0} hour(s) to the dissolve delay of lock ${lock_id} (now ${delay > 0n ? nsDuration(delay) : 'none'})`,
    extend_lock: `Extend the lock period of lock ${lock_id} from ${isoNs(st.lock_end)} to ${newEndNs ? isoNs(newEndNs) : '?'}`,
  }[action];
  return {
    summary: what,
    calls: [{ canister: CANISTERS.sneed_lock, method: LOCK_CHANGES[action], args }],
    notes: ['A dissolve delay can only grow and a lock period only get longer; neither can be undone. Locks are public.'],
    problems,
    _args: args,
  };
};

const changeRun = async ({ action }, ctx, plan) => {
  const lock = await ctx.signed(lockIdl, CANISTERS.sneed_lock);
  const [id, x] = plan._args;
  const r = await lock[LOCK_CHANGES[action]](BigInt(id), ...(x != null ? [BigInt(x)] : []));
  if ('Err' in r) return { ok: false, error: `${LOCK_CHANGES[action]}: ${lockErr(r.Err)}` };
  const s = r.Ok;
  const parts = [`lock period ends ${isoNs(s.lock_end)}`, `dissolve delay ${BigInt(s.dissolve_delay) > 0n ? nsDuration(s.dissolve_delay) : 'none'}`];
  if (s.dissolving_until.length) parts.push(`dissolving until ${isoNs(s.dissolving_until[0])}`);
  return { ok: true, summary: `lock ${id}: ${parts.join(', ')}`, links: [link(`/lock/${id}`)] };
};

const feeDepositBuild = async (args, ctx) => {
  const lockId = CANISTERS.sneed_lock;
  const me = toPrincipal(ctx.principal);
  const lock = await ctx.anon(lockIdl, lockId);
  const sub = await lock.getPaymentSubaccount(me);
  const bal = await (await ctx.anon(icrc1Idl, CANISTERS.icp_ledger)).icrc1_balance_of({ owner: toPrincipal(lockId), subaccount: [sub] });
  const fee = await ledgerFee(CANISTERS.icp_ledger);
  // for ~1/256 of principals the payment subaccount is their Sneed Lock wallet: locked ICP stays
  let locked = 0n;
  if (toHex(sub) === toHex(principalSubaccount(me))) locked = lockedNow(await (await ctx.signed(lockIdl, lockId)).get_token_locks(), CANISTERS.icp_ledger);
  const free = bal > locked ? bal - locked : 0n;
  return {
    summary: `Withdraw your Sneed Lock fee deposit (${fmt(bal, ICP_T)})`,
    calls: [{ canister: lockId, method: 'withdraw_payment_balance', args: [] }],
    notes: free > fee ? [`You get ${fmt(free - fee, ICP_T)} (the deposit${locked ? ` less ${fmt(locked, ICP_T)} locked` : ''} less one ledger fee) at your main account. Not on Sneed Hub yet.`] : [],
    problems: free > fee ? [] : [`Nothing to withdraw: the fee deposit holds ${fmt(bal, ICP_T)}${locked ? ` (${fmt(locked, ICP_T)} locked)` : ''}, not above the ${fmt(fee, ICP_T)} ledger fee.`],
  };
};

export const lockWrites = [
  {
    name: 'sneed_lock_withdraw',
    title: 'Sneed Lock: withdraw free tokens',
    description: 'Move tokens that are not (or no longer) locked out of your Sneed Lock wallet subaccount to your main account (sneed_lock.transfer_tokens, as the wallet\'s Sneed Lock pocket does; the ledger fee comes out of the Sneed Lock wallet). amount defaults to everything free. Expired locks are cleared by the call itself.',
    inputSchema: {
      ledger: z.string().describe('Token ledger canister id'),
      amount: z.string().optional().describe('Whole tokens (default: all that is free)'),
    },
    build: withdrawBuild,
    run: withdrawRun,
  },
  {
    name: 'sneed_lock_change',
    title: 'Sneed Lock: dissolve, extend or add to a lock\'s delay',
    description: 'Change the time of one of your locks, as the lock page\'s dissolve panel does: start_dissolving (after its lock period, for a lock with a dissolve delay), stop_dissolving, increase_dissolve_delay (add_hours; a lock without a delay gets one), extend_lock (new_lock_end, not while dissolving). Delays only grow and periods only get longer.',
    inputSchema: {
      lock_id: z.number().int().min(0).describe('Lock id'),
      action: z.enum(Object.keys(LOCK_CHANGES)).describe('What to change'),
      add_hours: z.number().positive().max(10 * 365 * 24).optional().describe('increase_dissolve_delay: hours to add'),
      new_lock_end: z.string().optional().describe('extend_lock: the new end of the lock period (ISO date and time, e.g. 2027-01-31T12:00:00Z)'),
    },
    destructive: true,
    build: changeBuild,
    run: changeRun,
  },
  {
    name: 'sneed_lock_withdraw_fee_deposit',
    title: 'Sneed Lock: withdraw the lock-fee deposit',
    description: 'Take back the ICP in your Sneed Lock fee deposit (the payment subaccount that pays lock fees): sneed_lock.withdraw_payment_balance sends it less one ledger fee to your main account.',
    inputSchema: {},
    build: feeDepositBuild,
    async run(args, ctx) {
      const r = await (await ctx.signed(lockIdl, CANISTERS.sneed_lock)).withdraw_payment_balance();
      if ('Err' in r) return { ok: false, error: `withdraw_payment_balance: ${r.Err}` };
      return { ok: true, summary: `withdrew ${fmt(r.Ok.amount, ICP_T)} from your Sneed Lock fee deposit (ICP block ${r.Ok.icp_tx})`, links: [link('/sneedlock')] };
    },
  },
];

export const registerLockWrites = (server) => lockWrites.forEach((w) => defineWrite(server, w));
