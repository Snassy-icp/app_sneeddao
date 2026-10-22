// Sneed Notifications' message balance as a service balance: topped up with ICRC-2 (approve, then
// top_up), never withdrawn (spec/sneed_notifications.md). top_up pulls from the caller's default
// account only, so a top-up comes from Main.
import { big, feeOf, text, approveFromWallet, unwrapResult } from './common.js';
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
        return { total: big(s.balance_e8s), available: big(s.balance_e8s), note: 'service balance: pays for messages, cannot be withdrawn' };
    },
    async rules() { return { withdrawable: 0n, why: 'a service balance cannot be withdrawn' }; },
    async deposit(ctx, pocket, ledger, amount, fromSubaccount) {
        if (!isDefault(fromSubaccount)) throw new Error('Sneed Notifications tops up from Main only');
        const fee = await feeOf(ctx, ledger);
        await approveFromWallet(ctx, ledger, null, { owner: ctx.canisterIds.sneed_notifications, subaccount: null }, big(amount) + fee);
        return unwrapResult(await notif(ctx).top_up(big(amount)), 'Sneed Notifications refused the top-up');
    },
};
