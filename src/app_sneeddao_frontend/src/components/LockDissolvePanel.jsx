// Dissolve delay of a Sneed Lock (v2, spec/sneed_lock_v2.md section 1): the lock's time
// rules, and for its owner start/stop dissolving, increase the delay, extend the lock period.
// Renders nothing against a Sneed Lock without v2 (no get_lock_state).
import React, { useCallback, useEffect, useState } from 'react';
import { FaHourglassHalf, FaPlay, FaStop, FaPlus, FaCalendarPlus } from 'react-icons/fa';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { describeLockTime, formatNsDuration, lockExpiryToDate } from '../utils/lockTime';

const errText = (e) => {
    if (!e) return 'Unknown error';
    if ('NotOwner' in e) return 'Only the lock’s owner can change it.';
    if ('NotFound' in e) return 'No such lock.';
    if ('InProgress' in e) return 'A transfer of this lock is in progress; try again in a moment.';
    if ('Invalid' in e) return e.Invalid;
    return JSON.stringify(e);
};

export default function LockDissolvePanel({ lockId, onChanged }) {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const [st, setSt] = useState(null);
    const [limits, setLimits] = useState(null);
    const [unsupported, setUnsupported] = useState(false);
    const [busy, setBusy] = useState('');
    const [msg, setMsg] = useState(null); // { ok, text }
    const [addHours, setAddHours] = useState('24');
    const [newEnd, setNewEnd] = useState('');

    const load = useCallback(async () => {
        try {
            const a = createSneedLockActor(sneedLockCanisterId);
            const [s, l] = await Promise.all([a.get_lock_state(BigInt(lockId)), a.get_lock_limits()]);
            setSt(s[0] || null); setLimits(l);
        } catch (_) { setUnsupported(true); }
    }, [lockId]);
    useEffect(() => { load(); }, [load]);

    if (unsupported || !st) return null;

    const me = identity?.getPrincipal?.().toText?.();
    const isOwner = me && st.owner.toText() === me;
    const nowNs = BigInt(Date.now()) * 1_000_000n;
    const delay = BigInt(st.dissolve_delay);
    const dissolving = st.dissolving_until.length > 0;
    const periodOver = BigInt(st.lock_end) <= nowNs;
    const fmt = (d) => d.toLocaleString();

    const act = async (label, fn) => {
        setBusy(label); setMsg(null);
        try {
            const a = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const r = await fn(a);
            if ('Err' in r) setMsg({ ok: false, text: errText(r.Err) });
            else { setSt(r.Ok); setMsg({ ok: true, text: `${label}: done.` }); onChanged?.(); }
        } catch (e) { setMsg({ ok: false, text: e?.message || String(e) }); }
        finally { setBusy(''); }
    };

    const card = { background: theme.colors.cardGradient || theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1.1rem 1.25rem', margin: '1rem auto', maxWidth: 720, color: theme.colors.primaryText };
    const label = { fontSize: '0.72rem', fontWeight: 600, color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px' };
    const btn = (enabled) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.45rem 0.9rem', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: enabled ? theme.colors.accent : theme.colors.tertiaryBg || theme.colors.secondaryBg, color: enabled ? '#fff' : theme.colors.mutedText, cursor: enabled ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: '0.85rem' });
    const input = { padding: '0.4rem 0.6rem', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.85rem' };
    const row = (k, v) => (<React.Fragment key={k}><span style={label}>{k}</span><span style={{ fontSize: '0.9rem' }}>{v}</span></React.Fragment>);

    const canStart = isOwner && st.locked && delay > 0n && !dissolving && periodOver;
    const canStop = isOwner && st.locked && dissolving;
    const canIncrease = isOwner && st.locked;
    const canExtend = isOwner && st.locked && !dissolving;
    const addNs = (() => { const h = Number(addHours); return Number.isFinite(h) && h > 0 ? BigInt(Math.round(h * 3600)) * 1_000_000_000n : 0n; })();
    const newEndNs = newEnd ? BigInt(new Date(newEnd).getTime()) * 1_000_000n : 0n;

    return (
        <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '1.05rem', marginBottom: 8 }}>
                <FaHourglassHalf color="#f59e0b" /> Lock period and dissolve delay
            </div>
            <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, marginBottom: 12, lineHeight: 1.5 }}>
                A lock can have a <b>dissolve delay</b>, like an NNS neuron: once its lock period has ended, its owner can start dissolving it, and it unlocks when the delay has run out. Dissolving can be stopped (the time left becomes the delay again), and the delay can only grow.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', alignItems: 'baseline' }}>
                {row('Status', <b>{describeLockTime(st, fmt)}</b>)}
                {row('Lock period ends', periodOver ? `${fmt(lockExpiryToDate(st.lock_end))} (over)` : fmt(lockExpiryToDate(st.lock_end)))}
                {row('Dissolve delay', delay > 0n ? formatNsDuration(delay) : 'none')}
                {dissolving && row(st.locked ? 'Free at' : 'Dissolved at', fmt(lockExpiryToDate(st.dissolving_until[0])))}
                {limits && row('Limits', `lock period + delay between ${formatNsDuration(limits.min_lock_length_ns)} and ${formatNsDuration(limits.max_lock_length_ns)}`)}
            </div>

            {isOwner && st.locked && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" style={btn(canStart && !busy)} disabled={!canStart || !!busy} onClick={() => act('Start dissolving', (a) => a.start_dissolving(BigInt(lockId)))}
                            title={delay === 0n ? 'This lock has no dissolve delay' : !periodOver ? 'Dissolving can start when the lock period ends' : ''}>
                            <FaPlay size={11} /> Start dissolving
                        </button>
                        <button type="button" style={btn(canStop && !busy)} disabled={!canStop || !!busy} onClick={() => act('Stop dissolving', (a) => a.stop_dissolving(BigInt(lockId)))}>
                            <FaStop size={11} /> Stop dissolving
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input type="number" min="0" step="1" value={addHours} onChange={(e) => setAddHours(e.target.value)} style={{ ...input, width: 110 }} aria-label="Hours to add to the dissolve delay" />
                        <span style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>hours</span>
                        <button type="button" style={btn(canIncrease && addNs > 0n && !busy)} disabled={!canIncrease || addNs === 0n || !!busy}
                            onClick={() => act('Increase the dissolve delay', (a) => a.increase_dissolve_delay(BigInt(lockId), addNs))}>
                            <FaPlus size={11} /> {delay > 0n ? 'Add to the dissolve delay' : 'Give it a dissolve delay'}
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input type="datetime-local" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} style={input} aria-label="New end of the lock period" />
                        <button type="button" style={btn(canExtend && newEndNs > BigInt(st.lock_end) && !busy)} disabled={!canExtend || newEndNs <= BigInt(st.lock_end) || !!busy}
                            onClick={() => act('Extend the lock period', (a) => a.extend_lock(BigInt(lockId), newEndNs))}
                            title={dissolving ? 'Stop dissolving first' : ''}>
                            <FaCalendarPlus size={11} /> Extend the lock period
                        </button>
                    </div>
                    {delay > 0n && !periodOver && <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>Dissolving can start {fmt(lockExpiryToDate(st.lock_end))}. Before then the lock period can still be extended.</div>}
                    {busy && <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText }}>{busy}…</div>}
                    {msg && <div style={{ fontSize: '0.85rem', color: msg.ok ? theme.colors.success : (theme.colors.error || '#e74c3c') }}>{msg.text}</div>}
                </div>
            )}
            {!isOwner && st.locked && <div style={{ marginTop: 10, fontSize: '0.8rem', color: theme.colors.mutedText }}>Only the lock’s owner can change its dissolve state.</div>}
        </div>
    );
}

