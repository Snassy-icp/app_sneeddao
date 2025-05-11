import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import PrincipalBox from './PrincipalBox';
import { headerStyles } from './styles/HeaderStyles';

function RLLInfo() {
    const { identity, logout } = useAuth();

    return (
        <div className='page-container'>
            <header className="site-header">
                <div style={headerStyles.logoContainer}>
                    <div className="logo">
                        <Link to="/wallet">
                            <img src="sneedlock-logo-cropped.png" alt="Sneedlock" />
                        </Link>
                    </div>
                    <Link to="/rll" style={headerStyles.rllLogo}>
                        RLL
                    </Link>
                </div>
                <div className="header-right">
                    <Link to="/help" className="help-link">Help</Link>
                    <PrincipalBox 
                        principalText={identity ? identity.getPrincipal().toText() : "Not logged in."}
                        onLogout={logout}
                    />
                </div>
            </header>
            <main className="help-container">
                <h1 style={{ color: '#ffffff' }}>RLL Information</h1>
                <section style={{ 
                    backgroundColor: '#2a2a2a',
                    borderRadius: '8px',
                    padding: '20px',
                    marginTop: '20px',
                    color: '#ffffff',
                    textAlign: 'center',
                    fontSize: '1.2em'
                }}>
                    Coming soon...
                </section>
            </main>
        </div>
    );
}

export default RLLInfo; 