/// Sneed Pad: the token launchpad.
///
/// Mints ICRC ledgers (and optionally their index canisters) from the DFINITY
/// ledger suite, taking the wasm bytes from the NNS's SNS wasm canister by a
/// hash the DAO approved, so the token safety page recognises the code from
/// day one. The creator pays once in ICP through an ICRC-2 approval; part of
/// it becomes cycles for the new canisters through the CMC, the rest is the
/// fee. Control of the new canisters goes where the creator chose: kept, the
/// blackhole canister, or Sneed DAO (through a registration proposal).
/// Every launch is written to this canister's ICRC-3 log.
///
/// Design: spec/token_safety.md (section 4).
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Cycles "mo:base/ExperimentalCycles";
import Error "mo:base/Error";
import Int "mo:base/Int";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Timer "mo:base/Timer";
import Char "mo:base/Char";
import Sha256 "mo:sha2/Sha256";
import PremiumClient "../PremiumClient";
import IngressGuard "../IngressGuard";

import T "Types";
import Icrc3Log "../icrc3/Log";
import T3 "../icrc3/Types";
import Icrc3Sns "../icrc3/SnsRegister";

shared ({ caller = installer }) persistent actor class SneedPad() = this {
  // ---- well-known canisters ----
  transient let ICP_LEDGER_ID = "ryjl3-tyaaa-aaaaa-aaaba-cai";
  transient let CMC_ID = "rkp4c-7iaaa-aaaaa-aaaca-cai";
  transient let SNS_WASM_ID = "qaa6y-5yaaa-aaaaa-aaafa-cai";
  transient let BLACKHOLE_ID = "e3mmv-5qaaa-aaaah-aadma-cai"; // ninegua's blackhole: immutable, exposes canister_status
  transient let SNEED_GOVERNANCE_ID = "fi3zi-fyaaa-aaaaq-aachq-cai";
  transient let SNEED_PREMIUM_ID = "7gump-4aaaa-aaaal-qtyka-cai";
  transient let SNEEDAPP_ID = "sfamc-kyaaa-aaaau-adnpq-cai";
  transient let APP_ID_LEDGER = "icrc-ledger"; // SneedApp app ids the wallet shows the canisters under
  transient let APP_ID_INDEX = "icrc-index";
  transient let SNEED_ROOT_ID = "fp274-iaaaa-aaaaq-aacha-cai";
  transient let RLL_ID = "lvc4n-7aaaa-aaaam-adm6a-cai";
  transient let ICP_FEE : Nat = 10_000;
  transient let TOP_UP_MEMO : Blob = "\50\55\50\54"; // "TPUP" little-endian, what the CMC expects
  transient let T_CYCLES : Nat = 1_000_000_000_000;
  // Creating a canister costs 0.5 T on a 13-node subnet and installing the ledger about 0.35 T more,
  // so a new canister needs at least this much to come up at all.
  transient let MIN_CANISTER_CYCLES : Nat = T_CYCLES;

  // Test deployments may point at mock canisters.
  stable var icp_ledger_id : Principal = Principal.fromText(ICP_LEDGER_ID);
  stable var cmc_id : Principal = Principal.fromText(CMC_ID);
  stable var sns_wasm_id : Principal = Principal.fromText(SNS_WASM_ID);
  stable var sneed_governance : Principal = Principal.fromText(SNEED_GOVERNANCE_ID);
  stable var sneed_root : Principal = Principal.fromText(SNEED_ROOT_ID);
  stable var blackhole : Principal = Principal.fromText(BLACKHOLE_ID);
  stable var sneed_premium_id : ?Principal = ?Principal.fromText(SNEED_PREMIUM_ID);
  stable var sneedapp_id : ?Principal = ?Principal.fromText(SNEEDAPP_ID);
  stable var premium_cache = PremiumClient.emptyCache();

  transient let ic : T.Management = actor ("aaaaa-aa");
  private func icp_ledger() : T.IcpLedger { actor (Principal.toText(icp_ledger_id)) };
  private func cmc() : T.Cmc { actor (Principal.toText(cmc_id)) };
  private func sns_wasm() : T.SnsWasmCanister { actor (Principal.toText(sns_wasm_id)) };

  // ---- admin ----
  stable var admins : [Principal] = [installer];
  private func isAdmin(p : Principal) : Bool {
    Principal.isController(p) or p == sneed_governance or Array.find<Principal>(admins, func(a) { a == p }) != null;
  };

  // ---- configuration ----
  stable var ledger_wasm_hash : ?Blob = null;
  stable var index_wasm_hash : ?Blob = null;
  stable var ledger_wasm : ?Blob = null; // fetched from the SNS wasm canister, verified against the hash
  stable var index_wasm : ?Blob = null;
  stable var creation_fee_e8s : Nat = 500_000_000; // 5 ICP
  stable var premium_creation_fee_e8s : Nat = 250_000_000; // 2.5 ICP for Sneed Premium members
  stable var sneed_dao_control_fee_e8s : Nat = 500_000_000; // 5 ICP more when control goes to Sneed DAO, which then keeps the canisters running
  stable var index_creation_fee_e8s : Nat = 100_000_000; // 1 ICP for an index of an existing ledger
  stable var premium_index_creation_fee_e8s : Nat = 50_000_000;
  stable var index_launches : [T.IndexLaunch] = [];
  stable var next_index_launch_id : Nat = 1;
  // The wasm hashes follow the NNS: once a day the pad asks the SNS wasm
  // canister for the latest SNS version and takes its ledger and index
  // hashes, so nobody has to run anything. The DAO can pin hashes instead.
  stable var follow_nns : Bool = true;
  stable var guardians : [Principal] = []; // custody canisters a creator may choose (set by the DAO once they are deployed)
  stable var wasm_last_check : Int = 0;
  stable var wasm_last_refresh : Int = 0;
  stable var wasm_last_error : ?Text = null;
  transient var wasm_refresh_running : Bool = false;
  transient var wasm_timer_started : Bool = false;
  transient let WASM_CHECK_INTERVAL_SECONDS : Nat = 86_400;
  transient let WASM_CHECK_MIN_GAP_NS : Int = 10 * 60 * 1_000_000_000; // anyone may ask for a check, this often
  stable var ledger_cycles : Nat = 3 * T_CYCLES;
  stable var index_cycles : Nat = 2 * T_CYCLES;
  stable var fee_destination : T.Account = { owner = Principal.fromText(RLL_ID); subaccount = null };
  stable var cycle_reserve : Nat = 2 * T_CYCLES;
  stable var paused : Bool = false;

  // ---- launches ----
  stable var next_launch_id : Nat = 1;
  stable var launches : [T.Launch] = [];
  stable var next_correlation_id : Nat = 1;
  private func newCid() : Nat { let c = next_correlation_id; next_correlation_id += 1; c };

  // ---- text log (last 500 lines, for operators) ----
  stable var text_log : [Text] = [];
  private func logText(cid : Nat, level : Text, m : Text) {
    let line = Int.toText(Time.now()) # " [" # Nat.toText(cid) # "] " # level # " " # m;
    let b = Buffer.fromArray<Text>(text_log);
    b.add(line);
    while (b.size() > 500) { ignore b.remove(0) };
    text_log := Buffer.toArray(b);
  };

  // ---- ICRC-3 log ----
  stable var icrc3 : Icrc3Log.State = Icrc3Log.init();
  transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();
  transient let icrc3_catalogue : Icrc3Log.Config = {
    block_types_url = "https://app.sneeddao.com/api/sneed_pad#block-types";
    block_types = ["sneedpad_token_create", "sneedpad_index_create", "sneedpad_control_set", "sneedpad_launch_failed", "sneedpad_config_update", "sneedpad_wasm_set", "sneedpad_rescue"];
  };
  private func icrc3_env() : Icrc3Log.Environment {
    {
      self = Principal.fromActor(this);
      archive_controllers = [sneed_root];
      cycle_reserve = cycle_reserve;
      new_correlation_id = newCid;
      log_info = func(cid : Nat, m : Text) { logText(cid, "info", m) };
      log_error = func(cid : Nat, m : Text) { logText(cid, "error", m) };
    };
  };
  private func icrc3_add(btype : Text, tx : [(Text, T3.Value)]) { ignore Icrc3Log.append(icrc3, btype, Int.abs(Time.now()), tx) };
  private func ensure_icrc3_timer<system>() { Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job) };
  private func icrc3_timer_job() : async () {
    ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false);
    ignore await* Icrc3Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env());
  };

  // ---- SNS registration (archives of the log, and launched ledgers handed to the DAO) ----
  stable var icrc3_sns : Icrc3Sns.State = Icrc3Sns.init();
  transient let icrc3_sns_rt : Icrc3Sns.Runtime = Icrc3Sns.runtime();
  private func icrc3_sns_env() : Icrc3Sns.Environment {
    {
      governance = sneed_governance;
      name = "Sneed Pad";
      doc_url = "https://app.sneeddao.com/api/sneed_pad";
      new_correlation_id = newCid;
      log_info = func(cid : Nat, m : Text) { logText(cid, "info", m) };
      log_error = func(cid : Nat, m : Text) { logText(cid, "error", m) };
      describe = null;
    };
  };
  stable var ledger_registrations : Icrc3Sns.State = Icrc3Sns.init(); // one registration per launched ledger handed to the DAO
  transient let ledger_registrations_rt : Icrc3Sns.Runtime = Icrc3Sns.runtime();
  private func ledger_registration_env() : Icrc3Sns.Environment {
    let base = icrc3_sns_env();
    {
      base with
      describe = ?(func(canister_id : Principal, _start : Nat) : { title : Text; summary : Text } {
        let id = Principal.toText(canister_id);
        let launch = Array.find<T.Launch>(launches, func(l) { l.ledger == ?canister_id or l.index == ?canister_id });
        let what = switch (launch) {
          case (?l) { (if (l.index == ?canister_id) { "the index canister of " } else { "the ledger of " }) # l.config.name # " (" # l.config.symbol # ")" };
          case null { "a canister" };
        };
        {
          title = "Register " # what # " launched on Sneed Pad";
          summary = "Sneed Pad launched " # what # " as `" # id # "` and its creator chose to hand control to Sneed DAO.\n\n"
            # "Adopting this proposal registers the canister as a dapp canister of the DAO: SNS root becomes its sole controller, so the DAO can inspect and upgrade it by proposal (only to vetted ledger-suite code).\n\n"
            # "This proposal was submitted automatically by Sneed Pad through a hotkeyed neuron when the token was launched.\n\n"
            # "Operator checklist: add `" # id # "` to the DAO's cycle monitoring.";
        };
      });
    };
  };

  // ---- helpers ----
  private func principalToSubaccount(p : Principal) : Blob {
    let bytes = Blob.toArray(Principal.toBlob(p));
    let out = Array.tabulate<Nat8>(32, func(i) { if (i == 0) { Nat8.fromNat(bytes.size()) } else if (i <= bytes.size()) { bytes[i - 1] } else { 0 } });
    Blob.fromArray(out);
  };
  private func sha256(b : Blob) : Blob { Sha256.fromBlob(#sha256, b) };
  private func hex(b : Blob) : Text {
    let digits = "0123456789abcdef";
    let chars = Iter.toArray(digits.chars());
    var out = "";
    for (byte in b.vals()) { let n = Nat8.toNat(byte); out #= Text.fromChar(chars[n / 16]) # Text.fromChar(chars[n % 16]) };
    out;
  };
  private func findLaunch(id : Nat) : ?T.Launch { Array.find<T.Launch>(launches, func(l) { l.id == id }) };
  private func putLaunch(l : T.Launch) {
    if (findLaunch(l.id) == null) { launches := Array.append(launches, [l]) }
    else { launches := Array.map<T.Launch, T.Launch>(launches, func(x) { if (x.id == l.id) { l } else { x } }) };
  };
  private func step(l : T.Launch, name : Text) : T.Launch { { l with steps = Array.append(l.steps, [(name, Time.now())]) } };

  // ---- validation ----
  private func validateControl(control : T.ControlChoice) : ?Text {
    switch (control) {
      case (#keep_with(ps)) {
        if (ps.size() > 10) { return ?"at most 10 extra controllers" };
        for (p in ps.vals()) { if (Principal.isAnonymous(p)) { return ?"the anonymous principal cannot be a controller" } };
      };
      case (#sns(root)) { if (Principal.isAnonymous(root)) { return ?"an SNS root canister is needed" } };
      case (#guardian(g)) {
        if (Array.find<Principal>(guardians, func(x) { x == g.canister }) == null) { return ?"that is not one of the Sneed custody canisters" };
        if (g.policy.guardians.size() > 20) { return ?"at most 20 veto principals" };
        for (p in g.policy.guardians.vals()) { if (Principal.isAnonymous(p)) { return ?"the anonymous principal cannot be a veto principal" } };
        if (g.policy.vetoes_to_block > g.policy.guardians.size() or g.policy.oks_required > g.policy.guardians.size()) { return ?"vetoes_to_block and oks_required cannot exceed the number of veto principals" };
        if (g.policy.vetoes_to_block > 0 and g.policy.window_ns == 0) { return ?"vetoes need a window: set window_ns" };
        if (g.policy.window_ns > 90 * 86_400 * 1_000_000_000) { return ?"the veto window is at most 90 days" };
      };
      case _ {};
    };
    null;
  };
  private func validate(c : T.TokenConfig) : ?Text {
    if (c.symbol.size() == 0 or c.symbol.size() > 12) { return ?"symbol must be 1 to 12 characters" };
    if (c.name.size() == 0 or c.name.size() > 64) { return ?"name must be 1 to 64 characters" };
    if (c.decimals > 18) { return ?"decimals must be at most 18" };
    switch (c.logo) { case (?l) { if (l.size() > 200_000) { return ?"logo must be a data URL of at most 200 kB" }; if (not Text.startsWith(l, #text "data:image/")) { return ?"logo must be a data:image/... URL" } }; case null {} };
    var total = 0;
    for (a in c.allocations.vals()) { if (a.amount == 0) { return ?"an allocation of 0 makes no sense" }; total += a.amount };
    if (total == 0) { return ?"at least one allocation is needed: a token with no supply cannot be traded" };
    if (c.allocations.size() > 1000) { return ?"at most 1000 allocations at launch; more can be distributed afterwards" };
    switch (c.minting) { case (#principal(p)) { if (Principal.isAnonymous(p)) { return ?"the anonymous principal cannot be the minting account; choose #nobody for a fixed supply" } }; case _ {} };
    switch (validateControl(c.control)) { case (?e) { return ?e }; case null {} };
    null;
  };
  /// The SNS root a creator hands control to must be one the NNS deployed.
  private func isDeployedSnsRoot(root : Principal) : async* Bool {
    if (root == sneed_root) { return true };
    let r = try { await sns_wasm().list_deployed_snses({}) } catch (_) { return false };
    Array.find<{ root_canister_id : ?Principal }>(r.instances, func(i) { i.root_canister_id == ?root }) != null;
  };
  private func handoverFee(control : T.ControlChoice) : Nat {
    switch (control) { case (#sneed_dao or #guardian(_)) { sneed_dao_control_fee_e8s }; case (#sns(root)) { if (root == sneed_root) { sneed_dao_control_fee_e8s } else { 0 } }; case _ { 0 } };
  };

  // ---- quotes ----
  private func icpForCycles(cycles : Nat, xdrPermyriadPerIcp : Nat64) : Nat {
    // 1 XDR = 1 T cycles; the CMC gives xdr_permyriad_per_icp * 1e8 cycles per ICP; add 5% for rate movement
    let cyclesPerIcp = Nat64.toNat(xdrPermyriadPerIcp) * 100_000_000;
    if (cyclesPerIcp == 0) { return 0 };
    (cycles * 100_000_000 * 105) / (cyclesPerIcp * 100);
  };
  private func makeQuote(c : T.TokenConfig, rate : Nat64, premium : Bool) : T.Quote {
    let idx = if (c.with_index) { index_cycles } else { 0 };
    let forCycles = icpForCycles(ledger_cycles + idx, rate);
    let fees = ICP_FEE * 3; // pull, CMC transfer, fee transfer
    let fee = if (premium) { premium_creation_fee_e8s } else { creation_fee_e8s };
    let controlFee = handoverFee(c.control);
    {
      creation_fee_e8s = fee; control_fee_e8s = controlFee; ledger_cycles = ledger_cycles; index_cycles = idx;
      icp_for_cycles_e8s = forCycles; ledger_fees_e8s = fees; total_e8s = fee + controlFee + forCycles + fees;
      xdr_permyriad_per_icp = rate; premium;
    };
  };
  /// Sneed Premium membership (cached by the shared client); never blocks a launch when the membership canister is unreachable.
  private func isPremium(p : Principal) : async* Bool {
    if (Principal.isAnonymous(p)) { return false };
    switch (sneed_premium_id) {
      case (?id) { try { await* PremiumClient.isPremium(premium_cache, id, p) } catch (_) { false } };
      case null { false };
    };
  };
  /// What a launch with this configuration costs the caller today (an update call: it asks the CMC for the rate and Sneed Premium for the membership).
  public shared ({ caller }) func get_quote(c : T.TokenConfig) : async { #Ok : T.Quote; #Err : Text } {
    switch (validate(c)) { case (?e) { return #Err(e) }; case null {} };
    let premium = await* isPremium(caller);
    let rate = try { (await cmc().get_icp_xdr_conversion_rate()).data.xdr_permyriad_per_icp } catch (e) { return #Err("could not read the ICP/XDR rate: " # Error.message(e)) };
    #Ok(makeQuote(c, rate, premium));
  };

  // ---- the launch ----
  /// Launch a token. The caller must have approved this canister for at
  /// least the quoted total on the ICP ledger (ICRC-2). Steps in order: pull
  /// the payment, turn part into cycles, forward the fee, create and install
  /// the ledger, optionally the index, then set the controllers.
  public shared ({ caller }) func create_token(c : T.TokenConfig) : async { #Ok : T.Launch; #Err : Text } {
    if (paused) { return #Err("the launchpad is paused") };
    if (Principal.isAnonymous(caller)) { return #Err("log in first") };
    switch (validate(c)) { case (?e) { return #Err(e) }; case null {} };
    let wasm = switch (ledger_wasm) { case (?w) { w }; case null { return #Err("no ledger wasm is loaded yet (the pad fetches the NNS's latest ledger version once a day); try again later or call refresh_wasms") } };
    let idxWasm = if (c.with_index) { switch (index_wasm) { case (?w) { ?w }; case null { return #Err("no index wasm is loaded yet; launch without an index or try again later") } } } else { null };
    switch (c.control) { case (#sns(root)) { if (not (await* isDeployedSnsRoot(root))) { return #Err("that is not the root canister of a deployed SNS") } }; case _ {} };
    let cid = newCid();
    let premium = await* isPremium(caller);
    let rate = try { (await cmc().get_icp_xdr_conversion_rate()).data.xdr_permyriad_per_icp } catch (e) { return #Err("could not read the ICP/XDR rate: " # Error.message(e)) };
    let quote = makeQuote(c, rate, premium);
    let needCycles = cycle_reserve + quote.ledger_cycles + quote.index_cycles;
    // The creator pays for the cycles, but the CMC credit arrives after the
    // canisters would be created; the pad fronts them from its own balance.
    if (Cycles.balance() < needCycles) { return #Err("the launchpad is low on cycles; try again later") };

    var launch : T.Launch = {
      id = next_launch_id; creator = caller; created_at = Time.now(); config = c; quote = quote; paid_e8s = 0;
      ledger = null; index = null; ledger_wasm_hash = ledger_wasm_hash; index_wasm_hash = if (c.with_index) { index_wasm_hash } else { null };
      controllers = []; registration_proposal = null; status = #created; steps = [];
    };
    next_launch_id += 1;

    // 1. pull the payment
    let pull = try {
      await icp_ledger().icrc2_transfer_from({ spender_subaccount = null; from = { owner = caller; subaccount = null }; to = { owner = Principal.fromActor(this); subaccount = null }; amount = quote.total_e8s; fee = ?ICP_FEE; memo = null; created_at_time = null });
    } catch (e) { return #Err("payment failed: " # Error.message(e)) };
    switch (pull) {
      case (#Err(#InsufficientAllowance(a))) { return #Err("approve the launchpad for " # Nat.toText(quote.total_e8s) # " e8s on the ICP ledger first (allowance is " # Nat.toText(a.allowance) # ")") };
      case (#Err(#InsufficientFunds(b))) { return #Err("not enough ICP: balance " # Nat.toText(b.balance) # " e8s, need " # Nat.toText(quote.total_e8s + ICP_FEE)) };
      case (#Err(e)) { return #Err("payment failed: " # debug_show(e)) };
      case (#Ok(_)) {};
    };
    launch := step({ launch with paid_e8s = quote.total_e8s }, "paid");
    putLaunch(launch);
    logText(cid, "info", "launch " # Nat.toText(launch.id) # ": " # Nat.toText(quote.total_e8s) # " e8s pulled from " # Principal.toText(caller));

    // 2. ICP to cycles through the CMC (best effort: the pad fronted the cycles already)
    if (quote.icp_for_cycles_e8s > ICP_FEE) {
      try {
        let t = await icp_ledger().icrc1_transfer({ from_subaccount = null; to = { owner = cmc_id; subaccount = ?principalToSubaccount(Principal.fromActor(this)) }; amount = quote.icp_for_cycles_e8s; fee = ?ICP_FEE; memo = ?TOP_UP_MEMO; created_at_time = null });
        switch (t) {
          case (#Ok(block)) {
            switch (await cmc().notify_top_up({ block_index = Nat64.fromNat(block); canister_id = Principal.fromActor(this) })) {
              case (#Ok(cycles)) { logText(cid, "info", "launch " # Nat.toText(launch.id) # ": CMC minted " # Nat.toText(cycles) # " cycles"); launch := step(launch, "cycles") };
              case (#Err(e)) { logText(cid, "error", "launch " # Nat.toText(launch.id) # ": CMC notify failed: " # debug_show(e)) };
            };
          };
          case (#Err(e)) { logText(cid, "error", "launch " # Nat.toText(launch.id) # ": transfer to the CMC failed: " # debug_show(e)) };
        };
      } catch (e) { logText(cid, "error", "launch " # Nat.toText(launch.id) # ": CMC step failed: " # Error.message(e)) };
    };

    // 3. the fees (launch fee, and the handover fee when control goes to Sneed DAO)
    let feeTotal = quote.creation_fee_e8s + quote.control_fee_e8s;
    if (feeTotal > ICP_FEE) {
      try {
        switch (await icp_ledger().icrc1_transfer({ from_subaccount = null; to = fee_destination; amount = feeTotal - ICP_FEE; fee = ?ICP_FEE; memo = null; created_at_time = null })) {
          case (#Ok(_)) { launch := step(launch, "fee") };
          case (#Err(e)) { logText(cid, "error", "launch " # Nat.toText(launch.id) # ": fee transfer failed: " # debug_show(e)) };
        };
      } catch (e) { logText(cid, "error", "launch " # Nat.toText(launch.id) # ": fee transfer failed: " # Error.message(e)) };
    };
    putLaunch(launch);

    // 4. the ledger
    let self = Principal.fromActor(this);
    let finalControllers : [Principal] = switch (c.control) {
      case (#keep) { [caller] };
      case (#keep_with(ps)) { Array.append([caller], Array.filter<Principal>(ps, func(p) { p != caller })) };
      case (#blackhole) { [blackhole] };
      case (#sneed_dao) { [sneed_root] };
      case (#sns(root)) { [root] };
      case (#guardian(g)) { [g.canister] };
    };
    let archiveController : Principal = finalControllers[0];
    let ledgerId = try {
      (await (with cycles = quote.ledger_cycles) ic.create_canister({ settings = ?{ controllers = ?[self]; compute_allocation = null; memory_allocation = null; freezing_threshold = null }; sender_canister_version = null })).canister_id;
    } catch (e) { return fail(cid, launch, "could not create the ledger canister: " # Error.message(e)) };
    launch := step({ launch with ledger = ?ledgerId }, "ledger_created");
    putLaunch(launch);
    // The index canister is created now (installed after the ledger) so the ledger can announce it through ICRC-106.
    let indexId : ?Principal = switch (idxWasm) {
      case (?_) {
        let id = try {
          (await (with cycles = quote.index_cycles) ic.create_canister({ settings = ?{ controllers = ?[self]; compute_allocation = null; memory_allocation = null; freezing_threshold = null }; sender_canister_version = null })).canister_id;
        } catch (e) { return fail(cid, launch, "could not create the index canister: " # Error.message(e)) };
        launch := step({ launch with index = ?id }, "index_created");
        putLaunch(launch);
        ?id;
      };
      case null { null };
    };
    let mintingAccount : T.Account = switch (c.minting) { case (#nobody) { { owner = ledgerId; subaccount = null } }; case (#sneed_dao) { { owner = sneed_governance; subaccount = null } }; case (#principal(p)) { { owner = p; subaccount = null } } };
    let metadata : [(Text, T.MetadataValue)] = switch (c.logo) { case (?l) { [("icrc1:logo", #Text(l))] }; case null { [] } };
    let init : T.LedgerInitArgs = {
      decimals = ?c.decimals; token_symbol = c.symbol; token_name = c.name; transfer_fee = c.transfer_fee; metadata = metadata;
      minting_account = mintingAccount;
      initial_balances = Array.map<T.Allocation, (T.Account, Nat)>(c.allocations, func(a) { (a.account, a.amount) });
      maximum_number_of_accounts = null; accounts_overflow_trim_quantity = null;
      fee_collector_account = c.fee_collector;
      archive_options = {
        num_blocks_to_archive = 1000; max_transactions_per_response = null; trigger_threshold = 2000;
        more_controller_ids = null; max_message_size_bytes = null; cycles_for_archive_creation = ?1_000_000_000_000; node_max_memory_size_bytes = null;
        controller_id = archiveController;
      };
      max_memo_length = null; feature_flags = ?{ icrc2 = true };
      index_principal = indexId;
    };
    let arg : T.LedgerArgument = #Init(init);
    try {
      await ic.install_code({ mode = #install; canister_id = ledgerId; wasm_module = wasm; arg = to_candid(arg); sender_canister_version = null });
    } catch (e) { return fail(cid, launch, "could not install the ledger: " # Error.message(e)) };
    launch := step(launch, "ledger_installed");
    putLaunch(launch);
    var supply = 0; for (a in c.allocations.vals()) { supply += a.amount };
    icrc3_add("sneedpad_token_create", [
      ("cid", #Nat(cid)), ("launch", #Nat(launch.id)), ("creator", Icrc3Log.principal(caller)), ("ledger", Icrc3Log.principal(ledgerId)),
      ("symbol", #Text(c.symbol)), ("name", #Text(c.name)), ("decimals", #Nat(Nat8.toNat(c.decimals))), ("supply", #Nat(supply)), ("transfer_fee", #Nat(c.transfer_fee)),
      ("minting_account", Icrc3Log.principal(mintingAccount.owner)), ("paid_e8s", #Nat(quote.total_e8s)), ("ledger_cycles", #Nat(quote.ledger_cycles)),
      ("wasm_hash", switch (ledger_wasm_hash) { case (?h) { #Blob(h) }; case null { #Text("") } }),
    ]);

    // 5. the index
    switch (idxWasm, indexId) {
      case (?iw, ?indexId) {
        let iarg : T.IndexArg = #Init({ ledger_id = ledgerId; retrieve_blocks_from_ledger_interval_seconds = null });
        try {
          await ic.install_code({ mode = #install; canister_id = indexId; wasm_module = iw; arg = to_candid(iarg); sender_canister_version = null });
        } catch (e) { return fail(cid, launch, "ledger launched, but the index could not be installed: " # Error.message(e)) };
        launch := step(launch, "index_installed");
        putLaunch(launch);
        icrc3_add("sneedpad_index_create", [("cid", #Nat(cid)), ("launch", #Nat(launch.id)), ("ledger", Icrc3Log.principal(ledgerId)), ("index", Icrc3Log.principal(indexId)), ("index_cycles", #Nat(quote.index_cycles))]);
      };
      case _ {};
    };

    // 6. control
    let ids = Array.append<Principal>([ledgerId], switch (launch.index) { case (?i) { [i] }; case null { [] } });
    switch (c.control) {
      case (#guardian(g)) {
        // the custody canister must be a controller to register the canister, and the pad must still be one to prove ownership
        let guardian : T.GuardianActor = actor (Principal.toText(g.canister));
        for (id in ids.vals()) {
          try {
            await ic.update_settings({ canister_id = id; settings = { controllers = ?[self, g.canister]; compute_allocation = null; memory_allocation = null; freezing_threshold = null }; sender_canister_version = null });
          } catch (e) { return fail(cid, launch, "launched, but adding the custody canister as a controller of " # Principal.toText(id) # " failed: " # Error.message(e)) };
          let kind : T.GuardianKind = if (id == ledgerId) { #ledger } else { #index };
          let title = c.name # " (" # c.symbol # ") " # (if (id == ledgerId) { "ledger" } else { "index" });
          let r = try { await guardian.register(id, kind, g.policy, if (id == ledgerId) { null } else { ?ledgerId }, title) } catch (e) { return fail(cid, launch, "launched, but the custody canister could not be reached to register " # Principal.toText(id) # ": " # Error.message(e)) };
          switch (r) { case (#Err(e)) { return fail(cid, launch, "launched, but the custody canister refused " # Principal.toText(id) # ": " # e) }; case (#Ok(_)) {} };
        };
        launch := step(launch, "guardian_registered");
      };
      case _ {};
    };
    for (id in ids.vals()) {
      try {
        await ic.update_settings({ canister_id = id; settings = { controllers = ?finalControllers; compute_allocation = null; memory_allocation = null; freezing_threshold = null }; sender_canister_version = null });
      } catch (e) { return fail(cid, launch, "launched, but setting the controllers of " # Principal.toText(id) # " failed: " # Error.message(e)) };
    };
    launch := step({ launch with controllers = finalControllers }, "controllers_set");
    // 7. the creator's wallet: list the new canisters in SneedApp, as a SneedApp mint would (best effort)
    switch (sneedapp_id) {
      case (?appId) {
        let app : T.SneedApp = actor (Principal.toText(appId));
        var ok = true;
        for ((id, kind) in Array.append<(Principal, Text)>([(ledgerId, APP_ID_LEDGER)], switch (launch.index) { case (?i) { [(i, APP_ID_INDEX)] }; case null { [] } }).vals()) {
          try {
            switch (await app.registerCanisterFor(caller, id, kind)) { case (#Ok) {}; case (#Err(e)) { ok := false; logText(cid, "error", "launch " # Nat.toText(launch.id) # ": SneedApp refused to list " # Principal.toText(id) # ": " # e) } };
          } catch (e) { ok := false; logText(cid, "error", "launch " # Nat.toText(launch.id) # ": SneedApp call failed for " # Principal.toText(id) # ": " # Error.message(e)) };
        };
        if (ok) { launch := step(launch, "wallet_registered") };
      };
      case null {};
    };
    icrc3_add("sneedpad_control_set", [("cid", #Nat(cid)), ("launch", #Nat(launch.id)), ("ledger", Icrc3Log.principal(ledgerId)), ("control", #Text(debug_show(c.control))), ("controllers", #Array(Array.map<Principal, T3.Value>(finalControllers, Icrc3Log.principal)))]);
    // Handing over to an SNS: the creator files the RegisterDappCanisters proposal with their own
    // neuron from the studio; the pad holds no neuron of any DAO for that.
    putLaunch(launch);
    logText(cid, "info", "launch " # Nat.toText(launch.id) # " done: ledger " # Principal.toText(ledgerId));
    #Ok(launch);
  };

  private func fail(cid : Nat, l : T.Launch, why : Text) : { #Ok : T.Launch; #Err : Text } {
    let failed : T.Launch = { l with status = #failed(why) };
    putLaunch(failed);
    logText(cid, "error", "launch " # Nat.toText(l.id) # " failed: " # why);
    icrc3_add("sneedpad_launch_failed", [("cid", #Nat(cid)), ("launch", #Nat(l.id)), ("creator", Icrc3Log.principal(l.creator)), ("reason", #Text(why))]);
    #Err(why);
  };

  // ---- an index for an existing ledger ----
  private func makeIndexQuote(control : T.ControlChoice, rate : Nat64, premium : Bool) : T.Quote {
    let forCycles = icpForCycles(index_cycles, rate);
    let fees = ICP_FEE * 3;
    let fee = if (premium) { premium_index_creation_fee_e8s } else { index_creation_fee_e8s };
    let controlFee = handoverFee(control);
    { creation_fee_e8s = fee; control_fee_e8s = controlFee; ledger_cycles = 0; index_cycles = index_cycles; icp_for_cycles_e8s = forCycles; ledger_fees_e8s = fees; total_e8s = fee + controlFee + forCycles + fees; xdr_permyriad_per_icp = rate; premium };
  };
  private func findIndexLaunch(id : Nat) : ?T.IndexLaunch { Array.find<T.IndexLaunch>(index_launches, func(l) { l.id == id }) };
  private func putIndexLaunch(l : T.IndexLaunch) {
    if (findIndexLaunch(l.id) == null) { index_launches := Array.append(index_launches, [l]) }
    else { index_launches := Array.map<T.IndexLaunch, T.IndexLaunch>(index_launches, func(x) { if (x.id == l.id) { l } else { x } }) };
  };
  private func istep(l : T.IndexLaunch, name : Text) : T.IndexLaunch { { l with steps = Array.append(l.steps, [(name, Time.now())]) } };
  private func ifail(cid : Nat, l : T.IndexLaunch, why : Text) : { #Ok : T.IndexLaunch; #Err : Text } {
    putIndexLaunch({ l with status = #failed(why) });
    logText(cid, "error", "index launch " # Nat.toText(l.id) # " failed: " # why);
    icrc3_add("sneedpad_launch_failed", [("cid", #Nat(cid)), ("launch", #Nat(l.id)), ("creator", Icrc3Log.principal(l.creator)), ("reason", #Text(why)), ("kind", #Text("index"))]);
    #Err(why);
  };
  /// What an index for an existing ledger costs the caller today.
  public shared ({ caller }) func get_index_quote(c : T.IndexConfig) : async { #Ok : T.Quote; #Err : Text } {
    switch (validateControl(c.control)) { case (?e) { return #Err(e) }; case null {} };
    let premium = await* isPremium(caller);
    let rate = try { (await cmc().get_icp_xdr_conversion_rate()).data.xdr_permyriad_per_icp } catch (e) { return #Err("could not read the ICP/XDR rate: " # Error.message(e)) };
    #Ok(makeIndexQuote(c.control, rate, premium));
  };
  /// Create an index canister (the NNS-blessed index wasm) for a ledger that already exists. Same
  /// payment flow as a token launch. Pointing the ledger at it (ICRC-106) is the ledger
  /// controller's job afterwards; the index works without it.
  public shared ({ caller }) func create_index(c : T.IndexConfig) : async { #Ok : T.IndexLaunch; #Err : Text } {
    if (paused) { return #Err("the launchpad is paused") };
    if (Principal.isAnonymous(caller)) { return #Err("log in first") };
    switch (validateControl(c.control)) { case (?e) { return #Err(e) }; case null {} };
    let iw = switch (index_wasm) { case (?w) { w }; case null { return #Err("no index wasm is loaded yet; try again later") } };
    switch (c.control) { case (#sns(root)) { if (not (await* isDeployedSnsRoot(root))) { return #Err("that is not the root canister of a deployed SNS") } }; case _ {} };
    // the ledger must at least answer like one
    let ledgerActor : T.AnyLedger = actor (Principal.toText(c.ledger));
    let symbol = try { await ledgerActor.icrc1_symbol() } catch (e) { return #Err("that canister does not answer icrc1_symbol, so it is not an ICRC-1 ledger: " # Error.message(e)) };
    let cid = newCid();
    let premium = await* isPremium(caller);
    let rate = try { (await cmc().get_icp_xdr_conversion_rate()).data.xdr_permyriad_per_icp } catch (e) { return #Err("could not read the ICP/XDR rate: " # Error.message(e)) };
    let quote = makeIndexQuote(c.control, rate, premium);
    if (Cycles.balance() < cycle_reserve + quote.index_cycles) { return #Err("the launchpad is low on cycles; try again later") };
    var launch : T.IndexLaunch = { id = next_index_launch_id; creator = caller; created_at = Time.now(); config = c; quote; paid_e8s = 0; index = null; index_wasm_hash = index_wasm_hash; controllers = []; status = #created; steps = [] };
    next_index_launch_id += 1;
    // 1. the payment
    let pull = try {
      await icp_ledger().icrc2_transfer_from({ spender_subaccount = null; from = { owner = caller; subaccount = null }; to = { owner = Principal.fromActor(this); subaccount = null }; amount = quote.total_e8s; fee = ?ICP_FEE; memo = null; created_at_time = null });
    } catch (e) { return #Err("payment failed: " # Error.message(e)) };
    switch (pull) {
      case (#Err(#InsufficientAllowance(a))) { return #Err("approve the launchpad for " # Nat.toText(quote.total_e8s) # " e8s on the ICP ledger first (allowance is " # Nat.toText(a.allowance) # ")") };
      case (#Err(#InsufficientFunds(b))) { return #Err("not enough ICP: balance " # Nat.toText(b.balance) # " e8s, need " # Nat.toText(quote.total_e8s + ICP_FEE)) };
      case (#Err(e)) { return #Err("payment failed: " # debug_show(e)) };
      case (#Ok(_)) {};
    };
    launch := istep({ launch with paid_e8s = quote.total_e8s }, "paid");
    putIndexLaunch(launch);
    // 2. ICP to cycles (best effort)
    if (quote.icp_for_cycles_e8s > ICP_FEE) {
      try {
        switch (await icp_ledger().icrc1_transfer({ from_subaccount = null; to = { owner = cmc_id; subaccount = ?principalToSubaccount(Principal.fromActor(this)) }; amount = quote.icp_for_cycles_e8s; fee = ?ICP_FEE; memo = ?TOP_UP_MEMO; created_at_time = null })) {
          case (#Ok(block)) { switch (await cmc().notify_top_up({ block_index = Nat64.fromNat(block); canister_id = Principal.fromActor(this) })) { case (#Ok(_)) { launch := istep(launch, "cycles") }; case (#Err(e)) { logText(cid, "error", "index launch " # Nat.toText(launch.id) # ": CMC notify failed: " # debug_show(e)) } } };
          case (#Err(e)) { logText(cid, "error", "index launch " # Nat.toText(launch.id) # ": transfer to the CMC failed: " # debug_show(e)) };
        };
      } catch (e) { logText(cid, "error", "index launch " # Nat.toText(launch.id) # ": CMC step failed: " # Error.message(e)) };
    };
    // 3. the fees
    let feeTotal = quote.creation_fee_e8s + quote.control_fee_e8s;
    if (feeTotal > ICP_FEE) {
      try { switch (await icp_ledger().icrc1_transfer({ from_subaccount = null; to = fee_destination; amount = feeTotal - ICP_FEE; fee = ?ICP_FEE; memo = null; created_at_time = null })) { case (#Ok(_)) { launch := istep(launch, "fee") }; case (#Err(e)) { logText(cid, "error", "index launch " # Nat.toText(launch.id) # ": fee transfer failed: " # debug_show(e)) } } }
      catch (e) { logText(cid, "error", "index launch " # Nat.toText(launch.id) # ": fee transfer failed: " # Error.message(e)) };
    };
    putIndexLaunch(launch);
    // 4. the canister
    let self = Principal.fromActor(this);
    let finalControllers : [Principal] = switch (c.control) {
      case (#keep) { [caller] };
      case (#keep_with(ps)) { Array.append([caller], Array.filter<Principal>(ps, func(p) { p != caller })) };
      case (#blackhole) { [blackhole] };
      case (#sneed_dao) { [sneed_root] };
      case (#sns(root)) { [root] };
      case (#guardian(g)) { [g.canister] };
    };
    let indexId = try {
      (await (with cycles = quote.index_cycles) ic.create_canister({ settings = ?{ controllers = ?[self]; compute_allocation = null; memory_allocation = null; freezing_threshold = null }; sender_canister_version = null })).canister_id;
    } catch (e) { return ifail(cid, launch, "could not create the index canister: " # Error.message(e)) };
    launch := istep({ launch with index = ?indexId }, "index_created");
    putIndexLaunch(launch);
    let iarg : T.IndexArg = #Init({ ledger_id = c.ledger; retrieve_blocks_from_ledger_interval_seconds = null });
    try {
      await ic.install_code({ mode = #install; canister_id = indexId; wasm_module = iw; arg = to_candid(iarg); sender_canister_version = null });
    } catch (e) { return ifail(cid, launch, "the index could not be installed: " # Error.message(e)) };
    launch := istep(launch, "index_installed");
    putIndexLaunch(launch);
    icrc3_add("sneedpad_index_create", [("cid", #Nat(cid)), ("launch", #Nat(launch.id)), ("ledger", Icrc3Log.principal(c.ledger)), ("index", Icrc3Log.principal(indexId)), ("index_cycles", #Nat(quote.index_cycles)), ("standalone", #Text("true")), ("creator", Icrc3Log.principal(caller)), ("paid_e8s", #Nat(quote.total_e8s))]);
    // 5. control
    switch (c.control) {
      case (#guardian(g)) {
        let guardian : T.GuardianActor = actor (Principal.toText(g.canister));
        try { await ic.update_settings({ canister_id = indexId; settings = { controllers = ?[self, g.canister]; compute_allocation = null; memory_allocation = null; freezing_threshold = null }; sender_canister_version = null }) }
        catch (e) { return ifail(cid, launch, "installed, but adding the custody canister as a controller failed: " # Error.message(e)) };
        let r = try { await guardian.register(indexId, #index, g.policy, null, symbol # " index") } catch (e) { return ifail(cid, launch, "installed, but the custody canister could not be reached: " # Error.message(e)) };
        switch (r) { case (#Err(e)) { return ifail(cid, launch, "installed, but the custody canister refused it: " # e) }; case (#Ok(_)) {} };
        launch := istep(launch, "guardian_registered");
      };
      case _ {};
    };
    try { await ic.update_settings({ canister_id = indexId; settings = { controllers = ?finalControllers; compute_allocation = null; memory_allocation = null; freezing_threshold = null }; sender_canister_version = null }) }
    catch (e) { return ifail(cid, launch, "installed, but setting the controllers failed: " # Error.message(e)) };
    launch := istep({ launch with controllers = finalControllers }, "controllers_set");
    // 6. the creator's wallet
    switch (sneedapp_id) {
      case (?appId) {
        let app : T.SneedApp = actor (Principal.toText(appId));
        try { switch (await app.registerCanisterFor(caller, indexId, APP_ID_INDEX)) { case (#Ok) { launch := istep(launch, "wallet_registered") }; case (#Err(e)) { logText(cid, "error", "index launch " # Nat.toText(launch.id) # ": SneedApp refused to list the index: " # e) } } }
        catch (e) { logText(cid, "error", "index launch " # Nat.toText(launch.id) # ": SneedApp call failed: " # Error.message(e)) };
      };
      case null {};
    };
    icrc3_add("sneedpad_control_set", [("cid", #Nat(cid)), ("launch", #Nat(launch.id)), ("ledger", Icrc3Log.principal(c.ledger)), ("control", #Text(debug_show(c.control))), ("controllers", #Array(Array.map<Principal, T3.Value>(finalControllers, Icrc3Log.principal))), ("kind", #Text("index"))]);
    putIndexLaunch(launch);
    logText(cid, "info", "index launch " # Nat.toText(launch.id) # " done: index " # Principal.toText(indexId) # " for " # Principal.toText(c.ledger));
    #Ok(launch);
  };
  public query func list_index_launches(start : Nat, length : Nat) : async { total : Nat; launches : [T.IndexLaunch] } {
    let n = index_launches.size();
    let from = if (start >= n) { n } else { start };
    let to = if (from + length > n) { n } else { from + length };
    { total = n; launches = Array.tabulate<T.IndexLaunch>(to - from, func(i) { index_launches[from + i] }) };
  };
  public query func get_index_launches_by_creator(p : Principal) : async [T.IndexLaunch] { Array.filter<T.IndexLaunch>(index_launches, func(l) { l.creator == p }) };
  /// Every index the pad created for a ledger (a launch's own index first).
  public query func get_indexes_of_ledger(ledger : Principal) : async [Principal] {
    let out = Buffer.Buffer<Principal>(2);
    for (l in launches.vals()) { if (l.ledger == ?ledger) { switch (l.index) { case (?i) { out.add(i) }; case null {} } } };
    for (l in index_launches.vals()) { if (l.config.ledger == ledger) { switch (l.index) { case (?i) { out.add(i) }; case null {} } } };
    Buffer.toArray(out);
  };

  // ---- queries ----
  public query func get_launch(id : Nat) : async ?T.Launch { findLaunch(id) };
  public query func list_launches(start : Nat, length : Nat) : async { total : Nat; launches : [T.Launch] } {
    let n = launches.size();
    let from = Nat.min(start, n); let to = Nat.min(from + length, n);
    { total = n; launches = Array.tabulate<T.Launch>(to - from, func(i) { launches[from + i] }) };
  };
  public query func get_launches_by_creator(p : Principal) : async [T.Launch] { Array.filter<T.Launch>(launches, func(l) { l.creator == p }) };
  public query func get_launch_by_ledger(ledger : Principal) : async ?T.Launch { Array.find<T.Launch>(launches, func(l) { l.ledger == ?ledger }) };
  public query func get_config() : async T.Config {
    {
      ledger_wasm_hash; index_wasm_hash;
      ledger_wasm_bytes = switch (ledger_wasm) { case (?w) { w.size() }; case null { 0 } };
      index_wasm_bytes = switch (index_wasm) { case (?w) { w.size() }; case null { 0 } };
      creation_fee_e8s; premium_creation_fee_e8s; sneed_dao_control_fee_e8s; index_creation_fee_e8s; premium_index_creation_fee_e8s; sneed_premium = sneed_premium_id; ledger_cycles; index_cycles; fee_destination; cycle_reserve; paused;
      follow_nns; guardians; wasm_last_check; wasm_last_refresh; wasm_last_error;
    };
  };
  public query func get_cycle_balance() : async Nat { Cycles.balance() };
  public query func get_text_log(last : Nat) : async [Text] { let n = text_log.size(); let from = if (last >= n) { 0 } else { n - last }; Array.tabulate<Text>(n - from, func(i) { text_log[from + i] }) };
  public query func get_admins() : async [Principal] { admins };
  public query func get_ledger_registration_status() : async Icrc3Sns.Status { Icrc3Sns.status(ledger_registrations, ledger_registration_env()) };

  // ---- wasms: follow the NNS, or hashes the DAO pinned; the bytes always come from the NNS ----
  private func hexDecode(t : Text) : ?Blob {
    let chars = Text.toArray(t);
    if (chars.size() % 2 != 0) { return null };
    let out = Buffer.Buffer<Nat8>(chars.size() / 2);
    var i = 0;
    while (i < chars.size()) {
      let hi = hexVal(chars[i]); let lo = hexVal(chars[i + 1]);
      switch (hi, lo) { case (?h, ?l) { out.add(Nat8.fromNat(h * 16 + l)) }; case _ { return null } };
      i += 2;
    };
    ?Blob.fromArray(Buffer.toArray(out));
  };
  private func hexVal(c : Char) : ?Nat {
    let n = Nat32.toNat(Char.toNat32(c));
    if (n >= 48 and n <= 57) { ?(n - 48) } else if (n >= 97 and n <= 102) { ?(n - 87) } else if (n >= 65 and n <= 70) { ?(n - 55) } else { null };
  };
  private func fetchWasm(hash : Blob) : async* { #Ok : Blob; #Err : Text } {
    let r = try { await sns_wasm().get_wasm({ hash = hash }) } catch (e) { return #Err("SNS wasm canister: " # Error.message(e)) };
    switch (r.wasm) {
      case (?w) {
        if (sha256(w.wasm) != hash) { return #Err("the SNS wasm canister returned bytes whose hash is " # hex(sha256(w.wasm)) # ", not " # hex(hash)) };
        #Ok(w.wasm);
      };
      case null { #Err("the SNS wasm canister has no wasm with hash " # hex(hash)) };
    };
  };
  /// Ask the NNS for its latest SNS version and adopt its ledger and index
  /// hashes (when following), then fetch whatever bytes are missing. A new
  /// version replaces the old one only after its bytes arrived and verified,
  /// so the pad never goes from "can launch" to "cannot".
  private func refreshWasmsImpl(by : Principal) : async* { #Ok : { ledger_bytes : Nat; index_bytes : Nat; changed : Bool }; #Err : Text } {
    if (wasm_refresh_running) { return #Err("a refresh is already running") };
    wasm_refresh_running := true;
    wasm_last_check := Time.now();
    let r = await* refreshWasmsInner(by);
    wasm_refresh_running := false;
    switch (r) { case (#Err(e)) { wasm_last_error := ?e; logText(newCid(), "error", "wasm refresh: " # e) }; case (#Ok(_)) { wasm_last_error := null } };
    r;
  };
  private func refreshWasmsInner(by : Principal) : async* { #Ok : { ledger_bytes : Nat; index_bytes : Nat; changed : Bool }; #Err : Text } {
    var wantLedger = ledger_wasm_hash; var wantIndex = index_wasm_hash;
    if (follow_nns) {
      let latest = try { await sns_wasm().get_latest_sns_version_pretty(null) } catch (e) { return #Err("SNS wasm canister: " # Error.message(e)) };
      for ((kind, h) in latest.vals()) {
        if (kind == "Ledger") { switch (hexDecode(h)) { case (?b) { if (b.size() == 32) { wantLedger := ?b } }; case null {} } };
        if (kind == "Ledger Index" or kind == "Index") { switch (hexDecode(h)) { case (?b) { if (b.size() == 32) { wantIndex := ?b } }; case null {} } };
      };
      if (wantLedger == null) { return #Err("the SNS wasm canister's latest version has no ledger hash") };
    };
    var changed = false;
    switch (wantLedger) {
      case (?h) {
        if (?h != ledger_wasm_hash or ledger_wasm == null) {
          switch (await* fetchWasm(h)) {
            case (#Ok(w)) {
              if (?h != ledger_wasm_hash) { icrc3_add("sneedpad_wasm_set", [("cid", #Nat(newCid())), ("caller", Icrc3Log.principal(by)), ("kind", #Text("ledger")), ("hash", #Blob(h)), ("source", #Text(if (follow_nns) { "nns" } else { "pinned" }))]) };
              ledger_wasm_hash := ?h; ledger_wasm := ?w; changed := true;
            };
            case (#Err(e)) { return #Err("ledger: " # e) };
          };
        };
      };
      case null {};
    };
    switch (wantIndex) {
      case (?h) {
        if (?h != index_wasm_hash or index_wasm == null) {
          switch (await* fetchWasm(h)) {
            case (#Ok(w)) {
              if (?h != index_wasm_hash) { icrc3_add("sneedpad_wasm_set", [("cid", #Nat(newCid())), ("caller", Icrc3Log.principal(by)), ("kind", #Text("index")), ("hash", #Blob(h)), ("source", #Text(if (follow_nns) { "nns" } else { "pinned" }))]) };
              index_wasm_hash := ?h; index_wasm := ?w; changed := true;
            };
            case (#Err(e)) { return #Err("index: " # e) };
          };
        };
      };
      case null {};
    };
    if (changed) { wasm_last_refresh := Time.now(); logText(newCid(), "info", "wasms refreshed: ledger " # (switch (ledger_wasm_hash) { case (?h) { hex(h) }; case null { "-" } }) # ", index " # (switch (index_wasm_hash) { case (?h) { hex(h) }; case null { "-" } })) };
    #Ok({ ledger_bytes = switch (ledger_wasm) { case (?w) { w.size() }; case null { 0 } }; index_bytes = switch (index_wasm) { case (?w) { w.size() }; case null { 0 } }; changed });
  };
  /// Check the NNS for a newer ledger suite now (anyone, at most every ten
  /// minutes; the daily timer does the same on its own).
  public shared ({ caller }) func refresh_wasms() : async { #Ok : { ledger_bytes : Nat; index_bytes : Nat; changed : Bool }; #Err : Text } {
    if (not isAdmin(caller) and Time.now() - wasm_last_check < WASM_CHECK_MIN_GAP_NS) { return #Err("checked recently; try again in a few minutes") };
    await* refreshWasmsImpl(caller);
  };
  private func wasm_timer_job() : async () { ignore await* refreshWasmsImpl(Principal.fromActor(this)) };
  private func ensure_wasm_timer<system>() {
    if (wasm_timer_started) { return };
    wasm_timer_started := true;
    ignore Timer.recurringTimer<system>(#seconds WASM_CHECK_INTERVAL_SECONDS, wasm_timer_job);
    // first fetch right away when nothing is loaded (fresh install, or the hashes were set before the bytes came)
    if (ledger_wasm == null or index_wasm == null) { ignore Timer.setTimer<system>(#seconds 1, wasm_timer_job) };
  };
  /// Pin the hashes (DAO): the pad stops following the NNS until `follow_nns` is set again.
  public shared ({ caller }) func admin_set_wasm_hashes(ledger : ?Blob, index : ?Blob) : async { #Ok; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admin only") };
    switch (ledger) { case (?h) { if (h.size() != 32) { return #Err("a wasm hash is 32 bytes") } }; case null {} };
    switch (index) { case (?h) { if (h.size() != 32) { return #Err("a wasm hash is 32 bytes") } }; case null {} };
    if (follow_nns) { icrc3_add("sneedpad_config_update", [("cid", #Nat(newCid())), ("caller", Icrc3Log.principal(caller)), ("key", #Text("follow_nns")), ("old_value", #Text("true")), ("value", #Text("false"))]); follow_nns := false };
    let cid = newCid();
    if (ledger != null and ledger != ledger_wasm_hash) { ledger_wasm_hash := ledger; ledger_wasm := null; icrc3_add("sneedpad_wasm_set", [("cid", #Nat(cid)), ("caller", Icrc3Log.principal(caller)), ("kind", #Text("ledger")), ("hash", switch (ledger) { case (?h) { #Blob(h) }; case null { #Text("") } }), ("source", #Text("pinned"))]) };
    if (index != null and index != index_wasm_hash) { index_wasm_hash := index; index_wasm := null; icrc3_add("sneedpad_wasm_set", [("cid", #Nat(cid)), ("caller", Icrc3Log.principal(caller)), ("kind", #Text("index")), ("hash", switch (index) { case (?h) { #Blob(h) }; case null { #Text("") } }), ("source", #Text("pinned"))]) };
    #Ok;
  };
  /// Fetch the bytes for pinned hashes (admin; `refresh_wasms` does the same for everyone).
  public shared ({ caller }) func admin_fetch_wasms() : async { #Ok : { ledger_bytes : Nat; index_bytes : Nat }; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admin only") };
    switch (await* refreshWasmsImpl(caller)) { case (#Ok(r)) { #Ok({ ledger_bytes = r.ledger_bytes; index_bytes = r.index_bytes }) }; case (#Err(e)) { #Err(e) } };
  };

  // ---- admin: configuration ----
  public shared ({ caller }) func admin_set_config(u : T.ConfigUpdate) : async { #Ok : T.Config; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admin only") };
    let cid = newCid();
    let note = func(key : Text, old : Text, new_ : Text) { icrc3_add("sneedpad_config_update", [("cid", #Nat(cid)), ("caller", Icrc3Log.principal(caller)), ("key", #Text(key)), ("old_value", #Text(old)), ("value", #Text(new_))]) };
    switch (u.creation_fee_e8s) { case (?v) { note("creation_fee_e8s", Nat.toText(creation_fee_e8s), Nat.toText(v)); creation_fee_e8s := v }; case null {} };
    switch (u.premium_creation_fee_e8s) { case (?v) { note("premium_creation_fee_e8s", Nat.toText(premium_creation_fee_e8s), Nat.toText(v)); premium_creation_fee_e8s := v }; case null {} };
    switch (u.sneed_dao_control_fee_e8s) { case (?v) { note("sneed_dao_control_fee_e8s", Nat.toText(sneed_dao_control_fee_e8s), Nat.toText(v)); sneed_dao_control_fee_e8s := v }; case null {} };
    switch (u.index_creation_fee_e8s) { case (?v) { note("index_creation_fee_e8s", Nat.toText(index_creation_fee_e8s), Nat.toText(v)); index_creation_fee_e8s := v }; case null {} };
    switch (u.premium_index_creation_fee_e8s) { case (?v) { note("premium_index_creation_fee_e8s", Nat.toText(premium_index_creation_fee_e8s), Nat.toText(v)); premium_index_creation_fee_e8s := v }; case null {} };
    switch (u.follow_nns) { case (?v) { note("follow_nns", debug_show(follow_nns), debug_show(v)); follow_nns := v }; case null {} };
    switch (u.guardians) { case (?v) { note("guardians", debug_show(guardians), debug_show(v)); guardians := v }; case null {} };
    switch (u.ledger_cycles) { case (?v) { if (v < MIN_CANISTER_CYCLES) { return #Err("ledger_cycles: a new canister needs at least 1 T cycles (0.5 T creation fee on a 13-node subnet, about 0.35 T to install the ledger)") }; note("ledger_cycles", Nat.toText(ledger_cycles), Nat.toText(v)); ledger_cycles := v }; case null {} };
    switch (u.index_cycles) { case (?v) { if (v < MIN_CANISTER_CYCLES) { return #Err("index_cycles: a new canister needs at least 1 T cycles (0.5 T creation fee on a 13-node subnet, about 0.35 T to install the index)") }; note("index_cycles", Nat.toText(index_cycles), Nat.toText(v)); index_cycles := v }; case null {} };
    switch (u.fee_destination) { case (?v) { note("fee_destination", Principal.toText(fee_destination.owner), Principal.toText(v.owner)); fee_destination := v }; case null {} };
    switch (u.cycle_reserve) { case (?v) { note("cycle_reserve", Nat.toText(cycle_reserve), Nat.toText(v)); cycle_reserve := v }; case null {} };
    switch (u.paused) { case (?v) { note("paused", debug_show(paused), debug_show(v)); paused := v }; case null {} };
    #Ok(await get_config());
  };
  public shared ({ caller }) func admin_add_admin(p : Principal) : async { #Ok; #Err : Text } { if (not isAdmin(caller)) { return #Err("admin only") }; if (Array.find<Principal>(admins, func(a) { a == p }) == null) { admins := Array.append(admins, [p]) }; #Ok };
  public shared ({ caller }) func admin_remove_admin(p : Principal) : async { #Ok; #Err : Text } { if (not isAdmin(caller)) { return #Err("admin only") }; admins := Array.filter<Principal>(admins, func(a) { a != p }); #Ok };
  /// Test deployments: point at mock canisters.
  public shared ({ caller }) func admin_set_canisters(u : { icp_ledger : ?Principal; cmc : ?Principal; sns_wasm : ?Principal; governance : ?Principal; root : ?Principal; blackhole : ?Principal; sneed_premium : ??Principal; sneedapp : ??Principal }) : async { #Ok; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admin only") };
    switch (u.sneedapp) { case (?p) { sneedapp_id := p }; case null {} };
    switch (u.sneed_premium) { case (?p) { sneed_premium_id := p; premium_cache := PremiumClient.emptyCache() }; case null {} };
    switch (u.icp_ledger) { case (?p) { icp_ledger_id := p }; case null {} };
    switch (u.cmc) { case (?p) { cmc_id := p }; case null {} };
    switch (u.sns_wasm) { case (?p) { sns_wasm_id := p }; case null {} };
    switch (u.governance) { case (?p) { sneed_governance := p }; case null {} };
    switch (u.root) { case (?p) { sneed_root := p }; case null {} };
    switch (u.blackhole) { case (?p) { blackhole := p }; case null {} };
    #Ok;
  };
  public shared ({ caller }) func admin_set_registration_neuron(neuron : ?Blob) : async { #Ok; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admin only") };
    switch (Icrc3Sns.setNeuron(icrc3_sns, neuron)) { case (#Err(e)) { return #Err(e) }; case (#Ok) {} };
    Icrc3Sns.setNeuron(ledger_registrations, neuron);
  };
  /// Hand a canister the pad still controls (left behind by a failed launch) to someone who can
  /// finish or reuse it (admin). The pad only ever controls canisters it created.
  public shared ({ caller }) func admin_set_canister_controllers(canister_id : Principal, controllers : [Principal]) : async { #Ok; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admin only") };
    if (controllers.size() == 0) { return #Err("give at least one controller") };
    let cid = newCid();
    try {
      await ic.update_settings({ canister_id; settings = { controllers = ?controllers; compute_allocation = null; memory_allocation = null; freezing_threshold = null }; sender_canister_version = null });
    } catch (e) { return #Err("update_settings failed (is the pad a controller of " # Principal.toText(canister_id) # "?): " # Error.message(e)) };
    icrc3_add("sneedpad_rescue", [("cid", #Nat(cid)), ("caller", Icrc3Log.principal(caller)), ("canister", Icrc3Log.principal(canister_id)), ("controllers", #Array(Array.map<Principal, T3.Value>(controllers, Icrc3Log.principal)))]);
    logText(cid, "info", "rescue: controllers of " # Principal.toText(canister_id) # " set by " # Principal.toText(caller));
    #Ok;
  };
  /// Return ICP that a failed step left in this canister (admin): the operator decides where.
  public shared ({ caller }) func admin_withdraw_icp(to : T.Account, amount : Nat) : async { #Ok : Nat; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admin only") };
    switch (await icp_ledger().icrc1_transfer({ from_subaccount = null; to = to; amount = amount; fee = ?ICP_FEE; memo = null; created_at_time = null })) {
      case (#Ok(b)) { #Ok(b) };
      case (#Err(e)) { #Err(debug_show(e)) };
    };
  };

  // ---- ICRC-3 endpoints ----
  public query func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult { Icrc3Log.getBlocks(icrc3, args) };
  public query func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult { Icrc3Log.getArchives(icrc3, args) };
  public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate { Icrc3Log.tipCertificate(icrc3) };
  public query func icrc3_supported_block_types() : async [T3.BlockType] { Icrc3Log.supportedBlockTypes(icrc3_catalogue) };
  public query func icrc10_supported_standards() : async [T3.SupportedStandard] { Icrc3Log.supportedStandards() };
  public query func icrc3_log_status() : async T3.LogStatus { Icrc3Log.status(icrc3, icrc3_rt) };
  public query func icrc3_registration_status() : async Icrc3Sns.Status { Icrc3Sns.status(icrc3_sns, icrc3_sns_env()) };

  system func postupgrade() { ensure_icrc3_timer<system>(); ensure_wasm_timer<system>() };
  ensure_icrc3_timer<system>();
  ensure_wasm_timer<system>();

  // Checks of the ingress guard below, with the limits of validate and validateControl
  transient let MAX_NAME = 64;
  transient let MAX_SYMBOL = 12;
  transient let MAX_LOGO = 200_000;
  transient let MAX_ALLOCATIONS = 1_000;
  transient let ALLOCATION_BYTES = 128; // an account and an amount
  private func controlOk(c : T.ControlChoice) : Bool = switch (c) {
    case (#keep_with(ps)) ps.size() <= 10;
    case (#guardian(g)) g.policy.guardians.size() <= 20;
    case _ true;
  };
  private func tokenConfigOk(arg : Blob, c : T.TokenConfig) : Bool =
    arg.size() <= IngressGuard.textArg(MAX_NAME + MAX_SYMBOL + MAX_LOGO) + MAX_ALLOCATIONS * ALLOCATION_BYTES
    and IngressGuard.text(c.name, MAX_NAME) and IngressGuard.text(c.symbol, MAX_SYMBOL) and IngressGuard.optText(c.logo, MAX_LOGO)
    and c.allocations.size() <= MAX_ALLOCATIONS and controlOk(c.control);

  // Ingress guard (src/IngressGuard.mo): queries are never accepted as update calls, which
  // would go through consensus at our cost, and arguments are capped in size.
  system func inspect({ arg : Blob; msg : {
    #admin_add_admin : Any;
    #admin_fetch_wasms : Any;
    #admin_remove_admin : Any;
    #admin_set_canister_controllers : Any;
    #admin_set_canisters : Any;
    #admin_set_config : Any;
    #admin_set_registration_neuron : Any;
    #admin_set_wasm_hashes : Any;
    #admin_withdraw_icp : Any;
    #create_index : () -> T.IndexConfig;
    #create_token : () -> T.TokenConfig;
    #get_admins : Any;
    #get_config : Any;
    #get_cycle_balance : Any;
    #get_index_launches_by_creator : Any;
    #get_index_quote : () -> T.IndexConfig;
    #get_indexes_of_ledger : Any;
    #get_launch : Any;
    #get_launch_by_ledger : Any;
    #get_launches_by_creator : Any;
    #get_ledger_registration_status : Any;
    #get_quote : () -> T.TokenConfig;
    #get_text_log : Any;
    #icrc10_supported_standards : Any;
    #icrc3_get_archives : Any;
    #icrc3_get_blocks : Any;
    #icrc3_get_tip_certificate : Any;
    #icrc3_log_status : Any;
    #icrc3_registration_status : Any;
    #icrc3_supported_block_types : Any;
    #list_index_launches : Any;
    #list_launches : Any;
    #refresh_wasms : Any;
  } }) : Bool {
    switch (msg) {
      case (
        #get_admins _
        or #get_config _
        or #get_cycle_balance _
        or #get_index_launches_by_creator _
        or #get_indexes_of_ledger _
        or #get_launch _
        or #get_launch_by_ledger _
        or #get_launches_by_creator _
        or #get_ledger_registration_status _
        or #get_text_log _
        or #icrc10_supported_standards _
        or #icrc3_get_archives _
        or #icrc3_get_blocks _
        or #icrc3_get_tip_certificate _
        or #icrc3_log_status _
        or #icrc3_registration_status _
        or #icrc3_supported_block_types _
        or #list_index_launches _
        or #list_launches _
      ) false;
      // the limits of validate / validateControl
      case (#create_token f) tokenConfigOk(arg, f());
      case (#get_quote f) tokenConfigOk(arg, f());
      case (#create_index f) arg.size() <= IngressGuard.SMALL_ARG and controlOk(f().control);
      case (#get_index_quote f) arg.size() <= IngressGuard.SMALL_ARG and controlOk(f().control);
      case _ arg.size() <= IngressGuard.SMALL_ARG;
    };
  };

};
