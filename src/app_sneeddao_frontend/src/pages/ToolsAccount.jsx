import React, { useState, useMemo, useCallback } from 'react';
import { Principal } from '@dfinity/principal';
import { encodeIcrcAccount, decodeIcrcAccount } from '@dfinity/ledger-icrc';
import { principalToSubAccount } from '@dfinity/utils';
import { useTheme } from '../contexts/ThemeContext';
import { computeAccountId } from '../utils/PrincipalUtils';
import { bytesToHex, isDefaultSubaccount } from '../utils/AccountParser';
import { FaCopy, FaCheck } from 'react-icons/fa';

const numberToSubaccount = (numStr) => {
    try {
        const n = BigInt(numStr);
        if (n < 0n) return null;
        const bytes = new Uint8Array(32);
        let val = n;
        for (let i = 31; i >= 0 && val > 0n; i--) {
            bytes[i] = Number(val & 0xFFn);
            val >>= 8n;
        }
        if (val > 0n) return null;
        return bytes;
    } catch {
        return null;
    }
};

const textToSubaccount = (text) => {
    try {
        const encoded = new TextEncoder().encode(text);
        if (encoded.length === 0 || encoded.length > 32) return null;
        const bytes = new Uint8Array(32);
        bytes.set(encoded, 0);
        return bytes;
    } catch {
        return null;
    }
};

const hexToSubaccount = (hex) => {
    if (!hex || typeof hex !== 'string') return null;
    let clean = hex.trim();
    if (clean.toLowerCase().startsWith('0x')) clean = clean.slice(2);
    clean = clean.replace(/[\s-]/g, '');
    if (!/^[0-9a-fA-F]+$/.test(clean)) return null;
    if (clean.length > 64) return null;
    clean = clean.padStart(64, '0');
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
};

const byteArrayToSubaccount = (input, alignment = 'right') => {
    if (!input || typeof input !== 'string') return null;
    const parts = input.trim().split(',').map(s => s.trim()).filter(s => s !== '');
    if (parts.length === 0 || parts.length > 32) return null;
    const values = [];
    for (const p of parts) {
        const num = parseInt(p, 10);
        if (isNaN(num) || num < 0 || num > 255) return null;
        values.push(num);
    }
    const bytes = new Uint8Array(32);
    if (alignment === 'left') {
        for (let i = 0; i < values.length; i++) bytes[i] = values[i];
    } else {
        const offset = 32 - values.length;
        for (let i = 0; i < values.length; i++) bytes[offset + i] = values[i];
    }
    return bytes;
};

const principalStrToSubaccount = (str) => {
    try {
        const principal = Principal.fromText(str.trim());
        const sub = principalToSubAccount(principal);
        return new Uint8Array(sub);
    } catch {
        return null;
    }
};

const INPUT_MODES = [
    { key: 'principal', label: 'Principal' },
    { key: 'principal_subaccount', label: 'Principal + Subaccount' },
    { key: 'icrc1', label: 'ICRC-1 Account' },
];

const SUB_FORMATS = [
    { key: 'number', label: 'Number', placeholder: 'e.g. 1 or 123456789', desc: 'Decimal integer, encoded as big-endian bytes (right-aligned)' },
    { key: 'text', label: 'Text', placeholder: 'e.g. my-account', desc: 'UTF-8 text, left-aligned in 32 bytes' },
    { key: 'hex', label: 'Hex String', placeholder: 'e.g. 0x01 or a1b2c3', desc: 'Hexadecimal string, right-aligned (zero-padded on the left)' },
    { key: 'bytes', label: 'Byte Array', placeholder: 'e.g. 0, 0, 0, 1', desc: 'Comma-separated byte values (0-255)' },
    { key: 'principal', label: 'Principal', placeholder: 'e.g. rrkah-fqaaa-aaaaa-aaaaq-cai', desc: 'Principal encoded as subaccount bytes (length-prefixed)' },
];

