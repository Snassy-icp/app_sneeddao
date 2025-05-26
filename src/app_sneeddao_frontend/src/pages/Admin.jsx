import React from 'react';
import { useAuth } from '../AuthContext';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useAdminCheck } from '../hooks/useAdminCheck';

function Admin() {
    const { isAuthenticated, identity } = useAuth();
    const { isAdmin, loading, error, loadingComponent, errorComponent } = useAdminCheck({
        identity,
        isAuthenticated,
        redirectPath: '/wallet'
    });

    if (loading) {
        return (
            <div className='page-container'>
                <Header />
                <main className="wallet-container">
                    <div style={loadingComponent?.style || { textAlign: 'center', padding: '40px 20px', color: '#ffffff' }}>
                        {loadingComponent?.text || 'Loading...'}
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
                    <div style={errorComponent?.style || {
                        backgroundColor: 'rgba(231, 76, 60, 0.1)',
                        border: '1px solid #e74c3c',
                        color: '#e74c3c',
                        padding: '15px',
                        borderRadius: '4px',
                        marginBottom: '20px'
                    }}>
                        {errorComponent?.text || error || 'An error occurred'}
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
                <h1 style={{ color: '#ffffff', marginBottom: '20px' }}>Admin Dashboard</h1>
                
                <div style={{ 
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                    gap: '20px',
                    padding: '20px'
                }}>
                    <Link 
                        to="/admin/users/bans"
                        style={{
                            backgroundColor: '#2a2a2a',
                            padding: '20px',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            color: '#ffffff',
                            textAlign: 'center',
                            border: '1px solid #3a3a3a',
                            transition: 'transform 0.2s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '10px'
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        <h2 style={{ margin: 0 }}>User Bans</h2>
                        <p style={{ color: '#888', margin: 0 }}>Manage banned users</p>
                    </Link>

                    <Link 
                        to="/admin/words"
                        style={{
                            backgroundColor: '#2a2a2a',
                            padding: '20px',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            color: '#ffffff',
                            textAlign: 'center',
                            border: '1px solid #3a3a3a',
                            transition: 'transform 0.2s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '10px'
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        <h2 style={{ margin: 0 }}>Word Blacklist</h2>
                        <p style={{ color: '#888', margin: 0 }}>Manage blacklisted words</p>
                    </Link>

                    <Link 
                        to="/admin/partners"
                        style={{
                            backgroundColor: '#2a2a2a',
                            padding: '20px',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            color: '#ffffff',
                            textAlign: 'center',
                            border: '1px solid #3a3a3a',
                            transition: 'transform 0.2s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '10px'
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        <h2 style={{ margin: 0 }}>Partners</h2>
                        <p style={{ color: '#888', margin: 0 }}>Manage ecosystem partners</p>
                    </Link>

                    <Link 
                        to="/admin/names"
                        style={{
                            backgroundColor: '#2a2a2a',
                            padding: '20px',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            color: '#ffffff',
                            textAlign: 'center',
                            border: '1px solid #3a3a3a',
                            transition: 'transform 0.2s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '10px'
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        <h2 style={{ margin: 0 }}>Names</h2>
                        <p style={{ color: '#888', margin: 0 }}>Manage principal and neuron names</p>
                    </Link>

                    <Link 
                        to="/admin/projects"
                        style={{
                            backgroundColor: '#2a2a2a',
                            padding: '20px',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            color: '#ffffff',
                            textAlign: 'center',
                            border: '1px solid #3a3a3a',
                            transition: 'transform 0.2s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '10px'
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        <h2 style={{ margin: 0 }}>Projects</h2>
                        <p style={{ color: '#888', margin: 0 }}>Manage ecosystem projects</p>
                    </Link>
                </div>
            </main>
        </div>
    );
}

export default Admin; 