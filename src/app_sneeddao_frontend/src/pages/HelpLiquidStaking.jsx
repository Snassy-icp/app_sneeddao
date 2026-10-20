// /help/liquid-staking: liquid staking on Sneed Hub: the SNS Neuron Wizard, ICP Staking Bots, the SNS directory.
import React from 'react';
import { FaWater, FaBook, FaLock, FaCoins, FaListOl, FaBrain, FaExchangeAlt, FaUnlock, FaGlobe, FaShieldAlt } from 'react-icons/fa';
import { HelpPage, Section, Sub, P, List, Steps, Li, B, Code, L, Tip, Warning, Info, Related } from './HelpLayout';

export default function HelpLiquidStaking() {
    return (
        <HelpPage
            icon={FaWater}
            badgeIcon={FaBook}
            badge="Staking"
            title="Liquid Staking"
            subtitle="Stake SNS tokens or ICP in a way that keeps the position transferable, so you can send or sell it instead of waiting out the dissolve delay."
            color="#06b6d4"
            secondary="#22d3ee"
        >
            <Section icon={FaWater} title="What liquid staking means here" id="overview">
                <P>
                    Staking puts tokens into a <B>neuron</B>: you lock them for a dissolve delay and in return get voting power and voting
                    rewards (the <L to="/help/neurons">neurons guide</L> explains the basics). Normally a neuron is stuck with whoever
                    created it. On Sneed Hub, the neurons you create stay <B>transferable</B>: you can send them to another wallet or sell
                    them on <L to="/sneedex_offers">Sneedex</L>.
                </P>
                <P>The <L to="/liquid_staking">Liquid Staking</L> page is the starting point. It has three ways in:</P>
                <List>
                    <Li><B>Stake SNS Tokens</B> opens the <L to="/sns_neuron_wizard">SNS Neuron Wizard</L>, which creates a neuron in any SNS DAO from your Sneed Hub wallet.</Li>
                    <Li><B>Start ICP Liquid Staking</B> opens <L to="/create_icp_neuron">/create_icp_neuron</L>, where you create an <B>ICP Staking Bot</B>: a canister you control that owns your NNS neurons.</Li>
                    <Li><B>Jailbreak Wizard</B> (<L to="/tools/sns_jailbreak">/tools/sns_jailbreak</L>) makes SNS neurons you already created elsewhere, such as in the NNS dapp, manageable and tradable from Sneed Hub.</Li>
                </List>
            </Section>

            <Section icon={FaLock} title="Liquid does not mean unlocked" id="irreversible">
                <Warning title="Staked tokens stay locked">
                    Liquid staking lets you transfer or sell the <B>neuron</B>. It does not let you take the tokens out early. The tokens
                    inside a neuron can only be withdrawn after the neuron has dissolved: you start dissolving, wait the full dissolve
                    delay, then disburse. Whoever receives or buys the neuron takes over the same lock.
                </Warning>
                <List>
                    <Li><B>A dissolve delay can be increased but never reduced.</B> Choose it carefully; you cannot shorten it later.</Li>
                    <Li><B>Staking is a real transfer.</B> The tokens leave your wallet and go to the neuron's account on the SNS governance canister. There is no undo.</Li>
                    <Li><B>Selling is not guaranteed.</B> Sneedex lets you list a neuron, but someone has to want to buy it.</Li>
                    <Li><B>Neurons are public.</B> Neuron ids, stakes, dissolve delays and votes are visible on-chain, linked to your principal.</Li>
                </List>
            </Section>

            <Section icon={FaCoins} title="Creating an SNS neuron, step by step" id="sns-wizard">
                <P>
                    The <L to="/sns_neuron_wizard">SNS Neuron Wizard</L> has three steps: <B>Select SNS</B>, <B>Configure</B>, <B>Stake</B>.
                    You need to be logged in, and the tokens to stake must be in your Sneed Hub wallet (its main account).
                </P>
                <Steps>
                    <Li>
                        <B>Select SNS.</B> Pick the DAO from the dropdown (type in <B>Search SNSes...</B> to filter). The wizard shows
                        <B> Your Balance</B> of that DAO's token. Click <B>Continue</B>.
                    </Li>
                    <Li>
                        <B>Configure Stake.</B> The wizard reads the DAO's rules and shows <B>Min stake</B>, <B>Min dissolve</B> (the
                        shortest delay that lets a neuron vote) and <B>Max dissolve</B>. It pre-fills the minimum stake and minimum delay.
                        <List>
                            <Li><B>Stake Amount</B>: type an amount or use <B>MIN</B> / <B>MAX</B>.</Li>
                            <Li><B>Dissolve Delay (days)</B>: type the number of days or use <B>MIN</B> / <B>MAX</B>. Longer delays give more voting power.</Li>
                        </List>
                        The wizard will not continue if the amount is above your balance or below the minimum stake, or if the delay is
                        outside the allowed range. Click <B>Continue</B>.
                    </Li>
                    <Li>
                        <B>Confirm &amp; Stake.</B> Review the SNS, stake amount and dissolve delay, then click <B>Stake</B> followed by the
                        amount and token symbol.
                    </Li>
                    <Li>
                        Wait for <B>Creating Your Neuron</B> to finish. It goes through: registering the token in your wallet if needed,
                        finding a free neuron slot, transferring the tokens, confirming the transfer, claiming the neuron, and setting the
                        dissolve delay.
                    </Li>
                    <Li>
                        On <B>Neuron Created Successfully!</B> choose <B>View Neuron</B>, <B>Go to Wallet</B> or <B>Stake Another</B>.
                    </Li>
                </Steps>
                <Tip title="The fee comes on top">
                    The ledger charges its transfer fee on top of the stake. <B>MAX</B> fills in your balance minus that fee, so the
                    transfer goes through; if you type an amount yourself, leave room for the fee too.
                </Tip>
                <Sub>What you end up with</Sub>
                <List>
                    <Li>A neuron in that SNS with <B>your principal as its controller</B>, holding the staked tokens.</Li>
                    <Li>The dissolve delay you chose. The neuron is <B>not dissolving</B>; you start dissolving yourself when you want out.</Li>
                    <Li>The neuron appears in your <L to="/wallet">wallet</L> and on the neuron pages, where you can vote, set followees, add hotkeys, increase the stake or delay, or send it to someone else.</Li>
                </List>
                <Info title="If something fails halfway">
                    If an error appears after the transfer step, the tokens are already in the neuron's account on the governance canister.
                    Running the wizard again for the same SNS starts from the first free neuron slot, which is that same account, and claims
                    the neuron with whatever it holds.
                </Info>
            </Section>

            <Section icon={FaBrain} title="ICP neurons: the ICP Staking Bot" id="icp">
                <P>
                    NNS neurons cannot be transferred directly. Sneed Hub's answer is the <B>ICP Staking Bot</B>: a canister that you alone
                    control and that owns your ICP neurons. To hand over the neurons you hand over the canister, for example by selling it on
                    Sneedex.
                </P>
                <Steps>
                    <Li>Go to <L to="/create_icp_neuron">/create_icp_neuron</L> (<B>Start ICP Liquid Staking</B> on the Liquid Staking page).</Li>
                    <Li>Pay the creation fee in ICP and click <B>Create Staking Bot</B>. You get a new canister and its id.</Li>
                    <Li>Open the bot and stake ICP through it to create new NNS neurons. Neurons must be created by the bot; existing neurons in your NNS wallet cannot be moved into it.</Li>
                </Steps>
                <P>
                    Everything about running the bot (neurons, voting, maturity, chores, cycles, upgrades) is in the
                    <L to="/help/icp-neuron-manager"> ICP Staking Bot guide</L>. The bot is also listed in the
                    <L to="/sneedapp"> Sneedapp</L> app store; see the <L to="/help/sneedapp">Sneedapp guide</L>.
                </P>
            </Section>

            <Section icon={FaExchangeAlt} title="Sending and selling a position" id="trade">
                <List>
                    <Li><B>Send an SNS neuron</B> to another principal from your <L to="/wallet">wallet</L>. See the <L to="/help/wallet">wallet guide</L>.</Li>
                    <Li><B>Sell on Sneedex</B>: list an SNS neuron or an ICP Staking Bot canister with <L to="/sneedex_create">Create an Offer</L>, or browse at <L to="/sneedex_offers">Browse Marketplace</L>. Sneedex holds the asset in escrow until the trade completes. The <L to="/help/sneedex">Sneedex guide</L> explains the details.</Li>
                </List>
                <Warning title="Sending is final">
                    Sending a neuron or a canister to another principal cannot be reversed. Double-check the recipient.
                </Warning>
            </Section>

            <Section icon={FaUnlock} title="Neurons you already have" id="jailbreak">
                <P>
                    SNS neurons created in the NNS dapp are controlled by a principal that only the NNS dapp uses, so Sneed Hub cannot send
                    or list them. The <L to="/tools/sns_jailbreak">Jailbreak Wizard</L> adds your Sneed Hub principal to such a neuron so you
                    can manage and trade it here. The <L to="/help/sns_jailbreak">Jailbreak guide</L> walks through it.
                </P>
            </Section>

            <Section icon={FaGlobe} title="The SNS directory" id="sns-directory">
                <P>
                    <L to="/sns">/sns</L> lists every SNS DAO. Use <B>Search SNS...</B> and the sort menu (newest, oldest, A-Z, Z-A) to
                    find one. Clicking a DAO makes it your selected SNS across Sneed Hub and shows its details:
                </P>
                <List>
                    <Li><B>Token Information</B>: symbol, name, decimals, total supply and transfer fee.</Li>
                    <Li><B>Governance Parameters</B>: <B>Min Stake</B>, <B>Max Dissolve</B>, <B>Min Dissolve to Vote</B>, <B>Dissolve Bonus</B>, <B>Age Bonus</B> and <B>Max Age for Bonus</B>, plus <B>Advanced Parameters</B> such as the proposal reject cost, voting periods and reward rates. These are the rules the SNS Neuron Wizard follows.</Li>
                    <Li><B>Neuron Permissions (Hotkeys)</B>: which permissions can be granted to hotkeys, which are reserved for controllers, and which permissions a new neuron's creator gets.</Li>
                    <Li><B>SNS Canisters</B> (root, governance, ledger, swap, index) and any dapp and archive canisters, with health lamps and links to each canister's page.</Li>
                    <Li><B>External Links</B> to the NNS dApp and the IC Dashboard, and <B>Explore This SNS</B> shortcuts to its <B>Proposals</B>, <B>Forum</B>, <B>Neurons</B> and <B>Transactions</B>.</Li>
                </List>
                <Tip title="Check before you stake">
                    Look at <B>Min Stake</B> and <B>Max Dissolve</B> on the directory page before you open the wizard, so you know how much
                    you need and the longest lock the DAO allows.
                </Tip>
            </Section>

            <Section icon={FaShieldAlt} title="Safety checklist" id="safety">
                <List>
                    <Li>Only stake tokens you can do without for at least the whole dissolve delay.</Li>
                    <Li>A dissolve delay can go up, never down.</Li>
                    <Li>Transfers, sends and completed sales are final.</Li>
                    <Li>Neurons and their votes are public and linked to your principal.</Li>
                    <Li>An ICP Staking Bot needs cycles; keep it topped up (see the <L to="/help/icp-neuron-manager">bot guide</L>).</Li>
                </List>
            </Section>

            <Related links={[
                { to: '/help/neurons', label: 'Neurons', text: 'staking, voting, dissolving and disbursing' },
                { to: '/help/sneedex', label: 'Sneedex', text: 'sell neurons and staking bots through escrow' },
                { to: '/help/icp-neuron-manager', label: 'ICP Staking Bot', text: 'ICP neurons held by your own canister' },
                { to: '/help/sns_jailbreak', label: 'SNS Jailbreak', text: 'make existing SNS neurons tradable' },
                { to: '/help/sneedapp', label: 'Sneedapp', text: 'the app store the bots come from' },
            ]} />
        </HelpPage>
    );
}
