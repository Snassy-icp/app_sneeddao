import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FaWallet, FaLock, FaUser, FaBuilding, FaNetworkWired, FaCog, FaTools, FaSignInAlt, FaChevronDown, FaChevronUp } from 'react-icons/fa';
import { useAuth } from '../AuthContext';
import { headerStyles } from '../styles/HeaderStyles';
import PrincipalBox from '../PrincipalBox';
import SnsDropdown from './SnsDropdown';
import { useAdminCheck } from '../hooks/useAdminCheck';
import { useNeurons } from '../contexts/NeuronsContext';
import { useSns } from '../contexts/SnsContext';
import { useTipNotifications } from '../hooks/useTipNotifications';
import { useReplyNotifications } from '../hooks/useReplyNotifications';
import { calculateVotingPower, formatVotingPower } from '../utils/VotingPowerUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { getSnsById } from '../utils/SnsUtils';

function Header({ showTotalValue, showSnsDropdown, onSnsChange, customLogo }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { isAuthenticated, identity, login, logout } = useAuth();
    const { selectedSnsRoot } = useSns();
    const { getAllNeurons, getHotkeyNeurons, loading: neuronsLoading } = useNeurons();
    const { newTipCount } = useTipNotifications();
    const { newReplyCount } = useReplyNotifications();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
    const [nervousSystemParameters, setNervousSystemParameters] = useState(null);
    const menuRef = useRef(null);
    const [activeSection, setActiveSection] = useState(() => {
        const path = location.pathname;
        if (['/dao', '/dao_info', '/rll_info', '/rll', '/products', '/partners', '/projects', '/disclaimer'].includes(path)) return 'DAO';
        if (['/hub', '/proposals', '/neurons', '/transactions', '/neuron', '/proposal', '/transaction', '/principal', '/forum', '/thread', '/post'].includes(path) || location.pathname.startsWith('/topic/')) return 'Hub';
        if (['/wallet'].includes(path)) return 'Wallet';
        if (['/me', '/rewards', '/tips', '/posts', '/sms'].includes(path)) return 'Me';
        if (['/sneedlock', '/sneedlock_info'].includes(path)) return 'Locks';
        if (['/tools/main', '/tools/escrow', '/tools/escrow/swap'].includes(path) || location.pathname.startsWith('/tools/')) return 'Tools';
        if (['/admin'].includes(path) || location.pathname.startsWith('/admin/')) return 'Admin';
        return 'DAO';
    });

    // Silent admin check - don't redirect, just check status
    const { isAdmin, loading: adminLoading } = useAdminCheck({ 
        identity, 
        isAuthenticated, 
        redirectPath: null // Don't redirect from header
    });

    // Check if we're on an admin page
    const isOnAdminPage = location.pathname === '/admin' || location.pathname.startsWith('/admin/');

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

    // Update active section when location changes
    useEffect(() => {
        const path = location.pathname;
        if (['/dao', '/dao_info', '/rll_info', '/rll', '/products', '/partners', '/projects', '/disclaimer'].includes(path)) {
            setActiveSection('DAO');
        } else if (['/hub', '/proposals', '/neurons', '/transactions', '/neuron', '/proposal', '/transaction', '/principal'].includes(path)) {
            setActiveSection('Hub');
        } else if (['/wallet'].includes(path)) {
            setActiveSection('Wallet');
        } else if (['/me', '/rewards', '/tips', '/posts', '/sms'].includes(path)) {
            setActiveSection('Me');
        } else if (['/sneedlock', '/sneedlock_info'].includes(path)) {
            setActiveSection('Locks');
        } else if (['/admin'].includes(path) || path.startsWith('/admin/')) {
            setActiveSection('Admin');
        }
    }, [location.pathname]);

    // Update active section if current section doesn't exist (e.g., admin section when not admin)
    // But only if we're not on an admin page waiting for admin check
    useEffect(() => {
        if (!menuSections[activeSection] && !(isOnAdminPage && adminLoading)) {
            setActiveSection('DAO'); // Fall back to DAO section
        }
    }, [activeSection, isAdmin, isAuthenticated, isOnAdminPage, adminLoading]);

    // Fetch nervous system parameters for voting power calculation
    useEffect(() => {
        const fetchNervousSystemParameters = async () => {
            if (!selectedSnsRoot || !identity) {
                setNervousSystemParameters(null);
                return;
            }
            
            try {
                const selectedSns = getSnsById(selectedSnsRoot);
                if (!selectedSns) return;

                const snsGovActor = createSnsGovernanceActor(selectedSns.canisters.governance, {
                    agentOptions: { identity }
                });
                
                const params = await snsGovActor.get_nervous_system_parameters(null);
                setNervousSystemParameters(params);
            } catch (error) {
                console.error('Error fetching nervous system parameters:', error);
                setNervousSystemParameters(null);
            }
        };

        fetchNervousSystemParameters();
    }, [selectedSnsRoot, identity]);

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
                { name: 'Projects', path: '/projects' },
                { name: 'Disclaimer', path: '/disclaimer' }
            ]
        },
        'Me': {
            icon: <FaUser size={18} />,
            displayName: 'Sneed Me',
            defaultPath: '/me',
            subMenu: [
                { name: 'Me', path: '/me' },
                { name: 'My Posts', path: '/posts' },
                { name: 'My Tips', path: '/tips' },
                { name: 'My Msgs', path: '/sms' },
                { name: 'My Rewards', path: '/rewards' }
            ]
        },
        'Hub': {
            icon: <FaNetworkWired size={18} />,
            displayName: 'Sneed Hub',
            defaultPath: '/hub',
            subMenu: [
                { name: 'Hub', path: '/hub' },
                { name: 'Forum', path: '/forum' },
                { name: 'Proposals', path: '/proposals' },
                { name: 'Neurons', path: '/neurons' },
                { name: 'Transactions', path: '/transactions' },
                { name: 'Holders', path: '/principal' }
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

    // Add tools section only if user is authenticated and confirmed admin
    if (isAuthenticated && isAdmin === true) {
        menuSections['Tools'] = {
            icon: <FaTools size={18} />,
            displayName: 'Sneed Tools',
            defaultPath: '/tools/main',
            subMenu: [
                { name: 'Tools', path: '/tools/main' },
                { name: 'Escrow', path: '/tools/escrow' },
                { name: 'Lookup Swap', path: '/tools/escrow/swap' }
            ]
        };
    }

    // Add admin section only if user is authenticated and confirmed admin
    if (isAuthenticated && isAdmin === true) {
        menuSections['Admin'] = {
            icon: <FaCog size={18} />,
            displayName: 'Admin',
            defaultPath: '/admin',
            subMenu: [
                { name: 'Dashboard', path: '/admin' },
                { name: 'User Bans', path: '/admin/users/bans' },
                { name: 'Word Blacklist', path: '/admin/words' },
                { name: 'Partners', path: '/admin/partners' },
                { name: 'Names', path: '/admin/names' },
                { name: 'Projects', path: '/admin/projects' }
            ]
        };
    }

    const toggleMenu = () => {
        setIsMenuOpen(!isMenuOpen);
    };

    const toggleHeaderCollapse = () => {
        setIsHeaderCollapsed(!isHeaderCollapsed);
    };

    const handleSectionClick = (section) => {
        setActiveSection(section);
        toggleMenu();
        // Preserve URL parameters when navigating to different sections
        const currentSearch = location.search;
        const targetPath = menuSections[section].defaultPath;
        navigate(`${targetPath}${currentSearch}`);
    };

    const handleLogoClick = () => {
        // Only open the hamburger menu
        setIsMenuOpen(true);
    };

    // Helper function to determine if a submenu item should be highlighted
    const isSubmenuItemActive = (itemPath) => {
        const currentPath = location.pathname;
        
        // Direct path match
        if (currentPath === itemPath) return true;
        
        // Legacy page mappings
        const legacyMappings = {
            '/proposals': ['/proposal'],
            '/neurons': ['/neuron'],
            '/transactions': ['/transaction'],
            '/forum': ['/thread', '/post']
        };
        
        // Special handling for topic routes (dynamic paths)
        if (itemPath === '/forum' && currentPath.startsWith('/topic/')) {
            return true;
        }
        
        return legacyMappings[itemPath]?.includes(currentPath) || false;
    };

    return (
        <header className="site-header" style={{ flexDirection: 'column' }}>
            {/* Top Row: Logo, Menu Title, SNS Dropdown, Login - All on same row */}
            <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '15px' }}>
                <img
                    src={customLogo || "sneed_logo.png"}
                    alt={customLogo ? "Logo" : "Sneed Logo"}
                    onClick={handleLogoClick}
                    style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: customLogo ? '0' : '50%',
                        objectFit: 'cover',
                        cursor: 'pointer'
                    }}
                />
                
                <div 
                    style={{ 
                        color: '#fff',
                        fontSize: '24px',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer',
                        flex: 1,
                        gap: '10px'
                    }}
                    onClick={() => {
                        setIsMenuOpen(true);
                    }}
                >
                    {/* Show admin section name if on admin page, even during loading */}
                    {isOnAdminPage && adminLoading ? (
                        <>Admin</>
                    ) : (
                        <>
                            {/* Extract just the section name without "Sneed" prefix */}
                            {menuSections[activeSection]?.displayName?.replace('Sneed ', '')}
                        </>
                    )}
                    
                    {/* Divot toggle button */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation(); // Prevent triggering the menu open
                            toggleHeaderCollapse();
                        }}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#888',
                            cursor: 'pointer',
                            padding: '4px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            fontSize: '16px',
                            transition: 'color 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.color = '#fff';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.color = '#888';
                        }}
                        title={isHeaderCollapsed ? "Expand header sections" : "Collapse header sections"}
                    >
                        {isHeaderCollapsed ? <FaChevronDown size={14} /> : <FaChevronUp size={14} />}
                    </button>
                </div>

                {/* SNS Dropdown and Login on same row */}
                {showSnsDropdown ? (
                    <SnsDropdown onSnsChange={onSnsChange} />
                ) : (
                    <img
                        src={"sneed_logo.png"}
                        alt={"Sneed Logo"}
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
                    <div style={{ position: 'relative' }}>
                        <PrincipalBox 
                            principalText={identity ? identity.getPrincipal().toText() : "Not logged in."}
                            onLogout={logout}
                            compact={true}
                        />
                    </div>
                ) : (
                    <button
                        onClick={login}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#fff',
                            cursor: 'pointer',
                            padding: '8px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            fontSize: '18px'
                        }}
                        title="Login"
                    >
                        <FaSignInAlt size={16} />
                    </button>
                )}

            </div>

            {/* Submenu Row: Full-width navigation links */}
            {!isHeaderCollapsed && (
            <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'flex-start',
                width: '100%',
                paddingTop: '8px',
                borderTop: '1px solid rgba(255,255,255,0.1)',
                marginTop: '8px'
            }}>
                <div style={{ 
                    display: 'flex', 
                    gap: '20px', 
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    rowGap: '10px'
                }}>
                    {/* Show loading state if on admin page and waiting for admin check */}
                    {isOnAdminPage && adminLoading ? (
                        <div style={{
                            color: '#888',
                            fontSize: '16px',
                            fontStyle: 'italic'
                        }}>
                            Loading...
                        </div>
                    ) : (
                        menuSections[activeSection]?.subMenu?.map((item) => {
                            const isActive = isSubmenuItemActive(item.path);
                            return (
                                <Link
                                    key={item.name}
                                    to={item.path}
                                    style={{
                                        color: isActive ? '#3498db' : '#888',
                                        textDecoration: 'none',
                                        fontSize: '16px',
                                        fontWeight: isActive ? 'bold' : 'normal',
                                        position: 'relative',
                                        paddingBottom: '4px'
                                    }}
                                >
                                    {item.name}
                                    {isActive && (
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
                            );
                        })
                    )}
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
            )}

            {/* Bottom Row: VP Display */}
            {!isHeaderCollapsed && showSnsDropdown && isAuthenticated && (
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'flex-start',
                    width: '100%',
                    paddingTop: '8px',
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                    marginTop: '8px'
                }}>
                    {/* VP Display */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '20px',
                        fontSize: '12px',
                        color: '#888'
                    }}>
                        <div style={{ 
                            fontSize: '10px', 
                            color: '#666'
                        }}>
                            Your Neurons
                        </div>
                        {neuronsLoading ? (
                            <div style={{ color: '#888', fontStyle: 'italic' }}>
                                Loading neurons...
                            </div>
                        ) : (
                            <>
                                {(() => {
                                    const allNeurons = getAllNeurons();
                                    const hotkeyNeurons = getHotkeyNeurons();
                                    
                                    // Calculate hotkeyed VP (only hotkeyed neurons) - using nervousSystemParameters
                                    const hotkeyedVP = hotkeyNeurons.reduce((total, neuron) => {
                                        try {
                                            const votingPower = nervousSystemParameters ? 
                                                calculateVotingPower(neuron, nervousSystemParameters) : 0;
                                            return total + votingPower;
                                        } catch (error) {
                                            console.warn('Error calculating voting power for neuron:', neuron.id, error);
                                            return total;
                                        }
                                    }, 0);
                                    
                                    // Calculate reachable VP (all neurons) - using nervousSystemParameters
                                    const reachableVP = allNeurons.reduce((total, neuron) => {
                                        try {
                                            const votingPower = nervousSystemParameters ? 
                                                calculateVotingPower(neuron, nervousSystemParameters) : 0;
                                            return total + votingPower;
                                        } catch (error) {
                                            console.warn('Error calculating voting power for neuron:', neuron.id, error);
                                            return total;
                                        }
                                    }, 0);
                                    
                                    return (
                                        <>
                                            {/* Hotkeyed neurons first */}
                                            <div 
                                                style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: '8px',
                                                    marginBottom: '2px'
                                                }}
                                                title="Neurons where you have hotkey permission - can vote on SNS proposals"
                                            >
                                                <span style={{ color: '#3498db' }}>
                                                    {hotkeyNeurons.length} hotkeyed
                                                </span>
                                                <span style={{ color: '#666' }}>•</span>
                                                <span style={{ color: '#3498db' }}>
                                                    {nervousSystemParameters ? 
                                                        formatVotingPower(hotkeyedVP) : 
                                                        'Loading...'
                                                    } VP
                                                </span>
                                            </div>
                                            {/* Reachable neurons second */}
                                            <div 
                                                style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: '8px'
                                                }}
                                                title="All neurons you can access (owned + hotkeyed) - for forum voting"
                                            >
                                                <span style={{ color: '#2ecc71' }}>
                                                    {allNeurons.length} reachable
                                                </span>
                                                <span style={{ color: '#666' }}>•</span>
                                                <span style={{ color: '#2ecc71' }}>
                                                    {nervousSystemParameters ? 
                                                        formatVotingPower(reachableVP) : 
                                                        'Loading...'
                                                    } VP
                                                </span>
                                            </div>
                                        </>
                                    );
                                })()}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Notifications Row: Only shows when there are notifications */}
            {!isHeaderCollapsed && isAuthenticated && (newReplyCount > 0 || newTipCount > 0) && (
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'flex-end',
                    width: '100%',
                    paddingTop: '8px',
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                    marginTop: '8px'
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                    }}>
                        {/* Reply Notifications */}
                        {newReplyCount > 0 && (
                            <div 
                                onClick={() => navigate('/posts')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '4px 8px',
                                    backgroundColor: 'rgba(255, 215, 0, 0.1)',
                                    border: '1px solid #FFD700',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    color: '#FFD700'
                                }}
                                title={`You have ${newReplyCount} new ${newReplyCount === 1 ? 'reply' : 'replies'}`}
                            >
                                💬 {newReplyCount}
                            </div>
                        )}
                        
                        {/* Tip Notifications */}
                        {newTipCount > 0 && (
                            <div 
                                onClick={() => navigate('/tips')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '4px 8px',
                                    backgroundColor: 'rgba(255, 215, 0, 0.1)',
                                    border: '1px solid #FFD700',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    color: '#FFD700'
                                }}
                                title={`You have ${newTipCount} new ${newTipCount === 1 ? 'tip' : 'tips'}`}
                            >
                                💰 {newTipCount}
                            </div>
                        )}
                    </div>
                </div>
            )}
            
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