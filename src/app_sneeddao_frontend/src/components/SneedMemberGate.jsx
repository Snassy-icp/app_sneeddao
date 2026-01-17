import React from 'react';
import { Link } from 'react-router-dom';
import { FaLock, FaCheckCircle, FaCrown } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { formatVotingPower } from '../utils/VotingPowerUtils';

/**
 * Gate types for different feature access levels
 */
export const GATE_TYPES = {
    BETA: 'beta',      // Closed beta - will be open to everyone soon
    PREMIUM: 'premium' // Premium feature - exclusive to Sneed members
};

/**
 * Component to show when user doesn't have Sneed membership
 * Displays instructions on how to become a member
 */
export function SneedMemberGateMessage({ 
    gateType = GATE_TYPES.PREMIUM,
    featureName = 'This feature',
    customMessage = null,
    children = null  // Optional content to render after "Coming Soon" message
}) {
    const { theme } = useTheme();
    
    const isBeta = gateType === GATE_TYPES.BETA;
    
    const cardStyle = {
        background: `linear-gradient(135deg, ${theme.colors.cardBackground} 0%, ${theme.colors.headerBg || theme.colors.cardBackground} 100%)`,
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '30px',
        border: `2px solid ${theme.colors.accent}40`
    };

    return (
        <div style={cardStyle}>
            <div style={{ textAlign: 'center' }}>
                {isBeta ? (
                    <FaLock size={48} style={{ color: theme.colors.accent, marginBottom: '16px' }} />
                ) : (
                    <FaCrown size={48} style={{ color: theme.colors.warning || '#f59e0b', marginBottom: '16px' }} />
                )}
                
                <h3 style={{ color: theme.colors.primaryText, marginBottom: '12px' }}>
                    {isBeta ? (
                        <>🧪 Closed Beta – Sneed DAO Members Only</>
                    ) : (
                        <>🌱 Premium Feature – Sneed DAO Members Only</>
                    )}
                </h3>
                
                <p style={{ color: theme.colors.mutedText, marginBottom: '20px', lineHeight: '1.6' }}>
                    {customMessage || (
                        isBeta ? (
                            <>
                                {featureName} is currently in <strong style={{ color: theme.colors.warning || '#f59e0b' }}>closed beta</strong>, 
                                available exclusively to Sneed DAO staking members.
                            </>
                        ) : (
                            <>
                                {featureName} is a <strong style={{ color: theme.colors.warning || '#f59e0b' }}>premium feature</strong>, 
                                available exclusively to Sneed DAO staking members.
                            </>
                        )
                    )}
                    <br />
                    To access this feature, you need to have <strong style={{ color: theme.colors.accent }}>Voting Power &gt; 0</strong> from hotkeyed Sneed neurons.
                </p>

                {isBeta && (
                    <div style={{ 
                        background: `${theme.colors.accent}15`,
                        border: `1px solid ${theme.colors.accent}40`,
                        borderRadius: '8px',
                        padding: '12px 16px',
                        marginBottom: '20px',
                        fontSize: '13px',
                        color: theme.colors.primaryText
                    }}>
                        🎉 <strong>Coming Soon:</strong> This feature will be open to everyone after the beta period!
                    </div>
                )}

                {/* Optional content like countdown timer */}
                {children}
                
                <div style={{ 
                    background: `${theme.colors.warning || '#f59e0b'}15`,
                    border: `1px solid ${theme.colors.warning || '#f59e0b'}40`,
                    borderRadius: '12px',
                    padding: '20px',
                    marginBottom: '24px'
                }}>
                    <h4 style={{ color: theme.colors.warning || '#f59e0b', marginBottom: '12px' }}>
                        {isBeta ? 'How to join the closed beta:' : 'How to become a Sneed DAO member:'}
                    </h4>
                    <ol style={{ 
                        textAlign: 'left', 
                        color: theme.colors.mutedText, 
                        lineHeight: '1.8',
                        paddingLeft: '24px',
                        margin: 0
                    }}>
                        <li>
                            <strong>Create a Sneed Neuron</strong> – You can stake SNEED tokens directly from your{' '}
                            <Link to="/wallet" style={{ color: theme.colors.accent }}>Sneed Wallet</Link>
                        </li>
                        <li>
                            <strong>Add Hotkey Permission</strong> – Add your principal as a hotkey to your Sneed neuron
                        </li>
                        <li>
                            <strong>Return Here</strong> – Once you have Sneed VP, you'll have access to this feature
                        </li>
                    </ol>
                </div>

                <div style={{ 
                    display: 'flex', 
                    gap: '12px', 
                    justifyContent: 'center',
                    flexWrap: 'wrap'
                }}>
                    <Link 
                        to="/wallet"
                        style={{
                            background: theme.colors.accent,
                            color: '#fff',
                            padding: '12px 24px',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            fontSize: '14px',
                            fontWeight: '600',
                        }}
                    >
                        🌱 Go to Sneed Wallet
                    </Link>
                    <Link 
                        to="/neurons"
                        style={{
                            background: 'transparent',
                            color: theme.colors.accent,
                            border: `1px solid ${theme.colors.accent}`,
                            padding: '12px 24px',
                            borderRadius: '8px',
                            textDecoration: 'none',
                            fontSize: '14px',
                            fontWeight: '600',
                        }}
                    >
                        View Sneed Neurons
                    </Link>
                </div>
            </div>
        </div>
    );
}

