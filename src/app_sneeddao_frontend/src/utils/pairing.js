// "Pair this app": log in the installed app (PWA) through a browser where you are logged in.
//
// Internet Identity answers its login popup by postMessage to the window that opened it. An app
// installed to the iPhone home screen loses that link, so the popup login completes but never
// returns. Instead, the app shows a link with its own session public key; a logged-in browser
// signs a delegation from the user's session to that key (one more link in the chain II made);
// the user copies it back into the app. The delegation is useless without the app's private key,
// which never leaves the app, so the copied text is not a secret. A short check code, derived
// from the key and shown on both screens, guards against approving someone else's app.
import { DelegationChain, DelegationIdentity, Ed25519KeyIdentity, Ed25519PublicKey, isDelegationValid } from '@dfinity/identity';
import { IdbStorage, KEY_STORAGE_KEY, KEY_STORAGE_DELEGATION } from '@dfinity/auth-client';

const toHex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => new Uint8Array((h.match(/.{1,2}/g) || []).map((x) => parseInt(x, 16)));

/// Running as an installed app (home screen), not in a browser tab.
export const isStandaloneApp = () => {
    try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch { return false; }
};
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/// A short code from the key, e.g. "K7Q-2MX": both screens show it.
export async function checkCode(keyHex) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', fromHex(keyHex)));
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
    const chars = Array.from(digest.slice(0, 6), (b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 3)}-${chars.slice(3)}`;
}

/// The app's session key (the one AuthClient will use), created if there is none yet.
async function appSessionKey() {
    const storage = new IdbStorage();
    const stored = await storage.get(KEY_STORAGE_KEY);
    if (typeof stored === 'string') {
        try { return Ed25519KeyIdentity.fromJSON(stored); } catch { /* replaced below */ }
    }
    const key = await Ed25519KeyIdentity.generate();
    await storage.set(KEY_STORAGE_KEY, JSON.stringify(key.toJSON()));
    await storage.remove(KEY_STORAGE_DELEGATION);
    return key;
}

/// In the app: what to show for pairing.
export async function startPairing() {
    const key = await appSessionKey();
    const keyHex = toHex(key.getPublicKey().toDer());
    return { keyHex, code: await checkCode(keyHex), url: `${window.location.origin}/pair?key=${keyHex}` };
}

/// In the browser: sign the app's key into the logged-in session's chain. Returns the text to copy.
export async function approvePairing(identity, keyHex) {
    if (!(identity instanceof DelegationIdentity)) throw new Error('Log in first');
    const previous = identity.getDelegation();
    // the new link expires with the session it extends
    const expiresNs = previous.delegations.reduce((m, d) => (d.delegation.expiration < m ? d.delegation.expiration : m), previous.delegations[0].delegation.expiration);
    const to = Ed25519PublicKey.fromDer(fromHex(keyHex));
    const chain = await DelegationChain.create(identity, to, new Date(Number(expiresNs / 1_000_000n)), { previous });
    return JSON.stringify(chain.toJSON());
}

/// In the app: store the pasted approval, so AuthClient picks it up as a login.
export async function completePairing(text) {
    let chain;
    try { chain = DelegationChain.fromJSON(text.trim()); } catch { throw new Error('That is not a pairing approval. Copy it again from the browser.'); }
    const key = await appSessionKey();
    const last = chain.delegations[chain.delegations.length - 1];
    if (toHex(last.delegation.pubkey) !== toHex(key.getPublicKey().toDer())) throw new Error('This approval is for another app or an older pairing link. Start pairing again.');
    if (!isDelegationValid(chain)) throw new Error('This approval has expired. Start pairing again.');
    await new IdbStorage().set(KEY_STORAGE_DELEGATION, JSON.stringify(chain.toJSON()));
    return DelegationIdentity.fromDelegation(key, chain).getPrincipal().toText();
}
