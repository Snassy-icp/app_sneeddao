/// Shared types for the Distribution Chore feature.
/// Reusable across multiple bot products.
///
/// A Distribution List defines how funds from a source account should be
/// distributed to a set of target ICRC-1 accounts based on configured percentages.
module {

    /// Standard ICRC-1 account (structurally compatible with bot-specific Account types).
    public type Account = {
        owner: Principal;
        subaccount: ?Blob;
    };

    /// A single distribution target.
    public type DistributionTarget = {
        /// The ICRC-1 account to receive funds.
        account: Account;
        /// Share of the distribution in basis points (0–10000, where 10000 = 100%).
        /// null = auto-split: evenly share whatever is left after assigned targets.
        basisPoints: ?Nat;
    };

    /// A complete distribution list configuration.
    public type DistributionList = {
        /// Unique identifier (assigned by the canister).
        id: Nat;
        /// Human-readable name for this distribution list.
        name: Text;
        /// Source subaccount to check balance and transfer from.
        /// null = the bot's default account (no subaccount).
        sourceSubaccount: ?Blob;
        /// The ICRC-1 token ledger canister to query and transfer through.
        tokenLedgerCanisterId: Principal;
        /// Minimum balance (in token's smallest unit) before distribution triggers.
        thresholdAmount: Nat;
        /// Maximum amount (in token's smallest unit) to distribute per round.
        maxDistributionAmount: Nat;
        /// Ordered list of targets to distribute to.
        targets: [DistributionTarget];
    };

    /// Input type for creating/updating a distribution list (no id field).
    public type DistributionListInput = {
        name: Text;
        sourceSubaccount: ?Blob;
        tokenLedgerCanisterId: Principal;
        thresholdAmount: Nat;
        maxDistributionAmount: Nat;
        targets: [DistributionTarget];
    };
}
