import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import Header from '../components/Header';
import { createActor as createBackendActor } from 'declarations/app_sneeddao_backend';

function Admin() {
    const { identity } = useAuth();
    const navigate = useNavigate();
    const [isAdmin, setIsAdmin] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const checkAdminStatus = async () => {
            if (!identity) {
                navigate('/');
                return;
            }

            try {
                const backendActor = createBackendActor(identity);
                const isAdminResult = await backendActor.is_admin();
                setIsAdmin(isAdminResult);
                if (!isAdminResult) {
                    navigate('/');
                }
            } catch (err) {
                console.error('Error checking admin status:', err);
                navigate('/');
            } finally {
                setLoading(false);
            }
        };

        checkAdminStatus();
    }, [identity, navigate]);

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

export default Admin; 