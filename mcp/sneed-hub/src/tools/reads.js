// Read tools for the other Sneed services. Public reads use the anonymous agent; reads of the signer's
// own private data (SMS, notifications, Monitor balance) are signed queries with the active identity.
import { z } from 'zod';
import { Principal } from '@dfinity/principal';
import { idlFactory as smsIdl } from '../idl/sneed_sms.did.js';
import { idlFactory as notifIdl } from '../idl/sneed_notifications.did.js';
import { idlFactory as monIdl } from '../idl/sneed_mon.did.js';
import { idlFactory as premiumIdl } from '../idl/sneed_premium.did.js';
import { idlFactory as sneedappIdl } from '../idl/sneedapp.did.js';
import { idlFactory as rllIdl } from '../idl/rll.did.js';
import { idlFactory as backendIdl } from '../idl/app_sneeddao_backend.did.js';
import { idlFactory as pidNamesIdl } from '../idl/sneed_pid_names.did.js';
import { idlFactory as nicknamesIdl } from '../idl/sneed_pid_nicknames.did.js';
import { idlFactory as govIdl } from '../idl/sns_governance.did.js';
import { idlFactory as icrc1Idl } from '../idl/icrc1_ledger.did.js';
import { actor, CANISTERS, opt, toPrincipal, ptext, canisterId, signedActor } from '../ic.js';
import { activeIdentity } from '../identity.js';
import { nsToIso, secToIso, plain, variantKey, tokenInfo, formatUnits, shortErr } from '../format.js';
import { textResult, safeText, link, fmt, toHex, icrc3IdlFactory } from '../chain.js';
import { acceptingVotes, votableNeurons, neuronIdHex, PERM } from './w_gov.js';
import { namesOf } from './names.js';

const RO = { readOnlyHint: true, openWorldHint: true };
const clip = (s, n = 300) => (s == null ? '' : s.length > n ? `${s.slice(0, n)}…` : s);
const j = (v) => JSON.stringify(plain(v));

/// One watch of mon_read. next_check_at is 0 until the watch's first check (myWatch in sneed_mon),
/// and checks stop while the balance is paused.
export const monWatchLine = (w, { paused = false } = {}) => {
  const next = BigInt(w.next_check_at) > 0n ? nsToIso(w.next_check_at) : null;
  const when = paused ? 'checks paused (balance used up: top up to resume)' : next ? `next check ${next}` : 'first check pending (in the next round)';
  return `  watching ${w.name} (${j(w.target)}), every ${w.settings.every_min} min, ${when}, ${fmt(w.price_per_check_e8s, ICP_T)}/check`;
};
const ICP_T = { decimals: 8, symbol: 'ICP' };
const me = () => activeIdentity();
const signed = (idl, id) => { const w = me(); return signedActor(idl, id, w.identity); };
const principalArg = z.string().optional().describe('Principal (default: the signing identity)');
const who = (p) => (p ? toPrincipal(p).toText() : me().principal);

/// Run a read of the signer's private data with a clear message when a delegation does not cover it.
const scoped = (id) => {
  const w = me();
  if (w.mode === 'delegation' && w.targets && !w.targets.includes(ptext(id))) throw new Error(`Your Sneed Hub delegation does not cover ${id}; reconnect with a wider scope.`);
};

/// A method the canister does not have (yet): an older build is deployed.
const isMissingMethod = (e) => /has no (query|update) method|method not found|IC0536|IC0302/i.test(String(e?.message || e));
const pageArgs = ({ before = null, after = null, limit = 100 } = {}) => ({ before: before == null ? [] : [before], after: after == null ? [] : [after], limit: BigInt(limit) });

/// The newest `limit` messages of the signer's inbox or outbox and how many there are, from the paged
/// reads (get_received_messages_page / get_sent_messages_page); the full lists on a build without them.
async function smsNewest(s, box, limit) {
  try {
    const page = await s[box === 'outbox' ? 'get_sent_messages_page' : 'get_received_messages_page'](pageArgs({ limit }));
    return { total: Number(page.total), messages: page.messages };
  } catch (e) {
    if (!isMissingMethod(e)) throw e;
    const list = box === 'outbox' ? await s.get_sent_messages() : await s.get_received_messages();
    return { total: list.length, messages: [...list].sort((a, b) => (a.created_at > b.created_at ? -1 : 1)).slice(0, limit) };
  }
}

