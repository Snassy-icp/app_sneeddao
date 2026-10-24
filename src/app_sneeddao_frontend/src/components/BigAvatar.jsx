// Big avatars, one component for every place that shows a person at more than icon size.
//
//   <BigAvatar principal={p} size={48} verified="auto" />
//   <AvatarPair logo={snsLogo} logoAlt="Sneed" principal={proposer} size={28} />
//
// The picture comes from the Sneed names system exactly as PrincipalDisplay gets it: through
// NamingContext's batched queue (hooks/useAvatars), which re-checks NFT avatars against their
// collections when they are shown. Until it is known — or when there is none, or the image will not
// load — a fallback of the same size shows (the principal's colour with the name's initial, a user
// icon, or a cube for a canister), so nothing moves when the picture arrives.
import React, { useCallback, useContext, useMemo, useState } from 'react';
import { Principal } from '@dfinity/principal';
import { FaCheck, FaCube, FaUser } from 'react-icons/fa';
import { useTheme } from '../contexts/ThemeContext';
import { NamingContext } from '../NamingContext';
import { useAvatarOf } from '../hooks/useAvatars';
import { getPrincipalColor, isCanisterPrincipal } from '../utils/PrincipalUtils';

const VERIFIED_GREEN = '#2ecc71';
const PREMIUM_GOLD = '#f59e0b';

const toText = (p) => {
    if (!p) return null;
    if (typeof p === 'string') return p;
    try { return p.toText ? p.toText() : p.toString(); } catch { return null; }
};
const toPrincipal = (p) => {
    if (!p) return null;
    if (typeof p !== 'string') return p;
    try { return Principal.fromText(p); } catch { return null; }
};

/// A picture over a same-size fallback: the fallback is always laid out, the picture fades in on
/// top once it loads and disappears if it fails.
function Picture({ src, radius, fit = 'cover' }) {
    // the src that loaded / failed, so a new src starts hidden without an effect: an effect that reset
    // the state ran after a cached picture's load event and hid it for good (a post's avatar after
    // the post remounted under its real id)
    const [loaded, setLoaded] = useState(null);
    const [broken, setBroken] = useState(null);
    // a cached picture can also finish before React listens to it, and its load event is lost
    const ref = useCallback((img) => { if (img && img.complete && img.naturalWidth > 0) setLoaded(src); }, [src]);
    if (!src || broken === src) return null;
    return (
        <img ref={ref} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" draggable={false}
            onLoad={() => setLoaded(src)} onError={() => setBroken(src)}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: fit, borderRadius: radius, opacity: loaded === src ? 1 : 0, transition: 'opacity 0.18s ease' }} />
    );
}

/// The small green verified check, sized from the avatar and cut out of the background.
export function VerifiedCheck({ size = 16, cutout, title = 'Verified name', style }) {
    return (
        <span title={title} aria-label={title} role="img" style={{
            position: 'absolute', right: -Math.round(size * 0.12), bottom: -Math.round(size * 0.12),
            width: size, height: size, borderRadius: '50%', background: VERIFIED_GREEN,
            display: 'grid', placeItems: 'center', boxShadow: cutout ? `0 0 0 ${Math.max(2, Math.round(size / 7))}px ${cutout}` : 'none',
            color: '#fff', zIndex: 2, ...style,
        }}>
            <FaCheck size={Math.max(7, Math.round(size * 0.55))} />
        </span>
    );
}

