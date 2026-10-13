import React, { useState } from 'react';
import { FaCopy, FaCheck, FaExternalLinkAlt, FaSpinner, FaEye } from 'react-icons/fa';
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
 * - watch / onWatch: the arrival watch (see TransferArrivalWatch); the wizard polls ICPSwap and
 *   reports here when the transferred position shows up in the Sneed wallet
 */

/// The final check: once the user transferred on ICPSwap, the wizard keeps
/// asking the pool until the position is in the Sneed wallet. `watch` is
/// { status: 'idle' | 'watching' | 'arrived' | 'timeout', checks, arrived: [ids] }.
export function TransferArrivalWatch({ watch, onWatch, onStop, accentColor, compact = false }) {
    const { theme } = useTheme();
    const accent = accentColor || theme.colors.accent;
    if (!onWatch) return null;
    const btn = { display: 'inline-flex', alignItems: 'center', gap: 6, background: accent, color: '#fff', border: 'none', borderRadius: 8, padding: compact ? '6px 10px' : '8px 12px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 };
    const status = watch?.status || 'idle';
    return (
        <div style={{ marginTop: compact ? 8 : 12, fontSize: compact ? '0.82rem' : '0.88rem', color: theme.colors.secondaryText }}>
            {status === 'idle' && <button type="button" style={btn} onClick={(e) => { e.stopPropagation(); onWatch(); }}><FaEye size={12} /> Watch for it to arrive here</button>}
            {status === 'watching' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <FaSpinner className="health-spin" style={{ color: accent }} />
                    <span>Checking the pool every 15 seconds for a new position in your Sneed wallet{watch.checks ? ` (${watch.checks} check${watch.checks === 1 ? '' : 's'}, nothing new yet)` : '…'}</span>
                    {onStop && <button type="button" onClick={(e) => { e.stopPropagation(); onStop(); }} style={{ ...btn, background: 'transparent', color: theme.colors.mutedText, border: `1px solid ${theme.colors.border}` }}>Stop</button>}
                </div>
            )}
            {status === 'arrived' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: theme.colors.success || '#22c55e', fontWeight: 600 }}>
                    <FaCheck /> Position{watch.arrived.length === 1 ? '' : 's'} #{watch.arrived.join(', #')} arrived in your Sneed wallet{watch.arrived.length === 1 ? ' and is selected above' : ''}.
                </div>
            )}
            {status === 'timeout' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>Nothing new arrived in ten minutes. ICPSwap transfers land within seconds, so check the recipient principal on ICPSwap.</span>
                    <button type="button" style={btn} onClick={(e) => { e.stopPropagation(); onWatch(); }}><FaEye size={12} /> Watch again</button>
                </div>
            )}
            <style>{'@keyframes health-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .health-spin { animation: health-spin 1s linear infinite; }'}</style>
        </div>
    );
}
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

function PositionTransferGuide({ token0Symbol, token1Symbol, compact = false, accentColor, intro, watch, onWatch, onStopWatch }) {
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
                <li>Confirm on ICPSwap{onWatch ? ', then let this page watch for it' : ', then refresh here'}. The position stays yours.</li>
            </ol>
            <TransferArrivalWatch watch={watch} onWatch={onWatch} onStop={onStopWatch} accentColor={accent} compact={compact} />
        </div>
    );
}

export default PositionTransferGuide;
