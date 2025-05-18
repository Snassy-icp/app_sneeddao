import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import Header from '../../components/Header';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';

function UserBans() {
    const { identity, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);
    const [banLog, setBanLog] = useState([]);
    const [error, setError] = useState('');
    const [newBanPrincipal, setNewBanPrincipal] = useState('');
    const [newBanDuration, setNewBanDuration] = useState('24');
    const [newBanReason, setNewBanReason] = useState('');
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
                const backendActor = createBackendActor(backendCanisterId, {
                    agentOptions: {
                        identity,
                        host: 'https://ic0.app'
                    }
                });
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
        const fetchBanLog = async () => {
            if (!identity || !isAdmin) return;

            try {
                const backendActor = createBackendActor(identity);
                const result = await backendActor.get_ban_log();
                if ('ok' in result) {
                    setBanLog(result.ok);
                } else {
                    setError(result.err);
                }
            } catch (err) {
                console.error('Error fetching ban log:', err);
                setError('Failed to fetch ban log');
            }
        };

        fetchBanLog();
    }, [identity, isAdmin]);

    const handleBanUser = async (e) => {
        e.preventDefault();
        if (!newBanPrincipal || !newBanDuration || !newBanReason) return;

        setIsSubmitting(true);
        try {
            const backendActor = createBackendActor(identity);
            const result = await backendActor.ban_user(
                newBanPrincipal,
                Number(newBanDuration),
                newBanReason
            );

            if ('ok' in result) {
                // Refresh ban log
                const logResult = await backendActor.get_ban_log();
                if ('ok' in logResult) {
                    setBanLog(logResult.ok);
                }
                // Clear form
                setNewBanPrincipal('');
                setNewBanDuration('24');
                setNewBanReason('');
                setError('');
            } else {
                setError(result.err);
            }
        } catch (err) {
            console.error('Error banning user:', err);
            setError('Failed to ban user');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUnbanUser = async (principal) => {
        try {
            const backendActor = createBackendActor(identity);
            const result = await backendActor.unban_user(principal);

            if ('ok' in result) {
                // Refresh ban log
                const logResult = await backendActor.get_ban_log();
                if ('ok' in logResult) {
                    setBanLog(logResult.ok);
                }
                setError('');
            } else {
                setError(result.err);
            }
        } catch (err) {
            console.error('Error unbanning user:', err);
            setError('Failed to unban user');
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
                <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>User Ban Management</h1>

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
                    <h2 style={{ color: '#ffffff', marginBottom: '15px' }}>Ban User</h2>
                    <form onSubmit={handleBanUser}>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ color: '#888', display: 'block', marginBottom: '5px' }}>
                                User Principal
                            </label>
                            <input
                                type="text"
                                value={newBanPrincipal}
                                onChange={(e) => setNewBanPrincipal(e.target.value)}
                                style={{
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff',
                                    padding: '8px 12px',
                                    width: '100%'
                                }}
                                placeholder="Enter user principal"
                                required
                            />
                        </div>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ color: '#888', display: 'block', marginBottom: '5px' }}>
                                Duration (hours)
                            </label>
                            <input
                                type="number"
                                value={newBanDuration}
                                onChange={(e) => setNewBanDuration(e.target.value)}
                                style={{
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff',
                                    padding: '8px 12px',
                                    width: '100%'
                                }}
                                min="1"
                                required
                            />
                        </div>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ color: '#888', display: 'block', marginBottom: '5px' }}>
                                Reason
                            </label>
                            <textarea
                                value={newBanReason}
                                onChange={(e) => setNewBanReason(e.target.value)}
                                style={{
                                    backgroundColor: '#3a3a3a',
                                    border: '1px solid #4a4a4a',
                                    borderRadius: '4px',
                                    color: '#ffffff',
                                    padding: '8px 12px',
                                    width: '100%',
                                    minHeight: '100px'
                                }}
                                placeholder="Enter ban reason"
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
                            {isSubmitting ? 'Banning...' : 'Ban User'}
                        </button>
                    </form>
                </div>

                <div style={{ 
                    backgroundColor: '#2a2a2a',
                    borderRadius: '8px',
                    padding: '20px'
                }}>
                    <h2 style={{ color: '#ffffff', marginBottom: '15px' }}>Ban History</h2>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ 
                            width: '100%',
                            borderCollapse: 'collapse',
                            color: '#ffffff'
                        }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #3a3a3a' }}>
                                    <th style={{ padding: '10px', textAlign: 'left' }}>User</th>
                                    <th style={{ padding: '10px', textAlign: 'left' }}>Admin</th>
                                    <th style={{ padding: '10px', textAlign: 'left' }}>Reason</th>
                                    <th style={{ padding: '10px', textAlign: 'left' }}>Ban Date</th>
                                    <th style={{ padding: '10px', textAlign: 'left' }}>Expiry Date</th>
                                    <th style={{ padding: '10px', textAlign: 'left' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {banLog.map((entry, index) => {
                                    const now = Date.now() * 1000000; // Convert to nanoseconds
                                    const isExpired = entry.expiry_timestamp <= now;
                                    const isUnban = entry.ban_timestamp === entry.expiry_timestamp;

                                    return (
                                        <tr 
                                            key={index}
                                            style={{ 
                                                borderBottom: '1px solid #3a3a3a',
                                                backgroundColor: isUnban ? 'rgba(46, 204, 113, 0.1)' : isExpired ? 'rgba(149, 165, 166, 0.1)' : 'rgba(231, 76, 60, 0.1)'
                                            }}
                                        >
                                            <td style={{ padding: '10px', fontFamily: 'monospace' }}>
                                                {entry.user.toString()}
                                            </td>
                                            <td style={{ padding: '10px', fontFamily: 'monospace' }}>
                                                {entry.admin.toString()}
                                            </td>
                                            <td style={{ padding: '10px' }}>{entry.reason}</td>
                                            <td style={{ padding: '10px' }}>
                                                {new Date(Number(entry.ban_timestamp) / 1000000).toLocaleString()}
                                            </td>
                                            <td style={{ padding: '10px' }}>
                                                {new Date(Number(entry.expiry_timestamp) / 1000000).toLocaleString()}
                                            </td>
                                            <td style={{ padding: '10px' }}>
                                                {!isExpired && !isUnban && (
                                                    <button
                                                        onClick={() => handleUnbanUser(entry.user)}
                                                        style={{
                                                            backgroundColor: '#2ecc71',
                                                            color: '#ffffff',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            padding: '5px 10px',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        Unban
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default UserBans; 