import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Header from '../../components/Header';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';

function WordBlacklist() {
    const { identity, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);
    const [blacklistedWords, setBlacklistedWords] = useState([]);
    const [error, setError] = useState('');
    const [newWord, setNewWord] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        const checkAdminStatus = async () => {
            console.log('Checking admin status...');
            console.log('Is authenticated:', isAuthenticated);
            console.log('Identity:', identity);
            
            if (!isAuthenticated || !identity) {
                console.log('Not authenticated, redirecting to wallet...');
                setError('Please connect your wallet first.');
                setTimeout(() => navigate('/wallet'), 2000);
                return;
            }

            try {
                console.log('Creating backend actor...');
                const backendActor = createBackendActor(identity);
                console.log('Calling caller_is_admin...');
                const isAdminResult = await backendActor.caller_is_admin();
                console.log('isAdminResult:', isAdminResult);
                setIsAdmin(isAdminResult);
                
                if (!isAdminResult) {
                    console.log('Not an admin, redirecting...');
                    setError('You do not have admin privileges.');
                    setTimeout(() => navigate('/wallet'), 2000);
                }
            } catch (err) {
                console.error('Error checking admin status:', err);
                setError('Error checking admin status: ' + err.message);
                setTimeout(() => navigate('/wallet'), 2000);
            } finally {
                setLoading(false);
            }
        };

        checkAdminStatus();
    }, [identity, isAuthenticated, navigate]);

    useEffect(() => {
        const fetchBlacklistedWords = async () => {
            if (!identity || !isAdmin) return;

            try {
                const backendActor = createBackendActor(identity);
                const words = await backendActor.get_blacklisted_words();
                setBlacklistedWords(words);
            } catch (err) {
                console.error('Error fetching blacklisted words:', err);
                setError('Failed to fetch blacklisted words');
            }
        };

        fetchBlacklistedWords();
    }, [identity, isAdmin]);

    const handleAddWord = async (e) => {
        e.preventDefault();
        if (!newWord.trim()) return;

        setIsSubmitting(true);
        try {
            const backendActor = createBackendActor(identity);
            const result = await backendActor.add_blacklisted_word(newWord.trim());

            if ('ok' in result) {
                // Refresh word list
                const words = await backendActor.get_blacklisted_words();
                setBlacklistedWords(words);
                // Clear form
                setNewWord('');
                setError('');
            } else {
                setError(result.err);
            }
        } catch (err) {
            console.error('Error adding word:', err);
            setError('Failed to add word');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRemoveWord = async (word) => {
        try {
            const backendActor = createBackendActor(identity);
            const result = await backendActor.remove_blacklisted_word(word);

            if ('ok' in result) {
                // Refresh word list
                const words = await backendActor.get_blacklisted_words();
                setBlacklistedWords(words);
                setError('');
            } else {
                setError(result.err);
            }
        } catch (err) {
            console.error('Error removing word:', err);
            setError('Failed to remove word');
        }
    };

    if (loading) {
        return (
            <div className='page-container'>
                <Header />
                <main className="wallet-container">
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#ffffff' }}>
                        Loading...
                    </div>
                </main>
            </div>
        );
    }

    if (!isAdmin) {
        return null; // Will redirect in useEffect
    }

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>Word Blacklist Management</h1>

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
                    <h2 style={{ color: '#ffffff', marginBottom: '15px' }}>Add Word to Blacklist</h2>
                    <form onSubmit={handleAddWord}>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ color: '#888', display: 'block', marginBottom: '5px' }}>
                                Word
                            </label>
                            <input
                                type="text"
                                value={newWord}
                                onChange={(e) => setNewWord(e.target.value)}
                                style={{
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff',
                                    padding: '8px 12px',
                                    width: '100%'
                                }}
                                placeholder="Enter word to blacklist"
                                required
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            style={{
                                backgroundColor: '#e74c3c',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                padding: '10px 20px',
                                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                opacity: isSubmitting ? 0.7 : 1
                            }}
                        >
                            {isSubmitting ? 'Adding...' : 'Add Word'}
                        </button>
                    </form>
                </div>

                <div style={{ 
                    backgroundColor: '#2a2a2a',
                    borderRadius: '8px',
                    padding: '20px'
                }}>
                    <h2 style={{ color: '#ffffff', marginBottom: '15px' }}>Blacklisted Words</h2>
                    <div style={{ 
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '10px'
                    }}>
                        {blacklistedWords.map((word, index) => (
                            <div
                                key={index}
                                style={{
                                    backgroundColor: '#3a3a3a',
                                    borderRadius: '4px',
                                    padding: '5px 10px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px'
                                }}
                            >
                                <span style={{ color: '#ffffff' }}>{word}</span>
                                <button
                                    onClick={() => handleRemoveWord(word)}
                                    style={{
                                        backgroundColor: 'transparent',
                                        border: 'none',
                                        color: '#e74c3c',
                                        cursor: 'pointer',
                                        padding: '0',
                                        fontSize: '16px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '20px',
                                        height: '20px'
                                    }}
                                    title="Remove word"
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                        {blacklistedWords.length === 0 && (
                            <div style={{ color: '#888', padding: '10px' }}>
                                No words in blacklist
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}

export default WordBlacklist; 