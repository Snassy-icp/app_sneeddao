// "Verify a recompressed build": under a code check that did not pass, anyone can choose the
// .wasm.gz the launcher installed (or give a URL, where the hub's CSP and the host allow it). The
// browser checks that the file is what the canister runs, decompresses it and compares the Wasm with
// every official DFINITY ledger suite build. Nothing is stored; a match is for the Sneed team to add
// to the verified list (src/tokensafety/repackaged.js).
import React, { useState } from 'react';
import { verifyWasmGz, urlAllowed } from './wasmVerify.js';
import { primary } from '../health/TreeView.jsx';

export default function VerifyRecompressed({ moduleHash, kind, theme }) {
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null); // { ok, text }

    const check = async (getBytes, what) => {
        setBusy(true); setResult(null);
        try {
            const bytes = await getBytes();
            const v = await verifyWasmGz(bytes, moduleHash);
            if (!v.matchesModule) { setResult({ ok: false, text: `This ${what} is not what the canister runs: its SHA-256 is ${v.fileHash}, the module hash is ${moduleHash}.` }); return; }
            if (v.gzipError) { setResult({ ok: false, text: `The file matches the module hash but is not gzip-compressed (${v.gzipError}), so it is not a recompressed build.` }); return; }
            if (!v.releases.length) { setResult({ ok: false, text: `The file is what the canister runs, but its Wasm (SHA-256 ${v.rawHash}) is not any official DFINITY ledger suite build known here.` }); return; }
            const same = v.releases.filter((r) => r.kind === kind);
            const names = v.releases.map((r) => `${r.kind} of release ${r.release}${r.u256 ? ' (u256)' : ''}`).join(', ');
            setResult({ ok: same.length > 0, text: same.length
                ? `Match: the canister runs DFINITY's official ${names}, only recompressed (Wasm SHA-256 ${v.rawHash}). Ask the Sneed team to add it to the verified list so the check passes for everyone.`
                : `The Wasm is DFINITY's official ${names}, but it is installed as the ${kind}.` });
        } catch (e) {
            setResult({ ok: false, text: String(e?.message || e) });
        } finally { setBusy(false); }
    };

    const fromFile = (file) => file && check(async () => new Uint8Array(await file.arrayBuffer()), 'file');
    const fromUrl = () => {
        const u = url.trim();
        if (!urlAllowed(u)) { setResult({ ok: false, text: 'Sneed Hub can only download from GitHub and IC asset canisters (icp0.io). Download the file yourself and choose it above.' }); return; }
        check(async () => {
            let res;
            try { res = await fetch(u); } catch { throw new Error("The host doesn't allow browsers to download it. Download it and choose the file above, or send the file to the Sneed team to add it to the verified list."); }
            if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
            return new Uint8Array(await res.arrayBuffer());
        }, 'download');
    };

    const field = { padding: '6px 8px', borderRadius: 6, border: `1px solid ${theme.colors.border}`, background: theme.colors.primaryBg, color: theme.colors.primaryText, fontSize: '0.8rem' };
    return (
        <div style={{ marginTop: 10, padding: '10px 12px', border: `1px dashed ${theme.colors.border}`, borderRadius: 8, fontFamily: 'system-ui, sans-serif', whiteSpace: 'normal' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 700, color: theme.colors.primaryText, marginBottom: 4 }}>Verify a recompressed build</div>
            <div style={{ fontSize: '0.78rem', color: theme.colors.mutedText, marginBottom: 8, lineHeight: 1.5 }}>
                Some launchers upload an official DFINITY .wasm.gz compressed again: the module hash differs, the Wasm inside is the same. Choose the .wasm.gz that was installed; your browser checks it against the module hash, decompresses it and compares it with every official release. The file stays on your computer.
            </div>
            <input type="file" accept=".gz,.wasm.gz,application/gzip" disabled={busy} onChange={(e) => fromFile(e.target.files?.[0])} style={{ ...field, maxWidth: '100%' }} />
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <input type="url" placeholder="or a URL of the .wasm.gz (GitHub or icp0.io)" value={url} onChange={(e) => setUrl(e.target.value)} style={{ ...field, flex: 1, minWidth: 200 }} />
                <button type="button" disabled={busy || !url.trim()} onClick={fromUrl} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: primary, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.8rem' }}>{busy ? 'Checking…' : 'Check URL'}</button>
            </div>
            {result && <div style={{ marginTop: 8, fontSize: '0.8rem', color: result.ok ? '#22c55e' : '#f59e0b', wordBreak: 'break-word' }}>{result.text}</div>}
        </div>
    );
}
