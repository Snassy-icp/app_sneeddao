import { Principal } from '@dfinity/principal';
// Like normalizeId, but also revives Principal objects that lost their prototype
// (e.g. positions restored from a cache), which show up as { _arr: ... }.
export const principalText = (value) => {
    if (value && typeof value === 'object' && typeof value.toText !== 'function' && value._arr) {
        try {
            const bytes = value._arr instanceof Uint8Array ? value._arr : Uint8Array.from(Object.values(value._arr));
            return Principal.fromUint8Array(bytes).toText();
        } catch (e) { /* fall through */ }
    }
    return normalizeId(value);
};

export const normalizeId = (canisterId) => {
    if (!canisterId) return '';
    if (typeof canisterId === 'string') return canisterId;
    if (typeof canisterId === 'bigint') return canisterId.toString();

    if (typeof canisterId === 'object') {
        if (typeof canisterId.toText === 'function') return canisterId.toText();

        if (typeof canisterId.principal === 'string') return canisterId.principal;
        if (canisterId.principal && typeof canisterId.principal.toText === 'function') {
            return canisterId.principal.toText();
        }

        if (canisterId.__principal__ && typeof canisterId.__principal__ === 'string') {
            return canisterId.__principal__;
        }

        if (canisterId.__type === 'Principal' && canisterId.value) {
            return canisterId.value;
        }

        if (canisterId.value && typeof canisterId.value === 'string') {
            return canisterId.value;
        }

        if (typeof canisterId.toString === 'function') {
            const str = canisterId.toString();
            if (str !== '[object Object]') return str;
        }
    }

    return String(canisterId);
};
