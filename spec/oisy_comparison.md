# Oisy vs Sneed Hub wallet: comparison and gap plan

Status: research report, 2026-10-21. No code. The Oisy facts come from docs.oisy.com (llms.txt index, What's New, how-tos), github.com/dfinity/oisy-wallet (releases up to v2.6.2, 9 Oct 2026), github.com/dfinity/oisy-wallet-signer, and github.com/dfinity/chain-fusion-signer. The Sneed Hub facts come from a survey of `src/app_sneeddao_frontend/src` at commit 94101f93, plus the uncommitted working tree.

## 0. The short answer

Oisy is "the wallet for everything that is not ICP, reached from ICP". Its real advantages over us are:

1. **Native assets on other chains.** It has addresses on BTC, ETH and EVM L2s, Solana and XRP, signed by ICP threshold keys.
2. **Chain-fusion conversions.** You can turn BTC/ETH/USDC into ckBTC/ckETH/ckUSDC and back.
3. **Being a signer.** It offers "Connect with OISY" to ICP dapps, and WalletConnect to EVM, Solana and BTC dapps.
4. **Cross-chain swaps.** These run through NEAR Intents, Velora and 1Sec.
5. **Consumer polish.** QR scanner and receive QR, privacy mode, contacts, CSV export, a fiat on-ramp, payments at merchants, tip links, rewards campaigns, and an AI assistant.

On the ICP side Sneed Hub is far ahead. Oisy has no neurons, locks or LP positions, no escrow, no bots, no canisters and no governance.

Nothing Oisy does is out of reach for us. The most important finding is that **we do not need our own signing canister to get native BTC/ETH/SOL**. DFINITY's **Chain Fusion Signer** (`grghe-syaaa-aaaar-qabyq-cai`, governed like the IC's own threshold-signing API) can be called from any web app. It derives keys from the *caller's principal* and charges the caller in cycles through a cycles-ledger ICRC-2 approval. Oisy itself signs through it. So everything Oisy does is reachable from our frontend alone, plus cycles paid by the user.

## 1. Oisy today (October 2026, v2.6.x)

### Chains, addresses and keys
- **Chains:**
  - ICP: ICP and ICRC-1/2 tokens, including SNS tokens and ck tokens.
  - Bitcoin: native, swaps since v2.5.8.
  - Ethereum and EVM L2s: Base, Arbitrum, Polygon, BNB, and Robinhood Chain with tokenized stocks.
  - Solana.
  - XRP Ledger: since v2.6.0, with destination-tag warnings.
- **Keys:** ICP threshold ECDSA (secp256k1) and Schnorr (Ed25519 for Solana). The README describes Oisy as "network custody". Nobody holds a seed phrase, and you sign in with Internet Identity.
  - Oisy has used II 2.0 since 2026, including Google, Apple and Microsoft sign-in (v2.0.4).
  - Signing goes through the **Chain Fusion Signer**. Its documentation says it is NNS-governed and that upgrades happen only for security or threshold-API changes.
  - Each key's derivation path is `[schema byte, caller principal]`, so the address is a function of the user's Oisy principal.
- **Oisy's own canisters:**
  - The frontend and the backend (Rust, which stores user profiles, custom tokens, contacts and settings) are run by the Oisy team, which is incubated by DFINITY.
  - Oisy says community governance is "planned". It is **not** an SNS.
  - OISY Trade's order-book canister has NNS Root as its controller.

### ck-token conversions
- BTC↔ckBTC, ETH↔ckETH and ERC-20↔ckERC20 (ckUSDC, ckUSDT, ckBAT and others) through the DFINITY minters.
- Since v2.5.6, "Chain Fusion" is listed as a swap provider, so BTC→ckBTC happens inside the normal swap flow.
- The docs say a conversion takes minutes (ETH) to about 20 minutes (BTC).

### Swaps and trading
- **Swap providers:**
  - ICPSwap for ICRC tokens. Kong was removed in v1.9.13 because it is gone.
  - Velora (ParaSwap) for same-chain EVM swaps across 100+ sources.
  - NEAR Intents for cross-chain swaps, including BTC and XRP.
  - 1Sec.to for bridging ICP to Ethereum, Base or Arbitrum (ICP, USDC, USDT, cbBTC, CHAT, GLDT, BOB).
  - LI.FI is specced and in progress.
