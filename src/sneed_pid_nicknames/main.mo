import Array "mo:base/Array";
import Debug "mo:base/Debug";
import Principal "mo:base/Principal";

import IngressGuard "../IngressGuard";
import ApiDoc "ApiDoc";
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
  var import_closed : Bool = false;
  let state : Nicknames.State = Nicknames.init();

  func isAdmin(p : Principal) : Bool = Principal.isController(p) or Array.find<Principal>(admins, func(a) = a == p) != null;
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
    await* Nicknames.set(state, config, caller, Principal.toBlob(target), nickname);
  };

  public shared ({ caller }) func set_nickname_avatar(target : Principal, avatar : ?AvatarRef) : async Result {
    Nicknames.setAvatar(state, caller, Principal.toBlob(target), avatar);
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
    #admin_add_admin : Any;
    #admin_finish_import : Any;
    #admin_import_nicknames : Any;
    #admin_remove_admin : Any;
    #admin_set_config : Any;
    #get_admins : Any;
    #get_config : Any;
    #get_my_nicknames : Any;
    #get_my_nicknames_for : Any;
    #my_nickname_count : Any;
    #search_my_nicknames : Any;
    #set_nickname : Any;
    #set_nickname_avatar : Any;
    #stats : Any;
  } }) : Bool {
    switch msg {
      // queries are free as queries; as updates the canister would pay for consensus
      case (#get_api_doc _ or #get_admins _ or #get_config _ or #get_my_nicknames _ or #get_my_nicknames_for _ or #my_nickname_count _ or #search_my_nicknames _ or #stats _) false;
      case (#admin_import_nicknames _) isAdmin(caller) and arg.size() <= 2_000_000;
      case (#admin_set_config _) isAdmin(caller) and arg.size() <= IngressGuard.textArg(1_000);
      case (#admin_add_admin _ or #admin_finish_import _ or #admin_remove_admin _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#set_nickname_avatar _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.textArg(T.MAX_URL_LENGTH);
      case _ not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.SMALL_ARG;
    };
  };
};