/**
 * Loading state component while checking membership
 */
export function SneedMemberGateLoading() {
    const { theme } = useTheme();
    
    return (
        <div style={{ 
            background: theme.colors.cardBackground,
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '30px',
            border: `1px solid ${theme.colors.border}`,
            textAlign: 'center'
        }}>
            <p style={{ color: theme.colors.mutedText, margin: 0 }}>
                ⏳ Checking Sneed DAO membership...
            </p>
        </div>
    );
}

/**
 * Badge showing user's Sneed membership status
 */
export function SneedMemberBadge({ sneedNeurons, sneedVotingPower }) {
    const { theme } = useTheme();
    
    return (
        <div style={{ 
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            marginBottom: '20px',
            padding: '12px 20px',
            background: `${theme.colors.success || '#22c55e'}15`,
            border: `1px solid ${theme.colors.success || '#22c55e'}40`,
            borderRadius: '8px',
            flexWrap: 'wrap'
        }}>
            <FaCheckCircle color={theme.colors.success || '#22c55e'} />
            <span style={{ color: theme.colors.success || '#22c55e', fontWeight: '500' }}>
                🌱 Sneed DAO Member
            </span>
            <span style={{ color: theme.colors.mutedText }}>•</span>
            <span style={{ color: theme.colors.primaryText }}>
                {sneedNeurons.length} hotkeyed {sneedNeurons.length === 1 ? 'neuron' : 'neurons'}
            </span>
            <span style={{ color: theme.colors.mutedText }}>•</span>
            <span style={{ color: theme.colors.accent, fontWeight: '600' }}>
                {formatVotingPower(sneedVotingPower)} VP
            </span>
        </div>
    );
}

/**
 * Beta warning banner for features in closed beta
 */
export function BetaWarningBanner({ featureName = 'This feature' }) {
    const { theme } = useTheme();
    
    return (
        <div style={{ 
            background: `linear-gradient(135deg, ${theme.colors.warning || '#f59e0b'}10 0%, ${theme.colors.warning || '#f59e0b'}05 100%)`,
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '20px',
            border: `2px solid ${theme.colors.warning || '#f59e0b'}50`,
            textAlign: 'center'
        }}>
            <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                gap: '8px',
                marginBottom: '12px'
            }}>
                <span style={{ fontSize: '24px' }}>🧪</span>
                <h3 style={{ color: theme.colors.warning || '#f59e0b', margin: 0, fontSize: '18px' }}>
                    Beta Feature
                </h3>
            </div>
            <p style={{ color: theme.colors.mutedText, marginBottom: '12px', lineHeight: '1.6' }}>
                {featureName} is in <strong style={{ color: theme.colors.warning || '#f59e0b' }}>closed beta</strong>. 
                We recommend <strong>testing with small amounts</strong> first to familiarize yourself with the feature.
            </p>
            <p style={{ color: theme.colors.primaryText, fontSize: '13px', margin: 0 }}>
                🎉 Thank you for being an early tester! This feature will soon be open to everyone.
            </p>
        </div>
    );
}

/**
 * Main gate component that wraps content and shows appropriate UI based on membership
 * 
 * @param {Object} props
 * @param {React.ReactNode} props.children - Content to show when user has access
 * @param {boolean} props.isSneedMember - Whether user is a Sneed member
 * @param {boolean} props.loading - Whether membership is being checked
 * @param {Array} props.sneedNeurons - User's hotkeyed Sneed neurons
 * @param {number} props.sneedVotingPower - User's total Sneed VP
 * @param {string} props.gateType - Type of gate (GATE_TYPES.BETA or GATE_TYPES.PREMIUM)
 * @param {string} props.featureName - Name of the feature being gated
 * @param {boolean} props.showBadge - Whether to show the member badge (default: true)
 * @param {boolean} props.showBetaBanner - Whether to show beta banner for beta features (default: true)
 * @param {string} props.customMessage - Custom message for the gate
 */
export function SneedMemberGate({
    children,
    isSneedMember,
    loading,
    sneedNeurons = [],
    sneedVotingPower = 0,
    gateType = GATE_TYPES.PREMIUM,
    featureName = 'This feature',
    showBadge = true,
    showBetaBanner = true,
    customMessage = null
}) {
    // Show loading state
    if (loading) {
        return <SneedMemberGateLoading />;
    }
    
    // Show gate message if not a member
    if (!isSneedMember) {
        return (
            <SneedMemberGateMessage 
                gateType={gateType}
                featureName={featureName}
                customMessage={customMessage}
            />
        );
    }
    
    // User is a member - show badge, optional beta banner, and content
    return (
        <>
            {showBadge && (
                <SneedMemberBadge 
                    sneedNeurons={sneedNeurons}
                    sneedVotingPower={sneedVotingPower}
                />
            )}
            {showBetaBanner && gateType === GATE_TYPES.BETA && (
                <BetaWarningBanner featureName={featureName} />
            )}
            {children}
        </>
    );
}

export default SneedMemberGate;

