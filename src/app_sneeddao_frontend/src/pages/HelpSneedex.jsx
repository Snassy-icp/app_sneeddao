import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import Header from '../components/Header';

function HelpSneedex() {
    const { theme } = useTheme();

    const styles = {
        container: {
            minHeight: '100vh',
            background: theme.colors.background,
            color: theme.colors.primaryText
        },
        content: {
            maxWidth: '900px',
            margin: '0 auto',
            padding: '40px 20px'
        },
        heading: {
            fontSize: '2.5rem',
            fontWeight: '700',
            color: theme.colors.primaryText,
            marginBottom: '1rem',
            marginTop: '0'
        },
        subheading: {
            fontSize: '1.8rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            marginTop: '2.5rem',
            marginBottom: '1rem',
            borderBottom: `2px solid ${theme.colors.border}`,
            paddingBottom: '0.5rem'
        },
        subsubheading: {
            fontSize: '1.3rem',
            fontWeight: '600',
            color: theme.colors.primaryText,
            marginTop: '1.5rem',
            marginBottom: '0.75rem'
        },
        paragraph: {
            fontSize: '1rem',
            lineHeight: '1.7',
            color: theme.colors.secondaryText,
            marginBottom: '1rem'
        },
        list: {
            marginLeft: '1.5rem',
            marginBottom: '1rem',
            color: theme.colors.secondaryText
        },
        listItem: {
            marginBottom: '0.75rem',
            lineHeight: '1.6'
        },
        infoBox: {
            background: `${theme.colors.accent}15`,
            border: `1px solid ${theme.colors.accent}50`,
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '1.5rem'
        },
        tipBox: {
            background: `${theme.colors.success || '#4CAF50'}15`,
            border: `1px solid ${theme.colors.success || '#4CAF50'}50`,
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '1.5rem'
        },
        warningBox: {
            background: `${theme.colors.warning || '#FF9800'}15`,
            border: `1px solid ${theme.colors.warning || '#FF9800'}50`,
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '1.5rem'
        },
        link: {
            color: theme.colors.accent,
            textDecoration: 'none',
            fontWeight: '500',
            transition: 'opacity 0.2s ease'
        },
        strong: {
            color: theme.colors.primaryText,
            fontWeight: '600'
        },
        code: {
            background: theme.colors.secondaryBg,
            padding: '2px 6px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '0.9em',
            color: theme.colors.accent
        },
        section: {
            marginBottom: '2rem'
        }
    };

    return (
        <div style={styles.container}>
            <Header />
            <div style={styles.content}>
                <h1 style={styles.heading}>Sneedex Marketplace</h1>
                
                <p style={styles.paragraph}>
                    <strong style={styles.strong}>Sneedex</strong> is a decentralized marketplace for trading digital assets 
                    on the Internet Computer. You can create offers to sell canisters, SNS neurons, and ICRC-1 tokens, 
                    with all assets held securely in escrow until the sale completes.
                </p>

                {/* What is Sneedex */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>What is Sneedex?</h2>
                    
                    <p style={styles.paragraph}>
                        Sneedex is a trustless marketplace that enables peer-to-peer trading of Internet Computer assets. 
                        Unlike traditional marketplaces, Sneedex uses smart contract escrow to ensure safe trades—sellers 
                        escrow their assets, and buyers pay with ICRC-1 tokens. The marketplace handles the exchange 
                        automatically when a bid is accepted or a buyout price is met.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Key Features</h3>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Trustless Escrow:</strong> Assets are held by the Sneedex canister 
                            during the offer period, ensuring neither party can cheat
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Multiple Asset Types:</strong> Trade canisters, SNS neurons, 
                            and ICRC-1 tokens
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Flexible Pricing:</strong> Set a minimum bid for auctions, 
                            a buyout price for instant sales, or both
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Private Offers:</strong> Create offers visible only to 
                            specific approved bidders for OTC deals
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Automatic Settlement:</strong> When offers complete, assets 
                            and payments are transferred automatically
                        </li>
                    </ul>
                </div>

                {/* Supported Asset Types */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Supported Asset Types</h2>
                    
                    <h3 style={styles.subsubheading}>🖥️ Canisters</h3>
                    <p style={styles.paragraph}>
                        Sell complete Internet Computer canisters, including their code, state, and cycles. 
                        When you escrow a canister, Sneedex becomes a controller, and upon sale completion, 
                        control is transferred to the buyer.
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Regular Canisters:</strong> Any canister you control
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>ICP Neuron Managers:</strong> Canisters that manage ICP neurons 
                            (created via <Link to="/create_icp_neuron" style={styles.link}>ICP Neuron Manager</Link>). 
                            These show detailed neuron information including stake, maturity, and dissolve status
                        </li>
                    </ul>
                    
                    <h3 style={styles.subsubheading}>🧠 SNS Neurons</h3>
                    <p style={styles.paragraph}>
                        Trade SNS governance neurons. When escrowed, Sneedex becomes the sole hotkey with full permissions. 
                        Upon sale, the buyer receives the neuron with full control. The staked amount and any maturity 
                        are transferred with the neuron.
                    </p>
                    
                    <h3 style={styles.subsubheading}>🪙 ICRC-1 Tokens</h3>
                    <p style={styles.paragraph}>
                        Bundle and sell any quantity of ICRC-1 tokens. Tokens are transferred to escrow when the offer 
                        is created and delivered to the buyer upon sale completion.
                    </p>
                    
                    <div style={styles.infoBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>Bundle Multiple Assets:</strong> A single offer can include 
                            multiple assets of different types. For example, you could sell a canister along with 
                            some tokens as a package deal.
                        </p>
                    </div>
                </div>

                {/* Creating an Offer */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Creating an Offer</h2>
                    
                    <p style={styles.paragraph}>
                        To create an offer, go to <Link to="/sneedex_create" style={styles.link}>Create Offer</Link> and 
                        follow these steps:
                    </p>
                    
                    <h3 style={styles.subsubheading}>Step 1: Configure Pricing</h3>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Payment Token:</strong> Choose which ICRC-1 token buyers will 
                            pay with (e.g., ICP, SNEED)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Minimum Bid:</strong> Set a starting price for auction-style 
                            bidding (optional)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Buyout Price:</strong> Set a price for instant purchase (optional)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Expiration:</strong> Set when the offer ends (or no expiration 
                            for permanent listings)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Minimum Bid Increment:</strong> Optionally require new bids to 
                            exceed the current bid by a minimum amount
                        </li>
                    </ul>
                    
                    <div style={styles.tipBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>💡 Pricing Tip:</strong> You can set just a minimum bid 
                            (auction only), just a buyout price (fixed price sale), or both (auction with buy-it-now option).
                        </p>
                    </div>
                    
                    <h3 style={styles.subsubheading}>Step 2: Add Assets</h3>
                    <p style={styles.paragraph}>
                        Add the assets you want to sell. For each asset type:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Canisters:</strong> Select from your registered canisters, 
                            wallet canisters, or ICP Neuron Managers. You must be a controller to auto-escrow
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>SNS Neurons:</strong> Select the SNS and neuron. You need 
                            a hotkey with ManagePrincipals permission
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Tokens:</strong> Choose the token and amount. You need 
                            sufficient balance plus one fee
                        </li>
                    </ul>
                    
                    <h3 style={styles.subsubheading}>Step 3: Review & Create</h3>
                    <p style={styles.paragraph}>
                        The system verifies you have proper ownership/permissions for all assets. If all assets pass 
                        verification, clicking "Create Offer" will:
                    </p>
                    <ol style={styles.list}>
                        <li style={styles.listItem}>Create and finalize the offer</li>
                        <li style={styles.listItem}>Automatically escrow all assets</li>
                        <li style={styles.listItem}>Activate the offer in the marketplace</li>
                    </ol>
                    
                    <div style={styles.warningBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>⚠️ Important:</strong> Once assets are escrowed, they remain 
                            locked until the offer completes, expires, or you cancel it. Make sure you're ready to 
                            commit the assets before creating the offer.
                        </p>
                    </div>
                </div>

                {/* Bidding on Offers */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Bidding on Offers</h2>
                    
                    <p style={styles.paragraph}>
                        Browse active offers on the <Link to="/sneedex_offers" style={styles.link}>Marketplace</Link> page. 
                        Click on any offer to view details and place a bid.
                    </p>
                    
                    <h3 style={styles.subsubheading}>How Bidding Works</h3>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Place a Bid:</strong> Enter your bid amount and click "Place Bid". 
                            Your tokens are transferred to escrow automatically
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Outbid:</strong> If someone outbids you, your escrowed funds 
                            are automatically refunded
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Buyout:</strong> If the offer has a buyout price, you can 
                            purchase instantly at that price
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Winning:</strong> The seller can accept your bid, or if the 
                            offer expires with your bid as highest, you win automatically
                        </li>
                    </ul>
                    
                    <h3 style={styles.subsubheading}>Bid Escrow</h3>
                    <p style={styles.paragraph}>
                        When you place a bid, tokens are transferred to a unique escrow subaccount. You can view your 
                        escrow balance on the offer page. If you're outbid or the offer is cancelled, your funds are 
                        automatically returned (minus one transaction fee).
                    </p>
                    
                    <div style={styles.tipBox}>
                        <p style={{...styles.paragraph, marginBottom: 0}}>
                            <strong style={styles.strong}>💡 Tip:</strong> Use the "Min" button to automatically fill 
                            in the minimum required bid amount when there's a minimum bid increment.
                        </p>
                    </div>
                </div>

                {/* Offer Lifecycle */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Offer Lifecycle</h2>
                    
                    <h3 style={styles.subsubheading}>Offer States</h3>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Draft:</strong> Initial state when creating an offer
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Pending Escrow:</strong> Offer created, waiting for assets to be escrowed
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Active:</strong> All assets escrowed, offer is live in the marketplace
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Completed:</strong> A bid was accepted or buyout price was met
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Expired:</strong> Offer ended without a sale (no winning bid)
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>Cancelled:</strong> Seller cancelled the offer
                        </li>
                    </ul>
                    
                    <h3 style={styles.subsubheading}>Settlement</h3>
                    <p style={styles.paragraph}>
                        When an offer completes (via accepted bid or buyout):
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>The escrowed assets are automatically delivered to the buyer</li>
                        <li style={styles.listItem}>The winning bid amount is transferred to the seller</li>
                        <li style={styles.listItem}>A marketplace fee (if applicable) is deducted from the payment</li>
                        <li style={styles.listItem}>Any losing bids are refunded automatically</li>
                    </ul>
                </div>

                {/* Private Offers */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Private Offers (OTC)</h2>
                    
                    <p style={styles.paragraph}>
                        Private offers allow you to restrict who can bid on your offer. This is useful for:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Pre-arranged deals with specific buyers</li>
                        <li style={styles.listItem}>Exclusive sales to verified parties</li>
                        <li style={styles.listItem}>Avoiding public price discovery</li>
                    </ul>
                    
                    <p style={styles.paragraph}>
                        To create a private offer, enable "Private Offer" when configuring pricing and add the principal 
                        IDs of approved bidders. Only these principals will be able to see and bid on your offer.
                    </p>
                    
                    <p style={styles.paragraph}>
                        Private offers appear in the "Private" tab of the marketplace, but only for the creator and 
                        approved bidders.
                    </p>
                </div>

                {/* Fees */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Fees</h2>
                    
                    <h3 style={styles.subsubheading}>Marketplace Fee</h3>
                    <p style={styles.paragraph}>
                        Sneedex charges a small percentage fee on successful sales. This fee is deducted from the 
                        winning bid amount before the seller receives payment. The current fee rate is displayed 
                        when creating an offer.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Transaction Fees</h3>
                    <p style={styles.paragraph}>
                        Standard ICRC-1 transaction fees apply for:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>Placing bids (one fee)</li>
                        <li style={styles.listItem}>Refunding outbid amounts (one fee deducted from refund)</li>
                        <li style={styles.listItem}>Escrowing token assets (one fee)</li>
                        <li style={styles.listItem}>Receiving payment as seller (one fee deducted)</li>
                    </ul>
                </div>

                {/* Managing Your Offers and Bids */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Managing Offers & Bids</h2>
                    
                    <p style={styles.paragraph}>
                        Visit <Link to="/sneedex_my" style={styles.link}>My Sneedex</Link> to see all your activity:
                    </p>
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>My Offers:</strong> View and manage offers you've created. 
                            Accept bids, cancel offers, or reclaim assets from expired offers
                        </li>
                        <li style={styles.listItem}>
                            <strong style={styles.strong}>My Bids:</strong> Track your bids across all offers. 
                            See bid status, escrow balances, and claim won assets
                        </li>
                    </ul>
                </div>

                {/* Common Questions */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Common Questions</h2>
                    
                    <h3 style={styles.subsubheading}>What happens if no one bids on my offer?</h3>
                    <p style={styles.paragraph}>
                        If your offer expires without any bids, you can reclaim your escrowed assets. 
                        Go to your offer page and click "Reclaim Assets" to return them to your control.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Can I cancel an active offer?</h3>
                    <p style={styles.paragraph}>
                        Yes, you can cancel an active offer at any time. If there are existing bids, all bidders 
                        will be automatically refunded when you cancel.
                    </p>
                    
                    <h3 style={styles.subsubheading}>How do I know if a canister is verified?</h3>
                    <p style={styles.paragraph}>
                        For ICP Neuron Manager canisters, Sneedex verifies the WASM hash against known official 
                        versions. A green checkmark indicates the canister is running verified code.
                    </p>
                    
                    <h3 style={styles.subsubheading}>What if the escrow transaction fails?</h3>
                    <p style={styles.paragraph}>
                        If auto-escrow fails during offer creation, you can manually escrow assets from the 
                        offer details page. The page shows the status of each asset and provides instructions 
                        for manual escrow if needed.
                    </p>
                    
                    <h3 style={styles.subsubheading}>Are my funds safe?</h3>
                    <p style={styles.paragraph}>
                        Yes. All assets and bids are held in smart contract escrow controlled by the Sneedex canister. 
                        The system ensures atomic swaps—either both parties get what they're owed, or the trade 
                        doesn't happen.
                    </p>
                </div>

                {/* Related Help Topics */}
                <div style={styles.section}>
                    <h2 style={styles.subheading}>Related Help Topics</h2>
                    
                    <ul style={styles.list}>
                        <li style={styles.listItem}>
                            <Link to="/help/icp-neuron-manager" style={styles.link}>ICP Neuron Manager Canisters</Link> - 
                            Learn about creating and managing ICP Neuron Manager canisters
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/neurons" style={styles.link}>Understanding SNS Neurons</Link> - 
                            Learn about SNS neuron management and hotkeys
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help/wallet" style={styles.link}>Understanding Your Wallet</Link> - 
                            Learn about managing tokens and assets
                        </li>
                        <li style={styles.listItem}>
                            <Link to="/help" style={styles.link}>Help Center</Link> - Browse all help topics
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

export default HelpSneedex;

