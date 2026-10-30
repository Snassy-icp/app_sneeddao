// Write tools for Sneedex: bid, buyout, and create an offer (ICRC-7 NFTs, EXT NFTs, ICRC-1 tokens).
// Mirrors pages/SneedexOffer.jsx (handlePlaceBid / handleBuyout) and pages/SneedexCreate.jsx
// (fetchFeeInfo, handleCreate, escrowNftAsset, escrowTokenAsset) with utils/SneedexExt.js for EXT.
import { z } from 'zod';
import { idlFactory as sneedexIdl } from '../idl/sneedex.did.js';
import { idlFactory as icrc1Idl } from '../idl/icrc1_ledger.did.js';
import { idlFactory as icrc7Idl } from '../idl/icrc7.did.js';
import { CANISTERS, opt, toPrincipal, ptext } from '../ic.js';
import { defineWrite } from '../writes.js';
import { spend, toBaseUnits, ledgerFee, fmt, link, accountId, extTokenIdentifier, extIdlFactory, toHex, balanceProblems } from '../chain.js';
import { tokenInfo, plain, shortErr } from '../format.js';
import { specialPricesFor, effectivePrice, premiumStatus } from '../prices.js';

const sxErr = (e) => { const k = Object.keys(e)[0]; const v = e[k]; return v == null ? k : `${k}: ${typeof v === 'object' ? JSON.stringify(plain(v)) : v}`; };
const sxOk = (r, what) => { if ('err' in r) throw new Error(`${what}: ${sxErr(r.err)}`); return r.ok; };

// ---------------- bids ----------------

/// The minimum next bid of an offer view (SneedexOffer.jsx 1318-1344).
export const minimumNextBid = (view, tokenFee) => {
  const o = view.offer;
  const buyout = opt(o.buyout_price);
  const hb = opt(view.highest_bid);
  let next;
  if (hb) {
    const mult = opt(o.min_bid_increment_fee_multiple);
    next = BigInt(hb.amount) + (mult ? BigInt(mult) * BigInt(tokenFee) : 1n);
    if (buyout != null && next > BigInt(buyout)) next = BigInt(buyout);
  } else next = opt(o.min_bid_price) ?? buyout;
  return next != null ? BigInt(next) : null;
};

const bidBuild = (kind) => async ({ offer_id, amount }, ctx) => {
  const sx = await ctx.anon(sneedexIdl, CANISTERS.sneedex);
  const view = opt(await sx.getOfferView(BigInt(offer_id)));
  if (!view) throw new Error(`No offer ${offer_id}.`);
  const o = view.offer;
  const ledger = o.price_token_ledger.toText();
  const t = await tokenInfo(ledger);
  const fee = await ledgerFee(ledger);
  const buyout = opt(o.buyout_price);
  const problems = [];
  let base;
  if (kind === 'buyout') {
    if (buyout == null) throw new Error('This offer has no buyout price.');
    base = BigInt(buyout);
  } else {
    base = (await toBaseUnits(ledger, amount)).amount;
    const min = minimumNextBid(view, fee);
    if (min != null && base < min) problems.push(`The minimum bid is ${fmt(min, t)}.`);
    if (buyout != null && base >= BigInt(buyout)) problems.push(`That reaches the buyout price (${fmt(buyout, t)}): use sneedex_buyout instead.`);
  }
  if (!('Active' in o.state)) problems.push(`The offer is ${Object.keys(o.state)[0]}, not Active.`);
  const exp = opt(o.expiration);
  if (exp != null && BigInt(exp) <= BigInt(Date.now()) * 1_000_000n) problems.push('The offer has expired.');
  const approved = opt(o.approved_bidders);
  if (approved && !approved.some((p) => p.toText() === ctx.principal)) problems.push('This is a private offer and you are not an approved bidder.');
  if (o.creator.toText() === ctx.principal) problems.push('You created this offer.');
  const l = await ctx.anon(icrc1Idl, ledger);
  const bal = await l.icrc1_balance_of({ owner: toPrincipal(ctx.principal), subaccount: [] });
  if (bal < base + fee) problems.push(`Balance ${fmt(bal, t)} is below ${fmt(base + fee, t)}.`);
  return {
    summary: `${kind === 'buyout' ? 'Buy out' : 'Bid on'} Sneedex offer ${offer_id} for ${fmt(base, t)}`,
    calls: [
      { canister: CANISTERS.sneedex, method: 'reserveBid', args: [offer_id], note: 'returns a bid id' },
      { canister: CANISTERS.sneedex, method: 'getBidEscrowSubaccount', args: [ctx.principal, '<bid id>'], note: 'query' },
      { canister: ledger, method: 'icrc1_transfer', args: { to: { owner: CANISTERS.sneedex, subaccount: ['<bid escrow subaccount>'] }, amount: base, fee: [fee], memo: [], from_subaccount: [], created_at_time: [] } },
      { canister: CANISTERS.sneedex, method: 'confirmBid', args: ['<bid id>', base] },
    ],
    spends: [await spend(ledger, base + fee, `${kind} ${fmt(base, t)} into the bid escrow + ledger fee`, `Sneedex bid escrow`)],
    notes: [kind === 'buyout' ? 'A buyout completes the offer at once; the assets are delivered automatically.' : 'If you are outbid, the escrowed amount comes back automatically minus a ledger fee.'],
    problems,
    _amount: base, _fee: fee, _ledger: ledger,
  };
};

