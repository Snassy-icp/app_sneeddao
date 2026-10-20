// /help/token-studio: Token Studio (Check, Harden, Hand over, Index, Launch) and the token safety rating.
import React from 'react';
import { FaFlask, FaBook, FaShieldAlt, FaWrench, FaRocket, FaDatabase, FaLock, FaCog, FaHourglassHalf, FaCheckCircle, FaProjectDiagram } from 'react-icons/fa';
import { HelpPage, Section, Sub, P, List, Steps, Li, B, Code, L, Tip, Warning, Info, Related } from './HelpLayout';

export default function HelpTokenStudio() {
    return (
        <HelpPage
            icon={FaFlask}
            badgeIcon={FaBook}
            badge="Tools"
            title="Token Studio and Token Safety"
            subtitle="Check any token on the Internet Computer against what the chain itself says about it, see what its owner can do about each weak spot, and (soon) launch new tokens on vetted ledger code."
            color="#10b981"
            secondary="#34d399"
        >
            <Section icon={FaFlask} title="What Token Studio is" id="overview">
                <P>
                    <L to="/studio">Token Studio</L> is one place for any ICRC ledger. It has five tabs:
                </P>
                <List>
                    <Li><B>Check</B>: a safety report built only from public, verifiable data. Nothing in it is self-reported by the token's team.</Li>
                    <Li><B>Harden</B>: for each part of the report, what the token's owner can do about it, with buttons where Sneed Hub already has an answer.</Li>
                    <Li><B>Hand over</B>: hand a ledger you control to Sneed custody (coming soon).</Li>
                    <Li><B>Index</B>: create an index canister for an existing ledger (coming soon).</Li>
                    <Li><B>Launch</B>: mint a brand-new token on the same ledger code every SNS runs (coming soon).</Li>
                </List>
                <P>
                    Check and Harden work for anyone, without logging in. The token's own page lives at an address like <Code>/studio/&lt;ledger id&gt;</Code>, and each tab adds its name, for example <Code>/studio/&lt;ledger id&gt;/harden</Code>, so you can share a link to a report.
                </P>
                <Info title="Old addresses">
                    The token safety page at <L to="/tools/token_safety">/tools/token_safety</L> now opens the studio, and the token launcher at <Code>/tools/pad</Code> is coming soon and lives in the studio's Launch tab.
                </Info>
            </Section>

            <Section icon={FaShieldAlt} title="Checking a token" id="check">
                <Steps>
                    <Li>Open <L to="/studio">Token Studio</L> (Tools menu, or the <B>Open Token Studio</B> button on <L to="/tools/main">Tools</L>).</Li>
                    <Li>In the box at the top, pick a token from the list or paste any ledger canister id, then press <B>Check</B>.</Li>
                    <Li>The studio shows the token's logo, name and symbol, then runs the checks. A counter shows how many have finished, and for tokens whose history is read from the ledger, how many blocks of the log have been scanned.</Li>
                    <Li>When it is done you get an overall rating and badges counting <B>passed</B>, <B>warnings</B>, <B>failed</B> and <B>skipped</B> checks.</Li>
                    <Li>Open groups in the tree to read each line. Use <B>Problems only</B>, <B>Expand all</B>, <B>Expand problems</B> and <B>Collapse</B> to find your way, and <B>Run again</B> for fresh data.</Li>
                </Steps>
                <P>
                    A finished report is kept for about half an hour while the browser tab stays open, so you can move between tabs and come back without waiting. The status line then says it was kept from your last visit.
                </P>
                <Tip title="Big tokens take a while">
                    Holders are rebuilt in your own browser from the ledger's block log. By default logs over 500,000 blocks are skipped; you can raise <B>Max blocks to scan</B> under <B>Thresholds</B>, but expect a few minutes per million blocks.
                </Tip>
            </Section>

            <Section icon={FaCheckCircle} title="How the rating works: gates first" id="rating">
                <P>
                    The report starts with two <B>gates</B>, because if either fails, nothing else the ledger says can be trusted:
                </P>
                <List>
                    <Li><B>Controllers</B>: who can change the code of the ledger, its archives and its index. These pass when there is no controller at all, when a known blackhole canister is the only controller, when the NNS (NNS root) or a single SNS root controls it, or when a Sneed custody canister does. A personal wallet or an unknown canister as controller fails. So does a mix, such as a DAO plus a personal principal, because then the DAO does not control it alone.</Li>
                    <Li><B>Code</B>: the module hash of the installed code is compared with every ledger-suite version the NNS has approved, and with every official DFINITY ledger suite release published on GitHub (github.com/dfinity/ic). A match passes and the line names the version or release. Unknown code fails, except on canisters NNS root alone controls, whose code was installed by NNS proposal.</Li>
                </List>
                <P>The overall rating is then one of:</P>
                <List>
                    <Li><B>Unverifiable</B>: a gate failed (unknown code, or someone other than a DAO or blackhole controls it). The other checks still run, but the rating stays here.</Li>
                    <Li><B>Captured DAO</B>: the gates pass, but one party controls the SNS DAO that controls the code.</Li>
                    <Li><B>Strong</B>: verified code under safe control, no failing dimension and at most one warning.</Li>
                    <Li><B>Fair</B>: verified code under safe control, at most one failing dimension.</Li>
                    <Li><B>Weak</B>: verified code under safe control, but several dimensions fail.</Li>
                </List>
                <Sub>The dimensions</Sub>
                <List>
                    <Li><B>Minting</B>: whether the minting account can mint at will, supply created outside the log, and mints after genesis.</Li>
                    <Li><B>Distribution</B>: the number of holders, the largest holder, the ten largest holders, and signs of split-up holdings, such as "satellite" accounts that got their whole balance from one sender and never sent anything, and wallets that sent to many other wallets.</Li>
                    <Li><B>Locked supply</B>: tokens in Sneed Lock and in SNS neurons for at least the minimum time, unlock cliffs coming up, and what sits in the DAO treasury (shown, but not counted as locked).</Li>
                    <Li><B>Liquidity (ICPSwap)</B>: whether a pool exists, its depth compared to the market cap, and whether the liquidity is under safe control: locked in Sneed Lock, owned by a DAO, or burned. A position its creator can pull at any time counts as unsafe however deep it is.</Li>
                    <Li><B>Cycles and memory</B>: for the ledger, each archive and the index, when they can be observed.</Li>
                </List>
                <P>
                    The report also shows <B>Supply and metadata</B> (name, decimals, fee, supply, age) and, for SNS tokens, <B>The DAO behind it</B>: the largest voting principal, influence after following, stake that can vote, genesis neurons and recent participation.
                </P>
            </Section>

            <Section icon={FaDatabase} title="Recent improvements" id="recent">
                <Sub>Recompressed builds and controllers behind controllers</Sub>
                <P>
                    Some launchers upload an official DFINITY .wasm.gz after compressing it again: the Wasm inside is identical, but the module hash is not one DFINITY published. Under a code line that did not pass, "Verify a recompressed build" lets you choose that .wasm.gz (it stays on your computer) or give a GitHub or icp0.io URL: your browser checks that it is the code the canister runs, unpacks it and compares it with every official release. A match is shown to you only; send the file to the Sneed team to have it added to the verified list, after which the line passes for everyone and names who recompressed it.
                </P>
                <P>
                    When a controller is a canister the studio does not recognise, it now reads that canister's own controllers, and theirs, up to three levels. If every path ends at NNS root, an SNS root, a blackhole or a Sneed custody canister, no person can replace that canister's code, but its code still decides what it does with its control, so the line shows a warning (partial) instead of a failure. A path that reaches a personal principal still fails. The tree is in the line's details.
                </P>
                <Sub>Official DFINITY ledger suite releases</Sub>
                <P>
                    Ledgers installed straight from DFINITY's standalone ledger suite releases used to show as "Unknown wasm" when that build had never been listed by the SNS wasm canister. The studio now knows the module hashes of these releases, so such a ledger passes the code gate and the line names the release it came from (marked u256 for the 256-bit builds). If the code is a release of the wrong kind, for example an index build installed as the ledger, you get a warning instead.
                </P>
                <Sub>Cycles and memory through NNS root</Sub>
                <P>
                    Cycles are read from whoever controls the canister and publishes its status: a blackhole canister, the SNS root, or a Sneed custody canister. When NNS root is one of the controllers, cycles and memory are now read from NNS root's public status too (they used to show as "Not observable"). NNS root next to other controllers still counts as mixed control in the controllers gate.
                </P>
                <P>
                    If none of these controllers publish status, the cycles line is skipped with a note that a blackhole or DAO controller would make it visible.
                </P>
            </Section>

            <Section icon={FaCog} title="Thresholds" id="thresholds">
                <P>
                    <B>Thresholds</B> opens the numbers the rating compares against: largest holder and top ten warning and failure shares, minimum holders, how much locked supply counts as good, minimum lock length, cliff window, locked liquidity share, minimum and deep liquidity, DAO voting-power limits, dormant airdrop share, wallet fan-out, cycle warning and failure levels, and call timeouts.
                </P>
                <P>
                    Change any of them and press <B>Save and re-run</B>, or <B>Defaults</B> to go back to what the DAO considers reasonable. Your thresholds are saved in this browser only, so a report you share is read with the other person's own settings.
                </P>
            </Section>

            <Section icon={FaProjectDiagram} title="Follow the money inside a report" id="money">
                <P>
                    Once the block log has been scanned, a <B>Follow the money</B> button appears above the tree. It opens a graph of who sent what to whom, built from the scan, with pools, Sneed Lock and DAO accounts marked and the option to <B>Fold satellites</B> into the account that funded them. For tokens with an index canister there is also a standalone <L to="/tools/money">Follow the Money</L> page; see <L to="/help/tools#money">Tools help</L>.
                </P>
            </Section>

            <Section icon={FaWrench} title="Harden: fixing what the report flags" id="harden">
                <P>
                    Lines that warn or fail often carry a button, such as <B>Lock tokens</B>, <B>Lock the LP position</B>, <B>Add liquidity</B>, <B>Hand control over</B> or <B>What can be done</B>. They take you to the matching section of the <B>Harden</B> tab or straight to the right page. The Harden tab has a card for each part of the report:
                </P>
                <List>
                    <Li><B>Lock supply</B>: <B>Lock ... in Sneed Lock</B> opens the lock wizard for this token. The report reads locks directly from the lock canister and counts those with at least the minimum time left.</Li>
                    <Li><B>Liquidity</B>: <B>Lock an LP position</B>, or <B>Create or grow a position</B> from your Sneed wallet. A pool for a brand-new pair still has to be created on ICPSwap first.</Li>
                    <Li><B>Who controls the code</B>: <B>Hand it to Sneed custody</B> and <B>Create an index</B>, plus the do-it-yourself <Code>dfx</Code> commands to blackhole the ledger or make an SNS root its only controller.</Li>
                    <Li><B>Index canister</B>, <B>Minting</B> and <B>Cycles</B>: explanations of what can and cannot be changed. For example, the minting account is fixed when the ledger is installed and cannot be changed afterwards, not even by an upgrade.</Li>
                </List>
                <Warning title="These are real, often irreversible actions">
                    Tokens or LP positions locked in Sneed Lock cannot be withdrawn until the lock period is over (a lock can also have a dissolve delay, and its period can be extended), and ledger fees apply. Setting a blackhole as the only controller can never be undone: nobody, including you, can upgrade that canister again. Read <L to="/help/sneedlock">the Sneed Lock help</L> before locking.
                </Warning>
            </Section>

            <Section icon={FaHourglassHalf} title="Coming soon: hand over, index, launch" id="coming-soon">
                <P>
                    The <B>Hand over</B>, <B>Index</B> and <B>Launch</B> tabs are not open to members yet: they show a "coming soon" notice until the canisters they rely on are live. The same goes for <L to="/custody">/custody</L> (the hand-over tab on its own), the custody console at <Code>/guardian</Code> and the old token launcher address <Code>/tools/pad</Code>. The <B>Hand it to Sneed custody</B> and <B>Create an index</B> buttons on the Harden tab lead to these notices for now.
                </P>
                <P>
                    What they are for, in short: handing a ledger you control to Sneed DAO custody, creating an index canister for an existing ledger, and launching a new token on NNS-approved ledger code. This page will describe them in detail once they open.
                </P>
            </Section>

            <Section icon={FaLock} title="Reading a report safely" id="safety">
                <List>
                    <Li>A good rating means the public data looks sound today. It is not a promise about the future, and it says nothing about a token's price.</Li>
                    <Li>Anything on the Internet Computer can be called a token. Always check the ledger canister id, not just the name or symbol.</Li>
                    <Li>If a gate fails, treat the rest of the report with care: whoever controls unknown code can make it report anything.</Li>
                </List>
            </Section>

            <Related links={[
                { to: '/help/tools', label: 'Tools', text: 'the other tools: Follow the Money, ICRC-3 browser, swap and more' },
                { to: '/help/sneedlock', label: 'Sneed Lock', text: 'locking tokens and LP positions' },
                { to: '/help/wallet', label: 'Wallet', text: 'tokens and positions in your Sneed wallet' },
                { to: '/help/dao', label: 'Sneed DAO', text: 'how the DAO decides' },
            ]} />
        </HelpPage>
    );
}
