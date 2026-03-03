import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Principal } from '@dfinity/principal';
import { encodeIcrcAccount, decodeIcrcAccount } from '@dfinity/ledger-icrc';
import { HttpAgent } from '@dfinity/agent';
import { useTheme } from '../contexts/ThemeContext';
import { computeAccountId } from '../utils/PrincipalUtils';
import { bytesToHex, isDefaultSubaccount } from '../utils/AccountParser';
import { FaCopy, FaCheck, FaKey, FaChevronDown, FaChevronUp, FaQuestionCircle, FaCoins, FaSpinner } from 'react-icons/fa';
import Header from '../components/Header';
import TokenSelector from '../components/TokenSelector';
import { createActor as createLedgerActor } from 'external/icrc1_ledger';

const accountPrimary = '#14b8a6';
const accountSecondary = '#2dd4bf';

const customStyles = `
@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-8px); }
}
.account-fade-in {
    animation: fadeInUp 0.5s ease-out forwards;
}
.account-float {
    animation: float 3s ease-in-out infinite;
}
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
.account-spin {
    animation: spin 1s linear infinite;
}
`;

// --- Subaccount conversion helpers ---

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

// Build a principal-derived subaccount: [length][principal_bytes][index_bytes]
const principalWithIndexToSubaccount = (principalStr, indexFormat, indexValue) => {
    try {
        const principal = Principal.fromText(principalStr.trim());
        const principalBytes = principal.toUint8Array();
        const length = principalBytes.length;
        if (length > 30) return null;

        const subaccount = new Uint8Array(32);
        subaccount[0] = length;
        subaccount.set(principalBytes, 1);

        const available = 32 - 1 - length;
        if (available > 0 && indexValue && indexValue.trim()) {
            const idxBytes = indexToBytes(indexFormat, indexValue, available);
            if (!idxBytes) return null;
            subaccount.set(idxBytes, 1 + length);
        }

        return subaccount;
    } catch {
        return null;
    }
};

// Convert an index value to a fixed-length byte array (right-aligned / big-endian)
const indexToBytes = (format, value, len) => {
    if (!value || !value.trim()) return new Uint8Array(len);
    const v = value.trim();
    switch (format) {
        case 'number': {
            try {
                const n = BigInt(v);
                if (n < 0n) return null;
                const bytes = new Uint8Array(len);
                let val = n;
                for (let i = len - 1; i >= 0 && val > 0n; i--) {
                    bytes[i] = Number(val & 0xFFn);
                    val >>= 8n;
                }
                if (val > 0n) return null;
                return bytes;
            } catch {
                return null;
            }
        }
        case 'hex': {
            let clean = v.replace(/^0x/i, '').replace(/[\s-]/g, '');
            if (!/^[0-9a-fA-F]*$/.test(clean)) return null;
            if (clean.length > len * 2) return null;
            clean = clean.padStart(len * 2, '0');
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
            }
            return bytes;
        }
        case 'bytes': {
            const parts = v.split(',').map(s => s.trim()).filter(s => s !== '');
            if (parts.length > len) return null;
            const values = [];
            for (const p of parts) {
                const num = parseInt(p, 10);
                if (isNaN(num) || num < 0 || num > 255) return null;
                values.push(num);
            }
            const bytes = new Uint8Array(len);
            const offset = len - values.length;
            for (let i = 0; i < values.length; i++) bytes[offset + i] = values[i];
            return bytes;
        }
        default:
            return new Uint8Array(len);
    }
};