const bidRun = async ({ offer_id }, ctx, plan) => {
  const { _amount: amount, _fee: fee, _ledger: ledger } = plan;
  const sx = await ctx.signed(sneedexIdl, CANISTERS.sneedex);
  const steps = [];
  const bidId = sxOk(await sx.reserveBid(BigInt(offer_id)), 'reserveBid');
  steps.push(`bid ${bidId} reserved`);
  const sub = await sx.getBidEscrowSubaccount(toPrincipal(ctx.principal), bidId);
  const l = await ctx.signed(icrc1Idl, ledger);
  const tr = await l.icrc1_transfer({ to: { owner: toPrincipal(CANISTERS.sneedex), subaccount: [sub] }, amount, fee: [fee], memo: [], from_subaccount: [], created_at_time: [] });
  if ('Err' in tr) return { ok: false, steps, error: `transfer refused, nothing sent: ${JSON.stringify(plain(tr.Err))}` };
  steps.push(`sent to the bid escrow (block ${tr.Ok})`);
  try {
    sxOk(await sx.confirmBid(bidId, amount), 'confirmBid');
  } catch (e) {
    return { ok: false, spent: true, steps, error: shortErr(e), recovery: `The tokens are in bid ${bidId}'s escrow. Retry confirmBid on Sneed Hub (${link(`/sneedex_offer/${offer_id}`)}), or withdraw them there (withdrawBidEscrow).` };
  }
  steps.push(`bid ${bidId} confirmed`);
  return { ok: true, spent: true, summary: `bid ${bidId} placed on offer ${offer_id}`, steps, links: [link(`/sneedex_offer/${offer_id}`)] };
};

// ---------------- create offer ----------------

const assetSchema = z.object({
  type: z.enum(['icrc7', 'ext', 'token']).describe('icrc7 = ICRC-7 NFTs, ext = EXT NFTs, token = ICRC-1 tokens'),
  collection: z.string().optional().describe('NFT collection canister id (icrc7 / ext)'),
  token_ids: z.array(z.union([z.number().int().min(0), z.string()])).max(50).optional().describe('NFT token ids (icrc7) or token indices (ext)'),
  ledger: z.string().optional().describe('Token ledger (token)'),
  amount: z.string().optional().describe('Whole tokens (token)'),
});

const CANARY_SUB = (() => { const s = new Uint8Array(32); s[31] = 1; return s; })();

/// Collection standards (NftUtils.detectStandards): icrc10 list, else probe icrc37.
const icrc37Supported = async (c) => {
  try { const s = await c.icrc10_supported_standards(); return s.some((x) => x.name === 'ICRC-37'); } catch { /* probe */ }
  try { await c.icrc37_max_approvals_per_token_or_collection(); return true; } catch { return false; }
};

