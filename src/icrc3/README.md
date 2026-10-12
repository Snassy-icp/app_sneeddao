# `src/icrc3`: ICRC-3 activity log library

A hash-chained, certified block log with automatic archive canisters, for any
Motoko canister in this repository. First used by `sneed_lock`
(design: [spec/sneed_lock_icrc3.md](../../spec/sneed_lock_icrc3.md), public docs:
[API doc section 8](../app_sneeddao_frontend/public/api-docs/sneed_lock.md)).

| File | Contents |
|---|---|
| `Types.mo` | ICRC-3 interface types (verbatim from the standard), archive protocol, settings, status |
| `Hash.mo` | representation-independent hash of a `Value`, IC hash trees + CBOR, LEB128 |
| `Log.mo` | state, append + certify, live store, read endpoints, settings, spill / archive creation / controllers / cycle top-up |
| `Archive.mo` | the archive actor class: Region-backed stable storage, parent-only `append_blocks`, `icrc3_get_blocks` |

Dependencies: `mo:base` and `mo:sha2` (research-ag, pure hashing). Builds with
moc 0.14.x (classic persistence) and moc 1.x (enhanced orthogonal persistence).
No cycle sharing, no timers that pay anyone, no third-party ledger code.

## Adding the log to a canister

Everything below is boilerplate except the block catalogue and the `append`
calls, which are the canister's own business logic.

```motoko
import Timer "mo:base/Timer";
import Log "../icrc3/Log";
import T3 "../icrc3/Types";

// 1. state
stable var icrc3 : Log.State = Log.init();
transient let icrc3_rt : Log.Runtime = Log.runtime();

// 2. the canister's block catalogue (every btype it may append) and where it is documented
transient let icrc3_catalogue : Log.Config = {
  block_types_url = "https://app.sneeddao.com/api/<canister>#block-types";
  block_types = [ "<prefix>_something_happened", "<prefix>_config_update" ];
};

// 3. glue: identity, archive co-controllers, cycle reserve, text logging
private func icrc3_env() : Log.Environment {
  {
    self = Principal.fromActor(this);
    archive_controllers = [sns_root];            // added next to `self` on every archive
    cycle_reserve = 2_000_000_000_000;           // never spend the balance below this
    new_correlation_id = get_next_correlation_id;
    log_info = func(cid : Nat, m : Text) { log_info(cid, m) };
    log_error = func(cid : Nat, m : Text) { log_error(cid, m) };
  };
};

// 4. append where an action has been committed to local state (update context)
private func icrc3_add(btype : Text, tx : [(Text, T3.Value)]) {
  ignore Log.append(icrc3, btype, Int.abs(Time.now()), tx);
};
// e.g. icrc3_add("<prefix>_something_happened", [("cid", #Nat(cid)), ("caller", Log.principal(caller)), ("amount", #Nat(n))]);

// 5. standard queries
public query func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult { Log.getBlocks(icrc3, args) };
public query func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult { Log.getArchives(icrc3, args) };
public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate { Log.tipCertificate(icrc3) };
public query func icrc3_supported_block_types() : async [T3.BlockType] { Log.supportedBlockTypes(icrc3_catalogue) };
public query func icrc10_supported_standards() : async [T3.SupportedStandard] { Log.supportedStandards() };
public query func icrc3_log_status() : async T3.LogStatus { Log.status(icrc3, icrc3_rt) };

// 6. admin operations (guard with the canister's own admin check)
public shared ({ caller }) func admin_set_icrc3_settings(u : T3.SettingsUpdate) : async { #Ok : T3.Settings; #Err : Text } {
  if (not isAdmin(caller)) { return #Err("admin only") };
  switch (Log.applySettings(icrc3, u)) {
    case (#Err(e)) { #Err(e) };
    case (#Ok(changes)) { /* log each (key, old, new) as a config-update block */ #Ok(icrc3.settings) };
  };
};
public shared ({ caller }) func admin_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
  if (not isAdmin(caller)) { return #Err("admin only") };
  #Ok(await* Log.spill(icrc3, icrc3_rt, icrc3_env(), true));
};
public shared ({ caller }) func admin_icrc3_repair_archive_controllers() : async [(Principal, { #Ok; #Err : Text })] {
  if (not isAdmin(caller)) { Debug.trap("admin only") };
  await* Log.repairArchiveControllers(icrc3, icrc3_env());
};

// 7. background spill check, started on install and after every upgrade
private func icrc3_timer_job() : async () { ignore await* Log.spill(icrc3, icrc3_rt, icrc3_env(), false) };
private func ensure_icrc3_timer<system>() { Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job) };
ensure_icrc3_timer<system>();                 // at the end of the actor body
system func postupgrade() { Log.certify(icrc3); ensure_icrc3_timer<system>(); };
```

Optional: a one-time import of pre-existing state as `<prefix>_import_*` blocks,
guarded by `icrc3.history_imported` (see `icrc3_import_history` in
`src/sneed_lock/main.mo`).

## Conventions for block catalogues

- `btype` values use a canister prefix (`sneedlock_`, `sneedex_`, …). Letter
  prefixes cannot collide with ICRC standards, whose block types start with the
  standard's number.
- Blocks are `Map { btype; ts; phash; tx }`. Inside `tx`: principals as `Blob`
  (`Log.principal`), accounts as `Array [owner, subaccount?]` (`Log.account`),
  numbers as `Nat` (`Log.nat64` for `Nat64`), `cid` = the text-log correlation id,
  `caller` = the calling principal. Omit optional fields instead of encoding
  empty values.
- Log what happened, not what failed. Failures stay in the text logs.
- Document the catalogue at `block_types_url` before shipping; every `btype`
  the canister appends must be in `block_types`.

## Operations

- Settings (`admin_set_icrc3_settings`): `max_live_blocks` (default 2000),
  `spill_batch_size` (500), `archive_max_blocks` (1,000,000),
  `archive_initial_cycles` (1.5 T; the subnet keeps the 0.5 T creation fee),
  `archive_top_up_threshold` (0.5 T), `archive_top_up_amount` (0.5 T).
- The canister needs `archive_initial_cycles + cycle_reserve` to create an archive
  and `archive_top_up_amount + cycle_reserve` to top one up; otherwise it logs an
  error every spill check and the live store keeps growing on the heap.
- Archives are controlled by the canister plus `archive_controllers` (for Sneed:
  the SNS root). Registering an archive with the SNS makes root the sole controller;
  the library needs no controller rights afterwards. The parent that may append is
  fixed at first install and survives upgrades by any controller. When an archive is created (text log line
  `ICRC-3: created archive …`, also listed by `icrc3_log_status`): add it to the
  ic-unicycle cycle monitoring and register it with the SNS by a
  `RegisterDappCanisters` proposal. Upgrade an archive by proposal with a wasm
  compiled from `Archive.mo` alone (`moc -c $(mops sources) Archive.mo`); the init
  argument is ignored on upgrade. A changed `Archive.mo` in the logging canister
  affects only archives created afterwards.
- Verifier: the JavaScript in the API doc works against any canister using this
  library (change the canister id).
