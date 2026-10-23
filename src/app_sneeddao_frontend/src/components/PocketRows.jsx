// Pocket rows (spec/programmable_accounts.md §4.3): the "in N pockets" rows of a token card, the
// token list of one selected pocket, and the Receive panel. Each row: name, host badge, balance
// (useDenomination for its value), shield badge with the grant count, and the actions the host
// allows: Send / Move / Receive for wallet pockets; Withdraw (to the wallet) for hosted pockets;
// Top up for service balances. Actions go back to the caller (`onAction(kind, pocket, token)`), which
// opens the one send dialog.
import React, { useState } from 'react';
import { FaTrash, FaShieldAlt, FaQrcode, FaPaperPlane, FaExchangeAlt, FaArrowUp, FaArrowDown, FaPlus, FaExclamationTriangle, FaCheck } from 'react-icons/fa';
import { useDenomination } from '../contexts/DenominationContext';
import { formatAmount, computeUsdValue } from '../utils/StringUtils';
import { useTheme } from '../contexts/ThemeContext';
import { usePockets } from '../hooks/usePockets';
import { normalizeId } from '../utils/IdUtils';
import { displayName, totalIn, countedIn, balanceOf, sortPockets, holders, MAIN_ID, LOCK_POCKET_ID, KIND, receiveAccount, ALL, isQuiet, isEmpty, canRemove } from '../utils/pockets/model';
import { appConfirm } from '../utils/appDialog';
import { PocketAvatar, HostBadge, PocketButton } from './PocketVisuals';
import { wrapKindOf } from '../utils/wrapActions';
import { encodeAccount, accountIdentifierHex } from '../utils/pockets/subaccount';
import { CopyValue, QrCode } from './convert/ConvertUi';

const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const ledgerOf = (token) => normalizeId(token?.ledger_canister_id || token?.principal);


/// Where to send tokens to this pocket: its ICRC-1 text, a QR code and, for ICP, the account identifier.
const QR_KEY = 'sneed_pockets_show_qr_v1';
const readQr = () => { try { return localStorage.getItem(QR_KEY) === '1'; } catch { return false; } };
const writeQr = (v) => { try { localStorage.setItem(QR_KEY, v ? '1' : '0'); } catch { /* storage blocked */ } };

export function ReceivePanel({ pocket, ledger }) {
    const { theme } = useTheme();
    const c = theme.colors;
    // the QR code only on request (it takes a lot of room on a phone); remembered on this device
    const [showQr, setShowQrState] = useState(readQr);
    const setShowQr = (v) => { setShowQrState(v); writeQr(v); };
    const account = receiveAccount(pocket);
    if (!account) return <div style={{ fontSize: '0.8rem', color: c.mutedText }}>This balance is kept in {pocket.host || 'the service'}'s own books: top it up through the service.</div>;
    const text = encodeAccount(account);
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
            {showQr && <QrCode text={text} size={148} />}
            <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: '0.75rem', color: c.mutedText }}>ICRC-1 account{pocket.number != null ? ` (pocket #${pocket.number})` : ''}</div>
                <CopyValue value={text} label="account" />
                {ledger === ICP_LEDGER && (
                    <>
                        <div style={{ fontSize: '0.75rem', color: c.mutedText }}>ICP account identifier (for exchanges)</div>
                        <CopyValue value={accountIdentifierHex(account)} label="account identifier" />
                    </>
                )}
                <button type="button" onClick={(e) => { e.stopPropagation(); setShowQr(!showQr); }}
                    style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, color: c.accent, cursor: 'pointer', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <FaQrcode size={10} /> {showQr ? 'Hide QR' : 'Show QR'}
                </button>
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
    tomain: { icon: FaArrowUp, label: 'Move to Main', title: 'Wrapping works from Main' },
    remove: { icon: FaTrash, label: 'Remove', title: 'Remove this pocket from your list' },
};

