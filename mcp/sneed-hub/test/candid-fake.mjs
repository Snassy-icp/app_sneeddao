// Candid-faithful fake canisters for the write-tool tests: every call's arguments are encoded with
// the canister's real IDL (a wrong shape throws, as the replica would refuse it), and every reply is
// encoded and decoded with it, so the tools see what agent-js hands them ([] / [x] options,
// Uint8Array blobs, bigints). Calls are recorded.
import { IDL } from '@dfinity/candid';
import { Principal } from '@dfinity/principal';
import { handleWrite, setGuard, setContextFactory } from '../src/writes.js';
import { WriteGuard } from '../src/safety.js';

/// fake(idlFactory, impl): an actor whose methods round-trip through Candid. impl[method](...args)
/// returns the reply (may be async or throw). `calls` lists { method, args }.
export const fake = (idlFactory, impl) => {
  const methods = Object.fromEntries(idlFactory({ IDL })._fields);
  const calls = [];
  const actor = new Proxy({}, {
    get: (_, name) => {
      if (name === 'then') return undefined;
      if (name === '__calls') return calls;
      return async (...args) => {
        const f = methods[name];
        if (!f) throw new Error(`fake: the interface has no ${String(name)}`);
        if (!impl[name]) throw new Error(`fake: ${String(name)} not implemented`);
        IDL.decode(f.argTypes, IDL.encode(f.argTypes, args)); // throws on a wrong argument shape
        calls.push({ method: name, args });
        const reply = await impl[name](...args);
        return IDL.decode(f.retTypes, IDL.encode(f.retTypes, [reply]))[0];
      };
    },
  });
  return actor;
};

/// A default value of any IDL type (records filled, options/vectors empty, first variant case).
export const def = (t) => {
  if (t instanceof IDL.RecClass) return def(t.getType());
  if (t instanceof IDL.TupleClass) return t._components.map(def);
  if (t instanceof IDL.RecordClass) return Object.fromEntries(t._fields.map(([k, f]) => [k, def(f)]));
  if (t instanceof IDL.VariantClass) return { [t._fields[0][0]]: def(t._fields[0][1]) };
  if (t instanceof IDL.OptClass || t instanceof IDL.VecClass) return [];
  if (t instanceof IDL.FixedNatClass || t instanceof IDL.FixedIntClass) return t._bits > 32 ? 0n : 0;
  if (t instanceof IDL.NatClass || t instanceof IDL.IntClass) return 0n;
  if (t instanceof IDL.TextClass) return '';
  if (t instanceof IDL.BoolClass) return false;
  if (t instanceof IDL.FloatClass) return 0;
  if (t instanceof IDL.PrincipalClass) return Principal.anonymous();
  return null;
};
/// The inner type of a method's first return (unwrapping opt / vec when asked): types by example.
export const retType = (idlFactory, method, { unwrap = 0 } = {}) => {
  let t = Object.fromEntries(idlFactory({ IDL })._fields)[method].retTypes[0];
  for (let i = 0; i < unwrap; i++) t = t instanceof IDL.RecClass ? t.getType()._type : t._type;
  return t;
};

/// Route actors by canister id; anon and signed share the fakes. Returns the guard.
export const useFakes = (me, fakes, { caps = {}, allowTransfers = false, mode = 'own' } = {}) => {
  const g = new WriteGuard({ caps, allowTransfers });
  setGuard(g);
  const get = async (idl, id) => { const f = fakes[String(id)]; if (!f) throw new Error(`no fake for ${id}`); return f; };
  setContextFactory(() => ({ who: { mode, label: `as ${me}` }, principal: me, anon: get, signed: get }));
  return g;
};

/// Preview, then confirm with the issued token (when there is one).
export const previewConfirm = async (spec, args) => {
  const p = (await handleWrite(spec, args)).content[0].text;
  const token = p.match(/confirm: "([0-9a-f]+)"/)?.[1];
  if (!token) return { preview: p };
  const d = await handleWrite(spec, { ...args, confirm: token });
  return { preview: p, done: d.content[0].text, isError: Boolean(d.isError) };
};

/// A fake ICRC-1 ledger: balances by "owner/subaccount hex"; transfers and approvals recorded.
export const ledgerImpl = (balances, { block = 4242n } = {}) => {
  const key = ({ owner, subaccount }) => `${owner.toText()}/${subaccount?.[0] ? Buffer.from(subaccount[0]).toString('hex') : ''}`;
  return {
    icrc1_balance_of: (a) => balances[key(a)] ?? 0n,
    icrc1_transfer: () => ({ Ok: block }),
    icrc2_approve: () => ({ Ok: block + 1n }),
    icrc1_fee: () => 10_000n,
  };
};

export const P = (t) => Principal.fromText(t);
export const sub = (b) => { const s = new Uint8Array(32); s[31] = b; return s; };
export const tool = (list, name) => { const t = list.find((w) => w.name === name); if (!t) throw new Error(`no tool ${name}`); return t; };
