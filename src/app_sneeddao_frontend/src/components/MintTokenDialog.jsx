// Minting from the wallet: on an ICRC-1 ledger a transfer from the minting account is a mint, so
// the token card offers this dialog when the logged-in principal's default account is the
// token's minting account (see useIsMinter).
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { decodeIcrcAccount } from '@dfinity/ledger-icrc';
import { FaCoins, FaTimes, FaCheckCircle } from 'react-icons/fa';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import PrincipalInput from './PrincipalInput';

const minters = new Map(); // ledger -> Promise<{ owner: string, sub: Uint8Array|null } | null>
const isZero = (b) => !b || Array.from(b).every((x) => x === 0);

/// The ledger's minting account, asked once per ledger per session.
function mintingAccount(ledger) {
    if (!minters.has(ledger)) {
        const p = createLedgerActor(ledger, { agentOptions: { host: 'https://icp-api.io' } }).icrc1_minting_account()
            .then((r) => (r && r.length ? { owner: r[0].owner.toText(), sub: r[0].subaccount?.[0] || null } : null))
            .catch(() => { minters.delete(ledger); return null; });
        minters.set(ledger, p);
    }
    return minters.get(ledger);
}

/// True when the logged-in principal's default account mints this token.
export function useIsMinter(ledger) {
    const { identity, isAuthenticated } = useAuth();
    const me = isAuthenticated ? identity?.getPrincipal?.()?.toText?.() : null;
    const [minter, setMinter] = useState(false);
    useEffect(() => {
        let alive = true;
        setMinter(false);
        if (!me || !ledger) return undefined;
        mintingAccount(ledger).then((m) => { if (alive) setMinter(!!m && m.owner === me && isZero(m.sub)); });
        return () => { alive = false; };
    }, [me, ledger]);
    return minter;
}

/// "1.5" with 8 decimals -> 150000000n; null when it is not a positive amount with at most `decimals` places.
function toUnits(text, decimals) {
    const t = text.trim();
    if (!/^\d*(\.\d*)?$/.test(t) || t === '' || t === '.') return null;
    const [w, f = ''] = t.split('.');
    if (f.length > decimals) return null;
    const v = BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
    return v > 0n ? v : null;
}
const fromUnits = (v, decimals) => (Number(v) / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: decimals });

