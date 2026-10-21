// The map of Sneed DAO's system: every canister, the outside canisters and off-chain parts they
// depend on, how they connect, and which of Sneed's services use them. Rendered by /architecture
// (src/pages/Architecture.jsx); scripts/build-api-docs.mjs reads it too, for the opt-in
// /.well-known/ic-architecture file, and warns when the ids here disagree with canister_ids.json.
//
// Plain data, no imports: Node reads this file as well as the browser.
//
// HOW TO UPDATE
// - New canister: add it to NODES (id = its dfx.json name for our own canisters), with its cluster,
//   its grid cell `at: [col, row]` inside the cluster box (two columns per cluster; the outside band
//   has six), its ids from canister_ids.json, controllers, persistence (dfx.json args) and whether it
//   keeps an ICRC-3 log. Then add its connections to EDGES and the canister to the SERVICES that use it.
// - Edges: derive them from the canister's source (grep main.mo for `actor (` and Principal.fromText of
//   other canister ids). `from` is the caller (or the payer, or the controller); `to` the callee.
// - Controllers: check with `dfx canister --network ic --identity anonymous info <id>`; the page
//   also reads them live when a canister is opened.
// - Run `npm run check` and open /architecture: a node outside its cluster box means a grid cell clash.

/** Groups shown as boxes in the diagram and as cards in the overview. `box` is the box's place in
 *  the grid: [column, row] for the six clusters, and the bands span all three columns. */
export const CLUSTERS = [
    { id: 'access', name: 'Who uses it', color: '#94a3b8', icon: 'FaUsers', band: 'top', blurb: 'People in the browser, AI agents and integrators, and the login they use.' },
    { id: 'governance', name: 'Governance', color: '#8b5cf6', icon: 'FaLandmark', box: [0, 0], blurb: 'The SNS that owns and upgrades everything, the revenue loop, voter rewards and Mr Sneed.' },
    { id: 'money', name: 'Money and trading', color: '#f59e0b', icon: 'FaCoins', box: [1, 0], blurb: 'Locks, the escrow marketplace, Premium, and the Token Studio launchpad and custody.' },
    { id: 'apps', name: 'Apps and bots', color: '#d946ef', icon: 'FaRobot', box: [2, 0], blurb: 'The app store and the bot canisters it mints, each owned by its user.' },
    { id: 'community', name: 'Community', color: '#3b82f6', icon: 'FaComments', box: [0, 1], blurb: 'Forum, direct messages, notifications to SMS, Discord and phone, and the watcher.' },
    { id: 'identity', name: 'Identity', color: '#ec4899', icon: 'FaIdBadge', box: [1, 1], blurb: 'Names, nicknames, avatars and profiles for principals and neurons.' },
    { id: 'infra', name: 'Infrastructure', color: '#64748b', icon: 'FaServer', box: [2, 1], blurb: 'The web app, its backend, activity log archives and cycles.' },
    { id: 'external', name: 'Internet Computer and partners', color: '#0ea5e9', icon: 'FaGlobe', band: 'bottom', blurb: 'System canisters, ledgers, DEXes and partner canisters that Sneed builds on.' },
];

/** Who controls a canister (on mainnet; staging canisters are controlled by the team). */
export const CONTROLLERS = {
    sns: { label: 'Sneed DAO (SNS root)', note: 'Only an adopted SNS proposal can change its code or settings.' },
    team: { label: 'Team principals', note: 'Controlled by developers for now; the plan is to hand it to the DAO.' },
    operator: { label: 'Mr Sneed\'s principal', note: 'Controlled by Mr Sneed\'s operator principal while it is being built.' },
    parent: { label: 'Its parent canister', note: 'Created and controlled by the canister whose log it archives.' },
    user: { label: 'Its owner', note: 'Each copy belongs to the user who minted it; nobody else can change it.' },
    system: { label: 'NNS', note: 'An Internet Computer system canister, governed by the NNS.' },
    sns_other: { label: 'Each SNS', note: 'Every SNS controls its own canisters.' },
    third: { label: 'Third party', note: 'Run by another project.' },
    blackholed: { label: 'Blackholed', note: 'No controller can change it.' },
    offchain: { label: 'Off-chain', note: 'Not a canister: a program running outside the Internet Computer.' },
};

export const PERSISTENCE = {
    eop: { label: 'Enhanced orthogonal persistence', note: 'Upgrade proposals must keep the Wasm memory (wasm_memory_persistence = keep).' },
    classic: { label: 'Classic (stable variables)', note: 'State survives upgrades through stable variables.' },
};

/** Edge kinds, in legend order. `on` is whether the diagram shows them before you filter. */
export const EDGE_TYPES = [
    { id: 'call', label: 'Calls', color: '#94a3b8', dash: null, on: true, note: 'Inter-canister call' },
    { id: 'payment', label: 'Payments', color: '#10b981', dash: null, on: true, note: 'Ledger transfer or payment' },
    { id: 'notify', label: 'Notifications', color: '#f59e0b', dash: '6 4', on: true, note: 'A message delivered to a user' },
    { id: 'relay', label: 'Off-chain', color: '#ec4899', dash: '2 4', on: true, note: 'Something outside the IC calling in' },
    { id: 'control', label: 'Controls', color: '#8b5cf6', dash: '10 4 2 4', on: false, note: 'Controller: can install and upgrade code' },
];

const SNS_ROOT = 'fp274-iaaaa-aaaaq-aacha-cai';

/**
 * Every box in the diagram.
 * kind: 'dao' (our canister), 'sns' (Sneed's own SNS canisters, NNS-blessed code), 'external' (someone
 * else's canister), 'offchain', 'people'.
 * status: 'live' (on mainnet), 'staging' (staging only), 'upcoming' (being built).
 * role: a few words; about: one or two sentences (also published in /.well-known/ic-architecture).
 * api: slug of its API doc (/api/<slug>). ids: { ic, staging } for our canisters, { ic } for others.
 * icrc3: keeps an ICRC-3 activity log. controllers / persistence: keys of the tables above.
 */
