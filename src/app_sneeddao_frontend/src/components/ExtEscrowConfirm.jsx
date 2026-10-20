// The confirm screen shown before Sneed Hub sends EXT cards to a Sneedex offer's escrow account.
// useExtEscrowConfirm() returns [confirm, modal]: `confirm(info)` opens the screen and resolves
// true / false; render `modal` somewhere in the page.
import React, { useCallback, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { ExtBadge } from './NftAssetView';

export function useExtEscrowConfirm() {
    const { theme } = useTheme();
    const [info, setInfo] = useState(null);
    const resolver = useRef(null);
    const confirm = useCallback((i) => new Promise((resolve) => { resolver.current = resolve; setInfo(i); }), []);
    const answer = (yes) => { const r = resolver.current; resolver.current = null; setInfo(null); r?.(yes); };
    const modal = info ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div role="dialog" aria-modal="true" style={{ background: theme.colors.cardBg, color: theme.colors.primaryText, border: `1px solid ${theme.colors.border}`, borderRadius: 14, maxWidth: 560, width: '100%', padding: 20, boxShadow: '0 10px 40px rgba(0,0,0,0.4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '1.05rem', marginBottom: 12 }}>
                    <ExtBadge /> Send {info.toSend.length === 1 ? 'this card' : `${info.toSend.length} cards`} to escrow?
                </div>
                <div style={{ fontSize: '0.9rem', lineHeight: 1.5, color: theme.colors.secondaryText }}>
                    Sneed Hub will send {info.toSend.length === 1 ? 'card' : 'cards'} <b style={{ color: theme.colors.primaryText }}>#{info.toSend.join(', #')}</b> of{' '}
                    <b style={{ color: theme.colors.primaryText }}>{info.collectionName || info.collectionId}</b> to Sneedex's escrow account for offer <b style={{ color: theme.colors.primaryText }}>#{String(info.offerId)}</b>:
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all', margin: '10px 0', padding: '8px 10px', borderRadius: 8, background: theme.colors.secondaryBg, border: `1px solid ${theme.colors.border}` }}>{info.escrowAid}</div>
                <ul style={{ fontSize: '0.85rem', lineHeight: 1.5, color: theme.colors.secondaryText, paddingLeft: 18, margin: '0 0 12px' }}>
                    <li>This is an EXT transfer from your wallet, recorded by the collection ({info.collectionId}). It is public, like everything on the Internet Computer.</li>
                    <li>Only Sneedex can move the card out of that account: to the buyer if the offer sells, back to you if you cancel or it expires.</li>
                    {info.already?.length > 0 && <li>Already in escrow (not sent again): #{info.already.join(', #')}.</li>}
                </ul>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => answer(false)} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${theme.colors.border}`, background: theme.colors.secondaryBg, color: theme.colors.primaryText, cursor: 'pointer' }}>Cancel</button>
                    <button type="button" onClick={() => answer(true)} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: theme.colors.accent, color: theme.colors.primaryBg, fontWeight: 600, cursor: 'pointer' }}>Send to escrow</button>
                </div>
            </div>
        </div>
    ) : null;
    return [confirm, modal];
}
