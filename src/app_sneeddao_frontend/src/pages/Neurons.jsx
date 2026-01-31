import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams, useLocation, Link } from 'react-router-dom';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { useAuth } from '../AuthContext';
import { useSns } from '../contexts/SnsContext';
import Header from '../components/Header';
import { fetchAndCacheSnsData, getSnsById, fetchSnsLogo, getAllSnses } from '../utils/SnsUtils';
import { formatNeuronIdLink, formatE8s, getDissolveState, uint8ArrayToHex } from '../utils/NeuronUtils';
import { calculateVotingPower, formatVotingPower } from '../utils/VotingPowerUtils';
import { Actor, HttpAgent } from '@dfinity/agent';
import { useNaming } from '../NamingContext';
import { useTheme } from '../contexts/ThemeContext';
import NeuronInput from '../components/NeuronInput';
import NeuronDisplay from '../components/NeuronDisplay';
import TokenIcon from '../components/TokenIcon';
import { FaUsers, FaLock, FaUnlock, FaClock, FaDownload, FaSync, FaChevronLeft, FaChevronRight, FaSearch, FaLightbulb, FaArrowUp, FaArrowDown, FaSort, FaFilter, FaCoins, FaVoteYea, FaCheckCircle, FaTimesCircle, FaExternalLinkAlt } from 'react-icons/fa';

