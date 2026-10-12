import React, { useState } from 'react';
import { FaCopy, FaCheck, FaExternalLinkAlt } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';

/**
 * Step-by-step instructions for moving an ICPSwap liquidity position into the
 * user's Sneed wallet (i.e. transferring it on ICPSwap to the principal they
 * are logged in with here).
 *
 * Props:
 * - token0Symbol, token1Symbol: the pair, used in the wording
 * - compact: smaller spacing, for use inside cards and expanders
 * - accentColor: link / button colour (defaults to the theme accent)
 * - intro: optional text shown above the steps (defaults to a short explanation)
 */
export function WalletPrincipalBox({ compact = false, accentColor }) {
    const { theme } = useTheme();
    const { identity } = useAuth();
    const [copied, setCopied] = useState(false);
    const accent = accentColor || theme.colors.accent;
    const pid = identity ? identity.getPrincipal().toText() : '';

    const copy = async (e) => {
        e?.stopPropagation?.();
        try {
            await navigator.clipboard.writeText(pid);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (err) {
            console.warn('Clipboard unavailable', err);
        }
    };

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
            padding: compact ? '6px 10px' : '10px 12px',
            background: theme.colors.secondaryBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '10px',
        }}>
            <code style={{ fontFamily: 'monospace', fontSize: compact ? '0.8rem' : '0.9rem', color: theme.colors.primaryText, wordBreak: 'break-all', flex: 1, minWidth: 0 }}>
                {pid || 'Log in to see your wallet principal'}
            </code>
            {pid && (
                <button
                    type="button"
                    onClick={copy}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0,
                        background: copied ? theme.colors.success : accent, color: 'white', border: 'none',
                        borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                    }}
                >
                    {copied ? <FaCheck size={11} /> : <FaCopy size={11} />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
            )}
        </div>
    );
}

function PositionTransferGuide({ token0Symbol, token1Symbol, compact = false, accentColor, intro }) {
    const { theme } = useTheme();
    const accent = accentColor || theme.colors.accent;
    const pair = token0Symbol && token1Symbol ? `${token0Symbol}/${token1Symbol}` : 'liquidity';
    const introText = intro === undefined
        ? 'Positions you created on ICPSwap belong to your ICPSwap login. To see and lock one here, transfer it to the principal you are logged in with on this site:'
        : intro;

    return (
        <div style={{ fontSize: compact ? '0.85rem' : '0.9rem', color: theme.colors.primaryText, lineHeight: 1.5 }}>
            {introText && <p style={{ margin: '0 0 6px 0' }}>{introText}</p>}
            <ol style={{ margin: 0, paddingLeft: '1.3rem', display: 'grid', gap: compact ? '4px' : '8px' }}>
                <li>
                    Open ICPSwap and go to <strong>Liquidity</strong>{' '}
                    <a href="https://app.icpswap.com/liquidity" target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: accent, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        app.icpswap.com/liquidity <FaExternalLinkAlt size={10} />
                    </a>
                </li>
                <li>Find your <strong>{pair}</strong> position and open its <strong>Details</strong>.</li>
                <li>Choose <strong>Transfer position</strong>.</li>
                <li>
                    <div style={{ marginBottom: '6px' }}>Paste your Sneed wallet principal as the recipient:</div>
                    <WalletPrincipalBox compact={compact} accentColor={accent} />
                </li>
                <li>Confirm on ICPSwap, then refresh here. The position stays yours.</li>
            </ol>
        </div>
    );
}

export default PositionTransferGuide;
