// Views of a Sneed Lock asset (a token lock or a locked LP position) outside
// the wallet: an icon, a one-line title and an expanded detail card. Used by
// Sneedex offers. Token facts come from the token cache, pool facts from the
// pool's own metadata; both are read anonymously.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaLock, FaWater, FaExternalLinkAlt, FaSpinner } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useDenomination } from '../contexts/DenominationContext';
import { getTokenMetadata } from '../hooks/useTokenCache';
import { describeSwapPool } from './SwapPoolPicker';
import { get_token_conversion_rate, resolveTokenLogo } from '../utils/TokenUtils';
import { isUntilDissolved, formatNsDuration } from '../utils/lockTime';
import { LockUntil, LockAge } from './LockUntil';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { lockAssets, lockStatus, tokenLockValue, positionLockValue, fmtWhole, lockPageUrl } from '../utils/sneedLockNftModel';

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
    const until = isUntilDissolved(details.expiry) ? 'it dissolves' : lockExpiryDate(details.expiry).toLocaleDateString();
    if (details.kind === 'token') {
        const d = Number(token?.decimals ?? 8);
        return `${fmtUnits(details.amount, d)} ${token?.symbol || 'tokens'} locked until ${until}`;
    }
    const pair = pool ? `${pool.token0.symbol}/${pool.token1.symbol}` : 'ICPSwap';
    return `Locked LP position #${details.position_id} in ${pair} until ${until}`;
}

/// One token's logo in a circle; the symbol's first letter while there is none.
function LogoCircle({ logo, symbol, size, style }) {
    return (
        <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: 'rgba(6,182,212,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.45, fontWeight: 700, color: '#06b6d4', ...style }}>
            {logo ? <img src={logo} alt={symbol || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (symbol ? symbol.slice(0, 1).toUpperCase() : <FaWater style={{ fontSize: size * 0.5 }} />)}
        </div>
    );
}

export function SneedLockAssetIcon({ details, size = 36 }) {
    const { token, pool } = useSneedLockAsset(details);
    const badgeAt = (side) => <FaLock style={{ position: 'absolute', bottom: -2, [side]: -2, fontSize: Math.max(10, size * 0.38), color: '#f59e0b', background: '#1f2937', borderRadius: '50%', padding: 2 }} />;
    const badge = badgeAt('right');
    if (details?.kind === 'position') {
        // an LP position is a pair: both logos, overlapping, as the wallet draws them
        const d = Math.round(size * 0.68);
        const ring = { border: '2px solid #1f2937', boxSizing: 'border-box' };
        return (
            <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
                <LogoCircle logo={pool?.token0?.logo} symbol={pool?.token0?.symbol} size={d} style={{ position: 'absolute', left: 0, top: (size - d) / 2 - size * 0.08, ...ring }} />
                <LogoCircle logo={pool?.token1?.logo} symbol={pool?.token1?.symbol} size={d} style={{ position: 'absolute', right: 0, top: (size - d) / 2 + size * 0.08, ...ring }} />
                {/* bottom-left, under the raised first logo, so it covers neither */}
                {badgeAt('left')}
            </div>
        );
    }
    const img = token?.logo;
    return (
        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
            <div style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <FaLock style={{ fontSize: size * 0.5, color: '#f59e0b' }} />}
            </div>
            {badge}
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
    const dissolveHeld = isUntilDissolved(details.expiry);
    const expiry = lockExpiryDate(details.expiry);
    const daysLeft = dissolveHeld ? 0 : Math.max(0, Math.round((expiry.getTime() - Date.now()) / 86_400_000));
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
                {row('Unlocks', dissolveHeld
                    ? <span><LockUntil lockId={details.lock_id} expiry={details.expiry} />. <Link to={lockUrl(details.lock_id)} style={{ color: theme.colors.accent }}>See the lock</Link></span>
                    : `${expiry.toLocaleString()} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)`)}
                <LockAge lockId={details.lock_id} wrap={(v) => row('Age', v)} />
                {row('Held by', 'Sneed Lock, ownership escrowed in Sneedex')}
            </div>
        </div>
    );
}

// ---- a Sneed Lock NFT (ICRC-7, token id = lock id): what it holds and what that is worth ----

