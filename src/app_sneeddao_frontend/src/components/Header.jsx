import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FaWallet, FaLock, FaUser, FaBuilding, FaNetworkWired, FaCog, FaTools, FaSignInAlt, FaChevronDown, FaChevronUp, FaRss, FaQuestionCircle, FaExchangeAlt, FaTint, FaBars, FaComments, FaUnlock, FaCrown, FaGift, FaBrain, FaKey, FaHandPaper, FaBell, FaEnvelope, FaCoins, FaSync, FaVoteYea, FaCloudDownloadAlt, FaBolt, FaRobot, FaCubes, FaChartLine } from 'react-icons/fa';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { headerStyles } from '../styles/HeaderStyles';
import PrincipalBox from '../PrincipalBox';
import SnsDropdown from './SnsDropdown';
import ThemeToggle from './ThemeToggle';
import { useAdminCheck } from '../hooks/useAdminCheck';
import usePremiumStatus from '../hooks/usePremiumStatus';
import { useWalletOptional } from '../contexts/WalletContext';
import { useSns } from '../contexts/SnsContext';
import { useTipNotifications } from '../hooks/useTipNotifications';
import { useReplyNotifications } from '../hooks/useReplyNotifications';
import { useVotableProposalsNotifications } from '../hooks/useVotableProposalsNotifications';
import { useSmsNotifications } from '../hooks/useSmsNotifications';
import { useCollectiblesNotifications } from '../hooks/useCollectiblesNotifications';
import ConsolidateModal from '../ConsolidateModal';
import { calculateVotingPower, formatVotingPower } from '../utils/VotingPowerUtils';
import { createActor as createSnsGovernanceActor } from 'external/sns_governance';
import { getSnsById, fetchSnsLogo } from '../utils/SnsUtils';
import { safePrincipalString, safePermissionType } from '../utils/NeuronUtils';
import { HttpAgent } from '@dfinity/agent';
import { useFrontendUpdate } from '../contexts/FrontendUpdateContext';
import { useOutdatedBotsNotification } from '../hooks/useOutdatedBotsNotification';
import { useLowCyclesNotification } from '../hooks/useLowCyclesNotification';
import { useBotChoreNotification } from '../hooks/useBotChoreNotification';
import { useBotLogNotification } from '../hooks/useBotLogNotification';
import UpgradeBotsDialog from './UpgradeBotsDialog';
import BotHealthDialog from './BotHealthDialog';
import TopUpCyclesDialog from './TopUpCyclesDialog';

