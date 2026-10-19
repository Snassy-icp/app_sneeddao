// npm run check: type-checks src/ (tsconfig.check.json) and fails only on the kinds of error
// that break at runtime in plain JavaScript: a name that doesn't exist, an import of a module or
// export that doesn't exist. The thousands of other messages tsc gives untyped JavaScript
// (unknown properties, JSX prop types) are ignored, so a real mistake stands out.
import { spawnSync } from 'node:child_process';

const COUNTS = new Map([
    ['TS2304', 'name not found'],
    ['TS2552', 'name not found (did you mean …?)'],
    ['TS2307', 'module not found'],
    ['TS2305', 'module has no such export'],
    ['TS2724', 'module has no such export (did you mean …?)'],
    ['TS2614', 'module has no such export (default vs named)'],
]);
// `process.env.X` is replaced by Vite at build time
const IGNORE = [/Cannot find name 'process'/];

const r = spawnSync('npx', ['tsc', '-p', 'tsconfig.check.json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const lines = `${r.stdout}${r.stderr}`.split('\n').filter((l) => /error TS\d+/.test(l));
const bad = lines.filter((l) => COUNTS.has(l.match(/error (TS\d+)/)[1]) && !IGNORE.some((re) => re.test(l)));
if (bad.length) {
    console.error(`npm run check: ${bad.length} problem(s):\n`);
    for (const l of bad) console.error(`  ${l}`);
    process.exit(1);
}
console.log(`npm run check: OK (${lines.length} other tsc messages about untyped JavaScript ignored)`);
