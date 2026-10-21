// The principals behind a proposer neuron (owner, hotkeys, voters…) with their names and avatars,
// as /proposals shows them: named principals first, the rest behind "…N".
import React, { useEffect, useState } from 'react';
import { Principal } from '@dfinity/principal';
import { FaCrown, FaKey, FaVoteYea, FaUserShield, FaCoins, FaQuestion } from 'react-icons/fa';
import { useAuth } from '../AuthContext';
import { useNaming } from '../NamingContext';
import { PrincipalDisplay, getPrincipalDisplayInfoFromContext } from '../utils/PrincipalUtils';
import { extractPrincipalString, uint8ArrayToHex } from '../utils/NeuronUtils';
import { getOrFetchNeuron } from '../hooks/useNeuronsCache';

const PERM = { MANAGE_PRINCIPALS: 2, SUBMIT_PROPOSAL: 3, VOTE: 4, DISBURSE: 5, DISBURSE_MATURITY: 8 };

const symbolOf = (perm, theme) => {
    const p = perm?.permission_type || [];
    if (p.length === 10 || p.length === 11) return { icon: <FaCrown size={10} />, title: 'Full Owner', color: '#f59e0b' };
    if (p.length === 2 && p.includes(PERM.SUBMIT_PROPOSAL) && p.includes(PERM.VOTE)) return { icon: <FaKey size={10} />, title: 'Hotkey', color: '#06b6d4' };
    if (p.length === 1 && p.includes(PERM.VOTE)) return { icon: <FaVoteYea size={10} />, title: 'Voter', color: '#10b981' };
    if (p.includes(PERM.MANAGE_PRINCIPALS)) return { icon: <FaUserShield size={10} />, title: 'Manager', color: theme.colors.accent };
    if (p.includes(PERM.DISBURSE) || p.includes(PERM.DISBURSE_MATURITY)) return { icon: <FaCoins size={10} />, title: 'Financial', color: '#f59e0b' };
    return { icon: <FaQuestion size={10} />, title: 'Custom', color: theme.colors.mutedText };
};

export default function ProposerPrincipals({ snsRoot, neuronId, theme }) {
    const { identity, isAuthenticated } = useAuth();
    const { principalNames, principalNicknames } = useNaming();
    const [permissions, setPermissions] = useState(null);
    const [expanded, setExpanded] = useState(false);
    const neuronIdHex = uint8ArrayToHex(neuronId);

    useEffect(() => {
        if (!snsRoot || !neuronIdHex) return;
        let cancelled = false;
        getOrFetchNeuron({ snsRoot, neuronIdHex, identity })
            .then((n) => { if (!cancelled) setPermissions(n?.permissions || []); })
            .catch((e) => console.warn(`Failed to load the proposer neuron ${neuronIdHex}:`, e));
        return () => { cancelled = true; };
    }, [snsRoot, neuronIdHex, identity]);

    if (!permissions || permissions.length === 0) return null;
    const infoOf = (p) => { try { return getPrincipalDisplayInfoFromContext(Principal.fromText(p), principalNames, principalNicknames); } catch { return null; } };
    const named = (perm) => { const i = infoOf(extractPrincipalString(perm.principal)); return Boolean(i && (i.name || i.nickname)); };
    const withPrincipal = permissions.filter((perm) => extractPrincipalString(perm.principal));
    let visible = withPrincipal.filter(named);
    let hidden = withPrincipal.filter((perm) => !named(perm));
    if (visible.length === 0 && hidden.length > 0) {
        // nobody named: show the first owner (or the first principal)
        const owner = hidden.find((perm) => [10, 11].includes(perm.permission_type?.length || 0)) || hidden[0];
        visible = [owner];
        hidden = hidden.filter((perm) => perm !== owner);
    }
    const shown = expanded ? [...visible, ...hidden] : visible;

    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
            {shown.map((perm, idx) => {
                const s = symbolOf(perm, theme);
                const p = extractPrincipalString(perm.principal);
                return (
                    <div key={idx} title={s.title} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.15rem 0.4rem', background: `${s.color}15`, borderRadius: '4px', border: `1px solid ${s.color}25` }}>
                        <span style={{ color: s.color, display: 'flex', alignItems: 'center' }}>{s.icon}</span>
                        <PrincipalDisplay principal={Principal.fromText(p)} displayInfo={infoOf(p)} showCopyButton={false} short={true} isAuthenticated={isAuthenticated} style={{ fontSize: '0.7rem' }} />
                    </div>
                );
            })}
            {hidden.length > 0 && (
                <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} title={expanded ? 'Show less' : `Show ${hidden.length} more`}
                    style={{ padding: '0.2rem 0.5rem', background: `${theme.colors.mutedText}15`, borderRadius: '4px', fontSize: '0.7rem', color: theme.colors.mutedText, border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                    {expanded ? '−' : `...${hidden.length}`}
                </button>
            )}
        </div>
    );
}
