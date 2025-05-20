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

    // Calculate total stake
    const totalStake = neurons.reduce((sum, neuron) => sum + BigInt(neuron.cached_neuron_stake_e8s || 0), BigInt(0));

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

                {/* Total Stake Display */}
                <div style={{ 
                    backgroundColor: '#2a2a2a',
                    borderRadius: '8px',
                    padding: '20px',
                    marginBottom: '20px',
                    textAlign: 'center'
                }}>
                    <div style={{ color: '#888', marginBottom: '8px' }}>Total Stake</div>
                    <div style={{ 
                        color: '#ffffff',
                        fontSize: '24px',
                        fontWeight: 'bold'
                    }}>
                        {formatE8s(totalStake)} {tokenSymbol}
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