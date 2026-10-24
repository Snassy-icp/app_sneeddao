// Sneed Notifications' message balance as a service balance: topped up with ICRC-2 (approve, then
// top_up), withdrawn with withdraw({ amount_e8s; to; created_at_time }) (spec/micropayments.md
// §3.3): `to` receives the amount less the ledger fee, so to deliver X the balance gives X + fee.
// top_up pulls from the caller's default account only, so a top-up comes from Main.
import { big, feeOf, minus, text, approveFromWallet, unwrapResult } from './common.js';
import { withdrawErrorText } from '../../notificationsWithdraw.js';
import { isDefault } from '../subaccount.js';

const notif = (ctx) => ctx.actor('sneed_notifications', ctx.canisterIds.sneed_notifications);

export const sneedNotificationsAdapter = {
    id: 'sneed_notifications',
    name: 'Sneed Notifications',
    kind: 'service',
    depositFrom: 'main',
    enabled: (ctx) => Boolean(ctx.canisterIds?.sneed_notifications),
    async listMyAccounts(ctx) {
        return [{ hostKey: 'balance', account: null, label: 'Sneed Notifications balance', ledgers: [text(ctx.canisterIds.icp_ledger)] }];
    },
    async balance(ctx, pocket, ledger) {
        if (text(ledger) !== text(ctx.canisterIds.icp_ledger)) return { total: 0n, available: 0n };
        const s = await notif(ctx).get_my_settings();
        return { total: big(s.balance_e8s), available: big(s.balance_e8s), note: 'service balance: pays for messages; withdraw what you don\'t use' };
    },
    async rules(ctx, pocket, ledger) {
        const [b, fee] = await Promise.all([sneedNotificationsAdapter.balance(ctx, pocket, ledger), feeOf(ctx, ledger)]);
        return { withdrawable: minus(b.total, fee), fee, why: null };
    },
    async deposit(ctx, pocket, ledger, amount, fromSubaccount) {
        if (!isDefault(fromSubaccount)) throw new Error('Sneed Notifications tops up from Main only');
        const fee = await feeOf(ctx, ledger);
        await approveFromWallet(ctx, ledger, null, { owner: ctx.canisterIds.sneed_notifications, subaccount: null }, big(amount) + fee);
        return unwrapResult(await notif(ctx).top_up(big(amount)), 'Sneed Notifications refused the top-up');
    },
    async withdraw(ctx, pocket, ledger, amount, to) {
        const fee = await feeOf(ctx, ledger);
        const r = await notif(ctx).withdraw({ amount_e8s: big(amount) + fee, to: { owner: to.owner, subaccount: to.subaccount ? [to.subaccount] : [] }, created_at_time: [] });
        if ('err' in r) throw new Error(`Sneed Notifications refused the withdrawal: ${withdrawErrorText(r.err)}`);
        return r.ok.ledger_block;
    },
};
