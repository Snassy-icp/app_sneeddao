// The wallet's Approvals tab: every ICRC-2 approval the user's main account has granted, across
// the wallet's tokens, with Revoke / Change, and how each token was checked (casual view first,
// the per-token coverage behind a toggle).
import React, { useMemo, useState } from 'react';
import { FaHandshake, FaSync, FaChevronDown, FaChevronRight } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import ApprovalsList from './ApprovalsList';
import { useApprovalsMany } from '../hooks/useApprovals';
import { approvalRisk } from '../utils/approvals';
import { normalizeId } from '../utils/IdUtils';

const METHOD_TEXT = {
    icrc103: 'complete: the ledger lists its approvals (ICRC-103)',
    index: 'from the transaction history (index)',
    known: 'Sneed canisters, pools and spenders approved here only',
    none: 'no approvals on this token (no ICRC-2)',
};

export default function WalletApprovals({ tokens = [], positions = [], accent = '#10b981' }) {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const c = theme.colors;
    const [showCoverage, setShowCoverage] = useState(false);
    const owner = identity ? identity.getPrincipal().toText() : null;
    const byLedger = useMemo(() => {
        const m = {};
        for (const t of tokens) { const id = normalizeId(t.ledger_canister_id); if (id) m[id] = t; }
        return m;
    }, [tokens]);
    const ledgerIds = useMemo(() => Object.keys(byLedger), [byLedger]);
    const { approvals, results, loadingCount, doneCount, refreshAll } = useApprovalsMany({ ledgerIds, owner, positions });
    const warnCount = approvals.filter((a) => approvalRisk(a, { decimals: Number(byLedger[a.ledgerId]?.decimals ?? 8) }).level === 'warn').length;
    const tokenCount = new Set(approvals.map((a) => a.ledgerId)).size;
    const partial = results.filter((r) => r.result && (r.result.method === 'known' || !r.result.complete) && r.result.method !== 'none');
    const errors = results.filter((r) => r.error);

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.75rem', flexWrap: 'wrap' }}>
                <h3 style={{ color: c.primaryText, fontSize: '1.1rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <FaHandshake size={16} color={accent} />
                    Approvals
                    {approvals.length > 0 && <span style={{ color: accent, fontWeight: 500 }}>({approvals.length})</span>}
                </h3>
                <button onClick={() => refreshAll()} disabled={loadingCount > 0}
                    style={{ background: `${accent}15`, color: accent, border: `1px solid ${accent}30`, borderRadius: 8, padding: '0.5rem 0.75rem', cursor: loadingCount ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: loadingCount ? 0.6 : 1 }}>
                    <FaSync size={12} style={{ animation: loadingCount ? 'walletSpin 1s linear infinite' : 'none' }} />
                    {loadingCount ? `Checking ${doneCount}/${ledgerIds.length}` : 'Refresh'}
                </button>
            </div>
            <p style={{ color: c.secondaryText, fontSize: '0.85rem', lineHeight: 1.5, margin: '0 0 0.75rem' }}>
                An approval lets another account or canister take up to an amount of a token from your wallet, until it expires.
                {approvals.length > 0
                    ? ` You have ${approvals.length} across ${tokenCount} token${tokenCount === 1 ? '' : 's'}${warnCount ? `; ${warnCount} without an expiry or for an unlimited amount` : ''}. Revoke the ones you no longer need.`
                    : loadingCount ? '' : ' None found for your tokens.'}
            </p>
            <ApprovalsList approvals={approvals} tokens={byLedger} showToken emptyText={loadingCount ? 'Checking your tokens…' : 'No approvals found.'} />

            <div style={{ marginTop: '1rem' }}>
                <button onClick={() => setShowCoverage(!showCoverage)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: c.mutedText, fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {showCoverage ? <FaChevronDown size={10} /> : <FaChevronRight size={10} />}
                    How these were found{partial.length ? ` (${partial.length} token${partial.length === 1 ? '' : 's'} checked partly)` : ''}{errors.length ? `, ${errors.length} failed` : ''}
                </button>
                {showCoverage && (
                    <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.78rem', color: c.secondaryText }}>
                        <div style={{ color: c.mutedText, marginBottom: 4 }}>
                            Ledgers with ICRC-103 list every approval. Otherwise the token's index history is read and each spender is asked about;
                            without an index only known spenders can be checked (Sneed canisters, ICPSwap pools you used, spenders you approved in Sneed Hub). Your main account only.
                        </div>
                        {results.map((r) => (
                            <div key={r.ledgerId} style={{ display: 'flex', flexWrap: 'wrap', gap: '0 0.5rem' }}>
                                <span style={{ fontWeight: 600, color: c.primaryText }}>{byLedger[r.ledgerId]?.symbol || r.ledgerId}</span>
                                <span>
                                    {r.loading ? 'checking…' : r.error ? `failed: ${r.error}` : r.result ? `${METHOD_TEXT[r.result.method] || r.result.method}${r.result.method === 'index' && !r.result.complete ? ' (latest part only)' : ''}` : 'not checked yet'}
                                </span>
                                {r.result?.notes?.filter((n) => !/neither ICRC-103 nor an index/.test(n)).map((n, i) => <span key={i} style={{ color: c.mutedText, flexBasis: '100%' }}>{n}</span>)}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