/// The one pocket row (320px and up): [avatar] [name + small badge, truncating] [amount, right;
/// it wraps under the name when there is no room] and small action buttons that wrap below.
/// No fixed widths: every flex child has min-width 0.
export function PocketLine({ avatar, name, badge, amount, sub, actions = [], note, children, first = false, title }) {
    const { theme } = useTheme();
    const c = theme.colors;
    return (
        <div title={title} style={{ padding: '10px 0', borderTop: first ? 'none' : `1px solid ${c.border}`, minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 140px', minWidth: 0 }}>
                    {avatar}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: '1 1 auto' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.88rem', color: c.primaryText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{name}</span>
                        {badge ? <span style={{ flexShrink: 0, maxWidth: '50%', overflow: 'hidden' }}>{badge}</span> : null}
                    </div>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'right', minWidth: 0, maxWidth: '100%', flex: '0 1 auto' }}>
                    {amount}
                    {sub ? <div style={{ fontSize: '0.72rem', color: c.mutedText, overflowWrap: 'anywhere' }}>{sub}</div> : null}
                </div>
            </div>
            {note ? <div style={{ fontSize: '0.72rem', color: c.mutedText, marginTop: 4, overflowWrap: 'anywhere' }}>{note}</div> : null}
            {actions.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {actions.map((a) => <PocketButton key={a.key} small icon={a.icon} title={a.title} onClick={a.onClick} disabled={a.disabled}>{a.label}</PocketButton>)}
                </div>
            )}
            {children}
        </div>
    );
}

/// The amount on a row: "0.2126 SNEED" and its value (useDenomination); wraps instead of overflowing.
export function LineAmount({ token, amount }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const { formatValue } = useDenomination();
    const usd = token?.conversion_rate ? computeUsdValue(amount, token.decimals, token.conversion_rate) : null;
    return (
        <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: c.primaryText, overflowWrap: 'anywhere' }}>
                {formatAmount(amount, token?.decimals ?? 8)} <span style={{ color: c.secondaryText, fontWeight: 600 }}>{token?.symbol || ''}</span>
            </div>
            {usd != null && usd > 0 ? <div style={{ fontSize: '0.72rem', color: c.mutedText }}>{formatValue(usd)}</div> : null}
        </div>
    );
}

const fmt = (v, token) => formatAmount(v, token?.decimals ?? 8);

/// "Remove pocket": an empty pocket is forgotten (after a yes); one that still holds tokens says to
/// empty it first and offers "Move all to Main" for the tokens it holds (`tokens`).
export function RemovePocketPanel({ pocket: p, tokens = [], onAction, onDone }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const pk = usePockets();
    const [err, setErr] = useState(null);
    const [busy, setBusy] = useState(false);
    const held = tokens.filter((t) => totalIn(p, ledgerOf(t)) > 0n);
    if (!isEmpty(p)) {
        return (
            <div style={{ marginTop: 8, fontSize: '0.78rem', color: c.secondaryText }} onClick={(e) => e.stopPropagation()}>
                <div>{displayName(p)} still holds tokens: empty it first, then remove it.</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {held.map((t) => <PocketButton key={ledgerOf(t)} small icon={FaArrowUp} onClick={() => onAction?.('emptytomain', p, t)}>Move all {t.symbol} to Main</PocketButton>)}
                </div>
            </div>
        );
    }
    const remove = async () => {
        setErr(null);
        const ok = await appConfirm(`Remove ${displayName(p)} from your pockets? The subaccount stays on-chain: if tokens arrive there later, the wallet finds it again.`, { type: 'warning', confirmText: 'Remove' });
        if (!ok) return;
        setBusy(true);
        try { await pk.forget(p); onDone?.(); } catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); }
    };
    return (
        <div style={{ marginTop: 8, fontSize: '0.78rem', color: c.secondaryText }} onClick={(e) => e.stopPropagation()}>
            <PocketButton small icon={FaTrash} disabled={busy} onClick={remove}>Remove {displayName(p)}</PocketButton>
            <div style={{ marginTop: 4, color: c.mutedText }}>The subaccount stays on-chain; if tokens arrive later, it comes back.</div>
            {err && <div style={{ color: c.error, marginTop: 4 }}>{err}</div>}
        </div>
    );
}

