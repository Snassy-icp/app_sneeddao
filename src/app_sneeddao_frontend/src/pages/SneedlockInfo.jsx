import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { createActor as createSneedLockActor, canisterId as sneedLockCanisterId } from 'declarations/sneed_lock';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createIcpSwapActor } from 'external/icp_swap';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import { formatAmount } from '../utils/StringUtils';
import { getTokenLogo, getTokenMetaForSwap, get_token_conversion_rate } from '../utils/TokenUtils';
import Header from '../components/Header';
import { Principal } from '@dfinity/principal';
import { createActor as createNeutriniteDappActor, canisterId as neutriniteCanisterId } from 'external/neutrinite_dapp';
import { useLocation, useNavigate } from 'react-router-dom';
import { PrincipalDisplay, getPrincipalDisplayInfo } from '../utils/PrincipalUtils';
import { useTheme } from '../contexts/ThemeContext';
import PrincipalInput from '../components/PrincipalInput';
import TokenSelector from '../components/TokenSelector';
import { FaLock, FaCoins, FaWater, FaChevronDown, FaChevronRight, FaFilter, FaSpinner, FaUser, FaClock, FaShieldAlt } from 'react-icons/fa';

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

@keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.8; transform: scale(1.05); }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.lock-info-float {
    animation: float 3s ease-in-out infinite;
}

.lock-info-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.lock-info-pulse {
    animation: pulse 2s ease-in-out infinite;
}

