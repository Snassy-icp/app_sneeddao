import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneedapp';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { getCanisterInfo } from '../utils/BackendUtils';
import { uint8ArrayToHex } from '../utils/NeuronUtils';
import { FaRocket, FaCubes, FaExternalLinkAlt, FaStore, FaSpinner, FaChevronDown, FaChevronUp, FaPlus, FaEye, FaCog, FaTag, FaCheckCircle, FaBrain, FaChartLine, FaBox, FaRobot } from 'react-icons/fa';
import BotIcon from '../components/BotIcon';

const customStyles = `
@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-6px); }
}
.sneedapp-fade-in { animation: fadeInUp 0.5s ease-out forwards; }
.sneedapp-float { animation: float 3s ease-in-out infinite; }
`;

const appPrimary = '#06b6d4';
const appSecondary = '#22d3ee';
const appAccent = '#67e8f9';

const BOT_BRANDING = {
    'sneed-icp-staking-bot': { color: '#8b5cf6', secondary: '#a78bfa', gradient: 'linear-gradient(135deg, #8b5cf6, #a78bfa)', type: 'staking' },
    'sneed-trading-bot': { color: '#10b981', secondary: '#34d399', gradient: 'linear-gradient(135deg, #10b981, #34d399)', type: 'trading' },
};

const FAMILY_ICONS = {
    'sneed-bots': <FaRobot size={10} />,
};

const E8S = 100_000_000;