/// One pocket for one token: a PocketLine with its avatar, host badge, amount and actions.
export function PocketRow({ pocket: p, token, onAction, hideButtons = false, title = null, first = false }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const [receiving, setReceiving] = useState(false);
    const [removing, setRemoving] = useState(false);
    const ledger = ledgerOf(token);
    const b = balanceOf(p, ledger);
    const amount = b?.total ?? 0n;
    const reserved = isQuiet(p) && b && b.total > (b.available ?? b.total) ? b.total - b.available : 0n;
    const act = (k) => (k === 'receive' ? setReceiving((r) => !r) : k === 'remove' ? setRemoving((r) => !r) : onAction?.(k, p, token));
    const keys = hideButtons ? [] : [...pocketActions(p, ledger), ...(canRemove(p) && !title ? ['remove'] : [])];
    const actions = keys.map((k) => ({ key: k, ...ACTIONS[k], onClick: () => act(k) }));
    const avatar = title && token?.logo ? <img src={token.logo} alt="" style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0 }} /> : <PocketAvatar pocket={p} size={26} />;
    return (
        <PocketLine first={first} avatar={avatar} name={title || displayName(p)}
            badge={title || p.kind === KIND.wallet || (p.host && displayName(p).includes(p.host)) ? null : <HostBadge pocket={p} />}
            amount={p.status === 'error'
                ? <span style={{ fontSize: '0.78rem', color: c.warning, display: 'inline-flex', alignItems: 'center', gap: 5 }}><FaExclamationTriangle size={10} /> couldn't read</span>
                : <LineAmount token={token} amount={amount} />}
            sub={b?.locked > 0n ? `locked ${fmt(b.locked, token)} / free ${fmt(b.available ?? 0n, token)}` : reserved > 0n ? `${fmt(reserved, token)} in escrow` : null}
            note={p.grants > 0 ? <span style={{ color: c.accent, display: 'inline-flex', alignItems: 'center', gap: 4 }}><FaShieldAlt size={10} /> {p.grants} grant{p.grants > 1 ? 's' : ''}</span> : null}
            actions={actions}>
            {receiving && <div style={{ marginTop: 10 }}><ReceivePanel pocket={p} ledger={ledger} /></div>}
            {removing && <RemovePocketPanel pocket={p} tokens={[token]} onAction={onAction} />}
        </PocketLine>
    );
}

/// "New pocket" and "Move to a new pocket", one compact row in a token card (casual and pro: one
/// click, no trip to /wallet/pockets). The new pocket's Receive panel opens in place.
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
        <div style={{ paddingTop: 10, borderTop: `1px solid ${c.border}` }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <PocketButton small icon={FaPlus} disabled={busy} onClick={() => make(false)} title="A numbered subaccount of your wallet: receive on it, approve from it">New pocket</PocketButton>
                {canMove && <PocketButton small icon={FaExchangeAlt} disabled={busy} onClick={() => make(true)} title="Create a pocket and move tokens there from Main">Move to new</PocketButton>}
            </div>
            {err && <div style={{ color: c.error, fontSize: '0.78rem', marginTop: 6 }}>{err}</div>}
            {pocket && (
                <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: c.primaryBg, border: `1px solid ${c.accent}55`, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10, minWidth: 0 }}>
                        <PocketAvatar pocket={pocket} size={26} />
                        <span style={{ fontWeight: 700, color: c.primaryText, fontSize: '0.88rem' }}>{displayName(pocket)} created</span>
                        {!named && (
                            <div style={{ display: 'flex', gap: 6, flex: '1 1 180px', minWidth: 0 }}>
                                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Name it (private)"
                                    style={{ flex: 1, minWidth: 0, padding: '5px 9px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText, fontSize: '0.82rem' }} />
                                <PocketButton small icon={FaCheck} disabled={!name.trim() || busy} onClick={async () => { try { await pk.rename(pocket, name); setNamed(true); } catch (e) { setErr(e?.message || String(e)); } }}>Save</PocketButton>
                            </div>
                        )}
                    </div>
                    <ReceivePanel pocket={pocket} ledger={ledger} />
                </div>
            )}
        </div>
    );
}

