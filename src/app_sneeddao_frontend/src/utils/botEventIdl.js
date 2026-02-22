/**
 * Minimal Candid IDL factory for the inter-bot event system.
 * Works with both ICP Staking Bots and Trading Bots since they share
 * the same BotEventEngine / BotEventTypes interface.
 *
 * Used by BotEventPanel to query/manage events without importing
 * bot-type-specific declarations.
 */
import { IDL } from '@dfinity/candid';

const BotEvent = IDL.Record({
    sourceCanisterId: IDL.Principal,
    eventTypeId: IDL.Nat,
    timestamp: IDL.Int,
    data: IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text)),
    eventId: IDL.Nat,
});

const EventListenerRegistration = IDL.Record({
    id: IDL.Nat,
    listenerCanisterId: IDL.Principal,
    eventTypeIds: IDL.Vec(IDL.Nat),
    registeredAt: IDL.Int,
    enabled: IDL.Bool,
});

const RegisterListenerRequest = IDL.Record({
    eventTypeIds: IDL.Vec(IDL.Nat),
});

const EventSubscription = IDL.Record({
    id: IDL.Nat,
    sourceBotCanisterId: IDL.Principal,
    eventTypeIds: IDL.Vec(IDL.Nat),
    registrationId: IDL.Opt(IDL.Nat),
    enabled: IDL.Bool,
    createdAt: IDL.Int,
});

const EventCondition = IDL.Record({
    dataKey: IDL.Text,
    operator: IDL.Nat,
    value: IDL.Text,
});

const EventReactionRule = IDL.Record({
    id: IDL.Nat,
    name: IDL.Text,
    enabled: IDL.Bool,
    subscriptionId: IDL.Nat,
    eventTypeId: IDL.Nat,
    reactionActionId: IDL.Nat,
    actionParams: IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text)),
    conditions: IDL.Vec(EventCondition),
    cooldownSeconds: IDL.Opt(IDL.Nat),
    lastTriggeredAt: IDL.Opt(IDL.Int),
    triggerCount: IDL.Nat,
});

const EventReactionRuleInput = IDL.Record({
    name: IDL.Text,
    enabled: IDL.Bool,
    subscriptionId: IDL.Nat,
    eventTypeId: IDL.Nat,
    reactionActionId: IDL.Nat,
    actionParams: IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text)),
    conditions: IDL.Vec(EventCondition),
    cooldownSeconds: IDL.Opt(IDL.Nat),
});

const EventReactionLogEntry = IDL.Record({
    id: IDL.Nat,
    timestamp: IDL.Int,
    eventId: IDL.Nat,
    eventTypeId: IDL.Nat,
    sourceCanisterId: IDL.Principal,
    reactionRuleId: IDL.Nat,
    reactionRuleName: IDL.Text,
    reactionActionId: IDL.Nat,
    success: IDL.Bool,
    error: IDL.Opt(IDL.Text),
});

const EventLogQuery = IDL.Record({
    eventTypeId: IDL.Opt(IDL.Nat),
    fromTime: IDL.Opt(IDL.Int),
    toTime: IDL.Opt(IDL.Int),
    startId: IDL.Opt(IDL.Nat),
    limit: IDL.Opt(IDL.Nat),
});

const EventLogResult = IDL.Record({
    entries: IDL.Vec(BotEvent),
    totalMatching: IDL.Nat,
    hasMore: IDL.Bool,
});

const EventReactionLogQuery = IDL.Record({
    reactionRuleId: IDL.Opt(IDL.Nat),
    eventTypeId: IDL.Opt(IDL.Nat),
    fromTime: IDL.Opt(IDL.Int),
    toTime: IDL.Opt(IDL.Int),
    startId: IDL.Opt(IDL.Nat),
    limit: IDL.Opt(IDL.Nat),
});

const EventReactionLogResult = IDL.Record({
    entries: IDL.Vec(EventReactionLogEntry),
    totalMatching: IDL.Nat,
    hasMore: IDL.Bool,
});

const OkNat = IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text });
const OkUnit = IDL.Variant({ Ok: IDL.Null, Err: IDL.Text });

/**
 * IDL factory for the inter-bot event system.
 * Can be used with Actor.createActor() for any bot canister that supports the BotEvent interface.
 */
export const botEventIdlFactory = ({ IDL: _IDL }) => {
    return IDL.Service({
        // Source side
        registerEventListener: IDL.Func([RegisterListenerRequest], [OkNat], []),
        unregisterEventListener: IDL.Func([IDL.Nat], [], []),
        getEventListeners: IDL.Func([], [IDL.Vec(EventListenerRegistration)], ['query']),
        setEventEmissionEnabled: IDL.Func([IDL.Bool], [], []),
        getEventLog: IDL.Func([EventLogQuery], [EventLogResult], ['query']),
        getEventTypes: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Nat, IDL.Text))], ['query']),

        // Listener side
        addEventSubscription: IDL.Func([IDL.Principal, IDL.Vec(IDL.Nat)], [OkNat], []),
        removeEventSubscription: IDL.Func([IDL.Nat], [], []),
        getEventSubscriptions: IDL.Func([], [IDL.Vec(EventSubscription)], ['query']),
        addEventReaction: IDL.Func([EventReactionRuleInput], [IDL.Nat], []),
        updateEventReaction: IDL.Func([IDL.Nat, EventReactionRuleInput], [], []),
        removeEventReaction: IDL.Func([IDL.Nat], [], []),
        getEventReactions: IDL.Func([], [IDL.Vec(EventReactionRule)], ['query']),
        getEventReactionLog: IDL.Func([EventReactionLogQuery], [EventReactionLogResult], ['query']),
        getAvailableReactionActions: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Nat, IDL.Text))], ['query']),
        onBotEvent: IDL.Func([BotEvent], [OkUnit], []),
    });
};
