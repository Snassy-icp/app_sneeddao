// sneed_mon, Sneed Monitor (spec/sneed_mon.md, public/api-docs/sneed_mon.md): watches SNS and NNS
// proposals for users and tells them through Sneed Notifications; users pay per check from a
// prepaid ICP balance. Shared by /notifications (the user's section) and /admin/mon.
//
// The canister id comes from the build's environment (CANISTER_ID_SNEED_MON, written by dfx from
// canister_ids.json for the network built for). sneed_mon has a staging id only, so on a network
// where it has none (prod for now) `monEnabled` is false and the UI hides itself (same rule as
// NotificationsService).
import { Principal } from '@dfinity/principal';
import { encodeIcrcAccount } from '@dfinity/ledger-icrc';
import { createActor, canisterId as monEnv } from 'declarations/sneed_mon';
import { createActor as createLedger } from 'external/icrc1_ledger';
import { approveAndRecord } from './approvals';

const realCanisterId = (text) => {
    try { const b = Principal.fromText(text).toUint8Array(); return b.length === 10 && b[9] === 1 ? text : null; } catch { return null; }
};
export const monId = realCanisterId(monEnv);
export const monEnabled = Boolean(monId);

const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';

/// An actor as `identity` (anonymous when none: the public queries).
export const monActor = (identity) => createActor(monId, { agentOptions: { host, identity: identity || undefined } });

export const NNS_TARGET = { nns: null };
export const snsTarget = (root) => ({ sns: typeof root === 'string' ? Principal.fromText(root) : root });
/// 'nns' or the SNS root as text (the canister's own key).
export const targetKey = (t) => ('nns' in t ? 'nns' : t.sns.toText());

export const TIER_LABELS = { 10: 'Every 10 minutes', 60: 'Hourly', 180: 'Every 3 hours', 1440: 'Daily' };
export const tierLabel = (min) => TIER_LABELS[Number(min)] || `Every ${Number(min)} minutes`;
export const REMINDER_WINDOWS = [
    { s: 3600, label: '1 hour' }, { s: 14400, label: '4 hours' }, { s: 43200, label: '12 hours' },
    { s: 86400, label: '1 day' }, { s: 172800, label: '2 days' },
];

export const e8sToIcp = (e8s) => Number(e8s) / 1e8;
/// "0.0043 ICP": enough digits to show small prices.
export const fmtIcp = (e8s, digits = 6) => `${e8sToIcp(e8s).toLocaleString(undefined, { maximumFractionDigits: digits })} ICP`;
export const icpToE8s = (text) => {
    const n = Number(text);
    return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e8)) : 0n;
};

/// An ICRC-1 account as text (principal, or principal-checksum.subaccount), which wallets accept.
export const encodeAccount = (a) => encodeIcrcAccount({ owner: a.owner, subaccount: a.subaccount?.length ? Uint8Array.from(a.subaccount[0]) : undefined });

/// Send `amountE8s` ICP from the logged-in user's wallet (their principal's main account) to
/// `to` ({ owner, subaccount: [] | [bytes] }), the sender paying the ledger fee. Returns the block.
export async function sendIcp(identity, ledgerId, to, amountE8s) {
    const ledger = createLedger(typeof ledgerId === 'string' ? ledgerId : ledgerId.toText(), { agentOptions: { host, identity } });
    const r = await ledger.icrc1_transfer({ from_subaccount: [], to, amount: amountE8s, fee: [], memo: [], created_at_time: [] });
    if ('Err' in r) {
        const [k, v] = Object.entries(r.Err)[0];
        const detail = k === 'InsufficientFunds' ? `not enough ICP in your wallet (balance ${fmtIcp(v.balance)})` : k === 'BadFee' ? `the fee is now ${fmtIcp(v.expected_fee)}` : k === 'GenericError' ? v.message : k;
        throw new Error(`The transfer did not go through: ${detail}`);
    }
    return r.Ok;
}

/// A canister answer `{ ok } | { err }` as its ok value, or a thrown Error.
export const unwrap = (r) => { if (r && 'err' in r) throw new Error(r.err); return r?.ok; };

// ---- auto top-up (ICRC-2): the user approves sneed_mon, which pulls from their wallet ----

/// A subaccount typed by the user: an index number (big-endian in the last bytes, as the app's
/// hex subaccounts are read) or hex (0x… or up to 64 hex digits). '' = the main account (null).
/// Throws on anything else.
export function parseSubaccountInput(text) {
    const t = (text || '').trim();
    if (!t) return null;
    let hex;
    if (/^\d+$/.test(t) && t.length < 64) hex = BigInt(t).toString(16);
    else hex = t.replace(/^0x/i, '').replace(/[\s-]/g, '');
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length > 64) throw new Error('A subaccount is an index number or up to 64 hex digits');
    const padded = hex.padStart(64, '0');
    const bytes = Uint8Array.from(padded.match(/../g).map((b) => parseInt(b, 16)));
    return bytes.every((b) => b === 0) ? null : bytes;
}
export const subaccountHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const ledgerFor = (identity, ledgerId) => createLedger(typeof ledgerId === 'string' ? ledgerId : ledgerId.toText(), { agentOptions: { host, identity } });

/// icrc2_approve on `ledgerId` from the user's (sub)account for `spender` ({ owner, subaccount }),
/// replacing any earlier approval. expiresAtNs null = no expiry. Returns the block.
export async function approveSpender(identity, ledgerId, spender, amountE8s, expiresAtNs, fromSubaccount) {
    const r = await approveAndRecord(ledgerFor(identity, ledgerId), ledgerId, {
        from_subaccount: fromSubaccount ? [fromSubaccount] : [], spender, amount: amountE8s, expected_allowance: [],
        expires_at: expiresAtNs ? [expiresAtNs] : [], fee: [], memo: [], created_at_time: [],
    });
    if ('Err' in r) {
        const [k, v] = Object.entries(r.Err)[0];
        const detail = k === 'InsufficientFunds' ? `not enough ICP for the approval fee (balance ${fmtIcp(v.balance)})` : k === 'GenericError' ? v.message : k;
        throw new Error(`The ledger refused the approval: ${detail}`);
    }
    return r.Ok;
}

/// The allowance the user's (sub)account gives `spender`: { allowance, expires_at: [] | [ns] }.
export async function getAllowance(identity, ledgerId, owner, fromSubaccount, spender) {
    return ledgerFor(identity, ledgerId).icrc2_allowance({ account: { owner, subaccount: fromSubaccount ? [fromSubaccount] : [] }, spender });
}
