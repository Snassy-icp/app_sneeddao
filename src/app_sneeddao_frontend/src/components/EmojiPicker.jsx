import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { DEFAULT_FAVORITES, EMOJI_CATEGORIES, EMOJI_LIST } from '../utils/emojiData';

const STORAGE_KEY = 'sneed_emoji_usage_v1';

function safeParseJson(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function loadUsage() {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  const parsed = safeParseJson(raw, {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function saveUsage(usage) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
}

function bumpUsage(usage, emoji) {
  const now = Date.now();
  const prev = usage?.[emoji];
  const next = {
    c: (prev?.c || 0) + 1,
    t: now
  };
  return { ...usage, [emoji]: next };
}

function computeTopEmojis(usage, limit = 16) {
  const entries = Object.entries(usage || {})
    .filter(([emoji, meta]) => typeof emoji === 'string' && emoji.length > 0 && meta && typeof meta === 'object')
    .map(([emoji, meta]) => ({
      emoji,
      c: Number(meta.c || 0),
      t: Number(meta.t || 0)
    }))
    .filter((x) => Number.isFinite(x.c) && x.c > 0)
    .sort((a, b) => (b.c - a.c) || (b.t - a.t))
    .slice(0, limit)
    .map((x) => x.emoji);

  if (entries.length >= Math.min(limit, 6)) return entries;

  // Fill with defaults so the bar is never empty.
  const set = new Set(entries);
  for (const e of DEFAULT_FAVORITES) set.add(e);
  return Array.from(set).slice(0, limit);
}

function insertAtCursor({ el, value, setValue, text }) {
  if (!el) return;
  const start = typeof el.selectionStart === 'number' ? el.selectionStart : value.length;
  const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : value.length;
  const nextValue = value.slice(0, start) + text + value.slice(end);
  setValue(nextValue);

  // Restore cursor position after state update.
  requestAnimationFrame(() => {
    try {
      el.focus();
      const nextPos = start + text.length;
      if (typeof el.setSelectionRange === 'function') {
        el.setSelectionRange(nextPos, nextPos);
      }
    } catch {
      // ignore
    }
  });
}

/**
 * EmojiPicker:
 * - shows a favorites row (from localStorage usage stats)
 * - shows a small button to open a larger palette (with category + search)
 * - inserts emoji at cursor into a target input/textarea
 */
export default function EmojiPicker({ targetRef, getValue, setValue, ariaLabel = 'Insert emoji' }) {
  const { theme } = useTheme();
  const wrapperRef = useRef(null);
  const searchRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('frequent');
  const [usage, setUsage] = useState(() => loadUsage());

  const favorites = useMemo(() => computeTopEmojis(usage, 16), [usage]);

  const frequentSet = useMemo(() => new Set(favorites), [favorites]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = EMOJI_LIST.filter((e) => {
      const catOk = category === 'frequent' ? frequentSet.has(e.emoji) : e.category === category;
      if (!catOk) return false;
      if (!q) return true;
      const hay = `${e.name} ${e.keywords.join(' ')}`.toLowerCase();
      return hay.includes(q);
    });

    // For "frequent", keep the order as in favorites.
    if (category === 'frequent') {
      const idx = new Map(favorites.map((em, i) => [em, i]));
      return list.sort((a, b) => (idx.get(a.emoji) ?? 9999) - (idx.get(b.emoji) ?? 9999));
    }
    return list;
  }, [category, query, frequentSet, favorites]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!wrapperRef.current) return;
      if (wrapperRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Autofocus search when palette opens.
    requestAnimationFrame(() => searchRef.current?.focus?.());
  }, [open]);

  useEffect(() => {
    // Keep favorites in sync if multiple tabs are open.
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY) return;
      setUsage(loadUsage());
    };
    window.addEventListener?.('storage', onStorage);
    return () => window.removeEventListener?.('storage', onStorage);
  }, []);

  const handlePick = (emoji) => {
    const value = getValue();
    const el = targetRef?.current;
    insertAtCursor({ el, value, setValue, text: emoji });
    const nextUsage = bumpUsage(loadUsage(), emoji);
    saveUsage(nextUsage);
    setUsage(nextUsage);
  };

  const styles = {
    row: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flexWrap: 'wrap',
      margin: '6px 0 8px 0'
    },
    emojiBtn: {
      width: '28px',
      height: '28px',
      borderRadius: '6px',
      border: `1px solid ${theme.colors.border}`,
      backgroundColor: theme.colors.primaryBg,
      color: theme.colors.primaryText,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '18px',
      lineHeight: 1,
      userSelect: 'none'
    },
    paletteBtn: {
      width: '28px',
      height: '28px',
      borderRadius: '6px',
      border: `1px solid ${theme.colors.border}`,
      backgroundColor: theme.colors.secondaryBg,
      color: theme.colors.primaryText,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '16px'
    },
    popover: {
      position: 'absolute',
      right: 0,
      top: 'calc(100% + 6px)',
      width: '360px',
      maxWidth: '90vw',
      backgroundColor: theme.colors.secondaryBg,
      border: `1px solid ${theme.colors.border}`,
      borderRadius: '10px',
      boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
      zIndex: 2000,
      overflow: 'hidden'
    },
    popoverHeader: {
      padding: '10px',
      borderBottom: `1px solid ${theme.colors.border}`
    },
    search: {
      width: '100%',
      padding: '10px',
      borderRadius: '8px',
      border: `1px solid ${theme.colors.border}`,
      backgroundColor: theme.colors.primaryBg,
      color: theme.colors.primaryText,
      fontSize: '14px',
      outline: 'none',
      boxSizing: 'border-box'
    },
    cats: {
      display: 'flex',
      gap: '6px',
      flexWrap: 'wrap',
      padding: '10px',
      borderBottom: `1px solid ${theme.colors.border}`
    },
    catBtn: (active) => ({
      padding: '6px 10px',
      borderRadius: '999px',
      border: `1px solid ${active ? theme.colors.accent : theme.colors.border}`,
      backgroundColor: active ? `${theme.colors.accent}20` : theme.colors.primaryBg,
      color: active ? theme.colors.accent : theme.colors.mutedText,
      cursor: 'pointer',
      fontSize: '12px',
      userSelect: 'none'
    }),
    grid: {
      padding: '10px',
      display: 'grid',
      gridTemplateColumns: 'repeat(10, 1fr)',
      gap: '6px',
      maxHeight: '280px',
      overflow: 'auto'
    },
    empty: {
      padding: '14px',
      color: theme.colors.mutedText,
      fontSize: '13px'
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      <div style={styles.row} aria-label={ariaLabel}>
        {favorites.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => handlePick(e)}
            style={styles.emojiBtn}
            title="Insert emoji"
          >
            {e}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={styles.paletteBtn}
          title={open ? 'Close emoji palette' : 'Open emoji palette'}
          aria-expanded={open}
        >
          🙂
        </button>
      </div>

      {open && (
        <div style={styles.popover} role="dialog" aria-label="Emoji palette">
          <div style={styles.popoverHeader}>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search emojis…"
              style={styles.search}
            />
          </div>
          <div style={styles.cats}>
            {EMOJI_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategory(c.key)}
                style={styles.catBtn(category === c.key)}
                title={c.label}
              >
                {c.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div style={styles.empty}>No emojis found for that search/category.</div>
          ) : (
            <div style={styles.grid}>
              {filtered.map((e) => (
                <button
                  key={`${e.category}-${e.emoji}`}
                  type="button"
                  onClick={() => handlePick(e.emoji)}
                  style={styles.emojiBtn}
                  title={e.name}
                >
                  {e.emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

