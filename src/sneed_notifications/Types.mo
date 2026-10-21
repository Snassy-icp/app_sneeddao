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

  public type Result = { #ok : Text; #err : Text };
  public type ResultNat = { #ok : Nat; #err : Text };
};
