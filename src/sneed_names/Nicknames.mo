import Buffer "mo:base/Buffer";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import OrderedMap "mo:base/OrderedMap";
import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Dedup "mo:dedup";
import Map "mo:map/Map";

import PremiumClient "../PremiumClient";
import NameIndex "NameIndex";
import NameRules "NameRules";
import Moderation "Moderation";
import T "Types";

/// Each user's private labels for others (spec/sneed_names.md §6), shared by sneed_pid_nicknames
/// (targets are principals) and sneed_neuron_nicknames (targets are SNS neurons). The canisters
/// encode their targets as blobs and keep only thin public wrappers.
///
/// Owners and targets are deduplicated to Nat32 (mo:dedup); a nickname is one entry of one sorted
/// map keyed by owner << 32 | target, so one owner's nicknames are a contiguous range.
module {
  public type Nick = { nickname : Text; avatar : ?T.AvatarRef; updated_at : Nat64 };

  public type Config = {
    max_free : Nat; // nicknames per user
    max_premium : Nat; // with Sneed Premium
    moderator : ?Principal; // backend: the word blacklist (no bans for nicknames)
    premium : ?Principal; // sneed_premium
  };

  public func defaultConfig() : Config = { max_free = 10; max_premium = 100; moderator = null; premium = null };

  public type State = {
    owners : Dedup.DedupState;
    targets : Dedup.DedupState;
    var entries : OrderedMap.Map<Nat64, Nick>;
    counts : Map.Map<Nat32, Nat>;
    premium_cache : PremiumClient.PremiumCache;
  };

  public func init() : State = {
    owners = Dedup.empty();
    targets = Dedup.empty();
    var entries = ops().empty<Nick>();
    counts = Map.new<Nat32, Nat>();
    premium_cache = PremiumClient.emptyCache();
  };

  public let MAX_PAGE : Nat = 500;
  public let MAX_BATCH : Nat = 500;

  func ops() : OrderedMap.Operations<Nat64> = OrderedMap.Make<Nat64>(Nat64.compare);
  func keyOf(o : Nat32, t : Nat32) : Nat64 = Nat64.fromNat(Nat32.toNat(o)) << 32 | Nat64.fromNat(Nat32.toNat(t));
  func targetOf(k : Nat64) : Nat32 = Nat32.fromNat(Nat64.toNat(k & 0xffff_ffff));
  func ownerOf(k : Nat64) : Nat32 = Nat32.fromNat(Nat64.toNat(k >> 32));
  func now64() : Nat64 = Nat64.fromNat(Int.abs(Time.now()));

  func ownerIndex(s : State, p : Principal) : ?Nat32 = Dedup.getIndexForPrincipal(s.owners, p);

  public func count(s : State, owner : Principal) : Nat = switch (ownerIndex(s, owner)) {
    case (?o) switch (Map.get(s.counts, Map.n32hash, o)) { case (?n) n; case null 0 };
    case null 0;
  };

  public func get(s : State, owner : Principal, target : Blob) : ?Nick {
    switch (ownerIndex(s, owner), Dedup.getIndex(s.targets, target)) {
      case (?o, ?t) ops().get(s.entries, keyOf(o, t));
      case _ null;
    };
  };

  /// The owner's nicknames for these targets, in order.
  public func getMany(s : State, owner : Principal, targets : [Blob]) : [?Nick] {
    if (targets.size() > MAX_BATCH) return [];
    let out = Buffer.Buffer<?Nick>(targets.size());
    for (t in targets.vals()) out.add(get(s, owner, t));
    Buffer.toArray(out);
  };

  /// The owner's nicknames, a page at a time (in the order targets were first nicknamed by anyone).
  public func list(s : State, owner : Principal, startAfter : ?Blob, limit : Nat) : { items : [(Blob, Nick)]; next : ?Blob } {
    let max = Nat.min(limit, MAX_PAGE);
    let out = Buffer.Buffer<(Blob, Nick)>(max);
    let o = switch (ownerIndex(s, owner)) { case (?o) o; case null return { items = []; next = null } };
    let from : Nat64 = switch startAfter {
      case (?b) switch (Dedup.getIndex(s.targets, b)) { case (?t) keyOf(o, t) + 1; case null keyOf(o, 0) };
      case null keyOf(o, 0);
    };
    var last : ?Blob = null;
    label walk for ((k, n) in NameIndex.entriesFrom<Nat64, Nick>(s.entries, Nat64.compare, from)) {
      if (ownerOf(k) != o) break walk;
      if (out.size() >= max) return { items = Buffer.toArray(out); next = last };
      switch (Dedup.getBlob(s.targets, targetOf(k))) {
        case (?b) { out.add((b, n)); last := ?b };
        case null {};
      };
    };
    { items = Buffer.toArray(out); next = null };
  };

  /// The owner's nicknames whose text, or a word in it, starts with `prefix` (a scan of the
  /// owner's own range, which the nickname limits bound).
  public func search(s : State, owner : Principal, prefix : Text, limit : Nat) : [(Blob, Nick)] {
    let p = NameRules.normalizePrefix(prefix);
    let max = Nat.min(limit, 50);
    let out = Buffer.Buffer<(Blob, Nick)>(max);
    if (p == "") return [];
    let o = switch (ownerIndex(s, owner)) { case (?o) o; case null return [] };
    label walk for ((k, n) in NameIndex.entriesFrom<Nat64, Nick>(s.entries, Nat64.compare, keyOf(o, 0))) {
      if (ownerOf(k) != o or out.size() >= max) break walk;
      let norm = NameRules.normalize(n.nickname);
      var hit = false;
      for (suffix in NameRules.wordSuffixes(norm).vals()) if (NameRules.startsWith(suffix, p)) hit := true;
      if (hit) switch (Dedup.getBlob(s.targets, targetOf(k))) { case (?b) out.add((b, n)); case null {} };
    };
    Buffer.toArray(out);
  };

  func put(s : State, owner : Principal, target : Blob, n : Nick) {
    let o = Dedup.getOrCreateIndexForPrincipal(s.owners, owner);
    let t = Dedup.getOrCreateIndex(s.targets, target);
    let k = keyOf(o, t);
    let (m, old) = ops().replace(s.entries, k, n);
    s.entries := m;
    if (old == null) Map.set(s.counts, Map.n32hash, o, (switch (Map.get(s.counts, Map.n32hash, o)) { case (?c) c; case null 0 }) + 1);
  };

  func remove(s : State, owner : Principal, target : Blob) : Bool {
    switch (ownerIndex(s, owner), Dedup.getIndex(s.targets, target)) {
      case (?o, ?t) {
        let (m, old) = ops().remove(s.entries, keyOf(o, t));
        s.entries := m;
        if (old == null) return false;
        let c = switch (Map.get(s.counts, Map.n32hash, o)) { case (?c) c; case null 1 };
        if (c <= 1) Map.delete(s.counts, Map.n32hash, o) else Map.set(s.counts, Map.n32hash, o, c - 1 : Nat);
        true;
      };
      case _ false;
    };
  };

  func isPremium(s : State, cfg : Config, user : Principal) : async* Bool {
    switch (cfg.premium) {
      case (?id) try { await* PremiumClient.isPremium(s.premium_cache, id, user) } catch (_) { false };
      case null false;
    };
  };

  /// Set (or with "" remove) the caller's nickname for a target, keeping its avatar.
  public func set(s : State, cfg : Config, caller : Principal, target : Blob, nickname : Text) : async* T.Result {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    if (nickname == "") {
      return if (remove(s, caller, target)) #ok("Nickname removed") else #ok("Unchanged");
    };
    switch (NameRules.problem(nickname, 1)) { case (?p) return #err(p); case null {} };
    let isNew = func() : Bool = get(s, caller, target) == null;
    if (isNew() and count(s, caller) >= cfg.max_free) {
      if (count(s, caller) >= cfg.max_premium or not (await* isPremium(s, cfg, caller))) {
        return #err(if (count(s, caller) >= cfg.max_premium) "You have reached the maximum number of nicknames (" # Nat.toText(cfg.max_premium) # ")" else "You have reached the maximum number of nicknames (" # Nat.toText(cfg.max_free) # "). Get Sneed Premium for more!");
      };
    };
    switch (await* Moderation.check(cfg.moderator, caller, nickname, false)) { case (#err(e)) return #err(e); case (#ok) {} };
    // re-check the limit after the calls (another nickname may have been added meanwhile)
    if (isNew() and count(s, caller) >= cfg.max_premium) return #err("You have reached the maximum number of nicknames (" # Nat.toText(cfg.max_premium) # ")");
    let avatar = switch (get(s, caller, target)) { case (?n) n.avatar; case null null };
    put(s, caller, target, { nickname; avatar; updated_at = now64() });
    #ok("Nickname set");
  };

  /// Set or clear the avatar of one of the caller's nicknames.
  public func setAvatar(s : State, caller : Principal, target : Blob, avatar : ?T.AvatarRef) : T.Result {
    switch avatar { case (?x) switch (T.avatarProblem(x)) { case (?p) return #err(p); case null {} }; case null {} };
    switch (get(s, caller, target)) {
      case (?n) {
        put(s, caller, target, { n with avatar; updated_at = now64() });
        #ok(if (avatar == null) "Avatar cleared" else "Avatar set");
      };
      case null #err("Set a nickname first");
    };
  };

  /// One-time import (no limits, no moderation: the backend checked them).
  public func importOne(s : State, owner : Principal, target : Blob, nickname : Text) : T.Result {
    switch (NameRules.problem(nickname, 1)) { case (?p) return #err(p); case null {} };
    if (get(s, owner, target) != null) return #err("already imported");
    put(s, owner, target, { nickname; avatar = null; updated_at = now64() });
    #ok("imported");
  };

  public func stats(s : State) : { nicknames : Nat; owners : Nat; targets : Nat } = {
    nicknames = ops().size(s.entries);
    owners = Map.size(s.counts);
    targets = Map.size(s.targets.blobToIndex);
  };
};