export const NODES = [
    // ---- who uses it (top band, six columns) ----
    { id: 'people', name: 'You', role: 'browser or phone app', kind: 'people', cluster: 'access', at: [1, 0], icon: 'FaUser',
        about: 'Anyone with a browser: Sneed Hub runs in your browser and calls the canisters below directly, signed with your Internet Identity.' },
    { id: 'agents', name: 'AI agents and integrators', role: 'wallets, DEXes, scripts', kind: 'people', cluster: 'access', at: [2, 0], icon: 'FaRobot',
        about: 'Any wallet, dashboard, script or AI agent can call Sneed\'s canisters on the same terms as Sneed Hub: they authorise by calling principal only. Guide: /llms.txt and the API docs.' },
    { id: 'internet_identity', name: 'Internet Identity', role: 'login', kind: 'external', cluster: 'access', at: [4, 0], icon: 'FaFingerprint',
        ids: { ic: 'rdmx6-jaaaa-aaaaa-aaadq-cai' }, controllers: 'system',
        about: 'The Internet Computer\'s passkey login. It gives you one principal for Sneed Hub; Sneed never sees your keys.' },

    // ---- governance ----
    { id: 'sns_governance', name: 'SNS governance', role: 'neurons, proposals, treasury', kind: 'sns', cluster: 'governance', at: [0, 0], icon: 'FaVoteYea',
        ids: { ic: 'fi3zi-fyaaa-aaaaq-aachq-cai' }, controllers: 'sns',
        about: 'Sneed DAO itself: SNEED neurons vote on proposals here, and it holds the ICP and SNEED treasury. Adopted proposals upgrade every DAO canister through SNS root.' },
    { id: 'sns_root', name: 'SNS root', role: 'controller of the dapps', kind: 'sns', cluster: 'governance', at: [1, 0], icon: 'FaSitemap',
        ids: { ic: SNS_ROOT }, controllers: 'sns',
        about: 'The controller of Sneed DAO\'s canisters. It installs and upgrades them only when governance tells it to, after a proposal passes.' },
    { id: 'sneed_ledger', name: 'SNEED ledger', role: 'SNEED token', kind: 'sns', cluster: 'governance', at: [0, 1], icon: 'FaCoins',
        ids: { ic: 'hvgxa-wqaaa-aaaaq-aacia-cai' }, controllers: 'sns', icrc3: true,
        about: 'The SNEED token\'s ICRC-1/2/3 ledger, part of the SNS. Staking SNEED in a neuron gives voting power.' },
    { id: 'sneed_index', name: 'SNEED index', role: 'transaction history', kind: 'sns', cluster: 'governance', at: [1, 1], icon: 'FaListUl',
        ids: { ic: 'h3e2i-naaaa-aaaaq-aacja-cai' }, controllers: 'sns',
        about: 'Indexes the SNEED ledger so wallets can list an account\'s transactions.' },
    { id: 'rll', name: 'Rewards (RLL)', role: 'voter rewards', kind: 'dao', cluster: 'governance', at: [0, 2], icon: 'FaGift',
        ids: { ic: 'lvc4n-7aaaa-aaaam-adm6a-cai', staging: 'twapx-riaaa-aaaak-qlojq-cai' }, controllers: 'sns', persistence: 'classic', icrc3: true, api: 'rll',
        about: 'The Recursive Liquidity Loop\'s rewards canister: shares revenue among Sneed DAO neuron owners by voting power; claims pay real tokens.' },
    { id: 'sneed_defi', name: 'Sneed DeFi canister', role: 'treasury extension', kind: 'dao', cluster: 'governance', at: [1, 2], icon: 'FaPiggyBank',
        ids: { ic: 'ok64y-uiaaa-aaaag-qdcbq-cai' }, controllers: 'sns',
        about: 'Treasury extension for ICRC-1 tokens: holds LP fees and other revenue, sends ICP on to the ICP splitter and tokens to member rewards.' },
    { id: 'mr_sneed', name: 'Mr Sneed', role: 'the DAO\'s voice', kind: 'dao', cluster: 'governance', at: [0, 3], icon: 'FaUserTie',
        ids: { ic: 'ucthl-5qaaa-aaaay-aadrq-cai', staging: 'ufsb7-qiaaa-aaaay-aadra-cai' }, controllers: 'team', persistence: 'eop', icrc3: true, api: 'mr_sneed',
        about: 'The DAO\'s mascot and spirit given a voice by AI: the personality the DAO sets by proposal, public memories and an activity log. Runs on a TEE (SEV-SNP) subnet.' },
    { id: 'mr_sneed_operator', name: 'Mr Sneed\'s operator', role: 'off-chain worker', kind: 'offchain', cluster: 'governance', at: [1, 3], icon: 'FaLaptopCode',
        controllers: 'offchain',
        about: 'The program that speaks as Mr Sneed for now: it reads the forum and messages, answers, and writes memories to the canister with its own principal.' },

    // ---- money and trading ----
    { id: 'sneed_lock', name: 'Sneed Lock', role: 'token and LP locks', kind: 'dao', cluster: 'money', at: [0, 0], icon: 'FaLock',
        ids: { ic: 'pqsms-lqaaa-aaaal-ajjza-cai', staging: '25fsc-7yaaa-aaaal-qjt5q-cai' }, controllers: 'sns', persistence: 'classic', icrc3: true, api: 'sneed_lock',
        about: 'Time locks for ICRC-1 tokens and ICPSwap liquidity positions; every lock is an ICRC-7 NFT. Moves real funds.' },
    { id: 'sneedex', name: 'Sneedex', role: 'escrow marketplace', kind: 'dao', cluster: 'money', at: [1, 0], icon: 'FaExchangeAlt',
        ids: { ic: '7bvk3-ryaaa-aaaal-qtykq-cai', staging: 'igm46-laaaa-aaaae-qgwra-cai' }, controllers: 'sns', persistence: 'classic', icrc3: true, api: 'sneedex',
        about: 'Offers and bids for tokens, NFTs, SNS neurons, canisters and Sneed Locks, held in escrow until the deal closes. Moves real funds.' },
    { id: 'sneed_premium', name: 'Sneed Premium', role: 'membership', kind: 'dao', cluster: 'money', at: [0, 1], icon: 'FaCrown',
        ids: { ic: '7gump-4aaaa-aaaal-qtyka-cai', staging: 'sf5tm-dqaaa-aaaae-qgyla-cai' }, controllers: 'sns', persistence: 'classic', icrc3: true, api: 'sneed_premium',
        about: 'Premium membership, bought in ICP or earned by staked SNEED voting power. Other canisters ask it who is a member for their discounts and higher limits.' },
    { id: 'sgldt', name: 'sGLDT', role: 'DAO-registered token', kind: 'dao', cluster: 'money', at: [1, 1], icon: 'FaCoins',
        ids: { ic: 'i2s4q-syaaa-aaaan-qz4sq-cai' }, controllers: 'sns',
        about: 'The sGLDT token canister, registered with Sneed DAO; the wallet shows it next to GLDT.' },
    { id: 'sneed_pad', name: 'Sneed Pad', role: 'token launcher', kind: 'dao', cluster: 'money', at: [0, 2], icon: 'FaRocket', status: 'staging',
        ids: { staging: 'symdn-ciaaa-aaaal-qxobq-cai' }, controllers: 'team', persistence: 'classic', icrc3: true,
        about: 'Token Studio\'s launchpad: creates an ICRC ledger (and index) from NNS-approved SNS-W Wasms, paid once, then hands control to you, a blackhole, Sneed DAO or a custody canister. Staging only so far.' },
    { id: 'sneed_guardian', name: 'Sneed Guardian', role: 'ledger custody', kind: 'dao', cluster: 'money', at: [1, 2], icon: 'FaShieldAlt', status: 'staging',
        ids: { staging: 'ri7jl-6iaaa-aaaal-qxojq-cai' }, controllers: 'team', persistence: 'classic', icrc3: true,
        about: 'Custody controller for project ledgers: runs only NNS-blessed Wasm hashes, and every change is an operation approved by the DAO. One codebase, also planned as a blackholed and a multi-DAO deployment. Staging only so far.' },

    // ---- apps and bots ----
    { id: 'sneedapp', name: 'Sneedapp', role: 'app store', kind: 'dao', cluster: 'apps', at: [0, 0], icon: 'FaStore',
        ids: { ic: 'sfamc-kyaaa-aaaau-adnpq-cai', staging: '34e6r-ayaaa-aaaad-adkoa-cai' }, controllers: 'sns', persistence: 'classic', icrc3: true, api: 'sneedapp',
        about: 'Mints bot canisters for users and keeps the catalogue of apps, versions and Wasm hashes; minting costs ICP. The minted canister belongs to its user.' },
    { id: 'sneed_icp_staking_bot', name: 'ICP staking bots', role: 'user-owned app', kind: 'dao', cluster: 'apps', at: [1, 0], icon: 'FaBrain',
        ids: { ic: 'utrgg-zqaaa-aaaad-aduma-cai', staging: 'utrgg-zqaaa-aaaad-aduma-cai' }, controllers: 'user', persistence: 'classic',
        about: 'A canister that owns and manages your NNS neurons (stake, vote, follow, disburse) with chores and botkeys. Liquid: it can be sent or sold on Sneedex. The id shown is a reference instance.' },
    { id: 'sneed_trading_bot', name: 'Trading bots', role: 'user-owned app', kind: 'dao', cluster: 'apps', at: [0, 1], icon: 'FaChartLine',
        ids: { ic: 'pojsz-fqaaa-aaaad-adoga-cai', staging: 'pojsz-fqaaa-aaaad-adoga-cai' }, controllers: 'user', persistence: 'classic',
        about: 'A canister that trades for you on ICPSwap and KongSwap: swaps, rebalancing, purses and circuit breakers. The id shown is a reference instance.' },
    { id: 'icrc7_demo', name: 'NFT demo collection', role: 'test ICRC-7 collection', kind: 'dao', cluster: 'apps', at: [1, 1], icon: 'FaImage', status: 'staging',
        ids: { staging: 'tsdbx-ayaaa-aaaal-qxogq-cai' }, controllers: 'team', persistence: 'classic',
        about: 'A small ICRC-7 collection on staging for testing NFT avatars and Sneedex NFT escrow.' },

    // ---- community ----
    { id: 'sneed_sns_forum', name: 'Forum', role: 'one forum per SNS', kind: 'dao', cluster: 'community', at: [0, 0], icon: 'FaComments',
        ids: { ic: 'mcigm-4aaaa-aaaad-qhlkq-cai', staging: 'nrtf2-wiaaa-aaaad-aankq-cai' }, controllers: 'sns', persistence: 'eop', icrc3: true, api: 'sneed_sns_forum',
        about: 'Forums, threads, posts, neuron-weighted votes and polls, tips, mentions and proposal threads, for every SNS.' },
    { id: 'sneed_sms', name: 'Sneed SMS', role: 'direct messages', kind: 'dao', cluster: 'community', at: [1, 0], icon: 'FaEnvelope',
        ids: { ic: 'zelpl-7yaaa-aaaad-abtcq-cai', staging: 'v33jy-4qaaa-aaaad-absna-cai' }, controllers: 'sns', persistence: 'eop', api: 'sneed_sms',
        about: 'Messages between principals, and system messages from authorised canisters. Not public, not encrypted: admins can read them.' },
    { id: 'sneed_notifications', name: 'Notifications', role: 'delivery to SMS, Discord, push', kind: 'dao', cluster: 'community', at: [0, 1], icon: 'FaBell',
        ids: { ic: 'vuy7a-iaaaa-aaaay-aaduq-cai', staging: 'uqvqs-raaaa-aaaay-aadsq-cai' }, controllers: 'sns', persistence: 'eop', api: 'sneed_notifications',
        about: 'Any dapp can notify its users here, and each user picks the dapps and channels: Sneed SMS, Discord or phone push. Users pay paid channels in ICP. Built with Unicycle.' },
    { id: 'sneed_mon', name: 'Sneed Monitor', role: 'proposal watcher', kind: 'dao', cluster: 'community', at: [1, 1], icon: 'FaEye', status: 'upcoming',
        ids: { staging: 'v53u4-6iaaa-aaaay-aadva-cai' }, controllers: 'operator', persistence: 'eop', api: 'sneed_mon',
        about: 'Sneed Hub\'s watcher: tells you, through Sneed Notifications, when an SNS or NNS proposal opens that one of your neurons can vote on and hasn\'t, and reminds you before it closes. Watch per SNS or the NNS; you pay for being monitored. On staging; not live yet.' },
    { id: 'relays', name: 'Notification relays', role: 'Discord and phone push', kind: 'offchain', cluster: 'community', at: [0, 2], icon: 'FaBroadcastTower',
        controllers: 'offchain',
        about: 'Programs outside the IC that pull pending notifications for Discord and phone push, decrypt the address with their key, deliver, and confirm. Each relay is a registered principal.' },

    // ---- identity ----
    { id: 'sneed_pid_names', name: 'Names', role: 'public names', kind: 'dao', cluster: 'identity', at: [0, 0], icon: 'FaIdBadge',
        ids: { ic: 'ejz7n-lyaaa-aaaad-qmkzq-cai', staging: 'qechb-aiaaa-aaaad-ag6lq-cai' }, controllers: 'sns', persistence: 'eop', icrc3: true, api: 'sneed_names',
        about: 'Public names of principals and accounts, linked accounts and hotkeys, and NFT avatars (checked against the collection).' },
    { id: 'sneed_neuron_names', name: 'Neuron names', role: 'public neuron names', kind: 'dao', cluster: 'identity', at: [1, 0], icon: 'FaBrain',
        ids: { ic: 'e46oa-kqaaa-aaaad-qmk2a-cai', staging: 'rjmdp-paaaa-aaaad-ag6ma-cai' }, controllers: 'sns', persistence: 'eop', icrc3: true, api: 'sneed_names',
        about: 'Public names of SNS neurons, set by the neuron\'s owners.' },
    { id: 'sneed_pid_nicknames', name: 'Nicknames', role: 'private nicknames', kind: 'dao', cluster: 'identity', at: [0, 1], icon: 'FaUserTag',
        ids: { ic: 'e37iu-hiaaa-aaaad-qmk2q-cai', staging: 'ronf3-cyaaa-aaaad-ag6mq-cai' }, controllers: 'sns', persistence: 'eop', api: 'sneed_names',
        about: 'Your private nicknames for principals: only you see them (not encrypted).' },
    { id: 'sneed_neuron_nicknames', name: 'Neuron nicknames', role: 'private nicknames', kind: 'dao', cluster: 'identity', at: [1, 1], icon: 'FaTags',
        ids: { ic: 'es4di-raaaa-aaaad-qmk3a-cai', staging: 'rhooh-uqaaa-aaaad-ag6na-cai' }, controllers: 'sns', persistence: 'eop', api: 'sneed_names',
        about: 'Your private nicknames for neurons.' },
    { id: 'sneed_avatars', name: 'Avatars', role: 'avatar images', kind: 'dao', cluster: 'identity', at: [0, 2], icon: 'FaUserCircle',
        ids: { ic: 'ev5f4-4yaaa-aaaad-qmk3q-cai', staging: 'rapit-ziaaa-aaaad-ag6nq-cai' }, controllers: 'sns', persistence: 'eop', api: 'sneed_names',
        about: 'Uploaded avatar images; Premium members can hold more of them.' },
    { id: 'sneed_profiles', name: 'Profiles', role: 'profiles and dapp entries', kind: 'dao', cluster: 'identity', at: [1, 2], icon: 'FaAddressCard',
        ids: { ic: 'fytbs-tqaaa-aaaad-qmk4a-cai', staging: 'rviz6-yaaaa-aaaad-ag6oa-cai' }, controllers: 'sns', persistence: 'eop', icrc3: true, api: 'sneed_names',
        about: 'Public profiles and dapp directory entries.' },

    // ---- infrastructure ----
    { id: 'app_sneeddao_frontend', name: 'Sneed Hub web app', role: 'asset canister', kind: 'dao', cluster: 'infra', at: [0, 0], icon: 'FaGlobe',
        ids: { ic: 'pxtkg-giaaa-aaaal-ajjzq-cai', staging: '2icdp-6qaaa-aaaal-qjt6a-cai' }, controllers: 'team',
        about: 'Sneed Hub, the web app (asset canister) at app.sneeddao.com. It holds only files: your browser runs it and calls each canister itself. Guide for agents: /llms.txt' },
    { id: 'app_sneeddao_backend', name: 'Sneed Hub backend', role: 'settings and token list', kind: 'dao', cluster: 'infra', at: [1, 0], icon: 'FaServer',
        ids: { ic: 'g7s5u-tqaaa-aaaad-qhktq-cai', staging: '7tsda-tiaaa-aaaad-aajxa-cai' }, controllers: 'sns', persistence: 'eop', api: 'app_sneeddao_backend',
        about: 'Settings, whitelisted tokens and their metadata, canister folders, partners, projects, donations, SNS Jailbreak and name moderation.' },
    { id: 'icrc3_archives', name: 'ICRC-3 archives', role: 'old log blocks', kind: 'dao', cluster: 'infra', at: [0, 1], icon: 'FaArchive', controllers: 'parent',
        about: 'Archive canisters that a canister with an ICRC-3 log creates, controls and tops up as its log grows; anyone can verify the hash chain.' },
    { id: 'unicycle', name: 'ic-unicycle', role: 'cycles monitor', kind: 'external', cluster: 'infra', at: [1, 1], icon: 'FaBolt', controllers: 'third',
        about: 'The member-built monitor that watches the DAO\'s cycles, tops canisters up and can file treasury proposals for SNS-controlled canisters. Also Sneed Notifications\' partner.' },

    // ---- Internet Computer and partners (bottom band, six columns) ----
    { id: 'icp_ledger', name: 'ICP ledger', role: 'ICP payments', kind: 'external', cluster: 'external', at: [0, 0], icon: 'FaCoins',
        ids: { ic: 'ryjl3-tyaaa-aaaaa-aaaba-cai' }, controllers: 'system',
        about: 'The ICP token ledger: every fee and payment in ICP goes through it.' },
    { id: 'icrc_ledgers', name: 'ICRC ledgers', role: 'any token', kind: 'external', cluster: 'external', at: [1, 0], icon: 'FaLayerGroup', controllers: 'third',
        about: 'The ledger of any ICRC-1 token (SNS tokens, ck-tokens, project tokens): locked, traded, tipped, paid out as rewards or created by the pad.' },
    { id: 'cmc', name: 'Cycles minting canister', role: 'ICP to cycles', kind: 'external', cluster: 'external', at: [2, 0], icon: 'FaBolt',
        ids: { ic: 'rkp4c-7iaaa-aaaaa-aaaca-cai' }, controllers: 'system',
        about: 'Turns ICP into cycles: used to create and top up canisters.' },
    { id: 'management', name: 'IC management canister', role: 'create and install', kind: 'external', cluster: 'external', at: [3, 0], icon: 'FaCogs',
        ids: { ic: 'aaaaa-aa' }, controllers: 'system',
        about: 'The system interface that creates canisters, installs code and changes controllers.' },
    { id: 'nns_governance', name: 'NNS governance', role: 'ICP neurons', kind: 'external', cluster: 'external', at: [4, 0], icon: 'FaUniversity',
        ids: { ic: 'rrkah-fqaaa-aaaaa-aaaaq-cai' }, controllers: 'system',
        about: 'The Internet Computer\'s governance, where ICP neurons live. ICP staking bots manage neurons here.' },
    { id: 'sns_w', name: 'SNS-W', role: 'SNS directory and Wasms', kind: 'external', cluster: 'external', at: [5, 0], icon: 'FaBook',
        ids: { ic: 'qaa6y-5yaaa-aaaaa-aaafa-cai' }, controllers: 'system',
        about: 'Lists every SNS and the NNS-approved Wasms: Sneed\'s canisters use it to tell a real SNS from a fake one, and the pad and guardian take ledger Wasms from it.' },
    { id: 'other_snses', name: 'Every SNS', role: 'their governance canisters', kind: 'external', cluster: 'external', at: [0, 1], icon: 'FaNetworkWired', controllers: 'sns_other',
        about: 'The governance and root canisters of every SNS (Sneed\'s included): neurons for forum votes, names, escrowed neurons and proposals to watch.' },
    { id: 'icpswap', name: 'ICPSwap', role: 'DEX: pools and token list', kind: 'external', cluster: 'external', at: [1, 1], icon: 'FaWater',
        ids: { ic: '4mmnk-kiaaa-aaaag-qbllq-cai' }, controllers: 'third',
        about: 'The DEX whose pools hold liquidity positions (locked in Sneed Lock), whose token list feeds token metadata, and where trading bots swap. The id shown is its pool factory; the token list is k37c6-riaaa-aaaag-qcyza-cai.' },
    { id: 'kong', name: 'KongSwap', role: 'DEX', kind: 'external', cluster: 'external', at: [2, 1], icon: 'FaExchangeAlt',
        ids: { ic: '2ipq2-uqaaa-aaaar-qailq-cai' }, controllers: 'third',
        about: 'A DEX that trading bots and the Swap page use next to ICPSwap.' },
    { id: 'nft_collections', name: 'NFT collections', role: 'ICRC-7 and EXT', kind: 'external', cluster: 'external', at: [3, 1], icon: 'FaImage', controllers: 'third',
        about: 'Any ICRC-7 or EXT NFT collection: escrowed by Sneedex, and checked by the names canister for NFT avatars.' },
    { id: 'vectors', name: 'RLL splitters', role: 'Neutrinite ICRC-55 vectors', kind: 'external', cluster: 'external', at: [4, 1], icon: 'FaProjectDiagram',
        ids: { ic: '6jvpj-sqaaa-aaaaj-azwnq-cai' }, controllers: 'third',
        about: 'The Neutrinite pylon running the Recursive Liquidity Loop\'s vectors: the ICP splitter that receives product fees and neuron maturity and splits it into SNEED buyback, treasury and the neuron; the SNEED splitter. See /rll_info.' },
    { id: 'blackhole', name: 'Blackhole canister', role: 'immutable controller', kind: 'external', cluster: 'external', at: [5, 1], icon: 'FaCircle',
        ids: { ic: 'e3mmv-5qaaa-aaaah-aadma-cai' }, controllers: 'blackholed',
        about: 'ninegua\'s blackhole: an immutable canister that exposes canister_status. A ledger whose only controller it is can never change, and its cycles stay visible.' },
];

