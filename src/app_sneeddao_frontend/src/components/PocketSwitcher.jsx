// The pocket switcher at the top of the wallet (spec/programmable_accounts.md §4.3): All pockets
// (default) or one pocket. Remembered per viewer (PocketsContext, localStorage). Casual and pro: it
// shows only when the user has a pocket besides Main and the Sneed Lock wallet.
import React from 'react';
import { Link } from 'react-router-dom';
import { FaLayerGroup } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { usePockets } from '../hooks/usePockets';
import { hasExtraPockets, listed, sortPockets, displayName, badge, ALL, KIND } from '../utils/pockets/model';

export default function PocketSwitcher({ style }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const pk = usePockets();
    if (!hasExtraPockets(pk.pockets)) return null;
    const options = sortPockets(listed(pk.pockets));
    const sel = { padding: '0.45rem 0.6rem', borderRadius: 8, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText, fontSize: '0.85rem', maxWidth: '100%', minWidth: 0 };
    const opt = { background: c.secondaryBg, color: c.primaryText };
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem', ...style }}>
            <FaLayerGroup size={13} style={{ color: c.mutedText }} />
            <select value={pk.selected} onChange={(e) => pk.setSelected(e.target.value)} style={sel} aria-label="Show pocket">
                <option value={ALL} style={opt}>All pockets</option>
                {options.map((p) => <option key={p.id} value={p.id} style={opt}>{displayName(p)}{p.kind === KIND.wallet || displayName(p).includes(badge(p)) ? '' : ` (${badge(p)})`}</option>)}
            </select>
            {pk.selected !== ALL && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: c.mutedText, cursor: 'pointer' }}>
                    <input type="checkbox" checked={pk.hideEmpty} onChange={(e) => pk.setHideEmpty(e.target.checked)} />
                    Only tokens it holds
                </label>
            )}
            {pk.loading && <span style={{ fontSize: '0.75rem', color: c.mutedText }}>reading pockets…</span>}
            <Link to="/wallet/pockets" style={{ fontSize: '0.8rem', color: c.accent, marginLeft: 'auto' }}>Manage pockets</Link>
        </div>
    );
}
