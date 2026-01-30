import React from 'react';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { FaUsers, FaLightbulb, FaCubes, FaLink, FaVoteYea, FaRocket, FaCheckCircle, FaTimesCircle, FaExternalLinkAlt, FaHandshake, FaGlobe, FaChartLine } from 'react-icons/fa';

// Custom CSS for animations
const customStyles = `
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

@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}

.dao-float {
    animation: float 3s ease-in-out infinite;
}

.dao-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.dao-fade-in-delay {
    animation: fadeInUp 0.5s ease-out 0.15s forwards;
    opacity: 0;
}
`;

// Page accent colors - green/teal theme for DAO
const daoPrimary = '#10b981';
const daoSecondary = '#34d399';

// Theme-aware styles function
const getStyles = (theme) => ({
    container: {
        maxWidth: '900px',
        margin: '0 auto',
        padding: '1.5rem 1rem',
        color: theme.colors.primaryText,
    },
    section: {
        backgroundColor: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '20px',
        padding: '1.5rem',
        marginBottom: '1rem',
        boxShadow: theme.colors.cardShadow,
    },
    sectionHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '1rem',
    },
    sectionIcon: {
        width: '44px',
        height: '44px',
        borderRadius: '12px',
        background: `linear-gradient(135deg, ${daoPrimary}20, ${daoPrimary}10)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    sectionTitle: {
        fontSize: '1.25rem',
        fontWeight: '700',
        color: theme.colors.primaryText,
        margin: 0,
    },
    paragraph: {
        marginBottom: '0.75rem',
        lineHeight: '1.7',
        color: theme.colors.secondaryText,
        fontSize: '0.95rem',
    },
    featureGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '12px',
    },
    featureBox: {
        backgroundColor: `${daoPrimary}08`,
        border: `1px solid ${daoPrimary}20`,
        padding: '1.25rem',
        borderRadius: '14px',
    },
    featureTitle: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontSize: '1rem',
        fontWeight: '600',
        color: theme.colors.primaryText,
        marginBottom: '0.5rem',
    },
    featureIcon: {
        width: '32px',
        height: '32px',
        borderRadius: '8px',
        background: `linear-gradient(135deg, ${daoPrimary}, ${daoSecondary})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    comparisonGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '12px',
        marginTop: '0.5rem',
    },
    comparisonBox: (isGood) => ({
        backgroundColor: isGood ? `${theme.colors.success}08` : `${theme.colors.error}08`,
        border: `1px solid ${isGood ? theme.colors.success : theme.colors.error}25`,
        padding: '1.25rem',
        borderRadius: '14px',
    }),
    comparisonTitle: (isGood) => ({
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontSize: '1rem',
        fontWeight: '600',
        color: isGood ? theme.colors.success : theme.colors.error,
        marginBottom: '0.75rem',
    }),
    comparisonList: {
        listStyle: 'none',
        padding: 0,
        margin: 0,
    },
    comparisonItem: (isGood) => ({
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        marginBottom: '0.5rem',
        color: theme.colors.secondaryText,
        fontSize: '0.9rem',
        lineHeight: '1.5',
    }),
    stepCard: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '14px',
        padding: '1rem',
        background: `${daoPrimary}08`,
        border: `1px solid ${daoPrimary}20`,
        borderRadius: '12px',
        marginBottom: '10px',
    },
    stepNumber: {
        width: '32px',
        height: '32px',
        borderRadius: '8px',
        background: `linear-gradient(135deg, ${daoPrimary}, ${daoSecondary})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontWeight: '700',
        fontSize: '0.9rem',
        flexShrink: 0,
    },
    linkGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '12px',
        marginTop: '0.5rem',
    },
    linkBox: {
        backgroundColor: `${daoPrimary}08`,
        border: `1px solid ${daoPrimary}20`,
        padding: '1.25rem',
        borderRadius: '14px',
    },
    linkBoxTitle: {
        fontSize: '1rem',
        fontWeight: '600',
        color: theme.colors.primaryText,
        marginBottom: '0.75rem',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    linkList: {
        listStyle: 'none',
        padding: 0,
        margin: 0,
    },
    linkItem: {
        marginBottom: '0.5rem',
    },
    link: {
        color: daoPrimary,
        textDecoration: 'none',
        fontSize: '0.9rem',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        transition: 'all 0.2s ease',
    },
});

function Dao() {
    const { theme } = useTheme();
    const styles = getStyles(theme);

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${daoPrimary}12 50%, ${daoSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2.5rem 1rem',
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* Background decorations */}
                <div style={{
                    position: 'absolute',
                    top: '-30%',
                    right: '-5%',
                    width: '350px',
                    height: '350px',
                    background: `radial-gradient(circle, ${daoPrimary}15 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-50%',
                    left: '5%',
                    width: '250px',
                    height: '250px',
                    background: `radial-gradient(circle, ${daoSecondary}10 0%, transparent 70%)`,
                    pointerEvents: 'none'
                }} />
                
                <div className="dao-fade-in" style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
                    <div className="dao-float" style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '20px',
                        background: `linear-gradient(135deg, ${daoPrimary}, ${daoSecondary})`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 1.25rem',
                        boxShadow: `0 12px 40px ${daoPrimary}50`,
                    }}>
                        <FaUsers size={36} style={{ color: '#fff' }} />
                    </div>
                    
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        background: `${daoPrimary}20`,
                        color: daoPrimary,
                        padding: '6px 14px',
                        borderRadius: '20px',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        marginBottom: '0.75rem'
                    }}>
                        <FaCubes size={12} /> Community-Owned SNS DAO
                    </div>
                    
                    <h1 style={{
                        fontSize: '2rem',
                        fontWeight: '700',
                        color: theme.colors.primaryText,
                        margin: '0 0 0.75rem',
                        letterSpacing: '-0.5px'
                    }}>
                        Welcome to Sneed DAO
                    </h1>
                    <p style={{
                        fontSize: '1rem',
                        color: theme.colors.secondaryText,
                        maxWidth: '600px',
                        margin: '0 auto',
                        lineHeight: '1.6',
                    }}>
                        A fully decentralized, community-driven platform for open innovation on the Internet Computer
                    </p>
                </div>
            </div>
            
            <main style={styles.container}>
                {/* About Section */}
                <div className="dao-fade-in-delay" style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon}>
                            <FaLightbulb size={20} style={{ color: daoPrimary }} />
                        </div>
                        <h2 style={styles.sectionTitle}>About Sneed DAO</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Sneed DAO is a fully <strong style={{ color: daoPrimary }}>community-owned and community-driven</strong> SNS DAO operating on the Internet Computer Protocol (ICP). Emerging from the legacy of SNS-1, Sneed DAO was designed as a customizable and open "Blank Canvas" dApp, with the goal of providing a self-sustaining platform for the ICP community to innovate and build.
                    </p>
                    <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                        As a Decentralized Autonomous Organization (DAO), Sneed DAO operates with rules encoded in smart contracts, removing the need for centralized leadership. This enables true decentralized governance where all decisions are made collectively by the community.
                    </p>
                </div>

                {/* What Makes Sneed DAO Special */}
                <div className="dao-fade-in-delay" style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon}>
                            <FaRocket size={20} style={{ color: daoPrimary }} />
                        </div>
                        <h2 style={styles.sectionTitle}>What Makes Sneed DAO Special</h2>
                    </div>
                    <div style={styles.featureGrid}>
                        <div style={styles.featureBox}>
                            <div style={styles.featureTitle}>
                                <div style={styles.featureIcon}>
                                    <FaLightbulb size={14} style={{ color: '#fff' }} />
                                </div>
                                Blank Canvas Model
                            </div>
                            <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.9rem' }}>
                                An accessible platform for developers and enthusiasts to collaborate without constraints, encouraging open innovation and experimentation.
                            </p>
                        </div>
                        <div style={styles.featureBox}>
                            <div style={styles.featureTitle}>
                                <div style={styles.featureIcon}>
                                    <FaVoteYea size={14} style={{ color: '#fff' }} />
                                </div>
                                Community Governance
                            </div>
                            <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.9rem' }}>
                                All decisions are made collectively by token holders, ensuring that the community directs the future of the DAO.
                            </p>
                        </div>
                        <div style={styles.featureBox}>
                            <div style={styles.featureTitle}>
                                <div style={styles.featureIcon}>
                                    <FaCubes size={14} style={{ color: '#fff' }} />
                                </div>
                                100% On-Chain
                            </div>
                            <p style={{ ...styles.paragraph, marginBottom: 0, fontSize: '0.9rem' }}>
                                All activities are fully decentralized and transparent on ICP, ensuring maximum security and trustlessness.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Web3 vs Traditional DAOs */}
                <div className="dao-fade-in-delay" style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon}>
                            <FaChartLine size={20} style={{ color: daoPrimary }} />
                        </div>
                        <h2 style={styles.sectionTitle}>Web3 vs Traditional DAOs</h2>
                    </div>
                    <div style={styles.comparisonGrid}>
                        <div style={styles.comparisonBox(false)}>
                            <div style={styles.comparisonTitle(false)}>
                                <FaTimesCircle size={16} />
                                Conventional Web2 DAOs
                            </div>
                            <ul style={styles.comparisonList}>
                                <li style={styles.comparisonItem(false)}>
                                    <FaTimesCircle size={12} style={{ color: theme.colors.error, marginTop: '4px', flexShrink: 0 }} />
                                    <span>Hosted on centralized Web2 servers</span>
                                </li>
                                <li style={styles.comparisonItem(false)}>
                                    <FaTimesCircle size={12} style={{ color: theme.colors.error, marginTop: '4px', flexShrink: 0 }} />
                                    <span>Limited transparency in operations</span>
                                </li>
                                <li style={styles.comparisonItem(false)}>
                                    <FaTimesCircle size={12} style={{ color: theme.colors.error, marginTop: '4px', flexShrink: 0 }} />
                                    <span>Potential single points of failure</span>
                                </li>
                                <li style={styles.comparisonItem(false)}>
                                    <FaTimesCircle size={12} style={{ color: theme.colors.error, marginTop: '4px', flexShrink: 0 }} />
                                    <span>Restricted innovation focus</span>
                                </li>
                            </ul>
                        </div>
                        <div style={styles.comparisonBox(true)}>
                            <div style={styles.comparisonTitle(true)}>
                                <FaCheckCircle size={16} />
                                Sneed DAO
                            </div>
                            <ul style={styles.comparisonList}>
                                <li style={styles.comparisonItem(true)}>
                                    <FaCheckCircle size={12} style={{ color: theme.colors.success, marginTop: '4px', flexShrink: 0 }} />
                                    <span>100% Web3 operation on ICP</span>
                                </li>
                                <li style={styles.comparisonItem(true)}>
                                    <FaCheckCircle size={12} style={{ color: theme.colors.success, marginTop: '4px', flexShrink: 0 }} />
                                    <span>Full transparency on-chain</span>
                                </li>
                                <li style={styles.comparisonItem(true)}>
                                    <FaCheckCircle size={12} style={{ color: theme.colors.success, marginTop: '4px', flexShrink: 0 }} />
                                    <span>True decentralization</span>
                                </li>
                                <li style={styles.comparisonItem(true)}>
                                    <FaCheckCircle size={12} style={{ color: theme.colors.success, marginTop: '4px', flexShrink: 0 }} />
                                    <span>Open platform for innovation</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>

                {/* How Sneed DAO Works */}
                <div className="dao-fade-in-delay" style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon}>
                            <FaVoteYea size={20} style={{ color: daoPrimary }} />
                        </div>
                        <h2 style={styles.sectionTitle}>How Sneed DAO Works</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The DAO operates through a straightforward three-step process using the SNEED token:
                    </p>
                    <div style={styles.stepCard}>
                        <div style={styles.stepNumber}>1</div>
                        <div>
                            <strong style={{ color: theme.colors.primaryText }}>Proposal Submission</strong>
                            <p style={{ ...styles.paragraph, marginBottom: 0, marginTop: '4px' }}>
                                Community members submit proposals for new projects, initiatives, or changes through established channels.
                            </p>
                        </div>
                    </div>
                    <div style={styles.stepCard}>
                        <div style={styles.stepNumber}>2</div>
                        <div>
                            <strong style={{ color: theme.colors.primaryText }}>DAO Decision</strong>
                            <p style={{ ...styles.paragraph, marginBottom: 0, marginTop: '4px' }}>
                                SNEED token holders vote on proposals to determine their outcome.
                            </p>
                        </div>
                    </div>
                    <div style={styles.stepCard}>
                        <div style={styles.stepNumber}>3</div>
                        <div>
                            <strong style={{ color: theme.colors.primaryText }}>DAO Action</strong>
                            <p style={{ ...styles.paragraph, marginBottom: 0, marginTop: '4px' }}>
                                Approved proposals are implemented directly and trustlessly on-chain via the SNS.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Join the Community */}
                <div className="dao-fade-in-delay" style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon}>
                            <FaHandshake size={20} style={{ color: daoPrimary }} />
                        </div>
                        <h2 style={styles.sectionTitle}>Join the Community</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Whether you're a developer, designer, or enthusiast, your contributions can make an impact. Join Sneed DAO in shaping the future of decentralized applications on web3 and help build the tools necessary for the ICP ecosystem to thrive.
                    </p>
                    <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                        The future of Sneed DAO is <strong style={{ color: daoPrimary }}>100% shaped by its decentralized community</strong>, which controls both the DAO treasury and the DAO dApps. Your voice matters in determining the direction and development of the platform.
                    </p>
                </div>

                {/* Links Section */}
                <div className="dao-fade-in-delay" style={styles.section}>
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon}>
                            <FaLink size={20} style={{ color: daoPrimary }} />
                        </div>
                        <h2 style={styles.sectionTitle}>Further Links</h2>
                    </div>
                    <div style={styles.linkGrid}>
                        <div style={styles.linkBox}>
                            <div style={styles.linkBoxTitle}>
                                <FaCubes size={14} style={{ color: daoPrimary }} />
                                Web3
                            </div>
                            <ul style={styles.linkList}>
                                <li style={styles.linkItem}>
                                    <a href="https://icpswap.com" target="_blank" rel="noopener noreferrer" style={styles.link}>
                                        ICPSwap <FaExternalLinkAlt size={10} />
                                    </a>
                                </li>
                                <li style={styles.linkItem}>
                                    <a href="https://sonic.ooo" target="_blank" rel="noopener noreferrer" style={styles.link}>
                                        Sonic <FaExternalLinkAlt size={10} />
                                    </a>
                                </li>
                                <li style={styles.linkItem}>
                                    <a href="https://iclight.io" target="_blank" rel="noopener noreferrer" style={styles.link}>
                                        ICLight <FaExternalLinkAlt size={10} />
                                    </a>
                                </li>
                                <li style={styles.linkItem}>
                                    <a href="https://icpcoins.com" target="_blank" rel="noopener noreferrer" style={styles.link}>
                                        ICPCoins <FaExternalLinkAlt size={10} />
                                    </a>
                                </li>
                                <li style={styles.linkItem}>
                                    <a href="https://sneedscan.com" target="_blank" rel="noopener noreferrer" style={styles.link}>
                                        SneedScan <FaExternalLinkAlt size={10} />
                                    </a>
                                </li>
                            </ul>
                        </div>
                        <div style={styles.linkBox}>
                            <div style={styles.linkBoxTitle}>
                                <FaGlobe size={14} style={{ color: daoPrimary }} />
                                Web2
                            </div>
                            <ul style={styles.linkList}>
                                <li style={styles.linkItem}>
                                    <a href="https://coinmarketcap.com/currencies/sneed" target="_blank" rel="noopener noreferrer" style={styles.link}>
                                        CoinMarketCap <FaExternalLinkAlt size={10} />
                                    </a>
                                </li>
                                <li style={styles.linkItem}>
                                    <a href="https://dashboard.internetcomputer.org/sns/fp274-iaaaa-aaaaq-aacha-cai" target="_blank" rel="noopener noreferrer" style={styles.link}>
                                        SNS Dashboard <FaExternalLinkAlt size={10} />
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div style={{ textAlign: 'center', color: theme.colors.mutedText, fontSize: '0.85rem', padding: '1rem 0' }}>
                    Built with ❤️ by Sneed DAO
                </div>
            </main>
        </div>
    );
}

export default Dao; 