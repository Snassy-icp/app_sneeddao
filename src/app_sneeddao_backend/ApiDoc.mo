/// The text get_api_doc returns: a short guide for agents (full reference in public/api-docs/app_sneeddao_backend.md).
module {
  public let text : Text = "# Sneed Hub backend (canister app_sneeddao_backend)

General-purpose backend of Sneed Hub (https://app.sneeddao.com): the shared token whitelist and token metadata cache, each user's settings and wallet registry (tokens, swap pools, tracked canisters, canister folders, wallet layout), the partner and project directories, the donation thank-you wall and SNS Jailbreak configurations. Legacy name and nickname tables are frozen; names live in the naming service (sneed_pid_names and its siblings).

- Production: `g7s5u-tqaaa-aaaad-qhktq-cai` (controlled by the Sneed SNS; upgrades by DAO proposal)
- Staging: `7tsda-tiaaa-aaaad-aajxa-cai` (separate state; use it to test)

## Units and encoding
- Amounts are base units of their ledger as `nat` (e8s for ICP).
- Timestamps are `int` nanoseconds since the Unix epoch.
- Most methods return `variant { ok; err : text }`. Registration methods return `()` and silently ignore refused calls. `set_wallet_layout` and `delete_canister_groups` throw for anonymous callers. `send_tokens` (admin) returns an ICRC-1 `TransferResult`.

## Authentication
- Shared directories (whitelist, partners, projects, donation wall) are readable by anyone, anonymous included.
- Caller-scoped queries (`get_my_settings`, `get_user_tokens`, `get_tracked_canisters`, `get_wallet_layout`, ...) answer for the calling principal; the anonymous principal gets defaults and empty lists. This is scoping, not secrecy: answers are not encrypted. Store nothing confidential here.
- Updates from the anonymous principal are refused or ignored; some refuse banned principals (`check_ban_status(user)` tells in advance).
- `*_for` registration methods are accepted only from canisters on `get_authorized_for_callers()` (or admins). Admin methods need an admin (`get_admins()`).
- Nothing on-chain is anonymous: every call is signed by a public principal.

## Fees, transfers and irreversible actions
- **SNS Jailbreak fee (ICP)**: `get_my_jailbreak_fee()` (update, checks Sneed Premium) or `get_jailbreak_fee_settings()`. Deposit `fee + 10_000` e8s to `{ owner = backend; subaccount = get_jailbreak_payment_subaccount() }`; `save_jailbreak_config(sns_root, neuron_id_hex, target_principal)` then **charges the fee** from that deposit (an identical config returns its id without charging). The backend never touches the neuron; the user runs the generated script that adds a full controller to their neuron, which is their own irreversible act. `withdraw_jailbreak_payment(amount)` **transfers** unused deposit back to the caller.
- **Donations**: the donor makes a plain ledger transfer to `get_donation_account()` (irreversible), then `register_donation({ ledger; block_index; from_subaccount; message })` lists it. The wall is public and shows the donor's principal.
- Admin-only `send_tokens` and `transfer_position` move tokens or ICPSwap positions held by the backend.
- Legacy name writes are frozen: they return `err(\"Names are moving to the new naming service; please try again shortly\")`.

## Asynchronous lifecycle and polling
- Jailbreak: get fee -> deposit -> poll `get_jailbreak_payment_balance()` until it covers the fee -> `save_jailbreak_config` -> `get_my_jailbreak_configs()`.
- Donations: wait for the ledger block, then register once.
- The whitelist is refreshed by a daily job (`get_token_list_status()`, `get_refresh_all_progress()`); no need to poll more than occasionally.

## Errors, retries and Busy
- Registration and settings updates are idempotent and safe to retry.
- `save_jailbreak_config` charges once per distinct configuration, so a retry with the same arguments is safe.
- `register_donation` refuses a block already listed (`This donation is already on the wall`), so retries are safe.
- `set_cached_token_meta` fills only empty entries for non-admins and ignores refused writes.

## Common pitfalls
- Query methods sent as update calls are refused by the ingress guard (`inspect`); call every query as a query.
- Arguments are capped in size (names 32 characters, `denomination_token` 256, neuron id hex 128, donation messages 200, wallet layout 2,000 entries; most methods take a small argument). `names_moderate` is for the naming canisters only and is refused at ingress.
- Read and write names in the naming service, not here.
- `get_canister_info`, `get_user_neurons`, `get_my_canister_groups_usage` and `get_my_jailbreak_fee` are update calls.

## Start with these methods
`get_whitelisted_tokens`, `is_token_whitelisted`, `get_my_settings` / `set_my_settings`, `register_user_token`, `get_user_tokens`, `get_tracked_canisters`, `get_donation_account`, `register_donation`, `get_donations`, `get_jailbreak_fee_settings`, `get_names_canisters`.

## Full reference
- https://app.sneeddao.com/api-docs/app_sneeddao_backend.md
- Candid: https://app.sneeddao.com/api-docs/app_sneeddao_backend.did
- All Sneed APIs: https://app.sneeddao.com/llms.txt
";
};
