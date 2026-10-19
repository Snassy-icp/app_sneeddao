// sneed_notifications (spec/sneed_notifications.md): the user's side, for the notification centre.
// On a network where the canister has no id yet, the service is off (same rule as NamingService).
import { Principal } from '@dfinity/principal';
import { createActor, canisterId as notificationsEnv } from 'declarations/sneed_notifications';
import { createActor as createLedger } from 'external/icrc1_ledger';

const realCanisterId = (text) => {
    try { const b = Principal.fromText(text).toUint8Array(); return b.length === 10 && b[9] === 1 ? text : null; } catch { return null; }
};
export const notificationsId = realCanisterId(notificationsEnv);
export const notificationsEnabled = Boolean(notificationsId);

const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';
const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const ICP_FEE = 10_000n;

export const notificationsActor = (identity) => createActor(notificationsId, { agentOptions: { host, identity: identity || undefined } });

export const LEVELS = [
    { key: 'urgent', label: 'Urgent', hint: 'needs action soon: low cycles, a vote ending, funds received' },
    { key: 'normal', label: 'Normal', hint: 'activity: replies, sales, mentions' },
    { key: 'info', label: 'Info', hint: 'news and announcements' },
];
export const CHANNEL_KINDS = [
    { key: 'sneed_sms', label: 'Sneed SMS', live: true },
    { key: 'push', label: 'Phone push (installed app)', live: false },
    { key: 'discord', label: 'Discord', live: false },
    { key: 'telegram', label: 'Telegram', live: false },
    { key: 'email', label: 'Email', live: false },
];
export const kindOf = (v) => Object.keys(v || {})[0];
export const levelOf = (v) => Object.keys(v || {})[0];

/// Approve the notifications canister for `amountE8s` (+ fee) on the ICP ledger, then top up.
export async function topUp(identity, amountE8s) {
    const ledger = createLedger(ICP_LEDGER, { agentOptions: { host, identity } });
    const approve = await ledger.icrc2_approve({ from_subaccount: [], spender: { owner: Principal.fromText(notificationsId), subaccount: [] }, amount: amountE8s + ICP_FEE, expected_allowance: [], expires_at: [], fee: [], memo: [], created_at_time: [] });
    if ('Err' in approve) throw new Error(`The ledger refused the approval: ${JSON.stringify(approve.Err, (k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
    const r = await notificationsActor(identity).top_up(amountE8s);
    if ('err' in r) throw new Error(r.err);
    return r.ok;
}

export const formatIcp = (e8s) => `${(Number(e8s) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 })} ICP`;
