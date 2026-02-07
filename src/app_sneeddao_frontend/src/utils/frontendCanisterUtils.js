/**
 * Utilities for checking the frontend canister's WASM module hash.
 * Used to detect when a new version has been deployed.
 */
import { getCanisterInfo } from './BackendUtils';

const FRONTEND_CANISTER_IDS = {
    ic: 'pxtkg-giaaa-aaaal-ajjzq-cai',
    staging: '2icdp-6qaaa-aaaal-qjt6a-cai',
};

/**
 * Get the frontend canister ID for the current network.
 * Uses env var if available, otherwise falls back to known IDs.
 */
export const getFrontendCanisterId = () => {
    const envId = process.env.CANISTER_ID_APP_SNEEDDAO_FRONTEND;
    if (envId) return envId;

    const network = process.env.DFX_NETWORK || 'ic';
    return FRONTEND_CANISTER_IDS[network] || FRONTEND_CANISTER_IDS.ic;
};

/**
 * Convert Uint8Array module hash to hex string for comparison.
 */
const uint8ArrayToHex = (arr) => {
    if (!arr || !(arr instanceof Uint8Array)) return null;
    return Array.from(arr)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

/**
 * Fetch the current WASM module hash of the frontend canister.
 * Uses backend's get_canister_info (works with anonymous identity).
 * @param {Identity | null} identity - Optional, can be null for anonymous call
 * @returns {Promise<string | null>} Module hash as hex string, or null on failure
 */
export const getFrontendCanisterModuleHash = async (identity = null) => {
    const canisterId = getFrontendCanisterId();
    try {
        const result = await getCanisterInfo(identity, canisterId);
        if (result && 'ok' in result && result.ok?.module_hash?.[0]) {
            return uint8ArrayToHex(result.ok.module_hash[0]);
        }
        return null;
    } catch (error) {
        console.warn('[FrontendUpdate] Failed to get frontend canister module hash:', error);
        return null;
    }
};

/**
 * We only deploy to staging and prod (both on mainnet), so always run the update check.
 */
export const isRunningOnCanister = () => true;
