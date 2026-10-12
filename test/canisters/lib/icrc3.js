// Independent JavaScript implementation of the ICRC-3 pieces the tests verify:
// the representation-independent value hash, the certified-tip check and a
// full chain walk across live and archived blocks. Also the Candid IDL of the
// standard interface, so tests can talk to any ICRC-3 canister.
import { createHash } from 'node:crypto';
import { Certificate, Cbor, reconstruct, lookup_path, lookupResultToBuffer } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';

export const sha256 = (b) => createHash('sha256').update(b).digest();

export const leb128 = (n) => {
  n = BigInt(n);
  const out = [];
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n !== 0n) byte |= 0x80;
    out.push(byte);
  } while (n !== 0n);
  return Buffer.from(out);
};

export const sleb128 = (n) => {
  n = BigInt(n);
  const out = [];
  for (;;) {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    const sign = (byte & 0x40) !== 0;
    if ((n === 0n && !sign) || (n === -1n && sign)) {
      out.push(byte);
      return Buffer.from(out);
    }
    out.push(byte | 0x80);
  }
};

export function hashValue(v) {
  if ('Blob' in v) return sha256(Buffer.from(v.Blob));
  if ('Text' in v) return sha256(Buffer.from(v.Text, 'utf8'));
  if ('Nat' in v) return sha256(leb128(v.Nat));
  if ('Int' in v) return sha256(sleb128(v.Int));
  if ('Array' in v) return sha256(Buffer.concat(v.Array.map(hashValue)));
  if ('Map' in v) {
    const pairs = v.Map.map(([k, val]) => Buffer.concat([sha256(Buffer.from(k, 'utf8')), hashValue(val)]));
    pairs.sort(Buffer.compare);
    return sha256(Buffer.concat(pairs));
  }
  throw new Error('bad value');
}

export const field = (map, key) => map.Map.find(([k]) => k === key)?.[1];
export const tx = (block) => field(block, 'tx');
export const txField = (block, key) => field(tx(block), key);
export const btype = (block) => field(block, 'btype')?.Text;

// ---- Candid ----

export const Value = IDL.Rec();
Value.fill(IDL.Variant({
  Blob: IDL.Vec(IDL.Nat8), Text: IDL.Text, Nat: IDL.Nat, Int: IDL.Int,
  Array: IDL.Vec(Value), Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)),
}));
export const GetBlocksArgs = IDL.Vec(IDL.Record({ start: IDL.Nat, length: IDL.Nat }));
export const GetBlocksResult = IDL.Rec();
GetBlocksResult.fill(IDL.Record({
  log_length: IDL.Nat,
  blocks: IDL.Vec(IDL.Record({ id: IDL.Nat, block: Value })),
  archived_blocks: IDL.Vec(IDL.Record({ args: GetBlocksArgs, callback: IDL.Func([GetBlocksArgs], [GetBlocksResult], ['query']) })),
}));
export const ArchiveInfo = IDL.Record({ canister_id: IDL.Principal, start: IDL.Nat, length: IDL.Nat, max_blocks: IDL.Nat });
export const Settings = IDL.Record({
  max_live_blocks: IDL.Nat, spill_batch_size: IDL.Nat, archive_max_blocks: IDL.Nat,
  archive_initial_cycles: IDL.Nat, archive_top_up_threshold: IDL.Nat, archive_top_up_amount: IDL.Nat,
});
export const SettingsUpdate = IDL.Record({
  max_live_blocks: IDL.Opt(IDL.Nat), spill_batch_size: IDL.Opt(IDL.Nat), archive_max_blocks: IDL.Opt(IDL.Nat),
  archive_initial_cycles: IDL.Opt(IDL.Nat), archive_top_up_threshold: IDL.Opt(IDL.Nat), archive_top_up_amount: IDL.Opt(IDL.Nat),
});
export const LogStatus = IDL.Record({
  log_length: IDL.Nat, live_blocks: IDL.Nat, live_first_index: IDL.Nat, last_block_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
  archives: IDL.Vec(ArchiveInfo), settings: Settings, history_imported: IDL.Bool, spilling: IDL.Bool,
});

export const Registration = IDL.Record({
  canister_id: IDL.Principal, start: IDL.Nat, proposal_id: IDL.Opt(IDL.Nat64), attempts: IDL.Nat, last_error: IDL.Opt(IDL.Text),
});
export const RegistrationStatus = IDL.Record({ governance: IDL.Principal, neuron: IDL.Opt(IDL.Vec(IDL.Nat8)), registrations: IDL.Vec(Registration) });

/// The standard ICRC-3 interface plus the Sneed library's status and admin methods.
export const icrc3Service = (IDL) => ({
  icrc3_get_blocks: IDL.Func([GetBlocksArgs], [GetBlocksResult], ['query']),
  icrc3_get_archives: IDL.Func([IDL.Record({ from: IDL.Opt(IDL.Principal) })], [IDL.Vec(IDL.Record({ canister_id: IDL.Principal, start: IDL.Nat, end: IDL.Nat }))], ['query']),
  icrc3_get_tip_certificate: IDL.Func([], [IDL.Opt(IDL.Record({ certificate: IDL.Vec(IDL.Nat8), hash_tree: IDL.Vec(IDL.Nat8) }))], ['query']),
  icrc3_supported_block_types: IDL.Func([], [IDL.Vec(IDL.Record({ block_type: IDL.Text, url: IDL.Text }))], ['query']),
  icrc10_supported_standards: IDL.Func([], [IDL.Vec(IDL.Record({ name: IDL.Text, url: IDL.Text }))], ['query']),
  icrc3_log_status: IDL.Func([], [LogStatus], ['query']),
  admin_set_icrc3_settings: IDL.Func([SettingsUpdate], [IDL.Variant({ Ok: Settings, Err: IDL.Text })], []),
  admin_icrc3_spill_now: IDL.Func([], [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text })], []),
  admin_icrc3_repair_archive_controllers: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })))], []),
  icrc3_registration_status: IDL.Func([], [RegistrationStatus], ['query']),
  admin_set_icrc3_proposal_neuron: IDL.Func([IDL.Opt(IDL.Vec(IDL.Nat8))], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
  admin_icrc3_register_archives_now: IDL.Func([], [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text })], []),
  admin_icrc3_reset_archive_registration: IDL.Func([IDL.Principal], [IDL.Variant({ Ok: IDL.Bool, Err: IDL.Text })], []),
});

