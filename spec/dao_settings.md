# DAO settings: one generic nervous system function per DAO canister

Status (2026-10-23): design agreed (it replaces the parked spec/sneed_proxy.md for settings).
Pilot built and tested in Sneedex, not deployed, no proposals yet.
- Shared module: `src/DaoSettings.mo`.
- Pilot: `src/sneedex/main.mo`, section "DAO SETTINGS".
- Tests: `test/canisters/tests/sneedex-dao-settings.test.js`.
- Proposal encoder: `~/.config/mr-sneed/tools/encode_dao_set.cjs`.

## 1. The idea

Each DAO canister keeps a table of the settings the DAO may change. The table lives in the
canister's code and gives each setting a name, a kind, a unit, bounds, a getter and a setter. Each
canister then exposes three methods:

| Method | Kind | Who | Does |
|---|---|---|---|
| `dao_set(SetArgs) -> text` | update | SNS governance only | Validates every change, then applies them all in one message. Traps on any refusal. Replies with the rendering of what changed. |
| `validate_dao_set(SetArgs) -> variant { Ok : text; Err : text }` | query | anyone | The GNSF validator. Governance calls it at submission. |
| `dao_settings() -> vec Info` | query | anyone | Every setting with its kind, unit, bounds, current value and rendering. |

Each canister also has two methods for staging and tests:
- `get_dao_settings_access()` (query) says which governance canister `dao_set` accepts.
- `set_dao_settings_access(governance, admins_too)` changes it. It is **controller only**: on ic
  that is SNS root, so it can only change by an upgrade proposal.

Each canister is registered **once** with `AddGenericNervousSystemFunction`, as one GNSF:
- target `<canister>.dao_set`;
- validator `<canister>.validate_dao_set`.

Adding a setting later is one table entry in the canister's code. It ships with an ordinary
upgrade proposal, and no new GNSF and no new critical proposal are needed.

Compared with the proxy (spec/sneed_proxy.md), there is no extra canister, allowlist or blind
blob forwarding. Bounds live next to the setting they guard, and the validator can render every
value in its real units. The cost is a few lines per canister, and one critical registration
proposal per canister instead of one in all.

## 2. Candid

```candid
type Account = record { owner : principal; subaccount : opt blob };
type Value = variant {
  Nat : nat; Int : int; Bool : bool; Text : text; Principal : principal; Account : Account;
  Null;                                   // "none": an unset optional (no override, no canister)
};
type Change = record { setting : text; value : Value; expected : opt Value };
type SetArgs = record { changes : vec Change };
type ValidationResult = variant { Ok : text; Err : text };

type Kind = variant { Nat; OptNat; Int; Bool; Text; Principal; OptPrincipal; Account };
type Unit = variant {
  None; Token : record { symbol : text; decimals : nat8 }; Bps; Seconds; Nanoseconds;
  UsdCents; Count; BaseUnits;
};
type Info = record {
  name : text; label : text; description : text; kind : Kind; unit : Unit;
  min : opt nat; max : opt nat;          // Nat kinds: value bounds; Text: length bounds
  value : Value; rendered : text;        // e.g. value = variant { Nat = 200000 }, rendered = "0.002 ICP"
};

dao_set : (SetArgs) -> (text);
validate_dao_set : (SetArgs) -> (ValidationResult) query;
dao_settings : () -> (vec Info) query;
get_dao_settings_access : () -> (record { governance : principal; admins_too : bool }) query;
set_dao_settings_access : (principal, bool) -> (variant { ok; err : SneedexError });   // controller only
```

The proposal payload (`ExecuteGenericNervousSystemFunction.payload`) is the Candid encoding of
one `SetArgs`, i.e. `IDL.encode([SetArgs], [{ changes }])`.

### 2.1 Why this shape

- **A batch (`vec Change`), not one setting per call.**
  - Related settings change together: the regular and premium creation fees; the low warning,
    target and high warning of the bid increment; a rate limit's burst and refill. One vote of 4
    or more days covers them, instead of one vote per setting.
  - The rules between settings (min ≤ target ≤ max) are checked on the state *after* the batch.
    The pieces can therefore move together, which separate proposals could not do, since each one
    would be validated against the old values of the others.
  - All or nothing: there is no await between the changes, and a refusal traps, so nothing
    applies.
  - The cap is 32 changes, each setting at most once.
- **A record around the vec.** It leaves room to add `opt` fields later (a note, an expiry)
  without breaking old payloads.
