// Block projections: how to show blocks whose types we know. A projection
// gives each block type an icon, a colour, a one-line title, and typed field
// descriptors so the page can render amounts with token symbols, principals
// with names, timestamps as dates and lock ids as links.
//
// Field types: principal | account | ledger | pool | amount (token: key of the
// ledger field, or a fixed ledger principal) | time | lockId | text | nat |
// hash | bytes. Fields not listed are shown generically after the known ones.
import {
    FaLock, FaUnlock, FaExchangeAlt, FaArrowRight, FaCoins, FaPlus, FaClock, FaHandHoldingUsd, FaWater,
    FaUserShield, FaCog, FaFlag, FaFileImport, FaFire, FaCheck, FaArrowUp, FaArrowDown,
} from 'react-icons/fa';
import { field, btypeOf } from './value.js';

const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const SNEED_LOCK = ['pqsms-lqaaa-aaaal-ajjza-cai', '25fsc-7yaaa-aaaal-qjt5q-cai'];

const sneedlockFields = {
    cid: { label: 'Correlation id', type: 'nat' },
    caller: { label: 'Caller', type: 'principal' },
    owner: { label: 'Owner', type: 'principal' },
    from: { label: 'From', type: 'principal' },
    to: { label: 'To', type: 'principal' },
    payer: { label: 'Payer', type: 'principal' },
    user: { label: 'User', type: 'principal' },
    ledger: { label: 'Token', type: 'ledger' },
    pool: { label: 'Pool', type: 'pool' },
    token0: { label: 'Token 0', type: 'ledger' },
    token1: { label: 'Token 1', type: 'ledger' },
    lock_id: { label: 'Lock', type: 'lockId' },
    position_id: { label: 'Position', type: 'nat' },
    request_id: { label: 'Claim request', type: 'nat' },
    amount: { label: 'Amount', type: 'amount', token: 'ledger' },
    amount0: { label: 'Amount 0', type: 'amount', token: 'token0' },
    amount1: { label: 'Amount 1', type: 'amount', token: 'token1' },
    delivered0: { label: 'Delivered 0', type: 'amount', token: 'token0' },
    delivered1: { label: 'Delivered 1', type: 'amount', token: 'token1' },
    credited0: { label: 'Credited 0', type: 'amount', token: 'token0' },
    credited1: { label: 'Credited 1', type: 'amount', token: 'token1' },
    used0: { label: 'Used 0', type: 'amount', token: 'token0' },
    used1: { label: 'Used 1', type: 'amount', token: 'token1' },
    returned0: { label: 'Returned 0', type: 'amount', token: 'token0' },
    returned1: { label: 'Returned 1', type: 'amount', token: 'token1' },
    credited: { label: 'Credited', type: 'amount', token: 'ledger' },
    accepted: { label: 'Accepted', type: 'amount', token: 'ledger' },
    fee_e8s: { label: 'Fee', type: 'amount', ledger: ICP_LEDGER },
    amount_e8s: { label: 'Transferred', type: 'amount', ledger: ICP_LEDGER },
    expiry: { label: 'Locked until', type: 'time' },
    old_expiry: { label: 'Previous expiry', type: 'time' },
    ledger_tx: { label: 'Ledger block', type: 'nat' },
    icp_tx: { label: 'ICP ledger block', type: 'nat' },
    outcome: { label: 'Outcome', type: 'text' },
    status: { label: 'Status', type: 'text' },
    lock_type: { label: 'Lock type', type: 'text' },
    dex: { label: 'DEX', type: 'text' },
    increase_error: { label: 'Pool error', type: 'text' },
    key: { label: 'Setting', type: 'text' },
    value: { label: 'New value', type: 'text' },
    old_value: { label: 'Old value', type: 'text' },
    canister: { label: 'Canister', type: 'principal' },
};

const T = (label, icon, color, title) => ({ label, icon, color, title });

