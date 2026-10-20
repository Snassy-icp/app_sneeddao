import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import {
    FaCode, FaLock, FaArrowRight, FaFileCode, FaRobot, FaGithub, FaBookOpen, FaExchangeAlt, FaComments,
    FaEnvelope, FaIdBadge, FaBell, FaCrown, FaCoins, FaStore, FaBrain, FaServer,
} from 'react-icons/fa';

// Page accent colors - violet theme for developer material
const apiPrimary = '#8b5cf6';
const apiSecondary = '#a78bfa';

const customAnimations = `
@keyframes apiFadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}
.api-fade-in { animation: apiFadeInUp 0.5s ease-out forwards; }
.api-topic-card { transition: all 0.3s ease; }
.api-topic-card:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2); }
`;

export const apiDocs = [
    {
        slug: 'sneed_lock',
        icon: FaLock,
        title: 'Sneed Lock canister',
        canisterId: 'pqsms-lqaaa-aaaal-ajjza-cai',
        description: 'Time-lock ICRC-1 tokens and ICPSwap liquidity positions, claim fees from locked positions, add liquidity, liquid locking, fees and payment. Every method, every error, with JavaScript examples.',
        color: '#f59e0b',
    },
    {
        slug: 'sneedex',
        icon: FaExchangeAlt,
        title: 'Sneedex marketplace',
        canisterId: '7bvk3-ryaaa-aaaal-qtykq-cai',
        description: 'Escrow marketplace for canisters, SNS neurons, ICRC-1 tokens, ICRC-7 NFTs and Sneed Lock locks: create offers, escrow each asset type, bid, buy out, accept, expire, claim and refund, plus the creation fee and marketplace cut. Every method, every error, with JavaScript examples.',
        color: '#10b981',
    },
    {
        slug: 'sneed_sns_forum',
        icon: FaComments,
        title: 'Forum canister',
        canisterId: 'mcigm-4aaaa-aaaad-qhlkq-cai',
        description: 'One forum per SNS: topics, threads, posts and replies, votes and polls weighted by the caller\'s SNS neurons, tips, @-mentions, read state and proposal discussion threads. Every method, every error, with JavaScript examples.',
        color: '#3b82f6',
    },
    {
        slug: 'sneed_sms',
        icon: FaEnvelope,
        title: 'Sneed SMS',
        canisterId: 'zelpl-7yaaa-aaaad-abtcq-cai',
        description: 'Direct messages between principals: send with a subject, body and replies, read your inbox and sent items, unread counts, leave a message, system messages from authorised canisters. Spells out who can read what: messages are not encrypted.',
        color: '#06b6d4',
    },
    {
        slug: 'sneed_names',
        icon: FaIdBadge,
        title: 'Naming service',
        canisterId: 'ejz7n-lyaaa-aaaad-qmkzq-cai',
        description: 'Six canisters, one document: a public name, checkmark and avatar per account (linked principals, hotkeys, merges), canister and SNS neuron names, nicknames, ICRC-7 NFT avatars, the dapp registry and avatar image storage. Batched lookups, search, a changes feed and ICRC-3 logs.',
        color: '#ec4899',
    },
    {
        slug: 'sneed_notifications',
        icon: FaBell,
        title: 'Sneed Notifications',
        canisterId: 'vuy7a-iaaaa-aaaay-aaduq-cai',
        description: 'Let a dapp notify its users with their consent: register an app with topics, request permission, notify and track receipts. Users choose channels, levels, quiet hours and caps and pay per delivery from an ICP balance unless the app sponsors the message. Relays pull jobs and acknowledge them.',
        color: '#f97316',
    },
    {
        slug: 'sneed_premium',
        icon: FaCrown,
        title: 'Sneed Premium',
        canisterId: '7gump-4aaaa-aaaal-qtyka-cai',
        description: 'Sneed DAO\'s membership registry: check any principal\'s premium status for gating or discounts, buy membership with ICP through a per-user deposit account, or claim it with staked SNEED voting power or a promo code. Includes the Motoko PremiumClient cache.',
        color: '#eab308',
    },
    {
        slug: 'rll',
        icon: FaCoins,
        title: 'Rewards distribution (RLL)',
        canisterId: 'lvc4n-7aaaa-aaaam-adm6a-cai',
        description: 'The Recursive Liquidity Loop rewards canister: tokens sent to it are shared out daily to Sneed neuron owners in proportion to the voting power they cast on proposals, and owners or their hotkeys claim to their wallet. Distribution cycle, claims, balances and history.',
        color: '#22c55e',
    },
    {
        slug: 'sneedapp',
        icon: FaStore,
        title: 'Sneedapp factory',
        canisterId: 'sfamc-kyaaa-aaaau-adnpq-cai',
        description: 'Sneed DAO\'s app factory: browse apps and their versions, pay a mint fee in ICP and mint your own bot canister (staking bot, trading bot) with you as its only controller. Also the wallet bookmark list, the public mint log and how publishers list apps.',
        color: '#6366f1',
    },
    {
        slug: 'mr_sneed',
        icon: FaBrain,
        title: 'Mr Sneed canister',
        canisterId: 'ucthl-5qaaa-aaaay-aadrq-cai',
        description: 'The prompt (a fixed frame plus the personality the DAO sets) and the public memories of Mr Sneed, the DAO\'s mascot and spirit, with their ICRC-3 log. Read-only for integrators.',
        color: '#a855f7',
    },
    {
        slug: 'app_sneeddao_backend',
        icon: FaServer,
        title: 'Sneed Hub backend',
        canisterId: 'g7s5u-tqaaa-aaaad-qhktq-cai',
        description: 'The token whitelist and metadata cache, user settings and wallet registry, canister folders, partners and projects, donations and SNS Jailbreak configurations.',
        color: '#64748b',
    },
    // The naming canisters each have a short page pointing into the Sneed Names doc, so links such as
    // the block_types_url the canisters publish (/api/sneed_pid_names#block-types) resolve. Not listed as cards.
    ...[
        ['sneed_pid_names', 'ejz7n-lyaaa-aaaad-qmkzq-cai'],
        ['sneed_neuron_names', 'e46oa-kqaaa-aaaad-qmk2a-cai'],
        ['sneed_pid_nicknames', 'e37iu-hiaaa-aaaad-qmk2q-cai'],
        ['sneed_neuron_nicknames', 'es4di-raaaa-aaaad-qmk3a-cai'],
        ['sneed_profiles', 'fytbs-tqaaa-aaaad-qmk4a-cai'],
        ['sneed_avatars', 'ev5f4-4yaaa-aaaad-qmk3q-cai'],
    ].map(([slug, canisterId]) => ({
        slug, canisterId, icon: FaIdBadge, title: slug, color: '#ec4899', hidden: true,
        description: 'Part of the naming service; see the Sneed Names document.',
    })),
];

