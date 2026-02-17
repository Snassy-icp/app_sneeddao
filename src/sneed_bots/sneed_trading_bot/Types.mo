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

    // Info about a supported DEX — returned by public API
    public type DexInfo = {
        id: Nat;
        name: Text;
        description: Text;
        enabled: Bool;
    };

    // Master list of all DEXes the bot knows about (order = display order)
    public let SUPPORTED_DEXES: [(Nat, Text, Text)] = [
        (DexId.ICPSwap, "ICPSwap", "ICPSwap V3 — concentrated liquidity AMM"),
        (DexId.KongSwap, "KongSwap",  "KongSwap — hybrid orderbook/AMM"),
    ];

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
        quote: shared (ICPSwapQuoteArgs) -> async { #ok: Int; #err: { message: Text } };
        depositAndSwap: shared (ICPSwapSwapArgs) -> async { #ok: Int; #err: { message: Text } };
        depositFromAndSwap: shared (ICPSwapSwapArgs) -> async { #ok: Int; #err: { message: Text } };
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
        tx_id: Nat64;          // KongSwap uses nat64
        pay_amount: Nat;
        receive_amount: Nat;
        // claim_ids omitted: KongSwap uses vec nat64 and we don't need it
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
        public let DetectedInflow: Nat = 4;
        public let DetectedOutflow: Nat = 5;
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

        // Amount mode: 0 = random in [min,max] range (default), 1 = percentage of balance
        amountMode: Nat;
        // When amountMode=1: percentage in basis points (0-10000 = 0-100%), capped by min/max
        balancePercent: ?Nat;

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
        amountMode: Nat;
        balancePercent: ?Nat;
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
        paused: Bool;             // If true, token is excluded from rebalancing
    };

    public type RebalanceSettings = {
        denominationToken: Principal;
        maxTradeSize: Nat;
        minTradeSize: Nat;
        maxPriceImpactBps: Nat;
        maxSlippageBps: Nat;
        thresholdBps: Nat;        // Min deviation to trigger a trade
        fallbackRouteTokens: [Principal]; // Ordered list of intermediary tokens for fallback routing
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
    // OPERATION RESULT TYPES (aligned with staking bot API)
    // ============================================

    /// Generic operation result — matches staking bot's OperationResult shape
    /// so the frontend can handle both bots identically.
    public type OperationResult = {
        #Ok;
        #Err: OperationError;
    };

    public type OperationError = {
        #NotAuthorized;
        #InvalidOperation: Text;
        #TransferFailed: Text;
    };

    // ============================================
    // CACHES (transient, for chore pipeline phases)
    // ============================================

    /// Cached token metadata with fetch timestamp.
    /// Used by the metadata-refresh preparatory task so that subsequent
    /// tasks can rely on fresh data without re-fetching.
    public type CachedTokenMeta = {
        entry: TokenRegistryEntry;
        fetchedAt: Int;             // Time.now() when fetched
    };

    /// Cached swap quote/price with fetch timestamp.
    /// Populated by the price-fetch preparatory task, consumed by
    /// trade execution and rebalancer valuation within the same run.
    public type CachedPrice = {
        inputToken: Principal;
        outputToken: Principal;
        quote: SwapQuote;
        fetchedAt: Int;
    };

    /// Query parameters for paginated price history retrieval.
    public type PriceHistoryQuery = {
        pairKey: ?Text;
        limit: ?Nat;
        offset: ?Nat;
    };

    /// Result of a price history query.
    public type PriceHistoryResult = {
        entries: [CachedPrice];
        totalCount: Nat;
    };

    // ============================================
    // TRADE LOG
    // ============================================

    /// Status of a trade/action execution attempt.
    public type TradeStatus = {
        #Success;
        #Failed;
        #Skipped;       // Conditions not met (balance, price, etc.)
    };

    /// A single trade log entry — records every attempted trade, deposit,
    /// withdraw, or send by the bot, whether from a trade chore, rebalancer,
    /// or move-funds chore.
    public type TradeLogEntry = {
        id: Nat;
        timestamp: Int;

        // Source identification
        choreId: ?Text;            // Instance ID of the chore that triggered this (null if manual)
        choreTypeId: ?Text;        // "trade", "rebalance", "move-funds", "distribute-funds"
        actionId: ?Nat;            // Action ID within the chore (null for rebalancer trades)

        // Action details
        actionType: Nat;           // 0=Trade, 1=Deposit, 2=Withdraw, 3=Send, 4=DetectedInflow, 5=DetectedOutflow
        inputToken: Principal;
        outputToken: ?Principal;
        inputAmount: Nat;
        outputAmount: ?Nat;        // Actual output received (null if failed/skipped)

        // Pricing (Trade only)
        priceE8s: ?Nat;            // Execution price (output per 1 input * 1e8)
        priceImpactBps: ?Nat;
        slippageBps: ?Nat;
        dexId: ?Nat;               // 0=ICPSwap, 1=KongSwap

        // Result
        status: TradeStatus;
        errorMessage: ?Text;
        txId: ?Nat;                // Transfer/swap block index or tx ID

        // Destination (Send/Withdraw)
        destinationOwner: ?Principal;
    };

    /// Query filter for the trade log.
    public type TradeLogQuery = {
        startId: ?Nat;             // Pagination: start from this ID (inclusive)
        limit: ?Nat;               // Max entries (default 50)
        choreId: ?Text;            // Filter by chore instance
        choreTypeId: ?Text;        // Filter by chore type
        actionType: ?Nat;          // Filter by action type
        inputToken: ?Principal;    // Filter by input token
        outputToken: ?Principal;   // Filter by output token
        status: ?TradeStatus;      // Filter by status
        fromTime: ?Int;            // Include entries after this timestamp
        toTime: ?Int;              // Include entries before this timestamp
    };

    /// Result of a trade log query.
    public type TradeLogResult = {
        entries: [TradeLogEntry];
        totalCount: Nat;           // Total matching (before pagination)
        hasMore: Bool;
    };

    // ============================================
    // PORTFOLIO SNAPSHOT LOG
    // ============================================

    /// Balance and price snapshot for a single token.
    public type TokenSnapshot = {
        token: Principal;
        symbol: Text;
        decimals: Nat8;
        balance: Nat;              // Raw token units

        // Prices (all scaled to 1e8 per 1 token)
        priceIcpE8s: ?Nat;
        priceUsdE8s: ?Nat;
        priceDenomE8s: ?Nat;       // In user's denomination token

        // Computed values
        valueIcpE8s: ?Nat;
        valueUsdE8s: ?Nat;
        valueDenomE8s: ?Nat;
    };

    /// Snapshot phase — taken before or after a trade.
    public type SnapshotPhase = {
        #Before;
        #After;
    };

    /// A complete portfolio snapshot at a point in time.
    public type PortfolioSnapshot = {
        id: Nat;
        timestamp: Int;
        trigger: Text;             // Human-readable trigger description
        tradeLogId: ?Nat;          // Link to the trade log entry that triggered this
        phase: SnapshotPhase;
        choreId: ?Text;            // Instance ID of the chore that triggered this
        subaccount: ?Blob;         // null = main account, ?blob = named subaccount
        denominationToken: ?Principal;
        totalValueIcpE8s: ?Nat;
        totalValueUsdE8s: ?Nat;
        totalValueDenomE8s: ?Nat;
        tokens: [TokenSnapshot];
    };

    /// Query filter for portfolio snapshots.
    public type PortfolioSnapshotQuery = {
        startId: ?Nat;
        limit: ?Nat;               // Default 20
        tradeLogId: ?Nat;          // Filter by linked trade
        phase: ?SnapshotPhase;
        fromTime: ?Int;
        toTime: ?Int;
    };

    /// Result of a portfolio snapshot query.
    public type PortfolioSnapshotResult = {
        entries: [PortfolioSnapshot];
        totalCount: Nat;
        hasMore: Bool;
    };

    // ============================================
    // DAILY OHLC AGGREGATION
    // ============================================

    /// Daily portfolio value summary per account (main or subaccount).
    public type DailyPortfolioSummary = {
        date: Int;              // UTC day start (midnight) in nanoseconds
        subaccount: ?Blob;      // null = main account
        openValueIcpE8s: Nat;
        highValueIcpE8s: Nat;
        lowValueIcpE8s: Nat;
        closeValueIcpE8s: Nat;
        openValueUsdE8s: Nat;
        highValueUsdE8s: Nat;
        lowValueUsdE8s: Nat;
        closeValueUsdE8s: Nat;
        snapshotCount: Nat;
        closeTokens: [TokenSnapshot];
    };

    /// Daily price candle per token pair.
    public type DailyPriceCandle = {
        pairKey: Text;
        inputToken: Principal;
        outputToken: Principal;
        date: Int;              // UTC day start in nanoseconds
        openE8s: Nat;
        highE8s: Nat;
        lowE8s: Nat;
        closeE8s: Nat;
        quoteCount: Nat;
    };

    /// Query for daily portfolio summaries.
    public type DailyPortfolioSummaryQuery = {
        fromDate: ?Int;
        toDate: ?Int;
        subaccount: ?(?Blob);   // null = all accounts, ?(null) = main only, ?(?blob) = specific subaccount
        limit: ?Nat;
        offset: ?Nat;
    };

    /// Query for daily price candles.
    public type DailyPriceCandleQuery = {
        pairKey: ?Text;
        fromDate: ?Int;
        toDate: ?Int;
        limit: ?Nat;
        offset: ?Nat;
    };

    // ============================================
    // LOGGING SETTINGS
    // ============================================

    /// Master logging settings for the bot.
    /// Controls whether trade log and portfolio snapshot log are active.
    public type LoggingSettings = {
        tradeLogEnabled: Bool;          // Default: true
        portfolioLogEnabled: Bool;      // Default: true
        maxTradeLogEntries: Nat;        // Circular buffer size (default: 10_000)
        maxPortfolioLogEntries: Nat;    // Circular buffer size (default: 5_000)
    };

    /// Per-chore logging overrides.
    /// null values mean "use the master setting".
    public type ChoreLoggingOverrides = {
        tradeLogEnabled: ?Bool;
        portfolioLogEnabled: ?Bool;
    };

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
