import React, { useState, useEffect } from 'react';
import { Principal } from '@dfinity/principal';
import { FaCheck, FaArrowRight, FaArrowLeft, FaMagic, FaTimes, FaSpinner, FaWallet, FaExchangeAlt, FaChartLine, FaBalanceScale, FaShieldAlt, FaPlus, FaTrash } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import TokenSelector from './TokenSelector';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';
import { getTokenMetadataSync } from '../hooks/useTokenCache';

const ACCENT = '#10b981';
const ACCENT_SECONDARY = '#34d399';
const ACCENT_GLOW = '#10b98140';

const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const CKUSDC_LEDGER = 'xevnm-gaaaa-aaaar-qafnq-cai';
const CKUSDT_LEDGER = 'cngnf-vqaaa-aaaar-qag4q-cai';

const WIZARD_SVG_RAW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 211.83 213.016"><g transform="translate(2.151,-30.907)"><path fill="#fff" d="m 61.442,243.327 c -5.676,-1.488 -10.031,-5.865 -11.482,-11.54 -0.508,-1.986 -0.523,-3.058 -0.523,-37.599 0,-38.192 -0.016,-37.693 1.329,-40.759 l 0.493,-1.124 H 105 158.74 l 0.493,1.124 c 1.345,3.066 1.329,2.567 1.329,40.759 0,34.542 -0.015,35.614 -0.523,37.599 -1.45,5.669 -5.873,10.091 -11.541,11.541 -3.102,0.793 -84.03,0.793 -87.056,0 z M 89.125,216.069 v -3.969 H 81.188 73.25 v 3.969 3.969 h 7.938 7.937 z m 23.813,0 v -3.969 H 105 97.063 v 3.969 3.969 H 105 h 7.938 z m 23.812,0 v -3.969 h -7.937 -7.938 v 3.969 3.969 h 7.938 7.937 z M 85.465,189.269 c 9.407,-4.602 6.189,-18.576 -4.277,-18.576 -9.993,0 -13.616,12.897 -5.102,18.16 2.46,1.52 6.735,1.71 9.379,0.416 z m 47.625,0 c 9.407,-4.602 6.189,-18.576 -4.277,-18.576 -9.993,0 -13.616,12.897 -5.102,18.16 2.46,1.52 6.735,1.71 9.379,0.416 z M 30.764,219.494 c -1.863,-0.717 -3.386,-2.108 -4.263,-3.894 l -0.744,-1.515 v -17.859 c 0,-20.02 -0.106,-18.878 1.964,-21.236 1.78,-2.027 3.195,-2.433 8.818,-2.531 L 41.5,172.372 v 23.833 23.833 l -4.696,-0.014 c -4.002,-0.012 -4.895,-0.09 -6.04,-0.53 z M 168.5,196.246 v -23.833 h 4.62 c 6.715,0 9.222,1.201 10.688,5.119 0.859,2.296 0.89,35.008 0.036,37.292 -1.493,3.989 -3.625,5.051 -10.383,5.169 L 168.5,220.079 Z M -2.151,144.169 c 0.003,-0.109 1.878,-1.025 4.167,-2.035 2.289,-1.01 7.853,-3.465 12.364,-5.455 4.511,-1.99 16.298,-7.191 26.194,-11.557 9.895,-4.366 18.885,-8.341 19.976,-8.832 l 1.984,-0.894 41.11,-0.069 41.11,-0.069 10.352,4.534 c 22.276,9.756 32.151,14.094 41.175,18.087 5.166,2.286 10.379,4.592 11.585,5.124 1.828,0.807 2.092,0.997 1.588,1.14 -0.852,0.242 -211.611,0.269 -211.605,0.026 z M 66.106,106.949 c 0,-0.197 9.484,-21.002 26,-57.038 2.768,-6.039 5.618,-12.29 6.334,-13.891 2.647,-5.922 7.783,-6.907 9.733,-1.867 0.235,0.607 5.92,13.13 12.438,27.399 17.039,37.298 20.637,45.219 20.637,45.427 0,0.045 -16.907,0.081 -37.571,0.081 -20.664,0 -37.571,-0.05 -37.571,-0.112 z m 33.787,-10.228 3.001,-1.874 2.958,1.874 c 4.962,3.143 6.085,2.39 4.307,-2.889 -1.236,-3.671 -1.344,-3.345 1.972,-5.955 4.78,-3.763 4.407,-4.715 -1.956,-5.001 -3.687,-0.166 -3.48,-0.027 -4.777,-3.199 -1.927,-4.712 -3.233,-4.746 -5.033,-0.132 -1.303,3.34 -1.027,3.159 -5.127,3.355 -4.175,0.2 -4.681,0.451 -4.557,2.262 0.017,0.252 1.341,1.491 2.942,2.753 1.6,1.262 2.908,2.425 2.905,2.585 -0.003,0.16 -0.419,1.589 -0.926,3.176 -1.744,5.462 -0.731,6.181 4.291,3.046 z"/></g></svg>`;
const WIZARD_SVG_URL = `data:image/svg+xml,${encodeURIComponent(WIZARD_SVG_RAW)}`;

const wizardStyles = `
@keyframes wizardFadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes wizardFloat {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-6px); }
}
@keyframes wizardPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}
@keyframes bubblePop {
    0% { opacity: 0; transform: scale(0.9) translateY(8px); }
    50% { transform: scale(1.02) translateY(-2px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes sparkle {
    0%, 100% { opacity: 0; transform: scale(0) rotate(0deg); }
    50% { opacity: 1; transform: scale(1) rotate(180deg); }
}
.wizard-fade-in { animation: wizardFadeInUp 0.4s ease-out forwards; }
.wizard-float { animation: wizardFloat 3s ease-in-out infinite; }
.wizard-bubble-pop { animation: bubblePop 0.35s ease-out forwards; }
.wizard-spin { animation: spin 1s linear infinite; }
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
`;

function WizardMascot({ message, theme, size = 'large', showSparkles = false }) {
    const isLarge = size === 'large';
    const imgSize = isLarge ? 140 : 90;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: isLarge ? '16px' : '10px', position: 'relative' }}>
            {showSparkles && (
                <>
                    <div style={{ position: 'absolute', top: -8, right: '30%', width: 8, height: 8, background: ACCENT, borderRadius: '50%', animation: 'sparkle 2s ease-in-out infinite', animationDelay: '0s' }} />
                    <div style={{ position: 'absolute', top: '10%', left: '25%', width: 6, height: 6, background: ACCENT_SECONDARY, borderRadius: '50%', animation: 'sparkle 2s ease-in-out infinite', animationDelay: '0.7s' }} />
                    <div style={{ position: 'absolute', bottom: '30%', right: '20%', width: 5, height: 5, background: '#fcd34d', borderRadius: '50%', animation: 'sparkle 2s ease-in-out infinite', animationDelay: '1.4s' }} />
                </>
            )}
            <div className="wizard-float" style={{ position: 'relative' }}>
                <img
                    src={WIZARD_SVG_URL}
                    alt="Bot Wizard"
                    style={{
                        width: imgSize,
                        height: imgSize,
                        filter: 'drop-shadow(0 4px 20px rgba(16, 185, 129, 0.3))',
                        maxWidth: 'none',
                    }}
                />
            </div>
            {message && (
                <div className="wizard-bubble-pop" style={{
                    position: 'relative',
                    background: `linear-gradient(135deg, ${theme.colors.secondaryBg}, ${theme.colors.cardGradient || theme.colors.secondaryBg})`,
                    border: `1.5px solid ${ACCENT}40`,
                    borderRadius: '16px',
                    padding: isLarge ? '16px 20px' : '12px 16px',
                    maxWidth: '420px',
                    width: '100%',
                    boxShadow: `0 4px 24px rgba(0,0,0,0.2), 0 0 0 1px ${ACCENT}10`,
                    fontSize: isLarge ? '0.92rem' : '0.85rem',
                    color: theme.colors.primaryText,
                    lineHeight: '1.55',
                    textAlign: 'center',
                }}>
                    <div style={{
                        position: 'absolute',
                        top: '-8px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: 0,
                        height: 0,
                        borderLeft: '9px solid transparent',
                        borderRight: '9px solid transparent',
                        borderBottom: `9px solid ${ACCENT}40`,
                    }} />
                    <div style={{
                        position: 'absolute',
                        top: '-6px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: 0,
                        height: 0,
                        borderLeft: '8px solid transparent',
                        borderRight: '8px solid transparent',
                        borderBottom: `8px solid ${theme.colors.secondaryBg}`,
                    }} />
                    {message}
                </div>
            )}
        </div>
    );
}

