/// The text get_api_doc returns: a short guide for agents (full reference in public/api-docs/sneed_nft.md).
module {
  public let text : Text = "# Sneed NFT collection (canister sneed_nft)

An ICRC-7 collection (ICRC-37, ICRC-10, ICRC-3 log) holding the Sneed Diamond Club: 1,000 cards moving from the EXT canister gjv36-laaaa-aaaah-adyza-cai, every image stored and served here. EXT token index n is ICRC-7 token n + 1.

- Production: not deployed yet
- Full reference: https://app.sneeddao.com/api-docs/sneed_nft.md (page: https://app.sneeddao.com/api/sneed_nft, block types: #block-types); all Sneed APIs: https://app.sneeddao.com/llms.txt

## Images
- https://<canister>.icp0.io/card/<n>.jpg (original), ?size=web, ?size=thumb; /logo.jpg. Certified (response verification v2).
- Token metadata `image_sha256` is the original's SHA-256; `image_manifest_hash()` the hash of all of them.

## Swap (open once the metadata is frozen and minting locked)
- By send: send the EXT card to `swap_address(p)` from any wallet, then `claim_swap(p)` (anyone may call it for p).
- By proof of payment (a wallet that cannot send NFTs): pay a small amount of an allow-listed token to `proof_address(p)` from the stuck wallet, then `claim_by_proof(p, ledger, block_index, sender)`. The payer must be a wallet key (never a canister); for the ICP ledger `sender` names the paying principal and subaccount. The old cards are retired (`list_retired`), the payment is refunded less the ledger fee (`retry_refund` if it failed).

## Conventions
- Custom updates return `variant { ok; err : text }` (lowercase tags); ICRC methods the standards' `Ok` / `Err`.
- After the load, proof ledgers, the EXT canister, admins, rate limits and log settings change only by DAO proposal (`dao_admin`).
- Operators: `admin_reset_refund` only after checking on the ledger that no earlier refund of that payment exists (it sends a new transfer the ledger will not deduplicate).
";
};
