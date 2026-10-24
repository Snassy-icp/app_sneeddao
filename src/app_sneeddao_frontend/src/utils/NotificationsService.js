// sneed_notifications (spec/sneed_notifications.md): the user's side, for the notification centre.
// On a network where the canister has no id yet, the service is off (same rule as NamingService).
import { Principal } from '@dfinity/principal';
import { createActor, canisterId as notificationsEnv } from 'declarations/sneed_notifications';
import { createActor as createLedger } from 'external/icrc1_ledger';
import { approveAndRecord } from './approvals';
import { expiresInMs } from './icrcTx';
import { withdrawErrorText } from './notificationsWithdraw';

export { withdrawErrorText };

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
    const approve = await approveAndRecord(ledger, ICP_LEDGER, { from_subaccount: [], spender: { owner: Principal.fromText(notificationsId), subaccount: [] }, amount: amountE8s + ICP_FEE, expected_allowance: [], expires_at: expiresInMs(), fee: [], memo: [], created_at_time: [] });
    if ('Err' in approve) throw new Error(`The ledger refused the approval: ${JSON.stringify(approve.Err, (k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
    const r = await notificationsActor(identity).top_up(amountE8s);
    if ('err' in r) throw new Error(r.err);
    return r.ok;
}

/// Withdraw `amountE8s` of the caller's message balance to `to` ({ owner: Principal, subaccount?:
/// Uint8Array }); `to` receives the amount less the ledger fee. Returns { ledger_block, sent_e8s, ... }.
export async function withdraw(identity, amountE8s, to) {
    const r = await notificationsActor(identity).withdraw({ amount_e8s: amountE8s, to: { owner: to.owner, subaccount: to.subaccount ? [to.subaccount] : [] }, created_at_time: [] });
    if ('err' in r) throw new Error(withdrawErrorText(r.err));
    return r.ok;
}

export const formatIcp = (e8s) => `${(Number(e8s) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 })} ICP`;

// ---- channels: addresses encrypted in the browser to the relay that delivers them ----

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const urlB64ToBytes = (s) => unb64((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));

/// The relay's published keys for a channel kind: { enc, vapid? } or null when none runs yet.
export async function relayKeys(identity, kind) {
    const keys = await notificationsActor(identity).get_relay_keys();
    const hit = keys.find(([k]) => kindOf(k) === kind);
    return hit ? JSON.parse(hit[1]) : null;
}

/// { k: RSA-OAEP-256(aesKey), iv, c: AES-256-GCM(json) } as bytes: only the relay can open it.
async function encryptFor(encSpkiB64, obj) {
    const rsa = await crypto.subtle.importKey('spki', unb64(encSpkiB64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(obj)));
    const k = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsa, await crypto.subtle.exportKey('raw', aes));
    return new TextEncoder().encode(JSON.stringify({ k: b64(k), iv: b64(iv), c: b64(c) }));
}

async function addEncrypted(identity, kind, name, address) {
    const keys = await relayKeys(identity, kind);
    if (!keys) throw new Error('This channel has no relay running yet');
    const r = await notificationsActor(identity).add_channel({ [kind]: null }, name, await encryptFor(keys.enc, address));
    if ('err' in r) throw new Error(r.err);
    return r.ok;
}

/// Discord: Mr Sneed's bot DMs you (you must share a server with it).
export const addDiscordChannel = (identity, discordId) => addEncrypted(identity, 'discord', 'Discord', { discord_id: String(discordId).trim() });

/// Push to this device (on iPhone: only inside the installed app).
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export async function addPushChannel(identity, deviceName) {
    const keys = await relayKeys(identity, 'push');
    if (!keys?.vapid) throw new Error('Push has no relay running yet');
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are not allowed on this device (check the system settings)');
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(keys.vapid) }));
    return addEncrypted(identity, 'push', deviceName, sub.toJSON());
}
