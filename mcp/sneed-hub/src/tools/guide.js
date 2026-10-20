// Guide, deep links and the cycles helper. No canister calls except validating ids.
import { z } from 'zod';
import { HUB_URL, CANISTERS, toPrincipal } from '../ic.js';
import { result, safe } from '../format.js';
import { GOALS, FEATURES, featureById } from '../data/routes.js';

const SAFETY = 'Sneed Hub never needs your seed phrase or private keys; you sign actions yourself after logging in. On-chain actions are public and linked to your principal.';

const PARAM_DESCRIPTIONS = {
  ledger: 'ICRC-1 ledger canister id', canister: 'canister id', principal: 'principal', lock: 'Sneed Lock lock id', offer: 'Sneedex offer id',
  topic: 'forum topic id', thread: 'forum thread id', post: 'forum post id', proposal: 'proposal id', neuron: 'neuron id (hex)',
  sns: 'SNS root canister id (default Sneed DAO)', collection: 'ICRC-7 collection canister id', token_id: 'NFT token id', swap: 'ICPSwap pool canister id',
  input: 'input token ledger', output: 'output token ledger', tx: 'transaction (block) index', appId: 'Sneedapp app id', publisherId: 'Sneedapp publisher id',
  lock_type: '"token" or "position"', slug: 'API doc slug',
};

const SNS_DEFAULT_FEATURES = new Set(['proposal', 'proposals', 'thread', 'topic', 'neuron', 'neurons']);

/// URL of a feature with the given params; { url, missing } where missing lists absent path params.
export const buildLink = (f, params = {}) => {
  const p = { ...params };
  if (SNS_DEFAULT_FEATURES.has(f.id) && !p.sns) p.sns = CANISTERS.sneed_sns_root;
  const missing = [];
  let path = f.path.replace(/:([A-Za-z_]+)/g, (_, k) => {
    if (p[k] == null || p[k] === '') { missing.push(k); return `:${k}`; }
    return encodeURIComponent(String(p[k]));
  });
  if (missing.length && f.id === 'token_studio') { path = '/studio'; missing.length = 0; }
  const q = Object.entries(f.query ?? {}).filter(([, k]) => p[k] != null && p[k] !== '').map(([qk, k]) => `${qk}=${encodeURIComponent(String(p[k]))}`);
  return { url: `${HUB_URL}${path}${q.length ? `?${q.join('&')}` : ''}`, missing };
};

const featureLine = (f) => ({
  id: f.id,
  title: f.title,
  url: buildLink(f).missing.length ? `${HUB_URL}${f.path}` : buildLink(f).url,
  needs: f.params?.length ? f.params : undefined,
  sign_in: f.signIn ? true : undefined,
  summary: f.summary,
});

// Free-text matching for sneed_hub_link: score features by words in title/summary/id.
const findFeatures = (text) => {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const scored = FEATURES.map((f) => {
    const hay = `${f.id} ${f.title} ${f.summary ?? ''} ${f.goal}`.toLowerCase();
    let s = 0;
    for (const w of words) if (hay.includes(w)) s += f.title.toLowerCase().includes(w) || f.id.includes(w) ? 3 : 1;
    return [s, f];
  }).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]);
  return scored.map(([, f]) => f);
};

