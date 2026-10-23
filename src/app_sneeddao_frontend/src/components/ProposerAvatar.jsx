// The SNS logo with the proposer's avatar in front, like an LP token pair. The proposer is a
// neuron; its face is the avatar of the neuron's principals — full owners first, then the rest —
// the first one that has an avatar. Without one, only the SNS logo shows (the pair keeps its width).
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { AvatarPair } from './BigAvatar';
import { useAvatars } from '../hooks/useAvatars';
import { extractPrincipalString, uint8ArrayToHex } from '../utils/NeuronUtils';
import { getOrFetchNeuron } from '../hooks/useNeuronsCache';

// one fetch per neuron while it is in flight (ProposerPrincipals and this share it)
const inflight = new Map();
export function fetchProposerNeuron(snsRoot, neuronIdHex, identity) {
    const k = `${snsRoot}:${neuronIdHex}`;
    if (inflight.has(k)) return inflight.get(k);
    const p = getOrFetchNeuron({ snsRoot, neuronIdHex, identity }).finally(() => { setTimeout(() => inflight.delete(k), 5000); });
    inflight.set(k, p);
    return p;
}

const rank = (perm) => {
    const n = perm?.permission_type?.length || 0;
    return n >= 10 ? 0 : 1; // full owners first
};

const orderedPrincipals = (permissions) => {
    const perms = [...(permissions || [])].sort((a, b) => rank(a) - rank(b));
    return [...new Set(perms.map((p) => extractPrincipalString(p.principal)).filter(Boolean))];
};

/// The neuron's principals (texts), owners first; [] until known. With `permissions` (the neuron's
/// permission list, when the page already has it) nothing is fetched.
export function useProposerPrincipals(snsRoot, neuronId, permissions) {
    const { identity } = useAuth();
    const neuronIdHex = neuronId ? uint8ArrayToHex(neuronId) : null;
    const [list, setList] = useState([]);
    const given = useMemo(() => (permissions ? orderedPrincipals(permissions) : null), [permissions]);
    useEffect(() => {
        setList([]);
        if (given || !snsRoot || !neuronIdHex) return;
        let cancelled = false;
        fetchProposerNeuron(snsRoot, neuronIdHex, identity)
            .then((n) => {
                if (cancelled) return;
                setList(orderedPrincipals(n?.permissions));
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [snsRoot, neuronIdHex, identity, given]);
    return given || list;
}

/// props: snsRoot, neuronId (the proposer's id blob), logo (SNS logo url), snsName, size (default 28),
/// permissions (optional: the neuron's permissions when already loaded), cutout (ring colour,
/// usually the card's background), style
export default function ProposerAvatar({ snsRoot, neuronId, logo, snsName = '', size = 28, permissions, cutout, style }) {
    const principals = useProposerPrincipals(snsRoot, neuronId, permissions);
    const { avatarOf } = useAvatars(principals);
    const face = useMemo(() => principals.find((p) => avatarOf(p)) || null, [principals, avatarOf]);
    return (
        <AvatarPair logo={logo} logoAlt={snsName} logoShape="circle" principal={face} avatarUrl={face ? avatarOf(face) : null}
            size={size} verified="auto" cutout={cutout} style={style}
            title={snsName} />
    );
}