- The app suggests the provider with the best quote, and the user can override it.
- **OISY Trade:** an on-chain order-book DEX in one canister, with limit orders. ICP/ckUSDT and ICP/ckUSDC are among its pairs.
- **Help page:** guides for withdrawing stuck tokens from ICPSwap.

### Sign in with Oisy (Oisy as a signer)
- **ICP dapps:** the dapp opens a popup to `signer.oisy.com`. It moved off `oisy.com/sign` on 30 Jun 2026; `legacy-signer.oisy.com` serves dapps still on agent v4.
- **Standards:**
  - ICRC-29: postMessage transport.
  - ICRC-25: permission scopes, which expire after 7 days.
  - ICRC-27: accounts. The dapp sees the user's **Oisy principal**, a single account.
  - ICRC-49: call canister. Every update call needs a popup approval.
  - ICRC-21: consent messages fetched from the target canister.
  - Oisy has a built-in decoding fallback for `icrc1_transfer`, `icrc2_approve` and `icrc2_transfer_from`.
  - **No ICRC-34 delegations.** A dapp never gets a session key; it must ask for every call.
- **Libraries:**
  - `@dfinity/oisy-wallet-signer` (Signer for wallets, IcpWallet/IcrcWallet for dapps). It is limited to ICP/ICRC transfers and approvals.
  - `@icp-sdk/signer`, formerly `@slide-computer/signer`.
  - `@nfid/identitykit`, a React "connect wallet" modal that lists Oisy.
- **WalletConnect:** for EVM, Solana and Bitcoin dapps (Uniswap and others).
  - Multiple sessions, with deep links through the Universal Scanner.
  - EIP-712 struct naming, Solana transaction simulation, scam-flagged connections refused, and a choice of gas priority.
- **App Explorer:** a curated dapp directory, including the NNS app and Liquidium.

### Everything else
- **Collectibles (NFTs):** EXT (Entrepot, Tonic, DGDG) and ICRC-7 since v2.1.0. Spam review, media hidden by default, and filtering by standard.
- **Earn and Borrow:**
  - Harvest Autopilot vaults (EVM USDC yield).
  - Liquidium lending and borrowing (BTC, ETH, ICP, ckBTC, ckUSDC, ckUSDT).
  - **No ICP or SNS neuron staking.** Oisy only links to the NNS app.
- **Buy:** third-party on-ramps (OnRamper) with card or bank, and KYC at the provider.
- **OISY Pay:** pay merchants by QR code through Open CryptoPay (SPAR Switzerland, Shopware, WooCommerce). Tokens: ICP, ckBTC, VCHF, VEUR, BTC, ETH, USDC, USDT and more.
- **OISY Tips (v2.6.0):** a link or QR code that anyone can claim.
- **Contacts:** an address book with multi-chain addresses, used for sends and for filtering transactions.
- **Universal Scanner:** scans QR codes for addresses, OISY Pay and WalletConnect.
- **Privacy mode:** hides balances and amounts; toggled with the P key.
- **Transaction history:** per chain, with filters by token, type and contact, a spam filter for small transactions, and CSV export of balances and transactions.
- **Custom tokens:** import ICRC, ERC-20, SPL and ERC-4626 tokens.
- **TCYCLES (v2.6.0):** mint cycles-ledger tokens from ICP through the CMC, shown as a "Compute" asset.
- **Notes:** vetKey-encrypted private notes, with share links that work once.
- **AI Assistant (beta):** lists balances, shows contacts, and starts sends that the user then confirms.
- **Rewards:** OISY Sprinkles campaigns (Episode 6 started April 2026, with hourly rewards for real activity) and referral links.
- **App and support:** installable PWA, tester program, support tickets.

## 2. Sneed Hub wallet today

Paths are relative to `src/app_sneeddao_frontend/src`.

- **Login:**
  - Internet Identity 1.0 (identity.ic0.app) or 2.0 (id.ai, which also offers Google and other sign-ins), set up in `AuthContext.jsx`. Sessions last 7 days.
  - No `derivationOrigin`, so a user's principal is tied to `https://app.sneeddao.com`.
  - "Pair with a browser" for the installed PWA (`pages/PairApp.jsx`).
  - **ConnectAgent** (`pages/ConnectAgent.jsx`) issues *scoped, expiring* II delegations to a local AI agent (the Sneed Hub MCP server). This is real delegation, unlike Oisy's per-call approvals.
