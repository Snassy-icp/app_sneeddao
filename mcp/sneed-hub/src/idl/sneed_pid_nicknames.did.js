export const idlFactory = ({ IDL }) => {
  const Result = IDL.Variant({ 'ok' : IDL.Text, 'err' : IDL.Text });
  const ImportItem = IDL.Record({
    'nickname' : IDL.Text,
    'owner' : IDL.Principal,
    'target' : IDL.Principal,
  });
  const Config = IDL.Record({
    'max_premium' : IDL.Nat,
    'max_free' : IDL.Nat,
    'moderator' : IDL.Opt(IDL.Principal),
    'premium' : IDL.Opt(IDL.Principal),
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
  const SneedPidNicknames = IDL.Service({
    'admin_add_admin' : IDL.Func([IDL.Principal], [Result], []),
    'admin_finish_import' : IDL.Func([], [Result], []),
    'admin_import_nicknames' : IDL.Func(
        [IDL.Vec(ImportItem)],
        [IDL.Vec(Result)],
        [],
      ),
    'admin_remove_admin' : IDL.Func([IDL.Principal], [Result], []),
    'admin_set_config' : IDL.Func([Config], [Result], []),
    'get_admins' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_api_doc' : IDL.Func([], [IDL.Text], ['query']),
    'get_config' : IDL.Func([], [Config], ['query']),
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
    'set_nickname' : IDL.Func([IDL.Principal, IDL.Text], [Result], []),
    'set_nickname_avatar' : IDL.Func(
        [IDL.Principal, IDL.Opt(AvatarRef)],
        [Result],
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
  return SneedPidNicknames;
};
export const init = ({ IDL }) => { return []; };
