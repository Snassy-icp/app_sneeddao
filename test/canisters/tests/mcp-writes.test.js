// The Sneed Hub MCP server's write tools (mcp/sneed-hub) against real canisters on PocketIC, over
// the HTTP gateway (pic.makeLive) with the server's own agent code, signer and safety layer:
// - own identity (the agent's generated key): set a Sneed name, start a forum thread and post in it,
//   send a Sneed SMS, lock tokens in Sneed Lock (ICP lock fee + token deposit + create_lock), bid on a
//   Sneedex offer;
// - "act as me" (a delegation from a user's login to the agent's session key, as /connect-agent
//   signs it): calls arrive as the USER's principal; a Sneedex offer of the user's ICRC-7 and EXT NFTs
//   is created end to end (creation fee, createOffer, addAsset, finalizeAssets, ICRC-37 approval +
//   escrowICRC7NFTsByApproval, EXT transfer to the escrow account id + escrowEXTNFTs, activateOffer);
//   a canister outside the delegation's targets is refused by the replica itself.
// Every write goes through preview -> confirm token -> execution -> audit line.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createPic, install, actorAs, admin, account, unwrap, ICP_LEDGER_ID, T } from '../lib/pic.js';
import { ledgerIdl, ledgerInit, icrc7Idl, icrc7Init, extIdl, extAccountId, extTokenIdentifier } from '../lib/idl.js';
import { idlFactory as sneedexIdl, init as sneedexInit } from '../build/sneedex.did.js';
import { idlFactory as forumIdl } from '../build/sneed_sns_forum.did.js';
import { idlFactory as smsIdl } from '../build/sneed_sms.did.js';
import { idlFactory as namesIdl } from '../build/sneed_pid_names.did.js';
import { idlFactory as lockIdl } from '../build/sneed_lock.did.js';

const MCP = new URL('../../../mcp/sneed-hub/', import.meta.url);
const mcpImport = (p) => import(new URL(p, MCP).href);
const E8 = 100_000_000n;
const ICP_FEE = 10_000n;

let pic, port, m = {};
let icpId, tokId, nftId, extId, dexId, forumId, smsId, namesId, lockId;
let agentPrincipal, userRoot, userPrincipal;
const recipient = Principal.selfAuthenticating(new TextEncoder().encode('mcp-recipient'));

const textOf = (r) => r.content.map((c) => c.text).join('\n');
/// Preview, then confirm with the token, as an MCP client would after the user's OK.
const write = async (name, args) => {
  const spec = m.specs[name];
  const preview = await m.handleWrite(spec, args);
  const pt = textOf(preview);
  expect(pt, pt).toMatch(/PREVIEW of /);
  expect(pt, pt).not.toMatch(/BLOCKED/);
  const token = pt.match(/confirm: "([0-9a-f]+)"/)[1];
  const done = await m.handleWrite(spec, { ...args, confirm: token });
  const dt = textOf(done);
  expect(done.isError, dt).toBeFalsy();
  return { preview: pt, done: dt };
};

