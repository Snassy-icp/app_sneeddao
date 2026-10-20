// A small yes/no bar for proposal cards: the share of all voting power that voted yes (green)
// and no (red), with the rest grey. Takes an SNS or NNS `latest_tally` (an option or a record).
import React from 'react';

export default function VoteBar({ tally, theme, style }) {
    const t = Array.isArray(tally) ? tally[0] : tally;
    const total = t ? Number(t.total) : 0;
    if (!t || !total) return null;
    const yes = (Number(t.yes) / total) * 100;
    const no = (Number(t.no) / total) * 100;
    const pct = (v) => `${v < 10 && v > 0 ? v.toFixed(1) : Math.round(v)}%`;
    const c = theme.colors;
    return (
        <div style={{ margin: '0 0 0.75rem', ...style }} title={`Yes ${yes.toFixed(2)}% · No ${no.toFixed(2)}% of all voting power`}>
            <div style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', background: c.tertiaryBg || c.border }}>
                <div style={{ width: `${yes}%`, background: '#22c55e' }} />
                <div style={{ width: `${no}%`, background: '#ef4444' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginTop: 4, color: c.mutedText }}>
                <span><span style={{ color: '#22c55e', fontWeight: 600 }}>Yes {pct(yes)}</span> · <span style={{ color: '#ef4444', fontWeight: 600 }}>No {pct(no)}</span></span>
                <span>{pct(100 - yes - no)} not voted</span>
            </div>
        </div>
    );
}
