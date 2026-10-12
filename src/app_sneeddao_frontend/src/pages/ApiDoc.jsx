import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { FaArrowLeft, FaFileAlt, FaFileCode, FaRobot, FaSpinner, FaCopy, FaCheck, FaListUl } from 'react-icons/fa';
import { apiDocs } from './Api';

const apiPrimary = '#8b5cf6';

// Stable, URL-safe ids for headings so the table of contents and deep links work
const slugify = (text) => text
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

const headingText = (children) => React.Children.toArray(children).map((c) => {
    if (typeof c === 'string') return c;
    if (c?.props?.children) return headingText(c.props.children);
    return '';
}).join('');

function CopyButton({ text, theme }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={async () => {
                try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) { /* ignore */ }
            }}
            title="Copy"
            style={{
                position: 'absolute', top: 8, right: 8, border: 'none', cursor: 'pointer', borderRadius: 6,
                padding: '4px 8px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: 4,
                background: copied ? theme.colors.success : `${theme.colors.border}`, color: copied ? '#fff' : theme.colors.primaryText,
            }}
        >
            {copied ? <FaCheck size={10} /> : <FaCopy size={10} />} {copied ? 'Copied' : 'Copy'}
        </button>
    );
}

function ApiDoc() {
    const { slug } = useParams();
    const { pathname } = useLocation();
    const { theme, isDark } = useTheme();
    const doc = apiDocs.find((d) => d.slug === slug);
    const [markdown, setMarkdown] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        fetch(`/api-docs/${slug}.md`, { cache: 'no-cache' })
            .then(async (r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.text();
            })
            .then((text) => { if (!cancelled) setMarkdown(text); })
            .catch((e) => { if (!cancelled) setError(`Could not load this document (${e.message}).`); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [slug]);

    // Table of contents from ## and ### headings (skip fenced code)
    const toc = useMemo(() => {
        const items = [];
        let inFence = false;
        for (const line of markdown.split('\n')) {
            if (line.startsWith('```')) { inFence = !inFence; continue; }
            if (inFence) continue;
            const m = line.match(/^(##|###)\s+(.+)$/);
            if (m) items.push({ level: m[1].length, text: m[2].replace(/[`*]/g, ''), id: slugify(m[2]) });
        }
        return items;
    }, [markdown]);

    // A heading by id, or by its unnumbered name ("block-types" finds
    // "83-block-types") so links from outside survive renumbering.
    const findHeading = (id) => document.getElementById(id)
        || document.querySelector(`article h2[id$="-${CSS.escape(id)}"], article h3[id$="-${CSS.escape(id)}"]`);

    // Scroll to the hash once the content is in
    useEffect(() => {
        if (!loading && window.location.hash) {
            const el = findHeading(decodeURIComponent(window.location.hash.slice(1)));
            if (el) el.scrollIntoView();
        }
    }, [loading]);

    // index.html has <base href="/">, so a bare "#id" href would navigate to
    // the home page. In-page links carry the full path and scroll themselves.
    const hashHref = (id) => `${pathname}#${id}`;
    const jumpTo = (event, id) => {
        const el = findHeading(id);
        if (!el) return; // let the browser handle it
        event.preventDefault();
        el.scrollIntoView();
        window.history.pushState(null, '', hashHref(id));
    };
    // keep headings clear of the sticky header when scrolled to
    const headingScroll = { scrollMarginTop: 80 };

    const codeBg = isDark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.05)';
    const text = theme.colors.primaryText;

    const components = {
        h1: ({ children }) => <h1 id={slugify(headingText(children))} style={{ ...headingScroll, fontSize: '2rem', fontWeight: 800, margin: '0 0 1rem 0', letterSpacing: '-0.5px', color: text }}>{children}</h1>,
        h2: ({ children }) => <h2 id={slugify(headingText(children))} style={{ ...headingScroll, fontSize: '1.5rem', fontWeight: 700, margin: '2.5rem 0 1rem 0', paddingBottom: '0.4rem', borderBottom: `1px solid ${theme.colors.border}`, color: text }}>{children}</h2>,
        h3: ({ children }) => <h3 id={slugify(headingText(children))} style={{ ...headingScroll, fontSize: '1.15rem', fontWeight: 700, margin: '1.75rem 0 0.6rem 0', color: text }}>{children}</h3>,
        h4: ({ children }) => <h4 style={{ fontSize: '1rem', fontWeight: 700, margin: '1.25rem 0 0.5rem 0', color: text }}>{children}</h4>,
        p: ({ children }) => <p style={{ lineHeight: 1.7, margin: '0 0 0.9rem 0', color: theme.colors.secondaryText }}>{children}</p>,
        li: ({ children }) => <li style={{ lineHeight: 1.65, marginBottom: '0.3rem', color: theme.colors.secondaryText }}>{children}</li>,
        strong: ({ children }) => <strong style={{ color: text, fontWeight: 700 }}>{children}</strong>,
        a: ({ href, children }) => {
            const external = /^https?:\/\//.test(href || '');
            const style = { color: apiPrimary, textDecoration: 'underline', textDecorationColor: `${apiPrimary}60` };
            if (!external && href && href.startsWith('/api/')) return <Link to={href} style={style}>{children}</Link>;
            if (href && href.startsWith('#')) {
                const id = decodeURIComponent(href.slice(1));
                return <a href={hashHref(id)} onClick={(e) => jumpTo(e, id)} style={style}>{children}</a>;
            }
            return <a href={href} style={style} target={external ? '_blank' : undefined} rel="noopener noreferrer">{children}</a>;
        },
        hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${theme.colors.border}`, margin: '2rem 0' }} />,
        blockquote: ({ children }) => <blockquote style={{ margin: '0 0 1rem 0', padding: '0.5rem 1rem', borderLeft: `3px solid ${apiPrimary}`, background: `${apiPrimary}10`, borderRadius: 6 }}>{children}</blockquote>,
        table: ({ children }) => (
            <div style={{ overflowX: 'auto', marginBottom: '1rem', border: `1px solid ${theme.colors.border}`, borderRadius: 10 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.9rem' }}>{children}</table>
            </div>
        ),
        th: ({ children }) => <th style={{ textAlign: 'left', padding: '8px 12px', background: theme.colors.secondaryBg, borderBottom: `1px solid ${theme.colors.border}`, color: text, fontWeight: 600 }}>{children}</th>,
        td: ({ children }) => <td style={{ padding: '8px 12px', borderBottom: `1px solid ${theme.colors.border}`, verticalAlign: 'top', color: theme.colors.secondaryText, lineHeight: 1.55 }}>{children}</td>,
        code: ({ className, children }) => {
            const raw = String(children).replace(/\n$/, '');
            const isBlock = /language-/.test(className || '') || raw.includes('\n');
            if (!isBlock) {
                return <code style={{ background: codeBg, padding: '2px 6px', borderRadius: 4, fontSize: '0.85em', color: text, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>{children}</code>;
            }
            return (
                <div style={{ position: 'relative', marginBottom: '1rem' }}>
                    <pre style={{ margin: 0, padding: '14px 16px', background: codeBg, border: `1px solid ${theme.colors.border}`, borderRadius: 10, overflowX: 'auto', fontSize: '0.82rem', lineHeight: 1.55 }}>
                        <code style={{ color: text, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>{raw}</code>
                    </pre>
                    <CopyButton text={raw} theme={theme} />
                </div>
            );
        },
        pre: ({ children }) => <>{children}</>,
    };

    const pill = (href, icon, label) => (
        <a key={href} href={href} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, fontSize: '0.8rem',
            background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`, color: text, textDecoration: 'none',
        }}>
            {icon} {label}
        </a>
    );

    return (
        <div className='page-container' style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <Header />
            <main style={{ maxWidth: '1180px', margin: '0 auto', padding: '1.25rem', color: text }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: '1rem' }}>
                    <Link to="/api" style={{ color: apiPrimary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.9rem', fontWeight: 600 }}>
                        <FaArrowLeft size={12} /> All API docs
                    </Link>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {pill(`/api-docs/${slug}.md`, <FaFileAlt size={12} />, 'Raw Markdown')}
                        {pill(`/api-docs/${slug}.did`, <FaFileCode size={12} />, 'Candid')}
                        {pill(`/api-docs/${slug}.did.js`, <FaFileCode size={12} />, 'JS IDL')}
                        {slug === 'sneed_lock' && pill('/.well-known/agent-skills/sneed-lock/SKILL.md', <FaRobot size={12} />, 'Agent skill')}
                    </div>
                </div>

                {!doc && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: theme.colors.mutedText }}>No API document named "{slug}".</div>
                )}

                {loading && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: theme.colors.mutedText, padding: '2rem' }}>
                        <FaSpinner className="spin" style={{ animation: 'spin 1s linear infinite' }} /> Loading document...
                    </div>
                )}
                {error && <div style={{ color: theme.colors.error, padding: '1rem' }}>{error}</div>}

                {!loading && !error && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: '2rem', alignItems: 'start' }} className="api-doc-layout">
                        <style>{`
                            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                            @media (max-width: 900px) { .api-doc-layout { grid-template-columns: minmax(0, 1fr) !important; } .api-doc-toc { position: static !important; max-height: none !important; } }
                        `}</style>
                        <article style={{
                            background: theme.colors.cardGradient, border: `1px solid ${theme.colors.border}`, borderRadius: 16,
                            padding: '1.75rem', boxShadow: theme.colors.cardShadow, minWidth: 0, wordBreak: 'break-word',
                        }}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{markdown}</ReactMarkdown>
                        </article>
                        <nav className="api-doc-toc" style={{
                            position: 'sticky', top: 80, maxHeight: 'calc(100vh - 100px)', overflowY: 'auto',
                            background: theme.colors.cardGradient, border: `1px solid ${theme.colors.border}`, borderRadius: 16, padding: '1rem 1.1rem',
                        }}>
                            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: theme.colors.mutedText, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <FaListUl size={11} /> Contents
                            </div>
                            {toc.map((item) => (
                                <a key={item.id + item.text} href={hashHref(item.id)} onClick={(e) => jumpTo(e, item.id)} style={{
                                    display: 'block', fontSize: item.level === 2 ? '0.85rem' : '0.8rem', lineHeight: 1.4,
                                    padding: '3px 0', paddingLeft: item.level === 3 ? 14 : 0,
                                    color: item.level === 2 ? text : theme.colors.secondaryText, textDecoration: 'none',
                                    fontWeight: item.level === 2 ? 600 : 400,
                                }}>
                                    {item.text}
                                </a>
                            ))}
                        </nav>
                    </div>
                )}
            </main>
        </div>
    );
}

export default ApiDoc;
