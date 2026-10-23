// ck conversions through DFINITY's chain-fusion minters: BTC <-> ckBTC, ETH <-> ckETH and
// ERC-20 <-> ckERC20 (ckUSDC, ckUSDT, ...). Interfaces declared here are the subset Sneed Hub uses,
// copied from the live minters' candid:service metadata (read 2026-10-21):
//   ckBTC minter mqygn-kiaaa-aaaar-qaadq-cai, ckETH minter sv3dd-oaaaa-aaaar-qacoa-cai.
//
// Every function takes `makeActor(idlFactory, canisterId)` so the page passes one bound to the
// user's agent and the tests one bound to PocketIC. Nothing here touches React or process.env.
//
// Withdrawals use ICRC-2: the user approves the minter on the ledger (recorded by the approvals
// module so the approvals manager knows the spender), then the minter burns with transfer_from.
// Burns are fee-free on ICRC ledgers, so the approval is exactly the amount and expires in an hour.
import { Principal } from '@dfinity/principal';
import { approveAndRecord, approveErrorText } from './approvals';

export const CKBTC = {
    key: 'ckBTC', symbol: 'ckBTC', native: 'BTC', decimals: 8, kind: 'btc',
    ledger: 'mxzaz-hqaaa-aaaar-qaada-cai', minter: 'mqygn-kiaaa-aaaar-qaadq-cai',
};
export const CKETH = {
    key: 'ckETH', symbol: 'ckETH', native: 'ETH', decimals: 18, kind: 'eth',
    ledger: 'ss2fx-dyaaa-aaaar-qacoq-cai', minter: 'sv3dd-oaaaa-aaaar-qacoa-cai',
};
// ckERC20 tokens the ckETH minter supported on 2026-10-21 (get_minter_info); the page refreshes
// this from the minter, so new tokens appear without a release. Decimals equal the ERC-20's.
export const CKERC20_FALLBACK = [
    ['ckUSDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'xevnm-gaaaa-aaaar-qafnq-cai', 6],
    ['ckUSDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'cngnf-vqaaa-aaaar-qag4q-cai', 6],
    ['ckWBTC', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 'bptq2-faaaa-aaaar-qagxq-cai', 8],
    ['ckEURC', '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c', 'pe5t5-diaaa-aaaar-qahwa-cai', 6],
    ['ckXAUT', '0x68749665FF8D2d112Fa859AA293F07A622782F38', 'nza5v-qaaaa-aaaar-qahzq-cai', 6],
    ['ckLINK', '0x514910771AF9Ca656af840dff83E8264EcF986CA', 'g4tto-rqaaa-aaaar-qageq-cai', 18],
    ['ckPEPE', '0x6982508145454Ce325dDbE47a25d4ec3d2311933', 'etik7-oiaaa-aaaar-qagia-cai', 18],
    ['ckOCT', '0xF5cFBC74057C610c8EF151A439252680AC68c6DC', 'ebo5g-cyaaa-aaaar-qagla-cai', 18],
    ['ckSHIB', '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', 'fxffn-xiaaa-aaaar-qagoa-cai', 18],
    ['ckWSTETH', '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', 'j2tuh-yqaaa-aaaar-qahcq-cai', 18],
    ['ckUNI', '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', 'ilzky-ayaaa-aaaar-qahha-cai', 18],
    ['ckBAT', '0x0D8775F648430679A709E98d2b0Cb6250d2887EF', 'j7x7x-syaaa-aaaar-qcbea-cai', 18],
].map(([symbol, erc20, ledger, decimals]) => ({
    key: symbol, symbol, native: symbol.slice(2), decimals, kind: 'erc20', erc20, ledger, minter: CKETH.minter,
}));

/// Assets from a ckETH get_minter_info answer (supported_ckerc20_tokens), merged over the fallback.
/// A token unknown to this release has `decimals: null` until `decimalsByLedger` supplies them.
export function erc20AssetsFromInfo(info, decimalsByLedger = {}) {
    const listed = info?.supported_ckerc20_tokens?.[0];
    if (!listed || !listed.length) return CKERC20_FALLBACK;
    return listed.map((t) => {
        const ledger = t.ledger_canister_id.toText();
        const known = CKERC20_FALLBACK.find((a) => a.ledger === ledger);
        // null until read from the ledger: never guess (a 6-decimal token read as 18 would be off by 10^12)
        const decimals = decimalsByLedger[ledger] ?? known?.decimals ?? null;
        return { key: t.ckerc20_token_symbol, symbol: t.ckerc20_token_symbol, native: t.ckerc20_token_symbol.replace(/^ck/, ''), decimals, kind: 'erc20', erc20: t.erc20_contract_address, ledger, minter: CKETH.minter };
    });
}

const ALL_STATIC = [CKBTC, CKETH, ...CKERC20_FALLBACK];
/// The ck asset for a ledger id (text or Principal), or null.
export function ckAssetForLedger(ledgerId) {
    const id = ledgerId?.toText ? ledgerId.toText() : String(ledgerId || '');
    return ALL_STATIC.find((a) => a.ledger === id) || null;
}
export const isCkLedger = (ledgerId) => !!ckAssetForLedger(ledgerId);

// ---- Candid ----

const Sub = (IDL) => IDL.Opt(IDL.Vec(IDL.Nat8));

export const ckbtcMinterIdl = ({ IDL }) => {
    const Account = IDL.Record({ owner: IDL.Principal, subaccount: Sub(IDL) });
    const OwnerArg = IDL.Record({ owner: IDL.Opt(IDL.Principal), subaccount: Sub(IDL) });
    const Outpoint = IDL.Record({ txid: IDL.Vec(IDL.Nat8), vout: IDL.Nat32 });
    const Utxo = IDL.Record({ outpoint: Outpoint, value: IDL.Nat64, height: IDL.Nat32 });
    const UtxoStatus = IDL.Variant({
        ValueTooSmall: Utxo, Tainted: Utxo, Checked: Utxo,
        Minted: IDL.Record({ block_index: IDL.Nat64, minted_amount: IDL.Nat64, utxo: Utxo }),
    });
    const PendingUtxo = IDL.Record({ outpoint: Outpoint, value: IDL.Nat64, confirmations: IDL.Nat32 });
    const SuspendedReason = IDL.Variant({ ValueTooSmall: IDL.Null, Quarantined: IDL.Null });
    const SuspendedUtxo = IDL.Record({ utxo: Utxo, reason: SuspendedReason, earliest_retry: IDL.Nat64 });
    const UpdateBalanceError = IDL.Variant({
        NoNewUtxos: IDL.Record({
            current_confirmations: IDL.Opt(IDL.Nat32), required_confirmations: IDL.Nat32,
            pending_utxos: IDL.Opt(IDL.Vec(PendingUtxo)), suspended_utxos: IDL.Opt(IDL.Vec(SuspendedUtxo)),
        }),
        AlreadyProcessing: IDL.Null,
        TemporarilyUnavailable: IDL.Text,
        GenericError: IDL.Record({ error_message: IDL.Text, error_code: IDL.Nat64 }),
    });
    const RetrieveBtcWithApprovalError = IDL.Variant({
        MalformedAddress: IDL.Text, AlreadyProcessing: IDL.Null, AmountTooLow: IDL.Nat64,
        InsufficientFunds: IDL.Record({ balance: IDL.Nat64 }),
        InsufficientAllowance: IDL.Record({ allowance: IDL.Nat64 }),
        TemporarilyUnavailable: IDL.Text,
        GenericError: IDL.Record({ error_message: IDL.Text, error_code: IDL.Nat64 }),
    });
    const ReimbursementReason = IDL.Variant({
        CallFailed: IDL.Null,
        TaintedDestination: IDL.Record({ kyt_fee: IDL.Nat64, kyt_provider: IDL.Principal }),
    });
    const RetrieveBtcStatusV2 = IDL.Variant({
        Unknown: IDL.Null, Pending: IDL.Null, Signing: IDL.Null,
        Sending: IDL.Record({ txid: IDL.Vec(IDL.Nat8) }),
        Submitted: IDL.Record({ txid: IDL.Vec(IDL.Nat8) }),
        AmountTooLow: IDL.Null,
        Confirmed: IDL.Record({ txid: IDL.Vec(IDL.Nat8) }),
        Reimbursed: IDL.Record({ account: Account, mint_block_index: IDL.Nat64, amount: IDL.Nat64, reason: ReimbursementReason }),
        WillReimburse: IDL.Record({ account: Account, amount: IDL.Nat64, reason: ReimbursementReason }),
    });
    const MinterInfo = IDL.Record({
        min_confirmations: IDL.Nat32, retrieve_btc_min_amount: IDL.Nat64, kyt_fee: IDL.Nat64,
        deposit_btc_min_amount: IDL.Opt(IDL.Nat64),
    });
    return IDL.Service({
        get_btc_address: IDL.Func([OwnerArg], [IDL.Text], []),
        get_known_utxos: IDL.Func([OwnerArg], [IDL.Vec(Utxo)], ['query']),
        update_balance: IDL.Func([OwnerArg], [IDL.Variant({ Ok: IDL.Vec(UtxoStatus), Err: UpdateBalanceError })], []),
        estimate_withdrawal_fee: IDL.Func([IDL.Record({ amount: IDL.Opt(IDL.Nat64) })], [IDL.Record({ bitcoin_fee: IDL.Nat64, minter_fee: IDL.Nat64 })], ['query']),
        get_deposit_fee: IDL.Func([], [IDL.Nat64], ['query']),
        retrieve_btc_with_approval: IDL.Func(
            [IDL.Record({ address: IDL.Text, amount: IDL.Nat64, from_subaccount: Sub(IDL) })],
            [IDL.Variant({ Ok: IDL.Record({ block_index: IDL.Nat64 }), Err: RetrieveBtcWithApprovalError })], []),
        retrieve_btc_status_v2: IDL.Func([IDL.Record({ block_index: IDL.Nat64 })], [RetrieveBtcStatusV2], ['query']),
        retrieve_btc_status_v2_by_account: IDL.Func([IDL.Opt(Account)], [IDL.Vec(IDL.Record({ block_index: IDL.Nat64, status_v2: IDL.Opt(RetrieveBtcStatusV2) }))], ['query']),
        get_minter_info: IDL.Func([], [MinterInfo], ['query']),
    });
};

export const ckethMinterIdl = ({ IDL }) => {
    const Account = IDL.Record({ owner: IDL.Principal, subaccount: Sub(IDL) });
    const CkErc20Token = IDL.Record({ ckerc20_token_symbol: IDL.Text, erc20_contract_address: IDL.Text, ledger_canister_id: IDL.Principal });
    const GasFeeEstimate = IDL.Record({ max_fee_per_gas: IDL.Nat, max_priority_fee_per_gas: IDL.Nat, timestamp: IDL.Nat64 });
    const MinterInfo = IDL.Record({
        minter_address: IDL.Opt(IDL.Text),
        eth_helper_contract_address: IDL.Opt(IDL.Text),
        erc20_helper_contract_address: IDL.Opt(IDL.Text),
        deposit_with_subaccount_helper_contract_address: IDL.Opt(IDL.Text),
        supported_ckerc20_tokens: IDL.Opt(IDL.Vec(CkErc20Token)),
        minimum_withdrawal_amount: IDL.Opt(IDL.Nat),
        last_observed_block_number: IDL.Opt(IDL.Nat),
        last_gas_fee_estimate: IDL.Opt(GasFeeEstimate),
        minimum_deposit_amounts: IDL.Opt(IDL.Vec(IDL.Record({ erc20_contract_address: IDL.Text, minimum_deposit_amount: IDL.Nat }))),
        minimum_eth_deposit_amount: IDL.Opt(IDL.Nat),
        cketh_ledger_id: IDL.Opt(IDL.Principal),
    });
    const Price = IDL.Record({
        gas_limit: IDL.Nat, max_fee_per_gas: IDL.Nat, max_priority_fee_per_gas: IDL.Nat,
        max_transaction_fee: IDL.Nat, timestamp: IDL.Opt(IDL.Nat64),
    });
    const EthTransaction = IDL.Record({ transaction_hash: IDL.Text });
    const TxFinalizedStatus = IDL.Variant({
        Success: IDL.Record({ transaction_hash: IDL.Text, effective_transaction_fee: IDL.Opt(IDL.Nat) }),
        Reimbursed: IDL.Record({ transaction_hash: IDL.Text, reimbursed_amount: IDL.Nat, reimbursed_in_block: IDL.Nat }),
        PendingReimbursement: EthTransaction,
    });
    const RetrieveEthStatus = IDL.Variant({
        NotFound: IDL.Null, Pending: IDL.Null, TxCreated: IDL.Null, TxSent: EthTransaction, TxFinalized: TxFinalizedStatus,
    });
    const WithdrawalStatus = IDL.Variant({ Pending: IDL.Null, TxCreated: IDL.Null, TxSent: EthTransaction, TxFinalized: TxFinalizedStatus });
    const WithdrawalDetail = IDL.Record({
        token_symbol: IDL.Text, withdrawal_amount: IDL.Nat, max_transaction_fee: IDL.Opt(IDL.Nat), withdrawal_id: IDL.Nat64,
        from: IDL.Principal, from_subaccount: Sub(IDL), recipient_address: IDL.Text, status: WithdrawalStatus,
    });
    const WithdrawalError = IDL.Variant({
        AmountTooLow: IDL.Record({ min_withdrawal_amount: IDL.Nat }),
        InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
        InsufficientAllowance: IDL.Record({ allowance: IDL.Nat }),
        RecipientAddressBlocked: IDL.Record({ address: IDL.Text }),
        TemporarilyUnavailable: IDL.Text,
    });
    const LedgerError = IDL.Variant({
        InsufficientFunds: IDL.Record({ balance: IDL.Nat, failed_burn_amount: IDL.Nat, token_symbol: IDL.Text, ledger_id: IDL.Principal }),
        InsufficientAllowance: IDL.Record({ allowance: IDL.Nat, failed_burn_amount: IDL.Nat, token_symbol: IDL.Text, ledger_id: IDL.Principal }),
        AmountTooLow: IDL.Record({ minimum_burn_amount: IDL.Nat, failed_burn_amount: IDL.Nat, token_symbol: IDL.Text, ledger_id: IDL.Principal }),
        TemporarilyUnavailable: IDL.Text,
    });
    const WithdrawErc20Error = IDL.Variant({
        TokenNotSupported: IDL.Record({ supported_tokens: IDL.Vec(CkErc20Token) }),
        RecipientAddressBlocked: IDL.Record({ address: IDL.Text }),
        CkEthLedgerError: IDL.Record({ error: LedgerError }),
        CkErc20LedgerError: IDL.Record({ cketh_block_index: IDL.Nat, error: LedgerError }),
        TemporarilyUnavailable: IDL.Text,
    });
    const DepositMode = IDL.Variant({ Unsponsored: IDL.Record({ subaccount: Sub(IDL) }) });
    const Scanning = IDL.Record({ valid_until: IDL.Nat64, last_scanned_block: IDL.Opt(IDL.Nat), scan_count: IDL.Nat64 });
    const DepositEthStatus = IDL.Variant({ Scanning, AwaitingSweep: IDL.Record({ scanned_balance: IDL.Nat, detected_at_block: IDL.Nat }) });
    const DepositStatus = IDL.Variant({ Scanning, AwaitingSweep: IDL.Record({ erc20_contract_address: IDL.Text, scanned_balance: IDL.Nat, detected_at_block: IDL.Nat }) });
    const DepositEthError = IDL.Variant({ TooManyTokensForAccount: IDL.Null, TooManyActiveDeposits: IDL.Null, TemporarilyUnavailable: IDL.Text });
    const DepositErc20Error = IDL.Variant({
        TokenNotSupported: IDL.Record({ supported_tokens: IDL.Vec(CkErc20Token) }),
        TooManyTokensForAccount: IDL.Null, TooManyActiveDeposits: IDL.Null, TemporarilyUnavailable: IDL.Text,
    });
    return IDL.Service({
        get_minter_info: IDL.Func([], [MinterInfo], ['query']),
        smart_contract_address: IDL.Func([], [IDL.Text], ['query']),
        eip_1559_transaction_price: IDL.Func([IDL.Opt(IDL.Record({ ckerc20_ledger_id: IDL.Principal }))], [Price], ['query']),
        withdraw_eth: IDL.Func([IDL.Record({ recipient: IDL.Text, amount: IDL.Nat, from_subaccount: Sub(IDL) })],
            [IDL.Variant({ Ok: IDL.Record({ block_index: IDL.Nat }), Err: WithdrawalError })], []),
        withdraw_erc20: IDL.Func([IDL.Record({
            amount: IDL.Nat, ckerc20_ledger_id: IDL.Principal, recipient: IDL.Text,
            from_cketh_subaccount: Sub(IDL), from_ckerc20_subaccount: Sub(IDL),
        })], [IDL.Variant({ Ok: IDL.Record({ cketh_block_index: IDL.Nat, ckerc20_block_index: IDL.Nat }), Err: WithdrawErc20Error })], []),
        retrieve_eth_status: IDL.Func([IDL.Nat64], [RetrieveEthStatus], []),
        withdrawal_status: IDL.Func([IDL.Variant({ ByRecipient: IDL.Text, BySenderAccount: Account, ByWithdrawalId: IDL.Nat64 })], [IDL.Vec(WithdrawalDetail)], ['query']),
        is_address_blocked: IDL.Func([IDL.Text], [IDL.Bool], ['query']),
        deposit_eth: IDL.Func([IDL.Record({ mode: DepositMode })], [IDL.Variant({
            Ok: IDL.Record({ address: IDL.Text, minimum_deposit_amount: IDL.Nat, status: DepositEthStatus }), Err: DepositEthError,
        })], []),
        deposit_erc20: IDL.Func([IDL.Record({ erc20_contract_address: IDL.Text, mode: DepositMode })], [IDL.Variant({
            Ok: IDL.Record({ address: IDL.Text, minimum_deposit_amount: IDL.Nat, status: DepositStatus }), Err: DepositErc20Error,
        })], []),
    });
};

// ICRC-1/2 ledger subset
export const ckLedgerIdl = ({ IDL }) => {
    const Account = IDL.Record({ owner: IDL.Principal, subaccount: Sub(IDL) });
    const ApproveError = IDL.Variant({
        GenericError: IDL.Record({ message: IDL.Text, error_code: IDL.Nat }),
        TemporarilyUnavailable: IDL.Null,
        Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
        BadFee: IDL.Record({ expected_fee: IDL.Nat }),
        AllowanceChanged: IDL.Record({ current_allowance: IDL.Nat }),
        CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
        TooOld: IDL.Null,
        Expired: IDL.Record({ ledger_time: IDL.Nat64 }),
        InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
    });
    return IDL.Service({
        icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ['query']),
        icrc1_fee: IDL.Func([], [IDL.Nat], ['query']),
        icrc1_decimals: IDL.Func([], [IDL.Nat8], ['query']),
        icrc2_allowance: IDL.Func([IDL.Record({ account: Account, spender: Account })], [IDL.Record({ allowance: IDL.Nat, expires_at: IDL.Opt(IDL.Nat64) })], ['query']),
        icrc2_approve: IDL.Func([IDL.Record({
            fee: IDL.Opt(IDL.Nat), memo: IDL.Opt(IDL.Vec(IDL.Nat8)), from_subaccount: Sub(IDL),
            created_at_time: IDL.Opt(IDL.Nat64), amount: IDL.Nat, expected_allowance: IDL.Opt(IDL.Nat),
            expires_at: IDL.Opt(IDL.Nat64), spender: Account,
        })], [IDL.Variant({ Ok: IDL.Nat, Err: ApproveError })], []),
    });
};

// ---- Amounts ----

/// "1.5" with 8 decimals -> 150000000n. Returns null for anything that is not a plain positive decimal.
export function parseUnits(text, decimals) {
    const s = String(text ?? '').trim().replace(/,/g, '');
    if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
    const [whole, frac = ''] = s.split('.');
    if (frac.length > decimals) return null;
    return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

/// 150000000n with 8 decimals -> "1.5" (at most `maxFrac` fraction digits, rounded down; trailing zeros dropped).
export function formatUnits(value, decimals, maxFrac = decimals) {
    const v = BigInt(value ?? 0);
    const neg = v < 0n;
    const a = neg ? -v : v;
    const base = 10n ** BigInt(decimals);
    const whole = a / base;
    let frac = (a % base).toString().padStart(decimals, '0').slice(0, Math.max(0, maxFrac)).replace(/0+$/, '');
    const out = `${whole.toLocaleString('en-US')}${frac ? `.${frac}` : ''}`;
    return neg ? `-${out}` : out;
}

const now = () => BigInt(Date.now()) * 1_000_000n;
export const APPROVAL_TTL_NS = 3_600n * 1_000_000_000n; // approvals for a conversion expire after an hour

/**
 * What a ckBTC -> BTC withdrawal of `amount` sats costs and yields.
 * `fee` = estimate_withdrawal_fee answer, `minAmount` = retrieve_btc_min_amount.
 * Returns { ok, errors[], approveAmount, spend (amount + approval fee), receive (estimate), max }.
 */
export function planBtcWithdrawal({ amount, balance, ledgerFee, minAmount, fee }) {
    const errors = [];
    const lf = BigInt(ledgerFee ?? 0);
    const amt = amount == null ? null : BigInt(amount);
    const bal = balance == null ? null : BigInt(balance);
    const max = bal == null ? null : (bal > lf ? bal - lf : 0n);
    const btcFee = fee ? BigInt(fee.bitcoin_fee) + BigInt(fee.minter_fee) : null;
    if (amt == null || amt <= 0n) errors.push('Enter an amount.');
    else {
        if (minAmount != null && amt < BigInt(minAmount)) errors.push(`The minimum withdrawal is ${formatUnits(minAmount, 8)} ckBTC.`);
        if (max != null && amt > max) errors.push('Not enough ckBTC (the approval costs a ledger fee too).');
        if (btcFee != null && amt <= btcFee) errors.push('The amount does not cover the Bitcoin network and minter fees.');
    }
    return {
        ok: errors.length === 0, errors, max,
        approveAmount: amt, spend: amt == null ? null : amt + lf,
        receive: amt == null || btcFee == null ? null : (amt > btcFee ? amt - btcFee : 0n),
        networkFee: btcFee,
    };
}

/**
 * ckETH -> ETH. `price` = eip_1559_transaction_price(null); the minter deducts the transaction
 * fee from the amount, so the recipient gets at least amount - max_transaction_fee.
 */
export function planEthWithdrawal({ amount, balance, ledgerFee, minAmount, price }) {
    const errors = [];
    const lf = BigInt(ledgerFee ?? 0);
    const amt = amount == null ? null : BigInt(amount);
    const bal = balance == null ? null : BigInt(balance);
    const max = bal == null ? null : (bal > lf ? bal - lf : 0n);
    const maxFee = price ? BigInt(price.max_transaction_fee) : null;
    if (amt == null || amt <= 0n) errors.push('Enter an amount.');
    else {
        if (minAmount != null && amt < BigInt(minAmount)) errors.push(`The minimum withdrawal is ${formatUnits(minAmount, 18, 6)} ckETH.`);
        if (max != null && amt > max) errors.push('Not enough ckETH (the approval costs a ledger fee too).');
        if (maxFee != null && amt <= maxFee) errors.push('The amount does not cover the Ethereum transaction fee.');
    }
    return {
        ok: errors.length === 0, errors, max,
        approveAmount: amt, spend: amt == null ? null : amt + lf,
        receive: amt == null || maxFee == null ? null : (amt > maxFee ? amt - maxFee : 0n),
        networkFee: maxFee,
    };
}

export const GAS_MARGIN_PCT = 20n; // ckETH approved for gas: the estimate plus this margin (the minter may re-estimate)

/**
 * ckERC20 -> ERC-20. Gas is paid in ckETH (burned by the minter); the token amount arrives in full.
 * `price` = eip_1559_transaction_price(opt { ckerc20_ledger_id }).
 */
export function planErc20Withdrawal({ amount, tokenBalance, tokenLedgerFee, ckethBalance, ckethLedgerFee, price, symbol = 'token', decimals = 6 }) {
    const errors = [];
    const tf = BigInt(tokenLedgerFee ?? 0);
    const ef = BigInt(ckethLedgerFee ?? 0);
    const amt = amount == null ? null : BigInt(amount);
    const max = tokenBalance == null ? null : (BigInt(tokenBalance) > tf ? BigInt(tokenBalance) - tf : 0n);
    const gas = price ? BigInt(price.max_transaction_fee) : null;
    const gasApprove = gas == null ? null : gas + (gas * GAS_MARGIN_PCT + 99n) / 100n;
    const ckethNeeded = gasApprove == null ? null : gasApprove + ef;
    if (amt == null || amt <= 0n) errors.push('Enter an amount.');
    else if (max != null && amt > max) errors.push(`Not enough ${symbol} (the approval costs a ledger fee too).`);
    if (ckethNeeded != null && ckethBalance != null && BigInt(ckethBalance) < ckethNeeded) {
        errors.push(`You need ${formatUnits(ckethNeeded, 18, 6)} ckETH for the Ethereum gas; you have ${formatUnits(ckethBalance, 18, 6)}.`);
    }
    return {
        ok: errors.length === 0, errors, max, decimals,
        approveAmount: amt, spend: amt == null ? null : amt + tf,
        gasApprove, ckethSpend: ckethNeeded, gasEstimate: gas,
        receive: amt,
    };
}

// ---- Error texts ----

const sats = (v) => `${formatUnits(v, 8)} BTC`;
export function btcWithdrawErrorText(err) {
    const k = Object.keys(err || {})[0]; const v = err?.[k];
    switch (k) {
        case 'MalformedAddress': return `The minter cannot use this address: ${v}`;
        case 'AlreadyProcessing': return 'The minter is already processing a withdrawal for you; wait a minute and try again.';
        case 'AmountTooLow': return `Too small: the minimum is ${sats(v)}.`;
        case 'InsufficientFunds': return `Not enough ckBTC (balance ${sats(v.balance)}).`;
        case 'InsufficientAllowance': return `The minter's allowance is too low (${sats(v.allowance)}).`;
        case 'TemporarilyUnavailable': return `The minter is busy: ${v}. Try again shortly.`;
        case 'GenericError': return `Minter error ${v.error_code}: ${v.error_message}`;
        default: return `The minter refused: ${JSON.stringify(err, jsonBig)}`;
    }
}
export function updateBalanceErrorText(err) {
    const k = Object.keys(err || {})[0]; const v = err?.[k];
    switch (k) {
        case 'NoNewUtxos': {
            const pending = v.pending_utxos?.[0] || [];
            if (pending.length) {
                const c = Math.min(...pending.map((p) => Number(p.confirmations)));
                return `Your deposit is on its way: ${c} of ${v.required_confirmations} confirmations. Check again later.`;
            }
            if (v.current_confirmations?.[0] != null) return `Seen with ${v.current_confirmations[0]} of ${v.required_confirmations} confirmations so far. Check again later.`;
            return 'No new Bitcoin deposit found yet. After you send, it needs to be confirmed on the Bitcoin network first.';
        }
        case 'AlreadyProcessing': return 'The minter is already checking your address; try again in a minute.';
        case 'TemporarilyUnavailable': return `The minter is busy: ${v}. Try again shortly.`;
        case 'GenericError': return `Minter error ${v.error_code}: ${v.error_message}`;
        default: return `The minter refused: ${JSON.stringify(err, jsonBig)}`;
    }
}
export function ethWithdrawErrorText(err) {
    const k = Object.keys(err || {})[0]; const v = err?.[k];
    switch (k) {
        case 'AmountTooLow': return `Too small: the minimum is ${formatUnits(v.min_withdrawal_amount, 18, 6)} ETH.`;
        case 'InsufficientFunds': return `Not enough ckETH (balance ${formatUnits(v.balance, 18, 6)}).`;
        case 'InsufficientAllowance': return `The minter's allowance is too low (${formatUnits(v.allowance, 18, 6)} ckETH).`;
        case 'RecipientAddressBlocked': return `The minter refuses to send to ${v.address} (blocked address).`;
        case 'TemporarilyUnavailable': return `The minter is busy: ${v}. Try again shortly.`;
        default: return `The minter refused: ${JSON.stringify(err, jsonBig)}`;
    }
}
function ledgerErrorText(e) {
    const k = Object.keys(e || {})[0]; const v = e?.[k];
    switch (k) {
        case 'InsufficientFunds': return `not enough ${v.token_symbol} (balance ${v.balance}, needed ${v.failed_burn_amount} in base units)`;
        case 'InsufficientAllowance': return `the ${v.token_symbol} allowance is too low (${v.allowance}, needed ${v.failed_burn_amount} in base units)`;
        case 'AmountTooLow': return `the ${v.token_symbol} amount is below the minimum ${v.minimum_burn_amount}`;
        case 'TemporarilyUnavailable': return `the ledger is busy (${v})`;
        default: return JSON.stringify(e, jsonBig);
    }
}
export function erc20WithdrawErrorText(err) {
    const k = Object.keys(err || {})[0]; const v = err?.[k];
    switch (k) {
        case 'TokenNotSupported': return 'The minter does not support this token.';
        case 'RecipientAddressBlocked': return `The minter refuses to send to ${v.address} (blocked address).`;
        case 'CkEthLedgerError': return `Paying the gas in ckETH failed: ${ledgerErrorText(v.error)}.`;
        case 'CkErc20LedgerError': return `Burning the token failed: ${ledgerErrorText(v.error)}. The ckETH taken for gas (burn ${v.cketh_block_index}) will be reimbursed.`;
        case 'TemporarilyUnavailable': return `The minter is busy: ${v}. Try again shortly.`;
        default: return `The minter refused: ${JSON.stringify(err, jsonBig)}`;
    }
}
export function depositAddressErrorText(err) {
    const k = Object.keys(err || {})[0]; const v = err?.[k];
    switch (k) {
        case 'TooManyTokensForAccount': return 'Your account already has the most tokens armed for deposit; wait for those to finish.';
        case 'TooManyActiveDeposits': return 'The minter has too many deposits waiting right now; try again later.';
        case 'TokenNotSupported': return 'The minter does not support this token.';
        case 'TemporarilyUnavailable': return `The minter is busy: ${v}. Try again shortly.`;
        default: return `The minter refused: ${JSON.stringify(err, jsonBig)}`;
    }
}
const jsonBig = (k, v) => (typeof v === 'bigint' ? v.toString() : v);

// ---- Calls ----

const P = (x) => (typeof x === 'string' ? Principal.fromText(x) : x);
const opt = (v) => (v == null ? [] : [v]);
const subOpt = (s) => (s && s.length ? [Uint8Array.from(s)] : []);

/// icrc2_approve `spender` for exactly `amount`, expiring in an hour; recorded for the approvals manager.
export async function approveMinter(makeActor, { ledgerId, spender, amount, fromSubaccount = null, fee = null, nowNs = now() }) {
    const ledger = makeActor(ckLedgerIdl, ledgerId);
    const args = {
        spender: { owner: P(spender), subaccount: [] },
        amount: BigInt(amount),
        fee: opt(fee == null ? null : BigInt(fee)),
        memo: [],
        from_subaccount: subOpt(fromSubaccount),
        created_at_time: [],
        expected_allowance: [],
        expires_at: [nowNs + APPROVAL_TTL_NS],
    };
    const r = await approveAndRecord(ledger, typeof ledgerId === 'string' ? ledgerId : ledgerId.toText(), args);
    if ('Err' in r) throw new Error(`Approving the minter failed: ${approveErrorText(r.Err)}`);
    return r.Ok;
}

export async function ledgerInfo(makeActor, ledgerId, owner, subaccount = null) {
    const l = makeActor(ckLedgerIdl, ledgerId);
    const [balance, fee] = await Promise.all([
        owner ? l.icrc1_balance_of({ owner: P(owner), subaccount: subOpt(subaccount) }) : Promise.resolve(null),
        l.icrc1_fee(),
    ]);
    return { balance, fee };
}

// ckBTC

export const ckbtcMinter = (makeActor, id = CKBTC.minter) => makeActor(ckbtcMinterIdl, id);

export async function ckbtcInfo(makeActor, id = CKBTC.minter) {
    const m = ckbtcMinter(makeActor, id);
    const [info, depositFee] = await Promise.all([m.get_minter_info(), m.get_deposit_fee().catch(() => null)]);
    return { ...info, deposit_fee: depositFee };
}

/// The BTC deposit address for `owner` (an update call; the answer never changes for an account).
export const ckbtcDepositAddress = (makeActor, owner, subaccount = null, id = CKBTC.minter) =>
    ckbtcMinter(makeActor, id).get_btc_address({ owner: [P(owner)], subaccount: subOpt(subaccount) });

export const ckbtcKnownUtxos = (makeActor, owner, subaccount = null, id = CKBTC.minter) =>
    ckbtcMinter(makeActor, id).get_known_utxos({ owner: [P(owner)], subaccount: subOpt(subaccount) });

/// update_balance: { minted: [{amount, block}], other: [UtxoStatus], message } or throws with a readable text.
export async function ckbtcCheckDeposit(makeActor, owner, subaccount = null, id = CKBTC.minter) {
    const r = await ckbtcMinter(makeActor, id).update_balance({ owner: [P(owner)], subaccount: subOpt(subaccount) });
    if ('Err' in r) {
        const k = Object.keys(r.Err)[0];
        return { minted: [], statuses: [], pending: k === 'NoNewUtxos' ? (r.Err.NoNewUtxos.pending_utxos[0] || []) : [], message: updateBalanceErrorText(r.Err), error: k !== 'NoNewUtxos' };
    }
    const minted = r.Ok.filter((s) => 'Minted' in s).map((s) => ({ amount: s.Minted.minted_amount, block: s.Minted.block_index }));
    const bad = r.Ok.filter((s) => !('Minted' in s));
    const parts = [];
    if (minted.length) parts.push(`Minted ${formatUnits(minted.reduce((a, m) => a + BigInt(m.amount), 0n), 8)} ckBTC.`);
    for (const s of bad) {
        if ('ValueTooSmall' in s) parts.push(`A deposit of ${sats(s.ValueTooSmall.value)} is too small to cover the check fee and was not minted.`);
        if ('Tainted' in s) parts.push(`A deposit of ${sats(s.Tainted.value)} was flagged by the Bitcoin checker and quarantined.`);
        if ('Checked' in s) parts.push(`A deposit of ${sats(s.Checked.value)} passed the check; minting will finish on the next check.`);
    }
    return { minted, statuses: r.Ok, pending: [], message: parts.join(' ') || 'Nothing new to mint.', error: false };
}

/// Approve + retrieve_btc_with_approval. Returns { approveBlock, blockIndex }.
/// `approveAmount` (default `amount`): the allowance to grant; Sneed Wallet's moves pass amount +
/// one ledger fee as headroom (utils/btc/moves.js). A typed minter Err throws an Error carrying
/// `minterErr` (nothing was burned); any other throw after onStep('withdraw') leaves the outcome open.
export async function ckbtcWithdraw(makeActor, { address, amount, approveAmount = null, fromSubaccount = null, ledgerFee = null, ledgerId = CKBTC.ledger, minterId = CKBTC.minter, nowNs = now(), onStep = () => {} }) {
    onStep('approve');
    const approveBlock = await approveMinter(makeActor, { ledgerId, spender: minterId, amount: approveAmount ?? amount, fromSubaccount, fee: ledgerFee, nowNs });
    onStep('withdraw', { approveBlock });
    const r = await ckbtcMinter(makeActor, minterId).retrieve_btc_with_approval({ address: String(address).trim(), amount: BigInt(amount), from_subaccount: subOpt(fromSubaccount) });
    if ('Err' in r) { const e = new Error(btcWithdrawErrorText(r.Err)); e.minterErr = r.Err; throw e; }
    onStep('done');
    return { approveBlock, blockIndex: r.Ok.block_index };
}

/// The account's withdrawals with their status, newest first.
export async function ckbtcWithdrawals(makeActor, owner, subaccount = null, id = CKBTC.minter) {
    const list = await ckbtcMinter(makeActor, id).retrieve_btc_status_v2_by_account([{ owner: P(owner), subaccount: subOpt(subaccount) }]);
    return list.map((x) => ({ blockIndex: x.block_index, status: x.status_v2[0] || { Unknown: null } }))
        .sort((a, b) => (BigInt(b.blockIndex) > BigInt(a.blockIndex) ? 1 : -1));
}

/// Bitcoin shows txids byte-reversed; the minter and the Bitcoin canister hand back internal order.
export const btcTxidHex = (bytes) => Array.from(bytes).reverse().map((b) => b.toString(16).padStart(2, '0')).join('');

export function btcStatusText(status) {
    const k = Object.keys(status || {})[0]; const v = status?.[k];
    switch (k) {
        case 'Pending': return { label: 'Queued', tone: 'pending', detail: 'Waiting for the minter to batch it into a Bitcoin transaction.' };
        case 'Signing': return { label: 'Signing', tone: 'pending', detail: 'The minter is signing the Bitcoin transaction.' };
        case 'Sending': return { label: 'Sending', tone: 'pending', txid: btcTxidHex(v.txid), detail: 'Handing the transaction to the Bitcoin network.' };
        case 'Submitted': return { label: 'Submitted', tone: 'pending', txid: btcTxidHex(v.txid), detail: 'On the Bitcoin network, waiting for confirmations.' };
        case 'Confirmed': return { label: 'Confirmed', tone: 'success', txid: btcTxidHex(v.txid), detail: 'Done: the BTC is at the address.' };
        case 'AmountTooLow': return { label: 'Too small', tone: 'error', detail: 'The amount did not cover the transaction fees.' };
        case 'WillReimburse': return { label: 'Will reimburse', tone: 'warning', detail: `The minter will return ${sats(v.amount)} as ckBTC.` };
        case 'Reimbursed': return { label: 'Reimbursed', tone: 'warning', detail: `${sats(v.amount)} was returned as ckBTC.` };
        default: return { label: 'Unknown', tone: 'muted', detail: 'The minter has no record (it prunes old requests).' };
    }
}

// ckETH / ckERC20

export const ckethMinter = (makeActor, id = CKETH.minter) => makeActor(ckethMinterIdl, id);

export async function ckethInfo(makeActor, id = CKETH.minter) {
    return ckethMinter(makeActor, id).get_minter_info();
}

/// eip_1559_transaction_price for ETH (no ledger) or a ckERC20 ledger.
export const ckethGasPrice = (makeActor, ckerc20LedgerId = null, id = CKETH.minter) =>
    ckethMinter(makeActor, id).eip_1559_transaction_price(ckerc20LedgerId ? [{ ckerc20_ledger_id: P(ckerc20LedgerId) }] : []);

/// Approve + withdraw_eth. Returns { approveBlock, blockIndex }.
export async function ckethWithdraw(makeActor, { recipient, amount, fromSubaccount = null, ledgerFee = null, ledgerId = CKETH.ledger, minterId = CKETH.minter, nowNs = now(), onStep = () => {} }) {
    onStep('approve');
    const approveBlock = await approveMinter(makeActor, { ledgerId, spender: minterId, amount, fromSubaccount, fee: ledgerFee, nowNs });
    onStep('withdraw');
    const r = await ckethMinter(makeActor, minterId).withdraw_eth({ recipient: String(recipient).trim(), amount: BigInt(amount), from_subaccount: subOpt(fromSubaccount) });
    if ('Err' in r) throw new Error(ethWithdrawErrorText(r.Err));
    onStep('done');
    return { approveBlock, blockIndex: r.Ok.block_index };
}

/**
 * Approve ckETH (gas) and the ckERC20 ledger, then withdraw_erc20.
 * `gasApprove` from planErc20Withdrawal. Returns { gasApproveBlock, tokenApproveBlock, ckethBlock, ckerc20Block }.
 */
export async function ckerc20Withdraw(makeActor, {
    recipient, amount, tokenLedgerId, gasApprove, fromCkethSubaccount = null, fromTokenSubaccount = null,
    ckethLedgerFee = null, tokenLedgerFee = null, ckethLedgerId = CKETH.ledger, minterId = CKETH.minter, nowNs = now(), onStep = () => {},
}) {
    onStep('approve-gas');
    const gasApproveBlock = await approveMinter(makeActor, { ledgerId: ckethLedgerId, spender: minterId, amount: gasApprove, fromSubaccount: fromCkethSubaccount, fee: ckethLedgerFee, nowNs });
    onStep('approve-token');
    const tokenApproveBlock = await approveMinter(makeActor, { ledgerId: tokenLedgerId, spender: minterId, amount, fromSubaccount: fromTokenSubaccount, fee: tokenLedgerFee, nowNs });
    onStep('withdraw');
    const r = await ckethMinter(makeActor, minterId).withdraw_erc20({
        amount: BigInt(amount), ckerc20_ledger_id: P(tokenLedgerId), recipient: String(recipient).trim(),
        from_cketh_subaccount: subOpt(fromCkethSubaccount), from_ckerc20_subaccount: subOpt(fromTokenSubaccount),
    });
    if ('Err' in r) throw new Error(erc20WithdrawErrorText(r.Err));
    onStep('done');
    return { gasApproveBlock, tokenApproveBlock, ckethBlock: r.Ok.cketh_block_index, ckerc20Block: r.Ok.ckerc20_block_index };
}

/// ckETH and ckERC20 withdrawals from the account, newest first.
export async function ckethWithdrawals(makeActor, owner, subaccount = null, id = CKETH.minter) {
    const list = await ckethMinter(makeActor, id).withdrawal_status({ BySenderAccount: { owner: P(owner), subaccount: subOpt(subaccount) } });
    return [...list].sort((a, b) => (BigInt(b.withdrawal_id) > BigInt(a.withdrawal_id) ? 1 : -1));
}

export function ethStatusText(status) {
    const k = Object.keys(status || {})[0]; const v = status?.[k];
    switch (k) {
        case 'Pending': return { label: 'Queued', tone: 'pending', detail: 'Waiting for the minter to create the Ethereum transaction.' };
        case 'TxCreated': return { label: 'Created', tone: 'pending', detail: 'Transaction created, about to be signed and sent.' };
        case 'TxSent': return { label: 'Sent', tone: 'pending', tx: v.transaction_hash, detail: 'On the Ethereum network, waiting to be finalized (about 15-20 minutes).' };
        case 'NotFound': return { label: 'Not found', tone: 'muted', detail: 'The minter has no such withdrawal.' };
        case 'TxFinalized': {
            const f = Object.keys(v)[0]; const d = v[f];
            if (f === 'Success') return { label: 'Done', tone: 'success', tx: d.transaction_hash, detail: 'Finalized on Ethereum.' };
            if (f === 'Reimbursed') return { label: 'Reimbursed', tone: 'warning', tx: d.transaction_hash, detail: 'The transaction failed; the tokens were returned.' };
            return { label: 'Reimbursing', tone: 'warning', tx: d.transaction_hash, detail: 'The transaction failed; the tokens will be returned.' };
        }
        default: return { label: k || 'Unknown', tone: 'muted', detail: '' };
    }
}

/**
 * The minter's per-account Ethereum deposit address (deposit_eth / deposit_erc20, an update call
 * that arms the address for scanning). The registration fee is taken from the deposit.
 * Returns { address, minimum, status } or throws a readable Error.
 */
export async function ckethDepositAddress(makeActor, { erc20 = null, subaccount = null, id = CKETH.minter }) {
    const m = ckethMinter(makeActor, id);
    const mode = { Unsponsored: { subaccount: subOpt(subaccount) } };
    const r = erc20 ? await m.deposit_erc20({ erc20_contract_address: erc20, mode }) : await m.deposit_eth({ mode });
    if ('Err' in r) throw new Error(depositAddressErrorText(r.Err));
    return { address: r.Ok.address, minimum: r.Ok.minimum_deposit_amount, status: r.Ok.status };
}
/// A minimum of 2^256-1 means the minter cannot detect deposits of that token at an address.
export const DEPOSITS_UNAVAILABLE = (1n << 256n) - 1n;
