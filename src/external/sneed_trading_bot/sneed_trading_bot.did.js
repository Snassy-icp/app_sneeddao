// Auto-generated Candid IDL for the Sneed Trading Bot.
// Hand-crafted from the Motoko source types.
export const idlFactory = ({ IDL }) => {

    // ==========================================
    // Shared / Primitive types
    // ==========================================
    const Account = IDL.Record({
        owner: IDL.Principal,
        subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
    });

    const Version = IDL.Record({
        major: IDL.Nat,
        minor: IDL.Nat,
        patch: IDL.Nat,
    });

    // ==========================================
    // Permission types
    // ==========================================
    const TradingPermissionType = IDL.Variant({
        FullPermissions: IDL.Null,
        ManagePermissions: IDL.Null,
        ViewChores: IDL.Null,
        ViewLogs: IDL.Null,
        ManageLogs: IDL.Null,
        ViewPortfolio: IDL.Null,
        ManageSubaccounts: IDL.Null,
        ManageTrades: IDL.Null,
        ManageRebalancer: IDL.Null,
        ManageTradeChore: IDL.Null,
        ManageRebalanceChore: IDL.Null,
        ManageMoveFundsChore: IDL.Null,
        ManageTokenRegistry: IDL.Null,
        ManageDexSettings: IDL.Null,
        WithdrawFunds: IDL.Null,
        ConfigureDistribution: IDL.Null,
        ManageDistributeFunds: IDL.Null,
    });

    const HotkeyPermissionInfo = IDL.Record({
        principal: IDL.Principal,
        permissions: IDL.Vec(TradingPermissionType),
    });

    // ==========================================
    // Token Registry
    // ==========================================
    const TokenRegistryEntry = IDL.Record({
        ledgerCanisterId: IDL.Principal,
        symbol: IDL.Text,
        decimals: IDL.Nat8,
        fee: IDL.Nat,
    });

    // ==========================================
    // Subaccounts
    // ==========================================
    const SubaccountInfo = IDL.Record({
        number: IDL.Nat,
        name: IDL.Text,
        subaccount: IDL.Vec(IDL.Nat8),
    });

    const TokenBalance = IDL.Record({
        token: IDL.Principal,
        balance: IDL.Nat,
    });

    const SubaccountBalances = IDL.Record({
        subaccountNumber: IDL.Nat,
        name: IDL.Text,
        balances: IDL.Vec(TokenBalance),
    });

    // ==========================================
    // DEX types
    // ==========================================
    const SwapQuote = IDL.Record({
        dexId: IDL.Nat,
        inputToken: IDL.Principal,
        outputToken: IDL.Principal,
        inputAmount: IDL.Nat,
        effectiveInputAmount: IDL.Nat,
        expectedOutput: IDL.Nat,
        spotPriceE8s: IDL.Nat,
        priceImpactBps: IDL.Nat,
        dexFeeBps: IDL.Nat,
        inputFeesTotal: IDL.Nat,
        outputFeesTotal: IDL.Nat,
        poolCanisterId: IDL.Opt(IDL.Principal),
        timestamp: IDL.Int,
    });

    // ==========================================
    // Action Config (Trade / Move Funds)
    // ==========================================
    const ActionConfig = IDL.Record({
        id: IDL.Nat,
        actionType: IDL.Nat,
        enabled: IDL.Bool,
        inputToken: IDL.Principal,
        outputToken: IDL.Opt(IDL.Principal),
        minAmount: IDL.Nat,
        maxAmount: IDL.Nat,
        amountMode: IDL.Nat,
        balancePercent: IDL.Opt(IDL.Nat),
        preferredDex: IDL.Opt(IDL.Nat),
        sourceSubaccount: IDL.Opt(IDL.Nat),
        targetSubaccount: IDL.Opt(IDL.Nat),
        destinationOwner: IDL.Opt(IDL.Principal),
        destinationSubaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
        minBalance: IDL.Opt(IDL.Nat),
        maxBalance: IDL.Opt(IDL.Nat),
        balanceDenominationToken: IDL.Opt(IDL.Principal),
        minPrice: IDL.Opt(IDL.Nat),
        maxPrice: IDL.Opt(IDL.Nat),
        priceDenominationToken: IDL.Opt(IDL.Principal),
        maxPriceImpactBps: IDL.Opt(IDL.Nat),
        maxSlippageBps: IDL.Opt(IDL.Nat),
        minFrequencySeconds: IDL.Opt(IDL.Nat),
        maxFrequencySeconds: IDL.Opt(IDL.Nat),
        tradeSizeDenominationToken: IDL.Opt(IDL.Principal),
        lastExecutedAt: IDL.Opt(IDL.Int),
    });

    const ActionConfigInput = IDL.Record({
        actionType: IDL.Nat,
        enabled: IDL.Bool,
        inputToken: IDL.Principal,
        outputToken: IDL.Opt(IDL.Principal),
        minAmount: IDL.Nat,
        maxAmount: IDL.Nat,
        amountMode: IDL.Nat,
        balancePercent: IDL.Opt(IDL.Nat),
        preferredDex: IDL.Opt(IDL.Nat),
        sourceSubaccount: IDL.Opt(IDL.Nat),
        targetSubaccount: IDL.Opt(IDL.Nat),
        destinationOwner: IDL.Opt(IDL.Principal),
        destinationSubaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
        minBalance: IDL.Opt(IDL.Nat),
        maxBalance: IDL.Opt(IDL.Nat),
        balanceDenominationToken: IDL.Opt(IDL.Principal),
        minPrice: IDL.Opt(IDL.Nat),
        maxPrice: IDL.Opt(IDL.Nat),
        priceDenominationToken: IDL.Opt(IDL.Principal),
        maxPriceImpactBps: IDL.Opt(IDL.Nat),
        maxSlippageBps: IDL.Opt(IDL.Nat),
        minFrequencySeconds: IDL.Opt(IDL.Nat),
        maxFrequencySeconds: IDL.Opt(IDL.Nat),
        tradeSizeDenominationToken: IDL.Opt(IDL.Principal),
    });

    // ==========================================
    // Rebalancer
    // ==========================================
    const RebalanceTarget = IDL.Record({
        token: IDL.Principal,
        targetBps: IDL.Nat,
        paused: IDL.Bool,
    });

    const RebalanceSettings = IDL.Record({
        denominationToken: IDL.Principal,
        maxTradeSize: IDL.Nat,
        minTradeSize: IDL.Nat,
        maxPriceImpactBps: IDL.Nat,
        maxSlippageBps: IDL.Nat,
        thresholdBps: IDL.Nat,
        fallbackRouteTokens: IDL.Vec(IDL.Principal),
    });

    const PortfolioTokenStatus = IDL.Record({
        token: IDL.Principal,
        symbol: IDL.Text,
        balance: IDL.Nat,
        valueInDenomination: IDL.Nat,
        currentBps: IDL.Nat,
        targetBps: IDL.Nat,
        deviationBps: IDL.Int,
    });

    const PortfolioStatus = IDL.Record({
        denominationToken: IDL.Principal,
        totalValueInDenomination: IDL.Nat,
        tokens: IDL.Vec(PortfolioTokenStatus),
    });

    // ==========================================
    // Distribution
    // ==========================================
    const DistributionTarget = IDL.Record({
        account: Account,
        basisPoints: IDL.Opt(IDL.Nat),
    });

    const DistributionList = IDL.Record({
        id: IDL.Nat,
        name: IDL.Text,
        sourceSubaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
        tokenLedgerCanisterId: IDL.Principal,
        thresholdAmount: IDL.Nat,
        maxDistributionAmount: IDL.Nat,
        targets: IDL.Vec(DistributionTarget),
    });

    const DistributionListInput = IDL.Record({
        name: IDL.Text,
        sourceSubaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
        tokenLedgerCanisterId: IDL.Principal,
        thresholdAmount: IDL.Nat,
        maxDistributionAmount: IDL.Nat,
        targets: IDL.Vec(DistributionTarget),
    });

    // ==========================================
    // Bot Log types
    // ==========================================
    const LogLevel = IDL.Variant({
        Off: IDL.Null,
        Error: IDL.Null,
        Warning: IDL.Null,
        Info: IDL.Null,
        Debug: IDL.Null,
        Trace: IDL.Null,
    });

    const LogEntry = IDL.Record({
        id: IDL.Nat,
        timestamp: IDL.Int,
        level: LogLevel,
        source: IDL.Text,
        message: IDL.Text,
        caller: IDL.Opt(IDL.Principal),
        tags: IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text)),
    });

    const LogFilter = IDL.Record({
        minLevel: IDL.Opt(LogLevel),
        source: IDL.Opt(IDL.Text),
        caller: IDL.Opt(IDL.Principal),
        fromTime: IDL.Opt(IDL.Int),
        toTime: IDL.Opt(IDL.Int),
        startId: IDL.Opt(IDL.Nat),
        limit: IDL.Opt(IDL.Nat),
    });

    const LogResult = IDL.Record({
        entries: IDL.Vec(LogEntry),
        totalMatching: IDL.Nat,
        hasMore: IDL.Bool,
    });

    const LogConfig = IDL.Record({
        logLevel: LogLevel,
        maxEntries: IDL.Nat,
        entryCount: IDL.Nat,
        nextId: IDL.Nat,
    });

    // ==========================================
    // Bot Chore types
    // ==========================================
    const SchedulerStatus = IDL.Variant({
        Idle: IDL.Null,
        Scheduled: IDL.Null,
    });

    const ConductorStatus = IDL.Variant({
        Idle: IDL.Null,
        Running: IDL.Null,
        Polling: IDL.Null,
    });

    const TaskStatus = IDL.Variant({
        Idle: IDL.Null,
        Running: IDL.Null,
    });

    const ChoreStatus = IDL.Record({
        choreId: IDL.Text,
        choreTypeId: IDL.Text,
        choreName: IDL.Text,
        choreDescription: IDL.Text,
        instanceLabel: IDL.Text,
        enabled: IDL.Bool,
        paused: IDL.Bool,
        intervalSeconds: IDL.Nat,
        maxIntervalSeconds: IDL.Opt(IDL.Nat),
        taskTimeoutSeconds: IDL.Nat,
        schedulerStatus: SchedulerStatus,
        nextScheduledRunAt: IDL.Opt(IDL.Int),
        lastCompletedRunAt: IDL.Opt(IDL.Int),
        conductorStatus: ConductorStatus,
        conductorStartedAt: IDL.Opt(IDL.Int),
        conductorInvocationCount: IDL.Nat,
        currentTaskId: IDL.Opt(IDL.Text),
        taskStatus: TaskStatus,
        taskStartedAt: IDL.Opt(IDL.Int),
        lastCompletedTaskId: IDL.Opt(IDL.Text),
        lastTaskSucceeded: IDL.Opt(IDL.Bool),
        lastTaskError: IDL.Opt(IDL.Text),
        stopRequested: IDL.Bool,
        totalRunCount: IDL.Nat,
        totalSuccessCount: IDL.Nat,
        totalFailureCount: IDL.Nat,
        lastError: IDL.Opt(IDL.Text),
        lastErrorAt: IDL.Opt(IDL.Int),
    });

    const ChoreInstanceInfo = IDL.Record({
        typeId: IDL.Text,
        instanceLabel: IDL.Text,
    });

    const ChoreTypeInfo = IDL.Record({
        id: IDL.Text,
        name: IDL.Text,
        description: IDL.Text,
        defaultIntervalSeconds: IDL.Nat,
        defaultMaxIntervalSeconds: IDL.Opt(IDL.Nat),
        instanceCount: IDL.Nat,
    });

    const ChoreConfig = IDL.Record({
        intervalSeconds: IDL.Nat,
        maxIntervalSeconds: IDL.Opt(IDL.Nat),
        taskTimeoutSeconds: IDL.Nat,
    });

    // ==========================================
    // Operation Result (aligned with staking bot)
    // ==========================================
    const OperationError = IDL.Variant({
        NotAuthorized: IDL.Null,
        InvalidOperation: IDL.Text,
        TransferFailed: IDL.Text,
    });

    const OperationResult = IDL.Variant({
        Ok: IDL.Null,
        Err: OperationError,
    });

    // ==========================================
    // Trade Log types
    // ==========================================
    const TradeStatus = IDL.Variant({
        Success: IDL.Null,
        Failed: IDL.Null,
        Skipped: IDL.Null,
    });

    const TradeLogEntry = IDL.Record({
        id: IDL.Nat,
        timestamp: IDL.Int,
        choreId: IDL.Opt(IDL.Text),
        choreTypeId: IDL.Opt(IDL.Text),
        actionId: IDL.Opt(IDL.Nat),
        actionType: IDL.Nat,
        inputToken: IDL.Principal,
        outputToken: IDL.Opt(IDL.Principal),
        inputAmount: IDL.Nat,
        outputAmount: IDL.Opt(IDL.Nat),
        priceE8s: IDL.Opt(IDL.Nat),
        priceImpactBps: IDL.Opt(IDL.Nat),
        slippageBps: IDL.Opt(IDL.Nat),
        dexId: IDL.Opt(IDL.Nat),
        status: TradeStatus,
        errorMessage: IDL.Opt(IDL.Text),
        txId: IDL.Opt(IDL.Nat),
        destinationOwner: IDL.Opt(IDL.Principal),
    });

    const TradeLogQuery = IDL.Record({
        startId: IDL.Opt(IDL.Nat),
        limit: IDL.Opt(IDL.Nat),
        choreId: IDL.Opt(IDL.Text),
        choreTypeId: IDL.Opt(IDL.Text),
        actionType: IDL.Opt(IDL.Nat),
        inputToken: IDL.Opt(IDL.Principal),
        outputToken: IDL.Opt(IDL.Principal),
        status: IDL.Opt(TradeStatus),
        fromTime: IDL.Opt(IDL.Int),
        toTime: IDL.Opt(IDL.Int),
    });

    const TradeLogResult = IDL.Record({
        entries: IDL.Vec(TradeLogEntry),
        totalCount: IDL.Nat,
        hasMore: IDL.Bool,
    });

    // ==========================================
    // Portfolio Snapshot types
    // ==========================================
    const SnapshotPhase = IDL.Variant({
        Before: IDL.Null,
        After: IDL.Null,
    });

    const TokenSnapshot = IDL.Record({
        token: IDL.Principal,
        symbol: IDL.Text,
        decimals: IDL.Nat8,
        balance: IDL.Nat,
        priceIcpE8s: IDL.Opt(IDL.Nat),
        priceUsdE8s: IDL.Opt(IDL.Nat),
        priceDenomE8s: IDL.Opt(IDL.Nat),
        valueIcpE8s: IDL.Opt(IDL.Nat),
        valueUsdE8s: IDL.Opt(IDL.Nat),
        valueDenomE8s: IDL.Opt(IDL.Nat),
    });

    const PortfolioSnapshot = IDL.Record({
        id: IDL.Nat,
        timestamp: IDL.Int,
        trigger: IDL.Text,
        tradeLogId: IDL.Opt(IDL.Nat),
        phase: SnapshotPhase,
        choreId: IDL.Opt(IDL.Text),
        denominationToken: IDL.Opt(IDL.Principal),
        totalValueIcpE8s: IDL.Opt(IDL.Nat),
        totalValueUsdE8s: IDL.Opt(IDL.Nat),
        totalValueDenomE8s: IDL.Opt(IDL.Nat),
        tokens: IDL.Vec(TokenSnapshot),
    });

    const PortfolioSnapshotQuery = IDL.Record({
        startId: IDL.Opt(IDL.Nat),
        limit: IDL.Opt(IDL.Nat),
        tradeLogId: IDL.Opt(IDL.Nat),
        phase: IDL.Opt(SnapshotPhase),
        fromTime: IDL.Opt(IDL.Int),
        toTime: IDL.Opt(IDL.Int),
    });

    const PortfolioSnapshotResult = IDL.Record({
        entries: IDL.Vec(PortfolioSnapshot),
        totalCount: IDL.Nat,
        hasMore: IDL.Bool,
    });

    // ==========================================
    // Logging Settings types
    // ==========================================
    const LoggingSettings = IDL.Record({
        tradeLogEnabled: IDL.Bool,
        portfolioLogEnabled: IDL.Bool,
        maxTradeLogEntries: IDL.Nat,
        maxPortfolioLogEntries: IDL.Nat,
    });

    const ChoreLoggingOverrides = IDL.Record({
        tradeLogEnabled: IDL.Opt(IDL.Bool),
        portfolioLogEnabled: IDL.Opt(IDL.Bool),
    });

    // ==========================================
    // Service definition
    // ==========================================
    return IDL.Service({
        // Canister Info
        getVersion: IDL.Func([], [Version], ['query']),
        getCanisterPrincipal: IDL.Func([], [IDL.Principal], ['query']),

        // Permissions (aligned with staking bot API)
        addHotkeyPermissions: IDL.Func([IDL.Principal, IDL.Vec(TradingPermissionType)], [OperationResult], []),
        removeHotkeyPermissions: IDL.Func([IDL.Principal, IDL.Vec(TradingPermissionType)], [OperationResult], []),
        removeHotkeyPrincipal: IDL.Func([IDL.Principal], [OperationResult], []),
        getHotkeyPermissions: IDL.Func([IDL.Principal], [IDL.Vec(TradingPermissionType)], ['query']),
        listHotkeyPrincipals: IDL.Func([], [IDL.Vec(HotkeyPermissionInfo)], ['query']),
        listPermissionTypes: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Nat, TradingPermissionType))], ['query']),
        callerPermissions: IDL.Func([], [IDL.Vec(TradingPermissionType)], ['query']),
        checkPermission: IDL.Func([TradingPermissionType], [IDL.Bool], ['query']),
        getBotkeySnapshot: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Vec(IDL.Nat)))], []),
        restoreBotkeySnapshot: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Vec(IDL.Nat)))], [], []),

        // Token Registry
        getTokenRegistry: IDL.Func([], [IDL.Vec(TokenRegistryEntry)], ['query']),
        addToken: IDL.Func([TokenRegistryEntry], [], []),
        removeToken: IDL.Func([IDL.Principal], [], []),
        reorderTokenRegistry: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
        refreshTokenMetadata: IDL.Func([IDL.Principal], [], []),

        // Subaccounts
        getSubaccounts: IDL.Func([], [IDL.Vec(SubaccountInfo)], ['query']),
        createSubaccount: IDL.Func([IDL.Text], [SubaccountInfo], []),
        renameSubaccount: IDL.Func([IDL.Nat, IDL.Text], [IDL.Bool], []),
        deleteSubaccount: IDL.Func([IDL.Nat], [IDL.Bool], []),

        // Balances (REMOVED: getBalances, getAllBalances — use frontend ledger calls)

        // DEX (REMOVED: getQuote — use frontend PriceService)
        getEnabledDexes: IDL.Func([], [IDL.Vec(IDL.Nat)], ['query']),
        getSupportedDexes: IDL.Func([], [IDL.Vec(IDL.Record({
            id: IDL.Nat,
            name: IDL.Text,
            description: IDL.Text,
            enabled: IDL.Bool,
        }))], ['query']),
        setDexEnabled: IDL.Func([IDL.Nat, IDL.Bool], [], []),
        setEnabledDexes: IDL.Func([IDL.Vec(IDL.Nat)], [], []),
        setDefaultSlippage: IDL.Func([IDL.Nat], [], []),
        setDefaultMaxPriceImpact: IDL.Func([IDL.Nat], [], []),

        // Trade Actions
        getTradeActions: IDL.Func([IDL.Text], [IDL.Vec(ActionConfig)], ['query']),
        addTradeAction: IDL.Func([IDL.Text, ActionConfigInput], [IDL.Nat], []),
        updateTradeAction: IDL.Func([IDL.Text, IDL.Nat, ActionConfigInput], [IDL.Bool], []),
        removeTradeAction: IDL.Func([IDL.Text, IDL.Nat], [IDL.Bool], []),
        reorderTradeActions: IDL.Func([IDL.Text, IDL.Vec(IDL.Nat)], [IDL.Bool], []),

        // Move Funds Actions
        getMoveFundsActions: IDL.Func([IDL.Text], [IDL.Vec(ActionConfig)], ['query']),
        addMoveFundsAction: IDL.Func([IDL.Text, ActionConfigInput], [IDL.Nat], []),
        updateMoveFundsAction: IDL.Func([IDL.Text, IDL.Nat, ActionConfigInput], [IDL.Bool], []),
        removeMoveFundsAction: IDL.Func([IDL.Text, IDL.Nat], [IDL.Bool], []),

        // Rebalancer
        getRebalanceTargets: IDL.Func([IDL.Text], [IDL.Vec(RebalanceTarget)], ['query']),
        setRebalanceTargets: IDL.Func([IDL.Text, IDL.Vec(RebalanceTarget)], [], []),
        getRebalanceSettings: IDL.Func([IDL.Text], [RebalanceSettings], ['query']),
        setRebalanceDenominationToken: IDL.Func([IDL.Text, IDL.Principal], [], []),
        setRebalanceMaxTradeSize: IDL.Func([IDL.Text, IDL.Nat], [], []),
        setRebalanceMinTradeSize: IDL.Func([IDL.Text, IDL.Nat], [], []),
        setRebalanceMaxPriceImpactBps: IDL.Func([IDL.Text, IDL.Nat], [], []),
        setRebalanceMaxSlippageBps: IDL.Func([IDL.Text, IDL.Nat], [], []),
        setRebalanceThresholdBps: IDL.Func([IDL.Text, IDL.Nat], [], []),
        setRebalanceFallbackRouteTokens: IDL.Func([IDL.Text, IDL.Vec(IDL.Principal)], [], []),
        // REMOVED: getPortfolioStatus — portfolio status is now computed on frontend

        // Distribution
        getDistributionLists: IDL.Func([IDL.Text], [IDL.Vec(DistributionList)], ['query']),
        addDistributionList: IDL.Func([IDL.Text, DistributionListInput], [IDL.Nat], []),
        updateDistributionList: IDL.Func([IDL.Text, IDL.Nat, DistributionListInput], [], []),
        removeDistributionList: IDL.Func([IDL.Text, IDL.Nat], [], []),

        // Chore Management
        getChoreStatuses: IDL.Func([], [IDL.Vec(ChoreStatus)], ['query']),
        getChoreStatus: IDL.Func([IDL.Text], [IDL.Opt(ChoreStatus)], ['query']),
        getChoreTypes: IDL.Func([], [IDL.Vec(ChoreTypeInfo)], ['query']),
        getChoreConfigs: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Text, ChoreConfig))], ['query']),
        createChoreInstance: IDL.Func([IDL.Text, IDL.Text, IDL.Text], [IDL.Bool], []),
        deleteChoreInstance: IDL.Func([IDL.Text], [IDL.Bool], []),
        renameChoreInstance: IDL.Func([IDL.Text, IDL.Text], [IDL.Bool], []),
        listChoreInstances: IDL.Func([IDL.Opt(IDL.Text)], [IDL.Vec(IDL.Tuple(IDL.Text, ChoreInstanceInfo))], ['query']),
        startChore: IDL.Func([IDL.Text], [], []),
        scheduleStartChore: IDL.Func([IDL.Text, IDL.Int], [], []),
        pauseChore: IDL.Func([IDL.Text], [], []),
        resumeChore: IDL.Func([IDL.Text], [], []),
        stopChore: IDL.Func([IDL.Text], [], []),
        stopAllChores: IDL.Func([], [], []),
        triggerChore: IDL.Func([IDL.Text], [], []),
        setChoreInterval: IDL.Func([IDL.Text, IDL.Nat], [], []),
        setChoreMaxInterval: IDL.Func([IDL.Text, IDL.Opt(IDL.Nat)], [], []),
        setChoreTaskTimeout: IDL.Func([IDL.Text, IDL.Nat], [], []),
        setChoreNextRun: IDL.Func([IDL.Text, IDL.Int], [], []),

        // Bot Log (general)
        getLogs: IDL.Func([LogFilter], [LogResult], ['query']),
        getLogConfig: IDL.Func([], [LogConfig], ['query']),
        setLogLevel: IDL.Func([LogLevel], [], []),
        clearLogs: IDL.Func([], [], []),

        // Trade Log
        getTradeLog: IDL.Func([TradeLogQuery], [TradeLogResult], ['query']),
        getTradeLogStats: IDL.Func([], [IDL.Record({ totalEntries: IDL.Nat, nextId: IDL.Nat })], ['query']),
        clearTradeLog: IDL.Func([], [], []),

        // Portfolio Snapshot Log
        getPortfolioSnapshots: IDL.Func([PortfolioSnapshotQuery], [PortfolioSnapshotResult], ['query']),
        getPortfolioSnapshotStats: IDL.Func([], [IDL.Record({ totalEntries: IDL.Nat, nextId: IDL.Nat })], ['query']),
        clearPortfolioSnapshots: IDL.Func([], [], []),

        // Logging Settings
        getLoggingSettings: IDL.Func([], [LoggingSettings], ['query']),
        setLoggingSettings: IDL.Func([LoggingSettings], [], []),
        getChoreLoggingOverrides: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Text, ChoreLoggingOverrides))], ['query']),
        setChoreLoggingOverride: IDL.Func([IDL.Text, ChoreLoggingOverrides], [], []),
        removeChoreLoggingOverride: IDL.Func([IDL.Text], [], []),

        // Metadata Staleness
        getMetadataStaleness: IDL.Func([], [IDL.Nat], ['query']),
        setMetadataStaleness: IDL.Func([IDL.Nat], [], []),
    });
};

export const init = ({ IDL }) => {
    return [];
};
