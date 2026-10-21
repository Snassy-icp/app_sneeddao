# Sneed Hub backend canister API

`app_sneeddao_backend` is the general-purpose backend of Sneed Hub (app.sneeddao.com). It keeps the shared token whitelist and token metadata cache, each user's app settings and wallet registry (tokens, swap pools, tracked canisters, canister folders, wallet layout), the partner and project directories, the donation thank-you wall, and the SNS Jailbreak configurations. It also holds the legacy name and nickname tables, which are now frozen while names live in the [naming service](/api/sneed_names).

This document covers what integrators can use. Administrative methods are listed briefly at the end.

| | |
|---|---|
| Production canister | `g7s5u-tqaaa-aaaad-qhktq-cai` |
| Staging canister | `7tsda-tiaaa-aaaad-aajxa-cai` (separate state, same code line; use it to test) |
| Candid interface | [app_sneeddao_backend.did](/api-docs/app_sneeddao_backend.did) · [JavaScript IDL factory](/api-docs/app_sneeddao_backend.did.js) |
| Source | [src/app_sneeddao_backend/main.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_backend/main.mo) · [Types.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_backend/Types.mo) · [Donations.mo](https://github.com/Snassy-icp/app_sneeddao/blob/main/src/app_sneeddao_backend/Donations.mo) |
| This document | [rendered](/api/app_sneeddao_backend) · [raw Markdown](/api-docs/app_sneeddao_backend.md) |

The production canister is controlled by the Sneed SNS (root `fp274-iaaaa-aaaaq-aacha-cai`); upgrades are decided by Sneed DAO proposals. The method set below matches the source on `main`.

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide to this canister (units and encoding, authentication, fees, transfers and irreversible actions, asynchronous flows and polling, common pitfalls) that links back to this document. It is a free query; like every query, the ingress guard refuses it as an update call.

---

## 1. Mental model

### 1.1 Three kinds of data

| Kind | Who writes | Who reads | Examples |
|---|---|---|---|
| **Shared directories** | Admins (and, for the metadata cache, any signed-in user filling an empty entry) | Anyone | Token whitelist, token metadata cache, partners, projects, donation wall, feedback settings |
| **Per-user records** | The caller, for itself | The caller (caller-scoped queries) | Settings, registered tokens and swap pools, tracked canisters, canister folders, wallet layout, jailbreak configs |
| **Legacy names** | Nobody right now (frozen) | Anyone | Principal and neuron names, nicknames, avatars |

Caller-scoped queries answer for the principal that makes the call, so another principal sees its own records, not yours. That is a scoping rule, not secrecy: query answers are not encrypted, and canister memory is readable by the subnet's node providers. Do not store anything confidential here.

### 1.2 Anonymous callers and bans

Updates from the anonymous principal are refused or ignored (registration methods return without doing anything). Caller-scoped queries answer defaults or empty lists for the anonymous principal. Some updates also refuse banned principals (`You are banned`, or `You are banned. Ban expires in ...`); `check_ban_status(user)` tells you in advance.

### 1.3 Amounts and time

Amounts are base units of their ledger (`e8s` for ICP) as `nat`. Timestamps are `int` nanoseconds since the Unix epoch.

### 1.4 Calls the canister refuses at ingress

The canister's `inspect` refuses, before anybody pays for them: query methods sent as update calls; `names_moderate` from outside the IC; oversized arguments (names at most 32 characters, `denomination_token` 256, neuron id hex 128, donation messages 200, an inline avatar 32,768, a wallet layout 2,000 entries, canister folders as many as the largest limits allow; most other methods take a small argument); admin methods with free-form content from non-admins; `set_cached_token_meta` from the anonymous principal.

---

## 2. Quick start

### 2.1 Create an actor

```js
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from './app_sneeddao_backend.did.js'; // https://app.sneeddao.com/api-docs/app_sneeddao_backend.did.js

const BACKEND = 'g7s5u-tqaaa-aaaad-qhktq-cai';

export function backendActor(identity) {
  const agent = new HttpAgent({ identity, host: 'https://icp-api.io' });
  return Actor.createActor(idlFactory, { agent, canisterId: BACKEND });
}
```

With dfx:

```bash
dfx canister --network ic call g7s5u-tqaaa-aaaad-qhktq-cai is_token_whitelisted '(principal "hvgxa-wqaaa-aaaaq-aacia-cai")' --query
```

### 2.2 Read the token whitelist

```js
const backend = backendActor();             // anonymous is fine for shared directories
const tokens = await backend.get_whitelisted_tokens();
// [{ ledger_id, symbol, name, decimals, fee, standard }]
const status = await backend.get_token_list_status();
console.log(`${status.tokens} tokens, last import ${new Date(Number(status.last_import / 1_000_000n))}`);
```

### 2.3 A user's wallet registry

```js
const me = backendActor(identity);
await me.register_user_token(Principal.fromText('hvgxa-wqaaa-aaaaq-aacia-cai'));   // idempotent
await me.register_tracked_canister(Principal.fromText(myCanisterId));
const [tokens, canisters, layout] = await Promise.all([
  me.get_user_tokens(), me.get_tracked_canisters(), me.get_wallet_layout(),
]);
```

### 2.4 Register a donation

```js
// 1. Transfer to the donation account with a plain ICRC-1 transfer (or ICP ledger transfer); keep the block index.
const [account] = await backend.get_donation_account();          // [] when none is set
const blockIndex = await sneedLedger.icrc1_transfer({ to: account, amount, from_subaccount: [], fee: [], memo: [], created_at_time: [] });
// 2. List it on the wall
const r = await me.register_donation({ ledger: SNEED_LEDGER, block_index: blockIndex.Ok, from_subaccount: [], message: ['Thanks!'] });
if ('err' in r) throw new Error(r.err);
```

---

## 3. Flows in detail

### 3.1 Token whitelist and metadata cache

- `get_whitelisted_tokens()` and `is_token_whitelisted(ledger)` read the shared list Sneed Hub treats as known tokens. A daily job (every 86,400 s, `get_token_list_status()`) imports ICPSwap's trusted token list (`k37c6-riaaa-aaaag-qcyza-cai`; existing entries updated, hand-added ones kept) and then refreshes every entry's `icrc1_metadata` in batches of 5. `get_refresh_all_progress()` shows a running refresh.
- `get_cached_token_meta(pool)` returns ICPSwap pool token metadata (`token0`, `token1` key/value lists) cached for the frontend. `set_cached_token_meta(pool, meta)`: any signed-in, unbanned user may fill an **empty** entry; only admins may overwrite an existing one. Refused writes are ignored silently, so this never fails a lookup.

### 3.2 Settings

`get_my_settings()` returns the caller's `UserSettings` (defaults for unset fields; all defaults for the anonymous principal). `set_my_settings(UserSettingsUpdate)` changes only the fields given as `opt` values and returns the full settings (`err("Anonymous caller not allowed")` for anonymous). Defaults include `denomination_token = "xevnm-gaaaa-aaaar-qafnq-cai"` (ckUSDC), `swap_slippage_tolerance = 0.01`, cycle thresholds red 1T / orange 5T, update check every 600 s with a 300 s countdown, and every `notify_*` on.

`get_last_seen_log_id(canister)`, `get_all_last_seen_log_ids()` and `mark_logs_seen(canister, log_id)` keep, per user and bot canister, the highest bot log id the user has seen (it only grows), for log alerts.

### 3.3 Wallet registry

All caller-scoped, idempotent and silent for the anonymous principal:

| Register / unregister | Read | What |
|---|---|---|
| `register_user_token(ledger)` / `unregister_user_token(ledger)` | `get_user_tokens()` | Tokens shown in the wallet, in insertion order. |
| `register_ledger_canister_id(ledger)` / `unregister_ledger_canister_id(ledger)` | `get_ledger_canister_ids()` | The older ledger list (newest first). |
| `register_swap_canister_id(pool)` / `unregister_swap_canister_id(pool)` | `get_swap_canister_ids()` | ICPSwap pools whose positions the wallet shows. |
| `register_tracked_canister(id)` / `unregister_tracked_canister(id)` | `get_tracked_canisters()` | Any canisters the user wants to watch. |

`register_user_token_for(user, ledger)`, `unregister_user_token_for`, `register_tracked_canister_for(user, canister)` and `unregister_tracked_canister_for` do the same for another user and are accepted only from canisters on `get_authorized_for_callers()` (or admins); others are ignored.

### 3.4 Canister folders and wallet layout

`set_canister_groups(CanisterGroupsRoot)` replaces the caller's folder tree (`groups`, nested `subgroups`, and `ungrouped` canisters). Limits depend on Sneed Premium (`get_canister_groups_limits_config()`; `get_my_canister_groups_usage()` gives the caller's counts and limits, as an update because it asks the premium canister). Errors: `Anonymous users cannot save canister groups`, `You are banned`, `You have exceeded your maximum number of folders (N). You have M folders.`, `One of your folders contains more than N canisters (max per folder).`, `You have exceeded your maximum total canisters (N). You have M canisters.`. `delete_canister_groups()` removes the tree (rejects the anonymous principal). `get_canister_groups()` reads it.

