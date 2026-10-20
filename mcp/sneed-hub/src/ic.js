// Read-only access to the Internet Computer: one anonymous agent, actor cache, small helpers.
// Nothing here signs anything or holds a key; every method the tools call is a query.
import { HttpAgent, Actor } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';

import { idlFactory as sneedLockIdl } from './idl/sneed_lock.did.js';
import { idlFactory as sneedexIdl } from './idl/sneedex.did.js';
import { idlFactory as forumIdl } from './idl/sneed_sns_forum.did.js';
import { idlFactory as pidNamesIdl } from './idl/sneed_pid_names.did.js';
import { idlFactory as snsGovernanceIdl } from './idl/sns_governance.did.js';
import { idlFactory as icrc1Idl } from './idl/icrc1_ledger.did.js';

export const IC_HOST = process.env.SNEED_HUB_IC_HOST || 'https://icp-api.io';
export const HUB_URL = (process.env.SNEED_HUB_URL || 'https://app.sneeddao.com').replace(/\/+$/, '');

/// Production canister ids (canister_ids.json "ic" entries and the frontend's constants).
export const CANISTERS = {
  sneed_lock: 'pqsms-lqaaa-aaaal-ajjza-cai',
  sneedex: '7bvk3-ryaaa-aaaal-qtykq-cai',
  sneed_sns_forum: 'mcigm-4aaaa-aaaad-qhlkq-cai',
  sneed_pid_names: 'ejz7n-lyaaa-aaaad-qmkzq-cai',
  sneed_sns_root: 'fp274-iaaaa-aaaaq-aacha-cai',
  sneed_sns_governance: 'fi3zi-fyaaa-aaaaq-aachq-cai',
  sneed_ledger: 'hvgxa-wqaaa-aaaaq-aacia-cai',
  icp_ledger: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
  ckusdc_ledger: 'xevnm-gaaaa-aaaar-qafnq-cai',
  cmc: 'rkp4c-7iaaa-aaaaa-aaaca-cai',
  cyclepay: '2bwus-iiaaa-aaaac-bee3a-cai',
};

let agentPromise = null;
const getAgent = () => {
  // Anonymous identity (the default): no keys exist in this process.
  agentPromise ??= HttpAgent.create({ host: IC_HOST });
  return agentPromise;
};

const actors = new Map();
const actor = async (idl, canisterId) => {
  const key = `${canisterId}`;
  const cached = actors.get(key);
  if (cached && cached.idl === idl) return cached.actor;
  const a = Actor.createActor(idl, { agent: await getAgent(), canisterId });
  actors.set(key, { idl, actor: a });
  return a;
};

export const lockActor = () => actor(sneedLockIdl, CANISTERS.sneed_lock);
export const sneedexActor = () => actor(sneedexIdl, CANISTERS.sneedex);
export const forumActor = () => actor(forumIdl, CANISTERS.sneed_sns_forum);
export const pidNamesActor = () => actor(pidNamesIdl, CANISTERS.sneed_pid_names);
export const snsGovernanceActor = (id = CANISTERS.sneed_sns_governance) => actor(snsGovernanceIdl, id);
export const ledgerActor = (id) => actor(icrc1Idl, id);

/// Parse a principal / canister id, with a readable error.
export const toPrincipal = (text, what = 'principal') => {
  try {
    return Principal.fromText(String(text).trim());
  } catch {
    throw new Error(`"${text}" is not a valid ${what} (expected text like aaaaa-aa or xxxxx-xxxxx-...-cai).`);
  }
};

export const opt = (x) => (Array.isArray(x) && x.length ? x[0] : null);
export const isPrincipal = (v) => v && typeof v === 'object' && v._isPrincipal === true && typeof v.toText === 'function';
export const ptext = (p) => (p == null ? null : isPrincipal(p) ? p.toText() : String(p));
