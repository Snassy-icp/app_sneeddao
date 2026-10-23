// A camera button next to a recipient field in a send flow. It scans a QR code (BarcodeDetector
// where the browser has it, else jsQR, loaded on demand), reads it with utils/scanParse.js and
// only fills the field: nothing is ever sent from a scan. No camera, a denied permission or an
// unreadable code shows a message in the panel; a picture of a code can be read instead.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaCamera, FaTimes, FaImage } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { parseScan } from '../utils/scanParse';

const SCAN_EVERY_MS = 180;
const MAX_SIDE = 720;

async function makeDecoder() {
    try {
        if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
            const formats = await window.BarcodeDetector.getSupportedFormats?.();
            if (!formats || formats.includes('qr_code')) {
                const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
                return async (source) => {
                    const codes = await detector.detect(source);
                    return codes?.[0]?.rawValue ?? null;
                };
            }
        }
    } catch { /* fall back to jsQR */ }
    const { default: jsQR } = await import('jsqr');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return async (source) => {
        const w0 = source.videoWidth || source.naturalWidth || source.width;
        const h0 = source.videoHeight || source.naturalHeight || source.height;
        if (!w0 || !h0) return null;
        const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
        const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
        canvas.width = w; canvas.height = h;
        ctx.drawImage(source, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        return jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' })?.data ?? null;
    };
}

function cameraError(e) {
    const name = e?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access was denied. Allow the camera for this site in your browser settings, read a picture of the code instead, or paste the address.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found on this device. Read a picture of the code instead, or paste the address.';
    if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is busy (another app may be using it). Close that app and try again, or paste the address.';
    return `The camera could not start${e?.message ? ` (${e.message})` : ''}. Read a picture of the code instead, or paste the address.`;
}

/**
 * Props: target ('icrc' | 'icp' | 'btc' | 'eth', see utils/scanParse.js), onScan(value, result),
 * and an optional title.
 */
export default function QrScanButton({ target = 'icrc', onScan, title = 'Scan a QR code', style }) {
    const { theme } = useTheme();
    const c = theme.colors;
    const [open, setOpen] = useState(false);
    const [error, setError] = useState(null);
    const [status, setStatus] = useState('');
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const decodeRef = useRef(null);
    const timerRef = useRef(null);
    const fileRef = useRef(null);

    const stop = useCallback(() => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        streamRef.current?.getTracks?.().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
        streamRef.current = null;
    }, []);

    const close = useCallback(() => { stop(); setOpen(false); setError(null); setStatus(''); }, [stop]);

    // A decoded text: fill the field and close, or say why it does not fit and keep scanning.
    const handleText = useCallback((text) => {
        const r = parseScan(text, target);
        if (r.ok) { stop(); setOpen(false); setError(null); onScan?.(r.value, r); return true; }
        setError(r.error);
        return false;
    }, [target, onScan, stop]);

    useEffect(() => {
        if (!open) return undefined;
        let cancelled = false;
        (async () => {
            setError(null);
            setStatus('Starting the camera…');
            try { decodeRef.current = await makeDecoder(); } catch { decodeRef.current = null; }
            if (!navigator.mediaDevices?.getUserMedia) {
                setStatus('');
                setError('This browser cannot use a camera here (it needs camera support and a secure https page). Read a picture of the code instead, or paste the address.');
                return;
            }
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
            } catch (e) {
                if (!cancelled) { setStatus(''); setError(cameraError(e)); }
                return;
            }
            if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
            streamRef.current = stream;
            const video = videoRef.current;
            if (!video) return;
            video.srcObject = stream;
            try { await video.play(); } catch { /* autoplay hiccup; frames still arrive */ }
            setStatus('Point the camera at the QR code.');
            const tick = async () => {
                if (cancelled || !streamRef.current) return;
                try {
                    if (decodeRef.current && video.readyState >= 2) {
                        const text = await decodeRef.current(video);
                        if (text && handleText(text)) return;
                    }
                } catch { /* a frame that could not be read */ }
                timerRef.current = setTimeout(tick, SCAN_EVERY_MS);
            };
            tick();
        })();
        return () => { cancelled = true; stop(); };
    }, [open, handleText, stop]);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open, close]);

    const readFile = async (file) => {
        if (!file) return;
        setError(null);
        try {
            const decode = decodeRef.current || (decodeRef.current = await makeDecoder());
            const url = URL.createObjectURL(file);
            try {
                const img = new Image();
                img.src = url;
                await img.decode();
                const text = await decode(img);
                if (!text) { setError('No QR code found in that picture.'); return; }
                handleText(text);
            } finally { URL.revokeObjectURL(url); }
        } catch {
            setError('That picture could not be read.');
        }
    };

    const smallBtn = {
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8,
        border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText,
        cursor: 'pointer', fontSize: 13,
    };

    return (
        <>
            <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
                title={title}
                aria-label={title}
                style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    width: 42, minHeight: 42, borderRadius: 8, border: `1px solid ${c.border}`,
                    background: c.secondaryBg, color: c.secondaryText, cursor: 'pointer', ...style,
                }}
            >
                <FaCamera size={15} />
            </button>
            {open && createPortal(
                <div
                    role="dialog"
                    aria-label="Scan a QR code"
                    onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) close(); }}
                    style={{ position: 'fixed', inset: 0, zIndex: 10050, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
                >
                    <div style={{ width: '100%', maxWidth: 380, background: c.primaryBg, color: c.primaryText, border: `1px solid ${c.border}`, borderRadius: 14, padding: 14, boxShadow: c.cardShadow }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <strong style={{ fontSize: 15 }}>Scan a QR code</strong>
                            <button type="button" onClick={close} aria-label="Close" style={{ background: 'none', border: 'none', color: c.mutedText, cursor: 'pointer', padding: 4 }}><FaTimes size={15} /></button>
                        </div>
                        <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', background: '#000', borderRadius: 10, overflow: 'hidden' }}>
                            <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            <div style={{ position: 'absolute', inset: '18%', border: '2px solid rgba(255,255,255,0.75)', borderRadius: 12, pointerEvents: 'none' }} />
                        </div>
                        {status && !error && <div style={{ marginTop: 10, fontSize: 13, color: c.mutedText }}>{status}</div>}
                        {error && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: c.error, lineHeight: 1.45 }}>{error}</div>}
                        <div style={{ marginTop: 10, fontSize: 12, color: c.mutedText }}>The code only fills in the address. Check it before you send.</div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                            <button type="button" style={smallBtn} onClick={() => fileRef.current?.click()}><FaImage size={13} /> Read a picture</button>
                            <button type="button" style={smallBtn} onClick={close}>Cancel</button>
                            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}
