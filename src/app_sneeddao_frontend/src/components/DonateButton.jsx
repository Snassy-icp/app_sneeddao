// The heart in the header: opens a dialog to send a donation to the people who build Sneed Hub
// (utils/donations.js). Logged in, a donation goes from the wallet in two steps (choose, then
// confirm) and is put on the public thank-you wall (/donate). Logged out, the dialog shows the
// donation account to copy. Donations are public and on-chain; the dialog says so.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { FaHeart, FaTimes, FaCopy, FaCheck, FaSpinner, FaArrowLeft, FaArrowRight } from 'react-icons/fa';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useDenomination } from '../contexts/DenominationContext';
import { useNaming, useAvatar } from '../NamingContext';
import { useStoreVersion } from '../utils/revenueStore';
import { loadTokenMeta, tokenMeta, loadPrice, priceOf } from '../utils/revenueData';
import { PrincipalDisplay, AvatarImage, getPrincipalDisplayInfoFromContext, computeAccountId } from '../utils/PrincipalUtils';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import TokenSelector from './TokenSelector';
import { getDonationAccount, donate, registerDonation, pendingDonations, MAX_MESSAGE } from '../utils/donations';

export const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
export const ROSE = '#f43f5e';
export const ROSE_2 = '#ec4899';
const PRESETS_USD = [5, 20, 50, 100];
const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';

const STYLE = `
@keyframes donate-beat { 0%, 100% { transform: scale(1); } 15% { transform: scale(1.22); } 30% { transform: scale(1); } 45% { transform: scale(1.12); } }
@keyframes donate-rise { 0% { transform: translate(0, 0) scale(.6); opacity: 0; } 15% { opacity: 1; } 100% { transform: translate(var(--dx), -150px) scale(1.15); opacity: 0; } }
@keyframes donate-in { from { opacity: 0; transform: translateY(14px) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes donate-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes donate-spin { to { transform: rotate(360deg); } }
.donate-btn { position: relative; display: inline-flex; align-items: center; gap: 7px; padding: 6px 13px; border-radius: 999px; cursor: pointer; font-size: 13px; font-weight: 600; letter-spacing: .2px; transition: box-shadow .25s ease, transform .2s ease, background .25s ease; }
.donate-btn:hover { transform: translateY(-1px); box-shadow: 0 0 0 1px rgba(244,63,94,.55), 0 6px 22px -6px rgba(244,63,94,.65); }
.donate-btn:hover .donate-heart { animation: donate-beat 1.2s ease-in-out infinite; }
.donate-btn:focus-visible { outline: 2px solid ${ROSE}; outline-offset: 2px; }
@media (max-width: 720px) { .donate-btn .donate-label { display: none; } .donate-btn { padding: 7px 9px; } }
.donate-spin { animation: donate-spin 1s linear infinite; }
.donate-chip { transition: border-color .15s ease, background .15s ease, transform .15s ease; }
.donate-chip:hover { transform: translateY(-1px); }
`;

/// "1.5" in a token with `decimals` → 150000000n; null when it is not a positive amount.
export function parseUnits(text, decimals) {
    const t = String(text).trim().replace(/,/g, '');
    if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
    const [w, f = ''] = t.split('.');
    if (f.length > decimals) return null;
    const v = BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
    return v > 0n ? v : null;
}
export const formatUnits = (v, decimals, max = 4) => (Number(v) / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: max });
/// A round amount near `usd` in a token priced at `price` (USD), as text.
const roundAmount = (usd, price, decimals) => {
    const x = usd / price;
    const mag = 10 ** Math.floor(Math.log10(x));
    const r = Math.round(x / mag * 2) / 2 * mag; // 1, 1.5, 2, 2.5 ... times a power of ten
    return r.toFixed(Math.max(0, Math.min(decimals, -Math.floor(Math.log10(mag)) + 1))).replace(/\.?0+$/, '');
};

function CopyRow({ label, value, theme }) {
    const [copied, setCopied] = useState(false);
    const copy = () => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };
    return (
        <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: .6, marginBottom: 4 }}>{label}</div>
            <button type="button" onClick={copy} title="Copy" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: '9px 12px', color: theme.colors.primaryText, cursor: 'pointer', textAlign: 'left' }}>
                <code style={{ flex: 1, minWidth: 0, fontSize: 12, wordBreak: 'break-all', lineHeight: 1.4 }}>{value}</code>
                {copied ? <FaCheck color={theme.colors.success} /> : <FaCopy color={theme.colors.mutedText} />}
            </button>
        </div>
    );
}

