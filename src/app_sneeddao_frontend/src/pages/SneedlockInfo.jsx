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

            // Create a Set of tokens that appear in position locks
            const tokensInPositions = new Set();
            for (const lock of expiredPositionLocks) {
                tokensInPositions.add(lock[2].token0.toText());
                tokensInPositions.add(lock[2].token1.toText());
            }

            // Fetch metadata for tokens in positions
            const backendActor = createBackendActor(backendCanisterId, { agentOptions: { identity } });
            const whitelistedTokens = await backendActor.get_whitelisted_tokens();
            const whitelistedTokenMap = new Map(whitelistedTokens.map(token => [token.ledger_id.toText(), token]));

            for (const tokenKey of tokensInPositions) {
                if (!aggregatedData[tokenKey]) {
                    aggregatedData[tokenKey] = {
                        tokenId: Principal.fromText(tokenKey),
                        tokenLockAmount: 0n,
                        positionLockAmount: 0n,
                        tokenLockCount: 0,
                        positionLockCount: 0,
                        positionsLoading: true,
                        tokenLocks: [],
                        positionLocks: []
                    };
                } else {
                    aggregatedData[tokenKey].positionsLoading = true;
                }
                
                // Fetch token metadata if not already present
                if (!tokenMetadata[tokenKey]) {
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
            }

            // Update state with expired data
            setExpiredTokenData(aggregatedData);

            // Process expired position locks
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

            setExpiredLoaded(true);
        } catch (error) {
            console.error('Error fetching expired data:', error);
        } finally {
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
            <div className='page-container'>
                <Header customLogo="/sneedlock-logo4.png" />
                <main className="wallet-container">
                    <div style={{ 
                        padding: '20px 0',
                        textAlign: 'center'
                    }}>
                        <img 
                            src="/sneedlock-logo-cropped.png" 
                            alt="SneedLock" 
                            style={{ height: '64px', width: 'auto' }}
                        />
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header customLogo="/sneedlock-logo4.png" />
            <main className="wallet-container">
                <div style={{ 
                    padding: '20px 0',
                    borderBottom: `1px solid ${theme.colors.border}`,
                    marginBottom: '20px'
                }}>
                    <div style={{
                        textAlign: 'center'
                    }}>
                        <img 
                            src="/sneedlock-logo-cropped.png" 
                            alt="SneedLock" 
                            style={{ 
                                height: '64px', 
                                width: 'auto',
                                marginBottom: '16px'
                            }}
                        />
                        <div style={{ color: theme.colors.mutedText, fontSize: '14px', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '8px' }}>
                            Total Value Locked
                        </div>
                        <div style={{ 
                            color: theme.colors.primaryText,
                            fontSize: '48px',
                            fontWeight: '400',
                            letterSpacing: '0.5px'
                        }}>
                            {formatUSD(calculateTotalTVL())}
                        </div>
                    </div>
                </div>
                
                <div style={{ background: theme.colors.cardGradient, border: `1px solid ${theme.colors.border}`, borderRadius: '12px', padding: '20px', boxShadow: theme.colors.cardShadow }}>
                    <div style={{ 
                        marginBottom: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        flexWrap: 'wrap'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <input
                                type="text"
                                value={ownerFilter}
                                onChange={(e) => handleOwnerFilterChange(e.target.value)}
                                placeholder="Filter by owner principal"
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: '4px',
                                    border: `1px solid ${theme.colors.border}`,
                                    background: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    width: '300px'
                                }}
                            />
                            {identity && (
                                <button
                                    onClick={() => handleOwnerFilterChange(identity.getPrincipal().toString())}
                                    style={{
                                        padding: '8px 12px',
                                        borderRadius: '4px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        cursor: 'pointer'
                                    }}
                                    title="Show only your locks"
                                >
                                    My Locks
                                </button>
                            )}
                            {ownerFilter && (
                                <button
                                    onClick={() => handleOwnerFilterChange('')}
                                    style={{
                                        padding: '8px 12px',
                                        borderRadius: '4px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        cursor: 'pointer'
                                    }}
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <input
                                type="text"
                                value={ledgerFilter}
                                onChange={(e) => handleLedgerFilterChange(e.target.value)}
                                placeholder="Filter by ledger principal"
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: '4px',
                                    border: `1px solid ${theme.colors.border}`,
                                    background: theme.colors.secondaryBg,
                                    color: theme.colors.primaryText,
                                    width: '300px'
                                }}
                            />
                            {ledgerFilter && (
                                <button
                                    onClick={() => handleLedgerFilterChange('')}
                                    style={{
                                        padding: '8px 12px',
                                        borderRadius: '4px',
                                        border: `1px solid ${theme.colors.border}`,
                                        background: theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        cursor: 'pointer'
                                    }}
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                    
                    {/* Active / Expired Tabs */}
                    <div style={{ 
                        display: 'flex', 
                        gap: '0', 
                        marginBottom: '20px',
                        borderBottom: `1px solid ${theme.colors.border}`
                    }}>
                        <button
                            onClick={() => handleTabChange('active')}
                            style={{
                                padding: '12px 24px',
                                border: 'none',
                                background: 'transparent',
                                color: activeTab === 'active' ? theme.colors.accent : theme.colors.mutedText,
                                borderBottom: activeTab === 'active' ? `2px solid ${theme.colors.accent}` : '2px solid transparent',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: activeTab === 'active' ? '600' : '400',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            🔒 Active Locks
                            {Object.keys(activeTokenData).length > 0 && (
                                <span style={{ 
                                    marginLeft: '8px', 
                                    background: theme.colors.secondaryBg,
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    fontSize: '12px'
                                }}>
                                    {Object.values(activeTokenData).reduce((sum, d) => sum + (d.tokenLockCount || 0) + (d.positionLockCount || 0), 0)}
                                </span>
                            )}
                        </button>
                        <button
                            onClick={() => handleTabChange('expired')}
                            style={{
                                padding: '12px 24px',
                                border: 'none',
                                background: 'transparent',
                                color: activeTab === 'expired' ? theme.colors.accent : theme.colors.mutedText,
                                borderBottom: activeTab === 'expired' ? `2px solid ${theme.colors.accent}` : '2px solid transparent',
                                cursor: 'pointer',
                                fontSize: '14px',
                                fontWeight: activeTab === 'expired' ? '600' : '400',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            ⏰ Expired Locks
                            {expiredLoaded && Object.keys(expiredTokenData).length > 0 && (
                                <span style={{ 
                                    marginLeft: '8px', 
                                    background: theme.colors.secondaryBg,
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    fontSize: '12px'
                                }}>
                                    {Object.values(expiredTokenData).reduce((sum, d) => sum + (d.tokenLockCount || 0) + (d.positionLockCount || 0), 0)}
                                </span>
                            )}
                            {expiredLoading && (
                                <span style={{ marginLeft: '8px', fontSize: '12px' }}>⏳</span>
                            )}
                        </button>
                    </div>

                    {/* Loading state for expired tab */}
                    {activeTab === 'expired' && expiredLoading && (
                        <div style={{ 
                            textAlign: 'center', 
                            padding: '40px 20px',
                            color: theme.colors.mutedText
                        }}>
                            <div style={{ fontSize: '24px', marginBottom: '12px' }}>⏳</div>
                            Loading expired locks...
                        </div>
                    )}

                    {/* Empty state for expired tab */}
                    {activeTab === 'expired' && expiredLoaded && Object.keys(expiredTokenData).length === 0 && (
                        <div style={{ 
                            textAlign: 'center', 
                            padding: '40px 20px',
                            color: theme.colors.mutedText
                        }}>
                            <div style={{ fontSize: '24px', marginBottom: '12px' }}>✨</div>
                            No expired locks found
                        </div>
                    )}

                    {/* Table - only show when we have data */}
                    {((activeTab === 'active') || (activeTab === 'expired' && expiredLoaded && Object.keys(expiredTokenData).length > 0)) && (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                <th style={{ 
                                    padding: '10px 20px', 
                                    textAlign: 'left', 
                                    color: theme.colors.mutedText, 
                                    width: '200px',
                                    position: 'relative'  // Add positioning context
                                }}>Token</th>
                                <th style={{ padding: '10px', textAlign: 'right', color: theme.colors.mutedText }}>Token Locks</th>
                                <th style={{ padding: '10px', textAlign: 'right', color: theme.colors.mutedText }}>Position Locks</th>
                                <th style={{ padding: '10px', textAlign: 'right', color: theme.colors.mutedText }}>Total Locked</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(getFilteredData()).map(([tokenKey, data]) => {
                                const token = tokenMetadata[tokenKey];
                                const isExpanded = expandedRows.has(tokenKey);
                                return (
                                    <React.Fragment key={tokenKey}>
                                        <tr 
                                            onClick={() => toggleRow(tokenKey)}
                                            style={{ 
                                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                                cursor: 'pointer',
                                                background: isExpanded ? theme.colors.tertiaryBg : 'transparent'
                                            }}
                                        >
                                            <td style={{ 
                                                padding: '10px 20px', 
                                                color: theme.colors.primaryText,
                                                width: '200px',
                                                position: 'relative'  // Add positioning context
                                            }}>
                                                <div style={{
                                                    position: 'absolute',  // Position the container absolutely
                                                    left: '20px',         // Match the padding
                                                    top: '50%',           // Center vertically
                                                    transform: 'translateY(-50%)',  // Center vertically
                                                    display: 'grid',      // Use grid instead of flex
                                                    gridTemplateColumns: '20px 1fr',  // Fixed width for logo, auto for text
                                                    gap: '8px',
                                                    alignItems: 'center',
                                                    width: 'calc(100% - 40px)'  // Account for padding
                                                }}>
                                                    {token?.logo ? (
                                                        <img 
                                                            src={token.logo} 
                                                            alt={token?.symbol || tokenKey} 
                                                            style={{ 
                                                                width: '20px', 
                                                                height: '20px', 
                                                                borderRadius: '50%',
                                                                gridColumn: '1'
                                                            }}
                                                        />
                                                    ) : (
                                                        <div style={{ 
                                                            width: '20px', 
                                                            height: '20px',
                                                            gridColumn: '1'
                                                        }} />
                                                    )}
                                                    <span style={{ 
                                                        whiteSpace: 'nowrap',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        gridColumn: '2'
                                                    }}>
                                                        {token?.symbol || tokenKey}
                                                    </span>
                                                </div>
                                            </td>
                                            <td style={{ padding: '10px', textAlign: 'right', color: theme.colors.primaryText }}>
                                                {data.positionsLoading ? (
                                                    <div className="spinner" style={{ width: '16px', height: '16px', margin: '0 0 0 auto' }} />
                                                ) : (
                                                    <>
                                                        {formatAmount(data.tokenLockAmount, token?.decimals || 8)}{' '}
                                                        <span style={{ fontSize: '0.9em', color: theme.colors.mutedText }}>
                                                            {formatUSD(getUSDValue(data.tokenLockAmount, token?.decimals || 8, token?.symbol))}
                                                        </span>
                                                        <div style={{ fontSize: '0.8em', color: theme.colors.mutedText, marginTop: '2px' }}>
                                                            {data.tokenLockCount} lock{data.tokenLockCount !== 1 ? 's' : ''}
                                                        </div>
                                                    </>
                                                )}
                                            </td>
                                            <td style={{ padding: '10px', textAlign: 'right', color: theme.colors.primaryText }}>
                                                {data.positionsLoading ? (
                                                    <div className="spinner" style={{ width: '16px', height: '16px', margin: '0 0 0 auto' }} />
                                                ) : (
                                                    <>
                                                        {formatAmount(data.positionLockAmount, token?.decimals || 8)}{' '}
                                                        <span style={{ fontSize: '0.9em', color: theme.colors.mutedText }}>
                                                            {formatUSD(getUSDValue(data.positionLockAmount, token?.decimals || 8, token?.symbol))}
                                                        </span>
                                                        <div style={{ fontSize: '0.8em', color: theme.colors.mutedText, marginTop: '2px' }}>
                                                            {data.positionLockCount} position{data.positionLockCount !== 1 ? 's' : ''}
                                                        </div>
                                                    </>
                                                )}
                                            </td>
                                            <td style={{ padding: '10px', textAlign: 'right', color: theme.colors.primaryText }}>
                                                {data.positionsLoading ? (
                                                    <div className="spinner" style={{ width: '16px', height: '16px', margin: '0 0 0 auto' }} />
                                                ) : (
                                                    <>
                                                        {formatAmount(data.tokenLockAmount + data.positionLockAmount, token?.decimals || 8)}{' '}
                                                        <span style={{ fontSize: '0.9em', color: theme.colors.mutedText }}>
                                                            {formatUSD(getUSDValue(data.tokenLockAmount + data.positionLockAmount, token?.decimals || 8, token?.symbol))}
                                                        </span>
                                                        <div style={{ fontSize: '0.8em', color: theme.colors.mutedText, marginTop: '2px' }}>
                                                            {data.tokenLockCount + data.positionLockCount} total lock{data.tokenLockCount + data.positionLockCount !== 1 ? 's' : ''}
                                                        </div>
                                                    </>
                                                )}
                                            </td>
                                        </tr>
                                        {isExpanded && (
                                            <>
                                                {/* Token Locks */}
                                                {data.tokenLocks.map(lock => (
                                                    <tr key={`token-${lock.id}`} style={{ background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}` }}>
                                                        <td colSpan="4" style={{ padding: '8px 40px' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: theme.colors.mutedText, fontSize: '0.9em', alignItems: 'center' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <a 
                                                                        href={`/tokenlock?ledger=${tokenKey}&locks=${lock.lockId?.toString() || ''}`}
                                                                        style={{ 
                                                                            color: theme.colors.mutedText,
                                                                            textDecoration: 'none',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '8px',
                                                                            cursor: 'pointer'
                                                                        }}
                                                                        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                                                        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                                                    >
                                                                        <img src="sneedlock-logo1.png" alt="SneedLock" style={{ width: '24px', height: '24px' }} />
                                                                        <div>
                                                                            <span style={{ color: theme.colors.mutedText }}>Token Lock</span>{' '}
                                                                            <span>#{lock.lockId?.toString() || 'Unknown'}</span>
                                                                        </div>
                                                                    </a>
                                                                </div>
                                                                <div>
                                                                    Amount: {formatAmount(lock.amount, token?.decimals || 8)}{' '}
                                                                    <span style={{ fontSize: '0.9em', color: theme.colors.mutedText }}>
                                                                        {formatUSD(getUSDValue(lock.amount, token?.decimals || 8, token?.symbol))}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    Expires: {formatExpirationWithColor(lock.expiry)}
                                                                </div>
                                                                <div style={{ opacity: 0.7 }}>
                                                                    <span>Owner: </span>
                                                                    <PrincipalDisplay 
                                                                        principal={lock.owner} 
                                                                        displayInfo={principalDisplayInfo.get(lock.owner)}
                                                                        style={{ display: 'inline-flex' }}
                                                                        short={true}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                                {/* Position Locks */}
                                                {data.positionLocks.map(lock => (
                                                    <tr key={`position-${lock.id}`} style={{ background: theme.colors.tertiaryBg, border: `1px solid ${theme.colors.border}` }}>
                                                        <td colSpan="4" style={{ padding: '8px 40px' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: theme.colors.mutedText, fontSize: '0.9em', alignItems: 'center' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <a 
                                                                        href={`/positionlock?swap=${lock.swapCanisterId}&positions=${lock.positionId}`}
                                                                        style={{ 
                                                                            color: theme.colors.mutedText,
                                                                            textDecoration: 'none',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '8px',
                                                                            cursor: 'pointer'
                                                                        }}
                                                                        onMouseEnter={(e) => e.target.style.textDecoration = 'underline'}
                                                                        onMouseLeave={(e) => e.target.style.textDecoration = 'none'}
                                                                    >
                                                                        <img src="sneedlock-logo1.png" alt="SneedLock" style={{ width: '24px', height: '24px' }} />
                                                                        <div>
                                                                            <span style={{ color: theme.colors.mutedText }}>Position Lock</span>{' '}
                                                                            <span>#{lock.positionId?.toString() || 'Unknown'}</span>
                                                                        </div>
                                                                    </a>
                                                                </div>
                                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                                                                    <div>
                                                                        {formatAmount(lock.amount || 0n, token?.decimals || 8)} {token?.symbol || tokenKey}{' '}
                                                                        <span style={{ fontSize: '0.9em', color: theme.colors.mutedText }}>
                                                                            {formatUSD(getUSDValue(lock.amount, token?.decimals || 8, token?.symbol))}
                                                                        </span>
                                                                    </div>
                                                                    <div>
                                                                        {formatAmount(lock.otherAmount || 0n, tokenMetadata[lock.otherToken?.toText() || '']?.decimals || 8)} {tokenMetadata[lock.otherToken?.toText() || '']?.symbol || (lock.otherToken?.toText() || 'Unknown')}{' '}
                                                                        <span style={{ fontSize: '0.9em', color: theme.colors.mutedText }}>
                                                                            {formatUSD(getUSDValue(
                                                                                lock.otherAmount,
                                                                                tokenMetadata[lock.otherToken?.toText() || '']?.decimals || 8,
                                                                                tokenMetadata[lock.otherToken?.toText() || '']?.symbol
                                                                            ))}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    Expires: {formatExpirationWithColor(lock.expiry)}
                                                                </div>
                                                                <div style={{ opacity: 0.7 }}>
                                                                    <span>Owner: </span>
                                                                    <PrincipalDisplay 
                                                                        principal={lock.owner} 
                                                                        displayInfo={principalDisplayInfo.get(lock.owner)}
                                                                        style={{ display: 'inline-flex' }}
                                                                        short={true}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                        {metadataLoading && (
                            <tbody>
                                <tr>
                                    <td colSpan="4" style={{ padding: '20px', textAlign: 'center' }}>
                                        <div style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'center',
                                            gap: '10px',
                                            color: theme.colors.mutedText
                                        }}>
                                            <div className="spinner" style={{ width: '20px', height: '20px' }} />
                                            <span>Loading more locks...</span>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        )}
                        <tfoot>
                            <tr style={{ 
                                borderTop: `2px solid ${theme.colors.success}`,
                                background: theme.colors.cardGradient,
                                fontWeight: 'bold'
                            }}>
                                <td style={{ padding: '15px' }}>Total Value</td>
                                <td style={{ padding: '15px', textAlign: 'right', color: theme.colors.primaryText }}>
                                    {formatUSD(calculateTotals().tokenLockTotal)}
                                    <div style={{ fontSize: '0.8em', color: theme.colors.mutedText, marginTop: '2px' }}>
                                        Total Token Locks
                                    </div>
                                </td>
                                <td style={{ padding: '15px', textAlign: 'right', color: theme.colors.primaryText }}>
                                    {formatUSD(calculateTotals().positionLockTotal)}
                                    <div style={{ fontSize: '0.8em', color: theme.colors.mutedText, marginTop: '2px' }}>
                                        Total Position Locks
                                    </div>
                                </td>
                                <td style={{ padding: '15px', textAlign: 'right', color: theme.colors.primaryText }}>
                                    {formatUSD(calculateTotals().combinedTotal)}
                                    <div style={{ fontSize: '0.8em', color: theme.colors.mutedText, marginTop: '2px' }}>
                                        Grand Total
                                    </div>
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                    )}
                </div>
            </main>
        </div>
    );
}

export default SneedlockInfo; 