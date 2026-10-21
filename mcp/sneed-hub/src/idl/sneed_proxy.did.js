export const idlFactory = ({ IDL }) => {
  const GetBlocksResult = IDL.Rec();
  const Value = IDL.Rec();
  const InitArgs = IDL.Record({
    'root' : IDL.Principal,
    'governance' : IDL.Principal,
  });
  const ProxyCall = IDL.Record({
    'arg' : IDL.Vec(IDL.Nat8),
    'method' : IDL.Text,
    'note' : IDL.Opt(IDL.Text),
    'canister' : IDL.Principal,
    'expires_at' : IDL.Opt(IDL.Nat64),
  });
  const Class = IDL.Variant({
    'dapp' : IDL.Null,
    'community' : IDL.Null,
    'business' : IDL.Null,
    'critical' : IDL.Null,
    'treasury' : IDL.Null,
  });
  const ReplyMode = IDL.Variant({ 'any' : IDL.Null, 'result' : IDL.Null });
  const EntryView = IDL.Record({
    'method' : IDL.Text,
    'max_arg_bytes' : IDL.Nat,
    'class' : Class,
    'label' : IDL.Text,
    'builtin' : IDL.Bool,
    'enabled' : IDL.Bool,
    'canister' : IDL.Principal,
    'reply' : ReplyMode,
  });
  const CanisterName = IDL.Record({
    'name' : IDL.Text,
    'canister' : IDL.Principal,
  });
  const FunctionInfo = IDL.Record({
    'id' : IDL.Nat,
    'validator_method' : IDL.Text,
    'topic' : IDL.Text,
    'name' : IDL.Text,
    'critical' : IDL.Bool,
    'target_method' : IDL.Text,
  });
  const Config = IDL.Record({
    'max_in_flight' : IDL.Nat,
    'root' : IDL.Principal,
    'sns_canisters_refreshed_at' : IDL.Opt(IDL.Nat64),
    'sns_canisters' : IDL.Vec(IDL.Principal),
    'forward_timeout_seconds' : IDL.Nat,
    'functions' : IDL.Vec(FunctionInfo),
    'in_flight' : IDL.Nat,
    'governance' : IDL.Principal,
  });
  const LogEntry = IDL.Record({
    'id' : IDL.Nat,
    'ts' : IDL.Int,
    'cid' : IDL.Nat,
    'level' : IDL.Variant({ 'info' : IDL.Null, 'error' : IDL.Null }),
    'message' : IDL.Text,
    'caller' : IDL.Principal,
  });
  const Outcome = IDL.Variant({
    'ok' : IDL.Null,
    'err' : IDL.Null,
    'unknown' : IDL.Null,
  });
  const Forwarded = IDL.Record({
    'ts' : IDL.Nat64,
    'function_id' : IDL.Nat,
    'method' : IDL.Text,
    'class' : Class,
    'note' : IDL.Opt(IDL.Text),
    'arg_hash' : IDL.Vec(IDL.Nat8),
    'arg_size' : IDL.Nat,
    'label' : IDL.Text,
    'error' : IDL.Opt(IDL.Text),
    'target' : IDL.Principal,
    'block' : IDL.Nat,
    'reply_hash' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    'reply_size' : IDL.Opt(IDL.Nat),
    'outcome' : Outcome,
    'payload_hash' : IDL.Vec(IDL.Nat8),
  });
  const ClassStats = IDL.Record({
    'ok' : IDL.Nat,
    'err' : IDL.Nat,
    'forwarded' : IDL.Nat,
    'class' : Class,
    'unknown' : IDL.Nat,
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
  const Settings = IDL.Record({
    'archive_top_up_threshold' : IDL.Nat,
    'archive_max_blocks' : IDL.Nat,
    'max_live_blocks' : IDL.Nat,
    'archive_initial_cycles' : IDL.Nat,
    'spill_batch_size' : IDL.Nat,
    'archive_top_up_amount' : IDL.Nat,
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
  const SettingsUpdate = IDL.Record({
    'archive_top_up_threshold' : IDL.Opt(IDL.Nat),
    'archive_max_blocks' : IDL.Opt(IDL.Nat),
    'max_live_blocks' : IDL.Opt(IDL.Nat),
    'archive_initial_cycles' : IDL.Opt(IDL.Nat),
    'spill_batch_size' : IDL.Opt(IDL.Nat),
    'archive_top_up_amount' : IDL.Opt(IDL.Nat),
  });
  const Entry = IDL.Record({
    'method' : IDL.Text,
    'max_arg_bytes' : IDL.Nat,
    'class' : Class,
    'label' : IDL.Text,
    'enabled' : IDL.Bool,
    'canister' : IDL.Principal,
    'reply' : ReplyMode,
  });
  const AllowlistUpdate = IDL.Record({
    'remove' : IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Text)),
    'upsert' : IDL.Vec(Entry),
    'names' : IDL.Vec(CanisterName),
    'remove_names' : IDL.Vec(IDL.Principal),
  });
  const ValidationResult = IDL.Variant({ 'Ok' : IDL.Text, 'Err' : IDL.Text });
  const SneedProxy = IDL.Service({
    'execute_business' : IDL.Func([ProxyCall], [IDL.Text], []),
    'execute_community' : IDL.Func([ProxyCall], [IDL.Text], []),
    'execute_critical' : IDL.Func([ProxyCall], [IDL.Text], []),
    'execute_dapp' : IDL.Func([ProxyCall], [IDL.Text], []),
    'execute_treasury' : IDL.Func([ProxyCall], [IDL.Text], []),
    'get_allowlist' : IDL.Func([], [IDL.Vec(EntryView)], ['query']),
    'get_api_doc' : IDL.Func([], [IDL.Text], ['query']),
    'get_canister_names' : IDL.Func([], [IDL.Vec(CanisterName)], ['query']),
    'get_config' : IDL.Func([], [Config], ['query']),
    'get_log' : IDL.Func([IDL.Nat, IDL.Nat], [IDL.Vec(LogEntry)], ['query']),
    'get_recent' : IDL.Func([IDL.Nat], [IDL.Vec(Forwarded)], ['query']),
    'get_stats' : IDL.Func([], [IDL.Vec(ClassStats)], ['query']),
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
    'self_icrc3_repair_archive_controllers' : IDL.Func(
        [],
        [
          IDL.Variant({
            'Ok' : IDL.Vec(
              IDL.Tuple(
                IDL.Principal,
                IDL.Variant({ 'Ok' : IDL.Null, 'Err' : IDL.Text }),
              )
            ),
            'Err' : IDL.Text,
          }),
        ],
        [],
      ),
    'self_icrc3_spill_now' : IDL.Func(
        [],
        [IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text })],
        [],
      ),
    'self_set_icrc3_settings' : IDL.Func(
        [SettingsUpdate],
        [IDL.Variant({ 'Ok' : Settings, 'Err' : IDL.Text })],
        [],
      ),
    'self_set_max_in_flight' : IDL.Func(
        [IDL.Nat],
        [IDL.Variant({ 'Ok' : IDL.Nat, 'Err' : IDL.Text })],
        [],
      ),
    'set_allowlist' : IDL.Func([AllowlistUpdate], [IDL.Text], []),
    'validate_business' : IDL.Func([ProxyCall], [ValidationResult], ['query']),
    'validate_community' : IDL.Func([ProxyCall], [ValidationResult], ['query']),
    'validate_critical' : IDL.Func([ProxyCall], [ValidationResult], ['query']),
    'validate_dapp' : IDL.Func([ProxyCall], [ValidationResult], ['query']),
    'validate_set_allowlist' : IDL.Func(
        [AllowlistUpdate],
        [ValidationResult],
        ['query'],
      ),
    'validate_treasury' : IDL.Func([ProxyCall], [ValidationResult], ['query']),
  });
  return SneedProxy;
};
export const init = ({ IDL }) => {
  const InitArgs = IDL.Record({
    'root' : IDL.Principal,
    'governance' : IDL.Principal,
  });
  return [IDL.Opt(InitArgs)];
};
