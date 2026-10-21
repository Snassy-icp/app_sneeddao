// A small badge next to a price when the user gets a special price (spec/special_prices.md):
// "Admin price" or "Partner price" (with the partner's public label as a tooltip). Renders
// nothing for the regular and premium tiers, which pages already show in their own way.
import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

export default function PriceTierBadge({ tier, partnerLabel = null, style = {} }) {
    const { theme } = useTheme();
    if (tier !== 'admin' && tier !== 'partner') return null;
    const color = tier === 'admin' ? (theme.colors.warning || '#f39c12') : (theme.colors.success || '#2ecc71');
    const text = tier === 'admin' ? 'Admin price' : 'Partner price';
    const title = tier === 'admin'
        ? 'You are an admin of this canister: its admin price applies to you (it is public in the canister\'s configuration).'
        : `Partner price${partnerLabel ? ` for ${partnerLabel}` : ''}: set by the DAO for your principal (public in the canister's configuration).`;
    return (
        <span
            title={title}
            style={{
                display: 'inline-block', marginLeft: 6, padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                lineHeight: '16px', verticalAlign: 'middle', color, border: `1px solid ${color}`, background: `${color}1f`, whiteSpace: 'nowrap', ...style,
            }}
        >
            {text}
        </span>
    );
}
