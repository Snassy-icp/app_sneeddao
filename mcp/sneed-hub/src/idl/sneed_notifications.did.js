export const idlFactory = ({ IDL }) => {
  const GetBlocksResult = IDL.Rec();
  const Value = IDL.Rec();
  const ChannelKind = IDL.Variant({
    'sms' : IDL.Null,
    'push' : IDL.Null,
    'email' : IDL.Null,
    'discord' : IDL.Null,
    'telegram' : IDL.Null,
    'sneed_sms' : IDL.Null,
  });
  const ResultNat = IDL.Variant({ 'ok' : IDL.Nat, 'err' : IDL.Text });
  const Result = IDL.Variant({ 'ok' : IDL.Text, 'err' : IDL.Text });
  const AppId = IDL.Nat;
  const Level = IDL.Variant({
    'normal' : IDL.Null,
    'info' : IDL.Null,
    'urgent' : IDL.Null,
  });
  const Topic = IDL.Record({
    'id' : IDL.Text,
    'title' : IDL.Text,
    'description' : IDL.Text,
    'level' : Level,
  });
  const App = IDL.Record({
    'id' : AppId,
    'verified' : IDL.Bool,
    'owner' : IDL.Principal,
    'logo' : IDL.Opt(IDL.Text),
    'name' : IDL.Text,
    'description' : IDL.Text,
    'created_at' : IDL.Int,
    'topics' : IDL.Vec(Topic),
    'canisters' : IDL.Vec(IDL.Principal),
  });
  const ChannelId = IDL.Nat;
  const TopicRule = IDL.Variant({
    'mute' : IDL.Null,
    'channels' : IDL.Vec(ChannelId),
    'level' : Level,
  });
  const Permission = IDL.Record({
    'daily_spend_cap_e8s' : IDL.Nat,
    'daily_cap' : IDL.Nat,
    'allowed' : IDL.Bool,
    'demote' : IDL.Bool,
    'topics' : IDL.Vec(IDL.Tuple(IDL.Text, TopicRule)),
    'muted_until' : IDL.Opt(IDL.Int),
    'copy_only' : IDL.Bool,
  });
  const NotificationId = IDL.Nat;
  const JobState = IDL.Variant({
    'suppressed' : IDL.Record({ 'reason' : IDL.Text }),
    'sending' : IDL.Record({ 'since' : IDL.Int, 'relay' : IDL.Principal }),
    'delivered' : IDL.Record({ 'at' : IDL.Int }),
    'queued' : IDL.Null,
    'failed' : IDL.Record({ 'reason' : IDL.Text }),
  });
  const HistoryItem = IDL.Record({
    'id' : NotificationId,
    'app' : AppId,
    'title' : IDL.Text,
    'topic' : IDL.Text,
    'deliveries' : IDL.Vec(
      IDL.Record({
        'kind' : ChannelKind,
        'state' : JobState,
        'channel' : ChannelId,
      })
    ),
    'body' : IDL.Text,
    'link' : IDL.Opt(IDL.Text),
    'created_at' : IDL.Int,
    'level' : Level,
    'app_name' : IDL.Text,
  });
  const ChannelState = IDL.Variant({
    'verified' : IDL.Null,
    'unverified' : IDL.Null,
  });
  const Channel = IDL.Record({
    'id' : ChannelId,
    'kind' : ChannelKind,
    'name' : IDL.Text,
    'created_at' : IDL.Int,
    'state' : ChannelState,
    'address' : IDL.Vec(IDL.Nat8),
  });
  const QuietHours = IDL.Record({
    'start_min' : IDL.Nat,
    'utc_offset_min' : IDL.Int,
    'end_min' : IDL.Nat,
    'urgent_passes' : IDL.Bool,
  });
  const Settings = IDL.Record({
    'snooze_until' : IDL.Opt(IDL.Int),
    'always_copy' : IDL.Opt(ChannelId),
    'quiet' : IDL.Opt(QuietHours),
    'defaults' : IDL.Record({
      'normal' : IDL.Vec(ChannelId),
      'info' : IDL.Vec(ChannelId),
      'urgent' : IDL.Vec(ChannelId),
    }),
  });
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const Withdrawal = IDL.Record({
    'at' : IDL.Int,
    'to' : Account,
    'sent_e8s' : IDL.Nat,
    'ledger_block' : IDL.Nat,
    'fee_e8s' : IDL.Nat,
    'amount_e8s' : IDL.Nat,
    'created_at_time' : IDL.Nat64,
  });
  const PendingWithdrawal = IDL.Record({
    'to' : Account,
    'memo' : IDL.Vec(IDL.Nat8),
    'attempts' : IDL.Nat,
    'fee_e8s' : IDL.Nat,
    'amount_e8s' : IDL.Nat,
    'state' : IDL.Variant({
      'too_old' : IDL.Null,
      'sending' : IDL.Null,
      'unknown' : IDL.Text,
    }),
    'created_at_time' : IDL.Nat64,
    'started_at' : IDL.Int,
  });
  const TopUp = IDL.Record({
    'at' : IDL.Int,
    'app' : IDL.Opt(AppId),
    'via' : IDL.Variant({
      'admin_credit' : IDL.Null,
      'app_top_up' : IDL.Null,
      'top_up' : IDL.Null,
    }),
    'ledger_block' : IDL.Nat,
    'amount_e8s' : IDL.Nat,
  });
  const AdminUserView = IDL.Record({
    'pending_jobs' : IDL.Nat,
    'low_balance_alert' : IDL.Record({
      'alerted' : IDL.Bool,
      'threshold_e8s' : IDL.Nat,
    }),
    'apps' : IDL.Vec(IDL.Tuple(App, Permission)),
    'history' : IDL.Vec(HistoryItem),
    'channels' : IDL.Vec(Channel),
    'settings' : Settings,
    'reserved_e8s' : IDL.Nat,
    'withdrawals' : IDL.Vec(Withdrawal),
    'withdraw_pending' : IDL.Opt(PendingWithdrawal),
    'requests' : IDL.Vec(App),
    'balance_e8s' : IDL.Nat,
    'top_ups' : IDL.Vec(TopUp),
  });
  const AppInput = IDL.Record({
    'logo' : IDL.Opt(IDL.Text),
    'name' : IDL.Text,
    'description' : IDL.Text,
    'topics' : IDL.Vec(Topic),
    'canisters' : IDL.Vec(IDL.Principal),
  });
  const Config = IDL.Record({
    'relays' : IDL.Vec(IDL.Tuple(IDL.Principal, ChannelKind)),
    'max_title' : IDL.Nat,
    'max_body' : IDL.Nat,
    'dedupe_window_ns' : IDL.Nat,
    'retention_ns' : IDL.Nat,
    'notify_price_e8s' : IDL.Nat,
    'default_daily_spend_cap_e8s' : IDL.Nat,
    'prices_e8s' : IDL.Vec(IDL.Tuple(ChannelKind, IDL.Nat)),
    'default_daily_cap' : IDL.Nat,
    'icp_ledger' : IDL.Principal,
    'sns_wasm' : IDL.Principal,
    'max_attempts' : IDL.Nat,
    'relay_lease_ns' : IDL.Nat,
    'sneed_sms' : IDL.Principal,
  });
  const SettingsUpdate = IDL.Record({
    'archive_top_up_threshold' : IDL.Opt(IDL.Nat),
    'archive_max_blocks' : IDL.Opt(IDL.Nat),
    'max_live_blocks' : IDL.Opt(IDL.Nat),
    'archive_initial_cycles' : IDL.Opt(IDL.Nat),
    'spill_batch_size' : IDL.Opt(IDL.Nat),
    'archive_top_up_amount' : IDL.Opt(IDL.Nat),
  });
  const Settings__1 = IDL.Record({
    'archive_top_up_threshold' : IDL.Nat,
    'archive_max_blocks' : IDL.Nat,
    'max_live_blocks' : IDL.Nat,
    'archive_initial_cycles' : IDL.Nat,
    'spill_batch_size' : IDL.Nat,
    'archive_top_up_amount' : IDL.Nat,
  });
  const Rule = IDL.Record({ 'per_minute' : IDL.Nat, 'capacity' : IDL.Nat });
  const FeeForwarding = IDL.Record({
    'last_error' : IDL.Opt(IDL.Text),
    'ledger_fees_paid_e8s' : IDL.Nat,
    'destination' : IDL.Opt(Account),
    'retry_pending' : IDL.Bool,
    'backlog_e8s' : IDL.Opt(IDL.Nat),
    'forwards' : IDL.Nat,
    'refunded_e8s' : IDL.Nat,
    'earned_e8s' : IDL.Nat,
    'ledger_fee_e8s' : IDL.Nat,
    'reserved_e8s' : IDL.Nat,
    'events' : IDL.Vec(IDL.Tuple(IDL.Int, IDL.Text)),
    'threshold_e8s' : IDL.Nat,
    'liabilities_e8s' : IDL.Nat,
    'last_forward' : IDL.Opt(
      IDL.Record({
        'at' : IDL.Int,
        'to' : Account,
        'amount_e8s' : IDL.Nat,
        'block' : IDL.Nat,
      })
    ),
    'unforwarded_e8s' : IDL.Opt(IDL.Nat),
    'last_check' : IDL.Int,
    'forwarded_e8s' : IDL.Nat,
  });
  const LogEntry = IDL.Record({
    'id' : IDL.Nat,
    'ts' : IDL.Int,
    'cid' : IDL.Nat,
    'level' : IDL.Variant({ 'info' : IDL.Null, 'error' : IDL.Null }),
    'message' : IDL.Text,
    'caller' : IDL.Principal,
  });
  const PrepaidView = IDL.Record({
    'min_withdraw_e8s' : IDL.Nat,
    'ledger_fee_e8s' : IDL.Nat,
    'reserved_e8s' : IDL.Nat,
    'withdrawals' : IDL.Vec(Withdrawal),
    'withdraw_pending' : IDL.Opt(PendingWithdrawal),
    'withdrawn_e8s' : IDL.Nat,
    'balance_e8s' : IDL.Nat,
    'top_ups' : IDL.Vec(TopUp),
  });
  const Receipt = IDL.Record({
    'id' : NotificationId,
    'created_at' : IDL.Int,
    'state' : IDL.Variant({
      'suppressed' : IDL.Text,
      'expired' : IDL.Null,
      'pending' : IDL.Null,
      'delivered' : IDL.Null,
      'failed' : IDL.Text,
    }),
  });
  const SupportedStandard = IDL.Record({ 'url' : IDL.Text, 'name' : IDL.Text });
  const GetArchivesArgs = IDL.Record({ 'from' : IDL.Opt(IDL.Principal) });
  const ArchiveRange = IDL.Record({
    'end' : IDL.Nat,
    'canister_id' : IDL.Principal,
    'start' : IDL.Nat,
  });
  const GetArchivesResult = IDL.Vec(ArchiveRange);
  const BlockRange = IDL.Record({ 'start' : IDL.Nat, 'length' : IDL.Nat });
  const GetBlocksArgs = IDL.Vec(BlockRange);
  Value.fill(
    IDL.Variant({
      'Int' : IDL.Int,
      'Map' : IDL.Vec(IDL.Tuple(IDL.Text, Value)),
      'Nat' : IDL.Nat,
      'Blob' : IDL.Vec(IDL.Nat8),
      'Text' : IDL.Text,
      'Array' : IDL.Vec(Value),
    })
  );
  const Block = IDL.Record({ 'id' : IDL.Nat, 'block' : Value });
  const ArchivedBlocks = IDL.Record({
    'args' : GetBlocksArgs,
    'callback' : IDL.Func([GetBlocksArgs], [GetBlocksResult], ['query']),
  });
  GetBlocksResult.fill(
    IDL.Record({
      'log_length' : IDL.Nat,
      'blocks' : IDL.Vec(Block),
      'archived_blocks' : IDL.Vec(ArchivedBlocks),
    })
  );
  const DataCertificate = IDL.Record({
    'certificate' : IDL.Vec(IDL.Nat8),
    'hash_tree' : IDL.Vec(IDL.Nat8),
  });
  const ArchiveInfo = IDL.Record({
    'canister_id' : IDL.Principal,
    'start' : IDL.Nat,
    'length' : IDL.Nat,
    'max_blocks' : IDL.Nat,
  });
  const LogStatus = IDL.Record({
    'live_blocks' : IDL.Nat,
    'live_first_index' : IDL.Nat,
    'history_imported' : IDL.Bool,
    'spilling' : IDL.Bool,
    'settings' : Settings__1,
    'log_length' : IDL.Nat,
    'last_block_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'archives' : IDL.Vec(ArchiveInfo),
  });
  const BlockType = IDL.Record({ 'url' : IDL.Text, 'block_type' : IDL.Text });
  const NotifyInput = IDL.Record({
    'title' : IDL.Text,
    'topic' : IDL.Text,
    'body' : IDL.Text,
    'link' : IDL.Opt(IDL.Text),
    'sponsored' : IDL.Bool,
    'user' : IDL.Principal,
    'dedupe' : IDL.Opt(IDL.Text),
  });
  const NotifyError = IDL.Variant({
    'invalid' : IDL.Text,
    'rate_limited' : IDL.Null,
    'not_registered' : IDL.Null,
    'unknown_topic' : IDL.Null,
    'no_funds' : IDL.Null,
    'not_allowed' : IDL.Null,
  });
  const NotifyResult = IDL.Variant({
    'ok' : IDL.Record({
      'id' : NotificationId,
      'deliveries' : IDL.Nat,
      'deduplicated' : IDL.Bool,
    }),
    'err' : NotifyError,
  });
  const JobId = IDL.Nat;
  const RelayJob = IDL.Record({
    'id' : JobId,
    'app' : IDL.Text,
    'title' : IDL.Text,
    'body' : IDL.Text,
    'kind' : ChannelKind,
    'link' : IDL.Opt(IDL.Text),
    'created_at' : IDL.Int,
    'level' : Level,
    'address' : IDL.Vec(IDL.Nat8),
  });
  const WithdrawArgs = IDL.Record({
    'to' : Account,
    'amount_e8s' : IDL.Nat,
    'created_at_time' : IDL.Opt(IDL.Nat64),
  });
  const WithdrawOk = IDL.Record({
    'sent_e8s' : IDL.Nat,
    'ledger_block' : IDL.Nat,
    'fee_e8s' : IDL.Nat,
    'amount_e8s' : IDL.Nat,
    'balance_e8s' : IDL.Nat,
  });
  const WithdrawError = IDL.Variant({
    'amount_too_small' : IDL.Record({ 'min_e8s' : IDL.Nat }),
    'pending' : PendingWithdrawal,
    'insufficient_balance' : IDL.Record({ 'balance_e8s' : IDL.Nat }),
    'invalid' : IDL.Text,
    'rate_limited' : IDL.Null,
    'busy' : IDL.Null,
    'not_signed_in' : IDL.Null,
    'duplicate' : IDL.Record({ 'ledger_block' : IDL.Nat }),
    'refused' : IDL.Text,
  });
  const WithdrawResult = IDL.Variant({
    'ok' : WithdrawOk,
    'err' : WithdrawError,
  });
  return IDL.Service({
    'add_channel' : IDL.Func(
        [ChannelKind, IDL.Text, IDL.Vec(IDL.Nat8)],
        [ResultNat],
        [],
      ),
    'admin_add_admin' : IDL.Func([IDL.Principal], [Result], []),
    'admin_credit' : IDL.Func(
        [IDL.Principal, IDL.Nat, IDL.Nat],
        [ResultNat],
        [],
      ),
    'admin_forward_fees_now' : IDL.Func([], [Result], []),
    'admin_get_removed_app' : IDL.Func([IDL.Nat], [IDL.Opt(App)], ['query']),
    'admin_get_user' : IDL.Func(
        [IDL.Principal, IDL.Nat],
        [IDL.Variant({ 'ok' : AdminUserView, 'err' : IDL.Text })],
        ['query'],
      ),
    'admin_icrc3_repair_archive_controllers' : IDL.Func(
        [],
        [
          IDL.Vec(
            IDL.Tuple(
              IDL.Principal,
              IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text }),
            )
          ),
        ],
        [],
      ),
    'admin_icrc3_spill_now' : IDL.Func(
        [],
        [IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text })],
        [],
      ),
    'admin_register_app' : IDL.Func([IDL.Principal, AppInput], [ResultNat], []),
    'admin_remove_admin' : IDL.Func([IDL.Principal], [Result], []),
    'admin_remove_app' : IDL.Func([IDL.Nat], [Result], []),
    'admin_resolve_withdraw' : IDL.Func(
        [IDL.Principal, IDL.Opt(IDL.Nat)],
        [Result],
        [],
      ),
    'admin_set_app_verified' : IDL.Func([IDL.Nat, IDL.Bool], [Result], []),
    'admin_set_config' : IDL.Func([Config], [Result], []),
    'admin_set_fee_destination' : IDL.Func([IDL.Opt(Account)], [Result], []),
    'admin_set_fee_sweep_threshold' : IDL.Func([IDL.Nat], [Result], []),
    'admin_set_icrc3_settings' : IDL.Func(
        [SettingsUpdate],
        [IDL.Variant({ 'Ok' : Settings__1, 'Err' : IDL.Text })],
        [],
      ),
    'admin_set_rate_limit' : IDL.Func([IDL.Text, IDL.Opt(Rule)], [Result], []),
    'admin_set_relay_key' : IDL.Func([ChannelKind, IDL.Text], [Result], []),
    'allow_app' : IDL.Func([IDL.Nat, IDL.Bool], [Result], []),
    'claim_removed_app_balance' : IDL.Func([IDL.Nat], [ResultNat], []),
    'get_admins' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_api_doc' : IDL.Func([], [IDL.Text], ['query']),
    'get_app' : IDL.Func([IDL.Nat], [IDL.Opt(App)], ['query']),
    'get_app_balance' : IDL.Func([IDL.Nat], [IDL.Nat], ['query']),
    'get_app_of' : IDL.Func([IDL.Principal], [IDL.Opt(App)], ['query']),
    'get_config' : IDL.Func([], [Config], ['query']),
    'get_fee_forwarding' : IDL.Func([], [FeeForwarding], ['query']),
    'get_log' : IDL.Func([IDL.Nat, IDL.Nat], [IDL.Vec(LogEntry)], ['query']),
    'get_low_balance_alert' : IDL.Func(
        [],
        [IDL.Record({ 'default_e8s' : IDL.Nat, 'threshold_e8s' : IDL.Nat })],
        ['query'],
      ),
    'get_my_apps' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(App, Permission))],
        ['query'],
      ),
    'get_my_history' : IDL.Func([IDL.Nat], [IDL.Vec(HistoryItem)], ['query']),
    'get_my_prepaid' : IDL.Func([], [PrepaidView], ['query']),
    'get_my_requests' : IDL.Func([], [IDL.Vec(App)], ['query']),
    'get_my_settings' : IDL.Func(
        [],
        [
          IDL.Record({
            'channels' : IDL.Vec(Channel),
            'settings' : Settings,
            'balance_e8s' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'get_rate_limits' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Text, Rule))],
        ['query'],
      ),
    'get_receipts' : IDL.Func(
        [IDL.Vec(IDL.Nat)],
        [IDL.Vec(IDL.Opt(Receipt))],
        ['query'],
      ),
    'get_relay_keys' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(ChannelKind, IDL.Text))],
        ['query'],
      ),
    'icrc10_supported_standards' : IDL.Func(
        [],
        [IDL.Vec(SupportedStandard)],
        ['query'],
      ),
    'icrc3_get_archives' : IDL.Func(
        [GetArchivesArgs],
        [GetArchivesResult],
        ['query'],
      ),
    'icrc3_get_blocks' : IDL.Func(
        [GetBlocksArgs],
        [GetBlocksResult],
        ['query'],
      ),
    'icrc3_get_tip_certificate' : IDL.Func(
        [],
        [IDL.Opt(DataCertificate)],
        ['query'],
      ),
    'icrc3_log_status' : IDL.Func([], [LogStatus], ['query']),
    'icrc3_supported_block_types' : IDL.Func(
        [],
        [IDL.Vec(BlockType)],
        ['query'],
      ),
    'list_apps' : IDL.Func([IDL.Nat, IDL.Nat], [IDL.Vec(App)], ['query']),
    'notify' : IDL.Func([NotifyInput], [NotifyResult], []),
    'notify_batch' : IDL.Func(
        [IDL.Vec(NotifyInput)],
        [IDL.Vec(NotifyResult)],
        [],
      ),
    'register_app' : IDL.Func([AppInput], [ResultNat], []),
    'relay_ack' : IDL.Func(
        [
          IDL.Vec(
            IDL.Tuple(
              IDL.Nat,
              IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text }),
            )
          ),
        ],
        [],
        [],
      ),
    'relay_pull' : IDL.Func([IDL.Nat], [IDL.Vec(RelayJob)], []),
    'remove_channel' : IDL.Func([IDL.Nat], [Result], []),
    'request_permission' : IDL.Func([IDL.Principal], [Result], []),
    'resend_code' : IDL.Func([IDL.Nat], [Result], []),
    'set_low_balance_alert' : IDL.Func([IDL.Nat], [Result], []),
    'set_permission' : IDL.Func([IDL.Nat, Permission], [Result], []),
    'set_settings' : IDL.Func([Settings], [Result], []),
    'stats' : IDL.Func(
        [],
        [
          IDL.Record({
            'ticking' : IDL.Bool,
            'pending' : IDL.Nat,
            'notifications' : IDL.Nat,
            'apps' : IDL.Nat,
            'users' : IDL.Nat,
            'last_tick_at' : IDL.Int,
          }),
        ],
        ['query'],
      ),
    'top_up' : IDL.Func([IDL.Nat], [ResultNat], []),
    'top_up_app' : IDL.Func([IDL.Nat, IDL.Nat], [ResultNat], []),
    'update_app' : IDL.Func([IDL.Nat, AppInput], [Result], []),
    'verify_channel' : IDL.Func([IDL.Nat, IDL.Text], [Result], []),
    'withdraw' : IDL.Func([WithdrawArgs], [WithdrawResult], []),
  });
};
export const init = ({ IDL }) => { return []; };
