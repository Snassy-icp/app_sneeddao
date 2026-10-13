/// A small, spec-shaped ICRC-7 collection: enough to test wallets against,
/// and the seed of an NFT launchpad. The installer (and any admin) mints;
/// owners transfer. No approvals (ICRC-37) yet, no block log (ICRC-3) yet.
/// Standard: https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-7/ICRC-7.md
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Int "mo:base/Int";
import Option "mo:base/Option";
import Principal "mo:base/Principal";
import Time "mo:base/Time";

shared ({ caller = installer }) persistent actor class Icrc7Demo(init : { name : Text; symbol : Text; description : ?Text; logo : ?Text }) = this {
  public type Account = { owner : Principal; subaccount : ?Blob };
  public type Value = { #Blob : Blob; #Text : Text; #Nat : Nat; #Int : Int; #Array : [Value]; #Map : [(Text, Value)] };
  public type TransferArg = { from_subaccount : ?Blob; to : Account; token_id : Nat; memo : ?Blob; created_at_time : ?Nat64 };
  public type TransferError = {
    #NonExistingTokenId; #InvalidRecipient; #Unauthorized; #TooOld; #CreatedInFuture : { ledger_time : Nat64 };
    #Duplicate : { duplicate_of : Nat }; #GenericError : { error_code : Nat; message : Text }; #GenericBatchError : { error_code : Nat; message : Text };
  };
  public type TransferResult = { #Ok : Nat; #Err : TransferError };
  type Token = { id : Nat; owner : Account; metadata : [(Text, Value)]; minted_at : Int };

  stable var name : Text = init.name;
  stable var symbol : Text = init.symbol;
  stable var description : ?Text = init.description;
  stable var logo : ?Text = init.logo;
  stable var supply_cap : ?Nat = null;
  stable var admins : [Principal] = [installer];
  stable var tokens : [Token] = []; // sorted by id
  stable var next_id : Nat = 1;
  stable var tx_count : Nat = 0;

  transient let MAX_QUERY_BATCH : Nat = 100;
  transient let MAX_UPDATE_BATCH : Nat = 20;
  transient let DEFAULT_TAKE : Nat = 20;
  transient let MAX_TAKE : Nat = 200;
  transient let MAX_MEMO : Nat = 32;
  transient let TX_WINDOW_NS : Nat64 = 24 * 60 * 60 * 1_000_000_000;
  transient let DRIFT_NS : Nat64 = 2 * 60 * 1_000_000_000;

  func isAdmin(p : Principal) : Bool { Array.find<Principal>(admins, func(a) { a == p }) != null or Principal.isController(p) };
  func sameAccount(a : Account, b : Account) : Bool {
    a.owner == b.owner and Option.get(a.subaccount, defaultSub()) == Option.get(b.subaccount, defaultSub());
  };
  func defaultSub() : Blob { Blob.fromArray(Array.tabulate<Nat8>(32, func(_) { 0 })) };
  func find(id : Nat) : ?Token { Array.find<Token>(tokens, func(t) { t.id == id }) };

  // ---- ICRC-7 collection queries ----
  public query func icrc7_collection_metadata() : async [(Text, Value)] {
    let b = Buffer.Buffer<(Text, Value)>(8);
    b.add(("icrc7:name", #Text(name))); b.add(("icrc7:symbol", #Text(symbol)));
    switch (description) { case (?d) { b.add(("icrc7:description", #Text(d))) }; case null {} };
    switch (logo) { case (?l) { b.add(("icrc7:logo", #Text(l))) }; case null {} };
    b.add(("icrc7:total_supply", #Nat(tokens.size())));
    switch (supply_cap) { case (?c) { b.add(("icrc7:supply_cap", #Nat(c))) }; case null {} };
    b.add(("icrc7:max_query_batch_size", #Nat(MAX_QUERY_BATCH))); b.add(("icrc7:max_update_batch_size", #Nat(MAX_UPDATE_BATCH)));
    b.add(("icrc7:default_take_value", #Nat(DEFAULT_TAKE))); b.add(("icrc7:max_take_value", #Nat(MAX_TAKE))); b.add(("icrc7:max_memo_size", #Nat(MAX_MEMO)));
    b.add(("icrc7:atomic_batch_transfers", #Nat(0)));
    Buffer.toArray(b);
  };
  public query func icrc7_symbol() : async Text { symbol };
  public query func icrc7_name() : async Text { name };
  public query func icrc7_description() : async ?Text { description };
  public query func icrc7_logo() : async ?Text { logo };
  public query func icrc7_total_supply() : async Nat { tokens.size() };
  public query func icrc7_supply_cap() : async ?Nat { supply_cap };
  public query func icrc7_max_query_batch_size() : async ?Nat { ?MAX_QUERY_BATCH };
  public query func icrc7_max_update_batch_size() : async ?Nat { ?MAX_UPDATE_BATCH };
  public query func icrc7_default_take_value() : async ?Nat { ?DEFAULT_TAKE };
  public query func icrc7_max_take_value() : async ?Nat { ?MAX_TAKE };
  public query func icrc7_max_memo_size() : async ?Nat { ?MAX_MEMO };
  public query func icrc7_atomic_batch_transfers() : async ?Bool { ?false };
  public query func icrc7_tx_window() : async ?Nat { ?Nat64.toNat(TX_WINDOW_NS / 1_000_000_000) };
  public query func icrc7_permitted_drift() : async ?Nat { ?Nat64.toNat(DRIFT_NS / 1_000_000_000) };
  public query func icrc10_supported_standards() : async [{ name : Text; url : Text }] {
    [{ name = "ICRC-7"; url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-7/ICRC-7.md" }, { name = "ICRC-10"; url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-10/ICRC-10.md" }];
  };

  // ---- ICRC-7 token queries ----
  public query func icrc7_token_metadata(ids : [Nat]) : async [?[(Text, Value)]] {
    assert ids.size() <= MAX_QUERY_BATCH;
    Array.map<Nat, ?[(Text, Value)]>(ids, func(id) { switch (find(id)) { case (?t) { ?t.metadata }; case null { null } } });
  };
  public query func icrc7_owner_of(ids : [Nat]) : async [?Account] {
    assert ids.size() <= MAX_QUERY_BATCH;
    Array.map<Nat, ?Account>(ids, func(id) { switch (find(id)) { case (?t) { ?t.owner }; case null { null } } });
  };
  public query func icrc7_balance_of(accounts : [Account]) : async [Nat] {
    assert accounts.size() <= MAX_QUERY_BATCH;
    Array.map<Account, Nat>(accounts, func(a) { Array.foldLeft<Token, Nat>(tokens, 0, func(n, t) { if (sameAccount(t.owner, a)) { n + 1 } else { n } }) });
  };
  func page(ids : [Nat], prev : ?Nat, take : ?Nat) : [Nat] {
    let n = Nat.min(Option.get(take, DEFAULT_TAKE), MAX_TAKE);
    let after = switch (prev) { case (?p) { Array.filter<Nat>(ids, func(id) { id > p }) }; case null { ids } };
    if (after.size() <= n) { after } else { Array.tabulate<Nat>(n, func(i) { after[i] }) };
  };
  public query func icrc7_tokens(prev : ?Nat, take : ?Nat) : async [Nat] { page(Array.map<Token, Nat>(tokens, func(t) { t.id }), prev, take) };
  public query func icrc7_tokens_of(account : Account, prev : ?Nat, take : ?Nat) : async [Nat] {
    page(Array.map<Token, Nat>(Array.filter<Token>(tokens, func(t) { sameAccount(t.owner, account) }), func(t) { t.id }), prev, take);
  };

  // ---- ICRC-7 transfer ----
  public shared ({ caller }) func icrc7_transfer(args : [TransferArg]) : async [?TransferResult] {
    if (args.size() > MAX_UPDATE_BATCH) { return [?#Err(#GenericBatchError({ error_code = 1; message = "batch too large" }))] };
    let now = Nat64.fromNat(Int.abs(Time.now()));
    Array.map<TransferArg, ?TransferResult>(args, func(a) {
      switch (a.memo) { case (?m) { if (m.size() > MAX_MEMO) { return ?#Err(#GenericError({ error_code = 2; message = "memo too long" })) } }; case null {} };
      switch (a.created_at_time) {
        case (?t) { if (t + TX_WINDOW_NS + DRIFT_NS < now) { return ?#Err(#TooOld) }; if (t > now + DRIFT_NS) { return ?#Err(#CreatedInFuture({ ledger_time = now })) } };
        case null {};
      };
      if (Principal.isAnonymous(a.to.owner)) { return ?#Err(#InvalidRecipient) };
      let from : Account = { owner = caller; subaccount = a.from_subaccount };
      switch (find(a.token_id)) {
        case null { ?#Err(#NonExistingTokenId) };
        case (?t) {
          if (not sameAccount(t.owner, from)) { return ?#Err(#Unauthorized) };
          if (sameAccount(t.owner, a.to)) { return ?#Err(#InvalidRecipient) };
          tokens := Array.map<Token, Token>(tokens, func(x) { if (x.id == a.token_id) { { x with owner = a.to } } else { x } });
          tx_count += 1;
          ?#Ok(tx_count);
        };
      };
    });
  };

  // ---- minting and collection settings (admins) ----
  public shared ({ caller }) func mint(to : Account, metadata : [(Text, Value)]) : async { #Ok : Nat; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admin only") };
    switch (supply_cap) { case (?c) { if (tokens.size() >= c) { return #Err("supply cap reached") } }; case null {} };
    let id = next_id; next_id += 1;
    tokens := Array.append(tokens, [{ id; owner = to; metadata; minted_at = Time.now() }]);
    tx_count += 1;
    #Ok(id);
  };
  public shared ({ caller }) func set_collection(u : { name : ?Text; symbol : ?Text; description : ??Text; logo : ??Text; supply_cap : ??Nat }) : async { #Ok; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("admin only") };
    switch (u.name) { case (?v) { name := v }; case null {} };
    switch (u.symbol) { case (?v) { symbol := v }; case null {} };
    switch (u.description) { case (?v) { description := v }; case null {} };
    switch (u.logo) { case (?v) { logo := v }; case null {} };
    switch (u.supply_cap) { case (?v) { supply_cap := v }; case null {} };
    #Ok;
  };
  public shared ({ caller }) func add_admin(p : Principal) : async { #Ok; #Err : Text } { if (not isAdmin(caller)) { return #Err("admin only") }; admins := Array.append(admins, [p]); #Ok };
  public query func get_admins() : async [Principal] { admins };
};
