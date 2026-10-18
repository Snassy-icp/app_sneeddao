// /lore: where Sneed DAO and Mr Sneed come from. The name, the two dot letters (SNS-1's and
// Sneed's, both still live on-chain), the five pillars and the road so far.
import React from 'react';
import { Link } from 'react-router-dom';
import { FaExternalLinkAlt, FaArrowRight } from 'react-icons/fa';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';

const SNS1_LETTER = 'https://sqbzf-5aaaa-aaaam-aavya-cai.icp0.io/';
const SNEED_LETTER = 'https://xb24g-dyaaa-aaaag-qcrmq-cai.icp0.io/';
const PILLARS = [['S', 'Security'], ['N', 'Non-inflation'], ['E', 'Eco-friendliness'], ['E', 'Efficiency'], ['D', 'Decentralization']];
const ROAD = [
    ['2022', 'SNS-1 launches: the first SNS, a blank canvas DAO whose only dapp is a dot. Its early community, with a good deal of /biz/ in it, calls SNS-1 tokens "sneeds".'],
    ['June 2023', 'The Dragginz team takes over SNS-1 for their MMO (it later becomes DKP). Early SNS-1 members gather to carry the blank-canvas vision on.'],
    ['2023', 'Mr Sneed signs the Sneed Vision Letter. A pre-SNS SNEED token starts the first liquidity loop by hand: LP fees into an 8-year ICP neuron, its maturity buying back and burning SNEED.'],
    ['Sneed SNS', 'Sneed becomes an SNS DAO, so the loop can be made trustless. The old token still swaps 1:1 at the converter.'],
    ['2024–2025', 'The Recursive Liquidity Loop goes on-chain with Neutrinite DeFi Vectors and NeuronPool: the neuron, buybacks, burns and non-inflationary rewards for voters.'],
    ['2025–2026', 'Sneed Hub grows into home for SNS governance: forums for every SNS, names, messages, Sneed Lock, Sneedex, Sneedapp and the Sneed bots.'],
    ['Now', 'Mr Sneed starts speaking for himself, one step at a time, on the way to a DAO that helps write itself.'],
];

