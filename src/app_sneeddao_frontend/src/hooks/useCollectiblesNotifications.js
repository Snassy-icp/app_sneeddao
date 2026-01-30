import { useState, useEffect, useCallback, useRef } from 'react';
import { Principal } from '@dfinity/principal';
import { useAuth } from '../AuthContext';
import { createActor as createRllActor, canisterId as rllCanisterId } from 'external/rll';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { fetchUserNeuronsForSns } from '../utils/NeuronUtils';
import { getAllSnses, getSnsByLedgerId } from '../utils/SnsUtils';
import { PERM } from '../utils/NeuronPermissionUtils';
import { formatAmount } from '../utils/StringUtils';
import { get_token_conversion_rate } from '../utils/TokenUtils';

// Module-level cache to persist across navigation/remounts
let cachedResult = {
    count: 0,
    items: [],
    principalId: null,
    lastChecked: null
};

// Minimum time between fetches (30 seconds) to prevent rapid re-fetching
const MIN_FETCH_INTERVAL = 30 * 1000;

/**
 * Custom hook for managing collectibles notifications
 */
export function useCollectiblesNotifications() {
    // === ALL HOOKS MUST BE CALLED UNCONDITIONALLY AT THE TOP ===
    const authResult = useAuth();
    const [collectiblesCount, setCollectiblesCount] = useState(cachedResult.count);
    const [collectiblesItems, setCollectiblesItems] = useState(cachedResult.items);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastChecked, setLastChecked] = useState(cachedResult.lastChecked);
    const isFetching = useRef(false);
    
    // Extract auth values safely after all hooks are declared
    const isAuthenticated = authResult?.isAuthenticated ?? false;
    const identity = authResult?.identity ?? null;

    // Helper to check if user has a specific permission on a neuron
    const userHasNeuronPermission = useCallback((neuron, permissionType, userPrincipal) => {
        if (!userPrincipal || !neuron.permissions) return false;
        const userPerms = neuron.permissions.find(p => 
            p.principal?.[0]?.toString() === userPrincipal
        );
        return userPerms?.permission_type?.includes(permissionType) || false;
    }, []);

    const checkForCollectibles = useCallback(async (force = false) => {
        if (!isAuthenticated || !identity) {
            setCollectiblesCount(0);
            setCollectiblesItems([]);
            cachedResult = { count: 0, items: [], principalId: null, lastChecked: null };
            return;
        }

        const currentPrincipal = identity.getPrincipal().toString();
        const now = Date.now();
        
        // Check if we should skip this fetch (use cache)
        if (!force) {
            const principalChanged = currentPrincipal !== cachedResult.principalId;
            const timeSinceLastFetch = cachedResult.lastChecked ? (now - cachedResult.lastChecked) : Infinity;
            
            // If same principal and fetched recently, use cached result
            if (!principalChanged && timeSinceLastFetch < MIN_FETCH_INTERVAL) {
                console.log('Collectibles: Using cached result (fetched', Math.round(timeSinceLastFetch / 1000), 'seconds ago)');
                setCollectiblesCount(cachedResult.count);
                setCollectiblesItems([...cachedResult.items]);
                setLastChecked(cachedResult.lastChecked);
                return;
            }
        }
        
        // Prevent concurrent fetches
        if (isFetching.current) {
            console.log('Collectibles: Fetch already in progress, skipping');
            return;
        }

        try {
            isFetching.current = true;
            setLoading(true);
            setError(null);

            const allItems = [];

            // Run all checks in parallel for speed
            const [rewardsItems, feesItems, maturityItems] = await Promise.all([
                // 1. Check RLL rewards
                (async () => {
                    try {
                        const items = [];
                        const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
                        const sneedGovernanceCanisterId = 'fi3zi-fyaaa-aaaaq-aachq-cai';
                        const neurons = await fetchUserNeuronsForSns(identity, sneedGovernanceCanisterId);
                        const arr_balances = await rllActor.balances_of_hotkey_neurons(neurons);
                        
                        // Get token metadata for each reward
                        for (const balance of arr_balances) {
                            const amount = BigInt(balance[1]);
                            if (amount > 0n) {
                                const ledgerId = balance[0];
                                try {
                                    const ledgerActor = createLedgerActor(ledgerId);
                                    const symbol = await ledgerActor.icrc1_symbol();
                                    const decimals = await ledgerActor.icrc1_decimals();
                                    const fee = await ledgerActor.icrc1_fee();
                                    const conversionRate = await get_token_conversion_rate(ledgerId.toText(), decimals);
                                    const usdValue = conversionRate ? Number(amount) / Number(10n ** BigInt(decimals)) * conversionRate : 0;
                                    
                                    items.push({
                                        type: 'reward',
                                        name: `${symbol} Rewards`,
                                        description: `${formatAmount(amount, decimals)} ${symbol}`,
                                        usdValue: usdValue,
                                        token: {
                                            ledger_canister_id: ledgerId,
                                            symbol,
                                            decimals,
                                            fee,
                                            conversion_rate: conversionRate
                                        },
                                        amount: amount
                                    });
                                } catch (err) {
                                    console.error('Error getting token metadata for reward:', err);
                                }
                            }
                        }
                        return items;
                    } catch (err) {
                        console.error('Error checking rewards:', err);
                        return [];
                    }
                })(),

                // 2. Check LP fees
                (async () => {
                    try {
                        const items = [];
                        const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
                        const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
                        
                        const swap_canisters = await backendActor.get_swap_canister_ids();
                        const claimed_positions = await sneedLockActor.get_claimed_positions_for_principal(identity.getPrincipal());
                        
                        // Build map of claimed positions by swap canister
                        const claimed_positions_by_swap = {};
                        for (const claimed_position of claimed_positions) {
                            if (!claimed_positions_by_swap[claimed_position.swap_canister_id]) {
                                claimed_positions_by_swap[claimed_position.swap_canister_id] = [];
                            }
                            claimed_positions_by_swap[claimed_position.swap_canister_id].push(claimed_position);
                        }

                        // Check each swap canister for positions with fees
                        await Promise.all(swap_canisters.map(async (swap_canister) => {
                            try {
                                const claimed_positions_for_swap = claimed_positions_by_swap[swap_canister] || [];
                                const claimed_position_ids_for_swap = claimed_positions_for_swap.map(cp => cp.position_id);
                                const claimed_positions_by_id = {};
                                for (const cp of claimed_positions_for_swap) {
                                    claimed_positions_by_id[cp.position_id] = cp;
                                }
                                
                                const swapActor = createIcpSwapActor(swap_canister);
                                const userPositionIds = (await swapActor.getUserPositionIdsByPrincipal(identity.getPrincipal())).ok || [];
                                
                                // Get swap metadata
                                const swap_meta = await swapActor.metadata();
                                const token0Address = swap_meta.ok.token0.address;
                                const token1Address = swap_meta.ok.token1.address;
                                
                                const ledgerActor0 = createLedgerActor(token0Address);
                                const ledgerActor1 = createLedgerActor(token1Address);
                                
                                const [symbol0, decimals0, symbol1, decimals1] = await Promise.all([
                                    ledgerActor0.icrc1_symbol(),
                                    ledgerActor0.icrc1_decimals(),
                                    ledgerActor1.icrc1_symbol(),
                                    ledgerActor1.icrc1_decimals()
                                ]);
                                
                                const [rate0, rate1] = await Promise.all([
                                    get_token_conversion_rate(token0Address, decimals0),
                                    get_token_conversion_rate(token1Address, decimals1)
                                ]);
                                
                                // Get all user positions (direct + claimed)
                                let offset = 0;
                                const limit = 10;
                                let hasMorePositions = true;
                                
                                while (hasMorePositions) {
                                    const allPositions = (await swapActor.getUserPositionWithTokenAmount(offset, limit)).ok?.content || [];
                                    
                                    for (const position of allPositions) {
                                        const isUserPosition = userPositionIds.includes(position.id);
                                        const isClaimedPosition = claimed_position_ids_for_swap.includes(position.id);
                                        
                                        if ((isUserPosition || isClaimedPosition) && (position.tokensOwed0 > 0n || position.tokensOwed1 > 0n)) {
                                            const fee0USD = rate0 ? Number(position.tokensOwed0) / Number(10n ** BigInt(decimals0)) * rate0 : 0;
                                            const fee1USD = rate1 ? Number(position.tokensOwed1) / Number(10n ** BigInt(decimals1)) * rate1 : 0;
                                            
                                            const isFrontend = isUserPosition;
                                            const claimInfo = claimed_positions_by_id[position.id];
                                            const isLocked = !isFrontend && claimInfo?.position_lock && claimInfo.position_lock.length > 0;
                                            
                                            items.push({
                                                type: 'fee',
                                                subtype: isFrontend ? 'frontend' : (isLocked ? 'locked' : 'unlocked'),
                                                name: `${symbol0}/${symbol1} Position #${position.id}${isFrontend ? ' (Direct)' : (isLocked ? ' (Locked)' : ' (Unlocked)')}`,
                                                description: `${formatAmount(position.tokensOwed0, decimals0)} ${symbol0} + ${formatAmount(position.tokensOwed1, decimals1)} ${symbol1}`,
                                                usdValue: fee0USD + fee1USD,
                                                position: {
                                                    swapCanisterId: swap_canister,
                                                    token0Symbol: symbol0,
                                                    token1Symbol: symbol1,
                                                    token0Decimals: decimals0,
                                                    token1Decimals: decimals1,
                                                    token0: Principal.fromText(token0Address),
                                                    token1: Principal.fromText(token1Address),
                                                    token0_conversion_rate: rate0,
                                                    token1_conversion_rate: rate1
                                                },
                                                positionDetails: {
                                                    positionId: position.id,
                                                    tokensOwed0: position.tokensOwed0,
                                                    tokensOwed1: position.tokensOwed1,
                                                    frontendOwnership: isFrontend,
                                                    lockInfo: isLocked ? claimInfo.position_lock[0] : null
                                                }
                                            });
                                        }
                                    }
                                    
                                    offset += limit;
                                    hasMorePositions = allPositions.length === limit;
                                }
                            } catch (err) {
                                console.error(`Error checking fees for swap ${swap_canister}:`, err);
                            }
                        }));
                        
                        return items;
                    } catch (err) {
                        console.error('Error checking LP fees:', err);
                        return [];
                    }
                })(),

                // 3. Check neuron maturity
                (async () => {
                    try {
                        const items = [];
                        const snsList = getAllSnses();
                        if (!snsList || snsList.length === 0) {
                            return items;
                        }

                        // Check each SNS for neurons with disbursable maturity
                        await Promise.all(snsList.map(async (sns) => {
                            try {
                                const governanceId = sns.governance_canister_id;
                                const ledgerId = sns.canisters?.ledger;
                                if (!governanceId || !ledgerId) return;
                                
                                const neurons = await fetchUserNeuronsForSns(identity, governanceId);
                                
                                // Get token info for this SNS
                                let symbol = sns.name || 'Unknown';
                                let decimals = 8;
                                let conversionRate = 0;
                                
                                try {
                                    const ledgerActor = createLedgerActor(ledgerId);
                                    symbol = await ledgerActor.icrc1_symbol();
                                    decimals = await ledgerActor.icrc1_decimals();
                                    conversionRate = await get_token_conversion_rate(ledgerId, decimals);
                                } catch (e) {
                                    console.warn('Could not get token info for SNS:', sns.name);
                                }
                                
                                for (const neuron of neurons) {
                                    const maturity = BigInt(neuron.maturity_e8s_equivalent || 0n);
                                    if (maturity > 0n && userHasNeuronPermission(neuron, PERM.DISBURSE_MATURITY, currentPrincipal)) {
                                        const maturityUSD = conversionRate ? Number(maturity) / Number(10n ** BigInt(decimals)) * conversionRate : 0;
                                        
                                        const neuronIdHex = Array.from(neuron.id[0].id)
                                            .map(b => b.toString(16).padStart(2, '0'))
                                            .join('');
                                        
                                        items.push({
                                            type: 'maturity',
                                            name: `${symbol} Neuron ${neuronIdHex.substring(0, 8)}...`,
                                            description: `${formatAmount(maturity, decimals)} ${symbol}`,
                                            usdValue: maturityUSD,
                                            token: {
                                                ledger_canister_id: ledgerId,
                                                symbol,
                                                decimals,
                                                conversion_rate: conversionRate
                                            },
                                            neuron: neuron,
                                            neuronIdHex: neuronIdHex,
                                            amount: maturity,
                                            governanceId: governanceId
                                        });
                                    }
                                }
                            } catch (err) {
                                console.error(`Error checking maturity for SNS ${sns.name}:`, err);
                            }
                        }));
                        
                        return items;
                    } catch (err) {
                        console.error('Error checking neuron maturity:', err);
                        return [];
                    }
                })()
            ]);

            allItems.push(...rewardsItems, ...feesItems, ...maturityItems);
            const totalCount = allItems.length;
            
            // Update module-level cache
            cachedResult = {
                count: totalCount,
                items: allItems,
                principalId: currentPrincipal,
                lastChecked: now
            };
            
            setCollectiblesCount(totalCount);
            setCollectiblesItems(allItems);
            setLastChecked(now);
            
            console.log(`Collectibles notifications: ${rewardsItems.length} rewards, ${feesItems.length} LP fees, ${maturityItems.length} maturity = ${totalCount} total`);
            
        } catch (err) {
            console.error('Error checking for collectibles:', err);
            setError(err.message);
            setCollectiblesCount(0);
            setCollectiblesItems([]);
        } finally {
            setLoading(false);
            isFetching.current = false;
        }
    }, [isAuthenticated, identity, userHasNeuronPermission]);

    // Handler for consolidating/collecting a single item
    const handleConsolidate = useCallback(async (item) => {
        if (!identity) throw new Error('Not authenticated');
        
        if (item.type === 'fee') {
            const { position, positionDetails, subtype } = item;
            
            if (subtype === 'frontend') {
                // Direct position - withdraw rewards directly
                const swapActor = createIcpSwapActor(position.swapCanisterId, { 
                    agentOptions: { identity } 
                });
                
                const claimResult = await swapActor.claim({ 
                    positionId: Number(positionDetails.positionId) 
                });
                
                if (!claimResult.ok) {
                    throw new Error(`Failed to claim fees: ${JSON.stringify(claimResult.err || claimResult)}`);
                }
                
                // Withdraw tokens from swap canister to wallet
                const withdrawResult0 = await swapActor.withdraw({ token: position.token0.toText(), amount: claimResult.ok.amount0, fee: 0n });
                const withdrawResult1 = await swapActor.withdraw({ token: position.token1.toText(), amount: claimResult.ok.amount1, fee: 0n });
                
                if (withdrawResult0.err) console.warn('Withdraw token0 issue:', withdrawResult0.err);
                if (withdrawResult1.err) console.warn('Withdraw token1 issue:', withdrawResult1.err);
                
            } else if (subtype === 'locked') {
                // Locked position - claim through SneedLock
                const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { 
                    agentOptions: { identity } 
                });
                
                const swapPrincipal = typeof position.swapCanisterId === 'string' 
                    ? Principal.fromText(position.swapCanisterId)
                    : position.swapCanisterId;
                
                const submitResult = await sneedLockActor.request_claim_and_withdraw(
                    swapPrincipal,
                    BigInt(positionDetails.positionId)
                );
                
                if (submitResult.Err) {
                    throw new Error(submitResult.Err);
                }
                
                // Poll for completion
                const requestId = Number(submitResult.Ok);
                let attempts = 0;
                const maxAttempts = 60; // ~60 seconds max wait
                
                while (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    const status = await sneedLockActor.get_claim_request_status(BigInt(requestId));
                    
                    if (status.Completed) {
                        break;
                    } else if (status.Failed) {
                        throw new Error(status.Failed);
                    }
                    attempts++;
                }
                
                if (attempts >= maxAttempts) {
                    throw new Error('Claim request timed out. Check your wallet later.');
                }
                
            } else if (subtype === 'unlocked') {
                // Unlocked backend position - withdraw position first, then claim
                // Note: Position stays in frontend wallet after this (same as Wallet.jsx behavior)
                const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { 
                    agentOptions: { identity } 
                });
                
                // Step 1: Withdraw position to frontend
                const withdrawResult = await sneedLockActor.transfer_position(
                    identity.getPrincipal(),
                    position.swapCanisterId,
                    positionDetails.positionId
                );
                
                if (withdrawResult.err) {
                    throw new Error(`Failed to withdraw position: ${withdrawResult.err.message || withdrawResult.err.InternalError || 'Transfer failed'}`);
                }
                
                // Step 2: Claim fees from the now-frontend position
                const swapActor = createIcpSwapActor(position.swapCanisterId, { 
                    agentOptions: { identity } 
                });
                
                const claimResult = await swapActor.claim({ 
                    positionId: Number(positionDetails.positionId) 
                });
                
                if (!claimResult.ok) {
                    throw new Error(`Failed to claim fees: ${JSON.stringify(claimResult.err || claimResult)}`);
                }
                
                // Step 3: Withdraw tokens to wallet
                await swapActor.withdraw({ token: position.token0.toText(), amount: claimResult.ok.amount0, fee: 0n });
                await swapActor.withdraw({ token: position.token1.toText(), amount: claimResult.ok.amount1, fee: 0n });
            }
            
        } else if (item.type === 'reward') {
            const rllActor = createRllActor(rllCanisterId, { agentOptions: { identity } });
            await rllActor.claim_full_balance_of_hotkey(
                item.token.ledger_canister_id,
                item.token.fee
            );
            
        } else if (item.type === 'maturity') {
            const governanceId = item.governanceId || getSnsByLedgerId(
                item.token.ledger_canister_id?.toString?.() || 
                item.token.ledger_canister_id?.toText?.() || 
                item.token.ledger_canister_id
            )?.canisters?.governance;
            
            if (!governanceId) {
                throw new Error('SNS governance not found for this token');
            }
            
            const governanceActor = createSnsGovernanceActor(governanceId, {
                agentOptions: { identity }
            });
            
            const hexToBytes = (hex) => {
                const bytes = [];
                for (let i = 0; i < hex.length; i += 2) {
                    bytes.push(parseInt(hex.substr(i, 2), 16));
                }
                return bytes;
            };
            const neuronId = { id: hexToBytes(item.neuronIdHex) };
            
            const result = await governanceActor.manage_neuron({
                subaccount: neuronId.id,
                command: [{
                    DisburseMaturity: { 
                        to_account: [],
                        percentage_to_disburse: 100 
                    }
                }]
            });
            
            if (result.command && result.command[0] && 'Error' in result.command[0]) {
                throw new Error(result.command[0].Error.error_message);
            }
        }
    }, [identity]);

    // Force refresh function (bypasses cache)
    const refreshCollectibles = useCallback(() => {
        checkForCollectibles(true);
    }, [checkForCollectibles]);

    // Open/close modal
    const openModal = useCallback(() => {
        // Ensure we have the latest items from cache before opening
        // Use spread to create a new array reference so React detects the change
        if (cachedResult.items && cachedResult.items.length > 0) {
            setCollectiblesItems([...cachedResult.items]);
            setCollectiblesCount(cachedResult.count);
        }
        setIsModalOpen(true);
    }, []);
    
    const closeModal = useCallback(() => {
        setIsModalOpen(false);
        // Refresh after closing to update counts
        setTimeout(() => checkForCollectibles(true), 500);
    }, [checkForCollectibles]);

    // Initial check - only fetch if cache is stale or principal changed
    useEffect(() => {
        if (!isAuthenticated || !identity) {
            setCollectiblesCount(0);
            setCollectiblesItems([]);
            return;
        }
        
        const currentPrincipal = identity.getPrincipal().toString();
        
        // If we have a cached result for this principal, use it immediately
        if (cachedResult.principalId === currentPrincipal && cachedResult.lastChecked) {
            setCollectiblesCount(cachedResult.count);
            setCollectiblesItems([...cachedResult.items]);
            setLastChecked(cachedResult.lastChecked);
        }
        
        // Check if we need to fetch (will use cache if recent enough)
        checkForCollectibles(false);
    }, [isAuthenticated, identity, checkForCollectibles]);

    // Periodically check for collectibles (every 5 minutes)
    useEffect(() => {
        if (!isAuthenticated || !identity) {
            return;
        }

        const interval = setInterval(() => {
            checkForCollectibles(true); // Force refresh on interval
        }, 5 * 60 * 1000); // 5 minutes

        return () => clearInterval(interval);
    }, [isAuthenticated, identity, checkForCollectibles]);

    return {
        collectiblesCount,
        collectiblesItems,
        isModalOpen,
        openModal,
        closeModal,
        handleConsolidate,
        refreshCollectibles,
        loading,
        error,
        lastChecked
    };
}

// Export function to clear cache (useful for testing or after collecting)
export function clearCollectiblesCache() {
    cachedResult = { count: 0, items: [], principalId: null, lastChecked: null };
}
