export const idlFactory = ({ IDL }) => {
  const GetBlocksResult = IDL.Rec();
  const Value = IDL.Rec();
  const Result = IDL.Variant({ 'ok' : IDL.Text, 'err' : IDL.Text });
  const DappId = IDL.Nat;
  const Config = IDL.Record({
    'moderator' : IDL.Opt(IDL.Principal),
    'sns_wasm' : IDL.Principal,
    'archive_controllers' : IDL.Vec(IDL.Principal),
    'dao_governance' : IDL.Principal,
    'max_dapp_canisters' : IDL.Nat,
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
  const AvatarRef = IDL.Variant({
    'url' : IDL.Text,
    'blob' : IDL.Vec(IDL.Nat8),
  });
  const DappView = IDL.Record({
    'id' : DappId,
    'url' : IDL.Text,
    'updated_at' : IDL.Nat64,
    'verified' : IDL.Bool,
    'logo' : IDL.Opt(AvatarRef),
    'name' : IDL.Text,
    'hidden' : IDL.Bool,
    'created_at' : IDL.Nat64,
    'canisters' : IDL.Vec(IDL.Principal),
    'registered_by' : IDL.Principal,
  });
  const LogEntry = IDL.Record({
    'id' : IDL.Nat,
    'ts' : IDL.Int,
    'cid' : IDL.Nat,
    'level' : IDL.Variant({ 'info' : IDL.Null, 'error' : IDL.Null }),
    'message' : IDL.Text,
    'caller' : IDL.Principal,
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
  const Page = IDL.Record({
    'start_after' : IDL.Opt(DappId),
    'limit' : IDL.Nat,
  });
  const DappInput = IDL.Record({
    'url' : IDL.Text,
    'logo' : IDL.Opt(AvatarRef),
    'name' : IDL.Text,
    'canisters' : IDL.Vec(IDL.Principal),
  });
  const ResultNat = IDL.Variant({ 'ok' : IDL.Nat, 'err' : IDL.Text });
  const ValidationResult = IDL.Variant({ 'Ok' : IDL.Text, 'Err' : IDL.Text });
  return IDL.Service({
    'admin_add_admin' : IDL.Func([IDL.Principal], [Result], []),
    'admin_hide_dapp' : IDL.Func([DappId, IDL.Bool], [Result], []),
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
    'admin_remove_admin' : IDL.Func([IDL.Principal], [Result], []),
    'admin_set_config' : IDL.Func([Config], [Result], []),
    'admin_set_icrc3_settings' : IDL.Func(
        [SettingsUpdate],
        [IDL.Variant({ 'Ok' : Settings, 'Err' : IDL.Text })],
        [],
      ),
    'get_admins' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_api_doc' : IDL.Func([], [IDL.Text], ['query']),
    'get_config' : IDL.Func([], [Config], ['query']),
    'get_dapps' : IDL.Func(
        [IDL.Vec(DappId)],
        [IDL.Vec(IDL.Opt(DappView))],
        ['query'],
      ),
    'get_log' : IDL.Func([IDL.Nat, IDL.Nat], [IDL.Vec(LogEntry)], ['query']),
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
    'list_dapps' : IDL.Func(
        [Page],
        [IDL.Record({ 'next' : IDL.Opt(DappId), 'items' : IDL.Vec(DappView) })],
        ['query'],
      ),
    'register_dapp' : IDL.Func([DappInput], [ResultNat], []),
    'search_dapps' : IDL.Func(
        [IDL.Text, IDL.Nat],
        [IDL.Vec(DappView)],
        ['query'],
      ),
    'stats' : IDL.Func(
        [],
        [IDL.Record({ 'log_length' : IDL.Nat, 'dapps' : IDL.Nat })],
        ['query'],
      ),
    'update_dapp' : IDL.Func([DappId, DappInput], [Result], []),
    'validate_verify_dapp_by_dao' : IDL.Func(
        [DappId, IDL.Bool],
        [ValidationResult],
        ['query'],
      ),
    'verify_dapp' : IDL.Func([DappId, IDL.Bool], [Result], []),
    'verify_dapp_by_dao' : IDL.Func([DappId, IDL.Bool], [], []),
  });
};
export const init = ({ IDL }) => { return []; };
