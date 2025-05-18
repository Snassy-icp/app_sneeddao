import React, { useState, useEffect } from 'react';
import { useAuth } from '../../AuthContext';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';
import Header from '../../components/Header';
import { useAdminCheck } from '../../hooks/useAdminCheck';

function UserBans() {
    const { isAuthenticated, identity } = useAuth();
    const { isAdmin, loading: adminLoading, error: adminError, loadingComponent, errorComponent } = useAdminCheck({
        identity,
        isAuthenticated,
        redirectPath: '/wallet'
    });

    const [bannedUsers, setBannedUsers] = useState([]);
    const [principalInput, setPrincipalInput] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isAdmin) {
            fetchBans();
        }
    }, [isAdmin, identity]);

    const fetchBans = async () => {
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
            const bans = await backendActor.get_banned_users();
            setBannedUsers(bans);
        } catch (err) {
            console.error('Error fetching bans:', err);
            setError('Failed to fetch banned users');
        } finally {
            setLoading(false);
        }
    };

    const handleBanUser = async (e) => {
        e.preventDefault();
        if (!principalInput.trim()) {
            setError('Please enter a principal ID');
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
            await backendActor.ban_user(principalInput.trim());
            setPrincipalInput('');
            await fetchBans();
        } catch (err) {
            console.error('Error banning user:', err);
            setError('Failed to ban user: ' + err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUnbanUser = async (principal) => {
        setIsSubmitting(true);
        setError('');
        try {
            const backendActor = createBackendActor(backendCanisterId, {
                agentOptions: {
                    identity,
                    host: 'https://ic0.app'
                }
            });
            await backendActor.unban_user(principal);
            await fetchBans();
        } catch (err) {
            console.error('Error unbanning user:', err);
            setError('Failed to unban user: ' + err.message);
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
                <h1 style={{ color: '#ffffff', marginBottom: '30px' }}>User Ban Management</h1>

                <div style={{ backgroundColor: '#2a2a2a', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
                    <form onSubmit={handleBanUser}>
                        <div style={{ marginBottom: '15px' }}>
                            <input
                                type="text"
                                value={principalInput}
                                onChange={(e) => setPrincipalInput(e.target.value)}
                                placeholder="Enter principal ID to ban"
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
                            {isSubmitting ? 'Processing...' : 'Ban User'}
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
                    <h2 style={{ color: '#ffffff', marginBottom: '20px' }}>Banned Users</h2>
                    {loading ? (
                        <div style={{ color: '#888', textAlign: 'center' }}>Loading banned users...</div>
                    ) : bannedUsers.length === 0 ? (
                        <p style={{ color: '#888' }}>No banned users found.</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {bannedUsers.map((principal, index) => (
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
                                    <div style={{ 
                                        color: '#ffffff',
                                        fontFamily: 'monospace',
                                        fontSize: '14px'
                                    }}>
                                        {principal}
                                    </div>
                                    <button
                                        onClick={() => handleUnbanUser(principal)}
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
                                        Unban
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

export default UserBans; 