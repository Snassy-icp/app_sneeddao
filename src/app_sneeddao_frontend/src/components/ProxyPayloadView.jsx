import React, { useEffect, useState } from 'react';
import { FaCheckCircle, FaTimesCircle, FaCogs } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import CandidValue from './CandidValue';
import {
    proxyCanisterId, CLASSES, decodeProxyCall, decodeArgs, sha256, hex, payloadHash, claimedArgHash, toBytes,
} from '../governance/registry';
import { functionById } from '../governance/neurons';
import { readCurrent } from '../governance/useProposeAction';

const EXECUTE_METHODS = new Set(Object.values(CLASSES).map((c) => c.method));

/// Decode a Sneed proxy proposal (spec/sneed_proxy.md §4.1 "Verification"): the ProxyCall payload,
/// the target argument with the target's own interface, the current value where the registry can
/// read it, and a check of the argument's SHA-256 against the validator text voters see. Renders
/// nothing for proposals that are not proxy calls (or before the proxy is deployed).
///
/// `proposal` is an SNS ProposalData (as Proposal.jsx holds it).
export default function ProxyPayloadView({ proposal }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const [view, setView] = useState(null);

    useEffect(() => {
        let live = true;
        setView(null);
        const exec = proposal?.proposal?.[0]?.action?.[0]?.ExecuteGenericNervousSystemFunction;
        if (!exec || !proxyCanisterId) return undefined;
        (async () => {
            const fn = await functionById(exec.function_id);
            if (!fn || fn.canister !== proxyCanisterId || !EXECUTE_METHODS.has(fn.method)) return;
            const call = decodeProxyCall(exec.payload);
            const target = call.canister.toText();
            const decoded = (() => { try { return decodeArgs(target, call.method, call.arg); } catch { return null; } })();
            const argHash = hex(await sha256(call.arg));
            const claimed = claimedArgHash(proposal.payload_text_rendering?.[0]);
            const current = decoded?.action?.read ? await readCurrent(decoded.action.key) : null;
            const pHash = hex(await payloadHash(call));
            if (live) setView({ fn, call, target, decoded, argHash, claimed, current, pHash });
        })().catch((e) => live && setView({ error: e?.message || String(e) }));
        return () => { live = false; };
    }, [proposal]);

    if (!view) return null;
    const box = { marginBottom: '1.5rem', padding: '1rem', borderRadius: 10, border: `1px solid ${c.border}`, background: c.primaryBg };
    if (view.error) return <div style={{ ...box, color: c.mutedText, fontSize: 14 }}>Could not decode this Sneed proxy proposal: {view.error}</div>;

    const { fn, call, target, decoded, argHash, claimed, current, pHash } = view;
    const matches = claimed != null && claimed === argHash;
    const mono = { fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere', color: c.secondaryText };
    return (
        <div style={box}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: c.mutedText, fontSize: '0.85rem', marginBottom: 10 }}>
                <FaCogs /> Sneed proxy call, decoded in your browser
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: c.primaryText, marginBottom: 4 }}>{decoded?.action?.label || call.method}</div>
            <div style={{ fontSize: 13, color: c.secondaryText, marginBottom: 10 }}>
                {fn.method} · target <span style={mono}>{target}</span> · method <code>{call.method}</code>
                {call.expires_at.length ? ` · expires ${new Date(Number(call.expires_at[0] / 1_000_000n)).toISOString().replace('T', ' ').slice(0, 16)} UTC` : ' · no expiry'}
            </div>
            {call.note.length > 0 && <div style={{ fontSize: 14, color: c.primaryText, marginBottom: 10 }}>Note: {call.note[0]}</div>}

            {decoded ? (
                <CandidValue values={decoded.values} fields={decoded.action.fields} current={current} />
            ) : (
                <div style={{ fontSize: 13, color: c.secondaryText }}>
                    Sneed Hub does not know this method's interface, so the argument is shown raw. Decode it with the target's Candid interface (<code>didc decode</code>).
                    <div style={{ ...mono, marginTop: 6 }}>{hex(toBytes(call.arg)) || '(empty)'}</div>
                </div>
            )}

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, fontSize: 13, color: matches ? (c.success || '#10b981') : (c.error || '#ef4444') }}>
                {matches ? <FaCheckCircle style={{ marginTop: 2, flexShrink: 0 }} /> : <FaTimesCircle style={{ marginTop: 2, flexShrink: 0 }} />}
                <span>
                    {matches
                        ? 'The argument matches the SHA-256 in the validator text above.'
                        : claimed == null
                            ? 'The validator text has no argument hash to check against: do not trust the decoded values.'
                            : 'The argument does not match the SHA-256 in the validator text: do not trust the decoded values.'}
                </span>
            </div>
            <div style={{ ...mono, marginTop: 8 }}>argument SHA-256 {argHash}</div>
            <div style={{ ...mono }}>payload hash {pHash} (matches the proxy's ICRC-3 block once executed)</div>
        </div>
    );
}