- **A small closed `Value` variant, not a typed argument per setting and not a Candid blob.**
  - The validator can render the values with no knowledge of a per-setting type.
  - One payload type serves every canister.
  - `dao_settings()` tells a client which variant case each setting takes.
  - Adding a case later is backward compatible for an argument type, so old payloads stay valid.
- **No composite values.** A composite setting is flattened instead, e.g. `rate_limit.createOffer.capacity`
  and `.per_minute`. Thanks to the batch, flattening loses nothing.
- **`expected` (optional, per change).**
  - Voting takes 4 to 10 days, and admins keep their own setters. A proposal that says
    "0.001 → 0.002 ICP" must not silently overwrite a value the voters never saw.
  - With `expected` set, execution fails when the current value differs ("… is now 100, the
    proposal expected 0 (changed since it was made)").
  - The encoder fills `expected` from the live value (`EXPECT=live`), and Sneed Hub should do the
    same.
- **No-ops.**
  - The validator refuses a change to the value a setting already holds, since the proposal would
    be pointless.
  - At execution, a change whose value the setting already holds (reached meanwhile) is skipped
    and not logged. That case can only arise without `expected`.
- **`dao_set` traps and does not return `#err`.** Governance counts any reply as executed. A
  refusal has to reject, so that the proposal shows as failed with the reason. Every check runs
  before the first write.
- **The validator is a query.** Governance calls it inter-canister. Anyone can dry-run a proposal
  free with a query call. Sent as an update, it is refused at ingress.
- **Setting names are the canister's existing ICRC-3 config keys** where one exists
  (`offer_creation_fee_e8s`, `marketplace_fee_rate_bps`, …). A DAO change and an admin change of
  the same setting therefore read the same in the log.

## 3. Behaviour

### 3.1 Caller

- `dao_set` accepts only `daoGovernance`.
  - It is a stable var, default `fi3zi-fyaaa-aaaaq-aachq-cai`.
  - It can be repointed only by a controller.
- When `admins_too` is on, `dao_set` also accepts the canister's admins.
  - This is for staging rehearsals, where there is no SNS: admins call `dao_set` directly and see
    exactly what the DAO path does.
  - It is off by default, and stays off on ic.

### 3.2 Ingress guard

`inspect` only sees ingress. Governance's call is inter-canister, so it never passes through
`inspect`.
- `dao_set` is refused at ingress outright, unless `admins_too` is on and the caller is an admin.
  The argument cap is `MEDIUM_ARG`.
- `set_dao_settings_access` is admitted at ingress only for a controller.
- `validate_dao_set`, `dao_settings` and `get_dao_settings_access` are queries, refused when sent
  as updates.
- New methods join the `msg` variant, as for every method.

### 3.3 Validation (`DaoSettings.plan`)

Checks, in order:
1. the batch is not empty;
2. it has at most 32 changes;
3. every setting is known (the error points to `dao_settings()`);
4. no setting appears twice;
5. each value matches its kind (`OptNat` takes `Nat` or `Null`);
6. each value is within the min/max bounds (text: within the length bounds);
7. each value passes the setting's own `check` (e.g. "0 (free) or at least 0.0001 ICP", since a
   fee below one ledger fee cannot be paid);
8. `expected` matches the current value, when given;
9. the canister's cross rule holds on the state after the batch.

The validator also refuses no-ops (§2.1). The messages are the same in the validator and in
`dao_set`'s trap.

### 3.4 Rendering

One line per change:

```
Sneedex: premium offer creation fee 0.001 → 0.002 ICP [premium_offer_creation_fee_e8s: 100000 → 200000]
Sneedex: marketplace cut 0% → 2.5% [marketplace_fee_rate_bps: 0 → 250]
Sneedex: admin price: marketplace cut none → 1% [admin_prices.auction_cut_bps: none → 100]
Sneedex: expiration sweep interval 1 h → 2 h [expiration_check_interval_seconds: 3600 → 7200]
Sneedex: bid increment: suggested $5.00 → $7.50 [min_increment_usd_target: 500 → 750]
```

- The human part comes first, in units.
- The bracket gives the exact stored values, so nothing depends on how the rendering rounds.

How each unit renders:

| Unit | Rendering |
|---|---|
| Token | decimal, trailing zeros dropped, then the symbol |
| Bps | percent |
| Seconds, Nanoseconds | the largest whole unit (d, h, min, s) |
| UsdCents | `$x.yy` |
| BaseUnits | integer, then "base units" |
| optionals | `none` when unset |

`dao_set` replies with the same text for the changes it applied. Governance stores the reply.

### 3.5 Log

