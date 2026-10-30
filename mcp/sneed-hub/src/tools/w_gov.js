// Write tools: vote with SNS neurons and submit motion proposals, through neurons on which the
// signing principal has the Vote (4) / Submit proposal (3) permission (a hotkey has both).
// Mirrors components/HotkeyNeurons.jsx (RegisterVote) and governance/neurons.js (MakeProposal,
// proposerNeurons).
import { z } from 'zod';
import { idlFactory as govIdl } from '../idl/sns_governance.did.js';
import { CANISTERS, opt, toPrincipal, ptext } from '../ic.js';
import { defineWrite } from '../writes.js';
import { toHex, fromHex, link } from '../chain.js';
import { formatUnits, shortErr } from '../format.js';

export const PERM = { SUBMIT_PROPOSAL: 3, VOTE: 4 };

/// Neurons of `principal` in an SNS where it holds `perm`, mirroring NeuronUtils.fetchUserNeuronsForSns
/// for the direct part (neurons that list the principal).
export const neuronsWithPermission = async (gov, principal, perm) => {
  const res = await gov.list_neurons({ of_principal: [toPrincipal(principal)], limit: 100, start_page_at: [] });
  return res.neurons.filter((n) => n.permissions.some((p) => ptext(opt(p.principal)) === ptext(principal) && p.permission_type.includes(perm)));
};
export const neuronIdHex = (n) => toHex(opt(n.id).id);

/// Proposal still accepts votes (utils/ProposalUtils.js isProposalAcceptingVotes).
export const acceptingVotes = (p, nowS = Math.floor(Date.now() / 1000)) => {
  const wfq = opt(p.wait_for_quiet_state);
  const deadline = wfq ? Number(wfq.current_deadline_timestamp_seconds) : Number(p.proposal_creation_timestamp_seconds) + Number(p.initial_voting_period_seconds);
  return nowS < deadline;
};

/// Neurons that can still vote on a proposal: a ballot exists (eligible at creation) and is uncast.
export const votableNeurons = (proposal, neurons) => {
  const ballots = new Map(proposal.ballots.map(([id, b]) => [id, b]));
  return neurons.filter((n) => {
    const b = ballots.get(neuronIdHex(n));
    return b && BigInt(b.cast_timestamp_seconds) === 0n;
  });
};

const govArg = z.string().optional().describe(`SNS governance canister id (default Sneed DAO ${CANISTERS.sneed_sns_governance})`);

