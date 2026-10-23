// /donate: the thank-you wall. Every donation made through the donate dialog, verified by the
// backend against the ledger, newest first, with the donor's Sneed name and avatar when they have
// them. Donations are public: every donor shows by principal.
import React, { useCallback, useEffect, useState } from 'react';
import { FaHeart, FaSpinner } from 'react-icons/fa';
import Header from '../components/Header';
import { DonateDialog, ROSE, ROSE_2, formatUnits } from '../components/DonateButton';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { useDenomination } from '../contexts/DenominationContext';
import { useNaming, useAvatar } from '../NamingContext';
import { useStoreVersion } from '../utils/revenueStore';
import { loadTokenMeta, tokenMeta, loadPrice, priceOf } from '../utils/revenueData';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import BigAvatar from '../components/BigAvatar';
import { getDonations, getDonationTotals } from '../utils/donations';

const PAGE = 48;
const dateOf = (ns) => new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const usdOfAmount = (ledger, amount) => { const m = tokenMeta(ledger); const p = priceOf(ledger); return m && p != null ? (Number(amount) / 10 ** m.decimals) * p : null; };

function DonorCard({ d, theme, isAuthenticated }) {
    const naming = useNaming();
    const avatar = useAvatar(d.donor);
    const { formatValue } = useDenomination();
    const ledger = d.ledger.toText();
    const meta = tokenMeta(ledger);
    const usd = usdOfAmount(ledger, d.amount);
    const info = getPrincipalDisplayInfoFromContext(d.donor, naming.principalNames, naming.principalNicknames, naming.verifiedNames, naming.principalCanisterTypes);
    const c = theme.colors;
    return (
        <article style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <BigAvatar principal={d.donor} url={avatar} size={52} name={info.name || d.donor.toText()} verified={Boolean(info.name && info.isVerified)} />
                <div style={{ minWidth: 0, flex: 1 }}>
                    <PrincipalDisplay principal={d.donor} displayInfo={info} short hideIcon showCopyButton={false} isAuthenticated={isAuthenticated} style={{ fontWeight: 600 }} />
                    <div style={{ fontSize: 12, color: c.mutedText, marginTop: 2 }}>{dateOf(d.created_at || d.registered_at)}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 800, color: ROSE, fontVariantNumeric: 'tabular-nums' }}>{meta ? `${formatUnits(d.amount, meta.decimals, 2)} ${meta.symbol}` : '…'}</div>
                    {usd != null && usd > 0 && <div style={{ fontSize: 12, color: c.mutedText }}>{formatValue(usd)}</div>}
                </div>
            </div>
            {d.message[0] && <p style={{ margin: 0, color: c.secondaryText, fontSize: 14, lineHeight: 1.55, fontStyle: 'italic', wordBreak: 'break-word', borderLeft: `3px solid ${ROSE}55`, paddingLeft: 10 }}>“{d.message[0]}”</p>}
        </article>
    );
}