export const archiveIdl = ({ IDL }) => IDL.Service({
  icrc3_get_blocks: IDL.Func([GetBlocksArgs], [GetBlocksResult], ['query']),
  append_blocks: IDL.Func([IDL.Record({ first_index: IDL.Nat, blocks: IDL.Vec(IDL.Vec(IDL.Nat8)) })], [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text })], []),
  archive_status: IDL.Func([], [IDL.Record({ parent: IDL.Principal, first_index: IDL.Nat, block_count: IDL.Nat, max_blocks: IDL.Nat, cycles: IDL.Nat, data_bytes: IDL.Nat })], ['query']),
  deposit_cycles: IDL.Func([], [], []),
});

// ---- verification ----

/// Verify the tip certificate of `canisterId` against `rootKey` and return the
/// certified { lastIndex, lastHash }.
// Tests move PocketIC's clock by hours, so the agent's "signed within 5 minutes
// of now" freshness check is disabled here; signature, delegation and tree
// integrity are still verified.
export async function verifyTip(actor, canisterId, rootKey, { disableTimeVerification = true } = {}) {
  const tip = await actor.icrc3_get_tip_certificate();
  if (tip.length === 0) return null;
  const { certificate, hash_tree } = tip[0];
  const cert = await Certificate.create({ certificate: new Uint8Array(certificate), rootKey, principal: { canisterId }, disableTimeVerification });
  const certified = Buffer.from(lookupResultToBuffer(cert.lookup_path(['canister', canisterId.toUint8Array(), 'certified_data'])));
  const tree = Cbor.decode(new Uint8Array(hash_tree));
  const root = Buffer.from(await reconstruct(tree));
  if (!certified.equals(root)) throw new Error('certified_data does not match the hash tree');
  let lastIndex = 0n, shift = 0n;
  for (const b of Buffer.from(lookupResultToBuffer(lookup_path(['last_block_index'], tree)))) { lastIndex |= BigInt(b & 0x7f) << shift; shift += 7n; }
  const lastHash = Buffer.from(lookupResultToBuffer(lookup_path(['last_block_hash'], tree)));
  return { lastIndex, lastHash };
}

/// Download blocks [start, end] following archive callbacks. `makeArchiveActor`
/// builds an actor for an archive canister id.
export async function fetchBlocks(actor, makeArchiveActor, start, end) {
  const blocks = new Map();
  let cursor = BigInt(start);
  const last = BigInt(end);
  while (cursor <= last) {
    const res = await actor.icrc3_get_blocks([{ start: cursor, length: last - cursor + 1n }]);
    let got = 0;
    for (const b of res.blocks) { blocks.set(b.id, b.block); got++; }
    for (const ab of res.archived_blocks) {
      const [archiveId, method] = ab.callback;
      const archive = makeArchiveActor(archiveId);
      const r = await archive[method](ab.args);
      for (const b of r.blocks) { blocks.set(b.id, b.block); got++; }
    }
    if (got === 0) break;
    // advance past the highest block we have so far
    let max = cursor - 1n;
    for (const id of blocks.keys()) if (id > max) max = id;
    cursor = max + 1n;
  }
  return blocks;
}

/// Walk the chain 0..lastIndex, recompute every hash, check phash links and
/// that the last hash is `lastHash`. Returns the ordered block list.
export function verifyChain(blocks, lastIndex, lastHash, supported) {
  let prev = null;
  const ordered = [];
  for (let i = 0n; i <= lastIndex; i++) {
    const block = blocks.get(i);
    if (!block) throw new Error(`missing block ${i}`);
    const t = btype(block);
    if (supported && !supported.has(t)) throw new Error(`unsupported btype ${t} at ${i}`);
    const phash = field(block, 'phash');
    if (i === 0n) { if (phash) throw new Error('block 0 has phash'); }
    else if (!phash || !Buffer.from(phash.Blob).equals(prev)) throw new Error(`broken chain at block ${i}`);
    prev = hashValue(block);
    ordered.push(block);
  }
  if (lastHash && !prev.equals(lastHash)) throw new Error('last hash does not match the certified hash');
  return ordered;
}

/// Everything at once: tip, download, chain.
export async function verifyLog(actor, canisterId, rootKey, makeArchiveActor) {
  const tip = await verifyTip(actor, canisterId, rootKey);
  if (!tip) return { blocks: [], lastIndex: -1n };
  const types = await actor.icrc3_supported_block_types();
  const supported = new Set(types.map((t) => t.block_type));
  const blocks = await fetchBlocks(actor, makeArchiveActor, 0n, tip.lastIndex);
  const ordered = verifyChain(blocks, tip.lastIndex, tip.lastHash, supported);
  return { blocks: ordered, lastIndex: tip.lastIndex, lastHash: tip.lastHash };
}