const ledgerCache = new Map();
/// { ledgerId, symbol, decimals, logo } from the token cache, else from the ledger (anonymously).
const describeLedgerCached = (id) => {
    if (!ledgerCache.has(id)) {
        const p = (async () => {
            const cached = await getTokenMetadata(id).catch(() => null);
            if (cached?.symbol && cached?.decimals !== undefined && cached?.decimals !== null) return { ledgerId: id, symbol: cached.symbol, decimals: Number(cached.decimals), logo: cached.logo || null };
            const ledger = createLedgerActor(id);
            const [metadata, symbol, decimals] = await Promise.all([ledger.icrc1_metadata(), ledger.icrc1_symbol(), ledger.icrc1_decimals()]);
            return { ledgerId: id, symbol, decimals: Number(decimals), logo: await resolveTokenLogo(id, metadata, symbol).catch(() => null) };
        })();
        p.catch(() => ledgerCache.delete(id));
        ledgerCache.set(id, p);
    }
    return ledgerCache.get(id);
};
const priceOf = (ledgerId, decimals) => get_token_conversion_rate(ledgerId, decimals).catch(() => 0);

/// { loading, error, state, assets, token, pool, value } for the lock behind a Sneed Lock NFT. All reads are anonymous queries.
export function useSneedLockNft(lockId) {
    const key = lockId === undefined || lockId === null ? '' : lockId.toString();
    const [st, setSt] = useState({ loading: true, error: '', state: null });
    useEffect(() => {
        let alive = true;
        if (!key) return undefined;
        setSt({ loading: true, error: '', state: null });
        (async () => {
            try {
                const r = await createSneedLockActor(sneedLockCanisterId).get_lock_state(BigInt(key));
                if (!r.length) { if (alive) setSt({ loading: false, error: 'This lock is no longer in Sneed Lock (it may have unlocked and been withdrawn).', state: null }); return; }
                const state = r[0];
                const assets = lockAssets(state);
                if (alive) setSt((o) => ({ ...o, state, assets }));
                if (assets.kind === 'token') {
                    const token = await describeLedgerCached(assets.ledger);
                    const value = tokenLockValue(assets.amount, token.decimals, await priceOf(assets.ledger, token.decimals));
                    if (alive) setSt({ loading: false, error: '', state, assets, token, value });
                } else {
                    const swap = createIcpSwapActor(assets.swap);
                    const [pool, meta, pos] = await Promise.all([describePoolCached(assets.swap), swap.metadata(), swap.getUserPosition(assets.positionId)]);
                    if (!meta || !('ok' in meta)) throw new Error('the pool did not answer its metadata');
                    if (!pos || !('ok' in pos)) throw new Error(`the pool did not answer position #${assets.positionId}`);
                    const [p0, p1] = await Promise.all([priceOf(pool.token0.ledgerId, pool.token0.decimals), priceOf(pool.token1.ledgerId, pool.token1.decimals)]);
                    const value = positionLockValue(pos.ok, meta.ok.sqrtPriceX96, pool.token0.decimals, pool.token1.decimals, p0, p1);
                    if (alive) setSt({ loading: false, error: '', state, assets, pool, value });
                }
            } catch (e) {
                if (alive) setSt((o) => ({ ...o, loading: false, error: `Could not read the lock: ${e?.message || e}` }));
            }
        })();
        return () => { alive = false; };
    }, [key]);
    return st;
}

/// "Locked until 7/25/2035 (3,195 days left)" and the like, from lockStatus.
function lockStatusText(status) {
    const date = (ns) => new Date(Number(ns / 1_000_000n)).toLocaleDateString();
    const left = (ns) => { const d = Math.max(0, Math.round(Number((ns - BigInt(Date.now()) * 1_000_000n) / 1_000_000n) / 86_400_000)); return `${d.toLocaleString()} day${d === 1 ? '' : 's'} left`; };
    if (status.status === 'expired') return `Unlocked since ${date(status.at)}`;
    if (status.status === 'until') return `Locked until ${date(status.at)} (${left(status.at)})`;
    if (status.status === 'dissolving') return `Dissolving: unlocks ${date(status.at)} (${left(status.at)})`;
    return `Locked until dissolved: dissolve delay ${formatNsDuration(status.delayNs)}, not dissolving (unlocks ${date(status.earliest)} at the soonest)`;
}

/**
 * What a Sneed Lock NFT holds: the tokens (or the LP position's two tokens) with their value in the
 * user's denomination, the lock's state and a link to its /lock page; ids behind "Details".
 * One component for Sneedex offers and the NFT page, so they show the same.
 */
