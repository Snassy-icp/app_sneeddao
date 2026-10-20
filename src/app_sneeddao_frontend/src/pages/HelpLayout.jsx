// Shared building blocks for the /help/* pages: hero banner, section cards, tip/warning boxes.
// Same look as HelpWallet.jsx / HelpSneedlock.jsx, so new help pages stay short and consistent.
import React from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { FaArrowLeft, FaLightbulb, FaExclamationTriangle, FaInfoCircle } from 'react-icons/fa';

const HelpCtx = React.createContext({ color: '#06b6d4' });

const animations = `
@keyframes helpPageFadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
@keyframes helpPageFloat { 0%, 100% { transform: translateY(0px) rotate(0deg); } 50% { transform: translateY(-10px) rotate(3deg); } }
.help-page-fade-in { animation: helpPageFadeInUp 0.5s ease-out forwards; }
.help-page-float { animation: helpPageFloat 4s ease-in-out infinite; }
.help-page-section code { overflow-wrap: anywhere; }
`;

function useHelp() {
    const { theme } = useTheme();
    const { color } = React.useContext(HelpCtx);
    return { c: theme.colors, theme, color };
}

/** Whole page: header, hero banner, back link, then children (Sections). */
export function HelpPage({ icon: Icon, badgeIcon: BadgeIcon, badge, title, subtitle, color = '#06b6d4', secondary, children }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const second = secondary || color;
    return (
        <HelpCtx.Provider value={{ color }}>
            <div className='page-container' style={{ background: c.primaryGradient, minHeight: '100vh' }}>
                <style>{animations}</style>
                <Header />
                <div style={{
                    background: `linear-gradient(135deg, ${color}15 0%, ${second}10 50%, transparent 100%)`,
                    borderBottom: `1px solid ${c.border}`,
                    padding: '3rem 16px 2.5rem',
                    position: 'relative', overflow: 'hidden', width: '100%', boxSizing: 'border-box',
                }}>
                    <div style={{ position: 'absolute', top: '-50%', right: '-10%', width: 400, height: 400, background: `radial-gradient(circle, ${color}20 0%, transparent 70%)`, pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', bottom: '-30%', left: '-5%', width: 300, height: 300, background: `radial-gradient(circle, ${second}15 0%, transparent 70%)`, pointerEvents: 'none' }} />
                    <div style={{ maxWidth: 900, margin: '0 auto', position: 'relative', zIndex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
                            <div className="help-page-float" style={{
                                width: 72, height: 72, borderRadius: 20,
                                background: `linear-gradient(135deg, ${color}, ${second})`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: `0 12px 40px ${color}50`, flexShrink: 0,
                            }}>
                                {Icon && <Icon size={36} color="#fff" />}
                            </div>
                            <div style={{ flex: 1, minWidth: 200 }}>
                                {badge && (
                                    <div style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                        background: `${color}20`, border: `1px solid ${color}40`,
                                        borderRadius: 20, padding: '4px 12px', marginBottom: 8,
                                    }}>
                                        {BadgeIcon && <BadgeIcon size={12} color={color} />}
                                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color }}>{badge}</span>
                                    </div>
                                )}
                                <h1 style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)', fontWeight: 800, color: c.primaryText, margin: 0 }}>{title}</h1>
                            </div>
                        </div>
                        {subtitle && <p style={{ fontSize: '1rem', color: c.secondaryText, margin: 0, maxWidth: 640, lineHeight: 1.6 }}>{subtitle}</p>}
                    </div>
                </div>
                <main style={{ maxWidth: 900, margin: '0 auto', padding: '1.25rem 16px 3rem', color: c.primaryText, boxSizing: 'border-box' }}>
                    <Link to="/help" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: c.accent, textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500, marginBottom: '1.5rem' }}>
                        <FaArrowLeft size={14} /> Back to Help Center
                    </Link>
                    {children}
                </main>
            </div>
        </HelpCtx.Provider>
    );
}

