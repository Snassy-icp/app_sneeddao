// /positions: browse ICPSwap liquidity positions the way /neurons browses
// neurons. "Mine" lists the positions in your Sneed wallet; "Pool" lists
// every position in a pool, with yours marked. Each row opens /position.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import Header from '../components/Header';
import SwapPoolPicker, { describeSwapPool } from '../components/SwapPoolPicker';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useDenomination } from '../contexts/DenominationContext';
import { useWalletOptional } from '../contexts/WalletContext';
import { get_token_conversion_rate } from '../utils/TokenUtils';
import { customStyles } from '../health/TreeView.jsx';
import { FaWater, FaSpinner, FaPlus, FaLock, FaSync } from 'react-icons/fa';

const HOST = 'https://icp-api.io';
const primary = '#06b6d4';
const fmtUnits = (v, d, max = 4) => (Number(v) / 10 ** d).toLocaleString('en-US', { maximumFractionDigits: Math.min(d, max) });
const tickToHuman = (t, d0, d1) => 1.0001 ** t * 10 ** (d0 - d1);
const fmtPrice = (p) => (p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : p.toPrecision(5).replace(/\.?0+$/, ''));
const sqrtAtTick = (t) => 1.0001 ** (t / 2);
function amountsFor(L, lo, hi, sqrtP) { const sl = sqrtAtTick(lo); const su = sqrtAtTick(hi); if (sqrtP <= sl) return [L * (su - sl) / (sl * su), 0]; if (sqrtP >= su) return [0, L * (su - sl)]; return [L * (su - sqrtP) / (sqrtP * su), L * (sqrtP - sl)]; }

