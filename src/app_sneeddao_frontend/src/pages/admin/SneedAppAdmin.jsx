import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneedapp';
import Header from '../../components/Header';
import { useTheme } from '../../contexts/ThemeContext';
import { Principal } from '@dfinity/principal';
import { FaSave, FaPlus, FaTrash, FaUpload, FaSpinner, FaCheckCircle, FaExclamationTriangle, FaEdit, FaTimes, FaSearch, FaCloudDownloadAlt, FaCheck, FaBan, FaWallet, FaChartBar, FaUsers, FaTags } from 'react-icons/fa';
import PrincipalInput from '../../components/PrincipalInput';
import { parseAccount, hexToBytes } from '../../utils/AccountParser';

const appPrimary = '#06b6d4';
const E8S = 100_000_000;

export default function SneedAppAdmin() {
    const { isAuthenticated, identity } = useAuth();
    const { theme } = useTheme();
    const { isAdmin, loading: adminLoading, error: adminError } = useAdminCheck({ identity, isAuthenticated });
    const [activeTab, setActiveTab] = useState('publishers');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Publishers state
    const [publishers, setPublishers] = useState([]);
    const [editingPub, setEditingPub] = useState(null);
    const [editingPubData, setEditingPubData] = useState({});
    const [newPub, setNewPub] = useState({ name: '', description: '', websiteUrl: '', logoUrl: '' });
    const [newPubPaymentAccount, setNewPubPaymentAccount] = useState({ principal: '', subaccount: null });
    const [newOwnerPrincipal, setNewOwnerPrincipal] = useState('');
    const [newFamily, setNewFamily] = useState('');
    const [daoCutInput, setDaoCutInput] = useState('');

    // Apps state
    const [apps, setApps] = useState([]);
    const [editingApp, setEditingApp] = useState(null);
    const [editingAppData, setEditingAppData] = useState({});
    const [newApp, setNewApp] = useState({ publisherId: '', appId: '', name: '', description: '', iconUrl: '', mintPriceE8s: '1', premiumMintPriceE8s: '0.5', viewUrl: '', manageUrl: '', mintUrl: '', families: '' });

    // Versions state
    const [selectedAppId, setSelectedAppId] = useState('');
    const [versions, setVersions] = useState([]);
    const [newVersion, setNewVersion] = useState({ major: '', minor: '', patch: '', wasmHash: '', wasmUrl: '', sourceUrl: '', releaseNotes: '', releaseDate: '' });
    const [editingVersion, setEditingVersion] = useState(null);
    const [editVersionData, setEditVersionData] = useState({});
    const [wasmFile, setWasmFile] = useState(null);
    const [uploadingWasm, setUploadingWasm] = useState('');
    const [downloadUploadWasm, setDownloadUploadWasm] = useState('');
    const [downloadUploadStatus, setDownloadUploadStatus] = useState('');

    // Mint log state
    const [mintLog, setMintLog] = useState([]);
    const [mintLogTotal, setMintLogTotal] = useState(0);
    const [mintLogFilter, setMintLogFilter] = useState({ appId: '', minter: '' });
    const [mintLogPage, setMintLogPage] = useState(0);

    // Revenue state
    const [daoStats, setDaoStats] = useState(null);
    const [pubStats, setPubStats] = useState([]);

    // Migration state
    const [migrationInput, setMigrationInput] = useState({ user: '', canisterId: '', appId: '' });
    const [bulkInput, setBulkInput] = useState('');

    const getFactory = useCallback(() => {
        if (!identity) return null;
        return createFactoryActor(factoryCanisterId, {
            agentOptions: {
                identity,
                host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                    ? 'https://icp0.io' : 'http://localhost:4943'
            }
        });
    }, [identity]);

    const showSuccess = (msg) => { setSuccess(msg); setError(''); setTimeout(() => setSuccess(''), 3000); };
    const showError = (msg) => { setError(msg); setSuccess(''); };
    const pubMap = {};
    publishers.forEach(p => { pubMap[Number(p.publisherId)] = p; });

    const accountToBackend = (principalStr, subaccountBytes) => {
        return {
            owner: Principal.fromText(principalStr),
            subaccount: subaccountBytes ? [Array.from(subaccountBytes)] : []
        };
    };

    const accountToDisplay = (account) => {
        if (!account) return '';
        const ownerStr = account.owner?.toText?.() || '';
        if (account.subaccount?.length > 0) {
            const sub = account.subaccount[0];
            const hexStr = Array.from(sub).map(b => b.toString(16).padStart(2, '0')).join('');
            const trimmed = hexStr.replace(/^0+/, '');
            if (trimmed) return `${ownerStr} (sub: ${trimmed.substring(0, 16)}...)`;
        }
        return ownerStr;
    };

    // ==================== LOAD DATA ====================

    const loadPublishers = useCallback(async () => {
        try {
            const factory = getFactory();
            if (!factory) return;
            setPublishers(await factory.getPublishers());
        } catch (e) { showError('Failed to load publishers: ' + e.message); }
    }, [getFactory]);

    const loadApps = useCallback(async () => {
        try {
            const factory = getFactory();
            if (!factory) return;
            const appList = await factory.getApps();
            setApps(appList);
            if (!selectedAppId && appList.length > 0) setSelectedAppId(appList[0].appId);
        } catch (e) { showError('Failed to load apps: ' + e.message); }
    }, [getFactory, selectedAppId]);

    const loadVersions = useCallback(async () => {
        if (!selectedAppId) { setVersions([]); return; }
        try {
            const factory = getFactory();
            if (!factory) return;
            setVersions(await factory.getAppVersions(selectedAppId));
        } catch (e) { showError('Failed to load versions: ' + e.message); }
    }, [selectedAppId, getFactory]);

    const loadMintLog = useCallback(async () => {
        try {
            const factory = getFactory();
            if (!factory) return;
            const params = {
                startIndex: [mintLogPage * 50],
                limit: [50],
                appIdFilter: mintLogFilter.appId ? [mintLogFilter.appId] : [],
                minterFilter: mintLogFilter.minter ? [Principal.fromText(mintLogFilter.minter)] : [],
                fromTime: [],
                toTime: []
            };
            const result = await factory.getMintLog(params);
            setMintLog(result.entries);
            setMintLogTotal(Number(result.totalCount));
        } catch (e) { showError('Failed to load mint log: ' + e.message); }
    }, [getFactory, mintLogPage, mintLogFilter]);

    const loadRevenue = useCallback(async () => {
        try {
            const factory = getFactory();
            if (!factory) return;
            const [dao, pubs] = await Promise.all([
                factory.getDaoRevenueStats(),
                factory.getAllPublisherStats()
            ]);
            setDaoStats(dao);
            setPubStats(pubs);
        } catch (e) { showError('Failed to load revenue: ' + e.message); }
    }, [getFactory]);

    useEffect(() => {
        if (isAdmin) { loadPublishers(); loadApps(); }
    }, [isAdmin, loadPublishers, loadApps]);

    useEffect(() => { if (isAdmin && activeTab === 'versions') loadVersions(); }, [isAdmin, activeTab, loadVersions]);
    useEffect(() => { if (isAdmin && activeTab === 'mintlog') loadMintLog(); }, [isAdmin, activeTab, loadMintLog]);
    useEffect(() => { if (isAdmin && activeTab === 'revenue') loadRevenue(); }, [isAdmin, activeTab, loadRevenue]);

    // ==================== PUBLISHER CRUD ====================

    const handleCreatePublisher = async () => {
        setLoading(true);
        try {
            const factory = getFactory();
            const payOwner = newPubPaymentAccount.principal || identity.getPrincipal().toText();
            const result = await factory.createPublisher({
                name: newPub.name,
                description: newPub.description,
                websiteUrl: newPub.websiteUrl ? [newPub.websiteUrl] : [],
                logoUrl: newPub.logoUrl ? [newPub.logoUrl] : [],
                links: [],
                defaultPaymentAccount: accountToBackend(payOwner, newPubPaymentAccount.subaccount)
            });
            if (result.Ok !== undefined) { showSuccess('Publisher created with ID ' + Number(result.Ok)); }
            else if (result.Err) { showError(result.Err); }
            setNewPub({ name: '', description: '', websiteUrl: '', logoUrl: '' });
            setNewPubPaymentAccount({ principal: '', subaccount: null });
            await loadPublishers();
        } catch (e) { showError('Failed: ' + e.message); }
        setLoading(false);
    };

    const handleUpdatePublisher = async (pub) => {
        setLoading(true);
        try {
            const factory = getFactory();
            const result = await factory.updatePublisher(pub.publisherId, {
                name: editingPubData.name,
                description: editingPubData.description,
                websiteUrl: editingPubData.websiteUrl ? [editingPubData.websiteUrl] : [],
                logoUrl: editingPubData.logoUrl ? [editingPubData.logoUrl] : [],
                links: pub.links || [],
                defaultPaymentAccount: pub.defaultPaymentAccount
            });
            if (result.Err) showError(result.Err);
            else { showSuccess('Publisher updated'); setEditingPub(null); }
            await loadPublishers();
        } catch (e) { showError(e.message); }
        setLoading(false);
    };

    const handleAddOwner = async (pubId) => {
        try {
            const factory = getFactory();
            const result = await factory.addPublisherOwner(pubId, Principal.fromText(newOwnerPrincipal));
            if (result.Err) showError(result.Err); else showSuccess('Owner added');
            setNewOwnerPrincipal('');
            await loadPublishers();
        } catch (e) { showError(e.message); }
    };

    const handleRemoveOwner = async (pubId, owner) => {
        if (!confirm('Remove this owner?')) return;
        try {
            const factory = getFactory();
            const result = await factory.removePublisherOwner(pubId, owner);
            if (result.Err) showError(result.Err); else showSuccess('Owner removed');
            await loadPublishers();
        } catch (e) { showError(e.message); }
    };

    const handleAddFamily = async (pubId) => {
        try {
            const factory = getFactory();
            const result = await factory.addPublisherFamily(pubId, newFamily);
            if (result.Err) showError(result.Err); else showSuccess('Family added');
            setNewFamily('');
            await loadPublishers();
        } catch (e) { showError(e.message); }
    };

    const handleRemoveFamily = async (pubId, family) => {
        try {
            const factory = getFactory();
            const result = await factory.removePublisherFamily(pubId, family);
            if (result.Err) showError(result.Err); else showSuccess('Family removed');
            await loadPublishers();
        } catch (e) { showError(e.message); }
    };

    const handleVerify = async (pubId, verify) => {
        try {
            const factory = getFactory();
            if (verify) await factory.verifyPublisher(pubId);
            else await factory.unverifyPublisher(pubId);
            showSuccess(verify ? 'Publisher verified' : 'Publisher unverified');
            await loadPublishers();
        } catch (e) { showError(e.message); }
    };

    const handleSetDaoCut = async (pubId) => {
        try {
            const factory = getFactory();
            await factory.setPublisherDaoCut(pubId, BigInt(Math.round(parseFloat(daoCutInput) * 100)));
            showSuccess('DAO cut updated');
            setDaoCutInput('');
            await loadPublishers();
        } catch (e) { showError(e.message); }
    };

    // ==================== APP CRUD ====================

    const handleAddApp = async () => {
        setLoading(true);
        try {
            const factory = getFactory();
            const pubId = BigInt(newApp.publisherId || 0);
            const families = newApp.families ? newApp.families.split(',').map(f => f.trim()).filter(Boolean) : [];
            const result = await factory.addApp(pubId, {
                appId: newApp.appId,
                name: newApp.name,
                description: newApp.description,
                iconUrl: newApp.iconUrl ? [newApp.iconUrl] : [],
                mintPriceE8s: BigInt(Math.round(parseFloat(newApp.mintPriceE8s) * E8S)),
                premiumMintPriceE8s: BigInt(Math.round(parseFloat(newApp.premiumMintPriceE8s) * E8S)),
                viewUrl: newApp.viewUrl ? [newApp.viewUrl] : [],
                manageUrl: newApp.manageUrl ? [newApp.manageUrl] : [],
                mintUrl: newApp.mintUrl ? [newApp.mintUrl] : [],
                families
            });
            if (result.Ok !== undefined) showSuccess('App added with numeric ID ' + Number(result.Ok));
            else if (result.Err) showError(result.Err);
            setNewApp({ publisherId: '', appId: '', name: '', description: '', iconUrl: '', mintPriceE8s: '1', premiumMintPriceE8s: '0.5', viewUrl: '', manageUrl: '', mintUrl: '', families: '' });
            await loadApps();
        } catch (e) { showError('Failed to add app: ' + e.message); }
        setLoading(false);
    };

    const handleUpdateApp = async (app) => {
        setLoading(true);
        try {
            const factory = getFactory();
            const families = editingAppData.families ? editingAppData.families.split(',').map(f => f.trim()).filter(Boolean) : [];
            const result = await factory.updateApp(app.numericAppId, {
                name: editingAppData.name,
                description: editingAppData.description,
                iconUrl: editingAppData.iconUrl ? [editingAppData.iconUrl] : [],
                mintPriceE8s: BigInt(Math.round(parseFloat(editingAppData.mintPriceE8s || '0') * E8S)),
                premiumMintPriceE8s: BigInt(Math.round(parseFloat(editingAppData.premiumMintPriceE8s || '0') * E8S)),
                viewUrl: editingAppData.viewUrl ? [editingAppData.viewUrl] : [],
                manageUrl: editingAppData.manageUrl ? [editingAppData.manageUrl] : [],
                mintUrl: editingAppData.mintUrl ? [editingAppData.mintUrl] : [],
                families
            });
            if (result.Err) showError(result.Err);
            else { showSuccess('App updated'); setEditingApp(null); }
            await loadApps();
        } catch (e) { showError('Failed to update app: ' + e.message); }
        setLoading(false);
    };

    const handleRemoveApp = async (app) => {
        if (!confirm(`Remove app "${app.appId}"?`)) return;
        setLoading(true);
        try {
            const factory = getFactory();
            const result = await factory.removeApp(app.numericAppId);
            if (result.Err) showError(result.Err); else showSuccess('App removed');
            await loadApps();
        } catch (e) { showError('Failed to remove app: ' + e.message); }
        setLoading(false);
    };

    const handleToggleApp = async (app) => {
        try {
            const factory = getFactory();
            const result = await factory.setAppEnabled(app.numericAppId, !app.enabled);
            if (result.Err) showError(result.Err);
            await loadApps();
        } catch (e) { showError(e.message); }
    };

    const handleSetAppDaoCut = async (app, bps) => {
        try {
            const factory = getFactory();
            await factory.setAppDaoCut(app.numericAppId, bps !== null ? [BigInt(bps)] : []);
            showSuccess('App DAO cut updated');
            await loadApps();
        } catch (e) { showError(e.message); }
    };

    // ==================== VERSION CRUD ====================

    const handleAddVersion = async () => {
        setLoading(true);
        try {
            const factory = getFactory();
            await factory.addAppVersion(selectedAppId, {
                major: BigInt(newVersion.major || 0),
                minor: BigInt(newVersion.minor || 0),
                patch: BigInt(newVersion.patch || 0),
                wasmHash: newVersion.wasmHash,
                wasmUrl: newVersion.wasmUrl ? [newVersion.wasmUrl] : [],
                sourceUrl: newVersion.sourceUrl ? [newVersion.sourceUrl] : [],
                releaseNotes: newVersion.releaseNotes,
                releaseDate: BigInt(newVersion.releaseDate ? new Date(newVersion.releaseDate).getTime() * 1_000_000 : Date.now() * 1_000_000)
            });
            showSuccess('Version added');
            setNewVersion({ major: '', minor: '', patch: '', wasmHash: '', wasmUrl: '', sourceUrl: '', releaseNotes: '', releaseDate: '' });
            await loadVersions();
        } catch (e) { showError('Failed to add version: ' + e.message); }
        setLoading(false);
    };

    const handleRemoveVersion = async (v) => {
        if (!confirm(`Remove version ${Number(v.major)}.${Number(v.minor)}.${Number(v.patch)}?`)) return;
        try {
            const factory = getFactory();
            await factory.removeAppVersion(selectedAppId, v.major, v.minor, v.patch);
            showSuccess('Version removed');
            await loadVersions();
        } catch (e) { showError(e.message); }
    };

    const startEditVersion = (v) => {
        const vKey = `${Number(v.major)}.${Number(v.minor)}.${Number(v.patch)}`;
        setEditingVersion(vKey);
        setEditVersionData({
            wasmHash: v.wasmHash || '',
            wasmUrl: v.wasmUrl?.length > 0 ? v.wasmUrl[0] : '',
            sourceUrl: v.sourceUrl?.length > 0 ? v.sourceUrl[0] : '',
            releaseNotes: v.releaseNotes || '',
            releaseDate: v.releaseDate ? new Date(Number(v.releaseDate) / 1_000_000).toISOString().split('T')[0] : ''
        });
    };

    const handleUpdateVersion = async (v) => {
        setLoading(true);
        try {
            const factory = getFactory();
            await factory.updateAppVersion(selectedAppId, v.major, v.minor, v.patch, {
                major: v.major, minor: v.minor, patch: v.patch,
                wasmHash: editVersionData.wasmHash,
                wasmUrl: editVersionData.wasmUrl ? [editVersionData.wasmUrl] : [],
                sourceUrl: editVersionData.sourceUrl ? [editVersionData.sourceUrl] : [],
                releaseNotes: editVersionData.releaseNotes,
                releaseDate: BigInt(editVersionData.releaseDate ? new Date(editVersionData.releaseDate).getTime() * 1_000_000 : Date.now() * 1_000_000)
            });
            showSuccess('Version updated');
            setEditingVersion(null);
            await loadVersions();
        } catch (e) { showError('Failed to update version: ' + e.message); }
        setLoading(false);
    };

    const handleUploadWasm = async (v) => {
        if (!wasmFile) return;
        const vKey = `${Number(v.major)}.${Number(v.minor)}.${Number(v.patch)}`;
        setUploadingWasm(vKey);
        try {
            const bytes = new Uint8Array(await wasmFile.arrayBuffer());
            if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
                throw new Error('Invalid WASM file (bad magic bytes)');
            }
            const factory = getFactory();
            await factory.uploadAppVersionWasm(selectedAppId, v.major, v.minor, v.patch, bytes);
            showSuccess(`WASM uploaded for v${vKey}`);
            setWasmFile(null);
            await loadVersions();
        } catch (e) { showError('Upload failed: ' + e.message); }
        setUploadingWasm('');
    };

    const handleClearWasm = async (v) => {
        const vKey = `${Number(v.major)}.${Number(v.minor)}.${Number(v.patch)}`;
        if (!confirm(`Clear WASM blob for v${vKey}?`)) return;
        try {
            const factory = getFactory();
            await factory.clearAppVersionWasm(selectedAppId, v.major, v.minor, v.patch);
            showSuccess('WASM cleared');
            await loadVersions();
        } catch (e) { showError(e.message); }
    };

    const handleDownloadAndUploadWasm = async (v) => {
        const vKey = `${Number(v.major)}.${Number(v.minor)}.${Number(v.patch)}`;
        const wasmUrl = v.wasmUrl?.length > 0 ? v.wasmUrl[0] : (editingVersion === vKey && editVersionData.wasmUrl ? editVersionData.wasmUrl : '');
        if (!wasmUrl) return;
        setDownloadUploadWasm(vKey);
        setDownloadUploadStatus('Downloading WASM...');
        try {
            const response = await fetch(wasmUrl);
            if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
            let bytes;
            const contentLength = response.headers.get('content-length');
            if (response.body && contentLength) {
                const total = parseInt(contentLength);
                const reader = response.body.getReader();
                const chunks = [];
                let received = 0;
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    received += value.length;
                    setDownloadUploadStatus(`Downloading... ${Math.round((received / total) * 100)}%`);
                }
                const allBytes = new Uint8Array(received);
                let offset = 0;
                for (const chunk of chunks) { allBytes.set(chunk, offset); offset += chunk.length; }
                bytes = allBytes;
            } else {
                bytes = new Uint8Array(await response.arrayBuffer());
            }
            if (bytes.length < 4 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
                throw new Error('Invalid WASM file');
            }
            setDownloadUploadStatus(`Uploading (${(bytes.length / 1024).toFixed(0)} KB)...`);
            const factory = getFactory();
            await factory.uploadAppVersionWasm(selectedAppId, v.major, v.minor, v.patch, bytes);
            showSuccess(`WASM downloaded & uploaded for v${vKey}`);
            await loadVersions();
        } catch (e) { showError('Download & upload failed: ' + e.message); }
        setDownloadUploadWasm('');
        setDownloadUploadStatus('');
    };

    // ==================== MIGRATION ====================

    const handleSingleRegister = async () => {
        setLoading(true);
        try {
            const factory = getFactory();
            await factory.adminRegisterCanister(
                Principal.fromText(migrationInput.user),
                Principal.fromText(migrationInput.canisterId),
                migrationInput.appId
            );
            showSuccess('Canister registered');
            setMigrationInput({ user: '', canisterId: '', appId: '' });
        } catch (e) { showError(e.message); }
        setLoading(false);
    };

    const handleBulkRegister = async () => {
        setLoading(true);
        try {
            const factory = getFactory();
            const lines = JSON.parse(bulkInput);
            const entries = lines.map(([user, canisterId, appId]) => [Principal.fromText(user), Principal.fromText(canisterId), appId]);
            const count = await factory.adminBulkRegisterCanisters(entries);
            showSuccess(`Registered ${Number(count)} canisters`);
            setBulkInput('');
        } catch (e) { showError('Bulk register failed: ' + e.message); }
        setLoading(false);
    };

    // ==================== STYLES ====================

    const inputStyle = {
        width: '100%', padding: '8px 12px', borderRadius: 6,
        border: `1px solid ${theme.colors.borderColor || '#444'}`,
        background: theme.colors.primaryBg, color: theme.colors.primaryText,
        fontSize: 13, outline: 'none', boxSizing: 'border-box'
    };

    const tabStyle = (active) => ({
        padding: '10px 16px', borderRadius: '8px 8px 0 0', cursor: 'pointer',
        background: active ? theme.colors.secondaryBg : 'transparent',
        color: active ? appPrimary : theme.colors.secondaryText,
        border: active ? `1px solid ${theme.colors.borderColor || '#333'}` : '1px solid transparent',
        borderBottom: active ? `2px solid ${appPrimary}` : '2px solid transparent',
        fontWeight: active ? 600 : 400, fontSize: 13
    });

    const cardStyle = {
        background: theme.colors.cardGradient, borderRadius: 12,
        border: `1px solid ${theme.colors.borderColor || '#333'}`, padding: 20, marginBottom: 16
    };

    const btnSm = (color = appPrimary) => ({
        padding: '6px 12px', borderRadius: 6, border: 'none',
        background: `${color}20`, color: color, fontSize: 12,
        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4
    });

    const pillStyle = (color = appPrimary) => ({
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: 12, fontSize: 11,
        background: `${color}20`, color: color
    });

    const label = { color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 };

    if (adminLoading) return <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}><Header /><div style={{ textAlign: 'center', padding: 60, color: theme.colors.secondaryText }}><FaSpinner className="fa-spin" /> Loading...</div></div>;
    if (!isAdmin) return <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}><Header /><div style={{ textAlign: 'center', padding: 60, color: '#ef4444' }}>{adminError || 'Not authorized'}</div></div>;

    const tabNames = { publishers: 'Publishers', apps: 'Apps', versions: 'Versions', mintlog: 'Mint Log', revenue: 'Revenue', migration: 'Migration' };

    return (
        <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
            <Header />
            <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px 60px' }}>
                <h1 style={{ color: theme.colors.primaryText, fontSize: 24, marginBottom: 20 }}>Sneedapp Admin</h1>

                {error && <div style={{ background: '#ef444420', border: '1px solid #ef4444', borderRadius: 8, padding: 10, marginBottom: 12, color: '#ef4444', fontSize: 13 }}><FaExclamationTriangle /> {error}</div>}
                {success && <div style={{ background: '#10b98120', border: '1px solid #10b981', borderRadius: 8, padding: 10, marginBottom: 12, color: '#10b981', fontSize: 13 }}><FaCheckCircle /> {success}</div>}

                <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${theme.colors.borderColor || '#333'}`, flexWrap: 'wrap' }}>
                    {Object.entries(tabNames).map(([key, name]) => (
                        <button key={key} onClick={() => setActiveTab(key)} style={tabStyle(activeTab === key)}>{name}</button>
                    ))}
                </div>

                {/* ==================== PUBLISHERS TAB ==================== */}
                {activeTab === 'publishers' && (
                    <div>
                        <h3 style={{ color: theme.colors.primaryText, marginBottom: 12 }}>Publishers ({publishers.length})</h3>
                        {publishers.map(pub => {
                            const isEditing = editingPub === Number(pub.publisherId);
                            return (
                            <div key={Number(pub.publisherId)} style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ color: theme.colors.primaryText, fontWeight: 600, fontSize: 16 }}>{pub.name}</span>
                                        <span style={{ color: theme.colors.secondaryText, fontSize: 12 }}>ID: {Number(pub.publisherId)}</span>
                                        {pub.verified && <span style={pillStyle('#10b981')}><FaCheck /> Verified</span>}
                                        <span style={pillStyle('#f59e0b')}>DAO Cut: {(Number(pub.daoCutBasisPoints) / 100).toFixed(1)}%</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        {!isEditing && <button onClick={() => { setEditingPub(Number(pub.publisherId)); setEditingPubData({ name: pub.name, description: pub.description, websiteUrl: pub.websiteUrl?.length > 0 ? pub.websiteUrl[0] : '', logoUrl: pub.logoUrl?.length > 0 ? pub.logoUrl[0] : '' }); }} style={btnSm(appPrimary)}><FaEdit /> Edit</button>}
                                        <button onClick={() => handleVerify(pub.publisherId, !pub.verified)} style={btnSm(pub.verified ? '#ef4444' : '#10b981')}>
                                            {pub.verified ? <><FaBan /> Unverify</> : <><FaCheck /> Verify</>}
                                        </button>
                                    </div>
                                </div>

                                {isEditing ? (
                                    <div style={{ marginBottom: 12 }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                                            <div><label style={label}>Name</label><input value={editingPubData.name} onChange={e => setEditingPubData({ ...editingPubData, name: e.target.value })} style={inputStyle} /></div>
                                            <div><label style={label}>Website URL</label><input value={editingPubData.websiteUrl} onChange={e => setEditingPubData({ ...editingPubData, websiteUrl: e.target.value })} style={inputStyle} /></div>
                                            <div style={{ gridColumn: '1 / -1' }}><label style={label}>Description</label><input value={editingPubData.description} onChange={e => setEditingPubData({ ...editingPubData, description: e.target.value })} style={inputStyle} /></div>
                                        </div>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <button onClick={() => handleUpdatePublisher(pub)} disabled={loading} style={btnSm('#10b981')}>{loading ? <FaSpinner className="fa-spin" /> : <FaSave />} Save</button>
                                            <button onClick={() => setEditingPub(null)} style={btnSm('#ef4444')}><FaTimes /> Cancel</button>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ marginBottom: 8 }}>
                                        <div style={{ color: theme.colors.secondaryText, fontSize: 13, marginBottom: 4 }}>{pub.description}</div>
                                        <div style={{ color: theme.colors.secondaryText, fontSize: 11 }}>Payment Account: <code style={{ fontSize: 10 }}>{accountToDisplay(pub.defaultPaymentAccount)}</code></div>
                                    </div>
                                )}

                                {/* DAO Cut setter */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                    <span style={{ color: theme.colors.secondaryText, fontSize: 12 }}>Set DAO Cut %:</span>
                                    <input value={daoCutInput} onChange={e => setDaoCutInput(e.target.value)} type="number" step="0.1" min="0" max="100" placeholder="10" style={{ ...inputStyle, width: 80 }} />
                                    <button onClick={() => handleSetDaoCut(pub.publisherId)} disabled={!daoCutInput} style={btnSm(appPrimary)}>Set</button>
                                </div>

                                {/* Owners */}
                                <div style={{ marginBottom: 8 }}>
                                    <div style={{ color: theme.colors.secondaryText, fontSize: 12, marginBottom: 4 }}><FaUsers /> Owners ({pub.owners.length}):</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                                        {pub.owners.map(o => (
                                            <span key={o.toText()} style={{ ...pillStyle(appPrimary), fontSize: 10 }}>
                                                {o.toText().substring(0, 12)}...
                                                <FaTimes style={{ cursor: 'pointer', marginLeft: 4 }} onClick={() => handleRemoveOwner(pub.publisherId, o)} />
                                            </span>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <input value={newOwnerPrincipal} onChange={e => setNewOwnerPrincipal(e.target.value)} placeholder="Principal to add" style={{ ...inputStyle, maxWidth: 300 }} />
                                        <button onClick={() => handleAddOwner(pub.publisherId)} disabled={!newOwnerPrincipal} style={btnSm('#10b981')}><FaPlus /> Add</button>
                                    </div>
                                </div>

                                {/* Families */}
                                <div>
                                    <div style={{ color: theme.colors.secondaryText, fontSize: 12, marginBottom: 4 }}><FaTags /> Families:</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                                        {pub.families.map(f => (
                                            <span key={f} style={pillStyle('#8b5cf6')}>
                                                {f}
                                                <FaTimes style={{ cursor: 'pointer', marginLeft: 4 }} onClick={() => handleRemoveFamily(pub.publisherId, f)} />
                                            </span>
                                        ))}
                                        {pub.families.length === 0 && <span style={{ color: theme.colors.secondaryText, fontSize: 11 }}>None</span>}
                                    </div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <input value={newFamily} onChange={e => setNewFamily(e.target.value)} placeholder="Family tag" style={{ ...inputStyle, maxWidth: 200 }} />
                                        <button onClick={() => handleAddFamily(pub.publisherId)} disabled={!newFamily} style={btnSm('#8b5cf6')}><FaPlus /> Add</button>
                                    </div>
                                </div>
                            </div>
                            );
                        })}

                        <h3 style={{ color: theme.colors.primaryText, marginTop: 24, marginBottom: 12 }}>Create Publisher</h3>
                        <div style={cardStyle}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div><label style={label}>Name *</label><input value={newPub.name} onChange={e => setNewPub({ ...newPub, name: e.target.value })} style={inputStyle} /></div>
                                <div><label style={label}>Website URL</label><input value={newPub.websiteUrl} onChange={e => setNewPub({ ...newPub, websiteUrl: e.target.value })} style={inputStyle} /></div>
                                <div style={{ gridColumn: '1 / -1' }}><label style={label}>Description</label><input value={newPub.description} onChange={e => setNewPub({ ...newPub, description: e.target.value })} style={inputStyle} /></div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={label}>Default Payment Account (ICRC-1, leave empty for self)</label>
                                    <PrincipalInput
                                        value={newPubPaymentAccount.principal}
                                        onChange={(val) => setNewPubPaymentAccount(prev => ({ ...prev, principal: val }))}
                                        onAccountChange={({ principal, subaccount }) => setNewPubPaymentAccount({ principal, subaccount })}
                                        showSubaccountOption={true}
                                        placeholder={identity?.getPrincipal().toText() || 'Principal or ICRC-1 account'}
                                        style={{ maxWidth: '100%' }}
                                    />
                                </div>
                            </div>
                            <button onClick={handleCreatePublisher} disabled={loading || !newPub.name} style={{ marginTop: 16, padding: '10px 20px', borderRadius: 8, background: `linear-gradient(135deg, ${appPrimary}, #22d3ee)`, color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', opacity: loading || !newPub.name ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                                {loading ? <FaSpinner className="fa-spin" /> : <FaPlus />} Create Publisher
                            </button>
                        </div>
                    </div>
                )}

                {/* ==================== APPS TAB ==================== */}
                {activeTab === 'apps' && (
                    <div>
                        <h3 style={{ color: theme.colors.primaryText, marginBottom: 12 }}>Registered Apps ({apps.length})</h3>
                        {apps.map(app => {
                            const isEditing = editingApp === Number(app.numericAppId);
                            const pub = pubMap[Number(app.publisherId)];
                            return (
                            <div key={Number(app.numericAppId)} style={cardStyle}>
                                {!isEditing ? (
                                    <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                                    <span style={{ color: theme.colors.primaryText, fontWeight: 600 }}>{app.name}</span>
                                                    <code style={{ color: theme.colors.secondaryText, fontSize: 11 }}>{app.appId}</code>
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: 10 }}>#{Number(app.numericAppId)}</span>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                                                    <span style={{ color: appPrimary }}>{pub?.name || `Publisher ${Number(app.publisherId)}`}</span>
                                                    {pub?.verified && <FaCheck style={{ color: '#10b981', fontSize: 10 }} />}
                                                    {app.families.map(f => <span key={f} style={pillStyle('#8b5cf6')}>{f}</span>)}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <button onClick={() => { setEditingApp(Number(app.numericAppId)); setEditingAppData({ name: app.name, description: app.description, iconUrl: app.iconUrl?.length > 0 ? app.iconUrl[0] : '', mintPriceE8s: (Number(app.mintPriceE8s) / E8S).toString(), premiumMintPriceE8s: (Number(app.premiumMintPriceE8s) / E8S).toString(), viewUrl: app.viewUrl?.length > 0 ? app.viewUrl[0] : '', manageUrl: app.manageUrl?.length > 0 ? app.manageUrl[0] : '', mintUrl: app.mintUrl?.length > 0 ? app.mintUrl[0] : '', families: app.families.join(', ') }); }} style={btnSm(appPrimary)}><FaEdit /> Edit</button>
                                                <button onClick={() => handleToggleApp(app)} style={btnSm(app.enabled ? '#10b981' : '#ef4444')}>{app.enabled ? 'Enabled' : 'Disabled'}</button>
                                                <button onClick={() => handleRemoveApp(app)} style={btnSm('#ef4444')}><FaTrash /></button>
                                            </div>
                                        </div>
                                        <div style={{ color: theme.colors.secondaryText, fontSize: 13, marginBottom: 4 }}>{app.description}</div>
                                        <div style={{ fontSize: 12, color: theme.colors.secondaryText }}>
                                            Price: {(Number(app.mintPriceE8s) / E8S).toFixed(2)} ICP | Premium: {(Number(app.premiumMintPriceE8s) / E8S).toFixed(2)} ICP
                                            {app.daoCutBasisPoints?.length > 0 && <span> | DAO Cut Override: {(Number(app.daoCutBasisPoints[0]) / 100).toFixed(1)}%</span>}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                            <div><span style={{ color: appPrimary, fontWeight: 600 }}>Editing: </span><code style={{ color: theme.colors.secondaryText, fontSize: 12 }}>{app.appId}</code></div>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <button onClick={() => handleUpdateApp(app)} disabled={loading} style={btnSm('#10b981')}>{loading ? <FaSpinner className="fa-spin" /> : <FaSave />} Save</button>
                                                <button onClick={() => setEditingApp(null)} style={btnSm('#ef4444')}><FaTimes /> Cancel</button>
                                            </div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                            <div><label style={label}>Name</label><input value={editingAppData.name} onChange={e => setEditingAppData({ ...editingAppData, name: e.target.value })} style={inputStyle} /></div>
                                            <div><label style={label}>Icon URL</label><input value={editingAppData.iconUrl} onChange={e => setEditingAppData({ ...editingAppData, iconUrl: e.target.value })} style={inputStyle} /></div>
                                            <div style={{ gridColumn: '1 / -1' }}><label style={label}>Description</label><input value={editingAppData.description} onChange={e => setEditingAppData({ ...editingAppData, description: e.target.value })} style={inputStyle} /></div>
                                            <div><label style={label}>Mint Price (ICP)</label><input value={editingAppData.mintPriceE8s} onChange={e => setEditingAppData({ ...editingAppData, mintPriceE8s: e.target.value })} type="number" step="0.01" style={inputStyle} /></div>
                                            <div><label style={label}>Premium Price (ICP)</label><input value={editingAppData.premiumMintPriceE8s} onChange={e => setEditingAppData({ ...editingAppData, premiumMintPriceE8s: e.target.value })} type="number" step="0.01" style={inputStyle} /></div>
                                            <div><label style={label}>View URL</label><input value={editingAppData.viewUrl} onChange={e => setEditingAppData({ ...editingAppData, viewUrl: e.target.value })} style={inputStyle} /></div>
                                            <div><label style={label}>Manage URL</label><input value={editingAppData.manageUrl} onChange={e => setEditingAppData({ ...editingAppData, manageUrl: e.target.value })} style={inputStyle} /></div>
                                            <div><label style={label}>Custom Mint URL</label><input value={editingAppData.mintUrl} onChange={e => setEditingAppData({ ...editingAppData, mintUrl: e.target.value })} style={inputStyle} /></div>
                                            <div><label style={label}>Families (comma-separated)</label><input value={editingAppData.families} onChange={e => setEditingAppData({ ...editingAppData, families: e.target.value })} placeholder="sneed-bots, defi" style={inputStyle} /></div>
                                        </div>
                                    </>
                                )}
                            </div>
                            );
                        })}

                        <h3 style={{ color: theme.colors.primaryText, marginTop: 24, marginBottom: 12 }}>Add New App</h3>
                        <div style={cardStyle}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div>
                                    <label style={label}>Publisher *</label>
                                    <select value={newApp.publisherId} onChange={e => setNewApp({ ...newApp, publisherId: e.target.value })} style={{ ...inputStyle }}>
                                        <option value="">Select publisher...</option>
                                        {publishers.map(p => <option key={Number(p.publisherId)} value={Number(p.publisherId)}>{p.name} (ID: {Number(p.publisherId)})</option>)}
                                    </select>
                                </div>
                                <div><label style={label}>App ID (slug) *</label><input value={newApp.appId} onChange={e => setNewApp({ ...newApp, appId: e.target.value })} placeholder="my-app" style={inputStyle} /></div>
                                <div><label style={label}>Name *</label><input value={newApp.name} onChange={e => setNewApp({ ...newApp, name: e.target.value })} placeholder="My App" style={inputStyle} /></div>
                                <div><label style={label}>Icon URL</label><input value={newApp.iconUrl} onChange={e => setNewApp({ ...newApp, iconUrl: e.target.value })} style={inputStyle} /></div>
                                <div style={{ gridColumn: '1 / -1' }}><label style={label}>Description</label><input value={newApp.description} onChange={e => setNewApp({ ...newApp, description: e.target.value })} style={inputStyle} /></div>
                                <div><label style={label}>Mint Price (ICP)</label><input value={newApp.mintPriceE8s} onChange={e => setNewApp({ ...newApp, mintPriceE8s: e.target.value })} type="number" step="0.01" style={inputStyle} /></div>
                                <div><label style={label}>Premium Price (ICP)</label><input value={newApp.premiumMintPriceE8s} onChange={e => setNewApp({ ...newApp, premiumMintPriceE8s: e.target.value })} type="number" step="0.01" style={inputStyle} /></div>
                                <div><label style={label}>View URL</label><input value={newApp.viewUrl} onChange={e => setNewApp({ ...newApp, viewUrl: e.target.value })} style={inputStyle} /></div>
                                <div><label style={label}>Manage URL</label><input value={newApp.manageUrl} onChange={e => setNewApp({ ...newApp, manageUrl: e.target.value })} style={inputStyle} /></div>
                                <div><label style={label}>Custom Mint URL</label><input value={newApp.mintUrl} onChange={e => setNewApp({ ...newApp, mintUrl: e.target.value })} style={inputStyle} /></div>
                                <div><label style={label}>Families (comma-separated)</label><input value={newApp.families} onChange={e => setNewApp({ ...newApp, families: e.target.value })} placeholder="sneed-bots" style={inputStyle} /></div>
                            </div>
                            <button onClick={handleAddApp} disabled={loading || !newApp.appId || !newApp.name || !newApp.publisherId} style={{ marginTop: 16, padding: '10px 20px', borderRadius: 8, background: `linear-gradient(135deg, ${appPrimary}, #22d3ee)`, color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', opacity: loading || !newApp.appId || !newApp.name || !newApp.publisherId ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                                {loading ? <FaSpinner className="fa-spin" /> : <FaPlus />} Add App
                            </button>
                        </div>
                    </div>
                )}

                {/* ==================== VERSIONS TAB ==================== */}
                {activeTab === 'versions' && (
                    <div>
                        <div style={{ marginBottom: 16 }}>
                            <label style={label}>Select App</label>
                            <select value={selectedAppId} onChange={e => setSelectedAppId(e.target.value)} style={{ ...inputStyle, maxWidth: 400 }}>
                                {apps.map(a => <option key={a.appId} value={a.appId}>{a.name} ({a.appId}) - {pubMap[Number(a.publisherId)]?.name || 'Unknown'}</option>)}
                            </select>
                        </div>

                        <h3 style={{ color: theme.colors.primaryText, marginBottom: 12 }}>Versions ({versions.length})</h3>
                        {versions.map(v => {
                            const vKey = `${Number(v.major)}.${Number(v.minor)}.${Number(v.patch)}`;
                            const isEditingV = editingVersion === vKey;
                            return (
                                <div key={vKey} style={cardStyle}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ color: theme.colors.primaryText, fontWeight: 600 }}>v{vKey}</span>
                                            {v.hasWasm ? <span style={{ fontSize: 11, background: '#10b98120', color: '#10b981', padding: '2px 8px', borderRadius: 4 }}>WASM ({Number(v.wasmSize).toLocaleString()} bytes)</span>
                                                : <span style={{ fontSize: 11, background: '#f59e0b20', color: '#f59e0b', padding: '2px 8px', borderRadius: 4 }}>No WASM</span>}
                                        </div>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            {!isEditingV ? (
                                                <><button onClick={() => startEditVersion(v)} style={btnSm(appPrimary)}><FaEdit /> Edit</button><button onClick={() => handleRemoveVersion(v)} style={btnSm('#ef4444')}><FaTrash /></button></>
                                            ) : (
                                                <><button onClick={() => handleUpdateVersion(v)} disabled={loading} style={btnSm('#10b981')}>{loading ? <FaSpinner className="fa-spin" /> : <FaSave />} Save</button><button onClick={() => setEditingVersion(null)} style={btnSm('#ef4444')}><FaTimes /> Cancel</button></>
                                            )}
                                        </div>
                                    </div>
                                    {!isEditingV ? (
                                        <>
                                            {v.releaseNotes && <div style={{ color: theme.colors.secondaryText, fontSize: 12, marginBottom: 8 }}>{v.releaseNotes}</div>}
                                            {v.wasmHash && <div style={{ color: theme.colors.secondaryText, fontSize: 11, marginBottom: 4 }}>Hash: {v.wasmHash.substring(0, 16)}...</div>}
                                            {v.wasmUrl?.length > 0 && <div style={{ color: theme.colors.secondaryText, fontSize: 11 }}>WASM URL: {v.wasmUrl[0]}</div>}
                                            {v.sourceUrl?.length > 0 && <div style={{ color: theme.colors.secondaryText, fontSize: 11 }}>Source: {v.sourceUrl[0]}</div>}
                                        </>
                                    ) : (
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                                            <div><label style={{ ...label, fontSize: 11 }}>WASM Hash</label><input value={editVersionData.wasmHash} onChange={e => setEditVersionData({ ...editVersionData, wasmHash: e.target.value })} style={inputStyle} /></div>
                                            <div><label style={{ ...label, fontSize: 11 }}>Release Date</label><input value={editVersionData.releaseDate} onChange={e => setEditVersionData({ ...editVersionData, releaseDate: e.target.value })} type="date" style={inputStyle} /></div>
                                            <div><label style={{ ...label, fontSize: 11 }}>WASM URL</label><input value={editVersionData.wasmUrl} onChange={e => setEditVersionData({ ...editVersionData, wasmUrl: e.target.value })} style={inputStyle} /></div>
                                            <div><label style={{ ...label, fontSize: 11 }}>Source URL</label><input value={editVersionData.sourceUrl} onChange={e => setEditVersionData({ ...editVersionData, sourceUrl: e.target.value })} style={inputStyle} /></div>
                                            <div style={{ gridColumn: '1 / -1' }}><label style={{ ...label, fontSize: 11 }}>Release Notes</label><textarea value={editVersionData.releaseNotes} onChange={e => setEditVersionData({ ...editVersionData, releaseNotes: e.target.value })} rows={3} style={{ ...inputStyle, resize: 'vertical' }} /></div>
                                        </div>
                                    )}
                                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <input type="file" accept=".wasm" onChange={e => setWasmFile(e.target.files[0])} style={{ fontSize: 12, color: theme.colors.secondaryText }} />
                                        <button onClick={() => handleUploadWasm(v)} disabled={!wasmFile || uploadingWasm === vKey} style={btnSm(appPrimary)}>{uploadingWasm === vKey ? <FaSpinner className="fa-spin" /> : <FaUpload />} Upload</button>
                                        {(v.wasmUrl?.length > 0 || (editingVersion === vKey && editVersionData.wasmUrl)) && (
                                            <button onClick={() => handleDownloadAndUploadWasm(v)} disabled={downloadUploadWasm === vKey} style={btnSm('#8b5cf6')}>{downloadUploadWasm === vKey ? <FaSpinner className="fa-spin" /> : <FaCloudDownloadAlt />} Download & Upload</button>
                                        )}
                                        {v.hasWasm && <button onClick={() => handleClearWasm(v)} style={btnSm('#ef4444')}><FaTimes /> Clear</button>}
                                    </div>
                                    {downloadUploadWasm === vKey && downloadUploadStatus && <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: '#8b5cf620', color: '#8b5cf6', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}><FaSpinner className="fa-spin" /> {downloadUploadStatus}</div>}
                                </div>
                            );
                        })}

                        <h3 style={{ color: theme.colors.primaryText, marginTop: 24, marginBottom: 12 }}>Add New Version</h3>
                        <div style={cardStyle}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                <div><label style={label}>Major</label><input value={newVersion.major} onChange={e => setNewVersion({ ...newVersion, major: e.target.value })} type="number" style={inputStyle} /></div>
                                <div><label style={label}>Minor</label><input value={newVersion.minor} onChange={e => setNewVersion({ ...newVersion, minor: e.target.value })} type="number" style={inputStyle} /></div>
                                <div><label style={label}>Patch</label><input value={newVersion.patch} onChange={e => setNewVersion({ ...newVersion, patch: e.target.value })} type="number" style={inputStyle} /></div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                                <div><label style={label}>WASM Hash</label><input value={newVersion.wasmHash} onChange={e => setNewVersion({ ...newVersion, wasmHash: e.target.value })} style={inputStyle} /></div>
                                <div><label style={label}>Release Date</label><input value={newVersion.releaseDate} onChange={e => setNewVersion({ ...newVersion, releaseDate: e.target.value })} type="date" style={inputStyle} /></div>
                                <div><label style={label}>WASM URL</label><input value={newVersion.wasmUrl} onChange={e => setNewVersion({ ...newVersion, wasmUrl: e.target.value })} style={inputStyle} /></div>
                                <div><label style={label}>Source URL</label><input value={newVersion.sourceUrl} onChange={e => setNewVersion({ ...newVersion, sourceUrl: e.target.value })} style={inputStyle} /></div>
                            </div>
                            <div style={{ marginTop: 12 }}><label style={label}>Release Notes</label><textarea value={newVersion.releaseNotes} onChange={e => setNewVersion({ ...newVersion, releaseNotes: e.target.value })} rows={3} style={{ ...inputStyle, resize: 'vertical' }} /></div>
                            <button onClick={handleAddVersion} disabled={loading || !newVersion.major} style={{ marginTop: 12, padding: '10px 20px', borderRadius: 8, background: `linear-gradient(135deg, ${appPrimary}, #22d3ee)`, color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', opacity: loading || !newVersion.major ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                                {loading ? <FaSpinner className="fa-spin" /> : <FaPlus />} Add Version
                            </button>
                        </div>
                    </div>
                )}

                {/* ==================== MINT LOG TAB ==================== */}
                {activeTab === 'mintlog' && (
                    <div>
                        <h3 style={{ color: theme.colors.primaryText, marginBottom: 12 }}>Immutable Mint Log ({mintLogTotal} entries)</h3>
                        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                            <input value={mintLogFilter.appId} onChange={e => setMintLogFilter({ ...mintLogFilter, appId: e.target.value })} placeholder="Filter by app ID" style={{ ...inputStyle, maxWidth: 200 }} />
                            <input value={mintLogFilter.minter} onChange={e => setMintLogFilter({ ...mintLogFilter, minter: e.target.value })} placeholder="Filter by minter principal" style={{ ...inputStyle, maxWidth: 300 }} />
                            <button onClick={loadMintLog} style={btnSm(appPrimary)}><FaSearch /> Search</button>
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                    <tr style={{ borderBottom: `1px solid ${theme.colors.borderColor || '#333'}` }}>
                                        {['#', 'Canister', 'Minter', 'App', 'Publisher', 'Version', 'ICP Paid', 'DAO Cut', 'Pub Revenue', 'Premium', 'Date'].map(h => (
                                            <th key={h} style={{ padding: '8px 4px', textAlign: 'left', color: theme.colors.secondaryText, fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {mintLog.map(entry => (
                                        <tr key={Number(entry.index)} style={{ borderBottom: `1px solid ${theme.colors.borderColor || '#222'}` }}>
                                            <td style={{ padding: '6px 4px', color: theme.colors.secondaryText }}>{Number(entry.index)}</td>
                                            <td style={{ padding: '6px 4px', color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: 10 }}>{entry.canisterId.toText().substring(0, 10)}...</td>
                                            <td style={{ padding: '6px 4px', color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: 10 }}>{entry.minter.toText().substring(0, 10)}...</td>
                                            <td style={{ padding: '6px 4px', color: appPrimary }}>{entry.appId}</td>
                                            <td style={{ padding: '6px 4px', color: theme.colors.secondaryText }}>{pubMap[Number(entry.publisherId)]?.name || Number(entry.publisherId)}</td>
                                            <td style={{ padding: '6px 4px', color: theme.colors.primaryText }}>{Number(entry.versionMajor)}.{Number(entry.versionMinor)}.{Number(entry.versionPatch)}</td>
                                            <td style={{ padding: '6px 4px', color: theme.colors.primaryText }}>{(Number(entry.icpPaidE8s) / E8S).toFixed(2)}</td>
                                            <td style={{ padding: '6px 4px', color: '#f59e0b' }}>{(Number(entry.daoCutE8s) / E8S).toFixed(4)}</td>
                                            <td style={{ padding: '6px 4px', color: '#10b981' }}>{(Number(entry.publisherRevenueE8s) / E8S).toFixed(4)}</td>
                                            <td style={{ padding: '6px 4px' }}>{entry.wasPremium ? <span style={{ color: '#f59e0b' }}>Y</span> : <span style={{ color: theme.colors.secondaryText }}>N</span>}</td>
                                            <td style={{ padding: '6px 4px', color: theme.colors.secondaryText, fontSize: 10 }}>{new Date(Number(entry.mintedAt) / 1_000_000).toLocaleDateString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {mintLogTotal > 50 && (
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
                                <button onClick={() => setMintLogPage(p => Math.max(0, p - 1))} disabled={mintLogPage === 0} style={btnSm(appPrimary)}>Previous</button>
                                <span style={{ color: theme.colors.secondaryText, fontSize: 13, lineHeight: '32px' }}>Page {mintLogPage + 1} of {Math.ceil(mintLogTotal / 50)}</span>
                                <button onClick={() => setMintLogPage(p => p + 1)} disabled={(mintLogPage + 1) * 50 >= mintLogTotal} style={btnSm(appPrimary)}>Next</button>
                            </div>
                        )}
                    </div>
                )}

                {/* ==================== REVENUE TAB ==================== */}
                {activeTab === 'revenue' && (
                    <div>
                        <h3 style={{ color: theme.colors.primaryText, marginBottom: 12 }}><FaChartBar /> Revenue Overview</h3>
                        {daoStats && (
                            <div style={cardStyle}>
                                <div style={{ color: appPrimary, fontWeight: 600, marginBottom: 8 }}>Sneed DAO Revenue</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                                    <div><div style={{ color: theme.colors.secondaryText, fontSize: 12 }}>Total Revenue</div><div style={{ color: theme.colors.primaryText, fontSize: 20, fontWeight: 600 }}>{(Number(daoStats.totalRevenueE8s) / E8S).toFixed(4)} ICP</div></div>
                                    <div><div style={{ color: theme.colors.secondaryText, fontSize: 12 }}>From DAO Cut</div><div style={{ color: '#f59e0b', fontSize: 20, fontWeight: 600 }}>{(Number(daoStats.totalDaoCutReceivedE8s) / E8S).toFixed(4)} ICP</div></div>
                                    <div><div style={{ color: theme.colors.secondaryText, fontSize: 12 }}>Direct (Publisher 0)</div><div style={{ color: '#10b981', fontSize: 20, fontWeight: 600 }}>{(Number(daoStats.totalDirectRevenueE8s) / E8S).toFixed(4)} ICP</div></div>
                                </div>
                            </div>
                        )}
                        <h3 style={{ color: theme.colors.primaryText, marginTop: 16, marginBottom: 12 }}>Publisher Stats</h3>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ borderBottom: `1px solid ${theme.colors.borderColor || '#333'}` }}>
                                        {['Publisher', 'Total Revenue', 'Withdrawn', 'DAO Cut', 'Mints'].map(h => (
                                            <th key={h} style={{ padding: '8px 6px', textAlign: 'left', color: theme.colors.secondaryText, fontWeight: 500 }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pubStats.map(s => (
                                        <tr key={Number(s.publisherId)} style={{ borderBottom: `1px solid ${theme.colors.borderColor || '#222'}` }}>
                                            <td style={{ padding: '8px 6px', color: appPrimary }}>{pubMap[Number(s.publisherId)]?.name || `ID ${Number(s.publisherId)}`}</td>
                                            <td style={{ padding: '8px 6px', color: theme.colors.primaryText }}>{(Number(s.totalRevenueE8s) / E8S).toFixed(4)} ICP</td>
                                            <td style={{ padding: '8px 6px', color: '#10b981' }}>{(Number(s.totalWithdrawnE8s) / E8S).toFixed(4)} ICP</td>
                                            <td style={{ padding: '8px 6px', color: '#f59e0b' }}>{(Number(s.totalDaoCutE8s) / E8S).toFixed(4)} ICP</td>
                                            <td style={{ padding: '8px 6px', color: theme.colors.primaryText }}>{Number(s.totalMintCount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ==================== MIGRATION TAB ==================== */}
                {activeTab === 'migration' && (
                    <div>
                        <h3 style={{ color: theme.colors.primaryText, marginBottom: 12 }}><FaWallet /> Register Canisters for Users</h3>
                        <div style={cardStyle}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                <div><label style={label}>User Principal *</label><input value={migrationInput.user} onChange={e => setMigrationInput({ ...migrationInput, user: e.target.value })} style={inputStyle} /></div>
                                <div><label style={label}>Canister ID *</label><input value={migrationInput.canisterId} onChange={e => setMigrationInput({ ...migrationInput, canisterId: e.target.value })} style={inputStyle} /></div>
                                <div><label style={label}>App ID *</label><input value={migrationInput.appId} onChange={e => setMigrationInput({ ...migrationInput, appId: e.target.value })} placeholder="icp-staking-bot" style={inputStyle} /></div>
                            </div>
                            <button onClick={handleSingleRegister} disabled={loading || !migrationInput.user || !migrationInput.canisterId} style={{ marginTop: 12, padding: '10px 20px', borderRadius: 8, background: `linear-gradient(135deg, ${appPrimary}, #22d3ee)`, color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                                {loading ? <FaSpinner className="fa-spin" /> : <FaPlus />} Register
                            </button>
                        </div>
                        <h3 style={{ color: theme.colors.primaryText, marginTop: 24, marginBottom: 12 }}>Bulk Register (JSON)</h3>
                        <div style={cardStyle}>
                            <label style={label}>Paste JSON array of [user, canisterId, appId] tuples</label>
                            <textarea value={bulkInput} onChange={e => setBulkInput(e.target.value)} rows={6} placeholder='[["user-principal", "canister-id", "icp-staking-bot"], ...]' style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }} />
                            <button onClick={handleBulkRegister} disabled={loading || !bulkInput} style={{ marginTop: 12, padding: '10px 20px', borderRadius: 8, background: `linear-gradient(135deg, ${appPrimary}, #22d3ee)`, color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                                {loading ? <FaSpinner className="fa-spin" /> : <FaUpload />} Bulk Register
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
