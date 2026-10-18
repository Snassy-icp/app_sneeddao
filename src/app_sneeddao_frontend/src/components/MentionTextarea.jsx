// A textarea for forum threads and posts with @-mention auto-complete (spec/forum_mentions.md).
// Typing "@" and part of a Sneed name lists matching members; picking one inserts a mention link
// that carries their principal, so names with spaces work and a rename never breaks it. A
// private nickname can be searched by, but only the public name (or a short principal) goes into
// the post, so nicknames stay private. Drop-in for <textarea>: same value/onChange(event) props.
import React, { useMemo, useRef, useState } from 'react';
import { Principal } from '@dfinity/principal';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { isCanisterPrincipal } from '../utils/PrincipalUtils';
import { mentionMarkdown } from '../utils/mentions';

const MAX_ITEMS = 8;
const TRIGGER = /(?:^|[\s(])@([^\s@[\]()]{0,32})$/;

export default function MentionTextarea({ value, onChange, onKeyDown, style, textareaRef, ...rest }) {
    const { theme } = useTheme();
    const { principalNames, principalNicknames, verifiedNames } = useNaming();
    const ref = useRef(null);
    const setRef = (el) => { ref.current = el; if (typeof textareaRef === 'function') textareaRef(el); else if (textareaRef) textareaRef.current = el; };
    const [query, setQuery] = useState(null); // { start, text } while the caret follows "@…"
    const [active, setActive] = useState(0);

    const people = useMemo(() => {
        const out = new Map();
        const add = (id, name, nickname) => {
            if (!id || isCanisterPrincipal(id)) return;
            const e = out.get(id) || { id, name: null, nickname: null };
            if (name) e.name = name; if (nickname) e.nickname = nickname;
            out.set(id, e);
        };
        principalNames?.forEach((name, id) => add(id, name, null));
        principalNicknames?.forEach((nick, id) => add(id, null, nick));
        return [...out.values()];
    }, [principalNames, principalNicknames]);

    const items = useMemo(() => {
        if (!query) return [];
        const q = query.text.toLowerCase().replace(/[_-]/g, ' ');
        const score = (s) => {
            if (!s) return 0;
            const t = s.toLowerCase().replace(/[_-]/g, ' ');
            if (!q) return 1;
            if (t.startsWith(q)) return 3;
            if (t.split(/[\s.']+/).some((w) => w.startsWith(q))) return 2;
            return 0;
        };
        return people
            .map((p) => ({ ...p, score: Math.max(score(p.name) * 2, score(p.nickname)), verified: !!verifiedNames?.get?.(p.id) }))
            .filter((p) => p.score > 0)
            .sort((a, b) => b.score - a.score || Number(b.verified) - Number(a.verified) || (a.name || a.nickname).localeCompare(b.name || b.nickname))
            .slice(0, MAX_ITEMS);
    }, [query, people, verifiedNames]);

    const track = (el) => {
        const caret = el.selectionStart;
        if (caret !== el.selectionEnd) { setQuery(null); return; }
        const m = TRIGGER.exec(el.value.slice(0, caret));
        if (m) { setQuery({ start: caret - m[1].length - 1, text: m[1] }); setActive(0); } else setQuery(null);
    };

    const pick = (p) => {
        const el = ref.current;
        if (!el || !query) return;
        const caret = el.selectionStart;
        const insert = `${mentionMarkdown(Principal.fromText(p.id), p.name)} `;
        const next = value.slice(0, query.start) + insert + value.slice(caret);
        onChange?.({ target: { value: next }, currentTarget: { value: next } });
        setQuery(null);
        const pos = query.start + insert.length;
        requestAnimationFrame(() => { try { el.focus(); el.setSelectionRange(pos, pos); } catch { /* unmounted */ } });
    };

    const keyDown = (e) => {
        if (query && items.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[active]); return; }
            if (e.key === 'Escape') { e.preventDefault(); setQuery(null); return; }
        }
        onKeyDown?.(e);
    };

    const c = theme.colors;
    return (
        <div style={{ position: 'relative', width: style?.width || '100%', flex: style?.flex, minWidth: style?.minWidth, display: 'flex', flexDirection: 'column' }}>
            <textarea
                {...rest}
                ref={setRef}
                value={value}
                style={style}
                onChange={(e) => { onChange?.(e); track(e.target); }}
                onKeyDown={keyDown}
                onKeyUp={(e) => { rest.onKeyUp?.(e); if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) track(e.target); }}
                onClick={(e) => { rest.onClick?.(e); track(e.target); }}
                onBlur={(e) => { rest.onBlur?.(e); setTimeout(() => setQuery(null), 150); }}
                aria-autocomplete="list"
                aria-expanded={!!(query && items.length)}
            />
            {query && items.length > 0 && (
                <div role="listbox" aria-label="Mention someone"
                    style={{ position: 'absolute', left: 8, right: 8, top: '100%', marginTop: 4, zIndex: 50, maxWidth: 380, background: c.primaryBg, border: `1px solid ${c.border}`, borderRadius: 10, boxShadow: '0 12px 30px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
                    <div style={{ padding: '6px 10px', fontSize: 11, color: c.mutedText, borderBottom: `1px solid ${c.border}` }}>Mention someone: they get a notification</div>
                    {items.map((p, i) => (
                        <div key={p.id} role="option" aria-selected={i === active}
                            onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                            onMouseEnter={() => setActive(i)}
                            style={{ padding: '7px 10px', cursor: 'pointer', background: i === active ? `${c.accent}22` : 'transparent', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                            <span style={{ color: c.primaryText, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {p.name || <em style={{ color: c.mutedText }}>no public name</em>}{p.verified && <span title="Verified" style={{ color: c.success || '#22c55e', marginLeft: 4 }}>✓</span>}
                                {p.nickname && <span style={{ color: c.mutedText, fontSize: 12, marginLeft: 6 }}>({p.nickname})</span>}
                            </span>
                            <span style={{ color: c.mutedText, fontSize: 11, fontFamily: 'monospace', flexShrink: 0 }}>{p.id.slice(0, 5)}…{p.id.slice(-3)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
