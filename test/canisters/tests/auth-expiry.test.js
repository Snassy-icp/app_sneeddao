// Login expiry in Sneed Hub (src/app_sneeddao_frontend/src/utils/authExpiry.js). AuthClient checks
// the Internet Identity delegation only when the page loads, so a tab left open past the expiry kept
// showing the user as logged in while every signed call failed (the voting page read the failures as
// "no proposals", a wallet send failed at the end). AuthContext now reads the chain's expiry and
// pages classify refused calls with isAuthExpiredError. Here: the expiry computation on real
// DelegationIdentity / PartialDelegationIdentity / DelegationChain objects, the classifier on the
// messages agent-js and the replica give, and, on PocketIC over the HTTP gateway, the actual errors
// a query and an icrc1_transfer signed with an expired delegation get (and that a live one works).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Actor, HttpAgent } from '@dfinity/agent';
import { DelegationChain, DelegationIdentity, Ed25519KeyIdentity, PartialDelegationIdentity } from '@dfinity/identity';
import { createPic, install } from '../lib/pic.js';
import { ledgerIdl, ledgerInit } from '../lib/idl.js';
import {
    getDelegationExpiryMs, isIdentityExpired, isAuthExpiredError, onAuthExpired, reportIfAuthExpired,
} from '../../../src/app_sneeddao_frontend/src/utils/authExpiry.js';

const HOUR = 3_600_000;

/// A login like Internet Identity's: root key -> (optional middle key) -> session key.
async function login(expiries) {
    const root = Ed25519KeyIdentity.generate();
    const session = Ed25519KeyIdentity.generate();
    let chain;
    if (expiries.length === 1) {
        chain = await DelegationChain.create(root, session.getPublicKey(), new Date(expiries[0]));
    } else {
        const middle = Ed25519KeyIdentity.generate();
        const first = await DelegationChain.create(root, middle.getPublicKey(), new Date(expiries[0]));
        chain = await DelegationChain.create(middle, session.getPublicKey(), new Date(expiries[1]), { previous: first });
    }
    return { root, session, chain, identity: DelegationIdentity.fromDelegation(session, chain) };
}

describe('delegation expiry', () => {
    it("reads a DelegationIdentity's expiry in ms (from the nanosecond expiration)", async () => {
        const at = Date.now() + 5 * HOUR;
        const { identity, chain } = await login([at]);
        expect(chain.delegations[0].delegation.expiration).toBe(BigInt(at) * 1_000_000n);
        expect(getDelegationExpiryMs(identity)).toBe(at);
        expect(isIdentityExpired(identity)).toBe(false);
        expect(isIdentityExpired(identity, at - 1)).toBe(false);
        expect(isIdentityExpired(identity, at)).toBe(true); // as AuthClient's isDelegationValid: expired at the moment
        expect(isIdentityExpired(identity, at + 1)).toBe(true);
    });

    it('takes the earliest delegation of a longer chain (a paired app, a connected agent)', async () => {
        const early = Date.now() + 1 * HOUR;
        const late = Date.now() + 9 * HOUR;
        expect(getDelegationExpiryMs((await login([late, early])).identity)).toBe(early);
        expect(getDelegationExpiryMs((await login([early, late])).identity)).toBe(early);
    });

    it('reads a PartialDelegationIdentity and a bare DelegationChain (the stored login)', async () => {
        const at = Date.now() - HOUR;
        const { session, chain } = await login([at]);
        const partial = PartialDelegationIdentity.fromDelegation(session.getPublicKey(), chain);
        expect(getDelegationExpiryMs(partial)).toBe(at);
        expect(isIdentityExpired(partial)).toBe(true);
        const stored = DelegationChain.fromJSON(JSON.stringify(chain.toJSON()));
        expect(getDelegationExpiryMs(stored)).toBe(at);
        expect(isIdentityExpired(stored)).toBe(true);
    });

    it('has no expiry for identities without a chain', () => {
        expect(getDelegationExpiryMs(null)).toBe(null);
        expect(getDelegationExpiryMs(Ed25519KeyIdentity.generate())).toBe(null);
        expect(isIdentityExpired(Ed25519KeyIdentity.generate())).toBe(false);
        expect(getDelegationExpiryMs({ getDelegation: () => ({ delegations: [] }) })).toBe(null);
    });
});

