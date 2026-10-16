#!/usr/bin/env python3
"""Move names from app_sneeddao_backend to the naming service (spec/sneed_names.md §10).

Runs `dfx canister call` as the current dfx identity, which must be an admin of the backend
(for the nickname and avatar exports) and of the new canisters (for the imports).

    python3 scripts/migrate_names.py --network staging            # dry run: read, plan, report
    python3 scripts/migrate_names.py --network staging --apply    # import (backend must be frozen)
    python3 scripts/migrate_names.py --network staging --verify   # compare backend and new canisters

Decisions for names the plan cannot import as they are go in --decisions FILE (JSON):
    { "rename": { "<principal>": "<new name>" }, "drop": ["<principal>", ...] }

Order (the import methods refuse duplicates, so a rerun only adds what is missing):
  1. backend: admin_set_names_frozen(true)          (this script checks it with --apply)
  2. this script with --apply, then --verify
  3. each new canister: admin_finish_import()       (by hand, after checking the report)
"""
import argparse
import base64
import json
import re
import subprocess
import sys
import tempfile

BATCH = 200
NAME_RE = re.compile(r"[A-Za-z0-9 \-_.']+")
DATA_URL = re.compile(r"^data:image/(png|jpeg|jpg|webp|gif);base64,(.*)$", re.S)


IDENTITY = []


def canister_ids(network):
    ids = json.load(open(".dfx/local/canister_ids.json" if network == "local" else "canister_ids.json"))
    out = {}
    for name in ["app_sneeddao_backend", "sneed_pid_names", "sneed_neuron_names", "sneed_pid_nicknames", "sneed_neuron_nicknames", "sneed_avatars"]:
        cid = ids.get(name, {}).get(network)
        if not cid:
            sys.exit(f"canister_ids.json has no {network} id for {name}")
        out[name] = cid
    return out


