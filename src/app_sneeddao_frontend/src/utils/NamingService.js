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
    const nfts = list.map((_, i) => nftAvatarRef(opt(infos[i])?.nft_avatar ?? [], opt(infos[i])?.nft_avatar_standard ?? []));
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

/// Show an EXT NFT (e.g. a Sneed Diamond Club card) you hold as your avatar: collection id text
/// and token index. Your default account must hold it. null stops showing any NFT avatar.
export async function setMyExtNftAvatar(identity, collection, index) {
    try {
        const nft = collection == null ? [] : [{ collection: toPrincipal(collection), token_id: BigInt(index) }];
        const r = await pidNamesActor(identity).set_my_ext_nft_avatar(nft);
        forgetNftAvatars();
        return r;
    } catch (e) {
        return { err: e.message || String(e) };
    }
}

/// Your account's NFT avatar as { collection, token_id, owner, standard } texts, or null.
export async function getMyNftAvatar(identity) {
    const account = opt(await pidNamesActor(identity).get_account_of(identity.getPrincipal()));
    return account ? nftAvatarRef(account.nft_avatar, account.nft_avatar_standard ?? []) : null;
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
/// A page (by account id) of the accounts the caller holds a hotkey on: { items, next, total }.
/// Falls back to my_hotkey_accounts on a canister that has no paged method yet.
export async function myHotkeyAccountsPage(identity, startAfter = null, limit = 50) {
    const actor = pidNamesActor(identity);
    try {
        const r = await actor.my_hotkey_accounts_page({ start_after: startAfter == null ? [] : [BigInt(startAfter)], limit: BigInt(limit) });
        return { items: r.items, next: opt(r.next), total: Number(r.total) };
    } catch (e) {
        if (startAfter != null) throw e;
        const items = await actor.my_hotkey_accounts();
        return { items, next: null, total: items.length };
    }
}
export const addHotkey = (identity, hotkey) => pidNamesActor(identity).add_hotkey(toPrincipal(hotkey));
/// Remove yourself as a hotkey from every account that gave you one (500 a call; repeats until done).
export async function leaveHotkeyAccounts(identity) {
    const actor = pidNamesActor(identity);
    let r;
    for (let i = 0; i < 100; i++) {
        r = await actor.leave_hotkey_accounts();
        if ('err' in r || !/call again/.test(r.ok)) break;
    }
    return r;
}
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

// ---- account nicknames and pockets (sneed_pid_nicknames, spec/programmable_accounts.md §4.6) ----
//
// The caller's private names for ICRC-1 accounts, and the pocket registry of the wallet, in one row
// per account. Unpublished, not secret. Plain form used by the app (and utils/pockets/registry.js):
//   { account: { owner: Principal, subaccount: Uint8Array | null }, nickname: string,
//     pocket: { host: string | null, ledgers: string[], hidden: boolean, createdAt: bigint } | null,
//     updatedAt: bigint }
// `subaccount` is canonical: null for the default account (32 zero bytes are the same account).
// A localStorage mirror per principal lets names and pockets show before the call returns.

const ACCOUNT_MIRROR_KEY = 'sneed_account_nicknames_v1:';
const ACCOUNT_FOR_MAX = 100;
const POCKETS_BATCH_MAX = 50;

const subOrNull = (s) => {
    const b = s == null ? null : Array.isArray(s) ? (s.length ? s[0] : null) : s;
    if (!b) return null;
    const u = b instanceof Uint8Array ? b : Uint8Array.from(b);
    return u.every((x) => x === 0) ? null : u;
};
/// Candid Account from { owner, subaccount }.
export const toCandidAccount = (a) => { const s = subOrNull(a.subaccount); return { owner: toPrincipal(a.owner), subaccount: s ? [s] : [] }; };
/// Candid PocketMeta from the plain form (null = forget).
export const toCandidPocket = (m) => (m ? [{
    host: m.host ? [m.host] : [],
    ledgers: (m.ledgers || []).map(toPrincipal),
    hidden: Boolean(m.hidden),
    created_at: BigInt(m.createdAt ?? 0),
}] : []);
const fromCandidEntry = (e) => {
    const p = opt(e.pocket);
    return {
        account: { owner: e.account.owner, subaccount: subOrNull(e.account.subaccount) },
        nickname: e.nickname,
        pocket: p ? { host: opt(p.host), ledgers: p.ledgers.map((l) => l.toText()), hidden: p.hidden, createdAt: p.created_at } : null,
        updatedAt: e.updated_at,
    };
};
/// "<owner>:<hex>" ("<owner>:0" for the default account): the mirror's key of an account.
export const accountMirrorKey = (a) => { const s = subOrNull(a.subaccount); return `${toPrincipal(a.owner).toText()}:${s ? bytesToHex(s) : '0'}`; };

const serializeEntry = (e) => ({ k: accountMirrorKey(e.account), n: e.nickname, p: e.pocket ? { h: e.pocket.host, l: e.pocket.ledgers, x: e.pocket.hidden, c: String(e.pocket.createdAt ?? 0) } : null, u: String(e.updatedAt ?? 0) });
const deserializeEntry = (s) => {
    const [owner, hex] = s.k.split(':');
    return {
        account: { owner: Principal.fromText(owner), subaccount: hex === '0' ? null : hexToBytes(hex) },
        nickname: s.n || '',
        pocket: s.p ? { host: s.p.h ?? null, ledgers: s.p.l || [], hidden: Boolean(s.p.x), createdAt: BigInt(s.p.c || 0) } : null,
        updatedAt: BigInt(s.u || 0),
    };
};
const mirrorKeyFor = (identity) => ACCOUNT_MIRROR_KEY + identity.getPrincipal().toText();

/// The mirrored entries of the signed-in user ([] when none or storage is unavailable).
export function loadAccountNicknamesMirror(identity) {
    if (!identity) return [];
    const m = load(mirrorKeyFor(identity));
    if (!m || !Array.isArray(m.entries)) return [];
    try { return m.entries.map(deserializeEntry); } catch { return []; }
}
export function saveAccountNicknamesMirror(identity, entries) {
    save(mirrorKeyFor(identity), { entries: entries.map(serializeEntry) });
}
/// Change the mirror in place: `fn(map)` gets a Map<accountMirrorKey, entry> to edit.
function editMirror(identity, fn) {
    const map = new Map(loadAccountNicknamesMirror(identity).map((e) => [accountMirrorKey(e.account), e]));
    fn(map);
    const entries = [...map.values()].filter((e) => e.nickname || e.pocket);
    saveAccountNicknamesMirror(identity, entries);
    return entries;
}

/// Every account name and pocket of the caller (all pages); refreshes the mirror.
export async function getMyAccountNicknames(identity) {
    if (!identity) return [];
    const actor = pidNicknamesActor(identity);
    const entries = (await pages((p) => actor.get_my_account_nicknames(p))).map(fromCandidEntry);
    saveAccountNicknamesMirror(identity, entries);
    return entries;
}

/// The caller's entries for these accounts, in order (null where none); 100 per call.
export async function getMyAccountNicknamesFor(identity, accounts) {
    const actor = pidNicknamesActor(identity);
    const out = [];
    for (let i = 0; i < accounts.length; i += ACCOUNT_FOR_MAX) {
        const r = await actor.get_my_account_nicknames_for(accounts.slice(i, i + ACCOUNT_FOR_MAX).map(toCandidAccount));
        out.push(...r.map((x) => (opt(x) ? fromCandidEntry(opt(x)) : null)));
    }
    return out;
}

const okOrThrow = (r) => { if ('err' in r) throw new Error(r.err); return r.ok; };

/// Name an account ("" clears the name and keeps the pocket). The mirror changes first and is put
/// back when the canister refuses.
export async function setAccountNickname(identity, account, nickname) {
    const key = accountMirrorKey(account);
    const before = loadAccountNicknamesMirror(identity);
    editMirror(identity, (m) => {
        const e = m.get(key) || { account: { owner: toPrincipal(account.owner), subaccount: subOrNull(account.subaccount) }, nickname: '', pocket: null, updatedAt: 0n };
        m.set(key, { ...e, nickname });
    });
    try {
        return okOrThrow(await pidNicknamesActor(identity).set_account_nickname(toCandidAccount(account), nickname));
    } catch (e) {
        saveAccountNicknamesMirror(identity, before);
        throw e;
    }
}

/// Remember, update or (meta null) forget pockets: items = [{ account, pocket }]. Batched by 50.
/// Returns one { ok } | { err } per item; the mirror keeps only what the canister accepted.
export async function setPockets(identity, items) {
    const before = loadAccountNicknamesMirror(identity);
    editMirror(identity, (m) => {
        for (const { account, pocket } of items) {
            const key = accountMirrorKey(account);
            const e = m.get(key) || { account: { owner: toPrincipal(account.owner), subaccount: subOrNull(account.subaccount) }, nickname: '', pocket: null, updatedAt: 0n };
            m.set(key, { ...e, pocket: pocket ? { host: pocket.host ?? null, ledgers: (pocket.ledgers || []).map((l) => toPrincipal(l).toText()), hidden: Boolean(pocket.hidden), createdAt: BigInt(pocket.createdAt ?? 0) } : null });
        }
    });
    const actor = pidNicknamesActor(identity);
    const results = [];
    try {
        for (let i = 0; i < items.length; i += POCKETS_BATCH_MAX) {
            const chunk = items.slice(i, i + POCKETS_BATCH_MAX);
            results.push(...(await actor.set_pockets(chunk.map(({ account, pocket }) => [toCandidAccount(account), toCandidPocket(pocket)]))));
        }
    } catch (e) {
        saveAccountNicknamesMirror(identity, before);
        throw e;
    }
    // undo the refused items in the mirror
    const refused = items.filter((_, i) => 'err' in results[i]);
    if (refused.length) {
        const old = new Map(before.map((e) => [accountMirrorKey(e.account), e]));
        editMirror(identity, (m) => { for (const { account } of refused) { const k = accountMirrorKey(account); if (old.has(k)) m.set(k, old.get(k)); else m.delete(k); } });
    }
    return results;
}

/// One pocket: remember / update (meta) or forget (null). Throws when refused.
export async function setPocket(identity, account, pocket) {
    const [r] = await setPockets(identity, [{ account, pocket }]);
    return okOrThrow(r);
}

/// { count, max_free, max_premium } of the caller's account names and pockets.
export const myAccountNicknameCount = (identity) => pidNicknamesActor(identity).my_account_nickname_count();
