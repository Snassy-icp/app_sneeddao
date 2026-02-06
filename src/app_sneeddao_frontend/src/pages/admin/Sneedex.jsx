import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { useTheme } from '../../contexts/ThemeContext';
import Header from '../../components/Header';
import { Principal } from '@dfinity/principal';
import { HttpAgent } from '@dfinity/agent';
import { createSneedexActor, formatFeeRate, formatAmount } from '../../utils/SneedexUtils';

const getHost = () => process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' ? 'https://icp0.io' : 'http://localhost:4943';
import { createActor as createICRC1Actor } from 'external/icrc1_ledger';
import { PrincipalDisplay } from '../../utils/PrincipalUtils';
import InfoModal from '../../components/InfoModal';
import ConfirmationModal from '../../ConfirmationModal';
import { 
    FaCog, FaPercent, FaWallet, FaSave, FaSpinner, FaUserShield, 
    FaPlus, FaTrash, FaClock, FaCubes, FaChartLine, FaLayerGroup,
    FaCheckCircle, FaTimesCircle, FaCoins
} from 'react-icons/fa';

export default function SneedexAdmin() {
    const { isAuthenticated, identity } = useAuth();
    const { theme } = useTheme();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    
    // Admin check
    const { isAdmin: isGlobalAdmin, loading: adminLoading } = useAdminCheck({
        identity,
        isAuthenticated,
        redirectPath: '/admin'
    });
    
    // Config state
    const [config, setConfig] = useState(null);
    const [adminList, setAdminList] = useState([]);
    const [feeRate, setFeeRate] = useState(null);
    const [feeRecipient, setFeeRecipient] = useState(null);
    const [ledgerFeeRecipients, setLedgerFeeRecipients] = useState([]);
    const [assetTypes, setAssetTypes] = useState([]);
    const [stats, setStats] = useState(null);
    
    // Wallet registration settings
    const [backendCanisterId, setBackendCanisterId] = useState(null);
    const [factoryCanisterId, setFactoryCanisterId] = useState(null);
    const [smsCanisterId, setSmsCanisterId] = useState(null);
    
    // Expiration timer settings
    const [expirationTimerRunning, setExpirationTimerRunning] = useState(false);
    const [expirationWorkerRunning, setExpirationWorkerRunning] = useState(false);
    const [expirationCheckInterval, setExpirationCheckInterval] = useState(3600);
    
    // Offer creation fee settings
    const [offerCreationFee, setOfferCreationFee] = useState(0n);
    const [premiumOfferCreationFee, setPremiumOfferCreationFee] = useState(0n);
    const [premiumAuctionCutBps, setPremiumAuctionCutBps] = useState(0);
    const [sneedPremiumCanisterId, setSneedPremiumCanisterId] = useState(null);
    
    // Min increment settings
    const [minIncrementSettings, setMinIncrementSettings] = useState(null);
    
    // Form states
    const [newFeeRate, setNewFeeRate] = useState('');
    const [newFeeRecipientPrincipal, setNewFeeRecipientPrincipal] = useState('');
    const [newFeeRecipientSubaccount, setNewFeeRecipientSubaccount] = useState('');
    const [newLedgerOverrideLedger, setNewLedgerOverrideLedger] = useState('');
    const [newLedgerOverridePrincipal, setNewLedgerOverridePrincipal] = useState('');
    const [newLedgerOverrideSubaccount, setNewLedgerOverrideSubaccount] = useState('');
    const [newAdminPrincipal, setNewAdminPrincipal] = useState('');
    const [newAssetTypeName, setNewAssetTypeName] = useState('');
    const [newAssetTypeDescription, setNewAssetTypeDescription] = useState('');
    const [newMinDuration, setNewMinDuration] = useState('');
    const [newMaxAssets, setNewMaxAssets] = useState('');
    const [newBackendCanisterId, setNewBackendCanisterId] = useState('');
    const [newFactoryCanisterId, setNewFactoryCanisterId] = useState('');
    const [newSmsCanisterId, setNewSmsCanisterId] = useState('');
    const [newExpirationInterval, setNewExpirationInterval] = useState('');
    const [newOfferCreationFee, setNewOfferCreationFee] = useState('');
    const [newPremiumOfferCreationFee, setNewPremiumOfferCreationFee] = useState('');
    const [newPremiumAuctionCutBps, setNewPremiumAuctionCutBps] = useState('');
    const [newSneedPremiumCanisterId, setNewSneedPremiumCanisterId] = useState('');
    const [newMinIncrementRangeMin, setNewMinIncrementRangeMin] = useState('');
    const [newMinIncrementRangeMax, setNewMinIncrementRangeMax] = useState('');
    const [newMinIncrementTarget, setNewMinIncrementTarget] = useState('');
    const [newMinIncrementFallback, setNewMinIncrementFallback] = useState('');
    
    // Loading states
    const [savingFeeRate, setSavingFeeRate] = useState(false);
    const [savingFeeRecipient, setSavingFeeRecipient] = useState(false);
    const [addingLedgerOverride, setAddingLedgerOverride] = useState(false);
    const [removingLedgerOverride, setRemovingLedgerOverride] = useState(null);
    const [addingAdmin, setAddingAdmin] = useState(false);
    const [removingAdmin, setRemovingAdmin] = useState(null);
    const [addingAssetType, setAddingAssetType] = useState(false);
    const [deactivatingAssetType, setDeactivatingAssetType] = useState(null);
    const [savingConfig, setSavingConfig] = useState(false);
    const [savingBackendCanisterId, setSavingBackendCanisterId] = useState(false);
    const [savingFactoryCanisterId, setSavingFactoryCanisterId] = useState(false);
    const [savingSmsCanisterId, setSavingSmsCanisterId] = useState(false);
    const [togglingExpirationTimer, setTogglingExpirationTimer] = useState(false);
    const [savingExpirationInterval, setSavingExpirationInterval] = useState(false);
    const [triggeringExpirationCheck, setTriggeringExpirationCheck] = useState(false);
    const [savingOfferCreationFee, setSavingOfferCreationFee] = useState(false);
    const [savingPremiumSettings, setSavingPremiumSettings] = useState(false);
    const [savingMinIncrementSettings, setSavingMinIncrementSettings] = useState(false);
    
    // Payment logs state
    const [paymentStats, setPaymentStats] = useState(null);
    const [creationFeeLog, setCreationFeeLog] = useState([]);
    const [creationFeeLogTotal, setCreationFeeLogTotal] = useState(0);
    const [creationFeeLogPage, setCreationFeeLogPage] = useState(1);
    const [creationFeeLogLoading, setCreationFeeLogLoading] = useState(false);
    const [cutLog, setCutLog] = useState([]);
    const [cutLogTotal, setCutLogTotal] = useState(0);
    const [cutLogPage, setCutLogPage] = useState(1);
    const [cutLogLoading, setCutLogLoading] = useState(false);
    const [activeLogTab, setActiveLogTab] = useState('creation'); // 'creation' or 'cuts'
    const pageSize = 20;
    
    // Token metadata for cut log ledgers (ledgerId -> { symbol, logo })
    const [ledgerMetadata, setLedgerMetadata] = useState({});
    const [loadingLedgerMetadata, setLoadingLedgerMetadata] = useState({});
    
    // Modals
    const [infoModal, setInfoModal] = useState({ show: false, title: '', message: '', type: 'info' });
    const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', onConfirm: null });
    
    const showInfo = (title, message, type = 'info') => {
        setInfoModal({ show: true, title, message, type });
    };
    
    const closeInfoModal = () => {
        setInfoModal({ ...infoModal, show: false });
    };
    
    const showConfirm = (title, message, onConfirm) => {
        setConfirmModal({ show: true, title, message, onConfirm });
    };
    
    const closeConfirmModal = () => {
        setConfirmModal({ ...confirmModal, show: false });
    };
    
    const getSneedexActor = useCallback(() => {
        if (!identity) return null;
        return createSneedexActor(identity);
    }, [identity]);
    
    const fetchData = useCallback(async () => {
        if (!isAuthenticated || !identity) return;
        
        setLoading(true);
        setError('');
        
        try {
            const actor = getSneedexActor();
            if (!actor) return;
            
            const [configResult, feeRateResult, feeRecipientResult, ledgerRecipientsResult, assetTypesResult, statsResult, backendIdResult, factoryIdResult, smsIdResult, timerRunningResult, workerRunningResult, intervalResult, offerFeeResult, premiumOfferFeeResult, premiumAuctionCutResult, premiumCanisterIdResult, minIncrementResult] = await Promise.all([
                actor.getConfig(),
                actor.getMarketplaceFeeRate(),
                actor.getFeeRecipient(),
                actor.getLedgerFeeRecipients(),
                actor.getAssetTypes(),
                actor.getMarketStats(),
                actor.getBackendCanisterId(),
                actor.getNeuronManagerFactoryCanisterId(),
                actor.getSneedSmsCanisterId().catch(() => null),
                actor.isExpirationTimerRunning(),
                actor.isExpirationWorkerRunning(),
                actor.getExpirationCheckInterval(),
                actor.getOfferCreationFee(),
                actor.getPremiumOfferCreationFee(),
                actor.getPremiumAuctionCutBps(),
                actor.getSneedPremiumCanisterId(),
                actor.getMinIncrementSettings(),
            ]);
            
            setConfig(configResult);
            setAdminList(configResult.admins || []);
            setFeeRate(Number(feeRateResult));
            setFeeRecipient(feeRecipientResult);
            setLedgerFeeRecipients(ledgerRecipientsResult || []);
            setAssetTypes(assetTypesResult);
            setStats(statsResult);
            
            // Wallet registration settings
            setBackendCanisterId(backendIdResult && backendIdResult.length > 0 ? backendIdResult[0] : null);
            setFactoryCanisterId(factoryIdResult && factoryIdResult.length > 0 ? factoryIdResult[0] : null);
            setSmsCanisterId(smsIdResult && smsIdResult.length > 0 ? smsIdResult[0] : (smsIdResult || null));
            
            // Expiration timer settings
            setExpirationTimerRunning(timerRunningResult);
            setExpirationWorkerRunning(workerRunningResult);
            setExpirationCheckInterval(Number(intervalResult));
            
            // Offer creation fee settings
            setOfferCreationFee(offerFeeResult);
            setPremiumOfferCreationFee(premiumOfferFeeResult);
            setPremiumAuctionCutBps(Number(premiumAuctionCutResult));
            setSneedPremiumCanisterId(premiumCanisterIdResult && premiumCanisterIdResult.length > 0 ? premiumCanisterIdResult[0] : null);
            
            // Min increment settings
            setMinIncrementSettings(minIncrementResult);
            
            // Pre-fill form with current values
            setNewMinDuration(String(Number(configResult.min_offer_duration_ns) / 1_000_000_000 / 60)); // Convert ns to minutes
            setNewMaxAssets(String(Number(configResult.max_assets_per_offer)));
            setNewOfferCreationFee(String(Number(offerFeeResult) / 100_000_000)); // Convert e8s to ICP
            setNewPremiumOfferCreationFee(String(Number(premiumOfferFeeResult) / 100_000_000));
            setNewPremiumAuctionCutBps(String(premiumAuctionCutResult));
            setNewSneedPremiumCanisterId(premiumCanisterIdResult && premiumCanisterIdResult.length > 0 ? premiumCanisterIdResult[0].toText() : '');
            
            // Pre-fill min increment form (cents to dollars for display)
            setNewMinIncrementRangeMin(String(Number(minIncrementResult.usd_range_min) / 100));
            setNewMinIncrementRangeMax(String(Number(minIncrementResult.usd_range_max) / 100));
            setNewMinIncrementTarget(String(Number(minIncrementResult.usd_target) / 100));
            setNewMinIncrementFallback(String(Number(minIncrementResult.fallback_tokens)));
            
        } catch (err) {
            console.error('Failed to fetch Sneedex config:', err);
            setError('Failed to load Sneedex configuration: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, identity, getSneedexActor]);
    
    useEffect(() => {
        if (isAuthenticated && identity && !adminLoading) {
            fetchData();
        }
    }, [isAuthenticated, identity, adminLoading, fetchData]);
    
    // Fetch payment stats
    const fetchPaymentStats = useCallback(async () => {
        try {
            const actor = getSneedexActor();
            if (!actor) return;
            const statsResult = await actor.getPaymentStats();
            setPaymentStats(statsResult);
        } catch (err) {
            console.error('Failed to fetch payment stats:', err);
        }
    }, [getSneedexActor]);
    
    // Fetch creation fee log
    const fetchCreationFeeLog = useCallback(async (page) => {
        setCreationFeeLogLoading(true);
        try {
            const actor = getSneedexActor();
            if (!actor) return;
            const offset = (page - 1) * pageSize;
            const result = await actor.getCreationFeePaymentLog(BigInt(offset), BigInt(pageSize));
            setCreationFeeLog(result.payments);
            setCreationFeeLogTotal(Number(result.total_count));
            setCreationFeeLogPage(page);
        } catch (err) {
            console.error('Failed to fetch creation fee log:', err);
        } finally {
            setCreationFeeLogLoading(false);
        }
    }, [getSneedexActor]);
    
    // Fetch cut log
    const fetchCutLog = useCallback(async (page) => {
        setCutLogLoading(true);
        try {
            const actor = getSneedexActor();
            if (!actor) return;
            const offset = (page - 1) * pageSize;
            const result = await actor.getCutPaymentLog(BigInt(offset), BigInt(pageSize));
            setCutLog(result.payments);
            setCutLogTotal(Number(result.total_count));
            setCutLogPage(page);
        } catch (err) {
            console.error('Failed to fetch cut log:', err);
        } finally {
            setCutLogLoading(false);
        }
    }, [getSneedexActor]);
    
    // Fetch token metadata (logo and symbol) for a ledger
    const fetchLedgerMetadata = useCallback(async (ledgerId) => {
        if (ledgerMetadata[ledgerId] || loadingLedgerMetadata[ledgerId]) return;
        
        setLoadingLedgerMetadata(prev => ({ ...prev, [ledgerId]: true }));
        
        try {
            const host = getHost();
            const agent = HttpAgent.createSync({ host, identity });
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const ledgerActor = createICRC1Actor(ledgerId, { agent });
            const metadata = await ledgerActor.icrc1_metadata();
            
            // Extract logo and symbol
            let logo = null;
            let symbol = null;
            
            for (const [key, value] of metadata) {
                if (key === 'icrc1:logo' && value && 'Text' in value) {
                    logo = value.Text;
                }
                if (key === 'icrc1:symbol' && value && 'Text' in value) {
                    symbol = value.Text;
                }
            }
            
            setLedgerMetadata(prev => ({ ...prev, [ledgerId]: { logo, symbol } }));
        } catch (e) {
            console.error('Failed to fetch ledger metadata:', e);
            // Set empty metadata to avoid retrying
            setLedgerMetadata(prev => ({ ...prev, [ledgerId]: { logo: null, symbol: null } }));
        } finally {
            setLoadingLedgerMetadata(prev => ({ ...prev, [ledgerId]: false }));
        }
    }, [identity, ledgerMetadata, loadingLedgerMetadata]);
    
    // Progressively fetch metadata for ledgers in cut log
    useEffect(() => {
        if (cutLog.length > 0 && identity) {
            // Get unique ledger IDs we don't have metadata for yet
            const uniqueLedgers = [...new Set(cutLog.map(entry => entry.ledger.toString()))];
            uniqueLedgers.forEach(ledgerId => {
                if (!ledgerMetadata[ledgerId] && !loadingLedgerMetadata[ledgerId]) {
                    fetchLedgerMetadata(ledgerId);
                }
            });
        }
    }, [cutLog, identity, ledgerMetadata, loadingLedgerMetadata, fetchLedgerMetadata]);
    
    // Load payment data when config is loaded (which means admin check is done)
    useEffect(() => {
        if (config && identity) {
            fetchPaymentStats();
            fetchCreationFeeLog(1);
            fetchCutLog(1);
        }
    }, [config, identity, fetchPaymentStats, fetchCreationFeeLog, fetchCutLog]);
    
    // Check if user is Sneedex admin
    const isSneedexAdmin = adminList.some(admin => 
        admin.toString() === identity?.getPrincipal()?.toString()
    );
    
    // Fee Rate handlers
    const handleSaveFeeRate = async () => {
        const rateBps = Math.round(parseFloat(newFeeRate) * 100);
        if (isNaN(rateBps) || rateBps < 0 || rateBps > 5000) {
            showInfo('Invalid Fee Rate', 'Fee rate must be between 0% and 50%', 'error');
            return;
        }
        
        setSavingFeeRate(true);
        try {
            const actor = getSneedexActor();
            const result = await actor.setMarketplaceFeeRate(BigInt(rateBps));
            if ('ok' in result) {
                showInfo('Success', `Fee rate updated to ${formatFeeRate(rateBps)}`, 'success');
                setFeeRate(rateBps);
                setNewFeeRate('');
            } else {
                showInfo('Error', 'Failed to update fee rate: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update fee rate: ' + e.message, 'error');
        }
        setSavingFeeRate(false);
    };
    
    // Fee Recipient handlers
    const handleSaveFeeRecipient = async () => {
        let principal;
        try {
            principal = Principal.fromText(newFeeRecipientPrincipal);
        } catch (e) {
            showInfo('Invalid Principal', 'Please enter a valid principal ID', 'error');
            return;
        }
        
        let subaccount = [];
        if (newFeeRecipientSubaccount.trim()) {
            try {
                const hex = newFeeRecipientSubaccount.replace(/^0x/, '');
                const bytes = [];
                for (let i = 0; i < hex.length; i += 2) {
                    bytes.push(parseInt(hex.substr(i, 2), 16));
                }
                if (bytes.length !== 32) {
                    throw new Error('Subaccount must be 32 bytes');
                }
                subaccount = [bytes];
            } catch (e) {
                showInfo('Invalid Subaccount', 'Subaccount must be a 64-character hex string (32 bytes)', 'error');
                return;
            }
        }
        
        setSavingFeeRecipient(true);
        try {
            const actor = getSneedexActor();
            const result = await actor.setFeeRecipient({
                owner: principal,
                subaccount: subaccount,
            });
            if ('ok' in result) {
                showInfo('Success', 'Fee recipient updated successfully', 'success');
                fetchData();
                setNewFeeRecipientPrincipal('');
                setNewFeeRecipientSubaccount('');
            } else {
                showInfo('Error', 'Failed to update fee recipient: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update fee recipient: ' + e.message, 'error');
        }
        setSavingFeeRecipient(false);
    };
    
    // Offer Creation Fee handlers
    const handleSaveOfferCreationFee = async () => {
        const feeIcp = parseFloat(newOfferCreationFee);
        if (isNaN(feeIcp) || feeIcp < 0) {
            showInfo('Invalid Fee', 'Fee must be a non-negative number', 'error');
            return;
        }
        
        const feeE8s = BigInt(Math.round(feeIcp * 100_000_000));
        
        setSavingOfferCreationFee(true);
        try {
            const actor = getSneedexActor();
            const result = await actor.setOfferCreationFee(feeE8s);
            if ('ok' in result) {
                showInfo('Success', `Offer creation fee updated to ${feeIcp} ICP`, 'success');
                setOfferCreationFee(feeE8s);
            } else {
                showInfo('Error', 'Failed to update offer creation fee: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update offer creation fee: ' + e.message, 'error');
        }
        setSavingOfferCreationFee(false);
    };
    
    // Premium Settings handlers
    const handleSavePremiumSettings = async () => {
        const premiumFeeIcp = parseFloat(newPremiumOfferCreationFee);
        if (isNaN(premiumFeeIcp) || premiumFeeIcp < 0) {
            showInfo('Invalid Fee', 'Premium fee must be a non-negative number', 'error');
            return;
        }
        
        const premiumCutBps = parseInt(newPremiumAuctionCutBps);
        if (isNaN(premiumCutBps) || premiumCutBps < 0 || premiumCutBps > 5000) {
            showInfo('Invalid Cut', 'Premium auction cut must be between 0 and 5000 basis points (0-50%)', 'error');
            return;
        }
        
        let premiumCanisterId = [];
        if (newSneedPremiumCanisterId.trim()) {
            try {
                premiumCanisterId = [Principal.fromText(newSneedPremiumCanisterId.trim())];
            } catch (e) {
                showInfo('Invalid Principal', 'Please enter a valid Sneed Premium canister ID', 'error');
                return;
            }
        }
        
        const premiumFeeE8s = BigInt(Math.round(premiumFeeIcp * 100_000_000));
        
        setSavingPremiumSettings(true);
        try {
            const actor = getSneedexActor();
            
            // Save all three settings
            const results = await Promise.all([
                actor.setPremiumOfferCreationFee(premiumFeeE8s),
                actor.setPremiumAuctionCutBps(BigInt(premiumCutBps)),
                actor.setSneedPremiumCanisterId(premiumCanisterId),
            ]);
            
            const allOk = results.every(r => 'ok' in r);
            if (allOk) {
                showInfo('Success', 'Premium settings updated successfully', 'success');
                setPremiumOfferCreationFee(premiumFeeE8s);
                setPremiumAuctionCutBps(premiumCutBps);
                setSneedPremiumCanisterId(premiumCanisterId.length > 0 ? premiumCanisterId[0] : null);
            } else {
                const errors = results.filter(r => 'err' in r).map(r => JSON.stringify(r.err));
                showInfo('Error', 'Failed to update some premium settings: ' + errors.join(', '), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update premium settings: ' + e.message, 'error');
        }
        setSavingPremiumSettings(false);
    };
    
    // Min Increment Settings handler
    const handleSaveMinIncrementSettings = async () => {
        const rangeMin = parseFloat(newMinIncrementRangeMin);
        const rangeMax = parseFloat(newMinIncrementRangeMax);
        const target = parseFloat(newMinIncrementTarget);
        const fallback = parseInt(newMinIncrementFallback);
        
        if (isNaN(rangeMin) || rangeMin < 0) {
            showInfo('Invalid Range Min', 'Range min must be a non-negative number', 'error');
            return;
        }
        if (isNaN(rangeMax) || rangeMax < 0) {
            showInfo('Invalid Range Max', 'Range max must be a non-negative number', 'error');
            return;
        }
        if (isNaN(target) || target < 0) {
            showInfo('Invalid Target', 'Target must be a non-negative number', 'error');
            return;
        }
        if (rangeMin > target || target > rangeMax) {
            showInfo('Invalid Range', 'Target must be between range min and range max', 'error');
            return;
        }
        if (isNaN(fallback) || fallback < 0) {
            showInfo('Invalid Fallback', 'Fallback must be a non-negative integer', 'error');
            return;
        }
        
        // Convert dollars to cents
        const rangeMinCents = BigInt(Math.round(rangeMin * 100));
        const rangeMaxCents = BigInt(Math.round(rangeMax * 100));
        const targetCents = BigInt(Math.round(target * 100));
        
        setSavingMinIncrementSettings(true);
        try {
            const actor = getSneedexActor();
            const result = await actor.setMinIncrementSettings(
                rangeMinCents,
                rangeMaxCents,
                targetCents,
                BigInt(fallback)
            );
            if ('ok' in result) {
                showInfo('Success', 'Min increment settings updated successfully', 'success');
                setMinIncrementSettings({
                    usd_range_min: rangeMinCents,
                    usd_range_max: rangeMaxCents,
                    usd_target: targetCents,
                    fallback_tokens: BigInt(fallback),
                });
            } else {
                showInfo('Error', 'Failed to update min increment settings: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update min increment settings: ' + e.message, 'error');
        }
        setSavingMinIncrementSettings(false);
    };
    
    // Ledger-specific fee recipient handlers
    const handleAddLedgerOverride = async () => {
        let ledger;
        try {
            ledger = Principal.fromText(newLedgerOverrideLedger);
        } catch (e) {
            showInfo('Invalid Ledger', 'Please enter a valid ledger canister ID', 'error');
            return;
        }
        
        let principal;
        try {
            principal = Principal.fromText(newLedgerOverridePrincipal);
        } catch (e) {
            showInfo('Invalid Principal', 'Please enter a valid principal ID', 'error');
            return;
        }
        
        let subaccount = [];
        if (newLedgerOverrideSubaccount.trim()) {
            try {
                const hex = newLedgerOverrideSubaccount.replace(/^0x/, '');
                const bytes = [];
                for (let i = 0; i < hex.length; i += 2) {
                    bytes.push(parseInt(hex.substr(i, 2), 16));
                }
                if (bytes.length !== 32) {
                    throw new Error('Subaccount must be 32 bytes');
                }
                subaccount = [bytes];
            } catch (e) {
                showInfo('Invalid Subaccount', 'Subaccount must be a 64-character hex string (32 bytes)', 'error');
                return;
            }
        }
        
        setAddingLedgerOverride(true);
        try {
            const actor = getSneedexActor();
            const result = await actor.setLedgerFeeRecipient(ledger, {
                owner: principal,
                subaccount: subaccount,
            });
            if ('ok' in result) {
                showInfo('Success', 'Ledger fee recipient override added', 'success');
                fetchData();
                setNewLedgerOverrideLedger('');
                setNewLedgerOverridePrincipal('');
                setNewLedgerOverrideSubaccount('');
            } else {
                showInfo('Error', 'Failed to add override: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to add override: ' + e.message, 'error');
        }
        setAddingLedgerOverride(false);
    };
    
    const handleRemoveLedgerOverride = async (ledger) => {
        showConfirm(
            'Remove Override',
            `Are you sure you want to remove the fee recipient override for this ledger?\n\nFees in this token will go to the default recipient.`,
            async () => {
                closeConfirmModal();
                setRemovingLedgerOverride(ledger.toString());
                try {
                    const actor = getSneedexActor();
                    const result = await actor.removeLedgerFeeRecipient(ledger);
                    if ('ok' in result) {
                        showInfo('Success', 'Override removed successfully', 'success');
                        fetchData();
                    } else {
                        showInfo('Error', 'Failed to remove override: ' + JSON.stringify(result.err), 'error');
                    }
                } catch (e) {
                    showInfo('Error', 'Failed to remove override: ' + e.message, 'error');
                }
                setRemovingLedgerOverride(null);
            }
        );
    };
    
    // Admin management handlers
    const handleAddAdmin = async () => {
        let principal;
        try {
            principal = Principal.fromText(newAdminPrincipal);
        } catch (e) {
            showInfo('Invalid Principal', 'Please enter a valid principal ID', 'error');
            return;
        }
        
        setAddingAdmin(true);
        try {
            const actor = getSneedexActor();
            const result = await actor.addAdmin(principal);
            if ('ok' in result) {
                showInfo('Success', 'Admin added successfully', 'success');
                fetchData();
                setNewAdminPrincipal('');
            } else {
                showInfo('Error', 'Failed to add admin: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to add admin: ' + e.message, 'error');
        }
        setAddingAdmin(false);
    };
    
    const handleRemoveAdmin = async (adminPrincipal) => {
        showConfirm(
            'Remove Admin',
            `Are you sure you want to remove this admin?\n\n${adminPrincipal.toString()}`,
            async () => {
                closeConfirmModal();
                setRemovingAdmin(adminPrincipal.toString());
                try {
                    const actor = getSneedexActor();
                    const result = await actor.removeAdmin(adminPrincipal);
                    if ('ok' in result) {
                        showInfo('Success', 'Admin removed successfully', 'success');
                        fetchData();
                    } else {
                        showInfo('Error', 'Failed to remove admin: ' + JSON.stringify(result.err), 'error');
                    }
                } catch (e) {
                    showInfo('Error', 'Failed to remove admin: ' + e.message, 'error');
                }
                setRemovingAdmin(null);
            }
        );
    };
    
    // Asset type handlers
    const handleAddAssetType = async () => {
        if (!newAssetTypeName.trim()) {
            showInfo('Invalid Name', 'Please enter an asset type name', 'error');
            return;
        }
        
        setAddingAssetType(true);
        try {
            const actor = getSneedexActor();
            const result = await actor.addAssetType(newAssetTypeName, newAssetTypeDescription);
            if ('ok' in result) {
                showInfo('Success', `Asset type "${newAssetTypeName}" added with ID ${result.ok}`, 'success');
                fetchData();
                setNewAssetTypeName('');
                setNewAssetTypeDescription('');
            } else {
                showInfo('Error', 'Failed to add asset type: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to add asset type: ' + e.message, 'error');
        }
        setAddingAssetType(false);
    };
    
    const handleDeactivateAssetType = async (assetType) => {
        showConfirm(
            'Deactivate Asset Type',
            `Are you sure you want to deactivate "${assetType.name}"?\n\nThis will prevent new offers from using this asset type.`,
            async () => {
                closeConfirmModal();
                setDeactivatingAssetType(assetType.id);
                try {
                    const actor = getSneedexActor();
                    const result = await actor.deactivateAssetType(assetType.id);
                    if ('ok' in result) {
                        showInfo('Success', `Asset type "${assetType.name}" deactivated`, 'success');
                        fetchData();
                    } else {
                        showInfo('Error', 'Failed to deactivate asset type: ' + JSON.stringify(result.err), 'error');
                    }
                } catch (e) {
                    showInfo('Error', 'Failed to deactivate asset type: ' + e.message, 'error');
                }
                setDeactivatingAssetType(null);
            }
        );
    };
    
    // Config update handler
    const handleSaveConfig = async () => {
        const durationMinutes = parseFloat(newMinDuration);
        const maxAssets = parseInt(newMaxAssets);
        
        if (isNaN(durationMinutes) || durationMinutes < 0) {
            showInfo('Invalid Duration', 'Please enter a valid minimum offer duration', 'error');
            return;
        }
        if (isNaN(maxAssets) || maxAssets < 1 || maxAssets > 100) {
            showInfo('Invalid Max Assets', 'Please enter a valid max assets per offer (1-100)', 'error');
            return;
        }
        
        setSavingConfig(true);
        try {
            const actor = getSneedexActor();
            const newConfig = {
                admins: adminList,
                min_offer_duration_ns: BigInt(Math.floor(durationMinutes * 60 * 1_000_000_000)),
                max_assets_per_offer: BigInt(maxAssets),
            };
            const result = await actor.updateConfig(newConfig);
            if ('ok' in result) {
                showInfo('Success', 'Configuration updated successfully', 'success');
                fetchData();
            } else {
                showInfo('Error', 'Failed to update configuration: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update configuration: ' + e.message, 'error');
        }
        setSavingConfig(false);
    };
    
    // Wallet registration settings handlers
    const handleSaveBackendCanisterId = async () => {
        setSavingBackendCanisterId(true);
        try {
            const actor = getSneedexActor();
            let principal = null;
            
            if (newBackendCanisterId.trim()) {
                try {
                    principal = [Principal.fromText(newBackendCanisterId.trim())];
                } catch (e) {
                    showInfo('Invalid Principal', 'Please enter a valid canister ID', 'error');
                    setSavingBackendCanisterId(false);
                    return;
                }
            } else {
                principal = []; // Clear the setting
            }
            
            const result = await actor.setBackendCanisterId(principal);
            if ('ok' in result) {
                showInfo('Success', principal.length > 0 
                    ? 'Backend canister ID set successfully' 
                    : 'Backend canister ID cleared', 'success');
                setBackendCanisterId(principal.length > 0 ? principal[0] : null);
                setNewBackendCanisterId('');
            } else {
                showInfo('Error', 'Failed to set backend canister ID: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to set backend canister ID: ' + e.message, 'error');
        }
        setSavingBackendCanisterId(false);
    };
    
    const handleSaveFactoryCanisterId = async () => {
        setSavingFactoryCanisterId(true);
        try {
            const actor = getSneedexActor();
            let principal = null;
            
            if (newFactoryCanisterId.trim()) {
                try {
                    principal = [Principal.fromText(newFactoryCanisterId.trim())];
                } catch (e) {
                    showInfo('Invalid Principal', 'Please enter a valid canister ID', 'error');
                    setSavingFactoryCanisterId(false);
                    return;
                }
            } else {
                principal = []; // Clear the setting
            }
            
            const result = await actor.setNeuronManagerFactoryCanisterId(principal);
            if ('ok' in result) {
                showInfo('Success', principal.length > 0 
                    ? 'Staking Bot Factory canister ID set successfully' 
                    : 'Staking Bot Factory canister ID cleared', 'success');
                setFactoryCanisterId(principal.length > 0 ? principal[0] : null);
                setNewFactoryCanisterId('');
            } else {
                showInfo('Error', 'Failed to set factory canister ID: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to set factory canister ID: ' + e.message, 'error');
        }
        setSavingFactoryCanisterId(false);
    };
    
    const handleSaveSmsCanisterId = async () => {
        setSavingSmsCanisterId(true);
        try {
            const actor = getSneedexActor();
            let principal = null;
            
            if (newSmsCanisterId.trim()) {
                try {
                    principal = [Principal.fromText(newSmsCanisterId.trim())];
                } catch (e) {
                    showInfo('Invalid Principal', 'Please enter a valid canister ID', 'error');
                    setSavingSmsCanisterId(false);
                    return;
                }
            } else {
                principal = []; // Clear the setting
            }
            
            const result = await actor.setSneedSmsCanisterId(principal);
            if ('ok' in result) {
                showInfo('Success', principal.length > 0 
                    ? 'Sneed SMS canister ID set successfully' 
                    : 'Sneed SMS canister ID cleared', 'success');
                setSmsCanisterId(principal.length > 0 ? principal[0] : null);
                setNewSmsCanisterId('');
            } else {
                showInfo('Error', 'Failed to set SMS canister ID: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to set SMS canister ID: ' + e.message, 'error');
        }
        setSavingSmsCanisterId(false);
    };
    
    // Expiration Timer handlers
    const handleToggleExpirationTimer = async () => {
        setTogglingExpirationTimer(true);
        try {
            const actor = getSneedexActor();
            let result;
            if (expirationTimerRunning) {
                result = await actor.stopExpirationTimer();
            } else {
                result = await actor.startExpirationTimer();
            }
            
            if ('ok' in result) {
                const newState = !expirationTimerRunning;
                setExpirationTimerRunning(newState);
                showInfo('Success', newState 
                    ? `Expiration timer started (checking every ${Math.floor(expirationCheckInterval / 60)} minutes)` 
                    : 'Expiration timer stopped', 'success');
            } else {
                showInfo('Error', 'Failed to toggle timer: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to toggle timer: ' + e.message, 'error');
        }
        setTogglingExpirationTimer(false);
    };
    
    const handleSaveExpirationInterval = async () => {
        const intervalMinutes = parseInt(newExpirationInterval, 10);
        if (isNaN(intervalMinutes) || intervalMinutes < 1) {
            showInfo('Invalid Interval', 'Interval must be at least 1 minute', 'error');
            return;
        }
        
        const intervalSeconds = intervalMinutes * 60;
        
        setSavingExpirationInterval(true);
        try {
            const actor = getSneedexActor();
            const result = await actor.setExpirationCheckInterval(BigInt(intervalSeconds));
            
            if ('ok' in result) {
                setExpirationCheckInterval(intervalSeconds);
                setNewExpirationInterval('');
                showInfo('Success', `Expiration check interval set to ${intervalMinutes} minute${intervalMinutes !== 1 ? 's' : ''}`, 'success');
            } else {
                showInfo('Error', 'Failed to set interval: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to set interval: ' + e.message, 'error');
        }
        setSavingExpirationInterval(false);
    };
    
    const handleTriggerExpirationCheck = async () => {
        if (expirationWorkerRunning) {
            showInfo('Worker Running', 'The expiration worker is already processing offers. Please wait.', 'info');
            return;
        }
        
        setTriggeringExpirationCheck(true);
        try {
            const actor = getSneedexActor();
            const result = await actor.triggerExpirationCheck();
            
            if ('ok' in result) {
                showInfo('Success', 'Expiration check triggered. Any expired offers will be processed.', 'success');
                // Refresh status
                setTimeout(async () => {
                    try {
                        const workerRunning = await actor.isExpirationWorkerRunning();
                        setExpirationWorkerRunning(workerRunning);
                    } catch (e) {}
                }, 1000);
            } else {
                showInfo('Error', 'Failed to trigger check: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to trigger check: ' + e.message, 'error');
        }
        setTriggeringExpirationCheck(false);
    };
    
    const styles = {
        container: {
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '2rem',
            color: theme.colors.primaryText,
        },
        title: {
            fontSize: '2.5rem',
            marginBottom: '0.5rem',
            background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.success})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
        },
        subtitle: {
            color: theme.colors.mutedText,
            marginBottom: '2rem',
            fontSize: '1.1rem',
        },
        section: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '1.5rem',
            marginBottom: '1.5rem',
            boxShadow: theme.colors.cardShadow,
        },
        sectionTitle: {
            fontSize: '1.3rem',
            fontWeight: '600',
            marginBottom: '1rem',
            color: theme.colors.primaryText,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        row: {
            display: 'flex',
            gap: '1rem',
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: '1rem',
        },
        input: {
            padding: '10px 14px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '1rem',
            flex: '1',
            minWidth: '200px',
        },
        inputSmall: {
            padding: '10px 14px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '1rem',
            width: '120px',
        },
        button: {
            padding: '10px 20px',
            borderRadius: '8px',
            border: 'none',
            background: theme.colors.accent,
            color: theme.colors.primaryBg,
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            whiteSpace: 'nowrap',
        },
        buttonSuccess: {
            padding: '10px 20px',
            borderRadius: '8px',
            border: 'none',
            background: theme.colors.success,
            color: theme.colors.primaryBg,
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            whiteSpace: 'nowrap',
        },
        buttonDanger: {
            padding: '8px 14px',
            borderRadius: '8px',
            border: 'none',
            background: theme.colors.error,
            color: '#fff',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
        },
        list: {
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
        },
        listItem: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            background: theme.colors.tertiaryBg,
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
        },
        label: {
            color: theme.colors.mutedText,
            fontSize: '0.9rem',
            marginBottom: '0.5rem',
            display: 'block',
        },
        value: {
            color: theme.colors.primaryText,
            fontWeight: '600',
        },
        statsGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '1rem',
            marginTop: '1rem',
        },
        statCard: {
            background: theme.colors.tertiaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '10px',
            padding: '1rem',
            textAlign: 'center',
        },
        statValue: {
            fontSize: '1.75rem',
            fontWeight: '700',
            color: theme.colors.accent,
            marginBottom: '0.25rem',
        },
        statLabel: {
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
        },
        badge: {
            padding: '4px 10px',
            borderRadius: '20px',
            fontSize: '0.8rem',
            fontWeight: '600',
        },
        badgeActive: {
            background: `${theme.colors.success}20`,
            color: theme.colors.success,
        },
        badgeInactive: {
            background: `${theme.colors.error}20`,
            color: theme.colors.error,
        },
        error: {
            background: `${theme.colors.error}15`,
            border: `1px solid ${theme.colors.error}`,
            color: theme.colors.error,
            padding: '1rem',
            borderRadius: '10px',
            marginBottom: '1rem',
        },
        loading: {
            textAlign: 'center',
            padding: '3rem',
            color: theme.colors.mutedText,
        },
    };
    
    if (adminLoading || loading) {
        return (
            <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.loading}>
                        <FaSpinner className="spin" size={32} />
                        <p style={{ marginTop: '1rem' }}>Loading Sneedex Admin...</p>
                    </div>
                </main>
            </div>
        );
    }
    
    if (!isGlobalAdmin && !isSneedexAdmin) {
        return (
            <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.error}>
                        <h2>Access Denied</h2>
                        <p>You must be a Sneedex admin to access this page.</p>
                    </div>
                </main>
            </div>
        );
    }
    
    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                <h1 style={styles.title}>
                    <FaCog style={{ color: theme.colors.accent }} />
                    Sneedex Admin
                </h1>
                <p style={styles.subtitle}>
                    Manage marketplace settings, fees, admins, and asset types
                </p>
                
                {error && (
                    <div style={styles.error}>{error}</div>
                )}
                
                {/* Stats Overview */}
                {stats && (
                    <section style={styles.section}>
                        <h2 style={styles.sectionTitle}>
                            <FaChartLine style={{ color: theme.colors.success }} />
                            Marketplace Overview
                        </h2>
                        <div style={styles.statsGrid}>
                            <div style={styles.statCard}>
                                <div style={styles.statValue}>{Number(stats.total_offers)}</div>
                                <div style={styles.statLabel}>Total Offers</div>
                            </div>
                            <div style={styles.statCard}>
                                <div style={styles.statValue}>{Number(stats.active_offers)}</div>
                                <div style={styles.statLabel}>Active Offers</div>
                            </div>
                            <div style={styles.statCard}>
                                <div style={styles.statValue}>{Number(stats.completed_offers)}</div>
                                <div style={styles.statLabel}>Completed</div>
                            </div>
                            <div style={styles.statCard}>
                                <div style={styles.statValue}>{Number(stats.total_bids)}</div>
                                <div style={styles.statLabel}>Total Bids</div>
                            </div>
                            <div style={styles.statCard}>
                                <div style={{ ...styles.statValue, color: theme.colors.warning }}>
                                    {feeRate !== null ? formatFeeRate(feeRate) : '--'}
                                </div>
                                <div style={styles.statLabel}>Fee Rate</div>
                            </div>
                        </div>
                    </section>
                )}
                
                {/* Payment Statistics */}
                {paymentStats && (
                    <section style={styles.section}>
                        <h2 style={styles.sectionTitle}>
                            <FaWallet style={{ color: theme.colors.success }} />
                            Payment Statistics
                        </h2>
                        <div style={styles.statsGrid}>
                            <div style={styles.statCard}>
                                <div style={{ ...styles.statValue, color: theme.colors.success }}>
                                    {(Number(paymentStats.total_creation_fees_collected_e8s) / 100_000_000).toFixed(4)} ICP
                                </div>
                                <div style={styles.statLabel}>Creation Fees Collected</div>
                            </div>
                            <div style={styles.statCard}>
                                <div style={styles.statValue}>{Number(paymentStats.total_creation_fee_payments)}</div>
                                <div style={styles.statLabel}>Creation Fee Payments</div>
                            </div>
                            <div style={styles.statCard}>
                                <div style={styles.statValue}>{Number(paymentStats.total_cut_payments)}</div>
                                <div style={styles.statLabel}>Cut Payments</div>
                            </div>
                        </div>
                        
                        {/* Cuts by Ledger */}
                        {paymentStats.cuts_by_ledger && paymentStats.cuts_by_ledger.length > 0 && (
                            <div style={{ marginTop: '1.5rem' }}>
                                <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: theme.colors.primaryText }}>
                                    Cuts Collected by Token
                                </h3>
                                <div style={styles.list}>
                                    {paymentStats.cuts_by_ledger.map(([ledger, amount], index) => (
                                        <div key={index} style={styles.listItem}>
                                            <PrincipalDisplay principal={ledger.toString()} />
                                            <span style={{ fontWeight: '600', color: theme.colors.success }}>
                                                {formatAmount(amount, 8)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </section>
                )}
                
                {/* Payment Logs */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaChartLine style={{ color: theme.colors.accent }} />
                        Payment Logs
                    </h2>
                    
                    {/* Tab Navigation */}
                    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                        <button
                            onClick={() => setActiveLogTab('creation')}
                            style={{
                                padding: '10px 20px',
                                borderRadius: '8px',
                                border: `1px solid ${activeLogTab === 'creation' ? theme.colors.accent : theme.colors.border}`,
                                background: activeLogTab === 'creation' ? theme.colors.accent : 'transparent',
                                color: activeLogTab === 'creation' ? theme.colors.primaryBg : theme.colors.primaryText,
                                fontWeight: '600',
                                cursor: 'pointer',
                            }}
                        >
                            Creation Fees ({creationFeeLogTotal})
                        </button>
                        <button
                            onClick={() => setActiveLogTab('cuts')}
                            style={{
                                padding: '10px 20px',
                                borderRadius: '8px',
                                border: `1px solid ${activeLogTab === 'cuts' ? theme.colors.accent : theme.colors.border}`,
                                background: activeLogTab === 'cuts' ? theme.colors.accent : 'transparent',
                                color: activeLogTab === 'cuts' ? theme.colors.primaryBg : theme.colors.primaryText,
                                fontWeight: '600',
                                cursor: 'pointer',
                            }}
                        >
                            Marketplace Cuts ({cutLogTotal})
                        </button>
                    </div>
                    
                    {/* Creation Fee Log */}
                    {activeLogTab === 'creation' && (
                        <div>
                            {creationFeeLogLoading ? (
                                <div style={{ textAlign: 'center', padding: '2rem' }}>
                                    <FaSpinner className="spin" size={24} />
                                </div>
                            ) : creationFeeLog.length === 0 ? (
                                <p style={{ color: theme.colors.mutedText, fontStyle: 'italic' }}>
                                    No creation fee payments recorded yet.
                                </p>
                            ) : (
                                <>
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>ID</th>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>Time</th>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>Payer</th>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>Amount</th>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>Offer ID</th>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>ICP TX</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {creationFeeLog.map((entry) => (
                                                    <tr key={Number(entry.id)} style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                                                        <td style={{ padding: '12px', color: theme.colors.primaryText }}>#{Number(entry.id)}</td>
                                                        <td style={{ padding: '12px', color: theme.colors.secondaryText }}>
                                                            {new Date(Number(entry.timestamp) / 1_000_000).toLocaleString()}
                                                        </td>
                                                        <td style={{ padding: '12px' }}>
                                                            <PrincipalDisplay principal={entry.payer.toString()} short={true} />
                                                        </td>
                                                        <td style={{ padding: '12px', color: theme.colors.success, fontWeight: '600' }}>
                                                            {(Number(entry.amount_e8s) / 100_000_000).toFixed(4)} ICP
                                                        </td>
                                                        <td style={{ padding: '12px', color: theme.colors.accent }}>
                                                            #{Number(entry.offer_id)}
                                                        </td>
                                                        <td style={{ padding: '12px', color: theme.colors.secondaryText }}>
                                                            {Number(entry.icp_transaction_id)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    
                                    {/* Pagination */}
                                    {creationFeeLogTotal > pageSize && (
                                        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
                                            <button
                                                onClick={() => fetchCreationFeeLog(creationFeeLogPage - 1)}
                                                disabled={creationFeeLogPage === 1}
                                                style={{
                                                    ...styles.button,
                                                    opacity: creationFeeLogPage === 1 ? 0.5 : 1,
                                                    cursor: creationFeeLogPage === 1 ? 'not-allowed' : 'pointer',
                                                }}
                                            >
                                                Previous
                                            </button>
                                            <span style={{ color: theme.colors.mutedText, alignSelf: 'center' }}>
                                                Page {creationFeeLogPage} of {Math.ceil(creationFeeLogTotal / pageSize)}
                                            </span>
                                            <button
                                                onClick={() => fetchCreationFeeLog(creationFeeLogPage + 1)}
                                                disabled={creationFeeLogPage >= Math.ceil(creationFeeLogTotal / pageSize)}
                                                style={{
                                                    ...styles.button,
                                                    opacity: creationFeeLogPage >= Math.ceil(creationFeeLogTotal / pageSize) ? 0.5 : 1,
                                                    cursor: creationFeeLogPage >= Math.ceil(creationFeeLogTotal / pageSize) ? 'not-allowed' : 'pointer',
                                                }}
                                            >
                                                Next
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    
                    {/* Cut Log */}
                    {activeLogTab === 'cuts' && (
                        <div>
                            {cutLogLoading ? (
                                <div style={{ textAlign: 'center', padding: '2rem' }}>
                                    <FaSpinner className="spin" size={24} />
                                </div>
                            ) : cutLog.length === 0 ? (
                                <p style={{ color: theme.colors.mutedText, fontStyle: 'italic' }}>
                                    No marketplace cut payments recorded yet.
                                </p>
                            ) : (
                                <>
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>ID</th>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>Time</th>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>Offer</th>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>Seller</th>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>Buyer</th>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>Ledger</th>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>Cut</th>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>Rate</th>
                                                    <th style={{ textAlign: 'left', padding: '12px', color: theme.colors.mutedText }}>TX ID</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {cutLog.map((entry) => (
                                                    <tr key={Number(entry.id)} style={{ borderBottom: `1px solid ${theme.colors.border}` }}>
                                                        <td style={{ padding: '12px', color: theme.colors.primaryText }}>#{Number(entry.id)}</td>
                                                        <td style={{ padding: '12px', color: theme.colors.secondaryText, fontSize: '0.85rem' }}>
                                                            {new Date(Number(entry.timestamp) / 1_000_000).toLocaleString()}
                                                        </td>
                                                        <td style={{ padding: '12px', color: theme.colors.accent }}>
                                                            #{Number(entry.offer_id)}
                                                        </td>
                                                        <td style={{ padding: '12px' }}>
                                                            <PrincipalDisplay principal={entry.seller.toString()} short={true} />
                                                        </td>
                                                        <td style={{ padding: '12px' }}>
                                                            <PrincipalDisplay principal={entry.buyer.toString()} short={true} />
                                                        </td>
                                                        <td style={{ padding: '12px' }}>
                                                            {(() => {
                                                                const ledgerId = entry.ledger.toString();
                                                                const meta = ledgerMetadata[ledgerId];
                                                                const isLoading = loadingLedgerMetadata[ledgerId];
                                                                
                                                                if (isLoading) {
                                                                    return (
                                                                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: theme.colors.mutedText }}>
                                                                            <FaSpinner style={{ animation: 'spin 1s linear infinite' }} />
                                                                        </span>
                                                                    );
                                                                }
                                                                
                                                                if (meta?.symbol) {
                                                                    return (
                                                                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                            {meta.logo ? (
                                                                                <img 
                                                                                    src={meta.logo} 
                                                                                    alt={meta.symbol} 
                                                                                    style={{ width: '20px', height: '20px', borderRadius: '50%' }}
                                                                                    onError={(e) => { e.target.style.display = 'none'; }}
                                                                                />
                                                                            ) : (
                                                                                <FaCoins style={{ color: theme.colors.warning }} />
                                                                            )}
                                                                            <span style={{ fontWeight: '600', color: theme.colors.primaryText }}>{meta.symbol}</span>
                                                                        </span>
                                                                    );
                                                                }
                                                                
                                                                // Fallback to principal display
                                                                return <PrincipalDisplay principal={ledgerId} short={true} />;
                                                            })()}
                                                        </td>
                                                        <td style={{ padding: '12px', color: theme.colors.success, fontWeight: '600' }}>
                                                            {formatAmount(entry.cut_amount, 8)}
                                                        </td>
                                                        <td style={{ padding: '12px', color: theme.colors.warning }}>
                                                            {(Number(entry.fee_rate_bps) / 100).toFixed(2)}%
                                                        </td>
                                                        <td style={{ padding: '12px', color: theme.colors.secondaryText }}>
                                                            {Number(entry.transaction_id)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    
                                    {/* Pagination */}
                                    {cutLogTotal > pageSize && (
                                        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
                                            <button
                                                onClick={() => fetchCutLog(cutLogPage - 1)}
                                                disabled={cutLogPage === 1}
                                                style={{
                                                    ...styles.button,
                                                    opacity: cutLogPage === 1 ? 0.5 : 1,
                                                    cursor: cutLogPage === 1 ? 'not-allowed' : 'pointer',
                                                }}
                                            >
                                                Previous
                                            </button>
                                            <span style={{ color: theme.colors.mutedText, alignSelf: 'center' }}>
                                                Page {cutLogPage} of {Math.ceil(cutLogTotal / pageSize)}
                                            </span>
                                            <button
                                                onClick={() => fetchCutLog(cutLogPage + 1)}
                                                disabled={cutLogPage >= Math.ceil(cutLogTotal / pageSize)}
                                                style={{
                                                    ...styles.button,
                                                    opacity: cutLogPage >= Math.ceil(cutLogTotal / pageSize) ? 0.5 : 1,
                                                    cursor: cutLogPage >= Math.ceil(cutLogTotal / pageSize) ? 'not-allowed' : 'pointer',
                                                }}
                                            >
                                                Next
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </section>
                
                {/* Fee Settings */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaPercent style={{ color: theme.colors.warning }} />
                        Marketplace Fee Rate
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Current fee: <strong style={{ color: theme.colors.warning }}>{feeRate !== null ? formatFeeRate(feeRate) : 'Loading...'}</strong>
                        <br />
                        <small>This fee is deducted from winning bids. New offers inherit the rate at creation time.</small>
                    </p>
                    <div style={styles.row}>
                        <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="50"
                            placeholder="New fee % (e.g., 2.5)"
                            value={newFeeRate}
                            onChange={(e) => setNewFeeRate(e.target.value)}
                            style={styles.inputSmall}
                        />
                        <span style={{ color: theme.colors.mutedText }}>%</span>
                        <button
                            onClick={handleSaveFeeRate}
                            disabled={savingFeeRate || !newFeeRate}
                            style={{
                                ...styles.button,
                                opacity: savingFeeRate || !newFeeRate ? 0.5 : 1,
                                cursor: savingFeeRate || !newFeeRate ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {savingFeeRate ? <FaSpinner className="spin" /> : <FaSave />}
                            Save
                        </button>
                    </div>
                </section>
                
                {/* Fee Recipient */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaWallet style={{ color: theme.colors.success }} />
                        Default Fee Recipient Account
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        This is the fallback account for fees. You can add per-token overrides below.
                        <br />
                        Current recipient: {feeRecipient ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                <PrincipalDisplay principal={feeRecipient.owner.toString()} />
                                {feeRecipient.subaccount?.[0] && (
                                    <span style={{ fontSize: '0.8rem' }}>
                                        (sub: 0x{Array.from(feeRecipient.subaccount[0]).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 12)}...)
                                    </span>
                                )}
                            </span>
                        ) : 'Loading...'}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <input
                            type="text"
                            placeholder="Principal ID"
                            value={newFeeRecipientPrincipal}
                            onChange={(e) => setNewFeeRecipientPrincipal(e.target.value)}
                            style={{ ...styles.input, maxWidth: '500px' }}
                        />
                        <input
                            type="text"
                            placeholder="Subaccount (optional, 64-char hex)"
                            value={newFeeRecipientSubaccount}
                            onChange={(e) => setNewFeeRecipientSubaccount(e.target.value)}
                            style={{ ...styles.input, maxWidth: '500px' }}
                        />
                        <button
                            onClick={handleSaveFeeRecipient}
                            disabled={savingFeeRecipient || !newFeeRecipientPrincipal}
                            style={{
                                ...styles.buttonSuccess,
                                width: 'fit-content',
                                opacity: savingFeeRecipient || !newFeeRecipientPrincipal ? 0.5 : 1,
                                cursor: savingFeeRecipient || !newFeeRecipientPrincipal ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {savingFeeRecipient ? <FaSpinner className="spin" /> : <FaSave />}
                            Save Recipient
                        </button>
                    </div>
                </section>
                
                {/* Offer Creation Fee */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaPercent style={{ color: theme.colors.success }} />
                        Offer Creation Fee
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Current fee: <strong style={{ color: theme.colors.success }}>{Number(offerCreationFee) / 100_000_000} ICP</strong>
                        <br />
                        <small>Users must pay this fee (in ICP) to create an offer. Set to 0 for free offer creation.</small>
                    </p>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>Offer Creation Fee (ICP)</label>
                            <input
                                type="number"
                                step="0.0001"
                                min="0"
                                placeholder="e.g., 0.5"
                                value={newOfferCreationFee}
                                onChange={(e) => setNewOfferCreationFee(e.target.value)}
                                style={{ ...styles.input, width: '150px' }}
                            />
                        </div>
                        <button
                            onClick={handleSaveOfferCreationFee}
                            disabled={savingOfferCreationFee || !newOfferCreationFee}
                            style={{
                                ...styles.buttonSuccess,
                                width: 'fit-content',
                                opacity: savingOfferCreationFee || !newOfferCreationFee ? 0.5 : 1,
                                cursor: savingOfferCreationFee || !newOfferCreationFee ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {savingOfferCreationFee ? <FaSpinner className="spin" /> : <FaSave />}
                            Save Fee
                        </button>
                    </div>
                </section>
                
                {/* Sneed Premium Settings */}
                <section style={{
                    ...styles.section,
                    background: `linear-gradient(135deg, ${theme.colors.cardBackground} 0%, rgba(255, 215, 0, 0.1) 100%)`,
                    border: `1px solid rgba(255, 215, 0, 0.3)`,
                }}>
                    <h2 style={{ ...styles.sectionTitle, color: '#FFD700' }}>
                        👑 Sneed Premium Settings
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Configure discounted fees for Sneed Premium members.
                        <br />
                        <small>Current: Premium creation fee = <strong style={{ color: '#FFD700' }}>{Number(premiumOfferCreationFee) / 100_000_000} ICP</strong>, 
                        Premium auction cut = <strong style={{ color: '#FFD700' }}>{premiumAuctionCutBps / 100}%</strong> (0 = use regular rate),
                        Premium canister = <strong style={{ color: '#FFD700' }}>{sneedPremiumCanisterId ? sneedPremiumCanisterId.toString() : 'Not set'}</strong></small>
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>Premium Creation Fee (ICP)</label>
                                <input
                                    type="number"
                                    step="0.0001"
                                    min="0"
                                    placeholder="e.g., 0.25"
                                    value={newPremiumOfferCreationFee}
                                    onChange={(e) => setNewPremiumOfferCreationFee(e.target.value)}
                                    style={{ ...styles.input, width: '150px' }}
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>Premium Auction Cut (bps, 0=use regular)</label>
                                <input
                                    type="number"
                                    step="1"
                                    min="0"
                                    max="5000"
                                    placeholder="e.g., 150 (1.5%)"
                                    value={newPremiumAuctionCutBps}
                                    onChange={(e) => setNewPremiumAuctionCutBps(e.target.value)}
                                    style={{ ...styles.input, width: '180px' }}
                                />
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>Sneed Premium Canister ID (leave empty to disable)</label>
                            <input
                                type="text"
                                placeholder="e.g., 7gump-4aaaa-aaaal-qtyka-cai"
                                value={newSneedPremiumCanisterId}
                                onChange={(e) => setNewSneedPremiumCanisterId(e.target.value)}
                                style={styles.input}
                            />
                        </div>
                        <button
                            onClick={handleSavePremiumSettings}
                            disabled={savingPremiumSettings}
                            style={{
                                ...styles.buttonSuccess,
                                width: 'fit-content',
                                background: 'linear-gradient(135deg, #FFD700, #FFA500)',
                                color: '#1a1a2e',
                                opacity: savingPremiumSettings ? 0.5 : 1,
                                cursor: savingPremiumSettings ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {savingPremiumSettings ? <FaSpinner className="spin" /> : <FaSave />}
                            Save Premium Settings
                        </button>
                    </div>
                </section>
                
                {/* Min Increment Settings */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaCog style={{ color: theme.colors.accent }} />
                        Min Bid Increment Defaults
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Configure the default min bid increment suggestion when creating offers. 
                        The target USD value determines the suggested increment, while the range defines warning thresholds.
                    </p>
                    
                    {minIncrementSettings && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                            <div style={styles.statCard}>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Range Min (warn below)</span>
                                <span style={{ color: theme.colors.primaryText, fontWeight: 'bold' }}>
                                    ${(Number(minIncrementSettings.usd_range_min) / 100).toFixed(2)}
                                </span>
                            </div>
                            <div style={styles.statCard}>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Target (suggested)</span>
                                <span style={{ color: theme.colors.accent, fontWeight: 'bold' }}>
                                    ${(Number(minIncrementSettings.usd_target) / 100).toFixed(2)}
                                </span>
                            </div>
                            <div style={styles.statCard}>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Range Max (warn above)</span>
                                <span style={{ color: theme.colors.primaryText, fontWeight: 'bold' }}>
                                    ${(Number(minIncrementSettings.usd_range_max) / 100).toFixed(2)}
                                </span>
                            </div>
                            <div style={styles.statCard}>
                                <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>Fallback (no USD price)</span>
                                <span style={{ color: theme.colors.primaryText, fontWeight: 'bold' }}>
                                    {Number(minIncrementSettings.fallback_tokens).toLocaleString()} units
                                </span>
                            </div>
                        </div>
                    )}
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                        <div>
                            <label style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>Range Min (USD)</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="e.g., 1.00"
                                value={newMinIncrementRangeMin}
                                onChange={(e) => setNewMinIncrementRangeMin(e.target.value)}
                                style={styles.input}
                            />
                        </div>
                        <div>
                            <label style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>Target (USD)</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="e.g., 5.00"
                                value={newMinIncrementTarget}
                                onChange={(e) => setNewMinIncrementTarget(e.target.value)}
                                style={styles.input}
                            />
                        </div>
                        <div>
                            <label style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>Range Max (USD)</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="e.g., 10.00"
                                value={newMinIncrementRangeMax}
                                onChange={(e) => setNewMinIncrementRangeMax(e.target.value)}
                                style={styles.input}
                            />
                        </div>
                        <div>
                            <label style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>Fallback (token base units)</label>
                            <input
                                type="number"
                                step="1"
                                min="0"
                                placeholder="e.g., 100000000 (1 ICP)"
                                value={newMinIncrementFallback}
                                onChange={(e) => setNewMinIncrementFallback(e.target.value)}
                                style={styles.input}
                            />
                        </div>
                    </div>
                    <button
                        onClick={handleSaveMinIncrementSettings}
                        disabled={savingMinIncrementSettings}
                        style={{
                            ...styles.buttonSuccess,
                            marginTop: '1rem',
                            width: 'fit-content',
                            opacity: savingMinIncrementSettings ? 0.5 : 1,
                            cursor: savingMinIncrementSettings ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {savingMinIncrementSettings ? <FaSpinner className="spin" /> : <FaSave />}
                        Save Increment Settings
                    </button>
                </section>
                
                {/* Per-Ledger Fee Recipient Overrides */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaWallet style={{ color: theme.colors.accent }} />
                        Per-Token Fee Recipient Overrides
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Override where fees go for specific tokens. If a bid is paid in ICP, send fees to one account; if in SNEED, send to another.
                        Ledgers without an override will use the default recipient above.
                    </p>
                    
                    {ledgerFeeRecipients.length > 0 && (
                        <div style={styles.list}>
                            {ledgerFeeRecipients.map(([ledger, account], index) => (
                                <div key={index} style={{ ...styles.listItem, flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                        <div>
                                            <span style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>Ledger:</span>{' '}
                                            <PrincipalDisplay principal={ledger.toString()} />
                                        </div>
                                        <button
                                            onClick={() => handleRemoveLedgerOverride(ledger)}
                                            disabled={removingLedgerOverride === ledger.toString()}
                                            style={{
                                                ...styles.buttonDanger,
                                                opacity: removingLedgerOverride === ledger.toString() ? 0.5 : 1,
                                                cursor: removingLedgerOverride === ledger.toString() ? 'not-allowed' : 'pointer',
                                            }}
                                        >
                                            {removingLedgerOverride === ledger.toString() ? <FaSpinner className="spin" /> : <FaTrash />}
                                        </button>
                                    </div>
                                    <div style={{ fontSize: '0.9rem' }}>
                                        <span style={{ color: theme.colors.mutedText }}>→ Fees go to:</span>{' '}
                                        <PrincipalDisplay principal={account.owner.toString()} />
                                        {account.subaccount?.[0] && (
                                            <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText, marginLeft: '4px' }}>
                                                (sub: 0x{Array.from(account.subaccount[0]).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 12)}...)
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    
                    {ledgerFeeRecipients.length === 0 && (
                        <p style={{ color: theme.colors.mutedText, fontStyle: 'italic', marginBottom: '1rem' }}>
                            No overrides configured. All fees go to the default recipient.
                        </p>
                    )}
                    
                    <div style={{ marginTop: '1rem', padding: '1rem', background: theme.colors.tertiaryBg, borderRadius: '10px' }}>
                        <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: theme.colors.primaryText }}>
                            <FaPlus style={{ marginRight: '8px' }} />
                            Add Override
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <input
                                type="text"
                                placeholder="Token Ledger Canister ID (e.g., ICP ledger)"
                                value={newLedgerOverrideLedger}
                                onChange={(e) => setNewLedgerOverrideLedger(e.target.value)}
                                style={styles.input}
                            />
                            <input
                                type="text"
                                placeholder="Fee Recipient Principal ID"
                                value={newLedgerOverridePrincipal}
                                onChange={(e) => setNewLedgerOverridePrincipal(e.target.value)}
                                style={styles.input}
                            />
                            <input
                                type="text"
                                placeholder="Subaccount (optional, 64-char hex)"
                                value={newLedgerOverrideSubaccount}
                                onChange={(e) => setNewLedgerOverrideSubaccount(e.target.value)}
                                style={styles.input}
                            />
                            <button
                                onClick={handleAddLedgerOverride}
                                disabled={addingLedgerOverride || !newLedgerOverrideLedger || !newLedgerOverridePrincipal}
                                style={{
                                    ...styles.buttonSuccess,
                                    width: 'fit-content',
                                    opacity: addingLedgerOverride || !newLedgerOverrideLedger || !newLedgerOverridePrincipal ? 0.5 : 1,
                                    cursor: addingLedgerOverride || !newLedgerOverrideLedger || !newLedgerOverridePrincipal ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {addingLedgerOverride ? <FaSpinner className="spin" /> : <FaPlus />}
                                Add Override
                            </button>
                        </div>
                    </div>
                </section>
                
                {/* Admin Management */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaUserShield style={{ color: theme.colors.accent }} />
                        Sneedex Admins
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Admins can modify marketplace settings, add asset types, and manage other admins.
                    </p>
                    
                    <div style={styles.list}>
                        {adminList.map((admin, index) => (
                            <div key={index} style={styles.listItem}>
                                <PrincipalDisplay principal={admin.toString()} />
                                <button
                                    onClick={() => handleRemoveAdmin(admin)}
                                    disabled={removingAdmin === admin.toString() || adminList.length === 1}
                                    style={{
                                        ...styles.buttonDanger,
                                        opacity: removingAdmin === admin.toString() || adminList.length === 1 ? 0.5 : 1,
                                        cursor: removingAdmin === admin.toString() || adminList.length === 1 ? 'not-allowed' : 'pointer',
                                    }}
                                    title={adminList.length === 1 ? 'Cannot remove last admin' : 'Remove admin'}
                                >
                                    {removingAdmin === admin.toString() ? <FaSpinner className="spin" /> : <FaTrash />}
                                </button>
                            </div>
                        ))}
                    </div>
                    
                    <div style={{ ...styles.row, marginTop: '1rem' }}>
                        <input
                            type="text"
                            placeholder="New admin principal ID"
                            value={newAdminPrincipal}
                            onChange={(e) => setNewAdminPrincipal(e.target.value)}
                            style={styles.input}
                        />
                        <button
                            onClick={handleAddAdmin}
                            disabled={addingAdmin || !newAdminPrincipal}
                            style={{
                                ...styles.buttonSuccess,
                                opacity: addingAdmin || !newAdminPrincipal ? 0.5 : 1,
                                cursor: addingAdmin || !newAdminPrincipal ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {addingAdmin ? <FaSpinner className="spin" /> : <FaPlus />}
                            Add Admin
                        </button>
                    </div>
                </section>
                
                {/* General Config */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaClock style={{ color: theme.colors.info || theme.colors.accent }} />
                        General Configuration
                    </h2>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
                        <div>
                            <label style={styles.label}>Minimum Offer Duration (minutes)</label>
                            <input
                                type="number"
                                min="0"
                                step="1"
                                value={newMinDuration}
                                onChange={(e) => setNewMinDuration(e.target.value)}
                                style={{ ...styles.input, width: '100%' }}
                            />
                            <small style={{ color: theme.colors.mutedText }}>
                                Minimum time an offer must remain active (set to 1 for quick testing)
                            </small>
                        </div>
                        <div>
                            <label style={styles.label}>Max Assets Per Offer</label>
                            <input
                                type="number"
                                min="1"
                                max="100"
                                value={newMaxAssets}
                                onChange={(e) => setNewMaxAssets(e.target.value)}
                                style={{ ...styles.input, width: '100%' }}
                            />
                            <small style={{ color: theme.colors.mutedText }}>
                                Maximum assets that can be bundled in one offer
                            </small>
                        </div>
                    </div>
                    
                    <button
                        onClick={handleSaveConfig}
                        disabled={savingConfig}
                        style={{
                            ...styles.button,
                            marginTop: '1.5rem',
                            opacity: savingConfig ? 0.5 : 1,
                            cursor: savingConfig ? 'not-allowed' : 'pointer',
                        }}
                    >
                        {savingConfig ? <FaSpinner className="spin" /> : <FaSave />}
                        Save Configuration
                    </button>
                </section>
                
                {/* Asset Types */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaLayerGroup style={{ color: theme.colors.success }} />
                        Asset Types
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Asset types define what can be traded on the marketplace. Deactivated types cannot be used for new offers.
                    </p>
                    
                    <div style={styles.list}>
                        {assetTypes.map((assetType) => (
                            <div key={assetType.id} style={styles.listItem}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <span style={styles.value}>
                                            #{Number(assetType.id)} {assetType.name}
                                        </span>
                                        <span style={{
                                            ...styles.badge,
                                            ...(assetType.active ? styles.badgeActive : styles.badgeInactive),
                                        }}>
                                            {assetType.active ? (
                                                <><FaCheckCircle style={{ marginRight: '4px' }} />Active</>
                                            ) : (
                                                <><FaTimesCircle style={{ marginRight: '4px' }} />Inactive</>
                                            )}
                                        </span>
                                    </div>
                                    {assetType.description && (
                                        <div style={{ color: theme.colors.mutedText, fontSize: '0.9rem', marginTop: '0.25rem' }}>
                                            {assetType.description}
                                        </div>
                                    )}
                                </div>
                                {assetType.active && (
                                    <button
                                        onClick={() => handleDeactivateAssetType(assetType)}
                                        disabled={deactivatingAssetType === assetType.id}
                                        style={{
                                            ...styles.buttonDanger,
                                            opacity: deactivatingAssetType === assetType.id ? 0.5 : 1,
                                            cursor: deactivatingAssetType === assetType.id ? 'not-allowed' : 'pointer',
                                        }}
                                    >
                                        {deactivatingAssetType === assetType.id ? <FaSpinner className="spin" /> : <FaTimesCircle />}
                                        Deactivate
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                    
                    <div style={{ marginTop: '1.5rem', padding: '1rem', background: theme.colors.tertiaryBg, borderRadius: '10px' }}>
                        <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: theme.colors.primaryText }}>
                            <FaPlus style={{ marginRight: '8px' }} />
                            Add New Asset Type
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <input
                                type="text"
                                placeholder="Asset type name (e.g., NFT)"
                                value={newAssetTypeName}
                                onChange={(e) => setNewAssetTypeName(e.target.value)}
                                style={styles.input}
                            />
                            <input
                                type="text"
                                placeholder="Description (optional)"
                                value={newAssetTypeDescription}
                                onChange={(e) => setNewAssetTypeDescription(e.target.value)}
                                style={styles.input}
                            />
                            <button
                                onClick={handleAddAssetType}
                                disabled={addingAssetType || !newAssetTypeName.trim()}
                                style={{
                                    ...styles.buttonSuccess,
                                    width: 'fit-content',
                                    opacity: addingAssetType || !newAssetTypeName.trim() ? 0.5 : 1,
                                    cursor: addingAssetType || !newAssetTypeName.trim() ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {addingAssetType ? <FaSpinner className="spin" /> : <FaPlus />}
                                Add Asset Type
                            </button>
                        </div>
                    </div>
                </section>
                
                {/* Wallet Registration Settings */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaCubes style={{ color: theme.colors.info || theme.colors.accent }} />
                        Wallet Registration Integration
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Configure canister IDs for automatic wallet registration of delivered assets.
                        When set, Sneedex will automatically register canisters, tokens, and ICP staking bots 
                        to buyers' wallets upon delivery. Leave empty to disable.
                    </p>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                        {/* Backend Canister ID */}
                        <div style={{ padding: '1rem', background: theme.colors.tertiaryBg, borderRadius: '10px' }}>
                            <label style={styles.label}>Backend Canister ID</label>
                            <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                                Used for registering canisters and tokens to user wallets
                            </p>
                            {backendCanisterId && (
                                <div style={{ marginBottom: '0.75rem', padding: '0.5rem', background: theme.colors.secondaryBg, borderRadius: '8px' }}>
                                    <span style={{ color: theme.colors.success, marginRight: '8px' }}>✓ Current:</span>
                                    <PrincipalDisplay principal={backendCanisterId.toString()} short={true} />
                                </div>
                            )}
                            <div style={{ ...styles.row, gap: '0.5rem' }}>
                                <input
                                    type="text"
                                    placeholder={backendCanisterId ? "New canister ID (or leave empty to clear)" : "Enter canister ID"}
                                    value={newBackendCanisterId}
                                    onChange={(e) => setNewBackendCanisterId(e.target.value)}
                                    style={{ ...styles.input, flex: 1 }}
                                />
                                <button
                                    onClick={handleSaveBackendCanisterId}
                                    disabled={savingBackendCanisterId}
                                    style={{
                                        ...styles.button,
                                        opacity: savingBackendCanisterId ? 0.5 : 1,
                                        cursor: savingBackendCanisterId ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {savingBackendCanisterId ? <FaSpinner className="spin" /> : <FaSave />}
                                    {newBackendCanisterId.trim() ? 'Set' : (backendCanisterId ? 'Clear' : 'Set')}
                                </button>
                            </div>
                        </div>
                        
                        {/* Staking Bot Factory Canister ID */}
                        <div style={{ padding: '1rem', background: theme.colors.tertiaryBg, borderRadius: '10px' }}>
                            <label style={styles.label}>Staking Bot Factory Canister ID</label>
                            <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                                Used for registering ICP staking bots to users
                            </p>
                            {factoryCanisterId && (
                                <div style={{ marginBottom: '0.75rem', padding: '0.5rem', background: theme.colors.secondaryBg, borderRadius: '8px' }}>
                                    <span style={{ color: theme.colors.success, marginRight: '8px' }}>✓ Current:</span>
                                    <PrincipalDisplay principal={factoryCanisterId.toString()} short={true} />
                                </div>
                            )}
                            <div style={{ ...styles.row, gap: '0.5rem' }}>
                                <input
                                    type="text"
                                    placeholder={factoryCanisterId ? "New canister ID (or leave empty to clear)" : "Enter canister ID"}
                                    value={newFactoryCanisterId}
                                    onChange={(e) => setNewFactoryCanisterId(e.target.value)}
                                    style={{ ...styles.input, flex: 1 }}
                                />
                                <button
                                    onClick={handleSaveFactoryCanisterId}
                                    disabled={savingFactoryCanisterId}
                                    style={{
                                        ...styles.button,
                                        opacity: savingFactoryCanisterId ? 0.5 : 1,
                                        cursor: savingFactoryCanisterId ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {savingFactoryCanisterId ? <FaSpinner className="spin" /> : <FaSave />}
                                    {newFactoryCanisterId.trim() ? 'Set' : (factoryCanisterId ? 'Clear' : 'Set')}
                                </button>
                            </div>
                        </div>
                        
                        {/* Sneed SMS Canister ID */}
                        <div style={{ padding: '1rem', background: theme.colors.tertiaryBg, borderRadius: '10px' }}>
                            <label style={styles.label}>Sneed SMS Canister ID</label>
                            <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                                Used for sending auction notifications (bid received, outbid, sale, etc.)
                            </p>
                            {smsCanisterId && (
                                <div style={{ marginBottom: '0.75rem', padding: '0.5rem', background: theme.colors.secondaryBg, borderRadius: '8px' }}>
                                    <span style={{ color: theme.colors.success, marginRight: '8px' }}>✓ Current:</span>
                                    <PrincipalDisplay principal={smsCanisterId.toString()} short={true} />
                                </div>
                            )}
                            <div style={{ ...styles.row, gap: '0.5rem' }}>
                                <input
                                    type="text"
                                    placeholder={smsCanisterId ? "New canister ID (or leave empty to clear)" : "Enter canister ID"}
                                    value={newSmsCanisterId}
                                    onChange={(e) => setNewSmsCanisterId(e.target.value)}
                                    style={{ ...styles.input, flex: 1 }}
                                />
                                <button
                                    onClick={handleSaveSmsCanisterId}
                                    disabled={savingSmsCanisterId}
                                    style={{
                                        ...styles.button,
                                        opacity: savingSmsCanisterId ? 0.5 : 1,
                                        cursor: savingSmsCanisterId ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {savingSmsCanisterId ? <FaSpinner className="spin" /> : <FaSave />}
                                    {newSmsCanisterId.trim() ? 'Set' : (smsCanisterId ? 'Clear' : 'Set')}
                                </button>
                            </div>
                        </div>
                    </div>
                </section>
                
                {/* Expiration Timer Settings */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaClock style={{ color: theme.colors.warning }} />
                        Expiration Auto-Processing Timer
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Automatically process expired offers on a periodic schedule. When an offer expires, 
                        if there are bids, the highest bidder wins; otherwise, assets are returned to the seller.
                    </p>
                    
                    {/* Timer Status */}
                    <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '1rem', 
                        marginBottom: '1.5rem',
                        padding: '1rem',
                        background: theme.colors.tertiaryBg,
                        borderRadius: '10px',
                        flexWrap: 'wrap'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: theme.colors.mutedText }}>Timer Status:</span>
                            <span style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '6px',
                                fontWeight: '600',
                                color: expirationTimerRunning ? theme.colors.success : theme.colors.mutedText
                            }}>
                                {expirationTimerRunning ? (
                                    <><FaCheckCircle /> Running</>
                                ) : (
                                    <><FaTimesCircle /> Stopped</>
                                )}
                            </span>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: theme.colors.mutedText }}>Worker:</span>
                            <span style={{ 
                                color: expirationWorkerRunning ? theme.colors.warning : theme.colors.mutedText,
                                fontWeight: expirationWorkerRunning ? '600' : 'normal'
                            }}>
                                {expirationWorkerRunning ? '⚡ Processing...' : 'Idle'}
                            </span>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: theme.colors.mutedText }}>Interval:</span>
                            <span style={{ fontWeight: '600' }}>
                                {expirationCheckInterval >= 3600 
                                    ? `${Math.floor(expirationCheckInterval / 3600)}h ${Math.floor((expirationCheckInterval % 3600) / 60)}m`
                                    : `${Math.floor(expirationCheckInterval / 60)}m`
                                }
                            </span>
                        </div>
                        
                        <button
                            onClick={handleToggleExpirationTimer}
                            disabled={togglingExpirationTimer}
                            style={{
                                ...styles.button,
                                background: expirationTimerRunning ? theme.colors.warning : theme.colors.success,
                                marginLeft: 'auto',
                                opacity: togglingExpirationTimer ? 0.5 : 1,
                                cursor: togglingExpirationTimer ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {togglingExpirationTimer ? <FaSpinner className="spin" /> : (expirationTimerRunning ? <FaTimesCircle /> : <FaCheckCircle />)}
                            {expirationTimerRunning ? 'Stop Timer' : 'Start Timer'}
                        </button>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
                        {/* Set Interval */}
                        <div style={{ padding: '1rem', background: theme.colors.tertiaryBg, borderRadius: '10px' }}>
                            <label style={styles.label}>Check Interval (minutes)</label>
                            <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                                How often to check for expired offers
                            </p>
                            <div style={{ ...styles.row, gap: '0.5rem' }}>
                                <input
                                    type="number"
                                    placeholder={String(Math.floor(expirationCheckInterval / 60))}
                                    value={newExpirationInterval}
                                    onChange={(e) => setNewExpirationInterval(e.target.value)}
                                    min="1"
                                    style={{ ...styles.input, flex: 1 }}
                                />
                                <button
                                    onClick={handleSaveExpirationInterval}
                                    disabled={savingExpirationInterval || !newExpirationInterval.trim()}
                                    style={{
                                        ...styles.button,
                                        opacity: (savingExpirationInterval || !newExpirationInterval.trim()) ? 0.5 : 1,
                                        cursor: (savingExpirationInterval || !newExpirationInterval.trim()) ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {savingExpirationInterval ? <FaSpinner className="spin" /> : <FaSave />}
                                    Set
                                </button>
                            </div>
                        </div>
                        
                        {/* Manual Trigger */}
                        <div style={{ padding: '1rem', background: theme.colors.tertiaryBg, borderRadius: '10px' }}>
                            <label style={styles.label}>Manual Trigger</label>
                            <p style={{ color: theme.colors.mutedText, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                                Immediately process any expired offers
                            </p>
                            <button
                                onClick={handleTriggerExpirationCheck}
                                disabled={triggeringExpirationCheck || expirationWorkerRunning}
                                style={{
                                    ...styles.button,
                                    background: theme.colors.info || theme.colors.accent,
                                    width: '100%',
                                    opacity: (triggeringExpirationCheck || expirationWorkerRunning) ? 0.5 : 1,
                                    cursor: (triggeringExpirationCheck || expirationWorkerRunning) ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {triggeringExpirationCheck ? <FaSpinner className="spin" /> : <FaClock />}
                                {expirationWorkerRunning ? 'Worker Running...' : 'Trigger Now'}
                            </button>
                        </div>
                    </div>
                </section>
                
            </main>
            
            <InfoModal
                isOpen={infoModal.show}
                onClose={closeInfoModal}
                title={infoModal.title}
                message={infoModal.message}
                type={infoModal.type}
            />
            
            <ConfirmationModal
                isOpen={confirmModal.show}
                onClose={closeConfirmModal}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
            />
        </div>
    );
}

