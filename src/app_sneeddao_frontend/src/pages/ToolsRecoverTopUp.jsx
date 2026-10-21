// /tools/recover-topup: finish a cycles top-up whose ICP reached the CMC but was never notified.
// Paste the canister id and the ICP ledger block index of the transfer to the CMC; the page calls
// notify_top_up(block, canister). That is safe for anyone to call: the CMC only mints for a
// transfer to its subaccount for that canister, and only once per block.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Principal } from '@dfinity/principal';
import { FaBolt, FaSpinner, FaArrowLeft } from 'react-icons/fa';
import Header from '../components/Header';
import PrincipalInput from '../components/PrincipalInput';
import PendingTopUpsNotice, { makeTopUpActors } from '../components/PendingTopUpsNotice';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { renotifyTopUp, describeTopUpResult } from '../utils/cyclesTopUp';
import { formatCyclesCompact } from '../utils/NeuronManagerSettings';

export default function ToolsRecoverTopUp() {
    const { theme } = useTheme();
    const { identity, isAuthenticated } = useAuth();
    const [canisterId, setCanisterId] = useState('');
    const [block, setBlock] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);

    let canisterOk = false;
    try { Principal.fromText(canisterId.trim()); canisterOk = canisterId.trim().length > 0; } catch (_) {}
    const blockOk = /^\s*\d+\s*$/.test(block);

    const submit = async () => {
        setBusy(true); setResult(null);
        try {
            const { cmc } = await makeTopUpActors(identity);
            const r = await renotifyTopUp({ cmc, canisterId, blockIndex: block });
            setResult({
                ok: r.status === 'ok',
                text: r.status === 'ok'
                    ? `Cycles minted: ${formatCyclesCompact(Number(r.cycles))} cycles went to ${r.canisterId} (block ${r.blockIndex}). If this block was notified before, the CMC returns the same result again; nothing is minted twice.`
                    : describeTopUpResult(r, formatCyclesCompact),
            });
        } catch (e) {
            setResult({ ok: false, text: e.message || String(e) });
        } finally { setBusy(false); }
    };

    const input = {
        width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
        border: `1px solid ${theme.colors.border}`, background: theme.colors.secondaryBg,
        color: theme.colors.primaryText, fontSize: 14,
    };
    const label = { display: 'block', fontSize: 13, fontWeight: 600, margin: '14px 0 6px', color: theme.colors.primaryText };

    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient || theme.colors.primaryBg, minHeight: '100vh' }}>
            <Header />
            <main style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem', color: theme.colors.primaryText }}>
                <Link to="/tools/main" style={{ color: theme.colors.secondaryText, fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <FaArrowLeft /> Tools
                </Link>
                <h1 style={{ fontSize: '1.6rem', margin: '10px 0 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FaBolt style={{ color: '#f59e0b' }} /> Recover a cycles top-up
                </h1>
                <p style={{ color: theme.colors.secondaryText, lineHeight: 1.6, fontSize: 14, marginTop: 0 }}>
                    A cycles top-up is two steps: an ICP transfer to the cycles minting canister (CMC), then a call that tells the CMC to mint
                    cycles for it. If the second step failed, the ICP waits at the CMC. Enter the canister and the ICP ledger block index of
                    that transfer to finish it. This sends no ICP. It only works for a transfer that really was a top-up of that canister,
                    and the CMC never mints twice for the same block, so anyone can do it safely.
                </p>

                <PendingTopUpsNotice style={{ margin: '16px 0' }} />

                <div style={{ background: theme.colors.cardGradient || theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: 16, padding: '4px 16px 16px' }}>
                    <label style={label}>Canister being topped up</label>
                    <PrincipalInput value={canisterId} onChange={(v) => setCanisterId(v)} placeholder="Canister id" defaultTab="all"
                        defaultPrincipalType="canisters" isAuthenticated={isAuthenticated} style={{ width: '100%' }} inputStyle={input} />
                    <label style={label}>ICP ledger block index of the transfer to the CMC</label>
                    <input value={block} onChange={(e) => setBlock(e.target.value)} placeholder="e.g. 21734567" inputMode="numeric" style={input} />
                    <button
                        onClick={submit}
                        disabled={!canisterOk || !blockOk || busy}
                        style={{
                            marginTop: 16, background: '#f59e0b', color: '#1a1a1a', border: 'none', borderRadius: 10, padding: '10px 18px',
                            fontWeight: 700, cursor: !canisterOk || !blockOk || busy ? 'not-allowed' : 'pointer',
                            opacity: !canisterOk || !blockOk || busy ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 8,
                        }}
                    >
                        {busy ? <FaSpinner className="spin" /> : <FaBolt />} Notify the CMC
                    </button>
                    {result && (
                        <div style={{ marginTop: 14, padding: 12, borderRadius: 10, fontSize: 14, lineHeight: 1.5,
                            background: result.ok ? '#10b98118' : '#f59e0b18', border: `1px solid ${result.ok ? '#10b98155' : '#f59e0b55'}` }}>
                            {result.text}
                        </div>
                    )}
                </div>
                <p style={{ color: theme.colors.secondaryText, fontSize: 12, marginTop: 14 }}>
                    Don't know the block index? Find the ICP transfer to rkp4c-7iaaa-aaaaa-aaaca-cai in your wallet history or
                    on <Link to="/tools/icrc3" style={{ color: '#f59e0b' }}>the ICRC-3 browser</Link> for the ICP ledger.
                </p>
            </main>
        </div>
    );
}
