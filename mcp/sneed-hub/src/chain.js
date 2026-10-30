// Small chain helpers shared by the tools: account ids, EXT token identifiers, subaccounts,
// IDLs not shipped as files (ICRC-3, EXT), text output and token spends.
import { createHash } from 'node:crypto';
import { Principal } from '@dfinity/principal';
import { toPrincipal, ptext, HUB_URL } from './ic.js';
import { tokenInfo, formatUnits, plain, shortErr } from './format.js';
import { parseUnits } from './safety.js';
import { idlFactory as icrc1Idl } from './idl/icrc1_ledger.did.js';

// ---- text results ----
export const textResult = (lines) => ({ content: [{ type: 'text', text: (Array.isArray(lines) ? lines.filter((l) => l != null && l !== false).join('\n') : String(lines)) }] });
export const safeText = (fn) => async (args, extra) => {
  try { return await fn(args ?? {}, extra); } catch (e) { return { isError: true, content: [{ type: 'text', text: `Error: ${shortErr(e)}` }] }; }
};
export const link = (path) => `${HUB_URL}${path}`;

// ---- bytes ----
export const toHex = (b) => Buffer.from(b).toString('hex');
export const fromHex = (h) => new Uint8Array(Buffer.from(String(h).replace(/^0x/, ''), 'hex'));

let CRC_TABLE = null;
const crc32 = (bytes) => {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/// ICP-style account identifier (hex) of a principal and optional 32-byte subaccount.
export const accountId = (principal, subaccount = null) => {
  const p = toPrincipal(principal).toUint8Array();
  const sub = subaccount && subaccount.length ? Uint8Array.from(subaccount) : new Uint8Array(32);
  const digest = createHash('sha224').update(Buffer.from([0x0a, ...Buffer.from('account-id'), ...p, ...sub])).digest();
  const c = crc32(digest);
  return toHex(Buffer.from([(c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff, ...digest]));
};

/// EXT TokenIdentifier of token `index` in collection `canisterId` (same as the frontend's ExtUtils).
export const extTokenIdentifier = (canisterId, index) => {
  const c = toPrincipal(canisterId).toUint8Array();
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i > 0xffffffff) throw new Error(`Not an EXT token index: ${index}`);
  return Principal.fromUint8Array(new Uint8Array([0x0a, 0x74, 0x69, 0x64, ...c, (i >>> 24) & 0xff, (i >>> 16) & 0xff, (i >>> 8) & 0xff, i & 0xff])).toText();
};

/// The Sneed wallet subaccount of a principal (@dfinity/utils principalToSubAccount).
export const principalSubaccount = (p) => {
  const bytes = toPrincipal(p).toUint8Array();
  const out = new Uint8Array(32);
  out[0] = bytes.length;
  out.set(bytes, 1);
  return out;
};

// ---- tokens ----
/// Whole-token text ("1.5") to base units for a ledger.
export const toBaseUnits = async (ledger, amountText) => {
  const t = await tokenInfo(ledger);
  if (t.decimals == null) throw new Error(`Cannot read the decimals of ledger ${ptext(ledger)}.`);
  return { amount: parseUnits(amountText, t.decimals), token: t };
};
export const fmt = (amount, t) => (t?.decimals != null ? `${formatUnits(amount, t.decimals)} ${t.symbol ?? ''}`.trim() : `${amount} base units`);

/// A spend entry for the safety layer.
export const spend = async (ledger, amount, what, to = null, { arbitraryTransfer = false } = {}) => {
  const t = await tokenInfo(ledger);
  return { ledger: ptext(ledger), symbol: t.symbol, decimals: t.decimals, amount: BigInt(amount), what, to, arbitraryTransfer };
};
/// Problems when the signer's main account cannot cover a plan's spends, summed per ledger (fees
/// included): e.g. an ICP lock fee plus nothing else, or ICP offered as an asset plus the ICP fee.
export const balanceProblems = async (ctx, spends) => {
  const totals = new Map();
  for (const sp of spends) totals.set(sp.ledger, (totals.get(sp.ledger) ?? 0n) + BigInt(sp.amount));
  const problems = [];
  for (const [ledger, need] of totals) {
    const bal = await (await ctx.anon(icrc1Idl, ledger)).icrc1_balance_of({ owner: toPrincipal(ctx.principal), subaccount: [] });
    if (bal < need) problems.push(`Balance ${fmt(bal, await tokenInfo(ledger))} is below the ${fmt(need, await tokenInfo(ledger))} this needs (ledger fees included).`);
  }
  return problems;
};
export const ledgerFee = async (ledger) => {
  const t = await tokenInfo(ledger);
  if (t.fee == null) throw new Error(`Cannot read the fee of ledger ${ptext(ledger)}.`);
  return BigInt(t.fee);
};

/// Account display text.
export const acct = (owner, sub) => `${ptext(owner)}${sub && sub.length ? ` subaccount ${toHex(sub)}` : ''}`;

export { plain };

// ---- IDLs ----
export const icrc3IdlFactory = ({ IDL }) => {
  const Value = IDL.Rec();
  Value.fill(IDL.Variant({ Int: IDL.Int, Map: IDL.Vec(IDL.Tuple(IDL.Text, Value)), Nat: IDL.Nat, Blob: IDL.Vec(IDL.Nat8), Text: IDL.Text, Array: IDL.Vec(Value) }));
  const GetBlocksArgs = IDL.Vec(IDL.Record({ start: IDL.Nat, length: IDL.Nat }));
  const GetBlocksResult = IDL.Rec();
  GetBlocksResult.fill(IDL.Record({
    log_length: IDL.Nat,
    blocks: IDL.Vec(IDL.Record({ id: IDL.Nat, block: Value })),
    archived_blocks: IDL.Vec(IDL.Record({ args: GetBlocksArgs, callback: IDL.Func([GetBlocksArgs], [GetBlocksResult], ['query']) })),
  }));
  return IDL.Service({
    icrc3_get_blocks: IDL.Func([GetBlocksArgs], [GetBlocksResult], ['query']),
    icrc3_get_archives: IDL.Func([IDL.Record({ from: IDL.Opt(IDL.Principal) })], [IDL.Vec(IDL.Record({ canister_id: IDL.Principal, start: IDL.Nat, end: IDL.Nat }))], ['query']),
    icrc3_supported_block_types: IDL.Func([], [IDL.Vec(IDL.Record({ block_type: IDL.Text, url: IDL.Text }))], ['query']),
  });
};

export const extIdlFactory = ({ IDL }) => {
  const CommonError = IDL.Variant({ InvalidToken: IDL.Text, Other: IDL.Text });
  const User = IDL.Variant({ address: IDL.Text, principal: IDL.Principal });
  const TransferRequest = IDL.Record({ from: User, to: User, token: IDL.Text, amount: IDL.Nat, memo: IDL.Vec(IDL.Nat8), notify: IDL.Bool, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
  const TransferResponse = IDL.Variant({ ok: IDL.Nat, err: IDL.Variant({ Unauthorized: IDL.Text, InsufficientBalance: IDL.Null, Rejected: IDL.Null, InvalidToken: IDL.Text, CannotNotify: IDL.Text, Other: IDL.Text }) });
  return IDL.Service({
    bearer: IDL.Func([IDL.Text], [IDL.Variant({ ok: IDL.Text, err: CommonError })], ['query']),
    transfer: IDL.Func([TransferRequest], [TransferResponse], []),
  });
};
