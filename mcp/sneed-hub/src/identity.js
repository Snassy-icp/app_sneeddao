// Identities for signed calls.
//
// Two modes:
// - "act as me": the user approved a delegation on Sneed Hub (/connect-agent) from their own login to
//   a session key held here. Calls arrive as the USER's principal, limited to the canisters (targets)
//   and the expiry the user chose. Stored in <config dir>/delegation.json (mode 600) until it expires
//   or `disconnect` deletes it. While it is valid it is the active identity.
// - "own identity": the agent's own Ed25519 key (generated on first use at
//   ~/.config/sneed-hub-mcp/identity.json, mode 600) or a PEM given by SNEED_MCP_IDENTITY_PEM (for
//   example a plaintext dfx identity). For autonomous agents with their own principal.
//
// Private keys are never printed or returned by any tool.
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Ed25519KeyIdentity, DelegationChain, DelegationIdentity, isDelegationValid } from '@dfinity/identity';
import { Secp256k1KeyIdentity } from '@dfinity/identity-secp256k1';
import { settings } from './config.js';

const writePrivate = (path, text) => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
};

// Ed25519 in PKCS#8 (RFC 8410), v1 (302e…) or v2 with the public key (3053…, as dfx writes it):
// …300506032b6570 (AlgorithmIdentifier Ed25519) 04220420 || seed(32) …
const ED25519_ALG_AND_SEED = '300506032b657004220420';

/// A SignIdentity from a PEM: Ed25519 (PKCS#8 "PRIVATE KEY") or secp256k1 ("EC PRIVATE KEY", dfx's
/// default). Encrypted PEMs are not supported.
export const identityFromPem = (pem) => {
  if (/ENCRYPTED/.test(pem)) throw new Error('This PEM is encrypted. Export a plaintext copy (e.g. a dedicated dfx identity created with --storage-mode plaintext).');
  if (/BEGIN EC PRIVATE KEY/.test(pem)) return Secp256k1KeyIdentity.fromPem(pem);
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Buffer.from(b64, 'base64');
  const hex = der.toString('hex');
  const at = hex.indexOf(ED25519_ALG_AND_SEED);
  if (at < 0 || at % 2) throw new Error('Unsupported PEM: expected an Ed25519 PKCS#8 key or a secp256k1 EC key.');
  const start = at / 2 + ED25519_ALG_AND_SEED.length / 2;
  const seed = der.subarray(start, start + 32);
  if (seed.length !== 32) throw new Error('Truncated Ed25519 PEM.');
  return Ed25519KeyIdentity.fromSecretKey(new Uint8Array(seed));
};

let ownCache = null;
/// The agent's own identity: { identity, principal, source, created }.
export const ownIdentity = () => {
  if (ownCache) return ownCache;
  const s = settings();
  if (s.dfxIdentity) {
    if (!/^[A-Za-z0-9._-]+$/.test(s.dfxIdentity) || s.dfxIdentity.startsWith('.')) throw new Error('Invalid dfx identity name.');
    const dir = join(s.dfxHome, 'identity', s.dfxIdentity);
    const pemPath = join(dir, 'identity.pem');
    if (!existsSync(pemPath)) {
      if (existsSync(join(dir, 'identity.pem.encrypted'))) throw new Error(`dfx identity "${s.dfxIdentity}" is encrypted (identity.pem.encrypted). This server never asks for passwords: use a plaintext identity (dfx identity new <name> --storage-mode plaintext) or export one to a PEM for SNEED_MCP_IDENTITY_PEM.`);
      throw new Error(`dfx identity "${s.dfxIdentity}" not found (no ${pemPath}). Keychain-stored identities are not supported; use a plaintext one.`);
    }
    const identity = identityFromPem(readFileSync(pemPath, 'utf8'));
    ownCache = { identity, principal: identity.getPrincipal().toText(), source: `dfx identity "${s.dfxIdentity}"`, created: false };
    return ownCache;
  }
  if (s.identityPem) {
    const identity = identityFromPem(readFileSync(s.identityPem, 'utf8'));
    ownCache = { identity, principal: identity.getPrincipal().toText(), source: `PEM ${s.identityPem}`, created: false };
    return ownCache;
  }
  let created = false;
  let identity;
  if (existsSync(s.identityPath)) {
    const data = JSON.parse(readFileSync(s.identityPath, 'utf8'));
    identity = Ed25519KeyIdentity.fromJSON(JSON.stringify(data.key));
  } else {
    identity = Ed25519KeyIdentity.generate();
    writePrivate(s.identityPath, JSON.stringify({
      type: 'ed25519',
      note: 'Sneed Hub MCP agent key. Keep it secret: whoever has this file controls this principal and its funds.',
      principal: identity.getPrincipal().toText(),
      created_at: new Date().toISOString(),
      key: identity.toJSON(),
    }, null, 2));
    created = true;
  }
  ownCache = { identity, principal: identity.getPrincipal().toText(), source: s.identityPath, created };
  return ownCache;
};

