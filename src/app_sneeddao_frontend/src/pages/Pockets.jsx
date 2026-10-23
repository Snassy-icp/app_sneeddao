// Advanced → Pockets (/wallet/pockets; spec/programmable_accounts.md §4.3, §4.4, §4.8): create
// (next number, or an exact subaccount through the byte editor), rename, hide/unhide, forget, the
// hosts that hold pockets for me (read-only and failure states), approvals per pocket (the wallet's
// approvals module), and "check pocket #N" for ledgers without an index (ICP).
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FaLayerGroup, FaPlus, FaEye, FaEyeSlash, FaTrash, FaPen, FaQrcode, FaHandshake, FaSync, FaSearch, FaExclamationTriangle, FaCheck } from 'react-icons/fa';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { useWalletOptional } from '../contexts/WalletContext';
import { useDenomination } from '../contexts/DenominationContext';
import { usePockets } from '../hooks/usePockets';
import { useApprovalsMany } from '../hooks/useApprovals';
import ApprovalsList from '../components/ApprovalsList';
import SubaccountEditor from '../components/SubaccountEditor';
import { ReceivePanel } from '../components/PocketRows';
import { PocketAvatar, HostBadge, TokenAmount, PocketButton } from '../components/PocketVisuals';
import { appConfirm, appAlert } from '../utils/appDialog';
import { normalizeId } from '../utils/IdUtils';
import { formatAmount, computeUsdValue } from '../utils/StringUtils';
import { ADAPTERS, enabledAdapters } from '../utils/pockets/adapters/index';
import { sortPockets, displayName, badge, KIND, MAIN_ID, nextFreeNumber, isPrincipalShaped } from '../utils/pockets/model';
import { encodeAccount, isDefault } from '../utils/pockets/subaccount';
import { subaccountHint } from '../components/SubaccountEditor';
import { CHECK_RANGE_MAX, deepScanAvailable } from '../utils/pockets/discovery';

const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const ledgerOf = (t) => normalizeId(t?.ledger_canister_id || t?.principal);

function Section({ title, icon: Icon, children, right }) {
    const { theme } = useTheme();
    const c = theme.colors;
    return (
        <section style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 16, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '1.05rem', color: c.primaryText, display: 'flex', alignItems: 'center', gap: 8 }}>{Icon && <Icon size={14} />} {title}</h2>
                {right}
            </div>
            {children}
        </section>
    );
}

function useStyles() {
    const { theme } = useTheme();
    const c = theme.colors;
    return {
        c,
        btn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', fontSize: '0.8rem', borderRadius: 8, cursor: 'pointer', background: 'transparent', color: c.primaryText, border: `1px solid ${c.border}` },
        primary: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: '0.85rem', fontWeight: 600, borderRadius: 8, cursor: 'pointer', background: c.accent, color: '#fff', border: 'none' },
        input: { padding: '0.55rem 0.7rem', borderRadius: 8, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText, fontSize: '0.9rem', minWidth: 0, boxSizing: 'border-box' },
        option: { background: c.secondaryBg, color: c.primaryText },
    };
}

function PocketApprovals({ pocket, tokens }) {
    const { identity } = useAuth();
    const owner = identity ? identity.getPrincipal().toText() : null;
    const ledgerIds = useMemo(() => [...new Set([...pocket.ledgers, ...[...pocket.balances.entries()].filter(([, b]) => b.total > 0n).map(([l]) => l)])], [pocket]);
    const { approvals, loadingCount, refreshAll } = useApprovalsMany({ ledgerIds, owner, subaccount: pocket.account?.subaccount || null });
    const S = useStyles();
    const tokenMap = Object.fromEntries(tokens.map((t) => [ledgerOf(t), t]));
    if (!ledgerIds.length) return <div style={{ fontSize: '0.8rem', color: S.c.mutedText }}>No tokens known in this pocket yet.</div>;
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                <button type="button" style={S.btn} onClick={refreshAll} disabled={loadingCount > 0}><FaSync size={10} /> {loadingCount > 0 ? 'Checking…' : 'Check again'}</button>
            </div>
            <ApprovalsList approvals={approvals} tokens={tokenMap} showToken emptyText="No approvals from this pocket." />
        </div>
    );
}

