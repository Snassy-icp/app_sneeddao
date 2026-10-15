// Gas of a token lock NFT (Sneed Lock v2, spec/sneed_lock_v2.md section 4). Sending a token lock
// costs one ledger fee, from its owner's free balance in Sneed Lock or else from the lock's gas
// tank (two fees per transfer). Anyone can top up any lock's tank, like cycles for a canister, so
// a lock held in a wallet that knows nothing about gas is never stuck. Renders nothing for
// position locks or against a Sneed Lock without gas tanks.
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaGasPump, FaTimes } from 'react-icons/fa';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';

const fmt = (amount, decimals) => {
    const d = Number(decimals ?? 8);
    const v = Number(amount) / 10 ** d;
    return v.toLocaleString(undefined, { maximumFractionDigits: Math.min(8, d) });
};

/** { account, ledger, fee, balance, symbol, decimals, transfers } for a token lock, or null. */
export function useLockGas(lockId) {
    const [gas, setGas] = useState(null);
    const load = useCallback(async () => {
        if (lockId === undefined || lockId === null) return;
        try {
            const sl = createSneedLockActor(sneedLockCanisterId);
            const [g] = await sl.get_lock_gas(BigInt(lockId));
            if (!g) { setGas(null); return; }
            const ledger = createLedgerActor(g.ledger.toText());
            const [balance, fee, symbol, decimals] = await Promise.all([
                ledger.icrc1_balance_of(g.account), ledger.icrc1_fee(), ledger.icrc1_symbol(), ledger.icrc1_decimals(),
            ]);
            setGas({ account: g.account, ledger: g.ledger, fee: BigInt(fee), balance: BigInt(balance), symbol, decimals: Number(decimals), transfers: fee > 0n ? BigInt(balance) / (2n * BigInt(fee)) : 0n });
        } catch (_) { setGas(null); }
    }, [lockId]);
    useEffect(() => { load(); }, [load]);
    return [gas, load];
}

