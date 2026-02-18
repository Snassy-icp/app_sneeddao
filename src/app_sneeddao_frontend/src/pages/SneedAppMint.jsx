import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { createActor as createFactoryActor, canisterId as factoryCanisterId } from 'declarations/sneedapp';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { createActor as createCmcActor, CMC_CANISTER_ID } from 'external/cmc';
import { principalToSubAccount } from '@dfinity/utils';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { FaRocket, FaCheckCircle, FaExclamationTriangle, FaArrowRight, FaArrowLeft, FaSpinner, FaCopy, FaTag, FaFileAlt, FaEye, FaGasPump, FaCrown } from 'react-icons/fa';

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
const TOP_UP_MEMO = new Uint8Array([0x54, 0x50, 0x55, 0x50, 0x00, 0x00, 0x00, 0x00]);

export default function SneedAppMint() {
    const { appId } = useParams();
    const { theme } = useTheme();
    const { identity, isAuthenticated, login } = useAuth();
    const navigate = useNavigate();

    // State
    const [step, setStep] = useState(0); // 0=version, 1=review, 2=gas, 3=confirm, 4=success
    const [app, setApp] = useState(null);
    const [publisher, setPublisher] = useState(null);
    const [versions, setVersions] = useState([]);
    const [selectedVersion, setSelectedVersion] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [creating, setCreating] = useState(false);
    const [createdCanisterId, setCreatedCanisterId] = useState(null);
    const [progressMessage, setProgressMessage] = useState('');

    // Payment
    const [paymentSubaccount, setPaymentSubaccount] = useState(null);
    const [userWalletBalance, setUserWalletBalance] = useState(0n);
    const [depositBalance, setDepositBalance] = useState(0n);
    const [pricingInfo, setPricingInfo] = useState(null);
    const [copied, setCopied] = useState(false);

    // Gas (cycles top-up)
    const [extraGasIcp, setExtraGasIcp] = useState('');
    const [conversionRate, setConversionRate] = useState(null);

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

    // Refresh balances (wallet + deposit subaccount)
    const refreshBalances = useCallback(async () => {
        if (!identity) return;
        try {
            const ledger = getLedger();
            if (!ledger) return;
            const walletBal = await ledger.icrc1_balance_of({
                owner: identity.getPrincipal(),
                subaccount: []
            });
            setUserWalletBalance(walletBal);

            if (paymentSubaccount) {
                const factory = getFactory();
                if (factory) {
                    const depBal = await factory.getUserPaymentBalance(identity.getPrincipal());
                    setDepositBalance(depBal);
                }
            }
        } catch (e) {
            console.error('Failed to get balances:', e);
        }
    }, [identity, paymentSubaccount, getLedger, getFactory]);

    useEffect(() => {
        if (step === 1 && identity) {
            refreshBalances();
            const interval = setInterval(refreshBalances, 5000);
            return () => clearInterval(interval);
        }
    }, [step, identity, refreshBalances]);

    // Fetch ICP→cycles conversion rate from CMC
    useEffect(() => {
        const fetchRate = async () => {
            try {
                const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                    ? 'https://ic0.app' : 'http://localhost:4943';
                const agent = HttpAgent.createSync({ host });
                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                    await agent.fetchRootKey();
                }
                const cmc = createCmcActor(CMC_CANISTER_ID, { agent });
                const response = await cmc.get_icp_xdr_conversion_rate();
                const xdrPerIcp = Number(response.data.xdr_permyriad_per_icp) / 10000;
                setConversionRate({ cyclesPerIcp: xdrPerIcp * 1_000_000_000_000 });
            } catch (_) {}
        };
        fetchRate();
    }, []);

    const extraGasE8s = extraGasIcp ? Math.floor(parseFloat(extraGasIcp) * E8S) : 0;
    const extraGasCycles = conversionRate ? (extraGasE8s / E8S) * conversionRate.cyclesPerIcp : 0;

    const formatCycles = (cycles) => {
        if (cycles >= 1_000_000_000_000) return (cycles / 1_000_000_000_000).toFixed(2) + ' T';
        if (cycles >= 1_000_000_000) return (cycles / 1_000_000_000).toFixed(2) + ' B';
        return cycles.toLocaleString();
    };

    const formatIcp = (e8s) => {
        const n = Number(e8s);
        return (n / E8S).toFixed(n % E8S === 0 ? 0 : 4);
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const requiredAmount = pricingInfo ? Number(pricingInfo.applicable) : 0;
    const currentDeposit = Number(depositBalance);
    const shortfall = Math.max(0, requiredAmount - currentDeposit);
    const walletBalance = Number(userWalletBalance);
    const totalFromWallet = shortfall + (shortfall > 0 ? ICP_FEE : 0) + extraGasE8s + (extraGasE8s > 0 ? ICP_FEE : 0);
    const hasEnoughFunds = walletBalance >= totalFromWallet;

    // Mint canister
    const handleMint = async () => {
        if (!selectedVersion || !identity || !paymentSubaccount) return;
        setCreating(true);
        setError('');
        setProgressMessage('');
        try {
            const ledger = getLedger();
            const factory = getFactory();

            // Step 1: If deposit subaccount doesn't have enough, top it up from wallet
            if (shortfall > 0) {
                setProgressMessage('Sending payment...');
                const transferResult = await ledger.icrc1_transfer({
                    to: { owner: Principal.fromText(factoryCanisterId), subaccount: [paymentSubaccount] },
                    fee: [BigInt(ICP_FEE)],
                    memo: [],
                    from_subaccount: [],
                    created_at_time: [],
                    amount: BigInt(shortfall)
                });
                if (transferResult.Err) {
                    throw new Error('Payment failed: ' + JSON.stringify(transferResult.Err));
                }
            }

            // Step 2: Call mintCanister
            setProgressMessage('Creating canister...');
            const result = await factory.mintCanister(
                appId,
                [selectedVersion.major],
                [selectedVersion.minor],
                [selectedVersion.patch]
            );

            if (result.Ok) {
                const newCanisterId = result.Ok.canisterId;
                const newCanisterIdText = newCanisterId.toText();
                setCreatedCanisterId(newCanisterIdText);

                // Step 3: Top up with extra gas if specified
                if (extraGasE8s > 0) {
                    setProgressMessage('Topping up canister with gas...');
                    try {
                        const subaccount = principalToSubAccount(newCanisterId);
                        const topUpTransfer = await ledger.icrc1_transfer({
                            to: { owner: Principal.fromText(CMC_CANISTER_ID), subaccount: [subaccount] },
                            amount: BigInt(extraGasE8s),
                            fee: [BigInt(ICP_FEE)],
                            memo: [TOP_UP_MEMO],
                            from_subaccount: [],
                            created_at_time: [],
                        });
                        if (topUpTransfer.Ok !== undefined) {
                            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                                ? 'https://icp0.io' : 'http://localhost:4943';
                            const agent = HttpAgent.createSync({ host, identity });
                            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                                await agent.fetchRootKey();
                            }
                            const cmc = createCmcActor(CMC_CANISTER_ID, { agent });
                            await cmc.notify_top_up({ canister_id: newCanisterId, block_index: topUpTransfer.Ok });
                        }
                    } catch (topUpErr) {
                        console.error('Gas top-up failed (canister was still created):', topUpErr);
                    }
                }

                setStep(4);
            } else if (result.Err) {
                const errKey = Object.keys(result.Err)[0];
                const errVal = result.Err[errKey];
                const friendlyErrors = {
                    PublisherNotFound: 'The publisher for this app was not found.',
                    PublisherNotVerified: 'This app\'s publisher has not been verified yet.',
                    AppNotFound: 'App not found.',
                    AppNotEnabled: 'This app is currently disabled.',
                    InsufficientPayment: 'Insufficient payment. Please try again.',
                };
                throw new Error(friendlyErrors[errKey] || `Minting failed: ${errKey}${typeof errVal === 'object' ? ' - ' + JSON.stringify(errVal) : ''}`);
            }
        } catch (e) {
            setError(e.message || 'Minting failed');
        } finally {
            setCreating(false);
            setProgressMessage('');
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
                        {['Version', 'Review', 'Gas', 'Confirm'].map((label, i) => (
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

                {/* Step 1: Review Payment */}
                {step === 1 && (
                    <div className="mint-fade-in" style={cardStyle}>
                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <FaTag style={{ color: appPrimary }} /> Review Payment
                        </h3>

                        {/* Price */}
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ color: theme.colors.secondaryText, fontSize: 13, marginBottom: 4 }}>Minting Price</div>
                            {pricingInfo ? (
                                <>
                                    <div style={{ color: theme.colors.primaryText, fontSize: 20, fontWeight: 600 }}>
                                        {formatIcp(pricingInfo.applicable)} ICP
                                    </div>

                                    {pricingInfo.isPremium && Number(pricingInfo.regular) > Number(pricingInfo.premium) ? (
                                        <div style={{
                                            marginTop: 8, padding: '10px 14px', borderRadius: 10,
                                            background: 'linear-gradient(135deg, #FFD70015, #FFA50010)',
                                            border: '1px solid #FFD70030',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                                <FaCrown style={{ color: '#FFD700', fontSize: 13 }} />
                                                <span style={{ color: '#FFD700', fontSize: 13, fontWeight: 600 }}>Premium Member Discount</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                                                <span style={{ color: theme.colors.secondaryText, textDecoration: 'line-through' }}>
                                                    {formatIcp(pricingInfo.regular)} ICP
                                                </span>
                                                <span style={{ color: '#FFD700', fontWeight: 600 }}>
                                                    {formatIcp(pricingInfo.applicable)} ICP
                                                </span>
                                                <span style={{
                                                    background: '#22c55e20', color: '#22c55e', padding: '1px 6px',
                                                    borderRadius: 4, fontSize: 11, fontWeight: 600
                                                }}>
                                                    Save {formatIcp(Number(pricingInfo.regular) - Number(pricingInfo.premium))} ICP ({Math.round((1 - Number(pricingInfo.premium) / Number(pricingInfo.regular)) * 100)}% off)
                                                </span>
                                            </div>
                                        </div>
                                    ) : !pricingInfo.isPremium && Number(pricingInfo.regular) > Number(pricingInfo.premium) ? (
                                        <div style={{
                                            marginTop: 8, padding: '10px 14px', borderRadius: 10,
                                            background: theme.colors.secondaryBg,
                                            border: `1px solid ${theme.colors.borderColor || '#333'}`,
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                                <FaCrown style={{ color: theme.colors.secondaryText, fontSize: 13 }} />
                                                <span style={{ color: theme.colors.secondaryText, fontSize: 13, fontWeight: 500 }}>Premium members pay less</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
                                                <span style={{ color: theme.colors.secondaryText }}>
                                                    Premium price: <strong style={{ color: '#FFD700' }}>{formatIcp(pricingInfo.premium)} ICP</strong>
                                                </span>
                                                <span style={{
                                                    background: '#22c55e15', color: '#22c55e', padding: '1px 6px',
                                                    borderRadius: 4, fontSize: 11, fontWeight: 600
                                                }}>
                                                    Save {formatIcp(Number(pricingInfo.regular) - Number(pricingInfo.premium))} ICP
                                                </span>
                                            </div>
                                            <Link to="/premium" style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                                marginTop: 6, fontSize: 12, color: '#FFD700',
                                                textDecoration: 'none', fontWeight: 500
                                            }}>
                                                <FaCrown style={{ fontSize: 10 }} /> Become a Premium member <FaArrowRight style={{ fontSize: 9 }} />
                                            </Link>
                                        </div>
                                    ) : null}
                                </>
                            ) : (
                                <div style={{ color: theme.colors.primaryText, fontSize: 20, fontWeight: 600 }}>...</div>
                            )}
                            <div style={{ color: theme.colors.secondaryText, fontSize: 11, marginTop: 8 }}>
                                + {formatIcp(ICP_FEE)} ICP transfer fee
                            </div>
                        </div>

                        {/* Wallet balance */}
                        <div style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: 12, background: hasEnoughFunds ? `${appPrimary}15` : '#f59e0b15',
                            borderRadius: 8, marginBottom: 12
                        }}>
                            <div>
                                <div style={{ color: theme.colors.secondaryText, fontSize: 12 }}>Your Wallet Balance</div>
                                <div style={{ color: theme.colors.primaryText, fontWeight: 600 }}>
                                    {formatIcp(userWalletBalance)} ICP
                                </div>
                            </div>
                            <div>
                                {hasEnoughFunds ? (
                                    <FaCheckCircle style={{ color: appPrimary, fontSize: 20 }} />
                                ) : (
                                    <span style={{ color: '#f59e0b', fontSize: 12, fontWeight: 500 }}>
                                        Need {formatIcp(shortfall + ICP_FEE)} ICP
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Existing deposit (if any) */}
                        {currentDeposit > 0 && (
                            <div style={{
                                padding: 10, background: `${appPrimary}10`, borderRadius: 8,
                                marginBottom: 12, fontSize: 12, color: theme.colors.secondaryText
                            }}>
                                You have <strong style={{ color: appPrimary }}>{formatIcp(depositBalance)} ICP</strong> already deposited.
                                {shortfall > 0
                                    ? ` An additional ${formatIcp(shortfall)} ICP will be transferred from your wallet.`
                                    : ' No additional transfer needed.'}
                            </div>
                        )}

                        {/* Revenue split */}
                        {publisher && Number(app?.publisherId) !== 0 && (
                            <div style={{
                                padding: 10, background: theme.colors.primaryBg, borderRadius: 8,
                                marginBottom: 16, fontSize: 12, color: theme.colors.secondaryText
                            }}>
                                Revenue split: {(Number(publisher.daoCutBasisPoints) / 100).toFixed(1)}% Sneed DAO / {(100 - Number(publisher.daoCutBasisPoints) / 100).toFixed(1)}% {publisher.name}
                            </div>
                        )}

                        <p style={{ color: theme.colors.secondaryText, fontSize: 12, margin: '0 0 16px' }}>
                            Payment will be sent automatically from your wallet when you confirm minting.
                        </p>

                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <button onClick={() => setStep(0)} style={btnOutline}>
                                <FaArrowLeft /> Back
                            </button>
                            <button onClick={() => setStep(2)} disabled={!hasEnoughFunds} style={{
                                ...btnPrimary, opacity: hasEnoughFunds ? 1 : 0.5
                            }}>
                                Next <FaArrowRight />
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 2: Gas (optional) */}
                {step === 2 && (
                    <div className="mint-fade-in" style={cardStyle}>
                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <FaGasPump style={{ color: appPrimary }} /> Extra Gas (Optional)
                        </h3>

                        <div style={{
                            padding: 12, background: `${appPrimary}10`, borderRadius: 8, marginBottom: 16,
                            fontSize: 12, color: theme.colors.secondaryText, lineHeight: 1.5
                        }}>
                            Your canister will receive base gas (cycles) as part of the minting process. You can optionally add extra ICP to top up the canister with additional cycles.
                        </div>

                        <div style={{ marginBottom: 16 }}>
                            <label style={{ color: theme.colors.secondaryText, fontSize: 13, display: 'block', marginBottom: 6 }}>
                                Extra Gas Amount
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="0"
                                    value={extraGasIcp}
                                    onChange={(e) => setExtraGasIcp(e.target.value)}
                                    style={{
                                        flex: 1, padding: '10px 12px', borderRadius: 8,
                                        background: theme.colors.primaryBg, color: theme.colors.primaryText,
                                        border: `1px solid ${theme.colors.borderColor || '#333'}`,
                                        fontSize: 14, outline: 'none'
                                    }}
                                />
                                <span style={{ color: theme.colors.primaryText, fontWeight: 600 }}>ICP</span>
                            </div>
                            {extraGasE8s > 0 && conversionRate && (
                                <div style={{ color: appPrimary, fontSize: 12, marginTop: 6 }}>
                                    ≈ +{formatCycles(extraGasCycles)} cycles
                                </div>
                            )}
                        </div>

                        {conversionRate && (
                            <div style={{ color: theme.colors.secondaryText, fontSize: 11, marginBottom: 16 }}>
                                Current rate: 1 ICP ≈ {formatCycles(conversionRate.cyclesPerIcp)} cycles
                            </div>
                        )}

                        {extraGasE8s > 0 && !hasEnoughFunds && (
                            <div style={{
                                padding: 10, background: '#f59e0b15', borderRadius: 8, marginBottom: 16,
                                fontSize: 12, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 6
                            }}>
                                <FaExclamationTriangle />
                                Not enough ICP in wallet for gas top-up. Reduce the amount or remove it.
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <button onClick={() => setStep(1)} style={btnOutline}>
                                <FaArrowLeft /> Back
                            </button>
                            <button onClick={() => setStep(3)} style={btnPrimary}>
                                {extraGasE8s > 0 ? 'Next' : 'Skip'} <FaArrowRight />
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 3: Confirm & Mint */}
                {step === 3 && (
                    <div className="mint-fade-in" style={cardStyle}>
                        <h3 style={{ color: theme.colors.primaryText, margin: '0 0 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <FaRocket style={{ color: appPrimary }} /> Confirm & Mint
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
                            {shortfall > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.borderColor || '#333'}` }}>
                                    <span style={{ color: theme.colors.secondaryText }}>Transfer from wallet</span>
                                    <span style={{ color: theme.colors.primaryText, fontWeight: 500 }}>
                                        {formatIcp(shortfall)} ICP + {formatIcp(ICP_FEE)} fee
                                    </span>
                                </div>
                            )}
                            {extraGasE8s > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.borderColor || '#333'}` }}>
                                    <span style={{ color: theme.colors.secondaryText }}>Extra Gas</span>
                                    <span style={{ color: theme.colors.primaryText, fontWeight: 500 }}>
                                        {formatIcp(extraGasE8s)} ICP (~{formatCycles(extraGasCycles)})
                                    </span>
                                </div>
                            )}
                            {publisher && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.colors.borderColor || '#333'}` }}>
                                    <span style={{ color: theme.colors.secondaryText }}>Publisher</span>
                                    <span style={{ color: theme.colors.primaryText, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
                                        {publisher.name}
                                        {publisher.verified && <FaCheckCircle style={{ color: '#10b981', fontSize: 10 }} />}
                                    </span>
                                </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', marginTop: 4 }}>
                                <span style={{ color: theme.colors.primaryText, fontWeight: 600 }}>Total from wallet</span>
                                <span style={{ color: appPrimary, fontWeight: 700, fontSize: 16 }}>
                                    {formatIcp(totalFromWallet)} ICP
                                </span>
                            </div>
                        </div>

                        <p style={{ color: theme.colors.secondaryText, fontSize: 12, margin: '0 0 16px' }}>
                            Clicking "Mint Canister" will{shortfall > 0 ? ' transfer ICP from your wallet,' : ''}{extraGasE8s > 0 ? ' top up with extra gas,' : ''} and create a new canister with the selected version.
                        </p>

                        {creating && (
                            <div style={{ textAlign: 'center', padding: 20 }}>
                                <FaSpinner className="fa-spin" style={{ fontSize: 28, color: appPrimary, marginBottom: 12 }} />
                                <div style={{ color: theme.colors.primaryText }}>{progressMessage || 'Processing...'}</div>
                                <div style={{ color: theme.colors.secondaryText, fontSize: 12, marginTop: 4 }}>
                                    This may take a moment
                                </div>
                            </div>
                        )}

                        {!creating && (
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <button onClick={() => setStep(2)} style={btnOutline}>
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
