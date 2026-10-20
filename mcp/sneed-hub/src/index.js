#!/usr/bin/env node
// Sneed Hub MCP server (stdio). Read-only: anonymous queries to the Internet Computer plus deep
// links into https://app.sneeddao.com. It holds no keys and changes no state.
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
import { HUB_URL } from './ic.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const INSTRUCTIONS = `Sneed Hub (${HUB_URL}) is the web app of Sneed DAO on the Internet Computer.
This server is read-only: it reads public on-chain data (Sneed Lock, Sneedex, the forum, Sneed names,
Sneed DAO proposals, any ICRC-1 token) and returns Sneed Hub links with steps. It cannot sign or send
anything; the user completes actions on Sneed Hub themselves. Start with sneed_hub_guide for an
overview and sneed_hub_link for a specific task. Do not discuss or predict token prices. On-chain
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
Give me the exact Sneed Hub link and short numbered steps I can follow myself. Remind me that nothing is done for me: I log in and confirm each action on Sneed Hub, and on-chain actions are public. Do not talk about token prices.`,
    },
  }],
}));

await server.connect(new StdioServerTransport());
