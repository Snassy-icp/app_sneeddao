// The one subaccount byte editor (spec/programmable_accounts.md §4.3, §4.10), extracted from
// pages/ToolsAccount.jsx: hex, number, text, byte array (left/right), principal + index, and the
// Sneed Vault layout owned(principal, index). All bytes come from utils/pockets/subaccount.js.
//
//   <SubaccountEditor onChange={(bytes | null, { format, valid, empty }) => …} />
import React, { useEffect, useMemo, useState } from 'react';
import { Principal } from '@dfinity/principal';
import { useTheme } from '../contexts/ThemeContext';
import { parseSubaccount, bytesToHex, principalInfo, parseOwnedSubaccount, pocketNumber, isDefault, VAULT_MAX_INDEX } from '../utils/pockets/subaccount';

export const SUB_FORMATS = [
    { key: 'hex', label: 'Hex String', placeholder: 'e.g. 0x01 or a1b2c3', desc: 'Hexadecimal string, right-aligned (zero-padded on the left)' },
    { key: 'number', label: 'Number', placeholder: 'e.g. 1 or 123456789', desc: 'Decimal integer, encoded as big-endian bytes (right-aligned). Pocket #n is the number n.' },
    { key: 'text', label: 'Text', placeholder: 'e.g. my-account', desc: 'UTF-8 text, left-aligned in 32 bytes' },
    { key: 'bytes', label: 'Byte Array', placeholder: 'e.g. 0, 0, 0, 1', desc: 'Comma-separated byte values (0-255)' },
    { key: 'principal', label: 'Principal', placeholder: 'e.g. rrkah-fqaaa-aaaaa-aaaaq-cai', desc: 'Principal encoded as subaccount: [length][principal_bytes][index]' },
    { key: 'vault', label: 'Sneed Vault layout', placeholder: 'owner principal', desc: 'owned(principal, index): [length][principal][zeros][index in the last 2 bytes]. Index 0 is the classic Sneed derivation.' },
];

export const INDEX_FORMATS = [
    { key: 'number', label: 'Number', placeholder: 'e.g. 0 or 42' },
    { key: 'hex', label: 'Hex', placeholder: 'e.g. 0x01 or ff' },
    { key: 'bytes', label: 'Bytes', placeholder: 'e.g. 0, 1' },
];

/// What a subaccount looks like, in words (or null).
export function subaccountHint(bytes) {
    if (!bytes || isDefault(bytes)) return null;
    const n = pocketNumber(bytes);
    if (n != null) return `Numbered pocket #${n}`;
    const owned = parseOwnedSubaccount(bytes);
    if (owned) return `Principal-derived: some dapps use this as ${owned.owner.toText()}'s deposit address${owned.index ? ` (Sneed Vault index ${owned.index})` : ''}`;
    const info = principalInfo(bytes);
    if (info) return `Principal-derived (${info.principalText}, then index ${info.indexNumber})`;
    return null;
}

