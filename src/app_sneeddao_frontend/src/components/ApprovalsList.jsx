// ICRC-2 approvals UI: the list with Revoke / Change (ApprovalsList), the collapsible row in a token
// card (TokenApprovalsRow) and the header count (TokenApprovalsBadge). Data from hooks/useApprovals.
// Reusable for any (ledger, account): pass `approvals` from useApprovals / useApprovalsMany.
import React, { useState } from 'react';
import { Principal } from '@dfinity/principal';
import { FaHandshake, FaExclamationTriangle, FaChevronDown, FaChevronRight, FaSync } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { useDenomination } from '../contexts/DenominationContext';
import ConfirmationModal from '../ConfirmationModal';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { formatAmount, formatAmountRaw, parseAmountToBigInt } from '../utils/StringUtils';
import { normalizeId } from '../utils/IdUtils';
import { approvalRisk, setApproval, subaccountHex, accountKey } from '../utils/approvals';
import { knownSpenderName } from '../utils/approvalSpenders';
import { useApprovals, loadApprovals, approvalsAgent } from '../hooks/useApprovals';

const NS_PER_MS = 1_000_000n;
const EXPIRY_CHOICES = [
    { id: 'keep', label: 'Keep current expiry' },
    { id: '1h', label: 'In 1 hour', ms: 3600_000 },
    { id: '1d', label: 'In 1 day', ms: 86400_000 },
    { id: '7d', label: 'In 7 days', ms: 7 * 86400_000 },
    { id: '30d', label: 'In 30 days', ms: 30 * 86400_000 },
    { id: 'custom', label: 'Pick a date…' },
    { id: 'never', label: 'Never (not recommended)' },
];

const num = (v, d = 8) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const fmtDate = (ns) => new Date(Number(BigInt(ns) / NS_PER_MS)).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const short = (t) => (t && t.length > 14 ? `${t.slice(0, 6)}…${t.slice(-5)}` : t);

/// "Main account" or "Subaccount 0a1b…".
export const fromAccountLabel = (from) => {
    const hex = subaccountHex(from?.subaccount);
    return hex ? `Subaccount ${short(hex.replace(/^0+/, '') || '0')}` : 'Main account';
};

function Badge({ color, children, title }) {
    return (
        <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', fontWeight: 600, padding: '1px 6px', borderRadius: 6, color, background: `${color}1a`, border: `1px solid ${color}40`, whiteSpace: 'nowrap' }}>
            {children}
        </span>
    );
}

