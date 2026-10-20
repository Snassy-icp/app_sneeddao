// Sneed names: public names of principals, in sneed_pid_names (production; it replaced the naming
// methods of app_sneeddao_backend). Queries: get_name, get_names, get_account_of, search.
import { z } from 'zod';
import { pidNamesActor, toPrincipal, opt, ptext, HUB_URL } from '../ic.js';
import { result, safe, variantKey, nsToIso } from '../format.js';

const nameView = (info) => {
  const i = Array.isArray(info) ? opt(info) : info;
  if (!i) return null;
  const kind = variantKey(i.kind);
  const runBy = opt(i.run_by);
  return {
    name: opt(i.name),
    verified: i.verified,
    kind, // "account" (a person's account, possibly several principals) or "canister"
    account_id: kind === 'account' ? i.kind.account : undefined,
    run_by: runBy ? { account_id: runBy.account, name: opt(runBy.name) } : undefined,
  };
};

/// Names of many principals: Map text -> { name, verified } (missing when none). Never throws.
export const namesOf = async (principals) => {
  const out = new Map();
  const uniq = [...new Set(principals.filter(Boolean).map(ptext))];
  if (!uniq.length) return out;
  try {
    const a = await pidNamesActor();
    for (let i = 0; i < uniq.length; i += 500) {
      const chunk = uniq.slice(i, i + 500);
      const res = await a.get_names(chunk.map((t) => toPrincipal(t)));
      res.forEach((r, j) => {
        const v = nameView(r);
        if (v?.name) out.set(chunk[j], { name: v.name, verified: v.verified });
      });
    }
  } catch { /* names are a nicety */ }
  return out;
};

/// "Name (principal)" helper for outputs.
export const who = (names, p) => {
  const t = ptext(p);
  const n = names.get(t);
  return n ? { principal: t, name: n.name, verified: n.verified } : { principal: t };
};

export function registerNameTools(server) {
  server.registerTool('sneed_name_lookup', {
    title: 'Sneed name lookup',
    description: 'Resolve the public Sneed name of a principal or canister (sneed_pid_names), or search names by prefix (reverse lookup: name -> principals). Names are public and chosen by the account owner; "verified" means the DAO or an admin verified it.',
    inputSchema: {
      principal: z.string().optional().describe('Principal or canister id to resolve'),
      name: z.string().optional().describe('Name (or prefix of a name, or of a word in it) to search for'),
      limit: z.number().int().min(1).max(50).optional().describe('Max search hits (default 10)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ principal, name, limit }) => {
    if (!principal && !name) throw new Error('Give a principal to resolve or a name to search for.');
    const a = await pidNamesActor();
    const out = {};
    if (principal) {
      const p = toPrincipal(principal);
      const info = nameView(await a.get_name(p));
      out.principal = p.toText();
      out.name = info?.name ?? null;
      if (info) Object.assign(out, { verified: info.verified, kind: info.kind, account_id: info.account_id, run_by: info.run_by });
      if (info?.kind === 'account') {
        const acct = opt(await a.get_account_of(p));
        if (acct) {
          out.account = {
            id: acct.id,
            name: opt(acct.name),
            verified: acct.verified,
            members: acct.members.map((m) => ({ principal: m.principal.toText(), role: variantKey(m.role) })),
            created_at: nsToIso(acct.created_at),
          };
        }
      }
      out.url = `${HUB_URL}/principal?id=${p.toText()}`;
      if (!out.name) out.note = 'No public name set. The owner can set one on Sneed Hub: log in, open /me and use "Set Name".';
    }
    if (name) {
      const hits = await a.search({ prefix: name, limit: BigInt(limit ?? 10), kind: [] });
      out.search = hits.map((h) => {
        const k = variantKey(h.target);
        const t = h.target[k];
        return k === 'account'
          ? { name: h.name, verified: h.verified, kind: 'account', account_id: t.id, principals: t.members.map((m) => m.principal.toText()), url: t.members[0] ? `${HUB_URL}/principal?id=${t.members[0].principal.toText()}` : undefined }
          : { name: h.name, verified: h.verified, kind: 'canister', canister: ptext(t), url: `${HUB_URL}/canister?id=${ptext(t)}` };
      });
    }
    return result(out);
  }));
}
