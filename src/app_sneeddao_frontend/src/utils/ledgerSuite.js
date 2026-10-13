// The NNS as the source of truth for ledger-suite code: which ledger and
// index hashes the NNS approved (every SNS version), which is the latest, and
// the bytes of any of them, verified against the hash before use. Used to
// offer upgrades for pad-launched ledgers the way SneedApp offers them for
// bots, without a hand-maintained version list.
import { Principal } from '@dfinity/principal';
import { Actor } from '@dfinity/agent';
import { sha256 } from '@noble/hashes/sha256';
import { getAgent, hex } from '../health/agent.js';

export const SNS_WASM_CANISTER = 'qaa6y-5yaaa-aaaaa-aaafa-cai';
export const TOKEN_APP_IDS = { 'icrc-ledger': 'ledger', 'icrc-index': 'index' };

const snswIdl = ({ IDL }) => {
    const SnsVersion = IDL.Record({ archive_wasm_hash: IDL.Vec(IDL.Nat8), root_wasm_hash: IDL.Vec(IDL.Nat8), swap_wasm_hash: IDL.Vec(IDL.Nat8), ledger_wasm_hash: IDL.Vec(IDL.Nat8), governance_wasm_hash: IDL.Vec(IDL.Nat8), index_wasm_hash: IDL.Vec(IDL.Nat8) });
    const Pretty = IDL.Record({ archive_wasm_hash: IDL.Text, root_wasm_hash: IDL.Text, swap_wasm_hash: IDL.Text, ledger_wasm_hash: IDL.Text, governance_wasm_hash: IDL.Text, index_wasm_hash: IDL.Text });
    return IDL.Service({
        list_upgrade_steps: IDL.Func([IDL.Record({ limit: IDL.Nat32, starting_at: IDL.Opt(SnsVersion), sns_governance_canister_id: IDL.Opt(IDL.Principal) })], [IDL.Record({ steps: IDL.Vec(IDL.Record({ pretty_version: IDL.Opt(Pretty), version: IDL.Opt(SnsVersion) })) })], ['query']),
        get_wasm: IDL.Func([IDL.Record({ hash: IDL.Vec(IDL.Nat8) })], [IDL.Record({ wasm: IDL.Opt(IDL.Record({ wasm: IDL.Vec(IDL.Nat8), canister_type: IDL.Int32, proposal_id: IDL.Opt(IDL.Nat64) })) })], ['query']),
    });
};
const snsw = () => Actor.createActor(snswIdl, { agent: getAgent(SNS_WASM_CANISTER), canisterId: Principal.fromText(SNS_WASM_CANISTER) });

let versionsPromise = null;
let versionsAt = 0;
const VERSIONS_TTL_MS = 60 * 60 * 1000;

/// { latest: { ledger, index }, known: { ledger: Set, index: Set }, versions: n }, hashes as lowercase hex. Cached for an hour.
export function fetchLedgerSuiteVersions() {
    if (versionsPromise && Date.now() - versionsAt < VERSIONS_TTL_MS) return versionsPromise;
    versionsAt = Date.now();
    versionsPromise = (async () => {
        const r = await snsw().list_upgrade_steps({ limit: 500, starting_at: [], sns_governance_canister_id: [] });
        const known = { ledger: new Set(), index: new Set() };
        let latest = { ledger: null, index: null };
        for (const s of r.steps) {
            const v = s.pretty_version[0];
            if (!v) continue;
            known.ledger.add(v.ledger_wasm_hash.toLowerCase());
            known.index.add(v.index_wasm_hash.toLowerCase());
            latest = { ledger: v.ledger_wasm_hash.toLowerCase(), index: v.index_wasm_hash.toLowerCase() };
        }
        if (!latest.ledger) throw new Error('the SNS wasm canister listed no versions');
        return { latest, known, versions: r.steps.length };
    })();
    versionsPromise.catch(() => { versionsPromise = null; });
    return versionsPromise;
}

/// The bytes of an NNS-approved wasm, refused unless their sha256 is the hash asked for.
export async function fetchLedgerSuiteWasm(hashHex) {
    const hash = Uint8Array.from(hashHex.match(/../g).map((h) => parseInt(h, 16)));
    const r = await snsw().get_wasm({ hash });
    const bytes = r.wasm[0]?.wasm;
    if (!bytes) throw new Error(`the SNS wasm canister has no wasm with hash ${hashHex}`);
    const got = hex(sha256(Uint8Array.from(bytes)));
    if (got !== hashHex.toLowerCase()) throw new Error(`wasm hash mismatch: got ${got}, expected ${hashHex}`);
    return Uint8Array.from(bytes);
}

/// The version object the wallet's upgrade machinery understands, for a token app.
export function ledgerSuiteVersion(appId, suite) {
    const kind = TOKEN_APP_IDS[appId];
    if (!kind || !suite?.latest?.[kind]) return null;
    return { major: 0, minor: 0, patch: 0, wasmHash: suite.latest[kind], wasmSource: 'snsw', label: `NNS latest ${kind}`, kind };
}
