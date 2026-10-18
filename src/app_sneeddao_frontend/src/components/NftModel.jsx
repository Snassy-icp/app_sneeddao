import React, { useEffect, useState } from 'react';

/// An NFT's 3D model (a .glb or .gltf animation_url): Google's <model-viewer>, loaded only when a model is shown.
/// Drag to turn, scroll or pinch to zoom; it turns slowly by itself until touched. `poster`: the NFT's picture, shown
/// while the model loads.
export default function NftModel({ url, poster, alt, style }) {
    const [ready, setReady] = useState(!!(typeof customElements !== 'undefined' && customElements.get('model-viewer')));
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (ready) return undefined;
        let alive = true;
        import('@google/model-viewer').then(() => { if (alive) setReady(true); }, () => { if (alive) setFailed(true); });
        return () => { alive = false; };
    }, [ready]);
    if (failed) return <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', opacity: 0.7 }}>The 3D viewer did not load</div>;
    if (!ready) return poster ? <img src={poster} alt={alt} style={{ ...style, objectFit: 'contain' }} /> : <div style={style} />;
    return React.createElement('model-viewer', {
        src: url, poster: poster || undefined, alt: alt || '3D model', 'camera-controls': '', 'auto-rotate': '', 'touch-action': 'pan-y',
        'shadow-intensity': '1', exposure: '1', 'interaction-prompt': 'none', style: { width: '100%', height: '100%', background: 'transparent', ...style },
    });
}