- **Tokens:**
  - Token list: per-user ledgers stored in the backend, all SNS tokens, discovery through rewards and tips, a whitelist scan, custom ledgers, and hiding dust.
  - Sending:
    - Recipients can be a principal, an ICRC-1 textual account, a subaccount (editor in `utils/AccountParser.js`), or an ICP account ID.
    - Combined sends from the wallet plus the Sneed Lock backend subaccount (`utils/sendPlan.js`).
    - Deposit to and withdraw from Sneed Lock.
    - Consolidate fees, rewards and maturity.
  - Wrap/unwrap GLDT↔sGLDT, and mint when you hold a token's minting account.
- **Prices:** in any denomination (USD via ckUSDC, €, ₿, Ξ, ICP and so on) through `useDenomination`.
- **History:**
  - TransactionList on the Transactions, Me, Principal and Neuron pages.
  - An ICRC-3 block explorer (`pages/ToolsIcrc3.jsx`).
  - "Follow the money" flow graph.
- **Account tool:** `/tools/account` converts subaccount formats and checks balances.
- **Address book:** public names and private nicknames (`NamingContext.jsx`). `PrincipalInput` autocompletes everywhere; neurons have nicknames too.
- **Swaps:**
  - DexAggregator (`services/dex/`) quotes ICPSwap and Kong in parallel and can split one order across DEXes.
  - Kong is defunct but still registered in `SwapWidget.jsx`.
  - TACO is planned (`spec/pipeline.md`).
  - Trading-bot DSL swaps.
- **Liquidity:** ICPSwap LP positions (scan, add, claim with fee forwarding, send). Sneed Lock time locks for tokens and LP positions, and locks are transferable as ICRC-7 NFTs.
- **NFTs:**
  - ICRC-7 send and ICRC-37 approvals (grant and revoke).
  - EXT read and send.
  - A collection browser, the demo-collection mint, and NFT avatars.
- **Staking:**
  - Full SNS neuron management: stake, split, merge maturity, dissolve, permissions, hotkeys, send.
  - NNS neurons controlled by the user, with NNS hotkeys.
  - ICP staking bots (neuron-manager canisters) and trading bots, with botkeys, chores, logs and upgrades.
- **Canisters:**
  - Canister manager: status, controllers, install, top-up.
  - Cycles top-ups by ICP (CMC), ckUSDC (CyclePay, ICRC-2), or card (CyclePay through Stripe; cycles only).
- **Sneedex:** escrow marketplace for canisters, SNS neurons, ICRC-1 tokens, ICRC-7 and EXT NFTs, plus escrow tools.
- **Social and services:**
  - Forum on every SNS, with tips, polls and SMS direct messages.
  - Push notifications and Sneed Monitor, with ICRC-2 auto top-up from a subaccount.
  - Donations, Premium, names, Token Studio (check, harden, launch through SneedPad), SNS Jailbreak and Sneed apps.
- **Theme and app:** PWA (push only, no offline cache) and dark/light themes. No i18n.
- **Planned but not built** (`spec/programmable_accounts.md` §4):
  - **Pockets:** wallet subaccounts plus hosted balances in one list, send/move/receive per pocket, and a **receive QR**.
  - **Approvals manager:** list allowances through ICRC-103 or the index, revoke, and "approve safely from a fresh pocket". The spec calls it "being built", but no files exist yet.
  - Later, `sneed_vault` with grants.

**Confirmed absent today:**
- No ck minter calls of any kind: no `get_btc_address`, `update_balance`, `retrieve_btc*`, `withdraw_eth` or `withdraw_erc20`.
- No native BTC, ETH or SOL addresses.
- No ICRC signer standards and no WalletConnect.
- No QR codes at all.
- No privacy mode.
- No fiat on-ramp for tokens.
- No CSV export.
- No sends *from* your own subaccounts.
- No ICRC-2 allowance list.
- No TACO swaps.

## 3. Feature table

Effort labels: **FE** means frontend only. **Cycles** means the user pays cycles to a DFINITY canister. **Canister** means we would need a new canister of our own.