function ApprovalRow({ a, token, showToken, onChanged }) {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const { formatValue } = useDenomination();
    const c = theme.colors;
    const decimals = num(token?.decimals, 8);
    const symbol = token?.symbol || 'tokens';
    const fee = token?.fee != null ? BigInt(token.fee) : null;
    const balance = token ? (token.available ?? token.balance ?? null) : null;
    const risk = approvalRisk(a, { decimals, balance: balance != null ? BigInt(balance) : null });
    const spenderText = a.spender ? a.spender.owner.toText() : null;
    const known = spenderText ? knownSpenderName(spenderText, a.ledgerId) : null;
    const spenderSubHex = a.spender ? subaccountHex(a.spender.subaccount) : null;
    const usd = !risk.unlimited && token?.conversion_rate ? (Number(a.allowance) / 10 ** decimals) * token.conversion_rate : null;
    const mine = isAuthenticated && identity && a.from.owner.toText() === identity.getPrincipal().toText();

    const [editing, setEditing] = useState(false);
    const [amountText, setAmountText] = useState('');
    const [expiryChoice, setExpiryChoice] = useState('keep');
    const [customExpiry, setCustomExpiry] = useState('');
    const [confirm, setConfirm] = useState(null); // { kind: 'revoke'|'change', amount, expiresAt }
    const [status, setStatus] = useState(null); // { ok, text }

    const feeText = fee != null ? `${formatAmount(fee, decimals)} ${symbol}` : 'the ledger fee';

    const reviewChange = () => {
        setStatus(null);
        const t = amountText.trim().replace(/,/g, '');
        if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') { setStatus({ ok: false, text: 'Enter an amount (0 revokes).' }); return; }
        const amount = parseAmountToBigInt(t, decimals);
        let expiresAt = a.expiresAt;
        if (expiryChoice === 'never') expiresAt = null;
        else if (expiryChoice === 'custom') {
            const ms = Date.parse(customExpiry);
            if (!Number.isFinite(ms) || ms <= Date.now() + 60_000) { setStatus({ ok: false, text: 'Pick an expiry at least a minute from now.' }); return; }
            expiresAt = BigInt(ms) * NS_PER_MS;
        } else {
            const choice = EXPIRY_CHOICES.find((x) => x.id === expiryChoice);
            if (choice?.ms) expiresAt = BigInt(Date.now() + choice.ms) * NS_PER_MS;
        }
        setConfirm({ kind: amount === 0n ? 'revoke' : 'change', amount, expiresAt });
    };

    const submit = async () => {
        const { amount, expiresAt } = confirm;
        try {
            await setApproval({
                agent: approvalsAgent(identity), ledgerId: a.ledgerId, fromSubaccount: a.from.subaccount,
                spender: a.spender, amount, expectedAllowance: a.allowance, expiresAt,
            });
            setStatus({ ok: true, text: amount === 0n ? 'Revoked.' : 'Approval changed.' });
            setEditing(false);
        } catch (e) {
            setStatus({ ok: false, text: e?.message || String(e) });
        }
        await loadApprovals({ ledgerId: a.ledgerId, owner: a.from.owner.toText(), subaccount: a.from.subaccount, force: true });
        onChanged?.();
    };

    const btn = (primary) => ({
        background: primary ? `${c.error}18` : c.secondaryBg, color: primary ? c.error : c.primaryText,
        border: `1px solid ${primary ? `${c.error}55` : c.border}`, borderRadius: 8, padding: '0.35rem 0.7rem',
        cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
    });
    const input = { background: c.primaryBg, color: c.primaryText, border: `1px solid ${c.border}`, borderRadius: 8, padding: '0.4rem 0.5rem', fontSize: '0.85rem', minWidth: 0 };

    const amountLabel = risk.unlimited ? 'Unlimited' : `${formatAmount(a.allowance, decimals)} ${symbol}`;
    const amountWords = risk.unlimited ? 'any amount' : amountLabel;
    const confirmMessage = confirm && (
        confirm.kind === 'revoke'
            ? `Revoke ${known || short(spenderText)}'s approval to spend ${risk.unlimited ? 'any amount' : `up to ${amountLabel}`}? The ledger charges ${feeText} for this.`
            : `Let ${known || short(spenderText)} spend up to ${formatAmount(confirm.amount, decimals)} ${symbol}${confirm.expiresAt ? ` until ${fmtDate(confirm.expiresAt)}` : ' with no expiry'}? This replaces the current approval (${amountWords}). The ledger charges ${feeText}.`
    );

    return (
        <div style={{ border: `1px solid ${risk.level === 'warn' ? `${c.warning}55` : c.border}`, borderRadius: 10, padding: '0.6rem 0.75rem', background: c.secondaryBg, display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem 0.75rem', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0, flexWrap: 'wrap' }}>
                    {showToken && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600, color: c.primaryText, fontSize: '0.85rem' }}>
                            {token?.logo && <img src={token.logo} alt="" style={{ width: 16, height: 16, borderRadius: '50%' }} />}
                            {symbol}
                            <span style={{ color: c.mutedText, fontWeight: 400 }}>→</span>
                        </span>
                    )}
                    {spenderText ? (
                        <>
                            {known && <span style={{ fontWeight: 600, color: c.primaryText, fontSize: '0.85rem' }}>{known}</span>}
                            <PrincipalDisplay principal={Principal.fromText(spenderText)} short isAuthenticated={isAuthenticated} showSendMessage={false} style={{ fontSize: '0.8rem' }} />
                            {spenderSubHex && <span title={spenderSubHex} style={{ fontSize: '0.75rem', color: c.mutedText }}>sub {short(spenderSubHex)}</span>}
                        </>
                    ) : (
                        <span title={a.spenderAccountId} style={{ fontSize: '0.8rem', color: c.secondaryText }}>
                            Unknown spender · account id {short(a.spenderAccountId)}
                        </span>
                    )}
                </div>
                <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
                    <div style={{ fontWeight: 600, color: risk.unlimited ? c.warning : c.primaryText, fontSize: '0.9rem' }}>{amountLabel}</div>
                    {usd != null && usd > 0 && <div style={{ fontSize: '0.75rem', color: c.mutedText }}>≈ {formatValue(usd)}</div>}
                </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35rem 0.6rem', fontSize: '0.75rem', color: c.mutedText }}>
                <span>{a.expiresAt == null ? 'Never expires' : `Expires ${fmtDate(a.expiresAt)}`}</span>
                <span>· {fromAccountLabel(a.from)}</span>
                {risk.unlimited && <Badge color={c.warning} title="The spender can take everything you hold of this token, now and later."><FaExclamationTriangle size={9} /> unlimited</Badge>}
                {risk.noExpiry && <Badge color={c.warning} title="This approval stays until it is used up or revoked.">no expiry</Badge>}
                {risk.aboveBalance && <Badge color={c.mutedText} title="More than you hold right now.">above balance</Badge>}
                {!a.verified && <Badge color={c.mutedText} title="Estimated from the transaction history; the ledger can't be asked without the spender's principal.">estimated</Badge>}
            </div>
            {mine && a.spender && !editing && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button style={btn(true)} onClick={() => { setStatus(null); setConfirm({ kind: 'revoke', amount: 0n, expiresAt: null }); }}>Revoke</button>
                    <button style={btn(false)} onClick={() => { setStatus(null); setAmountText(risk.unlimited ? '' : formatAmountRaw(a.allowance, decimals)); setExpiryChoice(a.expiresAt == null ? '7d' : 'keep'); setEditing(true); }}>Change</button>
                </div>
            )}
            {editing && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', paddingTop: '0.25rem' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.75rem', color: c.secondaryText }}>
                        New allowance ({symbol}; 0 revokes)
                        <input style={input} inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.0" />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.75rem', color: c.secondaryText }}>
                        Expiry
                        <select style={input} value={expiryChoice} onChange={(e) => setExpiryChoice(e.target.value)}>
                            {EXPIRY_CHOICES.filter((x) => x.id !== 'keep' || a.expiresAt != null).map((x) => (
                                <option key={x.id} value={x.id} style={{ background: c.primaryBg, color: c.primaryText }}>{x.label}</option>
                            ))}
                        </select>
                    </label>
                    {expiryChoice === 'custom' && <input type="datetime-local" style={input} value={customExpiry} onChange={(e) => setCustomExpiry(e.target.value)} />}
                    <div style={{ fontSize: '0.72rem', color: c.mutedText }}>Changing it costs {feeText}. The change only goes through if the allowance is still what is shown here.</div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button style={{ ...btn(false), background: `${c.accent}22`, color: c.accent, border: `1px solid ${c.accent}55` }} onClick={reviewChange}>Review</button>
                        <button style={btn(false)} onClick={() => { setEditing(false); setStatus(null); }}>Cancel</button>
                    </div>
                </div>
            )}
            {status && <div style={{ fontSize: '0.78rem', color: status.ok ? c.success : c.error }}>{status.text}</div>}
            <ConfirmationModal show={!!confirm} onClose={() => setConfirm(null)} onSubmit={submit} message={confirmMessage} doAwait />
        </div>
    );
}

