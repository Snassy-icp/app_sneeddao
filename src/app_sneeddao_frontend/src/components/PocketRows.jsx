// Pocket rows (spec/programmable_accounts.md §4.3): the "in N pockets" rows of a token card, the
// token list of one selected pocket, and the Receive panel. Each row: name, host badge, balance
// (useDenomination for its value), shield badge with the grant count, and the actions the host
// allows: Send / Move / Receive for wallet pockets; Withdraw (to the wallet) for hosted pockets;
// Top up for service balances. Actions go back to the caller (`onAction(kind, pocket, token)`), which
// opens the one send dialog.
import React, { useState } from 'react';
import { FaWallet, FaServer, FaConciergeBell, FaShieldAlt, FaQrcode, FaPaperPlane, FaExchangeAlt, FaArrowUp, FaPlus, FaExclamationTriangle } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useDenomination } from '../contexts/DenominationContext';
import { usePockets } from '../hooks/usePockets';
import { normalizeId } from '../utils/IdUtils';
import { formatAmount, computeUsdValue } from '../utils/StringUtils';
import { displayName, badge, totalIn, balanceOf, sortPockets, holders, MAIN_ID, LOCK_POCKET_ID, KIND, receiveAccount, ALL } from '../utils/pockets/model';
import { encodeAccount, accountIdentifierHex } from '../utils/pockets/subaccount';
import { CopyValue, QrCode } from './convert/ConvertUi';

const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const ledgerOf = (token) => normalizeId(token?.ledger_canister_id || token?.principal);

const KIND_ICON = { wallet: FaWallet, hosted: FaServer, service: FaConciergeBell };

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

function ActionBtn({ icon: Icon, children, onClick, title }) {
    const { theme } = useTheme();
    const c = theme.colors;
    return (
        <button type="button" title={title} onClick={(e) => { e.stopPropagation(); onClick(); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', fontSize: '0.75rem', fontWeight: 500, borderRadius: 6, cursor: 'pointer', background: 'transparent', color: c.primaryText, border: `1px solid ${c.border}` }}>
            <Icon size={10} /> {children}
        </button>
    );
}

/// What a pocket's row offers for this token.
export function pocketActions(p, ledger) {
    const bal = totalIn(p, ledger);
    const out = [];
    if (p.status === 'error') return out;
    if (p.kind === KIND.wallet) {
        if (bal > 0n) out.push('send', 'move');
        out.push('receive');
    } else {
        if (p.caps?.withdraw && bal > 0n) out.push('withdraw');
        if (p.kind === KIND.service && p.caps?.deposit) out.push('topup');
        if (p.kind === KIND.hosted && p.caps?.receive) out.push('receive');
    }
    return out;
}

export function PocketRow({ pocket: p, token, onAction, hideButtons = false, title = null }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const { formatValue } = useDenomination();
    const [receiving, setReceiving] = useState(false);
    const ledger = ledgerOf(token);
    const b = balanceOf(p, ledger);
    const amount = b?.total ?? 0n;
    const usd = token?.conversion_rate ? computeUsdValue(amount, token.decimals, token.conversion_rate) : null;
    const Icon = KIND_ICON[p.kind] || FaWallet;
    const act = (k) => (k === 'receive' ? setReceiving((r) => !r) : onAction?.(k, p, token));
    return (
        <div style={{ padding: '10px 0', borderTop: `1px solid ${c.border}`, minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: '1 1 160px' }}>
                    <div style={{ fontSize: '0.75rem', color: c.mutedText, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Icon size={10} />
                        <span style={{ color: c.secondaryText, fontWeight: 600 }}>{title || displayName(p)}</span>
                        {!title && <span style={{ padding: '0 6px', borderRadius: 6, border: `1px solid ${c.border}`, fontSize: '0.68rem' }}>{badge(p)}</span>}
                        {p.grants > 0 && <span title={`${p.grants} grant${p.grants > 1 ? 's' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: c.accent }}><FaShieldAlt size={10} />{p.grants}</span>}
                    </div>
                    {p.status === 'error' ? (
                        <div style={{ fontSize: '0.8rem', color: c.warning, display: 'flex', alignItems: 'center', gap: 6 }}><FaExclamationTriangle size={11} /> couldn't read {p.host || p.adapterId}</div>
                    ) : (
                        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: c.primaryText }}>
                            {formatAmount(amount, token.decimals)} {token.symbol}
                            {usd != null && usd > 0 && <span style={{ fontWeight: 400, color: c.mutedText, marginLeft: 6 }}>{formatValue(usd)}</span>}
                        </div>
                    )}
                    {b?.locked > 0n && <div style={{ fontSize: '0.72rem', color: c.mutedText }}>{formatAmount(b.locked, token.decimals)} locked</div>}
                    {b?.note && <div style={{ fontSize: '0.72rem', color: c.mutedText }}>{b.note}</div>}
                </div>
                {!hideButtons && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {pocketActions(p, ledger).map((k) => (
                            k === 'send' ? <ActionBtn key={k} icon={FaPaperPlane} onClick={() => act(k)}>Send</ActionBtn>
                                : k === 'move' ? <ActionBtn key={k} icon={FaExchangeAlt} onClick={() => act(k)} title="Move to another of your pockets">Move</ActionBtn>
                                    : k === 'receive' ? <ActionBtn key={k} icon={FaQrcode} onClick={() => act(k)}>Receive</ActionBtn>
                                        : k === 'withdraw' ? <ActionBtn key={k} icon={FaArrowUp} onClick={() => act(k)} title="Move to your wallet">Withdraw</ActionBtn>
                                            : <ActionBtn key={k} icon={FaPlus} onClick={() => act(k)}>Top up</ActionBtn>
                        ))}
                    </div>
                )}
            </div>
            {receiving && <div style={{ marginTop: 10 }}><ReceivePanel pocket={p} ledger={ledger} /></div>}
        </div>
    );
}

/// The pockets holding this token besides Main and the Sneed Lock wallet (which the card shows already).
export default function PocketRows({ token, onAction, hideButtons, includeBase = false }) {
    const pk = usePockets();
    const ledger = ledgerOf(token);
    if (!ledger) return null;
    const rows = sortPockets(holders(pk.pockets, ledger).concat(pk.pockets.filter((p) => p.status === 'error' && p.ledgers.includes(ledger))))
        .filter((p, i, a) => a.findIndex((q) => q.id === p.id) === i)
        .filter((p) => includeBase || (p.id !== MAIN_ID && p.id !== LOCK_POCKET_ID));
    if (!rows.length) return null;
    return <div>{rows.map((p) => <PocketRow key={p.id} pocket={p} token={token} onAction={onAction} hideButtons={hideButtons} />)}</div>;
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
        <div style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: '4px 14px 10px', minWidth: 0 }}>
            <div style={{ padding: '10px 0 6px', fontSize: '0.85rem', color: c.secondaryText }}>
                <strong style={{ color: c.primaryText }}>{displayName(pocket)}</strong> · {badge(pocket)}
                {pocket.status === 'error' && <span style={{ color: c.warning }}> · couldn't read {pocket.host}</span>}
            </div>
            {!shown.length && <div style={{ padding: '10px 0', fontSize: '0.85rem', color: c.mutedText }}>This pocket holds none of your wallet's tokens yet.</div>}
            {shown.map((t) => (
                <div key={ledgerOf(t)} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {t.logo ? <img src={t.logo} alt="" style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0 }} /> : <span style={{ width: 22, flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}><PocketRow pocket={pocket} title={t.symbol} token={t} onAction={onAction} /></div>
                </div>
            ))}
        </div>
    );
}