// ---------- "act as me" delegations ----------

/// The stored delegation, or null (also null and removed when expired).
export const loadDelegation = (now = Date.now()) => {
  const { delegationPath } = settings();
  if (!existsSync(delegationPath)) return null;
  try {
    const d = JSON.parse(readFileSync(delegationPath, 'utf8'));
    const chain = DelegationChain.fromJSON(d.chain);
    const expiresMs = Number(d.expires_ns ? BigInt(d.expires_ns) / 1_000_000n : 0n);
    if (!expiresMs || expiresMs <= now || !isDelegationValid(chain)) {
      unlinkSync(delegationPath);
      return null;
    }
    const sessionKey = Ed25519KeyIdentity.fromJSON(JSON.stringify(d.session_key));
    const identity = DelegationIdentity.fromDelegation(sessionKey, chain);
    return {
      identity,
      principal: identity.getPrincipal().toText(),
      agent_name: d.agent_name,
      targets: d.targets ?? null,
      expires: new Date(expiresMs).toISOString(),
      connected_at: d.connected_at,
    };
  } catch (e) {
    process.stderr.write(`sneed-hub-mcp: ignoring unreadable delegation: ${e.message}\n`);
    return null;
  }
};

/// Validate a delegation chain (JSON from Sneed Hub) against the session key and store it.
/// Returns the stored summary. Throws when the chain does not end at the session key or is expired.
export const storeDelegation = ({ sessionKey, chainJson, agentName }) => {
  const chain = DelegationChain.fromJSON(chainJson);
  if (!chain.delegations.length) throw new Error('empty delegation chain');
  const last = chain.delegations[chain.delegations.length - 1].delegation;
  const ours = Buffer.from(sessionKey.getPublicKey().toDer()).toString('hex');
  if (Buffer.from(last.pubkey).toString('hex') !== ours) throw new Error('the delegation is not for this session key');
  if (!isDelegationValid(chain)) throw new Error('the delegation is expired or invalid');
  // Effective expiry and targets: the minimum expiry over the chain; the last non-empty targets list
  // (the replica enforces the intersection of all of them).
  let expires = null;
  let targets = null;
  for (const { delegation } of chain.delegations) {
    if (expires == null || delegation.expiration < expires) expires = delegation.expiration;
    if (delegation.targets) targets = delegation.targets.map((t) => t.toText());
  }
  const identity = DelegationIdentity.fromDelegation(sessionKey, chain);
  writePrivate(settings().delegationPath, JSON.stringify({
    type: 'sneed-hub-delegation',
    note: 'Sneed Hub "act as me" delegation. Whoever has this file can act as the user, within its targets, until it expires.',
    principal: identity.getPrincipal().toText(),
    agent_name: agentName ?? null,
    targets,
    expires_ns: expires.toString(),
    connected_at: new Date().toISOString(),
    session_key: sessionKey.toJSON(),
    chain: chain.toJSON(),
  }, null, 2));
  return loadDelegation();
};

export const deleteDelegation = () => {
  const { delegationPath } = settings();
  if (existsSync(delegationPath)) { unlinkSync(delegationPath); return true; }
  return false;
};

/// The identity used for signed calls: the user's delegation while valid, else the agent's own key.
/// { identity, principal, mode: 'delegation'|'own', label, targets?, expires? }
export const activeIdentity = () => {
  const d = loadDelegation();
  if (d) return { ...d, mode: 'delegation', label: `as ${d.principal} (you, via Sneed Hub delegation until ${d.expires})` };
  const o = ownIdentity();
  return { identity: o.identity, principal: o.principal, mode: 'own', label: `as the agent's own identity ${o.principal}`, source: o.source, created: o.created };
};

/// For tests: forget the cached own identity.
export const resetIdentityCache = () => { ownCache = null; };
