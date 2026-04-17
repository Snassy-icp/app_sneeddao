import type { Principal } from '@icp-sdk/core/principal';
import type { ActorMethod } from '@icp-sdk/core/agent';
import type { IDL } from '@icp-sdk/core/candid';

export interface Account {
  'owner' : Principal,
  'subaccount' : [] | [Uint8Array | number[]],
}
export interface Approve {
  'fee' : [] | [bigint],
  'from' : Account,
  'memo' : [] | [Uint8Array | number[]],
  'created_at_time' : [] | [bigint],
  'amount' : bigint,
  'expected_allowance' : [] | [bigint],
  'expires_at' : [] | [bigint],
  'spender' : Account,
}
export type Block = Value;
export type BlockIndex = bigint;
export interface Burn {
  'from' : Account,
  'memo' : [] | [Uint8Array | number[]],
  'created_at_time' : [] | [bigint],
  'amount' : bigint,
  'spender' : [] | [Account],
}
export interface DataCertificate {
  /**
   * See https://internetcomputer.org/docs/current/references/ic-interface-spec#certification
   */
  'certificate' : Uint8Array | number[],
  /**
   * CBOR encoded hash_tree
   */
  'hash_tree' : Uint8Array | number[],
}
export interface GetArchivesArgs {
  /**
   * The last archive seen by the client.
   * The Ledger will return archives coming
   * after this one if set, otherwise it
   * will return the first archives.
   */
  'from' : [] | [Principal],
}
export type GetArchivesResult = Array<
  {
    /**
     * The last block in the archive
     */
    'end' : bigint,
    /**
     * The id of the archive
     */
    'canister_id' : Principal,
    /**
     * The first block in the archive
     */
    'start' : bigint,
  }
>;
export type GetBlocksArgs = Array<{ 'start' : bigint, 'length' : bigint }>;
export interface GetBlocksResult {
  /**
   * Total number of blocks in the
   * block log
   */
  'log_length' : bigint,
  'blocks' : Array<{ 'id' : bigint, 'block' : ICRC3Value }>,
  'archived_blocks' : Array<
    { 'args' : GetBlocksArgs, 'callback' : [Principal, string] }
  >,
}
export type ICRC3Value = { 'Int' : bigint } |
  { 'Map' : Array<[string, ICRC3Value]> } |
  { 'Nat' : bigint } |
  { 'Blob' : Uint8Array | number[] } |
  { 'Text' : string } |
  { 'Array' : Array<ICRC3Value> };
export type Map = Array<[string, Value]>;
export interface Mint {
  'to' : Account,
  'memo' : [] | [Uint8Array | number[]],
  'created_at_time' : [] | [bigint],
  'amount' : bigint,
}
export interface Transaction {
  'burn' : [] | [Burn],
  'kind' : string,
  'mint' : [] | [Mint],
  'approve' : [] | [Approve],
  'timestamp' : bigint,
  'transfer' : [] | [Transfer],
}
export interface Transfer {
  'to' : Account,
  'fee' : [] | [bigint],
  'from' : Account,
  'memo' : [] | [Uint8Array | number[]],
  'created_at_time' : [] | [bigint],
  'amount' : bigint,
  'spender' : [] | [Account],
}
/**
 * This is not the ICRC-3 Value but a custom
 * type with one more variant. For the ICRC-3
 * type check ICRC3Value instead.
 */
export type Value = { 'Int' : bigint } |
  { 'Map' : Map } |
  { 'Nat' : bigint } |
  { 'Nat64' : bigint } |
  { 'Blob' : Uint8Array | number[] } |
  { 'Text' : string } |
  { 'Array' : Array<Value> };
export interface _SERVICE {
  'append_blocks' : ActorMethod<[Array<Uint8Array | number[]>], undefined>,
  'get_blocks' : ActorMethod<
    [{ 'start' : bigint, 'length' : bigint }],
    { 'blocks' : Array<Block> }
  >,
  'get_transaction' : ActorMethod<[bigint], [] | [Transaction]>,
  'get_transactions' : ActorMethod<
    [{ 'start' : bigint, 'length' : bigint }],
    { 'transactions' : Array<Transaction> }
  >,
  'icrc3_get_archives' : ActorMethod<[GetArchivesArgs], GetArchivesResult>,
  'icrc3_get_blocks' : ActorMethod<[GetBlocksArgs], GetBlocksResult>,
  'icrc3_get_tip_certificate' : ActorMethod<[], [] | [DataCertificate]>,
  'icrc3_supported_block_types' : ActorMethod<
    [],
    Array<{ 'url' : string, 'block_type' : string }>
  >,
  'remaining_capacity' : ActorMethod<[], bigint>,
}
export declare const idlFactory: IDL.InterfaceFactory;
export declare const init: (args: { IDL: typeof IDL }) => IDL.Type[];
