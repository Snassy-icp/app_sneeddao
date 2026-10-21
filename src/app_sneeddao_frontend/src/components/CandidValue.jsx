import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { PrincipalDisplay } from '../utils/PrincipalUtils';
import { formatField } from '../governance/format';

/// A decoded argument tuple, one row per argument, rendered with the registry's field hints
/// (spec/sneed_proxy.md §4.1): bps as %, e8s as token amounts, ns/seconds as durations, principals
/// with their names, `opt` as "unchanged" where the method uses null for "keep". `current` (an
/// argument tuple in the same shape) adds a "current" column.
export default function CandidValue({ values, fields = {}, current = null }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const cell = { padding: '6px 10px', borderBottom: `1px solid ${c.border}`, fontSize: 14, color: c.primaryText, verticalAlign: 'top', overflowWrap: 'anywhere' };
    const head = { ...cell, color: c.mutedText, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'left' };
    const show = (v, hint) => {
        const inner = hint?.keep && Array.isArray(v) && v.length === 1 ? v[0] : v;
        if (hint?.kind === 'principal' && inner && typeof inner.toText === 'function') {
            return <PrincipalDisplay principal={inner} showSendMessage={false} />;
        }
        return formatField(v, hint);
    };
    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr>
                        <th style={head}>Field</th>
                        {current && <th style={head}>Current</th>}
                        <th style={head}>{current ? 'Proposed' : 'Value'}</th>
                    </tr>
                </thead>
                <tbody>
                    {values.map((v, i) => (
                        <tr key={i}>
                            <td style={{ ...cell, color: c.secondaryText }}>{fields[i]?.name || `Argument ${i + 1}`}</td>
                            {current && <td style={{ ...cell, color: c.secondaryText }}>{current[i] === undefined ? 'unknown' : show(current[i], fields[i])}</td>}
                            <td style={{ ...cell, fontWeight: 600 }}>{show(v, fields[i])}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
