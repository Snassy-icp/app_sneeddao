// GLDT ⇄ sGLDT wrap / unwrap on a token card, with pockets (spec/programmable_accounts.md §4.3).
// The wrap flow (WrapUnwrapModal) works from Main only (the principal's default account), so:
//   - Main holds some: the Wrap / Unwrap button, as always;
//   - only other pockets (Sneed Lock, a numbered pocket…) hold it: the button still shows, as
//     "Move to Main to wrap", which opens the move dialog for the pocket holding it.
// Pure, so it is tested (test/canisters/tests/pockets-model.test.js).
import { otherPocketsTotal, holders, MAIN_ID, LOCK_POCKET_ID } from './pockets/model.js';
import { normalizeId } from './IdUtils.js';

export const GLDT_LEDGER = '6c7su-kiaaa-aaaar-qaira-cai';
export const SGLDT_LEDGER = 'i2s4q-syaaa-aaaan-qz4sq-cai';

const text = (p) => normalizeId(p);
const big = (v) => { try { return v == null ? 0n : BigInt(v); } catch { return 0n; } };

/// 'wrap' for GLDT, 'unwrap' for sGLDT, else null.
export const wrapKindOf = (ledger) => (text(ledger) === GLDT_LEDGER ? 'wrap' : text(ledger) === SGLDT_LEDGER ? 'unwrap' : null);

/// What the card's wrap button does, or null when it has nothing to offer:
/// { kind, fromMain, elsewhere, needsMove, source (pocket to move from, when needsMove), note }.
export function wrapAction(token, { pockets = [] } = {}) {
    const ledger = text(token?.ledger_canister_id || token?.principal);
    const kind = wrapKindOf(ledger);
    if (!kind) return null;
    const fromMain = big(token.balance);
    const lockFree = big(token.available_backend);
    const elsewhere = lockFree + otherPocketsTotal(pockets, ledger);
    if (fromMain <= 0n && elsewhere <= 0n) return null;
    const needsMove = fromMain <= 0n;
    const source = needsMove ? (holders(pockets, ledger).find((p) => p.id !== MAIN_ID) || (lockFree > 0n ? { id: LOCK_POCKET_ID } : null)) : null;
    const word = kind === 'wrap' ? 'GLDT' : 'sGLDT';
    return {
        kind, fromMain, elsewhere, needsMove, source,
        note: needsMove ? `Wrapping works from Main: move your ${word} to Main first.` : elsewhere > 0n ? `Wraps what is in Main; ${word} in your other pockets stays where it is.` : null,
    };
}
