// When the login (the Internet Identity delegation chain) runs out. AuthClient checks the chain only
// when the page loads, so a tab left open past the expiry kept showing the user as logged in while
// every authenticated call failed. AuthContext uses these to notice the expiry itself, and pages can
// pass caught errors to reportIfAuthExpired so a call the replica refused logs the app out too.

/// The moment (ms since the epoch) the earliest delegation in the identity's chain expires, or null
/// when the identity has no delegation chain (anonymous, or a plain key). Works for a
/// DelegationIdentity (getDelegation()) and a PartialDelegationIdentity (.delegation), and for a
/// DelegationChain itself.
export function getDelegationExpiryMs(identityOrChain) {
    if (!identityOrChain) return null;
    let chain = null;
    try {
        if (typeof identityOrChain.getDelegation === 'function') chain = identityOrChain.getDelegation();
        else if (identityOrChain.delegation?.delegations) chain = identityOrChain.delegation;
        else if (identityOrChain.delegations) chain = identityOrChain;
    } catch {
        return null;
    }
    const delegations = chain?.delegations;
    if (!Array.isArray(delegations) || delegations.length === 0) return null;
    let min = null;
    for (const d of delegations) {
        const exp = d?.delegation?.expiration; // nanoseconds, a BigInt
        if (exp === undefined || exp === null) continue;
        const ms = Number(BigInt(exp) / 1_000_000n);
        if (min === null || ms < min) min = ms;
    }
    return min;
}

/// True when the identity's delegation chain has expired at `nowMs` (same test as AuthClient's
/// isDelegationValid: expired at or after the expiry moment). False when there is no chain.
export function isIdentityExpired(identityOrChain, nowMs = Date.now()) {
    const exp = getDelegationExpiryMs(identityOrChain);
    return exp !== null && exp <= nowMs;
}

// What the replica (and boundary nodes, and agent-js) say when a request is signed with an expired
// delegation: queries and calls get a 400 whose body is "Invalid delegation expiry: Specified sender
// delegation has expired: Provided expiry: … Local replica time: …" (test/canisters/tests/
// auth-expiry.test.js gets exactly this from PocketIC). agent-js itself throws IdentityInvalidError
// ("This identity has expired due this application's security policy …") once an identity was
// invalidated. Deliberately not "ingress_expiry" (the clock-skew error: the request, not the login).
const AUTH_EXPIRED_PATTERNS = [
    /invalid delegation expiry/i,
    /sender delegation has expired/i,
    /delegation has expired/i,
    /this identity has expired/i,
];

function collectText(err, out, depth) {
    if (err === null || err === undefined || depth > 3) return;
    if (typeof err === 'string') { out.push(err); return; }
    if (typeof err !== 'object') return;
    for (const k of ['message', 'reject_message', 'rejectMessage', 'body', 'name']) {
        if (typeof err[k] === 'string') out.push(err[k]);
    }
    try { const s = String(err); if (s && s !== '[object Object]') out.push(s); } catch { /* ignore */ }
    if (err.cause) collectText(err.cause, out, depth + 1);
    if (err.props && typeof err.props === 'object') {
        for (const v of Object.values(err.props)) if (typeof v === 'string') out.push(v);
    }
}

/// True when `err` (an agent error, an Error with a cause, a reject message string) says the
/// caller's delegation has expired.
export function isAuthExpiredError(err) {
    const texts = [];
    collectText(err, texts, 0);
    if (err?.name === 'IdentityInvalidError' || err?.constructor?.name === 'IdentityInvalidError') return true;
    return texts.some((t) => AUTH_EXPIRED_PATTERNS.some((re) => re.test(t)));
}

// AuthProvider listens here, so code outside React (catch blocks in pages, helpers) can tell it.
const listeners = new Set();

export function onAuthExpired(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/// Call from a catch block: when `err` is an expired-login error, the app logs out and shows the
/// "session expired" banner. Returns whether it was one, so callers can skip their own message.
export function reportIfAuthExpired(err) {
    if (!isAuthExpiredError(err)) return false;
    for (const fn of listeners) {
        try { fn(err); } catch (e) { console.error('auth-expired listener failed:', e); }
    }
    return true;
}
