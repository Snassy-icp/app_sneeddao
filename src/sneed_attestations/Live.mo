import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Nat "mo:base/Nat";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Sha256 "mo:sha2/Sha256";
import Hash "../icrc3/Hash";
import T "Types";

/// The registry's own checks: the live module (management canister `canister_info`) and the live
/// asset tree (asset canister `list`). Pure functions over the replies; main.mo makes the calls.
module {

  // ---------------------------------------------------------------------------------------------
  // canister_info (management canister). Any canister may call it for any canister; ingress can't.
  // The IC keeps only the 20 most recent changes, which is why the registry checks promptly.
  // origin and details sit in opt: a change kind added to the IC later reads as null instead of
  // failing the reply; load_snapshot's fields likewise.
  // ---------------------------------------------------------------------------------------------

  public type ChangeOrigin = {
    #from_user : { user_id : Principal };
    #from_canister : { canister_id : Principal; canister_version : ?Nat64 };
  };
  public type ChangeDetails = {
    #creation : { controllers : [Principal] };
    #code_uninstall;
    #code_deployment : { mode : ?{ #install; #reinstall; #upgrade }; module_hash : Blob };
    #load_snapshot : { canister_version : ?Nat64; snapshot_id : ?Blob; taken_at_timestamp : ?Nat64 };
    #controllers_change : { controllers : [Principal] };
  };
  public type Change = { timestamp_nanos : Nat64; canister_version : Nat64; origin : ?ChangeOrigin; details : ?ChangeDetails };
  public type CanisterInfo = { total_num_changes : Nat64; recent_changes : [Change]; module_hash : ?Blob; controllers : [Principal] };
  public type Management = actor {
    canister_info : shared { canister_id : Principal; num_requested_changes : ?Nat64 } -> async CanisterInfo;
  };

  public let HISTORY : Nat64 = 20; // the most the IC keeps

  func installer(c : Change, governance : ?Principal, root : ?Principal) : ?T.Installer {
    let (p, isCanister) = switch (c.origin) {
      case (?#from_user(u)) (u.user_id, false);
      case (?#from_canister(x)) (x.canister_id, true);
      case null return null;
    };
    let role : T.InstallerRole = if (not isCanister) #user else if (?p == governance) #governance else if (?p == root) #dao_root else #other_canister;
    ?{ principal = p; role; at_ns = c.timestamp_nanos; canister_version = c.canister_version };
  };

  func deployedHash(c : Change) : ?Blob = switch (c.details) {
    case (?#code_deployment(d)) ?d.module_hash;
    case _ null;
  };

  func short(b : Blob) : Text { let h = Hash.toHex(b); if (h.size() <= 12) h else Text.fromIter(Array.subArray<Char>(Text.toArray(h), 0, 12).vals()) # "…" };
  func who(i : ?T.Installer) : Text = switch i {
    case (?x) (switch (x.role) { case (#user) "user "; case (#governance) "the governance canister "; case (#dao_root) "the SNS root "; case (#other_canister) "canister " }) # Principal.toText(x.principal);
    case null "an unknown installer";
  };

  /// A wasm step (or release): is `expected` live, and who installed it?
  /// - live hash == expected: #live_match; installed_by = the newest code deployment of that hash in
  ///   the history (for a skipped step: the earlier install that put it there), null when it is
  ///   older than the history the IC keeps;
  /// - otherwise #live_mismatch, saying whether the expected module was installed and later
  ///   replaced (and by what), or never appears in the recent history.
  public func checkWasm(info : CanisterInfo, expected : ?Blob, governance : ?Principal, root : ?Principal) : (T.LiveResult, ?T.Installer) {
    let changes = info.recent_changes;
    let n = changes.size();
    let exp = switch expected {
      case (?e) e;
      case null {
        // nothing to compare with: still say who did the last install
        var i = n;
        while (i > 0) { i -= 1; if (deployedHash(changes[i]) != null) return (#not_checked("no proposed hash to compare the live module with"), installer(changes[i], governance, root)) };
        return (#not_checked("no proposed hash to compare the live module with"), null);
      };
    };
    // the newest deployment of the expected hash, if the history still has it
    var at : ?Nat = null;
    var i = n;
    label find while (i > 0) { i -= 1; if (deployedHash(changes[i]) == ?exp) { at := ?i; break find } };
    let by = switch at { case (?k) installer(changes[k], governance, root); case null null };
    if (info.module_hash == ?exp) return (#live_match, by);
    let live = switch (info.module_hash) { case (?h) "the live module is " # short(h); case null "the canister has no module installed" };
    switch at {
      case (?k) {
        // installed, then replaced: by what?
        var j = k + 1;
        var later : ?Change = null;
        while (j < n) { switch (changes[j].details) { case (?#code_deployment(_) or ?#code_uninstall or ?#load_snapshot(_)) later := ?changes[j]; case _ {} }; j += 1 };
        let what = switch later { case (?c) " (last changed by " # who(installer(c, governance, root)) # ")"; case null "" };
        (#live_mismatch("the proposed module " # short(exp) # " was installed, then replaced: " # live # what), by);
      };
      case null (#live_mismatch(live # "; the proposed module " # short(exp) # " is not in the last " # Nat.toText(n) # " changes"), null);
    };
  };

  /// A snapshot-restore step: the newest load_snapshot (of `snapshot`, when known) in the history,
  /// the module before it (the newest deployment before it, when the history has one) and now.
  public func checkSnapshot(info : CanisterInfo, snapshot : ?Blob, governance : ?Principal, root : ?Principal) : (T.LiveResult, ?T.Installer) {
    let changes = info.recent_changes;
    var i = changes.size();
    var at : ?Nat = null;
    var sid : ?Blob = snapshot;
    label find while (i > 0) {
      i -= 1;
      switch (changes[i].details) {
        case (?#load_snapshot(l)) if (snapshot == null or l.snapshot_id == snapshot) { at := ?i; if (sid == null) sid := l.snapshot_id; break find };
        case _ {};
      };
    };
    switch at {
      case null (#not_checked("no snapshot restore in the last " # Nat.toText(changes.size()) # " changes"), null);
      case (?k) {
        var before : ?Blob = null;
        var j = k;
        label prev while (j > 0) { j -= 1; switch (deployedHash(changes[j])) { case (?h) { before := ?h; break prev }; case null {} } };
        (#snapshot_restored({ before; after = info.module_hash; snapshot_id = sid }), installer(changes[k], governance, root));
      };
    };
  };

  // ---------------------------------------------------------------------------------------------
  // The asset tree (asset canister `list`)
  //
  // tree_sha256 = sha256 of the UTF-8 text made of one line per (asset, encoding):
  //     key "\t" content_encoding "\t" sha256
  // where sha256 is the encoding's sha256 in lower-case hex ("-" when `list` gives none), the lines
  // sorted in ascending Unicode code point order (= byte order of their UTF-8) and joined by "\n",
  // with no trailing newline. identity_tree_sha256 is the same over the identity encodings only
  // (what a rebuilt dist folder gives without knowing the canister's compression).
  // ---------------------------------------------------------------------------------------------

  public type AssetEncoding = { content_encoding : Text; sha256 : ?Blob; length : Nat; modified : Int };
  public type AssetDetails = { key : Text; content_type : Text; encodings : [AssetEncoding] };
  public type Assets = actor {
    list : shared query ({ start : ?Nat; length : ?Nat }) -> async [AssetDetails];
  };

  public let TREE_HASH_FORMAT : Text = "sha256 over the UTF-8 lines `key \\t content_encoding \\t sha256-hex` (\"-\" when list gives no sha256), one per asset encoding, sorted by code point, joined by \\n, no trailing newline; identity_tree_sha256: the same over the identity encodings only";

  public func treeHashes(assets : [AssetDetails]) : { tree : Blob; identity : Blob; assets : Nat; encodings : Nat } {
    let all = Buffer.Buffer<Text>(assets.size() * 2);
    let ident = Buffer.Buffer<Text>(assets.size());
    for (a in assets.vals()) for (e in a.encodings.vals()) {
      let line = a.key # "\t" # e.content_encoding # "\t" # (switch (e.sha256) { case (?h) Hash.toHex(h); case null "-" });
      all.add(line);
      if (e.content_encoding == "identity") ident.add(line);
    };
    func digest(lines : Buffer.Buffer<Text>) : Blob {
      let sorted = Array.sort<Text>(Buffer.toArray(lines), Text.compare);
      let d = Sha256.Digest(#sha256);
      var first = true;
      for (l in sorted.vals()) {
        if (not first) d.writeBlob(Text.encodeUtf8("\n"));
        d.writeBlob(Text.encodeUtf8(l));
        first := false;
      };
      d.sum();
    };
    { tree = digest(all); identity = digest(ident); assets = assets.size(); encodings = all.size() };
  };
};
