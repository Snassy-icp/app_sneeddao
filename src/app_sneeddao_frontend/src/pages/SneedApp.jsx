import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneedapp';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { FaRocket, FaCubes, FaExternalLinkAlt, FaStore, FaSpinner, FaChevronDown, FaChevronUp, FaPlus, FaEye, FaCog, FaTag } from 'react-icons/fa';

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

const E8S = 100_000_000;

export default function SneedApp() {
    const { theme } = useTheme();
    const { identity, isAuthenticated, login } = useAuth();
    const navigate = useNavigate();

    const [apps, setApps] = useState([]);
    const [wallet, setWallet] = useState([]);
    const [loading, setLoading] = useState(true);
    const [walletExpanded, setWalletExpanded] = useState(true);
    const [mintCounts, setMintCounts] = useState({});

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

    // Load apps (public, no auth needed)
    useEffect(() => {
        const loadApps = async () => {
            try {
                const factory = getAnonFactory();
                const appList = await factory.getApps();
                setApps(appList.filter(a => a.enabled));

                // Load mint counts per app
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

    // Load user wallet
    useEffect(() => {
        if (!isAuthenticated || !identity) { setWallet([]); return; }
        const loadWallet = async () => {
            try {
                const factory = getFactory();
                if (!factory) return;
                const entries = await factory.getMyWallet();
                setWallet(entries);
            } catch (e) {
                console.error('Failed to load wallet:', e);
            }
        };
        loadWallet();
    }, [isAuthenticated, identity, getFactory]);

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

    // Group wallet entries by appId
    const walletByApp = {};
    wallet.forEach(entry => {
        const appId = entry.appId || 'unknown';
        if (!walletByApp[appId]) walletByApp[appId] = [];
        walletByApp[appId].push(entry);
    });

    const getAppInfo = (appId) => apps.find(a => a.appId === appId);

    return (
        <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
            <style>{customStyles}</style>
            <Header />
            <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px 60px' }}>
                {/* Hero */}
                <div className="sneedapp-fade-in" style={{
                    textAlign: 'center', marginBottom: 40, padding: '30px 20px',
                    background: `linear-gradient(135deg, ${appPrimary}15 0%, ${appSecondary}10 100%)`,
                    borderRadius: 16, border: `1px solid ${appPrimary}30`
                }}>
                    <div className="sneedapp-float" style={{ fontSize: 48, marginBottom: 12 }}>
                        <FaStore style={{ color: appPrimary }} />
                    </div>
                    <h1 style={{ color: theme.colors.primaryText, fontSize: 28, fontWeight: 700, margin: 0 }}>
                        Sneedapp
                    </h1>
                    <p style={{ color: theme.colors.secondaryText, fontSize: 15, marginTop: 8, maxWidth: 500, margin: '8px auto 0' }}>
                        Browse and mint canisters from the Sneed app ecosystem
                    </p>
                </div>

                {/* Apps Grid */}
                <h2 style={{ color: theme.colors.primaryText, fontSize: 20, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FaCubes style={{ color: appPrimary }} /> Available Apps
                </h2>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: 40, color: theme.colors.secondaryText }}>
                        <FaSpinner className="fa-spin" style={{ fontSize: 24, marginBottom: 8 }} />
                        <div>Loading apps...</div>
                    </div>
                ) : apps.length === 0 ? (
                    <div style={{
                        textAlign: 'center', padding: 40, color: theme.colors.secondaryText,
                        background: theme.colors.secondaryBg, borderRadius: 12
                    }}>
                        No apps available yet. Check back soon!
                    </div>
                ) : (
                    <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320, 1fr))',
                        gap: 16, marginBottom: 40
                    }}>
                        {apps.map((app, i) => (
                            <div key={app.appId} className="sneedapp-fade-in" style={{
                                animationDelay: `${i * 0.1}s`,
                                background: theme.colors.cardGradient, borderRadius: 12,
                                border: `1px solid ${theme.colors.borderColor || '#333'}`,
                                padding: 20, display: 'flex', flexDirection: 'column', gap: 12,
                                transition: 'transform 0.2s, box-shadow 0.2s',
                                cursor: 'pointer'
                            }}
                                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 24px ${appPrimary}20`; }}
                                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    {app.iconUrl && app.iconUrl.length > 0 ? (
                                        <img src={app.iconUrl[0]} alt="" style={{ width: 40, height: 40, borderRadius: 8 }} />
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
                                        <div style={{ color: theme.colors.secondaryText, fontSize: 12, marginTop: 2 }}>
                                            {mintCounts[app.appId] || 0} minted
                                        </div>
                                    </div>
                                </div>

                                <p style={{ color: theme.colors.secondaryText, fontSize: 13, margin: 0, lineHeight: 1.5, flex: 1 }}>
                                    {app.description}
                                </p>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        background: `${appPrimary}15`, padding: '4px 10px',
                                        borderRadius: 6, fontSize: 13, color: appSecondary
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
                                    background: `linear-gradient(135deg, ${appPrimary}, ${appSecondary})`,
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
                        ))}
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
                                ({wallet.length})
                            </span>
                            {walletExpanded ? <FaChevronUp style={{ color: theme.colors.secondaryText }} /> : <FaChevronDown style={{ color: theme.colors.secondaryText }} />}
                        </div>

                        {walletExpanded && (
                            wallet.length === 0 ? (
                                <div style={{
                                    textAlign: 'center', padding: 30, color: theme.colors.secondaryText,
                                    background: theme.colors.secondaryBg, borderRadius: 12, fontSize: 14
                                }}>
                                    You haven't minted any canisters yet. Browse the apps above to get started!
                                </div>
                            ) : (
                                Object.entries(walletByApp).map(([appId, entries]) => {
                                    const appInfo = getAppInfo(appId);
                                    const appName = appInfo ? appInfo.name : (appId || 'Legacy');
                                    return (
                                        <div key={appId} style={{ marginBottom: 16 }}>
                                            <h3 style={{
                                                color: theme.colors.secondaryText, fontSize: 14,
                                                fontWeight: 600, marginBottom: 8, textTransform: 'uppercase',
                                                letterSpacing: '0.05em'
                                            }}>
                                                {appName} ({entries.length})
                                            </h3>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                {entries.map(entry => {
                                                    const cid = entry.canisterId.toText();
                                                    const viewUrl = appInfo ? getViewUrl(appInfo, cid) : null;
                                                    const manageUrl = appInfo ? getManageUrl(appInfo, cid) : null;
                                                    return (
                                                        <div key={cid} style={{
                                                            display: 'flex', alignItems: 'center', gap: 12,
                                                            background: theme.colors.secondaryBg, padding: '12px 16px',
                                                            borderRadius: 10, border: `1px solid ${theme.colors.borderColor || '#333'}`
                                                        }}>
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
                                                                        background: `${appPrimary}20`, color: appPrimary,
                                                                        fontSize: 12, textDecoration: 'none',
                                                                        display: 'flex', alignItems: 'center', gap: 4
                                                                    }}>
                                                                        <FaEye /> View
                                                                    </Link>
                                                                )}
                                                                {manageUrl && manageUrl !== viewUrl && (
                                                                    <Link to={manageUrl} style={{
                                                                        padding: '6px 10px', borderRadius: 6,
                                                                        background: `${appSecondary}20`, color: appSecondary,
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
