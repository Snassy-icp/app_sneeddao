// SNS governance (Sneed DAO: fi3zi-fyaaa-aaaaq-aachq-cai; any SNS governance canister works).
// Queries: list_proposals, get_proposal, list_nervous_system_functions.
import { z } from 'zod';
import { snsGovernanceActor, toPrincipal, opt, CANISTERS, HUB_URL } from '../ic.js';
import { result, safe, secToIso, formatUnits } from '../format.js';

// ProposalDecisionStatus in SNS governance.
const STATUS_CODES = { open: 1, rejected: 2, adopted: 3, executed: 4, failed: 5 };

const fnCache = new Map();
const functionNames = async (gov, govId) => {
  if (!fnCache.has(govId)) {
    fnCache.set(govId, gov.list_nervous_system_functions().then((r) => new Map(r.functions.map((f) => [f.id.toString(), f.name]))).catch(() => new Map()));
  }
  return fnCache.get(govId);
};

const bp = (pct) => {
  const p = opt(pct);
  const b = p ? opt(p.basis_points) : null;
  return b != null ? BigInt(b) : null;
};

const statusOf = (p) => {
  const decided = BigInt(p.decided_timestamp_seconds);
  if (BigInt(p.executed_timestamp_seconds) > 0n) return 'executed';
  if (BigInt(p.failed_timestamp_seconds) > 0n) return 'failed';
  if (decided === 0n) return 'open';
  const t = opt(p.latest_tally);
  if (!t) return 'decided';
  const yes = BigInt(t.yes), no = BigInt(t.no), total = BigInt(t.total);
  const ofExercised = bp(p.minimum_yes_proportion_of_exercised) ?? 5000n;
  const ofTotal = bp(p.minimum_yes_proportion_of_total) ?? 300n;
  const adopted = yes * 10000n > (yes + no) * ofExercised && yes * 10000n >= total * ofTotal;
  return adopted ? 'adopted (awaiting execution)' : 'rejected';
};

const pct = (x, total) => (total > 0n ? `${(Number((x * 10000n) / total) / 100).toFixed(2)}%` : '0%');

const proposalView = (p, fns, snsRoot, { full = false } = {}) => {
  const prop = opt(p.proposal);
  const t = opt(p.latest_tally);
  const wfq = opt(p.wait_for_quiet_state);
  const id = opt(p.id)?.id;
  const yes = t ? BigInt(t.yes) : 0n, no = t ? BigInt(t.no) : 0n, total = t ? BigInt(t.total) : 0n;
  const v = {
    id,
    title: prop?.title ?? null,
    type: fns.get(p.action.toString()) ?? `action ${p.action}`,
    status: statusOf(p),
    created_at: secToIso(p.proposal_creation_timestamp_seconds),
    voting_deadline: wfq ? secToIso(wfq.current_deadline_timestamp_seconds) : secToIso(BigInt(p.proposal_creation_timestamp_seconds) + BigInt(p.initial_voting_period_seconds)),
    decided_at: secToIso(p.decided_timestamp_seconds),
    executed_at: secToIso(p.executed_timestamp_seconds),
    tally: t ? {
      yes: `${formatUnits(yes, 8)} voting power (${pct(yes, total)} of total)`,
      no: `${formatUnits(no, 8)} voting power (${pct(no, total)} of total)`,
      total_voting_power: formatUnits(total, 8),
      yes_share_of_votes_cast: pct(yes, yes + no),
    } : null,
    proposer_neuron: opt(p.proposer) ? Buffer.from(opt(p.proposer).id).toString('hex') : null,
    url: `${HUB_URL}/proposal?proposalid=${id}&sns=${snsRoot}`,
  };
  if (full) {
    v.summary = prop?.summary ?? null;
    v.url_in_proposal = prop?.url || null;
    v.payload = p.payload_text_rendering?.[0]?.slice(0, 6000) ?? null;
    v.failure_reason = opt(p.failure_reason)?.error_message ?? null;
    v.ballots = p.ballots.length;
  } else {
    v.summary_preview = prop?.summary ? (prop.summary.length > 280 ? `${prop.summary.slice(0, 280)}…` : prop.summary) : null;
  }
  return v;
};

const govArg = z.string().optional().describe('SNS governance canister id (default Sneed DAO, fi3zi-fyaaa-aaaaq-aachq-cai)');
const rootArg = z.string().optional().describe('SNS root canister id for the Sneed Hub link (default Sneed DAO, fp274-iaaaa-aaaaq-aacha-cai)');

export function registerGovernanceTools(server) {
  server.registerTool('sneed_dao_proposals', {
    title: 'List Sneed DAO proposals',
    description: 'Recent proposals of Sneed DAO (or another SNS), newest first, with status, type, deadline and tally (voting power, not token price). Uses list_proposals.',
    inputSchema: {
      status: z.enum(['open', 'adopted', 'executed', 'rejected', 'failed', 'any']).optional().describe('Filter by decision status (default any)'),
      limit: z.number().int().min(1).max(50).optional().describe('How many (default 10)'),
      before_id: z.number().int().min(1).optional().describe('Page: proposals with id below this'),
      governance: govArg,
      sns_root: rootArg,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ status, limit, before_id, governance, sns_root }) => {
    const govId = governance ?? CANISTERS.sneed_sns_governance;
    const root = sns_root ?? (govId === CANISTERS.sneed_sns_governance ? CANISTERS.sneed_sns_root : '');
    const gov = await snsGovernanceActor(toPrincipal(govId, 'governance canister id'));
    const res = await gov.list_proposals({
      limit: limit ?? 10,
      before_proposal: before_id ? [{ id: BigInt(before_id) }] : [],
      exclude_type: [],
      include_status: status && status !== 'any' ? [STATUS_CODES[status]] : [],
      include_reward_status: [],
      include_topics: [],
    });
    const fns = await functionNames(gov, govId);
    const proposals = res.proposals.map((p) => proposalView(p, fns, root));
    return result({
      governance: govId,
      count: proposals.length,
      next_before_id: proposals.length ? proposals[proposals.length - 1].id : null,
      sneed_hub_url: `${HUB_URL}/proposals${root ? `?sns=${root}` : ''}`,
      how_to_vote: 'Open a proposal link, log in with a principal that is a hotkey or controller of your SNEED neurons, and vote. Votes are public.',
      proposals,
    });
  }));

  server.registerTool('sneed_dao_proposal', {
    title: 'Get a Sneed DAO proposal',
    description: 'One SNS proposal with its summary, payload, status and tally. Uses get_proposal.',
    inputSchema: { proposal_id: z.number().int().min(1).describe('Proposal id'), governance: govArg, sns_root: rootArg },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ proposal_id, governance, sns_root }) => {
    const govId = governance ?? CANISTERS.sneed_sns_governance;
    const root = sns_root ?? (govId === CANISTERS.sneed_sns_governance ? CANISTERS.sneed_sns_root : '');
    const gov = await snsGovernanceActor(toPrincipal(govId, 'governance canister id'));
    const res = await gov.get_proposal({ proposal_id: [{ id: BigInt(proposal_id) }] });
    const r = opt(res.result);
    if (!r) return result({ proposal_id, found: false });
    if ('Error' in r) return result({ proposal_id, found: false, error: r.Error.error_message });
    return result(proposalView(r.Proposal, await functionNames(gov, govId), root, { full: true }));
  }));
}