def call(network, canister, method, arg="()", query=False):
    cmd = ["dfx", *IDENTITY, "canister", "--network", network, "call", "--output", "json"]
    if query:
        cmd.append("--query")
    with tempfile.NamedTemporaryFile("w", suffix=".did", delete=False) as f:
        f.write(arg)
        path = f.name
    cmd += [canister, method, "--argument-file", path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{method}: {r.stderr.strip()[:500]}")
    return json.loads(r.stdout)


# ---- Candid text ----

def text(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def principal(p):
    return f'principal "{p}"'


def blob(bs):
    return 'blob "' + "".join(f"\\{b:02x}" for b in bs) + '"'


def cbool(v):
    return "true" if v else "false"


def opt(x):
    return f"opt {x}" if x is not None else "null"


def avatar_ref(a):
    if a is None:
        return "null"
    kind, v = a
    return f'opt variant {{ "url" = {text(v)} }}' if kind == "url" else f'opt variant {{ "blob" = {blob(v)} }}'


# ---- name rules (src/sneed_names/NameRules.mo) ----

def clean(name):
    return re.sub(" +", " ", name.strip())


def problem(name, min_len):
    if len(name) < min_len:
        return f"shorter than {min_len}"
    if len(name) > 32:
        return "longer than 32"
    if not NAME_RE.fullmatch(name):
        return "characters"
    if name != name.strip() or "  " in name:
        return "spaces"
    if not re.search("[A-Za-z0-9]", name):
        return "no letter or digit"
    return None


def is_canister(p):
    return p.endswith("-cai")  # opaque ids; II and key principals are self-authenticating


# ---- read ----

def read_backend(network, be):
    pnames = call(network, be, "get_all_principal_names", query=True)
    nnames = call(network, be, "get_all_neuron_names", query=True)

    def pages(method):
        out, start = [], 0
        while True:
            r = call(network, be, method, f"({start} : nat, 1000 : nat)", query=True)
            out += r["items"]
            start += len(r["items"])
            if start >= int(r["total"]) or not r["items"]:
                return out

    pnicks = pages("admin_export_principal_nicknames")
    nnicks = pages("admin_export_neuron_nicknames")
    avatars = []
    start = 0
    while True:
        r = call(network, be, "admin_export_avatars", f"({start} : nat, 50 : nat)", query=True)
        avatars += r["items"]
        start += len(r["items"])
        if start >= int(r["total"]) or not r["items"]:
            break
    return {
        "principal_names": [(x["0"], x["1"]["0"], x["1"]["1"]) for x in pnames],
        "neuron_names": [(x["0"]["sns_root_canister_id"], bytes(x["0"]["neuron_id"]["id"]), x["1"]["0"], x["1"]["1"]) for x in nnames],
        "principal_nicknames": [(x["0"], x["1"], x["2"]) for x in pnicks],
        "neuron_nicknames": [(x["0"], x["1"]["sns_root_canister_id"], bytes(x["1"]["neuron_id"]["id"]), x["2"]) for x in nnicks],
        "avatars": [(x["0"], x["1"]) for x in avatars],
    }


# ---- plan ----

def plan(data, decisions):
    report = {"cleaned": [], "dropped": [], "collisions": [], "needs_decision": [], "avatar_problems": []}
    rename = decisions.get("rename", {})
    drop = set(decisions.get("drop", []))
    avatar_of = {}
    for p, url in data["avatars"]:
        m = DATA_URL.match(url)
        if m:
            try:
                avatar_of[p] = ("data", base64.b64decode(m.group(2), validate=True))
            except Exception as e:  # noqa: BLE001
                report["avatar_problems"].append((p, f"bad base64: {e}"))
        elif url.startswith("https://") and len(url) <= 512:
            avatar_of[p] = ("url", url)
        else:
            report["avatar_problems"].append((p, url[:80]))

    names = []
    taken = {}
    # verified names first, so a collision never costs a checkmark
    for p, name, verified in sorted(data["principal_names"], key=lambda x: (not x[2], x[0])):
        if p in drop:
            report["dropped"].append((p, name))
            continue
        new = rename.get(p, clean(name))
        if new != name and p not in rename:
            report["cleaned"].append((p, name, new))
        why = problem(new, 2 if is_canister(p) else 1)
        if why:
            report["needs_decision"].append((p, name, why))
            continue
        key = new.lower()
        if key in taken:
            report["collisions"].append((p, name, taken[key]))
            continue
        taken[key] = p
        names.append((p, new, bool(verified)))
    named = {p for p, _, _ in names}
    for p in avatar_of:
        if p not in named and not is_canister(p):
            names.append((p, "", False))

    neuron_names = []
    taken_n = {}
    for root, nid, name, verified in data["neuron_names"]:
        new = clean(name)
        if new != name:
            report["cleaned"].append((f"{root}/{nid.hex()}", name, new))
        why = problem(new, 1)
        if why:
            report["needs_decision"].append((f"{root}/{nid.hex()}", name, why))
            continue
        key = (root, new.lower())
        if key in taken_n:
            report["collisions"].append((f"{root}/{nid.hex()}", name, taken_n[key]))
            continue
        taken_n[key] = nid.hex()
        neuron_names.append((root, nid, new, bool(verified)))

    def nick_ok(n):
        return problem(clean(n), 1) is None

    pn = [(o, t, clean(n)) for o, t, n in data["principal_nicknames"] if nick_ok(n)]
    nn = [(o, r, i, clean(n)) for o, r, i, n in data["neuron_nicknames"] if nick_ok(n)]
    report["nicknames_skipped"] = len(data["principal_nicknames"]) - len(pn) + len(data["neuron_nicknames"]) - len(nn)
    return {"names": names, "avatars": avatar_of, "neuron_names": neuron_names, "principal_nicknames": pn, "neuron_nicknames": nn}, report


# ---- apply ----

def chunks(xs, n=BATCH):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def results(r):
    return [list(x["result"].keys())[0] + ": " + list(x["result"].values())[0] if isinstance(x, dict) and "result" in x else str(x) for x in r]


def apply(network, ids, p):
    # avatars: inline images go to sneed_avatars, held by their owner
    refs = {}
    for owner, (kind, v) in p["avatars"].items():
        if kind == "url":
            refs[owner] = ("url", v)
        else:
            r = call(network, ids["sneed_avatars"], "admin_upload_for", f"({principal(owner)}, {blob(v)})")
            if "ok" in r:
                refs[owner] = ("blob", bytes(r["ok"]))
            else:
                print(f"  avatar of {owner}: {r['err']}")
    out = {}
    for batch in chunks(p["names"]):
        items = "; ".join(f'record {{ "principal" = {principal(pr)}; "name" = {text(n)}; "verified" = {cbool(v)}; "avatar" = {avatar_ref(refs.get(pr))} }}' for pr, n, v in batch)
        r = call(network, ids["sneed_pid_names"], "admin_import_names", f"(vec {{ {items} }})")
        for (pr, n, _), x in zip(batch, r):
            out[f"name {pr}"] = x["result"]
    for batch in chunks(p["neuron_names"]):
        items = "; ".join(f'record {{ "sns_root" = {principal(root)}; "neuron_id" = {blob(nid)}; "name" = {text(n)}; "verified" = {cbool(v)} }}' for root, nid, n, v in batch)
        r = call(network, ids["sneed_neuron_names"], "admin_import_names", f"(vec {{ {items} }})")
        for (root, nid, n, _), x in zip(batch, r):
            out[f"neuron {root}/{nid.hex()}"] = x["result"]
    for batch in chunks(p["principal_nicknames"]):
        items = "; ".join(f'record {{ "owner" = {principal(o)}; "target" = {principal(t)}; "nickname" = {text(n)} }}' for o, t, n in batch)
        r = call(network, ids["sneed_pid_nicknames"], "admin_import_nicknames", f"(vec {{ {items} }})")
        for (o, t, n), x in zip(batch, r):
            out[f"nick {o}>{t}"] = x
    for batch in chunks(p["neuron_nicknames"]):
        items = "; ".join(f'record {{ "owner" = {principal(o)}; "target" = record {{ "sns_root" = {principal(root)}; "neuron_id" = {blob(nid)} }}; "nickname" = {text(n)} }}' for o, root, nid, n in batch)
        r = call(network, ids["sneed_neuron_nicknames"], "admin_import_nicknames", f"(vec {{ {items} }})")
        for (o, root, nid, n), x in zip(batch, r):
            out[f"neuron nick {o}>{root}/{nid.hex()}"] = x
    failed = {k: v for k, v in out.items() if "err" in v and v["err"] != "already imported"}
    print(f"imported: {sum(1 for v in out.values() if 'ok' in v)}, already there: {sum(1 for v in out.values() if v.get('err') == 'already imported')}, failed: {len(failed)}")
    for k, v in failed.items():
        print(f"  FAILED {k}: {v['err']}")
    return not failed


# ---- verify ----

def verify(network, ids, p):
    ok = True
    for batch in chunks(p["names"], 500):
        got = call(network, ids["sneed_pid_names"], "get_names", "(vec { " + "; ".join(principal(x[0]) for x in batch) + " })", query=True)
        for (pr, n, v), g in zip(batch, got):
            g = g[0] if g else None
            have = (g["name"][0] if g and g["name"] else "") if g else None
            if have != n or (n and bool(g["verified"]) != v):
                ok = False
                print(f"  MISMATCH {pr}: want {n!r} verified={v}, have {g}")
    for batch in chunks(p["neuron_names"], 500):
        keys = "; ".join(f'record {{ "sns_root" = {principal(r)}; "neuron_id" = {blob(i)} }}' for r, i, _, _ in batch)
        got = call(network, ids["sneed_neuron_names"], "get_names", f"(vec {{ {keys} }})", query=True)
        for (r, i, n, v), g in zip(batch, got):
            g = g[0] if g else None
            if not g or g["name"] != n or bool(g["verified"]) != v:
                ok = False
                print(f"  MISMATCH neuron {r}/{i.hex()}: want {n!r} verified={v}, have {g}")
    s1 = call(network, ids["sneed_pid_nicknames"], "stats", query=True)
    s2 = call(network, ids["sneed_neuron_nicknames"], "stats", query=True)
    for label, want, have in [("principal nicknames", len(p["principal_nicknames"]), int(s1["nicknames"])), ("neuron nicknames", len(p["neuron_nicknames"]), int(s2["nicknames"]))]:
        print(f"  {label}: planned {want}, in canister {have}")
        if have < want:
            ok = False
    print("VERIFIED" if ok else "VERIFY FAILED")
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--network", required=True, choices=["local", "staging", "ic"])
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--decisions")
    ap.add_argument("--identity", help="dfx identity to use (default: the current one)")
    args = ap.parse_args()
    if args.identity:
        IDENTITY[:] = ["--identity", args.identity]
    ids = canister_ids(args.network)
    decisions = json.load(open(args.decisions)) if args.decisions else {}
    data = read_backend(args.network, ids["app_sneeddao_backend"])
    p, report = plan(data, decisions)
    print(f"backend: {len(data['principal_names'])} principal names, {len(data['neuron_names'])} neuron names, "
          f"{len(data['principal_nicknames'])} principal nicknames, {len(data['neuron_nicknames'])} neuron nicknames, {len(data['avatars'])} avatars")
    print(f"plan: {len(p['names'])} accounts/canisters, {len(p['neuron_names'])} neuron names, "
          f"{len(p['principal_nicknames'])} + {len(p['neuron_nicknames'])} nicknames, {len(p['avatars'])} avatars")
    for k in ["cleaned", "dropped", "collisions", "needs_decision", "avatar_problems"]:
        for x in report[k]:
            print(f"  {k}: {x}")
    if report["nicknames_skipped"]:
        print(f"  nicknames skipped (break the rules): {report['nicknames_skipped']}")
    if args.apply:
        if report["needs_decision"] or report["collisions"]:
            sys.exit("Resolve the collisions and the names needing a decision in --decisions first")
        if not call(args.network, ids["app_sneeddao_backend"], "get_names_frozen", query=True):
            sys.exit("Freeze the backend's naming writes first: admin_set_names_frozen(true)")
        if not apply(args.network, ids, p):
            sys.exit(1)
    if args.verify or args.apply:
        sys.exit(0 if verify(args.network, ids, p) else 1)


if __name__ == "__main__":
    main()