const createBuild = async (a, ctx) => {
  const sx = await ctx.anon(sneedexIdl, CANISTERS.sneedex);
  const priceLedger = toPrincipal(a.price_ledger ?? CANISTERS.icp_ledger, 'ledger').toText();
  const pt = await tokenInfo(priceLedger);
  const priceFee = await ledgerFee(priceLedger);
  const problems = [];
  const minBid = a.min_bid ? (await toBaseUnits(priceLedger, a.min_bid)).amount : null;
  const buyout = a.buyout ? (await toBaseUnits(priceLedger, a.buyout)).amount : null;
  if (minBid == null && buyout == null) problems.push('Give a min_bid, a buyout, or both.');
  if (minBid != null && buyout != null && minBid > buyout) problems.push('min_bid is above buyout.');
  const durMs = ((a.expiration_days ?? 7) * 86400 + (a.expiration_hours ?? 0) * 3600) * 1000;
  let increment = null;
  if (a.min_bid_increment) {
    const inc = (await toBaseUnits(priceLedger, a.min_bid_increment)).amount;
    const m = (inc + priceFee - 1n) / priceFee;
    if (m >= 1n) increment = m;
  }
  // fee (fetchFeeInfo): regular/premium creation fee, special prices; existing payment deposit
  const [feeCfg, paySub, special] = await Promise.all([sx.getFeeConfig(), sx.getOfferCreationPaymentSubaccount(toPrincipal(ctx.principal)), specialPricesFor(sx, ctx.principal)]);
  let isPremium = false;
  try { isPremium = (await premiumStatus(ctx.principal, ctx.anon)).active; } catch { /* treat as regular */ }
  const regular = BigInt(feeCfg.regularCreationFeeE8s);
  const base = regular === 0n ? 0n : isPremium ? BigInt(feeCfg.premiumCreationFeeE8s) : regular;
  const eff = effectivePrice({ regular: base, special: regular === 0n ? null : special, field: 'offer_creation_fee_e8s' });
  const creationFee = eff.price;
  const icp = await ctx.anon(icrc1Idl, CANISTERS.icp_ledger);
  const payBal = await icp.icrc1_balance_of({ owner: toPrincipal(CANISTERS.sneedex), subaccount: [paySub] });
  const payFee = creationFee > 0n && payBal < creationFee;
  const icpFee = await ledgerFee(CANISTERS.icp_ledger);
  const calls = [];
  const spends = [];
  if (payFee) {
    calls.push({ canister: CANISTERS.icp_ledger, method: 'icrc1_transfer', args: { to: { owner: CANISTERS.sneedex, subaccount: [toHex(paySub)] }, amount: creationFee, fee: [icpFee], memo: [], from_subaccount: [], created_at_time: [] }, note: `offer creation fee (${eff.tier} price)` });
    spends.push(await spend(CANISTERS.icp_ledger, creationFee + icpFee, `Sneedex offer creation fee (${eff.tier}) + ledger fee`, 'Sneedex fee deposit'));
  }
  const req = {
    price_token_ledger: priceLedger,
    min_bid_price: minBid != null ? [minBid] : [],
    buyout_price: buyout != null ? [buyout] : [],
    expiration: ['<now + ' + (durMs / 3600000) + ' h, in ns>'],
    approved_bidders: a.approved_bidders?.length ? [a.approved_bidders.map((p) => toPrincipal(p).toText())] : [],
    min_bid_increment_fee_multiple: increment != null ? [increment] : [],
    public_note: a.public_note ? [a.public_note] : [],
    note_to_buyer: a.note_to_buyer ? [a.note_to_buyer] : [],
  };
  calls.push({ canister: CANISTERS.sneedex, method: 'createOffer', args: req, note: 'returns the offer id' });
  const assets = [];
  const me = toPrincipal(ctx.principal);
  const myAid = accountId(me);
  for (const [i, as] of a.assets.entries()) {
    if (as.type === 'token') {
      if (!as.ledger || !as.amount) throw new Error(`asset ${i}: token needs ledger and amount`);
      const ledger = toPrincipal(as.ledger, 'ledger').toText();
      const { amount, token } = await toBaseUnits(ledger, as.amount);
      const fee = await ledgerFee(ledger);
      assets.push({ kind: 'token', ledger, amount, fee, variant: { ICRC1Token: { ledger_canister_id: ledger, amount } } });
      spends.push(await spend(ledger, amount + fee, `asset ${i}: ${fmt(amount, token)} into the offer escrow + ledger fee`, 'Sneedex offer escrow'));
    } else {
      if (!as.collection || !as.token_ids?.length) throw new Error(`asset ${i}: ${as.type} needs collection and token_ids`);
      const coll = toPrincipal(as.collection, 'collection canister id').toText();
      if (as.type === 'icrc7') {
        const ids = as.token_ids.map((x) => BigInt(x));
        const c = await ctx.anon(icrc7Idl, coll);
        const owners = await c.icrc7_owner_of(ids);
        owners.forEach((o, j) => {
          const acc = opt(o);
          if (!acc || acc.owner.toText() !== ctx.principal || (opt(acc.subaccount) && opt(acc.subaccount).some((b) => b !== 0))) problems.push(`asset ${i}: token ${ids[j]} of ${coll} is not held by ${ctx.principal}'s main account.`);
        });
        const byApproval = await icrc37Supported(c);
        assets.push({ kind: 'icrc7', coll, ids, byApproval, variant: { ICRC7NFT: { collection_canister_id: coll, token_ids: ids } } });
      } else {
        const idx = as.token_ids.map((x) => Number(x));
        const c = await ctx.anon(extIdlFactory, coll);
        for (const n of idx) {
          const r = await c.bearer(extTokenIdentifier(coll, n));
          if ('err' in r) problems.push(`asset ${i}: EXT token ${n}: ${JSON.stringify(plain(r.err))}`);
          else if (r.ok !== myAid) problems.push(`asset ${i}: EXT token ${n} of ${coll} is held by account ${r.ok}, not by ${ctx.principal} (${myAid}).`);
        }
        assets.push({ kind: 'ext', coll, idx, variant: { EXTNFT: { collection_canister_id: coll, token_indices: idx } } });
      }
    }
  }
  assets.forEach((as, i) => calls.push({ canister: CANISTERS.sneedex, method: 'addAsset', args: { offer_id: '<offer id>', asset: as.variant } , note: `asset ${i}` }));
  calls.push({ canister: CANISTERS.sneedex, method: 'finalizeAssets', args: ['<offer id>'] });
  assets.forEach((as, i) => {
    if (as.kind === 'token') {
      calls.push({ canister: as.ledger, method: 'icrc1_transfer', args: { to: { owner: CANISTERS.sneedex, subaccount: ['<offer escrow subaccount>'] }, amount: as.amount, fee: [] }, note: `escrow asset ${i}` });
      calls.push({ canister: CANISTERS.sneedex, method: 'escrowICRC1Tokens', args: ['<offer id>', i] });
    } else if (as.kind === 'icrc7' && as.byApproval) {
      calls.push({ canister: as.coll, method: 'icrc37_approve_tokens', args: as.ids.map((id) => ({ token_id: id, approval_info: { spender: { owner: CANISTERS.sneedex, subaccount: [] } } })), note: `approve Sneedex to take asset ${i}` });
      calls.push({ canister: CANISTERS.sneedex, method: 'escrowICRC7NFTsByApproval', args: ['<offer id>', i], note: 'Sneedex pulls the NFTs' });
    } else if (as.kind === 'icrc7') {
      calls.push({ canister: as.coll, method: 'icrc7_transfer', args: [{ to: { owner: ctx.principal, subaccount: ['00..01 (canary check)'] }, token_id: as.ids[0] }], note: 'canary: checks the collection keeps subaccounts before sending to the escrow subaccount' });
      calls.push({ canister: as.coll, method: 'icrc7_transfer', args: as.ids.map((id) => ({ to: { owner: CANISTERS.sneedex, subaccount: ['<offer escrow subaccount>'] }, token_id: id })), note: `escrow asset ${i}` });
      calls.push({ canister: CANISTERS.sneedex, method: 'escrowICRC7NFTs', args: ['<offer id>', i] });
    } else {
      as.idx.forEach((n) => calls.push({ canister: as.coll, method: 'transfer', args: { from: { principal: ctx.principal }, to: { address: '<offer escrow account id>' }, token: extTokenIdentifier(as.coll, n), amount: 1, memo: [], notify: false, subaccount: [] }, note: `escrow EXT token ${n}` }));
      calls.push({ canister: CANISTERS.sneedex, method: 'escrowEXTNFTs', args: ['<offer id>', i] });
    }
  });
  calls.push({ canister: CANISTERS.sneedex, method: 'activateOffer', args: ['<offer id>'] });
  // the ICP creation fee and the token assets, summed per ledger, come from your main account
  problems.push(...await balanceProblems(ctx, spends));
  return {
    summary: `Create a Sneedex offer of ${a.assets.length} asset(s) priced in ${pt.symbol ?? priceLedger}: ${minBid != null ? `min bid ${fmt(minBid, pt)}` : 'no auction'}${buyout != null ? `, buyout ${fmt(buyout, pt)}` : ''}, ${a.expiration_days ?? 7} day(s)${a.expiration_hours ? ` ${a.expiration_hours} h` : ''}`,
    calls,
    spends,
    notes: [
      `Creation fee: ${fmt(creationFee, { decimals: 8, symbol: 'ICP' })} (${eff.tier}${isPremium ? ', Premium member' : ''})${!payFee && creationFee > 0n ? '; already covered by your fee deposit' : ''}.`,
      'NFTs and tokens move into Sneedex escrow; if a step fails the offer stays on Sneed Hub, where you can finish escrow or cancel and reclaim.',
      'Offers are public.',
    ],
    problems,
    _assets: assets, _req: req, _durMs: durMs, _payFee: payFee, _creationFee: creationFee, _icpFee: icpFee, _paySub: paySub,
  };
};

