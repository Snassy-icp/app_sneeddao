// What a user can do on Sneed Hub, organised by goal. Built from the routes in
// src/app_sneeddao_frontend/src/App.jsx, the header menu (components/Header.jsx) and the help index
// (Help.jsx). Paths take ":name" placeholders (path params) and `query` maps URL query keys to
// param names. `signIn` says whether the page needs the user to log in (Internet Identity etc.).
//
// Param names shared by all features: ledger, canister, principal, lock, offer, topic, thread,
// post, proposal, neuron, sns, collection, token_id, swap, input, output, tx, appId, publisherId.

export const GOALS = [
  { id: 'start', title: 'Get started and manage your account' },
  { id: 'wallet', title: 'Hold, send and inspect tokens, NFTs and positions' },
  { id: 'lock', title: 'Lock tokens and liquidity (Sneed Lock)' },
  { id: 'trade', title: 'Trade and swap (Sneedex marketplace, swap, escrow)' },
  { id: 'governance', title: 'Governance: proposals, neurons and voting' },
  { id: 'staking', title: 'Liquid staking and neuron managers' },
  { id: 'community', title: 'Community: forum, feed, messages, tips' },
  { id: 'apps', title: 'Apps, canisters, cycles and bots' },
  { id: 'tools', title: 'Tools for token and ledger inspection' },
  { id: 'dao', title: 'Learn about Sneed DAO' },
  { id: 'help', title: 'Help and documentation' },
];

