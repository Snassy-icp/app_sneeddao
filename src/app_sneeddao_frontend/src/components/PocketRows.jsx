// Pocket rows (spec/programmable_accounts.md §4.3): the "in N pockets" rows of a token card, the
// token list of one selected pocket, and the Receive panel. Each row: name, host badge, balance
// (useDenomination for its value), shield badge with the grant count, and the actions the host
// allows: Send / Move / Receive for wallet pockets; Withdraw (to the wallet) for hosted pockets;
// Top up for service balances. Actions go back to the caller (`onAction(kind, pocket, token)`), which
// opens the one send dialog.
import React, { useState } from 'react';
import { FaShieldAlt, FaQrcode, FaPaperPlane, FaExchangeAlt, FaArrowUp, FaPlus, FaExclamationTriangle, FaCheck } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { usePockets } from '../hooks/usePockets';
import { normalizeId } from '../utils/IdUtils';
import { displayName, totalIn, countedIn, balanceOf, sortPockets, holders, MAIN_ID, LOCK_POCKET_ID, KIND, receiveAccount, ALL, isQuiet } from '../utils/pockets/model';
import { PocketAvatar, HostBadge, TokenAmount, PocketButton } from './PocketVisuals';
import { wrapKindOf } from '../utils/wrapActions';
import { encodeAccount, accountIdentifierHex } from '../utils/pockets/subaccount';
import { CopyValue, QrCode } from './convert/ConvertUi';

const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const ledgerOf = (token) => normalizeId(token?.ledger_canister_id || token?.principal);


/// Where to send tokens to this pocket: its ICRC-1 text, a QR code and, for ICP, the account identifier.
export function ReceivePanel({ pocket, ledger }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const account = receiveAccount(pocket);
    if (!account) return <div style={{ fontSize: '0.8rem', color: c.mutedText }}>This balance is kept in {pocket.host || 'the service'}'s own books: top it up through the service.</div>;
    const text = encodeAccount(account);
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
            <QrCode text={text} size={148} />
            <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: '0.75rem', color: c.mutedText }}>ICRC-1 account{pocket.number != null ? ` (pocket #${pocket.number})` : ''}</div>
                <CopyValue value={text} label="account" />
                {ledger === ICP_LEDGER && (
                    <>
                        <div style={{ fontSize: '0.75rem', color: c.mutedText }}>ICP account identifier (for exchanges)</div>
                        <CopyValue value={accountIdentifierHex(account)} label="account identifier" />
                    </>
                )}
                {pocket.kind === KIND.wallet && pocket.number != null && (
                    <div style={{ fontSize: '0.72rem', color: c.mutedText }}>Only wallets that understand subaccounts can pay this pocket; for others use Main.</div>
                )}
            </div>
        </div>
    );
}

/// What a pocket's row offers for this token.
export function pocketActions(p, ledger) {
    const bal = totalIn(p, ledger);
    const out = [];
    if (p.status === 'error') return out;
    if (p.kind === KIND.wallet) {
        if (bal > 0n) out.push('send', 'move');
        // GLDT ⇄ sGLDT wraps from Main only: Main wraps, other pockets move to Main first
        const wk = wrapKindOf(ledger);
        if (wk && bal > 0n) out.push(p.id === MAIN_ID ? wk : 'tomain');
        out.push('receive');
    } else {
        if (p.caps?.withdraw && (isQuiet(p) ? countedIn(p, ledger) : bal) > 0n) out.push('withdraw');
        if (p.kind === KIND.service && p.caps?.deposit) out.push('topup');
        if (p.kind === KIND.hosted && p.caps?.receive) out.push('receive');
    }
    return out;
}

