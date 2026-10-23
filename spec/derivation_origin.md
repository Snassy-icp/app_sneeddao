# Derivation origin: principals the DAO controls (draft)

Status: spec only, nothing built. Written 2026-10-23. Deadline: **2029-02-11**, when the
registration of `sneeddao.com` expires.

## 0. Problem in one paragraph

Sneed Hub (frontend asset canister `pxtkg-giaaa-aaaal-ajjzq-cai`, served at
`https://app.sneeddao.com`) logs users in with Internet Identity 1.0 (`https://identity.ic0.app`) and
2.0 (`https://id.ai`). It passes no `derivationOrigin`
(`src/app_sneeddao_frontend/src/AuthContext.jsx`, `loginWithII1` / `loginWithII2`). II derives each
user's principal from the client origin:
`seed = H(|salt|·salt·|user_number|·user_number·|frontend_origin|·frontend_origin)`
([II spec](https://docs.internetcomputer.org/references/internet-identity-spec.md)). So every Sneed
Hub principal is a function of the string `https://app.sneeddao.com`. The domain holder, an absent
community member, registered `sneeddao.com` at Hostinger until 2029-02-11. Nobody active can renew
it, harden it (DNSSEC, CAA, 2FA) or move it.

**Whoever controls its DNS can serve any page at that origin and get the same principals.** They can
do it from their own server. They do not need an IC canister, because II only looks at the origin
string. They could also point `_canister-id` at their own canister. The result is the same either
way: they control every user's tokens, neurons, locks, bots and names. CAA and DNSSEC would not
help, because the attacker is the DNS controller.

Goal: before 2029, make principals depend on something Sneed DAO controls on-chain. Then losing a
domain costs at most availability, not funds.

## 1. How II derivation origins work (research)

The facts below come from the spec and the II frontend source. The source is
`src/frontend/src/lib/utils/validateDerivationOrigin.ts` and `canisterIdResolution.ts` in
[dfinity/internet-identity](https://github.com/dfinity/internet-identity/blob/main/src/frontend/src/lib/utils/validateDerivationOrigin.ts).

1. **`derivationOrigin`** is an optional field of the II login request. When it is set, II derives
   the principal from that origin instead of the client origin. It does this only if the derivation
   origin approves the client origin
   ([spec, client authentication protocol](https://docs.internetcomputer.org/references/internet-identity-spec.md)).
   `@dfinity/auth-client`'s `login({ derivationOrigin })` passes it through.
2. **The approval file** is `/.well-known/ii-alternative-origins` on the derivation origin. Its
   format is `{"alternativeOrigins": ["https://a.example", ...]}`, with unique entries. The current
   limit is **100 entries**: the spec says so, and `MAX_ALTERNATIVE_ORIGINS = 100` in
   [urlUtils.ts](https://github.com/dfinity/internet-identity/blob/main/src/frontend/src/lib/utils/urlUtils.ts).
   Older docs say 10
   ([old spec page](https://internetcomputer.org/docs/current/references/ii-spec/)).
   We need 2 to 4 entries, so either limit is fine.
3. **Certified, no redirects, CORS.** The file "must be delivered as a certified asset". II will not
   follow redirects. The response must carry `Access-Control-Allow-Origin` for the II origin
   (spec). The II frontend fetches it with `redirect: "error"` and `credentials: "omit"`. It always
   fetches it from **`https://<canister-id>.icp0.io/.well-known/ii-alternative-origins`**, never from
   a custom or raw domain, "to make sure that the request is made through a BN that checks
   certification" (`inferAlternativeOriginsUrl`). It fetches the file on every login, so there is no
   II-side cache.
4. **Which origins can be a derivation origin.** `resolveCanisterId` first parses the canister id
   from the hostname: the first label under `ic0.app`, `icp0.io`, `icp.net` or
   `internetcomputer.org`. Otherwise it sends a **`HEAD` request to the origin and reads the
   `x-ic-canister-id` header**, which the boundary node sets for a registered custom domain. So a
   custom domain *can* be a derivation origin. It must not be one here, because its canister id is
   then whatever its DNS says. That is the attack again, one level down. **The derivation origin
   must be a canister-id URL.**
5. **`ic0.app` and `icp0.io` are the same.** Before the seed is computed and before origins are
   compared, `remapToLegacyDomain` rewrites `icp0.io` and `icp.net` to `ic0.app`. The spec says:
   "Frontend URLs on `icp0.io` are mapped to `ic0.app` automatically", which "ensures transparent
   pseudonym transfer". So `https://<cid>.icp0.io` and `https://<cid>.ic0.app` give **identical
   principals**. We write `icp0.io`, the current gateway and what II fetches from. Raw URLs
   (`<cid>.raw.icp0.io`) are a separate origin and give different principals (spec).
6. **The default case.** If `derivationOrigin` equals the client origin after normalization, II does
   no lookup. So a canister's own URL can always log in as itself.
7. **II 1.0 and II 2.0.** `identity.ic0.app` is being folded into `id.ai`
   ([announcement](https://forum.dfinity.org/t/announcement-identity-ic0-app-identity-internetcomputer-org-id-ai-internet-identity-2-0/62566)).
   Both run on the same II canister and the same anchors, and users report the same principal from
   both ([developer TL;DR](https://forum.dfinity.org/t/announcement-identity-ic0-app-identity-internetcomputer-org-id-ai-internet-identity-2-0/62566/5)).
   The validation code above is the id.ai frontend's. The legacy frontend implements the same spec
   section. **To verify on staging:** both providers accept our `derivationOrigin` and give equal
   principals (§8).
8. **Custom domain registration**
   ([custom domains guide](https://docs.internetcomputer.org/guides/frontends/custom-domains.md)):
   - DNS: `CNAME <domain> → <domain>.icp1.io`, `TXT _canister-id.<domain> = <cid>` (exactly one), and
     `CNAME _acme-challenge.<domain> → _acme-challenge.<domain>.icp2.io`.
   - The canister serves `/.well-known/ic-domains`, one domain per line. Ours lists
     `app.sneeddao.com` today (`public/.well-known/ic-domains`).
   - API at `https://icp.net/custom-domains/v1/<domain>`: `GET …/validate`, `POST` to register,
     `GET` for status, `PATCH` after a DNS change, `DELETE` to remove.
   - **Moving a domain to another canister is just a TXT change plus `PATCH`.** Control of DNS is
     control of which canister answers. The canister's consent (`ic-domains`) is needed to *add* a
     domain on the IC, but a DNS controller can skip the IC and serve from anywhere.

## 2. Design

### 2.1 Two options for the derivation origin

**Option A, the frontend canister: `https://pxtkg-giaaa-aaaal-ajjzq-cai.icp0.io`.** The asset
canister serves `/.well-known/ii-alternative-origins`. The asset canister certifies its assets.
`.ic-assets.json5` gives the file `Access-Control-Allow-Origin: *`,
`Content-Type: application/json` and `Cache-Control: no-store`. It is the simplest option, with no new
canister.

- Emergency weakness: once #454 (register the Sneed Hub frontend with Sneed DAO) and #455 pass,
  every asset change is a `commit_proposed_batch` proposal (spec/frontend_dao_handoff.md). That
  takes up to 4 days plus wait-for-quiet (Sneed SNS: `initial_voting_period_seconds = 345600`, plus
  86400 wait-for-quiet), or less if more than half of all voting power votes yes early
  ([DFINITY support](https://support.dfinity.org/hc/en-us/articles/4489411106324-What-is-required-for-a-vote-to-pass)).
- **A pre-approved "drop alias" batch is not possible.** The asset canister allows one proposed batch
  at a time ("Batch N is already proposed"), so a standing batch would block every release. Its
  evidence also covers the operations computed against the current content, so it would go stale at
  the next release. Granting Commit to a council is worse. Commit can publish any JavaScript, and
  that is a full takeover.

**Option B (recommended): a small dedicated canister `sneed_ii_origin`.** Its derivation origin is
`https://<sneed_ii_origin>.icp0.io`. It has no app and no assets. It serves only
`/.well-known/ii-alternative-origins` (and `/` with a short text page). The response is certified
through `certified_data`, using the HTTP gateway's v2 response certification
([HTTP gateway spec](https://docs.internetcomputer.org/references/http-gateway-protocol-spec)). It
must be on the same `mo:core` stack as our other canisters. Its controller is SNS root only.

Its state is a list of entries `{ origin : Text; pinned : Bool; status : #active | #suspended :
{ by; at; reason } }`. Only `#active` entries are served.

Who can do what:

| Actor | Can | Cannot |
|---|---|---|
| Sneed DAO (GNSF `dao_set_origins`, plus validator, one GNSF per canister) | add, remove, pin, unpin, un-suspend, set council, set tripwire | (nothing) |
| Origin council (N named members, M-of-N) | **suspend** a non-pinned entry | add, un-suspend, touch pinned entries |
| Tripwire (timer in the canister) | **suspend** a non-pinned entry whose DNS checks fail | anything else |

- **Pinned entries are canister URLs**: `https://pxtkg-giaaa-aaaal-ajjzq-cai.icp0.io`, and later any
  other Sneed frontend canister URL. They carry no DNS risk. Users can always log in there whatever
  the council or tripwire do.
- **Suspension only removes.** The worst a hostile council or a buggy tripwire can do is take the
  custom domains offline for login until a proposal restores them. Nobody gains a principal. A
  proposal can add an attacker's origin, but that DAO power already exists: the DAO can ship any
  frontend JS. So option B adds no new trust.
- **Council**: modelled on the guardian veto councils (spec/custody.md). It has at most 20 members,
  none anonymous, and is set by proposal. A suspension needs M signatures (proposed: 2 of 5) within
  24 h. Any council member may also make a one-signature suspension that lasts 6 hours; it becomes
  permanent when M confirm, and lapses otherwise. The council has to be fast, so one person can trigger
  a short outage, but nobody alone can make it last.
- **Tripwire** (a timer, every 10 minutes; no heartbeat):
  - It queries `TXT _canister-id.<domain>`, `CNAME`/`A`/`AAAA`, and `NS` for each non-pinned entry
    through HTTPS outcalls to two or three DoH resolvers, for example
    `https://dns.google/resolve?name=_canister-id.app.sneeddao.com&type=TXT` and Cloudflare's
    `https://cloudflare-dns.com/dns-query`. A transform keeps only the answer data (no TTLs) so the
    replicas reach consensus.
  - Expected values are set by proposal, for example TXT = `pxtkg-…`, CNAME = `app.sneeddao.com.icp1.io`,
    NS = Hostinger's.
  - Two consecutive mismatches on any resolver suspend the entry. A suspension writes an ICRC-3 block
    and sends a sneed_notifications alert.
  - An RDAP outcall for the registration expiry suspends `app.sneeddao.com` automatically 30 days
    before expiry (see §6) unless a proposal postpones it.
  - Honest limits: an attacker can answer DoH resolvers differently from users' resolvers
    (split-horizon or geo DNS) and keep the records looking right to the IC. The tripwire catches a
    careless or automated takeover, an expiry, or a registrar parking page, not a careful targeted
    one. The tripwire is therefore a layer on top of the council, not a replacement for it. A false
    positive costs a login outage on that domain; the canister URL keeps working.
- **Cost of option B:** one more canister that must live forever. If it is deleted, nobody can log in
  with the new principals, ever. Its funds would still exist, but no frontend could reach them. So:
  - It gets a large freezing threshold (1 year) and a sneed_mon watch with auto top-up.
  - Its code is small, upgraded rarely, and each upgrade is rehearsed on staging.
  - A broken upgrade takes login down (not funds) until a fix proposal passes. That is the main
    reason for keeping the code tiny.
- Option B also frees the frontend canister. A future Sneed Hub canister can be added as a pinned
  alias, and principals stay the same.

**Decision needed (Q1).** A is simpler. B shrinks the emergency window from days to minutes or hours.
The rest of this spec assumes B. Under A, read "pxtkg URL" wherever this spec says
"`sneed_ii_origin` URL", and take the emergency path to be a proposal pushed to absolute majority.

### 2.2 The alternative origins list

```json
{ "alternativeOrigins": [
    "https://app.sneeddao.com",
    "https://<new DAO domain>",
    "https://pxtkg-giaaa-aaaal-ajjzq-cai.icp0.io"
] }
```

- **`https://app.sneeddao.com`** stays listed while it is ours. While it is listed, a hijacker of that
  domain gets the **new** principals too. Listing it is exactly as risky as today. The gain is that
  the entry can be removed.
- **New DAO-held domain.** No DAO can own a domain directly; some person or company holds it at a
  registrar. That is why it is only an alias. Requirements:
  - A registrar with organisation accounts that have several admins, registry lock, DNSSEC and CAA.
  - Registration for 10 years, with auto-renew paid by more than one member.
  - Its `_canister-id` points at `pxtkg`, and it is added to `ic-domains`.
  - Losing it later costs one suspension, nothing more. (Q2: which name, who holds it, which registrar.)
- **The pinned canister URL** is the address to tell people to bookmark ("the address nobody can take
  away").

### 2.3 Login change

In `AuthContext.jsx`, add the constant `DERIVATION_ORIGIN = 'https://<sneed_ii_origin>.icp0.io'`
per network. It is passed to both `authClient.login` calls once the switch flag is on (Phase 4).
Before the switch, logins stay as today. The wizard (§4) does a second login with the other setting.
Agent connect and pairing (`utils/agentConnect.js`, `utils/pairing.js`) only extend the session's
delegation chain, so they work unchanged for whichever principal is signed in.

`scripts/build-api-docs.mjs` writes `/.well-known/ii-derivation-origin` (service discoverability). At
the switch it must publish the `sneed_ii_origin` URL. Today the file holds the origin itself
(`https://app.sneeddao.com` on ic). spec/oisy_comparison.md says "never change the derivation
origin of the main app". This spec replaces that rule, on purpose and with migration.

### 2.4 When `app.sneeddao.com` is lost

1. The tripwire, the council or a proposal suspends `https://app.sneeddao.com`.
2. From then on, a page at that origin asking II for `derivationOrigin = sneed_ii_origin` is refused
   ("not listed in the list of allowed alternative origins").
3. Without `derivationOrigin`, the page gets the **old** principals, which hold nothing once users have
   moved. In Sneed canisters, old principals are retired (§4.4).
4. Users log in at the new domain or the canister URL. Same II, new principal, everything there.

### 2.5 Residual risks (honest list)

1. **The window.** Between a hijack and the suspension, anyone logging in at the hijacked domain
   hands over their new principal. That window is minutes with the tripwire if the attacker is
   careless, hours with the council, and days with a proposal.
2. **Old principals fall to whoever holds the domain.** Anything still at an old principal is exposed:
   - assets not moved;
   - NNS neurons it controls (§3, item 6);
   - payouts that keep arriving at old accounts (exchange withdrawals to saved addresses, ckBTC
     deposits, tips, RLL, Sneedex settlements);
   - hotkeys the old principal holds on other people's neurons;
   - the old principal's private SMS messages. SMS is admin-readable anyway
     (sneed-sms-privacy-stance), but the attacker could read them as the user. Moving the inbox and
     retiring the old principal ends that.
3. **Phishing at the old domain.** The attacker can serve a perfect copy of Sneed Hub: fake
   balances, "send your funds here", a fake "move wizard" pointing at the attacker's addresses, a fake
   II dialog drawn inside the page. They cannot get the new principal, but they can talk users into
   sending funds. Mitigations:
   - Announce early and often which addresses are real (forum News topic 899, SMS, notifications, X,
     Discord).
   - Show the list of live origins in-app and on `/dao`, read from `sneed_ii_origin`. It is also
     readable on-chain and logged in ICRC-3.
   - Teach users "the II window must say id.ai".
4. **Impersonation of old principals elsewhere.** Old principals are retired only in Sneed canisters.
   Ledgers, SNS governance, ICPSwap and other apps keep honouring them.
5. **The new domain** has the same problem in the future. The remedy is the same suspension.
6. **Trust in DFINITY** (II, `icp0.io`, boundary nodes) is unchanged from today.
7. **DAO capture**: a proposal could add a hostile origin. This is the same power as shipping a
   hostile frontend, which already exists.
8. **Council collusion or tripwire bugs** can cause a login outage on custom domains, never a theft.
9. **Losing `sneed_ii_origin`** locks everyone out (§2.1 cost).

## 3. Inventory: everything a user can hold, and how it moves

This list comes from grepping the frontend (`pages/`, `utils/`, `utils/pockets/`) and every canister
under `src/`.

- **"Exists"**: the current methods are enough; the wizard drives them with the old or new identity.
- **"New method"**: a canister change, which means a proposal (EOP canisters need
  `wasm_memory_persistence = 1`, see eop-upgrade-needs-keep).
- **`adopt_moved(old)`**: a new method called by the *new* principal. It checks the link record
  (§4.3), moves or merges the old principal's rows, writes an ICRC-3 block (`*_principal_move`), and
  retires the old principal in that canister. It is idempotent.

| # | Asset | Where | How it moves | Status |
|---|---|---|---|---|
| 1 | ICRC tokens, main account | every ledger in the backend's `user_tokens` + discovery | `icrc1_transfer` old→new, all minus fee; dust below the fee stays (listed) | exists |
| 2 | Wallet pockets (own subaccounts) | `utils/pockets/` wallet adapter | send each to the **same subaccount number** of the new principal, so pocket #n stays #n | exists |
| 3 | Pocket registry, account nicknames, principal nicknames | sneed_pid_nicknames (`state`, `account_state`) | `adopt_moved`: copy, with the new principal's own entries winning on conflict; accounts owned by old are rewritten to the matching new account | **new method** |
| 4 | ICP/ICRC NFTs (ICRC-7, EXT incl. Diamond Club) | collections the user tracks | `icrc7_transfer` / EXT `transfer` (`utils/ExtUtils.js`) | exists |
| 5 | SNS neurons (any SNS) | list_neurons(of_principal = old) per SNS | `AddNeuronPermissions(new, all grantable)`, then `RemoveNeuronPermissions(old)`. Sneed SNS grants all 11 types, max 5 principals per neuron (checked 2026-10-23); other SNSes are read per SNS, and if `ManagePrincipals` is not grantable, explain and leave new as hotkey | exists |
| 6 | NNS neurons controlled by old | NNS governance | **The controller cannot change.** Add new as hotkey (vote/follow). Plan: start dissolving if the delay ends before 2029-01, then disburse to new; spawn/disburse maturity to new. A neuron locked past 2029 stays exposed to whoever holds the domain then: say this plainly. Neurons inside ICP neuron manager bots move with the bot (row 9) | exists, **unfixable remainder** |
| 7 | Sneed Lock token locks | sneed_lock `principal_token_locks`, tokens in `PrincipalToSubaccount(owner)` | `transfer_token_lock_ownership(new, ledger, lockId)`; lock NFTs (`icrc7_transfer`) are the same thing; per-lock gas subaccounts follow the lock id | exists |
| 8 | Sneed Lock positions, unlocked wallet balance, payment balance, pool balances | sneed_lock | `transfer_position_ownership`; `transfer_tokens` (unlocked) to the new account; `withdraw_payment_balance` then send; pending claims and `uncertain_moves` must be finished first | exists |
| 9 | Bots and canisters (ICP neuron managers, staking bot, trading bot, tracked canisters, sneed_pad ledgers kept with the creator) | IC controllers | `update_settings` adds new, then removes old (the user is the controller); botkeys `addHotkeyPermissions(new)` / `removeHotkeyPrincipal(old)`; sneedapp `transferManager(cid, new)` for the wallet entry | exists |
| 10 | sneedapp payment, refund credits, publishers | sneedapp | `withdrawUserPayment`/`withdrawUserToken` to old, then send; `claim_refund_credit`; `addPublisherOwner(new)` then remove old; finish pending mints and top-ups first | exists |
| 11 | ICPSwap LP positions held directly | each pool | `transferPosition(old, new, id)`; unused pool balances: withdraw to old, then send | exists |
| 12 | Sneedex offers, bids, escrow | sneedex | escrow subaccounts are derived from creator/bidder, so the owner cannot be rewritten (it would orphan the funds). Let open offers finish or cancel, then `reclaimAssets`/`refundBid`/`withdrawBidEscrow`/`claimAssets`/`withdrawOfferCreationPayment` to old, then move. The wizard lists open ones with their end dates. Optional later: `transfer_offer(new)` that moves the escrow on-chain | exists (open items wait) |
| 13 | Premium membership, deposit | sneed_premium `memberships` | VP members: claim again as new once new is a hotkey (`claimWithVotingPower`). Paid time: `adopt_moved` moves expiry (the later of the two wins). Deposit: `withdrawDeposit*` to old, then send | **new method** |
| 14 | Name, checkmark, NFT avatar | sneed_pid_names | the existing two-step **`add_hotkey(new)` by old + `merge_account(old)` by new** already moves name and checkmark. The NFT avatar must move with its NFT (row 4), because avatars are re-checked for ownership at display | exists, extended by §4.3 |
| 15 | Neuron nicknames | sneed_neuron_nicknames | `adopt_moved` | **new method** |
| 16 | Neuron names | sneed_neuron_names | follow neuron permissions (row 5) | nothing |
| 17 | Uploaded avatars | sneed_avatars `held` | `adopt_moved` (move hashes and holder counts) | **new method** |
| 18 | dApp profiles | sneed_profiles | rights come from canister controllership (row 9) | nothing |
| 19 | Backend: ~30 settings maps, tokens, swaps, tracked canisters, folders, wallet layouts, legacy names/nicknames, jailbreak configs, jailbreak payment subaccount, last-seen | app_sneeddao_backend | `adopt_moved`: merge lists, the new principal's settings win if set; `withdraw_jailbreak_payment` first; **a ban follows the move** (otherwise moving launders a ban); admin-set partner prices: an admin re-adds them | **new method** |
| 20 | Forum: posts, threads, polls (authorship), tips given/received, mentions, reply inbox, read marks | sneed_sns_forum (Dedup index) | **history stays authored by old** (it is in the ICRC-3 log, and TACO reads it). `adopt_moved` moves inbox, read marks, mention settings and last-seen, and gives new the edit rights on old's posts (`created_by == caller_index or successor`). Display shows the old principal with "moved to …". Votes are keyed by neuron (row 5) | **new method** |
| 21 | Forum tips to old posts | wallet-to-wallet to the author's principal | the tip dialog resolves the successor and pays the **new** account; after the move, tips to old would otherwise feed whoever holds the domain | frontend |
| 22 | SMS inbox and sent mail | sneed_sms (Dedup index) | `adopt_moved` adds old's message ids to new's sender/recipient lists, moves last-seen and no-previews, and retires old (no more reads as old). New messages sent to a moved principal are delivered to the successor too (additive, logged) | **new method** |
| 23 | RLL rewards | rll (`stable_balances` by neuron owner) | **claim as old first** (`claim_full_balance_of_hotkey`), then move the neurons. After that, the owner becomes new by the >7 permissions rule | exists (order matters) |
| 24 | Notifications: balance, channels, settings, inbox, app permissions, owned apps | sneed_notifications | there is no user withdrawal today, so `adopt_moved` moves the balance and every row; `App.owner` moves too | **new method** |
| 25 | Sneed Monitor: watches, balance, auto top-ups | sneed_mon | `adopt_moved` moves watches and balance. **Auto top-ups pull via ICRC-2 from the old account**, so new approvals from new are needed (the wizard does them), and old approvals are revoked | **new method** (or `withdraw_balance(to new)` and re-create watches) |
| 26 | ICRC-2 approvals granted by old | ledgers (`utils/approvals.js`) | list, revoke on old, re-grant the needed ones (sneed_mon, bots) on new | exists |
| 27 | ckBTC deposits | minter `get_btc_address(owner)`, derived from the principal | `update_balance({owner: old})` for anything sent; ckBTC lands at old, then is swept. **Saved deposit addresses (exchanges, payers) must be replaced**; the wizard shows the new address | exists |
| 28 | ckETH/ckERC20 deposits | helper contract encodes the principal | in-flight deposits mint to old (sweep); saved setups must be updated | exists |
| 29 | Native BTC (Chain Fusion Signer, spec/sneed_wallet.md, not built) | keys derived from the caller principal | if it ships before migration: an on-chain BTC send old→new, with an explicit fee | future |
| 30 | Sneed Pad launches | sneed_pad `launches.creator` | IC controllers via row 9; the creator field via `adopt_moved` or leave it as history | **new method** (small) |
| 31 | sneed_guardian registrations, guardian or approver seats | sneed_guardian policies | a staged `#set_policy` op per child, so the existing DAO/guardian flow | exists (slow) |
| 32 | Admin seats held by an II principal (canister admin lists, SMS authorized senders) | many canisters | by proposal or by admin, one by one; the user's own II admin principal is the main case | manual |
| 33 | Mr Sneed memories about a member | mr_sneed `by_member` | impersonal DAO facts; leave them, or `forget_about_me` | nothing |
| 34 | Hotkeys old holds on other people's neurons (NNS dapp neurons, SNS Jailbreak targets) | other apps | the owner must add new elsewhere; the wizard lists them where it can find them and explains | outside our reach |
| 35 | Donations wall, feedback, support records | backend | history; shown with the link | nothing |
| 36 | Agent delegations, paired apps | browser only | expire; re-pair with new | nothing |
| 37 | Pending SNS stakes (`stakeJournal`), pending mints, Sneed Lock claims | local journal + canisters | finish as old before moving | exists |
| 38 | TACO balances (pockets adapter stub) | TACO | read-only today; whatever TACO supports | outside |

That makes **11 canister changes** (rows 3, 13, 15, 17, 19, 20, 22, 24, 25, 30, plus the link record
in pid_names) and **one new canister** (`sneed_ii_origin`). Each change is one proposal per canister,
following sneed-dao-release-process.

## 4. Migration

### 4.1 Two logins, one session

The wizard holds two identities at once in one tab, each from its own `AuthClient`. "Old" is a login
without `derivationOrigin`. "New" is a login with it. The user approves two II windows. These are II's
own windows, not JS popups. Our UI uses in-page panels only, as everywhere. Before the switch (Phase
4) the session the user is already in is "old", and the wizard asks for the "new" login. After the
switch it is the other way round. "Old" always means what II issues on the current origin without
`derivationOrigin`. So the same wizard also moves anyone who used the canister URL or the staging URL
directly.

The wizard shows both principals with their names and says plainly that they are public on-chain,
and that the move record is public (no-false-anonymity).

### 4.2 Casual and pro

- **One click: "Move everything".**
  1. Discovery runs over both principals. It reuses the pockets discovery and adapters
     (`utils/pockets/`), the backend's token and canister registry, and list_neurons per SNS.
  2. It shows **one plan**: what moves, what has to wait (open Sneedex offers, NNS neurons, dissolving
     locks are fine because they move as is), and every fee. Totals use
     `useDenomination().formatValue(usd)`, and per-token amounts are exact.
  3. "Move everything" runs the steps in the order of §4.5.
- **Advanced**: a per-item list, one checkbox per row of §3. Items can be moved one at a time, with a
  retry per item and a raw log. Users can choose which subaccount number each pocket lands in, and
  "keep old as hotkey" on SNS neurons.
- **It can be resumed.** Every step is idempotent and re-checked on-chain before it runs. Progress is
  kept in the link record's status (on-chain, so it works from another device), with a localStorage
  mirror for convenience only.
- **Afterwards, "Check my old account"** stays in the user menu until 2029. It sweeps anything that
  arrived at old later. It also runs on its own whenever the user logs in with old.

### 4.3 The link record (two signatures)

The link lives in **sneed_pid_names**. That canister is already DAO-controlled, already has the
account, member and hotkey model, and is what every page reads for display. The protocol extends
the existing `add_hotkey` + `merge_account` pair:

1. Old calls `move_begin(new : Principal)`. This creates a pending record `{old, new, at}` that
   expires after 1 hour.
2. New calls `move_confirm(old : Principal)` within that hour. The record becomes final, and an
   ICRC-3 block `pidnames_principal_move {old, new}` is written.
3. Queries: `get_successor(p) : ?Principal` and `get_predecessors(p) : [Principal]`, both public
   (additive, so TACO can use them).

Rules:

- One old has at most one successor, and the link is final. To change it, the successor itself moves
  on (old→new→newer is allowed, and readers follow the chain).
- A new principal may adopt several olds, for example a user who had both an `app.sneeddao.com` and
  a canister-URL principal.
- A principal that already has a successor cannot become a successor itself (no cycles).
- Other canisters' `adopt_moved(old)` calls `get_successor(old)` on pid_names with an inter-canister
  call and requires that `caller == successor`. They are not ingress queries, so the ingress guard
  is unaffected; the new methods join each canister's `msg` variant (ingress-guard).

Why not a signature blob? Both principals are delegations from the same II anchor in the same tab,
so two plain calls are already the two signatures, with no crypto code to get wrong.

### 4.4 Retiring the old principal

Once a canister has run `adopt_moved(old)`, it refuses state-changing calls from `old`. It still
allows reads of public data, and calls that only push funds to the successor. The forum and SMS
then refuse posts and reads as old, so a domain hijacker cannot post as the user, read their
messages or change their name. Ledgers, SNS governance and ICPSwap still honour old, which is why
everything of value must actually move.

The record is also the "linked previous account" others see:

- Every principal display (`PrincipalBox`, forum author, SMS sender, `/principal/<p>`) shows "moved
  to <name>" on old and "previously <name>" on new.
- Old posts stay old's posts, shown with the link.
- Old's page is marked "retired on <date>; anything it does after that is not its owner", which
  matters once the domain is lost.

The old principal stays *usable* in II for as long as we hold the domain. That is useful for
sweeping stragglers. It is not a place to keep anything.

### 4.5 Step order (the plan the wizard runs)

1. Finish pending items as old: SNS stakes, ckBTC `update_balance`, Sneed Lock claims and uncertain
   moves, sneedapp pending mints and top-ups.
2. Claim as old: RLL (`claim_full_balance_of_hotkey`).
3. Link: `move_begin` / `move_confirm`, then pid_names `add_hotkey` + `merge_account` (name,
   checkmark).
4. SNS neurons: add new with all grantable permissions on every neuron. Remove old last, after
   step 9.
5. NNS neurons: add new as hotkey. Show the dissolve plan.
6. Locks, positions, NFTs: `transfer_token_lock_ownership`, `transfer_position_ownership`, ICPSwap
   `transferPosition`, ICRC-7/EXT transfers.
7. Canisters and bots: add new as controller and botkey, `transferManager`, publisher owners. Remove
   old after a check call as new succeeds.
8. Hosted balances out to old: sneed_lock, sneedapp, premium, backend jailbreak, Sneedex claims,
   ICPSwap unused balances.
9. Data: `adopt_moved` on backend, pid_nicknames, neuron_nicknames, avatars, premium, notifications,
   sneed_mon, forum, SMS, pad.
10. Approvals: re-grant the needed ones from new, revoke all on old.
11. Tokens last: sweep every ledger and pocket old→new, each minus its fee.
12. Remove old from SNS neurons (unless Advanced "keep old as hotkey" until a date), then remove old
    as controller everywhere.
13. Report: what moved, what could not (NNS neurons, open offers, dust), with dates and reminders
    set (notifications to new; SMS to old saying "this account has moved").

### 4.6 TACO DAO

TACO uses the forum, SMS and backend APIs. All changes are **additive**:

- New methods: `adopt_moved`, `get_successor`, `get_predecessors`.
- Response records keep their fields. Optional fields such as `author_successor : ?Principal` go only
  on new methods or as trailing `opt` fields where Candid subtyping allows.
- TACO's own users log in at TACO's own origin, so their principals differ from ours and they never
  move unless they run our wizard. Retirement then affects only principals that chose to move.
- Two behaviour changes TACO should hear about in advance, on their forum thread or through
  trickyvik:
  - SMS sent to a moved principal is also delivered to its successor.
  - A moved principal can no longer post.

## 5. Phases and estimates

Estimates are for one session of work plus review. Proposal voting runs about 4 days each, and the
proposals go in parallel where they are independent.

| Phase | Content | Effort | Target |
|---|---|---|---|
| P0 | Decisions: Q1 (A/B), Q2 (domain, holder, registrar), council members; buy and harden the new domain | 1–2 wk + user time | 2026-12 |
| P1 | `sneed_ii_origin`: certified `http_request`, entries, council, tripwire (DoH + RDAP outcalls, transform), dao_set GNSF + validator, ICRC-3 log, tests in test/canisters (certificate verified like the gateway does) | 3–4 wk | 2027-01 |
| P2 | Link record in pid_names; `adopt_moved` in 10 canisters; retirement checks; tests: each move with the old code failing and the new code passing (fix-discoveries-with-tests); full `npm test` | 6–8 wk | 2027-03 |
| P3 | Frontend: dual login, discovery over two principals, plan view, step engine, Advanced list, "moved to/previously" displays, successor-aware tips, origin list on `/dao`; `npm run check` | 6–8 wk | 2027-05 |
| P4 | Staging rehearsal (§8); then proposals: new canister + 11 upgrades + frontend; the switch flag stays off | 3–4 wk | 2027-06 |
| P5 | **Opt-in**: the wizard is live, the default login is still old; announcements; Sneed DAO treasury and the user's own accounts move first, as a public example | 2 mo | 2027-08 |
| P6 | **Switch**: the default login is new; "sign in with my old account" stays in the wizard only; banner for unmoved users | 1 wk | 2027-09 |
| P7 | Campaign: monthly notifications and SMS to unmoved principals that hold value (seen on-chain), forum News topic 899, Discord, X | ongoing | to 2029-01 |

### Deadline plan relative to 2029-02-11

- **Now until it is moved, risk exists every day.** The holder's Hostinger account can be compromised
  or misused before 2029. Starting early is the mitigation, not a nicety.
- 2027-09: switch done, about 17 months before expiry.
- 2028-06: review. Count of unmoved principals with value. Decide on any extra outreach.
- 2028-11-01: final notices. NNS neuron holders get a personal SMS about dissolve timing.
- **2029-01-12: `app.sneeddao.com` suspended in `sneed_ii_origin`** (tripwire RDAP rule, 30 days
  before expiry), and the new domain becomes the only custom domain. If the holder turns up and renews
  with real hardening, a proposal can postpone this.
- 2029-02-11: expiry. Registrars often park expired domains on their own DNS straight away, so treat
  the old principals as gone from this day. Later, if the domain drops and becomes available, the DAO
  may try to register it through a backorder. Even then it would serve only a "we moved" page and
  would never be re-listed.

## 6. Emergency runbook (option B)

1. Anyone notices: wrong content at `app.sneeddao.com`, a DNS change, a tripwire alert, or a
   registrar email.
2. Any council member: one-signature suspension (6 h). Post in the forum News topic, on Discord, and
   by SMS broadcast.
3. Council: second signature makes it permanent. Proposal to remove the entry for good.
4. Comms: "log in at <new domain> or <canister URL>, never at app.sneeddao.com". Also notify users
   who have not moved that their old account may already be exposed.
5. After it is resolved: a proposal un-suspends the domain if it is truly back under control. Only
   the DAO can do this, never the council.

Under option A, step 2 becomes "a `commit_proposed_batch` proposal dropping the entry, then
whale-voted to absolute majority", and the window is hours to days.

## 7. Things this does not fix

- NNS neurons locked past early 2029 stay at old (§3, item 6).
- Funds people keep sending to old addresses after the move. Sweeps help until 2029, then they are
  lost.
- Anything at old in non-Sneed apps.
- A careful split-horizon hijack before the council reacts (§2.5, item 1).

## 8. Testing on staging

- Staging frontend: `2icdp-6qaaa-aaaal-qjt6a-cai` (`canister_ids.json` → `app_sneeddao_frontend.staging`),
  served at `https://2icdp-6qaaa-aaaal-qjt6a-cai.icp0.io`. Staging logins today derive from that
  origin, so staging already has "old" principals with real staging data.
- Deploy a staging `sneed_ii_origin`. List the staging frontend URL (pinned) and a **test custom domain**
  on a subdomain of the new DAO domain, for example `staging.<newdomain>`, registered to `2icdp`.
- Rehearse with Mr Sneed's identity and two test II anchors:
  - login at the custom domain with `derivationOrigin`, on II 1.0 and on II 2.0, giving equal
    principals;
  - the full wizard over every row of §3 with staging assets (staging-no-real-money: test ledgers,
    staging Sneed Lock and Sneedex, staging bots);
  - a hijack drill: point the test domain's TXT at another canister, and see the tripwire suspend it,
    the council suspend it, a proposal restore it, and II refuse the domain's logins in between;
  - an upgrade of `sneed_ii_origin` with logins before and after.
- PocketIC (local-pocketic-rehearsal) covers the canister logic, but not II's HTTP fetch or the
  boundary node's certificate check. Those need staging.
- Before the switch: verify the certificate path by fetching
  `https://<cid>.icp0.io/.well-known/ii-alternative-origins` through the gateway and doing a real id.ai
  login.

## 9. Open questions

1. **Option A or B** (frontend canister vs dedicated `sneed_ii_origin`)? This spec recommends B. It is
   a one-way door: the derivation origin can never change again without another migration.
2. The new domain: which name, which registrar, who holds it (several members?), who pays for 10
   years?
3. Council: who sits on it, M-of-N, and the length of the one-signature suspension.
4. Tripwire: which DoH resolvers, how many misses suspend, and should the auto-suspension at 30 days
   before expiry be on by default?
5. Forum and SMS: keep history authored by old with display links (recommended), or re-point the
   Dedup index so old posts become new's (one admin step, but rewrites what TACO and the ICRC-3 log
   show)?
6. Should SMS sent to a moved principal reach the successor (an additive behaviour change for TACO)?
7. Sneedex: wait for open offers to end (recommended for v1), or build `transfer_offer` with on-chain
   escrow moves?
8. Old principal after the move: retire it in Sneed canisters at once (recommended), or keep it
   writable until the domain is suspended?
9. Paid Premium: merge rule when both principals have time (sum, or the later expiry)?
10. Bans and partner prices: confirm that bans follow the move and that partner prices are re-added
    by an admin.
11. Switch date (P6): fixed (2027-09), or when X% of value has moved?
12. Do we tell users of NNS neurons controlled by their Sneed Hub principal to start dissolving now?
    And how many such neurons exist? Check on-chain before deciding.
13. Should the frontend canister also stop serving `app.sneeddao.com` (remove it from `ic-domains`)
    when we suspend it, so the IC itself never serves it again?
14. II 2.0 behaviour with two logins in one tab (does it offer the same anchor, and how many
    prompts)? Verify on staging.