function Neurons() {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const { selectedSnsRoot, updateSelectedSns } = useSns();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const [snsList, setSnsList] = useState([]);
    const [neurons, setNeurons] = useState([]);
    const [snsLogo, setSnsLogo] = useState(null);
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
    
    // Get current SNS info
    const currentSnsInfo = useMemo(() => {
        if (!selectedSnsRoot) return null;
        return getSnsById(selectedSnsRoot);
    }, [selectedSnsRoot]);
    
    // Accent colors for this page
    const neuronPrimary = '#6366f1'; // Indigo
    const neuronSecondary = '#8b5cf6'; // Violet
    const neuronAccent = '#a78bfa'; // Light violet
    
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

    // Load SNS logo when SNS changes
    useEffect(() => {
        const loadSnsLogo = async () => {
            if (!selectedSnsRoot) {
                setSnsLogo(null);
                return;
            }
            
            try {
                const allSnses = getAllSnses();
                const currentSnsInfo = allSnses.find(sns => sns.rootCanisterId === selectedSnsRoot);
                
                if (currentSnsInfo?.canisters?.governance) {
                    const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://ic0.app' : 'http://localhost:4943';
                    const agent = new HttpAgent({ host, ...(identity && { identity }) });
                    
                    if (process.env.DFX_NETWORK !== 'ic') {
                        await agent.fetchRootKey();
                    }
                    
                    const logo = await fetchSnsLogo(currentSnsInfo.canisters.governance, agent);
                    setSnsLogo(logo);
                } else {
                    setSnsLogo(null);
                }
            } catch (error) {
                console.error('Error loading SNS logo:', error);
                setSnsLogo(null);
            }
        };
        
        loadSnsLogo();
    }, [selectedSnsRoot, identity]);

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
        if (sortConfig.key !== key) return <FaSort size={10} style={{ opacity: 0.4 }} />;
        return sortConfig.direction === 'asc' ? <FaArrowUp size={10} /> : <FaArrowDown size={10} />;
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

    // Get dissolve state color and icon
    const getDissolveStateStyle = (neuron) => {
        const state = getDissolveStateDetails(neuron);
        switch (state.category) {
            case 'not_dissolving':
                return { color: '#10b981', icon: <FaLock size={12} />, label: 'Locked' };
            case 'dissolving':
                return { color: '#f59e0b', icon: <FaClock size={12} />, label: 'Dissolving' };
            case 'dissolved':
                return { color: '#ef4444', icon: <FaUnlock size={12} />, label: 'Dissolved' };
            default:
                return { color: theme.colors.mutedText, icon: null, label: 'Unknown' };
        }
    };

    // Custom styles
    const customStyles = `
        @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        @keyframes shimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
        }
        .neuron-card-animate {
            animation: fadeInUp 0.5s ease-out forwards;
        }
        .neuron-card:hover {
            transform: translateY(-3px);
            box-shadow: 0 12px 40px rgba(99, 102, 241, 0.15);
        }
        .stat-card:hover {
            transform: translateY(-2px);
        }
    `;

    return (
        <div className='page-container'>
            <style>{customStyles}</style>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            
            <main style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                {/* Hero Section */}
                <div style={{
                    background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${neuronPrimary}15 50%, ${neuronSecondary}10 100%)`,
                    borderBottom: `1px solid ${theme.colors.border}`,
                    padding: '2rem 1.5rem',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    {/* Background decorations */}
                    <div style={{
                        position: 'absolute', top: '-50%', right: '-10%', width: '400px', height: '400px',
                        background: `radial-gradient(circle, ${neuronPrimary}20 0%, transparent 70%)`,
                        borderRadius: '50%', pointerEvents: 'none'
                    }} />
                    <div style={{
                        position: 'absolute', bottom: '-30%', left: '-5%', width: '300px', height: '300px',
                        background: `radial-gradient(circle, ${neuronSecondary}15 0%, transparent 70%)`,
                        borderRadius: '50%', pointerEvents: 'none'
                    }} />
                    
                    <div style={{ maxWidth: '1200px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                            <div style={{
                                width: '56px', height: '56px',
                                minWidth: '56px', maxWidth: '56px',
                                flexShrink: 0,
                                borderRadius: '14px',
                                overflow: 'hidden'
                            }}>
                                {snsLogo ? (
                                    <img src={snsLogo} alt="SNS" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <div style={{
                                        width: '100%', height: '100%',
                                        background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        boxShadow: `0 4px 20px ${neuronPrimary}40`
                                    }}>
                                        <FaUsers size={24} color="white" />
                                    </div>
                                )}
                            </div>
                            <div>
                                <h1 style={{ color: theme.colors.primaryText, fontSize: '1.75rem', fontWeight: '700', margin: 0 }}>
                                    {currentSnsInfo?.name || 'SNS'} Neuron Explorer
                                </h1>
                                <p style={{ color: theme.colors.secondaryText, fontSize: '0.95rem', margin: '0.25rem 0 0 0' }}>
                                    Browse and analyze all neurons in the {currentSnsInfo?.name || 'SNS'} governance
                                </p>
                            </div>
                        </div>
                        
                        {/* Quick Stats Row */}
                        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                            <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                <span style={{ color: neuronPrimary, fontWeight: '600' }}>{neurons.length.toLocaleString()}</span> neurons loaded
                            </div>
                            {totalNeuronCount && (
                                <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                    <span style={{ color: neuronPrimary, fontWeight: '600' }}>{totalNeuronCount.toLocaleString()}</span> total on-chain
                                </div>
                            )}
                            {filteredNeurons.length !== neurons.length && (
                                <div style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                    <span style={{ color: neuronAccent, fontWeight: '600' }}>{filteredNeurons.length.toLocaleString()}</span> matching filters
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.5rem' }}>
                    {/* Statistics Cards */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                        gap: '1rem',
                        marginBottom: '1.5rem'
                    }}>
                        {/* Total Active Stake */}
                        <div className="stat-card" style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '1.25rem',
                            border: `1px solid ${theme.colors.border}`,
                            transition: 'all 0.3s ease'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                <div style={{
                                    width: '40px', height: '40px',
                                    minWidth: '40px', maxWidth: '40px',
                                    flexShrink: 0,
                                    borderRadius: '10px',
                                    background: `linear-gradient(135deg, ${neuronPrimary}30, ${neuronSecondary}20)`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: neuronPrimary,
                                    overflow: 'hidden'
                                }}>
                                    <TokenIcon 
                                        logo={snsLogo} 
                                        size={24} 
                                        fallbackColor={neuronPrimary}
                                        rounded={false}
                                    />
                                </div>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem', fontWeight: '500' }}>Total Active Stake</span>
                            </div>
                            <div style={{ color: theme.colors.primaryText, fontSize: '1.5rem', fontWeight: '700' }}>
                                {formatE8sAsInteger(totalStake)} <span style={{ fontSize: '0.9rem', fontWeight: '500', color: theme.colors.secondaryText }}>{tokenSymbol}</span>
                            </div>
                            {totalSupply && (
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                    {calculatePercentage(totalStake)}% of total supply
                                </div>
                            )}
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginTop: '0.5rem' }}>
                                {totalCount.toLocaleString()} neurons ({totalWithStakeCount.toLocaleString()} with stake)
                            </div>
                        </div>

                        {/* Not Dissolving */}
                        <div className="stat-card" style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '1.25rem',
                            border: `1px solid ${theme.colors.border}`,
                            transition: 'all 0.3s ease'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                <div style={{
                                    width: '40px', height: '40px', borderRadius: '10px',
                                    background: 'linear-gradient(135deg, #10b98130, #10b98120)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#10b981'
                                }}>
                                    <FaLock size={18} />
                                </div>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem', fontWeight: '500' }}>Not Dissolving</span>
                            </div>
                            <div style={{ color: '#10b981', fontSize: '1.5rem', fontWeight: '700' }}>
                                {formatE8sAsInteger(stakes.notDissolvingStake)} <span style={{ fontSize: '0.9rem', fontWeight: '500', opacity: 0.8 }}>{tokenSymbol}</span>
                            </div>
                            {totalSupply && (
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                    {calculatePercentage(stakes.notDissolvingStake)}% of total supply
                                </div>
                            )}
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginTop: '0.5rem' }}>
                                {stakes.notDissolvingCount.toLocaleString()} neurons ({stakes.notDissolvingWithStakeCount.toLocaleString()} with stake)
                            </div>
                        </div>

                        {/* Dissolving */}
                        <div className="stat-card" style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '1.25rem',
                            border: `1px solid ${theme.colors.border}`,
                            transition: 'all 0.3s ease'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                <div style={{
                                    width: '40px', height: '40px', borderRadius: '10px',
                                    background: 'linear-gradient(135deg, #f59e0b30, #f59e0b20)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#f59e0b'
                                }}>
                                    <FaClock size={18} />
                                </div>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem', fontWeight: '500' }}>Dissolving</span>
                            </div>
                            <div style={{ color: '#f59e0b', fontSize: '1.5rem', fontWeight: '700' }}>
                                {formatE8sAsInteger(stakes.dissolvingStake)} <span style={{ fontSize: '0.9rem', fontWeight: '500', opacity: 0.8 }}>{tokenSymbol}</span>
                            </div>
                            {totalSupply && (
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                    {calculatePercentage(stakes.dissolvingStake)}% of total supply
                                </div>
                            )}
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginTop: '0.5rem' }}>
                                {stakes.dissolvingCount.toLocaleString()} neurons ({stakes.dissolvingWithStakeCount.toLocaleString()} with stake)
                            </div>
                        </div>

                        {/* Dissolved */}
                        <div className="stat-card" style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '1.25rem',
                            border: `1px solid ${theme.colors.border}`,
                            transition: 'all 0.3s ease'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                <div style={{
                                    width: '40px', height: '40px', borderRadius: '10px',
                                    background: 'linear-gradient(135deg, #ef444430, #ef444420)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#ef4444'
                                }}>
                                    <FaUnlock size={18} />
                                </div>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem', fontWeight: '500' }}>Dissolved</span>
                            </div>
                            <div style={{ color: '#ef4444', fontSize: '1.5rem', fontWeight: '700' }}>
                                {formatE8sAsInteger(stakes.dissolvedStake)} <span style={{ fontSize: '0.9rem', fontWeight: '500', opacity: 0.8 }}>{tokenSymbol}</span>
                            </div>
                            {totalSupply && (
                                <div style={{ color: theme.colors.mutedText, fontSize: '0.8rem', marginTop: '0.25rem' }}>
                                    {calculatePercentage(stakes.dissolvedStake)}% of total supply
                                </div>
                            )}
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginTop: '0.5rem' }}>
                                {stakes.dissolvedCount.toLocaleString()} neurons ({stakes.dissolvedWithStakeCount.toLocaleString()} with stake)
                            </div>
                        </div>
                    </div>

                    {/* Did you know - Liquid Staking */}
                    <div style={{
                        background: `linear-gradient(135deg, ${neuronPrimary}12, ${neuronSecondary}08)`,
                        border: `1px solid ${neuronPrimary}25`,
                        borderRadius: '14px',
                        padding: '1rem 1.25rem',
                        marginBottom: '1.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        flexWrap: 'wrap',
                    }}>
                        <div style={{
                            width: '40px', height: '40px', borderRadius: '10px',
                            background: `linear-gradient(135deg, ${neuronPrimary}30, ${neuronSecondary}20)`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: neuronPrimary, flexShrink: 0
                        }}>
                            <FaLightbulb size={18} />
                        </div>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={{ color: neuronPrimary, fontWeight: '600', marginBottom: '0.25rem', fontSize: '0.9rem' }}>
                                Did you know?
                            </div>
                            <div style={{ color: theme.colors.secondaryText, fontSize: '0.85rem', lineHeight: '1.5' }}>
                                With <strong>Liquid Staking</strong>, you can create SNS neurons that remain <strong>transferable</strong> and <strong>tradable on Sneedex</strong>!
                            </div>
                        </div>
                        <Link 
                            to="/liquid_staking" 
                            style={{
                                background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                color: '#fff',
                                padding: '0.6rem 1.25rem',
                                borderRadius: '8px',
                                textDecoration: 'none',
                                fontWeight: '600',
                                fontSize: '0.85rem',
                                whiteSpace: 'nowrap',
                                boxShadow: `0 4px 12px ${neuronPrimary}30`
                            }}
                        >
                            Learn More →
                        </Link>
                    </div>

                    {/* Controls Section */}
                    <div style={{
                        background: theme.colors.secondaryBg,
                        borderRadius: '16px',
                        padding: '1.25rem',
                        marginBottom: '1.5rem',
                        border: `1px solid ${theme.colors.border}`
                    }}>
                        {/* Top row: Title and action buttons */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '1rem',
                            flexWrap: 'wrap',
                            gap: '1rem'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <FaFilter size={14} color={neuronPrimary} />
                                <span style={{ color: theme.colors.primaryText, fontWeight: '600', fontSize: '1rem' }}>
                                    Filters & Controls
                                </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <button
                                    onClick={handleRefresh}
                                    disabled={loading}
                                    style={{
                                        background: theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '8px',
                                        padding: '0.5rem 1rem',
                                        cursor: loading ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        fontSize: '0.85rem',
                                        fontWeight: '500',
                                        opacity: loading ? 0.6 : 1,
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <FaSync size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                                    Refresh
                                </button>
                                <button
                                    onClick={exportToCSV}
                                    disabled={loading || filteredNeurons.length === 0}
                                    style={{
                                        background: `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '8px',
                                        padding: '0.5rem 1rem',
                                        cursor: (loading || filteredNeurons.length === 0) ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.5rem',
                                        fontSize: '0.85rem',
                                        fontWeight: '600',
                                        opacity: (loading || filteredNeurons.length === 0) ? 0.6 : 1,
                                        boxShadow: `0 2px 8px ${neuronPrimary}30`
                                    }}
                                    title={`Export ${filteredNeurons.length} neurons to CSV`}
                                >
                                    <FaDownload size={12} />
                                    Export CSV
                                </button>
                            </div>
                        </div>

                        {/* Search and filters row */}
                        <div style={{
                            display: 'flex',
                            gap: '1rem',
                            flexWrap: 'wrap',
                            alignItems: 'flex-start',
                            marginBottom: '1rem'
                        }}>
                            <div style={{ flex: '1 1 300px', minWidth: '200px' }}>
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
                                    borderRadius: '8px',
                                    padding: '0.5rem 1rem',
                                    minWidth: '150px',
                                    fontSize: '0.9rem',
                                    cursor: 'pointer'
                                }}
                            >
                                <option value="all">All States</option>
                                <option value="not_dissolving">🔒 Not Dissolving</option>
                                <option value="dissolving">⏳ Dissolving</option>
                                <option value="dissolved">🔓 Dissolved</option>
                            </select>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: theme.colors.secondaryText, fontSize: '0.85rem' }}>Per page:</span>
                                <select
                                    value={itemsPerPage}
                                    onChange={handleItemsPerPageChange}
                                    style={{
                                        backgroundColor: theme.colors.tertiaryBg,
                                        color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.border}`,
                                        borderRadius: '8px',
                                        padding: '0.5rem 0.75rem',
                                        fontSize: '0.9rem',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value={10}>10</option>
                                    <option value={20}>20</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                </select>
                            </div>
                        </div>

                        {/* Checkbox filters */}
                        <div style={{
                            display: 'flex',
                            gap: '1.5rem',
                            flexWrap: 'wrap',
                            paddingTop: '0.75rem',
                            borderTop: `1px solid ${theme.colors.border}`
                        }}>
                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                color: theme.colors.secondaryText,
                                fontSize: '0.85rem',
                                cursor: 'pointer'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={hideUnnamed}
                                    onChange={(e) => setHideUnnamed(e.target.checked)}
                                    style={{ accentColor: neuronPrimary, width: '16px', height: '16px' }}
                                />
                                Show only named neurons
                            </label>
                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                color: theme.colors.secondaryText,
                                fontSize: '0.85rem',
                                cursor: 'pointer'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={hideUnverified}
                                    onChange={(e) => setHideUnverified(e.target.checked)}
                                    style={{ accentColor: neuronPrimary, width: '16px', height: '16px' }}
                                />
                                Show only verified names
                            </label>
                        </div>
                    </div>

                    {/* Sort Controls */}
                    <div style={{
                        background: theme.colors.secondaryBg,
                        borderRadius: '12px',
                        padding: '0.75rem 1rem',
                        marginBottom: '1rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        flexWrap: 'wrap',
                        border: `1px solid ${theme.colors.border}`
                    }}>
                        <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem', fontWeight: '500', marginRight: '0.5rem' }}>
                            Sort by:
                        </span>
                        {[
                            { key: 'stake', label: 'Stake', icon: <TokenIcon logo={snsLogo} size={14} fallbackColor={neuronPrimary} rounded={false} /> },
                            { key: 'name', label: 'Name', icon: <FaUsers size={12} /> },
                            { key: 'lock', label: 'Lock Status', icon: <FaLock size={12} /> },
                            { key: 'votingPower', label: 'Voting Power', icon: <FaVoteYea size={12} /> }
                        ].map(sort => (
                            <button
                                key={sort.key}
                                onClick={() => handleSort(sort.key)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    padding: '0.4rem 0.75rem',
                                    borderRadius: '6px',
                                    border: sortConfig.key === sort.key ? `1px solid ${neuronPrimary}` : `1px solid transparent`,
                                    background: sortConfig.key === sort.key ? `${neuronPrimary}15` : 'transparent',
                                    color: sortConfig.key === sort.key ? neuronPrimary : theme.colors.secondaryText,
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                    fontWeight: sortConfig.key === sort.key ? '600' : '500',
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                {sort.icon}
                                {sort.label}
                                {renderSortIndicator(sort.key)}
                            </button>
                        ))}
                    </div>

                    {/* Error display */}
                    {error && (
                        <div style={{
                            background: `linear-gradient(135deg, ${theme.colors.error}15, ${theme.colors.error}08)`,
                            border: `1px solid ${theme.colors.error}30`,
                            borderRadius: '12px',
                            padding: '1rem',
                            marginBottom: '1rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem'
                        }}>
                            <FaTimesCircle color={theme.colors.error} />
                            <span style={{ color: theme.colors.error }}>{error}</span>
                        </div>
                    )}

                    {/* Loading State */}
                    {loading ? (
                        <div style={{
                            background: theme.colors.secondaryBg,
                            borderRadius: '16px',
                            padding: '3rem',
                            textAlign: 'center',
                            border: `1px solid ${theme.colors.border}`
                        }}>
                            <div style={{
                                width: '48px', height: '48px',
                                border: `3px solid ${neuronPrimary}30`,
                                borderTop: `3px solid ${neuronPrimary}`,
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite',
                                margin: '0 auto 1.5rem'
                            }} />
                            <div style={{ color: theme.colors.primaryText, fontSize: '1rem', marginBottom: '0.5rem' }}>
                                {loadingProgress.message}
                            </div>
                            {/* Progress bar */}
                            <div style={{
                                width: '100%',
                                maxWidth: '400px',
                                margin: '1rem auto',
                                backgroundColor: theme.colors.tertiaryBg,
                                borderRadius: '8px',
                                overflow: 'hidden',
                                height: '8px'
                            }}>
                                <div style={{
                                    width: `${loadingProgress.percent}%`,
                                    background: `linear-gradient(90deg, ${neuronPrimary}, ${neuronSecondary})`,
                                    height: '100%',
                                    transition: 'width 0.3s ease',
                                    borderRadius: '8px'
                                }} />
                            </div>
                            <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                                {loadingProgress.count > 0 && `Found ${loadingProgress.count.toLocaleString()} neurons`}
                                {totalNeuronCount && loadingProgress.count > 0 && ` (Total: ${totalNeuronCount.toLocaleString()})`}
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Neuron Cards */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {paginatedNeurons.map((neuron, index) => {
                                    const neuronId = uint8ArrayToHex(neuron.id[0]?.id);
                                    const dissolveStyle = getDissolveStateStyle(neuron);
                                    const displayInfo = getDisplayName(neuronId);
                                    
                                    return (
                                        <div
                                            key={index}
                                            className="neuron-card neuron-card-animate"
                                            style={{
                                                backgroundColor: theme.colors.secondaryBg,
                                                borderRadius: '14px',
                                                padding: '1.25rem',
                                                border: `1px solid ${theme.colors.border}`,
                                                opacity: 0,
                                                animationDelay: `${index * 0.03}s`,
                                                cursor: 'pointer',
                                                transition: 'all 0.3s ease'
                                            }}
                                            onClick={() => navigate(`/neuron?sns=${selectedSnsRoot}&neuronid=${neuronId}`)}
                                        >
                                            <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                                                gap: '1.25rem',
                                                alignItems: 'center'
                                            }}>
                                                {/* Neuron ID */}
                                                <div style={{ minWidth: 0 }}>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                        Neuron
                                                    </div>
                                                    <div onClick={(e) => e.stopPropagation()}>
                                                        <NeuronDisplay
                                                            neuronId={neuronId}
                                                            snsRoot={selectedSnsRoot}
                                                            displayInfo={displayInfo}
                                                            showCopyButton={true}
                                                            enableContextMenu={true}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Stake */}
                                                <div>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                        <TokenIcon logo={snsLogo} size={12} fallbackColor={neuronPrimary} rounded={false} />
                                                        Stake
                                                    </div>
                                                    <div style={{ color: theme.colors.primaryText, fontSize: '1.1rem', fontWeight: '600' }}>
                                                        {formatE8s(neuron.cached_neuron_stake_e8s)}
                                                        <span style={{ fontSize: '0.8rem', fontWeight: '400', color: theme.colors.secondaryText, marginLeft: '0.35rem' }}>
                                                            {tokenSymbol}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Dissolve State */}
                                                <div>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                        Status
                                                    </div>
                                                    <div style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '0.4rem',
                                                        padding: '0.35rem 0.7rem',
                                                        borderRadius: '6px',
                                                        background: `${dissolveStyle.color}15`,
                                                        color: dissolveStyle.color,
                                                        fontSize: '0.8rem',
                                                        fontWeight: '500'
                                                    }}>
                                                        {dissolveStyle.icon}
                                                        {getDissolveState(neuron)}
                                                    </div>
                                                </div>

                                                {/* Voting Power */}
                                                <div>
                                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.75rem', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                        Voting Power
                                                    </div>
                                                    <div style={{ color: neuronPrimary, fontSize: '1rem', fontWeight: '600' }}>
                                                        {nervousSystemParameters ?
                                                            formatVotingPower(calculateVotingPower(neuron, nervousSystemParameters)) :
                                                            `${(Number(neuron.voting_power_percentage_multiplier) / 100).toFixed(2)}x`
                                                        }
                                                    </div>
                                                </div>

                                                {/* View button */}
                                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '0.35rem',
                                                        color: neuronPrimary,
                                                        fontSize: '0.85rem',
                                                        fontWeight: '500'
                                                    }}>
                                                        View Details
                                                        <FaExternalLinkAlt size={10} />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Empty State */}
                            {filteredNeurons.length === 0 && !loading && (
                                <div style={{
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '16px',
                                    padding: '3rem',
                                    textAlign: 'center',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    <FaUsers size={48} color={theme.colors.mutedText} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                                    <div style={{ color: theme.colors.secondaryText, fontSize: '1rem' }}>
                                        {neurons.length === 0 ? 'No neurons loaded yet' : 'No neurons match your filters'}
                                    </div>
                                    <div style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginTop: '0.5rem' }}>
                                        {neurons.length === 0 ? 'Click Refresh to load neurons' : 'Try adjusting your search or filter criteria'}
                                    </div>
                                </div>
                            )}

                            {/* Pagination */}
                            {filteredNeurons.length > 0 && (
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    gap: '1rem',
                                    marginTop: '1.5rem',
                                    padding: '1rem',
                                    background: theme.colors.secondaryBg,
                                    borderRadius: '12px',
                                    border: `1px solid ${theme.colors.border}`
                                }}>
                                    <button
                                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                        disabled={currentPage === 1}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.4rem',
                                            padding: '0.5rem 1rem',
                                            borderRadius: '8px',
                                            border: 'none',
                                            background: currentPage === 1 ? theme.colors.tertiaryBg : `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                            color: currentPage === 1 ? theme.colors.mutedText : 'white',
                                            cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                            fontSize: '0.85rem',
                                            fontWeight: '500',
                                            opacity: currentPage === 1 ? 0.5 : 1
                                        }}
                                    >
                                        <FaChevronLeft size={10} />
                                        Previous
                                    </button>
                                    <span style={{ color: theme.colors.secondaryText, fontSize: '0.9rem' }}>
                                        Page <strong style={{ color: theme.colors.primaryText }}>{currentPage}</strong> of <strong style={{ color: theme.colors.primaryText }}>{Math.ceil(filteredNeurons.length / itemsPerPage)}</strong>
                                    </span>
                                    <button
                                        onClick={() => setCurrentPage(prev => Math.min(Math.ceil(filteredNeurons.length / itemsPerPage), prev + 1))}
                                        disabled={currentPage === Math.ceil(filteredNeurons.length / itemsPerPage)}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.4rem',
                                            padding: '0.5rem 1rem',
                                            borderRadius: '8px',
                                            border: 'none',
                                            background: currentPage === Math.ceil(filteredNeurons.length / itemsPerPage) ? theme.colors.tertiaryBg : `linear-gradient(135deg, ${neuronPrimary}, ${neuronSecondary})`,
                                            color: currentPage === Math.ceil(filteredNeurons.length / itemsPerPage) ? theme.colors.mutedText : 'white',
                                            cursor: currentPage === Math.ceil(filteredNeurons.length / itemsPerPage) ? 'not-allowed' : 'pointer',
                                            fontSize: '0.85rem',
                                            fontWeight: '500',
                                            opacity: currentPage === Math.ceil(filteredNeurons.length / itemsPerPage) ? 0.5 : 1
                                        }}
                                    >
                                        Next
                                        <FaChevronRight size={10} />
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}

export default Neurons;
