/// Test double for NNS governance as sneed_mon sees it: `list_proposals` (open proposals, newest
/// first, with the real ProposalInfo shape reduced to a few more fields than sneed_mon reads) and
/// the public `get_neuron_info` (recent ballots, dissolve delay, voting power, visibility). Call
/// counters let the tests check how much work a round did.
import Array "mo:base/Array";
import Int "mo:base/Int";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Time "mo:base/Time";

persistent actor class MockMonNns() {
  public type ProposalId = { id : Nat64 };
  public type Ballot = { vote : Int32; voting_power : Nat64 };
  public type ProposalInfo = {
    id : ?ProposalId;
    status : Int32;
    topic : Int32;
    ballots : [(Nat64, Ballot)];
    proposal_timestamp_seconds : Nat64;
    reward_event_round : Nat64;
    deadline_timestamp_seconds : ?Nat64;
    reward_status : Int32;
    proposal : ?{ title : ?Text; url : Text; summary : Text };
    proposer : ?{ id : Nat64 };
  };
  public type BallotInfo = { vote : Int32; proposal_id : ?ProposalId };
  public type NeuronInfo = {
    dissolve_delay_seconds : Nat64;
    recent_ballots : [BallotInfo];
    neuron_type : ?Int32;
    created_timestamp_seconds : Nat64;
    state : Int32;
    stake_e8s : Nat64;
    retrieved_at_timestamp_seconds : Nat64;
    visibility : ?Int32;
    age_seconds : Nat64;
    voting_power : Nat64;
    deciding_voting_power : ?Nat64;
  };

  var proposals : [ProposalInfo] = []; // newest last
  var neurons : [(Nat64, NeuronInfo)] = [];
  var calls_list_proposals : Nat = 0;
  var calls_get_neuron_info : Nat = 0;

  public shared func add_proposal(id : Nat64, title : Text, topic : Int32, created_s : Nat64, deadline_s : Nat64) : async () {
    let p : ProposalInfo = {
      id = ?{ id }; status = 1; topic; ballots = []; proposal_timestamp_seconds = created_s; reward_event_round = 0;
      deadline_timestamp_seconds = ?deadline_s; reward_status = 1; proposal = ?{ title = ?title; url = ""; summary = "" }; proposer = null;
    };
    proposals := Array.append(Array.filter<ProposalInfo>(proposals, func(x) = x.id != ?{ id }), [p]);
  };
  public shared func set_neuron(id : Nat64, created_s : Nat64, dissolve_delay_s : Nat64, voting_power : Nat64, visibility : ?Int32) : async () {
    let n : NeuronInfo = {
      dissolve_delay_seconds = dissolve_delay_s; recent_ballots = []; neuron_type = null; created_timestamp_seconds = created_s; state = 1;
      stake_e8s = voting_power; retrieved_at_timestamp_seconds = 0; visibility; age_seconds = 0; voting_power; deciding_voting_power = ?voting_power;
    };
    neurons := Array.append(Array.filter<(Nat64, NeuronInfo)>(neurons, func((k, _)) = k != id), [(id, n)]);
  };
  public shared func vote(neuron : Nat64, proposal : Nat64, v : Int32) : async () {
    neurons := Array.map<(Nat64, NeuronInfo), (Nat64, NeuronInfo)>(neurons, func((k, n)) = if (k != neuron) (k, n) else (k, { n with recent_ballots = Array.append([{ vote = v; proposal_id = ?{ id = proposal } }], n.recent_ballots) }));
  };
  public query func counters() : async { list_proposals : Nat; get_neuron_info : Nat } {
    { list_proposals = calls_list_proposals; get_neuron_info = calls_get_neuron_info };
  };

  // a query called by a canister runs as an update, so the counters stick
  public shared func list_proposals(args : { include_reward_status : [Int32]; omit_large_fields : ?Bool; before_proposal : ?ProposalId; limit : Nat32; exclude_topic : [Int32]; include_all_manage_neuron_proposals : ?Bool; include_status : [Int32] }) : async { proposal_info : [ProposalInfo] } {
    calls_list_proposals += 1;
    let nowS = Nat64.fromNat(Int.abs(Time.now()) / 1_000_000_000);
    let newestFirst = Array.reverse(proposals);
    let after = Array.filter<ProposalInfo>(newestFirst, func(p) = switch (args.before_proposal, p.id) { case (?b, ?i) i.id < b.id; case _ true });
    let open = Array.filter<ProposalInfo>(after, func(p) = switch (p.deadline_timestamp_seconds) { case (?d) d > nowS; case null false });
    let n = if (open.size() < Nat32.toNat(args.limit)) open.size() else Nat32.toNat(args.limit);
    { proposal_info = Array.subArray<ProposalInfo>(open, 0, n) };
  };

  public shared func get_neuron_info(id : Nat64) : async { #Ok : NeuronInfo; #Err : { error_message : Text; error_type : Int32 } } {
    calls_get_neuron_info += 1;
    switch (Array.find<(Nat64, NeuronInfo)>(neurons, func((k, _)) = k == id)) {
      case (?(_, n)) {
        // a private neuron's ballots are hidden from others
        #Ok(if (n.visibility == ?(2 : Int32)) { { n with recent_ballots = [] } } else n);
      };
      case null #Err({ error_message = "Not found"; error_type = 3 });
    };
  };
};