const listedDocs = apiDocs.filter((d) => !d.hidden);

const machineReadable = [
    {
        icon: FaFileCode,
        title: 'Raw Markdown and Candid',
        description: 'Each document is published as plain Markdown next to the canister\'s Candid file and a ready JavaScript IDL factory, at /api-docs/<canister>.md, .did and .did.js (the naming service has one pair per canister). Fetch them from scripts, paste them into an LLM, or diff them.',
        links: listedDocs.map((d) => ({ label: `${d.slug}.md`, href: `/api-docs/${d.slug}.md` })),
    },
    {
        icon: FaRobot,
        title: 'Agent skills',
        description: 'Coding agents can discover and load a compact integration guide through the Agent Skills discovery index. Point your agent at the index or the skill file directly.',
        links: [
            { label: '/.well-known/agent-skills/index.json', href: '/.well-known/agent-skills/index.json' },
            { label: 'sneed-lock/SKILL.md', href: '/.well-known/agent-skills/sneed-lock/SKILL.md' },
            { label: '/llms.txt', href: '/llms.txt' },
        ],
    },
    {
        icon: FaGithub,
        title: 'Source code',
        description: 'Canisters are written in Motoko and the reference frontend in React. Both live in one public repository; the docs link straight into it.',
        links: [
            { label: 'Snassy-icp/app_sneeddao', href: 'https://github.com/Snassy-icp/app_sneeddao' },
            { label: 'src/sneed_lock/main.mo', href: 'https://github.com/Snassy-icp/app_sneeddao/blob/main/src/sneed_lock/main.mo' },
        ],
    },
];

