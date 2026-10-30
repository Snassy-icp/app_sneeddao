// Write tools for names and avatars, as utils/NamingService.js makes the calls: private nicknames
// for principals and neurons (sneed_pid_nicknames / sneed_neuron_nicknames.set_nickname), public
// neuron names (sneed_neuron_names.set_name, for neurons the signer has a permission on, as the
// canister's mayName checks), and the signer's avatar (sneed_pid_names.set_my_avatar with an https
// link, set_my_nft_avatar / set_my_ext_nft_avatar with an NFT the signer holds, or clear).
// Uploading an image (sneed_avatars.upload) is not offered: give an https link or an NFT.
import { z } from 'zod';
import { idlFactory as pidNicknamesIdl } from '../idl/sneed_pid_nicknames.did.js';
import { idlFactory as neuronNicknamesIdl } from '../idl/sneed_neuron_nicknames.did.js';
import { idlFactory as neuronNamesIdl } from '../idl/sneed_neuron_names.did.js';
import { idlFactory as pidNamesIdl } from '../idl/sneed_pid_names.did.js';
import { idlFactory as govIdl } from '../idl/sns_governance.did.js';
import { idlFactory as icrc7Idl } from '../idl/icrc7.did.js';
import { CANISTERS, opt, toPrincipal, ptext } from '../ic.js';
import { defineWrite, unwrapResult } from '../writes.js';
import { link, fromHex, accountId, extTokenIdentifier, extIdlFactory, governanceOfRoot } from '../chain.js';
import { plain } from '../format.js';

const rootArg = z.string().optional().describe(`SNS root canister id (default Sneed DAO ${CANISTERS.sneed_sns_root})`);
const hexId = z.string().regex(/^[0-9a-fA-F]+$/).describe('Neuron id (hex)');
const neuronKey = (root, id) => ({ sns_root: toPrincipal(root), neuron_id: fromHex(id) });
const keyText = (root, id) => ({ sns_root: ptext(root), neuron_id: id.toLowerCase() });

/// The neuron and whether `principal` holds any permission on it (sneed_neuron_names mayName).
export const neuronPermission = async (ctx, root, idHex, principal) => {
  const gov = await ctx.anon(govIdl, await governanceOfRoot(ctx, root));
  const r = opt((await gov.get_neuron({ neuron_id: [{ id: fromHex(idHex) }] })).result);
  if (!r || 'Error' in r) return { neuron: null, allowed: false };
  const n = r.Neuron;
  return { neuron: n, allowed: n.permissions.some((p) => ptext(opt(p.principal)) === principal) };
};

