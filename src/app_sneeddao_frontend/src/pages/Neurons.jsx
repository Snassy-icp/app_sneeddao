import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { createActor as createIcrc1Actor } from 'external/icrc1_ledger';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import { fetchAndCacheSnsData, getSnsById } from '../utils/SnsUtils';
import { formatNeuronIdLink, formatE8s, getDissolveState } from '../utils/NeuronUtils';
import { Actor, HttpAgent } from '@dfinity/agent';

function Neurons() {
    const { identity } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const SNEED_SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
    const [selectedSnsRoot, setSelectedSnsRoot] = useState(searchParams.get('sns') || SNEED_SNS_ROOT);
    const [snsList, setSnsList] = useState([]);
    const [neurons, setNeurons] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [tokenSymbol, setTokenSymbol] = useState('SNS');
    const [totalSupply, setTotalSupply] = useState(null);
    
    // Pagination state
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [currentPage, setCurrentPage] = useState(1);

    // Listen for URL parameter changes
    useEffect(() => {
        const snsParam = searchParams.get('sns');
        if (snsParam && snsParam !== selectedSnsRoot) {
            setSelectedSnsRoot(snsParam);
            setCurrentPage(1);
            setNeurons([]);
        }
    }, [searchParams]);

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
        if (selectedSnsRoot) {
            fetchNeurons();
            fetchTotalSupply();
        }
    }, [selectedSnsRoot]);

    const fetchNeurons = async () => {
        setLoading(true);
        setError('');
        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) {
                setError('Selected SNS not found');
                return;
            }

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

            while (hasMore) {
                console.log('Fetching neurons page, starting from:', lastNeuron);
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

            console.log(`Fetched total of ${allNeurons.length} neurons`);
            
            // Sort neurons by stake (highest first)
            const sortedNeurons = allNeurons.sort((a, b) => {
                const stakeA = BigInt(a.cached_neuron_stake_e8s || 0);
                const stakeB = BigInt(b.cached_neuron_stake_e8s || 0);
                return stakeB > stakeA ? 1 : stakeB < stakeA ? -1 : 0;
            });

            setNeurons(sortedNeurons);

            // Get token symbol
            const icrc1Actor = createIcrc1Actor(selectedSns.canisters.ledger, { agent });
            const metadata = await icrc1Actor.icrc1_metadata();
            const symbolEntry = metadata.find(entry => entry[0] === 'icrc1:symbol');
            if (symbolEntry && symbolEntry[1]) {
                setTokenSymbol(symbolEntry[1].Text);
            }
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

    const handleSnsChange = (newSnsRoot) => {
        // Update URL parameter
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.set('sns', newSnsRoot);
        navigate(`${location.pathname}?${newSearchParams.toString()}`);
        
        // Update state
        setSelectedSnsRoot(newSnsRoot);
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

    // Get paginated neurons
    const paginatedNeurons = neurons.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
    const totalPages = Math.ceil(neurons.length / itemsPerPage);

    return (
        <div className='page-container'>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            <main className="wallet-container">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h1 style={{ color: '#ffffff' }}>Neurons</h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                    <div style={{ color: '#ffffff', textAlign: 'center', padding: '20px' }}>
                        Loading...
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
                                            {(Number(neuron.voting_power_percentage_multiplier) / 100).toFixed(2)}x
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
                                Page {currentPage} of {totalPages}
                            </span>
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                disabled={currentPage === totalPages}
                                style={{
                                    backgroundColor: '#3498db',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '8px 16px',
                                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                                    opacity: currentPage === totalPages ? 0.7 : 1
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