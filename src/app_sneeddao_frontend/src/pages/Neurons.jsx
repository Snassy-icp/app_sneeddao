import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import { fetchAndCacheSnsData, getSnsById } from '../utils/SnsUtils';
import { formatNeuronIdLink, formatE8s, getDissolveState, uint8ArrayToHex } from '../utils/NeuronUtils';
import { calculateVotingPower, formatVotingPower } from '../utils/VotingPowerUtils';
import { Actor, HttpAgent } from '@dfinity/agent';
import { useNaming } from '../NamingContext';
import { useTheme } from '../contexts/ThemeContext';
import NeuronInput from '../components/NeuronInput';
import NeuronDisplay from '../components/NeuronDisplay';

function Neurons() {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const { selectedSnsRoot, updateSelectedSns } = useSns();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const [snsList, setSnsList] = useState([]);
    const [neurons, setNeurons] = useState([]);
    const [filteredNeurons, setFilteredNeurons] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [tokenSymbol, setTokenSymbol] = useState('SNS');
    const [totalSupply, setTotalSupply] = useState(null);
    const [totalNeuronCount, setTotalNeuronCount] = useState(null);
    
    // Get naming context
    const { neuronNames, neuronNicknames, verifiedNames } = useNaming();
    
    // Helper function to get display name (similar to Neuron.jsx)
    const getDisplayName = (neuronId) => {
        const mapKey = `${selectedSnsRoot}:${neuronId}`;
        
        // Convert arrays to Maps for easier lookup
        const namesMap = new Map(Array.from(neuronNames.entries()));
        const nicknamesMap = new Map(Array.from(neuronNicknames.entries()));
        const verifiedMap = new Map(Array.from(verifiedNames.entries()));

        // Get values from maps
        const name = namesMap.get(mapKey);
        const nickname = nicknamesMap.get(mapKey);
        const isVerified = verifiedMap.get(mapKey);

        return { name, nickname, isVerified };
    };
    
    // Pagination state
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [currentPage, setCurrentPage] = useState(1);

    const [loadingProgress, setLoadingProgress] = useState({ count: 0, message: '', percent: 0 });

    const [dissolveFilter, setDissolveFilter] = useState('all');
    
    // Add new filter states
    const [hideUnnamed, setHideUnnamed] = useState(false);
    const [hideUnverified, setHideUnverified] = useState(false);
    // Add nervous system parameters state
    const [nervousSystemParameters, setNervousSystemParameters] = useState(null);
    
    // Add sort configuration state similar to TransactionList
    const [sortConfig, setSortConfig] = useState({
        key: 'stake',
        direction: 'desc'
    });

    // Add IndexedDB initialization at the top of the component
    const initializeDB = () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('NeuronsDB', 1);
            
            request.onerror = () => reject(request.error);
            
            request.onsuccess = () => resolve(request.result);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('neurons')) {
                    db.createObjectStore('neurons', { keyPath: 'snsRoot' });
                }
            };
        });
    };

    // Function to get cached data from IndexedDB
    const getCachedData = async (snsRoot) => {
        try {
            const db = await initializeDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(['neurons'], 'readonly');
                const store = transaction.objectStore('neurons');
                const request = store.get(snsRoot);
                
                request.onsuccess = () => {
                    const data = request.result;
                    if (data) {
                        // Reconstruct Uint8Arrays for neuron IDs
                        const neurons = data.neurons.map(neuron => ({
                            ...neuron,
                            id: neuron.id.map(idObj => ({
                                ...idObj,
                                id: new Uint8Array(idObj.id)
                            }))
                        }));
                        resolve({ neurons, metadata: data.metadata });
                    } else {
                        resolve(null);
                    }
                };
                
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.warn('Error reading from IndexedDB:', error);
            return null;
        }
    };

    // Function to set cache data in IndexedDB
    const setCacheData = async (snsRoot, neurons, metadata) => {
        try {
            const db = await initializeDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction(['neurons'], 'readwrite');
                const store = transaction.objectStore('neurons');
                
                // Convert Uint8Arrays to regular arrays for storage
                const serializedNeurons = neurons.map(neuron => ({
                    ...neuron,
                    id: neuron.id.map(idObj => ({
                        ...idObj,
                        id: Array.from(idObj.id)
                    }))
                }));
                
                const request = store.put({
                    snsRoot,
                    neurons: serializedNeurons,
                    metadata,
                    timestamp: Date.now()
                });
                
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.warn('Error writing to IndexedDB:', error);
        }
    };

    // Listen for URL parameter changes and sync with global state
    useEffect(() => {
        const snsParam = searchParams.get('sns');
        if (snsParam && snsParam !== selectedSnsRoot) {
            updateSelectedSns(snsParam);
            setCurrentPage(1);
            setNeurons([]);
        }
    }, [searchParams, selectedSnsRoot, updateSelectedSns]);

    // Reset neurons when SNS changes
    useEffect(() => {
        setCurrentPage(1);
        setNeurons([]);
    }, [selectedSnsRoot]);

    // Fetch SNS data on component mount
    useEffect(() => {
        async function loadSnsData() {
            setLoadingSnses(true);
            try {
                const data = await fetchAndCacheSnsData(identity);
                setSnsList(data);
            } catch (err) {
                console.error('Error loading SNS data:', err);
                setError('Failed to load SNS list');
            } finally {
                setLoadingSnses(false);
            }
        }

        loadSnsData();
    }, [identity]);

    // Fetch neurons when SNS changes
    useEffect(() => {
        async function loadData() {
            if (selectedSnsRoot) {
                const cachedData = await getCachedData(selectedSnsRoot);
                if (cachedData) {
                    console.log('Loading from cache for SNS:', selectedSnsRoot);
                    setLoadingProgress({ count: cachedData.neurons.length, message: 'Loading from cache...' });
                    setNeurons(cachedData.neurons);
                    setTokenSymbol(cachedData.metadata.symbol);
                    setLoading(false);
                } else {
                    console.log('No cache found for SNS:', selectedSnsRoot);
                    fetchNeurons();
                }
                fetchTotalSupply();
            }
        }
        loadData();
    }, [selectedSnsRoot]);

    // Fetch nervous system parameters for voting power calculation
    useEffect(() => {
        const fetchNervousSystemParameters = async () => {
            if (!selectedSnsRoot || !identity) return;
            
            try {
                const selectedSns = getSnsById(selectedSnsRoot);
                if (!selectedSns) return;

                const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                    agentOptions: { identity }
                });
                
                const params = await snsGovActor.get_nervous_system_parameters(null);
                setNervousSystemParameters(params);
            } catch (error) {
                console.error('Error fetching nervous system parameters:', error);
            }
        };

        if (selectedSnsRoot && identity) {
            fetchNervousSystemParameters();
        }
    }, [selectedSnsRoot, identity]);

    const fetchNeurons = async () => {
        setLoading(true);
        setError('');
        setLoadingProgress({ count: 0, message: 'Initializing...', percent: 0 });
        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) {
                setError('Selected SNS not found');
                return;
            }

            // Fetch total neuron count first
            const totalCount = await fetchNeuronCount();
            setLoadingProgress(prev => ({ 
                ...prev, 
                message: 'Connected to governance canister',
                percent: 5
            }));

            // Create an anonymous agent if no identity is available
            const agent = identity ? 
                new HttpAgent({ identity }) : 
                new HttpAgent();

            if (process.env.DFX_NETWORK !== 'ic') {
                await agent.fetchRootKey();
            }

            const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                agent
            });

            // Fetch all neurons using pagination
            let allNeurons = [];
            let hasMore = true;
            let lastNeuron = [];  // Empty array for first page
            let pageCount = 0;

            while (hasMore) {
                pageCount++;
                // Calculate progress based on actual neurons fetched vs total count
                const baseProgress = 5; // Starting progress after initial connection
                const maxProgress = 90; // Maximum progress before sorting
                const progressRange = maxProgress - baseProgress;
                // Use actual neuron count for progress calculation
                const progressPercent = totalCount > 0 
                    ? baseProgress + ((allNeurons.length / totalCount) * progressRange)
                    : baseProgress + (pageCount * 2); // Fallback if we don't have total count
                
                setLoadingProgress(prev => ({ 
                    count: allNeurons.length,
                    message: `Fetching page ${pageCount} (${allNeurons.length}${totalCount ? ` of ${totalCount}` : ''} neurons)...`,
                    percent: Math.min(maxProgress, progressPercent)
                }));

                const response = await snsGovActor.list_neurons({
                    limit: 100,
                    of_principal: [], // Empty to get all neurons
                    start_page_at: lastNeuron
                });
                
                if (response.neurons.length === 0) {
                    hasMore = false;
                } else {
                    allNeurons = [...allNeurons, ...response.neurons];
                    // Get the last neuron's ID for next page
                    const lastNeuronId = response.neurons[response.neurons.length - 1].id;
                    lastNeuron = lastNeuronId;
                    
                    // If we got less than the limit, we've reached the end
                    if (response.neurons.length < 100) {
                        hasMore = false;
                    }
                }
            }

            setLoadingProgress(prev => ({ 
                count: allNeurons.length,
                message: `Sorting ${allNeurons.length}${totalCount ? ` of ${totalCount}` : ''} neurons by stake...`,
                percent: 95
            }));
            
            // Sort neurons by stake (highest first)
            const sortedNeurons = allNeurons.sort((a, b) => {
                const stakeA = BigInt(a.cached_neuron_stake_e8s || 0);
                const stakeB = BigInt(b.cached_neuron_stake_e8s || 0);
                return stakeB > stakeA ? 1 : stakeB < stakeA ? -1 : 0;
            });

            setNeurons(sortedNeurons);

            setLoadingProgress(prev => ({ ...prev, message: `Fetching token metadata (${allNeurons.length}${totalCount ? ` of ${totalCount}` : ''} neurons loaded)...`, percent: 97 }));

            // Get token symbol
            const icrc1Actor = createIcrc1Actor(selectedSns.canisters.ledger, { agent });
            const metadata = await icrc1Actor.icrc1_metadata();
            const symbolEntry = metadata.find(entry => entry[0] === 'icrc1:symbol');
            let symbol = 'SNS';
            if (symbolEntry && symbolEntry[1]) {
                symbol = symbolEntry[1].Text;
                setTokenSymbol(symbol);
            }

            // Cache the fetched data
            await setCacheData(selectedSnsRoot, sortedNeurons, { symbol });
            
            setLoadingProgress(prev => ({ 
                count: sortedNeurons.length,
                message: `Caching ${sortedNeurons.length}${totalCount ? ` of ${totalCount}` : ''} neurons for future use...`,
                percent: 100
            }));

        } catch (err) {
            console.error('Error fetching neurons:', err);
            setError('Failed to fetch neurons');
        } finally {
            setLoading(false);
        }
    };

    const fetchTotalSupply = async () => {
        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) {
                console.error('Selected SNS not found');
                return;
            }

            // Create an anonymous agent if no identity is available
            const agent = identity ? 
                new HttpAgent({ identity }) : 
                new HttpAgent();

            if (process.env.DFX_NETWORK !== 'ic') {
                await agent.fetchRootKey();
            }

            const ledgerActor = createIcrc1Actor(selectedSns.canisters.ledger, { agent });
            const supply = await ledgerActor.icrc1_total_supply();
            setTotalSupply(supply);
        } catch (err) {
            console.error('Error fetching total supply:', err);
        }
    };

    const fetchNeuronCount = async () => {
        try {
            const response = await fetch(`https://sns-api.internetcomputer.org/api/v2/snses/${selectedSnsRoot}/neurons/count`);
            const data = await response.json();
            const total = data.total || 0;
            setTotalNeuronCount(total);
            return total;
        } catch (error) {
            console.error('Error fetching neuron count:', error);
            return 0;
        }
    };

    const handleSnsChange = (newSnsRoot) => {
        // Update URL parameter
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.set('sns', newSnsRoot);
        navigate(`${location.pathname}?${newSearchParams.toString()}`);
        
        // Update state
        updateSelectedSns(newSnsRoot);
        setCurrentPage(1);
        setNeurons([]);
    };

    const handleItemsPerPageChange = (e) => {
        setItemsPerPage(Number(e.target.value));
        setCurrentPage(1);
    };

    // Calculate percentages
    const calculatePercentage = (amount) => {
        if (!totalSupply || !amount) return null;
        const percentage = (Number(amount) / Number(totalSupply)) * 100;
        return percentage.toFixed(2);
    };

    // Helper function to format amounts as integers (no decimals)
    const formatE8sAsInteger = (amount) => {
        const formatted = formatE8s(amount);
        // Remove decimal places by splitting at the decimal point and taking the integer part
        return formatted.split('.')[0];
    };

    // Calculate stakes by dissolve state
    const stakes = neurons.reduce((acc, neuron) => {
        const stake = BigInt(neuron.cached_neuron_stake_e8s || 0);
        const hasStake = stake > 0n;
        
        if (neuron.dissolve_state?.[0]) {
            if ('WhenDissolvedTimestampSeconds' in neuron.dissolve_state[0]) {
                const dissolveTime = Number(neuron.dissolve_state[0].WhenDissolvedTimestampSeconds);
                const now = Math.floor(Date.now() / 1000);
                if (dissolveTime <= now) {
                    acc.dissolvedStake += stake;
                    acc.dissolvedCount += 1;
                    if (hasStake) acc.dissolvedWithStakeCount += 1;
                } else {
                    acc.dissolvingStake += stake;
                    acc.dissolvingCount += 1;
                    if (hasStake) acc.dissolvingWithStakeCount += 1;
                }
            } else if ('DissolveDelaySeconds' in neuron.dissolve_state[0]) {
                acc.notDissolvingStake += stake;
                acc.notDissolvingCount += 1;
                if (hasStake) acc.notDissolvingWithStakeCount += 1;
            }
        } else {
            // If no dissolve state, consider it not dissolving
            acc.notDissolvingStake += stake;
            acc.notDissolvingCount += 1;
            if (hasStake) acc.notDissolvingWithStakeCount += 1;
        }
        
        return acc;
    }, {
        dissolvedStake: BigInt(0),
        dissolvingStake: BigInt(0),
        notDissolvingStake: BigInt(0),
        dissolvedCount: 0,
        dissolvingCount: 0,
        notDissolvingCount: 0,
        dissolvedWithStakeCount: 0,
        dissolvingWithStakeCount: 0,
        notDissolvingWithStakeCount: 0
    });

    // Total stake excludes dissolved neurons
    const totalStake = stakes.dissolvingStake + stakes.notDissolvingStake;
    const totalCount = stakes.dissolvedCount + stakes.dissolvingCount + stakes.notDissolvingCount;
    const totalWithStakeCount = stakes.dissolvedWithStakeCount + stakes.dissolvingWithStakeCount + stakes.notDissolvingWithStakeCount;

    // Update the paginated neurons calculation to use filteredNeurons
    const paginatedNeurons = filteredNeurons.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    // Add sorting function
    const getSortedNeurons = (neurons) => {
        return [...neurons].sort((a, b) => {
            if (sortConfig.key === 'stake') {
                // Sort by stake
                const stakeA = BigInt(a.cached_neuron_stake_e8s || 0);
                const stakeB = BigInt(b.cached_neuron_stake_e8s || 0);
                const result = stakeB > stakeA ? 1 : stakeB < stakeA ? -1 : 0;
                return sortConfig.direction === 'desc' ? result : -result;
            }
            
            if (sortConfig.key === 'name') {
                // Get display info for both neurons
                const neuronIdA = uint8ArrayToHex(a.id[0]?.id);
                const neuronIdB = uint8ArrayToHex(b.id[0]?.id);
                const mapKeyA = `${selectedSnsRoot}:${neuronIdA}`;
                const mapKeyB = `${selectedSnsRoot}:${neuronIdB}`;
                const nameA = neuronNames.get(mapKeyA);
                const nameB = neuronNames.get(mapKeyB);
                const nicknameA = neuronNicknames.get(mapKeyA);
                const nicknameB = neuronNicknames.get(mapKeyB);

                // Sort logic for names
                let result = 0;
                if (nameA && nameB) result = nameA.localeCompare(nameB);
                else if (nameA) result = -1; // Named neurons come first
                else if (nameB) result = 1;
                else if (nicknameA && nicknameB) result = nicknameA.localeCompare(nicknameB);
                else if (nicknameA) result = -1; // Nicknamed neurons come after named ones
                else if (nicknameB) result = 1;
                else result = neuronIdA.localeCompare(neuronIdB); // Sort by ID if no name/nickname
                
                return sortConfig.direction === 'asc' ? result : -result;
            }

            if (sortConfig.key === 'lock') {
                const stateA = getDissolveStateDetails(a);
                const stateB = getDissolveStateDetails(b);

                // First compare by dissolve state category
                if (stateA.category !== stateB.category) {
                    // Not Dissolving comes first, then Dissolving, then Dissolved
                    const order = { 'not_dissolving': 0, 'dissolving': 1, 'dissolved': 2 };
                    const result = order[stateA.category] - order[stateB.category];
                    return sortConfig.direction === 'asc' ? result : -result;
                }

                // Within the same category
                if (stateA.category === 'not_dissolving') {
                    // Sort by lock time (DissolveDelaySeconds)
                    const result = Number(stateB.dissolveDelaySeconds || 0) - Number(stateA.dissolveDelaySeconds || 0);
                    return sortConfig.direction === 'desc' ? result : -result;
                }
                if (stateA.category === 'dissolving') {
                    // Sort by time left until dissolution
                    const result = Number(stateB.timeLeft || 0) - Number(stateA.timeLeft || 0);
                    return sortConfig.direction === 'desc' ? result : -result;
                }
                // For dissolved neurons, sort by stake
                const stakeA = BigInt(a.cached_neuron_stake_e8s || 0);
                const stakeB = BigInt(b.cached_neuron_stake_e8s || 0);
                const result = stakeB > stakeA ? 1 : stakeB < stakeA ? -1 : 0;
                return sortConfig.direction === 'desc' ? result : -result;
            }

            if (sortConfig.key === 'votingPower') {
                // Sort by voting power
                if (nervousSystemParameters) {
                    const votingPowerA = calculateVotingPower(a, nervousSystemParameters);
                    const votingPowerB = calculateVotingPower(b, nervousSystemParameters);
                    const result = votingPowerB > votingPowerA ? 1 : votingPowerB < votingPowerA ? -1 : 0;
                    return sortConfig.direction === 'desc' ? result : -result;
                } else {
                    // Fallback to voting power multiplier if nervous system parameters not available
                    const multiplierA = Number(a.voting_power_percentage_multiplier || 0);
                    const multiplierB = Number(b.voting_power_percentage_multiplier || 0);
                    const result = multiplierB - multiplierA;
                    return sortConfig.direction === 'desc' ? result : -result;
                }
            }

            return 0;
        });
    };

    // Helper function to get detailed dissolve state information
    const getDissolveStateDetails = (neuron) => {
        if (!neuron.dissolve_state?.[0]) {
            return { category: 'not_dissolving', dissolveDelaySeconds: 0 };
        }

        if ('WhenDissolvedTimestampSeconds' in neuron.dissolve_state[0]) {
            const dissolveTime = Number(neuron.dissolve_state[0].WhenDissolvedTimestampSeconds);
            const now = Math.floor(Date.now() / 1000);
            
            if (dissolveTime <= now) {
                return { category: 'dissolved' };
            } else {
                return { 
                    category: 'dissolving',
                    timeLeft: dissolveTime - now
                };
            }
        } else if ('DissolveDelaySeconds' in neuron.dissolve_state[0]) {
            return { 
                category: 'not_dissolving',
                dissolveDelaySeconds: neuron.dissolve_state[0].DissolveDelaySeconds
            };
        }

        return { category: 'not_dissolving', dissolveDelaySeconds: 0 };
    };

    // Add sort handler similar to TransactionList
    const handleSort = (key) => {
        setSortConfig(prevConfig => ({
            key,
            direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    // Render sort indicator
    const renderSortIndicator = (key) => {
        if (sortConfig.key !== key) return '↕';
        return sortConfig.direction === 'asc' ? '↑' : '↓';
    };

    // Update the effect that filters neurons
    useEffect(() => {
        let filtered = neurons;

        // Apply search term filter
        if (searchTerm.trim()) {
            const searchLower = searchTerm.toLowerCase();
            filtered = filtered.filter(neuron => {
                const neuronId = uint8ArrayToHex(neuron.id[0]?.id);
                if (!neuronId) return false;

                // Check neuron ID
                if (neuronId.toLowerCase().includes(searchLower)) {
                    return true;
                }

                // Check names and nicknames
                const mapKey = `${selectedSnsRoot}:${neuronId}`;
                const name = neuronNames.get(mapKey)?.toLowerCase();
                const nickname = neuronNicknames.get(mapKey)?.toLowerCase();

                return (name && name.includes(searchLower)) || 
                       (nickname && nickname.includes(searchLower));
            });
        }

        // Apply dissolve state filter
        if (dissolveFilter !== 'all') {
            filtered = filtered.filter(neuron => {
                const state = getDissolveStateDetails(neuron);
                return state.category === dissolveFilter;
            });
        }

        // Apply hideUnnamed filter
        if (hideUnnamed) {
            filtered = filtered.filter(neuron => {
                const neuronId = uint8ArrayToHex(neuron.id[0]?.id);
                if (!neuronId) return false;
                
                const mapKey = `${selectedSnsRoot}:${neuronId}`;
                const name = neuronNames.get(mapKey);
                const nickname = neuronNicknames.get(mapKey);
                
                // Show only neurons that have either a name or nickname
                return name || nickname;
            });
        }

        // Apply hideUnverified filter
        if (hideUnverified) {
            filtered = filtered.filter(neuron => {
                const neuronId = uint8ArrayToHex(neuron.id[0]?.id);
                if (!neuronId) return false;
                
                const mapKey = `${selectedSnsRoot}:${neuronId}`;
                const name = neuronNames.get(mapKey);
                const nickname = neuronNicknames.get(mapKey);
                const isVerified = verifiedNames.get(mapKey);
                
                // If neuron has no name or nickname, always show it
                if (!name && !nickname) {
                    return true;
                }
                
                // If neuron has a name or nickname, only show if verified
                return isVerified === true;
            });
        }

        // Apply sorting
        filtered = getSortedNeurons(filtered);

        setFilteredNeurons(filtered);
        setCurrentPage(1); // Reset to first page when filtering
    }, [searchTerm, dissolveFilter, sortConfig, hideUnnamed, hideUnverified, neurons, selectedSnsRoot, neuronNames, neuronNicknames, verifiedNames, nervousSystemParameters]);

    // Add function to clear cache
    const clearCache = async (snsRoot) => {
        try {
            const db = await initializeDB();
            const transaction = db.transaction(['neurons'], 'readwrite');
            const store = transaction.objectStore('neurons');
            await store.delete(snsRoot);
        } catch (error) {
            console.warn('Error clearing cache:', error);
        }
    };

    const handleRefresh = async () => {
        await clearCache(selectedSnsRoot);
        fetchNeurons();
    };

    // CSV export function
    const exportToCSV = () => {
        if (filteredNeurons.length === 0) {
            alert('No neurons to export');
            return;
        }

        // Define CSV headers
        const headers = [
            'Neuron ID',
            'Name',
            'Nickname',
            'Is Verified',
            'Stake (E8s)',
            'Stake (Tokens)',
            'Dissolve State',
            'Voting Power Multiplier',
            'Owner Principals',
            'Created At',
            'Age (Days)',
            'Followees Count'
        ];

        // Convert neurons to CSV rows
        const csvRows = filteredNeurons.map(neuron => {
            const neuronId = uint8ArrayToHex(neuron.id[0]?.id) || '';
            const displayInfo = getDisplayName(neuronId);
            const stakeE8s = neuron.cached_neuron_stake_e8s || 0n;
            const stakeTokens = formatE8s(stakeE8s);
            const dissolveState = getDissolveState(neuron);
            const votingPowerMultiplier = (Number(neuron.voting_power_percentage_multiplier) / 100).toFixed(2);
            
            // Get owner principals
            const ownerPrincipals = neuron.permissions
                ?.filter(p => p.principal && p.permission_type?.length > 0)
                ?.map(p => p.principal.toString())
                ?.join('; ') || '';

            // Get creation timestamp
            const createdAt = neuron.created_timestamp_seconds 
                ? new Date(Number(neuron.created_timestamp_seconds) * 1000).toISOString()
                : '';

            // Calculate age in days
            const ageDays = neuron.created_timestamp_seconds 
                ? Math.floor((Date.now() / 1000 - Number(neuron.created_timestamp_seconds)) / (24 * 60 * 60))
                : '';

            // Count followees
            const followeesCount = Object.keys(neuron.followees || {}).length;

            return [
                neuronId,
                displayInfo.name || '',
                displayInfo.nickname || '',
                displayInfo.isVerified ? 'Yes' : 'No',
                stakeE8s.toString(),
                stakeTokens,
                dissolveState,
                votingPowerMultiplier + 'x',
                ownerPrincipals,
                createdAt,
                ageDays,
                followeesCount
            ];
        });

        // Create CSV content
        const csvContent = [
            headers.join(','),
            ...csvRows.map(row => 
                row.map(cell => {
                    // Escape cells that contain commas, quotes, or newlines
                    const cellStr = String(cell);
                    if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                        return `"${cellStr.replace(/"/g, '""')}"`;
                    }
                    return cellStr;
                }).join(',')
            )
        ].join('\n');

        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        
        // Create filename with timestamp and filter info
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const filterSuffix = dissolveFilter !== 'all' ? `_${dissolveFilter}` : '';
        const searchSuffix = searchTerm ? `_search` : '';
        const filename = `neurons_${selectedSnsRoot}_${timestamp}${filterSuffix}${searchSuffix}.csv`;
        
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            <main className="wallet-container">
                {/* Stats boxes at the top */}
                <div style={{ 
                    backgroundColor: theme.colors.secondaryBg,
                    borderRadius: '8px',
                    padding: '20px',
                    marginBottom: '20px'
                }}>
                    <div style={{ 
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                        gap: '20px',
                        textAlign: 'center'
                    }}>
                        <div>
                            <div style={{ color: theme.colors.mutedText, marginBottom: '8px' }}>Total Active Stake</div>
                            <div style={{ color: theme.colors.primaryText, fontSize: '24px', fontWeight: 'bold' }}>
                                {formatE8sAsInteger(totalStake)} {tokenSymbol}
                                {totalSupply && (
                                    <div style={{ fontSize: '14px', color: theme.colors.mutedText, marginTop: '2px' }}>
                                        ({calculatePercentage(totalStake)}% of supply)
                                    </div>
                                )}
                            </div>
                            <div style={{ color: theme.colors.mutedText, marginTop: '4px', fontSize: '14px' }}>
                                {totalCount} neurons total
                            </div>
                            <div style={{ color: theme.colors.mutedText, marginTop: '2px', fontSize: '14px' }}>
                                ({totalWithStakeCount} with stake)
                            </div>
                        </div>
                        <div>
                            <div style={{ color: theme.colors.mutedText, marginBottom: '8px' }}>Not Dissolving</div>
                            <div style={{ color: theme.colors.success, fontSize: '24px', fontWeight: 'bold' }}>
                                {formatE8sAsInteger(stakes.notDissolvingStake)} {tokenSymbol}
                                {totalSupply && (
                                    <div style={{ fontSize: '14px', color: theme.colors.mutedText, marginTop: '2px' }}>
                                        ({calculatePercentage(stakes.notDissolvingStake)}% of supply)
                                    </div>
                                )}
                            </div>
                            <div style={{ color: theme.colors.mutedText, marginTop: '4px', fontSize: '14px' }}>
                                {stakes.notDissolvingCount} neurons
                            </div>
                            <div style={{ color: theme.colors.mutedText, marginTop: '2px', fontSize: '14px' }}>
                                ({stakes.notDissolvingWithStakeCount} with stake)
                            </div>
                        </div>
                        <div>
                            <div style={{ color: theme.colors.mutedText, marginBottom: '8px' }}>Dissolving</div>
                            <div style={{ color: theme.colors.warning, fontSize: '24px', fontWeight: 'bold' }}>
                                {formatE8sAsInteger(stakes.dissolvingStake)} {tokenSymbol}
                                {totalSupply && (
                                    <div style={{ fontSize: '14px', color: theme.colors.mutedText, marginTop: '2px' }}>
                                        ({calculatePercentage(stakes.dissolvingStake)}% of supply)
                                    </div>
                                )}
                            </div>
                            <div style={{ color: theme.colors.mutedText, marginTop: '4px', fontSize: '14px' }}>
                                {stakes.dissolvingCount} neurons
                            </div>
                            <div style={{ color: theme.colors.mutedText, marginTop: '2px', fontSize: '14px' }}>
                                ({stakes.dissolvingWithStakeCount} with stake)
                            </div>
                        </div>
                        <div>
                            <div style={{ color: theme.colors.mutedText, marginBottom: '8px' }}>Dissolved</div>
                            <div style={{ color: theme.colors.error, fontSize: '24px', fontWeight: 'bold' }}>
                                {formatE8sAsInteger(stakes.dissolvedStake)} {tokenSymbol}
                                {totalSupply && (
                                    <div style={{ fontSize: '14px', color: theme.colors.mutedText, marginTop: '2px' }}>
                                        ({calculatePercentage(stakes.dissolvedStake)}% of supply)
                                    </div>
                                )}
                            </div>
                            <div style={{ color: theme.colors.mutedText, marginTop: '4px', fontSize: '14px' }}>
                                {stakes.dissolvedCount} neurons
                            </div>
                            <div style={{ color: theme.colors.mutedText, marginTop: '2px', fontSize: '14px' }}>
                                ({stakes.dissolvedWithStakeCount} with stake)
                            </div>
                        </div>
                    </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        marginBottom: '15px',
                        flexWrap: 'wrap',
                        gap: '15px'
                    }}>
                        <h1 style={{ color: theme.colors.primaryText, margin: '0' }}>Neurons</h1>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <button
                                onClick={handleRefresh}
                                style={{
                                    backgroundColor: theme.colors.tertiaryBg,
                                    color: theme.colors.primaryText,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: '4px',
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                                disabled={loading}
                            >
                                <span style={{ 
                                    display: 'inline-block',
                                    transform: loading ? 'rotate(360deg)' : 'none',
                                    transition: 'transform 1s linear',
                                    fontSize: '14px'
                                }}>⟳</span>
                                Refresh
                            </button>
                            <button
                                onClick={exportToCSV}
                                style={{
                                    backgroundColor: theme.colors.accent,
                                    color: theme.colors.primaryText,
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                                disabled={loading || filteredNeurons.length === 0}
                                title={`Export ${filteredNeurons.length} neurons to CSV`}
                            >
                                <span style={{ fontSize: '14px' }}>📄</span>
                                Export CSV
                            </button>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <label style={{ color: theme.colors.primaryText, fontSize: '14px' }}>Items per page:</label>
                                <select
                                    value={itemsPerPage}
                                    onChange={handleItemsPerPageChange}
                                    style={{
                                        backgroundColor: theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '4px',
                                        padding: '4px 8px'
                                    }}
                                >
                                    <option value={10}>10</option>
                                    <option value={20}>20</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '15px',
                        flexWrap: 'wrap',
                        marginBottom: '15px'
                    }}>
                        <div style={{ flex: '1 1 250px', minWidth: '200px' }}>
                            <NeuronInput
                                value={searchTerm}
                                onChange={setSearchTerm}
                                placeholder="Search by neuron ID, name, or nickname..."
                                snsRoot={selectedSnsRoot}
                                defaultTab="all"
                            />
                        </div>
                        <select
                            value={dissolveFilter}
                            onChange={(e) => setDissolveFilter(e.target.value)}
                            style={{
                                backgroundColor: theme.colors.tertiaryBg,
                                color: theme.colors.primaryText,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '4px',
                                padding: '8px 12px',
                                minWidth: '150px'
                            }}
                        >
                            <option value="all">All States</option>
                            <option value="not_dissolving">Not Dissolving</option>
                            <option value="dissolving">Dissolving</option>
                            <option value="dissolved">Dissolved</option>
                        </select>
                    </div>
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '15px',
                        flexWrap: 'wrap'
                    }}>
                        <label style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '6px',
                            color: theme.colors.primaryText,
                            fontSize: '14px',
                            cursor: 'pointer'
                        }}>
                            <input
                                type="checkbox"
                                checked={hideUnnamed}
                                onChange={(e) => setHideUnnamed(e.target.checked)}
                                style={{
                                    accentColor: theme.colors.accent
                                }}
                            />
                            Hide Unnamed
                        </label>
                        <label style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '6px',
                            color: theme.colors.primaryText,
                            fontSize: '14px',
                            cursor: 'pointer'
                        }}>
                            <input
                                type="checkbox"
                                checked={hideUnverified}
                                onChange={(e) => setHideUnverified(e.target.checked)}
                                style={{
                                    accentColor: theme.colors.accent
                                }}
                            />
                            Hide Unverified
                        </label>
                    </div>
                </div>

                {error && <div style={{ color: theme.colors.error, marginBottom: '20px' }}>{error}</div>}

                {/* Stakes Display */}


                {/* Sortable Headers */}
                <div style={{ 
                    backgroundColor: theme.colors.secondaryBg,
                    borderRadius: '8px',
                    padding: '15px 20px',
                    marginBottom: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '15px',
                    flexWrap: 'wrap'
                }}>
                    <div style={{ color: theme.colors.mutedText, fontSize: '14px', fontWeight: 'bold' }}>Sort by:</div>
                    <div 
                        onClick={() => handleSort('stake')}
                        style={{
                            cursor: 'pointer',
                            userSelect: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: sortConfig.key === 'stake' ? theme.colors.accent : theme.colors.primaryText,
                            fontWeight: sortConfig.key === 'stake' ? 'bold' : 'normal',
                            padding: '8px 12px',
                            borderRadius: '4px',
                            backgroundColor: sortConfig.key === 'stake' ? theme.colors.accentHover : 'transparent',
                            border: sortConfig.key === 'stake' ? `1px solid ${theme.colors.accent}` : '1px solid transparent'
                        }}
                    >
                        Stake
                        <span style={{ fontSize: '12px', opacity: 0.7 }}>{renderSortIndicator('stake')}</span>
                    </div>
                    <div 
                        onClick={() => handleSort('name')}
                        style={{
                            cursor: 'pointer',
                            userSelect: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: sortConfig.key === 'name' ? theme.colors.accent : theme.colors.primaryText,
                            fontWeight: sortConfig.key === 'name' ? 'bold' : 'normal',
                            padding: '8px 12px',
                            borderRadius: '4px',
                            backgroundColor: sortConfig.key === 'name' ? theme.colors.accentHover : 'transparent',
                            border: sortConfig.key === 'name' ? `1px solid ${theme.colors.accent}` : '1px solid transparent'
                        }}
                    >
                        Name
                        <span style={{ fontSize: '12px', opacity: 0.7 }}>{renderSortIndicator('name')}</span>
                    </div>
                    <div 
                        onClick={() => handleSort('lock')}
                        style={{
                            cursor: 'pointer',
                            userSelect: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: sortConfig.key === 'lock' ? theme.colors.accent : theme.colors.primaryText,
                            fontWeight: sortConfig.key === 'lock' ? 'bold' : 'normal',
                            padding: '8px 12px',
                            borderRadius: '4px',
                            backgroundColor: sortConfig.key === 'lock' ? theme.colors.accentHover : 'transparent',
                            border: sortConfig.key === 'lock' ? `1px solid ${theme.colors.accent}` : '1px solid transparent'
                        }}
                    >
                        Lock
                        <span style={{ fontSize: '12px', opacity: 0.7 }}>{renderSortIndicator('lock')}</span>
                    </div>
                    <div 
                        onClick={() => handleSort('votingPower')}
                        style={{
                            cursor: 'pointer',
                            userSelect: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: sortConfig.key === 'votingPower' ? theme.colors.accent : theme.colors.primaryText,
                            fontWeight: sortConfig.key === 'votingPower' ? 'bold' : 'normal',
                            padding: '8px 12px',
                            borderRadius: '4px',
                            backgroundColor: sortConfig.key === 'votingPower' ? theme.colors.accentHover : 'transparent',
                            border: sortConfig.key === 'votingPower' ? `1px solid ${theme.colors.accent}` : '1px solid transparent'
                        }}
                    >
                        Voting Power
                        <span style={{ fontSize: '12px', opacity: 0.7 }}>{renderSortIndicator('votingPower')}</span>
                    </div>
                </div>

                {loading ? (
                    <div style={{ 
                        color: theme.colors.primaryText, 
                        textAlign: 'center', 
                        padding: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '10px'
                    }}>
                        <div className="spinner" style={{ 
                            width: '32px', 
                            height: '32px',
                            border: `3px solid ${theme.colors.accent}`,
                            borderTop: '3px solid transparent',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                        }} />
                        <div style={{ marginTop: '10px' }}>
                            {loadingProgress.message}
                        </div>
                        {/* Progress bar */}
                        <div style={{
                            width: '100%',
                            maxWidth: '400px',
                            backgroundColor: theme.colors.secondaryBg,
                            borderRadius: '4px',
                            overflow: 'hidden',
                            height: '8px',
                            margin: '10px 0'
                        }}>
                            <div style={{
                                width: `${loadingProgress.percent}%`,
                                backgroundColor: theme.colors.accent,
                                height: '100%',
                                transition: 'width 0.3s ease'
                            }} />
                        </div>
                        <div style={{ color: theme.colors.mutedText, fontSize: '14px' }}>
                            {loadingProgress.count > 0 && (
                                <>Found {loadingProgress.count} neurons</>
                            )}
                            {totalNeuronCount !== null && loadingProgress.count > 0 && (
                                <> (Total: {totalNeuronCount})</>
                            )}
                        </div>
                    </div>
                ) : (
                    <div>
                        {paginatedNeurons.map((neuron, index) => (
                            <div
                                key={index}
                                style={{
                                    backgroundColor: theme.colors.secondaryBg,
                                    borderRadius: '8px',
                                    padding: '20px',
                                    marginBottom: '15px'
                                }}
                            >
                                <div style={{ 
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                    gap: '20px'
                                }}>
                                    <div>
                                        <div style={{ color: theme.colors.mutedText, marginBottom: '4px' }}>Neuron ID</div>
                                        <div>
                                            <NeuronDisplay
                                                neuronId={uint8ArrayToHex(neuron.id[0].id)}
                                                snsRoot={selectedSnsRoot}
                                                displayInfo={getDisplayName(uint8ArrayToHex(neuron.id[0].id))}
                                                showCopyButton={true}
                                                enableContextMenu={true}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ color: theme.colors.mutedText, marginBottom: '4px' }}>Stake</div>
                                        <div style={{ color: theme.colors.primaryText, fontSize: '18px', fontWeight: 'bold' }}>
                                            {formatE8s(neuron.cached_neuron_stake_e8s)} {tokenSymbol}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ color: theme.colors.mutedText, marginBottom: '4px' }}>Dissolve State</div>
                                        <div style={{ color: theme.colors.primaryText }}>{getDissolveState(neuron)}</div>
                                    </div>
                                    <div>
                                        <div style={{ color: theme.colors.mutedText, marginBottom: '4px' }}>Voting Power</div>
                                        <div style={{ color: theme.colors.primaryText }}>
                                            {nervousSystemParameters ? 
                                                formatVotingPower(calculateVotingPower(neuron, nervousSystemParameters)) :
                                                `${(Number(neuron.voting_power_percentage_multiplier) / 100).toFixed(2)}x`
                                            }
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {/* Pagination Controls */}
                        <div style={{ 
                            display: 'flex',
                            justifyContent: 'center',
                            gap: '10px',
                            marginTop: '20px'
                        }}>
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                disabled={currentPage === 1}
                                style={{
                                    backgroundColor: theme.colors.accent,
                                    color: theme.colors.primaryText,
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 16px',
                                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                    opacity: currentPage === 1 ? 0.7 : 1
                                }}
                            >
                                Previous
                            </button>
                            <span style={{ color: theme.colors.primaryText, alignSelf: 'center' }}>
                                Page {currentPage} of {Math.ceil(filteredNeurons.length / itemsPerPage)}
                            </span>
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(Math.ceil(filteredNeurons.length / itemsPerPage), prev + 1))}
                                disabled={currentPage === Math.ceil(filteredNeurons.length / itemsPerPage)}
                                style={{
                                    backgroundColor: theme.colors.accent,
                                    color: theme.colors.primaryText,
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 16px',
                                    cursor: currentPage === Math.ceil(filteredNeurons.length / itemsPerPage) ? 'not-allowed' : 'pointer',
                                    opacity: currentPage === Math.ceil(filteredNeurons.length / itemsPerPage) ? 0.7 : 1
                                }}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default Neurons; 