// Tests for src/utils/authSession.js: the stored login (session key + delegation) stays usable.
// Replays, with the real @dfinity/auth-client, the two-tab sequence that left a key and a
// delegation that don't belong together (every signed call then failed with "Invalid signature").
//   node --test scripts/authSession.test.mjs
//   AUTH_IMPL=legacy node --test scripts/authSession.test.mjs   (the old code: the regressions fail)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthClient } from '@dfinity/auth-client';
import { DelegationChain, Ed25519KeyIdentity } from '@dfinity/identity';
import * as auth from '../src/utils/authSession.js';

const legacy = process.env.AUTH_IMPL === 'legacy';
// The old code: AuthClient.create as is, and nothing stored after a login.
const createAuthClient = legacy
    ? async (o) => ({ client: await AuthClient.create(o), brokenLogin: false })
    : auth.createAuthClient;
const rememberSessionKey = legacy ? async () => {} : auth.rememberSessionKey;

/** The browser's IndexedDB store, in memory and shared by every "tab". */
function memoryStorage() {
    const m = new Map();
    return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); }, remove: async (k) => { m.delete(k); } };
}

const opts = (storage) => ({ storage, keyType: 'Ed25519', idleOptions: { disableIdle: true, disableDefaultIdleCallback: true } });

/** What Internet Identity sends back: a delegation from the user's key to this client's session key. */
async function iiLogin(client, user) {
    const chain = await DelegationChain.create(user, client._key.getPublicKey(), new Date(Date.now() + 3_600_000));
    const message = {
        kind: 'authorize-client-success',
        userPublicKey: new Uint8Array(chain.publicKey),
        delegations: chain.delegations.map((d) => ({
            delegation: { pubkey: new Uint8Array(d.delegation.pubkey), expiration: d.delegation.expiration, targets: d.delegation.targets },
            signature: new Uint8Array(d.signature),
        })),
    };
    await client._handleSuccess(message);
    await rememberSessionKey(client); // what AuthContext does in onSuccess
}

/** Does `client`'s identity sign calls with the key its delegation was made for? */
function signsWithDelegatedKey(client) {
    return auth.sessionKeyMatches(client._key, client.getIdentity().getDelegation());
}

test('regression: logout in one tab, a new key elsewhere, login again: the stored login stays usable', async () => {
    const storage = memoryStorage();
    const user = Ed25519KeyIdentity.generate();

    const { client: tab1 } = await createAuthClient(opts(storage));
    await iiLogin(tab1, user);
    await tab1.logout();                                           // storage cleared, tab 1 keeps its key
    await createAuthClient(opts(storage));                         // tab 2 loads: stores a new key
    await iiLogin(tab1, user);                                     // tab 1 logs in again

    const { client: reloaded } = await createAuthClient(opts(storage)); // any later page load
    if (await reloaded.isAuthenticated()) {
        assert.ok(signsWithDelegatedKey(reloaded), 'logged in with a key that does not match the delegation: every call fails with "Invalid signature"');
    }
    assert.ok(await reloaded.isAuthenticated(), 'the login made in tab 1 was lost');
});

test('regression: a stored key that does not match the stored delegation is logged out, not used', async () => {
    const storage = memoryStorage();
    const user = Ed25519KeyIdentity.generate();
    const { client: a } = await createAuthClient(opts(storage));
    await iiLogin(a, user);
    // Break it the way the old code could: another key in storage next to that delegation.
    await storage.set('identity', JSON.stringify(Ed25519KeyIdentity.generate().toJSON()));

    const { client, brokenLogin } = await createAuthClient(opts(storage));
    assert.equal(await client.isAuthenticated(), false, 'a broken login counts as logged in');
    assert.equal(brokenLogin, true);

    // Logging in again then works, and survives a reload.
    await iiLogin(client, user);
    const { client: reloaded, brokenLogin: broken2 } = await createAuthClient(opts(storage));
    assert.equal(broken2, false);
    assert.ok(await reloaded.isAuthenticated());
    assert.ok(signsWithDelegatedKey(reloaded));
});

test('a normal login is untouched', async () => {
    const storage = memoryStorage();
    const { client } = await createAuthClient(opts(storage));
    await iiLogin(client, Ed25519KeyIdentity.generate());
    const { client: reloaded, brokenLogin } = await createAuthClient(opts(storage));
    assert.equal(brokenLogin, false);
    assert.ok(await reloaded.isAuthenticated());
    assert.ok(signsWithDelegatedKey(reloaded));
});
