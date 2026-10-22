// Sneed Lock wallet as a hosted pocket: { sneed_lock; principalToSubAccount(me) }. Locked tokens
// stay in it; what can leave is balance - locked - fee (as utils/sendPlan.js computes today).
import { principalToSubaccount, toOpt } from '../subaccount.js';
import { big, feeOf, ledgerBalance, minus, once, principal, text, transferFromWallet, unwrapResult } from './common.js';

const lockAccount = (ctx) => ({ owner: ctx.canisterIds.sneed_lock, subaccount: principalToSubaccount(ctx.me) });

/// Map<ledger text, locked amount> from get_summed_locks (once per refresh).
const summedLocks = (ctx) => once(ctx, 'sneed_lock:summed', async () => {
    const list = await ctx.actor('sneed_lock', ctx.canisterIds.sneed_lock).get_summed_locks();
    return new Map(list.map(([ledger, amount]) => [text(ledger), big(amount)]));
});

export const sneedLockAdapter = {
    id: 'sneed_lock',
    name: 'Sneed Lock',
    kind: 'hosted',
    receivesDirectly: true,
    enabled: (ctx) => Boolean(ctx.canisterIds?.sneed_lock),
    async listMyAccounts(ctx) {
        return [{ hostKey: 'wallet', account: lockAccount(ctx), label: 'Sneed Lock wallet' }];
    },
    async balance(ctx, pocket, ledger) {
        const [total, locks] = await Promise.all([ledgerBalance(ctx, ledger, lockAccount(ctx)), summedLocks(ctx)]);
        const locked = locks.get(text(ledger)) || 0n;
        return { total, available: minus(total, locked), locked, ...(locked > 0n ? { note: 'locked tokens stay until their locks expire' } : {}) };
    },
    async rules(ctx, pocket, ledger) {
        const [b, fee] = await Promise.all([sneedLockAdapter.balance(ctx, pocket, ledger), feeOf(ctx, ledger)]);
        const withdrawable = minus(b.available, fee);
        return { withdrawable, fee, why: b.locked > 0n ? `${b.locked} is locked` : null };
    },
    /// A plain transfer into the Sneed Lock wallet from a wallet pocket.
    async deposit(ctx, pocket, ledger, amount, fromSubaccount) {
        return transferFromWallet(ctx, ledger, fromSubaccount, lockAccount(ctx), amount, await feeOf(ctx, ledger));
    },
    /// sneed_lock.transfer_tokens: `amount` arrives at `to`, the fee comes out of the Sneed Lock wallet.
    async withdraw(ctx, pocket, ledger, amount, to) {
        const r = await ctx.actor('sneed_lock', ctx.canisterIds.sneed_lock).transfer_tokens(to.owner, toOpt(to.subaccount), principal(ledger), big(amount));
        return unwrapResult(r, 'Sneed Lock refused the withdrawal');
    },
};
