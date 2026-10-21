// Identity tools: whoami, connect_as_me (act as the user via a Sneed Hub delegation), disconnect.
import { z } from 'zod';
import { activeIdentity, ownIdentity, loadDelegation, deleteDelegation } from '../identity.js';
import { startConnect, pendingStatus, acceptChain } from '../connect.js';
import { settings } from '../config.js';
import { ledgerActor, CANISTERS, toPrincipal } from '../ic.js';
import { tokenInfo } from '../format.js';
import { textResult, safeText, link, fmt, accountId, toHex } from '../chain.js';
import { getGuard } from '../writes.js';

const balances = async (principal) => {
  const out = [];
  for (const id of [CANISTERS.icp_ledger, CANISTERS.sneed_ledger]) {
    try {
      const t = await tokenInfo(id);
      const b = await (await ledgerActor(id)).icrc1_balance_of({ owner: toPrincipal(principal), subaccount: [] });
      out.push(`${fmt(b, t)}`);
    } catch (e) { out.push(`(${id}: unreadable)`); }
  }
  return out.join(', ');
};

export function registerAccountTools(server) {
  server.registerTool('whoami', {
    title: 'Who am I (signing identity)',
    description: 'Shows the identity this server signs with: "act as me" (the user\'s own principal through a Sneed Hub delegation, with its scope and expiry) or the agent\'s own identity (dfx identity, PEM or generated key); its ICP and SNEED balances; whether writes are enabled; caps; and how to fund it or make it a hotkey on a neuron. Never shows private keys.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeText(async () => {
    const s = settings();
    const lines = [];
    let who;
    try { who = activeIdentity(); } catch (e) { return textResult(`No identity: ${e.message}`); }
    if (who.mode === 'delegation') {
      lines.push(`Mode: ACT AS ME. Signing as ${who.principal} (the user's own Sneed Hub principal) through a delegation approved on Sneed Hub.`);
      lines.push(`Agent label: ${who.agent_name ?? '-'}; valid until ${who.expires} (delegations cannot be revoked on-chain; use disconnect to delete it here).`);
      lines.push(`Scope: ${who.targets ? `only these canisters: ${who.targets.join(', ')}` : 'any canister (everything)'}`);
      try { const o = ownIdentity(); lines.push(`(The agent's own identity, used after disconnect: ${o.principal}, ${o.source}.)`); } catch { /* none */ }
    } else {
      lines.push(`Mode: OWN IDENTITY. Signing as ${who.principal} (${who.source}${who.created ? ', key generated just now' : ''}).`);
      lines.push('To act as the user on their own assets instead, call connect_as_me.');
    }
    lines.push(`Balances of ${who.principal}: ${await balances(who.principal)}`);
    lines.push(`ICP account id (for exchanges that need one): ${accountId(who.principal)}`);
    lines.push(`Writes: ${s.writes ? 'ENABLED' : 'disabled (set SNEED_MCP_WRITES=1 or "writes": true in the config file to register the write tools)'}; plain transfers ${s.allowTransfers ? 'allowed' : 'disabled'}.`);
    const g = getGuard();
    const caps = [];
    for (const [k, v] of Object.entries(s.caps)) {
      let spent = '';
      try { const t = await tokenInfo(k); if (t.decimals != null) spent = ` (spent today ${fmt(g.spentToday(k), t)})`; } catch { /* symbol keys */ }
      caps.push(`${k}: ${v}/day${spent}`);
    }
    lines.push(`Daily caps: ${caps.join('; ')}. Audit log: ${s.auditPath}`);
    if (who.mode === 'own') {
      lines.push('Fund it: send a small amount of ICP or SNEED to the principal above (Sneed Hub wallet: Send, paste the principal).');
      lines.push(`Let it vote for you without giving it your tokens: on ${link('/neurons')} open your SNEED neuron, "Add hotkey", paste ${who.principal} (a hotkey gets Vote and Submit proposal permissions). Votes are public and tied to the neuron.`);
    }
    lines.push(`Profile: ${link(`/principal?id=${who.principal}`)}`);
    return textResult(lines);
  }));

  server.registerTool('connect_as_me', {
    title: 'Act as me: connect to my Sneed Hub login',
    description: 'Start "act as me": returns a Sneed Hub link (/connect-agent) for the USER to open. They log in, check the code, choose what the agent may touch (Sneed canisters by default; optionally ICP/SNEED ledgers, chosen NFT collections or everything) and for how long (1 h, 24 h, 7 days), and approve. Sneed Hub then hands this server a delegation through a short-lived listener on 127.0.0.1, after which writes are signed as the user\'s principal. Call again with `status: true` to check, or with `code` to paste the approval if the browser could not reach the listener.',
    inputSchema: {
      agent_name: z.string().max(60).optional().describe('Label shown to the user on Sneed Hub (default "Sneed Hub MCP agent")'),
      status: z.boolean().optional().describe('Only report whether the pending connection completed'),
      code: z.string().optional().describe('The approval code copied from Sneed Hub (fallback when the browser could not reach this machine)'),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeText(async ({ agent_name, status, code }) => {
    if (code) {
      const st = acceptChain(code);
      return textResult(`Connected: acting as ${st.principal} until ${st.expires}. Scope: ${st.targets ? st.targets.join(', ') : 'everything'}.`);
    }
    if (status) {
      const p = pendingStatus();
      const d = loadDelegation();
      if (d) return textResult(`Connected: acting as ${d.principal} until ${d.expires}. Scope: ${d.targets ? d.targets.join(', ') : 'everything'}.`);
      if (!p) return textResult('Not connected and no connection pending. Call connect_as_me to start.');
      return textResult(p.error ? `Not connected yet; last attempt failed: ${p.error}` : `Waiting for the user to approve on Sneed Hub (code ${p.code}).`);
    }
    const r = await startConnect({ agentName: agent_name });
    return textResult([
      'Ask the user to open this link in the browser where they use Sneed Hub (it only works on this computer, because the approval comes back to 127.0.0.1):',
      r.url,
      `They should check that Sneed Hub shows the code ${r.code}, pick the scope and expiry, and approve.`,
      `Listening until ${r.listening_until}. Then call connect_as_me with status: true. If the page cannot reach this computer, it shows an approval code: pass it as connect_as_me({ code }).`,
      'While connected, write tools act as the user (each still needs a preview and confirmation). The delegation is valid until it expires; disconnect deletes it here.',
    ]);
  }));

  server.registerTool('disconnect', {
    title: 'Stop acting as me',
    description: 'Delete the stored "act as me" delegation, so this server signs with the agent\'s own identity again. (A delegation cannot be revoked on-chain; deleting the only copy of the session key makes it unusable.)',
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }, safeText(async () => textResult(deleteDelegation() ? 'Disconnected: the delegation and its session key were deleted. Writes now use the agent\'s own identity.' : 'No delegation was stored.')));
}

export { toHex };
