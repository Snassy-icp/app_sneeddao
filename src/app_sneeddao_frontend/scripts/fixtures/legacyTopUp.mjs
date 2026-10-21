// The top-up flow as all seven call sites had it before src/utils/cyclesTopUp.js (e.g.
// Wallet.jsx handleCanisterCyclesTopUp): no created_at_time, block index kept only in a local,
// nothing persisted, errors thrown. Used only to show the regression tests fail on it:
//   TOPUP_IMPL=legacy node --test scripts/cyclesTopUp.test.mjs
import { Principal } from '@dfinity/principal';
import { principalToSubAccount } from '@dfinity/utils';

const TOP_UP_MEMO = new Uint8Array([0x54, 0x50, 0x55, 0x50, 0x00, 0x00, 0x00, 0x00]);

export async function topUpCanisterWithIcp({ ledger, cmc, canisterId, amountE8s }) {
    const canisterPrincipal = Principal.fromText(canisterId);
    const transferResult = await ledger.icrc1_transfer({
        to: { owner: Principal.fromText('rkp4c-7iaaa-aaaaa-aaaca-cai'), subaccount: [principalToSubAccount(canisterPrincipal)] },
        amount: BigInt(amountE8s),
        fee: [10_000n],
        memo: [TOP_UP_MEMO],
        from_subaccount: [],
        created_at_time: [],
    });
    if ('Err' in transferResult) throw new Error(`Transfer failed: ${JSON.stringify(transferResult.Err)}`);
    const blockIndex = transferResult.Ok;
    const notifyResult = await cmc.notify_top_up({ block_index: blockIndex, canister_id: canisterPrincipal });
    if ('Err' in notifyResult) throw new Error(`CMC error: ${Object.keys(notifyResult.Err)[0]}`);
    return { status: 'ok', final: true, cycles: notifyResult.Ok, blockIndex, resumed: false };
}
