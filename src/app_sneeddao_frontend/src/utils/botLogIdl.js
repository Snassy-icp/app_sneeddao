/**
 * Minimal Candid IDL factory for bot log alert methods.
 * Works with both ICP Staking Bots and Trading Bots since they share
 * the same BotLogEngine / BotLogTypes interface.
 *
 * Used by WalletContext to query log alerts across all bot types without
 * importing bot-type-specific declarations.
 */
import { IDL } from '@dfinity/candid';

const LogAlertSummary = IDL.Record({
    unseenErrorCount: IDL.Nat,
    unseenWarningCount: IDL.Nat,
    highestErrorId: IDL.Nat,
    highestWarningId: IDL.Nat,
    nextId: IDL.Nat,
});

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

/**
 * IDL factory for bot log alert methods only.
 * Can be used with Actor.createActor() for any bot canister that supports the BotLog interface.
 */
export const botLogIdlFactory = ({ IDL: _IDL }) => {
    return IDL.Service({
        getLogAlertSummary: IDL.Func([IDL.Nat], [LogAlertSummary], ['query']),
        getLastSeenLogId: IDL.Func([], [IDL.Nat], ['query']),
        markLogsSeen: IDL.Func([IDL.Nat], [], []),
        getLogConfig: IDL.Func([], [LogConfig], ['query']),
        getLogs: IDL.Func([LogFilter], [LogResult], ['query']),
    });
};
