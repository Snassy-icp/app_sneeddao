/// Test double for the NNS governance canister, as far as the ICP staking bot
/// uses it: `claim_or_refresh_neuron_from_account`, `manage_neuron` (claim or
/// refresh, configure, disburse, spawn, stake/merge/disburse maturity, follow,
/// vote, proposals, split, merge, refresh voting power), `list_neurons`,
/// `get_full_neuron` and `get_neuron_info`.
///
/// Neurons are backed by the mock ICP ledger at the real ledger id: a claim reads
/// the balance of the neuron subaccount (sha256(0x0c "neuron-stake" controller
/// memo)), a disbursement transfers it out again and maturity disbursements and
/// spawns mint fresh ICP. NNS rules modelled: 1 ICP minimum stake, dissolve
/// delays clamped to the maximum (2 years), "additional delay is 0" and
/// "smaller than current" refusals, disburse only when dissolved, spawn needs
/// 1 ICP of maturity and takes 7 days, merge maturity is no longer supported,
/// voting needs 6 months of dissolve delay, proposals need 10 ICP of stake,
/// hotkeys may only vote/follow/refresh, controllers may do everything.
///
/// Test helpers create neurons for any controller, set maturity, stake and
/// age, add proposals, switch the reply mode (refuse / empty / unexpected /
/// trap) and expose a log of every manage_neuron command received.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Debug "mo:base/Debug";
import Int "mo:base/Int";
import Int32 "mo:base/Int32";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Sha256 "mo:sha2/Sha256";

