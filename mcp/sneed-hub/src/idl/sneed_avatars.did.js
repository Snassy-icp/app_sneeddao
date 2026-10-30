export const idlFactory = ({ IDL }) => {
  const Result = IDL.Variant({ 'ok' : IDL.Text, 'err' : IDL.Text });
  const Config = IDL.Record({
    'max_held' : IDL.Nat,
    'premium' : IDL.Opt(IDL.Principal),
    'max_held_premium' : IDL.Nat,
  });
  const Image = IDL.Record({
    'content_type' : IDL.Text,
    'bytes' : IDL.Vec(IDL.Nat8),
  });
  const ImageInfo = IDL.Record({
    'hash' : IDL.Vec(IDL.Nat8),
    'size' : IDL.Nat,
    'content_type' : IDL.Text,
    'created_at' : IDL.Nat64,
    'holders' : IDL.Nat,
  });
  const HttpRequest = IDL.Record({
    'url' : IDL.Text,
    'method' : IDL.Text,
    'body' : IDL.Vec(IDL.Nat8),
    'headers' : IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text)),
  });
  const HttpResponse = IDL.Record({
    'body' : IDL.Vec(IDL.Nat8),
    'headers' : IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text)),
    'status_code' : IDL.Nat16,
  });
  return IDL.Service({
    'admin_add_admin' : IDL.Func([IDL.Principal], [Result], []),
    'admin_remove' : IDL.Func([IDL.Vec(IDL.Nat8)], [Result], []),
    'admin_remove_admin' : IDL.Func([IDL.Principal], [Result], []),
    'admin_set_config' : IDL.Func([Config], [Result], []),
    'admin_upload_for' : IDL.Func(
        [IDL.Principal, IDL.Vec(IDL.Nat8)],
        [IDL.Variant({ 'ok' : IDL.Vec(IDL.Nat8), 'err' : IDL.Text })],
        [],
      ),
    'get_admins' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'get_api_doc' : IDL.Func([], [IDL.Text], ['query']),
    'get_config' : IDL.Func([], [Config], ['query']),
    'get_images' : IDL.Func(
        [IDL.Vec(IDL.Vec(IDL.Nat8))],
        [IDL.Vec(IDL.Opt(Image))],
        ['query'],
      ),
    'get_info' : IDL.Func(
        [IDL.Vec(IDL.Vec(IDL.Nat8))],
        [IDL.Vec(IDL.Opt(ImageInfo))],
        ['query'],
      ),
    'http_request' : IDL.Func([HttpRequest], [HttpResponse], ['query']),
    'my_images' : IDL.Func([], [IDL.Vec(ImageInfo)], ['query']),
    'release' : IDL.Func([IDL.Vec(IDL.Nat8)], [Result], []),
    'stats' : IDL.Func(
        [],
        [
          IDL.Record({
            'region_bytes' : IDL.Nat64,
            'holders' : IDL.Nat,
            'bytes' : IDL.Nat,
            'images' : IDL.Nat,
          }),
        ],
        ['query'],
      ),
    'upload' : IDL.Func(
        [IDL.Vec(IDL.Nat8)],
        [IDL.Variant({ 'ok' : IDL.Vec(IDL.Nat8), 'err' : IDL.Text })],
        [],
      ),
  });
};
export const init = ({ IDL }) => { return []; };
