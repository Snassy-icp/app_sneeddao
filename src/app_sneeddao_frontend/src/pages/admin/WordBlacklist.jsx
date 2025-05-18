import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { Principal } from '@dfinity/principal';
import Header from '../../components/Header';
import { createActor } from 'declarations/app_sneeddao_backend';
import { canisterId } from 'declarations/app_sneeddao_backend';

export default function WordBlacklist() {
    const { isAuthenticated, identity } = useAuth();
    const { isAdmin, loading: adminLoading, error: adminError } = useAdminCheck({ identity, isAuthenticated });
    const navigate = useNavigate();

    const [blacklistedWords, setBlacklistedWords] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [newWord, setNewWord] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Create backend actor when identity changes
    const backendActor = React.useMemo(() => {
        if (!identity) return null;
        return createActor(canisterId, {
            agentOptions: {
                identity,
                host: process.env.DFX_NETWORK === 'ic' ? 'https://icp0.io' : 'http://localhost:4943',
            },
        });
    }, [identity]);

    useEffect(() => {
        if (!isAuthenticated) {
            navigate('/wallet');
            return;
        }
        if (identity && backendActor) {
            fetchBlacklist();
        }
    }, [isAuthenticated, identity, backendActor]);

    const fetchBlacklist = async () => {
        if (!identity || !backendActor) return;
        
        setLoading(true);
        setError('');
        try {
            const words = await backendActor.get_blacklisted_words();
            setBlacklistedWords(words);
        } catch (err) {
            setError('Error fetching blacklist: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleAddWord = async (e) => {
        e.preventDefault();
        if (!identity || !backendActor || !newWord.trim()) return;

        setIsSubmitting(true);
        setError('');
        try {
            const result = await backendActor.add_blacklisted_word(newWord.trim());
            if ('ok' in result) {
                setNewWord('');
                await fetchBlacklist();
            } else {
                setError('Failed to add word: ' + result.err);
            }
        } catch (err) {
            setError('Error adding word: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRemoveWord = async (word) => {
        if (!identity || !backendActor) return;

        setIsSubmitting(true);
        setError('');
        try {
            const result = await backendActor.remove_blacklisted_word(word);
            if ('ok' in result) {
                await fetchBlacklist();
            } else {
                setError('Failed to remove word: ' + result.err);
            }
        } catch (err) {
            setError('Error removing word: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (adminLoading) {
        return (
            <div className="container mx-auto px-4 py-8">
                <Header />
                <div className="text-center py-4">Loading...</div>
            </div>
        );
    }

    if (adminError || !isAdmin) {
        return (
            <div className="container mx-auto px-4 py-8">
                <Header />
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    {adminError || "You do not have admin privileges"}
                </div>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8">
            <Header />
            <h1 className="text-3xl font-bold mb-8">Word Blacklist Management</h1>

            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    {error}
                </div>
            )}

            <form onSubmit={handleAddWord} className="mb-8 bg-white shadow-md rounded px-8 pt-6 pb-8">
                <div className="mb-4">
                    <label className="block text-gray-700 text-sm font-bold mb-2">
                        Add Word to Blacklist
                    </label>
                    <input
                        type="text"
                        value={newWord}
                        onChange={(e) => setNewWord(e.target.value)}
                        className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        placeholder="Enter word to blacklist"
                        required
                    />
                </div>

                <button
                    type="submit"
                    disabled={isSubmitting || !newWord.trim()}
                    className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline disabled:opacity-50"
                >
                    {isSubmitting ? 'Adding...' : 'Add Word'}
                </button>
            </form>

            <div className="bg-white shadow-md rounded px-8 pt-6 pb-8">
                <h2 className="text-2xl font-bold mb-4">Currently Blacklisted Words</h2>
                {loading ? (
                    <div className="text-center py-4">Loading blacklisted words...</div>
                ) : blacklistedWords.length === 0 ? (
                    <div className="text-gray-600">No words are currently blacklisted.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full table-auto">
                            <thead>
                                <tr className="bg-gray-100">
                                    <th className="px-4 py-2 text-left">Word</th>
                                    <th className="px-4 py-2 text-left">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {blacklistedWords.map((word) => (
                                    <tr key={word} className="border-b">
                                        <td className="px-4 py-2">{word}</td>
                                        <td className="px-4 py-2">
                                            <button
                                                onClick={() => handleRemoveWord(word)}
                                                disabled={isSubmitting}
                                                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded text-sm focus:outline-none focus:shadow-outline disabled:opacity-50"
                                            >
                                                {isSubmitting ? 'Removing...' : 'Remove'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
} 