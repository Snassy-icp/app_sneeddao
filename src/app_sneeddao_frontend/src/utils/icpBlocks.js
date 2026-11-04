// One block of the ICP ledger, for the transaction explorer. The ICP ledger has no ICRC
// get_transactions: its blocks come from query_blocks (archived ones from the archive's
// get_blocks callback) and name accounts by account identifier, not by principal. The block is
// returned in the shape the explorer reads for ICRC ledgers ({ kind, timestamp, transfer: [..] }),
// with each account as { accountId: hex }.
import { Actor } from '@dfinity/agent';
import { getAgent } from './icrc3/client';

export const ICP_LEDGER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';

const Tokens = (IDL) => IDL.Record({ e8s: IDL.Nat64 });
const TimeStamp = (IDL) => IDL.Record({ timestamp_nanos: IDL.Nat64 });

const blockTypes = (IDL) => {
    const AccountIdentifier = IDL.Vec(IDL.Nat8);
    const Operation = IDL.Variant({
        Mint: IDL.Record({ to: AccountIdentifier, amount: Tokens(IDL) }),
        Burn: IDL.Record({ from: AccountIdentifier, spender: IDL.Opt(AccountIdentifier), amount: Tokens(IDL) }),
        Transfer: IDL.Record({ from: AccountIdentifier, to: AccountIdentifier, amount: Tokens(IDL), fee: Tokens(IDL), spender: IDL.Opt(IDL.Vec(IDL.Nat8)) }),
        Approve: IDL.Record({
            from: AccountIdentifier, spender: AccountIdentifier, allowance_e8s: IDL.Int, allowance: Tokens(IDL), fee: Tokens(IDL),
            expires_at: IDL.Opt(TimeStamp(IDL)), expected_allowance: IDL.Opt(Tokens(IDL)),
        }),
    });
    const Transaction = IDL.Record({ memo: IDL.Nat64, icrc1_memo: IDL.Opt(IDL.Vec(IDL.Nat8)), operation: IDL.Opt(Operation), created_at_time: TimeStamp(IDL) });
    const Block = IDL.Record({ parent_hash: IDL.Opt(IDL.Vec(IDL.Nat8)), transaction: Transaction, timestamp: TimeStamp(IDL) });
    const GetBlocksArgs = IDL.Record({ start: IDL.Nat64, length: IDL.Nat64 });
    const QueryArchiveError = IDL.Variant({
        BadFirstBlockIndex: IDL.Record({ requested_index: IDL.Nat64, first_valid_index: IDL.Nat64 }),
        Other: IDL.Record({ error_code: IDL.Nat64, error_message: IDL.Text }),
    });
    const QueryArchiveResult = IDL.Variant({ Ok: IDL.Record({ blocks: IDL.Vec(Block) }), Err: QueryArchiveError });
    const QueryArchiveFn = IDL.Func([GetBlocksArgs], [QueryArchiveResult], ['query']);
    return { Block, GetBlocksArgs, QueryArchiveResult, QueryArchiveFn };
};

const ledgerIdl = ({ IDL }) => {
    const { Block, GetBlocksArgs, QueryArchiveFn } = blockTypes(IDL);
    return IDL.Service({
        query_blocks: IDL.Func([GetBlocksArgs], [IDL.Record({
            chain_length: IDL.Nat64,
            certificate: IDL.Opt(IDL.Vec(IDL.Nat8)),
            blocks: IDL.Vec(Block),
            first_block_index: IDL.Nat64,
            archived_blocks: IDL.Vec(IDL.Record({ start: IDL.Nat64, length: IDL.Nat64, callback: QueryArchiveFn })),
        })], ['query']),
    });
};

const archiveIdl = (method) => ({ IDL }) => {
    const { GetBlocksArgs, QueryArchiveResult } = blockTypes(IDL);
    return IDL.Service({ [method]: IDL.Func([GetBlocksArgs], [QueryArchiveResult], ['query']) });
};

const hex = (bytes) => Array.from(bytes || [], (b) => b.toString(16).padStart(2, '0')).join('');
const acc = (bytes) => ({ accountId: hex(bytes) });
const opt = (o, f) => (o && o.length ? [f(o[0])] : []);

/// The ICRC-explorer shape of an ICP block.
function toExplorerTx(block) {
    const op = block.transaction.operation?.[0];
    const base = { timestamp: block.timestamp.timestamp_nanos, memo: block.transaction.memo, transfer: [], mint: [], burn: [], approve: [] };
    if (!op) return { ...base, kind: 'unknown' };
    if (op.Transfer) {
        const t = op.Transfer;
        return { ...base, kind: 'transfer', transfer: [{ from: acc(t.from), to: acc(t.to), amount: t.amount.e8s, fee: [t.fee.e8s], spender: opt(t.spender, acc) }] };
    }
    if (op.Mint) return { ...base, kind: 'mint', mint: [{ to: acc(op.Mint.to), amount: op.Mint.amount.e8s }] };
    if (op.Burn) return { ...base, kind: 'burn', burn: [{ from: acc(op.Burn.from), amount: op.Burn.amount.e8s, spender: opt(op.Burn.spender, acc) }] };
    const a = op.Approve;
    return { ...base, kind: 'approve', approve: [{ from: acc(a.from), spender: acc(a.spender), amount: a.allowance.e8s, fee: [a.fee.e8s], expires_at: opt(a.expires_at, (x) => x.timestamp_nanos) }] };
}

/// Block `index` of the ICP ledger in the explorer's shape, or null when there is no such block.
export async function fetchIcpTransaction(index) {
    const at = BigInt(index);
    const agent = await getAgent(ICP_LEDGER_ID);
    const ledger = Actor.createActor(ledgerIdl, { agent, canisterId: ICP_LEDGER_ID });
    const r = await ledger.query_blocks({ start: at, length: 1n });
    if (r.blocks.length > 0 && r.first_block_index === at) return toExplorerTx(r.blocks[0]);
    const range = r.archived_blocks.find((x) => at >= x.start && at < x.start + x.length);
    if (!range) return null;
    const [archiveId, method] = range.callback;
    const archive = Actor.createActor(archiveIdl(method), { agent: await getAgent(archiveId.toText()), canisterId: archiveId });
    const ar = await archive[method]({ start: at, length: 1n });
    if ('Err' in ar) throw new Error(`The ICP archive refused block ${at}: ${Object.keys(ar.Err)[0]}`);
    return ar.Ok.blocks.length > 0 ? toExplorerTx(ar.Ok.blocks[0]) : null;
}
