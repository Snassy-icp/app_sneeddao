import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../AuthContext';
import { useAdminCheck } from '../../hooks/useAdminCheck';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneedapp';
import Header from '../../components/Header';
import { useTheme } from '../../contexts/ThemeContext';
import { Principal } from '@dfinity/principal';
import { FaSave, FaPlus, FaTrash, FaUpload, FaSpinner, FaCheckCircle, FaExclamationTriangle, FaEdit, FaTimes, FaSearch, FaCloudDownloadAlt } from 'react-icons/fa';

const appPrimary = '#06b6d4';
const E8S = 100_000_000;

export default function SneedAppAdmin() {
    const { isAuthenticated, identity } = useAuth();
    const { theme } = useTheme();
    const { isAdmin, loading: adminLoading, error: adminError } = useAdminCheck({ identity, isAuthenticated });
    const [activeTab, setActiveTab] = useState('apps');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Apps state
    const [apps, setApps] = useState([]);
    const [editingApp, setEditingApp] = useState(null); // appId string or null
    const [editingAppData, setEditingAppData] = useState({});
    const [newApp, setNewApp] = useState({ appId: '', name: '', description: '', iconUrl: '', mintPriceE8s: '1', premiumMintPriceE8s: '0.5', viewUrl: '', manageUrl: '', mintUrl: '' });

    // Versions state
    const [selectedAppId, setSelectedAppId] = useState('');
    const [versions, setVersions] = useState([]);
    const [newVersion, setNewVersion] = useState({ major: '', minor: '', patch: '', wasmHash: '', wasmUrl: '', sourceUrl: '', releaseNotes: '', releaseDate: '' });
    const [editingVersion, setEditingVersion] = useState(null); // vKey string or null
    const [editVersionData, setEditVersionData] = useState({});
    const [wasmFile, setWasmFile] = useState(null);
    const [uploadingWasm, setUploadingWasm] = useState('');
    const [downloadUploadWasm, setDownloadUploadWasm] = useState(''); // vKey being processed
    const [downloadUploadStatus, setDownloadUploadStatus] = useState(''); // progress text

    // Mint log state
    const [mintLog, setMintLog] = useState([]);
    const [mintLogTotal, setMintLogTotal] = useState(0);
    const [mintLogFilter, setMintLogFilter] = useState({ appId: '', minter: '' });
    const [mintLogPage, setMintLogPage] = useState(0);

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

    // Load apps
    const loadApps = useCallback(async () => {
        try {
            const factory = getFactory();
            if (!factory) return;
            const appList = await factory.getApps();
            setApps(appList);
            if (!selectedAppId && appList.length > 0) setSelectedAppId(appList[0].appId);
        } catch (e) { showError('Failed to load apps: ' + e.message); }
    }, [getFactory, selectedAppId]);

    useEffect(() => { if (isAdmin) loadApps(); }, [isAdmin, loadApps]);

    // Load versions when app selected
    const loadVersions = useCallback(async () => {
        if (!selectedAppId) { setVersions([]); return; }
        try {
            const factory = getFactory();
            if (!factory) return;
            const vList = await factory.getAppVersions(selectedAppId);
            setVersions(vList);
        } catch (e) { showError('Failed to load versions: ' + e.message); }
    }, [selectedAppId, getFactory]);

    useEffect(() => { if (isAdmin && activeTab === 'versions') loadVersions(); }, [isAdmin, activeTab, loadVersions]);

    // Load mint log
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

    useEffect(() => { if (isAdmin && activeTab === 'mintlog') loadMintLog(); }, [isAdmin, activeTab, loadMintLog]);

    // -- App CRUD --
    const handleAddApp = async () => {
        setLoading(true);
        try {
            const factory = getFactory();
            await factory.addApp({
                appId: newApp.appId,
                name: newApp.name,
                description: newApp.description,
                iconUrl: newApp.iconUrl ? [newApp.iconUrl] : [],
                mintPriceE8s: BigInt(Math.round(parseFloat(newApp.mintPriceE8s) * E8S)),
                premiumMintPriceE8s: BigInt(Math.round(parseFloat(newApp.premiumMintPriceE8s) * E8S)),
                viewUrl: newApp.viewUrl ? [newApp.viewUrl] : [],
                manageUrl: newApp.manageUrl ? [newApp.manageUrl] : [],
                mintUrl: newApp.mintUrl ? [newApp.mintUrl] : [],
                createdAt: BigInt(Date.now() * 1_000_000),
                enabled: true
            });
            showSuccess('App added');
            setNewApp({ appId: '', name: '', description: '', iconUrl: '', mintPriceE8s: '1', premiumMintPriceE8s: '0.5', viewUrl: '', manageUrl: '', mintUrl: '' });
            await loadApps();
        } catch (e) { showError('Failed to add app: ' + e.message); }
        setLoading(false);
    };

    const handleUpdateApp = async (app) => {
        setLoading(true);
        try {
            const factory = getFactory();
            await factory.updateApp(app.appId, app);
            showSuccess('App updated');
            setEditingApp(null);
            await loadApps();
        } catch (e) { showError('Failed to update app: ' + e.message); }
        setLoading(false);
    };

    const handleRemoveApp = async (appId) => {
        if (!confirm(`Remove app "${appId}"?`)) return;
        setLoading(true);
        try {
            const factory = getFactory();
            await factory.removeApp(appId);
            showSuccess('App removed');
            await loadApps();
        } catch (e) { showError('Failed to remove app: ' + e.message); }
        setLoading(false);
    };

    const handleToggleApp = async (appId, enabled) => {
        try {
            const factory = getFactory();
            await factory.setAppEnabled(appId, enabled);
            await loadApps();
        } catch (e) { showError(e.message); }
    };

    // -- Version CRUD --
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
                major: v.major,
                minor: v.minor,
                patch: v.patch,
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
            // Validate WASM magic bytes
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
            if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
            const contentLength = response.headers.get('content-length');
            if (contentLength && !response.body) {
                // No streaming support, just get the whole blob
                setDownloadUploadStatus(`Downloading WASM (${(parseInt(contentLength) / 1024).toFixed(0)} KB)...`);
            }
            let bytes;
            if (response.body && contentLength) {
                // Stream with progress
                const total = parseInt(contentLength);
                const reader = response.body.getReader();
                const chunks = [];
                let received = 0;
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    received += value.length;
                    const pct = Math.round((received / total) * 100);
                    setDownloadUploadStatus(`Downloading WASM... ${pct}% (${(received / 1024).toFixed(0)} / ${(total / 1024).toFixed(0)} KB)`);
                }
                const allBytes = new Uint8Array(received);
                let offset = 0;
                for (const chunk of chunks) {
                    allBytes.set(chunk, offset);
                    offset += chunk.length;
                }
                bytes = allBytes;
            } else {
                const buf = await response.arrayBuffer();
                bytes = new Uint8Array(buf);
            }

            // Validate WASM magic bytes
            if (bytes.length < 4 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
                throw new Error('Invalid WASM file (bad magic bytes). The URL may not point to a valid .wasm file.');
            }

            setDownloadUploadStatus(`Uploading WASM to canister (${(bytes.length / 1024).toFixed(0)} KB)...`);
            const factory = getFactory();
            await factory.uploadAppVersionWasm(selectedAppId, v.major, v.minor, v.patch, bytes);
            showSuccess(`WASM downloaded & uploaded for v${vKey} (${(bytes.length / 1024).toFixed(0)} KB)`);
            await loadVersions();
        } catch (e) {
            showError('Download & upload failed: ' + e.message);
        }
        setDownloadUploadWasm('');
        setDownloadUploadStatus('');
    };

    // Styles
    const inputStyle = {
        width: '100%', padding: '8px 12px', borderRadius: 6,
        border: `1px solid ${theme.colors.borderColor || '#444'}`,
        background: theme.colors.primaryBg, color: theme.colors.primaryText,
        fontSize: 13, outline: 'none', boxSizing: 'border-box'
    };

    const tabStyle = (active) => ({
        padding: '10px 20px', borderRadius: '8px 8px 0 0', cursor: 'pointer',
        background: active ? theme.colors.secondaryBg : 'transparent',
        color: active ? appPrimary : theme.colors.secondaryText,
        border: active ? `1px solid ${theme.colors.borderColor || '#333'}` : '1px solid transparent',
        borderBottom: active ? `2px solid ${appPrimary}` : '2px solid transparent',
        fontWeight: active ? 600 : 400, fontSize: 14
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

    if (adminLoading) return <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}><Header /><div style={{ textAlign: 'center', padding: 60, color: theme.colors.secondaryText }}><FaSpinner className="fa-spin" /> Loading...</div></div>;
    if (!isAdmin) return <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}><Header /><div style={{ textAlign: 'center', padding: 60, color: '#ef4444' }}>{adminError || 'Not authorized'}</div></div>;

    return (
        <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
            <Header />
            <div style={{ maxWidth: 1000, margin: '0 auto', padding: '20px 16px 60px' }}>
                <h1 style={{ color: theme.colors.primaryText, fontSize: 24, marginBottom: 20 }}>Sneedapp Admin</h1>

                {/* Status messages */}
                {error && <div style={{ background: '#ef444420', border: '1px solid #ef4444', borderRadius: 8, padding: 10, marginBottom: 12, color: '#ef4444', fontSize: 13 }}><FaExclamationTriangle /> {error}</div>}
                {success && <div style={{ background: '#10b98120', border: '1px solid #10b981', borderRadius: 8, padding: 10, marginBottom: 12, color: '#10b981', fontSize: 13 }}><FaCheckCircle /> {success}</div>}

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${theme.colors.borderColor || '#333'}` }}>
                    {['apps', 'versions', 'mintlog'].map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} style={tabStyle(activeTab === tab)}>
                            {tab === 'apps' ? 'Apps' : tab === 'versions' ? 'Versions' : 'Mint Log'}
                        </button>
                    ))}
                </div>

                {/* ==================== APPS TAB ==================== */}
                {activeTab === 'apps' && (
                    <div>
                        {/* Existing Apps */}
                        <h3 style={{ color: theme.colors.primaryText, marginBottom: 12 }}>Registered Apps ({apps.length})</h3>
                        {apps.map(app => {
                            const isEditing = editingApp === app.appId;
                            // Local edit state is stored in a closure via the editingAppData state
                            return (
                            <div key={app.appId} style={cardStyle}>
                                {!isEditing ? (
                                    <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                            <div>
                                                <div style={{ color: theme.colors.primaryText, fontWeight: 600 }}>{app.name}</div>
                                                <code style={{ color: theme.colors.secondaryText, fontSize: 12 }}>{app.appId}</code>
                                            </div>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <button onClick={() => {
                                                    setEditingApp(app.appId);
                                                    setEditingAppData({
                                                        name: app.name,
                                                        description: app.description,
                                                        iconUrl: app.iconUrl?.length > 0 ? app.iconUrl[0] : '',
                                                        mintPriceE8s: (Number(app.mintPriceE8s) / E8S).toString(),
                                                        premiumMintPriceE8s: (Number(app.premiumMintPriceE8s) / E8S).toString(),
                                                        viewUrl: app.viewUrl?.length > 0 ? app.viewUrl[0] : '',
                                                        manageUrl: app.manageUrl?.length > 0 ? app.manageUrl[0] : '',
                                                        mintUrl: app.mintUrl?.length > 0 ? app.mintUrl[0] : ''
                                                    });
                                                }} style={btnSm(appPrimary)}>
                                                    <FaEdit /> Edit
                                                </button>
                                                <button onClick={() => handleToggleApp(app.appId, !app.enabled)} style={btnSm(app.enabled ? '#10b981' : '#ef4444')}>
                                                    {app.enabled ? 'Enabled' : 'Disabled'}
                                                </button>
                                                <button onClick={() => handleRemoveApp(app.appId)} style={btnSm('#ef4444')}>
                                                    <FaTrash />
                                                </button>
                                            </div>
                                        </div>
                                        <div style={{ color: theme.colors.secondaryText, fontSize: 13, marginBottom: 4 }}>{app.description}</div>
                                        <div style={{ fontSize: 12, color: theme.colors.secondaryText }}>
                                            Price: {(Number(app.mintPriceE8s) / E8S).toFixed(2)} ICP | Premium: {(Number(app.premiumMintPriceE8s) / E8S).toFixed(2)} ICP
                                        </div>
                                        {(app.viewUrl?.length > 0 || app.manageUrl?.length > 0 || app.mintUrl?.length > 0) && (
                                            <div style={{ fontSize: 11, color: theme.colors.secondaryText, marginTop: 4 }}>
                                                {app.viewUrl?.length > 0 && <span>View: {app.viewUrl[0]} </span>}
                                                {app.manageUrl?.length > 0 && <span>| Manage: {app.manageUrl[0]} </span>}
                                                {app.mintUrl?.length > 0 && <span>| Mint: {app.mintUrl[0]}</span>}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                            <div>
                                                <span style={{ color: appPrimary, fontWeight: 600 }}>Editing: </span>
                                                <code style={{ color: theme.colors.secondaryText, fontSize: 12 }}>{app.appId}</code>
                                            </div>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <button onClick={() => {
                                                    handleUpdateApp({
                                                        ...app,
                                                        name: editingAppData.name,
                                                        description: editingAppData.description,
                                                        iconUrl: editingAppData.iconUrl ? [editingAppData.iconUrl] : [],
                                                        mintPriceE8s: BigInt(Math.round(parseFloat(editingAppData.mintPriceE8s || '0') * E8S)),
                                                        premiumMintPriceE8s: BigInt(Math.round(parseFloat(editingAppData.premiumMintPriceE8s || '0') * E8S)),
                                                        viewUrl: editingAppData.viewUrl ? [editingAppData.viewUrl] : [],
                                                        manageUrl: editingAppData.manageUrl ? [editingAppData.manageUrl] : [],
                                                        mintUrl: editingAppData.mintUrl ? [editingAppData.mintUrl] : [],
                                                    });
                                                }} disabled={loading} style={btnSm('#10b981')}>
                                                    {loading ? <FaSpinner className="fa-spin" /> : <FaSave />} Save
                                                </button>
                                                <button onClick={() => setEditingApp(null)} style={btnSm('#ef4444')}>
                                                    <FaTimes /> Cancel
                                                </button>
                                            </div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                            <div>
                                                <label style={{ color: theme.colors.secondaryText, fontSize: 11, display: 'block', marginBottom: 2 }}>Name</label>
                                                <input value={editingAppData.name} onChange={e => setEditingAppData({ ...editingAppData, name: e.target.value })} style={inputStyle} />
                                            </div>
                                            <div>
                                                <label style={{ color: theme.colors.secondaryText, fontSize: 11, display: 'block', marginBottom: 2 }}>Icon URL</label>
                                                <input value={editingAppData.iconUrl} onChange={e => setEditingAppData({ ...editingAppData, iconUrl: e.target.value })} style={inputStyle} />
                                            </div>
                                            <div style={{ gridColumn: '1 / -1' }}>
                                                <label style={{ color: theme.colors.secondaryText, fontSize: 11, display: 'block', marginBottom: 2 }}>Description</label>
                                                <input value={editingAppData.description} onChange={e => setEditingAppData({ ...editingAppData, description: e.target.value })} style={inputStyle} />
                                            </div>
                                            <div>
                                                <label style={{ color: theme.colors.secondaryText, fontSize: 11, display: 'block', marginBottom: 2 }}>Mint Price (ICP)</label>
                                                <input value={editingAppData.mintPriceE8s} onChange={e => setEditingAppData({ ...editingAppData, mintPriceE8s: e.target.value })} type="number" step="0.01" style={inputStyle} />
                                            </div>
                                            <div>
                                                <label style={{ color: theme.colors.secondaryText, fontSize: 11, display: 'block', marginBottom: 2 }}>Premium Price (ICP)</label>
                                                <input value={editingAppData.premiumMintPriceE8s} onChange={e => setEditingAppData({ ...editingAppData, premiumMintPriceE8s: e.target.value })} type="number" step="0.01" style={inputStyle} />
                                            </div>
                                            <div>
                                                <label style={{ color: theme.colors.secondaryText, fontSize: 11, display: 'block', marginBottom: 2 }}>View URL</label>
                                                <input value={editingAppData.viewUrl} onChange={e => setEditingAppData({ ...editingAppData, viewUrl: e.target.value })} placeholder="/app/CANISTER_ID" style={inputStyle} />
                                            </div>
                                            <div>
                                                <label style={{ color: theme.colors.secondaryText, fontSize: 11, display: 'block', marginBottom: 2 }}>Manage URL</label>
                                                <input value={editingAppData.manageUrl} onChange={e => setEditingAppData({ ...editingAppData, manageUrl: e.target.value })} placeholder="/app/CANISTER_ID/admin" style={inputStyle} />
                                            </div>
                                            <div style={{ gridColumn: '1 / -1' }}>
                                                <label style={{ color: theme.colors.secondaryText, fontSize: 11, display: 'block', marginBottom: 2 }}>Custom Mint URL</label>
                                                <input value={editingAppData.mintUrl} onChange={e => setEditingAppData({ ...editingAppData, mintUrl: e.target.value })} placeholder="Leave empty for generic" style={inputStyle} />
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                            );
                        })}

                        {/* Add New App */}
                        <h3 style={{ color: theme.colors.primaryText, marginTop: 24, marginBottom: 12 }}>Add New App</h3>
                        <div style={cardStyle}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>App ID *</label>
                                    <input value={newApp.appId} onChange={e => setNewApp({ ...newApp, appId: e.target.value })} placeholder="my-app" style={inputStyle} />
                                </div>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>Name *</label>
                                    <input value={newApp.name} onChange={e => setNewApp({ ...newApp, name: e.target.value })} placeholder="My App" style={inputStyle} />
                                </div>
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>Description</label>
                                    <input value={newApp.description} onChange={e => setNewApp({ ...newApp, description: e.target.value })} placeholder="Short description" style={inputStyle} />
                                </div>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>Mint Price (ICP)</label>
                                    <input value={newApp.mintPriceE8s} onChange={e => setNewApp({ ...newApp, mintPriceE8s: e.target.value })} type="number" step="0.01" style={inputStyle} />
                                </div>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>Premium Price (ICP)</label>
                                    <input value={newApp.premiumMintPriceE8s} onChange={e => setNewApp({ ...newApp, premiumMintPriceE8s: e.target.value })} type="number" step="0.01" style={inputStyle} />
                                </div>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>View URL</label>
                                    <input value={newApp.viewUrl} onChange={e => setNewApp({ ...newApp, viewUrl: e.target.value })} placeholder="/app/CANISTER_ID" style={inputStyle} />
                                </div>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>Manage URL</label>
                                    <input value={newApp.manageUrl} onChange={e => setNewApp({ ...newApp, manageUrl: e.target.value })} placeholder="/app/CANISTER_ID/admin" style={inputStyle} />
                                </div>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>Custom Mint URL</label>
                                    <input value={newApp.mintUrl} onChange={e => setNewApp({ ...newApp, mintUrl: e.target.value })} placeholder="Leave empty for generic" style={inputStyle} />
                                </div>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>Icon URL</label>
                                    <input value={newApp.iconUrl} onChange={e => setNewApp({ ...newApp, iconUrl: e.target.value })} placeholder="https://..." style={inputStyle} />
                                </div>
                            </div>
                            <button onClick={handleAddApp} disabled={loading || !newApp.appId || !newApp.name}
                                style={{
                                    marginTop: 16, padding: '10px 20px', borderRadius: 8,
                                    background: `linear-gradient(135deg, ${appPrimary}, #22d3ee)`,
                                    color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer',
                                    opacity: loading || !newApp.appId || !newApp.name ? 0.5 : 1,
                                    display: 'flex', alignItems: 'center', gap: 6
                                }}
                            >
                                {loading ? <FaSpinner className="fa-spin" /> : <FaPlus />} Add App
                            </button>
                        </div>
                    </div>
                )}

                {/* ==================== VERSIONS TAB ==================== */}
                {activeTab === 'versions' && (
                    <div>
                        {/* App selector */}
                        <div style={{ marginBottom: 16 }}>
                            <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>Select App</label>
                            <select value={selectedAppId} onChange={e => setSelectedAppId(e.target.value)} style={{ ...inputStyle, maxWidth: 300 }}>
                                {apps.map(a => <option key={a.appId} value={a.appId}>{a.name} ({a.appId})</option>)}
                            </select>
                        </div>

                        {/* Existing Versions */}
                        <h3 style={{ color: theme.colors.primaryText, marginBottom: 12 }}>Versions ({versions.length})</h3>
                        {versions.map(v => {
                            const vKey = `${Number(v.major)}.${Number(v.minor)}.${Number(v.patch)}`;
                            const isEditingV = editingVersion === vKey;
                            return (
                                <div key={vKey} style={cardStyle}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ color: theme.colors.primaryText, fontWeight: 600 }}>v{vKey}</span>
                                            {v.hasWasm ? (
                                                <span style={{ fontSize: 11, background: '#10b98120', color: '#10b981', padding: '2px 8px', borderRadius: 4 }}>
                                                    WASM ({Number(v.wasmSize).toLocaleString()} bytes)
                                                </span>
                                            ) : (
                                                <span style={{ fontSize: 11, background: '#f59e0b20', color: '#f59e0b', padding: '2px 8px', borderRadius: 4 }}>
                                                    No WASM
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            {!isEditingV ? (
                                                <>
                                                    <button onClick={() => startEditVersion(v)} style={btnSm(appPrimary)}>
                                                        <FaEdit /> Edit
                                                    </button>
                                                    <button onClick={() => handleRemoveVersion(v)} style={btnSm('#ef4444')}><FaTrash /></button>
                                                </>
                                            ) : (
                                                <>
                                                    <button onClick={() => handleUpdateVersion(v)} disabled={loading} style={btnSm('#10b981')}>
                                                        {loading ? <FaSpinner className="fa-spin" /> : <FaSave />} Save
                                                    </button>
                                                    <button onClick={() => setEditingVersion(null)} style={btnSm('#ef4444')}>
                                                        <FaTimes /> Cancel
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {!isEditingV ? (
                                        <>
                                            {v.releaseNotes && <div style={{ color: theme.colors.secondaryText, fontSize: 12, marginBottom: 8 }}>{v.releaseNotes}</div>}
                                            {v.wasmHash && <div style={{ color: theme.colors.secondaryText, fontSize: 11, marginBottom: 4 }}>Hash: {v.wasmHash.substring(0, 16)}...</div>}
                                            {v.wasmUrl?.length > 0 && <div style={{ color: theme.colors.secondaryText, fontSize: 11, marginBottom: 2 }}>WASM URL: {v.wasmUrl[0]}</div>}
                                            {v.sourceUrl?.length > 0 && <div style={{ color: theme.colors.secondaryText, fontSize: 11, marginBottom: 2 }}>Source: {v.sourceUrl[0]}</div>}
                                            {v.releaseDate && <div style={{ color: theme.colors.secondaryText, fontSize: 11 }}>Released: {new Date(Number(v.releaseDate) / 1_000_000).toLocaleDateString()}</div>}
                                        </>
                                    ) : (
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                                            <div>
                                                <label style={{ color: theme.colors.secondaryText, fontSize: 11, display: 'block', marginBottom: 2 }}>WASM Hash</label>
                                                <input value={editVersionData.wasmHash} onChange={e => setEditVersionData({ ...editVersionData, wasmHash: e.target.value })} placeholder="SHA256 hex" style={inputStyle} />
                                            </div>
                                            <div>
                                                <label style={{ color: theme.colors.secondaryText, fontSize: 11, display: 'block', marginBottom: 2 }}>Release Date</label>
                                                <input value={editVersionData.releaseDate} onChange={e => setEditVersionData({ ...editVersionData, releaseDate: e.target.value })} type="date" style={inputStyle} />
                                            </div>
                                            <div>
                                                <label style={{ color: theme.colors.secondaryText, fontSize: 11, display: 'block', marginBottom: 2 }}>WASM URL</label>
                                                <input value={editVersionData.wasmUrl} onChange={e => setEditVersionData({ ...editVersionData, wasmUrl: e.target.value })} placeholder="https://..." style={inputStyle} />
                                            </div>
                                            <div>
                                                <label style={{ color: theme.colors.secondaryText, fontSize: 11, display: 'block', marginBottom: 2 }}>Source URL</label>
                                                <input value={editVersionData.sourceUrl} onChange={e => setEditVersionData({ ...editVersionData, sourceUrl: e.target.value })} placeholder="https://github.com/..." style={inputStyle} />
                                            </div>
                                            <div style={{ gridColumn: '1 / -1' }}>
                                                <label style={{ color: theme.colors.secondaryText, fontSize: 11, display: 'block', marginBottom: 2 }}>Release Notes</label>
                                                <textarea value={editVersionData.releaseNotes} onChange={e => setEditVersionData({ ...editVersionData, releaseNotes: e.target.value })}
                                                    rows={3} placeholder="What's new..." style={{ ...inputStyle, resize: 'vertical' }} />
                                            </div>
                                        </div>
                                    )}

                                    {/* WASM Upload */}
                                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <input type="file" accept=".wasm" onChange={e => setWasmFile(e.target.files[0])} style={{ fontSize: 12, color: theme.colors.secondaryText }} />
                                        <button onClick={() => handleUploadWasm(v)} disabled={!wasmFile || uploadingWasm === vKey || downloadUploadWasm === vKey}
                                            style={btnSm(appPrimary)}>
                                            {uploadingWasm === vKey ? <FaSpinner className="fa-spin" /> : <FaUpload />} Upload WASM
                                        </button>
                                        {(v.wasmUrl?.length > 0 || (editingVersion === vKey && editVersionData.wasmUrl)) && (
                                            <button onClick={() => handleDownloadAndUploadWasm(v)}
                                                disabled={downloadUploadWasm === vKey || uploadingWasm === vKey}
                                                style={btnSm('#8b5cf6')}>
                                                {downloadUploadWasm === vKey ? <FaSpinner className="fa-spin" /> : <FaCloudDownloadAlt />} Download &amp; Upload
                                            </button>
                                        )}
                                        {v.hasWasm && (
                                            <button onClick={() => handleClearWasm(v)} style={btnSm('#ef4444')}>
                                                <FaTimes /> Clear
                                            </button>
                                        )}
                                    </div>
                                    {downloadUploadWasm === vKey && downloadUploadStatus && (
                                        <div style={{
                                            marginTop: 8, padding: '8px 12px', borderRadius: 6,
                                            background: '#8b5cf620', border: '1px solid #8b5cf640',
                                            color: '#8b5cf6', fontSize: 12,
                                            display: 'flex', alignItems: 'center', gap: 8
                                        }}>
                                            <FaSpinner className="fa-spin" /> {downloadUploadStatus}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* Add New Version */}
                        <h3 style={{ color: theme.colors.primaryText, marginTop: 24, marginBottom: 12 }}>Add New Version</h3>
                        <div style={cardStyle}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>Major</label>
                                    <input value={newVersion.major} onChange={e => setNewVersion({ ...newVersion, major: e.target.value })} type="number" style={inputStyle} />
                                </div>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>Minor</label>
                                    <input value={newVersion.minor} onChange={e => setNewVersion({ ...newVersion, minor: e.target.value })} type="number" style={inputStyle} />
                                </div>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>Patch</label>
                                    <input value={newVersion.patch} onChange={e => setNewVersion({ ...newVersion, patch: e.target.value })} type="number" style={inputStyle} />
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>WASM Hash</label>
                                    <input value={newVersion.wasmHash} onChange={e => setNewVersion({ ...newVersion, wasmHash: e.target.value })} placeholder="SHA256 hex" style={inputStyle} />
                                </div>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>Release Date</label>
                                    <input value={newVersion.releaseDate} onChange={e => setNewVersion({ ...newVersion, releaseDate: e.target.value })} type="date" style={inputStyle} />
                                </div>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>WASM URL</label>
                                    <input value={newVersion.wasmUrl} onChange={e => setNewVersion({ ...newVersion, wasmUrl: e.target.value })} placeholder="https://..." style={inputStyle} />
                                </div>
                                <div>
                                    <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>Source URL</label>
                                    <input value={newVersion.sourceUrl} onChange={e => setNewVersion({ ...newVersion, sourceUrl: e.target.value })} placeholder="https://github.com/..." style={inputStyle} />
                                </div>
                            </div>
                            <div style={{ marginTop: 12 }}>
                                <label style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'block', marginBottom: 4 }}>Release Notes</label>
                                <textarea value={newVersion.releaseNotes} onChange={e => setNewVersion({ ...newVersion, releaseNotes: e.target.value })}
                                    rows={3} placeholder="What's new in this version..." style={{ ...inputStyle, resize: 'vertical' }} />
                            </div>
                            <button onClick={handleAddVersion} disabled={loading || !newVersion.major}
                                style={{
                                    marginTop: 12, padding: '10px 20px', borderRadius: 8,
                                    background: `linear-gradient(135deg, ${appPrimary}, #22d3ee)`,
                                    color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer',
                                    opacity: loading || !newVersion.major ? 0.5 : 1,
                                    display: 'flex', alignItems: 'center', gap: 6
                                }}
                            >
                                {loading ? <FaSpinner className="fa-spin" /> : <FaPlus />} Add Version
                            </button>
                        </div>
                    </div>
                )}

                {/* ==================== MINT LOG TAB ==================== */}
                {activeTab === 'mintlog' && (
                    <div>
                        <h3 style={{ color: theme.colors.primaryText, marginBottom: 12 }}>Immutable Mint Log ({mintLogTotal} entries)</h3>

                        {/* Filters */}
                        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                            <input value={mintLogFilter.appId} onChange={e => setMintLogFilter({ ...mintLogFilter, appId: e.target.value })}
                                placeholder="Filter by app ID" style={{ ...inputStyle, maxWidth: 200 }} />
                            <input value={mintLogFilter.minter} onChange={e => setMintLogFilter({ ...mintLogFilter, minter: e.target.value })}
                                placeholder="Filter by minter principal" style={{ ...inputStyle, maxWidth: 300 }} />
                            <button onClick={loadMintLog} style={btnSm(appPrimary)}><FaSearch /> Search</button>
                        </div>

                        {/* Log entries */}
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ borderBottom: `1px solid ${theme.colors.borderColor || '#333'}` }}>
                                        {['#', 'Canister', 'Minter', 'App', 'Version', 'ICP Paid', 'Premium', 'Date'].map(h => (
                                            <th key={h} style={{ padding: '8px 6px', textAlign: 'left', color: theme.colors.secondaryText, fontWeight: 500 }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {mintLog.map(entry => (
                                        <tr key={Number(entry.index)} style={{ borderBottom: `1px solid ${theme.colors.borderColor || '#222'}` }}>
                                            <td style={{ padding: '8px 6px', color: theme.colors.secondaryText }}>{Number(entry.index)}</td>
                                            <td style={{ padding: '8px 6px', color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: 11 }}>
                                                {entry.canisterId.toText().substring(0, 10)}...
                                            </td>
                                            <td style={{ padding: '8px 6px', color: theme.colors.primaryText, fontFamily: 'monospace', fontSize: 11 }}>
                                                {entry.minter.toText().substring(0, 10)}...
                                            </td>
                                            <td style={{ padding: '8px 6px', color: appPrimary }}>{entry.appId}</td>
                                            <td style={{ padding: '8px 6px', color: theme.colors.primaryText }}>
                                                {Number(entry.versionMajor)}.{Number(entry.versionMinor)}.{Number(entry.versionPatch)}
                                            </td>
                                            <td style={{ padding: '8px 6px', color: theme.colors.primaryText }}>
                                                {(Number(entry.icpPaidE8s) / E8S).toFixed(2)}
                                            </td>
                                            <td style={{ padding: '8px 6px' }}>
                                                {entry.wasPremium ? <span style={{ color: '#f59e0b' }}>Yes</span> : <span style={{ color: theme.colors.secondaryText }}>No</span>}
                                            </td>
                                            <td style={{ padding: '8px 6px', color: theme.colors.secondaryText, fontSize: 11 }}>
                                                {new Date(Number(entry.mintedAt) / 1_000_000).toLocaleDateString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        {mintLogTotal > 50 && (
                            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
                                <button onClick={() => setMintLogPage(p => Math.max(0, p - 1))} disabled={mintLogPage === 0}
                                    style={btnSm(appPrimary)}>Previous</button>
                                <span style={{ color: theme.colors.secondaryText, fontSize: 13, lineHeight: '32px' }}>
                                    Page {mintLogPage + 1} of {Math.ceil(mintLogTotal / 50)}
                                </span>
                                <button onClick={() => setMintLogPage(p => p + 1)} disabled={(mintLogPage + 1) * 50 >= mintLogTotal}
                                    style={btnSm(appPrimary)}>Next</button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