// Try to interpret a 32-byte subaccount as [length][principal][index]
const subaccountToPrincipalInfo = (subaccount) => {
    if (!subaccount || subaccount.length !== 32) return null;
    const length = subaccount[0];
    if (length === 0 || length > 29) return null;
    const principalBytes = subaccount.slice(1, 1 + length);
    try {
        const principal = Principal.fromUint8Array(principalBytes);
        // Verify round-trip: encoding back should give the same bytes
        const reEncoded = principal.toUint8Array();
        if (reEncoded.length !== length) return null;
        for (let i = 0; i < length; i++) {
            if (reEncoded[i] !== principalBytes[i]) return null;
        }

        const indexSlice = subaccount.slice(1 + length);
        const hasIndex = indexSlice.some(b => b !== 0);
        let indexNumber = 0n;
        for (const b of indexSlice) indexNumber = (indexNumber << 8n) | BigInt(b);

        return {
            principalText: principal.toText(),
            indexBytes: indexSlice,
            indexHex: bytesToHex(indexSlice).replace(/^0+/, '') || '0',
            indexNumber: indexNumber.toString(),
            hasIndex,
            availableBytes: indexSlice.length,
        };
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
    { key: 'hex', label: 'Hex String', placeholder: 'e.g. 0x01 or a1b2c3', desc: 'Hexadecimal string, right-aligned (zero-padded on the left)' },
    { key: 'number', label: 'Number', placeholder: 'e.g. 1 or 123456789', desc: 'Decimal integer, encoded as big-endian bytes (right-aligned)' },
    { key: 'text', label: 'Text', placeholder: 'e.g. my-account', desc: 'UTF-8 text, left-aligned in 32 bytes' },
    { key: 'bytes', label: 'Byte Array', placeholder: 'e.g. 0, 0, 0, 1', desc: 'Comma-separated byte values (0-255)' },
    { key: 'principal', label: 'Principal', placeholder: 'e.g. rrkah-fqaaa-aaaaa-aaaaq-cai', desc: 'Principal encoded as subaccount: [length][principal_bytes][index]' },
];

const INDEX_FORMATS = [
    { key: 'number', label: 'Number', placeholder: 'e.g. 0 or 42' },
    { key: 'hex', label: 'Hex', placeholder: 'e.g. 0x01 or ff' },
    { key: 'bytes', label: 'Bytes', placeholder: 'e.g. 0, 1' },
];

function ToolsAccount() {
    const { theme } = useTheme();

    const [inputMode, setInputMode] = useState('principal');
    const [principalInput, setPrincipalInput] = useState('');
    const [principal2Input, setPrincipal2Input] = useState('');
    const [subFormat, setSubFormat] = useState('hex');
    const [subInput, setSubInput] = useState('');
    const [byteAlign, setByteAlign] = useState('right');
    const [icrc1Input, setIcrc1Input] = useState('');
    const [copiedField, setCopiedField] = useState(null);

    // Principal-as-subaccount index state
    const [indexFormat, setIndexFormat] = useState('number');
    const [indexInput, setIndexInput] = useState('');

    const [showHelp, setShowHelp] = useState(false);

    // Token balance lookup
    const [selectedToken, setSelectedToken] = useState('');
    const [tokenMeta, setTokenMeta] = useState(null); // { symbol, decimals }
    const [balance, setBalance] = useState(null);
    const [balanceLoading, setBalanceLoading] = useState(false);
    const balanceFetchId = useRef(0);

    const handleCopy = useCallback(async (text, field) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(field);
            setTimeout(() => setCopiedField(null), 1500);
        } catch { /* ignore */ }
    }, []);

    // How many index bytes are available for the current principal-as-subaccount input
    const availableIndexBytes = useMemo(() => {
        if (subFormat !== 'principal' || !subInput.trim()) return 0;
        try {
            const p = Principal.fromText(subInput.trim());
            return 32 - 1 - p.toUint8Array().length;
        } catch {
            return 0;
        }
    }, [subFormat, subInput]);

    const resolveSubaccount = useCallback((format, value, alignment, idxFmt, idxVal) => {
        if (!value || !value.trim()) return null;
        const v = value.trim();
        switch (format) {
            case 'number': return numberToSubaccount(v);
            case 'text': return textToSubaccount(v);
            case 'hex': return hexToSubaccount(v);
            case 'bytes': return byteArrayToSubaccount(v, alignment);
            case 'principal': return principalWithIndexToSubaccount(v, idxFmt, idxVal);
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
                subaccount = resolveSubaccount(subFormat, subInput, byteAlign, indexFormat, indexInput);
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
    }, [inputMode, principalInput, principal2Input, subFormat, subInput, byteAlign, indexFormat, indexInput, icrc1Input, resolveSubaccount]);

    const summary = useMemo(() => {
        if (!parsed.principal) return null;

        const principalText = parsed.principal.toText();
        const subBytes = parsed.subaccount || new Uint8Array(32);
        const hasNonDefaultSub = parsed.subaccount != null && !isDefaultSubaccount(parsed.subaccount);
        const subHex = bytesToHex(subBytes);
        const subBytesStr = Array.from(subBytes).join(', ');

        // Try to interpret subaccount as principal + index
        const subAsPrincipal = hasNonDefaultSub ? subaccountToPrincipalInfo(subBytes) : null;

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

        return { principalText, subHex, subBytesStr, hasNonDefaultSub, subAsPrincipal, icrc1Account, legacyAccountId };
    }, [parsed]);

    // Fetch balance when principal/subaccount/token changes
    useEffect(() => {
        if (!parsed.principal || !selectedToken) {
            setBalance(null);
            setTokenMeta(null);
            return;
        }

        const fetchId = ++balanceFetchId.current;
        setBalanceLoading(true);
        setBalance(null);

        (async () => {
            try {
                const host = process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging'
                    ? 'https://ic0.app' : 'http://localhost:4943';
                const agent = new HttpAgent({ host });
                if (process.env.DFX_NETWORK !== 'ic' && process.env.DFX_NETWORK !== 'staging') {
                    await agent.fetchRootKey();
                }

                const ledger = createLedgerActor(selectedToken, { agent });
                const subBytes = parsed.subaccount && !isDefaultSubaccount(parsed.subaccount)
                    ? parsed.subaccount : null;
                const account = {
                    owner: parsed.principal,
                    subaccount: subBytes ? [Array.from(subBytes)] : [],
                };

                const [bal, dec, sym] = await Promise.all([
                    ledger.icrc1_balance_of(account),
                    ledger.icrc1_decimals(),
                    ledger.icrc1_symbol(),
                ]);

                if (fetchId !== balanceFetchId.current) return;
                setBalance(BigInt(bal));
                setTokenMeta({ decimals: Number(dec), symbol: sym });
            } catch (err) {
                if (fetchId !== balanceFetchId.current) return;
                console.error('Balance fetch error:', err);
                setBalance(null);
                setTokenMeta(null);
            } finally {
                if (fetchId === balanceFetchId.current) setBalanceLoading(false);
            }
        })();
    }, [parsed.principal, parsed.subaccount, selectedToken]);

    const formattedBalance = useMemo(() => {
        if (balance === null || !tokenMeta) return null;
        const divisor = 10 ** tokenMeta.decimals;
        const whole = balance / BigInt(divisor);
        const frac = balance % BigInt(divisor);
        const fracStr = frac.toString().padStart(tokenMeta.decimals, '0').replace(/0+$/, '');
        return fracStr ? `${whole}.${fracStr}` : whole.toString();
    }, [balance, tokenMeta]);

    // --- Styles ---

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

    const labelStyle = {
        display: 'block',
        fontSize: '0.85rem',
        color: theme.colors.secondaryText,
        marginBottom: '0.5rem',
        fontWeight: '500',
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

    const SummaryRow = ({ label, value, copyValue, field, indent = false }) => {
        const cv = copyValue || value;
        return (
            <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '0.6rem 0',
                paddingLeft: indent ? '1rem' : 0,
                borderBottom: `1px solid ${theme.colors.border}20`,
            }}>
                <span style={{
                    fontSize: indent ? '0.75rem' : '0.8rem',
                    color: theme.colors.mutedText,
                    minWidth: indent ? '90px' : '110px',
                    paddingTop: '2px',
                    fontWeight: '500',
                    flexShrink: 0,
                }}>
                    {label}
                </span>
                <span style={{
                    flex: 1,
                    fontFamily: 'monospace',
                    fontSize: indent ? '0.8rem' : '0.85rem',
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

    const SubFormatBtn = ({ fmt, isActive, onClick }) => (
        <button
            onClick={onClick}
            style={{
                padding: '0.45rem 0.85rem',
                borderRadius: '8px',
                border: `1px solid ${isActive ? theme.colors.accent : theme.colors.border}`,
                background: isActive ? `${theme.colors.accent}20` : 'transparent',
                color: isActive ? theme.colors.accent : theme.colors.secondaryText,
                fontSize: '0.8rem',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
            }}
        >
            {fmt.label}
        </button>
    );

    return (
        <div className="page-container" style={{ background: theme.colors.primaryGradient, minHeight: '100vh' }}>
            <style>{customStyles}</style>
            <Header />

            {/* Hero Banner */}
            <div style={{
                background: `linear-gradient(135deg, ${theme.colors.primaryBg} 0%, ${accountPrimary}12 50%, ${accountSecondary}08 100%)`,
                borderBottom: `1px solid ${theme.colors.border}`,
                padding: '2rem 1rem',
                position: 'relative',
                overflow: 'hidden',
                width: '100%',
                boxSizing: 'border-box',
            }}>
                <div style={{
                    position: 'absolute',
                    top: '-50%',
                    right: '-5%',
                    width: '300px',
                    height: '300px',
                    background: `radial-gradient(circle, ${accountPrimary}15 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />
                <div style={{
                    position: 'absolute',
                    bottom: '-40%',
                    left: '10%',
                    width: '200px',
                    height: '200px',
                    background: `radial-gradient(circle, ${accountSecondary}10 0%, transparent 70%)`,
                    pointerEvents: 'none',
                }} />

                <div className="account-fade-in" style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
                    <div className="account-float" style={{
                        width: '56px',
                        height: '56px',
                        borderRadius: '14px',
                        background: `linear-gradient(135deg, ${accountPrimary}, ${accountSecondary})`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 0.75rem',
                        boxShadow: `0 10px 30px ${accountPrimary}40`,
                    }}>
                        <FaKey size={22} style={{ color: '#fff' }} />
                    </div>
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: `${accountPrimary}20`,
                        color: accountPrimary,
                        padding: '5px 14px',
                        borderRadius: '20px',
                        fontSize: '0.78rem',
                        fontWeight: '600',
                        marginBottom: '0.5rem',
                    }}>
                        <FaKey size={10} /> Free Tool
                    </div>
                    <h1 style={{
                        fontSize: '1.75rem',
                        fontWeight: '700',
                        color: theme.colors.primaryText,
                        margin: '0.5rem 0',
                        letterSpacing: '-0.5px',
                    }}>
                        Account Tool
                    </h1>
                    <p style={{
                        color: theme.colors.secondaryText,
                        fontSize: '0.95rem',
                        maxWidth: '550px',
                        margin: '0 auto',
                        lineHeight: '1.6',
                    }}>
                        Convert between ICP account formats — principals, subaccounts, ICRC-1 accounts, and legacy account identifiers
                    </p>
                </div>
            </div>

            <main style={{ maxWidth: '800px', margin: '0 auto', padding: '1.5rem 1rem', color: theme.colors.primaryText }}>

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
                            <label style={labelStyle}>Principal</label>
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
                            <div>
                                <label style={labelStyle}>Principal</label>
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
                                <label style={labelStyle}>Subaccount Format</label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    {SUB_FORMATS.map(fmt => (
                                        <SubFormatBtn
                                            key={fmt.key}
                                            fmt={fmt}
                                            isActive={subFormat === fmt.key}
                                            onClick={() => { setSubFormat(fmt.key); setSubInput(''); setIndexInput(''); }}
                                        />
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
                                        {subFormat === 'principal' ? 'Subaccount Principal' : 'Subaccount Value'}
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

                            {/* Index input - only for Principal subaccount format */}
                            {subFormat === 'principal' && availableIndexBytes > 0 && (
                                <div style={{
                                    padding: '1rem',
                                    background: theme.colors.primaryBg,
                                    borderRadius: '10px',
                                    border: `1px solid ${theme.colors.border}`,
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                        <label style={{ fontSize: '0.85rem', color: theme.colors.secondaryText, fontWeight: '500' }}>
                                            Index
                                            <span style={{ fontWeight: '400', fontSize: '0.75rem', color: theme.colors.mutedText, marginLeft: '0.5rem' }}>
                                                ({availableIndexBytes} byte{availableIndexBytes !== 1 ? 's' : ''} available)
                                            </span>
                                        </label>
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            {INDEX_FORMATS.map(fmt => (
                                                <button
                                                    key={fmt.key}
                                                    onClick={() => { setIndexFormat(fmt.key); setIndexInput(''); }}
                                                    style={{
                                                        padding: '0.25rem 0.6rem',
                                                        borderRadius: '6px',
                                                        border: `1px solid ${indexFormat === fmt.key ? theme.colors.accent : theme.colors.border}`,
                                                        background: indexFormat === fmt.key ? `${theme.colors.accent}20` : 'transparent',
                                                        color: indexFormat === fmt.key ? theme.colors.accent : theme.colors.mutedText,
                                                        fontSize: '0.72rem',
                                                        fontWeight: '500',
                                                        cursor: 'pointer',
                                                        transition: 'all 0.15s ease',
                                                    }}
                                                >
                                                    {fmt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <input
                                        type="text"
                                        value={indexInput}
                                        onChange={e => setIndexInput(e.target.value)}
                                        placeholder={INDEX_FORMATS.find(f => f.key === indexFormat)?.placeholder}
                                        style={{ ...inputBaseStyle, fontSize: '0.85rem' }}
                                        onFocus={handleFocus}
                                        onBlur={handleBlur}
                                    />
                                    <div style={{ fontSize: '0.7rem', color: theme.colors.mutedText, marginTop: '0.35rem' }}>
                                        Unused bytes after the principal in the subaccount. Defaults to zero.
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {inputMode === 'icrc1' && (
                        <div>
                            <label style={labelStyle}>ICRC-1 Account String</label>
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
                            <SummaryRow label="Principal" value={summary.principalText} field="s-principal" />

                            {/* Subaccount section header */}
                            <div style={{
                                fontSize: '0.8rem',
                                fontWeight: '600',
                                color: theme.colors.secondaryText,
                                padding: '0.75rem 0 0.25rem 0',
                                borderBottom: `1px solid ${theme.colors.border}20`,
                            }}>
                                Subaccount {!summary.hasNonDefaultSub && (
                                    <span style={{ fontWeight: '400', color: theme.colors.mutedText }}>(default — all zeros)</span>
                                )}
                            </div>
                            <SummaryRow
                                label="Hex"
                                value={summary.subHex}
                                field="s-sub-hex"
                                indent
                            />
                            <SummaryRow
                                label="Bytes"
                                value={summary.subBytesStr}
                                copyValue={summary.subBytesStr}
                                field="s-sub-bytes"
                                indent
                            />
                            {summary.subAsPrincipal ? (
                                <SummaryRow
                                    label="As Principal"
                                    value={
                                        summary.subAsPrincipal.hasIndex
                                            ? `${summary.subAsPrincipal.principalText} (index: ${summary.subAsPrincipal.indexNumber})`
                                            : summary.subAsPrincipal.principalText
                                    }
                                    copyValue={summary.subAsPrincipal.principalText}
                                    field="s-sub-principal"
                                    indent
                                />
                            ) : summary.hasNonDefaultSub && (
                                <div style={{
                                    padding: '0.5rem 0 0.5rem 1rem',
                                    fontSize: '0.75rem',
                                    color: theme.colors.mutedText,
                                    fontStyle: 'italic',
                                    borderBottom: `1px solid ${theme.colors.border}20`,
                                }}>
                                    Not interpretable as a principal-derived subaccount
                                </div>
                            )}

                            <SummaryRow label="ICRC-1 Account" value={summary.icrc1Account} field="s-icrc1" />
                            <SummaryRow label="Legacy Account ID" value={summary.legacyAccountId} field="s-legacy" />
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

                {/* Token Balance Lookup */}
                {summary && (
                    <div style={cardStyle}>
                        <h2 style={{ fontSize: '1.1rem', fontWeight: '600', margin: '0 0 0.75rem 0', color: theme.colors.primaryText, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <FaCoins size={16} style={{ color: accountPrimary }} />
                            Token Balance
                        </h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <div>
                                <label style={labelStyle}>Token</label>
                                <TokenSelector
                                    value={selectedToken}
                                    onChange={setSelectedToken}
                                    placeholder="Select a token to check balance..."
                                    allowCustom
                                    style={{ maxWidth: 'none' }}
                                />
                            </div>
                            {selectedToken && (
                                <div style={{
                                    padding: '0.75rem 1rem',
                                    background: theme.colors.primaryBg,
                                    borderRadius: '10px',
                                    border: `1px solid ${theme.colors.border}`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    minHeight: '44px',
                                }}>
                                    <span style={{ fontSize: '0.82rem', color: theme.colors.mutedText, fontWeight: '500' }}>
                                        Balance
                                    </span>
                                    {balanceLoading ? (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.colors.mutedText, fontSize: '0.9rem' }}>
                                            <FaSpinner size={14} className="account-spin" /> Loading...
                                        </span>
                                    ) : formattedBalance !== null ? (
                                        <span style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                            {formattedBalance} <span style={{ fontWeight: '500', fontSize: '0.85rem', color: theme.colors.secondaryText }}>{tokenMeta?.symbol}</span>
                                        </span>
                                    ) : (
                                        <span style={{ color: theme.colors.mutedText, fontSize: '0.85rem' }}>
                                            {selectedToken ? 'Unable to fetch balance' : '\u2014'}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Expandable Help Section */}
                <div style={{
                    ...cardStyle,
                    cursor: 'pointer',
                    userSelect: 'none',
                }}>
                    <div
                        onClick={() => setShowHelp(!showHelp)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <FaQuestionCircle size={16} style={{ color: accountPrimary, flexShrink: 0 }} />
                            <span style={{ fontSize: '1rem', fontWeight: '600', color: theme.colors.primaryText }}>
                                Understanding ICP Account Formats
                            </span>
                        </div>
                        {showHelp
                            ? <FaChevronUp size={14} style={{ color: theme.colors.mutedText }} />
                            : <FaChevronDown size={14} style={{ color: theme.colors.mutedText }} />
                        }
                    </div>

                    {showHelp && (
                        <div style={{
                            marginTop: '1.25rem',
                            fontSize: '0.88rem',
                            lineHeight: '1.7',
                            color: theme.colors.secondaryText,
                        }}>
                            <HelpSection theme={theme} />
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

function HelpSection({ theme }) {
    const headingStyle = {
        fontSize: '1rem',
        fontWeight: '600',
        color: theme.colors.primaryText,
        margin: '1.5rem 0 0.5rem 0',
    };
    const firstHeadingStyle = { ...headingStyle, marginTop: '0' };
    const codeStyle = {
        fontFamily: 'monospace',
        fontSize: '0.82rem',
        background: theme.colors.primaryBg,
        padding: '2px 6px',
        borderRadius: '4px',
        wordBreak: 'break-all',
    };
    const blockStyle = {
        background: theme.colors.primaryBg,
        border: `1px solid ${theme.colors.border}`,
        borderRadius: '8px',
        padding: '0.75rem 1rem',
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        lineHeight: '1.6',
        margin: '0.5rem 0',
        overflowX: 'auto',
        wordBreak: 'break-all',
    };
    const noteStyle = {
        background: `${theme.colors.accent}10`,
        border: `1px solid ${theme.colors.accent}30`,
        borderRadius: '8px',
        padding: '0.75rem 1rem',
        margin: '0.75rem 0',
        fontSize: '0.85rem',
    };

    return (
        <>
            {/* Overview */}
            <h3 style={firstHeadingStyle}>Overview</h3>
            <p>
                The Internet Computer uses two different account systems. Understanding
                when to use each is important for safely sending and receiving tokens.
            </p>

            {/* ICRC-1 Accounts */}
            <h3 style={headingStyle}>ICRC-1 Accounts (Modern Standard)</h3>
            <p>
                An ICRC-1 account is a pair of two values: an <strong>owner</strong> (a principal)
                and an optional <strong>subaccount</strong> (a 32-byte identifier). If the
                subaccount is omitted or all zeros, it is the principal's <em>default account</em>.
            </p>
            <div style={blockStyle}>
                Account = {'{'} owner: principal; subaccount: opt blob {'}'}<br />
                Subaccount = 32 bytes (256 bits)
            </div>
            <p>
                Because the principal and subaccount are stored directly (not hashed), you can
                always see exactly who owns an account and which subaccount it belongs to. A single
                principal can have up to 2<sup>256</sup> different accounts by varying the subaccount.
            </p>
            <p>
                <strong>Textual representation:</strong> When an ICRC-1 account has a non-default
                subaccount, it is encoded as <span style={codeStyle}>principal.checksum-subaccount</span> —
                for example:
            </p>
            <div style={blockStyle}>
                k2t6j-2nvnp-4zjm3-25dtz-6xhaa-c7boj-5gayf-oj3xs-i43lp-teber-6ae.1
            </div>
            <p>
                If the subaccount is the default (all zeros), the textual form is just the
                principal text by itself.
            </p>
            <div style={noteStyle}>
                <strong>When to use:</strong> ICRC-1 accounts are used throughout the ICP ecosystem —
                SNS tokens, DeFi protocols, DEXes, wallets, dapps, and canister-to-canister
                transfers. <strong>Use ICRC-1 for everything unless a service specifically asks
                for a legacy Account ID.</strong>
            </div>

            {/* Legacy Account IDs */}
            <h3 style={headingStyle}>Legacy Account Identifiers</h3>
            <p>
                The original ICP ledger (predating the ICRC standards) uses a different format
                called an <strong>Account Identifier</strong>. It is a 32-byte value displayed as
                a 64-character hex string, computed as:
            </p>
            <div style={blockStyle}>
                h = SHA-224("\x0Aaccount-id" || principal_bytes || subaccount_bytes)<br />
                Account ID = CRC32(h) || h &nbsp;&nbsp;→&nbsp;&nbsp;32 bytes (64 hex chars)
            </div>
            <p>
                Because it is a one-way hash, <strong>a legacy Account ID cannot be converted back
                to a principal or subaccount</strong>. This provides a degree of anonymity — you
                cannot tell who owns an account just by looking at the identifier — but it also
                means there is no way to recover the original principal from a legacy Account ID.
            </p>
            <div style={noteStyle}>
                <strong>One-way conversion:</strong> Any ICRC-1 account (principal + subaccount) can be
                converted to a legacy Account ID, as this tool does. However, the reverse is
                impossible — you cannot derive the principal or subaccount from a legacy Account ID.
            </div>
            <div style={noteStyle}>
                <strong>When to use:</strong> Legacy Account IDs are primarily used by centralized
                exchanges (CEXes) such as Coinbase, Binance, and others for ICP deposits and
                withdrawals. If an exchange asks for your "Account ID" or shows you a
                64-character hex string, that is a legacy Account Identifier. For everything else
                on the IC, prefer ICRC-1 accounts.
            </div>

            {/* Subaccounts */}
            <h3 style={headingStyle}>Subaccounts</h3>
            <p>
                A subaccount is a 32-byte (256-bit) value that distinguishes multiple accounts
                under the same principal. The all-zeros subaccount is the <em>default</em> and
                is usually omitted. Subaccounts can be created from various input formats:
            </p>
            <ul style={{ paddingLeft: '1.25rem', margin: '0.5rem 0' }}>
                <li>
                    <strong>Hex String</strong> — Raw hexadecimal bytes, right-aligned (zero-padded on the left).
                    This is the most common format in developer documentation and blockchain explorers.
                </li>
                <li style={{ marginTop: '0.35rem' }}>
                    <strong>Number</strong> — A decimal integer encoded as big-endian bytes, right-aligned.
                    For example, subaccount <span style={codeStyle}>1</span> is 31 zero bytes followed
                    by <span style={codeStyle}>0x01</span>.
                </li>
                <li style={{ marginTop: '0.35rem' }}>
                    <strong>Text</strong> — A UTF-8 string placed left-aligned in the 32 bytes.
                    Useful for human-readable named subaccounts.
                </li>
                <li style={{ marginTop: '0.35rem' }}>
                    <strong>Byte Array</strong> — Comma-separated decimal byte values (0-255).
                    Can be aligned from the left or right of the 32-byte array.
                </li>
                <li style={{ marginTop: '0.35rem' }}>
                    <strong>Principal</strong> — A principal encoded into a subaccount using the
                    standard layout described below.
                </li>
            </ul>

            {/* Principal-derived subaccounts */}
            <h3 style={headingStyle}>Principal-Derived Subaccounts</h3>
            <p>
                A common pattern on the IC is to derive a subaccount from a principal.
                This is used, for example, when a canister needs to hold funds on behalf of a
                specific user — it creates a subaccount from that user's principal. The standard
                byte layout is:
            </p>
            <div style={blockStyle}>
                Byte 0: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;length of principal bytes (1 byte)<br />
                Bytes 1..N: &nbsp;&nbsp;principal bytes<br />
                Bytes N+1..31: index / unused (zero by default)
            </div>
            <p>
                For a typical user principal (29 bytes), this leaves 2 bytes of unused space at the
                end. For a canister principal (10 bytes), there are 21 unused bytes. These trailing
                bytes can be used as an <strong>index</strong> to generate multiple subaccounts from the
                same principal — for example, a canister could create subaccounts 0, 1, 2, … for
                a given user by varying the index.
            </p>
            <p>
                This tool's "Principal" subaccount format lets you enter both the principal and
                an optional index value to fill those trailing bytes.
            </p>

            {/* Summary table */}
            <h3 style={headingStyle}>Quick Comparison</h3>
            <div style={{ overflowX: 'auto' }}>
                <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.82rem',
                    margin: '0.5rem 0',
                }}>
                    <thead>
                        <tr style={{ borderBottom: `2px solid ${theme.colors.border}` }}>
                            <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: theme.colors.primaryText }}>Feature</th>
                            <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: theme.colors.primaryText }}>ICRC-1 Account</th>
                            <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: theme.colors.primaryText }}>Legacy Account ID</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[
                            ['Format', 'Principal + Subaccount', '64-char hex string (32 bytes)'],
                            ['Reversible', 'Yes — principal & subaccount visible', 'No — one-way SHA-224 hash'],
                            ['Privacy', 'Transparent (owner is visible)', 'Pseudo-anonymous (hash hides owner)'],
                            ['Used by', 'SNS tokens, DeFi, DEXes, dapps', 'CEXes (Coinbase, Binance, etc.)'],
                            ['Standard', 'ICRC-1 (modern)', 'ICP Ledger (legacy, pre-ICRC)'],
                            ['Convert to other?', 'Can compute legacy Account ID', 'Cannot recover ICRC-1 account'],
                            ['Default account', 'Subaccount = all zeros (omitted)', 'SHA-224 of principal + 32 zero bytes'],
                        ].map(([feature, icrc1, legacy], i) => (
                            <tr key={i} style={{ borderBottom: `1px solid ${theme.colors.border}30` }}>
                                <td style={{ padding: '0.5rem 0.75rem', fontWeight: '500', color: theme.colors.primaryText }}>{feature}</td>
                                <td style={{ padding: '0.5rem 0.75rem' }}>{icrc1}</td>
                                <td style={{ padding: '0.5rem 0.75rem' }}>{legacy}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Practical advice */}
            <h3 style={headingStyle}>Practical Advice</h3>
            <ul style={{ paddingLeft: '1.25rem', margin: '0.5rem 0' }}>
                <li>
                    <strong>Sending to/from a CEX:</strong> Use the <em>Legacy Account ID</em>.
                    Exchanges typically show you a 64-character hex string as your deposit address.
                </li>
                <li style={{ marginTop: '0.35rem' }}>
                    <strong>Everything else on the IC:</strong> Use the <em>ICRC-1 account</em> format.
                    This includes sending tokens between wallets, interacting with DeFi
                    protocols, trading on DEXes, and any canister interaction.
                </li>
                <li style={{ marginTop: '0.35rem' }}>
                    <strong>Double-check the format:</strong> If an address is a 64-character hex
                    string, it's a legacy Account ID. If it looks like a principal (groups of
                    lowercase letters and numbers separated by dashes, optionally
                    with <span style={codeStyle}>.checksum-hex</span>), it's an ICRC-1 account.
                </li>
                <li style={{ marginTop: '0.35rem' }}>
                    <strong>Subaccount = 0:</strong> If you don't specify a subaccount, you're
                    using the default account. This is the most common case for regular users.
                </li>
            </ul>
        </>
    );
}

export default ToolsAccount;
