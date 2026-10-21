// "Connect an AI agent": let a local agent (the Sneed Hub MCP server) act as you, within limits.
//
// The agent shows a link with its session public key and a loopback callback. Here the logged-in user
// picks which canisters the agent may call (delegation `targets`) and for how long, and we sign one more
// delegation in the chain Internet Identity made: from this session's key to the agent's key, limited to
// those canisters and that expiry. The replica enforces both. The delegation is useless without the
// agent's private key, which never leaves the agent's machine. It cannot be revoked on-chain: it ends at
// its expiry (or when the agent deletes its key), so short expiries are the safe default.
// Nothing is stored anywhere by Sneed Hub.
import { DelegationChain, Ed25519PublicKey } from '@dfinity/identity';
import { Principal } from '@dfinity/principal';
import { canisterId as SNEEDEX } from 'declarations/sneedex';
import { canisterId as SNEED_LOCK } from 'declarations/sneed_lock';
import { canisterId as FORUM } from 'declarations/sneed_sns_forum';
import { canisterId as SMS } from 'declarations/sneed_sms';
import { canisterId as NOTIFICATIONS } from 'declarations/sneed_notifications';
import { canisterId as PID_NAMES } from 'declarations/sneed_pid_names';
import { canisterId as PID_NICKNAMES } from 'declarations/sneed_pid_nicknames';
import { canisterId as RLL } from 'declarations/rll';
import { canisterId as SNEEDAPP } from 'declarations/sneedapp';
import { canisterId as PREMIUM } from 'declarations/sneed_premium';
import { canisterId as MON } from 'declarations/sneed_mon';

export { checkCode } from './pairing';

const fromHex = (h) => new Uint8Array((h.match(/.{1,2}/g) || []).map((x) => parseInt(x, 16)));

export const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
export const SNEED_LEDGER = 'hvgxa-wqaaa-aaaaq-aacia-cai';
export const SNEED_GOVERNANCE = 'fi3zi-fyaaa-aaaaq-aachq-cai';

const isCanisterId = (t) => { try { const p = Principal.fromText(String(t || '')); const b = p.toUint8Array(); return b.length === 10 && b[9] === 1; } catch { return false; } };

/// The Sneed canisters every connection may use (the default scope), with labels.
export const SNEED_CANISTERS = [
    ['Sneedex', SNEEDEX], ['Sneed Lock', SNEED_LOCK], ['Forum', FORUM], ['Sneed SMS', SMS],
    ['Notifications', NOTIFICATIONS], ['Names', PID_NAMES], ['Nicknames', PID_NICKNAMES], ['Rewards (RLL)', RLL],
    ['Sneedapp', SNEEDAPP], ['Premium', PREMIUM], ['Sneed Monitor', MON],
].filter(([, id]) => isCanisterId(id));

/// A callback must be a loopback http URL (the agent's own machine).
export const validCallback = (cb) => {
    try {
        const u = new URL(cb);
        return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && !u.username && !u.password;
    } catch { return false; }
};

/// The earliest expiry (ns) of the current login's chain.
// (duck-typed rather than instanceof DelegationIdentity, so a second copy of @dfinity/identity works)
const isDelegated = (identity) => typeof identity?.getDelegation === 'function';
export const sessionExpiryNs = (identity) => {
    if (!isDelegated(identity)) return null;
    const ds = identity.getDelegation().delegations;
    return ds.reduce((m, d) => (d.delegation.expiration < m ? d.delegation.expiration : m), ds[0].delegation.expiration);
};

/// Targets for a scope choice: { everything } or the Sneed canisters plus the chosen extras.
export const targetsFor = ({ everything, icp, sneed, governance, extra = [] }) => {
    if (everything) return null;
    const ids = SNEED_CANISTERS.map(([, id]) => id);
    if (icp) ids.push(ICP_LEDGER);
    if (sneed) ids.push(SNEED_LEDGER);
    if (governance) ids.push(SNEED_GOVERNANCE);
    for (const e of extra) if (isCanisterId(e.trim())) ids.push(e.trim());
    return [...new Set(ids)];
};
export { isCanisterId };

/// Sign the agent's key into the logged-in session's chain with the chosen targets and expiry.
/// Returns the delegation chain as JSON text.
export async function approveAgent(identity, keyHex, { targets, expiresMs }) {
    if (!isDelegated(identity)) throw new Error('Log in first');
    const previous = identity.getDelegation();
    const sessionMs = Number(sessionExpiryNs(identity) / 1_000_000n);
    const exp = Math.min(expiresMs, sessionMs);
    const to = Ed25519PublicKey.fromDer(fromHex(keyHex));
    const chain = await DelegationChain.create(identity, to, new Date(exp), {
        previous,
        targets: targets ? targets.map((t) => Principal.fromText(t)) : undefined,
    });
    return JSON.stringify(chain.toJSON());
}

/// Hand the approval to the agent: POST to its loopback listener. Returns true when it answered ok.
export async function deliverToAgent(callback, chainJson) {
    const res = await fetch(callback, { method: 'POST', headers: { 'content-type': 'application/json' }, body: chainJson });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || `The agent answered HTTP ${res.status}`);
    return body;
}

/// base64url text of the approval (for the navigation fallback and the copyable code).
export const approvalCode = (chainJson) => btoa(unescape(encodeURIComponent(chainJson))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