/** The canisters SNS root controls (mainnet). Generated into control edges below. */
const SNS_CONTROLLED = NODES.filter((n) => n.kind === 'dao' && n.controllers === 'sns' && n.id !== 'icrc3_archives').map((n) => n.id);
/** Our canisters that keep an ICRC-3 log, and so create archive canisters. */
const ICRC3_LOGS = NODES.filter((n) => n.kind === 'dao' && n.icrc3).map((n) => n.id);

/**
 * Connections. type: one of EDGE_TYPES. Sources: each canister's main.mo (and Types.mo /
 * shared modules: PremiumClient.mo, sneed_names/*.mo, icrc3/Log.mo), read 2026-10-21.
 */
export const EDGES = [
    // people
    { from: 'people', to: 'app_sneeddao_frontend', type: 'call', label: 'opens Sneed Hub' },
    { from: 'people', to: 'internet_identity', type: 'call', label: 'logs in' },
    { from: 'people', to: 'vectors', type: 'payment', label: 'Premium and Jailbreak fees, paid straight into the ICP splitter' },
    { from: 'agents', to: 'app_sneeddao_frontend', type: 'call', label: 'reads /llms.txt and the API docs, then calls the canisters directly' },
    { from: 'app_sneeddao_frontend', to: 'icpswap', type: 'call', label: 'Swap page: quotes and swaps from your browser' },
    { from: 'app_sneeddao_frontend', to: 'kong', type: 'call', label: 'Swap page: quotes and swaps from your browser' },

    // governance
    { from: 'sns_governance', to: 'sns_root', type: 'call', label: 'executes upgrade proposals' },
    { from: 'sns_governance', to: 'icp_ledger', type: 'payment', label: 'treasury transfers (ICP)' },
    { from: 'sns_governance', to: 'sneed_ledger', type: 'payment', label: 'treasury transfers (SNEED)' },
    { from: 'sneed_index', to: 'sneed_ledger', type: 'call', label: 'indexes blocks' },
    { from: 'sns_governance', to: 'mr_sneed', type: 'call', label: 'sets the personality (generic function proposals)' },
    { from: 'sns_governance', to: 'sneed_guardian', type: 'call', label: 'approves custody operations (generic function proposals)' },
    { from: 'sns_governance', to: 'sneed_pid_names', type: 'call', label: 'verified names by proposal' },
    { from: 'rll', to: 'sns_governance', type: 'call', label: 'reads neurons and voting power' },
    { from: 'rll', to: 'icpswap', type: 'call', label: 'token list for metadata' },
    { from: 'rll', to: 'icrc_ledgers', type: 'payment', label: 'pays out claimed rewards' },
    { from: 'rll', to: 'sneed_ledger', type: 'payment', label: 'pays out claimed SNEED rewards' },
    { from: 'sneed_defi', to: 'vectors', type: 'payment', label: 'ICP to the ICP splitter' },
    { from: 'sneed_defi', to: 'rll', type: 'payment', label: 'tokens for member rewards' },
    { from: 'vectors', to: 'sns_governance', type: 'payment', label: 'treasury share' },
    { from: 'vectors', to: 'sneed_ledger', type: 'payment', label: 'SNEED buyback and burn' },
    { from: 'mr_sneed_operator', to: 'mr_sneed', type: 'relay', label: 'writes memories with its principal' },
    { from: 'mr_sneed_operator', to: 'sneed_sns_forum', type: 'relay', label: 'reads and answers as a member' },

    // money and trading
    { from: 'sneed_lock', to: 'icrc_ledgers', type: 'payment', label: 'holds and returns locked tokens' },
    { from: 'sneed_lock', to: 'icp_ledger', type: 'payment', label: 'lock fees in ICP' },
    { from: 'sneed_lock', to: 'icpswap', type: 'call', label: 'holds LP positions, claims their fees' },
    { from: 'sneed_lock', to: 'sneed_premium', type: 'call', label: 'Premium discount' },
    { from: 'sneedex', to: 'sneed_lock', type: 'call', label: 'escrows and transfers locks' },
    { from: 'sneedex', to: 'sneedapp', type: 'call', label: 'registers bought bots to the buyer' },
    { from: 'sneedex', to: 'app_sneeddao_backend', type: 'call', label: 'adds bought canisters and tokens to the buyer\'s wallet' },
    { from: 'sneedex', to: 'sneed_sms', type: 'notify', label: 'system messages about offers and bids' },
    { from: 'sneedex', to: 'icp_ledger', type: 'payment', label: 'escrow, creation fee' },
    { from: 'sneedex', to: 'icrc_ledgers', type: 'payment', label: 'escrowed tokens and payments' },
    { from: 'sneedex', to: 'vectors', type: 'payment', label: 'marketplace cut in ICP to the ICP splitter' },
    { from: 'sneedex', to: 'other_snses', type: 'call', label: 'escrows SNS neurons (hotkeys and permissions)' },
    { from: 'sneedex', to: 'management', type: 'call', label: 'escrows canisters (controllers)' },
    { from: 'sneedex', to: 'nft_collections', type: 'call', label: 'escrows NFTs' },
    { from: 'sneedex', to: 'sneed_icp_staking_bot', type: 'call', label: 'escrows staking bots' },
    { from: 'sneedex', to: 'sneed_trading_bot', type: 'call', label: 'escrows trading bots' },
    { from: 'sneedex', to: 'sneed_premium', type: 'call', label: 'Premium discount' },
    { from: 'sneed_premium', to: 'icp_ledger', type: 'payment', label: 'membership payments' },
    { from: 'sneed_premium', to: 'sns_governance', type: 'call', label: 'reads staked voting power' },
    { from: 'sneed_pad', to: 'management', type: 'call', label: 'creates canisters, installs ledgers' },
    { from: 'sneed_pad', to: 'cmc', type: 'payment', label: 'buys cycles' },
    { from: 'sneed_pad', to: 'icp_ledger', type: 'payment', label: 'launch payment' },
    { from: 'sneed_pad', to: 'sns_w', type: 'call', label: 'NNS-approved ledger Wasms' },
    { from: 'sneed_pad', to: 'sneed_guardian', type: 'call', label: 'hands a ledger to custody' },
    { from: 'sneed_pad', to: 'sneedapp', type: 'call', label: 'registers the new canisters to you' },
    { from: 'sneed_pad', to: 'sneed_premium', type: 'call', label: 'Premium price' },
    { from: 'sneed_pad', to: 'rll', type: 'payment', label: 'fees (default destination)' },
    { from: 'sneed_pad', to: 'icrc_ledgers', type: 'control', label: 'creates ledgers, then hands control over' },
    { from: 'sneed_pad', to: 'blackhole', type: 'control', label: 'may make it the only controller' },
    { from: 'sneed_guardian', to: 'management', type: 'call', label: 'upgrades its children' },
    { from: 'sneed_guardian', to: 'sns_w', type: 'call', label: 'blessed Wasm hashes, one step at a time' },
    { from: 'sneed_guardian', to: 'icp_ledger', type: 'payment', label: 'fees' },
    { from: 'sneed_guardian', to: 'sneed_premium', type: 'call', label: 'Premium price' },
    { from: 'sneed_guardian', to: 'rll', type: 'payment', label: 'fees (default destination)' },
    { from: 'sneed_guardian', to: 'icrc_ledgers', type: 'control', label: 'controls project ledgers in custody' },

    // apps and bots
    { from: 'sneedapp', to: 'management', type: 'call', label: 'creates and installs bot canisters' },
    { from: 'sneedapp', to: 'cmc', type: 'payment', label: 'turns the mint price into cycles' },
    { from: 'sneedapp', to: 'icp_ledger', type: 'payment', label: 'mint payments' },
    { from: 'sneedapp', to: 'sneed_premium', type: 'call', label: 'Premium price' },
    { from: 'sneedapp', to: 'sneed_icp_staking_bot', type: 'control', label: 'mints it, then control passes to you' },
    { from: 'sneedapp', to: 'sneed_trading_bot', type: 'control', label: 'mints it, then control passes to you' },
    { from: 'sneed_icp_staking_bot', to: 'nns_governance', type: 'call', label: 'manages your ICP neurons' },
    { from: 'sneed_icp_staking_bot', to: 'icp_ledger', type: 'payment', label: 'stakes and disburses ICP' },
    { from: 'sneed_trading_bot', to: 'icpswap', type: 'call', label: 'swaps' },
    { from: 'sneed_trading_bot', to: 'kong', type: 'call', label: 'swaps' },
    { from: 'sneed_trading_bot', to: 'icrc_ledgers', type: 'payment', label: 'moves your tokens' },

    // community
    { from: 'sneed_sns_forum', to: 'sns_w', type: 'call', label: 'checks that an SNS is real' },
    { from: 'sneed_sns_forum', to: 'other_snses', type: 'call', label: 'neurons for votes and polls' },
    { from: 'sneed_sns_forum', to: 'icrc_ledgers', type: 'call', label: 'verifies tips in the ledger' },
    { from: 'sneed_sns_forum', to: 'icp_ledger', type: 'call', label: 'verifies ICP tips' },
    { from: 'sneed_sns_forum', to: 'sneed_premium', type: 'call', label: 'Premium limits' },
    { from: 'sneed_sns_forum', to: 'sneed_notifications', type: 'notify', label: 'replies, mentions and tips' },
    { from: 'sneed_sms', to: 'sneed_premium', type: 'call', label: 'Premium limits' },
    { from: 'sneed_sms', to: 'sneed_notifications', type: 'notify', label: 'new message alerts' },
    { from: 'sneed_notifications', to: 'sneed_sms', type: 'notify', label: 'delivers to your Sneed SMS inbox' },
    { from: 'sneed_notifications', to: 'icp_ledger', type: 'payment', label: 'notification balances in ICP' },
    { from: 'sneed_notifications', to: 'vectors', type: 'payment', label: 'forwards delivery fees to the ICP splitter (being added)' },
    { from: 'relays', to: 'sneed_notifications', type: 'relay', label: 'pulls jobs, delivers by Discord and push, confirms' },
    { from: 'sneed_mon', to: 'sns_w', type: 'call', label: 'checks that an SNS is real' },
    { from: 'sneed_mon', to: 'other_snses', type: 'call', label: 'open proposals, ballots and your neurons' },
    { from: 'sneed_mon', to: 'sneed_notifications', type: 'notify', label: 'votable proposals and reminders' },
    { from: 'sneed_mon', to: 'nns_governance', type: 'call', label: 'NNS proposals and your registered neurons' },
    { from: 'sneed_mon', to: 'icp_ledger', type: 'payment', label: 'monitoring balances in ICP' },

    // identity
    { from: 'sneed_pid_names', to: 'app_sneeddao_backend', type: 'call', label: 'name moderation (ban list, blacklist)' },
    { from: 'sneed_pid_names', to: 'sns_w', type: 'call', label: 'checks that an SNS is real' },
    { from: 'sneed_pid_names', to: 'other_snses', type: 'call', label: 'neuron hotkeys for linking accounts' },
    { from: 'sneed_pid_names', to: 'nft_collections', type: 'call', label: 'checks you own your NFT avatar' },
    { from: 'sneed_neuron_names', to: 'app_sneeddao_backend', type: 'call', label: 'name moderation' },
    { from: 'sneed_neuron_names', to: 'sns_w', type: 'call', label: 'checks that an SNS is real' },
    { from: 'sneed_neuron_names', to: 'other_snses', type: 'call', label: 'who may name a neuron' },
    { from: 'sneed_profiles', to: 'app_sneeddao_backend', type: 'call', label: 'moderation' },
    { from: 'sneed_profiles', to: 'sns_w', type: 'call', label: 'checks that an SNS is real' },
    { from: 'sneed_profiles', to: 'other_snses', type: 'call', label: 'neuron checks' },
    { from: 'sneed_pid_nicknames', to: 'sneed_premium', type: 'call', label: 'Premium limits' },
    { from: 'sneed_neuron_nicknames', to: 'sneed_premium', type: 'call', label: 'Premium limits' },
    { from: 'sneed_avatars', to: 'sneed_premium', type: 'call', label: 'Premium limits' },

    // infrastructure
    { from: 'app_sneeddao_backend', to: 'icpswap', type: 'call', label: 'token list and pool data' },
    { from: 'app_sneeddao_backend', to: 'icrc_ledgers', type: 'call', label: 'token metadata, verifies donations' },
    { from: 'app_sneeddao_backend', to: 'icp_ledger', type: 'call', label: 'verifies Jailbreak payments and donations' },
    { from: 'app_sneeddao_backend', to: 'other_snses', type: 'call', label: 'SNS Jailbreak checks' },
    { from: 'app_sneeddao_backend', to: 'sneed_premium', type: 'call', label: 'Premium price' },
    { from: 'unicycle', to: 'sns_root', type: 'call', label: 'reads cycles of the DAO\'s canisters' },
    { from: 'unicycle', to: 'cmc', type: 'payment', label: 'tops canisters up' },

    // generated: SNS root controls the DAO's canisters; ICRC-3 logs control their archives
    ...SNS_CONTROLLED.map((id) => ({ from: 'sns_root', to: id, type: 'control', label: 'controller: upgrades by proposal' })),
    ...ICRC3_LOGS.map((id) => ({ from: id, to: 'icrc3_archives', type: 'control', label: 'creates, controls and tops up its log archives' })),
];

