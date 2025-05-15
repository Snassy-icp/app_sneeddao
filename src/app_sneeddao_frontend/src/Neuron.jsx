import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { createActor as createSnsGovernanceActor, canisterId as snsGovernanceCanisterId } from 'external/sns_governance';
import { useAuth } from './AuthContext';
import Header from './components/Header';
import './Wallet.css';

function Neuron() {
    const { isAuthenticated, identity } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    const [neuronIdInput, setNeuronIdInput] = useState(searchParams.get('neuronid') || '');
    const [currentNeuronId, setCurrentNeuronId] = useState(searchParams.get('neuronid') || '');
    const [neuronData, setNeuronData] = useState(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (currentNeuronId) {
            fetchNeuronData();
        }
    }, [currentNeuronId]);

    const fetchNeuronData = async () => {
        setLoading(true);
        setError('');
        try {
            const snsGovActor = createSnsGovernanceActor(snsGovernanceCanisterId, {
                agentOptions: {
                    identity,
                },
            });

            // Convert neuron ID string to expected format
            const neuronIdBytes = new TextEncoder().encode(currentNeuronId);
            const neuronIdArg = {
                neuron_id: [{ id: Array.from(neuronIdBytes) }]
            };

            const response = await snsGovActor.get_neuron(neuronIdArg);
            if (response?.result?.[0]?.Neuron) {
                setNeuronData(response.result[0].Neuron);
            } else if (response?.result?.[0]?.Error) {
                setError(response.result[0].Error.error_message);
            } else {
                setError('Neuron not found');
            }
        } catch (err) {
            console.error('Error fetching neuron data:', err);
            setError('Failed to fetch neuron data');
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = (e) => {
        e.preventDefault();
        setError('');
        
        if (!neuronIdInput.trim()) {
            setError('Please enter a neuron ID');
            return;
        }

        // Update URL and trigger search
        setSearchParams({ neuronid: neuronIdInput });
        setCurrentNeuronId(neuronIdInput);
    };

    const formatE8s = (e8s) => {
        return (Number(e8s) / 100000000).toFixed(8);
    };

    const getDissolveState = (dissolveState) => {
        if (!dissolveState) return 'Not dissolving';
        if ('DissolveDelaySeconds' in dissolveState) {
            return `Dissolve delay: ${Math.floor(dissolveState.DissolveDelaySeconds / (24 * 60 * 60))} days`;
        }
        if ('WhenDissolvedTimestampSeconds' in dissolveState) {
            const dissolveDate = new Date(Number(dissolveState.WhenDissolvedTimestampSeconds) * 1000);
            return `Dissolving until: ${dissolveDate.toLocaleString()}`;
        }
        return 'Unknown dissolve state';
    };

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff' }}>Neuron Details</h1>
                
                <section style={{ backgroundColor: '#2a2a2a', borderRadius: '8px', padding: '20px', marginTop: '20px' }}>
                    <form onSubmit={handleSearch} style={{ display: 'flex', alignItems: 'center', marginBottom: '20px', gap: '10px' }}>
                        <input
                            type="text"
                            value={neuronIdInput}
                            onChange={(e) => setNeuronIdInput(e.target.value)}
                            placeholder="Enter Neuron ID"
                            style={{
                                backgroundColor: '#3a3a3a',
                                border: '1px solid #4a4a4a',
                                borderRadius: '4px',
                                color: '#ffffff',
                                padding: '8px 12px',
                                width: '100%',
                                maxWidth: '500px',
                                fontSize: '14px'
                            }}
                        />
                        <button 
                            type="submit" 
                            style={{
                                backgroundColor: '#3498db',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                padding: '8px 16px',
                                cursor: 'pointer',
                                fontSize: '14px'
                            }}
                        >
                            Search
                        </button>
                    </form>
                    {error && <div style={{ color: '#e74c3c', marginTop: '10px' }}>{error}</div>}

                    {loading && (
                        <div style={{ color: '#ffffff', textAlign: 'center', padding: '20px' }}>
                            Loading...
                        </div>
                    )}

                    {neuronData && !loading && (
                        <div style={{ color: '#ffffff' }}>
                            <h2>Neuron Information</h2>
                            <div style={{ backgroundColor: '#3a3a3a', padding: '15px', borderRadius: '6px', marginTop: '10px' }}>
                                <p><strong>Stake:</strong> {formatE8s(neuronData.cached_neuron_stake_e8s)} SNS tokens</p>
                                <p><strong>Created:</strong> {new Date(Number(neuronData.created_timestamp_seconds) * 1000).toLocaleString()}</p>
                                <p><strong>Dissolve State:</strong> {getDissolveState(neuronData.dissolve_state?.[0])}</p>
                                <p><strong>Maturity:</strong> {formatE8s(neuronData.maturity_e8s_equivalent)}</p>
                                <p><strong>Staked Maturity:</strong> {formatE8s(neuronData.staked_maturity_e8s_equivalent?.[0] || 0)}</p>
                                <p><strong>Age Since:</strong> {new Date(Number(neuronData.aging_since_timestamp_seconds) * 1000).toLocaleString()}</p>
                                <p><strong>Auto Stake Maturity:</strong> {neuronData.auto_stake_maturity?.[0] ? 'Yes' : 'No'}</p>
                                <p><strong>Voting Power Multiplier:</strong> {(Number(neuronData.voting_power_percentage_multiplier) / 100).toFixed(2)}x</p>
                            </div>
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}

export default Neuron; 