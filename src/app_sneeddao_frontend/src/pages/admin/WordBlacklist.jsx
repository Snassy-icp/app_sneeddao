import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';
import Header from '../../components/Header';

export default function WordBlacklist() {
    const { isAuthenticated, identity } = useAuth();
    const navigate = useNavigate();
    const [blacklistedWords, setBlacklistedWords] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [newWord, setNewWord] = useState('');

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
            const backendActor = createBackendActor(identity);
            const result = await backendActor.get_blacklisted_words();
            setBlacklistedWords(result);
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

        setLoading(true);
        try {
            const backendActor = createBackendActor(identity);
            const result = await backendActor.add_blacklisted_word(newWord.trim());
            if ('ok' in result) {
                await fetchBlacklist();
                setNewWord('');
                setError(null);
            } else {
                setError(result.err);
            }
        } catch (err) {
            console.error('Error adding word:', err);
            setError('Failed to add word to blacklist');
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveWord = async (word) => {
        if (!identity) return;

        setLoading(true);
        try {
            const backendActor = createBackendActor(identity);
            const result = await backendActor.remove_blacklisted_word(word);
            if ('ok' in result) {
                await fetchBlacklist();
                setError(null);
            } else {
                setError(result.err);
            }
        } catch (err) {
            console.error('Error removing word:', err);
            setError('Failed to remove word from blacklist');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className='page-container'>
            <Header />
            <main className="wallet-container">
                <h1 style={{ color: '#ffffff' }}>Word Blacklist Management</h1>
                
                <section style={{ backgroundColor: '#2a2a2a', borderRadius: '8px', padding: '20px', marginTop: '20px' }}>
                    <form onSubmit={handleAddWord} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ color: '#ffffff' }}>Word to Blacklist</label>
                            <input
                                type="text"
                                value={newWord}
                                onChange={(e) => setNewWord(e.target.value)}
                                placeholder="Enter word to blacklist"
                                style={{
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff',
                                    padding: '8px 12px',
                                    width: '100%',
                                    fontSize: '14px'
                                }}
                            />
                        </div>

                        <button 
                            type="submit" 
                            disabled={loading}
                            style={{
                                backgroundColor: '#3498db',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '4px',
                                padding: '10px 16px',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                fontSize: '14px',
                                opacity: loading ? 0.7 : 1
                            }}
                        >
                            Add Word
                        </button>
                    </form>

                    {error && (
                        <div style={{ 
                            color: '#e74c3c', 
                            backgroundColor: 'rgba(231, 76, 60, 0.1)', 
                            padding: '10px', 
                            borderRadius: '4px',
                            marginTop: '15px' 
                        }}>
                            {error}
                        </div>
                    )}

                    <div style={{ marginTop: '30px' }}>
                        <h2 style={{ color: '#ffffff', marginBottom: '15px' }}>Currently Blacklisted Words</h2>
                        {loading ? (
                            <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>Loading...</div>
                        ) : blacklistedWords.length === 0 ? (
                            <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>No words are currently blacklisted.</div>
                        ) : (
                            <div style={{ 
                                backgroundColor: '#3a3a3a',
                                borderRadius: '6px',
                                overflow: 'hidden'
                            }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ backgroundColor: '#2c3e50' }}>
                                            <th style={{ padding: '12px', color: '#ffffff', textAlign: 'left' }}>Word</th>
                                            <th style={{ padding: '12px', color: '#ffffff', textAlign: 'right' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {blacklistedWords.map((word, index) => (
                                            <tr 
                                                key={word}
                                                style={{ 
                                                    borderTop: '1px solid #4a4a4a',
                                                    backgroundColor: index % 2 === 0 ? '#2a2a2a' : '#323232'
                                                }}
                                            >
                                                <td style={{ padding: '12px', color: '#ffffff' }}>{word}</td>
                                                <td style={{ padding: '12px', textAlign: 'right' }}>
                                                    <button
                                                        onClick={() => handleRemoveWord(word)}
                                                        style={{
                                                            backgroundColor: '#e74c3c',
                                                            color: '#ffffff',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            padding: '6px 12px',
                                                            cursor: 'pointer',
                                                            fontSize: '14px'
                                                        }}
                                                    >
                                                        Remove
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </section>
            </main>
        </div>
    );
} 