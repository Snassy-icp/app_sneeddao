import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import List "mo:base/List";
import Iter "mo:base/Iter";
import Time "mo:base/Time";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Int "mo:base/Int";
import Array "mo:base/Array";
import Nat8 "mo:base/Nat8";
import Blob "mo:base/Blob";
import Bool "mo:base/Bool";
import Debug "mo:base/Debug";

import T "Types";

import CircularBuffer "CircularBuffer";

// TODO: figure out when new instances of actors are created, whether or not that depends on the client at all, and how this effects the persistent state of the actor.
//       https://internetcomputer.org/docs/current/motoko/main/writing-motoko/actor-classes
shared (deployer) actor class SneedLock() = this {

  ////////////////
  // locks
  ////////////////

  // aliases
  type TokenType = T.TokenType;
  type Balance = T.Balance;
  type Expiry = T.Expiry;
  type Lock = T.Lock;
  type FullyQualifiedLock = T.FullyQualifiedLock;
  type StableLocks = T.StableLocks;
  type StablePositionOwnerships = T.StablePositionOwnerships;
  type Locks = T.Locks;
  type TokenLockMap = T.TokenLockMap;
  type PrincipalTokenLockMap = T.PrincipalTokenLockMap;
  type State = T.State;
  type CreateLockResult = T.CreateLockResult;
  type CreateLockError = T.CreateLockError;
  type Subaccount = T.Subaccount;
  type Account = T.Account;
  type SetLockFeeResult = T.SetLockFeeResult;
  type TransferArgs = T.TransferArgs;
  type TransferResult = T.TransferResult;
  type TransferError = T.TransferError;
  type StablePrincipalSwapCanisters = T.StablePrincipalSwapCanisters;
  type StablePrincipalLedgerCanisters = T.StablePrincipalLedgerCanisters;
  type GetUserPositionIdsByPrincipalResult = T.GetUserPositionIdsByPrincipalResult;
  type FullyQualifiedPositionLock = T.FullyQualifiedPositionLock;
  type StablePositionLocks = T.StablePositionLocks;
  type PositionLocks = T.PositionLocks;
  type PositionLockMap = T.PositionLockMap;
  type PrincipalPositionLocksMap = T.PrincipalPositionLocksMap;
  type CircularBuffer = CircularBuffer.CircularBuffer;
  type BufferEntry = CircularBuffer.BufferEntry;

  // consts
  let transaction_fee_sneed_e8s : Nat = 1000;
  let second_ns : Nat64 = 1_000_000_000; // 1 second in nanoseconds
  let minute_ns : Nat64 = 60 * second_ns; // 1 minute in nanoseconds
  let hour_ns : Nat64 = 60 * minute_ns; // 1 hour in nanoseconds
  let day_ns : Nat64 = 24 * hour_ns; // 1 day in nanoseconds
  // dex consts
  let dex_icpswap : T.Dex = 1;

  // stable memory
  stable var stable_principal_swap_canisters : StablePrincipalSwapCanisters = [];
  stable var stable_principal_ledger_canisters : StablePrincipalLedgerCanisters = [];
  stable var stableLocks : StableLocks = [];
  stable var stable_position_locks : StablePositionLocks = [];
  stable var stable_position_ownerships : StablePositionOwnerships = [];
  stable var token_lock_fee_sneed_e8s : Nat = 0;
  stable var min_lock_length_ns : Nat64 = 5 * second_ns;
  stable var max_lock_length_ns : Nat64 = 7 * day_ns;
  stable var current_lock_id : Nat = 0;
  stable var error_log : CircularBuffer = CircularBuffer.CircularBufferLogic.create(10_000);
  stable var info_log : CircularBuffer = CircularBuffer.CircularBufferLogic.create(10_000);
  stable var next_correlation_id : Nat = 0;

  var cached_token_meta : HashMap.HashMap<Principal, T.TokenMeta> = HashMap.HashMap<Principal, T.TokenMeta>(100, Principal.equal, Principal.hash);

  let icrc1_sneed_ledger_canister_id = Principal.fromText("hvgxa-wqaaa-aaaaq-aacia-cai");
  let sneed_defi_canister_id = Principal.fromText("ok64y-uiaaa-aaaag-qdcbq-cai");

  // ephemeral state
  let state : State = object { 
    // initialize as empty here, see postupgrade for how to populate from stable memory
    public let principal_swap_canisters: HashMap.HashMap<Principal, List.List<Principal>> = HashMap.HashMap<Principal, List.List<Principal>>(100, Principal.equal, Principal.hash);
    public let principal_ledger_canisters: HashMap.HashMap<Principal, List.List<Principal>> = HashMap.HashMap<Principal, List.List<Principal>>(100, Principal.equal, Principal.hash);
    public let principal_token_locks: PrincipalTokenLockMap = HashMap.HashMap<Principal, TokenLockMap>(100, Principal.equal, Principal.hash);
    public let principal_position_locks : HashMap.HashMap<Principal, T.PositionLockMap> = HashMap.HashMap<Principal, T.PositionLockMap>(100, Principal.equal, Principal.hash);
    public let principal_position_ownerships: T.PrincipalSwapPositionsMap = HashMap.HashMap<Principal, T.SwapPositionsMap>(100, Principal.equal, Principal.hash);
  };

  public query func get_cached_token_meta(swap_canister_id : Principal) : async ?T.TokenMeta { 
    cached_token_meta.get(swap_canister_id); 
  };

  public shared ({ caller }) func set_cached_token_meta(swap_canister_id : Principal, new_token_meta : T.TokenMeta) : async () {
    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Setting cached token meta for " # debug_show(swap_canister_id) # " to " # debug_show(new_token_meta));
    cached_token_meta.put(swap_canister_id, new_token_meta);
  };

  public shared ({ caller }) func register_swap_canister_id(icrc1_swap_canister_id : Principal) : async () {
    let principal = caller;
    if (Principal.isAnonymous(principal)) {
      return; 
    };

    let swapCanisters = switch (state.principal_swap_canisters.get(principal)) {
      case (?existingSwapCanisters) existingSwapCanisters;
      case _ List.nil<Principal>();
    };

    if (List.some<Principal>(swapCanisters, func swapCanister { swapCanister == icrc1_swap_canister_id; } )) {
      return;
    };

    let newSwapCanisters = List.push<Principal>(icrc1_swap_canister_id, swapCanisters);
    state.principal_swap_canisters.put(principal, newSwapCanisters);
  };

  public shared ({ caller }) func unregister_swap_canister_id(icrc1_swap_canister_id : Principal) : async () {
    let principal = caller;
    if (Principal.isAnonymous(principal)) {
      return; 
    };

    let swapCanisters = switch (state.principal_swap_canisters.get(principal)) {
      case (?existingSwapCanisters) existingSwapCanisters;
      case _ List.nil<Principal>();
    };

    let newSwapCanisters = List.filter<Principal>(swapCanisters, func test_swap_canister { test_swap_canister != icrc1_swap_canister_id; });
    state.principal_swap_canisters.put(principal, newSwapCanisters);
  };

  public shared ({ caller }) func register_ledger_canister_id(icrc1_ledger_canister_id : Principal) : async () {
    let principal = caller;
    if (Principal.isAnonymous(principal)) {
      return; 
    };

    let ledgerCanisters = switch (state.principal_ledger_canisters.get(principal)) {
      case (?existingLedgerCanisters) existingLedgerCanisters;
      case _ List.nil<Principal>();
    };

    if (List.some<Principal>(ledgerCanisters, func ledgerCanister { ledgerCanister == icrc1_ledger_canister_id; } )) {
      return;
    };

    let newLedgerCanisters = List.push<Principal>(icrc1_ledger_canister_id, ledgerCanisters);
    state.principal_ledger_canisters.put(principal, newLedgerCanisters);
  };

  public shared ({ caller }) func unregister_ledger_canister_id(icrc1_ledger_canister_id : Principal) : async () {
    let principal = caller;
    if (Principal.isAnonymous(principal)) {
      return; 
    };

    let ledgerCanisters = switch (state.principal_ledger_canisters.get(principal)) {
      case (?existingLedgerCanisters) existingLedgerCanisters;
      case _ List.nil<Principal>();
    };

    let newLedgerCanisters = List.filter<Principal>(ledgerCanisters, func test_ledger_canister { test_ledger_canister != icrc1_ledger_canister_id; });
    state.principal_ledger_canisters.put(principal, newLedgerCanisters);
  };

  public query ({ caller }) func get_swap_canister_ids() : async [Principal] {
    let principal = caller;
    switch (state.principal_swap_canisters.get(principal)) {
      case (?existingSwapCanisters) List.toArray<Principal>(existingSwapCanisters);
      case _ [] : [Principal];
    };
  };

  public query ({ caller }) func get_ledger_canister_ids() : async [Principal] {
    let principal = caller;
    switch (state.principal_ledger_canisters.get(principal)) {
      case (?existingLedgerCanisters) List.toArray<Principal>(existingLedgerCanisters);
      case _ [] : [Principal];
    };
  };

  public query func get_token_lock_fee_sneed_e8s() : async Nat { token_lock_fee_sneed_e8s; };

  public query func get_all_token_locks() : async [T.FullyQualifiedLock] {
    get_fully_qualified_locks();
  };

  public query func get_ledger_token_locks(ledger_canister_id : T.TokenType) : async [T.FullyQualifiedLock] {
    let all_locks = get_fully_qualified_locks();
    Array.filter<T.FullyQualifiedLock>(all_locks, func (lock) { lock.1 == ledger_canister_id; });
  };

  public query func get_all_position_locks() : async [T.FullyQualifiedPositionLock] {
    get_fully_qualified_position_locks();
  };

  public query func get_swap_position_locks(swap_canister_id : T.SwapCanisterId) : async [T.FullyQualifiedPositionLock] {
    let all_position_locks = get_fully_qualified_position_locks();
    Array.filter<T.FullyQualifiedPositionLock>(all_position_locks, func (position_lock) { position_lock.1 == swap_canister_id; });
  };

  // sum everything for each token and return an array of tuples for the amount locked for each token for this principal.
  public query ({ caller }) func get_summed_locks(): async [(TokenType, Balance)] {
    get_summed_locks_from_principal(caller);
  };

  private func get_summed_locks_from_principal(principal : Principal): [(TokenType, Balance)] {
    //clear_expired_locks_for_principal(principal);

    let allLocks = switch (state.principal_token_locks.get(principal)) {
      case (?_tokenLocks) _tokenLocks;
      case _ HashMap.HashMap<TokenType, Locks>(10, Principal.equal, Principal.hash);
    };

    let tokenIter : Iter.Iter<TokenType> = allLocks.keys();
    var result = List.nil<(Principal, Balance)>();
    for (token in tokenIter) {
      let locks = switch (allLocks.get(token)) {
        case (?existingLocks) existingLocks;
        case _ List.nil<Lock>();
      };

      var sum : Balance = 0;
      let locksIter : Iter.Iter<Lock> = List.toIter<Lock>(locks);
      for (lock in locksIter) {
          sum += lock.amount;
      };

      result := List.push<(Principal, Balance)>((token, sum), result);
    };

    List.toArray<(Principal, Balance)>(result);

  };

  private func get_summed_locks_from_principal_and_token(principal : Principal, token_type : TokenType): Balance {
    let summed_locks_from_principal = get_summed_locks_from_principal(principal);

    for (i in Iter.range(0, summed_locks_from_principal.size() - 1)) {
      let (token, locked_count) = summed_locks_from_principal[i];
      if (token == token_type) {
        return locked_count;
      };
    };

    return 0;
  };

  // return all locks for a given principal
  // TODO: line 134/135: Can allLocks.get(tokenType) return null? I think that would result in running line 135 since there is a ? in "case (?existingLocks)"
  public query (msg) func get_token_locks(): async [(T.LockId, TokenType, Balance, Expiry)] {

    let principal: Principal = msg.caller;

    //clear_expired_locks_for_principal(principal);
      
    let allLocks = switch (state.principal_token_locks.get(principal)) {
      case (?_tokenLocks) _tokenLocks;
      case _ HashMap.HashMap<TokenType, Locks>(10, Principal.equal, Principal.hash);
    };

    let tokenIter : Iter.Iter<TokenType> = allLocks.keys();
    var result = List.nil<(T.LockId, Principal, Balance, Expiry)>();
    for (token in tokenIter) {
      let locks = switch (allLocks.get(token)) {
        case (?existingLocks) existingLocks;
        case _ List.nil<Lock>();
      };

      let locksIter : Iter.Iter<Lock> = List.toIter<Lock>(locks);
      for (lock in locksIter) {
        result := List.push<(T.LockId, Principal, Balance, Expiry)>((lock.lock_id, token, lock.amount, lock.expiry), result);
      };
    };
      
    List.toArray<(T.LockId, Principal, Balance, Expiry)>(result);
  };

  public query (msg) func get_position_ownerships(): async [(T.SwapCanisterId, T.PositionId)] {

    get_position_ownerships_impl(msg.caller);

  };

  // return all claims for a given principal
  private func get_position_ownerships_impl(principal : Principal): [(T.SwapCanisterId, T.PositionId)] {
      
    let allPositions = switch (state.principal_position_ownerships.get(principal)) {
      case (?_swapPositions) _swapPositions;
      case _ HashMap.HashMap<T.SwapCanisterId, T.Positions>(10, Principal.equal, Principal.hash);
    };

    let swapIter : Iter.Iter<T.SwapCanisterId> = allPositions.keys();
    var result = List.nil<(T.SwapCanisterId, T.PositionId)>();
    for (swap in swapIter) {
      let positions = switch (allPositions.get(swap)) {
        case (?existingPositions) existingPositions;
        case _ List.nil<T.PositionId>();
      };

      let positionsIter : Iter.Iter<T.PositionId> = List.toIter<T.PositionId>(positions);
      for (position_id in positionsIter) {
        result := List.push<(T.SwapCanisterId, T.PositionId)>((swap, position_id), result);
      };
    };
      
    List.toArray<(T.SwapCanisterId, T.PositionId)>(result);
  };

  private func has_claimed_position_impl(principal : Principal, swap_canister_id : T.SwapCanisterId, position_id : T.PositionId): Bool {
      
    let allPositions = switch (state.principal_position_ownerships.get(principal)) {
      case (?_swapPositions) _swapPositions;
      case _ HashMap.HashMap<T.SwapCanisterId, T.Positions>(10, Principal.equal, Principal.hash);
    };

    let position_ids = switch (allPositions.get(swap_canister_id)) {
      case (?existingPositions) existingPositions;
      case _ List.nil<T.PositionId>();
    };

    List.some<T.PositionId>(position_ids, func test_position_id { test_position_id == position_id; } );

  };

  private func get_position_lock(principal : Principal, swap_canister_id : T.SwapCanisterId, position_id : T.PositionId): ?T.PositionLock {

    let allPositionLocks = switch (state.principal_position_locks.get(principal)) {
      case (?_positionLocks) _positionLocks;
      case _ HashMap.HashMap<T.SwapCanisterId, T.PositionLocks>(10, Principal.equal, Principal.hash);
    };

    let positionLocks = switch (allPositionLocks.get(swap_canister_id)) {
      case (?existingPositionLocks) existingPositionLocks;
      case _ List.nil<T.PositionLock>();
    };

    let positionLocksIter : Iter.Iter<T.PositionLock> = List.toIter<T.PositionLock>(positionLocks);
    for (positionLock in positionLocksIter) {
      if (positionLock.position_id == position_id) {
        return ?positionLock;
      };
    };

    null;
  };

  public shared ({ caller }) func clear_expired_position_locks() : async () {
    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Clearing expired position locks for " # debug_show(caller));
    clear_expired_position_locks_for_principal(caller, correlation_id);
  };

  private func clear_expired_position_locks_for_principal(principal : Principal, correlation_id: Nat) : () {
    let allPositionLocks = switch (state.principal_position_locks.get(principal)) {
      case (?_positionLocks) _positionLocks;
      case _ HashMap.HashMap<T.SwapCanisterId, T.PositionLocks>(10, Principal.equal, Principal.hash);
    };

    var cnt_cleared : Nat = 0;
    let swapIter : Iter.Iter<T.SwapCanisterId> = allPositionLocks.keys();
    for (swap in swapIter) {
      let positionLocks = switch (allPositionLocks.get(swap)) {
        case (?existingPositionLocks) existingPositionLocks;
        case _ List.nil<T.PositionLock>();
      };

      let now = NowAsNat64();
      let validPositionLocks = List.filter<T.PositionLock>(positionLocks, func (positionLock) {
        positionLock.expiry > now
      });

      cnt_cleared += List.size(positionLocks) - List.size(validPositionLocks);      
      allPositionLocks.put(swap, validPositionLocks);
    };

    state.principal_position_locks.put(principal, allPositionLocks);
    log_info(principal, correlation_id, "Cleared " # debug_show(cnt_cleared) # " expired position locks for " # debug_show(principal));
  };

  public query ({ caller }) func has_expired_position_locks() : async Bool {
    let allPositionLocks = switch (state.principal_position_locks.get(caller)) {
      case (?_positionLocks) _positionLocks;
      case _ HashMap.HashMap<T.SwapCanisterId, T.PositionLocks>(10, Principal.equal, Principal.hash);
    };

    let swapIter : Iter.Iter<T.SwapCanisterId> = allPositionLocks.keys();
    for (swap in swapIter) {
      let positionLocks = switch (allPositionLocks.get(swap)) {
        case (?existingPositionLocks) existingPositionLocks;
        case _ List.nil<T.PositionLock>();
      };

      let now = NowAsNat64();
      if (List.some<T.PositionLock>(positionLocks, func test_position_lock { test_position_lock.expiry < now; } )) {
        return true;
      };
    };

    false;
  };

  private func update_position_lock_expiry(principal : Principal, correlation_id : Nat, swap_canister_id : T.SwapCanisterId, position_lock : T.PositionLock, new_expiry: Expiry): () {

    let allPositionLocks = switch (state.principal_position_locks.get(principal)) {
      case (?_positionLocks) _positionLocks;
      case _ HashMap.HashMap<T.SwapCanisterId, T.PositionLocks>(10, Principal.equal, Principal.hash);
    };

    let positionLocks = switch (allPositionLocks.get(swap_canister_id)) {
      case (?existingPositionLocks) existingPositionLocks;
      case _ List.nil<T.PositionLock>();
    };

    let filteredPositionLocks = List.filter<T.PositionLock>(positionLocks, func (p) { position_lock.lock_id != p.lock_id; });

    let updatedPositionLock : T.PositionLock = { 
      dex = position_lock.dex;
      lock_id = position_lock.lock_id;
      position_id = position_lock.position_id;
      expiry = new_expiry;
      token0 = position_lock.token0;
      token1 = position_lock.token1;
    };
    let newPositionLocks = List.push<T.PositionLock>(updatedPositionLock, filteredPositionLocks);

    allPositionLocks.put(swap_canister_id, newPositionLocks);
    log_info(principal, correlation_id, "Updated position lock with new expiry: " # debug_show(updatedPositionLock));
  };

  public shared ({ caller }) func claim_position(swap_canister_id : Principal, position_id : T.PositionId) : async Bool /*ClaimPositionResult*/ {
    
    let correlation_id = get_next_correlation_id();

    log_info(caller, correlation_id, "Claiming position " # debug_show(position_id) # " on swap canister " # debug_show(swap_canister_id) # " for " # debug_show(caller));

    // idempotent
    if (has_claimed_position_impl(caller, swap_canister_id, position_id)) {
      log_info(caller, correlation_id, "Already claimed position " # debug_show(position_id) # " on swap canister " # debug_show(swap_canister_id) # " for " # debug_show(caller));
      return true;
    };

    if (await verify_position_ownership(caller, swap_canister_id, position_id)) {
      add_position_ownership_for_principal(caller, swap_canister_id, position_id);
      log_info(caller, correlation_id, "Claimed position " # debug_show(position_id) # " on swap canister " # debug_show(swap_canister_id) # " for " # debug_show(caller));
      return true;
    };

    log_error(caller, correlation_id, "Failed to verify when claiming position " # debug_show(position_id) # " on swap canister " # debug_show(swap_canister_id) # " for " # debug_show(caller));
    false;
  };

  public shared ({ caller }) func transfer_tokens(to_principal : Principal, to_subaccount : ?T.Subaccount, icrc1_ledger_canister_id : Principal, amount : T.Balance) : async T.TransferResult /*ClaimPositionResult*/ {

    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Transferring " # Nat.toText(amount) # " tokens to " # debug_show(to_principal) # " with subaccount " # debug_show(to_subaccount) # " on ledger canister " # debug_show(icrc1_ledger_canister_id) # " for " # debug_show(caller));
    
    let icrc1_ledger_canister = actor (Principal.toText(icrc1_ledger_canister_id)) : actor {
          icrc1_transfer(args : TransferArgs) : async T.TransferResult;
          icrc1_balance_of(account : Account) : async Nat;
          icrc1_fee() : async T.Balance;
    };

    let from_subaccount = PrincipalToSubaccount(caller);

    // make sure to clean out any expired locks
    clear_expired_locks_for_principal(caller, correlation_id);

    let sum_locked = get_summed_locks_from_principal_and_token(caller, icrc1_ledger_canister_id);

    let token_fee = await icrc1_ledger_canister.icrc1_fee();
    let caller_subaccount_on_this : T.Account =  { owner = this_canister_id(); subaccount = ?Blob.fromArray(from_subaccount); };
    let token_balance = await icrc1_ledger_canister.icrc1_balance_of(caller_subaccount_on_this);
    let full_amount = amount + token_fee;
    if (token_balance < full_amount + sum_locked) {
        let error = #Err(#GenericError{
          message = "Insufficient balance to transfer for caller: " # debug_show(caller) # " on account " # debug_show(caller_subaccount_on_this) # ". Has: " # Nat.toText(token_balance) # ", Required: " # Nat.toText(full_amount);
          error_code = 1;
        });
        log_error(caller, correlation_id, debug_show(error));
        return error;
    };
    let to : T.Account = {
      owner = to_principal;
      subaccount = to_subaccount;
    };
    let transfer_args : TransferArgs = {
        from_subaccount = ?Blob.fromArray(from_subaccount);
        to = to;
        amount = amount;
        fee = null;
        memo = null;
        created_at_time = null;
    };

    let result = await icrc1_ledger_canister.icrc1_transfer(transfer_args);

    switch (result) {
      case (#Ok(_)) {
        log_info(caller, correlation_id, "Transfer complete. Args: " # debug_show(transfer_args) # ". Result: " # debug_show(result));
      };
      case (#Err(_)) {
        log_error(caller, correlation_id, "Transfer Failed. Args: " # debug_show(transfer_args) # ". Result: " # debug_show(result));
      };
    };

    return result;
  };

  public shared ({ caller }) func transfer_position(to : Principal, swap_canister_id : Principal, position_id : T.PositionId) : async T.TransferPositionResult /*ClaimPositionResult*/ {

    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Transferring position " # Nat.toText(position_id) # " on swap canister " # debug_show(swap_canister_id) # " to " # debug_show(to));

    // Ensure the position is currently controlled by this canister
    if (await verify_position_ownership(this_canister_id(), swap_canister_id, position_id)) {

      // Ensure the caller has claimed ownership of the position
      if (has_claimed_position_impl(caller, swap_canister_id, position_id)) {

        let swap_canister = actor (Principal.toText(swap_canister_id)) : actor {
            transferPosition(from : Principal, to : Principal, positionId : Nat) : async T.TransferPositionResult;
        };

        let result = await swap_canister.transferPosition(this_canister_id(), to, position_id);

        // if result is #ok, we can clear the position claim. this code uses the switch keyword.
        switch (result) {
          case (#ok(_)) {
            clear_position_claim(caller, swap_canister_id, position_id);
            log_info(caller, correlation_id, "Transfer position complete. Transferred (and cleared claim on) position " # Nat.toText(position_id) # " on swap canister " # debug_show(swap_canister_id) # " to " # debug_show(to) # " with result " # debug_show(result));
          };
          case (#err(_)) { 
            log_error(caller, correlation_id, "Transfer position failed. Failed transferring position " # Nat.toText(position_id) # " on swap canister " # debug_show(swap_canister_id) # " to " # debug_show(to) # " with error " # debug_show(result));
          };
        };

        return result;
      } else {
        let error = #err(#InternalError("Failed to validate claim when transferring position " # Nat.toText(position_id) # " on swap canister " # debug_show(swap_canister_id) # " to " # debug_show(to)));
        log_error(caller, correlation_id, debug_show(error));
        return error;
      };
    };

    let error = #err(#InternalError("Failed to verify ownership when transferring position " # Nat.toText(position_id) # " on swap canister " # debug_show(swap_canister_id) # " to " # debug_show(to)));
    log_error(caller, correlation_id, debug_show(error));
    return error;
  };

  private func clear_position_claim(principal : Principal, swap_canister_id : T.SwapCanisterId, position_id : T.PositionId) : () {
    let allPositions = switch (state.principal_position_ownerships.get(principal)) {
      case (?_swapPositions) _swapPositions;
      case _ HashMap.HashMap<T.SwapCanisterId, T.Positions>(10, Principal.equal, Principal.hash);
    };

    let position_ids = switch (allPositions.get(swap_canister_id)) {
      case (?existingPositions) existingPositions;
      case _ List.nil<T.PositionId>();
    };

    let new_position_ids = List.filter<T.PositionId>(position_ids, func test_position_id { test_position_id != position_id; } );
    allPositions.put(swap_canister_id, new_position_ids);
    state.principal_position_ownerships.put(principal, allPositions);
  };

  private func verify_position_ownership(caller : Principal, swap_canister_id : Principal, position_id : T.PositionId) : async Bool {

      try 
      {

        let swap_canister = actor (Principal.toText(swap_canister_id)) : actor {
            getUserPositionIdsByPrincipal(principal : Principal) : async GetUserPositionIdsByPrincipalResult;
        };

        switch (await swap_canister.getUserPositionIdsByPrincipal(caller)) {
          case (#ok(userPositionIds)) {
            for (userPositionId in userPositionIds.vals()) {
              if (position_id == userPositionId) { 
                return true;
              }
            };
          };
          case ( _ ) {
            return false;
          }
        };

      } catch (_) {
        return false;
      };

      false;
  };

  public shared ({ caller }) func create_lock(amount : Nat, icrc1_ledger_canister_id : Principal, expires_at : Expiry) : async CreateLockResult {
      
      let correlation_id = get_next_correlation_id();
      log_info(caller, correlation_id, " Creating lock for " # debug_show(amount) 
        # " tokens of ledger " # debug_show(icrc1_ledger_canister_id) # " that expires at " # debug_show(expires_at));

      // We have to make sure user doesn't use locked sneed to pay lock fees.
      // Thus we prohibit locking sneed tokens, so that we don't always  
      // have to call get_summed_locks_from_principal_and_token and icrc1_balance_of 
      // for caller to ensure sufficient unlocked sneed to cover lock_fee before locking.
      if (icrc1_ledger_canister_id == icrc1_sneed_ledger_canister_id) {
          let error = #Err({
            message = "Sneed DAO token can not be locked.";
            transfer_error = null;
          });
          log_error(caller, correlation_id, debug_show(error));
          return error;
      };
      
      if ((TimeAsNat64(Time.now()) + min_lock_length_ns) > expires_at) {
          let error = #Err({
            message = "Minimum lock time not fulfilled.";
            transfer_error = null;
          });
          log_error(caller, correlation_id, debug_show(error));
          return error;
      };
      
      if ((TimeAsNat64(Time.now()) + max_lock_length_ns) < expires_at) {
          let error = #Err({
            message = "Maximum lock time exceeded.";
            transfer_error = null;
          });
          log_error(caller, correlation_id, debug_show(error));
          return error;
      };

      let subaccount = PrincipalToSubaccount(caller);
      let caller_subaccount_on_this : Account = { owner = this_canister_id(); subaccount = ?Blob.fromArray(subaccount); };

      let icrc1_ledger_canister = actor (Principal.toText(icrc1_ledger_canister_id)) : actor {
          icrc1_balance_of(account : Account) : async Nat;
      };

      let token_balance = await icrc1_ledger_canister.icrc1_balance_of(caller_subaccount_on_this);
      if (token_balance < amount) {
          let error = #Err({
            message = "Insufficient balance to lock for caller: " # debug_show(caller) 
              # ", account " # debug_show(caller_subaccount_on_this) 
              # ". Has: " # Nat.toText(token_balance) 
              # ", Required: " # Nat.toText(amount);
            transfer_error = null;
          });
          log_error(caller, correlation_id, debug_show(error));
          return error;
      };

    // make sure to clean out any expired locks
      clear_expired_locks_for_principal(caller, correlation_id);

      let summed_locks_for_caller = get_summed_locks_from_principal_and_token(caller, icrc1_ledger_canister_id);
      // internal check
      if (summed_locks_for_caller > token_balance) {
          let error = #Err({
            message = "Internal error: existing locks for caller exceeds current token balance.";
            transfer_error = null;
          });
          log_error(caller, correlation_id, debug_show(error));
          return error;
      };

      let new_locked_amount = summed_locks_for_caller + amount; // this is safe because of the token_balance < amount check above
      if (token_balance < new_locked_amount) {
          let error = #Err({
            message = "Insufficient unlocked balance to lock. Has: " # Nat.toText(token_balance) 
              # ", Locked: " # Nat.toText(summed_locks_for_caller) 
              # " Required: " # Nat.toText(new_locked_amount);
            transfer_error = null;
          });
          log_error(caller, correlation_id, debug_show(error));
          return error;
      };

      // Pay token lock fee (denominated in Sneed)
      let transfer_result = await pay_lock_fee_sneed(caller, correlation_id, token_lock_fee_sneed_e8s);

      switch (transfer_result) {
          case (#Err(e)) {
            let create_lock_error : CreateLockError = {
              message = "Failed to create lock: " # debug_show(e);
              transfer_error = ?e;
            };
            let error = #Err(create_lock_error);
            log_error(caller, correlation_id, debug_show(error));
            return error;
          };
          case (#Ok(_)) {
            let lock = add_new_lock_for_principal(caller, icrc1_ledger_canister_id, amount, expires_at);
            log_info(caller, correlation_id, "Created lock:" # debug_show(lock));
            #Ok(lock.lock_id);
          };
      };
  };

  public shared ({ caller }) func create_position_lock(
    swap_canister_id : Principal,
    dex : T.Dex,
    position_id : T.PositionId,
    expires_at : Expiry,
    token0 : T.TokenType,
    token1 : T.TokenType) : async T.CreateLockResult {
      let correlation_id = get_next_correlation_id();
      log_info(caller, correlation_id, "Creating position lock for " # debug_show(caller) # " on swap canister " # debug_show(swap_canister_id) # " for position " # debug_show(position_id) # " to expire at " # debug_show(expires_at));
      let result = await create_or_update_position_lock(caller, correlation_id, swap_canister_id, ?dex, position_id, expires_at, ?token0, ?token1);
      switch (result) {
        case (#Ok(_)) {
          log_info(caller, correlation_id, "Created position lock for " # debug_show(caller) # " on swap canister " # debug_show(swap_canister_id) # " for position " # debug_show(position_id) # " to expire at " # debug_show(expires_at) # ", result: " # debug_show(result));
        }; 
        case (#Err(_)) {
          log_info(caller, correlation_id, "Failed to create position lock for " # debug_show(caller) # " on swap canister " # debug_show(swap_canister_id) # " for position " # debug_show(position_id) # " to expire at " # debug_show(expires_at) # ", result: " # debug_show(result));
        }; 
      };
      return result;
  };

  public shared ({ caller }) func update_position_lock(
    swap_canister_id : Principal,
    position_id : T.PositionId,
    expires_at : Expiry) : async T.CreateLockResult {
      let correlation_id = get_next_correlation_id();
      log_info(caller, correlation_id, "Updating position lock for " # debug_show(caller) # " on swap canister " # debug_show(swap_canister_id) # " for position " # debug_show(position_id) # " to expire at " # debug_show(expires_at));
      let result = await create_or_update_position_lock(caller, correlation_id, swap_canister_id, null, position_id, expires_at, null, null);
      switch (result) {
        case (#Ok(_)) {
          log_info(caller, correlation_id, "Updated position lock for " # debug_show(caller) # " on swap canister " # debug_show(swap_canister_id) # " for position " # debug_show(position_id) # " to expire at " # debug_show(expires_at) # ", result: " # debug_show(result));
        }; 
        case (#Err(_)) {
          log_info(caller, correlation_id, "Failed to update position lock for " # debug_show(caller) # " on swap canister " # debug_show(swap_canister_id) # " for position " # debug_show(position_id) # " to expire at " # debug_show(expires_at) # ", result: " # debug_show(result));
        }; 
      };
      return result;
  };

  private func create_or_update_position_lock(
    caller : Principal,
    correlation_id: Nat,
    swap_canister_id : Principal,
    dex : ?T.Dex,
    position_id : T.PositionId,
    expires_at : Expiry,
    token0 : ?T.TokenType,
    token1 : ?T.TokenType) : async T.CreateLockResult {

      if ((TimeAsNat64(Time.now()) + min_lock_length_ns) > expires_at) {
          return #Err({
            message = "Minimum lock time not fulfilled.";
            transfer_error = null;
          });
      };
            
      if ((TimeAsNat64(Time.now()) + max_lock_length_ns) < expires_at) {
          return #Err({
            message = "Maximum lock time exceeded.";
            transfer_error = null;
          });
      };

      let position_is_claimed = has_claimed_position_impl(caller, swap_canister_id, position_id);
      if (not position_is_claimed) {
          return #Err({
            message = "Position not claimed by caller.";
            transfer_error = null;
          });
      };

      let position_on_backend = await verify_position_ownership(this_canister_id(), swap_canister_id, position_id);
      if (not position_on_backend) {
         return #Err({
           message = "Position is not transferred to this canister.";
           transfer_error = null;
         });
      };

      // TODO: Claim lock fee!

      clear_expired_position_locks_for_principal(caller, correlation_id);

      var locked_position = get_position_lock(caller, swap_canister_id, position_id);

      switch(locked_position) {
          case (null) {
            let dex_value = switch (dex) {
              case null {
                return #Err({
                  message = "Dex parameter is required.";
                  transfer_error = null;
                });
              };
              case (?dex_value) {
                if (dex_value != dex_icpswap) {
                  return #Err({
                    message = "Dex not supported.";
                    transfer_error = null;
                  });
                };
                dex_value;
              };
            };

            let token0_value = switch (token0) {
              case null {
                return #Err({
                  message = "Token0 parameter is required.";
                  transfer_error = null;
                });
              };
              case (?token0_value) { token0_value; };
            };

            let token1_value = switch (token1) {
              case null {
                return #Err({
                  message = "Token1 parameter is required.";
                  transfer_error = null;
                });
              };
              case (?token1_value) { token1_value; };
            };

            let new_position_lock = add_new_position_lock_for_principal(
              caller, correlation_id, swap_canister_id, dex_value, position_id, expires_at, token0_value, token1_value);

            return #Ok(new_position_lock.lock_id);
          };
          case (?locked_position) {
            if (expires_at < locked_position.expiry) {
                return #Err({
                  message = "New expiry is before current expiry.";
                  transfer_error = null;
                });
            };
            
            update_position_lock_expiry(caller, correlation_id, swap_canister_id, locked_position, expires_at);
            let lock_id = locked_position.lock_id;
            return #Ok(lock_id);
          };
      };
  };

  public query func get_claimed_positions_for_principal(owner: Principal) : async [T.ClaimedPosition] {
    let position_ownerships = get_position_ownerships_impl(owner);
    var result = List.nil<T.ClaimedPosition>();

    for (position_ownership in position_ownerships.vals()) {

      let position_lock = get_position_lock(owner, position_ownership.0, position_ownership.1);

      let claimed_position : T.ClaimedPosition = {
        owner = owner;
        swap_canister_id = position_ownership.0;
        position_id = position_ownership.1;
        position_lock = position_lock;
      };

      result := List.push<T.ClaimedPosition>(claimed_position, result);
    };

    List.toArray<T.ClaimedPosition>(result);
  };

  private func pay_lock_fee_sneed(caller : Principal, correlation_id : Nat, lock_fee_sneed_e8s : Balance) : async TransferResult {

      if (lock_fee_sneed_e8s <= transaction_fee_sneed_e8s) {
        log_info(caller, correlation_id, "Sneed lock fee smaller than Sneed transaction fee, payment not required. Lock fee: " # debug_show(lock_fee_sneed_e8s));
        return #Ok(0); // If lock fee is not bigger than transaction fee, locking is free.
      };

      let subaccount = PrincipalToSubaccount(caller);
      let sneed_account_to : Account = { owner = sneed_defi_canister_id; subaccount = null; };

      let icrc1_sneed_ledger_canister = actor (Principal.toText(icrc1_sneed_ledger_canister_id)) : actor {
          icrc1_transfer(args : TransferArgs) : async T.TransferResult;
      };

      let sneed_fee_transfer_args : TransferArgs = {
          from_subaccount = ?Blob.fromArray(subaccount);
          to = sneed_account_to;
          amount = lock_fee_sneed_e8s - transaction_fee_sneed_e8s;
          fee = null;
          memo = null;
          created_at_time = null;
      };

      log_info(caller, correlation_id, "Transferring Sneed lock fee. Args: " # debug_show(sneed_fee_transfer_args));
      let result = await icrc1_sneed_ledger_canister.icrc1_transfer(sneed_fee_transfer_args);
      log_info(caller, correlation_id, "Transferred Sneed lock fee. Args: " # debug_show(sneed_fee_transfer_args) # ", Result: " # debug_show(result));

      return result;
  };

  private func add_new_lock_for_principal(principal: Principal, tokenType: TokenType, amount : Balance, expiry : Expiry): Lock {

    current_lock_id += 1;

    let lock : Lock = {
      lock_id = current_lock_id;
      amount = amount;
      expiry = expiry;
    };

    add_lock_for_principal(principal, tokenType, lock);

    lock;

  };

  private func add_new_position_lock_for_principal(
    principal: Principal,
    correlation_id : Nat,
    swap_canister_id: T.SwapCanisterId,
    dex: T.Dex,
    position_id: T.PositionId,
    expiry : T.Expiry,
    token0 : T.TokenType,
    token1 : T.TokenType): T.PositionLock {

    current_lock_id += 1;

    let position_lock : T.PositionLock = {
      dex = dex;
      lock_id = current_lock_id;
      position_id = position_id;
      expiry = expiry;
      token0 = token0;
      token1 = token1;
    };

    add_position_lock_for_principal(principal, swap_canister_id, position_lock);
    log_info(principal, correlation_id, "Created position lock for " # debug_show(swap_canister_id) # ": " # debug_show(position_lock));

    position_lock;
  };

  // this is a helper that is also used to populate the ephemeral state from the stable memory.
  private func add_lock_for_principal(principal: Principal, tokenType: TokenType, lock : Lock): () {

    let allLocks = switch (state.principal_token_locks.get(principal)) {
      case (?_tokenLocks) _tokenLocks;
      case _ HashMap.HashMap<TokenType, Locks>(10, Principal.equal, Principal.hash);
    };

    let locks = switch (allLocks.get(tokenType)) {
      case (?existingLocks) existingLocks;
      case _ List.nil<Lock>();
    };

    let newLocks = List.push<Lock>(lock, locks);
    allLocks.put(tokenType, newLocks);
    state.principal_token_locks.put(principal, allLocks);

  };

  // this is a helper that is also used to populate the ephemeral state from the stable memory.
  private func add_position_ownership_for_principal(principal: Principal, swap_canister_id: T.SwapCanisterId, position_id : T.PositionId): () {

    let all_positions = switch (state.principal_position_ownerships.get(principal)) {
      case (?_swapPositions) _swapPositions;
      case _ HashMap.HashMap<T.SwapCanisterId, T.Positions>(10, Principal.equal, Principal.hash);
    };

    let position_ids = switch (all_positions.get(swap_canister_id)) {
      case (?existingPositions) existingPositions;
      case _ List.nil<T.PositionId>();
    };

    if (not List.some<T.PositionId>(position_ids, func test_position_id { test_position_id == position_id; } )) {

      let new_position_ids = List.push<T.PositionId>(position_id, position_ids);
      all_positions.put(swap_canister_id, new_position_ids);
      state.principal_position_ownerships.put(principal, all_positions);

    };

  };

  // this is a helper that is also used to populate the ephemeral state from the stable memory.
  private func add_position_lock_for_principal(principal: Principal, swap_canister_id: T.SwapCanisterId, position_lock : T.PositionLock): () {

    let allPositionLocks = switch (state.principal_position_locks.get(principal)) {
      case (?_positionLocks) _positionLocks;
      case _ HashMap.HashMap<T.SwapCanisterId, T.PositionLocks>(10, Principal.equal, Principal.hash);
    };

    let positionLocks = switch (allPositionLocks.get(swap_canister_id)) {
      case (?existingPositionLocks) existingPositionLocks;
      case _ List.nil<T.PositionLock>();
    };

    let newPositionLocks = List.push<T.PositionLock>(position_lock, positionLocks);
    allPositionLocks.put(swap_canister_id, newPositionLocks);
    state.principal_position_locks.put(principal, allPositionLocks);
    
  };

  public shared ({ caller }) func clear_expired_locks(): async () {
    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Clearing expired token locks for " # debug_show(caller));
    clear_expired_locks_for_principal(caller, correlation_id);
  };

  // loop through all the locks for the principal and remove any that have expired
  private func clear_expired_locks_for_principal(principal: Principal, correlation_id : Nat): () {

    let allLocks = switch (state.principal_token_locks.get(principal)) {
      case (?_tokenLocks) _tokenLocks;
      case _ HashMap.HashMap<TokenType, Locks>(10, Principal.equal, Principal.hash);
    };

    var cnt_cleared : Nat = 0;
    let tokenIter : Iter.Iter<TokenType> = allLocks.keys();
    for (token in tokenIter) {
      let locks = switch (allLocks.get(token)) {
        case (?existingLocks) existingLocks;
        case _ List.nil<Lock>();
      };

      let now = NowAsNat64();
      let validLocks = List.filter<Lock>(locks, func (lock) {
        lock.expiry > now
      });

      cnt_cleared += List.size(locks) - List.size(validLocks);
      allLocks.put(token, validLocks);
    };

    state.principal_token_locks.put(principal, allLocks);
    log_info(principal, correlation_id, "Cleared " # debug_show(cnt_cleared) # " expired position locks for " # debug_show(principal));
  };

  public query ({ caller }) func has_expired_locks(): async Bool {

    let allLocks = switch (state.principal_token_locks.get(caller)) {
      case (?_tokenLocks) _tokenLocks;
      case _ HashMap.HashMap<TokenType, Locks>(10, Principal.equal, Principal.hash);
    };

    let tokenIter : Iter.Iter<TokenType> = allLocks.keys();
    for (token in tokenIter) {
      let locks = switch (allLocks.get(token)) {
        case (?existingLocks) existingLocks;
        case _ List.nil<Lock>();
      };

      let now = NowAsNat64();
      if (List.some<Lock>(locks, func test_lock { test_lock.expiry < now; })) {
        return true;
      };

    };

    return false;

  };

  /////////////
  // utils
  /////////////
/*  private func PrincipalToSubaccount(p : Principal) : [Nat8] {
    let a = Array.init<Nat8>(32, 0);
    let pa = Principal.toBlob(p);
    a[0] := Nat8.fromNat(pa.size());

    var pos = 1;
    for (x in pa.vals()) {
      a[pos] := x;
      pos := pos + 1;
    };

    Array.freeze(a);
  };
*/
  private func PrincipalToSubaccount(p : Principal) : [Nat8] {
    //let a = List.nil<Nat8>();
    let pa = Principal.toBlob(p);
    let size = pa.size();
    let arr_size = if (size < 31) { 31; } else { size; };
    let a = Array.init<Nat8>(arr_size + 1, 0);
    a[0] := Nat8.fromNat(size);

    var pos = 1;
    for (x in pa.vals()) {
      a[pos] := x;
      pos := pos + 1;
    };

    Array.freeze(a);
  };

  private func TimeAsNat64(time : Int) : Nat64 {
    Nat64.fromNat(Int.abs(time));
  };

  private func NowAsNat64() : Nat64 {
    TimeAsNat64(Time.now());
  };

  private func this_canister_id() : Principal {
    Principal.fromActor(this);
  };

  ////////////////
  // logging
  ////////////////
  public shared func get_info_id_range() : async ?(Nat, Nat) {
    CircularBuffer.CircularBufferLogic.get_id_range(info_log);
  };

  public shared func get_error_id_range() : async ?(Nat, Nat) {
    CircularBuffer.CircularBufferLogic.get_id_range(error_log);
  };

  public shared func get_info_entries(start: Nat, length: Nat) : async [?BufferEntry] {
    CircularBuffer.CircularBufferLogic.get_entries_by_id(info_log, start, length);
  };

  public shared func get_error_entries(start: Nat, length: Nat) : async [?BufferEntry] {
    CircularBuffer.CircularBufferLogic.get_entries_by_id(error_log, start, length);
  };

  private func log_info(caller : Principal, correlation_id : Nat, message: Text) {
    CircularBuffer.CircularBufferLogic.add(info_log, correlation_id, caller, message);
  };

  private func log_error(caller : Principal, correlation_id : Nat, message: Text) {
    CircularBuffer.CircularBufferLogic.add(error_log, correlation_id, caller, message);
  };

  private func get_next_correlation_id() : Nat {
    next_correlation_id += 1;
    next_correlation_id;
  };

  // // New function to get merged logs by timestamp
  // public shared func get_logs_in_timerange(startTime: Int, endTime: Int) : async [BufferEntry] {
  //     let errorLogs = CircularBuffer.CircularBufferLogic.get_entries_by_timerange(error_log, startTime, endTime);
  //     let infoLogs = CircularBuffer.CircularBufferLogic.get_entries_by_timerange(info_log, startTime, endTime);

  //     // Merge the two arrays
  //     let merged = errorLogs # infoLogs;

  //     // Sort by timestamp
  //     let sorted = Array.sort<BufferEntry>(merged, func (a: BufferEntry, b: BufferEntry) {
  //         a.timestamp < b.timestamp
  //     });

  //     sorted
  // };

  ////////////////
  // admin
  ////////////////
  public shared ({ caller }) func set_token_lock_fee_sneed_e8s(new_token_lock_fee_sneed_e8s: Nat) : async SetLockFeeResult {    
    if (caller != Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai")) {
      return #Err("Only the SNEED governance can set the lock fee");
    };

    // Lock fee lower than or equal to transaction fee means free locks!
    //if (new_token_lock_fee_sneed_e8s <= transaction_fee_sneed_e8s) {
    //  return #Err("Lock fee must be greater than SNEED transaction fee.");
    //};

    token_lock_fee_sneed_e8s := new_token_lock_fee_sneed_e8s;
    #Ok(token_lock_fee_sneed_e8s);
  };

  public shared ({ caller }) func set_max_lock_length_days(new_max_lock_length_days: Nat64) : async () {    
    if (caller != Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai")) {
      Debug.trap("Only the SNEED governance can set the max lock length.");
    };

    max_lock_length_ns := new_max_lock_length_days * day_ns;
  };

  ////////////////
  // upgrading
  ////////////////

  // save state to stable arrays
  system func preupgrade() {
    /// stableLocks
    stableLocks := get_fully_qualified_locks();

    /// stable_position_ownerships
    var list_stable_position_ownerships = List.nil<T.FullyQualifiedPosition>();
    let principal_iter : Iter.Iter<Principal> = state.principal_position_ownerships.keys();
    for (principal in principal_iter) {
      let allPositions = switch (state.principal_position_ownerships.get(principal)) {
        case (?_swapPositions) _swapPositions;
        case _ HashMap.HashMap<T.SwapCanisterId, T.Positions>(10, Principal.equal, Principal.hash);
      };

      let swapIter : Iter.Iter<TokenType> = allPositions.keys();
      for (swap in swapIter) {
        switch (allPositions.get(swap)) {
          case (?existingPositions) {
            let positionsIter : Iter.Iter<T.PositionId> = List.toIter<T.PositionId>(existingPositions);
            for (position_id in positionsIter) {
              list_stable_position_ownerships := List.push<T.FullyQualifiedPosition>((principal, swap, position_id), list_stable_position_ownerships);
            };
          };
          case _ {};
        };
      };
    };
    stable_position_ownerships := List.toArray<T.FullyQualifiedPosition>(list_stable_position_ownerships);

    /// stable_principal_swap_canisters
    var list_stable_principal_swap_canisters = List.nil<(Principal, [Principal])>();
    let principalSwapCanistersIter : Iter.Iter<Principal> = state.principal_swap_canisters.keys();
    for (principal in principalSwapCanistersIter) {
      let swapCanisters = switch (state.principal_swap_canisters.get(principal)) {
        case (?existingSwapCanisters) existingSwapCanisters;
        case _ List.nil<Principal>();
      };

      list_stable_principal_swap_canisters := List.push<(Principal, [Principal])>((principal, List.toArray<Principal>(swapCanisters)), list_stable_principal_swap_canisters);
    };
    stable_principal_swap_canisters := List.toArray<(Principal, [Principal])>(list_stable_principal_swap_canisters);

    /// stable_principal_ledger_canisters
    var list_stable_principal_ledger_canisters = List.nil<(Principal, [Principal])>();
    let principalLedgerCanistersIter : Iter.Iter<Principal> = state.principal_ledger_canisters.keys();
    for (principal in principalLedgerCanistersIter) {
      let ledgerCanisters = switch (state.principal_ledger_canisters.get(principal)) {
        case (?existingSwapCanisters) existingSwapCanisters;
        case _ List.nil<Principal>();
      };

      list_stable_principal_ledger_canisters := List.push<(Principal, [Principal])>((principal, List.toArray<Principal>(ledgerCanisters)), list_stable_principal_ledger_canisters);
    };
    stable_principal_ledger_canisters := List.toArray<(Principal, [Principal])>(list_stable_principal_ledger_canisters);

    /// stable_position_locks
    stable_position_locks := get_fully_qualified_position_locks();
  };

  private func get_fully_qualified_locks() : [T.FullyQualifiedLock] {
    var listStableLocks = List.nil<FullyQualifiedLock>();
    let principalIter : Iter.Iter<Principal> = state.principal_token_locks.keys();
    for (principal in principalIter) {
      let allLocks = switch (state.principal_token_locks.get(principal)) {
        case (?_tokenLocks) _tokenLocks;
        case _ HashMap.HashMap<TokenType, Locks>(10, Principal.equal, Principal.hash);
      };

      let tokenIter : Iter.Iter<TokenType> = allLocks.keys();
      for (token in tokenIter) {
        switch (allLocks.get(token)) {
          case (?existingLocks) {
            let locksIter : Iter.Iter<Lock> = List.toIter<Lock>(existingLocks);
            for (lock in locksIter) {
              listStableLocks := List.push<FullyQualifiedLock>((principal, token, lock), listStableLocks);
            };
          };
          case _ {};
        };
      };
    };

    List.toArray<T.FullyQualifiedLock>(listStableLocks);
  };


  private func get_fully_qualified_position_locks() : [T.FullyQualifiedPositionLock] {
    var list_stable_position_locks = List.nil<T.FullyQualifiedPositionLock>();
    let principalPositionLocksIter : Iter.Iter<Principal> = state.principal_position_locks.keys();
    for (principal in principalPositionLocksIter) {
      let allPositionLocks = switch (state.principal_position_locks.get(principal)) {
        case (?_positionLocks) _positionLocks;
        case _ HashMap.HashMap<T.SwapCanisterId, T.PositionLocks>(10, Principal.equal, Principal.hash);
      };

      let swapIter : Iter.Iter<T.SwapCanisterId> = allPositionLocks.keys();
      for (swap in swapIter) {
        switch (allPositionLocks.get(swap)) {
          case (?existingPositionLocks) {
            let positionLocksIter : Iter.Iter<T.PositionLock> = List.toIter<T.PositionLock>(existingPositionLocks);
            for (positionLock in positionLocksIter) {
              list_stable_position_locks := List.push<T.FullyQualifiedPositionLock>((principal, swap, positionLock), list_stable_position_locks);
            };
          };
          case _ {};
        };
      };
    };

    List.toArray<T.FullyQualifiedPositionLock>(list_stable_position_locks);
  };

  // initialize ephemeral state and empty stable arrays to save memory
  system func postupgrade() {

      /// stableLocks
      let stableIter : Iter.Iter<FullyQualifiedLock> = stableLocks.vals();      
      for (lock in stableIter) {
        add_lock_for_principal(lock.0, lock.1, lock.2);
      };
      stableLocks := [];

      /// stable_position_ownerships
      let stablePositionIter : Iter.Iter<T.FullyQualifiedPosition> = stable_position_ownerships.vals();
      for (pos in stablePositionIter) {
        add_position_ownership_for_principal(pos.0, pos.1, pos.2);
      };
      stable_position_ownerships := [];

      /// stable_principal_swap_canisters
      let stableSwapCanistersIter : Iter.Iter<(Principal, [Principal])> = stable_principal_swap_canisters.vals();
      for (principalSwapCanisters in stableSwapCanistersIter) {
        state.principal_swap_canisters.put(principalSwapCanisters.0, List.fromArray<Principal>(principalSwapCanisters.1));
      };
      stable_principal_swap_canisters := [];

      /// stable_principal_ledger_canisters
      let stableLedgerCanistersIter : Iter.Iter<(Principal, [Principal])> = stable_principal_ledger_canisters.vals();
      for (principalLedgerCanisters in stableLedgerCanistersIter) {
        state.principal_ledger_canisters.put(principalLedgerCanisters.0, List.fromArray<Principal>(principalLedgerCanisters.1));
      };
      stable_principal_ledger_canisters := [];

      /// stable_position_locks
      let stablePositionLocksIter : Iter.Iter<T.FullyQualifiedPositionLock> = stable_position_locks.vals();
      for (posLock in stablePositionLocksIter) {
        add_position_lock_for_principal(posLock.0, posLock.1, posLock.2);
      };
      stable_position_locks := [];
  };

  public query func get_token_position_locks(token_canister_id : T.TokenType) : async [T.FullyQualifiedPositionLock] {
    let all_position_locks = get_fully_qualified_position_locks();
    Array.filter<T.FullyQualifiedPositionLock>(all_position_locks, func (position_lock) {
      position_lock.2.token0 == token_canister_id or position_lock.2.token1 == token_canister_id
    });
  };
};