| Area | Oisy | Sneed Hub | Gap | Can we do it? |
|---|---|---|---|---|
| ICP / ICRC tokens | Yes, custom import | Yes, plus all SNS tokens, discovery, whitelist scan | None (we are ahead) | n/a |
| ckBTC deposit (BTC→ckBTC) | Yes (swap flow) | No | **Yes** | **FE.** `get_btc_address({owner=user})` on the ckBTC minter shows a BTC address; after the confirmations, call `update_balance`. The user sends BTC from any external wallet. |
| ckBTC withdraw (ckBTC→BTC) | Yes | No | **Yes** | **FE.** `icrc2_approve` the minter on the ckBTC ledger, then `retrieve_btc_with_approval`; track with `retrieve_btc_status_v2`. Show minimum amount and fee from `get_minter_info` and `estimate_withdrawal_fee`. |
| ckETH / ckERC20 withdraw | Yes | No | **Yes** | **FE.** ckETH: approve the minter, then `withdraw_eth`. ckERC20: approve ckETH (for gas) *and* the ckERC20 ledger, then `withdraw_erc20`. Track with `retrieve_eth_status` and `withdraw_erc20` status. |
| ckETH / ckERC20 deposit | Yes (from its own ETH address) | No | **Yes** | **FE**, two ways. (a) Call the helper contract `depositEth` / `depositErc20(token, amount, principalBytes32, subaccount)` from the user's injected EVM wallet (MetaMask via `window.ethereum`). (b) Once we have native ETH (row below), call it from the user's Sneed ETH address. |
| Native BTC address and send | Yes | No | Yes | **FE plus Cycles** through the Chain Fusion Signer. Address `btc_caller_address` costs 0.079B cycles; `btc_caller_send` about 171B cycles (~$0.23) for a 2-in/2-out transaction. Balance and UTXOs come from the Bitcoin canister or a block explorer. No canister of our own. |
| Native ETH / EVM L2s | Yes (6 chains) | No | Yes | **FE plus Cycles.** Address `eth_address_of_caller` (0.077B cycles); `eth_sign_transaction` costs 37B cycles (~$0.05) per signature. Nonce, gas and broadcast come from public RPC or the EVM RPC canister. ERC-20 is just call data. |
| Solana / XRP | Yes | No | Yes | **FE plus Cycles** with `schnorr_sign` (Ed25519, 37B cycles) and `generic_sign_with_ecdsa` for XRP (secp256k1). These are the most code: transaction building, RPC and SPL handling. |
| Cross-chain swaps | NEAR Intents, Velora, 1Sec, LI.FI planned | No | Yes, once native chains exist | FE (calls to the providers' HTTP APIs) plus native signing. Velora and LI.FI need EVM. NEAR Intents mostly needs a deposit address you can send to, which works with native BTC/ETH/SOL. |
| ICRC swaps | ICPSwap only (Kong removed) | ICPSwap plus Kong (dead), split swaps across DEXes, bot DSL | We are ahead. Remove Kong, add TACO. | FE (TACO adapter, already in the pipeline) |
| Order book | OISY Trade (its own canister) | No (Sneedex escrow is different) | Partial | Only by adding a venue adapter for OISY Trade or TACO. We do not need to build a book. |
| Sign in with X (ICRC signer) | Yes (`signer.oisy.com`, ICRC-25/27/29/49/21, no ICRC-34) | No (we delegate only to our own PWA and our MCP agent) | **Yes** | **FE.** Use `@dfinity/oisy-wallet-signer` `Signer.init({owner})` on a `/sign` route. Details in §3.1. |
| WalletConnect | Yes (EVM, SOL, BTC) | No | Yes (only useful after native chains) | FE (WalletConnect/Reown SDK and project ID). The security work is large: decoding EIP-712 and Solana transactions, scam lists. |
| NFTs | EXT plus ICRC-7, spam review | ICRC-7 plus ICRC-37 approvals, EXT send, browser, avatars, Sneedex sale, lock NFTs | We are ahead. Spam review and hiding media are missing. | FE |
| Neurons and staking | None (link to NNS app) | SNS and NNS neurons, hotkeys, staking bots | Far ahead | n/a |
| Earn / borrow | Harvest (EVM), Liquidium | Neurons, LP fees, staking bots | Different. Liquidium is ICP-native. | FE adapter for Liquidium is possible. Harvest needs EVM. |
| Locks, LP positions, escrow | No | Yes | Far ahead | n/a |
| Canisters, cycles, bots | TCYCLES mint only | Full canister manager, CyclePay, bots, Sneed Monitor | Far ahead | Optional: "mint TCYCLES" through the CMC is a few lines. |
| Approvals (ICRC-2) | Shows approve transactions in history, no manager | NFT ICRC-37 manager; token approvals manager planned | Neither has one. Ours would be first. | FE (spec §4.4) |
| Subaccounts | Single account | Can send *to* any subaccount; Sneed Lock subaccount | Pockets planned | FE (spec §4) |
| Contacts / address book | Contacts, multi-chain | Names plus private nicknames, PrincipalInput everywhere | Roughly equal for ICP. No account or other-chain contacts. | FE plus `sneed_pid_nicknames` extension (planned in pockets) |
| Receive QR / scanner | Yes / yes | No / no | **Yes** | FE (QR library and camera through `BarcodeDetector` or zxing) |
| Privacy mode | Yes | No | **Yes** | FE (one context flag that masks `formatValue`/amount renderers) |
| History | Per-chain, filters, spam filter, CSV | Rich pages, ICRC-3 explorer, follow-the-money; no per-token tab on the card, no CSV | Small | FE |
| Buy (fiat on-ramp) | OnRamper and others | Card only for cycles (CyclePay) | Yes | FE widget plus a partner account. Compliance questions for a DAO (§5). |
| Merchant pay | OISY Pay (Open CryptoPay) | No | Yes | FE (Open CryptoPay links are a public protocol). Low priority. |
| Tip links | Claimable link or QR | On-chain tips to forum posts | Different | Canister needed (a link-claim escrow). Sneedex escrow or a small canister. |
| Encrypted notes | vetKeys notes | No (Sneed Drive planned) | Planned | Canister (Sneed Drive spec) |
| AI assistant | Beta, in-app | MCP agent with scoped delegation, Mr Sneed | We are ahead on agent power; no in-app chat | Optional |
| Rewards / referral | Sprinkles, referrals | RLL rewards, tips, premium | Different | Policy decision, not technical |
| Governance of the wallet | Team-run (DFINITY-incubated); signer NNS-run | **SNS DAO** (frontend handover planned) | We are ahead | n/a |
| Login | II 2.0 (Google, Apple, Microsoft) | II 1.0 and 2.0 (id.ai offers the same OpenID options) | Equal | n/a |
| i18n | Translations (deposit form translated) | English only | Small | FE |

### 3.1 Being a signer ("Sign in with Sneed Hub"): what it takes

**What a dapp gets**
- The user's **Sneed Hub principal**, the one derived for `https://app.sneeddao.com`. That principal holds their tokens, neurons, locks and bots.
- The ability to *ask* Sneed Hub to make canister calls as that principal. Each call is approved in a popup.

**How it works**
1. The dapp opens `app.sneeddao.com/sign` (or a subdomain) in a popup.
2. The two talk over ICRC-29 postMessage.
3. The user grants ICRC-25 scopes. ICRC-27 returns the account.
4. Each ICRC-49 call is shown with its ICRC-21 consent message, signed with the user's II delegation inside our page, and submitted.

**Implementation**
- `@dfinity/oisy-wallet-signer` exposes `Signer.init({owner: identity})`. We register prompts for permissions, accounts and consent; a call-canister status prompt is optional.
- Weeks of work, all FE. No canister.

**Origin and derivation decision (one-way door)**
- *Simplest:* a `/sign` route on app.sneeddao.com. Same origin, so the principal matches and nothing else changes.
- *Safer isolation (what Oisy does):* a separate origin such as `signer.sneeddao.com`. That page must log in to II with `derivationOrigin: "https://app.sneeddao.com"`, and app.sneeddao.com must serve `/.well-known/ii-alternative-origins` listing the signer origin.
- **Never change the derivation origin of the main app.** That would give every user a new, empty principal.
- Today `public/.well-known/ii-derivation-origin` contains the *staging* URL, but it is not wired to anything. Check it before touching II config.

**Security and consent UX**
- **Phishing risk is real.** A hostile dapp can ask the user to approve `icrc2_approve(huge)`, a transfer, `manage_neuron` (add a hotkey or controller, disburse), a Sneed Lock transfer, or a canister `update_settings`.
- Mitigations:
  - Use ICRC-21 messages where the target canister provides them. Otherwise use our own decoders for ICRC-1/2/7/37, SNS governance and Sneed canisters (we already have `CandidValue`/`ProxyPayloadView` rendering).
  - Put hard warnings, or a block-by-default, on governance, controller and approval-without-expiry calls.
  - Keep a per-dapp allow-list.
  - Reuse the pockets idea: "connect from a pocket" means a dapp sees a fresh subaccount with limited funds.
  - Show the target canister's name and token-safety verdict.
- **ICRC-34 delegations:** Oisy deliberately does not offer them. We already issue *scoped* (`targets`), expiring delegations to the MCP agent, so we could offer ICRC-34 with targets restricted to the dapp's canisters. That is a UX win over Oisy (no popup per call), but it should be opt-in and never cover ledgers or governance.

**Distribution**
- Dapps must list us. IdentityKit has a signer list, and the `@icp-sdk/signer` ecosystem expects a signer URL.
- Without listings, "Sign in with Sneed Hub" only works in Sneed's own apps and in dapps we persuade.

### 3.2 Native BTC/ETH: own canister vs the Chain Fusion Signer

**Own threshold-signing canister** (not recommended)
- `sign_with_ecdsa` with `key_1` costs about 26B cycles per signature on a 34-node subnet, plus execution.
- The canister would be custody-critical. Anyone controlling its wasm controls every user's BTC and ETH.
- Under SNS control, a malicious or buggy upgrade proposal could drain users. It would need the guardian/blessed-hash treatment, an audit, and permanent cycles funding. Users would pay us or we would subsidise.

**Chain Fusion Signer** (recommended)
- No canister of ours, and no new trust beyond the IC's own threshold API.
- The user pays: about 37B cycles (~$0.05) per ETH/Solana signature, about 171B cycles per BTC send. Address derivation is ~0.08B.
- Payment: a cycles-ledger `icrc2_approve` to the signer, which we already do for CyclePay-style flows. Users need a cycles-ledger balance; we can mint it from ICP through the CMC, which is the same move as Oisy's TCYCLES feature.
- **Addresses are per principal.** A user's Sneed Hub BTC/ETH address differs from their Oisy address (different II principal). Tell users so, in the same way their ICP principals already differ.
- **Risk:** our frontend is then the thing that builds what gets signed, so a compromised frontend could sign drains. This is the same risk class as ICRC today, but it extends to other chains. It strengthens the case for the DAO-controlled frontend (`frontend-dao-handoff-plan`).

## 4. Where Sneed Hub is already ahead (fairly stated)

1. **ICP-native asset depth.** Oisy shows ICRC balances. We manage SNS and NNS neurons end to end (stake, split, dissolve, maturity, hotkeys, permissions, send), ICPSwap LP positions, Sneed Lock time locks (transferable as NFTs), Sneedex escrow of neurons and canisters, and ICRC-37 NFT approvals.
2. **Swaps on ICP.** Multi-DEX quoting and split execution, against Oisy's single ICPSwap route. TACO is coming.
3. **Developer and power-user tooling.** Canister manager, cycles by ICP, ckUSDC or card, the ICRC-3 explorer, follow-the-money, the subaccount tool, Token Studio safety checks, SneedPad launches.
4. **Automation.** Staking and trading bots with a DSL, Sneed Monitor with ICRC-2 auto top-up, notifications.
5. **Agent integration.** Scoped, expiring delegations to an MCP agent. That is more capable than Oisy's beta assistant, which can only start sends.
6. **Social layer.** Forum on every SNS, tips, SMS, names and avatars, polls.
7. **Denomination.** Any token as the unit of account, not only fiat.
8. **Governance.** Sneed Hub is run by an SNS DAO, with the frontend handover in progress. Oisy's frontend and backend are run by a company team.

Oisy is ahead on reach (6+ chains, bridges and cross-chain swaps), dapp connectivity (signer and WalletConnect), and consumer polish (QR, privacy, contacts, CSV, on-ramp, merchant pay, onboarding with rewards).

## 5. Recommendation (priority order)

| # | What | Needs | Effort | Risk and notes |
|---|---|---|---|---|
| 1 | **ck conversions**: ckBTC deposit and withdraw; ckETH/ckERC20 (ckUSDC, ckUSDT and others) withdraw; ETH/ERC-20 deposit through an injected EVM wallet | FE only (minter plus ledger calls, MetaMask for deposits) | ~1–2 weeks | Low. Show minimum amounts and fees from the minters. Handle `update_balance` polling and the BTC confirmation wait. Status lists persist per user, which can live in the backend layout store. This is exactly the "convert ck tokens" ask, and it gets value without any new trust. |
| 2 | **Polish batch**: receive QR plus scanner, privacy mode, CSV export, spam/dust filter for history and NFTs, remove Kong, add TACO | FE only | ~1–2 weeks total | Low. Receive QR is already in the pockets spec. |
| 3 | **Pockets plus approvals manager** (already specced) | FE only (later `sneed_vault`, a canister) | Already planned | Low. Also gives the signer its safest mode ("connect a pocket"). No other wallet has an allowance manager. |
| 4 | **Sign in with Sneed Hub (ICRC signer)** | FE only (`@dfinity/oisy-wallet-signer`); optional `signer.` subdomain with `ii-alternative-origins` | ~2–4 weeks plus outreach | Medium. A phishing surface on a principal that holds neurons, locks and bots, so it needs strong decoders and block-by-default rules. The derivation-origin choice is permanent. Adoption depends on IdentityKit and the dapp lists. Optional scoped ICRC-34 would beat Oisy's UX. |
| 5 | **Native BTC, then ETH/EVM** through the Chain Fusion Signer | FE plus user-paid cycles (cycles-ledger approve); no canister of ours | BTC ~3–4 weeks, ETH/ERC-20/L2s ~4–6 weeks | Medium to high. UTXO and nonce handling, RPC reliability. Frontend integrity becomes custody-critical for more chains. Unlocks ck deposits from one's own address and cross-chain swaps (NEAR Intents). |
| 6 | **Cross-chain swaps** (NEAR Intents first; then Velora/LI.FI for EVM) | FE (provider APIs) plus #5 | ~2–3 weeks after #5 | Medium. Third-party solvers, refunds, memo and destination-tag pitfalls. |
| 7 | **WalletConnect** (EVM first) | FE (Reown SDK and project ID) plus #5 | ~3–5 weeks | High security surface (EIP-712, permit phishing, Solana decoding). Do it only after the native chains have matured. |
| 8 | **Optional extras**: fiat on-ramp widget (OnRamper/Transak), Liquidium adapter, Open CryptoPay payments, TCYCLES mint, claimable tip links (needs a small escrow canister), Solana/XRP | Mostly FE. Tip links need a canister (low cycles, ~0.1T/month idle). | Varies | On-ramp: a commercial and KYC partner relationship for an anonymous-founder DAO, so the DAO decides by motion. Solana and XRP are the costliest per value. |

Notes:
- **No item in the core path (1–7) needs a new Sneed canister.** Only a link-tip escrow and the later `sneed_vault` do.
- Signing costs land on users (about $0.05 per EVM signature, about $0.23 per typical BTC send) unless the DAO decides to subsidise them.
- Do **not** build our own threshold-signing canister. The Chain Fusion Signer gives the same keys-on-ICP property with the IC's own governance, while ours would put every user's off-chain funds behind SNS upgrade proposals.

### Top 5 gaps
1. ck-token conversions: ckBTC, ckETH and ckERC20 deposit and withdraw. None exist today.
2. Receive QR, scanner, privacy mode and CSV export (consumer polish).
3. Sign in with Sneed Hub (ICRC-25/27/29/49/21 signer).
4. Native BTC and ETH/EVM addresses, through DFINITY's Chain Fusion Signer.
5. Cross-chain swaps and WalletConnect, which build on #4.

Recommended order: 1 → 2 → pockets and approvals → 3 → 4 → cross-chain swaps → WalletConnect. Extras (on-ramp, Liquidium, payments, tip links) go to DAO motions.