export function registerGuideTools(server) {
  server.registerTool('sneed_hub_guide', {
    title: 'What can I do on Sneed Hub?',
    description: 'Everything a user can do on Sneed Hub (Sneed DAO\'s app on the Internet Computer), organised by goal, with links. Pass a goal id to see only that goal. Each entry gives a feature id to use with sneed_hub_link.',
    inputSchema: { goal: z.enum(GOALS.map((g) => g.id)).optional().describe('Only this goal') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, safe(async ({ goal }) => {
    const goals = GOALS.filter((g) => !goal || g.id === goal);
    return result({
      site: HUB_URL,
      about: 'Sneed Hub is the web app of Sneed DAO, a DAO on the Internet Computer governed by SNEED neuron holders. It offers a wallet, Sneed Lock (time-locking tokens and liquidity), the Sneedex marketplace, SNS governance and forum, liquid staking, app canisters and tools.',
      safety: SAFETY,
      goals: goals.map((g) => ({ goal: g.id, title: g.title, features: FEATURES.filter((f) => f.goal === g.id).map(featureLine) })),
      next: 'Call sneed_hub_link with a feature id (and params) for the exact link and step-by-step instructions.',
    });
  }));

  server.registerTool('sneed_hub_link', {
    title: 'Sneed Hub link and steps',
    description: 'Get the exact Sneed Hub URL and step-by-step instructions for a goal or feature, so the user can do it themselves. Give a feature id from sneed_hub_guide (e.g. lock_create, sneedex_offer, proposal, thread, principal, token_safety) or free text (e.g. "lock my LP position"), plus any params. This server never performs actions.',
    inputSchema: {
      feature: z.string().describe('Feature id from sneed_hub_guide, or a short description of the goal'),
      ledger: z.string().optional(), canister: z.string().optional(), principal: z.string().optional(),
      lock: z.union([z.string(), z.number()]).optional(), offer: z.union([z.string(), z.number()]).optional(),
      topic: z.union([z.string(), z.number()]).optional(), thread: z.union([z.string(), z.number()]).optional(),
      post: z.union([z.string(), z.number()]).optional(), proposal: z.union([z.string(), z.number()]).optional(),
      neuron: z.string().optional(), sns: z.string().optional().describe('SNS root canister id (default Sneed DAO)'),
      collection: z.string().optional(), token_id: z.union([z.string(), z.number()]).optional(), swap: z.string().optional(),
      input: z.string().optional(), output: z.string().optional(), tx: z.union([z.string(), z.number()]).optional(),
      appId: z.string().optional(), publisherId: z.string().optional(), lock_type: z.enum(['token', 'position']).optional(), slug: z.string().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, safe(async ({ feature, ...params }) => {
    for (const k of ['ledger', 'canister', 'principal', 'collection', 'swap', 'sns', 'input', 'output']) {
      if (params[k]) toPrincipal(params[k], PARAM_DESCRIPTIONS[k]);
    }
    let f = featureById.get(feature.trim());
    let alternatives = [];
    if (!f) {
      const found = findFeatures(feature);
      if (!found.length) return result({ found: false, note: `No Sneed Hub feature matches "${feature}". Call sneed_hub_guide to see everything.`, site: HUB_URL });
      [f, ...alternatives] = found;
    }
    const { url, missing } = buildLink(f, params);
    return result({
      feature: f.id,
      title: f.title,
      url: missing.length ? null : url,
      missing_params: missing.length ? missing.map((k) => `${k}: ${PARAM_DESCRIPTIONS[k] ?? k}`) : undefined,
      sign_in_required: Boolean(f.signIn),
      summary: f.summary,
      steps: f.steps ?? [
        ...(f.signIn ? ['Log in to Sneed Hub (top-right).'] : []),
        `Open ${missing.length ? `${HUB_URL}${f.path} (fill in ${missing.join(', ')})` : url}.`,
        'Follow the on-page instructions; review every amount and confirmation dialog before approving.',
      ],
      safety: SAFETY,
      other_matches: alternatives.slice(0, 4).map((a) => ({ id: a.id, title: a.title })),
    });
  }));

  server.registerTool('cycles_top_up_help', {
    title: 'How to top up a canister with cycles',
    description: 'How to top up an Internet Computer canister with cycles from Sneed Hub: with ICP (converted by the Cycles Minting Canister), with ck-USDC (through CyclePay), or by card / Apple Pay / Google Pay (CyclePay checkout). Returns links and steps; performs nothing.',
    inputSchema: { canister: z.string().optional().describe('Canister id to top up') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, safe(async ({ canister }) => {
    const id = canister ? toPrincipal(canister, 'canister id').toText() : null;
    const page = id ? `${HUB_URL}/canister?id=${id}` : `${HUB_URL}/apps`;
    return result({
      canister: id,
      sneed_hub_page: page,
      note: 'Anyone can top up any canister; topping up gives no control over it. Cycles cannot be withdrawn back to tokens.',
      options: [
        {
          method: 'ICP (via the Cycles Minting Canister)',
          where: id ? page : `${HUB_URL}/apps`,
          steps: [
            'Log in to Sneed Hub with ICP in your wallet.',
            id ? `Open ${page} and use its "Top Up with Cycles" section; or, for canisters you track, open ${HUB_URL}/apps (or the Wallet) and use the top-up cycles dialog.` : `Open ${HUB_URL}/apps (or the Wallet) and use the top-up cycles dialog, or open /canister?id=<canister> and its "Top Up with Cycles" section.`,
            'Choose "Pay with ICP", enter the amount (the dialog can also bring several canisters to a target cycle level) and confirm.',
            `Sneed Hub sends the ICP to the Cycles Minting Canister (${CANISTERS.cmc}) and calls notify_top_up, which mints cycles to the canister.`,
          ],
        },
        {
          method: 'ck-USDC (via CyclePay)',
          where: `${HUB_URL}/apps`,
          steps: [
            'Log in with ck-USDC in your wallet.',
            `Open the shared top-up dialog (${HUB_URL}/apps, the Wallet or the header menu) and choose "Pay with ck-USDC".`,
            `Approve CyclePay (${CANISTERS.cyclepay}) for the amount plus fee; CyclePay pulls the ck-USDC (ledger ${CANISTERS.ckusdc_ledger}) and delivers cycles at the protocol price.`,
          ],
        },
        {
          method: 'Card, Apple Pay or Google Pay (CyclePay checkout)',
          where: id ? `https://www.cyclepay.org/c/${id}/5` : 'the "Pay by card" link on a canister page',
          steps: [
            'No login needed.',
            id ? `Open https://www.cyclepay.org/c/${id}/<usd> (5 to 100 USD), or the card link on ${page}.` : 'Open a canister page on Sneed Hub (/canister?id=<canister>) and click the card top-up link.',
            'Pay in the Stripe checkout (card fee 2.9% + $0.30); the cycles go straight to the canister.',
          ],
        },
      ],
    });
  }));
}
