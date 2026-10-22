import Principal "mo:base/Principal";
import HashMap "mo:base/HashMap";
import List "mo:base/List";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat64 "mo:base/Nat64";
import Text "mo:base/Text";
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Result "mo:base/Result";
import Buffer "mo:base/Buffer";
import Debug "mo:base/Debug";
import Error "mo:base/Error";
import Time "mo:base/Time";
import Int "mo:base/Int";
import Timer "mo:base/Timer";
import Map "mo:map/Map";
import { nhash; phash } "mo:map/Map";

import T "Types";
import PremiumClient "../PremiumClient";
import IngressGuard "../IngressGuard";
import ApiDoc "ApiDoc";
import Donations "Donations";
import SpecialPrices "../SpecialPrices";
import Icrc3Log "../icrc3/Log";
import T3 "../icrc3/Types";
import TextLog "../sneed_names/TextLog";
import NT "../sneed_names/Types";
import Sha256 "mo:sha2/Sha256";

shared (deployer) persistent actor class AppSneedDaoBackend() = this {

  private func this_canister_id() : Principal {
      Principal.fromActor(this);
  };
  
  // ICPSwap's trusted token list: the source of the whitelist (Swaprunner, which
  // used to sit in between, is being retired).
  transient let ICPSWAP_TOKEN_LIST_CANISTER_ID : Text = "k37c6-riaaa-aaaag-qcyza-cai";
  transient let ICP_LEDGER_CANISTER_ID : Text = "ryjl3-tyaaa-aaaaa-aaaba-cai";
  transient let ICP_LEDGER_FEE : Nat = 10_000; // 0.0001 ICP

  // aliases
  type State = T.State;
  type StablePrincipalSwapCanisters = T.StablePrincipalSwapCanisters;
  type StablePrincipalLedgerCanisters = T.StablePrincipalLedgerCanisters;
  type StablePrincipalTrackedCanisters = T.StablePrincipalTrackedCanisters;
  type CanisterGroup = T.CanisterGroup;
  type CanisterGroupsRoot = T.CanisterGroupsRoot;
  type StablePrincipalCanisterGroups = T.StablePrincipalCanisterGroups;
  type WalletLayout = T.WalletLayout;
  type StablePrincipalWalletLayout = T.StablePrincipalWalletLayout;
  type SwapRunnerTokenMetadata = T.SwapRunnerTokenMetadata;
  type NeuronId = T.NeuronId;
  type NeuronName = T.NeuronName;
  type NeuronNickname = T.NeuronNickname;
  type NeuronNameKey = T.NeuronNameKey;
  type UserSettings = T.UserSettings;
  type UserSettingsUpdate = T.UserSettingsUpdate;

  // Partner types
  type Partner = T.Partner;
  type PartnerLink = T.PartnerLink;

  // Project types
  type Project = T.Project;
  type ProjectLink = T.ProjectLink;
  type ProjectType = T.ProjectType;

  // Canister info types
  type CanisterInfoRequest = T.CanisterInfoRequest;
  type CanisterInfoResponse = T.CanisterInfoResponse;

  // Token whitelist types
  type WhitelistedToken = {
    ledger_id: Principal;
    decimals: Nat8;
    fee: Nat;
    name: Text;
    symbol: Text;
    standard: Text;
  };

  // ICRC1 metadata types for ledger queries
  type ICRC1MetadataValue = {
    #Int : Int;
    #Nat : Nat;
    #Blob : Blob;
    #Text : Text;
  };

  // Refresh all tokens progress tracking
  public type RefreshAllProgress = {
    is_running: Bool;
    total: Nat;
    processed: Nat;
    success: Nat;
    failed: Nat;
    current_token: Text;
    errors: [Text];
  };

  // Transient state for refresh worker
  transient var refresh_all_is_running : Bool = false;
  transient var refresh_all_total : Nat = 0;
  transient var refresh_all_processed : Nat = 0;
  transient var refresh_all_success : Nat = 0;
  transient var refresh_all_failed : Nat = 0;
  transient var refresh_all_current_token : Text = "";
  transient var refresh_all_errors : Buffer.Buffer<Text> = Buffer.Buffer<Text>(10);
  transient var refresh_all_tokens_to_process : [WhitelistedToken] = [];
  transient var refresh_all_timer_id : ?Timer.TimerId = null;

  // Daily token list maintenance: import ICPSwap's trusted token list, then
  // refresh every token's metadata. Self-starting on install and after every
  // upgrade; `get_token_list_status` reports it for the health page.
  transient let TOKEN_REFRESH_INTERVAL_SECONDS : Nat = 86_400;
  transient var token_refresh_timer_id : ?Timer.TimerId = null;
  var token_list_last_import : Int = 0;          // Time.now() of the last successful whitelist import
  var token_list_last_refresh_started : Int = 0; // ... of the last metadata refresh start
  var token_list_last_refresh_done : Int = 0;    // ... of the last metadata refresh completion
  var token_list_last_error : Text = "";

  // Ban types
  type BanLogEntry = {
    user: Principal;
    admin: Principal;
    ban_timestamp: Int;
    expiry_timestamp: Int;
    reason: Text;
  };

  // stable memory
  var stable_principal_swap_canisters : StablePrincipalSwapCanisters = [];
  var stable_principal_ledger_canisters : StablePrincipalLedgerCanisters = [];
  var stable_principal_tracked_canisters : StablePrincipalTrackedCanisters = [];
  var stable_principal_canister_groups : StablePrincipalCanisterGroups = [];
  var stable_principal_wallet_layouts : StablePrincipalWalletLayout = [];
  var stable_whitelisted_tokens : [WhitelistedToken] = [];
  var stable_admins : [Principal] = [deployer.caller];
  var stable_blacklisted_words : [(Text, Bool)] = [];

  // Stable storage for user settings (per-setting maps)
  var stable_user_setting_principal_color_coding : [(Principal, Bool)] = [];
  var stable_user_setting_neuron_color_coding : [(Principal, Bool)] = [];
  var stable_user_setting_show_vp_bar : [(Principal, Bool)] = [];
  var stable_user_setting_show_header_notifications : [(Principal, Bool)] = [];
  var stable_user_setting_collectibles_threshold : [(Principal, Float)] = [];
  var stable_user_setting_expand_quick_links_on_desktop : [(Principal, Bool)] = [];
  var stable_user_setting_particle_effects_enabled : [(Principal, Bool)] = [];
  var stable_user_setting_neuron_manager_cycle_threshold_red : [(Principal, Nat)] = [];
  var stable_user_setting_neuron_manager_cycle_threshold_orange : [(Principal, Nat)] = [];
  var stable_user_setting_canister_manager_cycle_threshold_red : [(Principal, Nat)] = [];
  var stable_user_setting_canister_manager_cycle_threshold_orange : [(Principal, Nat)] = [];
  var stable_user_setting_frontend_auto_update_enabled : [(Principal, Bool)] = [];
  var stable_user_setting_frontend_clear_cache_on_update : [(Principal, Bool)] = [];
  var stable_user_setting_frontend_update_check_interval_sec : [(Principal, Nat)] = [];
  var stable_user_setting_frontend_update_countdown_sec : [(Principal, Nat)] = [];
  var stable_user_setting_swap_slippage_tolerance : [(Principal, Float)] = [];
  var stable_user_setting_always_show_remove_token : [(Principal, Bool)] = [];
  // Per-notification-type visibility settings
  var stable_user_setting_notify_replies : [(Principal, Bool)] = [];
  var stable_user_setting_notify_tips : [(Principal, Bool)] = [];
  var stable_user_setting_notify_messages : [(Principal, Bool)] = [];
  var stable_user_setting_notify_collectibles : [(Principal, Bool)] = [];
  var stable_user_setting_notify_votable_proposals : [(Principal, Bool)] = [];
  var stable_user_setting_notify_outdated_bots : [(Principal, Bool)] = [];
  var stable_user_setting_notify_low_cycles : [(Principal, Bool)] = [];
  var stable_user_setting_notify_bot_chores : [(Principal, Bool)] = [];
  var stable_user_setting_notify_bot_log_errors : [(Principal, Bool)] = [];
  var stable_user_setting_notify_bot_log_warnings : [(Principal, Bool)] = [];
  var stable_user_setting_notify_updates : [(Principal, Bool)] = [];
  var stable_user_setting_denomination_token : [(Principal, Text)] = [];
  
  // Per-user per-canister last-seen log ID (for cross-device bot log alert tracking)
  var stable_user_last_seen_log_id : [(Principal, [(Principal, Nat)])] = [];

  // Stable storage for neuron names and nicknames
  var stable_neuron_names : [(NeuronNameKey, (Text, Bool))] = [];
  var stable_neuron_nicknames : [(Principal, [(NeuronNameKey, Text)])] = [];

  // Stable storage for bans
  var stable_ban_log : [BanLogEntry] = [];
  var stable_banned_users : [(Principal, Int)] = [];

  // Stable storage for avatars (a separate structure: the name records stay as they are)
  var stable_avatars : [(Principal, Text)] = [];

  // The naming service (spec/sneed_names.md): its canisters may call names_moderate, and while
  // names move there the naming writes here are refused (reads keep working).
  var stable_names_canisters : [Principal] = [];
  var stable_names_frozen : Bool = false;

  // Stable storage for principal names and nicknames
  var stable_principal_names : [(Principal, (Text, Bool))] = [];
  var stable_principal_nicknames : [(Principal, [(Principal, Text)])] = [];

  // Stable storage for partners
  var stable_partners : [Partner] = [];

  // Stable storage for projects
  var stable_projects : [Project] = [];

  // Persistent next-id counters for partners and projects so ids are never reused after
  // deletions + upgrade. 0 = not yet recorded (postupgrade then falls back to max id + 1).
  var stable_next_partner_id : Nat = 0;
  var stable_next_project_id : Nat = 0;

  // Jailbreak configuration types and storage
  type JailbreakConfig = {
    id: Nat;
    sns_root_canister_id: Principal;
    neuron_id_hex: Text;  // Neuron ID stored as hex string
    target_principal: Principal;
    created_at: Int;
  };

  // Jailbreak payment log type
  type JailbreakPaymentLog = {
    id: Nat;
    user: Principal;
    config_id: Nat;
    sns_root_canister_id: Principal;
    neuron_id_hex: Text;
    target_principal: Principal;
    amount_e8s: Nat;
    is_premium: Bool;
    timestamp: Int;
  };

  var stable_jailbreak_configs : [(Principal, [JailbreakConfig])] = [];
  var stable_next_jailbreak_config_id : Nat = 1;
  
  // Jailbreak payment logs
  var stable_jailbreak_payment_logs : [JailbreakPaymentLog] = [];
  var stable_next_jailbreak_payment_log_id : Nat = 1;
  
  // Jailbreak fee settings (in e8s - 1 ICP = 100_000_000 e8s)
  var stable_jailbreak_fee_premium : Nat = 0;      // Fee for premium members (default: free)
  var stable_jailbreak_fee_regular : Nat = 0;      // Fee for regular users (default: free)
  // Fee recipient ICRC1 account (owner + optional subaccount). Null = canister keeps fees
  var stable_jailbreak_fee_account_owner : ?Principal = null;
  var stable_jailbreak_fee_account_subaccount : ?Blob = null;

  // Special prices (spec/special_prices.md): an admin price (admins who are people) and partner
  // prices (per principal, public label, optional expiry) next to the regular and premium jailbreak
  // fees; the lowest applicable one is charged. All unset = charges exactly as before.
  type SpecialPriceSet = { jailbreak_fee_e8s : ?Nat };
  type PartnerPrices = SpecialPrices.Partner<SpecialPriceSet>;
  var special_admin_prices : SpecialPriceSet = { jailbreak_fee_e8s = null };
  var special_partner_prices : Map.Map<Principal, PartnerPrices> = Map.new<Principal, PartnerPrices>();
  // price tier of each jailbreak payment log entry (by log id) recorded since special prices; older
  // entries are #premium or #regular by their is_premium flag
  var jailbreak_payment_tiers : Map.Map<Nat, SpecialPrices.Tier> = Map.new<Nat, SpecialPrices.Tier>();
  // ICP ledger block of each jailbreak payment log entry (by log id), recorded since the support
  // fixes (spec/support_audit.md P0-7); entries paid since the ICRC-3 log are filled in from its
  // jailbreak_payment blocks on upgrade, older ones have none
  var jailbreak_payment_blocks : Map.Map<Nat, Nat> = Map.new<Nat, Nat>();
  var jailbreak_payment_blocks_backfilled : Bool = false;
  // callers with a save_jailbreak_config in flight: a second save is refused until the first has
  // finished, so two calls at once can never both charge
  transient let jailbreak_saving : Map.Map<Principal, ()> = Map.new<Principal, ()>();
  
  // Stable storage for user token registrations (user -> list of ledger IDs)
  var stable_user_tokens : [(Principal, [Principal])] = [];
  
  // Authorized callers for "for" methods (e.g., Sneedex)
  var stable_authorized_for_callers : [Principal] = [];

  // Nickname limits configuration and premium integration
  var stable_sneed_premium_canister_id : ?Principal = null;
  var stable_max_neuron_nicknames : Nat = 10;
  var stable_max_principal_nicknames : Nat = 10;
  var stable_premium_max_neuron_nicknames : Nat = 100;
  var stable_premium_max_principal_nicknames : Nat = 100;
  var stable_premium_cache = PremiumClient.emptyCache();
  
  // Canister groups limits configuration
  var stable_max_canister_groups : Nat = 5;          // Max folders/groups for regular users
  var stable_max_canisters_per_group : Nat = 20;     // Max canisters in a single group
  var stable_max_total_grouped_canisters : Nat = 50; // Max total canisters across all groups
  var stable_premium_max_canister_groups : Nat = 50;
  var stable_premium_max_canisters_per_group : Nat = 100;
  var stable_premium_max_total_grouped_canisters : Nat = 500;

  // Runtime hashmaps for neuron names and nicknames
  transient var neuron_names = HashMap.HashMap<NeuronNameKey, (Text, Bool)>(100, func(k1: NeuronNameKey, k2: NeuronNameKey) : Bool {
    Principal.equal(k1.sns_root_canister_id, k2.sns_root_canister_id) and Blob.equal(k1.neuron_id.id, k2.neuron_id.id)
  }, func(k: NeuronNameKey) : Nat32 {
    let h1 = Principal.hash(k.sns_root_canister_id);
    let h2 = Blob.hash(k.neuron_id.id);
    h1 ^ h2
  });

  transient var neuron_nicknames = HashMap.HashMap<Principal, HashMap.HashMap<NeuronNameKey, Text>>(100, Principal.equal, Principal.hash);

  transient var cached_token_meta : HashMap.HashMap<Principal, T.TokenMeta> = HashMap.HashMap<Principal, T.TokenMeta>(100, Principal.equal, Principal.hash);
  transient var whitelisted_tokens : HashMap.HashMap<Principal, WhitelistedToken> = HashMap.HashMap<Principal, WhitelistedToken>(10, Principal.equal, Principal.hash);
  transient var admins : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(10, Principal.equal, Principal.hash);
  
  // User token registrations (user -> list of ledger IDs they've registered)
  transient var user_tokens : HashMap.HashMap<Principal, [Principal]> = HashMap.HashMap<Principal, [Principal]>(100, Principal.equal, Principal.hash);
  
  // Authorized callers for "for" methods
  transient var authorized_for_callers : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(10, Principal.equal, Principal.hash);

  // User settings defaults
  transient let default_principal_color_coding : Bool = true;
  transient let default_neuron_color_coding : Bool = true;
  transient let default_show_vp_bar : Bool = true;
  transient let default_show_header_notifications : Bool = true;
  transient let default_collectibles_threshold : Float = 1.0;
  transient let default_expand_quick_links_on_desktop : Bool = false;
  transient let default_particle_effects_enabled : Bool = true;
  transient let default_cycle_threshold_red : Nat = 1_000_000_000_000;
  transient let default_cycle_threshold_orange : Nat = 5_000_000_000_000;
  transient let default_frontend_auto_update_enabled : Bool = false;
  transient let default_frontend_clear_cache_on_update : Bool = false;
  transient let default_frontend_update_check_interval_sec : Nat = 600;
  transient let default_frontend_update_countdown_sec : Nat = 300;
  transient let default_swap_slippage_tolerance : Float = 0.01;
  transient let default_always_show_remove_token : Bool = false;
  transient let default_denomination_token : Text = "xevnm-gaaaa-aaaar-qafnq-cai"; // ckUSDC
  transient let default_notify_replies : Bool = true;
  transient let default_notify_tips : Bool = true;
  transient let default_notify_messages : Bool = true;
  transient let default_notify_collectibles : Bool = true;
  transient let default_notify_votable_proposals : Bool = true;
  transient let default_notify_outdated_bots : Bool = true;
  transient let default_notify_low_cycles : Bool = true;
  transient let default_notify_bot_chores : Bool = true;
  transient let default_notify_bot_log_errors : Bool = true;
  transient let default_notify_bot_log_warnings : Bool = true;
  transient let default_notify_updates : Bool = true;

  // Runtime storage for user settings
  transient var user_setting_principal_color_coding : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_neuron_color_coding : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_show_vp_bar : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_show_header_notifications : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_collectibles_threshold : HashMap.HashMap<Principal, Float> = HashMap.HashMap<Principal, Float>(100, Principal.equal, Principal.hash);
  transient var user_setting_expand_quick_links_on_desktop : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_particle_effects_enabled : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_neuron_manager_cycle_threshold_red : HashMap.HashMap<Principal, Nat> = HashMap.HashMap<Principal, Nat>(100, Principal.equal, Principal.hash);
  transient var user_setting_neuron_manager_cycle_threshold_orange : HashMap.HashMap<Principal, Nat> = HashMap.HashMap<Principal, Nat>(100, Principal.equal, Principal.hash);
  transient var user_setting_canister_manager_cycle_threshold_red : HashMap.HashMap<Principal, Nat> = HashMap.HashMap<Principal, Nat>(100, Principal.equal, Principal.hash);
  transient var user_setting_canister_manager_cycle_threshold_orange : HashMap.HashMap<Principal, Nat> = HashMap.HashMap<Principal, Nat>(100, Principal.equal, Principal.hash);
  transient var user_setting_frontend_auto_update_enabled : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_frontend_clear_cache_on_update : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_frontend_update_check_interval_sec : HashMap.HashMap<Principal, Nat> = HashMap.HashMap<Principal, Nat>(100, Principal.equal, Principal.hash);
  transient var user_setting_frontend_update_countdown_sec : HashMap.HashMap<Principal, Nat> = HashMap.HashMap<Principal, Nat>(100, Principal.equal, Principal.hash);
  transient var user_setting_swap_slippage_tolerance : HashMap.HashMap<Principal, Float> = HashMap.HashMap<Principal, Float>(100, Principal.equal, Principal.hash);
  transient var user_setting_always_show_remove_token : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_denomination_token : HashMap.HashMap<Principal, Text> = HashMap.HashMap<Principal, Text>(100, Principal.equal, Principal.hash);
  transient var user_setting_notify_replies : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_notify_tips : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_notify_messages : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_notify_collectibles : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_notify_votable_proposals : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_notify_outdated_bots : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_notify_low_cycles : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_notify_bot_chores : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_notify_bot_log_errors : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_notify_bot_log_warnings : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);
  transient var user_setting_notify_updates : HashMap.HashMap<Principal, Bool> = HashMap.HashMap<Principal, Bool>(100, Principal.equal, Principal.hash);

  // Per-user per-canister last-seen log ID
  transient var user_last_seen_log_id : HashMap.HashMap<Principal, HashMap.HashMap<Principal, Nat>> = HashMap.HashMap<Principal, HashMap.HashMap<Principal, Nat>>(100, Principal.equal, Principal.hash);

  // Add after other runtime variables
  private transient var blacklisted_words = HashMap.fromIter<Text, Bool>(
    stable_blacklisted_words.vals(),
    0,
    Text.equal,
    Text.hash
  );

  // Runtime storage for bans
  private transient var ban_log = Buffer.Buffer<BanLogEntry>(0);
  private transient var banned_users = HashMap.HashMap<Principal, Int>(0, Principal.equal, Principal.hash);

  // Runtime hashmaps for principal names and nicknames
  transient var principal_names = HashMap.HashMap<Principal, (Text, Bool)>(100, Principal.equal, Principal.hash);
  // Avatar image per principal: an https URL or a data:image URL, set by the principal itself
  transient var avatars = HashMap.HashMap<Principal, Text>(100, Principal.equal, Principal.hash);
  transient var principal_nicknames = HashMap.HashMap<Principal, HashMap.HashMap<Principal, Text>>(100, Principal.equal, Principal.hash);

  // Runtime storage for partners
  private transient var partners = Buffer.Buffer<Partner>(0);
  private transient var next_partner_id : Nat = 1;

  // Runtime storage for projects
  private transient var projects = Buffer.Buffer<Project>(0);
  private transient var next_project_id : Nat = 1;

  // Runtime storage for jailbreak configs (user -> configs)
  private transient var jailbreak_configs = HashMap.HashMap<Principal, Buffer.Buffer<JailbreakConfig>>(100, Principal.equal, Principal.hash);
  private transient var next_jailbreak_config_id : Nat = 1;
  
  // Runtime storage for jailbreak payment logs
  private transient var jailbreak_payment_logs = Buffer.Buffer<JailbreakPaymentLog>(100);
  private transient var next_jailbreak_payment_log_id : Nat = 1;

  // ephemeral state
  transient let state : State = object { 
    // initialize as empty here, see postupgrade for how to populate from stable memory
    public let principal_swap_canisters: HashMap.HashMap<Principal, List.List<Principal>> = HashMap.HashMap<Principal, List.List<Principal>>(100, Principal.equal, Principal.hash);
    public let principal_ledger_canisters: HashMap.HashMap<Principal, List.List<Principal>> = HashMap.HashMap<Principal, List.List<Principal>>(100, Principal.equal, Principal.hash);
    public let principal_tracked_canisters: HashMap.HashMap<Principal, List.List<Principal>> = HashMap.HashMap<Principal, List.List<Principal>>(100, Principal.equal, Principal.hash);
  };
  
  // Canister groups storage (separate from state object for simpler management)
  private transient let principal_canister_groups: HashMap.HashMap<Principal, CanisterGroupsRoot> = HashMap.HashMap<Principal, CanisterGroupsRoot>(100, Principal.equal, Principal.hash);

  // Wallet layout storage - user's preferred ordering for wallet sections
  private transient let principal_wallet_layouts: T.PrincipalWalletLayoutMap = HashMap.HashMap<Principal, WalletLayout>(100, Principal.equal, Principal.hash);

  // SwapRunner actor
  // Only the fields we use: Candid lets a record with more fields decode into this.
  type IcpSwapListToken = { canisterId : Text; decimals : Nat; fee : Nat; name : Text; symbol : Text; standard : Text };
  transient let icpswap_token_list = actor(ICPSWAP_TOKEN_LIST_CANISTER_ID) : actor {
    getList : shared query () -> async { #ok : [IcpSwapListToken]; #err : Text };
  };
  /// A canister id in text form, or null if it does not look like one (no trap).
  func principal_from_canister_text(t : Text) : ?Principal {
    if (t.size() != 27) { return null };
    for (c in t.chars()) { if (not (c == '-' or (c >= 'a' and c <= 'z') or (c >= '2' and c <= '7'))) { return null } };
    ?Principal.fromText(t);
  };

  // ---- ICRC-3 activity log (spec/backend_icrc3.md; library src/icrc3) ----
  // Money (jailbreak payments, deposit withdrawals, admin token and position transfers, verified
  // donations), moderation (bans, unbans, avatars cleared by admins) and every admin change of the
  // admin list, the directories and the configuration. Users' private data (settings, nicknames,
  // jailbreak targets, feedback), ordinary reads and refused calls are not logged. Enhanced
  // orthogonal persistence: these are new stable variables, so an upgrade starts an empty log.
  var icrc3 : Icrc3Log.State = Icrc3Log.init();
  transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();
  // operational messages of the log (spills, archive creation, failures): public, get_log
  let icrc3_textlog : TextLog.State = TextLog.init();

  transient let SNEED_SNS_ROOT : Principal = Principal.fromText("fp274-iaaaa-aaaaq-aacha-cai");

  transient let icrc3_catalogue : Icrc3Log.Config = {
    block_types_url = "https://app.sneeddao.com/api/app_sneeddao_backend#block-types";
    block_types = [
      "sneedbackend_jailbreak_payment",
      "sneedbackend_deposit_withdraw",
      "sneedbackend_send_tokens",
      "sneedbackend_transfer_position",
      "sneedbackend_donation",
      "sneedbackend_donation_hidden",
      "sneedbackend_ban",
      "sneedbackend_unban",
      "sneedbackend_avatar_clear",
      "sneedbackend_admin_add",
      "sneedbackend_admin_remove",
      "sneedbackend_partner_add",
      "sneedbackend_partner_update",
      "sneedbackend_partner_remove",
      "sneedbackend_project_add",
      "sneedbackend_project_update",
      "sneedbackend_project_remove",
      "sneedbackend_config_update",
    ];
  };

  func icrc3_env() : Icrc3Log.Environment {
    {
      self = this_canister_id();
      archive_controllers = [SNEED_SNS_ROOT]; // added next to the backend on every archive
      cycle_reserve = 2_000_000_000_000; // never spend the backend's balance below 2 T
      new_correlation_id = func() : Nat = TextLog.correlationId(icrc3_textlog);
      log_info = func(cid : Nat, m : Text) = TextLog.add(icrc3_textlog, #info, cid, this_canister_id(), m);
      log_error = func(cid : Nat, m : Text) = TextLog.add(icrc3_textlog, #error, cid, this_canister_id(), m);
    };
  };

  /// Appends one block: `sneedbackend_<btype>`, with the calling principal first.
  func block(btype : Text, caller : Principal, tx : [(Text, T3.Value)]) {
    ignore Icrc3Log.append(icrc3, "sneedbackend_" # btype, Int.abs(Time.now()), Array.append<(Text, T3.Value)>([("caller", Icrc3Log.principal(caller))], tx));
  };

  /// A setting changed: its key, the old and the new value.
  func configBlock(caller : Principal, key : Text, old : T3.Value, value : T3.Value) {
    block("config_update", caller, [("key", #Text(key)), ("old_value", old), ("value", value)]);
  };

  func natConfig(caller : Principal, key : Text, old : Nat, value : Nat) {
    if (old != value) configBlock(caller, key, #Nat(old), #Nat(value));
  };

  func pv(p : Principal) : T3.Value = Icrc3Log.principal(p);
  func sha(t : Text) : T3.Value = #Blob(Sha256.fromBlob(#sha256, Text.encodeUtf8(t)));
  func optPrincipalValue(p : ?Principal) : T3.Value = switch p { case (?x) pv(x); case null #Text("none") };
  func optNatValue(n : ?Nat) : T3.Value = switch n { case (?x) #Nat(x); case null #Text("none") };
  func accountValue(owner : Principal, sub : ?Blob) : T3.Value = Icrc3Log.account(owner, sub);
  func principalsValue(ps : [Principal]) : T3.Value = #Array(Array.map<Principal, T3.Value>(ps, pv));
  func flag(b : Bool) : T3.Value = #Nat(if b 1 else 0);

  func linksValue(links : [{ title : Text; url : Text }]) : T3.Value {
    #Array(Array.map<{ title : Text; url : Text }, T3.Value>(links, func(l) = #Map([("title", #Text(l.title)), ("url", #Text(l.url))])));
  };
  func optIndex(index : ?Nat) : [(Text, T3.Value)] = switch index { case (?i) [("index", #Nat(i))]; case null [] };

  /// A partner as logged: name and links as text (short and public), logo and description as SHA-256.
  func partnerValue(p : Partner) : T3.Value {
    #Map(Array.append<(Text, T3.Value)>([
      ("name", #Text(p.name)), ("logo_url_sha256", sha(p.logo_url)), ("description_sha256", sha(p.description)), ("links", linksValue(p.links)),
    ], optIndex(p.index)));
  };

  func projectTypeText(t : ProjectType) : Text = switch t { case (#product) "product"; case (#project) "project"; case (#fork) "fork" };

  func projectValue(p : Project) : T3.Value {
    let logo : [(Text, T3.Value)] = switch (p.logo_url) { case (?u) [("logo_url_sha256", sha(u))]; case null [] };
    #Map(Array.flatten<(Text, T3.Value)>([
      [("name", #Text(p.name)), ("project_type", #Text(projectTypeText(p.project_type))), ("description_sha256", sha(p.description)), ("links", linksValue(p.links))],
      logo,
      optIndex(p.index),
    ]));
  };

  func sameLinks(a : [{ title : Text; url : Text }], b : [{ title : Text; url : Text }]) : Bool {
    Array.equal<{ title : Text; url : Text }>(a, b, func(x, y) = x.title == y.title and x.url == y.url);
  };

  func whitelistedTokenValue(t : WhitelistedToken) : T3.Value {
    #Map([("symbol", #Text(t.symbol)), ("name", #Text(t.name)), ("decimals", #Nat(Nat8.toNat(t.decimals))), ("fee", #Nat(t.fee)), ("standard", #Text(t.standard))]);
  };

  /// Where jailbreak fees go: the configured account, or `none` (the backend's own default account).
  func jailbreakFeeRecipientValue() : T3.Value {
    switch (stable_jailbreak_fee_account_owner) {
      case (?o) accountValue(o, stable_jailbreak_fee_account_subaccount);
      case null #Text("none");
    };
  };
  func jailbreakFeeRecipientKey() : (?Principal, ?Blob) {
    switch (stable_jailbreak_fee_account_owner) {
      case (?o) (?o, stable_jailbreak_fee_account_subaccount);
      case null (null, null);
    };
  };

  func donationAccountValue(a : ?Donations.Account) : T3.Value {
    switch a { case (?x) accountValue(x.owner, x.subaccount); case null #Text("none") };
  };

  // ICRC-3 interface (spec/backend_icrc3.md)
  public query func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult { Icrc3Log.getBlocks(icrc3, args) };
  public query func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult { Icrc3Log.getArchives(icrc3, args) };
  public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate { Icrc3Log.tipCertificate(icrc3) };
  public query func icrc3_supported_block_types() : async [T3.BlockType] { Icrc3Log.supportedBlockTypes(icrc3_catalogue) };
  public query func icrc10_supported_standards() : async [T3.SupportedStandard] { Icrc3Log.supportedStandards() };
  public query func icrc3_log_status() : async T3.LogStatus { Icrc3Log.status(icrc3, icrc3_rt) };

  public shared ({ caller }) func admin_set_icrc3_settings(u : T3.SettingsUpdate) : async { #Ok : T3.Settings; #Err : Text } {
    if (not is_admin(caller)) return #Err("Admins only");
    switch (Icrc3Log.applySettings(icrc3, u)) {
      case (#Err(e)) #Err(e);
      case (#Ok(changes)) {
        for ((key, old, new) in changes.vals()) configBlock(caller, key, #Nat(old), #Nat(new));
        #Ok(icrc3.settings);
      };
    };
  };

  public shared ({ caller }) func admin_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
    if (not is_admin(caller)) return #Err("Admins only");
    if (icrc3_rt.spilling) return #Err("A spill is already in progress");
    #Ok(await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), true));
  };

  public shared ({ caller }) func admin_icrc3_repair_archive_controllers() : async [(Principal, { #Ok; #Err : Text })] {
    if (not is_admin(caller)) Debug.trap("Admins only");
    await* Icrc3Log.repairArchiveControllers(icrc3, icrc3_env());
  };

  /// The log's operational messages (spills, archives created, failures), oldest first. Public:
  /// they hold no user data.
  public query func get_log(start : Nat, length : Nat) : async [NT.LogEntry] {
    TextLog.get(icrc3_textlog, start, length);
  };

  func icrc3_timer_job() : async () { ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false) };
  func ensure_icrc3_timer<system>() { Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job) };

  // Admin management functions
  public shared ({ caller }) func add_admin(principal: Principal) : async () {
    assert(is_admin(caller));
    if (admins.get(principal) == null) {
      admins.put(principal, true);
      block("admin_add", caller, [("principal", pv(principal))]);
    };
  };

  public shared ({ caller }) func remove_admin(principal: Principal) : async () {
    assert(is_admin(caller) and principal != deployer.caller);
    switch (admins.remove(principal)) {
      case (?_) block("admin_remove", caller, [("principal", pv(principal))]);
      case null {};
    };
  };

  public query func get_admins() : async [Principal] {
    Iter.toArray(admins.keys());
  };

  func is_admin(principal: Principal) : Bool {
    if (Principal.isAnonymous(principal)) {
      return false;
    };
    if (principal == deployer.caller) {
      return true;
    };
    if (Principal.isController(principal)) {
      return true;
    };
    switch (admins.get(principal)) {
      case (?_) true;
      case null false;
    };
  };

  // Add public query function for admin check
  public query ({ caller }) func caller_is_admin() : async Bool {
    is_admin(caller)
  };

  // Helper function to check if a user is a Sneed Premium member
  private func is_premium_member(user : Principal) : async* Bool {
    switch (stable_sneed_premium_canister_id) {
      case (?canister_id) {
        try {
          await* PremiumClient.isPremium(stable_premium_cache, canister_id, user);
        } catch (e) {
          // If check fails, default to non-premium
          false
        };
      };
      case null {
        // No premium canister configured
        false
      };
    };
  };

  // Get effective nickname limits based on premium status
  private func get_nickname_limits(user : Principal) : async* (Nat, Nat) {
    let is_premium = await* is_premium_member(user);
    if (is_premium) {
      (stable_premium_max_neuron_nicknames, stable_premium_max_principal_nicknames)
    } else {
      (stable_max_neuron_nicknames, stable_max_principal_nicknames)
    }
  };

  // User settings helpers
  private func get_user_settings(user : Principal) : UserSettings {
    {
      principal_color_coding = switch (user_setting_principal_color_coding.get(user)) {
        case (?value) value;
        case null default_principal_color_coding;
      };
      neuron_color_coding = switch (user_setting_neuron_color_coding.get(user)) {
        case (?value) value;
        case null default_neuron_color_coding;
      };
      show_vp_bar = switch (user_setting_show_vp_bar.get(user)) {
        case (?value) value;
        case null default_show_vp_bar;
      };
      show_header_notifications = switch (user_setting_show_header_notifications.get(user)) {
        case (?value) value;
        case null default_show_header_notifications;
      };
      collectibles_threshold = switch (user_setting_collectibles_threshold.get(user)) {
        case (?value) value;
        case null default_collectibles_threshold;
      };
      expand_quick_links_on_desktop = switch (user_setting_expand_quick_links_on_desktop.get(user)) {
        case (?value) value;
        case null default_expand_quick_links_on_desktop;
      };
      particle_effects_enabled = switch (user_setting_particle_effects_enabled.get(user)) {
        case (?value) value;
        case null default_particle_effects_enabled;
      };
      neuron_manager_cycle_threshold_red = switch (user_setting_neuron_manager_cycle_threshold_red.get(user)) {
        case (?value) value;
        case null default_cycle_threshold_red;
      };
      neuron_manager_cycle_threshold_orange = switch (user_setting_neuron_manager_cycle_threshold_orange.get(user)) {
        case (?value) value;
        case null default_cycle_threshold_orange;
      };
      canister_manager_cycle_threshold_red = switch (user_setting_canister_manager_cycle_threshold_red.get(user)) {
        case (?value) value;
        case null default_cycle_threshold_red;
      };
      canister_manager_cycle_threshold_orange = switch (user_setting_canister_manager_cycle_threshold_orange.get(user)) {
        case (?value) value;
        case null default_cycle_threshold_orange;
      };
      frontend_auto_update_enabled = switch (user_setting_frontend_auto_update_enabled.get(user)) {
        case (?value) value;
        case null default_frontend_auto_update_enabled;
      };
      frontend_clear_cache_on_update = switch (user_setting_frontend_clear_cache_on_update.get(user)) {
        case (?value) value;
        case null default_frontend_clear_cache_on_update;
      };
      frontend_update_check_interval_sec = switch (user_setting_frontend_update_check_interval_sec.get(user)) {
        case (?value) value;
        case null default_frontend_update_check_interval_sec;
      };
      frontend_update_countdown_sec = switch (user_setting_frontend_update_countdown_sec.get(user)) {
        case (?value) value;
        case null default_frontend_update_countdown_sec;
      };
      swap_slippage_tolerance = switch (user_setting_swap_slippage_tolerance.get(user)) {
        case (?value) value;
        case null default_swap_slippage_tolerance;
      };
      always_show_remove_token = switch (user_setting_always_show_remove_token.get(user)) {
        case (?value) value;
        case null default_always_show_remove_token;
      };
      denomination_token = switch (user_setting_denomination_token.get(user)) {
        case (?value) value;
        case null default_denomination_token;
      };
      notify_replies = switch (user_setting_notify_replies.get(user)) {
        case (?value) value;
        case null default_notify_replies;
      };
      notify_tips = switch (user_setting_notify_tips.get(user)) {
        case (?value) value;
        case null default_notify_tips;
      };
      notify_messages = switch (user_setting_notify_messages.get(user)) {
        case (?value) value;
        case null default_notify_messages;
      };
      notify_collectibles = switch (user_setting_notify_collectibles.get(user)) {
        case (?value) value;
        case null default_notify_collectibles;
      };
      notify_votable_proposals = switch (user_setting_notify_votable_proposals.get(user)) {
        case (?value) value;
        case null default_notify_votable_proposals;
      };
      notify_outdated_bots = switch (user_setting_notify_outdated_bots.get(user)) {
        case (?value) value;
        case null default_notify_outdated_bots;
      };
      notify_low_cycles = switch (user_setting_notify_low_cycles.get(user)) {
        case (?value) value;
        case null default_notify_low_cycles;
      };
      notify_bot_chores = switch (user_setting_notify_bot_chores.get(user)) {
        case (?value) value;
        case null default_notify_bot_chores;
      };
      notify_bot_log_errors = switch (user_setting_notify_bot_log_errors.get(user)) {
        case (?value) value;
        case null default_notify_bot_log_errors;
      };
      notify_bot_log_warnings = switch (user_setting_notify_bot_log_warnings.get(user)) {
        case (?value) value;
        case null default_notify_bot_log_warnings;
      };
      notify_updates = switch (user_setting_notify_updates.get(user)) {
        case (?value) value;
        case null default_notify_updates;
      };
    }
  };

  private func apply_user_settings_update(user : Principal, update : UserSettingsUpdate) {
    switch (update.principal_color_coding) {
      case (?value) { user_setting_principal_color_coding.put(user, value) };
      case null {};
    };
    switch (update.neuron_color_coding) {
      case (?value) { user_setting_neuron_color_coding.put(user, value) };
      case null {};
    };
    switch (update.show_vp_bar) {
      case (?value) { user_setting_show_vp_bar.put(user, value) };
      case null {};
    };
    switch (update.show_header_notifications) {
      case (?value) { user_setting_show_header_notifications.put(user, value) };
      case null {};
    };
    switch (update.collectibles_threshold) {
      case (?value) { user_setting_collectibles_threshold.put(user, value) };
      case null {};
    };
    switch (update.expand_quick_links_on_desktop) {
      case (?value) { user_setting_expand_quick_links_on_desktop.put(user, value) };
      case null {};
    };
    switch (update.particle_effects_enabled) {
      case (?value) { user_setting_particle_effects_enabled.put(user, value) };
      case null {};
    };
    switch (update.neuron_manager_cycle_threshold_red) {
      case (?value) { user_setting_neuron_manager_cycle_threshold_red.put(user, value) };
      case null {};
    };
    switch (update.neuron_manager_cycle_threshold_orange) {
      case (?value) { user_setting_neuron_manager_cycle_threshold_orange.put(user, value) };
      case null {};
    };
    switch (update.canister_manager_cycle_threshold_red) {
      case (?value) { user_setting_canister_manager_cycle_threshold_red.put(user, value) };
      case null {};
    };
    switch (update.canister_manager_cycle_threshold_orange) {
      case (?value) { user_setting_canister_manager_cycle_threshold_orange.put(user, value) };
      case null {};
    };
    switch (update.frontend_auto_update_enabled) {
      case (?value) { user_setting_frontend_auto_update_enabled.put(user, value) };
      case null {};
    };
    switch (update.frontend_clear_cache_on_update) {
      case (?value) { user_setting_frontend_clear_cache_on_update.put(user, value) };
      case null {};
    };
    switch (update.frontend_update_check_interval_sec) {
      case (?value) { user_setting_frontend_update_check_interval_sec.put(user, value) };
      case null {};
    };
    switch (update.frontend_update_countdown_sec) {
      case (?value) { user_setting_frontend_update_countdown_sec.put(user, value) };
      case null {};
    };
    switch (update.swap_slippage_tolerance) {
      case (?value) { user_setting_swap_slippage_tolerance.put(user, value) };
      case null {};
    };
    switch (update.always_show_remove_token) {
      case (?value) { user_setting_always_show_remove_token.put(user, value) };
      case null {};
    };
    switch (update.denomination_token) {
      case (?value) { user_setting_denomination_token.put(user, value) };
      case null {};
    };
    switch (update.notify_replies) {
      case (?value) { user_setting_notify_replies.put(user, value) };
      case null {};
    };
    switch (update.notify_tips) {
      case (?value) { user_setting_notify_tips.put(user, value) };
      case null {};
    };
    switch (update.notify_messages) {
      case (?value) { user_setting_notify_messages.put(user, value) };
      case null {};
    };
    switch (update.notify_collectibles) {
      case (?value) { user_setting_notify_collectibles.put(user, value) };
      case null {};
    };
    switch (update.notify_votable_proposals) {
      case (?value) { user_setting_notify_votable_proposals.put(user, value) };
      case null {};
    };
    switch (update.notify_outdated_bots) {
      case (?value) { user_setting_notify_outdated_bots.put(user, value) };
      case null {};
    };
    switch (update.notify_low_cycles) {
      case (?value) { user_setting_notify_low_cycles.put(user, value) };
      case null {};
    };
    switch (update.notify_bot_chores) {
      case (?value) { user_setting_notify_bot_chores.put(user, value) };
      case null {};
    };
    switch (update.notify_bot_log_errors) {
      case (?value) { user_setting_notify_bot_log_errors.put(user, value) };
      case null {};
    };
    switch (update.notify_bot_log_warnings) {
      case (?value) { user_setting_notify_bot_log_warnings.put(user, value) };
      case null {};
    };
    switch (update.notify_updates) {
      case (?value) { user_setting_notify_updates.put(user, value) };
      case null {};
    };
  };

  // User settings endpoints
  public query ({ caller }) func get_my_settings() : async UserSettings {
    if (Principal.isAnonymous(caller)) {
      return {
        principal_color_coding = default_principal_color_coding;
        neuron_color_coding = default_neuron_color_coding;
        show_vp_bar = default_show_vp_bar;
        show_header_notifications = default_show_header_notifications;
        collectibles_threshold = default_collectibles_threshold;
        expand_quick_links_on_desktop = default_expand_quick_links_on_desktop;
        particle_effects_enabled = default_particle_effects_enabled;
        neuron_manager_cycle_threshold_red = default_cycle_threshold_red;
        neuron_manager_cycle_threshold_orange = default_cycle_threshold_orange;
        canister_manager_cycle_threshold_red = default_cycle_threshold_red;
        canister_manager_cycle_threshold_orange = default_cycle_threshold_orange;
        frontend_auto_update_enabled = default_frontend_auto_update_enabled;
        frontend_clear_cache_on_update = default_frontend_clear_cache_on_update;
        frontend_update_check_interval_sec = default_frontend_update_check_interval_sec;
        frontend_update_countdown_sec = default_frontend_update_countdown_sec;
        swap_slippage_tolerance = default_swap_slippage_tolerance;
        always_show_remove_token = default_always_show_remove_token;
        denomination_token = default_denomination_token;
        notify_replies = default_notify_replies;
        notify_tips = default_notify_tips;
        notify_messages = default_notify_messages;
        notify_collectibles = default_notify_collectibles;
        notify_votable_proposals = default_notify_votable_proposals;
        notify_outdated_bots = default_notify_outdated_bots;
        notify_low_cycles = default_notify_low_cycles;
        notify_bot_chores = default_notify_bot_chores;
        notify_bot_log_errors = default_notify_bot_log_errors;
        notify_bot_log_warnings = default_notify_bot_log_warnings;
        notify_updates = default_notify_updates;
      };
    };
    get_user_settings(caller)
  };

  public shared ({ caller }) func set_my_settings(update : UserSettingsUpdate) : async Result.Result<UserSettings, Text> {
    if (Principal.isAnonymous(caller)) {
      return #err("Anonymous caller not allowed");
    };
    apply_user_settings_update(caller, update);
    #ok(get_user_settings(caller))
  };

  // Bot log alert last-seen tracking (per user, per canister/bot)
  public query ({ caller }) func get_last_seen_log_id(canister_id : Principal) : async Nat {
    if (Principal.isAnonymous(caller)) { return 0 };
    switch (user_last_seen_log_id.get(caller)) {
      case (?inner) {
        switch (inner.get(canister_id)) {
          case (?id) id;
          case null 0;
        };
      };
      case null 0;
    };
  };

  public query ({ caller }) func get_all_last_seen_log_ids() : async [(Principal, Nat)] {
    if (Principal.isAnonymous(caller)) { return [] };
    switch (user_last_seen_log_id.get(caller)) {
      case (?inner) Iter.toArray(inner.entries());
      case null [];
    };
  };

  public shared ({ caller }) func mark_logs_seen(canister_id : Principal, log_id : Nat) : async () {
    if (Principal.isAnonymous(caller)) { return };
    let inner = switch (user_last_seen_log_id.get(caller)) {
      case (?existing) existing;
      case null {
        let newMap = HashMap.HashMap<Principal, Nat>(10, Principal.equal, Principal.hash);
        user_last_seen_log_id.put(caller, newMap);
        newMap;
      };
    };
    let current = switch (inner.get(canister_id)) {
      case (?existing) existing;
      case null 0;
    };
    inner.put(canister_id, Nat.max(current, log_id));
  };

  // Helper functions for counting canister groups
  private func count_groups_recursive(groups : [CanisterGroup]) : Nat {
    var count : Nat = 0;
    for (group in groups.vals()) {
      count += 1; // Count this group
      count += count_groups_recursive(group.subgroups); // Count nested groups
    };
    count
  };

  private func count_canisters_recursive(groups : [CanisterGroup]) : Nat {
    var count : Nat = 0;
    for (group in groups.vals()) {
      count += group.canisters.size(); // Count canisters in this group
      count += count_canisters_recursive(group.subgroups); // Count canisters in nested groups
    };
    count
  };

  private func find_max_canisters_in_single_group(groups : [CanisterGroup]) : Nat {
    var max_count : Nat = 0;
    for (group in groups.vals()) {
      let this_count = group.canisters.size();
      if (this_count > max_count) {
        max_count := this_count;
      };
      // Check nested groups too
      let nested_max = find_max_canisters_in_single_group(group.subgroups);
      if (nested_max > max_count) {
        max_count := nested_max;
      };
    };
    max_count
  };

  // Get effective canister group limits based on premium status
  private func get_canister_group_limits(user : Principal) : async* (Nat, Nat, Nat) {
    let is_premium = await* is_premium_member(user);
    if (is_premium) {
      (stable_premium_max_canister_groups, stable_premium_max_canisters_per_group, stable_premium_max_total_grouped_canisters)
    } else {
      (stable_max_canister_groups, stable_max_canisters_per_group, stable_max_total_grouped_canisters)
    }
  };

  // Whitelist management functions
  public shared ({ caller }) func add_whitelisted_token(token: WhitelistedToken) : async () {
    // Only allow the deployer to add whitelisted tokens
    assert(is_admin(caller));
    let old = whitelisted_tokens.get(token.ledger_id);
    whitelisted_tokens.put(token.ledger_id, token);
    switch (old) {
      case (?o) if (o != token) tokenBlock(caller, token.ledger_id, ?whitelistedTokenValue(o), whitelistedTokenValue(token));
      case null tokenBlock(caller, token.ledger_id, null, whitelistedTokenValue(token));
    };
  };

  /// A whitelist entry added, changed (`old_value`) or removed (value `removed`) by an admin.
  func tokenBlock(caller : Principal, ledger : Principal, old : ?T3.Value, value : T3.Value) {
    let base : [(Text, T3.Value)] = [("key", #Text("whitelisted_token")), ("ledger", pv(ledger)), ("value", value)];
    block("config_update", caller, switch old { case (?o) Array.append(base, [("old_value", o)]); case null base });
  };

  public shared ({ caller }) func remove_whitelisted_token(ledger_id: Principal) : async () {
    assert(is_admin(caller));
    switch (whitelisted_tokens.remove(ledger_id)) {
      case (?o) tokenBlock(caller, ledger_id, ?whitelistedTokenValue(o), #Text("removed"));
      case null {};
    };
  };

  public query func get_whitelisted_tokens() : async [WhitelistedToken] {
    Iter.toArray(whitelisted_tokens.vals());
  };

  public query func is_token_whitelisted(ledger_id: Principal) : async Bool {
    whitelisted_tokens.get(ledger_id) != null;
  };

  public query func get_cached_token_meta(swap_canister_id : Principal) : async ?T.TokenMeta { 
    cached_token_meta.get(swap_canister_id); 
  };

  // Any signed-in user may fill an empty cache entry (the frontend fills it from users' browsers);
  // only admins may overwrite an existing entry with different data. Refused writes are ignored
  // silently (no trap) so callers' metadata lookups keep working.
  public shared ({ caller }) func set_cached_token_meta(swap_canister_id : Principal, new_token_meta : T.TokenMeta) : async () {
    if (Principal.isAnonymous(caller)) { return; };
    switch (cached_token_meta.get(swap_canister_id)) {
      case (?existing) {
        if (existing == new_token_meta or not is_admin(caller)) { return; };
      };
      case null {
        if (is_banned(caller)) { return; };
      };
    };
    cached_token_meta.put(swap_canister_id, new_token_meta);
  };

  public shared ({ caller }) func register_swap_canister_id(icrc1_swap_canister_id : Principal) : async () {
    let principal = caller;
    if (Principal.isAnonymous(principal)) {
      return; 
    };

    let swapCanisters = switch (state.principal_swap_canisters.get(principal)) {
      case (?existingSwapCanisters) existingSwapCanisters;
      case _ List.nil<Principal>();
    };

    if (List.some<Principal>(swapCanisters, func swapCanister { swapCanister == icrc1_swap_canister_id; } )) {
      return;
    };

    let newSwapCanisters = List.push<Principal>(icrc1_swap_canister_id, swapCanisters);
    state.principal_swap_canisters.put(principal, newSwapCanisters);
  };

  public shared ({ caller }) func unregister_swap_canister_id(icrc1_swap_canister_id : Principal) : async () {
    let principal = caller;
    if (Principal.isAnonymous(principal)) {
      return; 
    };

    let swapCanisters = switch (state.principal_swap_canisters.get(principal)) {
      case (?existingSwapCanisters) existingSwapCanisters;
      case _ List.nil<Principal>();
    };

    let newSwapCanisters = List.filter<Principal>(swapCanisters, func test_swap_canister { test_swap_canister != icrc1_swap_canister_id; });
    state.principal_swap_canisters.put(principal, newSwapCanisters);
  };

  public shared ({ caller }) func register_ledger_canister_id(icrc1_ledger_canister_id : Principal) : async () {
    let principal = caller;
    if (Principal.isAnonymous(principal)) {
      return; 
    };

    let ledgerCanisters = switch (state.principal_ledger_canisters.get(principal)) {
      case (?existingLedgerCanisters) existingLedgerCanisters;
      case _ List.nil<Principal>();
    };

    if (List.some<Principal>(ledgerCanisters, func ledgerCanister { ledgerCanister == icrc1_ledger_canister_id; } )) {
      return;
    };

    let newLedgerCanisters = List.push<Principal>(icrc1_ledger_canister_id, ledgerCanisters);
    state.principal_ledger_canisters.put(principal, newLedgerCanisters);
  };

  public shared ({ caller }) func unregister_ledger_canister_id(icrc1_ledger_canister_id : Principal) : async () {
    let principal = caller;
    if (Principal.isAnonymous(principal)) {
      return; 
    };

    let ledgerCanisters = switch (state.principal_ledger_canisters.get(principal)) {
      case (?existingLedgerCanisters) existingLedgerCanisters;
      case _ List.nil<Principal>();
    };

    let newLedgerCanisters = List.filter<Principal>(ledgerCanisters, func test_ledger_canister { test_ledger_canister != icrc1_ledger_canister_id; });
    state.principal_ledger_canisters.put(principal, newLedgerCanisters);
  };

  public query ({ caller }) func get_swap_canister_ids() : async [Principal] {
    let principal = caller;
    switch (state.principal_swap_canisters.get(principal)) {
      case (?existingSwapCanisters) List.toArray<Principal>(existingSwapCanisters);
      case _ [] : [Principal];
    };
  };

  public query ({ caller }) func get_ledger_canister_ids() : async [Principal] {
    let principal = caller;
    switch (state.principal_ledger_canisters.get(principal)) {
      case (?existingLedgerCanisters) List.toArray<Principal>(existingLedgerCanisters);
      case _ [] : [Principal];
    };
  };

  // Tracked canisters - for users to track arbitrary canisters
  public shared ({ caller }) func register_tracked_canister(canister_id : Principal) : async () {
    let principal = caller;
    if (Principal.isAnonymous(principal)) {
      return; 
    };

    let trackedCanisters = switch (state.principal_tracked_canisters.get(principal)) {
      case (?existingTrackedCanisters) existingTrackedCanisters;
      case _ List.nil<Principal>();
    };

    // Check if already tracked (dedup)
    if (List.some<Principal>(trackedCanisters, func trackedCanister { trackedCanister == canister_id; } )) {
      return;
    };

    let newTrackedCanisters = List.push<Principal>(canister_id, trackedCanisters);
    state.principal_tracked_canisters.put(principal, newTrackedCanisters);
  };

  public shared ({ caller }) func unregister_tracked_canister(canister_id : Principal) : async () {
    let principal = caller;
    if (Principal.isAnonymous(principal)) {
      return; 
    };

    let trackedCanisters = switch (state.principal_tracked_canisters.get(principal)) {
      case (?existingTrackedCanisters) existingTrackedCanisters;
      case _ List.nil<Principal>();
    };

    let newTrackedCanisters = List.filter<Principal>(trackedCanisters, func test_canister { test_canister != canister_id; });
    state.principal_tracked_canisters.put(principal, newTrackedCanisters);
  };

  public query ({ caller }) func get_tracked_canisters() : async [Principal] {
    let principal = caller;
    switch (state.principal_tracked_canisters.get(principal)) {
      case (?existingTrackedCanisters) List.toArray<Principal>(existingTrackedCanisters);
      case _ [] : [Principal];
    };
  };
  
  // ============================================
  // USER TOKEN REGISTRATION
  // ============================================
  
  public shared ({ caller }) func register_user_token(ledger_id : Principal) : async () {
    if (Principal.isAnonymous(caller)) { return };
    
    switch (user_tokens.get(caller)) {
      case null {
        user_tokens.put(caller, [ledger_id]);
      };
      case (?existingTokens) {
        // Check if already registered (dedup)
        let alreadyExists = Array.find<Principal>(existingTokens, func(p) { Principal.equal(p, ledger_id) });
        if (alreadyExists != null) { return };
        user_tokens.put(caller, Array.append(existingTokens, [ledger_id]));
      };
    };
  };
  
  public shared ({ caller }) func unregister_user_token(ledger_id : Principal) : async () {
    if (Principal.isAnonymous(caller)) { return };
    
    switch (user_tokens.get(caller)) {
      case null { };
      case (?existingTokens) {
        let newTokens = Array.filter<Principal>(existingTokens, func(p) { not Principal.equal(p, ledger_id) });
        if (newTokens.size() == 0) {
          user_tokens.delete(caller);
        } else {
          user_tokens.put(caller, newTokens);
        };
      };
    };
  };
  
  public query ({ caller }) func get_user_tokens() : async [Principal] {
    switch (user_tokens.get(caller)) {
      case (?tokens) tokens;
      case null [] : [Principal];
    };
  };
  
  // ============================================
  // "FOR" METHODS (callable by authorized canisters like Sneedex)
  // ============================================
  
  func isAuthorizedForCaller(caller : Principal) : Bool {
    authorized_for_callers.get(caller) != null or is_admin(caller);
  };
  
  public shared ({ caller }) func add_authorized_for_caller(canister_id : Principal) : async () {
    assert(is_admin(caller));
    if (authorized_for_callers.get(canister_id) == null) {
      authorized_for_callers.put(canister_id, true);
      block("config_update", caller, [("key", #Text("authorized_for_caller_added")), ("value", pv(canister_id))]);
    };
  };
  
  public shared ({ caller }) func remove_authorized_for_caller(canister_id : Principal) : async () {
    assert(is_admin(caller));
    switch (authorized_for_callers.remove(canister_id)) {
      case (?_) block("config_update", caller, [("key", #Text("authorized_for_caller_removed")), ("value", pv(canister_id))]);
      case null {};
    };
  };
  
  public query func get_authorized_for_callers() : async [Principal] {
    Iter.toArray(authorized_for_callers.keys());
  };
  
  // Register a canister to a user's wallet (callable by authorized canisters)
  public shared ({ caller }) func register_tracked_canister_for(user : Principal, canister_id : Principal) : async () {
    if (not isAuthorizedForCaller(caller)) { return };
    if (Principal.isAnonymous(user)) { return };
    
    let trackedCanisters = switch (state.principal_tracked_canisters.get(user)) {
      case (?existingTrackedCanisters) existingTrackedCanisters;
      case _ List.nil<Principal>();
    };
    
    // Check if already tracked (dedup)
    if (List.some<Principal>(trackedCanisters, func trackedCanister { trackedCanister == canister_id; } )) {
      return;
    };
    
    let newTrackedCanisters = List.push<Principal>(canister_id, trackedCanisters);
    state.principal_tracked_canisters.put(user, newTrackedCanisters);
  };
  
  // Unregister a canister from a user's wallet (callable by authorized canisters)
  public shared ({ caller }) func unregister_tracked_canister_for(user : Principal, canister_id : Principal) : async () {
    if (not isAuthorizedForCaller(caller)) { return };
    if (Principal.isAnonymous(user)) { return };
    
    let trackedCanisters = switch (state.principal_tracked_canisters.get(user)) {
      case (?existingTrackedCanisters) existingTrackedCanisters;
      case _ List.nil<Principal>();
    };
    
    let newTrackedCanisters = List.filter<Principal>(trackedCanisters, func test_canister { test_canister != canister_id; });
    state.principal_tracked_canisters.put(user, newTrackedCanisters);
  };
  
  // Register a token to a user's wallet (callable by authorized canisters)
  public shared ({ caller }) func register_user_token_for(user : Principal, ledger_id : Principal) : async () {
    if (not isAuthorizedForCaller(caller)) { return };
    if (Principal.isAnonymous(user)) { return };
    
    switch (user_tokens.get(user)) {
      case null {
        user_tokens.put(user, [ledger_id]);
      };
      case (?existingTokens) {
        let alreadyExists = Array.find<Principal>(existingTokens, func(p) { Principal.equal(p, ledger_id) });
        if (alreadyExists != null) { return };
        user_tokens.put(user, Array.append(existingTokens, [ledger_id]));
      };
    };
  };
  
  // Unregister a token from a user's wallet (callable by authorized canisters)
  public shared ({ caller }) func unregister_user_token_for(user : Principal, ledger_id : Principal) : async () {
    if (not isAuthorizedForCaller(caller)) { return };
    if (Principal.isAnonymous(user)) { return };
    
    switch (user_tokens.get(user)) {
      case null { };
      case (?existingTokens) {
        let newTokens = Array.filter<Principal>(existingTokens, func(p) { not Principal.equal(p, ledger_id) });
        if (newTokens.size() == 0) {
          user_tokens.delete(user);
        } else {
          user_tokens.put(user, newTokens);
        };
      };
    };
  };

  // Canister Groups - hierarchical grouping of canisters
  public query ({ caller }) func get_canister_groups() : async ?CanisterGroupsRoot {
    principal_canister_groups.get(caller);
  };

  public shared ({ caller }) func set_canister_groups(groups: CanisterGroupsRoot) : async Result.Result<(), Text> {
    if (Principal.isAnonymous(caller)) {
      return #err("Anonymous users cannot save canister groups");
    };
    if (is_banned(caller)) {
      return #err("You are banned");
    };
    // Get limits based on premium status
    let (maxGroups, maxCanistersPerGroup, maxTotalCanisters) = await* get_canister_group_limits(caller);
    
    // Count totals in the submitted structure
    let totalGroups = count_groups_recursive(groups.groups);
    let totalCanisters = count_canisters_recursive(groups.groups) + groups.ungrouped.size();
    let maxInSingleGroup = find_max_canisters_in_single_group(groups.groups);
    
    // Validate limits
    if (totalGroups > maxGroups) {
      return #err("You have exceeded your maximum number of folders (" # Nat.toText(maxGroups) # "). You have " # Nat.toText(totalGroups) # " folders.");
    };
    
    if (maxInSingleGroup > maxCanistersPerGroup) {
      return #err("One of your folders contains more than " # Nat.toText(maxCanistersPerGroup) # " canisters (max per folder).");
    };
    
    if (totalCanisters > maxTotalCanisters) {
      return #err("You have exceeded your maximum total canisters (" # Nat.toText(maxTotalCanisters) # "). You have " # Nat.toText(totalCanisters) # " canisters.");
    };
    
    principal_canister_groups.put(caller, groups);
    #ok()
  };

  public shared ({ caller }) func delete_canister_groups() : async () {
    if (Principal.isAnonymous(caller)) {
      throw Error.reject("Anonymous users cannot delete canister groups");
    };
    principal_canister_groups.delete(caller);
  };

  // Wallet Layout - user's preferred ordering for wallet sections
  public query ({ caller }) func get_wallet_layout() : async ?WalletLayout {
    principal_wallet_layouts.get(caller);
  };

  public shared ({ caller }) func set_wallet_layout(layout: WalletLayout) : async () {
    if (Principal.isAnonymous(caller)) {
      throw Error.reject("Anonymous users cannot save a wallet layout");
    };
    if (is_banned(caller)) {
      throw Error.reject("You are banned");
    };
    principal_wallet_layouts.put(caller, layout);
  };

  /// Import ICPSwap's trusted token list into the whitelist (admin). Existing
  /// entries are updated, tokens added by hand are kept.
  public shared ({ caller }) func import_whitelist_from_icpswap() : async () {
    assert(is_admin(caller));
    await import_whitelist_from_icpswap_impl();
  };

  /// Kept for callers of the old name; Swaprunner is no longer involved.
  public shared ({ caller }) func import_whitelist_from_swaprunner() : async () {
    assert(is_admin(caller));
    await import_whitelist_from_icpswap_impl();
  };

  private func import_whitelist_from_icpswap_impl() : async () {
    let tokens = switch (await icpswap_token_list.getList()) {
      case (#ok(list)) { list };
      case (#err(e)) { throw Error.reject("ICPSwap token list: " # e) };
    };
    for (t in tokens.vals()) {
      switch (principal_from_canister_text(t.canisterId)) {
        case (?ledger_id) {
          if (t.decimals < 256) {
            let token : WhitelistedToken = {
              ledger_id = ledger_id;
              decimals = Nat8.fromNat(t.decimals);
              fee = t.fee;
              name = t.name;
              symbol = t.symbol;
              standard = t.standard;
            };
            whitelisted_tokens.put(ledger_id, token);
          };
        };
        case null {};
      };
    };
    token_list_last_import := Time.now();
  };

  // Helper function to parse ICRC1 metadata
  private func parseICRC1Metadata(metadata: [(Text, ICRC1MetadataValue)]) : { symbol: ?Text; name: ?Text; decimals: ?Nat8; fee: ?Nat } {
    var symbol : ?Text = null;
    var name : ?Text = null;
    var decimals : ?Nat8 = null;
    var fee : ?Nat = null;
    
    for ((key, value) in metadata.vals()) {
      switch (key, value) {
        case ("icrc1:symbol", #Text(v)) { symbol := ?v };
        case ("icrc1:name", #Text(v)) { name := ?v };
        case ("icrc1:decimals", #Nat(v)) { decimals := ?Nat8.fromNat(v) };
        case ("icrc1:fee", #Nat(v)) { fee := ?v };
        case _ {};
      };
    };
    
    { symbol; name; decimals; fee };
  };

  // Refresh metadata for a single token
  public shared ({ caller }) func refresh_token_metadata(ledger_id: Principal) : async Result.Result<WhitelistedToken, Text> {
    assert(is_admin(caller));
    
    // Create actor reference for the ledger
    let ledger = actor(Principal.toText(ledger_id)) : actor {
      icrc1_metadata : shared query () -> async [(Text, ICRC1MetadataValue)];
    };
    
    try {
      let metadata = await ledger.icrc1_metadata();
      let parsed = parseICRC1Metadata(metadata);
      
      switch (parsed.decimals, parsed.fee, parsed.name, parsed.symbol) {
        case (?decimals, ?fee, ?name, ?symbol) {
          // Determine standard - check if already whitelisted to preserve, otherwise default to ICRC1
          let existingToken = whitelisted_tokens.get(ledger_id);
          let standard = switch (existingToken) {
            case (?t) { t.standard };
            case null { "ICRC1" };
          };
          
          let token : WhitelistedToken = {
            ledger_id = ledger_id;
            decimals = decimals;
            fee = fee;
            name = name;
            symbol = symbol;
            standard = standard;
          };
          whitelisted_tokens.put(ledger_id, token);
          #ok(token);
        };
        case _ {
          #err("Failed to parse required metadata fields (symbol, name, decimals, fee)");
        };
      };
    } catch (e) {
      #err("Failed to fetch metadata: " # Error.message(e));
    };
  };

  // Query to get refresh all tokens progress
  public query func get_refresh_all_progress() : async RefreshAllProgress {
    {
      is_running = refresh_all_is_running;
      total = refresh_all_total;
      processed = refresh_all_processed;
      success = refresh_all_success;
      failed = refresh_all_failed;
      current_token = refresh_all_current_token;
      errors = Buffer.toArray(refresh_all_errors);
    };
  };

  // Start the refresh all tokens worker
  public shared ({ caller }) func start_refresh_all_token_metadata() : async Result.Result<(), Text> {
    assert(is_admin(caller));
    start_refresh_all_impl<system>();
  };

  private func start_refresh_all_impl<system>() : Result.Result<(), Text> {
    // Check if already running
    if (refresh_all_is_running) {
      return #err("Refresh is already running");
    };
    
    // Initialize state
    let tokensList = Iter.toArray(whitelisted_tokens.vals());
    if (tokensList.size() == 0) {
      return #err("No tokens to refresh");
    };
    
    refresh_all_is_running := true;
    refresh_all_total := tokensList.size();
    refresh_all_processed := 0;
    refresh_all_success := 0;
    refresh_all_failed := 0;
    refresh_all_current_token := "";
    refresh_all_errors := Buffer.Buffer<Text>(10);
    refresh_all_tokens_to_process := tokensList;
    token_list_last_refresh_started := Time.now();
    
    // Schedule the first batch with a 0-second timer
    refresh_all_timer_id := ?Timer.setTimer<system>(#seconds 0, refreshAllWorkerBatch);
    
    #ok(());
  };

  // ---- daily token list maintenance ----

  private func token_refresh_job() : async () {
    if (refresh_all_is_running) { return };
    try {
      await import_whitelist_from_icpswap_impl();
      token_list_last_error := "";
    } catch (e) {
      token_list_last_error := "whitelist import: " # Error.message(e);
    };
    switch (start_refresh_all_impl<system>()) {
      case (#ok) {};
      case (#err(msg)) { token_list_last_error := "metadata refresh: " # msg };
    };
  };

  private func ensure_token_refresh_timer<system>() {
    switch (token_refresh_timer_id) {
      case (?_) {};
      case null {
        token_refresh_timer_id := ?Timer.recurringTimer<system>(#seconds TOKEN_REFRESH_INTERVAL_SECONDS, token_refresh_job);
      };
    };
  };

  public type TokenListStatus = {
    tokens : Nat;
    interval_seconds : Nat;
    timer_scheduled : Bool;
    refresh_running : Bool;
    last_import : Int;
    last_refresh_started : Int;
    last_refresh_done : Int;
    last_error : Text;
  };

  public query func get_token_list_status() : async TokenListStatus {
    {
      tokens = whitelisted_tokens.size();
      interval_seconds = TOKEN_REFRESH_INTERVAL_SECONDS;
      timer_scheduled = token_refresh_timer_id != null;
      refresh_running = refresh_all_is_running;
      last_import = token_list_last_import;
      last_refresh_started = token_list_last_refresh_started;
      last_refresh_done = token_list_last_refresh_done;
      last_error = token_list_last_error;
    };
  };

  /// Run the daily job now (admin), without waiting for the timer.
  public shared ({ caller }) func run_token_list_maintenance_now() : async () {
    assert(is_admin(caller));
    await token_refresh_job();
  };

  // Stop the refresh all tokens worker
  public shared ({ caller }) func stop_refresh_all_token_metadata() : async () {
    assert(is_admin(caller));
    
    // Cancel the timer if running
    switch (refresh_all_timer_id) {
      case (?timerId) {
        Timer.cancelTimer(timerId);
        refresh_all_timer_id := null;
      };
      case null {};
    };
    
    refresh_all_is_running := false;
    refresh_all_current_token := "Stopped by user";
  };

  // Worker function that processes tokens in batches
  private func refreshAllWorkerBatch() : async () {
    // Batch size - process this many tokens per timer tick
    let BATCH_SIZE : Nat = 5;
    
    if (not refresh_all_is_running) {
      return;
    };
    
    let startIdx = refresh_all_processed;
    let endIdx = Nat.min(startIdx + BATCH_SIZE, refresh_all_total);
    
    // Process this batch
    var i = startIdx;
    while (i < endIdx and refresh_all_is_running) {
      let token = refresh_all_tokens_to_process[i];
      refresh_all_current_token := token.symbol # " (" # token.name # ")";
      
      let ledger = actor(Principal.toText(token.ledger_id)) : actor {
        icrc1_metadata : shared query () -> async [(Text, ICRC1MetadataValue)];
      };
      
      try {
        let metadata = await ledger.icrc1_metadata();
        let parsed = parseICRC1Metadata(metadata);
        
        switch (parsed.decimals, parsed.fee, parsed.name, parsed.symbol) {
          case (?decimals, ?fee, ?name, ?symbol) {
            let updatedToken : WhitelistedToken = {
              ledger_id = token.ledger_id;
              decimals = decimals;
              fee = fee;
              name = name;
              symbol = symbol;
              standard = token.standard;
            };
            whitelisted_tokens.put(token.ledger_id, updatedToken);
            refresh_all_success += 1;
          };
          case _ {
            refresh_all_failed += 1;
            refresh_all_errors.add(token.symbol # ": Missing required metadata fields");
          };
        };
      } catch (e) {
        refresh_all_failed += 1;
        refresh_all_errors.add(token.symbol # ": " # Error.message(e));
      };
      
      refresh_all_processed += 1;
      i += 1;
    };
    
    // Check if we're done
    if (refresh_all_processed >= refresh_all_total) {
      refresh_all_is_running := false;
      refresh_all_current_token := "Completed";
      refresh_all_timer_id := null;
      token_list_last_refresh_done := Time.now();
    } else if (refresh_all_is_running) {
      // Schedule next batch
      refresh_all_timer_id := ?Timer.setTimer<system>(#seconds 0, refreshAllWorkerBatch);
    };
  };

  public shared ({ caller }) func send_tokens(icrc1_ledger_canister_id: Principal, amount: Nat, to: Principal) : async T.TransferResult {
    assert(is_admin(caller));

    let from_subaccount = PrincipalToSubaccount(to);

    let transfer_args : T.TransferArgs = {
        from_subaccount = ?from_subaccount;
        to = {
            owner = to;
            subaccount = null;
        };
        amount = amount;
        fee = null;
        memo = null;
        created_at_time = null;
    };


    let icrc1_ledger_canister = actor (Principal.toText(icrc1_ledger_canister_id)) : actor {
        icrc1_transfer(args : T.TransferArgs) : async T.TransferResult;
    };  

    let result = await icrc1_ledger_canister.icrc1_transfer(transfer_args);
    switch (result) {
      case (#Ok(index)) block("send_tokens", caller, [
        ("ledger", pv(icrc1_ledger_canister_id)), ("from_subaccount", #Blob(Blob.fromArray(from_subaccount))),
        ("to", accountValue(to, null)), ("amount", #Nat(amount)), ("ledger_tx", #Nat(index)),
      ]);
      case (#Err(_)) {};
    };
    result;
  };

  public shared ({ caller }) func transfer_position(swap_canister_id: Principal, to: Principal, position_id: Nat) : async T.TransferPositionResult {
    assert(is_admin(caller));

    let swap_canister = actor (Principal.toText(swap_canister_id)) : actor {
        transferPosition(from : Principal, to : Principal, positionId : Nat) : async T.TransferPositionResult;
    };

    let result = await swap_canister.transferPosition(this_canister_id(), to, position_id);
    switch (result) {
      case (#ok(_)) block("transfer_position", caller, [("swap_canister", pv(swap_canister_id)), ("to", pv(to)), ("position_id", #Nat(position_id))]);
      case (#err(_)) {};
    };
    result;
  };


  private func PrincipalToSubaccount(p : Principal) : [Nat8] {
    //let a = List.nil<Nat8>();
    let pa = Principal.toBlob(p);
    let size = pa.size();
    let arr_size = if (size < 31) { 31; } else { size; };
    let a = Array.init<Nat8>(arr_size + 1, 0);
    a[0] := Nat8.fromNat(size);

    var pos = 1;
    for (x in pa.vals()) {
      a[pos] := x;
      pos := pos + 1;
    };

    Array.freeze(a);
  };

  // Helper function to get SNS governance canister from root canister
  private func get_sns_governance_canister(sns_root_canister_id : Principal) : async Principal {
    let sns_root = actor (Principal.toText(sns_root_canister_id)) : actor {
      list_sns_canisters : ({}) -> async {
        root : ?Principal;
        governance : ?Principal;
        ledger : ?Principal;
        swap : ?Principal;
        index : ?Principal;
        dapps : [Principal];
        archives : [Principal];
      };
    };
    let canisters = await sns_root.list_sns_canisters({});
    switch (canisters.governance) {
      case (?governance) { governance };
      case null { throw Error.reject("Could not find governance canister") };
    }
  };

  // Helper function to check if caller owns a neuron
  private func is_neuron_owner(caller : Principal, sns_governance_canister_id : Principal, neuron_id : NeuronId) : async Bool {
    if (is_admin(caller)) { return true; };

    let sns_governance = actor (Principal.toText(sns_governance_canister_id)) : actor {
      list_neurons : shared query ({
        of_principal : ?Principal;
        limit : Nat32;
        start_page_at : ?NeuronId;
      }) -> async {
        neurons : [{
          id : ?NeuronId;
          controller : ?Principal;
        }];
      };
    };

    let response = await sns_governance.list_neurons({
      of_principal = ?caller;
      limit = 100;
      start_page_at = null;
    });
    
    for (neuron in response.neurons.vals()) {
      switch (neuron.id) {
        case (?id) {
          if (Blob.equal(id.id, neuron_id.id)) {
            return true;
          };
        };
        case null {};
      };
    };
    false
  };

  // Helper function to check if caller is authorized to verify names
  private func can_verify_names(caller : Principal, sns_root_canister_id : Principal) : async Bool {
    if (is_admin(caller)) { return true; };
    
    // Check if caller is the SNS governance canister for this root
    let governance_canister_id = await get_sns_governance_canister(sns_root_canister_id);
    Principal.equal(caller, governance_canister_id)
  };

  // Helper function to validate name text
  private func validate_name_text(text: Text) : async* Result.Result<Bool, (Text, Text)> {
    if (text.size() > 32) {
      return #ok(false);
    };

    // Check characters
    for (char in text.chars()) {
      let isAlphanumeric = (char >= 'a' and char <= 'z') or
                          (char >= 'A' and char <= 'Z') or
                          (char >= '0' and char <= '9');
      let isSeparator = char == ' ' or char == '-' or char == '_' or char == '.' or char == '\'';
      
      if (not (isAlphanumeric or isSeparator)) {
        return #ok(false);
      };
    };

    // Check blacklist last so any other errors are caught if the blacklist is ignored by caller.
    // Check if text contains any blacklisted words (case insensitive)
    let lowercaseText = Text.toLowercase(text);
    for ((word, _) in blacklisted_words.entries()) {
      let lowercaseWord = Text.toLowercase(word);
      if (Text.contains(lowercaseText, #text lowercaseWord)) {
        // Found a blacklisted word - return it along with the full text for the ban reason
        return #err(word, text);
      };
    };

    return #ok(true);
  };

  // Helper function to check if a name is unique
  private func is_name_unique(sns_root_canister_id : Principal, name : Text, exclude_neuron : ?NeuronId) : Bool {
    for ((key, (existing_name, _)) in neuron_names.entries()) {
        if (Principal.equal(key.sns_root_canister_id, sns_root_canister_id) and 
            Text.equal(existing_name, name)) {
            // If we're excluding a neuron (e.g. when updating), check it's not that one
            switch (exclude_neuron) {
                case (?neuron_id) {
                    if (Blob.equal(key.neuron_id.id, neuron_id.id)) {
                        // Skip if this is the neuron we're updating
                        return true;
                    };
                };
                case null {};
            };
            // Found a match that's not our excluded neuron
            return false;
        };
    };
    // No matches found
    true
  };

  // Helper function to check if a user is banned
  private func is_banned(user: Principal) : Bool {
    switch (banned_users.get(user)) {
      case (?expiry) {
        let now = Time.now();
        if (now >= expiry) {
          // Ban has expired, remove it
          banned_users.delete(user);
          false
        } else {
          true
        };
      };
      case null { false };
    };
  };

  // Function to ban a user
  public shared ({ caller }) func ban_user(user: Principal, duration_hours: Nat, reason: Text) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };

    // Use the admin-specified duration directly
    await ban_user_impl(caller, user, duration_hours, reason);
  };

  public shared ({ caller }) func test_calculate_ban_duration(user: Principal) : async Nat {
    calculate_ban_duration(user)
  };

  // Helper function to calculate automatic ban duration based on ban history
  private func calculate_ban_duration(user: Principal) : Nat {
    var ban_count = 0;
    
    // Count bans (excluding unbans where timestamps are equal)
    for (entry in ban_log.vals()) {
      if (Principal.equal(entry.user, user)) {
        if (entry.ban_timestamp != entry.expiry_timestamp) {
          ban_count += 1;
        } else {
          // This is an unban entry, reduce the count
          if (ban_count > 0) {
            ban_count -= 1;
          };
        };
      };
    };

    // Ensure ban_count doesn't go negative
    let final_count : Nat = if (ban_count < 0) { 0 } else { Int.abs(ban_count) };

    // Define durations in hours
    let HOUR = 1;
    let DAY = 24;
    let WEEK = 7 * DAY;
    let MONTH = 30 * DAY;
    let YEAR = 365 * DAY;
    let CENTURY = 100 * YEAR;

    // Return duration based on ban count
    switch (final_count) {
      case 0 { HOUR };     // First ban: 1 hour
      case 1 { DAY };      // Second ban: 24 hours
      case 2 { WEEK };     // Third ban: 1 week
      case 3 { MONTH };    // Fourth ban: 1 month
      case 4 { YEAR };     // Fifth ban: 1 year
      case _ { CENTURY };  // Sixth+ ban: 100 years (permaban)
    }
  };

  // Function to ban a user with automatic duration calculation
  private func auto_ban_user(caller: Principal, user: Principal, reason: Text) : async Result.Result<(), Text> {
    // Calculate duration based on ban history
    let duration = calculate_ban_duration(user);
    await ban_user_impl(caller, user, duration, reason);
  };

  private func ban_user_impl(caller: Principal, user: Principal, duration_hours: Nat, reason: Text) : async Result.Result<(), Text> {
    if (Principal.isAnonymous(user)) {
      return #err("Cannot ban anonymous users");
    };

    if (is_admin(user)) {
      return #err("Cannot ban administrators");
    };

    let now = Time.now();
    let duration_nanos = Int.abs(duration_hours) * 3_600_000_000_000;
    let expiry = now + duration_nanos;

    // Check if user is already banned
    switch (banned_users.get(user)) {
      case (?current_expiry) {
        // Only update if new ban expires later
        if (expiry > current_expiry) {
          banned_users.put(user, expiry);
        };
      };
      case null {
        banned_users.put(user, expiry);
      };
    };

    // Add to ban log
    let entry : BanLogEntry = {
      user;
      admin = caller;
      ban_timestamp = now;
      expiry_timestamp = expiry;
      reason;
    };
    ban_log.add(entry);
    // the reason is admin-written (or holds the attempted name of an automatic ban): only its hash
    let effective = switch (banned_users.get(user)) { case (?e) e; case null expiry };
    block("ban", caller, [("user", pv(user)), ("duration_hours", #Nat(duration_hours)), ("expires_at", #Int(effective)), ("reason_sha256", sha(reason))]);

    #ok()
  };

  // Helper function to format duration in hours to human readable string
  private func format_duration(hours : Int) : Text {
    if (hours < 0) { return "0 hours" };

    let years = hours / (365 * 24);
    let remaining_after_years = hours % (365 * 24);
    
    let months = remaining_after_years / (30 * 24);
    let remaining_after_months = remaining_after_years % (30 * 24);
    
    let weeks = remaining_after_months / (7 * 24);
    let remaining_after_weeks = remaining_after_months % (7 * 24);
    
    let days = remaining_after_weeks / 24;
    let remaining_hours = remaining_after_weeks % 24;

    var parts = Buffer.Buffer<Text>(5);
    
    if (years > 0) {
      parts.add(Int.toText(years) # (if (years == 1) " year" else " years"));
    };
    if (months > 0) {
      parts.add(Int.toText(months) # (if (months == 1) " month" else " months"));
    };
    if (weeks > 0) {
      parts.add(Int.toText(weeks) # (if (weeks == 1) " week" else " weeks"));
    };
    if (days > 0) {
      parts.add(Int.toText(days) # (if (days == 1) " day" else " days"));
    };
    if (remaining_hours > 0 or parts.size() == 0) {
      parts.add(Int.toText(remaining_hours) # (if (remaining_hours == 1) " hour" else " hours"));
    };

    let parts_array = Buffer.toArray(parts);
    
    switch (parts_array.size()) {
      case 0 { "0 hours" };
      case 1 { parts_array[0] };
      case 2 { parts_array[0] # " and " # parts_array[1] };
      case _ {
        var result = "";
        for (i in Iter.range(0, parts_array.size() - 1)) {
          if (i == parts_array.size() - 1) {
            result #= "and " # parts_array[i];
          } else if (i == parts_array.size() - 2) {
            result #= parts_array[i] # " ";
          } else {
            result #= parts_array[i] # ", ";
          };
        };
        result
      };
    }
  };

  // Function to check ban status
  public query func check_ban_status(user: Principal) : async Result.Result<(), Text> {
    if (is_banned(user)) {
      switch (banned_users.get(user)) {
        case (?expiry) {
          let time_remaining = expiry - Time.now();
          if (time_remaining > 0) {
            let hours_remaining = Int.abs(time_remaining) / 3600_000_000_000;
            #err("You are banned. Ban expires in " # format_duration(hours_remaining))
          } else {
            #err("You are banned") // This shouldn't happen due to is_banned check
          };
        };
        case null {
          #err("You are banned") // This shouldn't happen due to is_banned check
        };
      };
    } else {
      #ok()
    };
  };

  // Function to get ban log
  public query ({ caller }) func get_ban_log() : async Result.Result<[BanLogEntry], Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };
    #ok(Buffer.toArray(ban_log))
  };

  // Function to get all currently banned users
  public query ({ caller }) func get_banned_users() : async Result.Result<[(Principal, Int)], Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };
    #ok(Iter.toArray(banned_users.entries()))
  };

  // Function to unban a user
  public shared ({ caller }) func unban_user(user: Principal) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };

    if (Principal.isAnonymous(user)) {
      return #err("Cannot unban anonymous users");
    };

    if (is_admin(user)) {
      return #err("Administrators cannot be banned or unbanned");
    };

    switch (banned_users.get(user)) {
      case (?_) {
        banned_users.delete(user);
        // Add unban entry to ban log
        let entry : BanLogEntry = {
          user;
          admin = caller;
          ban_timestamp = Time.now();
          expiry_timestamp = Time.now(); // Immediate expiry indicates unban
          reason = "Manual unban by administrator";
        };
        ban_log.add(entry);
        block("unban", caller, [("user", pv(user))]);
        #ok()
      };
      case null {
        #err("User is not currently banned")
      };
    }
  };

  // Neuron name management
  public shared ({ caller }) func set_neuron_name(sns_root_canister_id : Principal, neuron_id : NeuronId, name : Text) : async Result.Result<Text, Text> {
    if (stable_names_frozen) { return #err(NAMES_MOVING) };
    if (Principal.isAnonymous(caller)) {
        return #err("Anonymous caller not allowed");
    };

    // Check if user is banned
    if (is_banned(caller)) {
        switch (banned_users.get(caller)) {
            case (?expiry) {
                let time_remaining = expiry - Time.now();
                if (time_remaining > 0) {
                    let hours_remaining = Int.abs(time_remaining) / 3600_000_000_000;
                    return #err("You are banned. Ban expires in " # format_duration(hours_remaining));
                } else {
                    return #err("You are banned"); // This shouldn't happen due to is_banned check
                };
            };
            case null {
                return #err("You are banned"); // This shouldn't happen due to is_banned check
            };
        };
    };

    // Validate name format (unless it's empty)
    if (name != "") {
        switch (await* validate_name_text(name)) {
            case (#ok(valid)) {
                if (not valid) {
                    return #err("Name must be 1-32 characters long and contain only alphanumeric characters, spaces, hyphens, underscores, dots, and apostrophes");
                };
            };
            case (#err(blacklisted_word, attempted_name)) {
                // Ban the user automatically based on ban history
                let reason = "Attempted to set neuron name containing blacklisted word '" # blacklisted_word # "'. Full attempted name: '" # attempted_name # "'";
                ignore await auto_ban_user(this_canister_id(), caller, reason);
                return #err("Name contains inappropriate content. You have been banned.");
            };
        };
    };

    let key : NeuronNameKey = {
        sns_root_canister_id;
        neuron_id;
    };

    // Check name uniqueness (only if setting a new name)
    if (name != "" and not is_name_unique(sns_root_canister_id, name, ?neuron_id)) {
        return #err("Name is already taken by another neuron");
    };

    // Get governance canister and check ownership
    try {
        let governance_canister_id = await get_sns_governance_canister(sns_root_canister_id);
        let is_owner = await is_neuron_owner(caller, governance_canister_id, neuron_id);
        
        if (not is_owner) {
            return #err("Caller is not authorized to name this neuron");
        };

        if (name == "") {
            // Remove the name if it exists
            neuron_names.delete(key);
            return #ok("Successfully removed neuron name");
        } else {
            // Keep verification status if it exists, otherwise set to false
            let current_verified = switch (neuron_names.get(key)) {
                case (?(_, verified)) { verified };
                case null { false };
            };
            
            neuron_names.put(key, (name, current_verified));
            return #ok("Successfully set neuron name");
        }
    } catch (e) {
        return #err("Failed to verify neuron ownership: " # Error.message(e));
    }
  };

  public query func get_neuron_name(sns_root_canister_id : Principal, neuron_id : NeuronId) : async ?(Text, Bool) {
    let key : NeuronNameKey = {
      sns_root_canister_id;
      neuron_id;
    };
    neuron_names.get(key)
  };

  public query func get_all_neuron_names() : async [(NeuronNameKey, (Text, Bool))] {
    Iter.toArray(neuron_names.entries())
  };

  public shared ({ caller }) func verify_neuron_name(sns_root_canister_id : Principal, neuron_id : NeuronId) : async Result.Result<Text, Text> {
    if (stable_names_frozen) { return #err(NAMES_MOVING) };
    try {
      let authorized = await can_verify_names(caller, sns_root_canister_id);
      if (not authorized) {
        return #err("Caller is not authorized to verify names");
      };

      let key : NeuronNameKey = {
        sns_root_canister_id;
        neuron_id;
      };

      switch (neuron_names.get(key)) {
        case (?(name, _)) {
          neuron_names.put(key, (name, true));
          #ok("Successfully verified neuron name")
        };
        case null {
          #err("No name found for this neuron")
        };
      }
    } catch (e) {
      #err("Failed to verify name: " # Error.message(e))
    }
  };

  public shared ({ caller }) func unverify_neuron_name(sns_root_canister_id : Principal, neuron_id : NeuronId) : async Result.Result<Text, Text> {
    if (stable_names_frozen) { return #err(NAMES_MOVING) };
    try {
      let authorized = await can_verify_names(caller, sns_root_canister_id);
      if (not authorized) {
        return #err("Caller is not authorized to unverify names");
      };

      let key : NeuronNameKey = {
        sns_root_canister_id;
        neuron_id;
      };

      switch (neuron_names.get(key)) {
        case (?(name, _)) {
          neuron_names.put(key, (name, false));
          #ok("Successfully unverified neuron name")
        };
        case null {
          #err("No name found for this neuron")
        };
      }
    } catch (e) {
      #err("Failed to unverify name: " # Error.message(e))
    }
  };

  // Neuron nickname management
  public shared ({ caller }) func set_neuron_nickname(sns_root_canister_id : Principal, neuron_id : NeuronId, nickname : Text) : async Result.Result<Text, Text> {
    if (stable_names_frozen) { return #err(NAMES_MOVING) };
    if (Principal.isAnonymous(caller)) {
        return #err("Anonymous caller not allowed");
    };

    // Check if user is banned
    if (is_banned(caller)) {
        switch (banned_users.get(caller)) {
            case (?expiry) {
                let time_remaining = expiry - Time.now();
                if (time_remaining > 0) {
                    let hours_remaining = Int.abs(time_remaining) / 3600_000_000_000;
                    return #err("You are banned. Ban expires in " # format_duration(hours_remaining));
                } else {
                    return #err("You are banned"); // This shouldn't happen due to is_banned check
                };
            };
            case null {
                return #err("You are banned"); // This shouldn't happen due to is_banned check
            };
        };
    };

    // Validate nickname format (unless it's empty)
    if (nickname != "") {
        switch (await* validate_name_text(nickname)) {
            case (#ok(valid)) {
                if (not valid) {
                    return #err("Nickname must be 1-32 characters long and contain only alphanumeric characters, spaces, hyphens, underscores, dots, and apostrophes");
                };
            };
            case (#err(blacklisted_word, attempted_name)) {
                // Don't ban users for nicknames only they can see

                // Ban the user automatically based on ban history
                //let reason = "Attempted to set neuron nickname containing blacklisted word '" # blacklisted_word # "'. Full attempted name: '" # attempted_name # "'";
                //ignore await auto_ban_user(this_canister_id(), caller, reason);
                //return #err("Nickname contains inappropriate content. You have been banned.");
            };
        };
    };

    let key : NeuronNameKey = {
        sns_root_canister_id;
        neuron_id;
    };

    if (nickname == "") {
        // Get the user's nickname map
        switch (neuron_nicknames.get(caller)) {
            case (?user_map) {
                // Remove the nickname if it exists
                user_map.delete(key);
            };
            case null { /* No nicknames map exists, nothing to remove */ };
        };
        return #ok("Successfully removed neuron nickname");
    } else {
        // Check nickname limit (only when adding a new nickname)
        let (neuron_limit, _) = await* get_nickname_limits(caller);
        switch (neuron_nicknames.get(caller)) {
            case (?existing_map) {
                // Only check limit if this is a new nickname (not updating existing)
                if (existing_map.get(key) == null and existing_map.size() >= neuron_limit) {
                    return #err("You have reached the maximum number of neuron nicknames (" # Nat.toText(neuron_limit) # "). Get Sneed Premium for more!");
                };
            };
            case null { };
        };
        
        // Get or create the user's nickname map
        let user_map = switch (neuron_nicknames.get(caller)) {
            case (?existing_map) { existing_map };
            case null {
                let new_map = HashMap.HashMap<NeuronNameKey, Text>(10, func(k1: NeuronNameKey, k2: NeuronNameKey) : Bool {
                    k1.sns_root_canister_id == k2.sns_root_canister_id and k1.neuron_id.id == k2.neuron_id.id
                }, func(k : NeuronNameKey) : Nat32 {
                    Principal.hash(k.sns_root_canister_id) ^ Blob.hash(k.neuron_id.id)
                });
                neuron_nicknames.put(caller, new_map);
                new_map
            };
        };
        
        // Set the nickname
        user_map.put(key, nickname);
        return #ok("Successfully set neuron nickname");
    }
  };

  public query ({ caller }) func get_neuron_nickname(sns_root_canister_id : Principal, neuron_id : NeuronId) : async ?Text {
    switch (neuron_nicknames.get(caller)) {
      case (?user_nicknames) {
        let key : NeuronNameKey = {
          sns_root_canister_id;
          neuron_id;
        };
        user_nicknames.get(key)
      };
      case (null) { null };
    }
  };

  public query ({ caller }) func get_all_neuron_nicknames() : async [(NeuronNameKey, Text)] {
    switch (neuron_nicknames.get(caller)) {
      case (?user_nicknames) {
        Iter.toArray(user_nicknames.entries())
      };
      case (null) { [] };
    }
  };

  // Helper function to check if caller owns a principal
  private func is_principal_owner(caller : Principal, principal : Principal, sns_root_canister_id : ?Principal) : async Bool {
    // Case 1: If caller is the principal, they own it
    if (Principal.equal(caller, principal)) {
      return true;
    };

    // Case 2: Check if caller has a hotkeyed neuron where principal is the owner
    switch (sns_root_canister_id) {
      case (?sns_root_canister_id) {
        try {
          let governance_canister_id = await get_sns_governance_canister(sns_root_canister_id);
          let sns_governance = actor (Principal.toText(governance_canister_id)) : actor {
            list_neurons : shared query ({
              of_principal : ?Principal;
              limit : Nat32;
              start_page_at : ?NeuronId;
            }) -> async {
              neurons : [{
                id : ?NeuronId;
                permissions : [{
                  principal : ?Principal;
                  permission_type : [Int32];
                }];
              }];
            };        
          };

          let response = await sns_governance.list_neurons({
            of_principal = ?caller;
            limit = 100;
            start_page_at = null;
          });

          // For each neuron
          for (neuron in response.neurons.vals()) {
            // Find the principal with the most permissions
            var max_permissions = 0;
            var owner_principal : ?Principal = null;

            for (permission in neuron.permissions.vals()) {
              let perm_count = permission.permission_type.size();
              if (perm_count > max_permissions) {
                max_permissions := perm_count;
                owner_principal := permission.principal;
              };
            };

            // If the target principal is the owner of this neuron, caller has ownership
            switch (owner_principal) {
              case (?p) {
                if (Principal.equal(p, principal)) {
                  return true;
                };
              };
              case null {};
            };
          };
        } catch (e) {
          // If there's an error checking neuron ownership, default to false
          return false;
        };
      };
      case null {
        return false;
      };
    };

    false
  };

  // Principal name management
  public shared ({ caller }) func set_principal_name(name : Text) : async Result.Result<Text, Text> {
    await set_principal_name_impl(caller, caller, name, null)
  };

  public shared ({ caller }) func set_principal_name_for(principal : Principal, name : Text, sns_root_canister_id : ?Principal) : async Result.Result<Text, Text> {
    await set_principal_name_impl(caller, principal, name, sns_root_canister_id)
  };

  // Principal name management
  private func set_principal_name_impl(caller : Principal, principal : Principal, name : Text, sns_root_canister_id : ?Principal) : async Result.Result<Text, Text> {
    if (stable_names_frozen) { return #err(NAMES_MOVING) };
      if (Principal.isAnonymous(caller)) {
          return #err("Anonymous caller not allowed");
      };

      if (is_banned(caller)) {
          switch (banned_users.get(caller)) {
              case (?expiry) {
                  let time_remaining = expiry - Time.now();
                  if (time_remaining > 0) {
                      let hours_remaining = Int.abs(time_remaining) / 3600_000_000_000;
                      return #err("You are banned. Ban expires in " # format_duration(hours_remaining));
                  } else {
                      return #err("You are banned"); // This shouldn't happen due to is_banned check
                  };
              };
              case null {
                  return #err("You are banned"); // This shouldn't happen due to is_banned check
              };
          };
      };

      // Check ownership
      let is_owner = await is_principal_owner(caller, principal, sns_root_canister_id );
      if (not is_owner and not is_admin(caller)) {
          return #err("Caller is not authorized to set name for this principal");
      };

      // Validate name format (unless it's empty)
      if (name != "") {
          switch (await* validate_name_text(name)) {
              case (#ok(valid)) {
                  if (not valid) {
                      return #err("Name must be 1-32 characters long and contain only alphanumeric characters, spaces, hyphens, underscores, dots, and apostrophes");
                  };
              };
              case (#err(blacklisted_word, attempted_name)) {
                  // Ban the user automatically based on ban history
                  let reason = "Attempted to set principal name containing blacklisted word '" # blacklisted_word # "'. Full attempted name: '" # attempted_name # "'";
                  ignore await auto_ban_user(this_canister_id(), caller, reason);
                  return #err("Name contains inappropriate content. You have been banned.");
              };
          };
      };

      // Check name uniqueness (only if setting a new name)
      if (name != "") {
          for ((existing_principal, (existing_name, _)) in principal_names.entries()) {
              if (Text.equal(existing_name, name) and not Principal.equal(existing_principal, principal)) {
                  return #err("Name is already taken by another principal");
              };
          };
      };

      if (name == "") {
          // Remove the name if it exists
          principal_names.delete(principal);
          return #ok("Successfully removed principal name");
      } else {
          // Keep verification status if it exists, otherwise set to false
          let current_verified = switch (principal_names.get(principal)) {
              case (?(_, verified)) { verified };
              case null { false };
          };
          
          principal_names.put(principal, (name, current_verified));
          return #ok("Successfully set principal name");
      };
  };

  public query func get_principal_name(principal : Principal) : async ?(Text, Bool) {
      principal_names.get(principal)
  };

  public query func get_all_principal_names() : async [(Principal, (Text, Bool))] {
      Iter.toArray(principal_names.entries())
  };

  // ---- Avatars ----
  // An avatar is a URL shown next to the principal's name: either an https:// link (an image the
  // user hosts elsewhere) or a small inline data:image/... URL stored here. Sizes are capped so a
  // batch lookup stays well inside one reply.
  let AVATAR_MAX_LINK_LENGTH : Nat = 512;
  let AVATAR_MAX_DATA_LENGTH : Nat = 32_768;
  let AVATAR_BATCH_MAX : Nat = 50;

  private func validate_avatar_url(url : Text) : Result.Result<(), Text> {
    let starts = func(prefix : Text) : Bool { Text.startsWith(url, #text prefix) };
    if (starts("https://")) {
      if (url.size() > AVATAR_MAX_LINK_LENGTH) return #err("Avatar link too long (max " # Nat.toText(AVATAR_MAX_LINK_LENGTH) # " characters)");
      for (c in url.chars()) {
        if (c == ' ' or c == '\n' or c == '\r' or c == '\t' or c == '\"' or c == '\'' or c == '<' or c == '>') return #err("Avatar link contains an invalid character");
      };
      return #ok(());
    };
    if (starts("data:image/png;base64,") or starts("data:image/jpeg;base64,") or starts("data:image/jpg;base64,")
        or starts("data:image/webp;base64,") or starts("data:image/gif;base64,")) {
      if (url.size() > AVATAR_MAX_DATA_LENGTH) return #err("Inline avatar too large (max " # Nat.toText(AVATAR_MAX_DATA_LENGTH) # " characters; use a smaller image, or link to one)");
      // base64 payload: the characters after the comma
      var seen_comma = false;
      for (c in url.chars()) {
        if (seen_comma) {
          let ok = (c >= 'A' and c <= 'Z') or (c >= 'a' and c <= 'z') or (c >= '0' and c <= '9') or c == '+' or c == '/' or c == '=';
          if (not ok) return #err("Inline avatar is not valid base64");
        } else if (c == ',') { seen_comma := true };
      };
      return #ok(());
    };
    #err("Avatar must be an https:// link or an inline data:image/png|jpeg|webp|gif;base64 URL")
  };

  /// Set the caller's avatar. An empty string clears it.
  public shared ({ caller }) func set_my_avatar(url : Text) : async Result.Result<Text, Text> {
    if (stable_names_frozen) { return #err(NAMES_MOVING) };
    if (Principal.isAnonymous(caller)) return #err("Anonymous caller not allowed");
    if (is_banned(caller)) return #err("You are banned");
    if (url == "") { avatars.delete(caller); return #ok("Avatar cleared") };
    switch (validate_avatar_url(url)) {
      case (#err(e)) #err(e);
      case (#ok(())) { avatars.put(caller, url); #ok("Avatar set") };
    };
  };

  public shared ({ caller }) func clear_my_avatar() : async Result.Result<Text, Text> {
    if (stable_names_frozen) { return #err(NAMES_MOVING) };
    if (Principal.isAnonymous(caller)) return #err("Anonymous caller not allowed");
    avatars.delete(caller);
    #ok("Avatar cleared")
  };

  /// Admins can drop an abusive avatar.
  public shared ({ caller }) func admin_clear_avatar(principal : Principal) : async Result.Result<Text, Text> {
    if (stable_names_frozen) { return #err(NAMES_MOVING) };
    if (not is_admin(caller)) return #err("Not authorized");
    switch (avatars.remove(principal)) {
      case (?url) block("avatar_clear", caller, [("principal", pv(principal)), ("avatar_sha256", sha(url))]);
      case null {};
    };
    #ok("Avatar cleared")
  };

  public query func get_avatar(principal : Principal) : async ?Text {
    avatars.get(principal)
  };

  /// Avatars for up to 50 principals at once; principals without one are left out of the reply.
  public query func get_avatars(principals : [Principal]) : async [(Principal, Text)] {
    let out = Buffer.Buffer<(Principal, Text)>(principals.size());
    var n = 0;
    for (p in principals.vals()) {
      if (n >= AVATAR_BATCH_MAX) return Buffer.toArray(out);
      n += 1;
      switch (avatars.get(p)) { case (?u) out.add((p, u)); case null {} };
    };
    Buffer.toArray(out)
  };

  public query func get_avatar_count() : async Nat { avatars.size() };

  public shared ({ caller }) func verify_principal_name(principal : Principal) : async Result.Result<Text, Text> {
    if (stable_names_frozen) { return #err(NAMES_MOVING) };
      if (not is_admin(caller)) {
          return #err("Caller is not authorized to verify names");
      };

      switch (principal_names.get(principal)) {
          case (?(name, _)) {
              principal_names.put(principal, (name, true));
              #ok("Successfully verified principal name")
          };
          case null {
              #err("No name found for this principal")
          };
      }
  };

  public shared ({ caller }) func unverify_principal_name(principal : Principal) : async Result.Result<Text, Text> {
    if (stable_names_frozen) { return #err(NAMES_MOVING) };
      if (not is_admin(caller)) {
          return #err("Caller is not authorized to unverify names");
      };

      switch (principal_names.get(principal)) {
          case (?(name, _)) {
              principal_names.put(principal, (name, false));
              #ok("Successfully unverified principal name")
          };
          case null {
              #err("No name found for this principal")
          };
      }
  };

  // Set a public name for a canister (caller must be a controller)
  public shared ({ caller }) func set_canister_name(canister_id : Principal, name : Text) : async Result.Result<Text, Text> {
    if (stable_names_frozen) { return #err(NAMES_MOVING) };
      if (Principal.isAnonymous(caller)) {
          return #err("Anonymous caller not allowed");
      };

      if (is_banned(caller)) {
          switch (banned_users.get(caller)) {
              case (?expiry) {
                  let time_remaining = expiry - Time.now();
                  if (time_remaining > 0) {
                      let hours_remaining = Int.abs(time_remaining) / 3600_000_000_000;
                      return #err("You are banned. Ban expires in " # format_duration(hours_remaining));
                  } else {
                      return #err("You are banned");
                  };
              };
              case null {
                  return #err("You are banned");
              };
          };
      };

      // Verify caller is a controller of the canister
      try {
          let info = await IC.canister_info({ canister_id = canister_id; num_requested_changes = null });
          let isController = Array.find<Principal>(info.controllers, func (c) { Principal.equal(c, caller) });
          switch (isController) {
              case null {
                  return #err("You are not a controller of this canister");
              };
              case (?_) {
                  // Caller is a controller, proceed to set the name
              };
          };
      } catch (e) {
          return #err("Failed to verify canister controllers: " # Error.message(e));
      };

      // Validate name format (unless it's empty)
      if (name != "") {
          if (Text.size(name) < 2) {
              return #err("Name must be at least 2 characters");
          };
          if (Text.size(name) > 32) {
              return #err("Name must be at most 32 characters");
          };
          // Check that name contains at least one alphanumeric character
          var hasAlphanumeric = false;
          for (c in name.chars()) {
              if ((c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z') or (c >= '0' and c <= '9')) {
                  hasAlphanumeric := true;
              };
          };
          if (not hasAlphanumeric) {
              return #err("Name must contain at least one alphanumeric character");
          };
      };

      // Check name uniqueness (only if setting a new name)
      if (name != "") {
          for ((existing_principal, (existing_name, _)) in principal_names.entries()) {
              if (Text.equal(existing_name, name) and not Principal.equal(existing_principal, canister_id)) {
                  return #err("Name is already taken by another principal");
              };
          };
      };

      if (name == "") {
          // Remove the name if it exists
          principal_names.delete(canister_id);
          return #ok("Successfully removed canister name");
      } else {
          // Keep verification status if it exists, otherwise set to false
          let current_verified = switch (principal_names.get(canister_id)) {
              case (?(_, verified)) { verified };
              case null { false };
          };
          
          principal_names.put(canister_id, (name, current_verified));
          return #ok("Successfully set canister name");
      };
  };

  // ---- The naming service (spec/sneed_names.md) ----

  let NAMES_MOVING : Text = "Names are moving to the new naming service; please try again shortly";

  /// The naming service's canisters, which may call names_moderate.
  public shared ({ caller }) func admin_set_names_canisters(canisters : [Principal]) : async Result.Result<Text, Text> {
    if (not is_admin(caller)) { return #err("Not authorized") };
    if (canisters.size() > 20) { return #err("At most 20 canisters") };
    let old = stable_names_canisters;
    stable_names_canisters := canisters;
    if (old != canisters) configBlock(caller, "names_canisters", principalsValue(old), principalsValue(canisters));
    #ok("Naming canisters set");
  };

  public query func get_names_canisters() : async [Principal] { stable_names_canisters };

  /// Refuse (true) or allow (false) every naming write here while names move to the naming service.
  public shared ({ caller }) func admin_set_names_frozen(frozen : Bool) : async Result.Result<Text, Text> {
    if (not is_admin(caller)) { return #err("Not authorized") };
    let old = stable_names_frozen;
    stable_names_frozen := frozen;
    if (old != frozen) configBlock(caller, "names_frozen", flag(old), flag(frozen));
    #ok(if (frozen) "Naming writes frozen" else "Naming writes allowed");
  };

  public query func get_names_frozen() : async Bool { stable_names_frozen };

  /// For the naming service's canisters: is `user` banned, and does `text` contain a blacklisted
  /// word? A blacklisted word in a public name bans the user, as setting a name here does.
  public shared ({ caller }) func names_moderate(args : { user : Principal; text : Text; is_public : Bool }) : async { #ok; #banned : Text; #blacklisted : Text } {
    if (Array.find<Principal>(stable_names_canisters, func(c) { Principal.equal(c, caller) }) == null) {
      Debug.trap("Only the naming service's canisters");
    };
    if (is_banned(args.user)) {
      switch (banned_users.get(args.user)) {
        case (?expiry) {
          let remaining = expiry - Time.now();
          if (remaining > 0) {
            return #banned("You are banned. Ban expires in " # format_duration(Int.abs(remaining) / 3600_000_000_000));
          };
        };
        case null {};
      };
      return #banned("You are banned");
    };
    let lower = Text.toLowercase(args.text);
    for ((word, _) in blacklisted_words.entries()) {
      if (Text.contains(lower, #text (Text.toLowercase(word)))) {
        if (args.is_public) {
          let reason = "Attempted to set a name containing blacklisted word '" # word # "'. Full attempted name: '" # args.text # "'";
          ignore await auto_ban_user(this_canister_id(), args.user, reason);
          return #blacklisted("Name contains inappropriate content. You have been banned.");
        };
        return #blacklisted("Name contains inappropriate content");
      };
    };
    #ok;
  };

  /// Every user's principal nicknames, a page at a time: (owner, principal, nickname). Admins only.
  public query ({ caller }) func admin_export_principal_nicknames(start : Nat, limit : Nat) : async { items : [(Principal, Principal, Text)]; total : Nat } {
    if (not is_admin(caller)) { Debug.trap("Not authorized") };
    let all = Buffer.Buffer<(Principal, Principal, Text)>(100);
    for ((owner, m) in principal_nicknames.entries()) {
      for ((target, nickname) in m.entries()) { all.add((owner, target, nickname)) };
    };
    exportPage(Buffer.toArray(all), start, limit);
  };

  /// Every user's neuron nicknames, a page at a time: (owner, neuron, nickname). Admins only.
  public query ({ caller }) func admin_export_neuron_nicknames(start : Nat, limit : Nat) : async { items : [(Principal, NeuronNameKey, Text)]; total : Nat } {
    if (not is_admin(caller)) { Debug.trap("Not authorized") };
    let all = Buffer.Buffer<(Principal, NeuronNameKey, Text)>(100);
    for ((owner, m) in neuron_nicknames.entries()) {
      for ((key, nickname) in m.entries()) { all.add((owner, key, nickname)) };
    };
    exportPage(Buffer.toArray(all), start, limit);
  };

  /// Every avatar, a page at a time. Admins only.
  public query ({ caller }) func admin_export_avatars(start : Nat, limit : Nat) : async { items : [(Principal, Text)]; total : Nat } {
    if (not is_admin(caller)) { Debug.trap("Not authorized") };
    exportPage(Iter.toArray(avatars.entries()), start, Nat.min(limit, 50));
  };

  private func exportPage<X>(all : [X], start : Nat, limit : Nat) : { items : [X]; total : Nat } {
    let n = all.size();
    let from = Nat.min(start, n);
    let len = Nat.min(Nat.min(limit, 1000), n - from);
    { items = Array.subArray<X>(all, from, len); total = n };
  };

  // Principal nickname management
  public shared ({ caller }) func set_principal_nickname(principal : Principal, nickname : Text) : async Result.Result<Text, Text> {
    if (stable_names_frozen) { return #err(NAMES_MOVING) };
      if (Principal.isAnonymous(caller)) {
          return #err("Anonymous caller not allowed");
      };

      if (is_banned(caller)) {
          switch (banned_users.get(caller)) {
              case (?expiry) {
                  let time_remaining = expiry - Time.now();
                  if (time_remaining > 0) {
                      let hours_remaining = Int.abs(time_remaining) / 3600_000_000_000;
                      return #err("You are banned. Ban expires in " # format_duration(hours_remaining));
                  } else {
                      return #err("You are banned"); // This shouldn't happen due to is_banned check
                  };
              };
              case null {
                  return #err("You are banned"); // This shouldn't happen due to is_banned check
              };
          };
      };

      // Validate nickname format (unless it's empty)
      if (nickname != "") {
          switch (await* validate_name_text(nickname)) {
              case (#ok(valid)) {
                  if (not valid) {
                      return #err("Nickname must be 1-32 characters long and contain only alphanumeric characters, spaces, hyphens, underscores, dots, and apostrophes");
                  };
              };
              case (#err(blacklisted_word, attempted_name)) {
                  // Don't ban users for nicknames only they can see

                  // Ban the user automatically based on ban history
                  //let reason = "Attempted to set principal nickname containing blacklisted word '" # blacklisted_word # "'. Full attempted name: '" # attempted_name # "'";
                  //ignore await auto_ban_user(this_canister_id(), caller, reason);
                  //return #err("Nickname contains inappropriate content. You have been banned.");
              };
          };
      };

      if (nickname == "") {
          // Get the user's nickname map
          switch (principal_nicknames.get(caller)) {
              case (?user_map) {
                  // Remove the nickname if it exists
                  user_map.delete(principal);
              };
              case null { /* No nicknames map exists, nothing to remove */ };
          };
          return #ok("Successfully removed principal nickname");
      } else {
          // Check nickname limit (only when adding a new nickname)
          let (_, principal_limit) = await* get_nickname_limits(caller);
          switch (principal_nicknames.get(caller)) {
              case (?existing_map) {
                  // Only check limit if this is a new nickname (not updating existing)
                  if (existing_map.get(principal) == null and existing_map.size() >= principal_limit) {
                      return #err("You have reached the maximum number of principal nicknames (" # Nat.toText(principal_limit) # "). Get Sneed Premium for more!");
                  };
              };
              case null { };
          };
          
          // Get or create the user's nickname map
          let user_map = switch (principal_nicknames.get(caller)) {
              case (?existing_map) { existing_map };
              case null {
                  let new_map = HashMap.HashMap<Principal, Text>(10, Principal.equal, Principal.hash);
                  principal_nicknames.put(caller, new_map);
                  new_map
              };
          };
          
          // Set the nickname
          user_map.put(principal, nickname);
          return #ok("Successfully set principal nickname");
      };
  };

  public query ({ caller }) func get_principal_nickname(principal : Principal) : async ?Text {
      switch (principal_nicknames.get(caller)) {
          case (?user_nicknames) {
              user_nicknames.get(principal)
          };
          case null { null };
      }
  };

  public query ({ caller }) func get_all_principal_nicknames() : async [(Principal, Text)] {
      switch (principal_nicknames.get(caller)) {
          case (?user_nicknames) {
              Iter.toArray(user_nicknames.entries())
          };
          case null { [] };
      }
  };

  // Add after other admin functions
  public shared ({ caller }) func add_blacklisted_word(word: Text) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };
    let lowercaseWord = Text.toLowercase(word);
    switch (blacklisted_words.get(lowercaseWord)) {
      case (?_) { return #err("Word already blacklisted") };
      case null {
        let old = blacklisted_words.size();
        blacklisted_words.put(lowercaseWord, true);
        // the list is admin-only and a hash of a single word is guessed in seconds: only the count
        configBlock(caller, "blacklisted_words", #Nat(old), #Nat(blacklisted_words.size()));
        #ok()
      };
    };
  };

  public shared ({ caller }) func remove_blacklisted_word(word: Text) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };
    let lowercaseWord = Text.toLowercase(word);
    switch (blacklisted_words.get(lowercaseWord)) {
      case (?_) {
        let old = blacklisted_words.size();
        blacklisted_words.delete(lowercaseWord);
        configBlock(caller, "blacklisted_words", #Nat(old), #Nat(blacklisted_words.size()));
        #ok()
      };
      case null { return #err("Word not found in blacklist") };
    };
  };

  public query ({ caller }) func get_blacklisted_words() : async [Text] {
    if (not is_admin(caller)) {
      return [];
    };
    Iter.toArray(blacklisted_words.keys())
  };

  // ============================================
  // NICKNAME LIMITS CONFIGURATION
  // ============================================

  // Set the Sneed Premium canister ID for premium membership checks
  public shared ({ caller }) func set_nickname_premium_canister(canister_id : ?Principal) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };
    let old = stable_sneed_premium_canister_id;
    stable_sneed_premium_canister_id := canister_id;
    if (old != canister_id) configBlock(caller, "sneed_premium_canister_id", optPrincipalValue(old), optPrincipalValue(canister_id));
    #ok()
  };

  // Update nickname limits
  public shared ({ caller }) func update_nickname_limits(
    max_neuron_nicknames : ?Nat,
    max_principal_nicknames : ?Nat,
    premium_max_neuron_nicknames : ?Nat,
    premium_max_principal_nicknames : ?Nat
  ) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };
    let (o1, o2, o3, o4) = (stable_max_neuron_nicknames, stable_max_principal_nicknames, stable_premium_max_neuron_nicknames, stable_premium_max_principal_nicknames);
    switch (max_neuron_nicknames) {
      case (?limit) { stable_max_neuron_nicknames := limit };
      case null {};
    };
    switch (max_principal_nicknames) {
      case (?limit) { stable_max_principal_nicknames := limit };
      case null {};
    };
    switch (premium_max_neuron_nicknames) {
      case (?limit) { stable_premium_max_neuron_nicknames := limit };
      case null {};
    };
    switch (premium_max_principal_nicknames) {
      case (?limit) { stable_premium_max_principal_nicknames := limit };
      case null {};
    };
    natConfig(caller, "max_neuron_nicknames", o1, stable_max_neuron_nicknames);
    natConfig(caller, "max_principal_nicknames", o2, stable_max_principal_nicknames);
    natConfig(caller, "premium_max_neuron_nicknames", o3, stable_premium_max_neuron_nicknames);
    natConfig(caller, "premium_max_principal_nicknames", o4, stable_premium_max_principal_nicknames);
    #ok()
  };

  // Get nickname limits configuration
  public query func get_nickname_limits_config() : async {
    sneed_premium_canister_id : ?Principal;
    max_neuron_nicknames : Nat;
    max_principal_nicknames : Nat;
    premium_max_neuron_nicknames : Nat;
    premium_max_principal_nicknames : Nat;
  } {
    {
      sneed_premium_canister_id = stable_sneed_premium_canister_id;
      max_neuron_nicknames = stable_max_neuron_nicknames;
      max_principal_nicknames = stable_max_principal_nicknames;
      premium_max_neuron_nicknames = stable_premium_max_neuron_nicknames;
      premium_max_principal_nicknames = stable_premium_max_principal_nicknames;
    }
  };

  // Get the caller's current nickname counts and limits
  public shared ({ caller }) func get_my_nickname_usage() : async {
    neuron_nickname_count : Nat;
    principal_nickname_count : Nat;
    neuron_nickname_limit : Nat;
    principal_nickname_limit : Nat;
    is_premium : Bool;
  } {
    let neuron_count = switch (neuron_nicknames.get(caller)) {
      case (?map) { map.size() };
      case null { 0 };
    };
    let principal_count = switch (principal_nicknames.get(caller)) {
      case (?map) { map.size() };
      case null { 0 };
    };
    let (neuron_limit, principal_limit) = await* get_nickname_limits(caller);
    let is_premium = await* is_premium_member(caller);
    {
      neuron_nickname_count = neuron_count;
      principal_nickname_count = principal_count;
      neuron_nickname_limit = neuron_limit;
      principal_nickname_limit = principal_limit;
      is_premium = is_premium;
    }
  };

  // Canister Groups Limits Configuration (admin functions)
  public query func get_canister_groups_limits_config() : async {
    max_canister_groups : Nat;
    max_canisters_per_group : Nat;
    max_total_grouped_canisters : Nat;
    premium_max_canister_groups : Nat;
    premium_max_canisters_per_group : Nat;
    premium_max_total_grouped_canisters : Nat;
  } {
    {
      max_canister_groups = stable_max_canister_groups;
      max_canisters_per_group = stable_max_canisters_per_group;
      max_total_grouped_canisters = stable_max_total_grouped_canisters;
      premium_max_canister_groups = stable_premium_max_canister_groups;
      premium_max_canisters_per_group = stable_premium_max_canisters_per_group;
      premium_max_total_grouped_canisters = stable_premium_max_total_grouped_canisters;
    }
  };

  // Update canister groups limits (admin only)
  public shared ({ caller }) func update_canister_groups_limits(
    max_groups : ?Nat,
    max_per_group : ?Nat,
    max_total : ?Nat,
    premium_max_groups : ?Nat,
    premium_max_per_group : ?Nat,
    premium_max_total : ?Nat
  ) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized: admin access required");
    };
    let (o1, o2, o3) = (stable_max_canister_groups, stable_max_canisters_per_group, stable_max_total_grouped_canisters);
    let (o4, o5, o6) = (stable_premium_max_canister_groups, stable_premium_max_canisters_per_group, stable_premium_max_total_grouped_canisters);
    switch (max_groups) {
      case (?val) { stable_max_canister_groups := val };
      case null {};
    };
    switch (max_per_group) {
      case (?val) { stable_max_canisters_per_group := val };
      case null {};
    };
    switch (max_total) {
      case (?val) { stable_max_total_grouped_canisters := val };
      case null {};
    };
    switch (premium_max_groups) {
      case (?val) { stable_premium_max_canister_groups := val };
      case null {};
    };
    switch (premium_max_per_group) {
      case (?val) { stable_premium_max_canisters_per_group := val };
      case null {};
    };
    switch (premium_max_total) {
      case (?val) { stable_premium_max_total_grouped_canisters := val };
      case null {};
    };
    natConfig(caller, "max_canister_groups", o1, stable_max_canister_groups);
    natConfig(caller, "max_canisters_per_group", o2, stable_max_canisters_per_group);
    natConfig(caller, "max_total_grouped_canisters", o3, stable_max_total_grouped_canisters);
    natConfig(caller, "premium_max_canister_groups", o4, stable_premium_max_canister_groups);
    natConfig(caller, "premium_max_canisters_per_group", o5, stable_premium_max_canisters_per_group);
    natConfig(caller, "premium_max_total_grouped_canisters", o6, stable_premium_max_total_grouped_canisters);
    #ok()
  };

  // Get the caller's current canister groups usage and limits
  public shared ({ caller }) func get_my_canister_groups_usage() : async {
    group_count : Nat;
    total_canisters : Nat;
    max_in_single_group : Nat;
    ungrouped_count : Nat;
    group_limit : Nat;
    per_group_limit : Nat;
    total_limit : Nat;
    is_premium : Bool;
  } {
    let groups_root = principal_canister_groups.get(caller);
    let (group_count, total_canisters, max_in_single, ungrouped) = switch (groups_root) {
      case (?root) {
        let gc = count_groups_recursive(root.groups);
        let tc = count_canisters_recursive(root.groups) + root.ungrouped.size();
        let max_single = find_max_canisters_in_single_group(root.groups);
        (gc, tc, max_single, root.ungrouped.size())
      };
      case null { (0, 0, 0, 0) };
    };
    
    let (group_limit, per_group_limit, total_limit) = await* get_canister_group_limits(caller);
    let is_premium = await* is_premium_member(caller);
    
    {
      group_count = group_count;
      total_canisters = total_canisters;
      max_in_single_group = max_in_single;
      ungrouped_count = ungrouped;
      group_limit = group_limit;
      per_group_limit = per_group_limit;
      total_limit = total_limit;
      is_premium = is_premium;
    }
  };

  // Partner management functions
  public shared ({ caller }) func add_partner(name: Text, logo_url: Text, description: Text, links: [PartnerLink], index: ?Nat) : async Result.Result<Nat, Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };

    if (Text.size(name) == 0) {
      return #err("Partner name cannot be empty");
    };

    if (Text.size(logo_url) == 0) {
      return #err("Logo URL cannot be empty");
    };

    if (Text.size(description) == 0) {
      return #err("Description cannot be empty");
    };

    let now = Time.now();
    let partner : Partner = {
      id = next_partner_id;
      name = name;
      logo_url = logo_url;
      description = description;
      links = links;
      index = index;
      created_at = now;
      updated_at = now;
    };

    partners.add(partner);
    next_partner_id += 1;
    stable_next_partner_id := next_partner_id;
    block("partner_add", caller, [("id", #Nat(partner.id)), ("value", partnerValue(partner))]);
    #ok(partner.id)
  };

  public shared ({ caller }) func update_partner(id: Nat, name: Text, logo_url: Text, description: Text, links: [PartnerLink], index: ?Nat) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };

    if (Text.size(name) == 0) {
      return #err("Partner name cannot be empty");
    };

    if (Text.size(logo_url) == 0) {
      return #err("Logo URL cannot be empty");
    };

    if (Text.size(description) == 0) {
      return #err("Description cannot be empty");
    };

    let partnersArray = Buffer.toArray(partners);
    var found = false;
    var changed : ?(Partner, Partner) = null;
    let updatedPartners = Buffer.Buffer<Partner>(partners.size());

    for (partner in partnersArray.vals()) {
      if (partner.id == id) {
        let updatedPartner : Partner = {
          id = partner.id;
          name = name;
          logo_url = logo_url;
          description = description;
          links = links;
          index = index;
          created_at = partner.created_at;
          updated_at = Time.now();
        };
        updatedPartners.add(updatedPartner);
        found := true;
        if (partner.name != name or partner.logo_url != logo_url or partner.description != description or partner.index != index or not sameLinks(partner.links, links)) {
          changed := ?(partner, updatedPartner);
        };
      } else {
        updatedPartners.add(partner);
      };
    };

    if (not found) {
      return #err("Partner not found");
    };

    partners := updatedPartners;
    switch (changed) {
      case (?(o, n)) block("partner_update", caller, [("id", #Nat(id)), ("value", partnerValue(n)), ("old_value", partnerValue(o))]);
      case null {};
    };
    #ok()
  };

  public shared ({ caller }) func remove_partner(id: Nat) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };

    let partnersArray = Buffer.toArray(partners);
    var found = false;
    var removed : ?Partner = null;
    let filteredPartners = Buffer.Buffer<Partner>(partners.size());

    for (partner in partnersArray.vals()) {
      if (partner.id != id) {
        filteredPartners.add(partner);
      } else {
        found := true;
        removed := ?partner;
      };
    };

    if (not found) {
      return #err("Partner not found");
    };

    partners := filteredPartners;
    switch (removed) { case (?o) block("partner_remove", caller, [("id", #Nat(id)), ("old_value", partnerValue(o))]); case null {} };
    #ok()
  };

  public query func get_partners() : async [Partner] {
    Buffer.toArray(partners)
  };

  public query func get_partner(id: Nat) : async ?Partner {
    let partnersArray = Buffer.toArray(partners);
    for (partner in partnersArray.vals()) {
      if (partner.id == id) {
        return ?partner;
      };
    };
    null
  };

  // Function to get ban history for a specific user
  public query ({ caller }) func get_user_ban_history(user: Principal) : async Result.Result<[BanLogEntry], Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };
    
    let userBans = Buffer.Buffer<BanLogEntry>(0);
    for (entry in ban_log.vals()) {
      if (Principal.equal(entry.user, user)) {
        userBans.add(entry);
      };
    };
    
    #ok(Buffer.toArray(userBans))
  };

  // Function to get all neurons owned by a user
  public shared ({ caller }) func get_user_neurons() : async Result.Result<[T.Neuron], Text> {
    if (Principal.isAnonymous(caller)) {
        return #err("Anonymous users cannot get neurons");
    };

    if (is_banned(caller)) {
        return #err("You are banned");
    };

    try {
        let governance_canister_id = await get_sns_governance_canister(Principal.fromText("fp274-iaaaa-aaaaq-aacha-cai"));
        let sns_governance = actor (Principal.toText(governance_canister_id)) : actor {
            list_neurons : shared query ({
                of_principal : ?Principal;
                limit : Nat32;
                start_page_at : ?NeuronId;
            }) -> async {
                neurons : [T.SnsNeuron];
            };
        };

        let response = await sns_governance.list_neurons({
            of_principal = ?caller;
            limit = 100;
            start_page_at = null;
        });

        // SNS governance returns permissions as records with an optional principal;
        // convert to the public (Principal, [Int32]) shape, skipping entries without a principal.
        #ok(Array.map<T.SnsNeuron, T.Neuron>(response.neurons, func (n : T.SnsNeuron) : T.Neuron {
            let perms = Buffer.Buffer<(Principal, [Int32])>(n.permissions.size());
            for (perm in n.permissions.vals()) {
                switch (perm.principal) {
                    case (?p) { perms.add((p, perm.permission_type)) };
                    case null {};
                };
            };
            { id = n.id; permissions = Buffer.toArray(perms) }
        }))
    } catch (e) {
        #err("Failed to fetch neurons: " # Error.message(e))
    }
  };

  // Project management functions
  public shared ({ caller }) func add_project(name: Text, logo_url: ?Text, description: Text, project_type: ProjectType, links: [ProjectLink], index: ?Nat) : async Result.Result<Nat, Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };

    if (Text.size(name) == 0) {
      return #err("Project name cannot be empty");
    };

    if (Text.size(description) == 0) {
      return #err("Description cannot be empty");
    };

    let now = Time.now();
    let project : Project = {
      id = next_project_id;
      name = name;
      logo_url = logo_url;
      description = description;
      project_type = project_type;
      links = links;
      index = index;
      created_at = now;
      updated_at = now;
    };

    projects.add(project);
    next_project_id += 1;
    stable_next_project_id := next_project_id;
    block("project_add", caller, [("id", #Nat(project.id)), ("value", projectValue(project))]);
    #ok(project.id)
  };

  public shared ({ caller }) func update_project(id: Nat, name: Text, logo_url: ?Text, description: Text, project_type: ProjectType, links: [ProjectLink], index: ?Nat) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };

    if (Text.size(name) == 0) {
      return #err("Project name cannot be empty");
    };

    if (Text.size(description) == 0) {
      return #err("Description cannot be empty");
    };

    let projectsArray = Buffer.toArray(projects);
    var found = false;
    var changed : ?(Project, Project) = null;
    let updatedProjects = Buffer.Buffer<Project>(projects.size());

    for (project in projectsArray.vals()) {
      if (project.id == id) {
        let updatedProject : Project = {
          id = project.id;
          name = name;
          logo_url = logo_url;
          description = description;
          project_type = project_type;
          links = links;
          index = index;
          created_at = project.created_at;
          updated_at = Time.now();
        };
        updatedProjects.add(updatedProject);
        found := true;
        if (project.name != name or project.logo_url != logo_url or project.description != description or project.project_type != project_type or project.index != index or not sameLinks(project.links, links)) {
          changed := ?(project, updatedProject);
        };
      } else {
        updatedProjects.add(project);
      };
    };

    if (not found) {
      return #err("Project not found");
    };

    projects := updatedProjects;
    switch (changed) {
      case (?(o, n)) block("project_update", caller, [("id", #Nat(id)), ("value", projectValue(n)), ("old_value", projectValue(o))]);
      case null {};
    };
    #ok()
  };

  public shared ({ caller }) func remove_project(id: Nat) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized");
    };

    let projectsArray = Buffer.toArray(projects);
    var found = false;
    var removed : ?Project = null;
    let filteredProjects = Buffer.Buffer<Project>(projects.size());

    for (project in projectsArray.vals()) {
      if (project.id != id) {
        filteredProjects.add(project);
      } else {
        found := true;
        removed := ?project;
      };
    };

    if (not found) {
      return #err("Project not found");
    };

    projects := filteredProjects;
    switch (removed) { case (?o) block("project_remove", caller, [("id", #Nat(id)), ("old_value", projectValue(o))]); case null {} };
    #ok()
  };

  public query func get_projects() : async [Project] {
    Buffer.toArray(projects)
  };

  public query func get_project(id: Nat) : async ?Project {
    let projectsArray = Buffer.toArray(projects);
    for (project in projectsArray.vals()) {
      if (project.id == id) {
        return ?project;
      };
    };
    null
  };

  // ============================================
  // JAILBREAK CONFIGURATION MANAGEMENT
  // ============================================

  // Save a jailbreak configuration (with payment)
  public shared ({ caller }) func save_jailbreak_config(
    sns_root_canister_id: Principal,
    neuron_id_hex: Text,
    target_principal: Principal
  ) : async Result.Result<Nat, Text> {
    if (Principal.isAnonymous(caller)) {
      return #err("Anonymous users cannot save configurations");
    };

    // Check if this exact config already exists for the user - no charge for existing configs
    switch (jailbreak_configs.get(caller)) {
      case (?user_configs) {
        for (config in user_configs.vals()) {
          if (Principal.equal(config.sns_root_canister_id, sns_root_canister_id) and
              Text.equal(config.neuron_id_hex, neuron_id_hex) and
              Principal.equal(config.target_principal, target_principal)) {
            // Config already exists, return its ID without charging
            return #ok(config.id);
          };
        };
      };
      case null {};
    };

    // one save per caller at a time: the check above and the charge below are separated by awaits
    if (Map.has(jailbreak_saving, phash, caller)) {
      return #err("A save is already in progress for your account; try again when it has finished");
    };
    Map.set(jailbreak_saving, phash, caller, ());
    try {
      await* save_jailbreak_config_locked(caller, sns_root_canister_id, neuron_id_hex, target_principal);
    } finally {
      Map.delete(jailbreak_saving, phash, caller);
    }
  };

  func save_jailbreak_config_locked(
    caller : Principal,
    sns_root_canister_id: Principal,
    neuron_id_hex: Text,
    target_principal: Principal
  ) : async* Result.Result<Nat, Text> {
    // Get the fee for this user (lowest of regular, premium, admin and partner prices)
    let isPremium = await* is_premium_member(caller);
    let (fee, priceTier) = jailbreak_price(caller, isPremium);

    // If there's a fee, process payment
    if (fee > 0) {
      let paymentSubaccount = jailbreakPaymentSubaccount(caller);
      
      let icpLedger = actor(ICP_LEDGER_CANISTER_ID) : actor {
        icrc1_balance_of : shared query ({ owner : Principal; subaccount : ?Blob }) -> async Nat;
        icrc1_transfer : shared ({
          from_subaccount : ?Blob;
          to : { owner : Principal; subaccount : ?Blob };
          amount : Nat;
          fee : ?Nat;
          memo : ?Blob;
          created_at_time : ?Nat64;
        }) -> async { #Ok : Nat; #Err : T.TransferError };
      };
      
      // Check user's payment balance
      let balance = await icpLedger.icrc1_balance_of({
        owner = this_canister_id();
        subaccount = ?paymentSubaccount;
      });
      
      if (balance < fee + ICP_LEDGER_FEE) {
        return #err("Insufficient payment balance. Required: " # Nat.toText(fee) # " e8s + " # Nat.toText(ICP_LEDGER_FEE) # " fee. Available: " # Nat.toText(balance) # " e8s. Please deposit ICP to your payment account first.");
      };
      
      // Determine where to send the fee
      let feeRecipient : { owner : Principal; subaccount : ?Blob } = switch (stable_jailbreak_fee_account_owner) {
        case (?owner) { { owner = owner; subaccount = stable_jailbreak_fee_account_subaccount } };
        case null { { owner = this_canister_id(); subaccount = null } }; // Keep in canister's main account
      };
      
      // Transfer the fee
      let transferResult = await icpLedger.icrc1_transfer({
        from_subaccount = ?paymentSubaccount;
        to = feeRecipient;
        amount = fee;
        fee = ?ICP_LEDGER_FEE;
        memo = ?Blob.fromArray([0x6A, 0x61, 0x69, 0x6C, 0x62, 0x72, 0x65, 0x61, 0x6B]); // "jailbreak"
        created_at_time = ?Nat64.fromNat(Int.abs(Time.now())); // the ledger deduplicates a resent transfer
      });
      
      switch (transferResult) {
        case (#Err(err)) {
          return #err("Payment failed: " # debug_show(err));
        };
        case (#Ok(icpTx)) {
          // Log the successful payment
          let paymentLog : JailbreakPaymentLog = {
            id = next_jailbreak_payment_log_id;
            user = caller;
            config_id = next_jailbreak_config_id; // Will be assigned to the config
            sns_root_canister_id = sns_root_canister_id;
            neuron_id_hex = neuron_id_hex;
            target_principal = target_principal;
            amount_e8s = fee;
            is_premium = isPremium;
            timestamp = Time.now();
          };
          jailbreak_payment_logs.add(paymentLog);
          Map.set(jailbreak_payment_tiers, nhash, paymentLog.id, priceTier);
          Map.set(jailbreak_payment_blocks, nhash, paymentLog.id, icpTx);
          next_jailbreak_payment_log_id += 1;
          // the neuron, its SNS and the target principal are the payer's own data: not logged
          block("jailbreak_payment", caller, [
            ("payment_id", #Nat(paymentLog.id)), ("config_id", #Nat(paymentLog.config_id)),
            ("amount_e8s", #Nat(fee)), ("fee_e8s", #Nat(ICP_LEDGER_FEE)), ("price_tier", #Text(SpecialPrices.tierText(priceTier))),
            ("to", accountValue(feeRecipient.owner, feeRecipient.subaccount)), ("icp_tx", #Nat(icpTx)),
          ]);
        };
      };
    };

    // Payment successful (or no fee required), save the config
    let config : JailbreakConfig = {
      id = next_jailbreak_config_id;
      sns_root_canister_id = sns_root_canister_id;
      neuron_id_hex = neuron_id_hex;
      target_principal = target_principal;
      created_at = Time.now();
    };

    // Get or create user's config buffer
    let user_configs = switch (jailbreak_configs.get(caller)) {
      case (?existing) { existing };
      case null {
        let new_buffer = Buffer.Buffer<JailbreakConfig>(5);
        jailbreak_configs.put(caller, new_buffer);
        new_buffer
      };
    };

    user_configs.add(config);
    next_jailbreak_config_id += 1;
    #ok(config.id)
  };

  // Get all jailbreak configs for the caller
  public query ({ caller }) func get_my_jailbreak_configs() : async [JailbreakConfig] {
    switch (jailbreak_configs.get(caller)) {
      case (?user_configs) { Buffer.toArray(user_configs) };
      case null { [] };
    }
  };

  // Delete a jailbreak config
  public shared ({ caller }) func delete_jailbreak_config(id: Nat) : async Result.Result<(), Text> {
    if (Principal.isAnonymous(caller)) {
      return #err("Anonymous users cannot delete configurations");
    };

    switch (jailbreak_configs.get(caller)) {
      case (?user_configs) {
        let filtered = Buffer.Buffer<JailbreakConfig>(user_configs.size());
        var found = false;
        for (config in user_configs.vals()) {
          if (config.id != id) {
            filtered.add(config);
          } else {
            found := true;
          };
        };
        if (not found) {
          return #err("Configuration not found");
        };
        jailbreak_configs.put(caller, filtered);
        #ok()
      };
      case null {
        #err("No configurations found")
      };
    }
  };

  // ============================================
  // JAILBREAK FEE SETTINGS (Admin)
  // ============================================

  // Get jailbreak fee settings
  public query func get_jailbreak_fee_settings() : async {
    fee_premium_e8s: Nat;
    fee_regular_e8s: Nat;
    fee_account_owner: ?Principal;
    fee_account_subaccount: ?Blob;
  } {
    {
      fee_premium_e8s = stable_jailbreak_fee_premium;
      fee_regular_e8s = stable_jailbreak_fee_regular;
      fee_account_owner = stable_jailbreak_fee_account_owner;
      fee_account_subaccount = stable_jailbreak_fee_account_subaccount;
    }
  };

  // Update jailbreak fee settings (admin only)
  public shared ({ caller }) func set_jailbreak_fee_settings(
    fee_premium_e8s: ?Nat,
    fee_regular_e8s: ?Nat,
    fee_account_owner: ??Principal,
    fee_account_subaccount: ??Blob
  ) : async Result.Result<(), Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized: admin access required");
    };
    let (oldPremium, oldRegular, oldRecipient, oldRecipientValue) = (stable_jailbreak_fee_premium, stable_jailbreak_fee_regular, jailbreakFeeRecipientKey(), jailbreakFeeRecipientValue());
    
    switch (fee_premium_e8s) {
      case (?fee) { stable_jailbreak_fee_premium := fee };
      case null {};
    };
    
    switch (fee_regular_e8s) {
      case (?fee) { stable_jailbreak_fee_regular := fee };
      case null {};
    };
    
    switch (fee_account_owner) {
      case (?owner) { stable_jailbreak_fee_account_owner := owner };
      case null {};
    };
    
    switch (fee_account_subaccount) {
      case (?sub) { stable_jailbreak_fee_account_subaccount := sub };
      case null {};
    };
    natConfig(caller, "jailbreak_fee_premium_e8s", oldPremium, stable_jailbreak_fee_premium);
    natConfig(caller, "jailbreak_fee_regular_e8s", oldRegular, stable_jailbreak_fee_regular);
    if (oldRecipient != jailbreakFeeRecipientKey()) configBlock(caller, "jailbreak_fee_recipient", oldRecipientValue, jailbreakFeeRecipientValue());
    
    #ok()
  };

  // Get the fee that would be charged for a user to create a jailbreak script
  // (the lowest applicable price: regular, premium, admin or partner; see get_my_jailbreak_price)
  public shared ({ caller }) func get_my_jailbreak_fee() : async Nat {
    let is_premium = await* is_premium_member(caller);
    jailbreak_price(caller, is_premium).0
  };

  // The fee the caller would pay and the tier that gives it (regular, premium, admin or partner).
  public shared ({ caller }) func get_my_jailbreak_price() : async { amount_e8s : Nat; price_tier : SpecialPrices.Tier } {
    let is_premium = await* is_premium_member(caller);
    let (amount, tier) = jailbreak_price(caller, is_premium);
    { amount_e8s = amount; price_tier = tier };
  };

  // ============================================
  // SPECIAL PRICES (admin and partner prices, spec/special_prices.md)
  // ============================================

  // The admin price applies to admins who are people (never canisters such as SNS root).
  func gets_admin_price(p : Principal) : Bool { is_admin(p) and SpecialPrices.isPerson(p) };

  func jailbreak_price(user : Principal, isPremium : Bool) : (Nat, SpecialPrices.Tier) {
    let admin = if (gets_admin_price(user)) { special_admin_prices.jailbreak_fee_e8s } else { null };
    let partner = switch (SpecialPrices.activePartner(special_partner_prices, user, Time.now())) {
      case (?e) { e.prices.jailbreak_fee_e8s };
      case null { null };
    };
    SpecialPrices.lowest(stable_jailbreak_fee_regular, if (isPremium) { ?stable_jailbreak_fee_premium } else { null }, admin, partner);
  };

  func specialPricesValue(p : SpecialPriceSet) : T3.Value = SpecialPrices.overridesValue([("jailbreak_fee_e8s", p.jailbreak_fee_e8s)]);
  func partnerPricesValue(e : PartnerPrices) : T3.Value = SpecialPrices.partnerValue(e.label_, [("jailbreak_fee_e8s", e.prices.jailbreak_fee_e8s)], e.expires_at);

  func payment_tier(log : JailbreakPaymentLog) : SpecialPrices.Tier {
    switch (Map.get(jailbreak_payment_tiers, nhash, log.id)) {
      case (?t) { t };
      case null { if (log.is_premium) { #premium } else { #regular } };
    };
  };

  public shared ({ caller }) func set_admin_prices(prices : SpecialPriceSet) : async { #ok; #err : Text } {
    if (not is_admin(caller)) { return #err("Not authorized: admin access required") };
    let old = special_admin_prices;
    special_admin_prices := prices;
    if (old != prices) configBlock(caller, "admin_prices", specialPricesValue(old), specialPricesValue(prices));
    #ok;
  };

  public shared ({ caller }) func set_partner_prices(partner : Principal, entry : PartnerPrices) : async { #ok; #err : Text } {
    if (not is_admin(caller)) { return #err("Not authorized: admin access required") };
    switch (SpecialPrices.validatePartner(special_partner_prices, partner, entry, Time.now())) {
      case (?e) { return #err(e) };
      case null {};
    };
    let old = Map.get(special_partner_prices, phash, partner);
    Map.set(special_partner_prices, phash, partner, entry);
    let base : [(Text, T3.Value)] = [("key", #Text("partner_prices")), ("partner", pv(partner)), ("value", partnerPricesValue(entry))];
    switch (old) {
      case (?o) if (o != entry) block("config_update", caller, Array.append(base, [("old_value", partnerPricesValue(o))]));
      case null block("config_update", caller, base);
    };
    #ok;
  };

  public shared ({ caller }) func remove_partner_prices(partner : Principal) : async { #ok; #err : Text } {
    if (not is_admin(caller)) { return #err("Not authorized: admin access required") };
    switch (Map.remove(special_partner_prices, phash, partner)) {
      case (?o) {
        block("config_update", caller, [("key", #Text("partner_prices")), ("partner", pv(partner)), ("value", #Text("removed")), ("old_value", partnerPricesValue(o))]);
        #ok;
      };
      case null { #err("no partner prices for this principal") };
    };
  };

  public query func get_special_prices() : async { admin_prices : SpecialPriceSet; partners : [SpecialPrices.PartnerListing<SpecialPriceSet>] } {
    { admin_prices = special_admin_prices; partners = SpecialPrices.listing(special_partner_prices) };
  };

  public query func get_special_prices_for(p : Principal) : async { admin_prices : ?SpecialPriceSet; partner : ?PartnerPrices } {
    {
      admin_prices = if (gets_admin_price(p)) { ?special_admin_prices } else { null };
      partner = SpecialPrices.activePartner(special_partner_prices, p, Time.now());
    };
  };

  // The price tier of jailbreak payments by log id (admin only, like the logs): ids without a log
  // entry are left out.
  public query ({ caller }) func get_jailbreak_payment_price_tiers(ids : [Nat]) : async Result.Result<[(Nat, SpecialPrices.Tier)], Text> {
    if (not is_admin(caller)) { return #err("Not authorized: admin access required") };
    let out = Buffer.Buffer<(Nat, SpecialPrices.Tier)>(ids.size());
    for (log in jailbreak_payment_logs.vals()) {
      if (Array.find<Nat>(ids, func(i) { i == log.id }) != null) { out.add((log.id, payment_tier(log))) };
    };
    #ok(Buffer.toArray(out));
  };

  // ============================================
  // JAILBREAK ADMIN STATS AND LOGS (Admin only)
  // ============================================

  // Get jailbreak payment statistics: public, for the revenue page (the logs themselves stay admin only).
  // Still a Result, so callers written for the admin-only version keep working.
  public query func get_jailbreak_payment_stats() : async Result.Result<{
    total_scripts_created: Nat;
    total_revenue_e8s: Nat;
    total_premium_payments: Nat;
    total_regular_payments: Nat;
    premium_revenue_e8s: Nat;
    regular_revenue_e8s: Nat;
    unique_users: Nat;
  }, Text> {
    var totalScripts : Nat = 0;
    var totalRevenue : Nat = 0;
    var premiumPayments : Nat = 0;
    var regularPayments : Nat = 0;
    var premiumRevenue : Nat = 0;
    var regularRevenue : Nat = 0;
    let uniqueUsers = HashMap.HashMap<Principal, Bool>(50, Principal.equal, Principal.hash);

    for (log in jailbreak_payment_logs.vals()) {
      totalScripts += 1;
      totalRevenue += log.amount_e8s;
      uniqueUsers.put(log.user, true);
      
      if (log.is_premium) {
        premiumPayments += 1;
        premiumRevenue += log.amount_e8s;
      } else {
        regularPayments += 1;
        regularRevenue += log.amount_e8s;
      };
    };

    #ok({
      total_scripts_created = totalScripts;
      total_revenue_e8s = totalRevenue;
      total_premium_payments = premiumPayments;
      total_regular_payments = regularPayments;
      premium_revenue_e8s = premiumRevenue;
      regular_revenue_e8s = regularRevenue;
      unique_users = uniqueUsers.size();
    })
  };

  // Get jailbreak payment logs with pagination (admin only)
  public query ({ caller }) func get_jailbreak_payment_logs(
    offset: Nat,
    limit: Nat
  ) : async Result.Result<{
    logs: [JailbreakPaymentLog];
    total: Nat;
  }, Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized: admin access required");
    };

    let total = jailbreak_payment_logs.size();
    
    // Return empty if offset is beyond total
    if (offset >= total) {
      return #ok({ logs = []; total = total });
    };

    // Get logs in reverse order (newest first)
    let logsArray = Buffer.toArray(jailbreak_payment_logs);
    let effectiveLimit = if (offset + limit > total) { total - offset } else { limit };
    
    let result = Buffer.Buffer<JailbreakPaymentLog>(effectiveLimit);
    var i = total - 1 - offset;
    var count : Nat = 0;
    
    label loopLabel while (count < effectiveLimit and i >= 0) {
      result.add(logsArray[i]);
      count += 1;
      if (i == 0) { break loopLabel };
      i -= 1;
    };

    #ok({
      logs = Buffer.toArray(result);
      total = total;
    })
  };

  // ---- Support lookups by principal (spec/support_audit.md P1-9): admin-only, paged, newest first ----

  /// A jailbreak payment with its ICP ledger block (none for payments made before blocks were
  /// recorded) and the price tier it was charged at.
  public type JailbreakPaymentRecord = {
    id : Nat;
    user : Principal;
    config_id : Nat;
    sns_root_canister_id : Principal;
    neuron_id_hex : Text;
    target_principal : Principal;
    amount_e8s : Nat;
    is_premium : Bool;
    timestamp : Int;
    block_index : ?Nat;
    price_tier : SpecialPrices.Tier;
  };

  transient let MAX_SUPPORT_PAGE : Nat = 100;

  /// `offset`/`limit` over `items` (oldest first), newest first; at most MAX_SUPPORT_PAGE.
  func newest_page<X>(items : [X], offset : Nat, limit : Nat) : [X] {
    let n = items.size();
    if (offset >= n) return [];
    Array.tabulate<X>(Nat.min(Nat.min(limit, MAX_SUPPORT_PAGE), n - offset), func(i) = items[n - 1 - offset - i]);
  };

  /// Admins: the jailbreak payments `user` made, newest first, with their ledger blocks.
  public query ({ caller }) func admin_get_jailbreak_payments_for(user : Principal, offset : Nat, limit : Nat) : async Result.Result<{ payments : [JailbreakPaymentRecord]; total : Nat }, Text> {
    if (not is_admin(caller)) return #err("Not authorized: admin access required");
    let mine = Buffer.Buffer<JailbreakPaymentRecord>(8);
    for (log in jailbreak_payment_logs.vals()) {
      if (log.user == user) mine.add({ log with block_index = Map.get(jailbreak_payment_blocks, nhash, log.id); price_tier = payment_tier(log) });
    };
    let all = Buffer.toArray(mine);
    #ok({ payments = newest_page(all, offset, limit); total = all.size() });
  };

  /// Admins: the jailbreak configurations `user` has saved, newest first.
  public query ({ caller }) func admin_get_jailbreak_configs_for(user : Principal, offset : Nat, limit : Nat) : async Result.Result<{ configs : [JailbreakConfig]; total : Nat }, Text> {
    if (not is_admin(caller)) return #err("Not authorized: admin access required");
    let all = switch (jailbreak_configs.get(user)) { case (?c) Buffer.toArray(c); case null [] };
    #ok({ configs = newest_page(all, offset, limit); total = all.size() });
  };

  // Get all jailbreak configs across all users (admin only) for stats
  public query ({ caller }) func get_all_jailbreak_configs_count() : async Result.Result<Nat, Text> {
    if (not is_admin(caller)) {
      return #err("Not authorized: admin access required");
    };
    
    var total : Nat = 0;
    for ((_, configs) in jailbreak_configs.entries()) {
      total += configs.size();
    };
    #ok(total)
  };

  // ============================================
  // JAILBREAK PAYMENT FUNCTIONS
  // ============================================

  // Get the user's payment subaccount for jailbreak fees
  // This is derived from the user's principal using a "jailbreak" prefix
  public query ({ caller }) func get_jailbreak_payment_subaccount() : async Blob {
    jailbreakPaymentSubaccount(caller)
  };

  // Helper to generate jailbreak payment subaccount for a user
  private func jailbreakPaymentSubaccount(user : Principal) : Blob {
    let prefix : [Nat8] = [0x0A, 0x6A, 0x61, 0x69, 0x6C, 0x62, 0x72, 0x65, 0x61, 0x6B]; // "\njailbreak"
    let principalBytes = Blob.toArray(Principal.toBlob(user));
    let size = prefix.size() + principalBytes.size();
    
    // Pad to 32 bytes
    let subaccount = Array.tabulate<Nat8>(32, func(i) {
      if (i < prefix.size()) {
        prefix[i]
      } else if (i < size) {
        principalBytes[i - prefix.size()]
      } else {
        0
      }
    });
    
    Blob.fromArray(subaccount)
  };

  // Get user's balance on their jailbreak payment subaccount
  public shared ({ caller }) func get_jailbreak_payment_balance() : async Nat {
    let subaccount = jailbreakPaymentSubaccount(caller);
    
    let icpLedger = actor(ICP_LEDGER_CANISTER_ID) : actor {
      icrc1_balance_of : shared query ({ owner : Principal; subaccount : ?Blob }) -> async Nat;
    };
    
    await icpLedger.icrc1_balance_of({
      owner = this_canister_id();
      subaccount = ?subaccount;
    })
  };

  // Withdraw funds from user's jailbreak payment subaccount
  public shared ({ caller }) func withdraw_jailbreak_payment(amount: Nat) : async Result.Result<Nat, Text> {
    if (Principal.isAnonymous(caller)) {
      return #err("Anonymous users cannot withdraw");
    };
    
    let subaccount = jailbreakPaymentSubaccount(caller);
    
    let icpLedger = actor(ICP_LEDGER_CANISTER_ID) : actor {
      icrc1_balance_of : shared query ({ owner : Principal; subaccount : ?Blob }) -> async Nat;
      icrc1_transfer : shared ({
        from_subaccount : ?Blob;
        to : { owner : Principal; subaccount : ?Blob };
        amount : Nat;
        fee : ?Nat;
        memo : ?Blob;
        created_at_time : ?Nat64;
      }) -> async { #Ok : Nat; #Err : T.TransferError };
    };
    
    // Check balance
    let balance = await icpLedger.icrc1_balance_of({
      owner = this_canister_id();
      subaccount = ?subaccount;
    });
    
    if (balance < amount + ICP_LEDGER_FEE) {
      return #err("Insufficient balance. Available: " # Nat.toText(balance) # " e8s, requested: " # Nat.toText(amount) # " e8s + " # Nat.toText(ICP_LEDGER_FEE) # " fee");
    };
    
    // Transfer to caller's main account
    let transferResult = await icpLedger.icrc1_transfer({
      from_subaccount = ?subaccount;
      to = { owner = caller; subaccount = null };
      amount = amount;
      fee = ?ICP_LEDGER_FEE;
      memo = null;
      created_at_time = null;
    });
    
    switch (transferResult) {
      case (#Ok(blockIndex)) {
        block("deposit_withdraw", caller, [("amount_e8s", #Nat(amount)), ("fee_e8s", #Nat(ICP_LEDGER_FEE)), ("to", accountValue(caller, null)), ("icp_tx", #Nat(blockIndex))]);
        #ok(blockIndex)
      };
      case (#Err(err)) { #err("Transfer failed: " # debug_show(err)) };
    }
  };

  // IC Management canister actor
  transient let IC = actor "aaaaa-aa" : actor {
    canister_info : shared (CanisterInfoRequest) -> async CanisterInfoResponse;
  };

  // Get canister info (controllers and module hash) via IC management canister
  // This is an update call because it makes an async call to another canister
  public shared func get_canister_info(canister_id : Principal) : async Result.Result<{ controllers : [Principal]; module_hash : ?Blob }, Text> {
    try {
      let info = await IC.canister_info({
        canister_id = canister_id;
        num_requested_changes = null;
      });
      #ok({
        controllers = info.controllers;
        module_hash = info.module_hash;
      })
    } catch (e) {
      #err("Failed to get canister info: " # Error.message(e))
    }
  };

  // save state to stable arrays
  system func preupgrade() {
    /// stable_principal_swap_canisters
    var list_stable_principal_swap_canisters = List.nil<(Principal, [Principal])>();
    let principalSwapCanistersIter : Iter.Iter<Principal> = state.principal_swap_canisters.keys();
    for (principal in principalSwapCanistersIter) {
      let swapCanisters = switch (state.principal_swap_canisters.get(principal)) {
        case (?existingSwapCanisters) existingSwapCanisters;
        case _ List.nil<Principal>();
      };

      list_stable_principal_swap_canisters := List.push<(Principal, [Principal])>((principal, List.toArray<Principal>(swapCanisters)), list_stable_principal_swap_canisters);
    };
    stable_principal_swap_canisters := List.toArray<(Principal, [Principal])>(list_stable_principal_swap_canisters);

    /// stable_principal_ledger_canisters
    var list_stable_principal_ledger_canisters = List.nil<(Principal, [Principal])>();
    let principalLedgerCanistersIter : Iter.Iter<Principal> = state.principal_ledger_canisters.keys();
    for (principal in principalLedgerCanistersIter) {
      let ledgerCanisters = switch (state.principal_ledger_canisters.get(principal)) {
        case (?existingSwapCanisters) existingSwapCanisters;
        case _ List.nil<Principal>();
      };

      list_stable_principal_ledger_canisters := List.push<(Principal, [Principal])>((principal, List.toArray<Principal>(ledgerCanisters)), list_stable_principal_ledger_canisters);
    };
    stable_principal_ledger_canisters := List.toArray<(Principal, [Principal])>(list_stable_principal_ledger_canisters);

    /// stable_principal_tracked_canisters
    var list_stable_principal_tracked_canisters = List.nil<(Principal, [Principal])>();
    let principalTrackedCanistersIter : Iter.Iter<Principal> = state.principal_tracked_canisters.keys();
    for (principal in principalTrackedCanistersIter) {
      let trackedCanisters = switch (state.principal_tracked_canisters.get(principal)) {
        case (?existingTrackedCanisters) existingTrackedCanisters;
        case _ List.nil<Principal>();
      };

      list_stable_principal_tracked_canisters := List.push<(Principal, [Principal])>((principal, List.toArray<Principal>(trackedCanisters)), list_stable_principal_tracked_canisters);
    };
    stable_principal_tracked_canisters := List.toArray<(Principal, [Principal])>(list_stable_principal_tracked_canisters);

    /// stable_principal_canister_groups
    var list_stable_principal_canister_groups = List.nil<(Principal, CanisterGroupsRoot)>();
    for (principal in principal_canister_groups.keys()) {
      switch (principal_canister_groups.get(principal)) {
        case (?groups) {
          list_stable_principal_canister_groups := List.push<(Principal, CanisterGroupsRoot)>((principal, groups), list_stable_principal_canister_groups);
        };
        case _ {};
      };
    };
    stable_principal_canister_groups := List.toArray<(Principal, CanisterGroupsRoot)>(list_stable_principal_canister_groups);

    /// stable_principal_wallet_layouts
    var list_stable_principal_wallet_layouts = List.nil<(Principal, WalletLayout)>();
    for (principal in principal_wallet_layouts.keys()) {
      switch (principal_wallet_layouts.get(principal)) {
        case (?layout) {
          list_stable_principal_wallet_layouts := List.push<(Principal, WalletLayout)>((principal, layout), list_stable_principal_wallet_layouts);
        };
        case _ {};
      };
    };
    stable_principal_wallet_layouts := List.toArray<(Principal, WalletLayout)>(list_stable_principal_wallet_layouts);

    // Save whitelisted tokens to stable storage
    stable_whitelisted_tokens := Iter.toArray(whitelisted_tokens.vals());

    // Save admins to stable storage
    stable_admins := Iter.toArray(admins.keys());

    stable_neuron_names := Iter.toArray(neuron_names.entries());
    
    // Convert nested HashMap to stable format
    let nickname_entries = Buffer.Buffer<(Principal, [(NeuronNameKey, Text)])>(neuron_nicknames.size());
    for ((user, nicknames) in neuron_nicknames.entries()) {
      nickname_entries.add((user, Iter.toArray(nicknames.entries())));
    };
    stable_neuron_nicknames := Buffer.toArray(nickname_entries);

    // Save blacklisted words to stable storage
    stable_blacklisted_words := Iter.toArray(blacklisted_words.entries());

    // Save ban data
    stable_ban_log := Buffer.toArray(ban_log);
    stable_banned_users := Iter.toArray(banned_users.entries());

    // Save principal names and nicknames to stable storage
    stable_principal_names := Iter.toArray(principal_names.entries());
    stable_avatars := Iter.toArray(avatars.entries());
    
    // Convert nested HashMap to stable format for principal nicknames
    let principal_nickname_entries = Buffer.Buffer<(Principal, [(Principal, Text)])>(principal_nicknames.size());
    for ((user, nicknames) in principal_nicknames.entries()) {
        principal_nickname_entries.add((user, Iter.toArray(nicknames.entries())));
    };
    stable_principal_nicknames := Buffer.toArray(principal_nickname_entries);

    // Save partners to stable storage
    stable_partners := Buffer.toArray(partners);

    // Save projects to stable storage
    stable_projects := Buffer.toArray(projects);

    // Save jailbreak configs to stable storage
    let jailbreak_entries = Buffer.Buffer<(Principal, [JailbreakConfig])>(jailbreak_configs.size());
    for ((user, configs) in jailbreak_configs.entries()) {
      jailbreak_entries.add((user, Buffer.toArray(configs)));
    };
    stable_jailbreak_configs := Buffer.toArray(jailbreak_entries);
    stable_next_jailbreak_config_id := next_jailbreak_config_id;
    
    // Save jailbreak payment logs to stable storage
    stable_jailbreak_payment_logs := Buffer.toArray(jailbreak_payment_logs);
    stable_next_jailbreak_payment_log_id := next_jailbreak_payment_log_id;
    
    // Save user tokens to stable storage
    stable_user_tokens := Iter.toArray(user_tokens.entries());
    
    // Save authorized_for_callers to stable storage
    stable_authorized_for_callers := Iter.toArray(authorized_for_callers.keys());

    // Save user settings to stable storage
    stable_user_setting_principal_color_coding := Iter.toArray(user_setting_principal_color_coding.entries());
    stable_user_setting_neuron_color_coding := Iter.toArray(user_setting_neuron_color_coding.entries());
    stable_user_setting_show_vp_bar := Iter.toArray(user_setting_show_vp_bar.entries());
    stable_user_setting_show_header_notifications := Iter.toArray(user_setting_show_header_notifications.entries());
    stable_user_setting_collectibles_threshold := Iter.toArray(user_setting_collectibles_threshold.entries());
    stable_user_setting_expand_quick_links_on_desktop := Iter.toArray(user_setting_expand_quick_links_on_desktop.entries());
    stable_user_setting_particle_effects_enabled := Iter.toArray(user_setting_particle_effects_enabled.entries());
    stable_user_setting_neuron_manager_cycle_threshold_red := Iter.toArray(user_setting_neuron_manager_cycle_threshold_red.entries());
    stable_user_setting_neuron_manager_cycle_threshold_orange := Iter.toArray(user_setting_neuron_manager_cycle_threshold_orange.entries());
    stable_user_setting_canister_manager_cycle_threshold_red := Iter.toArray(user_setting_canister_manager_cycle_threshold_red.entries());
    stable_user_setting_canister_manager_cycle_threshold_orange := Iter.toArray(user_setting_canister_manager_cycle_threshold_orange.entries());
    stable_user_setting_frontend_auto_update_enabled := Iter.toArray(user_setting_frontend_auto_update_enabled.entries());
    stable_user_setting_frontend_clear_cache_on_update := Iter.toArray(user_setting_frontend_clear_cache_on_update.entries());
    stable_user_setting_frontend_update_check_interval_sec := Iter.toArray(user_setting_frontend_update_check_interval_sec.entries());
    stable_user_setting_frontend_update_countdown_sec := Iter.toArray(user_setting_frontend_update_countdown_sec.entries());
    stable_user_setting_swap_slippage_tolerance := Iter.toArray(user_setting_swap_slippage_tolerance.entries());
    stable_user_setting_always_show_remove_token := Iter.toArray(user_setting_always_show_remove_token.entries());
    stable_user_setting_notify_replies := Iter.toArray(user_setting_notify_replies.entries());
    stable_user_setting_notify_tips := Iter.toArray(user_setting_notify_tips.entries());
    stable_user_setting_notify_messages := Iter.toArray(user_setting_notify_messages.entries());
    stable_user_setting_notify_collectibles := Iter.toArray(user_setting_notify_collectibles.entries());
    stable_user_setting_notify_votable_proposals := Iter.toArray(user_setting_notify_votable_proposals.entries());
    stable_user_setting_notify_outdated_bots := Iter.toArray(user_setting_notify_outdated_bots.entries());
    stable_user_setting_notify_low_cycles := Iter.toArray(user_setting_notify_low_cycles.entries());
    stable_user_setting_notify_bot_chores := Iter.toArray(user_setting_notify_bot_chores.entries());
    stable_user_setting_notify_bot_log_errors := Iter.toArray(user_setting_notify_bot_log_errors.entries());
    stable_user_setting_notify_bot_log_warnings := Iter.toArray(user_setting_notify_bot_log_warnings.entries());
    stable_user_setting_notify_updates := Iter.toArray(user_setting_notify_updates.entries());
    stable_user_setting_denomination_token := Iter.toArray(user_setting_denomination_token.entries());

    // Serialize per-user per-canister last-seen log IDs
    var lastSeenEntries = List.nil<(Principal, [(Principal, Nat)])>();
    for ((user, innerMap) in user_last_seen_log_id.entries()) {
      lastSeenEntries := List.push((user, Iter.toArray(innerMap.entries())), lastSeenEntries);
    };
    stable_user_last_seen_log_id := List.toArray(lastSeenEntries);
  };

  // initialize ephemeral state and empty stable arrays to save memory
  system func postupgrade() {
      /// stable_principal_swap_canisters
      let stableSwapCanistersIter : Iter.Iter<(Principal, [Principal])> = stable_principal_swap_canisters.vals();
      for (principalSwapCanisters in stableSwapCanistersIter) {
        state.principal_swap_canisters.put(principalSwapCanisters.0, List.fromArray<Principal>(principalSwapCanisters.1));
      };
      stable_principal_swap_canisters := [];

      /// stable_principal_ledger_canisters
      let stableLedgerCanistersIter : Iter.Iter<(Principal, [Principal])> = stable_principal_ledger_canisters.vals();
      for (principalLedgerCanisters in stableLedgerCanistersIter) {
        state.principal_ledger_canisters.put(principalLedgerCanisters.0, List.fromArray<Principal>(principalLedgerCanisters.1));
      };
      stable_principal_ledger_canisters := [];

      /// stable_principal_tracked_canisters
      let stableTrackedCanistersIter : Iter.Iter<(Principal, [Principal])> = stable_principal_tracked_canisters.vals();
      for (principalTrackedCanisters in stableTrackedCanistersIter) {
        state.principal_tracked_canisters.put(principalTrackedCanisters.0, List.fromArray<Principal>(principalTrackedCanisters.1));
      };
      stable_principal_tracked_canisters := [];

      /// stable_principal_canister_groups
      for ((principal, groups) in stable_principal_canister_groups.vals()) {
        principal_canister_groups.put(principal, groups);
      };
      stable_principal_canister_groups := [];

      /// stable_principal_wallet_layouts
      for ((principal, layout) in stable_principal_wallet_layouts.vals()) {
        principal_wallet_layouts.put(principal, layout);
      };
      stable_principal_wallet_layouts := [];

      // Restore whitelisted tokens from stable storage
      for (token in stable_whitelisted_tokens.vals()) {
        whitelisted_tokens.put(token.ledger_id, token);
      };
      stable_whitelisted_tokens := [];

      // Restore admins from stable storage
      for (admin in stable_admins.vals()) {
        admins.put(admin, true);
      };

      // Restore neuron names
      for ((key, name) in stable_neuron_names.vals()) {
        neuron_names.put(key, name);
      };
      stable_neuron_names := [];

      // Restore neuron nicknames
      for ((user, nicknames) in stable_neuron_nicknames.vals()) {
        let user_map = HashMap.HashMap<NeuronNameKey, Text>(10, func(k1: NeuronNameKey, k2: NeuronNameKey) : Bool {
          Principal.equal(k1.sns_root_canister_id, k2.sns_root_canister_id) and Blob.equal(k1.neuron_id.id, k2.neuron_id.id)
        }, func(k: NeuronNameKey) : Nat32 {
          let h1 = Principal.hash(k.sns_root_canister_id);
          let h2 = Blob.hash(k.neuron_id.id);
          h1 ^ h2
        });
        for ((key, nickname) in nicknames.vals()) {
          user_map.put(key, nickname);
        };
        neuron_nicknames.put(user, user_map);
      };
      stable_neuron_nicknames := [];

      // Restore blacklisted words from stable storage
      blacklisted_words := HashMap.fromIter<Text, Bool>(
        stable_blacklisted_words.vals(),
        0,
        Text.equal,
        Text.hash
      );
      stable_blacklisted_words := [];

      // Restore ban data
      ban_log := Buffer.fromArray(stable_ban_log);
      banned_users := HashMap.fromIter<Principal, Int>(
        stable_banned_users.vals(),
        0,
        Principal.equal,
        Principal.hash
      );
      stable_ban_log := [];
      stable_banned_users := [];

      // Restore principal names
      for ((principal, name) in stable_principal_names.vals()) {
          principal_names.put(principal, name);
      };
      stable_principal_names := [];

      // Restore avatars
      for ((principal, url) in stable_avatars.vals()) {
          avatars.put(principal, url);
      };
      stable_avatars := [];

      // Restore principal nicknames
      for ((user, nicknames) in stable_principal_nicknames.vals()) {
          let user_map = HashMap.HashMap<Principal, Text>(10, Principal.equal, Principal.hash);
          for ((principal, nickname) in nicknames.vals()) {
              user_map.put(principal, nickname);
          };
          principal_nicknames.put(user, user_map);
      };
      stable_principal_nicknames := [];

      // Restore partners from stable storage
      for (partner in stable_partners.vals()) {
        partners.add(partner);
      };
      stable_partners := [];

      // Update next_partner_id to be one more than the highest existing ID
      var max_id : Nat = 0;
      for (partner in partners.vals()) {
        if (partner.id >= max_id) {
          max_id := partner.id + 1;
        };
      };
      next_partner_id := Nat.max(max_id, stable_next_partner_id);
      stable_next_partner_id := next_partner_id;

      // Restore projects from stable storage
      for (project in stable_projects.vals()) {
        projects.add(project);
      };
      stable_projects := [];
      
      // Restore user tokens from stable storage
      for ((user, tokens) in stable_user_tokens.vals()) {
        user_tokens.put(user, tokens);
      };
      stable_user_tokens := [];
      
      // Restore authorized_for_callers from stable storage
      for (caller in stable_authorized_for_callers.vals()) {
        authorized_for_callers.put(caller, true);
      };

      // Restore user settings from stable storage
      for ((user, value) in stable_user_setting_principal_color_coding.vals()) {
        user_setting_principal_color_coding.put(user, value);
      };
      stable_user_setting_principal_color_coding := [];
      for ((user, value) in stable_user_setting_neuron_color_coding.vals()) {
        user_setting_neuron_color_coding.put(user, value);
      };
      stable_user_setting_neuron_color_coding := [];
      for ((user, value) in stable_user_setting_show_vp_bar.vals()) {
        user_setting_show_vp_bar.put(user, value);
      };
      stable_user_setting_show_vp_bar := [];
      for ((user, value) in stable_user_setting_show_header_notifications.vals()) {
        user_setting_show_header_notifications.put(user, value);
      };
      stable_user_setting_show_header_notifications := [];
      for ((user, value) in stable_user_setting_collectibles_threshold.vals()) {
        user_setting_collectibles_threshold.put(user, value);
      };
      stable_user_setting_collectibles_threshold := [];
      for ((user, value) in stable_user_setting_expand_quick_links_on_desktop.vals()) {
        user_setting_expand_quick_links_on_desktop.put(user, value);
      };
      stable_user_setting_expand_quick_links_on_desktop := [];
      for ((user, value) in stable_user_setting_particle_effects_enabled.vals()) {
        user_setting_particle_effects_enabled.put(user, value);
      };
      stable_user_setting_particle_effects_enabled := [];
      for ((user, value) in stable_user_setting_neuron_manager_cycle_threshold_red.vals()) {
        user_setting_neuron_manager_cycle_threshold_red.put(user, value);
      };
      stable_user_setting_neuron_manager_cycle_threshold_red := [];
      for ((user, value) in stable_user_setting_neuron_manager_cycle_threshold_orange.vals()) {
        user_setting_neuron_manager_cycle_threshold_orange.put(user, value);
      };
      stable_user_setting_neuron_manager_cycle_threshold_orange := [];
      for ((user, value) in stable_user_setting_canister_manager_cycle_threshold_red.vals()) {
        user_setting_canister_manager_cycle_threshold_red.put(user, value);
      };
      stable_user_setting_canister_manager_cycle_threshold_red := [];
      for ((user, value) in stable_user_setting_canister_manager_cycle_threshold_orange.vals()) {
        user_setting_canister_manager_cycle_threshold_orange.put(user, value);
      };
      stable_user_setting_canister_manager_cycle_threshold_orange := [];
      for ((user, value) in stable_user_setting_frontend_auto_update_enabled.vals()) {
        user_setting_frontend_auto_update_enabled.put(user, value);
      };
      stable_user_setting_frontend_auto_update_enabled := [];
      for ((user, value) in stable_user_setting_frontend_clear_cache_on_update.vals()) {
        user_setting_frontend_clear_cache_on_update.put(user, value);
      };
      stable_user_setting_frontend_clear_cache_on_update := [];
      for ((user, value) in stable_user_setting_frontend_update_check_interval_sec.vals()) {
        user_setting_frontend_update_check_interval_sec.put(user, value);
      };
      stable_user_setting_frontend_update_check_interval_sec := [];
      for ((user, value) in stable_user_setting_frontend_update_countdown_sec.vals()) {
        user_setting_frontend_update_countdown_sec.put(user, value);
      };
      stable_user_setting_frontend_update_countdown_sec := [];
      for ((user, value) in stable_user_setting_swap_slippage_tolerance.vals()) {
        user_setting_swap_slippage_tolerance.put(user, value);
      };
      stable_user_setting_swap_slippage_tolerance := [];
      for ((user, value) in stable_user_setting_always_show_remove_token.vals()) {
        user_setting_always_show_remove_token.put(user, value);
      };
      stable_user_setting_always_show_remove_token := [];
      for ((user, value) in stable_user_setting_notify_replies.vals()) {
        user_setting_notify_replies.put(user, value);
      };
      stable_user_setting_notify_replies := [];
      for ((user, value) in stable_user_setting_notify_tips.vals()) {
        user_setting_notify_tips.put(user, value);
      };
      stable_user_setting_notify_tips := [];
      for ((user, value) in stable_user_setting_notify_messages.vals()) {
        user_setting_notify_messages.put(user, value);
      };
      stable_user_setting_notify_messages := [];
      for ((user, value) in stable_user_setting_notify_collectibles.vals()) {
        user_setting_notify_collectibles.put(user, value);
      };
      stable_user_setting_notify_collectibles := [];
      for ((user, value) in stable_user_setting_notify_votable_proposals.vals()) {
        user_setting_notify_votable_proposals.put(user, value);
      };
      stable_user_setting_notify_votable_proposals := [];
      for ((user, value) in stable_user_setting_notify_outdated_bots.vals()) {
        user_setting_notify_outdated_bots.put(user, value);
      };
      stable_user_setting_notify_outdated_bots := [];
      for ((user, value) in stable_user_setting_notify_low_cycles.vals()) {
        user_setting_notify_low_cycles.put(user, value);
      };
      stable_user_setting_notify_low_cycles := [];
      for ((user, value) in stable_user_setting_notify_bot_chores.vals()) {
        user_setting_notify_bot_chores.put(user, value);
      };
      stable_user_setting_notify_bot_chores := [];
      for ((user, value) in stable_user_setting_notify_bot_log_errors.vals()) {
        user_setting_notify_bot_log_errors.put(user, value);
      };
      stable_user_setting_notify_bot_log_errors := [];
      for ((user, value) in stable_user_setting_notify_bot_log_warnings.vals()) {
        user_setting_notify_bot_log_warnings.put(user, value);
      };
      stable_user_setting_notify_bot_log_warnings := [];
      for ((user, value) in stable_user_setting_notify_updates.vals()) {
        user_setting_notify_updates.put(user, value);
      };
      stable_user_setting_notify_updates := [];
      for ((user, value) in stable_user_setting_denomination_token.vals()) {
        user_setting_denomination_token.put(user, value);
      };
      stable_user_setting_denomination_token := [];

      // Restore per-user per-canister last-seen log IDs
      for ((user, pairs) in stable_user_last_seen_log_id.vals()) {
        let innerMap = HashMap.HashMap<Principal, Nat>(pairs.size(), Principal.equal, Principal.hash);
        for ((canisterId, logId) in pairs.vals()) {
          innerMap.put(canisterId, logId);
        };
        user_last_seen_log_id.put(user, innerMap);
      };
      stable_user_last_seen_log_id := [];

      // Update next_project_id to be one more than the highest existing ID
      var max_project_id : Nat = 0;
      for (project in projects.vals()) {
        if (project.id >= max_project_id) {
          max_project_id := project.id + 1;
        };
      };
      next_project_id := Nat.max(max_project_id, stable_next_project_id);
      stable_next_project_id := next_project_id;

      // Restore jailbreak configs from stable storage
      for ((user, configs) in stable_jailbreak_configs.vals()) {
        let user_buffer = Buffer.Buffer<JailbreakConfig>(configs.size());
        for (config in configs.vals()) {
          user_buffer.add(config);
        };
        jailbreak_configs.put(user, user_buffer);
      };
      stable_jailbreak_configs := [];
      next_jailbreak_config_id := stable_next_jailbreak_config_id;
      
      // Restore jailbreak payment logs from stable storage
      for (log in stable_jailbreak_payment_logs.vals()) {
        jailbreak_payment_logs.add(log);
      };
      stable_jailbreak_payment_logs := [];
      next_jailbreak_payment_log_id := stable_next_jailbreak_payment_log_id;

      // Timers do not survive an upgrade: start the daily token list job again.
      ensure_token_refresh_timer<system>();
      // the ICRC-3 log: republish the certified tip, restart the spill check
      Icrc3Log.certify(icrc3);
      ensure_icrc3_timer<system>();
      backfill_jailbreak_payment_blocks();
  };

  /// Once: the ledger block of each jailbreak payment paid since the ICRC-3 log, from its
  /// jailbreak_payment blocks still held by this canister (payment_id -> icp_tx).
  func backfill_jailbreak_payment_blocks() {
    if (jailbreak_payment_blocks_backfilled) return;
    jailbreak_payment_blocks_backfilled := true;
    var i = icrc3.live.first_index;
    while (i < icrc3.log_length) {
      let r = Icrc3Log.getBlocks(icrc3, [{ start = i; length = Icrc3Log.MAX_RESPONSE_BLOCKS }]);
      if (r.blocks.size() == 0) return;
      for (b in r.blocks.vals()) {
        i := b.id + 1;
        if (logText(logField(b.block, "btype")) == ?"sneedbackend_jailbreak_payment") {
          let tx = logField(b.block, "tx");
          switch (logNat(logField(tx, "payment_id")), logNat(logField(tx, "icp_tx"))) {
            case (?id, ?blk) if (not Map.has(jailbreak_payment_blocks, nhash, id)) Map.set(jailbreak_payment_blocks, nhash, id, blk);
            case _ {};
          };
        };
      };
    };
  };
  func logField(v : T3.Value, name : Text) : T3.Value {
    switch (v) {
      case (#Map(entries)) { for ((k, x) in entries.vals()) if (k == name) return x; #Map([]) };
      case _ #Map([]);
    };
  };
  func logText(v : T3.Value) : ?Text = switch v { case (#Text(t)) ?t; case _ null };
  func logNat(v : T3.Value) : ?Nat = switch v { case (#Nat(n)) ?n; case _ null };

  // On a fresh install, start the daily token list job and the ICRC-3 spill check.
  ensure_token_refresh_timer<system>();
  ensure_icrc3_timer<system>();

  // ---- Donations (Donations.mo) ----
  // The account donations go to (set by an admin) and the verified donations, oldest first.
  var donation_account : ?Donations.Account = null;
  var donations : [Donations.Donation] = [];
  var donation_next_id : Nat = 0;
  transient let SNEED_LEDGER_CANISTER_ID : Text = "hvgxa-wqaaa-aaaaq-aacia-cai";
  transient let MAX_DONATIONS_PAGE : Nat = 100;

  public query func get_donation_account() : async ?Donations.Account { donation_account };

  public shared ({ caller }) func admin_set_donation_account(account : ?Donations.Account) : async Result.Result<(), Text> {
    if (not is_admin(caller)) return #err("Only admins can set the donation account");
    switch (account) {
      case (?a) {
        if (Principal.isAnonymous(a.owner)) return #err("The donation account cannot be the anonymous principal");
        switch (a.subaccount) { case (?b) if (b.size() != 32) return #err("A subaccount is 32 bytes"); case null {} };
      };
      case null {};
    };
    let old = donation_account;
    donation_account := account;
    if (old != account) configBlock(caller, "donation_account", donationAccountValue(old), donationAccountValue(account));
    #ok();
  };

  // ---- Feedback: bug reports and ideas (the /feedback page) ----
  // The page posts public reports as threads in these Sneed forum topics, and sends every report,
  // public or private, to the recipients as a Sneed SMS message from the reporter.
  type FeedbackConfig = { recipients : [Principal]; bug_topic : ?Nat; idea_topic : ?Nat };
  var feedback_config : FeedbackConfig = { recipients = []; bug_topic = null; idea_topic = null };
  transient let MAX_FEEDBACK_RECIPIENTS : Nat = 5; // what one Sneed SMS message can reach

  public query func get_feedback_config() : async FeedbackConfig { feedback_config };

  public shared ({ caller }) func admin_set_feedback_config(c : FeedbackConfig) : async Result.Result<(), Text> {
    if (not is_admin(caller)) return #err("Only admins can set the feedback settings");
    if (c.recipients.size() > MAX_FEEDBACK_RECIPIENTS) return #err("At most " # Nat.toText(MAX_FEEDBACK_RECIPIENTS) # " recipients: a Sneed SMS message reaches no more");
    for (p in c.recipients.vals()) if (Principal.isAnonymous(p)) return #err("The anonymous principal cannot receive reports");
    let o = feedback_config;
    feedback_config := c;
    if (o.recipients != c.recipients) configBlock(caller, "feedback_recipients", principalsValue(o.recipients), principalsValue(c.recipients));
    if (o.bug_topic != c.bug_topic) configBlock(caller, "feedback_bug_topic", optNatValue(o.bug_topic), optNatValue(c.bug_topic));
    if (o.idea_topic != c.idea_topic) configBlock(caller, "feedback_idea_topic", optNatValue(o.idea_topic), optNatValue(c.idea_topic));
    #ok();
  };

  /// ICP, SNEED and the whitelisted tokens: ledgers we trust to report their own blocks.
  func donation_ledger_ok(ledger : Principal) : Bool {
    let t = Principal.toText(ledger);
    t == ICP_LEDGER_CANISTER_ID or t == SNEED_LEDGER_CANISTER_ID or whitelisted_tokens.get(ledger) != null;
  };

  func donation_known(ledger : Principal, block_index : Nat) : Bool {
    Array.find<Donations.Donation>(donations, func(d) = d.ledger == ledger and d.block_index == block_index) != null;
  };

  /// Lists a donation the caller has made: block `block_index` of `ledger` must be a plain transfer
  /// from the caller's account to the donation account.
  public shared ({ caller }) func register_donation(args : Donations.RegisterArgs) : async Result.Result<Donations.Donation, Text> {
    if (Principal.isAnonymous(caller)) return #err("Log in to register a donation");
    let ?to = donation_account else return #err("No donation account is set");
    if (not donation_ledger_ok(args.ledger)) return #err("Donations in this token can't be checked: use ICP, SNEED or a whitelisted token");
    if (donation_known(args.ledger, args.block_index)) return #err("This donation is already on the wall");
    let from = { owner = caller; subaccount = args.from_subaccount };
    switch (await* Donations.verify(args.ledger, args.block_index, from, to)) {
      case (#err(e)) #err(e);
      case (#ok(t)) {
        // two calls for the same block may both have passed the check above
        if (donation_known(args.ledger, args.block_index)) return #err("This donation is already on the wall");
        let d : Donations.Donation = {
          id = donation_next_id; donor = caller; from_subaccount = args.from_subaccount; to; ledger = args.ledger;
          block_index = args.block_index; amount = t.amount; created_at = t.created_at; registered_at = Time.now();
          message = Donations.cleanMessage(args.message); hidden = false;
        };
        donation_next_id += 1;
        donations := Array.append(donations, [d]);
        // public on the wall already; the message is not logged (an admin may hide it)
        block("donation", caller, [
          ("donation_id", #Nat(d.id)), ("ledger", pv(d.ledger)), ("amount", #Nat(d.amount)), ("ledger_block", #Nat(d.block_index)),
          ("from", accountValue(caller, d.from_subaccount)), ("to", accountValue(to.owner, to.subaccount)),
        ]);
        #ok(d);
      };
    };
  };

  func donations_page(all : [Donations.Donation], start : Nat, limit : Nat) : { total : Nat; donations : [Donations.Donation] } {
    let n = all.size();
    let lim = Nat.min(limit, MAX_DONATIONS_PAGE);
    // newest first
    let page = if (start >= n) [] else Array.tabulate<Donations.Donation>(Nat.min(lim, n - start), func(i) = all[n - 1 - start - i]);
    { total = n; donations = page };
  };

  /// The thank-you wall, newest first (hidden donations left out).
  public query func get_donations(start : Nat, limit : Nat) : async { total : Nat; donations : [Donations.Donation] } {
    donations_page(Array.filter<Donations.Donation>(donations, func(d) = not d.hidden), start, limit);
  };

  /// Totals per token over every verified donation, hidden ones included: (ledger, amount, count).
  public query func get_donation_totals() : async [(Principal, Nat, Nat)] {
    var totals : [(Principal, Nat, Nat)] = [];
    for (d in donations.vals()) {
      var found = false;
      totals := Array.map<(Principal, Nat, Nat), (Principal, Nat, Nat)>(totals, func((l, a, c)) = if (l == d.ledger) { found := true; (l, a + d.amount, c + 1) } else (l, a, c));
      if (not found) totals := Array.append(totals, [(d.ledger, d.amount, 1)]);
    };
    totals;
  };

  public query ({ caller }) func admin_get_donations(start : Nat, limit : Nat) : async Result.Result<{ total : Nat; donations : [Donations.Donation] }, Text> {
    if (not is_admin(caller)) return #err("Only admins can see hidden donations");
    #ok(donations_page(donations, start, limit));
  };

  /// Admins: the donations `donor` made (hidden ones included), newest first.
  public query ({ caller }) func admin_get_donations_by(donor : Principal, start : Nat, limit : Nat) : async Result.Result<{ total : Nat; donations : [Donations.Donation] }, Text> {
    if (not is_admin(caller)) return #err("Only admins can look up donations by donor");
    #ok(donations_page(Array.filter<Donations.Donation>(donations, func(d) = d.donor == donor), start, limit));
  };

  /// Hides a donation from the wall (its message, say) or shows it again; it still counts in the totals.
  public shared ({ caller }) func admin_set_donation_hidden(id : Nat, hidden : Bool) : async Result.Result<(), Text> {
    if (not is_admin(caller)) return #err("Only admins can hide donations");
    let ?current = Array.find<Donations.Donation>(donations, func(d) = d.id == id) else return #err("No donation " # Nat.toText(id));
    if (current.hidden != hidden) block("donation_hidden", caller, [("donation_id", #Nat(id)), ("hidden", flag(hidden))]);
    donations := Array.map<Donations.Donation, Donations.Donation>(donations, func(d) = if (d.id == id) ({ d with hidden = hidden }) else d);
    #ok();
  };

  // Limits of the ingress guard below
  transient let MAX_NAME_LENGTH : Nat = 32;
  transient let MAX_SETTING_TEXT : Nat = 256;
  transient let MAX_NEURON_ID_HEX : Nat = 128;
  transient let MAX_LAYOUT_ENTRIES : Nat = 2_000;
  transient let MAX_PRINCIPAL_BYTES : Nat = 32;
  transient let MAX_GROUP_BYTES : Nat = 1_024; // a folder's id, name and record
  func nameOk(arg : Blob, name : Text) : Bool = arg.size() <= IngressGuard.textArg(MAX_NAME_LENGTH) and IngressGuard.text(name, MAX_NAME_LENGTH);

  // get_api_doc (ICP service discoverability): a short Markdown guide for agents and integrators,
  // with the full reference at https://app.sneeddao.com/api-docs/. A static text: no state read.
  public query func get_api_doc() : async Text { ApiDoc.text };

  // Ingress guard (src/IngressGuard.mo): queries are never accepted as update calls, which
  // would go through consensus at our cost, and arguments are capped in size.
  system func inspect({ caller : Principal; arg : Blob; msg : {
    #get_api_doc : Any;
    #icrc3_get_blocks : Any;
    #icrc3_get_archives : Any;
    #icrc3_get_tip_certificate : Any;
    #icrc3_supported_block_types : Any;
    #icrc10_supported_standards : Any;
    #icrc3_log_status : Any;
    #get_log : Any;
    #admin_set_icrc3_settings : Any;
    #admin_icrc3_spill_now : Any;
    #admin_icrc3_repair_archive_controllers : Any;
    #add_admin : Any;
    #add_authorized_for_caller : Any;
    #add_blacklisted_word : Any;
    #add_partner : Any;
    #add_project : Any;
    #add_whitelisted_token : Any;
    #admin_clear_avatar : Any;
    #admin_get_donations : Any;
    #admin_get_donations_by : Any;
    #admin_get_jailbreak_payments_for : Any;
    #admin_get_jailbreak_configs_for : Any;
    #admin_set_donation_account : Any;
    #admin_set_feedback_config : Any;
    #admin_set_donation_hidden : Any;
    #admin_export_avatars : Any;
    #admin_export_neuron_nicknames : Any;
    #admin_export_principal_nicknames : Any;
    #admin_set_names_canisters : Any;
    #admin_set_names_frozen : Any;
    #ban_user : Any;
    #caller_is_admin : Any;
    #check_ban_status : Any;
    #get_donation_account : Any;
    #get_feedback_config : Any;
    #get_donation_totals : Any;
    #get_donations : Any;
    #register_donation : () -> Donations.RegisterArgs;
    #clear_my_avatar : Any;
    #delete_canister_groups : Any;
    #delete_jailbreak_config : Any;
    #get_admins : Any;
    #get_all_jailbreak_configs_count : Any;
    #get_all_last_seen_log_ids : Any;
    #get_all_neuron_names : Any;
    #get_all_neuron_nicknames : Any;
    #get_all_principal_names : Any;
    #get_all_principal_nicknames : Any;
    #get_names_canisters : Any;
    #get_names_frozen : Any;
    #get_authorized_for_callers : Any;
    #get_avatar : Any;
    #get_avatar_count : Any;
    #get_avatars : Any;
    #get_ban_log : Any;
    #get_banned_users : Any;
    #get_blacklisted_words : Any;
    #get_cached_token_meta : Any;
    #get_canister_groups : Any;
    #get_canister_groups_limits_config : Any;
    #get_canister_info : Any;
    #get_jailbreak_fee_settings : Any;
    #get_jailbreak_payment_balance : Any;
    #get_jailbreak_payment_logs : Any;
    #get_jailbreak_payment_stats : Any;
    #get_jailbreak_payment_subaccount : Any;
    #get_last_seen_log_id : Any;
    #get_ledger_canister_ids : Any;
    #get_my_canister_groups_usage : Any;
    #get_my_jailbreak_configs : Any;
    #get_my_jailbreak_fee : Any;
    #get_my_jailbreak_price : Any;
    #set_admin_prices : Any;
    #set_partner_prices : Any;
    #remove_partner_prices : Any;
    #get_special_prices : Any;
    #get_special_prices_for : Any;
    #get_jailbreak_payment_price_tiers : Any;
    #get_my_nickname_usage : Any;
    #get_my_settings : Any;
    #get_neuron_name : Any;
    #get_neuron_nickname : Any;
    #get_nickname_limits_config : Any;
    #get_partner : Any;
    #get_partners : Any;
    #get_principal_name : Any;
    #get_principal_nickname : Any;
    #get_project : Any;
    #get_projects : Any;
    #get_refresh_all_progress : Any;
    #get_swap_canister_ids : Any;
    #get_token_list_status : Any;
    #get_tracked_canisters : Any;
    #get_user_ban_history : Any;
    #get_user_neurons : Any;
    #get_user_tokens : Any;
    #get_wallet_layout : Any;
    #get_whitelisted_tokens : Any;
    #import_whitelist_from_icpswap : Any;
    #import_whitelist_from_swaprunner : Any;
    #is_token_whitelisted : Any;
    #names_moderate : Any;
    #mark_logs_seen : Any;
    #refresh_token_metadata : Any;
    #register_ledger_canister_id : Any;
    #register_swap_canister_id : Any;
    #register_tracked_canister : Any;
    #register_tracked_canister_for : Any;
    #register_user_token : Any;
    #register_user_token_for : Any;
    #remove_admin : Any;
    #remove_authorized_for_caller : Any;
    #remove_blacklisted_word : Any;
    #remove_partner : Any;
    #remove_project : Any;
    #remove_whitelisted_token : Any;
    #run_token_list_maintenance_now : Any;
    #save_jailbreak_config : () -> (Principal, Text, Principal);
    #send_tokens : Any;
    #set_cached_token_meta : Any;
    #set_canister_groups : () -> CanisterGroupsRoot;
    #set_canister_name : () -> (Principal, Text);
    #set_jailbreak_fee_settings : Any;
    #set_my_avatar : () -> Text;
    #set_my_settings : () -> UserSettingsUpdate;
    #set_neuron_name : () -> (Principal, NeuronId, Text);
    #set_neuron_nickname : () -> (Principal, NeuronId, Text);
    #set_nickname_premium_canister : Any;
    #set_principal_name : () -> Text;
    #set_principal_name_for : () -> (Principal, Text, ?Principal);
    #set_principal_nickname : () -> (Principal, Text);
    #set_wallet_layout : () -> WalletLayout;
    #start_refresh_all_token_metadata : Any;
    #stop_refresh_all_token_metadata : Any;
    #test_calculate_ban_duration : Any;
    #transfer_position : Any;
    #unban_user : Any;
    #unregister_ledger_canister_id : Any;
    #unregister_swap_canister_id : Any;
    #unregister_tracked_canister : Any;
    #unregister_tracked_canister_for : Any;
    #unregister_user_token : Any;
    #unregister_user_token_for : Any;
    #unverify_neuron_name : Any;
    #unverify_principal_name : Any;
    #update_canister_groups_limits : Any;
    #update_nickname_limits : Any;
    #update_partner : Any;
    #update_project : Any;
    #verify_neuron_name : Any;
    #verify_principal_name : Any;
    #withdraw_jailbreak_payment : Any;
  } }) : Bool {
    switch (msg) {
      case (
        #get_api_doc _
        or #caller_is_admin _
        or #check_ban_status _
        or #get_admins _
        or #get_all_jailbreak_configs_count _
        or #get_all_last_seen_log_ids _
        or #get_all_neuron_names _
        or #get_all_neuron_nicknames _
        or #get_all_principal_names _
        or #get_all_principal_nicknames _
        or #get_authorized_for_callers _
        or #get_avatar _
        or #get_avatar_count _
        or #get_avatars _
        or #get_ban_log _
        or #get_banned_users _
        or #get_blacklisted_words _
        or #get_cached_token_meta _
        or #get_canister_groups _
        or #get_canister_groups_limits_config _
        or #get_jailbreak_fee_settings _
        or #get_jailbreak_payment_logs _
        or #get_jailbreak_payment_stats _
        or #get_special_prices _
        or #get_special_prices_for _
        or #get_jailbreak_payment_price_tiers _
        or #get_jailbreak_payment_subaccount _
        or #get_last_seen_log_id _
        or #get_ledger_canister_ids _
        or #get_my_jailbreak_configs _
        or #get_my_settings _
        or #get_neuron_name _
        or #get_neuron_nickname _
        or #get_nickname_limits_config _
        or #get_partner _
        or #get_partners _
        or #get_principal_name _
        or #get_principal_nickname _
        or #get_project _
        or #get_projects _
        or #get_refresh_all_progress _
        or #get_swap_canister_ids _
        or #get_token_list_status _
        or #get_tracked_canisters _
        or #get_user_ban_history _
        or #get_user_tokens _
        or #get_wallet_layout _
        or #get_whitelisted_tokens _
        or #is_token_whitelisted _
        or #admin_export_avatars _
        or #admin_export_neuron_nicknames _
        or #admin_export_principal_nicknames _
        or #get_names_canisters _
        or #get_names_frozen _
        or #get_donation_account _
        or #get_feedback_config _
        or #get_donation_totals _
        or #get_donations _
        or #admin_get_donations _
        or #admin_get_donations_by _
        or #admin_get_jailbreak_payments_for _
        or #admin_get_jailbreak_configs_for _
        or #icrc3_get_blocks _
        or #icrc3_get_archives _
        or #icrc3_get_tip_certificate _
        or #icrc3_supported_block_types _
        or #icrc10_supported_standards _
        or #icrc3_log_status _
        or #get_log _
      ) false;
      // the log's admin methods: admins only, small arguments
      case (#admin_set_icrc3_settings _ or #admin_icrc3_spill_now _ or #admin_icrc3_repair_archive_controllers _) is_admin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      // a message of at most 200 characters (Donations.MAX_MESSAGE)
      case (#register_donation f) arg.size() <= IngressGuard.textArg(Donations.MAX_MESSAGE) and IngressGuard.optText(f().message, Donations.MAX_MESSAGE) and IngressGuard.optBlob(f().from_subaccount, 32);
      // the naming service's canisters call it, never by ingress
      case (#names_moderate _) false;
      // names and nicknames: at most 32 characters (validate_name_text, set_canister_name)
      case (#set_principal_name f) nameOk(arg, f());
      case (#set_principal_name_for f) nameOk(arg, f().1);
      case (#set_principal_nickname f) nameOk(arg, f().1);
      case (#set_canister_name f) nameOk(arg, f().1);
      case (#set_neuron_name f) nameOk(arg, f().2);
      case (#set_neuron_nickname f) nameOk(arg, f().2);
      case (#set_my_avatar f) arg.size() <= IngressGuard.textArg(AVATAR_MAX_DATA_LENGTH) and IngressGuard.text(f(), AVATAR_MAX_DATA_LENGTH);
      case (#set_my_settings f) arg.size() <= IngressGuard.textArg(MAX_SETTING_TEXT) and IngressGuard.optText(f().denomination_token, MAX_SETTING_TEXT);
      case (#save_jailbreak_config f) arg.size() <= IngressGuard.textArg(MAX_NEURON_ID_HEX) and IngressGuard.text(f().1, MAX_NEURON_ID_HEX);
      // folders: as many as the premium limits allow (the method applies the caller's own limits)
      case (#set_canister_groups _) {
        let groups = Nat.max(stable_max_canister_groups, stable_premium_max_canister_groups);
        let canisters = Nat.max(stable_max_total_grouped_canisters, stable_premium_max_total_grouped_canisters);
        arg.size() <= IngressGuard.SMALL_ARG + groups * MAX_GROUP_BYTES + canisters * MAX_PRINCIPAL_BYTES
      };
      case (#set_wallet_layout f) {
        let l = f();
        l.tokens.size() + l.positions.size() + l.apps.size() + l.sneedapp.size() <= MAX_LAYOUT_ENTRIES
        and arg.size() <= IngressGuard.SMALL_ARG + MAX_LAYOUT_ENTRIES * MAX_PRINCIPAL_BYTES
      };
      // token metadata (logos included) for the shared cache: any signed-in user, any size
      case (#set_cached_token_meta _) not Principal.isAnonymous(caller);
      // admin tools with free-form content
      case (#add_blacklisted_word _ or #remove_blacklisted_word _ or #add_partner _ or #update_partner _ or #add_project _ or #update_project _ or #add_whitelisted_token _ or #ban_user _ or #admin_set_names_canisters _ or #admin_set_names_frozen _) is_admin(caller);
      case _ arg.size() <= IngressGuard.SMALL_ARG;
    };
  };

};