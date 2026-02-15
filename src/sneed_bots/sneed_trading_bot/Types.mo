import Principal "mo:base/Principal";
import Blob "mo:base/Blob";

import BotkeyTypes "../BotkeyTypes";

module {

    // ============================================
    // VERSION
    // ============================================

    public type Version = {
        major: Nat;
        minor: Nat;
        patch: Nat;
    };

    public let CURRENT_VERSION: Version = {
        major = 0;
        minor = 9;
        patch = 0;
    };

    // ============================================
    // ICRC-1 / ICRC-2 TYPES
    // ============================================

    public type Account = {
        owner: Principal;
        subaccount: ?Blob;
    };

    public type TransferArg = {
        to: Account;
        fee: ?Nat;
        memo: ?Blob;
        from_subaccount: ?Blob;
        created_at_time: ?Nat64;
        amount: Nat;
    };

    public type TransferError = {
        #GenericError: { message: Text; error_code: Nat };
        #TemporarilyUnavailable;
        #BadBurn: { min_burn_amount: Nat };
        #Duplicate: { duplicate_of: Nat };
        #BadFee: { expected_fee: Nat };
        #CreatedInFuture: { ledger_time: Nat64 };
        #TooOld;
        #InsufficientFunds: { balance: Nat };
    };

    public type TransferResult = {
        #Ok: Nat;
        #Err: TransferError;
    };

    public type ApproveArg = {
        fee: ?Nat;
        memo: ?Blob;
        from_subaccount: ?Blob;
        created_at_time: ?Nat64;
        amount: Nat;
        expected_allowance: ?Nat;
        expires_at: ?Nat64;
        spender: Account;
    };

    public type ApproveError = {
        #GenericError: { message: Text; error_code: Nat };
        #TemporarilyUnavailable;
        #Duplicate: { duplicate_of: Nat };
        #BadFee: { expected_fee: Nat };
        #AllowanceChanged: { current_allowance: Nat };
        #CreatedInFuture: { ledger_time: Nat64 };
        #TooOld;
        #Expired: { ledger_time: Nat64 };
        #InsufficientFunds: { balance: Nat };
    };

    public type ApproveResult = {
        #Ok: Nat;
        #Err: ApproveError;
    };

    public type AllowanceArg = {
        account: Account;
        spender: Account;
    };

    public type AllowanceResult = {
        allowance: Nat;
        expires_at: ?Nat64;
    };

    // ============================================
    // LEDGER ACTOR INTERFACE (ICRC-1 + ICRC-2)
    // ============================================

    public type LedgerActor = actor {
        icrc1_balance_of: shared query (Account) -> async Nat;
        icrc1_transfer: shared (TransferArg) -> async TransferResult;
        icrc1_fee: shared query () -> async Nat;
        icrc1_decimals: shared query () -> async Nat8;
        icrc1_symbol: shared query () -> async Text;
        icrc2_approve: shared (ApproveArg) -> async ApproveResult;
        icrc2_allowance: shared query (AllowanceArg) -> async AllowanceResult;
    };

    // ============================================
    // TOKEN REGISTRY
    // ============================================

    public type TokenRegistryEntry = {
        ledgerCanisterId: Principal;
        symbol: Text;
        decimals: Nat8;
        fee: Nat;
    };

    // ============================================
    // NAMED SUBACCOUNTS
    // ============================================

    public type SubaccountInfo = {
        number: Nat;
        name: Text;
        subaccount: Blob;
    };

    public type TokenBalance = {
        token: Principal;
        balance: Nat;
    };

    public type SubaccountBalances = {
        subaccountNumber: Nat;
        name: Text;
        balances: [TokenBalance];
    };

    // ============================================
    // DEX TYPES
    // ============================================

    // DEX IDs are stored as Nat (never as enums) per motoko_pnp.md
    // 0 = ICPSwap, 1 = KongSwap
    public module DexId {
        public let ICPSwap: Nat = 0;
        public let KongSwap: Nat = 1;
    };

    // Well-known canister IDs
    public let ICP_LEDGER: Text = "ryjl3-tyaaa-aaaaa-aaaba-cai";
    public let CKUSDC_LEDGER: Text = "xevnm-gaaaa-aaaar-qafnq-cai";
    public let CKBTC_LEDGER: Text = "mxzaz-hqaaa-aaaar-qaada-cai";
    public let CKETH_LEDGER: Text = "ss2fx-dyaaa-aaaar-qacoq-cai";
    public let SNEED_LEDGER: Text = "hvgxa-wqaaa-aaaaq-aacia-cai";

    public let ICPSWAP_FACTORY: Text = "4mmnk-kiaaa-aaaag-qbllq-cai";
    public let KONG_SWAP: Text = "2ipq2-uqaaa-aaaar-qailq-cai";

    // ============================================
    // ICPSWAP ACTOR INTERFACES
    // ============================================

    public type ICPSwapTokenInfo = {
        address: Text;
        standard: Text;
    };

    public type ICPSwapGetPoolArgs = {
        token0: ICPSwapTokenInfo;
        token1: ICPSwapTokenInfo;
        fee: Nat;
    };

    public type ICPSwapPoolData = {
        canisterId: Principal;
        token0: ICPSwapTokenInfo;
        token1: ICPSwapTokenInfo;
        fee: Nat;
        // Other fields exist but we don't need them
    };

    public type ICPSwapFactoryActor = actor {
        getPool: shared query (ICPSwapGetPoolArgs) -> async { #ok: ICPSwapPoolData; #err: { message: Text } };
    };

    public type ICPSwapQuoteArgs = {
        amountIn: Text;       // Nat as Text
        zeroForOne: Bool;
        amountOutMinimum: Text;
    };

    public type ICPSwapSwapArgs = {
        amountIn: Text;
        zeroForOne: Bool;
        amountOutMinimum: Text;
        tokenInFee: Nat;      // ICRC1 transfer fee of input token
        tokenOutFee: Nat;     // ICRC1 transfer fee of output token
    };

    public type ICPSwapPoolMetadata = {
        sqrtPriceX96: Nat;
        token0: ICPSwapTokenInfo;
        token1: ICPSwapTokenInfo;
        // Other fields exist but we don't need them all
    };

    public type ICPSwapPoolActor = actor {
        quote: shared (ICPSwapQuoteArgs) -> async { #ok: Nat; #err: { message: Text } };
        depositAndSwap: shared (ICPSwapSwapArgs) -> async { #ok: Nat; #err: { message: Text } };
        depositFromAndSwap: shared (ICPSwapSwapArgs) -> async { #ok: Nat; #err: { message: Text } };
        metadata: shared query () -> async { #ok: ICPSwapPoolMetadata; #err: { message: Text } };
    };

    // ============================================
    // KONG SWAP ACTOR INTERFACES
    // ============================================

    public type KongSwapAmountsReply = {
        pay_amount: Nat;
        receive_amount: Nat;
        mid_price: Float;
        price: Float;
        slippage: Float;       // Price impact as percentage
        txs: [KongSwapTx];
    };

    public type KongSwapTx = {
        pay_address: Text;
        pay_amount: Nat;
        receive_address: Text;
        receive_amount: Nat;
        lp_fee: Nat;
    };

    public type KongPayTxId = {
        #BlockIndex: Nat;
    };

    public type KongSwapArgs = {
        pay_token: Text;
        pay_amount: Nat;
        receive_token: Text;
        receive_amount: ?Nat;     // Minimum output (optional)
        receive_address: ?Text;   // Optional destination
        pay_tx_id: ?KongPayTxId;  // Block index for ICRC1 path
        max_slippage: ?Float;     // Max slippage percentage
        referred_by: ?Text;       // Referral
    };

    public type KongSwapReply = {
        tx_id: Nat;
        pay_amount: Nat;
        receive_amount: Nat;
        claim_ids: [Nat];
        status: Text;
        mid_price: Float;
        price: Float;
        slippage: Float;
    };

    public type KongSwapActor = actor {
        swap_amounts: shared query (Text, Nat, Text) -> async { #Ok: KongSwapAmountsReply; #Err: Text };
        swap: shared (KongSwapArgs) -> async { #Ok: KongSwapReply; #Err: Text };
    };

    // ============================================
    // SWAP QUOTE & RESULT
    // ============================================

    public type SwapQuote = {
        dexId: Nat;                     // 0=ICPSwap, 1=Kong
        inputToken: Principal;
        outputToken: Principal;
        inputAmount: Nat;               // User's input (before fees)
        effectiveInputAmount: Nat;      // After transfer/deposit fees
        expectedOutput: Nat;            // After DEX fee, before slippage
        spotPriceE8s: Nat;              // Spot price scaled to 1e8 (output per 1 input token)
        priceImpactBps: Nat;            // Price impact in basis points
        dexFeeBps: Nat;                 // DEX fee in basis points
        inputFeesTotal: Nat;            // Total input fees
        outputFeesTotal: Nat;           // Total output fees
        poolCanisterId: ?Principal;     // ICPSwap pool canister (null for Kong)
        timestamp: Int;                 // Time.now()
    };

    public type SwapResult = {
        #Ok: { amountOut: Nat; txId: ?Nat };
        #Err: Text;
    };

    // ============================================
    // TRADE / ACTION CONFIG (unified flat record)
    // ============================================

    // Action type IDs (stored as Nat, not enum)
    public module ActionType {
        public let Trade: Nat = 0;
        public let Deposit: Nat = 1;
        public let Withdraw: Nat = 2;
        public let Send: Nat = 3;
    };

    /// Unified action configuration — all action types share one record.
    /// Fields that don't apply to a given actionType are null/ignored.
    /// This avoids enum variants in stable storage.
    public type ActionConfig = {
        id: Nat;
        actionType: Nat;                    // 0=Trade, 1=Deposit, 2=Withdraw, 3=Send
        enabled: Bool;

        // Token(s): Trade uses both, others use inputToken only
        inputToken: Principal;
        outputToken: ?Principal;            // Trade only

        // Amount range
        minAmount: Nat;                     // Trade: minTradeSize, others: min transfer amount
        maxAmount: Nat;                     // Trade: maxTradeSize, others: max transfer amount

        // DEX preference (Trade only)
        preferredDex: ?Nat;                 // null = best across all enabled DEXes

        // Subaccount references
        sourceSubaccount: ?Nat;             // Withdraw: source, Send: source (null=main)
        targetSubaccount: ?Nat;             // Deposit: target

        // Destination (Send only)
        destinationOwner: ?Principal;
        destinationSubaccount: ?Blob;

        // Balance conditions
        minBalance: ?Nat;
        maxBalance: ?Nat;
        balanceDenominationToken: ?Principal;

        // Price conditions (Trade only)
        minPrice: ?Nat;
        maxPrice: ?Nat;
        priceDenominationToken: ?Principal;

        // Risk parameters (Trade only)
        maxPriceImpactBps: ?Nat;
        maxSlippageBps: ?Nat;

        // Frequency control (seconds)
        minFrequencySeconds: ?Nat;
        maxFrequencySeconds: ?Nat;

        // Trade size denomination (Trade only)
        tradeSizeDenominationToken: ?Principal;

        // Runtime state
        lastExecutedAt: ?Int;
    };

    /// Input type for creating/updating actions (no id or lastExecutedAt)
    public type ActionConfigInput = {
        actionType: Nat;
        enabled: Bool;
        inputToken: Principal;
        outputToken: ?Principal;
        minAmount: Nat;
        maxAmount: Nat;
        preferredDex: ?Nat;
        sourceSubaccount: ?Nat;
        targetSubaccount: ?Nat;
        destinationOwner: ?Principal;
        destinationSubaccount: ?Blob;
        minBalance: ?Nat;
        maxBalance: ?Nat;
        balanceDenominationToken: ?Principal;
        minPrice: ?Nat;
        maxPrice: ?Nat;
        priceDenominationToken: ?Principal;
        maxPriceImpactBps: ?Nat;
        maxSlippageBps: ?Nat;
        minFrequencySeconds: ?Nat;
        maxFrequencySeconds: ?Nat;
        tradeSizeDenominationToken: ?Principal;
    };

    // ============================================
    // REBALANCER TYPES
    // ============================================

    public type RebalanceTarget = {
        token: Principal;
        targetBps: Nat;           // Basis points (10000 = 100%)
    };

    public type RebalanceSettings = {
        denominationToken: Principal;
        maxTradeSize: Nat;
        minTradeSize: Nat;
        maxPriceImpactBps: Nat;
        maxSlippageBps: Nat;
        thresholdBps: Nat;        // Min deviation to trigger a trade
    };

    public type PortfolioTokenStatus = {
        token: Principal;
        symbol: Text;
        balance: Nat;
        valueInDenomination: Nat;
        currentBps: Nat;
        targetBps: Nat;
        deviationBps: Int;     // positive = overweight, negative = underweight
    };

    public type PortfolioStatus = {
        denominationToken: Principal;
        totalValueInDenomination: Nat;
        tokens: [PortfolioTokenStatus];
    };

    // ============================================
    // PERMISSION TYPES
    // ============================================

    /// Permission variant type for the Trading Bot.
    /// Includes shared base permissions (IDs 0-99) and trading bot permissions (IDs 200-299).
    public type TradingPermissionType = {
        // --- Shared base permissions (see BotkeyTypes.BasePermission for IDs) ---
        #FullPermissions;           // 0: Grants all permissions
        #ManagePermissions;         // 1: Add/remove botkey principals
        #ViewChores;                // 2: View chore statuses
        #ViewLogs;                  // 3: Read log entries
        #ManageLogs;                // 4: Set log level, clear logs
        // --- Trading Bot permissions (IDs 200+) ---
        #ViewPortfolio;             // 200: View balances, subaccounts, portfolio state
        #ManageSubaccounts;         // 201: Create/rename/delete named subaccounts
        #ManageTrades;              // 202: Configure trade chore actions
        #ManageRebalancer;          // 203: Configure rebalancer targets and parameters
        #ManageTradeChore;          // 204: Start/stop/pause/resume/trigger trade chores
        #ManageRebalanceChore;      // 205: Start/stop/pause/resume/trigger rebalance chore
        #ManageMoveFundsChore;      // 206: Start/stop/pause/resume/trigger move funds chores
        #ManageTokenRegistry;       // 207: Add/remove supported tokens
        #ManageDexSettings;         // 208: Configure DEX parameters
        #WithdrawFunds;             // 209: Send tokens from bot to external accounts
        #ConfigureDistribution;     // 210: Add/update/remove distribution lists
        #ManageDistributeFunds;     // 211: Start/stop/pause/resume/trigger distribute-funds chore
    };

    /// Numeric IDs for permission types (for stable storage).
    /// Shared base permissions use IDs 0–99 (see BotkeyTypes.BasePermission).
    /// Trading Bot permissions use the reserved range 200–299.
    public module TradingPermission {
        // Shared base permissions
        public let FullPermissions: Nat = BotkeyTypes.BasePermission.FullPermissions;     // 0
        public let ManagePermissions: Nat = BotkeyTypes.BasePermission.ManagePermissions;  // 1
        public let ViewChores: Nat = BotkeyTypes.BasePermission.ViewChores;               // 2
        public let ViewLogs: Nat = BotkeyTypes.BasePermission.ViewLogs;                   // 3
        public let ManageLogs: Nat = BotkeyTypes.BasePermission.ManageLogs;               // 4
        // Trading Bot permissions (range 200–299)
        public let ViewPortfolio: Nat = 200;
        public let ManageSubaccounts: Nat = 201;
        public let ManageTrades: Nat = 202;
        public let ManageRebalancer: Nat = 203;
        public let ManageTradeChore: Nat = 204;
        public let ManageRebalanceChore: Nat = 205;
        public let ManageMoveFundsChore: Nat = 206;
        public let ManageTokenRegistry: Nat = 207;
        public let ManageDexSettings: Nat = 208;
        public let WithdrawFunds: Nat = 209;
        public let ConfigureDistribution: Nat = 210;
        public let ManageDistributeFunds: Nat = 211;
    };

    /// Info about a botkey principal and their permissions (for API responses).
    public type HotkeyPermissionInfo = BotkeyTypes.BotkeyPermissionInfo<TradingPermissionType>;

    // ============================================
    // IC MANAGEMENT CANISTER TYPES
    // ============================================

    public type CanisterSettings = {
        controllers: ?[Principal];
        compute_allocation: ?Nat;
        memory_allocation: ?Nat;
        freezing_threshold: ?Nat;
    };

    public type DefiniteCanisterSettings = {
        controllers: [Principal];
        compute_allocation: Nat;
        memory_allocation: Nat;
        freezing_threshold: Nat;
    };

    public type CanisterStatusArgs = {
        canister_id: Principal;
    };

    public type CanisterStatusResult = {
        status: { #running; #stopping; #stopped };
        settings: DefiniteCanisterSettings;
        module_hash: ?Blob;
        memory_size: Nat;
        cycles: Nat;
        idle_cycles_burned_per_day: Nat;
    };

    public type ManagementCanister = actor {
        canister_status: shared (CanisterStatusArgs) -> async CanisterStatusResult;
    };

};
