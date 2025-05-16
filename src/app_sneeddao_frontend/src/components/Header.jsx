import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FaWallet, FaBars, FaTimes } from 'react-icons/fa';
import { useAuth } from '../AuthContext';
import { headerStyles } from '../styles/HeaderStyles';
import PrincipalBox from '../PrincipalBox';

function Header({ showTotalValue }) {
    const location = useLocation();
    const { isAuthenticated, identity, login, logout } = useAuth();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const toggleMenu = () => {
        setIsMenuOpen(!isMenuOpen);
    };

    return (
        <header className="site-header">
            <div style={{ display: 'flex', alignItems: 'center' }}>
                <button
                    onClick={toggleMenu}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: '#fff',
                        cursor: 'pointer',
                        marginRight: '20px',
                        padding: '8px'
                    }}
                >
                    {isMenuOpen ? <FaTimes size={24} /> : <FaBars size={24} />}
                </button>
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
            {isMenuOpen && (
                <div style={{
                    position: 'fixed',
                    top: '60px',
                    left: '0',
                    backgroundColor: '#2a2a2a',
                    width: '250px',
                    padding: '20px',
                    boxShadow: '2px 0 5px rgba(0,0,0,0.2)',
                    zIndex: 1000
                }}>
                    <nav style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '15px'
                    }}>
                        <Link 
                            to="/wallet"
                            style={{
                                color: '#fff',
                                textDecoration: 'none',
                                padding: '10px',
                                borderRadius: '4px',
                                transition: 'background-color 0.2s',
                                ':hover': {
                                    backgroundColor: '#3a3a3a'
                                }
                            }}
                            onClick={toggleMenu}
                        >
                            Wallet
                        </Link>
                        <Link 
                            to="/wallet"
                            style={{
                                color: '#fff',
                                textDecoration: 'none',
                                padding: '10px',
                                borderRadius: '4px',
                                transition: 'background-color 0.2s',
                                ':hover': {
                                    backgroundColor: '#3a3a3a'
                                }
                            }}
                            onClick={toggleMenu}
                        >
                            SneedLock
                        </Link>
                        <Link 
                            to="/rll"
                            style={{
                                color: '#fff',
                                textDecoration: 'none',
                                padding: '10px',
                                borderRadius: '4px',
                                transition: 'background-color 0.2s',
                                ':hover': {
                                    backgroundColor: '#3a3a3a'
                                }
                            }}
                            onClick={toggleMenu}
                        >
                            Rewards
                        </Link>
                    </nav>
                </div>
            )}
        </header>
    );
}

export default Header; 