/**
 * The approvals list. `tokens`: ledger id → { symbol, decimals, fee, conversion_rate, logo, available }
 * (a wallet token object works). `showToken`: name the token on each row (lists across tokens).
 */
export default function ApprovalsList({ approvals, tokens = {}, showToken = false, emptyText = 'No approvals found.', onChanged }) {
    const { theme } = useTheme();
    if (!approvals?.length) return <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText, padding: '0.5rem 0' }}>{emptyText}</div>;
    // riskiest first, then largest
    const sorted = [...approvals].sort((x, y) => {
        const rx = approvalRisk(x, { decimals: num(tokens[x.ledgerId]?.decimals) }).level === 'warn' ? 1 : 0;
        const ry = approvalRisk(y, { decimals: num(tokens[y.ledgerId]?.decimals) }).level === 'warn' ? 1 : 0;
        return ry - rx || (y.allowance > x.allowance ? 1 : y.allowance < x.allowance ? -1 : 0);
    });
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {sorted.map((a) => (
                <ApprovalRow key={`${a.ledgerId}|${accountKey(a.from.owner, a.from.subaccount)}|${a.spender ? accountKey(a.spender.owner, a.spender.subaccount) : a.spenderAccountId}`}
                    a={a} token={tokens[a.ledgerId]} showToken={showToken} onChanged={onChanged} />
            ))}
        </div>
    );
}

