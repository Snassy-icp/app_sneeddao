import Array "mo:base/Array";
import Debug "mo:base/Debug";
import Principal "mo:base/Principal";
import Time "mo:base/Time";

import IngressGuard "../IngressGuard";
import RateLimit "../RateLimit";
import RateRules "../RateRules";
import ApiDoc "ApiDoc";
import AccountNicknames "../sneed_names/AccountNicknames";
import Nicknames "../sneed_names/Nicknames";
import T "../sneed_names/Types";

/// Each user's private labels for principals (spec/sneed_names.md §6). Unpublished, not secret:
/// only the owner gets them back, but they are not encrypted. No public log.
shared (deployer) persistent actor class SneedPidNicknames() = this {

  public type AvatarRef = T.AvatarRef;
  public type Result = T.Result;
  public type Config = Nicknames.Config;
  public type Nickname = { target : Principal; nickname : Text; avatar : ?AvatarRef; updated_at : Nat64 };
  public type ImportItem = { owner : Principal; target : Principal; nickname : Text };

  var config : Config = Nicknames.defaultConfig();
  var admins : [Principal] = [];

  // per-caller rate limits of writes (src/RateLimit.mo); admins are not limited
  var rate_rules : [(Text, RateLimit.Rule)] = []; // admin overrides of RATE_DEFAULTS
  transient let limiter = RateLimit.Limiter();
  transient let RATE_DEFAULTS : RateRules.Rules = [
    ("nickname", { capacity = 120; per_minute = 60 }), // set_nickname, set_nickname_avatar, set_account_nickname,
    ("pocket", { capacity = 120; per_minute = 60 }), // set_pocket, set_pockets
  ];
  transient let RATE_LIMITED = "Rate limited: too many changes in a short time, please try again in a minute";
  var import_closed : Bool = false;
  let state : Nicknames.State = Nicknames.init();

  // Account nicknames and the pocket registry (spec/programmable_accounts.md §4.6): added
  // 2026-10-22 next to the principal nicknames above, which they never touch.
  var account_limits : AccountNicknames.Limits = AccountNicknames.defaultLimits();
  let account_state : AccountNicknames.State = AccountNicknames.init();

  func isAdmin(p : Principal) : Bool = Principal.isController(p) or Array.find<Principal>(admins, func(a) = a == p) != null;

  func rateRule(action : Text) : RateLimit.Rule = RateRules.rule(rate_rules, RATE_DEFAULTS, action);
  /// Takes one call of `action` from the caller's bucket; true when the caller is over the limit.
  func limited(caller : Principal, action : Text) : Bool = not isAdmin(caller) and not limiter.take(caller, action, rateRule(action), Time.now());
  func view((b, n) : (Blob, Nicknames.Nick)) : Nickname = { target = Principal.fromBlob(b); nickname = n.nickname; avatar = n.avatar; updated_at = n.updated_at };

  /// Your nicknames, a page at a time (500 a page: usually all of them in one call).
  public query ({ caller }) func get_my_nicknames(page : T.Page<Principal>) : async { items : [Nickname]; next : ?Principal } {
    let r = Nicknames.list(state, caller, switch (page.start_after) { case (?p) ?Principal.toBlob(p); case null null }, page.limit);
    { items = Array.map(r.items, view); next = switch (r.next) { case (?b) ?Principal.fromBlob(b); case null null } };
  };

  /// Your nicknames for these principals (up to 500), in order.
  public query ({ caller }) func get_my_nicknames_for(targets : [Principal]) : async [?Nickname] {
    if (targets.size() > Nicknames.MAX_BATCH) Debug.trap("At most 500 principals per call");
    Array.map<Principal, ?Nickname>(targets, func(t) = switch (Nicknames.get(state, caller, Principal.toBlob(t))) {
      case (?n) ?view((Principal.toBlob(t), n));
      case null null;
    });
  };

  /// Your nicknames whose text, or a word in it, starts with `prefix`.
  public query ({ caller }) func search_my_nicknames(prefix : Text, limit : Nat) : async [Nickname] {
    Array.map(Nicknames.search(state, caller, prefix, limit), view);
  };

  public query ({ caller }) func my_nickname_count() : async { count : Nat; max_free : Nat; max_premium : Nat } {
    { count = Nicknames.count(state, caller); max_free = config.max_free; max_premium = config.max_premium };
  };

  /// Set your nickname for a principal ("" removes it).
  public shared ({ caller }) func set_nickname(target : Principal, nickname : Text) : async Result {
    if (limited(caller, "nickname")) return #err(RATE_LIMITED);
    await* Nicknames.set(state, config, caller, Principal.toBlob(target), nickname);
  };

  public shared ({ caller }) func set_nickname_avatar(target : Principal, avatar : ?AvatarRef) : async Result {
    if (limited(caller, "nickname")) return #err(RATE_LIMITED);
    Nicknames.setAvatar(state, caller, Principal.toBlob(target), avatar);
  };

  // ---- account nicknames and pockets (spec/programmable_accounts.md §4.6) ----

  public type Account = AccountNicknames.Account;
  public type PocketMeta = AccountNicknames.PocketMeta;
  public type AccountNickname = AccountNicknames.AccountNickname;
  public type AccountLimits = AccountNicknames.Limits;

  /// Your account names and pockets, a page at a time (up to 500 a page). The zero subaccount
  /// comes back as null: `null` and 32 zero bytes are the same account.
  public query ({ caller }) func get_my_account_nicknames(page : T.Page<Account>) : async { items : [AccountNickname]; next : ?Account } {
    AccountNicknames.list(account_state, caller, page.start_after, page.limit);
  };

  /// Your entries for these accounts (up to 100), in order.
  public query ({ caller }) func get_my_account_nicknames_for(accounts : [Account]) : async [?AccountNickname] {
    if (accounts.size() > AccountNicknames.MAX_FOR) Debug.trap("At most 100 accounts per call");
    AccountNicknames.getMany(account_state, caller, accounts);
  };

  /// Set your name for an account ("" clears the name and keeps the pocket meta).
  public shared ({ caller }) func set_account_nickname(account : Account, nickname : Text) : async Result {
    if (limited(caller, "nickname")) return #err(RATE_LIMITED);
    await* AccountNicknames.setNickname(account_state, config, account_limits, caller, account, nickname);
  };

  /// Remember or update one of your pockets (Some), or forget it (None; keeps its name).
  public shared ({ caller }) func set_pocket(account : Account, pocket : ?PocketMeta) : async Result {
    if (limited(caller, "pocket")) return #err(RATE_LIMITED);
    await* AccountNicknames.setPocket(account_state, config, account_limits, caller, account, pocket);
  };

  /// Several set_pocket calls in one (up to 50).
  public shared ({ caller }) func set_pockets(items : [(Account, ?PocketMeta)]) : async [Result] {
    if (limited(caller, "pocket")) return Array.map<(Account, ?PocketMeta), Result>(items, func(_) = #err(RATE_LIMITED));
    if (items.size() > AccountNicknames.MAX_BATCH) Debug.trap("At most 50 pockets per call");
    await* AccountNicknames.setPockets(account_state, config, account_limits, caller, items);
  };

  public query ({ caller }) func my_account_nickname_count() : async { count : Nat; max_free : Nat; max_premium : Nat } {
    { count = AccountNicknames.count(account_state, caller); max_free = account_limits.account_max_free; max_premium = account_limits.account_max_premium };
  };

  public query func get_account_limits() : async AccountLimits { account_limits };

  public query func account_stats() : async { entries : Nat; owners : Nat; accounts : Nat } {
    AccountNicknames.stats(account_state);
  };

  public query func stats() : async { nicknames : Nat; owners : Nat; targets : Nat; import_closed : Bool } {
    let s = Nicknames.stats(state);
    { s with import_closed };
  };

  // ---- administration ----

  public query func get_config() : async Config { config };
  public query func get_admins() : async [Principal] { admins };

  public shared ({ caller }) func admin_set_config(c : Config) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (c.max_free > c.max_premium or c.max_premium > 10_000) return #err("Need max_free <= max_premium <= 10000");
    config := c;
    #ok("Config updated");
  };

  public shared ({ caller }) func admin_set_account_limits(l : AccountLimits) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (l.account_max_free > l.account_max_premium or l.account_max_premium > AccountNicknames.MAX_LIMIT) return #err("Need account_max_free <= account_max_premium <= 10000");
    account_limits := l;
    #ok("Account limits updated");
  };

  /// The per-caller rate limits of writes: action -> { capacity (calls at once); per_minute (refill) }.
  /// Actions: nickname, pocket. Admins are not limited.
  public query func get_rate_limits() : async [(Text, RateLimit.Rule)] { RateRules.all(rate_rules, RATE_DEFAULTS) };

  /// Set an action's rate limit (null: back to the default; capacity 0: no limit).
  public shared ({ caller }) func admin_set_rate_limit(action : Text, rule : ?RateLimit.Rule) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (RateRules.set(rate_rules, RATE_DEFAULTS, action, rule)) {
      case (#err(e)) #err(e);
      case (#ok(r)) {
        rate_rules := r;
        #ok("Rate limit updated");
      };
    };
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

  /// One-time import from the backend (spec §10).
  public shared ({ caller }) func admin_import_nicknames(items : [ImportItem]) : async [Result] {
    if (not isAdmin(caller)) Debug.trap("Admins only");
    if (import_closed) Debug.trap("Import is closed");
    if (items.size() > Nicknames.MAX_BATCH) Debug.trap("At most 500 items per call");
    Array.map<ImportItem, Result>(items, func(it) = Nicknames.importOne(state, it.owner, Principal.toBlob(it.target), it.nickname));
  };

  public shared ({ caller }) func admin_finish_import() : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    import_closed := true;
    #ok("Import closed");
  };

  // get_api_doc (ICP service discoverability): a short Markdown guide for agents and integrators,
  // with the full reference at https://app.sneeddao.com/api-docs/. A static text: no state read.
  public query func get_api_doc() : async Text { ApiDoc.text };

  // ---------------------------------------------------------------------------------------------
  // Ingress guard (src/IngressGuard.mo)
  // ---------------------------------------------------------------------------------------------

  system func inspect({ caller : Principal; arg : Blob; msg : {
    #get_api_doc : Any;
    #get_rate_limits : Any;
    #admin_set_rate_limit : Any;
    #account_stats : Any;
    #admin_add_admin : Any;
    #admin_finish_import : Any;
    #admin_import_nicknames : Any;
    #admin_remove_admin : Any;
    #admin_set_account_limits : Any;
    #admin_set_config : Any;
    #get_account_limits : Any;
    #get_admins : Any;
    #get_config : Any;
    #get_my_account_nicknames : Any;
    #get_my_account_nicknames_for : Any;
    #get_my_nicknames : Any;
    #get_my_nicknames_for : Any;
    #my_account_nickname_count : Any;
    #my_nickname_count : Any;
    #search_my_nicknames : Any;
    #set_account_nickname : Any;
    #set_nickname : Any;
    #set_nickname_avatar : Any;
    #set_pocket : Any;
    #set_pockets : Any;
    #stats : Any;
  } }) : Bool {
    // rate limits: peek at the caller's bucket (the method takes from it)
    let rateAction : ?Text = switch msg {
      case (#set_nickname _ or #set_nickname_avatar _ or #set_account_nickname _) ?"nickname";
      case (#set_pocket _ or #set_pockets _) ?"pocket";
      case _ null;
    };
    switch rateAction {
      case (?a) if (not isAdmin(caller) and not limiter.allows(caller, a, rateRule(a), Time.now())) return false;
      case null {};
    };
    switch msg {
      // queries are free as queries; as updates the canister would pay for consensus
      case (#get_api_doc _ or #get_rate_limits _ or #get_admins _ or #get_config _ or #get_my_nicknames _ or #get_my_nicknames_for _ or #my_nickname_count _ or #search_my_nicknames _ or #stats _) false;
      case (#account_stats _ or #get_account_limits _ or #get_my_account_nicknames _ or #get_my_account_nicknames_for _ or #my_account_nickname_count _) false;
      case (#admin_import_nicknames _) isAdmin(caller) and arg.size() <= 2_000_000;
      case (#admin_set_config _) isAdmin(caller) and arg.size() <= IngressGuard.textArg(1_000);
      case (#admin_add_admin _ or #admin_set_rate_limit _ or #admin_finish_import _ or #admin_remove_admin _ or #admin_set_account_limits _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#set_pockets _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.MEDIUM_ARG;
      case (#set_nickname_avatar _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.textArg(T.MAX_URL_LENGTH);
      case _ not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.SMALL_ARG;
    };
  };
};
