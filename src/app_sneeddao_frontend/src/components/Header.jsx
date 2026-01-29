import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FaWallet, FaLock, FaUser, FaBuilding, FaNetworkWired, FaCog, FaTools, FaSignInAlt, FaChevronDown, FaChevronUp, FaRss, FaQuestionCircle, FaExchangeAlt, FaTint, FaBars, FaComments, FaUnlock, FaCrown, FaGift, FaBrain, FaKey, FaHandPaper } from 'react-icons/fa';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { headerStyles } from '../styles/HeaderStyles';
import PrincipalBox from '../PrincipalBox';
import SnsDropdown from './SnsDropdown';
import ThemeToggle from './ThemeToggle';
import { useAdminCheck } from '../hooks/useAdminCheck';
import usePremiumStatus from '../hooks/usePremiumStatus';
import { useNeurons } from '../contexts/NeuronsContext';
import { useSns } from '../contexts/SnsContext';
import { useTipNotifications } from '../hooks/useTipNotifications';
import { useReplyNotifications } from '../hooks/useReplyNotifications';
import { useSmsNotifications } from '../hooks/useSmsNotifications';
import { calculateVotingPower, formatVotingPower } from '../utils/VotingPowerUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { getSnsById, fetchSnsLogo } from '../utils/SnsUtils';
import { HttpAgent } from '@dfinity/agent';

