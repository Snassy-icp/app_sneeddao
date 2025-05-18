import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import { createActor as createBackendActor, canisterId as backendCanisterId } from 'declarations/app_sneeddao_backend';

// Define status states
const STATUS = {
    LOADING: 'LOADING',
    CHECKING_AUTH: 'CHECKING_AUTH',
    CHECKING_ADMIN: 'CHECKING_ADMIN',
    NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
    NOT_ADMIN: 'NOT_ADMIN',
    ADMIN: 'ADMIN',
    ERROR: 'ERROR'
};

function Admin() {
    const { isAuthenticated, identity } = useAuth();
    const navigate = useNavigate();
    const [status, setStatus] = useState(STATUS.LOADING);
    const [error, setError] = useState(null);

    useEffect(() => {
        let mounted = true;
        let timeoutId = null;

        const checkAdminStatus = async () => {
            if (!mounted) return;
            
            setStatus(STATUS.CHECKING_ADMIN);
            console.log('Checking admin status...');
            console.log('Is authenticated:', isAuthenticated);
            console.log('Identity:', identity);

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

                if (!mounted) return;

                if (isAdminResult) {
                    setStatus(STATUS.ADMIN);
                } else {
                    console.log('Not an admin, redirecting...');
                    setError('You do not have admin privileges.');
                    setStatus(STATUS.NOT_ADMIN);
                    timeoutId = setTimeout(() => navigate('/'), 2000);
                }
            } catch (err) {
                console.error('Error checking admin status:', err);
                if (mounted) {
                    setError('Error checking admin status: ' + err.message);
                    setStatus(STATUS.ERROR);
                    timeoutId = setTimeout(() => navigate('/'), 2000);
                }
            }
        };

        const checkAuth = () => {
            // If authentication state is not yet determined, stay in loading
            if (typeof isAuthenticated === 'undefined') {
                setStatus(STATUS.LOADING);
                return;
            }

            // If not authenticated, wait a short time before redirecting
            if (!isAuthenticated || !identity) {
                setStatus(STATUS.CHECKING_AUTH);
                timeoutId = setTimeout(() => {
                    if (mounted && (!isAuthenticated || !identity)) {
                        console.log('Still not authenticated after delay, redirecting to wallet...');
                        setError('Please connect your wallet first.');
                        setStatus(STATUS.NOT_AUTHENTICATED);
                        navigate('/wallet');
                    }
                }, 1000);
                return;
            }

            // If we get here, we're authenticated and ready to check admin status
            checkAdminStatus();
        };

        checkAuth();

        return () => {
            mounted = false;
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        };
    }, [identity, isAuthenticated, navigate]);

    if (status === STATUS.LOADING || status === STATUS.CHECKING_AUTH || status === STATUS.CHECKING_ADMIN) {
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

    if (error) {
        return (
            <div className='page-container'>
                <Header />
                <main className="wallet-container">
                    <div style={{ 
                        textAlign: 'center', 
                        padding: '40px 20px', 
                        color: '#e74c3c',
                        backgroundColor: 'rgba(231, 76, 60, 0.1)',
                        borderRadius: '8px',
                        margin: '20px'
                    }}>
                        {error}
                    </div>
                </main>
            </div>
        );
    }

    if (status === STATUS.ADMIN) {
        return (
            <div className='page-container'>
                <Header />
                <main className="wallet-container">
                    <h1 style={{ color: '#ffffff', marginBottom: '30px' }}>Admin Dashboard</h1>

                    <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                        gap: '20px',
                        padding: '20px 0'
                    }}>
                        <Link 
                            to="/admin/users/bans"
                            style={{
                                backgroundColor: '#2a2a2a',
                                borderRadius: '8px',
                                padding: '20px',
                                textDecoration: 'none',
                                color: '#ffffff',
                                transition: 'transform 0.2s, box-shadow 0.2s',
                                ':hover': {
                                    transform: 'translateY(-2px)',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                                }
                            }}
                        >
                            <h2 style={{ 
                                color: '#3498db', 
                                marginBottom: '10px',
                                fontSize: '1.5em'
                            }}>
                                User Ban Management
                            </h2>
                            <p style={{ color: '#888', marginBottom: '15px' }}>
                                View and manage user bans, including ban history and active bans.
                            </p>
                            <div style={{ 
                                color: '#3498db',
                                fontSize: '0.9em'
                            }}>
                                Access →
                            </div>
                        </Link>

                        <Link 
                            to="/admin/words"
                            style={{
                                backgroundColor: '#2a2a2a',
                                borderRadius: '8px',
                                padding: '20px',
                                textDecoration: 'none',
                                color: '#ffffff',
                                transition: 'transform 0.2s, box-shadow 0.2s',
                                ':hover': {
                                    transform: 'translateY(-2px)',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
                                }
                            }}
                        >
                            <h2 style={{ 
                                color: '#e74c3c', 
                                marginBottom: '10px',
                                fontSize: '1.5em'
                            }}>
                                Word Blacklist
                            </h2>
                            <p style={{ color: '#888', marginBottom: '15px' }}>
                                Manage blacklisted words that users are not allowed to use in names.
                            </p>
                            <div style={{ 
                                color: '#e74c3c',
                                fontSize: '0.9em'
                            }}>
                                Access →
                            </div>
                        </Link>
                    </div>
                </main>
            </div>
        );
    }

    return null;
}

export default Admin; 