export default function MintTokenDialog({ isOpen, onClose, token, onMinted }) {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const [recipient, setRecipient] = useState('');
    const [amount, setAmount] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(null);
    useEffect(() => { if (isOpen) { setRecipient(''); setAmount(''); setError(''); setDone(null); setBusy(false); } }, [isOpen]);
    if (!isOpen || !token) return null;

    const ledger = typeof token.ledger_canister_id === 'string' ? token.ledger_canister_id : token.ledger_canister_id?.toString();
    const decimals = Number(token.decimals ?? 8);
    const units = toUnits(amount, decimals);
    let to = null;
    // a principal, or an ICRC-1 account text (what the subaccount option puts in the field)
    try { const a = decodeIcrcAccount(recipient.trim()); to = { owner: a.owner, subaccount: a.subaccount && !isZero(a.subaccount) ? [a.subaccount] : [] }; } catch { to = null; }
    const ready = !!to && !!units && !busy;

    const mint = async () => {
        setBusy(true); setError('');
        try {
            const r = await createLedgerActor(ledger, { agentOptions: { identity } }).icrc1_transfer({ to, amount: units, fee: [], memo: [], from_subaccount: [], created_at_time: [] });
            if ('Err' in r) {
                const k = Object.keys(r.Err)[0];
                const v = r.Err[k];
                setError(k === 'GenericError' ? v.message : k === 'BadBurn' || k === 'BadFee' ? `${k}: the ledger refused the amount or fee` : k);
            } else {
                setDone({ block: r.Ok.toString(), amount: units, to: to.owner.toText() });
                onMinted?.();
            }
        } catch (e) { setError(e?.message || String(e)); }
        finally { setBusy(false); }
    };

    const input = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.colors.border}`, background: theme.colors.secondaryBg, color: theme.colors.primaryText, fontSize: '0.95rem' };
    const label = { fontSize: '0.75rem', color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 };
    const btn = (primary, enabled = true) => ({ padding: '10px 18px', borderRadius: 10, border: primary ? 'none' : `1px solid ${theme.colors.border}`, background: primary ? (enabled ? theme.colors.accent : theme.colors.tertiaryBg) : 'transparent', color: primary ? (enabled ? '#fff' : theme.colors.mutedText) : theme.colors.secondaryText, cursor: enabled ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '0.9rem' });

    return createPortal(
        <div onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000, padding: 16 }}>
            <div role="dialog" aria-label={`Mint ${token.symbol}`} style={{ width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto', background: theme.colors.cardBg || theme.colors.primaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 16, padding: '1.25rem', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '1.15rem', fontWeight: 700, color: theme.colors.primaryText }}>
                        <span style={{ width: 34, height: 34, borderRadius: 10, background: `${theme.colors.accent}22`, color: theme.colors.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><FaCoins /></span>
                        Mint {token.symbol}
                    </div>
                    <button type="button" aria-label="Close" onClick={onClose} disabled={busy} style={{ background: 'none', border: 'none', color: theme.colors.mutedText, cursor: busy ? 'not-allowed' : 'pointer', padding: 6 }}><FaTimes /></button>
                </div>

                {done ? (
                    <div style={{ textAlign: 'center', padding: '0.5rem 0 0.25rem' }}>
                        <FaCheckCircle size={40} color={theme.colors.success || '#10b981'} />
                        <div style={{ marginTop: 10, fontSize: '1.05rem', fontWeight: 700, color: theme.colors.primaryText }}>Minted {fromUnits(done.amount, decimals)} {token.symbol}</div>
                        <div style={{ marginTop: 6, fontSize: '0.85rem', color: theme.colors.secondaryText, wordBreak: 'break-all' }}>to {done.to}</div>
                        <div style={{ marginTop: 4, fontSize: '0.8rem', color: theme.colors.mutedText }}>Ledger block {done.block}</div>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
                            <button type="button" style={btn(false)} onClick={() => { setDone(null); setAmount(''); }}>Mint more</button>
                            <button type="button" style={btn(true)} onClick={onClose}>Done</button>
                        </div>
                    </div>
                ) : (
                    <>
                        <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: theme.colors.secondaryText, lineHeight: 1.5 }}>
                            Your principal is this token's minting account, so a transfer from it creates new {token.symbol}: the total supply grows by the amount. Minting costs no fee.
                        </p>
                        <div style={label}>Recipient</div>
                        <PrincipalInput value={recipient} onChange={setRecipient} isAuthenticated defaultTab="private" placeholder="Principal to receive the new tokens" disabled={busy} showSubaccountOption />
                        <div style={{ ...label, marginTop: 14 }}>Amount</div>
                        <div style={{ position: 'relative' }}>
                            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} inputMode="decimal" placeholder="0.0" disabled={busy} style={{ ...input, paddingRight: 70 }} />
                            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: theme.colors.mutedText, fontSize: '0.85rem' }}>{token.symbol}</span>
                        </div>
                        {amount && !units && <div style={{ marginTop: 6, fontSize: '0.8rem', color: theme.colors.error }}>Enter a positive amount with at most {decimals} decimals.</div>}
                        {error && <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 8, background: `${theme.colors.error}18`, color: theme.colors.error, fontSize: '0.85rem', wordBreak: 'break-word' }}>{error}</div>}
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18, flexWrap: 'wrap' }}>
                            <button type="button" style={btn(false, !busy)} onClick={onClose} disabled={busy}>Cancel</button>
                            <button type="button" style={btn(true, ready)} onClick={mint} disabled={!ready}>{busy ? 'Minting…' : units ? `Mint ${fromUnits(units, decimals)} ${token.symbol}` : 'Mint'}</button>
                        </div>
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
}
