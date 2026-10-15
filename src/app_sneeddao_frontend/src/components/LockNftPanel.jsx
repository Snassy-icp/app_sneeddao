// A locked LP position as an NFT (Sneed Lock v2b, spec/sneed_lock_v2.md sections 2 and 3):
// its card, token id and holding account, and for the holder an ICRC-7 transfer to any
// account (principal + optional subaccount). Renders nothing for token locks, for positions
// without an NFT, or against a Sneed Lock without ICRC-7.
import React, { useCallback, useEffect, useState } from 'react';
import { Principal } from '@dfinity/principal';
import { FaGem, FaPaperPlane } from 'react-icons/fa';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import PrincipalInput from './PrincipalInput';
import LockGas from './LockGas';

const toHex = (u8) => Array.from(u8).map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => {
    const t = h.trim().replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{64}$/.test(t)) return null;
    return Uint8Array.from(t.match(/../g).map((x) => parseInt(x, 16)));
};
const errText = (e) => {
    if (!e) return 'Unknown error';
    const k = Object.keys(e)[0];
    if (k === 'GenericError' || k === 'GenericBatchError') return e[k].message;
    return { Unauthorized: 'Only the account holding the NFT can transfer it.', InvalidRecipient: 'That recipient is not valid (the same account, or anonymous).', NonExistingTokenId: 'This NFT no longer exists.' }[k] || k;
};