function StepProgress({ steps, currentStep, onStepClick, theme }) {
    return (
        <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            gap: '0', marginBottom: '1.25rem', padding: '1rem',
            background: theme.colors.cardGradient, borderRadius: '14px',
            border: `1px solid ${theme.colors.border}`, boxShadow: theme.colors.cardShadow,
        }}>
            {steps.map((label, index) => {
                const stepNum = index + 1;
                const isActive = stepNum === currentStep;
                const isCompleted = stepNum < currentStep;
                return (
                    <React.Fragment key={stepNum}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <div
                                style={{
                                    width: '38px', height: '38px', borderRadius: '50%',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: '600', fontSize: '0.9rem',
                                    background: isCompleted
                                        ? `linear-gradient(135deg, ${theme.colors.success}, ${theme.colors.success}dd)`
                                        : isActive
                                            ? `linear-gradient(135deg, ${ACCENT}, ${ACCENT_SECONDARY})`
                                            : theme.colors.tertiaryBg,
                                    color: isCompleted || isActive ? '#fff' : theme.colors.mutedText,
                                    cursor: isCompleted ? 'pointer' : 'default',
                                    transition: 'all 0.3s ease',
                                    boxShadow: isActive ? `0 4px 16px ${ACCENT_GLOW}` : isCompleted ? `0 4px 12px ${theme.colors.success}40` : 'none',
                                }}
                                onClick={() => isCompleted && onStepClick && onStepClick(stepNum)}
                            >
                                {isCompleted ? <FaCheck size={14} /> : stepNum}
                            </div>
                            <div style={{
                                fontSize: '0.65rem', fontWeight: isActive ? '600' : '500',
                                color: isActive ? theme.colors.primaryText : theme.colors.mutedText,
                                marginTop: '6px', textAlign: 'center', textTransform: 'uppercase',
                                letterSpacing: '0.4px', maxWidth: '70px',
                            }}>{label}</div>
                        </div>
                        {index < steps.length - 1 && (
                            <div style={{
                                width: '36px', height: '3px', marginTop: '17px', borderRadius: '2px',
                                background: isCompleted
                                    ? `linear-gradient(90deg, ${theme.colors.success}, ${theme.colors.success}dd)`
                                    : theme.colors.border,
                                transition: 'all 0.3s ease',
                            }} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

function WizardCard({ children, theme }) {
    return (
        <div className="wizard-fade-in" style={{
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px', padding: '1.25rem', marginBottom: '1rem',
            boxShadow: theme.colors.cardShadow,
        }}>
            {children}
        </div>
    );
}

function TokenPairSelector({ inputToken, outputToken, onInputChange, onOutputChange, theme, inputLabel = "From token", outputLabel = "To token" }) {
    return (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: '180px' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '6px' }}>{inputLabel}</label>
                <TokenSelector value={inputToken} onChange={onInputChange} placeholder="Select token..." />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', padding: '0 4px', paddingBottom: '8px' }}>
                <FaArrowRight size={14} color={ACCENT} />
            </div>
            <div style={{ flex: 1, minWidth: '180px' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '6px' }}>{outputLabel}</label>
                <TokenSelector value={outputToken} onChange={onOutputChange} placeholder="Select token..." excludeTokens={inputToken ? [inputToken] : []} />
            </div>
        </div>
    );
}

function AmountInput({ label, value, onChange, suffix, theme, placeholder = "0" }) {
    return (
        <div style={{ flex: 1, minWidth: '140px' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '6px' }}>{label}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                    type="number"
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    style={{
                        flex: 1, padding: '10px 12px', background: theme.colors.primaryBg,
                        border: `1px solid ${theme.colors.border}`, borderRadius: '10px',
                        color: theme.colors.primaryText, fontSize: '0.9rem', outline: 'none',
                    }}
                />
                {suffix && <span style={{ fontSize: '0.8rem', color: theme.colors.mutedText, whiteSpace: 'nowrap' }}>{suffix}</span>}
            </div>
        </div>
    );
}

function DCAWizard({ theme, onComplete, onBack, getReadyBotActor, canisterId, identity }) {
    const [step, setStep] = useState(1);
    const [inputToken, setInputToken] = useState('');
    const [outputToken, setOutputToken] = useState('');
    const [tradeSize, setTradeSize] = useState('');
    const [intervalMinutes, setIntervalMinutes] = useState('60');
    const [fundAmount, setFundAmount] = useState('');
    const [walletBalance, setWalletBalance] = useState(null);
    const [inputMeta, setInputMeta] = useState(null);
    const [deploying, setDeploying] = useState(false);
    const [deployError, setDeployError] = useState('');
    const [deploySuccess, setDeploySuccess] = useState(false);
    const [deployStep, setDeployStep] = useState('');

    useEffect(() => {
        if (!inputToken || !identity) { setWalletBalance(null); setInputMeta(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const ledger = createLedgerActor(inputToken, { agentOptions: { identity } });
                const [bal, dec, sym, fee] = await Promise.all([
                    ledger.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] }),
                    ledger.icrc1_decimals(), ledger.icrc1_symbol(), ledger.icrc1_fee(),
                ]);
                if (cancelled) return;
                setWalletBalance(BigInt(bal));
                setInputMeta({ decimals: Number(dec), symbol: sym, fee: BigInt(fee) });
            } catch { if (!cancelled) { setWalletBalance(null); setInputMeta(null); } }
        })();
        return () => { cancelled = true; };
    }, [inputToken, identity]);

    const inputSymbol = inputMeta?.symbol || getTokenMetadataSync(inputToken)?.symbol || '???';
    const outputSymbol = getTokenMetadataSync(outputToken)?.symbol || '???';
    const inputDecimals = inputMeta?.decimals ?? getTokenMetadataSync(inputToken)?.decimals ?? 8;
    const inputFee = inputMeta?.fee ?? BigInt(getTokenMetadataSync(inputToken)?.fee ?? 10000);

    const formatBal = (raw, dec) => {
        if (raw == null) return '...';
        return (Number(raw) / Math.pow(10, dec)).toLocaleString(undefined, { maximumFractionDigits: dec });
    };

    const canProceedStep1 = inputToken && outputToken && inputToken !== outputToken;
    const canProceedStep2 = tradeSize && Number(tradeSize) > 0 && intervalMinutes && Number(intervalMinutes) > 0;

    const handleDeploy = async () => {
        setDeploying(true);
        setDeployError('');
        try {
            const bot = await getReadyBotActor();
            const dec = inputDecimals;
            const outDec = getTokenMetadataSync(outputToken)?.decimals ?? 8;
            const outFee = BigInt(getTokenMetadataSync(outputToken)?.fee ?? 10000);

            setDeployStep('Registering tokens...');
            await bot.addToken({ ledgerCanisterId: Principal.fromText(inputToken), symbol: inputSymbol, decimals: dec, fee: inputFee });
            await bot.addToken({ ledgerCanisterId: Principal.fromText(outputToken), symbol: outputSymbol, decimals: outDec, fee: outFee });

            setDeployStep('Creating DCA trade chore...');
            const instId = 'trade-' + Date.now().toString(36);
            const ok = await bot.createChoreInstance('trade', instId, `DCA ${inputSymbol} → ${outputSymbol}`);
            if (!ok) throw new Error('Failed to create chore instance');

            setDeployStep('Adding trade action...');
            const rawSize = BigInt(Math.floor(Number(tradeSize) * Math.pow(10, dec)));
            await bot.addTradeAction(instId, {
                actionType: 0, enabled: true,
                inputToken: Principal.fromText(inputToken),
                outputToken: [Principal.fromText(outputToken)],
                minAmount: rawSize, maxAmount: rawSize,
                amountMode: 0, balancePercent: [],
                preferredDex: [], sourceSubaccount: [], targetSubaccount: [],
                destinationOwner: [], destinationSubaccount: [],
                minBalance: [], maxBalance: [], balanceDenominationToken: [],
                minPrice: [], maxPrice: [], priceDenominationToken: [],
                maxPriceImpactBps: [300], maxSlippageBps: [200],
                minFrequencySeconds: [], maxFrequencySeconds: [],
                tradeSizeDenominationToken: [],
            });

            setDeployStep('Setting chore interval...');
            await bot.setChoreInterval(instId, Number(intervalMinutes) * 60);

            if (fundAmount && Number(fundAmount) > 0) {
                setDeployStep('Funding bot from wallet...');
                const rawFund = BigInt(Math.floor(Number(fundAmount) * Math.pow(10, dec)));
                const ledger = createLedgerActor(inputToken, { agentOptions: { identity } });
                await ledger.icrc1_transfer({
                    to: { owner: Principal.fromText(canisterId), subaccount: [] },
                    amount: rawFund,
                    fee: [], memo: [], from_subaccount: [], created_at_time: [],
                });
            }

            setDeployStep('Starting chore...');
            await bot.startChore(instId);
            setDeploySuccess(true);
        } catch (e) {
            setDeployError(e.message || 'Deployment failed');
        } finally {
            setDeploying(false);
            setDeployStep('');
        }
    };

    const stepLabels = ['Tokens', 'Schedule', 'Fund & Deploy'];

    const messages = {
        1: `Let's set up your DCA strategy! First, pick which token you want to spend and which token you want to accumulate over time.`,
        2: `Great picks! Now let's decide how much ${inputSymbol || 'tokens'} to swap each time, and how often.`,
        3: `Almost there! Optionally fund your bot now, then we'll deploy everything.`,
    };

    if (deploySuccess) {
        return (
            <div className="wizard-fade-in" style={{ textAlign: 'center' }}>
                <WizardMascot message="Your DCA bot is live! It will automatically buy on schedule. You can always adjust settings from the Chores tab." theme={theme} showSparkles />
                <div style={{ marginTop: '1.5rem' }}>
                    <button onClick={onComplete} style={btnPrimary(theme)}>
                        Done <FaCheck size={12} />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div>
            <StepProgress steps={stepLabels} currentStep={step} onStepClick={s => !deploying && setStep(s)} theme={theme} />
            <WizardMascot message={messages[step]} theme={theme} size="small" />
            <div style={{ marginTop: '1rem' }}>
                {step === 1 && (
                    <WizardCard theme={theme}>
                        <h4 style={{ color: theme.colors.primaryText, margin: '0 0 14px', fontSize: '1rem', fontWeight: '600' }}>
                            <FaExchangeAlt size={14} color={ACCENT} style={{ marginRight: 8 }} />
                            Select Token Pair
                        </h4>
                        <TokenPairSelector inputToken={inputToken} outputToken={outputToken} onInputChange={setInputToken} onOutputChange={setOutputToken} theme={theme} inputLabel="Spend (sell)" outputLabel="Accumulate (buy)" />
                        <div style={{ display: 'flex', gap: '10px', marginTop: '1.25rem', flexWrap: 'wrap' }}>
                            <button onClick={onBack} style={btnSecondary(theme)}><FaArrowLeft size={11} /> Back</button>
                            <button onClick={() => setStep(2)} disabled={!canProceedStep1} style={btnPrimary(theme, canProceedStep1)}>
                                Next <FaArrowRight size={11} />
                            </button>
                        </div>
                    </WizardCard>
                )}
                {step === 2 && (
                    <WizardCard theme={theme}>
                        <h4 style={{ color: theme.colors.primaryText, margin: '0 0 14px', fontSize: '1rem', fontWeight: '600' }}>
                            <FaChartLine size={14} color={ACCENT} style={{ marginRight: 8 }} />
                            DCA Schedule
                        </h4>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
                            <AmountInput label={`Amount per trade (${inputSymbol})`} value={tradeSize} onChange={setTradeSize} theme={theme} />
                            <AmountInput label="Interval (minutes)" value={intervalMinutes} onChange={setIntervalMinutes} theme={theme} placeholder="60" />
                        </div>
                        <p style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, margin: '8px 0 0', lineHeight: '1.5' }}>
                            The bot will swap <strong style={{ color: ACCENT }}>{tradeSize || '?'} {inputSymbol}</strong> for <strong style={{ color: ACCENT }}>{outputSymbol}</strong> every <strong>{intervalMinutes || '?'} minutes</strong>.
                        </p>
                        <div style={{ display: 'flex', gap: '10px', marginTop: '1.25rem', flexWrap: 'wrap' }}>
                            <button onClick={() => setStep(1)} style={btnSecondary(theme)}><FaArrowLeft size={11} /> Back</button>
                            <button onClick={() => setStep(3)} disabled={!canProceedStep2} style={btnPrimary(theme, canProceedStep2)}>
                                Next <FaArrowRight size={11} />
                            </button>
                        </div>
                    </WizardCard>
                )}
                {step === 3 && (
                    <WizardCard theme={theme}>
                        <h4 style={{ color: theme.colors.primaryText, margin: '0 0 14px', fontSize: '1rem', fontWeight: '600' }}>
                            <FaWallet size={14} color={ACCENT} style={{ marginRight: 8 }} />
                            Fund & Deploy
                        </h4>
                        <div style={{ padding: '12px', background: `${ACCENT}08`, borderRadius: '10px', border: `1px solid ${ACCENT}20`, marginBottom: '14px' }}>
                            <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, marginBottom: '8px' }}>
                                Your wallet balance: <strong style={{ color: theme.colors.primaryText }}>{formatBal(walletBalance, inputDecimals)} {inputSymbol}</strong>
                            </div>
                            <AmountInput label={`Fund bot with ${inputSymbol} (optional)`} value={fundAmount} onChange={setFundAmount} theme={theme} placeholder="0" />
                            {walletBalance != null && fundAmount && Number(fundAmount) > 0 && BigInt(Math.floor(Number(fundAmount) * Math.pow(10, inputDecimals))) > walletBalance && (
                                <div style={{ color: theme.colors.error || '#ef4444', fontSize: '0.78rem', marginTop: '6px' }}>Insufficient wallet balance</div>
                            )}
                        </div>
                        <div style={{ padding: '12px', background: theme.colors.primaryBg, borderRadius: '10px', border: `1px solid ${theme.colors.border}`, marginBottom: '14px' }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '8px' }}>Summary</div>
                            <SummaryRow label="Strategy" value="Dollar Cost Averaging" theme={theme} />
                            <SummaryRow label="Pair" value={`${inputSymbol} → ${outputSymbol}`} theme={theme} />
                            <SummaryRow label="Trade size" value={`${tradeSize} ${inputSymbol}`} theme={theme} />
                            <SummaryRow label="Interval" value={`Every ${intervalMinutes} min`} theme={theme} />
                            {fundAmount && Number(fundAmount) > 0 && <SummaryRow label="Funding" value={`${fundAmount} ${inputSymbol}`} theme={theme} />}
                        </div>
                        {deployError && <div style={{ color: theme.colors.error || '#ef4444', fontSize: '0.82rem', padding: '10px 12px', background: `${theme.colors.error || '#ef4444'}15`, borderRadius: '8px', marginBottom: '10px' }}>{deployError}</div>}
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <button onClick={() => setStep(2)} disabled={deploying} style={btnSecondary(theme)}><FaArrowLeft size={11} /> Back</button>
                            <button onClick={handleDeploy} disabled={deploying} style={btnPrimary(theme, !deploying)}>
                                {deploying ? <><FaSpinner size={12} className="wizard-spin" /> {deployStep}</> : <><FaMagic size={12} /> Deploy DCA Bot</>}
                            </button>
                        </div>
                    </WizardCard>
                )}
            </div>
        </div>
    );
}

