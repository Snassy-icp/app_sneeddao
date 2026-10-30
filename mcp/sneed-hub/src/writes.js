// The write-tool framework. Every write tool is a { build, run } pair:
//   build(args, ctx) -> plan   reads chain state and describes the exact calls and spends
//   run(args, ctx, plan) -> outcome   performs the calls (only after a valid confirmation)
// defineWrite registers the tool with a `confirm` argument and the preview/confirm protocol of
// safety.js, and writes an audit line for every executed write.
import { z } from 'zod';
import { WriteGuard } from './safety.js';
import { settings } from './config.js';
import { activeIdentity } from './identity.js';
import { signedActor, actor, CANISTERS, ptext, managementActor, canisterInfo } from './ic.js';
import { plain, shortErr, formatUnits } from './format.js';

let guard = null;
export const getGuard = () => {
  if (!guard) {
    const s = settings();
    guard = new WriteGuard({ caps: s.caps, allowTransfers: s.allowTransfers, spendPath: s.spendPath, auditPath: s.auditPath });
  }
  return guard;
};
export const setGuard = (g) => { guard = g; };

/// Readable name of a canister id ("sneedex (7bvk3-…)").
export const canisterLabel = (id) => {
  const t = ptext(id);
  const name = Object.entries(CANISTERS).find(([, v]) => v === t)?.[0];
  return name ? `${name} (${t})` : t;
};

/// The default context: the active identity and signed actors for it.
let ctxFactory = () => {
  const who = activeIdentity();
  return {
    who,
    principal: who.principal,
    signed: (idl, id) => signedActor(idl, id, who.identity),
    management: (target) => managementActor(who.identity, target),
    canisterInfo: (id) => canisterInfo(id),
    anon: (idl, id) => actor(idl, ptext(id)),
  };
};
export const setContextFactory = (f) => { ctxFactory = f; };
export const makeContext = () => ctxFactory();

const compact = (v) => {
  const s = JSON.stringify(plain(v));
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
};

/// The preview text of a plan.
export const previewText = (tool, plan, issued, problems, g) => {
  const lines = [];
  lines.push(`PREVIEW of ${tool}: nothing has been sent yet.`);
  lines.push(`Signer: ${plan.signerLabel}`);
  if (plan.summary) lines.push(`What: ${plan.summary}`);
  lines.push('Calls, in order:');
  plan.calls.forEach((c, i) => lines.push(`  ${i + 1}. ${canisterLabel(c.canister)} . ${c.method}(${compact(c.args)})${c.note ? `  -- ${c.note}` : ''}`));
  if (plan.spends?.length) {
    lines.push('Spends (incl. ledger fees):');
    for (const sp of plan.spends) {
      const cap = g.capFor(sp);
      const spent = g.spentToday(sp.ledger);
      const amt = sp.decimals != null ? `${formatUnits(sp.amount, sp.decimals)} ${sp.symbol ?? ''}` : `${sp.amount} base units`;
      const capText = cap == null ? 'no cap configured' : `today ${formatUnits(spent, sp.decimals)} of the ${formatUnits(cap, sp.decimals)} ${sp.symbol ?? ''} daily cap used`;
      lines.push(`  - ${amt.trim()} on ${sp.ledger}: ${sp.what}${sp.to ? ` -> ${sp.to}` : ''} (${capText})`);
    }
  } else lines.push('Spends: none (no tokens leave the account, apart from what is listed above).');
  for (const n of plan.notes ?? []) lines.push(`Note: ${n}`);
  if (problems.length) {
    lines.push('BLOCKED (fix these first; confirming will fail):');
    for (const p of problems) lines.push(`  - ${p}`);
  }
  lines.push(`On-chain actions are public and tied to ${plan.principal}.`);
  if (issued) lines.push(`To execute, call ${tool} again with exactly the same arguments plus confirm: "${issued.token}" (single use, valid until ${issued.expires}). Ask the user first.`);
  else lines.push('No confirmation token was issued because the write is blocked; fix the problems above and call again without confirm.');
  return lines.join('\n');
};

const text = (t, isError = false) => ({ ...(isError ? { isError: true } : {}), content: [{ type: 'text', text: t }] });