/// The run of sneedex_create_offer (exported for tests).
export const createRun = async (a, ctx, plan) => {
  const sx = await ctx.signed(sneedexIdl, CANISTERS.sneedex);
  const me = toPrincipal(ctx.principal);
  const steps = [];
  let spent = false;
  let offerId = null;
  const fail = (e) => ({
    ok: false, spent, steps, error: shortErr(e),
    recovery: offerId != null ? `Offer ${offerId} exists but is not active. Open ${link(`/sneedex_offer/${offerId}`)} to finish escrow, or cancel it and reclaim the assets (cancelOffer / reclaimAssets).` : (spent ? 'The creation fee is in your Sneedex fee deposit and will be used by your next offer (or withdraw it on Sneed Hub).' : undefined),
    links: offerId != null ? [link(`/sneedex_offer/${offerId}`)] : [],
  });
  try {
    if (plan._payFee) {
      const icp = await ctx.signed(icrc1Idl, CANISTERS.icp_ledger);
      const tr = await icp.icrc1_transfer({ to: { owner: toPrincipal(CANISTERS.sneedex), subaccount: [plan._paySub] }, amount: plan._creationFee, fee: [plan._icpFee], memo: [], from_subaccount: [], created_at_time: [] });
      if ('Err' in tr) throw new Error(`fee payment refused, nothing sent: ${JSON.stringify(plain(tr.Err))}`);
      spent = true;
      steps.push(`creation fee paid (ICP block ${tr.Ok})`);
    }
    const r = plan._req;
    offerId = sxOk(await sx.createOffer({
      price_token_ledger: toPrincipal(r.price_token_ledger),
      min_bid_price: r.min_bid_price,
      buyout_price: r.buyout_price,
      expiration: [(BigInt(Date.now()) + BigInt(plan._durMs)) * 1_000_000n],
      approved_bidders: r.approved_bidders.length ? [r.approved_bidders[0].map((p) => toPrincipal(p))] : [],
      min_bid_increment_fee_multiple: r.min_bid_increment_fee_multiple,
      public_note: r.public_note,
      note_to_buyer: r.note_to_buyer,
    }), 'createOffer');
    steps.push(`offer ${offerId} created`);
    const toVariant = (as) => (as.kind === 'token' ? { ICRC1Token: { ledger_canister_id: toPrincipal(as.ledger), amount: as.amount } }
      : as.kind === 'icrc7' ? { ICRC7NFT: { collection_canister_id: toPrincipal(as.coll), token_ids: as.ids } }
        : { EXTNFT: { collection_canister_id: toPrincipal(as.coll), token_indices: as.idx } });
    for (const as of plan._assets) sxOk(await sx.addAsset({ offer_id: offerId, asset: toVariant(as) }), 'addAsset');
    steps.push(`${plan._assets.length} asset(s) added`);
    sxOk(await sx.finalizeAssets(offerId), 'finalizeAssets');
    for (const [i, as] of plan._assets.entries()) {
      const idx = BigInt(i);
      if (as.kind === 'token') {
        const sub = await sx.getOfferEscrowSubaccount(me, offerId);
        const l = await ctx.signed(icrc1Idl, as.ledger);
        const tr = await l.icrc1_transfer({ to: { owner: toPrincipal(CANISTERS.sneedex), subaccount: [sub] }, amount: as.amount, fee: [], memo: [], from_subaccount: [], created_at_time: [] });
        if ('Err' in tr) throw new Error(`asset ${i}: transfer refused: ${JSON.stringify(plain(tr.Err))}`);
        spent = true;
        steps.push(`asset ${i}: tokens sent to the offer escrow (block ${tr.Ok})`);
        sxOk(await sx.escrowICRC1Tokens(offerId, idx), 'escrowICRC1Tokens');
      } else if (as.kind === 'icrc7' && as.byApproval) {
        const c = await ctx.signed(icrc7Idl, as.coll);
        for (const id of as.ids) {
          const res = await c.icrc37_approve_tokens([{ token_id: id, approval_info: { spender: { owner: toPrincipal(CANISTERS.sneedex), subaccount: [] }, from_subaccount: [], expires_at: [], memo: [], created_at_time: BigInt(Date.now()) * 1_000_000n } }]);
          const e = res.map(opt).find((x) => x && 'Err' in x);
          if (e) throw new Error(`asset ${i}: approval of token ${id} refused: ${JSON.stringify(plain(e.Err))}`);
        }
        sxOk(await sx.escrowICRC7NFTsByApproval(offerId, idx), 'escrowICRC7NFTsByApproval');
      } else if (as.kind === 'icrc7') {
        const c = await ctx.signed(icrc7Idl, as.coll);
        const sub = await sx.getOfferEscrowSubaccount(me, offerId);
        const canaryId = as.ids[0];
        const cr = opt((await c.icrc7_transfer([{ from_subaccount: [], to: { owner: me, subaccount: [CANARY_SUB] }, token_id: canaryId, memo: [], created_at_time: [] }]))[0]);
        if (!cr || 'Err' in cr) throw new Error(`asset ${i}: the canary transfer was refused: ${JSON.stringify(plain(cr?.Err ?? 'no answer'))}`);
        const owner = opt((await c.icrc7_owner_of([canaryId]))[0]);
        if (!owner || owner.owner.toText() !== ctx.principal || toHex(opt(owner.subaccount) ?? []) !== toHex(CANARY_SUB)) {
          throw new Error(`asset ${i}: this collection does not keep subaccounts, so it cannot escrow by transfer (and does not support ICRC-37 approvals).`);
        }
        const res = await c.icrc7_transfer(as.ids.map((id) => ({ from_subaccount: id === canaryId ? [CANARY_SUB] : [], to: { owner: toPrincipal(CANISTERS.sneedex), subaccount: [sub] }, token_id: id, memo: [], created_at_time: [] })));
        const bad = res.map(opt).findIndex((x) => !x || 'Err' in x);
        if (bad >= 0) {
          try { await c.icrc7_transfer([{ from_subaccount: [CANARY_SUB], to: { owner: me, subaccount: [] }, token_id: canaryId, memo: [], created_at_time: [] }]); } catch { /* best effort */ }
          throw new Error(`asset ${i}: transfer of token ${as.ids[bad]} failed: ${JSON.stringify(plain(opt(res[bad])?.Err ?? 'no answer'))}`);
        }
        sxOk(await sx.escrowICRC7NFTs(offerId, idx), 'escrowICRC7NFTs');
      } else {
        // utils/SneedexExt.js escrowExtAsset: the escrow account id from Sneedex must match the local one
        const [aid, sub] = await Promise.all([sx.getOfferEscrowAccountId(me, offerId), sx.getOfferEscrowSubaccount(me, offerId)]);
        const local = accountId(CANISTERS.sneedex, sub);
        if (aid.toLowerCase() !== local) throw new Error(`asset ${i}: escrow account id mismatch (${aid} vs ${local}); not sending.`);
        const c = await ctx.signed(extIdlFactory, as.coll);
        const mine = accountId(me);
        for (const n of as.idx) {
          const tid = extTokenIdentifier(as.coll, n);
          const holder = await c.bearer(tid);
          if ('ok' in holder && holder.ok === local) continue; // already in escrow
          if (!('ok' in holder) || holder.ok !== mine) throw new Error(`asset ${i}: EXT token ${n} is not in your account any more.`);
          let callErr = null;
          let r;
          try { r = await c.transfer({ from: { principal: me }, to: { address: local }, token: tid, amount: 1n, memo: [], notify: false, subaccount: [] }); } catch (e) { callErr = e; }
          if (r && 'err' in r) throw new Error(`asset ${i}: EXT transfer of ${n} refused: ${sxErr(r.err)}`);
          const after = await c.bearer(tid);
          if (!('ok' in after) || after.ok !== local) throw callErr ?? new Error(`asset ${i}: EXT token ${n} did not arrive in escrow.`);
        }
        sxOk(await sx.escrowEXTNFTs(offerId, idx), 'escrowEXTNFTs');
      }
      steps.push(`asset ${i} escrowed`);
    }
    sxOk(await sx.activateOffer(offerId), 'activateOffer');
    steps.push(`offer ${offerId} active`);
    return { ok: true, spent, summary: `offer ${offerId} is live`, steps, links: [link(`/sneedex_offer/${offerId}`)] };
  } catch (e) {
    return fail(e);
  }
};