export const govWrites = [
  {
    name: 'sns_vote',
    title: 'Vote on an SNS proposal',
    description: 'Vote yes/no on an open SNS proposal (Sneed DAO by default) with every neuron on which the signing principal has the Vote permission and that has not voted yet (or the listed neuron ids): one manage_neuron RegisterVote per neuron (vote 1 = yes, 2 = no). Votes are public and final.',
    inputSchema: {
      proposal_id: z.number().int().min(1).describe('Proposal id'),
      vote: z.enum(['yes', 'no']).describe('yes (adopt) or no (reject)'),
      neuron_ids: z.array(z.string()).optional().describe('Only these neurons (hex ids); default all votable ones'),
      governance: govArg,
    },
    destructive: true,
    async build({ proposal_id, vote, neuron_ids, governance }, ctx) {
      const govId = governance ?? CANISTERS.sneed_sns_governance;
      const gov = await ctx.anon(govIdl, govId);
      const pr = opt((await gov.get_proposal({ proposal_id: [{ id: BigInt(proposal_id) }] })).result);
      if (!pr || 'Error' in pr) throw new Error(`No proposal ${proposal_id}.`);
      const p = pr.Proposal;
      const mine = await neuronsWithPermission(gov, ctx.principal, PERM.VOTE);
      let can = votableNeurons(p, mine);
      if (neuron_ids?.length) can = can.filter((n) => neuron_ids.map((x) => x.toLowerCase()).includes(neuronIdHex(n)));
      const problems = [];
      if (!acceptingVotes(p)) problems.push('Voting on this proposal has ended.');
      if (!mine.length) problems.push(`${ctx.principal} has the Vote permission on no neuron of this SNS. Add it as a hotkey on your neuron on Sneed Hub (${link('/neurons')}).`);
      else if (!can.length) problems.push('None of your neurons can vote on it (already voted, or not eligible when the proposal was made).');
      return {
        summary: `Vote ${vote.toUpperCase()} on proposal ${proposal_id} ("${opt(p.proposal)?.title ?? ''}") with ${can.length} neuron(s)`,
        calls: can.map((n) => ({ canister: govId, method: 'manage_neuron', args: { subaccount: neuronIdHex(n), command: [{ RegisterVote: { vote: vote === 'yes' ? 1 : 2, proposal: [{ id: proposal_id }] } }] } })),
        notes: ['Votes are public and cannot be changed.'],
        problems,
      };
    },
    async run({ proposal_id }, ctx, plan) {
      const steps = [];
      let okCount = 0;
      for (const c of plan.calls) {
        const gov = await ctx.signed(govIdl, c.canister);
        const cmd = c.args.command[0].RegisterVote;
        try {
          const r = await gov.manage_neuron({ subaccount: fromHex(c.args.subaccount), command: [{ RegisterVote: { vote: cmd.vote, proposal: [{ id: BigInt(proposal_id) }] } }] });
          const res = opt(r.command);
          if (res && 'Error' in res) steps.push(`neuron ${c.args.subaccount.slice(0, 12)}…: ${res.Error.error_message}`);
          else { okCount += 1; steps.push(`neuron ${c.args.subaccount.slice(0, 12)}…: voted`); }
        } catch (e) { steps.push(`neuron ${c.args.subaccount.slice(0, 12)}…: ${shortErr(e)}`); }
      }
      return { ok: okCount > 0, summary: `${okCount} of ${plan.calls.length} neuron(s) voted`, error: okCount ? undefined : 'no vote was registered', steps, links: [link(`/proposal?proposalid=${proposal_id}&sns=${CANISTERS.sneed_sns_root}`)] };
    },
  },
  {
    name: 'sns_make_motion_proposal',
    title: 'Submit a motion proposal',
    description: 'Submit a Motion proposal to Sneed DAO (or another SNS) from a neuron on which the signing principal has the Submit proposal permission, with enough stake to cover the reject cost (lost if the proposal is rejected) and the minimum dissolve delay (manage_neuron MakeProposal { Motion }). Public.',
    inputSchema: {
      title: z.string().min(5).max(256).describe('Title'),
      summary: z.string().min(1).max(29000).describe('Summary (markdown)'),
      motion_text: z.string().min(1).max(10000).describe('The motion text: what the DAO resolves'),
      url: z.string().max(2000).optional().describe('Optional URL (e.g. the forum thread)'),
      neuron_id: z.string().optional().describe('Proposing neuron (hex); default the eligible one with the largest stake'),
      governance: govArg,
    },
    destructive: true,
    // TODO(sneed_proxy): proposals that change admin settings go through the sneed_proxy GNSFs
    // (spec/sneed_proxy.md): ExecuteGenericNervousSystemFunction { function_id: <topic-class GNSF>,
    // payload: candid of the proxied call }. Add a sns_make_proxy_proposal tool here that builds the
    // payload with the target's IDL and previews it decoded, once the proxy is deployed.
    async build({ title, summary, motion_text, url, neuron_id, governance }, ctx) {
      const govId = governance ?? CANISTERS.sneed_sns_governance;
      const gov = await ctx.anon(govIdl, govId);
      const [params, mine] = await Promise.all([gov.get_nervous_system_parameters(null), neuronsWithPermission(gov, ctx.principal, PERM.SUBMIT_PROPOSAL)]);
      const rejectCost = BigInt(opt(params.reject_cost_e8s) ?? 0n);
      const minDelay = BigInt(opt(params.neuron_minimum_dissolve_delay_to_vote_seconds) ?? 0n);
      const nowS = BigInt(Math.floor(Date.now() / 1000));
      const delayOf = (n) => {
        const d = opt(n.dissolve_state);
        if (!d) return 0n;
        if ('DissolveDelaySeconds' in d) return BigInt(d.DissolveDelaySeconds);
        const w = BigInt(d.WhenDissolvedTimestampSeconds);
        return w > nowS ? w - nowS : 0n;
      };
      const stake = (n) => BigInt(n.cached_neuron_stake_e8s) - BigInt(n.neuron_fees_e8s);
      let eligible = mine.filter((n) => delayOf(n) >= minDelay && stake(n) > rejectCost).sort((a, b) => (stake(b) > stake(a) ? 1 : -1));
      if (neuron_id) eligible = eligible.filter((n) => neuronIdHex(n) === neuron_id.toLowerCase());
      const n = eligible[0];
      const problems = [];
      if (!n) problems.push(mine.length ? 'None of your neurons with Submit permission has enough stake (above the reject cost) and dissolve delay.' : `${ctx.principal} has the Submit proposal permission on no neuron here. Add it as a hotkey on your neuron (${link('/neurons')}).`);
      return {
        summary: `Motion proposal "${title}" from neuron ${n ? `${neuronIdHex(n).slice(0, 16)}…` : '(none)'}`,
        calls: n ? [{ canister: govId, method: 'manage_neuron', args: { subaccount: neuronIdHex(n), command: [{ MakeProposal: { title, url: url ?? '', summary, action: [{ Motion: { motion_text } }] } }] } }] : [],
        notes: [`If the proposal is rejected the neuron loses the reject cost of ${formatUnits(rejectCost, 8)} tokens (from its stake, no transfer now).`, 'Proposals are public.'],
        problems,
      };
    },
    async run(args, ctx, plan) {
      const c = plan.calls[0];
      const gov = await ctx.signed(govIdl, c.canister);
      const mp = c.args.command[0].MakeProposal;
      const r = await gov.manage_neuron({ subaccount: fromHex(c.args.subaccount), command: [{ MakeProposal: { title: mp.title, url: mp.url, summary: mp.summary, action: [{ Motion: { motion_text: mp.action[0].Motion.motion_text } }] } }] });
      const res = opt(r.command);
      if (!res || 'Error' in res) return { ok: false, error: res ? res.Error.error_message : 'no answer' };
      const id = opt(res.MakeProposal.proposal_id)?.id;
      return { ok: true, summary: `proposal ${id} submitted`, links: [link(`/proposal?proposalid=${id}&sns=${c.canister === CANISTERS.sneed_sns_governance ? CANISTERS.sneed_sns_root : ''}`)] };
    },
  },
];

export const registerGovWrites = (server) => govWrites.forEach((w) => defineWrite(server, w));
