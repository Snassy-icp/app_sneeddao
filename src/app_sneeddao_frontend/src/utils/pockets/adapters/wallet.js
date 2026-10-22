// The built-in wallet adapter: pockets are subaccounts of the user's own principal. Listing comes
// from the registry and discovery (discovery.js), not from here.
import { feeOf, ledgerBalance, minus, transferFromWallet, approveFromWallet } from './common.js';

export const walletAdapter = {
    id: 'wallet',
    name: 'Wallet',
    kind: 'wallet',
    receivesDirectly: true,
    async listMyAccounts() { return []; },
    async balance(ctx, pocket, ledger) {
        const t = await ledgerBalance(ctx, ledger, pocket.account);
        return { total: t, available: t };
    },
    async rules(ctx, pocket, ledger) {
        const [b, fee] = await Promise.all([ledgerBalance(ctx, ledger, pocket.account), feeOf(ctx, ledger)]);
        return { withdrawable: minus(b, fee), fee };
    },
    /// icrc1_transfer of `amount` from this pocket to `to` (the pocket pays the fee).
    async send(ctx, pocket, ledger, amount, to) {
        return transferFromWallet(ctx, ledger, pocket.account.subaccount, to, amount, await feeOf(ctx, ledger));
    },
    async withdraw(ctx, pocket, ledger, amount, to) { return walletAdapter.send(ctx, pocket, ledger, amount, to); },
    /// icrc2_approve from this pocket (the approvals module lists and revokes; §4.4).
    async approve(ctx, pocket, ledger, spender, amount, opts) {
        return approveFromWallet(ctx, ledger, pocket.account.subaccount, spender, amount, opts);
    },
};
