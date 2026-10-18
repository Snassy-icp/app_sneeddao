// Donations to the people who build Sneed Hub (app_sneeddao_backend, Donations.mo): the account
// they go to, sending one from the donor's wallet, registering it for the thank-you wall, and
// reading the wall. The interface is declared here so it does not wait for regenerated
// declarations. Donations are public: the wall shows every donor's principal.
import { Actor, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createSmsActor, canisterId as smsCanisterId } from 'declarations/sneed_sms';

const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';

export const MAX_MESSAGE = 200;

const idlFactory = ({ IDL }) => {
    const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
    const Donation = IDL.Record({
        id: IDL.Nat, donor: IDL.Principal, from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)), to: Account, ledger: IDL.Principal,
        block_index: IDL.Nat, amount: IDL.Nat, created_at: IDL.Int, registered_at: IDL.Int, message: IDL.Opt(IDL.Text), hidden: IDL.Bool,
    });
    const Page = IDL.Record({ total: IDL.Nat, donations: IDL.Vec(Donation) });
    const Res = (ok) => IDL.Variant({ ok, err: IDL.Text });
    return IDL.Service({
        get_donation_account: IDL.Func([], [IDL.Opt(Account)], ['query']),
        admin_set_donation_account: IDL.Func([IDL.Opt(Account)], [Res(IDL.Null)], []),
        register_donation: IDL.Func([IDL.Record({ ledger: IDL.Principal, block_index: IDL.Nat, from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)), message: IDL.Opt(IDL.Text) })], [Res(Donation)], []),
        get_donations: IDL.Func([IDL.Nat, IDL.Nat], [Page], ['query']),
        get_donation_totals: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Nat, IDL.Nat))], ['query']),
        admin_get_donations: IDL.Func([IDL.Nat, IDL.Nat], [Res(Page)], ['query']),
        admin_set_donation_hidden: IDL.Func([IDL.Nat, IDL.Bool], [Res(IDL.Null)], []),
    });
};

async function agentFor(identity) {
    const agent = await HttpAgent.create({ host, ...(identity ? { identity } : {}) });
    if (isLocal) await agent.fetchRootKey();
    return agent;
}
/// The backend's donation methods, as `identity` (anonymous when none).
export async function donationsActor(identity) {
    return Actor.createActor(idlFactory, { agent: await agentFor(identity), canisterId: backendCanisterId });
}
const unwrap = (r) => { if ('err' in r) throw new Error(r.err); return r.ok; };

/// The donation account, { owner: Principal, subaccount: Uint8Array | null }, or null when none is set.
export async function getDonationAccount() {
    let r;
    try { r = await (await donationsActor()).get_donation_account(); } catch (e) {
        // a backend from before donations: none are open
        if (/has no (query|update) method|method not found|IC0536/i.test(String(e?.message || e))) return null;
        throw e;
    }
    const a = r[0];
    return a ? { owner: a.owner, subaccount: a.subaccount[0] ? Uint8Array.from(a.subaccount[0]) : null } : null;
}

/// The thank-you wall, newest first.
export async function getDonations(start = 0, limit = 100) {
    const r = await (await donationsActor()).get_donations(BigInt(start), BigInt(limit));
    return { total: Number(r.total), donations: r.donations };
}

/// [{ ledger (text), amount (bigint), count }] over every verified donation.
export async function getDonationTotals() {
    const r = await (await donationsActor()).get_donation_totals();
    return r.map(([ledger, amount, count]) => ({ ledger: ledger.toText(), amount, count: Number(count) }));
}

// ---- a donation that was sent but not yet registered ----
// Kept in this browser until the backend has listed it, so a closed tab or a failed call never
// leaves a donation off the wall: the dialog offers to register it again.
const PENDING_KEY = 'sneed_pending_donations_v1';
const readPending = () => { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; } };
const writePending = (list) => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch { /* private window */ } };
/// Donations from `donor` that were sent but not registered: [{ donor, ledger, block, amount, message }].
export const pendingDonations = (donor) => readPending().filter((p) => p.donor === donor);
const addPending = (p) => writePending([...readPending().filter((x) => !(x.ledger === p.ledger && x.block === p.block)), p]);
const dropPending = (ledger, block) => writePending(readPending().filter((x) => !(x.ledger === ledger && x.block === block)));