export function SneedLockNftSummary({ lockId, style = {} }) {
    const { theme } = useTheme();
    const { formatValue } = useDenomination();
    const { loading, error, state, assets, token, pool, value } = useSneedLockNft(lockId);
    const [open, setOpen] = useState(false);
    const muted = { fontSize: '0.75rem', color: theme.colors.mutedText };
    const strong = { fontWeight: 700, color: theme.colors.primaryText };
    const box = { padding: '10px 12px', borderRadius: 8, background: theme.colors.tertiaryBg || theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', color: theme.colors.primaryText, ...style };
    const usdText = (usd) => (usd === null || usd === undefined ? <span style={{ color: theme.colors.mutedText, fontStyle: 'italic' }}>value unknown</span> : formatValue(usd));
    const spinner = (text) => <span style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 6 }}><style>{'@keyframes health-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .health-spin { animation: health-spin 1s linear infinite; }'}</style><FaSpinner className="health-spin" /> {text}</span>;
    const lockLink = <Link to={lockPageUrl(lockId)} style={{ color: theme.colors.accent, textDecoration: 'none', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Open Sneed Lock #{lockId.toString()} <FaExternalLinkAlt size={9} /></Link>;
    const row = (k, v) => (<React.Fragment key={k}><span style={muted}>{k}</span><span style={{ fontSize: '0.78rem', color: theme.colors.secondaryText, wordBreak: 'break-all' }}>{v}</span></React.Fragment>);
    const details = assets ? (assets.kind === 'token' ? { kind: 'token', ledger_id: assets.ledger } : { kind: 'position', swap_id: assets.swap }) : null;
    const status = state ? lockStatus(state, BigInt(Date.now()) * 1_000_000n) : null;
    return (
        <div onClick={(e) => e.stopPropagation()} style={box}>
            {!assets ? (
                error ? <><span style={{ color: theme.colors.error || '#e74c3c' }}>{error}</span>{lockLink}</> : spinner('Reading the lock…')
            ) : (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <SneedLockAssetIcon details={details} size={30} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                            {assets.kind === 'token' ? (
                                <div style={strong}>{value ? `${fmtWhole(value.whole, token.decimals)} ${token.symbol}` : 'Token lock'}</div>
                            ) : (
                                <>
                                    <div style={strong}>{pool ? `${pool.token0.symbol}/${pool.token1.symbol}` : 'ICPSwap'} LP position #{assets.positionId.toString()}</div>
                                    {value && pool && <div style={{ color: theme.colors.secondaryText }}>{fmtWhole(value.total0, pool.token0.decimals)} {pool.token0.symbol} + {fmtWhole(value.total1, pool.token1.decimals)} {pool.token1.symbol}</div>}
                                </>
                            )}
                            {value ? <div style={{ color: theme.colors.secondaryText }}>Worth {usdText(value.usd)}</div> : loading && spinner('Reading the amounts…')}
                            {error && <div style={{ color: theme.colors.error || '#e74c3c', fontSize: '0.8rem' }}>{error}</div>}
                        </div>
                    </div>
                    {status && <div style={{ color: status.status === 'expired' ? theme.colors.success : theme.colors.warning, fontSize: '0.8rem' }}><FaLock size={10} style={{ marginRight: 5 }} />{lockStatusText(status)}</div>}
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        {lockLink}
                        <button type="button" onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.75rem', color: theme.colors.accent }}>{open ? 'Hide details' : 'Details'}</button>
                    </div>
                    {open && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 12px', alignItems: 'baseline' }}>
                            {row('Lock', `#${lockId.toString()}`)}
                            {assets.kind === 'token' && row('Ledger', assets.ledger)}
                            {assets.kind === 'token' && value && row('Amount', `${fmtWhole(value.whole, token.decimals, 8)} ${token.symbol}`)}
                            {assets.kind === 'position' && row('Pool', assets.swap)}
                            {assets.kind === 'position' && row('Position', <Link to={`/position?swap=${assets.swap}&id=${assets.positionId}`} style={{ color: theme.colors.accent }}>#{assets.positionId.toString()} <FaExternalLinkAlt size={9} /></Link>)}
                            {assets.kind === 'position' && value && pool && row('In the position', `${fmtWhole(value.amount0, pool.token0.decimals, 8)} ${pool.token0.symbol} + ${fmtWhole(value.amount1, pool.token1.decimals, 8)} ${pool.token1.symbol}${value.inRange ? '' : ' (out of range)'}`)}
                            {assets.kind === 'position' && value && pool && row('Unclaimed fees', `${fmtWhole(value.fees0, pool.token0.decimals, 8)} ${pool.token0.symbol} + ${fmtWhole(value.fees1, pool.token1.decimals, 8)} ${pool.token1.symbol}`)}
                            {assets.kind === 'position' && value && pool && row('Value per token', <>{pool.token0.symbol} {usdText(value.usd0)} · {pool.token1.symbol} {usdText(value.usd1)}</>)}
                            {status?.delayNs > 0n && row('Dissolve delay', formatNsDuration(status.delayNs))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