Each applied change writes the canister's ICRC-3 config block, one block per changed setting:
- `caller` = governance;
- `via` = `"dao"`;
- `key` = setting name;
- `value`;
- `old_value`.

In Sneedex that block is `sneedex_config_update` (spec/sneedex_icrc3.md). Canisters without a
log (the two nickname canisters and avatars) get the table without the log until they get one.
`set_dao_settings_access` writes key `dao_settings_access`.

### 3.6 Side effects

The table's setters write state only. A setting that needs a follow-up gets it in `dao_set`
after the apply loop. Sneedex's `expiration_check_interval_seconds` restarts the running sweep
timer, exactly as the admin setter does.

## 4. The shared module (`src/DaoSettings.mo`)

It provides:
- **types**: `Value`, `Change`, `SetArgs`, `ValidationResult`, `Kind`, `Unit`, `Info`, `Setting`
  (the table row with its `get`/`set` closures and an optional `check`), and `Planned`;
- **`plan(table, args, cross, refuseNoop)`**, which returns `#ok [Planned]` or `#err text`;
- **`apply(planned)`**, which returns the changes it applied;
- **`render(canisterName, planned)`**;
- **`info(table)`**;
- **helpers**: `show`, `change`, `decimal`, `duration`, `raw`, `icrc3` (Value to ICRC-3 value),
  `nat`, `optNat`, `ofOptNat`, and `zeroOrAtLeast(minFee, unit, name)`.

The table is a `transient let`, since it holds closures over the actor's vars. It costs no stable
memory and nothing to upgrade.

A canister adds:
- the table;
- a cross-rule function;
- two stable vars (`daoGovernance`, `daoAdminsMaySet`);
- the five methods;
- the inspect entries.

In Sneedex this is about 150 lines, most of them the table.

## 5. Registration plan

### 5.1 Ids

Live custom functions (read-only `list_nervous_system_functions` on fi3zi, 2026-10-23):
- 2000–2006 (Sneed DeFi and tokens);
- 3000–3005 (pylons, Sonic);
- 4000–4013 (Unicycle);
- 5000 (Mr Sneed: set personality).

`reserved_ids = [10000]`. Planned elsewhere:
- 6000–6099: the proxy (parked);
- 7000–7002: the frontend's commit_proposed_batch, grant_permission and revoke_permission.

**DAO settings take 6100–6199.**
- `6100 + n` is canister n, in the table below.
- `6150 + n` is reserved for a later critical twin of canister n, `dao_set_treasury` (§7.2), if
  the DAO wants revenue routing by proposal.

| id | Canister | ic id | Topic |
|---|---|---|---|
| 6100 | Sneedex | 7bvk3-ryaaa-aaaal-qtykq-cai | ApplicationBusinessLogic |
| 6101 | Sneed Lock | pqsms-lqaaa-aaaal-ajjza-cai | ApplicationBusinessLogic |
| 6102 | Sneed Premium | 7gump-4aaaa-aaaal-qtyka-cai | ApplicationBusinessLogic |
| 6103 | Sneedapp | sfamc-kyaaa-aaaau-adnpq-cai | ApplicationBusinessLogic |
| 6104 | Sneed Forum | mcigm-4aaaa-aaaad-qhlkq-cai | ApplicationBusinessLogic |
| 6105 | Sneed SMS | zelpl-7yaaa-aaaad-abtcq-cai | ApplicationBusinessLogic |
| 6106 | Sneed Hub backend | g7s5u-tqaaa-aaaad-qhktq-cai | ApplicationBusinessLogic |
| 6107 | Sneed Notifications | vuy7a-iaaaa-aaaay-aaduq-cai | ApplicationBusinessLogic |
| 6108 | Sneed Mon | (staging only: v53u4…) | ApplicationBusinessLogic |
| 6109 | RLL | lvc4n-7aaaa-aaaam-adm6a-cai | ApplicationBusinessLogic |
| 6110 | Sneed Pad | (staging only: symdn…) | ApplicationBusinessLogic |
| 6111 | Sneed Guardian | (staging only: ri7jl…) | reserved (see §6.13) |
| 6112 | Sneed Names (pid_names) | ejz7n-lyaaa-aaaad-qmkzq-cai | ApplicationBusinessLogic |
| 6113 | Sneed Neuron Names | e46oa-kqaaa-aaaad-qmk2a-cai | ApplicationBusinessLogic |
| 6114 | Sneed Profiles | fytbs-tqaaa-aaaad-qmk4a-cai | ApplicationBusinessLogic |
| 6115 | Sneed Nicknames (pid) | e37iu-hiaaa-aaaad-qmk2q-cai | ApplicationBusinessLogic |
| 6116 | Sneed Neuron Nicknames | es4di-raaaa-aaaad-qmk3a-cai | ApplicationBusinessLogic |
| 6117 | Sneed Avatars | ev5f4-4yaaa-aaaad-qmk3q-cai | ApplicationBusinessLogic |

