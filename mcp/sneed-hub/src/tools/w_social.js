// Write tools: forum (thread, post/reply, edit own post, tip), Sneed SMS, own Sneed name.
// Call sequences mirror the frontend: pages/Topic.jsx (create_thread), components/ThreadViewer.jsx
// (create_post, update_post, tips via utils/BackendUtils.js createTip), pages/SMS.jsx (send_message),
// pages/Me.jsx -> utils/NamingService.js (set_my_name).
import { z } from 'zod';
import { idlFactory as forumIdl } from '../idl/sneed_sns_forum.did.js';
import { idlFactory as smsIdl } from '../idl/sneed_sms.did.js';
import { idlFactory as pidNamesIdl } from '../idl/sneed_pid_names.did.js';
import { idlFactory as icrc1Idl } from '../idl/icrc1_ledger.did.js';
import { idlFactory as govIdl } from '../idl/sns_governance.did.js';
import { CANISTERS, opt, toPrincipal, ptext } from '../ic.js';
import { defineWrite, unwrapResult } from '../writes.js';
import { spend, toBaseUnits, ledgerFee, fmt, link, toHex, fromHex, governanceOfRoot } from '../chain.js';
import { plain, shortErr } from '../format.js';

const forumErr = (e) => { const k = Object.keys(e)[0]; return `${k}: ${e[k]}`; };
const forumOk = (r, what) => { if ('err' in r) throw new Error(`${what}: ${forumErr(r.err)}`); return r.ok; };

