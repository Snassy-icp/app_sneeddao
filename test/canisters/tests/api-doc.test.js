// get_api_doc (ICP service discoverability, "Behavior: getApiDoc / get_api_doc"): every DAO
// canister answers `get_api_doc : () -> (text) query` with a short Markdown guide for agents that
// links its full reference on app.sneeddao.com. As a query it is free; the ingress guard refuses
// it as an update call, like every other query.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IDL } from '@icp-sdk/core/candid';
import { createPic, install, actorAs, alice, admin, T, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { init as premiumInit } from '../build/sneed_premium.did.js';
import { init as sneedexInit } from '../build/sneedex.did.js';

// The method alone, so the test does not depend on the canister's own (generated) interface.
const apiDocIdl = ({ IDL }) => IDL.Service({ get_api_doc: IDL.Func([], [IDL.Text], ['query']) });

// canister (as built into test/canisters/build) -> slug of its reference under /api-docs/
const CANISTERS = [
  ['app_sneeddao_backend', 'app_sneeddao_backend'],
  ['sneed_lock', 'sneed_lock'],
  ['sneedex', 'sneedex', { initTypes: sneedexInit({ IDL }), initArgs: [[]] }],
  ['sneed_sms', 'sneed_sms'],
  ['sneed_notifications', 'sneed_notifications'],
  ['sneed_mon', 'sneed_mon'],
  ['sneed_pid_names', 'sneed_names'],
  ['sneed_neuron_names', 'sneed_names'],
  ['sneed_pid_nicknames', 'sneed_names'],
  ['sneed_neuron_nicknames', 'sneed_names'],
  ['sneed_avatars', 'sneed_names'],
  ['sneed_profiles', 'sneed_names'],
  ['sneed_premium', 'sneed_premium', { initTypes: premiumInit({ IDL }), initArgs: [[]] }],
  ['rll', 'rll'],
  ['sneedapp', 'sneedapp'],
  ['mr_sneed', 'mr_sneed'],
  ['sneed_proxy', 'sneed_proxy'],
];

let pic;
const ids = {};
beforeAll(async () => {
  let appSubnet;
  ({ pic, appSubnet } = await createPic());
  for (const [name, , extra = {}] of CANISTERS) {
    ids[name] = await install(pic, { name, cycles: 20n * T, targetSubnetId: appSubnet, ...extra });
  }
}, 300_000);
afterAll(async () => { await pic?.tearDown(); });

describe('get_api_doc', () => {
  for (const [name, slug] of CANISTERS) {
    it(`${name}: Markdown guide linking /api-docs/${slug}.md, as a query only`, async () => {
      const doc = await actorAs(pic, apiDocIdl, ids[name], alice).get_api_doc();
      expect(doc.startsWith('# '), 'starts with a Markdown heading').toBe(true);
      expect(doc).toContain(`https://app.sneeddao.com/api-docs/${slug}.md`);
      expect(doc).toContain('https://app.sneeddao.com/llms.txt');
      expect(doc).toMatch(/^## /m);
      expect(doc.length).toBeGreaterThan(1_000);
      expect(doc.length).toBeLessThan(8_000);
      // never accepted as an update call, from a user or a controller
      for (const who of [alice, admin]) {
        expect(await refusedAtIngress(actorAs(pic, asUpdates(apiDocIdl), ids[name], who).get_api_doc()), `${name} as update`).toBe(true);
      }
    });
  }
});