const sneedlock = {
    name: 'Sneed Lock',
    matches: (btype, canisterId) => btype?.startsWith('sneedlock_') || SNEED_LOCK.includes(canisterId),
    fields: sneedlockFields,
    types: {
        sneedlock_log_start: T('Log started', FaFlag, '#8b5cf6', (f) => `Activity log started with ${f('active_token_locks')} active token locks and ${f('active_position_locks')} active position locks`),
        sneedlock_import_token_lock: T('Imported token lock', FaFileImport, '#64748b', (f) => `Token lock #${f('lock_id')} imported (${f('status')})`),
        sneedlock_import_position_lock: T('Imported position lock', FaFileImport, '#64748b', (f) => `Position lock #${f('lock_id')} imported (${f('status')})`),
        sneedlock_import_position_claim: T('Imported position claim', FaFileImport, '#64748b', (f) => `Position ${f('position_id')} claim imported`),
        sneedlock_token_lock_create: T('Token lock created', FaLock, '#f59e0b', (f) => `Lock #${f('lock_id')}: ${f('amount')} locked until ${f('expiry')}`),
        sneedlock_token_lock_transfer: T('Token lock transferred', FaExchangeAlt, '#06b6d4', (f) => `Lock #${f('lock_id')} (${f('amount')}) moved from ${f('from')} to ${f('to')}${f('outcome') === 'uncertain' ? ' (outcome uncertain)' : ''}`),
        sneedlock_token_withdraw: T('Tokens withdrawn', FaArrowUp, '#10b981', (f) => `${f('amount')} withdrawn to ${f('to')}`),
        sneedlock_position_claim: T('Position claimed', FaCheck, '#a78bfa', (f) => `Position ${f('position_id')} claimed by ${f('owner')}`),
        sneedlock_position_lock_create: T('Position lock created', FaLock, '#f59e0b', (f) => `Lock #${f('lock_id')}: position ${f('position_id')} locked until ${f('expiry')}`),
        sneedlock_position_lock_extend: T('Position lock extended', FaClock, '#f59e0b', (f) => `Lock #${f('lock_id')} extended to ${f('expiry')}`),
        sneedlock_position_transfer: T('Position transferred', FaExchangeAlt, '#06b6d4', (f) => `Position ${f('position_id')} moved from ${f('from')} to ${f('to')}${f('lock_id') ? ` with lock #${f('lock_id')}` : ''}`),
        sneedlock_position_withdraw: T('Position withdrawn', FaUnlock, '#10b981', (f) => `Position ${f('position_id')} withdrawn to ${f('to')}`),
        sneedlock_fees_claim: T('Fees claimed', FaHandHoldingUsd, '#22c55e', (f) => `Position ${f('position_id')}: ${f('delivered0')} and ${f('delivered1')} delivered`),
        sneedlock_liquidity_add: T('Liquidity added', FaWater, '#3b82f6', (f) => `Position ${f('position_id')}: ${f('used0')} and ${f('used1')} added${f('increase_error') ? ' (pool refused)' : ''}`),
        sneedlock_fee_pay: T('Lock fee paid', FaCoins, '#eab308', (f) => `${f('fee_e8s')} ${f('lock_type')} lock fee paid by ${f('payer')}`),
        sneedlock_admin_token_return: T('Admin: tokens returned', FaUserShield, '#ef4444', (f) => `${f('amount')} returned to ${f('to')}`),
        sneedlock_admin_token_rescue: T('Admin: tokens rescued', FaUserShield, '#ef4444', (f) => `${f('amount')} rescued to ${f('to')}`),
        sneedlock_admin_pool_deposit: T('Admin: pool deposit', FaUserShield, '#ef4444', (f) => `${f('amount')} deposited into ${f('pool')}`),
        sneedlock_admin_pool_withdraw: T('Admin: pool withdrawal', FaUserShield, '#ef4444', (f) => `${f('amount')} withdrawn for ${f('user')}`),
        sneedlock_config_update: T('Setting changed', FaCog, '#94a3b8', (f) => `${f('key')} set to ${f('value')}${f('old_value') !== undefined ? ` (was ${f('old_value')})` : ''}`),
    },
};

// ICRC-1 / ICRC-2 ledgers: the browsed canister is the ledger, so amounts use
// its own metadata.
const ledgerFields = {
    amt: { label: 'Amount', type: 'amount', ledger: 'self' },
    fee: { label: 'Fee', type: 'amount', ledger: 'self' },
    expected_allowance: { label: 'Expected allowance', type: 'amount', ledger: 'self' },
    from: { label: 'From', type: 'account' },
    to: { label: 'To', type: 'account' },
    spender: { label: 'Spender', type: 'account' },
    memo: { label: 'Memo', type: 'bytes' },
    ts: { label: 'Created at', type: 'time' },
    expires_at: { label: 'Expires', type: 'time' },
    op: { label: 'Operation', type: 'text' },
};

const ledger = {
    name: 'ICRC-1 / ICRC-2 ledger',
    matches: (btype) => ['1xfer', '1mint', '1burn', '2approve', '2xfer', 'xfer', 'mint', 'burn', 'approve', 'transfer'].includes(btype),
    fields: ledgerFields,
    types: {
        '1xfer': T('Transfer', FaArrowRight, '#3b82f6', (f) => `${f('amt')} from ${f('from')} to ${f('to')}`),
        xfer: T('Transfer', FaArrowRight, '#3b82f6', (f) => `${f('amt')} from ${f('from')} to ${f('to')}`),
        transfer: T('Transfer', FaArrowRight, '#3b82f6', (f) => `${f('amt')} from ${f('from')} to ${f('to')}`),
        '2xfer': T('Transfer from (approved)', FaArrowRight, '#6366f1', (f) => `${f('amt')} from ${f('from')} to ${f('to')} by ${f('spender')}`),
        '1mint': T('Mint', FaPlus, '#22c55e', (f) => `${f('amt')} minted to ${f('to')}`),
        mint: T('Mint', FaPlus, '#22c55e', (f) => `${f('amt')} minted to ${f('to')}`),
        '1burn': T('Burn', FaFire, '#ef4444', (f) => `${f('amt')} burned from ${f('from')}`),
        burn: T('Burn', FaFire, '#ef4444', (f) => `${f('amt')} burned from ${f('from')}`),
        '2approve': T('Approve', FaCheck, '#f59e0b', (f) => `${f('from')} approved ${f('amt')} for ${f('spender')}`),
        approve: T('Approve', FaCheck, '#f59e0b', (f) => `${f('from')} approved ${f('amt')} for ${f('spender')}`),
    },
};

export const PROJECTIONS = [sneedlock, ledger];

/// The projection that understands this block, if any.
export function projectionFor(block, canisterId) {
    const btype = btypeOf(block);
    return PROJECTIONS.find((p) => p.types[btype] && p.matches(btype, canisterId)) || null;
}

export const fieldSpec = (projection, key) => projection?.fields?.[key] || null;

export { FaArrowDown };