function Header({ showTotalValue, showSnsDropdown, onSnsChange, customLogo }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { isAuthenticated, identity, login, logout } = useAuth();
    const { theme } = useTheme();
    const { selectedSnsRoot, SNEED_SNS_ROOT } = useSns();
    
    // Use WalletContext's global neuron cache for user neurons
    const walletContext = useWalletOptional();
    const getCachedNeurons = walletContext?.getCachedNeurons;
    const neuronCacheInitialized = walletContext?.neuronCacheInitialized;
    const neuronCache = walletContext?.neuronCache;
    const refreshAllNeurons = walletContext?.refreshAllNeurons;
    
    // Get neurons for the selected SNS from the global cache
    const [userNeurons, setUserNeurons] = useState([]);
    const [neuronsLoading, setNeuronsLoading] = useState(true);
    
    useEffect(() => {
        if (!isAuthenticated || !identity || !selectedSnsRoot) {
            setUserNeurons([]);
            setNeuronsLoading(false);
            return;
        }
        
        const selectedSns = getSnsById(selectedSnsRoot);
        if (!selectedSns?.canisters?.governance) {
            setUserNeurons([]);
            setNeuronsLoading(false);
            return;
        }
        
        if (getCachedNeurons) {
            const neurons = getCachedNeurons(selectedSns.canisters.governance);
            setUserNeurons(neurons || []);
            setNeuronsLoading(!neuronCacheInitialized);
        } else {
            setUserNeurons([]);
            setNeuronsLoading(false);
        }
    }, [isAuthenticated, identity, selectedSnsRoot, getCachedNeurons, neuronCacheInitialized, neuronCache]);
    
    // Helper functions matching the old NeuronsContext API
    const getAllNeurons = () => userNeurons;
    
    const getHotkeyNeurons = () => {
        if (!identity) return [];
        const userPrincipalStr = identity.getPrincipal().toString();
        
        return userNeurons.filter(neuron => 
            neuron.permissions?.some(p => {
                const permPrincipal = safePrincipalString(p.principal);
                if (!permPrincipal || permPrincipal !== userPrincipalStr) return false;
                // Safe array check for cached data using shared utility
                const permTypes = safePermissionType(p);
                return permTypes.includes(4); // Hotkey permission (Vote)
            })
        );
    };
    const { newTipCount } = useTipNotifications();
    const { newReplyCount } = useReplyNotifications();
    const { newMessageCount } = useSmsNotifications();
    const { 
        collectiblesCount, 
        collectiblesItems, 
        isModalOpen: isCollectModalOpen, 
        openModal: openCollectModal, 
        closeModal: closeCollectModal,
        handleConsolidate 
    } = useCollectiblesNotifications();
    const { votableCount } = useVotableProposalsNotifications();
    const {
        outdatedCount,
        outdatedManagers: outdatedBots,
        latestOfficialVersion: latestBotVersion,
        isDialogOpen: isUpgradeDialogOpen,
        openDialog: openUpgradeDialog,
        closeDialog: closeUpgradeDialog,
    } = useOutdatedBotsNotification();
    const {
        lowCyclesCount,
        lowCyclesCanisters,
        isDialogOpen: isTopUpDialogOpen,
        openDialog: openTopUpDialog,
        closeDialog: closeTopUpDialog,
    } = useLowCyclesNotification();
    const {
        unhealthyManagers: choreUnhealthyManagers,
    } = useBotChoreNotification();
    const {
        botsWithAlerts: logAlertBots,
    } = useBotLogNotification();

    // Unified bot health dialog state (chore issues + log alerts combined)
    const [isBotHealthDialogOpen, setIsBotHealthDialogOpen] = React.useState(false);
    const openBotHealthDialog = React.useCallback(() => setIsBotHealthDialogOpen(true), []);
    const closeBotHealthDialog = React.useCallback(() => setIsBotHealthDialogOpen(false), []);

    // Combined badge count: chore-unhealthy bots + bots-with-log-alerts (deduplicated)
    const botHealthCount = React.useMemo(() => {
        const seen = new Set();
        for (const m of choreUnhealthyManagers) seen.add(m.canisterId);
        for (const b of logAlertBots) seen.add(b.canisterId);
        return seen.size;
    }, [choreUnhealthyManagers, logAlertBots]);
    const botHealthColor = React.useMemo(() => {
        const hasChoreError = choreUnhealthyManagers.some(m => m.lamp === 'error');
        const hasLogError = logAlertBots.some(b => (b.unseenErrorCount || 0) > 0);
        return (hasChoreError || hasLogError) ? '#ef4444' : '#f59e0b';
    }, [choreUnhealthyManagers, logAlertBots]);
    const frontendUpdate = useFrontendUpdate();
    const hasUpdateAvailable = frontendUpdate?.hasUpdateAvailable ?? false;
    const countdownSeconds = frontendUpdate?.countdownSeconds ?? 0;
    const triggerRefresh = frontendUpdate?.triggerRefresh;
    const autoUpdateEnabled = frontendUpdate?.autoUpdateEnabled ?? false;
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
    const [showHeaderNotificationsSetting, setShowHeaderNotificationsSetting] = useState(() => {
        try {
            const saved = localStorage.getItem('showHeaderNotifications');
            return saved !== null ? JSON.parse(saved) : true; // Default to enabled
        } catch (error) {
            return true;
        }
    });
    // Per-notification-type visibility settings
    const readNotifySetting = (key) => {
        try { const s = localStorage.getItem(key); return s !== null ? JSON.parse(s) : true; } catch { return true; }
    };
    const [notifyRepliesSetting, setNotifyRepliesSetting] = useState(() => readNotifySetting('notifyReplies'));
    const [notifyTipsSetting, setNotifyTipsSetting] = useState(() => readNotifySetting('notifyTips'));
    const [notifyMessagesSetting, setNotifyMessagesSetting] = useState(() => readNotifySetting('notifyMessages'));
    const [notifyCollectiblesSetting, setNotifyCollectiblesSetting] = useState(() => readNotifySetting('notifyCollectibles'));
    const [notifyVotableProposalsSetting, setNotifyVotableProposalsSetting] = useState(() => readNotifySetting('notifyVotableProposals'));
    const [notifyOutdatedBotsSetting, setNotifyOutdatedBotsSetting] = useState(() => readNotifySetting('notifyOutdatedBots'));
    const [notifyLowCyclesSetting, setNotifyLowCyclesSetting] = useState(() => readNotifySetting('notifyLowCycles'));
    const [notifyBotChoresSetting, setNotifyBotChoresSetting] = useState(() => readNotifySetting('notifyBotChores'));
    const [notifyBotLogErrorsSetting, setNotifyBotLogErrorsSetting] = useState(() => readNotifySetting('notifyBotLogErrors'));
    const [notifyUpdatesSetting, setNotifyUpdatesSetting] = useState(() => readNotifySetting('notifyUpdates'));
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
        if (['/', '/hub', '/sns', '/proposals', '/neurons', '/transactions', '/neuron', '/proposal', '/transaction', '/principal', '/user', '/users', '/canisters', '/forum', '/feed', '/thread', '/post'].includes(path) || location.pathname.startsWith('/topic/')) return 'Sneed Hub';
        if (['/liquid_staking', '/sns_neuron_wizard', '/create_icp_neuron'].includes(path) || path.startsWith('/icp_neuron_manager')) return 'Liquid Staking';
        if (['/me', '/names', '/premium', '/rewards', '/tips', '/posts', '/sms', '/wallet', '/canister', '/apps', '/active_proposals'].includes(path)) return 'Sneed Me';
        if (['/dao', '/dao_info', '/rll_info', '/rll', '/products', '/partners', '/projects', '/disclaimer'].includes(path)) return 'Sneed DAO';
        if (['/sneedlock', '/sneedlock_info', '/tokenlock', '/positionlock', '/lock_wizard'].includes(path) || path.startsWith('/lock/')) return 'Sneed Lock';
        if (['/sneedex', '/sneedex_offers', '/sneedex_create', '/sneedex_my', '/swap'].includes(path) || path.startsWith('/sneedex_offer/')) return 'Sneedex';
        if (['/tools/main', '/tools/sns_jailbreak', '/tools/sns_jailbreak_list'].includes(path) || path.startsWith('/tools/')) return 'Tools';
        if (['/admin'].includes(path) || location.pathname.startsWith('/admin/')) return 'Admin';
        if (['/help'].includes(path) || location.pathname.startsWith('/help/')) return 'Help';
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
            if (e.key === 'showHeaderNotifications') {
                try {
                    setShowHeaderNotificationsSetting(e.newValue !== null ? JSON.parse(e.newValue) : true);
                } catch (error) {
                    setShowHeaderNotificationsSetting(true);
                }
            }
            // Per-notification-type storage changes (cross-tab)
            const notifyStorageMap = {
                notifyReplies: setNotifyRepliesSetting,
                notifyTips: setNotifyTipsSetting,
                notifyMessages: setNotifyMessagesSetting,
                notifyCollectibles: setNotifyCollectiblesSetting,
                notifyVotableProposals: setNotifyVotableProposalsSetting,
                notifyOutdatedBots: setNotifyOutdatedBotsSetting,
                notifyLowCycles: setNotifyLowCyclesSetting,
                notifyBotChores: setNotifyBotChoresSetting,
                notifyBotLogErrors: setNotifyBotLogErrorsSetting,
                notifyUpdates: setNotifyUpdatesSetting,
            };
            const setter = notifyStorageMap[e.key];
            if (setter) {
                try { setter(e.newValue !== null ? JSON.parse(e.newValue) : true); } catch { setter(true); }
            }
        };
        
        // Listen for custom event (when setting is changed on the same page)
        const handleVpBarChanged = (e) => {
            setShowVpBarSetting(e.detail);
        };

        const handleHeaderNotificationsChanged = (e) => {
            setShowHeaderNotificationsSetting(e.detail);
        };
        
        const handleExpandQuickLinksChanged = (e) => {
            setExpandQuickLinksOnDesktop(e.detail);
        };

        const notifySetterMap = {
            notifyReplies: setNotifyRepliesSetting,
            notifyTips: setNotifyTipsSetting,
            notifyMessages: setNotifyMessagesSetting,
            notifyCollectibles: setNotifyCollectiblesSetting,
            notifyVotableProposals: setNotifyVotableProposalsSetting,
            notifyOutdatedBots: setNotifyOutdatedBotsSetting,
            notifyLowCycles: setNotifyLowCyclesSetting,
            notifyBotChores: setNotifyBotChoresSetting,
            notifyBotLogErrors: setNotifyBotLogErrorsSetting,
            notifyUpdates: setNotifyUpdatesSetting,
        };

        const handleNotifySettingChanged = (e) => {
            const { key, value } = e.detail;
            const setter = notifySetterMap[key];
            if (setter) setter(value);
        };
        
        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('showVpBarChanged', handleVpBarChanged);
        window.addEventListener('showHeaderNotificationsChanged', handleHeaderNotificationsChanged);
        window.addEventListener('expandQuickLinksOnDesktopChanged', handleExpandQuickLinksChanged);
        window.addEventListener('notifySettingChanged', handleNotifySettingChanged);
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('showVpBarChanged', handleVpBarChanged);
            window.removeEventListener('showHeaderNotificationsChanged', handleHeaderNotificationsChanged);
            window.removeEventListener('expandQuickLinksOnDesktopChanged', handleExpandQuickLinksChanged);
            window.removeEventListener('notifySettingChanged', handleNotifySettingChanged);
        };
    }, []);

    // Update active section when location changes
    useEffect(() => {
        const path = location.pathname;
        // Check /msg paths first to avoid conflicts
        if (path.startsWith('/msg')) {
            setActiveSection('Sneed Me');
        } else if (['/', '/hub', '/sns', '/proposals', '/neurons', '/transactions', '/neuron', '/proposal', '/transaction', '/principal', '/user', '/users', '/canisters', '/forum', '/feed', '/thread', '/post'].includes(path) || path.startsWith('/topic/')) {
            setActiveSection('Sneed Hub');
        } else if (['/liquid_staking', '/sns_neuron_wizard', '/create_icp_neuron'].includes(path) || path.startsWith('/icp_neuron_manager')) {
            setActiveSection('Liquid Staking');
        } else if (['/me', '/names', '/premium', '/rewards', '/tips', '/posts', '/sms', '/wallet', '/canister', '/apps', '/active_proposals'].includes(path)) {
            setActiveSection('Sneed Me');
        } else if (['/dao', '/dao_info', '/rll_info', '/rll', '/products', '/partners', '/projects', '/disclaimer'].includes(path)) {
            setActiveSection('Sneed DAO');
        } else if (['/sneedlock', '/sneedlock_info', '/tokenlock', '/positionlock', '/lock_wizard'].includes(path) || path.startsWith('/lock/')) {
            setActiveSection('Sneed Lock');
        } else if (['/sneedex', '/sneedex_offers', '/sneedex_create', '/sneedex_my'].includes(path) || path.startsWith('/sneedex_offer/')) {
            setActiveSection('Sneedex');
        } else if (['/admin'].includes(path) || path.startsWith('/admin/')) {
            setActiveSection('Admin');
        } else if (['/help'].includes(path) || path.startsWith('/help/')) {
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

    // Memoized calculation of total VP for the header bar condition
    const totalUserVP = useMemo(() => {
        if (!nervousSystemParameters) return 0;
        const allNeurons = getAllNeurons();
        return allNeurons.reduce((total, neuron) => {
            try {
                const votingPower = calculateVotingPower(neuron, nervousSystemParameters);
                return total + votingPower;
            } catch (error) {
                return total;
            }
        }, 0);
    }, [userNeurons, nervousSystemParameters]);

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
                { name: 'Users', path: '/users' },
                { name: 'Canisters', path: '/canisters' }
            ]
        },
        'Sneed Me': {
            icon: <FaUser size={18} />,
            displayName: 'Sneed Me',
            defaultPath: '/me',
            subMenu: [
                { name: 'Me', path: '/me' },
                { name: 'Wallet', path: '/wallet' },
                { name: 'Apps', path: '/apps' },
                { name: 'Voting', path: '/active_proposals' },
                { name: 'Messages', path: '/sms' },
                { name: 'Posts', path: '/posts' },
                { name: 'Tips', path: '/tips' },
                { name: 'Rewards', path: '/rewards' },
                { name: 'Address Book', path: '/names' },
                { name: 'Premium', path: '/premium' }
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
        'Sneedex': {
            icon: <FaExchangeAlt size={18} />,
            displayName: 'Sneedex',
            defaultPath: '/sneedex_offers',
            subMenu: [
                { name: 'Swap', path: '/swap' },
                { name: 'Marketplace', path: '/sneedex_offers' },
                { name: 'Create Offer', path: '/sneedex_create' },
                { name: 'My Sneedex', path: '/sneedex_my' },
                { name: 'About', path: '/sneedex' }
            ]
        },
        'Sneedapp': {
            icon: <FaCubes size={18} />,
            displayName: 'Sneedapp',
            defaultPath: '/sneedapp',
            subMenu: [
                { name: 'Browse Apps', path: '/sneedapp' },
                { name: 'ICP Staking Bot', path: '/create_icp_neuron' },
                { name: 'Trading Bot', path: '/sneedapp' },
                { name: 'My Canisters', path: '/apps' },
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
        'Help': {
            icon: <FaQuestionCircle size={18} />,
            displayName: 'Help',
            defaultPath: '/help',
            subMenu: [
                { name: 'Help', path: '/help' }
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
                { name: 'Sneedapp', path: '/admin/sneedapp' },
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
            <div style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '15px', boxSizing: 'border-box' }}>
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
                        fontSize: 'clamp(16px, 4vw, 24px)',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        cursor: 'pointer',
                        gap: '8px',
                        whiteSpace: 'nowrap'
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
                    
                    {/* Subtle collapse/expand pill */}
                    <span
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleHeaderCollapse();
                        }}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: isHeaderCollapsed ? '1px 6px' : '1px 5px',
                            borderRadius: '8px',
                            backgroundColor: 'rgba(255, 255, 255, 0.08)',
                            cursor: 'pointer',
                            opacity: 0.5,
                            transition: 'opacity 0.2s ease, background-color 0.2s ease',
                            alignSelf: 'flex-end',
                            marginBottom: '2px',
                            fontSize: '10px',
                            fontWeight: 'bold',
                            letterSpacing: isHeaderCollapsed ? '1px' : '0px',
                            color: theme.colors.mutedText,
                            lineHeight: 1
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = '0.9';
                            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = '0.5';
                            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                        }}
                        title={isHeaderCollapsed ? "Expand header" : "Collapse header"}
                    >
                        {isHeaderCollapsed ? '...' : '−'}
                    </span>
                    {/* Update badge - always visible in header when update available (independent of notification bar) */}
                    {hasUpdateAvailable && (
                        <span
                            onClick={(e) => {
                                e.stopPropagation();
                                triggerRefresh?.();
                            }}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 8px',
                                borderRadius: '8px',
                                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.1))',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                cursor: 'pointer',
                                fontSize: '10px',
                                fontWeight: '600',
                                color: '#10b981',
                                marginLeft: '4px',
                            }}
                            title={autoUpdateEnabled ? "New version - Click to refresh now or wait for auto-refresh" : "New version - Click to refresh"}
                        >
                            <FaCloudDownloadAlt size={9} />
                            {autoUpdateEnabled ? `${countdownSeconds}s` : 'Update'}
                        </span>
                    )}
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
                        onClick={() => navigate('/swap')}
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
                        title="Swap"
                    >
                        <FaExchangeAlt size={16} />
                    </button>

                    <button
                        onClick={() => navigate('/sms')}
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
                        title="Messages"
                    >
                        <FaEnvelope size={16} />
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
                                    navigate('/swap');
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
                                Swap
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
                                    navigate('/sms');
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
                                <FaEnvelope size={14} />
                                Messages
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
                paddingTop: '6px',
                borderTop: '1px solid rgba(255,255,255,0.1)',
                marginTop: '6px',
                boxSizing: 'border-box'
            }}>
                <div style={{ 
                    display: 'flex', 
                    gap: '6px',
                    columnGap: '4px',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    rowGap: '4px'
                }}>
                    {/* Show loading state if on admin page and waiting for admin check */}
                    {isOnAdminPage && adminLoading ? (
                        <div style={{
                            color: theme.colors.mutedText,
                            fontSize: '13px',
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
                                        color: isActive ? '#fff' : theme.colors.secondaryText,
                                        textDecoration: 'none',
                                        fontSize: '13px',
                                        fontWeight: isActive ? '600' : '500',
                                        padding: '4px 10px',
                                        borderRadius: '14px',
                                        background: isActive 
                                            ? 'linear-gradient(135deg, #8b5cf6, #7c3aed)'
                                            : 'transparent',
                                        border: isActive 
                                            ? 'none'
                                            : 'none',
                                        transition: 'all 0.15s ease',
                                        whiteSpace: 'nowrap'
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isActive) {
                                            e.currentTarget.style.background = 'rgba(139, 92, 246, 0.15)';
                                            e.currentTarget.style.color = theme.colors.primaryText;
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isActive) {
                                            e.currentTarget.style.background = 'transparent';
                                            e.currentTarget.style.color = theme.colors.secondaryText;
                                        }
                                    }}
                                >
                                    {item.name}
                                </Link>
                            );
                        })
                    )}
                    {showTotalValue && (
                        <div style={{ 
                            color: theme.colors.primaryText,
                            fontSize: '13px',
                            fontWeight: 'bold',
                            marginLeft: '8px',
                            padding: '4px 10px',
                            borderRadius: '14px',
                            background: 'rgba(16, 185, 129, 0.15)'
                        }}>
                            ${showTotalValue}
                        </div>
                    )}
                </div>
            </div>
            )}

            {/* Bottom Row: VP Display - hide if no neurons or no VP for this SNS */}
            {!isHeaderCollapsed && showSnsDropdown && isAuthenticated && showVpBarSetting && !neuronsLoading && getAllNeurons().length > 0 && totalUserVP > 0 && (
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
                    boxSizing: 'border-box',
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
                    {/* Refresh neurons button - sync cache after transfer, Sneedex, etc. */}
                    {refreshAllNeurons && (
                        <button
                            onClick={async () => {
                                try {
                                    await refreshAllNeurons();
                                } catch (e) {
                                    console.warn('Failed to refresh neurons:', e);
                                }
                            }}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: theme.colors.mutedText,
                                cursor: 'pointer',
                                padding: '4px 6px',
                                fontSize: '12px',
                                opacity: 0.6,
                                transition: 'opacity 0.2s ease',
                                flexShrink: 0
                            }}
                            onMouseEnter={(e) => { e.target.style.opacity = 1; }}
                            onMouseLeave={(e) => { e.target.style.opacity = 0.6; }}
                            title="Refresh neurons (e.g. after transfer, Sneedex claim, or permission change)"
                        >
                            <FaSync size={12} />
                        </button>
                    )}
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

            {/* Notifications Row: Shows when there are notifications or update available */}
            {!isHeaderCollapsed && ((hasUpdateAvailable && notifyUpdatesSetting) || (showHeaderNotificationsSetting && isAuthenticated && ((notifyRepliesSetting && newReplyCount > 0) || (notifyTipsSetting && newTipCount > 0) || (notifyMessagesSetting && newMessageCount > 0) || (notifyCollectiblesSetting && collectiblesCount > 0) || (notifyVotableProposalsSetting && votableCount > 0) || (notifyOutdatedBotsSetting && outdatedCount > 0) || (notifyLowCyclesSetting && lowCyclesCount > 0) || ((notifyBotChoresSetting || notifyBotLogErrorsSetting) && botHealthCount > 0)))) && (
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    flexWrap: 'wrap',
                    gap: '6px',
                    width: '100%',
                    paddingTop: '10px',
                    borderTop: '1px solid rgba(139, 92, 246, 0.2)',
                    marginTop: '10px',
                    boxSizing: 'border-box'
                }}>
                    {/* Notifications Label */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        color: theme.colors.mutedText,
                        fontSize: '0.7rem',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        marginRight: '2px',
                    }}>
                        <FaBell size={10} />
                    </div>
                        {/* Update Available - click to refresh now */}
                        {hasUpdateAvailable && notifyUpdatesSetting && (
                            <div 
                                onClick={() => triggerRefresh?.()}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '3px 8px',
                                    background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.1))',
                                    border: '1px solid rgba(16, 185, 129, 0.3)',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    color: '#10b981',
                                    transition: 'all 0.2s ease',
                                    whiteSpace: 'nowrap',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                                title={autoUpdateEnabled ? "New version available - Click to refresh now or wait for auto-refresh" : "New version available - Click to refresh"}
                            >
                                <FaCloudDownloadAlt size={10} />
                                <span>Update</span>
                                {autoUpdateEnabled && (
                                    <span style={{ opacity: 0.9, fontWeight: 500 }}>({countdownSeconds}s)</span>
                                )}
                            </div>
                        )}
                        
                        {/* Reply Notifications */}
                        {notifyRepliesSetting && newReplyCount > 0 && (
                            <div 
                                onClick={() => navigate('/posts')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '3px 8px',
                                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(139, 92, 246, 0.1))',
                                    border: '1px solid rgba(139, 92, 246, 0.3)',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    color: '#a78bfa',
                                    transition: 'all 0.2s ease',
                                    whiteSpace: 'nowrap',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                                title={`${newReplyCount} new ${newReplyCount === 1 ? 'reply' : 'replies'}`}
                            >
                                <FaComments size={10} />
                                <span>{newReplyCount}</span>
                            </div>
                        )}
                        
                        {/* SMS Notifications */}
                        {notifyMessagesSetting && newMessageCount > 0 && (
                            <div 
                                onClick={() => navigate('/sms')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '3px 8px',
                                    background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(59, 130, 246, 0.1))',
                                    border: '1px solid rgba(59, 130, 246, 0.3)',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    color: '#60a5fa',
                                    transition: 'all 0.2s ease',
                                    whiteSpace: 'nowrap',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                                title={`${newMessageCount} new ${newMessageCount === 1 ? 'message' : 'messages'}`}
                            >
                                <FaEnvelope size={10} />
                                <span>{newMessageCount}</span>
                            </div>
                        )}
                        
                        {/* Votable Proposals Notifications */}
                        {notifyVotableProposalsSetting && votableCount > 0 && (
                            <div 
                                onClick={() => navigate('/active_proposals')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '3px 8px',
                                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(139, 92, 246, 0.1))',
                                    border: '1px solid rgba(139, 92, 246, 0.3)',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    color: '#a78bfa',
                                    transition: 'all 0.2s ease',
                                    whiteSpace: 'nowrap',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                                title={`${votableCount} proposal${votableCount === 1 ? '' : 's'} to vote on`}
                            >
                                <FaVoteYea size={10} />
                                <span>{votableCount}</span>
                            </div>
                        )}
                        
                        {/* Tip Notifications */}
                        {notifyTipsSetting && newTipCount > 0 && (
                            <div 
                                onClick={() => navigate('/tips')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '3px 8px',
                                    background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2), rgba(245, 158, 11, 0.1))',
                                    border: '1px solid rgba(245, 158, 11, 0.3)',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    color: '#fbbf24',
                                    transition: 'all 0.2s ease',
                                    whiteSpace: 'nowrap',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                                title={`${newTipCount} new ${newTipCount === 1 ? 'tip' : 'tips'}`}
                            >
                                <FaCoins size={10} />
                                <span>{newTipCount}</span>
                            </div>
                        )}
                        
                        {/* Collectibles/Rewards Notifications */}
                        {notifyCollectiblesSetting && collectiblesCount > 0 && (
                            <div 
                                onClick={openCollectModal}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '3px 8px',
                                    background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.1))',
                                    border: '1px solid rgba(16, 185, 129, 0.3)',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    color: '#34d399',
                                    transition: 'all 0.2s ease',
                                    whiteSpace: 'nowrap',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                                title={`${collectiblesCount} ${collectiblesCount === 1 ? 'item' : 'items'} to collect worth $${collectiblesItems.reduce((sum, item) => sum + (item.usdValue || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (fees, rewards, maturity)`}
                            >
                                <FaGift size={10} />
                                <span>{collectiblesCount}</span>
                            </div>
                        )}
                        
                        {/* Low Cycles */}
                        {notifyLowCyclesSetting && lowCyclesCount > 0 && (
                            <div 
                                onClick={openTopUpDialog}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '3px 8px',
                                    borderRadius: '12px',
                                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(239, 68, 68, 0.1))',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    color: '#ef4444',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    whiteSpace: 'nowrap',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                                title={`${lowCyclesCount} canister${lowCyclesCount !== 1 ? 's' : ''} low on cycles`}
                            >
                                <FaBolt size={10} />
                                <span>{lowCyclesCount}</span>
                            </div>
                        )}

                        {/* Outdated Bots */}
                        {notifyOutdatedBotsSetting && outdatedCount > 0 && (
                            <div 
                                onClick={openUpgradeDialog}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '3px 8px',
                                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(139, 92, 246, 0.1))',
                                    border: '1px solid rgba(139, 92, 246, 0.3)',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    color: '#8b5cf6',
                                    transition: 'all 0.2s ease',
                                    whiteSpace: 'nowrap',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                                title={`${outdatedCount} bot${outdatedCount !== 1 ? 's' : ''} can be upgraded`}
                            >
                                <FaBrain size={10} />
                                <span>{outdatedCount}</span>
                            </div>
                        )}

                        {/* Bot Health (chore issues + log alerts combined) */}
                        {(notifyBotChoresSetting || notifyBotLogErrorsSetting) && botHealthCount > 0 && (
                            <div 
                                onClick={openBotHealthDialog}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '3px 8px',
                                    background: `linear-gradient(135deg, ${botHealthColor}33, ${botHealthColor}1a)`,
                                    border: `1px solid ${botHealthColor}4d`,
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    color: botHealthColor,
                                    transition: 'all 0.2s ease',
                                    whiteSpace: 'nowrap',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                                title={`${botHealthCount} bot${botHealthCount !== 1 ? 's' : ''} need attention`}
                            >
                                <FaRobot size={10} />
                                <span>{botHealthCount}</span>
                            </div>
                        )}
                </div>
            )}
            
            {/* Upgrade Bots Dialog (from header notification) */}
            <UpgradeBotsDialog
                isOpen={isUpgradeDialogOpen}
                onClose={closeUpgradeDialog}
                outdatedManagers={outdatedBots}
                latestVersion={latestBotVersion}
                onUpgradeComplete={() => {
                    // Trigger refresh of manager data
                    window.dispatchEvent(new Event('neuronManagersRefresh'));
                }}
            />

            {/* Unified Bot Health Dialog (chore issues + log alerts) */}
            <BotHealthDialog
                isOpen={isBotHealthDialogOpen}
                onClose={closeBotHealthDialog}
                unhealthyManagers={choreUnhealthyManagers}
                botsWithAlerts={logAlertBots}
            />

            {/* Top Up Cycles Dialog (from header notification) */}
            <TopUpCyclesDialog
                isOpen={isTopUpDialogOpen}
                onClose={closeTopUpDialog}
                lowCyclesCanisters={lowCyclesCanisters}
                onTopUpComplete={() => {
                    window.dispatchEvent(new Event('neuronManagersRefresh'));
                }}
            />
            
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
            
            {/* Collect All Modal */}
            <ConsolidateModal
                isOpen={isCollectModalOpen}
                onClose={closeCollectModal}
                type="all"
                items={collectiblesItems}
                onConsolidate={handleConsolidate}
            />
        </header>
    );
}

export default Header; 