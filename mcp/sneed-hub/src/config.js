// Configuration: environment variables, an optional config file, and the config directory that
// holds the agent's own key, a stored "act as me" delegation, the spending ledger and the audit log.
//
//   SNEED_MCP_CONFIG_DIR       config directory (default ~/.config/sneed-hub-mcp)
//   SNEED_MCP_CONFIG           config file (default <dir>/config.json), optional
//   SNEED_MCP_WRITES=1         register the write tools (default off)
//   SNEED_MCP_ALLOW_TRANSFERS=1  allow plain ledger transfers to arbitrary accounts (default off)
//   SNEED_MCP_IDENTITY         path of the agent's own key file (default <dir>/identity.json)
//   SNEED_MCP_DFX_IDENTITY     use this dfx identity (plaintext ~/.config/dfx/identity/<name>/identity.pem)
//   SNEED_MCP_IDENTITY_PEM     use this PEM (e.g. a dfx identity's identity.pem) as the agent's own key
//   SNEED_MCP_AUDIT_LOG        audit log path (default <dir>/audit.jsonl)
//   SNEED_MCP_CAPS             JSON {"<ledger id or symbol>": "<daily cap in whole tokens>"}
//   SNEED_MCP_CANISTER_<NAME>  override a canister id (e.g. SNEED_MCP_CANISTER_SNEED_MON=...)
//   SNEED_HUB_IC_HOST          IC API host (default https://icp-api.io)
//   SNEED_MCP_FETCH_ROOT_KEY=1 fetch the root key from the host (local replicas / PocketIC only)
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const truthy = (v) => v != null && /^(1|true|yes|on)$/i.test(String(v).trim());

export const configDir = () => process.env.SNEED_MCP_CONFIG_DIR || join(homedir(), '.config', 'sneed-hub-mcp');

let cached = null;
/// The config file as an object ({} when absent or unreadable).
export const fileConfig = () => {
  if (cached) return cached;
  const path = process.env.SNEED_MCP_CONFIG || join(configDir(), 'config.json');
  cached = {};
  if (existsSync(path)) {
    try { cached = JSON.parse(readFileSync(path, 'utf8')) || {}; } catch (e) {
      process.stderr.write(`sneed-hub-mcp: ignoring unreadable config ${path}: ${e.message}\n`);
    }
  }
  return cached;
};
export const resetConfigCache = () => { cached = null; };

/// Default daily caps, in whole tokens, per ledger. Small on purpose; raise them in the config.
export const DEFAULT_CAPS = {
  'ryjl3-tyaaa-aaaaa-aaaba-cai': '1', // ICP
  'hvgxa-wqaaa-aaaaq-aacia-cai': '1000', // SNEED
};

export const settings = () => {
  const f = fileConfig();
  let envCaps = {};
  if (process.env.SNEED_MCP_CAPS) {
    try { envCaps = JSON.parse(process.env.SNEED_MCP_CAPS); } catch { process.stderr.write('sneed-hub-mcp: SNEED_MCP_CAPS is not JSON; ignored\n'); }
  }
  return {
    writes: truthy(process.env.SNEED_MCP_WRITES) || f.writes === true,
    allowTransfers: truthy(process.env.SNEED_MCP_ALLOW_TRANSFERS) || f.allow_transfers === true,
    identityPath: process.env.SNEED_MCP_IDENTITY || f.identity_path || join(configDir(), 'identity.json'),
    identityPem: process.env.SNEED_MCP_IDENTITY_PEM || f.identity_pem || null,
    dfxIdentity: process.env.SNEED_MCP_DFX_IDENTITY || f.dfx_identity || null,
    dfxHome: process.env.DFX_CONFIG_ROOT ? join(process.env.DFX_CONFIG_ROOT, '.config', 'dfx') : join(homedir(), '.config', 'dfx'),
    delegationPath: join(configDir(), 'delegation.json'),
    spendPath: join(configDir(), 'spend.json'),
    auditPath: process.env.SNEED_MCP_AUDIT_LOG || f.audit_log || join(configDir(), 'audit.jsonl'),
    caps: { ...DEFAULT_CAPS, ...(f.caps || {}), ...envCaps },
    canisters: f.canisters || {},
  };
};

export { truthy };
