// useProposeAction(actionKey): everything a page needs to apply a setting directly (admins) or
// propose it to Sneed DAO (anyone with a SNEED neuron they may propose for). spec/sneed_proxy.md §4.2.
//
//   const p = useProposeAction('sneed_lock.admin_set_lock_fees_icp');
//   p.canApply      the user is an admin of the target canister (the canister's own admin check)
//   p.neurons       { eligible, excluded: [{ neuron, reason }] } of the user's Sneed neurons
//   p.canPropose    an eligible neuron and a registered function
//   p.functionId    the GNSF id (looked up by target method in governance), null if not registered
//   p.apply(args)   call the target directly as the user
//   p.draft(args, { why, note, expiryDays }) -> { call, payload, title, summary, values, current, argHash, payloadHash }
//   p.validate(d)   the proxy validator's text ({ ok } or { err }), before anything is paid
//   p.propose({ draft, neuronId, title, summary }) -> proposal id
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import {
    ACTIONS, CANISTERS, CLASSES, DEFAULT_EXPIRY_DAYS, proxyCanisterId, proxyCallFor, encodeProxyCall, payloadHash, sha256, hex,
    votingPeriodText,
} from './registry';
import { formatArgs } from './format';
import { agentFor, proposerNeurons, functionIdFor, makeProposal } from './neurons';
import { createActor as createProxy } from 'declarations/sneed_proxy';
import { Actor } from '@dfinity/agent';

export const MIN_WHY = 20;

async function targetActor(key, identity) {
    const c = CANISTERS[key];
    if (!c?.id) throw new Error(`${c?.name || key} has no canister id on this network`);
    return Actor.createActor(c.idl, { agent: await agentFor(identity), canisterId: c.id });
}

export async function proxyValidate(cls, call) {
    if (!proxyCanisterId) return { err: 'The Sneed proxy is not deployed on this network yet' };
    const proxy = createProxy(proxyCanisterId, { agent: await agentFor(null) });
    const r = await proxy[CLASSES[cls].validator](call);
    return 'Ok' in r ? { ok: r.Ok } : { err: r.Err };
}

/// The setting's current value, as an argument tuple, where the registry knows how to read it.
export async function readCurrent(actionKey) {
    const a = ACTIONS[actionKey];
    if (!a?.read) return null;
    try { return await a.read(await targetActor(a.canister, null)); } catch { return null; }
}