const getStyles = (theme) => ({
    container: { maxWidth: '1000px', margin: '0 auto', padding: '1.25rem', color: theme.colors.primaryText },
    intro: {
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '16px',
        padding: '1.5rem',
        marginBottom: '1.5rem',
        boxShadow: theme.colors.cardShadow,
    },
    paragraph: { color: theme.colors.secondaryText, fontSize: '1rem', lineHeight: 1.7, margin: 0 },
    sectionTitle: { fontSize: '1.2rem', fontWeight: 700, color: theme.colors.primaryText, margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '10px' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginBottom: '1.5rem' },
    card: {
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '16px',
        padding: '1.5rem',
        boxShadow: theme.colors.cardShadow,
        textDecoration: 'none',
        position: 'relative',
        overflow: 'hidden',
        display: 'block',
        color: theme.colors.primaryText,
    },
    cardHeader: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '12px' },
    cardIcon: (color) => ({
        width: '48px', height: '48px', borderRadius: '14px', flexShrink: 0,
        background: `linear-gradient(135deg, ${color}, ${color}cc)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 6px 20px ${color}40`,
    }),
    cardTitle: { fontSize: '1.1rem', fontWeight: 700, margin: 0, flex: 1, color: theme.colors.primaryText },
    cardDescription: { color: theme.colors.secondaryText, fontSize: '0.9rem', lineHeight: 1.5, margin: '0 0 12px 0' },
    cardMeta: { color: theme.colors.mutedText, fontSize: '0.8rem', fontFamily: 'monospace', marginBottom: '12px' },
    cardArrow: (color) => ({ display: 'flex', alignItems: 'center', gap: '6px', color, fontSize: '0.85rem', fontWeight: 600 }),
    linkList: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
    pill: {
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '4px 10px', borderRadius: '8px', fontSize: '0.8rem', fontFamily: 'monospace',
        background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`,
        color: theme.colors.primaryText, textDecoration: 'none',
    },
});

function Api() {
    const { theme } = useTheme();
    const styles = getStyles(theme);

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customAnimations}</style>
            <Header />

            <div style={{
                background: `linear-gradient(135deg, ${apiPrimary}15 0%, ${apiSecondary}10 50%, transparent 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '3rem 1.25rem 2.5rem',
                position: 'relative', overflow: 'hidden', width: '100%', boxSizing: 'border-box'
            }}>
                <div style={{ position: 'absolute', top: '-50%', right: '-10%', width: '400px', height: '400px', background: `radial-gradient(circle, ${apiPrimary}20 0%, transparent 70%)`, pointerEvents: 'none' }} />
                <div style={{ maxWidth: '1000px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <div style={{
                            width: '72px', height: '72px', borderRadius: '20px',
                            background: `linear-gradient(135deg, ${apiPrimary}, ${apiSecondary})`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: `0 12px 40px ${apiPrimary}50`,
                        }}>
                            <FaCode size={36} color="#fff" />
                        </div>
                        <div style={{ flex: 1, minWidth: '200px' }}>
                            <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                background: `${apiPrimary}20`, border: `1px solid ${apiPrimary}40`,
                                borderRadius: '20px', padding: '4px 12px', fontSize: '0.8rem', fontWeight: 600,
                                color: apiPrimary, marginBottom: '8px'
                            }}>
                                <FaBookOpen size={12} /> For integrators
                            </div>
                            <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: 0, color: theme.colors.primaryText, letterSpacing: '-0.5px' }}>
                                Sneed DAO canister APIs
                            </h1>
                        </div>
                    </div>
                    <p style={{ ...styles.paragraph, maxWidth: '760px' }}>
                        Documentation of the public interfaces of Sneed DAO's canisters, written for developers who want to
                        build on them and detailed enough for an AI agent to work from directly.
                    </p>
                </div>
            </div>

            <main style={styles.container}>
                <div className="api-fade-in" style={styles.intro}>
                    <p style={styles.paragraph}>
                        <strong style={{ color: theme.colors.primaryText }}>Integration is permissionless.</strong> Sneed DAO's canisters
                        authorise calls by the calling principal only. Any wallet, DEX, dashboard or script can call them for its own users,
                        on the same terms as the Sneed app itself, and nobody has to ask first. Each document below explains the model,
                        walks through the flows with code, and then lists every method with its errors and types.
                    </p>
                </div>

                <h2 style={styles.sectionTitle}><FaBookOpen style={{ color: apiPrimary }} /> Documents</h2>
                <div style={styles.grid}>
                    {listedDocs.map((doc) => {
                        const Icon = doc.icon;
                        return (
                            <Link key={doc.slug} to={`/api/${doc.slug}`} className="api-topic-card api-fade-in" style={styles.card}>
                                <div style={styles.cardHeader}>
                                    <div style={styles.cardIcon(doc.color)}><Icon size={22} color="#fff" /></div>
                                    <h3 style={styles.cardTitle}>{doc.title}</h3>
                                </div>
                                <div style={styles.cardMeta}>{doc.canisterId}</div>
                                <p style={styles.cardDescription}>{doc.description}</p>
                                <div style={styles.cardArrow(doc.color)}>Read the API doc <FaArrowRight size={12} /></div>
                            </Link>
                        );
                    })}
                </div>

                <h2 style={styles.sectionTitle}><FaRobot style={{ color: apiPrimary }} /> Machine-readable</h2>
                <div style={styles.grid}>
                    {machineReadable.map((item) => {
                        const Icon = item.icon;
                        return (
                            <div key={item.title} className="api-fade-in" style={styles.card}>
                                <div style={styles.cardHeader}>
                                    <div style={styles.cardIcon(apiPrimary)}><Icon size={22} color="#fff" /></div>
                                    <h3 style={styles.cardTitle}>{item.title}</h3>
                                </div>
                                <p style={styles.cardDescription}>{item.description}</p>
                                <div style={styles.linkList}>
                                    {item.links.map((l) => (
                                        <a key={l.href} href={l.href} target={l.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" style={styles.pill}>
                                            {l.label}
                                        </a>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </main>
        </div>
    );
}

export default Api;
