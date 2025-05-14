import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FaWallet } from 'react-icons/fa';
import { useAuth } from '../AuthContext';
import { headerStyles } from '../styles/HeaderStyles';
import PrincipalBox from '../PrincipalBox';

function Header({ showTotalValue }) {
    const location = useLocation();
    const { isAuthenticated, identity, login, logout } = useAuth();

    return (
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
            {showTotalValue && <h4>Total Value: ${showTotalValue}</h4>}
            <div className="header-right">
                {location.pathname === '/rll' && (
                    <Link to="/rll_info" className="help-link" style={{ marginRight: '10px' }}>Info</Link>
                )}
                <Link to="/help" className="help-link">Help</Link>
                <Link 
                    to="/wallet" 
                    style={{ 
                        marginLeft: '15px',
                        marginRight: '15px',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        textDecoration: 'none'
                    }}
                >
                    <FaWallet size={20} />
                </Link>
                {isAuthenticated ? (
                    <PrincipalBox 
                        principalText={identity ? identity.getPrincipal().toText() : "Not logged in."}
                        onLogout={logout}
                    />
                ) : (
                    <button
                        onClick={login}
                        style={{
                            padding: '8px 16px',
                            backgroundColor: '#6B46C1',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Login
                    </button>
                )}
            </div>
        </header>
    );
}

export default Header; 