export const FEATURES = [
  // ---- start ----
  { id: 'hub', goal: 'start', title: 'Sneed Hub home', path: '/hub', summary: 'Overview of Sneed DAO, recent activity and shortcuts to every product.' },
  { id: 'login', goal: 'start', title: 'Log in', path: '/login', summary: 'Sign in with Internet Identity (or another supported login). Your principal is your public on-chain identity.',
    steps: ['Open the link and choose a login method.', 'After login, your principal appears in the top-right menu; everything you do on-chain is publicly linked to it.'] },
  { id: 'me', goal: 'start', title: 'My profile (name, avatar, settings)', path: '/me', signIn: true,
    summary: 'Your own page: set your public Sneed name and avatar, see your neurons, posts and settings.',
    steps: ['Log in.', 'Open the link (Me).', 'Use "Set Name" to choose your public name; it is visible to everyone and tied to your principal.', 'Optionally pick an avatar (image link or an ICRC-7 NFT you own).'] },
  { id: 'principal', goal: 'start', title: 'View a principal / user', path: '/principal', query: { id: 'principal' }, params: ['principal'],
    summary: 'Public page of any principal: name, posts, trades, tokens and locks.' },
  { id: 'users', goal: 'start', title: 'Browse users', path: '/users', summary: 'Directory of named principals.' },
  { id: 'names', goal: 'start', title: 'Address book (private nicknames)', path: '/names', signIn: true, summary: 'Give principals and neurons private nicknames only you see.' },
  { id: 'premium', goal: 'start', title: 'Sneed Premium', path: '/premium', summary: 'Membership with lower fees and higher limits across Sneed products.' },
  { id: 'notifications', goal: 'start', title: 'Notifications', path: '/notifications', signIn: true, summary: 'Get replies, mentions and tips by Sneed SMS, Discord or phone push.' },
  { id: 'app_pairing', goal: 'start', title: 'Sneed Hub on your phone', path: '/help/app', summary: 'Install Sneed Hub as an app and log in by pairing it with your browser.' },

  // ---- wallet ----
  { id: 'wallet', goal: 'wallet', title: 'Wallet', path: '/wallet', signIn: true,
    summary: 'Your tokens, liquidity positions, locks, neurons and canisters in one place; send, receive, add tokens.',
    steps: ['Log in.', 'Open Wallet.', 'Use "Add token" with a ledger canister id to track any ICRC-1 token.', 'Click a token to send, lock or inspect it.'] },
  { id: 'nft_wallet', goal: 'wallet', title: 'My NFTs', path: '/nft', signIn: true, summary: 'Your ICRC-7 NFTs (including Sneed Lock lock NFTs).' },
  { id: 'nft_item', goal: 'wallet', title: 'View an NFT', path: '/nft_item', query: { collection: 'collection', id: 'token_id' }, params: ['collection', 'token_id'], summary: 'One NFT of an ICRC-7 collection.' },
  { id: 'nfts', goal: 'wallet', title: 'Browse NFT collections', path: '/nfts', summary: 'Explore ICRC-7 collections.' },
  { id: 'positions', goal: 'wallet', title: 'Liquidity positions', path: '/positions', summary: 'ICPSwap liquidity positions and their locks.' },
  { id: 'transactions', goal: 'wallet', title: 'Transactions of a token', path: '/transactions', query: { ledger: 'ledger' }, params: ['ledger'], summary: 'Ledger transaction history for a token.' },
  { id: 'transaction', goal: 'wallet', title: 'One transaction', path: '/transaction', query: { ledger: 'ledger', id: 'tx' }, params: ['ledger', 'tx'], summary: 'A single ledger transaction by block index.' },
  { id: 'scan_wallet', goal: 'wallet', title: 'Scan a wallet', path: '/scan_wallet', query: { principal: 'principal' }, params: ['principal'], summary: 'Find the token balances of any principal.' },

  // ---- lock ----
  { id: 'lock_create', goal: 'lock', title: 'Create a lock (token or LP position)', path: '/lock_wizard', query: { type: 'lock_type', token: 'ledger' }, params: ['ledger', 'lock_type'], signIn: true,
    summary: 'Wizard to time-lock ICRC-1 tokens or ICPSwap liquidity positions in Sneed Lock (an ICP lock fee applies; Premium members pay less).',
    steps: ['Log in.', 'Open the lock wizard (with ?type=token&token=<ledger> it preselects the token).', 'Step 1: choose token lock or position lock.', 'Step 2: pick the token / position from your wallet (deposit it to the lock canister when asked).', 'Step 3: choose the amount, the lock end date and an optional dissolve delay, review the ICP fee and confirm.', 'The lock is public: anyone can see the owner principal, amount and dates.'] },
  { id: 'lock', goal: 'lock', title: 'View a lock', path: '/lock/:lock', params: ['lock'], summary: 'Details of one lock by id: owner, amount, lock end, dissolve state.' },
  { id: 'token_locks', goal: 'lock', title: 'Locks of a token', path: '/tokenlock', query: { ledger: 'ledger', locks: 'lock' }, params: ['ledger'], summary: 'All locks of a token, with totals.' },
  { id: 'token_locks_overview', goal: 'lock', title: 'Token locks overview', path: '/tokenlocksoverview', query: { ledger: 'ledger' }, params: ['ledger'], summary: 'Locked amounts of a token over time.' },
  { id: 'position_lock', goal: 'lock', title: 'Locks of an LP pool', path: '/positionlock', query: { swap: 'swap' }, params: ['swap'], summary: 'Locked liquidity positions of an ICPSwap pool.' },
  { id: 'all_locks', goal: 'lock', title: 'All locks (explorer)', path: '/sneedlock_info', query: { ledger: 'ledger', owner: 'principal' }, params: ['ledger', 'principal'], summary: 'Search every Sneed Lock lock by token or owner.' },
  { id: 'sneedlock', goal: 'lock', title: 'Sneed Lock overview', path: '/sneedlock', summary: 'What Sneed Lock is and how it works.' },
  { id: 'manage_my_locks', goal: 'lock', title: 'Manage my locks (extend, dissolve, withdraw)', path: '/wallet', signIn: true,
    summary: 'Your locks are listed in the Wallet under each token / position.',
    steps: ['Log in and open Wallet.', 'Open the token (or position) and its Locks section.', 'Extend the lock end, start/stop dissolving or increase the dissolve delay, or withdraw once it has unlocked.'] },

  // ---- trade ----
  { id: 'sneedex_offers', goal: 'trade', title: 'Sneedex marketplace', path: '/sneedex_offers', summary: 'Browse offers: canisters, SNS neurons, ICRC-1 tokens, NFTs and Sneed Lock locks, sold by auction or buyout.' },
  { id: 'sneedex_offer', goal: 'trade', title: 'View / bid on an offer', path: '/sneedex_offer/:offer', params: ['offer'],
    summary: 'One Sneedex offer with its assets, bids and terms.',
    steps: ['Open the offer.', 'Check the assets are escrowed (each asset shows its escrow state) and read the terms.', 'Log in, then place a bid or use buyout; your bid tokens go into escrow until the offer resolves.'] },
  { id: 'sneedex_create', goal: 'trade', title: 'Create an offer', path: '/sneedex_create', query: { lock: 'lock', nft: 'token_id' }, params: ['lock'], signIn: true,
    summary: 'List assets for sale (a creation fee applies).',
    steps: ['Log in and open Create Offer (with ?lock=<lock id> a Sneed Lock lock is preselected).', 'Add assets, set the price token, minimum bid / buyout and expiry.', 'Pay the creation fee and escrow the assets when asked, then activate the offer.'] },
  { id: 'sneedex_my', goal: 'trade', title: 'My Sneedex', path: '/sneedex_my', signIn: true, summary: 'Your offers and bids; claim won assets or proceeds.' },
  { id: 'sneedex', goal: 'trade', title: 'About Sneedex', path: '/sneedex', summary: 'How the Sneedex marketplace works.' },
  { id: 'swap', goal: 'trade', title: 'Swap tokens', path: '/swap', query: { input: 'input', output: 'output' }, params: ['input', 'output'], signIn: true, summary: 'Swap tokens through DEX aggregation.' },
  { id: 'escrow', goal: 'trade', title: 'Escrow tools', path: '/tools/escrow', signIn: true, summary: 'Peer-to-peer escrow swaps.' },

  // ---- governance ----
  { id: 'proposals', goal: 'governance', title: 'SNS proposals', path: '/proposals', query: { sns: 'sns' }, params: ['sns'], summary: 'Proposals of Sneed DAO or any SNS, with yes/no bars.' },
  { id: 'proposal', goal: 'governance', title: 'One proposal', path: '/proposal', query: { proposalid: 'proposal', sns: 'sns' }, params: ['proposal', 'sns'],
    summary: 'A proposal with its payload, tally and discussion thread.',
    steps: ['Open the proposal.', 'Read the summary, payload and the forum discussion.', 'To vote: log in with a principal that is a hotkey or controller of your neurons, then vote Yes / No.'] },
  { id: 'voting', goal: 'governance', title: 'Voting (open proposals for my neurons)', path: '/active_proposals', signIn: true, summary: 'Open proposals you can still vote on.' },
  { id: 'neurons', goal: 'governance', title: 'Browse neurons', path: '/neurons', query: { sns: 'sns' }, params: ['sns'], summary: 'Neurons of an SNS.' },
  { id: 'neuron', goal: 'governance', title: 'One neuron', path: '/neuron', query: { neuronid: 'neuron', sns: 'sns' }, params: ['neuron', 'sns'], summary: 'Neuron details, votes and hotkeys.' },
  { id: 'icp_proposals', goal: 'governance', title: 'ICP (NNS) proposals', path: '/icp_proposals', summary: 'NNS proposals.' },
  { id: 'sns', goal: 'governance', title: 'SNS directory', path: '/sns', summary: 'All SNS DAOs.' },
  { id: 'rewards', goal: 'governance', title: 'Claim voting rewards', path: '/rewards', signIn: true, summary: 'Rewards Sneed DAO distributes to neuron holders.' },

  // ---- staking ----
  { id: 'liquid_staking', goal: 'staking', title: 'Liquid staking overview', path: '/liquid_staking', summary: 'Keep staked positions tradable.' },
  { id: 'icp_staking_bot', goal: 'staking', title: 'Create an ICP staking bot (neuron manager)', path: '/create_icp_neuron', signIn: true, summary: 'A dedicated app canister that holds and manages your ICP neurons.' },
  { id: 'icp_neuron_manager', goal: 'staking', title: 'Manage an ICP staking bot', path: '/icp_neuron_manager/:canister', params: ['canister'], signIn: true, summary: 'Neurons, following and cycles of one ICP staking bot canister.' },
  { id: 'sns_neuron_wizard', goal: 'staking', title: 'Create an SNS neuron', path: '/sns_neuron_wizard', signIn: true, summary: 'Stake SNS tokens into a neuron, step by step.' },
  { id: 'sns_jailbreak', goal: 'staking', title: 'SNS Jailbreak', path: '/tools/sns_jailbreak', signIn: true, summary: 'Add full controller access to your SNS neurons so they can be traded.' },

  // ---- community ----
  { id: 'forum', goal: 'community', title: 'Forum', path: '/forum', summary: 'Discussion forums of Sneed DAO and other SNS DAOs.' },
  { id: 'topic', goal: 'community', title: 'Forum topic', path: '/topic/:topic', query: { sns: 'sns' }, params: ['topic', 'sns'], summary: 'Threads of one topic.' },
  { id: 'thread', goal: 'community', title: 'Forum thread', path: '/thread', query: { threadid: 'thread', sns: 'sns' }, params: ['thread', 'sns'],
    summary: 'A thread and its posts.',
    steps: ['Open the thread.', 'Log in to reply, vote on posts with your neurons, or tip a post.', 'Posts are public and show your principal / name.'] },
  { id: 'post', goal: 'community', title: 'Forum post', path: '/post', query: { postid: 'post', sns: 'sns' }, params: ['post'], summary: 'One post.' },
  { id: 'feed', goal: 'community', title: 'Feed', path: '/feed', summary: 'Latest forum activity across all forums.' },
  { id: 'my_posts', goal: 'community', title: 'My posts, replies and mentions', path: '/posts', signIn: true, summary: 'Your posts and replies or mentions of you.' },
  { id: 'sms', goal: 'community', title: 'Sneed SMS (direct messages)', path: '/sms', query: { recipient: 'principal' }, params: ['principal'], signIn: true, summary: 'Send and receive messages between principals.' },
  { id: 'tips', goal: 'community', title: 'Tips', path: '/tips', signIn: true, summary: 'Tips you sent and received on forum posts.' },
  { id: 'feedback', goal: 'community', title: 'Send feedback / bug report', path: '/feedback', summary: 'Report a bug or suggest an improvement to Sneed DAO.' },

  // ---- apps ----
  { id: 'apps', goal: 'apps', title: 'My apps (canister manager)', path: '/apps', signIn: true, summary: 'Track, organise, top up and monitor your Internet Computer canisters.' },
  { id: 'canister', goal: 'apps', title: 'View a canister', path: '/canister', query: { id: 'canister' }, params: ['canister'], summary: 'Canister details: controllers, cycles (when readable), module hash; top up cycles.' },
  { id: 'canisters', goal: 'apps', title: 'Canisters', path: '/canisters', signIn: true, summary: 'Your tracked canisters.' },
  { id: 'sneedapp', goal: 'apps', title: 'Sneedapp app store', path: '/sneedapp', summary: 'Browse apps you can mint as your own canister.' },
  { id: 'sneedapp_app', goal: 'apps', title: 'App details', path: '/sneedapp/app/:appId', params: ['appId'], summary: 'One app in the Sneedapp store.' },
  { id: 'sneedapp_mint', goal: 'apps', title: 'Mint an app', path: '/sneedapp/mint/:appId', params: ['appId'], signIn: true, summary: 'Create your own canister of an app.' },
  { id: 'sneedapp_publisher', goal: 'apps', title: 'App publisher', path: '/sneedapp/publisher/:publisherId', params: ['publisherId'], summary: 'Apps of one publisher.' },
  { id: 'trading_bot', goal: 'apps', title: 'Trading bot', path: '/trading_bot/:canister', params: ['canister'], signIn: true, summary: 'Automated swaps, rebalancing and distribution from your own bot canister.' },

  // ---- tools ----
  { id: 'tools', goal: 'tools', title: 'Tools', path: '/tools/main', summary: 'All tools.' },
  { id: 'token_studio', goal: 'tools', title: 'Token Studio', path: '/studio/:ledger', params: ['ledger'], summary: 'Inspect and manage a token ledger (with no ledger: /studio).' },
  { id: 'token_safety', goal: 'tools', title: 'Token safety rating', path: '/tools/token_safety/:ledger', params: ['ledger'], summary: 'Check how safe a token\'s ledger setup is (controllers, wasm, upgrades).' },
  { id: 'custody', goal: 'tools', title: 'Custody', path: '/custody', summary: 'Custody tools for canisters and ledgers.' },
  { id: 'follow_money', goal: 'tools', title: 'Follow the money', path: '/tools/money', summary: 'Trace token flows between accounts.' },
  { id: 'icrc3', goal: 'tools', title: 'ICRC-3 browser', path: '/tools/icrc3', summary: 'Browse ICRC-3 block logs of a canister.' },
  { id: 'account_tool', goal: 'tools', title: 'Account tool', path: '/tools/account', summary: 'Convert between principals, subaccounts and account ids.' },

  // ---- dao ----
  { id: 'dao', goal: 'dao', title: 'Sneed DAO', path: '/dao', summary: 'About Sneed DAO.' },
  { id: 'dao_dashboard', goal: 'dao', title: 'DAO dashboard', path: '/dao_info', summary: 'Treasury and governance figures.' },
  { id: 'tokenomics', goal: 'dao', title: 'Tokenomics', path: '/rll_info', summary: 'How revenue flows to SNEED holders (the recycling loop).' },
  { id: 'revenue', goal: 'dao', title: 'Revenue', path: '/revenue', summary: 'Live revenue and fee transparency.' },
  { id: 'health', goal: 'dao', title: 'Health', path: '/health', summary: 'Status of Sneed DAO canisters.' },
  { id: 'products', goal: 'dao', title: 'Products', path: '/products', summary: 'Everything Sneed DAO builds.' },
  { id: 'partners', goal: 'dao', title: 'Partners', path: '/partners' },
  { id: 'projects', goal: 'dao', title: 'Projects', path: '/projects' },
  { id: 'donate', goal: 'dao', title: 'Donate / thank-you wall', path: '/donate', summary: 'Donate to the DAO; donations are verified on the ledger and shown publicly.' },
  { id: 'mr_sneed', goal: 'dao', title: 'Mr Sneed', path: '/mr-sneed', summary: 'Mr Sneed: the DAO\'s mascot and spirit, given a voice by AI.' },
  { id: 'lore', goal: 'dao', title: 'Lore', path: '/lore' },
  { id: 'disclaimer', goal: 'dao', title: 'Disclaimer', path: '/disclaimer' },

  // ---- help ----
  { id: 'help', goal: 'help', title: 'Help center', path: '/help', summary: 'Guides for every product.' },
  { id: 'help_wallet', goal: 'help', title: 'Help: wallet', path: '/help/wallet' },
  { id: 'help_sneedlock', goal: 'help', title: 'Help: Sneed Lock', path: '/help/sneedlock' },
  { id: 'help_sneedex', goal: 'help', title: 'Help: Sneedex', path: '/help/sneedex' },
  { id: 'help_neurons', goal: 'help', title: 'Help: SNS neurons', path: '/help/neurons' },
  { id: 'help_icp_neuron_manager', goal: 'help', title: 'Help: ICP staking bots', path: '/help/icp-neuron-manager' },
  { id: 'help_trading_bot', goal: 'help', title: 'Help: trading bot', path: '/help/trading_bot' },
  { id: 'help_canister_manager', goal: 'help', title: 'Help: app / canister manager', path: '/help/dapp-manager' },
  { id: 'help_sns_jailbreak', goal: 'help', title: 'Help: SNS Jailbreak', path: '/help/sns_jailbreak' },
  // Help pages being added to App.jsx alongside this server (2026-10-20).
  { id: 'help_names', goal: 'help', title: 'Help: names, profiles and avatars', path: '/help/names' },
  { id: 'help_dao', goal: 'help', title: 'Help: Sneed DAO', path: '/help/dao' },
  { id: 'help_proposals', goal: 'help', title: 'Help: proposals and voting', path: '/help/proposals' },
  { id: 'help_liquid_staking', goal: 'help', title: 'Help: liquid staking and SNS neurons', path: '/help/liquid-staking' },
  { id: 'help_forum', goal: 'help', title: 'Help: forum, feed and tips', path: '/help/forum' },
  { id: 'help_sms', goal: 'help', title: 'Help: Sneed SMS', path: '/help/sms' },
  { id: 'help_notifications', goal: 'help', title: 'Help: notifications', path: '/help/notifications' },
  { id: 'help_sneedapp', goal: 'help', title: 'Help: Sneedapp app store', path: '/help/sneedapp' },
  { id: 'help_token_studio', goal: 'help', title: 'Help: Token Studio and token safety', path: '/help/token-studio' },
  { id: 'help_tools', goal: 'help', title: 'Help: tools', path: '/help/tools' },
  { id: 'api', goal: 'help', title: 'API docs for developers and agents', path: '/api', summary: 'Canister API references (also at /api-docs/<canister>.md and /llms.txt).' },
  { id: 'api_doc', goal: 'help', title: 'One API doc', path: '/api/:slug', params: ['slug'] },
];

export const featureById = new Map(FEATURES.map((f) => [f.id, f]));
