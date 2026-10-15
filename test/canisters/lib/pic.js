// Shared PocketIC harness: one instance per test file with an NNS subnet (so
// the mock ICP ledger can live at the real ICP ledger id) and one application
// subnet, plus helpers to install the built canisters and talk to them as any
// principal.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from 'vitest';
import { PocketIc, SubnetStateType } from '@dfinity/pic';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';

const here = dirname(fileURLToPath(import.meta.url));
export const BUILD = resolve(here, '..', 'build');
export const wasm = (name) => readFileSync(resolve(BUILD, `${name}.wasm`));

export const ICP_LEDGER_ID = Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai');
export const SNEED_SNS_ROOT = Principal.fromText('fp274-iaaaa-aaaaq-aacha-cai');
export const SNEED_GOVERNANCE = Principal.fromText('fi3zi-fyaaa-aaaaq-aachq-cai');
export const T = 1_000_000_000_000n;

/// Deterministic self-authenticating principals for test users.
export const user = (name) => Principal.selfAuthenticating(new TextEncoder().encode(`sneed-test-${name}`));
export const alice = user('alice');
export const bob = user('bob');
export const carol = user('carol');
export const admin = user('admin'); // installer / controller of the canisters under test

export async function createPic() {
  const pic = await PocketIc.create(inject('PIC_URL'), {
    nns: { state: { type: SubnetStateType.New } },
    sns: { state: { type: SubnetStateType.New } },
    application: [{ state: { type: SubnetStateType.New } }],
  });
  // PocketIC starts in 2021; certificates must be fresh for the agent's checks
  await pic.setTime(Date.now());
  await pic.tick();
  const appSubnet = (await pic.getApplicationSubnets())[0].id;
  const nnsSubnet = (await pic.getNnsSubnet()).id;
  const rootKey = new Uint8Array(await pic.getPubKey(nnsSubnet)); // pic-js hands back a plain array
  return { pic, appSubnet, nnsSubnet, rootKey };
}

/// Create + install a built canister. `initTypes`/`initArgs` encode the actor
/// class argument. Returns the canister id.
export async function install(pic, { name, initTypes = [], initArgs = [], cycles = 100n * T, targetCanisterId, targetSubnetId, controllers = [admin], sender = admin }) {
  const canisterId = await pic.createCanister({ sender, cycles, targetCanisterId, targetSubnetId, controllers });
  await pic.installCode({ sender, canisterId, wasm: wasm(name), arg: IDL.encode(initTypes, initArgs) });
  return canisterId;
}

/// Actor factory bound to a canister, callable as any principal.
export function actorAs(pic, idlFactory, canisterId, principal) {
  const a = pic.createActor({ idlFactory, canisterId });
  a.setPrincipal(principal);
  return a;
}

/// ICRC-1 account helpers.
export const account = (owner, subaccount = null) => ({ owner, subaccount: subaccount ? [subaccount] : [] });

/// The Sneed wallet subaccount of a principal (byte 0 = length, then bytes, zero padded to 32).
export function principalToSubaccount(p) {
  const bytes = p.toUint8Array();
  const out = new Uint8Array(32);
  out[0] = bytes.length;
  out.set(bytes, 1);
  return out;
}

/// Sneed Lock payment subaccount: the wallet subaccount with 0x50 at byte 23.
export function paymentSubaccount(p) {
  const out = principalToSubaccount(p);
  out[23] = 0x50;
  return out;
}

export const nowNs = (pic) => pic.getTime().then((t) => BigInt(Math.round(t)) * 1_000_000n);

export const unwrap = (result) => {
  if ('Ok' in result) return result.Ok;
  if ('ok' in result) return result.ok;
  throw new Error(`expected Ok, got ${JSON.stringify(result, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
};
export const errOf = (result) => {
  if ('Err' in result) return result.Err;
  if ('err' in result) return result.err;
  throw new Error(`expected Err, got ${JSON.stringify(result, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
};

/// Resolves when the call was refused by the canister's ingress guard (system func inspect),
/// before it cost the canister anything.
export const refusedAtIngress = async (promise) => {
  try { await promise; } catch (e) {
    if (/canister_inspect_message .*refused/.test(String(e?.message || e))) return true;
    throw e;
  }
  throw new Error('expected the ingress guard to refuse the call, but it was accepted');
};

/// The same actor, but every query method declared as an update call (as an attacker would
/// call them, to make the canister pay for consensus).
export function asUpdates(idlFactory) {
  return ({ IDL }) => {
    const svc = idlFactory({ IDL });
    const fields = {};
    for (const [name, func] of svc._fields) fields[name] = IDL.Func(func.argTypes, func.retTypes, []);
    return IDL.Service(fields);
  };
}
