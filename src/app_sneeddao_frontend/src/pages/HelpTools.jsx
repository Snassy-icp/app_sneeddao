// /help/tools: the Tools area and the explorer-style pages: account tool, ICRC-3 browser,
// Follow the Money, swap, wallet scan, transactions and the NFT browser.
import React from 'react';
import { FaTools, FaBook, FaKey, FaDatabase, FaProjectDiagram, FaExchangeAlt, FaSearch, FaList, FaImage, FaHandshake } from 'react-icons/fa';
import { HelpPage, Section, Sub, P, List, Steps, Li, B, Code, L, Tip, Warning, Info, Related } from './HelpLayout';

export default function HelpTools() {
    return (
        <HelpPage
            icon={FaTools}
            badgeIcon={FaBook}
            badge="Tools"
            title="Tools and Explorers"
            subtitle="Free utilities for anything on the Internet Computer: convert account formats, read any ICRC-3 log, follow the money on a ledger, swap tokens at the best rate, and browse transactions and NFTs."
            color="#8b5cf6"
            secondary="#a78bfa"
        >
            <Section icon={FaTools} title="The Tools page" id="overview">
                <P>
                    <L to="/tools/main">Tools</L> (in the Tools menu) lists the main tools as cards:
                </P>
                <List>
                    <Li><B>Token Studio</B>: a safety report for any token, a fix for every weak line, and (soon) launching new tokens. It has its own guide: <L to="/help/token-studio">Token Studio help</L>.</Li>
                    <Li><B>Follow the Money</B>: a graph of who sent what to whom on a ledger (below).</Li>
                    <Li><B>SNS Jailbreak</B>: add your Sneed wallet as a full controller of your SNS neurons. It has its own guide: <L to="/help/sns_jailbreak">SNS Jailbreak help</L>. It and <B>My Scripts</B> appear in the menu once you are logged in.</Li>
                    <Li><B>Account Tool</B> and <B>ICRC-3 Browser</B> (below).</Li>
                </List>
                <P>
                    Most of these tools only read public data and work without logging in. Swapping and anything that moves tokens needs you to be logged in.
                </P>
            </Section>

            <Section icon={FaKey} title="Account Tool" id="account">
                <P>
                    The <L to="/tools/account">Account Tool</L> converts between the ways an account on the Internet Computer can be written. Choose what you have:
                </P>
                <List>
                    <Li><B>Principal</B>: a plain principal.</Li>
                    <Li><B>Principal + Subaccount</B>: a principal plus a subaccount, entered as a <B>Hex String</B>, <B>Number</B>, <B>Text</B>, <B>Byte Array</B> (with <B>Start from left</B> or <B>right</B>) or as a principal with an optional <B>Index</B> in the unused bytes.</Li>
                    <Li><B>ICRC-1 Account</B>: a full account string such as <Code>principal-checksum.subaccount</Code>, or just a principal.</Li>
                </List>
                <P>
                    The <B>Account Summary</B> shows the principal, the subaccount as hex and bytes (and as a principal when it is one), the <B>ICRC-1 Account</B> string and the <B>Legacy Account ID</B> used by ICP and many exchanges. Every value has a copy button. Under <B>Token Balance</B> you can pick a token to see the balance of that exact account.
                </P>
                <P>
                    Further down, a short guide explains ICRC-1 accounts, legacy account identifiers, subaccounts and principal-derived subaccounts, with practical advice.
                </P>
                <Warning title="Legacy account IDs are one-way">
                    You can turn a principal and subaccount into a legacy account ID, but not back. Before sending to or from an exchange, double-check which format it expects.
                </Warning>
            </Section>

            <Section icon={FaDatabase} title="ICRC-3 Browser" id="icrc3">
                <P>
                    ICRC-3 is the standard way a canister publishes a tamper-evident log of blocks: each block carries the hash of the one before it, and the canister certifies the newest block. Token ledgers use it for their transactions, and Sneed Lock uses it for every lock, transfer, fee and admin action.
                </P>
                <Steps>
                    <Li>Open the <L to="/tools/icrc3">ICRC-3 Browser</L>, or <L to="/tools/icrc3?canister=pqsms-lqaaa-aaaal-ajjza-cai">the Sneed Lock log</L> directly.</Li>
                    <Li>Enter a canister id or name, or pick one from <B>Known canisters…</B> (Sneed Lock, the SNEED ledger, ckBTC, ckETH and ckUSDC ledgers).</Li>
                    <Li>Page through the blocks, jump with <B>Go to block #</B>, flip the order, and filter by <B>Block type</B>.</Li>
                    <Li>Switch between the <B>Specific</B> view (token symbols, names and links for blocks the app understands: Sneed Lock and ICRC-1/ICRC-2 ledgers), the <B>Compact</B> view, and the <B>Verbose</B> view that shows every field.</Li>
                </Steps>
                <P>
                    The browser checks the chain as you read: it marks the <B>certified tip</B>, shows whether each block's parent hash matches the block before it, and flags a <B>broken link</B> if not. Older blocks are fetched from the archives automatically.
                </P>
            </Section>

            <Section icon={FaProjectDiagram} title="Follow the Money" id="money">
                <P>
                    <L to="/tools/money">Follow the Money</L> draws an explorable graph of transfers for any ledger with an ICRC index canister: SNS tokens, ckBTC, ckETH, ckUSDC and others. Nothing is scanned up front; each node you open is read live from the index.
                </P>
                <Steps>
                    <Li>Pick a token, or paste any ledger canister id. The page looks up its index canister and labels its ICPSwap pools, Sneed Lock and, for SNS tokens, the SNS canisters.</Li>
                    <Li>In <B>Start at a principal or name</B>, enter a principal or a Sneed name and press <B>Go</B>.</Li>
                    <Li><B>Click</B> a node to expand its senders and recipients, <B>shift-click</B> to fold it, <B>alt-click</B> to remove it, <B>double-click</B> to open that principal's page. Drag to move, scroll to zoom.</Li>
                    <Li>Hover a node for its balance and totals, or an edge for the amount, number of transfers and dates in both directions. <B>Prune</B> removes every node you have not expanded, and the <B>until</B> slider shows the graph as it was on an earlier date.</Li>
                </Steps>
                <P>
                    The legend colours holders, DEX pools, Sneed Lock, DAO and treasury accounts, minting and burned. Names and nicknames come from Sneed names.
                </P>
                <Info title="Limits">
                    A busy account such as a pool shows only its most recent history. A ledger without an index canister cannot be graphed here; use the Follow the money button in a <L to="/studio">Token Studio</L> report instead, which rebuilds the graph from the block log.
                </Info>
            </Section>

            <Section icon={FaExchangeAlt} title="Swap" id="swap">
                <P>
                    <L to="/swap">Sneedex Swap</L> (Sneedex menu) compares quotes for a token pair and swaps at the best rate. It starts with ICP to SNEED; pick any other tokens with the selectors.
                </P>
                <List>
                    <Li><B>Where quotes come from</B>: ICPSwap pools; some routes go through more than one pool (<B>Multi-hop</B>). KongSwap has shut down and is no longer quoted.</Li>
                    <Li><B>Sneedex auctions</B>: if an open Sneedex auction sells the token you want with a buyout price you can pay and a better rate than the swap, it is offered as an <B>Auction Buyout</B>, alone or combined with a swap for the rest.</Li>
                    <Li><B>Slippage</B>: choose 0.5%, 1%, 2% or 5%, or type your own. The default is 1%, and your choice is remembered in your settings. If the price moves more than this before the swap runs, the swap does not go through at the worse price.</Li>
                    <Li><B>Before you swap</B> the quote shows the rate, <B>Price impact</B>, <B>Slippage tolerance</B>, how many <B>Network fees</B> (ledger fees) are paid going in and out, and the token standard used. Quotes refresh every 15 seconds.</Li>
                </List>
                <Steps>
                    <Li>Log in. Tokens come from, and arrive in, your Sneed wallet.</Li>
                    <Li>Choose the input and output token and type the amount.</Li>
                    <Li>Check the best quote and the details, then press <B>Swap</B>. Progress is shown step by step (approving or transferring, depositing, swapping, withdrawing).</Li>
                </Steps>
                <Warning title="Swaps are final">
                    A swap uses real tokens and cannot be undone. Ledger fees are paid on each transfer, and a large swap in a thin pool can move the price a lot, so watch the price impact.
                </Warning>
            </Section>

            <Section icon={FaSearch} title="Scan Wallet" id="scan-wallet">
                <P>
                    <L to="/scan_wallet">Scan Wallet</L> shows the balances of any principal. Enter a principal and press <B>Scan</B> to see its balance of each token on the Sneed Hub token list. Only the principal's main account (no subaccount) is read. Tick <B>Hide empty balances</B> to show only tokens it holds.
                </P>
            </Section>

            <Section icon={FaList} title="Transactions" id="transactions">
                <Sub>Transaction History</Sub>
                <P>
                    <L to="/transactions">Transactions</L> (Hub menu) shows the history of any ICRC-1 token. Pick a token, then filter by <B>From</B> and <B>To</B> (principal or account, combined with <B>AND</B> or <B>OR</B>) and by type (<B>Transfer</B>, <B>Mint</B>, <B>Burn</B>, <B>Approve</B>), choose how many rows per page, or jump to an index. <B>Export</B> saves the shown transactions as a CSV file. <B>Follow the money for this token</B> opens the graph described above.
                </P>
                <Sub>Transaction Explorer</Sub>
                <P>
                    Click a transaction to open the <B>Transaction Explorer</B>, or enter a transaction ID there and press <B>Search</B>. It shows the type, timestamp, accounts (with names and subaccounts), amount and fee, and lets you step to the <B>Previous</B> or <B>Next</B> transaction.
                </P>
                <Tip title="Everything here is public">
                    Ledger transactions are public. Anyone can see the transfers of any principal or account.
                </Tip>
            </Section>

            <Section icon={FaImage} title="NFT browser" id="nfts">
                <P>
                    <L to="/nfts">NFTs</L> (Hub menu) browses any ICRC-7 NFT collection, owned or not, with no login needed. Enter a collection canister id or name, or pick one under <B>In your wallet</B> or <B>Recently browsed</B>. Tokens you own are marked, and <B>Add to my wallet</B> adds the collection to your NFT wallet.
                </P>
                <P>
                    Each tile opens the token's own page, with its picture or media, description, <B>Owner</B>, <B>Attributes</B> and links. When the token is yours you also get:
                </P>
                <List>
                    <Li><B>Sell on Sneedex</B>: start a Sneedex offer for it.</Li>
                    <Li><B>Open in wallet</B> or <B>Add collection to wallet</B>.</Li>
                    <Li><B>Use as my avatar</B>: show the NFT next to your name while you own it.</Li>
                    <Li><B>Approvals (ICRC-37)</B>: which spenders may move the token (managed in the NFT wallet).</Li>
                </List>
                <P>
                    Sneed Lock locks are NFTs too. A token lock's page has a <B>Gas</B> card: sending a token lock to another principal costs one ledger fee of the locked token, and anyone can add gas so it can always be moved. LP position locks move without a fee.
                </P>
            </Section>

            <Section icon={FaHandshake} title="Escrow" id="escrow">
                <P>
                    The escrow service at <L to="/tools/escrow">/tools/escrow</L> is coming soon. <L to="/tools/escrow/swap">/tools/escrow/swap</L> is a lookup page for OpenChat escrow swaps: enter a <B>Swap ID</B> (and optionally the accepting principal) and press <B>Lookup Swap</B> to read its status, parties, dates and terms. For trading assets on Sneed Hub today, use <L to="/help/sneedex">Sneedex</L>.
                </P>
            </Section>

            <Related links={[
                { to: '/help/token-studio', label: 'Token Studio', text: 'safety reports and hardening a token' },
                { to: '/help/sns_jailbreak', label: 'SNS Jailbreak', text: 'control your SNS neurons from Sneed Hub' },
                { to: '/help/sneedex', label: 'Sneedex', text: 'offers and auctions' },
                { to: '/help/wallet', label: 'Wallet', text: 'your tokens, positions and NFTs' },
                { to: '/help/names', label: 'Sneed names', text: 'names and nicknames shown everywhere' },
            ]} />
        </HelpPage>
    );
}
