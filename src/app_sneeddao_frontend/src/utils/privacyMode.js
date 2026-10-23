// Privacy mode: one switch that hides balances and amounts across the app (••••), for screen
// sharing and recording. It lives here, outside React, so the shared formatters (formatAmount and
// getUSD in StringUtils, formatValue in DenominationContext) can read it without every page
// taking part. ThemeProvider and DenominationProvider subscribe to it, so flipping it re-renders
// everything that uses the theme or the denomination.
//
// What stays visible on purpose: what the user types into inputs, and the amount being signed on
// the review/confirmation step of a send, swap or withdraw (callers use formatAmountShown there).
// Persisted per browser; storage can be blocked, so every access is wrapped.

export const PRIVACY_MASK = '••••';
const STORAGE_KEY = 'sneed_privacy_mode_v1';

const read = () => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
};

let on = typeof window !== 'undefined' ? read() : false;
const listeners = new Set();

const applyDom = () => {
    try { document.documentElement.toggleAttribute('data-privacy', on); } catch { /* no DOM */ }
};
applyDom();

export const isPrivacyMode = () => on;

export function setPrivacyMode(value) {
    const next = !!value;
    if (next === on) return;
    on = next;
    try { if (on) localStorage.setItem(STORAGE_KEY, '1'); else localStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked */ }
    applyDom();
    listeners.forEach((fn) => { try { fn(on); } catch { /* listener failed */ } });
}

export const togglePrivacyMode = () => setPrivacyMode(!on);

export function subscribePrivacyMode(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** The text itself, or the mask while privacy mode is on. */
export const maskIfPrivate = (text) => (on ? PRIVACY_MASK : text);

// Another tab flipped it.
if (typeof window !== 'undefined') {
    try {
        window.addEventListener('storage', (e) => {
            if (e.key === STORAGE_KEY) setPrivacyMode(e.newValue === '1');
        });
    } catch { /* no window events */ }
}

/** True when a key event comes from something the user types into (shortcuts must not fire there). */
export function isTypingTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = (target.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
