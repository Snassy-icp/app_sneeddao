import List "mo:base/List";
import HashMap "mo:base/HashMap";
import Int "mo:base/Int";

module {
    // state management types
    public type PrincipalSwapCanisterMap = HashMap.HashMap<Principal, List.List<Principal>>;
    public type PrincipalLedgerCanisterMap = HashMap.HashMap<Principal, List.List<Principal>>;
    public type StablePrincipalSwapCanisters = [(Principal, [Principal])];
    public type StablePrincipalLedgerCanisters = [(Principal, [Principal])];

    public type State = object {
        principal_swap_canisters: PrincipalSwapCanisterMap;
        principal_ledger_canisters: PrincipalLedgerCanisterMap;
    };

    // token metadata types
    public type TokenMetaValue = { #Int : Int; #Nat : Nat; #Blob : Blob; #Text : Text };
    public type TokenMeta = {
        token0 : [(Text, TokenMetaValue)];
        token1 : [(Text, TokenMetaValue)];
    };

    public type Subaccount = [Nat8];
    public type Balance = Nat;
    public type TxIndex = Nat;
    public type Timestamp = Nat64;


    public type Account = {
        owner: Principal;
        subaccount: ?Subaccount;
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

    public type SwapRunnerTokenMetadata = {
        decimals: ?Nat8;
        fee: ?Nat;
        hasLogo: Bool;
        name: ?Text;
        standard: Text;
        symbol: ?Text;
    };

    // Neuron name types
    public type NeuronId = { id : Blob };
    public type NeuronName = {
        sns_root_canister_id : Principal;
        neuron_id : NeuronId;
        name : Text;
        verified : Bool;
    };

    // Neuron nickname types
    public type NeuronNickname = {
        sns_root_canister_id : Principal;
        neuron_id : NeuronId;
        nickname : Text;
    };

    public type NeuronNameKey = {
        sns_root_canister_id : Principal;
        neuron_id : NeuronId;
    };

    public type Neuron = {
        id : ?NeuronId;
        permissions : [(Principal, [Int32])];
    };
};