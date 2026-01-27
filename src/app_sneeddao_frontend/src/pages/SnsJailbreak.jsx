import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FaArrowRight, FaArrowLeft, FaCheck, FaSpinner, FaUnlock, FaCopy, FaExternalLinkAlt, FaExclamationTriangle, FaBrain, FaChevronDown, FaChevronUp, FaInfoCircle, FaKey } from 'react-icons/fa';
import { Principal } from '@dfinity/principal';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { fetchAndCacheSnsData, fetchSnsLogo, getSnsById } from '../utils/SnsUtils';
import { fetchUserNeuronsForSns, getNeuronId, uint8ArrayToHex, formatE8s, getDissolveState, getNeuronDetails } from '../utils/NeuronUtils';
import { HttpAgent } from '@dfinity/agent';
import PrincipalInput from '../components/PrincipalInput';

const SNEED_SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';
const RAW_GITHUB_BASE_URL = 'https://raw.githubusercontent.com/Snassy-icp/app_sneeddao/main/resources/sns_jailbreak/base_script.js';

function SnsJailbreak() {
    const navigate = useNavigate();
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const { getNeuronDisplayName: getNeuronNameInfo } = useNaming();
    
    // Wizard state
    const [currentStep, setCurrentStep] = useState(1);
    const [isHovering, setIsHovering] = useState(null);
    
    // Step 1: SNS selection
    const [snsList, setSnsList] = useState([]);
    const [loadingSnses, setLoadingSnses] = useState(true);
    const [selectedSnsRoot, setSelectedSnsRoot] = useState('');
    const [snsLogos, setSnsLogos] = useState(new Map());
    const [loadingLogos, setLoadingLogos] = useState(new Set());
    const [showStep1Info, setShowStep1Info] = useState(false);
    
    // Step 2: Neuron selection
    const [snsNeurons, setSnsNeurons] = useState([]);
    const [loadingSnsNeurons, setLoadingSnsNeurons] = useState(false);
    const [selectedNeuronId, setSelectedNeuronId] = useState('');
    const [manualNeuronId, setManualNeuronId] = useState('');
    const [useManualEntry, setUseManualEntry] = useState(false);
    const [showStep2Info, setShowStep2Info] = useState(false);
    const [manualNeuronData, setManualNeuronData] = useState(null);
    const [loadingManualNeuron, setLoadingManualNeuron] = useState(false);
    const [manualNeuronError, setManualNeuronError] = useState('');
    
    // Step 3: Principal selection
    const [targetPrincipal, setTargetPrincipal] = useState('');
    const [principalValid, setPrincipalValid] = useState(false);
    
    // Step 4: Script generation
    const [copied, setCopied] = useState(false);
    const [baseScript, setBaseScript] = useState('');
    const [loadingBaseScript, setLoadingBaseScript] = useState(false);
    const [baseScriptError, setBaseScriptError] = useState('');
    
    // Get selected SNS info
    const selectedSns = snsList.find(s => s.rootCanisterId === selectedSnsRoot);
    const governanceId = selectedSns?.canisters?.governance || '';
    
    // Get effective neuron ID
    const effectiveNeuronId = useManualEntry ? manualNeuronId : selectedNeuronId;
    
    // Load SNS list on mount
    useEffect(() => {
        const loadSnsData = async () => {
            setLoadingSnses(true);
            try {
                const data = await fetchAndCacheSnsData(identity);
                const sortedData = [...data].sort((a, b) => {
                    if (a.rootCanisterId === SNEED_SNS_ROOT) return -1;
                    if (b.rootCanisterId === SNEED_SNS_ROOT) return 1;
                    return a.name.localeCompare(b.name);
                });
                setSnsList(sortedData);
                
                // Start loading logos for all SNSes in parallel
                sortedData.forEach(sns => {
                    if (sns.canisters?.governance) {
                        loadSnsLogo(sns.canisters.governance);
                    }
                });
            } catch (e) {
                console.error('Failed to load SNS data:', e);
            } finally {
                setLoadingSnses(false);
            }
        };
        loadSnsData();
    }, [identity]);
    
    // Load individual SNS logo
    const loadSnsLogo = async (governanceId) => {
        if (snsLogos.has(governanceId) || loadingLogos.has(governanceId)) return;
        
        setLoadingLogos(prev => new Set([...prev, governanceId]));
        
        try {
            const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging' 
                ? 'https://ic0.app' 
                : 'http://localhost:4943';
            const agent = new HttpAgent({ host, ...(identity && { identity }) });
            
            if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                await agent.fetchRootKey();
            }
            
            const logo = await fetchSnsLogo(governanceId, agent);
            setSnsLogos(prev => new Map(prev).set(governanceId, logo));
        } catch (error) {
            console.error(`Error loading logo for SNS ${governanceId}:`, error);
        } finally {
            setLoadingLogos(prev => {
                const next = new Set(prev);
                next.delete(governanceId);
                return next;
            });
        }
    };
    
    // Fetch base script when entering step 4
    useEffect(() => {
        if (currentStep === 4 && !baseScript && !loadingBaseScript) {
            fetchBaseScript();
        }
    }, [currentStep, baseScript, loadingBaseScript]);
    
    // Fetch the base script from GitHub
    const fetchBaseScript = async () => {
        setLoadingBaseScript(true);
        setBaseScriptError('');
        try {
            const response = await fetch(RAW_GITHUB_BASE_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
            }
            const script = await response.text();
            setBaseScript(script);
        } catch (error) {
            console.error('Error fetching base script:', error);
            setBaseScriptError(`Failed to load base script: ${error.message}`);
        } finally {
            setLoadingBaseScript(false);
        }
    };
    
    // Set default principal when authenticated
    useEffect(() => {
        if (identity && !targetPrincipal) {
            setTargetPrincipal(identity.getPrincipal().toText());
            setPrincipalValid(true);
        }
    }, [identity, targetPrincipal]);
    
    // Fetch neurons when SNS is selected
    const fetchNeuronsForSelectedSns = useCallback(async (snsRoot) => {
        if (!identity || !snsRoot) {
            setSnsNeurons([]);
            return;
        }
        
        setLoadingSnsNeurons(true);
        try {
            const snsData = getSnsById(snsRoot);
            if (!snsData) {
                setSnsNeurons([]);
                return;
            }
            
            const neurons = await fetchUserNeuronsForSns(identity, snsData.canisters.governance);
            
            // Filter to neurons where user has any permissions (hotkey)
            const userPrincipal = identity.getPrincipal().toString();
            const hotkeyNeurons = neurons.filter(neuron => {
                return neuron.permissions?.some(p => 
                    p.principal?.[0]?.toString() === userPrincipal
                );
            });
            
            setSnsNeurons(hotkeyNeurons);
        } catch (e) {
            console.error('Failed to fetch neurons:', e);
            setSnsNeurons([]);
        } finally {
            setLoadingSnsNeurons(false);
        }
    }, [identity]);
    
    // Extract neuron ID robustly
    const extractNeuronId = useCallback((neuron) => {
        // Try standard structure: neuron.id[0].id (Candid opt type)
        if (neuron.id && Array.isArray(neuron.id) && neuron.id.length > 0 && neuron.id[0]?.id) {
            return uint8ArrayToHex(neuron.id[0].id);
        }
        // Try direct id structure: neuron.id.id
        if (neuron.id && neuron.id.id && !Array.isArray(neuron.id)) {
            return uint8ArrayToHex(neuron.id.id);
        }
        // Try if id is directly bytes
        if (neuron.id && (neuron.id instanceof Uint8Array || (Array.isArray(neuron.id) && typeof neuron.id[0] === 'number'))) {
            return uint8ArrayToHex(neuron.id);
        }
        // Fallback
        return getNeuronId(neuron);
    }, []);
    
    // Get display name for a neuron
    const getNeuronDisplayName = useCallback((neuron, snsRoot) => {
        const idHex = extractNeuronId(neuron) || '';
        const shortId = idHex.length > 16 ? idHex.slice(0, 8) + '...' + idHex.slice(-8) : (idHex || '???');
        const stake = neuron.cached_neuron_stake_e8s ? 
            formatE8s(neuron.cached_neuron_stake_e8s) : '0';
        
        // Try to get name/nickname from naming context
        let displayName = shortId;
        if (snsRoot && idHex && getNeuronNameInfo) {
            const nameInfo = getNeuronNameInfo(idHex, snsRoot);
            if (nameInfo) {
                if (nameInfo.nickname) {
                    displayName = `🏷️ ${nameInfo.nickname}`;
                } else if (nameInfo.name) {
                    displayName = nameInfo.name;
                }
            }
        }
        
        return `${displayName} (${stake} tokens)`;
    }, [extractNeuronId, getNeuronNameInfo]);
    
    // Generate the JavaScript code (combined base + custom)
    const generateScript = useCallback(() => {
        if (!governanceId || !effectiveNeuronId || !targetPrincipal || !baseScript) return '';
        
        const customScript = `
// ============================================================
// SNS Jailbreak Script - Generated by Sneed Hub
// ============================================================
// This script adds a controller to your SNS neuron
// GitHub Source: ${RAW_GITHUB_BASE_URL}
// ============================================================

// Custom parameters:
const GOVERNANCE_ID = "${governanceId}";
const NEURON_ID = "${effectiveNeuronId}";
const NEW_CONTROLLER = "${targetPrincipal}";

// Execute after base script is ready
(async () => {
    console.log('🔓 Adding controller to SNS neuron...');
    console.log('  Governance: ' + GOVERNANCE_ID);
    console.log('  Neuron ID: ' + NEURON_ID);
    console.log('  New Controller: ' + NEW_CONTROLLER);
    
    try {
        await yolosns.addControllerToNeuron(
            GOVERNANCE_ID,
            NEURON_ID,
            NEW_CONTROLLER
        );
        console.log('✅ Controller added successfully!');
        console.log('🎉 Your neuron is now jailbroken! You can manage it from Sneed Hub.');
    } catch (error) {
        console.error('❌ Error adding controller:', error);
    }
})();
`;
        
        return baseScript + '\n\n' + customScript;
    }, [governanceId, effectiveNeuronId, targetPrincipal, baseScript]);
    
    // Copy to clipboard
    const handleCopy = async () => {
        const script = generateScript();
        try {
            await navigator.clipboard.writeText(script);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            console.error('Failed to copy:', e);
        }
    };
    
    // Validate manual neuron ID (should be hex string)
    const isValidNeuronId = (id) => {
        return id && /^[a-f0-9]+$/i.test(id) && id.length >= 32;
    };
    
    // Fetch manual neuron data when ID is valid
    useEffect(() => {
        const fetchManualNeuron = async () => {
            if (!isValidNeuronId(manualNeuronId) || !governanceId || !identity) {
                setManualNeuronData(null);
                setManualNeuronError('');
                return;
            }
            
            setLoadingManualNeuron(true);
            setManualNeuronError('');
            
            try {
                const neuron = await getNeuronDetails(identity, governanceId, manualNeuronId);
                if (neuron) {
                    setManualNeuronData(neuron);
                } else {
                    setManualNeuronData(null);
                    setManualNeuronError('Neuron not found. Please check the ID.');
                }
            } catch (error) {
                console.error('Error fetching manual neuron:', error);
                setManualNeuronData(null);
                setManualNeuronError('Failed to fetch neuron data.');
            } finally {
                setLoadingManualNeuron(false);
            }
        };
        
        // Debounce the fetch
        const timeout = setTimeout(fetchManualNeuron, 500);
        return () => clearTimeout(timeout);
    }, [manualNeuronId, governanceId, identity]);
    
    // Go to step with reset
    const goToStep = (step) => {
        if (step < currentStep) {
            setCurrentStep(step);
            if (step === 1) {
                setSelectedNeuronId('');
                setManualNeuronId('');
                setManualNeuronData(null);
                setManualNeuronError('');
                setUseManualEntry(false);
            }
        }
    };
    
    // Check if can proceed to next step
    const canProceed = () => {
        switch (currentStep) {
            case 1: return !!selectedSnsRoot;
            case 2: 
                if (useManualEntry) {
                    // Must have valid ID and either loaded data or allow proceeding with valid format
                    return isValidNeuronId(manualNeuronId) && (manualNeuronData || !manualNeuronError);
                }
                return !!selectedNeuronId;
            case 3: return principalValid && targetPrincipal;
            case 4: return !!baseScript && !loadingBaseScript;
            default: return true;
        }
    };
    
    // Styles
    const styles = {
        container: {
            maxWidth: '900px',
            margin: '0 auto',
            padding: '2rem',
            color: theme.colors.primaryText,
        },
        hero: {
            textAlign: 'center',
            marginBottom: '2rem',
        },
        title: {
            fontSize: '2.2rem',
            marginBottom: '0.5rem',
            color: theme.colors.primaryText,
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
        },
        subtitle: {
            fontSize: '1.1rem',
            color: theme.colors.mutedText,
            marginBottom: '0.5rem',
            lineHeight: '1.5',
        },
        stepProgress: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0',
            marginBottom: '2rem',
        },
        stepCircle: (stepNum, isActive, isCompleted) => ({
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '600',
            fontSize: '1rem',
            background: isCompleted 
                ? theme.colors.success 
                : isActive 
                    ? theme.colors.accent 
                    : theme.colors.tertiaryBg,
            color: isCompleted || isActive ? theme.colors.primaryBg : theme.colors.mutedText,
            border: `2px solid ${isCompleted ? theme.colors.success : isActive ? theme.colors.accent : theme.colors.border}`,
            cursor: isCompleted ? 'pointer' : 'default',
            transition: 'all 0.3s ease',
        }),
        stepLine: (isCompleted) => ({
            width: '60px',
            height: '3px',
            background: isCompleted ? theme.colors.success : theme.colors.border,
            transition: 'all 0.3s ease',
        }),
        stepLabel: (isActive) => ({
            fontSize: '0.75rem',
            color: isActive ? theme.colors.primaryText : theme.colors.mutedText,
            marginTop: '6px',
            textAlign: 'center',
        }),
        card: {
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
            padding: '2rem',
            marginBottom: '1.5rem',
        },
        snsItem: (isSelected) => ({
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '16px',
            background: isSelected ? theme.colors.accentGradient : theme.colors.cardGradient,
            border: `2px solid ${isSelected ? theme.colors.accent : theme.colors.border}`,
            borderRadius: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            marginBottom: '8px',
        }),
        snsLogo: {
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            objectFit: 'cover',
            background: theme.colors.secondaryBg,
        },
        snsName: {
            fontSize: '1.1rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
        },
        neuronCard: (isSelected) => ({
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '16px',
            background: isSelected ? theme.colors.accentGradient : theme.colors.cardGradient,
            border: `2px solid ${isSelected ? theme.colors.accent : theme.colors.border}`,
            borderRadius: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            marginBottom: '8px',
        }),
        input: {
            width: '100%',
            padding: '12px',
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '8px',
            color: theme.colors.primaryText,
            fontSize: '0.95rem',
        },
        label: {
            display: 'block',
            color: theme.colors.primaryText,
            marginBottom: '8px',
            fontWeight: '500',
        },
        codeBlock: {
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '8px',
            padding: '1rem',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            color: theme.colors.primaryText,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: '300px',
            overflow: 'auto',
        },
        buttonRow: {
            display: 'flex',
            gap: '12px',
            marginTop: '2rem',
        },
        backButton: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            flex: 1,
            padding: '14px 24px',
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '10px',
            color: theme.colors.primaryText,
            fontSize: '1rem',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
        },
        continueButton: (isEnabled) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            flex: 2,
            padding: '14px 24px',
            background: isEnabled 
                ? `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}dd)` 
                : theme.colors.tertiaryBg,
            border: 'none',
            borderRadius: '10px',
            color: isEnabled ? theme.colors.primaryBg : theme.colors.mutedText,
            fontSize: '1rem',
            fontWeight: '600',
            cursor: isEnabled ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s ease',
            boxShadow: isEnabled ? theme.colors.accentShadow : 'none',
        }),
        warningBox: {
            background: `${theme.colors.warning}15`,
            border: `1px solid ${theme.colors.warning}30`,
            borderRadius: '12px',
            padding: '1rem',
            marginBottom: '1.5rem',
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start',
        },
        infoBox: {
            background: `${theme.colors.accent}10`,
            border: `1px solid ${theme.colors.accent}30`,
            borderRadius: '12px',
            marginBottom: '1.5rem',
            overflow: 'hidden',
        },
        infoHeader: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            cursor: 'pointer',
            gap: '12px',
        },
        infoContent: {
            padding: '0 16px 16px 16px',
            color: theme.colors.secondaryText,
            fontSize: '0.9rem',
            lineHeight: '1.6',
        },
        successCard: {
            textAlign: 'center',
            padding: '3rem',
            background: theme.colors.cardGradient,
            border: `2px solid ${theme.colors.success}`,
            borderRadius: '16px',
        },
        successIcon: {
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: `${theme.colors.success}20`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.5rem',
        },
        loadingContainer: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '3rem',
            gap: '1rem',
        },
        spinner: {
            animation: 'spin 1s linear infinite',
        },
        loginPrompt: {
            textAlign: 'center',
            padding: '3rem',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
        },
        instructionStep: {
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start',
            marginBottom: '1rem',
            padding: '12px',
            background: theme.colors.secondaryBg,
            borderRadius: '8px',
        },
        instructionNumber: {
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            background: theme.colors.accent,
            color: theme.colors.primaryBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 'bold',
            fontSize: '0.9rem',
            flexShrink: 0,
        },
        toggle: {
            display: 'flex',
            gap: '8px',
            marginBottom: '1rem',
        },
        toggleButton: (isActive) => ({
            flex: 1,
            padding: '10px 16px',
            background: isActive ? theme.colors.accent : theme.colors.secondaryBg,
            border: `1px solid ${isActive ? theme.colors.accent : theme.colors.border}`,
            borderRadius: '8px',
            color: isActive ? theme.colors.primaryBg : theme.colors.primaryText,
            cursor: 'pointer',
            fontWeight: isActive ? '600' : '400',
            transition: 'all 0.2s ease',
        }),
        principalCode: {
            background: theme.colors.secondaryBg,
            padding: '8px 12px',
            borderRadius: '6px',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            wordBreak: 'break-all',
            color: theme.colors.accent,
        },
    };
    
    const spinnerKeyframes = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    
    if (!isAuthenticated) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header />
                <main style={styles.container}>
                    <div style={styles.loginPrompt}>
                        <FaUnlock size={48} style={{ color: theme.colors.mutedText, marginBottom: '1rem' }} />
                        <p style={{ fontSize: '1.2rem', color: theme.colors.secondaryText }}>
                            Please log in to access the SNS Jailbreak Wizard
                        </p>
                    </div>
                </main>
            </div>
        );
    }
    
    const stepLabels = ['SNS', 'Neuron', 'Principal', 'Generate', 'Done'];
    
    const renderStepProgress = () => (
        <div style={styles.stepProgress}>
            <style>{spinnerKeyframes}</style>
            {[1, 2, 3, 4, 5].map((stepNum, index) => (
                <React.Fragment key={stepNum}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div 
                            style={styles.stepCircle(stepNum, stepNum === currentStep, stepNum < currentStep)}
                            onClick={() => stepNum < currentStep && goToStep(stepNum)}
                        >
                            {stepNum < currentStep ? <FaCheck size={16} /> : stepNum}
                        </div>
                        <div style={styles.stepLabel(stepNum === currentStep)}>
                            {stepLabels[stepNum - 1]}
                        </div>
                    </div>
                    {index < 4 && <div style={styles.stepLine(stepNum < currentStep)} />}
                </React.Fragment>
            ))}
        </div>
    );
    
    // Step 1: Select SNS
    const renderStep1 = () => (
        <>
            <div style={styles.hero}>
                <h1 style={styles.title}>
                    <FaUnlock style={{ color: theme.colors.accent }} />
                    SNS Jailbreak
                </h1>
                <p style={styles.subtitle}>
                    Add your Sneed Wallet as a controller to manage your SNS neuron from Sneed Hub
                </p>
            </div>
            
            {/* Collapsible Info Section */}
            <div style={styles.infoBox}>
                <div 
                    style={styles.infoHeader}
                    onClick={() => setShowStep1Info(!showStep1Info)}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <FaInfoCircle style={{ color: theme.colors.accent }} />
                        <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                            How does SNS Jailbreak work?
                        </span>
                    </div>
                    {showStep1Info ? <FaChevronUp style={{ color: theme.colors.mutedText }} /> : <FaChevronDown style={{ color: theme.colors.mutedText }} />}
                </div>
                
                {showStep1Info && (
                    <div style={styles.infoContent}>
                        <p style={{ marginBottom: '12px' }}>
                            <strong>What is SNS Jailbreak?</strong><br />
                            SNS neurons are normally controlled only through the NNS app. This wizard helps you add your Sneed Wallet 
                            as a full controller, allowing you to manage, transfer, and even trade your neurons on Sneedex.
                        </p>
                        
                        <p style={{ marginBottom: '12px' }}>
                            <strong>The Process:</strong>
                        </p>
                        <ol style={{ marginLeft: '1.5rem', marginBottom: '12px' }}>
                            <li>Select the SNS and neuron you want to jailbreak</li>
                            <li>Choose which principal to add as controller (your Sneed Wallet by default)</li>
                            <li>Copy the generated JavaScript code</li>
                            <li>Open the NNS app (<a href="https://nns.ic0.app" target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent }}>nns.ic0.app</a>) in a browser</li>
                            <li>Open the browser console and paste the script</li>
                            <li>Done! Your neuron can now be managed from Sneed Hub</li>
                        </ol>
                        
                        <p style={{ marginBottom: '12px' }}>
                            <strong>⚠️ Requirements:</strong><br />
                            You need a desktop browser that supports opening a JavaScript console (Chrome, Firefox, Edge, Safari, etc.). 
                            Press <code style={{ background: theme.colors.tertiaryBg, padding: '2px 6px', borderRadius: '4px' }}>Ctrl+Shift+J</code> (Windows/Linux) 
                            or <code style={{ background: theme.colors.tertiaryBg, padding: '2px 6px', borderRadius: '4px' }}>Cmd+Option+J</code> (Mac) to open it.
                        </p>
                        
                        <p style={{ margin: 0 }}>
                            <strong>Is it safe?</strong><br />
                            This script only <em>adds</em> a controller - it doesn't remove existing ones. You'll still be able to 
                            control your neuron from the NNS app. The script is open-source and can be verified on{' '}
                            <a 
                                href="https://github.com/Snassy-icp/app_sneeddao/blob/main/resources/sns_jailbreak/base_script.js"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: theme.colors.accent }}
                            >
                                GitHub
                            </a>.
                        </p>
                    </div>
                )}
            </div>
            
            <div style={styles.card}>
                <label style={styles.label}>Select an SNS</label>
                
                {loadingSnses ? (
                    <div style={styles.loadingContainer}>
                        <FaSpinner size={32} style={{ ...styles.spinner, color: theme.colors.accent }} />
                        <p style={{ color: theme.colors.mutedText }}>Loading SNS DAOs...</p>
                    </div>
                ) : (
                    <div style={{ maxHeight: '400px', overflow: 'auto' }}>
                        {snsList.map(sns => {
                            const logo = snsLogos.get(sns.canisters?.governance);
                            const isLoadingLogo = loadingLogos.has(sns.canisters?.governance);
                            
                            return (
                                <div
                                    key={sns.rootCanisterId}
                                    style={styles.snsItem(selectedSnsRoot === sns.rootCanisterId)}
                                    onClick={() => {
                                        setSelectedSnsRoot(sns.rootCanisterId);
                                        setSelectedNeuronId('');
                                        setManualNeuronId('');
                                        setManualNeuronData(null);
                                        setManualNeuronError('');
                                        fetchNeuronsForSelectedSns(sns.rootCanisterId);
                                    }}
                                >
                                    {isLoadingLogo ? (
                                        <div style={{ 
                                            ...styles.snsLogo, 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'center',
                                            background: theme.colors.border 
                                        }}>
                                            <FaSpinner size={16} style={{ ...styles.spinner, color: theme.colors.mutedText }} />
                                        </div>
                                    ) : logo ? (
                                        <img 
                                            src={logo} 
                                            alt={sns.name}
                                            style={styles.snsLogo}
                                            onError={(e) => { e.target.style.display = 'none'; }}
                                        />
                                    ) : (
                                        <div style={{ ...styles.snsLogo, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <FaBrain size={20} style={{ color: theme.colors.mutedText }} />
                                        </div>
                                    )}
                                    <div>
                                        <div style={styles.snsName}>{sns.name}</div>
                                        <div style={{ fontSize: '0.85rem', color: theme.colors.mutedText }}>
                                            {sns.rootCanisterId.slice(0, 10)}...
                                        </div>
                                    </div>
                                    {selectedSnsRoot === sns.rootCanisterId && (
                                        <FaCheck style={{ color: theme.colors.accent, marginLeft: 'auto' }} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            
            <div style={styles.buttonRow}>
                <button
                    style={styles.continueButton(canProceed())}
                    onClick={() => canProceed() && setCurrentStep(2)}
                    disabled={!canProceed()}
                >
                    Continue
                    <FaArrowRight />
                </button>
            </div>
        </>
    );
    
    // Step 2: Select Neuron
    const renderStep2 = () => (
        <>
            <div style={styles.hero}>
                <h1 style={styles.title}>
                    <FaUnlock style={{ color: theme.colors.accent }} />
                    Select Neuron
                </h1>
                <p style={styles.subtitle}>
                    Choose the {selectedSns?.name} neuron you want to jailbreak
                </p>
            </div>
            
            {/* Collapsible Info Section about Hotkeys */}
            <div style={styles.infoBox}>
                <div 
                    style={styles.infoHeader}
                    onClick={() => setShowStep2Info(!showStep2Info)}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <FaKey style={{ color: theme.colors.accent }} />
                        <span style={{ color: theme.colors.primaryText, fontWeight: '500' }}>
                            Don't see your neuron? Add a hotkey first (optional)
                        </span>
                    </div>
                    {showStep2Info ? <FaChevronUp style={{ color: theme.colors.mutedText }} /> : <FaChevronDown style={{ color: theme.colors.mutedText }} />}
                </div>
                
                {showStep2Info && (
                    <div style={styles.infoContent}>
                        <p style={{ marginBottom: '12px' }}>
                            The "My Neurons" tab shows neurons where your current logged-in principal has hotkey access. 
                            If you don't see your neuron here, you can either:
                        </p>
                        
                        <p style={{ marginBottom: '12px' }}>
                            <strong>Option 1: Enter manually</strong><br />
                            Switch to the "Enter Manually" tab and paste your neuron ID directly.
                        </p>
                        
                        <p style={{ marginBottom: '12px' }}>
                            <strong>Option 2: Add your Sneed Wallet as a hotkey in NNS</strong><br />
                            Go to the NNS app → Select your neuron → Add Hotkey → Enter this principal:
                        </p>
                        
                        <div style={styles.principalCode}>
                            {identity?.getPrincipal().toText()}
                        </div>
                        
                        <p style={{ marginTop: '12px', marginBottom: 0 }}>
                            After adding the hotkey, refresh this page and your neuron will appear in the list.
                        </p>
                    </div>
                )}
            </div>
            
            <div style={styles.card}>
                <div style={styles.toggle}>
                    <button 
                        style={styles.toggleButton(!useManualEntry)}
                        onClick={() => setUseManualEntry(false)}
                    >
                        My Neurons
                    </button>
                    <button 
                        style={styles.toggleButton(useManualEntry)}
                        onClick={() => setUseManualEntry(true)}
                    >
                        Enter Manually
                    </button>
                </div>
                
                {!useManualEntry ? (
                    <>
                        {loadingSnsNeurons ? (
                            <div style={styles.loadingContainer}>
                                <FaSpinner size={32} style={{ ...styles.spinner, color: theme.colors.accent }} />
                                <p style={{ color: theme.colors.mutedText }}>Loading your neurons...</p>
                            </div>
                        ) : snsNeurons.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '2rem', color: theme.colors.mutedText }}>
                                <p style={{ marginBottom: '1rem' }}>No neurons found where you have hotkey access.</p>
                                <button 
                                    onClick={() => setUseManualEntry(true)}
                                    style={{
                                        background: theme.colors.accent,
                                        color: theme.colors.primaryBg,
                                        border: 'none',
                                        padding: '10px 20px',
                                        borderRadius: '8px',
                                        cursor: 'pointer',
                                    }}
                                >
                                    Enter Neuron ID Manually
                                </button>
                            </div>
                        ) : (
                            <div style={{ maxHeight: '350px', overflow: 'auto' }}>
                                {snsNeurons.map(neuron => {
                                    const neuronId = extractNeuronId(neuron);
                                    if (!neuronId) return null;
                                    
                                    return (
                                        <div
                                            key={neuronId}
                                            style={styles.neuronCard(selectedNeuronId === neuronId)}
                                            onClick={() => setSelectedNeuronId(neuronId)}
                                        >
                                            <FaBrain style={{ color: theme.colors.accent, flexShrink: 0, fontSize: '1.5rem' }} />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: '600', color: theme.colors.primaryText }}>
                                                    {getNeuronDisplayName(neuron, selectedSnsRoot)}
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, wordBreak: 'break-all' }}>
                                                    {neuronId.slice(0, 16)}...{neuronId.slice(-16)}
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>
                                                    {getDissolveState(neuron)}
                                                </div>
                                            </div>
                                            {selectedNeuronId === neuronId && (
                                                <FaCheck style={{ color: theme.colors.accent }} />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                ) : (
                    <div>
                        <label style={styles.label}>Neuron ID (hex string)</label>
                        <input
                            type="text"
                            style={styles.input}
                            value={manualNeuronId}
                            onChange={(e) => setManualNeuronId(e.target.value.replace(/[^a-f0-9]/gi, ''))}
                            placeholder="Enter the neuron ID as a hex string..."
                        />
                        {manualNeuronId && !isValidNeuronId(manualNeuronId) && (
                            <p style={{ color: theme.colors.error, fontSize: '0.85rem', marginTop: '0.5rem' }}>
                                Invalid neuron ID. Must be a hex string of at least 32 characters.
                            </p>
                        )}
                        
                        {/* Show neuron card when loading or loaded */}
                        {isValidNeuronId(manualNeuronId) && (
                            <div style={{ marginTop: '1rem' }}>
                                {loadingManualNeuron ? (
                                    <div 
                                        style={{ 
                                            ...styles.neuronCard(false),
                                            cursor: 'default',
                                        }}
                                    >
                                        <FaSpinner style={{ color: theme.colors.accent, flexShrink: 0, fontSize: '1.5rem', animation: 'spin 1s linear infinite' }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: '600', color: theme.colors.primaryText }}>
                                                Loading neuron...
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, wordBreak: 'break-all' }}>
                                                {manualNeuronId.slice(0, 16)}...{manualNeuronId.slice(-16)}
                                            </div>
                                        </div>
                                    </div>
                                ) : manualNeuronError ? (
                                    <div 
                                        style={{ 
                                            ...styles.neuronCard(false),
                                            cursor: 'default',
                                            borderColor: theme.colors.error,
                                        }}
                                    >
                                        <FaExclamationTriangle style={{ color: theme.colors.error, flexShrink: 0, fontSize: '1.5rem' }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: '600', color: theme.colors.error }}>
                                                {manualNeuronError}
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, wordBreak: 'break-all' }}>
                                                {manualNeuronId.slice(0, 16)}...{manualNeuronId.slice(-16)}
                                            </div>
                                        </div>
                                    </div>
                                ) : manualNeuronData ? (
                                    <div 
                                        style={{ 
                                            ...styles.neuronCard(true),
                                            cursor: 'default',
                                        }}
                                    >
                                        <FaBrain style={{ color: theme.colors.accent, flexShrink: 0, fontSize: '1.5rem' }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: '600', color: theme.colors.primaryText }}>
                                                {getNeuronDisplayName(manualNeuronData, selectedSnsRoot)}
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText, wordBreak: 'break-all' }}>
                                                {manualNeuronId.slice(0, 16)}...{manualNeuronId.slice(-16)}
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: theme.colors.mutedText }}>
                                                {getDissolveState(manualNeuronData)}
                                            </div>
                                        </div>
                                        <FaCheck style={{ color: theme.colors.accent }} />
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </div>
                )}
                
                {effectiveNeuronId && (
                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${theme.colors.border}` }}>
                        <Link 
                            to={`/neuron?sns=${selectedSnsRoot}&neuronid=${effectiveNeuronId}`}
                            target="_blank"
                            style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '8px',
                                color: theme.colors.accent,
                                fontSize: '0.9rem',
                                textDecoration: 'none',
                            }}
                        >
                            <FaExternalLinkAlt size={12} />
                            View neuron details
                        </Link>
                    </div>
                )}
            </div>
            
            <div style={styles.buttonRow}>
                <button style={styles.backButton} onClick={() => goToStep(1)}>
                    <FaArrowLeft />
                    Back
                </button>
                <button
                    style={styles.continueButton(canProceed())}
                    onClick={() => canProceed() && setCurrentStep(3)}
                    disabled={!canProceed()}
                >
                    Continue
                    <FaArrowRight />
                </button>
            </div>
        </>
    );
    
    // Step 3: Select Principal
    const renderStep3 = () => (
        <>
            <div style={styles.hero}>
                <h1 style={styles.title}>
                    <FaUnlock style={{ color: theme.colors.accent }} />
                    Select Controller
                </h1>
                <p style={styles.subtitle}>
                    Choose which principal to add as a full controller
                </p>
            </div>
            
            <div style={styles.card}>
                <label style={styles.label}>Principal to Add as Controller</label>
                <p style={{ color: theme.colors.mutedText, fontSize: '0.9rem', marginBottom: '1rem' }}>
                    This principal will be added with full permissions. Your current principal is pre-selected.
                </p>
                
                <PrincipalInput
                    value={targetPrincipal}
                    onChange={(value) => setTargetPrincipal(value)}
                    onValidChange={(isValid) => setPrincipalValid(isValid)}
                    placeholder="Enter a principal ID..."
                />
                
                {identity && targetPrincipal !== identity.getPrincipal().toText() && (
                    <button
                        onClick={() => {
                            setTargetPrincipal(identity.getPrincipal().toText());
                            setPrincipalValid(true);
                        }}
                        style={{
                            marginTop: '0.5rem',
                            background: 'none',
                            border: 'none',
                            color: theme.colors.accent,
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            padding: '4px 0',
                        }}
                    >
                        Use my principal
                    </button>
                )}
            </div>
            
            <div style={styles.buttonRow}>
                <button style={styles.backButton} onClick={() => goToStep(2)}>
                    <FaArrowLeft />
                    Back
                </button>
                <button
                    style={styles.continueButton(canProceed())}
                    onClick={() => canProceed() && setCurrentStep(4)}
                    disabled={!canProceed()}
                >
                    Continue
                    <FaArrowRight />
                </button>
            </div>
        </>
    );
    
    // Step 4: Generate Script
    const renderStep4 = () => (
        <>
            <div style={styles.hero}>
                <h1 style={styles.title}>
                    <FaUnlock style={{ color: theme.colors.accent }} />
                    Generated Script
                </h1>
                <p style={styles.subtitle}>
                    Copy this script and run it in the NNS app browser console
                </p>
            </div>
            
            <div style={styles.warningBox}>
                <FaExclamationTriangle size={24} style={{ color: theme.colors.warning, flexShrink: 0 }} />
                <div>
                    <div style={{ fontWeight: '600', color: theme.colors.warning, marginBottom: '4px' }}>
                        Security Notice
                    </div>
                    <p style={{ color: theme.colors.secondaryText, fontSize: '0.9rem', margin: 0 }}>
                        Only run scripts in your browser console that you trust. This script is open-source 
                        and you can verify the source code on{' '}
                        <a 
                            href="https://github.com/Snassy-icp/app_sneeddao/blob/main/resources/sns_jailbreak/base_script.js"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: theme.colors.accent }}
                        >
                            GitHub
                        </a>.
                    </p>
                </div>
            </div>
            
            <div style={styles.card}>
                {loadingBaseScript ? (
                    <div style={styles.loadingContainer}>
                        <FaSpinner size={32} style={{ ...styles.spinner, color: theme.colors.accent }} />
                        <p style={{ color: theme.colors.mutedText }}>Loading script from GitHub...</p>
                    </div>
                ) : baseScriptError ? (
                    <div style={{ textAlign: 'center', padding: '2rem' }}>
                        <p style={{ color: theme.colors.error, marginBottom: '1rem' }}>{baseScriptError}</p>
                        <button
                            onClick={fetchBaseScript}
                            style={{
                                background: theme.colors.accent,
                                color: theme.colors.primaryBg,
                                border: 'none',
                                padding: '10px 20px',
                                borderRadius: '8px',
                                cursor: 'pointer',
                            }}
                        >
                            Retry
                        </button>
                    </div>
                ) : (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <label style={{ ...styles.label, margin: 0 }}>JavaScript Code</label>
                            <button
                                onClick={handleCopy}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    background: copied ? theme.colors.success : theme.colors.accent,
                                    color: theme.colors.primaryBg,
                                    border: 'none',
                                    padding: '8px 16px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontWeight: '500',
                                }}
                            >
                                {copied ? <FaCheck /> : <FaCopy />}
                                {copied ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                        <pre style={styles.codeBlock}>{generateScript()}</pre>
                    </>
                )}
            </div>
            
            <div style={styles.card}>
                <label style={styles.label}>Instructions</label>
                
                <div style={styles.instructionStep}>
                    <div style={styles.instructionNumber}>1</div>
                    <div>
                        <div style={{ fontWeight: '500', color: theme.colors.primaryText }}>Open NNS App</div>
                        <p style={{ color: theme.colors.mutedText, margin: '4px 0 0 0', fontSize: '0.9rem' }}>
                            Go to{' '}
                            <a 
                                href="https://nns.ic0.app" 
                                target="_blank" 
                                rel="noopener noreferrer"
                                style={{ color: theme.colors.accent }}
                            >
                                nns.ic0.app
                            </a>{' '}
                            in a new tab
                        </p>
                    </div>
                </div>
                
                <div style={styles.instructionStep}>
                    <div style={styles.instructionNumber}>2</div>
                    <div>
                        <div style={{ fontWeight: '500', color: theme.colors.primaryText }}>Log In</div>
                        <p style={{ color: theme.colors.mutedText, margin: '4px 0 0 0', fontSize: '0.9rem' }}>
                            Log in with the identity that owns/controls the neuron
                        </p>
                    </div>
                </div>
                
                <div style={styles.instructionStep}>
                    <div style={styles.instructionNumber}>3</div>
                    <div>
                        <div style={{ fontWeight: '500', color: theme.colors.primaryText }}>Open Console</div>
                        <p style={{ color: theme.colors.mutedText, margin: '4px 0 0 0', fontSize: '0.9rem' }}>
                            Press <code style={{ background: theme.colors.secondaryBg, padding: '2px 6px', borderRadius: '4px' }}>
                            Ctrl+Shift+J</code> (Windows/Linux) or{' '}
                            <code style={{ background: theme.colors.secondaryBg, padding: '2px 6px', borderRadius: '4px' }}>
                            Cmd+Option+J</code> (Mac)
                        </p>
                    </div>
                </div>
                
                <div style={styles.instructionStep}>
                    <div style={styles.instructionNumber}>4</div>
                    <div>
                        <div style={{ fontWeight: '500', color: theme.colors.primaryText }}>Paste & Run</div>
                        <p style={{ color: theme.colors.mutedText, margin: '4px 0 0 0', fontSize: '0.9rem' }}>
                            Paste the copied script and press Enter. Wait for the success message.
                        </p>
                    </div>
                </div>
                
                <div style={styles.instructionStep}>
                    <div style={styles.instructionNumber}>5</div>
                    <div>
                        <div style={{ fontWeight: '500', color: theme.colors.primaryText }}>Verify</div>
                        <p style={{ color: theme.colors.mutedText, margin: '4px 0 0 0', fontSize: '0.9rem' }}>
                            When done, click "I've Done It" to verify the controller was added
                        </p>
                    </div>
                </div>
            </div>
            
            <div style={styles.buttonRow}>
                <button style={styles.backButton} onClick={() => goToStep(3)}>
                    <FaArrowLeft />
                    Back
                </button>
                <button
                    style={styles.continueButton(canProceed())}
                    onClick={() => canProceed() && setCurrentStep(5)}
                    disabled={!canProceed()}
                >
                    I've Done It
                    <FaArrowRight />
                </button>
            </div>
        </>
    );
    
    // Step 5: Confirmation
    const renderStep5 = () => (
        <div style={styles.successCard}>
            <div style={styles.successIcon}>
                <FaCheck size={40} style={{ color: theme.colors.success }} />
            </div>
            <h2 style={{ color: theme.colors.primaryText, marginBottom: '1rem', fontSize: '1.8rem' }}>
                Neuron Jailbroken!
            </h2>
            <p style={{ color: theme.colors.secondaryText, marginBottom: '1.5rem', fontSize: '1.1rem' }}>
                Your {selectedSns?.name} neuron now has <strong>{targetPrincipal.slice(0, 10)}...{targetPrincipal.slice(-5)}</strong> as a controller.
            </p>
            
            <div style={{ 
                background: theme.colors.secondaryBg, 
                borderRadius: '12px', 
                padding: '1.5rem', 
                marginBottom: '2rem',
                textAlign: 'left'
            }}>
                <h3 style={{ color: theme.colors.primaryText, marginBottom: '1rem', fontSize: '1rem' }}>
                    What You Can Do Now:
                </h3>
                <ul style={{ color: theme.colors.secondaryText, margin: 0, paddingLeft: '1.5rem' }}>
                    <li style={{ marginBottom: '8px' }}>Manage the neuron from Sneed Hub's neuron page</li>
                    <li style={{ marginBottom: '8px' }}>Add or remove hotkeys with custom permissions</li>
                    <li style={{ marginBottom: '8px' }}>Transfer the neuron between wallets</li>
                    <li style={{ marginBottom: '8px' }}>Trade the neuron on Sneedex</li>
                    <li>The neuron is now a fully liquid SNS neuron!</li>
                </ul>
            </div>
            
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <Link
                    to={`/neuron?sns=${selectedSnsRoot}&neuronid=${effectiveNeuronId}`}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '14px 28px',
                        background: `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}dd)`,
                        color: theme.colors.primaryBg,
                        borderRadius: '10px',
                        textDecoration: 'none',
                        fontWeight: '600',
                    }}
                >
                    <FaExternalLinkAlt />
                    View Neuron
                </Link>
                <button
                    onClick={() => {
                        setCurrentStep(1);
                        setSelectedSnsRoot('');
                        setSelectedNeuronId('');
                        setManualNeuronId('');
                        setManualNeuronData(null);
                        setManualNeuronError('');
                        setUseManualEntry(false);
                        setSnsNeurons([]);
                        setBaseScript('');
                    }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '14px 28px',
                        background: theme.colors.secondaryBg,
                        border: `1px solid ${theme.colors.border}`,
                        color: theme.colors.primaryText,
                        borderRadius: '10px',
                        cursor: 'pointer',
                        fontWeight: '500',
                    }}
                >
                    Jailbreak Another
                </button>
            </div>
        </div>
    );
    
    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={styles.container}>
                {renderStepProgress()}
                {currentStep === 1 && renderStep1()}
                {currentStep === 2 && renderStep2()}
                {currentStep === 3 && renderStep3()}
                {currentStep === 4 && renderStep4()}
                {currentStep === 5 && renderStep5()}
            </main>
        </div>
    );
}

export default SnsJailbreak;
