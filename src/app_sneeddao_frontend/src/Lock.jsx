import React, { useState, useEffect } from 'react';
import { Principal } from "@dfinity/principal";
import { useParams } from 'react-router-dom';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'external/sneed_lock';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenLogo, getTokenMetaForSwap, get_token_conversion_rate } from './utils/TokenUtils';
import { getPrincipalDisplayInfoFromContext } from './utils/PrincipalUtils';
import { useNaming } from './NamingContext';
import { useTheme } from './contexts/ThemeContext';
import { useAuth } from './AuthContext';
import TokenCard from './TokenCard';
import PositionCard from './PositionCard';
import './Wallet.css';
import { lockFromLocks } from './utils/PositionUtils';
import Header from './components/Header';

function Lock() {
    const { theme } = useTheme();
    const { principalNames, principalNicknames } = useNaming();
    const { identity } = useAuth();
    const { id } = useParams(); // Get lock ID from URL parameter
    const [lockType, setLockType] = useState(null); // 'token' or 'position'
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());
    
    // Token lock state
    const [token, setToken] = useState(null);
    const [locks, setLocks] = useState({});
    const [lockDetailsLoading, setLockDetailsLoading] = useState({});
    
    // Position lock state
    const [position, setPosition] = useState(null);
    const [positionDetails, setPositionDetails] = useState(null);

    useEffect(() => {
        if (!id) {
            setError('No lock ID provided');
            setLoading(false);
            return;
        }
        fetchLockById(id);
    }, [id]);

    // Effect to fetch principal display info
    useEffect(() => {
        const fetchPrincipalInfo = () => {
            if (!principalNames || !principalNicknames) return;

            const uniquePrincipals = new Set();
            
            // For token locks
            if (lockType === 'token' && locks) {
                Object.values(locks).forEach(lockArray => {
                    lockArray.forEach(lock => {
                        if (lock.owner) {
                            uniquePrincipals.add(lock.owner.toString());
                        }
                    });
                });
            }
            
            // For position locks
            if (lockType === 'position' && positionDetails?.owner) {
                uniquePrincipals.add(positionDetails.owner.toString());
            }

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
    }, [lockType, locks, positionDetails, principalNames, principalNicknames]);

    const fetchLockById = async (lockId) => {
        try {
            setLoading(true);
            setError(null);
            
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId);
            const lockIdBigInt = BigInt(lockId);
            
            // Get the lock info
            const lockInfo = await sneedLockActor.get_lock_by_id(lockIdBigInt);
            
            if (!lockInfo || lockInfo.length === 0) {
                setError(`Lock with ID ${lockId} not found`);
                setLoading(false);
                return;
            }

            const lock = lockInfo[0];
            
            // Check if it's a token lock or position lock
            if ('TokenLock' in lock) {
                setLockType('token');
                await fetchTokenLockDetails(lock.TokenLock);
            } else if ('PositionLock' in lock) {
                setLockType('position');
                await fetchPositionLockDetails(lock.PositionLock);
            } else {
                setError('Unknown lock type');
            }
        } catch (error) {
            console.error('Error fetching lock:', error);
            setError('Error loading lock: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchTokenLockDetails = async (fullyQualifiedLock) => {
        try {
            // FullyQualifiedLock is [Principal, TokenType, Lock]
            const [owner, tokenType, lock] = fullyQualifiedLock;
            const ledgerCanisterId = tokenType.toString();
            
            const ledgerActor = createLedgerActor(ledgerCanisterId);
            
            const [metadata, symbol, decimals] = await Promise.all([
                ledgerActor.icrc1_metadata(),
                ledgerActor.icrc1_symbol(),
                ledgerActor.icrc1_decimals()
            ]);

            const logo = getTokenLogo(metadata);
            
            const formattedLock = {
                lock_id: lock.lock_id,
                amount: lock.amount,
                expiry: new Date(Number(BigInt(lock.expiry || 0) / BigInt(1000000))),
                owner: owner.toString()
            };

            // Fetch conversion rate using the new price service
            const conversion_rate = await get_token_conversion_rate(ledgerCanisterId, decimals);

            setToken({
                ledger_canister_id: Principal.fromText(ledgerCanisterId),
                symbol,
                decimals,
                logo: logo || "icp_symbol.svg",
                locked: BigInt(lock.amount || 0),
                conversion_rate
            });

            setLocks({ [ledgerCanisterId]: [formattedLock] });
            setLockDetailsLoading({ [ledgerCanisterId]: false });
        } catch (error) {
            console.error('Error fetching token lock details:', error);
            setError('Error loading token lock details: ' + error.message);
        }
    };

    const fetchPositionLockDetails = async (fullyQualifiedPositionLock) => {
        try {
            // FullyQualifiedPositionLock is [Principal, SwapCanisterId, PositionLock]
            const [owner, swapCanisterId, positionLock] = fullyQualifiedPositionLock;
            const swap_canister_id = swapCanisterId.toString();
            const positionId = positionLock.position_id;
            
            const backendActor = createBackendActor(backendCanisterId);
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId);
            const swapActor = createIcpSwapActor(swap_canister_id, { 
                agentOptions: identity ? { identity } : undefined 
            });

            const swap_meta = await swapActor.metadata();

            // Get token addresses
            const icrc1_ledger0 = swap_meta.ok.token0.address;
            const icrc1_ledger1 = swap_meta.ok.token1.address;
            
            const token0 = Principal.fromText(icrc1_ledger0);
            const token1 = Principal.fromText(icrc1_ledger1);

            const token_meta = await getTokenMetaForSwap(swapActor, backendActor, swap_canister_id);

            // Extract token metadata
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

            // Fetch conversion rates for both tokens
            const [token0_conversion_rate, token1_conversion_rate] = await Promise.all([
                get_token_conversion_rate(icrc1_ledger0, token0Decimals),
                get_token_conversion_rate(icrc1_ledger1, token1Decimals)
            ]);

            // Fetch the position details from the swap canister
            let positionData = null;
            let offset = 0;
            const limit = 10;
            let hasMorePositions = true;
            
            while (hasMorePositions) {
                const allPositionsPage = (await swapActor.getUserPositionWithTokenAmount(offset, limit)).ok.content;
                
                const found = allPositionsPage.find(p => p.id === positionId);
                if (found) {
                    positionData = found;
                    break;
                }
                
                offset += limit;
                hasMorePositions = allPositionsPage.length === limit;
            }

            if (!positionData) {
                setError(`Position with ID ${positionId} not found in swap canister`);
                return;
            }

            // Get the ICPSwap owner
            const icpSwapOwnerResult = await swapActor.getUserByPositionId(positionId);
            const icpSwapOwner = icpSwapOwnerResult.ok || null;

            // Check ownership status
            let ownershipStatus = 'mismatch';
            try {
                const ownerCheckActor = createIcpSwapActor(swap_canister_id, { 
                    agentOptions: identity ? { identity } : undefined 
                });
                
                // Check if the SneedLock owner owns it directly
                const ownerPositions = await ownerCheckActor.getUserPositionIdsByPrincipal(owner);
                if (ownerPositions.ok && ownerPositions.ok.some(pos => pos === positionId)) {
                    ownershipStatus = 'match';
                } else {
                    // Check if the SneedLock canister owns it
                    const sneedLockPrincipal = typeof sneedLockCanisterId === 'string' 
                        ? Principal.fromText(sneedLockCanisterId) 
                        : sneedLockCanisterId;
                    const canisterPositions = await ownerCheckActor.getUserPositionIdsByPrincipal(sneedLockPrincipal);
                    if (canisterPositions.ok && canisterPositions.ok.some(pos => pos === positionId)) {
                        ownershipStatus = 'locked';
                    }
                }
            } catch (error) {
                console.error('Error checking position ownership:', error);
            }

            const positionDetailed = {
                swap_canister_id,
                swapCanisterId: swap_canister_id,
                token0,
                token1,
                token0Symbol,
                token1Symbol,
                token0Logo,
                token1Logo,
                token0Decimals,
                token1Decimals,
                token0_conversion_rate,
                token1_conversion_rate,
                details: {
                    positionId,
                    token0Amount: positionData.token0Amount,
                    token1Amount: positionData.token1Amount,
                    tokensOwed0: positionData.tokensOwed0,
                    tokensOwed1: positionData.tokensOwed1,
                    tokensUnused0: 0n,
                    tokensUnused1: 0n,
                    frontendOwnership: null,
                    lockInfo: positionLock,
                    owner,
                    icpSwapOwner,
                    ownershipStatus
                }
            };
            
            setPosition(positionDetailed);
            setPositionDetails(positionDetailed.details);
        } catch (error) {
            console.error('Error fetching position lock details:', error);
            setError('Error loading position lock details: ' + error.message);
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
                    Lock Details
                </h2>
            </div>
            <main className="wallet-container centered">
                {loading && (
                    <div className="card">
                        <div className="spinner"></div>
                    </div>
                )}
                
                {error && (
                    <div className="card" style={{
                        padding: '2rem',
                        textAlign: 'center',
                        color: theme.colors.error || '#e74c3c'
                    }}>
                        <p>{error}</p>
                    </div>
                )}
                
                {!loading && !error && lockType === 'token' && token && (
                    <TokenCard
                        token={token}
                        locks={locks}
                        lockDetailsLoading={lockDetailsLoading}
                        principalDisplayInfo={principalDisplayInfo}
                        showDebug={false}
                        hideAvailable={true}
                        hideButtons={true}
                        defaultExpanded={true}
                        defaultLocksExpanded={true}
                    />
                )}
                
                {!loading && !error && lockType === 'position' && position && positionDetails && (
                    <PositionCard
                        position={position}
                        positionDetails={positionDetails}
                        principalDisplayInfo={principalDisplayInfo}
                        hideButtons={true}
                        hideUnclaimedFees={true}
                        defaultExpanded={true}
                        defaultLocksExpanded={true}
                    />
                )}
            </main>
        </div>
    );
}

export default Lock;

