// Keeps the stored login usable: the session key and the delegation to it must belong together.
//
// @dfinity/auth-client (2.4.1) stores the two separately. logout() deletes both from storage but
// keeps the key in memory, and login() then stores only the new delegation. So with two tabs:
// tab 1 logs out, another tab (or page load) creates and stores a new key B, tab 1 logs in again
// with its old key A. Storage now holds key B with a delegation to key A; every later page load
// looks logged in, but the replica refuses every signed call ("Invalid signature: Invalid basic
// signature: Ed25519 signature could not be verified"), sends included.
//
//   createAuthClient(options)    AuthClient.create, plus: a stored login whose key does not match
//                                its delegation is logged out ({ client, brokenLogin: true }).
//   rememberSessionKey(client)   after a login: store the key the delegation was made for.
//
// No 'external/*' imports so node can test it (scripts/authSession.test.mjs).
import { AuthClient, IdbStorage, KEY_STORAGE_KEY } from '@dfinity/auth-client';

const toHex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

/** True when `key` (the session key) is the key the last delegation in `chain` was made for. */
export function sessionKeyMatches(key, chain) {
    const last = chain?.delegations?.[chain.delegations.length - 1];
    if (!key || !last) return false;
    try {
        return toHex(key.getPublicKey().toDer()) === toHex(last.delegation.pubkey);
    } catch {
        return false;
    }
}

/** AuthClient.create(options), but a stored login with a mismatched key is logged out. */
export async function createAuthClient(options = {}) {
    const client = await AuthClient.create(options);
    if (!(await client.isAuthenticated())) return { client, brokenLogin: false };
    const identity = client.getIdentity();
    const chain = typeof identity.getDelegation === 'function' ? identity.getDelegation() : null;
    if (sessionKeyMatches(client._key, chain)) return { client, brokenLogin: false };
    await client.logout();
    return { client, brokenLogin: true };
}

/** After a successful login: store the session key next to the delegation that was made for it. */
export async function rememberSessionKey(client, storage = client?._storage ?? new IdbStorage()) {
    const key = client?._key;
    if (!key || typeof key.toJSON !== 'function') return; // only Ed25519 keys serialize; we use Ed25519
    await storage.set(KEY_STORAGE_KEY, JSON.stringify(key.toJSON()));
}
