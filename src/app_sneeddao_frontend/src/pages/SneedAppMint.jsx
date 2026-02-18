import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneedapp';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { FaRocket, FaCheckCircle, FaExclamationTriangle, FaArrowRight, FaArrowLeft, FaSpinner, FaCopy, FaTag, FaFileAlt, FaGasPump, FaEye } from 'react-icons/fa';

const customStyles = `
@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.mint-fade-in { animation: fadeInUp 0.4s ease-out forwards; }
.fa-spin { animation: spin 1s linear infinite; }
`;

const appPrimary = '#06b6d4';
const appSecondary = '#22d3ee';

const ICP_LEDGER_CANISTER_ID = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const E8S = 100_000_000;
const ICP_FEE = 10_000;

export default function SneedAppMint() {
    const { appId } = useParams();
    const { theme } = useTheme();
    const { identity, isAuthenticated, login } = useAuth();
    const navigate = useNavigate();

    // State
    const [step, setStep] = useState(0); // 0=version, 1=fund, 2=gas, 3=confirm, 4=success
    const [app, setApp] = useState(null);
    const [publisher, setPublisher] = useState(null);
    const [versions, setVersions] = useState([]);
    const [selectedVersion, setSelectedVersion] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [creating, setCreating] = useState(false);
    const [createdCanisterId, setCreatedCanisterId] = useState(null);

    // Payment
    const [paymentSubaccount, setPaymentSubaccount] = useState(null);
    const [userBalance, setUserBalance] = useState(0n);
    const [pricingInfo, setPricingInfo] = useState(null);
    const [copied, setCopied] = useState(false);

    // Gas
    const [extraGasIcp, setExtraGasIcp] = useState('0');

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

    const getLedger = useCallback(() => {
        if (!identity) return null;
        return createLedgerActor(ICP_LEDGER_CANISTER_ID, {
            agentOptions: {
                identity,
                host: process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                    ? 'https://icp0.io' : 'http://localhost:4943'
            }
        });
    }, [identity]);

    // Load app and versions
    useEffect(() => {
        const load = async () => {
            try {
                const factory = getFactory(false);
                const [appInfo, versionList] = await Promise.all([
                    factory.getApp(appId),
                    factory.getAppVersions(appId)
                ]);
                if (appInfo.length === 0) { setError('App not found'); setLoading(false); return; }
                setApp(appInfo[0]);
                try {
                    const pub = await factory.getPublisher(appInfo[0].publisherId);
                    if (pub.length > 0) setPublisher(pub[0]);
                } catch (_) {}
                setVersions(versionList);
                // Auto-select latest version with WASM
                const latest = versionList.find(v => v.hasWasm);
                if (latest) setSelectedVersion(latest);
            } catch (e) {
                setError('Failed to load app: ' + e.message);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [appId, getFactory]);

    // Load payment info when authenticated
    useEffect(() => {
        if (!isAuthenticated || !identity || !app) return;
        const loadPayment = async () => {
            try {
                const factory = getFactory();
                const [subaccount, pricing] = await Promise.all([
                    factory.getPaymentSubaccount(identity.getPrincipal()),
                    factory.getAppMintPrice(appId, identity.getPrincipal())
                ]);
                setPaymentSubaccount(subaccount);
                setPricingInfo(pricing);
            } catch (e) {
                console.error('Failed to load payment info:', e);
            }
        };
        loadPayment();
    }, [isAuthenticated, identity, app, appId, getFactory]);

    // Refresh balance
    const refreshBalance = useCallback(async () => {
        if (!identity || !paymentSubaccount) return;
        try {
            const ledger = getLedger();
            if (!ledger) return;
            const bal = await ledger.icrc1_balance_of({
                owner: Principal.fromText(factoryCanisterId),
                subaccount: [paymentSubaccount]
            });
            setUserBalance(bal);
        } catch (e) {
            console.error('Failed to get balance:', e);
        }
    }, [identity, paymentSubaccount, getLedger]);

    useEffect(() => {
        if (step === 1 && paymentSubaccount) {
            refreshBalance();
            const interval = setInterval(refreshBalance, 5000);
            return () => clearInterval(interval);
        }
    }, [step, paymentSubaccount, refreshBalance]);

    const formatIcp = (e8s) => {
        const n = Number(e8s);
        return (n / E8S).toFixed(n % E8S === 0 ? 0 : 4);
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const requiredAmount = pricingInfo ? Number(pricingInfo.applicable) + ICP_FEE : 0;
    const hasEnoughFunds = Number(userBalance) >= requiredAmount;

    // Mint canister
    const handleMint = async () => {
        if (!selectedVersion || !identity) return;
        setCreating(true);
        setError('');
        try {
            // Step 1: Transfer ICP to factory payment subaccount
            const ledger = getLedger();
            const transferResult = await ledger.icrc1_transfer({
                to: { owner: Principal.fromText(factoryCanisterId), subaccount: [paymentSubaccount] },
                fee: [BigInt(ICP_FEE)],
                memo: [],
                from_subaccount: [],
                created_at_time: [],
                amount: BigInt(requiredAmount)
            });
            if (transferResult.Err) {
                throw new Error('Payment failed: ' + JSON.stringify(transferResult.Err));
            }

            // Step 2: Call mintCanister
            const factory = getFactory();
            const result = await factory.mintCanister(
                appId,
                [selectedVersion.major],
                [selectedVersion.minor],
                [selectedVersion.patch]
            );

            if (result.Ok) {
                setCreatedCanisterId(result.Ok.canisterId.toText());
                setStep(4);
            } else if (result.Err) {
                const errKey = Object.keys(result.Err)[0];
                const errVal = result.Err[errKey];
                const friendlyErrors = {
                    PublisherNotFound: 'The publisher for this app was not found.',
                    PublisherNotVerified: 'This app\'s publisher has not been verified yet.',
                    AppNotFound: 'App not found.',
                    AppNotEnabled: 'This app is currently disabled.',
                    InsufficientPayment: 'Insufficient payment balance.',
                };
                throw new Error(friendlyErrors[errKey] || `Minting failed: ${errKey}${typeof errVal === 'object' ? ' - ' + JSON.stringify(errVal) : ''}`);
            }
        } catch (e) {
            setError(e.message || 'Minting failed');
        } finally {
            setCreating(false);
        }
    };

    // Rendering helpers
    const cardStyle = {
        background: theme.colors.cardGradient, borderRadius: 12,
        border: `1px solid ${theme.colors.borderColor || '#333'}`,
        padding: 24
    };

    const btnPrimary = {
        padding: '12px 24px', borderRadius: 8,
        background: `linear-gradient(135deg, ${appPrimary}, ${appSecondary})`,
        color: '#fff', border: 'none', fontWeight: 600, fontSize: 14,
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8
    };

    const btnOutline = {
        padding: '12px 24px', borderRadius: 8,
        background: 'transparent', color: theme.colors.primaryText,
        border: `1px solid ${theme.colors.borderColor || '#444'}`,
        fontWeight: 500, fontSize: 14, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 8
    };

    if (loading) {
        return (
            <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
                <Header />
                <div style={{ textAlign: 'center', padding: 60, color: theme.colors.secondaryText }}>
                    <FaSpinner className="fa-spin" style={{ fontSize: 24 }} />
                    <div style={{ marginTop: 12 }}>Loading...</div>
                </div>
            </div>
        );
    }

    if (error && !app) {
        return (
            <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
                <Header />
                <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 16px', textAlign: 'center' }}>
                    <FaExclamationTriangle style={{ fontSize: 36, color: '#ef4444', marginBottom: 12 }} />
                    <p style={{ color: '#ef4444' }}>{error}</p>
                    <Link to="/sneedapp" style={{ color: appPrimary }}>Back to Sneedapp</Link>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
                <Header />
                <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 16px', textAlign: 'center' }}>
                    <h2 style={{ color: theme.colors.primaryText }}>Mint {app?.name}</h2>
                    <p style={{ color: theme.colors.secondaryText }}>Connect your wallet to continue</p>
                    <button onClick={login} style={btnPrimary}>Connect Wallet</button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: theme.colors.primaryBg }}>
            <style>{customStyles}</style>
            <Header />
            <div style={{ maxWidth: 700, margin: '0 auto', padding: '20px 16px 60px' }}>
                {/* Breadcrumb */}
                <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <Link to="/sneedapp" style={{ color: theme.colors.secondaryText, textDecoration: 'none' }}>Sneedapp</Link>
                    <span style={{ color: theme.colors.secondaryText }}>/</span>
                    <span style={{ color: appPrimary }}>Mint {app?.name}</span>
                </div>
                {publisher && (
                    <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <span style={{ color: theme.colors.secondaryText }}>by</span>
                        <span style={{ color: theme.colors.primaryText, fontWeight: 500 }}>{publisher.name}</span>
                        {publisher.verified && <FaCheckCircle style={{ color: '#10b981', fontSize: 11 }} />}
                    </div>
                )}

                {/* Step indicator */}
                {step < 4 && (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
                        {['Version', 'Fund', 'Gas', 'Confirm'].map((label, i) => (
                            <div key={i} style={{
                                flex: 1, textAlign: 'center', padding: '8px 0',
                                borderBottom: `3px solid ${i <= step ? appPrimary : theme.colors.borderColor || '#333'}`,
                                color: i <= step ? appPrimary : theme.colors.secondaryText,
                                fontSize: 13, fontWeight: i === step ? 600 : 400
                            }}>
                                {label}
                            </div>
                        ))}
                    </div>
                )}

                {error && (
                    <div style={{
                        background: '#ef444420', border: '1px solid #ef4444', borderRadius: 8,
                        padding: 12, marginBottom: 16, color: '#ef4444', fontSize: 13
                    }}>
                        <FaExclamationTriangle style={{ marginRight: 6 }} />{error}
                    </div>
                )}

                {/* Step 0: Select Version */}
                {step === 0 && (
                    <div className="mint-fade-in" style={cardStyle}>
                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <FaFileAlt style={{ color: appPrimary }} /> Select Version
                        </h3>
                        {versions.length === 0 ? (
                            <p style={{ color: theme.colors.secondaryText }}>No versions available for this app.</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {versions.map(v => {
                                    const isSelected = selectedVersion && selectedVersion.major === v.major && selectedVersion.minor === v.minor && selectedVersion.patch === v.patch;
                                    return (
                                        <div key={`${v.major}.${v.minor}.${v.patch}`}
                                            onClick={() => v.hasWasm && setSelectedVersion(v)}
                                            style={{
                                                padding: 14, borderRadius: 8,
                                                border: `2px solid ${isSelected ? appPrimary : theme.colors.borderColor || '#333'}`,
                                                background: isSelected ? `${appPrimary}10` : 'transparent',
                                                cursor: v.hasWasm ? 'pointer' : 'not-allowed',
                                                opacity: v.hasWasm ? 1 : 0.5
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ color: theme.colors.primaryText, fontWeight: 600 }}>
                                                    v{Number(v.major)}.{Number(v.minor)}.{Number(v.patch)}
                                                </span>
                                                {!v.hasWasm && (
                                                    <span style={{ fontSize: 11, color: '#f59e0b', background: '#f59e0b20', padding: '2px 6px', borderRadius: 4 }}>
                                                        No WASM
                                                    </span>
                                                )}
                                                {isSelected && <FaCheckCircle style={{ color: appPrimary, marginLeft: 'auto' }} />}
                                            </div>
                                            {v.releaseNotes && (
                                                <p style={{ color: theme.colors.secondaryText, fontSize: 12, margin: '6px 0 0', lineHeight: 1.4 }}>
                                                    {v.releaseNotes.substring(0, 200)}{v.releaseNotes.length > 200 ? '...' : ''}
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
                            <button onClick={() => setStep(1)} disabled={!selectedVersion} style={{
                                ...btnPrimary, opacity: selectedVersion ? 1 : 0.5
                            }}>
                                Next <FaArrowRight />
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 1: Fund Wallet */}
                {step === 1 && (
                    <div className="mint-fade-in" style={cardStyle}>
                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <FaTag style={{ color: appPrimary }} /> Fund Your Payment
                        </h3>
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ color: theme.colors.secondaryText, fontSize: 13, marginBottom: 4 }}>Price</div>
                            <div style={{ color: theme.colors.primaryText, fontSize: 20, fontWeight: 600 }}>
                                {pricingInfo ? formatIcp(pricingInfo.applicable) : '...'} ICP
                                {pricingInfo?.isPremium && (
                                    <span style={{ fontSize: 12, color: '#f59e0b', marginLeft: 8 }}>Premium discount</span>
                                )}
                            </div>
                        </div>

                        <div style={{
                            background: theme.colors.primaryBg, borderRadius: 8, padding: 14, marginBottom: 16
                        }}>
                            <div style={{ color: theme.colors.secondaryText, fontSize: 12, marginBottom: 6 }}>
                                Send ICP to this address:
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <code style={{ color: theme.colors.primaryText, fontSize: 12, wordBreak: 'break-all', flex: 1 }}>
                                    {factoryCanisterId}
                                </code>
                                <button onClick={() => copyToClipboard(factoryCanisterId)} style={{
                                    background: 'transparent', border: 'none', color: appPrimary, cursor: 'pointer', padding: 4
                                }}>
                                    <FaCopy /> {copied ? 'Copied!' : ''}
                                </button>
                            </div>
                            {paymentSubaccount && (
                                <div style={{ marginTop: 8 }}>
                                    <div style={{ color: theme.colors.secondaryText, fontSize: 11 }}>Subaccount (your payment slot):</div>
                                    <code style={{ color: theme.colors.secondaryText, fontSize: 10, wordBreak: 'break-all' }}>
                                        {Array.from(new Uint8Array(paymentSubaccount)).map(b => b.toString(16).padStart(2, '0')).join('')}
                                    </code>
                                </div>
                            )}
                        </div>

                        <div style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: 12, background: hasEnoughFunds ? `${appPrimary}15` : '#f59e0b15',
                            borderRadius: 8, marginBottom: 16
                        }}>
                            <div>
                                <div style={{ color: theme.colors.secondaryText, fontSize: 12 }}>Your balance</div>
                                <div style={{ color: theme.colors.primaryText, fontWeight: 600 }}>
                                    {formatIcp(userBalance)} ICP
                                </div>
                            </div>
                            <div>
                                {hasEnoughFunds ? (
                                    <FaCheckCircle style={{ color: appPrimary, fontSize: 20 }} />
                                ) : (
                                    <span style={{ color: '#f59e0b', fontSize: 12 }}>
                                        Need {formatIcp(requiredAmount)} ICP
                                    </span>
                                )}
                            </div>
                        </div>

                        <p style={{ color: theme.colors.secondaryText, fontSize: 12, margin: '0 0 16px' }}>
                            The payment will be taken from your balance on the factory canister. Send ICP to the address above, or if you already have a balance, proceed.
                        </p>

                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <button onClick={() => setStep(0)} style={btnOutline}>
                                <FaArrowLeft /> Back
                            </button>
                            <button onClick={() => setStep(3)} disabled={!hasEnoughFunds} style={{
                                ...btnPrimary, opacity: hasEnoughFunds ? 1 : 0.5
                            }}>
                                Next <FaArrowRight />
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 3: Confirm */}
                {step === 3 && (
                    <div className="mint-fade-in" style={cardStyle}>
                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <FaRocket style={{ color: appPrimary }} /> Confirm Minting
                        </h3>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.borderColor || '#333'}` }}>
                                <span style={{ color: theme.colors.secondaryText }}>App</span>
                                <span style={{ color: theme.colors.primaryText, fontWeight: 500 }}>{app?.name}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.borderColor || '#333'}` }}>
                                <span style={{ color: theme.colors.secondaryText }}>Version</span>
                                <span style={{ color: theme.colors.primaryText, fontWeight: 500 }}>
                                    v{Number(selectedVersion?.major)}.{Number(selectedVersion?.minor)}.{Number(selectedVersion?.patch)}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.borderColor || '#333'}` }}>
                                <span style={{ color: theme.colors.secondaryText }}>Price</span>
                                <span style={{ color: appPrimary, fontWeight: 600 }}>
                                    {pricingInfo ? formatIcp(pricingInfo.applicable) : '...'} ICP
                                </span>
                            </div>
                            {publisher && (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.borderColor || '#333'}` }}>
                                        <span style={{ color: theme.colors.secondaryText }}>Publisher</span>
                                        <span style={{ color: theme.colors.primaryText, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            {publisher.name}
                                            {publisher.verified && <FaCheckCircle style={{ color: '#10b981', fontSize: 10 }} />}
                                        </span>
                                    </div>
                                    {Number(app?.publisherId) !== 0 && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.borderColor || '#333'}` }}>
                                            <span style={{ color: theme.colors.secondaryText }}>Revenue Split</span>
                                            <span style={{ color: theme.colors.secondaryText, fontSize: 12 }}>
                                                {(Number(publisher.daoCutBasisPoints) / 100).toFixed(1)}% Sneed DAO / {(100 - Number(publisher.daoCutBasisPoints) / 100).toFixed(1)}% Publisher
                                            </span>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {creating && (
                            <div style={{ textAlign: 'center', padding: 20 }}>
                                <FaSpinner className="fa-spin" style={{ fontSize: 28, color: appPrimary, marginBottom: 12 }} />
                                <div style={{ color: theme.colors.primaryText }}>Creating your canister...</div>
                                <div style={{ color: theme.colors.secondaryText, fontSize: 12, marginTop: 4 }}>
                                    This may take a moment
                                </div>
                            </div>
                        )}

                        {!creating && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <button onClick={() => setStep(1)} style={btnOutline}>
                                    <FaArrowLeft /> Back
                                </button>
                                <button onClick={handleMint} style={btnPrimary}>
                                    <FaRocket /> Mint Canister
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Step 4: Success */}
                {step === 4 && (
                    <div className="mint-fade-in" style={{ ...cardStyle, textAlign: 'center' }}>
                        <FaCheckCircle style={{ fontSize: 48, color: '#10b981', marginBottom: 16 }} />
                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 8px' }}>Canister Created!</h3>
                        <p style={{ color: theme.colors.secondaryText, fontSize: 14, margin: '0 0 20px' }}>
                            Your new {app?.name} canister is ready.
                        </p>

                        <div style={{
                            background: theme.colors.primaryBg, borderRadius: 8, padding: 14, marginBottom: 20,
                            display: 'flex', alignItems: 'center', gap: 8
                        }}>
                            <code style={{ color: appPrimary, fontSize: 14, flex: 1, wordBreak: 'break-all' }}>
                                {createdCanisterId}
                            </code>
                            <button onClick={() => copyToClipboard(createdCanisterId)} style={{
                                background: 'transparent', border: 'none', color: appPrimary, cursor: 'pointer'
                            }}>
                                <FaCopy />
                            </button>
                        </div>

                        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                            {app?.viewUrl && app.viewUrl.length > 0 && (
                                <Link to={app.viewUrl[0].replace('CANISTER_ID', createdCanisterId)} style={{
                                    ...btnPrimary, textDecoration: 'none'
                                }}>
                                    <FaEye /> View Canister
                                </Link>
                            )}
                            <Link to="/sneedapp" style={{ ...btnOutline, textDecoration: 'none' }}>
                                Back to Sneedapp
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