### 5.2 Topic

Everything in the tables is a price, fee, cut or limit of an app, which is
`ApplicationBusinessLogic`, the topic Unicycle's and Mr Sneed's GNSFs already use.
- Proposals in it are non-critical: a majority of the exercised voting power, with at least 3% of
  the total voting power voting yes. Catch-all following applies.
- Settings that would justify a critical topic are deliberately left out of the tables (§7):
  revenue recipients, admin lists and canister wiring.
- Adding a GNSF (native function 4) is itself critical in every case: 67% of the exercised
  voting power, at least 20% of the total, and a voting period of 5 to 10 days.

### 5.3 The proposals

The encoder, run from `~/.config/mr-sneed/tools/`, never submits anything. It writes the
`manage_neuron` hex and prints it decoded back:

```
node encode_dao_set.cjs gov_idl.cjs add-gnsf out.hex "<title>" summary.md sneedex          # 6100, ApplicationBusinessLogic
node encode_dao_set.cjs gov_idl.cjs set out.hex "<title>" summary.md sneedex \
     premium_offer_creation_fee_e8s=0.002icp marketplace_fee_rate_bps=250          # EXPECT=live fills @expected
node encode_dao_set.cjs gov_idl.cjs payload  sneedex offer_creation_fee_e8s=200_000 # payload hex + decoding, for voters
node encode_dao_set.cjs gov_idl.cjs validate sneedex offer_creation_fee_e8s=200_000 # read-only: what voters will see
node encode_dao_set.cjs gov_idl.cjs settings sneedex                                # read-only: dao_settings()
```

Value syntax:

| Write | Means |
|---|---|
| `123`, `1_000` | nat |
| `0.002icp` | 8-decimal token amount, in base units |
| `none` | null |
| `true` / `false` | bool |
| `int:-5` | int |
| `text:…` | text |
| `principal:…` | principal |
| `account:owner[.subhex]` | account |

- A change can carry `@expected`, e.g. `name=new@old`.
- `NETWORK=staging` uses the staging ids.
- `add-gnsf` refuses a canister whose `dao_set` is not built yet; `FORCE=1` overrides.

Then submit with `dfx canister --network ic call fi3zi-fyaaa-aaaaq-aachq-cai manage_neuron --type raw --argument-file out.hex`.
The proposals are made as Mr Sneed's neuron, or as the user's.

## 6. Inventory: what becomes DAO-settable, per canister

Bounds are typo guards and sanity limits, not policy: the DAO picks values inside them.

The names below are the existing ICRC-3 config keys where they exist. The rule is that a setting
which is a price, fee, cut, limit or interval becomes DAO-settable. §7 lists what stays admin-only.

Units:

| Unit | Means |
|---|---|
| e8s | ICP e8s (rendered as ICP) |
| bps | basis points |
| s, ns | durations |
| count | a plain number |
| chars | characters |

Every canister with a rate limiter gets `rate_limit.<action>.capacity` and
`rate_limit.<action>.per_minute` for each action:
- `capacity`: 0–100,000, where 0 means no limit.
- `per_minute`: 1–100,000.
- Sneedex and Sneed Lock allow up to 1,000,000, as their setters do.

These rows are not repeated per canister below.

### 6.1 Sneedex: built (pilot)

Classic persistence. The checked-in `dao_settings()` has 24 settings:

| Setting | Unit | Bounds | Notes |
|---|---|---|---|
| offer_creation_fee_e8s | e8s | 0 or 10,000 … 1,000,000,000 (10 ICP) | |
| premium_offer_creation_fee_e8s | e8s | same | |
| marketplace_fee_rate_bps | bps | 0–5000 | locked into each offer at creation |
| premium_auction_cut_bps | bps | 0–5000 | 0 = the regular cut |
| admin_prices.offer_creation_fee_e8s | e8s, optional | none, or 0 / 10,000 … 10 ICP | special prices |
| admin_prices.auction_cut_bps | bps, optional | none or 0–5000 | |
| min_offer_duration_ns | ns | 60 s … 30 d | |
| max_assets_per_offer | count | 1–50 | |
| min_increment_usd_range_min / _range_max / _target | USD cents | 1 … $100,000; cross rule min ≤ target ≤ max | |
| min_increment_fallback_tokens | base units | 1 … 10^15 | |
| expiration_check_interval_seconds | s | 60 s … 1 d | restarts the running timer |
| neuron_info_cache_staleness_seconds | s | 0 … 7 d | |
| rate_limit.{createOffer, createOffer_premium, reserveBid, confirmBid, cancelOffer}.{capacity, per_minute} | count | see above | |

