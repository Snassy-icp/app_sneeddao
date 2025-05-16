import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { FaWallet, FaBars, FaTimes, FaLock, FaTrophy } from 'react-icons/fa';
import { useAuth } from '../AuthContext';
import { headerStyles } from '../styles/HeaderStyles';
import PrincipalBox from '../PrincipalBox';

function Header({ showTotalValue }) {
    const location = useLocation();
    const { isAuthenticated, identity, login, logout } = useAuth();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [activeSection, setActiveSection] = useState(() => {
        if (location.pathname === '/rll' || location.pathname === '/rll_info') return 'Rewards';
        if (location.pathname === '/dashboard') return 'SneedLock';
        return 'Wallet';
    });

    const menuSections = {
        'Wallet': {
            icon: <FaWallet size={18} />,
            subMenu: [
                { name: 'Tokens', path: '/wallet' },
                { name: 'Positions', path: '/wallet' }
            ]
        },
        'SneedLock': {
            icon: <FaLock size={18} />,
            subMenu: [
                { name: 'My Locks', path: '/wallet' },
                { name: 'Dashboard', path: '/dashboard' }
            ]
        },
        'Rewards': {
            icon: <FaTrophy size={18} />,
            subMenu: [
                { name: 'Claim', path: '/rll' },
                { name: 'Dashboard', path: '/rll_info' }
            ]
        }
    };

    const toggleMenu = () => {
        setIsMenuOpen(!isMenuOpen);
    };

    const handleSectionClick = (section) => {
        setActiveSection(section);
        toggleMenu();
    };

    return (
        <header className="site-header">
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
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
                    <div style={{ 
                        color: '#fff',
                        fontSize: '24px',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px'
                    }}>
                        {menuSections[activeSection].icon}
                        {activeSection}
                    </div>
                </div>
                <div style={{ 
                    display: 'flex',
                    gap: '20px',
                    marginLeft: '52px'
                }}>
                    {menuSections[activeSection].subMenu.map((item) => (
                        <Link
                            key={item.name}
                            to={item.path}
                            style={{
                                color: location.pathname === item.path ? '#3498db' : '#888',
                                textDecoration: 'none',
                                fontSize: '16px',
                                fontWeight: location.pathname === item.path ? 'bold' : 'normal',
                                position: 'relative',
                                paddingBottom: '4px'
                            }}
                        >
                            {item.name}
                            {location.pathname === item.path && (
                                <div style={{
                                    position: 'absolute',
                                    bottom: 0,
                                    left: 0,
                                    width: '100%',
                                    height: '2px',
                                    background: '#3498db',
                                    borderRadius: '2px'
                                }} />
                            )}
                        </Link>
                    ))}
                </div>
            </div>
            {showTotalValue && <h4>Total Value: ${showTotalValue}</h4>}
            <div className="header-right">
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
                    background: 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)',
                    width: '250px',
                    padding: '20px',
                    boxShadow: '2px 0 15px rgba(0,0,0,0.3)',
                    zIndex: 1000,
                    borderRight: '1px solid rgba(255,255,255,0.1)',
                    backdropFilter: 'blur(10px)'
                }}>
                    <nav style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '15px'
                    }}>
                        {Object.entries(menuSections).map(([section, { icon }]) => (
                            <button 
                                key={section}
                                onClick={() => handleSectionClick(section)}
                                style={{
                                    color: '#fff',
                                    textDecoration: 'none',
                                    padding: '12px 16px',
                                    borderRadius: '8px',
                                    transition: 'all 0.2s ease',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    background: section === activeSection 
                                        ? 'linear-gradient(to right, rgba(52, 152, 219, 0.2), rgba(52, 152, 219, 0.1))'
                                        : 'linear-gradient(to right, rgba(52, 152, 219, 0.1), rgba(52, 152, 219, 0))',
                                    border: '1px solid rgba(52, 152, 219, 0.2)',
                                    fontSize: '16px',
                                    cursor: 'pointer',
                                    width: '100%',
                                    textAlign: 'left'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'linear-gradient(to right, rgba(52, 152, 219, 0.2), rgba(52, 152, 219, 0.1))';
                                    e.currentTarget.style.transform = 'translateX(5px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = section === activeSection
                                        ? 'linear-gradient(to right, rgba(52, 152, 219, 0.2), rgba(52, 152, 219, 0.1))'
                                        : 'linear-gradient(to right, rgba(52, 152, 219, 0.1), rgba(52, 152, 219, 0))';
                                    e.currentTarget.style.transform = 'translateX(0)';
                                }}
                            >
                                {icon}
                                {section}
                            </button>
                        ))}
                    </nav>
                </div>
            )}
        </header>
    );
}

export default Header; 