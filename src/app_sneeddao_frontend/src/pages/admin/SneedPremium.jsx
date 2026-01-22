import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { useTheme } from '../../contexts/ThemeContext';
import Header from '../../components/Header';
import { Principal } from '@dfinity/principal';
import { 
    createSneedPremiumActor, 
    formatDuration, 
    formatIcp, 
    formatVotingPower,
    formatTimestamp,
    getTimeRemaining,
    parseDurationToNs,
    parseIcpToE8s,
    E8S_PER_ICP,
    NS_PER_DAY,
    NS_PER_MONTH,
    NS_PER_YEAR
} from '../../utils/SneedPremiumUtils';
import { PrincipalDisplay } from '../../utils/PrincipalUtils';
import InfoModal from '../../components/InfoModal';
import ConfirmationModal from '../../ConfirmationModal';
import { 
    FaCrown, FaUserShield, FaSave, FaSpinner, FaPlus, FaTrash, 
    FaClock, FaCoins, FaVoteYea, FaUsers, FaEdit, FaCheckCircle, 
    FaTimesCircle, FaCog, FaWallet, FaTimes, FaTicketAlt, FaCopy,
    FaEye, FaPause, FaPlay
} from 'react-icons/fa';

export default function SneedPremiumAdmin() {
    const { isAuthenticated, identity } = useAuth();
    const { theme } = useTheme();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    
    // Store actor reference to avoid recreating it
    const actorRef = useRef(null);
    
    // Admin check
    const { isAdmin: isGlobalAdmin, loading: adminLoading } = useAdminCheck({
        identity,
        isAuthenticated,
        redirectPath: '/admin'
    });
    
    // Config state
    const [config, setConfig] = useState(null);
    const [adminList, setAdminList] = useState([]);
    const [icpTiers, setIcpTiers] = useState([]);
    const [vpTiers, setVpTiers] = useState([]);
    const [memberships, setMemberships] = useState([]);
    const [canisterId, setCanisterId] = useState(null);
    
    // Form states - Admin management
    const [newAdminPrincipal, setNewAdminPrincipal] = useState('');
    
    // Form states - ICP Tier
    const [newIcpTierName, setNewIcpTierName] = useState('');
    const [newIcpTierAmount, setNewIcpTierAmount] = useState('');
    const [newIcpTierDuration, setNewIcpTierDuration] = useState('');
    const [newIcpTierDurationUnit, setNewIcpTierDurationUnit] = useState('months');
    
    // Form states - VP Tier
    const [newVpTierName, setNewVpTierName] = useState('');
    const [newVpTierMinVp, setNewVpTierMinVp] = useState('');
    const [newVpTierDuration, setNewVpTierDuration] = useState('');
    const [newVpTierDurationUnit, setNewVpTierDurationUnit] = useState('months');
    
    // Form states - Config
    const [newPaymentRecipientPrincipal, setNewPaymentRecipientPrincipal] = useState('');
    const [newPaymentRecipientSubaccount, setNewPaymentRecipientSubaccount] = useState('');
    const [newMinClaimInterval, setNewMinClaimInterval] = useState('');
    const [newMinClaimIntervalUnit, setNewMinClaimIntervalUnit] = useState('hours');
    
    // Form states - Manual membership
    const [manualMemberPrincipal, setManualMemberPrincipal] = useState('');
    const [manualMemberDuration, setManualMemberDuration] = useState('');
    const [manualMemberDurationUnit, setManualMemberDurationUnit] = useState('months');
    
    // Promo codes state
    const [promoCodes, setPromoCodes] = useState([]);
    const [newPromoCodeDuration, setNewPromoCodeDuration] = useState('');
    const [newPromoCodeDurationUnit, setNewPromoCodeDurationUnit] = useState('months');
    const [newPromoCodeMaxClaims, setNewPromoCodeMaxClaims] = useState('');
    const [newPromoCodeExpiration, setNewPromoCodeExpiration] = useState('');
    const [newPromoCodeNotes, setNewPromoCodeNotes] = useState('');
    const [creatingPromoCode, setCreatingPromoCode] = useState(false);
    const [deactivatingPromoCode, setDeactivatingPromoCode] = useState(null);
    const [deletingPromoCode, setDeletingPromoCode] = useState(null);
    const [viewClaimsModal, setViewClaimsModal] = useState({ show: false, code: null, claims: [] });
    const [loadingClaims, setLoadingClaims] = useState(false);
    
    // Edit modal state
    const [editIcpTierModal, setEditIcpTierModal] = useState({ show: false, index: null, tier: null });
    const [editVpTierModal, setEditVpTierModal] = useState({ show: false, index: null, tier: null });
    const [editIcpTierName, setEditIcpTierName] = useState('');
    const [editIcpTierAmount, setEditIcpTierAmount] = useState('');
    const [editIcpTierDuration, setEditIcpTierDuration] = useState('');
    const [editIcpTierDurationUnit, setEditIcpTierDurationUnit] = useState('months');
    const [editIcpTierActive, setEditIcpTierActive] = useState(true);
    const [editVpTierName, setEditVpTierName] = useState('');
    const [editVpTierMinVp, setEditVpTierMinVp] = useState('');
    const [editVpTierDuration, setEditVpTierDuration] = useState('');
    const [editVpTierDurationUnit, setEditVpTierDurationUnit] = useState('months');
    const [editVpTierActive, setEditVpTierActive] = useState(true);
    
    // Loading states
    const [addingAdmin, setAddingAdmin] = useState(false);
    const [removingAdmin, setRemovingAdmin] = useState(null);
    const [addingIcpTier, setAddingIcpTier] = useState(false);
    const [removingIcpTier, setRemovingIcpTier] = useState(null);
    const [updatingIcpTier, setUpdatingIcpTier] = useState(false);
    const [addingVpTier, setAddingVpTier] = useState(false);
    const [removingVpTier, setRemovingVpTier] = useState(null);
    const [updatingVpTier, setUpdatingVpTier] = useState(false);
    const [savingPaymentRecipient, setSavingPaymentRecipient] = useState(false);
    const [savingMinClaimInterval, setSavingMinClaimInterval] = useState(false);
    const [grantingMembership, setGrantingMembership] = useState(false);
    const [revokingMembership, setRevokingMembership] = useState(null);
    
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
    
    // Get or create actor
    const getActor = useCallback(async () => {
        if (!identity) return null;
        if (!actorRef.current) {
            actorRef.current = await createSneedPremiumActor(identity);
        }
        return actorRef.current;
    }, [identity]);
    
    // Reset actor when identity changes
    useEffect(() => {
        actorRef.current = null;
    }, [identity]);
    
    const fetchData = useCallback(async () => {
        if (!isAuthenticated || !identity) return;
        
        setLoading(true);
        setError('');
        
        try {
            const actor = await getActor();
            if (!actor) return;
            
            const [configResult, icpTiersResult, vpTiersResult, membershipsResult, canisterIdResult, promoCodesResult] = await Promise.all([
                actor.getConfig(),
                actor.getAllIcpTiers(),
                actor.getAllVotingPowerTiers(),
                actor.getAllMemberships(),
                actor.getCanisterId(),
                actor.getPromoCodes(),
            ]);
            
            setConfig(configResult);
            setAdminList(configResult.admins || []);
            setIcpTiers(icpTiersResult);
            setVpTiers(vpTiersResult);
            setMemberships(membershipsResult);
            setCanisterId(canisterIdResult);
            if ('ok' in promoCodesResult) {
                setPromoCodes(promoCodesResult.ok);
            }
            
        } catch (err) {
            console.error('Failed to fetch Sneed Premium config:', err);
            setError('Failed to load Sneed Premium configuration: ' + err.message);
        } finally {
            setLoading(false);
        }
    }, [isAuthenticated, identity, getActor]);
    
    useEffect(() => {
        if (isAuthenticated && identity && !adminLoading) {
            fetchData();
        }
    }, [isAuthenticated, identity, adminLoading, fetchData]);
    
    // Check if user is Premium admin
    const isPremiumAdmin = adminList.some(admin => 
        admin.toString() === identity?.getPrincipal()?.toString()
    );
    
    // ============================================
    // Admin Management Handlers
    // ============================================
    
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
            const actor = await getActor();
            const result = await actor.addAdmin(principal);
            if ('ok' in result) {
                showInfo('Success', 'Admin added successfully', 'success');
                await fetchData();
                setNewAdminPrincipal('');
            } else {
                showInfo('Error', 'Failed to add admin: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to add admin: ' + e.message, 'error');
        }
        setAddingAdmin(false);
    };
    
    const handleRemoveAdmin = (adminPrincipal) => {
        showConfirm(
            'Remove Admin',
            `Are you sure you want to remove this admin?\n\n${adminPrincipal.toString()}`,
            () => doRemoveAdmin(adminPrincipal)
        );
    };
    
    const doRemoveAdmin = async (adminPrincipal) => {
        closeConfirmModal();
        setRemovingAdmin(adminPrincipal.toString());
        try {
            const actor = await getActor();
            const result = await actor.removeAdmin(adminPrincipal);
            if ('ok' in result) {
                showInfo('Success', 'Admin removed successfully', 'success');
                await fetchData();
            } else {
                showInfo('Error', 'Failed to remove admin: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to remove admin: ' + e.message, 'error');
        }
        setRemovingAdmin(null);
    };
    
    // ============================================
    // ICP Tier Handlers
    // ============================================
    
    const handleAddIcpTier = async () => {
        if (!newIcpTierName.trim()) {
            showInfo('Invalid Name', 'Please enter a tier name', 'error');
            return;
        }
        
        let amountE8s;
        try {
            amountE8s = parseIcpToE8s(newIcpTierAmount);
        } catch (e) {
            showInfo('Invalid Amount', 'Please enter a valid ICP amount', 'error');
            return;
        }
        
        const durationNum = parseFloat(newIcpTierDuration);
        if (isNaN(durationNum) || durationNum <= 0) {
            showInfo('Invalid Duration', 'Please enter a valid duration', 'error');
            return;
        }
        
        const durationNs = parseDurationToNs(durationNum, newIcpTierDurationUnit);
        
        setAddingIcpTier(true);
        try {
            const actor = await getActor();
            const tier = {
                amountE8s: amountE8s,
                durationNs: durationNs,
                name: newIcpTierName.trim(),
                active: true,
            };
            const result = await actor.addIcpTier(tier);
            if ('ok' in result) {
                showInfo('Success', `ICP tier "${newIcpTierName}" added successfully`, 'success');
                await fetchData();
                setNewIcpTierName('');
                setNewIcpTierAmount('');
                setNewIcpTierDuration('');
            } else {
                showInfo('Error', 'Failed to add ICP tier: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to add ICP tier: ' + e.message, 'error');
        }
        setAddingIcpTier(false);
    };
    
    const handleRemoveIcpTier = (index) => {
        const tier = icpTiers[index];
        showConfirm(
            'Remove ICP Tier',
            `Are you sure you want to remove "${tier.name}"?\n\n${formatIcp(tier.amountE8s)} → ${formatDuration(tier.durationNs)}`,
            () => doRemoveIcpTier(index)
        );
    };
    
    const doRemoveIcpTier = async (index) => {
        closeConfirmModal();
        setRemovingIcpTier(index);
        try {
            const actor = await getActor();
            const result = await actor.removeIcpTier(BigInt(index));
            if ('ok' in result) {
                showInfo('Success', 'ICP tier removed successfully', 'success');
                await fetchData();
            } else {
                showInfo('Error', 'Failed to remove ICP tier: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to remove ICP tier: ' + e.message, 'error');
        }
        setRemovingIcpTier(null);
    };
    
    const openEditIcpTierModal = (index) => {
        const tier = icpTiers[index];
        const amountIcp = Number(tier.amountE8s) / Number(E8S_PER_ICP);
        // Estimate duration in the closest unit
        const durationNs = BigInt(tier.durationNs);
        let durationValue, durationUnit;
        if (durationNs >= NS_PER_YEAR && durationNs % NS_PER_YEAR === 0n) {
            durationValue = Number(durationNs / NS_PER_YEAR);
            durationUnit = 'years';
        } else if (durationNs >= NS_PER_MONTH && durationNs % NS_PER_MONTH === 0n) {
            durationValue = Number(durationNs / NS_PER_MONTH);
            durationUnit = 'months';
        } else if (durationNs >= NS_PER_DAY) {
            durationValue = Number(durationNs / NS_PER_DAY);
            durationUnit = 'days';
        } else {
            durationValue = Number(durationNs / NS_PER_DAY);
            durationUnit = 'days';
        }
        
        setEditIcpTierName(tier.name);
        setEditIcpTierAmount(amountIcp.toString());
        setEditIcpTierDuration(durationValue.toString());
        setEditIcpTierDurationUnit(durationUnit);
        setEditIcpTierActive(tier.active);
        setEditIcpTierModal({ show: true, index, tier });
    };
    
    const handleUpdateIcpTier = async () => {
        if (!editIcpTierName.trim()) {
            showInfo('Invalid Name', 'Please enter a tier name', 'error');
            return;
        }
        
        let amountE8s;
        try {
            amountE8s = parseIcpToE8s(editIcpTierAmount);
        } catch (e) {
            showInfo('Invalid Amount', 'Please enter a valid ICP amount', 'error');
            return;
        }
        
        const durationNum = parseFloat(editIcpTierDuration);
        if (isNaN(durationNum) || durationNum <= 0) {
            showInfo('Invalid Duration', 'Please enter a valid duration', 'error');
            return;
        }
        
        const durationNs = parseDurationToNs(durationNum, editIcpTierDurationUnit);
        
        setUpdatingIcpTier(true);
        try {
            const actor = await getActor();
            const tier = {
                amountE8s: amountE8s,
                durationNs: durationNs,
                name: editIcpTierName.trim(),
                active: editIcpTierActive,
            };
            const result = await actor.updateIcpTier(BigInt(editIcpTierModal.index), tier);
            if ('ok' in result) {
                showInfo('Success', `ICP tier updated successfully`, 'success');
                await fetchData();
                setEditIcpTierModal({ show: false, index: null, tier: null });
            } else {
                showInfo('Error', 'Failed to update ICP tier: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update ICP tier: ' + e.message, 'error');
        }
        setUpdatingIcpTier(false);
    };
    
    // ============================================
    // Voting Power Tier Handlers
    // ============================================
    
    const handleAddVpTier = async () => {
        if (!newVpTierName.trim()) {
            showInfo('Invalid Name', 'Please enter a tier name', 'error');
            return;
        }
        
        const minVpNum = parseFloat(newVpTierMinVp);
        if (isNaN(minVpNum) || minVpNum < 0) {
            showInfo('Invalid Voting Power', 'Please enter a valid minimum voting power', 'error');
            return;
        }
        const minVpE8s = BigInt(Math.round(minVpNum * Number(E8S_PER_ICP)));
        
        const durationNum = parseFloat(newVpTierDuration);
        if (isNaN(durationNum) || durationNum <= 0) {
            showInfo('Invalid Duration', 'Please enter a valid duration', 'error');
            return;
        }
        
        const durationNs = parseDurationToNs(durationNum, newVpTierDurationUnit);
        
        setAddingVpTier(true);
        try {
            const actor = await getActor();
            const tier = {
                minVotingPowerE8s: minVpE8s,
                durationNs: durationNs,
                name: newVpTierName.trim(),
                active: true,
            };
            const result = await actor.addVpTier(tier);
            if ('ok' in result) {
                showInfo('Success', `Voting power tier "${newVpTierName}" added successfully`, 'success');
                await fetchData();
                setNewVpTierName('');
                setNewVpTierMinVp('');
                setNewVpTierDuration('');
            } else {
                showInfo('Error', 'Failed to add VP tier: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to add VP tier: ' + e.message, 'error');
        }
        setAddingVpTier(false);
    };
    
    const handleRemoveVpTier = (index) => {
        const tier = vpTiers[index];
        showConfirm(
            'Remove Voting Power Tier',
            `Are you sure you want to remove "${tier.name}"?\n\n${formatVotingPower(tier.minVotingPowerE8s)} → ${formatDuration(tier.durationNs)}`,
            () => doRemoveVpTier(index)
        );
    };
    
    const doRemoveVpTier = async (index) => {
        closeConfirmModal();
        setRemovingVpTier(index);
        try {
            const actor = await getActor();
            const result = await actor.removeVpTier(BigInt(index));
            if ('ok' in result) {
                showInfo('Success', 'VP tier removed successfully', 'success');
                await fetchData();
            } else {
                showInfo('Error', 'Failed to remove VP tier: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to remove VP tier: ' + e.message, 'error');
        }
        setRemovingVpTier(null);
    };
    
    const openEditVpTierModal = (index) => {
        const tier = vpTiers[index];
        const minVp = Number(tier.minVotingPowerE8s) / Number(E8S_PER_ICP);
        // Estimate duration in the closest unit
        const durationNs = BigInt(tier.durationNs);
        let durationValue, durationUnit;
        if (durationNs >= NS_PER_YEAR && durationNs % NS_PER_YEAR === 0n) {
            durationValue = Number(durationNs / NS_PER_YEAR);
            durationUnit = 'years';
        } else if (durationNs >= NS_PER_MONTH && durationNs % NS_PER_MONTH === 0n) {
            durationValue = Number(durationNs / NS_PER_MONTH);
            durationUnit = 'months';
        } else if (durationNs >= NS_PER_DAY) {
            durationValue = Number(durationNs / NS_PER_DAY);
            durationUnit = 'days';
        } else {
            durationValue = Number(durationNs / NS_PER_DAY);
            durationUnit = 'days';
        }
        
        setEditVpTierName(tier.name);
        setEditVpTierMinVp(minVp.toString());
        setEditVpTierDuration(durationValue.toString());
        setEditVpTierDurationUnit(durationUnit);
        setEditVpTierActive(tier.active);
        setEditVpTierModal({ show: true, index, tier });
    };
    
    const handleUpdateVpTier = async () => {
        if (!editVpTierName.trim()) {
            showInfo('Invalid Name', 'Please enter a tier name', 'error');
            return;
        }
        
        const minVpNum = parseFloat(editVpTierMinVp);
        if (isNaN(minVpNum) || minVpNum < 0) {
            showInfo('Invalid Voting Power', 'Please enter a valid minimum voting power', 'error');
            return;
        }
        const minVpE8s = BigInt(Math.round(minVpNum * Number(E8S_PER_ICP)));
        
        const durationNum = parseFloat(editVpTierDuration);
        if (isNaN(durationNum) || durationNum <= 0) {
            showInfo('Invalid Duration', 'Please enter a valid duration', 'error');
            return;
        }
        
        const durationNs = parseDurationToNs(durationNum, editVpTierDurationUnit);
        
        setUpdatingVpTier(true);
        try {
            const actor = await getActor();
            const tier = {
                minVotingPowerE8s: minVpE8s,
                durationNs: durationNs,
                name: editVpTierName.trim(),
                active: editVpTierActive,
            };
            const result = await actor.updateVpTier(BigInt(editVpTierModal.index), tier);
            if ('ok' in result) {
                showInfo('Success', `VP tier updated successfully`, 'success');
                await fetchData();
                setEditVpTierModal({ show: false, index: null, tier: null });
            } else {
                showInfo('Error', 'Failed to update VP tier: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update VP tier: ' + e.message, 'error');
        }
        setUpdatingVpTier(false);
    };
    
    // ============================================
    // Config Handlers
    // ============================================
    
    const handleSavePaymentRecipient = async () => {
        let principal;
        try {
            principal = Principal.fromText(newPaymentRecipientPrincipal);
        } catch (e) {
            showInfo('Invalid Principal', 'Please enter a valid principal ID', 'error');
            return;
        }
        
        let subaccount = [];
        if (newPaymentRecipientSubaccount.trim()) {
            try {
                const hex = newPaymentRecipientSubaccount.replace(/^0x/, '');
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
        
        setSavingPaymentRecipient(true);
        try {
            const actor = await getActor();
            const result = await actor.setPaymentRecipient({
                owner: principal,
                subaccount: subaccount,
            });
            if ('ok' in result) {
                showInfo('Success', 'Payment recipient updated successfully', 'success');
                await fetchData();
                setNewPaymentRecipientPrincipal('');
                setNewPaymentRecipientSubaccount('');
            } else {
                showInfo('Error', 'Failed to update payment recipient: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update payment recipient: ' + e.message, 'error');
        }
        setSavingPaymentRecipient(false);
    };
    
    const handleSaveMinClaimInterval = async () => {
        const intervalNum = parseFloat(newMinClaimInterval);
        if (isNaN(intervalNum) || intervalNum < 0) {
            showInfo('Invalid Interval', 'Please enter a valid interval', 'error');
            return;
        }
        
        const intervalNs = parseDurationToNs(intervalNum, newMinClaimIntervalUnit);
        
        setSavingMinClaimInterval(true);
        try {
            const actor = await getActor();
            const result = await actor.setMinClaimInterval(intervalNs);
            if ('ok' in result) {
                showInfo('Success', 'Minimum claim interval updated successfully', 'success');
                await fetchData();
                setNewMinClaimInterval('');
            } else {
                showInfo('Error', 'Failed to update interval: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to update interval: ' + e.message, 'error');
        }
        setSavingMinClaimInterval(false);
    };
    
    // ============================================
    // Membership Management Handlers
    // ============================================
    
    const handleGrantMembership = async () => {
        let principal;
        try {
            principal = Principal.fromText(manualMemberPrincipal);
        } catch (e) {
            showInfo('Invalid Principal', 'Please enter a valid principal ID', 'error');
            return;
        }
        
        const durationNum = parseFloat(manualMemberDuration);
        if (isNaN(durationNum) || durationNum <= 0) {
            showInfo('Invalid Duration', 'Please enter a valid duration', 'error');
            return;
        }
        
        const durationNs = parseDurationToNs(durationNum, manualMemberDurationUnit);
        
        setGrantingMembership(true);
        try {
            const actor = await getActor();
            const result = await actor.extendMembershipAdmin(principal, durationNs);
            if ('ok' in result) {
                showInfo('Success', `Membership granted/extended for ${durationNum} ${manualMemberDurationUnit}`, 'success');
                await fetchData();
                setManualMemberPrincipal('');
                setManualMemberDuration('');
            } else {
                showInfo('Error', 'Failed to grant membership: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to grant membership: ' + e.message, 'error');
        }
        setGrantingMembership(false);
    };
    
    const handleRevokeMembership = (principal) => {
        showConfirm(
            'Revoke Membership',
            `Are you sure you want to revoke membership for this principal?\n\n${principal.toString()}`,
            () => doRevokeMembership(principal)
        );
    };
    
    const doRevokeMembership = async (principal) => {
        closeConfirmModal();
        setRevokingMembership(principal.toString());
        try {
            const actor = await getActor();
            const result = await actor.revokeMembership(principal);
            if ('ok' in result) {
                showInfo('Success', 'Membership revoked successfully', 'success');
                await fetchData();
            } else {
                showInfo('Error', 'Failed to revoke membership: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to revoke membership: ' + e.message, 'error');
        }
        setRevokingMembership(null);
    };
    
    // ============================================
    // Promo Code Handlers
    // ============================================
    
    const handleCreatePromoCode = async () => {
        const durationNum = parseFloat(newPromoCodeDuration);
        if (isNaN(durationNum) || durationNum <= 0) {
            showInfo('Invalid Duration', 'Please enter a valid duration', 'error');
            return;
        }
        
        const maxClaimsNum = parseInt(newPromoCodeMaxClaims);
        if (isNaN(maxClaimsNum) || maxClaimsNum <= 0) {
            showInfo('Invalid Max Claims', 'Please enter a valid number of max claims', 'error');
            return;
        }
        
        const durationNs = parseDurationToNs(durationNum, newPromoCodeDurationUnit);
        
        // Parse optional expiration date
        let expiration = [];
        if (newPromoCodeExpiration) {
            const expDate = new Date(newPromoCodeExpiration);
            if (isNaN(expDate.getTime())) {
                showInfo('Invalid Expiration', 'Please enter a valid date', 'error');
                return;
            }
            expiration = [BigInt(expDate.getTime()) * 1_000_000n]; // Convert ms to ns
        }
        
        // Optional notes
        const notes = newPromoCodeNotes.trim() ? [newPromoCodeNotes.trim()] : [];
        
        setCreatingPromoCode(true);
        try {
            const actor = await getActor();
            const result = await actor.createPromoCode({
                durationNs: durationNs,
                maxClaims: BigInt(maxClaimsNum),
                expiration: expiration,
                notes: notes,
            });
            if ('ok' in result) {
                showInfo('Success', `Promo code created: ${result.ok.code}`, 'success');
                await fetchData();
                setNewPromoCodeDuration('');
                setNewPromoCodeMaxClaims('');
                setNewPromoCodeExpiration('');
                setNewPromoCodeNotes('');
            } else {
                showInfo('Error', 'Failed to create promo code: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to create promo code: ' + e.message, 'error');
        }
        setCreatingPromoCode(false);
    };
    
    const handleTogglePromoCode = async (code, currentActive) => {
        setDeactivatingPromoCode(code);
        try {
            const actor = await getActor();
            const result = currentActive 
                ? await actor.deactivatePromoCode(code)
                : await actor.reactivatePromoCode(code);
            if ('ok' in result) {
                showInfo('Success', `Promo code ${currentActive ? 'deactivated' : 'reactivated'}`, 'success');
                await fetchData();
            } else {
                showInfo('Error', `Failed to ${currentActive ? 'deactivate' : 'reactivate'} promo code: ` + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', `Failed to ${currentActive ? 'deactivate' : 'reactivate'} promo code: ` + e.message, 'error');
        }
        setDeactivatingPromoCode(null);
    };
    
    const handleDeletePromoCode = (code) => {
        showConfirm(
            'Delete Promo Code',
            `Are you sure you want to delete promo code "${code}"?\n\nThis action cannot be undone.`,
            () => doDeletePromoCode(code)
        );
    };
    
    const doDeletePromoCode = async (code) => {
        closeConfirmModal();
        setDeletingPromoCode(code);
        try {
            const actor = await getActor();
            const result = await actor.deletePromoCode(code);
            if ('ok' in result) {
                showInfo('Success', 'Promo code deleted', 'success');
                await fetchData();
            } else {
                showInfo('Error', 'Failed to delete promo code: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to delete promo code: ' + e.message, 'error');
        }
        setDeletingPromoCode(null);
    };
    
    const handleViewClaims = async (code) => {
        setLoadingClaims(true);
        setViewClaimsModal({ show: true, code, claims: [] });
        try {
            const actor = await getActor();
            const result = await actor.getPromoCodeClaims(code);
            if ('ok' in result) {
                setViewClaimsModal({ show: true, code, claims: result.ok });
            } else {
                showInfo('Error', 'Failed to load claims: ' + JSON.stringify(result.err), 'error');
            }
        } catch (e) {
            showInfo('Error', 'Failed to load claims: ' + e.message, 'error');
        }
        setLoadingClaims(false);
    };
    
    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        showInfo('Copied', 'Promo code copied to clipboard', 'success');
    };
    
    // ============================================
    // Styles
    // ============================================
    
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
            background: `linear-gradient(135deg, ${theme.colors.accent}, #FFD700)`,
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
            minWidth: '150px',
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
        select: {
            padding: '10px 14px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontSize: '1rem',
            cursor: 'pointer',
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
        buttonSecondary: {
            padding: '8px 14px',
            borderRadius: '8px',
            border: `1px solid ${theme.colors.border}`,
            background: theme.colors.secondaryBg,
            color: theme.colors.primaryText,
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
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
        tierItem: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px',
            background: theme.colors.tertiaryBg,
            borderRadius: '10px',
            border: `1px solid ${theme.colors.border}`,
            gap: '1rem',
        },
        tierInfo: {
            flex: 1,
        },
        tierName: {
            fontWeight: '600',
            color: theme.colors.primaryText,
            marginBottom: '4px',
        },
        tierDetails: {
            fontSize: '0.9rem',
            color: theme.colors.mutedText,
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
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
        badgeExpired: {
            background: `${theme.colors.error}20`,
            color: theme.colors.error,
        },
        label: {
            color: theme.colors.mutedText,
            fontSize: '0.9rem',
            marginBottom: '0.5rem',
            display: 'block',
        },
        infoBox: {
            padding: '1rem',
            background: theme.colors.tertiaryBg,
            borderRadius: '10px',
            marginBottom: '1rem',
        },
        infoLabel: {
            color: theme.colors.mutedText,
            fontSize: '0.85rem',
            marginBottom: '4px',
        },
        infoValue: {
            color: theme.colors.primaryText,
            fontWeight: '500',
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
        emptyState: {
            textAlign: 'center',
            padding: '2rem',
            color: theme.colors.mutedText,
            fontStyle: 'italic',
        },
        modal: {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
        },
        modalContent: {
            background: theme.colors.primaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '2rem',
            maxWidth: '500px',
            width: '90%',
            maxHeight: '90vh',
            overflow: 'auto',
        },
        modalHeader: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem',
        },
        modalTitle: {
            fontSize: '1.5rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
        },
        closeButton: {
            background: 'none',
            border: 'none',
            color: theme.colors.mutedText,
            cursor: 'pointer',
            fontSize: '1.5rem',
        },
        checkbox: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
        },
        tierActions: {
            display: 'flex',
            gap: '0.5rem',
        },
    };
    
    // ============================================
    // Render
    // ============================================
    
    if (adminLoading || loading) {
        return (
            <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.loading}>
                        <FaSpinner className="spin" size={32} />
                        <p style={{ marginTop: '1rem' }}>Loading Sneed Premium Admin...</p>
                    </div>
                </main>
            </div>
        );
    }
    
    if (!isGlobalAdmin && !isPremiumAdmin) {
        return (
            <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.error}>
                        <h2>Access Denied</h2>
                        <p>You must be a Sneed Premium admin to access this page.</p>
                    </div>
                </main>
            </div>
        );
    }
    
    const now = BigInt(Date.now()) * 1_000_000n;
    const activeMemberships = memberships.filter(([_, m]) => BigInt(m.expiration) > now);
    
    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                <h1 style={styles.title}>
                    <FaCrown style={{ color: '#FFD700' }} />
                    Sneed Premium Admin
                </h1>
                <p style={styles.subtitle}>
                    Manage premium membership tiers, admins, and configuration
                </p>
                
                {error && (
                    <div style={styles.error}>{error}</div>
                )}
                
                {/* Overview */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaCog style={{ color: theme.colors.accent }} />
                        Configuration Overview
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                        <div style={styles.infoBox}>
                            <div style={styles.infoLabel}>Canister ID</div>
                            <div style={styles.infoValue}>
                                {canisterId ? <PrincipalDisplay principal={canisterId.toString()} /> : 'Loading...'}
                            </div>
                        </div>
                        <div style={styles.infoBox}>
                            <div style={styles.infoLabel}>ICP Ledger</div>
                            <div style={styles.infoValue}>
                                {config ? <PrincipalDisplay principal={config.icpLedgerId.toString()} short /> : 'Loading...'}
                            </div>
                        </div>
                        <div style={styles.infoBox}>
                            <div style={styles.infoLabel}>Sneed Governance</div>
                            <div style={styles.infoValue}>
                                {config ? <PrincipalDisplay principal={config.sneedGovernanceId.toString()} short /> : 'Loading...'}
                            </div>
                        </div>
                        <div style={styles.infoBox}>
                            <div style={styles.infoLabel}>Active Members</div>
                            <div style={{ ...styles.infoValue, color: theme.colors.success, fontSize: '1.5rem' }}>
                                {activeMemberships.length}
                            </div>
                        </div>
                    </div>
                </section>
                
                {/* Payment Recipient */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaWallet style={{ color: theme.colors.success }} />
                        Payment Recipient
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        ICP payments will be forwarded to this account.
                        <br />
                        Current recipient: {config?.paymentRecipient ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                <PrincipalDisplay principal={config.paymentRecipient.owner.toString()} />
                            </span>
                        ) : 'Loading...'}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <input
                            type="text"
                            placeholder="Principal ID"
                            value={newPaymentRecipientPrincipal}
                            onChange={(e) => setNewPaymentRecipientPrincipal(e.target.value)}
                            style={{ ...styles.input, maxWidth: '500px' }}
                        />
                        <input
                            type="text"
                            placeholder="Subaccount (optional, 64-char hex)"
                            value={newPaymentRecipientSubaccount}
                            onChange={(e) => setNewPaymentRecipientSubaccount(e.target.value)}
                            style={{ ...styles.input, maxWidth: '500px' }}
                        />
                        <button
                            onClick={handleSavePaymentRecipient}
                            disabled={savingPaymentRecipient || !newPaymentRecipientPrincipal}
                            style={{
                                ...styles.buttonSuccess,
                                width: 'fit-content',
                                opacity: savingPaymentRecipient || !newPaymentRecipientPrincipal ? 0.5 : 1,
                                cursor: savingPaymentRecipient || !newPaymentRecipientPrincipal ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {savingPaymentRecipient ? <FaSpinner className="spin" /> : <FaSave />}
                            Save Recipient
                        </button>
                    </div>
                </section>
                
                {/* Min Claim Interval */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaClock style={{ color: theme.colors.warning }} />
                        Voting Power Claim Settings
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Minimum time between VP-based membership claims (prevents spam).
                        <br />
                        Current interval: <strong>{config ? formatDuration(config.minClaimIntervalNs) : 'Loading...'}</strong>
                    </p>
                    <div style={styles.row}>
                        <input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="Interval"
                            value={newMinClaimInterval}
                            onChange={(e) => setNewMinClaimInterval(e.target.value)}
                            style={styles.inputSmall}
                        />
                        <select
                            value={newMinClaimIntervalUnit}
                            onChange={(e) => setNewMinClaimIntervalUnit(e.target.value)}
                            style={styles.select}
                        >
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                            <option value="weeks">Weeks</option>
                        </select>
                        <button
                            onClick={handleSaveMinClaimInterval}
                            disabled={savingMinClaimInterval || !newMinClaimInterval}
                            style={{
                                ...styles.button,
                                opacity: savingMinClaimInterval || !newMinClaimInterval ? 0.5 : 1,
                                cursor: savingMinClaimInterval || !newMinClaimInterval ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {savingMinClaimInterval ? <FaSpinner className="spin" /> : <FaSave />}
                            Save
                        </button>
                    </div>
                </section>
                
                {/* ICP Tiers */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaCoins style={{ color: '#FFD700' }} />
                        ICP Payment Tiers
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Configure how much membership duration different ICP amounts provide.
                    </p>
                    
                    {icpTiers.length > 0 ? (
                        <div style={styles.list}>
                            {icpTiers.map((tier, index) => (
                                <div key={index} style={styles.tierItem}>
                                    <div style={styles.tierInfo}>
                                        <div style={styles.tierName}>{tier.name}</div>
                                        <div style={styles.tierDetails}>
                                            <span><FaCoins style={{ marginRight: '4px' }} />{formatIcp(tier.amountE8s)}</span>
                                            <span>→</span>
                                            <span><FaClock style={{ marginRight: '4px' }} />{formatDuration(tier.durationNs)}</span>
                                        </div>
                                    </div>
                                    <span style={{ ...styles.badge, ...(tier.active ? styles.badgeActive : styles.badgeExpired) }}>
                                        {tier.active ? <><FaCheckCircle style={{ marginRight: '4px' }} />Active</> : <><FaTimesCircle style={{ marginRight: '4px' }} />Inactive</>}
                                    </span>
                                    <div style={styles.tierActions}>
                                        <button
                                            onClick={() => openEditIcpTierModal(index)}
                                            style={styles.buttonSecondary}
                                            title="Edit tier"
                                        >
                                            <FaEdit />
                                        </button>
                                        <button
                                            onClick={() => handleRemoveIcpTier(index)}
                                            disabled={removingIcpTier === index}
                                            style={{
                                                ...styles.buttonDanger,
                                                opacity: removingIcpTier === index ? 0.5 : 1,
                                                cursor: removingIcpTier === index ? 'not-allowed' : 'pointer',
                                            }}
                                            title="Remove tier"
                                        >
                                            {removingIcpTier === index ? <FaSpinner className="spin" /> : <FaTrash />}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={styles.emptyState}>No ICP tiers configured yet.</div>
                    )}
                    
                    <div style={{ marginTop: '1.5rem', padding: '1rem', background: theme.colors.tertiaryBg, borderRadius: '10px' }}>
                        <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: theme.colors.primaryText }}>
                            <FaPlus style={{ marginRight: '8px' }} />
                            Add ICP Tier
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <input
                                type="text"
                                placeholder="Tier name (e.g., '1 Month Premium')"
                                value={newIcpTierName}
                                onChange={(e) => setNewIcpTierName(e.target.value)}
                                style={styles.input}
                            />
                            <div style={styles.row}>
                                <input
                                    type="number"
                                    step="0.0001"
                                    min="0"
                                    placeholder="ICP amount"
                                    value={newIcpTierAmount}
                                    onChange={(e) => setNewIcpTierAmount(e.target.value)}
                                    style={styles.inputSmall}
                                />
                                <span style={{ color: theme.colors.mutedText }}>ICP →</span>
                                <input
                                    type="number"
                                    step="1"
                                    min="1"
                                    placeholder="Duration"
                                    value={newIcpTierDuration}
                                    onChange={(e) => setNewIcpTierDuration(e.target.value)}
                                    style={styles.inputSmall}
                                />
                                <select
                                    value={newIcpTierDurationUnit}
                                    onChange={(e) => setNewIcpTierDurationUnit(e.target.value)}
                                    style={styles.select}
                                >
                                    <option value="days">Days</option>
                                    <option value="weeks">Weeks</option>
                                    <option value="months">Months</option>
                                    <option value="years">Years</option>
                                </select>
                            </div>
                            <button
                                onClick={handleAddIcpTier}
                                disabled={addingIcpTier || !newIcpTierName.trim() || !newIcpTierAmount || !newIcpTierDuration}
                                style={{
                                    ...styles.buttonSuccess,
                                    width: 'fit-content',
                                    opacity: addingIcpTier || !newIcpTierName.trim() || !newIcpTierAmount || !newIcpTierDuration ? 0.5 : 1,
                                    cursor: addingIcpTier || !newIcpTierName.trim() || !newIcpTierAmount || !newIcpTierDuration ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {addingIcpTier ? <FaSpinner className="spin" /> : <FaPlus />}
                                Add Tier
                            </button>
                        </div>
                    </div>
                </section>
                
                {/* VP Tiers */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaVoteYea style={{ color: theme.colors.info || theme.colors.accent }} />
                        Voting Power Tiers
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Configure how much membership duration different Sneed staking levels grant.
                    </p>
                    
                    {vpTiers.length > 0 ? (
                        <div style={styles.list}>
                            {vpTiers.map((tier, index) => (
                                <div key={index} style={styles.tierItem}>
                                    <div style={styles.tierInfo}>
                                        <div style={styles.tierName}>{tier.name}</div>
                                        <div style={styles.tierDetails}>
                                            <span><FaVoteYea style={{ marginRight: '4px' }} />≥ {formatVotingPower(tier.minVotingPowerE8s)}</span>
                                            <span>→</span>
                                            <span><FaClock style={{ marginRight: '4px' }} />{formatDuration(tier.durationNs)}</span>
                                        </div>
                                    </div>
                                    <span style={{ ...styles.badge, ...(tier.active ? styles.badgeActive : styles.badgeExpired) }}>
                                        {tier.active ? <><FaCheckCircle style={{ marginRight: '4px' }} />Active</> : <><FaTimesCircle style={{ marginRight: '4px' }} />Inactive</>}
                                    </span>
                                    <div style={styles.tierActions}>
                                        <button
                                            onClick={() => openEditVpTierModal(index)}
                                            style={styles.buttonSecondary}
                                            title="Edit tier"
                                        >
                                            <FaEdit />
                                        </button>
                                        <button
                                            onClick={() => handleRemoveVpTier(index)}
                                            disabled={removingVpTier === index}
                                            style={{
                                                ...styles.buttonDanger,
                                                opacity: removingVpTier === index ? 0.5 : 1,
                                                cursor: removingVpTier === index ? 'not-allowed' : 'pointer',
                                            }}
                                            title="Remove tier"
                                        >
                                            {removingVpTier === index ? <FaSpinner className="spin" /> : <FaTrash />}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={styles.emptyState}>No voting power tiers configured yet.</div>
                    )}
                    
                    <div style={{ marginTop: '1.5rem', padding: '1rem', background: theme.colors.tertiaryBg, borderRadius: '10px' }}>
                        <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: theme.colors.primaryText }}>
                            <FaPlus style={{ marginRight: '8px' }} />
                            Add Voting Power Tier
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <input
                                type="text"
                                placeholder="Tier name (e.g., 'Sneed Staker')"
                                value={newVpTierName}
                                onChange={(e) => setNewVpTierName(e.target.value)}
                                style={styles.input}
                            />
                            <div style={styles.row}>
                                <input
                                    type="number"
                                    step="1"
                                    min="0"
                                    placeholder="Min VP (in SNEED)"
                                    value={newVpTierMinVp}
                                    onChange={(e) => setNewVpTierMinVp(e.target.value)}
                                    style={styles.inputSmall}
                                />
                                <span style={{ color: theme.colors.mutedText }}>VP →</span>
                                <input
                                    type="number"
                                    step="1"
                                    min="1"
                                    placeholder="Duration"
                                    value={newVpTierDuration}
                                    onChange={(e) => setNewVpTierDuration(e.target.value)}
                                    style={styles.inputSmall}
                                />
                                <select
                                    value={newVpTierDurationUnit}
                                    onChange={(e) => setNewVpTierDurationUnit(e.target.value)}
                                    style={styles.select}
                                >
                                    <option value="days">Days</option>
                                    <option value="weeks">Weeks</option>
                                    <option value="months">Months</option>
                                    <option value="years">Years</option>
                                </select>
                            </div>
                            <button
                                onClick={handleAddVpTier}
                                disabled={addingVpTier || !newVpTierName.trim() || !newVpTierMinVp || !newVpTierDuration}
                                style={{
                                    ...styles.buttonSuccess,
                                    width: 'fit-content',
                                    opacity: addingVpTier || !newVpTierName.trim() || !newVpTierMinVp || !newVpTierDuration ? 0.5 : 1,
                                    cursor: addingVpTier || !newVpTierName.trim() || !newVpTierMinVp || !newVpTierDuration ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {addingVpTier ? <FaSpinner className="spin" /> : <FaPlus />}
                                Add Tier
                            </button>
                        </div>
                    </div>
                </section>
                
                {/* Admin Management */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaUserShield style={{ color: theme.colors.accent }} />
                        Premium Admins
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Admins can modify premium settings, tiers, and manage memberships.
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
                
                {/* Manual Membership Grant */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaCrown style={{ color: '#FFD700' }} />
                        Grant Membership Manually
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Grant or extend premium membership for a principal. Duration is added to any existing membership.
                    </p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <input
                            type="text"
                            placeholder="Principal ID"
                            value={manualMemberPrincipal}
                            onChange={(e) => setManualMemberPrincipal(e.target.value)}
                            style={{ ...styles.input, maxWidth: '500px' }}
                        />
                        <div style={styles.row}>
                            <input
                                type="number"
                                step="1"
                                min="1"
                                placeholder="Duration"
                                value={manualMemberDuration}
                                onChange={(e) => setManualMemberDuration(e.target.value)}
                                style={styles.inputSmall}
                            />
                            <select
                                value={manualMemberDurationUnit}
                                onChange={(e) => setManualMemberDurationUnit(e.target.value)}
                                style={styles.select}
                            >
                                <option value="days">Days</option>
                                <option value="weeks">Weeks</option>
                                <option value="months">Months</option>
                                <option value="years">Years</option>
                            </select>
                            <button
                                onClick={handleGrantMembership}
                                disabled={grantingMembership || !manualMemberPrincipal || !manualMemberDuration}
                                style={{
                                    ...styles.buttonSuccess,
                                    opacity: grantingMembership || !manualMemberPrincipal || !manualMemberDuration ? 0.5 : 1,
                                    cursor: grantingMembership || !manualMemberPrincipal || !manualMemberDuration ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {grantingMembership ? <FaSpinner className="spin" /> : <FaCrown />}
                                Grant Membership
                            </button>
                        </div>
                    </div>
                </section>
                
                {/* Current Members */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaUsers style={{ color: theme.colors.success }} />
                        Current Members ({memberships.length})
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        All registered premium memberships.
                    </p>
                    
                    {memberships.length > 0 ? (
                        <div style={styles.list}>
                            {memberships.map(([principal, membership], index) => {
                                const isActive = BigInt(membership.expiration) > now;
                                return (
                                    <div key={index} style={styles.tierItem}>
                                        <div style={styles.tierInfo}>
                                            <div style={styles.tierName}>
                                                <PrincipalDisplay principal={principal.toString()} />
                                            </div>
                                            <div style={styles.tierDetails}>
                                                <span>
                                                    {isActive ? (
                                                        <>Expires: {formatTimestamp(membership.expiration)} ({getTimeRemaining(membership.expiration)})</>
                                                    ) : (
                                                        <>Expired: {formatTimestamp(membership.expiration)}</>
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                        <span style={{ ...styles.badge, ...(isActive ? styles.badgeActive : styles.badgeExpired) }}>
                                            {isActive ? <><FaCheckCircle style={{ marginRight: '4px' }} />Active</> : <><FaTimesCircle style={{ marginRight: '4px' }} />Expired</>}
                                        </span>
                                        <button
                                            onClick={() => handleRevokeMembership(principal)}
                                            disabled={revokingMembership === principal.toString()}
                                            style={{
                                                ...styles.buttonDanger,
                                                opacity: revokingMembership === principal.toString() ? 0.5 : 1,
                                                cursor: revokingMembership === principal.toString() ? 'not-allowed' : 'pointer',
                                            }}
                                        >
                                            {revokingMembership === principal.toString() ? <FaSpinner className="spin" /> : <FaTrash />}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={styles.emptyState}>No members registered yet.</div>
                    )}
                </section>
                
                {/* Promo Codes */}
                <section style={styles.section}>
                    <h2 style={styles.sectionTitle}>
                        <FaTicketAlt style={{ color: '#FF69B4' }} />
                        Promo Codes ({promoCodes.length})
                    </h2>
                    <p style={{ color: theme.colors.mutedText, marginBottom: '1rem' }}>
                        Create and manage promo codes for free premium membership.
                    </p>
                    
                    {promoCodes.length > 0 ? (
                        <div style={styles.list}>
                            {promoCodes.map((promo, index) => {
                                const isExpired = promo.expiration[0] && BigInt(promo.expiration[0]) < now;
                                const isFullyClaimed = Number(promo.claimCount) >= Number(promo.maxClaims);
                                const canBeUsed = promo.active && !isExpired && !isFullyClaimed;
                                
                                return (
                                    <div key={index} style={{
                                        ...styles.tierItem,
                                        opacity: canBeUsed ? 1 : 0.7,
                                        flexDirection: 'column',
                                        alignItems: 'stretch',
                                        gap: '0.75rem',
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                                                    <span style={{
                                                        fontFamily: 'monospace',
                                                        fontSize: '1.25rem',
                                                        fontWeight: 'bold',
                                                        color: canBeUsed ? theme.colors.accent : theme.colors.mutedText,
                                                        letterSpacing: '2px',
                                                    }}>
                                                        {promo.code}
                                                    </span>
                                                    <button
                                                        onClick={() => copyToClipboard(promo.code)}
                                                        style={{
                                                            ...styles.buttonSecondary,
                                                            padding: '4px 8px',
                                                            fontSize: '0.8rem',
                                                        }}
                                                        title="Copy code"
                                                    >
                                                        <FaCopy />
                                                    </button>
                                                </div>
                                                <div style={styles.tierDetails}>
                                                    <span><FaClock style={{ marginRight: '4px' }} />Grants: {formatDuration(promo.durationNs)}</span>
                                                    <span><FaUsers style={{ marginRight: '4px' }} />Claims: {Number(promo.claimCount)} / {Number(promo.maxClaims)}</span>
                                                    {promo.expiration[0] && (
                                                        <span style={{ color: isExpired ? theme.colors.error : theme.colors.mutedText }}>
                                                            {isExpired ? 'Expired' : 'Expires'}: {formatTimestamp(promo.expiration[0])}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                {promo.active ? (
                                                    <span style={{ ...styles.badge, ...styles.badgeActive }}>
                                                        <FaCheckCircle style={{ marginRight: '4px' }} />Active
                                                    </span>
                                                ) : (
                                                    <span style={{ ...styles.badge, ...styles.badgeExpired }}>
                                                        <FaPause style={{ marginRight: '4px' }} />Inactive
                                                    </span>
                                                )}
                                                {isFullyClaimed && (
                                                    <span style={{ ...styles.badge, background: `${theme.colors.warning}20`, color: theme.colors.warning }}>
                                                        Fully Claimed
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        
                                        {promo.notes[0] && (
                                            <div style={{
                                                padding: '0.5rem',
                                                background: theme.colors.secondaryBg,
                                                borderRadius: '6px',
                                                fontSize: '0.85rem',
                                                color: theme.colors.mutedText,
                                                fontStyle: 'italic',
                                            }}>
                                                📝 {promo.notes[0]}
                                            </div>
                                        )}
                                        
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: theme.colors.mutedText }}>
                                            <span>Created by <PrincipalDisplay principal={promo.createdBy.toString()} short /> on {formatTimestamp(promo.createdAt)}</span>
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                <button
                                                    onClick={() => handleViewClaims(promo.code)}
                                                    style={styles.buttonSecondary}
                                                    title="View claims"
                                                >
                                                    <FaEye /> Claims
                                                </button>
                                                <button
                                                    onClick={() => handleTogglePromoCode(promo.code, promo.active)}
                                                    disabled={deactivatingPromoCode === promo.code}
                                                    style={{
                                                        ...styles.buttonSecondary,
                                                        opacity: deactivatingPromoCode === promo.code ? 0.5 : 1,
                                                    }}
                                                    title={promo.active ? 'Deactivate' : 'Reactivate'}
                                                >
                                                    {deactivatingPromoCode === promo.code ? <FaSpinner className="spin" /> : (promo.active ? <FaPause /> : <FaPlay />)}
                                                </button>
                                                <button
                                                    onClick={() => handleDeletePromoCode(promo.code)}
                                                    disabled={deletingPromoCode === promo.code}
                                                    style={{
                                                        ...styles.buttonDanger,
                                                        opacity: deletingPromoCode === promo.code ? 0.5 : 1,
                                                    }}
                                                    title="Delete"
                                                >
                                                    {deletingPromoCode === promo.code ? <FaSpinner className="spin" /> : <FaTrash />}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div style={styles.emptyState}>No promo codes created yet.</div>
                    )}
                    
                    {/* Create Promo Code Form */}
                    <div style={{ marginTop: '1.5rem', padding: '1rem', background: theme.colors.tertiaryBg, borderRadius: '10px' }}>
                        <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem', color: theme.colors.primaryText }}>
                            <FaPlus style={{ marginRight: '8px' }} />
                            Create Promo Code
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>Membership Duration</label>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <input
                                            type="number"
                                            step="1"
                                            min="1"
                                            placeholder="Duration"
                                            value={newPromoCodeDuration}
                                            onChange={(e) => setNewPromoCodeDuration(e.target.value)}
                                            style={styles.inputSmall}
                                        />
                                        <select
                                            value={newPromoCodeDurationUnit}
                                            onChange={(e) => setNewPromoCodeDurationUnit(e.target.value)}
                                            style={styles.select}
                                        >
                                            <option value="days">Days</option>
                                            <option value="weeks">Weeks</option>
                                            <option value="months">Months</option>
                                            <option value="years">Years</option>
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label style={styles.label}>Max Claims</label>
                                    <input
                                        type="number"
                                        step="1"
                                        min="1"
                                        placeholder="e.g., 10"
                                        value={newPromoCodeMaxClaims}
                                        onChange={(e) => setNewPromoCodeMaxClaims(e.target.value)}
                                        style={styles.inputSmall}
                                    />
                                </div>
                            </div>
                            <div style={styles.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={styles.label}>Expiration Date (optional)</label>
                                    <input
                                        type="datetime-local"
                                        value={newPromoCodeExpiration}
                                        onChange={(e) => setNewPromoCodeExpiration(e.target.value)}
                                        style={{ ...styles.input, maxWidth: '250px' }}
                                    />
                                </div>
                            </div>
                            <div>
                                <label style={styles.label}>Notes (optional, admin only)</label>
                                <input
                                    type="text"
                                    placeholder="e.g., 'For Twitter giveaway Jan 2026'"
                                    value={newPromoCodeNotes}
                                    onChange={(e) => setNewPromoCodeNotes(e.target.value)}
                                    style={styles.input}
                                />
                            </div>
                            <button
                                onClick={handleCreatePromoCode}
                                disabled={creatingPromoCode || !newPromoCodeDuration || !newPromoCodeMaxClaims}
                                style={{
                                    ...styles.buttonSuccess,
                                    width: 'fit-content',
                                    opacity: creatingPromoCode || !newPromoCodeDuration || !newPromoCodeMaxClaims ? 0.5 : 1,
                                    cursor: creatingPromoCode || !newPromoCodeDuration || !newPromoCodeMaxClaims ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {creatingPromoCode ? <FaSpinner className="spin" /> : <FaTicketAlt />}
                                Generate Promo Code
                            </button>
                        </div>
                    </div>
                </section>
                
            </main>
            
            {/* Edit ICP Tier Modal */}
            {editIcpTierModal.show && (
                <div style={styles.modal} onClick={() => setEditIcpTierModal({ show: false, index: null, tier: null })}>
                    <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
                        <div style={styles.modalHeader}>
                            <h2 style={styles.modalTitle}>
                                <FaEdit style={{ color: theme.colors.accent }} />
                                Edit ICP Tier
                            </h2>
                            <button 
                                style={styles.closeButton}
                                onClick={() => setEditIcpTierModal({ show: false, index: null, tier: null })}
                            >
                                <FaTimes />
                            </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={styles.label}>Tier Name</label>
                                <input
                                    type="text"
                                    value={editIcpTierName}
                                    onChange={(e) => setEditIcpTierName(e.target.value)}
                                    style={{ ...styles.input, width: '100%' }}
                                />
                            </div>
                            <div>
                                <label style={styles.label}>ICP Amount</label>
                                <input
                                    type="number"
                                    step="0.0001"
                                    min="0"
                                    value={editIcpTierAmount}
                                    onChange={(e) => setEditIcpTierAmount(e.target.value)}
                                    style={{ ...styles.input, width: '100%' }}
                                />
                            </div>
                            <div>
                                <label style={styles.label}>Duration</label>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <input
                                        type="number"
                                        step="1"
                                        min="1"
                                        value={editIcpTierDuration}
                                        onChange={(e) => setEditIcpTierDuration(e.target.value)}
                                        style={{ ...styles.input, flex: 1 }}
                                    />
                                    <select
                                        value={editIcpTierDurationUnit}
                                        onChange={(e) => setEditIcpTierDurationUnit(e.target.value)}
                                        style={styles.select}
                                    >
                                        <option value="days">Days</option>
                                        <option value="weeks">Weeks</option>
                                        <option value="months">Months</option>
                                        <option value="years">Years</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label style={styles.checkbox}>
                                    <input
                                        type="checkbox"
                                        checked={editIcpTierActive}
                                        onChange={(e) => setEditIcpTierActive(e.target.checked)}
                                    />
                                    Active (tier can be used for purchases)
                                </label>
                            </div>
                            <button
                                onClick={handleUpdateIcpTier}
                                disabled={updatingIcpTier}
                                style={{
                                    ...styles.buttonSuccess,
                                    width: '100%',
                                    justifyContent: 'center',
                                    opacity: updatingIcpTier ? 0.5 : 1,
                                    cursor: updatingIcpTier ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {updatingIcpTier ? <FaSpinner className="spin" /> : <FaSave />}
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* View Promo Code Claims Modal */}
            {viewClaimsModal.show && (
                <div style={styles.modal} onClick={() => setViewClaimsModal({ show: false, code: null, claims: [] })}>
                    <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
                        <div style={styles.modalHeader}>
                            <h2 style={styles.modalTitle}>
                                <FaEye style={{ color: theme.colors.accent }} />
                                Claims for {viewClaimsModal.code}
                            </h2>
                            <button 
                                style={styles.closeButton}
                                onClick={() => setViewClaimsModal({ show: false, code: null, claims: [] })}
                            >
                                <FaTimes />
                            </button>
                        </div>
                        {loadingClaims ? (
                            <div style={{ textAlign: 'center', padding: '2rem' }}>
                                <FaSpinner className="spin" size={24} />
                                <p style={{ marginTop: '1rem', color: theme.colors.mutedText }}>Loading claims...</p>
                            </div>
                        ) : viewClaimsModal.claims.length > 0 ? (
                            <div style={styles.list}>
                                {viewClaimsModal.claims.map((claim, idx) => (
                                    <div key={idx} style={styles.listItem}>
                                        <div>
                                            <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                                                <PrincipalDisplay principal={claim.claimedBy.toString()} />
                                            </div>
                                            <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>
                                                Claimed: {formatTimestamp(claim.claimedAt)}
                                            </div>
                                        </div>
                                        <div style={{ color: theme.colors.success, fontSize: '0.9rem' }}>
                                            +{formatDuration(claim.durationGrantedNs)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={styles.emptyState}>No claims yet for this code.</div>
                        )}
                    </div>
                </div>
            )}
            
            {/* Edit VP Tier Modal */}
            {editVpTierModal.show && (
                <div style={styles.modal} onClick={() => setEditVpTierModal({ show: false, index: null, tier: null })}>
                    <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
                        <div style={styles.modalHeader}>
                            <h2 style={styles.modalTitle}>
                                <FaEdit style={{ color: theme.colors.accent }} />
                                Edit Voting Power Tier
                            </h2>
                            <button 
                                style={styles.closeButton}
                                onClick={() => setEditVpTierModal({ show: false, index: null, tier: null })}
                            >
                                <FaTimes />
                            </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={styles.label}>Tier Name</label>
                                <input
                                    type="text"
                                    value={editVpTierName}
                                    onChange={(e) => setEditVpTierName(e.target.value)}
                                    style={{ ...styles.input, width: '100%' }}
                                />
                            </div>
                            <div>
                                <label style={styles.label}>Minimum Voting Power (in SNEED)</label>
                                <input
                                    type="number"
                                    step="1"
                                    min="0"
                                    value={editVpTierMinVp}
                                    onChange={(e) => setEditVpTierMinVp(e.target.value)}
                                    style={{ ...styles.input, width: '100%' }}
                                />
                            </div>
                            <div>
                                <label style={styles.label}>Duration</label>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <input
                                        type="number"
                                        step="1"
                                        min="1"
                                        value={editVpTierDuration}
                                        onChange={(e) => setEditVpTierDuration(e.target.value)}
                                        style={{ ...styles.input, flex: 1 }}
                                    />
                                    <select
                                        value={editVpTierDurationUnit}
                                        onChange={(e) => setEditVpTierDurationUnit(e.target.value)}
                                        style={styles.select}
                                    >
                                        <option value="days">Days</option>
                                        <option value="weeks">Weeks</option>
                                        <option value="months">Months</option>
                                        <option value="years">Years</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label style={styles.checkbox}>
                                    <input
                                        type="checkbox"
                                        checked={editVpTierActive}
                                        onChange={(e) => setEditVpTierActive(e.target.checked)}
                                    />
                                    Active (tier can be used for claims)
                                </label>
                            </div>
                            <button
                                onClick={handleUpdateVpTier}
                                disabled={updatingVpTier}
                                style={{
                                    ...styles.buttonSuccess,
                                    width: '100%',
                                    justifyContent: 'center',
                                    opacity: updatingVpTier ? 0.5 : 1,
                                    cursor: updatingVpTier ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {updatingVpTier ? <FaSpinner className="spin" /> : <FaSave />}
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            <InfoModal
                isOpen={infoModal.show}
                onClose={closeInfoModal}
                title={infoModal.title}
                message={infoModal.message}
                type={infoModal.type}
            />
            
            <ConfirmationModal
                show={confirmModal.show}
                onClose={closeConfirmModal}
                onSubmit={confirmModal.onConfirm}
                message={confirmModal.message}
                doAwait={true}
            />
        </div>
    );
}
