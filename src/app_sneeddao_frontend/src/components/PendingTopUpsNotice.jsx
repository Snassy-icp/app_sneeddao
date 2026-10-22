// Lists cycles top-ups whose ICP went to the CMC but whose notify_top_up has not had a final
// answer yet (kept in localStorage by utils/cyclesTopUp.js), with "Finish top-up" (re-notify the
// stored block, or resend the transfer deduplicated if the block was never learned). Renders
// nothing when there are none.
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { HttpAgent } from '@dfinity/agent';
import { FaExclamationTriangle, FaSpinner } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createCmcActor, CMC_CANISTER_ID } from 'external/cmc';
import { loadPendingTopUps, finishPendingTopUp, removePendingTopUp, describeTopUpResult, PENDING_TOPUPS_EVENT } from '../utils/cyclesTopUp';
import { formatCyclesCompact } from '../utils/NeuronManagerSettings';

const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

export async function makeTopUpActors(identity) {
    const isLocal = process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging';
    const agent = HttpAgent.createSync({ host: isLocal ? 'http://localhost:4943' : 'https://icp0.io', ...(identity ? { identity } : {}) });
    if (isLocal) await agent.fetchRootKey();
    return {
        ledger: identity ? createLedgerActor(ICP_LEDGER_CANISTER_ID, { agent }) : null,
        cmc: createCmcActor(CMC_CANISTER_ID, { agent }),
    };
}

export function usePendingTopUps() {
    const [list, setList] = useState(() => loadPendingTopUps());
    useEffect(() => {
        const refresh = () => setList(loadPendingTopUps());
        window.addEventListener(PENDING_TOPUPS_EVENT, refresh);
        window.addEventListener('storage', refresh);
        return () => {
            window.removeEventListener(PENDING_TOPUPS_EVENT, refresh);
            window.removeEventListener('storage', refresh);
        };
    }, []);
    return list;
}

export default function PendingTopUpsNotice({ style }) {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const pending = usePendingTopUps();
    const [busy, setBusy] = useState({});
    const [messages, setMessages] = useState({});

    const finish = useCallback(async (canisterId) => {
        setBusy((b) => ({ ...b, [canisterId]: true }));
        try {
            const { ledger, cmc } = await makeTopUpActors(identity);
            const r = await finishPendingTopUp({ ledger, cmc, canisterId, owner: identity ? identity.getPrincipal().toText() : null });
            const text = r.status === 'ok'
                ? `Done: added ${formatCyclesCompact(Number(r.cycles))} cycles (ICP ledger block ${r.blockIndex}).`
                : describeTopUpResult(r, formatCyclesCompact);
            setMessages((m) => ({ ...m, [canisterId]: { ok: r.status === 'ok', text } }));
            if (r.status === 'ok') window.dispatchEvent(new Event('neuronManagersRefresh'));
        } catch (e) {
            setMessages((m) => ({ ...m, [canisterId]: { ok: false, text: e.message || String(e) } }));
        } finally {
            setBusy((b) => ({ ...b, [canisterId]: false }));
        }
    }, [identity]);

    // Dismiss asks inline (no browser popup): the first click shows the warning, the second forgets.
    const [confirming, setConfirming] = useState(null);
    const dismiss = (rec) => {
        if (confirming !== rec.canisterId) { setConfirming(rec.canisterId); return; }
        setConfirming(null);
        removePendingTopUp(rec.canisterId);
    };

    const shownMessages = Object.entries(messages).filter(([cid]) => !pending.some((p) => p.canisterId === cid));
    if (pending.length === 0 && shownMessages.length === 0) return null;

    const box = {
        background: `${theme.colors.cardBackground || theme.colors.secondaryBg}`,
        border: '1px solid #f59e0b66', borderRadius: 12, padding: '12px 14px',
        color: theme.colors.primaryText, fontSize: 13, ...style,
    };
    const btn = {
        background: '#f59e0b', color: '#1a1a1a', border: 'none', borderRadius: 8, padding: '6px 12px',
        fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
    };
    const ghost = { ...btn, background: 'transparent', color: theme.colors.secondaryText, border: `1px solid ${theme.colors.border}` };

    return (
        <div style={box}>
            {pending.length > 0 && (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 6 }}>
                        <FaExclamationTriangle style={{ color: '#f59e0b' }} />
                        Pending cycles top-ups ({pending.length})
                    </div>
                    <div style={{ color: theme.colors.secondaryText, marginBottom: 8 }}>
                        This ICP reached the cycles minting canister but the cycles were not confirmed. Finishing a top-up never sends ICP again.
                    </div>
                    {pending.map((rec) => (
                        <div key={rec.canisterId} style={{ borderTop: `1px solid ${theme.colors.border}`, padding: '8px 0', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                            <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                                <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{rec.canisterId}</div>
                                <div style={{ color: theme.colors.mutedText || theme.colors.secondaryText, fontSize: 12 }}>
                                    {(Number(rec.amountE8s) / 1e8).toString()} ICP
                                    {rec.blockIndex != null ? ` · block ${rec.blockIndex}` : ' · transfer not confirmed'}
                                    {rec.createdMs ? ` · ${new Date(rec.createdMs).toLocaleString()}` : ''}
                                    {rec.lastError ? ` · last answer: ${rec.lastError}` : ''}
                                </div>
                                {confirming === rec.canisterId && (
                                    <div style={{ marginTop: 4, color: '#f59e0b' }}>
                                        {rec.blockIndex != null
                                            ? `Forget this pending top-up? Only do this if the cycles already arrived. You can still finish it later at /tools/recover-topup with canister ${rec.canisterId} and block ${rec.blockIndex}. Click "Yes, forget it" to confirm.`
                                            : 'Forget this pending top-up? Its transfer may or may not have gone through; check your ICP history first. Click "Yes, forget it" to confirm.'}
                                    </div>
                                )}
                                {messages[rec.canisterId] && (
                                    <div style={{ marginTop: 4, color: messages[rec.canisterId].ok ? '#10b981' : '#f59e0b' }}>{messages[rec.canisterId].text}</div>
                                )}
                            </div>
                            <button style={btn} disabled={!!busy[rec.canisterId]} onClick={() => finish(rec.canisterId)}>
                                {busy[rec.canisterId] && <FaSpinner className="spin" />} Finish top-up
                            </button>
                            <button style={ghost} disabled={!!busy[rec.canisterId]} onClick={() => dismiss(rec)}>{confirming === rec.canisterId ? 'Yes, forget it' : 'Dismiss'}</button>
                            {confirming === rec.canisterId && (
                                <button style={ghost} onClick={() => setConfirming(null)}>Keep</button>
                            )}
                        </div>
                    ))}
                </>
            )}
            {shownMessages.map(([cid, m]) => (
                <div key={cid} style={{ color: m.ok ? '#10b981' : '#f59e0b', marginTop: 4 }}>{cid}: {m.text}</div>
            ))}
            <div style={{ marginTop: 6, fontSize: 12 }}>
                Have a block index from elsewhere? <Link to="/tools/recover-topup" style={{ color: '#f59e0b' }}>Recover a top-up</Link>
            </div>
        </div>
    );
}
