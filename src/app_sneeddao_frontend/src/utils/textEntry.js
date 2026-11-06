// Typing on phones and tablets without the page jumping (forum thread 943: an iPad, Chrome iOS).
//
// iOS (every browser there is WebKit) zooms into a text field whose font is under 16px when it gets
// focus, then pans the zoomed view after the caret while you type or dictate, and zooms again on the
// next field: the page seems to jump. A field of 16px or more is never zoomed into.
//
// The header also folds rows away on scroll; while someone types, the scrolls are the browser
// keeping the caret in view, and folding a row then moves the field under the caret.

const NOT_TEXT = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/// Is this element something the user types into (a text input, textarea, select or contenteditable)?
export function isTextEntry(el) {
    if (!el || typeof el.tagName !== 'string') return false;
    const tag = el.tagName.toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !NOT_TEXT.has(String(el.type || 'text').toLowerCase());
    return el.isContentEditable === true;
}

/// iPhone, iPod or iPad (an iPad in desktop mode says "Macintosh" but has a touch screen).
export function isIosDevice(nav = typeof navigator !== 'undefined' ? navigator : null) {
    if (!nav) return false;
    if (/iP(hone|ad|od)/.test(nav.userAgent || '')) return true;
    return nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1;
}

/// A font size for a text field that iOS won't zoom into: at least 16px, larger sizes kept.
/// fontSize as in a React style (a number is px); none means the inherited size.
export function noZoomFontSize(fontSize) {
    if (fontSize == null || fontSize === '') return 'max(16px, 1em)';
    if (typeof fontSize === 'number') return `${Math.max(16, fontSize)}px`;
    const px = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(fontSize);
    if (px) return `${Math.max(16, Number(px[1]))}px`;
    return `max(16px, ${fontSize})`;
}

/// The style for a text field: on iOS its font is raised to 16px if smaller; elsewhere unchanged.
export function noZoomStyle(style, ios = isIosDevice()) {
    if (!ios) return style;
    return { ...(style || {}), fontSize: noZoomFontSize(style?.fontSize) };
}
