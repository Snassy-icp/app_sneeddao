import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createRllActor } from 'external/rll';
import { createActor as createSneedLockActor } from 'external/sneed_lock';

export {
    createLedgerActor,
    createBackendActor,
    createIcpSwapActor,
    createRllActor,
    createSneedLockActor
}; 