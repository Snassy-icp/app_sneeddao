// /help/sneedapp: the Sneedapp app store: browsing apps, minting your own app canister, publishers, versions and upgrades.
import React from 'react';
import { FaStore, FaBook, FaSearch, FaRocket, FaCoins, FaGasPump, FaKey, FaUserTie, FaHistory, FaArrowUp, FaCube, FaShieldAlt } from 'react-icons/fa';
import { HelpPage, Section, Sub, P, List, Steps, Li, B, Code, L, Tip, Warning, Info, Related } from './HelpLayout';

export default function HelpSneedapp() {
    return (
        <HelpPage
            icon={FaStore}
            badgeIcon={FaBook}
            badge="Apps"
            title="Sneedapp App Store"
            subtitle="Browse apps for the Internet Computer, mint your own copy as a canister that you alone control, and keep it up to date."
            color="#06b6d4"
            secondary="#22d3ee"
        >
            <Section icon={FaStore} title="What Sneedapp is" id="overview">
                <P>
                    <L to="/sneedapp">Sneedapp</L> is the app store of Sneed Hub. Each app in it is a canister program (for example
                    the ICP Staking Bot or the Sneed Trading Bot). When you <B>mint</B> an app, the Sneedapp factory canister creates a
                    brand-new canister, installs the app's code in it, and then hands control of it to you. The result is your own
                    smart contract on the Internet Computer, not an account in somebody else's service.
                </P>
                <List>
                    <Li><B>Browse</B> the catalogue at <L to="/sneedapp">/sneedapp</L> and open an app for its detail page.</Li>
                    <Li><B>Mint</B> an app: choose a version, pay in ICP, optionally add extra cycles, and get a new canister.</Li>
                    <Li><B>See your canisters</B> in the <B>My Canisters</B> list at the bottom of the store, or manage them on <L to="/apps">/apps</L>.</Li>
                    <Li><B>Upgrade</B> your bots when a new version is published.</Li>
                </List>
                <Info title="Real ICP">
                    Minting costs real ICP, sent from your Sneed Hub wallet. Every payment and every created canister is an on-chain
                    action recorded with your principal; it is public, not anonymous.
                </Info>
            </Section>

            <Section icon={FaSearch} title="Browsing apps" id="browse">
                <P>The <B>Available Apps</B> grid shows every enabled app. Each card shows:</P>
                <List>
                    <Li>The app's name and icon, its <B>publisher</B> (a green check mark means the publisher is verified) and how many copies have been <B>minted</B>.</Li>
                    <Li><B>Family tags</B> (such as <Code>sneed-bots</Code>). The tag buttons above the grid filter the list; <B>All</B> clears the filter.</Li>
                    <Li>The mint price in ICP, and a lower <B>Premium</B> price when the app gives <L to="/premium">Premium members</L> a discount.</Li>
                    <Li>A <B>Mint Bot</B> or <B>Mint App</B> button. If you are not logged in, it asks you to log in first.</Li>
                </List>
                <P>
                    The store also shows cards for a <B>Token launchpad</B> and an <B>Index canister</B> from the Token Studio. They carry a
                    coming soon ribbon and are not covered here.
                </P>
                <Sub>The app detail page</Sub>
                <P>
                    Clicking a card opens the app's page. It shows the description, the publisher, the mint count, the latest version,
                    the price (and Premium price) and a <B>Mint Now</B> button. The <B>Version History</B> panel shows the latest release;
                    click it to expand every published version with its release notes. Apps with a full guide have a
                    <B> Read the full guide</B> link, which leads to the bot guides listed at the bottom of this page.
                </P>
            </Section>

            <Section icon={FaRocket} title="Minting an app, step by step" id="mint">
                <P>Minting is a four-step wizard: <B>Version</B>, <B>Review</B>, <B>Gas</B>, <B>Confirm</B>.</P>
                <Steps>
                    <Li>Open the app in <L to="/sneedapp">Sneedapp</L> and click <B>Mint Now</B> (or the mint button on its card). Log in if asked.</Li>
                    <Li>
                        <B>Select Version.</B> The newest version that has code uploaded is picked for you. Versions marked <B>No WASM</B> have
                        no code yet and cannot be chosen. Click <B>Next</B>.
                    </Li>
                    <Li>
                        <B>Review Payment.</B> You see the <B>Minting Price</B> (your Premium discount, if you have one, is applied
                        automatically), the 0.0001 ICP transfer fee and <B>Your Wallet Balance</B>. For apps from outside publishers the page
                        also shows the <B>Revenue split</B> between Sneed DAO and the publisher. <B>Next</B> stays disabled until your wallet
                        holds enough ICP.
                    </Li>
                    <Li>
                        <B>Extra Gas (Optional).</B> Your canister starts with some cycles (its "gas") as part of minting. You can enter an
                        extra ICP amount here; the page shows roughly how many cycles that buys at the current rate. Leave it empty and
                        click <B>Skip</B> if you do not want extra.
                    </Li>
                    <Li>
                        <B>Confirm &amp; Mint.</B> Check the summary (app, version, price, extra gas, publisher and <B>Total from wallet</B>)
                        and click <B>Mint Canister</B>. The page sends the payment, creates the canister and, if you asked for it, tops it up.
                    </Li>
                    <Li>
                        On <B>Canister Created!</B> copy your new canister id. <B>View Canister</B> opens its page; it also appears under
                        <B> My Canisters</B> in the store and on <L to="/apps">/apps</L>.
                    </Li>
                </Steps>
                <Sub>How the payment works</Sub>
                <List>
                    <Li>
                        Each user has a personal payment deposit on the Sneedapp factory. When you confirm, the page moves only the
                        missing amount into that deposit (plus the transfer fee). If an earlier deposit already covers the price, nothing more
                        is sent and the review step tells you so.
                    </Li>
                    <Li>
                        The factory then uses part of the price to buy the cycles the new canister is created with; the rest is the creation
                        fee. For an app from an outside publisher, that fee is split between Sneed DAO and the publisher as shown on the
                        review step.
                    </Li>
                    <Li>
                        If minting fails, the factory returns what it already moved to your deposit (less ledger fees), so you can simply try
                        again. The extra gas top-up happens after the canister exists: if that top-up fails, your canister is still created and
                        you can add cycles later.
                    </Li>
                    <Li>Apps from a publisher that has not been verified cannot be minted yet; the wizard says so.</Li>
                </List>
                <Warning title="Payments are final">
                    A successful mint cannot be undone and the price is not refunded. Check the app, the version and the total before you
                    click <B>Mint Canister</B>.
                </Warning>
            </Section>

            <Section icon={FaKey} title="What you get and who controls it" id="control">
                <P>
                    The factory creates the canister with itself as the only controller, installs the chosen version, and then makes
                    <B> you the only controller</B>. From that moment the factory, Sneed DAO and the app's publisher have no control over
                    your canister: they cannot change its code, stop it, or take what it holds.
                </P>
                <List>
                    <Li>Only you can upgrade, reinstall, stop or delete it, or add other controllers.</Li>
                    <Li>
                        The canister runs on cycles. Keep an eye on its cycle balance and top it up when it gets low, for example from
                        <L to="/apps"> /apps</L> or the canister's own page. A canister that runs out of cycles freezes.
                    </Li>
                    <Li>
                        Because a minted canister is a single thing you control, you can hand it to someone else, for instance by selling it on
                        <L to="/sneedex_offers"> Sneedex</L> (see the <L to="/help/sneedex">Sneedex guide</L>).
                    </Li>
                </List>
                <Tip title="Keep your login safe">
                    Being the only controller also means nobody can recover the canister for you if you lose access to the identity that
                    minted it.
                </Tip>
            </Section>

            <Section icon={FaCube} title="Your apps" id="your-apps">
                <P>
                    The <B>My Canisters</B> list at the bottom of <L to="/sneedapp">/sneedapp</L> shows the canisters you minted, grouped by
                    app. The app is recognised from the code the canister is actually running. Each row has <B>View</B> and, where the app
                    has one, <B>Manage</B> links.
                </P>
                <P>
                    The full manager is <L to="/apps">/apps</L>. Its <B>Sneedapp</B> section lists your minted canisters with health lamps,
                    versions and cycle balances; you can add a bot you already control with <B>Add bot</B>, move apps between sections, and
                    remove one from the list (that only stops tracking it, it does not delete the canister). See the
                    <L to="/help/dapp-manager"> App Manager guide</L> for groups, monitoring and top-ups.
                </P>
            </Section>

            <Section icon={FaHistory} title="Versions" id="versions">
                <P>
                    Every app has numbered versions (<Code>major.minor.patch</Code>) with release notes. A version only becomes mintable
                    once its code (the WASM) has been uploaded. When you mint, the newest mintable version is chosen by default, but you may
                    pick an older one in the <B>Select Version</B> step.
                </P>
            </Section>

            <Section icon={FaArrowUp} title="Upgrading your bots" id="upgrades">
                <P>
                    When a newer version of one of your bots is published, Sneed Hub tells you: a notice in the header and a banner on
                    <L to="/apps"> /apps</L> say how many bots <B>can be upgraded to newer versions</B>. Clicking it opens the
                    <B> Upgrade Apps</B> dialog.
                </P>
                <Steps>
                    <Li>Open the dialog from the header notice or the <B>Upgrade</B> banner on <L to="/apps">/apps</L>.</Li>
                    <Li>Select the bots to upgrade (or <B>Select all</B>) and start the upgrade.</Li>
                    <Li>
                        The dialog upgrades each bot <B>through every published version on the way</B>, one step at a time, because each
                        version's data migration expects the version before it. Progress shows as, for example, "step 1 of 2".
                    </Li>
                    <Li>
                        If a step fails, the bot stays on the last version it reached and the dialog says where it stopped; upgrade again to
                        continue from there.
                    </Li>
                </Steps>
                <Info title="You sign the upgrade">
                    Upgrades are made with your own identity, as the canister's controller. Nobody else can upgrade your bot for you.
                    Upgrades keep the bot's stored data and settings; the bot guides explain what each bot keeps.
                </Info>
            </Section>

            <Section icon={FaUserTie} title="Publishers" id="publishers">
                <P>
                    Every app belongs to a publisher. Apps published by Sneed DAO itself carry no revenue split. Apps from any other publisher
                    can only be minted once the Sneedapp admins have <B>verified</B> that publisher.
                </P>
                <P>
                    A publisher's owners manage it on its publisher page (reachable from the <B>by ...</B> link on an app page). Only owners
                    can open it; everyone else sees "You are not an owner of this publisher". It has four tabs:
                </P>
                <List>
                    <Li><B>Info</B>: name, website, description, logo and payment account; the list of owners; family tags.</Li>
                    <Li><B>Apps</B>: the publisher's apps with their prices, and a button to enable or disable each one.</Li>
                    <Li><B>Versions</B>: add a new version (number, WASM hash, release date, WASM and source URLs, release notes) and upload its WASM file.</Li>
                    <Li><B>Revenue</B>: the publisher's and each app's revenue balance, totals, and <B>Withdraw</B> buttons.</Li>
                </List>
            </Section>

            <Section icon={FaShieldAlt} title="Safety checklist" id="safety">
                <List>
                    <Li>Minting spends real ICP and cannot be reversed.</Li>
                    <Li>You are the only controller of what you mint: keep your login safe and keep the canister topped up with cycles.</Li>
                    <Li>Read an app's guide before you put funds into it. A bot does what you configure it to do.</Li>
                    <Li>Check the publisher (and its verified mark) before minting a third-party app.</Li>
                </List>
            </Section>

            <Related links={[
                { to: '/help/icp-neuron-manager', label: 'ICP Staking Bot', text: 'manage ICP neurons from your own canister' },
                { to: '/help/trading_bot', label: 'Sneed Trading Bot', text: 'automated trading from a canister you control' },
                { to: '/help/dapp-manager', label: 'App Manager', text: 'track, monitor and top up your canisters on /apps' },
                { to: '/help/sneedex', label: 'Sneedex', text: 'sell or buy app canisters through escrow' },
                { to: '/help/liquid-staking', label: 'Liquid Staking', text: 'staking positions you can transfer' },
            ]} />
        </HelpPage>
    );
}
