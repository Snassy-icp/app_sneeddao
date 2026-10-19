// The naming service (spec/sneed_names.md): public names in sneed_pid_names and
// sneed_neuron_names, private nicknames in sneed_pid_nicknames and sneed_neuron_nicknames,
// avatar images in sneed_avatars, the dapp registry in sneed_profiles.
//
// It replaces the naming methods of app_sneeddao_backend. BackendUtils sends its naming calls
// here when `namingServiceEnabled` (the canisters have ids on the network this build is for)
// and answers them in the backend's shapes, so the pages need not change. Until the canisters
// are deployed to a network, builds for it keep using the backend.
import { Principal } from '@dfinity/principal';
import { createActor as createPidNames, canisterId as pidNamesEnv } from 'declarations/sneed_pid_names';
import { createActor as createNeuronNames, canisterId as neuronNamesEnv } from 'declarations/sneed_neuron_names';
import { createActor as createPidNicknames, canisterId as pidNicknamesEnv } from 'declarations/sneed_pid_nicknames';
import { createActor as createNeuronNicknames, canisterId as neuronNicknamesEnv } from 'declarations/sneed_neuron_nicknames';
import { createActor as createAvatars, canisterId as avatarsEnv } from 'declarations/sneed_avatars';
import { createActor as createProfiles, canisterId as profilesEnv } from 'declarations/sneed_profiles';
import { nftAvatarRef, nftAvatarKey, resolveNftAvatars, forgetNftAvatars } from './nftAvatars';

// A canister id, or null. dfx puts made-up ids (8-byte principals, not ending in -cai) into the
// build for canisters that have none on its network, so having a value is not enough: only a
// real canister id (10 bytes, the last 0x01) turns the service on.
const realCanisterId = (text) => {
    try { const b = Principal.fromText(text).toUint8Array(); return b.length === 10 && b[9] === 1 ? text : null; } catch { return null; }
};
const pidNamesId = realCanisterId(pidNamesEnv);
const neuronNamesId = realCanisterId(neuronNamesEnv);
const pidNicknamesId = realCanisterId(pidNicknamesEnv);
const neuronNicknamesId = realCanisterId(neuronNicknamesEnv);
const avatarsId = realCanisterId(avatarsEnv);
const profilesId = realCanisterId(profilesEnv);

export const namingServiceEnabled = Boolean(pidNamesId && neuronNamesId && pidNicknamesId && neuronNicknamesId && avatarsId);
export const dappRegistryEnabled = Boolean(profilesId);
/// The naming canisters' ids on this build's network (null where there is none).
export const namingCanisterIds = { pidNames: pidNamesId, neuronNames: neuronNamesId, pidNicknames: pidNicknamesId, neuronNicknames: neuronNicknamesId, avatars: avatarsId, profiles: profilesId };

const isLocal = !(process.env.DFX_NETWORK === 'ic' || process.env.DFX_NETWORK === 'staging');
const host = isLocal ? 'http://localhost:4943' : 'https://icp0.io';
const opts = (identity) => ({ agentOptions: { host, identity: identity || undefined } });

// Tests run this module against PocketIC and hand in their own actors (test/canisters/tests/naming-frontend.test.js).
let testActors = null;
export const setActorsForTest = (factories) => { testActors = factories; };

export const pidNamesActor = (identity) => testActors?.pidNames?.(identity) ?? createPidNames(pidNamesId, opts(identity));
export const neuronNamesActor = (identity) => testActors?.neuronNames?.(identity) ?? createNeuronNames(neuronNamesId, opts(identity));
export const pidNicknamesActor = (identity) => testActors?.pidNicknames?.(identity) ?? createPidNicknames(pidNicknamesId, opts(identity));
export const neuronNicknamesActor = (identity) => testActors?.neuronNicknames?.(identity) ?? createNeuronNicknames(neuronNicknamesId, opts(identity));
export const avatarsActor = (identity) => testActors?.avatars?.(identity) ?? createAvatars(avatarsId, opts(identity));
export const profilesActor = (identity) => testActors?.profiles?.(identity) ?? createProfiles(profilesId, opts(identity));

const PAGE = 500n;
const toPrincipal = (p) => (typeof p === 'string' ? Principal.fromText(p) : p);
export const hexToBytes = (hex) => new Uint8Array((hex.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16)));
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const neuronKey = (root, neuronId) => ({
    sns_root: toPrincipal(root),
    neuron_id: typeof neuronId === 'string' ? hexToBytes(neuronId) : (neuronId?.id ?? neuronId),
});
const opt = (x) => (x && x.length ? x[0] : null);

