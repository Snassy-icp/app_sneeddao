// Exercise src/utils/approvals.js against mainnet, read-only (queries only, anonymous agent).
//
//   node scripts/approvals-mainnet.mjs [principal] [ledger …]
//
// Without arguments it checks Mr Sneed (tksci-…) and a ckUSDC account known to hold an
// "unlimited" approval, on ICP, SNEED, ckUSDC and ckBTC, plus a few offline unit checks.
// Exits 1 if a check fails.
import { HttpAgent } from '@dfinity/agent';
import assert from 'node:assert/strict';
import {
    discoverApprovals, getLedgerApprovalInfo, approvalRisk, icpAccountId, accountKey, normSubaccount,
    subaccountHex, toAccount, mapLimited, makeLimiter, ICP_LEDGER_ID,
} from '../src/utils/approvals.js';

const LEDGERS = {
    ICP: ICP_LEDGER_ID,
    SNEED: 'hvgxa-wqaaa-aaaaq-aacia-cai',
    ckUSDC: 'xevnm-gaaaa-aaaar-qafnq-cai',
    ckBTC: 'mxzaz-hqaaa-aaaar-qaada-cai',
    GLDT: '6c7su-kiaaa-aaaar-qaira-cai',
};
const MR_SNEED = 'tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae';
// approved mohjv-bqaaa-aaaag-qjyia-cai for 2^127-1 ckUSDC without expiry (seen on the ledger 2026-10-21)
const UNLIMITED_APPROVER = 'pcudm-53nd5-qfej3-ejgzf-ngi3o-6do7y-qvunw-kzdhl-rm2zn-clbcx-kqe';

// ---- offline checks ----
assert.equal(icpAccountId('aaaaa-aa'), '2d0e897f7e862d2b57d9bc9ea5c65f9a24ac6c074575f47898314b8d6cb0929d');
assert.equal(normSubaccount(new Uint8Array(32)), null);
assert.equal(normSubaccount([]), null);
assert.equal(subaccountHex([new Uint8Array([1, ...new Array(31).fill(0)])]), '01' + '00'.repeat(31));
assert.equal(accountKey(MR_SNEED), MR_SNEED);
assert.equal(accountKey(MR_SNEED, '00'.repeat(31) + '07'), `${MR_SNEED}.${'00'.repeat(31)}07`);
assert.deepEqual(toAccount(MR_SNEED).subaccount, []);
{
    const r = approvalRisk({ allowance: 2n ** 127n - 1n, expiresAt: null }, { decimals: 6 });
    assert.ok(r.unlimited && r.noExpiry && r.level === 'warn');
    const r2 = approvalRisk({ allowance: 100_000_000n, expiresAt: 1n }, { decimals: 8, balance: 50_000_000n });
    assert.ok(!r2.unlimited && !r2.noExpiry && r2.aboveBalance && r2.level === 'ok');
    const r3 = approvalRisk({ allowance: 1000n, expiresAt: 1n }, { decimals: 8, totalSupply: 1000n });
    assert.ok(r3.unlimited);
}
assert.deepEqual(await mapLimited([1, 2, 3, 4, 5], 2, async (x) => x * 2), [2, 4, 6, 8, 10]);
{
    const lim = makeLimiter(2); let active = 0; let peak = 0;
    await Promise.all([1, 2, 3, 4, 5].map(() => lim(async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 20)); active--; })));
    assert.equal(peak, 2);
}
console.log('offline checks: OK');

// ---- mainnet ----
const agent = HttpAgent.createSync({ host: 'https://icp-api.io' });
const [, , argPrincipal, ...argLedgers] = process.argv;
const show = (r) => {
    console.log(`  method=${r.method} complete=${r.complete} approvals=${r.approvals.length}${r.notes.length ? ` notes=${JSON.stringify(r.notes)}` : ''}`);
    for (const a of r.approvals) {
        console.log(`    → ${a.spender ? accountKey(a.spender.owner, a.spender.subaccount) : `account id ${a.spenderAccountId}`} allowance=${a.allowance} expires=${a.expiresAt ?? 'never'} source=${a.source} verified=${a.verified}`);
    }
};

