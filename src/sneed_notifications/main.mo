import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Debug "mo:base/Debug";
import Error "mo:base/Error";
import Int "mo:base/Int";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Random "mo:base/Random";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Timer "mo:base/Timer";
import Map "mo:map/Map";

import IngressGuard "../IngressGuard";
import ApiDoc "ApiDoc";
import Control "../sneed_names/Control";
import SnsDirectory "../sneed_names/SnsDirectory";
import TextLog "../sneed_names/TextLog";
import NT "../sneed_names/Types";
import Icrc3Log "../icrc3/Log";
import T3 "../icrc3/Types";
import T "Types";
import LedgerBlock "LedgerBlock";

/// sneed_notifications (spec/sneed_notifications.md), step 1: apps declare topics, users allow
/// apps and choose channels and rules, apps call `notify`, and messages wait here until they are
/// delivered: Sneed SMS by this canister, the other channels by relays that pull jobs and report
/// back. Users pay for their deliveries (a dapp may sponsor a message); caps per app protect them.
shared (deployer) persistent actor class SneedNotifications() = this {

  // ---------------------------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------------------------

  public type Level = T.Level;
  public type ChannelKind = T.ChannelKind;
  public type Channel = T.Channel;
  public type Topic = T.Topic;
  public type App = T.App;
  public type AppInput = T.AppInput;
  public type Permission = T.Permission;
  public type TopicRule = T.TopicRule;
  public type Settings = T.Settings;
  public type QuietHours = T.QuietHours;
  public type NotifyInput = T.NotifyInput;
  public type NotifyResult = T.NotifyResult;
  public type Job = T.Job;
  public type JobState = T.JobState;
  public type RelayJob = T.RelayJob;
  public type Receipt = T.Receipt;
  public type HistoryItem = T.HistoryItem;
  public type Config = T.Config;
  public type Result = T.Result;
  public type ResultNat = T.ResultNat;
  public type Account = T.Account;
  public type FeeForwarding = T.FeeForwarding;
  public type TopUp = T.TopUp;
  public type AdminUserView = T.AdminUserView;

  type Notification = {
    id : Nat;
    app : Nat;
    user : Principal;
    topic : Text;
    title : Text;
    body : Text;
    link : ?Text;
    level : Level;
    created_at : Int;
    jobs : [Nat];
  };

  type TransferFromError = {
    #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat };
    #InsufficientAllowance : { allowance : Nat }; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text };
  };
  type IcpLedger = actor {
    icrc2_transfer_from : shared ({ spender_subaccount : ?Blob; from : Account; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 }) -> async { #Ok : Nat; #Err : TransferFromError };
    icrc1_balance_of : shared query Account -> async Nat;
    icrc1_transfer : shared ({ from_subaccount : ?Blob; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 }) -> async { #Ok : Nat; #Err : TransferError };
  };
  type TransferError = {
    #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat };
    #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text };
  };
  type SmsError = { #Unauthorized : Text; #NotFound : Text; #InvalidInput : Text; #RateLimited : Text; #AlreadyExists : Text };
  type Sms = actor {
    send_system_notification : shared ({ recipients : [Principal]; subject : Text; body : Text }) -> async { #ok : Nat; #err : SmsError };
  };

  // ---------------------------------------------------------------------------------------------
  // State (enhanced orthogonal persistence)
  // ---------------------------------------------------------------------------------------------

  let DAY_NS : Nat = 86_400_000_000_000;
  // A verification code goes to whatever address the user typed, so both guessing it and asking for
  // new ones are limited: otherwise the relays could be used to message someone over and over.
  let MAX_CODE_MISSES : Nat = 5;
  let MAX_CHANNEL_ADDS_PER_DAY : Nat = 5;
  // Below this balance a user is told once (free) that paid deliveries will stop; 0 turns it off.
  let DEFAULT_LOW_BALANCE_E8S : Nat = 10_000;
  let MAX_NAME = 64;
  let MAX_DESCRIPTION = 500;
  let MAX_TOPICS = 50;
  let MAX_CANISTERS = 20;
  let MAX_CHANNELS = 20;
  let MAX_ADDRESS = 2_048;
  let MAX_LINK = 512;
  let MAX_BATCH = 100;
  let MAX_REQUESTS = 50;
  let SYSTEM_APP : Nat = 0; // "Sneed Notifications" itself: channel verification codes

  var config : Config = {
    icp_ledger = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
    sneed_sms = Principal.fromText("zelpl-7yaaa-aaaad-abtcq-cai");
    sns_wasm = Principal.fromText(SnsDirectory.SNS_W_MAINNET);
    prices_e8s = [(#sneed_sms, 0), (#push, 100), (#discord, 100), (#telegram, 100), (#email, 1_000), (#sms, 1_000_000)];
    notify_price_e8s = 0;
    dedupe_window_ns = 3_600_000_000_000;
    retention_ns = 30 * 86_400_000_000_000;
    default_daily_cap = 20;
    default_daily_spend_cap_e8s = 100_000;
    max_title = 200;
    max_body = 2_000;
    relays = [];
    relay_lease_ns = 600_000_000_000;
    max_attempts = 5;
  };
  var admins : [Principal] = [];

  // One-time bootstrap (2026-10-20): since #417 made SNS root the only controller, nobody could make
  // admin calls (admins are controllers plus this list, which was empty). This upgrade puts one
  // maintainer on the list; a later upgrade removes this hook, and the list keeps the entry.
  transient let BOOTSTRAP_ADMIN = Principal.fromText("d7zib-qo5mr-qzmpb-dtyof-l7yiu-pu52k-wk7ng-cbm3n-ffmys-crbkz-nae");
  system func postupgrade() {
    if (Array.find<Principal>(admins, func(a) = a == BOOTSTRAP_ADMIN) == null) {
      admins := Array.append(admins, [BOOTSTRAP_ADMIN]);
      block("admin_add", #upgrade, [("principal", pv(BOOTSTRAP_ADMIN))]);
    };
    Icrc3Log.certify(icrc3);
    ensure_icrc3_timer<system>();
    seedTopUpRecords();
  };
  /// Each relay kind's public key (base64 SPKI, RSA-OAEP-256): clients encrypt addresses to it.
  var relay_keys : [(ChannelKind, Text)] = [];

  let apps = Map.new<Nat, App>();
  var next_app_id : Nat = 1;
  let app_of_canister = Map.new<Principal, Nat>();
  let app_balances = Map.new<Nat, Nat>();

  let channels = Map.new<Principal, [Channel]>();
  var next_channel_id : Nat = 1;
  let codes = Map.new<Nat, (Text, Int)>(); // channel -> (verification code, expires)
  let code_misses = Map.new<Nat, Nat>(); // channel -> wrong codes entered (MAX_CODE_MISSES ends the code)
  let channel_adds = Map.new<Principal, (Nat, Nat)>(); // user -> (day, channels added that day)
  let settings = Map.new<Principal, Settings>();
  let user_balances = Map.new<Principal, Nat>();
  let low_balance = Map.new<Principal, (Nat, Bool)>(); // user -> (alert threshold, already alerted); absent: default, not alerted
  let permissions = Map.new<Text, Permission>(); // "user/app"
  let requests = Map.new<Principal, [Nat]>();
  let usage = Map.new<Text, (Nat, Nat, Nat)>(); // "user/app" -> (day, messages, spent e8s)
  let dedupes = Map.new<Text, Int>(); // "user/app/key" -> last notified

  let notifications = Map.new<Nat, Notification>();
  var next_notification_id : Nat = 1;
  let user_notifications = Map.new<Principal, [Nat]>();
  let jobs = Map.new<Nat, Job>();
  var next_job_id : Nat = 1;
  let pending = Map.new<Nat, ()>(); // jobs not final yet

  let sns : SnsDirectory.State = SnsDirectory.init();

  transient var ticking = false;
  transient var ticks : Nat = 0;

  // Revenue forwarding (added 2026-10-21; spec §"Revenue"). Prices deducted from balances are the
  // DAO's revenue: they go to `fee_destination` (the RLL ICP splitter, where Sneed Premium, Sneedex
  // and Sneed Lock pay too) once `fee_sweep_threshold_e8s` has accumulated. Balances are never
  // touched: every transfer leaves the ledger balance at or above the liabilities.
  var fee_destination : ?Account = ?{ owner = Principal.fromText("6jvpj-sqaaa-aaaaj-azwnq-cai"); subaccount = ?Blob.fromArray([1, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) };
  var fee_sweep_threshold_e8s : Nat = 10_000_000; // 0.1 ICP
  var fee_ledger_fee_e8s : Nat = 10_000; // updated from the ledger's BadFee answer
  var fees_earned_e8s : Nat = 0;
  var fees_refunded_e8s : Nat = 0;
  var fees_forwarded_e8s : Nat = 0;
  var fees_ledger_fees_e8s : Nat = 0;
  var fee_forwards : Nat = 0;
  var fees_backlog_e8s : ?Nat = null;
  /// The books' starting point: the free ICP (ledger balance − liabilities) measured at the first
  /// attempt, with the counters as they were then. What may go out later is that plus what the
  /// counters added since (re-measured whenever the ledger shows less).
  var fee_base : ?{ free : Nat; earned : Nat; refunded : Nat; reserved : Nat; out : Nat; at : Int } = null;
  /// A transfer whose outcome is unknown (the call failed in flight): retried with the same arguments,
  /// which the ledger deduplicates, so it goes out at most once.
  var fee_pending : ?{ to : Account; amount : Nat; fee : Nat; memo : Blob; created_at_time : Nat64 } = null;
  var fee_last_forward : ?{ at : Int; amount_e8s : Nat; block : Nat; to : Account } = null;
  var fee_last_error : ?Text = null;
  var fee_events : [(Int, Text)] = [];
  var fee_last_check : Int = 0;
  transient var fee_forwarding = false;
  transient var fee_next_check : Int = 0; // 0 after an install or upgrade: the first tick checks
  transient var pulling_e8s : Nat = 0; // top-ups the ledger may have moved but this canister hasn't credited yet
  transient let FEE_CHECK_NS : Int = 300_000_000_000; // every 5 minutes at most

  // Support (spec/support_audit.md P0-8, P1-9, P2-19). Every ICP payment credited here, per payer
  // (newest last, at most MAX_TOP_UPS kept) and by ledger block ("ledger/block" -> who was
  // credited), so admin_credit can never credit a block twice. Top-ups since the ICRC-3 log are
  // filled in from its blocks on upgrade; `topup_records_since` is when the records begin: a block
  // older than that may have been credited without a record, so admin_credit refuses it.
  let top_ups = Map.new<Principal, [TopUp]>();
  let credited_blocks = Map.new<Text, Principal>();
  var topup_records_since : Int = Time.now();
  var topup_records_seeded : Bool = false;
  transient let crediting = Map.new<Text, ()>(); // admin_credit calls in flight, by block
  transient let MAX_TOP_UPS : Nat = 100;
  // apps admins removed, kept so their owners can still claim the app balance
  let removed_apps = Map.new<Nat, App>();
  // when the delivery timer last ran (shown by stats)
  var last_tick_at : Int = 0;

  // ---------------------------------------------------------------------------------------------
  // ICRC-3 activity log (spec/notifications_icrc3.md; library src/icrc3): money (top-ups, refunds,
  // fee forwarding, the backlog measurement) and governance (apps, admins, configuration). Never
  // what was sent to whom: no notification contents, titles, channels, addresses or deliveries.
  // Enhanced orthogonal persistence: new stable variables, so the upgrade starts an empty log.
  // ---------------------------------------------------------------------------------------------

  var icrc3 : Icrc3Log.State = Icrc3Log.init();
  transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();
  // operational messages of the log (spills, archive creation, failures); admins read them with get_log
  let icrc3_textlog : TextLog.State = TextLog.init();
  transient let SNEED_SNS_ROOT : Principal = Principal.fromText("fp274-iaaaa-aaaaq-aacha-cai");

  transient let icrc3_catalogue : Icrc3Log.Config = {
    block_types_url = "https://app.sneeddao.com/api/sneed_notifications#block-types";
    block_types = [
      "sneednotif_top_up",
      "sneednotif_app_top_up",
      "sneednotif_refund",
      "sneednotif_fee_forward",
      "sneednotif_fee_backlog",
      "sneednotif_fee_remeasure",
      "sneednotif_app_register",
      "sneednotif_app_update",
      "sneednotif_app_remove",
      "sneednotif_app_verify",
      "sneednotif_admin_add",
      "sneednotif_admin_remove",
      "sneednotif_config_update",
      "sneednotif_admin_credit",
      "sneednotif_app_balance_claim",
    ];
  };

  func icrc3_self() : Principal = Principal.fromActor(this);

  func icrc3_env() : Icrc3Log.Environment {
    {
      self = icrc3_self();
      archive_controllers = [SNEED_SNS_ROOT]; // added next to this canister on every archive
      cycle_reserve = 2_000_000_000_000; // never spend the balance below 2 T
      new_correlation_id = func() : Nat = TextLog.correlationId(icrc3_textlog);
      log_info = func(cid : Nat, m : Text) = TextLog.add(icrc3_textlog, #info, cid, icrc3_self(), m);
      log_error = func(cid : Nat, m : Text) = TextLog.add(icrc3_textlog, #error, cid, icrc3_self(), m);
    };
  };

  /// Who made a logged change: a call (its caller), the canister's timer, or the upgrade itself.
  type By = { #caller : Principal; #timer; #upgrade };

  /// Appends one block `sneednotif_<btype>`: `caller` first, or `via` = "timer" / "upgrade".
  func block(btype : Text, by : By, tx : [(Text, T3.Value)]) {
    let who : (Text, T3.Value) = switch by {
      case (#caller(p)) ("caller", Icrc3Log.principal(p));
      case (#timer) ("via", #Text("timer"));
      case (#upgrade) ("via", #Text("upgrade"));
    };
    ignore Icrc3Log.append(icrc3, "sneednotif_" # btype, Int.abs(Time.now()), Array.append<(Text, T3.Value)>([who], tx));
  };

  /// One `config_update` block, only when the value changed.
  func configBlock(by : By, key : Text, old : T3.Value, new : T3.Value) {
    if (old != new) block("config_update", by, [("key", #Text(key)), ("old_value", old), ("value", new)]);
  };
  func configBlocks(by : By, old : [(Text, T3.Value)], new : [(Text, T3.Value)]) {
    var i = 0;
    while (i < old.size() and i < new.size()) { configBlock(by, old[i].0, old[i].1, new[i].1); i += 1 };
  };

  func pv(p : Principal) : T3.Value = Icrc3Log.principal(p);
  func accountV(a : Account) : T3.Value = Icrc3Log.account(a.owner, a.subaccount);
  func optAccountV(a : ?Account) : T3.Value = switch a { case (?x) accountV(x); case null #Text("none") };
  func principalsV(ps : [Principal]) : T3.Value = #Array(Array.map<Principal, T3.Value>(ps, pv));
  func kindText(k : ChannelKind) : Text = switch k {
    case (#sneed_sms) "sneed_sms"; case (#push) "push"; case (#discord) "discord";
    case (#telegram) "telegram"; case (#email) "email"; case (#sms) "sms";
  };
  func levelText(l : Level) : Text = switch l { case (#urgent) "urgent"; case (#normal) "normal"; case (#info) "info" };
  /// Topic ids, titles and levels (descriptions are left out: long, and in get_app).
  func topicsV(ts : [Topic]) : T3.Value = #Array(Array.map<Topic, T3.Value>(ts, func(t) = #Map([("id", #Text(t.id)), ("title", #Text(t.title)), ("level", #Text(levelText(t.level)))])));
  func appTx(a : App) : [(Text, T3.Value)] = [("app_id", #Nat(a.id)), ("name", #Text(a.name)), ("owner", pv(a.owner)), ("canisters", principalsV(a.canisters)), ("topics", topicsV(a.topics))];

  /// The configuration as logged: one entry per field, in a fixed order (configBlocks pairs them up).
  func configValues(c : Config) : [(Text, T3.Value)] = [
    ("icp_ledger", pv(c.icp_ledger)),
    ("sneed_sms", pv(c.sneed_sms)),
    ("sns_wasm", pv(c.sns_wasm)),
    ("prices_e8s", #Map(Array.map<(ChannelKind, Nat), (Text, T3.Value)>(c.prices_e8s, func((k, p)) = (kindText(k), #Nat(p))))),
    ("notify_price_e8s", #Nat(c.notify_price_e8s)),
    ("dedupe_window_ns", #Nat(c.dedupe_window_ns)),
    ("retention_ns", #Nat(c.retention_ns)),
    ("default_daily_cap", #Nat(c.default_daily_cap)),
    ("default_daily_spend_cap_e8s", #Nat(c.default_daily_spend_cap_e8s)),
    ("max_title", #Nat(c.max_title)),
    ("max_body", #Nat(c.max_body)),
    ("relays", #Array(Array.map<(Principal, ChannelKind), T3.Value>(c.relays, func((p, k)) = #Array([pv(p), #Text(kindText(k))])))),
    ("relay_lease_ns", #Nat(c.relay_lease_ns)),
    ("max_attempts", #Nat(c.max_attempts)),
  ];

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  func now() : Int = Time.now();
  func trap(m : Text) : None = Debug.trap(m);
  func isAdmin(p : Principal) : Bool = Principal.isController(p) or Array.find<Principal>(admins, func(a) = a == p) != null;
  func key(user : Principal, app : Nat) : Text = Principal.toText(user) # "/" # Nat.toText(app);
  func day() : Nat = Int.abs(now()) / DAY_NS;

  func priceOf(kind : ChannelKind) : Nat {
    for ((k, p) in config.prices_e8s.vals()) if (k == kind) return p;
    0;
  };

  func relayKind(p : Principal) : ?ChannelKind {
    for ((r, k) in config.relays.vals()) if (r == p) return ?k;
    null;
  };

  func appOfCaller(caller : Principal) : ?App = switch (Map.get(app_of_canister, Map.phash, caller)) {
    case (?id) Map.get(apps, Map.nhash, id);
    case null null;
  };

  func userChannels(user : Principal) : [Channel] = switch (Map.get(channels, Map.phash, user)) { case (?c) c; case null [] };

  /// Every user has a Sneed SMS channel (their inbox); it is made on first use.
  func smsChannel(user : Principal) : Channel {
    for (c in userChannels(user).vals()) if (c.kind == #sneed_sms) return c;
    let c : Channel = { id = next_channel_id; kind = #sneed_sms; name = "Sneed SMS"; address = ""; state = #verified; created_at = now() };
    next_channel_id += 1;
    Map.set(channels, Map.phash, user, Array.append(userChannels(user), [c]));
    c;
  };

  func settingsOf(user : Principal) : Settings = switch (Map.get(settings, Map.phash, user)) {
    case (?s) s;
    case null ({ defaults = { urgent = []; normal = []; info = [] }; always_copy = ?smsChannel(user).id; quiet = null; snooze_until = null });
  };

  func defaultPermission() : Permission = {
    allowed = true; demote = false; copy_only = false; muted_until = null;
    daily_cap = config.default_daily_cap; daily_spend_cap_e8s = config.default_daily_spend_cap_e8s; topics = [];
  };

  func balanceOf(user : Principal) : Nat = switch (Map.get(user_balances, Map.phash, user)) { case (?b) b; case null 0 };
  func appBalanceOf(app : Nat) : Nat = switch (Map.get(app_balances, Map.nhash, app)) { case (?b) b; case null 0 };

  func down(l : Level) : Level = switch l { case (#urgent) #normal; case (#normal) #info; case (#info) #info };

  func ownsChannels(user : Principal, ids : [Nat]) : Bool {
    let mine = userChannels(user);
    for (id in ids.vals()) if (Array.find<Channel>(mine, func(c) = c.id == id) == null) return false;
    true;
  };

  func validLink(l : ?Text) : Bool = switch l {
    case null true;
    case (?u) u.size() <= MAX_LINK and Text.startsWith(u, #text "https://");
  };

  /// The end of the user's quiet hours if `t` falls inside them, else null.
  func quietUntil(q : QuietHours, t : Int) : ?Int {
    let minute : Int = 60_000_000_000;
    let local = t + q.utc_offset_min * minute;
    let minOfDay = Int.abs(local / minute) % 1440;
    let (s, e) = (q.start_min % 1440, q.end_min % 1440);
    let inside = if (s <= e) minOfDay >= s and minOfDay < e else minOfDay >= s or minOfDay < e;
    if (not inside) return null;
    let wait = if (minOfDay < e) e - minOfDay else 1440 - minOfDay + e;
    ?(t + wait * minute);
  };

  // ---------------------------------------------------------------------------------------------
  // Apps
  // ---------------------------------------------------------------------------------------------

  func checkAppInput(a : AppInput) : ?Text {
    if (a.name.size() == 0 or a.name.size() > MAX_NAME) return ?"A name of 1 to 64 characters";
    if (a.description.size() > MAX_DESCRIPTION) return ?"The description is at most 500 characters";
    if (not validLink(a.logo)) return ?"The logo must be an https link of at most 512 characters";
    if (a.canisters.size() == 0 or a.canisters.size() > MAX_CANISTERS) return ?"1 to 20 canisters";
    if (a.topics.size() == 0 or a.topics.size() > MAX_TOPICS) return ?"1 to 50 topics";
    for (t in a.topics.vals()) {
      if (t.id.size() == 0 or t.id.size() > 64 or t.title.size() > 100 or t.description.size() > 300) return ?"Topic ids up to 64, titles up to 100, descriptions up to 300 characters";
      if (Array.filter<Topic>(a.topics, func(x) = x.id == t.id).size() > 1) return ?("Topic " # t.id # " is listed twice");
    };
    null;
  };

  /// Register an app: the caller must control each listed canister (or be the governance of an
  /// SNS whose root controls it). Those canisters may then call `notify`.
  public shared ({ caller }) func register_app(input : AppInput) : async ResultNat {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    switch (checkAppInput(input)) { case (?e) return #err(e); case null {} };
    for (c in input.canisters.vals()) {
      if (Map.has(app_of_canister, Map.phash, c)) return #err(Principal.toText(c) # " already belongs to an app");
      if (c != caller) switch (await* Control.controls(sns, config.sns_wasm, caller, c)) { case (#err(e)) return #err(e); case (#ok) {} };
    };
    for (c in input.canisters.vals()) if (Map.has(app_of_canister, Map.phash, c)) return #err(Principal.toText(c) # " already belongs to an app");
    let id = next_app_id;
    next_app_id += 1;
    let app : App = { id; name = input.name; logo = input.logo; description = input.description; owner = caller; canisters = input.canisters; topics = input.topics; verified = false; created_at = now() };
    Map.set(apps, Map.nhash, id, app);
    for (c in input.canisters.vals()) Map.set(app_of_canister, Map.phash, c, id);
    block("app_register", #caller(caller), Array.append(appTx(app), [("verified", #Nat(0))]));
    #ok(id);
  };

  /// Admins register an app for canisters a DAO controls (e.g. Sneed Hub's forum), with the DAO's
  /// governance as owner.
  public shared ({ caller }) func admin_register_app(owner : Principal, input : AppInput) : async ResultNat {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (checkAppInput(input)) { case (?e) return #err(e); case null {} };
    for (c in input.canisters.vals()) if (Map.has(app_of_canister, Map.phash, c)) return #err(Principal.toText(c) # " already belongs to an app");
    let id = next_app_id;
    next_app_id += 1;
    let app : App = { id; name = input.name; logo = input.logo; description = input.description; owner; canisters = input.canisters; topics = input.topics; verified = true; created_at = now() };
    Map.set(apps, Map.nhash, id, app);
    for (c in input.canisters.vals()) Map.set(app_of_canister, Map.phash, c, id);
    block("app_register", #caller(caller), Array.append(appTx(app), [("verified", #Nat(1))]));
    #ok(id);
  };

  /// The owner (or an admin) changes an app's name, topics or canisters. A canister new to the app
  /// must be controlled by the caller, except for admins, who may already register any canister
  /// (admin_register_app): e.g. adding a DAO canister such as Sneed SMS to Sneed Hub.
  public shared ({ caller }) func update_app(id : Nat, input : AppInput) : async Result {
    let a = switch (Map.get(apps, Map.nhash, id)) { case (?a) a; case null return #err("No such app") };
    if (caller != a.owner and not isAdmin(caller)) return #err("Only the app's owner");
    switch (checkAppInput(input)) { case (?e) return #err(e); case null {} };
    for (c in input.canisters.vals()) {
      switch (Map.get(app_of_canister, Map.phash, c)) { case (?other) if (other != id) return #err(Principal.toText(c) # " belongs to another app"); case null {} };
      if (Array.find<Principal>(a.canisters, func(x) = x == c) == null and c != caller and not isAdmin(caller)) switch (await* Control.controls(sns, config.sns_wasm, caller, c)) { case (#err(e)) return #err(e); case (#ok) {} };
    };
    let cur = switch (Map.get(apps, Map.nhash, id)) { case (?a) a; case null return #err("No such app") };
    for (c in input.canisters.vals()) switch (Map.get(app_of_canister, Map.phash, c)) { case (?other) if (other != id) return #err(Principal.toText(c) # " belongs to another app"); case null {} };
    for (c in cur.canisters.vals()) Map.delete(app_of_canister, Map.phash, c);
    for (c in input.canisters.vals()) Map.set(app_of_canister, Map.phash, c, id);
    let next : App = { cur with name = input.name; logo = input.logo; description = input.description; canisters = input.canisters; topics = input.topics };
    Map.set(apps, Map.nhash, id, next);
    // logged only when something changed: the new name, canisters and topics, the old ones that changed
    let changed = Buffer.Buffer<T3.Value>(5);
    let old = Buffer.Buffer<(Text, T3.Value)>(3);
    if (cur.name != next.name) { changed.add(#Text("name")); old.add(("old_name", #Text(cur.name))) };
    if (cur.logo != next.logo) changed.add(#Text("logo"));
    if (cur.description != next.description) changed.add(#Text("description"));
    if (cur.canisters != next.canisters) { changed.add(#Text("canisters")); old.add(("old_canisters", principalsV(cur.canisters))) };
    if (cur.topics != next.topics) { changed.add(#Text("topics")); old.add(("old_topics", topicsV(cur.topics))) };
    if (changed.size() > 0) block("app_update", #caller(caller), Array.flatten<(Text, T3.Value)>([appTx(next), [("changed", #Array(Buffer.toArray(changed)))], Buffer.toArray(old)]));
    #ok("Updated");
  };

  /// Fund an app's balance (for sponsored messages). Anyone may: ICP by ICRC-2 approval.
  public shared ({ caller }) func top_up_app(id : Nat, amount_e8s : Nat) : async ResultNat {
    if (not Map.has(apps, Map.nhash, id)) return #err("No such app");
    let ledger_block = switch (await* pull(caller, amount_e8s, APP_TOP_UP_MEMO)) { case (#err(e)) return #err(e); case (#ok(b)) b };
    // an admin may have credited this very block while the ledger call was in flight
    if (Map.has(credited_blocks, Map.thash, blockKey(ledger_block))) return #ok(appBalanceOf(id));
    let b = appBalanceOf(id) + amount_e8s;
    Map.set(app_balances, Map.nhash, id, b);
    recordTopUp(caller, { ledger_block; amount_e8s; at = now(); app = ?id; via = #app_top_up });
    block("app_top_up", #caller(caller), [("app_id", #Nat(id)), ("amount_e8s", #Nat(amount_e8s)), ("ledger_block", #Nat(ledger_block)), ("app_balance_e8s", #Nat(b))]);
    #ok(b);
  };

  /// An app asks a user to allow it; the request shows in the user's notification centre.
  public shared ({ caller }) func request_permission(user : Principal) : async Result {
    let a = switch (appOfCaller(caller)) { case (?a) a; case null return #err("Not a registered app canister") };
    if (Map.has(permissions, Map.thash, key(user, a.id))) return #ok("Already decided by the user");
    let mine = switch (Map.get(requests, Map.phash, user)) { case (?r) r; case null [] };
    if (Array.find<Nat>(mine, func(x) = x == a.id) != null) return #ok("Already asked");
    if (mine.size() >= MAX_REQUESTS) return #err("The user has too many open requests");
    Map.set(requests, Map.phash, user, Array.append(mine, [a.id]));
    #ok("Asked");
  };

  // ---------------------------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------------------------

  func newJob(n : Nat, user : Principal, c : Channel, notBefore : Int, price : Nat, byApp : Bool) : Nat {
    let id = next_job_id;
    next_job_id += 1;
    Map.set(jobs, Map.nhash, id, { id; notification = n; user; channel = c.id; kind = c.kind; not_before = notBefore; price_e8s = price; paid_by_app = byApp; attempts = 0; state = #queued });
    Map.set(pending, Map.nhash, id, ());
    id;
  };

  func suppressedJob(n : Nat, user : Principal, c : Channel, reason : Text) : Nat {
    let id = next_job_id;
    next_job_id += 1;
    Map.set(jobs, Map.nhash, id, { id; notification = n; user; channel = c.id; kind = c.kind; not_before = now(); price_e8s = 0; paid_by_app = false; attempts = 0; state = #suppressed({ reason }) });
    id;
  };

  func record(n : Notification) {
    Map.set(notifications, Map.nhash, n.id, n);
    let list = switch (Map.get(user_notifications, Map.phash, n.user)) { case (?l) l; case null [] };
    Map.set(user_notifications, Map.phash, n.user, Array.append(list, [n.id]));
  };

  /// No echoes: a canister this service delivers through never gets its own messages back. A
  /// notification from the configured Sneed SMS canister (e.g. "new direct message") is never
  /// delivered to #sneed_sms channels, neither the chosen ones nor the always-copy one: that copy
  /// would be one more message in the same inbox, and a loop if SMS notified for it. The rule
  /// keys on the calling canister, so it holds whatever topic or app the canister is listed under.
  func echoKind(caller : Principal) : ?ChannelKind = if (caller == config.sneed_sms) ?#sneed_sms else null;

  func notifyOne(a : App, input : NotifyInput, skip : ?ChannelKind) : NotifyResult {
    if (input.title.size() == 0 or input.title.size() > config.max_title) return #err(#invalid("A title of 1 to " # Nat.toText(config.max_title) # " characters"));
    if (input.body.size() > config.max_body) return #err(#invalid("The body is at most " # Nat.toText(config.max_body) # " characters"));
    if (not validLink(input.link)) return #err(#invalid("Links must be https and at most 512 characters"));
    let topic = switch (Array.find<Topic>(a.topics, func(t) = t.id == input.topic)) { case (?t) t; case null return #err(#unknown_topic) };
    let user = input.user;
    let perm = switch (Map.get(permissions, Map.thash, key(user, a.id))) { case (?p) p; case null return #err(#not_allowed) };
    if (not perm.allowed) return #err(#not_allowed);
    let t = now();

    // the user's cap for this app
    let k = key(user, a.id);
    let (uDay, count, spent) = switch (Map.get(usage, Map.thash, k)) { case (?(d, c, s)) if (d == day()) (d, c, s) else (day(), 0, 0); case null (day(), 0, 0) };
    if (count >= perm.daily_cap) return #err(#rate_limited);

    // the same message again within the window is folded (recorded below, once the message is accepted)
    let dedupeKey : ?Text = switch (input.dedupe) { case (?d) ?(k # "/" # d); case null null };
    switch (dedupeKey) {
      case (?dk) switch (Map.get(dedupes, Map.thash, dk)) {
        case (?last) if (t - last < config.dedupe_window_ns) return #ok({ id = 0; deliveries = 0; deduplicated = true });
        case null {};
      };
      case null {};
    };

    // which channels
    let s = settingsOf(user);
    let rule = Array.find<(Text, TopicRule)>(perm.topics, func((id, _)) = id == topic.id);
    var level = if (perm.demote) down(topic.level) else topic.level;
    var muted = false;
    var explicit : ?[Nat] = null;
    switch (rule) {
      case (?(_, #mute)) muted := true;
      case (?(_, #level(l))) level := l;
      case (?(_, #channels(cs))) explicit := ?cs;
      case null {};
    };
    let paused = (switch (s.snooze_until) { case (?u) t < u; case null false }) or (switch (perm.muted_until) { case (?u) t < u; case null false });
    let chosen : [Nat] = if (muted) [] else if (perm.copy_only or paused) [] else switch explicit {
      case (?cs) cs;
      case null switch level { case (#urgent) s.defaults.urgent; case (#normal) s.defaults.normal; case (#info) s.defaults.info };
    };
    let copy : [Nat] = if (muted) [] else switch (s.always_copy) { case (?c) [c]; case null [] };
    let wanted = Buffer.Buffer<Channel>(4);
    for (c in userChannels(user).vals()) {
      let inSet = Array.find<Nat>(chosen, func(x) = x == c.id) != null or Array.find<Nat>(copy, func(x) = x == c.id) != null;
      if (inSet and c.state == #verified and ?c.kind != skip) wanted.add(c);
    };

    // payment: the app if sponsored (all or nothing), else the user, channel by channel
    var total = config.notify_price_e8s;
    for (c in wanted.vals()) total += priceOf(c.kind);
    if (input.sponsored and appBalanceOf(a.id) < total) return #err(#no_funds);
    // a refused message must not fold its retry
    switch (dedupeKey) { case (?dk) Map.set(dedupes, Map.thash, dk, t); case null {} };

    let id = next_notification_id;
    next_notification_id += 1;
    let quiet : ?Int = switch (s.quiet) {
      case (?q) if (level == #urgent and q.urgent_passes) null else quietUntil(q, t);
      case null null;
    };
    let jobIds = Buffer.Buffer<Nat>(wanted.size());
    var userSpent = spent;
    var appSpent = 0;
    var balance = balanceOf(user);
    if (not input.sponsored and config.notify_price_e8s > 0 and balance >= config.notify_price_e8s and userSpent + config.notify_price_e8s <= perm.daily_spend_cap_e8s) {
      balance -= config.notify_price_e8s;
      userSpent += config.notify_price_e8s;
    };
    for (c in wanted.vals()) {
      let price = priceOf(c.kind);
      let notBefore = switch (quiet) { case (?u) if (c.kind == #sneed_sms) t else u; case null t };
      if (input.sponsored) {
        appSpent += price;
        jobIds.add(newJob(id, user, c, notBefore, price, true));
      } else if (price == 0) {
        jobIds.add(newJob(id, user, c, notBefore, 0, false));
      } else if (balance < price) {
        jobIds.add(suppressedJob(id, user, c, "not enough balance"));
      } else if (userSpent + price > perm.daily_spend_cap_e8s) {
        jobIds.add(suppressedJob(id, user, c, "daily spending cap for this app"));
      } else {
        balance -= price;
        userSpent += price;
        jobIds.add(newJob(id, user, c, notBefore, price, false));
      };
    };
    if (input.sponsored) {
      Map.set(app_balances, Map.nhash, a.id, appBalanceOf(a.id) - (appSpent + config.notify_price_e8s));
      fees_earned_e8s += appSpent + config.notify_price_e8s;
    } else fees_earned_e8s += balanceOf(user) - balance;
    Map.set(user_balances, Map.phash, user, balance);
    if (not input.sponsored and (userSpent > spent or Array.find<Nat>(Buffer.toArray(jobIds), func(j) = isSuppressedForBalance(j)) != null)) lowBalanceCheck(user);
    Map.set(usage, Map.thash, k, (uDay, count + 1, userSpent));
    record({ id; app = a.id; user; topic = topic.id; title = input.title; body = input.body; link = input.link; level; created_at = t; jobs = Buffer.toArray(jobIds) });
    let queued = Array.filter<Nat>(Buffer.toArray(jobIds), func(j) = Map.has(pending, Map.nhash, j)).size();
    #ok({ id; deliveries = queued; deduplicated = false });
  };

  /// Send a user a message. Only a registered app's canisters may call it.
  public shared ({ caller }) func notify(input : NotifyInput) : async NotifyResult {
    let a = switch (appOfCaller(caller)) { case (?a) a; case null return #err(#not_registered) };
    let r = notifyOne(a, input, echoKind(caller));
    kick<system>();
    r;
  };

  public shared ({ caller }) func notify_batch(inputs : [NotifyInput]) : async [NotifyResult] {
    if (inputs.size() > MAX_BATCH) trap("At most 100 messages per batch");
    let a = switch (appOfCaller(caller)) { case (?a) a; case null return Array.map<NotifyInput, NotifyResult>(inputs, func(_) = #err(#not_registered)) };
    let skip = echoKind(caller);
    let r = Array.map<NotifyInput, NotifyResult>(inputs, func(i) = notifyOne(a, i, skip));
    kick<system>();
    r;
  };

  /// What happened to an app's own messages (delivered somewhere or not; never where).
  public query ({ caller }) func get_receipts(ids : [Nat]) : async [?Receipt] {
    if (ids.size() > 500) trap("At most 500 ids");
    let a = switch (appOfCaller(caller)) { case (?a) ?a.id; case null null };
    Array.map<Nat, ?Receipt>(ids, func(id) {
      switch (Map.get(notifications, Map.nhash, id)) {
        case (?n) if (?n.app == a or isAdmin(caller)) ?{ id; created_at = n.created_at; state = summary(n) } else null;
        case null null;
      };
    });
  };

  func summary(n : Notification) : { #pending; #delivered; #suppressed : Text; #failed : Text; #expired } {
    var anyPending = false;
    var delivered = false;
    var failed : ?Text = null;
    var suppressed : ?Text = null;
    for (j in n.jobs.vals()) switch (Map.get(jobs, Map.nhash, j)) {
      case (?job) switch (job.state) {
        case (#delivered _) delivered := true;
        case (#queued or #sending _) anyPending := true;
        case (#failed(f)) failed := ?f.reason;
        case (#suppressed(s)) suppressed := ?s.reason;
      };
      case null {};
    };
    if (delivered) #delivered else if (anyPending) #pending else switch (failed, suppressed) {
      case (?f, _) #failed(f);
      case (null, ?s) #suppressed(s);
      case (null, null) if (n.jobs.size() == 0) #suppressed("no channel chosen for this message") else #expired;
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------------------------

  func signedIn(caller : Principal) : ?Text = if (Principal.isAnonymous(caller)) ?"Please sign in" else null;

  public shared ({ caller }) func set_settings(s : Settings) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    ignore smsChannel(caller);
    let all = Array.flatten<Nat>([s.defaults.urgent, s.defaults.normal, s.defaults.info, switch (s.always_copy) { case (?c) [c]; case null [] }]);
    if (not ownsChannels(caller, all)) return #err("Unknown channel");
    switch (s.quiet) { case (?q) if (q.start_min >= 1440 or q.end_min >= 1440 or q.utc_offset_min < -840 or q.utc_offset_min > 840) return #err("Quiet hours in minutes of the day (0-1439), time zone within ±14 h"); case null {} };
    Map.set(settings, Map.phash, caller, s);
    #ok("Saved");
  };

  /// Add a channel. Sneed SMS is there already; others are verified with a code their relay
  /// delivers, then `verify_channel`. `address` is encrypted by the client for the relay.
  public shared ({ caller }) func add_channel(kind : ChannelKind, name : Text, address : Blob) : async ResultNat {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    if (kind == #sneed_sms) return #ok(smsChannel(caller).id);
    if (name.size() > MAX_NAME or address.size() == 0 or address.size() > MAX_ADDRESS) return #err("A label of at most 64 characters and an address of 1 to 2048 bytes");
    if (userChannels(caller).size() >= MAX_CHANNELS) return #err("At most 20 channels");
    let added = switch (Map.get(channel_adds, Map.phash, caller)) { case (?(d, n)) if (d == day()) n else 0; case null 0 };
    if (added >= MAX_CHANNEL_ADDS_PER_DAY) return #err("At most 5 new channels a day; try again tomorrow");
    Map.set(channel_adds, Map.phash, caller, (day(), added + 1));
    let code = await newCode();
    ignore smsChannel(caller);
    let c : Channel = { id = next_channel_id; kind; name; address; state = #unverified; created_at = now() };
    next_channel_id += 1;
    Map.set(channels, Map.phash, caller, Array.append(userChannels(caller), [c]));
    sendCode(caller, c, code);
    #ok(c.id);
  };

  func newCode() : async Text {
    let seed = await Random.blob();
    var code = "";
    for (b in seed.vals()) if (code.size() < 6) code #= Nat.toText(Nat8.toNat(b) % 10);
    code;
  };

  /// A fresh code for channel `c`, valid a day, sent through the channel's relay (free).
  func sendCode(user : Principal, c : Channel, code : Text) {
    Map.set(codes, Map.nhash, c.id, (code, now() + DAY_NS));
    Map.delete(code_misses, Map.nhash, c.id);
    let n = next_notification_id;
    next_notification_id += 1;
    let j = newJob(n, user, c, now(), 0, true);
    record({ id = n; app = SYSTEM_APP; user; topic = "verify"; title = "Your Sneed Notifications code: " # code; body = "Enter this code in Sneed Hub to confirm this channel. If you didn't ask for it, ignore this message."; link = null; level = #urgent; created_at = now(); jobs = [j] });
  };

  /// Send a channel that is still waiting a new code (the old one stops working). Counts toward the
  /// same 5 a day as new channels, so it can't be used to message an address over and over.
  public shared ({ caller }) func resend_code(id : Nat) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    let c = switch (Array.find<Channel>(userChannels(caller), func(x) = x.id == id)) { case (?c) c; case null return #err("Not your channel") };
    if (c.kind == #sneed_sms or c.state != #unverified) return #err("This channel needs no code");
    let added = switch (Map.get(channel_adds, Map.phash, caller)) { case (?(d, n)) if (d == day()) n else 0; case null 0 };
    if (added >= MAX_CHANNEL_ADDS_PER_DAY) return #err("At most 5 codes a day; try again tomorrow");
    Map.set(channel_adds, Map.phash, caller, (day(), added + 1));
    let code = await newCode();
    // the channel may have been removed or verified while the randomness was fetched
    switch (Array.find<Channel>(userChannels(caller), func(x) = x.id == id)) {
      case (?now_c) if (now_c.state == #unverified) { sendCode(caller, now_c, code); #ok("A new code is on its way") } else #err("This channel needs no code");
      case null #err("Not your channel");
    };
  };

  public shared ({ caller }) func verify_channel(id : Nat, code : Text) : async Result {
    switch (Map.get(codes, Map.nhash, id)) {
      case (?(c, expires)) {
        if (not ownsChannels(caller, [id])) return #err("Not your channel");
        if (now() > expires) return #err("The code expired; remove the channel and add it again");
        if (c != code) {
          let misses = (switch (Map.get(code_misses, Map.nhash, id)) { case (?m) m; case null 0 }) + 1;
          if (misses >= MAX_CODE_MISSES) {
            Map.delete(codes, Map.nhash, id);
            Map.delete(code_misses, Map.nhash, id);
            return #err("Too many wrong codes; remove the channel and add it again");
          };
          Map.set(code_misses, Map.nhash, id, misses);
          return #err("Wrong code");
        };
        Map.set(channels, Map.phash, caller, Array.map<Channel, Channel>(userChannels(caller), func(x) = if (x.id == id) ({ x with state = #verified }) else x));
        Map.delete(codes, Map.nhash, id);
        Map.delete(code_misses, Map.nhash, id);
        #ok("Verified");
      };
      case null #err("Nothing to verify");
    };
  };

  /// Remove a channel; its address is deleted.
  public shared ({ caller }) func remove_channel(id : Nat) : async Result {
    if (not ownsChannels(caller, [id])) return #err("Not your channel");
    Map.set(channels, Map.phash, caller, Array.filter<Channel>(userChannels(caller), func(x) = x.id != id));
    Map.delete(codes, Map.nhash, id);
    Map.delete(code_misses, Map.nhash, id);
    switch (Map.get(settings, Map.phash, caller)) {
      case (?s) {
        let drop = func(ids : [Nat]) : [Nat] = Array.filter<Nat>(ids, func(x) = x != id);
        Map.set(settings, Map.phash, caller, { s with defaults = { urgent = drop(s.defaults.urgent); normal = drop(s.defaults.normal); info = drop(s.defaults.info) }; always_copy = if (s.always_copy == ?id) null else s.always_copy });
      };
      case null {};
    };
    #ok("Removed");
  };

  /// Allow an app (with the default caps) or block it.
  public shared ({ caller }) func allow_app(app : Nat, allow : Bool) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    if (not Map.has(apps, Map.nhash, app)) return #err("No such app");
    let k = key(caller, app);
    let p = switch (Map.get(permissions, Map.thash, k)) { case (?p) ({ p with allowed = allow }); case null ({ defaultPermission() with allowed = allow }) };
    Map.set(permissions, Map.thash, k, p);
    switch (Map.get(requests, Map.phash, caller)) { case (?r) Map.set(requests, Map.phash, caller, Array.filter<Nat>(r, func(x) = x != app)); case null {} };
    #ok(if (allow) "Allowed" else "Blocked");
  };

  public shared ({ caller }) func set_permission(app : Nat, p : Permission) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    let a = switch (Map.get(apps, Map.nhash, app)) { case (?a) a; case null return #err("No such app") };
    if (p.topics.size() > MAX_TOPICS) return #err("Too many topic rules");
    for ((id, r) in p.topics.vals()) {
      if (Array.find<Topic>(a.topics, func(t) = t.id == id) == null) return #err("Unknown topic " # id);
      switch r { case (#channels(cs)) if (not ownsChannels(caller, cs)) return #err("Unknown channel"); case _ {} };
    };
    Map.set(permissions, Map.thash, key(caller, app), p);
    #ok("Saved");
  };

  func lowBalanceSetting(user : Principal) : (Nat, Bool) = switch (Map.get(low_balance, Map.phash, user)) { case (?x) x; case null (DEFAULT_LOW_BALANCE_E8S, false) };

  func isSuppressedForBalance(j : Nat) : Bool = switch (Map.get(jobs, Map.nhash, j)) {
    case (?job) switch (job.state) { case (#suppressed({ reason })) reason == "not enough balance"; case _ false };
    case null false;
  };

  /// Tell the user once, for free, that their balance fell below their threshold: to Sneed SMS and their urgent channels.
  func lowBalanceCheck(user : Principal) {
    let (threshold, alerted) = lowBalanceSetting(user);
    if (threshold == 0 or alerted or balanceOf(user) >= threshold) return;
    Map.set(low_balance, Map.phash, user, (threshold, true));
    let s = settingsOf(user);
    let sms = smsChannel(user);
    let targets = Array.filter<Channel>(userChannels(user), func(c) = c.id == sms.id or (c.state == #verified and Array.find<Nat>(s.defaults.urgent, func(x) = x == c.id) != null));
    let n = next_notification_id;
    next_notification_id += 1;
    let jobIds = Array.map<Channel, Nat>(targets, func(c) = newJob(n, user, c, now(), 0, true));
    record({ id = n; app = SYSTEM_APP; user; topic = "low_balance"; title = "Your notification balance is low"; body = "You have " # e8sText(balanceOf(user)) # " ICP left for paid deliveries (phone push, Discord…). When it runs out, those channels stop and only Sneed SMS keeps receiving. Top up in Sneed Hub."; link = ?"https://app.sneeddao.com/notifications"; level = #urgent; created_at = now(); jobs = jobIds });
  };

  func rearmLowBalance(user : Principal) {
    let (threshold, _) = lowBalanceSetting(user);
    if (balanceOf(user) >= threshold) Map.set(low_balance, Map.phash, user, (threshold, false));
  };

  func e8sText(e8s : Nat) : Text {
    let frac = Nat.toText(e8s % 100_000_000 + 100_000_000);
    Nat.toText(e8s / 100_000_000) # "." # Text.fromIter(Iter.fromArray(Array.subArray<Char>(Text.toArray(frac), 1, 8)));
  };

  /// Your low-balance alert: you're told once when your balance falls below `threshold_e8s` (0 turns it off).
  public shared ({ caller }) func set_low_balance_alert(threshold_e8s : Nat) : async Result {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    Map.set(low_balance, Map.phash, caller, (threshold_e8s, balanceOf(caller) < threshold_e8s and threshold_e8s > 0));
    #ok(if (threshold_e8s == 0) "Low-balance alert off" else "Low-balance alert set");
  };

  public shared query ({ caller }) func get_low_balance_alert() : async { threshold_e8s : Nat; default_e8s : Nat } {
    { threshold_e8s = lowBalanceSetting(caller).0; default_e8s = DEFAULT_LOW_BALANCE_E8S };
  };

  /// Top up your notification balance with ICP (approve this canister for amount + fee first).
  public shared ({ caller }) func top_up(amount_e8s : Nat) : async ResultNat {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    let ledger_block = switch (await* pull(caller, amount_e8s, TOP_UP_MEMO)) { case (#err(e)) return #err(e); case (#ok(b)) b };
    if (Map.has(credited_blocks, Map.thash, blockKey(ledger_block))) return #ok(balanceOf(caller)); // an admin credited it meanwhile
    let b = balanceOf(caller) + amount_e8s;
    Map.set(user_balances, Map.phash, caller, b);
    recordTopUp(caller, { ledger_block; amount_e8s; at = now(); app = null; via = #top_up });
    rearmLowBalance(caller);
    block("top_up", #caller(caller), [("amount_e8s", #Nat(amount_e8s)), ("ledger_block", #Nat(ledger_block))]);
    #ok(b);
  };

  transient let TOP_UP_MEMO : Blob = "sneednotif:top_up";
  transient let APP_TOP_UP_MEMO : Blob = "sneednotif:app_top_up";

  /// The ledger block of the transfer on success. With a memo and a creation time, so the transfer
  /// can be found on the ledger and a resend would be deduplicated.
  func pull(from : Principal, amount : Nat, memo : Blob) : async* { #ok : Nat; #err : Text } {
    if (amount == 0) return #err("Nothing to top up");
    let ledger : IcpLedger = actor (Principal.toText(config.icp_ledger));
    // counted as a liability while in flight: the ledger may have moved it before the caller credits it
    pulling_e8s += amount;
    let r = try {
      switch (await ledger.icrc2_transfer_from({ spender_subaccount = null; from = { owner = from; subaccount = null }; to = { owner = Principal.fromActor(this); subaccount = null }; amount; fee = null; memo = ?memo; created_at_time = ?Nat64.fromNat(Int.abs(now())) })) {
        case (#Ok(b)) #ok(b);
        case (#Err(#InsufficientAllowance(a))) #err("Approve this canister for the amount first (allowance " # Nat.toText(a.allowance) # ")");
        case (#Err(#InsufficientFunds(b))) #err("Not enough ICP (balance " # Nat.toText(b.balance) # ")");
        case (#Err _) #err("The ledger refused the transfer");
      };
    } catch (e) { #err("The ledger did not answer: " # Error.message(e)) };
    pulling_e8s -= amount; // the caller credits a success in this same message
    r;
  };

  public query ({ caller }) func get_my_settings() : async { settings : Settings; channels : [Channel]; balance_e8s : Nat } {
    { settings = settingsOf(caller); channels = userChannels(caller); balance_e8s = balanceOf(caller) };
  };

  public query ({ caller }) func get_my_apps() : async [(App, Permission)] {
    let out = Buffer.Buffer<(App, Permission)>(8);
    for (a in Map.vals(apps)) switch (Map.get(permissions, Map.thash, key(caller, a.id))) { case (?p) out.add((a, p)); case null {} };
    Buffer.toArray(out);
  };

  public query ({ caller }) func get_my_requests() : async [App] {
    let ids = switch (Map.get(requests, Map.phash, caller)) { case (?r) r; case null [] };
    Array.mapFilter<Nat, App>(ids, func(id) = Map.get(apps, Map.nhash, id));
  };

  /// Your notifications, newest first, with what happened on each channel.
  public query ({ caller }) func get_my_history(limit : Nat) : async [HistoryItem] { historyOf(caller, limit) };

  func historyOf(user : Principal, limit : Nat) : [HistoryItem] {
    let ids = switch (Map.get(user_notifications, Map.phash, user)) { case (?l) l; case null [] };
    let out = Buffer.Buffer<HistoryItem>(20);
    var i = ids.size();
    while (i > 0 and out.size() < Nat.min(limit, 200)) {
      i -= 1;
      switch (Map.get(notifications, Map.nhash, ids[i])) {
        case (?n) {
          let name = if (n.app == SYSTEM_APP) "Sneed Notifications" else switch (Map.get(apps, Map.nhash, n.app)) { case (?a) a.name; case null "(removed app)" };
          let deliveries = Array.mapFilter<Nat, { channel : Nat; kind : ChannelKind; state : JobState }>(n.jobs, func(j) = switch (Map.get(jobs, Map.nhash, j)) { case (?job) ?{ channel = job.channel; kind = job.kind; state = job.state }; case null null });
          // a verification code is for the channel's owner only: whoever added the channel must not read it here
          let title = if (n.app == SYSTEM_APP and n.topic == "verify") "Your Sneed Notifications code (sent to the channel only)" else n.title;
          out.add({ id = n.id; app = n.app; app_name = name; topic = n.topic; level = n.level; title; body = n.body; link = n.link; created_at = n.created_at; deliveries });
        };
        case null {};
      };
    };
    Buffer.toArray(out);
  };

  // ---------------------------------------------------------------------------------------------
  // Public reads
  // ---------------------------------------------------------------------------------------------

  public query func get_app(id : Nat) : async ?App { Map.get(apps, Map.nhash, id) };
  public query func get_app_of(canister : Principal) : async ?App { appOfCaller(canister) };
  public query func get_app_balance(id : Nat) : async Nat { appBalanceOf(id) };
  public query func list_apps(start : Nat, limit : Nat) : async [App] {
    let out = Buffer.Buffer<App>(20);
    var id = Nat.max(start, 1);
    while (id < next_app_id and out.size() < Nat.min(limit, 200)) {
      switch (Map.get(apps, Map.nhash, id)) { case (?a) out.add(a); case null {} };
      id += 1;
    };
    Buffer.toArray(out);
  };
  public query func get_config() : async Config { config };
  public query func get_relay_keys() : async [(ChannelKind, Text)] { relay_keys };
  public query func get_admins() : async [Principal] { admins };
  /// `last_tick_at`: when the delivery timer last ran (every 30 s); `ticking`: a run in progress.
  public query func stats() : async { apps : Nat; users : Nat; notifications : Nat; pending : Nat; last_tick_at : Int; ticking : Bool } {
    { apps = Map.size(apps); users = Map.size(channels); notifications = Map.size(notifications); pending = Map.size(pending); last_tick_at; ticking };
  };

  // ---------------------------------------------------------------------------------------------
  // Relays
  // ---------------------------------------------------------------------------------------------

  /// A relay takes up to `max` due jobs of its channel kind; they come back to the queue if not
  /// acknowledged within the lease.
  public shared ({ caller }) func relay_pull(max : Nat) : async [RelayJob] {
    let kind = switch (relayKind(caller)) { case (?k) k; case null trap("Not a relay") };
    let t = now();
    let out = Buffer.Buffer<RelayJob>(Nat.min(max, 100));
    let gone = Buffer.Buffer<Job>(4); // changed after the scan: never delete from a map while walking it
    let missing = Buffer.Buffer<Nat>(4);
    label scan for (jid in Map.keys(pending)) {
      if (out.size() >= Nat.min(max, 100)) break scan;
      switch (Map.get(jobs, Map.nhash, jid)) {
        case (?j) if (j.kind == kind and j.state == #queued and j.not_before <= t) {
          switch (Map.get(notifications, Map.nhash, j.notification), Array.find<Channel>(userChannels(j.user), func(c) = c.id == j.channel)) {
            case (?n, ?c) {
              let appName = if (n.app == SYSTEM_APP) "Sneed Notifications" else switch (Map.get(apps, Map.nhash, n.app)) { case (?a) a.name; case null "" };
              Map.set(jobs, Map.nhash, jid, { j with state = #sending({ relay = caller; since = t }) });
              out.add({ id = jid; kind; address = c.address; app = appName; title = n.title; body = n.body; link = n.link; level = n.level; created_at = n.created_at });
            };
            case _ gone.add(j);
          };
        };
        case null missing.add(jid);
      };
    };
    for (j in gone.vals()) finish(j, #failed({ reason = "channel removed" }), #caller(caller));
    for (jid in missing.vals()) Map.delete(pending, Map.nhash, jid);
    Buffer.toArray(out);
  };

  public shared ({ caller }) func relay_ack(results : [(Nat, { #ok; #err : Text })]) : async () {
    if (relayKind(caller) == null) trap("Not a relay");
    for ((jid, r) in results.vals()) switch (Map.get(jobs, Map.nhash, jid)) {
      case (?j) switch (j.state) {
        case (#sending(s)) if (s.relay == caller) switch r {
          case (#ok) finish(j, #delivered({ at = now() }), #caller(caller));
          case (#err(e)) retry(j, e, #caller(caller));
        };
        case _ {};
      };
      case null {};
    };
  };

  func finish(j : Job, state : JobState, by : By) {
    Map.set(jobs, Map.nhash, j.id, { j with state });
    Map.delete(pending, Map.nhash, j.id);
    switch (state) {
      case (#failed _) refund(j, by);
      case _ {};
    };
  };

  func retry(j : Job, e : Text, by : By) {
    if (j.attempts + 1 >= config.max_attempts) finish({ j with attempts = j.attempts + 1 }, #failed({ reason = e }), by) else Map.set(jobs, Map.nhash, j.id, { j with attempts = j.attempts + 1; state = #queued; not_before = now() + 60_000_000_000 * (j.attempts + 1) });
  };

  /// Logged as an amount only (and who paid: a user or an app), never which user, app or delivery.
  func refund(j : Job, by : By) {
    if (j.price_e8s == 0) return;
    fees_refunded_e8s += j.price_e8s;
    if (j.paid_by_app) switch (Map.get(notifications, Map.nhash, j.notification)) {
      case (?n) Map.set(app_balances, Map.nhash, n.app, appBalanceOf(n.app) + j.price_e8s);
      case null {};
    } else Map.set(user_balances, Map.phash, j.user, balanceOf(j.user) + j.price_e8s);
    block("refund", by, [("amount_e8s", #Nat(j.price_e8s)), ("paid_by", #Text(if (j.paid_by_app) "app" else "user")), ("refunded_e8s", #Nat(fees_refunded_e8s))]);
  };

  // ---------------------------------------------------------------------------------------------
  // Revenue forwarding (a check from the delivery timer, at most every 5 minutes)
  // ---------------------------------------------------------------------------------------------

  /// Paid deliveries that are not final yet: refunded to their payer if they finally fail.
  func reservedE8s() : Nat {
    var r = 0;
    for (jid in Map.keys(pending)) switch (Map.get(jobs, Map.nhash, jid)) { case (?j) r += j.price_e8s; case null {} };
    r;
  };

  /// What this canister owes: every user and app balance, the paid deliveries that may still be
  /// refunded, and top-ups the ledger may have moved but that are not credited yet.
  func liabilitiesE8s() : Nat {
    var l = reservedE8s() + pulling_e8s;
    for (b in Map.vals(user_balances)) l += b;
    for (b in Map.vals(app_balances)) l += b;
    l;
  };

  func feesOut() : Nat = fees_forwarded_e8s + fees_ledger_fees_e8s;

  /// What the books say may go out: the free ICP measured at the base plus the fees counted since.
  func unforwardedE8s() : ?Int = switch (fee_base) {
    case (?b) ?(b.free + fees_earned_e8s - b.earned - (fees_refunded_e8s - b.refunded) - (feesOut() - b.out) - (reservedE8s() - b.reserved));
    case null null;
  };

  func feeNote(m : Text) {
    let e = (now(), m);
    fee_events := if (fee_events.size() >= 20) Array.append(Array.subArray(fee_events, fee_events.size() - 19, 19), [e]) else Array.append(fee_events, [e]);
  };
  func feeError(m : Text) { fee_last_error := ?m; feeNote(m) };

  func feeTick() : async () { ignore await* forwardFees(false, #timer) };

  /// Forward the unforwarded fees in one transfer once they reach the threshold (`force`: any
  /// amount above the ledger fee). Before each transfer the ledger balance is read again and the
  /// transfer must leave at least the liabilities; counters change only once the ledger accepted.
  func forwardFees(force : Bool, by : By) : async* Result {
    if (fee_forwarding) return #err("A forward is already running");
    let to = switch (fee_destination) { case (?a) a; case null return #ok("No fee destination: fees stay in the canister") };
    // cheap check first: no ledger call while the books are below the threshold
    switch (unforwardedE8s(), fee_pending) {
      case (?u, null) if (not force and u < fee_sweep_threshold_e8s) return #ok("Below the threshold");
      case _ {};
    };
    fee_forwarding := true;
    fee_last_check := now();
    try { await* forwardLocked(to, force, by) } catch (e) { feeError("fee forward: " # Error.message(e)); #err(Error.message(e)) } finally { fee_forwarding := false };
  };

  func forwardLocked(to : Account, force : Bool, by : By) : async* Result {
    let ledger : IcpLedger = actor (Principal.toText(config.icp_ledger));
    let self : Account = { owner = Principal.fromActor(this); subaccount = null };

    // a transfer whose outcome is unknown goes again with the same arguments: the ledger
    // deduplicates it (created_at_time + memo), so it cannot go out twice
    switch (fee_pending) {
      case (?p) {
        let res = try {
          await ledger.icrc1_transfer({ from_subaccount = null; to = p.to; amount = p.amount; fee = ?p.fee; memo = ?p.memo; created_at_time = ?p.created_at_time });
        } catch (e) { feeError("fee forward retry: " # Error.message(e)); return #err("The ledger did not answer; retrying later") };
        fee_pending := null;
        switch res {
          case (#Ok(block)) { forwarded(p.to, p.amount, p.fee, block, by); return #ok("Forwarded " # e8sText(p.amount) # " ICP") };
          case (#Err(#Duplicate(d))) { forwarded(p.to, p.amount, p.fee, d.duplicate_of, by); return #ok("Forwarded " # e8sText(p.amount) # " ICP (deduplicated)") };
          // too old to deduplicate: the books are re-measured from the ledger below
          case (#Err(#TooOld)) feeNote("an unanswered forward is too old to retry; re-measuring from the ledger");
          case (#Err(e)) { feeError("fee forward retry refused: " # debug_show e); return #err("The ledger refused the transfer") };
        };
      };
      case null {};
    };

    let balance = try { await ledger.icrc1_balance_of(self) } catch (e) { feeError("fee forward: balance: " # Error.message(e)); return #err("The ledger did not answer") };
    // everything below runs in this one message: the liabilities can't change before the transfer is sent
    let liabilities = liabilitiesE8s();
    let free : Nat = if (balance > liabilities) balance - liabilities else 0;
    if (balance <= liabilities) feeNote("liabilities " # e8sText(liabilities) # " ≥ balance " # e8sText(balance) # " ICP: nothing forwarded");
    let base = { free; earned = fees_earned_e8s; refunded = fees_refunded_e8s; reserved = reservedE8s(); out = feesOut(); at = now() };
    switch (fee_base) {
      case null {
        // the first attempt: the ICP spent before forwarding existed, never more than the free balance
        let counted : Int = fees_earned_e8s - fees_refunded_e8s;
        let backlog : Nat = if (free > counted) Int.abs(free - Int.max(counted, 0)) else 0;
        fees_backlog_e8s := ?backlog;
        fee_base := ?base;
        feeNote("first measurement: balance " # e8sText(balance) # ", liabilities " # e8sText(liabilities) # ", free " # e8sText(free) # ", backlog " # e8sText(backlog) # " ICP");
        block("fee_backlog", by, [("balance_e8s", #Nat(balance)), ("liabilities_e8s", #Nat(liabilities)), ("free_e8s", #Nat(free)), ("backlog_e8s", #Nat(backlog))]);
      };
      case (?_) switch (unforwardedE8s()) {
        case (?u) if (u > free) {
          // the ledger shows less than the books (e.g. a forward whose answer was lost): trust the ledger
          fee_base := ?base;
          feeNote("the books said " # e8sText(Int.abs(Int.max(u, 0))) # " ICP free, the ledger " # e8sText(free) # ": re-measured");
          block("fee_remeasure", by, [("books_e8s", #Nat(Int.abs(Int.max(u, 0)))), ("balance_e8s", #Nat(balance)), ("liabilities_e8s", #Nat(liabilities)), ("free_e8s", #Nat(free))]);
        };
        case null {};
      };
    };
    let u : Nat = switch (unforwardedE8s()) { case (?x) Int.abs(Int.max(Int.min(x, free), 0)); case null 0 };
    let fee = fee_ledger_fee_e8s;
    if (not force and u < fee_sweep_threshold_e8s) return #ok("Below the threshold");
    if (u <= fee) return #ok("Nothing to forward");
    let amount : Nat = u - fee;
    // the invariant, checked again just before the transfer
    if (balance < amount + fee or balance - (amount + fee) < liabilities) {
      feeError("fee forward skipped: it would leave less than the liabilities");
      return #err("Skipped: the balance would fall below the liabilities");
    };
    let created_at_time = Nat64.fromNat(Int.abs(now()));
    let memo = Text.encodeUtf8("sneed-fees:" # Nat.toText(fee_forwards + 1));
    fee_pending := ?{ to; amount; fee; memo; created_at_time };
    let res = try {
      await ledger.icrc1_transfer({ from_subaccount = null; to; amount; fee = ?fee; memo = ?memo; created_at_time = ?created_at_time });
    } catch (e) {
      // unknown outcome: kept in fee_pending and retried with the same arguments
      feeError("fee forward: " # Error.message(e) # " (retried with the same arguments)");
      return #err("The ledger did not answer; retrying later");
    };
    fee_pending := null;
    switch res {
      case (#Ok(block)) { forwarded(to, amount, fee, block, by); #ok("Forwarded " # e8sText(amount) # " ICP") };
      case (#Err(#Duplicate(d))) { forwarded(to, amount, fee, d.duplicate_of, by); #ok("Forwarded " # e8sText(amount) # " ICP (deduplicated)") };
      case (#Err(#BadFee(x))) { fee_ledger_fee_e8s := x.expected_fee; feeError("fee forward: the ledger fee is now " # Nat.toText(x.expected_fee) # " e8s; retrying later"); #err("The ledger fee changed") };
      case (#Err(e)) { feeError("fee forward refused: " # debug_show e); #err("The ledger refused the transfer") };
    };
  };

  func forwarded(to : Account, amount : Nat, fee : Nat, ledger_block : Nat, by : By) {
    fees_forwarded_e8s += amount;
    fees_ledger_fees_e8s += fee;
    fee_forwards += 1;
    fee_last_forward := ?{ at = now(); amount_e8s = amount; block = ledger_block; to };
    fee_last_error := null;
    feeNote("forwarded " # e8sText(amount) # " ICP (block " # Nat.toText(ledger_block) # ")");
    block("fee_forward", by, [("amount_e8s", #Nat(amount)), ("fee_e8s", #Nat(fee)), ("to", accountV(to)), ("ledger_block", #Nat(ledger_block)), ("forwards", #Nat(fee_forwards)), ("forwarded_e8s", #Nat(fees_forwarded_e8s))]);
  };

  /// Revenue forwarding: counters, destination, threshold and the last events. Public: revenue is DAO information.
  public query func get_fee_forwarding() : async FeeForwarding {
    {
      destination = fee_destination;
      threshold_e8s = fee_sweep_threshold_e8s;
      ledger_fee_e8s = fee_ledger_fee_e8s;
      earned_e8s = fees_earned_e8s;
      refunded_e8s = fees_refunded_e8s;
      forwarded_e8s = fees_forwarded_e8s;
      ledger_fees_paid_e8s = fees_ledger_fees_e8s;
      forwards = fee_forwards;
      backlog_e8s = fees_backlog_e8s;
      unforwarded_e8s = switch (unforwardedE8s()) { case (?u) ?Int.abs(Int.max(u, 0)); case null null };
      liabilities_e8s = liabilitiesE8s();
      reserved_e8s = reservedE8s();
      last_check = fee_last_check;
      last_forward = fee_last_forward;
      last_error = fee_last_error;
      retry_pending = fee_pending != null;
      events = fee_events;
    };
  };

  /// Where the fees go (null: they stay in the canister).
  public shared ({ caller }) func admin_set_fee_destination(a : ?Account) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (a) { case (?{ subaccount = ?s }) if (s.size() != 32) return #err("A subaccount is 32 bytes"); case _ {} };
    configBlock(#caller(caller), "fee_destination", optAccountV(fee_destination), optAccountV(a));
    fee_destination := a;
    feeNote(switch a { case (?x) "destination set to " # Principal.toText(x.owner); case null "destination cleared: fees stay in the canister" });
    #ok("Saved");
  };

  public shared ({ caller }) func admin_set_fee_sweep_threshold(e8s : Nat) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    configBlock(#caller(caller), "fee_sweep_threshold_e8s", #Nat(fee_sweep_threshold_e8s), #Nat(e8s));
    fee_sweep_threshold_e8s := e8s;
    #ok("Saved");
  };

  /// Forward now, whatever the threshold (still only what exceeds the liabilities, minus the ledger fee).
  public shared ({ caller }) func admin_forward_fees_now() : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    await* forwardFees(true, #caller(caller));
  };

  // ---------------------------------------------------------------------------------------------
  // Delivery of Sneed SMS, leases, retention (a timer)
  // ---------------------------------------------------------------------------------------------

  func smsText(n : Notification) : (Text, Text) {
    let appName = if (n.app == SYSTEM_APP) "Sneed Notifications" else switch (Map.get(apps, Map.nhash, n.app)) { case (?a) a.name; case null "An app" };
    let body = n.body # (switch (n.link) { case (?l) "\n\n" # l; case null "" }) # "\n\n— " # appName # ", via Sneed Notifications (manage: https://app.sneeddao.com/notifications)";
    ("[" # appName # "] " # n.title, body);
  };

  func tick() : async () {
    if (ticking) return;
    ticking := true;
    // `finally` clears the flag even when a later part of the run traps (e.g. an answer that does
    // not decode): otherwise every later run would return at once and deliveries would stop
    try { await* tickBody() } finally { ticking := false };
  };

  func tickBody() : async* () {
    ticks += 1;
    last_tick_at := now();
    let t = now();
    // housekeeping first, so a delivery that traps below cannot hold it up
    if (ticks % 120 == 0) prune(t);
    if (t >= fee_next_check) {
      fee_next_check := t + FEE_CHECK_NS;
      ignore feeTick(); // its own message: deliveries don't wait for the ledger
    };
    let due = Buffer.Buffer<Job>(20);
    let lapsed = Buffer.Buffer<Job>(4);
    for (jid in Map.keys(pending)) switch (Map.get(jobs, Map.nhash, jid)) {
      case (?j) {
        switch (j.state) {
          case (#sending(s)) if (t - s.since > config.relay_lease_ns) lapsed.add(j);
          case (#queued) if (j.kind == #sneed_sms and j.not_before <= t and due.size() < 20) due.add(j);
          case _ {};
        };
      };
      case null {};
    };
    for (j in lapsed.vals()) retry(j, "relay did not answer", #timer);
    let sms : Sms = actor (Principal.toText(config.sneed_sms));
    for (j in due.vals()) switch (Map.get(notifications, Map.nhash, j.notification)) {
      case (?n) {
        let (subject, body) = smsText(n);
        try {
          switch (await sms.send_system_notification({ recipients = [j.user]; subject; body })) {
            case (#ok _) finish(j, #delivered({ at = now() }), #timer);
            case (#err(e)) retry(j, debug_show e, #timer);
          };
        } catch (e) { retry(j, Error.message(e), #timer) };
      };
      case null finish(j, #failed({ reason = "message removed" }), #timer);
    };
  };

  func prune(t : Int) {
    let old = Buffer.Buffer<Nat>(50);
    label scan for (n in Map.vals(notifications)) {
      if (old.size() >= 500) break scan;
      if (t - n.created_at > config.retention_ns) old.add(n.id);
    };
    for (id in old.vals()) switch (Map.get(notifications, Map.nhash, id)) {
      case (?n) {
        for (j in n.jobs.vals()) {
          // a paid delivery that never became final goes back to whoever paid for it
          if (Map.has(pending, Map.nhash, j)) switch (Map.get(jobs, Map.nhash, j)) { case (?job) refund(job, #timer); case null {} };
          Map.delete(jobs, Map.nhash, j);
          Map.delete(pending, Map.nhash, j);
        };
        Map.delete(notifications, Map.nhash, id);
        switch (Map.get(user_notifications, Map.phash, n.user)) { case (?l) Map.set(user_notifications, Map.phash, n.user, Array.filter<Nat>(l, func(x) = x != id)); case null {} };
      };
      case null {};
    };
    let stale = Buffer.Buffer<Text>(50);
    for ((k, last) in Map.entries(dedupes)) if (t - last > config.dedupe_window_ns) stale.add(k);
    for (k in stale.vals()) Map.delete(dedupes, Map.thash, k);
  };

  /// Deliver soon after a notify instead of waiting for the next tick.
  func kick<system>() { ignore Timer.setTimer<system>(#seconds 0, tick) };

  transient let _timer = Timer.recurringTimer<system>(#seconds 30, tick);

  // ---------------------------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------------------------

  public shared ({ caller }) func admin_set_config(c : Config) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    configBlocks(#caller(caller), configValues(config), configValues(c));
    config := c;
    #ok("Saved");
  };
  public shared ({ caller }) func admin_set_relay_key(kind : ChannelKind, key : Text) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (key.size() > 4_096) return #err("Key too long");
    let old : T3.Value = switch (Array.find<(ChannelKind, Text)>(relay_keys, func((k, _)) = k == kind)) { case (?(_, x)) #Text(x); case null #Text("none") };
    let new : T3.Value = if (key == "") #Text("none") else #Text(key);
    // the public key only (clients encrypt addresses to it); relays keep their private keys
    if (old != new) block("config_update", #caller(caller), [("key", #Text("relay_key")), ("kind", #Text(kindText(kind))), ("old_value", old), ("value", new)]);
    relay_keys := Array.append(Array.filter<(ChannelKind, Text)>(relay_keys, func((k, _)) = k != kind), if (key == "") [] else [(kind, key)]);
    #ok("Saved");
  };

  public shared ({ caller }) func admin_add_admin(p : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (Array.find<Principal>(admins, func(a) = a == p) == null) {
      admins := Array.append(admins, [p]);
      block("admin_add", #caller(caller), [("principal", pv(p))]);
    };
    #ok("Added");
  };
  public shared ({ caller }) func admin_remove_admin(p : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (Array.find<Principal>(admins, func(a) = a == p) != null) {
      admins := Array.filter<Principal>(admins, func(a) = a != p);
      block("admin_remove", #caller(caller), [("principal", pv(p))]);
    };
    #ok("Removed");
  };
  public shared ({ caller }) func admin_set_app_verified(id : Nat, verified : Bool) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (Map.get(apps, Map.nhash, id)) {
      case (?a) {
        Map.set(apps, Map.nhash, id, { a with verified });
        if (a.verified != verified) block("app_verify", #caller(caller), [("app_id", #Nat(id)), ("name", #Text(a.name)), ("verified", #Nat(if verified 1 else 0))]);
        #ok("Saved");
      };
      case null #err("No such app");
    };
  };
  /// Remove an abusive app: it can no longer notify anyone. Its balance stays where it is: the
  /// owner moves it to their own notification balance with `claim_removed_app_balance`.
  public shared ({ caller }) func admin_remove_app(id : Nat) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (Map.get(apps, Map.nhash, id)) {
      case (?a) {
        for (c in a.canisters.vals()) Map.delete(app_of_canister, Map.phash, c);
        Map.delete(apps, Map.nhash, id);
        Map.set(removed_apps, Map.nhash, id, a);
        block("app_remove", #caller(caller), [("app_id", #Nat(a.id)), ("name", #Text(a.name)), ("owner", pv(a.owner)), ("canisters", principalsV(a.canisters)), ("app_balance_e8s", #Nat(appBalanceOf(id)))]);
        #ok("Removed");
      };
      case null #err("No such app");
    };
  };

  /// A removed app's balance goes to its recorded owner's notification balance (the owner calls,
  /// or an admin on the owner's behalf; it never goes anywhere else).
  public shared ({ caller }) func claim_removed_app_balance(id : Nat) : async ResultNat {
    let a = switch (Map.get(removed_apps, Map.nhash, id)) { case (?a) a; case null return #err("No removed app " # Nat.toText(id)) };
    if (caller != a.owner and not isAdmin(caller)) return #err("Only the app's owner");
    let amount = appBalanceOf(id);
    if (amount == 0) return #err("Nothing to claim");
    Map.delete(app_balances, Map.nhash, id);
    let b = balanceOf(a.owner) + amount;
    Map.set(user_balances, Map.phash, a.owner, b);
    rearmLowBalance(a.owner);
    block("app_balance_claim", #caller(caller), [("app_id", #Nat(id)), ("owner", pv(a.owner)), ("amount_e8s", #Nat(amount)), ("balance_e8s", #Nat(b))]);
    #ok(b);
  };

  /// Admins look up a removed app (its balance: get_app_balance).
  public query ({ caller }) func admin_get_removed_app(id : Nat) : async ?App {
    if (not isAdmin(caller)) trap("Admins only");
    Map.get(removed_apps, Map.nhash, id);
  };

  // ---------------------------------------------------------------------------------------------
  // Support (spec/support_audit.md): top-up records, admin credit, a user's state
  // ---------------------------------------------------------------------------------------------

  func blockKey(ledger_block : Nat) : Text = Principal.toText(config.icp_ledger) # "/" # Nat.toText(ledger_block);

  func recordTopUp(payer : Principal, t : TopUp) {
    Map.set(credited_blocks, Map.thash, blockKey(t.ledger_block), payer);
    let l = switch (Map.get(top_ups, Map.phash, payer)) { case (?l) l; case null [] };
    let kept = if (l.size() >= MAX_TOP_UPS) Array.subArray(l, l.size() + 1 - MAX_TOP_UPS, MAX_TOP_UPS - 1) else l;
    Map.set(top_ups, Map.phash, payer, Array.append(kept, [t]));
  };

  /// Once, on the upgrade that brings the records: every top-up and app top-up this canister's
  /// ICRC-3 log still holds (the log's blocks name the payer and the ledger block). The records
  /// then begin with the first block held, or now when the log is empty.
  func seedTopUpRecords() {
    if (topup_records_seeded) return;
    topup_records_seeded := true;
    var i = icrc3.live.first_index;
    var first = true;
    label scan while (i < icrc3.log_length) {
      let r = Icrc3Log.getBlocks(icrc3, [{ start = i; length = Icrc3Log.MAX_RESPONSE_BLOCKS }]);
      if (r.blocks.size() == 0) break scan;
      for (b in r.blocks.vals()) {
        i := b.id + 1;
        let ts = switch (logField(b.block, "ts")) { case (#Nat(t)) t; case _ 0 };
        if (first) { first := false; if (ts < topup_records_since) topup_records_since := ts };
        let tx = logField(b.block, "tx");
        let via : ?{ #top_up; #app_top_up } = switch (logField(b.block, "btype")) {
          case (#Text("sneednotif_top_up")) ?#top_up;
          case (#Text("sneednotif_app_top_up")) ?#app_top_up;
          case _ null;
        };
        switch (via, logField(tx, "caller"), logField(tx, "ledger_block"), logField(tx, "amount_e8s")) {
          case (?v, #Blob(payer), #Nat(ledger_block), #Nat(amount_e8s)) {
            if (not Map.has(credited_blocks, Map.thash, blockKey(ledger_block))) {
              let app = switch (logField(tx, "app_id")) { case (#Nat(id)) ?id; case _ null };
              recordTopUp(Principal.fromBlob(payer), { ledger_block; amount_e8s; at = ts; app; via = v });
            };
          };
          case _ {};
        };
      };
    };
  };
  func logField(v : T3.Value, name : Text) : T3.Value {
    switch (v) {
      case (#Map(entries)) { for ((k, x) in entries.vals()) if (k == name) return x; #Map([]) };
      case _ #Map([]);
    };
  };

  /// Admins credit `user` with a top-up whose outcome the canister never learned (e.g. "The
  /// ledger did not answer"): block `ledger_block` of the ICP ledger must move exactly
  /// `amount_e8s` from `user`'s default account to this canister's, and must not be credited
  /// already. Each block is credited at most once; a block from before the top-up records began
  /// is refused (it may have been credited without a record).
  public shared ({ caller }) func admin_credit(user : Principal, amount_e8s : Nat, ledger_block : Nat) : async ResultNat {
    if (not isAdmin(caller)) return #err("Admins only");
    if (Principal.isAnonymous(user)) return #err("Not for the anonymous principal");
    if (amount_e8s == 0) return #err("Nothing to credit");
    let k = blockKey(ledger_block);
    if (Map.has(credited_blocks, Map.thash, k)) return #err("Block " # Nat.toText(ledger_block) # " is already credited");
    if (Map.has(crediting, Map.thash, k)) return #err("Block " # Nat.toText(ledger_block) # " is being credited");
    Map.set(crediting, Map.thash, k, ());
    let checked = try {
      await* LedgerBlock.verifyTransfer(config.icp_ledger, ledger_block, { owner = user; subaccount = null }, { owner = Principal.fromActor(this); subaccount = null });
    } finally { Map.delete(crediting, Map.thash, k) };
    let t = switch checked { case (#err(e)) return #err(e); case (#ok(t)) t };
    if (t.amount != amount_e8s) return #err("Block " # Nat.toText(ledger_block) # " moved " # Nat.toText(t.amount) # " e8s, not " # Nat.toText(amount_e8s));
    if (t.ts < topup_records_since) return #err("Block " # Nat.toText(ledger_block) # " is older than the top-up records (they begin at " # Int.toText(topup_records_since) # "): it may have been credited already");
    if (Map.has(credited_blocks, Map.thash, k)) return #err("Block " # Nat.toText(ledger_block) # " is already credited");
    let b = balanceOf(user) + amount_e8s;
    Map.set(user_balances, Map.phash, user, b);
    rearmLowBalance(user);
    recordTopUp(user, { ledger_block; amount_e8s; at = now(); app = null; via = #admin_credit });
    block("admin_credit", #caller(caller), [("principal", pv(user)), ("amount_e8s", #Nat(amount_e8s)), ("ledger_block", #Nat(ledger_block)), ("balance_e8s", #Nat(b))]);
    #ok(b);
  };

  /// Admins: one user's balance, settings, channels, apps, top-ups and recent history (at most
  /// `history_limit` notifications, 200 at most), for support.
  public query ({ caller }) func admin_get_user(user : Principal, history_limit : Nat) : async { #ok : AdminUserView; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    let apps_of = Buffer.Buffer<(App, Permission)>(8);
    for (a in Map.vals(apps)) switch (Map.get(permissions, Map.thash, key(user, a.id))) { case (?p) apps_of.add((a, p)); case null {} };
    let reqs = switch (Map.get(requests, Map.phash, user)) { case (?r) r; case null [] };
    let ups = switch (Map.get(top_ups, Map.phash, user)) { case (?l) l; case null [] };
    var pendingJobs = 0;
    var reserved = 0;
    for (jid in Map.keys(pending)) switch (Map.get(jobs, Map.nhash, jid)) {
      case (?j) if (j.user == user) { pendingJobs += 1; reserved += j.price_e8s };
      case null {};
    };
    let (threshold, alerted) = lowBalanceSetting(user);
    #ok({
      balance_e8s = balanceOf(user);
      low_balance_alert = { threshold_e8s = threshold; alerted };
      settings = settingsOf(user);
      channels = userChannels(user);
      apps = Buffer.toArray(apps_of);
      requests = Array.mapFilter<Nat, App>(reqs, func(id) = Map.get(apps, Map.nhash, id));
      top_ups = Array.reverse(ups);
      history = historyOf(user, history_limit);
      pending_jobs = pendingJobs;
      reserved_e8s = reserved;
    });
  };

  // ---------------------------------------------------------------------------------------------
  // ICRC-3 interface (spec/notifications_icrc3.md)
  // ---------------------------------------------------------------------------------------------

  public query func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult { Icrc3Log.getBlocks(icrc3, args) };
  public query func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult { Icrc3Log.getArchives(icrc3, args) };
  public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate { Icrc3Log.tipCertificate(icrc3) };
  public query func icrc3_supported_block_types() : async [T3.BlockType] { Icrc3Log.supportedBlockTypes(icrc3_catalogue) };
  public query func icrc10_supported_standards() : async [T3.SupportedStandard] { Icrc3Log.supportedStandards() };
  public query func icrc3_log_status() : async T3.LogStatus { Icrc3Log.status(icrc3, icrc3_rt) };

  public shared ({ caller }) func admin_set_icrc3_settings(u : T3.SettingsUpdate) : async { #Ok : T3.Settings; #Err : Text } {
    if (not isAdmin(caller)) return #Err("Admins only");
    switch (Icrc3Log.applySettings(icrc3, u)) {
      case (#Err(e)) #Err(e);
      case (#Ok(changes)) {
        for ((key, old, new) in changes.vals()) configBlock(#caller(caller), key, #Nat(old), #Nat(new));
        #Ok(icrc3.settings);
      };
    };
  };

  public shared ({ caller }) func admin_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
    if (not isAdmin(caller)) return #Err("Admins only");
    if (icrc3_rt.spilling) return #Err("A spill is already in progress");
    #Ok(await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), true));
  };

  public shared ({ caller }) func admin_icrc3_repair_archive_controllers() : async [(Principal, { #Ok; #Err : Text })] {
    if (not isAdmin(caller)) trap("Admins only");
    await* Icrc3Log.repairArchiveControllers(icrc3, icrc3_env());
  };

  /// Admins: the log's operational messages (spills, archives created, failures), oldest first.
  public query ({ caller }) func get_log(start : Nat, length : Nat) : async [NT.LogEntry] {
    if (not isAdmin(caller)) trap("Admins only");
    TextLog.get(icrc3_textlog, start, length);
  };

  func icrc3_timer_job() : async () { ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false) };
  func ensure_icrc3_timer<system>() { Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job) };
  ensure_icrc3_timer<system>();

  // get_api_doc (ICP service discoverability): a short Markdown guide for agents and integrators,
  // with the full reference at https://app.sneeddao.com/api-docs/. A static text: no state read.
  public query func get_api_doc() : async Text { ApiDoc.text };

  // ---------------------------------------------------------------------------------------------
  // Ingress guard (src/IngressGuard.mo)
  // ---------------------------------------------------------------------------------------------

  system func inspect({ caller : Principal; arg : Blob; msg : {
    #get_api_doc : Any;
    #add_channel : Any;
    #admin_add_admin : Any;
    #admin_register_app : Any;
    #admin_set_relay_key : Any;
    #get_relay_keys : Any;
    #admin_remove_admin : Any;
    #admin_remove_app : Any;
    #admin_set_app_verified : Any;
    #admin_set_config : Any;
    #allow_app : Any;
    #get_admins : Any;
    #get_app : Any;
    #get_app_balance : Any;
    #get_app_of : Any;
    #get_config : Any;
    #get_my_apps : Any;
    #get_my_history : Any;
    #get_my_requests : Any;
    #get_my_settings : Any;
    #get_receipts : Any;
    #list_apps : Any;
    #notify : Any;
    #notify_batch : Any;
    #register_app : Any;
    #relay_ack : Any;
    #relay_pull : Any;
    #remove_channel : Any;
    #request_permission : Any;
    #set_permission : Any;
    #set_settings : Any;
    #stats : Any;
    #top_up : Any;
    #top_up_app : Any;
    #update_app : Any;
    #verify_channel : Any;
    #resend_code : Any;
    #set_low_balance_alert : Any;
    #get_low_balance_alert : Any;
    #get_fee_forwarding : Any;
    #admin_set_fee_destination : Any;
    #admin_set_fee_sweep_threshold : Any;
    #admin_forward_fees_now : Any;
    #icrc3_get_blocks : Any;
    #icrc3_get_archives : Any;
    #icrc3_get_tip_certificate : Any;
    #icrc3_supported_block_types : Any;
    #icrc10_supported_standards : Any;
    #icrc3_log_status : Any;
    #get_log : Any;
    #admin_set_icrc3_settings : Any;
    #admin_icrc3_spill_now : Any;
    #admin_icrc3_repair_archive_controllers : Any;
    #admin_credit : Any;
    #admin_get_user : Any;
    #admin_get_removed_app : Any;
    #claim_removed_app_balance : Any;
  } }) : Bool {
    switch msg {
      case (#get_api_doc _ or #get_relay_keys _ or #get_admins _ or #get_app _ or #get_app_balance _ or #get_app_of _ or #get_config _ or #get_my_apps _ or #get_my_history _ or #get_my_requests _ or #get_my_settings _ or #get_low_balance_alert _ or #get_receipts _ or #list_apps _ or #stats _ or #get_fee_forwarding _) false;
      case (#icrc3_get_blocks _ or #icrc3_get_archives _ or #icrc3_get_tip_certificate _ or #icrc3_supported_block_types _ or #icrc10_supported_standards _ or #icrc3_log_status _ or #get_log _) false;
      case (#admin_get_user _ or #admin_get_removed_app _) false;
      // apps call these from their canisters, never by ingress
      case (#notify _ or #notify_batch _ or #request_permission _) false;
      case (#admin_add_admin _ or #admin_remove_admin _ or #admin_remove_app _ or #admin_set_app_verified _ or #admin_set_fee_destination _ or #admin_set_fee_sweep_threshold _ or #admin_forward_fees_now _ or #admin_set_icrc3_settings _ or #admin_icrc3_spill_now _ or #admin_icrc3_repair_archive_controllers _ or #admin_credit _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#admin_set_config _ or #admin_register_app _ or #admin_set_relay_key _) isAdmin(caller) and arg.size() <= IngressGuard.MEDIUM_ARG;
      case (#register_app _ or #update_app _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.MEDIUM_ARG;
      case (#relay_ack _) relayKind(caller) != null and arg.size() <= IngressGuard.MEDIUM_ARG;
      case (#relay_pull _) relayKind(caller) != null and arg.size() <= IngressGuard.SMALL_ARG;
      case (#add_channel _ or #set_settings _ or #set_permission _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.textArg(MAX_ADDRESS + 256);
      case _ not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.SMALL_ARG;
    };
  };
};