/// The URL of an avatar reference: a link as it is, an image in sneed_avatars on its raw domain
/// (the certified domain needs response certification, which the avatar store does not do yet).
export const avatarUrl = (ref) => {
    const r = opt(ref) ?? ref;
    if (!r) return null;
    if ('url' in r) return r.url;
    if ('blob' in r && avatarsId) {
        const hex = bytesToHex(r.blob);
        return isLocal ? `http://${avatarsId}.raw.localhost:4943/${hex}` : `https://${avatarsId}.raw.icp0.io/${hex}`;
    }
    return null;
};

// ---- mirrors (small-service mode, spec §9): the whole name list kept current with changes_since ----

const MIRROR_KEY = 'sneed_names_mirror_v1';
const NEURON_MIRROR_KEY = 'sneed_neuron_names_mirror_v1';

const load = (key) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
};
const save = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))); } catch { /* storage full or blocked */ }
};

/// The principal names mirror: { seq, accounts: { id: { name, verified, avatar, members: [[principal, dapp]] } },
/// canisters: { principal: { name, verified, avatar, runBy } } }, brought up to date with changes_since.
export async function syncPrincipalNames(identity) {
    const m = load(MIRROR_KEY) || { seq: '0', accounts: {}, canisters: {} };
    const actor = pidNamesActor(identity);
    let after = BigInt(m.seq);
    for (;;) {
        const page = await actor.changes_since({ after, limit: PAGE });
        if (page.items.length === 0) break;
        for (const c of page.items) {
            const state = opt(c.state);
            if ('account' in c.ref) {
                const id = c.ref.account.toString();
                if (!state) delete m.accounts[id];
                else {
                    const a = state.account;
                    m.accounts[id] = {
                        name: opt(a.name), verified: a.verified, avatar: avatarUrl(a.avatar),
                        members: a.members.map((x) => [x.principal.toText(), opt(x.dapp)?.toString() ?? null]),
                    };
                }
            } else {
                const p = c.ref.canister.toText();
                if (!state) delete m.canisters[p];
                else {
                    const cv = state.canister;
                    m.canisters[p] = { name: cv.name, verified: cv.verified, avatar: avatarUrl(cv.avatar), runBy: opt(cv.run_by) ? { account: opt(cv.run_by).account.toString(), name: opt(opt(cv.run_by).name) } : null };
                }
            }
        }
        after = page.items[page.items.length - 1].seq;
    }
    m.seq = after.toString();
    save(MIRROR_KEY, m);
    return m;
}

/// [[principalText, name, verified, avatarUrl]] for every named principal in the mirror.
export function principalEntries(m) {
    const out = [];
    for (const a of Object.values(m.accounts)) {
        for (const [p] of a.members) out.push([p, a.name, a.verified && !!a.name, a.avatar]);
    }
    for (const [p, c] of Object.entries(m.canisters)) out.push([p, c.name, c.verified, c.avatar]);
    return out;
}

/// The neuron names mirror: { seq, neurons: { 'root:hex': { name, verified, avatar } } }.
export async function syncNeuronNames(identity) {
    const m = load(NEURON_MIRROR_KEY) || { seq: '0', neurons: {} };
    const actor = neuronNamesActor(identity);
    let after = BigInt(m.seq);
    for (;;) {
        const page = await actor.changes_since({ after, limit: PAGE });
        if (page.items.length === 0) break;
        for (const c of page.items) {
            const key = `${c.key.sns_root.toText()}:${bytesToHex(c.key.neuron_id)}`;
            const v = opt(c.state);
            if (!v) delete m.neurons[key];
            else m.neurons[key] = { name: v.name, verified: v.verified, avatar: avatarUrl(v.avatar) };
        }
        after = page.items[page.items.length - 1].seq;
    }
    m.seq = after.toString();
    save(NEURON_MIRROR_KEY, m);
    return m;
}

// ---- the backend's naming API, answered from the naming service ----

export async function getAllPrincipalNames(identity) {
    const m = await syncPrincipalNames(identity);
    return principalEntries(m).filter(([, name]) => name).map(([p, name, verified]) => [Principal.fromText(p), [name, verified]]);
}

export async function getAllNeuronNames(identity) {
    const m = await syncNeuronNames(identity);
    return Object.entries(m.neurons).map(([key, v]) => {
        const [root, hex] = key.split(':');
        return [{ sns_root_canister_id: Principal.fromText(root), neuron_id: { id: hexToBytes(hex) } }, [v.name, v.verified]];
    });
}