let failed = false;
const check = async (label, fn) => {
    try { await fn(); console.log(`${label}: OK`); } catch (e) { failed = true; console.error(`${label}: FAILED`, e); }
};

if (argPrincipal) {
    for (const l of argLedgers.length ? argLedgers : Object.values(LEDGERS)) {
        await check(`${argPrincipal} on ${l}`, async () => show(await discoverApprovals({ agent, ledgerId: l, owner: argPrincipal })));
    }
} else {
    await check('ledger facts', async () => {
        for (const [name, id] of Object.entries(LEDGERS)) {
            const i = await getLedgerApprovalInfo(agent, id);
            console.log(`  ${name}: icrc2=${i.icrc2} icrc103=${i.icrc103} index=${i.indexId} (${i.indexKind}) standards=${i.standards.join(',')}`);
        }
        assert.equal((await getLedgerApprovalInfo(agent, LEDGERS.ICP)).indexKind, 'icp');
        assert.ok((await getLedgerApprovalInfo(agent, LEDGERS.SNEED)).icrc103);
    });
    for (const [name, id] of Object.entries(LEDGERS)) {
        await check(`Mr Sneed on ${name}`, async () => {
            const r = await discoverApprovals({ agent, ledgerId: id, owner: MR_SNEED });
            show(r);
            assert.ok(Array.isArray(r.approvals));
        });
    }
    await check('unlimited ckUSDC approval via ICRC-103', async () => {
        const r = await discoverApprovals({ agent, ledgerId: LEDGERS.ckUSDC, owner: UNLIMITED_APPROVER });
        show(r);
        assert.equal(r.method, 'icrc103');
        const a = r.approvals.find((x) => x.spender?.owner.toText() === 'mohjv-bqaaa-aaaag-qjyia-cai');
        if (a) assert.ok(approvalRisk(a, { decimals: 6 }).unlimited);
        else console.log('  (that approval is gone since; nothing to assert)');
    });
    await check('same account via index path (ICRC-103 bypassed) agrees', async () => {
        // the index path, forced: a fresh info object without icrc103
        const { approvesFromIndexNg, getAllowance } = await import('../src/utils/approvals.js');
        const info = await getLedgerApprovalInfo(agent, LEDGERS.ckUSDC);
        assert.ok(info.indexId, 'ckUSDC has an index (ICRC-106)');
        const r = await approvesFromIndexNg(agent, info.indexId, UNLIMITED_APPROVER, null, { maxTxs: 2000 });
        console.log(`  index: ${r.spenders.length} spender(s) approved in history, complete=${r.complete}`);
        const live = [];
        for (const s of r.spenders) { const a = await getAllowance(agent, LEDGERS.ckUSDC, UNLIMITED_APPROVER, null, s.spender); if (a.allowance > 0n && (a.expiresAt == null || a.expiresAt > BigInt(Date.now()) * 1_000_000n)) live.push(accountKey(s.spender.owner, s.spender.subaccount)); }
        const via103 = (await discoverApprovals({ agent, ledgerId: LEDGERS.ckUSDC, owner: UNLIMITED_APPROVER })).approvals.map((a) => accountKey(a.spender.owner, a.spender.subaccount));
        console.log(`  live via index: ${live.join(', ') || '-'}; via ICRC-103: ${via103.join(', ') || '-'}`);
        if (r.complete) assert.deepEqual([...live].sort(), [...via103].sort());
    });
    await check('known spenders path (GLDT: no ICRC-103, no ICRC-106)', async () => {
        const r = await discoverApprovals({ agent, ledgerId: LEDGERS.GLDT, owner: MR_SNEED, candidates: [{ owner: 'i2s4q-syaaa-aaaan-qz4sq-cai' }] });
        show(r);
        assert.equal(r.method, 'known');
    });
}
process.exit(failed ? 1 : 0);
