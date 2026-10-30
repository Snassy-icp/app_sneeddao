/// Public types of sneed_attestations, the proposal attestation registry (spec/proposal_attestations.md v3).
///
/// Builders attest what they rebuilt for one step of a governance proposal (or for a `#release`, an
/// install that is not a proposal). The registry reads the proposal itself (one adapter per governance
/// kind), checks the live module with the management canister's canister_info after execution, and
/// the asset tree of a frontend step with the asset canister's `list`. Results stay per builder.
module {

  // ---------------------------------------------------------------------------------------------
  // What a builder attests (spec "What a builder attests")
  // ---------------------------------------------------------------------------------------------

  public type Subject = {
    /// a step of a governance proposal (SNS governance, OhShii's ONS, a SONS, ...)
    #proposal : {
      governance : Principal;
      proposal_id : Nat64;
      step : Nat; // 0 for single-action proposals; batches: the step's index in proposal order
    };
    /// an install that is not a proposal, identified by what went live
    #release : { target : Principal; module_hash : Blob };
  };

  public type Embedded = { name : Text; sha256 : Blob };

  public type Artifact = {
    #wasm : {
      target : Principal; // the canister the step installs into
      proposed_sha256 : Blob; // the hash in the proposal (or the release's module hash), as the builder read it
      built_raw_sha256 : Blob;
      built_gz_sha256 : ?Blob; // gzip -9 -n, if the proposal ships gzipped
      embedded : [Embedded]; // nested modules (e.g. governance/ledger/index wasms inside a launcher)
      upgrade_arg_sha256 : ?Blob; // sha256 of the install/upgrade argument, when the proposal states one
    };
    #asset_batch : {
      target : Principal; // the asset canister
      batch_id : Nat;
      proposed_evidence : Blob;
      built_evidence : ?Blob; // null when it could no longer be computed (batch already committed)
      tree_sha256 : Blob; // the rebuilt asset tree, see `tree_hash_format` in get_config
    };
  };

  public type Source = {
    repo : Text; // URL
    commit : Text; // full sha
    recipe : Text; // the exact command
    environment : ?Text; // e.g. the build image digest
  };

  public type Verdict = { #match; #mismatch; #cannot_verify : Text };

  /// The argument of attest. builder and time are set by the registry.
  public type AttestInput = {
    subject : Subject;
    artifact : Artifact;
    source : Source;
    verdict : Verdict;
    log_url : ?Text;
  };

  public type Attestation = {
    id : Nat; // registry-wide sequence number
    block : Nat; // index of its sneedatt_attest block in the ICRC-3 log
    subject : Subject;
    artifact : Artifact;
    source : Source;
    verdict : Verdict;
    log_url : ?Text;
    builder : Principal; // the caller
    at : Int; // nanoseconds
  };

  /// One attestation as a frontend shows it, with what the registry knows about it.
  public type AttestationView = {
    attestation : Attestation;
    known_builder : Bool; // on the known-builders list of the subject's governance
    versions : Nat; // how many attestations this builder made for this subject (kept in state)
    /// the proposed hash/evidence the builder read equals what the registry read from the proposal
    /// (null: the registry has not read the proposal, or it has no hash for this step)
    proposal_agrees : ?Bool;
    /// the artifact's target equals the step's target as read from the proposal (null: not read)
    target_agrees : ?Bool;
    /// after the live check: the live module equals the builder's built_raw or built_gz hash, or the
    /// live asset tree equals the builder's tree_sha256 (null: no live check yet)
    live_agrees : ?Bool;
  };

  public type BuilderProfileInput = {
    name : Text;
    contact : ?Text;
    repo : ?Text; // where the builder's recipes live
    description : ?Text;
  };

  public type BuilderProfile = {
    builder : Principal;
    name : Text;
    contact : ?Text;
    repo : ?Text;
    description : ?Text;
    updated_at : Int;
    attestations : Nat; // attestations made (ever)
  };

  // ---------------------------------------------------------------------------------------------
  // Known builders (per DAO, set by that DAO's governance canister)
  // ---------------------------------------------------------------------------------------------

  public type KnownBuilder = { builder : Principal; note : ?Text };
  public type SetKnownBuildersArgs = { builders : [KnownBuilder] };
  public type KnownBuilders = { governance : Principal; builders : [KnownBuilder]; set_at : Int; block : Nat };

  /// What a generic nervous system function validator answers.
  public type ValidationResult = { #Ok : Text; #Err : Text };

  // ---------------------------------------------------------------------------------------------
  // What the registry reads from proposals (adapters) and checks itself
  // ---------------------------------------------------------------------------------------------

  public type GovernanceKind = {
    #sns; // SNS governance: get_proposal
    #ohshii; // ONS and SONS: get_proposal_upgrade_steps (planned interface, src/sneed_attestations/OhShiiTypes.mo)
  };

  /// The step's artifact as the proposal states it.
  public type ProposedArtifact = {
    #wasm : { module_hash : ?Blob; upgrade_arg_sha256 : ?Blob; chunked : ?Bool; size_bytes : ?Nat };
    #asset_batch : { batch_id : ?Nat; evidence : ?Blob };
    #snapshot_restore : { snapshot_id : ?Blob };
    #unknown : Text; // the adapter could not read it (reason)
  };

  public type ProposedSource = { repo : ?Text; commit : ?Text; instructions : ?Text; truncated : Bool };

  /// Timestamps are as the governance canister reports them (SNS: seconds).
  public type Execution = {
    #pending; // not decided yet
    #not_executed; // rejected, or decided without executing this step
    #in_progress; // adopted, executing
    #executed : Nat64;
    #skipped : Nat64; // the target already ran this hash, nothing was installed
    #failed : { at : Nat64; error : Text };
    #unknown; // the governance reported a state the registry doesn't know
  };

  public type ProposalStep = {
    index : Nat;
    target : ?Principal;
    is_self : Bool; // the governance canister upgrading itself
    role : ?Text;
    artifact : ProposedArtifact;
    source : ?ProposedSource;
    execution : Execution;
  };

  public type ProposalRead = {
    kind : GovernanceKind;
    proposal_kind : ?Text; // e.g. "UpgradeSnsControlledCanister", "ExecuteGenericNervousSystemFunction 7000"
    status : Text; // "open", "adopted", "executed", "failed", "rejected", or the governance's own word
    executed_at : ?Nat64;
    steps : [ProposalStep];
    read_at : Int;
  };

  public type InstallerRole = {
    #governance; // the DAO's governance canister
    #dao_root; // the SNS root of that governance (SNS dapp canisters are installed by root)
    #other_canister;
    #user;
  };

  public type Installer = {
    principal : Principal;
    role : InstallerRole;
    at_ns : Nat64; // the change's timestamp
    canister_version : Nat64;
  };

  public type LiveResult = {
    #live_match;
    #live_mismatch : Text;
    /// frontend steps: the tree hash of the asset canister's `list` (compared per builder)
    #asset_tree : { tree_sha256 : Blob; identity_tree_sha256 : Blob; assets : Nat; encodings : Nat };
    /// a snapshot restore proposes no hash; the module before and after
    #snapshot_restored : { before : ?Blob; after : ?Blob; snapshot_id : ?Blob };
    #not_checked : Text; // failed or not executed step, or nothing to compare with
  };

  public type LiveCheck = {
    at : Int;
    target : ?Principal;
    result : LiveResult;
    compared_with : ?Blob; // the hash the live module was compared with (the proposal's, else the builders')
    module_hash : ?Blob; // the live module hash at check time
    installed_by : ?Installer; // who installed the compared module (the change in canister_info)
    skipped : Bool;
    history_changes : Nat; // changes canister_info returned
    block : ?Nat; // its sneedatt_live_check block
  };

  public type StepStatus = {
    step : Nat;
    proposed : ?ProposalStep; // as read from the proposal (null: not read, or no such step)
    attested_by : Nat; // builders with an attestation for this step (newest each)
    builders_match : Nat; // the builders' own verdicts
    builders_mismatch : Nat;
    builders_cannot : Nat;
    known_match : Nat; // the same, counting only the DAO's known builders
    known_mismatch : Nat;
    known_cannot : Nat;
    /// builders read the proposal differently (more than one proposed_sha256 / proposed_evidence)
    proposed_disagree : Bool;
    builders_live_agree : Nat; // builders whose built hash / tree equals the live check
    builders_live_disagree : Nat;
    live : ?{ #live_match; #live_mismatch : Text }; // the module check, as in the spec's summary
    live_check : ?LiveCheck; // everything the check recorded
    installed_by : ?Principal;
  };

  public type WatchState = {
    #watching;
    #done; // every step is final and checked
    #stopped : Text; // not an upgrade proposal, unreadable, or watched too long
  };

  public type ProposalStatus = {
    governance : Principal;
    proposal_id : Nat64;
    kind : ?GovernanceKind;
    read : ?ProposalRead;
    read_error : ?Text; // the last failed read ("cannot read proposal: ...")
    watch : WatchState;
    next_check_at : ?Int;
    first_attested_at : Int;
    steps : [StepStatus]; // every step read from the proposal or attested
  };

  public type ReleaseStatus = {
    target : Principal;
    module_hash : Blob;
    attestations : [AttestationView];
    live_check : ?LiveCheck;
    next_check_at : ?Int;
  };

  /// Compact summary for proposal lists.
  public type ProposalSummary = {
    governance : Principal;
    proposal_id : Nat64;
    status : ?Text;
    watch : WatchState;
    steps : Nat;
    builders : Nat; // distinct builders over all steps
    builders_match : Nat;
    builders_mismatch : Nat;
    builders_cannot : Nat;
    live_match : Nat; // steps whose live check matched
    live_mismatch : Nat;
  };

  // ---------------------------------------------------------------------------------------------
  // Calls to other DAOs' canisters: the published budget (spec "Calls to other DAOs' canisters")
  // ---------------------------------------------------------------------------------------------

  public type MethodUse = { canister : Text; method : Text; when : Text; billed_to_dao : Bool };

  public type DaoUsage = {
    governance : Principal;
    kind : ?GovernanceKind;
    sns_root : ?Principal;
    calls_this_hour : Nat;
    calls_total : Nat;
    throttled_hours : Nat; // hour windows in which the cap was reached
    backoff_until : ?Int; // no calls to this DAO before this time
    watched_proposals : Nat;
  };

  public type CallBudget = {
    calls_per_hour_per_dao : Nat;
    max_in_flight : Nat;
    principals : [(Text, Text)]; // network -> registry canister id
    methods : [MethodUse];
    estimate : Text;
    daos : [DaoUsage];
  };

  // ---------------------------------------------------------------------------------------------
  // Configuration (controllers only; nothing here can alter an attestation)
  // ---------------------------------------------------------------------------------------------

  public type Config = {
    paused : Bool; // no polling (attesting still works)
    tick_s : Nat;
    max_in_flight : Nat;
    max_calls_per_tick : Nat;
    calls_per_hour_per_dao : Nat;
    max_backoff_s : Nat;
    poll_open_s : Nat; // proposal reads while voting is open
    poll_executing_s : Nat; // proposal reads once decided, until every step is final
    max_watch_s : Nat; // stop watching a proposal that stays open longer
    max_read_failures : Nat;
    max_subjects : Nat;
    max_attestations : Nat; // stored (newest versions), all subjects together
    max_builders_per_subject : Nat;
    max_versions_per_builder : Nat;
    max_steps : Nat;
    max_asset_entries : Nat;
    max_asset_pages : Nat;
    max_known_builders : Nat;
    max_known_lists : Nat;
    min_cycles : Nat; // no outbound calls below this balance
    sns_wasm : Principal; // SNS-W, to learn the SNS root of a governance (installer role)
    archive_controllers : [Principal]; // co-controllers of the ICRC-3 archives
  };

  public type ConfigUpdate = {
    paused : ?Bool;
    tick_s : ?Nat;
    max_in_flight : ?Nat;
    max_calls_per_tick : ?Nat;
    calls_per_hour_per_dao : ?Nat;
    max_backoff_s : ?Nat;
    poll_open_s : ?Nat;
    poll_executing_s : ?Nat;
    max_watch_s : ?Nat;
    max_read_failures : ?Nat;
    max_subjects : ?Nat;
    max_attestations : ?Nat;
    max_builders_per_subject : ?Nat;
    max_versions_per_builder : ?Nat;
    max_steps : ?Nat;
    max_asset_entries : ?Nat;
    max_asset_pages : ?Nat;
    max_known_builders : ?Nat;
    max_known_lists : ?Nat;
    min_cycles : ?Nat;
    sns_wasm : ?Principal;
    archive_controllers : ?[Principal];
  };

  public type Limits = {
    max_text_repo : Nat;
    max_text_commit : Nat;
    max_text_recipe : Nat;
    max_text_environment : Nat;
    max_text_url : Nat;
    max_text_reason : Nat;
    max_text_name : Nat;
    max_text_description : Nat;
    max_embedded : Nat;
    hash_bytes : Nat;
  };

  public type Stats = {
    subjects : Nat;
    attestations : Nat; // stored (newest versions)
    attestations_ever : Nat;
    builders : Nat;
    proposals_watched : Nat;
    proposals_total : Nat;
    releases : Nat;
    live_checks : Nat;
    calls : [(Text, Nat)]; // per method: calls made
    call_errors : Nat;
    ticks : Nat;
    last_tick_at : ?Int;
    cycles : Nat;
  };

  public type LogEntry = { id : Nat; ts : Int; level : { #info; #error }; cid : Nat; caller : Principal; message : Text };

  public type Result<T> = { #ok : T; #err : Text };
};