/// Hearts rising from the bottom of the dialog when a donation lands.
function Hearts() {
    const hearts = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ left: 8 + Math.random() * 84, dx: `${Math.round((Math.random() - 0.5) * 80)}px`, delay: i * 0.09 + Math.random() * 0.2, size: 12 + Math.random() * 14, color: i % 3 ? ROSE : ROSE_2 })), []);
    return (
        <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', borderRadius: 20 }}>
            {hearts.map((h, i) => <FaHeart key={i} size={h.size} style={{ position: 'absolute', bottom: 10, left: `${h.left}%`, color: h.color, opacity: 0, animation: `donate-rise 2.4s ease-out ${h.delay}s forwards`, '--dx': h.dx }} />)}
        </div>
    );
}

function Recipient({ account, theme }) {
    const naming = useNaming();
    const avatar = useAvatar(account.owner);
    const info = getPrincipalDisplayInfoFromContext(account.owner, naming.principalNames, naming.principalNicknames, naming.verifiedNames, naming.principalCanisterTypes);
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {avatar && <AvatarImage url={avatar} size={18} />}
            <PrincipalDisplay principal={account.owner} displayInfo={info} short showCopyButton={false} enableContextMenu={false} style={{ color: theme.colors.primaryText }} />
        </span>
    );
}

