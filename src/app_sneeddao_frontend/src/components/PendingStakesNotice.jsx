// Lists neuron stakes whose tokens were (or may have been) sent to a neuron subaccount but whose
// claim step never confirmed (kept in localStorage by utils/stakeJournal.js), with a one-click
// "Finish staking" that repeats the claim. Details (ledger, block, memo, subaccount) sit behind
// "Details". Renders nothing when there are none.
import React, { useEffect, useState, useCallback } from 'react';
import { Principal } from '@dfinity/principal';
import { FaExclamationTriangle, FaSpinner } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createManagerActor } from 'declarations/sneed_icp_staking_bot';
import { loadPendingStakes, removeStake, updateStake, hexToBytes, PENDING_STAKES_EVENT } from '../utils/stakeJournal';

const HOST = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943';

export function usePendingStakes() {
    const [list, setList] = useState(() => loadPendingStakes());
    useEffect(() => {
        const refresh = () => setList(loadPendingStakes());
        window.addEventListener(PENDING_STAKES_EVENT, refresh);
        window.addEventListener('storage', refresh);
        return () => {
            window.removeEventListener(PENDING_STAKES_EVENT, refresh);
            window.removeEventListener('storage', refresh);
        };
    }, []);
    return list;
}

const errText = (e) => {
    try { return JSON.stringify(e, (_, v) => (typeof v === 'bigint' ? v.toString() : v)); } catch (_) { return String(e); }
};

/** Repeat the claim for a journal entry. Returns { ok, text }. */
export async function finishStake(rec, identity) {
    const agentOptions = { identity, host: HOST };
    if (rec.kind === 'sns') {
        const gov = createSnsGovernanceActor(rec.governance, { agentOptions });
        const r = await gov.manage_neuron({
            subaccount: Array.from(hexToBytes(rec.subaccount)),
            command: [{ ClaimOrRefresh: { by: [{ MemoAndController: { memo: BigInt(rec.memo), controller: [Principal.fromText(rec.owner)] } }] } }],
        });
        const c = r?.command?.[0];
        if (c?.Error) return { ok: false, text: c.Error.error_message || errText(c.Error) };
        if (c?.ClaimOrRefresh) return { ok: true, text: 'Neuron created. A dissolve delay, if you wanted one, can be set on the neuron page.' };
        return { ok: false, text: `Unexpected answer: ${errText(r)}` };
    }
    if (rec.kind === 'icp_bot') {
        const bot = createManagerActor(rec.bot, { agentOptions });
        const r = await bot.claimNeuronFromDeposit(BigInt(rec.memo), BigInt(rec.dissolveDelaySeconds || 0));
        if (r && 'Ok' in r) return { ok: true, text: `Neuron ${r.Ok.id.toString()} created.` };
        return { ok: false, text: errText(r?.Err ?? r) };
    }
    return { ok: false, text: `Unknown stake kind ${rec.kind}` };
}

export default function PendingStakesNotice({ style }) {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const pending = usePendingStakes();
    const me = identity ? identity.getPrincipal().toText() : null;
    const mine = pending.filter((p) => !p.owner || p.owner === me);
    const [busy, setBusy] = useState({});
    const [messages, setMessages] = useState({});
    const [open, setOpen] = useState({});
    const [confirming, setConfirming] = useState(null);

    const finish = useCallback(async (rec) => {
        if (!identity) return;
        setBusy((b) => ({ ...b, [rec.id]: true }));
        try {
            const r = await finishStake(rec, identity);
            if (r.ok) removeStake(rec.id);
            else updateStake(rec.id, { lastError: r.text });
            setMessages((m) => ({ ...m, [rec.id]: r }));
        } catch (e) {
            updateStake(rec.id, { lastError: e?.message || String(e) });
            setMessages((m) => ({ ...m, [rec.id]: { ok: false, text: e?.message || String(e) } }));
        } finally {
            setBusy((b) => ({ ...b, [rec.id]: false }));
        }
    }, [identity]);

    const dismiss = (rec) => {
        if (confirming !== rec.id) { setConfirming(rec.id); return; }
        setConfirming(null);
        removeStake(rec.id);
    };

    const done = Object.entries(messages).filter(([id, m]) => m.ok && !mine.some((p) => p.id === id));
    if (mine.length === 0 && done.length === 0) return null;

    const muted = theme.colors.mutedText || theme.colors.secondaryText;
    const box = {
        background: theme.colors.cardBackground || theme.colors.secondaryBg,
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
            {mine.length > 0 && (
                <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 6 }}>
                        <FaExclamationTriangle style={{ color: '#f59e0b' }} />
                        Unfinished neuron stakes ({mine.length})
                    </div>
                    <div style={{ color: theme.colors.secondaryText, marginBottom: 8 }}>
                        Tokens went to a neuron account but the neuron was not confirmed. Finishing only repeats the claim; it never sends tokens again.
                    </div>
                    {mine.map((rec) => (
                        <div key={rec.id} style={{ borderTop: `1px solid ${theme.colors.border}`, padding: '8px 0' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                                <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                                    <div>{rec.kind === 'icp_bot' ? 'ICP neuron (staking bot)' : 'SNS neuron'}</div>
                                    <div style={{ color: muted, fontSize: 12 }}>
                                        {rec.block != null ? `ledger block ${rec.block}` : 'transfer not confirmed'}
                                        {rec.createdMs ? ` · ${new Date(rec.createdMs).toLocaleString()}` : ''}
                                    </div>
                                    {confirming === rec.id && (
                                        <div style={{ marginTop: 4, color: '#f59e0b' }}>
                                            Forget this stake? Only do this if the neuron exists or the transfer never happened: without the memo below the tokens cannot be claimed into a neuron from here. Click "Yes, forget it" to confirm.
                                        </div>
                                    )}
                                    {messages[rec.id] && (
                                        <div style={{ marginTop: 4, color: messages[rec.id].ok ? '#10b981' : '#f59e0b' }}>{messages[rec.id].text}</div>
                                    )}
                                </div>
                                <button style={btn} disabled={!!busy[rec.id] || !identity} onClick={() => finish(rec)}>
                                    {busy[rec.id] && <FaSpinner className="spin" />} Finish staking
                                </button>
                                <button style={ghost} onClick={() => setOpen((o) => ({ ...o, [rec.id]: !o[rec.id] }))}>
                                    {open[rec.id] ? 'Hide details' : 'Details'}
                                </button>
                                <button style={ghost} disabled={!!busy[rec.id]} onClick={() => dismiss(rec)}>
                                    {confirming === rec.id ? 'Yes, forget it' : 'Dismiss'}
                                </button>
                                {confirming === rec.id && <button style={ghost} onClick={() => setConfirming(null)}>Keep</button>}
                            </div>
                            {open[rec.id] && (
                                <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 11, color: muted, wordBreak: 'break-all', lineHeight: 1.6 }}>
                                    <div>ledger: {rec.ledger}</div>
                                    {rec.governance && <div>governance: {rec.governance}</div>}
                                    {rec.bot && <div>staking bot: {rec.bot}</div>}
                                    <div>amount (base units): {rec.amount}</div>
                                    <div>memo: {rec.memo}</div>
                                    <div>subaccount: {rec.subaccount}</div>
                                    {rec.block != null && <div>block: {rec.block}</div>}
                                    {rec.lastError && <div>last answer: {rec.lastError}</div>}
                                </div>
                            )}
                        </div>
                    ))}
                </>
            )}
            {done.map(([id, m]) => (
                <div key={id} style={{ color: '#10b981', marginTop: 4 }}>{m.text}</div>
            ))}
        </div>
    );
}
