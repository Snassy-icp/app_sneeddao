import List "mo:base/List";
import HashMap "mo:base/HashMap";
import Nat64 "mo:base/Nat64";
import Int "mo:base/Int";

module {

    // basic/stable
    public type TokenType = Principal;
    public type SwapCanisterId = Principal;
    public type Balance = Nat;
    public type Expiry = Nat64;
    public type PositionId = Nat;

    public type Lock = {
        lock_id : LockId;
        amount: Balance;
        expiry: Expiry;
    };

    public type Dex = Nat;

    public type PositionLock = {
        dex: Dex;
        lock_id : LockId;
        position_id: PositionId;
        expiry: Expiry;
        token0: TokenType;
        token1: TokenType;
    };

    public type FullyQualifiedLock = (Principal, TokenType, Lock);
    public type StableLocks = [(FullyQualifiedLock)];
    public type FullyQualifiedPosition = (Principal, SwapCanisterId, PositionId);
    public type StablePositionOwnerships = [(FullyQualifiedPosition)];
    public type StablePrincipalSwapCanisters = [(Principal, [Principal])];
    public type StablePrincipalLedgerCanisters = [(Principal, [Principal])];
    public type FullyQualifiedPositionLock = (Principal, SwapCanisterId, PositionLock);
    public type StablePositionLocks = [(FullyQualifiedPositionLock)];

    public type LockId = Nat;

    // return types
    public type CreateLockError = {
        message : Text;
        transfer_error : ?TransferError;
    };

    public type CreateLockResult = {
        #Ok : LockId;
        #Err : CreateLockError;
    };

    public type SetLockFeeResult = {
        #Ok : Nat;
        #Err : Text;
    };

    public type WithdrawPositionError = {
        message : Text;
        transfer_error : ?TransferError;
    };

    public type WithdrawPositionResult = {
        #Ok;
        #Err : WithdrawPositionError;
    };

    // stores
    public type Locks = List.List<Lock>;
    public type TokenLockMap = HashMap.HashMap<TokenType, Locks>;
    public type PrincipalTokenLockMap = HashMap.HashMap<Principal, TokenLockMap>;
    
    public type Positions = List.List<PositionId>;
    public type SwapPositionsMap = HashMap.HashMap<Principal, Positions>;
    public type PrincipalSwapPositionsMap = HashMap.HashMap<Principal, SwapPositionsMap>;
    
    public type PrincipalSwapCanisterMap = HashMap.HashMap<Principal, List.List<Principal>>;
    public type PrincipalLedgerCanisterMap = HashMap.HashMap<Principal, List.List<Principal>>;

    public type PositionLocks = List.List<PositionLock>;
    public type PositionLockMap = HashMap.HashMap<SwapCanisterId, PositionLocks>;
    public type PrincipalPositionLocksMap = HashMap.HashMap<Principal, PositionLockMap>;

    public type State = object {
        principal_swap_canisters: PrincipalSwapCanisterMap;
        principal_ledger_canisters: PrincipalLedgerCanisterMap;
        principal_token_locks: PrincipalTokenLockMap;
        principal_position_ownerships: PrincipalSwapPositionsMap;
        principal_position_locks : PrincipalPositionLocksMap;
    };

    // needed for calling other canisters
    public type Subaccount = Blob;
    public type TxIndex = Nat;
    public type Timestamp = Nat64;

    public type Account = {
        owner : Principal;
        subaccount : ?Subaccount
    };

    public type TransferArgs = {
        from_subaccount : ?Subaccount;
        to : Account;
        amount : Balance;
        fee : ?Balance;
        memo : ?Blob;
        created_at_time : ?Nat64;
    };

    public type TransferResult = {
        #Ok : TxIndex;
        #Err : TransferError;
    };

    public type TimeError = {
        #TooOld;
        #CreatedInFuture : { ledger_time : Timestamp };
    };

    public type TransferError = TimeError or {
        #BadFee : { expected_fee : Balance };
        #BadBurn : { min_burn_amount : Balance };
        #InsufficientFunds : { balance : Balance };
        #Duplicate : { duplicate_of : TxIndex };
        #TemporarilyUnavailable;
        #GenericError : { error_code : Nat; message : Text };
    };

    public type SwapCanisterError = {
        #CommonError;
        #InternalError : Text;
        #UnsupportedToken : Text;
        #InsufficientFunds;
    };
 
    public type TokenMetaValue = { #Int : Int; #Nat : Nat; #Blob : Blob; #Text : Text };
    public type TokenMeta = {
        token0 : [(Text, TokenMetaValue)];
        token1 : [(Text, TokenMetaValue)];
    };
    
    public type GetUserPositionIdsByPrincipalResult = { #ok : [Nat]; #err : SwapCanisterError };
    public type TransferPositionResult = { #ok : Bool; #err : TransferPositionError };

    type TransferPositionError = {
        #CommonError;
        #InternalError: Text;
        #UnsupportedToken: Text;
        #InsufficientFunds;
    };

    public type ClaimedPosition = {
        owner: Principal;
        swap_canister_id: SwapCanisterId;
        position_id: PositionId;
        position_lock: ?PositionLock;
    };
    // TODO: this can give us guid/uuid??: https://github.com/aviate-labs/uuid.mo
};