export default function useProposeAction(actionKey) {
    const { identity, isAuthenticated } = useAuth();
    const action = ACTIONS[actionKey];
    const canister = action ? CANISTERS[action.canister] : null;
    const [canApply, setCanApply] = useState(false);
    const [neurons, setNeurons] = useState(null);
    const [functionId, setFunctionId] = useState(undefined); // undefined while loading
    const [error, setError] = useState('');

    useEffect(() => {
        let live = true;
        setCanApply(false);
        if (!action || !isAuthenticated || !identity) return undefined;
        targetActor(action.canister, null)
            .then((a) => canister.isAdmin(a, identity.getPrincipal().toText()))
            .then((x) => live && setCanApply(!!x))
            .catch(() => live && setCanApply(false));
        return () => { live = false; };
    }, [actionKey, identity, isAuthenticated]);

    useEffect(() => {
        let live = true;
        setNeurons(null);
        if (!isAuthenticated || !identity) { setNeurons({ eligible: [], excluded: [] }); return undefined; }
        proposerNeurons(identity).then((n) => live && setNeurons(n)).catch((e) => { if (live) { setNeurons({ eligible: [], excluded: [] }); setError(e?.message || String(e)); } });
        return () => { live = false; };
    }, [identity, isAuthenticated]);

    useEffect(() => {
        let live = true;
        if (!action || action.route !== 'proxy' || !proxyCanisterId) { setFunctionId(null); return undefined; }
        functionIdFor(proxyCanisterId, CLASSES[action.class].method).then((id) => live && setFunctionId(id)).catch(() => live && setFunctionId(null));
        return () => { live = false; };
    }, [actionKey]);

    const apply = useCallback(async (args) => {
        if (!identity) throw new Error('Log in first');
        const a = await targetActor(action.canister, identity);
        const r = await a[action.method](...args);
        if (action.reply === 'result' && r && typeof r === 'object' && ('err' in r || 'Err' in r)) {
            const e = r.err ?? r.Err;
            throw new Error(typeof e === 'string' ? e : JSON.stringify(e, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
        }
        return r;
    }, [actionKey, identity]);

    const draft = useCallback(async (args, { why = '', note = '', expiryDays = DEFAULT_EXPIRY_DAYS } = {}) => {
        const call = proxyCallFor(actionKey, args, { note, expiryDays });
        const payload = encodeProxyCall(call);
        const values = formatArgs(args, action.fields);
        const currentArgs = await readCurrent(actionKey);
        const current = currentArgs ? formatArgs(currentArgs, action.fields) : null;
        const argHash = hex(await sha256(call.arg));
        const pHash = hex(await payloadHash(call));
        const cls = CLASSES[action.class];
        const changed = values.filter((v) => v.text !== 'unchanged');
        const title = `${canister.name}: ${action.label.replace(/^Set /, 'set ')} → ${changed.map((v) => v.text).join(', ') || 'no change'}`.slice(0, 256);
        const me = identity?.getPrincipal().toText() || '(not logged in)';
        const lines = [
            `## ${action.label}`,
            '',
            '| Field | Current | Proposed |',
            '|---|---|---|',
            ...values.map((v, i) => `| ${v.name} | ${current?.[i]?.text ?? 'unknown'} | ${v.text} |`),
            '',
            '### Why',
            '',
            why.trim(),
            '',
            '### Route',
            '',
            `- Sneed proxy \`${cls.method}\` (generic function ${functionId ?? cls.gnsf}, topic ${cls.topic}${cls.critical ? ', critical' : ''}): ${votingPeriodText(action.class)}.`,
            `- Target: ${canister.name} (\`${canister.id}\`) \`${action.method}\`.`,
            `- Argument SHA-256: \`${argHash}\`; payload hash: \`${pHash}\`.`,
            call.expires_at.length ? `- Expires ${new Date(Number(call.expires_at[0] / 1_000_000n)).toISOString().replace('T', ' ').slice(0, 16)} UTC if not executed by then.` : '- No expiry.',
            `- Setting: https://app.sneeddao.com${action.page || ''} · verify: https://app.sneeddao.com/proxy/verify?c=${canister.id}&m=${action.method}&a=${hex(call.arg)}`,
            '',
            `Submitted from Sneed Hub by ${me}.`,
        ];
        return { call, payload, title, summary: lines.join('\n'), values, current, argHash, payloadHash: pHash, url: `https://app.sneeddao.com${action.page || ''}` };
    }, [actionKey, identity, functionId]);

    const validate = useCallback((d) => proxyValidate(action.class, d.call), [actionKey]);

    const propose = useCallback(async ({ draft: d, neuronId, title, summary }) => {
        if (!identity) throw new Error('Log in first');
        if (functionId == null) throw new Error('Proposals for this setting are not enabled yet');
        const neuronText = Array.from(neuronId, (b) => b.toString(16).padStart(2, '0')).join('');
        const fullSummary = `${summary}\n\nNeuron ${neuronText}.`;
        return makeProposal(identity, { neuronId, title, url: d.url, summary: fullSummary, functionId, payload: d.payload });
    }, [identity, functionId]);

    return useMemo(() => ({
        action, canister, canApply, neurons, functionId, error,
        canPropose: !!neurons?.eligible?.length && functionId != null,
        apply, draft, validate, propose,
    }), [action, canister, canApply, neurons, functionId, error, apply, draft, validate, propose]);
}
