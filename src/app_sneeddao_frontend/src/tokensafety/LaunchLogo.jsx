// A launch's logo, fetched on its own (get_launch_logo) once it scrolls into view, since the
// launch lists no longer carry logos (they can be 200 kB each).
import React, { useEffect, useRef, useState } from 'react';

const cache = new Map(); // `${padId}:${id}` -> data URL or '' (none)

export default function LaunchLogo({ pad, padId, launch, size = 24 }) {
    const key = `${padId}:${String(launch.id)}`;
    const [src, setSrc] = useState(cache.get(key) || '');
    const ref = useRef(null);
    const padRef = useRef(pad); padRef.current = pad; // callers may hand a new actor each render
    useEffect(() => {
        if (!padRef.current || !launch.logo_bytes || cache.has(key)) return undefined;
        let live = true;
        const load = () => padRef.current.get_launch_logo(launch.id)
            .then((r) => { const url = r[0] && r[0].startsWith('data:image/') ? r[0] : ''; cache.set(key, url); if (live) setSrc(url); })
            .catch(() => {});
        const el = ref.current;
        if (!el || typeof IntersectionObserver === 'undefined') { load(); return () => { live = false; }; }
        const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); } });
        io.observe(el);
        return () => { live = false; io.disconnect(); };
    }, [key, launch.id, launch.logo_bytes]);
    return src
        ? <img ref={ref} src={src} alt="" style={{ width: size, height: size, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
        : <span ref={ref} style={{ display: 'inline-block', width: size, height: size, borderRadius: 6, flexShrink: 0 }} />;
}
