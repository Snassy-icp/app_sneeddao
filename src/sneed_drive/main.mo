import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Char "mo:base/Char";
import Cycles "mo:base/ExperimentalCycles";
import Debug "mo:base/Debug";
import Int "mo:base/Int";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Option "mo:base/Option";
import OrderedMap "mo:base/OrderedMap";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Timer "mo:base/Timer";
import Map "mo:map/Map";
import Sha256 "mo:sha2/Sha256";

import IngressGuard "../IngressGuard";
import Icrc3Log "../icrc3/Log";
import T3 "../icrc3/Types";
import TextLog "../sneed_names/TextLog";
import ApiDoc "ApiDoc";
import T "Types";

/// sneed_drive, phase 0 (spec/sneed_drive_phase0.md, an addendum to spec/sneed_drive.md): the
/// index canister of a Sneed Drive, notes first. A folder tree of small files kept inline (at most
/// 64 KiB a version), a version on every save, a trash, tags on any node, server-side search over
/// names, tags and the text of text files, and per-node grants (read / write / manage) inherited
/// down the tree. The owner (`owner`, or the controllers while it is unset) has every right,
/// including purging. Every write is a block in an ICRC-3 log that only the owner reads.
/// Shards, chunked files and encryption are phase 1; their fields are reserved in the records.
shared (deployer) persistent actor class SneedDrive(init : ?T.InitArgs) = this {

  public type NodeId = T.NodeId;
  public type VersionId = T.VersionId;
  public type Kind = T.Kind;
  public type Role = T.Role;
  public type Access = T.Access;
  public type DriveError = T.DriveError;
  public type ContentIn = T.ContentIn;
  public type NodeInfo = T.NodeInfo;
  public type VersionInfo = T.VersionInfo;
  public type ContentOut = T.ContentOut;
  public type PathEntry = T.PathEntry;
  public type Grant = T.Grant;
  public type Grants = T.Grants;
  public type SharedEntry = T.SharedEntry;
  public type ChildrenPage = T.ChildrenPage;
  public type NodePage = T.NodePage;
  public type VersionPage = T.VersionPage;
  public type SharedPage = T.SharedPage;
  public type SearchArgs = T.SearchArgs;
  public type SearchHit = T.SearchHit;
  public type SearchPage = T.SearchPage;
  public type TagCount = T.TagCount;
  public type TagPage = T.TagPage;
  public type PurgeResult = T.PurgeResult;
  public type Settings = T.Settings;
  public type SettingsUpdate = T.SettingsUpdate;
  public type Retention = T.Retention;
  public type DriveInfo = T.DriveInfo;
  public type InitArgs = T.InitArgs;
  public type Limits = T.Limits;
  public type Result<X> = T.Result<X>;

  // ---------------------------------------------------------------------------------------------
  // Limits (spec/sneed_drive_phase0.md §5). Transient: a changed value takes effect on upgrade.
  // ---------------------------------------------------------------------------------------------

  transient let VERSION_TEXT = "0.1.0";
  transient let ROOT : NodeId = 0;
  transient let MAX_INLINE_BYTES : Nat = 65_536;
  transient let HARD_MAX_NODES : Nat = 200_000;
  transient let HARD_MAX_VERSIONS : Nat = 1_000;
  transient let HARD_MAX_TOTAL_BYTES : Nat = 3 * 1024 * 1024 * 1024;
  transient let MAX_CHILDREN : Nat = 5_000;
  transient let MAX_DEPTH : Nat = 32;
  transient let MAX_NAME_CHARS : Nat = 255;
  transient let MAX_TAGS : Nat = 20;
  transient let MAX_TAG_CHARS : Nat = 40;
  transient let MAX_DISTINCT_TAGS : Nat = 2_000;
  transient let MAX_MIME_CHARS : Nat = 100;
  transient let MAX_GRANTS_PER_NODE : Nat = 50;
  transient let MAX_GRANTS_PER_PRINCIPAL : Nat = 500;
  transient let MAX_GRANTS_TOTAL : Nat = 10_000;
  transient let DEFAULT_PAGE : Nat = 100;
  transient let MAX_PAGE : Nat = 200;
  transient let MAX_SEARCH_HITS : Nat = 100;
  transient let SCAN_NODES : Nat = 5_000;
  transient let SCAN_BYTES : Nat = 4 * 1024 * 1024;
  transient let PURGE_BATCH : Nat = 1_000;
  transient let RETENTION_PERIOD_S : Nat = 6 * 3_600;
  transient let DAY_NS : Int = 86_400_000_000_000;

  transient let natOps = OrderedMap.Make<Nat>(Nat.compare);
  transient let textOps = OrderedMap.Make<Text>(Text.compare);

  // ---------------------------------------------------------------------------------------------
  // State (enhanced orthogonal persistence)
  // ---------------------------------------------------------------------------------------------

  func clampSettings(s : Settings) : Settings {
    {
      max_nodes = Nat.max(1, Nat.min(s.max_nodes, HARD_MAX_NODES));
      max_versions_per_node = Nat.max(1, Nat.min(s.max_versions_per_node, HARD_MAX_VERSIONS));
      max_total_bytes = Nat.min(s.max_total_bytes, HARD_MAX_TOTAL_BYTES);
      retention = s.retention;
    };
  };

  func applyUpdate(s : Settings, u : SettingsUpdate) : Settings {
    clampSettings({
      max_nodes = Option.get(u.max_nodes, s.max_nodes);
      max_versions_per_node = Option.get(u.max_versions_per_node, s.max_versions_per_node);
      max_total_bytes = Option.get(u.max_total_bytes, s.max_total_bytes);
      retention = Option.get(u.retention, s.retention);
    });
  };

  transient let DEFAULT_SETTINGS : Settings = {
    max_nodes = 50_000;
    max_versions_per_node = 200;
    max_total_bytes = 1024 * 1024 * 1024;
    retention = { keep_versions = 0; trash_days = 0 };
  };

  var owner : ?Principal = switch (init) { case (?i) i.owner; case null null };
  var settings : Settings = switch (init) {
    case (?{ settings = ?u }) applyUpdate(DEFAULT_SETTINGS, u);
    case _ DEFAULT_SETTINGS;
  };

  let nodes = Map.new<NodeId, T.Node>();
  let versions = Map.new<VersionId, T.Version>();
  let grants = Map.new<NodeId, [Grant]>(); // direct grants per node
  let by_grantee = Map.new<Principal, [NodeId]>(); // nodes where a principal has a direct grant
  let tag_counts = Map.new<Text, Nat>();
  var trash_roots : OrderedMap.Map<NodeId, Int> = natOps.empty<Int>(); // trash roots -> trashed at
  var next_node : NodeId = 0;
  var next_version : VersionId = 0;
  var seq : Nat = 0;
  var total_bytes : Nat = 0;
  var grants_total : Nat = 0;
  let textlog : TextLog.State = TextLog.init();

  func newNode(kind : Kind, parent : ?NodeId, name : Text, tags : [Text], caller : Principal) : T.Node {
    let now = Time.now();
    seq += 1;
    let n : T.Node = {
      id = next_node;
      kind;
      var parent = parent;
      var name = name;
      var name_key = Text.toLowercase(name);
      var tags = tags;
      var head = null;
      var versions = [];
      var children = textOps.empty<NodeId>();
      var trashed_children = [];
      var trashed = null;
      created_at = now;
      created_by = caller;
      var modified_at = now;
      var modified_by = caller;
      var seq = seq;
      var scope = 0;
      var key_epoch = 0;
      var encrypted = false;
      var meta = "";
    };
    next_node += 1;
    Map.set(nodes, Map.nhash, n.id, n);
    n;
  };

  // the root folder, created at install
  if (Map.size(nodes) == 0) {
    ignore newNode(#folder, null, "", [], deployer.caller);
  };

  // ---------------------------------------------------------------------------------------------
  // ICRC-3 write log (src/icrc3). Blocks hold node ids, principals and sizes, never names, tags
  // or content. Readable by the owner only.
  // ---------------------------------------------------------------------------------------------

  var icrc3 : Icrc3Log.State = Icrc3Log.init();
  transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();
  if (icrc3.log_length == 0 and icrc3.settings.max_live_blocks == Icrc3Log.defaultSettings().max_live_blocks) {
    icrc3.settings := { icrc3.settings with max_live_blocks = 10_000 };
  };

  transient let BLOCK_TYPES : [Text] = [
    "sneeddrive_create", "sneeddrive_save", "sneeddrive_rename", "sneeddrive_move", "sneeddrive_tags",
    "sneeddrive_trash", "sneeddrive_restore", "sneeddrive_purge", "sneeddrive_version_restore",
    "sneeddrive_versions_purge", "sneeddrive_grant", "sneeddrive_revoke", "sneeddrive_owner",
    "sneeddrive_settings",
  ];
  transient let icrc3_catalogue : Icrc3Log.Config = {
    block_types_url = "https://app.sneeddao.com/api/sneed_drive#block-types";
    block_types = BLOCK_TYPES;
  };

  func self() : Principal = Principal.fromActor(this);

  func icrc3_env() : Icrc3Log.Environment {
    {
      self = self();
      archive_controllers = switch (owner) { case (?o) [o]; case null [] };
      cycle_reserve = 1_000_000_000_000;
      new_correlation_id = func() : Nat = TextLog.correlationId(textlog);
      log_info = func(cid : Nat, m : Text) = TextLog.add(textlog, #info, cid, self(), m);
      log_error = func(cid : Nat, m : Text) = TextLog.add(textlog, #error, cid, self(), m);
    };
  };

  func ev(btype : Text, caller : Principal, tx : [(Text, T3.Value)]) {
    ignore Icrc3Log.append(icrc3, "sneeddrive_" # btype, Int.abs(Time.now()), Array.append<(Text, T3.Value)>([("caller", Icrc3Log.principal(caller))], tx));
  };

  // ---------------------------------------------------------------------------------------------
  // Access
  // ---------------------------------------------------------------------------------------------

  func isOwner(p : Principal) : Bool {
    switch (owner) {
      case (?o) o == p;
      case null Principal.isController(p);
    };
  };

  func rank(r : Role) : Nat = switch r { case (#read) 1; case (#write) 2; case (#manage) 3 };

  func accessOf(r : Nat, isOwner_ : Bool) : ?Access {
    if (isOwner_) return ?#owner;
    switch r { case 1 ?#read; case 2 ?#write; case 3 ?#manage; case _ null };
  };

  func atLeast(a : ?Access, r : Role) : Bool {
    switch a {
      case null false;
      case (?#owner) true;
      case (?#manage) true;
      case (?#write) r != #manage;
      case (?#read) r == #read;
    };
  };

  type Look = { node : T.Node; access : ?Access; in_trash : Bool; depth : Nat; under : Bool };

  /// One walk up from `id`: the caller's access (highest grant on the node or an ancestor),
  /// whether the node is in the trash, its depth, and whether `under` is a proper ancestor.
  func look(caller : Principal, id : NodeId, under : ?NodeId) : ?Look {
    let n = switch (Map.get(nodes, Map.nhash, id)) { case (?n) n; case null return null };
    let owner_ = isOwner(caller);
    let withGrants = not owner_ and Map.has(by_grantee, Map.phash, caller);
    var best = 0;
    var inTrash = false;
    var depth = 0;
    var isUnder = false;
    var cur : ?T.Node = ?n;
    label walk while (depth <= 2 * MAX_DEPTH) {
      switch cur {
        case null break walk;
        case (?c) {
          if (Option.isSome(c.trashed)) inTrash := true;
          switch under { case (?u) if (u == c.id and c.id != id) isUnder := true; case null {} };
          if (withGrants) {
            switch (Map.get(grants, Map.nhash, c.id)) {
              case (?gs) for (g in gs.vals()) if (g.principal == caller) best := Nat.max(best, rank(g.role));
              case null {};
            };
          };
          cur := switch (c.parent) { case (?p) { depth += 1; Map.get(nodes, Map.nhash, p) }; case null null };
        };
      };
    };
    ?{ node = n; access = accessOf(best, owner_); in_trash = inTrash; depth; under = isUnder };
  };

  /// The node, if the caller has `role` on it (else not_found / forbidden).
  func need(caller : Principal, id : NodeId, role : Role) : { #ok : Look; #err : DriveError } {
    switch (look(caller, id, null)) {
      case null #err(#not_found);
      case (?l) if (atLeast(l.access, role)) #ok(l) else #err(#forbidden);
    };
  };

  /// A write: signed in, `role` on the node, and the node not in the trash.
  func needWrite(caller : Principal, id : NodeId, role : Role) : { #ok : Look; #err : DriveError } {
    if (Principal.isAnonymous(caller)) return #err(#not_signed_in);
    switch (need(caller, id, role)) {
      case (#err(e)) #err(e);
      case (#ok(l)) if (l.in_trash) #err(#in_trash) else #ok(l);
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------------------------

  func nameProblem(name : Text) : ?Text {
    let n = name.size();
    if (n == 0) return ?"A name can't be empty";
    if (n > MAX_NAME_CHARS) return ?("A name has at most " # Nat.toText(MAX_NAME_CHARS) # " characters");
    if (name == "." or name == "..") return ?"\".\" and \"..\" are not names";
    if (Text.startsWith(name, #char ' ') or Text.endsWith(name, #char ' ')) return ?"A name can't start or end with a space";
    for (c in name.chars()) {
      if (c == '/') return ?"A name can't contain \"/\"";
      let u = Char.toNat32(c);
      if (u < 0x20 or u == 0x7f) return ?"A name can't contain control characters";
    };
    null;
  };

  /// Tags trimmed and lowercased, duplicates dropped.
  func normTags(tags : [Text]) : { #ok : [Text]; #err : DriveError } {
    if (tags.size() > MAX_TAGS) return #err(#limit("At most " # Nat.toText(MAX_TAGS) # " tags a node"));
    let out = Buffer.Buffer<Text>(tags.size());
    for (t in tags.vals()) {
      let x = Text.toLowercase(Text.trim(t, #char ' '));
      if (x.size() == 0 or x.size() > MAX_TAG_CHARS) return #err(#invalid("A tag has 1 to " # Nat.toText(MAX_TAG_CHARS) # " characters"));
      for (c in x.chars()) {
        let u = Char.toNat32(c);
        if (u < 0x20 or u == 0x7f or c == ',') return #err(#invalid("A tag can't contain commas or control characters"));
      };
      if (not Buffer.contains<Text>(out, x, Text.equal)) out.add(x);
    };
    #ok(Buffer.toArray(out));
  };

  func tagsFit(old : [Text], neu : [Text]) : Bool {
    var added = 0;
    for (t in neu.vals()) {
      if (Option.isNull(Map.get(tag_counts, Map.thash, t)) and Option.isNull(Array.find<Text>(old, func(o) = o == t))) added += 1;
    };
    Map.size(tag_counts) + added <= MAX_DISTINCT_TAGS;
  };

  func countTags(tags : [Text], up : Bool) {
    for (t in tags.vals()) {
      let c = Option.get(Map.get(tag_counts, Map.thash, t), 0);
      if (up) Map.set(tag_counts, Map.thash, t, c + 1) else if (c <= 1) Map.delete(tag_counts, Map.thash, t) else Map.set(tag_counts, Map.thash, t, c - 1);
    };
  };

  func extOf(name : Text) : Text {
    let parts = Iter.toArray(Text.split(Text.toLowercase(name), #char '.'));
    if (parts.size() < 2) "" else parts[parts.size() - 1];
  };

  func defaultMime(name : Text, isText : Bool) : Text {
    switch (extOf(name)) {
      case ("md" or "markdown") "text/markdown";
      case ("txt") "text/plain";
      case ("json") "application/json";
      case ("csv") "text/csv";
      case ("html" or "htm") "text/html";
      case ("did") "text/plain";
      case _ if (isText) "text/plain" else "application/octet-stream";
    };
  };

  func bytesOf(c : ContentIn) : (Blob, Bool) {
    switch c { case (#text(t)) (Text.encodeUtf8(t), true); case (#bytes(b)) (b, false) };
  };

  // ---------------------------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------------------------

  func headOf(n : T.Node) : ?T.Version {
    switch (n.head) { case (?h) Map.get(versions, Map.nhash, h); case null null };
  };

  func info(l : Look) : NodeInfo {
    let n = l.node;
    let h = headOf(n);
    {
      id = n.id;
      kind = n.kind;
      parent = n.parent;
      name = n.name;
      tags = n.tags;
      head = n.head;
      versions = n.versions.size();
      size = switch h { case (?v) v.size; case null 0 };
      mime = switch h { case (?v) v.mime; case null "" };
      children = textOps.size(n.children);
      created_at = n.created_at;
      created_by = n.created_by;
      modified_at = n.modified_at;
      modified_by = n.modified_by;
      trashed = n.trashed;
      in_trash = l.in_trash;
      encrypted = n.encrypted;
      scope = n.scope;
      seq = n.seq;
      my_access = Option.get(l.access, #read);
    };
  };

  func infoAs(caller : Principal, id : NodeId) : ?NodeInfo {
    switch (look(caller, id, null)) { case (?l) ?info(l); case null null };
  };

  func clampLimit(limit : Nat, max : Nat) : Nat = if (limit == 0) Nat.min(DEFAULT_PAGE, max) else Nat.min(limit, max);

  func touch(n : T.Node, caller : Principal) {
    seq += 1;
    n.seq := seq;
    n.modified_at := Time.now();
    n.modified_by := caller;
  };

  // ---------------------------------------------------------------------------------------------
  // Tree helpers
  // ---------------------------------------------------------------------------------------------

  func childNamed(folder : T.Node, key : Text) : ?NodeId = textOps.get(folder.children, key);

  func attach(folder : T.Node, n : T.Node) {
    folder.children := textOps.put(folder.children, n.name_key, n.id);
  };

  func detach(folder : T.Node, n : T.Node) {
    folder.children := textOps.delete(folder.children, n.name_key);
  };

  /// Height of the subtree under `n` (0 for a leaf), live and trashed children alike.
  func height(n : T.Node) : Nat {
    var h = 0;
    for (cid in Iter.concat(textOps.vals(n.children), n.trashed_children.vals())) {
      switch (Map.get(nodes, Map.nhash, cid)) { case (?c) h := Nat.max(h, 1 + height(c)); case null {} };
    };
    h;
  };

  /// `name` with " (restored)", " (restored 2)", … before the extension, until it is free in `folder`.
  func freeName(folder : T.Node, name : Text, suffix : Text) : Text {
    let ext = extOf(name);
    let base = if (ext == "" or name.size() <= ext.size() + 1) name else {
      let chars = Iter.toArray(name.chars());
      Text.fromIter(Array.slice<Char>(chars, 0, chars.size() - ext.size() - 1));
    };
    let dot = if (ext == "" or base == name) "" else "." # ext;
    var i = 1;
    loop {
      let cand = base # " (" # suffix # (if (i == 1) "" else " " # Nat.toText(i)) # ")" # dot;
      if (Option.isNull(childNamed(folder, Text.toLowercase(cand))) and cand.size() <= MAX_NAME_CHARS) return cand;
      i += 1;
      if (i > 1_000) return base # " (" # suffix # " " # Nat.toText(Int.abs(Time.now())) # ")" # dot;
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Versions
  // ---------------------------------------------------------------------------------------------

  func deleteVersion(vid : VersionId) {
    switch (Map.remove(versions, Map.nhash, vid)) {
      case (?v) { total_bytes -= Nat.min(total_bytes, v.size) };
      case null {};
    };
  };

  /// Appends a version with these bytes, unless they and the mime equal the head's (then null).
  func addVersion(n : T.Node, bytes : Blob, mime : Text, caller : Principal) : { #ok : ?VersionId; #err : DriveError } {
    if (bytes.size() > MAX_INLINE_BYTES) return #err(#limit("A file holds at most " # Nat.toText(MAX_INLINE_BYTES) # " bytes in phase 0"));
    let sha = Sha256.fromBlob(#sha256, bytes);
    switch (headOf(n)) {
      case (?h) if (h.sha256 == sha and h.mime == mime) return #ok(null);
      case null {};
    };
    let keep = settings.retention.keep_versions;
    let cap = if (keep > 0) Nat.min(keep, settings.max_versions_per_node) else settings.max_versions_per_node;
    if (keep == 0 and n.versions.size() >= cap) return #err(#limit("This file has " # Nat.toText(n.versions.size()) # " versions, the most allowed; the owner can purge old versions"));
    if (total_bytes + bytes.size() > settings.max_total_bytes) return #err(#limit("The drive is full (" # Nat.toText(settings.max_total_bytes) # " bytes of versions)"));
    let v : T.Version = {
      id = next_version;
      node = n.id;
      size = bytes.size();
      mime;
      sha256 = sha;
      content = #inline(bytes);
      wrapped_key = null;
      format_version = 0;
      created_at = Time.now();
      created_by = caller;
    };
    next_version += 1;
    Map.set(versions, Map.nhash, v.id, v);
    total_bytes += v.size;
    var vs = Array.append(n.versions, [v.id]);
    // retention chosen by the owner: keep the newest `keep`
    if (keep > 0 and vs.size() > cap) {
      let drop : Nat = vs.size() - cap;
      for (i in Iter.range(0, drop - 1)) deleteVersion(vs[i]);
      vs := Array.tabulate<VersionId>(cap, func(i) = vs[i + drop]);
    };
    n.versions := vs;
    n.head := ?v.id;
    #ok(?v.id);
  };

  // ---------------------------------------------------------------------------------------------
  // Purging (owner only; budgeted)
  // ---------------------------------------------------------------------------------------------

  func removeGrants(id : NodeId) {
    switch (Map.remove(grants, Map.nhash, id)) {
      case (?gs) {
        for (g in gs.vals()) {
          grants_total -= Nat.min(grants_total, 1);
          let rest = Array.filter<NodeId>(Option.get(Map.get(by_grantee, Map.phash, g.principal), []), func(x) = x != id);
          if (rest.size() == 0) Map.delete(by_grantee, Map.phash, g.principal) else Map.set(by_grantee, Map.phash, g.principal, rest);
        };
      };
      case null {};
    };
  };

  /// Deletes one node that has no children left: versions, grants, tags, its place in the parent.
  func deleteLeaf(n : T.Node) {
    for (vid in n.versions.vals()) deleteVersion(vid);
    removeGrants(n.id);
    countTags(n.tags, false);
    switch (n.parent) {
      case (?pid) switch (Map.get(nodes, Map.nhash, pid)) {
        case (?p) {
          if (textOps.get(p.children, n.name_key) == ?n.id) detach(p, n);
          p.trashed_children := Array.filter<NodeId>(p.trashed_children, func(x) = x != n.id);
        };
        case null {};
      };
      case null {};
    };
    trash_roots := natOps.delete(trash_roots, n.id);
    Map.delete(nodes, Map.nhash, n.id);
  };

  func firstChild(n : T.Node) : ?T.Node {
    for (cid in textOps.vals(n.children)) switch (Map.get(nodes, Map.nhash, cid)) { case (?c) return ?c; case null {} };
    for (cid in n.trashed_children.vals()) switch (Map.get(nodes, Map.nhash, cid)) { case (?c) return ?c; case null {} };
    null;
  };

  /// Purges up to `budget` nodes of the subtree at `root`, deepest first. done = root is gone.
  func purgeSubtree(root : T.Node, budget : Nat) : (Nat, Bool) {
    var purged = 0;
    while (purged < budget) {
      var cur = root;
      label down loop {
        switch (firstChild(cur)) { case (?c) cur := c; case null break down };
      };
      deleteLeaf(cur);
      purged += 1;
      if (cur.id == root.id) return (purged, true);
    };
    (purged, false);
  };

  func purgeTrash(olderThan : ?Int, budget : Nat, caller : Principal) : PurgeResult {
    var purged = 0;
    var finished = true;
    label roots for ((id, at) in natOps.entries(trash_roots)) {
      switch olderThan { case (?t) if (at > t) continue roots; case null {} };
      if (purged >= budget) { finished := false; break roots };
      switch (Map.get(nodes, Map.nhash, id)) {
        case (?n) {
          let (p, d) = purgeSubtree(n, budget - purged);
          purged += p;
          if (d) ev("purge", caller, [("node", #Nat(id)), ("nodes", #Nat(p))]) else { finished := false; break roots };
        };
        case null { trash_roots := natOps.delete(trash_roots, id) };
      };
    };
    { purged; done = finished };
  };

  // ---------------------------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------------------------

  /// The parent for a new child: a live folder the caller can write, with room.
  func newChildCheck(caller : Principal, parent : NodeId, name : Text) : { #ok : T.Node; #err : DriveError } {
    let l = switch (needWrite(caller, parent, #write)) { case (#ok(l)) l; case (#err(e)) return #err(e) };
    if (l.node.kind != #folder) return #err(#invalid("The parent is not a folder"));
    switch (nameProblem(name)) { case (?p) return #err(#invalid(p)); case null {} };
    switch (childNamed(l.node, Text.toLowercase(name))) { case (?other) return #err(#name_taken(other)); case null {} };
    if (textOps.size(l.node.children) >= MAX_CHILDREN) return #err(#limit("A folder holds at most " # Nat.toText(MAX_CHILDREN) # " items"));
    if (l.depth + 1 > MAX_DEPTH) return #err(#limit("Folders nest at most " # Nat.toText(MAX_DEPTH) # " deep"));
    if (Map.size(nodes) >= settings.max_nodes) return #err(#limit("The drive holds at most " # Nat.toText(settings.max_nodes) # " items"));
    #ok(l.node);
  };

  func done(caller : Principal, id : NodeId) : Result<NodeInfo> {
    switch (infoAs(caller, id)) { case (?i) #ok(i); case null #err(#not_found) };
  };

  public shared ({ caller }) func create_folder(a : { parent : NodeId; name : Text; tags : [Text] }) : async Result<NodeInfo> {
    let parent = switch (newChildCheck(caller, a.parent, a.name)) { case (#ok(p)) p; case (#err(e)) return #err(e) };
    let tags = switch (normTags(a.tags)) { case (#ok(t)) t; case (#err(e)) return #err(e) };
    if (not tagsFit([], tags)) return #err(#limit("The drive has the most distinct tags allowed"));
    let n = newNode(#folder, ?parent.id, a.name, tags, caller);
    attach(parent, n);
    countTags(tags, true);
    touch(parent, caller);
    ev("create", caller, [("node", #Nat(n.id)), ("parent", #Nat(parent.id)), ("kind", #Text("folder"))]);
    done(caller, n.id);
  };

  public shared ({ caller }) func create_file(a : { parent : NodeId; name : Text; content : ContentIn; mime : ?Text; tags : [Text] }) : async Result<NodeInfo> {
    let parent = switch (newChildCheck(caller, a.parent, a.name)) { case (#ok(p)) p; case (#err(e)) return #err(e) };
    let tags = switch (normTags(a.tags)) { case (#ok(t)) t; case (#err(e)) return #err(e) };
    if (not tagsFit([], tags)) return #err(#limit("The drive has the most distinct tags allowed"));
    let (bytes, isText) = bytesOf(a.content);
    let mime = Option.get(a.mime, defaultMime(a.name, isText));
    if (mime.size() > MAX_MIME_CHARS) return #err(#invalid("mime is at most 100 characters"));
    if (bytes.size() > MAX_INLINE_BYTES) return #err(#limit("A file holds at most " # Nat.toText(MAX_INLINE_BYTES) # " bytes in phase 0"));
    if (total_bytes + bytes.size() > settings.max_total_bytes) return #err(#limit("The drive is full"));
    let n = newNode(#file, ?parent.id, a.name, tags, caller);
    switch (addVersion(n, bytes, mime, caller)) {
      case (#err(e)) { Map.delete(nodes, Map.nhash, n.id); return #err(e) };
      case (#ok(_)) {};
    };
    attach(parent, n);
    countTags(tags, true);
    touch(parent, caller);
    ev("create", caller, [("node", #Nat(n.id)), ("parent", #Nat(parent.id)), ("kind", #Text("file")), ("version", #Nat(Option.get(n.head, 0))), ("size", #Nat(bytes.size()))]);
    done(caller, n.id);
  };

  public shared ({ caller }) func save_file(a : { node : NodeId; content : ContentIn; mime : ?Text; expected_head : ?VersionId }) : async Result<NodeInfo> {
    let l = switch (needWrite(caller, a.node, #write)) { case (#ok(l)) l; case (#err(e)) return #err(e) };
    let n = l.node;
    if (n.kind != #file) return #err(#invalid("Not a file"));
    switch (a.expected_head) { case (?h) if (n.head != ?h) return #err(#conflict({ head = n.head })); case null {} };
    let (bytes, isText) = bytesOf(a.content);
    let mime = switch (a.mime) { case (?m) m; case null switch (headOf(n)) { case (?h) h.mime; case null defaultMime(n.name, isText) } };
    if (mime.size() > MAX_MIME_CHARS) return #err(#invalid("mime is at most 100 characters"));
    switch (addVersion(n, bytes, mime, caller)) {
      case (#err(e)) return #err(e);
      case (#ok(null)) {};
      case (#ok(?vid)) {
        touch(n, caller);
        ev("save", caller, [("node", #Nat(n.id)), ("version", #Nat(vid)), ("size", #Nat(bytes.size()))]);
      };
    };
    done(caller, n.id);
  };

  public shared ({ caller }) func rename(id : NodeId, name : Text) : async Result<NodeInfo> {
    if (id == ROOT) return #err(#invalid("The root has no name"));
    let l = switch (needWrite(caller, id, #write)) { case (#ok(l)) l; case (#err(e)) return #err(e) };
    let n = l.node;
    if (name == n.name) return done(caller, id);
    switch (nameProblem(name)) { case (?p) return #err(#invalid(p)); case null {} };
    let parent = switch (n.parent) { case (?p) switch (Map.get(nodes, Map.nhash, p)) { case (?x) x; case null return #err(#not_found) }; case null return #err(#not_found) };
    let key = Text.toLowercase(name);
    switch (childNamed(parent, key)) { case (?other) if (other != id) return #err(#name_taken(other)); case null {} };
    detach(parent, n);
    n.name := name;
    n.name_key := key;
    attach(parent, n);
    touch(n, caller);
    ev("rename", caller, [("node", #Nat(id))]);
    done(caller, id);
  };

  public shared ({ caller }) func move_node(id : NodeId, new_parent : NodeId) : async Result<NodeInfo> {
    if (id == ROOT) return #err(#invalid("The root can't move"));
    let l = switch (needWrite(caller, id, #write)) { case (#ok(l)) l; case (#err(e)) return #err(e) };
    let n = l.node;
    if (n.parent == ?new_parent) return done(caller, id);
    let dl = switch (needWrite(caller, new_parent, #write)) { case (#ok(d)) d; case (#err(e)) return #err(e) };
    let dest = dl.node;
    if (dest.kind != #folder) return #err(#invalid("The destination is not a folder"));
    if (new_parent == id) return #err(#invalid("A folder can't go into itself"));
    switch (look(caller, new_parent, ?id)) { case (?x) if (x.under) return #err(#invalid("A folder can't go into its own subfolder")); case null {} };
    switch (childNamed(dest, n.name_key)) { case (?other) return #err(#name_taken(other)); case null {} };
    if (textOps.size(dest.children) >= MAX_CHILDREN) return #err(#limit("The destination folder is full"));
    if (dl.depth + 1 + height(n) > MAX_DEPTH) return #err(#limit("Folders nest at most " # Nat.toText(MAX_DEPTH) # " deep"));
    let from = switch (n.parent) { case (?p) p; case null ROOT };
    switch (Map.get(nodes, Map.nhash, from)) { case (?p) { detach(p, n); touch(p, caller) }; case null {} };
    n.parent := ?new_parent;
    attach(dest, n);
    touch(dest, caller);
    touch(n, caller);
    ev("move", caller, [("node", #Nat(id)), ("from", #Nat(from)), ("to", #Nat(new_parent))]);
    done(caller, id);
  };

  public shared ({ caller }) func set_tags(id : NodeId, tags : [Text]) : async Result<NodeInfo> {
    let l = switch (needWrite(caller, id, #write)) { case (#ok(l)) l; case (#err(e)) return #err(e) };
    let t = switch (normTags(tags)) { case (#ok(t)) t; case (#err(e)) return #err(e) };
    let n = l.node;
    if (not tagsFit(n.tags, t)) return #err(#limit("The drive has the most distinct tags allowed (" # Nat.toText(MAX_DISTINCT_TAGS) # ")"));
    countTags(n.tags, false);
    countTags(t, true);
    n.tags := t;
    touch(n, caller);
    ev("tags", caller, [("node", #Nat(id)), ("count", #Nat(t.size()))]);
    done(caller, id);
  };

  public shared ({ caller }) func trash(id : NodeId) : async Result<NodeInfo> {
    if (id == ROOT) return #err(#invalid("The root can't go to the trash"));
    let l = switch (needWrite(caller, id, #write)) { case (#ok(l)) l; case (#err(e)) return #err(e) };
    let n = l.node;
    let now = Time.now();
    switch (n.parent) {
      case (?pid) switch (Map.get(nodes, Map.nhash, pid)) {
        case (?p) { detach(p, n); p.trashed_children := Array.append(p.trashed_children, [n.id]); touch(p, caller) };
        case null {};
      };
      case null {};
    };
    n.trashed := ?{ at = now; by = caller; root = true };
    trash_roots := natOps.put(trash_roots, n.id, now);
    touch(n, caller);
    ev("trash", caller, [("node", #Nat(id))]);
    done(caller, id);
  };

  public shared ({ caller }) func restore(id : NodeId) : async Result<NodeInfo> {
    if (Principal.isAnonymous(caller)) return #err(#not_signed_in);
    let l = switch (need(caller, id, #write)) { case (#ok(l)) l; case (#err(e)) return #err(e) };
    let n = l.node;
    switch (n.trashed) { case (?t) if (not t.root) return #err(#not_in_trash); case null return #err(#not_in_trash) };
    let oldParent = switch (n.parent) { case (?p) p; case null ROOT };
    // back to the original folder, or the root when that folder is in the trash itself
    let target = switch (look(caller, oldParent, null)) {
      case (?pl) if (pl.in_trash) ROOT else oldParent;
      case null ROOT;
    };
    let dest = switch (Map.get(nodes, Map.nhash, target)) { case (?d) d; case null return #err(#not_found) };
    if (target != oldParent and not atLeast(Option.chain<Look, Access>(look(caller, ROOT, null), func(x) = x.access), #write)) {
      return #err(#invalid("The original folder is in the trash: restore it first"));
    };
    if (textOps.size(dest.children) >= MAX_CHILDREN) return #err(#limit("The folder is full"));
    switch (Map.get(nodes, Map.nhash, oldParent)) {
      case (?p) p.trashed_children := Array.filter<NodeId>(p.trashed_children, func(x) = x != id);
      case null {};
    };
    switch (childNamed(dest, n.name_key)) {
      case (?_) { let nm = freeName(dest, n.name, "restored"); n.name := nm; n.name_key := Text.toLowercase(nm) };
      case null {};
    };
    n.parent := ?target;
    n.trashed := null;
    trash_roots := natOps.delete(trash_roots, id);
    attach(dest, n);
    touch(dest, caller);
    touch(n, caller);
    ev("restore", caller, [("node", #Nat(id)), ("parent", #Nat(target))]);
    done(caller, id);
  };

  public shared ({ caller }) func restore_version(id : NodeId, version : VersionId) : async Result<NodeInfo> {
    let l = switch (needWrite(caller, id, #write)) { case (#ok(l)) l; case (#err(e)) return #err(e) };
    let n = l.node;
    let v = switch (Map.get(versions, Map.nhash, version)) { case (?v) v; case null return #err(#not_found) };
    if (v.node != id) return #err(#not_found);
    let bytes = switch (v.content) { case (#inline(b)) b; case (#chunks(_)) return #err(#invalid("Chunked versions come in phase 1")) };
    if (n.head == ?version) return done(caller, id);
    // a copy as the new head (the head is always the newest version); a no-op when the head
    // already holds the same bytes
    let before = n.head;
    switch (headOf(n)) {
      case (?h) if (h.sha256 == v.sha256 and h.mime == v.mime) return done(caller, id);
      case null {};
    };
    switch (addVersion(n, bytes, v.mime, caller)) {
      case (#err(e)) return #err(e);
      case (#ok(_)) {};
    };
    touch(n, caller);
    ev("version_restore", caller, [("node", #Nat(id)), ("from_version", #Nat(version)), ("version", #Nat(Option.get(n.head, 0))), ("previous", #Nat(Option.get(before, 0)))]);
    done(caller, id);
  };

  public shared ({ caller }) func purge(id : NodeId) : async Result<PurgeResult> {
    if (not isOwner(caller)) return #err(#forbidden);
    let n = switch (Map.get(nodes, Map.nhash, id)) { case (?n) n; case null return #err(#not_found) };
    switch (n.trashed) { case (?t) if (not t.root) return #err(#not_in_trash); case null return #err(#not_in_trash) };
    let (p, d) = purgeSubtree(n, PURGE_BATCH);
    if (d) ev("purge", caller, [("node", #Nat(id)), ("nodes", #Nat(p))]);
    #ok({ purged = p; done = d });
  };

  public shared ({ caller }) func empty_trash() : async Result<PurgeResult> {
    if (not isOwner(caller)) return #err(#forbidden);
    #ok(purgeTrash(null, PURGE_BATCH, caller));
  };

  public shared ({ caller }) func purge_versions(id : NodeId, keep_latest : Nat) : async Result<PurgeResult> {
    if (not isOwner(caller)) return #err(#forbidden);
    let n = switch (Map.get(nodes, Map.nhash, id)) { case (?n) n; case null return #err(#not_found) };
    let keep = Nat.max(1, keep_latest);
    let vs = n.versions;
    if (vs.size() <= keep) return #ok({ purged = 0; done = true });
    let drop : Nat = vs.size() - keep;
    for (i in Iter.range(0, drop - 1)) deleteVersion(vs[i]);
    n.versions := Array.tabulate<VersionId>(keep, func(i) = vs[i + drop]);
    touch(n, caller);
    ev("versions_purge", caller, [("node", #Nat(id)), ("count", #Nat(drop))]);
    #ok({ purged = drop; done = true });
  };

  public shared ({ caller }) func grant(a : { node : NodeId; principal : Principal; role : Role }) : async Result<Grants> {
    let l = switch (needWrite(caller, a.node, #manage)) { case (#ok(l)) l; case (#err(e)) return #err(e) };
    if (Principal.isAnonymous(a.principal)) return #err(#invalid("The anonymous principal can't be given access"));
    if (isOwner(a.principal)) return #err(#invalid("The owner has every right already"));
    let gs = Option.get(Map.get(grants, Map.nhash, a.node), []);
    let existing = Array.find<Grant>(gs, func(g) = g.principal == a.principal);
    switch existing {
      case (?_) {
        Map.set(grants, Map.nhash, a.node, Array.map<Grant, Grant>(gs, func(g) = if (g.principal == a.principal) ({ principal = g.principal; role = a.role }) else g));
      };
      case null {
        if (gs.size() >= MAX_GRANTS_PER_NODE) return #err(#limit("At most " # Nat.toText(MAX_GRANTS_PER_NODE) # " grants on one item"));
        if (grants_total >= MAX_GRANTS_TOTAL) return #err(#limit("The drive has the most grants allowed"));
        let mine = Option.get(Map.get(by_grantee, Map.phash, a.principal), []);
        if (mine.size() >= MAX_GRANTS_PER_PRINCIPAL) return #err(#limit("That principal has the most grants allowed"));
        Map.set(grants, Map.nhash, a.node, Array.append(gs, [{ principal = a.principal; role = a.role }]));
        Map.set(by_grantee, Map.phash, a.principal, Array.append(mine, [a.node]));
        grants_total += 1;
      };
    };
    touch(l.node, caller);
    ev("grant", caller, [("node", #Nat(a.node)), ("principal", Icrc3Log.principal(a.principal)), ("role", #Text(roleText(a.role)))]);
    #ok(grantsOf(a.node));
  };

  public shared ({ caller }) func revoke(a : { node : NodeId; principal : Principal }) : async Result<Grants> {
    if (Principal.isAnonymous(caller)) return #err(#not_signed_in);
    // revoking works in the trash too
    let l = switch (need(caller, a.node, #manage)) { case (#ok(l)) l; case (#err(e)) return #err(e) };
    let gs = Option.get(Map.get(grants, Map.nhash, a.node), []);
    let rest = Array.filter<Grant>(gs, func(g) = g.principal != a.principal);
    if (rest.size() == gs.size()) return #err(#not_found);
    if (rest.size() == 0) Map.delete(grants, Map.nhash, a.node) else Map.set(grants, Map.nhash, a.node, rest);
    let mine = Array.filter<NodeId>(Option.get(Map.get(by_grantee, Map.phash, a.principal), []), func(x) = x != a.node);
    if (mine.size() == 0) Map.delete(by_grantee, Map.phash, a.principal) else Map.set(by_grantee, Map.phash, a.principal, mine);
    grants_total -= Nat.min(grants_total, 1);
    touch(l.node, caller);
    ev("revoke", caller, [("node", #Nat(a.node)), ("principal", Icrc3Log.principal(a.principal))]);
    #ok(grantsOf(a.node));
  };

  public shared ({ caller }) func set_settings(u : SettingsUpdate) : async Result<Settings> {
    if (not isOwner(caller)) return #err(#forbidden);
    settings := applyUpdate(settings, u);
    ev("settings", caller, [("max_nodes", #Nat(settings.max_nodes)), ("max_versions_per_node", #Nat(settings.max_versions_per_node)), ("max_total_bytes", #Nat(settings.max_total_bytes)), ("keep_versions", #Nat(settings.retention.keep_versions)), ("trash_days", #Nat(settings.retention.trash_days))]);
    #ok(settings);
  };

  /// The owner hands the drive on; a controller can always set it (it could reinstall anyway).
  public shared ({ caller }) func set_owner(p : Principal) : async Result<?Principal> {
    if (not isOwner(caller) and not Principal.isController(caller)) return #err(#forbidden);
    if (Principal.isAnonymous(p)) return #err(#invalid("The anonymous principal can't own a drive"));
    let old = owner;
    owner := ?p;
    // the new owner needs no grants; drop theirs so no stale entries remain
    switch (Map.get(by_grantee, Map.phash, p)) {
      case (?ids) for (id in ids.vals()) {
        let gs = Array.filter<Grant>(Option.get(Map.get(grants, Map.nhash, id), []), func(g) = g.principal != p);
        if (gs.size() == 0) Map.delete(grants, Map.nhash, id) else Map.set(grants, Map.nhash, id, gs);
        grants_total -= Nat.min(grants_total, 1);
      };
      case null {};
    };
    Map.delete(by_grantee, Map.phash, p);
    ev("owner", caller, Array.append<(Text, T3.Value)>([("owner", Icrc3Log.principal(p))], switch old { case (?o) [("previous", Icrc3Log.principal(o))]; case null [] }));
    #ok(owner);
  };

  // ---------------------------------------------------------------------------------------------
  // Reads (queries)
  // ---------------------------------------------------------------------------------------------

  func roleText(r : Role) : Text = switch r { case (#read) "read"; case (#write) "write"; case (#manage) "manage" };

  func grantsOf(id : NodeId) : Grants {
    let inherited = Buffer.Buffer<T.InheritedGrant>(4);
    var cur = switch (Map.get(nodes, Map.nhash, id)) { case (?n) n.parent; case null null };
    var guard = 0;
    label up while (guard <= 2 * MAX_DEPTH) {
      guard += 1;
      switch cur {
        case null break up;
        case (?p) {
          for (g in Option.get(Map.get(grants, Map.nhash, p), []).vals()) inherited.add({ node = p; principal = g.principal; role = g.role });
          cur := switch (Map.get(nodes, Map.nhash, p)) { case (?x) x.parent; case null null };
        };
      };
    };
    { node = id; direct = Option.get(Map.get(grants, Map.nhash, id), []); inherited = Buffer.toArray(inherited) };
  };

  public query ({ caller }) func get_node(id : NodeId) : async Result<NodeInfo> {
    switch (need(caller, id, #read)) { case (#ok(l)) #ok(info(l)); case (#err(e)) #err(e) };
  };

  /// "/Notes/plan.md" (case-insensitive) to its node. Answers not_found for nodes the caller
  /// can't read, so names are not probed.
  public query ({ caller }) func resolve_path(path : Text) : async Result<NodeInfo> {
    var cur = switch (Map.get(nodes, Map.nhash, ROOT)) { case (?r) r; case null return #err(#not_found) };
    var depth = 0;
    for (part in Text.split(path, #char '/')) {
      if (part != "") {
        depth += 1;
        if (depth > MAX_DEPTH) return #err(#not_found);
        let id = switch (childNamed(cur, Text.toLowercase(part))) { case (?id) id; case null return #err(#not_found) };
        cur := switch (Map.get(nodes, Map.nhash, id)) { case (?n) n; case null return #err(#not_found) };
      };
    };
    switch (need(caller, cur.id, #read)) { case (#ok(l)) #ok(info(l)); case (#err(_)) #err(#not_found) };
  };

  /// Breadcrumbs, top first, from the highest folder the caller can read down to the node.
  public query ({ caller }) func get_path(id : NodeId) : async Result<[PathEntry]> {
    let l = switch (need(caller, id, #read)) { case (#ok(l)) l; case (#err(e)) return #err(e) };
    let chain = Buffer.Buffer<T.Node>(8);
    var cur : ?T.Node = ?l.node;
    label up while (chain.size() <= 2 * MAX_DEPTH) {
      switch cur {
        case null break up;
        case (?c) { chain.add(c); cur := switch (c.parent) { case (?p) Map.get(nodes, Map.nhash, p); case null null } };
      };
    };
    Buffer.reverse(chain);
    let out = Buffer.Buffer<PathEntry>(chain.size());
    var readable = isOwner(caller);
    for (c in chain.vals()) {
      if (not readable) {
        for (g in Option.get(Map.get(grants, Map.nhash, c.id), []).vals()) if (g.principal == caller) readable := true;
      };
      if (readable) out.add({ id = c.id; name = c.name });
    };
    #ok(Buffer.toArray(out));
  };

  public query ({ caller }) func list_children(a : { folder : NodeId; after : ?Text; limit : Nat }) : async Result<ChildrenPage> {
    let l = switch (need(caller, a.folder, #read)) { case (#ok(l)) l; case (#err(e)) return #err(e) };
    if (l.node.kind != #folder) return #err(#invalid("Not a folder"));
    let lim = clampLimit(a.limit, MAX_PAGE);
    let out = Buffer.Buffer<NodeInfo>(lim);
    var last : ?Text = null;
    var more = false;
    label page for ((k, cid) in textOps.entries(l.node.children)) {
      switch (a.after) { case (?x) if (k <= x) continue page; case null {} };
      if (out.size() >= lim) { more := true; break page };
      switch (Map.get(nodes, Map.nhash, cid)) {
        case (?_) switch (look(caller, cid, null)) { case (?cl) out.add(info(cl)); case null {} };
        case null {};
      };
      last := ?k;
    };
    #ok({ items = Buffer.toArray(out); next = if (more) last else null });
  };

  public query ({ caller }) func get_content(a : { node : NodeId; version : ?VersionId }) : async Result<ContentOut> {
    let l = switch (need(caller, a.node, #read)) { case (#ok(l)) l; case (#err(e)) return #err(e) };
    let vid = switch (a.version) { case (?v) v; case null switch (l.node.head) { case (?h) h; case null return #err(#not_found) } };
    let v = switch (Map.get(versions, Map.nhash, vid)) { case (?v) v; case null return #err(#not_found) };
    if (v.node != a.node) return #err(#not_found);
    let bytes = switch (v.content) { case (#inline(b)) b; case (#chunks(_)) return #err(#invalid("Chunked versions come in phase 1")) };
    #ok({ node = a.node; version = vid; mime = v.mime; size = v.size; sha256 = v.sha256; bytes; text = Text.decodeUtf8(bytes) });
  };

  public query ({ caller }) func list_versions(a : { node : NodeId; before : ?VersionId; limit : Nat }) : async Result<VersionPage> {
    let l = switch (need(caller, a.node, #read)) { case (#ok(l)) l; case (#err(e)) return #err(e) };
    let lim = clampLimit(a.limit, MAX_PAGE);
    let vs = l.node.versions;
    let out = Buffer.Buffer<VersionInfo>(lim);
    var more = false;
    var i = vs.size();
    label page while (i > 0) {
      i -= 1;
      let vid = vs[i];
      switch (a.before) { case (?b) if (vid >= b) continue page; case null {} };
      if (out.size() >= lim) { more := true; break page };
      switch (Map.get(versions, Map.nhash, vid)) {
        case (?v) out.add({ id = v.id; size = v.size; mime = v.mime; sha256 = v.sha256; created_at = v.created_at; created_by = v.created_by; is_head = l.node.head == ?v.id });
        case null {};
      };
    };
    let items = Buffer.toArray(out);
    #ok({ items; next = if (more and items.size() > 0) ?items[items.size() - 1].id else null });
  };

  /// Trash roots the caller can read, by node id.
  public query ({ caller }) func list_trash(a : { after : ?NodeId; limit : Nat }) : async Result<NodePage> {
    let lim = clampLimit(a.limit, MAX_PAGE);
    let out = Buffer.Buffer<NodeInfo>(lim);
    var scanned = 0;
    var last : ?NodeId = null;
    var more = false;
    label page for ((id, _) in natOps.entries(trash_roots)) {
      switch (a.after) { case (?x) if (id <= x) continue page; case null {} };
      if (out.size() >= lim or scanned >= SCAN_NODES) { more := true; break page };
      scanned += 1;
      last := ?id;
      switch (look(caller, id, null)) {
        case (?l) if (atLeast(l.access, #read)) out.add(info(l));
        case null {};
      };
    };
    #ok({ items = Buffer.toArray(out); next = if (more) last else null });
  };

  func containsText(hay : Text, needle : Text) : Bool = Text.contains(hay, #text needle);

  /// Up to 160 characters of `text` around the first match of `q` (lowercase).
  func snippetOf(text : Text, lower : Text, q : Text) : ?Text {
    let lc = Iter.toArray(lower.chars());
    let oc = Iter.toArray(text.chars());
    let qc = Iter.toArray(q.chars());
    if (qc.size() == 0 or lc.size() < qc.size()) return null;
    var i = 0;
    let last : Nat = lc.size() - qc.size();
    label scan while (i <= last) {
      var j = 0;
      while (j < qc.size() and lc[i + j] == qc[j]) j += 1;
      if (j == qc.size()) {
        let s : Nat = if (i > 50) i - 50 else 0;
        let e = Nat.min(oc.size(), i + qc.size() + 110);
        if (s >= e) return null;
        let body = Text.fromIter(Array.slice<Char>(oc, s, e));
        return ?((if (s > 0) "…" else "") # body # (if (e < oc.size()) "…" else ""));
      };
      i += 1;
    };
    null;
  };

  public query ({ caller }) func search(a : SearchArgs) : async Result<SearchPage> {
    let lim = clampLimit(a.limit, MAX_SEARCH_HITS);
    let q = Text.toLowercase(Text.trim(a.query_, #char ' '));
    if (q.size() > MAX_NAME_CHARS) return #err(#invalid("The query is at most 255 characters"));
    let want = switch (normTags(a.tags)) { case (#ok(t)) t; case (#err(e)) return #err(e) };
    let hits = Buffer.Buffer<SearchHit>(lim);
    var id = switch (a.after) { case (?x) x + 1; case null 1 };
    var scanned = 0;
    var bytes = 0;
    label scan while (id < next_node) {
      if (hits.size() >= lim or scanned >= SCAN_NODES or bytes >= SCAN_BYTES) break scan;
      let cur = id;
      id += 1;
      scanned += 1;
      let l = switch (look(caller, cur, a.under)) { case (?l) l; case null continue scan };
      if (not atLeast(l.access, #read)) continue scan;
      if (l.in_trash and not a.include_trash) continue scan;
      switch (a.under) { case (?_) if (not l.under) continue scan; case null {} };
      let n = l.node;
      switch (a.kind) { case (?k) if (k != n.kind) continue scan; case null {} };
      var hasAll = true;
      for (t in want.vals()) if (Option.isNull(Array.find<Text>(n.tags, func(x) = x == t))) hasAll := false;
      if (not hasAll) continue scan;
      if (q == "") { hits.add({ node = info(l); matched = #filter; snippet = null }); continue scan };
      if (containsText(n.name_key, q)) { hits.add({ node = info(l); matched = #name; snippet = null }); continue scan };
      if (Option.isSome(Array.find<Text>(n.tags, func(x) = containsText(x, q)))) { hits.add({ node = info(l); matched = #tag; snippet = null }); continue scan };
      if (a.in_content and n.kind == #file) {
        switch (headOf(n)) {
          case (?v) switch (v.content) {
            case (#inline(b)) {
              bytes += b.size();
              switch (Text.decodeUtf8(b)) {
                case (?txt) {
                  let lower = Text.toLowercase(txt);
                  if (containsText(lower, q)) hits.add({ node = info(l); matched = #content; snippet = snippetOf(txt, lower, q) });
                };
                case null {};
              };
            };
            case (#chunks(_)) {};
          };
          case null {};
        };
      };
    };
    #ok({ hits = Buffer.toArray(hits); next = if (id < next_node) ?(id - 1) else null });
  };

  /// Tags with how many items carry them. The owner gets every tag in one page; others get the
  /// tags of items they can read, a scan budget at a time (merge the pages until next = null).
  public query ({ caller }) func list_tags(a : { after : ?NodeId }) : async Result<TagPage> {
    if (isOwner(caller)) {
      let all = Iter.toArray(Iter.map<(Text, Nat), TagCount>(Map.entries(tag_counts), func((t, c)) = { tag = t; count = c }));
      return #ok({ tags = Array.sort<TagCount>(all, func(x, y) = Text.compare(x.tag, y.tag)); next = null });
    };
    let counts = Map.new<Text, Nat>();
    var id = switch (a.after) { case (?x) x + 1; case null 1 };
    var scanned = 0;
    if (Map.has(by_grantee, Map.phash, caller)) {
      label scan while (id < next_node and scanned < SCAN_NODES) {
        let cur = id;
        id += 1;
        scanned += 1;
        switch (look(caller, cur, null)) {
          case (?l) if (atLeast(l.access, #read) and not l.in_trash) for (t in l.node.tags.vals()) Map.set(counts, Map.thash, t, Option.get(Map.get(counts, Map.thash, t), 0) + 1);
          case null {};
        };
      };
    } else { id := next_node };
    let all = Iter.toArray(Iter.map<(Text, Nat), TagCount>(Map.entries(counts), func((t, c)) = { tag = t; count = c }));
    #ok({ tags = Array.sort<TagCount>(all, func(x, y) = Text.compare(x.tag, y.tag)); next = if (id < next_node) ?(id - 1) else null });
  };

  /// The caller's direct grants: where a grantee starts.
  public query ({ caller }) func list_shared_with_me(a : { after : ?NodeId; limit : Nat }) : async Result<SharedPage> {
    let lim = clampLimit(a.limit, MAX_PAGE);
    let ids = Array.sort<NodeId>(Option.get(Map.get(by_grantee, Map.phash, caller), []), Nat.compare);
    let out = Buffer.Buffer<SharedEntry>(lim);
    var more = false;
    var last : ?NodeId = null;
    label page for (id in ids.vals()) {
      switch (a.after) { case (?x) if (id <= x) continue page; case null {} };
      if (out.size() >= lim) { more := true; break page };
      last := ?id;
      let role = switch (Array.find<Grant>(Option.get(Map.get(grants, Map.nhash, id), []), func(g) = g.principal == caller)) { case (?g) g.role; case null continue page };
      switch (look(caller, id, null)) { case (?l) out.add({ node = info(l); role }); case null {} };
    };
    #ok({ items = Buffer.toArray(out); next = if (more) last else null });
  };

  public query ({ caller }) func get_grants(id : NodeId) : async Result<Grants> {
    switch (need(caller, id, #manage)) { case (#ok(_)) #ok(grantsOf(id)); case (#err(e)) #err(e) };
  };

  func limits() : Limits {
    {
      max_inline_bytes = MAX_INLINE_BYTES;
      hard_max_nodes = HARD_MAX_NODES;
      hard_max_versions_per_node = HARD_MAX_VERSIONS;
      hard_max_total_bytes = HARD_MAX_TOTAL_BYTES;
      max_children = MAX_CHILDREN;
      max_depth = MAX_DEPTH;
      max_name_chars = MAX_NAME_CHARS;
      max_tags_per_node = MAX_TAGS;
      max_tag_chars = MAX_TAG_CHARS;
      max_distinct_tags = MAX_DISTINCT_TAGS;
      max_grants_per_node = MAX_GRANTS_PER_NODE;
      max_grants_per_principal = MAX_GRANTS_PER_PRINCIPAL;
      max_grants_total = MAX_GRANTS_TOTAL;
      max_page = MAX_PAGE;
      max_search_hits = MAX_SEARCH_HITS;
      search_scan_nodes = SCAN_NODES;
      search_scan_bytes = SCAN_BYTES;
      purge_batch = PURGE_BATCH;
    };
  };

  /// Counts, settings and limits. Public: it holds no names or contents.
  public query func get_drive_info() : async DriveInfo {
    var files = 0;
    var folders = 0;
    for (n in Map.vals(nodes)) { if (n.kind == #file) files += 1 else folders += 1 };
    {
      owner;
      nodes = Map.size(nodes);
      files;
      folders;
      versions = Map.size(versions);
      total_bytes;
      trash_roots = natOps.size(trash_roots);
      grants = grants_total;
      distinct_tags = Map.size(tag_counts);
      seq;
      settings;
      limits = limits();
      cycles = Cycles.balance();
      version = VERSION_TEXT;
    };
  };

  /// The text log (spills, failures): owner only.
  public query ({ caller }) func get_log(start : Nat, length : Nat) : async [T.LogEntry] {
    if (not isOwner(caller)) Debug.trap("Owner only");
    TextLog.get(textlog, start, length);
  };

  public query func get_api_doc() : async Text { ApiDoc.text };

  // ---------------------------------------------------------------------------------------------
  // ICRC-3: the write log, owner only (archives: see spec §7)
  // ---------------------------------------------------------------------------------------------

  public query ({ caller }) func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult {
    if (not isOwner(caller)) Debug.trap("Owner only");
    Icrc3Log.getBlocks(icrc3, args);
  };
  public query ({ caller }) func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult {
    if (not isOwner(caller)) Debug.trap("Owner only");
    Icrc3Log.getArchives(icrc3, args);
  };
  public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate { Icrc3Log.tipCertificate(icrc3) };
  public query func icrc3_supported_block_types() : async [T3.BlockType] { Icrc3Log.supportedBlockTypes(icrc3_catalogue) };
  public query func icrc10_supported_standards() : async [T3.SupportedStandard] { Icrc3Log.supportedStandards() };
  public query ({ caller }) func icrc3_log_status() : async T3.LogStatus {
    if (not isOwner(caller)) Debug.trap("Owner only");
    Icrc3Log.status(icrc3, icrc3_rt);
  };

  public shared ({ caller }) func admin_set_icrc3_settings(u : T3.SettingsUpdate) : async { #Ok : T3.Settings; #Err : Text } {
    if (not isOwner(caller)) return #Err("Owner only");
    switch (Icrc3Log.applySettings(icrc3, u)) {
      case (#Err(e)) #Err(e);
      case (#Ok(_)) #Ok(icrc3.settings);
    };
  };
  public shared ({ caller }) func admin_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
    if (not isOwner(caller)) return #Err("Owner only");
    if (icrc3_rt.spilling) return #Err("A spill is already in progress");
    #Ok(await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), true));
  };
  public shared ({ caller }) func admin_icrc3_repair_archive_controllers() : async [(Principal, { #Ok; #Err : Text })] {
    if (not isOwner(caller)) Debug.trap("Owner only");
    await* Icrc3Log.repairArchiveControllers(icrc3, icrc3_env());
  };

  // ---------------------------------------------------------------------------------------------
  // Timers (no heartbeat): ICRC-3 spill check, trash retention
  // ---------------------------------------------------------------------------------------------

  func icrc3_timer_job() : async () { ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false) };
  func ensure_icrc3_timer<system>() { Icrc3Log.ensureTimer<system>(icrc3_rt, 15 * 60, icrc3_timer_job) };

  func retention_job() : async () {
    let days = settings.retention.trash_days;
    if (days == 0) return;
    let r = purgeTrash(?(Time.now() - days * DAY_NS), PURGE_BATCH, self());
    if (r.purged > 0) TextLog.add(textlog, #info, TextLog.correlationId(textlog), self(), "Retention: purged " # Nat.toText(r.purged) # " items older than " # Nat.toText(days) # " days" # (if (r.done) "" else " (more next run)"));
  };
  transient var retention_timer : ?Timer.TimerId = null;
  func ensure_retention_timer<system>() {
    if (Option.isNull(retention_timer)) retention_timer := ?Timer.recurringTimer<system>(#seconds(RETENTION_PERIOD_S), retention_job);
  };

  ensure_icrc3_timer<system>();
  ensure_retention_timer<system>();

  system func postupgrade() {
    Icrc3Log.certify(icrc3);
    ensure_icrc3_timer<system>();
    ensure_retention_timer<system>();
  };

  // ---------------------------------------------------------------------------------------------
  // Ingress guard (src/IngressGuard.mo): queries are refused as update calls, anonymous writes
  // are refused, and every argument is capped. The methods check everything again.
  // ---------------------------------------------------------------------------------------------

  transient let CONTENT_ARG : Nat = IngressGuard.SMALL_ARG + MAX_INLINE_BYTES + 4 * (MAX_NAME_CHARS + MAX_TAGS * MAX_TAG_CHARS + MAX_MIME_CHARS);
  transient let NAME_ARG : Nat = IngressGuard.textArg(MAX_NAME_CHARS + MAX_TAGS * (MAX_TAG_CHARS + 1));

  system func inspect({ caller : Principal; arg : Blob; msg : {
    #create_folder : Any;
    #create_file : Any;
    #save_file : Any;
    #rename : Any;
    #move_node : Any;
    #set_tags : Any;
    #trash : Any;
    #restore : Any;
    #restore_version : Any;
    #purge : Any;
    #empty_trash : Any;
    #purge_versions : Any;
    #grant : Any;
    #revoke : Any;
    #set_settings : Any;
    #set_owner : Any;
    #admin_set_icrc3_settings : Any;
    #admin_icrc3_spill_now : Any;
    #admin_icrc3_repair_archive_controllers : Any;
    #get_node : Any;
    #resolve_path : Any;
    #get_path : Any;
    #list_children : Any;
    #get_content : Any;
    #list_versions : Any;
    #list_trash : Any;
    #search : Any;
    #list_tags : Any;
    #list_shared_with_me : Any;
    #get_grants : Any;
    #get_drive_info : Any;
    #get_log : Any;
    #get_api_doc : Any;
    #icrc3_get_blocks : Any;
    #icrc3_get_archives : Any;
    #icrc3_get_tip_certificate : Any;
    #icrc3_supported_block_types : Any;
    #icrc10_supported_standards : Any;
    #icrc3_log_status : Any;
  } }) : Bool {
    switch msg {
      case (#get_node _ or #resolve_path _ or #get_path _ or #list_children _ or #get_content _ or #list_versions _ or #list_trash _ or #search _ or #list_tags _ or #list_shared_with_me _ or #get_grants _ or #get_drive_info _ or #get_log _ or #get_api_doc _) false;
      case (#icrc3_get_blocks _ or #icrc3_get_archives _ or #icrc3_get_tip_certificate _ or #icrc3_supported_block_types _ or #icrc10_supported_standards _ or #icrc3_log_status _) false;
      case (#create_file _ or #save_file _) not Principal.isAnonymous(caller) and arg.size() <= CONTENT_ARG;
      case (#create_folder _ or #rename _ or #set_tags _) not Principal.isAnonymous(caller) and arg.size() <= NAME_ARG;
      case (#move_node _ or #trash _ or #restore _ or #restore_version _ or #grant _ or #revoke _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#purge _ or #empty_trash _ or #purge_versions _ or #set_settings _ or #admin_set_icrc3_settings _ or #admin_icrc3_spill_now _ or #admin_icrc3_repair_archive_controllers _) isOwner(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#set_owner _) (isOwner(caller) or Principal.isController(caller)) and arg.size() <= IngressGuard.SMALL_ARG;
    };
  };
};