`set_wallet_layout(WalletLayout)` stores the order of the wallet's sections (`tokens`, `positions`, `apps`, `sneedapp`, at most 2,000 entries together); it rejects (throws) for anonymous and banned callers. `get_wallet_layout()` reads it.

### 3.5 Donations

`get_donation_account()` is where donations go. After transferring, the donor calls `register_donation({ ledger; block_index; from_subaccount; message })`: the canister reads that block from the ledger (ICP through `query_blocks`, other tokens through ICRC-3) and lists it if it is a plain transfer (not an approval) from the caller's account to the donation account. Accepted ledgers: ICP, SNEED and whitelisted tokens. Messages are trimmed to 200 characters. Errors: `Log in to register a donation`, `No donation account is set`, `Donations in this token can't be checked: use ICP, SNEED or a whitelisted token`, `This donation is already on the wall`, `The ledger has no block N`, `Block N was not sent from your account`, `Block N was not sent to the donation account`, `Block N is not a transfer` / `is not a plain transfer`, `Block N is a transfer made with an approval, not a donation`, `Could not read the ledger: ...`.

Donations are public: the wall shows the donor's principal. `get_donations(start, limit)` pages the wall newest first (at most 100; hidden ones left out); `get_donation_totals()` gives `(ledger, amount, count)` over every verified donation, hidden ones included.

### 3.6 SNS Jailbreak configurations

The [SNS Jailbreak](/help/sns_jailbreak) wizard (`/tools/sns_jailbreak`) produces a script the user runs in the NNS dapp to add a principal (usually their Sneed wallet) as a full controller of an SNS neuron. The backend never touches the neuron: it stores the configuration and charges a fee in ICP.

1. `get_my_jailbreak_fee()` (update: checks Sneed Premium) or `get_jailbreak_fee_settings()` for both fees.
2. Deposit `fee + 10_000` e8s to `{ owner = backend; subaccount = get_jailbreak_payment_subaccount() }` (caller-scoped; check with `get_jailbreak_payment_balance()`).
3. `save_jailbreak_config(sns_root, neuron_id_hex, target_principal)` → `ok(config_id)`. Saving a configuration identical to an existing one returns its id without charging. Errors: `Anonymous users cannot save configurations`, `Insufficient payment balance. Required: ...`, `Payment failed: ...`.
4. `get_my_jailbreak_configs()`, `delete_jailbreak_config(id)` (`Configuration not found`, `No configurations found`), `withdraw_jailbreak_payment(amount)` returns unused deposit to the caller's main account (`ok(block_index)`; `Insufficient balance. Available: ...`).

`get_jailbreak_payment_stats()` gives public totals for the revenue page.

#### Special prices

Next to the regular and premium fee (`get_jailbreak_fee_settings`) the jailbreak fee has an **admin price** and **partner prices** ([spec](https://github.com/Snassy-icp/app_sneeddao/blob/main/spec/special_prices.md)):

- The admin price applies to callers on this canister's admin list who are people (self-authenticating principals; canisters such as SNS root never get it).
- A partner price applies to one principal (usually a partner canister that integrates with Sneed Hub, for example a partner game canister), with a public label and an optional expiry (nanoseconds since 1970).
- The fee charged is the **lowest applicable** one among regular, premium (members), admin and partner. On a tie the earlier tier in that order is reported. Unset overrides change nothing.

`get_my_jailbreak_fee()` returns that lowest fee; `get_my_jailbreak_price()` (update) returns `{ amount_e8s; price_tier }`. Each payment log entry has a price tier (`get_jailbreak_payment_price_tiers(ids)`, admin only like the logs). A fee of 0 (for example a partner override of 0) is not a payment and leaves no log entry, as before.

```candid
type SpecialPriceSet = record { jailbreak_fee_e8s : opt nat };
type PartnerPrices = record { label : text; prices : SpecialPriceSet; expires_at : opt int };
type Tier = variant { regular; premium; admin; partner };

