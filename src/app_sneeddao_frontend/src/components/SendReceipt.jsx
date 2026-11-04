// The "sent" dialog after a token send: what went where, and each ledger block the send made with
// a link to it in the transaction explorer (/transaction). A send whose block is unknown shows no link.
import React from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { appAlert, settleAppDialog } from '../utils/appDialog';

export const transactionUrl = (ledger, blockIndex) => `/transaction?id=${String(blockIndex)}&ledger=${ledger}`;

/// `blocks`: [{ index, note? }] — `note` names the part of a send that took more than one transfer.
function SendReceipt({ amountText, symbol, recipient, verb, ledger, blocks }) {
    const { theme } = useTheme();
    return (
        <div>
            <div style={{ wordBreak: 'break-word' }}>
                {verb} {amountText} {symbol} to{' '}
                <span style={{ fontFamily: 'monospace', fontSize: '0.85em', wordBreak: 'break-all' }}>{recipient}</span>.
            </div>
            {blocks.map((b) => (
                <div key={String(b.index)} style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'baseline' }}>
                    <span style={{ color: theme.colors.secondaryText }}>Block #{String(b.index)}{b.note ? ` (${b.note})` : ''}</span>
                    {ledger && (
                        <Link to={transactionUrl(ledger, b.index)} onClick={() => settleAppDialog(undefined)}
                            style={{ color: theme.colors.accent, fontWeight: 600 }}>
                            View transaction
                        </Link>
                    )}
                </div>
            ))}
        </div>
    );
}

/// Show the receipt; resolves when it is closed.
export function showSendReceipt({ amountText, symbol, recipient, ledger, blocks = [], moved = false }) {
    const known = (blocks || []).filter((b) => b && b.index != null);
    return appAlert(
        <SendReceipt amountText={amountText} symbol={symbol} recipient={recipient} verb={moved ? 'Moved' : 'Sent'} ledger={ledger} blocks={known} />,
        { type: 'success', title: moved ? 'Moved' : 'Sent' },
    );
}
