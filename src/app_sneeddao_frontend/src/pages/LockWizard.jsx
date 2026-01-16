import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaCoins, FaWater, FaArrowRight, FaLock } from 'react-icons/fa';
import Header from '../components/Header';
import { useAuth } from '../AuthContext';
import { useTheme } from '../contexts/ThemeContext';

function LockWizard() {
    const navigate = useNavigate();
    const { identity, isAuthenticated } = useAuth();
    const { theme } = useTheme();
    const [selectedType, setSelectedType] = useState(null);
    const [isHovering, setIsHovering] = useState(null);

    const handleContinue = () => {
        if (selectedType === 'token') {
            navigate('/wallet?action=lock_token');
        } else if (selectedType === 'position') {
            navigate('/wallet?action=lock_position');
        }
    };

    const styles = {
        container: {
            maxWidth: '800px',
            margin: '0 auto',
            padding: '2rem',
            color: theme.colors.primaryText,
        },
        hero: {
            textAlign: 'center',
            marginBottom: '3rem',
        },
        title: {
            fontSize: '2.5rem',
            marginBottom: '1rem',
            color: theme.colors.primaryText,
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
        },
        subtitle: {
            fontSize: '1.2rem',
            color: theme.colors.mutedText,
            marginBottom: '0.5rem',
            lineHeight: '1.5',
        },
        stepIndicator: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            marginBottom: '2rem',
        },
        stepBadge: {
            background: theme.colors.accent,
            color: theme.colors.primaryBg,
            padding: '6px 16px',
            borderRadius: '20px',
            fontSize: '0.9rem',
            fontWeight: '600',
        },
        stepText: {
            color: theme.colors.mutedText,
            fontSize: '0.9rem',
        },
        optionsGrid: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.5rem',
            marginBottom: '2rem',
        },
        optionCard: (isSelected, isHovered) => ({
            background: isSelected 
                ? theme.colors.accentGradient 
                : theme.colors.cardGradient,
            border: `2px solid ${isSelected ? theme.colors.accent : isHovered ? theme.colors.borderHover : theme.colors.border}`,
            borderRadius: '16px',
            padding: '2rem',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
            boxShadow: isSelected || isHovered 
                ? `0 12px 40px ${theme.colors.accent}20` 
                : theme.colors.cardShadow,
        }),
        optionIcon: (isSelected) => ({
            fontSize: '3rem',
            marginBottom: '1rem',
            color: isSelected ? theme.colors.accent : theme.colors.mutedText,
            transition: 'color 0.3s ease',
        }),
        optionTitle: {
            fontSize: '1.4rem',
            fontWeight: '600',
            marginBottom: '0.75rem',
            color: theme.colors.primaryText,
        },
        optionDescription: {
            fontSize: '0.95rem',
            color: theme.colors.secondaryText,
            lineHeight: '1.5',
            marginBottom: '1rem',
        },
        optionFeatures: {
            listStyle: 'none',
            padding: 0,
            margin: 0,
        },
        optionFeature: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.85rem',
            color: theme.colors.mutedText,
            marginBottom: '6px',
        },
        featureCheck: (isSelected) => ({
            color: isSelected ? theme.colors.success : theme.colors.accent,
            fontSize: '0.9rem',
        }),
        continueButton: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            background: selectedType 
                ? `linear-gradient(135deg, ${theme.colors.accent}, ${theme.colors.accent}dd)` 
                : theme.colors.tertiaryBg,
            color: selectedType ? theme.colors.primaryBg : theme.colors.mutedText,
            padding: '16px 32px',
            borderRadius: '12px',
            border: 'none',
            fontSize: '1.1rem',
            fontWeight: '600',
            cursor: selectedType ? 'pointer' : 'not-allowed',
            transition: 'all 0.3s ease',
            width: '100%',
            maxWidth: '400px',
            margin: '0 auto',
            boxShadow: selectedType ? theme.colors.accentShadow : 'none',
        },
        loginPrompt: {
            textAlign: 'center',
            padding: '3rem',
            background: theme.colors.cardGradient,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '16px',
        },
        loginText: {
            fontSize: '1.2rem',
            color: theme.colors.secondaryText,
            marginBottom: '1.5rem',
        },
    };

    if (!isAuthenticated) {
        return (
            <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
                <Header customLogo="/sneedlock-logo4.png" />
                <main style={styles.container}>
                    <div style={styles.loginPrompt}>
                        <FaLock size={48} style={{ color: theme.colors.mutedText, marginBottom: '1rem' }} />
                        <p style={styles.loginText}>
                            Please log in to access the Lock Wizard
                        </p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header customLogo="/sneedlock-logo4.png" />
            <main style={styles.container}>
                <div style={styles.hero}>
                    <div style={styles.stepIndicator}>
                        <span style={styles.stepBadge}>Step 1 of 3</span>
                        <span style={styles.stepText}>Choose Lock Type</span>
                    </div>
                    <h1 style={styles.title}>
                        <FaLock style={{ color: theme.colors.accent }} />
                        Lock Wizard
                    </h1>
                    <p style={styles.subtitle}>
                        Create a time-based lock on your assets with trustless, on-chain security
                    </p>
                </div>

                <div style={styles.optionsGrid}>
                    {/* Token Lock Option */}
                    <div
                        style={styles.optionCard(selectedType === 'token', isHovering === 'token')}
                        onClick={() => setSelectedType('token')}
                        onMouseEnter={() => setIsHovering('token')}
                        onMouseLeave={() => setIsHovering(null)}
                    >
                        <div style={styles.optionIcon(selectedType === 'token')}>
                            <FaCoins />
                        </div>
                        <h3 style={styles.optionTitle}>Lock Tokens</h3>
                        <p style={styles.optionDescription}>
                            Lock ICRC-1 tokens for a specified period. Perfect for vesting schedules, 
                            proving commitment, or building trust with your community.
                        </p>
                        <ul style={styles.optionFeatures}>
                            <li style={styles.optionFeature}>
                                <span style={styles.featureCheck(selectedType === 'token')}>✓</span>
                                Lock any ICRC-1 token
                            </li>
                            <li style={styles.optionFeature}>
                                <span style={styles.featureCheck(selectedType === 'token')}>✓</span>
                                Liquid Locking™ enabled
                            </li>
                            <li style={styles.optionFeature}>
                                <span style={styles.featureCheck(selectedType === 'token')}>✓</span>
                                Transfer locked tokens
                            </li>
                        </ul>
                    </div>

                    {/* Position Lock Option */}
                    <div
                        style={styles.optionCard(selectedType === 'position', isHovering === 'position')}
                        onClick={() => setSelectedType('position')}
                        onMouseEnter={() => setIsHovering('position')}
                        onMouseLeave={() => setIsHovering(null)}
                    >
                        <div style={styles.optionIcon(selectedType === 'position')}>
                            <FaWater />
                        </div>
                        <h3 style={styles.optionTitle}>Lock Liquidity Position</h3>
                        <p style={styles.optionDescription}>
                            Lock ICPSwap liquidity positions while still earning fees. 
                            Demonstrate LP commitment without sacrificing your yield.
                        </p>
                        <ul style={styles.optionFeatures}>
                            <li style={styles.optionFeature}>
                                <span style={styles.featureCheck(selectedType === 'position')}>✓</span>
                                Keep earning trading fees
                            </li>
                            <li style={styles.optionFeature}>
                                <span style={styles.featureCheck(selectedType === 'position')}>✓</span>
                                Liquid Locking™ enabled
                            </li>
                            <li style={styles.optionFeature}>
                                <span style={styles.featureCheck(selectedType === 'position')}>✓</span>
                                Prove LP commitment
                            </li>
                        </ul>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button
                        style={styles.continueButton}
                        onClick={handleContinue}
                        disabled={!selectedType}
                        onMouseEnter={(e) => {
                            if (selectedType) {
                                e.target.style.transform = 'translateY(-2px)';
                                e.target.style.boxShadow = `0 8px 25px ${theme.colors.accent}40`;
                            }
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.transform = 'translateY(0)';
                            e.target.style.boxShadow = selectedType ? theme.colors.accentShadow : 'none';
                        }}
                    >
                        Continue to Wallet
                        <FaArrowRight />
                    </button>
                </div>

                <p style={{ 
                    textAlign: 'center', 
                    marginTop: '1.5rem', 
                    color: theme.colors.mutedText,
                    fontSize: '0.9rem'
                }}>
                    {selectedType 
                        ? `You'll be taken to your wallet to select a ${selectedType === 'token' ? 'token' : 'liquidity position'} to lock`
                        : 'Select an option above to continue'
                    }
                </p>
            </main>
        </div>
    );
}

export default LockWizard;