function PocketCard({ pocket: p, tokens }) {
    const pk = usePockets();
    const S = useStyles();
    const [open, setOpen] = useState(null); // 'rename' | 'receive' | 'approvals'
    const [name, setName] = useState(p.nickname || '');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const c = S.c;
    const rows = [...p.balances.entries()].filter(([, b]) => b.total > 0n);
    const tokenOf = (l) => tokens.find((t) => ledgerOf(t) === l);
    const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e?.message || String(e)); } finally { setBusy(false); } };
    const canName = Boolean(p.account); // names belong to accounts
    const wallet = p.kind === KIND.wallet;
    const hint = wallet && p.account?.subaccount && isPrincipalShaped(p.account.subaccount) ? subaccountHint(p.account.subaccount) : null;
    const toggle = (k) => setOpen(open === k ? null : k);
    return (
        <div style={{ borderRadius: 16, padding: 14, marginBottom: 12, background: c.secondaryBg, border: `1px solid ${p.status === 'error' ? `${c.warning}80` : c.border}`, opacity: p.hidden ? 0.7 : 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <PocketAvatar pocket={p} size={44} />
                <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.02rem', color: c.primaryText, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName(p)}</span>
                        {p.registered && <span title="Remembered in your account (syncs across devices)" style={{ color: c.success, display: 'inline-flex' }}><FaCheck size={11} /></span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 3 }}>
                        <HostBadge pocket={p} />
                        {p.hidden && <span style={{ fontSize: '0.7rem', color: c.mutedText }}>{p.quietHidden ? 'escrow' : 'hidden'}</span>}
                    </div>
                </div>
            </div>
            {p.account && <div style={{ fontSize: '0.7rem', color: c.mutedText, wordBreak: 'break-all', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', marginTop: 8 }}>{encodeAccount(p.account)}</div>}
            {hint && <div style={{ fontSize: '0.72rem', color: c.warning, marginTop: 4 }}>{hint}</div>}
            {p.status === 'error' && <div style={{ fontSize: '0.8rem', color: c.warning, marginTop: 6 }}><FaExclamationTriangle size={10} /> couldn't read {p.host || p.adapterId}{p.error ? `: ${p.error}` : ''}</div>}

            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rows.length === 0 && p.status !== 'error' && <span style={{ fontSize: '0.82rem', color: c.mutedText }}>Empty</span>}
                {rows.map(([l, b]) => {
                    const t = tokenOf(l) || { symbol: `${l.slice(0, 5)}…`, decimals: 8 };
                    const reserved = b.available != null && b.total > b.available && !b.locked ? b.total - b.available : 0n;
                    const sub = b.locked > 0n ? `locked ${formatAmount(b.locked, t.decimals)} / free ${formatAmount(b.available ?? 0n, t.decimals)}` : reserved > 0n ? `${formatAmount(reserved, t.decimals)} in escrow` : null;
                    return (
                        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, background: c.primaryBg, border: `1px solid ${c.border}` }}>
                            <span style={{ fontSize: '0.8rem', color: c.secondaryText, fontWeight: 600 }}>{t.symbol}</span>
                            <TokenAmount token={t} amount={b.total} sub={sub} />
                        </div>
                    );
                })}
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                {(wallet || p.caps?.receive) && <PocketButton icon={FaQrcode} onClick={() => toggle('receive')}>Receive</PocketButton>}
                {canName && <PocketButton icon={FaPen} onClick={() => toggle('rename')}>Rename</PocketButton>}
                {wallet && <PocketButton icon={FaHandshake} onClick={() => toggle('approvals')}>Approvals</PocketButton>}
                {p.id !== MAIN_ID && canName && !p.quietHidden && (
                    <PocketButton icon={p.hidden ? FaEye : FaEyeSlash} disabled={busy} onClick={() => run(() => pk.hide(p, !p.hidden))}>{p.hidden ? 'Unhide' : 'Hide'}</PocketButton>
                )}
                {p.id !== MAIN_ID && wallet && p.registered && (
                    <PocketButton icon={FaTrash} disabled={busy} onClick={() => run(async () => {
                        const has = rows.length > 0;
                        const ok = await appConfirm(has
                            ? `Forget ${displayName(p)}? It still holds tokens, so the wallet will find it again; nothing moves.`
                            : `Forget ${displayName(p)}? It leaves your pocket list; its name stays. Nothing moves.`, { type: 'warning', confirmText: 'Forget' });
                        if (ok) await pk.forget(p);
                    })}>Forget</PocketButton>
                )}
            </div>
            {err && <div style={{ color: c.error, fontSize: '0.8rem', marginTop: 6 }}>{err}</div>}
            {open === 'rename' && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Name (private to you)" style={{ ...S.input, flex: '1 1 180px' }} />
                    <PocketButton primary disabled={busy} onClick={() => run(async () => { await pk.rename(p, name); setOpen(null); })}>Save</PocketButton>
                    {p.nickname && <PocketButton disabled={busy} onClick={() => run(async () => { await pk.rename(p, ''); setName(''); setOpen(null); })}>Clear</PocketButton>}
                    <div style={{ width: '100%', fontSize: '0.72rem', color: c.mutedText }}>Names are unpublished, not secret: they are stored unencrypted on a public network.</div>
                </div>
            )}
            {open === 'receive' && <div style={{ marginTop: 10 }}><ReceivePanel pocket={p} ledger={rows[0]?.[0] || ICP_LEDGER} /></div>}
            {open === 'approvals' && <div style={{ marginTop: 10 }}><PocketApprovals pocket={p} tokens={tokens} /></div>}
        </div>
    );
}

