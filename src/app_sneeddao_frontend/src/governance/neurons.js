// Sneed DAO proposals from Sneed Hub (spec/sneed_proxy.md §4.2): the caller's neurons that may
// propose, the generic function ids registered in governance, and filing a proposal. Generalised
// from utils/mrSneed.js (proposerNeurons, mrSneedFunctions, proposeChange).
import { HttpAgent } from '@dfinity/agent';
import { createActor as createGovernance } from 'external/sns_governance';
import { SNEED_GOVERNANCE } from './registry';

const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';
const SUBMIT_PROPOSAL = 3;

export async function agentFor(identity) {
    const agent = await HttpAgent.create({ host, ...(identity ? { identity } : {}) });
    if (isLocal) await agent.fetchRootKey();
    return agent;
}
export const governanceActor = async (identity, governance = SNEED_GOVERNANCE) => createGovernance(governance, { agent: await agentFor(identity) });

export const neuronIdHex = (n) => Array.from(n.id[0].id, (b) => b.toString(16).padStart(2, '0')).join('');
const days = (s) => Math.round(Number(s) / 86_400);

/// The DAO's rules for proposers, read once per session: minimum dissolve delay to vote (seconds)
/// and the reject cost (e8s).
const paramsCache = new Map();
export function proposerRules(governance = SNEED_GOVERNANCE) {
    if (!paramsCache.has(governance)) {
        paramsCache.set(governance, governanceActor(null, governance).then((g) => g.get_nervous_system_parameters(null)).then((p) => ({
            minDissolveDelaySeconds: p.neuron_minimum_dissolve_delay_to_vote_seconds[0] ?? 0n,
            rejectCostE8s: p.reject_cost_e8s[0] ?? 0n,
        })).catch((e) => { paramsCache.delete(governance); throw e; }));
    }
    return paramsCache.get(governance);
}

function dissolveDelaySeconds(n, nowSeconds) {
    const s = n.dissolve_state?.[0];
    if (!s) return 0n;
    if ('DissolveDelaySeconds' in s) return s.DissolveDelaySeconds;
    const at = s.WhenDissolvedTimestampSeconds;
    return at > nowSeconds ? at - nowSeconds : 0n;
}

/// The caller's Sneed neurons with permission 3 (submit proposals), split into those that can
/// propose (sorted by stake, largest first) and those that cannot, each with the reason, so the
/// user knows what to fix: { eligible: [neuron], excluded: [{ neuron, reason }] }.
export async function proposerNeurons(identity, governance = SNEED_GOVERNANCE) {
    const gov = await governanceActor(identity, governance);
    const me = identity.getPrincipal().toText();
    const [r, rules] = await Promise.all([
        gov.list_neurons({ of_principal: [identity.getPrincipal()], limit: 100, start_page_at: [] }),
        proposerRules(governance),
    ]);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const eligible = [];
    const excluded = [];
    for (const n of r.neurons) {
        if (!n.id[0]) continue;
        if (!n.permissions.some((p) => p.principal[0]?.toText() === me && p.permission_type.includes(SUBMIT_PROPOSAL))) continue;
        const stake = n.cached_neuron_stake_e8s - (n.neuron_fees_e8s > n.cached_neuron_stake_e8s ? n.cached_neuron_stake_e8s : n.neuron_fees_e8s);
        const delay = dissolveDelaySeconds(n, now);
        if (delay < rules.minDissolveDelaySeconds) excluded.push({ neuron: n, reason: `dissolve delay ${days(delay)} days, needs ${days(rules.minDissolveDelaySeconds)}` });
        else if (stake <= rules.rejectCostE8s) excluded.push({ neuron: n, reason: `stake ${(Number(stake) / 1e8).toLocaleString()} SNEED, needs more than ${(Number(rules.rejectCostE8s) / 1e8).toLocaleString()} (the rejection fee)` });
        else eligible.push(n);
    }
    eligible.sort((a, b) => (b.cached_neuron_stake_e8s > a.cached_neuron_stake_e8s ? 1 : b.cached_neuron_stake_e8s < a.cached_neuron_stake_e8s ? -1 : 0));
    return { eligible, excluded };
}

/// Registered generic functions, by target canister and method: Map("<canister> <method>" -> { id, name, topic }).
const functionsCache = new Map();
export function genericFunctions(governance = SNEED_GOVERNANCE) {
    if (!functionsCache.has(governance)) {
        functionsCache.set(governance, governanceActor(null, governance).then((g) => g.list_nervous_system_functions()).then((r) => {
            const out = new Map();
            for (const f of r.functions) {
                const g = f.function_type[0]?.GenericNervousSystemFunction;
                if (g && g.target_canister_id[0] && g.target_method_name[0]) {
                    out.set(`${g.target_canister_id[0].toText()} ${g.target_method_name[0]}`, { id: f.id, name: f.name, topic: g.topic?.[0] ? Object.keys(g.topic[0])[0] : null });
                }
            }
            return out;
        }).catch((e) => { functionsCache.delete(governance); throw e; }));
    }
    return functionsCache.get(governance);
}

/// The id of the function that targets (canister, method), or null when it is not registered.
export async function functionIdFor(canisterIdText, method, governance = SNEED_GOVERNANCE) {
    const fs = await genericFunctions(governance);
    return fs.get(`${canisterIdText} ${method}`)?.id ?? null;
}

/// The registered function with this id, as { canister, method, id, name } (or null).
export async function functionById(id, governance = SNEED_GOVERNANCE) {
    const fs = await genericFunctions(governance);
    for (const [k, v] of fs) if (v.id === BigInt(id)) { const [canister, method] = k.split(' '); return { canister, method, ...v }; }
    return null;
}

/// Files an ExecuteGenericNervousSystemFunction proposal from the caller's neuron; returns its id.
export async function makeProposal(identity, { neuronId, title, url, summary, functionId, payload }, governance = SNEED_GOVERNANCE) {
    const gov = await governanceActor(identity, governance);
    const r = await gov.manage_neuron({
        subaccount: neuronId,
        command: [{ MakeProposal: {
            title, url, summary,
            action: [{ ExecuteGenericNervousSystemFunction: { function_id: BigInt(functionId), payload } }],
        } }],
    });
    const cmd = r.command[0];
    if (!cmd) throw new Error('Governance gave no answer');
    if ('Error' in cmd) throw new Error(cmd.Error.error_message);
    if (!('MakeProposal' in cmd)) throw new Error('Unexpected answer from governance');
    return cmd.MakeProposal.proposal_id[0]?.id ?? null;
}