/// The token card's breakdown with pockets: Main (Wallet) and Sneed Lock as the first two rows, in
/// the same row design as every other pocket, then the other pockets holding the token, then the
/// new-pocket actions. `onDeposit` / `onWithdrawLock` are the card's Sneed Lock deposit / withdraw.
export function TokenPocketBreakdown({ token, hideButtons, onAction, onDeposit, onWithdrawLock }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const pk = usePockets();
    const ledger = ledgerOf(token);
    const fee = BigInt(token?.fee ?? 0);
    const main = BigInt(token?.balance ?? 0);
    const lockTotal = BigInt(token?.balance_backend ?? 0);
    const locked = BigInt(token?.locked ?? 0);
    const lockFree = BigInt(token?.available_backend ?? (lockTotal > locked ? lockTotal - locked : 0n));
    const mainPocket = pk.pockets.find((p) => p.id === MAIN_ID) || { id: MAIN_ID, kind: KIND.wallet, number: null, account: null, nickname: '' };
    const lockPocket = pk.pockets.find((p) => p.id === LOCK_POCKET_ID) || { id: LOCK_POCKET_ID, kind: KIND.hosted, adapterId: 'sneed_lock', host: 'Sneed Lock', defaultLabel: 'Sneed Lock', nickname: '' };
    const others = ledger ? sortPockets(holders(pk.pockets, ledger).concat(pk.pockets.filter((p) => p.status === 'error' && !p.hidden && p.ledgers.includes(ledger))))
        .filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i)
        .filter((p) => p.id !== MAIN_ID && p.id !== LOCK_POCKET_ID) : [];
    const showLock = lockTotal > 0n;
    return (
        <div style={{ padding: '2px 12px 10px', background: c.secondaryBg, borderRadius: 10, border: `1px solid ${c.border}`, margin: '8px 0', minWidth: 0 }}>
            <PocketLine first avatar={<PocketAvatar pocket={mainPocket} size={26} />} name={displayName(mainPocket)} badge={null}
                amount={<LineAmount token={token} amount={main} />}
                actions={!hideButtons && main > fee ? [{ key: 'dep', icon: FaArrowDown, label: 'Deposit to Sneed Lock', onClick: onDeposit }] : []} />
            {showLock && (
                <PocketLine avatar={<PocketAvatar pocket={lockPocket} size={26} />} name={displayName(lockPocket)} badge={null}
                    title="Tokens you hold in Sneed Lock; locked ones can't move until they unlock"
                    amount={<LineAmount token={token} amount={lockTotal} />}
                    sub={locked > 0n ? `locked ${fmt(locked, token)} / free ${fmt(lockFree, token)}` : null}
                    actions={!hideButtons && lockFree > 0n ? [{ key: 'wd', icon: FaArrowUp, label: 'Withdraw', onClick: onWithdrawLock }] : []} />
            )}
            {others.map((p) => <PocketRow key={p.id} pocket={p} token={token} onAction={onAction} hideButtons={hideButtons} />)}
            {!hideButtons && <NewPocketActions token={token} onAction={onAction} />}
        </div>
    );
}

/// The pockets holding this token besides Main and the Sneed Lock wallet, and the new-pocket actions.
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
    const [removing, setRemoving] = useState(false);
    if (pk.selected === ALL) return null;
    const pocket = pk.pockets.find((p) => p.id === pk.selected);
    if (!pocket) return null;
    const shown = tokens.filter((t) => !pk.hideEmpty || totalIn(pocket, ledgerOf(t)) > 0n);
    return (
        <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '12px 14px 4px', minWidth: 0, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, paddingBottom: 8 }}>
                <PocketAvatar pocket={pocket} size={36} />
                <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: c.primaryText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(pocket)}</div>
                    <div style={{ marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <HostBadge pocket={pocket} />
                        {pocket.status === 'error' && <span style={{ color: c.warning, fontSize: '0.75rem' }}>couldn't read {pocket.host}</span>}
                    </div>
                </div>
                {canRemove(pocket) && <PocketButton small icon={FaTrash} onClick={() => setRemoving(!removing)}>Remove</PocketButton>}
            </div>
            {removing && <div style={{ paddingBottom: 8 }}><RemovePocketPanel pocket={pocket} tokens={tokens} onAction={onAction} onDone={() => pk.setSelected(ALL)} /></div>}
            {!shown.length && <div style={{ padding: '10px 0', fontSize: '0.85rem', color: c.mutedText, borderTop: `1px solid ${c.border}` }}>This pocket holds none of your wallet's tokens yet.</div>}
            {shown.map((t) => <PocketRow key={ledgerOf(t)} pocket={pocket} title={t.symbol} token={t} onAction={onAction} />)}
        </div>
    );
}