/** The "Add gas" dialog: pays from the user's wallet into the lock's gas tank. */
export function AddGasDialog({ lockId, gas, onClose, onDone }) {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const [preset, setPreset] = useState(5);
    const [custom, setCustom] = useState('');
    const [walletBalance, setWalletBalance] = useState(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);

    useEffect(() => {
        if (!isAuthenticated || !identity || !gas) return;
        createLedgerActor(gas.ledger.toText()).icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] })
            .then((b) => setWalletBalance(BigInt(b))).catch(() => setWalletBalance(null));
    }, [isAuthenticated, identity, gas]);

    if (!gas) return null;
    const unit = 10n ** BigInt(gas.decimals);
    const customAmount = (() => {
        const t = custom.trim();
        if (!t) return null;
        if (!/^\d+(\.\d+)?$/.test(t)) return -1n;
        const [w, f = ''] = t.split('.');
        if (f.length > gas.decimals) return -1n;
        return BigInt(w) * unit + BigInt((f + '0'.repeat(gas.decimals)).slice(0, gas.decimals));
    })();
    const amount = customAmount !== null ? customAmount : BigInt(preset) * 2n * gas.fee;
    const valid = amount > 0n && (walletBalance === null || walletBalance >= amount + gas.fee);

    const pay = async () => {
        setBusy(true); setMsg(null);
        try {
            const ledger = createLedgerActor(gas.ledger.toText(), { agentOptions: { identity } });
            const r = await ledger.icrc1_transfer({ to: gas.account, amount, fee: [], memo: [], from_subaccount: [], created_at_time: [] });
            if ('Err' in r) throw new Error(JSON.stringify(r.Err, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
            setMsg({ ok: true, text: `Added ${fmt(amount, gas.decimals)} ${gas.symbol} of gas.` });
            onDone?.();
        } catch (e) { setMsg({ ok: false, text: e?.message || String(e) }); }
        finally { setBusy(false); }
    };

    const btn = (active) => ({ padding: '6px 12px', borderRadius: 8, border: `1px solid ${active ? theme.colors.accent : theme.colors.border}`, background: active ? `${theme.colors.accent}22` : 'transparent', color: theme.colors.primaryText, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 });
    return createPortal(
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: theme.colors.primaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1.1rem 1.25rem', color: theme.colors.primaryText }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '1.05rem' }}>
                    <FaGasPump color="#f59e0b" /> Add gas to lock #{String(lockId)}
                    <button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: theme.colors.mutedText, cursor: 'pointer' }}><FaTimes /></button>
                </div>
                <div style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: 1.5, margin: '10px 0' }}>
                    Sending this lock costs one {gas.symbol} ledger fee ({fmt(gas.fee, gas.decimals)} {gas.symbol}). When its owner has no free {gas.symbol} in Sneed Lock, the lock's gas account pays (two fees per transfer). Anyone can add gas to any lock; it is a gift to whoever owns the lock, and only they can take it back.
                </div>
                <div style={{ fontSize: '0.85rem', marginBottom: 10 }}>Now: <b>{fmt(gas.balance, gas.decimals)} {gas.symbol}</b>, about {gas.transfers.toString()} transfer{gas.transfers === 1n ? '' : 's'}.</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {[1, 5, 20].map((n) => <button key={n} type="button" style={btn(customAmount === null && preset === n)} onClick={() => { setPreset(n); setCustom(''); }}>{n} transfer{n === 1 ? '' : 's'}</button>)}
                </div>
                <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={`Or an amount in ${gas.symbol}`} aria-label="Gas amount"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: theme.colors.secondaryBg, color: theme.colors.primaryText, fontSize: '0.85rem' }} />
                <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, margin: '8px 0' }}>
                    {amount > 0n ? `Pays ${fmt(amount, gas.decimals)} ${gas.symbol} (plus one ledger fee) from your wallet.` : 'Enter a valid amount.'}
                    {walletBalance !== null && ` Your wallet: ${fmt(walletBalance, gas.decimals)} ${gas.symbol}.`}
                </div>
                {!isAuthenticated ? (
                    <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>Log in to add gas, or send {gas.symbol} from any wallet to account <code style={{ wordBreak: 'break-all' }}>{gas.account.owner.toText()}</code> with subaccount <code style={{ wordBreak: 'break-all' }}>{Array.from(gas.account.subaccount[0]).map((b) => b.toString(16).padStart(2, '0')).join('')}</code>.</div>
                ) : (
                    <button type="button" disabled={!valid || busy} onClick={pay}
                        style={{ padding: '0.5rem 1rem', borderRadius: 8, border: 'none', background: valid && !busy ? theme.colors.accent : (theme.colors.tertiaryBg || theme.colors.secondaryBg), color: valid && !busy ? '#fff' : theme.colors.mutedText, cursor: valid && !busy ? 'pointer' : 'not-allowed', fontWeight: 700 }}>
                        {busy ? 'Adding…' : 'Add gas'}
                    </button>
                )}
                {msg && <div style={{ marginTop: 8, fontSize: '0.85rem', color: msg.ok ? theme.colors.success : (theme.colors.error || '#e74c3c') }}>{msg.text}</div>}
            </div>
        </div>,
        document.body,
    );
}

/** "Gas: 0.05 SNEED · about 2 transfers [Add gas]" for any token lock, whoever owns it. */
/// `wrap` puts the widget in a labelled row so the row appears only for token locks with a tank.
export default function LockGas({ lockId, style, wrap = (node) => node }) {
    const { theme } = useTheme();
    const [gas, reload] = useLockGas(lockId);
    const [open, setOpen] = useState(false);
    if (!gas) return null;
    const low = gas.transfers === 0n;
    return wrap(
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '0.82rem', color: theme.colors.secondaryText, ...style }}>
            <FaGasPump size={11} color={low ? '#f59e0b' : theme.colors.mutedText} />
            <span title="Pays the ledger fee of a transfer when the owner has no free balance in Sneed Lock">Gas {fmt(gas.balance, gas.decimals)} {gas.symbol} · about {gas.transfers.toString()} transfer{gas.transfers === 1n ? '' : 's'}</span>
            <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
                style={{ padding: '2px 10px', borderRadius: 999, border: `1px solid ${theme.colors.border}`, background: 'transparent', color: theme.colors.accent, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>Add gas</button>
            {open && <AddGasDialog lockId={lockId} gas={gas} onClose={() => setOpen(false)} onDone={reload} />}
        </span>
    );
}