persistent actor class MockNnsGovernance() = this {

  // ---- NNS governance types (the subset the bot declares) ----
  public type NeuronId = { id : Nat64 };
  public type ProposalId = { id : Nat64 };
  public type Account = { owner : Principal; subaccount : ?Blob };
  public type DissolveState = { #DissolveDelaySeconds : Nat64; #WhenDissolvedTimestampSeconds : Nat64 };
  public type Followees = { followees : [NeuronId] };
  public type GovernanceError = { error_message : Text; error_type : Int32 };
  public type BallotInfo = { vote : Int32; proposal_id : ?ProposalId };
  public type KnownNeuronData = { name : Text; description : ?Text };
  public type NeuronStakeTransfer = { to_subaccount : Blob; neuron_stake_e8s : Nat64; from : ?Principal; memo : Nat64; from_subaccount : Blob; transfer_timestamp : Nat64; block_height : Nat64 };
  public type Neuron = {
    id : ?NeuronId;
    staked_maturity_e8s_equivalent : ?Nat64;
    controller : ?Principal;
    recent_ballots : [BallotInfo];
    kyc_verified : Bool;
    neuron_type : ?Int32;
    not_for_profit : Bool;
    maturity_e8s_equivalent : Nat64;
    cached_neuron_stake_e8s : Nat64;
    created_timestamp_seconds : Nat64;
    auto_stake_maturity : ?Bool;
    aging_since_timestamp_seconds : Nat64;
    hot_keys : [Principal];
    account : Blob;
    joined_community_fund_timestamp_seconds : ?Nat64;
    dissolve_state : ?DissolveState;
    followees : [(Int32, Followees)];
    neuron_fees_e8s : Nat64;
    visibility : ?Int32;
    transfer : ?NeuronStakeTransfer;
    known_neuron_data : ?KnownNeuronData;
    spawn_at_timestamp_seconds : ?Nat64;
    voting_power_refreshed_timestamp_seconds : ?Nat64;
    deciding_voting_power : ?Nat64;
    potential_voting_power : ?Nat64;
  };
  public type NeuronInfo = {
    dissolve_delay_seconds : Nat64;
    recent_ballots : [BallotInfo];
    neuron_type : ?Int32;
    created_timestamp_seconds : Nat64;
    state : Int32;
    stake_e8s : Nat64;
    joined_community_fund_timestamp_seconds : ?Nat64;
    retrieved_at_timestamp_seconds : Nat64;
    visibility : ?Int32;
    known_neuron_data : ?KnownNeuronData;
    age_seconds : Nat64;
    voting_power : Nat64;
    voting_power_refreshed_timestamp_seconds : ?Nat64;
    deciding_voting_power : ?Nat64;
    potential_voting_power : ?Nat64;
  };
  public type Operation = {
    #RemoveHotKey : { hot_key_to_remove : ?Principal };
    #AddHotKey : { new_hot_key : ?Principal };
    #ChangeAutoStakeMaturity : { requested_setting_for_auto_stake_maturity : Bool };
    #StopDissolving : {};
    #StartDissolving : {};
    #IncreaseDissolveDelay : { additional_dissolve_delay_seconds : Nat32 };
    #SetVisibility : { visibility : ?Int32 };
    #JoinCommunityFund : {};
    #LeaveCommunityFund : {};
    #SetDissolveTimestamp : { dissolve_timestamp_seconds : Nat64 };
  };
  public type ClaimOrRefreshBy = { #NeuronIdOrSubaccount : {}; #MemoAndController : { controller : ?Principal; memo : Nat64 }; #Memo : Nat64 };
  public type Proposal = { url : Text; title : ?Text; action : ?{ #Motion : { motion_text : Text } }; summary : Text };
  public type Command = {
    #Spawn : { percentage_to_spawn : ?Nat32; new_controller : ?Principal; nonce : ?Nat64 };
    #Split : { amount_e8s : Nat64 };
    #Follow : { topic : Int32; followees : [NeuronId] };
    #ClaimOrRefresh : { by : ?ClaimOrRefreshBy };
    #Configure : { operation : ?Operation };
    #RegisterVote : { vote : Int32; proposal : ?ProposalId };
    #Merge : { source_neuron_id : ?NeuronId };
    #DisburseToNeuron : { dissolve_delay_seconds : Nat64; kyc_verified : Bool; amount_e8s : Nat64; new_controller : ?Principal; nonce : Nat64 };
    #MakeProposal : Proposal;
    #StakeMaturity : { percentage_to_stake : ?Nat32 };
    #MergeMaturity : { percentage_to_merge : Nat32 };
    #Disburse : { to_account : ?Blob; amount : ?{ e8s : Nat64 } };
    #RefreshVotingPower : {};
    #DisburseMaturity : { percentage_to_disburse : Nat32; to_account : ?Account };
  };
  public type NeuronIdOrSubaccount = { #Subaccount : Blob; #NeuronId : NeuronId };
  public type ManageNeuronRequest = { id : ?NeuronId; command : ?Command; neuron_id_or_subaccount : ?NeuronIdOrSubaccount };
  public type CommandResponse = {
    #Error : GovernanceError;
    #Spawn : { created_neuron_id : ?NeuronId };
    #Split : { created_neuron_id : ?NeuronId };
    #Follow : {};
    #ClaimOrRefresh : { refreshed_neuron_id : ?NeuronId };
    #Configure : {};
    #RegisterVote : {};
    #Merge : { target_neuron : ?Neuron; source_neuron : ?Neuron; target_neuron_info : ?NeuronInfo; source_neuron_info : ?NeuronInfo };
    #DisburseToNeuron : { created_neuron_id : ?NeuronId };
    #MakeProposal : { message : ?Text; proposal_id : ?ProposalId };
    #StakeMaturity : { maturity_e8s : Nat64; staked_maturity_e8s : Nat64 };
    #MergeMaturity : { merged_maturity_e8s : Nat64; new_stake_e8s : Nat64 };
    #Disburse : { transfer_block_height : Nat64 };
    #RefreshVotingPower : {};
    #DisburseMaturity : { amount_disbursed_e8s : ?Nat64 };
  };
  public type ManageNeuronResponse = { command : ?CommandResponse };
  public type ListNeurons = { neuron_ids : [Nat64]; include_neurons_readable_by_caller : Bool; include_empty_neurons_readable_by_caller : ?Bool; include_public_neurons_in_full_neurons : ?Bool };
  public type ListNeuronsResponse = { neuron_infos : [(Nat64, NeuronInfo)]; full_neurons : [Neuron] };
  public type ClaimOrRefreshNeuronFromAccount = { controller : ?Principal; memo : Nat64 };
  public type ClaimOrRefreshNeuronFromAccountResponse = { result : ?{ #Error : GovernanceError; #NeuronId : NeuronId } };

  // ---- ledger ----
  type TransferArg = { to : Account; fee : ?Nat; memo : ?Blob; from_subaccount : ?Blob; created_at_time : ?Nat64; amount : Nat };
  type TransferError = {
    #GenericError : { message : Text; error_code : Nat }; #TemporarilyUnavailable; #BadBurn : { min_burn_amount : Nat }; #Duplicate : { duplicate_of : Nat };
    #BadFee : { expected_fee : Nat }; #CreatedInFuture : { ledger_time : Nat64 }; #TooOld; #InsufficientFunds : { balance : Nat };
  };
  type Ledger = actor {
    icrc1_balance_of : shared query (Account) -> async Nat;
    icrc1_transfer : shared (TransferArg) -> async { #Ok : Nat; #Err : TransferError };
    mint : shared (Account, Nat) -> async Nat;
  };
  transient let ledger : Ledger = actor ("ryjl3-tyaaa-aaaaa-aaaba-cai");

  // ---- constants (NNS) ----
  transient let E8S : Nat64 = 100_000_000;
  transient let MIN_STAKE : Nat64 = 100_000_000; // 1 ICP
  transient let ICP_FEE : Nat64 = 10_000;
  transient let MIN_DISSOLVE_FOR_VOTING : Nat64 = 15_778_800; // 6 months
  transient let PROPOSAL_MIN_STAKE : Nat64 = 10 * 100_000_000; // reject cost
  transient let SPAWN_DELAY : Nat64 = 7 * 24 * 3600;
  transient let MAX_HOTKEYS = 10;
  transient let MAX_FOLLOWEES = 15;

  // error types of the real governance canister
  transient let E_NOT_AUTHORIZED : Int32 = 3;
  transient let E_NOT_FOUND : Int32 = 4;
  transient let E_INVALID_COMMAND : Int32 = 5;
  transient let E_REQUIRES_NOT_DISSOLVING : Int32 = 6;
  transient let E_REQUIRES_DISSOLVING : Int32 = 7;
  transient let E_REQUIRES_DISSOLVED : Int32 = 8;
  transient let E_RESOURCE_EXHAUSTED : Int32 = 10;
  transient let E_PRECONDITION_FAILED : Int32 = 11;
  transient let E_EXTERNAL : Int32 = 12;
  transient let E_INSUFFICIENT_FUNDS : Int32 = 14;
  transient let E_ALREADY_VOTED : Int32 = 19;

  // ---- state ----
  public type Mode = { #normal; #trap; #refuse : Text; #empty_reply; #unexpected_reply };
  public type Disbursement = { neuron : Nat64; amount_e8s : Nat64; to_account_id : ?Blob; to : Account; block : Nat64 };
  public type MaturityDisbursement = { neuron : Nat64; amount_e8s : Nat64; to : Account };
  public type ProposalRecord = { id : Nat64; proposer : ?Nat64; title : ?Text; summary : Text; url : Text; motion : ?Text };

  var neurons : [Neuron] = [];
  var next_neuron_id : Nat64 = 1000;
  var next_proposal_id : Nat64 = 500;
  var proposals : [ProposalRecord] = [];
  var disbursements : [Disbursement] = [];
  var maturity_disbursements : [MaturityDisbursement] = [];
  var calls : [Text] = [];
  var mode : Mode = #normal;
  var max_dissolve_delay : Nat64 = 63_072_000; // 2 years since the 2026 tokenomics change

  // ---- helpers ----
  func nowSeconds() : Nat64 { Nat64.fromNat(Int.abs(Time.now() / 1_000_000_000)) };
  func err(t : Int32, m : Text) : ManageNeuronResponse { { command = ?#Error({ error_message = m; error_type = t }) } };
  func self() : Principal { Principal.fromActor(this) };

  func nat64ToBytes(n : Nat64) : [Nat8] {
    Array.tabulate<Nat8>(8, func(i) { Nat8.fromNat(Nat64.toNat((n >> Nat64.fromNat(8 * (7 - i))) & 0xFF)) });
  };

  /// sha256(0x0c "neuron-stake" controller memo), as the NNS derives neuron subaccounts.
  func neuronSubaccount(controller : Principal, memo : Nat64) : Blob {
    let b = Buffer.Buffer<Nat8>(64);
    b.add(0x0c);
    for (x in Blob.toArray(Text.encodeUtf8("neuron-stake")).vals()) { b.add(x) };
    for (x in Blob.toArray(Principal.toBlob(controller)).vals()) { b.add(x) };
    for (x in nat64ToBytes(memo).vals()) { b.add(x) };
    Sha256.fromArray(#sha256, Buffer.toArray(b));
  };

  func find(id : Nat64) : ?Neuron {
    Array.find<Neuron>(neurons, func(n) { n.id == ?{ id } });
  };
  func findByAccount(account : Blob) : ?Neuron {
    Array.find<Neuron>(neurons, func(n) { n.account == account });
  };
  func put(n : Neuron) {
    var found = false;
    neurons := Array.map<Neuron, Neuron>(neurons, func(x) { if (x.id == n.id) { found := true; n } else { x } });
    if (not found) { neurons := Array.append(neurons, [n]) };
  };
  func idOf(n : Neuron) : Nat64 { switch (n.id) { case (?i) i.id; case null 0 } };

  func newNeuron(id : Nat64, controller : Principal, account : Blob, stake : Nat64) : Neuron {
    let now = nowSeconds();
    {
      id = ?{ id };
      staked_maturity_e8s_equivalent = null;
      controller = ?controller;
      recent_ballots = [];
      kyc_verified = true;
      neuron_type = null;
      not_for_profit = false;
      maturity_e8s_equivalent = 0;
      cached_neuron_stake_e8s = stake;
      created_timestamp_seconds = now;
      auto_stake_maturity = null;
      aging_since_timestamp_seconds = now;
      hot_keys = [];
      account;
      joined_community_fund_timestamp_seconds = null;
      dissolve_state = ?#DissolveDelaySeconds(0);
      followees = [];
      neuron_fees_e8s = 0;
      visibility = ?1;
      transfer = null;
      known_neuron_data = null;
      spawn_at_timestamp_seconds = null;
      voting_power_refreshed_timestamp_seconds = ?now;
      deciding_voting_power = null;
      potential_voting_power = null;
    };
  };

  /// A spawned neuron becomes a real one with stake once its spawn time has passed.
  func settled(n : Neuron) : Neuron {
    switch (n.spawn_at_timestamp_seconds) {
      case (?t) {
        if (t <= nowSeconds()) {
          { n with cached_neuron_stake_e8s = n.cached_neuron_stake_e8s + n.maturity_e8s_equivalent; maturity_e8s_equivalent = 0 : Nat64; spawn_at_timestamp_seconds = null };
        } else { n };
      };
      case null { n };
    };
  };
  func settle(id : Nat64) : ?Neuron {
    switch (find(id)) { case null null; case (?n) { let s = settled(n); if (s != n) { put(s) }; ?s } };
  };

  func dissolveDelay(n : Neuron) : Nat64 {
    switch (n.dissolve_state) {
      case (?#DissolveDelaySeconds(d)) d;
      case (?#WhenDissolvedTimestampSeconds(t)) { let now = nowSeconds(); if (t > now) { t - now } else { 0 } };
      case null 0;
    };
  };
  func isDissolving(n : Neuron) : Bool {
    switch (n.dissolve_state) { case (?#WhenDissolvedTimestampSeconds(t)) { t > nowSeconds() }; case _ false };
  };
  func state(n : Neuron) : Int32 {
    if (n.spawn_at_timestamp_seconds != null) { return 4 };
    switch (n.dissolve_state) {
      case (?#DissolveDelaySeconds(d)) { if (d > 0) 1 else 3 };
      case (?#WhenDissolvedTimestampSeconds(t)) { if (t > nowSeconds()) 2 else 3 };
      case null 3;
    };
  };
  func isController(n : Neuron, p : Principal) : Bool { n.controller == ?p };
  func isHotkey(n : Neuron, p : Principal) : Bool { Array.find<Principal>(n.hot_keys, func(h) { h == p }) != null };
  func readable(n : Neuron, p : Principal) : Bool { isController(n, p) or isHotkey(n, p) };
  func isEmpty(n : Neuron) : Bool {
    n.cached_neuron_stake_e8s == 0 and n.maturity_e8s_equivalent == 0 and (switch (n.staked_maturity_e8s_equivalent) { case (?s) s == 0; case null true });
  };
  func stakedMaturity(n : Neuron) : Nat64 { switch (n.staked_maturity_e8s_equivalent) { case (?s) s; case null 0 } };

  func info(n : Neuron) : NeuronInfo {
    let now = nowSeconds();
    let age = if (isDissolving(n) or now < n.aging_since_timestamp_seconds) { 0 : Nat64 } else { now - n.aging_since_timestamp_seconds };
    {
      dissolve_delay_seconds = dissolveDelay(n);
      recent_ballots = n.recent_ballots;
      neuron_type = n.neuron_type;
      created_timestamp_seconds = n.created_timestamp_seconds;
      state = state(n);
      stake_e8s = n.cached_neuron_stake_e8s + stakedMaturity(n);
      joined_community_fund_timestamp_seconds = n.joined_community_fund_timestamp_seconds;
      retrieved_at_timestamp_seconds = now;
      visibility = n.visibility;
      known_neuron_data = n.known_neuron_data;
      age_seconds = age;
      voting_power = if (dissolveDelay(n) >= MIN_DISSOLVE_FOR_VOTING) { n.cached_neuron_stake_e8s + stakedMaturity(n) } else { 0 };
      voting_power_refreshed_timestamp_seconds = n.voting_power_refreshed_timestamp_seconds;
      deciding_voting_power = null;
      potential_voting_power = null;
    };
  };

  func log(entry : Text) { calls := Array.append(calls, [entry]) };

  /// Apply a new dissolve delay, clamped to the maximum, keeping the dissolving/locked form.
  func withDelay(n : Neuron, delay : Nat64) : Neuron {
    let d = if (delay > max_dissolve_delay) { max_dissolve_delay } else { delay };
    if (isDissolving(n)) { { n with dissolve_state = ?#WhenDissolvedTimestampSeconds(nowSeconds() + d) } }
    else { { n with dissolve_state = ?#DissolveDelaySeconds(d) } };
  };

  func increaseDissolveDelay(n : Neuron, additional : Nat64) : { #Ok : Neuron; #Err : (Int32, Text) } {
    if (additional == 0) { return #Err(E_INVALID_COMMAND, "Additional delay is 0.") };
    #Ok(withDelay(n, dissolveDelay(n) + additional));
  };

  func transfer(from : ?Blob, to : Account, amount : Nat64) : async { #Ok : Nat; #Err : Text } {
    let r = await ledger.icrc1_transfer({ to; fee = ?Nat64.toNat(ICP_FEE); memo = null; from_subaccount = from; created_at_time = null; amount = Nat64.toNat(amount) });
    switch (r) {
      case (#Ok(b)) #Ok(b);
      case (#Err(#InsufficientFunds({ balance }))) #Err("ledger: insufficient funds, balance " # Nat.toText(balance));
      case (#Err(_)) #Err("ledger: transfer failed");
    };
  };

  // ---- claim or refresh from a deposit ----
  public shared ({ caller }) func claim_or_refresh_neuron_from_account(args : ClaimOrRefreshNeuronFromAccount) : async ClaimOrRefreshNeuronFromAccountResponse {
    let controller = switch (args.controller) { case (?c) c; case null caller };
    log("claim_or_refresh_neuron_from_account(controller=" # Principal.toText(controller) # ",memo=" # Nat64.toText(args.memo) # ")");
    switch (mode) {
      case (#trap) { Debug.trap("governance is down") };
      case (#refuse(m)) { return { result = ?#Error({ error_message = m; error_type = E_PRECONDITION_FAILED }) } };
      case (#empty_reply) { return { result = null } };
      case _ {};
    };
    let account = neuronSubaccount(controller, args.memo);
    let balance = Nat64.fromNat(await ledger.icrc1_balance_of({ owner = self(); subaccount = ?account }));
    switch (findByAccount(account)) {
      case (?n) {
        put({ n with cached_neuron_stake_e8s = balance });
        { result = ?#NeuronId({ id = idOf(n) }) };
      };
      case null {
        if (balance < MIN_STAKE) {
          return { result = ?#Error({ error_message = "Account does not have enough funds to stake a neuron. Please transfer at least 1 ICP to the neuron account."; error_type = E_INSUFFICIENT_FUNDS }) };
        };
        let id = next_neuron_id;
        next_neuron_id += 1;
        put(newNeuron(id, controller, account, balance));
        { result = ?#NeuronId({ id }) };
      };
    };
  };

  // ---- manage_neuron ----
  public shared ({ caller }) func manage_neuron(req : ManageNeuronRequest) : async ManageNeuronResponse {
    switch (mode) {
      case (#trap) { Debug.trap("governance is down") };
      case (#refuse(m)) { return err(E_PRECONDITION_FAILED, m) };
      case (#empty_reply) { return { command = null } };
      case (#unexpected_reply) { return { command = ?#Follow({}) } };
      case (#normal) {};
    };
    let target : ?Neuron = switch (req.id, req.neuron_id_or_subaccount) {
      case (?nid, _) { settle(nid.id) };
      case (null, ?#NeuronId(nid)) { settle(nid.id) };
      case (null, ?#Subaccount(sub)) { switch (findByAccount(sub)) { case (?n) settle(idOf(n)); case null null } };
      case (null, null) { null };
    };
    let n = switch (target) {
      case (?n) n;
      case null { log("manage_neuron(unknown neuron)"); return err(E_NOT_FOUND, "Neuron not found") };
    };
    let nid = idOf(n);
    let tag = "neuron " # Nat64.toText(nid) # " by " # Principal.toText(caller);
    let command = switch (req.command) { case (?c) c; case null { log("manage_neuron(" # tag # "): no command"); return err(E_INVALID_COMMAND, "No command") } };
    let controllerOnly = func() : ?ManageNeuronResponse {
      // like the NNS, nothing but reading, following and voting while a spawn is pending
      if (n.spawn_at_timestamp_seconds != null) { return ?err(E_PRECONDITION_FAILED, "Neuron " # Nat64.toText(nid) # " is spawning.") };
      if (not isController(n, caller)) { ?err(E_NOT_AUTHORIZED, "Caller '" # Principal.toText(caller) # "' is not authorized to control neuron " # Nat64.toText(nid) # ".") } else null;
    };
    let controllerOrHotkey = func() : ?ManageNeuronResponse {
      if (not readable(n, caller)) { ?err(E_NOT_AUTHORIZED, "Caller '" # Principal.toText(caller) # "' is neither controller nor hotkey of neuron " # Nat64.toText(nid) # ".") } else null;
    };

    switch (command) {
      case (#ClaimOrRefresh(_)) {
        log("ClaimOrRefresh(" # tag # ")");
        // a spawning neuron's ICP becomes stake when the spawn matures, not on refresh
        if (n.spawn_at_timestamp_seconds != null) { return { command = ?#ClaimOrRefresh({ refreshed_neuron_id = ?{ id = nid } }) } };
        let balance = Nat64.fromNat(await ledger.icrc1_balance_of({ owner = self(); subaccount = ?n.account }));
        put({ n with cached_neuron_stake_e8s = balance });
        { command = ?#ClaimOrRefresh({ refreshed_neuron_id = ?{ id = nid } }) };
      };
      case (#Configure({ operation })) {
        let op = switch (operation) { case (?o) o; case null { return err(E_INVALID_COMMAND, "Configure must have an operation.") } };
        switch (controllerOnly()) { case (?e) { log("Configure(" # tag # ") refused"); return e }; case null {} };
        switch (op) {
          case (#SetDissolveTimestamp({ dissolve_timestamp_seconds })) {
            log("Configure.SetDissolveTimestamp(" # tag # ",ts=" # Nat64.toText(dissolve_timestamp_seconds) # ")");
            let now = nowSeconds();
            if (dissolve_timestamp_seconds <= now) { return err(E_INVALID_COMMAND, "The dissolve delay must be set to a future time.") };
            let desired = dissolve_timestamp_seconds - now;
            let current = dissolveDelay(n);
            if (desired < current) { return err(E_INVALID_COMMAND, "Can't set a dissolve delay that is smaller than the current dissolve delay.") };
            switch (increaseDissolveDelay(n, desired - current)) { case (#Ok(u)) { put(u) }; case (#Err(t, m)) { return err(t, m) } };
          };
          case (#IncreaseDissolveDelay({ additional_dissolve_delay_seconds })) {
            log("Configure.IncreaseDissolveDelay(" # tag # ",add=" # Nat32.toText(additional_dissolve_delay_seconds) # ")");
            switch (increaseDissolveDelay(n, Nat64.fromNat(Nat32.toNat(additional_dissolve_delay_seconds)))) { case (#Ok(u)) { put(u) }; case (#Err(t, m)) { return err(t, m) } };
          };
          case (#StartDissolving(_)) {
            log("Configure.StartDissolving(" # tag # ")");
            switch (n.dissolve_state) {
              case (?#DissolveDelaySeconds(d)) {
                if (d == 0) { return err(E_REQUIRES_NOT_DISSOLVING, "Neuron is already dissolved.") };
                put({ n with dissolve_state = ?#WhenDissolvedTimestampSeconds(nowSeconds() + d); aging_since_timestamp_seconds = 0xFFFF_FFFF_FFFF_FFFF : Nat64 });
              };
              case _ { return err(E_REQUIRES_NOT_DISSOLVING, "Neuron is already dissolving.") };
            };
          };
          case (#StopDissolving(_)) {
            log("Configure.StopDissolving(" # tag # ")");
            if (not isDissolving(n)) { return err(E_REQUIRES_DISSOLVING, "Neuron is not dissolving.") };
            put({ n with dissolve_state = ?#DissolveDelaySeconds(dissolveDelay(n)); aging_since_timestamp_seconds = nowSeconds() });
          };
          case (#AddHotKey({ new_hot_key })) {
            let hk = switch (new_hot_key) { case (?h) h; case null { return err(E_INVALID_COMMAND, "AddHotKey must have a hot key.") } };
            log("Configure.AddHotKey(" # tag # "," # Principal.toText(hk) # ")");
            if (isHotkey(n, hk)) { return err(E_PRECONDITION_FAILED, "The hot key already exists.") };
            if (n.hot_keys.size() >= MAX_HOTKEYS) { return err(E_RESOURCE_EXHAUSTED, "Reached the maximum number of hot keys.") };
            put({ n with hot_keys = Array.append(n.hot_keys, [hk]) });
          };
          case (#RemoveHotKey({ hot_key_to_remove })) {
            let hk = switch (hot_key_to_remove) { case (?h) h; case null { return err(E_INVALID_COMMAND, "RemoveHotKey must have a hot key.") } };
            log("Configure.RemoveHotKey(" # tag # "," # Principal.toText(hk) # ")");
            if (not isHotkey(n, hk)) { return err(E_NOT_FOUND, "The hot key could not be found.") };
            put({ n with hot_keys = Array.filter<Principal>(n.hot_keys, func(h) { h != hk }) });
          };
          case (#ChangeAutoStakeMaturity({ requested_setting_for_auto_stake_maturity })) {
            log("Configure.ChangeAutoStakeMaturity(" # tag # "," # debug_show (requested_setting_for_auto_stake_maturity) # ")");
            put({ n with auto_stake_maturity = ?requested_setting_for_auto_stake_maturity });
          };
          case (#SetVisibility({ visibility })) {
            log("Configure.SetVisibility(" # tag # "," # debug_show (visibility) # ")");
            switch (visibility) {
              case (?v) { if (v != 1 and v != 2) { return err(E_INVALID_COMMAND, "Visibility must be 1 (private) or 2 (public).") }; put({ n with visibility = ?v }) };
              case null { return err(E_INVALID_COMMAND, "SetVisibility must have a visibility.") };
            };
          };
          case (#JoinCommunityFund(_)) { log("Configure.JoinCommunityFund(" # tag # ")"); put({ n with joined_community_fund_timestamp_seconds = ?nowSeconds() }) };
          case (#LeaveCommunityFund(_)) { log("Configure.LeaveCommunityFund(" # tag # ")"); put({ n with joined_community_fund_timestamp_seconds = null }) };
        };
        { command = ?#Configure({}) };
      };
      case (#Disburse({ to_account; amount })) {
        log("Disburse(" # tag # ",amount=" # debug_show (amount) # ",to=" # debug_show (to_account) # ")");
        switch (controllerOnly()) { case (?e) return e; case null {} };
        if (state(n) != 3) { return err(E_REQUIRES_DISSOLVED, "Neuron " # Nat64.toText(nid) # " is not dissolved; dissolve delay " # Nat64.toText(dissolveDelay(n)) # " seconds remain.") };
        let stake = n.cached_neuron_stake_e8s;
        let amt = switch (amount) { case (?a) a.e8s; case null stake };
        if (amt > stake) { return err(E_INSUFFICIENT_FUNDS, "Trying to disburse more than the stake of neuron " # Nat64.toText(nid) # ".") };
        if (amt <= ICP_FEE) { return err(E_INVALID_COMMAND, "Amount to disburse is smaller than the transfer fee.") };
        // to an account identifier: the mock cannot invert the hash, so it pays a sink
        // account (governance, subaccount = the 32-byte identifier) that tests can read
        let to : Account = switch (to_account) {
          case (?aid) { { owner = self(); subaccount = ?aid } };
          case null { { owner = switch (n.controller) { case (?c) c; case null caller }; subaccount = null } };
        };
        switch (await transfer(?n.account, to, amt - ICP_FEE)) {
          case (#Err(m)) { err(E_EXTERNAL, m) };
          case (#Ok(block)) {
            let fresh = switch (find(nid)) { case (?f) f; case null n };
            put({ fresh with cached_neuron_stake_e8s = fresh.cached_neuron_stake_e8s - amt });
            disbursements := Array.append(disbursements, [{ neuron = nid; amount_e8s = amt; to_account_id = to_account; to; block = Nat64.fromNat(block) }]);
            { command = ?#Disburse({ transfer_block_height = Nat64.fromNat(block) }) };
          };
        };
      };
      case (#Spawn({ percentage_to_spawn; new_controller; nonce })) {
        log("Spawn(" # tag # ",pct=" # debug_show (percentage_to_spawn) # ",controller=" # debug_show (new_controller) # ")");
        switch (controllerOnly()) { case (?e) return e; case null {} };
        let pct = switch (percentage_to_spawn) { case (?p) p; case null (100 : Nat32) };
        if (pct == 0 or pct > 100) { return err(E_INVALID_COMMAND, "The percentage of maturity to spawn must be a value between 1 and 100 (inclusive).") };
        let toSpawn = n.maturity_e8s_equivalent * Nat64.fromNat(Nat32.toNat(pct)) / 100;
        if (toSpawn < MIN_STAKE) { return err(E_INSUFFICIENT_FUNDS, "There isn't enough maturity to spawn a new neuron: at least 1 ICP worth of maturity is needed.") };
        let controller = switch (new_controller) { case (?c) c; case null { switch (n.controller) { case (?c) c; case null caller } } };
        let id = next_neuron_id;
        next_neuron_id += 1;
        let memo = switch (nonce) { case (?x) x; case null id };
        let account = neuronSubaccount(controller, memo);
        // the ICP arrives on the ledger now; it counts as stake once the spawn has matured
        ignore await ledger.mint({ owner = self(); subaccount = ?account }, Nat64.toNat(toSpawn));
        let now = nowSeconds();
        put({ newNeuron(id, controller, account, 0) with maturity_e8s_equivalent = toSpawn; spawn_at_timestamp_seconds = ?(now + SPAWN_DELAY); dissolve_state = ?#WhenDissolvedTimestampSeconds(now + SPAWN_DELAY) });
        let parent = switch (find(nid)) { case (?f) f; case null n };
        put({ parent with maturity_e8s_equivalent = parent.maturity_e8s_equivalent - toSpawn });
        { command = ?#Spawn({ created_neuron_id = ?{ id } }) };
      };
      case (#StakeMaturity({ percentage_to_stake })) {
        log("StakeMaturity(" # tag # ",pct=" # debug_show (percentage_to_stake) # ")");
        switch (controllerOnly()) { case (?e) return e; case null {} };
        let pct = switch (percentage_to_stake) { case (?p) p; case null (100 : Nat32) };
        if (pct == 0 or pct > 100) { return err(E_INVALID_COMMAND, "The percentage of maturity to stake must be a value between 1 and 100 (inclusive).") };
        if (n.maturity_e8s_equivalent == 0) { return err(E_PRECONDITION_FAILED, "Neuron " # Nat64.toText(nid) # " has no maturity to stake.") };
        let amt = n.maturity_e8s_equivalent * Nat64.fromNat(Nat32.toNat(pct)) / 100;
        let staked = stakedMaturity(n) + amt;
        put({ n with maturity_e8s_equivalent = n.maturity_e8s_equivalent - amt; staked_maturity_e8s_equivalent = ?staked });
        { command = ?#StakeMaturity({ maturity_e8s = n.maturity_e8s_equivalent - amt; staked_maturity_e8s = staked }) };
      };
      case (#MergeMaturity(_)) {
        log("MergeMaturity(" # tag # ")");
        switch (controllerOnly()) { case (?e) return e; case null {} };
        err(E_INVALID_COMMAND, "Merging maturity is no longer supported. Use StakeMaturity or DisburseMaturity instead.");
      };
      case (#DisburseMaturity({ percentage_to_disburse; to_account })) {
        log("DisburseMaturity(" # tag # ",pct=" # Nat32.toText(percentage_to_disburse) # ",to=" # (switch (to_account) { case (?a) Principal.toText(a.owner); case null "controller" }) # ")");
        switch (controllerOnly()) { case (?e) return e; case null {} };
        if (percentage_to_disburse == 0 or percentage_to_disburse > 100) { return err(E_INVALID_COMMAND, "The percentage of maturity to disburse must be a value between 1 and 100 (inclusive).") };
        let amt = n.maturity_e8s_equivalent * Nat64.fromNat(Nat32.toNat(percentage_to_disburse)) / 100;
        if (amt <= ICP_FEE) { return err(E_INSUFFICIENT_FUNDS, "Not enough maturity to disburse: the amount must exceed the transaction fee.") };
        let to : Account = switch (to_account) { case (?a) a; case null { { owner = switch (n.controller) { case (?c) c; case null caller }; subaccount = null } } };
        // the real NNS pays out after 7 days; the mock pays at once
        ignore await ledger.mint(to, Nat64.toNat(amt));
        let fresh = switch (find(nid)) { case (?f) f; case null n };
        put({ fresh with maturity_e8s_equivalent = fresh.maturity_e8s_equivalent - amt });
        maturity_disbursements := Array.append(maturity_disbursements, [{ neuron = nid; amount_e8s = amt; to }]);
        { command = ?#DisburseMaturity({ amount_disbursed_e8s = ?amt }) };
      };
      case (#Follow({ topic; followees })) {
        log("Follow(" # tag # ",topic=" # Int32.toText(topic) # ",n=" # Nat.toText(followees.size()) # ")");
        switch (controllerOrHotkey()) { case (?e) return e; case null {} };
        if (followees.size() > MAX_FOLLOWEES) { return err(E_INVALID_COMMAND, "Too many followees (at most 15 per topic).") };
        let others = Array.filter<(Int32, Followees)>(n.followees, func((t, _)) { t != topic });
        let updated = if (followees.size() == 0) { others } else { Array.append(others, [(topic, { followees })]) };
        put({ n with followees = updated; voting_power_refreshed_timestamp_seconds = ?nowSeconds() });
        { command = ?#Follow({}) };
      };
      case (#RegisterVote({ vote; proposal })) {
        log("RegisterVote(" # tag # ",proposal=" # debug_show (proposal) # ",vote=" # Int32.toText(vote) # ")");
        switch (controllerOrHotkey()) { case (?e) return e; case null {} };
        let pid = switch (proposal) { case (?p) p; case null { return err(E_INVALID_COMMAND, "Registering a vote requires a proposal id.") } };
        if (Array.find<ProposalRecord>(proposals, func(p) { p.id == pid.id }) == null) { return err(E_NOT_FOUND, "Proposal " # Nat64.toText(pid.id) # " not found.") };
        if (vote != 1 and vote != 2) { return err(E_INVALID_COMMAND, "Invalid vote: must be 1 (yes) or 2 (no).") };
        if (dissolveDelay(n) < MIN_DISSOLVE_FOR_VOTING) { return err(E_PRECONDITION_FAILED, "Neuron " # Nat64.toText(nid) # " is not eligible to vote: dissolve delay below 6 months.") };
        if (Array.find<BallotInfo>(n.recent_ballots, func(b) { b.proposal_id == ?pid }) != null) { return err(E_ALREADY_VOTED, "Neuron already voted on proposal " # Nat64.toText(pid.id) # ".") };
        put({ n with recent_ballots = Array.append(n.recent_ballots, [{ vote; proposal_id = ?pid }]) });
        { command = ?#RegisterVote({}) };
      };
      case (#MakeProposal(p)) {
        log("MakeProposal(" # tag # ",title=" # debug_show (p.title) # ")");
        switch (controllerOrHotkey()) { case (?e) return e; case null {} };
        if (dissolveDelay(n) < MIN_DISSOLVE_FOR_VOTING) { return err(E_PRECONDITION_FAILED, "Neuron's dissolve delay is too short to submit proposals.") };
        if (n.cached_neuron_stake_e8s < PROPOSAL_MIN_STAKE) { return err(E_INSUFFICIENT_FUNDS, "Neuron doesn't have enough stake to submit a proposal (10 ICP reject cost).") };
        let id = next_proposal_id;
        next_proposal_id += 1;
        let motion = switch (p.action) { case (?#Motion(m)) ?m.motion_text; case null null };
        proposals := Array.append(proposals, [{ id; proposer = ?nid; title = p.title; summary = p.summary; url = p.url; motion }]);
        { command = ?#MakeProposal({ message = null; proposal_id = ?{ id } }) };
      };
      case (#RefreshVotingPower(_)) {
        log("RefreshVotingPower(" # tag # ")");
        switch (controllerOrHotkey()) { case (?e) return e; case null {} };
        put({ n with voting_power_refreshed_timestamp_seconds = ?nowSeconds() });
        { command = ?#RefreshVotingPower({}) };
      };
      case (#Split({ amount_e8s })) {
        log("Split(" # tag # ",amount=" # Nat64.toText(amount_e8s) # ")");
        switch (controllerOnly()) { case (?e) return e; case null {} };
        if (amount_e8s < MIN_STAKE + ICP_FEE) { return err(E_INSUFFICIENT_FUNDS, "Trying to split a neuron with argument amount_e8s that is too small: at least 1 ICP plus the transfer fee.") };
        if (n.cached_neuron_stake_e8s < amount_e8s + MIN_STAKE) { return err(E_INSUFFICIENT_FUNDS, "Trying to split a neuron would leave less than 1 ICP in the parent.") };
        let id = next_neuron_id;
        next_neuron_id += 1;
        let controller = switch (n.controller) { case (?c) c; case null caller };
        let account = neuronSubaccount(controller, id);
        switch (await transfer(?n.account, { owner = self(); subaccount = ?account }, amount_e8s - ICP_FEE)) {
          case (#Err(m)) { err(E_EXTERNAL, m) };
          case (#Ok(_)) {
            let parent = switch (find(nid)) { case (?f) f; case null n };
            put({ parent with cached_neuron_stake_e8s = parent.cached_neuron_stake_e8s - amount_e8s });
            put({ newNeuron(id, controller, account, amount_e8s - ICP_FEE) with dissolve_state = parent.dissolve_state; followees = parent.followees; hot_keys = parent.hot_keys; aging_since_timestamp_seconds = parent.aging_since_timestamp_seconds });
            { command = ?#Split({ created_neuron_id = ?{ id } }) };
          };
        };
      };
      case (#Merge({ source_neuron_id })) {
        log("Merge(" # tag # ",source=" # debug_show (source_neuron_id) # ")");
        switch (controllerOnly()) { case (?e) return e; case null {} };
        let sid = switch (source_neuron_id) { case (?s) s.id; case null { return err(E_INVALID_COMMAND, "Merge must have a source neuron.") } };
        let source = switch (settle(sid)) { case (?s) s; case null { return err(E_NOT_FOUND, "Source neuron not found.") } };
        if (not isController(source, caller)) { return err(E_NOT_AUTHORIZED, "Caller does not control the source neuron.") };
        if (sid == nid) { return err(E_INVALID_COMMAND, "Cannot merge a neuron into itself.") };
        if (isDissolving(n) or isDissolving(source)) { return err(E_REQUIRES_NOT_DISSOLVING, "Only neurons that are not dissolving can be merged.") };
        if (source.cached_neuron_stake_e8s <= ICP_FEE) { return err(E_INSUFFICIENT_FUNDS, "Source neuron has no stake to merge.") };
        switch (await transfer(?source.account, { owner = self(); subaccount = ?n.account }, source.cached_neuron_stake_e8s - ICP_FEE)) {
          case (#Err(m)) { err(E_EXTERNAL, m) };
          case (#Ok(_)) {
            let t = switch (find(nid)) { case (?f) f; case null n };
            let s = switch (find(sid)) { case (?f) f; case null source };
            let delay = Nat64.max(dissolveDelay(t), dissolveDelay(s));
            let merged = withDelay({ t with cached_neuron_stake_e8s = t.cached_neuron_stake_e8s + s.cached_neuron_stake_e8s - ICP_FEE; maturity_e8s_equivalent = t.maturity_e8s_equivalent + s.maturity_e8s_equivalent; staked_maturity_e8s_equivalent = ?(stakedMaturity(t) + stakedMaturity(s)) }, delay);
            put(merged);
            let emptied : Neuron = { s with cached_neuron_stake_e8s = 0 : Nat64; maturity_e8s_equivalent = 0 : Nat64; staked_maturity_e8s_equivalent = null : ?Nat64; dissolve_state = ?#DissolveDelaySeconds(0 : Nat64) };
            put(emptied);
            { command = ?#Merge({ target_neuron = ?merged; source_neuron = ?emptied; target_neuron_info = ?info(merged); source_neuron_info = ?info(emptied) }) };
          };
        };
      };
      case (#DisburseToNeuron(_)) { log("DisburseToNeuron(" # tag # ")"); err(E_INVALID_COMMAND, "DisburseToNeuron is not supported by the mock.") };
    };
  };

  // ---- queries ----
  public shared query ({ caller }) func list_neurons(args : ListNeurons) : async ListNeuronsResponse {
    let includeEmpty = switch (args.include_empty_neurons_readable_by_caller) { case (?b) b; case null true };
    let full = Buffer.Buffer<Neuron>(neurons.size());
    let infos = Buffer.Buffer<(Nat64, NeuronInfo)>(neurons.size());
    for (raw in neurons.vals()) {
      let n = settled(raw);
      let requested = Array.find<Nat64>(args.neuron_ids, func(i) { i == idOf(n) }) != null;
      if (requested) { infos.add((idOf(n), info(n))) };
      if (readable(n, caller) and (args.include_neurons_readable_by_caller or requested)) {
        if (includeEmpty or not isEmpty(n)) {
          full.add(n);
          if (not requested) { infos.add((idOf(n), info(n))) };
        };
      };
    };
    { neuron_infos = Buffer.toArray(infos); full_neurons = Buffer.toArray(full) };
  };

  public shared query ({ caller }) func get_full_neuron(id : Nat64) : async { #Ok : Neuron; #Err : GovernanceError } {
    switch (find(id)) {
      case null { #Err({ error_message = "Neuron not found"; error_type = E_NOT_FOUND }) };
      case (?n) {
        if (not readable(n, caller)) { return #Err({ error_message = "Caller '" # Principal.toText(caller) # "' is not authorized to read the full neuron " # Nat64.toText(id) # "."; error_type = E_NOT_AUTHORIZED }) };
        #Ok(settled(n));
      };
    };
  };

  public query func get_neuron_info(id : Nat64) : async { #Ok : NeuronInfo; #Err : GovernanceError } {
    switch (find(id)) {
      case null { #Err({ error_message = "Neuron not found"; error_type = E_NOT_FOUND }) };
      case (?n) { #Ok(info(settled(n))) };
    };
  };

  public query func list_known_neurons() : async { known_neurons : [{ id : ?NeuronId; known_neuron_data : ?KnownNeuronData }] } { { known_neurons = [] } };

  // ---- test helpers ----

  /// Create a neuron for any controller; the stake is minted onto its ledger subaccount.
  public shared func create_neuron(controller : Principal, stake_e8s : Nat64, dissolve_delay_seconds : Nat64, maturity_e8s : Nat64) : async Nat64 {
    let id = next_neuron_id;
    next_neuron_id += 1;
    let account = neuronSubaccount(controller, id);
    if (stake_e8s > 0) { ignore await ledger.mint({ owner = self(); subaccount = ?account }, Nat64.toNat(stake_e8s)) };
    put({ newNeuron(id, controller, account, stake_e8s) with maturity_e8s_equivalent = maturity_e8s; dissolve_state = ?#DissolveDelaySeconds(dissolve_delay_seconds) });
    id;
  };
  public shared func set_maturity(id : Nat64, e8s : Nat64) : async () {
    switch (find(id)) { case (?n) put({ n with maturity_e8s_equivalent = e8s }); case null Debug.trap("no such neuron") };
  };
  public shared func set_staked_maturity(id : Nat64, e8s : Nat64) : async () {
    switch (find(id)) { case (?n) put({ n with staked_maturity_e8s_equivalent = ?e8s }); case null Debug.trap("no such neuron") };
  };
  /// Set the cached stake only (the ledger subaccount is left alone).
  public shared func set_stake(id : Nat64, e8s : Nat64) : async () {
    switch (find(id)) { case (?n) put({ n with cached_neuron_stake_e8s = e8s }); case null Debug.trap("no such neuron") };
  };
  public shared func set_age(id : Nat64, seconds : Nat64) : async () {
    switch (find(id)) { case (?n) put({ n with aging_since_timestamp_seconds = nowSeconds() - seconds }); case null Debug.trap("no such neuron") };
  };
  public shared func set_controller(id : Nat64, controller : Principal) : async () {
    switch (find(id)) { case (?n) put({ n with controller = ?controller }); case null Debug.trap("no such neuron") };
  };
  public shared func set_mode(m : Mode) : async () { mode := m };
  public shared func set_max_dissolve_delay(seconds : Nat64) : async () { max_dissolve_delay := seconds };
  public shared func add_proposal(id : Nat64) : async () {
    proposals := Array.append(proposals, [{ id; proposer = null; title = ?"test proposal"; summary = ""; url = ""; motion = null }]);
  };
  public shared func clear_calls() : async () { calls := [] };

  public query func get_neuron(id : Nat64) : async ?Neuron { switch (find(id)) { case (?n) ?settled(n); case null null } };
  public query func neuron_subaccount(controller : Principal, memo : Nat64) : async Blob { neuronSubaccount(controller, memo) };
  public query func get_calls() : async [Text] { calls };
  public query func get_disbursements() : async [Disbursement] { disbursements };
  public query func get_maturity_disbursements() : async [MaturityDisbursement] { maturity_disbursements };
  public query func get_proposals() : async [ProposalRecord] { proposals };
  public query func get_max_dissolve_delay() : async Nat64 { max_dissolve_delay };
};
