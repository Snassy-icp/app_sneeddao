// A small QR code encoder (byte mode, versions 1-10, error correction L/M/Q/H), so a receive
// address can be shown as a QR without a dependency. The algorithm follows the ISO/IEC 18004
// construction as laid out in Project Nayuki's QR Code generator (MIT); the module matrices match
// the python `qrcode` library's for versions 1-10, every level and mask (sampled in
// test/canisters/tests/ck-convert-utils.test.js).
//
//   const qr = encodeQr('bitcoin:bc1q…');   // { size, modules: boolean[][] (row-major, true = dark), version, mask }
//   qrToSvgPath(qr) -> an SVG path string ("M x y h1v1h-1z…") for a viewBox of `size` (+ quiet zone)

const ECL = { L: 0, M: 1, Q: 2, H: 3 };
const ECL_FORMAT_BITS = [1, 0, 3, 2]; // L, M, Q, H
const MAX_VERSION = 10;
// [ecl][version], index 0 unused
const ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
];
const NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
];

const getBit = (x, i) => ((x >>> i) & 1) !== 0;

function rawDataModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
        const n = Math.floor(ver / 7) + 2;
        r -= (25 * n - 10) * n - 55;
        if (ver >= 7) r -= 36;
    }
    return r;
}
const dataCodewords = (ver, ecl) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];

function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }
    return z;
}
function rsDivisor(degree) {
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < r.length; j++) {
            r[j] = gfMul(r[j], root);
            if (j + 1 < r.length) r[j] ^= r[j + 1];
        }
        root = gfMul(root, 0x02);
    }
    return r;
}
function rsRemainder(data, divisor) {
    const r = divisor.map(() => 0);
    for (const b of data) {
        const factor = b ^ r.shift();
        r.push(0);
        divisor.forEach((coef, i) => { r[i] ^= gfMul(coef, factor); });
    }
    return r;
}

function alignmentPositions(ver, size) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const out = [6];
    for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
}

/**
 * Encode `text` (UTF-8, byte mode). Options: `ecl` 'L'|'M'|'Q'|'H' (default 'M'), `version`
 * (1-10, default: the smallest that fits), `mask` (0-7, default: the lowest penalty).
 */
export function encodeQr(text, { ecl: eclName = 'M', version = null, mask = null } = {}) {
    const ecl = ECL[eclName];
    if (ecl === undefined) throw new Error(`Unknown error correction level ${eclName}`);
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    let ver = version;
    const bitsNeeded = (v) => 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
    if (ver == null) {
        for (ver = 1; ver <= MAX_VERSION && bitsNeeded(ver) > dataCodewords(ver, ecl) * 8; ver++);
        if (ver > MAX_VERSION) throw new Error('Text too long for a QR code here');
    } else if (ver < 1 || ver > MAX_VERSION || bitsNeeded(ver) > dataCodewords(ver, ecl) * 8) {
        throw new Error(`Text does not fit QR version ${ver}`);
    }

    // data bits: mode 0100, length, bytes, terminator, pad
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4);
    push(bytes.length, ver <= 9 ? 8 : 16);
    for (const b of bytes) push(b, 8);
    const capBits = dataCodewords(ver, ecl) * 8;
    push(0, Math.min(4, capBits - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

    // error correction, interleaved
    const numBlocks = NUM_BLOCKS[ecl][ver];
    const eccLen = ECC_PER_BLOCK[ecl][ver];
    const rawCodewords = Math.floor(rawDataModules(ver) / 8);
    const numShort = numBlocks - (rawCodewords % numBlocks);
    const shortLen = Math.floor(rawCodewords / numBlocks);
    const div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < numBlocks; i++) {
        const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
        k += dat.length;
        const ecc = rsRemainder(dat, div);
        if (i < numShort) dat.push(0);
        blocks.push(dat.concat(ecc));
    }
    const codewords = [];
    for (let i = 0; i < blocks[0].length; i++) {
        blocks.forEach((blk, j) => { if (i !== shortLen - eccLen || j >= numShort) codewords.push(blk[i]); });
    }

    // matrix
    const size = ver * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => { modules[y][x] = dark; isFn[y][x] = true; };

    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            const d = Math.max(Math.abs(dx), Math.abs(dy));
            const x = cx + dx; const y = cy + dy;
            if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
        }
    }
    const al = alignmentPositions(ver, size);
    for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const drawFormat = (m) => {
        const d = (ECL_FORMAT_BITS[ecl] << 3) | m;
        let rem = d;
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const b = ((d << 10) | rem) ^ 0x5412;
        for (let i = 0; i <= 5; i++) setFn(8, i, getBit(b, i));
        setFn(8, 7, getBit(b, 6));
        setFn(8, 8, getBit(b, 7));
        setFn(7, 8, getBit(b, 8));
        for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(b, i));
        for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(b, i));
        for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(b, i));
        setFn(8, size - 8, true);
    };
    drawFormat(0); // reserve the format areas
    if (ver >= 7) {
        let rem = ver;
        for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
        const b = (ver << 12) | rem;
        for (let i = 0; i < 18; i++) {
            const bit = getBit(b, i); const a = size - 11 + (i % 3); const c = Math.floor(i / 3);
            setFn(a, c, bit); setFn(c, a, bit);
        }
    }

    let bit = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - vert : vert;
                if (!isFn[y][x] && bit < codewords.length * 8) {
                    modules[y][x] = getBit(codewords[bit >>> 3], 7 - (bit & 7));
                    bit++;
                }
            }
        }
    }

    const maskFns = [
        (x, y) => (x + y) % 2 === 0,
        (x, y) => y % 2 === 0,
        (x) => x % 3 === 0,
        (x, y) => (x + y) % 3 === 0,
        (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
        (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
        (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
        (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const applyMask = (m) => {
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFn[y][x] && maskFns[m](x, y)) modules[y][x] = !modules[y][x];
    };
    let chosen = mask;
    if (chosen == null) {
        let best = Infinity;
        for (let m = 0; m < 8; m++) {
            applyMask(m); drawFormat(m);
            const p = penalty(modules);
            if (p < best) { best = p; chosen = m; }
            applyMask(m);
        }
    }
    applyMask(chosen);
    drawFormat(chosen);
    return { size, modules, version: ver, mask: chosen };
}

// ISO penalty rules N1-N4 (used only to pick a mask; any mask scans).
function penalty(mod) {
    const n = mod.length;
    let score = 0;
    const lines = [];
    for (let y = 0; y < n; y++) lines.push(mod[y]);
    for (let x = 0; x < n; x++) lines.push(mod.map((row) => row[x]));
    const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
    for (const line of lines) {
        let run = 1;
        for (let i = 1; i <= n; i++) {
            if (i < n && line[i] === line[i - 1]) run++;
            else { if (run >= 5) score += 3 + (run - 5); run = 1; }
        }
        for (let i = 0; i + 11 <= n; i++) {
            if (pat1.every((v, k) => line[i + k] === v) || pat2.every((v, k) => line[i + k] === v)) score += 40;
        }
    }
    let dark = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (mod[y][x]) dark++;
        if (y + 1 < n && x + 1 < n) {
            const c = mod[y][x];
            if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3;
        }
    }
    const total = n * n;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
}

/// SVG path data drawing every dark module as a unit square, offset by `margin` modules.
export function qrToSvgPath(qr, margin = 4) {
    let d = '';
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) d += `M${x + margin} ${y + margin}h1v1h-1z`;
    return d;
}
