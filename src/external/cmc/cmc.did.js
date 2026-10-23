// Cycles Minting Canister (CMC) IDL
// Canister ID: rkp4c-7iaaa-aaaaa-aaaca-cai
export const idlFactory = ({ IDL }) => {
    const NotifyError = IDL.Variant({
        'Refunded': IDL.Record({
            'block_index': IDL.Opt(IDL.Nat64),
            'reason': IDL.Text,
        }),
        'InvalidTransaction': IDL.Text,
        'Other': IDL.Record({
            'error_message': IDL.Text,
            'error_code': IDL.Nat64,
        }),
        'Processing': IDL.Null,
        'TransactionTooOld': IDL.Nat64,
    });

    const NotifyTopUpResult = IDL.Variant({
        'Ok': IDL.Nat, // cycles added
        'Err': NotifyError,
    });

    const NotifyTopUpArg = IDL.Record({
        'block_index': IDL.Nat64,
        'canister_id': IDL.Principal,
    });

    // notify_mint_cycles: mint cycles to the caller's cycles-ledger account (dfinity/ic
    // rs/nns/cmc/cmc.did; Subaccount and Memo are opt blob). Used for Sneed Wallet signing credit.
    const NotifyMintCyclesArg = IDL.Record({
        'block_index': IDL.Nat64,
        'to_subaccount': IDL.Opt(IDL.Vec(IDL.Nat8)),
        'deposit_memo': IDL.Opt(IDL.Vec(IDL.Nat8)),
    });
    const NotifyMintCyclesResult = IDL.Variant({
        'Ok': IDL.Record({ 'block_index': IDL.Nat, 'minted': IDL.Nat, 'balance': IDL.Nat }),
        'Err': NotifyError,
    });

    const IcpXdrConversionRate = IDL.Record({
        'xdr_permyriad_per_icp': IDL.Nat64,
        'timestamp_seconds': IDL.Nat64,
    });

    const IcpXdrConversionRateResponse = IDL.Record({
        'data': IcpXdrConversionRate,
        'certificate': IDL.Vec(IDL.Nat8),
        'hash_tree': IDL.Vec(IDL.Nat8),
    });

    return IDL.Service({
        'notify_top_up': IDL.Func([NotifyTopUpArg], [NotifyTopUpResult], []),
        'notify_mint_cycles': IDL.Func([NotifyMintCyclesArg], [NotifyMintCyclesResult], []),
        'get_icp_xdr_conversion_rate': IDL.Func([], [IcpXdrConversionRateResponse], ['query']),
    });
};

export const init = ({ IDL }) => {
    return [];
};