/// The signer's messages (received and sent) that reply to message `id`: replies have higher ids, so
/// only the ascending pages after it are read (at most 20 pages of each list).
async function smsRepliesTo(s, id) {
  try {
    const found = new Map();
    for (const method of ['get_received_messages_page', 'get_sent_messages_page']) {
      let after = id;
      for (let i = 0; i < 20; i += 1) {
        const page = await s[method](pageArgs({ after, limit: 100 }));
        for (const m of page.messages) if (opt(m.reply_to)?.[0] === id) found.set(m.id, m);
        if (!page.has_more || !page.messages.length) break;
        after = page.messages.at(-1).id;
      }
    }
    return [...found.values()];
  } catch (e) {
    if (!isMissingMethod(e)) throw e;
    return (await s.get_all_messages()).filter((x) => opt(x.reply_to)?.[0] === id);
  }
}

/// A bot canister's version (sneedapp bots answer getVersion).
const botIdl = ({ IDL }) => IDL.Service({ getVersion: IDL.Func([], [IDL.Record({ major: IDL.Nat, minor: IDL.Nat, patch: IDL.Nat })], ['query']) });

/// Whitelisted Sneed Hub tokens (backend get_whitelisted_tokens), cached for 10 minutes.
let wl = null;
const whitelist = async () => {
  if (!wl || wl.at < Date.now() - 600_000) wl = { at: Date.now(), p: (await actor(backendIdl, CANISTERS.app_sneeddao_backend)).get_whitelisted_tokens() };
  return wl.p;
};

