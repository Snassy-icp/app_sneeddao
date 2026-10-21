// "Recent activity" of the Recursive Liquidity Loop, read from the RLL canister's ICRC-3 log
// (spec/rll_icrc3.md): the latest distributions (`rll_distribution`) and paid claims (`rll_claim`),
// newest first. Shown on /rll_info and /revenue. The log is walked backwards from its tip, following
// archives (utils/icrc3/client.js); a run of `rll_credit` blocks is skipped in one step through its
// `distribution` field, which points at the summary block that comes right before the run.
// Before the RLL upgrade that adds the log, the canister has no icrc3 methods: the card says so.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { FaHistory, FaSpinner, FaSync, FaExternalLinkAlt } from 'react-icons/fa';
import { canisterId as rllCanisterId } from 'declarations/rll';
import { useTheme } from '../contexts/ThemeContext';
import { useDenomination } from '../contexts/DenominationContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { createIcrc3Actor, fetchBlocks } from '../utils/icrc3/client';
import { field, btypeOf, tsOf, asPrincipal } from '../utils/icrc3/value';
import { useStoreVersion } from '../utils/revenueStore';
import { loadTokenMeta, loadPrice, tokenMeta, priceOf, fmtAmount } from '../utils/revenueData';

const PAGE = 100n;        // blocks per request
const MAX_REQUESTS = 12;  // how far back one load may walk
const WANT = 5;           // entries of each kind to show

const nat = (v) => (v && 'Nat' in v ? v.Nat : null);
const principalText = (v) => asPrincipal(v)?.toText() ?? null;

/// The latest distributions and claims, newest first: { logLength, distributions, claims }.
/// Throws { unavailable: true } when the canister has no ICRC-3 log yet.
async function loadActivity(canisterId) {
    const id = Principal.fromText(canisterId);
    let logLength;
    try {
        const actor = await createIcrc3Actor(id);
        logLength = (await actor.icrc3_get_blocks([])).log_length;
    } catch (e) {
        const msg = e?.message || String(e);
        if (/no (update|query) method|has no (query|update) method|method not found|IC0536|IC0302/i.test(msg)) throw Object.assign(new Error('unavailable'), { unavailable: true });
        throw e;
    }
    const distributions = [];
    const claims = [];
    let end = logLength; // exclusive
    for (let n = 0; n < MAX_REQUESTS && end > 0n && (distributions.length < WANT || claims.length < WANT); n++) {
        const start = end > PAGE ? end - PAGE : 0n;
        const blocks = await fetchBlocks(id, start, end - start);
        let next = start;
        for (let i = blocks.length - 1; i >= 0; i--) {
            const { id: index, block } = blocks[i];
            const t = btypeOf(block);
            const tx = field(block, 'tx');
            const ts = tsOf(block);
            if (t === 'rll_distribution' && distributions.length < WANT) {
                distributions.push({
                    index, ts, token: principalText(field(tx, 'token')), amount: nat(field(tx, 'amount')),
                    owners: nat(field(tx, 'owners')), neurons: nat(field(tx, 'neurons')),
                    first: nat(field(tx, 'first_proposal')), last: nat(field(tx, 'last_proposal')),
                });
            } else if (t === 'rll_claim' && claims.length < WANT) {
                claims.push({
                    index, ts, caller: principalText(field(tx, 'caller')), token: principalText(field(tx, 'token')),
                    amount: nat(field(tx, 'amount')), ledgerTx: nat(field(tx, 'ledger_tx')),
                });
            } else if (t === 'rll_credit' && i === 0) {
                // the page starts inside a run of credits: everything back to its summary is credits
                const d = nat(field(tx, 'distribution'));
                if (d !== null && d < index) next = d + 1n;
            }
        }
        end = next;
    }
    return { logLength, distributions, claims };
}

