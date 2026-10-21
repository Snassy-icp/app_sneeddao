// Small building blocks for the /convert page (ck conversions): cards, fields, buttons, notices,
// an "Advanced" disclosure, a copyable value, a QR code and status pills. Theme colours only.
import React, { useMemo, useState } from 'react';
import { FaCopy, FaCheck, FaChevronDown, FaChevronRight, FaExclamationTriangle, FaInfoCircle, FaCheckCircle, FaTimesCircle } from 'react-icons/fa';
import { useTheme } from '../../contexts/ThemeContext';
import { encodeQr, qrToSvgPath } from '../../utils/qrcode';

export function useC() { return useTheme().theme.colors; }

export function Card({ children, style }) {
    const c = useC();
    return <section style={{ background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: 16, padding: 16, minWidth: 0, ...style }}>{children}</section>;
}

export function Label({ children, hint }) {
    const c = useC();
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: c.secondaryText }}>{children}</span>
            {hint && <span style={{ fontSize: 12, color: c.mutedText }}>{hint}</span>}
        </div>
    );
}

export const inputStyle = (c, invalid = false) => ({
    width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10,
    border: `1px solid ${invalid ? c.error : c.border}`, background: c.secondaryBg, color: c.primaryText,
    fontSize: 15, outline: 'none', minWidth: 0,
});

export function Button({ children, onClick, disabled, variant = 'primary', style, type = 'button', title }) {
    const c = useC();
    const bg = variant === 'primary' ? c.accent : variant === 'danger' ? c.error : variant === 'success' ? c.success : 'transparent';
    const color = variant === 'ghost' ? c.secondaryText : '#fff';
    return (
        <button type={type} title={title} onClick={onClick} disabled={disabled}
            style={{
                padding: '10px 16px', borderRadius: 10, border: variant === 'ghost' ? `1px solid ${c.border}` : 'none',
                background: bg, color, fontWeight: 600, fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...style,
            }}>
            {children}
        </button>
    );
}

export function Notice({ tone = 'info', children, style }) {
    const c = useC();
    const color = tone === 'warning' ? c.warning : tone === 'error' ? c.error : tone === 'success' ? c.success : c.accent;
    const Icon = tone === 'warning' ? FaExclamationTriangle : tone === 'error' ? FaTimesCircle : tone === 'success' ? FaCheckCircle : FaInfoCircle;
    return (
        <div role={tone === 'error' ? 'alert' : undefined} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, border: `1px solid ${color}55`, background: `${color}14`, color: c.primaryText, fontSize: 13, lineHeight: 1.55, ...style }}>
            <Icon style={{ color, flexShrink: 0, marginTop: 3 }} />
            <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
        </div>
    );
}

export function Advanced({ title = 'Advanced', children, defaultOpen = false }) {
    const c = useC();
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div style={{ marginTop: 12 }}>
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
                style={{ background: 'none', border: 'none', color: c.secondaryText, cursor: 'pointer', padding: 0, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {open ? <FaChevronDown size={11} /> : <FaChevronRight size={11} />} {title}
            </button>
            {open && <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>}
        </div>
    );
}

export function CopyValue({ value, mono = true, label }) {
    const c = useC();
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try { await navigator.clipboard.writeText(String(value)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
    };
    return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '8px 10px', minWidth: 0 }}>
            <code style={{ flex: 1, minWidth: 0, wordBreak: 'break-all', fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit', fontSize: 13, color: c.primaryText }}>{String(value)}</code>
            <button type="button" onClick={copy} aria-label={label ? `Copy ${label}` : 'Copy'} title="Copy"
                style={{ flexShrink: 0, background: 'none', border: `1px solid ${c.border}`, borderRadius: 8, color: copied ? c.success : c.secondaryText, cursor: 'pointer', padding: '6px 8px', display: 'inline-flex' }}>
                {copied ? <FaCheck size={12} /> : <FaCopy size={12} />}
            </button>
        </div>
    );
}

export function QrCode({ text, size = 184 }) {
    const qr = useMemo(() => { try { return encodeQr(text, { ecl: 'M' }); } catch { return null; } }, [text]);
    if (!qr) return null;
    const dim = qr.size + 8;
    // always dark on white, so wallets scan it in either theme
    return (
        <svg role="img" aria-label={`QR code for ${text}`} viewBox={`0 0 ${dim} ${dim}`} width={size} height={size} style={{ background: '#fff', borderRadius: 10, display: 'block', shapeRendering: 'crispEdges' }}>
            <path d={qrToSvgPath(qr, 4)} fill="#000" />
        </svg>
    );
}

export function Pill({ tone = 'muted', children }) {
    const c = useC();
    const color = tone === 'success' ? c.success : tone === 'error' ? c.error : tone === 'warning' ? c.warning : tone === 'pending' ? c.accent : c.mutedText;
    return <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color, border: `1px solid ${color}66`, background: `${color}14`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{children}</span>;
}

/// "label ... value" rows for a summary.
export function Row({ k, v, strong, sub }) {
    const c = useC();
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', fontSize: 14, minWidth: 0 }}>
            <span style={{ color: c.secondaryText }}>{k}</span>
            <span style={{ textAlign: 'right', color: c.primaryText, fontWeight: strong ? 700 : 500, fontVariantNumeric: 'tabular-nums', minWidth: 0, wordBreak: 'break-word' }}>
                {v}{sub && <div style={{ fontSize: 12, color: c.mutedText, fontWeight: 400 }}>{sub}</div>}
            </span>
        </div>
    );
}

export function Steps({ steps, current, done }) {
    const c = useC();
    const idx = steps.findIndex((s) => s.key === current);
    return (
        <ol style={{ listStyle: 'none', padding: 0, margin: '10px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {steps.map((s, i) => {
                const state = done || i < idx ? 'done' : i === idx ? 'now' : 'todo';
                const color = state === 'done' ? c.success : state === 'now' ? c.accent : c.mutedText;
                return (
                    <li key={s.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: state === 'todo' ? c.mutedText : c.primaryText }}>
                        <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, border: `1px solid ${color}`, color, flexShrink: 0 }}>{state === 'done' ? <FaCheck size={9} /> : i + 1}</span>
                        {s.label}{state === 'now' && !done ? '…' : ''}
                    </li>
                );
            })}
        </ol>
    );
}
