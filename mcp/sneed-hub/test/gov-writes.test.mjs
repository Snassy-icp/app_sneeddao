// sns_vote and sns_make_motion_proposal end to end through the write protocol (preview, token,
// confirm, audit) against a fake SNS governance. They are not run live: the staging canisters have
// no SNS of their own, so a live call would reach the real Sneed DAO governance.
// The fake is faithful at the Candid level: every call's arguments are encoded with the real
// sns_governance IDL (a wrong shape throws, as the replica would refuse it) and every reply is
// encoded and decoded with it, so the tools see what agent-js hands them (Uint8Array ids,
// Int32Array permissions, [] / [x] options).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDL } from '@dfinity/candid';
import { UpdateCallRejectedError } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { idlFactory as govIdl } from '../src/idl/sns_governance.did.js';
import { govWrites } from '../src/tools/w_gov.js';
import { handleWrite, setGuard, setContextFactory } from '../src/writes.js';
import { WriteGuard } from '../src/safety.js';

const GOV = 'fi3zi-fyaaa-aaaaq-aachq-cai';
const ME = Principal.fromText('zcwrc-qhmeq-amaxy-5vluk-urvu5-bfuwr-l6t2t-63udo-vllgu-fdlsm-2ae');
const OTHER = Principal.fromText('tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae');
const service = govIdl({ IDL });
const methods = Object.fromEntries(service._fields);
const nowS = () => BigInt(Math.floor(Date.now() / 1000));

