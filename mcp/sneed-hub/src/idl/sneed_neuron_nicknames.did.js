export const idlFactory = ({ IDL }) => {
  const Result = IDL.Variant({ 'ok' : IDL.Text, 'err' : IDL.Text });
  const NeuronKey = IDL.Record({
    'sns_root' : IDL.Principal,
    'neuron_id' : IDL.Vec(IDL.Nat8),
  });
  const ImportItem = IDL.Record({
    'nickname' : IDL.Text,
    'owner' : IDL.Principal,
    'target' : NeuronKey,
  });
  const Config = IDL.Record({
    'max_premium' : IDL.Nat,
    'max_free' : IDL.Nat,
    'moderator' : IDL.Opt(IDL.Principal),
    'premium' : IDL.Opt(IDL.Principal),
  });
  const Page = IDL.Record({
    'start_after' : IDL.Opt(NeuronKey),
    'limit' : IDL.Nat,
  });
  const AvatarRef = IDL.Variant({
    'url' : IDL.Text,
    'blob' : IDL.Vec(IDL.Nat8),
  });
  const Nickname = IDL.Record({
    'updated_at' : IDL.Nat64,
    'nickname' : IDL.Text,
    'target' : NeuronKey,
    'avatar' : IDL.Opt(AvatarRef),
  });
  return IDL.Service({
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
            'next' : IDL.Opt(NeuronKey),
            'items' : IDL.Vec(Nickname),
          }),
        ],
        ['query'],
      ),
    'get_my_nicknames_for' : IDL.Func(
        [IDL.Vec(NeuronKey)],
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
    'set_nickname' : IDL.Func([NeuronKey, IDL.Text], [Result], []),
    'set_nickname_avatar' : IDL.Func(
        [NeuronKey, IDL.Opt(AvatarRef)],
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
};
export const init = ({ IDL }) => { return []; };