/// Run a write tool's protocol for one call (exported for tests).
export const handleWrite = async (spec, args) => {
  const g = getGuard();
  const { confirm, ...input } = args ?? {};
  let ctx;
  try {
    ctx = makeContext();
  } catch (e) {
    return text(`Error: no signing identity: ${shortErr(e)}`, true);
  }
  let plan;
  try {
    plan = await spec.build(input, ctx);
  } catch (e) {
    return text(`Error: ${shortErr(e)}`, true);
  }
  plan.principal = ctx.principal;
  plan.signerLabel = ctx.who?.label ?? ctx.principal;
  plan.spends ??= [];
  plan.calls ??= [];
  // In act-as-me mode the replica refuses calls outside the delegation's targets; say so up front.
  const problems = [...(plan.problems ?? []), ...g.checkSpends(plan)];
  const targets = ctx.who?.mode === 'delegation' ? ctx.who.targets : null;
  if (targets) {
    const outside = [...new Set(plan.calls.map((c) => ptext(c.canister)).filter((c) => !targets.includes(c)))];
    if (outside.length) problems.push(`Your Sneed Hub delegation does not cover ${outside.map(canisterLabel).join(', ')}. Reconnect (connect_as_me) and tick a wider scope, or disconnect to use the agent's own identity.`);
  }
  if (!confirm) {
    // a blocked plan gets no token: fix the problem and preview again
    const issued = problems.length ? null : g.issue(spec.name, input, plan);
    return text(previewText(spec.name, plan, issued, problems, g));
  }
  try {
    if (problems.length) throw new Error(problems.join('\n'));
    g.consume(spec.name, input, confirm, plan);
  } catch (e) {
    // a refused confirmation is audited too (never the token itself): it may be a replay or a
    // confirm sent after the user's arguments or the chain changed
    g.audit({ tool: spec.name, principal: ctx.principal, mode: ctx.who?.mode, input, refused: e.message, calls: plan.calls, spends: plan.spends });
    return text(`Not executed: ${e.message}`, true);
  }
  let outcome;
  try {
    outcome = await spec.run(input, ctx, plan);
  } catch (e) {
    outcome = { ok: false, error: shortErr(e), steps: e.steps };
  }
  // A spend counts once its transfer went out, even when a later step failed.
  if (outcome.ok || outcome.spent) g.recordSpends(plan);
  g.audit({ tool: spec.name, principal: ctx.principal, mode: ctx.who?.mode, input, calls: plan.calls, spends: plan.spends, outcome });
  const lines = [outcome.ok ? `Done: ${outcome.summary ?? spec.name}` : `FAILED: ${outcome.error ?? 'unknown error'}`];
  for (const s of outcome.steps ?? []) lines.push(`  - ${s}`);
  if (outcome.recovery) lines.push(`Recovery: ${outcome.recovery}`);
  for (const l of outcome.links ?? []) lines.push(l);
  return text(lines.join('\n'), !outcome.ok);
};

/// Register a write tool.
export const defineWrite = (server, spec) => {
  server.registerTool(spec.name, {
    title: spec.title,
    description: `${spec.description}\nWRITE TOOL, two steps: without \`confirm\` it returns a preview (exact canister calls, amounts, fees) and a one-time token; call again with the same arguments and confirm: <token> to execute. Always show the preview to the user and get their OK first.`,
    inputSchema: { ...spec.inputSchema, confirm: z.string().optional().describe('Confirmation token from the preview of this exact call') },
    annotations: { readOnlyHint: false, destructiveHint: Boolean(spec.destructive), openWorldHint: true },
  }, (args) => handleWrite(spec, args));
};

/// Helper for run(): call a canister method and turn {ok|Ok|err|Err} into a value or a throw.
export const unwrapResult = (r, what) => {
  if (r && typeof r === 'object') {
    if ('ok' in r) return r.ok;
    if ('Ok' in r) return r.Ok;
    if ('err' in r) throw new Error(`${what}: ${JSON.stringify(plain(r.err))}`);
    if ('Err' in r) throw new Error(`${what}: ${JSON.stringify(plain(r.Err))}`);
  }
  return r;
};
