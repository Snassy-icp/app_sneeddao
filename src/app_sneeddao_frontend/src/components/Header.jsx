import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FaWallet, FaLock, FaUser, FaBuilding, FaNetworkWired, FaCog, FaTools, FaSignInAlt, FaChevronDown, FaChevronUp, FaRss, FaQuestionCircle } from 'react-icons/fa';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { headerStyles } from '../styles/HeaderStyles';
import PrincipalBox from '../PrincipalBox';
import SnsDropdown from './SnsDropdown';
import ThemeToggle from './ThemeToggle';
import { useAdminCheck } from '../hooks/useAdminCheck';
import { useNeurons } from '../contexts/NeuronsContext';
import { useSns } from '../contexts/SnsContext';
import { useTipNotifications } from '../hooks/useTipNotifications';
import { useReplyNotifications } from '../hooks/useReplyNotifications';
import { useSmsNotifications } from '../hooks/useSmsNotifications';
import { calculateVotingPower, formatVotingPower } from '../utils/VotingPowerUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { getSnsById } from '../utils/SnsUtils';

function Header({ showTotalValue, showSnsDropdown, onSnsChange, customLogo }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { isAuthenticated, identity, login, logout } = useAuth();
    const { theme } = useTheme();
    const { selectedSnsRoot } = useSns();
    const { getAllNeurons, getHotkeyNeurons, loading: neuronsLoading } = useNeurons();
    const { newTipCount } = useTipNotifications();
    const { newReplyCount } = useReplyNotifications();
    const { newMessageCount } = useSmsNotifications();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
    const [nervousSystemParameters, setNervousSystemParameters] = useState(null);
    const menuRef = useRef(null);
    const [activeSection, setActiveSection] = useState(() => {
        const path = location.pathname;
        // Check /msg paths first to avoid conflicts
        if (path.startsWith('/msg')) return 'Me';
        if (['/', '/hub', '/proposals', '/neurons', '/transactions', '/neuron', '/proposal', '/transaction', '/principal', '/forum', '/feed', '/thread', '/post'].includes(path) || location.pathname.startsWith('/topic/')) return 'Hub';
        if (['/me', '/rewards', '/tips', '/posts', '/sms', '/wallet'].includes(path)) return 'Me';
        if (['/dao', '/dao_info', '/rll_info', '/rll', '/products', '/partners', '/projects', '/disclaimer'].includes(path)) return 'DAO';
        if (['/sneedlock', '/sneedlock_info', '/tokenlock', '/positionlock'].includes(path)) return 'Locks';
        if (['/tools/main', '/tools/escrow', '/tools/escrow/swap'].includes(path) || location.pathname.startsWith('/tools/')) return 'Tools';
        if (['/admin'].includes(path) || location.pathname.startsWith('/admin/')) return 'Admin';
        if (['/help', '/doc'].includes(path) || location.pathname.startsWith('/help/')) return 'Help';
        return 'Hub';
    });

    // Update active section when location changes
    useEffect(() => {
        const path = location.pathname;
        // Check /msg paths first to avoid conflicts
        if (path.startsWith('/msg')) {
            setActiveSection('Me');
        } else if (['/', '/hub', '/proposals', '/neurons', '/transactions', '/neuron', '/proposal', '/transaction', '/principal', '/forum', '/feed', '/thread', '/post'].includes(path) || path.startsWith('/topic/')) {
            setActiveSection('Hub');
        } else if (['/me', '/rewards', '/tips', '/posts', '/sms', '/wallet'].includes(path)) {
            setActiveSection('Me');
        } else if (['/dao', '/dao_info', '/rll_info', '/rll', '/products', '/partners', '/projects', '/disclaimer'].includes(path)) {
            setActiveSection('DAO');
        } else if (['/sneedlock', '/sneedlock_info', '/tokenlock', '/positionlock'].includes(path)) {
            setActiveSection('Locks');
        } else if (['/tools/main', '/tools/escrow', '/tools/escrow/swap'].includes(path) || path.startsWith('/tools/')) {
            setActiveSection('Tools');
        } else if (['/admin'].includes(path) || path.startsWith('/admin/')) {
            setActiveSection('Admin');
        } else {
            setActiveSection('Hub'); // Fall back to Hub section
        }
    }, [location.pathname]);

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
        // Check /msg paths first to avoid conflicts
        if (path.startsWith('/msg')) {
            setActiveSection('Me');
        } else if (['/hub', '/proposals', '/neurons', '/transactions', '/neuron', '/proposal', '/transaction', '/principal', '/forum', '/feed', '/thread', '/post'].includes(path) || path.startsWith('/topic/')) {
            setActiveSection('Hub');
        } else if (['/me', '/rewards', '/tips', '/posts', '/sms', '/wallet'].includes(path)) {
            setActiveSection('Me');
        } else if (['/dao', '/dao_info', '/rll_info', '/rll', '/products', '/partners', '/projects', '/disclaimer'].includes(path)) {
            setActiveSection('DAO');
        } else if (['/sneedlock', '/sneedlock_info', '/tokenlock', '/positionlock'].includes(path)) {
            setActiveSection('Locks');
        } else if (['/admin'].includes(path) || path.startsWith('/admin/')) {
            setActiveSection('Admin');
        } else if (['/help', '/doc'].includes(path) || path.startsWith('/help/')) {
            setActiveSection('Help');
        }
    }, [location.pathname]);

    // Update active section if current section doesn't exist (e.g., admin section when not admin)
    // But only if we're not on an admin page waiting for admin check
    useEffect(() => {
        if (!menuSections[activeSection] && !(isOnAdminPage && adminLoading)) {
            setActiveSection('Hub'); // Fall back to Hub section
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
        'Hub': {
            icon: <FaNetworkWired size={18} />,
            displayName: 'Sneed Hub',
            defaultPath: '/hub',
            subMenu: [
                { name: 'Hub', path: '/hub' },
                { name: 'Feed', path: '/feed' },
                { name: 'Forum', path: '/forum' },
                { name: 'Proposals', path: '/proposals' },
                { name: 'Neurons', path: '/neurons' },
                { name: 'Transactions', path: '/transactions' },
                { name: 'Users', path: '/principal' }
            ]
        },
        'Me': {
            icon: <FaUser size={18} />,
            displayName: 'Sneed Me',
            defaultPath: '/me',
            subMenu: [
                { name: 'Me', path: '/me' },
                { name: 'Messages', path: '/sms' },
                { name: 'Posts', path: '/posts' },
                { name: 'Tips', path: '/tips' },
                { name: 'Rewards', path: '/rewards' },
                { name: 'Wallet', path: '/wallet' }
            ]
        },

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
        'Locks': {
            icon: <FaLock size={18} />,
            displayName: 'Sneed Lock',
            defaultPath: '/sneedlock',
            subMenu: [
                { name: 'Locks', path: '/sneedlock' },
                { name: 'Dashboard', path: '/sneedlock_info' }
            ]
        },
        'Help': {
            icon: <FaQuestionCircle size={18} />,
            displayName: 'Help',
            defaultPath: '/help',
            subMenu: [
                { name: 'Help', path: '/help' },
                { name: 'Doc', path: '/doc' }
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
                { name: 'Projects', path: '/admin/projects' },
                { name: 'SneedLock', path: '/admin/sneedlock' }
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
        
        // Special case: root path "/" should highlight Feed submenu item
        if (itemPath === '/feed' && currentPath === '/') {
            return true;
        }
        
        // Legacy page mappings
        const legacyMappings = {
            '/proposals': ['/proposal'],
            '/neurons': ['/neuron'],
            '/transactions': ['/transaction'],
            '/forum': ['/thread', '/post'],
            '/sms': ['/msg']
        };
        
        // Special handling for dynamic paths
        if (itemPath === '/forum' && currentPath.startsWith('/topic/')) {
            return true;
        }
        
        // Special handling for message routes (dynamic paths)
        if (itemPath === '/sms' && currentPath.startsWith('/msg')) {
            return true;
        }
        
        // Special handling for Locks submenu item - highlight for sneedlock, tokenlock and positionlock
        if (itemPath === '/sneedlock' && ['/sneedlock', '/tokenlock', '/positionlock'].includes(currentPath)) {
            return true;
        }
        
        return legacyMappings[itemPath]?.includes(currentPath) || false;
    };

    return (
        <header 
            className="site-header" 
            style={{ 
                flexDirection: 'column',
                backgroundColor: theme.colors.headerBg,
                borderBottom: `1px solid ${theme.colors.border}`
            }}
        >
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
                        color: theme.colors.primaryText,
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
                            color: theme.colors.mutedText,
                            cursor: 'pointer',
                            padding: '4px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            fontSize: '16px',
                            transition: 'color 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.color = theme.colors.primaryText;
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.color = theme.colors.mutedText;
                        }}
                        title={isHeaderCollapsed ? "Expand header sections" : "Collapse header sections"}
                    >
                        {isHeaderCollapsed ? <FaChevronDown size={14} /> : <FaChevronUp size={14} />}
                    </button>
                </div>

                {/* SNS Dropdown */}
                {showSnsDropdown && (
                    <SnsDropdown onSnsChange={onSnsChange} />
                )}

                {/* Theme Toggle */}
                <ThemeToggle size="medium" />

                {/* Feed Link */}
                <button
                    onClick={() => navigate('/feed')}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: theme.colors.primaryText,
                        cursor: 'pointer',
                        padding: '4px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        fontSize: '18px',
                        marginRight: '0px',
                        transition: 'background-color 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                    title="Go to Feed"
                >
                    <FaRss size={16} />
                </button>

                {/* Wallet Link */}
                
                <button
                    onClick={() => navigate('/wallet')}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: theme.colors.primaryText,
                        cursor: 'pointer',
                        padding: '4px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        fontSize: '18px',
                        marginRight: '8px',
                        transition: 'background-color 0.2s ease'
                    }}
                    onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                    onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                    title="Go to Wallet"
                >
                    <FaWallet size={16} />
                </button>

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
                            color: theme.colors.primaryText,
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
                            color: theme.colors.mutedText,
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
                                        color: isActive ? theme.colors.accent : theme.colors.mutedText,
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
                                            background: theme.colors.accent,
                                            borderRadius: '2px'
                                        }} />
                                    )}
                                </Link>
                            );
                        })
                    )}
                    {showTotalValue && (
                        <div style={{ 
                            color: theme.colors.primaryText,
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
                        color: theme.colors.mutedText
                    }}>
                        <div style={{ 
                            fontSize: '10px', 
                            color: theme.colors.mutedText
                        }}>
                            Your Neurons
                        </div>
                        {neuronsLoading ? (
                            <div style={{ color: theme.colors.mutedText, fontStyle: 'italic' }}>
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
                                                <span style={{ color: theme.colors.accent }}>
                                                    {hotkeyNeurons.length} hotkeyed
                                                </span>
                                                <span style={{ color: theme.colors.mutedText }}>•</span>
                                                <span style={{ color: theme.colors.accent }}>
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
                                                <span style={{ color: theme.colors.success }}>
                                                    {allNeurons.length} reachable
                                                </span>
                                                <span style={{ color: theme.colors.mutedText }}>•</span>
                                                <span style={{ color: theme.colors.success }}>
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
            {!isHeaderCollapsed && isAuthenticated && (newReplyCount > 0 || newTipCount > 0 || newMessageCount > 0) && (
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
                                    border: `1px solid ${theme.colors.warning}`,
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    color: theme.colors.warning
                                }}
                                title={`You have ${newReplyCount} new ${newReplyCount === 1 ? 'reply' : 'replies'}`}
                            >
                                💬 {newReplyCount}
                            </div>
                        )}
                        
                        {/* SMS Notifications */}
                        {newMessageCount > 0 && (
                            <div 
                                onClick={() => navigate('/sms')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '4px 8px',
                                    backgroundColor: 'rgba(0, 191, 255, 0.1)',
                                    border: `1px solid ${theme.colors.accent}`,
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    color: theme.colors.accent
                                }}
                                title={`You have ${newMessageCount} new ${newMessageCount === 1 ? 'message' : 'messages'}`}
                            >
                                📨 {newMessageCount}
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
                                    border: `1px solid ${theme.colors.warning}`,
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    color: theme.colors.warning
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
                        background: theme.colors.primaryGradient,
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
                                    color: theme.colors.primaryText,
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