// A textarea for forum threads and posts with @-mention auto-complete (spec/forum_mentions.md).
// Typing "@" and part of a Sneed name opens the same picker as PrincipalInput (Private/Public/All
// tabs, user/canister toggles); picking someone inserts a mention link that carries their
// principal, so names with spaces work and a rename never breaks it. In the query "_" and "-"
// stand for spaces. A private nickname can be searched by, but only the public name (or a short
// principal) goes into the post, so nicknames stay private. Drop-in for <textarea>: same
// value/onChange(event) props.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useNaming } from '../NamingContext';
import { searchPrincipals, PrincipalPickerPanel } from './PrincipalInput';
import { mentionMarkdown } from '../utils/mentions';

const TRIGGER = /(?:^|[\s(])@([^\s@[\]()]{0,32})$/;

export default function MentionTextarea({ value, onChange, onKeyDown, style, textareaRef, ...rest }) {
    const { theme } = useTheme();
    const { principalNames, principalNicknames, verifiedNames, principalCanisterTypes } = useNaming();
    const ref = useRef(null);
    const listRef = useRef(null);
    const setRef = (el) => { ref.current = el; if (typeof textareaRef === 'function') textareaRef(el); else if (textareaRef) textareaRef.current = el; };
    const [query, setQuery] = useState(null); // { start, text } while the caret follows "@…"
    const [active, setActive] = useState(0);
    const [tab, setTab] = useState('all');
    const [showUsers, setShowUsers] = useState(true);
    const [showCanisters, setShowCanisters] = useState(false);

    const items = useMemo(() => (query ? searchPrincipals(query.text, {
        tab, showUsers, showCanisters, principalNames, principalNicknames, verifiedNames, principalCanisterTypes, loose: true,
    }) : []), [query, tab, showUsers, showCanisters, principalNames, principalNicknames, verifiedNames, principalCanisterTypes]);
    const open = !!(query && query.text);

    useEffect(() => { setActive(0); }, [tab, showUsers, showCanisters]);
    useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

    const track = (el) => {
        const caret = el.selectionStart;
        if (caret !== el.selectionEnd) { setQuery(null); return; }
        const m = TRIGGER.exec(el.value.slice(0, caret));
        if (m) { setQuery({ start: caret - m[1].length - 1, text: m[1] }); setActive(0); } else setQuery(null);
    };

    const pick = (item) => {
        const el = ref.current;
        if (!el || !query) return;
        const caret = el.selectionStart;
        const insert = `${mentionMarkdown(item.principal, item.displayInfo?.name)} `;
        const next = value.slice(0, query.start) + insert + value.slice(caret);
        onChange?.({ target: { value: next }, currentTarget: { value: next } });
        setQuery(null);
        const pos = query.start + insert.length;
        requestAnimationFrame(() => { try { el.focus(); el.setSelectionRange(pos, pos); } catch { /* unmounted */ } });
    };

    const keyDown = (e) => {
        if (open && e.key === 'Escape') { e.preventDefault(); setQuery(null); return; }
        if (open && items.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(items[Math.min(active, items.length - 1)]); return; }
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
                aria-expanded={open}
            />
            {open && (
                <div ref={listRef} role="listbox" aria-label="Mention someone"
                    style={{ position: 'absolute', left: 8, right: 8, top: '100%', marginTop: 4, zIndex: 50, maxWidth: 420, maxHeight: 300, overflowY: 'auto', background: c.tertiaryBg, border: `1px solid ${c.border}`, borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
                    <PrincipalPickerPanel
                        note="Mention someone: they get a notification. Posts show their public name, never your nickname."
                        activeTab={tab}
                        onTabChange={setTab}
                        showUsers={showUsers}
                        showCanisters={showCanisters}
                        onToggleUsers={() => { if (showUsers && !showCanisters) setShowCanisters(true); setShowUsers(!showUsers); }}
                        onToggleCanisters={() => { if (showCanisters && !showUsers) setShowUsers(true); setShowCanisters(!showCanisters); }}
                        results={items}
                        onSelect={pick}
                        isAuthenticated
                        activeIndex={Math.min(active, items.length - 1)}
                        onHoverIndex={setActive}
                        keepFocus
                    />
                </div>
            )}
        </div>
    );
}