export default function Lore() {
    const { theme } = useTheme();
    const c = theme.colors;
    const card = { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 16, padding: 20, marginBottom: 16 };
    const h2 = { margin: '0 0 10px', fontSize: 22, color: c.primaryText };
    const p = { margin: '0 0 12px', color: c.secondaryText, lineHeight: 1.7, fontSize: 15 };
    const quote = { margin: '12px 0', padding: '10px 16px', borderLeft: `3px solid ${c.accent}`, color: c.primaryText, fontStyle: 'italic', lineHeight: 1.7 };
    const dot = (bg) => ({ width: 120, height: 84, borderRadius: 12, background: bg, border: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 });

    return (
        <>
            <Header />
            <div style={{ maxWidth: 860, margin: '0 auto', padding: '1.5rem 16px 3rem' }}>
                <h1 style={{ margin: '0 0 6px', color: c.primaryText }}>The lore</h1>
                <p style={{ ...p, marginBottom: 20 }}>Where Sneed DAO and Mr Sneed come from. We are all Mr Sneed.</p>

                <section style={card}>
                    <h2 style={h2}>The name</h2>
                    <p style={p}>
                        On 4chan's /biz/ board, "cope and seethe" was the standard reply to anyone overreacting, and the Simpsons' "Sneed's Feed and Seed (formerly Chuck's)"
                        was a meme of its own. The two met as "cope and sneed", which soon shrank to a one-word reply: "sneed".
                    </p>
                    <p style={p}>
                        When SNS-1 launched, its early community overlapped with /biz/, and SNS-1 tokens became "sneeds". So when a group of SNS-1 members started a new DAO to
                        carry on SNS-1's blank-canvas mission, the name was already there: Sneed DAO. And with it, Mr Sneed: the face, the symbol and the spirit of the DAO.
                    </p>
                </section>

                <section style={card}>
                    <h2 style={h2}>The dot</h2>
                    <p style={p}>
                        SNS-1 launched with a single dapp: a dark page with a white dot. Click the dot and it grows until it fills the screen, and a letter appears, opening with Laozi:
                    </p>
                    <div style={quote}>The Dao that can be told is not the eternal Dao. The name that can be named is not the eternal name.</div>
                    <p style={p}>
                        When Sneed DAO launched, the creator of SNS-1's dot page gave us its code, an unofficial blessing. Our dot is its inverse: a black dot on a light page, and behind it
                        the Sneed Vision Letter, signed by Mr Sneed:
                    </p>
                    <div style={quote}>The Dao is like an empty vessel which, in spite of being used, is never filled.</div>
                    <p style={p}>Both are still live on the Internet Computer. Click the dot a few times until it fills the screen.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                        {[[SNS1_LETTER, 'The SNS-1 letter', 'DFINITY, 2022', '#181818', '#ffffff'], [SNEED_LETTER, 'The Sneed Vision Letter', 'Mr Sneed, 2023', '#efefef', '#000000']].map(([href, title, by, bg, fg]) => (
                            <a key={href} href={href} target="_blank" rel="noopener noreferrer"
                                style={{ display: 'flex', gap: 14, alignItems: 'center', padding: 12, borderRadius: 14, border: `1px solid ${c.border}`, background: c.secondaryBg, textDecoration: 'none' }}>
                                <span style={dot(bg, fg)}><span style={{ width: 12, height: 12, borderRadius: '50%', background: fg }} /></span>
                                <span>
                                    <span style={{ display: 'block', color: c.primaryText, fontWeight: 700 }}>{title} <FaExternalLinkAlt size={10} /></span>
                                    <span style={{ display: 'block', color: c.mutedText, fontSize: 13 }}>{by}</span>
                                </span>
                            </a>
                        ))}
                    </div>
                </section>

                <section style={card}>
                    <h2 style={h2}>Five pillars</h2>
                    <p style={p}>The Vision Letter rests SNEED on five pillars, and they spell its name:</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {PILLARS.map(([l, w], i) => (
                            <div key={i} style={{ flex: '1 1 140px', padding: '10px 12px', borderRadius: 12, background: c.secondaryBg, border: `1px solid ${c.border}` }}>
                                <span style={{ fontSize: 26, fontWeight: 800, color: c.accent }}>{l}</span>
                                <span style={{ color: c.primaryText }}>{w.slice(1)}</span>
                            </div>
                        ))}
                    </div>
                    <p style={{ ...p, marginTop: 12 }}>
                        Non-inflation is still the rule: SNEED started at 10,000 tokens and there will only ever be fewer. Rewards for voters come from real revenue through the{' '}
                        <Link to="/rll_info" style={{ color: c.accent }}>Recursive Liquidity Loop</Link>, never from minting.
                    </p>
                </section>

                <section style={card}>
                    <h2 style={h2}>The road so far</h2>
                    <div style={{ display: 'grid', gap: 10 }}>
                        {ROAD.map(([when, what]) => (
                            <div key={when} style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                <span style={{ flex: '0 0 96px', color: c.accent, fontWeight: 700 }}>{when}</span>
                                <span style={{ flex: '1 1 300px', color: c.secondaryText, lineHeight: 1.6 }}>{what}</span>
                            </div>
                        ))}
                    </div>
                </section>

                <section style={card}>
                    <h2 style={h2}>Join us</h2>
                    <p style={p}>Like SNS-1, Sneed is a blank canvas: build or suggest pretty much anything. Come say hi (and if it's over, we'll tell you).</p>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {[['Discord', 'https://discord.gg/4bzUtDc5q8'], ['X: @icsneed', 'https://x.com/icsneed']].map(([label, href]) => (
                            <a key={href} href={href} target="_blank" rel="noopener noreferrer" style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${c.border}`, color: c.primaryText, textDecoration: 'none', fontWeight: 600 }}>{label} <FaExternalLinkAlt size={10} /></a>
                        ))}
                        <Link to="/forum" style={{ padding: '9px 16px', borderRadius: 999, border: `1px solid ${c.border}`, color: c.primaryText, textDecoration: 'none', fontWeight: 600 }}>The Sneed forum</Link>
                    </div>
                </section>

                <section style={{ ...card, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <img src="/mr-sneed-face.png" alt="Mr Sneed" width={72} height={72} style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: '50%', background: '#f4f1ea', border: `3px solid ${c.accent}`, padding: 4, boxSizing: 'border-box' }} />
                    <div style={{ flex: '1 1 300px' }}>
                        <h2 style={{ ...h2, marginBottom: 4 }}>Mr Sneed today</h2>
                        <p style={{ ...p, margin: 0 }}>The DAO's mascot now has a voice of his own, set by DAO vote, with every memory on-chain.</p>
                    </div>
                    <Link to="/mr-sneed" style={{ padding: '10px 18px', borderRadius: 999, background: c.accent, color: '#fff', textDecoration: 'none', fontWeight: 600 }}>Meet him <FaArrowRight size={11} /></Link>
                </section>
            </div>
        </>
    );
}
