import React, { useState, useEffect } from 'react';
import { Principal } from "@dfinity/principal";
import { useLocation, Link } from 'react-router-dom';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId  } from 'external/sneed_lock';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenLogo, getTokenMetaForSwap, get_token_conversion_rate } from './utils/TokenUtils';
import { getPrincipalDisplayInfoFromContext } from './utils/PrincipalUtils';
import { useNaming } from './NamingContext';
import { useTheme } from './contexts/ThemeContext';
import PositionCard from './PositionCard';
import './Wallet.css';
import { lockFromLocks } from './utils/PositionUtils';
import Header from './components/Header';
import { useAuth } from './AuthContext';

function PositionLock() {
    const { theme } = useTheme();
    const { principalNames, principalNicknames } = useNaming();
    const [positions, setPositions] = useState([]);
    const [showSpinner, setShowSpinner] = useState(true);
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    const location = useLocation();
    const { identity } = useAuth();

    useEffect(() => {
        const searchParams = new URLSearchParams(location.search);
        const swap_canister_id = searchParams.get('swap');
        var positionIds = searchParams.get('positions') ? searchParams.get('positions').split(',') : null;
        if (positionIds) {
            for (let i = 0; i < positionIds.length; i++) {
                positionIds[i] = BigInt(positionIds[i]);
            }
        }

        if (swap_canister_id && positionIds) {
            fetchPositionDetails(swap_canister_id, positionIds);
        }
    }, [location]);

    // Effect to fetch principal display info
    useEffect(() => {
        const fetchPrincipalInfo = () => {
            if (!positions || positions.length === 0 || !principalNames || !principalNicknames) return;

            const uniquePrincipals = new Set();
            positions.forEach(position => {
                // Only add SneedLock owner (which is a real principal), not ICPSwap owner (which is a hash)
                if (position.details?.owner) {
                    uniquePrincipals.add(position.details.owner.toString());
                }
                // Skip icpSwapOwner as it's a hash, not a principal
            });

            const displayInfoMap = new Map();
            Array.from(uniquePrincipals).forEach(principalStr => {
                try {
                    const principal = Principal.fromText(principalStr);
                    const displayInfo = getPrincipalDisplayInfoFromContext(
                        principal, 
                        principalNames, 
                        principalNicknames
                    );
                    displayInfoMap.set(principalStr, displayInfo);
                } catch (error) {
                    console.error('Error processing principal:', principalStr, error);
                }
            });

            setPrincipalDisplayInfo(displayInfoMap);
        };

        fetchPrincipalInfo();
    }, [positions, principalNames, principalNicknames]);

    const fetchPositionDetails = async (swap_canister_id, positionIds) => {
        try {
            setShowSpinner(true);
            const backendActor = createBackendActor(backendCanisterId);
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId);
            const swapActor = createIcpSwapActor(swap_canister_id, { 
                agentOptions: identity ? { identity } : undefined 
            });

            const swap_meta = await swapActor.metadata();

            const token0 = swap_meta.ok.token0.address;
            const token1 = swap_meta.ok.token1.address;

            const token_meta = await getTokenMetaForSwap(swapActor, backendActor, swap_canister_id);

            // Use the same robust approach as Wallet.jsx to extract token metadata
            const token0Decimals = token_meta?.token0?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 8;
            const token0Symbol = token_meta?.token0?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";
            const token1Decimals = token_meta?.token1?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 8;
            const token1Symbol = token_meta?.token1?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";
            
            const icrc1_ledger0 = swap_meta.ok.token0.address;
            const ledgerActor0 = createLedgerActor(icrc1_ledger0);
            const metadata0 = await ledgerActor0.icrc1_metadata();
            const token0Logo = getTokenLogo(metadata0);

            const icrc1_ledger1 = swap_meta.ok.token1.address;
            const ledgerActor1 = createLedgerActor(icrc1_ledger1);
            const metadata1 = await ledgerActor1.icrc1_metadata();
            const token1Logo = getTokenLogo(metadata1);

            // Fetch conversion rates for both tokens using the new price service
            const [token0_conversion_rate, token1_conversion_rate] = await Promise.all([
                get_token_conversion_rate(icrc1_ledger0, token0Decimals),
                get_token_conversion_rate(icrc1_ledger1, token1Decimals)
            ]);

            let offset = 0;
            const limit = 10;
            let positions = [];
            let hasMorePositions = true;
            while (hasMorePositions) {
                const allPositionsPage = (await swapActor.getUserPositionWithTokenAmount(offset, limit)).ok.content;

                for (const position of allPositionsPage) {
                    if (positionIds.includes(position.id)) {
                        positions.push(position);
                    }
                }

                offset += limit;
                hasMorePositions = allPositionsPage.length === limit;
            }

            var position_locks = await sneedLockActor.get_swap_position_locks(Principal.fromText(swap_canister_id));

            const positions_detailed = await Promise.all(positions.map(async (position) => {
                
                const lock = lockFromLocks(position.id, position_locks);
                
                // Get the ICPSwap owner
                const icpSwapOwnerResult = await swapActor.getUserByPositionId(position.id);
                const icpSwapOwner = icpSwapOwnerResult.ok || null;

                // Check ownership status
                let ownershipStatus = 'mismatch';  // Can be 'match', 'locked', or 'mismatch'
                if (lock && lock[0]) {
                    try {
                        // Create a new actor for this specific call to ensure we have the right identity
                        const ownerCheckActor = createIcpSwapActor(swap_canister_id, { 
                            agentOptions: identity ? { identity } : undefined 
                        });
                        
                        // First check: does the SneedLock owner own it directly?
                        const ownerPositions = await ownerCheckActor.getUserPositionIdsByPrincipal(lock[0]);
                        if (ownerPositions.ok && ownerPositions.ok.some(pos => pos === position.id)) {
                            ownershipStatus = 'match';
                        } else {
                            // Second check: does the SneedLock canister own it?
                            const canisterPositions = await ownerCheckActor.getUserPositionIdsByPrincipal(Principal.fromText(sneedLockCanisterId));
                            if (canisterPositions.ok && canisterPositions.ok.some(pos => pos === position.id)) {
                                ownershipStatus = 'locked';
                            }
                        }
                    } catch (error) {
                        console.error('Error checking position ownership:', error);
                    }
                }

                var position_detailed = {
                    swap_canister_id,
                    swapCanisterId: swap_canister_id,
                    token0,
                    token1,
                    token0Symbol: token0Symbol,
                    token1Symbol: token1Symbol,
                    token0Logo: token0Logo,
                    token1Logo: token1Logo,
                    token0Decimals: token0Decimals,
                    token1Decimals: token1Decimals,
                    token0_conversion_rate,
                    token1_conversion_rate,
                    details: {
                        positionId: position.id,
                        token0Amount: position.token0Amount,
                        token1Amount: position.token1Amount,
                        tokensOwed0: position.tokensOwed0,
                        tokensOwed1: position.tokensOwed1,
                        tokensUnused0: 0n,
                        tokensUnused1: 0n,
                        frontendOwnership: null,
                        lockInfo: lock ? lock[2] : null,
                        owner: lock ? lock[0] : null,
                        icpSwapOwner,
                        ownershipStatus
                    }
                }
                
                return position_detailed;
            }));
            setPositions(positions_detailed);
        } catch (error) {
            console.error('Error fetching position details:', error);
        } finally {
            setShowSpinner(false);
        }
    };

    return (
        <div className='page-container'>
            <Header customLogo="/sneedlock-logo4.png" />
            <div style={{
                textAlign: 'center',
                padding: '2rem 1rem 1rem 1rem',
                background: theme.colors.background
            }}>
                <h1 style={{
                    fontSize: '2.5rem',
                    fontWeight: '700',
                    color: theme.colors.text,
                    margin: '0 0 0.5rem 0',
                    letterSpacing: '-0.025em'
                }}>
                    Sneed Lock 2.0
                </h1>
                <h2 style={{
                    fontSize: '1.5rem',
                    fontWeight: '500',
                    color: theme.colors.textSecondary,
                    margin: '0',
                    letterSpacing: '-0.01em'
                }}>
                    Position Lock
                </h2>
            </div>
            <main className="wallet-container centered">
                {positions[0] && positions[0].details && (
                    <PositionCard
                        position={positions[0]}
                        positionDetails={positions[0].details}
                        principalDisplayInfo={principalDisplayInfo}
                        hideButtons={true}
                        hideUnclaimedFees={true}
                        defaultExpanded={true}
                        defaultLocksExpanded={true}
                    />
                )}
                {showSpinner && (
                    <div className="card">
                        <div className="spinner"></div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default PositionLock;