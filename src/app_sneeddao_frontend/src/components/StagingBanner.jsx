// A strip across the top of every page on the staging site: members try proposed features there
// before they vote, so it must never be mistaken for Sneed Hub itself.
import React from 'react';
import { FaFlask } from 'react-icons/fa';

const isStaging = process.env.DFX_NETWORK === 'staging';

export default function StagingBanner() {
    if (!isStaging) return null;
    return (
        <div role="note" style={{
            background: 'repeating-linear-gradient(135deg, #f59e0b, #f59e0b 14px, #d97706 14px, #d97706 28px)',
            color: '#1a1200', fontSize: '12.5px', lineHeight: 1.45, padding: '6px 16px', textAlign: 'center',
            fontWeight: 600, position: 'relative', zIndex: 1001,
        }}>
            <FaFlask style={{ verticalAlign: '-2px', marginRight: 6 }} />
            STAGING: a preview of Sneed Hub for trying proposed features before you vote; its names, posts and
            settings are separate from the real site.{' '}
            <a href="https://app.sneeddao.com" style={{ color: '#1a1200', textDecoration: 'underline' }}>Sneed Hub is at app.sneeddao.com</a>
            <div style={{ marginTop: 2, fontWeight: 700 }}>
                Run by the team, not the DAO. It uses real tokens at real prices: only tiny test amounts, never your funds.
            </div>
        </div>
    );
}
