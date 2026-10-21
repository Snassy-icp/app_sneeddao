/**
 * A Sneedapp bot's cycles balance through its public query `getCyclesBalance`
 * (ICP Staking Bot 0.9.5+, Trading Bot 0.9.4+; both also answer the cycles wallet's
 * `wallet_balance128`). Anyone can call it, so non-controllers can see a bot's fuel and
 * top it up through the CMC. Controllers keep using the management canister's
 * canister_status, which also gives memory, status and module hash.
 */
import { Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';

export const botCyclesIdlFactory = ({ IDL }) => IDL.Service({
    getCyclesBalance: IDL.Func([], [IDL.Nat], ['query']),
});

/** The bot's cycles as a Number, or null when it cannot say (older bots lack the query). */
export async function fetchBotCyclesBalance(agent, canisterId) {
    try {
        const id = typeof canisterId === 'string' ? Principal.fromText(canisterId) : canisterId;
        const actor = Actor.createActor(botCyclesIdlFactory, { agent, canisterId: id });
        return Number(await actor.getCyclesBalance());
    } catch {
        return null;
    }
}
