import React, { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneedapp';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import BotIcon from '../components/BotIcon';
import {
    FaRocket, FaStore, FaSpinner, FaCheckCircle, FaTag,
    FaArrowLeft, FaHistory, FaBook, FaExternalLinkAlt,
    FaChartLine, FaBrain, FaRobot, FaShieldAlt, FaCogs,
    FaNetworkWired, FaCoins, FaKey, FaStar, FaCrown,
    FaLightbulb, FaPlay, FaCode, FaBolt, FaQuestionCircle,
    FaChevronDown, FaChevronUp, FaLock, FaGlobeAmericas, FaTrophy
} from 'react-icons/fa';

const customStyles = `
@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}
@keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}
@keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 20px rgba(var(--glow-rgb), 0.15); }
    50% { box-shadow: 0 0 40px rgba(var(--glow-rgb), 0.3); }
}
.detail-fade-in { animation: fadeInUp 0.5s ease-out forwards; }
.detail-fade-in-1 { animation: fadeInUp 0.5s ease-out 0.1s forwards; opacity: 0; }
.detail-fade-in-2 { animation: fadeInUp 0.5s ease-out 0.2s forwards; opacity: 0; }
.detail-fade-in-3 { animation: fadeInUp 0.5s ease-out 0.3s forwards; opacity: 0; }
.detail-fade-in-4 { animation: fadeInUp 0.5s ease-out 0.4s forwards; opacity: 0; }
.detail-float { animation: float 4s ease-in-out infinite; }
`;

const E8S = 100_000_000;

const APP_CONTENT = {
    'sneed-icp-staking-bot': {
        tagline: 'Your autonomous ICP neuron manager on the Internet Computer',
        color: '#8b5cf6',
        secondary: '#a78bfa',
        gradient: 'linear-gradient(135deg, #8b5cf6, #a78bfa)',
        glowRgb: '139, 92, 246',
        type: 'staking',
        helpUrl: '/help/icp-neuron-manager',
        heroDescription: 'The ICP Staking Bot is a fully autonomous canister that manages your ICP neurons — staking, splitting, spawning maturity, voting, and distributing rewards — all without you lifting a finger. Your own personal neuron management infrastructure, running 24/7 on-chain.',
        features: [
            { icon: FaBrain, title: 'Autonomous Neuron Management', desc: 'Automatically manages your ICP neurons with configurable staking strategies' },
            { icon: FaCoins, title: 'Maturity Spawning & Staking', desc: 'Spawns maturity and restakes rewards to compound your earnings over time' },
            { icon: FaNetworkWired, title: 'NNS Voting', desc: 'Votes on NNS proposals following configured followees to maximize voting rewards' },
            { icon: FaShieldAlt, title: 'Secure & Decentralized', desc: 'Runs as your own canister on the Internet Computer — you control the keys' },
            { icon: FaCogs, title: 'Distribution Engine', desc: 'Automatically distributes staking rewards to configured accounts and targets' },
            { icon: FaKey, title: 'Hotkey Management', desc: 'Manages hotkeys for your neurons to enable automated operations securely' },
        ],
        highlights: [
            'Fully on-chain, no centralized servers',
            'Configure once, runs autonomously 24/7',
            'Compound staking rewards automatically',
            'Manage multiple neurons from one bot',
            'Built-in chore engine for scheduled tasks',
            'Premium members get discounted minting',
        ],
    },
    'sneed-trading-bot': {
        tagline: 'The world\'s first 100% on-chain, fully non-custodial trading engine',
        color: '#10b981',
        secondary: '#34d399',
        gradient: 'linear-gradient(135deg, #10b981, #34d399)',
        glowRgb: '16, 185, 129',
        type: 'trading',
        helpUrl: '/help/trading_bot',
        heroDescription: 'The Sneed Trading Bot is a fully non-custodial, 100% on-chain trading engine. When you mint one, you get your own canister smart contract — and you alone control it. Your funds never leave your custody: no third party, no intermediary, no operator can access or move your tokens. Define strategies using a powerful DSL, set conditions for buying and selling, and let the bot execute trades autonomously on ICP decentralized exchanges.',
        splash: {
            title: 'A world first in DeFi',
            subtitle: 'The first 100% on-chain, fully non-custodial trading engine — ever.',
            description: 'Unlike every other trading bot on the market, the Sneed Trading Bot is not a service that holds your funds. It is your own smart contract, running on the Internet Computer blockchain. You hold the keys. Nobody else — not Sneed DAO, not any operator, not any server — can touch your funds or override your strategies. This is trustless automation in its purest form.',
            points: [
                { icon: FaLock, text: 'Fully non-custodial — your canister, your keys, your funds' },
                { icon: FaGlobeAmericas, text: '100% on-chain — no servers, no centralized infrastructure' },
                { icon: FaShieldAlt, text: 'No third party can access, freeze, or move your tokens' },
                { icon: FaTrophy, text: 'The first trading engine in the world with these properties' },
            ],
        },
        features: [
            { icon: FaLock, title: 'Fully Non-Custodial', desc: 'Your funds stay in your canister at all times. No third party — not even Sneed DAO — can access, freeze, or move your tokens.' },
            { icon: FaChartLine, title: 'Automated Trading', desc: 'Execute buy and sell orders automatically based on your configured strategies, around the clock.' },
            { icon: FaCode, title: 'Powerful Strategy DSL', desc: 'Define complex trading strategies with a domain-specific language for maximum flexibility.' },
            { icon: FaBolt, title: 'DEX Integration', desc: 'Trades directly on ICP decentralized exchanges — fully on-chain, no intermediaries.' },
            { icon: FaKey, title: 'You Hold the Keys', desc: 'You are the sole controller of your canister. Nobody else can execute trades, change settings, or withdraw funds.' },
            { icon: FaRobot, title: 'Chore Engine', desc: 'Built-in scheduling engine executes your strategies on configurable intervals, autonomously.' },
        ],
        highlights: [
            '100% non-custodial — you never give up control of your funds',
            'Fully on-chain — no centralized servers or exchanges',
            'You are the sole controller of your canister',
            'No operator, admin, or third party can access your tokens',
            'Powerful DSL for custom strategies: DCA, grid, and more',
            'Event logs for full transparency on every action',
        ],
    },
};

export default function SneedAppDetail() {
    const { appId } = useParams();
    const { theme } = useTheme();
    const { identity, isAuthenticated, login } = useAuth();
    const navigate = useNavigate();

    const [app, setApp] = useState(null);
    const [publisher, setPublisher] = useState(null);
    const [versions, setVersions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [mintCount, setMintCount] = useState(0);
    const [versionsExpanded, setVersionsExpanded] = useState(false);

    const getAnonFactory = useCallback(() => {
        return createFactoryActor(factoryCanisterId, {
            agentOptions: {
                host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                    ? 'https://icp0.io' : 'http://localhost:4943'
            }
        });
    }, []);

    useEffect(() => {
        const load = async () => {
            try {
                const factory = getAnonFactory();
                const [appList, pubList] = await Promise.all([
                    factory.getApps(),
                    factory.getPublishers()
                ]);
                const found = appList.find(a => a.appId === appId);
                if (!found) { setError('App not found'); setLoading(false); return; }
                setApp(found);

                const pub = pubList.find(p => Number(p.publisherId) === Number(found.publisherId));
                if (pub) setPublisher(pub);

                const [versionList, count] = await Promise.all([
                    factory.getAppVersions(appId),
                    factory.getMintLogCountForApp(appId).catch(() => 0n)
                ]);
                setVersions(versionList);
                setMintCount(Number(count));
            } catch (e) {
                setError('Failed to load app: ' + e.message);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [appId, getAnonFactory]);

    const formatIcp = (e8s) => {
        const n = Number(e8s);
        return (n / E8S).toFixed(n % E8S === 0 ? 0 : 2);
    };

    const getMintUrl = (a) => {
        if (a.mintUrl && a.mintUrl.length > 0) return a.mintUrl[0];
        return `/sneedapp/mint/${a.appId}`;
    };

    const content = APP_CONTENT[appId] || null;
    const accentColor = content?.color || '#06b6d4';
    const accentSecondary = content?.secondary || '#22d3ee';
    const accentGradient = content?.gradient || `linear-gradient(135deg, #06b6d4, #22d3ee)`;
    const botType = content?.type || null;

    if (loading) {
        return (
            <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
                <Header />
                <div style={{ textAlign: 'center', padding: 80, color: theme.colors.secondaryText }}>
                    <FaSpinner className="fa-spin" style={{ fontSize: 28 }} />
                    <div style={{ marginTop: 12, fontSize: 14 }}>Loading app details...</div>
                </div>
            </div>
        );
    }

    if (error || !app) {
        return (
            <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
                <Header />
                <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 16px', textAlign: 'center' }}>
                    <FaQuestionCircle style={{ fontSize: 48, color: theme.colors.secondaryText, marginBottom: 16 }} />
                    <h2 style={{ color: theme.colors.primaryText, margin: '0 0 8px' }}>App Not Found</h2>
                    <p style={{ color: theme.colors.secondaryText }}>{error || 'This app does not exist.'}</p>
                    <Link to="/sneedapp" style={{ color: accentColor, textDecoration: 'none', fontWeight: 500 }}>
                        <FaArrowLeft style={{ marginRight: 6 }} /> Back to Sneedapp
                    </Link>
                </div>
            </div>
        );
    }

    const latestVersion = versions.find(v => v.hasWasm) || versions[0];

    return (
        <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
            <style>{customStyles}</style>
            <Header />

            {/* Hero Section */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${accentColor}12 40%, ${accentSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                position: 'relative',
                overflow: 'hidden',
            }}>
                {/* Decorative blobs */}
                <div style={{
                    position: 'absolute', top: '-40%', right: '-5%',
                    width: '500px', height: '500px',
                    background: `radial-gradient(circle, ${accentColor}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute', bottom: '-50%', left: '10%',
                    width: '400px', height: '400px',
                    background: `radial-gradient(circle, ${accentSecondary}10 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />

                <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1.5rem 1.25rem 2rem', position: 'relative', zIndex: 1 }}>
                    {/* Breadcrumb */}
                    <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <Link to="/sneedapp" style={{ color: theme.colors.secondaryText, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <FaArrowLeft style={{ fontSize: 11 }} /> Sneedapp
                        </Link>
                        <span style={{ color: theme.colors.secondaryText }}>/</span>
                        <span style={{ color: accentColor, fontWeight: 500 }}>{app.name}</span>
                    </div>

                    <div className="detail-fade-in" style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        {/* App Icon */}
                        <div className="detail-float" style={{
                            width: 80, height: 80, borderRadius: 20,
                            background: accentGradient,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: `0 12px 40px ${accentColor}40`,
                            flexShrink: 0,
                        }}>
                            {app.iconUrl && app.iconUrl.length > 0 ? (
                                <img src={app.iconUrl[0]} alt="" style={{ width: 60, height: 60, borderRadius: 12 }} />
                            ) : botType ? (
                                <BotIcon type={botType} size={42} color="#fff" />
                            ) : (
                                <FaStore style={{ color: '#fff', fontSize: 36 }} />
                            )}
                        </div>

                        {/* Title & meta */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <h1 style={{
                                fontSize: '1.75rem', fontWeight: 800,
                                color: theme.colors.primaryText,
                                margin: '0 0 6px', letterSpacing: '-0.5px',
                                lineHeight: 1.2,
                            }}>
                                {app.name}
                            </h1>

                            {content?.tagline && (
                                <p style={{
                                    color: accentColor, fontSize: '1rem',
                                    fontWeight: 500, margin: '0 0 10px',
                                    lineHeight: 1.4,
                                }}>
                                    {content.tagline}
                                </p>
                            )}

                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
                                {publisher && (
                                    <Link to={`/sneedapp/publisher/${publisher.publisherId}`} style={{
                                        color: theme.colors.secondaryText, textDecoration: 'none',
                                        display: 'flex', alignItems: 'center', gap: 4,
                                    }}>
                                        by <strong style={{ color: theme.colors.primaryText }}>{publisher.name}</strong>
                                        {publisher.verified && <FaCheckCircle style={{ color: '#10b981', fontSize: 11 }} />}
                                    </Link>
                                )}
                                <span style={{ color: theme.colors.mutedText }}>|</span>
                                <span style={{ color: theme.colors.secondaryText }}>
                                    {mintCount} minted
                                </span>
                                {latestVersion && (
                                    <>
                                        <span style={{ color: theme.colors.mutedText }}>|</span>
                                        <span style={{
                                            padding: '2px 8px', borderRadius: 6,
                                            background: `${accentColor}15`, color: accentColor,
                                            fontWeight: 600, fontSize: 12,
                                        }}>
                                            v{Number(latestVersion.major)}.{Number(latestVersion.minor)}.{Number(latestVersion.patch)}
                                        </span>
                                    </>
                                )}
                            </div>

                            {/* Price + CTA row */}
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 16, marginTop: 16, flexWrap: 'wrap'
                            }}>
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    background: `${accentColor}15`, padding: '6px 14px',
                                    borderRadius: 8, fontSize: 14, color: accentSecondary, fontWeight: 600,
                                }}>
                                    <FaTag style={{ fontSize: 11 }} />
                                    {formatIcp(app.mintPriceE8s)} ICP
                                </div>
                                {Number(app.premiumMintPriceE8s) < Number(app.mintPriceE8s) && (
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        background: '#f59e0b15', padding: '6px 14px',
                                        borderRadius: 8, fontSize: 13, color: '#f59e0b',
                                    }}>
                                        <FaCrown style={{ fontSize: 11 }} />
                                        Premium: {formatIcp(app.premiumMintPriceE8s)} ICP
                                    </div>
                                )}
                                <button onClick={() => {
                                    if (!isAuthenticated) { login(); return; }
                                    navigate(getMintUrl(app));
                                }} style={{
                                    padding: '10px 28px', borderRadius: 10,
                                    background: accentGradient,
                                    color: '#fff', border: 'none', fontWeight: 700, fontSize: 15,
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                                    boxShadow: `0 4px 20px ${accentColor}40`,
                                    transition: 'transform 0.2s, box-shadow 0.2s',
                                }}
                                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = `0 6px 28px ${accentColor}50`; }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = `0 4px 20px ${accentColor}40`; }}
                                >
                                    <FaRocket /> Mint Now
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main content */}
            <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 1.25rem 80px' }}>

                {/* About Section */}
                <div className="detail-fade-in-1" style={{
                    background: theme.colors.cardGradient,
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: 16, padding: '1.5rem', marginBottom: 20,
                    boxShadow: theme.colors.cardShadow,
                }}>
                    <h2 style={{
                        fontSize: '1.15rem', fontWeight: 700,
                        color: theme.colors.primaryText, margin: '0 0 12px',
                        display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                        <FaLightbulb style={{ color: accentColor }} /> About
                    </h2>
                    <p style={{
                        color: theme.colors.secondaryText, fontSize: 14,
                        lineHeight: 1.7, margin: 0,
                    }}>
                        {content?.heroDescription || app.description}
                    </p>

                    {content?.helpUrl && (
                        <Link to={content.helpUrl} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            marginTop: 14, color: accentColor, textDecoration: 'none',
                            fontSize: 14, fontWeight: 500,
                        }}>
                            <FaBook style={{ fontSize: 12 }} /> Read the full guide <FaExternalLinkAlt style={{ fontSize: 10 }} />
                        </Link>
                    )}
                </div>

                {/* Splash Banner (world-first callout) */}
                {content?.splash && (
                    <div className="detail-fade-in-2" style={{
                        borderRadius: 16, padding: '2rem 1.5rem', marginBottom: 20,
                        background: `linear-gradient(135deg, ${accentColor}12 0%, ${accentSecondary}08 50%, ${accentColor}06 100%)`,
                        border: `1px solid ${accentColor}25`,
                        position: 'relative', overflow: 'hidden',
                    }}>
                        <div style={{
                            position: 'absolute', top: '-30%', right: '-5%',
                            width: '300px', height: '300px',
                            background: `radial-gradient(circle, ${accentColor}12 0%, transparent 70%)`,
                            pointerEvents: 'none',
                        }} />
                        <div style={{ position: 'relative', zIndex: 1 }}>
                            <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                background: `${accentColor}20`, padding: '4px 12px',
                                borderRadius: 20, marginBottom: 12,
                                fontSize: 12, fontWeight: 700, color: accentColor,
                                textTransform: 'uppercase', letterSpacing: '0.06em',
                            }}>
                                <FaTrophy style={{ fontSize: 11 }} /> World First
                            </div>
                            <h2 style={{
                                fontSize: '1.4rem', fontWeight: 800,
                                color: theme.colors.primaryText, margin: '0 0 6px',
                                lineHeight: 1.3,
                            }}>
                                {content.splash.title}
                            </h2>
                            <p style={{
                                color: accentColor, fontSize: '1.05rem',
                                fontWeight: 600, margin: '0 0 14px',
                            }}>
                                {content.splash.subtitle}
                            </p>
                            <p style={{
                                color: theme.colors.secondaryText, fontSize: 14,
                                lineHeight: 1.7, margin: '0 0 20px', maxWidth: 700,
                            }}>
                                {content.splash.description}
                            </p>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                                gap: 10,
                            }}>
                                {content.splash.points.map((p, i) => (
                                    <div key={i} style={{
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        padding: '10px 14px', borderRadius: 10,
                                        background: `${accentColor}08`,
                                        border: `1px solid ${accentColor}15`,
                                    }}>
                                        <div style={{
                                            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                                            background: `${accentColor}18`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}>
                                            <p.icon style={{ color: accentColor, fontSize: 14 }} />
                                        </div>
                                        <span style={{
                                            color: theme.colors.primaryText, fontSize: 13,
                                            fontWeight: 500, lineHeight: 1.4,
                                        }}>
                                            {p.text}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Features Grid */}
                {content?.features && (
                    <div className="detail-fade-in-2" style={{ marginBottom: 20 }}>
                        <h2 style={{
                            fontSize: '1.15rem', fontWeight: 700,
                            color: theme.colors.primaryText, margin: '0 0 16px',
                            display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                            <FaStar style={{ color: accentColor }} /> Key Features
                        </h2>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                            gap: 12,
                        }}>
                            {content.features.map((f, i) => (
                                <div key={i} style={{
                                    background: theme.colors.cardGradient,
                                    border: `1px solid ${theme.colors.border}`,
                                    borderRadius: 14, padding: '1.25rem',
                                    display: 'flex', gap: 14, alignItems: 'flex-start',
                                    transition: 'transform 0.2s, border-color 0.2s',
                                    cursor: 'default',
                                }}
                                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = `${accentColor}40`; }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.borderColor = theme.colors.border; }}
                                >
                                    <div style={{
                                        width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                                        background: `linear-gradient(135deg, ${accentColor}20, ${accentColor}08)`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <f.icon style={{ color: accentColor, fontSize: 18 }} />
                                    </div>
                                    <div>
                                        <div style={{
                                            color: theme.colors.primaryText, fontWeight: 600,
                                            fontSize: 14, marginBottom: 4,
                                        }}>
                                            {f.title}
                                        </div>
                                        <div style={{
                                            color: theme.colors.secondaryText, fontSize: 13,
                                            lineHeight: 1.5,
                                        }}>
                                            {f.desc}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Highlights */}
                {content?.highlights && (
                    <div className="detail-fade-in-3" style={{
                        background: `linear-gradient(135deg, ${accentColor}08, ${accentSecondary}05)`,
                        border: `1px solid ${accentColor}20`,
                        borderRadius: 16, padding: '1.5rem', marginBottom: 20,
                    }}>
                        <h2 style={{
                            fontSize: '1.15rem', fontWeight: 700,
                            color: theme.colors.primaryText, margin: '0 0 14px',
                            display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                            <FaPlay style={{ color: accentColor, fontSize: 14 }} /> Why choose this bot?
                        </h2>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                            gap: 10,
                        }}>
                            {content.highlights.map((h, i) => (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '8px 0', fontSize: 14,
                                }}>
                                    <FaCheckCircle style={{ color: accentColor, fontSize: 14, flexShrink: 0 }} />
                                    <span style={{ color: theme.colors.primaryText }}>{h}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Version History */}
                <div className="detail-fade-in-4" style={{
                    background: theme.colors.cardGradient,
                    border: `1px solid ${theme.colors.border}`,
                    borderRadius: 16, padding: '1.5rem', marginBottom: 20,
                    boxShadow: theme.colors.cardShadow,
                }}>
                    <div
                        onClick={() => setVersionsExpanded(!versionsExpanded)}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            cursor: 'pointer',
                        }}
                    >
                        <h2 style={{
                            fontSize: '1.15rem', fontWeight: 700,
                            color: theme.colors.primaryText, margin: 0,
                            display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                            <FaHistory style={{ color: accentColor }} /> Version History
                            <span style={{
                                fontSize: 12, fontWeight: 500,
                                color: theme.colors.secondaryText,
                                background: theme.colors.secondaryBg,
                                padding: '2px 8px', borderRadius: 8,
                            }}>
                                {versions.length} release{versions.length !== 1 ? 's' : ''}
                            </span>
                        </h2>
                        {versionsExpanded
                            ? <FaChevronUp style={{ color: theme.colors.secondaryText }} />
                            : <FaChevronDown style={{ color: theme.colors.secondaryText }} />
                        }
                    </div>

                    {/* Always show latest version */}
                    {latestVersion && !versionsExpanded && (
                        <div style={{ marginTop: 16 }}>
                            <VersionCard
                                v={latestVersion}
                                isLatest={true}
                                accentColor={accentColor}
                                theme={theme}
                            />
                        </div>
                    )}

                    {/* Expanded: show all */}
                    {versionsExpanded && (
                        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {versions.map((v, i) => (
                                <VersionCard
                                    key={`${v.major}.${v.minor}.${v.patch}`}
                                    v={v}
                                    isLatest={i === 0 && v.hasWasm}
                                    accentColor={accentColor}
                                    theme={theme}
                                />
                            ))}
                            {versions.length === 0 && (
                                <p style={{ color: theme.colors.secondaryText, fontSize: 14 }}>
                                    No versions published yet.
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Bottom CTA */}
                <div style={{
                    background: accentGradient,
                    borderRadius: 16, padding: '2rem',
                    textAlign: 'center', position: 'relative',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.08) 0%, transparent 70%)',
                        pointerEvents: 'none',
                    }} />
                    <div style={{ position: 'relative', zIndex: 1 }}>
                        <h2 style={{
                            color: '#fff', fontSize: '1.35rem', fontWeight: 700,
                            margin: '0 0 8px',
                        }}>
                            Ready to get started?
                        </h2>
                        <p style={{
                            color: 'rgba(255,255,255,0.85)', fontSize: 14,
                            margin: '0 0 20px', lineHeight: 1.5,
                        }}>
                            Mint your own {app.name} canister and take full control.
                        </p>
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                            <button onClick={() => {
                                if (!isAuthenticated) { login(); return; }
                                navigate(getMintUrl(app));
                            }} style={{
                                padding: '12px 32px', borderRadius: 10,
                                background: 'rgba(255,255,255,0.2)',
                                backdropFilter: 'blur(10px)',
                                color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
                                fontWeight: 700, fontSize: 15, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 8,
                                transition: 'background 0.2s',
                            }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
                            >
                                <FaRocket /> Mint for {formatIcp(app.mintPriceE8s)} ICP
                            </button>
                            {content?.helpUrl && (
                                <Link to={content.helpUrl} style={{
                                    padding: '12px 24px', borderRadius: 10,
                                    background: 'transparent',
                                    color: 'rgba(255,255,255,0.9)',
                                    border: '1px solid rgba(255,255,255,0.25)',
                                    fontWeight: 500, fontSize: 14,
                                    textDecoration: 'none',
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    transition: 'background 0.2s',
                                }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                >
                                    <FaBook /> Learn More
                                </Link>
                            )}
                        </div>
                    </div>
                </div>

                {/* Generic app description fallback (for apps without hardcoded content) */}
                {!content && (
                    <div style={{
                        background: theme.colors.cardGradient,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: 16, padding: '1.5rem', marginBottom: 20,
                        boxShadow: theme.colors.cardShadow,
                    }}>
                        <p style={{
                            color: theme.colors.secondaryText, fontSize: 14,
                            lineHeight: 1.7, margin: 0,
                        }}>
                            {app.description}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

function VersionCard({ v, isLatest, accentColor, theme }) {
    const versionStr = `v${Number(v.major)}.${Number(v.minor)}.${Number(v.patch)}`;
    return (
        <div style={{
            padding: '14px 16px', borderRadius: 12,
            border: `1px solid ${isLatest ? `${accentColor}30` : (theme.colors.border)}`,
            background: isLatest ? `${accentColor}06` : 'transparent',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: v.releaseNotes ? 8 : 0 }}>
                <span style={{
                    color: theme.colors.primaryText, fontWeight: 700, fontSize: 15,
                }}>
                    {versionStr}
                </span>
                {isLatest && (
                    <span style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: `${accentColor}20`, color: accentColor,
                    }}>
                        Latest
                    </span>
                )}
                {!v.hasWasm && (
                    <span style={{
                        padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                        background: '#f59e0b15', color: '#f59e0b',
                    }}>
                        No WASM
                    </span>
                )}
            </div>
            {v.releaseNotes && (
                <p style={{
                    color: theme.colors.secondaryText, fontSize: 13,
                    lineHeight: 1.6, margin: 0,
                    whiteSpace: 'pre-wrap',
                }}>
                    {v.releaseNotes}
                </p>
            )}
        </div>
    );
}
