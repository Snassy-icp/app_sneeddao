import React from 'react';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { FaExclamationTriangle, FaShieldAlt, FaBan, FaUserShield, FaBalanceScale, FaGavel, FaFileContract } from 'react-icons/fa';

// Custom CSS for animations
const customAnimations = `
@keyframes fadeInUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes disclaimerPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
}

.disclaimer-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.disclaimer-pulse {
    animation: disclaimerPulse 2s ease-in-out infinite;
}
`;

// Page accent colors - red/warning theme for legal content
const disclaimerPrimary = '#ef4444';
const disclaimerSecondary = '#f87171';

const getStyles = (theme) => ({
  container: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '1.25rem',
    color: theme.colors.primaryText,
  },
  section: {
    background: theme.colors.cardGradient,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: '16px',
    padding: '1.25rem',
    marginBottom: '1rem',
    boxShadow: theme.colors.cardShadow,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '1rem',
  },
  sectionIcon: (color = disclaimerPrimary) => ({
    width: '40px',
    height: '40px',
    borderRadius: '12px',
    background: `linear-gradient(135deg, ${color}20, ${color}10)`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  }),
  subheading: {
    fontSize: '1.1rem',
    fontWeight: '700',
    color: theme.colors.primaryText,
    margin: 0,
  },
  paragraph: {
    marginBottom: '0.75rem',
    lineHeight: '1.7',
    color: theme.colors.secondaryText,
    fontSize: '0.9rem',
  },
  list: {
    marginLeft: '1.25rem',
    marginBottom: '0',
    paddingLeft: '0.5rem',
  },
  listItem: {
    marginBottom: '0.5rem',
    color: theme.colors.secondaryText,
    fontSize: '0.9rem',
    lineHeight: '1.6',
  },
  warningBox: {
    background: `linear-gradient(135deg, ${disclaimerPrimary}15, ${disclaimerPrimary}08)`,
    border: `2px solid ${disclaimerPrimary}40`,
    borderRadius: '16px',
    padding: '1.5rem',
    marginBottom: '1rem',
    position: 'relative',
    overflow: 'hidden',
  },
  warningGlow: {
    position: 'absolute',
    top: '-50%',
    right: '-20%',
    width: '200px',
    height: '200px',
    background: `radial-gradient(circle, ${disclaimerPrimary}15 0%, transparent 70%)`,
    pointerEvents: 'none',
  },
  warningHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '1rem',
  },
  warningIcon: {
    width: '48px',
    height: '48px',
    borderRadius: '14px',
    background: `linear-gradient(135deg, ${disclaimerPrimary}, ${disclaimerSecondary})`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    boxShadow: `0 8px 24px ${disclaimerPrimary}40`,
  },
  warningHeading: {
    color: disclaimerPrimary,
    fontSize: '1.1rem',
    fontWeight: '700',
    margin: 0,
  },
  warningText: {
    color: disclaimerPrimary,
    marginBottom: '0.75rem',
    lineHeight: '1.7',
    fontSize: '0.9rem',
    fontWeight: '500',
  },
});

