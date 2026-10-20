// "Pay by card": top a canister up with cycles through CyclePay (cyclepay.org, a DFINITY Foundation
// service: Stripe checkout, protocol price, no markup; card fee 2.9% + $0.30). The no-sign-in link
// takes $5 to $100; the cycles go straight to the canister.
import React from 'react';
import { FaCreditCard } from 'react-icons/fa';

export const cyclePayUrl = (canisterId, usd = 5) => `https://www.cyclepay.org/c/${canisterId}/${usd}`;

export default function CardTopUpLink({ canisterId, usd = 5, theme, label = 'Pay by card', style }) {
    if (!canisterId) return null;
    return (
        <a href={cyclePayUrl(String(canisterId), usd)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
            title="Top up with a card, Apple Pay or Google Pay through CyclePay (Stripe checkout; $5 to $100; card fee 2.9% + $0.30)"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '11px', color: theme.colors.accent, textDecoration: 'none', fontWeight: 600, ...style }}>
            <FaCreditCard size={11} /> {label}
        </a>
    );
}
