import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import { 
    FaStore, FaArrowLeft, FaShoppingCart, FaServer, FaBrain, FaCoins, 
    FaGavel, FaLock, FaUserSecret, FaDollarSign, FaCheckCircle, 
    FaExclamationTriangle, FaLightbulb, FaQuestionCircle
} from 'react-icons/fa';

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

@keyframes storeFloat {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50% { transform: translateY(-10px) rotate(3deg); }
}

.sneedex-help-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}

.sneedex-help-float {
    animation: storeFloat 4s ease-in-out infinite;
}
`;

// Page accent colors - teal theme for marketplace
const sneedexPrimary = '#14b8a6';
const sneedexSecondary = '#2dd4bf';

const getStyles = (theme) => ({
    container: {
        maxWidth: '900px',
        margin: '0 auto',
        padding: '1.25rem',
        color: theme.colors.primaryText,
    },
    backLink: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        color: theme.colors.accent,
        textDecoration: 'none',
        fontSize: '0.9rem',
        fontWeight: '500',
        marginBottom: '1.5rem',
        transition: 'opacity 0.2s ease',
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
    sectionIcon: (color = sneedexPrimary) => ({
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
    subsubheading: {
        fontSize: '1rem',
        fontWeight: '600',
        color: theme.colors.primaryText,
        marginTop: '1rem',
        marginBottom: '0.5rem',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    paragraph: {
        marginBottom: '0.75rem',
        lineHeight: '1.7',
        color: theme.colors.secondaryText,
        fontSize: '0.9rem',
    },
    list: {
        marginLeft: '1.25rem',
        marginBottom: '0.75rem',
        paddingLeft: '0.5rem',
    },
    listItem: {
        marginBottom: '0.5rem',
        color: theme.colors.secondaryText,
        fontSize: '0.9rem',
        lineHeight: '1.6',
    },
    infoBox: {
        background: `linear-gradient(135deg, ${theme.colors.accent}15, ${theme.colors.accent}08)`,
        border: `1px solid ${theme.colors.accent}40`,
        borderRadius: '12px',
        padding: '1rem',
        marginBottom: '1rem',
    },
    tipBox: {
        background: `linear-gradient(135deg, ${sneedexPrimary}15, ${sneedexPrimary}08)`,
        border: `1px solid ${sneedexPrimary}40`,
        borderRadius: '12px',
        padding: '1rem',
        marginBottom: '1rem',
    },
    successBox: {
        background: `linear-gradient(135deg, #10b98115, #10b98108)`,
        border: `1px solid #10b98140`,
        borderRadius: '12px',
        padding: '1rem',
        marginBottom: '1rem',
    },
    warningBox: {
        background: `linear-gradient(135deg, #f59e0b15, #f59e0b08)`,
        border: `1px solid #f59e0b40`,
        borderRadius: '12px',
        padding: '1rem',
        marginBottom: '1rem',
    },
    featureCard: {
        background: theme.colors.secondaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '12px',
        padding: '1rem',
        marginBottom: '0.75rem',
    },
    link: {
        color: theme.colors.accent,
        textDecoration: 'none',
        fontWeight: '500',
    },
    strong: {
        color: theme.colors.primaryText,
        fontWeight: '600',
    },
    stepList: {
        marginLeft: '1.25rem',
        marginTop: '0.5rem',
    },
    stepItem: {
        marginBottom: '0.5rem',
        color: theme.colors.secondaryText,
        fontSize: '0.9rem',
        lineHeight: '1.6',
    },
});