const ACTIONS = {
    send: { icon: FaPaperPlane, label: 'Send' },
    move: { icon: FaExchangeAlt, label: 'Move', title: 'Move to another of your pockets' },
    receive: { icon: FaQrcode, label: 'Receive' },
    withdraw: { icon: FaArrowUp, label: 'Withdraw', title: 'Move to your wallet' },
    topup: { icon: FaPlus, label: 'Top up' },
    wrap: { icon: FaExchangeAlt, label: 'Wrap to sGLDT' },
    unwrap: { icon: FaExchangeAlt, label: 'Unwrap to GLDT' },
    tomain: { icon: FaArrowUp, label: 'Move to Main to wrap', title: 'Wrapping works from Main' },
};

/// One pocket for one token, in the token card's look: avatar, name and host badge on the left,
/// the amount with the token's logo and its value on the right, actions under it.
export function PocketRow({ pocket: p, token, onAction, hideButtons = false, title = null }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const [receiving, setReceiving] = useState(false);
    const ledger = ledgerOf(token);
    const b = balanceOf(p, ledger);
    const amount = b?.total ?? 0n;
    const reserved = isQuiet(p) && b && b.total > (b.available ?? b.total) ? b.total - b.available : 0n;
    const act = (k) => (k === 'receive' ? setReceiving((r) => !r) : onAction?.(k, p, token));
    const actions = hideButtons ? [] : pocketActions(p, ledger);
    return (
        <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 12, background: c.secondaryBg, border: `1px solid ${c.border}`, minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                {title ? (token?.logo ? <img src={token.logo} alt="" style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0 }} /> : <PocketAvatar pocket={p} />) : <PocketAvatar pocket={p} />}
                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: c.primaryText, fontSize: '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || displayName(p)}</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
                        {!title && <HostBadge pocket={p} />}
                        {p.grants > 0 && <span title={`${p.grants} grant${p.grants > 1 ? 's' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: c.accent, fontSize: '0.72rem' }}><FaShieldAlt size={10} />{p.grants}</span>}
                    </div>
                </div>
                <div style={{ flexShrink: 0, maxWidth: '55%' }}>
                    {p.status === 'error'
                        ? <span style={{ fontSize: '0.8rem', color: c.warning, display: 'inline-flex', alignItems: 'center', gap: 6 }}><FaExclamationTriangle size={11} /> couldn't read {p.host || p.adapterId}</span>
                        : <TokenAmount token={token} amount={amount} sub={b?.locked > 0n ? `${formatLocked(b.locked, token)} locked` : reserved > 0n ? `${formatLocked(reserved, token)} in escrow` : null} />}
                </div>
            </div>
            {b?.note && <div style={{ fontSize: '0.72rem', color: c.mutedText, marginTop: 6 }}>{b.note}</div>}
            {actions.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {actions.map((k) => <PocketButton key={k} icon={ACTIONS[k].icon} title={ACTIONS[k].title} onClick={() => act(k)}>{ACTIONS[k].label}</PocketButton>)}
                </div>
            )}
            {receiving && <div style={{ marginTop: 10 }}><ReceivePanel pocket={p} ledger={ledger} /></div>}
        </div>
    );
}

const formatLocked = (v, token) => {
    const d = token?.decimals ?? 8;
    const n = Number(v) / 10 ** d;
    return `${n.toLocaleString(undefined, { maximumFractionDigits: Math.min(d, 8) })} ${token?.symbol || ''}`.trim();
};

/// "New pocket" and "Move to a new pocket" right in a token card (casual and pro: one click, no
/// trip to /wallet/pockets). The new pocket's Receive panel opens in place.
export function NewPocketActions({ token, onAction }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const pk = usePockets();
    const [busy, setBusy] = useState(false);
    const [created, setCreated] = useState(null);
    const [err, setErr] = useState(null);
    const [name, setName] = useState('');
    const [named, setNamed] = useState(false);
    if (!pk.ctx) return null;
    const ledger = ledgerOf(token);
    const fee = BigInt(token?.fee ?? 0);
    const canMove = BigInt(token?.balance ?? 0) > fee;
    const make = async (thenMove) => {
        setBusy(true); setErr(null);
        try {
            const id = await pk.create({});
            if (thenMove) onAction?.('moveto', { id }, token);
            else { setCreated(id); setNamed(false); setName(''); }
        } catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
    };
    const pocket = created ? pk.pocketById(created) : null;
    return (
        <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <PocketButton icon={FaPlus} disabled={busy} onClick={() => make(false)} title="A numbered subaccount of your wallet: receive on it, approve from it">New pocket</PocketButton>
                {canMove && <PocketButton icon={FaExchangeAlt} disabled={busy} onClick={() => make(true)}>Move to a new pocket</PocketButton>}
            </div>
            {err && <div style={{ color: c.error, fontSize: '0.8rem', marginTop: 6 }}>{err}</div>}
            {pocket && (
                <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 12, background: c.secondaryBg, border: `1px solid ${c.accent}55` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                        <PocketAvatar pocket={pocket} />
                        <div style={{ fontWeight: 700, color: c.primaryText, flex: '1 1 auto' }}>{displayName(pocket)} created</div>
                        {!named ? (
                            <div style={{ display: 'flex', gap: 6, flex: '1 1 220px' }}>
                                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Name it (optional, private)"
                                    style={{ flex: 1, minWidth: 0, padding: '6px 10px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.primaryBg, color: c.primaryText, fontSize: '0.85rem' }} />
                                <PocketButton icon={FaCheck} disabled={!name.trim() || busy} onClick={async () => { try { await pk.rename(pocket, name); setNamed(true); } catch (e) { setErr(e?.message || String(e)); } }}>Save</PocketButton>
                            </div>
                        ) : null}
                    </div>
                    <ReceivePanel pocket={pocket} ledger={ledger} />
                </div>
            )}
        </div>
    );
}

/// The pockets holding this token besides Main and the Sneed Lock wallet (which the card shows
/// already), and the new-pocket actions.
export default function PocketRows({ token, onAction, hideButtons, includeBase = false }) {
    const pk = usePockets();
    const ledger = ledgerOf(token);
    if (!ledger) return null;
    const rows = sortPockets(holders(pk.pockets, ledger).concat(pk.pockets.filter((p) => p.status === 'error' && !p.hidden && p.ledgers.includes(ledger))))
        .filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i)
        .filter((p) => includeBase || (p.id !== MAIN_ID && p.id !== LOCK_POCKET_ID));
    return (
        <div>
            {rows.map((p) => <PocketRow key={p.id} pocket={p} token={token} onAction={onAction} hideButtons={hideButtons} />)}
            {!hideButtons && <NewPocketActions token={token} onAction={onAction} />}
        </div>
    );
}

/// "in N pockets ▸": the count of visible pockets holding the token (shown only when more than one).
export function usePocketCount(token) {
    const pk = usePockets();
    const ledger = ledgerOf(token);
    return ledger ? holders(pk.pockets, ledger).length : 0;
}

/// One selected pocket's tokens (the switcher, §4.3): every token it holds with its balance there.
export function PocketTokenList({ tokens, onAction }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const pk = usePockets();
    if (pk.selected === ALL) return null;
    const pocket = pk.pockets.find((p) => p.id === pk.selected);
    if (!pocket) return null;
    const shown = tokens.filter((t) => !pk.hideEmpty || totalIn(pocket, ledgerOf(t)) > 0n);
    return (
        <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 16, padding: 14, minWidth: 0, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <PocketAvatar pocket={pocket} size={42} />
                <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.05rem', color: c.primaryText }}>{displayName(pocket)}</div>
                    <div style={{ marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <HostBadge pocket={pocket} />
                        {pocket.status === 'error' && <span style={{ color: c.warning, fontSize: '0.78rem' }}>couldn't read {pocket.host}</span>}
                    </div>
                </div>
            </div>
            {!shown.length && <div style={{ padding: '12px 0 2px', fontSize: '0.85rem', color: c.mutedText }}>This pocket holds none of your wallet's tokens yet.</div>}
            {shown.map((t) => <PocketRow key={ledgerOf(t)} pocket={pocket} title={t.symbol} token={t} onAction={onAction} />)}
        </div>
    );
}
