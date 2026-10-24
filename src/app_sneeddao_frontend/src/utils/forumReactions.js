// The forum's reaction, thread-vote and thread-tip methods (spec/pipeline.md "Forum reactions,
// thread tips and votes"), declared here like mentions.js does, so the client does not wait for
// regenerated declarations. A forum build without them answers "method not found": every reader
// here then gives nothing back and the UI hides the feature (isMissingMethod).
import { Actor, HttpAgent } from '@dfinity/agent';
import { canisterId as forumCanisterId } from 'declarations/sneed_sns_forum';
import { targetKey } from './reactionsModel';

const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';
export const MAX_BATCH = 200; // targets per batch query, as in the forum

const extrasIdl = ({ IDL }) => {
    const ForumError = IDL.Variant({ NotFound: IDL.Text, Unauthorized: IDL.Text, InvalidInput: IDL.Text, AlreadyExists: IDL.Text, InternalError: IDL.Text });
    const Target = IDL.Variant({ post: IDL.Nat, thread: IDL.Nat });
    const NeuronId = IDL.Record({ id: IDL.Vec(IDL.Nat8) });
    const VoteType = IDL.Variant({ upvote: IDL.Null, downvote: IDL.Null });
    const NeuronVote = IDL.Record({ neuron_id: NeuronId, vote_type: VoteType, voting_power: IDL.Nat, created_at: IDL.Int, updated_at: IDL.Int });
    const ThreadTip = IDL.Record({
        id: IDL.Nat, from_principal: IDL.Principal, to_principal: IDL.Principal, thread_id: IDL.Nat, token_ledger_principal: IDL.Principal,
        amount: IDL.Nat, transaction_block_index: IDL.Opt(IDL.Nat), created_at: IDL.Int, verified: IDL.Opt(IDL.Bool), verification_note: IDL.Opt(IDL.Text),
    });
    const Res = (T) => IDL.Variant({ ok: T, err: ForumError });
    return IDL.Service({
        react: IDL.Func([Target, IDL.Text, IDL.Bool], [Res(IDL.Vec(IDL.Text))], []),
        set_reactions: IDL.Func([Target, IDL.Vec(IDL.Text)], [Res(IDL.Vec(IDL.Text))], []),
        get_reactions: IDL.Func([IDL.Vec(Target)], [IDL.Vec(IDL.Record({ target: Target, counts: IDL.Vec(IDL.Record({ emoji: IDL.Text, count: IDL.Nat })) }))], ['query']),
        get_reactions_of_user: IDL.Func([IDL.Principal, IDL.Vec(Target)], [IDL.Vec(IDL.Record({ target: Target, emojis: IDL.Vec(IDL.Text) }))], ['query']),
        vote_on_thread_with_neurons: IDL.Func([IDL.Nat, VoteType, IDL.Vec(NeuronId)], [Res(IDL.Null)], []),
        retract_thread_vote_with_neurons: IDL.Func([IDL.Nat, IDL.Vec(NeuronId)], [Res(IDL.Null)], []),
        get_thread_scores: IDL.Func([IDL.Vec(IDL.Nat)], [IDL.Vec(IDL.Record({ thread_id: IDL.Nat, upvote_score: IDL.Nat, downvote_score: IDL.Nat }))], ['query']),
        get_votes_on_thread_for_neurons: IDL.Func([IDL.Nat, IDL.Vec(NeuronId)], [IDL.Record({ thread_id: IDL.Nat, neuron_votes: IDL.Vec(NeuronVote) })], ['query']),
        create_thread_tip: IDL.Func([IDL.Principal, IDL.Nat, IDL.Principal, IDL.Nat, IDL.Opt(IDL.Nat)], [Res(IDL.Nat)], []),
        get_thread_tip: IDL.Func([IDL.Nat], [IDL.Opt(ThreadTip)], ['query']),
        get_tips_on_thread_page: IDL.Func([IDL.Nat, IDL.Opt(IDL.Nat), IDL.Nat], [IDL.Record({ items: IDL.Vec(ThreadTip), next: IDL.Opt(IDL.Nat) })], ['query']),
    });
};

const agents = new Map(); // one agent per identity (principal text), reused
async function agentFor(identity) {
    const key = identity ? identity.getPrincipal().toText() : 'anonymous';
    if (!agents.has(key)) {
        agents.set(key, (async () => {
            const agent = await HttpAgent.create({ host, ...(identity ? { identity } : {}) });
            if (isLocal) await agent.fetchRootKey();
            return agent;
        })());
    }
    return agents.get(key);
}

export const forumExtrasActor = async (identity) => Actor.createActor(extrasIdl, { agent: await agentFor(identity), canisterId: forumCanisterId });

/// Whether an error means this forum build does not have the method yet.
export const isMissingMethod = (e) => /has no (query|update) method|method not found|Canister has no/i.test(String(e?.message || e));

/// Reactions on targets, as Map(targetKey -> [{emoji, count}]), in batches of MAX_BATCH; null when
/// the forum has no reactions yet.
export async function loadReactionCounts(identity, targets) {
    const out = new Map();
    if (targets.length === 0) return out;
    try {
        const a = await forumExtrasActor(identity);
        for (let i = 0; i < targets.length; i += MAX_BATCH) {
            for (const r of await a.get_reactions(targets.slice(i, i + MAX_BATCH))) out.set(targetKey(r.target), r.counts);
        }
        return out;
    } catch (e) {
        if (isMissingMethod(e)) return null;
        throw e;
    }
}

/// The emojis `user` gave each target, as Map(targetKey -> [emoji]).
export async function loadMyReactions(identity, user, targets) {
    const out = new Map();
    if (!user || targets.length === 0) return out;
    try {
        const a = await forumExtrasActor(identity);
        for (let i = 0; i < targets.length; i += MAX_BATCH) {
            for (const r of await a.get_reactions_of_user(user, targets.slice(i, i + MAX_BATCH))) out.set(targetKey(r.target), r.emojis);
        }
    } catch (e) {
        if (!isMissingMethod(e)) throw e;
    }
    return out;
}