Stays admin-only:
- the fee recipient and the per-ledger recipients (§7.2);
- partner prices (§7.5);
- the canister ids (premium, backend, factory, SMS, lock);
- the admin list and `updateConfig`;
- asset types;
- the expiration timer on/off and trigger;
- the rescue methods;
- the cache clears;
- ICRC-3 maintenance.

### 6.2 Sneed Lock (`src/sneed_lock`, classic, governance already admin)

| Setting | Unit | Bounds |
|---|---|---|
| token_lock_fee_icp_e8s, position_lock_fee_icp_e8s, premium_token_lock_fee_icp_e8s, premium_position_lock_fee_icp_e8s (`admin_set_lock_fees_icp`) | e8s | 0 or ≥ 10,000 … 10 ICP |
| max_lock_length_days (`set_max_lock_length_days`, stored in ns) | days | 1 … 36,500. The setter has no bound today; lowering it never shortens existing locks. Check this before shipping. |
| admin_prices.token_lock_fee_icp_e8s, admin_prices.position_lock_fee_icp_e8s | e8s, optional | as the fees |
| rate_limit.{create_lock, create_position_lock, claim}.* | | |

Admin-only:
- the ICP fee recipient;
- the premium canister id;
- the admin list;
- the returns, rescues, pool withdrawals, claim-history clears and reconcile;
- partner prices.

### 6.3 Sneed Premium (`src/sneed_premium`, EOP: upgrades need KEEP)

| Setting | Unit | Bounds |
|---|---|---|
| min_claim_interval_ns | ns | 1 min … 30 d |
| admin_prices.icp_tier_price_bps | bps of the tier price, optional | 1–10000 |
| icp_tier.<i>.amount_e8s, icp_tier.<i>.duration_ns, icp_tier.<i>.active | e8s / ns / bool | amount ≥ 10,000 and ≤ 1,000 ICP; duration 1 d … 10 y |
| vp_tier.<i>.min_voting_power_e8s, vp_tier.<i>.duration_ns, vp_tier.<i>.active | e8s VP / ns / bool | duration 1 d … 10 y |

- Tier rows are addressed by index, and the table is built from the current tier list.
- Adding or removing tiers stays an admin action, for now, because it changes the table's shape.
  A later `Value` case could carry whole rows.

Admin-only:
- the payment recipient;
- the ledger and governance ids;
- `updateConfig`;
- the admin list;
- promo codes (per-case support);
- set, extend and revoke memberships (support credits).

### 6.4 Sneedapp (`src/sneedapp`, classic)

| Setting | Unit | Bounds |
|---|---|---|
| creation_fee_e8s, premium_creation_fee_e8s | e8s | 0 or ≥ 10,000 … 100 ICP |
| target_cycles_amount, canister_creation_cycles | cycles | 0.5T … 20T. A bot below its creation cost would fail; check the factory's minimum. |
| payment_required | bool | |
| admin_prices.mint_fee_e8s | e8s, optional | |
| publisher.<id>.dao_cut_bps, app.<id>.dao_cut_bps (optional override) | bps | 0–10000. The table rows are built per publisher and app at call time. |

Admin-only:
- the fee destination (§7.2);
- `sneedGovernance` and the premium id;
- the authorized callers;
- the manager wasm (too big for a proposal payload);
- official versions (they belong to the release process);
- the publisher verification (moderation);
- the refund, top-up, withdraw, register and orphan tools;
- ICRC-3 maintenance.

### 6.5 Sneed Forum (`src/sneed_sns_forum`, EOP + KEEP, governance already admin)

| Setting | Unit | Bounds |
|---|---|---|
| text_limits.{post_title, post_body, thread_title, thread_body, topic_title, topic_description, forum_title, forum_description} | chars | title 10 … 1,000; body 100 … 200,000 (stays under the ingress caps) |
| premium_post_body_max_length, premium_thread_body_max_length | chars | ≥ the regular limit, ≤ 200,000 |
| rate_limit.{thread, post, edit, poll, tip, vote}.* | | |

Admin-only:
- the premium and notifications canister ids;
- the rate-limit exempt list (per principal, support);
- the proposals topics (structure);
- moderation;
- the admin list.

