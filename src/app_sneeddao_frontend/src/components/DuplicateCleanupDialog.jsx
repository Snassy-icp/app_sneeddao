import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { FaTimes, FaSearch, FaTrash, FaCheckCircle, FaExclamationTriangle } from 'react-icons/fa';
import TokenIcon from './TokenIcon';
import { getTokenMetadataSync, fetchAndCacheTokenMetadata } from '../hooks/useTokenCache';

const ACTION_TYPE_DETECTED_INFLOW = 4;

const shortPrincipal = (p) => {
    const s = typeof p === 'string' ? p : p?.toText?.() || String(p);
    return s.length > 20 ? s.slice(0, 8) + '...' + s.slice(-6) : s;
};

const toStr = (p) => typeof p === 'string' ? p : p?.toText?.() || String(p);

const formatTokenAmount = (raw, decimals) => {
    const n = Number(raw);
    if (n === 0) return '0';
    return (n / Math.pow(10, decimals)).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
    });
};

/**
 * Dialog that scans the trade log for duplicate DetectedInflow entries,
 * groups them by (token, amount), and lets the user select duplicates to delete.
 *
 * Props:
 *  - isOpen: boolean
 *  - onClose: () => void
 *  - getReadyBotActor: () => Promise<actor>
 *  - onComplete: () => void  (called after successful deletion to refresh parent)
 */
