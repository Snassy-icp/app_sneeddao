/**
 * Utilities for checking if a new frontend version has been deployed.
 * Asset canisters don't change module_hash when assets are updated, so we fetch
 * version.json which contains a unique buildId written at build time.
 */
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
 * Fetch the current build ID from version.json (written at build time).
 * This changes on each deploy, unlike canister_info's module_hash for asset canisters.
 * @returns {Promise<string | null>} buildId string, or null on failure
 */
export const getFrontendCanisterModuleHash = async () => {
    try {
        const url = `${window.location.origin}/version.json?t=${Date.now()}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        const buildId = data?.buildId;
        if (buildId) {
            console.log('[FrontendUpdate] Fetched version.json -> buildId:', buildId);
            return buildId;
        }
        return null;
    } catch (error) {
        console.warn('[FrontendUpdate] Failed to fetch version.json:', error);
        return null;
    }
};

/**
 * We only deploy to staging and prod (both on mainnet), so always run the update check.
 */
export const isRunningOnCanister = () => true;
