// /tools/money: follow the money for any ledger with an index canister,
// starting from any principal, with nothing scanned first. Each expanded
// node is one set of index queries. Query parameters: ?ledger=…&start=…
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import TokenSelector from '../components/TokenSelector';
import { useTheme } from '../contexts/ThemeContext';
import { FaProjectDiagram, FaSpinner } from 'react-icons/fa';
import MoneyGraph from '../tokensafety/MoneyGraph.jsx';
import { indexSource, findIndex } from '../tokensafety/sources.js';
import { fetchTokenHeader, IDS } from '../tokensafety/checks.js';
import { actor } from '../health/agent.js';
import { idlFactory as snswIdl } from 'declarations/nns_snsw/nns_snsw.did.js';
import { idlFactory as factoryIdl } from 'external/icp_swap_factory/icp_swap_factory.did.js';
import { customStyles } from '../health/TreeView.jsx';
import { parsePrincipal } from '../utils/icrc3/client.js';

const opt = (v) => (Array.isArray(v) ? v[0] : v);

/// Labels for the canisters the graph should mark: pools of this token,
/// Sneed Lock, and the SNS canisters when the token is an SNS token.
async function tagsFor(ledgerId, snses) {
    const tags = new Map();
    tags.set(IDS.sneedLock, 'Sneed Lock (locked)');
    const sns = snses.find((s) => s.ledger === ledgerId);
    if (sns) { tags.set(sns.governance, 'SNS governance (treasury and neurons)'); tags.set(sns.swap, 'SNS swap'); tags.set(sns.root, 'SNS root'); }
    try {
        const f = await actor(factoryIdl, IDS.icpswapFactory);
        const r = await f.getPools();
        if ('ok' in r) for (const p of r.ok) if (p.token0.address === ledgerId || p.token1.address === ledgerId) tags.set(p.canisterId.toText(), `ICPSwap pool ${p.token0.address === ledgerId ? p.token1.address : p.token0.address}`);
    } catch { /* pools stay unlabelled */ }
    return tags;
}

function FollowMoney() {
    const { theme } = useTheme();
    const [params, setParams] = useSearchParams();
    const ledgerParam = params.get('ledger') || '';
    const startParam = params.get('start') || '';
    const [ledgerText, setLedgerText] = useState(ledgerParam);
    const [source, setSource] = useState(null);
    const [header, setHeader] = useState(null);
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        const id = parsePrincipal(ledgerParam)?.toText();
        if (!id) { setSource(null); setHeader(null); return undefined; }
        let cancelled = false;
        (async () => {
            setError(null); setStatus('Looking for the index canister…'); setSource(null);
            try {
                const [hdr, w] = await Promise.all([fetchTokenHeader(id), actor(snswIdl, IDS.snsw)]);
                if (cancelled) return;
                setHeader(hdr);
                const deployed = await w.list_deployed_snses({});
                const snses = deployed.instances.map((d) => ({ root: opt(d.root_canister_id)?.toText(), governance: opt(d.governance_canister_id)?.toText(), ledger: opt(d.ledger_canister_id)?.toText(), index: opt(d.index_canister_id)?.toText(), swap: opt(d.swap_canister_id)?.toText() }));
                const indexId = await findIndex(id, snses);
                if (cancelled) return;
                if (!indexId) { setError('This ledger announces no index canister (ICRC-106) and is not an SNS ledger. Use the token safety page, which rebuilds the graph from the block log instead.'); setStatus(null); return; }
                setStatus(`Index ${indexId}. Labelling pools…`);
                const tags = await tagsFor(id, snses);
                if (cancelled) return;
                const src = await indexSource({ ledgerId: id, indexId, tags, token: { symbol: hdr?.symbol, decimals: hdr?.decimals ?? 8 } });
                if (cancelled) return;
                setSource(src); setStatus(null);
            } catch (e) { if (!cancelled) { setError(e?.message || String(e)); setStatus(null); } }
        })();
        return () => { cancelled = true; };
    }, [ledgerParam]);

    const pickLedger = (id) => { setLedgerText(id); const next = new URLSearchParams(params); if (id) next.set('ledger', id); else next.delete('ledger'); setParams(next); };
    const start = useMemo(() => (startParam && parsePrincipal(startParam) ? startParam : null), [startParam]);

    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header />
            <main style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 16px 3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: '1rem' }}>
                    <div style={{ width: 52, height: 52, borderRadius: 14, background: '#3b82f622', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FaProjectDiagram size={24} color="#3b82f6" /></div>
                    <div style={{ flex: 1, minWidth: 220 }}>
                        <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: theme.colors.primaryText }}>Follow the Money</h1>
                        <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>Pick a token with an index canister and start at any principal. Each node you expand is read live from the index, nothing is scanned first. Names and nicknames come from Sneed names.</div>
                    </div>
                </div>
                <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: '1rem', background: theme.colors.cardBg, marginBottom: '1rem', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ flex: '1 1 320px', minWidth: 240 }}>
                        <TokenSelector value={ledgerText} onChange={(id) => pickLedger(id)} placeholder="Pick a token, or enter any ledger canister id" allowCustom />
                    </div>
                    {header && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: theme.colors.primaryText, fontWeight: 700 }}>{header.logo && <img src={header.logo} alt="" style={{ width: 28, height: 28, borderRadius: 8 }} />}{header.name} {header.symbol ? `(${header.symbol})` : ''}</div>}
                    {status && <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}><FaSpinner className="health-spin" /> {status}</span>}
                </div>
                {error && <div style={{ color: '#ef4444', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}
                {source && <MoneyGraph source={source} start={start} theme={theme} />}
                {!source && !status && !error && <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Works for every ledger with an ICRC index canister: SNS tokens, ckBTC, ckETH, ckUSDC and others. A busy account such as a pool shows its most recent history only.</div>}
            </main>
        </div>
    );
}

export default FollowMoney;
