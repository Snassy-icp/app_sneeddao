export const idlFactory = ({ IDL }) => {
  const SMSError = IDL.Variant({
    'InvalidInput' : IDL.Text,
    'NotFound' : IDL.Text,
    'Unauthorized' : IDL.Text,
    'AlreadyExists' : IDL.Text,
    'RateLimited' : IDL.Text,
  });
  const Result = IDL.Variant({ 'ok' : IDL.Null, 'err' : SMSError });
  const AdminInfo = IDL.Record({
    'principal' : IDL.Principal,
    'added_at' : IDL.Int,
    'added_by' : IDL.Nat32,
  });
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
  const Result_1 = IDL.Variant({ 'ok' : IDL.Nat, 'err' : SMSError });
  const CreateMessageInput = IDL.Record({
    'reply_to' : IDL.Opt(IDL.Vec(IDL.Nat)),
    'subject' : IDL.Text,
    'body' : IDL.Text,
    'recipients' : IDL.Vec(IDL.Principal),
  });
  return IDL.Service({
    'add_admin' : IDL.Func([IDL.Principal], [Result], []),
    'get_admins' : IDL.Func([], [IDL.Vec(AdminInfo)], ['query']),
    'get_all_messages' : IDL.Func([], [IDL.Vec(MessageResponse)], ['query']),
    'get_all_messages_admin' : IDL.Func(
        [],
        [IDL.Vec(MessageResponse)],
        ['query'],
      ),
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
    'get_message' : IDL.Func([IDL.Nat], [IDL.Opt(MessageResponse)], ['query']),
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
    'get_received_messages' : IDL.Func(
        [],
        [IDL.Vec(MessageResponse)],
        ['query'],
      ),
    'get_recent_messages_count' : IDL.Func(
        [IDL.Principal],
        [IDL.Nat],
        ['query'],
      ),
    'get_sent_messages' : IDL.Func([], [IDL.Vec(MessageResponse)], ['query']),
    'get_stats' : IDL.Func(
        [],
        [IDL.Record({ 'total_users' : IDL.Nat, 'total_messages' : IDL.Nat })],
        ['query'],
      ),
    'import_admins' : IDL.Func([IDL.Vec(AdminInfo)], [Result_1], []),
    'import_messages' : IDL.Func([IDL.Vec(MessageResponse)], [Result_1], []),
    'is_admin_query' : IDL.Func([IDL.Principal], [IDL.Bool], ['query']),
    'mark_messages_seen_up_to' : IDL.Func([IDL.Int], [], []),
    'remove_admin' : IDL.Func([IDL.Principal], [Result], []),
    'remove_self_from_message' : IDL.Func([IDL.Nat], [Result], []),
    'send_message' : IDL.Func([CreateMessageInput], [Result_1], []),
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
