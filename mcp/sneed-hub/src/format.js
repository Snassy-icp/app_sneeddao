// Turning candid values into readable JSON: bigints, principals, blobs, timestamps, token amounts.
import { isPrincipal, ledgerActor, ptext, opt, toPrincipal } from './ic.js';

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/// Deep-convert a candid value to plain JSON (bigint -> number when safe, else string;
/// principal -> text; blob -> hex).
export const plain = (v) => {
  if (typeof v === 'bigint') return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  if (v == null) return v;
  if (isPrincipal(v)) return v.toText();
  if (v instanceof Uint8Array) return toHex(v);
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
};

/// The single key of a candid variant ({ Active: null } -> "Active").
export const variantKey = (v) => (v && typeof v === 'object' ? Object.keys(v)[0] : null);

/// Nanoseconds since the epoch (nat64 / int) to an ISO date; null for 0 / none.
export const nsToIso = (ns) => {
  if (ns == null) return null;
  const n = BigInt(ns);
  if (n <= 0n) return null;
  const ms = n / 1_000_000n;
  if (ms > 8_640_000_000_000_000n) return 'never (far future)';
  return new Date(Number(ms)).toISOString();
};
export const secToIso = (s) => (s == null || BigInt(s) <= 0n ? null : new Date(Number(BigInt(s)) * 1000).toISOString());

/// A duration in nanoseconds as days/hours text.
export const nsDuration = (ns) => {
  const n = BigInt(ns ?? 0);
  if (n <= 0n) return null;
  const secs = Number(n / 1_000_000_000n);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return d > 0 ? `${d}d${h ? ` ${h}h` : ''}` : `${h}h ${Math.floor((secs % 3600) / 60)}m`;
};

/// Base units to a decimal string with the given decimals (no rounding, trailing zeros trimmed).
export const formatUnits = (amount, decimals) => {
  if (amount == null) return null;
  const a = BigInt(amount);
  if (decimals == null) return a.toString();
  const neg = a < 0n;
  const abs = neg ? -a : a;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(Number(decimals), '0').replace(/0+$/, '');
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${wholeText}${frac ? `.${frac}` : ''}`;
};

// ---- token metadata (ICRC-1), cached per ledger ----

const tokenCache = new Map();

/// { ledger, name, symbol, decimals, fee } for a ledger; nulls when the ledger cannot be read.
export const tokenInfo = async (ledger) => {
  const id = ptext(ledger);
  if (tokenCache.has(id)) return tokenCache.get(id);
  const p = (async () => {
    try {
      const l = await ledgerActor(toPrincipal(id, 'ledger canister id'));
      const md = await l.icrc1_metadata();
      const get = (k) => {
        const e = md.find(([key]) => key === k);
        if (!e) return null;
        const v = e[1];
        return 'Nat' in v ? v.Nat : 'Int' in v ? v.Int : 'Text' in v ? v.Text : null;
      };
      return {
        ledger: id,
        name: get('icrc1:name'),
        symbol: get('icrc1:symbol'),
        decimals: get('icrc1:decimals') != null ? Number(get('icrc1:decimals')) : null,
        fee: get('icrc1:fee') != null ? String(get('icrc1:fee')) : null,
      };
    } catch (e) {
      return { ledger: id, name: null, symbol: null, decimals: null, fee: null, error: `could not read ledger metadata: ${shortErr(e)}` };
    }
  })();
  tokenCache.set(id, p);
  return p;
};

/// For tests: use this metadata for a ledger instead of reading it.
export const primeTokenInfo = (info) => { tokenCache.set(info.ledger, Promise.resolve(info)); };

/// "1,234.5 SNEED" (or base units when decimals are unknown).
export const amountText = async (amount, ledger) => {
  if (amount == null) return null;
  const t = await tokenInfo(ledger);
  if (t.decimals == null) return `${BigInt(amount).toString()} base units (ledger ${ptext(ledger)})`;
  return `${formatUnits(amount, t.decimals)} ${t.symbol ?? ''}`.trim();
};

/// The reject message of an agent error (agent-js 2: props "Reject message" for updates, "Message" for
/// queries, JSON-quoted in the text; the polling path's "Reject text"), else the first line.
export const shortErr = (e) => {
  const m = String(e?.message ?? e);
  const props = e?.props ?? {};
  let msg = props['Reject message'] ?? props.Message ?? null;
  if (msg == null) msg = m.match(/Reject text: ([^\n]+)/)?.[1] ?? null;
  if (msg == null) {
    const q = m.match(/"(?:Reject message|Message)": ("(?:[^"\\]|\\.)*")/);
    if (q) try { msg = JSON.parse(q[1]); } catch { /* keep the first line */ }
  }
  if (msg == null && props['HTTP status code']) msg = `HTTP ${props['HTTP status code']} ${props['HTTP status text'] ?? ''}`.trim();
  return String(msg ?? m.split('\n')[0]).slice(0, 300);
};

/// MCP tool result: a JSON body (plus an optional one-line summary up front).
export const result = (obj) => ({
  content: [{ type: 'text', text: JSON.stringify(plain(obj), null, 2) }],
});
export const errorResult = (message) => ({ isError: true, content: [{ type: 'text', text: message }] });

/// Wrap a tool handler so thrown errors come back as readable tool errors.
export const safe = (fn) => async (args, extra) => {
  try {
    return await fn(args ?? {}, extra);
  } catch (e) {
    return errorResult(`Error: ${shortErr(e)}`);
  }
};

export { opt, toHex };