function Positions() {
    const { theme } = useTheme();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { identity, isAuthenticated } = useAuth();
    const { formatValue } = useDenomination();
    const wallet = useWalletOptional();
    const meText = identity?.getPrincipal?.().toText?.() || null;
    const me = useMemo(() => (meText ? Principal.fromText(meText) : null), [meText]);
    const [usd, setUsd] = useState(null); // { p0, p1 } USD per whole token
    const poolId = params.get('swap') || '';
    const [tab, setTab] = useState(poolId ? 'pool' : (isAuthenticated ? 'mine' : 'pool'));
    const [pool, setPool] = useState(null);
    const [meta, setMeta] = useState(null);
    const [rows, setRows] = useState([]);
    const [mine, setMine] = useState(new Set());
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [onlyActive, setOnlyActive] = useState(true);

    useEffect(() => { if (poolId) setTab('pool'); }, [poolId]);

    const load = useCallback(async () => {
        if (!poolId) return;
        setLoading(true); setError(''); setRows([]); setMine(new Set());
        try {
            const a = createIcpSwapActor(poolId, { agentOptions: { host: HOST } });
            const [p, m] = await Promise.all([describeSwapPool(poolId), a.metadata()]);
            if (!('ok' in m)) throw new Error(Object.keys(m.err)[0]);
            setPool(p); setMeta({ tick: Number(m.ok.tick), sqrtP: Number(m.ok.sqrtPriceX96) / 2 ** 96 });
            Promise.all([get_token_conversion_rate(p.token0.ledgerId, p.token0.decimals).catch(() => null), get_token_conversion_rate(p.token1.ledgerId, p.token1.decimals).catch(() => null)]).then(([p0, p1]) => setUsd({ p0: p0 || null, p1: p1 || null }));
            if (me) { const ids = await a.getUserPositionIdsByPrincipal(me).catch(() => ({ ok: [] })); setMine(new Set(('ok' in ids ? ids.ok : []).map((x) => x.toString()))); }
            const out = [];
            let offset = 0; let pageSize = 100; let totalN = null;
            while ((totalN === null || offset < totalN) && out.length < 3000) {
                let page;
                try { page = await a.getUserPositionWithTokenAmount(BigInt(offset), BigInt(pageSize)); } catch (e) { if (pageSize > 10) { pageSize = Math.floor(pageSize / 4); continue; } throw e; }
                if (!('ok' in page)) throw new Error(Object.keys(page.err)[0]);
                totalN = Number(page.ok.totalElements); setTotal(totalN);
                for (const x of page.ok.content) out.push({ id: BigInt(x.id), liquidity: BigInt(x.liquidity), tickLower: Number(x.tickLower), tickUpper: Number(x.tickUpper), owed0: BigInt(x.tokensOwed0), owed1: BigInt(x.tokensOwed1) });
                setRows([...out]);
                if (page.ok.content.length === 0) break;
                offset += page.ok.content.length;
            }
        } catch (e) { setError(e?.message || String(e)); }
        finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [poolId, meText]);
    useEffect(() => { load(); }, [load]);

    const valueOf = (a0, a1) => (pool && usd && (usd.p0 || usd.p1)) ? (a0 / 10 ** pool.token0.decimals * (usd.p0 || 0) + a1 / 10 ** pool.token1.decimals * (usd.p1 || 0)) : null;
    const sorted = useMemo(() => {
        const list = onlyActive ? rows.filter((r) => r.liquidity > 0n) : rows;
        return [...list].sort((a, b) => (mine.has(a.id.toString()) === mine.has(b.id.toString()) ? (a.liquidity < b.liquidity ? 1 : -1) : mine.has(a.id.toString()) ? -1 : 1));
    }, [rows, mine, onlyActive]);
    const totals = useMemo(() => {
        if (!meta) return null;
        let a0 = 0, a1 = 0, f0 = 0, f1 = 0, mine0 = 0, mine1 = 0, inRange = 0, active = 0;
        for (const r of rows) {
            if (r.liquidity === 0n) continue;
            active += 1;
            const [x0, x1] = amountsFor(Number(r.liquidity), r.tickLower, r.tickUpper, meta.sqrtP);
            a0 += x0; a1 += x1; f0 += Number(r.owed0); f1 += Number(r.owed1);
            if (meta.tick >= r.tickLower && meta.tick < r.tickUpper) inRange += 1;
            if (mine.has(r.id.toString())) { mine0 += x0; mine1 += x1; }
        }
        return { a0, a1, f0, f1, mine0, mine1, inRange, active };
    }, [rows, meta, mine]);

    const card = { border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem 1.1rem', background: theme.colors.cardBg, marginBottom: '1rem' };
    const tabStyle = (active) => ({ padding: '8px 14px', borderRadius: 10, border: `1px solid ${active ? primary : theme.colors.border}`, background: active ? `${primary}22` : 'transparent', color: theme.colors.primaryText, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' });
    const pill = (ok, text) => <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '1px 8px', borderRadius: 999, background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)', color: ok ? '#22c55e' : '#f59e0b', border: `1px solid ${ok ? 'rgba(34,197,94,0.4)' : 'rgba(245,158,11,0.4)'}` }}>{text}</span>;
    const th = { textAlign: 'left', fontSize: '0.72rem', textTransform: 'uppercase', color: theme.colors.mutedText, padding: '6px 8px', borderBottom: `1px solid ${theme.colors.border}` };
    const td = { padding: '8px 8px', borderBottom: `1px solid ${theme.colors.border}`, fontSize: '0.85rem', color: theme.colors.primaryText, verticalAlign: 'top' };
    const myPools = wallet?.liquidityPositions || [];

    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header />
            <main style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: '1rem' }}>
                    <div style={{ width: 52, height: 52, borderRadius: 14, background: `${primary}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FaWater size={24} color={primary} /></div>
                    <div style={{ flex: 1, minWidth: 220 }}>
                        <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: theme.colors.primaryText }}>Liquidity positions</h1>
                        <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>ICPSwap positions: yours, or every position in a pool. Open one to see it in full, and to manage it when it is yours.</div>
                    </div>
                    <Link to={poolId ? `/position?swap=${poolId}` : '/position'} style={{ ...tabStyle(true) }}><FaPlus size={11} /> New position</Link>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1rem' }}>
                    <button type="button" style={tabStyle(tab === 'mine')} onClick={() => setTab('mine')}>Mine</button>
                    <button type="button" style={tabStyle(tab === 'pool')} onClick={() => setTab('pool')}>A pool</button>
                </div>

                {tab === 'mine' && (
                    <div style={card}>
                        {!isAuthenticated && <div style={{ color: theme.colors.mutedText }}>Log in to see the positions in your Sneed wallet.</div>}
                        {isAuthenticated && myPools.length === 0 && <div style={{ color: theme.colors.mutedText }}>{wallet?.positionsLoading ? <><FaSpinner className="health-spin" /> Loading your pools…</> : 'No pools in your wallet yet. Add a swap pair in the wallet, or create a position.'}</div>}
                        {myPools.map((lp) => (
                            <div key={lp.swapCanisterId} style={{ borderTop: `1px solid ${theme.colors.border}`, padding: '8px 0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, color: theme.colors.primaryText }}>
                                    {/* margin 0: index.scss gives every img `margin: auto`, which in a flex row spreads them across it */}
                                    <span style={{ display: 'inline-flex', alignItems: 'center', flex: '0 0 auto' }}>
                                        {lp.token0Logo && <img src={lp.token0Logo} alt="" style={{ width: 20, height: 20, borderRadius: 10, margin: 0 }} />}{lp.token1Logo && <img src={lp.token1Logo} alt="" style={{ width: 20, height: 20, borderRadius: 10, margin: '0 0 0 -8px' }} />}
                                    </span>
                                    {lp.token0Symbol}/{lp.token1Symbol}
                                    <Link to={`/positions?swap=${lp.swapCanisterId}`} style={{ color: primary, fontSize: '0.78rem', fontWeight: 600, marginLeft: 6 }}>whole pool</Link>
                                </div>
                                {(lp.positions || []).length === 0 && <div style={{ color: theme.colors.mutedText, fontSize: '0.82rem', padding: '4px 0 4px 28px' }}>no positions</div>}
                                {(lp.positions || []).map((p) => {
                                    const inRange = Number.isFinite(lp.currentTick) && Number.isFinite(p.tickLower) ? (lp.currentTick >= p.tickLower && lp.currentTick < p.tickUpper) : null;
                                    const a0 = p.token0Amount ?? p.amount0 ?? 0n; const a1 = p.token1Amount ?? p.amount1 ?? 0n;
                                    return (
                                        <div key={String(p.positionId)} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: '0.85rem', color: theme.colors.secondaryText, padding: '4px 0 4px 28px' }}>
                                            <Link to={`/position?swap=${lp.swapCanisterId}&id=${p.positionId}`} style={{ color: primary, fontWeight: 700 }}>#{String(p.positionId)}</Link>
                                            <span>{fmtUnits(a0, lp.token0Decimals)} {lp.token0Symbol} + {fmtUnits(a1, lp.token1Decimals)} {lp.token1Symbol}</span>
                                            {(lp.token0_conversion_rate || lp.token1_conversion_rate) ? <span style={{ color: theme.colors.primaryText, fontWeight: 700 }}>{formatValue(Number(a0) / 10 ** lp.token0Decimals * (lp.token0_conversion_rate || 0) + Number(a1) / 10 ** lp.token1Decimals * (lp.token1_conversion_rate || 0))}</span> : null}
                                            {inRange !== null && pill(inRange, inRange ? 'in range' : 'out of range')}
                                            {p.lockInfo && <span style={{ color: theme.colors.mutedText }}><FaLock size={10} /> locked</span>}
                                            {!p.frontendOwnership && !p.lockInfo && <span style={{ color: theme.colors.mutedText }}>held by Sneed Lock</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                )}

                {tab === 'pool' && (
                    <div style={card}>
                        {!poolId && <SwapPoolPicker onPoolChange={(id, p, status) => { if (status === 'ready' && p) navigate(`/positions?swap=${id}`); }} accentColor={primary} />}
                        {poolId && (
                            <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                                    <div style={{ fontWeight: 800, color: theme.colors.primaryText, fontSize: '1.05rem' }}>{pool ? `${pool.token0.symbol}/${pool.token1.symbol}` : poolId}</div>
                                    {meta && pool && <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>price {fmtPrice(tickToHuman(meta.tick, pool.token0.decimals, pool.token1.decimals))} {pool.token1.symbol} per {pool.token0.symbol} · {total} positions ever, {rows.filter((r) => r.liquidity > 0n).length} with liquidity</span>}
                                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <label style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, display: 'flex', gap: 4, alignItems: 'center' }}><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> only with liquidity</label>
                                        <button type="button" style={tabStyle(false)} onClick={() => navigate('/positions')}>Other pool</button>
                                        <button type="button" style={tabStyle(false)} disabled={loading} onClick={load}><FaSync size={11} className={loading ? 'health-spin' : undefined} /></button>
                                    </span>
                                </div>
                                {error && <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: 8 }}>{error}</div>}
                                {totals && pool && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 12, fontSize: '0.85rem', color: theme.colors.secondaryText }}>
                                        <div><div style={{ color: theme.colors.mutedText, fontSize: '0.72rem', textTransform: 'uppercase' }}>In positions</div>{fmtUnits(totals.a0, pool.token0.decimals)} {pool.token0.symbol}<br />{fmtUnits(totals.a1, pool.token1.decimals)} {pool.token1.symbol}{valueOf(totals.a0, totals.a1) !== null && <div style={{ color: theme.colors.primaryText, fontWeight: 700 }}>{formatValue(valueOf(totals.a0, totals.a1))}</div>}</div>
                                        <div><div style={{ color: theme.colors.mutedText, fontSize: '0.72rem', textTransform: 'uppercase' }}>Uncollected fees</div>{fmtUnits(totals.f0, pool.token0.decimals)} {pool.token0.symbol}<br />{fmtUnits(totals.f1, pool.token1.decimals)} {pool.token1.symbol}{valueOf(totals.f0, totals.f1) !== null && <div style={{ color: theme.colors.primaryText, fontWeight: 700 }}>{formatValue(valueOf(totals.f0, totals.f1))}</div>}</div>
                                        <div><div style={{ color: theme.colors.mutedText, fontSize: '0.72rem', textTransform: 'uppercase' }}>Positions</div>{totals.active} with liquidity, {totals.inRange} in range</div>
                                        {mine.size > 0 && <div><div style={{ color: theme.colors.mutedText, fontSize: '0.72rem', textTransform: 'uppercase' }}>Yours</div>{fmtUnits(totals.mine0, pool.token0.decimals)} {pool.token0.symbol} + {fmtUnits(totals.mine1, pool.token1.decimals)} {pool.token1.symbol}{valueOf(totals.mine0, totals.mine1) !== null && <div style={{ color: theme.colors.primaryText, fontWeight: 700 }}>{formatValue(valueOf(totals.mine0, totals.mine1))}</div>}</div>}
                                    </div>
                                )}
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead><tr><th style={th}>Position</th><th style={th}>Range ({pool?.token1.symbol} per {pool?.token0.symbol})</th><th style={th}>Holds</th><th style={th}>Value</th><th style={th}>Uncollected fees</th><th style={th}>Status</th></tr></thead>
                                        <tbody>
                                            {sorted.map((r) => {
                                                const inRange = meta ? (meta.tick >= r.tickLower && meta.tick < r.tickUpper) : null;
                                                const [a0, a1] = meta ? amountsFor(Number(r.liquidity), r.tickLower, r.tickUpper, meta.sqrtP) : [0, 0];
                                                const isMine = mine.has(r.id.toString());
                                                return (
                                                    <tr key={r.id.toString()} style={{ background: isMine ? `${primary}10` : 'transparent' }}>
                                                        <td style={td}><Link to={`/position?swap=${poolId}&id=${r.id}`} style={{ color: primary, fontWeight: 700 }}>#{r.id.toString()}</Link>{isMine && <span style={{ marginLeft: 6, fontSize: '0.72rem', color: primary, fontWeight: 700 }}>yours</span>}</td>
                                                        <td style={td}>{pool ? `${fmtPrice(tickToHuman(r.tickLower, pool.token0.decimals, pool.token1.decimals))} – ${fmtPrice(tickToHuman(r.tickUpper, pool.token0.decimals, pool.token1.decimals))}` : `${r.tickLower} – ${r.tickUpper}`}</td>
                                                        <td style={td}>{pool ? `${fmtUnits(a0, pool.token0.decimals)} ${pool.token0.symbol} + ${fmtUnits(a1, pool.token1.decimals)} ${pool.token1.symbol}` : r.liquidity.toString()}</td>
                                                        <td style={td}>{valueOf(a0, a1) !== null ? formatValue(valueOf(a0, a1)) : ''}</td>
                                                        <td style={td}>{pool ? `${fmtUnits(r.owed0, pool.token0.decimals)} + ${fmtUnits(r.owed1, pool.token1.decimals)}${valueOf(Number(r.owed0), Number(r.owed1)) ? ` (${formatValue(valueOf(Number(r.owed0), Number(r.owed1)))})` : ''}` : ''}</td>
                                                        <td style={td}>{r.liquidity === 0n ? <span style={{ color: theme.colors.mutedText }}>empty</span> : inRange !== null ? pill(inRange, inRange ? 'in range' : 'out of range') : ''}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    {loading && <div style={{ color: theme.colors.mutedText, padding: 8 }}><FaSpinner className="health-spin" /> Reading positions…</div>}
                                    {!loading && sorted.length === 0 && !error && <div style={{ color: theme.colors.mutedText, padding: 8 }}>No positions{onlyActive ? ' with liquidity' : ''}.</div>}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

export default Positions;
