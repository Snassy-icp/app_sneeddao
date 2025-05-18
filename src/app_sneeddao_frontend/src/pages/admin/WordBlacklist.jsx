import React, { useState, useEffect } from 'react';
import { useAuth } from '../../AuthContext';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import Header from '../../components/Header';
import { useAdminCheck } from '../../hooks/useAdminCheck';

function WordBlacklist() {
    const { isAuthenticated, identity } = useAuth();
    const { isAdmin, loading: adminLoading, error: adminError, loadingComponent, errorComponent } = useAdminCheck({
        identity,
        isAuthenticated,
        redirectPath: '/wallet'
    });

    const [blacklistedWords, setBlacklistedWords] = useState([]);
    const [newWord, setNewWord] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isAdmin) {
            fetchBlacklist();
        }
    }, [isAdmin, identity]);

    const fetchBlacklist = async () => {
        if (!identity) return;
        setLoading(true);
        setError('');
        try {
            const backendActor = createBackendActor(backendCanisterId, {
                agentOptions: {
                    identity,
                    host: 'https://ic0.app'
                }
            });
            const words = await backendActor.get_blacklisted_words();
            setBlacklistedWords(words);
        } catch (err) {
            console.error('Error fetching blacklist:', err);
            setError('Failed to fetch blacklisted words');
        } finally {
            setLoading(false);
        }
    };

    const handleAddWord = async (e) => {
        e.preventDefault();
        if (!newWord.trim()) {
            setError('Please enter a word');
            return;
        }

        setIsSubmitting(true);
        setError('');
        try {
            const backendActor = createBackendActor(backendCanisterId, {
                agentOptions: {
                    identity,
                    host: 'https://ic0.app'
                }
            });
            await backendActor.add_blacklisted_word(newWord.trim().toLowerCase());
            setNewWord('');
            await fetchBlacklist();
        } catch (err) {
            console.error('Error adding word:', err);
            setError('Failed to add word: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRemoveWord = async (word) => {
        setIsSubmitting(true);
        setError('');
        try {
            const backendActor = createBackendActor(backendCanisterId, {
                agentOptions: {
                    identity,
                    host: 'https://ic0.app'
                }
            });
            await backendActor.remove_blacklisted_word(word);
            await fetchBlacklist();
        } catch (err) {
            console.error('Error removing word:', err);
            setError('Failed to remove word: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (adminLoading) {
        return (
            <div className='page-container'>
                <Header />
                <main className="wallet-container">
                    <div style={loadingComponent.style}>
                        {loadingComponent.text}
                    </div>
                </main>
            </div>
        );
    }

    if (adminError) {
        return (
            <div className='page-container'>
                <Header />
                <main className="wallet-container">
                    <div style={errorComponent.style}>
                        {errorComponent.text}
                    </div>
                </main>
            </div>
        );
    }

    if (!isAdmin) {
        return null;
    }

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff', marginBottom: '30px' }}>Word Blacklist Management</h1>

                <div style={{ backgroundColor: '#2a2a2a', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
                    <form onSubmit={handleAddWord}>
                        <div style={{ marginBottom: '15px' }}>
                            <input
                                type="text"
                                value={newWord}
                                onChange={(e) => setNewWord(e.target.value)}
                                placeholder="Enter word to blacklist"
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff'
                                }}
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            style={{
                                backgroundColor: '#e74c3c',
                                color: '#ffffff',
                                border: 'none',
                                padding: '10px 20px',
                                borderRadius: '4px',
                                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                opacity: isSubmitting ? 0.7 : 1
                            }}
                        >
                            {isSubmitting ? 'Processing...' : 'Add Word'}
                        </button>
                    </form>
                </div>

                {error && (
                    <div style={{
                        backgroundColor: 'rgba(231, 76, 60, 0.1)',
                        border: '1px solid #e74c3c',
                        color: '#e74c3c',
                        padding: '15px',
                        borderRadius: '4px',
                        marginBottom: '20px'
                    }}>
                        {error}
                    </div>
                )}

                <div style={{ backgroundColor: '#2a2a2a', padding: '20px', borderRadius: '8px' }}>
                    <h2 style={{ color: '#ffffff', marginBottom: '20px' }}>Blacklisted Words</h2>
                    {loading ? (
                        <div style={{ color: '#888', textAlign: 'center' }}>Loading blacklisted words...</div>
                    ) : blacklistedWords.length === 0 ? (
                        <p style={{ color: '#888' }}>No blacklisted words found.</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {blacklistedWords.map((word, index) => (
                                <div
                                    key={index}
                                    style={{
                                        backgroundColor: '#3a3a3a',
                                        padding: '15px',
                                        borderRadius: '4px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                >
                                    <div style={{ color: '#ffffff' }}>
                                        {word}
                                    </div>
                                    <button
                                        onClick={() => handleRemoveWord(word)}
                                        disabled={isSubmitting}
                                        style={{
                                            backgroundColor: '#3498db',
                                            color: '#ffffff',
                                            border: 'none',
                                            padding: '8px 16px',
                                            borderRadius: '4px',
                                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                            opacity: isSubmitting ? 0.7 : 1
                                        }}
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default WordBlacklist; 