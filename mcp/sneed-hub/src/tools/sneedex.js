// Sneedex marketplace (7bvk3-ryaaa-aaaal-qtykq-cai). Queries: getOfferFeed (paged, filtered),
// getOfferView (one offer with bids), getMarketStats.
import { z } from 'zod';
import { sneedexActor, toPrincipal, opt, ptext, HUB_URL, CANISTERS } from '../ic.js';
import { result, safe, variantKey, nsToIso, tokenInfo, formatUnits, toHex } from '../format.js';
import { namesOf, who } from './names.js';

const fmtAmount = async (amount, ledger) => {
  if (amount == null) return null;
  const t = await tokenInfo(ledger);
  return t.decimals != null ? `${formatUnits(amount, t.decimals)} ${t.symbol ?? ''}`.trim() : `${amount} base units of ${ptext(ledger)}`;
};

const assetView = async (entry) => {
  const k = variantKey(entry.asset);
  const a = entry.asset[k];
  const base = { escrowed: entry.escrowed };
  switch (k) {
    case 'ICRC1Token': return { type: 'ICRC-1 tokens', amount: await fmtAmount(a.amount, a.ledger_canister_id), ledger: ptext(a.ledger_canister_id), ...base };
    case 'Canister': return { type: 'canister', canister_id: ptext(a.canister_id), title: opt(a.title), description: opt(a.description), url: `${HUB_URL}/canister?id=${ptext(a.canister_id)}`, ...base };
    case 'SNSNeuron': {
      const stake = opt(a.cached_stake_e8s);
      return { type: 'SNS neuron', governance_canister_id: ptext(a.governance_canister_id), neuron_id: toHex(a.neuron_id.id), cached_stake_e8s: stake != null ? stake.toString() : null, ...base };
    }
    case 'ICRC7NFT': return { type: 'ICRC-7 NFTs', collection: ptext(a.collection_canister_id), token_ids: a.token_ids.map(String), ...base };
    case 'SneedLock': {
      const lk = variantKey(a.lock);
      const l = a.lock[lk];
      return lk === 'Token'
        ? { type: 'Sneed Lock token lock', lock_id: a.lock_id, amount: await fmtAmount(l.amount, l.ledger_canister_id), ledger: ptext(l.ledger_canister_id), lock_expiry: nsToIso(l.expiry), url: `${HUB_URL}/lock/${a.lock_id}`, ...base }
        : { type: 'Sneed Lock LP position lock', lock_id: a.lock_id, swap_canister_id: ptext(l.swap_canister_id), position_id: l.position_id, lock_expiry: nsToIso(l.expiry), url: `${HUB_URL}/lock/${a.lock_id}`, ...base };
    }
    default: return { type: k, ...base };
  }
};

const offerView = async (o, names) => {
  const state = variantKey(o.state);
  const t = await tokenInfo(o.price_token_ledger);
  const v = {
    id: o.id,
    state,
    creator: who(names, o.creator),
    assets: await Promise.all(o.assets.map(assetView)),
    price_token: { ledger: ptext(o.price_token_ledger), symbol: t.symbol },
    min_bid: await fmtAmount(opt(o.min_bid_price), o.price_token_ledger),
    buyout: await fmtAmount(opt(o.buyout_price), o.price_token_ledger),
    expires: nsToIso(opt(o.expiration)),
    created_at: nsToIso(o.created_at),
    activated_at: nsToIso(opt(o.activated_at)),
    private: opt(o.approved_bidders) != null,
    public_note: opt(o.public_note),
    url: `${HUB_URL}/sneedex_offer/${o.id}`,
  };
  if (state === 'Completed') v.completed = { at: nsToIso(o.state.Completed.completion_time), winning_bid_id: o.state.Completed.winning_bid_id };
  return v;
};

export function registerSneedexTools(server) {
  server.registerTool('sneedex_list_offers', {
    title: 'List Sneedex offers',
    description: `List public offers on the Sneedex marketplace (canister ${CANISTERS.sneedex}), newest first. Default: active offers. Uses getOfferFeed. Each offer lists its assets (canisters, SNS neurons, ICRC-1 tokens, ICRC-7 NFTs, Sneed Lock locks), escrow state, min bid / buyout in the offer's price token, and a link.`,
    inputSchema: {
      state: z.enum(['active', 'completed', 'any']).optional().describe('active (default), completed (sold, incl. claimed) or any'),
      creator: z.string().optional().describe('Only offers created by this principal'),
      limit: z.number().int().min(1).max(50).optional().describe('Page size (default 10)'),
      before_id: z.number().int().min(0).optional().describe('Page: offers with id below this (use next_before_id)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ state, creator, limit, before_id }) => {
    const ex = await sneedexActor();
    const st = state ?? 'active';
    // Sneedex matches states by tag (offerStateEquals), so Completed's record is a placeholder.
    const completed = { Completed: { completion_time: 0n, winning_bid_id: 0n } };
    const states = st === 'active' ? [[{ Active: null }]] : st === 'completed' ? [[completed, { Claimed: null }]] : [];
    const filter = {
      states,
      public_only: [true],
      creator: creator ? [toPrincipal(creator)] : [],
      asset_types: [],
      has_bids: [],
      viewer: [],
    };
    const length = BigInt(limit ?? 10);
    const page = await ex.getOfferFeed({ filter: [filter], length, start_id: before_id != null ? [BigInt(before_id)] : [] });
    const offers = page.offers;
    const names = await namesOf(offers.map((o) => o.creator));
    const stats = await ex.getMarketStats().catch(() => null);
    return result({
      market: stats ? { active_offers: stats.active_offers, completed_offers: stats.completed_offers, total_offers: stats.total_offers, total_bids: stats.total_bids } : undefined,
      count: offers.length,
      has_more: page.has_more,
      next_before_id: opt(page.next_start_id),
      sneed_hub_url: `${HUB_URL}/sneedex_offers`,
      offers: await Promise.all(offers.map((o) => offerView(o, names))),
    });
  }));

  server.registerTool('sneedex_get_offer', {
    title: 'Get a Sneedex offer',
    description: 'One Sneedex offer by id with its assets, terms, bids and highest bid. Uses getOfferView.',
    inputSchema: { offer_id: z.number().int().min(0).describe('Offer id') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ offer_id }) => {
    const ex = await sneedexActor();
    const view = opt(await ex.getOfferView(BigInt(offer_id)));
    if (!view) return result({ offer_id, found: false, note: 'No such offer (or it is private and not visible anonymously).' });
    const names = await namesOf([view.offer.creator, ...view.bids.map((b) => b.bidder)]);
    const bid = async (b) => ({ id: b.id, bidder: who(names, b.bidder), amount: await fmtAmount(b.amount, view.offer.price_token_ledger), state: variantKey(b.state), escrowed: b.tokens_escrowed, at: nsToIso(b.created_at) });
    const hb = opt(view.highest_bid);
    return result({
      offer: await offerView(view.offer, names),
      highest_bid: hb ? await bid(hb) : null,
      bids: await Promise.all(view.bids.map(bid)),
      how_to_bid: ['Open the offer link on Sneed Hub and log in.', 'Check that every asset shows as escrowed.', 'Enter a bid at or above the minimum (or use buyout) and confirm; your tokens are escrowed by Sneedex until the offer resolves, and refunded if you are outbid.'],
    });
  }));
}