export default function SneedApp() {
    const { theme } = useTheme();
    const { identity, isAuthenticated, login } = useAuth();
    const navigate = useNavigate();

    const [apps, setApps] = useState([]);
    const [publishers, setPublishers] = useState([]);
    const [wallet, setWallet] = useState([]);
    const [loading, setLoading] = useState(true);
    const [walletExpanded, setWalletExpanded] = useState(true);
    const [mintCounts, setMintCounts] = useState({});
    const [selectedFamily, setSelectedFamily] = useState(null);
    const [resolvedWallet, setResolvedWallet] = useState([]);
    const [walletLoading, setWalletLoading] = useState(false);

    const getAgent = useCallback(() => {
        const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
            ? 'https://icp0.io' : 'http://localhost:4943';
        return identity ? new HttpAgent({ identity, host }) : new HttpAgent({ host });
    }, [identity]);

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

    const getAnonFactory = useCallback(() => {
        return createFactoryActor(factoryCanisterId, {
            agentOptions: {
                host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                    ? 'https://icp0.io' : 'http://localhost:4943'
            }
        });
    }, []);

    // Load apps and publishers (public, no auth needed)
    useEffect(() => {
        const loadApps = async () => {
            try {
                const factory = getAnonFactory();
                const [appList, pubList] = await Promise.all([
                    factory.getApps(),
                    factory.getPublishers()
                ]);
                setApps(appList.filter(a => a.enabled));
                setPublishers(pubList);

                const counts = {};
                for (const app of appList) {
                    try {
                        const count = await factory.getMintLogCountForApp(app.appId);
                        counts[app.appId] = Number(count);
                    } catch { counts[app.appId] = 0; }
                }
                setMintCounts(counts);
            } catch (e) {
                console.error('Failed to load apps:', e);
            } finally {
                setLoading(false);
            }
        };
        loadApps();
    }, [getAnonFactory]);

    const pubMap = {};
    publishers.forEach(p => { pubMap[Number(p.publisherId)] = p; });

    const allFamilies = [...new Set(apps.flatMap(a => a.families || []))].sort();

    const filteredApps = selectedFamily
        ? apps.filter(a => (a.families || []).includes(selectedFamily))
        : apps;

    // Load user wallet with WASM-based app type resolution
    useEffect(() => {
        if (!isAuthenticated || !identity) { setWallet([]); setResolvedWallet([]); return; }
        const loadWallet = async () => {
            setWalletLoading(true);
            try {
                const factory = getFactory();
                if (!factory) return;
                const entries = await factory.getMyWallet();
                setWallet(entries);

                // Build WASM hash -> appId map from ALL app versions (including disabled)
                const allApps = await factory.getApps().catch(() => []);
                const hashToAppId = {};
                await Promise.allSettled(allApps.map(async (app) => {
                    try {
                        const versions = await factory.getAppVersions(app.appId);
                        for (const v of (versions || [])) {
                            const wh = Array.isArray(v.wasmHash) ? (v.wasmHash[0] || '') : (v.wasmHash || '');
                            if (wh) hashToAppId[wh.toLowerCase()] = app.appId;
                        }
                    } catch (_) {}
                }));

                // Resolve each canister's app type via module hash
                const resolved = entries.map(e => ({
                    canisterId: e.canisterId,
                    appId: e.appId || '',
                    resolvedAppId: '',
                    moduleHash: null,
                }));
                await Promise.allSettled(resolved.map(async (r) => {
                    try {
                        const result = await getCanisterInfo(identity, r.canisterId);
                        if (result && 'ok' in result) {
                            const hash = result.ok.module_hash[0] ? uint8ArrayToHex(result.ok.module_hash[0]) : null;
                            r.moduleHash = hash;
                            if (hash) {
                                const appMatch = hashToAppId[hash.toLowerCase()];
                                if (appMatch) r.resolvedAppId = appMatch;
                            }
                        }
                    } catch (_) {}
                }));
                setResolvedWallet(resolved);
            } catch (e) {
                console.error('Failed to load wallet:', e);
            } finally {
                setWalletLoading(false);
            }
        };
        loadWallet();
    }, [isAuthenticated, identity, getFactory, apps]);

    const formatIcp = (e8s) => {
        const n = Number(e8s);
        return (n / E8S).toFixed(n % E8S === 0 ? 0 : 2);
    };

    const getMintUrl = (app) => {
        if (app.mintUrl && app.mintUrl.length > 0) {
            return app.mintUrl[0]; // optional Text -> [Text] in Candid
        }
        return `/sneedapp/mint/${app.appId}`;
    };

    const getViewUrl = (app, canisterId) => {
        if (app.viewUrl && app.viewUrl.length > 0) {
            return app.viewUrl[0].replace('CANISTER_ID', canisterId);
        }
        return null;
    };

    const getManageUrl = (app, canisterId) => {
        if (app.manageUrl && app.manageUrl.length > 0) {
            return app.manageUrl[0].replace('CANISTER_ID', canisterId);
        }
        return null;
    };

    // Group wallet entries by WASM-resolved appId
    const walletByApp = {};
    resolvedWallet.forEach(entry => {
        const appId = entry.resolvedAppId || entry.appId || 'unknown';
        if (!walletByApp[appId]) walletByApp[appId] = [];
        walletByApp[appId].push(entry);
    });

    const getAppInfo = (appId) => apps.find(a => a.appId === appId);

    const getCanisterIcon = (resolvedAppId, size = 14) => {
        const branding = BOT_BRANDING[resolvedAppId];
        if (branding) return <BotIcon type={branding.type} size={size} color={branding.color} />;
        return <FaBox size={size} style={{ color: appPrimary }} />;
    };

    return (
        <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
            <style>{customStyles}</style>
            <Header />

            {/* Hero Section */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${appPrimary}15 50%, ${appSecondary}10 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2rem 1.5rem',
                position: 'relative',
                overflow: 'hidden'
            }}>
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    right: '-10%',
                    width: '400px',
                    height: '400px',
                    background: `radial-gradient(circle, ${appPrimary}20 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${appSecondary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />

                <div style={{ maxWidth: '1100px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                        <div className="sneedapp-float" style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '16px',
                            background: `linear-gradient(135deg, ${appPrimary}, ${appSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 8px 32px ${appPrimary}50`,
                            flexShrink: 0,
                        }}>
                            <FaStore style={{ color: '#fff', fontSize: '1.6rem' }} />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <h1 style={{
                                fontSize: '1.5rem',
                                fontWeight: '700',
                                color: theme.colors.primaryText,
                                margin: 0,
                                letterSpacing: '-0.5px'
                            }}>
                                Sneedapp
                            </h1>
                            <p style={{
                                color: theme.colors.secondaryText,
                                fontSize: '0.9rem',
                                margin: '4px 0 0 0',
                                lineHeight: '1.5'
                            }}>
                                Browse and mint canisters from the Sneed app ecosystem
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px 60px' }}>

                {/* Apps Grid */}
                <h2 style={{ color: theme.colors.primaryText, fontSize: 20, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FaStore style={{ color: appPrimary }} /> Available Apps
                </h2>

                {allFamilies.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                        <button onClick={() => setSelectedFamily(null)} style={{
                            padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                            background: !selectedFamily ? appPrimary : `${appPrimary}15`,
                            color: !selectedFamily ? '#fff' : appPrimary
                        }}>All</button>
                        {allFamilies.map(f => (
                            <button key={f} onClick={() => setSelectedFamily(f === selectedFamily ? null : f)} style={{
                                padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                                background: selectedFamily === f ? '#8b5cf6' : '#8b5cf615',
                                color: selectedFamily === f ? '#fff' : '#8b5cf6',
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}>
                                {FAMILY_ICONS[f]}
                                {f}
                            </button>
                        ))}
                    </div>
                )}

                {loading ? (
                    <div style={{ textAlign: 'center', padding: 40, color: theme.colors.secondaryText }}>
                        <FaSpinner className="fa-spin" style={{ fontSize: 24, marginBottom: 8 }} />
                        <div>Loading apps...</div>
                    </div>
                ) : filteredApps.length === 0 ? (
                    <div style={{
                        textAlign: 'center', padding: 40, color: theme.colors.secondaryText,
                        background: theme.colors.secondaryBg, borderRadius: 12
                    }}>
                        {selectedFamily ? 'No apps with this family tag.' : 'No apps available yet. Check back soon!'}
                    </div>
                ) : (
                    <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                        gap: 16, marginBottom: 40
                    }}>
                        {filteredApps.map((app, i) => {
                            const branding = BOT_BRANDING[app.appId];
                            const cardColor = branding?.color || appPrimary;
                            const cardSecondary = branding?.secondary || appSecondary;
                            const cardGradient = branding?.gradient || `linear-gradient(135deg, ${appPrimary}, ${appSecondary})`;

                            return (
                            <div key={app.appId} className="sneedapp-fade-in" style={{
                                animationDelay: `${i * 0.1}s`,
                                background: theme.colors.cardGradient, borderRadius: 12,
                                border: `1px solid ${branding ? `${cardColor}30` : (theme.colors.borderColor || '#333')}`,
                                padding: 20, display: 'flex', flexDirection: 'column', gap: 12,
                                transition: 'transform 0.2s, box-shadow 0.2s',
                                cursor: 'pointer'
                            }}
                                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 24px ${cardColor}20`; }}
                                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    {app.iconUrl && app.iconUrl.length > 0 ? (
                                        <img src={app.iconUrl[0]} alt="" style={{ width: 40, height: 40, borderRadius: 8 }} />
                                    ) : branding ? (
                                        <div style={{
                                            width: 40, height: 40, borderRadius: 8,
                                            background: cardGradient,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}>
                                            <BotIcon type={branding.type} size={22} color="#fff" />
                                        </div>
                                    ) : (
                                        <div style={{
                                            width: 40, height: 40, borderRadius: 8,
                                            background: `linear-gradient(135deg, ${appPrimary}, ${appSecondary})`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: '#fff', fontWeight: 700, fontSize: 18
                                        }}>
                                            {app.name.charAt(0)}
                                        </div>
                                    )}
                                    <div style={{ flex: 1 }}>
                                        <div style={{ color: theme.colors.primaryText, fontWeight: 600, fontSize: 16 }}>
                                            {app.name}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                            {(() => {
                                                const pub = pubMap[Number(app.publisherId)];
                                                return pub ? (
                                                    <span style={{ color: theme.colors.secondaryText, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        {pub.name}
                                                        {pub.verified && <FaCheckCircle style={{ color: '#10b981', fontSize: 10 }} />}
                                                    </span>
                                                ) : null;
                                            })()}
                                            <span style={{ color: theme.colors.secondaryText, fontSize: 12 }}>
                                                {mintCounts[app.appId] || 0} minted
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {(app.families || []).length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                        {app.families.map(f => (
                                            <span key={f} style={{
                                                padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 500,
                                                background: f === 'sneed-bots' ? `${cardColor}15` : '#8b5cf615',
                                                color: f === 'sneed-bots' ? cardColor : '#8b5cf6',
                                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                            }}>
                                                {FAMILY_ICONS[f]}
                                                {f}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <p style={{ color: theme.colors.secondaryText, fontSize: 13, margin: 0, lineHeight: 1.5, flex: 1 }}>
                                    {app.description}
                                </p>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        background: `${cardColor}15`, padding: '4px 10px',
                                        borderRadius: 6, fontSize: 13, color: cardSecondary
                                    }}>
                                        <FaTag style={{ fontSize: 10 }} />
                                        {formatIcp(app.mintPriceE8s)} ICP
                                    </div>
                                    {Number(app.premiumMintPriceE8s) < Number(app.mintPriceE8s) && (
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: 4,
                                            background: '#f59e0b15', padding: '4px 10px',
                                            borderRadius: 6, fontSize: 12, color: '#f59e0b'
                                        }}>
                                            Premium: {formatIcp(app.premiumMintPriceE8s)} ICP
                                        </div>
                                    )}
                                </div>

                                <button onClick={() => {
                                    if (!isAuthenticated) { login(); return; }
                                    navigate(getMintUrl(app));
                                }} style={{
                                    width: '100%', padding: '10px 16px', borderRadius: 8,
                                    background: cardGradient,
                                    color: '#fff', border: 'none', fontWeight: 600, fontSize: 14,
                                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', gap: 8, transition: 'opacity 0.2s'
                                }}
                                    onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                                >
                                    <FaRocket /> Mint Canister
                                </button>
                            </div>
                            );
                        })}
                    </div>
                )}

                {/* My Canisters */}
                {isAuthenticated && (
                    <div style={{ marginTop: 20 }}>
                        <div onClick={() => setWalletExpanded(!walletExpanded)} style={{
                            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                            marginBottom: 12
                        }}>
                            <h2 style={{ color: theme.colors.primaryText, fontSize: 20, fontWeight: 600, margin: 0 }}>
                                My Canisters
                            </h2>
                            <span style={{ color: theme.colors.secondaryText, fontSize: 13 }}>
                                ({resolvedWallet.length})
                            </span>
                            {walletExpanded ? <FaChevronUp style={{ color: theme.colors.secondaryText }} /> : <FaChevronDown style={{ color: theme.colors.secondaryText }} />}
                        </div>

                        {walletExpanded && (
                            walletLoading ? (
                                <div style={{ textAlign: 'center', padding: 30, color: theme.colors.secondaryText }}>
                                    <FaSpinner className="fa-spin" style={{ fontSize: 18, marginBottom: 6 }} />
                                    <div style={{ fontSize: 13 }}>Identifying canisters...</div>
                                </div>
                            ) : resolvedWallet.length === 0 ? (
                                <div style={{
                                    textAlign: 'center', padding: 30, color: theme.colors.secondaryText,
                                    background: theme.colors.secondaryBg, borderRadius: 12, fontSize: 14
                                }}>
                                    You haven't minted any canisters yet. Browse the apps above to get started!
                                </div>
                            ) : (
                                Object.entries(walletByApp).map(([appId, entries]) => {
                                    const appInfo = getAppInfo(appId);
                                    const appName = appInfo ? appInfo.name : (appId === 'unknown' ? 'Unknown' : appId);
                                    const branding = BOT_BRANDING[appId];
                                    const sectionColor = branding?.color || appPrimary;
                                    const sectionSecondary = branding?.secondary || appSecondary;
                                    return (
                                        <div key={appId} style={{ marginBottom: 16 }}>
                                            <h3 style={{
                                                color: sectionColor, fontSize: 14,
                                                fontWeight: 600, marginBottom: 8, textTransform: 'uppercase',
                                                letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6
                                            }}>
                                                {getCanisterIcon(appId, 16)} {appName} ({entries.length})
                                            </h3>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                {entries.map(entry => {
                                                    const cid = typeof entry.canisterId === 'string' ? entry.canisterId : entry.canisterId.toText();
                                                    const resolvedId = entry.resolvedAppId || appId;
                                                    const info = getAppInfo(resolvedId);
                                                    const viewUrl = info ? getViewUrl(info, cid) : null;
                                                    const manageUrl = info ? getManageUrl(info, cid) : null;
                                                    const rowBranding = BOT_BRANDING[resolvedId];
                                                    const rowColor = rowBranding?.color || appPrimary;
                                                    const rowSecondary = rowBranding?.secondary || appSecondary;
                                                    return (
                                                        <div key={cid} style={{
                                                            display: 'flex', alignItems: 'center', gap: 12,
                                                            background: theme.colors.secondaryBg, padding: '12px 16px',
                                                            borderRadius: 10,
                                                            border: `1px solid ${rowBranding ? `${rowColor}20` : (theme.colors.borderColor || '#333')}`,
                                                        }}>
                                                            {getCanisterIcon(resolvedId)}
                                                            <code style={{
                                                                color: theme.colors.primaryText, fontSize: 13,
                                                                flex: 1, wordBreak: 'break-all'
                                                            }}>
                                                                {cid}
                                                            </code>
                                                            <div style={{ display: 'flex', gap: 6 }}>
                                                                {viewUrl && (
                                                                    <Link to={viewUrl} style={{
                                                                        padding: '6px 10px', borderRadius: 6,
                                                                        background: `${rowColor}20`, color: rowColor,
                                                                        fontSize: 12, textDecoration: 'none',
                                                                        display: 'flex', alignItems: 'center', gap: 4
                                                                    }}>
                                                                        <FaEye /> View
                                                                    </Link>
                                                                )}
                                                                {manageUrl && manageUrl !== viewUrl && (
                                                                    <Link to={manageUrl} style={{
                                                                        padding: '6px 10px', borderRadius: 6,
                                                                        background: `${rowSecondary}20`, color: rowSecondary,
                                                                        fontSize: 12, textDecoration: 'none',
                                                                        display: 'flex', alignItems: 'center', gap: 4
                                                                    }}>
                                                                        <FaCog /> Manage
                                                                    </Link>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })
                            )
                        )}
                    </div>
                )}

                {!isAuthenticated && (
                    <div style={{
                        textAlign: 'center', padding: 30, marginTop: 20,
                        background: theme.colors.secondaryBg, borderRadius: 12,
                        border: `1px solid ${theme.colors.borderColor || '#333'}`
                    }}>
                        <p style={{ color: theme.colors.secondaryText, margin: '0 0 12px' }}>
                            Connect your wallet to see your canisters and mint new ones
                        </p>
                        <button onClick={login} style={{
                            padding: '10px 24px', borderRadius: 8,
                            background: `linear-gradient(135deg, ${appPrimary}, ${appSecondary})`,
                            color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer'
                        }}>
                            Connect Wallet
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
