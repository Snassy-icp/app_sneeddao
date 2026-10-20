---
name: sneed-hub
description: Master guide to Sneed Hub (https://app.sneeddao.com), Sneed DAO's web app on the Internet Computer, for an agent helping an ordinary user. Explains logging in with Internet Identity and the installed app, and maps every user goal to the exact page and clicks - wallet, sending tokens, locking tokens or ICPSwap liquidity in Sneed Lock, trading and escrow on Sneedex, swapping, SNS and ICP neurons, liquid staking, voting on proposals, staking and trading bots, cycles top-ups, the SNS forum, tips, direct messages, notifications, names and avatars, Premium, rewards, token safety checks in Token Studio - plus the safety rules to tell users and how to read public state yourself. Use whenever someone asks what they can do on Sneed Hub or Sneed DAO, or wants help doing something there.
license: MIT
metadata:
  publisher: Sneed DAO
  site: https://app.sneeddao.com
  help: https://app.sneeddao.com/help
  entry-point: https://app.sneeddao.com/llms.txt
  skills-index: https://app.sneeddao.com/.well-known/agent-skills/index.json
  mcp-server: https://github.com/Snassy-icp/app_sneeddao/tree/main/mcp/sneed-hub
  source: https://github.com/Snassy-icp/app_sneeddao
---

# Sneed Hub: what a user can do, and how

## What Sneed DAO and Sneed Hub are

Sneed DAO is an SNS DAO on the Internet Computer (ICP). It is run by its SNEED neurons: every upgrade of its canisters is a proposal that SNEED neurons vote on. Its founders are anonymous; nobody speaks for the DAO except its proposals. Mr Sneed is the DAO's mascot and spirit ("we are all Mr Sneed"), given a voice by AI; his memories and rules are public on-chain at https://app.sneeddao.com/mr-sneed.

Sneed Hub (https://app.sneeddao.com) is the DAO's web app, served from an ICP asset canister. It is a wallet plus tools: Sneed Lock (time locks for tokens and liquidity), Sneedex (escrow marketplace and swap), SNS and ICP neuron management, liquid staking, bots you own (ICP staking bot, trading bot), a forum for every SNS with tips and polls, direct messages (Sneed SMS), notifications, names and avatars, token tools and governance views. Everything works on any SNS, not only Sneed; most pages follow the SNS chosen in the header dropdown.

Key ids: Sneed SNS root `fp274-iaaaa-aaaaq-aacha-cai`, governance `fi3zi-fyaaa-aaaaq-aachq-cai`, SNEED ledger `hvgxa-wqaaa-aaaaq-aacia-cai`, ICP ledger `ryjl3-tyaaa-aaaaa-aaaba-cai`.

## How you (the agent) help

- You explain and guide; **the user acts**. Every transaction is signed by the user's own Internet Identity session in Sneed Hub. You never hold their keys and never act for them.
- **Never ask for** a seed phrase, recovery phrase, Internet Identity passkey/device, PEM file, dfx identity or any private key. If a user offers one, tell them to stop and never share it with anyone.
- Give the exact URL to open (below), then the buttons to press. Fill route params from what the user tells you or from public reads.
- To check facts yourself, read public state (see "Reading public state yourself"). Say plainly when a figure is live and may have changed (fees, prices of apps, limits).
- Don't talk about token prices, returns or whether to buy anything. Sneed Hub is a tool, not advice.
- Nothing on-chain is anonymous: the user's principal is public and every post, tip, lock, bid, vote, name and donation is linked to it. Never describe an action as anonymous.

## Safety rules to tell users

1. **Real tokens, real fees.** Every ledger transfer costs that token's fee (ICP: 0.0001). Some actions also charge an ICP service fee (lock fee, Sneedex offer fee, staking-bot or trading-bot mint price, SNS Jailbreak fee); the page shows it before you confirm.
2. **Transfers are irreversible.** Check the recipient principal/account and the amount before you press Send; nobody can undo a wrong transfer.
3. **Locks can't be shortened.** A Sneed Lock can be extended, never cancelled early.
4. **Verify canister ids.** Before trading a token, locking it or minting from Sneedapp, check the ledger/canister id (not just the symbol or logo). Use Token Studio's Check (/studio) for any unfamiliar token.
5. **Beware fake sites and links.** Sneed Hub is only at `app.sneeddao.com` (staging test copy: `2icdp-6qaaa-aaaal-qjt6a-cai.icp0.io`, shows a STAGING banner, uses real tokens). No one from Sneed DAO will DM you asking for keys or to "verify your wallet".
6. **Pairing links.** Only approve a pairing code you see in your *own* installed app; if someone sends you a /pair link, don't allow it.
7. **Messages are not secret.** Sneed SMS and forum posts are stored on-chain unencrypted; don't put passwords or keys in them.
8. **Staging is a separate copy.** Names, posts and settings there are separate from the real site; tokens are real, so use small amounts.

## Logging in

- Open https://app.sneeddao.com/login (or any page) → the login dialog → choose **Internet Identity 1.0** (classic, identity.ic0.app, existing anchors) or **Internet Identity 2.0** (id.ai). No other wallets (Plug, NFID, OISY) are supported. Sessions last 7 days.
- The principal shown at the top of /wallet is the user's **Sneed Hub principal**. It is specific to Sneed Hub (Internet Identity gives each site its own principal), so it differs from the user's NNS dapp principal. Tokens sent to it are in their Sneed Hub wallet. To use NNS or SNS neurons in Sneed Hub, the user adds this principal as a **hotkey** on the neuron (explained at /help/neurons).
- **Install as an app** (https://app.sneeddao.com/help/app): iPhone: Safari → Share → Add to Home Screen. Android: Chrome menu → Install app. Desktop: Chrome/Edge install icon.
- **Pairing** (when the login popup does not return to the installed app, mainly iPhone): in the app's login dialog tap "Pair it with Safari" (other platforms: "Pair it with a browser") → "Copy link" (`https://app.sneeddao.com/pair?key=...`) → open it in the browser, "Log in to continue", check the code matches the app's code (like `K7Q-2MX`), "Allow" → "Copy approval" → back in the app "Paste approval".

## URL conventions

- `sns=<SNS root canister id>` selects the SNS on SNS pages (default Sneed `fp274-iaaaa-aaaaq-aacha-cai`). Find root ids on /sns.
- Neuron ids are hex strings; proposal ids are numbers; principals are text (`xxxxx-...-cai` for canisters).
- [login] = needs a logged-in user.

## Goal map

### Hold, send and receive tokens - /wallet [login]
- Receive: give people the principal shown at the top of /wallet (Copy).
- Tabs: **Tokens | Liquidity | Apps | Statistics**. "+ Add Token" adds any ICRC-1 ledger by canister id.
- Token card: **Send**, **Buy** (swap ICP into it), **Sell** (into ICP); card tabs Balance | Locks | Neurons | Info. "Deposited" balance = the user's Sneed wallet subaccount in Sneed Lock (used for locks).
- Any principal's balances, read-only: `/scan_wallet?principal=<p>`; a user's public page: `/principal?id=<p>`.
- History: `/transactions?ledger=<ledgerId>`; one tx: `/transaction?ledger=<ledgerId>&id=<index>`.
- NFTs (ICRC-7): /nft [login] ("Add Collection", "Send NFT", "Approve a spender", "Sell on Sneedex"); browse any collection: `/nfts?collection=<canister>`; one item: `/nft_item?collection=<canister>&id=<tokenId>`.
- Help: /help/wallet.

### Swap tokens - /swap
`/swap?input=<ledgerId>&output=<ledgerId>` (default ICP → SNEED). Compares ICPSwap and KongSwap routes (split and multi-hop) and can fill from Sneedex buyouts. Set "Slippage tolerance", review, confirm.

### Lock tokens or liquidity - Sneed Lock
- Create: `/lock_wizard` [login] (`?type=token&token=<ledgerId>` or `?type=position` to preselect).
  1. "Lock Tokens" or "Lock Liquidity Position" → Continue.
  2. Tokens: shows "Available to lock"; if short, send tokens to the shown address, "Check again". Position: pick the ICPSwap pool; on ICPSwap transfer the position (Liquidity → Details → "Transfer position") to the Sneed Wallet principal shown, then "Choose the position to lock".
  3. Pay the ICP lock fee if shown (Premium members pay less).
  4. "Configure & Lock": amount (MAX), expiry, optional "Dissolve delay in days" → "Create Lock".
- One lock: `/lock/<lock_id>`: owner can "Start dissolving" / "Stop dissolving", "Extend the lock period", "Send the NFT" (each lock is an ICRC-7 NFT), "Add gas".
- All locks: `/sneedlock_info` (`?owner=<principal>&ledger=<ledgerId>`), overview /sneedlock, per token `/tokenlocksoverview?ledger=<ledgerId>`.
- Locked LP positions in /wallet → Liquidity: claim fees, "Add Liquidity", transfer. Expired token locks become free "Deposited" tokens; expired positions can be withdrawn.
- Help: /help/sneedlock. Integration skill: sneed-lock.

### Manage ICPSwap liquidity - /position, /positions
- `/position?swap=<pool>&id=<positionId>`: owner can "Collect fees", "Move range", "Remove", "Transfer", "Lock in Sneed Lock", "Withdraw to wallet". `/position?swap=<pool>` opens a new position. `/positions` lists mine / a pool's.

### Trade or escrow on Sneedex
- Browse: /sneedex_offers; my offers and bids: /sneedex_my [login]; about: /sneedex; help: /help/sneedex.
- Sell: /sneedex_create [login] → asset type (App / ICP Staking Bot / Trading Bot / SNS Neuron / NFT / ICRC1 Token; Sneed Locks are sold as Sneed Lock NFTs) → "Price Token", "Minimum Bid" (blank = buyout only), "Buyout Price", "Min Bid Increment", "Expiration", optional "Private Offer (OTC)" with approved bidders → "Create Offer" (the app escrows the assets and activates the offer). An SNS neuron needs the ManagePrincipals permission for the user's principal.
- Offer page `/sneedex_offer/<offerId>`: buyer "Place Bid" / "Buyout", then "Claim Your Assets"; seller "Accept Highest Bid", "Cancel Offer", "Claim Payment". After expiry anyone can press "Finalize Auction" / "Process Expiration". A marketplace fee comes out of the winning bid.
- From elsewhere: "Sell on Sneedex" buttons on tokens, NFTs and positions.
- Integration skill: sneedex.

### SNS neurons
- Browse an SNS: /sns (directory and parameters). Neurons: `/neurons?sns=<root>`; one neuron: `/neuron?neuronid=<hex>&sns=<root>` (permissions, followees, dissolve, voting history; a private "Set Nickname").
- Manage your own: /wallet → token card → Neurons tab: "Create New Neuron", "Increase Stake", "Set Dissolve Delay", "Start/Stop Dissolving", "Disburse", "Disburse Maturity", "Split Neuron", "Send Neuron", hotkeys. Or /me → My Neurons.
- Neurons created elsewhere (NNS dapp) show up once the Sneed Hub principal is a hotkey (or controller).
- Liquid staking (neurons you can transfer or sell): /liquid_staking; SNS: /sns_neuron_wizard [login] (pick SNS → amount, dissolve delay → "Confirm & Stake").
- SNS Jailbreak (add your Sneed Hub principal as full controller of an SNS neuron you control in the NNS dapp): /tools/sns_jailbreak [login] → pick SNS, neuron, target principal → generate a script, read it, paste it in the browser console on nns.ic0.app. Has an ICP fee. Help: /help/sns_jailbreak.

### ICP neurons - staking bot
- Create: /create_icp_neuron [login] (or /sneedapp/app/sneed-icp-staking-bot → "Mint Now"); pay the mint price, then "Open Manager".
- Manage: `/icp_neuron_manager/<canisterId>`: stake, maturity, dissolve, disburse, following, hotkeys, Botkeys (fine-grained permissions), chores (auto confirm-following, refresh stake, collect maturity). The bot is a canister the user controls; the neuron lives in it.
- Help: /help/icp-neuron-manager.

### Run a trading bot
- Mint: /sneedapp/app/sneed-trading-bot → "Mint Now" → `/sneedapp/mint/sneed-trading-bot` ("Select Version", optional extra gas, "Review Payment", "Confirm & Mint").
- Manage: `/trading_bot/<canisterId>`: Setup Wizard (DCA or Range Trade with optional stop-loss), chores (start, pause, "Run Once"), purses ("Fund", "Reclaim"), Botkeys, logs. Trades on ICPSwap and KongSwap.
- All apps: /sneedapp (store), /apps [login] (App Manager: your canisters, groups, health lamps, top-up). Help: /help/sneedapp, /help/trading_bot.

### Top up cycles or manage a canister
- Any canister: `/canister?id=<canisterId>` → "Top Up Canister" (ICP → cycles via the Cycles Minting Canister) or "Pay by card" (CyclePay: card/Apple Pay/Google Pay, card fee shown, cycles go straight to the canister, no login). Controllers can add/remove controllers, set a public name, upgrade the wasm.
- Several at once: /wallet → Apps tab or /apps → "Top-Up": pay with ICP or ck-USDC (CyclePay), to a target level, split equally or same amount each.
- Explorer: /canisters. Help: /help/dapp-manager.

### Vote on proposals
- Your SNS and NNS neurons in one place: /active_proposals [login] ("Voting": "Adopt" / "Reject", "Show only votable").
- SNS list `/proposals?sns=<root>`; one: `/proposal?proposalid=<n>&sns=<root>` → "Adopt" / "Reject" per eligible neuron or "Vote with all eligible neurons"; discussion thread below.
- NNS: /icp_proposals, `/icp_proposal?proposalid=<n>`.
- To vote, the neuron needs the Sneed Hub principal as hotkey ("Add Your Principal as a Hotkey" instructions are on the page). Help: /help/proposals, /help/dao.
- Earn and claim Sneed voting rewards (for Sneed neurons hotkeyed to your principal): /rewards [login].

### Forum, tips, polls
- `/forum?sns=<root>` → topic `/topic/<topicId>?sns=<root>` → "Start a New Thread" [login] (optional "Include a Poll"; poll weighting by neuron voting power).
- Thread `/thread?threadid=<n>&sns=<root>`: "Reply", "Edit Post", "Delete", up/down vote with your hotkey neurons, tip button. One post: `/post?postid=<n>&sns=<root>`.
- Tip: tip button on a post → "Choose Token", amount → "Send Tip" (a ledger transfer from your wallet to the author, recorded by the forum; public).
- Activity: /feed; my posts /posts; tips sent/received /tips. If an SNS has no forum yet: "Create Your Forum".
- Help: /help/forum. Integration skill: sneed-forum.

### Direct messages (Sneed SMS)
- /sms [login] ("Compose", "Add Recipient", Subject, Message, "Send Message", "Reply", "Reply All"); start one to someone: `/sms?recipient=<principal>`; one conversation `/msg/<id>`. Or "Send Message" on a user's /principal page.
- Limits (subject/body length, recipients, rate) are higher for Premium. Messages are not encrypted and show the sender's principal. Help: /help/sms. Skill: sneed-sms.

### Notifications
- /notifications [login]: allow or block apps asking to notify you; per-level delivery, "Quiet hours", "Hold messages"; per-app level and mute; channels (Sneed SMS; others such as phone push and Discord as the page shows them live); "Top up" an ICP balance for paid channels; "Recent". Help: /help/notifications. Skill: sneed-notifications.

### Name, avatar, address book
- /me [login] ("My Profile"): "Set Name" (public, max 32 chars, moderated; visible to everyone), avatar (upload/URL, or "Use an NFT I own" - must still own it), public names and private nicknames for your neurons.
- Private nicknames for any principal or neuron: /names ("Address Book") or on /principal and /neuron pages. Nicknames are shown only to you, but are stored on-chain unencrypted.
- Canister names: `/canister?id=<id>` (controllers). Browse named users: /users. Help: /help/names. Skill: sneed-names.

### Check a token's safety - Token Studio
- /studio → enter a ledger id → "Check": a rating from public data (controllers, wasm, archives, index, etc.). Fixes for owners: `/studio/<ledgerId>/harden`. `/tools/token_safety/<ledgerId>` redirects here.
- **Launching/minting a token, building an index, and handing a token over to custody (/studio launch, index, handover tabs, /custody, /guardian, /tools/pad) are "coming soon"** - not open to users yet. Say so; don't invent steps. Help: /help/token-studio.

### Other tools
- /tools/main lists them. Follow the Money (`/tools/money?ledger=<ledgerId>&start=<principal>`), Account Tool (/tools/account: principals, subaccounts, account ids), ICRC-3 Browser (`/tools/icrc3?canister=<id>`). Help: /help/tools.

### Premium, DAO info, community
- /premium: "Purchase with ICP", "Claim with Sneed Voting Power" or "Redeem Promo Code"; gives discounts (Sneedex, bots, jailbreak, lock fees) and higher limits (messages, posts, App Manager).
- DAO: /dao (about), /dao_info (dashboard), /health (automated checks), /rll_info (tokenomics and the liquidity loop), /revenue (live product revenue), /products, /partners, /projects, /lore, /mr-sneed.
- Feedback: `/feedback?kind=bug` or `?kind=idea` [login] (becomes a public forum thread; security bugs can be sent privately by SMS). Donations: /donate (public thank-you wall; gifts can't be refunded).
- Developer docs: /api. Help index: /help. Disclaimer: /disclaimer.

## Reading public state yourself

- Canister API references (Markdown, with Candid and JS IDL alongside): `https://app.sneeddao.com/api-docs/<slug>.md` for slugs `sneed_lock`, `sneedex`, `sneed_sns_forum`, `sneed_sms`, `sneed_names`, `sneed_notifications`, `sneed_premium`, `rll`, `sneedapp`, `mr_sneed`, `app_sneeddao_backend`; Candid at `<slug>.did`, IDL at `<slug>.did.js`.
- Most reads are anonymous query calls (`dfx canister --network ic call <id> <method> '(...)' --query`, or `@dfinity/agent` with an anonymous identity against https://icp-api.io). Data scoped to "the caller" (own messages, nicknames, notification settings) needs the user's identity, so send the user to the page instead.
- Sneed Hub MCP server (read-only lookups and deep links): https://github.com/Snassy-icp/app_sneeddao/tree/main/mcp/sneed-hub
- Integration skills: sneed-lock, sneedex, sneed-forum, sneed-sms, sneed-names, sneed-notifications in https://app.sneeddao.com/.well-known/agent-skills/index.json.

## What you must not do

- Never ask for or accept keys, seed phrases, identity files or passkeys; never suggest the user pastes them anywhere.
- Never tell a user to paste a script into a browser console unless it is Sneed Hub's own SNS Jailbreak script for their own neuron, and tell them to read it first.
- Never promise outcomes, returns or prices; never invent features, fees or pages - if unsure, send them to the page or /help.
- Never claim anything on-chain is private or anonymous.
- Don't attribute Sneed DAO or the SNEED token to any named person.
