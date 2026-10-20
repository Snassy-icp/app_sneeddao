// Read-only mainnet check of src/utils/ExtUtils.js against the Sneed Diamond Club (EXT).
// Never transfers. Run: node scripts/ext-check.mjs [canisterId]
import { Principal } from '@dfinity/principal';
import { tokenIdentifier, decodeTokenIdentifier, accountId, isValidAccountId, listTokens, fetchRegistry, tokenMetadata, metadataByTid, bearer, isExtCollection, extTokenView, anonymousExtAgent } from '../src/utils/ExtUtils.js';

const canister = process.argv[2] || 'gjv36-laaaa-aaaah-adyza-cai';
const agent = anonymousExtAgent('https://icp0.io');
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok  ', m); };

// identifiers
const tid0 = tokenIdentifier(canister, 0);
console.log('tid(0)        ', tid0);
const d = decodeTokenIdentifier(tid0);
assert(d && d.canisterId === canister && d.index === 0, 'tid decodes back to (canister, 0)');
assert(decodeTokenIdentifier(tokenIdentifier(canister, 70000))?.index === 70000, 'tid round-trips a large index');
// the ICP ledger's own account id of the anonymous principal is a published constant
const anonAid = accountId(Principal.anonymous());
console.log('aid(anonymous)', anonAid);
assert(anonAid === '1c7a48ba6a562aa9eaa2481a9049cdf0433b9738c992d698c31d8abf89cadc79', 'account id of the anonymous principal matches the known value');
assert(isValidAccountId(anonAid) && !isValidAccountId(anonAid.slice(0, 63) + (anonAid[63] === '0' ? '1' : '0')), 'checksum validation accepts it and rejects a one-character change');

assert(await isExtCollection(canister, agent), 'canister answers as EXT');
const holder0 = await bearer(canister, 0, agent);
console.log('bearer(0)     ', holder0);
assert(isValidAccountId(holder0), 'bearer(tid(0)) answers ok with an account id, so the tid encoding is right');

const reg = await fetchRegistry(canister, agent);
console.log('registry      ', reg.length, 'tokens; first', reg[0]);
assert(reg.find((r) => r.index === 0)?.accountId === holder0, 'registry and bearer agree on token 0');
const owner = reg[0].accountId;
const mine = await listTokens(canister, owner, agent);
const expected = reg.filter((r) => r.accountId === owner).map((r) => r.index);
console.log('listTokens    ', owner, '->', mine.length, 'tokens:', mine.slice(0, 10).join(', '), mine.length > 10 ? '…' : '');
assert(JSON.stringify(mine) === JSON.stringify(expected), 'listTokens matches the registry for that owner');
assert((await listTokens(canister, Principal.anonymous(), agent)).length === 0, 'listTokens of an account with none is []');

const metas = await tokenMetadata(canister, mine.slice(0, 3), agent);
for (const [i, m] of metas) {
    console.log(`#${i}`, JSON.stringify({ name: m.name, image: m.image, thumb: m.thumb, attributes: m.attributes, exists: m.exists, fallbackImage: m.fallbackImage }));
}
const first = metas.get(mine[0]);
const viaTid = await metadataByTid(canister, mine[0], agent);
assert(viaTid.name === first.name && viaTid.image === first.image, 'metadata(tid) fallback reads the same card as getTokensByIds');
assert((await metadataByTid(canister, 999999, agent)).exists === false, 'a token index that does not exist reads as missing');
assert(first?.exists && first.name, 'metadata has a name');
const view = extTokenView(canister, mine[0], first, owner);
assert(view.metadata.some(([k]) => k === 'image'), 'token view carries an image');
console.log('All read-only checks passed.');
