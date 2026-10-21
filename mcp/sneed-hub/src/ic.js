// Access to the Internet Computer. Reads use one anonymous agent; writes (and reads that need the
// caller, like an SMS inbox) use an agent signed by the active identity (see identity.js).
import { setDefaultResultOrder } from 'node:dns';
import { HttpAgent, Actor } from '@dfinity/agent';

// IPv6 routes to the boundary nodes time out on some networks; prefer IPv4.
try { setDefaultResultOrder('ipv4first'); } catch { /* older node */ }
import { Principal } from '@dfinity/principal';

import { idlFactory as sneedLockIdl } from './idl/sneed_lock.did.js';
import { idlFactory as sneedexIdl } from './idl/sneedex.did.js';
import { idlFactory as forumIdl } from './idl/sneed_sns_forum.did.js';
import { idlFactory as pidNamesIdl } from './idl/sneed_pid_names.did.js';
import { idlFactory as snsGovernanceIdl } from './idl/sns_governance.did.js';
import { idlFactory as icrc1Idl } from './idl/icrc1_ledger.did.js';
import { settings, truthy } from './config.js';

export let IC_HOST = process.env.SNEED_HUB_IC_HOST || 'https://icp-api.io';
export const HUB_URL = (process.env.SNEED_HUB_URL || 'https://app.sneeddao.com').replace(/\/+$/, '');
let FETCH_ROOT_KEY = truthy(process.env.SNEED_MCP_FETCH_ROOT_KEY);

/// Production canister ids (canister_ids.json "ic" entries and the frontend's constants).
/// Overridable per canister with SNEED_MCP_CANISTER_<NAME> or the config file's "canisters".
export const CANISTERS = {
  sneed_lock: 'pqsms-lqaaa-aaaal-ajjza-cai',
  sneedex: '7bvk3-ryaaa-aaaal-qtykq-cai',
  sneed_sns_forum: 'mcigm-4aaaa-aaaad-qhlkq-cai',
  sneed_pid_names: 'ejz7n-lyaaa-aaaad-qmkzq-cai',
  sneed_pid_nicknames: 'e37iu-hiaaa-aaaad-qmk2q-cai',
  sneed_neuron_names: 'e46oa-kqaaa-aaaad-qmk2a-cai',
  sneed_neuron_nicknames: 'es4di-raaaa-aaaad-qmk3a-cai',
  sneed_avatars: 'ev5f4-4yaaa-aaaad-qmk3q-cai',
  sneed_profiles: 'fytbs-tqaaa-aaaad-qmk4a-cai',
  sneed_sms: 'zelpl-7yaaa-aaaad-abtcq-cai',
  sneed_notifications: 'vuy7a-iaaaa-aaaay-aaduq-cai',
  sneed_premium: '7gump-4aaaa-aaaal-qtyka-cai',
  sneedapp: 'sfamc-kyaaa-aaaau-adnpq-cai',
  rll: 'lvc4n-7aaaa-aaaam-adm6a-cai',
  app_sneeddao_backend: 'g7s5u-tqaaa-aaaad-qhktq-cai',
  mr_sneed: 'ucthl-5qaaa-aaaay-aadrq-cai',
  sneed_mon: null, // no production id yet: set SNEED_MCP_CANISTER_SNEED_MON
  sneed_sns_root: 'fp274-iaaaa-aaaaq-aacha-cai',
  sneed_sns_governance: 'fi3zi-fyaaa-aaaaq-aachq-cai',
  sneed_ledger: 'hvgxa-wqaaa-aaaaq-aacia-cai',
  icp_ledger: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
  ckusdc_ledger: 'xevnm-gaaaa-aaaar-qafnq-cai',
  cmc: 'rkp4c-7iaaa-aaaaa-aaaca-cai',
  cyclepay: '2bwus-iiaaa-aaaac-bee3a-cai',
  sns_wasm: 'qaa6y-5yaaa-aaaaa-aaafa-cai',
};

