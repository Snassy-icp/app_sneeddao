// Identities: the generated key (file mode, no key material in outputs), PEMs (Ed25519 PKCS#8 v1 and
// v2 as dfx writes them, secp256k1 SEC1), dfx identities by name (plaintext only), the precedence of
// delegation > dfx identity > PEM > generated key, and "act as me" delegations (validation, targets,
// expiry, the loopback connect flow).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import { Principal } from '@dfinity/principal';
import { Ed25519KeyIdentity, DelegationChain } from '@dfinity/identity';
import { resetConfigCache } from '../src/config.js';
import { ownIdentity, identityFromPem, activeIdentity, storeDelegation, loadDelegation, deleteDelegation, resetIdentityCache } from '../src/identity.js';
import { startConnect, acceptChain, pendingStatus, stopConnect, checkCode } from '../src/connect.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'sneed-mcp-id-'));
const principalOfPem = (pem) => Principal.selfAuthenticating(new Uint8Array(createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'der' }))).toText();
const ed25519Pem = () => execFileSync('openssl', ['genpkey', '-algorithm', 'ed25519'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const secpPem = () => execFileSync('openssl', ['ecparam', '-name', 'secp256k1', '-genkey', '-noout'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
/// Ed25519 PKCS#8 v2 (OneAsymmetricKey with the public key), as dfx writes it.
const ed25519PemV2 = () => {
  const id = Ed25519KeyIdentity.generate();
  const [, secret] = id.toJSON();
  const seed = Buffer.from(secret, 'hex').subarray(0, 32);
  const pub = Buffer.from(id.getPublicKey().rawKey);
  const der = Buffer.concat([Buffer.from('3053020101300506032b657004220420', 'hex'), seed, Buffer.from('a123032100', 'hex'), pub]);
  return { pem: `-----BEGIN PRIVATE KEY-----\n${der.toString('base64')}\n-----END PRIVATE KEY-----\n`, principal: id.getPrincipal().toText() };
};

const ENV = ['SNEED_MCP_CONFIG_DIR', 'SNEED_MCP_IDENTITY', 'SNEED_MCP_IDENTITY_PEM', 'SNEED_MCP_DFX_IDENTITY', 'DFX_CONFIG_ROOT', 'SNEED_MCP_CONFIG'];
beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  process.env.SNEED_MCP_CONFIG_DIR = tmp();
  resetConfigCache();
  resetIdentityCache();
});

test('the generated key: created once, mode 600, reused; the private key is not in whoami-style labels', () => {
  const a = ownIdentity();
  assert.equal(a.created, true);
  const path = join(process.env.SNEED_MCP_CONFIG_DIR, 'identity.json');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const file = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(file.principal, a.principal);
  resetIdentityCache();
  const b = ownIdentity();
  assert.equal(b.created, false);
  assert.equal(b.principal, a.principal);
  const act = activeIdentity();
  const secret = file.key[1];
  assert.ok(!JSON.stringify({ ...act, identity: undefined }).includes(secret));
  assert.ok(!act.label.includes(secret));
});

test('PEM: Ed25519 PKCS#8 v1 (openssl)', () => {
  const pem = ed25519Pem();
  assert.equal(identityFromPem(pem).getPrincipal().toText(), principalOfPem(pem));
});

test('PEM: Ed25519 PKCS#8 v2 with the public key (dfx)', () => {
  const { pem, principal } = ed25519PemV2();
  assert.equal(identityFromPem(pem).getPrincipal().toText(), principal);
});

test('PEM: secp256k1 EC PRIVATE KEY (dfx default)', () => {
  const pem = secpPem();
  assert.equal(identityFromPem(pem).getPrincipal().toText(), principalOfPem(pem));
});

test('PEM: encrypted and unknown keys are refused', () => {
  assert.throws(() => identityFromPem('-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----'), /encrypted/);
  const rsa = execFileSync('openssl', ['genpkey', '-algorithm', 'rsa', '-pkeyopt', 'rsa_keygen_bits:1024'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.throws(() => identityFromPem(rsa), /Unsupported PEM/);
});

const dfxHome = (identities) => {
  const root = tmp();
  for (const [name, files] of Object.entries(identities)) {
    const d = join(root, '.config', 'dfx', 'identity', name);
    mkdirSync(d, { recursive: true });
    for (const [f, text] of Object.entries(files)) writeFileSync(join(d, f), text);
  }
  return root;
};

test('dfx identity by name: Ed25519 and secp256k1 plaintext PEMs; encrypted ones refused, never prompting', () => {
  const ed = ed25519PemV2();
  const secp = secpPem();
  process.env.DFX_CONFIG_ROOT = dfxHome({ bot_ed: { 'identity.pem': ed.pem }, bot_secp: { 'identity.pem': secp }, locked: { 'identity.pem.encrypted': 'xx' } });
  process.env.SNEED_MCP_DFX_IDENTITY = 'bot_ed';
  resetConfigCache(); resetIdentityCache();
  assert.equal(ownIdentity().principal, ed.principal);
  assert.match(ownIdentity().source, /dfx identity "bot_ed"/);
  process.env.SNEED_MCP_DFX_IDENTITY = 'bot_secp';
  resetConfigCache(); resetIdentityCache();
  assert.equal(ownIdentity().principal, principalOfPem(secp));
  process.env.SNEED_MCP_DFX_IDENTITY = 'locked';
  resetConfigCache(); resetIdentityCache();
  assert.throws(() => ownIdentity(), /encrypted.*never asks for passwords/);
  process.env.SNEED_MCP_DFX_IDENTITY = '../etc';
  resetConfigCache(); resetIdentityCache();
  assert.throws(() => ownIdentity(), /Invalid dfx identity name/);
});

test('precedence: dfx identity over PEM over the generated key', () => {
  const ed = ed25519PemV2();
  const pemFile = join(tmp(), 'k.pem');
  const other = ed25519PemV2();
  writeFileSync(pemFile, other.pem);
  process.env.SNEED_MCP_IDENTITY_PEM = pemFile;
  resetConfigCache(); resetIdentityCache();
  assert.equal(ownIdentity().principal, other.principal);
  process.env.DFX_CONFIG_ROOT = dfxHome({ me: { 'identity.pem': ed.pem } });
  process.env.SNEED_MCP_DFX_IDENTITY = 'me';
  resetConfigCache(); resetIdentityCache();
  assert.equal(ownIdentity().principal, ed.principal);
  assert.ok(!existsSync(join(process.env.SNEED_MCP_CONFIG_DIR, 'identity.json')), 'no key generated when a configured one exists');
});

// ---------- delegations ----------

/// A user login (root key -> browser session key) and the sub-delegation to the agent's session key.
const userChain = async ({ agentKey, targets, ttlMs = 3600_000, userTtlMs = 7 * 86400_000 }) => {
  const root = Ed25519KeyIdentity.generate();
  const browser = Ed25519KeyIdentity.generate();
  const login = await DelegationChain.create(root, browser.getPublicKey(), new Date(Date.now() + userTtlMs));
  const { DelegationIdentity } = await import('@dfinity/identity');
  const session = DelegationIdentity.fromDelegation(browser, login);
  const chain = await DelegationChain.create(session, agentKey.getPublicKey(), new Date(Date.now() + ttlMs), { previous: login, targets });
  return { root, chain, user: Principal.selfAuthenticating(new Uint8Array(root.getPublicKey().toDer())).toText() };
};

test('storeDelegation: acts as the user, with the chain\'s targets and earliest expiry; mode 600; delegation wins', async () => {
  const own = ownIdentity();
  const agentKey = Ed25519KeyIdentity.generate();
  const target = Principal.fromText('7bvk3-ryaaa-aaaal-qtykq-cai');
  const { chain, user } = await userChain({ agentKey, targets: [target], ttlMs: 3600_000 });
  const st = storeDelegation({ sessionKey: agentKey, chainJson: chain.toJSON(), agentName: 'test' });
  assert.equal(st.principal, user);
  assert.deepEqual(st.targets, [target.toText()]);
  assert.ok(Math.abs(new Date(st.expires).getTime() - (Date.now() + 3600_000)) < 5000);
  assert.equal(statSync(join(process.env.SNEED_MCP_CONFIG_DIR, 'delegation.json')).mode & 0o777, 0o600);
  const act = activeIdentity();
  assert.equal(act.mode, 'delegation');
  assert.equal(act.principal, user);
  assert.match(act.label, /\(you, via Sneed Hub delegation/);
  assert.notEqual(act.principal, own.principal);
  assert.equal(deleteDelegation(), true);
  assert.equal(activeIdentity().mode, 'own');
  assert.equal(activeIdentity().principal, own.principal);
});

test('storeDelegation refuses a chain for another key and an expired chain; expired stored chains are dropped', async () => {
  const agentKey = Ed25519KeyIdentity.generate();
  const { chain } = await userChain({ agentKey: Ed25519KeyIdentity.generate() });
  assert.throws(() => storeDelegation({ sessionKey: agentKey, chainJson: chain.toJSON() }), /not for this session key/);
  const expired = await userChain({ agentKey, ttlMs: -1000 });
  assert.throws(() => storeDelegation({ sessionKey: agentKey, chainJson: expired.chain.toJSON() }), /expired or invalid/);
  const ok = await userChain({ agentKey, ttlMs: 3600_000 });
  storeDelegation({ sessionKey: agentKey, chainJson: ok.chain.toJSON() });
  assert.ok(loadDelegation());
  assert.equal(loadDelegation(Date.now() + 2 * 3600_000), null);
  assert.ok(!existsSync(join(process.env.SNEED_MCP_CONFIG_DIR, 'delegation.json')));
});

test('connect flow: the loopback listener accepts the chain by POST (with CORS + private network preflight)', async () => {
  const r = await startConnect({ agentName: 'Test agent', hubUrl: 'https://app.sneeddao.com' });
  const u = new URL(r.url);
  assert.equal(u.pathname, '/connect-agent');
  const keyHex = u.searchParams.get('key');
  assert.equal(r.code, checkCode(keyHex));
  const callback = u.searchParams.get('callback');
  assert.match(callback, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}$/);
  const pre = await fetch(callback, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://app.sneeddao.com');
  const wrong = await fetch(callback.replace(/\/[0-9a-f]+$/, '/nope'), { method: 'POST', body: '{}' });
  assert.equal(wrong.status, 404);
  // the page signs a sub-delegation to the key in the link
  const { Ed25519PublicKey } = await import('@dfinity/identity');
  const agentPub = Ed25519PublicKey.fromDer(Buffer.from(keyHex, 'hex'));
  const { chain, user } = await userChain({ agentKey: { getPublicKey: () => agentPub } });
  const bad = await fetch(callback, { method: 'POST', body: '{"delegations":[],"publicKey":"00"}' });
  assert.equal(bad.status, 400);
  const res = await fetch(callback, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(chain.toJSON()) });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.principal, user);
  assert.equal(pendingStatus().done, true);
  assert.equal(activeIdentity().principal, user);
  deleteDelegation();
  stopConnect();
});

test('connect flow: navigation (GET ?d=) and pasted code fallbacks', async () => {
  const r = await startConnect({});
  const u = new URL(r.url);
  const { Ed25519PublicKey } = await import('@dfinity/identity');
  const agentPub = Ed25519PublicKey.fromDer(Buffer.from(u.searchParams.get('key'), 'hex'));
  const { chain, user } = await userChain({ agentKey: { getPublicKey: () => agentPub } });
  const code = Buffer.from(JSON.stringify(chain.toJSON())).toString('base64url');
  const res = await fetch(`${u.searchParams.get('callback')}?d=${code}`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Agent connected/);
  assert.equal(activeIdentity().principal, user);
  deleteDelegation();
  // pasted code
  const r2 = await startConnect({});
  const u2 = new URL(r2.url);
  const pub2 = Ed25519PublicKey.fromDer(Buffer.from(u2.searchParams.get('key'), 'hex'));
  const c2 = await userChain({ agentKey: { getPublicKey: () => pub2 } });
  const st = acceptChain(Buffer.from(JSON.stringify(c2.chain.toJSON())).toString('base64url'));
  assert.equal(st.principal, c2.user);
  deleteDelegation();
  stopConnect();
});

void randomBytes;
