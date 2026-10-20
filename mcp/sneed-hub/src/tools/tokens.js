// Any ICRC-1 ledger: metadata, total supply, balance of an account.
// Queries: icrc1_metadata, icrc1_total_supply, icrc1_balance_of, icrc1_supported_standards.
import { z } from 'zod';
import { ledgerActor, toPrincipal, HUB_URL, CANISTERS } from '../ic.js';
import { result, safe, formatUnits, plain } from '../format.js';

const hexToBytes = (hex) => {
  const h = hex.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{0,64}$/.test(h) || h.length % 2) throw new Error('subaccount must be up to 32 bytes of hex');
  const b = new Uint8Array(32);
  const src = Uint8Array.from(h.match(/.{2}/g) ?? [], (x) => parseInt(x, 16));
  b.set(src, 32 - src.length);
  return b;
};

const mdValue = (v) => ('Nat' in v ? v.Nat.toString() : 'Int' in v ? v.Int.toString() : 'Text' in v ? v.Text : 'Blob' in v ? `<${v.Blob.length} bytes>` : JSON.stringify(plain(v)));

export function registerTokenTools(server) {
  server.registerTool('token_info', {
    title: 'ICRC-1 token info and balance',
    description: `Read any ICRC-1 ledger: name, symbol, decimals, fee, total supply, supported standards, and optionally the balance of an account (principal + optional subaccount). SNEED's ledger is ${CANISTERS.sneed_ledger}; ICP's is ${CANISTERS.icp_ledger}. Balances are public on-chain data. No prices.`,
    inputSchema: {
      ledger: z.string().describe('ICRC-1 ledger canister id'),
      owner: z.string().optional().describe('Account owner principal, to read its balance'),
      subaccount: z.string().optional().describe('Subaccount as hex (optional)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ ledger, owner, subaccount }) => {
    const id = toPrincipal(ledger, 'ledger canister id');
    const l = await ledgerActor(id);
    const [md, supply, standards] = await Promise.all([
      l.icrc1_metadata(),
      l.icrc1_total_supply(),
      l.icrc1_supported_standards().catch(() => []),
    ]);
    const meta = Object.fromEntries(md.filter(([k]) => k !== 'icrc1:logo').map(([k, v]) => [k, mdValue(v)]));
    const decimals = meta['icrc1:decimals'] != null ? Number(meta['icrc1:decimals']) : null;
    const symbol = meta['icrc1:symbol'] ?? '';
    const fmt = (x) => (decimals != null ? `${formatUnits(x, decimals)} ${symbol}`.trim() : `${x} base units`);
    const out = {
      ledger: id.toText(),
      name: meta['icrc1:name'] ?? null,
      symbol: symbol || null,
      decimals,
      fee: meta['icrc1:fee'] != null ? fmt(BigInt(meta['icrc1:fee'])) : null,
      total_supply: fmt(supply),
      total_supply_base_units: supply.toString(),
      standards: standards.map((s) => s.name),
      other_metadata: Object.fromEntries(Object.entries(meta).filter(([k]) => !['icrc1:name', 'icrc1:symbol', 'icrc1:decimals', 'icrc1:fee'].includes(k))),
      links: {
        token_studio: `${HUB_URL}/studio/${id.toText()}`,
        safety_rating: `${HUB_URL}/tools/token_safety/${id.toText()}`,
        transactions: `${HUB_URL}/transactions?ledger=${id.toText()}`,
        locks: `${HUB_URL}/tokenlock?ledger=${id.toText()}`,
      },
    };
    if (owner) {
      const account = { owner: toPrincipal(owner), subaccount: subaccount ? [hexToBytes(subaccount)] : [] };
      const bal = await l.icrc1_balance_of(account);
      out.account = { owner: account.owner.toText(), subaccount: subaccount ?? null, balance: fmt(bal), balance_base_units: bal.toString() };
    }
    return result(out);
  }));
}


