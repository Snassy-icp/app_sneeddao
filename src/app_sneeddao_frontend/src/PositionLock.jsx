import React, { useState, useEffect } from 'react';
import { Principal } from "@dfinity/principal";
import { useLocation, Link } from 'react-router-dom';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId  } from 'declarations/sneed_lock';
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
import { FaWater, FaShieldAlt, FaSpinner } from 'react-icons/fa';

// Custom CSS for animations
const customStyles = `
@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.positionlock-float {
    animation: float 3s ease-in-out infinite;
}

.positionlock-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.positionlock-spin {
    animation: spin 1s linear infinite;
}
`;

// Page accent colors - indigo/blue theme
const lockPrimary = '#6366f1';
const lockSecondary = '#818cf8';

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

            // Get token addresses - they're already strings from the swap metadata
            const icrc1_ledger0 = swap_meta.ok.token0.address;
            const icrc1_ledger1 = swap_meta.ok.token1.address;
            
            const token0 = Principal.fromText(icrc1_ledger0);
            const token1 = Principal.fromText(icrc1_ledger1);

            const token_meta = await getTokenMetaForSwap(swapActor, backendActor, swap_canister_id);

            // Use the same robust approach as Wallet.jsx to extract token metadata
            const token0Decimals = token_meta?.token0?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 8;
            const token0Symbol = token_meta?.token0?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";
            const token1Decimals = token_meta?.token1?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 8;
            const token1Symbol = token_meta?.token1?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";
            
            const ledgerActor0 = createLedgerActor(icrc1_ledger0);
            const metadata0 = await ledgerActor0.icrc1_metadata();
            const token0Logo = getTokenLogo(metadata0);

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
                            const sneedLockPrincipal = typeof sneedLockCanisterId === 'string' 
                                ? Principal.fromText(sneedLockCanisterId) 
                                : sneedLockCanisterId;
                            const canisterPositions = await ownerCheckActor.getUserPositionIdsByPrincipal(sneedLockPrincipal);
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

    // Get position symbols for subtitle
    const positionSymbols = positions[0] ? `${positions[0].token0Symbol}/${positions[0].token1Symbol}` : null;
    
    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header customLogo="/sneedlock-logo4.png" />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${lockPrimary}12 50%, ${lockSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2rem 1rem',
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    right: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${lockPrimary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-40%',
                    left: '10%',
                    width: '200px',
                    height: '200px',
                    background: `radial-gradient(circle, ${lockSecondary}10 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div className="positionlock-fade-in" style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        background: `${lockPrimary}20`,
                        color: lockPrimary,
                        padding: '6px 14px',
                        borderRadius: '20px',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        marginBottom: '1rem'
                    }}>
                        <FaShieldAlt size={12} /> SneedLock
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '0.5rem' }}>
                        <div className="positionlock-float" style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: '14px',
                            background: `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 8px 24px ${lockPrimary}40`,
                        }}>
                            <FaWater size={22} style={{ color: '#fff' }} />
                        </div>
                        <h1 style={{
                            fontSize: '1.75rem',
                            fontWeight: '700',
                            color: theme.colors.primaryText,
                            margin: 0,
                            letterSpacing: '-0.5px'
                        }}>
                            Position Lock
                        </h1>
                    </div>
                    <p style={{
                        color: theme.colors.secondaryText,
                        fontSize: '0.95rem',
                        margin: 0
                    }}>
                        {positionSymbols ? `Viewing ${positionSymbols} position lock details` : 'Loading position lock details...'}
                    </p>
                </div>
            </div>
            
            <main style={{ maxWidth: '800px', margin: '0 auto', padding: '1.5rem 1rem' }}>
                {positions[0] && positions[0].details ? (
                    <div className="positionlock-fade-in">
                        <PositionCard
                            position={positions[0]}
                            positionDetails={positions[0].details}
                            principalDisplayInfo={principalDisplayInfo}
                            hideButtons={true}
                            hideUnclaimedFees={true}
                            defaultExpanded={true}
                            defaultLocksExpanded={true}
                        />
                    </div>
                ) : showSpinner ? (
                    <div className="positionlock-fade-in" style={{
                        textAlign: 'center',
                        padding: '3rem',
                        background: theme.colors.cardGradient,
                        borderRadius: '20px',
                        border: `1px solid ${theme.colors.border}`,
                        boxShadow: theme.colors.cardShadow,
                    }}>
                        <FaSpinner className="positionlock-spin" size={32} style={{ color: lockPrimary, marginBottom: '1rem' }} />
                        <p style={{ color: theme.colors.secondaryText, margin: 0 }}>Loading position lock details...</p>
                    </div>
                ) : null}
                
                {/* Back Link */}
                <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                    <Link 
                        to="/sneedlock_info" 
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            color: lockPrimary,
                            textDecoration: 'none',
                            fontSize: '0.9rem',
                            fontWeight: '500',
                        }}
                    >
                        <FaShieldAlt size={14} /> View All Locks
                    </Link>
                </div>
            </main>
        </div>
    );
}

export default PositionLock;