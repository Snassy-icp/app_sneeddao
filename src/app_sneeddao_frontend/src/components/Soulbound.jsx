import React from 'react';
import { Principal } from '@dfinity/principal';

/// The character a soulbound item is bound to: its bound_to (the character's ICRC-1 account in its game: the game's root,
/// its key there), or null. Only that character may equip it; the NFT itself can still change hands.
export function boundTo(metadata) {
    const e = (metadata || []).find(([k]) => k === 'bound_to');
    const t = e && e[1].Text; if (!t) return null;
    const dot = t.lastIndexOf('.'), left = dot > 0 ? t.slice(0, dot) : '', dash = left.lastIndexOf('-');
    if (dash < 0) return null;
    try { const root = Principal.fromText(left.slice(0, dash)).toText(); const hexKey = t.slice(dot + 1).padStart(64, '0'); return { root, key: Uint8Array.from(hexKey.match(/../g).map((h) => parseInt(h, 16))) }; } catch { return null; }
}
/// A small mark for cards.
export function SoulboundBadge({ theme, style }) {
    return <span title="Soulbound: only the character it is bound to can equip it" style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.3px', color: '#f0b429', border: '1px solid #f0b429', borderRadius: 4, padding: '0 4px', ...style }}>SOULBOUND</span>;
}
