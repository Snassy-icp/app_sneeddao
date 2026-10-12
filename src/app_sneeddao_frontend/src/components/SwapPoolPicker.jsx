import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Principal } from '@dfinity/principal';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createIcpSwapFactoryActor, canisterId as factoryCanisterId } from 'external/icp_swap_factory';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import TokenSelector from './TokenSelector';
import { resolveTokenLogo } from '../utils/TokenUtils';

const DEFAULT_FEE = BigInt(3000); // 0.3% fee tier (the one ICPSwap uses for almost every pool)

// ICPSwap orders a pool's tokens lexicographically by ledger id.
export const sortTokenPair = (tokenA, tokenB) =>
    tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];

const readText = (metadata, key) => metadata.find(([k]) => k === key)?.[1]?.Text ?? '';
const readNat = (metadata, key, fallback) => {
    const v = metadata.find(([k]) => k === key)?.[1]?.Nat;
    return v === undefined ? fallback : v;
};

/**
 * Loads everything a UI needs to describe an ICPSwap pool: both tokens' ledger ids,
 * symbols, names, decimals, fees and logos. Throws if the canister is not a pool.
 */
export async function describeSwapPool(poolId) {
    const swapActor = createIcpSwapActor(poolId);
    const meta = await swapActor.metadata();
    if (!meta || !('ok' in meta)) throw new Error('Not an ICPSwap pool');
    const describeToken = async (address) => {
        const ledger = createLedgerActor(address);
        const metadata = await ledger.icrc1_metadata();
        const symbol = readText(metadata, 'icrc1:symbol') || address.slice(0, 5);
        return {
            ledgerId: address,
            symbol,
            name: readText(metadata, 'icrc1:name') || symbol,
            decimals: Number(readNat(metadata, 'icrc1:decimals', 8n)),
            fee: readNat(metadata, 'icrc1:fee', 0n),
            logo: await resolveTokenLogo(address, metadata, symbol),
        };
    };
    const [token0, token1] = await Promise.all([
        describeToken(meta.ok.token0.address),
        describeToken(meta.ok.token1.address),
    ]);
    return { poolId, fee: meta.ok.fee, token0, token1 };
}

const shortId = (id) => (id && id.length > 20 ? `${id.slice(0, 5)}…${id.slice(-3)}` : id);

/**
 * Card showing a resolved pool: both logos, symbols, names and ledger ids.
 */
