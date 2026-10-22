import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import OrderedMap "mo:base/OrderedMap";
import Principal "mo:base/Principal";
import Time "mo:base/Time";
import Dedup "mo:dedup";
import Map "mo:map/Map";

import PremiumClient "../PremiumClient";
import Moderation "Moderation";
import NameIndex "NameIndex";
import NameRules "NameRules";
import Nicknames "Nicknames";
import T "Types";

/// Each user's private labels for ICRC-1 accounts, and the pocket registry of Sneed Hub's wallet
/// (spec/programmable_accounts.md §4.6, §4.7). An entry is "my label for this account" (the
/// nickname) and, when it is one of my pockets, "and it's mine" (the pocket meta). Unpublished,
/// not secret, like principal nicknames; no public log.
///
/// Storage as for principal nicknames (Nicknames.mo), but apart from them: owners and accounts
/// are deduplicated to Nat32 in their own tables, and an entry is one value of one sorted map
/// keyed owner << 32 | account, so one owner's entries are a contiguous range. The account key is
/// canonical: [owner length][owner bytes][32-byte subaccount], with `null` stored as 32 zero
/// bytes, so `null` and the zero subaccount are the same account.
module {
  public type Account = { owner : Principal; subaccount : ?Blob };

  public type PocketMeta = {
    host : ?Text; // adapter id for hosted pockets; null = wallet pocket
    ledgers : [Principal]; // where it was seen or used, at most MAX_LEDGERS
    hidden : Bool;
    created_at : Nat64;
  };

  public type Entry = { nickname : Text; pocket : ?PocketMeta; updated_at : Nat64 };

  public type AccountNickname = { account : Account; nickname : Text; pocket : ?PocketMeta; updated_at : Nat64 };

  /// Entries per user (nicknamed accounts and pockets together), counted apart from principal nicknames.
  public type Limits = { account_max_free : Nat; account_max_premium : Nat };

  public func defaultLimits() : Limits = { account_max_free = 100; account_max_premium = 1_000 };

  public type State = {
    owners : Dedup.DedupState;
    accounts : Dedup.DedupState;
    var entries : OrderedMap.Map<Nat64, Entry>;
    counts : Map.Map<Nat32, Nat>;
    premium_cache : PremiumClient.PremiumCache;
  };

  public func init() : State = {
    owners = Dedup.empty();
    accounts = Dedup.empty();
    var entries = ops().empty<Entry>();
    counts = Map.new<Nat32, Nat>();
    premium_cache = PremiumClient.emptyCache();
  };

  public let MAX_PAGE : Nat = 500;
  public let MAX_FOR : Nat = 100;
  public let MAX_BATCH : Nat = 50;
  public let MAX_LEDGERS : Nat = 20;
  public let MAX_HOST_LENGTH : Nat = 32;
  public let MAX_LIMIT : Nat = 10_000;

  func ops() : OrderedMap.Operations<Nat64> = OrderedMap.Make<Nat64>(Nat64.compare);
  func keyOf(o : Nat32, a : Nat32) : Nat64 = Nat64.fromNat(Nat32.toNat(o)) << 32 | Nat64.fromNat(Nat32.toNat(a));
  func accountOf(k : Nat64) : Nat32 = Nat32.fromNat(Nat64.toNat(k & 0xffff_ffff));
  func ownerOf(k : Nat64) : Nat32 = Nat32.fromNat(Nat64.toNat(k >> 32));
  func now64() : Nat64 = Nat64.fromNat(Int.abs(Time.now()));

  // ---- the canonical account key ----

  /// The canonical bytes of an account; null when the subaccount is not exactly 32 bytes.
  public func accountKey(a : Account) : ?Blob {
    let owner = Blob.toArray(Principal.toBlob(a.owner));
    let sub : [Nat8] = switch (a.subaccount) {
      case null Array.tabulate<Nat8>(32, func(_) = 0);
      case (?s) { if (s.size() != 32) return null; Blob.toArray(s) };
    };
    let out = Buffer.Buffer<Nat8>(1 + owner.size() + 32);
    out.add(Nat8.fromNat(owner.size()));
    for (b in owner.vals()) out.add(b);
    for (b in sub.vals()) out.add(b);
    ?Blob.fromArray(Buffer.toArray(out));
  };

  /// The account of a canonical key; the zero subaccount comes back as null.
  public func accountOfKey(k : Blob) : Account {
    let bytes = Blob.toArray(k);
    let n = Nat8.toNat(bytes[0]);
    let owner = Principal.fromBlob(Blob.fromArray(Array.subArray(bytes, 1, n)));
    let sub = Array.subArray(bytes, 1 + n, 32);
    let zero = Array.foldLeft<Nat8, Bool>(sub, true, func(acc, b) = acc and b == 0);
    { owner; subaccount = if (zero) null else ?Blob.fromArray(sub) };
  };

  func view(k : Blob, e : Entry) : AccountNickname = { account = accountOfKey(k); nickname = e.nickname; pocket = e.pocket; updated_at = e.updated_at };

  // ---- reads ----

  public func count(s : State, owner : Principal) : Nat = switch (Dedup.getIndexForPrincipal(s.owners, owner)) {
    case (?o) switch (Map.get(s.counts, Map.n32hash, o)) { case (?n) n; case null 0 };
    case null 0;
  };

  func getByKey(s : State, owner : Principal, key : Blob) : ?Entry {
    switch (Dedup.getIndexForPrincipal(s.owners, owner), Dedup.getIndex(s.accounts, key)) {
      case (?o, ?a) ops().get(s.entries, keyOf(o, a));
      case _ null;
    };
  };

  public func get(s : State, owner : Principal, a : Account) : ?AccountNickname {
    switch (accountKey(a)) {
      case (?k) switch (getByKey(s, owner, k)) { case (?e) ?view(k, e); case null null };
      case null null;
    };
  };

  /// The owner's entries for these accounts, in order (null for none or a malformed account).
  public func getMany(s : State, owner : Principal, accounts : [Account]) : [?AccountNickname] {
    Array.map<Account, ?AccountNickname>(accounts, func(a) = get(s, owner, a));
  };

  /// The owner's entries, a page at a time (in the order the accounts were first recorded by anyone).
  public func list(s : State, owner : Principal, startAfter : ?Account, limit : Nat) : { items : [AccountNickname]; next : ?Account } {
    let max = Nat.min(limit, MAX_PAGE);
    let out = Buffer.Buffer<AccountNickname>(Nat.min(max, 64));
    let o = switch (Dedup.getIndexForPrincipal(s.owners, owner)) { case (?o) o; case null return { items = []; next = null } };
    let from : Nat64 = switch startAfter {
      case (?a) switch (accountKey(a)) {
        case (?k) switch (Dedup.getIndex(s.accounts, k)) { case (?i) keyOf(o, i) + 1; case null keyOf(o, 0) };
        case null keyOf(o, 0);
      };
      case null keyOf(o, 0);
    };
    var last : ?Account = null;
    label walk for ((k, e) in NameIndex.entriesFrom<Nat64, Entry>(s.entries, Nat64.compare, from)) {
      if (ownerOf(k) != o) break walk;
      if (out.size() >= max) return { items = Buffer.toArray(out); next = last };
      switch (Dedup.getBlob(s.accounts, accountOf(k))) {
        case (?b) { let v = view(b, e); out.add(v); last := ?v.account };
        case null {};
      };
    };
    { items = Buffer.toArray(out); next = null };
  };

  public func stats(s : State) : { entries : Nat; owners : Nat; accounts : Nat } = {
    entries = ops().size(s.entries);
    owners = Map.size(s.counts);
    accounts = Map.size(s.accounts.blobToIndex);
  };

  // ---- validation ----

  func hostProblem(h : Text) : ?Text {
    if (h.size() == 0 or h.size() > MAX_HOST_LENGTH) return ?"A pocket host is 1-32 characters";
    for (c in h.chars()) {
      if (not ((c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '_' or c == '-')) return ?"A pocket host is an adapter id: a-z, 0-9, '_' and '-'";
    };
    null;
  };

  /// Why pocket meta is refused; null when it is fine.
  public func metaProblem(m : PocketMeta) : ?Text {
    switch (m.host) { case (?h) switch (hostProblem(h)) { case (?p) return ?p; case null {} }; case null {} };
    if (m.ledgers.size() > MAX_LEDGERS) return ?("At most " # Nat.toText(MAX_LEDGERS) # " ledgers per pocket");
    null;
  };

  func dedupeLedgers(ls : [Principal]) : [Principal] {
    let out = Buffer.Buffer<Principal>(ls.size());
    for (l in ls.vals()) if (Buffer.indexOf<Principal>(l, out, Principal.equal) == null) out.add(l);
    Buffer.toArray(out);
  };

  // ---- writes ----

  func put(s : State, owner : Principal, key : Blob, e : Entry) {
    let o = Dedup.getOrCreateIndexForPrincipal(s.owners, owner);
    let a = Dedup.getOrCreateIndex(s.accounts, key);
    let (m, old) = ops().replace(s.entries, keyOf(o, a), e);
    s.entries := m;
    if (old == null) Map.set(s.counts, Map.n32hash, o, (switch (Map.get(s.counts, Map.n32hash, o)) { case (?c) c; case null 0 }) + 1);
  };

  func remove(s : State, owner : Principal, key : Blob) {
    switch (Dedup.getIndexForPrincipal(s.owners, owner), Dedup.getIndex(s.accounts, key)) {
      case (?o, ?a) {
        let (m, old) = ops().remove(s.entries, keyOf(o, a));
        s.entries := m;
        if (old == null) return;
        let c = switch (Map.get(s.counts, Map.n32hash, o)) { case (?c) c; case null 1 };
        if (c <= 1) Map.delete(s.counts, Map.n32hash, o) else Map.set(s.counts, Map.n32hash, o, c - 1 : Nat);
      };
      case _ {};
    };
  };

  /// Store `e`, or delete the entry when it has neither a nickname nor pocket meta.
  func store(s : State, owner : Principal, key : Blob, e : Entry) {
    if (e.nickname == "" and e.pocket == null) remove(s, owner, key) else put(s, owner, key, e);
  };

  func fullText(max : Nat) : Text = "You have reached the maximum number of account names and pockets (" # Nat.toText(max) # ")";

  func isPremium(s : State, cfg : Nicknames.Config, user : Principal) : async* Bool {
    switch (cfg.premium) {
      case (?id) try { await* PremiumClient.isPremium(s.premium_cache, id, user) } catch (_) { false };
      case null false;
    };
  };

  /// Room for `adding` new entries: null when there is, else why not (asks the premium canister
  /// only when the free limit is in the way).
  func roomProblem(s : State, cfg : Nicknames.Config, lim : Limits, caller : Principal, adding : Nat) : async* ?Text {
    if (adding == 0) return null;
    let n = count(s, caller);
    if (n + adding > lim.account_max_premium) return ?fullText(lim.account_max_premium);
    if (n + adding > lim.account_max_free and not (await* isPremium(s, cfg, caller))) {
      return ?(fullText(lim.account_max_free) # ". Get Sneed Premium for more!");
    };
    null;
  };

  /// Set (or with "" clear) the caller's name for an account. Clearing keeps the pocket meta.
  public func setNickname(s : State, cfg : Nicknames.Config, lim : Limits, caller : Principal, a : Account, nickname : Text) : async* T.Result {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    let key = switch (accountKey(a)) { case (?k) k; case null return #err("A subaccount is exactly 32 bytes") };
    if (nickname == "") {
      return switch (getByKey(s, caller, key)) {
        case (?e) {
          if (e.nickname == "") return #ok("Unchanged");
          store(s, caller, key, { e with nickname = ""; updated_at = now64() });
          #ok("Name removed");
        };
        case null #ok("Unchanged");
      };
    };
    switch (NameRules.problem(nickname, 1)) { case (?p) return #err(p); case null {} };
    let isNew = func() : Bool = getByKey(s, caller, key) == null;
    if (isNew()) switch (await* roomProblem(s, cfg, lim, caller, 1)) { case (?p) return #err(p); case null {} };
    // the word blacklist and bans, as for principal nicknames (not public: no auto-ban)
    switch (await* Moderation.check(cfg.moderator, caller, nickname, false)) { case (#err(e)) return #err(e); case (#ok) {} };
    // re-check after the calls (another entry may have been added meanwhile)
    if (isNew() and count(s, caller) >= lim.account_max_premium) return #err(fullText(lim.account_max_premium));
    let pocket = switch (getByKey(s, caller, key)) { case (?e) e.pocket; case null null };
    put(s, caller, key, { nickname; pocket; updated_at = now64() });
    #ok("Name set");
  };

  /// The meta as stored: ledgers deduplicated, created_at kept from an earlier record (or now when 0).
  func stored(old : ?Entry, m : PocketMeta) : PocketMeta {
    let created_at = switch (old) {
      case (?{ pocket = ?p }) p.created_at;
      case _ if (m.created_at == 0) now64() else m.created_at;
    };
    { m with ledgers = dedupeLedgers(m.ledgers); created_at };
  };

  /// Remember, update (Some) or forget (None) one of the caller's pockets; forgetting keeps the name.
  public func setPocket(s : State, cfg : Nicknames.Config, lim : Limits, caller : Principal, a : Account, meta : ?PocketMeta) : async* T.Result {
    let r = await* setPockets(s, cfg, lim, caller, [(a, meta)]);
    r[0];
  };

  /// Several setPocket calls in one (at most MAX_BATCH; the caller traps above that). One
  /// moderation and one premium check for the whole batch.
  public func setPockets(s : State, cfg : Nicknames.Config, lim : Limits, caller : Principal, items : [(Account, ?PocketMeta)]) : async* [T.Result] {
    if (Principal.isAnonymous(caller)) return Array.map<(Account, ?PocketMeta), T.Result>(items, func(_) = #err("Please sign in"));
    // validate first, so a bad item costs no inter-canister call
    let checked = Array.map<(Account, ?PocketMeta), { #bad : Text; #ok : (Blob, ?PocketMeta) }>(items, func((a, m)) {
      switch (accountKey(a)) {
        case null #bad("A subaccount is exactly 32 bytes");
        case (?k) switch m {
          case (?meta) switch (metaProblem(meta)) { case (?p) #bad(p); case null #ok((k, m)) };
          case null #ok((k, null));
        };
      };
    });
    var writes = 0;
    var adding = 0;
    for (c in checked.vals()) switch c {
      case (#ok((k, ?_))) { writes += 1; if (getByKey(s, caller, k) == null) adding += 1 };
      case _ {};
    };
    var refused : ?Text = null;
    if (writes > 0) {
      refused := await* roomProblem(s, cfg, lim, caller, adding);
      if (refused == null) {
        // bans (an empty text passes the word blacklist)
        switch (await* Moderation.check(cfg.moderator, caller, "", false)) { case (#err(e)) refused := ?e; case (#ok) {} };
      };
    };
    let now = now64();
    Array.map<{ #bad : Text; #ok : (Blob, ?PocketMeta) }, T.Result>(checked, func(c) {
      switch c {
        case (#bad(p)) #err(p);
        case (#ok((k, null))) switch (getByKey(s, caller, k)) {
          case (?e) {
            if (e.pocket == null) return #ok("Unchanged");
            store(s, caller, k, { e with pocket = null; updated_at = now });
            #ok("Pocket forgotten");
          };
          case null #ok("Unchanged");
        };
        case (#ok((k, ?m))) {
          switch refused { case (?p) return #err(p); case null {} };
          let old = getByKey(s, caller, k);
          // re-check per item after the awaits: the batch may fill the last places
          if (old == null and count(s, caller) >= lim.account_max_premium) return #err(fullText(lim.account_max_premium));
          let nickname = switch old { case (?e) e.nickname; case null "" };
          put(s, caller, k, { nickname; pocket = ?stored(old, m); updated_at = now });
          #ok(if (old == null) "Pocket remembered" else "Pocket updated");
        };
      };
    });
  };
};
