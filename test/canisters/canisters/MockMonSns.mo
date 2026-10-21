/// Test double for an SNS as sneed_mon sees it: root (`list_sns_canisters`, naming itself as
/// governance) and governance in one canister. Proposals and neurons have the real SNS shapes
/// (more fields than sneed_mon reads, so its reduced types are exercised). Like the real
/// governance, `list_proposals` only returns the ballots of the caller's own neurons, and
/// `get_proposal` returns them all. Call counters let the tests check how much work a round did.
import Array "mo:base/Array";
import Char "mo:base/Char";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Int "mo:base/Int";
import Nat64 "mo:base/Nat64";

persistent actor class MockMonSns() = this {
  public type NeuronId = { id : Blob };
  public type Permission = { principal : ?Principal; permission_type : [Int32] };
  public type Neuron = {
    id : ?NeuronId;
    permissions : [Permission];
    cached_neuron_stake_e8s : Nat64;
    created_timestamp_seconds : Nat64;
    dissolve_state : ?{ #DissolveDelaySeconds : Nat64; #WhenDissolvedTimestampSeconds : Nat64 };
  };
  public type Ballot = { vote : Int32; cast_timestamp_seconds : Nat64; voting_power : Nat64 };
  public type ProposalId = { id : Nat64 };
  public type Topic = {
    #DaoCommunitySettings; #SnsFrameworkManagement; #DappCanisterManagement; #ApplicationBusinessLogic;
    #Governance; #TreasuryAssetManagement; #CriticalDappOperations;
  };
  public type NervousSystemFunction = { id : Nat64; name : Text; description : ?Text; function_type : ?{ #NativeNervousSystemFunction : {} } };
  public type ProposalData = {
    id : ?ProposalId;
    action : Nat64;
    topic : ?Topic;
    ballots : [(Text, Ballot)];
    proposal : ?{ title : Text; url : Text; summary : Text; action : ?{ #Motion : { motion_text : Text } } };
    proposer : ?NeuronId;
    proposal_creation_timestamp_seconds : Nat64;
    initial_voting_period_seconds : Nat64;
    wait_for_quiet_state : ?{ current_deadline_timestamp_seconds : Nat64 };
    decided_timestamp_seconds : Nat64;
    executed_timestamp_seconds : Nat64;
    failed_timestamp_seconds : Nat64;
    reward_event_round : Nat64;
    is_eligible_for_rewards : Bool;
  };

  var neurons : [Neuron] = [];
  var proposals : [ProposalData] = []; // newest last
  var name : Text = "Mock SNS";
  var calls_list_proposals : Nat = 0;
  var calls_get_proposal : Nat = 0;
  var calls_list_neurons : Nat = 0;
  var topics_supported : Bool = true;

  let HEX : [Char] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
  func hex(b : Blob) : Text {
    var t = "";
    for (x in b.vals()) { let n = Nat8.toNat(x); t #= Char.toText(HEX[n / 16]) # Char.toText(HEX[n % 16]) };
    t;
  };

  // ---- test helpers ----
  public shared func set_name(n : Text) : async () { name := n };
  public shared func set_neurons(ns : [{ id : Blob; permissions : [Permission] }]) : async () {
    neurons := Array.map<{ id : Blob; permissions : [Permission] }, Neuron>(ns, func(n) = {
      id = ?{ id = n.id }; permissions = n.permissions; cached_neuron_stake_e8s = 100_000_000; created_timestamp_seconds = 0; dissolve_state = ?#DissolveDelaySeconds(15_552_000);
    });
  };
  /// A proposal with ballots for the given neurons (all unvoted), open until `deadline_s`.
  public shared func add_proposal(id : Nat64, title : Text, created_s : Nat64, deadline_s : Nat64, ballot_neurons : [Blob]) : async () {
    let p : ProposalData = {
      id = ?{ id }; action = 1; topic = if (topics_supported) ?#Governance else null;
      ballots = Array.map<Blob, (Text, Ballot)>(ballot_neurons, func(b) = (hex(b), { vote = 0; cast_timestamp_seconds = 0; voting_power = 100 }));
      proposal = ?{ title; url = ""; summary = "summary"; action = ?#Motion({ motion_text = "motion" }) };
      proposer = null; proposal_creation_timestamp_seconds = created_s;
      initial_voting_period_seconds = deadline_s - created_s; wait_for_quiet_state = ?{ current_deadline_timestamp_seconds = deadline_s };
      decided_timestamp_seconds = 0; executed_timestamp_seconds = 0; failed_timestamp_seconds = 0; reward_event_round = 0; is_eligible_for_rewards = true;
    };
    proposals := Array.append(Array.filter<ProposalData>(proposals, func(x) = x.id != ?{ id }), [p]);
  };
  public shared func set_vote(id : Nat64, neuron : Blob, vote : Int32) : async () {
    let h = hex(neuron);
    proposals := Array.map<ProposalData, ProposalData>(proposals, func(p) = if (p.id != ?{ id }) p else {
      { p with ballots = Array.map<(Text, Ballot), (Text, Ballot)>(p.ballots, func((k, b)) = if (k == h) (k, { b with vote; cast_timestamp_seconds = (1 : Nat64) }) else (k, b)) };
    });
  };
  /// The proposal's topic (and action id), as a governance with topics files it.
  public shared func set_topic(id : Nat64, topic : Text, action : Nat64) : async () {
    let t : ?Topic = switch topic {
      case "Governance" ?#Governance; case "TreasuryAssetManagement" ?#TreasuryAssetManagement;
      case "DaoCommunitySettings" ?#DaoCommunitySettings; case "CriticalDappOperations" ?#CriticalDappOperations; case _ null;
    };
    proposals := Array.map<ProposalData, ProposalData>(proposals, func(p) = if (p.id != ?{ id }) p else { { p with topic = if (topics_supported) t else null; action } });
  };
  /// false: an SNS from before topics (list_topics traps, proposals carry no topic).
  public shared func set_topics_supported(b : Bool) : async () { topics_supported := b };
  public query func counters() : async { list_proposals : Nat; get_proposal : Nat; list_neurons : Nat } {
    { list_proposals = calls_list_proposals; get_proposal = calls_get_proposal; list_neurons = calls_list_neurons };
  };

  // ---- SNS root ----
  public query func list_sns_canisters(_ : {}) : async { root : ?Principal; governance : ?Principal; ledger : ?Principal; swap : ?Principal; index : ?Principal; dapps : [Principal]; archives : [Principal] } {
    let self = Principal.fromActor(this);
    { root = ?self; governance = ?self; ledger = null; swap = null; index = null; dapps = []; archives = [] };
  };

  // ---- SNS governance ----
  public query func get_metadata(_ : {}) : async { url : ?Text; logo : ?Text; name : ?Text; description : ?Text } {
    { url = null; logo = null; name = ?name; description = null };
  };

  func neuronsOf(p : Principal) : [Neuron] = Array.filter<Neuron>(neurons, func(n) = Array.find<Permission>(n.permissions, func(x) = x.principal == ?p) != null);

  // a query called by a canister runs as an update, so the counters stick
  public shared ({ caller }) func list_proposals(args : { include_reward_status : [Int32]; before_proposal : ?ProposalId; limit : Nat32; exclude_type : [Nat64]; include_status : [Int32]; include_topics : ?[{ topic : ?{ #Governance } }] }) : async {
    proposals : [ProposalData]; include_ballots_by_caller : ?Bool; include_topic_filtering : ?Bool;
  } {
    calls_list_proposals += 1;
    let mine = Array.map<Neuron, Text>(neuronsOf(caller), func(n) = switch (n.id) { case (?i) hex(i.id); case null "" });
    let newestFirst = Array.reverse(proposals);
    let after = Array.filter<ProposalData>(newestFirst, func(p) = switch (args.before_proposal, p.id) { case (?b, ?i) i.id < b.id; case _ true });
    // reward status 1 (ACCEPT_VOTES): only proposals still open
    let nowS = Nat64.fromNat(Int.abs(Time.now()) / 1_000_000_000);
    let onlyOpen = Array.find<Int32>(args.include_reward_status, func(x) = x == 1) != null;
    let after2 = if (onlyOpen) Array.filter<ProposalData>(after, func(p) = switch (p.wait_for_quiet_state) { case (?w) w.current_deadline_timestamp_seconds > nowS; case null true }) else after;
    let n = if (after2.size() < Nat32.toNat(args.limit)) after2.size() else Nat32.toNat(args.limit);
    let out = Array.map<ProposalData, ProposalData>(Array.subArray<ProposalData>(after2, 0, n), func(p) = { p with ballots = Array.filter<(Text, Ballot)>(p.ballots, func((k, _)) = Array.find<Text>(mine, func(m) = m == k) != null) });
    { proposals = out; include_ballots_by_caller = ?true; include_topic_filtering = ?true };
  };

  public shared func get_proposal(args : { proposal_id : ?ProposalId }) : async { result : ?{ #Error : { error_message : Text; error_type : Int32 }; #Proposal : ProposalData } } {
    calls_get_proposal += 1;
    switch (Array.find<ProposalData>(proposals, func(p) = p.id == args.proposal_id)) {
      case (?p) { { result = ?#Proposal(p) } };
      case null { { result = ?#Error({ error_message = "No proposal"; error_type = 0 }) } };
    };
  };

  public query func list_topics(_ : {}) : async { topics : ?[{ topic : ?Topic; name : ?Text; description : ?Text; native_functions : ?[NervousSystemFunction]; custom_functions : ?[NervousSystemFunction]; is_critical : ?Bool }]; uncategorized_functions : ?[NervousSystemFunction] } {
    if (not topics_supported) { assert false };
    {
      topics = ?[
        { topic = ?#Governance; name = ?"Governance"; description = ?"Motions and governance"; native_functions = null; custom_functions = null; is_critical = ?false },
        { topic = ?#TreasuryAssetManagement; name = ?"Treasury & asset management"; description = ?"Treasury"; native_functions = null; custom_functions = null; is_critical = ?true },
      ];
      uncategorized_functions = ?[];
    };
  };

  public query func list_nervous_system_functions() : async { reserved_ids : [Nat64]; functions : [NervousSystemFunction] } {
    { reserved_ids = []; functions = [{ id = 1; name = "Motion"; description = ?"A motion"; function_type = ?#NativeNervousSystemFunction({}) }, { id = 1000; name = "Custom thing"; description = null; function_type = null }] };
  };

  public shared func list_neurons(args : { of_principal : ?Principal; limit : Nat32; start_page_at : ?NeuronId }) : async { neurons : [Neuron] } {
    calls_list_neurons += 1;
    let all = switch (args.of_principal) { case (?p) neuronsOf(p); case null neurons };
    // page after start_page_at (by position)
    var startIdx = 0;
    switch (args.start_page_at) {
      case (?s) { var i = 0; for (n in all.vals()) { i += 1; if (n.id == ?s) startIdx := i } };
      case null {};
    };
    let rest = if (startIdx >= all.size()) [] else Array.subArray<Neuron>(all, startIdx, all.size() - startIdx);
    let n = if (rest.size() < Nat32.toNat(args.limit)) rest.size() else Nat32.toNat(args.limit);
    { neurons = Array.subArray<Neuron>(rest, 0, n) };
  };

};