export const forumWrites = [
  {
    name: 'forum_create_thread',
    title: 'Forum: start a thread',
    description: 'Start a new thread in a forum topic (sneed_sns_forum.create_thread). Use forum_browse to find the topic id. Posts are public and show your principal.',
    inputSchema: {
      topic_id: z.number().int().min(0).describe('Topic id'),
      title: z.string().min(1).max(500).describe('Thread title'),
      body: z.string().min(1).max(30000).describe('Thread body (markdown)'),
    },
    async build({ topic_id, title, body }, ctx) {
      const f = await ctx.anon(forumIdl, CANISTERS.sneed_sns_forum);
      const [topic, limits] = await Promise.all([f.get_topic(BigInt(topic_id)), f.get_text_limits()]);
      const t = opt(topic);
      const problems = [];
      if (!t) problems.push(`No topic ${topic_id}.`);
      if (title.trim().length > Number(limits.thread_title_max_length)) problems.push(`Title longer than ${limits.thread_title_max_length} characters.`);
      if (body.trim().length > Number(limits.thread_body_max_length)) problems.push(`Body longer than ${limits.thread_body_max_length} characters.`);
      return {
        summary: `New thread "${title.trim()}" in topic ${topic_id}${t ? ` (${t.title})` : ''}`,
        calls: [{ canister: CANISTERS.sneed_sns_forum, method: 'create_thread', args: { topic_id, title: [title.trim()], body: body.trim() } }],
        problems,
      };
    },
    async run({ topic_id, title, body }, ctx) {
      const f = await ctx.signed(forumIdl, CANISTERS.sneed_sns_forum);
      const id = forumOk(await f.create_thread({ topic_id: BigInt(topic_id), title: [title.trim()], body: body.trim() }), 'create_thread');
      return { ok: true, summary: `thread ${id} created`, links: [link(`/thread?threadid=${id}`)] };
    },
  },
  {
    name: 'forum_post',
    title: 'Forum: post or reply',
    description: 'Post in a forum thread, or reply to a post in it (sneed_sns_forum.create_post(thread_id, reply_to_post_id, title, body)). Public, tied to your principal.',
    inputSchema: {
      thread_id: z.number().int().min(0).describe('Thread id'),
      body: z.string().min(1).max(30000).describe('Post body (markdown)'),
      reply_to_post_id: z.number().int().min(0).optional().describe('Reply to this post'),
      title: z.string().max(500).optional().describe('Optional post title'),
    },
    async build({ thread_id, body, reply_to_post_id, title }, ctx) {
      const f = await ctx.anon(forumIdl, CANISTERS.sneed_sns_forum);
      const [thread, limits] = await Promise.all([f.get_thread(BigInt(thread_id)), f.get_text_limits()]);
      const problems = [];
      const t = opt(thread);
      if (!t) problems.push(`No thread ${thread_id}.`);
      if (body.trim().length > Number(limits.post_body_max_length)) problems.push(`Body longer than ${limits.post_body_max_length} characters.`);
      if (reply_to_post_id != null) {
        const p = opt(await f.get_post(BigInt(reply_to_post_id)));
        if (!p || BigInt(p.thread_id) !== BigInt(thread_id)) problems.push(`Post ${reply_to_post_id} is not in thread ${thread_id}.`);
      }
      return {
        summary: `${reply_to_post_id != null ? `Reply to post ${reply_to_post_id}` : 'Post'} in thread ${thread_id}${t ? ` ("${opt(t.title) ?? ''}")` : ''}`,
        calls: [{ canister: CANISTERS.sneed_sns_forum, method: 'create_post', args: [thread_id, reply_to_post_id != null ? [reply_to_post_id] : [], title?.trim() ? [title.trim()] : [], body.trim()] }],
        problems,
      };
    },
    async run({ thread_id, body, reply_to_post_id, title }, ctx) {
      const f = await ctx.signed(forumIdl, CANISTERS.sneed_sns_forum);
      const id = forumOk(await f.create_post(BigInt(thread_id), reply_to_post_id != null ? [BigInt(reply_to_post_id)] : [], title?.trim() ? [title.trim()] : [], body.trim()), 'create_post');
      return { ok: true, summary: `post ${id} created`, links: [link(`/post?postid=${id}`)] };
    },
  },
  {
    name: 'forum_edit_post',
    title: 'Forum: edit my post',
    description: 'Edit one of your own forum posts (sneed_sns_forum.update_post(id, title, body)). The previous text stays visible in the canister\'s public history.',
    inputSchema: {
      post_id: z.number().int().min(0).describe('Post id'),
      body: z.string().min(1).max(30000).describe('New body'),
      title: z.string().max(500).optional().describe('New title (omit for none)'),
    },
    async build({ post_id, body, title }, ctx) {
      const f = await ctx.anon(forumIdl, CANISTERS.sneed_sns_forum);
      const p = opt(await f.get_post(BigInt(post_id)));
      const problems = [];
      if (!p) problems.push(`No post ${post_id}.`);
      else if (p.created_by.toText() !== ctx.principal) problems.push(`Post ${post_id} was written by ${p.created_by.toText()}, not by ${ctx.principal}.`);
      return {
        summary: `Edit post ${post_id}`,
        calls: [{ canister: CANISTERS.sneed_sns_forum, method: 'update_post', args: [post_id, title?.trim() ? [title.trim()] : [], body.trim()] }],
        notes: p ? [`Current text: ${p.body.length > 300 ? `${p.body.slice(0, 300)}…` : p.body}`] : [],
        problems,
      };
    },
    async run({ post_id, body, title }, ctx) {
      const f = await ctx.signed(forumIdl, CANISTERS.sneed_sns_forum);
      forumOk(await f.update_post(BigInt(post_id), title?.trim() ? [title.trim()] : [], body.trim()), 'update_post');
      return { ok: true, summary: `post ${post_id} updated`, links: [link(`/post?postid=${post_id}`)] };
    },
  },
  {
    name: 'forum_tip_post',
    title: 'Forum: tip a post',
    description: 'Tip the author of a forum post with any ICRC-1 token, as Sneed Hub does: an icrc1_transfer of the amount from your main account to the author\'s main account (you pay the ledger fee on top), then sneed_sns_forum.create_tip(author, post, ledger, amount, block) so the forum verifies and shows it. Counts toward the daily cap.',
    inputSchema: {
      post_id: z.number().int().min(0).describe('Post id'),
      ledger: z.string().describe(`Token ledger canister id (SNEED ${CANISTERS.sneed_ledger}, ICP ${CANISTERS.icp_ledger})`),
      amount: z.string().describe('Amount in whole tokens, e.g. "10" or "0.5"'),
    },
    async build({ post_id, ledger, amount }, ctx) {
      const f = await ctx.anon(forumIdl, CANISTERS.sneed_sns_forum);
      const p = opt(await f.get_post(BigInt(post_id)));
      if (!p) throw new Error(`No post ${post_id}.`);
      const ledgerId = toPrincipal(ledger, 'ledger canister id').toText();
      const { amount: base, token } = await toBaseUnits(ledgerId, amount);
      if (base <= 0n) throw new Error('Amount must be positive.');
      const fee = await ledgerFee(ledgerId);
      const author = p.created_by.toText();
      const problems = author === ctx.principal ? ['You cannot tip your own post.'] : [];
      const l = await ctx.anon(icrc1Idl, ledgerId);
      const bal = await l.icrc1_balance_of({ owner: toPrincipal(ctx.principal), subaccount: [] });
      if (bal < base + fee) problems.push(`Balance ${fmt(bal, token)} is below ${fmt(base + fee, token)} (tip + fee).`);
      return {
        summary: `Tip ${fmt(base, token)} to ${author} for post ${post_id}`,
        calls: [
          { canister: ledgerId, method: 'icrc1_transfer', args: { to: { owner: author, subaccount: [] }, amount: base, fee: [], memo: [], from_subaccount: [], created_at_time: [] } },
          { canister: CANISTERS.sneed_sns_forum, method: 'create_tip', args: [author, post_id, ledgerId, base, ['<block index of the transfer>']] },
        ],
        spends: [await spend(ledgerId, base + fee, `tip ${fmt(base, token)} + ledger fee ${fmt(fee, token)}`, `post author ${author}`)],
        problems,
      };
    },
    async run({ post_id, ledger, amount }, ctx, plan) {
      const ledgerId = toPrincipal(ledger).toText();
      const author = toPrincipal(plan.calls[0].args.to.owner);
      const base = BigInt(plan.calls[0].args.amount);
      const l = await ctx.signed(icrc1Idl, ledgerId);
      const tr = await l.icrc1_transfer({ to: { owner: author, subaccount: [] }, amount: base, fee: [], memo: [], from_subaccount: [], created_at_time: [] });
      if ('Err' in tr) return { ok: false, error: `Transfer refused, nothing was sent: ${JSON.stringify(plain(tr.Err))}` };
      const block = tr.Ok;
      const steps = [`sent ${base} base units to ${author.toText()} (ledger block ${block})`];
      const f = await ctx.signed(forumIdl, CANISTERS.sneed_sns_forum);
      let r;
      try { r = await f.create_tip(author, BigInt(post_id), toPrincipal(ledgerId), base, [block]); } catch (e) {
        return { ok: false, spent: true, steps, error: `the tokens were sent but recording the tip failed: ${shortErr(e)}`, recovery: 'Do NOT send again. The author has the tokens; the tip is just not shown on the post.' };
      }
      if ('err' in r) return { ok: false, spent: true, steps, error: `the tokens were sent but the forum did not record the tip: ${forumErr(r.err)}`, recovery: 'Do NOT send again.' };
      const tip = opt(await f.get_tip(r.ok).catch(() => []));
      const verified = tip ? opt(tip.verified) : null;
      steps.push(`tip ${r.ok} recorded${verified === true ? ' and verified on the ledger' : verified === false ? `, not verified yet (${opt(tip.verification_note) ?? ''})` : ''}`);
      return { ok: true, spent: true, summary: `tipped post ${post_id}`, steps, links: [link(`/post?postid=${post_id}`)] };
    },
  },
  {
    name: 'forum_vote',
    title: 'Forum: vote on a post or thread',
    description: 'Up- or downvote a forum post or thread with your neurons in the forum\'s SNS, or retract your vote, as Sneed Hub does: sneed_sns_forum.vote_on_post_with_neurons / vote_on_thread_with_neurons (or retract_vote_with_neurons / retract_thread_vote_with_neurons) with every neuron that lists you (e.g. as hotkey). Votes weigh by voting power and are public.',
    inputSchema: {
      post_id: z.number().int().min(0).optional().describe('Post id (or thread_id)'),
      thread_id: z.number().int().min(0).optional().describe('Thread id (or post_id)'),
      vote: z.enum(['up', 'down', 'retract']).describe('up, down, or retract your vote'),
    },
    async build({ post_id, thread_id, vote }, ctx) {
      if ((post_id == null) === (thread_id == null)) throw new Error('Give either post_id or thread_id.');
      const f = await ctx.anon(forumIdl, CANISTERS.sneed_sns_forum);
      const problems = [];
      let tid = thread_id;
      let author = null;
      if (post_id != null) {
        const p = opt(await f.get_post(BigInt(post_id)));
        if (!p) throw new Error(`No post ${post_id}.`);
        tid = Number(p.thread_id);
        author = p.created_by.toText();
      } else {
        const t = opt(await f.get_thread(BigInt(thread_id)));
        if (!t) throw new Error(`No thread ${thread_id}.`);
        author = t.created_by.toText();
      }
      const c = opt(await f.get_thread_context(BigInt(tid)));
      const root = c ? opt(c.sns_root_canister_id) : null;
      if (!root) throw new Error(`Thread ${tid} belongs to no SNS forum, so there are no neurons to vote with.`);
      const gov = await ctx.anon(govIdl, await governanceOfRoot(ctx, root));
      const neurons = (await gov.list_neurons({ of_principal: [toPrincipal(ctx.principal)], limit: 100, start_page_at: [] })).neurons
        .filter((n) => n.permissions.some((p) => ptext(opt(p.principal)) === ctx.principal));
      if (!neurons.length) problems.push(`${ctx.principal} is listed on no neuron of SNS ${root.toText()}, so it has no voting power on this forum. Add it as a hotkey on your neuron (${link('/neurons')}).`);
      if (vote !== 'retract' && author === ctx.principal) problems.push('That is your own post or thread.');
      const ids = neurons.map((n) => toHex(opt(n.id).id));
      const kind = post_id != null ? 'post' : 'thread';
      const id = post_id ?? thread_id;
      const method = vote === 'retract' ? (kind === 'post' ? 'retract_vote_with_neurons' : 'retract_thread_vote_with_neurons') : (kind === 'post' ? 'vote_on_post_with_neurons' : 'vote_on_thread_with_neurons');
      const args = vote === 'retract' ? [id, ids.map((x) => ({ id: x }))] : [id, vote === 'up' ? { upvote: null } : { downvote: null }, ids.map((x) => ({ id: x }))];
      return {
        summary: `${vote === 'retract' ? 'Retract your vote on' : vote === 'up' ? 'Upvote' : 'Downvote'} ${kind} ${id} with ${neurons.length} neuron(s)`,
        calls: [{ canister: CANISTERS.sneed_sns_forum, method, args }],
        notes: ['Forum votes are public and weigh by the neurons\' voting power; neurons without voting power are skipped.'],
        problems,
        _method: method, _ids: ids,
      };
    },
    async run({ post_id, thread_id, vote }, ctx, plan) {
      const f = await ctx.signed(forumIdl, CANISTERS.sneed_sns_forum);
      const id = BigInt(post_id ?? thread_id);
      const ids = plan._ids.map((x) => ({ id: fromHex(x) }));
      const r = vote === 'retract' ? await f[plan._method](id, ids) : await f[plan._method](id, vote === 'up' ? { upvote: null } : { downvote: null }, ids);
      forumOk(r, plan._method);
      return { ok: true, summary: `${plan._method}(${id}) done with ${ids.length} neuron(s)`, links: [link(post_id != null ? `/post?postid=${post_id}` : `/thread?threadid=${thread_id}`)] };
    },
  },
  {
    name: 'forum_delete',
    title: 'Forum: delete my post or thread',
    description: 'Delete one of your own forum posts or threads (sneed_sns_forum.delete_post / delete_thread, as Sneed Hub\'s delete button). The forum keeps it hidden, not erased: admins can restore it and its text stays in the canister\'s history.',
    inputSchema: {
      post_id: z.number().int().min(0).optional().describe('Post id (or thread_id)'),
      thread_id: z.number().int().min(0).optional().describe('Thread id (or post_id)'),
    },
    destructive: true,
    async build({ post_id, thread_id }, ctx) {
      if ((post_id == null) === (thread_id == null)) throw new Error('Give either post_id or thread_id.');
      const f = await ctx.anon(forumIdl, CANISTERS.sneed_sns_forum);
      const kind = post_id != null ? 'post' : 'thread';
      const id = post_id ?? thread_id;
      const item = opt(kind === 'post' ? await f.get_post(BigInt(id)) : await f.get_thread(BigInt(id)));
      const problems = [];
      if (!item) problems.push(`No ${kind} ${id} (or it is deleted already).`);
      else if (item.created_by.toText() !== ctx.principal) problems.push(`${kind} ${id} was written by ${item.created_by.toText()}, not by ${ctx.principal}. Only your own (admins moderate on Sneed Hub).`);
      return {
        summary: `Delete your ${kind} ${id}${item && opt(item.title) ? ` ("${opt(item.title)}")` : ''}`,
        calls: [{ canister: CANISTERS.sneed_sns_forum, method: kind === 'post' ? 'delete_post' : 'delete_thread', args: [id] }],
        notes: item ? [`Text: ${item.body.length > 200 ? `${item.body.slice(0, 200)}…` : item.body}`, 'Hidden, not erased: the text stays in the forum\'s public history.'] : [],
        problems,
      };
    },
    async run({ post_id, thread_id }, ctx) {
      const f = await ctx.signed(forumIdl, CANISTERS.sneed_sns_forum);
      if (post_id != null) forumOk(await f.delete_post(BigInt(post_id)), 'delete_post');
      else forumOk(await f.delete_thread(BigInt(thread_id)), 'delete_thread');
      return { ok: true, summary: `${post_id != null ? `post ${post_id}` : `thread ${thread_id}`} deleted` };
    },
  },
  {
    name: 'sms_send',
    title: 'Sneed SMS: send a message',
    description: 'Send a Sneed SMS message (sneed_sms.send_message). Messages are private to sender and recipients, but NOT encrypted: Sneed SMS admins can read them. Rate limits and length limits apply (higher for Premium members).',
    inputSchema: {
      recipients: z.array(z.string()).min(1).max(50).describe('Recipient principals'),
      subject: z.string().min(1).max(500).describe('Subject'),
      body: z.string().min(1).max(20000).describe('Body'),
      reply_to: z.number().int().min(0).optional().describe('Message id this replies to'),
    },
    async build({ recipients, subject, body, reply_to }, ctx) {
      const ps = recipients.map((r) => toPrincipal(r).toText());
      const s = await ctx.anon(smsIdl, CANISTERS.sneed_sms);
      const cfg = await s.get_config();
      const problems = [];
      if (ps.length > Number(cfg.max_recipients)) problems.push(`More than ${cfg.max_recipients} recipients (Premium allows more).`);
      if (body.trim().length > Number(cfg.max_body_length)) problems.push(`Body over ${cfg.max_body_length} characters (Premium allows more); the canister decides.`);
      return {
        summary: `Message "${subject.trim()}" to ${ps.join(', ')}`,
        calls: [{ canister: CANISTERS.sneed_sms, method: 'send_message', args: { recipients: ps, subject: subject.trim(), body: body.trim(), reply_to: reply_to != null ? [[reply_to]] : [] } }],
        notes: ['Not end-to-end encrypted: SMS admins can read messages. Recipients see your principal.'],
        problems: problems.filter((p) => !p.includes('the canister decides')),
      };
    },
    async run({ recipients, subject, body, reply_to }, ctx) {
      const s = await ctx.signed(smsIdl, CANISTERS.sneed_sms);
      const r = await s.send_message({ recipients: recipients.map((x) => toPrincipal(x)), subject: subject.trim(), body: body.trim(), reply_to: reply_to != null ? [[BigInt(reply_to)]] : [] });
      const id = forumOk(r, 'send_message');
      return { ok: true, summary: `message ${id} sent`, links: [link(`/msg/${id}`)] };
    },
  },
  {
    name: 'name_set',
    title: 'Set my Sneed name',
    description: 'Set (or clear with "") the public Sneed name of the signing principal (sneed_pid_names.set_my_name). 1-32 characters: letters, digits, space, - _ . \' ; unique (case-insensitive); moderated.',
    inputSchema: { name: z.string().max(32).describe('The new name, or "" to clear it') },
    async build({ name }, ctx) {
      const problems = [];
      if (name !== '' && !/^[a-zA-Z0-9\s\-_.']*$/.test(name)) problems.push('Only letters, digits, space and - _ . \' are allowed.');
      if (name !== name.trim() || /\s{2}/.test(name)) problems.push('No leading/trailing or double spaces.');
      const n = await ctx.anon(pidNamesIdl, CANISTERS.sneed_pid_names);
      const cur = opt(await n.get_name(toPrincipal(ctx.principal)));
      return {
        summary: name === '' ? 'Clear my Sneed name' : `Set my Sneed name to "${name}"${cur && opt(cur.name) ? ` (now "${opt(cur.name)}")` : ''}`,
        calls: [{ canister: CANISTERS.sneed_pid_names, method: 'set_my_name', args: [name] }],
        notes: ['Names are public.'],
        problems,
      };
    },
    async run({ name }, ctx) {
      const n = await ctx.signed(pidNamesIdl, CANISTERS.sneed_pid_names);
      const r = unwrapResult(await n.set_my_name(name), 'set_my_name');
      return { ok: true, summary: String(r), links: [link(`/principal?id=${ctx.principal}`)] };
    },
  },
];

export const registerSocialWrites = (server) => forumWrites.forEach((w) => defineWrite(server, w));
export { ptext };
