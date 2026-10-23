// Avatars for many principals at once. Every principal goes into NamingContext's shared queue,
// which asks the naming canisters in one batch (50 per call) about 60 ms later, re-checks NFT
// avatars against their collections, and caches the answers in this browser — so a list of 100
// rows costs two calls, not 100, and a principal already asked about costs none.
import { useContext, useEffect, useMemo } from 'react';
import { Principal } from '@dfinity/principal';
import { NamingContext } from '../NamingContext';
import { isCanisterPrincipal } from '../utils/PrincipalUtils';

const textOf = (p) => {
    if (!p) return null;
    if (typeof p === 'string') return p;
    try { return p.toText ? p.toText() : p.toString(); } catch { return null; }
};

/// useAvatars(principals) -> { avatarOf(p) -> url | null, isResolved(p) -> boolean }
/// `principals`: an array of Principal objects or texts (duplicates and nulls are fine).
/// Canister principals are skipped (they have no user avatar).
export function useAvatars(principals) {
    const ctx = useContext(NamingContext);
    const request = ctx?.requestAvatar;
    const avatars = ctx?.avatars;
    // a stable key, so a new array with the same principals does not re-request
    const key = useMemo(() => {
        const set = new Set();
        for (const p of principals || []) {
            const t = textOf(p);
            if (!t) continue;
            let isCanister = false;
            try { isCanister = isCanisterPrincipal(typeof p === 'string' ? Principal.fromText(p) : p); } catch { continue; }
            if (isCanister) continue;
            set.add(t);
        }
        return [...set].sort().join(',');
    }, [principals]);
    useEffect(() => {
        if (!request || !key) return;
        for (const t of key.split(',')) request(t);
    }, [key, request]);
    return useMemo(() => ({
        avatarOf: (p) => { const t = textOf(p); return (t && avatars?.get(t)) || null; },
        isResolved: (p) => { const t = textOf(p); return Boolean(t && avatars?.has(t)); },
    }), [avatars]);
}

/// One principal: its avatar url or null (resolved through the same batch queue).
export function useAvatarOf(principal) {
    const list = useMemo(() => (principal ? [principal] : []), [textOf(principal)]); // eslint-disable-line react-hooks/exhaustive-deps
    return useAvatars(list).avatarOf(principal);
}

export default useAvatars;
