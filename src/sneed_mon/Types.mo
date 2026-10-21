/// Types of sneed_mon (spec/sneed_mon.md).
module {
  /// What sneed_mon watches for a user. Step 1 has proposals only; `#cycles` and `#rewards` are
  /// planned (spec §7) and will be new tags here, each with its own watch list and pass.
  public type MonTopic = { #proposals };

  /// How far one pass over the watchers of an SNS has come for one proposal: not started, done up
  /// to and including a watcher (watchers are kept sorted, so a pass resumes after them), or done.
  public type PassState = { #todo; #after : Principal; #done };

  /// An open proposal of a watched SNS, with its two passes: "new votable proposal" and "closes in
  /// about a day, you haven't voted".
  public type OpenProposal = {
    id : Nat64;
    title : Text;
    deadline_s : Nat64; // seconds since the epoch, wait-for-quiet included
    new_pass : PassState;
    reminder_pass : PassState;
    fails : Nat; // get_proposal failures; after 3 the pass is given up
  };

  /// One watched SNS: its governance (from SNS-W), its watchers (sorted) and its open proposals.
  public type WatchedSns = {
    root : Principal;
    governance : Principal;
    name : Text;
    watchers : [Principal];
    open : [OpenProposal];
    max_seen_id : Nat64;
    listed_round : Nat; // the round in which list_proposals last ran for it
    listed_at : Int;
    last_error : ?(Int, Text);
    errors : Nat;
  };

  public type Config = {
    notifications : ?Principal; // the Sneed Notifications canister
    sns_wasm : Principal; // SNS-W, which lists deployed SNSes (root -> governance)
    interval_s : Nat; // how often a round starts
    paused : Bool;
    sponsored : Bool; // whether sneed_mon pays for its messages (from its app balance) instead of the users
    max_users : Nat; // distinct watching users
    max_watches_per_user : Nat; // SNSes per user
    max_snses : Nat; // distinct watched SNSes
    max_calls_per_tick : Nat; // inter-canister calls one tick may make
    max_continuations : Nat; // follow-up ticks one round may take before it waits for the next round
    reminder_window_s : Nat; // "closes soon" when the deadline is this close
    batch_size : Nat; // messages per notify_batch (at most 100)
    neuron_pages : Nat; // list_neurons pages (100 neurons each) per user and SNS
    proposal_pages : Nat; // list_proposals pages (50 each) per SNS and round
    neuron_cache_s : Nat; // how long a user's neurons in an SNS are reused
  };

  public type Status = {
    paused : Bool;
    running : Bool;
    users : Nat;
    watches : Nat;
    snses : Nat;
    open_proposals : Nat;
    rounds : Nat;
    last_round_start : Int;
    last_round_end : Int;
    interval_s : Nat;
    calls_last_round : Nat;
    calls_total : Nat;
    sent : Nat;
    deduplicated : Nat;
    skipped_not_allowed : Nat;
    skipped_rate_limited : Nat;
    skipped_other : Nat;
    errors : Nat;
    last_error : ?(Int, Text);
    notifications : ?Principal;
    app_id : ?Nat;
    cycles : Nat;
  };

  public type SnsInfo = {
    root : Principal;
    governance : Principal;
    name : Text;
    watchers : Nat;
    open : [{ id : Nat64; title : Text; deadline_s : Nat64; new_done : Bool; reminder_done : Bool }];
    listed_at : Int;
    last_error : ?(Int, Text);
    errors : Nat;
  };

  public type MyWatch = { topic : MonTopic; root : Principal; governance : Principal; name : Text };

  // ---- Sneed Notifications (src/sneed_notifications/Types.mo), the parts sneed_mon uses ----

  public type Level = { #urgent; #normal; #info };
  public type NTopic = { id : Text; title : Text; description : Text; level : Level };
  public type AppInput = { name : Text; logo : ?Text; description : Text; canisters : [Principal]; topics : [NTopic] };
  public type NotifyInput = { user : Principal; topic : Text; title : Text; body : Text; link : ?Text; dedupe : ?Text; sponsored : Bool };
  public type NotifyError = { #not_registered; #unknown_topic; #not_allowed; #rate_limited; #no_funds; #invalid : Text };
  public type NotifyResult = { #ok : { id : Nat; deliveries : Nat; deduplicated : Bool }; #err : NotifyError };

  public type Notifications = actor {
    register_app : shared AppInput -> async { #ok : Nat; #err : Text };
    request_permission : shared Principal -> async { #ok : Text; #err : Text };
    notify_batch : shared [NotifyInput] -> async [NotifyResult];
  };

  // ---- SNS governance (src/external/sns_governance), reduced to the fields sneed_mon reads ----

  public type ProposalId = { id : Nat64 };
  public type NeuronId = { id : Blob };
  public type Ballot = { vote : Int32; cast_timestamp_seconds : Nat64; voting_power : Nat64 };
  public type ListedProposal = {
    id : ?ProposalId;
    proposal : ?{ title : Text };
    proposal_creation_timestamp_seconds : Nat64;
    initial_voting_period_seconds : Nat64;
    wait_for_quiet_state : ?{ current_deadline_timestamp_seconds : Nat64 };
  };
  public type FullProposal = {
    id : ?ProposalId;
    proposal : ?{ title : Text };
    proposal_creation_timestamp_seconds : Nat64;
    initial_voting_period_seconds : Nat64;
    wait_for_quiet_state : ?{ current_deadline_timestamp_seconds : Nat64 };
    ballots : [(Text, Ballot)];
  };
  public type Neuron = { id : ?NeuronId; permissions : [{ principal : ?Principal; permission_type : [Int32] }] };

  public type Governance = actor {
    list_proposals : shared query ({
      include_reward_status : [Int32];
      before_proposal : ?ProposalId;
      limit : Nat32;
      exclude_type : [Nat64];
      include_status : [Int32];
      include_topics : ?[{}];
    }) -> async { proposals : [ListedProposal] };
    get_proposal : shared query ({ proposal_id : ?ProposalId }) -> async {
      result : ?{ #Error : { error_message : Text; error_type : Int32 }; #Proposal : FullProposal };
    };
    list_neurons : shared query ({ of_principal : ?Principal; limit : Nat32; start_page_at : ?NeuronId }) -> async { neurons : [Neuron] };
    get_metadata : shared query ({}) -> async { name : ?Text };
  };

  public type Result = { #ok : Text; #err : Text };
  public type ResultNat = { #ok : Nat; #err : Text };
};
