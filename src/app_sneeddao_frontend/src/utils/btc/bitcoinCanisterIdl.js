// The IC Bitcoin canister's free query endpoints (spec/sneed_wallet.md §5.1), from
// dfinity/bitcoin-canister canister/candid.did. Mainnet ghsi2-tqaaa-aaaan-aaaca-cai, testnet
// (testnet4) g4xu7-jiaaa-aaaan-aaaaq-cai. Queries answer from one replica and are not certified
// (§4): fine for showing a balance, cross-checked by an update call before large sends (A2/A4).
export const bitcoinCanisterIdl = ({ IDL }) => {
    const network = IDL.Variant({ mainnet: IDL.Null, testnet: IDL.Null, regtest: IDL.Null });
    const outpoint = IDL.Record({ txid: IDL.Vec(IDL.Nat8), vout: IDL.Nat32 });
    const utxo = IDL.Record({ outpoint, value: IDL.Nat64, height: IDL.Nat32 });
    const getUtxosRequest = IDL.Record({
        network,
        address: IDL.Text,
        filter: IDL.Opt(IDL.Variant({ min_confirmations: IDL.Nat32, page: IDL.Vec(IDL.Nat8) })),
    });
    const getUtxosResponse = IDL.Record({
        utxos: IDL.Vec(utxo),
        tip_block_hash: IDL.Vec(IDL.Nat8),
        tip_height: IDL.Nat32,
        next_page: IDL.Opt(IDL.Vec(IDL.Nat8)),
    });
    const getBalanceRequest = IDL.Record({ network, address: IDL.Text, min_confirmations: IDL.Opt(IDL.Nat32) });
    const blockchainInfo = IDL.Record({ height: IDL.Nat32, block_hash: IDL.Vec(IDL.Nat8), timestamp: IDL.Nat32, difficulty: IDL.Nat, utxos_length: IDL.Nat64 });
    return IDL.Service({
        bitcoin_get_utxos_query: IDL.Func([getUtxosRequest], [getUtxosResponse], ['query']),
        bitcoin_get_balance_query: IDL.Func([getBalanceRequest], [IDL.Nat64], ['query']),
        get_blockchain_info: IDL.Func([], [blockchainInfo], ['query']),
    });
};

export default bitcoinCanisterIdl;
