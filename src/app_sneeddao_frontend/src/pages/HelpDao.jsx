// /help/dao: Sneed DAO as seen in Sneed Hub: the hub, DAO info, the revenue loop, rewards,
// Premium, donations, feedback, Mr Sneed, lore and the smaller info pages.
import React from 'react';
import { FaUniversity, FaBook, FaHome, FaChartBar, FaInfinity, FaGift, FaCrown, FaHeart, FaBug, FaHatWizard, FaScroll, FaHeartbeat, FaBoxOpen, FaBalanceScale } from 'react-icons/fa';
import { HelpPage, Section, Sub, P, List, Steps, Li, B, Code, L, Tip, Warning, Info, Related } from './HelpLayout';

export default function HelpDao() {
    return (
        <HelpPage
            icon={FaUniversity}
            badgeIcon={FaBook}
            badge="Sneed DAO"
            title="Sneed DAO in Sneed Hub"
            subtitle="The DAO behind Sneed Hub: where to see how it works, where its revenue goes, how to claim voting rewards, and how to support it or tell it something."
            color="#8b5cf6"
            secondary="#6366f1"
        >
            <Section icon={FaUniversity} title="What Sneed DAO is" id="overview">
                <P>Sneed DAO is an SNS DAO on the Internet Computer. SNEED holders stake their tokens in neurons and vote on proposals, and adopted proposals are carried out on-chain by the SNS. The DAO controls Sneed Hub&apos;s canisters and its products (Sneed Lock, Sneedex, Sneedapp and more), and their fees feed the DAO&apos;s revenue loop.</P>
                <P>Most DAO pages are in the <B>Sneed DAO</B> menu in the header. The <L to="/dao">DAO</L> page is the introduction: what the DAO is, the blank-canvas idea, how a proposal goes from submission to vote to on-chain action, and links to exchanges, CoinMarketCap and the SNS dashboard.</P>
                <Info title="Public by design">Neurons, votes, reward claims, donations and forum posts are all on-chain and tied to principals or neuron IDs that anyone can look up.</Info>
            </Section>

            <Section icon={FaHome} title="The hub (front page)" id="hub">
                <P><L to="/hub">Hub</L> (also the front page, <Code>/</Code>) is the overview of Sneed Hub:</P>
                <List>
                    <Li>Quick links to the marketplace, Sneedapp and the trading bot.</Li>
                    <Li>SNEED token stats: total, circulating and staked supply and the number of DAO members (principals with at least one SNEED neuron), with links to <B>Tokenomics</B> (<L to="/rll_info">/rll_info</L>) and <B>Staking &amp; Neurons</B> (<L to="/dao_info">/dao_info</L>). Values are shown in your chosen denomination.</Li>
                    <Li><B>Featured Products</B>, the latest forum discussions and active Sneedex offers.</Li>
                    <Li>Cards for <B>Community &amp; Social</B>, <B>Governance</B> and <B>Utilities</B> pages, and a <B>Sneed Premium</B> banner.</Li>
                </List>
            </Section>

            <Section icon={FaChartBar} title="DAO facts and figures" id="dao-info">
                <List>
                    <Li><L to="/dao_info">DAO Dashboard</L> (<B>Dashboard</B> in the menu): <B>DAO Metrics</B> (total and active neurons, dissolve states, total voting power, hotkeys, total proposals), <B>Tokenomics</B> (supply, staked, rewards distributed), <B>Partners</B> and <B>Products</B>, each with a link to its full page. It refreshes every minute.</Li>
                    <Li><L to="/health">Health</L>: the DAO&apos;s diagnostics as a tree of pass / warning / fail checks against live canisters: cycles and memory of every DAO canister, that they are controlled by the DAO and run the code of their latest upgrade proposal, services responding, the SNS core, the revenue loop, the rewards loop and Sneed Lock. A group shows the worst result beneath it. Use <B>Run again</B>, <B>Auto-refresh every 5 min</B>, <B>Problems only</B> and <B>Expand problems</B>; <B>Thresholds</B> lets you tune the warning levels (saved in this browser only). No login needed.</Li>
                    <Li><L to="/products">Products</L>: an overview of Sneedex Swap, Sneedex, SwapRunner, Sneedapp, the trading and ICP staking bots, Liquid Staking and Sneed Lock.</Li>
                    <Li><L to="/partners">Partners</L> and <L to="/projects">Projects</L>: lists kept by the DAO. Projects are grouped as products, projects and community forks.</Li>
                    <Li><L to="/dashboard">/dashboard</L>: an older Sneed Lock list of all token locks and LP position locks. <L to="/sneedlock_info">All Locks</L> is the current, richer view (see <L to="/help/sneedlock">Sneed Lock help</L>).</Li>
                    <Li><Code>/tokenomics</Code> and <Code>/tokenomics_info</Code> are placeholders that say &quot;coming soon&quot;. The live tokenomics are on <L to="/rll_info">/rll_info</L>.</Li>
                </List>
            </Section>

            <Section icon={FaInfinity} title="Revenue and the Recursive Liquidity Loop" id="revenue">
                <P>The DAO earns from three sources: the maturity of its 2-year ICP neuron, the trading fees of its ICPSwap liquidity, and the fees of its products. All of it goes into the <B>Recursive Liquidity Loop</B> (RLL): ICP is split between buying SNEED on the open market and the DAO&apos;s ICP treasury, and the SNEED bought is split again between burning, the SNEED treasury and rewards for SNEED voters. Three pages show this, all read live from the chain:</P>
                <List>
                    <Li><L to="/revenue">Revenue</L>: <B>Revenue, all time</B> and <B>Earned by the products, all time</B>, then one card per source: the 2-year ICP neuron, ICPSwap LP fees, and each product (Sneedapp bot mint fees, Sneed Lock lock fees, Sneedex creation fees and sale cuts, Sneed Premium memberships, SNS Jailbreak script fees), each read from that product&apos;s own canister. <B>Into the loop</B> charts what reached the ICP splitter over a period you choose (30 days, 90 days, 1 year, all time). A product whose canister does not yet make its totals public says so on its card.</Li>
                    <Li><L to="/rll_info">Tokenomics</L> (<Code>/rll_info</Code>): the loop stage by stage, with live cards for each part (balances, vector status, next buy, destinations and their splits), a <B>Total Assets Overview</B> of the treasury, neuron and LP positions, and the loop as a diagram.</Li>
                    <Li><L to="/rll_ledger">Loop ledger</L> (<Code>/rll_ledger</Code>): the books. What actually moved through each stage (the neuron, the ICP splitter, the SNEED buyback, the SNEED splitter, LP fees), read from the ICP and SNEED index canisters, with totals, a per-day chart, the output compared with the configured shares, and rows that link to the transaction browser.</Li>
                </List>
                <Info title="Where your fees go">Fees you pay in Sneed products end up in the ICP splitter, so they show up in these pages as part of what goes into the loop.</Info>
            </Section>

            <Section icon={FaGift} title="Voting rewards" id="rewards">
                <P>Part of the loop&apos;s SNEED (and other reward tokens) is paid to Sneed neurons that vote. The rewards canister imports the DAO&apos;s neurons and proposals and credits each neuron for its votes. To see and claim rewards, your principal must be a hotkey on your Sneed neurons (see <L to="/help/neurons">Neurons help</L>).</P>
                <Steps>
                    <Li>Log in and open <L to="/rewards">Rewards</L> (under <B>Sneed Me</B>).</Li>
                    <Li>The page lists each token with a balance waiting for your hotkeyed neurons.</Li>
                    <Li>Click <B>Claim</B> on a token. The full balance is sent to your Sneed Hub wallet.</Li>
                    <Li>Your past claims are in the claim history, each with a link to its transaction.</Li>
                </Steps>
                <Warning title="Fees">A claim is a ledger transfer. If a balance is not larger than the token&apos;s transaction fee, the claim is refused; wait until more has accumulated.</Warning>
                <P><L to="/rll">/rll</L> (<B>Rewards</B> in the Sneed DAO menu) is the public page of the rewards canister: what the rewards are, the headline statistics (all-time distributed per token, number of distributions, owners rewarded, claims paid, the last 24 hours), and, when you are logged in, your own section: what you can claim per token with a <B>Claim</B> button, your share of a distribution, the rewards credited to your neurons&apos; owners and your own claims, page by page. Below that is every distribution, newest first and paged, with the proposal range it was based on, and the recent activity from the canister&apos;s certified ICRC-3 log. Other people&apos;s claims are not listed there; the claim log, the cycle status and the canister&apos;s tools are on an admin page.</P>
            </Section>

            <Section icon={FaCrown} title="Sneed Premium" id="premium">
                <P><L to="/premium">Premium</L> is a membership that gives lower fees and higher limits across Sneed Hub, plus a premium badge. The <B>Premium Benefits &amp; Savings</B> table shows what changes for members: Sneedex fees, ICP Staking Bot and SNS Jailbreak prices, forum post and thread length, message length, how many neuron and principal nicknames you can keep, and canister folders. The exact prices and limits are shown in the app.</P>
                <P>The top of the page shows your status (<B>Premium Active</B> with its expiry and time remaining, <B>Membership Expired</B>, or <B>Not a member yet</B>). There are three ways in:</P>
                <List>
                    <Li><B>Purchase with ICP</B>: choose a tier (each has a price and a duration), then <B>Pay Now</B> and confirm. The ICP goes from your Sneed Hub wallet to your own deposit account at the Premium canister, which then activates the membership. Buying while active extends your membership by the tier&apos;s duration.</Li>
                    <Li><B>Claim with Sneed Voting Power</B>: your SNEED voting power is matched to the best tier you qualify for, and <B>Claim with Voting Power</B> grants that tier&apos;s duration for free. You can claim again only after the claim interval has passed.</Li>
                    <Li><B>Redeem Promo Code</B>: enter a code and <B>Redeem Code</B>. Each code can be used once per user.</Li>
                </List>
                <Warning title="Real ICP">A purchase is a transfer of real ICP plus the ledger fee, and is not refundable. If something goes wrong after paying, use <L to="/feedback">Feedback</L> to report it.</Warning>
            </Section>

            <Section icon={FaHeart} title="Donations and the thank-you wall" id="donate">
                <P>The heart in the header opens the donate dialog, which sends a donation to the people who build Sneed Hub. <L to="/donate">Thank-you wall</L> (<Code>/donate</Code>) lists every donation made through it, newest first, checked by the backend against the ledger, with the donor&apos;s Sneed name and avatar when they have them.</P>
                <Steps>
                    <Li>Log in, then click the heart or <B>Donate</B> on the wall.</Li>
                    <Li>Choose a token and amount from your Sneed Hub wallet, then confirm with <B>Send donation</B>. Keep the window open while it is sent and put on the wall.</Li>
                    <Li>Logged out, the dialog shows the donation account to copy, so you can send ICP or any token from another wallet. Those donations do not go on the wall.</Li>
                </Steps>
                <Warning title="Public and final">Donations are on-chain transfers: the wall shows your principal, and gifts cannot be refunded.</Warning>
            </Section>

            <Section icon={FaBug} title="Feedback and bug reports" id="feedback">
                <P><L to="/feedback">Feedback</L> lets you <B>Report a bug</B> or <B>Suggest an idea</B>. Log in, give a short title and a description, and post it.</P>
                <List>
                    <Li>A report becomes a public thread in the Sneed forum under your principal (with your Sneed name if you have one), where anyone can discuss it, and the people who build Sneed Hub get a Sneed SMS about it.</Li>
                    <Li>For bugs, <B>Attach these details</B> adds the page, app build, browser and screen size to help reproduce it.</Li>
                    <Li>For a security issue, tick <B>This is a security issue</B>: the report is then sent privately by Sneed SMS to the recipients instead of being posted. Replies arrive in your <L to="/sms">Sneed SMS</L> inbox.</Li>
                    <Li><B>Recent reports</B> lists the latest threads so you can check whether something is already reported.</Li>
                </List>
            </Section>

            <Section icon={FaHatWizard} title="Mr Sneed" id="mr-sneed">
                <P>Mr Sneed is Sneed DAO&apos;s mascot and spirit (&quot;we are all Mr Sneed&quot;), now given a voice with the help of AI under rules written in his code. <L to="/mr-sneed">Mr Sneed</L> shows everything in his canister for anyone to inspect:</P>
                <List>
                    <Li>His <B>Personality</B>, set by DAO proposal, with its version history, and the frame of rules in his code that comes before it.</Li>
                    <Li>Who governs him and who may write his memories, and every change in his ICRC-3 log.</Li>
                    <Li>All his <B>Memories</B>, browsable by folder, kind and status, with search.</Li>
                    <Li><B>What Mr Sneed remembers about you</B>: when logged in, you can <B>Remove</B> any memory about you. Its text is deleted for good; the log keeps only a record that something was removed.</Li>
                </List>
                <P>Changes to his personality, writers or limits, or removing another memory, are DAO proposals filed from your own Sneed neuron with <B>Propose a change</B> or <B>Propose removal</B>. See <L to="/help/proposals">Proposals help</L>.</P>
            </Section>

            <Section icon={FaScroll} title="Lore" id="lore">
                <P><L to="/lore">Lore</L> tells where Sneed DAO and Mr Sneed come from: the SNS-1 blank-canvas DAO, the pre-SNS SNEED token and its converter, the move to an SNS, the Recursive Liquidity Loop and Sneed Hub, with dates taken from the chain, plus the Sneed Vision Letter.</P>
            </Section>

            <Section icon={FaBalanceScale} title="Disclaimer" id="disclaimer">
                <P><L to="/disclaimer">Disclaimer</L> is the legal notice for using Sneed Hub: everything is used at your own risk, crypto and DAO participation are high-risk, you are responsible for your own actions and keys, and nothing on the site is financial, investment, legal or tax advice. Numbers shown anywhere in the app are for information only.</P>
                <Warning title="Real tokens everywhere">Every transfer, purchase, claim and vote in Sneed Hub is a real on-chain action and cannot be undone.</Warning>
            </Section>

            <Related links={[
                { to: '/help/proposals', label: 'Proposals and voting', text: 'vote on Sneed DAO and other proposals' },
                { to: '/help/neurons', label: 'Neurons', text: 'stake SNEED and add hotkeys to earn rewards' },
                { to: '/help/wallet', label: 'Wallet', text: 'the wallet that pays and receives in Sneed Hub' },
                { to: '/help/sneedlock', label: 'Sneed Lock', text: 'token and LP position locks' },
            ]} />
        </HelpPage>
    );
}
