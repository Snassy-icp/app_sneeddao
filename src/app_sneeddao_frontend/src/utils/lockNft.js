// Sending a Sneed Lock as its ICRC-7 NFT (Sneed Lock v2, spec/sneed_lock_v2.md sections 2-4):
// any account, subaccount included. Token locks pay their ledger fee from the owner's free
// balance in Sneed Lock or the lock's gas tank; positions move for free.
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';

/** '' -> undefined (no subaccount), 64 hex characters -> bytes, anything else -> null (invalid). */
export function parseSubaccountHex(text) {
    const t = (text || '').trim().replace(/^0x/i, '');
    if (!t) return undefined;
    if (!/^[0-9a-fA-F]{64}$/.test(t)) return null;
    return Uint8Array.from(t.match(/../g).map((x) => parseInt(x, 16)));
}

export const isMissingMethod = (e) => /has no (query|update) method|Canister has no/i.test(String(e?.message || e));

const errText = (err) => {
    const k = Object.keys(err || {})[0];
    if (k === 'GenericError' || k === 'GenericBatchError') return err[k].message;
    return {
        Unauthorized: 'Only the account holding this lock can send it.',
        InvalidRecipient: 'That recipient is not valid (the same account, or anonymous).',
        NonExistingTokenId: 'This lock is not an NFT (it may have unlocked).',
        TooOld: 'The request is too old; try again.',
        Duplicate: 'This exact transfer was already made.',
    }[k] || k || 'Transfer failed';
};

/**
 * Sends NFT `tokenId` of the Sneed Lock collection from whichever of the caller's accounts holds
 * it to { owner: toPrincipal, subaccount: toSubaccount }. Answers the ICRC-3 block index. Throws
 * an Error with the canister's reason; `e.code` carries a GenericError code (7 = needs gas).
 * Throws an error matched by isMissingMethod against a Sneed Lock without ICRC-7.
 */
export async function sendLockNft(identity, tokenId, toPrincipal, toSubaccount) {
    const a = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
    const [owner] = await a.icrc7_owner_of([BigInt(tokenId)]);
    if (!owner.length) throw new Error('This lock is not an NFT (it may have unlocked).');
    const [r] = await a.icrc7_transfer([{
        from_subaccount: owner[0].subaccount,
        to: { owner: toPrincipal, subaccount: toSubaccount ? [toSubaccount] : [] },
        token_id: BigInt(tokenId),
        memo: [],
        created_at_time: [BigInt(Date.now()) * 1_000_000n],
    }]);
    const res = r[0];
    if (res && 'Ok' in res) return res.Ok;
    const e = new Error(errText(res?.Err));
    if (res?.Err?.GenericError) e.code = Number(res.Err.GenericError.error_code);
    throw e;
}

/** The NFT id of a locked position (its first lock id), or null. */
export async function positionNftId(swapCanisterId, positionId) {
    const a = createSneedLockActor(sneedLockCanisterId);
    const r = await a.get_position_nft(swapCanisterId, BigInt(positionId));
    return r.length ? r[0] : null;
}
