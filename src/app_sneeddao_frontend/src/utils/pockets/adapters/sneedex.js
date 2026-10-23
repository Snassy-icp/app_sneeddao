// Sneedex escrows as hosted pockets: the offer-creation payment subaccount (ICP) and the escrow
// subaccount of each of my bids (the offer's price token). Withdrawals always arrive at Main.
// The bid rules mirror withdrawBidEscrow: a won bid gives nothing until the seller is paid; a
// confirmed bid keeps its amount; the withdrawal pays one fee from the escrow.
import { big, feeOf, ledgerBalance, minus, once, text, transferFromWallet, unwrapResult } from './common.js';

const PAID_OUT = ['Refunded', 'ClaimedBySeller'];
const stateOf = (b) => Object.keys(b.state || {})[0];
const dex = (ctx) => ctx.actor('sneedex', ctx.canisterIds.sneedex);
const icp = (ctx) => text(ctx.canisterIds.icp_ledger);

const listing = (ctx) => once(ctx, 'sneedex:list', async () => {
    const d = dex(ctx);
    const [paySub, bids] = await Promise.all([d.getOfferCreationPaymentSubaccount(ctx.me), d.getBidsByBidderAll(ctx.me)]);
    const items = [{ hostKey: 'payment', account: { owner: ctx.canisterIds.sneedex, subaccount: paySub }, label: 'Sneedex offer payment', ledgers: [icp(ctx)], meta: { kind: 'payment', ledger: icp(ctx) } }];
    const offers = new Map();
    for (const b of bids) {
        const oid = b.offer_id.toString();
        if (!offers.has(oid)) offers.set(oid, d.queryOffer(b.offer_id).then((o) => (o.length ? o[0] : null)));
    }
    for (const b of bids) {
        const offer = await offers.get(b.offer_id.toString());
        if (!offer) continue;
        const sub = await d.getBidEscrowSubaccount(ctx.me, b.id);
        const ledger = text(offer.price_token_ledger);
        items.push({ hostKey: `bid:${b.id}`, account: { owner: ctx.canisterIds.sneedex, subaccount: sub }, label: `Sneedex bid ${b.id}`, ledgers: [ledger], meta: { kind: 'bid', bid: b, ledger } });
    }
    return items;
});

const itemOf = async (ctx, pocket) => (await listing(ctx)).find((i) => i.hostKey === pocket.hostKey);

/// The escrow's balance and what withdrawBidEscrow / withdrawOfferCreationPayment would give now.
async function escrowState(ctx, pocket, ledger) {
    const item = pocket.meta ? pocket : await itemOf(ctx, pocket);
    const meta = item?.meta;
    const [balance, fee] = await Promise.all([ledgerBalance(ctx, ledger, pocket.account), feeOf(ctx, ledger)]);
    if (!meta || meta.kind === 'payment') return { balance, fee, withdrawable: minus(balance, fee), allOnly: true, why: null };
    const b = meta.bid;
    const st = stateOf(b);
    if (st === 'Won') return { balance, fee, withdrawable: 0n, why: 'a won bid stays in escrow until the seller is paid' };
    // as withdrawBidEscrow (2026-10-22): a confirmed bid keeps its amount, which pays the later refund or payout fees included
    const reserved = b.tokens_escrowed && !PAID_OUT.includes(st) ? big(b.amount) : 0n;
    return { balance, fee, withdrawable: minus(balance, reserved + fee), why: reserved > 0n ? 'the bid amount stays in escrow while the bid stands' : null };
}

export const sneedexAdapter = {
    id: 'sneedex',
    name: 'Sneedex',
    kind: 'hosted',
    receivesDirectly: true,
    withdrawTo: 'main',
    quiet: true,
    enabled: (ctx) => Boolean(ctx.canisterIds?.sneedex),
    async listMyAccounts(ctx) { return listing(ctx); },
    /// `available` is what can be withdrawn now: these escrows are quiet pockets (model.js), shown
    /// and counted only with that, unless the user turns "Show Sneedex escrows" on.
    async balance(ctx, pocket, ledger) {
        const e = await escrowState(ctx, pocket, ledger);
        const reserved = e.balance > e.withdrawable ? e.balance - e.withdrawable : 0n;
        return { total: e.balance, available: e.withdrawable, ...(e.why && reserved > 0n ? { note: e.why } : {}) };
    },
    /// What can leave now, and why not more.
    async rules(ctx, pocket, ledger) {
        const e = await escrowState(ctx, pocket, ledger);
        return { withdrawable: e.withdrawable, fee: e.fee, why: e.why, ...(e.allOnly ? { allOnly: true } : {}) };
    },
    /// Fund a bid (or the creation payment) from a wallet pocket.
    async deposit(ctx, pocket, ledger, amount, fromSubaccount) {
        return transferFromWallet(ctx, ledger, fromSubaccount, pocket.account, amount, await feeOf(ctx, ledger));
    },
    /// Only to Main. The creation payment comes out whole (balance - fee); a bid escrow by amount.
    async withdraw(ctx, pocket, ledger, amount) {
        const meta = (pocket.meta ? pocket : await itemOf(ctx, pocket))?.meta;
        if (!meta) throw new Error('This Sneedex escrow is not one of yours any more');
        if (meta.kind === 'payment') return unwrapResult(await dex(ctx).withdrawOfferCreationPayment(), 'Sneedex refused the withdrawal');
        return unwrapResult(await dex(ctx).withdrawBidEscrow(meta.bid.id, big(amount)), 'Sneedex refused the withdrawal');
    },
};
