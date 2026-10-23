// Small visual pieces shared by the pocket rows, the switcher list and the Pockets page: the pocket's
// avatar (its number, or its host's logo), the host badge with logo, and a token amount with logo,
// symbol and value (useDenomination). Theme colours only, so dark mode follows.
import React from 'react';
import { FaWallet, FaLayerGroup } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useDenomination } from '../contexts/DenominationContext';
import { formatAmount, computeUsdValue } from '../utils/StringUtils';
import { KIND, MAIN_ID, badge, displayName } from '../utils/pockets/model';

export const HOST_LOGOS = {
    sneed_lock: '/sneedlock-logo-cropped.png',
    sneedex: '/sneed_logo.png',
    icpswap: '/icpswap.png',
    sneed_mon: '/sneed_logo.png',
    sneed_notifications: '/sneed_logo.png',
};

const shortTag = (p) => {
    if (p.id === MAIN_ID) return null;
    if (p.number != null) return `#${p.number}`;
    return '#…';
};

/// A round avatar: Main's wallet, "#n" for a numbered pocket, or the host's logo.
export function PocketAvatar({ pocket: p, size = 34 }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const box = { width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' };
    if (p.kind !== KIND.wallet) {
        const logo = HOST_LOGOS[p.adapterId];
        return (
            <div style={{ ...box, background: c.tertiaryBg, border: `1px solid ${c.border}` }}>
                {logo ? <img src={logo} alt="" style={{ width: size * 0.72, height: size * 0.72, objectFit: 'contain' }} /> : <FaLayerGroup size={size * 0.4} color={c.mutedText} />}
            </div>
        );
    }
    const tag = shortTag(p);
    return (
        <div style={{ ...box, background: `linear-gradient(135deg, ${c.accent}, ${c.accent}aa)`, color: '#fff', fontWeight: 700, fontSize: tag && tag.length > 3 ? size * 0.3 : size * 0.38 }}>
            {tag || <FaWallet size={size * 0.42} />}
        </div>
    );
}

/// "Wallet", "Sneed Lock", "Service balance"… with the host's logo.
export function HostBadge({ pocket: p }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const logo = p.kind !== KIND.wallet ? HOST_LOGOS[p.adapterId] : null;
    const tone = p.kind === KIND.service ? c.warning : p.kind === KIND.hosted ? c.accent : c.success;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.66rem', fontWeight: 600, padding: '1px 6px', borderRadius: 999, color: tone, background: `${tone}18`, border: `1px solid ${tone}40`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', boxSizing: 'border-box', verticalAlign: 'middle' }}>
            {logo && <img src={logo} alt="" style={{ width: 10, height: 10, objectFit: 'contain', flexShrink: 0 }} />}
            {badge(p) === displayName(p) ? (p.kind === KIND.service ? 'Service balance' : 'Holds for you') : badge(p)}
        </span>
    );
}

/// A token amount: logo, amount and symbol, and its value under it.
export function TokenAmount({ token, amount, align = 'right', strong = true, sub = null }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const { formatValue } = useDenomination();
    const usd = token?.conversion_rate ? computeUsdValue(amount, token.decimals, token.conversion_rate) : null;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: align === 'right' ? 'flex-end' : 'flex-start', minWidth: 0 }}>
            {token?.logo ? <img src={token.logo} alt="" style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} /> : null}
            <div style={{ textAlign: align, minWidth: 0 }}>
                <div style={{ fontSize: '0.9rem', fontWeight: strong ? 700 : 500, color: c.primaryText, overflowWrap: 'anywhere' }}>
                    {formatAmount(amount, token?.decimals ?? 8)} <span style={{ color: c.secondaryText, fontWeight: 600 }}>{token?.symbol || ''}</span>
                </div>
                {(usd != null && usd > 0) || sub ? (
                    <div style={{ fontSize: '0.72rem', color: c.mutedText }}>{usd != null && usd > 0 ? formatValue(usd) : ''}{sub ? `${usd ? ' · ' : ''}${sub}` : ''}</div>
                ) : null}
            </div>
        </div>
    );
}

/// A pill action button, the same everywhere pockets show.
export function PocketButton({ icon: Icon, children, onClick, title, primary = false, disabled = false, small = false }) {
    const { theme } = useTheme();
    const c = theme.colors;
    return (
        <button type="button" title={title} disabled={disabled} onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: small ? 5 : 6, padding: small ? '4px 9px' : '6px 12px', fontSize: small ? '0.72rem' : '0.78rem', fontWeight: 600, borderRadius: small ? 8 : 999, whiteSpace: 'nowrap', lineHeight: 1.3,
                cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1,
                background: primary ? c.accent : 'transparent', color: primary ? '#fff' : c.primaryText,
                border: primary ? `1px solid ${c.accent}` : `1px solid ${c.border}`,
            }}>
            {Icon && <Icon size={small ? 9 : 11} />} {children}
        </button>
    );
}
