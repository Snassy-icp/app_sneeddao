import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';
import { 
    FaStore, FaArrowLeft, FaShoppingCart, FaServer, FaBrain, FaCoins, 
    FaGavel, FaLock, FaDollarSign, FaCheckCircle, FaQuestionCircle,
    FaRobot, FaImage, FaClock, FaBell, FaHandshake
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
                width: '100%',
                boxSizing: 'border-box'
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
                        Trade apps, bots, SNS neurons, NFTs, Sneed Locks and tokens through on-chain escrow
                    </p>
                </div>
            </div>

            <main style={styles.container}>
                <Link to="/help" style={styles.backLink}>
                    <FaArrowLeft size={14} />
                    Back to Help Center
                </Link>

                {/* What is Sneedex */}
                <div style={styles.section} className="sneedex-help-fade-in" id="overview">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon()}>
                            <FaStore size={20} color={sneedexPrimary} />
                        </div>
                        <h2 style={styles.subheading}>What is Sneedex?</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Sneedex is a marketplace canister for peer-to-peer trading of Internet Computer assets. 
                        The seller hands the assets to Sneedex (escrow), buyers bid in an ICRC-1 token of the seller's 
                        choosing, and Sneedex hands the assets to the winner and the payment to the seller when the 
                        offer completes. Start at the <Link to="/sneedex" style={styles.link}>Sneedex</Link> page, browse 
                        the <Link to="/sneedex_offers" style={styles.link}>Marketplace</Link>, or see your own offers and 
                        bids under <Link to="/sneedex_my" style={styles.link}>My Sneedex</Link>.
                    </p>
                    <div style={styles.infoBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>Key Features</h4>
                        <ul style={{ ...styles.list, marginBottom: 0 }}>
                            <li style={styles.listItem}><strong style={styles.strong}>Escrow:</strong> the assets and the bids are held by the Sneedex canister until the offer ends, so neither side has to trust the other</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Many asset types:</strong> apps (canisters), ICP Staking Bots, Trading Bots, SNS neurons, ICRC-7 NFTs (including Sneed Lock locks), EXT NFTs (such as Sneed Diamond Club cards) and ICRC-1 tokens</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Bundles:</strong> one offer can hold several assets of different types</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Flexible pricing:</strong> a minimum bid (auction), a buyout price (instant purchase), or both</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Private offers (OTC):</strong> only principals you approve can bid</li>
                            <li style={styles.listItem}><strong style={styles.strong}>Automatic settlement:</strong> delivery, payout and refunds run on their own, with manual buttons as a fallback</li>
                        </ul>
                    </div>
                </div>

                {/* Supported Assets */}
                <div style={styles.section} className="sneedex-help-fade-in" id="assets">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#8b5cf6')}>
                            <FaShoppingCart size={20} color="#8b5cf6" />
                        </div>
                        <h2 style={styles.subheading}>Supported Asset Types</h2>
                    </div>
                    <p style={styles.paragraph}>
                        When you add an asset in <Link to="/sneedex_create" style={styles.link}>Create Offer</Link>, you 
                        pick one of these types. Each is escrowed in its own way:
                    </p>
                    
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaServer size={14} color="#3b82f6" />
                            App
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Any canister you control, with its code, state and cycles. You must be a controller. On escrow 
                            Sneedex makes itself the only controller (it remembers the original controllers); the buyer 
                            becomes the controller after the sale, and on a cancelled or expired offer the original 
                            controllers are put back.
                        </p>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaRobot size={14} color="#f97316" />
                            ICP Staking Bot and Trading Bot
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Bot canisters are sold like apps (Sneedex becomes the controller), but the offer page also 
                            shows what is inside: for an ICP Staking Bot its NNS neurons (stake, maturity, dissolve state, 
                            voting power, hotkeys); for a Trading Bot its balances. Use <strong style={styles.strong}>Verify as 
                            Staking Bot</strong> or <strong style={styles.strong}>Verify as Trading Bot</strong> when adding one. The 
                            offer page shows a <strong style={styles.strong}>WASM Status</strong> that checks the bot's module hash 
                            against the known official releases.
                        </p>
                    </div>
                    
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaBrain size={14} color="#8b5cf6" />
                            SNS Neuron
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Pick an SNS and one of your neurons (or type its id in hex). You need the ManagePrincipals 
                            permission on the neuron, because escrow adds Sneedex as a hotkey with full permissions and 
                            takes the other principals off. Neurons staked through the NNS app usually lack that permission 
                            for your Sneed Hub principal: use the <Link to="/tools/sns_jailbreak" style={styles.link}>Jailbreak 
                            Wizard</Link> first. The buyer receives the neuron with its stake and maturity; if the offer does 
                            not sell, the neuron's previous permissions are restored.
                        </p>
                    </div>

                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaImage size={14} color="#a855f7" />
                            NFT (ICRC-7), including Sneed Locks
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Pick a collection (the Sneed Lock collection with your LP and token locks is always offered first, 
                            then the collections in your NFT wallet, or type any ICRC-7 collection canister) and the token ids to 
                            sell. Collections that support ICRC-37 are escrowed by approval; others by a transfer to the offer's 
                            escrow account. Before escrowing, the wizard does a small test transfer to your own subaccount and 
                            refuses collections that ignore subaccounts, since a token sent there could not be claimed by the offer.
                            Sneed Locks keep their lock rules: ownership moves to Sneedex inside Sneed Lock and on to the buyer. 
                            A token lock costs one ledger fee to pass on, which the wizard tops up for you.
                        </p>
                    </div>
                    
                    <div style={styles.featureCard} id="ext-nfts">
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaImage size={14} color="#a855f7" />
                            NFT (EXT), such as Sneed Diamond Club cards
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            EXT is the older NFT standard of Entrepot collections. Pick one of your EXT collections (the Sneed 
                            Diamond Club is always offered, plus any EXT collection you added to your NFT wallet) and the cards 
                            to sell; you can only list cards your wallet holds. EXT has no approvals, so escrow is a transfer: 
                            after you confirm, Sneed Hub sends each card to Sneedex's escrow account for this offer (an account 
                            id that only Sneedex controls) and Sneedex checks the collection now shows that account as the holder. 
                            On a sale Sneedex sends the cards to the buyer and records them as delivered only once the collection 
                            shows the buyer as the holder; if the offer is cancelled or expires without bids, the cards come back 
                            to you, including a card that reached the escrow account before the offer was activated.
                        </p>
                    </div>
                    
                    <div style={styles.featureCard}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaCoins size={14} color="#f59e0b" />
                            ICRC1 Token
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            Any amount of an ICRC-1 token you hold. The tokens are transferred to the offer's escrow 
                            subaccount and sent to the buyer on sale (or back to you if it does not sell).
                        </p>
                    </div>
                    
                    <div style={styles.tipBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Bundle multiple assets:</strong> a single offer can include 
                            several assets of different types as one package. The buyer gets all of them or none.
                        </p>
                    </div>
                </div>

                {/* Creating an Offer */}
                <div style={styles.section} className="sneedex-help-fade-in" id="create">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#10b981')}>
                            <FaGavel size={20} color="#10b981" />
                        </div>
                        <h2 style={styles.subheading}>Creating an Offer</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Go to <Link to="/sneedex_create" style={styles.link}>Create Offer</Link>. The wizard has three steps.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Step 1: Pricing Configuration</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Price Token:</strong> the ICRC-1 token buyers pay in</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Minimum Bid Price:</strong> optional, for auction-style offers</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Buyout Price:</strong> optional, for instant purchase (set at least one of the two)</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Set an expiration date:</strong> optional; the offer ends after the days, hours and minutes you enter</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Min Bid Increment:</strong> how much each new bid must beat the current highest bid by; the form warns if it looks very small or very large</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Private Offer (OTC):</strong> restrict bidding to approved principals (see below)</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Public Note</strong> (visible to everyone) and <strong style={styles.strong}>Note to Buyer</strong> (shown only to the winning bidder), up to 4000 characters each</li>
                    </ul>
                    
                    <h4 style={styles.subsubheading}>Step 2: Assets to Sell</h4>
                    <p style={styles.paragraph}>
                        Add one or more assets. Each is checked as you add it: controller status for apps and bots, 
                        ManagePrincipals for SNS neurons, ownership for NFTs and locks, balance for tokens.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Step 3: Review Your Offer</h4>
                    <p style={styles.paragraph}>
                        Check the summary, the marketplace fee and the creation fee, then click <strong style={styles.strong}>Create 
                        Offer</strong>. The wizard pays the creation fee (if any), creates the offer, adds and finalizes the 
                        assets, escrows them (adds Sneedex as controller or hotkey, moves NFTs, locks and tokens) and activates 
                        the offer. If a step fails, open the offer page: it has <strong style={styles.strong}>Verify &amp; Escrow</strong> buttons 
                        per asset, <strong style={styles.strong}>Finalize Assets</strong> and <strong style={styles.strong}>Activate Offer</strong> to 
                        finish by hand.
                    </p>
                    
                    <div style={styles.warningBox}>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            <strong style={styles.strong}>Important:</strong> once escrowed, assets stay with Sneedex until 
                            the offer sells, expires or you cancel it. While escrowed you cannot use them (for example, you 
                            cannot vote with an escrowed neuron or change an escrowed app).
                        </p>
                    </div>
                </div>

                {/* Bidding */}
                <div style={styles.section} className="sneedex-help-fade-in" id="bidding">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#ec4899')}>
                            <FaShoppingCart size={20} color="#ec4899" />
                        </div>
                        <h2 style={styles.subheading}>Finding Offers and Bidding</h2>
                    </div>
                    <p style={styles.paragraph}>
                        The <Link to="/sneedex_offers" style={styles.link}>Marketplace</Link> has two tabs, <strong style={styles.strong}>Public 
                        Offers</strong> and <strong style={styles.strong}>Private (OTC)</strong> (offers you are approved for, when signed in). 
                        You can filter by asset type (Apps, ICP Staking Bots, Trading Bots, SNS Neurons, NFTs, Sneed Locks, ICRC1 
                        Tokens), payment token, asset token and amount, price range, seller, offer id, a minimum value/price ratio, 
                        and whether to show Active, Sold or Expired offers; sort by newest, ending soon, lowest price or highest bid. 
                        Values are estimates shown in your chosen denomination.
                    </p>
                    
                    <h4 style={styles.subsubheading}>How Bidding Works</h4>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Place Bid:</strong> enter an amount (the <strong style={styles.strong}>Min</strong> button fills the lowest valid bid) and click Place Bid. Sneedex reserves a bid, your tokens go to your bid's escrow subaccount, and the bid is confirmed.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>If a step fails:</strong> the page shows the pending bid with <strong style={styles.strong}>Confirm Bid</strong> and <strong style={styles.strong}>Withdraw Funds</strong>, so you can finish it or take your tokens back.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Outbid:</strong> when someone bids higher, your bid is marked lost and refunded automatically.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Instant Buyout:</strong> if the offer has a buyout price, the buyout button buys it at once. A bid at or above the buyout price only pays the buyout price.</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Winning:</strong> the seller clicks <strong style={styles.strong}>Accept Highest Bid</strong>, someone buys out, or you are the highest bidder when the offer expires.</li>
                    </ul>
                </div>

                {/* Offer States */}
                <div style={styles.section} className="sneedex-help-fade-in" id="lifecycle">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#6366f1')}>
                            <FaLock size={20} color="#6366f1" />
                        </div>
                        <h2 style={styles.subheading}>Offer Lifecycle</h2>
                    </div>
                    <ul style={styles.list}>
                        <li style={styles.listItem}><strong style={styles.strong}>Draft:</strong> created, assets being added</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Pending Escrow:</strong> assets finalized, waiting to be escrowed</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Active:</strong> all assets escrowed, live in the marketplace</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Completed:</strong> bid accepted, buyout, or expired with a highest bid</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Claimed:</strong> the buyer has received the assets</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Expired:</strong> ran out of time with no bids</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Cancelled:</strong> the seller cancelled it</li>
                        <li style={styles.listItem}><strong style={styles.strong}>Reclaimed:</strong> after expiry or cancellation, the assets are back with the seller</li>
                    </ul>
                    
                    <div style={styles.successBox}>
                        <h4 style={{ ...styles.subsubheading, marginTop: 0 }}>
                            <FaCheckCircle size={14} color="#10b981" />
                            Automatic Settlement
                        </h4>
                        <p style={{ ...styles.paragraph, marginBottom: 0 }}>
                            When an offer completes, Sneedex schedules delivery of the assets to the buyer, the payment to 
                            the seller (minus the marketplace fee) and refunds for all losing bids. If something does not go 
                            through, the offer page has <strong style={styles.strong}>Claim Your Assets</strong> for the winner and 
                            <strong style={styles.strong}> Claim Payment</strong> for the seller.
                        </p>
                    </div>

                    <h4 style={styles.subsubheading}>
                        <FaClock size={14} color="#f59e0b" />
                        Expiration
                    </h4>
                    <p style={styles.paragraph}>
                        Sneedex checks expired offers on a timer, and anyone can also settle an offer whose time is up: the 
                        Marketplace page does it in the background, and the offer page shows <strong style={styles.strong}>Finalize 
                        Auction</strong> (there are bids: the highest bidder wins) or <strong style={styles.strong}>Process Expiration</strong> (no 
                        bids: the assets go back to the seller) to any signed-in user. Expiring only checks the clock, so it 
                        cannot be used to change the outcome.
                    </p>

                    <h4 style={styles.subsubheading}>
                        <FaBell size={14} color="#3b82f6" />
                        Notifications
                    </h4>
                    <p style={styles.paragraph}>
                        Sneedex can message you on new bids, being outbid, sales, wins, expiration, cancellation and private 
                        offer invites. Choose which ones under Sneedex notifications on your <Link to="/me" style={styles.link}>Me</Link> page.
                    </p>
                </div>

                {/* Private Offers */}
                <div style={styles.section} className="sneedex-help-fade-in" id="private">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#f59e0b')}>
                            <FaHandshake size={20} color="#f59e0b" />
                        </div>
                        <h2 style={styles.subheading}>Private Offers (OTC)</h2>
                    </div>
                    <p style={styles.paragraph}>
                        Restrict who can bid on your offer, for pre-arranged deals with a specific buyer. Tick 
                        <strong style={styles.strong}> Private Offer (OTC)</strong> in step 1 and add the approved bidders' 
                        principals (search by name or paste a principal id).
                    </p>
                    <p style={styles.paragraph}>
                        Private offers are left out of the Public Offers list and show under the Private (OTC) tab for the 
                        approved bidders, and only they can bid. The offer, its bids and the parties are still on-chain 
                        records, so treat a private offer as unlisted, not secret.
                    </p>
                </div>

                {/* Fees */}
                <div style={styles.section} className="sneedex-help-fade-in" id="fees">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon('#3b82f6')}>
                            <FaDollarSign size={20} color="#3b82f6" />
                        </div>
                        <h2 style={styles.subheading}>Fees</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>Offer Creation Fee</h4>
                    <p style={styles.paragraph}>
                        Creating an offer may cost a fee in ICP, shown in step 3 next to your wallet balance. If a creation 
                        attempt failed after you paid, the paid deposit is shown and used automatically next time (or you 
                        can withdraw it).
                    </p>

                    <h4 style={styles.subsubheading}>Marketplace Fee</h4>
                    <p style={styles.paragraph}>
                        A percentage cut of the winning bid on a successful sale, deducted before the seller is paid. The 
                        current rate is shown in step 1 and on each offer. <Link to="/premium" style={styles.link}>Sneed 
                        Premium</Link> members may pay a lower creation fee and a lower cut; the wizard shows both rates.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Transaction Fees</h4>
                    <p style={styles.paragraph}>
                        Normal ledger fees apply for paying bids into escrow, refunds, escrowing token assets, delivering them 
                        and paying the seller. A token lock costs one extra ledger fee to pass on.
                    </p>
                </div>

                {/* FAQ */}
                <div style={styles.section} className="sneedex-help-fade-in" id="faq">
                    <div style={styles.sectionHeader}>
                        <div style={styles.sectionIcon(theme.colors.accent)}>
                            <FaQuestionCircle size={20} color={theme.colors.accent} />
                        </div>
                        <h2 style={styles.subheading}>Common Questions</h2>
                    </div>
                    
                    <h4 style={styles.subsubheading}>What if no one bids?</h4>
                    <p style={styles.paragraph}>
                        When an offer with no bids expires, Sneedex returns the assets to you automatically and the offer 
                        becomes Reclaimed. My Sneedex lets you filter your offers by state to check.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Can I cancel an active offer?</h4>
                    <p style={styles.paragraph}>
                        Yes, with <strong style={styles.strong}>Cancel Offer</strong>, even when there are bids. The assets go back 
                        to you and every bidder is refunded automatically.
                    </p>
                    
                    <h4 style={styles.subsubheading}>How do I know a bot is genuine?</h4>
                    <p style={styles.paragraph}>
                        For ICP Staking Bots and Trading Bots the offer page reads the canister's module hash and shows 
                        whether it matches a known official version (WASM Status). A plain app gets no such check; look at 
                        what it is before you bid.
                    </p>
                    
                    <h4 style={styles.subsubheading}>Are my funds safe?</h4>
                    <p style={styles.paragraph}>
                        Assets and bids are held by the Sneedex canister, not by the other party, and the trade settles as 
                        a whole: the buyer gets the assets and the seller the payment, or everything goes back. Trades use 
                        real tokens and are final once settled, so check the assets, the price token and the amount before 
                        you bid.
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
                            <Link to="/help/icp-neuron-manager" style={styles.link}>ICP Staking Bots</Link> — create and manage staking bot canisters
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/trading_bot" style={styles.link}>Trading Bots</Link> — what a trading bot does
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/neurons" style={styles.link}>Understanding SNS Neurons</Link> — permissions and hotkeys
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/sns_jailbreak" style={styles.link}>SNS Jailbreak</Link> — make an NNS-app neuron sellable here
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/sneedlock" style={styles.link}>Sneed Lock</Link> — token and LP locks
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/wallet" style={styles.link}>Understanding Your Wallet</Link> — tokens, NFTs and apps
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help" style={styles.link}>Help Center</Link> — browse all help topics
                        </li>
                    </ul>
                </div>
            </main>
        </div>
    );
}

export default HelpSneedex;