function CreatePocket({ pockets }) {
    const pk = usePockets();
    const S = useStyles();
    const [name, setName] = useState('');
    const [exact, setExact] = useState(false);
    const [sub, setSub] = useState({ bytes: null, valid: true, empty: true });
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    let next = 1;
    try { next = nextFreeNumber(pockets, { registry: pk.registryEntries(), me: pk.ctx?.me }); } catch { /* none left */ }
    const create = async () => {
        setBusy(true); setMsg(null);
        try {
            if (exact) {
                if (!sub.bytes || isDefault(sub.bytes)) throw new Error('Enter a subaccount (not all zeros: that is Main)');
                await pk.create({ subaccount: sub.bytes, name });
            } else {
                await pk.create({ number: next, name });
            }
            setName('');
            setMsg({ ok: true, text: 'Pocket created' });
        } catch (e) { setMsg({ ok: false, text: e?.message || String(e) }); } finally { setBusy(false); }
    };
    return (
        <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Name (optional)" style={{ ...S.input, flex: '1 1 180px' }} />
                <button type="button" style={S.primary} disabled={busy || (exact && (!sub.bytes || !sub.valid))} onClick={create}>
                    <FaPlus size={11} /> {exact ? 'Create with this subaccount' : `Create pocket #${next}`}
                </button>
            </div>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.8rem', color: S.c.mutedText, marginTop: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} /> Exact subaccount (byte editor)
            </label>
            {exact && <div style={{ marginTop: 10 }}><SubaccountEditor initialFormat="number" onChange={(bytes, st) => setSub({ bytes, valid: st.valid, empty: st.empty })} /></div>}
            {msg && <div style={{ marginTop: 8, fontSize: '0.8rem', color: msg.ok ? S.c.success : S.c.error }}>{msg.text}</div>}
        </div>
    );
}

