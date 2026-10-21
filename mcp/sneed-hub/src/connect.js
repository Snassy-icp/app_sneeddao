// "Act as me": connect the agent to the user's Sneed Hub login.
//
// connect_as_me generates a fresh session key and starts a loopback listener on 127.0.0.1 (random
// port, random path secret, 15 minutes). The user opens the returned Sneed Hub URL
// (/connect-agent?key=…&name=…&callback=…), logs in, picks the scope and expiry and approves; Sneed
// Hub signs a delegation from the user's login to the session key (one more link in the chain
// Internet Identity made) and POSTs it to the callback (or navigates there, or shows a code to
// paste into connect_as_me). The chain is useless without the session key's private half, which
// never leaves this machine.
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { Ed25519KeyIdentity } from '@dfinity/identity';
import { storeDelegation } from './identity.js';
import { HUB_URL } from './ic.js';

const LISTEN_MS = 15 * 60 * 1000;
const MAX_BODY = 256 * 1024;

/// Same short code as Sneed Hub's /pair and /connect-agent pages (utils/pairing.js checkCode).
export const checkCode = (keyHex) => {
  const digest = createHash('sha256').update(Buffer.from(keyHex, 'hex')).digest();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = Array.from(digest.subarray(0, 6), (b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
};

let pending = null; // { sessionKey, keyHex, code, server, secret, agentName, done, result, error, timer }

const close = () => {
  if (!pending) return;
  clearTimeout(pending.timer);
  try { pending.server?.close(); } catch { /* ignore */ }
};

/// Accept a chain (JSON text or base64url of it) for the pending session key.
export const acceptChain = (text) => {
  if (!pending) throw new Error('No connection is pending. Call connect_as_me first.');
  let s = String(text).trim();
  if (!s.startsWith('{')) s = Buffer.from(s, 'base64url').toString('utf8');
  let body = JSON.parse(s);
  if (body && body.delegation_chain) body = body.delegation_chain;
  const stored = storeDelegation({ sessionKey: pending.sessionKey, chainJson: body, agentName: pending.agentName });
  pending.result = stored;
  pending.done = true;
  close();
  return stored;
};

const PAGE = (title, msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;max-width:520px;margin:3rem auto;padding:0 16px;background:#111;color:#eee"><h1 style="font-size:1.3rem">${title}</h1><p>${msg}</p></body>`;

/// Start a connection: returns { url, code, port, expires_listening }.
export const startConnect = async ({ agentName = 'Sneed Hub MCP agent', hubUrl = HUB_URL } = {}) => {
  close();
  const sessionKey = Ed25519KeyIdentity.generate();
  const keyHex = Buffer.from(sessionKey.getPublicKey().toDer()).toString('hex');
  const secret = randomBytes(16).toString('hex');
  const p = { sessionKey, keyHex, code: checkCode(keyHex), secret, agentName, done: false };
  pending = p;
  const cors = {
    'Access-Control-Allow-Origin': hubUrl,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Private-Network': 'true',
    Vary: 'Origin',
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== `/${secret}`) { res.writeHead(404).end(); return; }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return; }
    const finish = (text) => {
      try {
        const st = acceptChain(text);
        const msg = `Connected as ${st.principal} until ${st.expires}. You can close this tab and go back to your agent.`;
        if (req.method === 'GET') res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('Agent connected', msg));
        else res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, principal: st.principal, expires: st.expires }));
      } catch (e) {
        p.error = e.message;
        if (req.method === 'GET') res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('Not connected', String(e.message).replace(/[<&]/g, '')));
        else res.writeHead(400, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: e.message }));
      }
    };
    if (req.method === 'GET' && url.searchParams.get('d')) return finish(url.searchParams.get('d'));
    if (req.method !== 'POST') { res.writeHead(405, cors).end(); return; }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > MAX_BODY) req.destroy(); });
    req.on('end', () => finish(body));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  p.server = server;
  p.timer = setTimeout(() => { if (pending === p && !p.done) close(); }, LISTEN_MS);
  p.timer.unref?.();
  const port = server.address().port;
  const callback = `http://127.0.0.1:${port}/${secret}`;
  const url = `${hubUrl}/connect-agent?key=${keyHex}&name=${encodeURIComponent(agentName)}&callback=${encodeURIComponent(callback)}`;
  return { url, code: p.code, port, listening_until: new Date(Date.now() + LISTEN_MS).toISOString() };
};

export const pendingStatus = () => (pending ? { done: pending.done, code: pending.code, error: pending.error ?? null, result: pending.result ?? null } : null);
export const stopConnect = () => { close(); pending = null; };