describe('Sneed Hub MCP write tools on PocketIC', () => {
  beforeAll(async () => {
    process.env.SNEED_MCP_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'sneed-mcp-pic-'));
    ({ pic } = await createPic());
    icpId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: ICP_FEE, symbol: 'ICP', decimals: 8 }], targetCanisterId: ICP_LEDGER_ID });
    tokId = await install(pic, { name: 'MockLedger', initTypes: ledgerInit, initArgs: [{ fee: 1_000n, symbol: 'TOK', decimals: 8 }] });
    nftId = await install(pic, { name: 'Icrc7Demo', initTypes: icrc7Init, initArgs: [{ name: 'MCP Cats', symbol: 'MCAT', description: [], logo: [] }] });
    extId = await install(pic, { name: 'MockExt' });
    dexId = await install(pic, { name: 'sneedex', initTypes: sneedexInit({ IDL }), initArgs: [[]] });
    // the forum looks up SNS governance through SNS-W (for the Sneed forum: a mock governance)
    await install(pic, { name: 'MockForumSnsW', targetCanisterId: Principal.fromText('qaa6y-5yaaa-aaaaa-aaafa-cai') });
    const govId = await install(pic, { name: 'MockForumGovernance' });
    await actorAs(pic, ({ IDL }) => IDL.Service({ set_instances: IDL.Func([IDL.Vec(IDL.Tuple(IDL.Principal, IDL.Principal))], [], []) }), Principal.fromText('qaa6y-5yaaa-aaaaa-aaafa-cai'), admin)
      .set_instances([[Principal.fromText('fp274-iaaaa-aaaaq-aacha-cai'), govId]]);
    forumId = await install(pic, { name: 'sneed_sns_forum' });
    smsId = await install(pic, { name: 'sneed_sms' });
    namesId = await install(pic, { name: 'sneed_pid_names', cycles: 20n * T });
    lockId = await install(pic, { name: 'sneed_lock', cycles: 20n * T });

    // the server, pointed at this PocketIC
    port = await pic.makeLive();
    const ic = await mcpImport('src/ic.js');
    ic.configureIc({
      host: `http://127.0.0.1:${port}`,
      fetchRootKey: true,
      canisters: {
        icp_ledger: icpId.toText(), sneedex: dexId.toText(), sneed_sns_forum: forumId.toText(), sneed_sms: smsId.toText(),
        sneed_pid_names: namesId.toText(), sneed_lock: lockId.toText(),
      },
    });
    const writes = await mcpImport('src/writes.js');
    const safety = await mcpImport('src/safety.js');
    const identity = await mcpImport('src/identity.js');
    const idlib = await mcpImport('node_modules/@dfinity/identity/lib/esm/index.js');
    m = { ...writes, ...identity, idlib, ic, specs: {} };
    for (const mod of ['w_social', 'w_gov', 'w_sneedex', 'w_misc']) {
      const x = await mcpImport(`src/tools/${mod}.js`);
      for (const list of Object.values(x)) if (Array.isArray(list)) for (const s of list) m.specs[s.name] = s;
    }
    writes.setGuard(new safety.WriteGuard({
      caps: { [icpId.toText()]: '5', [tokId.toText()]: '1000' },
      auditPath: join(process.env.SNEED_MCP_CONFIG_DIR, 'audit.jsonl'),
      spendPath: join(process.env.SNEED_MCP_CONFIG_DIR, 'spend.json'),
    }));
    agentPrincipal = Principal.fromText(identity.ownIdentity().principal);

    // the user: a login key (stands in for Internet Identity) and a browser session under it
    userRoot = idlib.Ed25519KeyIdentity.generate();
    userPrincipal = userRoot.getPrincipal();

    const icp = actorAs(pic, ledgerIdl, icpId, admin);
    const tok = actorAs(pic, ledgerIdl, tokId, admin);
    await icp.mint(account(agentPrincipal), 10n * E8);
    await icp.mint(account(userPrincipal), 10n * E8);
    await tok.mint(account(agentPrincipal), 500n * E8);
    // fees: a Sneedex creation fee and a Sneed Lock fee, so the payment steps run
    unwrap(await actorAs(pic, sneedexIdl, dexId, admin).setOfferCreationFee(10_000_000n));
    unwrap(await actorAs(pic, lockIdl, lockId, admin).admin_set_lock_fees_icp([50_000_000n], [], [], []));
    // the forum's Sneed forum and a topic
    const f = actorAs(pic, forumIdl, forumId, admin);
    const forum = unwrap(await f.create_forum({ title: 'Sneed', description: 'The Sneed DAO forum', sns_root_canister_id: [] }));
    m.topic = unwrap(await f.create_topic({ forum_id: forum, parent_topic_id: [], title: 'General', description: 'Talk' }));
    // the user's NFTs
    const nft = actorAs(pic, icrc7Idl, nftId, admin);
    for (let i = 1; i <= 2; i++) unwrap(await nft.mint(account(userPrincipal), [['name', { Text: `Cat #${i}` }]]));
    m.extIndex = await actorAs(pic, extIdl, extId, admin).mint(extAccountId(userPrincipal), []);
  }, 300_000);

  afterAll(async () => { try { await pic?.stopLive(); } catch { /* */ } await pic?.tearDown(); });

  it('own identity: whoami-level facts, then set a Sneed name', async () => {
    const who = m.activeIdentity();
    expect(who.mode).toBe('own');
    const { preview, done } = await write('name_set', { name: 'MCP Test Agent' });
    expect(preview).toMatch(new RegExp(`set_my_name\\(\\["MCP Test Agent"\\]\\)`));
    expect(done).toMatch(/Done/);
    const info = (await actorAs(pic, namesIdl, namesId, admin).get_name(agentPrincipal))[0];
    expect(info.name[0]).toBe('MCP Test Agent');
  });

  it('own identity: start a thread and reply in it', async () => {
    const t = await write('forum_create_thread', { topic_id: Number(m.topic), title: 'Hello from an agent', body: 'First post.' });
    const threadId = BigInt(t.done.match(/thread (\d+) created/)[1]);
    const p = await write('forum_post', { thread_id: Number(threadId), body: 'A reply, signed by the agent.' });
    const postId = BigInt(p.done.match(/post (\d+) created/)[1]);
    const post = (await actorAs(pic, forumIdl, forumId, admin).get_post(postId))[0];
    expect(post.created_by.toText()).toBe(agentPrincipal.toText());
    expect(post.thread_id).toBe(threadId);
    await write('forum_edit_post', { post_id: Number(postId), body: 'Edited.' });
    expect((await actorAs(pic, forumIdl, forumId, admin).get_post(postId))[0].body).toBe('Edited.');
  });

  it('own identity: send a Sneed SMS', async () => {
    const { done } = await write('sms_send', { recipients: [recipient.toText()], subject: 'Hi', body: 'From the MCP server.' });
    expect(done).toMatch(/message \d+ sent/);
    const inbox = await actorAs(pic, smsIdl, smsId, recipient).get_received_messages();
    expect(inbox.map((x) => [x.sender.toText(), x.subject])).toEqual([[agentPrincipal.toText(), 'Hi']]);
  });

  it('own identity: lock tokens (ICP lock fee, token deposit, create_lock)', async () => {
    const { preview, done } = await write('sneed_lock_create_token_lock', { ledger: tokId.toText(), amount: '100', lock_days: 1 });
    expect(preview).toMatch(/lock fee/);
    expect(preview).toMatch(/0\.5001 ICP on/); // fee + ledger fee in the spends
    const lockNum = BigInt(done.match(/lock (\d+) created/)[1]);
    const st = (await actorAs(pic, lockIdl, lockId, admin).get_lock_state(lockNum))[0];
    expect(st.owner.toText()).toBe(agentPrincipal.toText());
    expect(st.amount[0]).toBe(100n * E8);
    expect(st.locked).toBe(true);
  });

  it('act as me: the /connect-agent page\'s approval (utils/agentConnect.js) is accepted, and calls arrive as the user', async () => {
    const fe = await import('../../../src/app_sneeddao_frontend/src/utils/agentConnect.js');
    const { Ed25519KeyIdentity, DelegationChain, DelegationIdentity } = m.idlib;
    // the user's login: a key standing in for Internet Identity, delegating to the browser's session key
    const browser = Ed25519KeyIdentity.generate();
    const login = await DelegationChain.create(userRoot, browser.getPublicKey(), new Date(Date.now() + 86400_000));
    const session = DelegationIdentity.fromDelegation(browser, login);
    // the MCP side: connect_as_me's session key and link
    const { startConnect, stopConnect } = await mcpImport('src/connect.js');
    const link = new URL((await startConnect({ agentName: 'pic test' })).url);
    const keyHex = link.searchParams.get('key');
    const callback = link.searchParams.get('callback');
    expect(fe.validCallback(callback)).toBe(true);
    expect(fe.validCallback('https://evil.example/cb')).toBe(false);
    expect(fe.validCallback('http://192.168.1.5:9999/x')).toBe(false);
    // the page: scope = Sneed canisters (none configured in this test build) + ICP + chosen collections
    const targets = fe.targetsFor({ icp: true, extra: [dexId.toText(), nftId.toText(), extId.toText()] });
    expect(targets).toContain(ICP_LEDGER_ID.toText());
    const chainJson = await fe.approveAgent(session, keyHex, { targets, expiresMs: Date.now() + 3600_000 });
    const answer = await fe.deliverToAgent(callback, chainJson);
    expect(answer.principal).toBe(userPrincipal.toText());
    stopConnect();
    const who = m.activeIdentity();
    expect(who.mode).toBe('delegation');
    expect(who.principal).toBe(userPrincipal.toText());
    expect([...who.targets].sort()).toEqual([...targets].sort());
  });

  it('act as me: create a Sneedex offer of the user\'s ICRC-7 and EXT NFTs, end to end', async () => {
    const { preview, done } = await write('sneedex_create_offer', {
      assets: [{ type: 'icrc7', collection: nftId.toText(), token_ids: [1, 2] }, { type: 'ext', collection: extId.toText(), token_ids: [Number(m.extIndex)] }],
      min_bid: '1', buyout: '3', expiration_days: 2, public_note: 'Two cats and a card',
    });
    expect(preview).toMatch(/\(you, via Sneed Hub delegation/);
    expect(preview).toMatch(/icrc37_approve_tokens/);
    expect(preview).toMatch(/escrowEXTNFTs/);
    expect(preview).toMatch(/0\.1001 ICP/); // creation fee + ledger fee
    const offerId = BigInt(done.match(/offer (\d+) is live/)[1]);
    m.offerId = offerId;
    const view = (await actorAs(pic, sneedexIdl, dexId, admin).getOfferView(offerId))[0];
    expect(view.offer.creator.toText()).toBe(userPrincipal.toText());
    expect(Object.keys(view.offer.state)[0]).toBe('Active');
    expect(view.offer.assets.every((a) => a.escrowed)).toBe(true);
    const owners = await actorAs(pic, icrc7Idl, nftId, admin).icrc7_owner_of([1n, 2n]);
    expect(owners.map((o) => o[0].owner.toText())).toEqual([dexId.toText(), dexId.toText()]);
    const aid = await actorAs(pic, sneedexIdl, dexId, admin).getOfferEscrowAccountId(userPrincipal, offerId);
    expect(unwrap(await actorAs(pic, extIdl, extId, admin).bearer(extTokenIdentifier(extId, m.extIndex)))).toBe(aid);
  });

  it('act as me: a canister outside the delegation\'s targets is blocked in the preview and refused by the replica', async () => {
    const r = await m.handleWrite(m.specs.sms_send, { recipients: [recipient.toText()], subject: 'x', body: 'y' });
    expect(textOf(r)).toMatch(/BLOCKED[\s\S]*delegation does not cover/);
    const who = m.activeIdentity();
    const sms = await m.ic.signedActor((await mcpImport('src/idl/sneed_sms.did.js')).idlFactory, smsId.toText(), who.identity);
    const err = await sms.send_message({ recipients: [recipient], subject: 'x', body: 'y', reply_to: [] }).then(() => null, (e) => e);
    expect(String(err?.message)).toMatch(/is not one of the delegation targets/); // the replica's own check
    expect((await actorAs(pic, smsIdl, smsId, recipient).get_received_messages()).length).toBe(1);
  });

  it('own identity again after disconnect: the agent bids on the user\'s offer', async () => {
    expect(m.deleteDelegation()).toBe(true);
    expect(m.activeIdentity().principal).toBe(agentPrincipal.toText());
    const { done } = await write('sneedex_bid', { offer_id: Number(m.offerId), amount: '1.5' });
    expect(done).toMatch(/bid \d+ placed/);
    const view = (await actorAs(pic, sneedexIdl, dexId, admin).getOfferView(m.offerId))[0];
    expect(view.highest_bid[0].bidder.toText()).toBe(agentPrincipal.toText());
    expect(view.highest_bid[0].amount).toBe(150_000_000n);
  });

  it('every executed write is in the audit log, with its signer', () => {
    const lines = readFileSync(join(process.env.SNEED_MCP_CONFIG_DIR, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((l) => l.tool)).toEqual(['name_set', 'forum_create_thread', 'forum_post', 'forum_edit_post', 'sms_send', 'sneed_lock_create_token_lock', 'sneedex_create_offer', 'sneedex_bid']);
    expect(lines.every((l) => l.outcome.ok)).toBe(true);
    expect(lines.find((l) => l.tool === 'sneedex_create_offer')).toMatchObject({ principal: userPrincipal.toText(), mode: 'delegation' });
    expect(lines.find((l) => l.tool === 'sneedex_bid')).toMatchObject({ principal: agentPrincipal.toText(), mode: 'own' });
  });
});
