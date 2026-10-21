export const idlFactory = ({ IDL }) => {
  const Result = IDL.Variant({ 'ok' : IDL.Text, 'err' : IDL.Text });
  const ResultNat = IDL.Variant({ 'ok' : IDL.Nat, 'err' : IDL.Text });
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const BillingConfig = IDL.Record({
    'fee_destination' : IDL.Opt(Account),
    'icp_ledger' : IDL.Principal,
    'ledger_fee_e8s' : IDL.Nat,
    'fee_sweep_threshold_e8s' : IDL.Nat,
  });
  const Config = IDL.Record({
    'reminder_window_s' : IDL.Nat,
    'batch_size' : IDL.Nat,
    'notifications' : IDL.Opt(IDL.Principal),
    'max_watches_per_user' : IDL.Nat,
    'proposal_pages' : IDL.Nat,
    'max_continuations' : IDL.Nat,
    'sponsored' : IDL.Bool,
    'neuron_pages' : IDL.Nat,
    'max_snses' : IDL.Nat,
    'sns_wasm' : IDL.Principal,
    'max_calls_per_tick' : IDL.Nat,
    'interval_s' : IDL.Nat,
    'max_users' : IDL.Nat,
    'paused' : IDL.Bool,
    'neuron_cache_s' : IDL.Nat,
  });
  const Tier = IDL.Record({
    'daily_multiplier' : IDL.Nat,
    'every_min' : IDL.Nat,
  });
  const TierTable = IDL.Record({
    'tiers' : IDL.Vec(Tier),
    'base_daily_price_e8s' : IDL.Nat,
  });
  const TopicFilter = IDL.Variant({
    'all' : IDL.Null,
    'only' : IDL.Vec(IDL.Text),
  });
  const WatchSettings = IDL.Record({
    'reminder_window_s' : IDL.Nat,
    'every_min' : IDL.Nat,
    'topics' : TopicFilter,
    'reminders' : IDL.Bool,
    'new_proposals' : IDL.Bool,
  });
  const Tuning = IDL.Record({
    'max_refresh_per_round' : IDL.Nat,
    'parallel_calls' : IDL.Nat,
    'max_nns_neurons' : IDL.Nat,
    'user_refresh_min_s' : IDL.Nat,
    'topic_cache_s' : IDL.Nat,
    'max_pending_per_user' : IDL.Nat,
    'defaults' : WatchSettings,
    'neuron_refresh_s' : IDL.Nat,
    'nns_governance' : IDL.Principal,
  });
  const CreditResult = IDL.Variant({
    'ok' : IDL.Record({
      'credited_e8s' : IDL.Nat,
      'balance_e8s' : IDL.Nat,
      'paused' : IDL.Bool,
    }),
    'err' : IDL.Text,
  });
  const Accounting = IDL.Record({
    'fees_collected_e8s' : IDL.Nat,
    'user_balances_e8s' : IDL.Nat,
    'withdrawals_e8s' : IDL.Nat,
    'fees_available_e8s' : IDL.Nat,
    'fee_forwards' : IDL.Nat,
    'fees_withdrawn_e8s' : IDL.Nat,
    'icp_ledger' : IDL.Principal,
    'accounts' : IDL.Nat,
    'fees_forwarded_e8s' : IDL.Nat,
    'paused_users' : IDL.Nat,
    'deposits_e8s' : IDL.Nat,
    'obligations_e8s' : IDL.Nat,
  });
  const AllConfig = IDL.Record({
    'tuning' : Tuning,
    'tiers' : TierTable,
    'core' : Config,
    'billing' : BillingConfig,
  });
  const MyBalance = IDL.Record({
    'watches' : IDL.Nat,
    'deposited_e8s' : IDL.Nat,
    'deposit_account' : Account,
    'charged_e8s' : IDL.Nat,
    'per_day_e8s' : IDL.Nat,
    'per_round_of_checks_e8s' : IDL.Nat,
    'withdrawn_e8s' : IDL.Nat,
    'balance_e8s' : IDL.Nat,
    'checks' : IDL.Nat,
    'paused' : IDL.Bool,
  });
  const Target = IDL.Variant({ 'nns' : IDL.Null, 'sns' : IDL.Principal });
  const ChargeEntry = IDL.Record({
    'at' : IDL.Int,
    'every_min' : IDL.Nat,
    'target' : Target,
    'price_e8s' : IDL.Nat,
    'outcome' : IDL.Text,
  });
  const ChargeEntryTiered = IDL.Record({
    'at' : IDL.Int,
    'every_min' : IDL.Nat,
    'target' : Target,
    'price_e8s' : IDL.Nat,
    'outcome' : IDL.Text,
    'price_tier' : IDL.Text,
  });
  const MonTopic = IDL.Variant({ 'proposals' : IDL.Null });
  const MyWatch = IDL.Record({
    'price_per_check_e8s' : IDL.Nat,
    'topic' : MonTopic,
    'pending' : IDL.Nat,
    'name' : IDL.Text,
    'next_check_at' : IDL.Int,
    'neurons_at' : IDL.Int,
    'target' : Target,
    'settings' : WatchSettings,
    'governance' : IDL.Principal,
    'neurons' : IDL.Opt(IDL.Nat),
  });
  const MonPrices = IDL.Record({ 'base_daily_price_e8s' : IDL.Opt(IDL.Nat) });
  const MonPartnerListing = IDL.Record({
    'principal' : IDL.Principal,
    'label' : IDL.Text,
    'prices' : MonPrices,
    'expires_at' : IDL.Opt(IDL.Int),
  });
  const SpecialPrices = IDL.Record({
    'admin_prices' : MonPrices,
    'partners' : IDL.Vec(MonPartnerListing),
  });
  const MonPartner = IDL.Record({
    'label' : IDL.Text,
    'prices' : MonPrices,
    'expires_at' : IDL.Opt(IDL.Int),
  });
  const SpecialPricesFor = IDL.Record({
    'admin_prices' : IDL.Opt(MonPrices),
    'partner' : IDL.Opt(MonPartner),
  });
  const Period = IDL.Record({
    'revenue_e8s' : IDL.Nat,
    'cycles_burned' : IDL.Nat,
    'checks' : IDL.Nat,
    'rounds' : IDL.Nat,
  });
  const Economics = IDL.Record({
    'total' : Period,
    'last_round_cycles' : IDL.Nat,
    'last_24h' : Period,
    'last_30d' : Period,
  });
  const Backlog = IDL.Record({
    'pending_messages' : IDL.Nat,
    'round_open' : IDL.Bool,
    'users_with_pending' : IDL.Nat,
    'neuron_caches_stale' : IDL.Nat,
    'neuron_caches_missing' : IDL.Nat,
    'ballots_to_fetch' : IDL.Nat,
    'checks_due' : IDL.Nat,
  });
  const Status = IDL.Record({
    'last_error' : IDL.Opt(IDL.Tuple(IDL.Int, IDL.Text)),
    'round_ticks' : IDL.Nat,
    'skipped_rate_limited' : IDL.Nat,
    'skipped_other' : IDL.Nat,
    'watches' : IDL.Nat,
    'notifications' : IDL.Opt(IDL.Principal),
    'sent' : IDL.Nat,
    'errors' : IDL.Nat,
    'open_proposals' : IDL.Nat,
    'last_round_end' : IDL.Int,
    'skipped_not_allowed' : IDL.Nat,
    'last_round_start' : IDL.Int,
    'cycles' : IDL.Nat,
    'targets' : IDL.Nat,
    'economics' : Economics,
    'calls_total' : IDL.Nat,
    'app_id' : IDL.Opt(IDL.Nat),
    'interval_s' : IDL.Nat,
    'users' : IDL.Nat,
    'last_round_duration_ns' : IDL.Int,
    'paused_users' : IDL.Nat,
    'rounds' : IDL.Nat,
    'deduplicated' : IDL.Nat,
    'calls_last_round' : IDL.Nat,
    'running' : IDL.Bool,
    'paused' : IDL.Bool,
    'backlog' : Backlog,
  });
  const TopicOption = IDL.Record({
    'key' : IDL.Text,
    'name' : IDL.Text,
    'description' : IDL.Text,
  });
  const TargetInfo = IDL.Record({
    'last_error' : IDL.Opt(IDL.Tuple(IDL.Int, IDL.Text)),
    'name' : IDL.Text,
    'open' : IDL.Vec(
      IDL.Record({
        'id' : IDL.Nat64,
        'title' : IDL.Text,
        'deadline_s' : IDL.Nat64,
        'windows_done' : IDL.Vec(IDL.Nat),
        'new_done' : IDL.Bool,
        'topic_key' : IDL.Text,
      })
    ),
    'errors' : IDL.Nat,
    'poll_every_min' : IDL.Opt(IDL.Nat),
    'target' : Target,
    'governance' : IDL.Principal,
    'active_watchers' : IDL.Nat,
    'listed_at' : IDL.Int,
    'watchers' : IDL.Nat,
  });
  const TierPrice = IDL.Record({
    'checks_per_day' : IDL.Nat,
    'daily_price_e8s' : IDL.Nat,
    'daily_multiplier' : IDL.Nat,
    'every_min' : IDL.Nat,
    'per_check_e8s' : IDL.Nat,
  });
  const Level = IDL.Variant({
    'normal' : IDL.Null,
    'info' : IDL.Null,
    'urgent' : IDL.Null,
  });
  const NTopic = IDL.Record({
    'id' : IDL.Text,
    'title' : IDL.Text,
    'description' : IDL.Text,
    'level' : Level,
  });
  const SpResult = IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text });
  const WatchSettingsInput = IDL.Record({
    'reminder_window_s' : IDL.Opt(IDL.Nat),
    'every_min' : IDL.Opt(IDL.Nat),
    'topics' : IDL.Opt(TopicFilter),
    'reminders' : IDL.Opt(IDL.Bool),
    'new_proposals' : IDL.Opt(IDL.Bool),
  });
  const SneedMon = IDL.Service({
    'admin_add_admin' : IDL.Func([IDL.Principal], [Result], []),
    'admin_pause' : IDL.Func([], [Result], []),
    'admin_register_with_notifications' : IDL.Func([], [ResultNat], []),
    'admin_remove_admin' : IDL.Func([IDL.Principal], [Result], []),
    'admin_resume' : IDL.Func([], [Result], []),
    'admin_run_now' : IDL.Func([], [Result], []),
    'admin_set_app_id' : IDL.Func([IDL.Opt(IDL.Nat)], [Result], []),
    'admin_set_billing' : IDL.Func([BillingConfig], [Result], []),
    'admin_set_config' : IDL.Func([Config], [Result], []),
    'admin_set_fee_destination' : IDL.Func([IDL.Opt(Account)], [Result], []),
    'admin_set_fee_sweep_threshold' : IDL.Func([IDL.Nat], [Result], []),
    'admin_set_interval' : IDL.Func([IDL.Nat], [Result], []),
    'admin_set_notifications_canister' : IDL.Func(
        [IDL.Opt(IDL.Principal)],
        [Result],
        [],
      ),
    'admin_set_tiers' : IDL.Func([TierTable], [Result], []),
    'admin_set_tuning' : IDL.Func([Tuning], [Result], []),
    'admin_update_notifications_app' : IDL.Func([], [Result], []),
    'admin_withdraw_fees' : IDL.Func([IDL.Nat, Account], [ResultNat], []),
    'credit_deposit' : IDL.Func([], [CreditResult], []),
    'get_accounting' : IDL.Func([], [Accounting], ['query']),
    'get_admins' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_api_doc' : IDL.Func([], [IDL.Text], ['query']),
    'get_billing_config' : IDL.Func([], [BillingConfig], ['query']),
    'get_config' : IDL.Func([], [AllConfig], ['query']),
    'get_deposit_account' : IDL.Func([], [Account], ['query']),
    'get_my_balance' : IDL.Func([], [MyBalance], ['query']),
    'get_my_charges' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [IDL.Record({ 'total' : IDL.Nat, 'entries' : IDL.Vec(ChargeEntry) })],
        ['query'],
      ),
    'get_my_charges_with_tier' : IDL.Func(
        [IDL.Nat, IDL.Nat],
        [
          IDL.Record({
            'total' : IDL.Nat,
            'entries' : IDL.Vec(ChargeEntryTiered),
          }),
        ],
        ['query'],
      ),
    'get_my_nns_neurons' : IDL.Func([], [IDL.Vec(IDL.Nat64)], ['query']),
    'get_my_watches' : IDL.Func([], [IDL.Vec(MyWatch)], ['query']),
    'get_special_prices' : IDL.Func([], [SpecialPrices], ['query']),
    'get_special_prices_for' : IDL.Func(
        [IDL.Principal],
        [SpecialPricesFor],
        ['query'],
      ),
    'get_status' : IDL.Func([], [Status], ['query']),
    'get_target_topics' : IDL.Func(
        [Target],
        [IDL.Opt(IDL.Vec(TopicOption))],
        ['query'],
      ),
    'get_targets' : IDL.Func([], [IDL.Vec(TargetInfo)], ['query']),
    'get_tiers' : IDL.Func(
        [],
        [
          IDL.Record({
            'tiers' : IDL.Vec(TierPrice),
            'base_daily_price_e8s' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'get_topics' : IDL.Func([], [IDL.Vec(NTopic)], ['query']),
    'get_tuning' : IDL.Func([], [Tuning], ['query']),
    'get_watch' : IDL.Func([Target], [IDL.Opt(MyWatch)], ['query']),
    'list_target_topics' : IDL.Func(
        [Target],
        [IDL.Variant({ 'ok' : IDL.Vec(TopicOption), 'err' : IDL.Text })],
        [],
      ),
    'refresh_my_neurons' : IDL.Func([Target], [ResultNat], []),
    'remove_partner_prices' : IDL.Func([IDL.Principal], [SpResult], []),
    'set_admin_prices' : IDL.Func([MonPrices], [SpResult], []),
    'set_nns_neurons' : IDL.Func([IDL.Vec(IDL.Nat64)], [Result], []),
    'set_partner_prices' : IDL.Func(
        [IDL.Principal, MonPartner],
        [SpResult],
        [],
      ),
    'unwatch' : IDL.Func([Target], [Result], []),
    'update_watch' : IDL.Func([Target, WatchSettingsInput], [Result], []),
    'watch' : IDL.Func([Target], [Result], []),
    'withdraw_balance' : IDL.Func([IDL.Nat, Account], [ResultNat], []),
  });
  return SneedMon;
};
export const init = ({ IDL }) => { return []; };