async function pages(fetch) {
    const out = [];
    let start = [];
    for (;;) {
        const r = await fetch({ start_after: start, limit: PAGE });
        out.push(...r.items);
        if (!r.next.length) return out;
        start = r.next;
    }
}

export async function getAllPrincipalNicknames(identity) {
    if (!identity) return null;
    const actor = pidNicknamesActor(identity);
    return (await pages((p) => actor.get_my_nicknames(p))).map((n) => [n.target, n.nickname]);
}

export async function getAllNeuronNicknames(identity) {
    if (!identity) return null;
    const actor = neuronNicknamesActor(identity);
    return (await pages((p) => actor.get_my_nicknames(p))).map((n) => [{ sns_root_canister_id: n.target.sns_root, neuron_id: { id: n.target.neuron_id } }, n.nickname]);
}

export async function getPrincipalName(identity, principal) {
    const info = opt(await pidNamesActor(identity).get_name(toPrincipal(principal)));
    return info && opt(info.name) ? [[opt(info.name), info.verified]] : [];
}

export async function getNeuronName(identity, root, neuronId) {
    const [info] = await neuronNamesActor(identity).get_names([neuronKey(root, neuronId)]);
    const i = opt(info);
    return i ? [[i.name, i.verified]] : [];
}

export async function getPrincipalNickname(identity, principal) {
    const [n] = await pidNicknamesActor(identity).get_my_nicknames_for([toPrincipal(principal)]);
    return opt(n) ? [opt(n).nickname] : [];
}

export async function getNeuronNickname(identity, root, neuronId) {
    const [n] = await neuronNicknamesActor(identity).get_my_nicknames_for([neuronKey(root, neuronId)]);
    return opt(n) ? [opt(n).nickname] : [];
}

/// Avatars of up to 500 principals: Map<principalText, url>. An NFT avatar wins while its owner
/// still holds the NFT; otherwise the account's other avatar shows.
export async function getAvatars(identity, principals) {
    const list = principals.slice(0, 500).map(toPrincipal);
    const infos = await pidNamesActor(identity).get_names(list);
    const nfts = list.map((_, i) => nftAvatarRef(opt(infos[i])?.nft_avatar ?? []));
    const resolved = nfts.some(Boolean) ? await resolveNftAvatars(nfts.filter(Boolean)) : new Map();
    const out = new Map();
    list.forEach((p, i) => {
        const url = (nfts[i] && resolved.get(nftAvatarKey(nfts[i]))) || avatarUrl(opt(infos[i])?.avatar);
        if (url) out.set(p.toText(), url);
    });
    return out;
}

/// Show an ICRC-7 NFT you own as your avatar (collection id text and token id), or stop (null).
export async function setMyNftAvatar(identity, collection, tokenId) {
    try {
        const nft = collection == null ? [] : [{ collection: toPrincipal(collection), token_id: BigInt(tokenId) }];
        const r = await pidNamesActor(identity).set_my_nft_avatar(nft);
        forgetNftAvatars();
        return r;
    } catch (e) {
        return { err: e.message || String(e) };
    }
}

/// Your account's NFT avatar as { collection, token_id, owner } texts, or null.
export async function getMyNftAvatar(identity) {
    const account = opt(await pidNamesActor(identity).get_account_of(identity.getPrincipal()));
    return account ? nftAvatarRef(account.nft_avatar) : null;
}

export const setPrincipalName = (identity, name) => pidNamesActor(identity).set_my_name(name);
export const setPrincipalNickname = (identity, principal, nickname) => pidNicknamesActor(identity).set_nickname(toPrincipal(principal), nickname);
export const setNeuronName = (identity, root, neuronId, name) => neuronNamesActor(identity).set_name(neuronKey(root, neuronId), name);
export const setNeuronNickname = (identity, root, neuronId, nickname) => neuronNicknamesActor(identity).set_nickname(neuronKey(root, neuronId), nickname);
export const setCanisterName = (identity, canisterId, name) => pidNamesActor(identity).set_canister_name(toPrincipal(canisterId), name);

/// Upload an image (bytes) to sneed_avatars; the caller then holds it. Answers its hash.
export async function uploadAvatarImage(identity, bytes) {
    const r = await avatarsActor(identity).upload(bytes);
    if ('err' in r) throw new Error(r.err);
    return r.ok;
}

const DATA_URL = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.*)$/s;