/// Registers a sent donation for the wall. A refusal saying it is already listed counts as done.
export async function registerDonation(identity, { ledger, block, message }) {
    const actor = await donationsActor(identity);
    const r = await actor.register_donation({ ledger: Principal.fromText(ledger), block_index: BigInt(block), from_subaccount: [], message: message ? [message] : [] });
    if ('err' in r && /already on the wall/.test(r.err)) { dropPending(ledger, block); return null; }
    const d = unwrap(r);
    dropPending(ledger, block);
    return d;
}

/// Sends `amount` (base units) of `ledger` from the donor's main account to the donation account,
/// then registers it. Returns { block, donation }; when only the registering failed, throws an
/// error with `sent: { ledger, block }` (the donation is kept as pending for a retry).
export async function donate(identity, { ledger, amount, to, message }) {
    const agent = await agentFor(identity);
    const tok = createLedgerActor(ledger, { agent });
    const r = await tok.icrc1_transfer({
        from_subaccount: [], to: { owner: to.owner, subaccount: to.subaccount ? [to.subaccount] : [] },
        amount, fee: [], memo: [new TextEncoder().encode('Sneed Hub donation')], created_at_time: [],
    });
    if ('Err' in r) {
        const [k, v] = Object.entries(r.Err)[0];
        const detail = k === 'InsufficientFunds' ? 'not enough balance' : k === 'BadFee' ? `the fee is now ${v.expected_fee}` : k === 'GenericError' ? v.message : k;
        throw new Error(`The transfer did not go through: ${detail}`);
    }
    const block = r.Ok.toString();
    const donor = identity.getPrincipal().toText();
    addPending({ donor, ledger, block, amount: amount.toString(), message: message || '' });
    try {
        return { block, donation: await registerDonation(identity, { ledger, block, message }) };
    } catch (e) {
        const err = new Error(`Your donation was sent (block ${block}), but it could not be put on the wall yet: ${e.message}`);
        err.sent = { ledger, block };
        throw err;
    }
}

// ---- telling the recipient ----

/// Sends the donation account's owner a Sneed SMS message about a donation, from the donor, so a
/// reply reaches the donor. Best effort: a donation is complete without it (SMS may refuse, e.g.
/// within its rate limit), so this never throws; it returns whether the message went out.
export async function notifyRecipient(identity, { to, amountText, symbol, block, message }) {
    try {
        const sms = createSmsActor(smsCanisterId, { agent: await agentFor(identity) });
        const body = [
            `I just donated ${amountText} ${symbol} to Sneed Hub (ledger block ${block}).`,
            message ? `\n“${message}”` : '',
            `\nThe thank-you wall: https://app.sneeddao.com/donate`,
        ].filter(Boolean).join('\n');
        const r = await sms.send_message({ recipients: [to.owner], subject: `A donation of ${amountText} ${symbol}`, body, reply_to: [] });
        return 'ok' in r;
    } catch {
        return false;
    }
}

// ---- admin ----
export async function adminSetDonationAccount(identity, account) {
    unwrap(await (await donationsActor(identity)).admin_set_donation_account(account ? [{ owner: account.owner, subaccount: account.subaccount ? [account.subaccount] : [] }] : []));
}
export async function adminGetDonations(identity, start = 0, limit = 100) {
    const r = unwrap(await (await donationsActor(identity)).admin_get_donations(BigInt(start), BigInt(limit)));
    return { total: Number(r.total), donations: r.donations };
}
export async function adminSetDonationHidden(identity, id, hidden) {
    unwrap(await (await donationsActor(identity)).admin_set_donation_hidden(id, hidden));
}
