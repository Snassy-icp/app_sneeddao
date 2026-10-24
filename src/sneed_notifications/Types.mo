/// Types of sneed_notifications (spec/sneed_notifications.md).
module {
  public type AppId = Nat;
  public type ChannelId = Nat;
  public type NotificationId = Nat;
  public type JobId = Nat;

  /// How much a message matters, declared per topic by its app; users can demote.
  public type Level = { #urgent; #normal; #info };

  /// Where a user receives messages. Sneed SMS needs no address (it is the user's own inbox);
  /// the others are delivered by relays.
  public type ChannelKind = { #sneed_sms; #push; #discord; #telegram; #email; #sms };

  public type ChannelState = { #unverified; #verified };

  public type Channel = {
    id : ChannelId;
    kind : ChannelKind;
    name : Text;
    /// The address (push subscription, Discord id, email...), encrypted by the client to the
    /// relay of its kind; opaque here. Empty for Sneed SMS.
    address : Blob;
    state : ChannelState;
    created_at : Int;
  };

  public type Topic = { id : Text; title : Text; description : Text; level : Level };

  public type AppInput = { name : Text; logo : ?Text; description : Text; canisters : [Principal]; topics : [Topic] };

  public type App = {
    id : AppId;
    name : Text;
    logo : ?Text;
    description : Text;
    owner : Principal;
    canisters : [Principal];
    topics : [Topic];
    verified : Bool; // set by admins (shown as a checkmark)
    created_at : Int;
  };

  /// What one topic of an allowed app does for one user.
  public type TopicRule = { #mute; #level : Level; #channels : [ChannelId] };

  public type Permission = {
    allowed : Bool;
    demote : Bool; // every topic one level down
    copy_only : Bool; // only the "always copy to" channel
    muted_until : ?Int;
    daily_cap : Nat; // messages a day from this app
    daily_spend_cap_e8s : Nat; // what this app may cost the user a day
    topics : [(Text, TopicRule)];
  };

  public type QuietHours = {
    start_min : Nat; // minutes after local midnight
    end_min : Nat;
    utc_offset_min : Int; // the user's time zone
    urgent_passes : Bool;
  };

  public type Settings = {
    defaults : { urgent : [ChannelId]; normal : [ChannelId]; info : [ChannelId] };
    always_copy : ?ChannelId;
    quiet : ?QuietHours;
    snooze_until : ?Int;
  };

  public type NotifyInput = {
    user : Principal;
    topic : Text;
    title : Text;
    body : Text;
    link : ?Text;
    dedupe : ?Text;
    sponsored : Bool;
  };

  public type NotifyError = {
    #not_registered; // the caller is not a canister (or owner) of a registered app
    #unknown_topic;
    #not_allowed; // the user has not allowed this app
    #rate_limited; // the user's daily cap for this app
    #no_funds; // sponsored, and the app's balance can't cover it
    #invalid : Text;
  };

  public type NotifyResult = { #ok : { id : NotificationId; deliveries : Nat; deduplicated : Bool }; #err : NotifyError };

  public type JobState = {
    #queued;
    #sending : { relay : Principal; since : Int };
    #delivered : { at : Int };
    #failed : { reason : Text };
    #suppressed : { reason : Text };
  };

  public type Job = {
    id : JobId;
    notification : NotificationId;
    user : Principal;
    channel : ChannelId;
    kind : ChannelKind;
    not_before : Int; // quiet hours push this into the morning
    price_e8s : Nat;
    paid_by_app : Bool;
    attempts : Nat;
    state : JobState;
  };

  /// What a relay gets to deliver one message.
  public type RelayJob = { id : JobId; kind : ChannelKind; address : Blob; app : Text; title : Text; body : Text; link : ?Text; level : Level; created_at : Int };

  public type Receipt = {
    id : NotificationId;
    created_at : Int;
    state : { #pending; #delivered; #suppressed : Text; #failed : Text; #expired };
  };

  /// A user's view of a notification they received.
  public type HistoryItem = {
    id : NotificationId;
    app : AppId;
    app_name : Text;
    topic : Text;
    level : Level;
    title : Text;
    body : Text;
    link : ?Text;
    created_at : Int;
    deliveries : [{ channel : ChannelId; kind : ChannelKind; state : JobState }];
  };

  public type Config = {
    icp_ledger : Principal;
    sneed_sms : Principal;
    sns_wasm : Principal;
    prices_e8s : [(ChannelKind, Nat)]; // per delivery
    notify_price_e8s : Nat; // per notify call, on top
    dedupe_window_ns : Nat;
    retention_ns : Nat;
    default_daily_cap : Nat;
    default_daily_spend_cap_e8s : Nat;
    max_title : Nat;
    max_body : Nat;
    relays : [(Principal, ChannelKind)];
    relay_lease_ns : Nat; // a job a relay took but didn't acknowledge goes back to the queue
    max_attempts : Nat;
  };

  public type Account = { owner : Principal; subaccount : ?Blob };

  /// Revenue forwarding: the spent ICP (prices deducted from balances) goes to `destination`.
  /// Public: revenue is DAO information.
  public type FeeForwarding = {
    destination : ?Account; // null: fees stay in the canister
    threshold_e8s : Nat; // forward once at least this much is unforwarded
    ledger_fee_e8s : Nat;
    earned_e8s : Nat; // prices deducted from user and app balances since forwarding existed
    refunded_e8s : Nat; // of those, given back (deliveries that finally failed)
    forwarded_e8s : Nat; // received by the destination(s)
    ledger_fees_paid_e8s : Nat; // ledger fees of the forwarding transfers
    forwards : Nat;
    backlog_e8s : ?Nat; // fees spent before forwarding existed, measured at the first attempt (null: not yet)
    unforwarded_e8s : ?Nat; // what the books say may go out now (null: not measured yet)
    liabilities_e8s : Nat; // user balances + app balances + paid deliveries not final + top-ups in flight
    reserved_e8s : Nat; // paid deliveries not final yet (refunded if they fail)
    last_check : Int;
    last_forward : ?{ at : Int; amount_e8s : Nat; block : Nat; to : Account };
    last_error : ?Text;
    retry_pending : Bool; // a transfer whose outcome is unknown is retried with the same arguments (deduplicated by the ledger)
    events : [(Int, Text)]; // newest last, at most 20
  };

  /// One ICP payment into the canister, credited to a user's or an app's balance: a top-up
  /// (`top_up`, `top_up_app`) or a credit an admin made after checking the ledger block
  /// (`admin_credit`: a top-up whose outcome was unknown). Kept per payer.
  public type TopUp = {
    ledger_block : Nat;
    amount_e8s : Nat;
    at : Int;
    app : ?AppId; // an app top-up: the app it funded
    via : { #top_up; #app_top_up; #admin_credit };
  };

  // ---- Withdrawals (spec/micropayments.md §3.3, §11, §15a: the common withdraw API) ----

  /// `withdraw`: `amount_e8s` comes off the caller's balance and `to` receives it less one ledger
  /// fee. `created_at_time` (ns, optional) makes a retry of the same request idempotent: the same
  /// amount, `to` and time answer the first result instead of withdrawing again.
  public type WithdrawArgs = { amount_e8s : Nat; to : Account; created_at_time : ?Nat64 };

  /// A withdrawal the ledger confirmed.
  public type Withdrawal = {
    amount_e8s : Nat; // off the balance
    fee_e8s : Nat; // the ledger fee, out of the amount
    sent_e8s : Nat; // what `to` received: amount − fee
    to : Account;
    ledger_block : Nat;
    created_at_time : Nat64;
    at : Int;
  };

  /// A withdrawal debited from the balance whose transfer is under way (`#sending`) or whose
  /// outcome is not known (`#unknown`: the call to the ledger failed in flight). It is retried with
  /// the same arguments (memo and created_at_time), which the ledger deduplicates, so it goes out at
  /// most once: by the timer, by the user's next `withdraw`, or by support. `#too_old`: the ledger's
  /// deduplication window passed before a retry got an answer; support settles it from the ledger
  /// (`admin_resolve_withdraw`). The amount is counted as owed until it is settled.
  public type PendingWithdrawal = {
    amount_e8s : Nat;
    fee_e8s : Nat;
    to : Account;
    memo : Blob;
    created_at_time : Nat64;
    started_at : Int;
    attempts : Nat;
    state : { #sending; #unknown : Text; #too_old };
  };

  public type WithdrawOk = { ledger_block : Nat; amount_e8s : Nat; fee_e8s : Nat; sent_e8s : Nat; balance_e8s : Nat };

  public type WithdrawError = {
    #not_signed_in;
    #rate_limited;
    #busy; // another withdrawal of yours is under way
    #invalid : Text; // e.g. a subaccount that is not 32 bytes, or this canister as `to`
    #amount_too_small : { min_e8s : Nat }; // the amount must be more than one ledger fee
    #insufficient_balance : { balance_e8s : Nat };
    #duplicate : { ledger_block : Nat }; // the ledger already made this exact transfer: nothing more moved
    #refused : Text; // the ledger refused, or could not be reached: nothing moved, the balance is back
    #pending : PendingWithdrawal; // an earlier withdrawal's outcome is not known yet; it is retried
  };

  public type WithdrawResult = { #ok : WithdrawOk; #err : WithdrawError };

  /// The caller's prepaid balance (`get_my_prepaid`): what is spendable, what is held for
  /// deliveries not final yet, and the money in and out.
  public type PrepaidView = {
    balance_e8s : Nat; // spendable and withdrawable
    reserved_e8s : Nat; // charged for deliveries not final yet: refunded here if they fail
    ledger_fee_e8s : Nat;
    min_withdraw_e8s : Nat; // one more than the ledger fee
    withdrawn_e8s : Nat; // in all, since withdrawals exist
    withdraw_pending : ?PendingWithdrawal;
    withdrawals : [Withdrawal]; // newest first, at most 50
    top_ups : [TopUp]; // newest first, at most 100
  };

  /// What support sees of one user (admin_get_user).
  public type AdminUserView = {
    balance_e8s : Nat;
    low_balance_alert : { threshold_e8s : Nat; alerted : Bool };
    settings : Settings;
    channels : [Channel];
    apps : [(App, Permission)];
    requests : [App];
    top_ups : [TopUp]; // newest first, at most 100
    history : [HistoryItem]; // newest first
    pending_jobs : Nat; // deliveries to this user not final yet
    reserved_e8s : Nat; // their prices (refunded to the payer if they fail)
    withdrawals : [Withdrawal]; // newest first, at most 50
    withdraw_pending : ?PendingWithdrawal;
  };

  public type Result = { #ok : Text; #err : Text };
  public type ResultNat = { #ok : Nat; #err : Text };
};
