// Tests for src/utils/textEntry.js (no page jumps while typing on iOS: forum thread 943).
//   node --test scripts/textEntry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTextEntry, isIosDevice, noZoomFontSize, noZoomStyle } from '../src/utils/textEntry.js';

const IPAD_CHROME = 'Mozilla/5.0 (iPad; CPU OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0.8078.54 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

test('text fields count as typing, buttons and checkboxes do not', () => {
    assert.equal(isTextEntry({ tagName: 'TEXTAREA' }), true);
    assert.equal(isTextEntry({ tagName: 'SELECT' }), true);
    assert.equal(isTextEntry({ tagName: 'INPUT', type: 'text' }), true);
    assert.equal(isTextEntry({ tagName: 'INPUT' }), true); // no type: text
    assert.equal(isTextEntry({ tagName: 'INPUT', type: 'number' }), true);
    assert.equal(isTextEntry({ tagName: 'INPUT', type: 'search' }), true);
    assert.equal(isTextEntry({ tagName: 'INPUT', type: 'checkbox' }), false);
    assert.equal(isTextEntry({ tagName: 'INPUT', type: 'radio' }), false);
    assert.equal(isTextEntry({ tagName: 'INPUT', type: 'submit' }), false);
    assert.equal(isTextEntry({ tagName: 'DIV', isContentEditable: true }), true);
    assert.equal(isTextEntry({ tagName: 'DIV', isContentEditable: false }), false);
    assert.equal(isTextEntry({ tagName: 'BODY' }), false);
    assert.equal(isTextEntry(null), false);
    assert.equal(isTextEntry(undefined), false);
});

test('iOS devices, including an iPad in desktop mode', () => {
    assert.equal(isIosDevice({ userAgent: IPAD_CHROME, platform: 'iPad', maxTouchPoints: 5 }), true);
    assert.equal(isIosDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 }), true);
    assert.equal(isIosDevice({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5 }), true); // iPad, desktop site
    assert.equal(isIosDevice({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 }), false); // a Mac
    assert.equal(isIosDevice({ userAgent: ANDROID, platform: 'Linux armv8l', maxTouchPoints: 5 }), false);
    assert.equal(isIosDevice(null), false);
});

test('font sizes under 16px are raised, larger ones kept', () => {
    assert.equal(noZoomFontSize(15), '16px');
    assert.equal(noZoomFontSize(12), '16px');
    assert.equal(noZoomFontSize(18), '18px');
    assert.equal(noZoomFontSize('14px'), '16px');
    assert.equal(noZoomFontSize('20px'), '20px');
    assert.equal(noZoomFontSize('0.9rem'), 'max(16px, 0.9rem)');
    assert.equal(noZoomFontSize(undefined), 'max(16px, 1em)');
    assert.equal(noZoomFontSize(''), 'max(16px, 1em)');
});

test('the style changes on iOS only, and keeps everything else', () => {
    const style = { fontSize: 15, padding: 10, lineHeight: 1.5 };
    assert.equal(noZoomStyle(style, false), style);
    assert.deepEqual(noZoomStyle(style, true), { fontSize: '16px', padding: 10, lineHeight: 1.5 });
    assert.deepEqual(style, { fontSize: 15, padding: 10, lineHeight: 1.5 }); // not mutated
    assert.deepEqual(noZoomStyle(undefined, true), { fontSize: 'max(16px, 1em)' });
    assert.equal(noZoomStyle(undefined, false), undefined);
});