### 6.6 Sneed SMS (`src/sneed_sms`, EOP + KEEP, governance already admin)

| Setting | Unit | Bounds |
|---|---|---|
| rate_limit_minutes, max_subject_length, max_body_length, max_recipients | min / chars / count | 0–1,440 min; subject 10–1,000; body 100–100,000; recipients 1–100 |
| premium_rate_limit_minutes, premium_max_subject_length, premium_max_body_length, premium_max_recipients | same | at least as generous as the regular limits |
| rate_limit.send.* (`admin_set_send_rate_limit`) | | |

Admin-only:
- the premium id;
- the authorized senders (wiring);
- the system sender principal;
- the notifications canister;
- the exempt list;
- the imports;
- the admin list.

### 6.7 Sneed Hub backend (`src/app_sneeddao_backend`, EOP + KEEP)

| Setting | Unit | Bounds |
|---|---|---|
| jailbreak_fee_premium_e8s, jailbreak_fee_regular_e8s | e8s | 0 or ≥ 10,000 … 100 ICP |
| admin_prices.jailbreak_fee_e8s | e8s, optional | |
| nickname limits: max_neuron_nicknames, max_principal_nicknames, regular and premium | count | 1 … 100,000; premium ≥ regular |
| canister group limits: groups, canisters per group, total, regular and premium | count | 1 … 10,000; premium ≥ regular |

Admin-only:
- the jailbreak fee account (§7.2);
- the donation account;
- the feedback recipients and topics;
- the premium and names canister ids;
- the names freeze (emergency);
- the token whitelist and authorized callers;
- the blacklist (moderation);
- bans, avatar clears, name verification and hidden donations (support);
- partners and projects;
- the token-metadata jobs;
- send_tokens and transfer_position;
- the admin list.

### 6.8 Sneed Notifications (`src/sneed_notifications`, EOP + KEEP)

The setter today is `admin_set_config(Config)`, a whole record with no bounds. It splits into:

| Setting | Unit | Bounds |
|---|---|---|
| price_e8s.<channel> (one per channel), notify_price_e8s | e8s | 0 … 1 ICP |
| dedupe_window_ns, retention_ns, relay_lease_ns | ns | dedupe 0 … 1 d; retention 1 d … 2 y; lease 10 s … 1 h |
| default_daily_cap, default_daily_spend_cap_e8s | count / e8s | 1 … 100,000 / 0 … 100 ICP |
| max_title, max_body | chars | 10 … 1,000 / 100 … 20,000 |
| max_attempts | count | 1–20 |
| fee_sweep_threshold_e8s | e8s | 10,000 … 100 ICP |
| rate_limit.<action>.* | | `admin_set_rate_limit` writes no log block today; dao_set does |

Admin-only:
- the ledger, SMS and sns_wasm ids;
- the relays and relay keys (wiring);
- the fee destination (§7.2);
- the app verification and removal;
- credits and forwarding (support);
- the admin list.

### 6.9 Sneed Mon (`src/sneed_mon`, EOP + KEEP; staging only)

| Setting | Unit | Bounds |
|---|---|---|
| tiers.base_daily_price_e8s | e8s per day | 0 … 1 ICP |
| tiers.<i>.daily_multiplier | count | 1 … 1,000. Tier rows are by index; adding or removing tiers stays admin. |
| interval_s, reminder_window_s, neuron_cache_s, neuron_refresh_s, user_refresh_min_s, topic_cache_s | s | interval ≥ 60, others 60 s … 7 d |
| max_users, max_watches_per_user, max_snses, max_calls_per_tick, max_continuations, batch_size, neuron_pages, proposal_pages, max_refresh_per_round, parallel_calls, max_nns_neurons, max_pending_per_user | count | as the setters check now: batch 1–100, parallel 1–50, max_nns_neurons ≤ 100, max_calls_per_tick ≥ 1. Mind spec ic-call-reservation-limit: parallel_calls bounds in-flight calls. |
| sponsored | bool | |
| fee_sweep_threshold_e8s, admin_prices.base_daily_price_e8s | e8s | |

Admin-only:
- pause and resume (emergency);
- the notifications canister and app id;
- billing ledger changes;
- the fee destination;
- withdraw, run now and register;
- the admin list.

### 6.10 RLL (`src/sneed_rewards`, classic, governance already admin)