/**
 * Sneed's services, as people know them from the menu. `canisters` are highlighted together when the
 * service is picked; the first one is its main canister.
 */
export const SERVICES = [
    // governance
    { id: 'dao', name: 'DAO and proposals', cluster: 'governance', route: '/proposals', canisters: ['sns_governance', 'sns_root', 'sneed_ledger', 'sneed_index', 'other_snses'] },
    { id: 'rewards', name: 'Rewards and the loop', cluster: 'governance', route: '/rll', canisters: ['rll', 'sneed_defi', 'vectors', 'sns_governance', 'sneed_ledger', 'icrc_ledgers'] },
    { id: 'revenue', name: 'Revenue', cluster: 'governance', route: '/revenue', canisters: ['vectors', 'sneedex', 'sneed_premium', 'app_sneeddao_backend', 'sneed_defi', 'rll'] },
    { id: 'mr_sneed', name: 'Mr Sneed', cluster: 'governance', route: '/mr-sneed', canisters: ['mr_sneed', 'mr_sneed_operator', 'sns_governance', 'sneed_sns_forum'] },
    { id: 'health', name: 'Health', cluster: 'governance', route: '/health', canisters: ['sns_root', 'sns_governance', 'sneed_ledger', 'unicycle', 'icrc3_archives'] },
    // money and trading
    { id: 'wallet', name: 'Wallet', cluster: 'money', route: '/wallet', canisters: ['app_sneeddao_backend', 'icp_ledger', 'icrc_ledgers', 'icpswap', 'sneed_lock', 'sneedapp', 'other_snses'] },
    { id: 'lock', name: 'Sneed Lock', cluster: 'money', route: '/lock_wizard', canisters: ['sneed_lock', 'icrc_ledgers', 'icpswap', 'icp_ledger', 'sneed_premium'] },
    { id: 'sneedex', name: 'Sneedex', cluster: 'money', route: '/sneedex_offers', canisters: ['sneedex', 'sneed_lock', 'sneedapp', 'app_sneeddao_backend', 'sneed_sms', 'icp_ledger', 'icrc_ledgers', 'other_snses', 'management', 'nft_collections', 'vectors'] },
    { id: 'swap', name: 'Swap', cluster: 'money', route: '/swap', canisters: ['app_sneeddao_frontend', 'icpswap', 'kong'] },
    { id: 'premium', name: 'Premium', cluster: 'money', route: '/premium', canisters: ['sneed_premium', 'icp_ledger', 'sns_governance', 'vectors'] },
    { id: 'studio', name: 'Token Studio', cluster: 'money', route: '/studio', canisters: ['sneed_pad', 'sneed_guardian', 'sns_w', 'cmc', 'management', 'icrc_ledgers', 'blackhole'] },
    { id: 'custody', name: 'Custody', cluster: 'money', route: '/guardian', canisters: ['sneed_guardian', 'sns_governance', 'sns_w', 'icrc_ledgers'] },
    { id: 'jailbreak', name: 'SNS Jailbreak', cluster: 'money', route: '/tools/sns_jailbreak', canisters: ['app_sneeddao_backend', 'other_snses', 'vectors'] },
    { id: 'donations', name: 'Donations', cluster: 'money', route: '/donate', canisters: ['app_sneeddao_backend', 'icp_ledger', 'icrc_ledgers'] },
    // apps and bots
    { id: 'sneedapp', name: 'Sneedapp app store', cluster: 'apps', route: '/sneedapp', canisters: ['sneedapp', 'management', 'cmc', 'icp_ledger', 'sneed_premium', 'sneed_icp_staking_bot', 'sneed_trading_bot'] },
    { id: 'staking_bots', name: 'ICP staking bots', cluster: 'apps', route: '/create_icp_neuron', canisters: ['sneed_icp_staking_bot', 'nns_governance', 'icp_ledger', 'sneedapp'] },
    { id: 'trading_bots', name: 'Trading bots', cluster: 'apps', route: '/help/trading_bot', canisters: ['sneed_trading_bot', 'icpswap', 'kong', 'icrc_ledgers', 'sneedapp'] },
    { id: 'liquid_staking', name: 'Liquid staking', cluster: 'apps', route: '/liquid_staking', canisters: ['sneed_icp_staking_bot', 'other_snses', 'sneedex', 'nns_governance'] },
    // community
    { id: 'forum', name: 'Forum', cluster: 'community', route: '/forum', canisters: ['sneed_sns_forum', 'other_snses', 'sns_w', 'icrc_ledgers', 'icp_ledger', 'sneed_premium', 'sneed_notifications'] },
    { id: 'sms', name: 'Messages (SMS)', cluster: 'community', route: '/sms', canisters: ['sneed_sms', 'sneed_premium', 'sneed_notifications'] },
    { id: 'notifications', name: 'Notifications', cluster: 'community', route: '/notifications', canisters: ['sneed_notifications', 'sneed_sms', 'relays', 'icp_ledger', 'sneed_sns_forum', 'sneed_mon'] },
    { id: 'monitor', name: 'Sneed Monitor', cluster: 'community', route: '/api/sneed_mon', upcoming: true, canisters: ['sneed_mon', 'sneed_notifications', 'sns_w', 'other_snses', 'nns_governance', 'icp_ledger'] },
    // identity
    { id: 'login', name: 'Login', cluster: 'identity', route: '/login', canisters: ['internet_identity', 'people'] },
    { id: 'names', name: 'Names and nicknames', cluster: 'identity', route: '/names', canisters: ['sneed_pid_names', 'sneed_neuron_names', 'sneed_pid_nicknames', 'sneed_neuron_nicknames', 'app_sneeddao_backend', 'sns_w', 'other_snses', 'sneed_premium'] },
    { id: 'profiles', name: 'Profiles and avatars', cluster: 'identity', route: '/me', canisters: ['sneed_profiles', 'sneed_avatars', 'sneed_pid_names', 'nft_collections', 'sneed_premium'] },
    // infrastructure
    { id: 'hub', name: 'Sneed Hub web app', cluster: 'infra', route: '/', canisters: ['app_sneeddao_frontend', 'app_sneeddao_backend', 'people', 'internet_identity'] },
    { id: 'api', name: 'API docs and agents', cluster: 'infra', route: '/api', canisters: ['agents', 'app_sneeddao_frontend'] },
    { id: 'logs', name: 'Activity logs (ICRC-3)', cluster: 'infra', route: '/tools/icrc3', canisters: ['icrc3_archives', ...ICRC3_LOGS] },
    { id: 'cycles', name: 'Cycles', cluster: 'infra', route: '/health', canisters: ['unicycle', 'cmc', 'sns_root'] },
];

/** Grid geometry of the diagram, in pixels. */
export const LAYOUT = { nodeW: 196, nodeH: 60, gapX: 22, gapY: 22, pad: 18, head: 46, clusterGapX: 56, clusterGapY: 56, bandCols: 6 };
