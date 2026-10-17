// /admin/donations: where donations go (the donation account, kept in the backend) and the
// thank-you wall's moderation (hide an entry, e.g. for its message; it still counts in the totals).
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { FaHeart, FaEye, FaEyeSlash, FaSpinner } from 'react-icons/fa';
import Header from '../../components/Header';
import PrincipalInput from '../../components/PrincipalInput';
import ConfirmationModal from '../../ConfirmationModal';
import { useAuth } from '../../AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { useStoreVersion } from '../../utils/revenueStore';
import { loadTokenMeta, tokenMeta } from '../../utils/revenueData';
import { PrincipalDisplay } from '../../utils/PrincipalUtils';
import { ROSE, formatUnits } from '../../components/DonateButton';
import { getDonationAccount, adminSetDonationAccount, adminGetDonations, adminSetDonationHidden } from '../../utils/donations';

const hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export default function AdminDonations() {
    useStoreVersion();
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const { isAdmin, loading: adminLoading } = useAdminCheck({ identity, isAuthenticated, redirectPath: '/admin' });
    const [account, setAccount] = useState(undefined);
    const [owner, setOwner] = useState('');
    const [subHex, setSubHex] = useState('');
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState(null); // { ok, text }
    const [confirm, setConfirm] = useState(null); // { title, message, run }
    const [list, setList] = useState(null);
    const [busyId, setBusyId] = useState(null);

    const load = useCallback(async () => {
        const [a, page] = await Promise.all([getDonationAccount(), adminGetDonations(identity, 0, 100)]);
        setAccount(a); setList(page);
        if (a) { setOwner(a.owner.toText()); setSubHex(a.subaccount ? hexOf(a.subaccount) : ''); }
        for (const d of page.donations) loadTokenMeta(d.ledger.toText()).catch(() => {});
    }, [identity]);
    useEffect(() => { if (isAdmin) load().catch((e) => setNotice({ ok: false, text: e.message })); }, [isAdmin, load]);

    // parse the form: { account } or { error }
    const parsed = (() => {
        let p;
        try { p = Principal.fromText(owner.trim()); } catch { return { error: 'Enter a valid principal' }; }
        if (p.isAnonymous()) return { error: 'The anonymous principal cannot receive donations' };
        const h = subHex.trim().toLowerCase();
        if (h && !/^[0-9a-f]{64}$/.test(h)) return { error: 'A subaccount is 64 hex characters (32 bytes), or leave it empty' };
        return { account: { owner: p, subaccount: h ? Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16))) : null } };
    })();
    const save = (acct) => setConfirm({
        title: acct ? 'Set the donation account' : 'Stop donations',
        message: acct
            ? `Donations will go to ${acct.owner.toText()}${acct.subaccount ? ` (subaccount ${hexOf(acct.subaccount)})` : ''}. Check it carefully: funds sent to a wrong account cannot be recovered.`
            : 'The donate dialog will say donations are not open. The wall stays as it is.',
        run: async () => {
            setSaving(true); setNotice(null);
            try { await adminSetDonationAccount(identity, acct); await load(); setNotice({ ok: true, text: acct ? 'Donation account saved.' : 'Donations stopped.' }); }
            catch (e) { setNotice({ ok: false, text: e.message }); } finally { setSaving(false); }
        },
    });
    const toggle = async (d) => {
        setBusyId(d.id);
        try { await adminSetDonationHidden(identity, d.id, !d.hidden); await load(); }
        catch (e) { setNotice({ ok: false, text: e.message }); } finally { setBusyId(null); }
    };

    const c = theme.colors;
    const card = { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '1rem', marginBottom: 16 };
    const btn = (primary, disabled) => ({ padding: '9px 16px', borderRadius: 10, border: primary ? 'none' : `1px solid ${c.border}`, background: primary ? (disabled ? c.border : ROSE) : 'transparent', color: primary ? '#fff' : c.secondaryText, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer' });
    if (adminLoading || (isAdmin && account === undefined && !notice)) return <><Header /><div style={{ padding: 40, textAlign: 'center', color: c.mutedText }}><FaSpinner /> Loading…</div></>;
    if (!isAdmin) return <><Header /><div style={{ padding: 40, textAlign: 'center', color: c.mutedText }}>Admins only.</div></>;

    return (
        <>
            <Header />
            <div style={{ maxWidth: 900, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <h1 style={{ margin: '0 0 4px', color: c.primaryText, display: 'flex', alignItems: 'center', gap: 10 }}><FaHeart color={ROSE} /> Donations</h1>
                <p style={{ margin: '0 0 16px', color: c.secondaryText }}>Where donations go, and the <Link to="/donate" style={{ color: c.accent }}>thank-you wall</Link>.</p>
                {notice && <div style={{ ...card, borderColor: notice.ok ? c.success : c.error, color: c.primaryText }}>{notice.text}</div>}

                <section style={card}>
                    <h2 style={{ margin: '0 0 6px', fontSize: '1.1rem', color: c.primaryText }}>Donation account</h2>
                    <div style={{ fontSize: 13, color: c.secondaryText, marginBottom: 12 }}>
                        {account ? <>Now: <PrincipalDisplay principal={account.owner} short={false} isAuthenticated={isAuthenticated} />{account.subaccount && <> · subaccount <code>{hexOf(account.subaccount)}</code></>}</> : 'None set: the donate dialog says donations are not open.'}
                    </div>
                    <label style={{ display: 'block', fontSize: 12, color: c.mutedText, marginBottom: 4 }}>Principal</label>
                    <PrincipalInput value={owner} onChange={setOwner} isAuthenticated={isAuthenticated} defaultPrincipalType="users" />
                    <label style={{ display: 'block', fontSize: 12, color: c.mutedText, margin: '10px 0 4px' }}>Subaccount (optional, 64 hex characters)</label>
                    <input value={subHex} onChange={(e) => setSubHex(e.target.value)} placeholder="Leave empty for the main account" style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText, fontFamily: 'monospace' }} />
                    {owner && parsed.error && <div style={{ color: c.error, fontSize: 13, marginTop: 6 }}>{parsed.error}</div>}
                    <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                        <button type="button" disabled={saving || !!parsed.error} onClick={() => save(parsed.account)} style={btn(true, saving || !!parsed.error)}>{saving ? 'Saving…' : 'Save'}</button>
                        {account && <button type="button" disabled={saving} onClick={() => save(null)} style={btn(false, saving)}>Stop donations</button>}
                    </div>
                </section>

                <section style={card}>
                    <h2 style={{ margin: '0 0 6px', fontSize: '1.1rem', color: c.primaryText }}>Wall ({list ? list.total : '…'})</h2>
                    <p style={{ margin: '0 0 10px', fontSize: 13, color: c.mutedText }}>A hidden donation leaves the wall but still counts in the totals. Newest first, the latest 100.</p>
                    {list && list.donations.length === 0 && <div style={{ color: c.mutedText }}>No donations yet.</div>}
                    {list && list.donations.map((d) => {
                        const m = tokenMeta(d.ledger.toText());
                        return (
                            <div key={String(d.id)} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderTop: `1px solid ${c.border}`, opacity: d.hidden ? .55 : 1 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                        <PrincipalDisplay principal={d.donor} short isAuthenticated={isAuthenticated} />
                                        <b style={{ color: ROSE }}>{m ? `${formatUnits(d.amount, m.decimals, m.decimals)} ${m.symbol}` : '…'}</b>
                                        <span style={{ fontSize: 12, color: c.mutedText }}>#{String(d.id)} · block {String(d.block_index)}</span>
                                    </div>
                                    {d.message[0] && <div style={{ fontSize: 13, color: c.secondaryText, marginTop: 4, wordBreak: 'break-word' }}>“{d.message[0]}”</div>}
                                </div>
                                <button type="button" disabled={busyId === d.id} onClick={() => toggle(d)} title={d.hidden ? 'Show on the wall' : 'Hide from the wall'} style={{ ...btn(false, busyId === d.id), display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 12 }}>
                                    {d.hidden ? <><FaEye /> Show</> : <><FaEyeSlash /> Hide</>}
                                </button>
                            </div>
                        );
                    })}
                </section>
            </div>
            {confirm && (
                <ConfirmationModal show onClose={() => setConfirm(null)} onSubmit={confirm.run} doAwait message={`${confirm.title}. ${confirm.message}`} />
            )}
        </>
    );
}