/// A principal's avatar at any size.
/// props:
///   principal  Principal | text (optional when `url` is given)
///   size       px, default 48
///   url        show this picture instead of looking one up (undefined = look up; null = none)
///   name       text for the fallback initial; default: the principal's Sneed name
///   verified   true | false | 'auto' (the principal's name is verified) — default false
///   premium    true draws a gold ring
///   ring       any ring colour (overrides premium)
///   shape      'circle' (default) | 'rounded' (squircle, for heroes and logos)
///   fallback   'initial' (default) | 'icon'
///   cutout     background colour around the check and ring (default: the theme's card colour)
///   title, style, onClick
export default function BigAvatar({
    principal, size = 48, url, name, verified = false, premium = false, ring = null, shape = 'circle',
    fallback = 'initial', cutout, title, style, onClick,
}) {
    const { theme } = useTheme();
    const naming = useContext(NamingContext); // optional: works outside the provider too
    const text = toText(principal);
    const pobj = useMemo(() => toPrincipal(principal), [text]); // eslint-disable-line react-hooks/exhaustive-deps
    const isCanister = pobj ? isCanisterPrincipal(pobj) : false;
    const looked = useAvatarOf(url === undefined && !isCanister ? text : null);
    const src = url === undefined ? looked : url;
    const shownName = name !== undefined ? name : (text ? naming?.principalNames?.get(text) : null);
    const isVerified = verified === 'auto' ? Boolean(text && shownName && naming?.verifiedNames?.get(text)) : Boolean(verified);
    const radius = shape === 'rounded' ? Math.round(size * 0.24) : '50%';
    const base = text ? getPrincipalColor(text) : theme.colors.mutedText;
    const ringColor = ring || (premium ? PREMIUM_GOLD : null);
    const cut = cutout || theme.colors.secondaryBg;
    const iconSize = Math.max(8, Math.round(size * 0.42));
    const initial = fallback === 'initial' && shownName ? [...String(shownName).trim()][0]?.toUpperCase() : null;

    return (
        <span title={title} onClick={onClick} style={{
            position: 'relative', display: 'inline-block', width: size, height: size, flexShrink: 0, verticalAlign: 'middle',
            cursor: onClick ? 'pointer' : undefined, ...style,
        }}>
            <span style={{
                position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden',
                background: `linear-gradient(135deg, ${base}, ${base}99)`,
                display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: Math.round(size * 0.44), lineHeight: 1,
                boxShadow: ringColor ? `0 0 0 ${Math.max(1.5, size / 28)}px ${ringColor}` : 'none',
                userSelect: 'none',
            }}>
                <span aria-hidden style={{ display: 'grid', placeItems: 'center' }}>
                    {isCanister ? <FaCube size={iconSize} /> : initial ? initial : <FaUser size={iconSize} />}
                </span>
                <Picture src={src} radius={radius} />
            </span>
            {isVerified && <VerifiedCheck size={Math.max(12, Math.round(size * 0.3))} cutout={cut} />}
        </span>
    );
}

/// A logo (an SNS, a token, an app) at avatar size; letters of `alt` when there is no picture.
export function LogoAvatar({ src, alt = '', size = 32, shape = 'circle', title, style }) {
    const { theme } = useTheme();
    const radius = shape === 'rounded' ? Math.round(size * 0.24) : '50%';
    return (
        <span title={title ?? alt} style={{ position: 'relative', display: 'inline-block', width: size, height: size, flexShrink: 0, verticalAlign: 'middle', ...style }}>
            <span style={{
                position: 'absolute', inset: 0, borderRadius: radius, overflow: 'hidden', background: theme.colors.tertiaryBg,
                display: 'grid', placeItems: 'center', color: theme.colors.secondaryText, fontWeight: 800, fontSize: Math.round(size * 0.42), lineHeight: 1,
            }}>
                <span aria-hidden>{[...String(alt || '?')][0]?.toUpperCase()}</span>
                <Picture src={src} radius={radius} />
            </span>
        </span>
    );
}

/// Two pictures overlapping like an LP token pair: a logo behind (left) and a person's avatar in
/// front (right). Without an avatar only the logo shows; with `reserve` (default) the pair's width
/// is kept anyway so the row does not shift when the avatar arrives.
/// props:
///   logo, logoAlt, logoShape  the back picture (an SNS or token logo); logoShape 'circle' | 'rounded'
///   principal                 whose avatar sits in front
///   avatarUrl                 the front picture directly (undefined = look up from `principal`; null = none)
///   size                      each picture's size in px, default 28
///   overlap                   share of `size` they overlap, default 0.38
///   verified                  passed to the avatar (true | false | 'auto')
///   showFallback              true shows the front avatar's fallback (initial/icon) when there is no picture
///   reserve                   keep the pair's width when there is no avatar, default true
///   cutout                    the ring colour separating the two (default: the theme's card colour)
///   title, style
export function AvatarPair({
    logo, logoAlt = '', logoShape = 'circle', principal, avatarUrl, size = 28, overlap = 0.38, verified = false,
    showFallback = false, reserve = true, cutout, title, style,
}) {
    const { theme } = useTheme();
    const text = toText(principal);
    const looked = useAvatarOf(avatarUrl === undefined ? text : null);
    const front = avatarUrl === undefined ? looked : avatarUrl;
    const hasFront = Boolean(front) || (showFallback && Boolean(text));
    const cut = cutout || theme.colors.secondaryBg;
    const width = Math.round(size * (2 - overlap));
    return (
        <span title={title} style={{ position: 'relative', display: 'inline-block', width: hasFront || reserve ? width : size, height: size, flexShrink: 0, verticalAlign: 'middle', ...style }}>
            <LogoAvatar src={logo} alt={logoAlt} size={size} shape={logoShape} style={{ position: 'absolute', left: 0, top: 0, display: 'block' }} />
            {hasFront && (
                <span style={{ position: 'absolute', left: width - size, top: 0, width: size, height: size, borderRadius: '50%', boxShadow: `0 0 0 2px ${cut}` }}>
                    <BigAvatar principal={principal} url={front || null} size={size} verified={verified} cutout={cut} style={{ display: 'block' }} />
                </span>
            )}
        </span>
    );
}