/// A default value of any IDL type (records filled, options/vectors empty, first variant case).
const def = (t) => {
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
const typeOf = (method, field) => methods[method].retTypes[0];

const hex = (b) => Buffer.from(b).toString('hex');
const neuron = ({ id, perms, stake = 10n * 10n ** 8n, delayS = 365n * 86400n }) => ({
  ...def(service._fields.find(([n]) => n === 'list_neurons')[1].retTypes[0]._fields[0][1]._type),
  id: [{ id: Uint8Array.from(Buffer.from(id, 'hex')) }],
  permissions: perms.map(([p, t]) => ({ principal: [p], permission_type: t })),
  cached_neuron_stake_e8s: stake,
  dissolve_state: [{ DissolveDelaySeconds: delayS }],
});

/// The fake governance: state + Candid round trips.
const fakeGov = ({ neurons, proposals = {}, params = {}, throwOnManage = null }) => {
  const calls = [];
  const impl = {
    list_neurons: ({ of_principal }) => ({ neurons: neurons.filter((n) => n.permissions.some((p) => p.principal[0]?.toText() === of_principal[0]?.toText())) }),
    get_proposal: ({ proposal_id }) => {
      const p = proposals[String(proposal_id[0].id)];
      return { result: p ? [{ Proposal: p }] : [] };
    },
    get_nervous_system_parameters: () => ({ ...def(typeOf('get_nervous_system_parameters')), ...params }),
    manage_neuron: (req) => {
      const cmd = req.command[0];
      if ('RegisterVote' in cmd) return { command: [{ RegisterVote: {} }] };
      if ('MakeProposal' in cmd) return { command: [{ MakeProposal: { proposal_id: [{ id: 77n }] } }] };
      return { command: [{ Error: { error_message: 'unsupported', error_type: 1 } }] };
    },
  };
  const actor = new Proxy({}, {
    get: (_, name) => (name === 'then' ? undefined : async (...args) => {
      const f = methods[name];
      if (!f || !impl[name]) throw new Error(`fake governance: no ${String(name)}`);
      IDL.encode(f.argTypes, args); // throws on a wrong argument shape
      calls.push({ method: name, args });
      if (name === 'manage_neuron' && throwOnManage) throw throwOnManage;
      const reply = impl[name](...args);
      return IDL.decode(f.retTypes, IDL.encode(f.retTypes, [reply]))[0];
    }),
  });
  return { actor, calls };
};

const setup = (gov) => {
  setGuard(new WriteGuard({ caps: {} }));
  setContextFactory(() => ({
    who: { mode: 'own', label: `as ${ME.toText()}` },
    principal: ME.toText(),
    anon: async (idl, id) => { assert.equal(String(id), GOV); return gov.actor; },
    signed: async (idl, id) => { assert.equal(String(id), GOV); return gov.actor; },
  }));
};
const spec = (name) => govWrites.find((w) => w.name === name);
const textOf = (r) => r.content.map((c) => c.text).join('\n');
const previewThenConfirm = async (name, args) => {
  const p = textOf(await handleWrite(spec(name), args));
  const token = p.match(/confirm: "([0-9a-f]+)"/)?.[1];
  assert.ok(token, p);
  const done = await handleWrite(spec(name), { ...args, confirm: token });
  return { preview: p, done: textOf(done), isError: done.isError };
};

const HOTKEY = [3, 4];
const proposalData = ({ id, ballots, open = true, title = 'Test motion' }) => ({
  ...def(methods.get_proposal.retTypes[0]._fields[0][1]._type._fields.find(([k]) => k === 'Proposal')[1]),
  id: [{ id: BigInt(id) }],
  proposal: [{ title, url: '', summary: 's', action: [] }],
  ballots: ballots.map(([nid, cast]) => [nid, { vote: cast ? 1 : 0, voting_power: 1n, cast_timestamp_seconds: cast ? 5n : 0n }]),
  proposal_creation_timestamp_seconds: nowS() - 100n,
  initial_voting_period_seconds: open ? 4n * 86400n : 10n,
  wait_for_quiet_state: [],
});

test('sns_vote: previews one RegisterVote per hotkeyed neuron with an uncast ballot, then votes', async () => {
  const gov = fakeGov({
    neurons: [neuron({ id: 'aa01', perms: [[ME, HOTKEY], [OTHER, [1, 2, 3, 4]]] }), neuron({ id: 'bb02', perms: [[ME, HOTKEY]] }), neuron({ id: 'cc03', perms: [[OTHER, [2, 4]]] })],
    proposals: { 5: proposalData({ id: 5, ballots: [['aa01', false], ['bb02', true], ['cc03', false]] }) },
  });
  setup(gov);
  const r = await previewThenConfirm('sns_vote', { proposal_id: 5, vote: 'yes', governance: GOV });
  assert.match(r.preview, /Vote YES on proposal 5 \("Test motion"\) with 1 neuron\(s\)/);
  assert.match(r.preview, /manage_neuron\(\{"subaccount":"aa01"/);
  assert.ok(!r.isError, r.done);
  assert.match(r.done, /1 of 1 neuron\(s\) voted/);
  const votes = gov.calls.filter((c) => c.method === 'manage_neuron');
  assert.equal(votes.length, 1);
  assert.equal(hex(votes[0].args[0].subaccount), 'aa01');
  assert.deepEqual(votes[0].args[0].command[0], { RegisterVote: { vote: 1, proposal: [{ id: 5n }] } });
});

test('sns_vote: a closed proposal or no hotkey is blocked, and no token is issued', async () => {
  const gov = fakeGov({
    neurons: [neuron({ id: 'aa01', perms: [[ME, HOTKEY]] })],
    proposals: { 6: proposalData({ id: 6, ballots: [['aa01', false]], open: false }) },
  });
  setup(gov);
  const p = textOf(await handleWrite(spec('sns_vote'), { proposal_id: 6, vote: 'no', governance: GOV }));
  assert.match(p, /BLOCKED/);
  assert.match(p, /Voting on this proposal has ended/);
  assert.doesNotMatch(p, /confirm: "/);
  const g2 = fakeGov({ neurons: [], proposals: { 6: proposalData({ id: 6, ballots: [] }) } });
  setup(g2);
  assert.match(textOf(await handleWrite(spec('sns_vote'), { proposal_id: 6, vote: 'no', governance: GOV })), /has the Vote permission on no neuron/);
  assert.equal(gov.calls.filter((c) => c.method === 'manage_neuron').length + g2.calls.filter((c) => c.method === 'manage_neuron').length, 0);
});

test('sns_make_motion_proposal: picks the eligible neuron (stake above reject cost, delay long enough) and submits', async () => {
  const E8 = 10n ** 8n;
  const gov = fakeGov({
    neurons: [
      neuron({ id: 'aa01', perms: [[ME, HOTKEY]], stake: 5n * E8 }),
      neuron({ id: 'bb02', perms: [[ME, HOTKEY]], stake: 100n * E8, delayS: 10n }), // delay too short
      neuron({ id: 'cc03', perms: [[ME, [4]]], stake: 500n * E8 }), // no Submit permission
    ],
    params: { reject_cost_e8s: [E8], neuron_minimum_dissolve_delay_to_vote_seconds: [30n * 86400n] },
  });
  setup(gov);
  const args = { title: 'MCP test motion', summary: 'A summary', motion_text: 'We test.', url: 'https://example.org', governance: GOV };
  const r = await previewThenConfirm('sns_make_motion_proposal', args);
  assert.match(r.preview, /from neuron aa01/);
  assert.match(r.preview, /loses the reject cost of 1 tokens/);
  assert.ok(!r.isError, r.done);
  assert.match(r.done, /proposal 77 submitted/);
  const mp = gov.calls.filter((c) => c.method === 'manage_neuron');
  assert.equal(mp.length, 1);
  assert.equal(hex(mp[0].args[0].subaccount), 'aa01');
  assert.deepEqual(mp[0].args[0].command[0], { MakeProposal: { title: 'MCP test motion', url: 'https://example.org', summary: 'A summary', action: [{ Motion: { motion_text: 'We test.' } }] } });
});

test('sns_make_motion_proposal: no eligible neuron is blocked', async () => {
  const gov = fakeGov({ neurons: [neuron({ id: 'aa01', perms: [[ME, HOTKEY]], stake: 10n })], params: { reject_cost_e8s: [100n] } });
  setup(gov);
  const p = textOf(await handleWrite(spec('sns_make_motion_proposal'), { title: 'MCP test motion', summary: 's', motion_text: 'm', governance: GOV }));
  assert.match(p, /BLOCKED/);
  assert.match(p, /enough stake/);
});

test('sns_vote: a rejected manage_neuron call is reported with its reject message', async () => {
  const err = new UpdateCallRejectedError(Principal.fromText(GOV), 'manage_neuron', new Uint8Array([1]), { status: 200, statusText: 'OK', body: {} }, 5, 'Canister fi3zi-fyaaa-aaaaq-aachq-cai trapped: neuron is dissolved', 'IC0503');
  const gov = fakeGov({ neurons: [neuron({ id: 'aa01', perms: [[ME, HOTKEY]] })], proposals: { 5: proposalData({ id: 5, ballots: [['aa01', false]] }) }, throwOnManage: err });
  setup(gov);
  const r = await previewThenConfirm('sns_vote', { proposal_id: 5, vote: 'no', governance: GOV });
  assert.equal(r.isError, true);
  assert.match(r.done, /neuron aa01…: Canister fi3zi-fyaaa-aaaaq-aachq-cai trapped: neuron is dissolved/);
});