/// A position lock (swapCanisterId + positionId: its NFT id is looked up) or a token lock
/// (tokenId = its lock id).
export default function LockNftPanel({ swapCanisterId, positionId, tokenId, onChanged }) {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const [tid, setTid] = useState(null);
    const [owner, setOwner] = useState(null);
    const [image, setImage] = useState(null);
    const [to, setTo] = useState('');
    const [toSub, setToSub] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    const [gasKey, setGasKey] = useState(0);

    const load = useCallback(async () => {
        try {
            const a = createSneedLockActor(sneedLockCanisterId);
            const t = tokenId !== undefined && tokenId !== null ? [BigInt(tokenId)] : await a.get_position_nft(Principal.fromText(String(swapCanisterId)), BigInt(positionId));
            if (!t.length) { setTid(null); return; }
            const [o] = await a.icrc7_owner_of([t[0]]);
            if (!o.length) { setTid(null); return; } // not (or no longer) an NFT
            const [m] = await a.icrc7_token_metadata([t[0]]);
            setTid(t[0]); setOwner(o[0] || null);
            const img = (m[0] || []).find(([k]) => k === 'icrc7:image');
            setImage(img ? img[1].Text : null);
        } catch (_) { setTid(null); }
    }, [swapCanisterId, positionId, tokenId]);
    useEffect(() => { if ((tokenId !== undefined && tokenId !== null) || (swapCanisterId && positionId !== undefined && positionId !== null)) load(); }, [load, swapCanisterId, positionId, tokenId]);

    if (tid === null) return null;
    const me = identity?.getPrincipal?.().toText?.();
    const isHolder = me && owner && owner.owner.toText() === me;
    const label = owner?.subaccount?.length ? toHex(owner.subaccount[0]) : null;
    const isToken = tokenId !== undefined && tokenId !== null;
    const subBytes = toSub.trim() ? fromHex(toSub) : undefined;
    let toPrincipal = null;
    try { toPrincipal = to ? Principal.fromText(to.trim()) : null; } catch (_) { toPrincipal = null; }
    const canSend = isHolder && toPrincipal && subBytes !== null && !busy;

    const send = async () => {
        setBusy(true); setMsg(null);
        try {
            const a = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            const [r] = await a.icrc7_transfer([{
                from_subaccount: owner.subaccount, to: { owner: toPrincipal, subaccount: subBytes ? [subBytes] : [] },
                token_id: tid, memo: [], created_at_time: [BigInt(Date.now()) * 1_000_000n],
            }]);
            const res = r[0];
            if (res && 'Ok' in res) { setMsg({ ok: true, text: `Sent (block ${res.Ok.toString()}).` }); setTo(''); setToSub(''); setGasKey((k) => k + 1); await load(); onChanged?.(); }
            else setMsg({ ok: false, text: errText(res?.Err), needsGas: res?.Err?.GenericError?.error_code === 7n });
        } catch (e) { setMsg({ ok: false, text: e?.message || String(e) }); }
        finally { setBusy(false); }
    };

    const card = { background: theme.colors.cardGradient || theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1.1rem 1.25rem', margin: '1rem auto', maxWidth: 720, color: theme.colors.primaryText };
    const lbl = { fontSize: '0.72rem', fontWeight: 600, color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px' };
    const input = { padding: '0.45rem 0.6rem', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' };

    return (
        <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '1.05rem', marginBottom: 10 }}>
                <FaGem color="#a78bfa" /> NFT #{tid.toString()}
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {image && <img src={image} alt={`Sneed Lock NFT #${tid}`} style={{ width: 160, height: 160, borderRadius: 12, flex: '0 0 auto' }} />}
                <div style={{ flex: '1 1 240px', minWidth: 0, fontSize: '0.85rem', lineHeight: 1.55 }}>
                    <div style={{ color: theme.colors.secondaryText, marginBottom: 8 }}>
                        {isToken
                            ? <>This lock is an ICRC-7 NFT in the Sneed Lock collection (canister <code>{sneedLockCanisterId}</code>). Whoever holds it owns the lock and receives its tokens once it unlocks. Wallets and marketplaces that speak ICRC-7 and ICRC-37 can show, send and list it.</>
                            : <>This locked position is an ICRC-7 NFT in the Sneed Lock collection (canister <code>{sneedLockCanisterId}</code>). Whoever holds it owns the position, its lock and its fees. Wallets and marketplaces that speak ICRC-7 and ICRC-37 can show, send and list it.</>}
                    </div>
                    <div style={lbl}>Held by</div>
                    <div style={{ wordBreak: 'break-all' }}>{owner ? owner.owner.toText() : '—'}</div>
                    {label && <><div style={{ ...lbl, marginTop: 6 }}>Subaccount</div><div style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.75rem' }}>{label}</div></>}
                </div>
            </div>
            {isToken && <div style={{ marginTop: 12 }}><LockGas key={gasKey} lockId={tid} /></div>}
            {isHolder && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={lbl}>Send the NFT</div>
                    <PrincipalInput value={to} onChange={setTo} placeholder="Recipient principal" defaultTab="all" style={{ width: '100%' }} inputStyle={input} />
                    <input value={toSub} onChange={(e) => setToSub(e.target.value)} placeholder="Recipient subaccount (optional, 64 hex characters)" style={{ ...input, fontFamily: 'monospace' }} aria-label="Recipient subaccount" />
                    {subBytes === null && <div style={{ fontSize: '0.8rem', color: theme.colors.error || '#e74c3c' }}>A subaccount is 64 hex characters.</div>}
                    <div>
                        <button type="button" onClick={send} disabled={!canSend} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0.45rem 0.9rem', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: canSend ? theme.colors.accent : (theme.colors.tertiaryBg || theme.colors.secondaryBg), color: canSend ? '#fff' : theme.colors.mutedText, cursor: canSend ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: '0.85rem' }}>
                            <FaPaperPlane size={11} /> {busy ? 'Sending…' : 'Send'}
                        </button>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>{isToken
                        ? 'The lock and its tokens go with it. No Sneed fee; the ledger fee comes from your free balance in Sneed Lock, else from the lock\'s gas.'
                        : 'The position, its lock and any unclaimed fees go with it. Free: no Sneed fee.'}</div>
                    {msg && <div style={{ fontSize: '0.85rem', color: msg.ok ? theme.colors.success : (theme.colors.error || '#e74c3c') }}>{msg.needsGas ? 'This lock needs gas to move: add some below (anyone can), or keep a little of its token free in your Sneed wallet.' : msg.text}</div>}
                </div>
            )}
        </div>
    );
}
