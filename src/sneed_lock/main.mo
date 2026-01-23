import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import List "mo:base/List";
import Iter "mo:base/Iter";
import Time "mo:base/Time";
import Nat "mo:base/Nat";
import Nat64 "mo:base/Nat64";
import Hash "mo:base/Hash";
import Int "mo:base/Int";
import Array "mo:base/Array";
import Nat8 "mo:base/Nat8";
import Blob "mo:base/Blob";
import Bool "mo:base/Bool";
import Debug "mo:base/Debug";
import Timer "mo:base/Timer";

import Map "mo:map/Map";
import { phash } "mo:map/Map";

import T "Types";

import CircularBuffer "CircularBuffer";
import PremiumClient "../PremiumClient";

// TODO: figure out when new instances of actors are created, whether or not that depends on the client at all, and how this effects the persistent state of the actor.
//       https://internetcomputer.org/docs/current/motoko/main/writing-motoko/actor-classes

shared (deployer) persistent actor class SneedLock() = this {

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
  type TransferPositionOwnershipResult = T.TransferPositionOwnershipResult;
  type TransferPositionOwnershipError = T.TransferPositionOwnershipError;
  type TransferTokenLockOwnershipResult = T.TransferTokenLockOwnershipResult;
  type TransferTokenLockOwnershipError = T.TransferTokenLockOwnershipError;
  type ClaimRequestId = T.ClaimRequestId;
  type ClaimRequestStatusV2 = T.ClaimRequestStatusV2;  // Old version for migration
  type ClaimRequestStatus = T.ClaimRequestStatus;
  type ClaimRequestV1 = T.ClaimRequestV1;  // Old version for migration
  type ClaimRequestV2 = T.ClaimRequestV2;  // Old version for migration
  type ClaimRequest = T.ClaimRequest;
  type ClaimAndWithdrawResult = T.ClaimAndWithdrawResult;
  type QueueProcessingState = T.QueueProcessingState;
  type StableClaimRequests = T.StableClaimRequests;
  type ArchivedTokenLock = T.ArchivedTokenLock;
  type ArchivedPositionLock = T.ArchivedPositionLock;

  // consts
  transient let second_ns : Nat64 = 1_000_000_000; // 1 second in nanoseconds
  transient let minute_ns : Nat64 = 60 * second_ns; // 1 minute in nanoseconds
  transient let hour_ns : Nat64 = 60 * minute_ns; // 1 hour in nanoseconds
  transient let day_ns : Nat64 = 24 * hour_ns; // 1 day in nanoseconds
  // dex consts
  transient let dex_icpswap : T.Dex = 1;
  // claim queue consts
  transient let max_requests_per_batch : Nat = 10;
  transient let claim_request_timeout_ns : Nat64 = 30 * minute_ns; // 30 minutes
  transient let batch_pause_duration_ns : Nat64 = 10 * minute_ns; // 10 minutes
  transient let claim_request_cooldown_ns : Nat64 = 5 * minute_ns; // 5 minutes cooldown between retry attempts
  transient let max_claim_retry_attempts : Nat = 5; // Max retries before moving to failed buffer
  transient let max_consecutive_empty_cycles : Nat = 3; // Pause after N empty processing cycles

  // stable memory
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
  
  // Claim queue stable state
  stable var stable_claim_requests : StableClaimRequests = []; // Active requests (pending/processing)
  stable var completed_claim_requests : StableClaimRequests = []; // Completed requests with structured data
  stable var failed_claim_requests : StableClaimRequests = []; // Failed requests with structured data (pre-claim failures)
  stable var next_claim_request_id : Nat = 0;
  stable var claim_queue_processing_state : QueueProcessingState = #Active;
  stable var claim_requests_processed_in_batch : Nat = 0;
  stable var enforce_zero_balance_before_claim : Bool = true; // Safety check: balance must be 0 before claiming
  stable var last_timer_execution_time : ?T.Timestamp = null; // When timer last executed
  stable var last_timer_execution_correlation_id : ?Nat = null; // Correlation ID of last execution
  stable var consecutive_empty_processing_cycles : Nat = 0; // Circuit breaker: track empty processing cycles
  stable var is_processing_claim_queue : Bool = false; // Semaphore: prevents concurrent execution of process_claim_queue
 
  // shouldn't be stable but is for legacy reasons. 
  stable var claim_processing_timer_id : ?Nat = null;
  
  // Admin management
  stable var admin_list : [Principal] = []; // List of additional admin principals
  
  // Archive storage - expired locks kept for history
  stable var archived_token_locks_stable : T.StableArchivedTokenLocks = [];
  stable var archived_position_locks_stable : T.StableArchivedPositionLocks = [];
  
  // Premium integration - ICP pricing for locks
  stable var sneed_premium_canister_id : ?Principal = null;
  stable var premium_cache = PremiumClient.emptyCache();
  
  // ICP lock fee settings (in e8s - 1 ICP = 100_000_000 e8s)
  stable var token_lock_fee_icp_e8s : Nat64 = 0; // Default 0 - free for non-premium
  stable var position_lock_fee_icp_e8s : Nat64 = 0; // Default 0 - free for non-premium
  stable var premium_token_lock_fee_icp_e8s : Nat64 = 0; // Default 0 - free for premium
  stable var premium_position_lock_fee_icp_e8s : Nat64 = 0; // Default 0 - free for premium
  
  // ICP fee recipient account (where lock fees are sent)
  stable var icp_fee_recipient_principal : ?Principal = null; // Default: this canister
  stable var icp_fee_recipient_subaccount : ?Blob = null; // Default: null (main account)
  
  // ICP fee collection stats
  stable var total_token_lock_fees_collected_e8s : Nat = 0;
  stable var total_position_lock_fees_collected_e8s : Nat = 0;
  
  // Payment log stable storage
  stable var payment_log : [T.PaymentLogEntry] = [];
  stable var next_payment_log_id : Nat = 0;
  
  // Ephemeral timer state (not stable - timer IDs don't persist across upgrades)
  transient var next_scheduled_timer_time : ?T.Timestamp = null;

  transient let admin = Principal.fromText("d7zib-qo5mr-qzmpb-dtyof-l7yiu-pu52k-wk7ng-cbm3n-ffmys-crbkz-nae");
  transient let sneed_governance = Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai");

  transient let icrc1_sneed_ledger_canister_id = Principal.fromText("hvgxa-wqaaa-aaaaq-aacia-cai");
  
  // ICP Ledger for lock creation fees
  transient let ICP_LEDGER_ID : Text = "ryjl3-tyaaa-aaaaa-aaaba-cai";
  transient let ICP_FEE : Nat64 = 10_000; // 0.0001 ICP

  // ephemeral state
  transient let state : State = object { 
    // initialize as empty here, see postupgrade for how to populate from stable memory
    public let principal_token_locks: PrincipalTokenLockMap = HashMap.HashMap<Principal, TokenLockMap>(100, Principal.equal, Principal.hash);
    public let principal_position_locks : HashMap.HashMap<Principal, T.PositionLockMap> = HashMap.HashMap<Principal, T.PositionLockMap>(100, Principal.equal, Principal.hash);
    public let principal_position_ownerships: T.PrincipalSwapPositionsMap = HashMap.HashMap<Principal, T.SwapPositionsMap>(100, Principal.equal, Principal.hash);
  };

  // Archive HashMaps (ephemeral, rebuilt from stable storage on upgrade)
  transient let archived_token_locks = HashMap.HashMap<T.LockId, ArchivedTokenLock>(1000, Nat.equal, Hash.hash);
  transient let archived_position_locks = HashMap.HashMap<T.LockId, ArchivedPositionLock>(1000, Nat.equal, Hash.hash);

  public query func get_all_token_locks() : async [T.FullyQualifiedLock] {
    get_fully_qualified_locks();
  };

  // Get only active (non-expired) token locks
  public query func get_active_token_locks() : async [T.FullyQualifiedLock] {
    let now = Nat64.fromIntWrap(Time.now());
    let all_locks = get_fully_qualified_locks();
    Array.filter<T.FullyQualifiedLock>(all_locks, func (lock) { lock.2.expiry > now; });
  };

  // Get only expired token locks
  public query func get_expired_token_locks() : async [T.FullyQualifiedLock] {
    let now = Nat64.fromIntWrap(Time.now());
    let all_locks = get_fully_qualified_locks();
    Array.filter<T.FullyQualifiedLock>(all_locks, func (lock) { lock.2.expiry <= now; });
  };

  public query func get_ledger_token_locks(ledger_canister_id : T.TokenType) : async [T.FullyQualifiedLock] {
    let all_locks = get_fully_qualified_locks();
    Array.filter<T.FullyQualifiedLock>(all_locks, func (lock) { lock.1 == ledger_canister_id; });
  };

  public query func get_all_position_locks() : async [T.FullyQualifiedPositionLock] {
    get_fully_qualified_position_locks();
  };

  // Get only active (non-expired) position locks
  public query func get_active_position_locks() : async [T.FullyQualifiedPositionLock] {
    let now = Nat64.fromIntWrap(Time.now());
    let all_position_locks = get_fully_qualified_position_locks();
    Array.filter<T.FullyQualifiedPositionLock>(all_position_locks, func (lock) { lock.2.expiry > now; });
  };

  // Get only expired position locks
  public query func get_expired_position_locks() : async [T.FullyQualifiedPositionLock] {
    let now = Nat64.fromIntWrap(Time.now());
    let all_position_locks = get_fully_qualified_position_locks();
    Array.filter<T.FullyQualifiedPositionLock>(all_position_locks, func (lock) { lock.2.expiry <= now; });
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

  // Public query to get token lock by lock_id (checks archive first, then active locks)
  public query func get_token_lock_by_id(lock_id : T.LockId) : async ?T.FullyQualifiedLock {
    // First check the archive (O(1) HashMap lookup)
    switch (archived_token_locks.get(lock_id)) {
      case (?archived) {
        // Found in archive - return the fully qualified lock
        return ?(archived.owner, archived.token_type, archived.lock);
      };
      case null {
        // Not in archive, search active locks (O(n))
        for ((principal, token_locks_map) in state.principal_token_locks.entries()) {
          for ((token_type, locks_list) in token_locks_map.entries()) {
            let locks_iter = List.toIter(locks_list);
            for (lock in locks_iter) {
              if (lock.lock_id == lock_id) {
                return ?(principal, token_type, lock);
              };
            };
          };
        };
        // Not found anywhere
        return null;
      };
    };
  };

  // Public query to get position lock by lock_id (checks archive first, then active locks)
  public query func get_position_lock_by_id(lock_id : T.LockId) : async ?T.FullyQualifiedPositionLock {
    // First check the archive (O(1) HashMap lookup)
    switch (archived_position_locks.get(lock_id)) {
      case (?archived) {
        // Found in archive - return the fully qualified position lock
        return ?(archived.owner, archived.swap_canister_id, archived.lock);
      };
      case null {
        // Not in archive, search active locks (O(n))
        for ((principal, position_locks_map) in state.principal_position_locks.entries()) {
          for ((swap_canister_id, position_locks_list) in position_locks_map.entries()) {
            let locks_iter = List.toIter(position_locks_list);
            for (position_lock in locks_iter) {
              if (position_lock.lock_id == lock_id) {
                return ?(principal, swap_canister_id, position_lock);
              };
            };
          };
        };
        // Not found anywhere
        return null;
      };
    };
  };

  // Private helper to determine lock type by lock_id
  private func get_lock_type_impl(lock_id : T.LockId) : ?T.LockType {
    // Check token lock archive first (O(1))
    switch (archived_token_locks.get(lock_id)) {
      case (?_) { return ?#TokenLock; };
      case null {};
    };

    // Check position lock archive (O(1))
    switch (archived_position_locks.get(lock_id)) {
      case (?_) { return ?#PositionLock; };
      case null {};
    };

    // Search active token locks (O(n))
    for ((principal, token_locks_map) in state.principal_token_locks.entries()) {
      for ((token_type, locks_list) in token_locks_map.entries()) {
        let locks_iter = List.toIter(locks_list);
        for (lock in locks_iter) {
          if (lock.lock_id == lock_id) {
            return ?#TokenLock;
          };
        };
      };
    };

    // Search active position locks (O(n))
    for ((principal, position_locks_map) in state.principal_position_locks.entries()) {
      for ((swap_canister_id, position_locks_list) in position_locks_map.entries()) {
        let locks_iter = List.toIter(position_locks_list);
        for (position_lock in locks_iter) {
          if (position_lock.lock_id == lock_id) {
            return ?#PositionLock;
          };
        };
      };
    };

    // Not found anywhere
    null;
  };

  // Public query to get lock type by lock_id
  public query func get_lock_type(lock_id : T.LockId) : async ?T.LockType {
    get_lock_type_impl(lock_id);
  };

  // Public query to get any lock by lock_id (returns either token lock or position lock)
  public query func get_lock_by_id(lock_id : T.LockId) : async ?T.LockInfo {
    // Check token lock archive first (O(1))
    switch (archived_token_locks.get(lock_id)) {
      case (?archived) {
        return ?#TokenLock(archived.owner, archived.token_type, archived.lock);
      };
      case null {};
    };

    // Check position lock archive (O(1))
    switch (archived_position_locks.get(lock_id)) {
      case (?archived) {
        return ?#PositionLock(archived.owner, archived.swap_canister_id, archived.lock);
      };
      case null {};
    };

    // Search active token locks (O(n))
    for ((principal, token_locks_map) in state.principal_token_locks.entries()) {
      for ((token_type, locks_list) in token_locks_map.entries()) {
        let locks_iter = List.toIter(locks_list);
        for (lock in locks_iter) {
          if (lock.lock_id == lock_id) {
            return ?#TokenLock(principal, token_type, lock);
          };
        };
      };
    };

    // Search active position locks (O(n))
    for ((principal, position_locks_map) in state.principal_position_locks.entries()) {
      for ((swap_canister_id, position_locks_list) in position_locks_map.entries()) {
        let locks_iter = List.toIter(position_locks_list);
        for (position_lock in locks_iter) {
          if (position_lock.lock_id == lock_id) {
            return ?#PositionLock(principal, swap_canister_id, position_lock);
          };
        };
      };
    };

    // Not found anywhere
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

    var cnt_archived : Nat = 0;
    let swapIter : Iter.Iter<T.SwapCanisterId> = allPositionLocks.keys();
    for (swap in swapIter) {
      let positionLocks = switch (allPositionLocks.get(swap)) {
        case (?existingPositionLocks) existingPositionLocks;
        case _ List.nil<T.PositionLock>();
      };

      let now = NowAsNat64();
      var expired_locks = List.nil<T.PositionLock>();
      var valid_locks = List.nil<T.PositionLock>();
      
      // Separate expired and valid locks
      let locks_iter = List.toIter(positionLocks);
      for (lock in locks_iter) {
        if (lock.expiry <= now) {
          expired_locks := List.push(lock, expired_locks);
        } else {
          valid_locks := List.push(lock, valid_locks);
        };
      };

      // Archive expired locks
      let expired_iter = List.toIter(expired_locks);
      for (lock in expired_iter) {
        let archived_lock : ArchivedPositionLock = {
          lock = lock;
          owner = principal;
          swap_canister_id = swap;
          archived_at = now;
        };
        archived_position_locks.put(lock.lock_id, archived_lock);
        cnt_archived += 1;
      };

      allPositionLocks.put(swap, valid_locks);
    };

    state.principal_position_locks.put(principal, allPositionLocks);
    log_info(principal, correlation_id, "Archived " # debug_show(cnt_archived) # " expired position locks for " # debug_show(principal));
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

  private func remove_position_lock_from_principal(principal : Principal, swap_canister_id : T.SwapCanisterId, position_id : T.PositionId) : ?T.PositionLock {
    let allPositionLocks = switch (state.principal_position_locks.get(principal)) {
      case (?_positionLocks) _positionLocks;
      case _ HashMap.HashMap<T.SwapCanisterId, T.PositionLocks>(10, Principal.equal, Principal.hash);
    };

    let positionLocks = switch (allPositionLocks.get(swap_canister_id)) {
      case (?existingPositionLocks) existingPositionLocks;
      case _ List.nil<T.PositionLock>();
    };

    // Find the lock for this position
    var foundLock : ?T.PositionLock = null;
    let positionLocksIter : Iter.Iter<T.PositionLock> = List.toIter<T.PositionLock>(positionLocks);
    for (positionLock in positionLocksIter) {
      if (positionLock.position_id == position_id) {
        foundLock := ?positionLock;
      };
    };

    // Remove the lock from the list
    switch (foundLock) {
      case (?lock) {
        let filteredPositionLocks = List.filter<T.PositionLock>(positionLocks, func (p) { p.position_id != position_id; });
        allPositionLocks.put(swap_canister_id, filteredPositionLocks);
        state.principal_position_locks.put(principal, allPositionLocks);
      };
      case null {};
    };

    foundLock;
  };

  public shared ({ caller }) func transfer_position_ownership(to_principal : Principal, swap_canister_id : T.SwapCanisterId, position_id : T.PositionId) : async TransferPositionOwnershipResult {
    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Transferring position ownership from " # debug_show(caller) # " to " # debug_show(to_principal) # " for position " # debug_show(position_id) # " on swap canister " # debug_show(swap_canister_id));

    // Verify that the caller is the current owner
    if (not has_claimed_position_impl(caller, swap_canister_id, position_id)) {
      let error = #Err({
        message = "Caller is not the owner of position " # debug_show(position_id) # " on swap canister " # debug_show(swap_canister_id);
      });
      log_error(caller, correlation_id, debug_show(error));
      return error;
    };

    // Transfer the position ownership
    clear_position_claim(caller, swap_canister_id, position_id);
    add_position_ownership_for_principal(to_principal, swap_canister_id, position_id);
    log_info(caller, correlation_id, "Transferred position ownership from " # debug_show(caller) # " to " # debug_show(to_principal) # " for position " # debug_show(position_id));

    // If there's a lock on this position, transfer it to the new owner
    let removed_lock = remove_position_lock_from_principal(caller, swap_canister_id, position_id);
    switch (removed_lock) {
      case (?lock) {
        add_position_lock_for_principal(to_principal, swap_canister_id, lock);
        log_info(caller, correlation_id, "Transferred position lock from " # debug_show(caller) # " to " # debug_show(to_principal) # " for position " # debug_show(position_id) # ": " # debug_show(lock));
      };
      case null {
        log_info(caller, correlation_id, "No position lock to transfer for position " # debug_show(position_id));
      };
    };

    log_info(caller, correlation_id, "Successfully transferred position ownership from " # debug_show(caller) # " to " # debug_show(to_principal) # " for position " # debug_show(position_id));
    #Ok;
  };

  private func find_token_lock(principal : Principal, token_type : T.TokenType, lock_id : T.LockId) : ?Lock {
    let allLocks = switch (state.principal_token_locks.get(principal)) {
      case (?_tokenLocks) _tokenLocks;
      case _ HashMap.HashMap<TokenType, Locks>(10, Principal.equal, Principal.hash);
    };

    let locks = switch (allLocks.get(token_type)) {
      case (?existingLocks) existingLocks;
      case _ List.nil<Lock>();
    };

    // Find the lock with the specified lock_id
    var foundLock : ?Lock = null;
    let locksIter : Iter.Iter<Lock> = List.toIter<Lock>(locks);
    for (lock in locksIter) {
      if (lock.lock_id == lock_id) {
        foundLock := ?lock;
      };
    };

    foundLock;
  };

  private func remove_token_lock(principal : Principal, token_type : T.TokenType, lock_id : T.LockId) : () {
    let allLocks = switch (state.principal_token_locks.get(principal)) {
      case (?_tokenLocks) _tokenLocks;
      case _ HashMap.HashMap<TokenType, Locks>(10, Principal.equal, Principal.hash);
    };

    let locks = switch (allLocks.get(token_type)) {
      case (?existingLocks) existingLocks;
      case _ List.nil<Lock>();
    };

    let filteredLocks = List.filter<Lock>(locks, func (l) { l.lock_id != lock_id; });
    allLocks.put(token_type, filteredLocks);
    state.principal_token_locks.put(principal, allLocks);
  };

  public shared ({ caller }) func transfer_token_lock_ownership(
    to_principal : Principal,
    token_type : T.TokenType,
    lock_id : T.LockId
  ) : async TransferTokenLockOwnershipResult {
    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Transferring token lock " # debug_show(lock_id) # " from " # debug_show(caller) # " to " # debug_show(to_principal) # " for token " # debug_show(token_type));

    // Find the lock (without removing it yet)
    let lock = find_token_lock(caller, token_type, lock_id);

    switch (lock) {
      case null {
        let error = #Err({
          message = "Lock " # debug_show(lock_id) # " not found for caller " # debug_show(caller) # " and token " # debug_show(token_type);
          transfer_error = null;
        });
        log_error(caller, correlation_id, debug_show(error));
        return error;
      };
      case (?found_lock) {
        // Verify the lock hasn't expired
        let now = NowAsNat64();
        if (found_lock.expiry <= now) {
          let error = #Err({
            message = "Lock " # debug_show(lock_id) # " has expired. Expiry: " # debug_show(found_lock.expiry) # ", Now: " # debug_show(now);
            transfer_error = null;
          });
          log_error(caller, correlation_id, debug_show(error));
          return error;
        };

        // Clean up any expired locks first
        clear_expired_locks_for_principal(caller, correlation_id);

        // Verify the caller's subaccount has the locked balance BEFORE making any mutations
        let icrc1_ledger_canister = actor (Principal.toText(token_type)) : actor {
          icrc1_transfer(args : TransferArgs) : async T.TransferResult;
          icrc1_balance_of(account : Account) : async Nat;
          icrc1_fee() : async T.Balance;
        };

        let caller_subaccount = PrincipalToSubaccount(caller);
        let caller_account : T.Account = { owner = this_canister_id(); subaccount = ?Blob.fromArray(caller_subaccount); };
        let caller_balance = await icrc1_ledger_canister.icrc1_balance_of(caller_account);

        // Get the transfer fee
        let token_fee = await icrc1_ledger_canister.icrc1_fee();

        // Calculate total locked balance for this token (this includes the lock being transferred)
        let sum_locked = get_summed_locks_from_principal_and_token(caller, token_type);

        // Check 1: Verify the locked balance is >= the amount being transferred
        // This ensures the lock is legitimate and they actually have this amount locked
        if (sum_locked < found_lock.amount) {
          let error = #Err({
            message = "Inconsistent lock state. Total locked: " # Nat.toText(sum_locked) # ", Lock amount: " # Nat.toText(found_lock.amount);
            transfer_error = null;
          });
          log_error(caller, correlation_id, debug_show(error));
          return error;
        };

        // Check 2: Verify the free (unlocked) balance is >= one tx fee
        // Free balance = total balance - total locked
        // We need: caller_balance - sum_locked >= token_fee
        // Which means: caller_balance >= sum_locked + token_fee
        if (caller_balance < sum_locked + token_fee) {
          let free_balance = if (caller_balance >= sum_locked) { caller_balance - sum_locked } else { 0 };
          let error = #Err({
            message = "Insufficient unlocked balance to cover transfer fee. Free balance: " # Nat.toText(free_balance) # ", Required fee: " # Nat.toText(token_fee) # " (Total: " # Nat.toText(caller_balance) # ", Locked: " # Nat.toText(sum_locked) # ")";
            transfer_error = null;
          });
          log_error(caller, correlation_id, debug_show(error));
          return error;
        };

        // All validations passed - now remove the lock from the caller
        remove_token_lock(caller, token_type, lock_id);
        log_info(caller, correlation_id, "Removed lock " # debug_show(lock_id) # " from " # debug_show(caller));

        // Transfer the tokens from caller's subaccount to recipient's subaccount
        let recipient_subaccount = PrincipalToSubaccount(to_principal);
        let recipient_account : T.Account = { owner = this_canister_id(); subaccount = ?Blob.fromArray(recipient_subaccount); };

        let transfer_args : TransferArgs = {
          from_subaccount = ?Blob.fromArray(caller_subaccount);
          to = recipient_account;
          amount = found_lock.amount;
          fee = null;
          memo = null;
          created_at_time = null;
        };

        let transfer_result = await icrc1_ledger_canister.icrc1_transfer(transfer_args);

        switch (transfer_result) {
          case (#Err(transfer_error)) {
            // Re-add the lock back to caller since transfer failed
            add_lock_for_principal(caller, token_type, found_lock);
            let error = #Err({
              message = "Failed to transfer tokens from caller's subaccount to recipient's subaccount";
              transfer_error = ?transfer_error;
            });
            log_error(caller, correlation_id, "Token transfer failed: " # debug_show(error));
            return error;
          };
          case (#Ok(tx_index)) {
            log_info(caller, correlation_id, "Transferred " # Nat.toText(found_lock.amount) # " tokens from " # debug_show(caller) # " to " # debug_show(to_principal) # " with tx_index: " # debug_show(tx_index));

            // Add the lock to the recipient
            add_lock_for_principal(to_principal, token_type, found_lock);
            log_info(caller, correlation_id, "Transferred lock " # debug_show(lock_id) # " from " # debug_show(caller) # " to " # debug_show(to_principal) # ": " # debug_show(found_lock));

            log_info(caller, correlation_id, "Successfully transferred token lock ownership from " # debug_show(caller) # " to " # debug_show(to_principal) # " for lock " # debug_show(lock_id));
            #Ok;
          };
        };
      };
    };
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

      // Sneed DAO token cannot be locked
      
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

      // Step 1: Verify ICP funds are available (balance check only)
      let icp_verify_result = await* verifyLockFeeIcp(caller, correlation_id, false);
      let fee_to_charge = switch (icp_verify_result) {
          case (#Err(e)) {
            let create_lock_error : CreateLockError = {
              message = "ICP payment verification failed: " # e;
              transfer_error = null;
            };
            let error = #Err(create_lock_error);
            log_error(caller, correlation_id, debug_show(error));
            return error;
          };
          case (#Ok(fee)) { fee };
      };

      // Step 2: Create the lock
      let lock = add_new_lock_for_principal(caller, icrc1_ledger_canister_id, amount, expires_at);
      log_info(caller, correlation_id, "Created lock:" # debug_show(lock));

      // Step 3: Charge the ICP fee (only after lock is successfully created)
      if (fee_to_charge > 0) {
        let charge_result = await chargeLockFeeIcp(caller, correlation_id, fee_to_charge, #TokenLock);
        switch (charge_result) {
          case (#Err(e)) {
            // Lock was created but fee charge failed - log this but don't fail the lock
            log_error(caller, correlation_id, "Warning: Lock created but ICP fee charge failed: " # e);
          };
          case (#Ok(_)) {};
        };
      };

      return #Ok(lock.lock_id);
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

      clear_expired_position_locks_for_principal(caller, correlation_id);

      var locked_position = get_position_lock(caller, swap_canister_id, position_id);

      switch(locked_position) {
          case (null) {
            // First validate all required parameters before collecting payment
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

            // Step 1: Verify ICP funds are available (balance check only)
            let icp_verify_result = await* verifyLockFeeIcp(caller, correlation_id, true);
            let fee_to_charge = switch (icp_verify_result) {
                case (#Err(e)) {
                  return #Err({
                    message = "ICP payment verification failed: " # e;
                    transfer_error = null;
                  });
                };
                case (#Ok(fee)) { fee };
            };

            // Step 2: Create the position lock
            let new_position_lock = add_new_position_lock_for_principal(
              caller, correlation_id, swap_canister_id, dex_value, position_id, expires_at, token0_value, token1_value);

            // Step 3: Charge the ICP fee (only after lock is successfully created)
            if (fee_to_charge > 0) {
              let charge_result = await chargeLockFeeIcp(caller, correlation_id, fee_to_charge, #PositionLock);
              switch (charge_result) {
                case (#Err(e)) {
                  // Lock was created but fee charge failed - log this but don't fail the lock
                  log_error(caller, correlation_id, "Warning: Position lock created but ICP fee charge failed: " # e);
                };
                case (#Ok(_)) {};
              };
            };

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

  // loop through all the locks for the principal and archive any that have expired
  private func clear_expired_locks_for_principal(principal: Principal, correlation_id : Nat): () {

    let allLocks = switch (state.principal_token_locks.get(principal)) {
      case (?_tokenLocks) _tokenLocks;
      case _ HashMap.HashMap<TokenType, Locks>(10, Principal.equal, Principal.hash);
    };

    var cnt_archived : Nat = 0;
    let tokenIter : Iter.Iter<TokenType> = allLocks.keys();
    for (token in tokenIter) {
      let locks = switch (allLocks.get(token)) {
        case (?existingLocks) existingLocks;
        case _ List.nil<Lock>();
      };

      let now = NowAsNat64();
      var expired_locks = List.nil<Lock>();
      var valid_locks = List.nil<Lock>();
      
      // Separate expired and valid locks
      let locks_iter = List.toIter(locks);
      for (lock in locks_iter) {
        if (lock.expiry <= now) {
          expired_locks := List.push(lock, expired_locks);
        } else {
          valid_locks := List.push(lock, valid_locks);
        };
      };

      // Archive expired locks
      let expired_iter = List.toIter(expired_locks);
      for (lock in expired_iter) {
        let archived_lock : ArchivedTokenLock = {
          lock = lock;
          owner = principal;
          token_type = token;
          archived_at = now;
        };
        archived_token_locks.put(lock.lock_id, archived_lock);
        cnt_archived += 1;
      };

      allLocks.put(token, valid_locks);
    };

    state.principal_token_locks.put(principal, allLocks);
    log_info(principal, correlation_id, "Archived " # debug_show(cnt_archived) # " expired token locks for " # debug_show(principal));
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
  
  // Helper function to check if a principal has admin privileges
  private func isAdmin(principal : Principal) : Bool {
    // Check if principal is a controller
    if (Principal.isController(principal)) {
      return true;
    };
    
    // Check if principal is the hardcoded admin
    if (Principal.equal(principal, admin)) {
      return true;
    };
    
    // Check if principal is sneed_governance
    if (Principal.equal(principal, sneed_governance)) {
      return true;
    };
    
    // Check if principal is in the admin list
    for (admin_principal in admin_list.vals()) {
      if (Principal.equal(principal, admin_principal)) {
        return true;
      };
    };
    
    return false;
  };
  
  // Admin: Add a principal to the admin list
  public shared ({ caller }) func admin_add_admin(new_admin : Principal) : async {
    #Ok : Text;
    #Err : Text;
  } {
    if (not isAdmin(caller)) {
      return #Err("Only admins can add new admins");
    };
    
    // Check if already in the list
    for (admin_principal in admin_list.vals()) {
      if (Principal.equal(admin_principal, new_admin)) {
        return #Err("Principal is already an admin");
      };
    };
    
    // Add to the list
    admin_list := Array.append(admin_list, [new_admin]);
    
    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Added new admin: " # debug_show(new_admin));
    
    #Ok("Admin added successfully");
  };
  
  // Admin: Remove a principal from the admin list
  public shared ({ caller }) func admin_remove_admin(admin_to_remove : Principal) : async {
    #Ok : Text;
    #Err : Text;
  } {
    if (not isAdmin(caller)) {
      return #Err("Only admins can remove admins");
    };
    
    // Check if the admin exists in the list
    let found = Array.find<Principal>(admin_list, func (p) {
      Principal.equal(p, admin_to_remove)
    });
    
    if (found == null) {
      return #Err("Principal is not in the admin list");
    };
    
    // Remove from the list
    let before_count = admin_list.size();
    admin_list := Array.filter<Principal>(admin_list, func (p) {
      not Principal.equal(p, admin_to_remove)
    });
    
    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Removed admin: " # debug_show(admin_to_remove));
    
    #Ok("Admin removed successfully");
  };
  
  // Query: Get the list of additional admins
  public query func get_admin_list() : async [Principal] {
    admin_list;
  };
  
  //
  public shared ({ caller }) func admin_return_token(icrc1_ledger_canister_id: Principal, amount: Nat, user_principal : Principal) : async TransferResult {
    if (not isAdmin(caller)) {
      Debug.trap("Only the SNEED governance or Admin can return tokens.");
    };

    let icrc1_ledger_canister = actor (Principal.toText(icrc1_ledger_canister_id)) : actor {
      icrc1_transfer(args : TransferArgs) : async T.TransferResult;
    };

    let subaccount = PrincipalToSubaccount(user_principal);
    let user_account_to : Account = { owner = user_principal; subaccount = null; };

    let sneed_fee_transfer_args : TransferArgs = {
      from_subaccount = ?Blob.fromArray(subaccount);
      to = user_account_to;
      amount = amount;
      fee = null;
      memo = null;
      created_at_time = null;
    };  

    let result = await icrc1_ledger_canister.icrc1_transfer(sneed_fee_transfer_args);
    //log_info(caller, correlation_id, "Transferred Sneed lock fee. Args: " # debug_show(sneed_fee_transfer_args) # ", Result: " # debug_show(result));

    return result;
  };

  public shared ({ caller }) func admin_return_token_from_failed_request(icrc1_ledger_canister_id: Principal, amount: Nat, recipient_principal : Principal) : async TransferResult {
    if (not isAdmin(caller)) {
      Debug.trap("Only the SNEED governance or Admin can return tokens.");
    };

    let icrc1_ledger_canister = actor (Principal.toText(icrc1_ledger_canister_id)) : actor {
      icrc1_transfer(args : TransferArgs) : async T.TransferResult;
    };

    let user_account_to : Account = { owner = recipient_principal; subaccount = null; };

    let sneed_fee_transfer_args : TransferArgs = {
      from_subaccount = null;
      to = user_account_to;
      amount = amount;
      fee = null;
      memo = null;
      created_at_time = null;
    };  

    let result = await icrc1_ledger_canister.icrc1_transfer(sneed_fee_transfer_args);
    //log_info(caller, correlation_id, "Transferred Sneed lock fee. Args: " # debug_show(sneed_fee_transfer_args) # ", Result: " # debug_show(result));

    return result;
  };


  public shared ({ caller }) func set_max_lock_length_days(new_max_lock_length_days: Nat64) : async () {    
    if (not isAdmin(caller)) {
      Debug.trap("Only the SNEED governance can set the max lock length.");
    };

    max_lock_length_ns := new_max_lock_length_days * day_ns;
  };

  ////////////////
  // Premium & ICP Lock Fee System
  ////////////////

  // Generate payment subaccount for a user
  // Structure: principal bytes + 'P' marker byte at position 23
  private func userPaymentSubaccount(user : Principal) : Blob {
    let a = Array.init<Nat8>(32, 0);
    let pa = Principal.toBlob(user);
    let size = pa.size();
    
    // Byte 0: principal length
    a[0] := Nat8.fromNat(size);
    
    // Bytes 1-N: principal bytes
    var pos = 1;
    for (x in Blob.toArray(pa).vals()) {
      a[pos] := x;
      pos += 1;
    };
    
    // Byte 23: type marker for payment
    a[23] := 0x50; // 'P' for Payment
    
    Blob.fromArray(Array.freeze(a));
  };

  // Admin: Set Sneed Premium canister ID
  public shared ({ caller }) func admin_set_sneed_premium_canister_id(canister_id : ?Principal) : async { #Ok : Text; #Err : Text } {
    if (not isAdmin(caller)) {
      return #Err("Only admins can set the premium canister ID");
    };
    sneed_premium_canister_id := canister_id;
    switch (canister_id) {
      case (?id) { #Ok("Sneed Premium canister ID set to: " # Principal.toText(id)) };
      case null { #Ok("Sneed Premium canister ID cleared") };
    };
  };

  // Admin: Set ICP lock fees
  public shared ({ caller }) func admin_set_lock_fees_icp(
    token_lock_fee : ?Nat64,
    position_lock_fee : ?Nat64,
    premium_token_lock_fee : ?Nat64,
    premium_position_lock_fee : ?Nat64
  ) : async { #Ok : Text; #Err : Text } {
    if (not isAdmin(caller)) {
      return #Err("Only admins can set lock fees");
    };
    
    switch (token_lock_fee) {
      case (?fee) { token_lock_fee_icp_e8s := fee };
      case null {};
    };
    switch (position_lock_fee) {
      case (?fee) { position_lock_fee_icp_e8s := fee };
      case null {};
    };
    switch (premium_token_lock_fee) {
      case (?fee) { premium_token_lock_fee_icp_e8s := fee };
      case null {};
    };
    switch (premium_position_lock_fee) {
      case (?fee) { premium_position_lock_fee_icp_e8s := fee };
      case null {};
    };
    
    #Ok("Lock fees updated successfully");
  };

  // Admin: Set ICP fee recipient account
  public shared ({ caller }) func admin_set_icp_fee_recipient(
    recipient_principal : ?Principal,
    recipient_subaccount : ?Blob
  ) : async { #Ok : Text; #Err : Text } {
    if (not isAdmin(caller)) {
      return #Err("Only admins can set the fee recipient");
    };
    
    icp_fee_recipient_principal := recipient_principal;
    icp_fee_recipient_subaccount := recipient_subaccount;
    
    let principal_text = switch (recipient_principal) {
      case (?p) { Principal.toText(p) };
      case null { "this canister (default)" };
    };
    let subaccount_text = switch (recipient_subaccount) {
      case (?s) { "custom subaccount" };
      case null { "main account" };
    };
    
    #Ok("Fee recipient set to: " # principal_text # " / " # subaccount_text);
  };

  // Query: Get ICP lock fee configuration
  public query func get_lock_fees_icp() : async {
    token_lock_fee_icp_e8s : Nat64;
    position_lock_fee_icp_e8s : Nat64;
    premium_token_lock_fee_icp_e8s : Nat64;
    premium_position_lock_fee_icp_e8s : Nat64;
    sneed_premium_canister_id : ?Principal;
    fee_recipient_principal : ?Principal;
    fee_recipient_subaccount : ?Blob;
  } {
    {
      token_lock_fee_icp_e8s = token_lock_fee_icp_e8s;
      position_lock_fee_icp_e8s = position_lock_fee_icp_e8s;
      premium_token_lock_fee_icp_e8s = premium_token_lock_fee_icp_e8s;
      premium_position_lock_fee_icp_e8s = premium_position_lock_fee_icp_e8s;
      sneed_premium_canister_id = sneed_premium_canister_id;
      fee_recipient_principal = icp_fee_recipient_principal;
      fee_recipient_subaccount = icp_fee_recipient_subaccount;
    };
  };

  // Query: Get ICP lock fee collection stats
  public query func get_lock_fee_stats() : async {
    total_token_lock_fees_collected_e8s : Nat;
    total_position_lock_fees_collected_e8s : Nat;
    total_fees_collected_e8s : Nat;
  } {
    {
      total_token_lock_fees_collected_e8s = total_token_lock_fees_collected_e8s;
      total_position_lock_fees_collected_e8s = total_position_lock_fees_collected_e8s;
      total_fees_collected_e8s = total_token_lock_fees_collected_e8s + total_position_lock_fees_collected_e8s;
    };
  };

  // Admin query: Get paginated payment log
  // Returns payments in reverse chronological order (newest first)
  public shared query ({ caller }) func admin_get_payment_log(offset : Nat, limit : Nat) : async {
    payments : [T.PaymentLogEntry];
    total_count : Nat;
    has_more : Bool;
  } {
    assert(isAdmin(caller));
    
    let total = payment_log.size();
    
    // Return empty if offset is beyond the log
    if (offset >= total) {
      return {
        payments = [];
        total_count = total;
        has_more = false;
      };
    };
    
    // Calculate reverse index (newest first)
    // offset 0 = most recent, offset 1 = second most recent, etc.
    let effective_limit = if (limit > 1000) { 1000 } else { limit }; // Cap at 1000 per page
    let start_idx = if (total > offset) { total - offset } else { 0 };
    let end_idx = if (start_idx > effective_limit) { start_idx - effective_limit } else { 0 };
    
    var result : [T.PaymentLogEntry] = [];
    var idx = start_idx;
    while (idx > end_idx) {
      idx -= 1;
      result := Array.append(result, [payment_log[idx]]);
    };
    
    {
      payments = result;
      total_count = total;
      has_more = end_idx > 0;
    };
  };

  // Admin query: Get payment log count
  public shared query ({ caller }) func admin_get_payment_log_count() : async Nat {
    assert(isAdmin(caller));
    payment_log.size();
  };

  // Query: Get payment subaccount for a user
  public query func getPaymentSubaccount(user : Principal) : async Blob {
    userPaymentSubaccount(user);
  };

  // Query: Get payment balance for a user
  public func getPaymentBalance(user : Principal) : async Nat {
    let subaccount = userPaymentSubaccount(user);
    let icpLedger = actor(ICP_LEDGER_ID) : actor {
      icrc1_balance_of : shared query { owner : Principal; subaccount : ?Blob } -> async Nat;
    };
    
    await icpLedger.icrc1_balance_of({
      owner = this_canister_id();
      subaccount = ?subaccount;
    });
  };

  // Check if user is premium
  private func checkUserPremium(user : Principal) : async* Bool {
    switch (sneed_premium_canister_id) {
      case (?canisterId) {
        await* PremiumClient.isPremium(premium_cache, canisterId, user);
      };
      case null { false };
    };
  };

  // Get effective lock fee for a user (based on premium status and lock type)
  public func getEffectiveLockFee(user : Principal, is_position_lock : Bool) : async {
    fee_e8s : Nat64;
    is_premium : Bool;
  } {
    let is_premium = await* checkUserPremium(user);
    
    let fee_e8s = if (is_position_lock) {
      if (is_premium) { premium_position_lock_fee_icp_e8s } else { position_lock_fee_icp_e8s }
    } else {
      if (is_premium) { premium_token_lock_fee_icp_e8s } else { token_lock_fee_icp_e8s }
    };
    
    { fee_e8s; is_premium };
  };

  // Collect ICP lock fee from user's payment subaccount
  // Verify that user has sufficient ICP in payment subaccount (balance check only)
  // Returns the fee amount if sufficient, or error if insufficient
  private func verifyLockFeeIcp(caller : Principal, correlation_id : Nat, is_position_lock : Bool) : async* { #Ok : Nat; #Err : Text } {
    // Check premium status and get effective fee
    let is_premium = await* checkUserPremium(caller);
    let fee_e8s = if (is_position_lock) {
      if (is_premium) { premium_position_lock_fee_icp_e8s } else { position_lock_fee_icp_e8s }
    } else {
      if (is_premium) { premium_token_lock_fee_icp_e8s } else { token_lock_fee_icp_e8s }
    };
    
    // If fee is 0, no payment needed
    if (fee_e8s == 0) {
      log_info(caller, correlation_id, "Lock fee is 0, no payment required");
      return #Ok(0);
    };
    
    let fee_nat = Nat64.toNat(fee_e8s);
    
    // Check payment balance
    let subaccount = userPaymentSubaccount(caller);
    let icpLedger = actor(ICP_LEDGER_ID) : actor {
      icrc1_balance_of : shared query { owner : Principal; subaccount : ?Blob } -> async Nat;
    };
    
    let balance = await icpLedger.icrc1_balance_of({
      owner = this_canister_id();
      subaccount = ?subaccount;
    });
    
    if (balance < fee_nat) {
      log_error(caller, correlation_id, "Insufficient ICP payment. Required: " # Nat.toText(fee_nat) # ", Available: " # Nat.toText(balance));
      return #Err("Insufficient ICP payment. Required: " # Nat.toText(fee_nat) # " e8s, Available: " # Nat.toText(balance) # " e8s");
    };
    
    log_info(caller, correlation_id, "ICP payment verified: " # Nat.toText(fee_nat) # " e8s available");
    #Ok(fee_nat);
  };

  // Charge the ICP lock fee (transfer from user's payment subaccount to main account)
  // Should only be called after lock is successfully created
  private func chargeLockFeeIcp(caller : Principal, correlation_id : Nat, fee_nat : Nat, lock_type : T.LockType) : async { #Ok : Nat; #Err : Text } {
    // If fee is 0, nothing to charge
    if (fee_nat == 0) {
      return #Ok(0);
    };
    
    let icp_fee_nat = Nat64.toNat(ICP_FEE);
    let subaccount = userPaymentSubaccount(caller);
    
    let icpLedger = actor(ICP_LEDGER_ID) : actor {
      icrc1_transfer : shared {
        to : { owner : Principal; subaccount : ?Blob };
        fee : ?Nat;
        memo : ?Blob;
        from_subaccount : ?Blob;
        created_at_time : ?Nat64;
        amount : Nat;
      } -> async { #Ok : Nat; #Err : T.TransferError };
    };
    
    // Transfer fee to configured recipient (or this canister's main account by default)
    let recipient_owner = switch (icp_fee_recipient_principal) {
      case (?p) { p };
      case null { this_canister_id() };
    };
    let transfer_amount = if (fee_nat > icp_fee_nat) { fee_nat - icp_fee_nat } else { 0 };
    if (transfer_amount > 0) {
      let transfer_result = await icpLedger.icrc1_transfer({
        to = { owner = recipient_owner; subaccount = icp_fee_recipient_subaccount };
        fee = ?icp_fee_nat;
        memo = null;
        from_subaccount = ?subaccount;
        created_at_time = null;
        amount = transfer_amount;
      });
      
      switch (transfer_result) {
        case (#Ok(blockIdx)) {
          // Update stats based on lock type
          switch (lock_type) {
            case (#TokenLock) { total_token_lock_fees_collected_e8s += fee_nat; };
            case (#PositionLock) { total_position_lock_fees_collected_e8s += fee_nat; };
          };
          
          // Record payment in log
          let payment_entry : T.PaymentLogEntry = {
            id = next_payment_log_id;
            timestamp = TimeAsNat64(Time.now());
            payer = caller;
            amount_e8s = fee_nat;
            icp_transaction_id = blockIdx;
            lock_type = lock_type;
            correlation_id = correlation_id;
          };
          payment_log := Array.append(payment_log, [payment_entry]);
          next_payment_log_id += 1;
          
          log_info(caller, correlation_id, "ICP lock fee charged: " # Nat.toText(transfer_amount) # " e8s, block: " # Nat.toText(blockIdx));
          #Ok(fee_nat);
        };
        case (#Err(e)) {
          log_error(caller, correlation_id, "Failed to charge ICP lock fee: " # debug_show(e));
          #Err("Failed to charge ICP payment: " # debug_show(e));
        };
      };
    } else {
      // Fee is less than ICP transaction fee, consider it paid
      log_info(caller, correlation_id, "Lock fee less than ICP tx fee, considered paid");
      #Ok(fee_nat);
    };
  };

  ////////////////
  // Claim and Withdraw Queue
  ////////////////

  // Helper: Get oldest pending request
  private func get_oldest_pending_request() : ?ClaimRequest {
    let now = TimeAsNat64(Time.now());
    var skipped_swap_canisters : List.List<Principal> = List.nil();
    
    for (request in stable_claim_requests.vals()) {
      // Only consider requests that are in an active processing state
      let is_processable_status = switch (request.status) {
        case (#Pending) { true };
        case (#Processing) { true };
        case (#BalanceRecorded(_)) { true };
        case (#ClaimAttempted(_)) { true };
        case (#ClaimVerified(_)) { true };
        case (#Withdrawn(_)) { true };
        case _ { false }; // Skip completed, failed, or timed out
      };
      
      if (not is_processable_status) {
        // Skip this request entirely
      } else {
        // Check if swap canister has been skipped
        let swap_canister_skipped = List.some<Principal>(
          skipped_swap_canisters,
          func (p) { Principal.equal(p, request.swap_canister_id) }
        );
        
        if (swap_canister_skipped) {
          // Skip this request, swap canister already flagged
        } else {
          // Check cooldown
          let in_cooldown = switch (request.last_attempted_at) {
            case (?last_attempt) {
              let elapsed : Nat64 = if (now >= last_attempt) {
                now - last_attempt
              } else {
                0 : Nat64 // Clock skew protection
              };
              elapsed < claim_request_cooldown_ns
            };
            case null { false }; // Never attempted, not in cooldown
          };
          
          if (in_cooldown) {
            // Skip this request and mark its swap canister as skipped
            skipped_swap_canisters := List.push(request.swap_canister_id, skipped_swap_canisters);
          } else {
            // This request is processable!
            return ?request;
          };
        };
      };
    };
    
    // No processable requests found
    null;
  };

  // Helper: Update request in stable array
  private func update_claim_request(updated_request : ClaimRequest) : () {
    stable_claim_requests := Array.map<ClaimRequest, ClaimRequest>(
      stable_claim_requests,
      func (req) {
        if (req.request_id == updated_request.request_id) {
          updated_request
        } else {
          req
        }
      }
    );
  };

  // Helper: Check if request has timed out
  private func has_request_timed_out(request : ClaimRequest) : Bool {
    switch (request.started_processing_at) {
      case (?started_at) {
        let now = TimeAsNat64(Time.now());
        (now - started_at) > claim_request_timeout_ns
      };
      case null { false };
    };
  };

  // Helper: Move completed request to array and remove from active
  private func archive_completed_request(request : ClaimRequest) : () {
    // Add to completed requests array
    completed_claim_requests := Array.append(completed_claim_requests, [request]);
    
    // Keep only last 1000 to prevent unbounded growth
    if (completed_claim_requests.size() > 1000) {
      let start_index = completed_claim_requests.size() - 1000;
      completed_claim_requests := Array.subArray(completed_claim_requests, start_index, 1000);
    };

    // Remove from active requests
    stable_claim_requests := Array.filter<ClaimRequest>(stable_claim_requests, func (req) {
      req.request_id != request.request_id
    });
  };

  private func archive_failed_request(request : ClaimRequest) : () {
    // Add to failed requests array (for pre-claim failures where no funds are stuck)
    failed_claim_requests := Array.append(failed_claim_requests, [request]);
    
    // Keep only last 1000 to prevent unbounded growth
    if (failed_claim_requests.size() > 1000) {
      let start_index = failed_claim_requests.size() - 1000;
      failed_claim_requests := Array.subArray(failed_claim_requests, start_index, 1000);
    };

    // Remove from active requests
    stable_claim_requests := Array.filter<ClaimRequest>(stable_claim_requests, func (req) {
      req.request_id != request.request_id
    });
  };

  // Public: Request claim and withdraw
  public shared ({ caller }) func request_claim_and_withdraw(
    swap_canister_id : T.SwapCanisterId,
    position_id : T.PositionId
  ) : async ClaimAndWithdrawResult {
    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Requesting claim and withdraw for position " # debug_show(position_id) # " on swap canister " # debug_show(swap_canister_id));

    // Verify caller owns the position
    if (not has_claimed_position_impl(caller, swap_canister_id, position_id)) {
      let error = "Caller does not own position " # debug_show(position_id) # " on swap canister " # debug_show(swap_canister_id);
      log_error(caller, correlation_id, error);
      return #Err(error);
    };

    // Get position lock to verify it's locked and get token info
    let position_lock = get_position_lock(caller, swap_canister_id, position_id);
    let (token0, token1) = switch (position_lock) {
      case (?lock) { (lock.token0, lock.token1) };
      case null {
        let error = "Position " # debug_show(position_id) # " is not locked";
        log_error(caller, correlation_id, error);
        return #Err(error);
      };
    };

    // Create the request
    next_claim_request_id += 1;
    let request : ClaimRequest = {
      request_id = next_claim_request_id;
      caller = caller;
      swap_canister_id = swap_canister_id;
      position_id = position_id;
      token0 = token0;
      token1 = token1;
      status = #Pending;
      created_at = TimeAsNat64(Time.now());
      started_processing_at = null;
      completed_at = null;
      retry_count = 0;
      last_attempted_at = null;
    };

    // Add to queue
    stable_claim_requests := Array.append(stable_claim_requests, [request]);
    log_info(caller, correlation_id, "Created claim request " # debug_show(request.request_id) # " for position " # debug_show(position_id));

    // Start processing if not already running
    ignore start_claim_queue_processor();

    #Ok(request.request_id);
  };

  // Start the claim queue processor timer
  private func start_claim_queue_processor() : async () {
    switch (claim_processing_timer_id) {
      case (?_) {
        // Already running
      };
      case null {
        // Start with 0 second delay
        let timer_id = Timer.setTimer<system>(#seconds(0), process_claim_queue);
        claim_processing_timer_id := ?timer_id;
        next_scheduled_timer_time := ?TimeAsNat64(Time.now()); // Immediate execution
      };
    };
  };

  // Main queue processor function
  private func process_claim_queue() : async () {
    let correlation_id = get_next_correlation_id();
    
    // SEMAPHORE: Check if already processing to prevent concurrent execution
    if (is_processing_claim_queue) {
      log_info(Principal.fromText("2vxsx-fae"), correlation_id, "Claim queue already processing, skipping this invocation");
      return;
    };
    
    // SEMAPHORE: Acquire lock
    is_processing_claim_queue := true;
    
    // Record execution
    last_timer_execution_time := ?TimeAsNat64(Time.now());
    last_timer_execution_correlation_id := ?correlation_id;
    
    // Check if processing is paused
    switch (claim_queue_processing_state) {
      case (#Paused(reason)) {
        log_info(Principal.fromText("2vxsx-fae"), correlation_id, "Claim queue processing is paused: " # reason);
        claim_processing_timer_id := null;
        next_scheduled_timer_time := null;
        is_processing_claim_queue := false; // SEMAPHORE: Release lock
        return;
      };
      case (#Active) {};
    };

    // Get oldest pending request
    switch (get_oldest_pending_request()) {
      case null {
        // No processable requests (either queue empty or all in cooldown)
        // Check if there are any active requests at all
        let has_active_requests = stable_claim_requests.size() > 0;
        
        if (has_active_requests) {
          // Requests exist but none are processable (all in cooldown)
          consecutive_empty_processing_cycles += 1;
          log_info(Principal.fromText("2vxsx-fae"), correlation_id, "No processable requests (all in cooldown?), empty cycle count: " # debug_show(consecutive_empty_processing_cycles));
          
          if (consecutive_empty_processing_cycles >= max_consecutive_empty_cycles) {
            // Circuit breaker: pause to prevent infinite loop
            log_info(Principal.fromText("2vxsx-fae"), correlation_id, "Max consecutive empty cycles reached, pausing queue");
            claim_queue_processing_state := #Paused("All requests in cooldown, max empty cycles exceeded");
            claim_processing_timer_id := null;
            next_scheduled_timer_time := null;
            claim_requests_processed_in_batch := 0;
            consecutive_empty_processing_cycles := 0;
            is_processing_claim_queue := false; // SEMAPHORE: Release lock
            return;
          };
          
          // Schedule next check after cooldown period
          let timer_id = Timer.setTimer<system>(#nanoseconds(Nat64.toNat(claim_request_cooldown_ns)), process_claim_queue);
          claim_processing_timer_id := ?timer_id;
          next_scheduled_timer_time := ?(TimeAsNat64(Time.now()) + claim_request_cooldown_ns);
          is_processing_claim_queue := false; // SEMAPHORE: Release lock
          return;
        } else {
          // Queue is truly empty
          log_info(Principal.fromText("2vxsx-fae"), correlation_id, "Claim queue is empty, stopping processor");
          claim_processing_timer_id := null;
          next_scheduled_timer_time := null;
          claim_requests_processed_in_batch := 0;
          consecutive_empty_processing_cycles := 0;
          is_processing_claim_queue := false; // SEMAPHORE: Release lock
          return;
        };
      };
      case (?request) {
        // Check for timeout
        if (has_request_timed_out(request)) {
          let updated_request = {
            request_id = request.request_id;
            caller = request.caller;
            swap_canister_id = request.swap_canister_id;
            position_id = request.position_id;
            token0 = request.token0;
            token1 = request.token1;
            status = #TimedOut;
            created_at = request.created_at;
            started_processing_at = request.started_processing_at;
            completed_at = ?TimeAsNat64(Time.now());
            retry_count = request.retry_count;
            last_attempted_at = request.last_attempted_at;
          };
          archive_completed_request(updated_request);
          log_error(request.caller, correlation_id, "Request " # debug_show(request.request_id) # " timed out");
          
          // Pause processing
          claim_queue_processing_state := #Paused("Request " # debug_show(request.request_id) # " timed out");
          claim_processing_timer_id := null;
          next_scheduled_timer_time := null;
          is_processing_claim_queue := false; // SEMAPHORE: Release lock
          return;
        };

        // Process the request
        await process_single_claim_request(request, correlation_id);

        // Reset empty cycle counter (we successfully processed something)
        consecutive_empty_processing_cycles := 0;

        // Increment batch counter
        claim_requests_processed_in_batch += 1;

        // Check if we need to pause
        if (claim_requests_processed_in_batch >= max_requests_per_batch) {
          switch (get_oldest_pending_request()) {
            case null {
              // Queue is now empty, reset counter
              claim_requests_processed_in_batch := 0;
            };
            case (?_) {
              // More requests pending, schedule pause
              log_info(Principal.fromText("2vxsx-fae"), correlation_id, "Processed " # debug_show(max_requests_per_batch) # " requests, pausing for 10 minutes");
              claim_requests_processed_in_batch := 0;
              let timer_id = Timer.setTimer<system>(#nanoseconds(Nat64.toNat(batch_pause_duration_ns)), process_claim_queue);
              claim_processing_timer_id := ?timer_id;
              next_scheduled_timer_time := ?(TimeAsNat64(Time.now()) + batch_pause_duration_ns);
              is_processing_claim_queue := false; // SEMAPHORE: Release lock
              return;
            };
          };
        };

        // Schedule next iteration immediately
        let timer_id = Timer.setTimer<system>(#seconds(0), process_claim_queue);
        claim_processing_timer_id := ?timer_id;
        next_scheduled_timer_time := ?TimeAsNat64(Time.now()); // Immediate execution
        is_processing_claim_queue := false; // SEMAPHORE: Release lock
      };
    };
  };

  // Process a single claim request
  private func process_single_claim_request(request : ClaimRequest, correlation_id : Nat) : async () {
    log_info(request.caller, correlation_id, "Processing claim request " # debug_show(request.request_id) # ", retry_count=" # debug_show(request.retry_count));

    // Check if max retries exceeded
    if (request.retry_count >= max_claim_retry_attempts) {
      let error_msg = "Max retry attempts (" # debug_show(max_claim_retry_attempts) # ") exceeded";
      log_error(request.caller, correlation_id, error_msg);
      let failed_request = {
        request with
        status = #Failed(error_msg);
        completed_at = ?TimeAsNat64(Time.now());
      };
      archive_failed_request(failed_request);
      return;
    };

    // Update status to Processing, increment retry count, and record attempt time
    let updated_request_processing = {
      request with
      status = #Processing;
      started_processing_at = ?TimeAsNat64(Time.now());
      retry_count = request.retry_count + 1;
      last_attempted_at = ?TimeAsNat64(Time.now());
    };
    update_claim_request(updated_request_processing);

    // Get ICPSwap swap canister actor
    let swap_canister = actor (Principal.toText(request.swap_canister_id)) : actor {
      claim : (args : { positionId : Nat }) -> async { #ok : { amount0 : Nat; amount1 : Nat }; #err : T.SwapCanisterError };
      getUserPosition : (positionId : Nat) -> async { #ok : { tokensOwed0 : Nat; tokensOwed1 : Nat; liquidity : Nat; feeGrowthInside0LastX128 : Nat; feeGrowthInside1LastX128 : Nat }; #err : T.SwapCanisterError };
    };

    // Step 0: Get token ledger actors and fees
    let token0_ledger = actor (Principal.toText(request.token0)) : actor { 
      icrc1_fee : () -> async Nat;
      icrc1_balance_of : (account : Account) -> async Nat;
      icrc1_transfer : (args : TransferArgs) -> async T.TransferResult;
    };
    let token1_ledger = actor (Principal.toText(request.token1)) : actor { 
      icrc1_fee : () -> async Nat;
      icrc1_balance_of : (account : Account) -> async Nat;
      icrc1_transfer : (args : TransferArgs) -> async T.TransferResult;
    };
    let token0_fee = await token0_ledger.icrc1_fee();
    let token1_fee = await token1_ledger.icrc1_fee();

    // Get current claimable amounts
    let position_info_result = await swap_canister.getUserPosition(request.position_id);
    let (tokens_owed0, tokens_owed1) = switch (position_info_result) {
      case (#ok(info)) { (info.tokensOwed0, info.tokensOwed1) };
      case (#err(err)) {
        let error_msg = "Failed to get position info: " # debug_show(err);
        log_error(request.caller, correlation_id, error_msg);
        let failed_request = { updated_request_processing with status = #Failed(error_msg); completed_at = ?TimeAsNat64(Time.now()) };
        archive_failed_request(failed_request);  // Pre-claim failure, no funds stuck
        return;
      };
    };

    // Check if at least one token has enough to claim (need at least 1x fee for transfer to user)
    let token0_has_enough = tokens_owed0 >= token0_fee;
    let token1_has_enough = tokens_owed1 >= token1_fee;

    if (not token0_has_enough and not token1_has_enough) {
      let error_msg = "Insufficient rewards to claim. Token0: " # debug_show(tokens_owed0) # " (need >= " # debug_show(token0_fee) # "), Token1: " # debug_show(tokens_owed1) # " (need >= " # debug_show(token1_fee) # ")";
      log_error(request.caller, correlation_id, error_msg);
      let failed_request = { updated_request_processing with status = #Failed(error_msg); completed_at = ?TimeAsNat64(Time.now()) };
      archive_failed_request(failed_request);  // Pre-claim failure, no funds stuck
      return;
    };

    log_info(request.caller, correlation_id, "Position has claimable rewards - Token0: " # debug_show(tokens_owed0) # " (fee: " # debug_show(token0_fee) # ", enough: " # debug_show(token0_has_enough) # "), Token1: " # debug_show(tokens_owed1) # " (fee: " # debug_show(token1_fee) # ", enough: " # debug_show(token1_has_enough) # ")");

    // Step 1: Record balance on token ledgers before claim
    // Note: ICPSwap's claim() auto-withdraws to the caller's principal (sneed_lock), not to a subaccount
    let canister_account : Account = { owner = this_canister_id(); subaccount = null };
    let balance0_before = await token0_ledger.icrc1_balance_of(canister_account);
    let balance1_before = await token1_ledger.icrc1_balance_of(canister_account);
    
    log_info(request.caller, correlation_id, "Balance before claim on sneed_lock principal: token0=" # debug_show(balance0_before) # ", token1=" # debug_show(balance1_before));

    let updated_request_balance_recorded = {
      updated_request_processing with
      status = #BalanceRecorded({ balance0_before = balance0_before; balance1_before = balance1_before });
    };
    update_claim_request(updated_request_balance_recorded);
    log_info(request.caller, correlation_id, "Recorded balance before claim: token0=" # debug_show(balance0_before) # ", token1=" # debug_show(balance1_before));

    // Step 2: Attempt claim
    let claim_result = await swap_canister.claim({ positionId = request.position_id });
    
    let updated_request_claim_attempted = {
      updated_request_balance_recorded with
      status = #ClaimAttempted({ balance0_before = balance0_before; balance1_before = balance1_before; claim_attempt = 1 });
    };
    update_claim_request(updated_request_claim_attempted);

    // Step 3: Verify claim by checking balance change on token ledgers
    // ICPSwap's claim auto-withdraws to the caller (sneed_lock principal), so we check ledger balances
    let balance0_after = await token0_ledger.icrc1_balance_of(canister_account);
    let balance1_after = await token1_ledger.icrc1_balance_of(canister_account);
    
    let amount0_claimed = if (balance0_after >= balance0_before) {
      balance0_after - balance0_before
    } else { 
      log_error(request.caller, correlation_id, "WARNING: Token0 balance decreased after claim! Before: " # debug_show(balance0_before) # ", After: " # debug_show(balance0_after));
      0 
    };
    let amount1_claimed = if (balance1_after >= balance1_before) {
      balance1_after - balance1_before
    } else { 
      log_error(request.caller, correlation_id, "WARNING: Token1 balance decreased after claim! Before: " # debug_show(balance1_before) # ", After: " # debug_show(balance1_after));
      0 
    };
    
    // Verify claim based on balance changes
    let claim_error = switch (claim_result) {
      case (#ok(amounts)) {
        log_info(request.caller, correlation_id, "Claim API returned success: amount0=" # debug_show(amounts.amount0) # ", amount1=" # debug_show(amounts.amount1) # ". Actual balance change: token0=" # debug_show(amount0_claimed) # ", token1=" # debug_show(amount1_claimed));
        null
      };
      case (#err(err)) {
        log_info(request.caller, correlation_id, "Claim API returned error: " # debug_show(err) # ". Actual balance change: token0=" # debug_show(amount0_claimed) # ", token1=" # debug_show(amount1_claimed));
        ?err
      };
    };
    
    // Check if any funds were actually claimed
    if (amount0_claimed == 0 and amount1_claimed == 0) {
      let error_msg = switch (claim_error) {
        case (?err) { "Claim failed with no balance change: " # debug_show(err) };
        case null { "Claim succeeded but no balance change detected" };
      };
      log_error(request.caller, correlation_id, error_msg);
      let failed_request = { updated_request_claim_attempted with status = #Failed(error_msg); completed_at = ?TimeAsNat64(Time.now()) };
      archive_failed_request(failed_request);  // Claim failed, verified no funds stuck
      return;
    };
    
    log_info(request.caller, correlation_id, "Claim verified by balance change: token0=" # debug_show(amount0_claimed) # ", token1=" # debug_show(amount1_claimed));

    let updated_request_verified = {
      updated_request_claim_attempted with
      status = #ClaimVerified({
        balance0_before = balance0_before;
        balance1_before = balance1_before;
        amount0_claimed = amount0_claimed;
        amount1_claimed = amount1_claimed;
      });
    };
    update_claim_request(updated_request_verified);

    // Step 4: Transfer claimed tokens to user's principal
    // Funds are already on sneed_lock principal (auto-withdrawn by claim), so we use icrc1_transfer
    let user_account : Account = { owner = request.caller; subaccount = null };
    
    var transferred0 : Nat = 0;
    var transferred1 : Nat = 0;
    var transfer0_tx_id : ?Nat = null;
    var transfer1_tx_id : ?Nat = null;
    var transfer_errors : Text = "";

    // Transfer token0 if claimed amount is sufficient (need to cover transfer fee)
    if (amount0_claimed > token0_fee) {
      let transfer0_amount = amount0_claimed - token0_fee;
      log_info(request.caller, correlation_id, "Transferring token0 to user: amount=" # debug_show(transfer0_amount) # ", fee=" # debug_show(token0_fee) # ", claimed=" # debug_show(amount0_claimed));
      
      let transfer0_args : TransferArgs = {
        from_subaccount = null;  // Transfer from sneed_lock's main account
        to = user_account;
        amount = transfer0_amount;
        fee = ?token0_fee;
        memo = null;
        created_at_time = null;
      };
      
      let transfer0_result = await token0_ledger.icrc1_transfer(transfer0_args);
      switch (transfer0_result) {
        case (#Ok(tx_id)) {
          transferred0 := transfer0_amount;
          transfer0_tx_id := ?tx_id;
          log_info(request.caller, correlation_id, "Transferred token0 to user: " # debug_show(transfer0_amount) # ", tx_id: " # debug_show(tx_id));
        };
        case (#Err(err)) {
          let error_msg = "Failed to transfer token0 to user: " # debug_show(err);
          log_error(request.caller, correlation_id, error_msg);
          transfer_errors := transfer_errors # error_msg # "; ";
        };
      };
    } else if (amount0_claimed > 0) {
      let msg = "Token0 claimed amount (" # debug_show(amount0_claimed) # ") <= fee (" # debug_show(token0_fee) # "), cannot transfer";
      log_info(request.caller, correlation_id, msg);
      transfer_errors := transfer_errors # msg # "; ";
    };

    // Transfer token1 if claimed amount is sufficient (need to cover transfer fee)
    if (amount1_claimed > token1_fee) {
      let transfer1_amount = amount1_claimed - token1_fee;
      log_info(request.caller, correlation_id, "Transferring token1 to user: amount=" # debug_show(transfer1_amount) # ", fee=" # debug_show(token1_fee) # ", claimed=" # debug_show(amount1_claimed));
      
      let transfer1_args : TransferArgs = {
        from_subaccount = null;  // Transfer from sneed_lock's main account
        to = user_account;
        amount = transfer1_amount;
        fee = ?token1_fee;
        memo = null;
        created_at_time = null;
      };
      
      let transfer1_result = await token1_ledger.icrc1_transfer(transfer1_args);
      switch (transfer1_result) {
        case (#Ok(tx_id)) {
          transferred1 := transfer1_amount;
          transfer1_tx_id := ?tx_id;
          log_info(request.caller, correlation_id, "Transferred token1 to user: " # debug_show(transfer1_amount) # ", tx_id: " # debug_show(tx_id));
        };
        case (#Err(err)) {
          let error_msg = "Failed to transfer token1 to user: " # debug_show(err);
          log_error(request.caller, correlation_id, error_msg);
          transfer_errors := transfer_errors # error_msg # "; ";
        };
      };
    } else if (amount1_claimed > 0) {
      let msg = "Token1 claimed amount (" # debug_show(amount1_claimed) # ") <= fee (" # debug_show(token1_fee) # "), cannot transfer";
      log_info(request.caller, correlation_id, msg);
      transfer_errors := transfer_errors # msg # "; ";
    };
    
    // Check if transfers failed
    if (transfer_errors != "") {
      let error_msg = "Transfer errors: " # transfer_errors # " Tokens claimed but stuck on sneed_lock canister: token0=" # debug_show(amount0_claimed - transferred0) # ", token1=" # debug_show(amount1_claimed - transferred1);
      log_error(request.caller, correlation_id, error_msg);
      let failed_request = { updated_request_verified with status = #Failed(error_msg); completed_at = ?TimeAsNat64(Time.now()) };
      update_claim_request(failed_request);  // Keep in active array - FUNDS ARE STUCK ON SNEED_LOCK!
      return;
    };

    // Mark as completed with transfer details
    let completed_request = {
      updated_request_verified with
      status = #Completed({
        amount0_claimed = amount0_claimed;
        amount1_claimed = amount1_claimed;
        amount0_transferred = transferred0;
        amount1_transferred = transferred1;
        transfer0_tx_id = transfer0_tx_id;
        transfer1_tx_id = transfer1_tx_id;
      });
      completed_at = ?TimeAsNat64(Time.now());
    };
    archive_completed_request(completed_request);
    log_info(request.caller, correlation_id, "Completed claim request " # debug_show(request.request_id));
  };

  // Query: Get all active claim requests for caller (pending/processing)
  public query ({ caller }) func get_my_active_claim_requests() : async [ClaimRequest] {
    Array.filter<ClaimRequest>(stable_claim_requests, func (req) { req.caller == caller });
  };

  // Query: Get all active claim requests (no caller filter)
  public query func get_all_active_claim_requests() : async [ClaimRequest] {
    stable_claim_requests;
  };

  // Query: Get all completed claim requests (as structured data)
  public query func get_all_completed_claim_requests() : async [ClaimRequest] {
    completed_claim_requests;
  };

  // Query: Get all failed claim requests (as structured data)
  public query func get_all_failed_claim_requests() : async [ClaimRequest] {
    failed_claim_requests;
  };

  // Query: Get active claim request by ID (pending/processing)
  public query func get_active_claim_request(request_id : ClaimRequestId) : async ?ClaimRequest {
    Array.find<ClaimRequest>(stable_claim_requests, func (req) { req.request_id == request_id });
  };

  // Query: Get claim request status by ID (searches active, completed, and failed)
  public query func get_claim_request_status(request_id : ClaimRequestId) : async ?{
    #Active : ClaimRequest;
    #Completed : ClaimRequest;
    #Failed : ClaimRequest;
  } {
    // First check active requests
    switch (Array.find<ClaimRequest>(stable_claim_requests, func (req) { req.request_id == request_id })) {
      case (?active_req) { return ?#Active(active_req); };
      case null {
        // Search completed requests
        switch (Array.find<ClaimRequest>(completed_claim_requests, func (req) { req.request_id == request_id })) {
          case (?completed_req) { return ?#Completed(completed_req); };
          case null {
            // Search failed requests
            switch (Array.find<ClaimRequest>(failed_claim_requests, func (req) { req.request_id == request_id })) {
              case (?failed_req) { return ?#Failed(failed_req); };
              case null { return null; };
            };
          };
        };
      };
    };
  };

  // Query: Get specific completed claim request by ID
  public query func get_completed_claim_request(request_id : ClaimRequestId) : async ?ClaimRequest {
    Array.find<ClaimRequest>(completed_claim_requests, func (req) { req.request_id == request_id });
  };

  // Query: Get specific failed claim request by ID
  public query func get_failed_claim_request(request_id : ClaimRequestId) : async ?ClaimRequest {
    Array.find<ClaimRequest>(failed_claim_requests, func (req) { req.request_id == request_id });
  };

  // Query: Get queue status
  public query func get_claim_queue_status() : async {
    processing_state : QueueProcessingState;
    pending_count : Nat;
    processing_count : Nat;
    active_total : Nat;
    completed_count : Nat;
    failed_count : Nat;
    consecutive_empty_cycles : Nat;
    is_currently_processing : Bool; // Semaphore state
  } {
    var pending = 0;
    var processing = 0;

    for (req in stable_claim_requests.vals()) {
      switch (req.status) {
        case (#Pending) { pending += 1; };
        case (#Processing) { processing += 1; };
        case (#BalanceRecorded(_)) { processing += 1; };
        case (#ClaimAttempted(_)) { processing += 1; };
        case (#ClaimVerified(_)) { processing += 1; };
        case (#Withdrawn(_)) { processing += 1; };
        case _ {}; // Should not have completed/failed in active array
      };
    };

    {
      processing_state = claim_queue_processing_state;
      pending_count = pending;
      processing_count = processing;
      active_total = stable_claim_requests.size();
      completed_count = completed_claim_requests.size();
      failed_count = failed_claim_requests.size();
      consecutive_empty_cycles = consecutive_empty_processing_cycles;
      is_currently_processing = is_processing_claim_queue;
    };
  };

  // Admin: Resume queue processing
  public shared ({ caller }) func admin_resume_claim_queue() : async () {
    if (not isAdmin(caller)) {
      Debug.trap("Only admin can resume claim queue processing");
    };

    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Resuming claim queue processing");
    
    claim_queue_processing_state := #Active;
    claim_requests_processed_in_batch := 0;
    ignore start_claim_queue_processor();
  };

  // Admin: Pause queue processing
  public shared ({ caller }) func admin_pause_claim_queue(reason : Text) : async () {
    if (not isAdmin(caller)) {
      Debug.trap("Only admin can pause claim queue processing");
    };

    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Pausing claim queue processing: " # reason);
    
    claim_queue_processing_state := #Paused(reason);
    
    // Cancel existing timer
    switch (claim_processing_timer_id) {
      case (?timer_id) {
        Timer.cancelTimer(timer_id);
        claim_processing_timer_id := null;
        next_scheduled_timer_time := null;
      };
      case null {};
    };
  };

  // Admin: Emergency stop - immediately cancel timer
  public shared ({ caller }) func admin_emergency_stop_timer() : async () {
    if (not isAdmin(caller)) {
      Debug.trap("Only admin can emergency stop timer");
    };

    let correlation_id = get_next_correlation_id();
    
    // Cancel timer immediately
    switch (claim_processing_timer_id) {
      case (?timer_id) {
        Timer.cancelTimer(timer_id);
        claim_processing_timer_id := null;
        next_scheduled_timer_time := null;
        log_info(caller, correlation_id, "EMERGENCY STOP: Timer " # debug_show(timer_id) # " cancelled");
      };
      case null {
        log_info(caller, correlation_id, "EMERGENCY STOP: No active timer to cancel");
      };
    };

    // Pause queue processing
    claim_queue_processing_state := #Paused("Emergency stop activated");
    claim_requests_processed_in_batch := 0;
    
    log_info(caller, correlation_id, "EMERGENCY STOP: Queue processing paused, timer cancelled");
  };

  // Admin: Clear completed requests array
  public shared ({ caller }) func admin_clear_completed_claim_requests() : async Nat {
    if (not isAdmin(caller)) {
      Debug.trap("Only admin can clear completed requests");
    };

    let before_count = completed_claim_requests.size();
    completed_claim_requests := [];

    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Cleared completed claim requests, removed " # debug_show(before_count) # " entries");
    
    before_count;
  };

  // Admin: Clear failed requests array
  public shared ({ caller }) func admin_clear_failed_claim_requests() : async Nat {
    if (not isAdmin(caller)) {
      Debug.trap("Only admin can clear failed requests");
    };

    let before_count = failed_claim_requests.size();
    failed_claim_requests := [];

    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Cleared failed claim requests, removed " # debug_show(before_count) # " entries");
    
    before_count;
  };

  // Admin: Remove specific active request (pending/processing only)
  public shared ({ caller }) func admin_remove_active_claim_request(request_id : ClaimRequestId) : async Bool {
    if (not isAdmin(caller)) {
      Debug.trap("Only admin can remove claim requests");
    };

    let before_count = stable_claim_requests.size();
    stable_claim_requests := Array.filter<ClaimRequest>(stable_claim_requests, func (req) {
      req.request_id != request_id
    });
    let after_count = stable_claim_requests.size();

    let removed = before_count != after_count;
    if (removed) {
      let correlation_id = get_next_correlation_id();
      log_info(caller, correlation_id, "Removed active claim request " # debug_show(request_id));
    };
    
    removed;
  };

  // Admin: Manually trigger claim queue processing (immediate execution)
  public shared ({ caller }) func admin_trigger_claim_processing() : async Text {
    if (not isAdmin(caller)) {
      Debug.trap("Only admin can manually trigger claim processing");
    };

    let correlation_id = get_next_correlation_id();
    
    // Check if there are pending requests
    let pending_request = get_oldest_pending_request();
    if (pending_request == null) {
      log_info(caller, correlation_id, "No pending requests in queue");
      return "No pending requests to process";
    };

    // Check if already processing
    switch (claim_processing_timer_id) {
      case (?timer_id) {
        log_info(caller, correlation_id, "Timer already active (ID: " # debug_show(timer_id) # ")");
        return "Timer already active";
      };
      case null {
        // Ensure queue is active
        claim_queue_processing_state := #Active;
        
        // Start timer immediately
        let timer_id = Timer.setTimer<system>(#seconds(0), process_claim_queue);
        claim_processing_timer_id := ?timer_id;
        next_scheduled_timer_time := ?TimeAsNat64(Time.now());
        
        log_info(caller, correlation_id, "Manually triggered claim processing (Timer ID: " # debug_show(timer_id) # ")");
        return "Processing started with timer ID: " # debug_show(timer_id);
      };
    };
  };

  // Admin: Retry a specific claim request (reset to pending status)
  public shared ({ caller }) func admin_retry_claim_request(request_id : ClaimRequestId) : async {
    #Ok : Text;
    #Err : Text;
  } {
    if (not isAdmin(caller)) {
      Debug.trap("Only admin can retry claim requests");
    };

    let correlation_id = get_next_correlation_id();
    
    // Find the request in active requests
    let request_opt = Array.find<ClaimRequest>(stable_claim_requests, func (req) {
      req.request_id == request_id
    });

    switch (request_opt) {
      case (?request) {
        // Check if request is in a retryable state
        let is_retryable = switch (request.status) {
          case (#Failed(_)) { true };
          case (#TimedOut) { true };
          case (#Pending) { false }; // Already pending
          case (#Processing) { false }; // Currently processing
          case (#BalanceRecorded(_)) { false };
          case (#ClaimAttempted(_)) { false };
          case (#ClaimVerified(_)) { false };
          case (#Withdrawn(_)) { false };
          case (#Completed(_)) { false };
        };

        if (not is_retryable) {
          let msg = "Request " # debug_show(request_id) # " is not in a retryable state (current status: " # debug_show(request.status) # ")";
          log_info(caller, correlation_id, msg);
          return #Err(msg);
        };

        // Reset to pending (preserve retry_count and last_attempted_at for cooldown tracking)
        let updated_request : ClaimRequest = {
          request_id = request.request_id;
          caller = request.caller;
          swap_canister_id = request.swap_canister_id;
          position_id = request.position_id;
          token0 = request.token0;
          token1 = request.token1;
          status = #Pending;
          created_at = request.created_at;
          started_processing_at = null;
          completed_at = null;
          retry_count = request.retry_count;  // Preserve retry count
          last_attempted_at = request.last_attempted_at;  // Preserve for cooldown
        };

        // Update in array
        stable_claim_requests := Array.map<ClaimRequest, ClaimRequest>(
          stable_claim_requests,
          func (req) {
            if (req.request_id == request_id) {
              updated_request
            } else {
              req
            }
          }
        );

        log_info(caller, correlation_id, "Reset claim request " # debug_show(request_id) # " to pending status");
        
        // If queue is active and no timer running, start it
        switch (claim_queue_processing_state) {
          case (#Active) {
            switch (claim_processing_timer_id) {
              case null {
                ignore start_claim_queue_processor();
                log_info(caller, correlation_id, "Started queue processor for retried request");
              };
              case (?_) {}; // Already running
            };
          };
          case (#Paused(reason)) {
            log_info(caller, correlation_id, "Queue is paused (" # reason # "), request reset but not processing");
          };
        };

        #Ok("Request " # debug_show(request_id) # " reset to pending and queued for retry");
      };
      case null {
        // Check completed requests
        let completed_request_opt = Array.find<ClaimRequest>(completed_claim_requests, func (req) {
          req.request_id == request_id
        });
        
        switch (completed_request_opt) {
          case (?req) {
            let msg = "Request " # debug_show(request_id) # " is completed. It cannot be retried.";
            log_info(caller, correlation_id, msg);
            return #Err(msg);
          };
          case null {};
        };
        
        // Check failed requests - these CAN be retried!
        let failed_request_opt = Array.find<ClaimRequest>(failed_claim_requests, func (req) {
          req.request_id == request_id
        });
        
        switch (failed_request_opt) {
          case (?failed_request) {
            // Move from failed back to active with pending status
            let retried_request : ClaimRequest = {
              request_id = failed_request.request_id;
              caller = failed_request.caller;
              swap_canister_id = failed_request.swap_canister_id;
              position_id = failed_request.position_id;
              token0 = failed_request.token0;
              token1 = failed_request.token1;
              status = #Pending;
              created_at = failed_request.created_at;
              started_processing_at = null;
              completed_at = null;
              retry_count = 0;  // Reset retry count for manual retry
              last_attempted_at = null;  // Clear cooldown
            };
            
            // Add to active requests
            stable_claim_requests := Array.append(stable_claim_requests, [retried_request]);
            
            // Remove from failed requests
            failed_claim_requests := Array.filter<ClaimRequest>(failed_claim_requests, func (req) {
              req.request_id != request_id
            });
            
            log_info(caller, correlation_id, "Moved failed request " # debug_show(request_id) # " back to active queue with pending status");
            
            // Start queue processor if needed
            switch (claim_queue_processing_state) {
              case (#Active) {
                switch (claim_processing_timer_id) {
                  case null {
                    ignore start_claim_queue_processor();
                    log_info(caller, correlation_id, "Started queue processor for retried failed request");
                  };
                  case (?_) {}; // Already running
                };
              };
              case (#Paused(reason)) {
                log_info(caller, correlation_id, "Queue is paused (" # reason # "), request moved to active but not processing");
              };
            };
            
            return #Ok("Failed request " # debug_show(request_id) # " moved back to active queue for retry");
          };
          case null {
            let msg = "Request " # debug_show(request_id) # " not found in active, completed, or failed requests.";
            log_info(caller, correlation_id, msg);
            return #Err(msg);
          };
        };
      };
    };
  };

  // Admin: Rescue stuck tokens from sneed_lock principal
  // Use this to transfer any tokens stuck on sneed_lock's main account back to users
  // (e.g., if claim succeeded but transfer to user failed)
  public shared ({ caller }) func admin_rescue_stuck_tokens(
    token_ledger : TokenType,
    recipient : Principal
  ) : async {
    #Ok : Text;
    #Err : Text;
  } {
    if (not isAdmin(caller)) {
      Debug.trap("Only admin can rescue stuck tokens");
    };

    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Admin rescuing stuck tokens: ledger=" # debug_show(token_ledger) # ", recipient=" # debug_show(recipient));

    // Get token ledger actor
    let ledger = actor (Principal.toText(token_ledger)) : actor { 
      icrc1_fee : () -> async Nat;
      icrc1_balance_of : (account : Account) -> async Nat;
      icrc1_transfer : (args : TransferArgs) -> async T.TransferResult;
    };
    
    let fee = await ledger.icrc1_fee();
    let canister_account : Account = { owner = this_canister_id(); subaccount = null };
    let balance = await ledger.icrc1_balance_of(canister_account);

    log_info(caller, correlation_id, "Sneed_lock balance: " # debug_show(balance) # ", fee: " # debug_show(fee));

    // Check if there's anything to transfer
    if (balance <= fee) {
      let msg = "Nothing to rescue. Balance (" # debug_show(balance) # ") <= fee (" # debug_show(fee) # ")";
      log_info(caller, correlation_id, msg);
      return #Ok(msg);
    };

    let transfer_amount = balance - fee;
    let user_account : Account = { owner = recipient; subaccount = null };
    
    let transfer_args : TransferArgs = {
      from_subaccount = null;
      to = user_account;
      amount = transfer_amount;
      fee = ?fee;
      memo = null;
      created_at_time = null;
    };
    
    let transfer_result = await ledger.icrc1_transfer(transfer_args);
    switch (transfer_result) {
      case (#Ok(_)) {
        let success_msg = "Successfully rescued " # debug_show(transfer_amount) # " tokens to " # debug_show(recipient);
        log_info(caller, correlation_id, success_msg);
        #Ok(success_msg);
      };
      case (#Err(err)) {
        let error_msg = "Failed to rescue tokens: " # debug_show(err);
        log_error(caller, correlation_id, error_msg);
        #Err(error_msg);
      };
    };
  };

  // Admin: Set zero balance enforcement flag
  public shared ({ caller }) func admin_set_enforce_zero_balance_before_claim(enforce : Bool) : async () {
    if (not isAdmin(caller)) {
      Debug.trap("Only admin can set zero balance enforcement");
    };

    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Setting enforce_zero_balance_before_claim from " # debug_show(enforce_zero_balance_before_claim) # " to " # debug_show(enforce));
    
    enforce_zero_balance_before_claim := enforce;
  };

  // Query: Get zero balance enforcement status
  public query func get_enforce_zero_balance_before_claim() : async Bool {
    enforce_zero_balance_before_claim;
  };

  // Query: Get timer status
  public query func get_timer_status() : async {
    timer_id : ?Nat;
    last_execution_time : ?T.Timestamp;
    last_execution_correlation_id : ?Nat;
    next_scheduled_time : ?T.Timestamp;
    time_since_last_execution_seconds : ?Nat64;
    is_active : Bool;
  } {
    let now = TimeAsNat64(Time.now());
    let time_since_last : ?Nat64 = switch (last_timer_execution_time) {
      case (?last_time) {
        if (now >= last_time) {
          ?((now - last_time) / second_ns)
        } else {
          ?0
        }
      };
      case null { null };
    };

    {
      timer_id = claim_processing_timer_id;
      last_execution_time = last_timer_execution_time;
      last_execution_correlation_id = last_timer_execution_correlation_id;
      next_scheduled_time = next_scheduled_timer_time;
      time_since_last_execution_seconds = time_since_last;
      is_active = switch (claim_processing_timer_id) {
        case (?_) { true };
        case null { false };
      };
    };
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

    /// stable_position_locks
    stable_position_locks := get_fully_qualified_position_locks();

    /// archived locks
    var archived_token_locks_list = List.nil<(T.LockId, ArchivedTokenLock)>();
    for ((lock_id, archived_lock) in archived_token_locks.entries()) {
      archived_token_locks_list := List.push((lock_id, archived_lock), archived_token_locks_list);
    };
    archived_token_locks_stable := List.toArray(archived_token_locks_list);

    var archived_position_locks_list = List.nil<(T.LockId, ArchivedPositionLock)>();
    for ((lock_id, archived_lock) in archived_position_locks.entries()) {
      archived_position_locks_list := List.push((lock_id, archived_lock), archived_position_locks_list);
    };
    archived_position_locks_stable := List.toArray(archived_position_locks_list);
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

      /// stable_position_locks
      let stablePositionLocksIter : Iter.Iter<T.FullyQualifiedPositionLock> = stable_position_locks.vals();
      for (posLock in stablePositionLocksIter) {
        add_position_lock_for_principal(posLock.0, posLock.1, posLock.2);
      };
      stable_position_locks := [];

      /// archived locks
      for ((lock_id, archived_lock) in archived_token_locks_stable.vals()) {
        archived_token_locks.put(lock_id, archived_lock);
      };
      archived_token_locks_stable := [];

      for ((lock_id, archived_lock) in archived_position_locks_stable.vals()) {
        archived_position_locks.put(lock_id, archived_lock);
      };
      archived_position_locks_stable := [];
  };

  public query func get_token_position_locks(token_canister_id : T.TokenType) : async [T.FullyQualifiedPositionLock] {
    let all_position_locks = get_fully_qualified_position_locks();
    Array.filter<T.FullyQualifiedPositionLock>(all_position_locks, func (position_lock) {
      position_lock.2.token0 == token_canister_id or position_lock.2.token1 == token_canister_id
    });
  };
};