const nameRules = (name, max) => {
  const p = [];
  if (name.length > max) p.push(`At most ${max} characters.`);
  if (name !== '' && !/^[a-zA-Z0-9\s\-_.']*$/.test(name)) p.push('Only letters, digits, space and - _ . \' are allowed.');
  if (name !== name.trim() || /\s{2}/.test(name)) p.push('No leading/trailing or double spaces.');
  return p;
};

export const nameWrites = [
  {
    name: 'nickname_set',
    title: 'Set a private nickname',
    description: 'Give a principal (sneed_pid_nicknames.set_nickname) or an SNS neuron (sneed_neuron_nicknames.set_nickname) a private nickname that Sneed Hub shows only to you. "" removes it. Private means other users cannot read it through the canister; it is stored on-chain, not encrypted.',
    inputSchema: {
      principal: z.string().optional().describe('Principal to nickname (or neuron_id)'),
      neuron_id: hexId.optional(),
      sns_root: rootArg,
      nickname: z.string().max(64).describe('The nickname, or "" to remove it'),
    },
    async build({ principal, neuron_id, sns_root, nickname }, ctx) {
      if ((principal == null) === (neuron_id == null)) throw new Error('Give either principal or neuron_id.');
      const root = sns_root ?? CANISTERS.sneed_sns_root;
      const problems = nameRules(nickname, 64).filter((p) => !p.startsWith('Only'));
      const call = principal != null
        ? { canister: CANISTERS.sneed_pid_nicknames, method: 'set_nickname', args: [toPrincipal(principal).toText(), nickname] }
        : { canister: CANISTERS.sneed_neuron_nicknames, method: 'set_nickname', args: [keyText(root, neuron_id), nickname] };
      return {
        summary: `${nickname === '' ? 'Remove your nickname for' : `Nickname "${nickname}" for`} ${principal != null ? `principal ${toPrincipal(principal).toText()}` : `neuron ${neuron_id.toLowerCase()} of SNS ${toPrincipal(root).toText()}`}`,
        calls: [call],
        notes: ['Shown only to you on Sneed Hub; stored on-chain, not encrypted.'],
        problems,
      };
    },
    async run({ principal, neuron_id, sns_root, nickname }, ctx) {
      const r = principal != null
        ? await (await ctx.signed(pidNicknamesIdl, CANISTERS.sneed_pid_nicknames)).set_nickname(toPrincipal(principal), nickname)
        : await (await ctx.signed(neuronNicknamesIdl, CANISTERS.sneed_neuron_nicknames)).set_nickname(neuronKey(sns_root ?? CANISTERS.sneed_sns_root, neuron_id), nickname);
      return { ok: true, summary: String(unwrapResult(r, 'set_nickname')) };
    },
  },
  {
    name: 'neuron_name_set',
    title: 'Name an SNS neuron',
    description: 'Give an SNS neuron a public name (sneed_neuron_names.set_name), as the neuron page does. You need a permission on the neuron (e.g. hotkey). Names are unique per SNS (case-insensitive), moderated and public; "" removes it.',
    inputSchema: { neuron_id: hexId, sns_root: rootArg, name: z.string().max(32).describe('The name, or "" to remove it') },
    async build({ neuron_id, sns_root, name }, ctx) {
      const root = sns_root ?? CANISTERS.sneed_sns_root;
      const { neuron, allowed } = await neuronPermission(ctx, root, neuron_id, ctx.principal);
      const problems = nameRules(name, 32);
      if (!neuron) problems.push(`No neuron ${neuron_id} in SNS ${root}.`);
      else if (!allowed) problems.push(`${ctx.principal} has no permission on neuron ${neuron_id.toLowerCase()}. Add it as a hotkey on the neuron (${link('/neurons')}).`);
      const cur = opt((await (await ctx.anon(neuronNamesIdl, CANISTERS.sneed_neuron_names)).get_names([neuronKey(root, neuron_id)]))[0] ?? []);
      return {
        summary: `${name === '' ? 'Remove the name of' : `Name "${name}" for`} neuron ${neuron_id.toLowerCase()} of SNS ${root}${cur?.name ? ` (now "${cur.name}")` : ''}`,
        calls: [{ canister: CANISTERS.sneed_neuron_names, method: 'set_name', args: [keyText(root, neuron_id), name] }],
        notes: ['Neuron names are public.'],
        problems,
      };
    },
    async run({ neuron_id, sns_root, name }, ctx) {
      const r = await (await ctx.signed(neuronNamesIdl, CANISTERS.sneed_neuron_names)).set_name(neuronKey(sns_root ?? CANISTERS.sneed_sns_root, neuron_id), name);
      return { ok: true, summary: String(unwrapResult(r, 'set_name')), links: [link(`/neuron?neuronid=${neuron_id.toLowerCase()}&sns=${sns_root ?? CANISTERS.sneed_sns_root}`)] };
    },
  },
  {
    name: 'avatar_set',
    title: 'Set my avatar',
    description: 'Set the signer\'s public avatar, as the profile page does: an https image link (sneed_pid_names.set_my_avatar), or an NFT you hold (set_my_nft_avatar for ICRC-7, set_my_ext_nft_avatar for EXT: your main account must hold it, and it is re-checked whenever it is shown), or clear: true to remove the image avatar (and nft_clear: true for the NFT avatar). Avatars are public.',
    inputSchema: {
      url: z.string().max(512).optional().describe('https link to an image'),
      nft_collection: z.string().optional().describe('NFT collection canister id'),
      nft_token_id: z.union([z.number().int().min(0), z.string()]).optional().describe('NFT token id (ICRC-7) or token index (EXT)'),
      nft_standard: z.enum(['icrc7', 'ext']).optional().describe('icrc7 (default) or ext'),
      clear: z.boolean().optional().describe('Remove the image avatar'),
      nft_clear: z.boolean().optional().describe('Stop showing an NFT avatar'),
    },
    async build(a, ctx) {
      const modes = [a.url != null, a.nft_collection != null, Boolean(a.clear), Boolean(a.nft_clear)].filter(Boolean).length;
      if (modes !== 1) throw new Error('Give exactly one of url, nft_collection (+ nft_token_id), clear or nft_clear.');
      const problems = [];
      let call;
      if (a.url != null) {
        if (!a.url.startsWith('https://')) problems.push('Avatar links must start with https://.');
        call = { method: 'set_my_avatar', args: [[{ url: a.url }]] };
      } else if (a.clear) call = { method: 'set_my_avatar', args: [[]] };
      else if (a.nft_clear) call = { method: 'set_my_nft_avatar', args: [[]] };
      else {
        if (a.nft_token_id == null) throw new Error('nft_token_id is needed with nft_collection.');
        const coll = toPrincipal(a.nft_collection, 'collection canister id').toText();
        const std = a.nft_standard ?? 'icrc7';
        if (std === 'icrc7') {
          const owner = opt((await (await ctx.anon(icrc7Idl, coll)).icrc7_owner_of([BigInt(a.nft_token_id)]))[0] ?? []);
          if (!owner || owner.owner.toText() !== ctx.principal || (opt(owner.subaccount) && opt(owner.subaccount).some((b) => b !== 0))) problems.push(`Token ${a.nft_token_id} of ${coll} is not held by ${ctx.principal}'s main account.`);
        } else {
          const r = await (await ctx.anon(extIdlFactory, coll)).bearer(extTokenIdentifier(coll, a.nft_token_id));
          if ('err' in r) problems.push(`EXT token ${a.nft_token_id}: ${JSON.stringify(plain(r.err))}`);
          else if (r.ok !== accountId(ctx.principal)) problems.push(`EXT token ${a.nft_token_id} of ${coll} is held by account ${r.ok}, not by ${ctx.principal}'s main account.`);
        }
        call = { method: std === 'icrc7' ? 'set_my_nft_avatar' : 'set_my_ext_nft_avatar', args: [[{ collection: coll, token_id: BigInt(a.nft_token_id) }]] };
      }
      return {
        summary: a.clear ? 'Remove your image avatar' : a.nft_clear ? 'Stop showing an NFT avatar' : a.url ? `Avatar: ${a.url}` : `NFT avatar: token ${a.nft_token_id} of ${a.nft_collection}`,
        calls: [{ canister: CANISTERS.sneed_pid_names, ...call }],
        notes: ['Avatars are public and tied to your principal.'],
        problems,
        _call: call,
      };
    },
    async run(a, ctx, plan) {
      const n = await ctx.signed(pidNamesIdl, CANISTERS.sneed_pid_names);
      const { method, args } = plan._call;
      const arg = args[0].length ? [('url' in args[0][0]) ? { url: args[0][0].url } : { collection: toPrincipal(args[0][0].collection), token_id: BigInt(args[0][0].token_id) }] : [];
      return { ok: true, summary: String(unwrapResult(await n[method](arg), method)), links: [link(`/principal?id=${ctx.principal}`)] };
    },
  },
];

export const registerNameWrites = (server) => nameWrites.forEach((w) => defineWrite(server, w));
