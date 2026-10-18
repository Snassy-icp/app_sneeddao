// One name for all of a person's principals (spec/sneed_names.md §4): the principals in your
// account, the hotkeys you gave out, and the accounts others gave you a hotkey on, which you can
// rename or merge into yours. Shown on the Me page once the naming service is live.
import React, { useCallback, useEffect, useState } from 'react';
import { Principal } from '@dfinity/principal';
import { FaKey, FaUsers, FaCompressArrowsAlt, FaTimes, FaCheckCircle } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import PrincipalInput from './PrincipalInput';
import ConfirmationModal from '../ConfirmationModal';
import * as NS from '../utils/NamingService';

const opt = (x) => (x && x.length ? x[0] : null);

export default function AccountPanel({ identity, accent }) {
    const { theme } = useTheme();
    const { principalNames, principalNicknames, verifiedNames, principalCanisterTypes, fetchAllNames } = useNaming();
    const [account, setAccount] = useState(null);
    const [managed, setManaged] = useState([]);
    const [dapps, setDapps] = useState([]);
    const [hotkeyInput, setHotkeyInput] = useState('');
    const [renames, setRenames] = useState({});
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [confirm, setConfirm] = useState(null); // { message, run }
    const me = identity?.getPrincipal?.()?.toText?.();

    const reload = useCallback(async () => {
        if (!identity) return;
        try {
            const [a, m, d] = await Promise.all([NS.getMyAccount(identity), NS.myHotkeyAccounts(identity), NS.listDapps(identity).catch(() => [])]);
            setAccount(a); setManaged(m); setDapps(d);
        } catch (e) { setError(e?.message || String(e)); }
    }, [identity]);
    useEffect(() => { reload(); }, [reload]);

    const run = async (label, fn, done) => {
        setBusy(label); setError(''); setNotice('');
        try {
            const r = await fn();
            if (r && 'err' in r) setError(r.err);
            else { if (done) setNotice(done); await reload(); fetchAllNames?.(true); }
        } catch (e) { setError(e?.message || String(e)); }
        finally { setBusy(''); }
    };

    const isOwner = account?.members?.some((m) => m.principal.toText() === me && 'owner' in m.role);
    const dappName = (id) => dapps.find((d) => d.id === id)?.name;
    const show = (p) => (
        <PrincipalDisplay principal={p} displayInfo={getPrincipalDisplayInfoFromContext(p, principalNames, principalNicknames, verifiedNames, principalCanisterTypes)} short isAuthenticated showSendMessage={false} />
    );

    const card = { background: theme.colors.tertiaryBg, borderRadius: '12px', padding: '1rem', marginBottom: '1rem' };
    const row = { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', padding: '0.4rem 0', borderTop: `1px solid ${theme.colors.border}` };
    const small = { fontSize: '0.75rem', color: theme.colors.mutedText, lineHeight: 1.45, margin: '0.25rem 0 0.6rem' };
    const btn = (danger) => ({ background: 'transparent', border: `1px solid ${danger ? theme.colors.error : theme.colors.border}`, borderRadius: '8px', color: danger ? theme.colors.error : theme.colors.secondaryText, padding: '0.3rem 0.6rem', cursor: 'pointer', fontSize: '0.75rem' });
    const primaryBtn = { background: accent, border: 'none', borderRadius: '8px', color: 'white', padding: '0.45rem 0.8rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 };
    const select = { backgroundColor: theme.colors.secondaryBg, color: theme.colors.primaryText, border: `1px solid ${theme.colors.border}`, borderRadius: '8px', padding: '0.25rem 0.4rem', fontSize: '0.75rem' };

    return (
        <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: theme.colors.primaryText }}>
                <FaUsers color={accent} /> Your account
            </div>
            <p style={small}>
                Internet Identity gives you a different principal on every dapp. Put them in one account and they all show your name.
                Principals in your account are public: everyone can see they are the same person.
            </p>
            {error && <div style={{ color: theme.colors.error, fontSize: '0.8rem', marginBottom: '0.5rem' }}>{error}</div>}
            {notice && <div style={{ color: theme.colors.success, fontSize: '0.8rem', marginBottom: '0.5rem' }}>{notice}</div>}

            {account ? (
                <div>
                    <div style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, marginBottom: '0.25rem' }}>
                        Principals showing {opt(account.name) ? <b style={{ color: theme.colors.primaryText }}>{opt(account.name)}</b> : 'your account'}
                        {account.verified && <FaCheckCircle size={11} color={accent} style={{ marginLeft: 4 }} title="Verified name" />}
                    </div>
                    {account.members.map((m) => {
                        const p = m.principal.toText();
                        const dapp = opt(m.dapp);
                        const canEditLabel = isOwner || p === me;
                        return (
                            <div key={p} style={row}>
                                {show(m.principal)}
                                <span style={{ fontSize: '0.7rem', color: theme.colors.mutedText }}>{'owner' in m.role ? 'owner' : 'member'}{p === me ? ' · you' : ''}</span>
                                {dapps.length > 0 && canEditLabel ? (
                                    <select style={select} value={dapp == null ? '' : dapp.toString()} disabled={!!busy}
                                        onChange={(e) => run('label', () => NS.setMember(identity, p, 'owner' in m.role ? 'owner' : 'member', e.target.value === '' ? null : e.target.value))}>
                                        <option value="">on which dapp?</option>
                                        {dapps.map((d) => <option key={d.id.toString()} value={d.id.toString()}>{d.name}</option>)}
                                    </select>
                                ) : dapp != null && dappName(dapp) ? <span style={{ fontSize: '0.75rem', color: theme.colors.secondaryText }}>on {dappName(dapp)}</span> : null}
                                {isOwner && p !== me && (
                                    <button type="button" style={btn(false)} disabled={!!busy} onClick={() => run('role', () => NS.setMember(identity, p, 'owner' in m.role ? 'member' : 'owner', dapp))}>
                                        {'owner' in m.role ? 'Make member' : 'Make owner'}
                                    </button>
                                )}
                                {(isOwner || p === me) && account.members.length > 0 && (
                                    <button type="button" style={btn(true)} disabled={!!busy} title={p === me ? 'Leave this account' : 'Remove from the account'}
                                        onClick={() => setConfirm({ message: p === me ? 'Leave this account? Your principal will no longer show its name.' : 'Remove this principal from your account?', run: () => run('remove', () => NS.removeMember(identity, p), p === me ? 'You left the account' : 'Removed') })}>
                                        {p === me ? 'Leave' : <FaTimes size={10} />}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>You have no account yet: set a name above, or add a hotkey below, and one is made.</div>
            )}

            <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                <FaKey color={accent} size={13} /> Hotkeys
            </div>
            <p style={small}>
                A hotkey can rename your account and change its avatar, and can merge it into its own account, so this principal shows that account's name.
                Use it on another dapp: add your Sneed Hub principal as a hotkey there, then merge from here. A hotkey is not shown as one of your principals.
            </p>
            {(account?.hotkeys || []).map((h) => (
                <div key={h.toText()} style={row}>
                    {show(h)}
                    {isOwner && <button type="button" style={btn(true)} disabled={!!busy} onClick={() => run('unhotkey', () => NS.removeHotkey(identity, account.id, h), 'Hotkey removed')}><FaTimes size={10} /></button>}
                </div>
            ))}
            {(!account || isOwner) && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                    <div style={{ flex: 1, minWidth: '240px' }}>
                        <PrincipalInput value={hotkeyInput} onChange={setHotkeyInput} placeholder="Principal to give a hotkey" defaultTab="private" defaultPrincipalType="users" disabled={!!busy} />
                    </div>
                    <button type="button" style={primaryBtn} disabled={!!busy || !hotkeyInput}
                        onClick={() => { let p; try { p = Principal.fromText(hotkeyInput.trim()); } catch { setError('Not a principal'); return; } run('hotkey', () => NS.addHotkey(identity, p), 'Hotkey added').then(() => setHotkeyInput('')); }}>
                        {busy === 'hotkey' ? 'Adding…' : 'Add hotkey'}
                    </button>
                </div>
            )}

            {managed.length > 0 && (
                <>
                    <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: theme.colors.primaryText, fontSize: '0.9rem' }}>
                        <FaCompressArrowsAlt color={accent} size={13} /> Accounts you hold a hotkey on
                    </div>
                    {managed.map((a) => {
                        const id = a.id.toString();
                        return (
                            <div key={id} style={{ ...row, alignItems: 'flex-start', flexDirection: 'column' }}>
                                <div style={{ fontSize: '0.85rem', color: theme.colors.primaryText }}>
                                    {opt(a.name) || <i style={{ color: theme.colors.mutedText }}>no name</i>}
                                    <span style={{ fontSize: '0.7rem', color: theme.colors.mutedText }}> · {a.members.length} principal{a.members.length === 1 ? '' : 's'}</span>
                                </div>
                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>{a.members.map((m) => <span key={m.principal.toText()}>{show(m.principal)}</span>)}</div>
                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <input value={renames[id] ?? ''} onChange={(e) => setRenames({ ...renames, [id]: e.target.value })} placeholder="New name" maxLength={32}
                                        style={{ backgroundColor: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: '8px', color: theme.colors.primaryText, padding: '0.35rem 0.6rem', fontSize: '0.8rem' }} />
                                    <button type="button" style={btn(false)} disabled={!!busy || !(renames[id] || '').trim()} onClick={() => run('rename', () => NS.setAccountName(identity, id, renames[id].trim()), 'Renamed')}>Rename</button>
                                    <button type="button" style={primaryBtn} disabled={!!busy}
                                        onClick={() => setConfirm({ message: `Merge this account into yours? Its principals will show ${opt(account?.name) ? `"${opt(account.name)}"` : 'your name'} from now on, and everyone can see they are yours.${!opt(account?.name) && opt(a.name) ? ` Your account takes the name "${opt(a.name)}".` : opt(a.name) ? ` The name "${opt(a.name)}" is freed.` : ''}`, run: () => run('merge', () => NS.mergeAccount(identity, id), 'Merged into your account') })}>
                                        {busy === 'merge' ? 'Merging…' : 'Merge into my account'}
                                    </button>
                                    <button type="button" style={btn(true)} disabled={!!busy} title="Give up this hotkey" onClick={() => run('drop', () => NS.removeHotkey(identity, id, identity.getPrincipal()), 'Hotkey given up')}><FaTimes size={10} /></button>
                                </div>
                            </div>
                        );
                    })}
                </>
            )}
            {confirm && <ConfirmationModal show onClose={() => setConfirm(null)} onSubmit={confirm.run} doAwait message={confirm.message} />}
        </div>
    );
}