function RangeTradeWizard({ theme, onComplete, onBack, getReadyBotActor, canisterId, identity }) {
    const [step, setStep] = useState(1);
    const [tokenA, setTokenA] = useState('');
    const [tokenB, setTokenB] = useState('');
    const [sellAMinPrice, setSellAMinPrice] = useState('');
    const [sellAMaxPrice, setSellAMaxPrice] = useState('');
    const [sellBMinPrice, setSellBMinPrice] = useState('');
    const [sellBMaxPrice, setSellBMaxPrice] = useState('');
    const [tradeSizeA, setTradeSizeA] = useState('');
    const [tradeSizeB, setTradeSizeB] = useState('');
    const [intervalMinutes, setIntervalMinutes] = useState('5');
    const [enableStopLoss, setEnableStopLoss] = useState(false);
    const [stopLossPrice, setStopLossPrice] = useState('');
    const [stopLossSellToken, setStopLossSellToken] = useState('A');
    const [stopLossMaxSlippage, setStopLossMaxSlippage] = useState('100');
    const [stopLossMaxImpact, setStopLossMaxImpact] = useState('100');
    const [fundToken, setFundToken] = useState('');
    const [fundAmount, setFundAmount] = useState('');
    const [walletBalance, setWalletBalance] = useState(null);
    const [fundMeta, setFundMeta] = useState(null);
    const [deploying, setDeploying] = useState(false);
    const [deployError, setDeployError] = useState('');
    const [deploySuccess, setDeploySuccess] = useState(false);
    const [deployStep, setDeployStep] = useState('');

    useEffect(() => { if (tokenA) setFundToken(tokenA); }, [tokenA]);

    useEffect(() => {
        if (!fundToken || !identity) { setWalletBalance(null); setFundMeta(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const ledger = createLedgerActor(fundToken, { agentOptions: { identity } });
                const [bal, dec, sym, fee] = await Promise.all([
                    ledger.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] }),
                    ledger.icrc1_decimals(), ledger.icrc1_symbol(), ledger.icrc1_fee(),
                ]);
                if (!cancelled) { setWalletBalance(BigInt(bal)); setFundMeta({ decimals: Number(dec), symbol: sym, fee: BigInt(fee) }); }
            } catch { if (!cancelled) { setWalletBalance(null); setFundMeta(null); } }
        })();
        return () => { cancelled = true; };
    }, [fundToken, identity]);

    const symA = getTokenMetadataSync(tokenA)?.symbol || '???';
    const symB = getTokenMetadataSync(tokenB)?.symbol || '???';
    const decA = getTokenMetadataSync(tokenA)?.decimals ?? 8;
    const decB = getTokenMetadataSync(tokenB)?.decimals ?? 8;
    const feeA = BigInt(getTokenMetadataSync(tokenA)?.fee ?? 10000);
    const feeB = BigInt(getTokenMetadataSync(tokenB)?.fee ?? 10000);
    const fundSymbol = fundMeta?.symbol || getTokenMetadataSync(fundToken)?.symbol || '???';
    const fundDecimals = fundMeta?.decimals ?? getTokenMetadataSync(fundToken)?.decimals ?? 8;

    const canProceedStep1 = tokenA && tokenB && tokenA !== tokenB;
    const canProceedStep2 = sellAMinPrice && sellAMaxPrice && sellBMinPrice && sellBMaxPrice && tradeSizeA && Number(tradeSizeA) > 0 && tradeSizeB && Number(tradeSizeB) > 0 && (!enableStopLoss || (stopLossPrice && Number(stopLossPrice) > 0));

    const formatBal = (raw, dec) => raw == null ? '...' : (Number(raw) / Math.pow(10, dec)).toLocaleString(undefined, { maximumFractionDigits: dec });

    const handleDeploy = async () => {
        setDeploying(true);
        setDeployError('');
        try {
            const bot = await getReadyBotActor();
            setDeployStep('Registering tokens...');
            await bot.addToken({ ledgerCanisterId: Principal.fromText(tokenA), symbol: symA, decimals: decA, fee: feeA });
            await bot.addToken({ ledgerCanisterId: Principal.fromText(tokenB), symbol: symB, decimals: decB, fee: feeB });

            setDeployStep('Creating range trade chore...');
            const instId = 'trade-' + Date.now().toString(36);
            const ok = await bot.createChoreInstance('trade', instId, `Range ${symA}/${symB}`);
            if (!ok) throw new Error('Failed to create chore instance');

            const priceDenomToken = tokenB;
            const priceDec = decB;
            const rawTradeSizeA = BigInt(Math.floor(Number(tradeSizeA) * Math.pow(10, decA)));
            const rawTradeSizeB = BigInt(Math.floor(Number(tradeSizeB) * Math.pow(10, decB)));

            const toRawPrice = (humanPrice) => BigInt(Math.floor(Number(humanPrice) * Math.pow(10, priceDec)));

            if (enableStopLoss && stopLossPrice) {
                setDeployStep('Adding stop loss action...');
                const slInput = stopLossSellToken === 'A' ? tokenA : tokenB;
                const slOutput = stopLossSellToken === 'A' ? tokenB : tokenA;
                await bot.addTradeAction(instId, {
                    actionType: 0, enabled: true,
                    inputToken: Principal.fromText(slInput),
                    outputToken: [Principal.fromText(slOutput)],
                    minAmount: 0n, maxAmount: 0n,
                    amountMode: 1, balancePercent: [10000],
                    preferredDex: [], sourceSubaccount: [], targetSubaccount: [],
                    destinationOwner: [], destinationSubaccount: [],
                    minBalance: [], maxBalance: [], balanceDenominationToken: [],
                    minPrice: [], maxPrice: [toRawPrice(stopLossPrice)],
                    priceDenominationToken: [Principal.fromText(priceDenomToken)],
                    maxPriceImpactBps: [Math.round(Number(stopLossMaxImpact) * 100)],
                    maxSlippageBps: [Math.round(Number(stopLossMaxSlippage) * 100)],
                    minFrequencySeconds: [], maxFrequencySeconds: [],
                    tradeSizeDenominationToken: [],
                });
            }

            setDeployStep('Adding sell-A range action...');
            await bot.addTradeAction(instId, {
                actionType: 0, enabled: true,
                inputToken: Principal.fromText(tokenA),
                outputToken: [Principal.fromText(tokenB)],
                minAmount: rawTradeSizeA, maxAmount: rawTradeSizeA,
                amountMode: 0, balancePercent: [],
                preferredDex: [], sourceSubaccount: [], targetSubaccount: [],
                destinationOwner: [], destinationSubaccount: [],
                minBalance: [], maxBalance: [], balanceDenominationToken: [],
                minPrice: [toRawPrice(sellAMinPrice)], maxPrice: [toRawPrice(sellAMaxPrice)],
                priceDenominationToken: [Principal.fromText(priceDenomToken)],
                maxPriceImpactBps: [300], maxSlippageBps: [200],
                minFrequencySeconds: [], maxFrequencySeconds: [],
                tradeSizeDenominationToken: [],
            });

            setDeployStep('Adding sell-B range action...');
            await bot.addTradeAction(instId, {
                actionType: 0, enabled: true,
                inputToken: Principal.fromText(tokenB),
                outputToken: [Principal.fromText(tokenA)],
                minAmount: rawTradeSizeB, maxAmount: rawTradeSizeB,
                amountMode: 0, balancePercent: [],
                preferredDex: [], sourceSubaccount: [], targetSubaccount: [],
                destinationOwner: [], destinationSubaccount: [],
                minBalance: [], maxBalance: [], balanceDenominationToken: [],
                minPrice: [toRawPrice(sellBMinPrice)], maxPrice: [toRawPrice(sellBMaxPrice)],
                priceDenominationToken: [Principal.fromText(priceDenomToken)],
                maxPriceImpactBps: [300], maxSlippageBps: [200],
                minFrequencySeconds: [], maxFrequencySeconds: [],
                tradeSizeDenominationToken: [],
            });

            setDeployStep('Setting chore interval...');
            await bot.setChoreInterval(instId, Number(intervalMinutes) * 60);

            if (fundAmount && Number(fundAmount) > 0 && fundToken) {
                setDeployStep('Funding bot...');
                const rawFund = BigInt(Math.floor(Number(fundAmount) * Math.pow(10, fundDecimals)));
                const ledger = createLedgerActor(fundToken, { agentOptions: { identity } });
                await ledger.icrc1_transfer({
                    to: { owner: Principal.fromText(canisterId), subaccount: [] },
                    amount: rawFund, fee: [], memo: [], from_subaccount: [], created_at_time: [],
                });
            }

            setDeployStep('Starting chore...');
            await bot.startChore(instId);
            setDeploySuccess(true);
        } catch (e) {
            setDeployError(e.message || 'Deployment failed');
        } finally { setDeploying(false); setDeployStep(''); }
    };

    const stepLabels = ['Tokens', 'Ranges', 'Fund & Deploy'];
    const messages = {
        1: `Range trading lets you profit from price oscillations! Pick the two tokens you want to trade between.`,
        2: `Define your price ranges. When ${symA} is expensive, sell it for ${symB}. When ${symB} is expensive, sell it for ${symA}. You can also add a stop loss!`,
        3: `Review your range trade setup and optionally fund the bot to get started right away.`,
    };

    if (deploySuccess) {
        return (
            <div className="wizard-fade-in" style={{ textAlign: 'center' }}>
                <WizardMascot message={`Your range trading bot for ${symA}/${symB} is live! It will trade when prices hit your ranges.`} theme={theme} showSparkles />
                <div style={{ marginTop: '1.5rem' }}>
                    <button onClick={onComplete} style={btnPrimary(theme)}>Done <FaCheck size={12} /></button>
                </div>
            </div>
        );
    }

    return (
        <div>
            <StepProgress steps={stepLabels} currentStep={step} onStepClick={s => !deploying && setStep(s)} theme={theme} />
            <WizardMascot message={messages[step]} theme={theme} size="small" />
            <div style={{ marginTop: '1rem' }}>
                {step === 1 && (
                    <WizardCard theme={theme}>
                        <h4 style={{ color: theme.colors.primaryText, margin: '0 0 14px', fontSize: '1rem', fontWeight: '600' }}>
                            <FaExchangeAlt size={14} color={ACCENT} style={{ marginRight: 8 }} />
                            Select Token Pair
                        </h4>
                        <TokenPairSelector inputToken={tokenA} outputToken={tokenB} onInputChange={setTokenA} onOutputChange={setTokenB} theme={theme} inputLabel="Token A" outputLabel="Token B" />
                        <div style={{ display: 'flex', gap: '10px', marginTop: '1.25rem', flexWrap: 'wrap' }}>
                            <button onClick={onBack} style={btnSecondary(theme)}><FaArrowLeft size={11} /> Back</button>
                            <button onClick={() => setStep(2)} disabled={!canProceedStep1} style={btnPrimary(theme, canProceedStep1)}>Next <FaArrowRight size={11} /></button>
                        </div>
                    </WizardCard>
                )}
                {step === 2 && (
                    <WizardCard theme={theme}>
                        <h4 style={{ color: theme.colors.primaryText, margin: '0 0 14px', fontSize: '1rem', fontWeight: '600' }}>
                            <FaChartLine size={14} color={ACCENT} style={{ marginRight: 8 }} />
                            Price Ranges & Trade Size
                        </h4>
                        <p style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, margin: '0 0 12px', lineHeight: '1.5' }}>
                            Prices are denominated in {symB} per {symA}.
                        </p>
                        <div style={{ padding: '12px', background: `${ACCENT}06`, borderRadius: '10px', border: `1px solid ${ACCENT}15`, marginBottom: '12px' }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '8px' }}>
                                Sell {symA} for {symB} when price is:
                            </div>
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                <AmountInput label={`Min price (${symB})`} value={sellAMinPrice} onChange={setSellAMinPrice} theme={theme} />
                                <AmountInput label={`Max price (${symB})`} value={sellAMaxPrice} onChange={setSellAMaxPrice} theme={theme} />
                            </div>
                        </div>
                        <div style={{ padding: '12px', background: `#3b82f606`, borderRadius: '10px', border: '1px solid #3b82f615', marginBottom: '12px' }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '8px' }}>
                                Sell {symB} for {symA} when price is:
                            </div>
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                <AmountInput label={`Min price (${symB})`} value={sellBMinPrice} onChange={setSellBMinPrice} theme={theme} />
                                <AmountInput label={`Max price (${symB})`} value={sellBMaxPrice} onChange={setSellBMaxPrice} theme={theme} />
                            </div>
                        </div>
                        <div style={{ padding: '12px', background: theme.colors.primaryBg, borderRadius: '10px', border: `1px solid ${theme.colors.border}`, marginBottom: '12px' }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '8px' }}>
                                Trade size per execution
                            </div>
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                                <AmountInput label={`Sell ${symA} amount (${symA})`} value={tradeSizeA} onChange={setTradeSizeA} theme={theme} />
                                <AmountInput label={`Sell ${symB} amount (${symB})`} value={tradeSizeB} onChange={setTradeSizeB} theme={theme} />
                            </div>
                            <AmountInput label="Check interval (minutes)" value={intervalMinutes} onChange={setIntervalMinutes} theme={theme} placeholder="5" />
                        </div>
                        <div style={{ padding: '12px', background: enableStopLoss ? '#ef444410' : theme.colors.primaryBg, borderRadius: '10px', border: `1px solid ${enableStopLoss ? '#ef444430' : theme.colors.border}`, marginBottom: '4px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                <input type="checkbox" checked={enableStopLoss} onChange={e => setEnableStopLoss(e.target.checked)} />
                                <FaShieldAlt size={13} color={enableStopLoss ? '#ef4444' : theme.colors.mutedText} />
                                Enable Stop Loss
                            </label>
                            {enableStopLoss && (
                                <div style={{ marginTop: '10px' }}>
                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '10px' }}>
                                        <div style={{ minWidth: '120px' }}>
                                            <label style={{ display: 'block', fontSize: '0.78rem', color: theme.colors.secondaryText, marginBottom: '4px' }}>Sell all of:</label>
                                            <select value={stopLossSellToken} onChange={e => setStopLossSellToken(e.target.value)} style={{ padding: '8px 10px', background: theme.colors.primaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: '8px', color: theme.colors.primaryText, fontSize: '0.85rem' }}>
                                                <option value="A">{symA}</option>
                                                <option value="B">{symB}</option>
                                            </select>
                                        </div>
                                        <AmountInput label={`If price drops below (${symB})`} value={stopLossPrice} onChange={setStopLossPrice} theme={theme} />
                                    </div>
                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                        <AmountInput label="Max slippage (%)" value={stopLossMaxSlippage} onChange={setStopLossMaxSlippage} theme={theme} placeholder="100" />
                                        <AmountInput label="Max price impact (%)" value={stopLossMaxImpact} onChange={setStopLossMaxImpact} theme={theme} placeholder="100" />
                                    </div>
                                    <p style={{ fontSize: '0.75rem', color: theme.colors.mutedText, margin: '6px 0 0', lineHeight: '1.4' }}>
                                        High tolerances ensure the stop loss executes even in volatile conditions. Lower them only if you'd prefer the stop loss to skip rather than accept a bad price.
                                    </p>
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '10px', marginTop: '1.25rem', flexWrap: 'wrap' }}>
                            <button onClick={() => setStep(1)} style={btnSecondary(theme)}><FaArrowLeft size={11} /> Back</button>
                            <button onClick={() => setStep(3)} disabled={!canProceedStep2} style={btnPrimary(theme, canProceedStep2)}>Next <FaArrowRight size={11} /></button>
                        </div>
                    </WizardCard>
                )}
                {step === 3 && (
                    <WizardCard theme={theme}>
                        <h4 style={{ color: theme.colors.primaryText, margin: '0 0 14px', fontSize: '1rem', fontWeight: '600' }}>
                            <FaWallet size={14} color={ACCENT} style={{ marginRight: 8 }} />
                            Fund & Deploy
                        </h4>
                        <div style={{ padding: '12px', background: `${ACCENT}08`, borderRadius: '10px', border: `1px solid ${ACCENT}20`, marginBottom: '14px' }}>
                            <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, marginBottom: '8px' }}>
                                Fund with:
                                <select value={fundToken} onChange={e => setFundToken(e.target.value)} style={{ marginLeft: '8px', padding: '4px 8px', background: theme.colors.primaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: '6px', color: theme.colors.primaryText, fontSize: '0.82rem' }}>
                                    {tokenA && <option value={tokenA}>{symA}</option>}
                                    {tokenB && <option value={tokenB}>{symB}</option>}
                                </select>
                            </div>
                            <div style={{ fontSize: '0.78rem', color: theme.colors.mutedText, marginBottom: '8px' }}>
                                Wallet balance: {formatBal(walletBalance, fundDecimals)} {fundSymbol}
                            </div>
                            <AmountInput label={`Amount to fund (optional)`} value={fundAmount} onChange={setFundAmount} theme={theme} placeholder="0" />
                        </div>
                        <div style={{ padding: '12px', background: theme.colors.primaryBg, borderRadius: '10px', border: `1px solid ${theme.colors.border}`, marginBottom: '14px' }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '8px' }}>Summary</div>
                            <SummaryRow label="Strategy" value="Range Trade" theme={theme} />
                            <SummaryRow label="Pair" value={`${symA} / ${symB}`} theme={theme} />
                            <SummaryRow label={`Sell ${symA} range`} value={`${sellAMinPrice} – ${sellAMaxPrice} ${symB}`} theme={theme} />
                            <SummaryRow label={`Sell ${symA} size`} value={`${tradeSizeA} ${symA}`} theme={theme} />
                            <SummaryRow label={`Sell ${symB} range`} value={`${sellBMinPrice} – ${sellBMaxPrice} ${symB}`} theme={theme} />
                            <SummaryRow label={`Sell ${symB} size`} value={`${tradeSizeB} ${symB}`} theme={theme} />
                            <SummaryRow label="Interval" value={`Every ${intervalMinutes} min`} theme={theme} />
                            {enableStopLoss && <>
                                <SummaryRow label="Stop loss" value={`Sell all ${stopLossSellToken === 'A' ? symA : symB} below ${stopLossPrice} ${symB}`} theme={theme} />
                                <SummaryRow label="Stop loss tolerances" value={`${stopLossMaxSlippage}% slippage, ${stopLossMaxImpact}% impact`} theme={theme} />
                            </>}
                        </div>
                        {deployError && <div style={{ color: theme.colors.error || '#ef4444', fontSize: '0.82rem', padding: '10px 12px', background: `${theme.colors.error || '#ef4444'}15`, borderRadius: '8px', marginBottom: '10px' }}>{deployError}</div>}
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <button onClick={() => setStep(2)} disabled={deploying} style={btnSecondary(theme)}><FaArrowLeft size={11} /> Back</button>
                            <button onClick={handleDeploy} disabled={deploying} style={btnPrimary(theme, !deploying)}>
                                {deploying ? <><FaSpinner size={12} className="wizard-spin" /> {deployStep}</> : <><FaMagic size={12} /> Deploy Range Bot</>}
                            </button>
                        </div>
                    </WizardCard>
                )}
            </div>
        </div>
    );
}