export function SwapPoolSummary({ pool, accentColor, compact = false }) {
    const { theme } = useTheme();
    const accent = accentColor || theme.colors.accent;
    const renderLogo = (token, index) => (
        token.logo ? (
            <img
                src={token.logo}
                alt={token.symbol}
                style={{
                    width: compact ? 28 : 36, height: compact ? 28 : 36, borderRadius: '50%', objectFit: 'cover',
                    marginLeft: index > 0 ? -10 : 0, border: `2px solid ${theme.colors.primaryBg}`, background: theme.colors.secondaryBg,
                }}
                onError={(e) => { e.target.style.visibility = 'hidden'; }}
            />
        ) : (
            <div style={{
                width: compact ? 28 : 36, height: compact ? 28 : 36, borderRadius: '50%', marginLeft: index > 0 ? -10 : 0,
                border: `2px solid ${theme.colors.primaryBg}`, background: `${accent}30`, color: accent,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: compact ? '0.75rem' : '0.9rem',
            }}>
                {token.symbol.charAt(0)}
            </div>
        )
    );
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: compact ? '8px 10px' : '12px',
            background: `${theme.colors.success}12`,
            border: `1px solid ${theme.colors.success}40`,
            borderRadius: '10px',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                {renderLogo(pool.token0, 0)}
                {renderLogo(pool.token1, 1)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: theme.colors.primaryText, fontWeight: 600, fontSize: compact ? '0.9rem' : '1rem' }}>
                    ✓ {pool.token0.symbol}/{pool.token1.symbol}
                    <span style={{ color: theme.colors.mutedText, fontWeight: 400, fontSize: '0.8rem', marginLeft: 8 }}>
                        {pool.token0.name} / {pool.token1.name}
                    </span>
                </div>
                {!compact && (
                    <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginTop: 4, display: 'grid', gap: 2, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        <div title={pool.token0.ledgerId}>{pool.token0.symbol}: {pool.token0.ledgerId}</div>
                        <div title={pool.token1.ledgerId}>{pool.token1.symbol}: {pool.token1.ledgerId}</div>
                        <div title={pool.poolId}>Pool: {pool.poolId}</div>
                    </div>
                )}
                {compact && (
                    <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', fontFamily: 'monospace' }}>
                        Pool {shortId(pool.poolId)}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * SwapPoolPicker - pick an ICPSwap pool either by choosing its two tokens (looked up through
 * the ICPSwap factory) or by entering the pool canister id directly. Once a pool id is known
 * the picker verifies it and shows the pair it found.
 *
 * Props:
 * - onPoolChange(poolId: string, pool: object|null, status: 'idle'|'resolving'|'ready'|'error')
 *     poolId is '' while nothing is selected. pool is the describeSwapPool() result once verified.
 * - resetKey: change this value to clear the picker
 * - accentColor: optional accent for the mode toggle
 */
function SwapPoolPicker({ onPoolChange, resetKey, accentColor }) {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const accent = accentColor || theme.colors.accent;

    const [useManualInput, setUseManualInput] = useState(false);
    const [manualId, setManualId] = useState('');
    const [token0, setToken0] = useState('');
    const [token1, setToken1] = useState('');
    const [lookingUp, setLookingUp] = useState(false);
    const [lookupError, setLookupError] = useState('');
    const [lookedUpPool, setLookedUpPool] = useState('');
    const [pool, setPool] = useState(null);
    const [resolving, setResolving] = useState(false);
    const [resolveError, setResolveError] = useState('');

    const onPoolChangeRef = useRef(onPoolChange);
    useEffect(() => { onPoolChangeRef.current = onPoolChange; }, [onPoolChange]);

    useEffect(() => {
        setUseManualInput(false);
        setManualId('');
        setToken0('');
        setToken1('');
        setLookupError('');
        setLookedUpPool('');
        setPool(null);
        setResolveError('');
    }, [resetKey]);

    // The pool id currently selected, from whichever mode is active
    const manualTrimmed = manualId.trim();
    let manualValid = false;
    if (manualTrimmed) {
        try { Principal.fromText(manualTrimmed); manualValid = true; } catch { manualValid = false; }
    }
    const currentPoolId = useManualInput ? (manualValid ? manualTrimmed : '') : lookedUpPool;

    // Look up the pool for a token pair through the factory
    useEffect(() => {
        if (useManualInput || !token0 || !token1) {
            setLookedUpPool('');
            setLookupError('');
            return;
        }
        let cancelled = false;
        (async () => {
            setLookingUp(true);
            setLookupError('');
            setLookedUpPool('');
            try {
                const factory = createIcpSwapFactoryActor(factoryCanisterId, { agentOptions: { identity } });
                const [a, b] = sortTokenPair(token0, token1);
                const response = await factory.getPool({
                    token0: { address: a, standard: 'ICRC1' },
                    token1: { address: b, standard: 'ICRC1' },
                    fee: DEFAULT_FEE,
                });
                if (cancelled) return;
                if ('ok' in response) {
                    setLookedUpPool(response.ok.canisterId.toString());
                } else {
                    setLookupError('No ICPSwap pool found for this pair at the 0.3% fee tier. If the pool exists, enter its canister id manually.');
                }
            } catch (error) {
                if (cancelled) return;
                console.error('Error looking up swap pool:', error);
                setLookupError('Could not look up the pool: ' + (error?.message || error));
            } finally {
                if (!cancelled) setLookingUp(false);
            }
        })();
        return () => { cancelled = true; };
    }, [token0, token1, useManualInput, identity]);

    // Verify and describe whichever pool id is current
    useEffect(() => {
        if (!currentPoolId) {
            setPool(null);
            setResolveError('');
            setResolving(false);
            onPoolChangeRef.current?.('', null, 'idle');
            return;
        }
        let cancelled = false;
        setResolving(true);
        setResolveError('');
        setPool(null);
        onPoolChangeRef.current?.(currentPoolId, null, 'resolving');
        describeSwapPool(currentPoolId).then((described) => {
            if (cancelled) return;
            setPool(described);
            setResolving(false);
            onPoolChangeRef.current?.(currentPoolId, described, 'ready');
        }).catch((error) => {
            if (cancelled) return;
            console.warn('Not a usable ICPSwap pool:', currentPoolId, error);
            setResolving(false);
            setResolveError('This canister does not answer like an ICPSwap pool. Check the id: it must be the pool canister, not a token ledger.');
            onPoolChangeRef.current?.(currentPoolId, null, 'error');
        });
        return () => { cancelled = true; };
    }, [currentPoolId]);

    const switchMode = useCallback((manual) => {
        setUseManualInput(manual);
        setLookupError('');
    }, []);

    const modeButton = (active, label, onClick) => (
        <button
            type="button"
            onClick={onClick}
            style={{
                flex: 1, padding: '8px 16px', border: 'none', borderRadius: '6px', cursor: 'pointer',
                fontSize: '0.85rem', fontWeight: 500, transition: 'all 0.2s ease',
                background: active ? accent : 'transparent',
                color: active ? theme.colors.primaryBg : theme.colors.mutedText,
            }}
        >
            {label}
        </button>
    );

    const inputStyle = {
        width: '100%', padding: '12px', background: theme.colors.secondaryBg,
        border: `1px solid ${theme.colors.border}`, borderRadius: '8px',
        color: theme.colors.primaryText, fontSize: '0.9rem', boxSizing: 'border-box',
    };
    const labelStyle = { display: 'block', color: theme.colors.primaryText, marginBottom: '8px', fontWeight: 500 };
    const noteStyle = (color) => ({
        padding: '12px', borderRadius: '8px', fontSize: '0.9rem', marginBottom: '16px',
        background: `${color}15`, border: `1px solid ${color}30`, color: theme.colors.primaryText,
        display: 'flex', alignItems: 'center', gap: '12px',
    });
    const spinner = (
        <div className="spinner" style={{
            width: 16, height: 16, flexShrink: 0, borderRadius: '50%',
            border: `2px solid ${theme.colors.border}`, borderTop: `2px solid ${accent}`,
            animation: 'spin 1s linear infinite',
        }} />
    );

    return (
        <div>
            <div style={{
                marginBottom: '20px', display: 'flex', gap: '8px', padding: '4px',
                background: theme.colors.secondaryBg, borderRadius: '8px',
            }}>
                {modeButton(!useManualInput, 'Select Token Pair', () => switchMode(false))}
                {modeButton(useManualInput, 'Enter Pool Id', () => switchMode(true))}
            </div>

            {useManualInput ? (
                <div style={{ marginBottom: '16px' }}>
                    <label style={labelStyle}>ICPSwap pool canister id:</label>
                    <input
                        type="text"
                        value={manualId}
                        onChange={(e) => setManualId(e.target.value)}
                        placeholder="e.g. xkbqi-2qaaa-aaaah-qbpqq-cai"
                        style={inputStyle}
                    />
                    {manualTrimmed && !manualValid && (
                        <div style={{ color: theme.colors.error, fontSize: '0.8rem', marginTop: 6 }}>
                            That is not a valid canister id.
                        </div>
                    )}
                    <div style={{ color: theme.colors.mutedText, fontSize: '0.78rem', marginTop: 6 }}>
                        Find it on ICPSwap: the pool's page URL ends with the pool canister id.
                    </div>
                </div>
            ) : (
                <>
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>First token:</label>
                        <TokenSelector
                            value={token0}
                            onChange={setToken0}
                            placeholder="Select first token"
                            excludeTokens={token1 ? [token1] : undefined}
                            allowCustom={true}
                        />
                    </div>
                    <div style={{ marginBottom: '16px' }}>
                        <label style={labelStyle}>Second token:</label>
                        <TokenSelector
                            value={token1}
                            onChange={setToken1}
                            placeholder="Select second token"
                            excludeTokens={token0 ? [token0] : undefined}
                            allowCustom={true}
                        />
                    </div>
                    {lookingUp && (
                        <div style={noteStyle(accent)}>{spinner} Looking up the pool for this pair...</div>
                    )}
                    {!lookingUp && lookupError && (
                        <div style={noteStyle(theme.colors.error)}>{lookupError}</div>
                    )}
                </>
            )}

            {currentPoolId && resolving && (
                <div style={noteStyle(accent)}>{spinner} Checking pool {shortId(currentPoolId)}...</div>
            )}
            {currentPoolId && !resolving && resolveError && (
                <div style={noteStyle(theme.colors.error)}>{resolveError}</div>
            )}
            {pool && !resolving && (
                <div style={{ marginBottom: '16px' }}>
                    <SwapPoolSummary pool={pool} accentColor={accent} />
                </div>
            )}
        </div>
    );
}

export default SwapPoolPicker;
