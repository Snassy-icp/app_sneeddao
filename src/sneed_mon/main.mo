import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Char "mo:base/Char";
import Cycles "mo:base/ExperimentalCycles";
import Error "mo:base/Error";
import Int "mo:base/Int";
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
import SnsDirectory "../sneed_names/SnsDirectory";
import ApiDoc "ApiDoc";
import T "Types";

/// sneed_mon (spec/sneed_mon.md): Sneed Hub's watcher. Users opt in per SNS; on a timer it reads
/// each watched SNS's open proposals, finds the watchers whose neurons can vote and haven't, and
/// tells them through Sneed Notifications (app "Sneed Hub", topic `proposals`): once when a
/// proposal they can vote on appears, and once more about a day before voting closes if they still
/// haven't voted. Step 1 is proposals only; low cycles and rewards are planned topics.
shared (deployer) persistent actor class SneedMon() = this {

  public type MonTopic = T.MonTopic;
  public type PassState = T.PassState;
  public type OpenProposal = T.OpenProposal;
  public type WatchedSns = T.WatchedSns;
  public type Config = T.Config;
  public type Status = T.Status;
  public type SnsInfo = T.SnsInfo;
  public type MyWatch = T.MyWatch;
  public type Result = T.Result;
  public type ResultNat = T.ResultNat;

  type PassKind = { #new; #reminder };

  // ---------------------------------------------------------------------------------------------
  // State (enhanced orthogonal persistence, like sneed_notifications)
  // ---------------------------------------------------------------------------------------------

  let PERMISSION_VOTE : Int32 = 4;
  let ACCEPT_VOTES : Int32 = 1; // reward status: still open for votes (keeps listings small)
  let NEURON_PAGE : Nat = 100;
  let PROPOSAL_PAGE : Nat = 50;
  let MAX_OPEN_PER_SNS : Nat = 50;
  let MAX_FAILS : Nat = 3;
  let MIN_INTERVAL_S : Nat = 60;
  let STALE_RUN_NS : Int = 900_000_000_000; // a run that trapped mid-way frees the lock after 15 min
  let TOPIC_PROPOSALS = "proposals";
  let LINK_BASE = "https://app.sneeddao.com/proposal?proposalid=";

  var config : Config = {
    notifications = ?Principal.fromText("vuy7a-iaaaa-aaaay-aaduq-cai");
    sns_wasm = Principal.fromText(SnsDirectory.SNS_W_MAINNET);
    interval_s = 600;
    paused = false;
    sponsored = false;
    max_users = 1_000;
    max_watches_per_user = 10;
    max_snses = 100;
    max_calls_per_tick = 200;
    max_continuations = 10;
    reminder_window_s = 86_400;
    batch_size = 50;
    neuron_pages = 3;
    proposal_pages = 3;
    neuron_cache_s = 3_600;
  };
  var admins : [Principal] = [];
  var app_id : ?Nat = null;

  let snses = Map.new<Principal, WatchedSns>(); // root -> state
  let user_watches = Map.new<Principal, [Principal]>(); // user -> SNS roots (topic proposals)
  let directory : SnsDirectory.State = SnsDirectory.init();

  var round_no : Nat = 0;
  var last_round_start : Int = 0;
  var last_round_end : Int = 0;
  var calls_total : Nat = 0;
  var calls_last_round : Nat = 0;
  var sent : Nat = 0;
  var deduplicated : Nat = 0;
  var skipped_not_allowed : Nat = 0;
  var skipped_rate_limited : Nat = 0;
  var skipped_other : Nat = 0;
  var errors : Nat = 0;
  var last_error : ?(Int, Text) = null;

  // per round, rebuilt after an upgrade (the passes' cursors are stable, so work resumes)
  transient var queue : [Principal] = [];
  transient var qpos : Nat = 0;
  transient var budget : Nat = 0;
  transient var continuations : Nat = 0;
  transient var running_since : ?Int = null;
  transient var notify_broken = false; // the notifications canister refused us: no more passes this round
  transient let ballot_cache = Map.new<Text, Map.Map<Text, Int32>>(); // "root/id/kind" -> neuron hex -> vote
  transient let neuron_cache = Map.new<Text, (Int, [Text])>(); // "user/root" -> (fetched, vote neuron hexes)

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  func now() : Int = Time.now();
  func nowS() : Nat64 = Nat64.fromNat(Int.abs(now()) / 1_000_000_000);
  func isAdmin(p : Principal) : Bool = Principal.isController(p) or Array.find<Principal>(admins, func(a) = a == p) != null;
  func watchesOf(u : Principal) : [Principal] = switch (Map.get(user_watches, Map.phash, u)) { case (?w) w; case null [] };
  func has(xs : [Principal], p : Principal) : Bool = Array.find<Principal>(xs, func(x) = x == p) != null;
  func gov(p : Principal) : T.Governance = actor (Principal.toText(p));
  func spend() { if (budget > 0) budget -= 1; calls_total += 1; calls_last_round += 1 };

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

  func noteError(root : ?Principal, msg : Text) {
    errors += 1;
    last_error := ?(now(), msg);
    switch (root) {
      case (?r) switch (Map.get(snses, Map.phash, r)) {
        case (?s) Map.set(snses, Map.phash, r, { s with last_error = ?(now(), msg); errors = s.errors + 1 });
        case null {};
      };
      case null {};
    };
  };

  func deadlineOf(created : Nat64, initial : Nat64, wfq : ?{ current_deadline_timestamp_seconds : Nat64 }) : Nat64 = switch wfq {
    case (?w) w.current_deadline_timestamp_seconds;
    case null created + initial;
  };

  func inWindow(deadline : Nat64) : Bool {
    let t = nowS();
    deadline > t and Nat64.toNat(deadline - t) <= config.reminder_window_s;
  };

  func hoursLeft(deadline : Nat64) : Text {
    let t = nowS();
    if (deadline <= t) return "now";
    let h = Nat64.toNat(deadline - t) / 3600;
    if (h == 0) "in less than an hour" else if (h == 1) "in about 1 hour" else "in about " # Nat.toText(h) # " hours";
  };

  func shortRoot(p : Principal) : Text {
    let t = Principal.toText(p);
    clip(t, 12);
  };

  // ---------------------------------------------------------------------------------------------
  // Users: opt in per SNS
  // ---------------------------------------------------------------------------------------------

  /// Watch an SNS's proposals: you are told when one of your neurons (those you hold the vote
  /// permission on) can vote on a new proposal, and a day before voting closes if it hasn't.
  /// `root` must be the root of an SNS that SNS-W lists. Allow the app "Sneed Hub" in the
  /// notification centre to receive the messages.
  public shared ({ caller }) func watch_sns(root : Principal) : async Result {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    switch (capCheck(caller, root)) { case (?e) return e; case null {} };
    let known = Map.get(snses, Map.phash, root);
    var governance = switch (known) { case (?s) s.governance; case null root };
    var name = "";
    if (known == null) {
      try {
        switch (await* SnsDirectory.governanceOf(directory, config.sns_wasm, root)) {
          case (?g) governance := g;
          case null return #err("Not the root of an SNS listed by SNS-W (try again in a minute if it is new)");
        };
      } catch (e) { return #err("SNS-W did not answer: " # Error.message(e)) };
      try { name := switch ((await gov(governance).get_metadata({})).name) { case (?n) clip(n, 64); case null "" } } catch (_) {};
    };
    // the state may have changed while we waited
    switch (capCheck(caller, root)) { case (?e) return e; case null {} };
    switch (Map.get(snses, Map.phash, root)) {
      case (?s) Map.set(snses, Map.phash, root, { s with watchers = sortedInsert(s.watchers, caller) });
      case null Map.set(snses, Map.phash, root, {
        root; governance; name = if (name == "") "SNS " # shortRoot(root) else name; watchers = [caller]; open = []; max_seen_id = (0 : Nat64);
        listed_round = 0; listed_at = 0; last_error = null; errors = 0;
      });
    };
    Map.set(user_watches, Map.phash, caller, Array.append(watchesOf(caller), [root]));
    // best effort: the request shows up in the user's notification centre
    switch (config.notifications, app_id) {
      case (?n, ?_) try { ignore await (actor (Principal.toText(n)) : T.Notifications).request_permission(caller) } catch (_) {};
      case _ {};
    };
    #ok("Watching");
  };

  /// null when `caller` may watch `root`, else the error to answer.
  func capCheck(caller : Principal, root : Principal) : ?Result {
    let mine = watchesOf(caller);
    if (has(mine, root)) return ?#ok("Already watching");
    if (mine.size() >= config.max_watches_per_user) return ?#err("At most " # Nat.toText(config.max_watches_per_user) # " SNSes per user");
    if (mine.size() == 0 and Map.size(user_watches) >= config.max_users) return ?#err("sneed_mon is full (watcher limit); try again later");
    if (not Map.has(snses, Map.phash, root) and Map.size(snses) >= config.max_snses) return ?#err("sneed_mon watches as many SNSes as it may; try again later");
    null;
  };

  func sortedInsert(xs : [Principal], p : Principal) : [Principal] {
    if (has(xs, p)) return xs;
    Array.sort<Principal>(Array.append(xs, [p]), Principal.compare);
  };

  public shared ({ caller }) func unwatch_sns(root : Principal) : async Result {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    let mine = watchesOf(caller);
    if (not has(mine, root)) return #ok("Not watching");
    let rest = Array.filter<Principal>(mine, func(r) = r != root);
    if (rest.size() == 0) Map.delete(user_watches, Map.phash, caller) else Map.set(user_watches, Map.phash, caller, rest);
    switch (Map.get(snses, Map.phash, root)) {
      case (?s) {
        let w = Array.filter<Principal>(s.watchers, func(x) = x != caller);
        if (w.size() == 0) Map.delete(snses, Map.phash, root) else Map.set(snses, Map.phash, root, { s with watchers = w });
      };
      case null {};
    };
    #ok("Stopped watching");
  };

  public query ({ caller }) func get_my_watches() : async [MyWatch] {
    Array.mapFilter<Principal, MyWatch>(watchesOf(caller), func(r) = switch (Map.get(snses, Map.phash, r)) {
      case (?s) ?{ topic = #proposals; root = r; governance = s.governance; name = s.name };
      case null null;
    });
  };

  // ---------------------------------------------------------------------------------------------
  // Rounds: list proposals, then run passes over the watchers
  // ---------------------------------------------------------------------------------------------

  func busy() : Bool = switch running_since { case (?t) now() - t < STALE_RUN_NS; case null false };

  func startRound() : async () {
    if (config.paused or busy()) return;
    // a round that is still resuming keeps going instead of starting over
    if (qpos < queue.size()) return await work();
    round_no += 1;
    last_round_start := now();
    calls_last_round := 0;
    queue := Iter.toArray(Map.keys(snses));
    qpos := 0;
    continuations := 0;
    notify_broken := false;
    Map.clear(ballot_cache);
    if (Map.size(neuron_cache) > 20_000) Map.clear(neuron_cache);
    await work();
  };

  /// One tick: at most max_calls_per_tick calls, then a follow-up tick if work is left.
  func work() : async () {
    if (busy()) return;
    running_since := ?now();
    budget := config.max_calls_per_tick;
    label run while (qpos < queue.size()) {
      if (config.paused) break run;
      let done = try { await* processSns(queue[qpos]) } catch (e) { noteError(?queue[qpos], "round: " # Error.message(e)); true };
      if (not done) break run;
      qpos += 1;
    };
    running_since := null;
    if (qpos >= queue.size()) {
      last_round_end := now();
    } else if (not config.paused and continuations < config.max_continuations) {
      continuations += 1;
      ignore Timer.setTimer<system>(#seconds 1, work);
    } else {
      // the rest waits for the next round; the passes' cursors keep their place
      queue := [];
      qpos := 0;
      last_round_end := now();
    };
  };

  /// true when this SNS is finished for the round, false when the budget ran out first.
  func processSns(root : Principal) : async* Bool {
    let s = switch (Map.get(snses, Map.phash, root)) { case (?s) s; case null return true };
    if (s.listed_round != round_no) {
      if (budget == 0) return false;
      let ok = await* listProposals(root);
      if (not ok) return true;
    };
    if (config.notifications == null) return true;
    let props = switch (Map.get(snses, Map.phash, root)) { case (?s) s.open; case null return true };
    for (p in props.vals()) {
      if (notify_broken) return true;
      if (p.new_pass != #done) {
        if (not (await* runPass(root, p.id, #new))) return false;
      };
      switch (findOpen(root, p.id)) {
        case (?q) if (q.reminder_pass != #done and q.new_pass == #done and inWindow(q.deadline_s)) {
          if (not (await* runPass(root, q.id, #reminder))) return false;
        };
        case null {};
      };
    };
    true;
  };

  func findOpen(root : Principal, id : Nat64) : ?OpenProposal = switch (Map.get(snses, Map.phash, root)) {
    case (?s) Array.find<OpenProposal>(s.open, func(p) = p.id == id);
    case null null;
  };

  func updateOpen(root : Principal, id : Nat64, f : OpenProposal -> OpenProposal) {
    switch (Map.get(snses, Map.phash, root)) {
      case (?s) Map.set(snses, Map.phash, root, { s with open = Array.map<OpenProposal, OpenProposal>(s.open, func(p) = if (p.id == id) f(p) else p) });
      case null {};
    };
  };

  func setPass(root : Principal, id : Nat64, kind : PassKind, st : PassState) {
    updateOpen(root, id, func(p) = switch kind { case (#new) ({ p with new_pass = st }); case (#reminder) ({ p with reminder_pass = st }) });
  };

  /// One round's list_proposals for an SNS: only those still accepting votes, newest first, a few
  /// pages at most (the deadline is checked here too).
  func listProposals(root : Principal) : async* Bool {
    let s = switch (Map.get(snses, Map.phash, root)) { case (?s) s; case null return false };
    let t = nowS();
    let found = Buffer.Buffer<(Nat64, Text, Nat64)>(16);
    var before : ?T.ProposalId = null;
    var page = 0;
    try {
      label pages while (page < config.proposal_pages) {
        page += 1;
        spend();
        let r = await gov(s.governance).list_proposals({ include_reward_status = [ACCEPT_VOTES]; before_proposal = before; limit = Nat32.fromNat(PROPOSAL_PAGE); exclude_type = []; include_status = []; include_topics = null });
        var lastOpen = false;
        for (p in r.proposals.vals()) switch (p.id) {
          case (?pid) {
            let d = deadlineOf(p.proposal_creation_timestamp_seconds, p.initial_voting_period_seconds, p.wait_for_quiet_state);
            lastOpen := d > t;
            if (d > t) found.add((pid.id, switch (p.proposal) { case (?x) x.title; case null "" }, d));
            before := ?pid;
          };
          case null {};
        };
        if (r.proposals.size() < PROPOSAL_PAGE or not lastOpen or budget == 0) break pages;
      };
    } catch (e) {
      noteError(?root, "list_proposals: " # Error.message(e));
      switch (Map.get(snses, Map.phash, root)) { case (?cur) Map.set(snses, Map.phash, root, { cur with listed_round = round_no }); case null {} };
      return false;
    };
    let cur = switch (Map.get(snses, Map.phash, root)) { case (?c) c; case null return false };
    let firstListing = cur.listed_at == 0;
    let open = Buffer.Buffer<OpenProposal>(found.size());
    var maxSeen = cur.max_seen_id;
    for ((id, title, d) in found.vals()) {
      if (id > maxSeen) maxSeen := id;
      switch (Array.find<OpenProposal>(cur.open, func(p) = p.id == id)) {
        case (?p) open.add({ p with title = clip(title, 120); deadline_s = d });
        // new since the last round (or every open one the first time): announce it; one we had
        // seen before but dropped is only reminded about
        case null open.add({ id; title = clip(title, 120); deadline_s = d; new_pass = if (firstListing or id > cur.max_seen_id) #todo else #done; reminder_pass = #todo; fails = 0 });
      };
    };
    // open ones beyond the pages read stay while their deadline is ahead
    for (p in cur.open.vals()) if (p.deadline_s > t and Array.find<(Nat64, Text, Nat64)>(Buffer.toArray(found), func((id, _, _)) = id == p.id) == null) open.add(p);
    let sorted = Array.sort<OpenProposal>(Buffer.toArray(open), func(a, b) = Nat64.compare(a.id, b.id));
    let kept = if (sorted.size() > MAX_OPEN_PER_SNS) Array.subArray<OpenProposal>(sorted, (sorted.size() - MAX_OPEN_PER_SNS : Nat), MAX_OPEN_PER_SNS) else sorted;
    Map.set(snses, Map.phash, root, { cur with open = kept; max_seen_id = maxSeen; listed_round = round_no; listed_at = now() });
    true;
  };

  func kindText(k : PassKind) : Text = switch k { case (#new) "new"; case (#reminder) "reminder" };

  /// The proposal's ballots, fetched once per pass and round (list_proposals only returns the
  /// caller's own ballots, so get_proposal is needed). false when the pass can't go on this round.
  func ballotKey(root : Principal, id : Nat64, kind : PassKind) : Text = Principal.toText(root) # "/" # Nat64.toText(id) # "/" # kindText(kind);

  func ballotsFor(root : Principal, s : WatchedSns, id : Nat64, kind : PassKind) : async* Bool {
    let key = ballotKey(root, id, kind);
    if (Map.has(ballot_cache, Map.thash, key)) return true;
    spend();
    try {
      let r = await gov(s.governance).get_proposal({ proposal_id = ?{ id } });
      switch (r.result) {
        case (?#Proposal(p)) {
          let m = Map.new<Text, Int32>();
          for ((k, b) in p.ballots.vals()) Map.set(m, Map.thash, k, b.vote);
          Map.set(ballot_cache, Map.thash, key, m);
          let d = deadlineOf(p.proposal_creation_timestamp_seconds, p.initial_voting_period_seconds, p.wait_for_quiet_state);
          updateOpen(root, id, func(o) = { o with deadline_s = d });
          true;
        };
        case _ {
          noteError(?root, "get_proposal " # Nat64.toText(id) # ": not found");
          setPass(root, id, kind, #done);
          false;
        };
      };
    } catch (e) {
      noteError(?root, "get_proposal " # Nat64.toText(id) # ": " # Error.message(e));
      updateOpen(root, id, func(o) = if (o.fails + 1 >= MAX_FAILS) { { o with fails = o.fails + 1; new_pass = if (kind == #new) #done else o.new_pass; reminder_pass = if (kind == #reminder) #done else o.reminder_pass } } else { { o with fails = o.fails + 1 } });
      false;
    };
  };

  /// The hex ids of `user`'s neurons in this SNS on which they hold the vote permission (cached
  /// for neuron_cache_s). null when governance did not answer.
  func voteNeurons(root : Principal, governance : Principal, user : Principal) : async* ?[Text] {
    let key = Principal.toText(user) # "/" # Principal.toText(root);
    switch (Map.get(neuron_cache, Map.thash, key)) {
      case (?(at, ids)) if (now() - at < config.neuron_cache_s * 1_000_000_000) return ?ids;
      case null {};
    };
    let ids = Buffer.Buffer<Text>(4);
    var start : ?T.NeuronId = null;
    var page = 0;
    try {
      label pages while (page < config.neuron_pages) {
        page += 1;
        spend();
        let r = await gov(governance).list_neurons({ of_principal = ?user; limit = Nat32.fromNat(NEURON_PAGE); start_page_at = start });
        for (n in r.neurons.vals()) switch (n.id) {
          case (?nid) {
            start := ?nid;
            if (Array.find<{ principal : ?Principal; permission_type : [Int32] }>(n.permissions, func(x) = x.principal == ?user and Array.find<Int32>(x.permission_type, func(t) = t == PERMISSION_VOTE) != null) != null) ids.add(hex(nid.id));
          };
          case null {};
        };
        if (r.neurons.size() < NEURON_PAGE) break pages;
      };
    } catch (e) {
      noteError(?root, "list_neurons: " # Error.message(e));
      return null;
    };
    let out = Buffer.toArray(ids);
    Map.set(neuron_cache, Map.thash, key, (now(), out));
    ?out;
  };

  func message(s : WatchedSns, p : OpenProposal, kind : PassKind, user : Principal, neurons : Nat) : T.NotifyInput {
    let idText = Nat64.toText(p.id);
    let link = LINK_BASE # idText # "&sns=" # Principal.toText(s.root);
    let ns = if (neurons == 1) "1 of your neurons" else Nat.toText(neurons) # " of your neurons";
    let what = if (p.title == "") "" else "\"" # p.title # "\"\n\n";
    switch kind {
      case (#new) ({
        user; topic = TOPIC_PROPOSALS; sponsored = config.sponsored; link = ?link;
        title = clip(s.name # " proposal #" # idText # ": you can vote", 200);
        body = what # ns # " can vote on it. Voting closes " # hoursLeft(p.deadline_s) # ".";
        dedupe = ?("prop:" # Principal.toText(s.root) # ":" # idText);
      });
      case (#reminder) ({
        user; topic = TOPIC_PROPOSALS; sponsored = config.sponsored; link = ?link;
        title = clip(s.name # " proposal #" # idText # " closes soon", 200);
        body = what # "Voting closes " # hoursLeft(p.deadline_s) # " and " # ns # (if (neurons == 1) " hasn't" else " haven't") # " voted yet.";
        dedupe = ?("propdl:" # Principal.toText(s.root) # ":" # idText);
      });
    };
  };

  /// One pass of one proposal over the SNS's watchers, from where it stopped. true when the SNS
  /// may go on (the pass finished, or can't go on this round), false when the budget ran out.
  func runPass(root : Principal, id : Nat64, kind : PassKind) : async* Bool {
    let s0 = switch (Map.get(snses, Map.phash, root)) { case (?s) s; case null return true };
    if (budget == 0) return false;
    if (not (await* ballotsFor(root, s0, id, kind))) return true;
    let ballots = switch (Map.get(ballot_cache, Map.thash, ballotKey(root, id, kind))) { case (?b) b; case null return true };
    let s = switch (Map.get(snses, Map.phash, root)) { case (?s) s; case null return true };
    let p = switch (Array.find<OpenProposal>(s.open, func(x) = x.id == id)) { case (?p) p; case null return true };
    let state = switch kind { case (#new) p.new_pass; case (#reminder) p.reminder_pass };
    let after : ?Principal = switch state { case (#done) return true; case (#todo) null; case (#after(u)) ?u };
    // a proposal first announced within the reminder window already says when it closes
    if (kind == #new and state == #todo and inWindow(p.deadline_s)) setPass(root, id, #reminder, #done);
    let batch = Buffer.Buffer<T.NotifyInput>(config.batch_size);
    var last : ?Principal = null; // the last watcher looked at whose result is not committed yet
    for (u in s.watchers.vals()) {
      let ahead = switch after { case (?a) Principal.compare(u, a) == #greater; case null true };
      if (ahead) {
        if (budget == 0) {
          ignore await* flushAndCommit(root, id, kind, batch, last);
          return false;
        };
        // still watching? (the list is the one from the start of the pass)
        if (has(watchesOf(u), root)) {
          switch (await* voteNeurons(root, s.governance, u)) {
            case (?mine) {
              var n = 0;
              for (h in mine.vals()) switch (Map.get(ballots, Map.thash, h)) { case (?v) if (v == 0) n += 1; case null {} };
              if (n > 0) {
                let cur = switch (findOpen(root, id)) { case (?c) c; case null p };
                batch.add(message(s, cur, kind, u, n));
              };
            };
            case null {
              // governance did not answer: stop here, the pass resumes next round
              ignore await* flushAndCommit(root, id, kind, batch, last);
              return true;
            };
          };
        };
        last := ?u;
        if (batch.size() >= Nat.min(config.batch_size, 100)) {
          if (not (await* flushAndCommit(root, id, kind, batch, last))) return true;
        } else if (batch.size() == 0) setPass(root, id, kind, #after(u));
      };
    };
    if (await* flushAndCommit(root, id, kind, batch, last)) setPass(root, id, kind, #done);
    true;
  };

  /// Send the batch; on success move the pass's cursor to `last`. false when nothing was sent
  /// (the call failed, or the notifications canister doesn't know us), so the users are tried again.
  func flushAndCommit(root : Principal, id : Nat64, kind : PassKind, batch : Buffer.Buffer<T.NotifyInput>, last : ?Principal) : async* Bool {
    if (batch.size() == 0) {
      switch last { case (?u) setPass(root, id, kind, #after(u)); case null {} };
      return true;
    };
    let n : T.Notifications = switch (config.notifications) { case (?n) actor (Principal.toText(n)); case null return false };
    let inputs = Buffer.toArray(batch);
    batch.clear();
    spend();
    let results = try { await n.notify_batch(inputs) } catch (e) {
      noteError(?root, "notify_batch: " # Error.message(e));
      notify_broken := true;
      return false;
    };
    var refused = false;
    for (r in results.vals()) switch r {
      case (#ok(x)) if (x.deduplicated) deduplicated += 1 else sent += 1;
      case (#err(#not_allowed)) skipped_not_allowed += 1;
      case (#err(#rate_limited)) skipped_rate_limited += 1;
      case (#err(#no_funds) or #err(#invalid _)) skipped_other += 1;
      case (#err(#not_registered) or #err(#unknown_topic)) refused := true;
    };
    if (refused) {
      noteError(null, "Sneed Notifications does not accept our messages (not registered, or no `proposals` topic): run admin_register_with_notifications");
      notify_broken := true;
      return false;
    };
    switch last { case (?u) setPass(root, id, kind, #after(u)); case null {} };
    true;
  };

  transient var timer : Timer.TimerId = Timer.recurringTimer<system>(#seconds(config.interval_s), startRound);

  // ---------------------------------------------------------------------------------------------
  // Public reads
  // ---------------------------------------------------------------------------------------------

  public query func get_status() : async Status {
    var open = 0;
    var watches = 0;
    for (s in Map.vals(snses)) { open += s.open.size(); watches += s.watchers.size() };
    {
      paused = config.paused; running = busy() or qpos < queue.size(); users = Map.size(user_watches); watches; snses = Map.size(snses);
      open_proposals = open; rounds = round_no; last_round_start; last_round_end; interval_s = config.interval_s;
      calls_last_round; calls_total; sent; deduplicated; skipped_not_allowed; skipped_rate_limited; skipped_other;
      errors; last_error; notifications = config.notifications; app_id; cycles = Cycles.balance();
    };
  };

  /// The watched SNSes (counts only, never who watches).
  public query func get_snses() : async [SnsInfo] {
    Iter.toArray(Iter.map<WatchedSns, SnsInfo>(Map.vals(snses), func(s) = {
      root = s.root; governance = s.governance; name = s.name; watchers = s.watchers.size(); listed_at = s.listed_at; last_error = s.last_error; errors = s.errors;
      open = Array.map<OpenProposal, { id : Nat64; title : Text; deadline_s : Nat64; new_done : Bool; reminder_done : Bool }>(s.open, func(p) = { id = p.id; title = p.title; deadline_s = p.deadline_s; new_done = p.new_pass == #done; reminder_done = p.reminder_pass == #done });
    }));
  };

  public query func get_config() : async Config { config };
  public query func get_admins() : async [Principal] { admins };

  /// The topics sneed_mon sends under (what admin_register_with_notifications registers).
  public query func get_topics() : async [T.NTopic] { topics() };

  func topics() : [T.NTopic] = [
    { id = TOPIC_PROPOSALS; title = "Proposals to vote on"; level = #normal; description = "A new proposal in an SNS you watch that one of your neurons can vote on, and a reminder about a day before voting closes if it still hasn't voted." },
  ];

  // ---------------------------------------------------------------------------------------------
  // Admin (controllers and the admin list)
  // ---------------------------------------------------------------------------------------------

  public shared ({ caller }) func admin_set_config(c : Config) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (c.interval_s < MIN_INTERVAL_S) return #err("The interval is at least 60 seconds");
    if (c.batch_size == 0 or c.batch_size > 100 or c.max_calls_per_tick == 0) return #err("batch_size 1 to 100, max_calls_per_tick at least 1");
    let reset = c.interval_s != config.interval_s;
    config := c;
    if (reset) resetTimer<system>();
    #ok("Saved");
  };

  func resetTimer<system>() {
    Timer.cancelTimer(timer);
    timer := Timer.recurringTimer<system>(#seconds(config.interval_s), startRound);
  };

  public shared ({ caller }) func admin_set_notifications_canister(p : ?Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    config := { config with notifications = p };
    app_id := null;
    #ok("Saved");
  };

  /// Register sneed_mon with Sneed Notifications as the app "Sneed Hub" (this canister only,
  /// topic `proposals`). Alternatively an admin of Sneed Notifications adds this canister and the
  /// topic to an existing app with update_app; then admin_set_app_id records it here.
  public shared ({ caller }) func admin_register_with_notifications() : async ResultNat {
    if (not isAdmin(caller)) return #err("Admins only");
    let n : T.Notifications = switch (config.notifications) { case (?n) actor (Principal.toText(n)); case null return #err("No notifications canister set") };
    let r = try {
      await n.register_app({
        name = "Sneed Hub";
        logo = ?"https://app.sneeddao.com/sneed_logo.png";
        description = "Sneed Hub (app.sneeddao.com): proposals you can vote on in the SNSes you watch.";
        canisters = [Principal.fromActor(this)];
        topics = topics();
      });
    } catch (e) { return #err("Sneed Notifications did not answer: " # Error.message(e)) };
    switch r { case (#ok(id)) app_id := ?id; case (#err _) {} };
    r;
  };

  public shared ({ caller }) func admin_set_app_id(id : ?Nat) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    app_id := id;
    #ok("Saved");
  };

  public shared ({ caller }) func admin_pause() : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    config := { config with paused = true };
    #ok("Paused");
  };

  public shared ({ caller }) func admin_resume() : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    config := { config with paused = false };
    #ok("Resumed");
  };

  public shared ({ caller }) func admin_set_interval(seconds : Nat) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (seconds < MIN_INTERVAL_S) return #err("The interval is at least 60 seconds");
    config := { config with interval_s = seconds };
    resetTimer<system>();
    #ok("Saved");
  };

  /// Start a round now (or go on with the current one), and wait for its first tick.
  public shared ({ caller }) func admin_run_now() : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (config.paused) return #err("Paused");
    if (busy()) return #err("A tick is running");
    await startRound();
    #ok("Ran");
  };

  public shared ({ caller }) func admin_add_admin(p : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (not has(admins, p)) admins := Array.append(admins, [p]);
    #ok("Added");
  };

  public shared ({ caller }) func admin_remove_admin(p : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    admins := Array.filter<Principal>(admins, func(a) = a != p);
    #ok("Removed");
  };

  // get_api_doc (ICP service discoverability): a short Markdown guide for agents and integrators,
  // with the full reference at https://app.sneeddao.com/api-docs/. A static text: no state read.
  public query func get_api_doc() : async Text { ApiDoc.text };

  // ---------------------------------------------------------------------------------------------
  // Ingress guard (src/IngressGuard.mo)
  // ---------------------------------------------------------------------------------------------

  system func inspect({ caller : Principal; arg : Blob; msg : {
    #get_api_doc : Any;
    #get_status : Any;
    #get_snses : Any;
    #get_config : Any;
    #get_admins : Any;
    #get_topics : Any;
    #get_my_watches : Any;
    #watch_sns : Any;
    #unwatch_sns : Any;
    #admin_set_config : Any;
    #admin_set_notifications_canister : Any;
    #admin_register_with_notifications : Any;
    #admin_set_app_id : Any;
    #admin_pause : Any;
    #admin_resume : Any;
    #admin_set_interval : Any;
    #admin_run_now : Any;
    #admin_add_admin : Any;
    #admin_remove_admin : Any;
  } }) : Bool {
    switch msg {
      case (#get_api_doc _ or #get_status _ or #get_snses _ or #get_config _ or #get_admins _ or #get_topics _ or #get_my_watches _) false;
      case (#watch_sns _ or #unwatch_sns _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#admin_set_config _ or #admin_set_notifications_canister _ or #admin_register_with_notifications _ or #admin_set_app_id _ or #admin_pause _ or #admin_resume _ or #admin_set_interval _ or #admin_run_now _ or #admin_add_admin _ or #admin_remove_admin _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
    };
  };
};
