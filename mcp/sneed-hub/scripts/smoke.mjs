// Smoke test: start the server over stdio, list tools/resources/prompts and call every tool
// against mainnet with sensible arguments. Prints a short excerpt of each result.
//   node scripts/smoke.mjs [--full]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const full = process.argv.includes('--full');
const server = fileURLToPath(new URL('../src/index.js', import.meta.url));
const client = new Client({ name: 'sneed-hub-smoke', version: '0.0.0' });
// Read-only: writes stay off, and the signer's key (for its own empty inbox etc.) is a throwaway one.
const env = { ...process.env, SNEED_MCP_WRITES: '0', SNEED_MCP_CONFIG_DIR: process.env.SNEED_MCP_CONFIG_DIR || mkdtempSync(join(tmpdir(), 'sneed-hub-smoke-')) };
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env, stderr: 'ignore' }));

const SNEED_LEDGER = 'hvgxa-wqaaa-aaaaq-aacia-cai';
const ICP_LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const SNEED_GOV = 'fi3zi-fyaaa-aaaaq-aachq-cai';

const { tools } = await client.listTools();
console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(', ')}`);

let failures = 0;
const show = (label, res) => {
  const text = res.content?.map((c) => c.text ?? '').join('\n') ?? '';
  const status = res.isError ? 'ERROR' : 'ok';
  if (res.isError) failures += 1;
  console.log(`\n--- ${label}: ${status} (${text.length} chars)`);
  console.log(full ? text : text.slice(0, 700) + (text.length > 700 ? '\n…' : ''));
  try { return JSON.parse(text); } catch { return null; }
};
const call = async (name, args = {}) => show(`${name} ${JSON.stringify(args)}`, await client.callTool({ name, arguments: args }));

await call('sneed_hub_guide', { goal: 'lock' });
await call('sneed_hub_link', { feature: 'lock_create', ledger: SNEED_LEDGER, lock_type: 'token' });
await call('sneed_hub_link', { feature: 'vote on a proposal', proposal: 1 });
await call('cycles_top_up_help', { canister: 'pqsms-lqaaa-aaaal-ajjza-cai' });

await call('token_info', { ledger: SNEED_LEDGER, owner: SNEED_GOV });
await call('token_info', { ledger: ICP_LEDGER });

const recent = await call('sneed_lock_list', { status: 'active', limit: 3 });
const firstLock = recent?.locks?.[0];
if (firstLock) {
  await call('sneed_lock_get', { lock_id: firstLock.lock_id });
  await call('sneed_lock_list', { owner: firstLock.owner.principal, limit: 3 });
}
const tokenLocks = await call('sneed_lock_list', { kind: 'token', status: 'active', limit: 2 });
const lockedLedger = tokenLocks?.locks?.[0]?.token?.ledger;
if (lockedLedger) await call('sneed_lock_token_totals', { ledger: lockedLedger });
await call('sneed_lock_token_totals', { ledger: SNEED_LEDGER });

const offers = await call('sneedex_list_offers', { limit: 3 });
const offerId = offers?.offers?.[0]?.id ?? 1;
await call('sneedex_get_offer', { offer_id: offerId });
await call('sneedex_list_offers', { state: 'completed', limit: 2 });

await call('forum_browse', {});
const topics = await call('forum_browse', { forum_id: 1 });
// the first topic that has threads (parent topics may have none)
let threadId = null;
for (const t of topics?.topics ?? []) {
  const threads = await call('forum_browse', { topic_id: t.id, limit: 3 });
  threadId = threads?.threads?.[0]?.id ?? null;
  if (threadId != null) break;
}
if (threadId != null) await call('forum_read_thread', { thread_id: threadId, limit: 3, max_chars: 300 });
await call('forum_recent', { sns_root: 'fp274-iaaaa-aaaaq-aacha-cai', limit: 3 });

await call('sneed_name_lookup', { principal: SNEED_GOV });
if (firstLock) await call('sneed_name_lookup', { principal: firstLock.owner.principal });
await call('sneed_name_lookup', { name: 'sneed', limit: 3 });

const props = await call('sneed_dao_proposals', { limit: 3 });
const pid = props?.proposals?.[0]?.id;
if (pid) await call('sneed_dao_proposal', { proposal_id: pid });

// services (text outputs)
const MR_SNEED = 'tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae';
await call('whoami');
await call('sms_read');
await call('notifications_read', { history: 3 });
await call('mon_read');
await call('premium_status', { principal: MR_SNEED });
await call('sneedapp_apps');
await call('sneedapp_apps', { app_id: 'sneed-icp-staking-bot' });
await call('sneedapp_my_bots');
await call('rll_rewards', { principal: MR_SNEED, stats: true });
await call('principal_profile', { principal: MR_SNEED });
await call('wallet_balances', { principal: SNEED_GOV, ledgers: [ICP_LEDGER, SNEED_LEDGER] });
await call('sns_my_neurons', { principal: MR_SNEED });
await call('special_prices', { canister: 'sneedex' });
await call('icrc3_log', { canister: 'sneed_lock', length: 3 });
await call('connect_as_me', { status: true });

// resources and prompts
const { resources } = await client.listResources();
console.log(`\nresources: ${resources.map((r) => r.uri).join(', ')}`);
const { resourceTemplates } = await client.listResourceTemplates();
console.log(`resource templates: ${resourceTemplates.map((r) => r.uriTemplate).join(', ')}`);
for (const uri of ['sneed-hub://docs/llms.txt', 'sneed-hub://api-docs/sneed_lock', 'sneed-hub://api-docs/does_not_exist', 'sneed-hub://skills/sneed-lock']) {
  const r = await client.readResource({ uri });
  const t = r.contents[0].text;
  console.log(`\n--- resource ${uri}: ${t.length} chars: ${t.slice(0, 160).replace(/\n/g, ' ')}`);
}
const { prompts } = await client.listPrompts();
console.log(`\nprompts: ${prompts.map((p) => p.name).join(', ')}`);
const pr = await client.getPrompt({ name: 'help_me_on_sneed_hub', arguments: { goal: 'lock my tokens' } });
console.log(pr.messages[0].content.text.slice(0, 200));

await client.close();
console.log(`\n${failures ? `${failures} tool call(s) failed` : 'all tool calls ok'}`);
process.exit(failures ? 1 : 0);
