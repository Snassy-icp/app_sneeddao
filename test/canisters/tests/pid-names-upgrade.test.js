// sneed_pid_names upgraded from the version production runs (build/sneed_pid_names_prod.wasm,
// commit 75cef0a7: ICRC-7 NFT avatars only) to EXT NFT avatars: the upgrade keeps accounts, names
// and ICRC-7 avatars (now reported as "ICRC-7"), the ICRC-3 log verifies across it, and EXT
// avatars work afterwards. Enhanced orthogonal persistence: the upgrade passes
// wasm_memory_persistence = keep, as the DAO proposal must.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPic, install, actorAs, admin, user, T, unwrap, wasm } from '../lib/pic.js';
import { icrc7Idl, icrc7Init, extIdl, extAccountId } from '../lib/idl.js';
import { verifyLog, archiveIdl, btype, txField, field } from '../lib/icrc3.js';
import { idlFactory as namesIdl } from '../build/sneed_pid_names.did.js';

let pic, rootKey, appSubnet, namesId, names, as;
const ivy = user('upg-ivy'), jay = user('upg-jay');

describe('sneed_pid_names: upgrade from production to EXT avatars', () => {
  beforeAll(async () => {
    ({ pic, rootKey, appSubnet } = await createPic());
    namesId = await install(pic, { name: 'sneed_pid_names_prod', cycles: 20n * T, targetSubnetId: appSubnet });
    names = actorAs(pic, namesIdl, namesId, admin);
    as = (p) => actorAs(pic, namesIdl, namesId, p);
  }, 180_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('keeps ICRC-7 avatars over the upgrade, then takes EXT ones', async () => {
    const nftId = await install(pic, { name: 'Icrc7Demo', initTypes: icrc7Init, initArgs: [{ name: 'Old Cats', symbol: 'OCAT', description: [], logo: [] }], targetSubnetId: appSubnet });
    const cat = unwrap(await actorAs(pic, icrc7Idl, nftId, admin).mint({ owner: ivy, subaccount: [] }, [['name', { Text: 'Cat' }]]));
    unwrap(await as(ivy).set_my_name('Ivy Old'));
    unwrap(await as(ivy).set_my_nft_avatar([{ collection: nftId, token_id: cat }]));
    const extId = await install(pic, { name: 'MockExt', targetSubnetId: appSubnet });
    const card = await actorAs(pic, extIdl, extId, admin).mint(extAccountId(jay), []);
    // the production version has no EXT method
    await expect(as(jay).set_my_ext_nft_avatar([{ collection: extId, token_id: BigInt(card) }])).rejects.toThrow();
    const before = await names.get_name(ivy);
    expect(before[0].nft_avatar_standard).toEqual([]); // not in production's answer
    const stats = await names.stats();

    await pic.upgradeCanister({ sender: admin, canisterId: namesId, wasm: wasm('sneed_pid_names'), upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });

    const after = (await names.get_name(ivy))[0];
    expect(after.name).toEqual(['Ivy Old']);
    expect(after.nft_avatar).toEqual(before[0].nft_avatar);
    expect(after.nft_avatar_standard).toEqual(['ICRC-7']);
    expect((await names.stats()).accounts).toBe(stats.accounts);
    expect(unwrap(await as(jay).refresh_nft_avatar((await names.get_account_of(ivy))[0].id))).toBe('Still owned');

    unwrap(await as(jay).set_my_ext_nft_avatar([{ collection: extId, token_id: BigInt(card) }]));
    expect((await names.get_name(jay))[0].nft_avatar_standard).toEqual(['EXT']);
    expect((await names.get_name(ivy))[0].nft_avatar_standard).toEqual(['ICRC-7']);

    const { blocks } = await verifyLog(names, namesId, rootKey, (id) => actorAs(pic, archiveIdl, id, admin));
    const sets = blocks.filter((b) => btype(b) === 'sneednames_nft_avatar_set').map((b) => field(txField(b, 'nft_avatar'), 'standard')?.Text ?? null);
    expect(sets).toEqual([null, 'EXT']); // production's block has no standard; it means ICRC-7
  });
});
