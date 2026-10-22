// Sending from a pocket and moving between pockets (spec/programmable_accounts.md §4.3), behind
// the one send dialog. Every step goes through the adapters (and so utils/icrcTx.js); nothing here
// touches keys. Plans are computed first so the dialog can show every fee before anything moves.
//
//   planTransfer(from, to, { fee, toIsMine })   -> { steps: [{ kind, adapterId, amountExtra }], fees }
//   sendFromPocket(ctx, from, ledger, amount, toAccount)   arbitrary recipient
//   movePocket(ctx, from, to, ledger, amount)              between two of my pockets
import { adapterFor, walletAdapter } from './adapters/index.js';
import { KIND, MAIN_ID, walletPocket } from './model.js';
import { isDefault, sameSubaccount } from './subaccount.js';
import { feeOf, text } from './adapters/common.js';

const isMain = (account, me) => Boolean(account?.owner && me) && text(account.owner) === text(me) && isDefault(account.subaccount);
const sameAccount = (a, b) => Boolean(a?.owner && b?.owner) && text(a.owner) === text(b.owner) && sameSubaccount(a.subaccount, b.subaccount);

/// Whether a pocket can pay an arbitrary recipient directly (wallet pockets, hosts that send anywhere).
export const canSendAnywhere = (p) => p.kind === KIND.wallet || (p.caps?.withdraw && p.caps?.withdrawTo !== 'main');

/// The steps a transfer takes and how many ledger fees it pays.
///   from → any account: one step, or withdraw-to-Main then send (hosts that pay out to Main only);
///   from → my pocket (`to` a pocket): wallet→wallet send; wallet→host deposit; host→wallet withdraw
///   (+ a send when the host pays Main only and `to` is not Main); host→host withdraw to Main, then deposit.
export function planTransfer(from, to, { me } = {}) {
    const steps = [];
    const toPocket = to && to.kind ? to : null;
    const toAccount = toPocket ? toPocket.account : to;
    if (from.kind === KIND.wallet) {
        if (!toPocket || toPocket.kind === KIND.wallet) steps.push({ kind: 'send', from: from.id });
        else steps.push({ kind: 'deposit', to: toPocket.id, fromSubaccount: from.account.subaccount });
    } else {
        const toMainOnly = from.caps?.withdrawTo === 'main';
        if (!toPocket || toPocket.kind === KIND.wallet) {
            if (toMainOnly && !isMain(toAccount, me)) { steps.push({ kind: 'withdraw', from: from.id, toMain: true }); steps.push({ kind: 'send', from: MAIN_ID }); }
            else steps.push({ kind: 'withdraw', from: from.id });
        } else {
            steps.push({ kind: 'withdraw', from: from.id, toMain: true });
            steps.push({ kind: 'deposit', to: toPocket.id, fromSubaccount: null });
        }
    }
    return { steps, fees: steps.length };
}

/// Why a move/send can't be made, or null. `to` is a pocket or an account.
export function transferProblem(from, to, { me } = {}) {
    if (!from) return 'Pick a pocket to send from';
    const toPocket = to && to.kind ? to : null;
    if (toPocket && toPocket.id === from.id) return 'That is the same pocket';
    if (!toPocket && to && from.account && sameAccount(from.account, to)) return 'That is the same account';
    if (from.kind !== KIND.wallet && !from.caps?.withdraw) return `${from.host || from.adapterId} does not let tokens out from here`;
    if (toPocket && toPocket.kind !== KIND.wallet && !toPocket.caps?.deposit) return `${toPocket.host || toPocket.adapterId} can't be topped up from the wallet`;
    if (toPocket && toPocket.kind !== KIND.wallet && toPocket.adapterId === 'sneed_notifications' && from.kind === KIND.wallet && !isDefault(from.account.subaccount)) return 'Sneed Notifications tops up from Main only';
    return null;
}

/// Run the plan. `amount` is what arrives at the destination; each step's fee is paid on top by
/// the account that sends in that step. Returns the steps' results.
export async function executeTransfer(ctx, from, to, ledger, amount) {
    const me = ctx.me;
    const problem = transferProblem(from, to, { me });
    if (problem) throw new Error(problem);
    const toPocket = to && to.kind ? to : null;
    const toAccount = toPocket ? toPocket.account : to;
    const plan = planTransfer(from, to, { me });
    const fee = await feeOf(ctx, ledger);
    const main = walletPocket(me);
    const results = [];
    for (let i = 0; i < plan.steps.length; i++) {
        const s = plan.steps[i];
        const later = plan.steps.length - 1 - i; // fees still to pay after this step, out of what it delivers
        const deliver = BigInt(amount) + BigInt(later) * fee;
        try {
            if (s.kind === 'send') {
                const src = s.from === MAIN_ID ? main : from;
                results.push(await walletAdapter.send(ctx, src, ledger, deliver, toAccount));
            } else if (s.kind === 'deposit') {
                results.push(await adapterFor(toPocket).deposit(ctx, toPocket, ledger, deliver, s.fromSubaccount));
            } else if (s.kind === 'withdraw') {
                results.push(await adapterFor(from).withdraw(ctx, from, ledger, deliver, s.toMain ? main.account : toAccount));
            }
        } catch (e) {
            if (i > 0) throw new Error(`Step ${i + 1} of ${plan.steps.length} failed (step ${i} went through, the tokens are in Main): ${e?.message || e}`);
            throw e;
        }
    }
    return results;
}
