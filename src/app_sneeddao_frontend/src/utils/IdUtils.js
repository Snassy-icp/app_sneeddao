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