function Hosts() {
    const pk = usePockets();
    const S = useStyles();
    const c = S.c;
    const enabled = pk.ctx ? new Set(enabledAdapters(pk.ctx).map((a) => a.id)) : new Set();
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ADAPTERS.map((a) => {
                const mine = pk.pockets.filter((p) => p.adapterId === a.id && p.status !== 'error');
                const failed = pk.pockets.find((p) => p.adapterId === a.id && p.status === 'error' && p.hostKey === '*');
                const readOnly = typeof a.withdraw !== 'function';
                const state = !enabled.has(a.id) ? { t: 'off', color: c.mutedText } : failed ? { t: `couldn't read: ${failed.error}`, color: c.warning } : { t: `${mine.length} pocket${mine.length === 1 ? '' : 's'}`, color: c.success };
                return (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: '0.85rem', borderTop: `1px solid ${c.border}`, paddingTop: 6 }}>
                        <span style={{ color: c.primaryText }}>{a.name} <span style={{ color: c.mutedText, fontSize: '0.75rem' }}>{a.kind === 'service' ? 'service balance' : 'hosted'}{readOnly ? ' · read-only' : ''}</span></span>
                        <span style={{ color: state.color }}>
                            {state.t}
                            {readOnly && a.manageUrl && <> · <a href={a.manageUrl} target="_blank" rel="noopener noreferrer" style={{ color: c.accent }}>manage at {a.name}</a></>}
                        </span>
                    </div>
                );
            })}
            <div style={{ fontSize: '0.72rem', color: c.mutedText }}>Sneed Notifications is topped up from Main only (its canister pulls from the default account).</div>
        </div>
    );
}

