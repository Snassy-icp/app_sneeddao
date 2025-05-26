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

function Neurons() {
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
    
    // Pagination state
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [currentPage, setCurrentPage] = useState(1);

    const [loadingProgress, setLoadingProgress] = useState({ count: 0, message: '', percent: 0 });

    const [dissolveFilter, setDissolveFilter] = useState('all');
    const [sortBy, setSortBy] = useState('stake');
    
    // Add new filter states
    const [hideUnnamed, setHideUnnamed] = useState(false);
    const [hideUnverified, setHideUnverified] = useState(false);
    // Add nervous system parameters state
    const [nervousSystemParameters, setNervousSystemParameters] = useState(null);

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
            if (sortBy === 'stake') {
                // Sort by stake (descending)
                const stakeA = BigInt(a.cached_neuron_stake_e8s || 0);
                const stakeB = BigInt(b.cached_neuron_stake_e8s || 0);
                return stakeB > stakeA ? 1 : stakeB < stakeA ? -1 : 0;
            }
            
            if (sortBy === 'name') {
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
                if (nameA && nameB) return nameA.localeCompare(nameB);
                if (nameA) return -1; // Named neurons come first
                if (nameB) return 1;
                if (nicknameA && nicknameB) return nicknameA.localeCompare(nicknameB);
                if (nicknameA) return -1; // Nicknamed neurons come after named ones
                if (nicknameB) return 1;
                return neuronIdA.localeCompare(neuronIdB); // Sort by ID if no name/nickname
            }

            if (sortBy === 'lock') {
                const stateA = getDissolveStateDetails(a);
                const stateB = getDissolveStateDetails(b);

                // First compare by dissolve state category
                if (stateA.category !== stateB.category) {
                    // Not Dissolving comes first, then Dissolving, then Dissolved
                    const order = { 'not_dissolving': 0, 'dissolving': 1, 'dissolved': 2 };
                    return order[stateA.category] - order[stateB.category];
                }

                // Within the same category
                if (stateA.category === 'not_dissolving') {
                    // Sort by lock time (DissolveDelaySeconds)
                    return Number(stateB.dissolveDelaySeconds || 0) - Number(stateA.dissolveDelaySeconds || 0);
                }
                if (stateA.category === 'dissolving') {
                    // Sort by time left until dissolution
                    return Number(stateB.timeLeft || 0) - Number(stateA.timeLeft || 0);
                }
                // For dissolved neurons, sort by stake
                const stakeA = BigInt(a.cached_neuron_stake_e8s || 0);
                const stakeB = BigInt(b.cached_neuron_stake_e8s || 0);
                return stakeB > stakeA ? 1 : stakeB < stakeA ? -1 : 0;
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
    }, [searchTerm, dissolveFilter, sortBy, hideUnnamed, hideUnverified, neurons, selectedSnsRoot, neuronNames, neuronNicknames, verifiedNames]);

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

    return (
        <div className='page-container'>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            <main className="wallet-container">
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    marginBottom: '20px',
                    flexWrap: 'wrap',
                    gap: '10px'
                }}>
                    <h1 style={{ color: '#ffffff' }}>Neurons</h1>
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '10px',
                        flex: 1,
                        maxWidth: '600px',
                        marginLeft: '20px'
                    }}>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Search by neuron ID, name, or nickname..."
                            style={{
                                backgroundColor: '#3a3a3a',
                                color: '#ffffff',
                                border: '1px solid #4a4a4a',
                                borderRadius: '4px',
                                padding: '8px 12px',
                                flex: 1,
                                minWidth: '200px'
                            }}
                        />
                        <select
                            value={dissolveFilter}
                            onChange={(e) => setDissolveFilter(e.target.value)}
                            style={{
                                backgroundColor: '#3a3a3a',
                                color: '#ffffff',
                                border: '1px solid #4a4a4a',
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
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            style={{
                                backgroundColor: '#3a3a3a',
                                color: '#ffffff',
                                border: '1px solid #4a4a4a',
                                borderRadius: '4px',
                                padding: '8px 12px',
                                minWidth: '150px'
                            }}
                        >
                            <option value="stake">Sort by Stake</option>
                            <option value="name">Sort by Name</option>
                            <option value="lock">Sort by Lock</option>
                        </select>
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '15px',
                            marginLeft: '10px'
                        }}>
                            <label style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '6px',
                                color: '#ffffff',
                                fontSize: '14px',
                                cursor: 'pointer'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={hideUnnamed}
                                    onChange={(e) => setHideUnnamed(e.target.checked)}
                                    style={{
                                        accentColor: '#3498db'
                                    }}
                                />
                                Hide Unnamed
                            </label>
                            <label style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '6px',
                                color: '#ffffff',
                                fontSize: '14px',
                                cursor: 'pointer'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={hideUnverified}
                                    onChange={(e) => setHideUnverified(e.target.checked)}
                                    style={{
                                        accentColor: '#3498db'
                                    }}
                                />
                                Hide Unverified
                            </label>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button
                            onClick={handleRefresh}
                            style={{
                                backgroundColor: '#3a3a3a',
                                color: '#fff',
                                border: '1px solid #4a4a4a',
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
                        <label style={{ color: '#ffffff' }}>Items per page:</label>
                        <select
                            value={itemsPerPage}
                            onChange={handleItemsPerPageChange}
                            style={{
                                backgroundColor: '#3a3a3a',
                                color: '#fff',
                                border: '1px solid #4a4a4a',
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

                {error && <div style={{ color: '#e74c3c', marginBottom: '20px' }}>{error}</div>}

                {/* Stakes Display */}
                <div style={{ 
                    backgroundColor: '#2a2a2a',
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
                            <div style={{ color: '#888', marginBottom: '8px' }}>Total Active Stake</div>
                            <div style={{ color: '#ffffff', fontSize: '24px', fontWeight: 'bold' }}>
                                {formatE8s(totalStake)} {tokenSymbol}
                                {totalSupply && (
                                    <div style={{ fontSize: '14px', color: '#888', marginTop: '2px' }}>
                                        ({calculatePercentage(totalStake)}% of supply)
                                    </div>
                                )}
                            </div>
                            <div style={{ color: '#888', marginTop: '4px', fontSize: '14px' }}>
                                {totalCount} neurons total
                            </div>
                            <div style={{ color: '#888', marginTop: '2px', fontSize: '14px' }}>
                                ({totalWithStakeCount} with stake)
                            </div>
                        </div>
                        <div>
                            <div style={{ color: '#888', marginBottom: '8px' }}>Not Dissolving</div>
                            <div style={{ color: '#2ecc71', fontSize: '24px', fontWeight: 'bold' }}>
                                {formatE8s(stakes.notDissolvingStake)} {tokenSymbol}
                                {totalSupply && (
                                    <div style={{ fontSize: '14px', color: '#888', marginTop: '2px' }}>
                                        ({calculatePercentage(stakes.notDissolvingStake)}% of supply)
                                    </div>
                                )}
                            </div>
                            <div style={{ color: '#888', marginTop: '4px', fontSize: '14px' }}>
                                {stakes.notDissolvingCount} neurons
                            </div>
                            <div style={{ color: '#888', marginTop: '2px', fontSize: '14px' }}>
                                ({stakes.notDissolvingWithStakeCount} with stake)
                            </div>
                        </div>
                        <div>
                            <div style={{ color: '#888', marginBottom: '8px' }}>Dissolving</div>
                            <div style={{ color: '#f1c40f', fontSize: '24px', fontWeight: 'bold' }}>
                                {formatE8s(stakes.dissolvingStake)} {tokenSymbol}
                                {totalSupply && (
                                    <div style={{ fontSize: '14px', color: '#888', marginTop: '2px' }}>
                                        ({calculatePercentage(stakes.dissolvingStake)}% of supply)
                                    </div>
                                )}
                            </div>
                            <div style={{ color: '#888', marginTop: '4px', fontSize: '14px' }}>
                                {stakes.dissolvingCount} neurons
                            </div>
                            <div style={{ color: '#888', marginTop: '2px', fontSize: '14px' }}>
                                ({stakes.dissolvingWithStakeCount} with stake)
                            </div>
                        </div>
                        <div>
                            <div style={{ color: '#888', marginBottom: '8px' }}>Dissolved</div>
                            <div style={{ color: '#e74c3c', fontSize: '24px', fontWeight: 'bold' }}>
                                {formatE8s(stakes.dissolvedStake)} {tokenSymbol}
                                {totalSupply && (
                                    <div style={{ fontSize: '14px', color: '#888', marginTop: '2px' }}>
                                        ({calculatePercentage(stakes.dissolvedStake)}% of supply)
                                    </div>
                                )}
                            </div>
                            <div style={{ color: '#888', marginTop: '4px', fontSize: '14px' }}>
                                {stakes.dissolvedCount} neurons
                            </div>
                            <div style={{ color: '#888', marginTop: '2px', fontSize: '14px' }}>
                                ({stakes.dissolvedWithStakeCount} with stake)
                            </div>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div style={{ 
                        color: '#ffffff', 
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
                            border: '3px solid #3498db',
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
                            backgroundColor: '#2a2a2a',
                            borderRadius: '4px',
                            overflow: 'hidden',
                            height: '8px',
                            margin: '10px 0'
                        }}>
                            <div style={{
                                width: `${loadingProgress.percent}%`,
                                backgroundColor: '#3498db',
                                height: '100%',
                                transition: 'width 0.3s ease'
                            }} />
                        </div>
                        <div style={{ color: '#888', fontSize: '14px' }}>
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
                                    backgroundColor: '#2a2a2a',
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
                                        <div style={{ color: '#888', marginBottom: '4px' }}>Neuron ID</div>
                                        <div>{formatNeuronIdLink(neuron.id[0].id, selectedSnsRoot)}</div>
                                    </div>
                                    <div>
                                        <div style={{ color: '#888', marginBottom: '4px' }}>Stake</div>
                                        <div style={{ color: '#ffffff', fontSize: '18px', fontWeight: 'bold' }}>
                                            {formatE8s(neuron.cached_neuron_stake_e8s)} {tokenSymbol}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ color: '#888', marginBottom: '4px' }}>Dissolve State</div>
                                        <div style={{ color: '#ffffff' }}>{getDissolveState(neuron)}</div>
                                    </div>
                                    <div>
                                        <div style={{ color: '#888', marginBottom: '4px' }}>Voting Power</div>
                                        <div style={{ color: '#ffffff' }}>
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
                                    backgroundColor: '#3498db',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 16px',
                                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                    opacity: currentPage === 1 ? 0.7 : 1
                                }}
                            >
                                Previous
                            </button>
                            <span style={{ color: '#ffffff', alignSelf: 'center' }}>
                                Page {currentPage} of {Math.ceil(filteredNeurons.length / itemsPerPage)}
                            </span>
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(Math.ceil(filteredNeurons.length / itemsPerPage), prev + 1))}
                                disabled={currentPage === Math.ceil(filteredNeurons.length / itemsPerPage)}
                                style={{
                                    backgroundColor: '#3498db',
                                    color: '#ffffff',
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