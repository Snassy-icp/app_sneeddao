// EXT NFTs on Sneedex: escrow by transfer. EXT has no subaccounts of its own, so Sneedex holds an
// offer's EXT tokens in the account id of (Sneedex, the offer's escrow subaccount). The seller's
// wallet sends each card there with the collection's transfer, then Sneedex's escrowEXTNFTs checks
// bearer() and marks the asset escrowed. A card returns to the seller if the offer is cancelled or
// expires, and goes to the buyer if it sells.
import { Principal } from '@dfinity/principal';
import { accountId, bearer, escrowAccountId, transferExt } from './ExtUtils';
import { SNEEDEX_CANISTER_ID, getErrorMessage } from './SneedexUtils';

/// The escrow account id of an offer, read from Sneedex and checked against the local computation.
export async function fetchOfferEscrowAccountId(sneedexActor, creator, offerId) {
    const c = typeof creator === 'string' ? Principal.fromText(creator) : creator;
    const [aid, sub] = await Promise.all([
        sneedexActor.getOfferEscrowAccountId(c, BigInt(offerId)),
        sneedexActor.getOfferEscrowSubaccount(c, BigInt(offerId)),
    ]);
    const local = escrowAccountId(Principal.fromText(SNEEDEX_CANISTER_ID), sub);
    if (String(aid).toLowerCase() !== local) {
        throw new Error(`Sneedex answered escrow account ${aid}, but its principal and the offer's escrow subaccount give ${local}. Nothing was sent.`);
    }
    return local;
}

/// Where each card is now: 'escrow' (already sent), 'mine' (to send), or 'elsewhere' (held by someone else).
export async function planExtEscrow(collectionId, indices, me, escrowAid, agent) {
    const mine = accountId(me);
    const out = [];
    for (const index of indices.map(Number)) {
        const holder = await bearer(collectionId, index, agent);
        out.push({ index, holder, where: holder === escrowAid ? 'escrow' : holder === mine ? 'mine' : 'elsewhere' });
    }
    return out;
}

/// Escrow an EXT asset of an offer: send the cards that are still in the seller's wallet to the
/// escrow account (after `confirm(info)` resolves true), then have Sneedex verify. Cards already in
/// escrow are not sent again, so this is safe to retry.
/// `confirm` gets { collectionId, collectionName, offerId, escrowAid, toSend: [index], already: [index] }.
export async function escrowExtAsset({ sneedexActor, identity, agent, collectionId, collectionName = '', indices, offerId, assetIndex, confirm, onProgress }) {
    const me = identity.getPrincipal();
    const escrowAid = await fetchOfferEscrowAccountId(sneedexActor, me, offerId);
    const plan = await planExtEscrow(collectionId, indices, me, escrowAid, agent);
    const elsewhere = plan.filter((p) => p.where === 'elsewhere');
    if (elsewhere.length) {
        throw new Error(`Not in your wallet: card${elsewhere.length === 1 ? '' : 's'} #${elsewhere.map((p) => p.index).join(', #')} (held by account ${elsewhere[0].holder || 'unknown'}).`);
    }
    const toSend = plan.filter((p) => p.where === 'mine').map((p) => p.index);
    const already = plan.filter((p) => p.where === 'escrow').map((p) => p.index);
    if (toSend.length) {
        const ok = confirm ? await confirm({ collectionId, collectionName, offerId, escrowAid, toSend, already }) : true;
        if (!ok) throw new Error('You did not confirm sending the EXT cards to the escrow account; nothing was sent. You can escrow them later from the offer page.');
        for (const index of toSend) {
            onProgress?.(`Sending card #${index} to the escrow account…`);
            await transferExt(collectionId, index, me, { address: escrowAid }, agent, { requireArrival: true });
        }
    }
    onProgress?.('Sneedex is checking the escrow…');
    const r = await sneedexActor.escrowEXTNFTs(BigInt(offerId), BigInt(assetIndex));
    if ('err' in r) throw new Error(`Failed to escrow the EXT cards: ${getErrorMessage(r.err)}`);
    return { escrowAid, sent: toSend, already };
}