describe('isAuthExpiredError', () => {
    it('recognises the replica and agent-js expired-delegation messages', () => {
        const queryBody = 'Server returned an error:\n  Code: 400 (Bad Request)\n  Body: Invalid delegation expiry: Specified sender delegation has expired:\n'
            + 'Provided expiry:    2026-10-24 10:00:00 UTC\nLocal replica time: 2026-10-24 11:00:00 UTC\n';
        expect(isAuthExpiredError(new Error(queryBody))).toBe(true);
        expect(isAuthExpiredError('Invalid signature: Invalid delegation expiry: Specified sender delegation has expired')).toBe(true);
        expect(isAuthExpiredError(new Error("This identity has expired due this application's security policy. Please refresh your authentication."))).toBe(true);
        expect(isAuthExpiredError(new Error('call failed', { cause: new Error('Specified sender delegation has expired') }))).toBe(true);
        expect(isAuthExpiredError({ reject_message: 'Invalid delegation expiry: …' })).toBe(true);
    });

    it('leaves other errors alone (clock skew, rejects, traps, ledger errors)', () => {
        expect(isAuthExpiredError(new Error('Specified ingress_expiry not within expected range: Minimum allowed expiry: …'))).toBe(false);
        expect(isAuthExpiredError(new Error('Canister rrkah-fqaaa-aaaaa-aaaaq-cai trapped: unauthorized'))).toBe(false);
        expect(isAuthExpiredError({ InsufficientFunds: { balance: 0n } })).toBe(false);
        expect(isAuthExpiredError(new Error('Failed to fetch'))).toBe(false);
        expect(isAuthExpiredError(null)).toBe(false);
        expect(isAuthExpiredError(undefined)).toBe(false);
    });

    it('reportIfAuthExpired tells the auth provider only about expired logins', () => {
        const seen = [];
        const off = onAuthExpired((e) => seen.push(e));
        expect(reportIfAuthExpired(new Error('Failed to fetch'))).toBe(false);
        expect(reportIfAuthExpired(new Error('Invalid delegation expiry: Specified sender delegation has expired'))).toBe(true);
        off();
        expect(reportIfAuthExpired(new Error('Specified sender delegation has expired'))).toBe(true);
        expect(seen).toHaveLength(1);
    });
});

describe('an expired login against a replica (PocketIC over the HTTP gateway)', () => {
    let pic, host, ledgerId;
    const actor = async (identity) => {
        const agent = await HttpAgent.create({ host, identity, shouldFetchRootKey: true, verifyQuerySignatures: false });
        return Actor.createActor(ledgerIdl, { agent, canisterId: ledgerId });
    };
    const account = (p) => ({ owner: p, subaccount: [] });

    beforeAll(async () => {
        ({ pic } = await createPic());
        ledgerId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 10_000n, symbol: 'TOK', decimals: 8 }] });
        host = `http://127.0.0.1:${await pic.makeLive()}`;
    });
    afterAll(async () => { await pic?.tearDown(); });

    it('a live delegation works', async () => {
        const { identity } = await login([Date.now() + HOUR]);
        const l = await actor(identity);
        expect(await l.icrc1_balance_of(account(identity.getPrincipal()))).toBe(0n);
    });

    it('a query with an expired delegation fails with an error isAuthExpiredError recognises', async () => {
        const { identity } = await login([Date.now() - 60_000]);
        expect(isIdentityExpired(identity)).toBe(true);
        const l = await actor(identity);
        const err = await l.icrc1_balance_of(account(identity.getPrincipal())).then(() => null, (e) => e);
        expect(err, 'the replica accepted an expired delegation').not.toBe(null);
        console.log('replica query error:', err.message);
        expect(isAuthExpiredError(err)).toBe(true);
    });

    it('a send (icrc1_transfer) with an expired delegation fails with an error isAuthExpiredError recognises', async () => {
        const { identity } = await login([Date.now() - 60_000]);
        const l = await actor(identity);
        const to = Ed25519KeyIdentity.generate().getPrincipal();
        const err = await l.icrc1_transfer({ from_subaccount: [], to: account(to), amount: 1n, fee: [], memo: [], created_at_time: [] }).then(() => null, (e) => e);
        expect(err, 'the replica accepted an expired delegation').not.toBe(null);
        console.log('replica update error:', err.message);
        expect(isAuthExpiredError(err)).toBe(true);
    });
});
