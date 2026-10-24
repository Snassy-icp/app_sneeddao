# Sneed Wallet: native Bitcoin and "Sign in with Sneed Wallet"

Status: spec draft, 2026-10-23 (A4 2026-10-24). A1 (receive), A0/A2 (signing credit, fee source, `btc.html`,
pending store, send), A3 (native ↔ ckBTC moves, §6) and A4 (speed-up, sweep, balance cross-check, §12.3) built. Staging: testnet4 behind the A1 triple flag, plus mainnet developer
mode (§11). **Prod: Bitcoin MAINNET as an opt-in beta** (decided 2026-10-23, §12.1): a "Bitcoin
(beta)" switch per browser, default off. A3 and A4 are built (not yet released), during the beta. Builds on `spec/oisy_comparison.md` (§3.1 signer,
§3.2 Chain Fusion Signer, §5 order) and `spec/programmable_accounts.md` (pockets). Paths are
relative to `src/app_sneeddao_frontend/src`.

**Sneed Wallet** is the brand for the wallet part of Sneed Hub (app.sneeddao.com). Two
deliverables, in this order:

- **A. Native Bitcoin.** Each user gets a real BTC address held by a threshold key through
  DFINITY's Chain Fusion Signer (`grghe-syaaa-aaaar-qabyq-cai`). Receive, send, balance,
  history, fee choice, one-click native BTC ↔ ckBTC. ETH/EVM later, the same way.
- **B. "Sign in with Sneed Wallet".** Sneed Wallet acts as an ICRC signer for other ICP dapps
  (ICRC-21/25/27/29/49, later scoped ICRC-34 delegations).

## 1. Goals and non-goals

Goals:
1. A BTC wallet that a casual user can use with one click per action, and that shows every cost
   up front: the network fee in sats and the signing cost in cycles.
2. No new Sneed canister in the signing path. Keys live in the IC's threshold ECDSA (`key_1`,
   secp256k1) behind the NNS-governed signer, not behind an SNS upgrade.
3. Native BTC and ckBTC feel like two pockets of the same asset. Moving between them is a
   "Move", not a bridge wizard.
4. Other dapps can use Sneed Wallet to sign in and make calls. Unknown or dangerous calls are
   blocked by default.

Non-goals (this spec): WalletConnect, Solana/XRP, cross-chain swaps, PSBT and message signing,
Taproot or multiple BTC addresses per user, a Sneed-run signing canister.

