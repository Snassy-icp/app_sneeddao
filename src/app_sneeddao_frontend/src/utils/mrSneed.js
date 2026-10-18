// Mr Sneed, Sneed DAO's mascot and spirit (the /mr-sneed page). His canister holds his DAO-governed
// prompt and the memories he writes as he works (spec/mr_sneed_canister.md). Everything in it is
// public. Changes go through Sneed DAO proposals: the generic functions registered for the
// canister are found in governance by target method, so no ids are configured here.
import { HttpAgent } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';
import { createActor, canisterId as envId } from 'declarations/mr_sneed';
import { createActor as createGovernance } from 'external/sns_governance';

const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';

// dfx bakes a made-up 8-byte id into the bundle for a canister missing on the network
const realCanisterId = (text) => {
    try { const b = Principal.fromText(text).toUint8Array(); return b.length === 10 && b[9] === 1 ? text : null; } catch { return null; }
};

export const mrSneedCanisterId = envId ? realCanisterId(envId) : null;
export const MR_SNEED_PRINCIPAL = 'tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae';
export const MR_SNEED_NEURON = '4a0d7df0c5bbedeac5d5ff141c4bc97992d1f21ad1b5be0b3cea8dca340fe0c4';
export const SNEED_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
export const PERSONALITY_MAX = 8192; // bytes, as in the canister
export const REASON_MAX = 500;
const SUBMIT_PROPOSAL = 3;

async function agentFor(identity) {
    const agent = await HttpAgent.create({ host, ...(identity ? { identity } : {}) });
    if (isLocal) await agent.fetchRootKey();
    return agent;
}
export const mrSneedActor = async (identity) => createActor(mrSneedCanisterId, { agent: await agentFor(identity) });
const governanceActor = async (identity, governance) => createGovernance(governance, { agent: await agentFor(identity) });

export const kindName = (k) => Object.keys(k)[0];
export const statusName = (s) => Object.keys(s)[0];
export const bytesOf = (s) => new TextEncoder().encode(s).length;

/// The registered generic functions that target this canister: { set_personality: id, ... }.
export async function mrSneedFunctions(governance) {
    const gov = await governanceActor(null, governance);
    const r = await gov.list_nervous_system_functions();
    const out = {};
    for (const f of r.functions) {
        const g = f.function_type[0]?.GenericNervousSystemFunction;
        if (g && g.target_canister_id[0]?.toText() === mrSneedCanisterId && g.target_method_name[0]) out[g.target_method_name[0]] = f.id;
    }
    return out;
}

/// The caller's Sneed neurons that may submit proposals.
export async function proposerNeurons(identity, governance) {
    const gov = await governanceActor(identity, governance);
    const me = identity.getPrincipal().toText();
    const r = await gov.list_neurons({ of_principal: [identity.getPrincipal()], limit: 100, start_page_at: [] });
    return r.neurons.filter((n) => n.id[0] && n.permissions.some((p) => p.principal[0]?.toText() === me && p.permission_type.includes(SUBMIT_PROPOSAL)));
}

/// Each change: the validator that renders it (the same one governance runs) and its payload.
const PersonalityArgs = IDL.Record({ text: IDL.Text, reason: IDL.Text, expected_version: IDL.Opt(IDL.Nat) });
const Limits = IDL.Record({ writes_per_day: IDL.Nat, max_pinned: IDL.Nat, max_active: IDL.Nat, max_bytes: IDL.Nat });
export const CHANGES = {
    set_personality: {
        validate: (a, { text, reason, expectedVersion }) => a.validate_set_personality({ text, reason, expected_version: [BigInt(expectedVersion)] }),
        payload: ({ text, reason, expectedVersion }) => IDL.encode([PersonalityArgs], [{ text, reason, expected_version: [BigInt(expectedVersion)] }]),
        title: ({ expectedVersion }) => `Set Mr Sneed's personality to version ${expectedVersion + 1}`,
    },
    set_writers: {
        validate: (a, { writers }) => a.validate_set_writers(writers.map((t) => Principal.fromText(t))),
        payload: ({ writers }) => IDL.encode([IDL.Vec(IDL.Principal)], [writers.map((t) => Principal.fromText(t))]),
        title: () => "Change who may write Mr Sneed's memories",
    },
    set_limits: {
        validate: (a, { limits }) => a.validate_set_limits(limits),
        payload: ({ limits }) => IDL.encode([Limits], [limits]),
        title: () => "Change Mr Sneed's memory limits",
    },
    remove_memory: {
        validate: (a, { id, reason }) => a.validate_remove_memory(BigInt(id), reason),
        payload: ({ id, reason }) => IDL.encode([IDL.Nat, IDL.Text], [BigInt(id), reason]),
        title: ({ id }) => `Remove Mr Sneed's memory #${id}`,
    },
};

/// Renders a change with the canister's own validator: { ok: text } or { err: text }.
export async function previewChange(method, args) {
    const r = await CHANGES[method].validate(await mrSneedActor(null), args);
    return 'Ok' in r ? { ok: r.Ok } : { err: r.Err };
}

/// Files the change as a Sneed DAO proposal from the caller's neuron; returns the proposal id.
export async function proposeChange(identity, governance, { neuronId, functionId, method, args, summary }) {
    const gov = await governanceActor(identity, governance);
    const r = await gov.manage_neuron({
        subaccount: neuronId,
        command: [{ MakeProposal: {
            title: CHANGES[method].title(args),
            url: 'https://app.sneeddao.com/mr-sneed',
            summary,
            action: [{ ExecuteGenericNervousSystemFunction: { function_id: BigInt(functionId), payload: new Uint8Array(CHANGES[method].payload(args)) } }],
        } }],
    });
    const cmd = r.command[0];
    if (!cmd) throw new Error('Governance gave no answer');
    if ('Error' in cmd) throw new Error(cmd.Error.error_message);
    if (!('MakeProposal' in cmd)) throw new Error('Unexpected answer from governance');
    return cmd.MakeProposal.proposal_id[0]?.id ?? null;
}

/// A memory link ("proposal:410", "commit:abc", a URL) as { href, label, internal }.
export function linkOf(l) {
    let m = /^proposal:(\d+)$/.exec(l);
    if (m) return { href: `/proposal?proposalid=${m[1]}&sns=${SNEED_ROOT}`, label: `Proposal ${m[1]}`, internal: true };
    m = /^commit:([0-9a-f]{7,40})$/.exec(l);
    if (m) return { href: `https://github.com/Snassy-icp/app_sneeddao/commit/${m[1]}`, label: `Commit ${m[1].slice(0, 8)}`, internal: false };
    m = /^thread:(\d+)$/.exec(l);
    if (m) return { href: `/thread?threadid=${m[1]}`, label: `Thread ${m[1]}`, internal: true };
    if (/^https:\/\//.test(l)) return { href: l, label: l.replace(/^https:\/\//, ''), internal: false };
    return { href: null, label: l, internal: false };
}
