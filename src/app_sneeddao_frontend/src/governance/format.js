// Plain-text rendering of decoded Candid values with the registry's field hints, for proposal
// titles and summaries (components/CandidValue.jsx renders the same in the page).

const isPrincipal = (v) => v && typeof v === 'object' && typeof v.toText === 'function' && v._isPrincipal !== false && typeof v.toUint8Array === 'function';

/// A token amount in base units (e8s) as "1.25 ICP".
export function formatE8s(v, symbol = '', decimals = 8) {
    const n = BigInt(v);
    const neg = n < 0n;
    const a = neg ? -n : n;
    const unit = 10n ** BigInt(decimals);
    const whole = a / unit;
    const frac = (a % unit).toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${neg ? '-' : ''}${whole.toLocaleString()}${frac ? `.${frac}` : ''}${symbol ? ` ${symbol}` : ''}`;
}

export function formatDuration(seconds) {
    const s = Number(seconds);
    if (s % 86_400 === 0 && s >= 86_400) return `${(s / 86_400).toLocaleString()} day${s === 86_400 ? '' : 's'}`;
    if (s % 3_600 === 0 && s >= 3_600) return `${s / 3_600} hour${s === 3_600 ? '' : 's'}`;
    if (s % 60 === 0 && s >= 60) return `${s / 60} minute${s === 60 ? '' : 's'}`;
    return `${s.toLocaleString()} second${s === 1 ? '' : 's'}`;
}

/// Any decoded value as compact text (records as {a: 1, b: x}, variants as #tag(value)).
export function genericText(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (isPrincipal(v)) return v.toText();
    if (v instanceof Uint8Array) return `0x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    if (Array.isArray(v)) return `[${v.map(genericText).join(', ')}]`;
    const keys = Object.keys(v);
    if (keys.length === 1 && (v[keys[0]] === null)) return `#${keys[0]}`;
    return `{${keys.map((k) => `${k}: ${genericText(v[k])}`).join(', ')}}`;
}

/// One argument with its hint ({ kind, keep }): bps, e8s:<SYMBOL>, ns, seconds, days, principal, bool, nat.
export function formatField(value, hint = {}) {
    let v = value;
    if (hint.keep && Array.isArray(v)) {
        if (v.length === 0) return 'unchanged';
        v = v[0];
    }
    const kind = hint.kind || '';
    try {
        if (kind === 'bps') return `${(Number(v) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
        if (kind.startsWith('e8s')) return formatE8s(v, kind.split(':')[1] || '');
        if (kind === 'ns') return formatDuration(BigInt(v) / 1_000_000_000n);
        if (kind === 'seconds') return formatDuration(v);
        if (kind === 'days') return `${Number(v).toLocaleString()} days`;
        if (kind === 'principal') return isPrincipal(v) ? v.toText() : genericText(v);
        if (kind === 'bool') return v ? 'yes' : 'no';
    } catch { /* fall through */ }
    return genericText(v);
}

/// [{ name, text }] for an argument tuple.
export function formatArgs(values, fields = {}) {
    return values.map((v, i) => ({ name: fields[i]?.name || `Argument ${i + 1}`, text: formatField(v, fields[i]) }));
}
