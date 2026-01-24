import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

function applyTextEdit({ el, value, setValue, nextValue, nextSelection }) {
  setValue(nextValue);
  requestAnimationFrame(() => {
    try {
      el?.focus?.();
      if (el && typeof el.setSelectionRange === 'function' && nextSelection) {
        el.setSelectionRange(nextSelection.start, nextSelection.end);
      }
    } catch {
      // ignore
    }
  });
}

function getSelection(el, value) {
  const start = typeof el?.selectionStart === 'number' ? el.selectionStart : value.length;
  const end = typeof el?.selectionEnd === 'number' ? el.selectionEnd : value.length;
  return { start, end };
}

function wrapSelection({ el, value, setValue, before, after, placeholder }) {
  const { start, end } = getSelection(el, value);
  const selected = value.slice(start, end);
  const inner = selected || placeholder;
  const nextValue = value.slice(0, start) + before + inner + after + value.slice(end);

  // If no selection, select the placeholder text so user can type over it.
  const innerStart = start + before.length;
  const innerEnd = innerStart + inner.length;

  applyTextEdit({
    el,
    value,
    setValue,
    nextValue,
    nextSelection: selected ? { start: innerEnd + after.length, end: innerEnd + after.length } : { start: innerStart, end: innerEnd }
  });
}

function insertLink({ el, value, setValue }) {
  const { start, end } = getSelection(el, value);
  const selected = value.slice(start, end);
  const text = selected || 'link text';
  const url = 'https://';
  const snippet = `[${text}](${url})`;
  const nextValue = value.slice(0, start) + snippet + value.slice(end);

  // Select the URL part for quick typing
  const urlStart = start + 2 + text.length; // "[{text}](" => 2 + text.length
  const urlEnd = urlStart + url.length;

  applyTextEdit({
    el,
    value,
    setValue,
    nextValue,
    nextSelection: { start: urlStart, end: urlEnd }
  });
}

export default function MarkdownButtons({ targetRef, getValue, setValue }) {
  const { theme } = useTheme();

  const btnStyle = {
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
    fontSize: '12px',
    lineHeight: 1,
    userSelect: 'none'
  };

  const onBold = () => {
    const el = targetRef?.current;
    const value = getValue();
    wrapSelection({ el, value, setValue, before: '**', after: '**', placeholder: 'bold' });
  };

  const onItalic = () => {
    const el = targetRef?.current;
    const value = getValue();
    wrapSelection({ el, value, setValue, before: '_', after: '_', placeholder: 'italic' });
  };

  const onCode = () => {
    const el = targetRef?.current;
    const value = getValue();
    wrapSelection({ el, value, setValue, before: '`', after: '`', placeholder: 'code' });
  };

  const onLink = () => {
    const el = targetRef?.current;
    const value = getValue();
    insertLink({ el, value, setValue });
  };

  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
      <button type="button" onClick={onBold} style={btnStyle} title="Bold (Markdown)">
        <span style={{ fontWeight: 800 }}>B</span>
      </button>
      <button type="button" onClick={onItalic} style={btnStyle} title="Italic (Markdown)">
        <span style={{ fontStyle: 'italic' }}>I</span>
      </button>
      <button type="button" onClick={onLink} style={btnStyle} title="Insert link (Markdown)">
        🔗
      </button>
      <button type="button" onClick={onCode} style={btnStyle} title="Inline code (Markdown)">
        {'</>'}
      </button>
    </div>
  );
}

