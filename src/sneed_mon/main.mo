import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Char "mo:base/Char";
import Cycles "mo:base/ExperimentalCycles";
import Debug "mo:base/Debug";
import Error "mo:base/Error";
import Int "mo:base/Int";
import Int32 "mo:base/Int32";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Timer "mo:base/Timer";
import Map "mo:map/Map";

import IngressGuard "../IngressGuard";
import SP "../SpecialPrices";
import SnsDirectory "../sneed_names/SnsDirectory";
import TextLog "../sneed_names/TextLog";
import NT "../sneed_names/Types";
import Icrc3Log "../icrc3/Log";
import T3 "../icrc3/Types";
import ApiDoc "ApiDoc";
import T "Types";

/// sneed_mon (spec/sneed_mon.md): Sneed Hub's watcher, registered with Sneed Notifications as the
/// app "Sneed Monitor". Users watch SNSes or the NNS (`watch(target)`; pro users tune a watch with
/// `update_watch`). A target is polled as often as its most frequent active watcher wants; each
/// new proposal's ballots are read once and matched against every watcher's cached neurons, and
/// each watch is checked (and charged, per its frequency tier) when due: its waiting proposals go
/// out as one message per topic, "you can vote" (`proposals`) and "closes soon"
/// (`proposal_deadlines`). NNS neurons are registered by id and read with get_neuron_info when a
/// check is due. Watching is paid from a prepaid ICP balance per user; when a check can't be paid
/// the user's watches pause (topic `account` says so once).
shared (deployer) persistent actor class SneedMon() = this {

  public type MonTopic = T.MonTopic;
  public type Target = T.Target;
  public type TopicFilter = T.TopicFilter;
  public type WatchSettings = T.WatchSettings;
  public type WatchSettingsInput = T.WatchSettingsInput;
  public type Watch = T.Watch;
  public type OpenP = T.OpenP;
  public type TargetState = T.TargetState;
  public type Pending = T.Pending;
  public type PendingKind = T.PendingKind;
  public type NeuronCache = T.NeuronCache;
  public type TopicOption = T.TopicOption;
  public type Tuning = T.Tuning;
  public type MyWatch = T.MyWatch;
  public type TargetInfo = T.TargetInfo;
  public type Backlog = T.Backlog;
  public type Period = T.Period;
  public type Economics = T.Economics;
  public type PassState = T.PassState;
  public type OpenProposal = T.OpenProposal;
  public type WatchedSns = T.WatchedSns;
  public type Config = T.Config;
  public type Status = T.Status;
  public type Result = T.Result;
  public type ResultNat = T.ResultNat;
  public type BillingConfig = T.BillingConfig;
  public type Tier = T.Tier;
  public type TierTable = T.TierTable;
  public type TierPrice = T.TierPrice;
  public type UserAccount = T.UserAccount;
  public type ChargeEntry = T.ChargeEntry;
  public type MyBalance = T.MyBalance;
  public type Accounting = T.Accounting;
  public type Account = T.Account;
  public type CreditResult = T.CreditResult;
  public type MonPrices = T.MonPrices;
  public type MonPartner = T.MonPartner;
  public type MonPartnerListing = T.MonPartnerListing;
  public type SpecialPrices = T.SpecialPrices;
  public type SpecialPricesFor = T.SpecialPricesFor;
  public type SpResult = T.SpResult;
  public type ChargeEntryTiered = T.ChargeEntryTiered;
  public type AutoTopUpSettings = T.AutoTopUpSettings;
  public type TopUpFailure = T.TopUpFailure;
  public type MyAutoTopUp = T.MyAutoTopUp;

  // ---------------------------------------------------------------------------------------------
  // State (enhanced orthogonal persistence, like sneed_notifications)
  // ---------------------------------------------------------------------------------------------

  let PERMISSION_VOTE : Int32 = 4;
  let ACCEPT_VOTES : Int32 = 1; // reward status: still open for votes (keeps listings small)
  let NEURON_PAGE : Nat = 100;
  let PROPOSAL_PAGE : Nat = 50;
  transient let NNS_PAGE : Nat = 100;
  transient let MAX_OPEN_PER_TARGET : Nat = 100;
  let MAX_FAILS : Nat = 3;
  // constants of the 1bbee49a build, kept (stable lets can't be dropped without a migration); new
  // constants are transient, so a changed value takes effect on upgrade
  let MAX_OPEN_PER_SNS : Nat = 50;
  let LINK_BASE = "https://app.sneeddao.com/proposal?proposalid=";
  let MIN_INTERVAL_S : Nat = 60;
  transient let NNS_MIN_DISSOLVE_S : Nat64 = 15_778_800; // six months: the NNS's minimum to vote
  let STALE_RUN_NS : Int = 900_000_000_000; // a run that trapped mid-way frees the lock after 15 min
  transient let SLACK_NS : Int = 60_000_000_000; // due a minute early (timer jitter)
  transient let MIN_NS : Nat = 60_000_000_000;
  transient let HOUR_NS : Nat = 3_600_000_000_000;
  transient let DIGEST_LINES : Nat = 10;
  transient let MAX_CHARGES_KEPT : Nat = 200;
  transient let HOURS_KEPT : Nat = 720; // 30 days of hourly economics
  let TOPIC_PROPOSALS = "proposals";
  transient let TOPIC_DEADLINES = "proposal_deadlines";
  transient let TOPIC_ACCOUNT = "account";
  transient let APP_NAME = "Sneed Monitor";
  transient let NNS_KEY = "nns";
  transient let SITE = "https://app.sneeddao.com";
  transient let WINDOWS_S : [Nat] = [3_600, 14_400, 43_200, 86_400, 172_800];

  var config : Config = {
    notifications = ?Principal.fromText("vuy7a-iaaaa-aaaay-aaduq-cai");
    sns_wasm = Principal.fromText(SnsDirectory.SNS_W_MAINNET);
    interval_s = 600;
    paused = false;
    sponsored = false;
    max_users = 1_000;
    max_watches_per_user = 10;
    max_snses = 100; // watched targets (SNSes and the NNS)
    max_calls_per_tick = 200;
    max_continuations = 10;
    reminder_window_s = 86_400; // unused: watches carry their own window (tuning.defaults)
    batch_size = 50;
    neuron_pages = 3;
    proposal_pages = 3;
    neuron_cache_s = 3_600; // unused: tuning.neuron_refresh_s
  };
  var admins : [Principal] = [];
  var app_id : ?Nat = null;

  // legacy state of the 1bbee49a build: moved into `targets` / `watches` by postupgrade, then empty
  let snses = Map.new<Principal, WatchedSns>();
  let user_watches = Map.new<Principal, [Principal]>();
  let directory : SnsDirectory.State = SnsDirectory.init();

  var tuning : Tuning = {
    nns_governance = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
    defaults = { every_min = 60; topics = #all; new_proposals = true; reminders = true; reminder_window_s = 86_400 };
    neuron_refresh_s = 21_600;
    max_refresh_per_round = 100;
    parallel_calls = 20;
    max_nns_neurons = 20;
    user_refresh_min_s = 600;
    max_pending_per_user = 200;
    topic_cache_s = 86_400;
  };
  let targets = Map.new<Text, TargetState>(); // target key -> state
  let watches = Map.new<Principal, [Watch]>(); // user -> watches
  let pending = Map.new<Principal, [Pending]>(); // user -> proposals waiting for the watch's next check
  let user_neurons = Map.new<Text, NeuronCache>(); // "user/target key" -> SNS vote neurons
  let nns_neurons = Map.new<Principal, [Nat64]>(); // user -> registered NNS neuron ids
  let topic_options = Map.new<Text, (Int, [TopicOption])>(); // target key -> (read at, options)

  // billing (spec §3): per check, priced by the watch's frequency tier
  var billing : BillingConfig = {
    icp_ledger = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
    ledger_fee_e8s = 10_000;
    // the account Sneed Premium pays into (its getConfig().paymentRecipient): the Neutrinite
    // pylon's ICP splitter, node 6, which feeds the RLL
    fee_destination = ?{ owner = Principal.fromText("6jvpj-sqaaa-aaaaj-azwnq-cai"); subaccount = ?Blob.fromArray([1, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) };
    fee_sweep_threshold_e8s = 10_000_000; // 0.1 ICP
  };
  var tier_table : TierTable = {
    base_daily_price_e8s = 144_000; // 0.00144 ICP a day for a daily watch; per check: 10 min 6,000, 1 h 18,000, 3 h 36,000, 1 day 144,000 e8s
    tiers = [{ every_min = 10; daily_multiplier = 6 }, { every_min = 60; daily_multiplier = 3 }, { every_min = 180; daily_multiplier = 2 }, { every_min = 1440; daily_multiplier = 1 }];
  };
  let accounts = Map.new<Principal, UserAccount>();
  let charges = Map.new<Principal, [ChargeEntry]>(); // user -> the last MAX_CHARGES_KEPT checks, oldest first
  // special prices (spec/special_prices.md; added after f9d8db0b, empty on upgrade = no effect)
  var admin_prices : MonPrices = { base_daily_price_e8s = null };
  let partner_prices = Map.new<Principal, SP.Partner<MonPrices>>();
  // user -> the price tier of each entry in `charges`, aligned from the newest end (entries from
  // before special prices have none and were regular)
  let charge_tiers = Map.new<Principal, [SP.Tier]>();
  var fees_collected_e8s : Nat = 0;
  var fees_withdrawn_e8s : Nat = 0;
  var fees_forwarded_e8s : Nat = 0;
  var fee_forwards : Nat = 0;
  var deposits_e8s : Nat = 0;
  var withdrawals_e8s : Nat = 0;
  // auto top-up (spec §3; added after 6cfabb63, empty on upgrade = off for everyone): user -> settings
  // and counters. Pulls go from the user's wallet straight into the main account and are credited.
  let auto_top_ups = Map.new<Principal, T.AutoTopUp>();
  var auto_top_ups_n : Nat = 0;
  var auto_top_ups_e8s : Nat = 0;
  transient let MAX_PULLS_PER_ROUND : Nat = 50;
  transient let TOP_UP_RETRY_NS : Int = 86_400_000_000_000; // a refused pull is retried after a day
  transient let MAX_TOP_UP_E8S : Nat = 10_000_000_000; // 100 ICP

  // economics: does the monitor pay for itself? (hourly buckets for the windows)
  let hours = Map.new<Nat, Period>();
  var econ_total : Period = { cycles_burned = 0; revenue_e8s = 0; checks = 0; rounds = 0 };
  var last_round_cycles : Nat = 0;

  var round_no : Nat = 0;
  var last_round_start : Int = 0;
  var last_round_end : Int = 0;
  var last_round_duration : Int = 0;
  var calls_total : Nat = 0;
  var calls_last_round : Nat = 0;
  var sent : Nat = 0;
  var deduplicated : Nat = 0;
  var skipped_not_allowed : Nat = 0;
  var skipped_rate_limited : Nat = 0;
  var skipped_other : Nat = 0;
  var errors : Nat = 0;
  var last_error : ?(Int, Text) = null;
  /// The last RECENT_ERRORS_KEPT errors, newest last (get_recent_errors, admins).
  var recent_errors : [(Int, Text)] = [];
  transient let RECENT_ERRORS_KEPT : Nat = 30;
  /// The round phase running now (prefixes the errors noted meanwhile).
  transient var phase_name : Text = "";
  /// Outgoing calls: what one holds while in flight (its fee plus the cycles the IC reserves for
  /// the largest possible response, measured at each send) and the balance at which the last
  /// send failed (call_perform refused it: too few cycles above the freezing threshold, or a full
  /// queue). A round sends a call more only while the balance is above that floor, unless
  /// nothing is in flight (then it tries, so a stale floor can't stop it for good).
  transient var call_reserve : Nat = 0;
  transient var call_floor : Nat = 0;
  var send_failures : Nat = 0;

  // per round, rebuilt after an upgrade (every phase is idempotent, so a round just goes on)
  transient var round_open = false;
  transient var round_ticks : Nat = 0;
  transient var round_cycles : Nat = 0;
  transient var budget : Nat = 0;
  transient var continuations : Nat = 0;
  transient var running_since : ?Int = null;
  transient var notify_broken = false; // the notifications canister refused us: no more checks this round
  transient var notices_done = false;
  transient var refreshed_this_round : Nat = 0;
  transient var fees_checked_round : Nat = 0;
  transient var pulls_this_round : Nat = 0;
  transient let nns_info = Map.new<Principal, [(Nat64, ?T.NnsNeuronInfo)]>(); // this round's NNS neuron reads
  // users with a ledger call under way (credit_deposit, withdraw_balance), and the fee withdrawal
  transient let in_flight = Map.new<Principal, ()>();
  transient var fees_in_flight = false;

  // ---------------------------------------------------------------------------------------------
  // ICRC-3 activity log (spec/sneed_mon.md §9; library src/icrc3): money (deposits, withdrawals,
  // auto top-ups, the charges of each round, fee forwarding and withdrawals), pauses and resumes,
  // prices, tiers, configuration and admins. Never which proposals or targets anyone watches.
  // Charges are aggregated: one block per round that charged anything, never one per check.
  // Enhanced orthogonal persistence: new stable variables, so the upgrade starts an empty log.
  // ---------------------------------------------------------------------------------------------

  var icrc3 : Icrc3Log.State = Icrc3Log.init();
  transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();
  // operational messages of the log (spills, archive creation, failures); admins read them with get_log
  let icrc3_textlog : TextLog.State = TextLog.init();
  transient let SNEED_SNS_ROOT : Principal = Principal.fromText("fp274-iaaaa-aaaaq-aacha-cai");
  // the round whose charges are being added up (stable: a round cut short by an upgrade is still logged)
  var icrc3_round_no : Nat = 0;
  var icrc3_round_checks : Nat = 0;
  var icrc3_round_charged_e8s : Nat = 0;
  let icrc3_round_users = Map.new<Principal, (Nat, Nat)>(); // user -> (charged e8s, checks) this round
  // a round block names each user's total only while the round charged at most this many users
  transient let ROUND_USERS_LOGGED : Nat = 20;

  transient let icrc3_catalogue : Icrc3Log.Config = {
    block_types_url = "https://app.sneeddao.com/api/sneed_mon#block-types";
    block_types = [
      "sneedmon_deposit",
      "sneedmon_withdraw",
      "sneedmon_auto_top_up",
      "sneedmon_round_charges",
      "sneedmon_user_pause",
      "sneedmon_user_resume",
      "sneedmon_fee_forward",
      "sneedmon_fee_withdraw",
      "sneedmon_admin_add",
      "sneedmon_admin_remove",
      "sneedmon_config_update",
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

  /// Who made a logged change: a call (its caller) or the round timer.
  type By = { #caller : Principal; #timer };

  /// Appends one block `sneedmon_<btype>`: `caller` first, or `via` = "timer".
  func block(btype : Text, by : By, tx : [(Text, T3.Value)]) {
    let who : (Text, T3.Value) = switch by {
      case (#caller(p)) ("caller", Icrc3Log.principal(p));
      case (#timer) ("via", #Text("timer"));
    };
    ignore Icrc3Log.append(icrc3, "sneedmon_" # btype, Int.abs(Time.now()), Array.append<(Text, T3.Value)>([who], tx));
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
  func optPrincipalV(p : ?Principal) : T3.Value = switch p { case (?x) pv(x); case null #Text("none") };
  func optNatV(n : ?Nat) : T3.Value = switch n { case (?x) #Nat(x); case null #Text("none") };
  func flag(b : Bool) : T3.Value = #Nat(if b 1 else 0);
  func settingsV(w : WatchSettings) : T3.Value = #Map([
    ("every_min", #Nat(w.every_min)),
    ("topics", switch (w.topics) { case (#all) #Text("all"); case (#only(ks)) #Array(Array.map<Text, T3.Value>(ks, func(k) = #Text(k))) }),
    ("new_proposals", flag(w.new_proposals)), ("reminders", flag(w.reminders)), ("reminder_window_s", #Nat(w.reminder_window_s)),
  ]);

  func coreValues(c : Config) : [(Text, T3.Value)] = [
    ("notifications", optPrincipalV(c.notifications)), ("sns_wasm", pv(c.sns_wasm)), ("interval_s", #Nat(c.interval_s)),
    ("paused", flag(c.paused)), ("sponsored", flag(c.sponsored)), ("max_users", #Nat(c.max_users)),
    ("max_watches_per_user", #Nat(c.max_watches_per_user)), ("max_snses", #Nat(c.max_snses)), ("max_calls_per_tick", #Nat(c.max_calls_per_tick)),
    ("max_continuations", #Nat(c.max_continuations)), ("reminder_window_s", #Nat(c.reminder_window_s)), ("batch_size", #Nat(c.batch_size)),
    ("neuron_pages", #Nat(c.neuron_pages)), ("proposal_pages", #Nat(c.proposal_pages)), ("neuron_cache_s", #Nat(c.neuron_cache_s)),
  ];
  func tuningValues(t : Tuning) : [(Text, T3.Value)] = [
    ("nns_governance", pv(t.nns_governance)), ("defaults", settingsV(t.defaults)), ("neuron_refresh_s", #Nat(t.neuron_refresh_s)),
    ("max_refresh_per_round", #Nat(t.max_refresh_per_round)), ("parallel_calls", #Nat(t.parallel_calls)), ("max_nns_neurons", #Nat(t.max_nns_neurons)),
    ("user_refresh_min_s", #Nat(t.user_refresh_min_s)), ("max_pending_per_user", #Nat(t.max_pending_per_user)), ("topic_cache_s", #Nat(t.topic_cache_s)),
  ];
  func billingValues(b : BillingConfig) : [(Text, T3.Value)] = [
    ("icp_ledger", pv(b.icp_ledger)), ("ledger_fee_e8s", #Nat(b.ledger_fee_e8s)), ("fee_destination", optAccountV(b.fee_destination)),
    ("fee_sweep_threshold_e8s", #Nat(b.fee_sweep_threshold_e8s)),
  ];
  func tierValues(t : TierTable) : [(Text, T3.Value)] = [
    ("base_daily_price_e8s", #Nat(t.base_daily_price_e8s)),
    ("tiers", #Array(Array.map<Tier, T3.Value>(t.tiers, func(x) = #Map([("every_min", #Nat(x.every_min)), ("daily_multiplier", #Nat(x.daily_multiplier))])))),
  ];
  func pricesV(p : MonPrices) : T3.Value = SP.overridesValue([("base_daily_price_e8s", p.base_daily_price_e8s)]);
  func partnerV(e : MonPartner) : T3.Value = SP.partnerValue(e.label_, [("base_daily_price_e8s", e.prices.base_daily_price_e8s)], e.expires_at);

  /// A check charged and kept (not refunded): added to the round's totals.
  func roundCharge(u : Principal, price : Nat) {
    icrc3_round_no := round_no;
    icrc3_round_checks += 1;
    icrc3_round_charged_e8s += price;
    let (c, n) = switch (Map.get(icrc3_round_users, Map.phash, u)) { case (?x) x; case null (0, 0) };
    Map.set(icrc3_round_users, Map.phash, u, (c + price, n + 1));
  };

  /// The round's charges as one block (nothing when it charged nothing): checks, total, users, and
  /// each user's total and checks when at most ROUND_USERS_LOGGED users were charged.
  func flushRoundCharges() {
    if (icrc3_round_checks > 0) {
      let users = Map.size(icrc3_round_users);
      let base : [(Text, T3.Value)] = [("round", #Nat(icrc3_round_no)), ("checks", #Nat(icrc3_round_checks)), ("charged_e8s", #Nat(icrc3_round_charged_e8s)), ("users", #Nat(users))];
      block("round_charges", #timer, if (users <= ROUND_USERS_LOGGED) Array.append(base, [("per_user", #Array(Iter.toArray(Iter.map<(Principal, (Nat, Nat)), T3.Value>(Map.entries(icrc3_round_users), func((u, (c, n))) = #Array([pv(u), #Nat(c), #Nat(n)])))))]) else base);
    };
    icrc3_round_checks := 0;
    icrc3_round_charged_e8s := 0;
    Map.clear(icrc3_round_users);
  };

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  func now() : Int = Time.now();
  func nowS() : Nat64 = Nat64.fromNat(Int.abs(now()) / 1_000_000_000);
  func isAdmin(p : Principal) : Bool = Principal.isController(p) or Array.find<Principal>(admins, func(a) = a == p) != null;
  func has(xs : [Principal], p : Principal) : Bool = Array.find<Principal>(xs, func(x) = x == p) != null;
  func hasNat(xs : [Nat], n : Nat) : Bool = Array.find<Nat>(xs, func(x) = x == n) != null;
  func gov(p : Principal) : T.Governance = actor (Principal.toText(p));
  func nnsGov() : T.NnsGovernance = actor (Principal.toText(tuning.nns_governance));
  func spend() { if (budget > 0) budget -= 1; calls_total += 1; calls_last_round += 1 };
  func spendBudget() { if (budget > 0) budget -= 1 };
  func par() : Nat = Nat.max(1, Nat.min(Nat.min(tuning.parallel_calls, 50), budget));

  func targetKey(t : Target) : Text = switch t { case (#sns(r)) Principal.toText(r); case (#nns) NNS_KEY };
  func isNns(key : Text) : Bool = key == NNS_KEY;
  func watchesOf(u : Principal) : [Watch] = switch (Map.get(watches, Map.phash, u)) { case (?w) w; case null [] };
  func findWatch(u : Principal, key : Text) : ?Watch = Array.find<Watch>(watchesOf(u), func(w) = targetKey(w.target) == key);
  func updateWatch(u : Principal, key : Text, f : Watch -> Watch) {
    Map.set(watches, Map.phash, u, Array.map<Watch, Watch>(watchesOf(u), func(w) = if (targetKey(w.target) == key) f(w) else w));
  };
  func pendingOf(u : Principal) : [Pending] = switch (Map.get(pending, Map.phash, u)) { case (?p) p; case null [] };
  func setPending(u : Principal, ps : [Pending]) = if (ps.size() == 0) Map.delete(pending, Map.phash, u) else Map.set(pending, Map.phash, u, ps);
  func cacheKey(u : Principal, key : Text) : Text = Principal.toText(u) # "/" # key;
  func nnsNeuronsOf(u : Principal) : [Nat64] = switch (Map.get(nns_neurons, Map.phash, u)) { case (?n) n; case null [] };

  let HEX : [Char] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
  func hex(b : Blob) : Text {
    var t = "";
    for (x in b.vals()) { let n = Nat8.toNat(x); t #= Char.toText(HEX[n / 16]) # Char.toText(HEX[n % 16]) };
    t;
  };

  func clip(t : Text, max : Nat) : Text {
    if (t.size() <= max) return t;
    var out = "";
    var i = 0;
    label l for (c in t.chars()) { if (i + 1 >= max) break l; out #= Char.toText(c); i += 1 };
    out # "…";
  };

  /// Room for one more call in flight next to `inFlight` others.
  func roomForCall(inFlight : Nat) : Bool = inFlight == 0 or Cycles.balance() > call_floor + call_reserve;
  /// A call was sent; `before` is the balance just before.
  func callSent(before : Nat) {
    let after = Cycles.balance();
    if (before > after) call_reserve := before - after;
    if (before <= call_floor) call_floor := 0; // the floor was wrong
    calls_total += 1; calls_last_round += 1;
  };
  /// A call could not be sent (the call expression threw: ic0.call_perform failed).
  func sendFailed(what : Text, key : ?Text, e : Error.Error) {
    call_floor := Cycles.balance();
    send_failures += 1;
    noteError(key, what # " not sent (" # Nat.toText(Cycles.balance()) # " cycles left, ~" # Nat.toText(call_reserve) # " held per call in flight): " # Error.message(e));
  };

  func noteError(key : ?Text, raw : Text) {
    let msg = if (phase_name == "") raw else phase_name # ": " # raw;
    errors += 1;
    last_error := ?(now(), msg);
    let kept = Array.append(recent_errors, [(now(), clip(msg # (switch key { case (?k) " [" # k # "]"; case null "" }), 300))]);
    recent_errors := if (kept.size() > RECENT_ERRORS_KEPT) Array.subArray<(Int, Text)>(kept, (kept.size() - RECENT_ERRORS_KEPT : Nat), RECENT_ERRORS_KEPT) else kept;
    switch (key) {
      case (?k) switch (Map.get(targets, Map.thash, k)) {
        case (?s) Map.set(targets, Map.thash, k, { s with last_error = ?(now(), msg); errors = s.errors + 1 });
        case null {};
      };
      case null {};
    };
  };

  func deadlineOf(created : Nat64, initial : Nat64, wfq : ?{ current_deadline_timestamp_seconds : Nat64 }) : Nat64 = switch wfq {
    case (?w) w.current_deadline_timestamp_seconds;
    case null created + initial;
  };

  /// The deadline is within `window` seconds (and still ahead).
  func within(deadline : Nat64, window : Nat) : Bool {
    let t = nowS();
    deadline > t and Nat64.toNat(deadline - t) <= window;
  };

  func hoursLeft(deadline : Nat64) : Text {
    let t = nowS();
    if (deadline <= t) return "now";
    let h = Nat64.toNat(deadline - t) / 3600;
    if (h == 0) "in less than an hour" else if (h == 1) "in about 1 hour" else "in about " # Nat.toText(h) # " hours";
  };

  func snsTopicName(t : T.SnsTopic) : Text = switch t {
    case (#DaoCommunitySettings) "DaoCommunitySettings";
    case (#SnsFrameworkManagement) "SnsFrameworkManagement";
    case (#DappCanisterManagement) "DappCanisterManagement";
    case (#ApplicationBusinessLogic) "ApplicationBusinessLogic";
    case (#Governance) "Governance";
    case (#TreasuryAssetManagement) "TreasuryAssetManagement";
    case (#CriticalDappOperations) "CriticalDappOperations";
  };

  func topicOk(s : WatchSettings, p : OpenP) : Bool = switch (s.topics) {
    case (#all) true;
    case (#only(keys)) Array.find<Text>(keys, func(k) = k == p.topic_key or (p.fn_key != "" and k == p.fn_key)) != null;
  };

  func sortedInsert(xs : [Principal], p : Principal) : [Principal] {
    if (has(xs, p)) return xs;
    Array.sort<Principal>(Array.append(xs, [p]), Principal.compare);
  };

  func isDue(w : Watch) : Bool = now() - w.last_check_at + SLACK_NS >= w.settings.every_min * MIN_NS;

  /// The fastest frequency among the target's active (not paused) watchers; null: nobody active,
  /// the target is not polled.
  func activeEvery(s : TargetState) : ?Nat {
    var best : ?Nat = null;
    for (u in s.watchers.vals()) if (not isPausedUser(u)) switch (findWatch(u, s.key)) {
      case (?w) best := switch best { case (?b) ?Nat.min(b, w.settings.every_min); case null ?w.settings.every_min };
      case null {};
    };
    best;
  };

  // ---------------------------------------------------------------------------------------------
  // Billing helpers (spec §3)
  // ---------------------------------------------------------------------------------------------

  transient let NEW_ACCOUNT : UserAccount = { balance_e8s = 0; paused = false; notice_sent = false; deposited_e8s = 0; charged_e8s = 0; withdrawn_e8s = 0; checks = 0 };

  func acct(u : Principal) : UserAccount = switch (Map.get(accounts, Map.phash, u)) { case (?a) a; case null NEW_ACCOUNT };
  func putAcct(u : Principal, a : UserAccount) = Map.set(accounts, Map.phash, u, a);
  func isPausedUser(u : Principal) : Bool = switch (Map.get(accounts, Map.phash, u)) { case (?a) a.paused; case null false };

  func tierOf(everyMin : Nat) : ?Tier = Array.find<Tier>(tier_table.tiers, func(t) = t.every_min == everyMin);
  /// floor(daily price × every_min / 1440): a day of checks never costs more than the tier's daily price.
  func perCheckAt(base : Nat, everyMin : Nat) : Nat = switch (tierOf(everyMin)) {
    case (?t) base * t.daily_multiplier * everyMin / 1440;
    case null 0;
  };
  func perCheck(everyMin : Nat) : Nat = perCheckAt(tier_table.base_daily_price_e8s, everyMin);
  /// The admin price applies to people on the admin list (controllers and admins), never canisters.
  func getsAdminPrice(u : Principal) : Bool = isAdmin(u) and SP.isPerson(u);
  /// What `u` pays per check of a watch at `everyMin`, and the price tier: the lowest of the regular
  /// price, the admin price (admins) and the partner price (active partner entry), each the base
  /// daily price override times the tier's multiplier.
  func priceFor(u : Principal, everyMin : Nat) : (Nat, SP.Tier) {
    let adminP : ?Nat = if (getsAdminPrice(u)) switch (admin_prices.base_daily_price_e8s) { case (?b) ?perCheckAt(b, everyMin); case null null } else null;
    let partnerP : ?Nat = switch (SP.activePartner(partner_prices, u, now())) {
      case (?e) switch (e.prices.base_daily_price_e8s) { case (?b) ?perCheckAt(b, everyMin); case null null };
      case null null;
    };
    SP.lowest(perCheck(everyMin), null, adminP, partnerP);
  };
  func perCheckFor(u : Principal, everyMin : Nat) : Nat = priceFor(u, everyMin).0;
  func tierPrices() : [TierPrice] = Array.map<Tier, TierPrice>(tier_table.tiers, func(t) = {
    every_min = t.every_min; daily_multiplier = t.daily_multiplier; daily_price_e8s = tier_table.base_daily_price_e8s * t.daily_multiplier;
    per_check_e8s = perCheck(t.every_min); checks_per_day = 1440 / t.every_min;
  });

  /// One check of each of these watches: the least balance to start or resume watching.
  func checksCost(u : Principal, ws : [Watch]) : Nat {
    var c = 0;
    for (w in ws.vals()) c += perCheckFor(u, w.settings.every_min);
    c;
  };
  func dailyCost(u : Principal, ws : [Watch]) : Nat {
    var c = 0;
    for (w in ws.vals()) c += perCheckFor(u, w.settings.every_min) * (1440 / w.settings.every_min);
    c;
  };

  /// The balance can't pay a check: the user's watches are kept but not checked (nor charged), their
  /// waiting proposals dropped, and one notice is due.
  func pauseUser(u : Principal, price : Nat) {
    putAcct(u, { acct(u) with paused = true; notice_sent = false });
    Map.delete(pending, Map.phash, u);
    block("user_pause", #timer, [("user", pv(u)), ("balance_e8s", #Nat(acct(u).balance_e8s)), ("price_e8s", #Nat(price))]);
  };

  /// A paused user whose balance pays one check of each watch is checked again from the next round.
  func maybeResume(u : Principal, by : By) : Bool {
    let a = acct(u);
    if (not a.paused) return false;
    if (a.balance_e8s < checksCost(u, watchesOf(u))) return false;
    putAcct(u, { a with paused = false; notice_sent = false });
    block("user_resume", by, [("user", pv(u)), ("balance_e8s", #Nat(a.balance_e8s))]);
    true;
  };

  /// Charge one check. false (and nothing charged) when the balance can't pay it.
  func chargeCheck(u : Principal, price : Nat) : Bool {
    let a = acct(u);
    if (a.balance_e8s < price) return false;
    putAcct(u, { a with balance_e8s = a.balance_e8s - price : Nat; charged_e8s = a.charged_e8s + price; checks = a.checks + 1 });
    fees_collected_e8s += price;
    true;
  };

  /// A check that could not be carried out on our side (Sneed Notifications unavailable) is refunded.
  func refundCheck(u : Principal, price : Nat) {
    let a = acct(u);
    putAcct(u, { a with balance_e8s = a.balance_e8s + price; charged_e8s = a.charged_e8s - price : Nat; checks = a.checks - 1 : Nat });
    fees_collected_e8s -= price;
  };

  func addCharge(u : Principal, e : ChargeEntry, tier : SP.Tier) {
    let cur = switch (Map.get(charges, Map.phash, u)) { case (?c) c; case null [] };
    let all = Array.append(cur, [e]);
    Map.set(charges, Map.phash, u, if (all.size() > MAX_CHARGES_KEPT) Array.subArray<ChargeEntry>(all, (all.size() - MAX_CHARGES_KEPT : Nat), MAX_CHARGES_KEPT) else all);
    let curT = switch (Map.get(charge_tiers, Map.phash, u)) { case (?c) c; case null [] };
    let allT = Array.append(curT, [tier]);
    Map.set(charge_tiers, Map.phash, u, if (allT.size() > MAX_CHARGES_KEPT) Array.subArray<SP.Tier>(allT, (allT.size() - MAX_CHARGES_KEPT : Nat), MAX_CHARGES_KEPT) else allT);
  };

  func plus(a : Period, b : Period) : Period = {
    cycles_burned = a.cycles_burned + b.cycles_burned; revenue_e8s = a.revenue_e8s + b.revenue_e8s; checks = a.checks + b.checks; rounds = a.rounds + b.rounds;
  };
  transient let ZERO : Period = { cycles_burned = 0; revenue_e8s = 0; checks = 0; rounds = 0 };

  func addEconomics(d : Period) {
    econ_total := plus(econ_total, d);
    let h = Int.abs(now()) / HOUR_NS;
    switch (Map.get(hours, Map.nhash, h)) {
      case (?p) Map.set(hours, Map.nhash, h, plus(p, d));
      case null {
        // a new hour: forget the ones older than 30 days
        let old = Iter.toArray(Iter.filter<Nat>(Map.keys(hours), func(k) = k + HOURS_KEPT <= h));
        for (k in old.vals()) Map.delete(hours, Map.nhash, k);
        Map.set(hours, Map.nhash, h, d);
      };
    };
  };

  func window(nHours : Nat) : Period {
    let h = Int.abs(now()) / HOUR_NS;
    var p = ZERO;
    for ((k, v) in Map.entries(hours)) if (k + nHours > h) p := plus(p, v);
    p;
  };

  func e8sText(e8s : Nat) : Text {
    let frac = Nat.toText(e8s % 100_000_000 + 100_000_000);
    Nat.toText(e8s / 100_000_000) # "." # Text.fromIter(Iter.fromArray(Array.subArray<Char>(Text.toArray(frac), 1, 8)));
  };

  /// One "monitoring paused" message per pause, to the users not told yet (topic `account`). A
  /// failed call leaves them for the next round; any answer from Sneed Notifications but
  /// not_registered / unknown_topic counts as told.
  func sendPauseNotices() : async* () {
    let n : T.Notifications = switch (config.notifications) { case (?n) actor (Principal.toText(n)); case null return };
    let due = Buffer.Buffer<Principal>(8);
    for ((u, a) in Map.entries(accounts)) if (a.paused and not a.notice_sent and watchesOf(u).size() > 0) due.add(u);
    var i = 0;
    while (i < due.size()) {
      let chunk = Array.tabulate<Principal>(Nat.min(Nat.min(config.batch_size, 100), due.size() - i), func(k) = due.get(i + k));
      i += chunk.size();
      let inputs = Array.map<Principal, T.NotifyInput>(chunk, func(u) {
        let ws = watchesOf(u);
        {
          user = u; topic = TOPIC_ACCOUNT; sponsored = config.sponsored; link = null; dedupe = null;
          title = "Monitoring paused: top up";
          body = "Your Sneed Monitor balance can't pay the next check, so it stopped watching proposals for you (" # (if (ws.size() == 1) "1 watch" else Nat.toText(ws.size()) # " watches") # "). Your watches are kept: deposit ICP and credit it (at least " # e8sText(checksCost(u, ws)) # " ICP) and monitoring resumes.";
        };
      });
      spend();
      let results = try { await n.notify_batch(inputs) } catch (e) { noteError(null, "notify_batch (pause notices): " # Error.message(e)); return };
      var k = 0;
      for (r in results.vals()) {
        if (k < chunk.size()) {
          let u = chunk[k];
          switch r {
            case (#err(#not_registered) or #err(#unknown_topic)) {}; // not told: next round, after re-registration
            case _ { let a = acct(u); if (a.paused) putAcct(u, { a with notice_sent = true }) };
          };
          switch r { case (#ok(x)) if (not x.deduplicated) sent += 1; case _ {} };
        };
        k += 1;
      };
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Users: watches
  // ---------------------------------------------------------------------------------------------

  /// Watch an SNS's or the NNS's proposals with the default settings (get_tuning().defaults: all
  /// topics, checked hourly, new proposals and reminders). That is all a user needs to do;
  /// update_watch changes the settings. You are told when one of your neurons can vote on a
  /// proposal and hasn't (SNS: neurons on which you hold the vote permission; NNS: the neuron ids
  /// you register with set_nns_neurons). Each check is charged from your balance at the watch's
  /// tier (get_tiers); the balance must pay one check of each of your watches including this one.
  /// Allow the app "Sneed Monitor" in the notification centre to receive the messages.
  public shared ({ caller }) func watch(target : Target) : async Result {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    let key = targetKey(target);
    switch (capCheck(caller, key)) { case (?e) return e; case null {} };
    let known = Map.get(targets, Map.thash, key);
    var governance = switch (known, target) { case (?s, _) s.governance; case (null, #nns) tuning.nns_governance; case (null, #sns(r)) r };
    var name = switch (known, target) { case (?s, _) s.name; case (null, #nns) "NNS"; case (null, #sns(_)) "" };
    switch (known, target) {
      case (null, #sns(root)) {
        try {
          switch (await* SnsDirectory.governanceOf(directory, config.sns_wasm, root)) {
            case (?g) governance := g;
            case null return #err("Not the root of an SNS listed by SNS-W (try again in a minute if it is new)");
          };
        } catch (e) { return #err("SNS-W did not answer: " # Error.message(e)) };
        try { name := switch ((await gov(governance).get_metadata({})).name) { case (?n) clip(n, 64); case null "" } } catch (_) {};
        if (name == "") name := "SNS " # clip(Principal.toText(root), 12);
      };
      case _ {};
    };
    // the state may have changed while we waited
    switch (capCheck(caller, key)) { case (?e) return e; case null {} };
    switch (Map.get(targets, Map.thash, key)) {
      case (?s) Map.set(targets, Map.thash, key, { s with watchers = sortedInsert(s.watchers, caller) });
      case null Map.set(targets, Map.thash, key, {
        target; key; governance; name; watchers = [caller]; open = []; max_seen_id = (0 : Nat64);
        listed_round = 0; listed_at = 0; last_polled_at = 0; last_error = null; errors = 0;
      });
    };
    let t = now();
    Map.set(watches, Map.phash, caller, Array.append(watchesOf(caller), [{ target; settings = tuning.defaults; created_at = t; last_check_at = 0; user_refresh_at = t }]));
    if (not Map.has(accounts, Map.phash, caller)) putAcct(caller, NEW_ACCOUNT);
    ignore maybeResume(caller, #caller(caller)); // capCheck made sure the balance pays a check of each watch
    // best effort: the request shows up in the user's notification centre
    switch (config.notifications, app_id) {
      case (?n, ?_) try { ignore await (actor (Principal.toText(n)) : T.Notifications).request_permission(caller) } catch (_) {};
      case _ {};
    };
    // the user's neurons: read now for an SNS (later only every neuron_refresh_s)
    switch target {
      case (#sns(_)) switch (await* readNeurons(key, governance, caller, false)) {
        case (?ids) #ok("Watching; " # Nat.toText(ids.size()) # " of your neurons can vote here");
        case null #ok("Watching; your neurons could not be read now, they will be next round");
      };
      case (#nns) {
        let n = nnsNeuronsOf(caller).size();
        if (n == 0) #ok("Watching; register your NNS neuron ids with set_nns_neurons to be told about proposals they can vote on") else #ok("Watching; " # Nat.toText(n) # " NNS neurons registered");
      };
    };
  };

  /// null when `caller` may watch `key`, else the error to answer.
  func capCheck(caller : Principal, key : Text) : ?Result {
    let mine = watchesOf(caller);
    if (findWatch(caller, key) != null) return ?#ok("Already watching");
    if (mine.size() >= config.max_watches_per_user) return ?#err("At most " # Nat.toText(config.max_watches_per_user) # " watches per user");
    if (mine.size() == 0 and Map.size(watches) >= config.max_users) return ?#err("sneed_mon is full (watcher limit); try again later");
    if (not Map.has(targets, Map.thash, key) and Map.size(targets) >= config.max_snses) return ?#err("sneed_mon watches as many SNSes as it may; try again later");
    let need = checksCost(caller, mine) + perCheckFor(caller, tuning.defaults.every_min);
    let have = acct(caller).balance_e8s;
    if (have < need) return ?#err("Top up first: one check of each of your watches costs " # e8sText(need) # " ICP and your balance is " # e8sText(have) # " ICP (send ICP to get_deposit_account, then call credit_deposit)");
    null;
  };

  public shared ({ caller }) func unwatch(target : Target) : async Result {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    let key = targetKey(target);
    let mine = watchesOf(caller);
    if (findWatch(caller, key) == null) return #ok("Not watching");
    let rest = Array.filter<Watch>(mine, func(w) = targetKey(w.target) != key);
    if (rest.size() == 0) Map.delete(watches, Map.phash, caller) else Map.set(watches, Map.phash, caller, rest);
    setPending(caller, Array.filter<Pending>(pendingOf(caller), func(p) = p.key != key));
    Map.delete(user_neurons, Map.thash, cacheKey(caller, key));
    switch (Map.get(targets, Map.thash, key)) {
      case (?s) {
        let w = Array.filter<Principal>(s.watchers, func(x) = x != caller);
        if (w.size() == 0) { Map.delete(targets, Map.thash, key); Map.delete(topic_options, Map.thash, key) } else Map.set(targets, Map.thash, key, { s with watchers = w });
      };
      case null {};
    };
    ignore maybeResume(caller, #caller(caller)); // fewer watches may fit the balance again
    #ok("Stopped watching");
  };

  /// Change a watch's settings (only the fields given). every_min: a tier of get_tiers (10, 60,
  /// 180, 1440 by default); reminder_window_s: 3600, 14400, 43200, 86400 or 172800, at least the
  /// check interval; topics: #all or #only keys from list_target_topics (1 to 50).
  public shared ({ caller }) func update_watch(target : Target, input : WatchSettingsInput) : async Result {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    let key = targetKey(target);
    let w = switch (findWatch(caller, key)) { case (?w) w; case null return #err("Not watching") };
    let s = w.settings;
    let next : WatchSettings = {
      every_min = switch (input.every_min) { case (?v) v; case null s.every_min };
      topics = switch (input.topics) { case (?v) v; case null s.topics };
      new_proposals = switch (input.new_proposals) { case (?v) v; case null s.new_proposals };
      reminders = switch (input.reminders) { case (?v) v; case null s.reminders };
      reminder_window_s = switch (input.reminder_window_s) { case (?v) v; case null s.reminder_window_s };
    };
    switch (checkSettings(next)) { case (?e) return #err(e); case null {} };
    updateWatch(caller, key, func(x) = { x with settings = next });
    #ok("Saved");
  };

  func checkSettings(s : WatchSettings) : ?Text {
    if (tierOf(s.every_min) == null) return ?("every_min is one of " # Text.join(", ", Iter.map<Tier, Text>(tier_table.tiers.vals(), func(t) = Nat.toText(t.every_min))));
    if (not hasNat(WINDOWS_S, s.reminder_window_s)) return ?"reminder_window_s is one of 3600, 14400, 43200, 86400, 172800";
    if (s.reminder_window_s < s.every_min * 60) return ?"The reminder window must be at least the check interval (a reminder could come too late)";
    switch (s.topics) {
      case (#all) {};
      case (#only(keys)) {
        if (keys.size() == 0 or keys.size() > 50) return ?"Choose 1 to 50 topics, or #all";
        for (k in keys.vals()) if (k.size() == 0 or k.size() > 64) return ?"A topic key is 1 to 64 characters";
      };
    };
    null;
  };

  func myWatch(u : Principal, w : Watch) : MyWatch {
    let key = targetKey(w.target);
    let (governance, name) = switch (Map.get(targets, Map.thash, key)) { case (?s) (s.governance, s.name); case null (tuning.nns_governance, "") };
    let (neurons, at) : (?Nat, Int) = switch (w.target) {
      case (#nns) (?nnsNeuronsOf(u).size(), 0);
      case (#sns(_)) switch (Map.get(user_neurons, Map.thash, cacheKey(u, key))) { case (?c) (?c.ids.size(), c.at); case null (null, 0) };
    };
    {
      target = w.target; topic = #proposals; governance; name; settings = w.settings;
      price_per_check_e8s = perCheckFor(u, w.settings.every_min); next_check_at = if (w.last_check_at == 0) 0 else w.last_check_at + w.settings.every_min * MIN_NS;
      pending = Array.filter<Pending>(pendingOf(u), func(p) = p.key == key).size(); neurons; neurons_at = at;
    };
  };

  public query ({ caller }) func get_my_watches() : async [MyWatch] {
    Array.map<Watch, MyWatch>(watchesOf(caller), func(w) = myWatch(caller, w));
  };

  public query ({ caller }) func get_watch(target : Target) : async ?MyWatch {
    switch (findWatch(caller, targetKey(target))) { case (?w) ?myWatch(caller, w); case null null };
  };

  /// Re-read your neurons in a watched SNS now (after adding one), at most every
  /// user_refresh_min_s per watch. NNS neurons are read when a check is due; set_nns_neurons
  /// changes which.
  public shared ({ caller }) func refresh_my_neurons(target : Target) : async ResultNat {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    let key = targetKey(target);
    let w = switch (findWatch(caller, key)) { case (?w) w; case null return #err("Not watching") };
    let governance = switch (Map.get(targets, Map.thash, key)) { case (?s) s.governance; case null return #err("Not watching") };
    switch (target) { case (#nns) return #ok(nnsNeuronsOf(caller).size()); case (#sns(_)) {} };
    if (now() - w.user_refresh_at < tuning.user_refresh_min_s * 1_000_000_000) return #err("At most every " # Nat.toText(tuning.user_refresh_min_s / 60) # " minutes");
    updateWatch(caller, key, func(x) = { x with user_refresh_at = now() });
    switch (await* readNeurons(key, governance, caller, false)) {
      case (?ids) #ok(ids.size());
      case null #err("The SNS governance did not answer; try again later");
    };
  };

  /// The NNS neurons sneed_mon checks for you (their public info: recent ballots, dissolve delay,
  /// voting power). Up to max_nns_neurons ids; an empty list clears them. sneed_mon never needs a
  /// hotkey. A private neuron's ballots are hidden, so it is counted for new proposals only.
  public shared ({ caller }) func set_nns_neurons(ids : [Nat64]) : async Result {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    if (ids.size() > tuning.max_nns_neurons) return #err("At most " # Nat.toText(tuning.max_nns_neurons) # " neurons");
    let uniq = Buffer.Buffer<Nat64>(ids.size());
    for (i in ids.vals()) if (Array.find<Nat64>(Buffer.toArray(uniq), func(x) = x == i) == null) uniq.add(i);
    if (uniq.size() == 0) Map.delete(nns_neurons, Map.phash, caller) else Map.set(nns_neurons, Map.phash, caller, Buffer.toArray(uniq));
    #ok("Saved " # Nat.toText(uniq.size()) # " neurons");
  };

  public query ({ caller }) func get_my_nns_neurons() : async [Nat64] { nnsNeuronsOf(caller) };

  /// The topic keys a watch on `target` can filter by (SNS: list_topics, or the proposal types for
  /// an SNS without topics; NNS: its topic numbers). Read from governance at most once a day.
  public shared ({ caller }) func list_target_topics(target : Target) : async { #ok : [TopicOption]; #err : Text } {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    let key = targetKey(target);
    let root = switch (target) { case (#nns) return #ok(NNS_TOPICS); case (#sns(r)) r };
    switch (Map.get(topic_options, Map.thash, key)) {
      case (?(at, opts)) if (now() - at < tuning.topic_cache_s * 1_000_000_000) return #ok(opts);
      case null {};
    };
    let governance = switch (Map.get(targets, Map.thash, key)) {
      case (?s) s.governance;
      case null {
        let g = try { await* SnsDirectory.governanceOf(directory, config.sns_wasm, root) } catch (e) { return #err("SNS-W did not answer: " # Error.message(e)) };
        switch g { case (?g) g; case null return #err("Not the root of an SNS listed by SNS-W") };
      };
    };
    calls_total += 1;
    let opts = try {
      let r = await gov(governance).list_topics({});
      let out = Buffer.Buffer<TopicOption>(8);
      switch (r.topics) {
        case (?ts) for (t in ts.vals()) switch (t.topic) {
          case (?x) out.add({ key = snsTopicName(x); name = switch (t.name) { case (?n) clip(n, 100); case null snsTopicName(x) }; description = switch (t.description) { case (?d) clip(d, 300); case null "" } });
          case null {};
        };
        case null {};
      };
      if (out.size() == 0) await* functionOptions(governance) else Buffer.toArray(out);
    } catch (_) {
      // an SNS from before topics: its proposal types (nervous system functions)
      try { await* functionOptions(governance) } catch (e) { return #err("The SNS governance did not answer: " # Error.message(e)) };
    };
    Map.set(topic_options, Map.thash, key, (now(), opts));
    #ok(opts);
  };

  func functionOptions(governance : Principal) : async* [TopicOption] {
    calls_total += 1;
    let r = await gov(governance).list_nervous_system_functions();
    Array.map<{ id : Nat64; name : Text; description : ?Text }, TopicOption>(r.functions, func(f) = {
      key = "fn:" # Nat64.toText(f.id); name = clip(f.name, 100); description = switch (f.description) { case (?d) clip(d, 300); case null "" };
    });
  };

  /// The last list_target_topics answer for `target` (null: not read yet).
  public query func get_target_topics(target : Target) : async ?[TopicOption] {
    switch (target) { case (#nns) return ?NNS_TOPICS; case (#sns(_)) {} };
    switch (Map.get(topic_options, Map.thash, targetKey(target))) { case (?(_, o)) ?o; case null null };
  };

  func nnsTopic(id : Nat, name : Text) : TopicOption = { key = Nat.toText(id); name; description = "" };
  transient let NNS_TOPICS : [TopicOption] = [
    nnsTopic(1, "Neuron Management"), nnsTopic(2, "Exchange Rate"), nnsTopic(3, "Network Economics"), nnsTopic(4, "Governance"),
    nnsTopic(5, "Node Admin"), nnsTopic(6, "Participant Management"), nnsTopic(7, "Subnet Management"), nnsTopic(8, "Network Canister Management"),
    nnsTopic(9, "KYC"), nnsTopic(10, "Node Provider Rewards"), nnsTopic(12, "IC OS Version Deployment"), nnsTopic(13, "IC OS Version Election"),
    nnsTopic(14, "SNS & Neurons' Fund"), nnsTopic(15, "API Boundary Node Management"), nnsTopic(16, "Subnet Rental"),
    nnsTopic(17, "Protocol Canister Management"), nnsTopic(18, "Service Nervous System Management"),
  ];

  // ---------------------------------------------------------------------------------------------
  // Users: the prepaid balance (spec §3)
  // ---------------------------------------------------------------------------------------------

  /// Where to send ICP to top up: your own subaccount of this canister on the ICP ledger. Nothing
  /// is counted until you call credit_deposit.
  public query ({ caller }) func get_deposit_account() : async Account { depositAccount(caller) };

  func subaccountOf(p : Principal) : Blob {
    let bytes = Blob.toArray(Principal.toBlob(p));
    Blob.fromArray(Array.tabulate<Nat8>(32, func(i) = if (i == 0) Nat8.fromNat(bytes.size()) else if (i <= bytes.size()) bytes[i - 1] else 0));
  };
  func depositAccount(p : Principal) : Account = { owner = Principal.fromActor(this); subaccount = ?subaccountOf(p) };
  func ledger() : T.Ledger = actor (Principal.toText(billing.icp_ledger));

  func userBalancesTotal() : Nat {
    var t = 0;
    for (a in Map.vals(accounts)) t += a.balance_e8s;
    t;
  };
  func feesAvailable() : Nat = fees_collected_e8s - fees_withdrawn_e8s; // never negative: withdrawals are capped by it

  public query ({ caller }) func get_my_balance() : async MyBalance {
    let a = acct(caller);
    let ws = watchesOf(caller);
    {
      balance_e8s = a.balance_e8s; paused = a.paused; watches = ws.size(); per_round_of_checks_e8s = checksCost(caller, ws); per_day_e8s = dailyCost(caller, ws);
      charged_e8s = a.charged_e8s; checks = a.checks; deposited_e8s = a.deposited_e8s; withdrawn_e8s = a.withdrawn_e8s; deposit_account = depositAccount(caller);
      auto_top_up = myAutoTopUp(caller);
    };
  };

  /// Your paid checks, newest first: `start` entries skipped, at most `len` (100) returned, of the
  /// last 200 kept.
  public query ({ caller }) func get_my_charges(start : Nat, len : Nat) : async { total : Nat; entries : [ChargeEntry] } {
    let all = switch (Map.get(charges, Map.phash, caller)) { case (?c) c; case null [] };
    let n = all.size();
    if (start >= n) return { total = n; entries = [] };
    let m = Nat.min(Nat.min(len, 100), n - start);
    { total = n; entries = Array.tabulate<ChargeEntry>(m, func(i) = all[n - 1 - start - i]) };
  };

  /// get_my_charges with the price tier of each check (`regular`, `admin` or `partner`; checks from
  /// before special prices existed are `regular`).
  public query ({ caller }) func get_my_charges_with_tier(start : Nat, len : Nat) : async { total : Nat; entries : [ChargeEntryTiered] } {
    let all = switch (Map.get(charges, Map.phash, caller)) { case (?c) c; case null [] };
    let tiers = switch (Map.get(charge_tiers, Map.phash, caller)) { case (?c) c; case null [] };
    let n = all.size();
    if (start >= n) return { total = n; entries = [] };
    let m = Nat.min(Nat.min(len, 100), n - start);
    {
      total = n;
      entries = Array.tabulate<ChargeEntryTiered>(m, func(i) {
        let e = all[n - 1 - start - i];
        let back = start + i; // 0 = newest
        let tier = if (back < tiers.size()) SP.tierText(tiers[tiers.size() - 1 - back]) else "regular";
        { at = e.at; target = e.target; every_min = e.every_min; price_e8s = e.price_e8s; outcome = e.outcome; price_tier = tier; kind = if (e.every_min == 0) "auto_top_up" else "check" };
      });
    };
  };

  func lock(u : Principal) : Bool {
    if (Map.has(in_flight, Map.phash, u)) return false;
    Map.set(in_flight, Map.phash, u, ());
    true;
  };

  /// Move what arrived in your deposit subaccount into your balance (less one ledger fee for the
  /// move). Safe to call any time: with nothing new it credits nothing. Resumes paused monitoring
  /// when the balance pays one check of each watch.
  public shared ({ caller }) func credit_deposit() : async CreditResult {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    if (not lock(caller)) return #err("A deposit or withdrawal of yours is under way; try again in a moment");
    try { await* creditDeposit(caller) } finally { Map.delete(in_flight, Map.phash, caller) };
  };

  func creditDeposit(u : Principal) : async* CreditResult {
    let from = subaccountOf(u);
    let fee = billing.ledger_fee_e8s;
    let found = try { await ledger().icrc1_balance_of(depositAccount(u)) } catch (e) { return #err("The ledger did not answer: " # Error.message(e)) };
    if (found <= fee) {
      let a = acct(u);
      return #ok({ credited_e8s = 0; balance_e8s = a.balance_e8s; paused = a.paused });
    };
    let amount = found - fee : Nat;
    // An unbounded-wait call: a reject means the transfer did not happen, so nothing is credited
    // and nothing is lost (the ICP stays in the subaccount for the next try).
    let r = try {
      await ledger().icrc1_transfer({ from_subaccount = ?from; to = { owner = Principal.fromActor(this); subaccount = null }; amount; fee = ?fee; memo = null; created_at_time = ?Nat64.fromNat(Int.abs(now())) });
    } catch (e) { return #err("The ledger did not answer (nothing moved): " # Error.message(e)) };
    switch r {
      case (#Ok(ledger_block)) {
        let a = acct(u);
        putAcct(u, { a with balance_e8s = a.balance_e8s + amount; deposited_e8s = a.deposited_e8s + amount });
        deposits_e8s += amount;
        block("deposit", #caller(u), [("amount_e8s", #Nat(amount)), ("fee_e8s", #Nat(fee)), ("ledger_block", #Nat(ledger_block))]);
        ignore maybeResume(u, #caller(u));
        let b = acct(u);
        #ok({ credited_e8s = amount; balance_e8s = b.balance_e8s; paused = b.paused });
      };
      case (#Err(#BadFee(x))) { billing := { billing with ledger_fee_e8s = x.expected_fee }; #err("The ledger fee changed; try again") };
      case (#Err(#InsufficientFunds(x))) #err("The deposit subaccount holds " # Nat.toText(x.balance) # " e8s, not enough to move");
      case (#Err _) #err("The ledger refused the transfer");
    };
  };

  /// Withdraw unspent balance: `amount_e8s` comes off your balance and `to` receives it less the
  /// ledger fee. Returns the ledger block.
  public shared ({ caller }) func withdraw_balance(amount_e8s : Nat, to : Account) : async ResultNat {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    if (not lock(caller)) return #err("A deposit or withdrawal of yours is under way; try again in a moment");
    try { await* withdrawBalance(caller, amount_e8s, to) } finally { Map.delete(in_flight, Map.phash, caller) };
  };

  func withdrawBalance(u : Principal, amount : Nat, to : Account) : async* ResultNat {
    let fee = billing.ledger_fee_e8s;
    let a = acct(u);
    if (amount > a.balance_e8s) return #err("Your balance is " # Nat.toText(a.balance_e8s) # " e8s");
    if (amount <= fee) return #err("The amount must be more than the ledger fee (" # Nat.toText(fee) # " e8s)");
    // debit before the call, so nothing else can spend it meanwhile; put back if it fails
    putAcct(u, { a with balance_e8s = a.balance_e8s - amount : Nat; withdrawn_e8s = a.withdrawn_e8s + amount });
    withdrawals_e8s += amount;
    func undo() {
      let b = acct(u);
      putAcct(u, { b with balance_e8s = b.balance_e8s + amount; withdrawn_e8s = b.withdrawn_e8s - amount : Nat });
      withdrawals_e8s -= amount;
    };
    let r = try {
      await ledger().icrc1_transfer({ from_subaccount = null; to; amount = amount - fee : Nat; fee = ?fee; memo = null; created_at_time = ?Nat64.fromNat(Int.abs(now())) });
    } catch (e) { undo(); return #err("The ledger did not answer (nothing moved): " # Error.message(e)) };
    switch r {
      case (#Ok(ledger_block)) {
        block("withdraw", #caller(u), [("amount_e8s", #Nat(amount)), ("fee_e8s", #Nat(fee)), ("to", accountV(to)), ("ledger_block", #Nat(ledger_block))]);
        #ok(ledger_block);
      };
      case (#Err(#BadFee(x))) { undo(); billing := { billing with ledger_fee_e8s = x.expected_fee }; #err("The ledger fee changed; try again") };
      case (#Err _) { undo(); #err("The ledger refused the transfer") };
    };
  };

  // ---- auto top-up (spec §3): pulled from the user's wallet with ICRC-2 ----

  transient let NO_TOP_UP : T.AutoTopUp = {
    settings = null; set_at = 0; pulls = 0; pulled_e8s = 0; last_pull_at = 0; last_block = null;
    attempted_round = 0; failure = null; retry_at = 0; notice_sent = false;
  };
  func topUpOf(u : Principal) : T.AutoTopUp = switch (Map.get(auto_top_ups, Map.phash, u)) { case (?t) t; case null NO_TOP_UP };
  func minTopUp() : Nat = 10 * billing.ledger_fee_e8s;

  func myAutoTopUp(u : Principal) : MyAutoTopUp {
    let t = topUpOf(u);
    {
      settings = t.settings; pulls = t.pulls; pulled_e8s = t.pulled_e8s; last_pull_at = t.last_pull_at; last_failure = t.failure; retry_at = t.retry_at;
      spender = { owner = Principal.fromActor(this); subaccount = null };
      per_pull_allowance_e8s = switch (t.settings) { case (?s) s.amount_e8s + billing.ledger_fee_e8s; case null 0 };
      min_amount_e8s = minTopUp(); max_amount_e8s = MAX_TOP_UP_E8S;
    };
  };

  /// Top up automatically from your wallet: when your balance falls below `when_below_e8s`, or
  /// can't pay one check of each of your watches, sneed_mon pulls `amount_e8s` from your ICP account
  /// (`from_subaccount` of your principal, null = the main account; icrc2_transfer_from, at most once a round) and credits it in full; the ledger fee is
  /// paid from your wallet on top. You first approve sneed_mon (`get_my_balance().auto_top_up.spender`)
  /// on the ICP ledger with icrc2_approve: that allowance (amount and expiry) is the most it can ever
  /// take, each pull using amount + fee of it. A refused pull (allowance used up or expired, wallet
  /// empty) is retried a day later, and you get one message (topic `account`). null turns it off.
  /// amount_e8s: at least 10 ledger fees, at most 100 ICP; when_below_e8s: at most 100 ICP.
  public shared ({ caller }) func set_auto_top_up(s : ?AutoTopUpSettings) : async Result {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    let known = Map.has(auto_top_ups, Map.phash, caller);
    switch s {
      case (?x) {
        if (x.amount_e8s < minTopUp()) return #err("The top-up amount is at least 10 ledger fees (" # e8sText(minTopUp()) # " ICP)");
        if (x.amount_e8s > MAX_TOP_UP_E8S) return #err("The top-up amount is at most " # e8sText(MAX_TOP_UP_E8S) # " ICP");
        if (x.when_below_e8s > MAX_TOP_UP_E8S) return #err("The threshold is at most " # e8sText(MAX_TOP_UP_E8S) # " ICP");
        switch (x.from_subaccount) { case (?b) if (b.size() != 32) return #err("A subaccount is 32 bytes"); case null {} };
        if (not known and Map.size(auto_top_ups) >= config.max_users) return #err("sneed_mon is full (user limit); try again later");
      };
      case null if (not known) return #ok("Auto top-up is off");
    };
    // a new setting starts afresh: a refusal is retried next round, and told again if it recurs
    Map.set(auto_top_ups, Map.phash, caller, { topUpOf(caller) with settings = s; set_at = now(); failure = null; retry_at = 0; notice_sent = false });
    switch s {
      case (?x) #ok("Auto top-up on: " # e8sText(x.amount_e8s) # " ICP from your " # (if (x.from_subaccount == null) "main account" else "subaccount") # " whenever your balance falls below " # e8sText(x.when_below_e8s) # " ICP, as far as your approval allows");
      case null #ok("Auto top-up is off");
    };
  };

  /// Totals (never per user): what sneed_mon owes its users and how much of the collected fees is
  /// left. Its main ledger account holds at least `obligations_e8s`.
  public query func get_accounting() : async Accounting {
    let ub = userBalancesTotal();
    var paused = 0;
    for (a in Map.vals(accounts)) if (a.paused) paused += 1;
    {
      icp_ledger = billing.icp_ledger; user_balances_e8s = ub; fees_available_e8s = feesAvailable(); obligations_e8s = ub + feesAvailable();
      fees_collected_e8s; fees_withdrawn_e8s; fees_forwarded_e8s; fee_forwards; deposits_e8s; withdrawals_e8s; accounts = Map.size(accounts); paused_users = paused;
      auto_top_ups = auto_top_ups_n; auto_top_ups_e8s;
    };
  };

  public query func get_billing_config() : async BillingConfig { billing };

  /// The frequency tiers with their prices.
  public query func get_tiers() : async { base_daily_price_e8s : Nat; tiers : [TierPrice] } {
    { base_daily_price_e8s = tier_table.base_daily_price_e8s; tiers = tierPrices() };
  };

  // ---------------------------------------------------------------------------------------------
  // Rounds (spec §2): poll the due targets, read neurons, match ballots, check the due watches
  // ---------------------------------------------------------------------------------------------

  func busy() : Bool = switch running_since { case (?t) now() - t < STALE_RUN_NS; case null false };

  /// The timer (and admin_run_now): go on with the open round, or start one. A new round never
  /// starts while one is open.
  func startRound() : async () {
    if (config.paused or busy()) return;
    if (round_open) return await work();
    flushRoundCharges(); // a round cut short (by an upgrade) is logged before the next begins
    round_no += 1;
    round_open := true;
    round_ticks := 0;
    round_cycles := 0;
    last_round_start := now();
    calls_last_round := 0;
    continuations := 0;
    notify_broken := false;
    notices_done := false;
    refreshed_this_round := 0;
    pulls_this_round := 0;
    Map.clear(nns_info);
    // paused users whose balance pays again (a lower price) resume
    for ((u, a) in Map.entries(accounts)) if (a.paused) ignore maybeResume(u, #timer);
    // a target with no active watcher forgets its proposals; it starts afresh when one returns
    for (s in Map.vals(targets)) if (activeEvery(s) == null and (s.open.size() > 0 or s.listed_at != 0)) {
      Map.set(targets, Map.thash, s.key, { s with open = []; listed_at = 0; last_polled_at = 0 });
    };
    await work();
  };

  /// One tick: at most max_calls_per_tick calls, then a follow-up tick if work is left. Every
  /// phase skips what is done already, so a tick (or an upgrade) can stop anywhere.
  func work() : async () {
    if (busy()) return;
    running_since := ?now();
    let c0 = Cycles.balance();
    budget := config.max_calls_per_tick;
    round_ticks += 1;
    var finished = false;
    try {
      phase_name := "top-ups";
      if (await* phaseTopUps()) {
        phase_name := "list";
        if (await* phaseList()) {
          phase_name := "refresh missing";
          if (await* phaseRefresh(true)) {
            phase_name := "match";
            if (await* phaseMatch()) {
              phase_name := "checks";
              if (await* phaseChecks()) {
                phase_name := "refresh stale";
                if (await* phaseRefresh(false)) { phase_name := "fee forward"; await* forwardFees(); finished := true };
              };
            };
          };
        };
      };
    } catch (e) { noteError(null, "round aborted (cycles " # Nat.toText(Cycles.balance()) # ", calls this round " # Nat.toText(calls_last_round) # "): " # Error.message(e)); finished := true };
    phase_name := "";
    running_since := null;
    let c1 = Cycles.balance();
    let burned = if (c0 > c1) c0 - c1 : Nat else 0;
    round_cycles += burned;
    addEconomics({ cycles_burned = burned; revenue_e8s = 0; checks = 0; rounds = if (finished or config.paused) 1 else 0 });
    if (finished or config.paused) {
      flushRoundCharges();
      round_open := false;
      last_round_end := now();
      last_round_duration := last_round_end - last_round_start;
      last_round_cycles := round_cycles;
    } else if (continuations < config.max_continuations) {
      continuations += 1;
      ignore Timer.setTimer<system>(#seconds 1, work);
    };
    // else: the round stays open and the next timer tick goes on with it
  };

  // ---- phase 0: auto top-ups (before anything is charged, so a pull can prevent a pause) ----

  /// The settings to pull with, when `u` needs a top-up now: auto top-up on, watches to pay for,
  /// the balance below the threshold or short of one check of each watch (or paused), not tried
  /// this round, not within a day of a refusal.
  func topUpDue(u : Principal, t : T.AutoTopUp) : ?AutoTopUpSettings {
    let s = switch (t.settings) { case (?s) s; case null return null };
    if (t.attempted_round == round_no or now() < t.retry_at) return null;
    let ws = watchesOf(u);
    if (ws.size() == 0) return null;
    let a = acct(u);
    if (a.paused or a.balance_e8s < s.when_below_e8s or a.balance_e8s < checksCost(u, ws)) ?s else null;
  };

  /// Pull the due top-ups, at most MAX_PULLS_PER_ROUND a round (the rest next round), in parallel.
  /// Each user's ledger call holds their lock (no deposit or withdrawal meanwhile); the balance is
  /// credited only after the ledger accepted. Pulls go to the main account, so the invariant holds:
  /// the main account grows by exactly what the balance does.
  func phaseTopUps() : async* Bool {
    let todo = Buffer.Buffer<(Principal, AutoTopUpSettings)>(8);
    label scan for ((u, t) in Map.entries(auto_top_ups)) {
      if (pulls_this_round + todo.size() >= MAX_PULLS_PER_ROUND) break scan;
      if (not Map.has(in_flight, Map.phash, u)) switch (topUpDue(u, t)) { case (?s) todo.add((u, s)); case null {} };
    };
    var i = 0;
    while (i < todo.size()) {
      if (budget == 0) return false;
      let n = Nat.min(par(), todo.size() - i);
      let locked = Buffer.Buffer<Principal>(n);
      try {
        let fs = Buffer.Buffer<(Principal, Nat, async T.TransferFromResult)>(n);
        // send up to n (fewer when the cycles can't hold more in flight; the rest next batch)
        var k = 0;
        label send while (k < n) {
          let (u, s) = todo.get(i + k);
          if (not roomForCall(fs.size())) break send;
          k += 1;
          if (lock(u)) {
            locked.add(u);
            spendBudget();
            let b0 = Cycles.balance();
            try {
              fs.add((u, s.amount_e8s, ledger().icrc2_transfer_from({
                spender_subaccount = null; from = { owner = u; subaccount = s.from_subaccount }; to = { owner = Principal.fromActor(this); subaccount = null };
                amount = s.amount_e8s; fee = ?billing.ledger_fee_e8s; memo = ?Text.encodeUtf8("sneed_mon top-up " # Nat.toText(round_no));
                created_at_time = ?Nat64.fromNat(Int.abs(now()));
              })));
              callSent(b0);
              Map.set(auto_top_ups, Map.phash, u, { topUpOf(u) with attempted_round = round_no });
              pulls_this_round += 1;
            } catch (e) {
              sendFailed("auto top-up", null, e);
              // nothing else in flight: this user is tried again next round; else in the next batch
              if (fs.size() == 0) Map.set(auto_top_ups, Map.phash, u, { topUpOf(u) with attempted_round = round_no }) else k -= 1;
              break send;
            };
          };
        };
        i += k;
        for ((u, amount, f) in fs.vals()) {
          // an unbounded-wait call: a reject means nothing moved (tried again next round)
          let r = try { await f } catch (e) { noteError(null, "auto top-up: " # Error.message(e)); #Err(#TemporarilyUnavailable) };
          topUpResult(u, amount, r);
        };
      } finally { for (u in locked.vals()) Map.delete(in_flight, Map.phash, u) };
    };
    true;
  };

  func topUpResult(u : Principal, amount : Nat, r : T.TransferFromResult) {
    let fee = billing.ledger_fee_e8s;
    // one message per failure streak (notice_sent is cleared by a pull or a new setting)
    func failed(reason : Text) {
      Map.set(auto_top_ups, Map.phash, u, { topUpOf(u) with failure = ?{ at = now(); reason }; retry_at = now() + TOP_UP_RETRY_NS });
    };
    switch r {
      case (#Ok(ledger_block)) {
        let a = acct(u);
        putAcct(u, { a with balance_e8s = a.balance_e8s + amount; deposited_e8s = a.deposited_e8s + amount });
        deposits_e8s += amount;
        auto_top_ups_n += 1;
        auto_top_ups_e8s += amount;
        let t = topUpOf(u);
        Map.set(auto_top_ups, Map.phash, u, { t with pulls = t.pulls + 1; pulled_e8s = t.pulled_e8s + amount; last_pull_at = now(); last_block = ?ledger_block; failure = null; retry_at = 0; notice_sent = false });
        addCharge(u, { at = now(); target = #nns; every_min = 0; price_e8s = amount; outcome = "Auto top-up: +" # e8sText(amount) # " ICP from your wallet (ledger block " # Nat.toText(ledger_block) # ")" }, #regular);
        let from_sub = switch (t.settings) { case (?s) s.from_subaccount; case null null };
        block("auto_top_up", #timer, [("user", pv(u)), ("amount_e8s", #Nat(amount)), ("fee_e8s", #Nat(fee)), ("from", Icrc3Log.account(u, from_sub)), ("ledger_block", #Nat(ledger_block))]);
        ignore maybeResume(u, #timer);
      };
      case (#Err(#InsufficientAllowance(x))) failed(
        if (x.allowance == 0) "Sneed Monitor has no allowance left on your wallet (the approval is used up, expired or was never given)"
        else "the allowance left (" # e8sText(x.allowance) # " ICP) does not cover " # e8sText(amount) # " ICP plus the ledger fee"
      );
      case (#Err(#InsufficientFunds(x))) failed("your wallet holds " # e8sText(x.balance) # " ICP, not enough for " # e8sText(amount) # " ICP plus the " # e8sText(fee) # " ICP ledger fee");
      case (#Err(#GenericError(x))) failed("the ledger refused it: " # clip(x.message, 200));
      case (#Err(#BadBurn _)) failed("the ledger refused it");
      case (#Err(#BadFee(x))) { billing := { billing with ledger_fee_e8s = x.expected_fee }; noteError(null, "auto top-up: the ledger fee changed") };
      // passing trouble (or a clock issue): tried again next round, nobody told
      case (#Err(#TemporarilyUnavailable) or #Err(#TooOld) or #Err(#CreatedInFuture _) or #Err(#Duplicate _)) noteError(null, "auto top-up: the ledger could not take it now");
    };
  };

  /// One "Auto top-up failed" message per failure (topic `account`), to users not told yet; like
  /// the pause notices, not_registered / unknown_topic leave them for the next round.
  func sendTopUpNotices() : async* () {
    let n : T.Notifications = switch (config.notifications) { case (?n) actor (Principal.toText(n)); case null return };
    let due = Buffer.Buffer<(Principal, T.TopUpFailure)>(8);
    for ((u, t) in Map.entries(auto_top_ups)) switch (t.settings, t.failure) {
      case (?_, ?f) if (not t.notice_sent) due.add((u, f));
      case _ {};
    };
    var i = 0;
    while (i < due.size()) {
      let chunk = Array.tabulate<(Principal, T.TopUpFailure)>(Nat.min(Nat.min(config.batch_size, 100), due.size() - i), func(k) = due.get(i + k));
      i += chunk.size();
      let inputs = Array.map<(Principal, T.TopUpFailure), T.NotifyInput>(chunk, func((u, f)) = {
        user = u; topic = TOPIC_ACCOUNT; sponsored = config.sponsored; link = ?(SITE # "/notifications#sneed-monitor");
        dedupe = ?("autotopup:" # Int.toText(f.at));
        title = clip("Auto top-up failed: " # f.reason, 200);
        body = "Sneed Monitor could not top up your balance from your wallet: " # f.reason # ". It tries again in a day. To fix it now, renew the approval (or add ICP to your wallet) under Sneed Monitor on the notifications page. If your balance can't pay the next check meanwhile, monitoring pauses until you top up.";
      });
      spend();
      let results = try { await n.notify_batch(inputs) } catch (e) { noteError(null, "notify_batch (top-up notices): " # Error.message(e)); return };
      var k = 0;
      for (r in results.vals()) {
        if (k < chunk.size()) {
          let (u, f) = chunk[k];
          switch r {
            case (#err(#not_registered) or #err(#unknown_topic)) {};
            case _ { let t = topUpOf(u); if (t.failure == ?f) Map.set(auto_top_ups, Map.phash, u, { t with notice_sent = true }) };
          };
          switch r { case (#ok(x)) if (not x.deduplicated) sent += 1; case _ {} };
        };
        k += 1;
      };
    };
  };

  // ---- phase 1: list_proposals for each target due (as often as its fastest active watcher) ----

  type Found = { id : Nat64; title : Text; deadline_s : Nat64; created_s : Nat64; topic_key : Text; fn_key : Text };

  func pollDue(s : TargetState) : Bool = switch (activeEvery(s)) {
    case (?m) s.listed_round != round_no and now() - s.last_polled_at + SLACK_NS >= m * MIN_NS;
    case null false;
  };

  func phaseList() : async* Bool {
    let todo = Buffer.Buffer<TargetState>(16);
    for (s in Map.vals(targets)) if (pollDue(s)) todo.add(s);
    var i = 0;
    while (i < todo.size()) {
      if (budget == 0) return false;
      let n = Nat.min(par(), todo.size() - i);
      // send the first pages together (as many as the cycles can hold in flight), then await them
      let snsF = Buffer.Buffer<(Text, async { proposals : [T.ListedProposal] })>(n);
      let nnsF = Buffer.Buffer<(Text, async { proposal_info : [T.NnsProposalInfo] })>(1);
      var k = 0;
      label send while (k < n) {
        let s = todo.get(i + k);
        if (not roomForCall(snsF.size() + nnsF.size())) break send;
        spendBudget();
        let b0 = Cycles.balance();
        try {
          if (isNns(s.key)) nnsF.add((s.key, nnsGov().list_proposals(nnsArgs(null))))
          else snsF.add((s.key, gov(s.governance).list_proposals(snsArgs(null))));
          callSent(b0);
          k += 1;
        } catch (e) {
          sendFailed("list_proposals", ?s.key, e);
          // nothing else in flight: this target waits for the next round
          if (snsF.size() + nnsF.size() == 0) { markListed(s.key); k += 1 };
          break send;
        };
      };
      i += k;
      for ((key, f) in snsF.vals()) {
        let r = try { ?(await f) } catch (e) { noteError(?key, "list_proposals: " # Error.message(e)); markListed(key); null };
        switch r { case (?r) await* applySns(key, r.proposals); case null {} };
      };
      for ((key, f) in nnsF.vals()) {
        let r = try { ?(await f) } catch (e) { noteError(?key, "list_proposals: " # Error.message(e)); markListed(key); null };
        switch r { case (?r) await* applyNns(key, r.proposal_info); case null {} };
      };
    };
    true;
  };

  func snsArgs(before : ?T.ProposalId) : { include_reward_status : [Int32]; before_proposal : ?T.ProposalId; limit : Nat32; exclude_type : [Nat64]; include_status : [Int32]; include_topics : ?[{}] } =
    { include_reward_status = [ACCEPT_VOTES]; before_proposal = before; limit = Nat32.fromNat(PROPOSAL_PAGE); exclude_type = []; include_status = []; include_topics = null };
  func nnsArgs(before : ?T.ProposalId) : { include_reward_status : [Int32]; omit_large_fields : ?Bool; before_proposal : ?T.ProposalId; limit : Nat32; exclude_topic : [Int32]; include_all_manage_neuron_proposals : ?Bool; include_status : [Int32] } =
    { include_reward_status = [ACCEPT_VOTES]; omit_large_fields = ?true; before_proposal = before; limit = Nat32.fromNat(NNS_PAGE); exclude_topic = []; include_all_manage_neuron_proposals = ?false; include_status = [] };

  /// A failed listing: not again this round (retried next round).
  func markListed(key : Text) {
    switch (Map.get(targets, Map.thash, key)) { case (?cur) Map.set(targets, Map.thash, key, { cur with listed_round = round_no }); case null {} };
  };

  func snsFound(ps : [T.ListedProposal], t : Nat64, out : Buffer.Buffer<Found>) : (Bool, ?T.ProposalId) {
    var lastOpen = false;
    var before : ?T.ProposalId = null;
    for (p in ps.vals()) switch (p.id) {
      case (?pid) {
        let d = deadlineOf(p.proposal_creation_timestamp_seconds, p.initial_voting_period_seconds, p.wait_for_quiet_state);
        lastOpen := d > t;
        if (d > t) out.add({
          id = pid.id; title = switch (p.proposal) { case (?x) x.title; case null "" }; deadline_s = d; created_s = p.proposal_creation_timestamp_seconds;
          topic_key = switch (p.topic) { case (?x) snsTopicName(x); case null "" }; fn_key = "fn:" # Nat64.toText(p.action);
        });
        before := ?pid;
      };
      case null {};
    };
    (lastOpen, before);
  };

  func applySns(key : Text, first : [T.ListedProposal]) : async* () {
    let governance = switch (Map.get(targets, Map.thash, key)) { case (?s) s.governance; case null return };
    let t = nowS();
    let found = Buffer.Buffer<Found>(16);
    var page = first;
    var pages = 1;
    label more loop {
      let (lastOpen, before) = snsFound(page, t, found);
      if (page.size() < PROPOSAL_PAGE or not lastOpen or pages >= config.proposal_pages or budget == 0) break more;
      spend();
      pages += 1;
      page := try { (await gov(governance).list_proposals(snsArgs(before))).proposals } catch (e) { noteError(?key, "list_proposals: " # Error.message(e)); break more };
    };
    applyListing(key, Buffer.toArray(found));
  };

  func applyNns(key : Text, first : [T.NnsProposalInfo]) : async* () {
    let t = nowS();
    let found = Buffer.Buffer<Found>(32);
    var page = first;
    var pages = 1;
    label more loop {
      var lastOpen = false;
      var before : ?T.ProposalId = null;
      for (p in page.vals()) switch (p.id, p.deadline_timestamp_seconds) {
        case (?pid, ?d) {
          lastOpen := d > t;
          if (d > t) found.add({
            id = pid.id; title = switch (p.proposal) { case (?x) switch (x.title) { case (?tt) tt; case null "" }; case null "" }; deadline_s = d;
            created_s = p.proposal_timestamp_seconds; topic_key = Int.toText(Int32.toInt(p.topic)); fn_key = "";
          });
          before := ?pid;
        };
        case (?pid, null) before := ?pid;
        case _ {};
      };
      if (page.size() < NNS_PAGE or not lastOpen or pages >= config.proposal_pages or budget == 0) break more;
      spend();
      pages += 1;
      page := try { (await nnsGov().list_proposals(nnsArgs(before))).proposal_info } catch (e) { noteError(?key, "list_proposals: " # Error.message(e)); break more };
    };
    applyListing(key, Buffer.toArray(found));
  };

  /// The open proposals after a listing. New since the last listing (or every open one on a
  /// target's first listing since it became active) need their "new" match; one seen before but
  /// dropped only gets reminders.
  func applyListing(key : Text, found : [Found]) {
    let cur = switch (Map.get(targets, Map.thash, key)) { case (?c) c; case null return };
    let t = nowS();
    let firstListing = cur.listed_at == 0;
    let open = Buffer.Buffer<OpenP>(found.size());
    var maxSeen = cur.max_seen_id;
    for (f in found.vals()) {
      if (f.id > maxSeen) maxSeen := f.id;
      switch (Array.find<OpenP>(cur.open, func(p) = p.id == f.id)) {
        case (?p) open.add({ p with title = clip(f.title, 120); deadline_s = f.deadline_s; created_s = f.created_s; topic_key = f.topic_key; fn_key = f.fn_key });
        case null open.add({
          id = f.id; title = clip(f.title, 120); deadline_s = f.deadline_s; created_s = f.created_s; topic_key = f.topic_key; fn_key = f.fn_key;
          new_matched = not (firstListing or f.id > cur.max_seen_id); windows_done = []; fails = 0;
        });
      };
    };
    // open ones beyond the pages read stay while their deadline is ahead
    for (p in cur.open.vals()) if (p.deadline_s > t and Array.find<Found>(found, func(f) = f.id == p.id) == null) open.add(p);
    let sorted = Array.sort<OpenP>(Buffer.toArray(open), func(a, b) = Nat64.compare(a.id, b.id));
    let kept = if (sorted.size() > MAX_OPEN_PER_TARGET) Array.subArray<OpenP>(sorted, (sorted.size() - MAX_OPEN_PER_TARGET : Nat), MAX_OPEN_PER_TARGET) else sorted;
    Map.set(targets, Map.thash, key, { cur with open = kept; max_seen_id = maxSeen; listed_round = round_no; listed_at = now(); last_polled_at = now() });
  };

  // ---- phases 2 and 5: the active watchers' SNS neurons (missing ones first, then stale ones) ----

  /// The hex ids of `user`'s neurons on which they hold the vote permission, read from governance
  /// and cached. null when governance did not answer (the cache keeps its old ids; retried in an hour).
  func readNeurons(key : Text, governance : Principal, user : Principal, inRound : Bool) : async* ?[Text] {
    if (inRound) spend() else calls_total += 1;
    let first = try { await gov(governance).list_neurons({ of_principal = ?user; limit = Nat32.fromNat(NEURON_PAGE); start_page_at = null }) } catch (e) {
      neuronsFailed(key, user, "list_neurons: " # Error.message(e));
      return null;
    };
    await* neuronsFrom(key, governance, user, first.neurons, inRound);
  };

  func neuronsFailed(key : Text, user : Principal, msg : Text) {
    noteError(?key, msg);
    let ck = cacheKey(user, key);
    let old = switch (Map.get(user_neurons, Map.thash, ck)) { case (?c) c.ids; case null [] };
    // looks an hour old to the stale check... unless refresh_s is shorter than that
    let back : Int = Int.max(0, tuning.neuron_refresh_s * 1_000_000_000 - HOUR_NS);
    Map.set(user_neurons, Map.thash, ck, { ids = old; at = now() - back; ok = false });
  };

  func neuronsFrom(key : Text, governance : Principal, user : Principal, first : [T.Neuron], inRound : Bool) : async* ?[Text] {
    let ids = Buffer.Buffer<Text>(4);
    var page = first;
    var pages = 1;
    label more loop {
      var start : ?T.NeuronId = null;
      for (n in page.vals()) switch (n.id) {
        case (?nid) {
          start := ?nid;
          if (Array.find<{ principal : ?Principal; permission_type : [Int32] }>(n.permissions, func(x) = x.principal == ?user and Array.find<Int32>(x.permission_type, func(t) = t == PERMISSION_VOTE) != null) != null) ids.add(hex(nid.id));
        };
        case null {};
      };
      if (page.size() < NEURON_PAGE or pages >= config.neuron_pages) break more;
      if (inRound) spend() else calls_total += 1;
      pages += 1;
      page := try { (await gov(governance).list_neurons({ of_principal = ?user; limit = Nat32.fromNat(NEURON_PAGE); start_page_at = start })).neurons } catch (e) {
        neuronsFailed(key, user, "list_neurons: " # Error.message(e));
        return null;
      };
    };
    let out = Buffer.toArray(ids);
    Map.set(user_neurons, Map.thash, cacheKey(user, key), { ids = out; at = now(); ok = true });
    ?out;
  };

  /// A cache is stale after neuron_refresh_s, or after the watch's own interval if that is longer
  /// (a daily watch needs its neurons read at most daily).
  func staleBefore(w : Watch) : Int = now() - Nat.max(tuning.neuron_refresh_s * 1_000_000_000, w.settings.every_min * MIN_NS);

  /// Missing caches (a watcher whose neurons were never read) first, then stale ones, of active
  /// users only, at most max_refresh_per_round a round, in parallel.
  func phaseRefresh(missingOnly : Bool) : async* Bool {
    let todo = Buffer.Buffer<(Principal, Text, Principal)>(16);
    label scan for ((u, ws) in Map.entries(watches)) {
      if (isPausedUser(u)) continue scan;
      for (w in ws.vals()) switch (w.target) {
        case (#sns(_)) {
          let key = targetKey(w.target);
          let due = switch (Map.get(user_neurons, Map.thash, cacheKey(u, key))) { case (?c) not missingOnly and c.at < staleBefore(w); case null true };
          if (due) switch (Map.get(targets, Map.thash, key)) { case (?s) todo.add((u, key, s.governance)); case null {} };
        };
        case (#nns) {};
      };
      if (refreshed_this_round + todo.size() >= tuning.max_refresh_per_round) break scan;
    };
    var i = 0;
    while (i < todo.size() and refreshed_this_round < tuning.max_refresh_per_round) {
      if (budget == 0) return false;
      let n = Nat.min(Nat.min(par(), todo.size() - i), tuning.max_refresh_per_round - refreshed_this_round);
      let fs = Buffer.Buffer<(Principal, Text, Principal, async { neurons : [T.Neuron] })>(n);
      var k = 0;
      label send while (k < n) {
        let (u, key, g) = todo.get(i + k);
        if (not roomForCall(fs.size())) break send;
        spendBudget();
        let b0 = Cycles.balance();
        try {
          fs.add((u, key, g, gov(g).list_neurons({ of_principal = ?u; limit = Nat32.fromNat(NEURON_PAGE); start_page_at = null })));
          callSent(b0);
          k += 1;
        } catch (e) {
          sendFailed("list_neurons", ?key, e);
          // nothing else in flight: this cache is retried later (as after a failed read)
          if (fs.size() == 0) { neuronsFailed(key, u, "list_neurons not sent"); k += 1 };
          break send;
        };
      };
      i += k;
      refreshed_this_round += k;
      for ((u, key, g, f) in fs.vals()) {
        let r = try { ?(await f) } catch (e) { neuronsFailed(key, u, "list_neurons: " # Error.message(e)); null };
        switch r { case (?r) ignore await* neuronsFrom(key, g, u, r.neurons, true); case null {} };
      };
    };
    true;
  };

  // ---- phase 3: each due proposal's ballots read once, matched against every watcher ----

  /// The reminder windows the active watchers of `s` use (with reminders on).
  func windowsOf(s : TargetState) : [Nat] {
    let out = Buffer.Buffer<Nat>(2);
    for (u in s.watchers.vals()) if (not isPausedUser(u)) switch (findWatch(u, s.key)) {
      case (?w) if (w.settings.reminders and not hasNat(Buffer.toArray(out), w.settings.reminder_window_s)) out.add(w.settings.reminder_window_s);
      case null {};
    };
    Buffer.toArray(out);
  };

  /// Reminder windows of `s` due for `p`: reached and not matched yet.
  func dueWindows(s : TargetState, p : OpenP) : [Nat] = Array.filter<Nat>(windowsOf(s), func(w) = not hasNat(p.windows_done, w) and within(p.deadline_s, w));

  /// Only targets polled this round are matched (their proposals are fresh).
  func phaseMatch() : async* Bool {
    let jobs = Buffer.Buffer<(Text, Nat64)>(16);
    for (s in Map.vals(targets)) if (s.listed_round == round_no and s.listed_at != 0) for (p in s.open.vals()) {
      if (not p.new_matched or dueWindows(s, p).size() > 0) {
        if (isNns(s.key)) matchProposal(s.key, p.id, null) else jobs.add((s.key, p.id));
      };
    };
    var i = 0;
    while (i < jobs.size()) {
      if (budget == 0) return false;
      let n = Nat.min(par(), jobs.size() - i);
      let fs = Buffer.Buffer<(Text, Nat64, async { result : ?{ #Error : { error_message : Text; error_type : Int32 }; #Proposal : T.FullProposal } })>(n);
      var k = 0;
      label send while (k < n) {
        let (key, id) = jobs.get(i + k);
        switch (Map.get(targets, Map.thash, key)) {
          case (?s) {
            if (not roomForCall(fs.size())) break send;
            spendBudget();
            let b0 = Cycles.balance();
            try {
              fs.add((key, id, gov(s.governance).get_proposal({ proposal_id = ?{ id } })));
              callSent(b0);
            } catch (e) {
              sendFailed("get_proposal " # Nat64.toText(id), ?key, e);
              // nothing else in flight: counts as a failed read of this proposal; else next batch
              if (fs.size() == 0) { failedRead(key, id); k += 1 };
              break send;
            };
          };
          case null {};
        };
        k += 1;
      };
      i += k;
      for ((key, id, f) in fs.vals()) {
        try {
          switch ((await f).result) {
            case (?#Proposal(p)) {
              let m = Map.new<Text, Int32>();
              for ((k, b) in p.ballots.vals()) Map.set(m, Map.thash, k, b.vote);
              let d = deadlineOf(p.proposal_creation_timestamp_seconds, p.initial_voting_period_seconds, p.wait_for_quiet_state);
              updateOpen(key, id, func(o) = { o with deadline_s = d });
              matchProposal(key, id, ?m);
            };
            case _ { noteError(?key, "get_proposal " # Nat64.toText(id) # ": not found"); giveUp(key, id) };
          };
        } catch (e) {
          noteError(?key, "get_proposal " # Nat64.toText(id) # ": " # Error.message(e));
          failedRead(key, id);
        };
      };
    };
    true;
  };

  /// A proposal whose ballots could not be read: retried next round, given up after MAX_FAILS.
  func failedRead(key : Text, id : Nat64) {
    updateOpen(key, id, func(o) = { o with fails = o.fails + 1 });
    switch (findOpen(key, id)) { case (?o) if (o.fails >= MAX_FAILS) giveUp(key, id); case null {} };
  };

  func giveUp(key : Text, id : Nat64) {
    switch (Map.get(targets, Map.thash, key)) {
      case (?s) { let ws = windowsOf(s); updateOpen(key, id, func(o) = { o with new_matched = true; windows_done = ws }) };
      case null {};
    };
  };

  func findOpen(key : Text, id : Nat64) : ?OpenP = switch (Map.get(targets, Map.thash, key)) {
    case (?s) Array.find<OpenP>(s.open, func(p) = p.id == id);
    case null null;
  };

  func updateOpen(key : Text, id : Nat64, f : OpenP -> OpenP) {
    switch (Map.get(targets, Map.thash, key)) {
      case (?s) Map.set(targets, Map.thash, key, { s with open = Array.map<OpenP, OpenP>(s.open, func(p) = if (p.id == id) f(p) else p) });
      case null {};
    };
  };

  /// Match one proposal against every active watcher of its target, with no calls: SNS by the
  /// ballots just read and the watchers' cached neurons; NNS as candidates checked against the
  /// user's registered neurons at the watch's next check. The new match runs once; each reminder
  /// window once (a window already reached when the proposal is announced counts as done: the
  /// message says when voting closes).
  func matchProposal(key : Text, id : Nat64, ballots : ?Map.Map<Text, Int32>) {
    let s = switch (Map.get(targets, Map.thash, key)) { case (?s) s; case null return };
    let p = switch (Array.find<OpenP>(s.open, func(x) = x.id == id)) { case (?p) p; case null return };
    let due = dueWindows(s, p);
    let isNew = not p.new_matched;
    for (u in s.watchers.vals()) if (not isPausedUser(u)) switch (findWatch(u, key)) {
      case (?w) if (topicOk(w.settings, p)) {
        let inWin = w.settings.reminders and hasNat(due, w.settings.reminder_window_s);
        let kind : ?PendingKind = if (isNew) {
          if (w.settings.new_proposals) ?#new else if (inWin) ?#reminder else null;
        } else if (inWin) ?#reminder else null;
        switch kind {
          case (?k) switch ballots {
            case (?b) {
              let mine = switch (Map.get(user_neurons, Map.thash, cacheKey(u, key))) { case (?c) c.ids; case null [] };
              var n = 0;
              for (h in mine.vals()) switch (Map.get(b, Map.thash, h)) { case (?v) if (v == 0) n += 1; case null {} };
              if (n > 0) addPending(u, { key; id; kind = k; title = p.title; deadline_s = p.deadline_s; created_s = p.created_s; neurons = n; nns_check = false });
            };
            case null if (nnsNeuronsOf(u).size() > 0) addPending(u, { key; id; kind = k; title = p.title; deadline_s = p.deadline_s; created_s = p.created_s; neurons = 0; nns_check = true });
          };
          case null {};
        };
      };
      case null {};
    };
    updateOpen(key, id, func(o) = { o with new_matched = true; windows_done = Array.append(o.windows_done, Array.filter<Nat>(due, func(w) = not hasNat(o.windows_done, w))) });
  };

  func addPending(u : Principal, item : Pending) {
    let cur = pendingOf(u);
    if (Array.find<Pending>(cur, func(x) = x.key == item.key and x.id == item.id and x.kind == item.kind) != null) return;
    let all = Array.append(cur, [item]);
    let max = tuning.max_pending_per_user;
    Map.set(pending, Map.phash, u, if (all.size() > max) Array.subArray<Pending>(all, (all.size() - max : Nat), max) else all);
  };

  // ---- phase 4: check the due watches: charge, then one message (or digest) per topic ----

  type Group = { user : Principal; key : Text; kind : PendingKind; items : [Pending] };
  type Check = { user : Principal; key : Text; target : Target; every_min : Nat; price : Nat; tier : SP.Tier; prev_check_at : Int; first : Nat; groups : Nat };

  func phaseChecks() : async* Bool {
    if (not notices_done) {
      if (budget == 0) return false;
      await* sendTopUpNotices();
      await* sendPauseNotices();
      notices_done := true;
    };
    // no checks while Sneed Notifications can't take messages: they stay due, uncharged
    let n : T.Notifications = switch (config.notifications) { case (?n) actor (Principal.toText(n)); case null return true };
    if (notify_broken) return true;
    // closed proposals are dropped
    let t = nowS();
    for ((u, ps) in Map.entries(pending)) {
      let live = Array.filter<Pending>(ps, func(p) = p.deadline_s > t);
      if (live.size() != ps.size()) setPending(u, live);
    };
    // the checks due now (active users)
    let due = Buffer.Buffer<(Principal, Watch)>(16);
    for ((u, ws) in Map.entries(watches)) if (not isPausedUser(u)) for (w in ws.vals()) if (isDue(w)) due.add((u, w));
    // NNS candidates of due NNS watches: read the users' neurons (once a round), then count
    let needNns = Buffer.Buffer<Principal>(8);
    for ((u, w) in due.vals()) if (isNns(targetKey(w.target)) and not Map.has(nns_info, Map.phash, u) and Array.find<Pending>(pendingOf(u), func(p) = p.nns_check) != null) needNns.add(u);
    if (not (await* readNnsNeurons(Buffer.toArray(needNns)))) return false;
    for (u in needNns.vals()) resolveNns(u);
    let size = Nat.max(1, Nat.min(config.batch_size, 100));
    var i = 0;
    while (i < due.size()) {
      if (budget == 0) return false;
      // charge checks until their messages fill par() batches
      let groups = Buffer.Buffer<Group>(16);
      let checks = Buffer.Buffer<Check>(16);
      let maxGroups = size * par();
      while (i < due.size() and groups.size() < maxGroups) {
        let (u, w0) = due.get(i);
        i += 1;
        let key = targetKey(w0.target);
        switch (findWatch(u, key)) {
          case (?w) if (not isPausedUser(u) and isDue(w)) {
            let (price, tier) = priceFor(u, w.settings.every_min);
            if (not chargeCheck(u, price)) pauseUser(u, price) else {
              updateWatch(u, key, func(x) = { x with last_check_at = now() });
              let first = groups.size();
              let ps = pendingOf(u);
              for (kind in [#new, #reminder].vals()) {
                let items = Array.filter<Pending>(ps, func(p) = p.key == key and p.kind == kind and not p.nns_check);
                if (items.size() > 0) groups.add({ user = u; key; kind; items });
              };
              checks.add({ user = u; key; target = w.target; every_min = w.settings.every_min; price; tier; prev_check_at = w.last_check_at; first; groups = groups.size() - first });
            };
          };
          case _ {};
        };
      };
      // send the groups, up to par() batches at once
      let outcome = Array.init<Text>(groups.size(), "");
      // a batch that could not be sent counts as not taken: its checks are refunded and stay due
      let calls = Buffer.Buffer<(Nat, Nat, ?(async [T.NotifyResult]))>(4);
      var inFlight = 0;
      var unsent = false;
      var g = 0;
      while (g < groups.size()) {
        let m = Nat.min(size, groups.size() - g);
        let gs = Array.tabulate<Group>(m, func(k) = groups.get(g + k));
        let f : ?(async [T.NotifyResult]) = if (not roomForCall(inFlight)) null else {
          spendBudget();
          let b0 = Cycles.balance();
          try { let x = n.notify_batch(Array.map<Group, T.NotifyInput>(gs, message)); callSent(b0); inFlight += 1; ?x } catch (e) { sendFailed("notify_batch", null, e); null };
        };
        calls.add((g, m, f));
        g += m;
      };
      label answers for ((start, m, of) in calls.vals()) {
        let f = switch of {
          case (?f) f;
          case null { unsent := true; for (j in Iter.range(start, start + m - 1)) outcome[j] := "unavailable"; continue answers };
        };
        let results = try { await f } catch (e) { noteError(null, "notify_batch: " # Error.message(e)); notify_broken := true; [] };
        var refused = results.size() < m;
        var k = 0;
        for (r in results.vals()) {
          if (k < m) {
            let grp = groups.get(start + k);
            switch r {
              case (#ok(x)) { if (x.deduplicated) deduplicated += 1 else sent += 1; done(grp); outcome[start + k] := "sent" };
              case (#err(#not_allowed)) { skipped_not_allowed += 1; done(grp); outcome[start + k] := "not delivered: Sneed Monitor is not allowed in your notification centre" };
              case (#err(#rate_limited)) { skipped_rate_limited += 1; done(grp); outcome[start + k] := "not delivered: your daily cap for the app" };
              case (#err(#no_funds) or #err(#invalid _)) { skipped_other += 1; done(grp); outcome[start + k] := "not delivered" };
              case (#err(#not_registered) or #err(#unknown_topic)) { refused := true; outcome[start + k] := "unavailable" };
            };
          };
          k += 1;
        };
        if (refused) {
          for (j in Iter.range(start, start + m - 1)) if (outcome[j] == "") outcome[j] := "unavailable";
          if (not notify_broken) noteError(null, "Sneed Notifications does not accept our messages (not registered, or a topic missing): run admin_register_with_notifications or admin_update_notifications_app");
          notify_broken := true;
        };
      };
      // the charge history; a check whose messages Sneed Notifications could not take is refunded
      for (c in checks.vals()) {
        var proposals = 0;
        var failed = false;
        var note = "";
        var j = c.first;
        while (j < c.first + c.groups) {
          proposals += groups.get(j).items.size();
          if (outcome[j] == "unavailable") failed := true else if (outcome[j] != "sent") note := outcome[j];
          j += 1;
        };
        if (failed) {
          refundCheck(c.user, c.price);
          updateWatch(c.user, c.key, func(x) = { x with last_check_at = c.prev_check_at });
        } else {
          let text = if (c.groups == 0) "nothing new" else Nat.toText(proposals) # (if (proposals == 1) " proposal" else " proposals") # (if (note == "") ", sent" else ", " # note);
          addCharge(c.user, { at = now(); target = c.target; every_min = c.every_min; price_e8s = c.price; outcome = text }, c.tier);
          roundCharge(c.user, c.price);
          addEconomics({ cycles_burned = 0; revenue_e8s = c.price; checks = 1; rounds = 0 });
        };
      };
      // a batch not sent: the rest of the checks wait for the next round (they stay due)
      if (notify_broken or unsent) return true;
    };
    true;
  };

  /// Forward the collected fees to fee_destination in one transfer once they reach
  /// fee_sweep_threshold_e8s (at most once a round; the ledger fee comes off the amount). The
  /// counters move only after the ledger accepted; a failure leaves the fees for the next round.
  func forwardFees() : async* () {
    if (fees_checked_round == round_no) return;
    fees_checked_round := round_no;
    let to = switch (billing.fee_destination) { case (?a) a; case null return };
    let amount = feesAvailable();
    let fee = billing.ledger_fee_e8s;
    if (fees_in_flight or amount < billing.fee_sweep_threshold_e8s or amount <= fee) return;
    fees_in_flight := true;
    spend();
    try {
      let r = try {
        await ledger().icrc1_transfer({ from_subaccount = null; to; amount = amount - fee : Nat; fee = ?fee; memo = null; created_at_time = ?Nat64.fromNat(Int.abs(now())) });
      } catch (e) { noteError(null, "fee forward: " # Error.message(e)); return };
      switch r {
        case (#Ok(ledger_block)) {
          fees_withdrawn_e8s += amount;
          fees_forwarded_e8s += amount;
          fee_forwards += 1;
          block("fee_forward", #timer, [("amount_e8s", #Nat(amount)), ("fee_e8s", #Nat(fee)), ("to", accountV(to)), ("ledger_block", #Nat(ledger_block)), ("forwards", #Nat(fee_forwards))]);
        };
        case (#Err(#BadFee(x))) { billing := { billing with ledger_fee_e8s = x.expected_fee }; noteError(null, "fee forward: the ledger fee changed") };
        case (#Err _) noteError(null, "fee forward: the ledger refused the transfer");
      };
    } finally { fees_in_flight := false };
  };

  /// A group was answered: its proposals are not sent again.
  func done(g : Group) {
    setPending(g.user, Array.filter<Pending>(pendingOf(g.user), func(p) = not (p.key == g.key and p.kind == g.kind and Array.find<Pending>(g.items, func(x) = x.id == p.id) != null)));
  };

  /// get_neuron_info for each registered neuron of these users, in parallel. false when the
  /// budget ran out (the users read so far are kept for the round).
  func readNnsNeurons(users : [Principal]) : async* Bool {
    for (u in users.vals()) if (not Map.has(nns_info, Map.phash, u)) {
      let ids = nnsNeuronsOf(u);
      let got = Buffer.Buffer<(Nat64, ?T.NnsNeuronInfo)>(ids.size());
      var i = 0;
      while (i < ids.size()) {
        if (budget == 0) return false;
        let n = Nat.min(par(), ids.size() - i);
        let fs = Buffer.Buffer<(Nat64, async { #Ok : T.NnsNeuronInfo; #Err : { error_message : Text; error_type : Int32 } })>(n);
        var k = 0;
        label send while (k < n) {
          if (not roomForCall(fs.size())) break send;
          spendBudget();
          let b0 = Cycles.balance();
          try {
            fs.add((ids[i + k], nnsGov().get_neuron_info(ids[i + k])));
            callSent(b0);
            k += 1;
          } catch (e) {
            sendFailed("get_neuron_info", ?NNS_KEY, e);
            // nothing else in flight: read as unknown (like a failed read)
            if (fs.size() == 0) { got.add((ids[i + k], null)); k += 1 };
            break send;
          };
        };
        i += k;
        for ((id, f) in fs.vals()) {
          let info : ?T.NnsNeuronInfo = try { switch (await f) { case (#Ok(x)) ?x; case (#Err _) null } } catch (e) { noteError(?NNS_KEY, "get_neuron_info: " # Error.message(e)); null };
          got.add((id, info));
        };
      };
      Map.set(nns_info, Map.phash, u, Buffer.toArray(got));
    };
    true;
  };

  /// Count, for each NNS candidate of `u`, the registered neurons that can vote on it and haven't:
  /// voting power, a dissolve delay of six months, created before the proposal, and no vote in
  /// its recent ballots. A private neuron hides its ballots: counted for new proposals only.
  /// Candidates with none are dropped.
  func resolveNns(u : Principal) {
    let infos = switch (Map.get(nns_info, Map.phash, u)) { case (?i) i; case null return };
    let out = Buffer.Buffer<Pending>(8);
    for (p in pendingOf(u).vals()) {
      if (not p.nns_check) out.add(p) else {
        var n = 0;
        for ((_, oi) in infos.vals()) switch oi {
          case (?x) {
            let vp = switch (x.deciding_voting_power) { case (?v) v; case null x.voting_power };
            let hidden = x.visibility == ?(2 : Int32);
            let voted = Array.find<{ vote : Int32; proposal_id : ?T.ProposalId }>(x.recent_ballots, func(b) = b.proposal_id == ?{ id = p.id } and b.vote != 0) != null;
            if (vp > 0 and x.dissolve_delay_seconds >= NNS_MIN_DISSOLVE_S and x.created_timestamp_seconds <= p.created_s and not voted and not (hidden and p.kind == #reminder)) n += 1;
          };
          case null {};
        };
        if (n > 0) out.add({ p with neurons = n; nns_check = false });
      };
    };
    setPending(u, Buffer.toArray(out));
  };

  func proposalLink(key : Text, id : Nat64) : Text =
    if (isNns(key)) SITE # "/icp_proposal?proposalid=" # Nat64.toText(id) else SITE # "/proposal?proposalid=" # Nat64.toText(id) # "&sns=" # key;
  func listLink(key : Text) : Text = if (isNns(key)) SITE # "/icp_proposals" else SITE # "/proposals?sns=" # key;
  func neuronsText(n : Nat) : Text = if (n == 1) "1 of your neurons" else Nat.toText(n) # " of your neurons";

  /// One proposal: the full message; several: a digest listing them (up to 10 lines).
  func message(g : Group) : T.NotifyInput {
    let name = switch (Map.get(targets, Map.thash, g.key)) { case (?s) s.name; case null g.key };
    let topic = switch (g.kind) { case (#new) TOPIC_PROPOSALS; case (#reminder) TOPIC_DEADLINES };
    let sorted = Array.sort<Pending>(g.items, func(a, b) = Nat64.compare(a.id, b.id));
    if (sorted.size() == 1) {
      let p = sorted[0];
      let idText = Nat64.toText(p.id);
      let what = if (p.title == "") "" else "\"" # p.title # "\"\n\n";
      let ns = neuronsText(p.neurons);
      return switch (g.kind) {
        case (#new) ({
          user = g.user; topic; sponsored = config.sponsored; link = ?proposalLink(g.key, p.id);
          title = clip(name # " proposal #" # idText # ": you can vote", 200);
          body = what # ns # " can vote on it. Voting closes " # hoursLeft(p.deadline_s) # ".";
          dedupe = ?("prop:" # g.key # ":" # idText);
        });
        case (#reminder) ({
          user = g.user; topic; sponsored = config.sponsored; link = ?proposalLink(g.key, p.id);
          title = clip(name # " proposal #" # idText # " closes soon", 200);
          body = what # "Voting closes " # hoursLeft(p.deadline_s) # " and " # ns # (if (p.neurons == 1) " hasn't" else " haven't") # " voted yet.";
          dedupe = ?("propdl:" # g.key # ":" # idText);
        });
      };
    };
    var lines = "";
    var k = 0;
    for (p in sorted.vals()) {
      if (k < DIGEST_LINES) lines #= "#" # Nat64.toText(p.id) # (if (p.title == "") "" else " " # clip(p.title, 80)) # ": " # neuronsText(p.neurons) # ", closes " # hoursLeft(p.deadline_s) # "\n";
      k += 1;
    };
    if (sorted.size() > DIGEST_LINES) lines #= "and " # Nat.toText(sorted.size() - DIGEST_LINES : Nat) # " more\n";
    let count = Nat.toText(sorted.size());
    let ids = Nat64.toText(sorted[0].id) # "-" # Nat64.toText(sorted[sorted.size() - 1].id) # ":" # count;
    switch (g.kind) {
      case (#new) ({
        user = g.user; topic; sponsored = config.sponsored; link = ?listLink(g.key);
        title = clip(count # " proposals to vote on in " # name, 200);
        body = lines; dedupe = ?("propd:" # g.key # ":" # ids);
      });
      case (#reminder) ({
        user = g.user; topic; sponsored = config.sponsored; link = ?listLink(g.key);
        title = clip(count # " proposals in " # name # " close soon", 200);
        body = lines # "Your neurons haven't voted on these yet."; dedupe = ?("propdld:" # g.key # ":" # ids);
      });
    };
  };

  transient var timer : Timer.TimerId = Timer.recurringTimer<system>(#seconds(config.interval_s), startRound);

  // ---------------------------------------------------------------------------------------------
  // Upgrade from the 1bbee49a build (SNS watches in `user_watches` / `snses`)
  // ---------------------------------------------------------------------------------------------

  system func postupgrade() {
    migrateLegacy();
    Icrc3Log.certify(icrc3);
    ensure_icrc3_timer<system>();
  };

  func migrateLegacy() {
    for ((root, s) in Map.entries(snses)) {
      let key = Principal.toText(root);
      if (not Map.has(targets, Map.thash, key)) Map.set(targets, Map.thash, key, {
        target = #sns(root); key; governance = s.governance; name = s.name; watchers = s.watchers;
        open = Array.map<OpenProposal, OpenP>(s.open, func(p) = {
          id = p.id; title = p.title; deadline_s = p.deadline_s; created_s = 0; topic_key = ""; fn_key = "";
          // a pass under way counts as done: better one user missed than one told twice
          new_matched = p.new_pass != #todo; windows_done = if (p.reminder_pass == #done) [86_400] else []; fails = p.fails;
        });
        max_seen_id = s.max_seen_id; listed_round = 0; listed_at = s.listed_at; last_polled_at = 0; last_error = s.last_error; errors = s.errors;
      });
    };
    for ((u, roots) in Map.entries(user_watches)) {
      let have = watchesOf(u);
      let add = Array.mapFilter<Principal, Watch>(roots, func(r) = if (Array.find<Watch>(have, func(w) = w.target == #sns(r)) != null) null else ?{
        target = #sns(r); settings = tuning.defaults; created_at = now(); last_check_at = 0; user_refresh_at = 0;
      });
      if (add.size() > 0) Map.set(watches, Map.phash, u, Array.append(have, add));
    };
    Map.clear(snses);
    Map.clear(user_watches);
  };

  // ---------------------------------------------------------------------------------------------
  // Public reads
  // ---------------------------------------------------------------------------------------------

  func backlog() : Backlog {
    var fetch = 0;
    for (s in Map.vals(targets)) if (s.listed_at != 0) for (p in s.open.vals()) if (not p.new_matched or dueWindows(s, p).size() > 0) fetch += 1;
    var msgs = 0;
    for (ps in Map.vals(pending)) msgs += ps.size();
    var missing = 0;
    var stale = 0;
    var checksDue = 0;
    for ((u, ws) in Map.entries(watches)) if (not isPausedUser(u)) for (w in ws.vals()) {
      if (isDue(w)) checksDue += 1;
      switch (w.target) {
        case (#sns(_)) switch (Map.get(user_neurons, Map.thash, cacheKey(u, targetKey(w.target)))) { case (?c) if (c.at < staleBefore(w)) stale += 1; case null missing += 1 };
        case (#nns) {};
      };
    };
    { round_open; ballots_to_fetch = fetch; pending_messages = msgs; users_with_pending = Map.size(pending); neuron_caches_missing = missing; neuron_caches_stale = stale; checks_due = checksDue };
  };

  public query func get_status() : async Status {
    var open = 0;
    var n = 0;
    for (s in Map.vals(targets)) { open += s.open.size(); n += s.watchers.size() };
    {
      paused = config.paused; running = busy() or round_open; users = Map.size(watches); watches = n; targets = Map.size(targets);
      open_proposals = open; rounds = round_no; last_round_start; last_round_end; interval_s = config.interval_s;
      calls_last_round; calls_total; sent; deduplicated; skipped_not_allowed; skipped_rate_limited; skipped_other;
      errors; last_error; notifications = config.notifications; app_id; cycles = Cycles.balance();
      paused_users = Iter.size(Iter.filter<UserAccount>(Map.vals(accounts), func(a) = a.paused));
      economics = { total = econ_total; last_24h = window(24); last_30d = window(HOURS_KEPT); last_round_cycles };
      last_round_duration_ns = last_round_duration; round_ticks; backlog = backlog();
    };
  };

  /// The watched targets (counts only, never who watches).
  public query func get_targets() : async [TargetInfo] {
    Iter.toArray(Iter.map<TargetState, TargetInfo>(Map.vals(targets), func(s) {
      var active = 0;
      for (u in s.watchers.vals()) if (not isPausedUser(u)) active += 1;
      {
        target = s.target; governance = s.governance; name = s.name; watchers = s.watchers.size(); active_watchers = active; poll_every_min = activeEvery(s);
        listed_at = s.listed_at; last_error = s.last_error; errors = s.errors;
        open = Array.map<OpenP, { id : Nat64; title : Text; deadline_s : Nat64; topic_key : Text; new_done : Bool; windows_done : [Nat] }>(s.open, func(p) = { id = p.id; title = p.title; deadline_s = p.deadline_s; topic_key = p.topic_key; new_done = p.new_matched; windows_done = p.windows_done });
      };
    }));
  };

  /// Every setting (core, tuning, billing, tiers), for an admin page.
  /// The last errors noted (newest last), each with the phase and target it happened in. Admins.
  public query ({ caller }) func get_recent_errors() : async [(Int, Text)] { if (isAdmin(caller)) recent_errors else [] };

  public query func get_config() : async T.AllConfig { { core = config; tuning; billing; tiers = tier_table } };
  public query func get_tuning() : async Tuning { tuning };
  public query func get_admins() : async [Principal] { admins };

  /// The topics sneed_mon sends under (what admin_register_with_notifications registers).
  public query func get_topics() : async [T.NTopic] { topics() };

  func topics() : [T.NTopic] = [
    { id = TOPIC_PROPOSALS; title = "Proposals to vote on"; level = #normal; description = "A new proposal in an SNS or the NNS you watch that one of your neurons can vote on (several at once as one digest)." },
    { id = TOPIC_DEADLINES; title = "Proposals closing soon"; level = #urgent; description = "Before voting closes on a proposal in an SNS or the NNS you watch, if one of your neurons still hasn't voted." },
    { id = TOPIC_ACCOUNT; title = "Your Sneed Monitor balance"; level = #normal; description = "Your prepaid balance can't pay the next check (monitoring is paused until you top up), or an automatic top-up from your wallet failed." },
  ];

  func appInput() : T.AppInput = {
    name = APP_NAME;
    logo = ?"https://app.sneeddao.com/sneed_logo.png";
    description = "Sneed Monitor (app.sneeddao.com) watches the SNSes and the NNS for you and tells you when one of your neurons can vote on a proposal, and again before voting closes. Each check costs a small fee from your prepaid ICP balance while you watch.";
    canisters = [Principal.fromActor(this)];
    topics = topics();
  };

  // ---------------------------------------------------------------------------------------------
  // Admin (controllers and the admin list)
  // ---------------------------------------------------------------------------------------------

  public shared ({ caller }) func admin_set_config(c : Config) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (c.interval_s < MIN_INTERVAL_S) return #err("The interval is at least 60 seconds");
    if (c.batch_size == 0 or c.batch_size > 100 or c.max_calls_per_tick == 0) return #err("batch_size 1 to 100, max_calls_per_tick at least 1");
    let reset = c.interval_s != config.interval_s;
    configBlocks(#caller(caller), coreValues(config), coreValues(c));
    config := c;
    if (reset) resetTimer<system>();
    #ok("Saved");
  };

  /// Defaults for new watches, refresh pace, parallelism and caps. Existing watches keep their settings.
  public shared ({ caller }) func admin_set_tuning(t : Tuning) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (checkSettings(t.defaults)) { case (?e) return #err("defaults: " # e); case null {} };
    if (t.parallel_calls == 0 or t.parallel_calls > 50) return #err("parallel_calls 1 to 50");
    if (t.max_nns_neurons > 100 or t.max_pending_per_user == 0) return #err("max_nns_neurons at most 100, max_pending_per_user at least 1");
    configBlocks(#caller(caller), tuningValues(tuning), tuningValues(t));
    tuning := t;
    #ok("Saved");
  };

  /// The price table: base_daily_price_e8s and the tiers (every_min must divide 1440 and be at
  /// least 10; a tier in use by a watch or the defaults can't be removed).
  public shared ({ caller }) func admin_set_tiers(t : TierTable) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (t.tiers.size() == 0 or t.tiers.size() > 10) return #err("1 to 10 tiers");
    for (x in t.tiers.vals()) {
      if (x.every_min < 10 or 1440 % x.every_min != 0) return #err("every_min must be at least 10 and divide 1440");
      if (Array.filter<Tier>(t.tiers, func(y) = y.every_min == x.every_min).size() > 1) return #err("A tier appears twice");
    };
    let kept = func(m : Nat) : Bool = Array.find<Tier>(t.tiers, func(x) = x.every_min == m) != null;
    if (not kept(tuning.defaults.every_min)) return #err("The default frequency (" # Nat.toText(tuning.defaults.every_min) # " min) must stay a tier");
    for (ws in Map.vals(watches)) for (w in ws.vals()) if (not kept(w.settings.every_min)) return #err("Watches use " # Nat.toText(w.settings.every_min) # " min");
    configBlocks(#caller(caller), tierValues(tier_table), tierValues(t));
    tier_table := t;
    #ok("Saved");
  };

  // ---- special prices (spec/special_prices.md) ----

  /// The admin price: an override of the base daily price for people on the admin list (null: none).
  public shared ({ caller }) func set_admin_prices(p : MonPrices) : async SpResult {
    if (not isAdmin(caller)) return #err("Admins only");
    configBlock(#caller(caller), "admin_prices", pricesV(admin_prices), pricesV(p));
    admin_prices := p;
    #ok;
  };

  /// Add or replace a partner's prices: a public label, an override of the base daily price, and
  /// an optional expiry (ns since 1970).
  public shared ({ caller }) func set_partner_prices(partner : Principal, e : MonPartner) : async SpResult {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (SP.validatePartner(partner_prices, partner, e, now())) { case (?err) return #err(err); case null {} };
    let old = Map.get(partner_prices, Map.phash, partner);
    Map.set(partner_prices, Map.phash, partner, e);
    let base : [(Text, T3.Value)] = [("key", #Text("partner_prices")), ("partner", pv(partner)), ("value", partnerV(e))];
    switch old {
      case (?o) if (partnerV(o) != partnerV(e)) block("config_update", #caller(caller), Array.append(base, [("old_value", partnerV(o))]));
      case null block("config_update", #caller(caller), base);
    };
    #ok;
  };

  public shared ({ caller }) func remove_partner_prices(partner : Principal) : async SpResult {
    if (not isAdmin(caller)) return #err("Admins only");
    let old = switch (Map.get(partner_prices, Map.phash, partner)) { case (?o) o; case null return #err("No partner prices for this principal") };
    Map.delete(partner_prices, Map.phash, partner);
    block("config_update", #caller(caller), [("key", #Text("partner_prices")), ("partner", pv(partner)), ("old_value", partnerV(old)), ("value", #Text("removed"))]);
    #ok;
  };

  /// The admin price and every partner entry (expired ones too), public.
  public query func get_special_prices() : async SpecialPrices {
    { admin_prices; partners = SP.listing(partner_prices) };
  };

  /// The special prices that apply to `p`: the admin price when `p` is an admin (a person) and the
  /// partner entry when it has one that has not expired.
  public query func get_special_prices_for(p : Principal) : async SpecialPricesFor {
    { admin_prices = if (getsAdminPrice(p)) ?admin_prices else null; partner = SP.activePartner(partner_prices, p, now()) };
  };

  func resetTimer<system>() {
    Timer.cancelTimer(timer);
    timer := Timer.recurringTimer<system>(#seconds(config.interval_s), startRound);
  };

  public shared ({ caller }) func admin_set_notifications_canister(p : ?Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    configBlock(#caller(caller), "notifications", optPrincipalV(config.notifications), optPrincipalV(p));
    configBlock(#caller(caller), "app_id", optNatV(app_id), #Text("none"));
    config := { config with notifications = p };
    app_id := null;
    #ok("Saved");
  };

  /// Register sneed_mon with Sneed Notifications as the app "Sneed Monitor" (this canister only,
  /// the topics of get_topics). sneed_mon becomes the app's owner.
  public shared ({ caller }) func admin_register_with_notifications() : async ResultNat {
    if (not isAdmin(caller)) return #err("Admins only");
    let n : T.Notifications = switch (config.notifications) { case (?n) actor (Principal.toText(n)); case null return #err("No notifications canister set") };
    let r = try { await n.register_app(appInput()) } catch (e) { return #err("Sneed Notifications did not answer: " # Error.message(e)) };
    switch r { case (#ok(id)) { configBlock(#caller(caller), "app_id", optNatV(app_id), #Nat(id)); app_id := ?id }; case (#err _) {} };
    r;
  };

  /// Bring the registered app (app_id) up to date: name, description and topics as this build has
  /// them, same id. Sneed Notifications lets the app's owner do this, which sneed_mon is when it
  /// registered the app itself.
  public shared ({ caller }) func admin_update_notifications_app() : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    let n : T.Notifications = switch (config.notifications) { case (?n) actor (Principal.toText(n)); case null return #err("No notifications canister set") };
    let id = switch app_id { case (?i) i; case null return #err("No app id: run admin_register_with_notifications or admin_set_app_id") };
    try { await n.update_app(id, appInput()) } catch (e) { #err("Sneed Notifications did not answer: " # Error.message(e)) };
  };

  public shared ({ caller }) func admin_set_app_id(id : ?Nat) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    configBlock(#caller(caller), "app_id", optNatV(app_id), optNatV(id));
    app_id := id;
    #ok("Saved");
  };

  /// Where collected fees go (null: they stay for admin_withdraw_fees).
  public shared ({ caller }) func admin_set_fee_destination(a : ?Account) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    switch a { case (?x) switch (x.subaccount) { case (?s) if (s.size() != 32) return #err("A subaccount is 32 bytes"); case null {} }; case null {} };
    configBlock(#caller(caller), "fee_destination", optAccountV(billing.fee_destination), optAccountV(a));
    billing := { billing with fee_destination = a };
    #ok("Saved");
  };

  public shared ({ caller }) func admin_set_fee_sweep_threshold(e8s : Nat) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    configBlock(#caller(caller), "fee_sweep_threshold_e8s", #Nat(billing.fee_sweep_threshold_e8s), #Nat(e8s));
    billing := { billing with fee_sweep_threshold_e8s = e8s };
    #ok("Saved");
  };

  /// Set the ledger, its fee, the fee destination and threshold. The ledger can't change while
  /// anyone has a balance or fees are left to withdraw.
  public shared ({ caller }) func admin_set_billing(b : BillingConfig) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (b.icp_ledger != billing.icp_ledger and userBalancesTotal() + feesAvailable() > 0) return #err("Balances are held on the current ledger");
    configBlocks(#caller(caller), billingValues(billing), billingValues(b));
    billing := b;
    #ok("Saved");
  };

  /// Withdraw collected fees (never the users' balances): `amount_e8s` comes off the available
  /// fees and `to` receives it less the ledger fee. Returns the ledger block.
  public shared ({ caller }) func admin_withdraw_fees(amount_e8s : Nat, to : Account) : async ResultNat {
    if (not isAdmin(caller)) return #err("Admins only");
    if (fees_in_flight) return #err("A fee withdrawal is under way");
    let fee = billing.ledger_fee_e8s;
    if (amount_e8s > feesAvailable()) return #err("Fees available: " # Nat.toText(feesAvailable()) # " e8s");
    if (amount_e8s <= fee) return #err("The amount must be more than the ledger fee (" # Nat.toText(fee) # " e8s)");
    fees_in_flight := true;
    fees_withdrawn_e8s += amount_e8s;
    try {
      let r = try {
        await ledger().icrc1_transfer({ from_subaccount = null; to; amount = amount_e8s - fee : Nat; fee = ?fee; memo = null; created_at_time = ?Nat64.fromNat(Int.abs(now())) });
      } catch (e) { fees_withdrawn_e8s -= amount_e8s; return #err("The ledger did not answer (nothing moved): " # Error.message(e)) };
      switch r {
        case (#Ok(ledger_block)) {
          block("fee_withdraw", #caller(caller), [("amount_e8s", #Nat(amount_e8s)), ("fee_e8s", #Nat(fee)), ("to", accountV(to)), ("ledger_block", #Nat(ledger_block))]);
          #ok(ledger_block);
        };
        case (#Err(#BadFee(x))) { fees_withdrawn_e8s -= amount_e8s; billing := { billing with ledger_fee_e8s = x.expected_fee }; #err("The ledger fee changed; try again") };
        case (#Err _) { fees_withdrawn_e8s -= amount_e8s; #err("The ledger refused the transfer") };
      };
    } finally { fees_in_flight := false };
  };

  public shared ({ caller }) func admin_pause() : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    configBlock(#caller(caller), "paused", flag(config.paused), flag(true));
    config := { config with paused = true };
    #ok("Paused");
  };

  public shared ({ caller }) func admin_resume() : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    configBlock(#caller(caller), "paused", flag(config.paused), flag(false));
    config := { config with paused = false };
    #ok("Resumed");
  };

  public shared ({ caller }) func admin_set_interval(seconds : Nat) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (seconds < MIN_INTERVAL_S) return #err("The interval is at least 60 seconds");
    configBlock(#caller(caller), "interval_s", #Nat(config.interval_s), #Nat(seconds));
    config := { config with interval_s = seconds };
    resetTimer<system>();
    #ok("Saved");
  };

  /// Start a round (or go on with the open one), and wait for its first tick.
  public shared ({ caller }) func admin_run_now() : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (config.paused) return #err("Paused");
    if (busy()) return #err("A tick is running");
    await startRound();
    #ok("Ran");
  };

  public shared ({ caller }) func admin_add_admin(p : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (not has(admins, p)) {
      admins := Array.append(admins, [p]);
      block("admin_add", #caller(caller), [("principal", pv(p))]);
    };
    #ok("Added");
  };

  public shared ({ caller }) func admin_remove_admin(p : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (has(admins, p)) {
      admins := Array.filter<Principal>(admins, func(a) = a != p);
      block("admin_remove", #caller(caller), [("principal", pv(p))]);
    };
    #ok("Removed");
  };

  // ---------------------------------------------------------------------------------------------
  // ICRC-3 interface (spec/sneed_mon.md §9)
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
    if (not isAdmin(caller)) Debug.trap("Admins only");
    await* Icrc3Log.repairArchiveControllers(icrc3, icrc3_env());
  };

  /// Admins: the log's operational messages (spills, archives created, failures), oldest first.
  public query ({ caller }) func get_log(start : Nat, length : Nat) : async [NT.LogEntry] {
    if (not isAdmin(caller)) Debug.trap("Admins only");
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
    #get_status : Any;
    #get_recent_errors : Any;
    #get_targets : Any;
    #get_config : Any;
    #get_tuning : Any;
    #get_tiers : Any;
    #get_admins : Any;
    #get_topics : Any;
    #get_my_watches : Any;
    #get_watch : Any;
    #get_my_nns_neurons : Any;
    #get_target_topics : Any;
    #get_deposit_account : Any;
    #get_my_balance : Any;
    #get_my_charges : Any;
    #get_accounting : Any;
    #get_billing_config : Any;
    #get_my_charges_with_tier : Any;
    #get_special_prices : Any;
    #get_special_prices_for : Any;
    #set_admin_prices : Any;
    #set_partner_prices : Any;
    #remove_partner_prices : Any;
    #watch : Any;
    #unwatch : Any;
    #update_watch : Any;
    #refresh_my_neurons : Any;
    #set_nns_neurons : Any;
    #list_target_topics : Any;
    #credit_deposit : Any;
    #withdraw_balance : Any;
    #set_auto_top_up : Any;
    #admin_set_config : Any;
    #admin_set_tuning : Any;
    #admin_set_tiers : Any;
    #admin_set_notifications_canister : Any;
    #admin_register_with_notifications : Any;
    #admin_update_notifications_app : Any;
    #admin_set_app_id : Any;
    #admin_set_billing : Any;
    #admin_set_fee_destination : Any;
    #admin_set_fee_sweep_threshold : Any;
    #admin_withdraw_fees : Any;
    #admin_pause : Any;
    #admin_resume : Any;
    #admin_set_interval : Any;
    #admin_run_now : Any;
    #admin_add_admin : Any;
    #admin_remove_admin : Any;
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
  } }) : Bool {
    switch msg {
      case (#get_api_doc _ or #get_status _ or #get_recent_errors _ or #get_targets _ or #get_config _ or #get_tuning _ or #get_tiers _ or #get_admins _ or #get_topics _ or #get_my_watches _ or #get_watch _ or #get_my_nns_neurons _ or #get_target_topics _ or #get_deposit_account _ or #get_my_balance _ or #get_my_charges _ or #get_accounting _ or #get_billing_config _ or #get_my_charges_with_tier _ or #get_special_prices _ or #get_special_prices_for _) false;
      case (#icrc3_get_blocks _ or #icrc3_get_archives _ or #icrc3_get_tip_certificate _ or #icrc3_supported_block_types _ or #icrc10_supported_standards _ or #icrc3_log_status _ or #get_log _) false;
      case (#watch _ or #unwatch _ or #refresh_my_neurons _ or #set_nns_neurons _ or #list_target_topics _ or #credit_deposit _ or #withdraw_balance _ or #set_auto_top_up _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      // a topic filter of up to 50 keys of 64 characters
      case (#update_watch _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.textArg(50 * 64);
      case (#admin_set_tuning _) isAdmin(caller) and arg.size() <= IngressGuard.textArg(50 * 64);
      case (#set_admin_prices _ or #remove_partner_prices _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#set_partner_prices _) isAdmin(caller) and arg.size() <= IngressGuard.textArg(SP.MAX_LABEL_CHARS);
      case (#admin_set_config _ or #admin_set_tiers _ or #admin_set_notifications_canister _ or #admin_register_with_notifications _ or #admin_update_notifications_app _ or #admin_set_app_id _ or #admin_set_billing _ or #admin_set_fee_destination _ or #admin_set_fee_sweep_threshold _ or #admin_withdraw_fees _ or #admin_pause _ or #admin_resume _ or #admin_set_interval _ or #admin_run_now _ or #admin_add_admin _ or #admin_remove_admin _ or #admin_set_icrc3_settings _ or #admin_icrc3_spill_now _ or #admin_icrc3_repair_archive_controllers _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
    };
  };
};