| Setting | Unit | Bounds |
|---|---|---|
| credit_chunk_size | owners per message | 1 … 100,000 (as now) |
| token_min_distribution.<ledger>, token_max_distribution.<ledger> | base units | only for whitelisted tokens; rows built per token; min ≤ max |
| rate_limit.{claim_full_balance_of_hotkey, balances_of_hotkey, balance_reconciliation}.* | | |
| main_loop_frequency_seconds | s | 1 h … 7 d. It has no setter today; add one with the table. |

Admin-only:
- the known and whitelisted token registries;
- main loop start/stop and distribution cycles (operations);
- the imports and balance checks;
- claim incidents (support);
- the clears;
- the admin list.

### 6.11 Sneed Pad (`src/sneed_pad`, classic, governance already admin; staging only)

| Setting | Unit | Bounds |
|---|---|---|
| creation_fee_e8s, premium_creation_fee_e8s, sneed_dao_control_fee_e8s, index_creation_fee_e8s, premium_index_creation_fee_e8s | e8s | 0 or ≥ 10,000 … 100 ICP |
| ledger_cycles, index_cycles, cycle_reserve | cycles | ≥ 1T (as now) … 20T |
| follow_nns | bool | |
| admin_prices.{creation_fee_e8s, index_creation_fee_e8s, sneed_dao_control_fee_e8s} | e8s, optional | |
| rate_limit.{create_token, create_index, get_quote, get_index_quote}.* | | |

Note: `admin_set_config` is not atomic today (spec inventory 2026-10-23). The dao_set path is
atomic by construction.

Admin-only:
- paused (emergency);
- the guardians, the canister ids and the registration neuron;
- the wasm hashes and wasm fetch (release process);
- set controllers and withdraw (rescue);
- the fee destination;
- the admin list.

### 6.12 Naming canisters (EOP + KEEP)

The names canisters are pid_names, neuron_names and profiles. Settings:

| Canister | Settings | Bounds |
|---|---|---|
| sneed_pid_names | max_members | 1–1,000 |
| sneed_pid_names | max_hotkeys | 0–100 |
| sneed_profiles | max_dapp_canisters | 1–100 |
| sneed_neuron_nicknames, sneed_pid_nicknames | max_free, max_premium | free ≤ premium ≤ 10,000 |
| sneed_pid_nicknames | account_max_free, account_max_premium | free ≤ premium ≤ 10,000 |
| sneed_avatars | max_held, max_held_premium | held ≤ premium ≤ 10,000 |
| all six | rate_limit.<action>.* | |

- The nickname and avatar canisters have no ICRC-3 log. Their dao_set changes are therefore
  visible only in governance's proposal record until they get one.
- The rate-limit changes of neuron_names and profiles are not logged today; dao_set logs them.

Admin-only:
- the moderator, premium, dao_governance, sns_wasm and archive_controllers wiring;
- the imports and finish_import;
- moderation (admin_set_name, admin_clear_avatar, admin_remove, hide dapp);
- admin_upload_for;
- the admin list.

The `*_by_dao` verify methods stay as they are: per-case decisions, already DAO-only.

### 6.13 Sneed Guardian (classic; staging only)

Not planned, and id 6111 is only reserved.
- The guardian's settings already change only through its own approved ops
  (`#set_config` → approve_op → execute_op).
- SNS governance takes part as an approver, so a second path would weaken that design
  (spec/custody.md).
- `admin_set_max_open_ops` and the rate limits could join a table later.
- If the guardian ever gets a GNSF, it belongs in `CriticalDappOperations`.

## 7. What stays admin-only, and why

1. **Emergency and support actions.** These are pause/resume, timers on/off and run-now, rescues,
   refunds, credits, returns of misplaced NFTs, reconcile, cache clears, and moderation.
   - They are needed in minutes. A proposal takes 4–10 days.
   - They are per-case, with a principal, an id or an amount, so they are not settings.
   - They are what support runs on (memory: "I am customer support").
   - Every one already writes a support-log entry or ICRC-3 block, so the DAO can audit them.
2. **Money routing: fee recipients, payment and donation accounts.**
   - A non-critical `ApplicationBusinessLogic` proposal (3% yes) must not be able to redirect
     revenue.
   - If the DAO wants it, the same module serves a second entry point, `dao_set_treasury`,
     registered as GNSF `6150 + n` in `TreasuryAssetManagement` (critical: 67% / 20%). It would
     take its own table of `#Account` settings.
   - Revenue goes to the ICP splitter by default (memory: revenue transparency), so there is
     little to change.
3. **Canister wiring: canister ids, ledgers, governance and moderator principals, relays.**
   - A wrong id silently breaks integrations.
   - These change with code, so they belong in upgrade proposals, where the change is reviewable.
   - `set_dao_settings_access` is controller-only for the same reason.
