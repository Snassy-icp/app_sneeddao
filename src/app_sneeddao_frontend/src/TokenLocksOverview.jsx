import React, { useState, useEffect, useRef } from 'react';
import { Principal } from "@dfinity/principal";
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId  } from 'external/sneed_lock';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { getTokenLogo, getTokenMetaForSwap, get_token_conversion_rates } from './utils/TokenUtils';
import { lockFromLocks } from './utils/PositionUtils';
import { formatAmount, getUSD } from './utils/StringUtils';
import TokenCard from './TokenCard';
import PositionCard from './PositionCard';
import './Wallet.css';
import Header from './components/Header';

function TokenLocksOverview() {
    const [token, setToken] = useState(null);
    const [tokenLocks, setTokenLocks] = useState([]);
    const [positionLocks, setPositionLocks] = useState([]);
    const [totalValueLocked, setTotalValueLocked] = useState(0);
    const [inputLedgerId, setInputLedgerId] = useState('');
    const [loadingStates, setLoadingStates] = useState({
        token: true,
        tokenLocks: true,
        positionLocks: true
    });
    const prevTokenLocksValue = useRef(0);
    const prevPositionLocksValue = useRef(0);
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        const searchParams = new URLSearchParams(location.search);
        const ledgerCanisterId = searchParams.get('ledger');
        if (ledgerCanisterId) {
            setInputLedgerId(ledgerCanisterId);
            fetchLocks(ledgerCanisterId);
        }
    }, [location]);

    // Handle form submission to navigate to token locks overview page for the entered ledger ID
    // const handleSubmit = (e) => {
    //     e.preventDefault();
    //     if (inputLedgerId) {
    //         navigate(`/tokenlocksoverview?ledger=${inputLedgerId}`);
    //     }
    // };

    const fetchLocks = async (ledgerCanisterId) => {
        try {
            setLoadingStates({
                token: true,
                tokenLocks: true,
                positionLocks: true
            });

            const backendActor = createBackendActor(backendCanisterId); 
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId);
            const ledgerActor = createLedgerActor(ledgerCanisterId);
            const ledgerPrincipal = Principal.fromText(ledgerCanisterId);

            // Fetch conversion rates first as they're needed in multiple places
            const conversion_rates = await get_token_conversion_rates();

            // Fetch token details
            try {
                const [metadata, symbol, decimals] = await Promise.all([
                    ledgerActor.icrc1_metadata(),
                    ledgerActor.icrc1_symbol(),
                    ledgerActor.icrc1_decimals()
                ]);

                // Get token name from metadata
                const tokenName = metadata.find(([key]) => key === "icrc1:name")?.[1]?.Text || symbol;

                // Fetch total supply
                const totalSupply = await ledgerActor.icrc1_total_supply();

                const logo = getTokenLogo(metadata);
                const conversion_rate = conversion_rates[symbol] || 0;

                const tokenState = {
                    ledger_canister_id: ledgerCanisterId,
                    symbol,
                    name: tokenName,
                    decimals,
                    logo: logo || "icp_symbol.svg",
                    conversion_rate,
                    locked: BigInt(0),
                    available: BigInt(0),
                    balance: BigInt(0),
                    balance_backend: BigInt(0),
                    total_supply: totalSupply
                };

                setToken(tokenState);
                setLoadingStates(prev => ({ ...prev, token: false }));

                // Fetch token locks
                try {
                    const tokenLocks = await sneedLockActor.get_ledger_token_locks(ledgerPrincipal);
                    const formattedTokenLocks = tokenLocks.map(lock => ({
                        lock_id: lock[2].lock_id,
                        amount: BigInt(lock[2].amount.toString()),
                        expiry: new Date(Number(BigInt(lock[2].expiry) / BigInt(1000000)))
                    }));

                    // Calculate total locked amount for the token
                    const totalLocked = formattedTokenLocks.reduce((sum, lock) => sum + lock.amount, BigInt(0));
                    
                    // Update token state with locked amount
                    const updatedTokenState = {
                        ...tokenState,
                        locked: totalLocked
                    };
                    setToken(updatedTokenState);

                    // Calculate token locks TVL using tokenState we already have
                    const tokenLocksValue = formattedTokenLocks.reduce((sum, lock) => {
                        const amountStr = lock.amount.toString();
                        const amount = parseFloat(amountStr);
                        const scaleFactor = Math.pow(10, decimals);
                        const scaledAmount = amount / scaleFactor;
                        return sum + (scaledAmount * conversion_rate);
                    }, 0);

                    setTotalValueLocked(prevTVL => {
                        // Remove any previous token locks value (in case of re-fetch)
                        const positionLocksValue = prevTVL - prevTokenLocksValue.current;
                        // Store new token locks value for future updates
                        prevTokenLocksValue.current = tokenLocksValue;
                        return positionLocksValue + tokenLocksValue;
                    });

                    setTokenLocks(formattedTokenLocks);
                    setLoadingStates(prev => ({ ...prev, tokenLocks: false }));

                    // Fetch position locks
                    try {
                        const rawPositionLocks = await sneedLockActor.get_token_position_locks(ledgerPrincipal);
                        const positionLocksWithDetails = await Promise.all(
                            rawPositionLocks.map(async ([principal, swapCanisterId, positionLock]) => {
                                try {
                                    const swapActor = createIcpSwapActor(swapCanisterId.toText());
                                    
                                    // Get swap metadata and token info
                                    const swap_meta = await swapActor.metadata();
                                    if (!swap_meta.ok) return null;

                                    const token_meta = await getTokenMetaForSwap(swapActor, backendActor);

                                    const token0 = swap_meta.ok.token0.address;
                                    const token1 = swap_meta.ok.token1.address;

                                    // Get token details
                                    const token0Decimals = token_meta.token0[2][1].Nat;
                                    const token0Symbol = token_meta.token0[1][1].Text;
                                    const token1Decimals = token_meta.token1[2][1].Nat;
                                    const token1Symbol = token_meta.token1[1][1].Text;

                                    // Get token logos
                                    const ledgerActor0 = createLedgerActor(token0);
                                    const ledgerActor1 = createLedgerActor(token1);
                                    const [metadata0, metadata1] = await Promise.all([
                                        ledgerActor0.icrc1_metadata(),
                                        ledgerActor1.icrc1_metadata()
                                    ]);
                                    const token0Logo = getTokenLogo(metadata0);
                                    const token1Logo = getTokenLogo(metadata1);

                                    // Get position locks for this swap canister
                                    const position_locks = await sneedLockActor.get_swap_position_locks(swapCanisterId);

                                    // Get all positions using pagination like PositionLock.jsx
                                    let offset = 0;
                                    const limit = 10;
                                    let positions = [];
                                    let hasMorePositions = true;
                                    while (hasMorePositions) {
                                        const allPositionsPage = (await swapActor.getUserPositionWithTokenAmount(offset, limit)).ok.content;
                                        
                                        for (const position of allPositionsPage) {
                                            if (position.id === positionLock.position_id) {
                                                positions.push(position);
                                            }
                                        }

                                        offset += limit;
                                        hasMorePositions = allPositionsPage.length === limit;
                                    }

                                    // If we didn't find the position, return null
                                    if (positions.length === 0) return null;

                                    // Use the found position
                                    const position = positions[0];

                                    // Get position lock info using lockFromLocks utility
                                    const lock = lockFromLocks(position.id, position_locks);

                                    return {
                                        swap_canister_id: swapCanisterId.toText(),
                                        token0,
                                        token1,
                                        token0Symbol,
                                        token1Symbol,
                                        token0Logo,
                                        token1Logo,
                                        token0Decimals,
                                        token1Decimals,
                                        token0_conversion_rate: conversion_rates[token0Symbol] || 0,
                                        token1_conversion_rate: conversion_rates[token1Symbol] || 0,
                                        details: {
                                            positionId: position.id,
                                            token0Amount: position.token0Amount,
                                            token1Amount: position.token1Amount,
                                            tokensOwed0: position.tokensOwed0,
                                            tokensOwed1: position.tokensOwed1,
                                            tokensUnused0: 0n,
                                            tokensUnused1: 0n,
                                            frontendOwnership: null,
                                            lockInfo: lock ? lock[2] : null
                                        }
                                    };
                                } catch (error) {
                                    console.error('Error processing position lock:', error);
                                    return null;
                                }
                            })
                        );

                        // Filter out any failed position fetches
                        const validPositionLocks = positionLocksWithDetails.filter(lock => lock !== null);
                        setPositionLocks(validPositionLocks);

                        // Calculate position locks TVL
                        const positionLocksValue = validPositionLocks.reduce((sum, position) => {
                            const token0AmountStr = position.details.token0Amount.toString();
                            const token0Amount = parseFloat(token0AmountStr);
                            const token0DecimalNum = Number(position.token0Decimals);
                            const token0ScaleFactor = Math.pow(10, token0DecimalNum);
                            const scaledToken0Amount = token0Amount / token0ScaleFactor;
                            const token0Value = scaledToken0Amount * position.token0_conversion_rate;

                            const token1AmountStr = position.details.token1Amount.toString();
                            const token1Amount = parseFloat(token1AmountStr);
                            const token1DecimalNum = Number(position.token1Decimals);
                            const token1ScaleFactor = Math.pow(10, token1DecimalNum);
                            const scaledToken1Amount = token1Amount / token1ScaleFactor;
                            const token1Value = scaledToken1Amount * position.token1_conversion_rate;
                            
                            return sum + token0Value + token1Value;
                        }, 0);

                        setTotalValueLocked(prevTVL => {
                            // Remove any previous position locks value (in case of re-fetch)
                            const tokenLocksValue = prevTVL - prevPositionLocksValue.current;
                            // Store new position locks value for future updates
                            prevPositionLocksValue.current = positionLocksValue;
                            return tokenLocksValue + positionLocksValue;
                        });

                        setLoadingStates(prev => ({ ...prev, positionLocks: false }));
                    } catch (error) {
                        console.error('Error fetching position locks:', error);
                        setLoadingStates(prev => ({ ...prev, positionLocks: false }));
                    }
                } catch (error) {
                    console.error('Error fetching token locks:', error);
                    setLoadingStates(prev => ({ ...prev, tokenLocks: false }));
                }
            } catch (error) {
                console.error('Error fetching token details:', error);
                setLoadingStates(prev => ({ ...prev, token: false }));
            }
        } catch (error) {
            console.error('Error in fetchLocks:', error);
            setLoadingStates({
                token: false,
                tokenLocks: false,
                positionLocks: false
            });
        }
    };

    return (
        <div className='page-container'>
            <Header />
            <div className="wallet-container">
                {/* Token Overview Section */}
                {loadingStates.token ? (
                    <div className="tvl-section">
                        <div className="spinner-container">
                            <div className="spinner"></div>
                        </div>
                    </div>
                ) : token && (
                    <div className="tvl-section">
                        <div className="tvl-header">
                            <img src={token.logo} alt={token.symbol} className="tvl-token-logo" />
                            <div className="tvl-token-info">
                                <div className="tvl-token-name">{token.name}</div>
                                <div className="tvl-token-symbol">{token.symbol}</div>
                            </div>
                        </div>
                        <div className="tvl-metrics">
                            <div className="tvl-metric">
                                <div className="tvl-metric-label">Total Value Locked</div>
                                <div className="tvl-metric-value">
                                    ${totalValueLocked.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                            </div>
                            <div className="tvl-metric">
                                <div className="tvl-metric-label">Total Supply</div>
                                <div className="tvl-metric-value">
                                    {formatAmount(token.total_supply, token.decimals)} {token.symbol}{getUSD(token.total_supply, token.decimals, token.conversion_rate)}
                                </div>
                            </div>
                            <div className="tvl-metric">
                                <div className="tvl-metric-label">Percentage Locked</div>
                                <div className="tvl-metric-value placeholder">Coming Soon</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Token Input Form */}
                {/* <form onSubmit={handleSubmit} className="token-input-form">
                    <input
                        type="text"
                        value={inputLedgerId}
                        onChange={(e) => setInputLedgerId(e.target.value)}
                        placeholder="Enter token ledger canister ID"
                        className="token-input"
                    />
                    <button type="submit" className="submit-button">View Locks</button>
                </form> */}

                {/* Token Locks Section */}
                {loadingStates.tokenLocks ? (
                    <div className="locks-section">
                        <h2>Token Locks</h2>
                        <div className="spinner-container">
                            <div className="spinner"></div>
                        </div>
                    </div>
                ) : token && tokenLocks.length > 0 && (
                    <div className="locks-section">
                        <h2>Token Locks</h2>
                        <div className="locks-grid">
                            <TokenCard
                                token={token}
                                locks={{ [token.ledger_canister_id]: tokenLocks.map(lock => ({
                                    lock_id: BigInt(lock.lock_id.toString()),
                                    amount: BigInt(lock.amount.toString()),
                                    expiry: lock.expiry
                                })) }}
                                lockDetailsLoading={{}}
                                showDebug={false}
                                hideAvailable={true}
                                hideButtons={true}
                            />
                        </div>
                    </div>
                )}

                {/* Position Locks Section */}
                {loadingStates.positionLocks ? (
                    <div className="locks-section">
                        <h2>Position Locks</h2>
                        <div className="spinner-container">
                            <div className="spinner"></div>
                        </div>
                    </div>
                ) : positionLocks.length > 0 && (
                    <div className="locks-section">
                        <h2>Position Locks</h2>
                        <div className="locks-grid">
                            {positionLocks.map((positionLock, index) => (
                                <PositionCard
                                    key={`position-${index}`}
                                    position={positionLock}
                                    positionDetails={positionLock.details}
                                    hideButtons={true}
                                    hideUnclaimedFees={true}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default TokenLocksOverview; 