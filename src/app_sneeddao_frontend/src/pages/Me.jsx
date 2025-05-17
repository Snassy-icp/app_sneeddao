import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { fetchAndCacheSnsData, getSnsById } from '../utils/SnsUtils';
import { 
    fetchUserNeuronsForSns, 
    formatE8s, 
    getDissolveState, 
    formatNeuronIdLink,
    uint8ArrayToHex
} from '../utils/NeuronUtils';

export default function Me() {
    const { identity } = useAuth();
    const navigate = useNavigate();
    const [selectedSnsRoot, setSelectedSnsRoot] = useState('');
    const [snsList, setSnsList] = useState([]);
    const [neurons, setNeurons] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [isNeuronsExpanded, setIsNeuronsExpanded] = useState(true);

    // Fetch SNS data on component mount
    useEffect(() => {
        const fetchSnsData = async () => {
            try {
                const data = await fetchAndCacheSnsData();
                setSnsList(data);
                // Default to Sneed SNS
                const sneedSns = data.find(sns => sns.name === 'Sneed');
                if (sneedSns) {
                    setSelectedSnsRoot(sneedSns.root_canister_id);
                }
            } catch (err) {
                console.error('Error fetching SNS data:', err);
                setError('Failed to load SNS data');
            } finally {
                setLoadingSnses(false);
            }
        };
        fetchSnsData();
    }, []);

    // Fetch neurons when selected SNS changes
    useEffect(() => {
        const fetchNeurons = async () => {
            if (!identity || !selectedSnsRoot) return;
            
            setLoading(true);
            setError(null);
            try {
                const selectedSns = getSnsById(selectedSnsRoot);
                if (!selectedSns) {
                    throw new Error('Selected SNS not found');
                }
                
                const neuronsList = await fetchUserNeuronsForSns(identity, selectedSns.governance_canister_id);
                setNeurons(neuronsList);
            } catch (err) {
                console.error('Error fetching neurons:', err);
                setError('Failed to load neurons');
            } finally {
                setLoading(false);
            }
        };
        fetchNeurons();
    }, [identity, selectedSnsRoot]);

    const handleSnsChange = (e) => {
        setSelectedSnsRoot(e.target.value);
    };

    if (!identity) {
        return (
            <div className='page-container'>
                <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
                <main className="wallet-container">
                    <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>Please Connect Your Wallet</h1>
                        <p style={{ color: '#888' }}>You need to connect your wallet to view your neurons.</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container'>
            <Header showSnsDropdown={true} onSnsChange={handleSnsChange} />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>My Neurons</h1>

                {error && (
                    <div style={{ 
                        backgroundColor: 'rgba(231, 76, 60, 0.2)', 
                        border: '1px solid #e74c3c',
                        color: '#e74c3c',
                        padding: '15px',
                        borderRadius: '6px',
                        marginBottom: '20px'
                    }}>
                        {error}
                    </div>
                )}

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#ffffff' }}>
                        Loading...
                    </div>
                ) : neurons.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#888' }}>
                        <p>No neurons found for this SNS.</p>
                    </div>
                ) : (
                    <div>
                        <div style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            marginBottom: '20px'
                        }}>
                            <h2 style={{ color: '#ffffff', margin: 0 }}>
                                {neurons.length} Neuron{neurons.length !== 1 ? 's' : ''}
                            </h2>
                            <button
                                onClick={() => setIsNeuronsExpanded(!isNeuronsExpanded)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#3498db',
                                    cursor: 'pointer',
                                    fontSize: '14px'
                                }}
                            >
                                {isNeuronsExpanded ? 'Collapse All' : 'Expand All'}
                            </button>
                        </div>
                        
                        <div style={{ 
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                            gap: '20px'
                        }}>
                            {neurons.map((neuron) => {
                                const neuronId = neuron.id[0]?.id;
                                if (!neuronId) return null;

                                return (
                                    <div
                                        key={uint8ArrayToHex(neuronId)}
                                        style={{
                                            backgroundColor: '#2a2a2a',
                                            borderRadius: '8px',
                                            padding: '20px',
                                            border: '1px solid #3a3a3a'
                                        }}
                                    >
                                        <div style={{ marginBottom: '15px' }}>
                                            <div style={{ marginBottom: '5px' }}>
                                                {formatNeuronIdLink(neuronId, selectedSnsRoot)}
                                            </div>
                                            <div style={{ 
                                                fontSize: '24px',
                                                fontWeight: 'bold',
                                                color: '#3498db'
                                            }}>
                                                {formatE8s(neuron.cached_neuron_stake_e8s)} SNS
                                            </div>
                                        </div>

                                        <div style={{ 
                                            display: 'grid',
                                            gridTemplateColumns: '1fr 1fr',
                                            gap: '15px',
                                            fontSize: '14px'
                                        }}>
                                            <div>
                                                <div style={{ color: '#888' }}>Created</div>
                                                <div style={{ color: '#ffffff' }}>
                                                    {new Date(Number(neuron.created_timestamp_seconds) * 1000).toLocaleDateString()}
                                                </div>
                                            </div>
                                            <div>
                                                <div style={{ color: '#888' }}>Dissolve State</div>
                                                <div style={{ color: '#ffffff' }}>{getDissolveState(neuron)}</div>
                                            </div>
                                            <div>
                                                <div style={{ color: '#888' }}>Maturity</div>
                                                <div style={{ color: '#ffffff' }}>{formatE8s(neuron.maturity_e8s_equivalent)} SNS</div>
                                            </div>
                                            <div>
                                                <div style={{ color: '#888' }}>Voting Power</div>
                                                <div style={{ color: '#ffffff' }}>{(Number(neuron.voting_power_percentage_multiplier) / 100).toFixed(2)}x</div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
} 