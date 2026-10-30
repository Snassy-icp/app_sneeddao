export const idlFactory = ({ IDL }) => {
  const Result = IDL.Variant({ 'ok' : IDL.Text, 'err' : IDL.Text });
  const ImportItem = IDL.Record({
    'nickname' : IDL.Text,
    'owner' : IDL.Principal,
    'target' : IDL.Principal,
  });
  const AccountLimits = IDL.Record({
    'account_max_free' : IDL.Nat,
    'account_max_premium' : IDL.Nat,
  });
  const Config = IDL.Record({
    'max_premium' : IDL.Nat,
    'max_free' : IDL.Nat,
    'moderator' : IDL.Opt(IDL.Principal),
    'premium' : IDL.Opt(IDL.Principal),
  });
  const Rule = IDL.Record({ 'per_minute' : IDL.Nat, 'capacity' : IDL.Nat });
  const Account = IDL.Record({
    'owner' : IDL.Principal,
    'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
  });
  const Page_1 = IDL.Record({
    'start_after' : IDL.Opt(Account),
    'limit' : IDL.Nat,
  });
  const PocketMeta = IDL.Record({
    'host' : IDL.Opt(IDL.Text),
    'hidden' : IDL.Bool,
    'created_at' : IDL.Nat64,
    'ledgers' : IDL.Vec(IDL.Principal),
  });
  const AccountNickname = IDL.Record({
    'updated_at' : IDL.Nat64,
    'nickname' : IDL.Text,
    'account' : Account,
    'pocket' : IDL.Opt(PocketMeta),
  });
  const Page = IDL.Record({
    'start_after' : IDL.Opt(IDL.Principal),
    'limit' : IDL.Nat,
  });
  const AvatarRef = IDL.Variant({
    'url' : IDL.Text,
    'blob' : IDL.Vec(IDL.Nat8),
  });
  const Nickname = IDL.Record({
    'updated_at' : IDL.Nat64,
    'nickname' : IDL.Text,
    'target' : IDL.Principal,
    'avatar' : IDL.Opt(AvatarRef),
  });
  return IDL.Service({
    'account_stats' : IDL.Func(
        [],
        [
          IDL.Record({
            'owners' : IDL.Nat,
            'entries' : IDL.Nat,
            'accounts' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'admin_add_admin' : IDL.Func([IDL.Principal], [Result], []),
    'admin_finish_import' : IDL.Func([], [Result], []),
    'admin_import_nicknames' : IDL.Func(
        [IDL.Vec(ImportItem)],
        [IDL.Vec(Result)],
        [],
      ),
    'admin_remove_admin' : IDL.Func([IDL.Principal], [Result], []),
    'admin_set_account_limits' : IDL.Func([AccountLimits], [Result], []),
    'admin_set_config' : IDL.Func([Config], [Result], []),
    'admin_set_rate_limit' : IDL.Func([IDL.Text, IDL.Opt(Rule)], [Result], []),
    'get_account_limits' : IDL.Func([], [AccountLimits], ['query']),
    'get_admins' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_api_doc' : IDL.Func([], [IDL.Text], ['query']),
    'get_config' : IDL.Func([], [Config], ['query']),
    'get_my_account_nicknames' : IDL.Func(
        [Page_1],
        [
          IDL.Record({
            'next' : IDL.Opt(Account),
            'items' : IDL.Vec(AccountNickname),
          }),
        ],
        ['query'],
      ),
    'get_my_account_nicknames_for' : IDL.Func(
        [IDL.Vec(Account)],
        [IDL.Vec(IDL.Opt(AccountNickname))],
        ['query'],
      ),
    'get_my_nicknames' : IDL.Func(
        [Page],
        [
          IDL.Record({
            'next' : IDL.Opt(IDL.Principal),
            'items' : IDL.Vec(Nickname),
          }),
        ],
        ['query'],
      ),
    'get_my_nicknames_for' : IDL.Func(
        [IDL.Vec(IDL.Principal)],
        [IDL.Vec(IDL.Opt(Nickname))],
        ['query'],
      ),
    'get_rate_limits' : IDL.Func(
        [],
        [IDL.Vec(IDL.Tuple(IDL.Text, Rule))],
        ['query'],
      ),
    'my_account_nickname_count' : IDL.Func(
        [],
        [
          IDL.Record({
            'max_premium' : IDL.Nat,
            'max_free' : IDL.Nat,
            'count' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'my_nickname_count' : IDL.Func(
        [],
        [
          IDL.Record({
            'max_premium' : IDL.Nat,
            'max_free' : IDL.Nat,
            'count' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'search_my_nicknames' : IDL.Func(
        [IDL.Text, IDL.Nat],
        [IDL.Vec(Nickname)],
        ['query'],
      ),
    'set_account_nickname' : IDL.Func([Account, IDL.Text], [Result], []),
    'set_nickname' : IDL.Func([IDL.Principal, IDL.Text], [Result], []),
    'set_nickname_avatar' : IDL.Func(
        [IDL.Principal, IDL.Opt(AvatarRef)],
        [Result],
        [],
      ),
    'set_pocket' : IDL.Func([Account, IDL.Opt(PocketMeta)], [Result], []),
    'set_pockets' : IDL.Func(
        [IDL.Vec(IDL.Tuple(Account, IDL.Opt(PocketMeta)))],
        [IDL.Vec(Result)],
        [],
      ),
    'stats' : IDL.Func(
        [],
        [
          IDL.Record({
            'owners' : IDL.Nat,
            'targets' : IDL.Nat,
            'nicknames' : IDL.Nat,
            'import_closed' : IDL.Bool,
          }),
        ],
        ['query'],
      ),
  });
};
export const init = ({ IDL }) => { return []; };