function RebalanceWizard({ theme, onComplete, onBack, getReadyBotActor, canisterId, identity }) {
    const [step, setStep] = useState(1);
    const [targets, setTargets] = useState([{ token: '', targetPct: '' }]);
    const [denomToken, setDenomToken] = useState(ICP_LEDGER);
    const [thresholdPct, setThresholdPct] = useState('5');
    const [intervalMinutes, setIntervalMinutes] = useState('60');
    const [fundTokenIdx, setFundTokenIdx] = useState(0);
    const [fundAmount, setFundAmount] = useState('');
    const [walletBalance, setWalletBalance] = useState(null);
    const [fundMeta, setFundMeta] = useState(null);
    const [deploying, setDeploying] = useState(false);
    const [deployError, setDeployError] = useState('');
    const [deploySuccess, setDeploySuccess] = useState(false);
    const [deployStep, setDeployStep] = useState('');

    const fundToken = targets[fundTokenIdx]?.token || '';

    useEffect(() => {
        if (!fundToken || !identity) { setWalletBalance(null); setFundMeta(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const ledger = createLedgerActor(fundToken, { agentOptions: { identity } });
                const [bal, dec, sym, fee] = await Promise.all([
                    ledger.icrc1_balance_of({ owner: identity.getPrincipal(), subaccount: [] }),
                    ledger.icrc1_decimals(), ledger.icrc1_symbol(), ledger.icrc1_fee(),
                ]);
                if (!cancelled) { setWalletBalance(BigInt(bal)); setFundMeta({ decimals: Number(dec), symbol: sym, fee: BigInt(fee) }); }
            } catch { if (!cancelled) { setWalletBalance(null); setFundMeta(null); } }
        })();
        return () => { cancelled = true; };
    }, [fundToken, identity]);

    const totalPct = targets.reduce((sum, t) => sum + (parseFloat(t.targetPct) || 0), 0);
    const allTokensSet = targets.every(t => t.token && t.targetPct && Number(t.targetPct) > 0);
    const canProceedStep1 = targets.length >= 2 && allTokensSet && Math.abs(totalPct - 100) < 0.01;

    const fundSymbol = fundMeta?.symbol || getTokenMetadataSync(fundToken)?.symbol || '???';
    const fundDecimals = fundMeta?.decimals ?? getTokenMetadataSync(fundToken)?.decimals ?? 8;
    const formatBal = (raw, dec) => raw == null ? '...' : (Number(raw) / Math.pow(10, dec)).toLocaleString(undefined, { maximumFractionDigits: dec });

    const addTarget = () => setTargets([...targets, { token: '', targetPct: '' }]);
    const removeTarget = (i) => { const arr = [...targets]; arr.splice(i, 1); setTargets(arr); if (fundTokenIdx >= arr.length) setFundTokenIdx(0); };
    const updateTarget = (i, field, val) => { const arr = [...targets]; arr[i] = { ...arr[i], [field]: val }; setTargets(arr); };

    const handleDeploy = async () => {
        setDeploying(true);
        setDeployError('');
        try {
            const bot = await getReadyBotActor();
            setDeployStep('Registering tokens...');
            const allTokensToRegister = [...targets.map(t => t.token)];
            if (denomToken && !allTokensToRegister.includes(denomToken)) {
                allTokensToRegister.push(denomToken);
            }
            for (const tokenId of allTokensToRegister) {
                const meta = getTokenMetadataSync(tokenId);
                await bot.addToken({
                    ledgerCanisterId: Principal.fromText(tokenId),
                    symbol: meta?.symbol || '???',
                    decimals: meta?.decimals ?? 8,
                    fee: BigInt(meta?.fee ?? 10000),
                });
            }

            setDeployStep('Creating rebalance chore...');
            const instId = 'rebalance-' + Date.now().toString(36);
            const label = targets.map(t => getTokenMetadataSync(t.token)?.symbol || '?').join('/') + ' Portfolio';
            const ok = await bot.createChoreInstance('rebalance', instId, label);
            if (!ok) throw new Error('Failed to create chore instance');

            setDeployStep('Setting rebalance targets...');
            const formattedTargets = targets.map(t => ({
                token: Principal.fromText(t.token),
                targetBps: Math.round(Number(t.targetPct) * 100),
                paused: false,
            }));
            await bot.setRebalanceTargets(instId, formattedTargets);

            setDeployStep('Configuring settings...');
            await bot.setRebalanceDenominationToken(instId, Principal.fromText(denomToken));
            await bot.setRebalanceThresholdBps(instId, Math.round(Number(thresholdPct) * 100));
            await bot.setChoreInterval(instId, Number(intervalMinutes) * 60);

            if (fundAmount && Number(fundAmount) > 0 && fundToken) {
                setDeployStep('Funding bot...');
                const rawFund = BigInt(Math.floor(Number(fundAmount) * Math.pow(10, fundDecimals)));
                const ledger = createLedgerActor(fundToken, { agentOptions: { identity } });
                await ledger.icrc1_transfer({
                    to: { owner: Principal.fromText(canisterId), subaccount: [] },
                    amount: rawFund, fee: [], memo: [], from_subaccount: [], created_at_time: [],
                });
            }

            setDeployStep('Starting rebalancer...');
            await bot.startChore(instId);
            setDeploySuccess(true);
        } catch (e) {
            setDeployError(e.message || 'Deployment failed');
        } finally { setDeploying(false); setDeployStep(''); }
    };

    const stepLabels = ['Allocations', 'Settings', 'Fund & Deploy'];
    const messages = {
        1: `Build your ideal portfolio! Add the tokens you want and set target allocations. They must add up to 100%.`,
        2: `Now let's fine-tune. Set how much the portfolio can drift before rebalancing kicks in, and how often to check.`,
        3: `Looking good! Fund your bot and let's launch this self-balancing portfolio.`,
    };

    if (deploySuccess) {
        return (
            <div className="wizard-fade-in" style={{ textAlign: 'center' }}>
                <WizardMascot message="Your self-balancing portfolio is live! The rebalancer will keep your allocations on target." theme={theme} showSparkles />
                <div style={{ marginTop: '1.5rem' }}>
                    <button onClick={onComplete} style={btnPrimary(theme)}>Done <FaCheck size={12} /></button>
                </div>
            </div>
        );
    }

    const usedTokens = targets.map(t => t.token).filter(Boolean);

    return (
        <div>
            <StepProgress steps={stepLabels} currentStep={step} onStepClick={s => !deploying && setStep(s)} theme={theme} />
            <WizardMascot message={messages[step]} theme={theme} size="small" />
            <div style={{ marginTop: '1rem' }}>
                {step === 1 && (
                    <WizardCard theme={theme}>
                        <h4 style={{ color: theme.colors.primaryText, margin: '0 0 14px', fontSize: '1rem', fontWeight: '600' }}>
                            <FaBalanceScale size={14} color={ACCENT} style={{ marginRight: 8 }} />
                            Portfolio Allocations
                        </h4>
                        {targets.map((t, i) => (
                            <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div style={{ flex: 2, minWidth: '180px' }}>
                                    {i === 0 && <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: theme.colors.secondaryText, marginBottom: '4px' }}>Token</label>}
                                    <TokenSelector value={t.token} onChange={v => updateTarget(i, 'token', v)} placeholder="Select token..." excludeTokens={usedTokens.filter(tk => tk !== t.token)} />
                                </div>
                                <div style={{ flex: 1, minWidth: '90px' }}>
                                    {i === 0 && <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: theme.colors.secondaryText, marginBottom: '4px' }}>Target %</label>}
                                    <input type="number" value={t.targetPct} onChange={e => updateTarget(i, 'targetPct', e.target.value)} placeholder="%" min="0" max="100"
                                        style={{ width: '100%', padding: '10px 10px', background: theme.colors.primaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: '10px', color: theme.colors.primaryText, fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }} />
                                </div>
                                {targets.length > 2 && (
                                    <button onClick={() => removeTarget(i)} style={{ background: 'none', border: 'none', color: theme.colors.mutedText, cursor: 'pointer', padding: '8px', marginBottom: '2px' }}>
                                        <FaTrash size={12} />
                                    </button>
                                )}
                            </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                            <button onClick={addTarget} style={{ ...btnSecondary(theme), padding: '8px 14px', fontSize: '0.82rem' }}>
                                <FaPlus size={10} /> Add token
                            </button>
                            <div style={{
                                fontSize: '0.85rem', fontWeight: '600',
                                color: Math.abs(totalPct - 100) < 0.01 ? (theme.colors.success || '#22c55e') : totalPct > 100 ? (theme.colors.error || '#ef4444') : theme.colors.primaryText,
                            }}>
                                Total: {totalPct.toFixed(1)}%
                            </div>
                        </div>
                        {Math.abs(totalPct - 100) >= 0.01 && totalPct > 0 && (
                            <div style={{ fontSize: '0.78rem', color: theme.colors.warning || '#f59e0b', marginTop: '6px' }}>
                                Allocations must total exactly 100%.
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: '10px', marginTop: '1.25rem', flexWrap: 'wrap' }}>
                            <button onClick={onBack} style={btnSecondary(theme)}><FaArrowLeft size={11} /> Back</button>
                            <button onClick={() => setStep(2)} disabled={!canProceedStep1} style={btnPrimary(theme, canProceedStep1)}>Next <FaArrowRight size={11} /></button>
                        </div>
                    </WizardCard>
                )}
                {step === 2 && (
                    <WizardCard theme={theme}>
                        <h4 style={{ color: theme.colors.primaryText, margin: '0 0 14px', fontSize: '1rem', fontWeight: '600' }}>
                            Rebalancer Settings
                        </h4>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
                            <AmountInput label="Rebalance threshold (%)" value={thresholdPct} onChange={setThresholdPct} theme={theme} placeholder="5" />
                            <AmountInput label="Check interval (minutes)" value={intervalMinutes} onChange={setIntervalMinutes} theme={theme} placeholder="60" />
                        </div>
                        <div style={{ flex: 1, minWidth: '180px', marginBottom: '4px' }}>
                            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '6px' }}>Denomination token (for valuation)</label>
                            <TokenSelector value={denomToken} onChange={setDenomToken} placeholder="Select denomination..." />
                        </div>
                        <p style={{ fontSize: '0.78rem', color: theme.colors.mutedText, margin: '10px 0 0', lineHeight: '1.5' }}>
                            The rebalancer will trade when any token deviates by more than {thresholdPct || '?'}% from its target. It checks every {intervalMinutes || '?'} minutes.
                        </p>
                        <div style={{ display: 'flex', gap: '10px', marginTop: '1.25rem', flexWrap: 'wrap' }}>
                            <button onClick={() => setStep(1)} style={btnSecondary(theme)}><FaArrowLeft size={11} /> Back</button>
                            <button onClick={() => setStep(3)} style={btnPrimary(theme)}>Next <FaArrowRight size={11} /></button>
                        </div>
                    </WizardCard>
                )}
                {step === 3 && (
                    <WizardCard theme={theme}>
                        <h4 style={{ color: theme.colors.primaryText, margin: '0 0 14px', fontSize: '1rem', fontWeight: '600' }}>
                            <FaWallet size={14} color={ACCENT} style={{ marginRight: 8 }} />
                            Fund & Deploy
                        </h4>
                        <div style={{ padding: '12px', background: `${ACCENT}08`, borderRadius: '10px', border: `1px solid ${ACCENT}20`, marginBottom: '14px' }}>
                            <div style={{ fontSize: '0.82rem', color: theme.colors.secondaryText, marginBottom: '8px' }}>
                                Fund with:
                                <select value={fundTokenIdx} onChange={e => setFundTokenIdx(Number(e.target.value))} style={{ marginLeft: '8px', padding: '4px 8px', background: theme.colors.primaryBg, border: `1px solid ${theme.colors.border}`, borderRadius: '6px', color: theme.colors.primaryText, fontSize: '0.82rem' }}>
                                    {targets.map((t, i) => t.token && (
                                        <option key={i} value={i}>{getTokenMetadataSync(t.token)?.symbol || t.token.slice(0, 8)}</option>
                                    ))}
                                </select>
                            </div>
                            {fundToken && (
                                <div style={{ fontSize: '0.78rem', color: theme.colors.mutedText, marginBottom: '8px' }}>
                                    Wallet balance: {formatBal(walletBalance, fundDecimals)} {fundSymbol}
                                </div>
                            )}
                            <AmountInput label="Amount to fund (optional)" value={fundAmount} onChange={setFundAmount} theme={theme} placeholder="0" />
                        </div>
                        <div style={{ padding: '12px', background: theme.colors.primaryBg, borderRadius: '10px', border: `1px solid ${theme.colors.border}`, marginBottom: '14px' }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: '600', color: theme.colors.primaryText, marginBottom: '8px' }}>Summary</div>
                            <SummaryRow label="Strategy" value="Self-Balancing Portfolio" theme={theme} />
                            {targets.map((t, i) => t.token && (
                                <SummaryRow key={i} label={getTokenMetadataSync(t.token)?.symbol || '???'} value={`${t.targetPct}%`} theme={theme} />
                            ))}
                            <SummaryRow label="Threshold" value={`${thresholdPct}%`} theme={theme} />
                            <SummaryRow label="Interval" value={`Every ${intervalMinutes} min`} theme={theme} />
                        </div>
                        {deployError && <div style={{ color: theme.colors.error || '#ef4444', fontSize: '0.82rem', padding: '10px 12px', background: `${theme.colors.error || '#ef4444'}15`, borderRadius: '8px', marginBottom: '10px' }}>{deployError}</div>}
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <button onClick={() => setStep(2)} disabled={deploying} style={btnSecondary(theme)}><FaArrowLeft size={11} /> Back</button>
                            <button onClick={handleDeploy} disabled={deploying} style={btnPrimary(theme, !deploying)}>
                                {deploying ? <><FaSpinner size={12} className="wizard-spin" /> {deployStep}</> : <><FaMagic size={12} /> Deploy Portfolio</>}
                            </button>
                        </div>
                    </WizardCard>
                )}
            </div>
        </div>
    );
}

