import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Debug "mo:base/Debug";
import Error "mo:base/Error";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
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
import T "Types";

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

  type Account = { owner : Principal; subaccount : ?Blob };
  type TransferFromError = {
    #BadFee : { expected_fee : Nat }; #BadBurn : { min_burn_amount : Nat }; #InsufficientFunds : { balance : Nat };
    #InsufficientAllowance : { allowance : Nat }; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat };
    #TemporarilyUnavailable; #GenericError : { error_code : Nat; message : Text };
  };
  type IcpLedger = actor {
    icrc2_transfer_from : shared ({ spender_subaccount : ?Blob; from : Account; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 }) -> async { #Ok : Nat; #Err : TransferFromError };
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
    Map.set(apps, Map.nhash, id, { id; name = input.name; logo = input.logo; description = input.description; owner = caller; canisters = input.canisters; topics = input.topics; verified = false; created_at = now() });
    for (c in input.canisters.vals()) Map.set(app_of_canister, Map.phash, c, id);
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
    Map.set(apps, Map.nhash, id, { id; name = input.name; logo = input.logo; description = input.description; owner; canisters = input.canisters; topics = input.topics; verified = true; created_at = now() });
    for (c in input.canisters.vals()) Map.set(app_of_canister, Map.phash, c, id);
    #ok(id);
  };

  /// The owner (or an admin) changes an app's name, topics or canisters.
  public shared ({ caller }) func update_app(id : Nat, input : AppInput) : async Result {
    let a = switch (Map.get(apps, Map.nhash, id)) { case (?a) a; case null return #err("No such app") };
    if (caller != a.owner and not isAdmin(caller)) return #err("Only the app's owner");
    switch (checkAppInput(input)) { case (?e) return #err(e); case null {} };
    for (c in input.canisters.vals()) {
      switch (Map.get(app_of_canister, Map.phash, c)) { case (?other) if (other != id) return #err(Principal.toText(c) # " belongs to another app"); case null {} };
      if (Array.find<Principal>(a.canisters, func(x) = x == c) == null and c != caller) switch (await* Control.controls(sns, config.sns_wasm, caller, c)) { case (#err(e)) return #err(e); case (#ok) {} };
    };
    let cur = switch (Map.get(apps, Map.nhash, id)) { case (?a) a; case null return #err("No such app") };
    for (c in input.canisters.vals()) switch (Map.get(app_of_canister, Map.phash, c)) { case (?other) if (other != id) return #err(Principal.toText(c) # " belongs to another app"); case null {} };
    for (c in cur.canisters.vals()) Map.delete(app_of_canister, Map.phash, c);
    for (c in input.canisters.vals()) Map.set(app_of_canister, Map.phash, c, id);
    Map.set(apps, Map.nhash, id, { cur with name = input.name; logo = input.logo; description = input.description; canisters = input.canisters; topics = input.topics });
    #ok("Updated");
  };

  /// Fund an app's balance (for sponsored messages). Anyone may: ICP by ICRC-2 approval.
  public shared ({ caller }) func top_up_app(id : Nat, amount_e8s : Nat) : async ResultNat {
    if (not Map.has(apps, Map.nhash, id)) return #err("No such app");
    switch (await* pull(caller, amount_e8s)) { case (#err(e)) return #err(e); case (#ok) {} };
    let b = appBalanceOf(id) + amount_e8s;
    Map.set(app_balances, Map.nhash, id, b);
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

  func notifyOne(a : App, input : NotifyInput) : NotifyResult {
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
      if (inSet and c.state == #verified) wanted.add(c);
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
    if (input.sponsored) Map.set(app_balances, Map.nhash, a.id, appBalanceOf(a.id) - (appSpent + config.notify_price_e8s));
    Map.set(user_balances, Map.phash, user, balance);
    Map.set(usage, Map.thash, k, (uDay, count + 1, userSpent));
    record({ id; app = a.id; user; topic = topic.id; title = input.title; body = input.body; link = input.link; level; created_at = t; jobs = Buffer.toArray(jobIds) });
    let queued = Array.filter<Nat>(Buffer.toArray(jobIds), func(j) = Map.has(pending, Map.nhash, j)).size();
    #ok({ id; deliveries = queued; deduplicated = false });
  };

  /// Send a user a message. Only a registered app's canisters may call it.
  public shared ({ caller }) func notify(input : NotifyInput) : async NotifyResult {
    let a = switch (appOfCaller(caller)) { case (?a) a; case null return #err(#not_registered) };
    let r = notifyOne(a, input);
    kick<system>();
    r;
  };

  public shared ({ caller }) func notify_batch(inputs : [NotifyInput]) : async [NotifyResult] {
    if (inputs.size() > MAX_BATCH) trap("At most 100 messages per batch");
    let a = switch (appOfCaller(caller)) { case (?a) a; case null return Array.map<NotifyInput, NotifyResult>(inputs, func(_) = #err(#not_registered)) };
    let r = Array.map<NotifyInput, NotifyResult>(inputs, func(i) = notifyOne(a, i));
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
    let seed = await Random.blob();
    var code = "";
    for (b in seed.vals()) if (code.size() < 6) code #= Nat.toText(Nat8.toNat(b) % 10);
    ignore smsChannel(caller);
    let c : Channel = { id = next_channel_id; kind; name; address; state = #unverified; created_at = now() };
    next_channel_id += 1;
    Map.set(channels, Map.phash, caller, Array.append(userChannels(caller), [c]));
    Map.set(codes, Map.nhash, c.id, (code, now() + DAY_NS));
    // the code goes out through the channel's relay, free
    let n = next_notification_id;
    next_notification_id += 1;
    let j = newJob(n, caller, c, now(), 0, true);
    record({ id = n; app = SYSTEM_APP; user = caller; topic = "verify"; title = "Your Sneed Notifications code: " # code; body = "Enter this code in Sneed Hub to confirm this channel. If you didn't ask for it, ignore this message."; link = null; level = #urgent; created_at = now(); jobs = [j] });
    #ok(c.id);
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

  /// Top up your notification balance with ICP (approve this canister for amount + fee first).
  public shared ({ caller }) func top_up(amount_e8s : Nat) : async ResultNat {
    switch (signedIn(caller)) { case (?e) return #err(e); case null {} };
    switch (await* pull(caller, amount_e8s)) { case (#err(e)) return #err(e); case (#ok) {} };
    let b = balanceOf(caller) + amount_e8s;
    Map.set(user_balances, Map.phash, caller, b);
    #ok(b);
  };

  func pull(from : Principal, amount : Nat) : async* { #ok; #err : Text } {
    if (amount == 0) return #err("Nothing to top up");
    let ledger : IcpLedger = actor (Principal.toText(config.icp_ledger));
    try {
      switch (await ledger.icrc2_transfer_from({ spender_subaccount = null; from = { owner = from; subaccount = null }; to = { owner = Principal.fromActor(this); subaccount = null }; amount; fee = null; memo = null; created_at_time = null })) {
        case (#Ok _) #ok;
        case (#Err(#InsufficientAllowance(a))) #err("Approve this canister for the amount first (allowance " # Nat.toText(a.allowance) # ")");
        case (#Err(#InsufficientFunds(b))) #err("Not enough ICP (balance " # Nat.toText(b.balance) # ")");
        case (#Err _) #err("The ledger refused the transfer");
      };
    } catch (e) { #err("The ledger did not answer: " # Error.message(e)) };
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
  public query ({ caller }) func get_my_history(limit : Nat) : async [HistoryItem] {
    let ids = switch (Map.get(user_notifications, Map.phash, caller)) { case (?l) l; case null [] };
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
  public query func stats() : async { apps : Nat; users : Nat; notifications : Nat; pending : Nat } {
    { apps = Map.size(apps); users = Map.size(channels); notifications = Map.size(notifications); pending = Map.size(pending) };
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
    for (j in gone.vals()) finish(j, #failed({ reason = "channel removed" }));
    for (jid in missing.vals()) Map.delete(pending, Map.nhash, jid);
    Buffer.toArray(out);
  };

  public shared ({ caller }) func relay_ack(results : [(Nat, { #ok; #err : Text })]) : async () {
    if (relayKind(caller) == null) trap("Not a relay");
    for ((jid, r) in results.vals()) switch (Map.get(jobs, Map.nhash, jid)) {
      case (?j) switch (j.state) {
        case (#sending(s)) if (s.relay == caller) switch r {
          case (#ok) finish(j, #delivered({ at = now() }));
          case (#err(e)) retry(j, e);
        };
        case _ {};
      };
      case null {};
    };
  };

  func finish(j : Job, state : JobState) {
    Map.set(jobs, Map.nhash, j.id, { j with state });
    Map.delete(pending, Map.nhash, j.id);
    switch (state) {
      case (#failed _) refund(j);
      case _ {};
    };
  };

  func retry(j : Job, e : Text) {
    if (j.attempts + 1 >= config.max_attempts) finish({ j with attempts = j.attempts + 1 }, #failed({ reason = e })) else Map.set(jobs, Map.nhash, j.id, { j with attempts = j.attempts + 1; state = #queued; not_before = now() + 60_000_000_000 * (j.attempts + 1) });
  };

  func refund(j : Job) {
    if (j.price_e8s == 0) return;
    if (j.paid_by_app) switch (Map.get(notifications, Map.nhash, j.notification)) {
      case (?n) Map.set(app_balances, Map.nhash, n.app, appBalanceOf(n.app) + j.price_e8s);
      case null {};
    } else Map.set(user_balances, Map.phash, j.user, balanceOf(j.user) + j.price_e8s);
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
    ticks += 1;
    let t = now();
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
    for (j in lapsed.vals()) retry(j, "relay did not answer");
    let sms : Sms = actor (Principal.toText(config.sneed_sms));
    for (j in due.vals()) switch (Map.get(notifications, Map.nhash, j.notification)) {
      case (?n) {
        let (subject, body) = smsText(n);
        try {
          switch (await sms.send_system_notification({ recipients = [j.user]; subject; body })) {
            case (#ok _) finish(j, #delivered({ at = now() }));
            case (#err(e)) retry(j, debug_show e);
          };
        } catch (e) { retry(j, Error.message(e)) };
      };
      case null finish(j, #failed({ reason = "message removed" }));
    };
    if (ticks % 120 == 0) prune(t);
    ticking := false;
  };

  func prune(t : Int) {
    let old = Buffer.Buffer<Nat>(50);
    label scan for (n in Map.vals(notifications)) {
      if (old.size() >= 500) break scan;
      if (t - n.created_at > config.retention_ns) old.add(n.id);
    };
    for (id in old.vals()) switch (Map.get(notifications, Map.nhash, id)) {
      case (?n) {
        for (j in n.jobs.vals()) { Map.delete(jobs, Map.nhash, j); Map.delete(pending, Map.nhash, j) };
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
    config := c;
    #ok("Saved");
  };
  public shared ({ caller }) func admin_set_relay_key(kind : ChannelKind, key : Text) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (key.size() > 4_096) return #err("Key too long");
    relay_keys := Array.append(Array.filter<(ChannelKind, Text)>(relay_keys, func((k, _)) = k != kind), if (key == "") [] else [(kind, key)]);
    #ok("Saved");
  };

  public shared ({ caller }) func admin_add_admin(p : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (Array.find<Principal>(admins, func(a) = a == p) == null) admins := Array.append(admins, [p]);
    #ok("Added");
  };
  public shared ({ caller }) func admin_remove_admin(p : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    admins := Array.filter<Principal>(admins, func(a) = a != p);
    #ok("Removed");
  };
  public shared ({ caller }) func admin_set_app_verified(id : Nat, verified : Bool) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (Map.get(apps, Map.nhash, id)) { case (?a) { Map.set(apps, Map.nhash, id, { a with verified }); #ok("Saved") }; case null #err("No such app") };
  };
  /// Remove an abusive app: it can no longer notify anyone.
  public shared ({ caller }) func admin_remove_app(id : Nat) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (Map.get(apps, Map.nhash, id)) {
      case (?a) { for (c in a.canisters.vals()) Map.delete(app_of_canister, Map.phash, c); Map.delete(apps, Map.nhash, id); #ok("Removed") };
      case null #err("No such app");
    };
  };

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
  } }) : Bool {
    switch msg {
      case (#get_api_doc _ or #get_relay_keys _ or #get_admins _ or #get_app _ or #get_app_balance _ or #get_app_of _ or #get_config _ or #get_my_apps _ or #get_my_history _ or #get_my_requests _ or #get_my_settings _ or #get_receipts _ or #list_apps _ or #stats _) false;
      // apps call these from their canisters, never by ingress
      case (#notify _ or #notify_batch _ or #request_permission _) false;
      case (#admin_add_admin _ or #admin_remove_admin _ or #admin_remove_app _ or #admin_set_app_verified _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#admin_set_config _ or #admin_register_app _ or #admin_set_relay_key _) isAdmin(caller) and arg.size() <= IngressGuard.MEDIUM_ARG;
      case (#register_app _ or #update_app _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.MEDIUM_ARG;
      case (#relay_ack _) relayKind(caller) != null and arg.size() <= IngressGuard.MEDIUM_ARG;
      case (#relay_pull _) relayKind(caller) != null and arg.size() <= IngressGuard.SMALL_ARG;
      case (#add_channel _ or #set_settings _ or #set_permission _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.textArg(MAX_ADDRESS + 256);
      case _ not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.SMALL_ARG;
    };
  };
};