function Disclaimer() {
  const { theme } = useTheme();
  const styles = getStyles(theme);

  return (
    <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
      <style>{customAnimations}</style>
      <Header />
      
      {/* Hero Banner */}
      <div style={{
        background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${disclaimerPrimary}12 50%, ${disclaimerSecondary}08 100%)`,
        borderBottom: `1px solid ${theme.colors.border}`,
        padding: '2rem 1rem',
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        {/* Background decorations */}
        <div style={{
          position: 'absolute',
          top: '-30%',
          right: '-5%',
          width: '300px',
          height: '300px',
          background: `radial-gradient(circle, ${disclaimerPrimary}15 0%, transparent 70%)`,
          pointerEvents: 'none'
        }} />
        
        <div className="disclaimer-fade-in" style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
          <div className="disclaimer-pulse" style={{
            width: '72px',
            height: '72px',
            borderRadius: '18px',
            background: `linear-gradient(135deg, ${disclaimerPrimary}, ${disclaimerSecondary})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem',
            boxShadow: `0 12px 40px ${disclaimerPrimary}50`,
          }}>
            <FaExclamationTriangle size={32} style={{ color: '#fff' }} />
          </div>
          
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            borderRadius: '20px',
            background: `${disclaimerPrimary}15`,
            color: disclaimerPrimary,
            fontSize: '0.8rem',
            fontWeight: '600',
            marginBottom: '0.75rem'
          }}>
            <FaFileContract size={12} />
            Legal Notice
          </div>
          
          <h1 style={{
            fontSize: '1.75rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            margin: '0 0 0.5rem',
            letterSpacing: '-0.5px'
          }}>
            Disclaimer
          </h1>
          <p style={{
            fontSize: '0.95rem',
            color: theme.colors.secondaryText,
            margin: 0
          }}>
            Important legal information and risk disclosures
          </p>
        </div>
      </div>
      
      <main style={styles.container}>
        {/* Important Notice Warning Box */}
        <div className="disclaimer-fade-in" style={styles.warningBox}>
          <div style={styles.warningGlow} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={styles.warningHeader}>
              <div style={styles.warningIcon}>
                <FaExclamationTriangle size={22} style={{ color: '#fff' }} />
              </div>
              <h2 style={styles.warningHeading}>IMPORTANT NOTICE - NO RESPONSIBILITY DISCLAIMER</h2>
            </div>
            <p style={styles.warningText}>
              BY USING THE SNEED DAO PLATFORM, YOU EXPLICITLY ACKNOWLEDGE AND AGREE THAT YOU ARE USING THE PLATFORM ENTIRELY AT YOUR OWN RISK. WE ACCEPT ABSOLUTELY NO RESPONSIBILITY OR LIABILITY WHATSOEVER FOR ANY CONSEQUENCES RESULTING FROM YOUR USE OF THE PLATFORM.
            </p>
            <p style={{ ...styles.warningText, marginBottom: 0 }}>
              THIS INCLUDES, BUT IS NOT LIMITED TO: FINANCIAL LOSSES, TECHNICAL ISSUES, SECURITY BREACHES, SMART CONTRACT VULNERABILITIES, REGULATORY COMPLIANCE, OR ANY OTHER POTENTIAL RISKS OR DAMAGES.
            </p>
          </div>
        </div>

        {/* Complete Disclaimer of Liability */}
        <div className="disclaimer-fade-in" style={{ ...styles.section, animationDelay: '0.05s' }}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionIcon()}>
              <FaShieldAlt size={18} style={{ color: disclaimerPrimary }} />
            </div>
            <h2 style={styles.subheading}>Complete Disclaimer of Liability</h2>
          </div>
          <p style={{ ...styles.paragraph, marginBottom: 0 }}>
            The SNEED DAO platform is provided strictly on an "AS IS" and "AS AVAILABLE" basis. We make no warranties, representations, or guarantees of any kind, whether express or implied, regarding the platform's operation, security, reliability, or suitability for any purpose.
          </p>
        </div>

        {/* Absolute Non-Responsibility Statement */}
        <div className="disclaimer-fade-in" style={{ ...styles.section, animationDelay: '0.1s' }}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionIcon()}>
              <FaBan size={18} style={{ color: disclaimerPrimary }} />
            </div>
            <h2 style={styles.subheading}>Absolute Non-Responsibility Statement</h2>
          </div>
          <p style={styles.paragraph}>
            We explicitly disclaim all responsibility and liability for:
          </p>
          <ul style={styles.list}>
            <li style={styles.listItem}>Any financial losses or damages of any kind</li>
            <li style={styles.listItem}>The accuracy, completeness, or reliability of any information provided</li>
            <li style={styles.listItem}>Any technical issues, downtime, or platform malfunctions</li>
            <li style={styles.listItem}>Any security breaches or unauthorized access</li>
            <li style={styles.listItem}>Any smart contract vulnerabilities or bugs</li>
            <li style={styles.listItem}>Any regulatory or legal compliance issues</li>
            <li style={styles.listItem}>Any decisions made based on information from the platform</li>
            <li style={styles.listItem}>Any third-party services or integrations</li>
            <li style={styles.listItem}>Any consequences of platform upgrades or changes</li>
          </ul>
        </div>

        {/* High-Risk Activity Warning */}
        <div className="disclaimer-fade-in" style={{ ...styles.section, animationDelay: '0.15s' }}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionIcon('#f59e0b')}>
              <FaExclamationTriangle size={18} style={{ color: '#f59e0b' }} />
            </div>
            <h2 style={styles.subheading}>High-Risk Activity Warning</h2>
          </div>
          <p style={styles.paragraph}>
            Cryptocurrency and DAO participation are EXTREMELY HIGH-RISK activities. You acknowledge that:
          </p>
          <ul style={styles.list}>
            <li style={styles.listItem}>You could lose ALL of your invested funds</li>
            <li style={styles.listItem}>Cryptocurrency values are highly volatile and unpredictable</li>
            <li style={styles.listItem}>Smart contracts may contain unknown vulnerabilities</li>
            <li style={styles.listItem}>Regulatory changes could impact platform operations</li>
            <li style={styles.listItem}>Technical failures could result in permanent loss of access</li>
          </ul>
        </div>

        {/* User Responsibility */}
        <div className="disclaimer-fade-in" style={{ ...styles.section, animationDelay: '0.2s' }}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionIcon('#3b82f6')}>
              <FaUserShield size={18} style={{ color: '#3b82f6' }} />
            </div>
            <h2 style={styles.subheading}>User Responsibility</h2>
          </div>
          <p style={styles.paragraph}>
            You are SOLELY and ENTIRELY responsible for:
          </p>
          <ul style={styles.list}>
            <li style={styles.listItem}>Conducting your own research and due diligence</li>
            <li style={styles.listItem}>Understanding all risks involved</li>
            <li style={styles.listItem}>Securing your own wallet and credentials</li>
            <li style={styles.listItem}>Complying with all applicable laws and regulations</li>
            <li style={styles.listItem}>Verifying all information independently</li>
            <li style={styles.listItem}>Managing your own investment decisions</li>
            <li style={styles.listItem}>Any tax obligations or reporting requirements</li>
          </ul>
        </div>

        {/* No Financial Advice */}
        <div className="disclaimer-fade-in" style={{ ...styles.section, animationDelay: '0.25s' }}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionIcon('#10b981')}>
              <FaBalanceScale size={18} style={{ color: '#10b981' }} />
            </div>
            <h2 style={styles.subheading}>No Financial Advice</h2>
          </div>
          <p style={{ ...styles.paragraph, marginBottom: 0 }}>
            Nothing on this platform constitutes financial, investment, legal, or tax advice. Any numbers, metrics, or statistics shown are for informational purposes only and should not be relied upon for any decision-making.
          </p>
        </div>

        {/* Indemnification */}
        <div className="disclaimer-fade-in" style={{ ...styles.section, animationDelay: '0.3s' }}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionIcon('#8b5cf6')}>
              <FaGavel size={18} style={{ color: '#8b5cf6' }} />
            </div>
            <h2 style={styles.subheading}>Indemnification</h2>
          </div>
          <p style={{ ...styles.paragraph, marginBottom: 0 }}>
            By using the platform, you agree to indemnify, defend, and hold harmless SNEED DAO, its developers, contributors, and affiliates from and against ANY and ALL claims, damages, losses, costs, investigations, liabilities, judgments, settlements, and expenses.
          </p>
        </div>

        {/* Final Warning Box */}
        <div className="disclaimer-fade-in" style={{ ...styles.warningBox, animationDelay: '0.35s' }}>
          <div style={styles.warningGlow} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={styles.warningHeader}>
              <div style={styles.warningIcon}>
                <FaExclamationTriangle size={22} style={{ color: '#fff' }} />
              </div>
              <h2 style={styles.warningHeading}>Final Warning</h2>
            </div>
            <p style={{ ...styles.warningText, marginBottom: 0 }}>
              IF YOU DO NOT AGREE WITH ANY PART OF THIS DISCLAIMER OR DO NOT ACCEPT THE RISKS INVOLVED, DO NOT USE THE PLATFORM. CONTINUED USE OF THE PLATFORM CONSTITUTES YOUR EXPLICIT ACCEPTANCE OF ALL RISKS AND YOUR ACKNOWLEDGMENT THAT YOU ARE ACTING ENTIRELY AT YOUR OWN RISK.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default Disclaimer; 