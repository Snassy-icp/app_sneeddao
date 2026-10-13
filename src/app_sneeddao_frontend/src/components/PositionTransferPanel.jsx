// Move an ICPSwap liquidity position into the Sneed wallet without starting
// the lock wizard: pick the pool, follow the steps, and let the panel watch
// the pool until the position arrives. Used under the wallet's liquidity tab
// and on the Sneedlock help page.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Principal } from '@dfinity/principal';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import SwapPoolPicker from './SwapPoolPicker';
import PositionTransferGuide from './PositionTransferGuide';

const POLL_MS = 15000;
const GIVE_UP_MS = 10 * 60 * 1000;

function PositionTransferPanel({ accentColor, compact = false, onArrived, title = 'Move a position here from ICPSwap' }) {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const accent = accentColor || theme.colors.accent;
    const [chosen, setChosen] = useState(null); // { poolId, pool }
    const [watch, setWatch] = useState({ status: 'idle', checks: 0, arrived: [] });
    const ref = useRef({ timer: null, poolId: null });

    const stop = useCallback((status = 'idle') => {
        if (ref.current.timer) clearInterval(ref.current.timer);
        ref.current = { timer: null, poolId: null };
        setWatch((w) => ({ ...w, status }));
    }, []);
    useEffect(() => () => { if (ref.current.timer) clearInterval(ref.current.timer); }, []);

    const positionIds = useCallback(async (poolId) => {
        const swap = createIcpSwapActor(poolId, { agentOptions: { identity } });
        const r = await swap.getUserPositionIdsByPrincipal(identity.getPrincipal());
        return (r.ok || []).map((id) => id.toString());
    }, [identity]);

    const onPoolChange = useCallback((poolId, pool, status) => {
        stop();
        if (status === 'ready' && pool) {
            setChosen({ poolId, pool });
            // Register the pool so the position shows up under the wallet's liquidity tab once it lands.
            if (identity) {
                createBackendActor(backendCanisterId, { agentOptions: { identity } }).register_swap_canister_id(Principal.fromText(poolId)).catch(() => {});
            }
        } else if (!poolId || status === 'error') {
            setChosen(null);
        }
    }, [identity, stop]);

    const start = async () => {
        if (!chosen || !identity) return;
        stop();
        const { poolId } = chosen;
        let baseline;
        try { baseline = new Set(await positionIds(poolId)); } catch { baseline = new Set(); }
        ref.current = { timer: null, poolId };
        setWatch({ status: 'watching', checks: 0, arrived: [] });
        const startedAt = Date.now();
        const tick = async () => {
            if (ref.current.poolId !== poolId) return;
            try {
                const ids = await positionIds(poolId);
                if (ref.current.poolId !== poolId) return;
                const fresh = ids.filter((id) => !baseline.has(id));
                if (fresh.length > 0) {
                    clearInterval(ref.current.timer);
                    ref.current = { timer: null, poolId: null };
                    setWatch({ status: 'arrived', checks: 0, arrived: fresh });
                    onArrived?.(poolId, fresh);
                    return;
                }
                setWatch((w) => ({ ...w, checks: w.checks + 1 }));
            } catch (e) {
                console.warn('Arrival check failed, trying again', e);
            }
            if (Date.now() - startedAt > GIVE_UP_MS) stop('timeout');
        };
        ref.current.timer = setInterval(tick, POLL_MS);
    };

    const card = { border: `1px solid ${theme.colors.border}`, borderRadius: 12, padding: compact ? '12px 14px' : '16px 18px', background: theme.colors.cardBg };
    return (
        <div style={card}>
            {title && <div style={{ fontWeight: 700, fontSize: compact ? '0.95rem' : '1.05rem', color: theme.colors.primaryText, marginBottom: 6 }}>{title}</div>}
            <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, marginBottom: 10, lineHeight: 1.5 }}>
                A position created on ICPSwap belongs to your ICPSwap login. Transferring it to your Sneed wallet principal makes it show up here, where it can be locked, sent, or managed. Pick its pool first so the steps name the pair and this page can confirm the arrival.
            </div>
            <SwapPoolPicker onPoolChange={onPoolChange} accentColor={accent} />
            {chosen && (
                <div style={{ marginTop: 12 }}>
                    <PositionTransferGuide
                        token0Symbol={chosen.pool.token0?.symbol}
                        token1Symbol={chosen.pool.token1?.symbol}
                        compact={compact}
                        accentColor={accent}
                        intro=""
                        watch={watch}
                        onWatch={isAuthenticated ? start : undefined}
                        onStopWatch={() => stop('idle')}
                    />
                    {!isAuthenticated && <div style={{ marginTop: 8, fontSize: '0.82rem', color: theme.colors.mutedText }}>Log in to see your Sneed wallet principal and to let this page watch for the position.</div>}
                </div>
            )}
        </div>
    );
}

export default PositionTransferPanel;
