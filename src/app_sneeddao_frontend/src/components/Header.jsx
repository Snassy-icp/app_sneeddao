import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FaWallet, FaBars, FaTimes, FaLock, FaUser, FaBuilding } from 'react-icons/fa';
import { useAuth } from '../AuthContext';
import { headerStyles } from '../styles/HeaderStyles';
import PrincipalBox from '../PrincipalBox';
import SnsDropdown from './SnsDropdown';

function Header({ showTotalValue, showSnsDropdown, onSnsChange }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { isAuthenticated, identity, login, logout } = useAuth();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const menuRef = useRef(null);
    const [activeSection, setActiveSection] = useState(() => {
        const path = location.pathname;
        if (['/dao', '/dao_info', '/rll_info', '/rll', '/products', '/partners', '/proposals'].includes(path)) return 'DAO';
        if (['/wallet'].includes(path)) return 'Wallet';
        if (['/me', '/rewards'].includes(path)) return 'Me';
        if (['/sneedlock', '/sneedlock_info'].includes(path)) return 'Locks';
        return 'DAO';
    });

    // Add click outside handler
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setIsMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const menuSections = {
        'DAO': {
            icon: <FaBuilding size={18} />,
            displayName: 'Sneed DAO',
            defaultPath: '/dao',
            subMenu: [
                { name: 'DAO', path: '/dao' },
                { name: 'Dashboard', path: '/dao_info' },
                { name: 'Tokenomics', path: '/rll_info' },
                { name: 'Rewards', path: '/rll' },
                { name: 'Products', path: '/products' },
                { name: 'Partners', path: '/partners' },
                { name: 'Proposals', path: '/proposals' },
                { name: 'Disclaimer', path: '/disclaimer' }
            ]
        },
        'Wallet': {
            icon: <FaWallet size={18} />,
            displayName: 'Sneed Wallet',
            defaultPath: '/wallet',
            subMenu: [
                { name: 'Wallet', path: '/wallet' }
            ]
        },
        'Me': {
            icon: <FaUser size={18} />,
            displayName: 'Sneed Me',
            defaultPath: '/me',
            subMenu: [
                { name: 'Me', path: '/me' },
                { name: 'My Rewards', path: '/rewards' }
            ]
        },
        'Locks': {
            icon: <FaLock size={18} />,
            displayName: 'Sneed Lock',
            defaultPath: '/sneedlock',
            subMenu: [
                { name: 'Locks', path: '/sneedlock' },
                { name: 'Dashboard', path: '/sneedlock_info' }
            ]
        }
    };

    const toggleMenu = () => {
        setIsMenuOpen(!isMenuOpen);
    };

    const handleSectionClick = (section) => {
        setActiveSection(section);
        toggleMenu();
        navigate(menuSections[section].defaultPath);
    };

    const handleLogoClick = () => {
        // Open the hamburger menu
        setIsMenuOpen(true);
        
        // Select Sneed SNS if onSnsChange is provided
        const SNEED_SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
        if (onSnsChange) {
            // Update the URL search params to include the SNS
            const searchParams = new URLSearchParams(window.location.search);
            searchParams.set('sns', SNEED_SNS_ROOT);
            const newSearch = searchParams.toString();
            const newPath = `${window.location.pathname}${newSearch ? '?' + newSearch : ''}`;
            navigate(newPath);
            
            // Update the SNS dropdown
            onSnsChange(SNEED_SNS_ROOT);
        }
    };

    return (
        <header className="site-header">
            <div style={{ display: 'flex', alignItems: 'flex-start', flex: 1, gap: '15px' }}>
                <img
                    src="sneed_logo.png"
                    alt="Sneed Logo"
                    onClick={handleLogoClick}
                    style={{
                        width: '52px',
                        height: '52px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        marginTop: '8px',
                        cursor: 'pointer'
                    }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginLeft: '37px' }}>
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        marginBottom: '8px',
                    }}>
                        <button
                            onClick={toggleMenu}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#fff',
                                cursor: 'pointer',
                                padding: '8px',
                                paddingLeft: 0
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
                            gap: '10px',
                            cursor: 'pointer'
                        }}
                        onClick={() => navigate(menuSections[activeSection].defaultPath)}>
                            {menuSections[activeSection].icon}
                            {menuSections[activeSection].displayName}
                        </div>
                    </div>
                    <div style={{ 
                        display: 'flex',
                        alignItems: 'center'
                    }}>
                        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
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
                            {showTotalValue && (
                                <div style={{ 
                                    color: '#fff',
                                    fontSize: '16px',
                                    fontWeight: 'bold',
                                    marginLeft: '20px'
                                }}>
                                    Total Value: ${showTotalValue}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <div className="header-right" style={{ display: 'flex', alignItems: 'center' }}>
                {showSnsDropdown ? (
                    <SnsDropdown onSnsChange={onSnsChange} />
                ) : (
                    <img
                        src="sneed_logo.png"
                        alt="Sneed Logo"
                        style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            objectFit: 'cover',
                            marginRight: '16px'
                        }}
                    />
                )}
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
                <div 
                    ref={menuRef}
                    style={{
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
                        {Object.entries(menuSections).map(([section, { icon, displayName }]) => (
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