export const sneedexWrites = [
  {
    name: 'sneedex_bid',
    title: 'Sneedex: place a bid',
    description: 'Bid on an active Sneedex offer, as Sneed Hub does: reserveBid, getBidEscrowSubaccount, icrc1_transfer of the bid into that escrow (you pay the ledger fee), confirmBid. Lost bids are refunded automatically. Counts toward the daily cap.',
    inputSchema: { offer_id: z.number().int().min(0).describe('Offer id'), amount: z.string().describe('Bid in whole tokens of the offer\'s price token') },
    build: bidBuild('bid'),
    run: bidRun,
  },
  {
    name: 'sneedex_buyout',
    title: 'Sneedex: buy out an offer',
    description: 'Buy an active Sneedex offer at its buyout price (same steps as a bid with the buyout amount; the offer completes and the assets are delivered). Counts toward the daily cap.',
    inputSchema: { offer_id: z.number().int().min(0).describe('Offer id') },
    build: bidBuild('buyout'),
    run: bidRun,
  },
  {
    name: 'sneedex_create_offer',
    title: 'Sneedex: create an offer',
    description: 'Put NFTs (ICRC-7 or EXT) and/or ICRC-1 tokens up for sale on Sneedex, as Sneed Hub\'s create page does: pay the offer creation fee into the fee deposit (ICP; Premium/special prices applied) if needed, createOffer, addAsset per asset, finalizeAssets, escrow each asset (ICRC-37 approval + escrowICRC7NFTsByApproval, or ICRC-7 transfer into the offer\'s escrow subaccount + escrowICRC7NFTs; EXT transfer to the escrow account id + escrowEXTNFTs; tokens transfer + escrowICRC1Tokens) and activateOffer. In "act as me" mode the delegation must cover Sneedex, the ICP ledger (fee) and the NFT collection / token ledger.',
    inputSchema: {
      assets: z.array(assetSchema).min(1).max(10).describe('What to sell'),
      price_ledger: z.string().optional().describe(`Price token ledger (default ICP ${CANISTERS.icp_ledger})`),
      min_bid: z.string().optional().describe('Minimum bid (whole tokens); omit for buyout-only'),
      buyout: z.string().optional().describe('Buyout price (whole tokens); omit for auction-only'),
      expiration_days: z.number().min(0).max(90).optional().describe('Days until it expires (default 7)'),
      expiration_hours: z.number().min(0).max(23).optional().describe('Extra hours'),
      min_bid_increment: z.string().optional().describe('Minimum raise between bids (whole tokens)'),
      approved_bidders: z.array(z.string()).max(200).optional().describe('Private offer: only these principals may bid'),
      public_note: z.string().max(4000).optional().describe('Public description'),
      note_to_buyer: z.string().max(4000).optional().describe('Note only the buyer sees'),
    },
    build: createBuild,
    run: createRun,
  },
];

export const registerSneedexWrites = (server) => sneedexWrites.forEach((w) => defineWrite(server, w));
export { ptext };
