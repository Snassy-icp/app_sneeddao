import Principal "mo:base/Principal";
import Buffer "mo:base/Buffer";
import Option "mo:base/Option";
import Text "mo:base/Text";
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
import Error "mo:base/Error";

import Map "mo:map/Map";
import { phash; nhash; thash } "mo:map/Map";
import D "Dissolve";
import N "Nft";

import T "Types";

import CircularBuffer "CircularBuffer";
import PremiumClient "../PremiumClient";
import Timer "mo:base/Timer";

import Icrc3Log "../icrc3/Log";
import Icrc3Sns "../icrc3/SnsRegister";
import T3 "../icrc3/Types";

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
  type ClaimRequestStatus = T.ClaimRequestStatus;
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
  
  // Claim history (still in use)
  stable var completed_claim_requests : StableClaimRequests = []; // Completed claims with structured data
  stable var failed_claim_requests : StableClaimRequests = []; // Failed claims with structured data
  stable var next_claim_request_id : Nat = 0;

  // RETIRED claim-queue state. Fee claims are synchronous now (see
  // claim_position_fees), so nothing reads or writes these any more. They are
  // deliberately kept, with their original types, so the stable signature is
  // unchanged across the upgrade and no state migration is involved.
  stable var stable_claim_requests : StableClaimRequests = []; // retired: was the active request queue
  stable var claim_queue_processing_state : QueueProcessingState = #Active; // retired
  stable var claim_requests_processed_in_batch : Nat = 0; // retired
  stable var enforce_zero_balance_before_claim : Bool = true; // retired (was never read)
  stable var last_timer_execution_time : ?T.Timestamp = null; // retired
  stable var last_timer_execution_correlation_id : ?Nat = null; // retired
  stable var consecutive_empty_processing_cycles : Nat = 0; // retired
  stable var is_processing_claim_queue : Bool = false; // retired
  stable var claim_processing_timer_id : ?Nat = null; // retired
 
  
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

  // Dissolve delays (spec/sneed_lock_v2.md, section 1; rules in Dissolve.mo). One entry per
  // lock that has or had a delay, kept after the lock is archived so its history reads
  // right. A lock's record carries the EFFECTIVE expiry (Dissolve.effectiveExpiry), so
  // every existing expiry check keeps deciding correctly what is locked.
  stable var dissolve_infos = Map.new<Nat, D.Info>();
  // Token locks whose ownership transfer is awaiting the ledger. Their record sits with the
  // recipient and is put back from a copy if the transfer fails, so nothing may change
  // them meanwhile.
  transient var lock_ids_in_flight = Map.new<Nat, ()>();
  // Positions whose withdrawal is awaiting the pool. Their claim must not change hands
  // meanwhile: the withdrawal clears the withdrawer's claim afterwards, so a recipient would
  // be left holding a claim on a position that has left.
  transient var positions_in_flight = Map.new<Text, ()>();
  private func position_key(swap_canister_id : Principal, position_id : T.PositionId) : Text {
    Principal.toText(swap_canister_id) # ":" # Nat.toText(position_id)
  };
  // When each lock was created (lock id -> ns). Locks created before this was kept get
  // their time once from the ICRC-3 log's create blocks (postupgrade); locks older than
  // the log have none. Kept after a lock is archived.
  stable var lock_created_at = Map.new<Nat, Nat64>();
  stable var lock_created_at_backfilled : Bool = false;

  // LP locks as NFTs, ICRC-7 with ICRC-37 (spec/sneed_lock_v2.md, sections 2 and 3). One NFT
  // per position held here that has been locked at least once; its id is the lock id of the
  // position's first lock and stays through extensions and re-locks. Its owner is the
  // principal holding the position's claim; the label says which of that principal's
  // accounts holds it (absent = the default account). Burned when the position leaves.
  stable var nft_tokens = Map.new<Nat, N.Position>();               // token id -> position
  stable var nft_by_position = Map.new<Text, Nat>();                // position_key -> token id
  stable var nft_labels = Map.new<Nat, Blob>();                     // token id -> subaccount
  stable var nft_token_approvals = Map.new<Nat, [N.ApprovalInfo]>(); // of the token's current owner account
  stable var nft_collection_approvals = Map.new<Text, [N.ApprovalInfo]>(); // owner accountKey -> approvals
  stable var nft_recent = Map.new<Text, (Nat64, Nat)>();            // dedup: request -> (created_at_time, block)
  stable var nft_activated : Bool = false;                          // existing positions minted once
  stable var ledger_symbols = Map.new<Principal, Text>();           // for NFT names and cards

  // ICRC-3 activity log: hash-chained, certified blocks of every action, with
  // archive canisters for old blocks. Library: src/icrc3; design and the block
  // catalogue of this canister: spec/sneed_lock_icrc3.md.
  stable var icrc3 : Icrc3Log.State = Icrc3Log.init();
  transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();
  transient let sneed_sns_root = Principal.fromText("fp274-iaaaa-aaaaq-aacha-cai");
  

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

  // In-flight guard for a caller's token subaccount (transient — intentionally
  // reset on upgrade). A caller's locked tokens sit in their own subaccount and
  // are protected only by the balance-vs-sum_locked check in the transfer paths.
  // On ICP every await is a commit point and concurrent ingress messages
  // interleave, so without serialization two concurrent transfer_tokens (or
  // transfer_token_lock_ownership) calls can each pass that check across the
  // ledger awaits and collectively move out more than the unlocked balance,
  // dipping into locked funds. This set serializes those operations per caller.
  transient var token_op_locks = Map.new<Principal, ()>();

  private func is_token_op_locked(p : Principal) : Bool {
    Map.has(token_op_locks, phash, p);
  };
  private func lock_token_op(p : Principal) {
    Map.set(token_op_locks, phash, p, ());
  };
  private func unlock_token_op(p : Principal) {
    Map.delete(token_op_locks, phash, p);
  };

  // ---------------------------------------------------------------------------
  // ICPSwap pool account coordination
  //
  // This canister has one account per pool, shared by every user whose locked
  // position lives here. Two kinds of operation touch it: fee claims (the pool
  // credits the fees to the account, then delivers them to the owner's wallet
  // subaccount from its own withdraw queue a moment later) and liquidity
  // additions (deposit, add, return the unused remainder).
  //
  // Serialization is a transient per-pool mutex held for the duration of one
  // call and released in `finally`: no queue, no timers, no persisted state. A
  // caller that finds the pool busy is told to retry.
  //
  // Exact accounting for a liquidity addition needs the account to be quiet:
  // no claim delivery in transit. Claimed amounts at or below the ledger fee are
  // credited by the pool but never delivered, so the account accumulates dust.
  // `pool_quiescent_balances` tracks that expected resting level per pool; an
  // addition starts only when the live balance equals it (anything above it is
  // a delivery in transit) and measures its own leftover as the delta from it.
  // The level is transient and re-baselined from the live balance after an
  // upgrade; a balance below the level simply becomes the new level, since the
  // only way it can drop is a delivery completing.
  // ---------------------------------------------------------------------------
  transient var pool_op_locks = Map.new<Principal, ()>();
  private func is_pool_op_locked(p : Principal) : Bool { Map.has(pool_op_locks, phash, p) };
  private func lock_pool_op(p : Principal) { Map.set(pool_op_locks, phash, p, ()) };
  private func unlock_pool_op(p : Principal) { Map.delete(pool_op_locks, phash, p) };

  transient var pool_quiescent_balances = Map.new<Principal, (Nat, Nat)>();

  // Record dust that a claim credited but the pool will never deliver.
  private func note_pool_dust(pool_id : Principal, dust0 : Nat, dust1 : Nat) {
    switch (Map.get(pool_quiescent_balances, phash, pool_id)) {
      case (?(l0, l1)) { Map.set(pool_quiescent_balances, phash, pool_id, (l0 + dust0, l1 + dust1)) };
      case null {}; // not baselined yet; the first baseline will include it
    };
  };

  type IcpSwapPool = actor {
    getUserUnusedBalance : (principal : Principal) -> async { #ok : { balance0 : Nat; balance1 : Nat }; #err : T.SwapCanisterError };
    deposit : (args : { token : Text; amount : Nat; fee : Nat }) -> async { #ok : Nat; #err : T.SwapCanisterError };
    increaseLiquidity : (args : { positionId : Nat; amount0Desired : Text; amount1Desired : Text }) -> async { #ok : Nat; #err : T.SwapCanisterError };
    withdrawToSubaccount : (args : { token : Text; amount : Nat; fee : Nat; subaccount : Blob }) -> async { #ok : Nat; #err : T.SwapCanisterError };
  };
  type Icrc1Ledger = actor {
    icrc1_fee : () -> async Nat;
    icrc1_balance_of : (account : Account) -> async Nat;
    icrc1_transfer : (args : TransferArgs) -> async T.TransferResult;
  };

  public query func get_all_token_locks() : async [T.FullyQualifiedLock] {
    get_fully_qualified_locks();
  };

  // Get only active (non-expired) token locks
  public query func get_active_token_locks() : async [T.FullyQualifiedLock] {
    let now = Nat64.fromIntWrap(Time.now());
    let all_locks = get_fully_qualified_locks();
    Array.filter<T.FullyQualifiedLock>(all_locks, func (lock) { lock.2.expiry > now; });
  };

  // Get only expired token locks (includes both active expired locks and archived locks)
  public query func get_expired_token_locks() : async [T.FullyQualifiedLock] {
    let now = Nat64.fromIntWrap(Time.now());
    
    // Get expired locks from active locks (not yet archived)
    let all_locks = get_fully_qualified_locks();
    let expired_active = Array.filter<T.FullyQualifiedLock>(all_locks, func (lock) { lock.2.expiry <= now; });
    
    // Get all archived locks (these are by definition expired)
    var archived_list = List.nil<T.FullyQualifiedLock>();
    for ((_lock_id, archived) in archived_token_locks.entries()) {
      archived_list := List.push((archived.owner, archived.token_type, archived.lock), archived_list);
    };
    let archived_array = List.toArray(archived_list);
    
    // Combine both arrays
    Array.append(expired_active, archived_array);
  };

  // Get all token locks for a specific ledger (includes both active and archived locks)
  public query func get_ledger_token_locks(ledger_canister_id : T.TokenType) : async [T.FullyQualifiedLock] {
    // Get active locks for this ledger
    let all_locks = get_fully_qualified_locks();
    let active_locks = Array.filter<T.FullyQualifiedLock>(all_locks, func (lock) { lock.1 == ledger_canister_id; });
    
    // Get archived locks for this ledger
    var archived_list = List.nil<T.FullyQualifiedLock>();
    for ((_lock_id, archived) in archived_token_locks.entries()) {
      if (archived.token_type == ledger_canister_id) {
        archived_list := List.push((archived.owner, archived.token_type, archived.lock), archived_list);
      };
    };
    let archived_array = List.toArray(archived_list);
    
    // Combine both arrays
    Array.append(active_locks, archived_array);
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

  // Get only expired position locks (includes both active expired locks and archived locks)
  public query func get_expired_position_locks() : async [T.FullyQualifiedPositionLock] {
    let now = Nat64.fromIntWrap(Time.now());
    
    // Get expired locks from active locks (not yet archived)
    let all_position_locks = get_fully_qualified_position_locks();
    let expired_active = Array.filter<T.FullyQualifiedPositionLock>(all_position_locks, func (lock) { lock.2.expiry <= now; });
    
    // Get all archived position locks (these are by definition expired)
    var archived_list = List.nil<T.FullyQualifiedPositionLock>();
    for ((_lock_id, archived) in archived_position_locks.entries()) {
      archived_list := List.push((archived.owner, archived.swap_canister_id, archived.lock), archived_list);
    };
    let archived_array = List.toArray(archived_list);
    
    // Combine both arrays
    Array.append(expired_active, archived_array);
  };

  // Get all position locks for a specific swap canister (includes both active and archived locks)
  public query func get_swap_position_locks(swap_canister_id : T.SwapCanisterId) : async [T.FullyQualifiedPositionLock] {
    // Get active locks for this swap canister
    let all_position_locks = get_fully_qualified_position_locks();
    let active_locks = Array.filter<T.FullyQualifiedPositionLock>(all_position_locks, func (position_lock) { position_lock.1 == swap_canister_id; });
    
    // Get archived locks for this swap canister
    var archived_list = List.nil<T.FullyQualifiedPositionLock>();
    for ((_lock_id, archived) in archived_position_locks.entries()) {
      if (archived.swap_canister_id == swap_canister_id) {
        archived_list := List.push((archived.owner, archived.swap_canister_id, archived.lock), archived_list);
      };
    };
    let archived_array = List.toArray(archived_list);
    
    // Combine both arrays
    Array.append(active_locks, archived_array);
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

  /// True when `principal` holds a claim on the position and nobody else does. A claim records
  /// that its holder owned the position on the pool when claiming; a claim left behind after
  /// the position moved to someone else at the pool must never act for it (claim_position
  /// removes such claims, and this refuses any that predate that).
  private func has_claimed_position_impl(principal : Principal, swap_canister_id : T.SwapCanisterId, position_id : T.PositionId): Bool {
    if (not has_claim_record(principal, swap_canister_id, position_id)) { return false };
    for (other in state.principal_position_ownerships.keys()) {
      if (other != principal and has_claim_record(other, swap_canister_id, position_id)) { return false };
    };
    true;
  };

  /// Every principal holding a claim on the position.
  private func position_claimants(swap_canister_id : T.SwapCanisterId, position_id : T.PositionId) : [Principal] {
    Iter.toArray(Iter.filter<Principal>(state.principal_position_ownerships.keys(), func(p) { has_claim_record(p, swap_canister_id, position_id) }));
  };

  /// An unexpired lock on the position, whoever's record it is in.
  private func position_has_active_lock(swap_canister_id : T.SwapCanisterId, position_id : T.PositionId) : Bool {
    let now = NowAsNat64();
    for (owner in state.principal_position_locks.keys()) {
      switch (get_position_lock(owner, swap_canister_id, position_id)) {
        case (?l) { if (l.expiry > now) { return true } };
        case null {};
      };
    };
    false;
  };

  private func has_claim_record(principal : Principal, swap_canister_id : T.SwapCanisterId, position_id : T.PositionId): Bool {
      
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
      // The pool says the caller owns the position now, so it is not in this canister and
      // any other claim on it is left over from an earlier owner: remove those, or they
      // could take the position once the caller deposits and locks it.
      let stale = Array.filter<Principal>(position_claimants(swap_canister_id, position_id), func(p) { p != caller });
      for (p in stale.vals()) { clear_position_claim(p, swap_canister_id, position_id) };
      if (stale.size() > 0) {
        log_info(caller, correlation_id, "Removed stale claims on position " # debug_show(position_id) # " on swap canister " # debug_show(swap_canister_id) # " of " # debug_show(stale));
      };
      add_position_ownership_for_principal(caller, swap_canister_id, position_id);
      icrc3_add("sneedlock_position_claim", Array.append<(Text, T3.Value)>([
        ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("owner", Icrc3Log.principal(caller)),
        ("pool", Icrc3Log.principal(swap_canister_id)), ("position_id", #Nat(position_id)),
      ], if (stale.size() > 0) { [("removed_claims", #Array(Array.map<Principal, T3.Value>(stale, Icrc3Log.principal)))] } else { [] }));
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

    // Serialize with any other token operation on this caller's subaccount.
    // Without this, two concurrent calls both read balance/sum_locked before
    // either transfer settles, both pass the check, and together they move out
    // more than the unlocked balance — draining locked funds.
    if (is_token_op_locked(caller)) {
      let error = #Err(#GenericError{
        message = "A token operation is already in progress for caller: " # debug_show(caller);
        error_code = 2;
      });
      log_error(caller, correlation_id, debug_show(error));
      return error;
    };
    lock_token_op(caller);

    try {
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
      case (#Ok(tx_index)) {
        log_info(caller, correlation_id, "Transfer complete. Args: " # debug_show(transfer_args) # ". Result: " # debug_show(result));
        icrc3_add("sneedlock_token_withdraw", [
          ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("ledger", Icrc3Log.principal(icrc1_ledger_canister_id)),
          ("amount", #Nat(amount)), ("to", Icrc3Log.account(to_principal, to_subaccount)), ("ledger_tx", #Nat(tx_index)),
        ]);
      };
      case (#Err(_)) {
        log_error(caller, correlation_id, "Transfer Failed. Args: " # debug_show(transfer_args) # ". Result: " # debug_show(result));
      };
    };

    return result;
    } finally {
      unlock_token_op(caller);
    };
  };

  public shared ({ caller }) func transfer_position(to : Principal, swap_canister_id : Principal, position_id : T.PositionId) : async T.TransferPositionResult /*ClaimPositionResult*/ {

    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Transferring position " # Nat.toText(position_id) # " on swap canister " # debug_show(swap_canister_id) # " to " # debug_show(to));

    // A position under an active lock must stay in this canister until the
    // lock expires. Without this check the owner could withdraw a "locked"
    // position at any time with a direct call, which would make the lock
    // meaningless. Expired locks are archived first so they do not block.
    clear_expired_position_locks_for_principal(caller, correlation_id);
    switch (get_position_lock(caller, swap_canister_id, position_id)) {
      case (?lock) {
        if (lock.expiry > NowAsNat64()) {
          let error = #err(#InternalError("Position " # Nat.toText(position_id) # " on swap canister " # debug_show(swap_canister_id) # " is locked until " # Nat64.toText(lock.expiry) # " (ns since epoch) and cannot be withdrawn before the lock expires"));
          log_error(caller, correlation_id, debug_show(error));
          return error;
        };
      };
      case null {};
    };
    // Whoever's record the lock is in: a lock binds the position, not only its owner's claim.
    if (position_has_active_lock(swap_canister_id, position_id)) {
      let error = #err(#InternalError("Position " # Nat.toText(position_id) # " on swap canister " # debug_show(swap_canister_id) # " is locked and cannot be withdrawn before the lock expires"));
      log_error(caller, correlation_id, debug_show(error));
      return error;
    };

    // Ensure the position is currently controlled by this canister
    if (await verify_position_ownership(this_canister_id(), swap_canister_id, position_id)) {

      // Ensure the caller has claimed ownership of the position
      if (has_claimed_position_impl(caller, swap_canister_id, position_id)) {

        let swap_canister = actor (Principal.toText(swap_canister_id)) : actor {
            transferPosition(from : Principal, to : Principal, positionId : Nat) : async T.TransferPositionResult;
        };

        let pkey = position_key(swap_canister_id, position_id);
        if (Map.has(positions_in_flight, thash, pkey)) {
          return #err(#InternalError("A withdrawal of this position is already in progress"));
        };
        Map.set(positions_in_flight, thash, pkey, ());
        let result = try { await swap_canister.transferPosition(this_canister_id(), to, position_id) } catch (e) {
          Map.delete(positions_in_flight, thash, pkey);
          throw e;
        };
        Map.delete(positions_in_flight, thash, pkey);

        // if result is #ok, we can clear the position claim. this code uses the switch keyword.
        switch (result) {
          case (#ok(_)) {
            clear_position_claim(caller, swap_canister_id, position_id);
            // The position has left: its NFT is burned.
            switch (Map.get(nft_by_position, thash, pkey)) {
              case (?t) { nft_burn(t, { owner = caller; subaccount = Map.get(nft_labels, nhash, t) }) };
              case null {};
            };
            icrc3_add("sneedlock_position_withdraw", [
              ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("owner", Icrc3Log.principal(caller)), ("to", Icrc3Log.principal(to)),
              ("pool", Icrc3Log.principal(swap_canister_id)), ("position_id", #Nat(position_id)),
            ]);
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

  /// Moves a position's claim and its lock record from one principal to another, and logs it.
  /// The caller has checked that `from` is the position's only claimant. No awaits.
  private func move_position(caller : Principal, correlation_id : Nat, from : Principal, to_principal : Principal, swap_canister_id : T.SwapCanisterId, position_id : T.PositionId) : ?T.PositionLock {
    // Transfer the position ownership
    clear_position_claim(from, swap_canister_id, position_id);
    add_position_ownership_for_principal(to_principal, swap_canister_id, position_id);
    log_info(caller, correlation_id, "Transferred position ownership from " # debug_show(from) # " to " # debug_show(to_principal) # " for position " # debug_show(position_id));

    // If there's a lock on this position, transfer it to the new owner
    let removed_lock = remove_position_lock_from_principal(from, swap_canister_id, position_id);
    switch (removed_lock) {
      case (?lock) {
        add_position_lock_for_principal(to_principal, swap_canister_id, lock);
        log_info(caller, correlation_id, "Transferred position lock from " # debug_show(from) # " to " # debug_show(to_principal) # " for position " # debug_show(position_id) # ": " # debug_show(lock));
      };
      case null {
        log_info(caller, correlation_id, "No position lock to transfer for position " # debug_show(position_id));
      };
    };

    let position_transfer_tx : [(Text, T3.Value)] = [
      ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("from", Icrc3Log.principal(from)), ("to", Icrc3Log.principal(to_principal)),
      ("pool", Icrc3Log.principal(swap_canister_id)), ("position_id", #Nat(position_id)),
    ];
    icrc3_add("sneedlock_position_transfer", switch (removed_lock) {
      case (?lock) { Array.append(position_transfer_tx, [("lock_id", #Nat(lock.lock_id)), ("expiry", Icrc3Log.nat64(lock.expiry))]) };
      case null { position_transfer_tx };
    });
    removed_lock;
  };

  public shared ({ caller }) func transfer_position_ownership(to_principal : Principal, swap_canister_id : T.SwapCanisterId, position_id : T.PositionId) : async TransferPositionOwnershipResult {
    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Transferring position ownership from " # debug_show(caller) # " to " # debug_show(to_principal) # " for position " # debug_show(position_id) # " on swap canister " # debug_show(swap_canister_id));

    if (Map.has(positions_in_flight, thash, position_key(swap_canister_id, position_id))) {
      return #Err({ message = "A withdrawal of this position is in progress" });
    };

    // Verify that the caller is the current owner
    if (not has_claimed_position_impl(caller, swap_canister_id, position_id)) {
      let error = #Err({
        message = "Caller is not the owner of position " # debug_show(position_id) # " on swap canister " # debug_show(swap_canister_id);
      });
      log_error(caller, correlation_id, debug_show(error));
      return error;
    };

    let tid = Map.get(nft_by_position, thash, position_key(swap_canister_id, position_id));
    let from_label = switch (tid) { case (?t) Map.get(nft_labels, nhash, t); case null null };
    ignore move_position(caller, correlation_id, caller, to_principal, swap_canister_id, position_id);
    // The NFT goes along, to the recipient's default account (this call names no subaccount).
    switch (tid) {
      case (?t) { ignore nft_after_move(t, { owner = caller; subaccount = from_label }, { owner = to_principal; subaccount = null }, null, null, null) };
      case null {};
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

    // Serialize with any other token operation on this caller's subaccount so a
    // concurrent transfer_tokens / ownership transfer can't race this one and
    // double-spend the tokens or duplicate the lock across the ledger awaits below.
    if (is_token_op_locked(caller)) {
      let error = #Err({
        message = "A token operation is already in progress for caller: " # debug_show(caller);
        transfer_error = null;
      });
      log_error(caller, correlation_id, debug_show(error));
      return error;
    };
    lock_token_op(caller);
    Map.set(lock_ids_in_flight, nhash, lock_id, ());

    try {
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

        // All validations passed. Move the lock from the caller to the recipient
        // BEFORE transferring the tokens. Recording the recipient's lock first
        // guarantees that once the tokens land in the recipient's subaccount there
        // is already a lock covering them, so the recipient can never observe the
        // incoming tokens as unlocked (and withdraw them) in the window between the
        // transfer settling and the lock being recorded.
        remove_token_lock(caller, token_type, lock_id);
        add_lock_for_principal(to_principal, token_type, found_lock);
        log_info(caller, correlation_id, "Moved lock " # debug_show(lock_id) # " from " # debug_show(caller) # " to " # debug_show(to_principal) # " (pending token transfer)");

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

        // A thrown call (as opposed to a returned #Err) is handled by its error
        // code. Codes that guarantee the call never executed (not delivered, or
        // the ledger trapped and rolled back) are rolled back exactly like #Err.
        // Any other code is ambiguous — the transfer may have landed — so the
        // lock is kept on the recipient AND restored to the caller: whichever
        // subaccount now holds the tokens is covered by a lock, at the cost of
        // temporarily over-locking the other until expiry. Never leave either
        // side's tokens unlocked.
        let transfer_result = try {
          await icrc1_ledger_canister.icrc1_transfer(transfer_args);
        } catch e {
          let not_executed = switch (Error.code(e)) {
            case (#system_fatal or #system_transient or #destination_invalid or #canister_error) { true };
            case _ { false };
          };
          if (not_executed) {
            remove_token_lock(to_principal, token_type, lock_id);
          };
          if (not not_executed) {
            // The transfer may have landed: the lock is now held for both
            // parties until reconciled, and the log says so.
            icrc3_add("sneedlock_token_lock_transfer", [
              ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("from", Icrc3Log.principal(caller)), ("to", Icrc3Log.principal(to_principal)),
              ("ledger", Icrc3Log.principal(token_type)), ("lock_id", #Nat(lock_id)), ("amount", #Nat(found_lock.amount)),
              ("expiry", Icrc3Log.nat64(found_lock.expiry)), ("outcome", #Text("uncertain")),
            ]);
          };
          add_lock_for_principal(caller, token_type, found_lock);
          let error = #Err({
            message = if (not_executed) {
              "Ledger call failed (not executed); lock restored to caller: " # Error.message(e);
            } else {
              "Ledger call failed with unknown outcome; lock kept on both caller and recipient pending reconciliation (correlation id " # debug_show(correlation_id) # "): " # Error.message(e);
            };
            transfer_error = null;
          });
          log_error(caller, correlation_id, "Token transfer threw: " # debug_show(error));
          return error;
        };

        switch (transfer_result) {
          case (#Err(transfer_error)) {
            // Roll back the optimistic lock move: the transfer failed, so remove
            // the lock we added to the recipient and restore it to the caller.
            remove_token_lock(to_principal, token_type, lock_id);
            add_lock_for_principal(caller, token_type, found_lock);
            let error = #Err({
              message = "Failed to transfer tokens from caller's subaccount to recipient's subaccount";
              transfer_error = ?transfer_error;
            });
            log_error(caller, correlation_id, "Token transfer failed: " # debug_show(error));
            return error;
          };
          case (#Ok(tx_index)) {
            // The lock was already recorded on the recipient above.
            log_info(caller, correlation_id, "Transferred " # Nat.toText(found_lock.amount) # " tokens from " # debug_show(caller) # " to " # debug_show(to_principal) # " with tx_index: " # debug_show(tx_index));

            icrc3_add("sneedlock_token_lock_transfer", [
              ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("from", Icrc3Log.principal(caller)), ("to", Icrc3Log.principal(to_principal)),
              ("ledger", Icrc3Log.principal(token_type)), ("lock_id", #Nat(lock_id)), ("amount", #Nat(found_lock.amount)),
              ("expiry", Icrc3Log.nat64(found_lock.expiry)), ("ledger_tx", #Nat(tx_index)), ("outcome", #Text("ok")),
            ]);
            log_info(caller, correlation_id, "Successfully transferred token lock ownership from " # debug_show(caller) # " to " # debug_show(to_principal) # " for lock " # debug_show(lock_id));
            #Ok;
          };
        };
      };
    };
    } finally {
      unlock_token_op(caller);
      Map.delete(lock_ids_in_flight, nhash, lock_id);
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

  /// `dissolve_delay` (v2, optional): with one, the lock period may be zero, the limits apply
  /// to period + delay, and the tokens stay locked until the lock has dissolved.
  public shared ({ caller }) func create_lock(amount : Nat, icrc1_ledger_canister_id : Principal, expires_at : Expiry, dissolve_delay : ?Nat64) : async CreateLockResult {
      
      let correlation_id = get_next_correlation_id();
      log_info(caller, correlation_id, " Creating lock for " # debug_show(amount) 
        # " tokens of ledger " # debug_show(icrc1_ledger_canister_id) # " that expires at " # debug_show(expires_at));

      // Sneed DAO token cannot be locked
      
      let delay : Nat64 = switch (dissolve_delay) { case (?d) d; case null 0 };
      if (delay > 0) {
        switch (D.createRefusal(NowAsNat64(), expires_at, delay, lock_limits())) {
          case (?why) {
            let error = #Err({ message = why; transfer_error = null });
            log_error(caller, correlation_id, debug_show(error));
            return error;
          };
          case null {};
        };
      } else {
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

      // Step 2: Create the lock. With a delay its record carries NEVER until it dissolves.
      let lock = add_new_lock_for_principal(caller, icrc1_ledger_canister_id, amount, if (delay > 0) { D.NEVER } else { expires_at });
      Map.set(lock_created_at, nhash, lock.lock_id, NowAsNat64());
      if (delay > 0) {
        Map.set(dissolve_infos, nhash, lock.lock_id, { lock_end = D.clampEnd(NowAsNat64(), expires_at); delay = delay; dissolving_until = null } : D.Info);
      };
      log_info(caller, correlation_id, "Created lock:" # debug_show(lock));
      icrc3_add("sneedlock_token_lock_create", Array.append<(Text, T3.Value)>([
        ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("owner", Icrc3Log.principal(caller)),
        ("ledger", Icrc3Log.principal(icrc1_ledger_canister_id)), ("lock_id", #Nat(lock.lock_id)),
        ("amount", #Nat(amount)), ("expiry", Icrc3Log.nat64(expires_at)),
      ], if (delay > 0) { [("dissolve_delay", Icrc3Log.nat64(delay))] } else { [] }));

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
    token1 : T.TokenType,
    dissolve_delay : ?Nat64) : async T.CreateLockResult {
      let correlation_id = get_next_correlation_id();
      log_info(caller, correlation_id, "Creating position lock for " # debug_show(caller) # " on swap canister " # debug_show(swap_canister_id) # " for position " # debug_show(position_id) # " to expire at " # debug_show(expires_at));
      let result = await create_or_update_position_lock(caller, correlation_id, swap_canister_id, ?dex, position_id, expires_at, ?token0, ?token1, dissolve_delay);
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
      let result = await create_or_update_position_lock(caller, correlation_id, swap_canister_id, null, position_id, expires_at, null, null, null);
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
    token1 : ?T.TokenType,
    dissolve_delay : ?Nat64) : async T.CreateLockResult {

      let delay : Nat64 = switch (dissolve_delay) { case (?d) d; case null 0 };
      // A lock that already has a dissolve delay is extended by the dissolve rules, checked
      // after the ownership check below. A delay is only set when a lock is created.
      let existing_has_delay = switch (get_position_lock(caller, swap_canister_id, position_id)) {
        case (?pl) { Map.get(dissolve_infos, nhash, pl.lock_id) != null and pl.expiry > NowAsNat64() };
        case null false;
      };
      if (delay > 0) {
        if (get_position_lock(caller, swap_canister_id, position_id) != null and existing_has_delay) {
          return #Err({ message = "This position is already locked; use increase_dissolve_delay to change its delay."; transfer_error = null });
        };
        switch (D.createRefusal(NowAsNat64(), expires_at, delay, lock_limits())) {
          case (?why) { return #Err({ message = why; transfer_error = null }) };
          case null {};
        };
      } else if (not existing_has_delay) {
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

            // Step 2: Create the position lock. With a delay its record carries NEVER until it dissolves.
            let new_position_lock = add_new_position_lock_for_principal(
              caller, correlation_id, swap_canister_id, dex_value, position_id, if (delay > 0) { D.NEVER } else { expires_at }, token0_value, token1_value);
            Map.set(lock_created_at, nhash, new_position_lock.lock_id, NowAsNat64());
            if (delay > 0) {
              Map.set(dissolve_infos, nhash, new_position_lock.lock_id, { lock_end = D.clampEnd(NowAsNat64(), expires_at); delay = delay; dissolving_until = null } : D.Info);
            };
            icrc3_add("sneedlock_position_lock_create", Array.append<(Text, T3.Value)>([
              ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("owner", Icrc3Log.principal(caller)),
              ("pool", Icrc3Log.principal(swap_canister_id)), ("position_id", #Nat(position_id)), ("lock_id", #Nat(new_position_lock.lock_id)),
              ("expiry", Icrc3Log.nat64(expires_at)), ("token0", Icrc3Log.principal(token0_value)), ("token1", Icrc3Log.principal(token1_value)), ("dex", #Nat(dex_value)),
            ], if (delay > 0) { [("dissolve_delay", Icrc3Log.nat64(delay))] } else { [] }));
            // Its NFT, unless the position has one from an earlier lock (re-locked after expiry).
            if (not Map.has(nft_by_position, thash, position_key(swap_canister_id, position_id))) {
              nft_mint(new_position_lock.lock_id, swap_canister_id, position_id, caller, "lock");
            };
            schedule_symbol_fill<system>([token0_value, token1_value]);

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
            if (delay > 0) {
              return #Err({ message = "This position is already locked; use increase_dissolve_delay to give it a delay."; transfer_error = null });
            };
            // A lock with a dissolve delay is extended by the dissolve rules (its record
            // carries the effective expiry, not the end of its lock period).
            switch (Map.get(dissolve_infos, nhash, locked_position.lock_id)) {
              case (?_) {
                return switch (change_lock(caller, locked_position.lock_id, #Extend(expires_at), correlation_id)) {
                  case (#Ok(st)) #Ok(st.lock_id);
                  case (#Err(e)) #Err({ message = lock_op_error_text(e); transfer_error = null });
                };
              };
              case null {};
            };
            if (expires_at < locked_position.expiry) {
                return #Err({
                  message = "New expiry is before current expiry.";
                  transfer_error = null;
                });
            };
            
            update_position_lock_expiry(caller, correlation_id, swap_canister_id, locked_position, expires_at);
            let lock_id = locked_position.lock_id;
            icrc3_add("sneedlock_position_lock_extend", [
              ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("owner", Icrc3Log.principal(caller)),
              ("pool", Icrc3Log.principal(swap_canister_id)), ("position_id", #Nat(position_id)), ("lock_id", #Nat(lock_id)),
              ("old_expiry", Icrc3Log.nat64(locked_position.expiry)), ("expiry", Icrc3Log.nat64(expires_at)),
            ]);
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
  // v2: dissolve delays, extending token locks, and one view of a lock for integrators
  // (spec/sneed_lock_v2.md)
  ////////////////

  private func lock_limits() : D.Limits { { min = min_lock_length_ns; max = max_lock_length_ns } };

  /// Every ACTIVE record of this lock id. More than one means a transfer whose outcome was
  /// unknown left it on both owners pending reconciliation (transfer_token_lock_ownership).
  private func token_lock_records(lock_id : T.LockId) : [(Principal, TokenType, Lock)] {
    var out = List.nil<(Principal, TokenType, Lock)>();
    for ((owner, token_locks_map) in state.principal_token_locks.entries()) {
      for ((token_type, locks_list) in token_locks_map.entries()) {
        for (lock in List.toIter(locks_list)) {
          if (lock.lock_id == lock_id) { out := List.push((owner, token_type, lock), out) };
        };
      };
    };
    List.toArray(out);
  };

  private func position_lock_records(lock_id : T.LockId) : [(Principal, T.SwapCanisterId, T.PositionLock)] {
    var out = List.nil<(Principal, T.SwapCanisterId, T.PositionLock)>();
    for ((owner, position_locks_map) in state.principal_position_locks.entries()) {
      for ((swap, locks_list) in position_locks_map.entries()) {
        for (lock in List.toIter(locks_list)) {
          if (lock.lock_id == lock_id) { out := List.push((owner, swap, lock), out) };
        };
      };
    };
    List.toArray(out);
  };

  private func lock_op_error_text(e : T.LockOpError) : Text {
    switch (e) {
      case (#NotFound) "No such lock.";
      case (#NotOwner) "Only the lock's owner can change it.";
      case (#InProgress) "A transfer of this lock is in progress; try again shortly.";
      case (#Invalid(why)) why;
    }
  };

  private func token_lock_state(owner : Principal, ledger : TokenType, lock : Lock, archived : Bool) : T.LockState {
    let info = Map.get(dissolve_infos, nhash, lock.lock_id);
    {
      lock_id = lock.lock_id; kind = #TokenLock; owner; owner_subaccount = null;
      ledger = ?ledger; amount = ?lock.amount;
      swap_canister_id = null; position_id = null; token0 = null; token1 = null;
      lock_end = switch (info) { case (?i) i.lock_end; case null lock.expiry };
      dissolve_delay = switch (info) { case (?i) i.delay; case null 0 };
      dissolving_until = switch (info) { case (?i) i.dissolving_until; case null null };
      expiry = lock.expiry; locked = lock.expiry > NowAsNat64(); archived;
      earliest_unlock = switch (info) { case (?i) D.earliestUnlock(i, NowAsNat64()); case null lock.expiry };
      created_at = Map.get(lock_created_at, nhash, lock.lock_id);
    }
  };

  private func position_lock_state(owner : Principal, swap : T.SwapCanisterId, lock : T.PositionLock, archived : Bool) : T.LockState {
    let info = Map.get(dissolve_infos, nhash, lock.lock_id);
    {
      lock_id = lock.lock_id; kind = #PositionLock; owner;
      owner_subaccount = if (archived) { null } else {
        switch (Map.get(nft_by_position, thash, position_key(swap, lock.position_id))) { case (?t) Map.get(nft_labels, nhash, t); case null null }
      };
      ledger = null; amount = null;
      swap_canister_id = ?swap; position_id = ?lock.position_id; token0 = ?lock.token0; token1 = ?lock.token1;
      lock_end = switch (info) { case (?i) i.lock_end; case null lock.expiry };
      dissolve_delay = switch (info) { case (?i) i.delay; case null 0 };
      dissolving_until = switch (info) { case (?i) i.dissolving_until; case null null };
      expiry = lock.expiry; locked = lock.expiry > NowAsNat64(); archived;
      earliest_unlock = switch (info) { case (?i) D.earliestUnlock(i, NowAsNat64()); case null lock.expiry };
      created_at = Map.get(lock_created_at, nhash, lock.lock_id);
    }
  };

  /// Once: creation times of locks created since the ICRC-3 log began, from their create
  /// blocks still held by this canister. Blocks already moved to an archive are skipped
  /// (their locks show no creation time). Reads only; never traps on an odd block.
  private func backfill_lock_created_at() {
    if (lock_created_at_backfilled) { return };
    lock_created_at_backfilled := true;
    let live = icrc3.live;
    var i = 0;
    while (i < live.count) {
      switch (Icrc3Log.decode(live.blocks[i])) {
        case (?#Map(fields)) {
          var btype = ""; var ts : ?Nat = null; var lock_id : ?Nat = null;
          for ((k, v) in fields.vals()) {
            switch (k, v) {
              case ("btype", #Text(t)) { btype := t };
              case ("ts", #Nat(n)) { ts := ?n };
              case ("tx", #Map(tx)) {
                for ((k2, v2) in tx.vals()) { switch (k2, v2) { case ("lock_id", #Nat(n)) { lock_id := ?n }; case _ {} } };
              };
              case _ {};
            };
          };
          if (btype == "sneedlock_token_lock_create" or btype == "sneedlock_position_lock_create") {
            switch (ts, lock_id) {
              case (?t, ?id) {
                if (t < 0x1_0000_0000_0000_0000 and Map.get(lock_created_at, nhash, id) == null) {
                  Map.set(lock_created_at, nhash, id, Nat64.fromNat(t));
                };
              };
              case _ {};
            };
          };
        };
        case _ {};
      };
      i += 1;
    };
  };

  private func lock_state_impl(lock_id : T.LockId) : ?T.LockState {
    switch (token_lock_records(lock_id)) { case (r) { if (r.size() > 0) { return ?token_lock_state(r[0].0, r[0].1, r[0].2, false) } } };
    switch (position_lock_records(lock_id)) { case (r) { if (r.size() > 0) { return ?position_lock_state(r[0].0, r[0].1, r[0].2, false) } } };
    switch (archived_token_locks.get(lock_id)) { case (?a) { return ?token_lock_state(a.owner, a.token_type, a.lock, true) }; case null {} };
    switch (archived_position_locks.get(lock_id)) { case (?a) { return ?position_lock_state(a.owner, a.swap_canister_id, a.lock, true) }; case null {} };
    null
  };

  /// One change to one lock (Dissolve.applyOp), owner only. Synchronous: no await between
  /// the checks and the write, so nothing can interleave.
  private func change_lock(caller : Principal, lock_id : T.LockId, op : D.Op, correlation_id : Nat) : T.LockOpResult {
    if (Map.has(lock_ids_in_flight, nhash, lock_id)) { return #Err(#InProgress) };
    let tokens = token_lock_records(lock_id);
    let positions = position_lock_records(lock_id);
    if (tokens.size() + positions.size() == 0) {
      if (archived_token_locks.get(lock_id) != null or archived_position_locks.get(lock_id) != null) {
        return #Err(#Invalid("The lock is no longer locked."));
      };
      return #Err(#NotFound);
    };
    if (tokens.size() + positions.size() > 1) { return #Err(#InProgress) };
    let now = NowAsNat64();
    let (owner, stored) = if (tokens.size() == 1) { (tokens[0].0, tokens[0].2.expiry) } else { (positions[0].0, positions[0].2.expiry) };
    if (owner != caller) { return #Err(#NotOwner) };
    if (tokens.size() == 1 and is_token_op_locked(owner)) { return #Err(#InProgress) };
    let before = Map.get(dissolve_infos, nhash, lock_id);
    let (after, expiry) = switch (D.applyOp(op, before, stored, now, lock_limits())) {
      case (#err(why)) { return #Err(#Invalid(why)) };
      case (#ok(r)) r;
    };
    switch (after) { case (?i) { Map.set(dissolve_infos, nhash, lock_id, i) }; case null {} };
    let (kind, block) = if (tokens.size() == 1) {
      let (_, ledger, lock) = tokens[0];
      remove_token_lock(owner, ledger, lock_id);
      add_lock_for_principal(owner, ledger, { lock with expiry = expiry });
      ("token", ("ledger", Icrc3Log.principal(ledger)))
    } else {
      let (_, swap, lock) = positions[0];
      update_position_lock_expiry(owner, correlation_id, swap, lock, expiry);
      ("position", ("pool", Icrc3Log.principal(swap)))
    };
    let btype = switch (op) {
      case (#Start) "sneedlock_dissolve_start";
      case (#Stop) "sneedlock_dissolve_stop";
      case (#Increase(_)) "sneedlock_dissolve_delay_increase";
      case (#Extend(_)) { if (kind == "token") "sneedlock_token_lock_extend" else "sneedlock_position_lock_extend" };
    };
    let lock_end = switch (after) { case (?i) i.lock_end; case null expiry };
    icrc3_add(btype, Array.append<(Text, T3.Value)>([
      ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("owner", Icrc3Log.principal(owner)),
      ("lock_id", #Nat(lock_id)), ("kind", #Text(kind)), block,
      ("old_expiry", Icrc3Log.nat64(stored)), ("expiry", Icrc3Log.nat64(expiry)), ("lock_end", Icrc3Log.nat64(lock_end)),
    ], switch (after) {
      case (?i) {
        Array.append<(Text, T3.Value)>([("dissolve_delay", Icrc3Log.nat64(i.delay))],
          switch (i.dissolving_until) { case (?u) [("dissolving_until", Icrc3Log.nat64(u))]; case null [] })
      };
      case null [];
    }));
    log_info(caller, correlation_id, "Lock " # Nat.toText(lock_id) # ": " # btype # ", expiry " # debug_show(stored) # " -> " # debug_show(expiry));
    switch (lock_state_impl(lock_id)) { case (?st) #Ok(st); case null #Err(#NotFound) };
  };

  /// Start dissolving: allowed once the lock period has ended, for a lock with a delay.
  public shared ({ caller }) func start_dissolving(lock_id : T.LockId) : async T.LockOpResult {
    change_lock(caller, lock_id, #Start, get_next_correlation_id());
  };

  /// Stop dissolving: the time left becomes the delay again.
  public shared ({ caller }) func stop_dissolving(lock_id : T.LockId) : async T.LockOpResult {
    change_lock(caller, lock_id, #Stop, get_next_correlation_id());
  };

  /// Add to the dissolve delay (a lock without one gets one). While dissolving, the end moves
  /// out by the same amount. Lock period + delay stay within the max lock length.
  public shared ({ caller }) func increase_dissolve_delay(lock_id : T.LockId, additional_ns : Nat64) : async T.LockOpResult {
    change_lock(caller, lock_id, #Increase(additional_ns), get_next_correlation_id());
  };

  /// Move the end of the lock period out, for token and position locks. Not while dissolving.
  public shared ({ caller }) func extend_lock(lock_id : T.LockId, new_lock_end : Expiry) : async T.LockOpResult {
    change_lock(caller, lock_id, #Extend(new_lock_end), get_next_correlation_id());
  };

  public query func get_lock_limits() : async T.LockLimits {
    { min_lock_length_ns; max_lock_length_ns }
  };

  public query func get_lock_state(lock_id : T.LockId) : async ?T.LockState { lock_state_impl(lock_id) };

  public query func get_lock_states(lock_ids : [T.LockId]) : async [?T.LockState] {
    if (lock_ids.size() > 100) { Debug.trap("At most 100 lock ids per call") };
    Array.map<T.LockId, ?T.LockState>(lock_ids, lock_state_impl);
  };

  /// Locks in ascending id order, filtered by owner, ledger, pool and kind, paged by the last
  /// id seen. Archived (unlocked and cleared) locks only when asked for.
  public query func get_lock_states_page(q : T.LockPageQuery) : async [T.LockState] {
    let take = switch (q.take) { case (?t) Nat.min(t, 500); case null 100 };
    let after = func(id : T.LockId) : Bool { switch (q.prev) { case (?p) id > p; case null true } };
    let ownerOk = func(o : Principal) : Bool { switch (q.owner) { case (?x) x == o; case null true } };
    let want = func(k : T.LockType) : Bool { switch (q.kind) { case (?x) x == k; case null true } };
    var out = List.nil<T.LockState>();
    if (want(#TokenLock) and q.swap_canister_id == null) {
      let ledgerOk = func(l : TokenType) : Bool { switch (q.ledger) { case (?x) x == l; case null true } };
      for ((owner, m) in state.principal_token_locks.entries()) {
        if (ownerOk(owner)) {
          for ((ledger, locks) in m.entries()) {
            if (ledgerOk(ledger)) {
              for (lock in List.toIter(locks)) { if (after(lock.lock_id)) { out := List.push(token_lock_state(owner, ledger, lock, false), out) } };
            };
          };
        };
      };
      if (q.include_archived) {
        for ((id, a) in archived_token_locks.entries()) {
          if (after(id) and ownerOk(a.owner) and ledgerOk(a.token_type)) { out := List.push(token_lock_state(a.owner, a.token_type, a.lock, true), out) };
        };
      };
    };
    if (want(#PositionLock) and q.ledger == null) {
      let swapOk = func(sw : T.SwapCanisterId) : Bool { switch (q.swap_canister_id) { case (?x) x == sw; case null true } };
      for ((owner, m) in state.principal_position_locks.entries()) {
        if (ownerOk(owner)) {
          for ((swap, locks) in m.entries()) {
            if (swapOk(swap)) {
              for (lock in List.toIter(locks)) { if (after(lock.lock_id)) { out := List.push(position_lock_state(owner, swap, lock, false), out) } };
            };
          };
        };
      };
      if (q.include_archived) {
        for ((id, a) in archived_position_locks.entries()) {
          if (after(id) and ownerOk(a.owner) and swapOk(a.swap_canister_id)) { out := List.push(position_lock_state(a.owner, a.swap_canister_id, a.lock, true), out) };
        };
      };
    };
    let sorted = Array.sort<T.LockState>(List.toArray(out), func(a, b) { Nat.compare(a.lock_id, b.lock_id) });
    if (sorted.size() <= take) { sorted } else { Array.tabulate<T.LockState>(take, func(i) { sorted[i] }) };
  };

  ////////////////
  // LP locks as NFTs: ICRC-7 with ICRC-37 (spec/sneed_lock_v2.md, sections 2 and 3)
  ////////////////

  private func nft_label(tid : Nat) : ?Blob { Map.get(nft_labels, nhash, tid) };

  private func set_nft_label(tid : Nat, sub : ?Blob) {
    switch (N.normSub(sub)) { case (?b) Map.set(nft_labels, nhash, tid, b); case null Map.delete(nft_labels, nhash, tid) };
  };

  /// The account holding an NFT: its position's only claimant, with the label. Null when the
  /// token does not exist (or, defensively, when the position has no single claimant).
  private func nft_owner(tid : Nat) : ?N.Account {
    switch (Map.get(nft_tokens, nhash, tid)) {
      case null null;
      case (?p) {
        let c = position_claimants(p.swap, p.position_id);
        if (c.size() == 1) ?{ owner = c[0]; subaccount = nft_label(tid) } else null;
      };
    };
  };

  private func acct(a : N.Account) : T3.Value { Icrc3Log.account(a.owner, N.normSub(a.subaccount)) };

  private func nft_mint(tid : Nat, swap : Principal, position_id : Nat, owner : Principal, why : Text) {
    Map.set(nft_tokens, nhash, tid, { swap; position_id; minted_at = NowAsNat64() } : N.Position);
    Map.set(nft_by_position, thash, position_key(swap, position_id), tid);
    ignore icrc3_add_i("7mint", [
      ("tid", #Nat(tid)), ("to", Icrc3Log.account(owner, null)),
      ("meta", #Map([("sneedlock:kind", #Text("position")), ("sneedlock:swap", Icrc3Log.principal(swap)), ("sneedlock:position_id", #Nat(position_id)), ("sneedlock:minted_by", #Text(why))])),
    ]);
  };

  private func nft_burn(tid : Nat, from : N.Account) {
    switch (Map.get(nft_tokens, nhash, tid)) {
      case (?p) { Map.delete(nft_by_position, thash, position_key(p.swap, p.position_id)) };
      case null {};
    };
    Map.delete(nft_tokens, nhash, tid);
    Map.delete(nft_labels, nhash, tid);
    Map.delete(nft_token_approvals, nhash, tid);
    ignore icrc3_add_i("7burn", [("tid", #Nat(tid)), ("from", acct(from))]);
  };

  /// After the claim and lock record have moved (or only the label changes): the label, the
  /// token's approvals (cleared, as ICRC-37 requires), the block. Answers the block index.
  private func nft_after_move(tid : Nat, from : N.Account, to : N.Account, spender : ?N.Account, memo : ?Blob, ts : ?Nat64) : Nat {
    set_nft_label(tid, to.subaccount);
    Map.delete(nft_token_approvals, nhash, tid);
    let base : [(Text, T3.Value)] = [("tid", #Nat(tid)), ("from", acct(from)), ("to", acct(to))];
    let extra = Array.append<(Text, T3.Value)>(
      switch (memo) { case (?m) [("memo", #Blob(m))]; case null [] },
      switch (ts) { case (?t) [("ts", Icrc3Log.nat64(t))]; case null [] });
    switch (spender) {
      case (?sp) icrc3_add_i("37xfer", Array.append(Array.append(base, [("spender", acct(sp))]), extra));
      case null icrc3_add_i("7xfer", Array.append(base, extra));
    };
  };

  /// Once: an NFT for every position held here that has been locked at least once, with the
  /// id of its first lock. Runs after the ICRC-3 history import so the log reads in order.
  private func activate_nfts<system>() {
    if (nft_activated or not icrc3.history_imported) { return };
    nft_activated := true;
    let first = Map.new<Text, Nat>(); // position -> lowest lock id
    let ledgers = Map.new<Principal, ()>();
    func note(swap : Principal, l : T.PositionLock) {
      let k = position_key(swap, l.position_id);
      switch (Map.get(first, thash, k)) { case (?id) { if (l.lock_id < id) Map.set(first, thash, k, l.lock_id) }; case null Map.set(first, thash, k, l.lock_id) };
      Map.set(ledgers, phash, l.token0, ()); Map.set(ledgers, phash, l.token1, ());
    };
    for ((_, swaps) in state.principal_position_locks.entries()) {
      for ((swap, locks) in swaps.entries()) { for (l in List.toIter(locks)) note(swap, l) };
    };
    for (a in archived_position_locks.vals()) { note(a.swap_canister_id, a.lock) };
    let minted = Map.new<Nat, ()>();
    for ((owner, swaps) in state.principal_position_ownerships.entries()) {
      for ((swap, ids) in swaps.entries()) {
        for (position_id in List.toIter(ids)) {
          let k = position_key(swap, position_id);
          switch (Map.get(first, thash, k)) {
            case (?tid) {
              if (not Map.has(nft_by_position, thash, k) and not Map.has(minted, nhash, tid) and position_claimants(swap, position_id).size() == 1) {
                nft_mint(tid, swap, position_id, owner, "activation");
                Map.set(minted, nhash, tid, ());
              };
            };
            case null {};
          };
        };
      };
    };
    schedule_symbol_fill<system>(Iter.toArray(Map.keys(ledgers)));
  };

  /// Ledger symbols for NFT names and cards, fetched once per ledger, off the caller's path.
  private func schedule_symbol_fill<system>(ledgers : [Principal]) {
    let missing = Array.filter<Principal>(ledgers, func(l) { not Map.has(ledger_symbols, phash, l) });
    if (missing.size() == 0) { return };
    ignore Timer.setTimer<system>(#seconds 0, func() : async () {
      for (l in missing.vals()) {
        if (not Map.has(ledger_symbols, phash, l)) {
          try {
            let ledger = actor (Principal.toText(l)) : actor { icrc1_symbol : shared query () -> async Text };
            let sym = await ledger.icrc1_symbol();
            if (sym.size() > 0 and sym.size() <= 32) { Map.set(ledger_symbols, phash, l, sym) };
          } catch (_) {};
        };
      };
    });
  };

  private func symbol_of(l : Principal) : Text {
    switch (Map.get(ledger_symbols, phash, l)) { case (?s) s; case null { let t = Principal.toText(l); if (t.size() > 5) Text.join("", Iter.fromArray([trimText(t, 5)])) else t } };
  };

  private func trimText(t : Text, n : Nat) : Text {
    var out = ""; var i = 0;
    for (c in t.chars()) { if (i < n) { out := out # Text.fromChar(c) }; i += 1 };
    out;
  };

  /// The position's current lock record (whoever's), if any.
  private func current_position_lock(swap : Principal, position_id : Nat) : ?T.PositionLock {
    for (owner in state.principal_position_locks.keys()) {
      switch (get_position_lock(owner, swap, position_id)) { case (?l) { return ?l }; case null {} };
    };
    null;
  };

  private func nft_metadata(tid : Nat) : ?[(Text, N.Value)] {
    let p = switch (Map.get(nft_tokens, nhash, tid)) { case (?p) p; case null { return null } };
    let lock = current_position_lock(p.swap, p.position_id);
    let (t0, t1) = switch (lock) {
      case (?l) (?l.token0, ?l.token1);
      case null {
        // an expired lock may have been archived; its tokens are still the position's
        var found : (?Principal, ?Principal) = (null, null);
        for (a in archived_position_locks.vals()) {
          if (a.swap_canister_id == p.swap and a.lock.position_id == p.position_id) { found := (?a.lock.token0, ?a.lock.token1) };
        };
        found;
      };
    };
    let pair = switch (t0, t1) { case (?a, ?b) symbol_of(a) # "/" # symbol_of(b); case _ "ICPSwap" };
    let now = NowAsNat64();
    let st : ?T.LockState = switch (lock) { case (?l) ?position_lock_state(Option.get(nft_owner(tid), { owner = this_canister_id(); subaccount = null }).owner, p.swap, l, false); case null null };
    let status = switch (st) {
      case (?s) {
        if (not s.locked) "Unlocked"
        else if (s.dissolve_delay > 0 and s.dissolving_until == null) "Locked until dissolved"
        else "Locked until " # dateText(s.expiry);
      };
      case null "Unlocked";
    };
    let name = pair # " LP lock";
    let b = Buffer.Buffer<(Text, N.Value)>(20);
    b.add(("icrc7:name", #Text(name)));
    b.add(("icrc7:description", #Text("An ICPSwap " # pair # " liquidity position (#" # Nat.toText(p.position_id) # ") held by Sneed Lock. Whoever holds this NFT owns the position and its lock, and collects the position's fees, including any not yet claimed.")));
    b.add(("icrc7:image", #Text(N.card(pair, status, tid, p.position_id))));
    b.add(("sneedlock:kind", #Text("position")));
    b.add(("sneedlock:swap", #Text(Principal.toText(p.swap))));
    b.add(("sneedlock:position_id", #Nat(p.position_id)));
    switch (t0, t1) { case (?a, ?b2) { b.add(("sneedlock:token0", #Text(Principal.toText(a)))); b.add(("sneedlock:token1", #Text(Principal.toText(b2)))) }; case _ {} };
    switch (lock) { case (?l) { b.add(("sneedlock:lock_id", #Nat(l.lock_id))); b.add(("sneedlock:dex", #Nat(l.dex))) }; case null {} };
    switch (st) {
      case (?s) {
        b.add(("sneedlock:lock_end", #Nat(Nat64.toNat(s.lock_end))));
        b.add(("sneedlock:dissolve_delay", #Nat(Nat64.toNat(s.dissolve_delay))));
        switch (s.dissolving_until) { case (?u) b.add(("sneedlock:dissolving_until", #Nat(Nat64.toNat(u)))); case null {} };
        b.add(("sneedlock:earliest_unlock", #Nat(Nat64.toNat(s.earliest_unlock))));
        b.add(("sneedlock:locked", #Text(if (s.locked) "true" else "false")));
      };
      case null { b.add(("sneedlock:locked", #Text("false"))) };
    };
    b.add(("sneedlock:minted_at", #Nat(Nat64.toNat(p.minted_at))));
    ignore now;
    ?Buffer.toArray(b);
  };

  /// "2027-01-31" for a time in ns (UTC).
  private func dateText(ns : Nat64) : Text {
    let days = Nat64.toNat(ns / 86_400_000_000_000);
    // civil-from-days (Howard Hinnant), for days since 1970-01-01
    let z : Int = days + 719_468;
    let era : Int = (if (z >= 0) z else z - 146_096) / 146_097;
    let doe : Int = z - era * 146_097;
    let yoe : Int = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y : Int = yoe + era * 400;
    let doy : Int = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp : Int = (5 * doy + 2) / 153;
    let d : Int = doy - (153 * mp + 2) / 5 + 1;
    let m : Int = if (mp < 10) mp + 3 else mp - 9;
    let year : Int = if (m <= 2) y + 1 else y;
    func two(n : Int) : Text { if (n < 10) "0" # Int.toText(n) else Int.toText(n) };
    Int.toText(year) # "-" # two(m) # "-" # two(d);
  };

  /// Drops dedup entries older than the transaction window.
  private func prune_recent(now : Nat64) {
    let old = Buffer.Buffer<Text>(0);
    for ((k, (t, _)) in Map.entries(nft_recent)) {
      if (Nat64.toNat(t) + Nat64.toNat(N.TX_WINDOW_NS) + Nat64.toNat(N.DRIFT_NS) < Nat64.toNat(now)) old.add(k);
    };
    for (k in old.vals()) Map.delete(nft_recent, thash, k);
  };

  private func token_approved(spender : N.Account, owner : N.Account, tid : Nat, now : Nat64) : Bool {
    switch (Map.get(nft_token_approvals, nhash, tid)) {
      case (?l) { for (a in l.vals()) { if (N.sameAccount(a.spender, spender) and N.notExpired(a, now)) return true } };
      case null {};
    };
    switch (Map.get(nft_collection_approvals, thash, N.accountKey(owner))) {
      case (?l) { for (a in l.vals()) { if (N.sameAccount(a.spender, spender) and N.notExpired(a, now)) return true } };
      case null {};
    };
    false;
  };

  /// Why an NFT cannot move right now, if it cannot: a withdrawal of the position, or a fee
  /// claim / liquidity addition on its pool, is awaiting the pool. (Fees being claimed go to
  /// the owner who claimed them; a sale should not race that.)
  private func nft_busy(tid : Nat) : ?Text {
    switch (Map.get(nft_tokens, nhash, tid)) {
      case (?p) {
        if (Map.has(positions_in_flight, thash, position_key(p.swap, p.position_id))) { return ?"A withdrawal of this position is in progress" };
        if (is_pool_op_locked(p.swap)) { return ?"A fee claim or liquidity addition on this pool is in progress; try again shortly" };
      };
      case null {};
    };
    null;
  };

  /// Moves an NFT whose checks have passed: claim and lock record to the new principal (when
  /// it changes), then label, approvals and block. Synchronous.
  private func nft_transfer_now(caller : Principal, tid : Nat, from : N.Account, to : N.Account, spender : ?N.Account, memo : ?Blob, ts : ?Nat64) : Nat {
    let p = switch (Map.get(nft_tokens, nhash, tid)) { case (?p) p; case null { Debug.trap("nft_transfer_now: no token") } };
    if (from.owner != to.owner) {
      ignore move_position(caller, get_next_correlation_id(), from.owner, to.owner, p.swap, p.position_id);
    };
    nft_after_move(tid, from, to, spender, memo, ts);
  };

  // ---- ICRC-7: collection ----
  transient let NFT_NAME = "Sneed Lock";
  transient let NFT_SYMBOL = "SLOCK";
  transient let NFT_DESCRIPTION = "Locked ICPSwap liquidity positions held by Sneed Lock. Each NFT is one position with its lock; whoever holds it owns both.";

  public query func icrc7_collection_metadata() : async [(Text, N.Value)] {
    [
      ("icrc7:name", #Text(NFT_NAME)), ("icrc7:symbol", #Text(NFT_SYMBOL)), ("icrc7:description", #Text(NFT_DESCRIPTION)),
      ("icrc7:total_supply", #Nat(Map.size(nft_tokens))),
      ("icrc7:max_query_batch_size", #Nat(N.MAX_QUERY_BATCH)), ("icrc7:max_update_batch_size", #Nat(N.MAX_UPDATE_BATCH)),
      ("icrc7:default_take_value", #Nat(N.DEFAULT_TAKE)), ("icrc7:max_take_value", #Nat(N.MAX_TAKE)), ("icrc7:max_memo_size", #Nat(N.MAX_MEMO)),
      ("icrc7:atomic_batch_transfers", #Text("false")),
      ("icrc7:tx_window", #Nat(Nat64.toNat(N.TX_WINDOW_NS / 1_000_000_000))), ("icrc7:permitted_drift", #Nat(Nat64.toNat(N.DRIFT_NS / 1_000_000_000))),
      ("icrc37:max_approvals_per_token_or_collection", #Nat(N.MAX_APPROVALS)), ("icrc37:max_revoke_approvals", #Nat(N.MAX_REVOKE)),
    ];
  };
  public query func icrc7_name() : async Text { NFT_NAME };
  public query func icrc7_symbol() : async Text { NFT_SYMBOL };
  public query func icrc7_description() : async ?Text { ?NFT_DESCRIPTION };
  public query func icrc7_logo() : async ?Text { null };
  public query func icrc7_total_supply() : async Nat { Map.size(nft_tokens) };
  public query func icrc7_supply_cap() : async ?Nat { null };
  public query func icrc7_max_query_batch_size() : async ?Nat { ?N.MAX_QUERY_BATCH };
  public query func icrc7_max_update_batch_size() : async ?Nat { ?N.MAX_UPDATE_BATCH };
  public query func icrc7_default_take_value() : async ?Nat { ?N.DEFAULT_TAKE };
  public query func icrc7_max_take_value() : async ?Nat { ?N.MAX_TAKE };
  public query func icrc7_max_memo_size() : async ?Nat { ?N.MAX_MEMO };
  public query func icrc7_atomic_batch_transfers() : async ?Bool { ?false };
  public query func icrc7_tx_window() : async ?Nat { ?Nat64.toNat(N.TX_WINDOW_NS / 1_000_000_000) };
  public query func icrc7_permitted_drift() : async ?Nat { ?Nat64.toNat(N.DRIFT_NS / 1_000_000_000) };

  // ---- ICRC-7: tokens ----
  public query func icrc7_token_metadata(ids : [Nat]) : async [?[(Text, N.Value)]] {
    if (ids.size() > N.MAX_QUERY_BATCH) { Debug.trap("too many token ids") };
    Array.map<Nat, ?[(Text, N.Value)]>(ids, nft_metadata);
  };
  public query func icrc7_owner_of(ids : [Nat]) : async [?N.Account] {
    if (ids.size() > N.MAX_QUERY_BATCH) { Debug.trap("too many token ids") };
    Array.map<Nat, ?N.Account>(ids, nft_owner);
  };
  private func nft_ids_sorted() : [Nat] { Array.sort<Nat>(Iter.toArray(Map.keys(nft_tokens)), Nat.compare) };
  private func nft_ids_of(a : N.Account) : [Nat] {
    Array.filter<Nat>(nft_ids_sorted(), func(tid) { switch (nft_owner(tid)) { case (?o) N.sameAccount(o, a); case null false } });
  };
  public query func icrc7_balance_of(accounts : [N.Account]) : async [Nat] {
    if (accounts.size() > N.MAX_QUERY_BATCH) { Debug.trap("too many accounts") };
    Array.map<N.Account, Nat>(accounts, func(a) { nft_ids_of(a).size() });
  };
  public query func icrc7_tokens(prev : ?Nat, take : ?Nat) : async [Nat] { N.page(nft_ids_sorted(), prev, take) };
  public query func icrc7_tokens_of(account : N.Account, prev : ?Nat, take : ?Nat) : async [Nat] { N.page(nft_ids_of(account), prev, take) };

  // ---- ICRC-7: transfer ----
  public shared ({ caller }) func icrc7_transfer(args : [N.TransferArg]) : async [?N.TransferResult] {
    if (args.size() > N.MAX_UPDATE_BATCH) { return [?#Err(#GenericBatchError({ error_code = 1; message = "At most " # Nat.toText(N.MAX_UPDATE_BATCH) # " transfers per call" }))] };
    let now = NowAsNat64();
    prune_recent(now);
    Array.map<N.TransferArg, ?N.TransferResult>(args, func(a) {
      switch (a.memo) { case (?m) { if (m.size() > N.MAX_MEMO) { return ?#Err(#GenericError({ error_code = 2; message = "Memo longer than " # Nat.toText(N.MAX_MEMO) # " bytes" })) } }; case null {} };
      switch (N.checkTime(a.created_at_time, now)) { case (?#TooOld) { return ?#Err(#TooOld) }; case (?#CreatedInFuture(x)) { return ?#Err(#CreatedInFuture(x)) }; case null {} };
      if (not N.validSub(a.from_subaccount)) { return ?#Err(#Unauthorized) };
      if (Principal.isAnonymous(a.to.owner) or not N.validSub(a.to.subaccount)) { return ?#Err(#InvalidRecipient) };
      let owner = switch (nft_owner(a.token_id)) { case (?o) o; case null { return ?#Err(#NonExistingTokenId) } };
      let from : N.Account = { owner = caller; subaccount = a.from_subaccount };
      if (not N.sameAccount(owner, from)) { return ?#Err(#Unauthorized) };
      if (N.sameAccount(owner, a.to)) { return ?#Err(#InvalidRecipient) };
      let key = "7xfer|" # Principal.toText(caller) # "|" # debug_show(a);
      switch (a.created_at_time) {
        case (?_) { switch (Map.get(nft_recent, thash, key)) { case (?(_, i)) { return ?#Err(#Duplicate({ duplicate_of = i })) }; case null {} } };
        case null {};
      };
      switch (nft_busy(a.token_id)) { case (?why) { return ?#Err(#GenericError({ error_code = 3; message = why })) }; case null {} };
      let i = nft_transfer_now(caller, a.token_id, owner, a.to, null, a.memo, a.created_at_time);
      switch (a.created_at_time) { case (?t) Map.set(nft_recent, thash, key, (t, i)); case null {} };
      ?#Ok(i);
    });
  };

  // ---- ICRC-37: approvals ----
  public query func icrc37_metadata() : async [(Text, N.Value)] {
    [("icrc37:max_approvals_per_token_or_collection", #Nat(N.MAX_APPROVALS)), ("icrc37:max_revoke_approvals", #Nat(N.MAX_REVOKE))];
  };
  public query func icrc37_max_approvals_per_token_or_collection() : async ?Nat { ?N.MAX_APPROVALS };
  public query func icrc37_max_revoke_approvals() : async ?Nat { ?N.MAX_REVOKE };

  public shared ({ caller }) func icrc37_approve_tokens(args : [N.ApproveTokenArg]) : async [?N.ApproveTokenResult] {
    if (args.size() > N.MAX_UPDATE_BATCH) { return [?#Err(#GenericBatchError({ error_code = 1; message = "At most " # Nat.toText(N.MAX_UPDATE_BATCH) # " approvals per call" }))] };
    let now = NowAsNat64();
    Array.map<N.ApproveTokenArg, ?N.ApproveTokenResult>(args, func(a) {
      let i = a.approval_info;
      switch (N.checkTime(?i.created_at_time, now)) { case (?#TooOld) { return ?#Err(#TooOld) }; case (?#CreatedInFuture(x)) { return ?#Err(#CreatedInFuture(x)) }; case null {} };
      switch (i.memo) { case (?m) { if (m.size() > N.MAX_MEMO) { return ?#Err(#GenericError({ error_code = 2; message = "Memo too long" })) } }; case null {} };
      switch (i.expires_at) { case (?e) { if (e <= now) { return ?#Err(#GenericError({ error_code = 4; message = "The approval has already expired" })) } }; case null {} };
      if (not N.validSub(i.from_subaccount)) { return ?#Err(#Unauthorized) };
      if (not N.validSub(i.spender.subaccount) or Principal.isAnonymous(i.spender.owner)) { return ?#Err(#InvalidSpender) };
      let owner = switch (nft_owner(a.token_id)) { case (?o) o; case null { return ?#Err(#NonExistingTokenId) } };
      if (not N.sameAccount(owner, { owner = caller; subaccount = i.from_subaccount })) { return ?#Err(#Unauthorized) };
      if (N.sameAccount(i.spender, owner)) { return ?#Err(#InvalidSpender) };
      let others = Array.filter<N.ApprovalInfo>(Option.get(Map.get(nft_token_approvals, nhash, a.token_id), []), func(x) { N.notExpired(x, now) and not N.sameAccount(x.spender, i.spender) });
      if (others.size() >= N.MAX_APPROVALS) { return ?#Err(#GenericError({ error_code = 5; message = "Too many approvals on this token" })) };
      Map.set(nft_token_approvals, nhash, a.token_id, Array.append(others, [i]));
      ?#Ok(icrc3_add_i("37approve", Array.append<(Text, T3.Value)>([
        ("tid", #Nat(a.token_id)), ("from", acct(owner)), ("spender", acct(i.spender)), ("ts", Icrc3Log.nat64(i.created_at_time)),
      ], switch (i.expires_at) { case (?e) [("exp", Icrc3Log.nat64(e))]; case null [] })));
    });
  };

  public shared ({ caller }) func icrc37_approve_collection(args : [N.ApproveCollectionArg]) : async [?N.ApproveCollectionResult] {
    if (args.size() > N.MAX_UPDATE_BATCH) { return [?#Err(#GenericBatchError({ error_code = 1; message = "At most " # Nat.toText(N.MAX_UPDATE_BATCH) # " approvals per call" }))] };
    let now = NowAsNat64();
    Array.map<N.ApproveCollectionArg, ?N.ApproveCollectionResult>(args, func(a) {
      let i = a.approval_info;
      switch (N.checkTime(?i.created_at_time, now)) { case (?#TooOld) { return ?#Err(#TooOld) }; case (?#CreatedInFuture(x)) { return ?#Err(#CreatedInFuture(x)) }; case null {} };
      switch (i.memo) { case (?m) { if (m.size() > N.MAX_MEMO) { return ?#Err(#GenericError({ error_code = 2; message = "Memo too long" })) } }; case null {} };
      switch (i.expires_at) { case (?e) { if (e <= now) { return ?#Err(#GenericError({ error_code = 4; message = "The approval has already expired" })) } }; case null {} };
      if (not N.validSub(i.from_subaccount)) { return ?#Err(#GenericError({ error_code = 6; message = "A subaccount is 32 bytes" })) };
      if (not N.validSub(i.spender.subaccount) or Principal.isAnonymous(i.spender.owner)) { return ?#Err(#InvalidSpender) };
      let owner : N.Account = { owner = caller; subaccount = N.normSub(i.from_subaccount) };
      if (N.sameAccount(i.spender, owner)) { return ?#Err(#InvalidSpender) };
      let k = N.accountKey(owner);
      let others = Array.filter<N.ApprovalInfo>(Option.get(Map.get(nft_collection_approvals, thash, k), []), func(x) { N.notExpired(x, now) and not N.sameAccount(x.spender, i.spender) });
      if (others.size() >= N.MAX_APPROVALS) { return ?#Err(#GenericError({ error_code = 5; message = "Too many collection approvals for this account" })) };
      Map.set(nft_collection_approvals, thash, k, Array.append(others, [i]));
      ?#Ok(icrc3_add_i("37approve_coll", Array.append<(Text, T3.Value)>([
        ("from", acct(owner)), ("spender", acct(i.spender)), ("ts", Icrc3Log.nat64(i.created_at_time)),
      ], switch (i.expires_at) { case (?e) [("exp", Icrc3Log.nat64(e))]; case null [] })));
    });
  };

  public shared ({ caller }) func icrc37_revoke_token_approvals(args : [N.RevokeTokenApprovalArg]) : async [?N.RevokeTokenApprovalResult] {
    if (args.size() > N.MAX_REVOKE) { return [?#Err(#GenericBatchError({ error_code = 1; message = "At most " # Nat.toText(N.MAX_REVOKE) # " revocations per call" }))] };
    let now = NowAsNat64();
    Array.map<N.RevokeTokenApprovalArg, ?N.RevokeTokenApprovalResult>(args, func(a) {
      switch (N.checkTime(a.created_at_time, now)) { case (?#TooOld) { return ?#Err(#TooOld) }; case (?#CreatedInFuture(x)) { return ?#Err(#CreatedInFuture(x)) }; case null {} };
      let owner = switch (nft_owner(a.token_id)) { case (?o) o; case null { return ?#Err(#NonExistingTokenId) } };
      if (not N.sameAccount(owner, { owner = caller; subaccount = a.from_subaccount })) { return ?#Err(#Unauthorized) };
      let live = Array.filter<N.ApprovalInfo>(Option.get(Map.get(nft_token_approvals, nhash, a.token_id), []), func(x) { N.notExpired(x, now) });
      let kept = Array.filter<N.ApprovalInfo>(live, func(x) { switch (a.spender) { case (?sp) not N.sameAccount(x.spender, sp); case null false } });
      if (kept.size() == live.size()) { return ?#Err(#ApprovalDoesNotExist) };
      if (kept.size() == 0) Map.delete(nft_token_approvals, nhash, a.token_id) else Map.set(nft_token_approvals, nhash, a.token_id, kept);
      ?#Ok(icrc3_add_i("37revoke", Array.append<(Text, T3.Value)>([("tid", #Nat(a.token_id)), ("from", acct(owner))],
        switch (a.spender) { case (?sp) [("spender", acct(sp))]; case null [] })));
    });
  };

  public shared ({ caller }) func icrc37_revoke_collection_approvals(args : [N.RevokeCollectionApprovalArg]) : async [?N.RevokeCollectionApprovalResult] {
    if (args.size() > N.MAX_REVOKE) { return [?#Err(#GenericBatchError({ error_code = 1; message = "At most " # Nat.toText(N.MAX_REVOKE) # " revocations per call" }))] };
    let now = NowAsNat64();
    Array.map<N.RevokeCollectionApprovalArg, ?N.RevokeCollectionApprovalResult>(args, func(a) {
      switch (N.checkTime(a.created_at_time, now)) { case (?#TooOld) { return ?#Err(#TooOld) }; case (?#CreatedInFuture(x)) { return ?#Err(#CreatedInFuture(x)) }; case null {} };
      let owner : N.Account = { owner = caller; subaccount = N.normSub(a.from_subaccount) };
      let k = N.accountKey(owner);
      let live = Array.filter<N.ApprovalInfo>(Option.get(Map.get(nft_collection_approvals, thash, k), []), func(x) { N.notExpired(x, now) });
      let kept = Array.filter<N.ApprovalInfo>(live, func(x) { switch (a.spender) { case (?sp) not N.sameAccount(x.spender, sp); case null false } });
      if (kept.size() == live.size()) { return ?#Err(#ApprovalDoesNotExist) };
      if (kept.size() == 0) Map.delete(nft_collection_approvals, thash, k) else Map.set(nft_collection_approvals, thash, k, kept);
      ?#Ok(icrc3_add_i("37revoke_coll", Array.append<(Text, T3.Value)>([("from", acct(owner))],
        switch (a.spender) { case (?sp) [("spender", acct(sp))]; case null [] })));
    });
  };

  public query func icrc37_is_approved(args : [N.IsApprovedArg]) : async [Bool] {
    if (args.size() > N.MAX_QUERY_BATCH) { Debug.trap("too many queries") };
    let now = NowAsNat64();
    Array.map<N.IsApprovedArg, Bool>(args, func(a) {
      switch (nft_owner(a.token_id)) {
        case (?o) { N.sameSub(o.subaccount, a.from_subaccount) and token_approved(a.spender, o, a.token_id, now) };
        case null false;
      };
    });
  };

  public query func icrc37_get_token_approvals(token_ids : [Nat], prev : ?N.TokenApproval, take : ?Nat) : async [N.TokenApproval] {
    if (token_ids.size() > N.MAX_QUERY_BATCH) { Debug.trap("too many token ids") };
    let now = NowAsNat64();
    let n = Nat.min(Option.get(take, N.DEFAULT_TAKE), N.MAX_TAKE);
    let all = Buffer.Buffer<N.TokenApproval>(8);
    for (tid in Array.sort<Nat>(token_ids, Nat.compare).vals()) {
      let l = Array.sort<N.ApprovalInfo>(Array.filter<N.ApprovalInfo>(Option.get(Map.get(nft_token_approvals, nhash, tid), []), func(x) { N.notExpired(x, now) }),
        func(x, y) { Text.compare(N.accountKey(x.spender), N.accountKey(y.spender)) });
      for (i in l.vals()) all.add({ token_id = tid; approval_info = i });
    };
    let after = switch (prev) {
      case (?p) Array.filter<N.TokenApproval>(Buffer.toArray(all), func(x) { x.token_id > p.token_id or (x.token_id == p.token_id and Text.compare(N.accountKey(x.approval_info.spender), N.accountKey(p.approval_info.spender)) == #greater) });
      case null Buffer.toArray(all);
    };
    if (after.size() <= n) after else Array.tabulate<N.TokenApproval>(n, func(i) { after[i] });
  };

  public query func icrc37_get_collection_approvals(owner : N.Account, prev : ?N.CollectionApproval, take : ?Nat) : async [N.CollectionApproval] {
    let now = NowAsNat64();
    let n = Nat.min(Option.get(take, N.DEFAULT_TAKE), N.MAX_TAKE);
    let l = Array.sort<N.ApprovalInfo>(Array.filter<N.ApprovalInfo>(Option.get(Map.get(nft_collection_approvals, thash, N.accountKey(owner)), []), func(x) { N.notExpired(x, now) }),
      func(x, y) { Text.compare(N.accountKey(x.spender), N.accountKey(y.spender)) });
    let after = switch (prev) { case (?p) Array.filter<N.ApprovalInfo>(l, func(x) { Text.compare(N.accountKey(x.spender), N.accountKey(p.spender)) == #greater }); case null l };
    if (after.size() <= n) after else Array.tabulate<N.ApprovalInfo>(n, func(i) { after[i] });
  };

  public shared ({ caller }) func icrc37_transfer_from(args : [N.TransferFromArg]) : async [?N.TransferFromResult] {
    if (args.size() > N.MAX_UPDATE_BATCH) { return [?#Err(#GenericBatchError({ error_code = 1; message = "At most " # Nat.toText(N.MAX_UPDATE_BATCH) # " transfers per call" }))] };
    let now = NowAsNat64();
    prune_recent(now);
    Array.map<N.TransferFromArg, ?N.TransferFromResult>(args, func(a) {
      switch (a.memo) { case (?m) { if (m.size() > N.MAX_MEMO) { return ?#Err(#GenericError({ error_code = 2; message = "Memo longer than " # Nat.toText(N.MAX_MEMO) # " bytes" })) } }; case null {} };
      switch (N.checkTime(a.created_at_time, now)) { case (?#TooOld) { return ?#Err(#TooOld) }; case (?#CreatedInFuture(x)) { return ?#Err(#CreatedInFuture(x)) }; case null {} };
      if (not N.validSub(a.spender_subaccount) or not N.validSub(a.from.subaccount)) { return ?#Err(#Unauthorized) };
      if (Principal.isAnonymous(a.to.owner) or not N.validSub(a.to.subaccount)) { return ?#Err(#InvalidRecipient) };
      let owner = switch (nft_owner(a.token_id)) { case (?o) o; case null { return ?#Err(#NonExistingTokenId) } };
      if (not N.sameAccount(owner, a.from)) { return ?#Err(#Unauthorized) };
      let spender : N.Account = { owner = caller; subaccount = a.spender_subaccount };
      if (not token_approved(spender, owner, a.token_id, now)) { return ?#Err(#Unauthorized) };
      if (N.sameAccount(owner, a.to)) { return ?#Err(#InvalidRecipient) };
      let key = "37xfer|" # Principal.toText(caller) # "|" # debug_show(a);
      switch (a.created_at_time) {
        case (?_) { switch (Map.get(nft_recent, thash, key)) { case (?(_, i)) { return ?#Err(#Duplicate({ duplicate_of = i })) }; case null {} } };
        case null {};
      };
      switch (nft_busy(a.token_id)) { case (?why) { return ?#Err(#GenericError({ error_code = 3; message = why })) }; case null {} };
      let i = nft_transfer_now(caller, a.token_id, owner, a.to, ?spender, a.memo, a.created_at_time);
      switch (a.created_at_time) { case (?t) Map.set(nft_recent, thash, key, (t, i)); case null {} };
      ?#Ok(i);
    });
  };

  /// The NFT of a position, if it has one.
  public query func get_position_nft(swap_canister_id : T.SwapCanisterId, position_id : T.PositionId) : async ?Nat {
    Map.get(nft_by_position, thash, position_key(swap_canister_id, position_id));
  };

  ////////////////
  // ICRC-3 activity log (library src/icrc3, design spec/sneed_lock_icrc3.md)
  ////////////////

  transient let icrc3_catalogue : Icrc3Log.Config = {
    block_types_url = "https://app.sneeddao.com/api/sneed_lock#block-types";
    block_types = [
      "sneedlock_log_start",
      "sneedlock_import_token_lock",
      "sneedlock_import_position_lock",
      "sneedlock_import_position_claim",
      "sneedlock_token_lock_create",
      "sneedlock_token_lock_transfer",
      "sneedlock_token_withdraw",
      "sneedlock_position_claim",
      "sneedlock_position_lock_create",
      "sneedlock_position_lock_extend",
      "sneedlock_position_transfer",
      "sneedlock_position_withdraw",
      "sneedlock_fees_claim",
      "sneedlock_liquidity_add",
      "sneedlock_fee_pay",
      "sneedlock_admin_token_return",
      "sneedlock_admin_token_rescue",
      "sneedlock_admin_pool_deposit",
      "sneedlock_admin_pool_withdraw",
      "sneedlock_config_update",
      // v2 (spec/sneed_lock_v2.md)
      "sneedlock_dissolve_start",
      "sneedlock_dissolve_stop",
      "sneedlock_dissolve_delay_increase",
      "sneedlock_token_lock_extend",
    ];
  };

  // SNS registration of archives (optional: skipped until a hotkeyed neuron is configured)
  stable var icrc3_sns : Icrc3Sns.State = Icrc3Sns.init();
  transient let icrc3_sns_rt : Icrc3Sns.Runtime = Icrc3Sns.runtime();

  private func icrc3_sns_env() : Icrc3Sns.Environment {
    {
      governance = sneed_governance;
      name = "Sneed Lock";
      doc_url = "https://app.sneeddao.com/api/sneed_lock#activity-log-icrc-3";
      new_correlation_id = get_next_correlation_id;
      log_info = func(cid : Nat, message : Text) { log_info(this_canister_id(), cid, message) };
      log_error = func(cid : Nat, message : Text) { log_error(this_canister_id(), cid, message) };
      describe = null;
    };
  };

  private func icrc3_env() : Icrc3Log.Environment {
    {
      self = this_canister_id();
      archive_controllers = [sneed_sns_root];
      cycle_reserve = 2_000_000_000_000; // never spend this canister's balance below 2 T
      new_correlation_id = get_next_correlation_id;
      log_info = func(cid : Nat, message : Text) { log_info(this_canister_id(), cid, message) };
      log_error = func(cid : Nat, message : Text) { log_error(this_canister_id(), cid, message) };
    };
  };

  // Append one block for an action that has just been committed to local state.
  private func icrc3_add(btype : Text, tx : [(Text, T3.Value)]) {
    ignore Icrc3Log.append(icrc3, btype, Int.abs(Time.now()), tx);
  };

  /// Appends a block and answers its index (ICRC-7 and ICRC-37 answer it as the transaction id).
  private func icrc3_add_i(btype : Text, tx : [(Text, T3.Value)]) : Nat {
    Icrc3Log.append(icrc3, btype, Int.abs(Time.now()), tx);
  };

  private func icrc3_config(caller : Principal, correlation_id : Nat, key : Text, value : T3.Value, old_value : ?T3.Value) {
    let base : [(Text, T3.Value)] = [("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("key", #Text(key)), ("value", value)];
    icrc3_add("sneedlock_config_update", switch (old_value) {
      case (?old) { Array.append(base, [("old_value", old)]) };
      case null { base };
    });
  };

  // ---- standard ICRC-3 read interface ----

  public query func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult {
    Icrc3Log.getBlocks(icrc3, args);
  };

  public query func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult {
    Icrc3Log.getArchives(icrc3, args);
  };

  public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate {
    Icrc3Log.tipCertificate(icrc3);
  };

  public query func icrc3_supported_block_types() : async [T3.BlockType] {
    let icrc7 = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-7/ICRC-7.md";
    let icrc37 = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-37/ICRC-37.md";
    Array.append(Icrc3Log.supportedBlockTypes(icrc3_catalogue), [
      { block_type = "7mint"; url = icrc7 }, { block_type = "7burn"; url = icrc7 }, { block_type = "7xfer"; url = icrc7 },
      { block_type = "37approve"; url = icrc37 }, { block_type = "37approve_coll"; url = icrc37 }, { block_type = "37revoke"; url = icrc37 },
      { block_type = "37revoke_coll"; url = icrc37 }, { block_type = "37xfer"; url = icrc37 },
    ]);
  };

  public query func icrc10_supported_standards() : async [T3.SupportedStandard] {
    Array.append(Icrc3Log.supportedStandards(), [
      { name = "ICRC-7"; url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-7/ICRC-7.md" },
      { name = "ICRC-37"; url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-37/ICRC-37.md" },
    ]);
  };

  public query func icrc3_log_status() : async T3.LogStatus {
    Icrc3Log.status(icrc3, icrc3_rt);
  };

  // ---- administration ----

  public shared ({ caller }) func admin_set_icrc3_settings(update : T3.SettingsUpdate) : async { #Ok : T3.Settings; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("Only admins can change the ICRC-3 settings") };
    switch (Icrc3Log.applySettings(icrc3, update)) {
      case (#Err(e)) { #Err(e) };
      case (#Ok(changes)) {
        let correlation_id = get_next_correlation_id();
        for ((key, old_value, new_value) in changes.vals()) {
          icrc3_config(caller, correlation_id, key, #Nat(new_value), ?#Nat(old_value));
        };
        log_info(caller, correlation_id, "ICRC-3 settings updated: " # debug_show(icrc3.settings));
        #Ok(icrc3.settings);
      };
    };
  };

  /// Move every live block to the archives now (creating archives as needed).
  /// Returns the number of blocks moved.
  public shared ({ caller }) func admin_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("Only admins can trigger a spill") };
    if (icrc3_rt.spilling) { return #Err("A spill is already in progress") };
    let moved = await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), true);
    ignore await* Icrc3Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env());
    #Ok(moved);
  };

  // ---- SNS registration of archives ----

  /// Where each archive stands with its RegisterDappCanisters proposal.
  public query func icrc3_registration_status() : async Icrc3Sns.Status {
    Icrc3Sns.status(icrc3_sns, icrc3_sns_env());
  };

  /// The SNS neuron (32-byte id) that has this canister as a hotkey and submits
  /// the registration proposals; null switches the step off.
  public shared ({ caller }) func admin_set_icrc3_proposal_neuron(neuron : ?Blob) : async { #Ok; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("Only admins can set the proposal neuron") };
    let old = icrc3_sns.neuron;
    switch (Icrc3Sns.setNeuron(icrc3_sns, neuron)) {
      case (#Err(e)) { #Err(e) };
      case (#Ok) {
        let asValue = func(n : ?Blob) : T3.Value { switch (n) { case (?b) { #Blob(b) }; case null { #Text("none") } } };
        icrc3_config(caller, get_next_correlation_id(), "icrc3_proposal_neuron", asValue(neuron), ?asValue(old));
        #Ok;
      };
    };
  };

  /// Submit the pending registration proposals now instead of at the next spill check.
  public shared ({ caller }) func admin_icrc3_register_archives_now() : async { #Ok : Nat; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("Only admins can submit registration proposals") };
    #Ok(await* Icrc3Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env()));
  };

  /// Forget an archive's proposal (after a rejection) so a new one is submitted.
  public shared ({ caller }) func admin_icrc3_reset_archive_registration(canister_id : Principal) : async { #Ok : Bool; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("Only admins can reset a registration") };
    #Ok(Icrc3Sns.reset(icrc3_sns, canister_id));
  };

  /// Write the log start and import blocks if that has not happened yet.
  /// Returns the number of blocks written (0 when already imported).
  public shared ({ caller }) func admin_icrc3_import_history() : async { #Ok : Nat; #Err : Text } {
    if (not isAdmin(caller)) { return #Err("Only admins can import the history") };
    #Ok(icrc3_import_history());
  };

  /// Re-apply the intended controllers (this canister and SNS root) to every archive.
  public shared ({ caller }) func admin_icrc3_repair_archive_controllers() : async [(Principal, { #Ok; #Err : Text })] {
    if (not isAdmin(caller)) { Debug.trap("Only admins can repair archive controllers") };
    await* Icrc3Log.repairArchiveControllers(icrc3, icrc3_env());
  };

  // ---- background work ----

  private func ensure_icrc3_timer<system>() {
    Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job);
  };

  private func icrc3_timer_job() : async () {
    ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false);
    ignore await* Icrc3Sns.registerMissing(icrc3_sns, icrc3_sns_rt, icrc3.archives, icrc3_sns_env());
  };

  private func schedule_icrc3_import<system>() {
    if (icrc3.history_imported) { return };
    ignore Timer.setTimer<system>(#seconds 0, func() : async () { ignore icrc3_import_history(); activate_nfts<system>() });
  };

  // ---- one-time import of the state that existed before the log ----

  private func icrc3_import_history() : Nat {
    if (icrc3.history_imported) { return 0 };
    let now = Int.abs(Time.now());
    let now64 = NowAsNat64();
    var written = 0;
    func add(btype : Text, tx : [(Text, T3.Value)]) {
      ignore Icrc3Log.append(icrc3, btype, now, tx);
      written += 1;
    };
    func status_of(expiry : Nat64) : T3.Value {
      #Text(if (expiry > now64) { "active" } else { "expired" });
    };

    let active_token = Array.sort<T.FullyQualifiedLock>(get_fully_qualified_locks(), func(a, b) { Nat.compare(a.2.lock_id, b.2.lock_id) });
    let active_position = Array.sort<T.FullyQualifiedPositionLock>(get_fully_qualified_position_locks(), func(a, b) { Nat.compare(a.2.lock_id, b.2.lock_id) });
    let archived_token = Array.sort<ArchivedTokenLock>(Iter.toArray(archived_token_locks.vals()), func(a, b) { Nat.compare(a.lock.lock_id, b.lock.lock_id) });
    let archived_position = Array.sort<ArchivedPositionLock>(Iter.toArray(archived_position_locks.vals()), func(a, b) { Nat.compare(a.lock.lock_id, b.lock.lock_id) });

    add("sneedlock_log_start", [
      ("canister", Icrc3Log.principal(this_canister_id())), ("current_lock_id", #Nat(current_lock_id)),
      ("active_token_locks", #Nat(active_token.size())), ("active_position_locks", #Nat(active_position.size())),
      ("archived_token_locks", #Nat(archived_token.size())), ("archived_position_locks", #Nat(archived_position.size())),
      ("total_token_lock_fees_e8s", #Nat(total_token_lock_fees_collected_e8s)), ("total_position_lock_fees_e8s", #Nat(total_position_lock_fees_collected_e8s)),
    ]);

    for ((owner, ledger, lock) in active_token.vals()) {
      add("sneedlock_import_token_lock", [
        ("owner", Icrc3Log.principal(owner)), ("ledger", Icrc3Log.principal(ledger)), ("lock_id", #Nat(lock.lock_id)),
        ("amount", #Nat(lock.amount)), ("expiry", Icrc3Log.nat64(lock.expiry)), ("status", status_of(lock.expiry)),
      ]);
    };
    for (a in archived_token.vals()) {
      add("sneedlock_import_token_lock", [
        ("owner", Icrc3Log.principal(a.owner)), ("ledger", Icrc3Log.principal(a.token_type)), ("lock_id", #Nat(a.lock.lock_id)),
        ("amount", #Nat(a.lock.amount)), ("expiry", Icrc3Log.nat64(a.lock.expiry)), ("status", #Text("expired")),
      ]);
    };
    for ((owner, pool, lock) in active_position.vals()) {
      add("sneedlock_import_position_lock", [
        ("owner", Icrc3Log.principal(owner)), ("pool", Icrc3Log.principal(pool)), ("position_id", #Nat(lock.position_id)), ("lock_id", #Nat(lock.lock_id)),
        ("expiry", Icrc3Log.nat64(lock.expiry)), ("token0", Icrc3Log.principal(lock.token0)), ("token1", Icrc3Log.principal(lock.token1)), ("dex", #Nat(lock.dex)),
        ("status", status_of(lock.expiry)),
      ]);
    };
    for (a in archived_position.vals()) {
      add("sneedlock_import_position_lock", [
        ("owner", Icrc3Log.principal(a.owner)), ("pool", Icrc3Log.principal(a.swap_canister_id)), ("position_id", #Nat(a.lock.position_id)), ("lock_id", #Nat(a.lock.lock_id)),
        ("expiry", Icrc3Log.nat64(a.lock.expiry)), ("token0", Icrc3Log.principal(a.lock.token0)), ("token1", Icrc3Log.principal(a.lock.token1)), ("dex", #Nat(a.lock.dex)),
        ("status", #Text("expired")),
      ]);
    };
    for ((owner, swaps) in state.principal_position_ownerships.entries()) {
      for ((pool, position_ids) in swaps.entries()) {
        for (position_id in List.toIter(position_ids)) {
          switch (get_position_lock(owner, pool, position_id)) {
            case (?_) {};
            case null {
              add("sneedlock_import_position_claim", [
                ("owner", Icrc3Log.principal(owner)), ("pool", Icrc3Log.principal(pool)), ("position_id", #Nat(position_id)),
              ]);
            };
          };
        };
      };
    };

    icrc3.history_imported := true;
    log_info(this_canister_id(), get_next_correlation_id(), "ICRC-3: imported " # Nat.toText(written) # " history blocks");
    written;
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
    icrc3_config(caller, correlation_id, "admin_added", #Text(Principal.toText(new_admin)), null);
    
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
    icrc3_config(caller, correlation_id, "admin_removed", #Text(Principal.toText(admin_to_remove)), null);
    
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

    switch (result) {
      case (#Ok(tx_index)) {
        icrc3_add("sneedlock_admin_token_return", [
          ("cid", #Nat(get_next_correlation_id())), ("caller", Icrc3Log.principal(caller)), ("ledger", Icrc3Log.principal(icrc1_ledger_canister_id)),
          ("from", Icrc3Log.account(this_canister_id(), ?Blob.fromArray(subaccount))), ("to", Icrc3Log.account(user_account_to.owner, null)),
          ("amount", #Nat(amount)), ("ledger_tx", #Nat(tx_index)),
        ]);
      };
      case (#Err(_)) {};
    };
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

    switch (result) {
      case (#Ok(tx_index)) {
        icrc3_add("sneedlock_admin_token_return", [
          ("cid", #Nat(get_next_correlation_id())), ("caller", Icrc3Log.principal(caller)), ("ledger", Icrc3Log.principal(icrc1_ledger_canister_id)),
          ("from", Icrc3Log.account(this_canister_id(), null)), ("to", Icrc3Log.account(user_account_to.owner, null)),
          ("amount", #Nat(amount)), ("ledger_tx", #Nat(tx_index)),
        ]);
      };
      case (#Err(_)) {};
    };
    return result;
  };


  public shared ({ caller }) func set_max_lock_length_days(new_max_lock_length_days: Nat64) : async () {    
    if (not isAdmin(caller)) {
      Debug.trap("Only the SNEED governance can set the max lock length.");
    };

    let old_max_lock_length_ns = max_lock_length_ns;
    max_lock_length_ns := new_max_lock_length_days * day_ns;
    icrc3_config(caller, get_next_correlation_id(), "max_lock_length_ns", #Nat(Nat64.toNat(max_lock_length_ns)), ?#Nat(Nat64.toNat(old_max_lock_length_ns)));
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
    icrc3_config(caller, get_next_correlation_id(), "sneed_premium_canister_id",
      #Text(switch (canister_id) { case (?id) Principal.toText(id); case null "none" }), null);
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
    let correlation_id = get_next_correlation_id();
    
    switch (token_lock_fee) {
      case (?fee) { icrc3_config(caller, correlation_id, "token_lock_fee_icp_e8s", #Nat(Nat64.toNat(fee)), ?#Nat(Nat64.toNat(token_lock_fee_icp_e8s))); token_lock_fee_icp_e8s := fee };
      case null {};
    };
    switch (position_lock_fee) {
      case (?fee) { icrc3_config(caller, correlation_id, "position_lock_fee_icp_e8s", #Nat(Nat64.toNat(fee)), ?#Nat(Nat64.toNat(position_lock_fee_icp_e8s))); position_lock_fee_icp_e8s := fee };
      case null {};
    };
    switch (premium_token_lock_fee) {
      case (?fee) { icrc3_config(caller, correlation_id, "premium_token_lock_fee_icp_e8s", #Nat(Nat64.toNat(fee)), ?#Nat(Nat64.toNat(premium_token_lock_fee_icp_e8s))); premium_token_lock_fee_icp_e8s := fee };
      case null {};
    };
    switch (premium_position_lock_fee) {
      case (?fee) { icrc3_config(caller, correlation_id, "premium_position_lock_fee_icp_e8s", #Nat(Nat64.toNat(fee)), ?#Nat(Nat64.toNat(premium_position_lock_fee_icp_e8s))); premium_position_lock_fee_icp_e8s := fee };
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
    
    icrc3_config(caller, get_next_correlation_id(), "icp_fee_recipient", #Text(principal_text # " / " # subaccount_text), null);
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
          
          icrc3_add("sneedlock_fee_pay", [
            ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("payer", Icrc3Log.principal(caller)),
            ("lock_type", #Text(switch (lock_type) { case (#TokenLock) "token"; case (#PositionLock) "position" })),
            ("fee_e8s", #Nat(fee_nat)), ("amount_e8s", #Nat(transfer_amount)),
            ("to", Icrc3Log.account(recipient_owner, icp_fee_recipient_subaccount)), ("icp_tx", #Nat(blockIdx)),
          ]);
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
  // ---------------------------------------------------------------------------
  // Fee claims for locked positions
  //
  // ICPSwap's claimToSubaccount collects a position's accrued fees and has the
  // pool deliver them straight to the caller's account at the given subaccount.
  // sneed_lock passes the owner's wallet subaccount on this canister, so the fees
  // land in the owner's own balance with no shared-account accounting here.
  // Delivery is performed by the pool's withdraw queue shortly after the call
  // returns. A bounded history of claims is kept for owners and admins.
  // ---------------------------------------------------------------------------

  private func archive_completed_request(request : ClaimRequest) : () {
    completed_claim_requests := Array.append(completed_claim_requests, [request]);
    if (completed_claim_requests.size() > 1000) {
      let start_index = completed_claim_requests.size() - 1000;
      completed_claim_requests := Array.subArray(completed_claim_requests, start_index, 1000);
    };
  };

  private func archive_failed_request(request : ClaimRequest) : () {
    failed_claim_requests := Array.append(failed_claim_requests, [request]);
    if (failed_claim_requests.size() > 1000) {
      let start_index = failed_claim_requests.size() - 1000;
      failed_claim_requests := Array.subArray(failed_claim_requests, start_index, 1000);
    };
  };

  private func claim_position_fees_internal(
    caller : Principal,
    swap_canister_id : T.SwapCanisterId,
    position_id : T.PositionId,
    correlation_id : Nat
  ) : async* { #Ok : ClaimRequest; #Err : Text } {
    log_info(caller, correlation_id, "Claiming fees for position " # debug_show(position_id) # " on swap canister " # debug_show(swap_canister_id));

    if (not has_claimed_position_impl(caller, swap_canister_id, position_id)) {
      let error = "Caller does not own position " # debug_show(position_id) # " on swap canister " # debug_show(swap_canister_id);
      log_error(caller, correlation_id, error);
      return #Err(error);
    };

    let (token0, token1) = switch (get_position_lock(caller, swap_canister_id, position_id)) {
      case (?lock) { (lock.token0, lock.token1) };
      case null {
        let error = "Position " # debug_show(position_id) # " is not locked";
        log_error(caller, correlation_id, error);
        return #Err(error);
      };
    };

    if (is_pool_op_locked(swap_canister_id)) {
      let error = "Busy: another operation is in progress on this pool; please retry in a few seconds";
      log_error(caller, correlation_id, error);
      return #Err(error);
    };
    lock_pool_op(swap_canister_id);
    try {
      await* claim_position_fees_locked(caller, swap_canister_id, position_id, token0, token1, correlation_id);
    } finally {
      unlock_pool_op(swap_canister_id);
    };
  };

  private func claim_position_fees_locked(
    caller : Principal,
    swap_canister_id : T.SwapCanisterId,
    position_id : T.PositionId,
    token0 : T.TokenType,
    token1 : T.TokenType,
    correlation_id : Nat
  ) : async* { #Ok : ClaimRequest; #Err : Text } {
    next_claim_request_id += 1;
    let now = TimeAsNat64(Time.now());
    let request : ClaimRequest = {
      request_id = next_claim_request_id;
      caller;
      swap_canister_id;
      position_id;
      token0;
      token1;
      status = #Processing;
      created_at = now;
      started_processing_at = ?now;
      completed_at = null;
      retry_count = 1;
      last_attempted_at = ?now;
    };

    func fail(message : Text) : { #Ok : ClaimRequest; #Err : Text } {
      log_error(caller, correlation_id, message);
      archive_failed_request({ request with status = #Failed(message); completed_at = ?TimeAsNat64(Time.now()) });
      #Err(message);
    };

    let swap_canister = actor (Principal.toText(swap_canister_id)) : actor {
      claimToSubaccount : (args : { positionId : Nat; subaccount : Blob }) -> async { #ok : { amount0 : Nat; amount1 : Nat }; #err : T.SwapCanisterError };
      getUserPosition : (positionId : Nat) -> async { #ok : { tokensOwed0 : Nat; tokensOwed1 : Nat; liquidity : Nat; feeGrowthInside0LastX128 : Nat; feeGrowthInside1LastX128 : Nat }; #err : T.SwapCanisterError };
    };
    let token0_ledger = actor (Principal.toText(token0)) : actor { icrc1_fee : () -> async Nat };
    let token1_ledger = actor (Principal.toText(token1)) : actor { icrc1_fee : () -> async Nat };

    // The pool charges the ledger fee on delivery and drops any amount at or
    // below the fee, so only claim when at least one side is worth delivering.
    let (token0_fee, token1_fee, tokens_owed0, tokens_owed1) = try {
      let fee0 = await token0_ledger.icrc1_fee();
      let fee1 = await token1_ledger.icrc1_fee();
      switch (await swap_canister.getUserPosition(position_id)) {
        case (#ok(info)) { (fee0, fee1, info.tokensOwed0, info.tokensOwed1) };
        case (#err(err)) { return fail("Failed to get position info: " # debug_show(err)) };
      };
    } catch (e) {
      return fail("Failed to query fees or position: " # Error.message(e));
    };

    if (tokens_owed0 <= token0_fee and tokens_owed1 <= token1_fee) {
      return fail("Insufficient rewards to claim. Token0: " # debug_show(tokens_owed0) # " (need > " # debug_show(token0_fee) # "), Token1: " # debug_show(tokens_owed1) # " (need > " # debug_show(token1_fee) # ")");
    };

    let subaccount = Blob.fromArray(PrincipalToSubaccount(caller));
    let claim_result = try {
      await swap_canister.claimToSubaccount({ positionId = position_id; subaccount });
    } catch (e) {
      // The pool either rolled the claim back or will still deliver to the
      // owner's subaccount from its own queue; sneed_lock never holds the funds.
      return fail("Claim call failed with unknown outcome: " # Error.message(e));
    };

    switch (claim_result) {
      case (#err(err)) { fail("Claim failed: " # debug_show(err)) };
      case (#ok(amounts)) {
        let delivered0 = if (amounts.amount0 > token0_fee) { amounts.amount0 - token0_fee } else { 0 };
        let delivered1 = if (amounts.amount1 > token1_fee) { amounts.amount1 - token1_fee } else { 0 };
        let completed : ClaimRequest = {
          request with
          status = #Completed({
            amount0_claimed = amounts.amount0;
            amount1_claimed = amounts.amount1;
            amount0_transferred = delivered0;
            amount1_transferred = delivered1;
            transfer0_tx_id = null; // the pool performs the ledger transfers
            transfer1_tx_id = null;
          });
          completed_at = ?TimeAsNat64(Time.now());
        };
        // Claimed amounts at or below the fee are credited to this canister's
        // pool account but never delivered: record them as resting dust.
        note_pool_dust(
          swap_canister_id,
          if (amounts.amount0 > 0 and amounts.amount0 <= token0_fee) { amounts.amount0 } else { 0 },
          if (amounts.amount1 > 0 and amounts.amount1 <= token1_fee) { amounts.amount1 } else { 0 }
        );
        archive_completed_request(completed);
        icrc3_add("sneedlock_fees_claim", [
          ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("owner", Icrc3Log.principal(caller)),
          ("pool", Icrc3Log.principal(swap_canister_id)), ("position_id", #Nat(position_id)),
          ("token0", Icrc3Log.principal(token0)), ("token1", Icrc3Log.principal(token1)),
          ("amount0", #Nat(amounts.amount0)), ("amount1", #Nat(amounts.amount1)),
          ("delivered0", #Nat(delivered0)), ("delivered1", #Nat(delivered1)), ("request_id", #Nat(request.request_id)),
        ]);
        log_info(caller, correlation_id, "Claimed fees for position " # debug_show(position_id) # ": token0=" # debug_show(amounts.amount0) # ", token1=" # debug_show(amounts.amount1) # "; delivered by the pool to the owner's wallet subaccount");
        #Ok(completed);
      };
    };
  };

  /// Claim the accrued trading fees of a locked position. The pool delivers
  /// them to the caller's wallet subaccount on this canister.
  public shared ({ caller }) func claim_position_fees(swap_canister_id : T.SwapCanisterId, position_id : T.PositionId) : async T.ClaimFeesResult {
    let correlation_id = get_next_correlation_id();
    switch (await* claim_position_fees_internal(caller, swap_canister_id, position_id, correlation_id)) {
      case (#Err(e)) { #Err(e) };
      case (#Ok(request)) {
        switch (request.status) {
          case (#Completed(details)) {
            #Ok({ request_id = request.request_id; amount0 = details.amount0_claimed; amount1 = details.amount1_claimed; token0 = request.token0; token1 = request.token1 });
          };
          case _ { #Err("Unexpected claim state") };
        };
      };
    };
  };

  /// Compatibility entry point for older frontends: performs the claim
  /// synchronously and returns the history id, which get_claim_request_status
  /// then reports as completed or failed.
  public shared ({ caller }) func request_claim_and_withdraw(swap_canister_id : T.SwapCanisterId, position_id : T.PositionId) : async ClaimAndWithdrawResult {
    let correlation_id = get_next_correlation_id();
    switch (await* claim_position_fees_internal(caller, swap_canister_id, position_id, correlation_id)) {
      case (#Ok(request)) { #Ok(request.request_id) };
      case (#Err(e)) { #Err(e) };
    };
  };

  // Query: Get the caller's claim history (completed and failed)
  public query ({ caller }) func get_my_claim_history() : async [ClaimRequest] {
    Array.append(
      Array.filter<ClaimRequest>(completed_claim_requests, func (req) { req.caller == caller }),
      Array.filter<ClaimRequest>(failed_claim_requests, func (req) { req.caller == caller })
    );
  };

  // ---------------------------------------------------------------------------
  // Adding liquidity to a locked position
  // ---------------------------------------------------------------------------

  // Move `amount` of `token` from the caller's backend wallet into this
  // canister's account in the pool: an ICRC-1 transfer to the pool's deposit
  // subaccount for this canister, then the pool's `deposit`. Returns the
  // amount the pool credited.
  private func move_tokens_into_pool(
    caller : Principal,
    correlation_id : Nat,
    pool_id : Principal,
    pool : IcpSwapPool,
    ledger : Icrc1Ledger,
    token : Principal,
    amount : Nat,
    fee : Nat
  ) : async* { #Ok : Nat; #Err : Text } {
    if (amount == 0) { return #Ok(0) };

    let from_subaccount = PrincipalToSubaccount(caller);
    let caller_account : Account = { owner = this_canister_id(); subaccount = ?Blob.fromArray(from_subaccount) };
    let sum_locked = get_summed_locks_from_principal_and_token(caller, token);
    let balance = try { await ledger.icrc1_balance_of(caller_account) } catch (e) {
      return #Err("Failed to read backend wallet balance for " # debug_show(token) # ": " # Error.message(e));
    };
    if (balance < amount + fee + sum_locked) {
      return #Err("Insufficient unlocked balance in backend wallet for " # debug_show(token) # ": balance " # debug_show(balance) # ", locked " # debug_show(sum_locked) # ", needed " # debug_show(amount + fee));
    };

    let to : Account = { owner = pool_id; subaccount = ?Blob.fromArray(PrincipalToSubaccount(this_canister_id())) };
    let transfer = try {
      await ledger.icrc1_transfer({ from_subaccount = ?Blob.fromArray(from_subaccount); to; amount; fee = ?fee; memo = null; created_at_time = null });
    } catch (e) {
      return #Err("Transfer of " # debug_show(amount) # " " # debug_show(token) # " to the pool deposit subaccount failed with unknown outcome: " # Error.message(e));
    };
    switch (transfer) {
      case (#Err(e)) { return #Err("Transfer of " # debug_show(amount) # " " # debug_show(token) # " to the pool deposit subaccount failed: " # debug_show(e)) };
      case (#Ok(_)) {};
    };
    log_info(caller, correlation_id, "Transferred " # debug_show(amount) # " " # debug_show(token) # " to the deposit subaccount of pool " # debug_show(pool_id));

    let stuck = "ADMIN ACTION: " # debug_show(amount) # " " # debug_show(token) # " for " # debug_show(caller) # " sit in pool " # debug_show(pool_id) # "'s deposit subaccount; re-run admin_pool_deposit then admin_withdraw_pool_balance_to_user";
    let deposited = try { await pool.deposit({ token = Principal.toText(token); amount; fee }) } catch (e) {
      return #Err("Pool deposit call failed with unknown outcome: " # Error.message(e) # ". " # stuck);
    };
    switch (deposited) {
      case (#err(e)) { #Err("Pool deposit failed: " # debug_show(e) # ". " # stuck) };
      case (#ok(credited)) {
        log_info(caller, correlation_id, "Pool credited " # debug_show(credited) # " " # debug_show(token));
        #Ok(credited);
      };
    };
  };

  // Send `amount` of `token` from this canister's pool account to the caller's
  // backend wallet. Amounts at or below the fee cannot be delivered and are
  // reported back as dust for the quiescent level. Returns (delivered, dust).
  private func return_pool_balance_to_caller(
    caller : Principal,
    correlation_id : Nat,
    pool_id : Principal,
    pool : IcpSwapPool,
    token : Principal,
    amount : Nat,
    fee : Nat
  ) : async* { #Ok : (Nat, Nat); #Err : Text } {
    if (amount == 0) { return #Ok((0, 0)) };
    if (amount <= fee) { return #Ok((0, amount)) };
    let args = { token = Principal.toText(token); amount; fee; subaccount = Blob.fromArray(PrincipalToSubaccount(caller)) };
    let stuck = "ADMIN ACTION: " # debug_show(amount) # " " # debug_show(token) # " for " # debug_show(caller) # " remain in this canister's account in pool " # debug_show(pool_id) # "; use admin_withdraw_pool_balance_to_user";
    let result = try { await pool.withdrawToSubaccount(args) } catch (e) {
      return #Err("Returning unused tokens failed with unknown outcome: " # Error.message(e) # ". " # stuck);
    };
    switch (result) {
      case (#err(e)) { #Err("Returning unused tokens failed: " # debug_show(e) # ". " # stuck) };
      case (#ok(_)) {
        log_info(caller, correlation_id, "Returned " # debug_show(amount) # " " # debug_show(token) # " from pool " # debug_show(pool_id) # " to the caller's backend wallet");
        #Ok((amount, 0));
      };
    };
  };

  private func add_liquidity_internal(
    caller : Principal,
    correlation_id : Nat,
    pool_id : Principal,
    position_id : T.PositionId,
    token0 : Principal,
    token1 : Principal,
    amount0 : Nat,
    amount1 : Nat
  ) : async* T.AddLiquidityResult {
    func err(message : Text) : T.AddLiquidityResult {
      log_error(caller, correlation_id, message);
      #Err(message);
    };

    let pool : IcpSwapPool = actor (Principal.toText(pool_id));
    let ledger0 : Icrc1Ledger = actor (Principal.toText(token0));
    let ledger1 : Icrc1Ledger = actor (Principal.toText(token1));

    let (fee0, fee1) = try { (await ledger0.icrc1_fee(), await ledger1.icrc1_fee()) } catch (e) {
      return err("Failed to query ledger fees: " # Error.message(e));
    };
    // Moving a token in costs one fee for the transfer and one inside the pool's
    // deposit; anything smaller cannot end up as liquidity.
    if (amount0 > 0 and amount0 <= 2 * fee0) { return err("amount0 must exceed twice the ledger fee (" # debug_show(fee0) # ")") };
    if (amount1 > 0 and amount1 <= 2 * fee1) { return err("amount1 must exceed twice the ledger fee (" # debug_show(fee1) # ")") };

    // Quiescence: the live balance must equal the expected resting level.
    let live = try {
      switch (await pool.getUserUnusedBalance(this_canister_id())) {
        case (#ok(b)) { b };
        case (#err(e)) { return err("Failed to read pool balance: " # debug_show(e)) };
      };
    } catch (e) { return err("Failed to read pool balance: " # Error.message(e)) };
    let level = switch (Map.get(pool_quiescent_balances, phash, pool_id)) {
      case null { (live.balance0, live.balance1) };
      case (?(l0, l1)) { (Nat.min(l0, live.balance0), Nat.min(l1, live.balance1)) };
    };
    Map.set(pool_quiescent_balances, phash, pool_id, level);
    if (live.balance0 > level.0 or live.balance1 > level.1) {
      return err("Busy: a fee delivery from this pool is still in transit; please retry in a few seconds");
    };

    clear_expired_locks_for_principal(caller, correlation_id);

    // Move both tokens in. If the second fails after the first was credited,
    // return the first before giving up.
    let credited0 = switch (await* move_tokens_into_pool(caller, correlation_id, pool_id, pool, ledger0, token0, amount0, fee0)) {
      case (#Err(m)) { return err(m) };
      case (#Ok(c)) { c };
    };
    let credited1 = switch (await* move_tokens_into_pool(caller, correlation_id, pool_id, pool, ledger1, token1, amount1, fee1)) {
      case (#Err(m)) {
        var note = "";
        switch (await* return_pool_balance_to_caller(caller, correlation_id, pool_id, pool, token0, credited0, fee0)) {
          case (#Ok((_, dust0))) { note_pool_dust(pool_id, dust0, 0); note := " token0 was returned to your backend wallet." };
          case (#Err(m0)) { note := " Returning token0 also failed: " # m0 };
        };
        return err(m # note);
      };
      case (#Ok(c)) { c };
    };

    // Add liquidity. Whatever the outcome, the leftover is measured from the
    // live balance afterwards, which is exact while the pool lock is held.
    let increase_error : ?Text = try {
      switch (await pool.increaseLiquidity({ positionId = position_id; amount0Desired = Nat.toText(credited0); amount1Desired = Nat.toText(credited1) })) {
        case (#ok(_)) { null };
        case (#err(e)) { ?("Pool refused to add liquidity: " # debug_show(e)) };
      };
    } catch (e) { ?("increaseLiquidity call failed with unknown outcome: " # Error.message(e)) };
    switch (increase_error) {
      case (?m) { log_error(caller, correlation_id, m) };
      case null { log_info(caller, correlation_id, "Pool accepted liquidity for position " # debug_show(position_id) # " (desired " # debug_show(credited0) # " / " # debug_show(credited1) # ")") };
    };

    let after = try {
      switch (await pool.getUserUnusedBalance(this_canister_id())) {
        case (#ok(b)) { b };
        case (#err(e)) { return err("Liquidity step done but reading the pool balance failed: " # debug_show(e) # ". ADMIN ACTION: check this canister's balance in pool " # debug_show(pool_id) # " for " # debug_show(caller)) };
      };
    } catch (e) { return err("Liquidity step done but reading the pool balance failed: " # Error.message(e)) };

    func leftover(live_after : Nat, base : Nat, credited : Nat) : Nat {
      let delta = if (live_after > base) { live_after - base } else { 0 };
      if (delta > credited) { credited } else { delta };
    };
    let leftover0 = leftover(after.balance0, level.0, credited0);
    let leftover1 = leftover(after.balance1, level.1, credited1);
    let used0 = credited0 - leftover0;
    let used1 = credited1 - leftover1;

    var returned0 = 0; var returned1 = 0; var dust0 = 0; var dust1 = 0; var return_errors = "";
    switch (await* return_pool_balance_to_caller(caller, correlation_id, pool_id, pool, token0, leftover0, fee0)) {
      case (#Ok((r, d))) { returned0 := r; dust0 := d };
      case (#Err(m)) { return_errors := return_errors # m # " " };
    };
    switch (await* return_pool_balance_to_caller(caller, correlation_id, pool_id, pool, token1, leftover1, fee1)) {
      case (#Ok((r, d))) { returned1 := r; dust1 := d };
      case (#Err(m)) { return_errors := return_errors # m # " " };
    };
    note_pool_dust(pool_id, dust0, dust1);

    if (return_errors != "") {
      // Liquidity may have been added; the unreturned remainder is still in
      // this canister's pool account and the pool stays flagged busy until an
      // admin returns it, since the live balance now exceeds the resting level.
      return err("Added liquidity (used " # debug_show(used0) # " / " # debug_show(used1) # ") but returning the unused remainder failed: " # return_errors);
    };

    let liquidity_tx : [(Text, T3.Value)] = [
      ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("owner", Icrc3Log.principal(caller)),
      ("pool", Icrc3Log.principal(pool_id)), ("position_id", #Nat(position_id)), ("token0", Icrc3Log.principal(token0)), ("token1", Icrc3Log.principal(token1)),
      ("amount0", #Nat(amount0)), ("amount1", #Nat(amount1)), ("credited0", #Nat(credited0)), ("credited1", #Nat(credited1)),
      ("used0", #Nat(used0)), ("used1", #Nat(used1)), ("returned0", #Nat(returned0)), ("returned1", #Nat(returned1)),
    ];
    icrc3_add("sneedlock_liquidity_add", switch (increase_error) {
      case (?m) { Array.append(liquidity_tx, [("increase_error", #Text(m))]) };
      case null { liquidity_tx };
    });
    log_info(caller, correlation_id, "Add liquidity complete for position " # debug_show(position_id) # ": used " # debug_show(used0) # " / " # debug_show(used1) # ", returned " # debug_show(returned0) # " / " # debug_show(returned1));
    #Ok({
      position_id;
      credited0; credited1;
      used0; used1;
      returned0; returned1;
      increase_error;
    });
  };

  /// Add liquidity to a locked ICPSwap position from the caller's backend
  /// wallet. Amounts are in base units; either may be zero (out-of-range
  /// positions take only one token). Tokens the pool does not use, because the
  /// price moved since the amounts were chosen, are returned to the caller's
  /// backend wallet. Only the current owner of the lock may add.
  public shared ({ caller }) func add_liquidity_to_locked_position(
    swap_canister_id : T.SwapCanisterId,
    position_id : T.PositionId,
    amount0 : Nat,
    amount1 : Nat
  ) : async T.AddLiquidityResult {
    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Add liquidity requested for position " # debug_show(position_id) # " on pool " # debug_show(swap_canister_id) # ": amount0=" # debug_show(amount0) # ", amount1=" # debug_show(amount1));

    func err(message : Text) : T.AddLiquidityResult {
      log_error(caller, correlation_id, message);
      #Err(message);
    };

    if (not has_claimed_position_impl(caller, swap_canister_id, position_id)) {
      return err("Caller does not own position " # debug_show(position_id) # " on swap canister " # debug_show(swap_canister_id));
    };
    let lock = switch (get_position_lock(caller, swap_canister_id, position_id)) {
      case (?l) { l };
      case null { return err("Position " # debug_show(position_id) # " is not locked") };
    };
    if (lock.expiry <= NowAsNat64()) {
      return err("The lock on this position has expired; withdraw the position and add liquidity on ICPSwap directly");
    };
    if (amount0 == 0 and amount1 == 0) { return err("Nothing to add") };

    if (is_token_op_locked(caller)) { return err("A token operation is already in progress for this caller; please retry") };
    if (is_pool_op_locked(swap_canister_id)) { return err("Busy: another operation is in progress on this pool; please retry in a few seconds") };
    lock_token_op(caller);
    lock_pool_op(swap_canister_id);
    try {
      await* add_liquidity_internal(caller, correlation_id, swap_canister_id, position_id, lock.token0, lock.token1, amount0, amount1);
    } finally {
      unlock_pool_op(swap_canister_id);
      unlock_token_op(caller);
    };
  };

  // Query: contents of the retired request queue (read-only; should be empty)
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

  // Query: Get claim request status by ID (searches completed and failed history).
  // Claims are synchronous now; the #Active variant is kept for interface compatibility.
  public query func get_claim_request_status(request_id : ClaimRequestId) : async ?{
    #Active : ClaimRequest;
    #Completed : ClaimRequest;
    #Failed : ClaimRequest;
  } {
    switch (Array.find<ClaimRequest>(completed_claim_requests, func (req) { req.request_id == request_id })) {
      case (?completed_req) { ?#Completed(completed_req) };
      case null {
        switch (Array.find<ClaimRequest>(failed_claim_requests, func (req) { req.request_id == request_id })) {
          case (?failed_req) { ?#Failed(failed_req) };
          case null { null };
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

  // Admin: Clear completed requests array
  public shared ({ caller }) func admin_clear_completed_claim_requests() : async Nat {
    if (not isAdmin(caller)) {
      Debug.trap("Only admin can clear completed requests");
    };

    let before_count = completed_claim_requests.size();
    completed_claim_requests := [];

    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Cleared completed claim requests, removed " # debug_show(before_count) # " entries");
    icrc3_config(caller, correlation_id, "claim_history_cleared", #Nat(before_count), null);
    
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
    icrc3_config(caller, correlation_id, "failed_claim_history_cleared", #Nat(before_count), null);
    
    before_count;
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
      case (#Ok(tx_index)) {
        icrc3_add("sneedlock_admin_token_rescue", [
          ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("ledger", Icrc3Log.principal(token_ledger)),
          ("to", Icrc3Log.account(recipient, null)), ("amount", #Nat(transfer_amount)), ("ledger_tx", #Nat(tx_index)),
        ]);
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

  // Admin: inspect this canister's unused balance held inside a swap pool.
  // Normally zero; a non-zero balance means a pool-side delivery failed after
  // a claim and the amount is waiting in the pool under this canister's account.
  public shared ({ caller }) func admin_get_pool_unused_balance(swap_canister_id : T.SwapCanisterId) : async { #Ok : { balance0 : Nat; balance1 : Nat }; #Err : Text } {
    if (not isAdmin(caller)) {
      Debug.trap("Only admin can query pool balances");
    };
    let swap_canister = actor (Principal.toText(swap_canister_id)) : actor {
      getUserUnusedBalance : (principal : Principal) -> async { #ok : { balance0 : Nat; balance1 : Nat }; #err : T.SwapCanisterError };
    };
    try {
      switch (await swap_canister.getUserUnusedBalance(this_canister_id())) {
        case (#ok(balances)) { #Ok(balances) };
        case (#err(err)) { #Err(debug_show(err)) };
      };
    } catch (e) {
      #Err(Error.message(e));
    };
  };

  // Admin: re-run a pool deposit for tokens that were transferred to the
  // pool's deposit subaccount for this canister but never credited (a failed
  // `deposit` during a liquidity addition). Credits this canister's pool
  // account; follow up with admin_withdraw_pool_balance_to_user.
  public shared ({ caller }) func admin_pool_deposit(swap_canister_id : T.SwapCanisterId, token_ledger : T.TokenType, amount : Nat) : async { #Ok : Nat; #Err : Text } {
    if (not isAdmin(caller)) {
      Debug.trap("Only admin can run pool deposits");
    };
    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Admin re-running pool deposit of " # debug_show(amount) # " " # debug_show(token_ledger) # " into pool " # debug_show(swap_canister_id));
    let pool : IcpSwapPool = actor (Principal.toText(swap_canister_id));
    let ledger : Icrc1Ledger = actor (Principal.toText(token_ledger));
    try {
      let fee = await ledger.icrc1_fee();
      switch (await pool.deposit({ token = Principal.toText(token_ledger); amount; fee })) {
        case (#ok(credited)) {
          log_info(caller, correlation_id, "Pool credited " # debug_show(credited));
          icrc3_add("sneedlock_admin_pool_deposit", [
            ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("pool", Icrc3Log.principal(swap_canister_id)), ("ledger", Icrc3Log.principal(token_ledger)),
            ("amount", #Nat(amount)), ("credited", #Nat(credited)),
          ]);
          #Ok(credited);
        };
        case (#err(e)) { let msg = "Pool deposit failed: " # debug_show(e); log_error(caller, correlation_id, msg); #Err(msg) };
      };
    } catch (e) {
      let msg = "Pool deposit call failed: " # Error.message(e);
      log_error(caller, correlation_id, msg);
      #Err(msg);
    };
  };

  // Admin: deliver a stranded pool-side balance to a user's wallet subaccount.
  // Attribution to the right user is done by the admin from the pool's
  // transaction log (getTransactionsByOwner / getFailedTransactions).
  public shared ({ caller }) func admin_withdraw_pool_balance_to_user(
    swap_canister_id : T.SwapCanisterId,
    token_ledger : T.TokenType,
    amount : Nat,
    user : Principal
  ) : async { #Ok : Nat; #Err : Text } {
    if (not isAdmin(caller)) {
      Debug.trap("Only admin can withdraw pool balances");
    };
    let correlation_id = get_next_correlation_id();
    log_info(caller, correlation_id, "Admin withdrawing " # debug_show(amount) # " of " # debug_show(token_ledger) # " from pool " # debug_show(swap_canister_id) # " to the wallet subaccount of " # debug_show(user));

    let ledger = actor (Principal.toText(token_ledger)) : actor { icrc1_fee : () -> async Nat };
    let swap_canister = actor (Principal.toText(swap_canister_id)) : actor {
      withdrawToSubaccount : (args : { token : Text; amount : Nat; fee : Nat; subaccount : Blob }) -> async { #ok : Nat; #err : T.SwapCanisterError };
    };
    try {
      let fee = await ledger.icrc1_fee();
      let args = { token = Principal.toText(token_ledger); amount; fee; subaccount = Blob.fromArray(PrincipalToSubaccount(user)) };
      switch (await swap_canister.withdrawToSubaccount(args)) {
        case (#ok(accepted)) {
          log_info(caller, correlation_id, "Pool withdrawal accepted: " # debug_show(accepted));
          icrc3_add("sneedlock_admin_pool_withdraw", [
            ("cid", #Nat(correlation_id)), ("caller", Icrc3Log.principal(caller)), ("pool", Icrc3Log.principal(swap_canister_id)), ("ledger", Icrc3Log.principal(token_ledger)),
            ("amount", #Nat(amount)), ("user", Icrc3Log.principal(user)), ("accepted", #Nat(accepted)),
          ]);
          #Ok(accepted);
        };
        case (#err(err)) {
          let msg = "Pool withdrawal failed: " # debug_show(err);
          log_error(caller, correlation_id, msg);
          #Err(msg);
        };
      };
    } catch (e) {
      let msg = "Pool withdrawal call failed: " # Error.message(e);
      log_error(caller, correlation_id, msg);
      #Err(msg);
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
      backfill_lock_created_at();

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

      /// ICRC-3 log: republish the certified tip, restart the spill timer and
      /// import the pre-log history once.
      Icrc3Log.certify(icrc3);
      activate_nfts<system>();
      ensure_icrc3_timer<system>();
      schedule_icrc3_import<system>();
  };

  public query func get_token_position_locks(token_canister_id : T.TokenType) : async [T.FullyQualifiedPositionLock] {
    let all_position_locks = get_fully_qualified_position_locks();
    Array.filter<T.FullyQualifiedPositionLock>(all_position_locks, func (position_lock) {
      position_lock.2.token0 == token_canister_id or position_lock.2.token1 == token_canister_id
    });
  };

  // Start the ICRC-3 background work. On a fresh install this also writes the
  // first (log start) block; after an upgrade postupgrade does the same.
  ensure_icrc3_timer<system>();
  schedule_icrc3_import<system>();
};