export default function SubaccountEditor({ onChange, initialFormat = 'hex', formats = SUB_FORMATS.map((f) => f.key), showPreview = true, inputStyle, onFocus, onBlur }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const [format, setFormat] = useState(initialFormat);
    const [value, setValue] = useState('');
    const [align, setAlign] = useState('right');
    const [indexFormat, setIndexFormat] = useState('number');
    const [indexValue, setIndexValue] = useState('');

    const availableIndexBytes = useMemo(() => {
        if (format !== 'principal' || !value.trim()) return 0;
        try { return 31 - Principal.fromText(value.trim()).toUint8Array().length; } catch { return 0; }
    }, [format, value]);

    const bytes = useMemo(() => {
        if (!value.trim()) return null;
        const index = format === 'vault' ? Number(indexValue.trim() || 0) : 0;
        return parseSubaccount({ type: format, value, align, indexFormat, indexValue, index });
    }, [format, value, align, indexFormat, indexValue]);
    const empty = !value.trim();
    const valid = empty || Boolean(bytes);

    useEffect(() => { onChange?.(bytes, { format, valid, empty }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bytes, format, valid, empty]);

    const base = {
        width: '100%', boxSizing: 'border-box', padding: '0.7rem 0.85rem', borderRadius: 10, border: `1px solid ${valid ? c.border : c.error}`,
        background: c.secondaryBg, color: c.primaryText, fontSize: '0.9rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', outline: 'none', ...inputStyle,
    };
    const chip = (active) => ({
        padding: '0.3rem 0.65rem', borderRadius: 6, border: `1px solid ${active ? c.accent : c.border}`,
        background: active ? `${c.accent}20` : 'transparent', color: active ? c.accent : c.mutedText, fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer',
    });
    const fmt = SUB_FORMATS.find((f) => f.key === format);
    const hint = subaccountHint(bytes);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minWidth: 0 }}>
            <div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {SUB_FORMATS.filter((f) => formats.includes(f.key)).map((f) => (
                        <button type="button" key={f.key} style={chip(format === f.key)} onClick={() => { setFormat(f.key); setValue(''); setIndexValue(''); }}>{f.label}</button>
                    ))}
                </div>
                <div style={{ fontSize: '0.75rem', color: c.mutedText, marginTop: '0.4rem' }}>{fmt?.desc}</div>
            </div>
            <div>
                {format === 'bytes' && (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                        {['left', 'right'].map((a) => <button type="button" key={a} style={chip(align === a)} onClick={() => setAlign(a)}>Start from {a}</button>)}
                    </div>
                )}
                <input type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder={fmt?.placeholder} style={base} onFocus={onFocus} onBlur={onBlur} spellCheck={false} autoComplete="off" />
            </div>
            {format === 'principal' && availableIndexBytes > 0 && (
                <div style={{ padding: '0.75rem', background: c.primaryBg, borderRadius: 10, border: `1px solid ${c.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                        <span style={{ fontSize: '0.85rem', color: c.secondaryText, fontWeight: 500 }}>
                            Index <span style={{ fontWeight: 400, fontSize: '0.75rem', color: c.mutedText }}>({availableIndexBytes} byte{availableIndexBytes !== 1 ? 's' : ''} available)</span>
                        </span>
                        <div style={{ display: 'flex', gap: 4 }}>
                            {INDEX_FORMATS.map((f) => <button type="button" key={f.key} style={chip(indexFormat === f.key)} onClick={() => { setIndexFormat(f.key); setIndexValue(''); }}>{f.label}</button>)}
                        </div>
                    </div>
                    <input type="text" value={indexValue} onChange={(e) => setIndexValue(e.target.value)} placeholder={INDEX_FORMATS.find((f) => f.key === indexFormat)?.placeholder} style={{ ...base, fontSize: '0.85rem' }} onFocus={onFocus} onBlur={onBlur} />
                    <div style={{ fontSize: '0.7rem', color: c.mutedText, marginTop: 4 }}>Unused bytes after the principal, right-aligned. Defaults to zero.</div>
                </div>
            )}
            {format === 'vault' && (
                <div>
                    <label style={{ fontSize: '0.85rem', color: c.secondaryText, fontWeight: 500 }}>Index (0–{VAULT_MAX_INDEX.toLocaleString()})</label>
                    <input type="number" min={0} max={VAULT_MAX_INDEX} value={indexValue} onChange={(e) => setIndexValue(e.target.value)} placeholder="0" style={{ ...base, marginTop: 6 }} onFocus={onFocus} onBlur={onBlur} />
                </div>
            )}
            {!valid && <div style={{ fontSize: '0.8rem', color: c.error }}>Not a valid subaccount for this format</div>}
            {showPreview && bytes && (
                <div style={{ fontSize: '0.75rem', color: c.mutedText, wordBreak: 'break-all' }}>
                    <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: c.secondaryText }}>{bytesToHex(bytes)}</span>
                    {hint && <div style={{ marginTop: 4 }}>{hint}</div>}
                </div>
            )}
        </div>
    );
}