/** A card with an icon and heading. `id` makes it linkable (#id). */
export function Section({ icon: Icon, title, color, id, children }) {
    const { c, color: pageColor } = useHelp();
    const col = color || pageColor;
    return (
        <section id={id} className="help-page-fade-in help-page-section" style={{
            background: c.cardGradient, border: `1px solid ${c.border}`, borderRadius: 16,
            padding: '1.25rem', marginBottom: '1rem', boxShadow: c.cardShadow, scrollMarginTop: 80,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
                {Icon && (
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: `linear-gradient(135deg, ${col}20, ${col}10)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon size={20} color={col} />
                    </div>
                )}
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: c.primaryText, margin: 0 }}>{title}</h2>
            </div>
            {children}
        </section>
    );
}

export function Sub({ children }) {
    const { c } = useHelp();
    return <h3 style={{ fontSize: '1rem', fontWeight: 600, color: c.primaryText, margin: '1rem 0 0.5rem' }}>{children}</h3>;
}

export function P({ children, style }) {
    const { c } = useHelp();
    return <p style={{ margin: '0 0 0.75rem', lineHeight: 1.7, color: c.secondaryText, fontSize: '0.9rem', ...style }}>{children}</p>;
}

export function List({ children, ordered }) {
    const { c } = useHelp();
    const Tag = ordered ? 'ol' : 'ul';
    return <Tag style={{ margin: '0 0 0.75rem', paddingLeft: '1.5rem', color: c.secondaryText, fontSize: '0.9rem', lineHeight: 1.65 }}>{children}</Tag>;
}

/** Numbered how-to steps. */
export function Steps({ children }) {
    return <List ordered>{children}</List>;
}

export function Li({ children }) {
    return <li style={{ marginBottom: '0.45rem' }}>{children}</li>;
}

export function B({ children }) {
    const { c } = useHelp();
    return <strong style={{ color: c.primaryText, fontWeight: 600 }}>{children}</strong>;
}

export function Code({ children }) {
    const { c } = useHelp();
    return <code style={{ background: c.secondaryBg, padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.85em', color: c.accent }}>{children}</code>;
}

/** In-app link (react-router). */
export function L({ to, children }) {
    const { c } = useHelp();
    return <Link to={to} style={{ color: c.accent, textDecoration: 'none', fontWeight: 500 }}>{children}</Link>;
}

function Box({ kind, title, children }) {
    const { c, color } = useHelp();
    const col = kind === 'warning' ? '#f59e0b' : kind === 'tip' ? color : c.accent;
    const Icon = kind === 'warning' ? FaExclamationTriangle : kind === 'tip' ? FaLightbulb : FaInfoCircle;
    return (
        <div style={{ background: `linear-gradient(135deg, ${col}15, ${col}08)`, border: `1px solid ${col}40`, borderRadius: 12, padding: '0.9rem 1rem', margin: '0.25rem 0 0.9rem' }}>
            {title && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: c.primaryText, fontSize: '0.92rem', marginBottom: 6 }}>
                    <Icon size={14} color={col} /> {title}
                </div>
            )}
            <div style={{ color: c.secondaryText, fontSize: '0.88rem', lineHeight: 1.65 }}>{children}</div>
        </div>
    );
}

export const Tip = (props) => <Box kind="tip" {...props} />;
export const Warning = (props) => <Box kind="warning" {...props} />;
export const Info = (props) => <Box kind="info" {...props} />;

/** "Related topics" card: links = [{ to, label, text }]. */
export function Related({ links }) {
    return (
        <Section icon={FaArrowLeft} title="Related help topics">
            <List>
                {links.map((l) => (
                    <Li key={l.to}><L to={l.to}>{l.label}</L>{l.text ? <> — {l.text}</> : null}</Li>
                ))}
                <Li><L to="/help">Help Center</L> — browse all help topics</Li>
            </List>
        </Section>
    );
}