const tokenLedgerId = (token) => normalizeId(token?.ledger_canister_id);

/// The header count in a token card: shows only what is already known (no calls).
export function TokenApprovalsBadge({ ledgerId, decimals = 8, subaccount = null }) {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const owner = identity ? identity.getPrincipal().toText() : null;
    const { approvals } = useApprovals({ ledgerId: normalizeId(ledgerId), owner, subaccount, auto: false });
    if (!approvals.length) return null;
    const warn = approvals.some((a) => approvalRisk(a, { decimals: num(decimals) }).level === 'warn');
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', cursor: 'help', color: warn ? theme.colors.warning : theme.colors.mutedText }}
            title={`${approvals.length} approval${approvals.length > 1 ? 's' : ''}: others may spend this token from your account`}>
            <FaHandshake size={12} />
            <span style={{ fontSize: '10px', fontWeight: '600' }}>{approvals.length}</span>
        </span>
    );
}

/// "2 approvals ▸" in a token card, expanding to the list. Renders nothing when there are none.
export function TokenApprovalsRow({ token, subaccount = null }) {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const [open, setOpen] = useState(false);
    const ledgerId = tokenLedgerId(token);
    const owner = identity ? identity.getPrincipal().toText() : null;
    const { approvals, loading, refresh } = useApprovals({ ledgerId, owner, subaccount });
    if (!approvals.length) return null;
    const c = theme.colors;
    const warn = approvals.some((a) => approvalRisk(a, { decimals: num(token?.decimals) }).level === 'warn');
    return (
        <div style={{ marginTop: '0.5rem', borderTop: `1px solid ${c.border}`, paddingTop: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, color: warn ? c.warning : c.secondaryText, fontSize: '0.85rem', fontWeight: 600 }}>
                    <FaHandshake size={13} />
                    {approvals.length} approval{approvals.length > 1 ? 's' : ''}
                    {open ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
                </button>
                {open && (
                    <button onClick={(e) => { e.stopPropagation(); refresh(); }} title="Check again" disabled={loading}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.mutedText, padding: 2 }}>
                        <FaSync size={11} style={{ animation: loading ? 'walletSpin 1s linear infinite' : 'none' }} />
                    </button>
                )}
            </div>
            {open && (
                <div style={{ marginTop: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
                    <ApprovalsList approvals={approvals} tokens={{ [ledgerId]: token }} />
                </div>
            )}
        </div>
    );
}
