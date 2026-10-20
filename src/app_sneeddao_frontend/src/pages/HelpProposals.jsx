// /help/proposals: SNS and NNS proposals, voting with hotkeyed neurons, following, making a proposal.
import React from 'react';
import { FaGavel, FaBook, FaFilter, FaVoteYea, FaFileAlt, FaGlobe, FaKey, FaUserFriends, FaPlusCircle, FaBell } from 'react-icons/fa';
import { HelpPage, Section, Sub, P, List, Steps, Li, B, Code, L, Tip, Warning, Info, Related } from './HelpLayout';

const ext = (href, text) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{text}</a>;

export default function HelpProposals() {
    return (
        <HelpPage
            icon={FaGavel}
            badgeIcon={FaBook}
            badge="Governance"
            title="Proposals and Voting"
            subtitle="Browse proposals for any SNS and for the NNS, read the details, and vote with the neurons you have hotkey access to."
            color="#6366f1"
            secondary="#8b5cf6"
        >
            <Section icon={FaGavel} title="Where proposals live" id="overview">
                <P>Every SNS DAO (Sneed DAO included) and the NNS decide things by proposal: neurons vote, and when a proposal is adopted the governance canister carries it out on-chain. Sneed Hub has these pages for them:</P>
                <List>
                    <Li><L to="/proposals">SNS Proposals</L> (<Code>/proposals</Code>): all proposals of the SNS chosen in the header, newest first.</Li>
                    <Li><L to="/active_proposals">Voting</L> (<Code>/active_proposals</Code>, under <B>Sneed Me</B>): only the open proposals of every SNS where you have neurons, plus the NNS, in one place.</Li>
                    <Li><Code>/proposal</Code>: one SNS proposal in full, with its vote, your neurons, the voting history and the discussion. Open it by clicking a proposal title.</Li>
                    <Li><L to="/icp_proposals">ICP Proposals</L> (<Code>/icp_proposals</Code>) and <Code>/icp_proposal</Code>: the same for NNS (Internet Computer) proposals.</Li>
                </List>
                <P>You can read everything without logging in. To vote you must be logged in, and your neurons need to give your Sneed Hub principal hotkey access (see <L to="/help/neurons">Neurons help</L>).</P>
            </Section>

            <Section icon={FaFilter} title="SNS Proposals: browsing and filtering" id="sns-proposals">
                <P>Pick the DAO with the SNS selector in the header; the page shows that SNS&apos;s name and logo, how many proposals are loaded and how many are open for voting.</P>
                <List>
                    <Li><B>Filter by proposer...</B>: type part of a proposer neuron ID, or a neuron name or nickname.</Li>
                    <Li><B>Topic</B> dropdown: <B>All Topics</B>, <B>Motion</B>, <B>Transfer SNS Treasury Funds</B>, <B>Upgrade SNS Controlled Canister</B>, <B>Execute Generic Nervous System Function</B> and the other SNS proposal types. <B>Clear Filters</B> resets both.</Li>
                    <Li><B>Show 10 / 20 / 50 / 100 per page</B>, <B>Load More Proposals</B> at the bottom, or <B>Load All</B> to fetch the whole history.</Li>
                    <Li><B>Export CSV</B>: downloads the filtered list (it loads all proposals first) with status, proposer, timestamps, treasury transfer details, summary, raw payload and links.</Li>
                </List>
                <Sub>What a proposal card shows</Sub>
                <List>
                    <Li>ID, status, title (click it to open the detail page) and the proposer neuron with its owner&apos;s name, if known.</Li>
                    <Li><B>A small yes/no bar</B> under the title: green is the share of <B>all</B> voting power that voted yes, red the share that voted no, and the rest is <B>not voted</B>. Hover it for exact percentages. Because it counts all voting power, an open proposal can be clearly winning while its green bar is still short.</Li>
                    <Li>For treasury transfers: the amount, token and recipient.</Li>
                    <Li>A collapsible <B>Summary</B>, when it was created and how many days the vote lasts.</Li>
                    <Li>Links to the same proposal on the <B>NNS</B> app, the ICP <B>Dashboard</B> and the <B>Toolkit</B> (ic-toolkit.app).</Li>
                </List>
            </Section>

            <Section icon={FaVoteYea} title="Voting with your neurons" id="voting">
                <P>Sneed Hub votes with neurons where <B>your principal is a hotkey</B>. A hotkey can vote and follow but cannot disburse the neuron or start dissolving it, so adding your Sneed Hub principal as a hotkey is a safe way to vote here with neurons you staked in the NNS app or elsewhere. How to do that is in <L to="/help/neurons">Neurons help</L>.</P>
                <Sub>Quick vote from the list</Sub>
                <P>On open proposals in <L to="/proposals">SNS Proposals</L> each card shows how many of your neurons can still vote and their voting power, for example <B>2 neurons &bull; 1.2K VP</B>, or <B>Voted with 2 neurons</B>, or <B>No eligible neurons</B>. The tick button adopts and the cross button rejects, using <B>all</B> your eligible neurons at once. Neurons that already voted or have no voting power are skipped.</P>
                <Sub>Vote on the detail page</Sub>
                <Steps>
                    <Li>Click a proposal title to open it.</Li>
                    <Li>While the proposal is open, the <B>Vote with your neurons:</B> box shows <B>Adopt</B> and <B>Reject</B> buttons that vote with all your eligible neurons.</Li>
                    <Li>To vote neuron by neuron, click <B>Show my neurons</B> and use the Adopt or Reject button on each neuron.</Li>
                    <Li>After voting, the tally and voting history refresh in place.</Li>
                </Steps>
                <P>If none of your neurons show up, the box explains how to <B>Add Your Principal as a Hotkey</B>, with your principal ready to copy and a <B>Check Hotkey Status</B> button.</P>
                <Sub>Voting page: all your open proposals at once</Sub>
                <P><L to="/active_proposals">Voting</L> groups open proposals by DAO. Each group shows how many proposals there are, how many you can still vote on and how many of your neurons have vote access. Expand a group to vote proposal by proposal, or use <B>Adopt All</B> / <B>Reject All</B> to vote on every votable proposal of that DAO in one go (you are asked to confirm). Tick <B>Show only votable</B> to hide proposals you have nothing left to do on, and use <B>Refresh</B> to reload.</P>
                <Tip title="Get a nudge">On <L to="/me">Me</L>, the <B>Votable Proposals</B> notification setting shows a counter in the header when there are proposals you can still vote on; clicking it opens the Voting page.</Tip>
                <Warning title="Votes are final and public">A vote cannot be changed or withdrawn once cast. Every ballot is public on-chain, tied to the neuron and visible in the proposal&apos;s voting history. Bulk buttons vote with every eligible neuron, so double-check the proposal first.</Warning>
            </Section>

            <Section icon={FaFileAlt} title="The proposal detail page" id="detail">
                <List>
                    <Li><B>Navigation</B>: <B>Previous</B> / <B>Next</B>, or type a number in <B>Proposal ID</B> and press <B>Go</B>. The SNS comes from the header selector.</Li>
                    <Li><B>Facts</B>: status, created time, voting period and time remaining, and <B>Proposed by</B> (the neuron and its owner&apos;s principals).</Li>
                    <Li><B>Summary</B> (rendered Markdown) and the <B>Payload</B> of the action, so you can see exactly what would be executed.</Li>
                    <Li><B>The vote bar</B>: yes and no as a share of all voting power, with markers for the <B>50% Threshold</B> (or the <B>67% Threshold</B> for critical proposals that need a two-thirds majority) and the <B>Min. Participation</B> needed to adopt.</Li>
                    <Li><B>Voting History</B>: every neuron&apos;s ballot, with <B>Hide Yes</B>, <B>Hide No</B>, <B>Hide Pending</B> and sorting <B>By Date</B> or <B>By VP</B>. For Sneed DAO proposals whose ballots are no longer kept by governance, the history comes from the rewards canister instead.</Li>
                    <Li><B>Discussion</B>: each proposal has a forum thread. Read and reply right there, or <B>View in Forum</B>. Posting needs a login and is public.</Li>
                </List>
            </Section>

            <Section icon={FaGlobe} title="ICP (NNS) proposals" id="nns">
                <P><L to="/icp_proposals">ICP Proposals</L> lists NNS proposals with <B>Search by title or proposer...</B>, a topic filter, a status filter (<B>Open</B>, <B>Rejected</B>, <B>Adopted</B>, <B>Executed</B>, <B>Failed</B>), <B>Load All</B>, <B>Export CSV</B> and links to the NNS app and the ICP Dashboard.</P>
                <P>It uses the NNS neurons that your principal controls or is a hotkey on. On open proposals each card shows how many of them can vote, and the adopt and reject buttons vote with all of them. NNS proposals also appear on the <L to="/active_proposals">Voting</L> page.</P>
                <P>Click a title to open <Code>/icp_proposal</Code>: the tally and threshold bar, created / decided / executed times, <B>Reward Status</B>, <B>Topic</B>, the proposer, the action details (motion text, NNS function and payload, SNS launch parameters and so on) and a <B>Voting History</B> with <B>Hide Adopt</B>, <B>Hide Reject</B>, <B>Hide Pending</B> and sorting. The detail page is read-only: vote from the list or the Voting page.</P>
                <Info title="ICP neurons managed by a canister">If your ICP neurons sit in an ICP Staking Bot, add your principal as a hotkey on them (from the bot&apos;s page) so they can vote here. See <L to="/help/icp-neuron-manager">ICP Staking Bot help</L>.</Info>
            </Section>

            <Section icon={FaUserFriends} title="Following" id="following">
                <P>Instead of voting by hand every time, a neuron can <B>follow</B> other neurons per topic and vote the way they vote. For SNS neurons you set this on the neuron&apos;s page (reach it from <L to="/neurons">Neurons</L>): open the <B>Followees</B> section, pick the topics, search or paste the neuron to follow and <B>Add</B> it. Your hotkey access is enough to change following.</P>
                <P>A common setup: make all your neurons follow one neuron you vote with here, so one vote counts for all of them, even neurons held in other wallets. The details are in <L to="/help/neurons">Neurons help</L>.</P>
            </Section>

            <Section icon={FaPlusCircle} title="Making a proposal" id="make-proposal">
                <P>Sneed Hub does not have a general proposal editor. The <B>Create proposal</B> link at the top of <L to="/proposals">SNS Proposals</L> takes you to {ext('https://ic-toolkit.app', 'ic-toolkit.app')}, where you can write and submit SNS proposals. You can also submit from the NNS app.</P>
                <P>The one place Sneed Hub files proposals itself is <L to="/mr-sneed">Mr Sneed</L>: <B>Propose a change</B> to his personality, writers or limits, or <B>Propose removal</B> of a memory. You choose one of your Sneed neurons that lets your principal submit proposals, write the summary, see what voters will see, and file it to Sneed DAO.</P>
                <Warning title="Proposals cost if rejected">A rejected proposal costs its proposer neuron the DAO&apos;s rejection fee. Your neuron automatically votes yes on its own proposal. To submit, your principal needs the permission to submit proposals on that neuron; the Mr Sneed page lists only neurons where you have it.</Warning>
            </Section>

            <Section icon={FaBell} title="Troubleshooting" id="troubleshooting">
                <List>
                    <Li><B>No eligible neurons</B>: you are not a hotkey on any neuron with voting power in this SNS, or they all voted already. Neurons need voting power, which depends on their dissolve delay.</Li>
                    <Li><B>A vote failed</B>: the proposal may have closed, or the neuron voted already (for example through following). Refresh and look at the voting history.</Li>
                    <Li><B>Neurons missing after adding a hotkey</B>: reload the page; neuron lists are cached for a while.</Li>
                </List>
            </Section>

            <Related links={[
                { to: '/help/neurons', label: 'Neurons', text: 'staking, hotkeys, following and voting power' },
                { to: '/help/icp-neuron-manager', label: 'ICP Staking Bot', text: 'manage ICP neurons from a canister' },
                { to: '/help/dao', label: 'Sneed DAO', text: 'the DAO, its revenue loop and voting rewards' },
            ]} />
        </HelpPage>
    );
}
