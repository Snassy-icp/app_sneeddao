// One picker for "one of my pockets" (spec/programmable_accounts.md §4.5): send from, Move to,
// receive on, approve from. Shows name · number, host badge and balance; offers a new pocket when
// `allowNew`. A native select with explicit colours, so it reads in dark mode too.
//
//   <PocketPicker ledger value onChange filter="from" | "to" | "approve" | "receive" allowNew
//                 decimals symbol allLabel="All pockets" exclude={[pocketId]} />
import React, { useMemo, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { usePockets } from '../hooks/usePockets';
import { pickable, displayName, badge, totalIn, balanceOf, sortPockets, ALL, KIND } from '../utils/pockets/model';
import { formatAmount } from '../utils/StringUtils';

const NEW = '__new__';

export function pocketOptionLabel(p, ledger, { decimals, symbol } = {}) {
    const b = ledger != null ? balanceOf(p, ledger) : null;
    let bal = '';
    if (ledger != null && decimals != null) {
        const free = b ? (b.available ?? b.total) : totalIn(p, ledger);
        bal = ` · ${b?.locked > 0n ? 'free ' : ''}${formatAmount(free, decimals)}${symbol ? ` ${symbol}` : ''}${b?.locked > 0n ? ` (locked ${formatAmount(b.locked, decimals)})` : ''}`;
    }
    const shield = p.grants ? ` · 🛡${p.grants}` : '';
    const name = displayName(p);
    const b2 = p.kind === KIND.wallet || badge(p) === name || name.endsWith(` · ${badge(p)}`) ? '' : ` (${badge(p)})`;
    const empty = p.kind === KIND.wallet && p.id !== 'w:0' && ![...p.balances.values()].some((x) => x.total > 0n) ? ' · empty' : '';
    return `${name}${b2}${empty || bal}${shield}`;
}

export default function PocketPicker({ ledger, value, onChange, filter = 'from', allowNew = false, decimals, symbol, allLabel = null, exclude = [], pockets: given, style, disabled }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const pk = usePockets();
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState(null);
    const options = useMemo(() => sortPockets((given || pickable(pk.pockets, ledger, filter)).filter((p) => !exclude.includes(p.id))), [given, pk.pockets, ledger, filter, exclude]);

    const pick = async (v) => {
        setError(null);
        if (v !== NEW) { onChange?.(v === ALL ? ALL : v); return; }
        setCreating(true);
        try { onChange?.(await pk.create({})); } catch (e) { setError(e?.message || String(e)); } finally { setCreating(false); }
    };

    const selectStyle = {
        width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '0.6rem 0.75rem', borderRadius: 10,
        border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText, fontSize: '0.9rem', cursor: 'pointer', ...style,
    };
    const optionStyle = { background: c.secondaryBg, color: c.primaryText };
    return (
        <div style={{ minWidth: 0 }}>
            <select value={value ?? (allLabel ? ALL : '')} onChange={(e) => pick(e.target.value)} style={selectStyle} disabled={disabled || creating} aria-label="Pocket">
                {allLabel && <option value={ALL} style={optionStyle}>{allLabel}</option>}
                {!allLabel && value == null && <option value="" style={optionStyle} disabled>Choose a pocket…</option>}
                {options.map((p) => <option key={p.id} value={p.id} style={optionStyle}>{pocketOptionLabel(p, ledger, { decimals, symbol })}</option>)}
                {allowNew && <option value={NEW} style={optionStyle}>{creating ? 'Creating…' : '+ New pocket'}</option>}
            </select>
            {error && <div style={{ color: c.error, fontSize: '0.8rem', marginTop: 4 }}>{error}</div>}
        </div>
    );
}