const DuplicateCleanupDialog = ({ isOpen, onClose, getReadyBotActor, onComplete }) => {
    const { theme } = useTheme();
    const { identity } = useAuth();

    // States: 'scanning' | 'review' | 'confirming' | 'done' | 'error'
    const [phase, setPhase] = useState('scanning');
    const [groups, setGroups] = useState([]);
    const [selected, setSelected] = useState(new Set());
    const [result, setResult] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [tokenMeta, setTokenMeta] = useState({});

    const resolveTokenMeta = useCallback(async (tokenId) => {
        const key = toStr(tokenId);
        let meta = getTokenMetadataSync(key);
        if (!meta && identity) {
            try { meta = await fetchAndCacheTokenMetadata(key, identity); } catch (_) {}
        }
        return meta;
    }, [identity]);

    // Scan for duplicates on open
    useEffect(() => {
        if (!isOpen) return;
        setPhase('scanning');
        setGroups([]);
        setSelected(new Set());
        setResult(null);
        setErrorMsg('');

        let cancelled = false;
        (async () => {
            try {
                const bot = await getReadyBotActor();
                if (!bot || cancelled) return;

                const q = {
                    startId: [], limit: [100000], offset: [0],
                    choreId: [], choreTypeId: [],
                    actionType: [ACTION_TYPE_DETECTED_INFLOW],
                    inputToken: [], outputToken: [],
                    status: [], fromTime: [], toTime: [],
                };
                const res = await bot.getTradeLog(q);
                if (cancelled) return;

                const entries = res.entries || [];

                // Resolve token metadata for all unique tokens
                const tokenIds = [...new Set(entries.map(e => toStr(e.inputToken)))];
                const metaMap = {};
                await Promise.all(tokenIds.map(async (tid) => {
                    const m = await resolveTokenMeta(tid);
                    if (m) metaMap[tid] = m;
                }));
                if (cancelled) return;
                setTokenMeta(metaMap);

                // Group by (token, amount) exact match
                const groupMap = new Map();
                for (const e of entries) {
                    const key = `${toStr(e.inputToken)}:${e.inputAmount.toString()}`;
                    if (!groupMap.has(key)) groupMap.set(key, []);
                    groupMap.get(key).push(e);
                }

                // Only keep groups with 2+ entries (potential duplicates)
                const dupGroups = [];
                for (const [, groupEntries] of groupMap) {
                    if (groupEntries.length >= 2) {
                        // Sort oldest first
                        groupEntries.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
                        dupGroups.push(groupEntries);
                    }
                }

                // Sort groups by the first entry's timestamp (oldest groups first)
                dupGroups.sort((a, b) => Number(a[0].timestamp) - Number(b[0].timestamp));

                setGroups(dupGroups);

                // Pre-select all but the first (original) in each group
                const preSelected = new Set();
                for (const g of dupGroups) {
                    for (let i = 1; i < g.length; i++) {
                        preSelected.add(Number(g[i].id));
                    }
                }
                setSelected(preSelected);
                setPhase('review');
            } catch (err) {
                if (!cancelled) {
                    setErrorMsg(err?.message || String(err));
                    setPhase('error');
                }
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, getReadyBotActor, resolveTokenMeta]);

    const toggleEntry = (id) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAllDuplicatesInGroup = (group) => {
        setSelected(prev => {
            const next = new Set(prev);
            for (let i = 1; i < group.length; i++) next.add(Number(group[i].id));
            return next;
        });
    };

    const deselectAllInGroup = (group) => {
        setSelected(prev => {
            const next = new Set(prev);
            for (const e of group) next.delete(Number(e.id));
            return next;
        });
    };

    const handleDelete = async () => {
        if (selected.size === 0) return;
        setPhase('confirming');
        try {
            const bot = await getReadyBotActor();
            if (!bot) throw new Error('Bot actor not available');
            const ids = [...selected];
            const res = await bot.deleteTradeLogEntries(ids);
            setResult(res);
            setPhase('done');
        } catch (err) {
            setErrorMsg(err?.message || String(err));
            setPhase('error');
        }
    };

    const handleClose = () => {
        if (phase === 'done' && onComplete) onComplete();
        onClose();
    };

    if (!isOpen) return null;

    const getSym = (tokenId) => {
        const key = toStr(tokenId);
        return tokenMeta[key]?.symbol || shortPrincipal(key);
    };
    const getDec = (tokenId) => {
        const key = toStr(tokenId);
        return tokenMeta[key]?.decimals ?? 8;
    };

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget && phase !== 'confirming') handleClose();
    };

    return createPortal(
        <div onClick={handleBackdropClick} style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            zIndex: 100000, animation: 'fadeIn 0.2s ease-out',
        }}>
            <style>{`
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
            `}</style>

            <div style={{
                background: theme.colors.secondaryBg,
                border: `1px solid ${theme.colors.border}`,
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
                borderRadius: '16px', width: '90%', maxWidth: '560px',
                maxHeight: '80vh', display: 'flex', flexDirection: 'column',
                overflow: 'hidden', animation: 'slideUp 0.3s ease-out',
            }}>
                {/* Header */}
                <div style={{
                    padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', borderBottom: `1px solid ${theme.colors.border}`,
                    background: theme.colors.primaryBg, flexShrink: 0,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <FaSearch style={{ color: theme.colors.accent, fontSize: '1rem' }} />
                        <h3 style={{ color: theme.colors.primaryText, margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                            Cleanup Duplicate Inflows
                        </h3>
                    </div>
                    <button onClick={handleClose} disabled={phase === 'confirming'} style={{
                        background: 'none', border: 'none', color: theme.colors.mutedText,
                        cursor: phase === 'confirming' ? 'default' : 'pointer', padding: '4px', borderRadius: '6px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <FaTimes size={16} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ padding: '1rem 1.5rem', overflowY: 'auto', flex: 1 }}>
                    {phase === 'scanning' && (
                        <div style={{ textAlign: 'center', padding: '2rem 0', color: theme.colors.secondaryText }}>
                            <FaSearch style={{ fontSize: '1.5rem', marginBottom: '0.5rem', animation: 'pulse 1.5s infinite', color: theme.colors.accent }} />
                            <div>Scanning trade log for duplicate inflows...</div>
                        </div>
                    )}

                    {phase === 'review' && groups.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '2rem 0', color: theme.colors.secondaryText }}>
                            <FaCheckCircle style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: '#22c55e' }} />
                            <div>No duplicate inflows detected. Your trade log looks clean.</div>
                        </div>
                    )}

                    {phase === 'review' && groups.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, lineHeight: 1.5 }}>
                                Found <strong style={{ color: theme.colors.primaryText }}>{groups.length}</strong> group{groups.length !== 1 ? 's' : ''} of
                                identical inflow entries. The oldest entry in each group is marked as the original.
                                Review and uncheck any entries you want to keep.
                            </div>

                            {groups.map((group, gi) => {
                                const token = group[0].inputToken;
                                const sym = getSym(token);
                                const dec = getDec(token);
                                const amount = formatTokenAmount(group[0].inputAmount, dec);
                                const groupSelectedCount = group.filter(e => selected.has(Number(e.id))).length;
                                const allDupsSelected = group.slice(1).every(e => selected.has(Number(e.id)));

                                return (
                                    <div key={gi} style={{
                                        background: theme.colors.primaryBg, borderRadius: '10px',
                                        border: `1px solid ${theme.colors.border}`,
                                        borderLeft: `3px solid #f59e0b`,
                                        overflow: 'hidden',
                                    }}>
                                        {/* Group header */}
                                        <div style={{
                                            padding: '10px 12px', display: 'flex', alignItems: 'center',
                                            justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px',
                                            borderBottom: `1px solid ${theme.colors.border}20`,
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', fontWeight: 600, color: theme.colors.primaryText }}>
                                                <TokenIcon canisterId={toStr(token)} size={18} />
                                                +{amount} {sym}
                                                <span style={{ fontWeight: 400, color: theme.colors.mutedText, fontSize: '0.75rem' }}>
                                                    ({group.length} entries)
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button onClick={() => selectAllDuplicatesInGroup(group)} style={{
                                                    background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: '4px',
                                                    padding: '2px 8px', fontSize: '0.68rem', color: theme.colors.secondaryText,
                                                    cursor: 'pointer',
                                                }}>Select duplicates</button>
                                                <button onClick={() => deselectAllInGroup(group)} style={{
                                                    background: 'none', border: `1px solid ${theme.colors.border}`, borderRadius: '4px',
                                                    padding: '2px 8px', fontSize: '0.68rem', color: theme.colors.secondaryText,
                                                    cursor: 'pointer',
                                                }}>Deselect all</button>
                                            </div>
                                        </div>

                                        {/* Entries */}
                                        {group.map((e, i) => {
                                            const id = Number(e.id);
                                            const isOriginal = i === 0;
                                            const isChecked = selected.has(id);
                                            const ts = new Date(Number(e.timestamp) / 1_000_000).toLocaleString();
                                            return (
                                                <label key={id} style={{
                                                    display: 'flex', alignItems: 'center', gap: '10px',
                                                    padding: '8px 12px', cursor: 'pointer',
                                                    borderTop: i > 0 ? `1px solid ${theme.colors.border}15` : 'none',
                                                    background: isChecked ? '#ef444410' : 'transparent',
                                                }}>
                                                    <input type="checkbox" checked={isChecked} onChange={() => toggleEntry(id)} style={{ accentColor: '#ef4444' }} />
                                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            <span style={{ fontWeight: 500, color: theme.colors.primaryText, fontSize: '0.78rem' }}>#{id}</span>
                                                            {isOriginal && (
                                                                <span style={{
                                                                    padding: '1px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 600,
                                                                    background: '#22c55e20', color: '#22c55e',
                                                                }}>Original</span>
                                                            )}
                                                            {!isOriginal && (
                                                                <span style={{
                                                                    padding: '1px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 600,
                                                                    background: '#f59e0b20', color: '#f59e0b',
                                                                }}>Duplicate</span>
                                                            )}
                                                        </div>
                                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.7rem' }}>{ts}</span>
                                                    </div>
                                                </label>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {phase === 'confirming' && (
                        <div style={{ textAlign: 'center', padding: '2rem 0', color: theme.colors.secondaryText }}>
                            <FaTrash style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: '#ef4444', animation: 'pulse 1.5s infinite' }} />
                            <div>Deleting {selected.size} entries and reversing capital...</div>
                        </div>
                    )}

                    {phase === 'done' && result && (
                        <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                            <FaCheckCircle style={{ fontSize: '2rem', marginBottom: '0.75rem', color: '#22c55e' }} />
                            <div style={{ color: theme.colors.primaryText, fontWeight: 600, marginBottom: '0.5rem' }}>
                                Deleted {Number(result.deleted)} entries
                            </div>
                            <div style={{ color: theme.colors.secondaryText, fontSize: '0.82rem', lineHeight: 1.6 }}>
                                Capital reversed: {(Number(result.capitalIcpReversed) / 1e8).toFixed(8)} ICP
                                {result.capitalUsdReversed !== 0n && result.capitalUsdReversed !== 0 && (
                                    <>, ${(Number(result.capitalUsdReversed) / 1e8).toFixed(2)} USD</>
                                )}
                            </div>
                        </div>
                    )}

                    {phase === 'error' && (
                        <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                            <FaExclamationTriangle style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: '#ef4444' }} />
                            <div style={{ color: '#ef4444', fontSize: '0.85rem' }}>{errorMsg}</div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '1rem 1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem',
                    background: theme.colors.primaryBg, borderTop: `1px solid ${theme.colors.border}`,
                    flexShrink: 0,
                }}>
                    {phase === 'review' && groups.length > 0 && (
                        <>
                            <button onClick={handleClose} style={{
                                background: 'transparent', border: `1px solid ${theme.colors.border}`,
                                color: theme.colors.secondaryText, borderRadius: '8px', padding: '0.6rem 1.25rem',
                                cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500,
                            }}>Cancel</button>
                            <button onClick={handleDelete} disabled={selected.size === 0} style={{
                                background: selected.size > 0 ? 'linear-gradient(135deg, #ef4444, #dc2626)' : theme.colors.border,
                                border: 'none', color: 'white', borderRadius: '8px', padding: '0.6rem 1.25rem',
                                cursor: selected.size > 0 ? 'pointer' : 'default', fontSize: '0.9rem', fontWeight: 600,
                                boxShadow: selected.size > 0 ? '0 2px 8px rgba(0,0,0,0.2)' : 'none',
                                opacity: selected.size > 0 ? 1 : 0.5,
                            }}>
                                <FaTrash style={{ marginRight: '6px', fontSize: '0.75rem' }} />
                                Delete Selected ({selected.size})
                            </button>
                        </>
                    )}
                    {(phase === 'done' || phase === 'error' || (phase === 'review' && groups.length === 0)) && (
                        <button onClick={handleClose} style={{
                            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accentDark || theme.colors.accent})`,
                            border: 'none', color: 'white', borderRadius: '8px', padding: '0.6rem 1.25rem',
                            cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                        }}>Close</button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default DuplicateCleanupDialog;
