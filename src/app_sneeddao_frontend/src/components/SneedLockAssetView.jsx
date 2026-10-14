// Views of a Sneed Lock asset (a token lock or a locked LP position) outside
// the wallet: an icon, a one-line title and an expanded detail card. Used by
// Sneedex offers. Token facts come from the token cache, pool facts from the
// pool's own metadata; both are read anonymously.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaLock, FaWater, FaExternalLinkAlt } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useDenomination } from '../contexts/DenominationContext';
import { getTokenMetadata } from '../hooks/useTokenCache';
import { describeSwapPool } from './SwapPoolPicker';
import { get_token_conversion_rate } from '../utils/TokenUtils';

const poolCache = new Map();
const describePoolCached = (id) => { if (!poolCache.has(id)) { const p = describeSwapPool(id); p.catch(() => poolCache.delete(id)); poolCache.set(id, p); } return poolCache.get(id); };

export const fmtUnits = (v, d, max = 4) => (Number(v) / 10 ** d).toLocaleString('en-US', { maximumFractionDigits: Math.min(d, max) });
export const lockExpiryDate = (expiryNs) => new Date(Number(BigInt(expiryNs) / 1_000_000n));
export const lockUrl = (lockId) => `/lock/${lockId.toString()}`;

/// { token, pool, usd } for a lock asset's details (from getAssetDetails).
export function useSneedLockAsset(details) {
    const [state, setState] = useState({ token: null, pool: null, usd: null });
    const key = details ? `${details.kind}:${details.ledger_id || details.swap_id}` : '';
    useEffect(() => {
        let alive = true;
        if (!details) return;
        (async () => {
            try {
                if (details.kind === 'token') {
                    const token = await getTokenMetadata(details.ledger_id).catch(() => null);
                    const decimals = Number(token?.decimals ?? 8);
                    const rate = await get_token_conversion_rate(details.ledger_id, decimals).catch(() => null);
                    const usd = rate ? (Number(details.amount) / 10 ** decimals) * Number(rate) : null;
                    if (alive) setState({ token, pool: null, usd });
                } else {
                    const pool = await describePoolCached(details.swap_id).catch(() => null);
                    if (alive) setState({ token: null, pool, usd: null });
                }
            } catch { /* display only */ }
        })();
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, details?.amount?.toString?.()]);
    return state;
}

/// One line: "1,000 SNEED locked until 3 Jan 2027" / "Locked LP position #12 in SNEED/ICP until …".
export function sneedLockAssetText(details, token, pool) {
    if (!details) return '';
    const until = lockExpiryDate(details.expiry).toLocaleDateString();
    if (details.kind === 'token') {
        const d = Number(token?.decimals ?? 8);
        return `${fmtUnits(details.amount, d)} ${token?.symbol || 'tokens'} locked until ${until}`;
    }
    const pair = pool ? `${pool.token0.symbol}/${pool.token1.symbol}` : 'ICPSwap';
    return `Locked LP position #${details.position_id} in ${pair} until ${until}`;
}

export function SneedLockAssetIcon({ details, size = 36 }) {
    const { token, pool } = useSneedLockAsset(details);
    const img = details?.kind === 'token' ? token?.logo : pool?.token0?.logo;
    return (
        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
            <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (details?.kind === 'position' ? <FaWater style={{ fontSize: size * 0.5, color: '#06b6d4' }} /> : <FaLock style={{ fontSize: size * 0.5, color: '#f59e0b' }} />)}
            </div>
            <FaLock style={{ position: 'absolute', bottom: -2, right: -2, fontSize: Math.max(10, size * 0.38), color: '#f59e0b', background: '#1f2937', borderRadius: '50%', padding: 2 }} />
        </div>
    );
}

export function SneedLockAssetTitle({ details }) {
    const { theme } = useTheme();
    const { token, pool } = useSneedLockAsset(details);
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
            <span>{sneedLockAssetText(details, token, pool)}</span>
            <Link to={lockUrl(details.lock_id)} style={{ fontSize: '0.8rem', fontWeight: 400, color: theme.colors.accent, textDecoration: 'none' }}>Sneed Lock #{details.lock_id.toString()}</Link>
        </span>
    );
}

export function SneedLockAssetDetails({ details }) {
    const { theme } = useTheme();
    const { formatValue } = useDenomination();
    const { token, pool, usd } = useSneedLockAsset(details);
    const label = { fontSize: '0.72rem', fontWeight: 600, color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px' };
    const row = (k, v) => (<React.Fragment key={k}><span style={label}>{k}</span><span style={{ fontSize: '0.85rem', color: theme.colors.primaryText, wordBreak: 'break-all' }}>{v}</span></React.Fragment>);
    const expiry = lockExpiryDate(details.expiry);
    const daysLeft = Math.max(0, Math.round((expiry.getTime() - Date.now()) / 86_400_000));
    return (
        <div onClick={(e) => e.stopPropagation()} style={{ marginTop: '1rem', padding: '1rem', background: theme.colors.secondaryBg, borderRadius: 10, border: `1px solid ${theme.colors.border}` }}>
            <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, marginBottom: 10, lineHeight: 1.5 }}>
                {details.kind === 'token'
                    ? 'A Sneed Lock token lock: the tokens sit in Sneed Lock and cannot be withdrawn until the lock expires. The buyer receives the lock itself, and with it the tokens once it expires.'
                    : 'A locked ICPSwap LP position held by Sneed Lock: it earns fees as usual, cannot be withdrawn until the lock expires, and the buyer receives its ownership inside Sneed Lock.'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', alignItems: 'baseline' }}>
                {row('Lock', <Link to={lockUrl(details.lock_id)} style={{ color: theme.colors.accent }}>#{details.lock_id.toString()}</Link>)}
                {details.kind === 'token' && row('Amount', `${fmtUnits(details.amount, Number(token?.decimals ?? 8), 8)} ${token?.symbol || ''}${usd != null ? ` (${formatValue ? formatValue(usd) : `$${usd.toFixed(2)}`})` : ''}`)}
                {details.kind === 'token' && row('Ledger', <Link to={`/tokenlock?ledger=${details.ledger_id}&locks=${details.lock_id}`} style={{ color: theme.colors.accent, fontFamily: 'monospace', fontSize: '0.8rem' }}>{token?.name ? `${token.name} · ` : ''}{details.ledger_id}</Link>)}
                {details.kind === 'position' && row('Pool', pool ? `${pool.token0.symbol}/${pool.token1.symbol}` : details.swap_id)}
                {details.kind === 'position' && row('Position', <Link to={`/position?swap=${details.swap_id}&id=${details.position_id}`} style={{ color: theme.colors.accent }}>#{details.position_id.toString()} <FaExternalLinkAlt size={9} /></Link>)}
                {row('Unlocks', `${expiry.toLocaleString()} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)`)}
                {row('Held by', 'Sneed Lock, ownership escrowed in Sneedex')}
            </div>
        </div>
    );
}
