// JSX drops a line break between text and an inline element, so
//     …run the loop.
//     <Link …>See what actually moved</Link>
// renders as "…run the loop.See what actually moved". This test finds such spots: a line of plain JSX text
// ending in a word or punctuation, followed by an inline element (Link, a, strong, em, b, i, code) whose
// text does not start with a space. Fix with {' '} at the end of the text line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const INLINE = /^\s*<(Link|a|strong|em|b|i|code)\b/;
const TEXT = /^\s+[A-Za-z(“"'][^<>{}=;]*[A-Za-z.,:;!?)”"']\s*$/;
const CODE = /^\s*(\/\/|\*|import|return|const|let|if|case)/;

const walk = (d) => readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.jsx$/.test(f) ? [p] : [];
});

export function missingSpaces(files) {
    const hits = [];
    for (const f of files) {
        const lines = readFileSync(f, 'utf8').split('\n');
        for (let i = 0; i + 1 < lines.length; i++) {
            const text = lines[i], next = lines[i + 1];
            if (!TEXT.test(text) || CODE.test(text) || !INLINE.test(next)) continue;
            if (/^\s*<[^>]*>\s/.test(next)) continue; // the element's text starts with a space
            hits.push(`${f.slice(SRC.length + 1)}:${i + 2}: "${text.trim().slice(-30)}" + ${next.trim().slice(0, 30)}`);
        }
    }
    return hits;
}

test('no JSX text runs into the next inline element without a space', () => {
    assert.deepEqual(missingSpaces(walk(SRC)), []);
});
