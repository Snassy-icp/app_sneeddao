// "Convert" on a ckBTC / ckETH / ckERC20 token card: opens /convert for that asset (BTC, ETH or
// the ERC-20 on Ethereum). Renders nothing for other tokens.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FaExchangeAlt } from 'react-icons/fa';
import { useTheme } from '../../contexts/ThemeContext';
import { ckAssetForLedger } from '../../utils/ckMinters';

export default function ConvertButton({ ledgerId }) {
    const { theme } = useTheme();
    const navigate = useNavigate();
    const asset = ckAssetForLedger(ledgerId);
    if (!asset) return null;
    return (
        <button type="button" title={`Convert between ${asset.symbol} and ${asset.native}`}
            onClick={(e) => { e.stopPropagation(); navigate(`/convert?asset=${asset.ledger}`); }}
            style={{ background: 'transparent', color: theme.colors.primaryText, border: `1px solid ${theme.colors.accent}`, borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <FaExchangeAlt size={12} /> Convert
        </button>
    );
}
