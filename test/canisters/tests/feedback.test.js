// app_sneeddao_backend feedback settings: who gets each bug report or idea by Sneed SMS, and the
// forum topics public reports go to. Admins set them; anyone reads them; they survive an upgrade.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, alice, bob, carol, user, T, unwrap, errOf, wasm, refusedAtIngress, asUpdates } from '../lib/pic.js';
import { upgradeHub } from '../lib/hub.js';
import { idlFactory as hubIdl } from '../build/app_sneeddao_backend.did.js';

const anon = Principal.anonymous();
let pic, hubId, hub, hubAlice, hubAnon;

describe('app_sneeddao_backend feedback settings', () => {
  beforeAll(async () => {
    ({ pic } = await createPic());
    hubId = await install(pic, { name: 'app_sneeddao_backend', cycles: 20n * T });
    hub = actorAs(pic, hubIdl, hubId, admin); hubAlice = actorAs(pic, hubIdl, hubId, alice); hubAnon = actorAs(pic, hubIdl, hubId, anon);
  }, 120_000);
  afterAll(async () => { await pic?.tearDown(); });

  it('starts empty', async () => {
    expect(await hubAnon.get_feedback_config()).toEqual({ recipients: [], bug_topic: [], idea_topic: [] });
  });

  it('admins set it, anyone reads it, others are refused', async () => {
    const c = { recipients: [admin, bob], bug_topic: [301n], idea_topic: [302n] };
    expect(errOf(await hubAlice.admin_set_feedback_config(c))).toMatch(/Only admins/);
    unwrap(await hub.admin_set_feedback_config(c));
    const got = await hubAnon.get_feedback_config();
    expect(got.recipients.map((p) => p.toText())).toEqual([admin.toText(), bob.toText()]);
    expect(got.bug_topic).toEqual([301n]);
    expect(got.idea_topic).toEqual([302n]);
  });

  it('at most five recipients, never the anonymous principal', async () => {
    const six = [admin, alice, bob, carol, user('dave'), user('erin')];
    expect(errOf(await hub.admin_set_feedback_config({ recipients: six, bug_topic: [], idea_topic: [] }))).toMatch(/At most 5/);
    expect(errOf(await hub.admin_set_feedback_config({ recipients: [admin, anon], bug_topic: [], idea_topic: [] }))).toMatch(/anonymous/);
    // the refused calls changed nothing
    expect((await hubAnon.get_feedback_config()).recipients).toHaveLength(2);
  });

  it('the ingress guard refuses the query as an update call', async () => {
    const asUpd = actorAs(pic, asUpdates(hubIdl), hubId, alice);
    expect(await refusedAtIngress(asUpd.get_feedback_config())).toBe(true);
  });

  it('survives an upgrade', async () => {
    await upgradeHub(pic, hubId, admin, wasm('app_sneeddao_backend'));
    const got = await hubAnon.get_feedback_config();
    expect(got.recipients.map((p) => p.toText())).toEqual([admin.toText(), bob.toText()]);
    expect(got.bug_topic).toEqual([301n]);
  });
});