function HelpSneedex() {
    const { theme } = useTheme();
    const styles = getStyles(theme);

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customAnimations}</style>
            <Header />
            
            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${sneedexPrimary}15 0%, ${sneedexSecondary}10 50%, transparent 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '3rem 1.25rem 2.5rem',
                position: 'relative',
                overflow: 'hidden',
            }}>
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    right: '-10%',
                    width: '400px',
                    height: '400px',
                    background: `radial-gradient(circle, ${sneedexPrimary}20 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-30%',
                    left: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${sneedexSecondary}15 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                
                <div style={{ maxWidth: '900px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <div className="sneedex-help-float" style={{
                            width: '72px',
                            height: '72px',
                            borderRadius: '20px',
                            background: `linear-gradient(135deg, ${sneedexPrimary}, ${sneedexSecondary})`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: `0 12px 40px ${sneedexPrimary}50`,
                        }}>
                            <FaStore size={36} color="#fff" />
                        </div>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: `${sneedexPrimary}20`,
                                border: `1px solid ${sneedexPrimary}40`,
                                borderRadius: '20px',
                                padding: '4px 12px',
                                marginBottom: '8px',
                            }}>
                                <FaShoppingCart size={12} color={sneedexPrimary} />
                                <span style={{ fontSize: '0.75rem', fontWeight: '600', color: sneedexPrimary }}>
                                    Marketplace
                                </span>
                            </div>
                            <h1 style={{
                                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                                fontWeight: '800',
                                color: theme.colors.primaryText,
                                margin: 0,
                            }}>
                                Sneedex Marketplace
                            </h1>
                        </div>
                    </div>
                    <p style={{
                        fontSize: '1rem',
                        color: theme.colors.secondaryText,
                        margin: 0,
                        maxWidth: '600px',
                        lineHeight: '1.6',
                    }}>
                        Trade canisters, SNS neurons, and tokens on the decentralized marketplace
                    </p>
                </div>
            </div>

            <main style={styles.container}>
                <Link to="/help" style={styles.backLink}>
                    <FaArrowLeft size={14} />
                    Back to Help Center
                </Link>

                {/* What is Sneedex */}
                <div style={styles.section} className="sneedex-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaStore size={20} color={sneedexPrimary} />
                        </div>
                        <h2 style={styles.subheading}>What is Sneedex?</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Sneedex is a trustless marketplace that enables peer-to-peer trading of Internet Computer assets. 
                        Sellers escrow their assets, buyers pay with ICRC-1 tokens, and the marketplace handles the exchange 
                        automatically when a bid is accepted or buyout price is met.
                    </p>
                    <div style={styles.infoBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>Key Features</h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Trustless Escrow:</strong> Assets held by smart contract—neither party can cheat</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Multiple Asset Types:</strong> Trade canisters, SNS neurons, and ICRC-1 tokens</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Flexible Pricing:</strong> Minimum bid, buyout price, or both</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Private Offers:</strong> Restrict offers to specific approved bidders</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Automatic Settlement:</strong> Assets and payments transferred automatically</li>
                        </ul>
                    </div>
                </div>

                {/* Supported Assets */}
                <div style={styles.section} className="sneedex-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#8b5cf6')}>
                            <FaShoppingCart size={20} color="#8b5cf6" />
                        </div>
                        <h2 style={styles.subheading}>Supported Asset Types</h2>
                    </div>
                    
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaServer size={14} color="#3b82f6" />
                            Canisters
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Sell complete IC canisters including code, state, and cycles. ICP Neuron Manager canisters 
                            show detailed neuron information including stake, maturity, and dissolve status.
                        </p>
                    </div>
                    
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaBrain size={14} color="#8b5cf6" />
                            SNS Neurons
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Trade SNS governance neurons. The buyer receives the neuron with full control, including 
                            staked amount and any maturity.
                        </p>
                    </div>
                    
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaCoins size={14} color="#f59e0b" />
                            ICRC-1 Tokens
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Bundle and sell any quantity of ICRC-1 tokens. Tokens are escrowed and delivered upon sale.
                        </p>
                    </div>
                    
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Bundle Multiple Assets:</strong> A single offer can include 
                            multiple assets of different types for package deals!
                        </p>
                    </div>
                </div>

                {/* Creating an Offer */}
                <div style={styles.section} className="sneedex-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#10b981')}>
                            <FaGavel size={20} color="#10b981" />
                        </div>
                        <h2 style={styles.subheading}>Creating an Offer</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Go to <Link to="/sneedex_create" style={styles.link}>Create Offer</Link> to list your assets.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Step 1: Configure Pricing</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Payment Token:</strong> Choose which ICRC-1 token buyers pay with</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Minimum Bid:</strong> Starting price for auction-style bidding (optional)</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Buyout Price:</strong> Price for instant purchase (optional)</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Expiration:</strong> When the offer ends</li>
                    </ul>
                    
                    <h4 style={styles.subsubheading}>Step 2: Add Assets</h4>
                    <p style={styles.paragraph}>
                        Select canisters from your registered/wallet canisters, SNS neurons where you have ManagePrincipals 
                        permission, or tokens with sufficient balance.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Step 3: Review & Create</h4>
                    <p style={styles.paragraph}>
                        The system verifies ownership/permissions. Clicking "Create Offer" will create, finalize, 
                        escrow all assets, and activate the offer.
                    </p>
                    
                    <div style={styles.warningBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>⚠️ Important:</strong> Once escrowed, assets remain locked until 
                            the offer completes, expires, or you cancel it.
                        </p>
                    </div>
                </div>

                {/* Bidding */}
                <div style={styles.section} className="sneedex-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#ec4899')}>
                            <FaShoppingCart size={20} color="#ec4899" />
                        </div>
                        <h2 style={styles.subheading}>Bidding on Offers</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Browse active offers on the <Link to="/sneedex_offers" style={styles.link}>Marketplace</Link> page.
                    </p>
                    
                    <h4 style={styles.subsubheading}>How Bidding Works</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Place a Bid:</strong> Enter amount and click "Place Bid"—tokens are escrowed automatically</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Outbid:</strong> If someone outbids you, your funds are automatically refunded</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Buyout:</strong> Purchase instantly at the buyout price if available</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Winning:</strong> Seller accepts your bid, or you're highest when offer expires</li>
                    </ul>
                    
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>💡 Tip:</strong> Use the "Min" button to automatically fill 
                            the minimum required bid when there's a minimum bid increment.
                        </p>
                    </div>
                </div>

                {/* Offer States */}
                <div style={styles.section} className="sneedex-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#6366f1')}>
                            <FaLock size={20} color="#6366f1" />
                        </div>
                        <h2 style={styles.subheading}>Offer Lifecycle</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Draft:</strong> Initial state when creating</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Pending Escrow:</strong> Created, waiting for assets to be escrowed</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Active:</strong> All assets escrowed, live in marketplace</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Completed:</strong> Bid accepted or buyout price met</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Expired:</strong> Ended without a sale</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Cancelled:</strong> Seller cancelled the offer</li>
                    </ul>
                    
                    <div style={styles.successBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaCheckCircle size={14} color="#10b981" />
                            Automatic Settlement
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            When an offer completes: assets delivered to buyer, payment to seller (minus marketplace fee), 
                            and losing bids refunded automatically.
                        </p>
                    </div>
                </div>

                {/* Private Offers */}
                <div style={styles.section} className="sneedex-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#f59e0b')}>
                            <FaUserSecret size={20} color="#f59e0b" />
                        </div>
                        <h2 style={styles.subheading}>Private Offers (OTC)</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Restrict who can bid on your offer—useful for pre-arranged deals with specific buyers, 
                        exclusive sales to verified parties, or avoiding public price discovery.
                    </p>
                    <p style={styles.paragraph}>
                        Enable "Private Offer" when configuring pricing and add approved bidder principals. 
                        Only these principals can see and bid on your offer.
                    </p>
                </div>

                {/* Fees */}
                <div style={styles.section} className="sneedex-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#3b82f6')}>
                            <FaDollarSign size={20} color="#3b82f6" />
                        </div>
                        <h2 style={styles.subheading}>Fees</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Marketplace Fee</h4>
                    <p style={styles.paragraph}>
                        A small percentage fee on successful sales, deducted from the winning bid before seller receives payment.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Transaction Fees</h4>
                    <p style={styles.paragraph}>
                        Standard ICRC-1 fees apply for placing bids, refunding outbid amounts, escrowing token assets, 
                        and receiving payment.
                    </p>
                </div>

                {/* FAQ */}
                <div style={styles.section} className="sneedex-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon(theme.colors.accent)}>
                            <FaQuestionCircle size={20} color={theme.colors.accent} />
                        </div>
                        <h2 style={styles.subheading}>Common Questions</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>What if no one bids?</h4>
                    <p style={styles.paragraph}>
                        If your offer expires without bids, reclaim your escrowed assets from the offer page.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Can I cancel an active offer?</h4>
                    <p style={styles.paragraph}>
                        Yes, at any time. Existing bidders are automatically refunded when you cancel.
                    </p>
                    
                    <h4 style={styles.subsubheading}>How do I know if a canister is verified?</h4>
                    <p style={styles.paragraph}>
                        For ICP Neuron Manager canisters, Sneedex verifies the WASM hash against known official versions. 
                        A green checkmark indicates verified code.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Are my funds safe?</h4>
                    <p style={styles.paragraph}>
                        Yes. All assets and bids are held in smart contract escrow. The system ensures atomic swaps—either 
                        both parties get what they're owed, or the trade doesn't happen.
                    </p>
                </div>

                {/* Related Topics */}
                <div style={styles.section} className="sneedex-help-fade-in">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaArrowLeft size={20} color={sneedexPrimary} />
                        </div>
                        <h2 style={styles.subheading}>Related Help Topics</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <Link to="/help/icp-neuron-manager" style={styles.link}>ICP Neuron Manager Canisters</Link> — Create and manage neuron manager canisters
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/neurons" style={styles.link}>Understanding SNS Neurons</Link> — SNS neuron management and hotkeys
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/wallet" style={styles.link}>Understanding Your Wallet</Link> — Managing tokens and assets
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help" style={styles.link}>Help Center</Link> — Browse all help topics
                        </li>
                    </ul>
                </div>
            </main>
        </div>
    );
}

export default HelpSneedex;