/// The backend took avatars as an https link or a data: URL; data URLs become images in sneed_avatars.
async function avatarRefFor(identity, url) {
    if (!url) return [];
    const m = DATA_URL.exec(url);
    if (m) {
        const bin = atob(m[2]);
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        return [{ blob: await uploadAvatarImage(identity, bytes) }];
    }
    return [{ url }];
}

export async function setMyAvatar(identity, url) {
    try {
        return await pidNamesActor(identity).set_my_avatar(await avatarRefFor(identity, url));
    } catch (e) {
        return { err: e.message || String(e) };
    }
}

export const adminClearAvatar = (identity, principal) => pidNamesActor(identity).admin_clear_avatar(toPrincipal(principal));

/// Name any principal the caller may name: itself, a canister it controls, an account it owns or
/// holds a hotkey on, or (admins) anyone. The backend's "hotkey of an SNS neuron" route is gone:
/// a principal gives a hotkey on its account instead (spec §4.2).
export async function setPrincipalNameFor(identity, principal, name) {
    const p = toPrincipal(principal);
    const actor = pidNamesActor(identity);
    const me = identity?.getPrincipal?.();
    if (me && p.toText() === me.toText()) return actor.set_my_name(name);
    // admins (controllers included, which the frontend cannot see) may name anyone; for everyone
    // else the canister refuses the call at ingress
    const asAdmin = async (otherwise) => {
        try { return await actor.admin_set_name(p, name); } catch { return otherwise; }
    };
    if (p.toText().endsWith('-cai')) {
        const r = await actor.set_canister_name(p, name);
        return 'err' in r ? asAdmin(r) : r;
    }
    const account = opt(await actor.get_account_of(p));
    if (account && me) {
        const manages = account.members.some((m) => m.principal.toText() === me.toText() && 'owner' in m.role)
            || account.hotkeys.some((h) => h.toText() === me.toText());
        if (manages) return actor.set_account_name(account.id, name);
    }
    return asAdmin({ err: 'You can name this principal once it gives you a hotkey on its account (Me → Account on the dapp it uses)' });
}

export async function verifyPrincipalName(identity, principal) {
    const actor = pidNamesActor(identity);
    const info = opt(await actor.get_name(toPrincipal(principal)));
    if (!info || !opt(info.name)) return { err: 'That principal has no name' };
    return actor.verify(toPrincipal(principal), opt(info.name));
}

export const unverifyPrincipalName = (identity, principal) => pidNamesActor(identity).unverify(toPrincipal(principal));

export async function verifyNeuronName(identity, root, neuronId) {
    const actor = neuronNamesActor(identity);
    const key = neuronKey(root, neuronId);
    const [info] = await actor.get_names([key]);
    if (!opt(info)) return { err: 'That neuron has no name' };
    return actor.verify(key, opt(info).name);
}

export const unverifyNeuronName = (identity, root, neuronId) => neuronNamesActor(identity).unverify(neuronKey(root, neuronId));

// ---- accounts (spec §4.1, §4.2) ----

export const getMyAccount = async (identity) => opt(await pidNamesActor(identity).get_account_of(identity.getPrincipal()));
export const getAccount = async (identity, id) => opt(await pidNamesActor(identity).get_account(BigInt(id)));
export const myHotkeyAccounts = (identity) => pidNamesActor(identity).my_hotkey_accounts();
export const addHotkey = (identity, hotkey) => pidNamesActor(identity).add_hotkey(toPrincipal(hotkey));
export const removeHotkey = (identity, account, hotkey) => pidNamesActor(identity).remove_hotkey(BigInt(account), toPrincipal(hotkey));
export const setAccountName = (identity, account, name) => pidNamesActor(identity).set_account_name(BigInt(account), name);
export const mergeAccount = (identity, from) => pidNamesActor(identity).merge_account(BigInt(from));
export const removeMember = (identity, principal) => pidNamesActor(identity).remove_member(toPrincipal(principal));
export const setMember = (identity, principal, role, dapp) =>
    pidNamesActor(identity).set_member(toPrincipal(principal), role === 'owner' ? { owner: null } : { member: null }, dapp == null ? [] : [BigInt(dapp)]);
export const searchNames = (identity, prefix, limit = 10) => pidNamesActor(identity).search({ prefix, limit: BigInt(limit), kind: [] });

export async function listDapps(identity) {
    if (!dappRegistryEnabled) return [];
    const actor = profilesActor(identity);
    return pages((p) => actor.list_dapps(p));
}
