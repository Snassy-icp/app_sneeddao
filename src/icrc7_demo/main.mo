/// A small, spec-shaped ICRC-7 collection with ICRC-37 approvals: enough to
/// test wallets and marketplaces against, and the seed of an NFT launchpad.
/// The installer (and any admin) mints; owners transfer and approve; approved
/// spenders transfer_from. No block log (ICRC-3) yet.
/// Standards: https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-7/ICRC-7.md
///            https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-37/ICRC-37.md
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
  // ---- ICRC-37 types ----
  public type ApprovalInfo = { spender : Account; from_subaccount : ?Blob; expires_at : ?Nat64; memo : ?Blob; created_at_time : Nat64 };
  public type ApproveTokenArg = { token_id : Nat; approval_info : ApprovalInfo };
  public type ApproveTokenError = { #InvalidSpender; #Unauthorized; #NonExistingTokenId; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #GenericError : { error_code : Nat; message : Text }; #GenericBatchError : { error_code : Nat; message : Text } };
  public type ApproveCollectionArg = { approval_info : ApprovalInfo };
  public type ApproveCollectionError = { #InvalidSpender; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #GenericError : { error_code : Nat; message : Text }; #GenericBatchError : { error_code : Nat; message : Text } };
  public type RevokeTokenApprovalArg = { spender : ?Account; from_subaccount : ?Blob; token_id : Nat; memo : ?Blob; created_at_time : ?Nat64 };
  public type RevokeTokenApprovalError = { #ApprovalDoesNotExist; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #NonExistingTokenId; #Unauthorized; #GenericError : { error_code : Nat; message : Text }; #GenericBatchError : { error_code : Nat; message : Text } };
  public type RevokeCollectionApprovalArg = { spender : ?Account; from_subaccount : ?Blob; memo : ?Blob; created_at_time : ?Nat64 };
  public type RevokeCollectionApprovalError = { #ApprovalDoesNotExist; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #GenericError : { error_code : Nat; message : Text }; #GenericBatchError : { error_code : Nat; message : Text } };
  public type IsApprovedArg = { spender : Account; from_subaccount : ?Blob; token_id : Nat };
  public type TokenApproval = { token_id : Nat; approval_info : ApprovalInfo };
  public type CollectionApproval = ApprovalInfo;
  public type TransferFromArg = { spender_subaccount : ?Blob; from : Account; to : Account; token_id : Nat; memo : ?Blob; created_at_time : ?Nat64 };
  public type TransferFromError = { #InvalidRecipient; #Unauthorized; #NonExistingTokenId; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat }; #GenericError : { error_code : Nat; message : Text }; #GenericBatchError : { error_code : Nat; message : Text } };
  // token-level approvals keyed by token id; collection-level by the approving account
  type TokenApprovalEntry = { token_id : Nat; owner : Account; info : ApprovalInfo };
  type CollectionApprovalEntry = { owner : Account; info : ApprovalInfo };

  stable var name : Text = init.name;
  stable var symbol : Text = init.symbol;
  stable var description : ?Text = init.description;
  stable var logo : ?Text = init.logo;
  stable var supply_cap : ?Nat = null;
  stable var admins : [Principal] = [installer];
  stable var tokens : [Token] = []; // sorted by id
  stable var next_id : Nat = 1;
  stable var tx_count : Nat = 0;
  stable var token_approvals : [TokenApprovalEntry] = [];
  stable var collection_approvals : [CollectionApprovalEntry] = [];
  transient let MAX_APPROVALS : Nat = 100; // per token, and per account for the collection
  transient let MAX_REVOKE : Nat = 100;

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
  func nowNs() : Nat64 { Nat64.fromNat(Int.abs(Time.now())) };
  func notExpired(i : ApprovalInfo) : Bool { switch (i.expires_at) { case (?e) { e > nowNs() }; case null { true } } };
  /// Is `spender` allowed to move `token` out of `owner`'s account? Token approval or collection approval, unexpired.
  func isApproved(spender : Account, owner : Account, token_id : Nat) : Bool {
    let byToken = Array.find<TokenApprovalEntry>(token_approvals, func(e) { e.token_id == token_id and sameAccount(e.owner, owner) and sameAccount(e.info.spender, spender) and notExpired(e.info) }) != null;
    if (byToken) { return true };
    Array.find<CollectionApprovalEntry>(collection_approvals, func(e) { sameAccount(e.owner, owner) and sameAccount(e.info.spender, spender) and notExpired(e.info) }) != null;
  };
  func clearTokenApprovals(token_id : Nat) { token_approvals := Array.filter<TokenApprovalEntry>(token_approvals, func(e) { e.token_id != token_id }) };
  func checkTime(t : ?Nat64) : ?{ #TooOld; #CreatedInFuture : { ledger_time : Nat64 } } {
    let now = nowNs();
    switch (t) { case (?x) { if (x + TX_WINDOW_NS + DRIFT_NS < now) { return ?#TooOld }; if (x > now + DRIFT_NS) { return ?#CreatedInFuture({ ledger_time = now }) }; null }; case null { null } };
  };

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
    b.add(("icrc37:max_approvals_per_token_or_collection", #Nat(MAX_APPROVALS))); b.add(("icrc37:max_revoke_approvals", #Nat(MAX_REVOKE)));
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
    [{ name = "ICRC-7"; url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-7/ICRC-7.md" }, { name = "ICRC-37"; url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-37/ICRC-37.md" }, { name = "ICRC-10"; url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-10/ICRC-10.md" }];
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
          clearTokenApprovals(a.token_id);
          tx_count += 1;
          ?#Ok(tx_count);
        };
      };
    });
  };

  // ---- ICRC-37: approvals ----
  public query func icrc37_max_approvals_per_token_or_collection() : async ?Nat { ?MAX_APPROVALS };
  public query func icrc37_max_revoke_approvals() : async ?Nat { ?MAX_REVOKE };
  public query func icrc37_is_approved(args : [IsApprovedArg]) : async [Bool] {
    assert args.size() <= MAX_QUERY_BATCH;
    Array.map<IsApprovedArg, Bool>(args, func(a) {
      switch (find(a.token_id)) {
        case (?t) { if (Option.get(t.owner.subaccount, defaultSub()) != Option.get(a.from_subaccount, defaultSub())) { false } else { isApproved(a.spender, t.owner, a.token_id) } };
        case null { false };
      };
    });
  };
  public query func icrc37_get_token_approvals(token_ids : [Nat], prev : ?TokenApproval, take : ?Nat) : async [TokenApproval] {
    let n = Nat.min(Option.get(take, DEFAULT_TAKE), MAX_TAKE);
    let all = Array.map<TokenApprovalEntry, TokenApproval>(Array.filter<TokenApprovalEntry>(token_approvals, func(e) { notExpired(e.info) and Array.find<Nat>(token_ids, func(id) { id == e.token_id }) != null }), func(e) { { token_id = e.token_id; approval_info = e.info } });
    // ordered by token id then spender text; `prev` continues after a given entry
    let sorted = Array.sort<TokenApproval>(all, func(a, b) { if (a.token_id != b.token_id) { Nat.compare(a.token_id, b.token_id) } else { Principal.compare(a.approval_info.spender.owner, b.approval_info.spender.owner) } });
    let after = switch (prev) { case (?p) { Array.filter<TokenApproval>(sorted, func(x) { x.token_id > p.token_id or (x.token_id == p.token_id and Principal.compare(x.approval_info.spender.owner, p.approval_info.spender.owner) == #greater) }) }; case null { sorted } };
    if (after.size() <= n) { after } else { Array.tabulate<TokenApproval>(n, func(i) { after[i] }) };
  };
  public query func icrc37_get_collection_approvals(owner : Account, prev : ?CollectionApproval, take : ?Nat) : async [CollectionApproval] {
    let n = Nat.min(Option.get(take, DEFAULT_TAKE), MAX_TAKE);
    let all = Array.map<CollectionApprovalEntry, CollectionApproval>(Array.filter<CollectionApprovalEntry>(collection_approvals, func(e) { sameAccount(e.owner, owner) and notExpired(e.info) }), func(e) { e.info });
    let sorted = Array.sort<CollectionApproval>(all, func(a, b) { Principal.compare(a.spender.owner, b.spender.owner) });
    let after = switch (prev) { case (?p) { Array.filter<CollectionApproval>(sorted, func(x) { Principal.compare(x.spender.owner, p.spender.owner) == #greater }) }; case null { sorted } };
    if (after.size() <= n) { after } else { Array.tabulate<CollectionApproval>(n, func(i) { after[i] }) };
  };
  public shared ({ caller }) func icrc37_approve_tokens(args : [ApproveTokenArg]) : async [?{ #Ok : Nat; #Err : ApproveTokenError }] {
    if (args.size() > MAX_UPDATE_BATCH) { return [?#Err(#GenericBatchError({ error_code = 1; message = "batch too large" }))] };
    Array.map<ApproveTokenArg, ?{ #Ok : Nat; #Err : ApproveTokenError }>(args, func(a) {
      let owner : Account = { owner = caller; subaccount = a.approval_info.from_subaccount };
      if (sameAccount(a.approval_info.spender, owner)) { return ?#Err(#InvalidSpender) };
      switch (checkTime(?a.approval_info.created_at_time)) { case (?#TooOld) { return ?#Err(#TooOld) }; case (?#CreatedInFuture(x)) { return ?#Err(#CreatedInFuture(x)) }; case null {} };
      switch (find(a.token_id)) {
        case null { ?#Err(#NonExistingTokenId) };
        case (?t) {
          if (not sameAccount(t.owner, owner)) { return ?#Err(#Unauthorized) };
          let others = Array.filter<TokenApprovalEntry>(token_approvals, func(e) { not (e.token_id == a.token_id and sameAccount(e.info.spender, a.approval_info.spender)) });
          let count = Array.foldLeft<TokenApprovalEntry, Nat>(others, 0, func(n, e) { if (e.token_id == a.token_id) { n + 1 } else { n } });
          if (count >= MAX_APPROVALS) { return ?#Err(#GenericError({ error_code = 3; message = "too many approvals on this token" })) };
          token_approvals := Array.append(others, [{ token_id = a.token_id; owner = t.owner; info = a.approval_info }]);
          tx_count += 1;
          ?#Ok(tx_count);
        };
      };
    });
  };
  public shared ({ caller }) func icrc37_approve_collection(args : [ApproveCollectionArg]) : async [?{ #Ok : Nat; #Err : ApproveCollectionError }] {
    if (args.size() > MAX_UPDATE_BATCH) { return [?#Err(#GenericBatchError({ error_code = 1; message = "batch too large" }))] };
    Array.map<ApproveCollectionArg, ?{ #Ok : Nat; #Err : ApproveCollectionError }>(args, func(a) {
      let owner : Account = { owner = caller; subaccount = a.approval_info.from_subaccount };
      if (sameAccount(a.approval_info.spender, owner)) { return ?#Err(#InvalidSpender) };
      switch (checkTime(?a.approval_info.created_at_time)) { case (?#TooOld) { return ?#Err(#TooOld) }; case (?#CreatedInFuture(x)) { return ?#Err(#CreatedInFuture(x)) }; case null {} };
      let others = Array.filter<CollectionApprovalEntry>(collection_approvals, func(e) { not (sameAccount(e.owner, owner) and sameAccount(e.info.spender, a.approval_info.spender)) });
      let count = Array.foldLeft<CollectionApprovalEntry, Nat>(others, 0, func(n, e) { if (sameAccount(e.owner, owner)) { n + 1 } else { n } });
      if (count >= MAX_APPROVALS) { return ?#Err(#GenericError({ error_code = 3; message = "too many collection approvals for this account" })) };
      collection_approvals := Array.append(others, [{ owner; info = a.approval_info }]);
      tx_count += 1;
      ?#Ok(tx_count);
    });
  };
  public shared ({ caller }) func icrc37_revoke_token_approvals(args : [RevokeTokenApprovalArg]) : async [?{ #Ok : Nat; #Err : RevokeTokenApprovalError }] {
    if (args.size() > MAX_REVOKE) { return [?#Err(#GenericBatchError({ error_code = 1; message = "batch too large" }))] };
    Array.map<RevokeTokenApprovalArg, ?{ #Ok : Nat; #Err : RevokeTokenApprovalError }>(args, func(a) {
      let owner : Account = { owner = caller; subaccount = a.from_subaccount };
      switch (checkTime(a.created_at_time)) { case (?#TooOld) { return ?#Err(#TooOld) }; case (?#CreatedInFuture(x)) { return ?#Err(#CreatedInFuture(x)) }; case null {} };
      switch (find(a.token_id)) {
        case null { ?#Err(#NonExistingTokenId) };
        case (?t) {
          if (not sameAccount(t.owner, owner)) { return ?#Err(#Unauthorized) };
          token_approvals := Array.filter<TokenApprovalEntry>(token_approvals, func(e) { notExpired(e.info) }); // expired ones are gone, not revocable
          let before = token_approvals.size();
          token_approvals := Array.filter<TokenApprovalEntry>(token_approvals, func(e) { not (e.token_id == a.token_id and sameAccount(e.owner, owner) and (switch (a.spender) { case (?s) { sameAccount(e.info.spender, s) }; case null { true } })) });
          if (token_approvals.size() == before) { return ?#Err(#ApprovalDoesNotExist) };
          tx_count += 1;
          ?#Ok(tx_count);
        };
      };
    });
  };
  public shared ({ caller }) func icrc37_revoke_collection_approvals(args : [RevokeCollectionApprovalArg]) : async [?{ #Ok : Nat; #Err : RevokeCollectionApprovalError }] {
    if (args.size() > MAX_REVOKE) { return [?#Err(#GenericBatchError({ error_code = 1; message = "batch too large" }))] };
    Array.map<RevokeCollectionApprovalArg, ?{ #Ok : Nat; #Err : RevokeCollectionApprovalError }>(args, func(a) {
      let owner : Account = { owner = caller; subaccount = a.from_subaccount };
      switch (checkTime(a.created_at_time)) { case (?#TooOld) { return ?#Err(#TooOld) }; case (?#CreatedInFuture(x)) { return ?#Err(#CreatedInFuture(x)) }; case null {} };
      collection_approvals := Array.filter<CollectionApprovalEntry>(collection_approvals, func(e) { notExpired(e.info) }); // expired ones are gone, not revocable
      let before = collection_approvals.size();
      collection_approvals := Array.filter<CollectionApprovalEntry>(collection_approvals, func(e) { not (sameAccount(e.owner, owner) and (switch (a.spender) { case (?s) { sameAccount(e.info.spender, s) }; case null { true } })) });
      if (collection_approvals.size() == before) { return ?#Err(#ApprovalDoesNotExist) };
      tx_count += 1;
      ?#Ok(tx_count);
    });
  };
  public shared ({ caller }) func icrc37_transfer_from(args : [TransferFromArg]) : async [?{ #Ok : Nat; #Err : TransferFromError }] {
    if (args.size() > MAX_UPDATE_BATCH) { return [?#Err(#GenericBatchError({ error_code = 1; message = "batch too large" }))] };
    Array.map<TransferFromArg, ?{ #Ok : Nat; #Err : TransferFromError }>(args, func(a) {
      let spender : Account = { owner = caller; subaccount = a.spender_subaccount };
      switch (checkTime(a.created_at_time)) { case (?#TooOld) { return ?#Err(#TooOld) }; case (?#CreatedInFuture(x)) { return ?#Err(#CreatedInFuture(x)) }; case null {} };
      if (Principal.isAnonymous(a.to.owner)) { return ?#Err(#InvalidRecipient) };
      switch (find(a.token_id)) {
        case null { ?#Err(#NonExistingTokenId) };
        case (?t) {
          if (not sameAccount(t.owner, a.from)) { return ?#Err(#Unauthorized) };
          if (not isApproved(spender, a.from, a.token_id)) { return ?#Err(#Unauthorized) };
          if (sameAccount(t.owner, a.to)) { return ?#Err(#InvalidRecipient) };
          tokens := Array.map<Token, Token>(tokens, func(x) { if (x.id == a.token_id) { { x with owner = a.to } } else { x } });
          clearTokenApprovals(a.token_id);
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
