/// Types of sneed_mon (spec/sneed_mon.md).
module {
  /// What sneed_mon watches for a user. Proposals only today; `#cycles` and `#rewards` are planned
  /// (spec §8) and will be new tags here.
  public type MonTopic = { #proposals };

  // ---- Watches (spec §1) ----

  /// What a watch is about: an SNS (by its root canister) or the NNS.
  public type Target = { #sns : Principal; #nns };

  /// Which proposal topics a watch hears about: all, or only these keys (from list_target_topics:
  /// SNS topic names such as "Governance", "fn:<function id>" for SNSes without topics, NNS topic
  /// numbers such as "4").
  public type TopicFilter = { #all; #only : [Text] };

  /// A watch's settings. `watch(target)` takes the defaults (get_tuning().defaults); pro users
  /// change them with update_watch.
  public type WatchSettings = {
    every_min : Nat; // how often the watch is checked (and charged): a tier of get_tiers (10, 60, 180, 1440)
    topics : TopicFilter;
    new_proposals : Bool; // "you can vote" messages
    reminders : Bool; // "closes soon" messages
    reminder_window_s : Nat; // how long before the deadline: 1 h, 4 h, 12 h, 24 h or 48 h (at least every_min)
  };

  /// update_watch: only the fields given change.
  public type WatchSettingsInput = {
    every_min : ?Nat;
    topics : ?TopicFilter;
    new_proposals : ?Bool;
    reminders : ?Bool;
    reminder_window_s : ?Nat;
  };

  public type Watch = {
    target : Target;
    settings : WatchSettings;
    created_at : Int;
    last_check_at : Int; // the last check (charged; its due messages sent); 0 = due at the next round
    user_refresh_at : Int; // the last refresh_my_neurons
  };

  /// An open proposal of a watched target. Its ballots are read once when it is first seen
  /// (`new_matched`) and once per reminder window its watchers use (`windows_done`), and matched
  /// against every watcher's cached neurons without further calls.
  public type OpenP = {
    id : Nat64;
    title : Text;
    deadline_s : Nat64;
    created_s : Nat64;
    topic_key : Text; // SNS topic name, or the NNS topic number
    fn_key : Text; // "fn:<action id>" (SNS), "" (NNS)
    new_matched : Bool;
    windows_done : [Nat];
    fails : Nat;
  };

  public type TargetState = {
    target : Target;
    key : Text; // the root as text, or "nns"
    governance : Principal;
    name : Text;
    watchers : [Principal]; // sorted
    open : [OpenP];
    max_seen_id : Nat64;
    listed_round : Nat;
    listed_at : Int; // 0 = not listed since it was (re)activated: every open proposal is new
    last_polled_at : Int;
    last_error : ?(Int, Text);
    errors : Nat;
  };

  public type PendingKind = { #new; #reminder };

  /// A message waiting for its watch to be due (several are sent as one digest).
  public type Pending = {
    key : Text; // target key
    id : Nat64;
    kind : PendingKind;
    title : Text;
    deadline_s : Nat64;
    created_s : Nat64;
    neurons : Nat; // how many of the user's neurons can vote and haven't
    nns_check : Bool; // NNS: still to be checked against the user's neurons when due
  };

  /// A user's neurons in an SNS on which they hold the vote permission (hex ids), as last read.
  public type NeuronCache = { ids : [Text]; at : Int; ok : Bool };

  public type TopicOption = { key : Text; name : Text; description : Text };

  /// get_config: every setting, for an admin page.
  public type AllConfig = { core : Config; tuning : Tuning; billing : BillingConfig; tiers : TierTable };

  /// Settings beyond Config (a separate stable variable, so Config keeps its shape).
  public type Tuning = {
    nns_governance : Principal; // rrkah-fqaaa-aaaaa-aaaaq-cai
    defaults : WatchSettings; // what watch(target) uses
    neuron_refresh_s : Nat; // a watcher's SNS neurons are re-read this often (spread over rounds)
    max_refresh_per_round : Nat;
    parallel_calls : Nat; // calls issued together and awaited together (at most 50)
    max_nns_neurons : Nat; // NNS neuron ids a user may register
    user_refresh_min_s : Nat; // refresh_my_neurons at most this often per watch
    max_pending_per_user : Nat;
    topic_cache_s : Nat; // list_target_topics answers are reused this long
  };

  public type MyWatch = {
    target : Target;
    topic : MonTopic;
    governance : Principal;
    name : Text;
    settings : WatchSettings;
    price_per_check_e8s : Nat;
    next_check_at : Int; // ns; the round at or after this time checks the watch
    pending : Nat; // proposals waiting for the next check
    neurons : ?Nat; // SNS: vote neurons found at the last read (null: not read yet); NNS: ids registered
    neurons_at : Int;
  };

  public type TargetInfo = {
    target : Target;
    governance : Principal;
    name : Text;
    watchers : Nat;
    open : [{ id : Nat64; title : Text; deadline_s : Nat64; topic_key : Text; new_done : Bool; windows_done : [Nat] }];
    active_watchers : Nat; // not paused; the target is polled only while there is one
    poll_every_min : ?Nat; // the fastest active watcher's frequency
    listed_at : Int;
    last_error : ?(Int, Text);
    errors : Nat;
  };

  public type Backlog = {
    round_open : Bool; // a round is under way (or waiting for the next tick to go on)
    ballots_to_fetch : Nat; // proposal reads due (new, or a reminder window reached)
    pending_messages : Nat;
    users_with_pending : Nat;
    neuron_caches_missing : Nat;
    neuron_caches_stale : Nat;
    checks_due : Nat;
  };

  /// One period's running costs and revenue (cycles are what the canister's balance went down by
  /// during its ticks: cycles received meanwhile hide some of it, idle costs between ticks are not
  /// counted).
  public type Period = { cycles_burned : Nat; revenue_e8s : Nat; checks : Nat; rounds : Nat };
  public type Economics = { total : Period; last_24h : Period; last_30d : Period; last_round_cycles : Nat };

  // ---- Legacy (the 1bbee49a build): kept so its stable state upgrades; migrated in postupgrade ----

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
    targets : Nat;
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
    paused_users : Nat; // users whose balance ran out (watches kept, no messages)
    economics : Economics;
    last_round_duration_ns : Int; // start to end of the last finished round
    round_ticks : Nat; // ticks the current (or last) round took
    backlog : Backlog;
  };



  // ---- Billing (spec/sneed_mon.md §3): a prepaid ICP balance per user, charged while watching ----

  public type BillingConfig = {
    icp_ledger : Principal; // the ICP ledger (ryjl3-tyaaa-aaaaa-aaaba-cai)
    ledger_fee_e8s : Nat; // the ledger's transfer fee (corrected from a BadFee answer)
    // collected fees are forwarded here in one transfer once they reach the threshold (null: they
    // stay in the canister for admin_withdraw_fees). Default: the RLL's ICP splitter, as Sneed Premium.
    fee_destination : ?Account;
    fee_sweep_threshold_e8s : Nat;
  };

  /// A frequency tier: watches checked every `every_min` minutes cost `daily_multiplier` ×
  /// base_daily_price_e8s a day, charged per check.
  public type Tier = { every_min : Nat; daily_multiplier : Nat };
  public type TierTable = { base_daily_price_e8s : Nat; tiers : [Tier] };
  /// A tier with its prices: per check = floor(daily price × every_min / 1440), so a day of checks
  /// never costs more than the daily price.
  public type TierPrice = { every_min : Nat; daily_multiplier : Nat; daily_price_e8s : Nat; per_check_e8s : Nat; checks_per_day : Nat };

  public type UserAccount = {
    balance_e8s : Nat;
    paused : Bool; // a check could not be paid: watches kept, no checks, no charges
    notice_sent : Bool; // the "monitoring paused" message went out for this pause
    deposited_e8s : Nat;
    charged_e8s : Nat;
    withdrawn_e8s : Nat;
    checks : Nat;
  };

  /// One paid check of a watch (get_my_charges).
  public type ChargeEntry = { at : Int; target : Target; every_min : Nat; price_e8s : Nat; outcome : Text };

  /// Special prices (spec/special_prices.md): an override of the base daily price. The tier
  /// multipliers apply on top, so every frequency tier gets the same proportional change; the
  /// charge per check is the lowest of the regular, admin and partner per-check prices.
  public type MonPrices = { base_daily_price_e8s : ?Nat };
  /// A partner's entry (`label_` is `label` in Candid).
  public type MonPartner = { label_ : Text; prices : MonPrices; expires_at : ?Int };
  public type MonPartnerListing = { principal : Principal; label_ : Text; prices : MonPrices; expires_at : ?Int };
  public type SpecialPrices = { admin_prices : MonPrices; partners : [MonPartnerListing] };
  public type SpecialPricesFor = { admin_prices : ?MonPrices; partner : ?MonPartner };
  public type SpResult = { #ok; #err : Text };
  /// One paid check with the price tier that applied (get_my_charges_with_tier): `regular`,
  /// `admin` or `partner` (sneed_mon has no premium price).
  /// `kind`: "check" (a paid check) or "auto_top_up" (a credit pulled from the user's wallet:
  /// every_min 0, price_e8s the amount credited, target meaningless).
  public type ChargeEntryTiered = { at : Int; target : Target; every_min : Nat; price_e8s : Nat; outcome : Text; price_tier : Text; kind : Text };

  /// Auto top-up (spec §3): when the balance falls below `when_below_e8s` (or can't pay one check of
  /// each watch), sneed_mon pulls `amount_e8s` from the user's wallet with icrc2_transfer_from, as
  /// far as the user's ICRC-2 approval allows.
  /// from_subaccount: the user's subaccount the pull comes from (32 bytes; null = the main account);
  /// approving from a subaccount holding limited funds caps what can ever be taken.
  public type AutoTopUpSettings = { amount_e8s : Nat; when_below_e8s : Nat; from_subaccount : ?Blob };
  public type TopUpFailure = { at : Int; reason : Text };
  /// Stored per user; settings null = off (the counters are kept).
  public type AutoTopUp = {
    settings : ?AutoTopUpSettings;
    set_at : Int;
    pulls : Nat; // successful pulls
    pulled_e8s : Nat; // credited by them, in all
    last_pull_at : Int;
    last_block : ?Nat;
    attempted_round : Nat; // at most one pull per user per round
    failure : ?TopUpFailure; // the last refusal by the ledger (cleared by a pull or a new setting)
    retry_at : Int; // after a refusal: not before a day has passed
    notice_sent : Bool; // the one "Auto top-up failed" message for this failure went out
  };
  public type MyAutoTopUp = {
    settings : ?AutoTopUpSettings;
    pulls : Nat;
    pulled_e8s : Nat;
    last_pull_at : Int;
    last_failure : ?TopUpFailure;
    retry_at : Int;
    spender : Account; // approve this account (sneed_mon) on the ICP ledger
    per_pull_allowance_e8s : Nat; // what one pull uses of the allowance: amount + ledger fee
    min_amount_e8s : Nat;
    max_amount_e8s : Nat;
  };

  public type MyBalance = {
    balance_e8s : Nat;
    paused : Bool;
    watches : Nat;
    per_round_of_checks_e8s : Nat; // one check of every watch: the least balance to start or resume
    per_day_e8s : Nat; // what the watches cost a day at their tiers
    charged_e8s : Nat; // charged so far, in all
    checks : Nat;
    deposited_e8s : Nat;
    withdrawn_e8s : Nat;
    deposit_account : Account;
    auto_top_up : MyAutoTopUp;
  };

  public type CreditResult = { #ok : { credited_e8s : Nat; balance_e8s : Nat; paused : Bool }; #err : Text };

  /// What sneed_mon owes: its main ledger account must hold at least user_balances_e8s +
  /// fees_available_e8s (the deposit subaccounts are not counted until credited).
  public type Accounting = {
    icp_ledger : Principal;
    user_balances_e8s : Nat;
    fees_available_e8s : Nat; // collected and not withdrawn by an admin yet
    obligations_e8s : Nat; // the sum of the two: the least the main account holds
    fees_collected_e8s : Nat; // in all
    fees_withdrawn_e8s : Nat; // forwarded or withdrawn, in all
    fees_forwarded_e8s : Nat; // of which forwarded automatically to fee_destination
    fee_forwards : Nat;
    deposits_e8s : Nat;
    withdrawals_e8s : Nat;
    accounts : Nat;
    paused_users : Nat;
    auto_top_ups : Nat; // successful auto top-ups, in all (their amounts are in deposits_e8s too)
    auto_top_ups_e8s : Nat;
  };

  // ---- ICP ledger (ICRC-1), the parts sneed_mon uses ----

  public type Account = { owner : Principal; subaccount : ?Blob };
  public type TransferArg = { from_subaccount : ?Blob; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 };
  public type TransferError = {
    #BadFee : { expected_fee : Nat };
    #BadBurn : { min_burn_amount : Nat };
    #InsufficientFunds : { balance : Nat };
    #TooOld;
    #CreatedInFuture : { ledger_time : Nat64 };
    #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable;
    #GenericError : { error_code : Nat; message : Text };
  };
  public type TransferFromArg = { spender_subaccount : ?Blob; from : Account; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 };
  public type TransferFromError = {
    #BadFee : { expected_fee : Nat };
    #BadBurn : { min_burn_amount : Nat };
    #InsufficientFunds : { balance : Nat };
    #InsufficientAllowance : { allowance : Nat };
    #TooOld;
    #CreatedInFuture : { ledger_time : Nat64 };
    #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable;
    #GenericError : { error_code : Nat; message : Text };
  };
  public type TransferFromResult = { #Ok : Nat; #Err : TransferFromError };
  public type Ledger = actor {
    icrc1_balance_of : shared query Account -> async Nat;
    icrc1_transfer : shared TransferArg -> async { #Ok : Nat; #Err : TransferError };
    icrc2_transfer_from : shared TransferFromArg -> async TransferFromResult;
  };

  // ---- Sneed Notifications (src/sneed_notifications/Types.mo), the parts sneed_mon uses ----

  public type Level = { #urgent; #normal; #info };
  public type NTopic = { id : Text; title : Text; description : Text; level : Level };
  public type AppInput = { name : Text; logo : ?Text; description : Text; canisters : [Principal]; topics : [NTopic] };
  public type NotifyInput = { user : Principal; topic : Text; title : Text; body : Text; link : ?Text; dedupe : ?Text; sponsored : Bool };
  public type NotifyError = { #not_registered; #unknown_topic; #not_allowed; #rate_limited; #no_funds; #invalid : Text };
  public type NotifyResult = { #ok : { id : Nat; deliveries : Nat; deduplicated : Bool }; #err : NotifyError };

  public type Notifications = actor {
    register_app : shared AppInput -> async { #ok : Nat; #err : Text };
    update_app : shared (Nat, AppInput) -> async { #ok : Text; #err : Text };
    request_permission : shared Principal -> async { #ok : Text; #err : Text };
    notify_batch : shared [NotifyInput] -> async [NotifyResult];
  };

  // ---- SNS governance (src/external/sns_governance), reduced to the fields sneed_mon reads ----

  public type ProposalId = { id : Nat64 };
  public type NeuronId = { id : Blob };
  public type Ballot = { vote : Int32; cast_timestamp_seconds : Nat64; voting_power : Nat64 };
  public type SnsTopic = {
    #DaoCommunitySettings;
    #SnsFrameworkManagement;
    #DappCanisterManagement;
    #ApplicationBusinessLogic;
    #Governance;
    #TreasuryAssetManagement;
    #CriticalDappOperations;
  };
  public type ListedProposal = {
    id : ?ProposalId;
    action : Nat64;
    topic : ?SnsTopic; // absent in SNS versions before topics (then the action id is the key)
    proposal : ?{ title : Text };
    proposal_creation_timestamp_seconds : Nat64;
    initial_voting_period_seconds : Nat64;
    wait_for_quiet_state : ?{ current_deadline_timestamp_seconds : Nat64 };
  };
  public type FullProposal = {
    id : ?ProposalId;
    action : Nat64;
    topic : ?SnsTopic;
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
    list_topics : shared query ({}) -> async {
      topics : ?[{ topic : ?SnsTopic; name : ?Text; description : ?Text }];
      uncategorized_functions : ?[{ id : Nat64; name : Text; description : ?Text }];
    };
    list_nervous_system_functions : shared query () -> async { functions : [{ id : Nat64; name : Text; description : ?Text }] };
  };

  // ---- NNS governance (src/external/nns_gov), reduced to the fields sneed_mon reads ----

  public type NnsProposalInfo = {
    id : ?ProposalId;
    topic : Int32;
    proposal_timestamp_seconds : Nat64;
    deadline_timestamp_seconds : ?Nat64;
    proposal : ?{ title : ?Text };
  };
  public type NnsNeuronInfo = {
    dissolve_delay_seconds : Nat64;
    recent_ballots : [{ vote : Int32; proposal_id : ?ProposalId }];
    created_timestamp_seconds : Nat64;
    voting_power : Nat64;
    deciding_voting_power : ?Nat64;
    visibility : ?Int32; // 2 = private: recent ballots are hidden from sneed_mon
  };
  public type NnsGovernance = actor {
    list_proposals : shared query ({
      include_reward_status : [Int32];
      omit_large_fields : ?Bool;
      before_proposal : ?ProposalId;
      limit : Nat32;
      exclude_topic : [Int32];
      include_all_manage_neuron_proposals : ?Bool;
      include_status : [Int32];
    }) -> async { proposal_info : [NnsProposalInfo] };
    get_neuron_info : shared query Nat64 -> async { #Ok : NnsNeuronInfo; #Err : { error_message : Text; error_type : Int32 } };
  };

  public type Result = { #ok : Text; #err : Text };
  public type ResultNat = { #ok : Nat; #err : Text };
};