const when = (ts) => (ts ? new Date(Number(ts / 1_000_000n)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

function Who({ principal, theme }) {
    const naming = useNaming();
    let p = null;
    try { p = Principal.fromText(principal); } catch { /* not a principal */ }
    if (!p) return <span>{principal || '?'}</span>;
    const info = naming ? getPrincipalDisplayInfoFromContext(p, naming.principalNames, naming.principalNicknames, naming.verifiedNames, naming.principalCanisterTypes) : null;
    return <PrincipalDisplay principal={p} displayInfo={info} short showCopyButton={false} style={{ color: theme.colors.primaryText }} />;
}

export default function RllActivityCard({ style = {} }) {
    const { theme } = useTheme();
    const { formatValue } = useDenomination();
    useStoreVersion();
    const [state, setState] = useState({ loading: true });

    const load = useCallback(async () => {
        setState((s) => ({ ...s, loading: true, error: null }));
        try {
            const data = await loadActivity(rllCanisterId);
            const tokens = new Set([...data.distributions, ...data.claims].map((x) => x.token).filter(Boolean));
            tokens.forEach((t) => { loadTokenMeta(t).catch(() => {}); loadPrice(t).catch(() => {}); });
            setState({ loading: false, data });
        } catch (e) {
            setState({ loading: false, unavailable: !!e?.unavailable, error: e?.unavailable ? null : (e?.message || String(e)) });
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const money = (amount, ledger) => {
        const meta = tokenMeta(ledger); const p = priceOf(ledger);
        if (!meta || p == null || amount == null) return null;
        return formatValue((Number(amount) / 10 ** meta.decimals) * p);
    };
    const amountText = (amount, ledger) => (amount == null || !ledger ? '?' : fmtAmount(amount, ledger, 4));
    const browse = `/tools/icrc3?canister=${rllCanisterId}`;
    const { data } = state;
    const row = { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 10, rowGap: 2, fontSize: '0.8rem', padding: '6px 8px', borderRadius: 8, background: theme.colors.secondaryBg };
    const muted = { color: theme.colors.mutedText, fontSize: '0.72rem' };
    const heading = { fontSize: '0.7rem', color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.5px', margin: '4px 0 6px' };
    const blockLink = (index) => <Link to={`${browse}&block=${index}`} title={`Block ${index} in the ICRC-3 browser`} style={{ color: theme.colors.mutedText, fontSize: '0.72rem' }}>#{String(index)}</Link>;

    return (
        <section style={{ background: theme.colors.cardBg, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem', minWidth: 0, ...style }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '1.1rem', color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FaHistory size={15} /> Recent activity
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {data && <Link to={browse} style={{ color: theme.colors.accent, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>All {String(data.logLength)} blocks <FaExternalLinkAlt size={9} /></Link>}
                    <button type="button" disabled={state.loading} onClick={load} title="Read the log again" style={{ background: 'transparent', border: `1px solid ${theme.colors.border}`, borderRadius: 8, color: theme.colors.secondaryText, padding: '4px 8px', cursor: 'pointer' }}>
                        {state.loading ? <FaSpinner className="rll-activity-spin" /> : <FaSync />}
                    </button>
                </div>
            </div>
            <style>{'@keyframes rll-activity-spin { to { transform: rotate(360deg); } } .rll-activity-spin { animation: rll-activity-spin 1s linear infinite; }'}</style>
            <p style={{ margin: '6px 0 10px', fontSize: '0.82rem', color: theme.colors.secondaryText, lineHeight: 1.5 }}>
                Every distribution and claim of the loop's rewards, from the RLL canister's certified ICRC-3 activity log.
            </p>

            {state.unavailable && <div style={{ fontSize: '0.82rem', color: theme.colors.mutedText }}>The activity log arrives with the next RLL upgrade.</div>}
            {state.error && (
                <div style={{ fontSize: '0.8rem', color: theme.colors.error }}>
                    Could not read the log: {state.error} <button type="button" onClick={load} style={{ background: 'none', border: 'none', color: theme.colors.accent, cursor: 'pointer', fontSize: '0.8rem' }}>Try again</button>
                </div>
            )}
            {!data && state.loading && <span style={{ ...muted, display: 'inline-flex', gap: 6, alignItems: 'center' }}><FaSpinner className="rll-activity-spin" /> Reading the log…</span>}
            {data && data.distributions.length === 0 && data.claims.length === 0 && <div style={{ fontSize: '0.82rem', color: theme.colors.mutedText }}>No distributions or claims logged yet.</div>}

            {data && (data.distributions.length > 0 || data.claims.length > 0) && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 14 }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={heading}>Distributions</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {data.distributions.length === 0 && <div style={muted}>None in the latest blocks.</div>}
                            {data.distributions.map((d) => {
                                const v = money(d.amount, d.token);
                                return (
                                    <div key={String(d.index)} style={row}>
                                        <span style={{ color: theme.colors.primaryText, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{amountText(d.amount, d.token)}</span>
                                        {v && <span style={muted}>{v}</span>}
                                        <span style={{ color: theme.colors.secondaryText }}>to {d.owners != null ? String(d.owners) : '?'} owners · {d.neurons != null ? String(d.neurons) : '?'} neurons</span>
                                        <span style={{ ...muted, marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>{when(d.ts)} {blockLink(d.index)}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div style={heading}>Claims</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {data.claims.length === 0 && <div style={muted}>None in the latest blocks.</div>}
                            {data.claims.map((c) => (
                                <div key={String(c.index)} style={row}>
                                    <Who principal={c.caller} theme={theme} />
                                    <span style={{ color: theme.colors.primaryText, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{amountText(c.amount, c.token)}</span>
                                    {c.ledgerTx != null && c.token && (
                                        <Link to={`/transaction?id=${c.ledgerTx}&ledger=${c.token}`} title="The transfer on the token's ledger" style={{ ...muted, color: theme.colors.accent }}>ledger tx {String(c.ledgerTx)}</Link>
                                    )}
                                    <span style={{ ...muted, marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>{when(c.ts)} {blockLink(c.index)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