get_special_prices : () -> (record { admin_prices : SpecialPriceSet; partners : vec record { principal : principal; label : text; prices : SpecialPriceSet; expires_at : opt int } }) query;
get_special_prices_for : (principal) -> (record { admin_prices : opt SpecialPriceSet; partner : opt PartnerPrices }) query;
get_my_jailbreak_price : () -> (record { amount_e8s : nat; price_tier : Tier });
set_admin_prices : (SpecialPriceSet) -> (variant { ok; err : text });                    // admin
set_partner_prices : (principal, PartnerPrices) -> (variant { ok; err : text });         // admin
remove_partner_prices : (principal) -> (variant { ok; err : text });                     // admin
get_jailbreak_payment_price_tiers : (vec nat) -> (variant { ok : vec record { nat; Tier }; err : text }) query;  // admin
```

`set_partner_prices` refuses the anonymous principal, an empty label, a label over 100 characters, an expiry in the past and a 201st partner; `remove_partner_prices` refuses a principal without an entry.

### 3.7 Directories and helpers

- `get_partners()`, `get_partner(id)`, `get_projects()`, `get_project(id)`: the partner and project directories shown in Sneed Hub (`index` is the display order).
- `get_feedback_config()`: the forum topics for public bug reports and ideas and the principals that receive every report as a Sneed SMS (at most 5).
- `get_canister_info(canister_id)` (update) returns `{ controllers; module_hash }` from the management canister's `canister_info`, for any canister.
- `get_user_neurons()` (update) lists the caller's neurons in the Sneed SNS (at most 100) with their permissions. Errors: `Anonymous users cannot get neurons`, `You are banned`, `Failed to fetch neurons: ...`.
- `check_ban_status(user)`: `ok` or `err("You are banned. Ban expires in ...")`.
- `get_nickname_limits_config()`, `get_my_nickname_usage()` (update): legacy nickname limits (normal and premium).

### 3.8 Legacy names (frozen)

Principal names, neuron names, nicknames, canister names and avatars moved to the naming service ([Sneed names API](/api/sneed_names)). `get_names_frozen()` is `true` on production: every naming write here returns `err("Names are moving to the new naming service; please try again shortly")`. The reads still answer from the old tables and are kept for older clients: `get_principal_name(p)` and `get_neuron_name(sns_root, neuron_id)` → `opt (name, verified)`, `get_all_principal_names()`, `get_all_neuron_names()`, `get_avatar(p)`, `get_avatars(vec p)` (at most 50; principals without one left out), `get_avatar_count()`, and the caller-scoped `get_principal_nickname(p)`, `get_all_principal_nicknames()`, `get_neuron_nickname(sns_root, neuron_id)`, `get_all_neuron_nicknames()`. New integrations should read and write names in the naming canisters. `get_names_canisters()` lists them.

The frozen write methods are `set_principal_name`, `set_principal_name_for`, `set_neuron_name`, `set_principal_nickname`, `set_neuron_nickname`, `set_canister_name`, `set_my_avatar`, `clear_my_avatar`, `verify_principal_name`, `unverify_principal_name`, `verify_neuron_name`, `unverify_neuron_name`. `names_moderate(record { user; text; is_public })` is called by the naming canisters only (traps otherwise): it checks bans and the blacklist, and bans a user who puts a blacklisted word in a public name.

---

## 4. Errors and retries

Result shapes vary: most methods return `variant { ok; err : text }`; some registration methods return nothing and ignore refused calls; `set_wallet_layout` and `delete_canister_groups` throw for anonymous callers; `send_tokens` returns an ICRC-1 `TransferResult`. Registration and settings updates are idempotent and safe to retry. `save_jailbreak_config` charges once per distinct configuration and is safe to retry with the same arguments. `register_donation` refuses a block that is already listed, so retries are safe.

---

## 5. Method reference

### 5.1 Public queries

| Method | Returns |
|---|---|
| `get_whitelisted_tokens()` | `vec WhitelistedToken` |
| `is_token_whitelisted(ledger)` | `bool` |
| `get_cached_token_meta(pool)` | `opt TokenMeta` |
| `get_token_list_status()` | `TokenListStatus` |
| `get_refresh_all_progress()` | `RefreshAllProgress` |
| `get_partners()`, `get_partner(id)` | `vec Partner`, `opt Partner` |
| `get_projects()`, `get_project(id)` | `vec Project`, `opt Project` |
| `get_donation_account()` | `opt Account` |
| `get_donations(start, limit)` | `record { total : nat; donations : vec Donation }` |
| `get_donation_totals()` | `vec record { principal; nat; nat }` |
| `get_feedback_config()` | `FeedbackConfig` |
| `get_jailbreak_fee_settings()` | `{ fee_regular_e8s; fee_premium_e8s; fee_account_owner; fee_account_subaccount }` |
| `get_jailbreak_payment_stats()` | `Result` with totals (scripts, revenue e8s, premium/regular counts, unique users) |
| `get_special_prices()`, `get_special_prices_for(principal)` | the admin and partner prices (3.6, Special prices) |
| `get_nickname_limits_config()`, `get_canister_groups_limits_config()` | limit records |
| `check_ban_status(user)` | `variant { ok; err : text }` |
| `get_admins()`, `get_authorized_for_callers()`, `get_names_canisters()`, `get_names_frozen()` | configuration |
| Legacy name reads | see 3.8 |

### 5.2 Caller-scoped queries

`get_my_settings`, `get_last_seen_log_id`, `get_all_last_seen_log_ids`, `get_user_tokens`, `get_ledger_canister_ids`, `get_swap_canister_ids`, `get_tracked_canisters`, `get_canister_groups`, `get_wallet_layout`, `get_my_jailbreak_configs`, `get_jailbreak_payment_subaccount`, `caller_is_admin`, and the legacy nickname reads.

### 5.3 User updates

| Method | Returns | Section |
|---|---|---|
| `set_my_settings(UserSettingsUpdate)` | `variant { ok : UserSettings; err : text }` | 3.2 |
| `mark_logs_seen(canister, log_id)` | `()` | 3.2 |
| `register_*` / `unregister_*` (tokens, ledgers, pools, tracked canisters) | `()` | 3.3 |
| `set_canister_groups(root)`, `delete_canister_groups()` | `Result`, `()` | 3.4 |
| `set_wallet_layout(layout)` | `()` | 3.4 |
| `get_my_canister_groups_usage()`, `get_my_nickname_usage()` | usage records | 3.4, 3.7 |
| `set_cached_token_meta(pool, meta)` | `()` | 3.1 |
| `register_donation(RegisterArgs)` | `variant { ok : Donation; err : text }` | 3.5 |
| `save_jailbreak_config`, `delete_jailbreak_config`, `get_my_jailbreak_fee`, `get_my_jailbreak_price`, `get_jailbreak_payment_balance`, `withdraw_jailbreak_payment` | see 3.6 | 3.6 |
| `get_canister_info(canister_id)` | `variant { ok : record { controllers; module_hash }; err : text }` | 3.7 |
| `get_user_neurons()` | `variant { ok : vec Neuron; err : text }` | 3.7 |

### 5.4 Admin methods

Restricted to admins (`get_admins()`), the canister's controllers and the deployer. Integrators never call them.

| Method | One line |
|---|---|
| `add_admin`, `remove_admin` | Manage the admin list. |
| `add_whitelisted_token`, `remove_whitelisted_token` | Edit the token whitelist by hand. |
| `import_whitelist_from_icpswap`, `import_whitelist_from_swaprunner` | Import ICPSwap's token list now (the second is an old alias). |
| `refresh_token_metadata`, `start_refresh_all_token_metadata`, `stop_refresh_all_token_metadata`, `run_token_list_maintenance_now` | Refresh whitelist metadata. |
| `add_authorized_for_caller`, `remove_authorized_for_caller` | Canisters allowed to call the `*_for` registration methods. |
| `add_partner`, `update_partner`, `remove_partner`, `add_project`, `update_project`, `remove_project` | Directories. |
| `ban_user`, `unban_user`, `get_ban_log`, `get_banned_users`, `get_user_ban_history`, `test_calculate_ban_duration` | Moderation. |
| `add_blacklisted_word`, `remove_blacklisted_word`, `get_blacklisted_words` | Name blacklist. |
| `admin_set_names_canisters`, `admin_set_names_frozen`, `admin_clear_avatar`, `admin_export_principal_nicknames`, `admin_export_neuron_nicknames`, `admin_export_avatars` | Name migration to the naming service. |
| `set_nickname_premium_canister`, `update_nickname_limits`, `update_canister_groups_limits` | Limits and the Sneed Premium canister. |
| `set_jailbreak_fee_settings`, `get_jailbreak_payment_logs`, `get_all_jailbreak_configs_count` | Jailbreak fees and logs. |
| `set_admin_prices`, `set_partner_prices`, `remove_partner_prices`, `get_jailbreak_payment_price_tiers` | Special prices (3.6). |
| `admin_set_donation_account`, `admin_set_donation_hidden`, `admin_get_donations` | Donations. |
| `admin_set_feedback_config` | Feedback topics and recipients. |
| `send_tokens`, `transfer_position` | Recovery of tokens or ICPSwap positions held by the backend. |

---

## 6. Types

```candid
type WhitelistedToken = record { ledger_id : principal; symbol : text; name : text; decimals : nat8; fee : nat; standard : text };
type TokenMeta = record { token0 : vec record { text; TokenMetaValue }; token1 : vec record { text; TokenMetaValue } };
type TokenMetaValue = variant { Blob : blob; Int : int; Nat : nat; Text : text };
type CanisterGroup = record { id : text; name : text; canisters : vec principal; subgroups : vec CanisterGroup };
type CanisterGroupsRoot = record { groups : vec CanisterGroup; ungrouped : vec principal };
type WalletLayout = record { tokens : vec principal; positions : vec principal; apps : vec principal; sneedapp : vec principal };
type Account = record { owner : principal; subaccount : opt blob };
type RegisterArgs = record { ledger : principal; block_index : nat; from_subaccount : opt blob; message : opt text };
type Donation = record {
  id : nat; donor : principal; from_subaccount : opt blob; to : Account; ledger : principal; block_index : nat;
  amount : nat; created_at : int; registered_at : int; message : opt text; hidden : bool;
};
type JailbreakConfig = record { id : nat; sns_root_canister_id : principal; neuron_id_hex : text; target_principal : principal; created_at : int };
type Partner = record { id : nat; name : text; logo_url : text; description : text; links : vec PartnerLink; index : opt nat; created_at : int; updated_at : int };
type Project = record { id : nat; name : text; logo_url : opt text; description : text; project_type : ProjectType; links : vec ProjectLink; index : opt nat; created_at : int; updated_at : int };
type ProjectType = variant { product; project; fork };
type PartnerLink = record { title : text; url : text };   // ProjectLink has the same shape
type FeedbackConfig = record { recipients : vec principal; bug_topic : opt nat; idea_topic : opt nat };
type TokenListStatus = record { tokens : nat; interval_seconds : nat; timer_scheduled : bool; refresh_running : bool;
  last_import : int; last_refresh_started : int; last_refresh_done : int; last_error : text };
type NeuronId = record { id : blob };
type NeuronNameKey = record { sns_root_canister_id : principal; neuron_id : NeuronId };
type Neuron = record { id : opt NeuronId; permissions : vec record { principal; vec int32 } };
```

`UserSettings` and `UserSettingsUpdate` have 29 fields (display options, cycle thresholds, frontend update behaviour, swap slippage, `denomination_token`, and the `notify_*` switches); see the Candid file.

---

## 7. Integration checklist

- Use query calls for every `get_*` marked query; the canister refuses them as updates.
- Sign the calls that should act on a user's records; the anonymous principal gets defaults and empty lists.
- Read and write names in the [naming service](/api/sneed_names), not here.
- Treat per-user records as scoped, not private.
- For donations, keep the block index of the transfer and register it once; do not describe a donation as anonymous: the donor's principal is on the wall.
