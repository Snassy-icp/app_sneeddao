export const idlFactory = ({ IDL }) => {
  const GetBlocksResult = IDL.Rec();
  const Value = IDL.Rec();
  const SMSError = IDL.Variant({
    'InvalidInput' : IDL.Text,
    'NotFound' : IDL.Text,
    'Unauthorized' : IDL.Text,
    'AlreadyExists' : IDL.Text,
    'RateLimited' : IDL.Text,
  });
  const Result = IDL.Variant({ 'ok' : IDL.Null, 'err' : SMSError });
  const MessageResponse = IDL.Record({
    'id' : IDL.Nat,
    'updated_at' : IDL.Int,
    'reply_to' : IDL.Opt(IDL.Vec(IDL.Nat)),
    'subject' : IDL.Text,
    'can_remove_self' : IDL.Bool,
    'body' : IDL.Text,
    'created_at' : IDL.Int,
    'sender' : IDL.Principal,
    'recipients' : IDL.Vec(IDL.Principal),
  });
  const AdminMessagePage = IDL.Record({
    'next_before' : IDL.Opt(IDL.Nat),
    'total' : IDL.Nat,
    'messages' : IDL.Vec(MessageResponse),
  });
  const SettingsUpdate = IDL.Record({
    'archive_top_up_threshold' : IDL.Opt(IDL.Nat),
    'archive_max_blocks' : IDL.Opt(IDL.Nat),
    'max_live_blocks' : IDL.Opt(IDL.Nat),
    'archive_initial_cycles' : IDL.Opt(IDL.Nat),
    'spill_batch_size' : IDL.Opt(IDL.Nat),
    'archive_top_up_amount' : IDL.Opt(IDL.Nat),
  });
  const Settings = IDL.Record({
    'archive_top_up_threshold' : IDL.Nat,
    'archive_max_blocks' : IDL.Nat,
    'max_live_blocks' : IDL.Nat,
    'archive_initial_cycles' : IDL.Nat,
    'spill_batch_size' : IDL.Nat,
    'archive_top_up_amount' : IDL.Nat,
  });
  const RateRule = IDL.Record({ 'per_minute' : IDL.Nat, 'capacity' : IDL.Nat });
  const AdminInfo = IDL.Record({
    'principal' : IDL.Principal,
    'added_at' : IDL.Int,
    'added_by' : IDL.Nat32,
  });
  const Result_2 = IDL.Variant({
    'ok' : IDL.Vec(IDL.Principal),
    'err' : SMSError,
  });
  const LogEntry = IDL.Record({
    'id' : IDL.Nat,
    'ts' : IDL.Int,
    'cid' : IDL.Nat,
    'level' : IDL.Variant({ 'info' : IDL.Null, 'error' : IDL.Null }),
    'message' : IDL.Text,
    'caller' : IDL.Principal,
  });
  const PageArgs = IDL.Record({
    'after' : IDL.Opt(IDL.Nat),
    'limit' : IDL.Nat,
    'before' : IDL.Opt(IDL.Nat),
  });
  const MessagePage = IDL.Record({
    'total' : IDL.Nat,
    'messages' : IDL.Vec(MessageResponse),
    'last_updated' : IDL.Int,
    'has_more' : IDL.Bool,
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
    'settings' : Settings,
    'log_length' : IDL.Nat,
    'last_block_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'archives' : IDL.Vec(ArchiveInfo),
  });
  const BlockType = IDL.Record({ 'url' : IDL.Text, 'block_type' : IDL.Text });
  const Result_1 = IDL.Variant({ 'ok' : IDL.Nat, 'err' : SMSError });
  const CreateMessageInput = IDL.Record({
    'reply_to' : IDL.Opt(IDL.Vec(IDL.Nat)),
    'subject' : IDL.Text,
    'body' : IDL.Text,
    'recipients' : IDL.Vec(IDL.Principal),
  });
  const SystemNotificationInput = IDL.Record({
    'subject' : IDL.Text,
    'body' : IDL.Text,
    'recipients' : IDL.Vec(IDL.Principal),
  });
  return IDL.Service({
    'add_admin' : IDL.Func([IDL.Principal], [Result], []),
    'add_authorized_sender' : IDL.Func([IDL.Principal], [Result], []),
    'admin_get_messages_page' : IDL.Func(
        [IDL.Opt(IDL.Nat), IDL.Nat],
        [AdminMessagePage],
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
    'admin_set_icrc3_settings' : IDL.Func(
        [SettingsUpdate],
        [IDL.Variant({ 'Ok' : Settings, 'Err' : IDL.Text })],
        [],
      ),
    'admin_set_notifications' : IDL.Func(
        [IDL.Opt(IDL.Principal)],
        [Result],
        [],
      ),
    'admin_set_rate_limit_exempt' : IDL.Func(
        [IDL.Principal, IDL.Bool],
        [Result],
        [],
      ),
    'admin_set_send_rate_limit' : IDL.Func([RateRule], [Result], []),
    'get_admins' : IDL.Func([], [IDL.Vec(AdminInfo)], ['query']),
    'get_all_messages' : IDL.Func([], [IDL.Vec(MessageResponse)], ['query']),
    'get_all_messages_admin' : IDL.Func(
        [],
        [IDL.Vec(MessageResponse)],
        ['query'],
      ),
    'get_api_doc' : IDL.Func([], [IDL.Text], ['query']),
    'get_authorized_senders' : IDL.Func([], [Result_2], ['query']),
    'get_config' : IDL.Func(
        [],
        [
          IDL.Record({
            'rate_limit_minutes' : IDL.Nat,
            'max_subject_length' : IDL.Nat,
            'max_body_length' : IDL.Nat,
            'max_recipients' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'get_last_seen_messages_timestamp' : IDL.Func(
        [IDL.Principal],
        [IDL.Opt(IDL.Int)],
        ['query'],
      ),
    'get_log' : IDL.Func([IDL.Nat, IDL.Nat], [IDL.Vec(LogEntry)], ['query']),
    'get_message' : IDL.Func([IDL.Nat], [IDL.Opt(MessageResponse)], ['query']),
    'get_notification_preview' : IDL.Func([], [IDL.Bool], ['query']),
    'get_notifications_canister' : IDL.Func(
        [],
        [IDL.Opt(IDL.Principal)],
        ['query'],
      ),
    'get_premium_config' : IDL.Func(
        [],
        [
          IDL.Record({
            'premium_max_body_length' : IDL.Nat,
            'sneed_premium_canister_id' : IDL.Opt(IDL.Principal),
            'premium_max_recipients' : IDL.Nat,
            'premium_rate_limit_minutes' : IDL.Nat,
            'premium_max_subject_length' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'get_rate_limit_exempt' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_received_messages' : IDL.Func(
        [],
        [IDL.Vec(MessageResponse)],
        ['query'],
      ),
    'get_received_messages_page' : IDL.Func(
        [PageArgs],
        [MessagePage],
        ['query'],
      ),
    'get_recent_messages_count' : IDL.Func(
        [IDL.Principal],
        [IDL.Nat],
        ['query'],
      ),
    'get_send_rate_limit' : IDL.Func([], [RateRule], ['query']),
    'get_sent_messages' : IDL.Func([], [IDL.Vec(MessageResponse)], ['query']),
    'get_sent_messages_page' : IDL.Func([PageArgs], [MessagePage], ['query']),
    'get_stats' : IDL.Func(
        [],
        [IDL.Record({ 'total_users' : IDL.Nat, 'total_messages' : IDL.Nat })],
        ['query'],
      ),
    'get_system_sender_principal' : IDL.Func(
        [],
        [IDL.Opt(IDL.Principal)],
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
    'import_admins' : IDL.Func([IDL.Vec(AdminInfo)], [Result_1], []),
    'import_messages' : IDL.Func([IDL.Vec(MessageResponse)], [Result_1], []),
    'is_admin_query' : IDL.Func([IDL.Principal], [IDL.Bool], ['query']),
    'mark_messages_seen_up_to' : IDL.Func([IDL.Int], [], []),
    'remove_admin' : IDL.Func([IDL.Principal], [Result], []),
    'remove_authorized_sender' : IDL.Func([IDL.Principal], [Result], []),
    'remove_self_from_message' : IDL.Func([IDL.Nat], [Result], []),
    'send_message' : IDL.Func([CreateMessageInput], [Result_1], []),
    'send_system_notification' : IDL.Func(
        [SystemNotificationInput],
        [Result_1],
        [],
      ),
    'set_notification_preview' : IDL.Func([IDL.Bool], [Result], []),
    'set_system_sender_principal' : IDL.Func(
        [IDL.Opt(IDL.Principal)],
        [Result],
        [],
      ),
    'update_config' : IDL.Func(
        [
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
        ],
        [Result],
        [],
      ),
    'update_premium_config' : IDL.Func(
        [
          IDL.Opt(IDL.Opt(IDL.Principal)),
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
          IDL.Opt(IDL.Nat),
        ],
        [Result],
        [],
      ),
  });
};
export const init = ({ IDL }) => { return []; };