function ToolsAccount() {
    const { theme } = useTheme();

    const [inputMode, setInputMode] = useState('principal');
    const [principalInput, setPrincipalInput] = useState('');
    const [principal2Input, setPrincipal2Input] = useState('');
    const [subFormat, setSubFormat] = useState('number');
    const [subInput, setSubInput] = useState('');
    const [byteAlign, setByteAlign] = useState('right');
    const [icrc1Input, setIcrc1Input] = useState('');
    const [copiedField, setCopiedField] = useState(null);

    const handleCopy = useCallback(async (text, field) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(field);
            setTimeout(() => setCopiedField(null), 1500);
        } catch { /* ignore */ }
    }, []);

    const resolveSubaccount = useCallback((format, value, alignment) => {
        if (!value || !value.trim()) return null;
        const v = value.trim();
        switch (format) {
            case 'number': return numberToSubaccount(v);
            case 'text': return textToSubaccount(v);
            case 'hex': return hexToSubaccount(v);
            case 'bytes': return byteArrayToSubaccount(v, alignment);
            case 'principal': return principalStrToSubaccount(v);
            default: return null;
        }
    }, []);

    const parsed = useMemo(() => {
        let principal = null;
        let subaccount = null;
        let error = null;

        if (inputMode === 'principal') {
            if (!principalInput.trim()) return { principal: null, subaccount: null, error: null };
            try {
                principal = Principal.fromText(principalInput.trim());
            } catch {
                return { principal: null, subaccount: null, error: 'Invalid principal' };
            }
        } else if (inputMode === 'principal_subaccount') {
            if (!principal2Input.trim()) return { principal: null, subaccount: null, error: null };
            try {
                principal = Principal.fromText(principal2Input.trim());
            } catch {
                return { principal: null, subaccount: null, error: 'Invalid principal' };
            }
            if (subInput.trim()) {
                subaccount = resolveSubaccount(subFormat, subInput, byteAlign);
                if (!subaccount) error = 'Invalid subaccount value for the selected format';
            }
        } else if (inputMode === 'icrc1') {
            if (!icrc1Input.trim()) return { principal: null, subaccount: null, error: null };
            const trimmed = icrc1Input.trim();
            if (trimmed.includes('.')) {
                try {
                    const decoded = decodeIcrcAccount(trimmed);
                    if (decoded && decoded.owner) {
                        principal = decoded.owner;
                        if (decoded.subaccount) subaccount = new Uint8Array(decoded.subaccount);
                    } else {
                        error = 'Could not decode ICRC-1 account';
                    }
                } catch {
                    error = 'Invalid ICRC-1 account string';
                }
            } else {
                try {
                    principal = Principal.fromText(trimmed);
                } catch {
                    error = 'Invalid principal or ICRC-1 account string';
                }
            }
        }

        return { principal, subaccount, error };
    }, [inputMode, principalInput, principal2Input, subFormat, subInput, byteAlign, icrc1Input, resolveSubaccount]);

    const summary = useMemo(() => {
        if (!parsed.principal) return null;

        const principalText = parsed.principal.toText();
        const subBytes = parsed.subaccount || new Uint8Array(32);
        const hasNonDefaultSub = parsed.subaccount != null && !isDefaultSubaccount(parsed.subaccount);
        const subHex = bytesToHex(subBytes);

        let icrc1Account;
        try {
            icrc1Account = encodeIcrcAccount({
                owner: parsed.principal,
                subaccount: hasNonDefaultSub ? parsed.subaccount : undefined
            });
        } catch {
            icrc1Account = null;
        }

        let legacyAccountId;
        try {
            legacyAccountId = computeAccountId(parsed.principal, subBytes);
        } catch {
            legacyAccountId = null;
        }

        return { principalText, subHex, hasNonDefaultSub, icrc1Account, legacyAccountId };
    }, [parsed]);

    const inputBaseStyle = {
        width: '100%',
        padding: '0.75rem 1rem',
        borderRadius: '10px',
        border: `1px solid ${theme.colors.border}`,
        background: theme.colors.primaryBg,
        color: theme.colors.primaryText,
        fontSize: '0.9rem',
        fontFamily: 'monospace',
        outline: 'none',
        boxSizing: 'border-box',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    };

    const cardStyle = {
        background: theme.colors.cardGradient,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '16px',
        padding: '1.5rem',
        marginBottom: '1rem',
        boxShadow: theme.colors.cardShadow,
    };

    const handleFocus = (e) => {
        e.target.style.borderColor = theme.colors.accent;
        e.target.style.boxShadow = `0 0 0 2px ${theme.colors.accent}25`;
    };
    const handleBlur = (e) => {
        e.target.style.borderColor = theme.colors.border;
        e.target.style.boxShadow = 'none';
    };

    const CopyBtn = ({ text, field }) => (
        <button
            onClick={() => text && handleCopy(text, field)}
            disabled={!text}
            style={{
                background: 'none',
                border: 'none',
                padding: '4px 6px',
                cursor: text ? 'pointer' : 'not-allowed',
                color: copiedField === field ? theme.colors.success : theme.colors.mutedText,
                display: 'inline-flex',
                alignItems: 'center',
                opacity: text ? 1 : 0.3,
                transition: 'color 0.2s ease',
                flexShrink: 0,
            }}
            title={copiedField === field ? 'Copied!' : 'Copy to clipboard'}
        >
            {copiedField === field ? <FaCheck size={12} /> : <FaCopy size={12} />}
        </button>
    );

    const SummaryRow = ({ label, value, copyValue, field }) => {
        const cv = copyValue || value;
        return (
            <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '0.7rem 0',
                borderBottom: `1px solid ${theme.colors.border}30`,
            }}>
                <span style={{
                    fontSize: '0.8rem',
                    color: theme.colors.mutedText,
                    minWidth: '110px',
                    paddingTop: '2px',
                    fontWeight: '500',
                    flexShrink: 0,
                }}>
                    {label}
                </span>
                <span style={{
                    flex: 1,
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                    color: value ? theme.colors.primaryText : theme.colors.mutedText,
                    wordBreak: 'break-all',
                    lineHeight: '1.5',
                }}>
                    {value || '\u2014'}
                </span>
                <CopyBtn text={cv} field={field} />
            </div>
        );
    };

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '1.5rem 1rem', color: theme.colors.primaryText }}>
            {/* Page Header */}
            <div style={{ marginBottom: '1.5rem' }}>
                <h1 style={{ fontSize: '1.75rem', fontWeight: '700', margin: '0 0 0.5rem 0' }}>
                    Account Tool
                </h1>
                <p style={{ color: theme.colors.secondaryText, fontSize: '0.95rem', lineHeight: '1.5', margin: 0 }}>
                    Convert between ICP account formats. Enter a principal, a principal with subaccount,
                    or an ICRC-1 account string to see all derived representations including the legacy ICP account identifier.
                </p>
            </div>

            {/* Input Mode Tabs */}
            <div style={{
                display: 'flex',
                gap: '4px',
                padding: '4px',
                background: theme.colors.secondaryBg,
                borderRadius: '12px',
                marginBottom: '1rem',
                flexWrap: 'wrap',
            }}>
                {INPUT_MODES.map(mode => (
                    <button
                        key={mode.key}
                        onClick={() => setInputMode(mode.key)}
                        style={{
                            flex: '1 1 auto',
                            padding: '0.65rem 0.75rem',
                            borderRadius: '9px',
                            border: 'none',
                            background: inputMode === mode.key ? theme.colors.accent : 'transparent',
                            color: inputMode === mode.key ? '#ffffff' : theme.colors.mutedText,
                            fontSize: '0.85rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            whiteSpace: 'nowrap',
                            minWidth: 'fit-content',
                        }}
                    >
                        {mode.label}
                    </button>
                ))}
            </div>

            {/* Input Card */}
            <div style={cardStyle}>
                {inputMode === 'principal' && (
                    <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', color: theme.colors.secondaryText, marginBottom: '0.5rem', fontWeight: '500' }}>
                            Principal
                        </label>
                        <input
                            type="text"
                            value={principalInput}
                            onChange={e => setPrincipalInput(e.target.value)}
                            placeholder="e.g. rrkah-fqaaa-aaaaa-aaaaq-cai"
                            style={inputBaseStyle}
                            onFocus={handleFocus}
                            onBlur={handleBlur}
                            autoFocus
                        />
                    </div>
                )}

                {inputMode === 'principal_subaccount' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        {/* Principal */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.85rem', color: theme.colors.secondaryText, marginBottom: '0.5rem', fontWeight: '500' }}>
                                Principal
                            </label>
                            <input
                                type="text"
                                value={principal2Input}
                                onChange={e => setPrincipal2Input(e.target.value)}
                                placeholder="e.g. rrkah-fqaaa-aaaaa-aaaaq-cai"
                                style={inputBaseStyle}
                                onFocus={handleFocus}
                                onBlur={handleBlur}
                                autoFocus
                            />
                        </div>

                        {/* Subaccount Format */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.85rem', color: theme.colors.secondaryText, marginBottom: '0.5rem', fontWeight: '500' }}>
                                Subaccount Format
                            </label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {SUB_FORMATS.map(fmt => (
                                    <button
                                        key={fmt.key}
                                        onClick={() => { setSubFormat(fmt.key); setSubInput(''); }}
                                        style={{
                                            padding: '0.45rem 0.85rem',
                                            borderRadius: '8px',
                                            border: `1px solid ${subFormat === fmt.key ? theme.colors.accent : theme.colors.border}`,
                                            background: subFormat === fmt.key ? `${theme.colors.accent}20` : 'transparent',
                                            color: subFormat === fmt.key ? theme.colors.accent : theme.colors.secondaryText,
                                            fontSize: '0.8rem',
                                            fontWeight: '500',
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease',
                                        }}
                                    >
                                        {fmt.label}
                                    </button>
                                ))}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '0.4rem' }}>
                                {SUB_FORMATS.find(f => f.key === subFormat)?.desc}
                            </div>
                        </div>

                        {/* Subaccount Value */}
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                <label style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, fontWeight: '500' }}>
                                    Subaccount Value
                                </label>
                                {subFormat === 'bytes' && (
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                        {['left', 'right'].map(align => (
                                            <button
                                                key={align}
                                                onClick={() => setByteAlign(align)}
                                                style={{
                                                    padding: '0.3rem 0.65rem',
                                                    borderRadius: '6px',
                                                    border: `1px solid ${byteAlign === align ? theme.colors.accent : theme.colors.border}`,
                                                    background: byteAlign === align ? `${theme.colors.accent}20` : 'transparent',
                                                    color: byteAlign === align ? theme.colors.accent : theme.colors.mutedText,
                                                    fontSize: '0.72rem',
                                                    fontWeight: '500',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.15s ease',
                                                    textTransform: 'capitalize',
                                                }}
                                            >
                                                Start from {align}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <input
                                type="text"
                                value={subInput}
                                onChange={e => setSubInput(e.target.value)}
                                placeholder={SUB_FORMATS.find(f => f.key === subFormat)?.placeholder}
                                style={inputBaseStyle}
                                onFocus={handleFocus}
                                onBlur={handleBlur}
                            />
                        </div>
                    </div>
                )}

                {inputMode === 'icrc1' && (
                    <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', color: theme.colors.secondaryText, marginBottom: '0.5rem', fontWeight: '500' }}>
                            ICRC-1 Account String
                        </label>
                        <textarea
                            value={icrc1Input}
                            onChange={e => setIcrc1Input(e.target.value)}
                            placeholder="e.g. k2t6j-2nvnp-4zjm3-...-6ae.0102030405060708"
                            rows={3}
                            style={{ ...inputBaseStyle, resize: 'vertical' }}
                            onFocus={handleFocus}
                            onBlur={handleBlur}
                            autoFocus
                        />
                        <div style={{ fontSize: '0.75rem', color: theme.colors.mutedText, marginTop: '0.4rem' }}>
                            Paste a full ICRC-1 account string (principal.checksum-subaccount), or just a plain principal
                        </div>
                    </div>
                )}

                {parsed.error && (
                    <div style={{
                        marginTop: '0.75rem',
                        padding: '0.6rem 0.9rem',
                        background: `${theme.colors.error}15`,
                        border: `1px solid ${theme.colors.error}40`,
                        borderRadius: '8px',
                        color: theme.colors.error,
                        fontSize: '0.85rem',
                    }}>
                        {parsed.error}
                    </div>
                )}
            </div>

            {/* Summary Card */}
            <div style={{
                ...cardStyle,
                opacity: summary ? 1 : 0.6,
                transition: 'opacity 0.2s ease',
            }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: '600', margin: '0 0 0.75rem 0', color: theme.colors.primaryText }}>
                    Account Summary
                </h2>

                {summary ? (
                    <div>
                        <SummaryRow
                            label="Principal"
                            value={summary.principalText}
                            field="s-principal"
                        />
                        <SummaryRow
                            label="Subaccount"
                            value={summary.hasNonDefaultSub
                                ? summary.subHex
                                : '(default \u2014 all zeros)'}
                            copyValue={summary.subHex}
                            field="s-subaccount"
                        />
                        <SummaryRow
                            label="ICRC-1 Account"
                            value={summary.icrc1Account}
                            field="s-icrc1"
                        />
                        <SummaryRow
                            label="Legacy Account ID"
                            value={summary.legacyAccountId}
                            field="s-legacy"
                        />
                    </div>
                ) : (
                    <div style={{
                        color: theme.colors.mutedText,
                        fontSize: '0.9rem',
                        textAlign: 'center',
                        padding: '2rem 0',
                    }}>
                        Enter a value above to see the account summary
                    </div>
                )}
            </div>
        </div>
    );
}

export default ToolsAccount;
