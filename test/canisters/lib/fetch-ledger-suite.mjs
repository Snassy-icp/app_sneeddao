// Fetch the latest NNS-approved ledger-suite ledger and index wasms from the
// SNS wasm canister into the test build directory (used by the sneed_pad tests).
import { createRequire } from 'module';
import { writeFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { Actor } = require('@dfinity/agent');
import { getAgent } from '../../../src/app_sneeddao_frontend/src/health/agent.js';
import { idlFactory } from '../../../src/declarations/nns_snsw/nns_snsw.did.js';
const W = 'qaa6y-5yaaa-aaaaa-aaafa-cai';
const w = Actor.createActor(idlFactory, { agent: getAgent(W), canisterId: W });
const steps = await w.list_upgrade_steps({ limit: 500, starting_at: [], sns_governance_canister_id: [] });
const last = steps.steps[steps.steps.length - 1].pretty_version[0];
const out = process.argv[2];
mkdirSync(out, { recursive: true });
for (const [kind, hex] of [['ledger', last.ledger_wasm_hash], ['index', last.index_wasm_hash]]) {
  const hash = Uint8Array.from(Buffer.from(hex, 'hex'));
  const r = await w.get_wasm({ hash });
  const bytes = Uint8Array.from(r.wasm[0].wasm);
  const got = createHash('sha256').update(bytes).digest('hex');
  if (got !== hex) throw new Error(`${kind}: hash mismatch ${got} vs ${hex}`);
  writeFileSync(`${out}/${kind}.wasm.gz`, bytes);
  writeFileSync(`${out}/${kind}.sha256`, hex + '\n');
  console.log(kind, bytes.length, 'bytes, sha256', hex);
}
