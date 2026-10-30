#!/usr/bin/env node
// Sneed Hub MCP server (stdio). Reads public on-chain data and the signer's own private data, and,
// only when enabled (SNEED_MCP_WRITES=1), performs writes with a two-step preview/confirm, daily caps
// and an audit log, either "as me" (a Sneed Hub delegation from the user) or as the agent's own identity.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';

import { registerGuideTools } from './tools/guide.js';
import { registerLockTools } from './tools/lock.js';
import { registerSneedexTools } from './tools/sneedex.js';
import { registerForumTools } from './tools/forum.js';
import { registerNameTools } from './tools/names.js';
import { registerGovernanceTools } from './tools/governance.js';
import { registerTokenTools } from './tools/tokens.js';
import { registerDocResources } from './docs.js';
import { registerAccountTools } from './tools/account.js';
import { registerReadTools } from './tools/reads.js';
import { registerSocialWrites } from './tools/w_social.js';
import { registerGovWrites } from './tools/w_gov.js';
import { registerSneedexWrites } from './tools/w_sneedex.js';
import { registerMiscWrites } from './tools/w_misc.js';
import { registerLockWrites } from './tools/w_lock.js';
import { registerMonWrites } from './tools/w_mon.js';
import { registerNameWrites } from './tools/w_names.js';
import { registerAccountWrites } from './tools/w_account.js';
import { registerSneedappWrites } from './tools/w_sneedapp.js';
import { settings } from './config.js';
import { HUB_URL } from './ic.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const WRITES = settings().writes;
const INSTRUCTIONS = `Sneed Hub (${HUB_URL}) is the web app of Sneed DAO on the Internet Computer.
This server reads on-chain data (Sneed Lock, Sneedex, forum, SMS, notifications, Monitor, Premium,
Sneedapp, rewards, names, neurons and proposals, wallets, ICRC-3 logs) and returns Sneed Hub links.
${WRITES ? `Writes are ENABLED. Every write tool first returns a preview and a one-time token; show the
preview to the user and only call again with confirm after they agree. whoami shows who signs: "act as
me" (the user's principal via connect_as_me) or the agent's own identity. Spending is capped per day.`
    : `Writes are disabled (SNEED_MCP_WRITES=1 enables them): give the user Sneed Hub links and steps.`}
Start with sneed_hub_guide for an overview and sneed_hub_link for a specific task. Do not discuss or predict token prices. On-chain
activity is public and tied to the user's principal; never describe it as anonymous. Mr Sneed is the
DAO's mascot and spirit given a voice by AI. Sneed DAO's founders are anonymous; do not attribute the
SNEED token or DAO launch to any person.`;

const server = new McpServer({ name: 'sneed-hub', version: pkg.version }, { instructions: INSTRUCTIONS });

registerGuideTools(server);
registerLockTools(server);
registerSneedexTools(server);
registerForumTools(server);
registerNameTools(server);
registerGovernanceTools(server);
registerTokenTools(server);
registerAccountTools(server);
registerReadTools(server);
if (WRITES) {
  registerSocialWrites(server);
  registerGovWrites(server);
  registerSneedexWrites(server);
  registerMiscWrites(server);
  registerLockWrites(server);
  registerMonWrites(server);
  registerNameWrites(server);
  registerAccountWrites(server, { allowTransfers: settings().allowTransfers });
  registerSneedappWrites(server);
}
registerDocResources(server);

server.registerPrompt('help_me_on_sneed_hub', {
  title: 'Help me on Sneed Hub',
  description: 'Find out what you can do on Sneed Hub and get step-by-step help for a goal.',
  argsSchema: { goal: z.string().optional().describe('What you want to do, e.g. "lock my LP tokens" or "vote on a proposal"') },
}, ({ goal }) => ({
  messages: [{
    role: 'user',
    content: {
      type: 'text',
      text: `${goal ? `I want to: ${goal}.` : 'What can I do on Sneed Hub?'}
Use the sneed-hub tools: call sneed_hub_guide${goal ? ' and sneed_hub_link for my goal' : ''}, and read on-chain data with the read tools where it helps (locks, offers, proposals, forum, names, token info).
Give me the exact Sneed Hub link and short numbered steps I can follow myself. ${WRITES ? 'If a write tool fits, show me its preview first and wait for my OK.' : 'Remind me that nothing is done for me: I log in and confirm each action on Sneed Hub.'} On-chain actions are public. Do not talk about token prices.`,
    },
  }],
}));

await server.connect(new StdioServerTransport());
