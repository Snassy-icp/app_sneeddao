// The Chain Fusion Signer's Bitcoin methods (grghe-syaaa-aaaar-qabyq-cai), transcribed from
// dfinity/chain-fusion-signer src/signer/canister/signer.did (main, read 2026-10-23). Only the
// methods Sneed Wallet calls; field names and variant tags must match the .did exactly.
//   Network = variant { mainnet; regtest; testnet }   // testnet = Bitcoin testnet4
//   btc_caller_address : (GetAddressRequest, opt PaymentType) -> (Result)
//   btc_caller_send    : (SendBtcRequest, opt PaymentType) -> (Result_2)
//   btc_caller_sign    : (SendBtcRequest, opt PaymentType) -> (Result_3)
// Custody-relevant (spec/sneed_wallet.md §4).
export const signerIdl = ({ IDL }) => {
    const Network = IDL.Variant({ mainnet: IDL.Null, regtest: IDL.Null, testnet: IDL.Null });
    const BitcoinAddressType = IDL.Variant({ P2WPKH: IDL.Null });
    const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
    const CallerPaysIcrc2Tokens = IDL.Record({ ledger: IDL.Principal });
    const PatronPaysIcrc2Tokens = IDL.Record({ ledger: IDL.Principal, patron: Account });
    const PaymentType = IDL.Variant({
        PatronPaysIcrc2Tokens,
        AttachedCycles: IDL.Null,
        CallerPaysIcrc2Cycles: IDL.Null,
        CallerPaysIcrc2Tokens,
        PatronPaysIcrc2Cycles: Account,
    });
    const RejectionCode = IDL.Variant({
        NoError: IDL.Null, CanisterError: IDL.Null, SysTransient: IDL.Null, DestinationInvalid: IDL.Null,
        Unknown: IDL.Null, SysFatal: IDL.Null, CanisterReject: IDL.Null,
    });
    const WithdrawFromError = IDL.Variant({
        GenericError: IDL.Record({ message: IDL.Text, error_code: IDL.Nat }),
        TemporarilyUnavailable: IDL.Null,
        InsufficientAllowance: IDL.Record({ allowance: IDL.Nat }),
        Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
        InvalidReceiver: IDL.Record({ receiver: IDL.Principal }),
        CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
        TooOld: IDL.Null,
        FailedToWithdrawFrom: IDL.Record({
            withdraw_from_block: IDL.Opt(IDL.Nat),
            rejection_code: RejectionCode,
            refund_block: IDL.Opt(IDL.Nat),
            approval_refund_block: IDL.Opt(IDL.Nat),
            rejection_reason: IDL.Text,
        }),
        InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
    });
    const TransferFromError = IDL.Variant({
        GenericError: IDL.Record({ message: IDL.Text, error_code: IDL.Nat }),
        TemporarilyUnavailable: IDL.Null,
        InsufficientAllowance: IDL.Record({ allowance: IDL.Nat }),
        BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
        Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
        BadFee: IDL.Record({ expected_fee: IDL.Nat }),
        CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
        TooOld: IDL.Null,
        InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
    });
    const PaymentError = IDL.Variant({
        LedgerWithdrawFromError: IDL.Record({ error: WithdrawFromError, ledger: IDL.Principal }),
        LedgerUnreachable: CallerPaysIcrc2Tokens,
        InvalidPatron: IDL.Null,
        LedgerTransferFromError: IDL.Record({ error: TransferFromError, ledger: IDL.Principal }),
        UnsupportedPaymentType: IDL.Null,
        InsufficientFunds: IDL.Record({ needed: IDL.Nat, available: IDL.Nat }),
    });
    const GetAddressRequest = IDL.Record({ network: Network, address_type: BitcoinAddressType });
    const GetAddressResponse = IDL.Record({ address: IDL.Text });
    const GetAddressError = IDL.Variant({
        InternalError: IDL.Record({ msg: IDL.Text }),
        PaymentError,
    });
    const OutPoint = IDL.Record({ txid: IDL.Vec(IDL.Nat8), vout: IDL.Nat32 });
    const Utxo = IDL.Record({ height: IDL.Nat32, value: IDL.Nat64, outpoint: OutPoint });
    const BtcTxOutput = IDL.Record({ destination_address: IDL.Text, sent_satoshis: IDL.Nat64 });
    const SendBtcRequest = IDL.Record({
        fee_satoshis: IDL.Opt(IDL.Nat64),
        network: Network,
        utxos_to_spend: IDL.Vec(Utxo),
        address_type: BitcoinAddressType,
        outputs: IDL.Vec(BtcTxOutput),
    });
    const BuildP2wpkhTxError = IDL.Variant({
        NotEnoughFunds: IDL.Record({ available: IDL.Nat64, required: IDL.Nat64 }),
        WrongBitcoinNetwork: IDL.Null,
        NotP2WPKHSourceAddress: IDL.Null,
        InvalidDestinationAddress: GetAddressResponse,
        InvalidSourceAddress: GetAddressResponse,
    });
    const SendBtcError = IDL.Variant({
        BuildP2wpkhError: BuildP2wpkhTxError,
        InternalError: IDL.Record({ msg: IDL.Text }),
        PaymentError,
    });
    const SendBtcResponse = IDL.Record({ txid: IDL.Text });
    const SignBtcResponse = IDL.Record({ txid: IDL.Text, signed_transaction_hex: IDL.Text });
    return IDL.Service({
        btc_caller_address: IDL.Func([GetAddressRequest, IDL.Opt(PaymentType)], [IDL.Variant({ Ok: GetAddressResponse, Err: GetAddressError })], []),
        btc_caller_send: IDL.Func([SendBtcRequest, IDL.Opt(PaymentType)], [IDL.Variant({ Ok: SendBtcResponse, Err: SendBtcError })], []),
        btc_caller_sign: IDL.Func([SendBtcRequest, IDL.Opt(PaymentType)], [IDL.Variant({ Ok: SignBtcResponse, Err: SendBtcError })], []),
    });
};

export default signerIdl;