const applyOverrides = () => {
  const fromFile = settings().canisters;
  for (const name of Object.keys(CANISTERS)) {
    const env = process.env[`SNEED_MCP_CANISTER_${name.toUpperCase()}`];
    if (env) CANISTERS[name] = env.trim();
    else if (fromFile[name]) CANISTERS[name] = fromFile[name];
  }
};
applyOverrides();

/// Re-point the server at another network (tests, local replicas): host, root key, canister ids.
export const configureIc = ({ host, fetchRootKey, canisters } = {}) => {
  if (host) IC_HOST = host;
  if (fetchRootKey != null) FETCH_ROOT_KEY = fetchRootKey;
  if (canisters) Object.assign(CANISTERS, canisters);
  anonAgent = null;
  anonAgents.clear();
  signedAgents.clear();
  actors.clear();
};

/// The canister id of a Sneed service, or an error that says how to configure it.
export const canisterId = (name) => {
  const id = CANISTERS[name];
  if (!id) throw new Error(`${name} has no production canister id yet. Set SNEED_MCP_CANISTER_${name.toUpperCase()}=<canister id> (or "canisters": {"${name}": "<id>"} in the config file) to use it.`);
  return id;
};

const newAgent = async (identity) => {
  const agent = await HttpAgent.create({ host: IC_HOST, identity, shouldFetchRootKey: FETCH_ROOT_KEY });
  return agent;
};

// Anonymous agents, one per canister (see getSignedAgent for why).
let anonAgent = null;
const anonAgents = new Map();
export const getAgent = (canister = '') => {
  if (!canister) return (anonAgent ??= newAgent(undefined));
  if (!anonAgents.has(canister)) anonAgents.set(canister, newAgent(undefined));
  return anonAgents.get(canister);
};

// One signed agent per (identity, canister): agent-js keeps one certificate-time watermark per agent
// and subnets certify slightly different times (the frontend's utils/icrc3/client.js does the same).
const signedAgents = new Map();
export const getSignedAgent = (identity, canister = '') => {
  let byId = signedAgents.get(identity);
  if (!byId) signedAgents.set(identity, (byId = new Map()));
  if (!byId.has(canister)) byId.set(canister, newAgent(identity));
  return byId.get(canister);
};

const actors = new Map();
/// Anonymous actor (reads).
export const actor = async (idl, canisterId) => {
  const key = `anon:${canisterId}`;
  const cached = actors.get(key);
  if (cached && cached.idl === idl) return cached.actor;
  const a = Actor.createActor(idl, { agent: await getAgent(String(canisterId)), canisterId });
  actors.set(key, { idl, actor: a });
  return a;
};
/// Actor signed by `identity` (writes, and reads that depend on the caller).
export const signedActor = async (idl, canisterId, identity) =>
  Actor.createActor(idl, { agent: await getSignedAgent(identity, ptext(canisterId)), canisterId: ptext(canisterId) });

export const lockActor = () => actor(sneedLockIdl, CANISTERS.sneed_lock);
export const sneedexActor = () => actor(sneedexIdl, CANISTERS.sneedex);
export const forumActor = () => actor(forumIdl, CANISTERS.sneed_sns_forum);
export const pidNamesActor = () => actor(pidNamesIdl, CANISTERS.sneed_pid_names);
export const snsGovernanceActor = (id = CANISTERS.sneed_sns_governance) => actor(snsGovernanceIdl, ptext(id));
export const ledgerActor = (id) => actor(icrc1Idl, ptext(id));

/// Parse a principal / canister id, with a readable error.
export const toPrincipal = (text, what = 'principal') => {
  if (isPrincipal(text)) return text;
  try {
    return Principal.fromText(String(text).trim());
  } catch {
    throw new Error(`"${text}" is not a valid ${what} (expected text like aaaaa-aa or xxxxx-xxxxx-...-cai).`);
  }
};

export const opt = (x) => (Array.isArray(x) && x.length ? x[0] : null);
export function isPrincipal(v) { return v && typeof v === 'object' && v._isPrincipal === true && typeof v.toText === 'function'; }
export function ptext(p) { return p == null ? null : isPrincipal(p) ? p.toText() : String(p); }
