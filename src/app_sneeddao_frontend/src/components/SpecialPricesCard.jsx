// "Admin & partner prices" card for a canister's admin page (spec/special_prices.md).
// Edits the admin price (applies to that canister's admins, people only) and the partner list
// (principal, public label, per-fee overrides, optional expiry). The canister charges the lowest
// applicable price among regular, premium, admin and partner; an empty override means "no special
// price for this fee". Every change is public (get_special_prices) and logged where the canister
// has an ICRC-3 log.
//
// Props:
//   actor   - the canister actor (needs get_special_prices, set_admin_prices, set_partner_prices, remove_partner_prices)
//   fields  - [{ key, label, decimals = 8, unit = 'ICP', regular?, premium?, hint? }]: one per override field;
//             `regular` / `premium` (bigint, in the field's base unit) are shown for reference
//   title   - optional heading
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Principal } from '@dfinity/principal';
import { FaTags, FaTrash, FaPlus, FaSpinner } from 'react-icons/fa';
import PrincipalInput from './PrincipalInput';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { fetchSpecialPrices, wrapPrices } from '../utils/specialPrices';

const toUnits = (v, decimals) => {
    if (v === null || v === undefined) return '';
    const b = BigInt(v);
    if (!decimals) return b.toString();
    const s = b.toString().padStart(decimals + 1, '0');
    const whole = s.slice(0, -decimals);
    const frac = s.slice(-decimals).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole;
};
const fromUnits = (text, decimals, label) => {
    const t = String(text ?? '').trim();
    if (t === '') return null;
    if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`${label}: a non-negative number`);
    const [w, f = ''] = t.split('.');
    if (f.length > decimals) throw new Error(`${label}: at most ${decimals} decimals`);
    return BigInt(w + f.padEnd(decimals, '0'));
};
const nsToLocal = (ns) => {
    if (ns === null || ns === undefined) return '';
    const d = new Date(Number(BigInt(ns) / 1_000_000n));
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const localToNs = (s) => (s ? BigInt(new Date(s).getTime()) * 1_000_000n : null);
const unwrapResult = (r) => {
    if (r && typeof r === 'object' && 'err' in r) throw new Error(typeof r.err === 'string' ? r.err : JSON.stringify(r.err));
    if (r && typeof r === 'object' && 'Err' in r) throw new Error(typeof r.Err === 'string' ? r.Err : JSON.stringify(r.Err));
    return r;
};

export default function SpecialPricesCard({ actor, fields, title = 'Admin & partner prices' }) {
    const { theme, isDark } = useTheme();
    const c = theme.colors;
    const { isAuthenticated } = useAuth();
    const [data, setData] = useState(null);
    const [unsupported, setUnsupported] = useState(false);
    const [adminDraft, setAdminDraft] = useState({});
    const [editing, setEditing] = useState(null); // { principal, label, prices: {key: text}, expires: text, isNew }
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState(null);

    // fields may be an inline array: read it through a ref so a new array per render does not reload
    const fieldsRef = useRef(fields);
    fieldsRef.current = fields;
    const load = useCallback(async () => {
        const r = await fetchSpecialPrices(actor);
        if (!r) { setUnsupported(true); return; }
        setUnsupported(false);
        setData(r);
        setAdminDraft(Object.fromEntries(fieldsRef.current.map((f) => [f.key, toUnits(r.admin[f.key], f.decimals ?? 8)])));
    }, [actor]);
    useEffect(() => { if (actor) load(); }, [actor, load]);

    const run = async (f, ok) => {
        setBusy(true); setNotice(null);
        try { unwrapResult(await f()); setNotice({ ok: true, text: ok }); await load(); return true; }
        catch (e) { setNotice({ ok: false, text: e.message || String(e) }); return false; }
        finally { setBusy(false); }
    };
    const pricesFrom = (draft) => Object.fromEntries(fields.map((f) => [f.key, fromUnits(draft[f.key], f.decimals ?? 8, f.label)]));

    const saveAdmin = () => run(() => actor.set_admin_prices(wrapPrices(pricesFrom(adminDraft))), 'Admin prices saved');
    const savePartner = async () => {
        let p;
        try { p = Principal.fromText(String(editing.principal).trim()); } catch { setNotice({ ok: false, text: 'Partner: not a principal' }); return; }
        let prices;
        try { prices = pricesFrom(editing.prices); } catch (e) { setNotice({ ok: false, text: e.message }); return; }
        const entry = { label: editing.label.trim(), prices: wrapPrices(prices), expires_at: editing.expires ? [localToNs(editing.expires)] : [] };
        if (await run(() => actor.set_partner_prices(p, entry), 'Partner saved')) setEditing(null);
    };
    const removePartner = (p) => {
        if (!window.confirm(`Remove the partner prices of ${p.toText()}?`)) return;
        run(() => actor.remove_partner_prices(p), 'Partner removed');
    };

    const card = { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '1rem', marginBottom: 16 };
    const muted = { color: c.mutedText, fontSize: 13 };
    const input = { padding: '7px 10px', borderRadius: 8, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText, fontSize: 13, boxSizing: 'border-box', width: '100%', colorScheme: isDark ? 'dark' : 'light' };
    const btn = (primary) => ({ padding: '7px 14px', borderRadius: 8, border: primary ? 'none' : `1px solid ${c.border}`, background: primary ? c.accent : 'transparent', color: primary ? '#fff' : c.primaryText, fontWeight: 600, fontSize: 13, cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 });
    const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))', gap: 8 };
    const ref = (f) => {
        const parts = [];
        if (f.regular !== undefined && f.regular !== null) parts.push(`regular ${toUnits(f.regular, f.decimals ?? 8)}`);
        if (f.premium !== undefined && f.premium !== null) parts.push(`premium ${toUnits(f.premium, f.decimals ?? 8)}`);
        return parts.length ? ` (${parts.join(', ')})` : '';
    };
    const fieldInputs = (draft, set) => (
        <div style={grid}>
            {fields.map((f) => (
                <label key={f.key} style={{ display: 'block', fontSize: 12, color: c.secondaryText }}>
                    {f.label} [{f.unit ?? 'ICP'}]{ref(f)}
                    <input style={{ ...input, marginTop: 4 }} value={draft[f.key] ?? ''} placeholder="not set" onChange={(e) => set({ ...draft, [f.key]: e.target.value })} />
                    {f.hint && <span style={{ ...muted, fontSize: 11 }}>{f.hint}</span>}
                </label>
            ))}
        </div>
    );
    const showPrices = (prices) => fields.filter((f) => prices[f.key] !== null && prices[f.key] !== undefined)
        .map((f) => `${f.label}: ${toUnits(prices[f.key], f.decimals ?? 8)} ${f.unit ?? 'ICP'}`).join(' · ') || 'no overrides';

    return (
        <div style={card} id="special-prices">
            <h2 style={{ margin: '0 0 8px', fontSize: '1.1rem', color: c.primaryText, display: 'flex', alignItems: 'center', gap: 8 }}><FaTags color={c.accent} /> {title}</h2>
            <p style={{ ...muted, margin: '0 0 10px' }}>
                Each purchase pays the lowest applicable price: regular, premium (members), admin (this canister's admins; people only, never canisters) or partner (that principal, until its expiry).
                Leave a field empty for no special price. Everything here is public and every change is logged.
            </p>
            {unsupported && <div style={{ ...muted, color: c.warning }}>This canister does not have special prices yet (needs the upgrade).</div>}
            {notice && <div style={{ fontSize: 13, margin: '6px 0', color: notice.ok ? c.success : (c.error || '#e74c3c') }}>{notice.text}</div>}
            {!unsupported && !data && <div style={muted}><FaSpinner className="spin" /> Loading…</div>}
            {data && (
                <>
                    <h3 style={{ fontSize: 14, margin: '8px 0 6px', color: c.primaryText }}>Admin prices</h3>
                    {fieldInputs(adminDraft, setAdminDraft)}
                    <div style={{ marginTop: 8 }}><button style={btn(true)} disabled={busy} onClick={saveAdmin}>Save admin prices</button></div>

                    <h3 style={{ fontSize: 14, margin: '16px 0 6px', color: c.primaryText }}>Partners ({data.partners.length})</h3>
                    {data.partners.length === 0 && <div style={muted}>No partners.</div>}
                    {data.partners.map((p) => {
                        const expired = p.expiresAt !== null && BigInt(p.expiresAt) <= BigInt(Date.now()) * 1_000_000n;
                        return (
                            <div key={p.principal.toText()} style={{ borderTop: `1px solid ${c.border}`, padding: '8px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                                <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                                    <div style={{ fontWeight: 600, color: c.primaryText }}>{p.label}{expired && <span style={{ ...muted, color: c.warning }}> (expired)</span>}</div>
                                    <div style={{ fontSize: 12 }}><PrincipalDisplay principal={p.principal} short={true} /></div>
                                    <div style={muted}>{showPrices(p.prices)}{p.expiresAt !== null && ` · until ${new Date(Number(BigInt(p.expiresAt) / 1_000_000n)).toLocaleString()}`}</div>
                                </div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button style={btn(false)} disabled={busy} onClick={() => setEditing({ principal: p.principal.toText(), label: p.label, prices: Object.fromEntries(fields.map((f) => [f.key, toUnits(p.prices[f.key], f.decimals ?? 8)])), expires: nsToLocal(p.expiresAt), isNew: false })}>Edit</button>
                                    <button style={btn(false)} disabled={busy} onClick={() => removePartner(p.principal)}><FaTrash /></button>
                                </div>
                            </div>
                        );
                    })}
                    {!editing && <div style={{ marginTop: 8 }}><button style={btn(false)} disabled={busy} onClick={() => setEditing({ principal: '', label: '', prices: {}, expires: '', isNew: true })}><FaPlus /> Add partner</button></div>}
                    {editing && (
                        <div style={{ marginTop: 10, padding: 10, border: `1px solid ${c.border}`, borderRadius: 10 }}>
                            <div style={{ fontSize: 12, color: c.secondaryText, marginBottom: 4 }}>Partner principal (usually the partner's canister)</div>
                            {editing.isNew
                                ? <PrincipalInput value={editing.principal} onChange={(v) => setEditing({ ...editing, principal: v })} isAuthenticated={isAuthenticated} />
                                : <div style={{ fontSize: 13 }}><code>{editing.principal}</code></div>}
                            <label style={{ display: 'block', fontSize: 12, color: c.secondaryText, margin: '8px 0' }}>
                                Label (public, e.g. "a partner game canister")
                                <input style={{ ...input, marginTop: 4 }} maxLength={100} value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
                            </label>
                            {fieldInputs(editing.prices, (prices) => setEditing({ ...editing, prices }))}
                            <label style={{ display: 'block', fontSize: 12, color: c.secondaryText, margin: '8px 0' }}>
                                Expires (empty: no expiry)
                                <input type="datetime-local" style={{ ...input, marginTop: 4 }} value={editing.expires} onChange={(e) => setEditing({ ...editing, expires: e.target.value })} />
                            </label>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button style={btn(true)} disabled={busy} onClick={savePartner}>Save partner</button>
                                <button style={btn(false)} disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