export function DonateDialog({ onClose }) {
    useStoreVersion();
    const { theme } = useTheme();
    const { identity, isAuthenticated, login } = useAuth();
    const { formatValue } = useDenomination();
    const me = identity && isAuthenticated ? identity.getPrincipal().toText() : null;
    const [account, setAccount] = useState(undefined); // undefined while loading, null when none is set
    const [loadError, setLoadError] = useState('');
    const [ledger, setLedger] = useState(ICP_LEDGER);
    const [amountText, setAmountText] = useState('');
    const [message, setMessage] = useState('');
    const [balance, setBalance] = useState(null);
    const [fee, setFee] = useState(null);
    const [step, setStep] = useState('form'); // form | confirm | sending | done | error
    const [phase, setPhase] = useState('');
    const [error, setError] = useState(null);
    const [pending, setPending] = useState([]);
    const [retrying, setRetrying] = useState(false);

    useEffect(() => { getDonationAccount().then(setAccount).catch((e) => { setLoadError(e.message); setAccount(null); }); }, []);
    useEffect(() => { if (me) setPending(pendingDonations(me)); }, [me, step]);
    useEffect(() => { loadTokenMeta(ledger).catch(() => {}); loadPrice(ledger).catch(() => {}); }, [ledger]);
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && step !== 'sending') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, step]);
    useEffect(() => {
        setBalance(null); setFee(null);
        if (!me) return;
        let live = true;
        const tok = createLedgerActor(ledger, { agentOptions: { host, identity } });
        Promise.all([tok.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] }), tok.icrc1_fee()])
            .then(([b, f]) => { if (live) { setBalance(b); setFee(f); } }).catch(() => {});
        return () => { live = false; };
    }, [ledger, me, identity, step]);

    const meta = tokenMeta(ledger);
    const price = priceOf(ledger);
    const amount = meta ? parseUnits(amountText, meta.decimals) : null;
    const usd = amount && price && meta ? (Number(amount) / 10 ** meta.decimals) * price : null;
    const tooMuch = amount != null && balance != null && fee != null && amount + fee > balance;
    const presets = meta && price ? PRESETS_USD.map((v) => ({ usd: v, text: roundAmount(v, price, meta.decimals) })) : [];

    const send = async () => {
        setStep('sending'); setPhase('Sending your donation…'); setError(null);
        try {
            const t = setTimeout(() => setPhase('Putting it on the thank-you wall…'), 2500);
            await donate(identity, { ledger, amount, to: account, message: message.trim() });
            clearTimeout(t);
            setStep('done');
        } catch (e) { setError(e); setStep('error'); }
    };
    const retry = async (p) => {
        setRetrying(true); setError(null);
        try { await registerDonation(identity, { ledger: p.ledger, block: p.block, message: p.message }); setStep('done'); }
        catch (e) { setError(e); setStep('error'); }
        finally { setRetrying(false); setPending(pendingDonations(me)); }
    };

    const c = theme.colors;
    const label = { fontSize: 11, color: c.mutedText, textTransform: 'uppercase', letterSpacing: .6, marginBottom: 6, display: 'block' };
    const primaryBtn = (disabled) => ({ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', borderRadius: 12, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 15, color: '#fff', background: disabled ? c.border : `linear-gradient(135deg, ${ROSE}, ${ROSE_2})`, boxShadow: disabled ? 'none' : '0 8px 24px -10px rgba(244,63,94,.8)', opacity: disabled ? .7 : 1 });
    const ghostBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', borderRadius: 12, border: `1px solid ${c.border}`, background: 'transparent', color: c.secondaryText, cursor: 'pointer', fontWeight: 600, fontSize: 14 };
    const row = (k, v) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: `1px solid ${c.border}`, fontSize: 14 }}><span style={{ color: c.mutedText }}>{k}</span><span style={{ textAlign: 'right', color: c.primaryText, minWidth: 0 }}>{v}</span></div>;
    const sym = meta?.symbol || '';

    let body;
    if (account === undefined) {
        body = <div style={{ padding: '30px 0', textAlign: 'center', color: c.mutedText }}><FaSpinner className="donate-spin" /> </div>;
    } else if (!account) {
        body = <p style={{ color: c.secondaryText, lineHeight: 1.6, margin: '8px 0 0' }}>{loadError ? `Could not reach Sneed Hub: ${loadError}` : 'Donations are not open yet. Thank you for thinking of it!'}</p>;
    } else if (step === 'done') {
        body = (
            <div style={{ textAlign: 'center', padding: '18px 0 6px', animation: 'donate-in .4s ease-out' }}>
                <div style={{ width: 64, height: 64, margin: '0 auto 14px', borderRadius: '50%', display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${ROSE}, ${ROSE_2})`, boxShadow: '0 10px 30px -8px rgba(244,63,94,.8)' }}><FaHeart size={28} color="#fff" style={{ animation: 'donate-beat 1.4s ease-in-out 2' }} /></div>
                <h3 style={{ margin: 0, fontSize: 22, color: c.primaryText }}>Thank you!</h3>
                <p style={{ color: c.secondaryText, lineHeight: 1.6, margin: '10px 0 18px' }}>Your donation arrived, and you are on the thank-you wall. It means a lot.</p>
                <div style={{ display: 'flex', gap: 10 }}>
                    <Link to="/donate" onClick={onClose} style={{ ...primaryBtn(false), textDecoration: 'none' }}>See the wall <FaArrowRight size={12} /></Link>
                    <button type="button" onClick={onClose} style={ghostBtn}>Close</button>
                </div>
            </div>
        );
    } else if (!me) {
        const icpAccount = computeAccountId(account.owner, account.subaccount);
        body = (
            <>
                <p style={{ color: c.secondaryText, lineHeight: 1.6, margin: '6px 0 14px', fontSize: 14 }}>Log in to donate from your Sneed wallet and be thanked by name on the wall. Or send ICP or any token to this account from another wallet:</p>
                <button type="button" onClick={login} style={{ ...primaryBtn(false), width: '100%' }}><FaHeart /> Log in to donate</button>
                <CopyRow label="Principal (any ICRC-1 token)" value={account.owner.toText()} theme={theme} />
                {account.subaccount && <CopyRow label="Subaccount" value={Array.from(account.subaccount, (b) => b.toString(16).padStart(2, '0')).join('')} theme={theme} />}
                <CopyRow label="ICP account ID (exchanges)" value={icpAccount} theme={theme} />
                <p style={{ fontSize: 12, color: c.mutedText, margin: '12px 0 0', lineHeight: 1.5 }}>Only donations made here while logged in go on the wall.</p>
            </>
        );
    } else if (step === 'confirm') {
        body = (
            <div style={{ animation: 'donate-in .25s ease-out' }}>
                <div style={{ textAlign: 'center', padding: '6px 0 14px' }}>
                    <div style={{ fontSize: 30, fontWeight: 800, color: c.primaryText, fontVariantNumeric: 'tabular-nums' }}>{formatUnits(amount, meta.decimals, meta.decimals)} {sym}</div>
                    {usd != null && <div style={{ color: c.mutedText, fontSize: 14 }}>≈ {formatValue(usd)}</div>}
                </div>
                {row('To', <Recipient account={account} theme={theme} />)}
                {row('Network fee', fee != null ? `${formatUnits(fee, meta.decimals, meta.decimals)} ${sym}` : '…')}
                {message.trim() && row('Your message', <span style={{ fontStyle: 'italic', wordBreak: 'break-word' }}>“{message.trim()}”</span>)}
                <p style={{ fontSize: 12, color: c.mutedText, lineHeight: 1.5, margin: '12px 0 16px' }}>Donations are public: the transfer is on-chain, and the thank-you wall shows your principal, with your Sneed name and avatar if you have them. Gifts can't be refunded.</p>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button type="button" onClick={() => setStep('form')} style={ghostBtn}><FaArrowLeft size={12} /> Back</button>
                    <button type="button" onClick={send} style={primaryBtn(false)}><FaHeart /> Send donation</button>
                </div>
            </div>
        );
    } else if (step === 'sending') {
        body = <div style={{ padding: '36px 0', textAlign: 'center', color: c.secondaryText }}><FaSpinner className="donate-spin" size={26} color={ROSE} /><div style={{ marginTop: 14 }}>{phase}</div><div style={{ marginTop: 6, fontSize: 12, color: c.mutedText }}>Please keep this window open.</div></div>;
    } else if (step === 'error') {
        body = (
            <div style={{ animation: 'donate-in .25s ease-out' }}>
                <div style={{ background: `${c.error}18`, border: `1px solid ${c.error}55`, borderRadius: 12, padding: 14, color: c.primaryText, lineHeight: 1.55, fontSize: 14 }}>{error?.message}</div>
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                    {error?.sent
                        ? <button type="button" disabled={retrying} onClick={() => retry(pendingDonations(me).find((p) => p.block === error.sent.block) || { ...error.sent, message: message.trim() })} style={primaryBtn(retrying)}>{retrying ? <FaSpinner className="donate-spin" /> : <FaHeart />} Put it on the wall</button>
                        : <button type="button" onClick={() => setStep('form')} style={primaryBtn(false)}><FaArrowLeft size={12} /> Back</button>}
                    <button type="button" onClick={onClose} style={ghostBtn}>Close</button>
                </div>
            </div>
        );
    } else {
        body = (
            <>
                {pending.length > 0 && (
                    <div style={{ background: `${ROSE}12`, border: `1px solid ${ROSE}44`, borderRadius: 12, padding: '10px 12px', marginBottom: 14, fontSize: 13, color: c.primaryText, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ flex: 1 }}>{pending.length === 1 ? 'A donation you sent is not on the wall yet.' : `${pending.length} donations you sent are not on the wall yet.`}</span>
                        <button type="button" disabled={retrying} onClick={() => retry(pending[0])} style={{ ...ghostBtn, padding: '6px 10px', fontSize: 12, borderColor: `${ROSE}66`, color: ROSE }}>{retrying ? <FaSpinner className="donate-spin" /> : 'Add it'}</button>
                    </div>
                )}
                <span style={label}>Token</span>
                <TokenSelector value={ledger} onChange={(id) => { setLedger(id); setAmountText(''); }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: c.mutedText, margin: '6px 2px 14px' }}>
                    <span>{balance != null && meta ? <>Balance: <b style={{ color: c.secondaryText }}>{formatUnits(balance, meta.decimals)} {sym}</b></> : ' '}</span>
                    {balance != null && fee != null && balance > fee && meta && <button type="button" onClick={() => setAmountText((Number(balance - fee) / 10 ** meta.decimals).toFixed(meta.decimals).replace(/\.?0+$/, ''))} style={{ background: 'none', border: 'none', color: c.accent, cursor: 'pointer', fontSize: 12, padding: 0 }}>Max</button>}
                </div>
                <span style={label}>Amount</span>
                {presets.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
                        {presets.map((p) => {
                            const on = amountText === p.text;
                            return (
                                <button key={p.usd} type="button" className="donate-chip" onClick={() => setAmountText(p.text)} style={{ padding: '9px 4px', borderRadius: 12, cursor: 'pointer', border: `1.5px solid ${on ? ROSE : c.border}`, background: on ? `${ROSE}14` : c.secondaryBg, color: c.primaryText, minWidth: 0 }}>
                                    <div style={{ fontWeight: 700, fontSize: 14 }}>{formatValue(p.usd)}</div>
                                    <div style={{ fontSize: 11, color: c.mutedText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.text} {sym}</div>
                                </button>
                            );
                        })}
                    </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', background: c.secondaryBg, border: `1.5px solid ${tooMuch ? c.error : amount ? ROSE : c.border}`, borderRadius: 12, padding: '0 12px', transition: 'border-color .15s' }}>
                    <input inputMode="decimal" placeholder="Other amount" value={amountText} onChange={(e) => setAmountText(e.target.value)} style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: c.primaryText, fontSize: 18, fontWeight: 600, padding: '11px 0' }} />
                    <span style={{ color: c.mutedText, fontWeight: 600 }}>{sym}</span>
                </div>
                <div style={{ fontSize: 12, margin: '6px 2px 14px', minHeight: 16, color: tooMuch ? c.error : c.mutedText }}>
                    {tooMuch ? 'More than your balance after the network fee' : usd != null ? `≈ ${formatValue(usd)}` : amountText && !amount ? 'Enter an amount like 1.5' : ' '}
                </div>
                <span style={label}>Message <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional, shown on the wall)</span></span>
                <textarea value={message} maxLength={MAX_MESSAGE} rows={2} placeholder="Say something nice…" onChange={(e) => setMessage(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', background: c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: '10px 12px', color: c.primaryText, fontSize: 14, fontFamily: 'inherit', outline: 'none' }} />
                <div style={{ textAlign: 'right', fontSize: 11, color: c.mutedText, marginTop: 2 }}>{message.length}/{MAX_MESSAGE}</div>
                <button type="button" disabled={!amount || tooMuch || fee == null} onClick={() => setStep('confirm')} style={{ ...primaryBtn(!amount || tooMuch || fee == null), width: '100%', marginTop: 10 }}>Continue <FaArrowRight size={12} /></button>
            </>
        );
    }

    return createPortal(
        <div role="dialog" aria-modal="true" aria-label="Donate to Sneed Hub" onMouseDown={(e) => { if (e.target === e.currentTarget && step !== 'sending') onClose(); }}
            style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(8, 8, 14, .62)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, animation: 'donate-fade .2s ease-out' }}>
            <style>{STYLE}</style>
            <div style={{ position: 'relative', width: '100%', maxWidth: 440, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', background: c.cardBg, color: c.primaryText, borderRadius: 20, border: `1px solid ${c.border}`, boxShadow: '0 30px 80px -20px rgba(0,0,0,.6)', animation: 'donate-in .3s ease-out' }}>
                {step === 'done' && <Hearts />}
                <div style={{ height: 4, borderRadius: '20px 20px 0 0', background: `linear-gradient(90deg, ${ROSE}, ${ROSE_2}, #f59e0b)` }} />
                <div style={{ padding: '20px 22px 22px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${ROSE}, ${ROSE_2})` }}><FaHeart color="#fff" size={18} /></div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <h2 style={{ margin: 0, fontSize: 19, color: c.primaryText }}>Support Sneed Hub</h2>
                            {step !== 'done' && <p style={{ margin: '4px 0 0', fontSize: 13, color: c.secondaryText, lineHeight: 1.5 }}>Built and run for free for over two years. If it's useful to you, a tip keeps it going.</p>}
                        </div>
                        <button type="button" onClick={onClose} disabled={step === 'sending'} aria-label="Close" style={{ background: 'none', border: 'none', color: c.mutedText, cursor: 'pointer', padding: 4 }}><FaTimes /></button>
                    </div>
                    <div style={{ marginTop: 16 }}>{body}</div>
                    {step !== 'done' && account && <div style={{ textAlign: 'center', marginTop: 16 }}><Link to="/donate" onClick={onClose} style={{ color: c.mutedText, fontSize: 12, textDecoration: 'none' }}>See the thank-you wall <FaArrowRight size={9} /></Link></div>}
                </div>
            </div>
        </div>,
        document.body,
    );
}

/// The header's heart: a pill with a label on wide screens, the heart alone on narrow ones.
export default function DonateButton() {
    const { theme } = useTheme();
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);
    return (
        <>
            <style>{STYLE}</style>
            <button type="button" className="donate-btn" onClick={() => setOpen(true)} title="Support Sneed Hub" aria-label="Donate"
                style={{ background: `linear-gradient(${theme.colors.primaryBg}, ${theme.colors.primaryBg}) padding-box, linear-gradient(135deg, ${ROSE}, ${ROSE_2}) border-box`, border: '1.5px solid transparent', color: theme.colors.primaryText }}>
                <FaHeart className="donate-heart" size={13} color={ROSE} />
                <span className="donate-label">Donate</span>
            </button>
            {open && <DonateDialog onClose={close} />}
        </>
    );
}