4. **Admin lists.**
   - These are a question of who governs, not a setting.
   - Admin retirement goes canister by canister (memory: sneed_lock admin retirement). When an
     admin list goes away, the canister's tunables are already on dao_set, which is the point.
5. **Partner prices and promo codes.**
   - Each is a per-principal deal with a label and an expiry, not a scalar.
   - It could be a later `Value` case (a record row) or its own method.
   - Admin prices (a scalar per canister) are in the tables.
6. **Wasm uploads and release registries** (`setManagerWasm`, official versions, pad wasm hashes).
   - These exceed or crowd the proposal payload cap (70 KB).
   - They belong to the release process.
7. **ICRC-3 log maintenance** (settings, spill, archive repair, registration).
   - This is operations, with bounds already in `Icrc3Log.applySettings`.
   - It could join the tables later if the DAO wants it.

Admins keep their own setters for the tunables during the transition. A DAO change and an admin
change land in the same log, under the same key, and `expected` protects a proposal from a change
made meanwhile. The member-controlled-DAO goal ends with those admin setters removed, canister by
canister, once the DAO path is proven.

## 8. Rollout

1. **Sneedex pilot (this change).** `dao_set` is built and tested.
   - Rehearse it on staging. Staging is not SNS-controlled, so a controller calls
     `set_dao_settings_access(<staging governance stand-in or own principal>, true)` there.
   - Admins can then call `dao_set` by ingress and check the rendering, the log and the bounds.
   - Turn it off afterwards.
2. **Sneedex on ic.**
   - Upgrade proposal (classic persistence, no KEEP). The upgrade test from 4066b698 shows every
     setting and offer kept.
   - Then AddGenericNervousSystemFunction 6100 (critical).
   - The two can be submitted together. Registration does not call the canister, but submit the
     upgrade first so that it executes first.
   - Then the first `dao_set` proposal.
3. **Sneed Lock** (6101) and **Sneedapp** (6103), both classic. Then **Premium** (6102, EOP, KEEP).
   These are the paying canisters, the ones members care about most.
4. **Forum** (6104) and **SMS** (6105), EOP with KEEP; governance is already admin there. Then
   the **backend** (6106) and **Notifications** (6107).
5. **RLL** (6109). Add the `main_loop_frequency_seconds` setter with the table.
6. **Naming canisters** (6112–6117), together, in one upgrade round.
7. **Mon** (6108) and **Pad** (6110), when they reach ic, with the table from day one.

The frontend comes later:
- A "Propose a change" form on each admin page, built from `dao_settings()`.
- It fills `expected` from the live values and previews through `validate_dao_set`.
- It submits `ExecuteGenericNervousSystemFunction` with the encoded `SetArgs`, for any member
  whose principal holds SubmitProposal on a neuron.
- `Proposal.jsx` already shows `payload_text_rendering`.
- The MCP and Mr Sneed use `dao_settings()` and `encode_dao_set.cjs` the same way.

Each canister step needs:
- a fail-before test (`<CANISTER>_WASM=<canister>_predaoset`);
- an upgrade-from-production test;
- its block keys added to its ICRC-3 spec;
- its api-docs regenerated.

## 9. The first proposals

1. **Upgrade Sneedex** (UpgradeSnsControlledCanister, topic DappCanisterManagement).
   - Build at `/home/snassy/app_sneeddao` with `dfx +0.28.0 build --network ic sneedex`. The hash
     is path-dependent.
   - Use `encode_upgrade.cjs` without KEEP.
   - Summary: what dao_set is, the 24 settings and their bounds, the controller-only access
     switch, and the tests.
2. **Add GNSF 6100 "Sneedex: DAO settings"** (critical). Encode it with
   `node encode_dao_set.cjs gov_idl.cjs add-gnsf out.hex "Sneedex: DAO settings (GNSF 6100)" summary.md sneedex`.
   The dry run decodes to:
   - id 6100;
   - topic ApplicationBusinessLogic;
   - target `7bvk3-ryaaa-aaaal-qtykq-cai.dao_set`;
   - validator `7bvk3-ryaaa-aaaal-qtykq-cai.validate_dao_set`.
3. **The first dao_set.**
   - Make it a real pending decision if there is one. Otherwise make it a small, visible one that
     exercises the path, e.g. the expiration sweep interval or a rate limit.
   - Encode it with `EXPECT=live node encode_dao_set.cjs gov_idl.cjs set …`.
   - Read `validate` first: it shows exactly what voters will see.