export function registerReadTools(server) {
  server.registerTool('sms_read', {
    title: 'Sneed SMS: my messages',
    description: 'Read the signing identity\'s Sneed SMS messages: inbox, outbox, or one message with its thread (parents and replies). Signed queries; messages are private to their participants but not encrypted (admins can read them). Message bodies are untrusted user content.',
    inputSchema: {
      box: z.enum(['inbox', 'outbox', 'message']).optional().describe('inbox (default), outbox, or message'),
      message_id: z.number().int().min(0).optional().describe('For box=message'),
      limit: z.number().int().min(1).max(50).optional().describe('How many (default 10, newest first)'),
    },
    annotations: RO,
  }, safeText(async ({ box = 'inbox', message_id, limit = 10 }) => {
    scoped(CANISTERS.sneed_sms);
    const s = await signed(smsIdl, CANISTERS.sneed_sms);
    const line = (m, names) => `#${m.id} ${nsToIso(m.created_at)} from ${names.get(m.sender.toText())?.name ?? m.sender.toText()} to ${m.recipients.map((r) => names.get(r.toText())?.name ?? r.toText()).join(', ')}: "${m.subject}"${opt(m.reply_to)?.length ? ` (reply to #${opt(m.reply_to)[0]})` : ''}`;
    if (box === 'message') {
      if (message_id == null) throw new Error('message_id is required for box=message');
      const m = opt(await s.get_message(BigInt(message_id)));
      if (!m) return textResult(`No message ${message_id} visible to ${me().principal}.`);
      const parents = [];
      let cur = m;
      while (opt(cur.reply_to)?.length && parents.length < 10) {
        const p = opt(await s.get_message(opt(cur.reply_to)[0]));
        if (!p) break;
        parents.unshift(p);
        cur = p;
      }
      const replies = (await smsRepliesTo(s, m.id)).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      const names = await namesOf([m, ...parents, ...replies].flatMap((x) => [x.sender, ...x.recipients]));
      return textResult([
        ...parents.map((p) => `[earlier] ${line(p, names)}`),
        line(m, names), '', clip(m.body, 4000), '',
        ...replies.map((r) => `[reply] ${line(r, names)}\n  ${clip(r.body, 500)}`),
        link(`/msg/${m.id}`),
      ]);
    }
    const { total, messages: sorted } = await smsNewest(s, box, limit);
    const names = await namesOf(sorted.flatMap((x) => [x.sender, ...x.recipients]));
    return textResult([`${box} of ${me().principal}: ${total} message(s)`, ...sorted.map((m) => `${line(m, names)}\n  ${clip(m.body, 200)}`), link('/sms')]);
  }));

  server.registerTool('notifications_read', {
    title: 'Sneed Notifications: my settings',
    description: 'The signing identity\'s Sneed Notifications: channels, routing per level, apps and their permissions, apps asking for permission, recent history, and the list of apps. Signed queries.',
    inputSchema: { history: z.number().int().min(0).max(50).optional().describe('History items (default 10)') },
    annotations: RO,
  }, safeText(async ({ history = 10 }) => {
    scoped(CANISTERS.sneed_notifications);
    const n = await signed(notifIdl, CANISTERS.sneed_notifications);
    const [s, apps, reqs, hist, all] = await Promise.all([n.get_my_settings(), n.get_my_apps(), n.get_my_requests(), n.get_my_history(BigInt(history)), n.list_apps(1n, 100n)]);
    const lines = [`Notification balance: ${fmt(s.balance_e8s, ICP_T)}`];
    lines.push('Channels:', ...s.channels.map((c) => `  #${c.id} ${variantKey(c.kind)} "${c.name}" ${variantKey(c.state)}`));
    const d = s.settings.defaults;
    lines.push(`Routing: urgent -> [${d.urgent.join(', ')}], normal -> [${d.normal.join(', ')}], info -> [${d.info.join(', ')}]${opt(s.settings.snooze_until) ? `; snoozed until ${nsToIso(opt(s.settings.snooze_until))}` : ''}${opt(s.settings.quiet) ? `; quiet hours ${j(opt(s.settings.quiet))}` : ''}`);
    lines.push('My apps:', ...apps.map(([a, p]) => `  app ${a.id} ${a.name}${a.verified ? ' (verified)' : ''}: ${p.allowed ? 'allowed' : 'blocked'}${p.copy_only ? ', copy only' : ''}${opt(p.muted_until) ? `, muted until ${nsToIso(opt(p.muted_until))}` : ''}`));
    if (reqs.length) lines.push('Asking for permission:', ...reqs.map((a) => `  app ${a.id} ${a.name}`));
    lines.push(`Recent (${hist.length}):`, ...hist.map((h) => `  ${nsToIso(h.created_at)} [${h.app_name}/${variantKey(h.level)}] ${h.title}: ${clip(h.body, 120)}`));
    lines.push(`All apps: ${all.map((a) => `${a.id} ${a.name}`).join('; ')}`);
    lines.push(link('/notifications'));
    return textResult(lines);
  }));

  server.registerTool('mon_read', {
    title: 'Sneed Monitor: tiers and my watches',
    description: 'Sneed Monitor (proposal watching with alerts): price tiers and, for the signing identity, the prepaid balance, deposit account and watches. Needs SNEED_MCP_CANISTER_SNEED_MON until Sneed Monitor has a production id.',
    inputSchema: {},
    annotations: RO,
  }, safeText(async () => {
    let id;
    try { id = canisterId('sneed_mon'); } catch (e) { return textResult(`Sneed Monitor is not available here: ${e.message}`); }
    const pub = await actor(monIdl, id);
    const tiers = await pub.get_tiers();
    const lines = [`Sneed Monitor ${id}. Tiers (base ${fmt(tiers.base_daily_price_e8s, ICP_T)}/day):`, ...tiers.tiers.map((t) => `  every ${t.every_min} min: ${fmt(t.per_check_e8s, ICP_T)}/check, ${fmt(t.daily_price_e8s, ICP_T)}/day`)];
    try {
      scoped(id);
      const m = await signed(monIdl, id);
      const [bal, watches] = await Promise.all([m.get_my_balance(), m.get_my_watches()]);
      lines.push(`My balance: ${fmt(bal.balance_e8s, ICP_T)} (${fmt(bal.per_day_e8s, ICP_T)}/day${bal.paused ? ', PAUSED' : ''}); deposit to ${bal.deposit_account.owner.toText()} subaccount ${toHex(opt(bal.deposit_account.subaccount) ?? [])}`);
      lines.push(...watches.map((w) => monWatchLine(w, { paused: bal.paused })));
    } catch (e) { lines.push(`(my watches: ${shortErr(e)})`); }
    lines.push(link('/notifications'));
    return textResult(lines);
  }));

  server.registerTool('premium_status', {
    title: 'Sneed Premium status and prices',
    description: 'Sneed Premium: membership of a principal (active until / expired), ICP tiers with the prices that apply to that principal (regular, premium, admin, partner), and voting-power tiers.',
    inputSchema: { principal: principalArg },
    annotations: RO,
  }, safeText(async ({ principal }) => {
    const p = toPrincipal(who(principal));
    const a = await actor(premiumIdl, CANISTERS.sneed_premium);
    const [st, vp] = await Promise.all([a.checkMembership(p), a.getVotingPowerTiers()]);
    // get_icp_tier_prices_for arrived with special prices; older deployments only have getIcpTiers
    const prices = await a.get_icp_tier_prices_for(p).catch(async () => (await a.getIcpTiers()).filter((t) => t.active).map((tier) => ({ tier, price_e8s: tier.amountE8s, price_tier: { regular: null } })));
    const status = 'Active' in st ? `ACTIVE until ${nsToIso(st.Active.expiration)}` : 'Expired' in st ? `expired ${nsToIso(st.Expired.expiredAt)}` : 'not a member';
    return textResult([
      `Premium for ${p.toText()}: ${status}`,
      'Buy with ICP:', ...prices.map((x) => `  ${x.tier.name}: ${fmt(x.price_e8s, ICP_T)} for ${Math.round(Number(x.tier.durationNs) / 86400e9)} days (${variantKey(x.price_tier)} price)`),
      'Free with SNEED voting power:', ...vp.filter((t) => t.active).map((t) => `  ${t.name}: ${formatUnits(t.minVotingPowerE8s, 8)} VP for ${Math.round(Number(t.durationNs) / 86400e9)} days`),
      link('/premium'),
    ]);
  }));

  server.registerTool('sneedapp_apps', {
    title: 'Sneedapp: apps and versions',
    description: 'Sneedapp (the app/bot factory): all apps with mint prices, or one app with its versions (and the mint price for a principal).',
    inputSchema: { app_id: z.string().optional().describe('App id, e.g. sneed-icp-staking-bot'), principal: principalArg },
    annotations: RO,
  }, safeText(async ({ app_id, principal }) => {
    const a = await actor(sneedappIdl, CANISTERS.sneedapp);
    if (!app_id) {
      const apps = await a.getApps();
      return textResult([...apps.map((x) => `${x.appId}: ${x.name}${x.enabled ? '' : ' (disabled)'}; mint ${fmt(x.mintPriceE8s, ICP_T)} (premium ${fmt(x.premiumMintPriceE8s, ICP_T)}) ${link(`/sneedapp/app/${x.appId}`)}`), link('/sneedapp')]);
    }
    const [app, versions] = await Promise.all([a.getApp(app_id), a.getAppVersions(app_id)]);
    const x = opt(app);
    if (!x) return textResult(`No app ${app_id}.`);
    let price = '';
    try { const p = await a.getAppMintPrice(app_id, toPrincipal(who(principal))); price = `Mint price for ${who(principal)}: ${j(p)}`; } catch { /* optional */ }
    return textResult([`${x.name} (${x.appId}): ${clip(x.description, 500)}`, price, 'Versions:', ...versions.map((v) => `  ${v.major}.${v.minor}.${v.patch} ${nsToIso(v.releaseDate) ?? ''} wasm ${v.wasmHash.slice(0, 16)}… ${clip(v.releaseNotes, 120)}`), link(`/sneedapp/app/${x.appId}`)]);
  }));

  server.registerTool('sneedapp_my_bots', {
    title: 'Sneedapp: a principal\'s bots',
    description: 'Canisters (bots, apps) minted through Sneedapp for a principal (getUserWallet), with each one\'s version as the bot reports it (getVersion).',
    inputSchema: { principal: principalArg },
    annotations: RO,
  }, safeText(async ({ principal }) => {
    const p = toPrincipal(who(principal));
    const a = await actor(sneedappIdl, CANISTERS.sneedapp);
    // getMyWallet (caller-scoped) has the app ids; for anyone else getManagersByOwner (public) has the ids
    // (getUserWallet is admin-only)
    const entries = p.toText() === me().principal && !(me().mode === 'delegation' && me().targets && !me().targets.includes(CANISTERS.sneedapp))
      ? await (await signed(sneedappIdl, CANISTERS.sneedapp)).getMyWallet()
      : (await a.getManagersByOwner(p)).map((canisterId) => ({ appId: 'app', canisterId }));
    const lines = [`${entries.length} Sneedapp canister(s) of ${p.toText()}:`];
    for (const e of entries.slice(0, 30)) {
      let v = 'version unknown';
      try { const r = await (await actor(botIdl, e.canisterId.toText())).getVersion(); v = `v${r.major}.${r.minor}.${r.patch}`; } catch { /* not a bot */ }
      const path = /trading/.test(e.appId) ? `/trading_bot/${e.canisterId.toText()}` : /staking|neuron/.test(e.appId) ? `/icp_neuron_manager/${e.canisterId.toText()}` : `/canister?id=${e.canisterId.toText()}`;
      lines.push(`  ${e.appId}: ${e.canisterId.toText()} ${v} ${link(path)}`);
    }
    return textResult(lines);
  }));

  server.registerTool('rll_rewards', {
    title: 'Sneed DAO rewards (RLL)',
    description: 'RLL, Sneed DAO\'s reward distribution to neuron holders: claimable rewards of a principal (via its Sneed neurons and their owners\' neurons), past claims, and optionally overall stats (total distributed per token, loop status).',
    inputSchema: { principal: principalArg, stats: z.boolean().optional().describe('Also show overall distribution stats') },
    annotations: RO,
  }, safeText(async ({ principal, stats }) => {
    const p = who(principal);
    const rll = await actor(rllIdl, CANISTERS.rll);
    const { userNeurons } = await import('./w_misc.js');
    const neurons = await userNeurons({ anon: (idl, id) => actor(idl, ptext(id)) }, p);
    const lines = [`Rewards of ${p} (${neurons.length} Sneed neuron(s) with a permission, incl. their owners' neurons):`];
    const bal = neurons.length ? await rll.balances_of_hotkey_neurons(neurons) : [];
    for (const [l, amt] of bal) lines.push(`  claimable ${fmt(amt, await tokenInfo(l))} (${l.toText()})`);
    if (!bal.length) lines.push('  nothing claimable');
    const claims = await rll.get_claim_events_for_hotkey(toPrincipal(p)).catch(() => []);
    if (claims.length) lines.push(`Past claims: ${claims.length}; last ${nsToIso(claims[claims.length - 1].timestamp)} (${variantKey(claims[claims.length - 1].status)})`);
    if (stats) {
      const [tot, loop] = await Promise.all([rll.get_total_distributions(), rll.get_main_loop_status()]);
      lines.push('Distributed in total:');
      for (const [l, amt] of tot) lines.push(`  ${fmt(amt, await tokenInfo(l))}`);
      lines.push(`Loop: ${loop.is_running ? 'running' : 'stopped'}, every ${Math.round(Number(loop.frequency_seconds) / 3600)} h, next ${nsToIso(opt(loop.next_scheduled)) ?? '-'}`);
    }
    lines.push(`Claim on ${link('/rewards')} (or rll_claim). Distribution details: ${link('/rll_info')}; revenue: ${link('/revenue')}`);
    return textResult(lines);
  }));

  server.registerTool('principal_profile', {
    title: 'Profile of a principal',
    description: 'Public Sneed profile of a principal: name, verification, avatar (image URL or NFT avatar), account members; plus your own private nickname for it when the signer has set one.',
    inputSchema: { principal: z.string().describe('Principal') },
    annotations: RO,
  }, safeText(async ({ principal }) => {
    const p = toPrincipal(principal);
    const n = await actor(pidNamesIdl, CANISTERS.sneed_pid_names);
    const info = opt(await n.get_name(p));
    const lines = [`${p.toText()}: ${info && opt(info.name) ? `"${opt(info.name)}"${info.verified ? ' (verified)' : ''}` : 'no public name'}`];
    if (info) {
      const av = opt(info.avatar);
      if (av) lines.push(`Avatar: ${'url' in av ? av.url : `https://${CANISTERS.sneed_avatars}.raw.icp0.io/${toHex(av.blob)}`}`);
      const nft = opt(info.nft_avatar);
      if (nft) lines.push(`NFT avatar: token ${nft.token_id} of ${nft.collection.toText()} (${opt(info.nft_avatar_standard) ?? 'ICRC-7'}; shown only while the owner holds it)`);
      lines.push(`Kind: ${variantKey(info.kind)}${'account' in info.kind ? ` #${info.kind.account}` : ''}`);
    }
    try {
      const w = me();
      if (!(w.mode === 'delegation' && w.targets && !w.targets.includes(CANISTERS.sneed_pid_nicknames))) {
        const nn = await signed(nicknamesIdl, CANISTERS.sneed_pid_nicknames);
        const r = opt((await nn.get_my_nicknames_for([p]))[0]);
        if (r) lines.push(`Your private nickname for it: "${r.nickname}"`);
      }
    } catch { /* optional */ }
    lines.push(link(`/principal?id=${p.toText()}`));
    return textResult(lines);
  }));

  server.registerTool('wallet_balances', {
    title: 'Wallet balances across known tokens',
    description: 'Balances of a principal\'s main account in the tokens Sneed Hub whitelists (backend get_whitelisted_tokens, ICRC tokens; ICP and SNEED first), non-zero only. Each ledger is a separate certified query, so a call checks as many as fit in about 40 seconds and says where to continue (offset). Public on-chain data, no prices.',
    inputSchema: { principal: principalArg, offset: z.number().int().min(0).optional().describe('Continue from this token index'), ledgers: z.array(z.string()).max(50).optional().describe('Only these ledgers') },
    annotations: RO,
  }, safeText(async ({ principal, offset = 0, ledgers }) => {
    const p = toPrincipal(who(principal));
    let tokens = (await whitelist()).filter((t) => String(t.standard).toLowerCase().startsWith('icrc'));
    const first = [CANISTERS.icp_ledger, CANISTERS.sneed_ledger];
    tokens = [...tokens].sort((a, b) => (first.indexOf(b.ledger_id.toText()) - first.indexOf(a.ledger_id.toText())) || a.symbol.localeCompare(b.symbol));
    if (ledgers?.length) tokens = tokens.filter((t) => ledgers.includes(t.ledger_id.toText()));
    const out = [];
    const withTimeout = (pr) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))]);
    const deadline = Date.now() + 40000;
    let failed = 0;
    let i = offset;
    for (; i < tokens.length && Date.now() < deadline; i += 16) {
      await Promise.all(tokens.slice(i, i + 16).map(async (t) => {
        try {
          const b = await withTimeout((await actor(icrc1Idl, t.ledger_id.toText())).icrc1_balance_of({ owner: p, subaccount: [] }));
          if (b > 0n) out.push({ t, b });
        } catch { failed += 1; }
      }));
    }
    const checked = Math.min(i, tokens.length);
    return textResult([
      `${p.toText()}: checked tokens ${offset}-${checked - 1} of ${tokens.length}; ${out.length} held${failed ? ` (${failed} ledgers did not answer)` : ''}`,
      ...out.map(({ t, b }) => `  ${formatUnits(b, t.decimals)} ${t.symbol} (${t.ledger_id.toText()})`),
      checked < tokens.length ? `More: call again with offset ${checked}.` : null,
      `Locked tokens: sneed_lock_list with owner. ${link(`/principal?id=${p.toText()}`)}`,
    ]);
  }));

  server.registerTool('sns_my_neurons', {
    title: 'SNS neurons of a principal and what they can vote on',
    description: 'Neurons in Sneed DAO (or another SNS) on which a principal has permissions (owner or hotkey), with stake and dissolve state, and the open proposals these neurons can still vote on (ballot exists and is uncast), as Sneed Hub\'s votable-proposals badge counts them.',
    inputSchema: { principal: principalArg, governance: z.string().optional().describe(`SNS governance (default Sneed DAO ${CANISTERS.sneed_sns_governance})`) },
    annotations: RO,
  }, safeText(async ({ principal, governance }) => {
    const p = who(principal);
    const govId = governance ?? CANISTERS.sneed_sns_governance;
    const gov = await actor(govIdl, toPrincipal(govId).toText());
    const res = await gov.list_neurons({ of_principal: [toPrincipal(p)], limit: 100, start_page_at: [] });
    const lines = [`${res.neurons.length} neuron(s) in ${govId} where ${p} has permissions:`];
    for (const n of res.neurons) {
      const perms = n.permissions.find((x) => ptext(opt(x.principal)) === p)?.permission_type ?? [];
      const d = opt(n.dissolve_state);
      const ds = !d ? '-' : 'DissolveDelaySeconds' in d ? `not dissolving, delay ${Math.round(Number(d.DissolveDelaySeconds) / 86400)} d` : `dissolving until ${secToIso(d.WhenDissolvedTimestampSeconds)}`;
      lines.push(`  ${neuronIdHex(n)}: stake ${formatUnits(n.cached_neuron_stake_e8s, 8)}, ${ds}, permissions [${perms.join(',')}]${perms.includes(PERM.VOTE) ? ' (can vote)' : ''}${perms.includes(PERM.SUBMIT_PROPOSAL) ? ' (can propose)' : ''}`);
    }
    const voters = res.neurons.filter((n) => n.permissions.some((x) => ptext(opt(x.principal)) === p && x.permission_type.includes(PERM.VOTE)));
    const props = await gov.list_proposals({ limit: 50, before_proposal: [], exclude_type: [], include_status: [], include_reward_status: [], include_topics: [] });
    const open = props.proposals.filter((x) => acceptingVotes(x));
    const votable = open.map((x) => ({ x, ns: votableNeurons(x, voters) })).filter((v) => v.ns.length);
    lines.push(`Open proposals: ${open.length}; votable by these neurons: ${votable.length}`);
    const root = govId === CANISTERS.sneed_sns_governance ? CANISTERS.sneed_sns_root : '';
    for (const { x, ns } of votable) lines.push(`  #${opt(x.id).id} "${opt(x.proposal)?.title}" (${ns.length} neuron(s), deadline ${secToIso(opt(x.wait_for_quiet_state)?.current_deadline_timestamp_seconds ?? 0n) ?? '-'}) ${link(`/proposal?proposalid=${opt(x.id).id}&sns=${root}`)}`);
    lines.push(`Vote with sns_vote (needs writes and a hotkey), or on ${link('/active_proposals')}.`);
    return textResult(lines);
  }));

  server.registerTool('special_prices', {
    title: 'Special prices of a Sneed canister',
    description: 'Admin and partner prices (get_special_prices / get_special_prices_for) of a charging Sneed canister: sneedex, sneed_lock, sneed_premium, sneedapp, sneed_mon, sneed_pad, sneed_guardian, backend. The lowest of regular, premium, admin and partner applies.',
    inputSchema: { canister: z.string().describe('Canister id or name (e.g. "sneedex")'), principal: z.string().optional().describe('Show what applies to this principal') },
    annotations: RO,
  }, safeText(async ({ canister, principal }) => {
    const id = CANISTERS[canister] ?? toPrincipal(canister).toText();
    if (!id) throw new Error(`${canister} has no configured canister id.`);
    const known = { [CANISTERS.sneedex]: (await import('../idl/sneedex.did.js')).idlFactory, [CANISTERS.sneed_lock]: (await import('../idl/sneed_lock.did.js')).idlFactory, [CANISTERS.sneed_premium]: premiumIdl, [CANISTERS.sneedapp]: sneedappIdl, [CANISTERS.app_sneeddao_backend]: backendIdl };
    if (CANISTERS.sneed_mon) known[CANISTERS.sneed_mon] = monIdl;
    if (!known[id]) return textResult(`No interface bundled for ${id}; supported: sneedex, sneed_lock, sneed_premium, sneedapp, app_sneeddao_backend${CANISTERS.sneed_mon ? ', sneed_mon' : ''}.`);
    const a = await actor(known[id], id);
    let all;
    try { all = await a.get_special_prices(); } catch (e) {
      if (/has no query method|did not find|not found|IC0536/i.test(String(e.message))) return textResult(`${id} does not offer special prices yet (not deployed there): regular and premium prices apply.`);
      throw e;
    }
    const lines = [`Special prices of ${id}:`, `  admin prices (for its admins): ${j(all.admin_prices)}`, ...all.partners.map((pt) => `  partner ${pt.principal.toText()} "${pt.label}": ${j(pt.prices)}${opt(pt.expires_at) ? ` until ${nsToIso(opt(pt.expires_at))}` : ''}`)];
    if (principal) {
      const f = await a.get_special_prices_for(toPrincipal(principal));
      lines.push(`For ${principal}: admin ${j(opt(f.admin_prices))}, partner ${j(opt(f.partner))}`);
    }
    return textResult(lines);
  }));

  server.registerTool('icrc3_log', {
    title: 'ICRC-3 activity log of a Sneed canister',
    description: 'Browse the ICRC-3 log (public, certified activity log) of any canister that has one: sneed_lock, sneedex, sneedapp, sneed_premium, rll, sneed_sns_forum, sneed_pid_names, sneed_neuron_names, sneed_profiles, mr_sneed, ledgers. Shows log length, archives and blocks (newest first by default).',
    inputSchema: {
      canister: z.string().describe('Canister id or name (e.g. "sneed_lock")'),
      start: z.number().int().min(0).optional().describe('First block index (default: the newest `length` blocks)'),
      length: z.number().int().min(1).max(50).optional().describe('Blocks (default 10)'),
    },
    annotations: RO,
  }, safeText(async ({ canister, start, length = 10 }) => {
    const id = CANISTERS[canister] ?? toPrincipal(canister).toText();
    const a = await actor(icrc3IdlFactory, id);
    const head = await a.icrc3_get_blocks([]);
    const total = BigInt(head.log_length);
    const from = start != null ? BigInt(start) : (total > BigInt(length) ? total - BigInt(length) : 0n);
    const r = await a.icrc3_get_blocks([{ start: from, length: BigInt(length) }]);
    let blocks = [...r.blocks];
    for (const arc of r.archived_blocks) {
      try {
        const [principal, method] = [arc.callback[0], arc.callback[1]];
        const archIdl = ({ IDL }) => { const svc = icrc3IdlFactory({ IDL }); return IDL.Service({ [method]: svc._fields.find(([n]) => n === 'icrc3_get_blocks')[1] }); };
        const ar = await actor(archIdl, principal.toText());
        blocks.push(...(await ar[method](arc.args)).blocks);
      } catch { /* archive unreadable */ }
    }
    blocks.sort((x, y) => (x.id > y.id ? -1 : 1));
    const val = (v) => {
      const k = variantKey(v);
      if (k === 'Map') return Object.fromEntries(v.Map.map(([kk, vv]) => [kk, val(vv)]));
      if (k === 'Array') return v.Array.map(val);
      if (k === 'Blob') {
        const b = v.Blob;
        if ((b.length === 29 && b[28] === 2) || (b.length === 10 && b[9] === 1)) { try { return Principal.fromUint8Array(Uint8Array.from(b)).toText(); } catch { /* hex */ } }
        return toHex(b);
      }
      return plain(v[k]);
    };
    const lines = [`ICRC-3 log of ${id}: ${total} blocks. Showing ${blocks.length} from ${from}.`];
    for (const b of blocks) {
      const m = val(b.block);
      const btype = m.btype ?? m.tx?.op ?? '?';
      const ts = m.ts != null ? nsToIso(BigInt(m.ts)) : '';
      const tx = { ...(m.tx ?? m) };
      delete tx.phash;
      lines.push(`#${b.id} ${btype} ${ts} ${clip(JSON.stringify(tx), 400)}`);
    }
    lines.push(link(`/tools/icrc3?canister=${id}`));
    return textResult(lines);
  }));
}