function CheckNumbers({ tokens }) {
    const pk = usePockets();
    const S = useStyles();
    const icp = tokens.find((t) => ledgerOf(t) === ICP_LEDGER);
    const [ledger, setLedger] = useState(icp ? ICP_LEDGER : ledgerOf(tokens[0]) || ICP_LEDGER);
    const [n, setN] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const token = tokens.find((t) => ledgerOf(t) === ledger);
    const run = async (nums) => {
        setBusy(true); setResult(null);
        try { setResult(await pk.checkNumber(ledger, nums)); } catch (e) { await appAlert(e, { type: 'error' }); } finally { setBusy(false); }
    };
    return (
        <div>
            <div style={{ fontSize: '0.8rem', color: S.c.mutedText, marginBottom: 8 }}>
                The ICP ledger's index works on account identifiers, so pockets can't be listed for ICP. Check numbered pockets here (cheap balance queries); those holding tokens are remembered.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={ledger} onChange={(e) => setLedger(e.target.value)} style={S.input}>
                    {tokens.map((t) => <option key={ledgerOf(t)} value={ledgerOf(t)} style={S.option}>{t.symbol}</option>)}
                    {!tokens.length && <option value={ICP_LEDGER} style={S.option}>ICP</option>}
                </select>
                <input type="number" min={1} value={n} onChange={(e) => setN(e.target.value)} placeholder="#N" style={{ ...S.input, width: 90 }} />
                <button type="button" style={S.btn} disabled={busy || !(Number(n) >= 1)} onClick={() => run([Number(n)])}><FaSearch size={10} /> Check #{n || 'N'}</button>
                <button type="button" style={S.btn} disabled={busy} onClick={() => run(Array.from({ length: CHECK_RANGE_MAX }, (_, i) => i + 1))}>Check #1–#{CHECK_RANGE_MAX}</button>
            </div>
            {busy && <div style={{ fontSize: '0.8rem', color: S.c.mutedText, marginTop: 6 }}>Checking…</div>}
            {result && (
                <div style={{ marginTop: 8, fontSize: '0.85rem', color: S.c.secondaryText }}>
                    {result.filter((r) => r.balance > 0n).length === 0 ? 'No tokens in those pockets.' : result.filter((r) => r.balance > 0n).map((r) => (
                        <div key={r.number}>#{r.number}: {token ? `${formatAmount(r.balance, token.decimals)} ${token.symbol}` : r.balance.toString()}</div>
                    ))}
                </div>
            )}
            {!deepScanAvailable && <div style={{ fontSize: '0.72rem', color: S.c.mutedText, marginTop: 8 }}>A deep scan of a token's whole history (for tokens without an index) comes with the ledger history cache.</div>}
        </div>
    );
}

export default function Pockets() {
    const { theme } = useTheme();
    const c = theme.colors;
    const { identity, isAuthenticated } = useAuth();
    const wallet = useWalletOptional();
    const tokens = wallet?.walletTokens || [];
    const pk = usePockets();
    const S = useStyles();
    const [showHidden, setShowHidden] = useState(false);
    // empty, unnamed hosted pockets (an ICPSwap pool with nothing left) stay out of this list too
    const all = sortPockets(pk.pockets.filter((p) => p.hostKey !== '*' && !(p.kind === KIND.hosted && !p.nickname && p.status !== 'error' && ![...p.balances.values()].some((b) => b.total > 0n))));
    const shown = all.filter((p) => (p.quietHidden ? pk.showQuiet : showHidden || !p.hidden));
    const hiddenCount = all.filter((p) => p.hidden && !p.quietHidden).length;
    const escrowCount = pk.pockets.filter((p) => p.caps?.quiet && p.hostKey !== '*' && [...p.balances.values()].some((b) => b.total > 0n)).length;
    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={{ maxWidth: 820, margin: '0 auto', padding: '1.5rem 1rem', color: c.primaryText, boxSizing: 'border-box' }}>
                <div style={{ marginBottom: 16 }}>
                    <Link to="/wallet" style={{ color: c.accent, fontSize: '0.85rem' }}>← Wallet</Link>
                    <h1 style={{ margin: '0.5rem 0 0.25rem', fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: 10 }}><FaLayerGroup size={18} /> Pockets</h1>
                    <p style={{ margin: 0, color: c.secondaryText, fontSize: '0.9rem', lineHeight: 1.5 }}>
                        Every account that is yours and holds tokens: numbered subaccounts of your principal, accounts Sneed canisters hold for you, and service balances.
                        Approve from a pocket that holds only what you want at risk: a spender can never take more than that pocket holds.
                    </p>
                </div>
                {!isAuthenticated || !identity ? (
                    <Section title="Sign in">Sign in to see and manage your pockets.</Section>
                ) : (
                    <>
                        <Section title="New pocket" icon={FaPlus}><CreatePocket pockets={pk.pockets} /></Section>
                        <Section title="Your pockets" icon={FaLayerGroup} right={(
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                {escrowCount > 0 && <label title="Sneedex bid and offer-payment escrows. They show by themselves when something in them can be withdrawn." style={{ fontSize: '0.8rem', color: c.mutedText, display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={pk.showQuiet} onChange={(e) => pk.setShowQuiet(e.target.checked)} /> Show Sneedex escrows ({escrowCount})</label>}
                                {hiddenCount > 0 && <label style={{ fontSize: '0.8rem', color: c.mutedText, display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden ({hiddenCount})</label>}
                                <button type="button" style={S.btn} onClick={() => pk.refresh()} disabled={pk.loading}><FaSync size={10} /> {pk.loading ? 'Reading…' : 'Refresh'}</button>
                            </div>
                        )}>
                            {pk.error && <div style={{ color: c.error, fontSize: '0.85rem', marginBottom: 8 }}>{pk.error}</div>}
                            {shown.map((p) => <PocketCard key={p.id} pocket={p} tokens={tokens} />)}
                            <div style={{ fontSize: '0.72rem', color: c.mutedText }}>Empty, unnamed pockets stay out of the wallet's lists; names and pockets sync across your devices through the Sneed naming service.</div>
                        </Section>
                        <Section title="Hosts" icon={FaLayerGroup}><Hosts /></Section>
                        <Section title="Check pocket #N" icon={FaSearch}><CheckNumbers tokens={tokens} /></Section>
                    </>
                )}
            </main>
        </div>
    );
}
