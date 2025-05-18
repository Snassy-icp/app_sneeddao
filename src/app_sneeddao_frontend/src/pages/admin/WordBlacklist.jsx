import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import Header from '../../components/Header';

export default function WordBlacklist() {
    const { isAuthenticated, identity } = useAuth();
    const navigate = useNavigate();
    const [blacklistedWords, setBlacklistedWords] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [newWord, setNewWord] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Use admin check hook
    useAdminCheck({ identity, isAuthenticated });

    useEffect(() => {
        if (isAuthenticated) {
            fetchBlacklist();
        }
    }, [isAuthenticated]);

    const fetchBlacklist = async () => {
        if (!identity) return;

        setLoading(true);
        try {
            const backendActor = createBackendActor(backendCanisterId, {
                agentOptions: {
                    identity,
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                }
            });
            const result = await backendActor.get_blacklisted_words();
            if ('ok' in result) {
                setBlacklistedWords(result.ok);
                setError('');
            } else {
                setError(result.err);
            }
        } catch (err) {
            console.error('Error fetching blacklist:', err);
            setError('Failed to fetch blacklisted words');
        } finally {
            setLoading(false);
        }
    };

    const handleAddWord = async (e) => {
        e.preventDefault();
        if (!identity || !newWord.trim()) return;

        setIsSubmitting(true);
        try {
            const backendActor = createBackendActor(backendCanisterId, {
                agentOptions: {
                    identity,
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                }
            });
            const result = await backendActor.add_blacklisted_word(newWord.trim());
            if ('ok' in result) {
                await fetchBlacklist();
                setNewWord('');
                setError('');
            } else {
                setError(result.err);
            }
        } catch (err) {
            console.error('Error adding word:', err);
            setError('Failed to add word to blacklist');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRemoveWord = async (word) => {
        if (!identity) return;

        setIsSubmitting(true);
        try {
            const backendActor = createBackendActor(backendCanisterId, {
                agentOptions: {
                    identity,
                    host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
                }
            });
            const result = await backendActor.remove_blacklisted_word(word);
            if ('ok' in result) {
                await fetchBlacklist();
                setError('');
            } else {
                setError(result.err);
            }
        } catch (err) {
            console.error('Error removing word:', err);
            setError('Failed to remove word from blacklist');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>Word Blacklist</h1>

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

                <div style={{ 
                    backgroundColor: '#2a2a2a',
                    borderRadius: '8px',
                    padding: '20px',
                    marginBottom: '20px'
                }}>
                    <form onSubmit={handleAddWord} style={{ 
                        display: 'flex',
                        gap: '10px',
                        marginBottom: '20px'
                    }}>
                        <input
                            type="text"
                            value={newWord}
                            onChange={(e) => setNewWord(e.target.value)}
                            placeholder="Enter word to blacklist"
                            style={{
                                flex: 1,
                                backgroundColor: '#3a3a3a',
                                border: '1px solid #4a4a4a',
                                borderRadius: '4px',
                                color: '#ffffff',
                                padding: '8px 12px'
                            }}
                        />
                        <button
                            type="submit"
                            disabled={isSubmitting || !newWord.trim()}
                            style={{
                                backgroundColor: '#3498db',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                padding: '8px 16px',
                                cursor: isSubmitting || !newWord.trim() ? 'not-allowed' : 'pointer',
                                opacity: isSubmitting || !newWord.trim() ? 0.7 : 1
                            }}
                        >
                            {isSubmitting ? 'Adding...' : 'Add Word'}
                        </button>
                    </form>

                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: '#ffffff' }}>
                            Loading...
                        </div>
                    ) : blacklistedWords.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
                            No words are currently blacklisted.
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={{ 
                                        color: '#ffffff',
                                        textAlign: 'left',
                                        padding: '12px 8px',
                                        borderBottom: '1px solid #4a4a4a'
                                    }}>
                                        Blacklisted Word
                                    </th>
                                    <th style={{ 
                                        color: '#ffffff',
                                        textAlign: 'right',
                                        padding: '12px 8px',
                                        borderBottom: '1px solid #4a4a4a'
                                    }}>
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {blacklistedWords.map((word, index) => (
                                    <tr key={index} style={{
                                        backgroundColor: index % 2 === 0 ? '#2a2a2a' : '#333333'
                                    }}>
                                        <td style={{ 
                                            color: '#ffffff',
                                            padding: '12px 8px'
                                        }}>
                                            {word}
                                        </td>
                                        <td style={{ 
                                            padding: '12px 8px',
                                            textAlign: 'right'
                                        }}>
                                            <button
                                                onClick={() => handleRemoveWord(word)}
                                                disabled={isSubmitting}
                                                style={{
                                                    backgroundColor: '#e74c3c',
                                                    color: '#ffffff',
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    padding: '6px 12px',
                                                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                                    opacity: isSubmitting ? 0.7 : 1
                                                }}
                                            >
                                                {isSubmitting ? 'Removing...' : 'Remove'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </main>
        </div>
    );
} 