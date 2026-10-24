import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { COMMON_EMOJIS, MAX_PER_USER, searchEmojis } from '../utils/reactionsModel';
import { EMOJI_LIST } from '../utils/emojiData';

const QUICK = ['👍', '❤️', '😂', '🎉', '🚀', '🔥', '👀', '🙏'];
const ALL = [...COMMON_EMOJIS, ...EMOJI_LIST];

/**
 * Emoji reactions under a post or a thread: one pill per emoji with its count (mine highlighted;
 * tap to add or take back), and a picker (common ones, search) to add another. Read-only when
 * `onToggle` is null (signed out). `onToggle(emoji)` resolves to an error text or null.
 */
export default function ReactionBar({ counts = [], mine = [], onToggle = null, compact = false }) {
    const { theme } = useTheme();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    const wrapRef = useRef(null);
    const searchRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        requestAnimationFrame(() => searchRef.current?.focus());
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [open]);

    const results = useMemo(() => searchEmojis(query, ALL).slice(0, 96), [query]);
    const mineSet = useMemo(() => new Set(mine), [mine]);

    const toggle = async (emoji) => {
        if (!onToggle || busy) return;
        setError(null);
        setBusy(emoji);
        try {
            const problem = await onToggle(emoji);
            if (problem) setError(problem);
            else setOpen(false);
        } finally {
            setBusy(null);
        }
    };

    if (counts.length === 0 && !onToggle) return null;

    const pill = (active) => ({
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: compact ? '1px 7px' : '2px 8px', borderRadius: '999px', fontSize: '13px', lineHeight: '20px',
        border: `1px solid ${active ? theme.colors.accent : theme.colors.border}`,
        background: active ? `${theme.colors.accent}22` : theme.colors.primaryBg,
        color: active ? theme.colors.accent : theme.colors.secondaryText,
        cursor: onToggle ? 'pointer' : 'default', fontWeight: active ? 600 : 400,
    });

    return (
        <div ref={wrapRef} style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', margin: '6px 0' }}
            onClick={(e) => e.stopPropagation()}>
            {counts.map(({ emoji, count }) => {
                const active = mineSet.has(emoji);
                return (
                    <button key={emoji} type="button" style={{ ...pill(active), opacity: busy === emoji ? 0.6 : 1 }}
                        disabled={!onToggle || !!busy}
                        title={onToggle ? (active ? 'Take back your reaction' : 'React with ' + emoji) : `${count} reacted with ${emoji}`}
                        aria-pressed={active}
                        onClick={() => toggle(emoji)}>
                        <span>{emoji}</span><span style={{ fontSize: '12px' }}>{String(count)}</span>
                    </button>
                );
            })}
            {onToggle && (
                <button type="button" style={{ ...pill(false), color: theme.colors.mutedText }} title="Add a reaction"
                    aria-label="Add a reaction" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                    <span>☺</span><span style={{ fontSize: '12px' }}>+</span>
                </button>
            )}
            {error && <span style={{ fontSize: '12px', color: theme.colors.error }}>{error}</span>}
            {open && (
                <div role="dialog" aria-label="Pick a reaction" style={{
                    position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: '4px',
                    width: 'min(320px, calc(100vw - 32px))', padding: '10px', borderRadius: '10px',
                    background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}`,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                }}>
                    <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
                        {QUICK.map((e) => (
                            <button key={e} type="button" onClick={() => toggle(e)} disabled={!!busy} title={mineSet.has(e) ? 'Take back' : 'React'}
                                style={{ fontSize: '20px', padding: '2px 4px', borderRadius: '6px', cursor: 'pointer', border: 'none',
                                    background: mineSet.has(e) ? `${theme.colors.accent}33` : 'transparent' }}>{e}</button>
                        ))}
                    </div>
                    <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search emoji"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: '6px', fontSize: '13px',
                            border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText }} />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '2px', marginTop: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                        {results.map((e) => (
                            <button key={e.emoji} type="button" title={e.name} onClick={() => toggle(e.emoji)} disabled={!!busy}
                                style={{ fontSize: '20px', padding: '2px', borderRadius: '6px', cursor: 'pointer', border: 'none',
                                    background: mineSet.has(e.emoji) ? `${theme.colors.accent}33` : 'transparent' }}>{e.emoji}</button>
                        ))}
                        {results.length === 0 && <span style={{ gridColumn: '1 / -1', fontSize: '12px', color: theme.colors.mutedText }}>No emoji found</span>}
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '11px', color: theme.colors.mutedText }}>
                        Up to {MAX_PER_USER} reactions each. Reactions are public, with your principal.
                    </div>
                </div>
            )}
        </div>
    );
}
