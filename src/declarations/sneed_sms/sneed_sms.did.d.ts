import type { Principal } from '@dfinity/principal';
import type { ActorMethod } from '@dfinity/agent';
import type { IDL } from '@dfinity/candid';

export interface AdminInfo {
  'principal' : Principal,
  'added_at' : bigint,
  'added_by' : number,
}
export interface CreateMessageInput {
  'reply_to' : [] | [Array<bigint>],
  'subject' : string,
  'body' : string,
  'recipients' : Array<Principal>,
}
export interface MessageResponse {
  'id' : bigint,
  'updated_at' : bigint,
  'reply_to' : [] | [Array<bigint>],
  'subject' : string,
  'can_remove_self' : boolean,
  'body' : string,
  'created_at' : bigint,
  'sender' : Principal,
  'recipients' : Array<Principal>,
}
export type Result = { 'ok' : null } |
  { 'err' : SMSError };
export type Result_1 = { 'ok' : bigint } |
  { 'err' : SMSError };
export type SMSError = { 'InvalidInput' : string } |
  { 'NotFound' : string } |
  { 'Unauthorized' : string } |
  { 'AlreadyExists' : string } |
  { 'RateLimited' : string };
export interface _SERVICE {
  'add_admin' : ActorMethod<[Principal], Result>,
  'get_admins' : ActorMethod<[], Array<AdminInfo>>,
  'get_all_messages' : ActorMethod<[], Array<MessageResponse>>,
  'get_all_messages_admin' : ActorMethod<[], Array<MessageResponse>>,
  'get_config' : ActorMethod<
    [],
    {
      'rate_limit_minutes' : bigint,
      'max_subject_length' : bigint,
      'max_body_length' : bigint,
      'max_recipients' : bigint,
    }
  >,
  'get_last_seen_messages_timestamp' : ActorMethod<[Principal], [] | [bigint]>,
  'get_message' : ActorMethod<[bigint], [] | [MessageResponse]>,
  'get_premium_config' : ActorMethod<
    [],
    {
      'premium_max_body_length' : bigint,
      'sneed_premium_canister_id' : [] | [Principal],
      'premium_max_recipients' : bigint,
      'premium_rate_limit_minutes' : bigint,
      'premium_max_subject_length' : bigint,
    }
  >,
  'get_received_messages' : ActorMethod<[], Array<MessageResponse>>,
  'get_recent_messages_count' : ActorMethod<[Principal], bigint>,
  'get_sent_messages' : ActorMethod<[], Array<MessageResponse>>,
  'get_stats' : ActorMethod<
    [],
    { 'total_users' : bigint, 'total_messages' : bigint }
  >,
  'import_admins' : ActorMethod<[Array<AdminInfo>], Result_1>,
  'import_messages' : ActorMethod<[Array<MessageResponse>], Result_1>,
  'is_admin_query' : ActorMethod<[Principal], boolean>,
  'mark_messages_seen_up_to' : ActorMethod<[bigint], undefined>,
  'remove_admin' : ActorMethod<[Principal], Result>,
  'remove_self_from_message' : ActorMethod<[bigint], Result>,
  'send_message' : ActorMethod<[CreateMessageInput], Result_1>,
  'update_config' : ActorMethod<
    [[] | [bigint], [] | [bigint], [] | [bigint], [] | [bigint]],
    Result
  >,
  'update_premium_config' : ActorMethod<
    [
      [] | [[] | [Principal]],
      [] | [bigint],
      [] | [bigint],
      [] | [bigint],
      [] | [bigint],
    ],
    Result
  >,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