Project rules that apply everywhere: amounts through `useDenomination().formatValue(usd)`, never
a hard-coded `$`; principals through `PrincipalInput`, tokens through `TokenSelector`; no
`window.confirm`/`alert`/`prompt` (the in-app `ConfirmDialog` instead; the ICRC-29 signer popup
is the standard's own transport and is fine); no "anonymous" options, since every action is
public on chain and tied to the user's principal; the UI never talks about token price.

## 2. Casual and pro

| Action | Casual (one click, defaults) | Advanced (drill-down) |
|---|---|---|
| Receive | "Bitcoin address" row with QR and copy. Address shown free (§4.1). | Network (mainnet/testnet), derivation details, verify the address against the signer (paid, 0.08B cycles). |
| Send | Address, amount, "Normal" fee preselected. One summary line: "network fee ≈ N sats, signing ≈ X cycles". Confirm. | Fee tier or a custom sat/vB value. Coin control (choose UTXOs). Send max or sweep. Sign without broadcasting and export the hex. Raw transaction preview. |
| Balance | One number: confirmed BTC + ckBTC on the Bitcoin card, plus "pending" when anything is unconfirmed. | Per-UTXO list with confirmations, locked-by-pending flags, and a cross-check against an update call. |
| Native ↔ ckBTC | "Move" between the two pockets with one confirm. Minter fees and minimums shown. | Status of each conversion step, retry `update_balance`, the deposit address. |
| Signing credit | "Signing credit: enough for ~N sends", with "Top up from ICP". | Exact cycles-ledger balance, the allowance to the signer, approve or revoke it. |
| Signer (B) | Connect a dapp; approve each call with a plain-language summary. | Per-origin permissions, a pocket bound to the connection, raw candid view, the block list. |

## 3. Keys, principal and domain

### 3.1 How the address is derived

The signer derives the BTC key from the path `[0x00 (schema Btc), caller principal bytes]` and
returns its P2WPKH address. That is the only address type it supports today (`BitcoinAddressType
= variant { P2WPKH }`). Sources: [derivation_path.rs](https://github.com/dfinity/chain-fusion-signer/blob/main/src/signer/canister/src/derivation_path.rs),
[signer.did](https://github.com/dfinity/chain-fusion-signer/blob/main/src/signer/canister/signer.did).

This has three consequences:
- **The address is a pure function of the principal.** One BTC address per principal. The
  ETH address uses schema `0x01` and works the same way.
- **It can be computed offline.** [`@dfinity/ic-pub-key`](https://github.com/dfinity/ic-pub-key)
  (npm 1.0.2) derives the signer's BTC and ETH addresses for any principal without an IC call
  (`signer btc address -u <principal> -n mainnet`). We show the address for free and verify it
  once against `btc_caller_address` (0.079B cycles) the first time the user sends. Anyone can
  compute anyone's Sneed Wallet BTC address from their principal. That is a public fact, and the
  UI says so.
- **The principal comes from the II origin.** `AuthContext.jsx` sets no `derivationOrigin`, so
  II derives principals for `https://app.sneeddao.com`. A user's Sneed Wallet BTC address
  therefore differs from their Oisy address, and the receive screen says so once.

### 3.2 Decided: Sneed Wallet stays on app.sneeddao.com

Decided by the user, 2026-10-23: Sneed Wallet lives inside app.sneeddao.com. There is no own
domain and no change of derivation origin for this work. The signer (B) is a page on the same
origin (§9.1), so it sees the same principal and needs no `ii-alternative-origins`.

Housekeeping: `public/.well-known/ii-derivation-origin` holds the staging canister URL and is not
wired to anything. Leave it alone in this work, and make sure no login code starts reading it.

Staging (`2icdp-6qaaa-aaaal-qjt6a-cai.icp0.io`) has its own origin, so its principals and BTC
addresses differ from prod. Staging uses Bitcoin **testnet** only, with no real money
(`staging-no-real-money`).

### 3.3 Domain-hijack risk, and the later fix

Every user's principal is derived from the string `https://app.sneeddao.com`. Whoever serves
code at that origin can obtain delegations for every user who logs in there. That covers their
ICP tokens, neurons, locks and bots, and now also their BTC, because the BTC address is a
function of the same principal.

Losing control of the domain therefore means losing control of those principals. Paths to that
include a registrar takeover, expiry, DNS hijack, or someone else registering the custom domain
on a canister they control.

Mitigations now (operational, not code):
- Registrar lock and auto-renew.
- 2FA on the registrar and DNS accounts.
- DNSSEC.
- Monitoring of the `_canister-id` TXT record and the boundary-node custom-domain registration.

The possible later fix gets its own spec, `spec/derivation_origin.md`, which this spec does not
write. In outline: set `derivationOrigin` to the frontend canister URL, list app.sneeddao.com in
`ii-alternative-origins`, and add a "move my account" wizard, since the new principals are
different.

Requirement for this spec: native BTC must stay **sweepable** to a new principal.
- The new principal's BTC address can be computed offline (§3.1).
- A migration is then just a "sweep": spend every UTXO to that address, with no change output
  (§6.3).
- No state is keyed by the BTC address alone. The send log and labels are keyed by principal
  and move with the account.

## 4. Custody and trust, stated honestly

What holds the key:
- The secret key exists only as threshold shares on the IC's fiduciary subnet (`key_1`).
- No seed phrase exists, and nobody at Sneed can export the key.
- The user cannot export it either: there is no backup outside the IC. If the IC's threshold
  ECDSA service stopped, BTC at these addresses could not be moved. That is the same trust as
  ckBTC's minter.

Who can sign:
- Any code that holds a delegation for the user's principal can call `btc_caller_send` and
  move the user's BTC.
- In practice that means:
  1. Our frontend, while the user is logged in.
  2. Any agent or dapp the user delegated to with the signer in its targets. `ConnectAgent`
     scopes never include `grghe-…` unless the user adds it in a custom scope, and §9 blocks it
     for dapps.
  3. Whoever controls app.sneeddao.com (§3.3).

The signer canister:
- Its governance is intended to equal the IC's threshold-signing APIs ("upgrade ONLY when there
  is a security flaw / the threshold APIs change"), and builds are reproducible
  ([README](https://github.com/dfinity/chain-fusion-signer#governance)).
- A malicious signer upgrade could sign for anyone. We accept that the same way we accept the
  IC itself.

**Frontend integrity is custody-critical.**
- The frontend builds the transaction (destination, amount, fee, UTXOs), so a compromised
  frontend can drain BTC exactly as it can drain ICRC tokens today.
- The prod frontend is going to be DAO-controlled (`frontend-dao-handoff-plan`). From then on,
  a frontend upgrade proposal is a custody event for every user's BTC. Proposal reviewers must
  treat it that way, and the release notes for any build that touches `utils/btc/` must say so.
- Today the CSP allows `https://www.googletagmanager.com` in `script-src` plus `'unsafe-eval'`
  (`public/.ic-assets.json5`). That script is plain Google Analytics (gtag.js, `G-K4F17LJ7KE`
  in `index.html`), not a Tag Manager container, but it is still Google-served code running on
  the wallet origin, where it could sign. **Decided (2026-10-23, Q2):** analytics stay on normal
  pages and are kept off every page that can sign BTC. Because gtag.js, once loaded, stays in
  the SPA for every later route, "kept off" means a separate entry: `sign.html` and a
  `btc.html` send view (own strict headers, no Google scripts, no framing, no `'unsafe-eval'`
  if the build allows it); the SPA hands over to them with a normal navigation. Built for
  `btc.html` (A2): a second Vite entry; its built HTML and chunks contain no gtag, no `eval`, no
  `new Function` and no WebAssembly (agent-js 2.4 verifies BLS in plain JS), so its CSP has
  `script-src 'self'` only, `frame-ancestors 'none'`, `X-Frame-Options: DENY` and
  `camera=(self)` for the QR scanner. Same origin, so `AuthProvider` reads the same `AuthClient`
  storage and the session carries over.
- The CSP's `frame-ancestors` allows tacodao.com and others to iframe the app, which invites
  clickjacking. BTC send and the signer page must refuse to run inside a frame (§9.1).

**Data the frontend trusts:**
- UTXOs come from the Bitcoin canister's query endpoints. These answer from a single replica
  and are uncertified ([forum](https://forum.dfinity.org/t/introducing-non-replicated-queries-for-bitcoin-canister/29335)).
- A lying replica cannot make us overpay the fee. P2WPKH signatures commit to each input's value
  (BIP-143), so a wrong UTXO value only produces an invalid transaction, which wastes cycles but
  loses no BTC.
- A lying replica can hide funds or show phantom ones. Balances are cross-checked by an update
  call before large sends (§5.2).

## 5. Call flows: native BTC

### 5.1 Canisters and methods

| What | Canister | Method (candid) | Cost to the user |
|---|---|---|---|
| Address | Chain Fusion Signer `grghe-syaaa-aaaar-qabyq-cai` | `btc_caller_address : (GetAddressRequest { network; address_type = P2WPKH }, opt PaymentType) -> (variant { Ok : record { address : text }; Err })` | 0.079B cycles (we derive it offline instead, §3.1) |
| Balance, verified | signer | `btc_caller_balance : (GetBalanceRequest { network; address_type; min_confirmations : opt nat32 }, opt PaymentType)`, which is **deprecated** | 0.113B cycles |
| UTXOs and balance, fast | Bitcoin canister mainnet `ghsi2-tqaaa-aaaan-aaaca-cai` (testnet `g4xu7-jiaaa-aaaan-aaaaq-cai`; check with `get_config`) | `bitcoin_get_utxos_query`, `bitcoin_get_balance_query` (query, paged with `next_page`, `filter = min_confirmations or page`), `get_blockchain_info` | free (query) |
| Send | signer | `btc_caller_send : (SendBtcRequest { fee_satoshis : opt nat64; network; utxos_to_spend : vec Utxo; address_type; outputs : vec BtcTxOutput { destination_address; sent_satoshis } }, opt PaymentType) -> (variant { Ok : record { txid : text }; Err : SendBtcError })` | 95B + 37B per input + 1B per output (change included) |
| Sign only | signer | `btc_caller_sign : (SendBtcRequest, opt PaymentType) -> (variant { Ok : record { txid; signed_transaction_hex }; Err })` | 74B + 37B per input |
| Payment | cycles ledger `um5iw-rqaaa-aaaaq-qaaba-cai` | `icrc2_approve { spender = { owner = grghe-… } }`; the signer charges with `withdraw_from` when the call carries `opt variant { CallerPaysIcrc2Cycles }` | ledger fee 0.1B per approve; each `withdraw_from` uses **charge + 0.1B** of the allowance and the balance (cycles-ledger `storage.rs`, `amount_with_fee`) |
| Fee rates | mempool.space (decided, Q4) | `GET /api/v1/fees/recommended` (testnet4: `/testnet4/api/…`) | free; see §5.4 |

Checked 2026-10-23: the deployed signer (module hash `0x6596fbb4…`, candid with `btc_sign_prehash`, i.e.
v0.5.1 or later) has the same Bitcoin candid, builder and fee constants as `main`. `Network::testnet`
is Bitcoin testnet4 (the signer validates addresses with `bitcoin::Network::Testnet`, so `tb1…`, `m…`,
`n…`, `2…` addresses). `btc_caller_send` prices `outputs.len() + 1` outputs whether or not change is
made (`lib.rs`), and takes its fee **before** building: a typed `BuildP2wpkhError` or
`InternalError` has already cost the signing cycles; a `PaymentError` has not.

Sources:
- Signer fee constants: [methods.rs](https://github.com/dfinity/chain-fusion-signer/blob/main/src/signer/api/src/methods.rs).
- Bitcoin canister: [candid.did](https://github.com/dfinity/bitcoin-canister/blob/master/canister/candid.did).
- The signer README's approve-then-`CallerPaysIcrc2Cycles` example: [README](https://github.com/dfinity/chain-fusion-signer#command-line).

Signer facts that shape the design, from [tx_utils.rs](https://github.com/dfinity/chain-fusion-signer/blob/main/src/signer/canister/src/sign/bitcoin/tx_utils.rs),
[fee_utils.rs](https://github.com/dfinity/chain-fusion-signer/blob/main/src/signer/canister/src/sign/bitcoin/fee_utils.rs)
and [bitcoin_api.rs](https://github.com/dfinity/chain-fusion-signer/blob/main/src/signer/canister/src/sign/bitcoin/bitcoin_api.rs):
- **We choose the UTXOs.** The signer spends exactly `utxos_to_spend`.
- **Change.** It adds one change output back to the source address when the remainder is
  ≥ 1,000 sats. A smaller remainder silently becomes fee.
- **No opt-in RBF.** Every input has `nSequence = 0xFFFFFFFF`, so BIP-125 replace-by-fee is not
  signalled. Version 2, locktime 0, `SIGHASH_ALL`.
- **Default fee.** With `fee_satoshis = null`, the fee is the median of
  `bitcoin_get_current_fee_percentiles` × (68·inputs + 31·outputs + 11) vbytes, where outputs
  **exclude** change. That underestimates, so **we always pass `fee_satoshis` explicitly**.
- **Destinations.** Any address type the `bitcoin` crate parses for the right network is
  accepted (P2PKH, P2SH, P2WPKH, P2WSH, P2TR).
- **Broadcast.** `btc_caller_send` broadcasts with `bitcoin_send_transaction` on the IC's
  Bitcoin adapter. Success means "handed to the adapter", not "in the mempool".

### 5.2 Balance and receive

1. Address: `utils/btc/address.js` derives it with `@dfinity/ic-pub-key` for (signer, principal,
   network) and caches it per principal (the same pattern as `ADDR_CACHE` in `BtcConvert.jsx`).
   On the first send we call `btc_caller_address` once and refuse to continue if the two differ.
2. UTXOs: `bitcoin_get_utxos_query({ network, address, filter = null })`, paging until
   `next_page = null`. Keep `tip_height` to compute confirmations (`tip_height − height + 1`).
3. Balance:
   - **Confirmed** = Σ UTXOs with ≥ 1 confirmation that are not locked by a pending send (§5.5).
   - **Pending in** = incoming outputs we know of with < 1 confirmation. The Bitcoin canister
     only sees blocks, so mempool incoming needs an explorer (Advanced, opt-in, §5.6).
   - **Pending out** = change outputs of our own pending sends.
4. Cross-check (built A4, §12.3): before any send above a threshold (25% of the balance, or above
   1,000,000 sats, and every sweep) or when the user taps "verify", call `bitcoin_get_balance` through `btc_caller_balance` (0.113B). Despite
   the deprecation it is the only update path a frontend can pay for. If it disagrees with the
   query sum, block the send and say why.
5. Refresh: on wallet open, after each send, and every 60 s while the BTC view is visible.
   Timers in the page only; no polling in the background.

### 5.3 Send

1. Inputs: destination (validated on the client for network and type, with a warning on a
   testnet address in mainnet mode), amount or "max", and fee tier (§5.4).
2. UTXO selection (`utils/btc/select.js`, pure, tested):
   - Candidates are confirmed UTXOs (≥ 1 confirmation; Advanced allows 0-conf own change) that
     no pending send has locked.
   - Pick largest-first until `amount + fee(n_in, n_out) ≤ Σ`, then try to drop the smallest
     inputs while it still fits. Fewer inputs means fewer signatures, and each costs 37B cycles.
   - The plan decides the change itself and passes `fee_satoshis` to match: change ≥ 1,000 sats →
     fee = the estimate with the change output; otherwise fee = the **whole remainder** (estimate
     without change + the "dust added to fee"), so the signer's own dust rule never fires
     silently. A property test checks every plan against a model of the signer's builder.
   - vsize = 11 + 68·inputs + Σ output sizes by type (P2WPKH 31, P2PKH 34, P2SH 32,
     P2WSH/P2TR 43), with change counted when it is ≥ 1,000 sats. This matches Oisy's
     constants ([btc-utxos.utils.ts](https://github.com/dfinity/oisy-wallet/blob/main/src/frontend/src/btc/utils/btc-utxos.utils.ts)).
   - "Max" or sweep: every candidate goes in, there is no change, and amount = Σ − fee.
   - Refuse an amount below 1,000 sats. If the change would fall below 1,000 sats, show "≈ N
     sats added to fee".
3. Cost summary:
   - Network fee: sats, plus `formatValue` of their value.
   - Signing: `95B + 37B·inputs + 1B·(outputs + 1)` cycles (the signer always prices one extra
     output for change, even when none is made), plus 0.1B for each ledger charge
     (`withdraw_from`) and 0.1B for the approve when a new one is needed.
   - The amount the recipient gets.
   - Fat-finger guard: a fee above 10% of the amount, or above 3× the "Fast" rate, needs an
     extra confirm in the same dialog. No JS popup.
4. Payment:
   - If the allowance to the signer on the cycles ledger is below Σ (charge + 0.1B) for the calls
     about to be made, or expires within 10 minutes, one `icrc2_approve` for exactly that amount,
     with `expires_at` = now + 1 h (as `APPROVAL_TTL_NS` in `ckMinters.js`) and
     `expected_allowance` = the allowance just read. The first send on a device also pays the
     0.079B address check (§5.2 step 1) under the same approve.
   - Advanced can set a standing allowance with a cap.
   - If the cycles balance is short: "Top up signing credit" (§7).
5. Persist, then send:
   - Write a pending record `{ id, network, utxos, outputs, fee, expectedTxid, createdAt,
     state: 'submitting' }` to the pending store (§5.5) **before** the call.
   - `expectedTxid` is computed locally. A segwit txid excludes witnesses and the signer's
     transaction is deterministic (inputs in our order, outputs in our order, then change), so
     we know the txid before signing.
   - Call `btc_caller_send(req, opt CallerPaysIcrc2Cycles)`.
6. Result:
   - `Ok { txid }` with txid = expected: state `broadcast`. Show a mempool.space link
     (`mempoolTx` already exists in `BtcConvert.jsx`).
   - txid ≠ expected: record the real txid and log a warning, since our builder has drifted.
   - Errors are mapped to text (`utils/btc/errors.js`, in the style of
     `btcWithdrawErrorText`):
     - `BuildP2wpkhError.NotEnoughFunds { available; required }`
     - `InvalidDestinationAddress`, `WrongBitcoinNetwork`
     - `PaymentError.InsufficientFunds { needed; available }`, which leads to the top-up
     - `LedgerWithdrawFromError`
     - `InternalError { msg }`
     - A typed `Err` means nothing was broadcast, so the record's state becomes `failed`.
   - Trap, timeout, or the network dropped: state `unknown`. Recovery is in §8.

### 5.4 Fee choice

Decided (Q4 and the user's fee decisions, 2026-10-23): fee suggestions come from
**mempool.space**, `GET /api/v1/fees/recommended` (staging: `/testnet4/api/v1/fees/recommended`),
fetched by the browser. Tiers: **Slow** = `hourFee` (≈ 6 blocks), **Normal** = `halfHourFee` (≈ 3),
**Fast** = `fastestFee` (≈ 1), plus a visible **Custom** sat/vB option. Each tier shows "≈ N sats".

- **Named source.** A short note with a link next to the fee choice says the suggestions come from
  mempool.space, a third party.
- **Custom is always there.** The user can type their own rate after consulting sources they
  trust. Only nonsense is refused (not a number, ≤ 0, more than 3 decimals, above 10,000 sat/vB);
  unusual but valid rates (below 1 sat/vB, below "Slow", above 3× "Fast", above 500) pass with a
  clear warning, and the §5.3 fat-finger tick still applies.
- **Bounds on the answer.** Every value must be a finite number in (0, 2000]; otherwise the whole
  answer is refused and the form falls back to Custom. Rates are raised to ≥ 1 sat/vB and made
  monotone. Cached in memory for 60 s. Never `fee_satoshis = null` (the signer's median
  underestimates and gives no preview).
- **Privacy.** Fees are fetched only while the send form is open, never on wallet or card load;
  only the generic recommended-fees endpoint is called from the send flow (no address, no txid);
  `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`. Advanced has "Don't look up fees (enter
  my own)", remembered per browser (localStorage in try/catch). Explorer links and the Activity
  view's "Ask mempool.space" (which sends one txid) are opt-in clicks.
- **CSP.** `https://mempool.space` is in `btc.html`'s `connect-src` only; the app's pages never
  fetch fees.

A cached `btc_fee_percentiles` query on the Sneed backend (timer-refreshed) can come later as a
cross-check.

### 5.5 Pending store and UTXO locks

The Bitcoin canister keeps reporting a UTXO as unspent until the spending transaction is mined.
So a second send right after a first one would pick the same UTXOs and conflict. Oisy keeps
pending sends in its backend for the same reason (`addPendingBtcTransaction`,
[btc-send.services.ts](https://github.com/dfinity/oisy-wallet/blob/main/src/frontend/src/btc/services/btc-send.services.ts)).

- Records: `{ id, expectedTxid, txid, utxos[outpoint], outputs, fee, feeRate, state:
  submitting|broadcast|unknown|confirmed|failed|replaced|dropped, createdAt, kind:
  send|toCkbtc|sweep, ckbtc? }`.
- Storage (target): the user's backend layout store keyed by principal, so it syncs across
  devices, with a localStorage mirror. If the store is unreadable, **block sends** ("can't check
  pending sends") instead of risking a conflict, as Oisy does with
  `PendingTransactionsNotAvailable`.
- Storage (built, A2): **localStorage only**, key `sneed_btc_pending_v1:<network>:<principal>`,
  every access in try/catch, write-then-read-back before the signer is called, and a load-modify-
  save on every update so two tabs don't undo each other. The backend layout store
  (`get/set_wallet_layout`) holds only lists of principals, so syncing needs a backend change by
  proposal. Until then a send from another device is not locked here; a conflicting second send
  fails at the network (no BTC lost, the signing cycles are).
- A record still `submitting` when the page loads again means the page closed during the call:
  it becomes `unknown`, never `failed`.
- **Locked UTXOs** are inputs of records in `submitting`, `broadcast` or `unknown`. They are
  excluded from selection.
- **Confirmed** when the record's inputs have left the UTXO set, or `txid` is seen at a height.
  A record then shows confirmations up to 6 and is archived.

### 5.6 History

The Bitcoin canister has no history API, only current UTXOs. History is built from:
1. **Our log**: every send, sweep and conversion from the pending store, with txid, fee,
   cycles paid and destination. This is complete for what Sneed Wallet did.
2. **Receives from UTXOs**: each UTXO not created by our own sends is "received at height h".
   Spent receives remain in our cache (`utils/btc/history.js`, IndexedDB, per principal).
3. **Full history (Advanced, opt-in)**: the mempool.space address API. The UI says this
   tells mempool.space which address the user is looking up, and asks once. It is never
   called by default.

### 5.7 ETH and EVM later

Same pattern:
- Address via `eth_address_of_caller` (0.077B), or offline with `ic-pub-key`.
- `eth_sign_transaction` (EIP-1559, 37B cycles) per transaction.
- Nonce, gas and broadcast through the EVM RPC canister or public RPC.
- ERC-20 sends are call data.
- ETH ↔ ckETH and ERC-20 ↔ ckERC20 reuse `ckethDepositAddress`, `ckethWithdraw` and
  `ckerc20Withdraw` in `ckMinters.js`. The deposit path calls the helper contract from the
  user's own address instead of MetaMask.

This gets its own section in a later revision of this spec.

## 6. Native ↔ ckBTC

Both directions reuse `utils/ckMinters.js` (ckBTC minter `mqygn-kiaaa-aaaar-qaadq-cai`, ledger
`mxzaz-hqaaa-aaaar-qaada-cai`). The `/convert` page (`components/convert/BtcConvert.jsx`) keeps
working for external wallets.

**Built (A3, 2026-10-23; not yet released).** `utils/btc/moves.js` (pure flows, mocks injected),
`btc/useMoves.js` (the runner), `components/btc/BtcMove.jsx` (Move tab), Moves in
`BtcActivity.jsx`, a `move` mode in `BtcSend.jsx`; tests `test/canisters/tests/btc-moves.test.js`
(31, incl. the mock minter + a real ICRC ledger on PocketIC). As built:
- **Where.** Both directions run on `btc.html` (tab Move, `#move` / `#move-tobtc`). Native → ck
  signs Bitcoin, so it must (§4). ck → native signs nothing on Bitcoin, but it decides where the
  minter pays out (the address this page derives) and its record and tracking belong in the same
  Moves list; one page and one set of rules is simpler than splitting. The card only navigates:
  "Move to ckBTC" on the native row, "Move to my Bitcoin address" on the ckBTC Main row
  (`TokenPocketBreakdown` `mainActions`).
- **Per network** (`network.js` `CK_PAIRS`, `ckMoveFor`): mainnet (prod beta, staging developer
  mode) ↔ ckBTC; staging testnet4 ↔ **ckTESTBTC** (ledger `mc6ru-gyaaa-aaaar-qaaaq-cai`, minter
  `ml52i-qqaaa-aaaar-qaaba-cai`; checked anonymously 2026-10-23: dashboard network testnet with
  testnet4 links, 4 confirmations, check fee 100, min deposit 300, min retrieve 5,000 sats; the
  candid of every method used matches mqygn). On testnet the ckBTC row of the (mainnet ckBTC)
  card gets no button (`ckRowMoveShown`); the Move tab uses ckTESTBTC. No pair, no button, no
  minter or ledger call while the surface is off (prod with the switch off).
- **Minter terms read 2026-10-23 (mainnet):** min_confirmations 4, check fee 100 sats
  (`get_deposit_fee`), deposit_btc_min_amount 300, retrieve_btc_min_amount 50,000; estimate for
  100k sats: Bitcoin fee 212 + minter fee 300.

### 6.1 Native → ckBTC ("Move to ckBTC")
1. `ckbtcDepositAddress(makeActor, me, subaccount)` gives the minter's deposit address for the
   target pocket: Main, or any wallet pocket's subaccount.
2. Show the minimum deposit and the check fee from `ckbtcInfo` (`get_minter_info`), the network
   fee and the signing cost.
3. Send as in §5.3, with `kind: toCkbtc` and `ckbtc: { owner, subaccount }` on the record.
4. After broadcast, watch confirmations: poll the minter's `get_known_utxos` and the Bitcoin
   canister. Once the minter's `min_confirmations` are reached, call `ckbtcCheckDeposit`
   (`update_balance`).
   - Retry with backoff while the result is `NoNewUtxos { current_confirmations }`.
   - `Minted` closes the record.
   - `Checked`/`Tainted` results are shown as `updateBalanceErrorText` already does.
5. The record shows "minted N ckBTC to <pocket>" with the ledger block index.

As built: target is Main only (pocket subaccounts later). The deposit address comes fresh from
`get_btc_address { owner = me }` each time the tab opens (no cache) and must parse for the page's
network. Minimum = max(1,000 sats send minimum, deposit_btc_min_amount, check fee + 1), checked
before review and again before signing. The pending record (kind `toCkbtc`) carries `ckbtc`
{ minter, ledger, owner, depositAddress, vout 0, minConfirmations, checkFee, status
waiting|checked|minted|too_small|tainted, confirmations, checks, nextCheckAt, mintedAmount,
mintBlock, message }. Phases: submitting → (unknown) → waiting_confs → minting → minted, or
failed / replaced / dropped (the send) / too_small / tainted (the minter). Confirmations come from
the free Bitcoin canister query on the deposit address; `update_balance` runs (as the user) every
60 s tick once ≥ min_confirmations, or once 4 × 10 min have passed when the output isn't visible,
with backoff (not seen / pending 1, 2, 4 … 15 min; Checked 2 min; busy 1 min; GenericError 5 min).
Only the record's own outpoint decides; other deposits minted by the same call are mentioned. When
the minter doesn't report it, `get_known_utxos` tells "minted earlier". "Check / finish" runs a
check at once (no backoff). Records survive reloads and other tabs (load-modify-save; a final
state set by another tab is never overwritten). The minter's own `get_known_utxos` polling of
step 4 is replaced by the Bitcoin canister read plus `update_balance`'s pending list.

### 6.2 ckBTC → native ("Move to Bitcoin address")
- `ckbtcWithdraw(makeActor, { address: myBtcAddress, amount, fromSubaccount })`, which runs
  `icrc2_approve` then `retrieve_btc_with_approval`.
- Plan and minimums with `planBtcWithdrawal`. Track with `ckbtcWithdrawals` /
  `btcStatusText`.
- When the minter's txid confirms, the UTXO shows up in §5.2 on its own.
- No signer cycles are needed. The minter pays the network fee out of the amount.

As built: the allowance is amount + one ledger fee (headroom; the PocketIC test with a real ICRC
ledger shows the burn takes exactly the amount, so 10 sats stay approved until the 1-hour expiry);
max = balance − ledger fee. `ckbtcWithdraw` takes `approveAmount` and tags a typed minter `Err`
(`minterErr`), so the record says failed (nothing burned) vs unknown (no answer after the approve:
"Show the minter's list" via `retrieve_btc_status_v2_by_account`, then Dismiss). Records live in
their own store `sneed_btc_moves_v1:<network>:<principal>` (states approving → requesting →
requested → confirmed, or failed / unknown / too_low / reimbursing / reimbursed / dismissed),
tracked with `retrieve_btc_status_v2` every tick and on Refresh. The payout address is the one this
page derives; before the first payout on a device it is checked once against the signer
(`btc_caller_address`, 0.079B cycles from signing credit), as before a first send.

### 6.3 Sweep (principal migration, emptying)
"Send all to address X": every unlocked UTXO goes to one output, with no change, at the chosen
fee rate. The destination can be another principal's Sneed Wallet address, derived offline from
a principal entered through `PrincipalInput` (§3.3). In that case the dialog shows both the
principal and the derived address.

## 7. Costs

1 T cycles = 1 XDR, fixed by protocol. The UI shows cycles plus `formatValue` of their value,
with the XDR rate from the CMC.

| Operation | Signer cycles | Other |
|---|---|---|
| Show address | 0 (derived offline) | — |
| Verify address once | 0.079B | ledger fee 0.1B |
| Verified balance | 0.113B | 0.1B |
| Send, 1 input → 1 recipient + change | 95 + 37 + 2·1 = **134B** | 0.1B, plus network fee ≈ 141 vB × rate |
| Send, 2 inputs → 1 + change | **171B** (the signer's own grace default) | ≈ 209 vB × rate |
| Each extra input | +37B | +68 vB |
| Sign only (no broadcast) | 74B + 37B·inputs | broadcast elsewhere |
| Approve the signer | — | 0.1B (cycles ledger fee) |
| Native → ckBTC | as a send | minter check fee + minimums (`get_minter_info`) |
| ckBTC → native | 0 | ckBTC ledger fee + minter fee (`estimate_withdrawal_fee`) |
| ETH signature (later) | 37B | gas |

**Signing credit.** Users pay from their own cycles-ledger balance.
- "Top up from ICP" does an ICP transfer to the CMC's subaccount for the user's principal with
  memo `MINT` (`0x544e494d`), then `notify_mint_cycles { block_index; to_subaccount = null;
  deposit_memo = null }`, which mints straight to the user's cycles-ledger account. That is the
  same move as Oisy's TCYCLES. Built as `mintCyclesWithIcp` in `utils/cyclesTopUp.js`, which reuses
  the canister top-up's pending-record machinery (dedup by `created_at_time`, never pays twice);
  its record is keyed `cycles-ledger:<principal>` and only that principal may notify it.
- The DAO could sponsor sends through `PatronPaysIcrc2Cycles(Account)`, a patron account that
  pays for callers. Its allowance semantics must be verified against the papi library before any
  design. This is open question Q5.

## 8. Failure handling and recovery

| Case | Detection | Recovery |
|---|---|---|
| Call timed out or trapped after signing (`unknown`) | No `Ok`/`Err` came back | Look for `expectedTxid` via the Bitcoin canister (inputs spent once mined) and, opt-in, mempool.space (`GET /api/tx/<txid>`: 404 = unknown; `/tx/<txid>/status` answers `confirmed: false` even for unknown txids, so it can't tell "never seen"). If it is still unseen after 30 min: **re-issue the identical `btc_caller_send`**, same UTXOs, outputs and fee. The txid is the same, so a duplicate broadcast is harmless. This costs the signing cycles again, and the UI says so. |
| Signed with `btc_caller_sign` but not broadcast | The record holds `signed_transaction_hex` | "Broadcast": paste-ready hex, plus a one-click POST to mempool.space (opt-in, third party). |
| Broadcast but stuck (low fee) | 0 confirmations after N = 2 blocks, or the rate is below the current "Slow" (built A4, §12.3) | **Speed up** (full RBF): a new `btc_caller_send` with the **same inputs** and a higher fee that also pays the old fee plus the incremental relay fee. The signer does not signal BIP-125, so this relies on full-RBF relay, which Bitcoin Core enables by default since 28.0 ([release notes](https://bitcoincore.org/en/releases/28.0/)). That must be confirmed on testnet through the IC adapter (Q6). **CPFP** alternative: spend our own unconfirmed change outpoint, which we pass by hand, with a high fee. |
| Dropped from mempools | Inputs still unspent after ~14 days and not in the mempool | Mark the record `dropped`, which unlocks the UTXOs. The user can resend. |
| Replaced | Inputs spent by a different txid | Record → `replaced`, linked to the new txid. |
| Pending store unreadable | Backend read fails | Block sends with the reason. Receive still works. |
| Address mismatch (offline vs signer) | §5.2 step 1 | Block, log, report to support (`i-am-customer-support`): the offline derivation or the signer has changed. |
| Bitcoin canister behind | `get_blockchain_info` tip is far behind mempool.space's (when opted in) | Banner: "the IC's Bitcoin view is N blocks behind; balances may be stale". |
| Cycles too low mid-flow | `PaymentError.InsufficientFunds` | Top-up flow, then retry the same record. |

Every step writes to the record. "Help → BTC send log" shows the records with copyable JSON, so
support can explain and fix any case.

## 9. Sign in with Sneed Wallet (ICRC signer)

### 9.1 Shape
- **A separate entry `sign.html`** on app.sneeddao.com, not a route inside the SPA. That buys
  three things:
  - **Its own bundle.** `@dfinity/oisy-wallet-signer` 6.0.0 peers on `@icp-sdk/core ^4`,
    `@icp-sdk/canisters ~3.1`, `@dfinity/utils ~4` and `zod ^4`, while the app is on
    `@dfinity/agent ^2`.
  - **Its own headers.** `.ic-assets.json5` headers match files, and SPA routes all serve
    `index.html`. `sign.html` gets `frame-ancestors 'none'`, `X-Frame-Options: DENY`, and no
    tag-manager scripts.
  - **A small audit surface.**
- **Same origin, same principal.** It reads the II session the app already stored. Verify that
  the newer auth client reads the agent-v2 `AuthClient` storage. If not, the popup logs in to II
  itself; the principal is the same because the origin is the same.
- **Frame-busting in JS too.** If `window.top !== window.self`, the page refuses to run. The
  BTC send view does the same.
- **Library.** [`@dfinity/oisy-wallet-signer`](https://github.com/dfinity/oisy-wallet-signer)
  `Signer.init({ owner: identity, host })`, with prompts registered for
  `ICRC25_REQUEST_PERMISSIONS`, `ICRC27_ACCOUNTS`, `ICRC21_CALL_CONSENT_MESSAGE` and
  `ICRC49_CALL_CANISTER`. The transport is ICRC-29 postMessage.
  - Permissions expire after 7 days by default.
  - Without ICRC-21 on the target, the library decodes only `icrc1_transfer`, `icrc2_approve`
    and `icrc2_transfer_from`, and marks them as a warning.
  - The library handles one prompt at a time.
  - Standards: [wg-identity-authentication](https://github.com/dfinity/wg-identity-authentication)
    (ICRC-21/25/27/29/34/49).
- **Dapp side.** Dapps connect with `IcrcWallet.connect({ url: 'https://app.sneeddao.com/sign.html' })`
  or any ICRC-29 relying party (`@icp-sdk/signer` 6.1.0, IdentityKit).

### 9.2 Security rules
1. **Per-origin permissions.** Shown and revocable under Settings → Connected apps: origin,
   scopes, expiry, bound pocket, last call. The origin comes from the ICRC-29 message event
   and is shown in full, with punycode decoded and look-alikes flagged.
2. **Block by default** (the signer refuses; no "approve anyway"):
   - Chain Fusion Signer `grghe-syaaa-aaaar-qabyq-cai`. A dapp must never sign BTC or ETH as
     the user.
   - Management canister `aaaaa-aa`: `update_settings`, `install_code`, `stop`, `delete`.
   - Cycles ledger `icrc2_approve` to anything.
   - NNS governance `rrkah-fqaaa-aaaaa-aaaaq-cai` and every SNS governance canister:
     `manage_neuron` and similar.
   - Sneed Lock, Sneedex and the user's bots (neuron managers, trading bots).
   - Any method without a decoder and without an ICRC-21 message.
3. **Strong-warning tier** (allowed after a typed confirmation in the in-app dialog):
   - `icrc2_approve` with no `expires_at`, or with an amount above the balance.
   - ICRC-37 `approve_collection`.
   - Any `icrc1_transfer` to an account that is not in the user's names or contacts and is
     above 10% of the balance.
   - ICRC-7 transfers.
4. **Decoders.**
   - ICRC-21 first. Then our own decoders for ICRC-1/2/7/37, built on the existing
     `CandidValue` / `ProxyPayloadView` renderers and the candid we already ship for Sneed
     canisters.
   - The target canister's name and token-safety verdict are shown next to the summary.
   - Raw candid is always one tap away under Advanced.
   - Sneed canisters gain `icrc21_canister_call_consent_message` later, by proposal. New
     methods must join each canister's ingress-guard `msg` variant.
5. **Pockets as safe accounts.**
   - ICRC-27 returns the accounts the user picked for this origin. The default is a fresh
     pocket named after the origin, with Main as opt-in.
   - When a connection is bound to pocket P, ledger calls must use `from_subaccount = P`; any
     other subaccount is blocked.
   - Stated honestly in the UI: a pocket limits **ledger** calls only. Any other call acts as
     the whole principal, so non-ledger calls always show "acts as your account, not just this
     pocket".
6. **No silent calls.** Every ICRC-49 call gets a popup approval. The user may set "auto-approve
   reads" only for query-only methods.
7. **Logging.** Every request is appended to a local log: origin, method, target, decision,
   result. Support can read it.

### 9.3 ICRC-34 scoped delegations (later, opt-in)
- The library does not implement ICRC-34, and Oisy deliberately does not offer it.
- We already issue scoped, expiring delegations in `ConnectAgent`. ICRC-34 would issue a
  delegation with `targets` limited to the dapp's own canisters, after the block list is
  removed from them. Ledgers, governance, the signer, `aaaaa-aa` and Sneed Lock can never be
  targets.
- Expiry is at most 8 h, revocable by logging out.
- Off by default, per origin, behind Advanced.

## 10. Wallet UI and pockets

- **Bitcoin card.**
  - Native BTC joins the ckBTC token card as a pocket of a new kind, `chain`. It has
    `adapterId: 'btc_native'`, `account: null`, `address`, and a balances map keyed by the
    pseudo-ledger `btc:mainnet`.
  - The card's total = ckBTC across pockets + native BTC (confirmed). The existing "in N
    pockets ▸" disclosure lists them.
  - Q3 asks whether to merge into one "Bitcoin" card or keep a separate native card.
- **Adapter.** `utils/pockets/adapters/btc_native.js` implements `listMyAccounts` (one item:
  the address), `balance`, and caps `{ receive, send, convert }`. It is registered in
  `adapters/index.js` with `enabled(ctx)` behind a feature flag.
  - Sends use §5.3, not `withdraw`.
  - A failing Bitcoin canister read shows "couldn't read Bitcoin" on that row only, as for any
    adapter.
  - `model.js` gains `KIND.chain`. Totals logic is unchanged, except that native sats are added
    to the ckBTC total only on the merged Bitcoin card.
- **Move.** Move between "Bitcoin address" and any ckBTC pocket runs §6. The move dialog shows
  the minimum, fees and the expected wait (minutes for ckBTC → BTC, ≈ the minter's
  confirmations × 10 min for BTC → ckBTC).
- **Receive QR.** The existing `QrCode` from `ConvertUi` with a `bitcoin:` URI. The QR is
  only shown on request, as for pockets.
- **Signing credit** shows as a service-balance-style row under Settings → Sneed Wallet, not
  as a token.
- **New files** (all pure logic tested with node tests):
  - `utils/btc/address.js`, `select.js`, `fees.js`, `txid.js` (non-witness serialisation for
    `expectedTxid`), `pending.js`, `history.js`, `errors.js`, `signerIdl.js`,
    `bitcoinCanisterIdl.js`, `credit.js` (signing credit), `send.js` (the send call, re-issue,
    address check)
  - `btc.html` + `btc/` (the entry without analytics)
  - `components/btc/*`
  - `sign/` (the separate entry)

## 11. Testing

- **Unit (node, in the frontend):**
  - UTXO selection and vsize/fee math, including dust-to-fee and max/sweep.
  - `expectedTxid` against transactions the signer returns on testnet (golden vectors). Until
    staging has signer-made transactions, real mainnet transactions of the signer's shape
    (P2WPKH inputs, v2, locktime 0, nSequence 0xFFFFFFFF, every output type) are the vectors.
  - Offline address = `btc_caller_address` for fixed principals (mainnet and testnet).
  - Error mapping.
  - Signer rules: block list, pocket binding, warning tiers. Each rule gets a test that fails
    without it (`fix-discoveries-with-tests`).
- **Bitcoin testnet (testnet4) through the prod signer.** The signer accepts `network =
  testnet`, so staging runs the full flow on real infrastructure for a few hundred B cycles.
  - Receive from a faucet.
  - Send 1-in and 3-in.
  - Max, sweep, sign-only plus external broadcast.
  - The timeout path: kill the tab mid-call, then recover.
  - Full-RBF speed-up, and CPFP.
  - ckBTC conversions on the ckTESTBTC minter (`ml52i-…`, on testnet4: checked 2026-10-23;
    wired as the testnet pair in A3).
- **Mainnet developer mode (staging only).** testnet4 faucets proved unusable, so sending is
  tested with a small amount of real BTC on staging. `utils/btc/network.js` switches native
  Bitcoin to mainnet only when all of these hold: the A1 triple flag is on (staging build, not
  the prod frontend id, not a prod host); the signed-in principal is on the hard-coded allowlist
  `MAINNET_DEV_PRINCIPALS` (Mr Sneed's test identity `tksci-…` only); and this browser opted in,
  by the toggle "Developer: use Bitcoin mainnet (real BTC)" under Advanced on the Bitcoin row and
  on `btc.html` (localStorage, default off), or by `btcnet=mainnet` in the URL query or hash for
  the headless test browser (`btcnet=testnet` forces it off). The network is decided once per
  page load per principal; logged out it is testnet, so nothing derives or reads a mainnet
  address early. Everyone else stays on testnet4 and never sees the option, and prod builds and
  hosts stay off whatever the principal, toggle or URL say. In the mode, everything is mainnet
  (bc1… address, Bitcoin canister ghsi2, signer `mainnet`, mainnet mempool.space fees and links),
  a red "MAINNET · REAL BTC · developer mode" banner and badge show on the card and on
  `btc.html`, the review step needs an extra tick that names mainnet, and the pending, receives
  and address-check stores stay keyed per network. Tests: `test/canisters/tests/btc-mainnet-dev.test.js`.
- **Local regtest.**
  - `dfx` with the Bitcoin adapter and `bitcoind -regtest`, plus a locally deployed signer
    wasm from its releases (`network = regtest`). This is for mining-controlled tests: stuck,
    replaced and dropped.
  - PocketIC's Bitcoin support is to be checked. If pic-js can host the Bitcoin canister and
    signer, the signer rules get canister-level tests in `test/canisters`; otherwise regtest
    via dfx only.
- **Signer (B).** A tiny test dapp page on staging that uses `IcrcWallet`, plus scripted
  hostile requests (signer target, `aaaaa-aa`, unlimited approve, wrong subaccount). Each one
  must be refused.
- **`npm run check`** in the frontend after every change.

## 12. Phased plan

| Phase | Content | Estimate |
|---|---|---|
| A0 | Prerequisites: signing credit (cycles-ledger balance, CMC mint, approve and revoke); fee-rate source (backend timer + query by proposal, mempool.space fallback, CSP `connect-src`); `btc.html` / `sign.html` entries without analytics (Q2, decided); pending store in the backend layout store | 1–1.5 weeks |
| A1 | Address (offline + verify), UTXOs, balance, receive QR, `btc_native` pocket adapter, testnet on staging | 1 week |
| A2 | Send: selection, fee tiers, cost summary, pending locks, `expectedTxid`, error texts, recovery (re-issue, sign-only), history v1 | 1.5–2 weeks |
| A3 | Native ↔ ckBTC moves, with conversion records and auto `update_balance` | 1 week |
| A4 | Speed-up (RBF and CPFP), sweep, verified balance, opt-in explorer history, support log view. Mainnet went to prod earlier, as the opt-in beta (§12.1); A3/A4 are built during it, default-on comes after. **Built 2026-10-24** (§12.3), not yet released | 1 week |
| A5 | ETH/EVM (address, send, ERC-20, ck conversions from the own address) | 4–6 weeks, separate revision |
| B1 | `sign.html` entry with the library, permissions, ICRC-27 pocket accounts, decoders, block list, connected-apps settings, test dapp | 2–3 weeks |
| B2 | ICRC-21 consent messages on Sneed canisters (proposals), signer listing (IdentityKit and the `@icp-sdk/signer` lists), docs for dapps | 1–2 weeks plus outreach |
| B3 | ICRC-34 scoped delegations, opt-in | 1–2 weeks |

Release: staging first (testnet only), then prod behind a flag. Every build that touches
`utils/btc/` or `sign/` is flagged as custody-relevant in its release note and its forum News
post (topic 899).

Status by phase (2026-10-23): A0 built (signing credit, mempool.space fee source, `btc.html`;
the pending store is localStorage for now, not the backend layout store). A1 and A2 built. **A3
built** (native ↔ ckBTC moves, §6 "As built"; staging test with real sats in developer mainnet
mode next, then release with the beta). **A4 built (2026-10-24, §12.3)**: speed-up (RBF and CPFP,
both shipped, Q6), sweep (also to another principal), the paid balance cross-check before large
sends and a "Verify balance" button, opt-in explorer history and the support log view. Not yet
released: real-money test on staging developer mainnet first (§12.3 test plan). Until it is
released, balances and UTXOs on prod come from the uncertified queries only; the beta explanation
tells users to start with small amounts.

### 12.1 Prod beta: Bitcoin (beta) switch (decided 2026-10-23)

- **Flag** (`utils/btc/network.js`): a prod build (`DFX_NETWORK === 'ic'` and the prod frontend
  id `pxtkg-…`) offers the switch. Off by default, remembered per browser in localStorage
  `sneed_btc_beta_v1` (`'1'` = on; blocked storage = off). The UI says it is per browser. The
  network is decided once per page load, so the switch reloads the page.
- **Off:** no network config, so no address derivation (receive address included), no Bitcoin
  canister read, no signer, cycles-ledger or CMC actor, no fee lookup, and the `btc_native`
  adapter is not registered. The Bitcoin card (ckBTC card, or its own card without ckBTC) shows
  one line, the switch and "What is this?"; `btc.html` shows the explanation and the switch
  instead of the send page.
- **On:** Bitcoin **mainnet** with the normal UI: a small "Beta" badge (no developer banners),
  the explanation once (dismissed per browser, `sneed_btc_beta_intro_seen_v1`), the switch
  under Advanced to turn it off, and a review tick on every send ("I checked the address and
  amount. This sends real bitcoin and can't be undone.").
- The explanation: native BTC (own bc1 address on Bitcoin) vs ckBTC (IC token backed 1:1); the
  key is held by the IC's threshold signing via DFINITY's Chain Fusion Signer and controlled by
  the user's principal (whoever acts as the principal, this site included, can move it); sends
  cost a Bitcoin network fee plus signing cycles; it is a beta; the switch is per browser.
- Prod is never testnet and never developer mode (the principal, the developer toggle and
  `btcnet=…` play no part on prod). Staging is unchanged: testnet4 by default, mainnet developer
  mode for the allowlisted test identity.
- Tests: `test/canisters/tests/btc-beta.test.js` (flag matrix, storage key, adapter on a
  simulated prod page with and without the switch, wiring of receive/send).

### 12.2 Release note (custody-relevant)

> **Custody-relevant frontend release: native Bitcoin (beta) in Sneed Wallet.** This build lets
> each user turn on "Bitcoin (beta)" on the Bitcoin card. It is off by default and remembered
> per browser. While it is off, the frontend derives no Bitcoin address and makes no Bitcoin or
> signer calls. When on, the user gets a real Bitcoin mainnet address whose key is held by the
> Internet Computer's threshold ECDSA through DFINITY's Chain Fusion Signer
> (`grghe-syaaa-aaaar-qabyq-cai`) and controlled by the user's principal. There is no seed
> phrase. Sends are built by this frontend (destination, amount, fee, coins) and signed by the
> signer for the logged-in principal, so **whoever controls the frontend can move users' BTC**,
> exactly as with ICRC tokens in the wallet today: reviewers of this and every later frontend
> upgrade should treat it as a custody change. Sends happen on `btc.html`, a separate page
> without analytics, framing or third-party scripts (§4). Each send costs a Bitcoin network fee
> plus signing cycles paid by the user. Beta limits: no speed-up or sweep, and no paid balance
> cross-check before large sends yet (A4). Files: `utils/btc/*`, `components/btc/*`, `btc/*`,
> `utils/pockets/adapters/btc_native.js`, `TokenCard.jsx`, `Wallet.jsx`.
>
> *Addition with A3:* moves between native Bitcoin and ckBTC through DFINITY's ckBTC minter, on
> `btc.html`. To ckBTC: a normal send to the minter's deposit address for the user's principal
> (`get_btc_address`), then `update_balance` after 4 confirmations. To the Bitcoin address:
> `icrc2_approve` of the minter for amount + one ledger fee (expires in 1 hour), then
> `retrieve_btc_with_approval` to the user's own address as derived by this frontend (checked once
> with the signer). Custody-relevant: the frontend chooses the deposit address and the payout
> address. Also `utils/btc/moves.js`, `utils/ckMinters.js` (`ckbtcWithdraw`), `PocketRows.jsx`.
>
> *Addition with A4:* "Speed up" for a stuck send: either a replacement that signs the same coins
> again with a higher fee taken from the change (relies on full-RBF relay; only with an explicit tick
> does the recipient get less), or a child transaction that spends the stuck send's change back to
> the user's own address with a fee that pays for both. "Sweep" sends every coin to one address,
> or to another principal's Sneed Wallet address computed by this frontend, after the user types
> the address's last 8 characters. Before a send of more than 25% of the balance or more than
> 0.01 BTC, and before every sweep, the frontend asks the signer for the Bitcoin canister's
> replicated balance (`btc_caller_balance`, 0.113B cycles) and refuses to sign when it differs from
> the coins it read; this can be skipped only under Advanced. Opt-in history from mempool.space.
> Custody-relevant: the frontend now signs second transactions over pending coins and chooses the
> sweep destination for a principal. Files: `utils/btc/speedup.js`, `sweep.js`, `verify.js`,
> `pending.js`, `send.js`, `history.js`, `signerIdl.js`, `credit.js`, `components/btc/BtcSpeedUp.jsx`,
> `BtcActivity.jsx`, `BtcSend.jsx`, `btc/BtcApp.jsx`, `btc/useBtcWallet.js`.

### 12.3 A4 as built (2026-10-24, not yet released)

Files: `utils/btc/speedup.js` (RBF/CPFP plans, offer rule, winner lookup), `utils/btc/sweep.js`,
`utils/btc/verify.js` (cross-check), `utils/btc/pending.js` (supersede groups, CPFP children),
`utils/btc/send.js` (`executeReplacement`, `executeCpfp`; `executeSend` takes `outputs`, `link`,
`tipHeight`), `utils/btc/history.js` (explorer history), `utils/btc/signerIdl.js`
(`btc_caller_balance`), `utils/btc/credit.js` (`BALANCE_CYCLES`), `components/btc/BtcSpeedUp.jsx`,
`BtcActivity.jsx`, `BtcSend.jsx`, `btc/BtcApp.jsx`, `btc/useBtcWallet.js`. Tests:
`test/canisters/tests/btc-speedup.test.js` (38).

- **Speed-up** (Activity, a pending `broadcast` send): offered after 2 blocks without a confirmation
  (`tipAtSend`, now kept on every record; older records count 10 min per block), or at once when its
  rate is below the current "Slow"; Advanced offers it any time. Not for CPFP children, sends with a
  pending child, or sends already superseded. Default rate "Fast"; default way RBF when the change pays
  for it, else CPFP, else RBF with a smaller amount (explicit tick, which names the new amount).
  - **RBF**: same inputs in the same order, same outputs; fee = max(rate × vsize, old fee + vsize ×
    1 sat/vB) (BIP-125 rules 3 and 4; 1 sat/vB also covers Core 30's lower 0.1 default), taken from
    the change; change < 1,000 sats is dropped and the whole remainder becomes fee. The new feerate is
    always above the old one. Relay: the signer doesn't signal BIP-125, so this relies on full-RBF
    (Bitcoin Core ≥ 28 by default). The IC Bitcoin adapter applies no mempool policy: it advertises
    each transaction to its peers by `inv` and serves it for 10 minutes (`transaction_store.rs`), so
    whether the replacement spreads is the peers' decision. Unverified in practice: part of the test
    plan below. If it does not spread, the original confirms as it was; only the signing cycles are lost.
  - **CPFP**: a child spends the stuck send's change output (unconfirmed, so passed by hand; the
    signer does not check UTXOs and P2WPKH signatures commit to the value we pass) back to our own
    address: child fee = ceil(rate × (parent vsize + child vsize)) − parent fee, at least 1 sat/vB
    on its own; confirmed coins are added when the change can't cover it and leave ≥ 1,000 sats. Only
    while the parent is still in mempools.
  - **Records**: a replacement joins the original's `group`, with `replaces`; the original gets
    `supersededBy` (cleared when the replacement fails). Both lock the inputs and both stay pending.
    When the inputs are spent, the version proven mined is `confirmed` and the other `replaced`
    (`replacedBy` = the winner's txid). Proof: an output of it in our UTXO set (its change), a later
    record of ours spending one of its outputs, or `minedSeen` from a lookup: the recipient's UTXOs
    on the IC Bitcoin canister (free, automatic every refresh, at most every 10 min per group) or the
    opt-in "Ask mempool.space". Without proof both wait (action `identify`). A CPFP child (kind
    `cpfp`, `parent`) is confirmed when its own output 0 is mined, replaced when its parent is replaced
    or dropped; its unconfirmed input is ignored in every "spent?" test (the old rule would have taken
    a child for confirmed at once: tested). A move to ckBTC keeps its conversion on the replacement.
- **Sweep** (Send → Advanced → "Sweep: empty this address", or `BtcSend sweepTo={{ principal }}` for
  the migration wizard): every confirmed coin not reserved by a pending send, to one output, no change.
  Policy decided: unlike Max, sweep includes the uneconomic coins (worth ≤ 68 vB × rate) so nothing
  stays behind, says how many and what they are worth, and Advanced can leave them out; reserved coins
  stay behind and the review says how much. To another principal: the address is derived offline
  (`sweepTarget`, the signer's derivation; anonymous, `aaaaa-aa` and the own principal refused),
  shown with the principal. Every sweep needs the destination's last 8 characters typed. On btc.html
  the principal is a plain text field (no naming provider on that page, small bundle, §4); the SPA
  wizard passes a principal picked with `PrincipalInput`. Records: kind `sweep` with `sweep {
  principal, uneconomicIncluded, crossChecked }`. Q1 (auto-sweep in the wizard) stays open.
- **Balance cross-check**: `btc_caller_balance` (checked against the deployed candid 2026-10-24;
  0.113B cycles per `methods.rs`, plus the 0.1B ledger fee, approved together with the send) asks the
  Bitcoin canister by a replicated update call (`ic-cdk-bitcoin-canister` `bitcoin_get_balance`,
  min_confirmations = 1) and is compared with the sum of all UTXOs the query gave (reserved ones
  included). Runs before a send whose amount + fee is above 25% of that sum or above 1,000,000 sats
  (both constants in `verify.js`, DAO-settable later), and before every sweep (and every move to
  ckBTC above the threshold). On a difference the UTXOs are read once more (a block in between is
  honest); a difference that remains, or an error, stops the send ("Nothing was sent"). A passed
  check is reused for 10 minutes on the same UTXO set. Skippable only under the review's Advanced,
  with a warning. "Verify balance" on btc.html runs the same check on request.
- **Explorer history** (Activity → Advanced): mempool.space's address API, asked once per browser
  (`sneed_btc_explorer_history_ok_v1`), then loaded when Activity opens; net amount per transaction,
  confirmed/unconfirmed, paging back. "Stop using it" forgets the yes.
- **Support log view** (Activity → Advanced): each record with its links (replaces, superseded by,
  child of, replaced by) and every logged step, next to "Copy log (JSON)".

**Real-money test plan (staging developer mainnet, Mr Sneed's ~59k sats):**
1. *RBF.* Send ~5,000 sats to an own external address with Custom 1 sat/vB (warning shown). After 2
   blocks (or at once via Advanced) press Speed up: RBF suggested, recipient amount unchanged, extra fee
   and cycles shown; replace at "Fast". Check on mempool.space that the replacement txid (= the shown
   expected txid) replaced the original (the original shows "replaced"). After a block: the replacement
   is confirmed, the original "replaced", the change shows up; nothing is double-counted.
2. *CPFP.* Again a 1 sat/vB send; Speed up → choose CPFP; check the child spends `<txid>:1` back to
   the own address and that mempool.space shows the package rate near the target. Both confirm in one
   block; Activity shows both confirmed.
3. *Cross-check.* Send > 25% of the balance (e.g. 20,000 of 59,000 sats): the review lists "Balance
   cross-check 0.21B cycles"; the send passes it. Then press "Verify balance" (matches). Check the
   cycles-ledger history: one 0.113B + fee charge per check.
4. *Optional:* sweep to an own address with 3 coins (typed confirmation), and the "rbf_reduce" path
   on a sweep record (the tick names the new amount).

## 13. Open questions

- **Q1. Sweep policy for the later principal migration.** Should the "move my account" wizard
  (spec/derivation_origin.md) sweep BTC automatically as one of its steps, or leave it to the
  user? This spec only guarantees that a sweep is possible.
- **Q2. Third-party scripts. Decided:** keep analytics on normal pages, off `sign.html` and
  `btc.html` (§3 above). Still open: who owns the GA property (if nobody active, a new
  property or a small on-chain page counter), and whether `'unsafe-eval'` can go app-wide.
- **Q3. Decided (2026-10-23):** one "Bitcoin" card, with native BTC and ckBTC as pockets.
- **Q4. Decided (2026-10-23):** mempool.space first (browser fetch, CSP `connect-src`), with sane
  bounds on the answer; a cached backend query can come later. Follow-up decisions the same day:
  name the source next to the fee choice, always offer a visible Custom rate (warnings, not
  blocks, for unusual valid values), fetch only while the send form is open with no address or
  txid, and a remembered "Don't look up fees" switch (§5.4).
- **Q5. Decided (2026-10-23):** users always pay signing cycles; no DAO sponsorship.
- **Q6. Speed-up. Built both (A4, §12.3):** RBF as the default when the change pays for it, CPFP as
  the alternative. Whether a full-RBF replacement handed to the IC's Bitcoin adapter spreads is still
  to be confirmed by the real-money test (§12.3).
- **Q7. Signer scope at launch.** Ledger-only (ICRC-1/2/7/37 plus ICRC-21-capable canisters),
  with everything else blocked, or also allow decoded calls to known third-party canisters
  behind warnings?
- **Q8. Default connected account.** A fresh pocket per origin (safer, the proposed default) or
  Main?
- **Q9. Brand surface.** Is "Sneed Wallet" a renamed wallet page inside Sneed Hub, or a
  separate PWA entry or landing page at app.sneeddao.com/wallet?