function Header({ showTotalValue, showSnsDropdown, onSnsChange, customLogo }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { isAuthenticated, identity, login, logout } = useAuth();
    const { theme } = useTheme();
    const { selectedSnsRoot, SNEED_SNS_ROOT } = useSns();
    const { getAllNeurons, getHotkeyNeurons, loading: neuronsLoading } = useNeurons();
    const { newTipCount } = useTipNotifications();
    const { newReplyCount } = useReplyNotifications();
    const { newMessageCount } = useSmsNotifications();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isQuickLinksOpen, setIsQuickLinksOpen] = useState(false);
    const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);
    const [nervousSystemParameters, setNervousSystemParameters] = useState(null);
    const [isVpBarVisible, setIsVpBarVisible] = useState(true);
    const [showVpBarSetting, setShowVpBarSetting] = useState(() => {
        try {
            const saved = localStorage.getItem('showVpBar');
            return saved !== null ? JSON.parse(saved) : true; // Default to enabled
        } catch (error) {
            return true;
        }
    });
    const [expandQuickLinksOnDesktop, setExpandQuickLinksOnDesktop] = useState(() => {
        try {
            const saved = localStorage.getItem('expandQuickLinksOnDesktop');
            return saved !== null ? JSON.parse(saved) : false; // Default to false (show hamburger everywhere)
        } catch (error) {
            return false;
        }
    });
    const [snsLogo, setSnsLogo] = useState(null);
    const lastScrollY = useRef(0);
    const lastToggleTime = useRef(0);
    const menuRef = useRef(null);
    const menuToggleRef = useRef(null);
    const quickLinksRef = useRef(null);
    const quickLinksToggleRef = useRef(null);
    const [activeSection, setActiveSection] = useState(() => {
        const path = location.pathname;
        // Check /msg paths first to avoid conflicts
        if (path.startsWith('/msg')) return 'Sneed Me';
        if (['/', '/hub', '/sns', '/proposals', '/neurons', '/transactions', '/neuron', '/proposal', '/transaction', '/principal', '/forum', '/feed', '/thread', '/post'].includes(path) || location.pathname.startsWith('/topic/')) return 'Sneed Hub';
        if (['/liquid_staking', '/sns_neuron_wizard', '/create_icp_neuron'].includes(path) || path.startsWith('/icp_neuron_manager')) return 'Liquid Staking';
        if (['/me', '/names', '/premium', '/rewards', '/tips', '/posts', '/sms', '/wallet', '/canister', '/canisters'].includes(path)) return 'Sneed Me';
        if (['/dao', '/dao_info', '/rll_info', '/rll', '/products', '/partners', '/projects', '/disclaimer'].includes(path)) return 'Sneed DAO';
        if (['/sneedlock', '/sneedlock_info', '/tokenlock', '/positionlock', '/lock_wizard'].includes(path) || path.startsWith('/lock/')) return 'Sneed Lock';
        if (['/sneedex', '/sneedex_offers', '/sneedex_create', '/sneedex_my'].includes(path) || path.startsWith('/sneedex_offer/')) return 'Sneedex';
        if (['/tools/main', '/tools/sns_jailbreak', '/tools/sns_jailbreak_list'].includes(path) || path.startsWith('/tools/')) return 'Tools';
        if (['/admin'].includes(path) || location.pathname.startsWith('/admin/')) return 'Admin';
        if (['/help', '/doc'].includes(path) || location.pathname.startsWith('/help/')) return 'Help';
        return 'Sneed Hub';
    });

    // Silent admin check - don't redirect, just check status
    const { isAdmin, loading: adminLoading } = useAdminCheck({ 
        identity, 
        isAuthenticated, 
        redirectPath: null // Don't redirect from header
    });
    
    // Check premium status
    const { isPremium, loading: premiumLoading } = usePremiumStatus(identity);

    // Check if we're on an admin page
    const isOnAdminPage = location.pathname === '/admin' || location.pathname.startsWith('/admin/');

    // Add click outside handler
    useEffect(() => {
        const handleClickOutside = (event) => {
            // Don't close main menu if clicking on the menu toggle area or the dropdown itself
            const isClickOnToggle = menuToggleRef.current && menuToggleRef.current.contains(event.target);
            const isClickOnMenu = menuRef.current && menuRef.current.contains(event.target);
            
            if (!isClickOnToggle && !isClickOnMenu) {
                setIsMenuOpen(false);
            }
            
            // Don't close quick links if clicking on the quick links toggle or dropdown
            const isClickOnQuickLinksToggle = quickLinksToggleRef.current && quickLinksToggleRef.current.contains(event.target);
            const isClickOnQuickLinks = quickLinksRef.current && quickLinksRef.current.contains(event.target);
            
            if (!isClickOnQuickLinksToggle && !isClickOnQuickLinks) {
                setIsQuickLinksOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Listen for storage changes (when setting is changed in another tab)
    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === 'showVpBar') {
                try {
                    setShowVpBarSetting(e.newValue !== null ? JSON.parse(e.newValue) : true);
                } catch (error) {
                    setShowVpBarSetting(true);
                }
            }
        };
        
        // Listen for custom event (when setting is changed on the same page)
        const handleVpBarChanged = (e) => {
            setShowVpBarSetting(e.detail);
        };
        
        const handleExpandQuickLinksChanged = (e) => {
            setExpandQuickLinksOnDesktop(e.detail);
        };
        
        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('showVpBarChanged', handleVpBarChanged);
        window.addEventListener('expandQuickLinksOnDesktopChanged', handleExpandQuickLinksChanged);
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('showVpBarChanged', handleVpBarChanged);
            window.removeEventListener('expandQuickLinksOnDesktopChanged', handleExpandQuickLinksChanged);
        };
    }, []);

    // Update active section when location changes
    useEffect(() => {
        const path = location.pathname;
        // Check /msg paths first to avoid conflicts
        if (path.startsWith('/msg')) {
            setActiveSection('Sneed Me');
        } else if (['/', '/hub', '/sns', '/proposals', '/neurons', '/transactions', '/neuron', '/proposal', '/transaction', '/principal', '/forum', '/feed', '/thread', '/post'].includes(path) || path.startsWith('/topic/')) {
            setActiveSection('Sneed Hub');
        } else if (['/liquid_staking', '/sns_neuron_wizard', '/create_icp_neuron'].includes(path) || path.startsWith('/icp_neuron_manager')) {
            setActiveSection('Liquid Staking');
        } else if (['/me', '/names', '/premium', '/rewards', '/tips', '/posts', '/sms', '/wallet', '/canister', '/canisters'].includes(path)) {
            setActiveSection('Sneed Me');
        } else if (['/dao', '/dao_info', '/rll_info', '/rll', '/products', '/partners', '/projects', '/disclaimer'].includes(path)) {
            setActiveSection('Sneed DAO');
        } else if (['/sneedlock', '/sneedlock_info', '/tokenlock', '/positionlock'].includes(path) || path.startsWith('/lock/')) {
            setActiveSection('Sneed Lock');
        } else if (['/sneedex', '/sneedex_offers', '/sneedex_create', '/sneedex_my'].includes(path) || path.startsWith('/sneedex_offer/')) {
            setActiveSection('Sneedex');
        } else if (['/admin'].includes(path) || path.startsWith('/admin/')) {
            setActiveSection('Admin');
        } else if (['/help', '/doc'].includes(path) || path.startsWith('/help/')) {
            setActiveSection('Help');
        }
    }, [location.pathname]);

    // Update active section based on current path and auth state
    useEffect(() => {
        const path = location.pathname;
        
        // Re-check Tools section when authentication changes
        if (isAuthenticated && path.startsWith('/tools/')) {
            setActiveSection('Tools');
            return;
        }
        
        // Fall back to Sneed Hub if current section doesn't exist
        if (!menuSections[activeSection] && !(isOnAdminPage && adminLoading)) {
            setActiveSection('Sneed Hub');
        }
    }, [activeSection, isAdmin, isAuthenticated, isOnAdminPage, adminLoading, location.pathname]);

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

    // Fetch SNS logo for VP bar
    useEffect(() => {
        const loadSnsLogo = async () => {
            if (!selectedSnsRoot) {
                setSnsLogo(null);
                return;
            }
            
            // For Sneed, use the local logo file
            if (selectedSnsRoot === SNEED_SNS_ROOT) {
                setSnsLogo('sneed_logo.png');
                return;
            }
            
            try {
                const selectedSns = getSnsById(selectedSnsRoot);
                if (!selectedSns?.canisters?.governance) return;
                
                const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                    ? 'https://ic0.app' 
                    : 'http://localhost:4943';
                const agent = new HttpAgent({
                    host,
                    ...(identity && { identity })
                });

                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                    await agent.fetchRootKey();
                }
                
                const logo = await fetchSnsLogo(selectedSns.canisters.governance, agent);
                setSnsLogo(logo);
            } catch (error) {
                console.error('Error loading SNS logo:', error);
                setSnsLogo(null);
            }
        };
        
        loadSnsLogo();
    }, [selectedSnsRoot, identity, SNEED_SNS_ROOT]);

    // Scroll listener for VP bar visibility
    useEffect(() => {
        let ticking = false;
        const scrollDeltaThreshold = 20; // Minimum scroll distance before toggling
        const toggleCooldown = 300; // Minimum ms between visibility toggles
        
        const handleScroll = () => {
            if (ticking) return;
            
            ticking = true;
            requestAnimationFrame(() => {
                const currentScrollY = window.scrollY;
                const scrollDelta = currentScrollY - lastScrollY.current;
                const now = Date.now();
                const timeSinceLastToggle = now - lastToggleTime.current;
                
                // Always show at top of page (no cooldown needed)
                if (currentScrollY < 10) {
                    if (!isVpBarVisible) {
                        setIsVpBarVisible(true);
                        lastToggleTime.current = now;
                    }
                    lastScrollY.current = currentScrollY;
                    ticking = false;
                    return;
                }
                
                // Only change visibility if scroll delta exceeds threshold AND cooldown has passed
                if (Math.abs(scrollDelta) > scrollDeltaThreshold && timeSinceLastToggle > toggleCooldown) {
                    if (scrollDelta < 0 && !isVpBarVisible) {
                        // Scrolling up (page moving down) - show VP bar
                        setIsVpBarVisible(true);
                        lastToggleTime.current = now;
                        lastScrollY.current = currentScrollY;
                    } else if (scrollDelta > 0 && currentScrollY > 50 && isVpBarVisible) {
                        // Scrolling down (page moving up) and past threshold - hide VP bar
                        setIsVpBarVisible(false);
                        lastToggleTime.current = now;
                        lastScrollY.current = currentScrollY;
                    }
                }
                
                // Update scroll position for delta calculation if we've scrolled significantly
                if (Math.abs(scrollDelta) > scrollDeltaThreshold * 2) {
                    lastScrollY.current = currentScrollY;
                }
                
                ticking = false;
            });
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, [isVpBarVisible]);

    const menuSections = {
        'Sneed Hub': {
            icon: <FaNetworkWired size={18} />,
            displayName: 'Sneed Hub',
            defaultPath: '/hub',
            subMenu: [
                { name: 'Hub', path: '/hub' },
                { name: 'SNS', path: '/sns' },
                { name: 'Feed', path: '/feed' },
                { name: 'Forum', path: '/forum' },
                { name: 'Proposals', path: '/proposals' },
                { name: 'Neurons', path: '/neurons' },
                { name: 'Transactions', path: '/transactions' },
                { name: 'Users', path: '/users' }
            ]
        },
        'Sneed Me': {
            icon: <FaUser size={18} />,
            displayName: 'Sneed Me',
            defaultPath: '/me',
            subMenu: [
                { name: 'Me', path: '/me' },
                { name: 'Premium', path: '/premium' },
                { name: 'Messages', path: '/sms' },
                { name: 'Posts', path: '/posts' },
                { name: 'Tips', path: '/tips' },
                { name: 'Rewards', path: '/rewards' },
                { name: 'Wallet', path: '/wallet' },
                { name: 'Canisters', path: '/canisters' },
                { name: 'Address Book', path: '/names' }
            ]
        },
        'Sneedex': {
            icon: <FaExchangeAlt size={18} />,
            displayName: 'Sneedex',
            defaultPath: '/sneedex_offers',
            subMenu: [
                { name: 'Marketplace', path: '/sneedex_offers' },
                { name: 'Create Offer', path: '/sneedex_create' },
                { name: 'My Sneedex', path: '/sneedex_my' },
                { name: 'About', path: '/sneedex' }
            ]
        },
        'Liquid Staking': {
            icon: <FaTint size={18} />,
            displayName: 'Liquid Staking',
            defaultPath: '/liquid_staking',
            subMenu: [
                { name: 'Overview', path: '/liquid_staking' },
                { name: 'ICP Liquid Staking', path: '/create_icp_neuron' },
                { name: 'SNS Liquid Staking', path: '/sns_neuron_wizard' },
            ]
        },
        'Sneed Lock': {
            icon: <FaLock size={18} />,
            displayName: 'Sneed Lock',
            defaultPath: '/lock_wizard',
            subMenu: [
                { name: 'Create Lock', path: '/lock_wizard' },
                { name: 'All Locks', path: '/sneedlock_info' },
                { name: 'Overview', path: '/sneedlock' }
            ]
        },
        'Sneed DAO': {
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

    // Add tools section for all authenticated users
    if (isAuthenticated) {
        menuSections['Tools'] = {
            icon: <FaTools size={18} />,
            displayName: 'Sneed Tools',
            defaultPath: '/tools/main',
            subMenu: [
                { name: 'Tools', path: '/tools/main' },
                { name: 'SNS Jailbreak', path: '/tools/sns_jailbreak' },
                { name: 'My Scripts', path: '/tools/sns_jailbreak_list' }
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
                { name: 'SneedLock', path: '/admin/sneedlock' },
                { name: 'Sneedex', path: '/admin/sneedex' },
                { name: 'SNS Jailbreak', path: '/admin/sns_jailbreak' }
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
        // Toggle the hamburger menu
        setIsMenuOpen(!isMenuOpen);
    };

    // Helper function to determine if a submenu item should be highlighted
    const isSubmenuItemActive = (itemPath) => {
        const currentPath = location.pathname;
        
        // Direct path match
        if (currentPath === itemPath) return true;
        
        // Special case: root path "/" should highlight Hub submenu item
        if (itemPath === '/hub' && currentPath === '/') {
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
        
        // Special handling for Locks submenu item - highlight for sneedlock, tokenlock, positionlock, and lock
        if (itemPath === '/sneedlock' && (['/sneedlock', '/tokenlock', '/positionlock'].includes(currentPath) || currentPath.startsWith('/lock/'))) {
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
                <div ref={menuToggleRef} style={{ display: 'flex', alignItems: 'center', gap: '15px', flex: 1 }}>
                <div style={{ position: 'relative', display: 'inline-block' }}>
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
                    {/* Premium crown overlay */}
                    {isPremium && !premiumLoading && (
                        <div
                            style={{
                                position: 'absolute',
                                top: '-8px',
                                right: '-8px',
                                fontSize: '12px',
                                transform: 'rotate(20deg)',
                                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
                            }}
                            title="Premium Member"
                        >
                            👑
                        </div>
                    )}
                </div>
                
                <div 
                    style={{ 
                        color: theme.colors.primaryText,
                        fontSize: '24px',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer',
                        gap: '10px'
                    }}
                    onClick={() => {
                        setIsMenuOpen(!isMenuOpen);
                    }}
                >
                    {/* Show admin section name if on admin page, even during loading */}
                    {isOnAdminPage && adminLoading ? (
                        <>Admin</>
                    ) : (
                        <>
                            {menuSections[activeSection]?.displayName}
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
                </div>

                {/* SNS Dropdown */}
                {showSnsDropdown && (
                    <SnsDropdown onSnsChange={onSnsChange} />
                )}

                {/* Quick links - shown on wide screens (only if expandQuickLinksOnDesktop is enabled) */}
                {expandQuickLinksOnDesktop && (
                <div className="hide-on-narrow" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <ThemeToggle size="medium" />
                    
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
                            transition: 'background-color 0.2s ease'
                        }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                        title="Go to Feed"
                    >
                        <FaRss size={16} />
                    </button>

                    <button
                        onClick={() => navigate('/forum')}
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
                            transition: 'background-color 0.2s ease'
                        }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                        title="Go to Forum"
                    >
                        <FaComments size={16} />
                    </button>

                    <button
                        onClick={() => navigate('/sneedex_offers')}
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
                            transition: 'background-color 0.2s ease'
                        }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                        title="Go to Sneedex Marketplace"
                    >
                        <FaExchangeAlt size={16} />
                    </button>

                    <button
                        onClick={() => navigate('/liquid_staking')}
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
                            transition: 'background-color 0.2s ease'
                        }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                        title="Go to Liquid Staking"
                    >
                        <FaTint size={16} />
                    </button>

                    <button
                        onClick={() => navigate('/tools/sns_jailbreak')}
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
                            transition: 'background-color 0.2s ease'
                        }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                        title="SNS Jailbreak"
                    >
                        <FaUnlock size={16} />
                    </button>

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
                            transition: 'background-color 0.2s ease'
                        }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                        title="Go to Wallet"
                    >
                        <FaWallet size={16} />
                    </button>

                    <button
                        onClick={() => navigate('/rewards')}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#FFD700',
                            cursor: 'pointer',
                            padding: '4px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            fontSize: '18px',
                            transition: 'background-color 0.2s ease'
                        }}
                        onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                        title="Go to Rewards"
                    >
                        <FaGift size={16} />
                    </button>

                    <button
                        onClick={() => navigate('/premium')}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#FFD700',
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
                        title="Go to Premium"
                    >
                        <FaCrown size={16} />
                    </button>
                </div>
                )}

                {/* Quick links hamburger menu - shown on narrow screens (or always if expandQuickLinksOnDesktop is disabled) */}
                <div className={expandQuickLinksOnDesktop ? "show-on-narrow" : ""} style={{ position: 'relative' }}>
                    <button
                        ref={quickLinksToggleRef}
                        onClick={() => setIsQuickLinksOpen(!isQuickLinksOpen)}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: theme.colors.primaryText,
                            cursor: 'pointer',
                            padding: '6px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            fontSize: '18px',
                            transition: 'background-color 0.2s ease'
                        }}
                        title="Quick Links"
                    >
                        <FaBars size={16} />
                    </button>
                    
                    {isQuickLinksOpen && (
                        <div
                            ref={quickLinksRef}
                            style={{
                                position: 'absolute',
                                top: '100%',
                                right: 0,
                                marginTop: '8px',
                                background: theme.colors.cardGradient,
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: '8px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                                minWidth: '160px',
                                zIndex: 1001,
                                overflow: 'hidden'
                            }}
                        >
                            <button
                                onClick={() => {
                                    navigate('/feed');
                                    setIsQuickLinksOpen(false);
                                }}
                                style={{
                                    width: '100%',
                                    background: 'none',
                                    border: 'none',
                                    color: theme.colors.primaryText,
                                    cursor: 'pointer',
                                    padding: '12px 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    fontSize: '14px',
                                    textAlign: 'left',
                                    transition: 'background-color 0.2s ease'
                                }}
                                onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.secondaryBg}
                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                            >
                                <FaRss size={14} />
                                Feed
                            </button>
                            
                            <button
                                onClick={() => {
                                    navigate('/forum');
                                    setIsQuickLinksOpen(false);
                                }}
                                style={{
                                    width: '100%',
                                    background: 'none',
                                    border: 'none',
                                    color: theme.colors.primaryText,
                                    cursor: 'pointer',
                                    padding: '12px 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    fontSize: '14px',
                                    textAlign: 'left',
                                    transition: 'background-color 0.2s ease'
                                }}
                                onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.secondaryBg}
                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                            >
                                <FaComments size={14} />
                                Forum
                            </button>
                            
                            <button
                                onClick={() => {
                                    navigate('/sneedex_offers');
                                    setIsQuickLinksOpen(false);
                                }}
                                style={{
                                    width: '100%',
                                    background: 'none',
                                    border: 'none',
                                    color: theme.colors.primaryText,
                                    cursor: 'pointer',
                                    padding: '12px 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    fontSize: '14px',
                                    textAlign: 'left',
                                    transition: 'background-color 0.2s ease'
                                }}
                                onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.secondaryBg}
                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                            >
                                <FaExchangeAlt size={14} />
                                Sneedex
                            </button>
                            
                            <button
                                onClick={() => {
                                    navigate('/liquid_staking');
                                    setIsQuickLinksOpen(false);
                                }}
                                style={{
                                    width: '100%',
                                    background: 'none',
                                    border: 'none',
                                    color: theme.colors.primaryText,
                                    cursor: 'pointer',
                                    padding: '12px 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    fontSize: '14px',
                                    textAlign: 'left',
                                    transition: 'background-color 0.2s ease'
                                }}
                                onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.secondaryBg}
                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                            >
                                <FaTint size={14} />
                                Liquid Staking
                            </button>
                            
                            <button
                                onClick={() => {
                                    navigate('/tools/sns_jailbreak');
                                    setIsQuickLinksOpen(false);
                                }}
                                style={{
                                    width: '100%',
                                    background: 'none',
                                    border: 'none',
                                    color: theme.colors.primaryText,
                                    cursor: 'pointer',
                                    padding: '12px 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    fontSize: '14px',
                                    textAlign: 'left',
                                    transition: 'background-color 0.2s ease'
                                }}
                                onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.secondaryBg}
                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                            >
                                <FaUnlock size={14} />
                                SNS Jailbreak
                            </button>
                            
                            <button
                                onClick={() => {
                                    navigate('/wallet');
                                    setIsQuickLinksOpen(false);
                                }}
                                style={{
                                    width: '100%',
                                    background: 'none',
                                    border: 'none',
                                    color: theme.colors.primaryText,
                                    cursor: 'pointer',
                                    padding: '12px 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    fontSize: '14px',
                                    textAlign: 'left',
                                    transition: 'background-color 0.2s ease'
                                }}
                                onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.secondaryBg}
                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                            >
                                <FaWallet size={14} />
                                Wallet
                            </button>
                            
                            <button
                                onClick={() => {
                                    navigate('/rewards');
                                    setIsQuickLinksOpen(false);
                                }}
                                style={{
                                    width: '100%',
                                    background: 'none',
                                    border: 'none',
                                    color: theme.colors.primaryText,
                                    cursor: 'pointer',
                                    padding: '12px 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    fontSize: '14px',
                                    textAlign: 'left',
                                    transition: 'background-color 0.2s ease'
                                }}
                                onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.secondaryBg}
                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                            >
                                <FaGift size={14} />
                                Rewards
                            </button>
                            
                            <button
                                onClick={() => {
                                    navigate('/premium');
                                    setIsQuickLinksOpen(false);
                                }}
                                style={{
                                    width: '100%',
                                    background: 'none',
                                    border: 'none',
                                    color: theme.colors.primaryText,
                                    cursor: 'pointer',
                                    padding: '12px 16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    fontSize: '14px',
                                    textAlign: 'left',
                                    transition: 'background-color 0.2s ease'
                                }}
                                onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.secondaryBg}
                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                            >
                                <FaCrown size={14} style={{ color: '#FFD700' }} />
                                Premium
                            </button>
                            
                            <div style={{ 
                                borderTop: `1px solid ${theme.colors.border}`,
                                padding: '12px 16px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                            }}>
                                <span style={{ color: theme.colors.mutedText, fontSize: '14px' }}>Theme</span>
                                <ThemeToggle size="small" />
                            </div>
                        </div>
                    )}
                </div>

                {isAuthenticated ? (
                    <PrincipalBox 
                        principalText={identity ? identity.getPrincipal().toText() : "Not logged in."}
                        onLogout={logout}
                        compact={true}
                    />
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

            {/* Bottom Row: VP Display - hide if no neurons (don't show loading state if no neurons) */}
            {!isHeaderCollapsed && showSnsDropdown && isAuthenticated && showVpBarSetting && !neuronsLoading && getAllNeurons().length > 0 && (
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    width: '100%',
                    paddingTop: '8px',
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                    marginTop: '8px',
                    maxHeight: isVpBarVisible ? '100px' : '0',
                    overflow: 'hidden',
                    opacity: isVpBarVisible ? 1 : 0,
                    transition: 'max-height 0.3s ease, opacity 0.3s ease, padding 0.3s ease, margin 0.3s ease',
                    ...(isVpBarVisible ? {} : { paddingTop: 0, marginTop: 0, borderTop: 'none' })
                }}>
                    {/* VP Display */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        fontSize: '12px',
                        color: theme.colors.mutedText,
                        flexWrap: 'wrap'
                    }}>
                        {(() => {
                                    const allNeurons = getAllNeurons();
                                    const hotkeyNeurons = getHotkeyNeurons();
                                    
                                    // Calculate hotkeyed VP (only hotkeyed neurons)
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
                                    
                                    // Calculate reachable VP (all neurons)
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
                                    
                                    // Format VP with K, M suffixes
                                    const formatCompactVP = (vp) => {
                                        if (!nervousSystemParameters) return '...';
                                        const displayValue = vp / 100_000_000;
                                        if (displayValue >= 1_000_000) {
                                            return (displayValue / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
                                        } else if (displayValue >= 1_000) {
                                            return (displayValue / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
                                        }
                                        return displayValue.toFixed(displayValue < 10 ? 1 : 0).replace(/\.0$/, '');
                                    };
                                    
                                    // Calculate additional reachable neurons (not hotkeyed)
                                    const additionalNeuronsCount = allNeurons.length - hotkeyNeurons.length;
                                    const hasAdditionalReachable = reachableVP > hotkeyedVP;
                                    
                                    // Don't show VP bar if no VP
                                    if (hotkeyedVP === 0 && reachableVP === 0) {
                                        return null;
                                    }
                                    
                                    return (
                                        <>
                                            {/* Brain icon with SNS logo overlay - Your neurons label (desktop only) */}
                                            <div 
                                                className="hide-on-narrow"
                                                style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: '4px',
                                                    color: theme.colors.mutedText,
                                                    fontSize: '11px'
                                                }}
                                            >
                                                <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: '24px', height: '16px' }}>
                                                    <FaBrain size={14} style={{ color: theme.colors.mutedText }} />
                                                    {snsLogo && (
                                                        <img 
                                                            src={snsLogo} 
                                                            alt="SNS" 
                                                            style={{ 
                                                                position: 'absolute', 
                                                                left: '8px', 
                                                                top: '50%', 
                                                                transform: 'translateY(-50%)', 
                                                                width: '14px', 
                                                                height: '14px', 
                                                                borderRadius: '50%', 
                                                                objectFit: 'cover',
                                                                border: `1px solid ${theme.colors.secondaryBg}`
                                                            }} 
                                                        />
                                                    )}
                                                </span>
                                            </div>
                                            
                                            {/* Hotkeyed neurons (hotkeyed + owned) */}
                                            <div 
                                                style={{ 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    gap: '4px'
                                                }}
                                                title="Hotkeyed and owned neurons - can vote on SNS proposals"
                                            >
                                                <FaKey size={12} style={{ color: theme.colors.secondaryText }} />
                                                {/* Desktop: full labels */}
                                                <span className="hide-on-narrow" style={{ color: theme.colors.secondaryText, fontSize: '11px' }}>
                                                    {formatCompactVP(hotkeyedVP)} VP
                                                </span>
                                                <span className="hide-on-narrow" style={{ color: theme.colors.mutedText, fontSize: '11px' }}>
                                                    hotkeys ({hotkeyNeurons.length})
                                                </span>
                                                {/* Mobile: compact */}
                                                <span className="show-on-narrow" style={{ color: theme.colors.secondaryText, fontSize: '11px' }}>
                                                    {formatCompactVP(hotkeyedVP)} VP ({hotkeyNeurons.length})
                                                </span>
                                            </div>
                                            
                                            {/* Reachable neurons - only show if there are additional neurons beyond hotkeyed */}
                                            {hasAdditionalReachable && (
                                                <div 
                                                    style={{ 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        gap: '4px'
                                                    }}
                                                    title="Additional neurons found by the same owner but not hotkeyed - for forum voting"
                                                >
                                                    <FaHandPaper size={12} style={{ color: theme.colors.secondaryText }} />
                                                    {/* Desktop: full labels */}
                                                    <span className="hide-on-narrow" style={{ color: theme.colors.secondaryText, fontSize: '11px' }}>
                                                        {formatCompactVP(reachableVP)} VP
                                                    </span>
                                                    <span className="hide-on-narrow" style={{ color: theme.colors.mutedText, fontSize: '11px' }}>
                                                        reachable (+{additionalNeuronsCount})
                                                    </span>
                                                    {/* Mobile: compact */}
                                                    <span className="show-on-narrow" style={{ color: theme.colors.secondaryText, fontSize: '11px' }}>
                                                        {formatCompactVP(reachableVP)} VP (+{additionalNeuronsCount})
                                                    </span>
                                                </div>
                                            )}
                                        </>
                                    );
                        })()}
                    </div>
                    
                    {/* Close button */}
                    <button
                        onClick={() => {
                            localStorage.setItem('showVpBar', JSON.stringify(false));
                            window.dispatchEvent(new CustomEvent('showVpBarChanged', { detail: false }));
                        }}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: theme.colors.mutedText,
                            cursor: 'pointer',
                            padding: '4px 6px',
                            fontSize: '12px',
                            opacity: 0.5,
                            transition: 'opacity 0.2s ease',
                            flexShrink: 0
                        }}
                        onMouseEnter={(e) => e.target.style.opacity = 1}
                        onMouseLeave={(e) => e.target.style.opacity = 0.5}
                        title="Hide VP bar (re-enable in Settings)"
                    >
                        ✕
                    </button>
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