// Sneed Monitor's prepaid ICP balance as a service balance. Deposit: a transfer to my deposit
// subaccount, then credit_deposit. Withdraw: withdraw_balance(amount, to): `to` receives the
// amount less the ledger fee, so to deliver X the balance gives X + fee.
import { big, feeOf, minus, text, transferFromWallet, unwrapResult } from './common.js';

const mon = (ctx) => ctx.actor('sneed_mon', ctx.canisterIds.sneed_mon);

export const sneedMonAdapter = {
    id: 'sneed_mon',
    name: 'Sneed Monitor',
    kind: 'service',
    enabled: (ctx) => Boolean(ctx.canisterIds?.sneed_mon),
    async listMyAccounts(ctx) {
        return [{ hostKey: 'balance', account: null, label: 'Sneed Monitor balance', ledgers: [text(ctx.canisterIds.icp_ledger)] }];
    },
    async balance(ctx, pocket, ledger) {
        if (text(ledger) !== text(ctx.canisterIds.icp_ledger)) return { total: 0n, available: 0n };
        const b = await mon(ctx).get_my_balance();
        return { total: big(b.balance_e8s), available: big(b.balance_e8s), ...(b.paused ? { note: 'monitoring is paused until the balance pays one round of checks' } : {}) };
    },
    async rules(ctx, pocket, ledger) {
        const [b, fee] = await Promise.all([sneedMonAdapter.balance(ctx, pocket, ledger), feeOf(ctx, ledger)]);
        return { withdrawable: minus(b.total, fee), fee, why: null };
    },
    async deposit(ctx, pocket, ledger, amount, fromSubaccount) {
        const m = mon(ctx);
        const to = await m.get_deposit_account();
        await transferFromWallet(ctx, ledger, fromSubaccount, { owner: to.owner, subaccount: to.subaccount }, amount, await feeOf(ctx, ledger));
        return unwrapResult(await m.credit_deposit(), 'Sneed Monitor could not credit the deposit');
    },
    async withdraw(ctx, pocket, ledger, amount, to) {
        const fee = await feeOf(ctx, ledger);
        const r = await mon(ctx).withdraw_balance(big(amount) + fee, { owner: to.owner, subaccount: to.subaccount ? [to.subaccount] : [] });
        return unwrapResult(r, 'Sneed Monitor refused the withdrawal');
    },
};
