import Cycles "mo:base/ExperimentalCycles";

/// A bot's own cycles balance, for its public queries `getCyclesBalance` and `wallet_balance128`.
///
/// The balance is public information: anyone (Sneed Monitor, a managed-bots service, other users)
/// may read a bot's fuel and top it up through the CMC (notify_top_up is permissionless), without
/// being a controller, which the management canister's canister_status requires.
///
/// There is no ICRC standard for this. `wallet_balance128 : () -> (record { amount : nat }) query`
/// is the DFINITY cycles wallet's method (the one existing interface for "my cycles balance");
/// `getCyclesBalance : () -> (nat) query` is the same number in the bots' own naming. Monitoring
/// services (CycleOps, Unicycle) read balances through a blackhole controller instead and call
/// nothing on the canister. The freezing threshold and burn rate are not visible to the canister
/// itself, so only the balance is reported.
module {
  public type WalletBalance128 = { amount : Nat };

  public func balance() : Nat = Cycles.balance();

  public func walletBalance128() : WalletBalance128 = { amount = Cycles.balance() };
};
