// Prev / page numbers / next, for paged lists. `page` is 0-based; `pages` is the page count.
import React from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';

/// The page numbers to show: the first, the last and two either side of the current one.
function numbers(page, pages) {
    const set = new Set([0, pages - 1]);
    for (let i = page - 2; i <= page + 2; i++) if (i >= 0 && i < pages) set.add(i);
    const list = [...set].sort((a, b) => a - b);
    const out = [];
    list.forEach((n, i) => { if (i > 0 && n - list[i - 1] > 1) out.push(`gap${n}`); out.push(n); });
    return out;
}

export default function Pager({ page, pages, onChange, disabled = false, accent }) {
    const { theme } = useTheme();
    const c = theme.colors;
    if (!pages || pages <= 1) return null;
    const color = accent || c.accent;
    const btn = (active, off) => ({
        minWidth: 32, height: 32, padding: '0 8px', borderRadius: 8, fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums',
        border: `1px solid ${active ? color : c.border}`, background: active ? `${color}22` : 'transparent',
        color: off ? c.mutedText : c.primaryText, cursor: off ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    });
    const go = (p) => { if (!disabled && p >= 0 && p < pages && p !== page) onChange(p); };
    return (
        <nav aria-label="Pages" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', marginTop: 10 }}>
            <button type="button" aria-label="Newer" disabled={disabled || page === 0} onClick={() => go(page - 1)} style={btn(false, disabled || page === 0)}><FaChevronLeft size={10} /></button>
            {numbers(page, pages).map((n) => (typeof n === 'string'
                ? <span key={n} style={{ color: c.mutedText, padding: '0 2px' }}>…</span>
                : <button key={n} type="button" aria-current={n === page ? 'page' : undefined} disabled={disabled} onClick={() => go(n)} style={btn(n === page, disabled)}>{n + 1}</button>))}
            <button type="button" aria-label="Older" disabled={disabled || page >= pages - 1} onClick={() => go(page + 1)} style={btn(false, disabled || page >= pages - 1)}><FaChevronRight size={10} /></button>
        </nav>
    );
}