.lock-info-spin {
    animation: spin 1s linear infinite;
}
`;

// Page accent colors - indigo/blue theme
const lockPrimary = '#6366f1';
const lockSecondary = '#818cf8';
const lockAccent = '#a5b4fc';

function SneedlockInfo() {
    const { identity } = useAuth();
    const { theme } = useTheme();
    const location = useLocation();
    const navigate = useNavigate();
    
    // Separate state for active and expired locks
    const [activeTokenData, setActiveTokenData] = useState({});
    const [expiredTokenData, setExpiredTokenData] = useState({});
    const [activeTab, setActiveTab] = useState('active'); // 'active' or 'expired'
    
    const [initialLoading, setInitialLoading] = useState(true);
    const [expiredLoading, setExpiredLoading] = useState(false);
    const [expiredLoaded, setExpiredLoaded] = useState(false);
    const [metadataLoading, setMetadataLoading] = useState(true);
    const [tokenMetadata, setTokenMetadata] = useState({});
    const [expandedRows, setExpandedRows] = useState(new Set());  // Track expanded rows
    const [conversionRates, setConversionRates] = useState({});  // Cache for conversion rates
    const [ownerFilter, setOwnerFilter] = useState('');
    const [ledgerFilter, setLedgerFilter] = useState('');
    const [principalDisplayInfo, setPrincipalDisplayInfo] = useState(new Map());

    // tokenData points to the current tab's data
    const tokenData = activeTab === 'active' ? activeTokenData : expiredTokenData;

    // Cache for swap canister data
    const swapCanisterCache = {};

    // Get filters from URL on component mount
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const ownerParam = params.get('owner');
        const ledgerParam = params.get('ledger');
        const tabParam = params.get('tab');
        if (ownerParam) setOwnerFilter(ownerParam);
        if (ledgerParam) setLedgerFilter(ledgerParam);
        if (tabParam === 'expired') setActiveTab('expired');
    }, [location]);

    // Update URL when filters change
    const updateFilters = (newOwner, newLedger, newTab) => {
        const params = new URLSearchParams(location.search);
        
        if (newOwner) {
            params.set('owner', newOwner);
        } else {
            params.delete('owner');
        }
        
        if (newLedger) {
            params.set('ledger', newLedger);
        } else {
            params.delete('ledger');
        }
        
        if (newTab === 'expired') {
            params.set('tab', 'expired');
        } else {
            params.delete('tab');
        }
        
        navigate('?' + params.toString(), { replace: true });
    };

    const handleOwnerFilterChange = (value) => {
        setOwnerFilter(value);
        updateFilters(value, ledgerFilter, activeTab);
    };

    const handleLedgerFilterChange = (value) => {
        setLedgerFilter(value);
        updateFilters(ownerFilter, value, activeTab);
    };

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        setExpandedRows(new Set()); // Reset expanded rows when switching tabs
        updateFilters(ownerFilter, ledgerFilter, tab);
        
        // Load expired locks if switching to expired tab and not yet loaded
        if (tab === 'expired' && !expiredLoaded && !expiredLoading) {
            fetchExpiredData();
        }
    };

    // Filter data by owner and ledger (expired filtering is done via tabs now)
    const getFilteredData = () => {
        if (!ownerFilter && !ledgerFilter) return tokenData;

        const filteredData = {};
        Object.entries(tokenData).forEach(([tokenKey, data]) => {
            // Skip if no data
            if (!data) return;

            // Apply ledger filter first
            if (ledgerFilter && !tokenKey.toLowerCase().includes(ledgerFilter.toLowerCase())) {
                return;
            }

            // Filter locks by owner
            let filteredTokenLocks = data.tokenLocks || [];
            let filteredPositionLocks = data.positionLocks || [];
            
            // Filter by owner
            if (ownerFilter) {
                filteredTokenLocks = filteredTokenLocks.filter(lock => {
                    if (!lock || !lock.owner) return false;
                    const ownerStr = lock.owner.toString().toLowerCase();
                    const filterStr = ownerFilter.toLowerCase();
                    
                    // Check principal ID
                    if (ownerStr.includes(filterStr)) return true;
                    
                    // Check name/nickname
                    const displayInfo = principalDisplayInfo.get(ownerStr);
                    if (!displayInfo) return false;
                    
                    const name = Array.isArray(displayInfo.name) ? displayInfo.name[0] : displayInfo.name;
                    if (name && name.toLowerCase().includes(filterStr)) return true;
                    
                    const nickname = Array.isArray(displayInfo.nickname) ? displayInfo.nickname[0] : displayInfo.nickname;
                    if (nickname && nickname.toLowerCase().includes(filterStr)) return true;
                    
                    return false;
                });
                
                filteredPositionLocks = filteredPositionLocks.filter(lock => {
                    if (!lock || !lock.owner) return false;
                    const ownerStr = lock.owner.toString().toLowerCase();
                    const filterStr = ownerFilter.toLowerCase();
                    
                    // Check principal ID
                    if (ownerStr.includes(filterStr)) return true;
                    
                    // Check name/nickname
                    const displayInfo = principalDisplayInfo.get(ownerStr);
                    if (!displayInfo) return false;
                    
                    const name = Array.isArray(displayInfo.name) ? displayInfo.name[0] : displayInfo.name;
                    if (name && name.toLowerCase().includes(filterStr)) return true;
                    
                    const nickname = Array.isArray(displayInfo.nickname) ? displayInfo.nickname[0] : displayInfo.nickname;
                    if (nickname && nickname.toLowerCase().includes(filterStr)) return true;
                    
                    return false;
                });
            }

            // Only include tokens that have matching locks
            if (filteredTokenLocks.length > 0 || filteredPositionLocks.length > 0) {
                // Calculate amounts safely
                const tokenLockAmount = filteredTokenLocks.reduce((sum, lock) => {
                    if (!lock || !lock.amount) return sum;
                    try {
                        return sum + BigInt(lock.amount);
                    } catch (e) {
                        console.warn('Invalid token lock amount:', lock);
                        return sum;
                    }
                }, 0n);

                const positionLockAmount = filteredPositionLocks.reduce((sum, lock) => {
                    if (!lock || !lock.amount) return sum;
                    try {
                        return sum + BigInt(lock.amount);
                    } catch (e) {
                        console.warn('Invalid position lock amount:', lock);
                        return sum;
                    }
                }, 0n);

                filteredData[tokenKey] = {
                    ...data,
                    tokenLocks: filteredTokenLocks,
                    positionLocks: filteredPositionLocks,
                    tokenLockCount: filteredTokenLocks.length,
                    positionLockCount: filteredPositionLocks.length,
                    tokenLockAmount,
                    positionLockAmount
                };
            }
        });
        return filteredData;
    };

    const formatUSD = (value) => {
        if (value === undefined || value === null || isNaN(value)) return '';
        return `($${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
    };

    const getUSDValue = (amount, decimals, symbol) => {
        if (!amount || !decimals || !symbol) return null;
        
        // Check cache first
        if (!conversionRates[symbol]) return null;
        
        const normalizedAmount = Number(amount) / Math.pow(10, decimals);
        return normalizedAmount * conversionRates[symbol];
    };

    const calculateTotals = () => {
        let tokenLockTotal = 0;
        let positionLockTotal = 0;

        Object.entries(getFilteredData()).forEach(([tokenKey, data]) => {
            const token = tokenMetadata[tokenKey];
            if (token) {
                const tokenLockUSD = getUSDValue(data.tokenLockAmount, token.decimals || 8, token.symbol);
                const positionLockUSD = getUSDValue(data.positionLockAmount, token.decimals || 8, token.symbol);
                
                if (tokenLockUSD) tokenLockTotal += tokenLockUSD;
                if (positionLockUSD) positionLockTotal += positionLockUSD;
            }
        });

        return {
            tokenLockTotal,
            positionLockTotal,
            combinedTotal: tokenLockTotal + positionLockTotal
        };
    };

    // Fetch conversion rate for a specific token
    const fetchTokenConversionRate = async (tokenKey, decimals, symbol) => {
        try {
            const rate = await get_token_conversion_rate(tokenKey, decimals);
            setConversionRates(prev => ({
                ...prev,
                [symbol]: rate
            }));
        } catch (err) {
            console.error(`Error fetching conversion rate for ${tokenKey}:`, err);
        }
    };

    // Fetch conversion rates for all tokens when metadata is loaded
    useEffect(() => {
        const fetchAllRates = async () => {
            const tokens = Object.keys(tokenMetadata);
            await Promise.all(
                tokens.map(tokenKey => {
                    const token = tokenMetadata[tokenKey];
                    if (token?.decimals && token?.symbol) {
                        return fetchTokenConversionRate(tokenKey, token.decimals, token.symbol);
                    }
                    return Promise.resolve();
                })
            );
        };
        
        if (Object.keys(tokenMetadata).length > 0) {
            fetchAllRates();
        }
    }, [tokenMetadata]);

    async function fetchPositionDetails(swapCanisterId) {
        if (swapCanisterCache[swapCanisterId.toText()]) {
            return swapCanisterCache[swapCanisterId.toText()];
        }

        const swapActor = createIcpSwapActor(swapCanisterId, { agentOptions: { identity } });
        const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });

        try {
            const token_meta = await getTokenMetaForSwap(swapActor, backendActor, swapCanisterId);
            const token0Decimals = token_meta?.token0?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 0;
            const token0Symbol = token_meta?.token0?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";
            const token1Decimals = token_meta?.token1?.find(([key]) => key === "decimals")?.[1]?.Nat ?? 0;
            const token1Symbol = token_meta?.token1?.find(([key]) => key === "symbol")?.[1]?.Text ?? "Unknown";
            const token0Id = token_meta?.token0?.[0]?.[1] ?? null;
            const token1Id = token_meta?.token1?.[0]?.[1] ?? null;

            let offset = 0;
            const limit = 10;
            let allPositions = [];
            let hasMorePositions = true;

            while (hasMorePositions) {
                const positionsResult = await swapActor.getUserPositionWithTokenAmount(offset, limit);
                const positions = positionsResult.ok.content;
                allPositions = [...allPositions, ...positions];
                offset += limit;
                hasMorePositions = positions.length === limit;
            }

            const data = {
                positions: allPositions,
                token0Decimals,
                token1Decimals,
                token0Symbol,
                token1Symbol,
                token0Id,
                token1Id
            };

            swapCanisterCache[swapCanisterId.toText()] = data;
            return data;
        } catch (error) {
            console.error(`Error fetching data for swap canister ${swapCanisterId.toText()}:`, error);
            swapCanisterCache[swapCanisterId.toText()] = { error: true };
            return { error: true };
        }
    }

    const toggleRow = (tokenKey) => {
        setExpandedRows(prev => {
            const newSet = new Set(prev);
            if (newSet.has(tokenKey)) {
                newSet.delete(tokenKey);
            } else {
                newSet.add(tokenKey);
            }
            return newSet;
        });
    };

    const formatTimestamp = (timestamp) => {
        if (!timestamp) return "Never";
        
        try {
            // For token locks, the field is named 'expiry'
            // For position locks, we need to handle both 'expiry' and 'expiration'
            const actualTimestamp = typeof timestamp === 'object' && timestamp.expiry ? 
                timestamp.expiry : timestamp;

            // Convert BigInt to string to avoid precision loss
            const timestampStr = actualTimestamp.toString();
            // Convert nanoseconds to milliseconds
            const milliseconds = Number(timestampStr) / 1_000_000;
            
            const date = new Date(milliseconds);
            
            // Check if date is valid
            if (isNaN(date.getTime())) {
                return "Never";
            }
            
            // Check if it's effectively "never" (far future date)
            if (date.getFullYear() > 2100) {
                return "Never";
            }
            
            return date.toLocaleString();
        } catch (error) {
            console.error("Error formatting timestamp:", error);
            return "Invalid Date";
        }
    };

    const formatExpirationWithColor = (timestamp) => {
        if (!timestamp) {
            return <span style={{ color: theme.colors.success }}>Never</span>;
        }
        
        try {
            // For token locks, the field is named 'expiry'
            // For position locks, we need to handle both 'expiry' and 'expiration'
            const actualTimestamp = typeof timestamp === 'object' && timestamp.expiry ? 
                timestamp.expiry : timestamp;

            // Convert BigInt to string to avoid precision loss
            const timestampStr = actualTimestamp.toString();
            // Convert nanoseconds to milliseconds
            const milliseconds = Number(timestampStr) / 1_000_000;
            
            const date = new Date(milliseconds);
            
            // Check if date is valid
            if (isNaN(date.getTime())) {
                return <span style={{ color: theme.colors.success }}>Never</span>;
            }
            
            // Check if it's effectively "never" (far future date)
            if (date.getFullYear() > 2100) {
                return <span style={{ color: theme.colors.success }}>Never</span>;
            }
            
            // Check if expired
            const now = new Date();
            const isExpired = date <= now;
            
            if (isExpired) {
                return <span style={{ color: theme.colors.error }}>Expired</span>;
            } else {
                return <span style={{ color: theme.colors.success }}>{date.toLocaleString()}</span>;
            }
        } catch (error) {
            console.error("Error formatting timestamp:", error);
            return <span style={{ color: theme.colors.mutedText }}>Invalid Date</span>;
        }
    };

    const truncatePrincipal = (principal) => {
        if (!principal) return 'Unknown';
        const start = principal.slice(0, 5);
        const end = principal.slice(-5);
        return `${start}...${end}`;
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    const fetchData = async () => {
        setInitialLoading(true);
        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            
            // Fetch only active (non-expired) locks for initial load
            const allTokenLocks = await sneedLockActor.get_active_token_locks();
            const allPositionLocks = await sneedLockActor.get_active_position_locks();

            console.log("Active token locks fetched", allTokenLocks);
            console.log("Active position locks fetched", allPositionLocks);
            // Aggregate token locks by token type
            const aggregatedData = {};

            // Process token locks with detailed information
            for (const lock of allTokenLocks) {
                const tokenId = lock[1];
                const amount = BigInt(lock[2].amount);
                const tokenKey = tokenId?.toText?.() || tokenId;
                const lockDetails = {
                    id: lock[0],  // Lock ID (principal)
                    lockId: lock[2].lock_id,  // Numerical lock ID
                    amount: amount,
                    expiry: lock[2].expiry,
                    owner: lock[0]?.toText?.() || lock[0]  // Use the actual owner principal
                };

                if (!aggregatedData[tokenKey]) {
                    aggregatedData[tokenKey] = {
                        tokenId,
                        tokenLockAmount: 0n,
                        positionLockAmount: 0n,
                        tokenLockCount: 0,
                        positionLockCount: 0,
                        positionsLoading: false,
                        tokenLocks: [],      // Store individual lock details
                        positionLocks: []    // Store individual position details
                    };
                }
                aggregatedData[tokenKey].tokenLockAmount += amount;
                aggregatedData[tokenKey].tokenLockCount += 1;
                aggregatedData[tokenKey].tokenLocks.push(lockDetails);
            }

            // Create a Set of tokens that appear in position locks
            const tokensInPositions = new Set();
            for (const lock of allPositionLocks) {
                tokensInPositions.add(lock[2].token0.toText());
                tokensInPositions.add(lock[2].token1.toText());
            }

            // Pre-process position locks to create initial entries for all tokens
            for (const lock of allPositionLocks) {
                const token0 = lock[2].token0;
                const token1 = lock[2].token1;
                
                // Initialize token0 data if not exists
                const token0Key = token0.toText();
                if (!aggregatedData[token0Key]) {
                    aggregatedData[token0Key] = {
                        tokenId: token0,
                        tokenLockAmount: 0n,
                        positionLockAmount: 0n,
                        tokenLockCount: 0,
                        positionLockCount: 0,
                        positionsLoading: true,  // Set to true because this token has positions
                        tokenLocks: [],
                        positionLocks: []
                    };
                } else {
                    aggregatedData[token0Key].positionsLoading = true;  // Ensure it's set to true if token exists
                }
                
                // Initialize token1 data if not exists
                const token1Key = token1.toText();
                if (!aggregatedData[token1Key]) {
                    aggregatedData[token1Key] = {
                        tokenId: token1,
                        tokenLockAmount: 0n,
                        positionLockAmount: 0n,
                        tokenLockCount: 0,
                        positionLockCount: 0,
                        positionsLoading: true,  // Set to true because this token has positions
                        tokenLocks: [],
                        positionLocks: []
                    };
                } else {
                    aggregatedData[token1Key].positionsLoading = true;  // Ensure it's set to true if token exists
                }
            }

            // Update state with initial active data
            setActiveTokenData(aggregatedData);
            setInitialLoading(false);

            // Start loading metadata and positions in the background
            setMetadataLoading(true);

            // Now fetch whitelisted tokens for ALL tokens we found
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const whitelistedTokens = await backendActor.get_whitelisted_tokens();
            
            // Create a map for faster lookup
            const whitelistedTokenMap = new Map(whitelistedTokens.map(token => [token.ledger_id.toText(), token]));
            
            // Process metadata for ALL tokens (both from token locks and position locks)
            for (const tokenKey of Object.keys(aggregatedData)) {
                const whitelistedToken = whitelistedTokenMap.get(tokenKey);
                
                try {
                    // Always try to fetch metadata directly from the ledger, even if not whitelisted
                    const ledgerActor = createLedgerActor(tokenKey, { agentOptions: { identity } });
                    const metadata = await ledgerActor.icrc1_metadata();
                    const logo = getTokenLogo(metadata);
                    const symbol = await ledgerActor.icrc1_symbol();
                    const decimals = await ledgerActor.icrc1_decimals();
                    
                    setTokenMetadata(prev => ({
                        ...prev,
                        [tokenKey]: {
                            ledger_id: tokenKey,
                            symbol,
                            decimals,
                            logo,
                            ...(whitelistedToken || {})  // Merge whitelisted data if available
                        }
                    }));
                } catch (error) {
                    console.error(`Error fetching metadata for token ${tokenKey}:`, error);
                    // Fall back to whitelisted data if available, or minimal data
                    setTokenMetadata(prev => ({
                        ...prev,
                        [tokenKey]: whitelistedToken || {
                            ledger_id: tokenKey,
                            symbol: tokenKey.slice(0, 8) + '...',
                            decimals: 8,
                            logo: ''
                        }
                    }));
                }
            }

            // Process position locks with detailed information
            for (const lock of allPositionLocks) {
                const swapCanisterId = lock[1];
                const positionId = lock[2].position_id;
                const token0 = lock[2].token0;
                const token1 = lock[2].token1;
                const lockId = lock[0];
                const expiry = lock[2].expiry;
                const owner = lock[2].owner;

                // Fetch position details
                const canisterData = await fetchPositionDetails(swapCanisterId);
                if (!canisterData.error) {
                    const matchingPosition = canisterData.positions.find(p => p.id === positionId);
                    if (matchingPosition) {
                        setActiveTokenData(prevData => {
                            const newData = { ...prevData };
                            
                            // Add token0 details
                            const token0Key = token0.toText();
                            if (!newData[token0Key]) {
                                newData[token0Key] = {
                                    tokenId: token0,
                                    tokenLockAmount: 0n,
                                    positionLockAmount: 0n,
                                    tokenLockCount: 0,
                                    positionLockCount: 0,
                                    positionsLoading: false,
                                    tokenLocks: [],
                                    positionLocks: []
                                };
                            }
                            const token0Amount = BigInt(matchingPosition.token0Amount);
                            newData[token0Key].positionLockAmount = (newData[token0Key].positionLockAmount || 0n) + token0Amount;
                            newData[token0Key].positionLockCount += 1;
                            newData[token0Key].positionsLoading = false;
                            newData[token0Key].positionLocks.push({
                                id: lockId,
                                positionId,
                                swapCanisterId,
                                amount: token0Amount,
                                expiry,
                                owner: lock[0].toText(),  // Use the actual owner principal
                                otherToken: token1,
                                otherAmount: BigInt(matchingPosition.token1Amount)
                            });

                            // Add token1 details (similar to token0)
                            const token1Key = token1.toText();
                            if (!newData[token1Key]) {
                                newData[token1Key] = {
                                    tokenId: token1,
                                    tokenLockAmount: 0n,
                                    positionLockAmount: 0n,
                                    tokenLockCount: 0,
                                    positionLockCount: 0,
                                    positionsLoading: false,
                                    tokenLocks: [],
                                    positionLocks: []
                                };
                            }
                            const token1Amount = BigInt(matchingPosition.token1Amount);
                            newData[token1Key].positionLockAmount = (newData[token1Key].positionLockAmount || 0n) + token1Amount;
                            newData[token1Key].positionLockCount += 1;
                            newData[token1Key].positionsLoading = false;
                            newData[token1Key].positionLocks.push({
                                id: lockId,
                                positionId,
                                swapCanisterId,
                                amount: token1Amount,
                                expiry,
                                owner: lock[0].toText(),  // Use the actual owner principal
                                otherToken: token0,
                                otherAmount: BigInt(matchingPosition.token0Amount)
                            });

                            return newData;
                        });
                    }
                }
            }

            setMetadataLoading(false);
        } catch (error) {
            console.error('Error fetching data:', error);
        }
    };

    // Fetch expired locks (lazy-loaded when user clicks Expired tab)
    const fetchExpiredData = async () => {
        if (expiredLoaded || expiredLoading) return;
        
        setExpiredLoading(true);
        try {
            const sneedLockActor = createSneedLockActor(sneedLockCanisterId, { agentOptions: { identity } });
            
            // Fetch only expired locks
            const expiredTokenLocks = await sneedLockActor.get_expired_token_locks();
            const expiredPositionLocks = await sneedLockActor.get_expired_position_locks();

            console.log("Expired token locks fetched", expiredTokenLocks);
            console.log("Expired position locks fetched", expiredPositionLocks);
            
            // Aggregate expired token locks by token type
            const aggregatedData = {};

            // Process token locks with detailed information
            for (const lock of expiredTokenLocks) {
                const tokenId = lock[1];
                const amount = BigInt(lock[2].amount);
                const tokenKey = tokenId?.toText?.() || tokenId;
                const lockDetails = {
                    id: lock[0],
                    lockId: lock[2].lock_id,
                    amount: amount,
                    expiry: lock[2].expiry,
                    owner: lock[0]?.toText?.() || lock[0]
                };

                if (!aggregatedData[tokenKey]) {
                    aggregatedData[tokenKey] = {
                        tokenId,
                        tokenLockAmount: 0n,
                        positionLockAmount: 0n,
                        tokenLockCount: 0,
                        positionLockCount: 0,
                        positionsLoading: false,
                        tokenLocks: [],
                        positionLocks: []
                    };
                }
                aggregatedData[tokenKey].tokenLockAmount += amount;
                aggregatedData[tokenKey].tokenLockCount += 1;
                aggregatedData[tokenKey].tokenLocks.push(lockDetails);
            }

            // Pre-process position locks to create initial entries for all tokens
            for (const lock of expiredPositionLocks) {
                const token0 = lock[2].token0;
                const token1 = lock[2].token1;
                
                // Initialize token0 data if not exists
                const token0Key = token0.toText();
                if (!aggregatedData[token0Key]) {
                    aggregatedData[token0Key] = {
                        tokenId: token0,
                        tokenLockAmount: 0n,
                        positionLockAmount: 0n,
                        tokenLockCount: 0,
                        positionLockCount: 0,
                        positionsLoading: true,  // Set to true because this token has positions
                        tokenLocks: [],
                        positionLocks: []
                    };
                } else {
                    aggregatedData[token0Key].positionsLoading = true;
                }
                
                // Initialize token1 data if not exists
                const token1Key = token1.toText();
                if (!aggregatedData[token1Key]) {
                    aggregatedData[token1Key] = {
                        tokenId: token1,
                        tokenLockAmount: 0n,
                        positionLockAmount: 0n,
                        tokenLockCount: 0,
                        positionLockCount: 0,
                        positionsLoading: true,  // Set to true because this token has positions
                        tokenLocks: [],
                        positionLocks: []
                    };
                } else {
                    aggregatedData[token1Key].positionsLoading = true;
                }
            }

            // Update state with initial expired data IMMEDIATELY to show locks
            setExpiredTokenData(aggregatedData);
            setExpiredLoaded(true);
            setExpiredLoading(false);

            // Now load metadata and position details in the background
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const whitelistedTokens = await backendActor.get_whitelisted_tokens();
            const whitelistedTokenMap = new Map(whitelistedTokens.map(token => [token.ledger_id.toText(), token]));

            // Process metadata for ALL tokens (both from token locks and position locks)
            for (const tokenKey of Object.keys(aggregatedData)) {
                // Skip if metadata already loaded from active tab
                if (tokenMetadata[tokenKey]) continue;
                
                const whitelistedToken = whitelistedTokenMap.get(tokenKey);
                
                try {
                    const ledgerActor = createLedgerActor(tokenKey, { agentOptions: { identity } });
                    const metadata = await ledgerActor.icrc1_metadata();
                    const logo = getTokenLogo(metadata);
                    const symbol = await ledgerActor.icrc1_symbol();
                    const decimals = await ledgerActor.icrc1_decimals();
                    
                    setTokenMetadata(prev => ({
                        ...prev,
                        [tokenKey]: {
                            ledger_id: tokenKey,
                            symbol,
                            decimals,
                            logo,
                            ...(whitelistedToken || {})
                        }
                    }));
                } catch (error) {
                    console.error(`Error fetching metadata for token ${tokenKey}:`, error);
                    setTokenMetadata(prev => ({
                        ...prev,
                        [tokenKey]: whitelistedToken || {
                            ledger_id: tokenKey,
                            symbol: tokenKey.slice(0, 8) + '...',
                            decimals: 8,
                            logo: ''
                        }
                    }));
                }
            }

            // Process expired position locks with detailed information
            for (const lock of expiredPositionLocks) {
                const swapCanisterId = lock[1];
                const positionId = lock[2].position_id;
                const token0 = lock[2].token0;
                const token1 = lock[2].token1;
                const lockId = lock[0];
                const expiry = lock[2].expiry;

                const canisterData = await fetchPositionDetails(swapCanisterId);
                if (!canisterData.error) {
                    const matchingPosition = canisterData.positions.find(p => p.id === positionId);
                    if (matchingPosition) {
                        setExpiredTokenData(prevData => {
                            const newData = { ...prevData };
                            
                            const token0Key = token0.toText();
                            if (!newData[token0Key]) {
                                newData[token0Key] = {
                                    tokenId: token0,
                                    tokenLockAmount: 0n,
                                    positionLockAmount: 0n,
                                    tokenLockCount: 0,
                                    positionLockCount: 0,
                                    positionsLoading: false,
                                    tokenLocks: [],
                                    positionLocks: []
                                };
                            }
                            const token0Amount = BigInt(matchingPosition.token0Amount);
                            newData[token0Key].positionLockAmount = (newData[token0Key].positionLockAmount || 0n) + token0Amount;
                            newData[token0Key].positionLockCount += 1;
                            newData[token0Key].positionsLoading = false;
                            newData[token0Key].positionLocks.push({
                                id: lockId,
                                positionId,
                                swapCanisterId,
                                amount: token0Amount,
                                expiry,
                                owner: lock[0].toText(),
                                otherToken: token1,
                                otherAmount: BigInt(matchingPosition.token1Amount)
                            });

                            const token1Key = token1.toText();
                            if (!newData[token1Key]) {
                                newData[token1Key] = {
                                    tokenId: token1,
                                    tokenLockAmount: 0n,
                                    positionLockAmount: 0n,
                                    tokenLockCount: 0,
                                    positionLockCount: 0,
                                    positionsLoading: false,
                                    tokenLocks: [],
                                    positionLocks: []
                                };
                            }
                            const token1Amount = BigInt(matchingPosition.token1Amount);
                            newData[token1Key].positionLockAmount = (newData[token1Key].positionLockAmount || 0n) + token1Amount;
                            newData[token1Key].positionLockCount += 1;
                            newData[token1Key].positionsLoading = false;
                            newData[token1Key].positionLocks.push({
                                id: lockId,
                                positionId,
                                swapCanisterId,
                                amount: token1Amount,
                                expiry,
                                owner: lock[0].toText(),
                                otherToken: token0,
                                otherAmount: BigInt(matchingPosition.token0Amount)
                            });

                            return newData;
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching expired data:', error);
            setExpiredLoading(false);
        }
    };

    useEffect(() => {
        //if (identity) {
            fetchData();
        //}
    }, []);

    // Add this function near other utility functions
    const calculateTotalTVL = () => {
        let total = 0;
        Object.entries(getFilteredData()).forEach(([tokenKey, data]) => {
            const metadata = tokenMetadata[tokenKey];
            if (!metadata) return;

            // Add token locks USD value
            if (data.tokenLocks) {
                data.tokenLocks.forEach(lock => {
                    const usdValue = getUSDValue(lock.amount, metadata.decimals, metadata.symbol);
                    if (!isNaN(usdValue)) {
                        total += usdValue;
                    }
                });
            }
            // Add position locks USD value
            if (data.positionLocks) {
                data.positionLocks.forEach(lock => {
                    const usdValue = getUSDValue(lock.amount, metadata.decimals, metadata.symbol);
                    if (!isNaN(usdValue)) {
                        total += usdValue;
                    }
                });
            }
        });
        return total;
    };

    // Add after other useEffect hooks
    useEffect(() => {
        const fetchPrincipalNames = async () => {
            if (!identity) return;

            // Get all unique principals from token and position locks
            const uniquePrincipals = new Set();
            Object.values(tokenData).forEach(data => {
                data.tokenLocks.forEach(lock => {
                    if (lock.owner) uniquePrincipals.add(lock.owner);
                });
                data.positionLocks.forEach(lock => {
                    if (lock.owner) uniquePrincipals.add(lock.owner);
                });
            });

            // Fetch display info for each principal
            const displayInfoMap = new Map();
            await Promise.all(Array.from(uniquePrincipals).map(async principal => {
                const displayInfo = await getPrincipalDisplayInfo(identity, principal);
                displayInfoMap.set(principal, displayInfo);
            }));

            setPrincipalDisplayInfo(displayInfoMap);
        };

        fetchPrincipalNames();
    }, [identity, tokenData]);

    if (initialLoading) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <style>{customStyles}</style>
                <Header customLogo="/sneedlock-logo4.png" />
                <main style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem 1rem' }}>
                    <div className="lock-info-fade-in" style={{ 
                        textAlign: 'center',
                        padding: '3rem',
                        background: theme.colors.cardGradient,
                        borderRadius: '20px',
                        border: `1px solid ${theme.colors.border}`,
                        boxShadow: theme.colors.cardShadow,
                    }}>
                        <div className="lock-info-float" style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '18px',
                            background: `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto 1.5rem',
                            boxShadow: `0 8px 32px ${lockPrimary}50`,
                        }}>
                            <FaShieldAlt size={28} style={{ color: '#fff' }} />
                        </div>
                        <h2 style={{ color: theme.colors.primaryText, marginBottom: '0.75rem', fontSize: '1.5rem', fontWeight: '700' }}>
                            Loading Locks
                        </h2>
                        <p style={{ color: theme.colors.mutedText, fontSize: '0.95rem' }}>
                            <FaSpinner className="lock-info-spin" style={{ marginRight: '8px' }} />
                            Fetching lock data...
                        </p>
                    </div>
                </main>
            </div>
        );
    }

    // Styles for the redesigned card-based layout
    const styles = {
        container: {
            maxWidth: '1000px',
            margin: '0 auto',
            padding: '1.5rem 1rem',
        },
        cardBase: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            boxShadow: theme.colors.cardShadow,
        },
        filterCard: {
            padding: '1.25rem',
            marginBottom: '1rem',
        },
        filterRow: {
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
        },
        filterButton: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '10px 14px',
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.primaryBg,
            color: theme.colors.primaryText,
            fontSize: '0.85rem',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
        },
        clearButton: {
            padding: '10px 12px',
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.primaryBg,
            color: theme.colors.mutedText,
            fontSize: '0.85rem',
            cursor: 'pointer',
        },
        tabRow: {
            display: 'flex',
            gap: '8px',
            padding: '1rem',
            borderBottom: `1px solid ${theme.colors.border}`,
            flexWrap: 'wrap',
        },
        tab: (isActive) => ({
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 18px',
            borderRadius: '10px',
            border: 'none',
            background: isActive ? `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})` : theme.colors.primaryBg,
            color: isActive ? '#fff' : theme.colors.secondaryText,
            fontSize: '0.9rem',
            fontWeight: isActive ? '600' : '500',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: isActive ? `0 4px 16px ${lockPrimary}40` : 'none',
        }),
        tabBadge: (isActive) => ({
            padding: '2px 8px',
            borderRadius: '10px',
            background: isActive ? 'rgba(255,255,255,0.2)' : theme.colors.tertiaryBg,
            fontSize: '0.75rem',
            fontWeight: '600',
        }),
        tokenCard: (isExpanded) => ({
            background: isExpanded ? `linear-gradient(135deg, ${lockPrimary}08, ${lockPrimary}03)` : theme.colors.cardGradient,
            border: `1px solid ${isExpanded ? lockPrimary + '40' : theme.colors.border}`,
            borderRadius: '14px',
            marginBottom: '10px',
            overflow: 'hidden',
            transition: 'all 0.2s ease',
        }),
        tokenHeader: {
            display: 'flex',
            alignItems: 'center',
            padding: '14px 16px',
            cursor: 'pointer',
            gap: '12px',
            flexWrap: 'wrap',
        },
        tokenLogo: {
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: `2px solid ${theme.colors.border}`,
            flexShrink: 0,
        },
        tokenInfo: {
            flex: '1 1 150px',
            minWidth: '120px',
        },
        tokenSymbol: {
            fontSize: '1.05rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
        },
        tokenSubtitle: {
            fontSize: '0.8rem',
            color: theme.colors.mutedText,
            marginTop: '2px',
        },
        statGroup: {
            display: 'flex',
            gap: '16px',
            flexWrap: 'wrap',
            flex: '1 1 auto',
            justifyContent: 'flex-end',
        },
        statBox: {
            textAlign: 'right',
            minWidth: '90px',
        },
        statValue: {
            fontSize: '0.95rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
        },
        statLabel: {
            fontSize: '0.75rem',
            color: theme.colors.mutedText,
            marginTop: '2px',
        },
        chevron: {
            color: lockPrimary,
            flexShrink: 0,
        },
        locksList: {
            borderTop: `1px solid ${theme.colors.border}`,
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
        },
        lockCard: {
            background: theme.colors.primaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '12px',
            padding: '12px 14px',
        },
        lockHeader: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '10px',
            flexWrap: 'wrap',
        },
        lockIcon: {
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
        },
        lockTitle: {
            fontSize: '0.9rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
        },
        lockDetails: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '10px',
        },
        lockDetail: {
            fontSize: '0.85rem',
        },
        lockDetailLabel: {
            color: theme.colors.mutedText,
            marginBottom: '2px',
        },
        lockDetailValue: {
            color: theme.colors.primaryText,
            fontWeight: '500',
        },
        totalsCard: {
            background: `linear-gradient(135deg, ${lockPrimary}10, ${lockSecondary}05)`,
            border: `1px solid ${lockPrimary}30`,
            borderRadius: '16px',
            padding: '1.25rem',
            marginTop: '1rem',
        },
        totalsGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '16px',
        },
        totalBox: {
            textAlign: 'center',
            padding: '12px',
            background: theme.colors.primaryBg,
            borderRadius: '12px',
            border: `1px solid ${theme.colors.border}`,
        },
        totalValue: {
            fontSize: '1.1rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
        },
        totalLabel: {
            fontSize: '0.75rem',
            color: theme.colors.mutedText,
            marginTop: '4px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
        },
        emptyState: {
            textAlign: 'center',
            padding: '3rem 1.5rem',
            color: theme.colors.mutedText,
        },
    };

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
                
                <div style={{ maxWidth: '1000px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
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
                    
                    <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '8px' }}>
                        Total Value Locked
                    </div>
                    <div className="lock-info-pulse" style={{ 
                        color: theme.colors.primaryText,
                        fontSize: '2.5rem',
                        fontWeight: '700',
                        letterSpacing: '-0.5px',
                        marginBottom: '0.5rem'
                    }}>
                        {formatUSD(calculateTotalTVL())}
                    </div>
                    <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', margin: 0 }}>
                        Secured tokens and liquidity positions
                    </p>
                </div>
            </div>
            
            <main style={styles.container}>
                {/* Filters Card */}
                <div className="lock-info-fade-in" style={{ ...styles.cardBase, ...styles.filterCard }}>
                    <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FaFilter size={14} style={{ color: lockPrimary }} />
                        <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.9rem' }}>Filters</span>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {/* Owner Filter Row */}
                        <div style={styles.filterRow}>
                            {identity && (
                                <button
                                    onClick={() => handleOwnerFilterChange(identity.getPrincipal().toString())}
                                    style={{
                                        ...styles.filterButton,
                                        background: `linear-gradient(135deg, ${lockPrimary}, ${lockSecondary})`,
                                        color: '#fff',
                                        border: 'none',
                                        boxShadow: `0 4px 12px ${lockPrimary}30`,
                                    }}
                                    title="Show only your locks"
                                >
                                    <FaUser size={12} /> My Locks
                                </button>
                            )}
                            <div style={{ flex: '1 1 200px', minWidth: '180px' }}>
                                <PrincipalInput
                                    value={ownerFilter}
                                    onChange={handleOwnerFilterChange}
                                    placeholder="Filter by owner..."
                                    style={{ width: '100%' }}
                                    isAuthenticated={!!identity}
                                />
                            </div>
                            {ownerFilter && (
                                <button onClick={() => handleOwnerFilterChange('')} style={styles.clearButton}>
                                    Clear
                                </button>
                            )}
                        </div>
                        
                        {/* Token Filter Row */}
                        <div style={styles.filterRow}>
                            <div style={{ flex: '0 1 180px', minWidth: '150px' }}>
                                <TokenSelector
                                    value={ledgerFilter}
                                    onChange={handleLedgerFilterChange}
                                    placeholder="Select token..."
                                    style={{ width: '100%' }}
                                />
                            </div>
                            <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>or</span>
                            <div style={{ flex: '1 1 200px', minWidth: '180px' }}>
                                <PrincipalInput
                                    value={ledgerFilter}
                                    onChange={handleLedgerFilterChange}
                                    placeholder="Filter by ledger..."
                                    style={{ width: '100%' }}
                                    isAuthenticated={!!identity}
                                />
                            </div>
                            {ledgerFilter && (
                                <button onClick={() => handleLedgerFilterChange('')} style={styles.clearButton}>
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                
                {/* Main Content Card */}
                <div className="lock-info-fade-in" style={{ ...styles.cardBase, overflow: 'hidden' }}>
                    {/* Tabs */}
                    <div style={styles.tabRow}>
                        <button onClick={() => handleTabChange('active')} style={styles.tab(activeTab === 'active')}>
                            <FaLock size={14} /> Active
                            {Object.keys(activeTokenData).length > 0 && (
                                <span style={styles.tabBadge(activeTab === 'active')}>
                                    {Object.values(activeTokenData).reduce((sum, d) => sum + (d.tokenLockCount || 0) + (d.positionLockCount || 0), 0)}
                                </span>
                            )}
                        </button>
                        <button onClick={() => handleTabChange('expired')} style={styles.tab(activeTab === 'expired')}>
                            <FaClock size={14} /> Expired
                            {expiredLoaded && Object.keys(expiredTokenData).length > 0 && (
                                <span style={styles.tabBadge(activeTab === 'expired')}>
                                    {Object.values(expiredTokenData).reduce((sum, d) => sum + (d.tokenLockCount || 0) + (d.positionLockCount || 0), 0)}
                                </span>
                            )}
                            {expiredLoading && <FaSpinner className="lock-info-spin" size={12} />}
                        </button>
                    </div>
                    
                    {/* Content */}
                    <div style={{ padding: '1rem' }}>
                        {/* Loading state for expired tab */}
                        {activeTab === 'expired' && expiredLoading && (
                            <div style={styles.emptyState}>
                                <FaSpinner className="lock-info-spin" size={32} style={{ color: lockPrimary, marginBottom: '1rem' }} />
                                <p>Loading expired locks...</p>
                            </div>
                        )}
                        
                        {/* Empty state for expired tab */}
                        {activeTab === 'expired' && expiredLoaded && Object.keys(expiredTokenData).length === 0 && (
                            <div style={styles.emptyState}>
                                <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>✨</div>
                                <p style={{ fontSize: '1rem', color: theme.colors.secondaryText }}>No expired locks found</p>
                            </div>
                        )}
                        
                        {/* Token Cards */}
                        {((activeTab === 'active') || (activeTab === 'expired' && expiredLoaded && Object.keys(expiredTokenData).length > 0)) && (
                            <>
                                {Object.entries(getFilteredData()).map(([tokenKey, data]) => {
                                    const token = tokenMetadata[tokenKey];
                                    const isExpanded = expandedRows.has(tokenKey);
                                    const totalLocks = data.tokenLockCount + data.positionLockCount;
                                    
                                    return (
                                        <div key={tokenKey} style={styles.tokenCard(isExpanded)}>
                                            {/* Token Header */}
                                            <div style={styles.tokenHeader} onClick={() => toggleRow(tokenKey)}>
                                                {token?.logo ? (
                                                    <img src={token.logo} alt={token?.symbol || tokenKey} style={styles.tokenLogo} />
                                                ) : (
                                                    <div style={{ ...styles.tokenLogo, background: theme.colors.tertiaryBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <FaCoins style={{ color: theme.colors.mutedText }} />
                                                    </div>
                                                )}
                                                
                                                <div style={styles.tokenInfo}>
                                                    <div style={styles.tokenSymbol}>{token?.symbol || tokenKey.slice(0, 8) + '...'}</div>
                                                    <div style={styles.tokenSubtitle}>
                                                        {totalLocks} lock{totalLocks !== 1 ? 's' : ''} • {data.tokenLockCount} token, {data.positionLockCount} position
                                                    </div>
                                                </div>
                                                
                                                {data.positionsLoading ? (
                                                    <FaSpinner className="lock-info-spin" style={{ color: lockPrimary }} />
                                                ) : (
                                                    <div style={styles.statGroup}>
                                                        <div style={styles.statBox}>
                                                            <div style={styles.statValue}>
                                                                {formatAmount(data.tokenLockAmount + data.positionLockAmount, token?.decimals || 8)}
                                                            </div>
                                                            <div style={styles.statLabel}>
                                                                {formatUSD(getUSDValue(data.tokenLockAmount + data.positionLockAmount, token?.decimals || 8, token?.symbol))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                                
                                                {isExpanded ? <FaChevronDown style={styles.chevron} /> : <FaChevronRight style={styles.chevron} />}
                                            </div>
                                            
                                            {/* Expanded Locks List */}
                                            {isExpanded && (
                                                <div style={styles.locksList}>
                                                    {/* Token Locks */}
                                                    {data.tokenLocks.map(lock => (
                                                        <a
                                                            key={`token-${lock.id}`}
                                                            href={`/tokenlock?ledger=${tokenKey}&locks=${lock.lockId?.toString() || ''}`}
                                                            style={{ textDecoration: 'none' }}
                                                        >
                                                            <div style={styles.lockCard}>
                                                                <div style={styles.lockHeader}>
                                                                    <div style={{ ...styles.lockIcon, background: `${lockPrimary}20` }}>
                                                                        <FaCoins size={14} style={{ color: lockPrimary }} />
                                                                    </div>
                                                                    <div style={styles.lockTitle}>
                                                                        Token Lock #{lock.lockId?.toString() || 'Unknown'}
                                                                    </div>
                                                                </div>
                                                                <div style={styles.lockDetails}>
                                                                    <div style={styles.lockDetail}>
                                                                        <div style={styles.lockDetailLabel}>Amount</div>
                                                                        <div style={styles.lockDetailValue}>
                                                                            {formatAmount(lock.amount, token?.decimals || 8)} {token?.symbol || ''}
                                                                            <span style={{ fontSize: '0.85em', color: theme.colors.mutedText, marginLeft: '4px' }}>
                                                                                {formatUSD(getUSDValue(lock.amount, token?.decimals || 8, token?.symbol))}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    <div style={styles.lockDetail}>
                                                                        <div style={styles.lockDetailLabel}>Expires</div>
                                                                        <div style={styles.lockDetailValue}>{formatExpirationWithColor(lock.expiry)}</div>
                                                                    </div>
                                                                    <div style={styles.lockDetail}>
                                                                        <div style={styles.lockDetailLabel}>Owner</div>
                                                                        <div style={styles.lockDetailValue}>
                                                                            <PrincipalDisplay 
                                                                                principal={lock.owner} 
                                                                                displayInfo={principalDisplayInfo.get(lock.owner)}
                                                                                style={{ display: 'inline-flex' }}
                                                                                short={true}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </a>
                                                    ))}
                                                    
                                                    {/* Position Locks */}
                                                    {data.positionLocks.map(lock => (
                                                        <a
                                                            key={`position-${lock.id}-${lock.positionId}`}
                                                            href={`/positionlock?swap=${lock.swapCanisterId}&positions=${lock.positionId}`}
                                                            style={{ textDecoration: 'none' }}
                                                        >
                                                            <div style={styles.lockCard}>
                                                                <div style={styles.lockHeader}>
                                                                    <div style={{ ...styles.lockIcon, background: `${theme.colors.accent}20` }}>
                                                                        <FaWater size={14} style={{ color: theme.colors.accent }} />
                                                                    </div>
                                                                    <div style={styles.lockTitle}>
                                                                        Position Lock #{lock.positionId?.toString() || 'Unknown'}
                                                                    </div>
                                                                </div>
                                                                <div style={styles.lockDetails}>
                                                                    <div style={styles.lockDetail}>
                                                                        <div style={styles.lockDetailLabel}>Token 1</div>
                                                                        <div style={styles.lockDetailValue}>
                                                                            {formatAmount(lock.amount || 0n, token?.decimals || 8)} {token?.symbol || tokenKey.slice(0,6)}
                                                                            <span style={{ fontSize: '0.85em', color: theme.colors.mutedText, marginLeft: '4px' }}>
                                                                                {formatUSD(getUSDValue(lock.amount, token?.decimals || 8, token?.symbol))}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    <div style={styles.lockDetail}>
                                                                        <div style={styles.lockDetailLabel}>Token 2</div>
                                                                        <div style={styles.lockDetailValue}>
                                                                            {formatAmount(lock.otherAmount || 0n, tokenMetadata[lock.otherToken?.toText() || '']?.decimals || 8)} {tokenMetadata[lock.otherToken?.toText() || '']?.symbol || 'Unknown'}
                                                                        </div>
                                                                    </div>
                                                                    <div style={styles.lockDetail}>
                                                                        <div style={styles.lockDetailLabel}>Expires</div>
                                                                        <div style={styles.lockDetailValue}>{formatExpirationWithColor(lock.expiry)}</div>
                                                                    </div>
                                                                    <div style={styles.lockDetail}>
                                                                        <div style={styles.lockDetailLabel}>Owner</div>
                                                                        <div style={styles.lockDetailValue}>
                                                                            <PrincipalDisplay 
                                                                                principal={lock.owner} 
                                                                                displayInfo={principalDisplayInfo.get(lock.owner)}
                                                                                style={{ display: 'inline-flex' }}
                                                                                short={true}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </a>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                
                                {/* Loading more indicator */}
                                {metadataLoading && (
                                    <div style={{ textAlign: 'center', padding: '1.5rem', color: theme.colors.mutedText }}>
                                        <FaSpinner className="lock-info-spin" style={{ marginRight: '8px' }} />
                                        Loading more locks...
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
                
                {/* Totals Card */}
                {((activeTab === 'active') || (activeTab === 'expired' && expiredLoaded && Object.keys(expiredTokenData).length > 0)) && (
                    <div className="lock-info-fade-in" style={styles.totalsCard}>
                        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                            <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '0.95rem' }}>
                                <FaShieldAlt style={{ marginRight: '8px', color: lockPrimary }} />
                                {activeTab === 'active' ? 'Active' : 'Expired'} Locks Summary
                            </span>
                        </div>
                        <div style={styles.totalsGrid}>
                            <div style={styles.totalBox}>
                                <div style={styles.totalValue}>{formatUSD(calculateTotals().tokenLockTotal)}</div>
                                <div style={styles.totalLabel}>Token Locks</div>
                            </div>
                            <div style={styles.totalBox}>
                                <div style={styles.totalValue}>{formatUSD(calculateTotals().positionLockTotal)}</div>
                                <div style={styles.totalLabel}>Position Locks</div>
                            </div>
                            <div style={{ ...styles.totalBox, background: `linear-gradient(135deg, ${lockPrimary}15, ${lockSecondary}10)`, border: `1px solid ${lockPrimary}30` }}>
                                <div style={{ ...styles.totalValue, color: lockPrimary }}>{formatUSD(calculateTotals().combinedTotal)}</div>
                                <div style={styles.totalLabel}>Grand Total</div>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default SneedlockInfo; 