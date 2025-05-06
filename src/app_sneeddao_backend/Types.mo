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

    public type SwapRunnerTokenMetadata = {
        decimals: ?Nat8;
        fee: ?Nat;
        hasLogo: Bool;
        name: ?Text;
        standard: Text;
        symbol: ?Text;
    };    
};