function SummaryRow({ label, value, theme }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${theme.colors.border}40`, fontSize: '0.82rem' }}>
            <span style={{ color: theme.colors.secondaryText }}>{label}</span>
            <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>{value}</span>
        </div>
    );
}

function btnPrimary(theme, enabled = true) {
    return {
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        flex: 1, minWidth: '140px', padding: '12px 20px',
        background: enabled ? `linear-gradient(135deg, ${ACCENT}, ${ACCENT_SECONDARY})` : theme.colors.tertiaryBg,
        border: 'none', borderRadius: '12px',
        color: enabled ? '#fff' : theme.colors.mutedText,
        fontSize: '0.9rem', fontWeight: '600',
        cursor: enabled ? 'pointer' : 'not-allowed',
        transition: 'all 0.2s ease',
        boxShadow: enabled ? `0 4px 16px ${ACCENT_GLOW}` : 'none',
        opacity: enabled ? 1 : 0.6,
    };
}

function btnSecondary(theme) {
    return {
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        flex: 0, minWidth: '100px', padding: '12px 18px',
        background: theme.colors.cardGradient || theme.colors.secondaryBg,
        border: `1px solid ${theme.colors.border}`, borderRadius: '12px',
        color: theme.colors.primaryText, fontSize: '0.9rem', fontWeight: '500',
        cursor: 'pointer', transition: 'all 0.2s ease',
    };
}

export default function TradingBotWizard({ isOpen, onClose, getReadyBotActor, canisterId, identity, hasTokens }) {
    const { theme } = useTheme();
    const [scenario, setScenario] = useState(null);

    useEffect(() => {
        if (isOpen) setScenario(null);
    }, [isOpen]);

    if (!isOpen) return null;

    const handleComplete = () => {
        setScenario(null);
        onClose(true);
    };

    const scenarios = [
        {
            id: 'dca',
            icon: <FaChartLine size={22} />,
            title: 'DCA (Dollar Cost Averaging)',
            desc: 'Automatically buy a token at regular intervals to smooth out price volatility.',
            color: ACCENT,
        },
        {
            id: 'range',
            icon: <FaExchangeAlt size={22} />,
            title: 'Range Trade',
            desc: 'Trade between two tokens based on price ranges. Profit from oscillations with optional stop loss.',
            color: '#3b82f6',
        },
        {
            id: 'rebalance',
            icon: <FaBalanceScale size={22} />,
            title: 'Self-Balancing Portfolio',
            desc: 'Maintain target allocations across multiple tokens. Auto-rebalances when drift exceeds threshold.',
            color: '#8b5cf6',
        },
    ];

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
            backdropFilter: 'blur(4px)',
        }} onClick={(e) => { if (e.target === e.currentTarget && !scenario) onClose(false); }}>
            <style>{wizardStyles}</style>
            <div className="wizard-fade-in" style={{
                background: theme.colors.primaryGradient || theme.colors.primaryBg,
                border: `1px solid ${ACCENT}30`,
                borderRadius: '20px',
                padding: '1.5rem',
                maxWidth: '640px',
                width: '100%',
                maxHeight: '90vh',
                overflowY: 'auto',
                position: 'relative',
                boxShadow: `0 16px 64px rgba(0,0,0,0.5), 0 0 0 1px ${ACCENT}15`,
            }}>
                <button
                    onClick={() => scenario ? setScenario(null) : onClose(false)}
                    style={{
                        position: 'absolute', top: '14px', right: '14px',
                        background: 'none', border: 'none', color: theme.colors.mutedText,
                        cursor: 'pointer', padding: '6px', fontSize: '1.1rem', zIndex: 1,
                    }}
                    title={scenario ? 'Back to scenarios' : 'Close wizard'}
                >
                    <FaTimes />
                </button>

                {!scenario ? (
                    <div>
                        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                            <WizardMascot
                                message={hasTokens
                                    ? "Welcome back! Ready to set up a new trading strategy? Pick a scenario below and I'll guide you through it."
                                    : "Welcome to your Trading Bot! I'm the Bot Wizard, and I'll help you get everything set up. Let's start by choosing a trading strategy!"
                                }
                                theme={theme}
                                size="large"
                                showSparkles={!hasTokens}
                            />
                        </div>
                        <h3 style={{
                            color: theme.colors.primaryText, textAlign: 'center',
                            fontSize: '1.15rem', fontWeight: '700', margin: '0 0 1rem',
                        }}>
                            Choose a Strategy
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {scenarios.map(s => (
                                <button
                                    key={s.id}
                                    onClick={() => setScenario(s.id)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '14px',
                                        padding: '16px 18px', background: theme.colors.cardGradient || theme.colors.secondaryBg,
                                        border: `1.5px solid ${theme.colors.border}`,
                                        borderRadius: '14px', cursor: 'pointer',
                                        textAlign: 'left', transition: 'all 0.2s ease',
                                        width: '100%', boxSizing: 'border-box',
                                    }}
                                    onMouseOver={e => { e.currentTarget.style.borderColor = s.color + '80'; e.currentTarget.style.boxShadow = `0 4px 20px ${s.color}20`; }}
                                    onMouseOut={e => { e.currentTarget.style.borderColor = theme.colors.border; e.currentTarget.style.boxShadow = 'none'; }}
                                >
                                    <div style={{
                                        width: '48px', height: '48px', borderRadius: '12px',
                                        background: `${s.color}15`, display: 'flex',
                                        alignItems: 'center', justifyContent: 'center',
                                        color: s.color, flexShrink: 0,
                                    }}>
                                        {s.icon}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: '600', fontSize: '0.95rem', color: theme.colors.primaryText, marginBottom: '3px' }}>
                                            {s.title}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: theme.colors.secondaryText, lineHeight: '1.45' }}>
                                            {s.desc}
                                        </div>
                                    </div>
                                    <FaArrowRight size={12} color={theme.colors.mutedText} style={{ flexShrink: 0 }} />
                                </button>
                            ))}
                        </div>
                    </div>
                ) : scenario === 'dca' ? (
                    <DCAWizard theme={theme} onComplete={handleComplete} onBack={() => setScenario(null)} getReadyBotActor={getReadyBotActor} canisterId={canisterId} identity={identity} />
                ) : scenario === 'range' ? (
                    <RangeTradeWizard theme={theme} onComplete={handleComplete} onBack={() => setScenario(null)} getReadyBotActor={getReadyBotActor} canisterId={canisterId} identity={identity} />
                ) : scenario === 'rebalance' ? (
                    <RebalanceWizard theme={theme} onComplete={handleComplete} onBack={() => setScenario(null)} getReadyBotActor={getReadyBotActor} canisterId={canisterId} identity={identity} />
                ) : null}
            </div>
        </div>
    );
}

export { TradingBotWizard, WizardMascot, WIZARD_SVG_URL };
