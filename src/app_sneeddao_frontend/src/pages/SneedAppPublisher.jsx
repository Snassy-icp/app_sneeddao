import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneedapp';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { Principal } from '@dfinity/principal';
import { FaSave, FaPlus, FaTrash, FaSpinner, FaCheckCircle, FaExclamationTriangle, FaEdit, FaTimes, FaUpload, FaCloudDownloadAlt, FaWallet, FaChartBar, FaUsers, FaTags, FaArrowLeft } from 'react-icons/fa';
import PrincipalInput from '../components/PrincipalInput';

const appPrimary = '#06b6d4';
const E8S = 100_000_000;

export default function SneedAppPublisher() {
    const { publisherId: pubIdStr } = useParams();
    const publisherId = BigInt(pubIdStr);
    const { theme } = useTheme();
    const { identity, isAuthenticated, login } = useAuth();

    const [publisher, setPublisher] = useState(null);
    const [apps, setApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isOwner, setIsOwner] = useState(false);
    const [activeTab, setActiveTab] = useState('info');

    // Edit states
    const [editInfo, setEditInfo] = useState(null);
    const [editPaymentAccount, setEditPaymentAccount] = useState({ principal: '', subaccount: null });
    const [newOwner, setNewOwner] = useState('');
    const [newFamily, setNewFamily] = useState('');

    const accountToBackend = (principalStr, subaccountBytes) => ({
        owner: Principal.fromText(principalStr),
        subaccount: subaccountBytes ? [Array.from(subaccountBytes)] : []
    });

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

    // Version management
    const [selectedAppId, setSelectedAppId] = useState('');
    const [versions, setVersions] = useState([]);
    const [newVersion, setNewVersion] = useState({ major: '', minor: '', patch: '', wasmHash: '', wasmUrl: '', sourceUrl: '', releaseNotes: '', releaseDate: '' });
    const [editingVersion, setEditingVersion] = useState(null);
    const [editVersionData, setEditVersionData] = useState({});
    const [wasmFile, setWasmFile] = useState(null);
    const [uploadingWasm, setUploadingWasm] = useState('');

    // Revenue
    const [pubBalance, setPubBalance] = useState(null);
    const [appBalances, setAppBalances] = useState({});
    const [pubStats, setPubStats] = useState(null);

    const getFactory = useCallback((authenticated = true) => {
        const opts = {
            agentOptions: {
                host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                    ? 'https://icp0.io' : 'http://localhost:4943'
            }
        };
        if (authenticated && identity) opts.agentOptions.identity = identity;
        return createFactoryActor(factoryCanisterId, opts);
    }, [identity]);

    const showSuccess = (msg) => { setSuccess(msg); setError(''); setTimeout(() => setSuccess(''), 3000); };
    const showError = (msg) => { setError(msg); setSuccess(''); };

    const loadData = useCallback(async () => {
        try {
            const factory = getFactory(false);
            const pubResult = await factory.getPublisher(publisherId);
            if (pubResult.length === 0) { setError('Publisher not found'); setLoading(false); return; }
            const pub = pubResult[0];
            setPublisher(pub);

            if (identity) {
                const myPrincipal = identity.getPrincipal().toText();
                setIsOwner(pub.owners.some(o => o.toText() === myPrincipal));
            }

            const appList = await factory.getAppsByPublisher(publisherId);
            setApps(appList);
            if (appList.length > 0 && !selectedAppId) setSelectedAppId(appList[0].appId);
        } catch (e) { showError(e.message); }
        setLoading(false);
    }, [getFactory, publisherId, identity, selectedAppId]);

    const loadVersions = useCallback(async () => {
        if (!selectedAppId) { setVersions([]); return; }
        try {
            const factory = getFactory(false);
            setVersions(await factory.getAppVersions(selectedAppId));
        } catch (e) { console.error(e); }
    }, [selectedAppId, getFactory]);

    const loadRevenue = useCallback(async () => {
        try {
            const factory = getFactory(false);
            const [balance, stats] = await Promise.all([
                factory.getPublisherRevenueBalance(publisherId),
                factory.getPublisherStats(publisherId)
            ]);
            setPubBalance(balance);
            if (stats.length > 0) setPubStats(stats[0]);

            const balances = {};
            for (const app of apps) {
                try {
                    balances[Number(app.numericAppId)] = await factory.getAppRevenueBalance(publisherId, app.numericAppId);
                } catch { balances[Number(app.numericAppId)] = 0n; }
            }
            setAppBalances(balances);
        } catch (e) { console.error(e); }
    }, [getFactory, publisherId, apps]);

    useEffect(() => { loadData(); }, [loadData]);
    useEffect(() => { if (activeTab === 'versions') loadVersions(); }, [activeTab, loadVersions]);
    useEffect(() => { if (activeTab === 'revenue') loadRevenue(); }, [activeTab, loadRevenue]);

    // Publisher info update
    const handleUpdateInfo = async () => {
        setActionLoading(true);
        try {
            const factory = getFactory();
            const payAccount = editPaymentAccount.principal
                ? accountToBackend(editPaymentAccount.principal, editPaymentAccount.subaccount)
                : publisher.defaultPaymentAccount;
            const result = await factory.updatePublisher(publisherId, {
                name: editInfo.name,
                description: editInfo.description,
                websiteUrl: editInfo.websiteUrl ? [editInfo.websiteUrl] : [],
                logoUrl: editInfo.logoUrl ? [editInfo.logoUrl] : [],
                links: publisher.links || [],
                defaultPaymentAccount: payAccount
            });
            if (result.Err) showError(result.Err);
            else { showSuccess('Publisher updated'); setEditInfo(null); }
            await loadData();
        } catch (e) { showError(e.message); }
        setActionLoading(false);
    };

    const handleAddOwner = async () => {
        try {
            const factory = getFactory();
            const result = await factory.addPublisherOwner(publisherId, Principal.fromText(newOwner));
            if (result.Err) showError(result.Err); else showSuccess('Owner added');
            setNewOwner('');
            await loadData();
        } catch (e) { showError(e.message); }
    };

    const handleRemoveOwner = async (owner) => {
        if (owner.toText() === identity.getPrincipal().toText()) {
            if (!confirm('Remove yourself as owner? You will lose access.')) return;
        } else if (!confirm('Remove this owner?')) return;
        try {
            const factory = getFactory();
            const result = await factory.removePublisherOwner(publisherId, owner);
            if (result.Err) showError(result.Err); else showSuccess('Owner removed');
            await loadData();
        } catch (e) { showError(e.message); }
    };

    const handleAddFamily = async () => {
        try {
            const factory = getFactory();
            const result = await factory.addPublisherFamily(publisherId, newFamily);
            if (result.Err) showError(result.Err); else showSuccess('Family added');
            setNewFamily('');
            await loadData();
        } catch (e) { showError(e.message); }
    };

    const handleRemoveFamily = async (family) => {
        try {
            const factory = getFactory();
            const result = await factory.removePublisherFamily(publisherId, family);
            if (result.Err) showError(result.Err); else showSuccess('Family removed');
            await loadData();
        } catch (e) { showError(e.message); }
    };

    // App management
    const handleToggleApp = async (app) => {
        try {
            const factory = getFactory();
            const result = await factory.setAppEnabled(app.numericAppId, !app.enabled);
            if (result.Err) showError(result.Err);
            await loadData();
        } catch (e) { showError(e.message); }
    };

    // Version management
    const handleAddVersion = async () => {
        setActionLoading(true);
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
        } catch (e) { showError(e.message); }
        setActionLoading(false);
    };

    const handleRemoveVersion = async (v) => {
        if (!confirm(`Remove v${Number(v.major)}.${Number(v.minor)}.${Number(v.patch)}?`)) return;
        try {
            const factory = getFactory();
            await factory.removeAppVersion(selectedAppId, v.major, v.minor, v.patch);
            showSuccess('Version removed');
            await loadVersions();
        } catch (e) { showError(e.message); }
    };

    const handleUploadWasm = async (v) => {
        if (!wasmFile) return;
        const vKey = `${Number(v.major)}.${Number(v.minor)}.${Number(v.patch)}`;
        setUploadingWasm(vKey);
        try {
            const bytes = new Uint8Array(await wasmFile.arrayBuffer());
            if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) throw new Error('Invalid WASM');
            const factory = getFactory();
            await factory.uploadAppVersionWasm(selectedAppId, v.major, v.minor, v.patch, bytes);
            showSuccess(`WASM uploaded for v${vKey}`);
            setWasmFile(null);
            await loadVersions();
        } catch (e) { showError(e.message); }
        setUploadingWasm('');
    };

    // Revenue/Withdrawal
    const handleWithdrawPublisher = async () => {
        setActionLoading(true);
        try {
            const factory = getFactory();
            const result = await factory.withdrawPublisherFunds(publisherId);
            if (result.Ok !== undefined) showSuccess(`Withdrawn ${(Number(result.Ok) / E8S).toFixed(4)} ICP`);
            else if (result.Err) showError(typeof result.Err === 'string' ? result.Err : JSON.stringify(result.Err));
            await loadRevenue();
        } catch (e) { showError(e.message); }
        setActionLoading(false);
    };

    const handleWithdrawApp = async (numericAppId) => {
        setActionLoading(true);
        try {
            const factory = getFactory();
            const result = await factory.withdrawAppFunds(publisherId, numericAppId);
            if (result.Ok !== undefined) showSuccess(`Withdrawn ${(Number(result.Ok) / E8S).toFixed(4)} ICP`);
            else if (result.Err) showError(typeof result.Err === 'string' ? result.Err : JSON.stringify(result.Err));
            await loadRevenue();
        } catch (e) { showError(e.message); }
        setActionLoading(false);
    };

    // Styles
    const inputStyle = {
        width: '100%', padding: '8px 12px', borderRadius: 6,
        border: `1px solid ${theme.colors.borderColor || '#444'}`,
        background: theme.colors.primaryBg, color: theme.colors.primaryText,
        fontSize: 13, outline: 'none', boxSizing: 'border-box'
    };
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
    const tabStyle = (active) => ({
        padding: '10px 16px', borderRadius: '8px 8px 0 0', cursor: 'pointer',
        background: active ? theme.colors.secondaryBg : 'transparent',
        color: active ? appPrimary : theme.colors.secondaryText,
        borderBottom: active ? `2px solid ${appPrimary}` : '2px solid transparent',
        fontWeight: active ? 600 : 400, fontSize: 13, border: 'none'
    });

    const formatIcp = (e8s) => (Number(e8s) / E8S).toFixed(4);

    if (loading) return <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}><Header /><div style={{ textAlign: 'center', padding: 60, color: theme.colors.secondaryText }}><FaSpinner className="fa-spin" /> Loading...</div></div>;
    if (!publisher) return <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}><Header /><div style={{ textAlign: 'center', padding: 60, color: '#ef4444' }}>Publisher not found</div></div>;

    if (!isAuthenticated) {
        return (
            <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
                <Header />
                <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 16px', textAlign: 'center' }}>
                    <h2 style={{ color: theme.colors.primaryText }}>{publisher.name}</h2>
                    <p style={{ color: theme.colors.secondaryText }}>Connect your wallet to manage this publisher</p>
                    <button onClick={login} style={{ padding: '12px 24px', borderRadius: 8, background: `linear-gradient(135deg, ${appPrimary}, #22d3ee)`, color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer' }}>Connect Wallet</button>
                </div>
            </div>
        );
    }

    if (!isOwner) {
        return (
            <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
                <Header />
                <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 16px', textAlign: 'center' }}>
                    <h2 style={{ color: theme.colors.primaryText }}>{publisher.name}</h2>
                    <p style={{ color: '#ef4444' }}>You are not an owner of this publisher</p>
                    <Link to="/sneedapp" style={{ color: appPrimary }}>Back to App Store</Link>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
            <Header />
            <div style={{ maxWidth: 1000, margin: '0 auto', padding: '20px 16px 60px' }}>
                <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Link to="/sneedapp" style={{ color: theme.colors.secondaryText, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}><FaArrowLeft /> Back</Link>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                    <h1 style={{ color: theme.colors.primaryText, fontSize: 24, margin: 0 }}>{publisher.name}</h1>
                    {publisher.verified && <span style={pillStyle('#10b981')}><FaCheckCircle /> Verified</span>}
                    <span style={{ color: theme.colors.secondaryText, fontSize: 13 }}>Publisher #{Number(publisherId)}</span>
                </div>

                {error && <div style={{ background: '#ef444420', border: '1px solid #ef4444', borderRadius: 8, padding: 10, marginBottom: 12, color: '#ef4444', fontSize: 13 }}><FaExclamationTriangle /> {error}</div>}
                {success && <div style={{ background: '#10b98120', border: '1px solid #10b981', borderRadius: 8, padding: 10, marginBottom: 12, color: '#10b981', fontSize: 13 }}><FaCheckCircle /> {success}</div>}

                <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `1px solid ${theme.colors.borderColor || '#333'}`, flexWrap: 'wrap' }}>
                    {['info', 'apps', 'versions', 'revenue'].map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} style={tabStyle(activeTab === tab)}>
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    ))}
                </div>

                {/* ==================== INFO TAB ==================== */}
                {activeTab === 'info' && (
                    <div>
                        {editInfo ? (
                            <div style={cardStyle}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                                    <div><label style={label}>Name</label><input value={editInfo.name} onChange={e => setEditInfo({ ...editInfo, name: e.target.value })} style={inputStyle} /></div>
                                    <div><label style={label}>Website</label><input value={editInfo.websiteUrl} onChange={e => setEditInfo({ ...editInfo, websiteUrl: e.target.value })} style={inputStyle} /></div>
                                    <div style={{ gridColumn: '1 / -1' }}><label style={label}>Description</label><textarea value={editInfo.description} onChange={e => setEditInfo({ ...editInfo, description: e.target.value })} rows={3} style={{ ...inputStyle, resize: 'vertical' }} /></div>
                                    <div style={{ gridColumn: '1 / -1' }}>
                                        <label style={label}>Default Payment Account (ICRC-1)</label>
                                        <PrincipalInput
                                            value={editPaymentAccount.principal || publisher.defaultPaymentAccount?.owner?.toText?.() || ''}
                                            onChange={(val) => setEditPaymentAccount(prev => ({ ...prev, principal: val }))}
                                            onAccountChange={({ principal, subaccount }) => setEditPaymentAccount({ principal, subaccount })}
                                            showSubaccountOption={true}
                                            placeholder="Principal or ICRC-1 account"
                                            style={{ maxWidth: '100%' }}
                                        />
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button onClick={handleUpdateInfo} disabled={actionLoading} style={btnSm('#10b981')}>{actionLoading ? <FaSpinner className="fa-spin" /> : <FaSave />} Save</button>
                                    <button onClick={() => setEditInfo(null)} style={btnSm('#ef4444')}><FaTimes /> Cancel</button>
                                </div>
                            </div>
                        ) : (
                            <div style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                                    <div style={{ color: theme.colors.secondaryText, fontSize: 14 }}>{publisher.description}</div>
                                    <button onClick={() => { setEditInfo({ name: publisher.name, description: publisher.description, websiteUrl: publisher.websiteUrl?.length > 0 ? publisher.websiteUrl[0] : '', logoUrl: publisher.logoUrl?.length > 0 ? publisher.logoUrl[0] : '' }); setEditPaymentAccount({ principal: '', subaccount: null }); }} style={btnSm(appPrimary)}><FaEdit /> Edit</button>
                                </div>
                                {publisher.websiteUrl?.length > 0 && <div style={{ color: appPrimary, fontSize: 13 }}>{publisher.websiteUrl[0]}</div>}
                                <div style={{ color: theme.colors.secondaryText, fontSize: 12, marginTop: 8 }}>Payment: <code style={{ fontSize: 10 }}>{accountToDisplay(publisher.defaultPaymentAccount)}</code></div>
                                <div style={{ color: theme.colors.secondaryText, fontSize: 12, marginTop: 4 }}>DAO Cut: {(Number(publisher.daoCutBasisPoints) / 100).toFixed(1)}%</div>
                            </div>
                        )}

                        {/* Owners */}
                        <h3 style={{ color: theme.colors.primaryText, marginTop: 16, marginBottom: 8 }}><FaUsers /> Owners</h3>
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                                {publisher.owners.map(o => (
                                    <span key={o.toText()} style={{ ...pillStyle(appPrimary), fontSize: 10 }}>
                                        {o.toText().substring(0, 16)}...
                                        <FaTimes style={{ cursor: 'pointer', marginLeft: 4 }} onClick={() => handleRemoveOwner(o)} />
                                    </span>
                                ))}
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <input value={newOwner} onChange={e => setNewOwner(e.target.value)} placeholder="Principal to add" style={{ ...inputStyle, maxWidth: 350 }} />
                                <button onClick={handleAddOwner} disabled={!newOwner} style={btnSm('#10b981')}><FaPlus /> Add</button>
                            </div>
                        </div>

                        {/* Families */}
                        <h3 style={{ color: theme.colors.primaryText, marginTop: 16, marginBottom: 8 }}><FaTags /> Family Tags</h3>
                        <div style={cardStyle}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                                {publisher.families.map(f => (
                                    <span key={f} style={pillStyle('#8b5cf6')}>{f} <FaTimes style={{ cursor: 'pointer', marginLeft: 4 }} onClick={() => handleRemoveFamily(f)} /></span>
                                ))}
                                {publisher.families.length === 0 && <span style={{ color: theme.colors.secondaryText, fontSize: 12 }}>No family tags yet</span>}
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <input value={newFamily} onChange={e => setNewFamily(e.target.value)} placeholder="Family tag" style={{ ...inputStyle, maxWidth: 200 }} />
                                <button onClick={handleAddFamily} disabled={!newFamily} style={btnSm('#8b5cf6')}><FaPlus /> Add</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ==================== APPS TAB ==================== */}
                {activeTab === 'apps' && (
                    <div>
                        <h3 style={{ color: theme.colors.primaryText, marginBottom: 12 }}>Your Apps ({apps.length})</h3>
                        {apps.map(app => (
                            <div key={Number(app.numericAppId)} style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ color: theme.colors.primaryText, fontWeight: 600 }}>{app.name}</span>
                                            <code style={{ color: theme.colors.secondaryText, fontSize: 11 }}>{app.appId}</code>
                                            <span style={{ color: theme.colors.secondaryText, fontSize: 10 }}>#{Number(app.numericAppId)}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                                            {app.families.map(f => <span key={f} style={pillStyle('#8b5cf6')}>{f}</span>)}
                                        </div>
                                    </div>
                                    <button onClick={() => handleToggleApp(app)} style={btnSm(app.enabled ? '#10b981' : '#ef4444')}>
                                        {app.enabled ? 'Enabled' : 'Disabled'}
                                    </button>
                                </div>
                                <div style={{ color: theme.colors.secondaryText, fontSize: 13 }}>{app.description}</div>
                                <div style={{ fontSize: 12, color: theme.colors.secondaryText, marginTop: 6 }}>
                                    Price: {(Number(app.mintPriceE8s) / E8S).toFixed(2)} ICP | Premium: {(Number(app.premiumMintPriceE8s) / E8S).toFixed(2)} ICP
                                </div>
                            </div>
                        ))}
                        {apps.length === 0 && <div style={{ color: theme.colors.secondaryText, textAlign: 'center', padding: 30 }}>No apps yet. Ask an admin to add apps for your publisher.</div>}
                    </div>
                )}

                {/* ==================== VERSIONS TAB ==================== */}
                {activeTab === 'versions' && (
                    <div>
                        <div style={{ marginBottom: 16 }}>
                            <label style={label}>Select App</label>
                            <select value={selectedAppId} onChange={e => setSelectedAppId(e.target.value)} style={{ ...inputStyle, maxWidth: 400 }}>
                                {apps.map(a => <option key={a.appId} value={a.appId}>{a.name} ({a.appId})</option>)}
                            </select>
                        </div>

                        <h3 style={{ color: theme.colors.primaryText, marginBottom: 12 }}>Versions ({versions.length})</h3>
                        {versions.map(v => {
                            const vKey = `${Number(v.major)}.${Number(v.minor)}.${Number(v.patch)}`;
                            return (
                                <div key={vKey} style={cardStyle}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ color: theme.colors.primaryText, fontWeight: 600 }}>v{vKey}</span>
                                            {v.hasWasm ? <span style={{ fontSize: 11, background: '#10b98120', color: '#10b981', padding: '2px 8px', borderRadius: 4 }}>WASM ({Number(v.wasmSize).toLocaleString()} bytes)</span>
                                                : <span style={{ fontSize: 11, background: '#f59e0b20', color: '#f59e0b', padding: '2px 8px', borderRadius: 4 }}>No WASM</span>}
                                        </div>
                                        <button onClick={() => handleRemoveVersion(v)} style={btnSm('#ef4444')}><FaTrash /></button>
                                    </div>
                                    {v.releaseNotes && <div style={{ color: theme.colors.secondaryText, fontSize: 12, marginBottom: 6 }}>{v.releaseNotes}</div>}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <input type="file" accept=".wasm" onChange={e => setWasmFile(e.target.files[0])} style={{ fontSize: 12, color: theme.colors.secondaryText }} />
                                        <button onClick={() => handleUploadWasm(v)} disabled={!wasmFile || uploadingWasm === vKey} style={btnSm(appPrimary)}>
                                            {uploadingWasm === vKey ? <FaSpinner className="fa-spin" /> : <FaUpload />} Upload WASM
                                        </button>
                                    </div>
                                </div>
                            );
                        })}

                        <h3 style={{ color: theme.colors.primaryText, marginTop: 24, marginBottom: 12 }}>Add Version</h3>
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
                            <button onClick={handleAddVersion} disabled={actionLoading || !newVersion.major} style={{ marginTop: 12, padding: '10px 20px', borderRadius: 8, background: `linear-gradient(135deg, ${appPrimary}, #22d3ee)`, color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', opacity: actionLoading || !newVersion.major ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                                {actionLoading ? <FaSpinner className="fa-spin" /> : <FaPlus />} Add Version
                            </button>
                        </div>
                    </div>
                )}

                {/* ==================== REVENUE TAB ==================== */}
                {activeTab === 'revenue' && (
                    <div>
                        <h3 style={{ color: theme.colors.primaryText, marginBottom: 12 }}><FaChartBar /> Revenue & Withdrawals</h3>

                        <div style={cardStyle}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                <div>
                                    <div style={{ color: theme.colors.secondaryText, fontSize: 12 }}>Publisher Revenue Balance</div>
                                    <div style={{ color: theme.colors.primaryText, fontSize: 22, fontWeight: 600 }}>{pubBalance !== null ? formatIcp(pubBalance) : '...'} ICP</div>
                                </div>
                                <button onClick={handleWithdrawPublisher} disabled={actionLoading || !pubBalance || Number(pubBalance) === 0} style={{
                                    padding: '10px 20px', borderRadius: 8,
                                    background: `linear-gradient(135deg, ${appPrimary}, #22d3ee)`,
                                    color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    opacity: !pubBalance || Number(pubBalance) === 0 ? 0.5 : 1
                                }}>
                                    {actionLoading ? <FaSpinner className="fa-spin" /> : <FaWallet />} Withdraw
                                </button>
                            </div>

                            {pubStats && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                    <div><div style={{ color: theme.colors.secondaryText, fontSize: 12 }}>Total Revenue</div><div style={{ color: theme.colors.primaryText, fontWeight: 600 }}>{formatIcp(pubStats.totalRevenueE8s)} ICP</div></div>
                                    <div><div style={{ color: theme.colors.secondaryText, fontSize: 12 }}>Total Withdrawn</div><div style={{ color: '#10b981', fontWeight: 600 }}>{formatIcp(pubStats.totalWithdrawnE8s)} ICP</div></div>
                                    <div><div style={{ color: theme.colors.secondaryText, fontSize: 12 }}>Total Mints</div><div style={{ color: appPrimary, fontWeight: 600 }}>{Number(pubStats.totalMintCount)}</div></div>
                                </div>
                            )}
                        </div>

                        {apps.length > 0 && (
                            <>
                                <h3 style={{ color: theme.colors.primaryText, marginTop: 16, marginBottom: 12 }}>Per-App Balances</h3>
                                {apps.map(app => (
                                    <div key={Number(app.numericAppId)} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <div style={{ color: theme.colors.primaryText, fontWeight: 500 }}>{app.name}</div>
                                            <div style={{ color: theme.colors.secondaryText, fontSize: 12 }}>
                                                Balance: {appBalances[Number(app.numericAppId)] !== undefined ? formatIcp(appBalances[Number(app.numericAppId)]) : '...'} ICP
                                            </div>
                                        </div>
                                        <button onClick={() => handleWithdrawApp(app.numericAppId)} disabled={actionLoading || !appBalances[Number(app.numericAppId)] || Number(appBalances[Number(app.numericAppId)]) === 0}
                                            style={btnSm(appPrimary)}>
                                            <FaWallet /> Withdraw
                                        </button>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
