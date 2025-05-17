import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import { fetchAndCacheSnsData, getSnsById } from '../utils/SnsUtils';
import { fetchUserNeurons } from '../utils/NeuronUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';

function Me() {
    const { isAuthenticated, identity } = useAuth();
    const navigate = useNavigate();
    const [selectedSnsRoot, setSelectedSnsRoot] = useState('fp274-iaaaa-aaaaq-aacha-cai'); // Default to Sneed
    const [snsList, setSnsList] = useState([]);
    const [neurons, setNeurons] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [isNeuronsExpanded, setIsNeuronsExpanded] = useState(true);

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

        if (isAuthenticated) {
            loadSnsData();
        }
    }, [isAuthenticated, identity]);

    // Fetch neurons when SNS changes
    useEffect(() => {
        if (selectedSnsRoot && isAuthenticated) {
            fetchNeuronData();
        }
    }, [selectedSnsRoot, isAuthenticated]);

    const fetchNeuronData = async () => {
        setLoading(true);
        setError('');
        try {
            const selectedSns = getSnsById(selectedSnsRoot);
            if (!selectedSns) {
                setError('Selected SNS not found');
                return;
            }

            const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                agentOptions: {
                    identity,
                },
            });

            // Get the list of neurons for this user
            const neuronIds = await fetchUserNeurons(identity);
            
            // Fetch details for each neuron
            const neuronDetails = await Promise.all(
                neuronIds.map(async (neuronId) => {
                    try {
                        const response = await snsGovActor.get_neuron({
                            neuron_id: [{ id: neuronId }]
                        });
                        if (response?.result?.[0]?.Neuron) {
                            return response.result[0].Neuron;
                        }
                        return null;
                    } catch (err) {
                        console.error('Error fetching neuron details:', err);
                        return null;
                    }
                })
            );

            // Filter out any failed fetches
            setNeurons(neuronDetails.filter(n => n !== null));
        } catch (err) {
            console.error('Error fetching neurons:', err);
            setError('Failed to fetch neurons');
        } finally {
            setLoading(false);
        }
    };

    const handleSnsChange = (e) => {
        const newSnsRoot = e.target.value;
        setSelectedSnsRoot(newSnsRoot);
    };

    const formatE8s = (e8s) => {
        return (Number(e8s) / 100000000).toFixed(8);
    };

    const getDissolveState = (neuron) => {
        if (!neuron.dissolve_state?.[0]) return 'Unknown';
        
        if ('DissolveDelaySeconds' in neuron.dissolve_state[0]) {
            const seconds = Number(neuron.dissolve_state[0].DissolveDelaySeconds);
            const days = Math.floor(seconds / (24 * 60 * 60));
            return `Locked for ${days} days`;
        }
        
        if ('WhenDissolvedTimestampSeconds' in neuron.dissolve_state[0]) {
            const dissolveTime = Number(neuron.dissolve_state[0].WhenDissolvedTimestampSeconds);
            const now = Math.floor(Date.now() / 1000);
            if (dissolveTime <= now) {
                return 'Dissolved';
            }
            const daysLeft = Math.floor((dissolveTime - now) / (24 * 60 * 60));
            return `Dissolving (${daysLeft} days left)`;
        }
        
        return 'Unknown';
    };

    const formatNeuronId = (neuronId) => {
        if (!neuronId) return 'Unknown';
        return Array.from(neuronId).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    return (
        <div className='page-container'>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff' }}>My Profile</h1>
                
                <section style={{ backgroundColor: '#2a2a2a', borderRadius: '8px', padding: '20px', marginTop: '20px' }}>
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        marginBottom: '15px'
                    }}>
                        <h2 style={{ color: '#ffffff', margin: 0 }}>
                            My Neurons
                            <span style={{ 
                                marginLeft: '10px',
                                fontSize: '14px',
                                color: '#888',
                                fontWeight: 'normal'
                            }}>
                                ({neurons.length} found)
                            </span>
                        </h2>
                        <button 
                            onClick={() => setIsNeuronsExpanded(!isNeuronsExpanded)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#888',
                                cursor: 'pointer',
                                fontSize: '20px',
                                padding: '5px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transform: isNeuronsExpanded ? 'rotate(90deg)' : 'none',
                                transition: 'transform 0.3s ease'
                            }}
                        >
                            ▶
                        </button>
                    </div>

                    {error && <div style={{ color: '#e74c3c', marginBottom: '20px' }}>{error}</div>}

                    {loading ? (
                        <div style={{ color: '#ffffff', textAlign: 'center', padding: '20px' }}>
                            Loading...
                        </div>
                    ) : isNeuronsExpanded && neurons.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            {neurons.map((neuron, index) => (
                                <div
                                    key={index}
                                    style={{
                                        backgroundColor: '#3a3a3a',
                                        borderRadius: '6px',
                                        padding: '15px'
                                    }}
                                >
                                    <div style={{ 
                                        display: 'flex', 
                                        justifyContent: 'space-between',
                                        alignItems: 'flex-start',
                                        marginBottom: '10px',
                                        borderBottom: '1px solid #4a4a4a',
                                        paddingBottom: '10px'
                                    }}>
                                        <div style={{ 
                                            fontFamily: 'monospace',
                                            wordBreak: 'break-all'
                                        }}>
                                            <Link 
                                                to={`/neuron?neuronid=${formatNeuronId(neuron.id[0].id)}&sns=${selectedSnsRoot}`}
                                                style={{ 
                                                    color: '#3498db',
                                                    textDecoration: 'none'
                                                }}
                                            >
                                                {formatNeuronId(neuron.id[0].id)}
                                            </Link>
                                        </div>
                                        <div style={{ color: '#2ecc71' }}>
                                            {formatE8s(neuron.cached_neuron_stake_e8s)} {getSnsById(selectedSnsRoot)?.name || 'SNS'}
                                        </div>
                                    </div>
                                    <div style={{ 
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                        gap: '10px',
                                        fontSize: '14px',
                                        color: '#888'
                                    }}>
                                        <div>
                                            <strong>Created:</strong>{' '}
                                            {new Date(Number(neuron.created_timestamp_seconds || 0) * 1000).toLocaleString()}
                                        </div>
                                        <div>
                                            <strong>State:</strong>{' '}
                                            {getDissolveState(neuron)}
                                        </div>
                                        <div>
                                            <strong>Maturity:</strong>{' '}
                                            {formatE8s(neuron.maturity_e8s_equivalent)} {getSnsById(selectedSnsRoot)?.name || 'SNS'}
                                        </div>
                                        <div>
                                            <strong>Voting Power:</strong>{' '}
                                            {(Number(neuron.voting_power_percentage_multiplier || 0) / 100).toFixed(2)}x
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : !loading && neurons.length === 0 ? (
                        <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
                            No neurons found for the selected SNS.
                        </div>
                    ) : null}
                </section>
            </main>
        </div>
    );
}

export default Me; 