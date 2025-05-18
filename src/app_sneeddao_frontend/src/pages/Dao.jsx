import React from 'react';
import Header from '../components/Header';

const styles = {
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '2rem',
        color: '#fff',
    },
    section: {
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        padding: '2rem',
        marginBottom: '2rem',
    },
    heading: {
        fontSize: '2.5rem',
        marginBottom: '1.5rem',
        color: '#fff',
    },
    subheading: {
        fontSize: '1.8rem',
        marginBottom: '1rem',
        color: '#fff',
    },
    paragraph: {
        marginBottom: '1rem',
        lineHeight: '1.6',
        color: '#ccc',
        fontSize: '1.1rem',
    },
    list: {
        marginLeft: '2rem',
        marginBottom: '1rem',
    },
    listItem: {
        marginBottom: '1rem',
        color: '#ccc',
        fontSize: '1.1rem',
    },
    highlight: {
        backgroundColor: '#3a3a3a',
        padding: '2rem',
        borderRadius: '8px',
        marginBottom: '2rem',
    },
    comparisonGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '2rem',
        marginTop: '1rem',
    },
    comparisonBox: {
        backgroundColor: '#3a3a3a',
        padding: '1.5rem',
        borderRadius: '8px',
    },
    featureBox: {
        backgroundColor: '#3a3a3a',
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1rem',
    },
    strong: {
        color: '#3498db',
        fontWeight: 'bold',
    }
};

function Dao() {
    return (
        <div className='page-container'>
            <Header />
            <main style={styles.container}>
                <div style={styles.section}>
                    <h1 style={styles.heading}>About Sneed DAO</h1>
                    <p style={styles.paragraph}>
                        Sneed DAO is a fully <strong>community-owned and community-driven</strong> SNS DAO operating on the Internet Computer Protocol (ICP). Emerging from the legacy of SNS-1, Sneed DAO was designed as a customizable and open "Blank Canvas" dApp, with the goal of providing a self-sustaining platform for the ICP community to innovate and build.
                    </p>
                    <p style={styles.paragraph}>
                        As a Decentralized Autonomous Organization (DAO), Sneed DAO operates with rules encoded in smart contracts, removing the need for centralized leadership. This enables true decentralized governance where all decisions are made collectively by the community.
                    </p>
                </div>

                <div style={styles.section}>
                    <h2 style={styles.subheading}>What Makes Sneed DAO Special</h2>
                    <div style={styles.featureBox}>
                        <h3 style={{...styles.subheading, fontSize: '1.4rem'}}>Blank Canvas Model: Open Innovation</h3>
                        <p style={styles.paragraph}>
                            An accessible platform for developers and enthusiasts to collaborate without constraints, free from the focus on a single main product. This model encourages open innovation and experimentation in the ICP ecosystem.
                        </p>
                    </div>
                    <div style={styles.featureBox}>
                        <h3 style={{...styles.subheading, fontSize: '1.4rem'}}>Community Governance</h3>
                        <p style={styles.paragraph}>
                            All decisions are made collectively by token holders, ensuring that the community directs the future of the DAO. This includes project development, treasury management, and strategic directions.
                        </p>
                    </div>
                    <div style={styles.featureBox}>
                        <h3 style={{...styles.subheading, fontSize: '1.4rem'}}>100% On-Chain Operations</h3>
                        <p style={styles.paragraph}>
                            All activities are fully decentralized and transparent on the Internet Computer Protocol (ICP), ensuring maximum security and trustlessness.
                        </p>
                    </div>
                </div>

                <div style={styles.section}>
                    <h2 style={styles.subheading}>Web3 vs Traditional DAOs</h2>
                    <div style={styles.comparisonGrid}>
                        <div style={styles.comparisonBox}>
                            <h3 style={{...styles.subheading, fontSize: '1.4rem', color: '#e74c3c'}}>Conventional Web2 DAOs</h3>
                            <ul style={styles.list}>
                                <li style={styles.listItem}>Hosted on centralized Web2 servers</li>
                                <li style={styles.listItem}>Limited transparency in operations</li>
                                <li style={styles.listItem}>Potential single points of failure</li>
                                <li style={styles.listItem}>Restricted innovation focus</li>
                            </ul>
                        </div>
                        <div style={styles.comparisonBox}>
                            <h3 style={{...styles.subheading, fontSize: '1.4rem', color: '#2ecc71'}}>Sneed DAO</h3>
                            <ul style={styles.list}>
                                <li style={styles.listItem}>100% Web3 operation on ICP</li>
                                <li style={styles.listItem}>Full transparency on-chain</li>
                                <li style={styles.listItem}>True decentralization</li>
                                <li style={styles.listItem}>Open platform for innovation</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div style={styles.section}>
                    <h2 style={styles.subheading}>How Sneed DAO Works</h2>
                    <p style={styles.paragraph}>
                        The DAO operates through a straightforward three-step process using the SNEED token:
                    </p>
                    <div style={styles.highlight}>
                        <ol style={styles.list}>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>Proposal Submission:</strong> Community members submit proposals for new projects, initiatives, or changes through established channels
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>DAO Decision:</strong> SNEED token holders vote on proposals
                            </li>
                            <li style={styles.listItem}>
                                <strong style={styles.strong}>DAO Action:</strong> Approved proposals are implemented directly and trustlessly on-chain via the SNS
                            </li>
                        </ol>
                    </div>
                </div>

                <div style={styles.section}>
                    <h2 style={styles.subheading}>Join the Community</h2>
                    <p style={styles.paragraph}>
                        Whether you're a developer, designer, or enthusiast, your contributions can make an impact. Join Sneed DAO in shaping the future of decentralized applications on web3 and help build the tools necessary for the ICP ecosystem to thrive.
                    </p>
                    <p style={styles.paragraph}>
                        The future of Sneed DAO is 100% shaped by its decentralized community, which controls both the DAO treasury and the DAO dApps. Your voice matters in determining the direction and development of the platform.
                    </p>
                </div>
            </main>
        </div>
    );
}

export default Dao; 