export default function Donate() {
    useStoreVersion();
    const { theme } = useTheme();
    const { isAuthenticated } = useAuth();
    const { formatValue } = useDenomination();
    const [donations, setDonations] = useState(null);
    const [total, setTotal] = useState(0);
    const [totals, setTotals] = useState(null);
    const [error, setError] = useState('');
    const [loadingMore, setLoadingMore] = useState(false);
    const [open, setOpen] = useState(false);

    const load = useCallback(async () => {
        try {
            const [page, t] = await Promise.all([getDonations(0, PAGE), getDonationTotals()]);
            setDonations(page.donations); setTotal(page.total); setTotals(t); setError('');
        } catch (e) { setError(e.message); }
    }, []);
    useEffect(() => { load(); }, [load]);
    // reload when the dialog closes, so a new donation shows at once
    const close = useCallback(() => { setOpen(false); load(); }, [load]);
    useEffect(() => {
        const ledgers = new Set([...(totals || []).map((t) => t.ledger), ...(donations || []).map((d) => d.ledger.toText())]);
        for (const l of ledgers) { loadTokenMeta(l).catch(() => {}); loadPrice(l).catch(() => {}); }
    }, [totals, donations]);
    const more = async () => {
        setLoadingMore(true);
        try { const page = await getDonations(donations.length, PAGE); setDonations([...donations, ...page.donations]); setTotal(page.total); }
        catch (e) { setError(e.message); } finally { setLoadingMore(false); }
    };

    const c = theme.colors;
    const gifts = (totals || []).reduce((a, t) => a + t.count, 0);
    const donors = donations ? new Set(donations.map((d) => d.donor.toText())).size : 0;
    const values = (totals || []).map((t) => usdOfAmount(t.ledger, t.amount));
    const valueKnown = values.length > 0 && values.every((v) => v != null);
    const value = values.reduce((a, v) => a + (v || 0), 0);
    const stat = (k, v) => (
        <div style={{ textAlign: 'center', minWidth: 0 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: c.primaryText, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
            <div style={{ fontSize: 11, color: c.mutedText, textTransform: 'uppercase', letterSpacing: .6 }}>{k}</div>
        </div>
    );

    return (
        <>
            <Header />
            <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1.5rem 16px 3rem' }}>
                <section style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, padding: '32px 22px', textAlign: 'center', border: `1px solid ${c.border}`, background: `radial-gradient(120% 120% at 50% 0%, ${ROSE}22 0%, transparent 60%), ${c.cardBg}`, marginBottom: 18 }}>
                    <div style={{ width: 60, height: 60, margin: '0 auto 14px', borderRadius: 18, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${ROSE}, ${ROSE_2})`, boxShadow: '0 14px 34px -12px rgba(244,63,94,.9)' }}><FaHeart size={26} color="#fff" /></div>
                    <h1 style={{ margin: 0, fontSize: '2rem', color: c.primaryText }}>Thank you</h1>
                    <p style={{ margin: '10px auto 20px', maxWidth: 560, color: c.secondaryText, lineHeight: 1.6 }}>
                        Sneed Hub has been built and run for free for over two years. These are the people who chipped in to keep it going. Every gift here was checked against the ledger.
                    </p>
                    <button type="button" onClick={() => setOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px', borderRadius: 999, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 15, color: '#fff', background: `linear-gradient(135deg, ${ROSE}, ${ROSE_2})`, boxShadow: '0 10px 28px -10px rgba(244,63,94,.9)' }}><FaHeart /> Donate</button>
                    {totals && gifts > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 12, maxWidth: 520, margin: '26px auto 0' }}>
                            {stat('Donors', donors.toLocaleString() + (donations.length < total ? '+' : ''))}
                            {stat('Gifts', gifts.toLocaleString())}
                            {valueKnown && stat('Given', formatValue(value))}
                        </div>
                    )}
                    {totals && totals.length > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                            {totals.map((t) => { const m = tokenMeta(t.ledger); return m ? <span key={t.ledger} style={{ fontSize: 12, color: c.secondaryText, background: c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 999, padding: '4px 10px' }}>{formatUnits(t.amount, m.decimals, 2)} {m.symbol}</span> : null; })}
                        </div>
                    )}
                </section>

                {error && <div style={{ color: c.error, marginBottom: 12 }}>Could not read the wall: {error}</div>}
                {!donations && !error && <div style={{ textAlign: 'center', color: c.mutedText, padding: 30 }}><FaSpinner style={{ animation: 'donate-spin 1s linear infinite' }} /> Reading the wall…</div>}
                {donations && donations.length === 0 && (
                    <div style={{ textAlign: 'center', color: c.secondaryText, padding: '30px 16px', border: `1px dashed ${c.border}`, borderRadius: 16 }}>No donations yet. Yours could be the first one here.</div>
                )}
                {donations && donations.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 12 }}>
                        {donations.map((d) => <DonorCard key={String(d.id)} d={d} theme={theme} isAuthenticated={isAuthenticated} />)}
                    </div>
                )}
                {donations && donations.length < total && (
                    <div style={{ textAlign: 'center', marginTop: 16 }}>
                        <button type="button" onClick={more} disabled={loadingMore} style={{ padding: '9px 18px', borderRadius: 999, border: `1px solid ${c.border}`, background: 'transparent', color: c.secondaryText, cursor: 'pointer' }}>{loadingMore ? 'Loading…' : 'Show more'}</button>
                    </div>
                )}
                <p style={{ textAlign: 'center', fontSize: 12, color: c.mutedText, marginTop: 22, lineHeight: 1.6 }}>Donations are public: each one is a transfer on the ledger, and this wall shows the donor's principal, with their Sneed name and avatar if they have them.</p>
            </div>
            {open && <DonateDialog onClose={close} />}
        </>
    );
}
