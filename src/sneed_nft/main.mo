import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import CertifiedData "mo:base/CertifiedData";
import Char "mo:base/Char";
import Debug "mo:base/Debug";
import Error "mo:base/Error";
import IC "mo:base/ExperimentalInternetComputer";
import Int "mo:base/Int";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Option "mo:base/Option";
import Principal "mo:base/Principal";
import Region "mo:base/Region";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Map "mo:map/Map";
import Sha256 "mo:sha2/Sha256";

import IngressGuard "../IngressGuard";
import RateLimit "../RateLimit";
import RateRules "../RateRules";
import DaoSettings "../DaoSettings";
import Ext "../sneed_names/Ext";
import TextLog "../sneed_names/TextLog";
import NT "../sneed_names/Types";
import Icrc3Log "../icrc3/Log";
import Hash "../icrc3/Hash";
import T3 "../icrc3/Types";
import MerkleTree "cert/MerkleTree";
import Http "HttpCert";
import ApiDoc "ApiDoc";
import Proof "Proof";
import T "Types";

/// sneed_nft: an ICRC-7 collection canister (spec/nft_launchpad.md §2.1) whose first collection is
/// the Sneed Diamond Club (spec/diamond_club_icrc7.md): 1,000 cards moving from the EXT canister
/// gjv36-… to ICRC-7 with every image stored here.
///
/// - ICRC-7, ICRC-37, ICRC-10 and an ICRC-3 log (src/icrc3) of every mint, transfer, approval,
///   swap, refund and admin change.
/// - The load (admins): collection metadata, the SHA-256 manifest of the original images (once),
///   batch mint to the swap account (this canister's default account), chunked image upload into
///   a stable-memory region with the SHA-256 computed here and checked against the manifest, then
///   one-way freeze_metadata() and lock_minting().
/// - Images over HTTP at /card/<n>.jpg (?size=web|thumb), certified (response verification v2),
///   so the normal icp0.io domain works.
/// - The swap: an EXT card sent to the holder's swap address is delivered as ICRC-7 token
///   index + 1 by claim_swap; a wallet that cannot send NFTs proves its key with a small payment
///   (claim_by_proof), refunded. EXT cards received are never moved again.
///
/// No heartbeat and no recurring timer: the only timer is the ICRC-3 log's one-shot spill, armed
/// by the write that fills its live store.
shared (deployer) persistent actor class SneedNft() = this {

  public type Account = T.Account;
  public type Value = T.Value;

  // ---------------------------------------------------------------------------------------------
  // Limits
  // ---------------------------------------------------------------------------------------------

  transient let MAX_QUERY_BATCH : Nat = 100;
  transient let MAX_UPDATE_BATCH : Nat = 20;
  transient let DEFAULT_TAKE : Nat = 100;
  transient let MAX_TAKE : Nat = 1_000;
  transient let MAX_MEMO : Nat = 32;
  transient let MAX_APPROVALS : Nat = 10; // per token, and per account for the collection
  transient let MAX_REVOKE : Nat = 10;
  transient let TX_WINDOW_NS : Nat = 86_400_000_000_000;
  transient let DRIFT_NS : Nat = 120_000_000_000;
  transient let MAX_MINT_BATCH : Nat = 100;
  transient let MAX_META_BYTES : Nat = 8_192; // Candid size of one token's metadata
  transient let MAX_MANIFEST : Nat = 10_000;
  transient let MAX_UPLOAD_CHUNK : Nat = 1_900_000; // per call (ingress messages are at most 2 MiB)
  transient let MAX_UPLOADS : Nat = 50; // uploads begun and not finished
  transient let MAX_NAME : Nat = 100;
  transient let MAX_SYMBOL : Nat = 20;
  transient let MAX_DESCRIPTION : Nat = 2_000;
  transient let MAX_LOGO : Nat = 512;
  transient let PAGE : Nat = 65_536;
  transient let HASH_PIECE : Nat = 1_048_576;

  func maxImage(t : T.ImageTarget) : Nat {
    switch t {
      case (#card { size = #orig }) 10_000_000;
      case (#card { size = #web }) 2_000_000;
      case (#card { size = #thumb }) 500_000;
      case (#logo) 2_000_000;
    };
  };
  transient let CONTENT_TYPES : [Text] = ["image/jpeg", "image/png", "image/webp", "image/gif"];

  // ---------------------------------------------------------------------------------------------
  // State (enhanced orthogonal persistence)
  // ---------------------------------------------------------------------------------------------

  // admins: controllers plus this list
  var admins : [Principal] = [deployer.caller];
  // Sneed DAO governance: the only caller of dao_admin (one GNSF)
  var governance : Principal = Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai");
  // the EXT collection whose cards are swapped (mainnet: the Sneed Diamond Club)
  var ext_canister : Principal = Principal.fromText("gjv36-laaaa-aaaah-adyza-cai");
  var proof_ledgers : [T.ProofLedger] = [];
  var swaps_paused : Bool = false;
  var rate_rules : RateRules.Rules = [];
  transient let limiter = RateLimit.Limiter();
  transient let RATE_DEFAULTS : RateRules.Rules = [
    ("claim", { capacity = 10; per_minute = 2 }), // claim_swap: one EXT registry read each
    ("proof", { capacity = 5; per_minute = 1 }), // claim_by_proof: ledger, registry and refund calls
    ("refund", { capacity = 10; per_minute = 2 }), // retry_refund
    // all callers together (fresh principals cost nothing): claim_swap and claim_by_proof
    ("claims_global", { capacity = 120; per_minute = 60 }),
    // ICRC-7 / ICRC-37 updates, per caller and per item: each item is a log block
    ("nft_update", { capacity = 200; per_minute = 60 }),
  ];
  // the EXT registry, read at most once per REGISTRY_TTL_NS for claim_swap, one read at a time
  transient let REGISTRY_TTL_NS : Int = 30_000_000_000;
  transient let REGISTRY_CALL_NS : Int = 120_000_000_000; // a read older than this is not running any more
  transient var registry_cache : ?(Int, [(Nat32, Text)]) = null;
  transient var registry_reading_since : ?Int = null;
  var registry_reads : Nat = 0;
  // ICRC-7 deduplication: at most this many remembered transfers (oldest pruned first)
  var dedup_cap : Nat = 20_000;
  // a refund attempt still marked in flight after this long is over (bounded wait is 30 s)
  transient let REFUND_STALE_NS : Int = 600_000_000_000;
  // resend a refund only while the ledger still deduplicates it (24 h window), with a margin
  transient let REFUND_RESEND_NS : Nat = 82_800_000_000_000; // 23 h

  // collection
  var name : Text = "";
  var symbol : Text = "";
  var description : ?Text = null;
  var logo : ?Text = null;
  var supply_cap : ?Nat = null;
  var metadata_frozen : Bool = false;
  var minting_locked : Bool = false;

  // tokens
  let owners = Map.new<Nat, Account>(); // token id -> owner
  let metas = Map.new<Nat, [(Text, Value)]>(); // token id -> metadata
  let held = Map.new<Text, [Nat]>(); // account key -> its token ids, ascending
  var all_ids : [Nat] = []; // every token id, ascending
  let token_approvals = Map.new<Nat, [T.ApprovalInfo]>(); // the current owner's approvals per token
  let coll_approvals = Map.new<Text, [T.ApprovalInfo]>(); // owner account key -> its collection approvals
  let dedup = Map.new<Blob, (Nat, Nat, Nat)>(); // hash of (method, caller, arg) -> (block, created_at_time, inserted at), oldest first

  // images: bytes in one stable-memory region, appended; entries by key ("card/<n>/<size>", "logo")
  type Image = { target : T.ImageTarget; offset : Nat; size : Nat; sha256 : Blob; content_type : Text; uploaded_at : Int; uploaded_by : Principal };
  type Upload = { id : Nat; target : T.ImageTarget; offset : Nat; size : Nat; received : Nat; content_type : Text; started_at : Int; by : Principal };
  let manifest = Map.new<Nat, Blob>(); // token id -> SHA-256 of its original image
  var manifest_hash : ?Blob = null; // set once
  let images = Map.new<Text, Image>();
  let image_region : Region.Region = Region.new();
  var region_used : Nat = 0; // bytes
  var wasted_bytes : Nat = 0;
  let uploads = Map.new<Nat, Upload>();
  var next_upload : Nat = 1;

  // the swap
  let swaps = Map.new<Nat32, T.Swap>(); // EXT token index -> its swap (also proof swaps: retired)
  let proofs = Map.new<Text, T.Proof>(); // "<ledger>:<block>" -> the proof (each payment counts once)
  var retired_count : Nat = 0;

  // the certified tree (HTTP responses + ICRC-3 tip), kept up to date by every change. Rebuilding
  // it from the state costs about as much as 3,000 image uploads, so it happens only at install
  // and in the upgrade that brings a new CERT_VERSION: bump it whenever the certified responses
  // change (headers, expression, routes, static bodies).
  var cert_tree : MerkleTree.Tree = MerkleTree.empty();
  var cert_built : Bool = false;
  transient let CERT_VERSION : Nat = 1;
  var cert_version : Nat = CERT_VERSION;
  transient let EXPR_HASH : Blob = Http.expressionHash();

  // ICRC-3 log and the operational text log
  var icrc3 : Icrc3Log.State = Icrc3Log.init();
  transient let icrc3_rt : Icrc3Log.Runtime = Icrc3Log.runtime();
  let textlog : TextLog.State = TextLog.init();
  transient let SNEED_SNS_ROOT : Principal = Principal.fromText("fp274-iaaaa-aaaaq-aacha-cai");

  transient let BLOCK_TYPES : [(Text, Text)] = [
    ("7mint", "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-7/ICRC-7.md"),
    ("7xfer", "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-7/ICRC-7.md"),
    ("7update_token", "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-7/ICRC-7.md"),
    ("37approve", "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-37/ICRC-37.md"),
    ("37approve_coll", "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-37/ICRC-37.md"),
    ("37revoke", "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-37/ICRC-37.md"),
    ("37revoke_coll", "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-37/ICRC-37.md"),
    ("37xfer", "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-37/ICRC-37.md"),
    ("dcswap", "https://app.sneeddao.com/api/sneed_nft#block-types"),
    ("dcrefund", "https://app.sneeddao.com/api/sneed_nft#block-types"),
    ("sneednft_image", "https://app.sneeddao.com/api/sneed_nft#block-types"),
    ("sneednft_config", "https://app.sneeddao.com/api/sneed_nft#block-types"),
  ];

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  func self() : Principal = Principal.fromActor(this);
  func swapAccount() : Account = { owner = self(); subaccount = null };
  func nowNat() : Nat = Int.abs(Time.now());

  func isAdmin(p : Principal) : Bool = Principal.isController(p) or Array.find<Principal>(admins, func(a) = a == p) != null;

  func normSub(s : ?Blob) : ?Blob = Proof.normSub(s);
  func sameAccount(a : Account, b : Account) : Bool = Proof.sameAccount(a, b);
  func validSub(s : ?Blob) : Bool = switch (s) { case null true; case (?b) b.size() == 32 };
  func norm(a : Account) : Account = { owner = a.owner; subaccount = normSub(a.subaccount) };
  func accountKey(a : Account) : Text = Principal.toText(a.owner) # "." # (switch (normSub(a.subaccount)) { case null ""; case (?b) Hash.toHex(b) });

  func log_info(caller : Principal, cid : Nat, m : Text) = TextLog.add(textlog, #info, cid, caller, m);
  func log_error(caller : Principal, cid : Nat, m : Text) = TextLog.add(textlog, #error, cid, caller, m);
  func cid() : Nat = TextLog.correlationId(textlog);

  func rateRule(action : Text) : RateLimit.Rule = RateRules.rule(rate_rules, RATE_DEFAULTS, action);
  func rateAllows(p : Principal, action : Text) : Bool = isAdmin(p) or limiter.allows(p, action, rateRule(action), Time.now());
  func rateTake(p : Principal, action : Text) : Bool = isAdmin(p) or limiter.take(p, action, rateRule(action), Time.now());

  type TimeRefusal = { #TooOld; #CreatedInFuture : { ledger_time : Nat64 } };
  func checkTime(t : ?Nat64) : ?TimeRefusal {
    let now = nowNat();
    switch (t) {
      case null null;
      case (?x) {
        let n = Nat64.toNat(x);
        if (n + TX_WINDOW_NS + DRIFT_NS < now) return ?#TooOld;
        if (n > now + DRIFT_NS) return ?#CreatedInFuture({ ledger_time = Nat64.fromNat(now) });
        null;
      };
    };
  };
  func memoOk(m : ?Blob) : Bool = switch (m) { case null true; case (?b) b.size() <= MAX_MEMO };
  func notExpired(i : T.ApprovalInfo) : Bool = switch (i.expires_at) { case (?e) Nat64.toNat(e) > nowNat(); case null true };

  // sorted id lists
  func insertSorted(xs : [Nat], x : Nat) : [Nat] {
    let b = Buffer.Buffer<Nat>(xs.size() + 1);
    var done = false;
    for (y in xs.vals()) {
      if (not done and x < y) { b.add(x); done := true };
      if (y != x) b.add(y);
    };
    if (not done) b.add(x);
    Buffer.toArray(b);
  };
  func removeSorted(xs : [Nat], x : Nat) : [Nat] = Array.filter<Nat>(xs, func(y) = y != x);
  /// Ascending ids after `prev`, at most `take` (capped). Binary search for the start.
  func page(sorted : [Nat], prev : ?Nat, take : ?Nat) : [Nat] {
    let n = Nat.min(Option.get(take, DEFAULT_TAKE), MAX_TAKE);
    var lo = 0;
    switch (prev) {
      case (?p) {
        var hi = sorted.size();
        while (lo < hi) { let mid = (lo + hi) / 2; if (sorted[mid] <= p) lo := mid + 1 else hi := mid };
      };
      case null {};
    };
    let end = Nat.min(sorted.size(), lo + n);
    if (lo >= end) [] else Array.tabulate<Nat>(end - lo, func(i) = sorted[lo + i]);
  };

  // ---------------------------------------------------------------------------------------------
  // ICRC-3 log and certification
  // ---------------------------------------------------------------------------------------------

  func icrc3_env() : Icrc3Log.Environment {
    {
      self = self();
      archive_controllers = [SNEED_SNS_ROOT]; // added next to this canister on every archive
      cycle_reserve = 2_000_000_000_000; // never spend the balance below 2 T
      new_correlation_id = func() : Nat = TextLog.correlationId(textlog);
      log_info = func(c : Nat, m : Text) = TextLog.add(textlog, #info, c, self(), m);
      log_error = func(c : Nat, m : Text) = TextLog.add(textlog, #error, c, self(), m);
    };
  };

  /// Appends one block and republishes the certified root (the log library certifies its tip
  /// alone; this canister's root also holds the HTTP responses, so it is set again here).
  func block<system>(btype : Text, tx : [(Text, Value)]) : Nat {
    let i = Icrc3Log.append(icrc3, btype, nowNat(), tx);
    putTip();
    publish();
    Icrc3Log.armIfNeeded<system>(icrc3, icrc3_rt);
    i;
  };
  func acct(a : Account) : Value = Icrc3Log.account(a.owner, normSub(a.subaccount));
  func pv(p : Principal) : Value = Icrc3Log.principal(p);
  func optFields(memo : ?Blob, ts : ?Nat64) : [(Text, Value)] {
    let b = Buffer.Buffer<(Text, Value)>(2);
    switch (memo) { case (?m) b.add(("memo", #Blob(m))); case null {} };
    switch (ts) { case (?t) b.add(("ts", #Nat(Nat64.toNat(t)))); case null {} };
    Buffer.toArray(b);
  };
  func configBlock<system>(caller : Principal, key : Text, value : Value) {
    ignore block<system>("sneednft_config", [("caller", pv(caller)), ("key", #Text(key)), ("value", value)]);
  };

  func putTip() {
    switch (icrc3.last_hash) {
      case (?h) {
        cert_tree := MerkleTree.put(cert_tree, ["last_block_hash"], h);
        cert_tree := MerkleTree.put(cert_tree, ["last_block_index"], Blob.fromArray(Hash.leb128(icrc3.log_length - 1)));
      };
      case null {};
    };
  };
  func publish() { CertifiedData.set(MerkleTree.treeHash(cert_tree)) };

  // ---------------------------------------------------------------------------------------------
  // HTTP routes and their certification
  // ---------------------------------------------------------------------------------------------

  transient let INDEX_BODY : Blob = "Sneed NFT collection canister (ICRC-7). Card images: /card/<n>.jpg, ?size=web or ?size=thumb for smaller ones. Logo: /logo.jpg.\n";
  transient let NOT_FOUND_BODY : Blob = "Not found\n";
  transient let TEXT_PLAIN : Text = "text/plain; charset=utf-8";
  transient let CACHE_LOAD : Text = "public, max-age=300";
  // images are immutable: an original must match the manifest, so only a web size or thumbnail
  // can change, and only during the load, before anyone is pointed at them
  transient let CACHE_IMAGE : Text = "public, max-age=31536000, immutable";
  func cacheControl() : Text = CACHE_IMAGE;

  func sizeText(s : T.ImageSize) : Text = switch s { case (#orig) "orig"; case (#web) "web"; case (#thumb) "thumb" };
  func imageKey(t : T.ImageTarget) : Text = switch t {
    case (#card { token_id; size }) "card/" # Nat.toText(token_id) # "/" # sizeText(size);
    case (#logo) "logo";
  };
  /// The URL path segments an image is served at (all sizes of a card share one path).
  func imageSegments(t : T.ImageTarget) : [Text] = switch t {
    case (#card { token_id }) ["card", Nat.toText(token_id) # ".jpg"];
    case (#logo) ["logo.jpg"];
  };
  func imageLeaf(img : Image) : [Blob] {
    let hs = Http.headers(img.content_type, cacheControl());
    Http.leafPath(Http.exactPath(imageSegments(img.target)), EXPR_HASH, Http.responseHash(200, hs, img.sha256));
  };
  func staticLeaf(exprPath : [Text], status : Nat, body : Blob) : [Blob] {
    Http.leafPath(exprPath, EXPR_HASH, Http.responseHash(status, Http.headers(TEXT_PLAIN, CACHE_LOAD), Sha256.fromBlob(#sha256, body)));
  };

  /// The whole certified tree from the state: the index page, the 404, every image, the tip.
  func rebuildCert() {
    cert_tree := MerkleTree.empty();
    cert_tree := MerkleTree.put(cert_tree, staticLeaf(Http.exactPath([""]), 200, INDEX_BODY), "");
    cert_tree := MerkleTree.put(cert_tree, staticLeaf(Http.ROOT_WILDCARD, 404, NOT_FOUND_BODY), "");
    for (img in Map.vals(images)) cert_tree := MerkleTree.put(cert_tree, imageLeaf(img), "");
    putTip();
    publish();
  };

  func witness(paths : [[Blob]]) : Blob = MerkleTree.encodeWitness(MerkleTree.reveals(cert_tree, paths.vals()));

  func certified(hs : [Http.HeaderField], exprPath : [Text], reveal : [[Blob]]) : [Http.HeaderField] {
    switch (CertifiedData.getCertificate()) {
      case (?c) Array.append(hs, [Http.certificateHeader(c, witness(reveal), exprPath)]);
      case null hs; // not in a query (no certificate to give)
    };
  };

  func indexResponse() : Http.HttpResponse {
    let p = Http.exactPath([""]);
    { status_code = Http.status(200); headers = certified(Http.headers(TEXT_PLAIN, CACHE_LOAD), p, [staticLeaf(p, 200, INDEX_BODY)]); body = INDEX_BODY; streaming_strategy = null; upgrade = null };
  };

  /// The 404 at the root wildcard, with every more specific candidate of the path (as sent and
  /// normalized) proved absent.
  func notFound(raw : [Text], segs : [Text]) : Http.HttpResponse {
    let reveal = Buffer.Buffer<[Blob]>(16);
    reveal.add(staticLeaf(Http.ROOT_WILDCARD, 404, NOT_FOUND_BODY));
    for (c in Array.append(Http.candidates(raw), Http.candidates(segs)).vals()) if (c != Http.ROOT_WILDCARD) reveal.add(Http.treePath(c));
    { status_code = Http.status(404); headers = certified(Http.headers(TEXT_PLAIN, CACHE_LOAD), Http.ROOT_WILDCARD, Buffer.toArray(reveal)); body = NOT_FOUND_BODY; streaming_strategy = null; upgrade = null };
  };

  func imageResponse(img : Image) : Http.HttpResponse {
    let hs = Http.headers(img.content_type, cacheControl());
    let first = Nat.min(img.size, Http.CHUNK);
    let body = Region.loadBlob(image_region, Nat64.fromNat(img.offset), first);
    let streaming : ?Http.StreamingStrategy = if (img.size > Http.CHUNK) {
      ?#Callback({ callback = http_request_streaming_callback; token = { key = imageKey(img.target); sha256 = img.sha256; index = 1 } });
    } else null;
    { status_code = Http.status(200); headers = certified(hs, Http.exactPath(imageSegments(img.target)), [imageLeaf(img)]); body; streaming_strategy = streaming; upgrade = null };
  };

  /// The image a path asks for: /card/<n>.jpg (size from ?size=, else the original; a missing
  /// size falls back to the original), /logo.jpg.
  func route(segs : [Text], size : ?Text) : ?Image {
    if (segs.size() == 1 and segs[0] == "logo.jpg") return Map.get(images, Map.thash, "logo");
    if (segs.size() != 2 or segs[0] != "card") return null;
    let ?num = Text.stripEnd(segs[1], #text ".jpg") else return null;
    let ?n = Nat.fromText(num) else return null;
    if (Nat.toText(n) != num) return null; // one spelling per card ("01.jpg" is not card 1)
    let want : T.ImageSize = switch (size) { case (?"web") #web; case (?"thumb") #thumb; case _ #orig };
    switch (Map.get(images, Map.thash, imageKey(#card { token_id = n; size = want }))) {
      case (?img) ?img;
      case null {
        switch (Map.get(images, Map.thash, imageKey(#card { token_id = n; size = #orig }))) {
          case (?img) ?img;
          case null {
            switch (Map.get(images, Map.thash, imageKey(#card { token_id = n; size = #web }))) {
              case (?img) ?img;
              case null Map.get(images, Map.thash, imageKey(#card { token_id = n; size = #thumb }));
            };
          };
        };
      };
    };
  };

  public query func http_request(req : Http.HttpRequest) : async Http.HttpResponse {
    let raw = Http.segments(req.url);
    let segs = Http.normalized(raw);
    switch (route(segs, Http.queryParam(req.url, "size"))) {
      case (?img) imageResponse(img);
      case null { if (segs == [""]) indexResponse() else notFound(raw, segs) };
    };
  };

  public query func http_request_streaming_callback(token : Http.StreamingToken) : async Http.StreamingCallbackResponse {
    let ?img = Map.get(images, Map.thash, token.key) else Debug.trap("No such image");
    if (img.sha256 != token.sha256) Debug.trap("The image was replaced; reload it");
    let start = token.index * Http.CHUNK;
    if (start >= img.size) Debug.trap("Past the end of the image");
    let len = Nat.min(Http.CHUNK, img.size - start);
    let body = Region.loadBlob(image_region, Nat64.fromNat(img.offset + start), len);
    { body; token = if (start + len < img.size) ?{ token with index = token.index + 1 } else null };
  };

  // ---------------------------------------------------------------------------------------------
  // Token state changes (no awaits; every caller checks first)
  // ---------------------------------------------------------------------------------------------

  func heldBy(a : Account) : [Nat] = Option.get(Map.get(held, Map.thash, accountKey(a)), []);

  func setOwner(id : Nat, to : Account) {
    switch (Map.get(owners, Map.nhash, id)) {
      case (?from) {
        let k = accountKey(from);
        let rest = removeSorted(heldBy(from), id);
        if (rest.size() == 0) Map.delete(held, Map.thash, k) else Map.set(held, Map.thash, k, rest);
      };
      case null {};
    };
    let n = norm(to);
    Map.set(owners, Map.nhash, id, n);
    Map.set(held, Map.thash, accountKey(n), insertSorted(heldBy(n), id));
    Map.delete(token_approvals, Map.nhash, id); // a transfer clears token-level approvals
  };

  /// Moves `id` to `to` and logs the 7xfer block (or 37xfer with the spender). Returns the block.
  func moveToken<system>(id : Nat, from : Account, to : Account, spender : ?Account, memo : ?Blob, ts : ?Nat64) : Nat {
    setOwner(id, to);
    let base : [(Text, Value)] = [("tid", #Nat(id)), ("from", acct(from)), ("to", acct(to))];
    switch (spender) {
      case (?s) block<system>("37xfer", Array.flatten<(Text, Value)>([base, [("spender", acct(s))], optFields(memo, ts)]));
      case null block<system>("7xfer", Array.append(base, optFields(memo, ts)));
    };
  };

  /// Transaction deduplication (ICRC-7): only for calls with created_at_time.
  func dedupKey(method : Text, caller : Principal, arg : Blob) : Blob {
    let d = Sha256.Digest(#sha256);
    d.writeBlob(Text.encodeUtf8(method));
    d.writeBlob(Principal.toBlob(caller));
    d.writeBlob(arg);
    d.sum();
  };
  func dedupFind(k : Blob) : ?Nat {
    switch (Map.get(dedup, Map.bhash, k)) {
      case (?(i, t, _)) if (t + TX_WINDOW_NS + DRIFT_NS >= nowNat()) ?i else null;
      case null null;
    };
  };
  /// Drops the oldest entries that can no longer match (entries are in insertion order; one is
  /// useless once its insertion is older than the window and twice the drift). At most `max`.
  func dedupPrune(max : Nat) {
    let now = nowNat();
    var n = 0;
    label prune while (n < max) {
      switch (Map.peekFront(dedup)) {
        case (?(_, (_, _, at))) if (at + TX_WINDOW_NS + 2 * DRIFT_NS < now) { ignore Map.popFront(dedup, Map.bhash); n += 1 } else break prune;
        case null break prune;
      };
    };
  };
  /// Room for one more remembered transfer? (prunes a little first)
  func dedupRoom() : Bool {
    dedupPrune(100);
    Map.size(dedup) < dedup_cap;
  };
  func dedupAdd(k : Blob, i : Nat, t : Nat64) {
    Map.set(dedup, Map.bhash, k, (i, Nat64.toNat(t), nowNat()));
  };
  transient let RATE_LIMITED : Text = "Too many calls: try again in a minute";
  transient let DEDUP_FULL : Text = "Too many recent transfers with created_at_time to deduplicate: send without created_at_time, or later";

  // ---------------------------------------------------------------------------------------------
  // ICRC-7
  // ---------------------------------------------------------------------------------------------

  func totalSupply() : Nat = Map.size(owners);
  func effectiveCap() : ?Nat = if (minting_locked) ?totalSupply() else supply_cap;

  public query func icrc7_collection_metadata() : async [(Text, Value)] {
    let b = Buffer.Buffer<(Text, Value)>(16);
    b.add(("icrc7:name", #Text(name)));
    b.add(("icrc7:symbol", #Text(symbol)));
    switch (description) { case (?d) b.add(("icrc7:description", #Text(d))); case null {} };
    switch (logo) { case (?l) b.add(("icrc7:logo", #Text(l))); case null {} };
    b.add(("icrc7:total_supply", #Nat(totalSupply())));
    switch (effectiveCap()) { case (?c) b.add(("icrc7:supply_cap", #Nat(c))); case null {} };
    b.add(("icrc7:max_query_batch_size", #Nat(MAX_QUERY_BATCH)));
    b.add(("icrc7:max_update_batch_size", #Nat(MAX_UPDATE_BATCH)));
    b.add(("icrc7:default_take_value", #Nat(DEFAULT_TAKE)));
    b.add(("icrc7:max_take_value", #Nat(MAX_TAKE)));
    b.add(("icrc7:max_memo_size", #Nat(MAX_MEMO)));
    b.add(("icrc7:tx_window", #Nat(TX_WINDOW_NS / 1_000_000_000)));
    b.add(("icrc7:permitted_drift", #Nat(DRIFT_NS / 1_000_000_000)));
    b.add(("icrc37:max_approvals_per_token_or_collection", #Nat(MAX_APPROVALS)));
    b.add(("icrc37:max_revoke_approvals", #Nat(MAX_REVOKE)));
    Buffer.toArray(b);
  };
  public query func icrc7_symbol() : async Text { symbol };
  public query func icrc7_name() : async Text { name };
  public query func icrc7_description() : async ?Text { description };
  public query func icrc7_logo() : async ?Text { logo };
  public query func icrc7_total_supply() : async Nat { totalSupply() };
  public query func icrc7_supply_cap() : async ?Nat { effectiveCap() };
  public query func icrc7_max_query_batch_size() : async ?Nat { ?MAX_QUERY_BATCH };
  public query func icrc7_max_update_batch_size() : async ?Nat { ?MAX_UPDATE_BATCH };
  public query func icrc7_default_take_value() : async ?Nat { ?DEFAULT_TAKE };
  public query func icrc7_max_take_value() : async ?Nat { ?MAX_TAKE };
  public query func icrc7_max_memo_size() : async ?Nat { ?MAX_MEMO };
  public query func icrc7_atomic_batch_transfers() : async ?Bool { ?false };
  public query func icrc7_tx_window() : async ?Nat { ?(TX_WINDOW_NS / 1_000_000_000) };
  public query func icrc7_permitted_drift() : async ?Nat { ?(DRIFT_NS / 1_000_000_000) };

  public query func icrc10_supported_standards() : async [{ name : Text; url : Text }] {
    [
      { name = "ICRC-7"; url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-7/ICRC-7.md" },
      { name = "ICRC-37"; url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-37/ICRC-37.md" },
      { name = "ICRC-3"; url = "https://github.com/dfinity/ICRC-1/tree/main/standards/ICRC-3" },
      { name = "ICRC-10"; url = "https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-10/ICRC-10.md" },
    ];
  };

  func prefix<A>(xs : [A], max : Nat) : [A] = if (xs.size() <= max) xs else Array.subArray<A>(xs, 0, max);

  public query func icrc7_token_metadata(ids : [Nat]) : async [?[(Text, Value)]] {
    Array.map<Nat, ?[(Text, Value)]>(prefix(ids, MAX_QUERY_BATCH), func(id) = Map.get(metas, Map.nhash, id));
  };
  public query func icrc7_owner_of(ids : [Nat]) : async [?Account] {
    Array.map<Nat, ?Account>(prefix(ids, MAX_QUERY_BATCH), func(id) = Map.get(owners, Map.nhash, id));
  };
  public query func icrc7_balance_of(accounts : [Account]) : async [Nat] {
    Array.map<Account, Nat>(prefix(accounts, MAX_QUERY_BATCH), func(a) = heldBy(a).size());
  };
  public query func icrc7_tokens(prev : ?Nat, take : ?Nat) : async [Nat] { page(all_ids, prev, take) };
  public query func icrc7_tokens_of(account : Account, prev : ?Nat, take : ?Nat) : async [Nat] { page(heldBy(account), prev, take) };

  public shared ({ caller }) func icrc7_transfer(args : [T.TransferArg]) : async [?T.TransferResult] {
    if (args.size() > MAX_UPDATE_BATCH) return [?#Err(#GenericBatchError({ error_code = 1; message = "At most " # Nat.toText(MAX_UPDATE_BATCH) # " transfers per call" }))];
    let out = Buffer.Buffer<?T.TransferResult>(args.size());
    for (a in args.vals()) {
      if (not rateTake(caller, "nft_update")) { out.add(?#Err(#GenericBatchError({ error_code = 13; message = RATE_LIMITED }))); return Buffer.toArray(out) };
      out.add(?transferOne<system>(caller, a));
    };
    Buffer.toArray(out);
  };

  func transferOne<system>(caller : Principal, a : T.TransferArg) : T.TransferResult {
    if (not memoOk(a.memo)) return #Err(#GenericError({ error_code = 2; message = "The memo is longer than " # Nat.toText(MAX_MEMO) # " bytes" }));
    switch (checkTime(a.created_at_time)) { case (?#TooOld) return #Err(#TooOld); case (?#CreatedInFuture x) return #Err(#CreatedInFuture x); case null {} };
    if (not validSub(a.from_subaccount) or not validSub(a.to.subaccount)) return #Err(#GenericError({ error_code = 3; message = "A subaccount must be 32 bytes" }));
    // a duplicate is answered as such, even though the token has moved since
    let key = switch (a.created_at_time) {
      case (?t) {
        let k = dedupKey("icrc7_transfer", caller, to_candid (a));
        switch (dedupFind(k)) { case (?i) return #Err(#Duplicate({ duplicate_of = i })); case null {} };
        if (not dedupRoom()) return #Err(#GenericError({ error_code = 12; message = DEDUP_FULL }));
        ?(k, t);
      };
      case null null;
    };
    if (Principal.isAnonymous(a.to.owner) or a.to.owner == self()) return #Err(#InvalidRecipient);
    let from : Account = { owner = caller; subaccount = a.from_subaccount };
    let ?owner = Map.get(owners, Map.nhash, a.token_id) else return #Err(#NonExistingTokenId);
    if (not sameAccount(owner, from)) return #Err(#Unauthorized);
    if (sameAccount(owner, a.to)) return #Err(#InvalidRecipient);
    let i = moveToken<system>(a.token_id, owner, a.to, null, a.memo, a.created_at_time);
    switch (key) { case (?(k, t)) dedupAdd(k, i, t); case null {} };
    #Ok(i);
  };

  // ---------------------------------------------------------------------------------------------
  // ICRC-37
  // ---------------------------------------------------------------------------------------------

  func liveTokenApprovals(id : Nat) : [T.ApprovalInfo] = Array.filter<T.ApprovalInfo>(Option.get(Map.get(token_approvals, Map.nhash, id), []), notExpired);
  func liveCollApprovals(owner : Account) : [T.ApprovalInfo] = Array.filter<T.ApprovalInfo>(Option.get(Map.get(coll_approvals, Map.thash, accountKey(owner)), []), notExpired);

  func isApproved(spender : Account, owner : Account, id : Nat) : Bool {
    for (i in liveTokenApprovals(id).vals()) if (sameAccount(i.spender, spender)) return true;
    for (i in liveCollApprovals(owner).vals()) if (sameAccount(i.spender, spender)) return true;
    false;
  };

  public query func icrc37_max_approvals_per_token_or_collection() : async ?Nat { ?MAX_APPROVALS };
  public query func icrc37_max_revoke_approvals() : async ?Nat { ?MAX_REVOKE };

  public query func icrc37_is_approved(args : [T.IsApprovedArg]) : async [Bool] {
    Array.map<T.IsApprovedArg, Bool>(prefix(args, MAX_QUERY_BATCH), func(a) {
      switch (Map.get(owners, Map.nhash, a.token_id)) {
        case (?o) normSub(o.subaccount) == normSub(a.from_subaccount) and isApproved(a.spender, o, a.token_id);
        case null false;
      };
    });
  };

  public query func icrc37_get_token_approvals(token_ids : [Nat], prev : ?T.TokenApproval, take : ?Nat) : async [T.TokenApproval] {
    let n = Nat.min(Option.get(take, DEFAULT_TAKE), MAX_TAKE);
    let ids = Array.sort<Nat>(prefix(token_ids, MAX_QUERY_BATCH), Nat.compare);
    let out = Buffer.Buffer<T.TokenApproval>(n);
    var started = prev == null;
    label scan for (id in ids.vals()) {
      let list = Array.sort<T.ApprovalInfo>(liveTokenApprovals(id), func(x, y) = Text.compare(accountKey(x.spender), accountKey(y.spender)));
      for (info in list.vals()) {
        if (not started) {
          switch (prev) {
            case (?p) if (id > p.token_id or (id == p.token_id and accountKey(info.spender) > accountKey(p.approval_info.spender))) started := true;
            case null started := true;
          };
        };
        if (started) {
          if (out.size() >= n) break scan;
          out.add({ token_id = id; approval_info = info });
        };
      };
    };
    Buffer.toArray(out);
  };

  public query func icrc37_get_collection_approvals(owner : Account, prev : ?T.CollectionApproval, take : ?Nat) : async [T.CollectionApproval] {
    let n = Nat.min(Option.get(take, DEFAULT_TAKE), MAX_TAKE);
    let list = Array.sort<T.ApprovalInfo>(liveCollApprovals(owner), func(x, y) = Text.compare(accountKey(x.spender), accountKey(y.spender)));
    let after = switch (prev) { case (?p) Array.filter<T.ApprovalInfo>(list, func(x) = accountKey(x.spender) > accountKey(p.spender)); case null list };
    prefix(after, n);
  };

  public shared ({ caller }) func icrc37_approve_tokens(args : [T.ApproveTokenArg]) : async [?T.ApproveTokenResult] {
    if (args.size() > MAX_UPDATE_BATCH) return [?#Err(#GenericBatchError({ error_code = 1; message = "At most " # Nat.toText(MAX_UPDATE_BATCH) # " approvals per call" }))];
    let out = Buffer.Buffer<?T.ApproveTokenResult>(args.size());
    for (a in args.vals()) {
      if (not rateTake(caller, "nft_update")) { out.add(?#Err(#GenericBatchError({ error_code = 13; message = RATE_LIMITED }))); return Buffer.toArray(out) };
      out.add(?approveTokenOne<system>(caller, a));
    };
    Buffer.toArray(out);
  };

  func approveTokenOne<system>(caller : Principal, a : T.ApproveTokenArg) : T.ApproveTokenResult {
    let info = a.approval_info;
    if (not memoOk(info.memo)) return #Err(#GenericError({ error_code = 2; message = "The memo is longer than " # Nat.toText(MAX_MEMO) # " bytes" }));
    if (not validSub(info.from_subaccount) or not validSub(info.spender.subaccount)) return #Err(#GenericError({ error_code = 3; message = "A subaccount must be 32 bytes" }));
    let owner : Account = { owner = caller; subaccount = info.from_subaccount };
    if (sameAccount(info.spender, owner) or Principal.isAnonymous(info.spender.owner)) return #Err(#InvalidSpender);
    switch (checkTime(?info.created_at_time)) { case (?#TooOld) return #Err(#TooOld); case (?#CreatedInFuture x) return #Err(#CreatedInFuture x); case null {} };
    let ?o = Map.get(owners, Map.nhash, a.token_id) else return #Err(#NonExistingTokenId);
    if (not sameAccount(o, owner)) return #Err(#Unauthorized);
    let others = Array.filter<T.ApprovalInfo>(liveTokenApprovals(a.token_id), func(x) = not sameAccount(x.spender, info.spender));
    if (others.size() >= MAX_APPROVALS) return #Err(#GenericError({ error_code = 4; message = "At most " # Nat.toText(MAX_APPROVALS) # " approvals per token" }));
    let stored = { info with spender = norm(info.spender); from_subaccount = normSub(info.from_subaccount) };
    Map.set(token_approvals, Map.nhash, a.token_id, Array.append(others, [stored]));
    let tx = Buffer.Buffer<(Text, Value)>(6);
    tx.add(("tid", #Nat(a.token_id)));
    tx.add(("from", acct(owner)));
    tx.add(("spender", acct(info.spender)));
    switch (info.expires_at) { case (?e) tx.add(("exp", #Nat(Nat64.toNat(e)))); case null {} };
    for (f in optFields(info.memo, ?info.created_at_time).vals()) tx.add(f);
    #Ok(block<system>("37approve", Buffer.toArray(tx)));
  };

  public shared ({ caller }) func icrc37_approve_collection(args : [T.ApproveCollectionArg]) : async [?T.ApproveCollectionResult] {
    if (args.size() > MAX_UPDATE_BATCH) return [?#Err(#GenericBatchError({ error_code = 1; message = "At most " # Nat.toText(MAX_UPDATE_BATCH) # " approvals per call" }))];
    let out = Buffer.Buffer<?T.ApproveCollectionResult>(args.size());
    for (a in args.vals()) {
      if (not rateTake(caller, "nft_update")) { out.add(?#Err(#GenericBatchError({ error_code = 13; message = RATE_LIMITED }))); return Buffer.toArray(out) };
      out.add(?approveCollectionOne<system>(caller, a));
    };
    Buffer.toArray(out);
  };

  func approveCollectionOne<system>(caller : Principal, a : T.ApproveCollectionArg) : T.ApproveCollectionResult {
    let info = a.approval_info;
    if (not memoOk(info.memo)) return #Err(#GenericError({ error_code = 2; message = "The memo is longer than " # Nat.toText(MAX_MEMO) # " bytes" }));
    if (not validSub(info.from_subaccount) or not validSub(info.spender.subaccount)) return #Err(#GenericError({ error_code = 3; message = "A subaccount must be 32 bytes" }));
    let owner : Account = { owner = caller; subaccount = info.from_subaccount };
    if (sameAccount(info.spender, owner) or Principal.isAnonymous(info.spender.owner)) return #Err(#InvalidSpender);
    switch (checkTime(?info.created_at_time)) { case (?#TooOld) return #Err(#TooOld); case (?#CreatedInFuture x) return #Err(#CreatedInFuture x); case null {} };
    // state only for holders (ICRC-7 security considerations: no approvals from empty accounts)
    if (heldBy(owner).size() == 0) return #Err(#GenericError({ error_code = 5; message = "Only an account that holds a token of this collection can approve the collection" }));
    let others = Array.filter<T.ApprovalInfo>(liveCollApprovals(owner), func(x) = not sameAccount(x.spender, info.spender));
    if (others.size() >= MAX_APPROVALS) return #Err(#GenericError({ error_code = 4; message = "At most " # Nat.toText(MAX_APPROVALS) # " collection approvals per account" }));
    let stored = { info with spender = norm(info.spender); from_subaccount = normSub(info.from_subaccount) };
    Map.set(coll_approvals, Map.thash, accountKey(owner), Array.append(others, [stored]));
    let tx = Buffer.Buffer<(Text, Value)>(5);
    tx.add(("from", acct(owner)));
    tx.add(("spender", acct(info.spender)));
    switch (info.expires_at) { case (?e) tx.add(("exp", #Nat(Nat64.toNat(e)))); case null {} };
    for (f in optFields(info.memo, ?info.created_at_time).vals()) tx.add(f);
    #Ok(block<system>("37approve_coll", Buffer.toArray(tx)));
  };

  public shared ({ caller }) func icrc37_revoke_token_approvals(args : [T.RevokeTokenApprovalArg]) : async [?T.RevokeTokenApprovalResult] {
    if (args.size() > MAX_REVOKE) return [?#Err(#GenericBatchError({ error_code = 1; message = "At most " # Nat.toText(MAX_REVOKE) # " revocations per call" }))];
    let out = Buffer.Buffer<?T.RevokeTokenApprovalResult>(args.size());
    for (a in args.vals()) {
      if (not rateTake(caller, "nft_update")) { out.add(?#Err(#GenericBatchError({ error_code = 13; message = RATE_LIMITED }))); return Buffer.toArray(out) };
      out.add(?revokeTokenOne<system>(caller, a));
    };
    Buffer.toArray(out);
  };

  func revokeTokenOne<system>(caller : Principal, a : T.RevokeTokenApprovalArg) : T.RevokeTokenApprovalResult {
    if (not memoOk(a.memo)) return #Err(#GenericError({ error_code = 2; message = "The memo is longer than " # Nat.toText(MAX_MEMO) # " bytes" }));
    switch (checkTime(a.created_at_time)) { case (?#TooOld) return #Err(#TooOld); case (?#CreatedInFuture x) return #Err(#CreatedInFuture x); case null {} };
    let owner : Account = { owner = caller; subaccount = a.from_subaccount };
    let ?o = Map.get(owners, Map.nhash, a.token_id) else return #Err(#NonExistingTokenId);
    if (not sameAccount(o, owner)) return #Err(#Unauthorized);
    let live = liveTokenApprovals(a.token_id); // expired ones are gone, not revocable
    let keep = switch (a.spender) { case (?s) Array.filter<T.ApprovalInfo>(live, func(x) = not sameAccount(x.spender, s)); case null [] };
    if (keep.size() == live.size()) return #Err(#ApprovalDoesNotExist);
    if (keep.size() == 0) Map.delete(token_approvals, Map.nhash, a.token_id) else Map.set(token_approvals, Map.nhash, a.token_id, keep);
    let tx = Buffer.Buffer<(Text, Value)>(5);
    tx.add(("tid", #Nat(a.token_id)));
    tx.add(("from", acct(owner)));
    switch (a.spender) { case (?s) tx.add(("spender", acct(s))); case null {} };
    for (f in optFields(a.memo, a.created_at_time).vals()) tx.add(f);
    #Ok(block<system>("37revoke", Buffer.toArray(tx)));
  };

  public shared ({ caller }) func icrc37_revoke_collection_approvals(args : [T.RevokeCollectionApprovalArg]) : async [?T.RevokeCollectionApprovalResult] {
    if (args.size() > MAX_REVOKE) return [?#Err(#GenericBatchError({ error_code = 1; message = "At most " # Nat.toText(MAX_REVOKE) # " revocations per call" }))];
    let out = Buffer.Buffer<?T.RevokeCollectionApprovalResult>(args.size());
    for (a in args.vals()) {
      if (not rateTake(caller, "nft_update")) { out.add(?#Err(#GenericBatchError({ error_code = 13; message = RATE_LIMITED }))); return Buffer.toArray(out) };
      out.add(?revokeCollectionOne<system>(caller, a));
    };
    Buffer.toArray(out);
  };

  func revokeCollectionOne<system>(caller : Principal, a : T.RevokeCollectionApprovalArg) : T.RevokeCollectionApprovalResult {
    if (not memoOk(a.memo)) return #Err(#GenericError({ error_code = 2; message = "The memo is longer than " # Nat.toText(MAX_MEMO) # " bytes" }));
    switch (checkTime(a.created_at_time)) { case (?#TooOld) return #Err(#TooOld); case (?#CreatedInFuture x) return #Err(#CreatedInFuture x); case null {} };
    let owner : Account = { owner = caller; subaccount = a.from_subaccount };
    let live = liveCollApprovals(owner);
    let keep = switch (a.spender) { case (?s) Array.filter<T.ApprovalInfo>(live, func(x) = not sameAccount(x.spender, s)); case null [] };
    if (keep.size() == live.size()) return #Err(#ApprovalDoesNotExist);
    if (keep.size() == 0) Map.delete(coll_approvals, Map.thash, accountKey(owner)) else Map.set(coll_approvals, Map.thash, accountKey(owner), keep);
    let tx = Buffer.Buffer<(Text, Value)>(4);
    tx.add(("from", acct(owner)));
    switch (a.spender) { case (?s) tx.add(("spender", acct(s))); case null {} };
    for (f in optFields(a.memo, a.created_at_time).vals()) tx.add(f);
    #Ok(block<system>("37revoke_coll", Buffer.toArray(tx)));
  };

  public shared ({ caller }) func icrc37_transfer_from(args : [T.TransferFromArg]) : async [?T.TransferFromResult] {
    if (args.size() > MAX_UPDATE_BATCH) return [?#Err(#GenericBatchError({ error_code = 1; message = "At most " # Nat.toText(MAX_UPDATE_BATCH) # " transfers per call" }))];
    let out = Buffer.Buffer<?T.TransferFromResult>(args.size());
    for (a in args.vals()) {
      if (not rateTake(caller, "nft_update")) { out.add(?#Err(#GenericBatchError({ error_code = 13; message = RATE_LIMITED }))); return Buffer.toArray(out) };
      out.add(?transferFromOne<system>(caller, a));
    };
    Buffer.toArray(out);
  };

  func transferFromOne<system>(caller : Principal, a : T.TransferFromArg) : T.TransferFromResult {
    if (not memoOk(a.memo)) return #Err(#GenericError({ error_code = 2; message = "The memo is longer than " # Nat.toText(MAX_MEMO) # " bytes" }));
    switch (checkTime(a.created_at_time)) { case (?#TooOld) return #Err(#TooOld); case (?#CreatedInFuture x) return #Err(#CreatedInFuture x); case null {} };
    if (not validSub(a.spender_subaccount) or not validSub(a.from.subaccount) or not validSub(a.to.subaccount)) return #Err(#GenericError({ error_code = 3; message = "A subaccount must be 32 bytes" }));
    let key = switch (a.created_at_time) {
      case (?t) {
        let k = dedupKey("icrc37_transfer_from", caller, to_candid (a));
        switch (dedupFind(k)) { case (?i) return #Err(#Duplicate({ duplicate_of = i })); case null {} };
        if (not dedupRoom()) return #Err(#GenericError({ error_code = 12; message = DEDUP_FULL }));
        ?(k, t);
      };
      case null null;
    };
    if (Principal.isAnonymous(a.to.owner) or a.to.owner == self()) return #Err(#InvalidRecipient);
    let spender : Account = { owner = caller; subaccount = a.spender_subaccount };
    let ?o = Map.get(owners, Map.nhash, a.token_id) else return #Err(#NonExistingTokenId);
    if (not sameAccount(o, a.from)) return #Err(#Unauthorized);
    if (not isApproved(spender, o, a.token_id)) return #Err(#Unauthorized);
    if (sameAccount(o, a.to)) return #Err(#InvalidRecipient);
    let i = moveToken<system>(a.token_id, o, a.to, ?spender, a.memo, a.created_at_time);
    switch (key) { case (?(k, t)) dedupAdd(k, i, t); case null {} };
    #Ok(i);
  };

  // ---------------------------------------------------------------------------------------------
  // The load: collection, manifest, mint (admins, until frozen / locked)
  // ---------------------------------------------------------------------------------------------

  public shared ({ caller }) func set_collection(u : T.CollectionUpdate) : async { #ok; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    if (metadata_frozen) return #err("The metadata is frozen");
    switch (u.name) { case (?v) if (v.size() == 0 or v.size() > MAX_NAME) return #err("The name must have 1 to " # Nat.toText(MAX_NAME) # " characters"); case null {} };
    switch (u.symbol) { case (?v) if (v.size() == 0 or v.size() > MAX_SYMBOL) return #err("The symbol must have 1 to " # Nat.toText(MAX_SYMBOL) # " characters"); case null {} };
    switch (u.description) { case (??v) if (v.size() > MAX_DESCRIPTION) return #err("The description is too long"); case _ {} };
    switch (u.logo) { case (??v) if (v.size() > MAX_LOGO) return #err("The logo URL is too long"); case _ {} };
    switch (u.supply_cap) {
      case (??c) if (c < totalSupply()) return #err("The supply cap is below the tokens already minted");
      case (?null) if (supply_cap != null) return #err("A supply cap, once set, can only be lowered");
      case null {};
    };
    switch (u.supply_cap, supply_cap) { case (??c, ?old) if (c > old) return #err("A supply cap, once set, can only be lowered"); case _ {} };
    if (minting_locked and u.supply_cap != null) return #err("Minting is locked: the supply is final");
    switch (u.name) { case (?v) { name := v; configBlock<system>(caller, "name", #Text(v)) }; case null {} };
    switch (u.symbol) { case (?v) { symbol := v; configBlock<system>(caller, "symbol", #Text(v)) }; case null {} };
    switch (u.description) { case (?v) { description := v; configBlock<system>(caller, "description", #Text(Option.get(v, ""))) }; case null {} };
    switch (u.logo) { case (?v) { logo := v; configBlock<system>(caller, "logo", #Text(Option.get(v, ""))) }; case null {} };
    switch (u.supply_cap) { case (??c) { supply_cap := ?c; configBlock<system>(caller, "supply_cap", #Nat(c)) }; case _ {} };
    #ok;
  };

  /// The SHA-256 of the manifest: entries in token order, each token id (8 bytes, big endian)
  /// followed by the 32-byte hash. Published in the proposal so anyone can check the on-chain art.
  func manifestDigest(entries : [(Nat, Blob)]) : Blob {
    let d = Sha256.Digest(#sha256);
    for ((id, h) in entries.vals()) {
      var x = id;
      let be = Array.init<Nat8>(8, 0);
      var i = 8;
      while (i > 0) { i -= 1; be[i] := Nat8.fromNat(x % 256); x /= 256 };
      d.writeArray(Array.freeze(be));
      d.writeBlob(h);
    };
    d.sum();
  };
  func manifestSorted() : [(Nat, Blob)] = Array.sort<(Nat, Blob)>(Map.toArray(manifest), func(a, b) = Nat.compare(a.0, b.0));

  /// The SHA-256 of every original image, by token id. Set once, before the originals are
  /// uploaded; an original whose hash differs is refused.
  public shared ({ caller }) func set_image_manifest(entries : [(Nat, Blob)]) : async { #ok : Blob; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    if (manifest_hash != null) return #err("The manifest is set already (it is set once)");
    if (entries.size() == 0 or entries.size() > MAX_MANIFEST) return #err("The manifest must have 1 to " # Nat.toText(MAX_MANIFEST) # " entries");
    let seen = Map.new<Nat, Blob>();
    for ((id, h) in entries.vals()) {
      if (h.size() != 32) return #err("Token " # Nat.toText(id) # ": a SHA-256 has 32 bytes");
      if (Map.has(seen, Map.nhash, id)) return #err("Token " # Nat.toText(id) # " is listed twice");
      Map.set(seen, Map.nhash, id, h);
    };
    for ((id, h) in Map.entries(seen)) Map.set(manifest, Map.nhash, id, h);
    let digest = manifestDigest(manifestSorted());
    manifest_hash := ?digest;
    ignore block<system>("sneednft_config", [("caller", pv(caller)), ("key", #Text("image_manifest")), ("value", #Blob(digest)), ("entries", #Nat(entries.size()))]);
    log_info(caller, cid(), "Image manifest set: " # Nat.toText(entries.size()) # " entries, sha256 " # Hash.toHex(digest));
    #ok(digest);
  };

  public query func image_manifest_hash() : async ?Blob { manifest_hash };
  public query func get_image_manifest(prev : ?Nat, take : ?Nat) : async [(Nat, Blob)] {
    let ids = page(Array.map<(Nat, Blob), Nat>(manifestSorted(), func(e) = e.0), prev, take);
    Array.map<Nat, (Nat, Blob)>(ids, func(id) = (id, Option.get(Map.get(manifest, Map.nhash, id), "" : Blob)));
  };

  func cardUrl(id : Nat) : Text = "https://" # Principal.toText(self()) # ".icp0.io/card/" # Nat.toText(id) # ".jpg";

  /// The token's metadata with `image` (this canister's URL) and `image_sha256` (the manifest's
  /// hash, hex) set when the manifest lists the token.
  func withImageKeys(id : Nat, entries : [(Text, Value)]) : [(Text, Value)] {
    switch (Map.get(manifest, Map.nhash, id)) {
      case null entries;
      case (?h) {
        let rest = Array.filter<(Text, Value)>(entries, func((k, _)) = k != "image" and k != "image_sha256");
        Array.append(rest, [("image", #Text(cardUrl(id))), ("image_sha256", #Text(Hash.toHex(h)))]);
      };
    };
  };

  /// Batch mint (and, before freeze_metadata, metadata replacement with `override`): the shape of
  /// icrc7-mo's set_nfts. Admins only, until lock_minting.
  public shared ({ caller }) func icrcX_mint(reqs : [T.SetNFTItemRequest]) : async [T.SetNFTResult] {
    if (not isAdmin(caller)) return [#GenericError({ error_code = 1; message = "Admins only" })];
    if (reqs.size() > MAX_MINT_BATCH) return [#GenericError({ error_code = 2; message = "At most " # Nat.toText(MAX_MINT_BATCH) # " tokens per call" })];
    let out = Buffer.Buffer<T.SetNFTResult>(reqs.size());
    for (r in reqs.vals()) out.add(mintOne<system>(caller, r));
    Buffer.toArray(out);
  };

  func mintOne<system>(caller : Principal, r : T.SetNFTItemRequest) : T.SetNFTResult {
    if (not memoOk(r.memo)) return #Err(#GenericError({ error_code = 3; message = "The memo is longer than " # Nat.toText(MAX_MEMO) # " bytes" }));
    switch (checkTime(r.created_at_time)) { case (?#TooOld) return #Err(#TooOld); case (?#CreatedInFuture x) return #Err(#CreatedInFuture x); case null {} };
    let #Map(entries) = r.metadata else return #Err(#GenericError({ error_code = 4; message = "The metadata must be a Map" }));
    let meta = withImageKeys(r.token_id, entries);
    if ((to_candid (meta)).size() > MAX_META_BYTES) return #Err(#GenericError({ error_code = 5; message = "The metadata is larger than " # Nat.toText(MAX_META_BYTES) # " bytes" }));
    let metaValue : Value = #Map([("icrc7:token_metadata", #Map(meta))]);
    if (Map.has(owners, Map.nhash, r.token_id)) {
      if (not r.override) return #Err(#TokenExists);
      if (metadata_frozen) return #Err(#GenericError({ error_code = 6; message = "The metadata is frozen" }));
      Map.set(metas, Map.nhash, r.token_id, meta);
      let tx = Array.append<(Text, Value)>([("tid", #Nat(r.token_id)), ("from", acct({ owner = caller; subaccount = null })), ("meta", metaValue)], optFields(r.memo, r.created_at_time));
      return #Ok(?block<system>("7update_token", tx));
    };
    if (minting_locked) return #Err(#GenericError({ error_code = 7; message = "Minting is locked" }));
    if (r.token_id == 0) return #Err(#GenericError({ error_code = 8; message = "Token ids start at 1" }));
    switch (supply_cap) { case (?c) if (totalSupply() >= c) return #Err(#GenericError({ error_code = 9; message = "The supply cap is reached" })); case null {} };
    let to = switch (r.owner) { case (?a) a; case null swapAccount() };
    if (not validSub(to.subaccount)) return #Err(#GenericError({ error_code = 10; message = "A subaccount must be 32 bytes" }));
    if (Principal.isAnonymous(to.owner)) return #Err(#GenericError({ error_code = 11; message = "Cannot mint to the anonymous principal" }));
    Map.set(metas, Map.nhash, r.token_id, meta);
    setOwner(r.token_id, to);
    all_ids := insertSorted(all_ids, r.token_id);
    let tx = Array.append<(Text, Value)>([("tid", #Nat(r.token_id)), ("to", acct(to)), ("meta", metaValue)], optFields(r.memo, r.created_at_time));
    #Ok(?block<system>("7mint", tx));
  };

  /// One-way: no more metadata changes, image uploads or collection changes. Every token the
  /// manifest lists must be minted and have its three images.
  public shared ({ caller }) func freeze_metadata() : async { #ok; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    if (metadata_frozen) return #err("The metadata is frozen already");
    if (name == "" or symbol == "") return #err("Set the collection's name and symbol first");
    if (Map.size(uploads) > 0) return #err(Nat.toText(Map.size(uploads)) # " uploads are still open: finish or abort them first");
    var missing = 0;
    var first : ?Text = null;
    let sizes : [T.ImageSize] = [#orig, #web, #thumb];
    for (id in Map.keys(manifest)) {
      for (s in sizes.vals()) {
        let k = imageKey(#card { token_id = id; size = s });
        if (not Map.has(images, Map.thash, k)) { missing += 1; if (first == null) first := ?k };
      };
      if (not Map.has(owners, Map.nhash, id)) { missing += 1; if (first == null) first := ?("token " # Nat.toText(id) # " (not minted)") };
    };
    if (missing > 0) return #err(Nat.toText(missing) # " images or tokens are missing, e.g. " # Option.get(first, ""));
    metadata_frozen := true;
    configBlock<system>(caller, "metadata_frozen", #Nat(1));
    log_info(caller, cid(), "Metadata frozen");
    #ok;
  };

  /// One-way: the supply is final.
  public shared ({ caller }) func lock_minting() : async { #ok; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    if (minting_locked) return #err("Minting is locked already");
    // the swap delivers every token from the swap account: all of them must be there
    for ((id, o) in Map.entries(owners)) {
      if (not sameAccount(o, swapAccount())) return #err("Token " # Nat.toText(id) # " is not in the swap account: every minted token must be there before minting is locked");
    };
    minting_locked := true;
    configBlock<system>(caller, "minting_locked", #Nat(totalSupply()));
    log_info(caller, cid(), "Minting locked at " # Nat.toText(totalSupply()) # " tokens");
    #ok;
  };

  // ---------------------------------------------------------------------------------------------
  // Images: chunked upload into the region, SHA-256 checked on finish
  // ---------------------------------------------------------------------------------------------

  func uploadInfo(u : Upload) : T.UploadInfo = { id = u.id; target = u.target; size = u.size; received = u.received; content_type = u.content_type; started_at = u.started_at; by = u.by };
  func imageInfo(i : Image) : T.ImageInfo = { target = i.target; size = i.size; sha256 = i.sha256; content_type = i.content_type; uploaded_at = i.uploaded_at; uploaded_by = i.uploaded_by };

  /// Reserves `size` bytes at the end of the region.
  func reserve(size : Nat) : ?Nat {
    let offset = region_used;
    let need = offset + size;
    let have = Nat64.toNat(Region.size(image_region)) * PAGE;
    if (need > have) {
      let more = (need - have + PAGE - 1) / PAGE;
      if (Region.grow(image_region, Nat64.fromNat(more)) == 0xFFFF_FFFF_FFFF_FFFF) return null;
    };
    region_used := need;
    ?offset;
  };
  /// Gives back the bytes of an upload or image no longer used: the region's tail is reused,
  /// anything else is counted as wasted.
  func release(offset : Nat, size : Nat) {
    if (offset + size == region_used) region_used := offset else wasted_bytes += size;
  };

  func beginImpl(caller : Principal, a : T.UploadBegin) : { #ok : Nat; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    if (metadata_frozen) return #err("The metadata is frozen");
    if (Map.size(uploads) >= MAX_UPLOADS) return #err("At most " # Nat.toText(MAX_UPLOADS) # " uploads at once");
    if (Array.find<Text>(CONTENT_TYPES, func(c) = c == a.content_type) == null) return #err("Content type must be one of image/jpeg, image/png, image/webp, image/gif");
    if (a.size == 0 or a.size > maxImage(a.target)) return #err("The size must be 1 to " # Nat.toText(maxImage(a.target)) # " bytes");
    switch (a.target) {
      case (#card { token_id }) if (not Map.has(manifest, Map.nhash, token_id)) return #err("Token " # Nat.toText(token_id) # " is not in the image manifest");
      case (#logo) {};
    };
    let ?offset = reserve(a.size) else return #err("Out of stable memory");
    let id = next_upload;
    next_upload += 1;
    Map.set(uploads, Map.nhash, id, { id; target = a.target; offset; size = a.size; received = 0; content_type = a.content_type; started_at = Time.now(); by = caller });
    #ok(id);
  };

  func chunkImpl(caller : Principal, id : Nat, offset : Nat, bytes : Blob) : { #ok : Nat; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    let ?u = Map.get(uploads, Map.nhash, id) else return #err("No upload " # Nat.toText(id));
    if (offset != u.received) return #err("Expected the chunk at offset " # Nat.toText(u.received));
    if (bytes.size() == 0 or bytes.size() > MAX_UPLOAD_CHUNK) return #err("A chunk has 1 to " # Nat.toText(MAX_UPLOAD_CHUNK) # " bytes");
    if (offset + bytes.size() > u.size) return #err("The chunk goes past the declared size");
    Region.storeBlob(image_region, Nat64.fromNat(u.offset + offset), bytes);
    let received = offset + bytes.size();
    Map.set(uploads, Map.nhash, id, { u with received });
    #ok(received);
  };

  func regionSha256(offset : Nat, size : Nat) : Blob {
    let d = Sha256.Digest(#sha256);
    var at = 0;
    while (at < size) {
      let n = Nat.min(HASH_PIECE, size - at);
      d.writeBlob(Region.loadBlob(image_region, Nat64.fromNat(offset + at), n));
      at += n;
    };
    d.sum();
  };

  func finishImpl<system>(caller : Principal, id : Nat) : { #ok : T.ImageInfo; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    if (metadata_frozen) return #err("The metadata is frozen");
    let ?u = Map.get(uploads, Map.nhash, id) else return #err("No upload " # Nat.toText(id));
    if (u.received != u.size) return #err("Received " # Nat.toText(u.received) # " of " # Nat.toText(u.size) # " bytes");
    let h = regionSha256(u.offset, u.size);
    let c = cid();
    switch (u.target) {
      case (#card { token_id; size = #orig }) {
        let expected = Option.get(Map.get(manifest, Map.nhash, token_id), "" : Blob);
        if (h != expected) {
          Map.delete(uploads, Map.nhash, id);
          release(u.offset, u.size);
          log_error(caller, c, "Upload " # Nat.toText(id) # " (" # imageKey(u.target) # ") refused: SHA-256 " # Hash.toHex(h) # ", the manifest has " # Hash.toHex(expected));
          return #err("SHA-256 mismatch: the image hashes to " # Hash.toHex(h) # ", the manifest has " # Hash.toHex(expected) # " (upload discarded)");
        };
      };
      case _ {};
    };
    let key = imageKey(u.target);
    switch (Map.get(images, Map.thash, key)) {
      case (?old) {
        // another size of the same card with the same bytes and type has the same leaf: keep it
        let leaf = imageLeaf(old);
        var shared_ = false;
        for ((k, other) in Map.entries(images)) if (k != key and imageLeaf(other) == leaf) shared_ := true;
        if (not shared_) cert_tree := MerkleTree.delete(cert_tree, leaf);
        wasted_bytes += old.size;
      };
      case null {};
    };
    let img : Image = { target = u.target; offset = u.offset; size = u.size; sha256 = h; content_type = u.content_type; uploaded_at = Time.now(); uploaded_by = caller };
    Map.set(images, Map.thash, key, img);
    Map.delete(uploads, Map.nhash, id);
    cert_tree := MerkleTree.put(cert_tree, imageLeaf(img), "");
    ignore block<system>("sneednft_image", [("caller", pv(caller)), ("target", #Text(key)), ("sha256", #Blob(h)), ("size", #Nat(u.size)), ("content_type", #Text(u.content_type))]);
    log_info(caller, c, "Image " # key # " stored: " # Nat.toText(u.size) # " bytes, sha256 " # Hash.toHex(h));
    #ok(imageInfo(img));
  };

  public shared ({ caller }) func image_upload_begin(a : T.UploadBegin) : async { #ok : Nat; #err : Text } { beginImpl(caller, a) };
  /// Chunks are sent in order: `offset` is the number of bytes already received.
  public shared ({ caller }) func image_upload_chunk(id : Nat, offset : Nat, bytes : Blob) : async { #ok : Nat; #err : Text } {
    chunkImpl(caller, id, offset, bytes);
  };
  /// Computes the image's SHA-256; an original must match the manifest. The image then replaces
  /// any earlier one for the same target and is served (and certified) at once.
  public shared ({ caller }) func image_upload_finish(id : Nat) : async { #ok : T.ImageInfo; #err : Text } { finishImpl<system>(caller, id) };

  /// A whole image of at most one chunk in one call (web sizes, thumbnails): begin, chunk, finish.
  public shared ({ caller }) func image_upload(target : T.ImageTarget, content_type : Text, bytes : Blob) : async { #ok : T.ImageInfo; #err : Text } {
    let id = switch (beginImpl(caller, { target; size = bytes.size(); content_type })) { case (#ok i) i; case (#err e) return #err(e) };
    switch (chunkImpl(caller, id, 0, bytes)) {
      case (#ok _) {};
      case (#err e) {
        switch (Map.get(uploads, Map.nhash, id)) { case (?u) { Map.delete(uploads, Map.nhash, id); release(u.offset, u.size) }; case null {} };
        return #err(e);
      };
    };
    finishImpl<system>(caller, id);
  };

  public shared ({ caller }) func image_upload_abort(id : Nat) : async { #ok; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    let ?u = Map.get(uploads, Map.nhash, id) else return #err("No upload " # Nat.toText(id));
    Map.delete(uploads, Map.nhash, id);
    release(u.offset, u.size);
    #ok;
  };

  public query func get_uploads() : async [T.UploadInfo] { Array.map<Upload, T.UploadInfo>(Iter.toArray(Map.vals(uploads)), uploadInfo) };
  public query func get_image_info(targets : [T.ImageTarget]) : async [?T.ImageInfo] {
    Array.map<T.ImageTarget, ?T.ImageInfo>(prefix(targets, MAX_QUERY_BATCH), func(t) = Option.map<Image, T.ImageInfo>(Map.get(images, Map.thash, imageKey(t)), imageInfo));
  };

  // ---------------------------------------------------------------------------------------------
  // The swap: addresses
  // ---------------------------------------------------------------------------------------------

  func derive(domain : Text, p : Principal) : Blob {
    let d = Sha256.Digest(#sha256);
    d.writeBlob(Text.encodeUtf8(domain));
    d.writeBlob(Principal.toBlob(p));
    d.sum();
  };
  /// swap_sub(p) = SHA-256("sdc-swap" ‖ p's bytes); proof_sub(p) = SHA-256("sdc-proof" ‖ p's bytes).
  func swapSub(p : Principal) : Blob = derive("sdc-swap", p);
  func proofSub(p : Principal) : Blob = derive("sdc-proof", p);
  func swapAddress(p : Principal) : Text = Ext.accountIdOf(self(), swapSub(p));

  /// The EXT account identifier (hex) to send p's old cards to: (this canister, swap_sub(p)).
  public query func swap_address(p : Principal) : async Text { swapAddress(p) };
  public query func swap_subaccount(p : Principal) : async Blob { swapSub(p) };
  /// Where a stuck wallet pays to prove its key for p: this canister's account with proof_sub(p),
  /// as an ICRC-1 account and as an account identifier (for the ICP ledger).
  public query func proof_address(p : Principal) : async { account : Account; account_id : Text } {
    { account = { owner = self(); subaccount = ?proofSub(p) }; account_id = Ext.accountIdOf(self(), proofSub(p)) };
  };

  // ---------------------------------------------------------------------------------------------
  // The swap: delivery (no awaits: the checks and the state change are one step)
  // ---------------------------------------------------------------------------------------------

  type Ext = actor { getRegistry : shared query () -> async [(Nat32, Text)] };

  /// The EXT registry: the cached copy when it is at most REGISTRY_TTL_NS old and `fresh` is not
  /// asked, else one read. At most one read runs at a time: a caller arriving during a read is
  /// told to come back (no parallel reads of a 1,000-entry registry, whoever calls).
  func readRegistry(fresh : Bool) : async* { #ok : [(Nat32, Text)]; #err : Text } {
    let now = Time.now();
    if (not fresh) switch (registry_cache) { case (?(at, r)) if (now - at <= REGISTRY_TTL_NS) return #ok(r); case null {} };
    switch (registry_reading_since) {
      case (?since) if (now - since < REGISTRY_CALL_NS) return #err("The EXT registry is being read for another claim: try again in a few seconds");
      case null {};
    };
    registry_reading_since := ?now;
    let e : Ext = actor (Principal.toText(ext_canister));
    let source = ext_canister;
    let r = try { await (with timeout = 60) e.getRegistry() } catch (err) {
      registry_reading_since := null;
      return #err("Could not read the EXT registry: " # Error.message(err));
    };
    registry_reading_since := null;
    registry_reads += 1;
    if (source == ext_canister) registry_cache := ?(Time.now(), r);
    #ok(r);
  };

  type Delivery = { #delivered : T.Delivered; #already; #unavailable };

  /// Delivers ICRC-7 token ext_index + 1 from the swap account to p, records the swap and logs
  /// 7xfer + dcswap. A card swapped before (by either method) is never delivered again.
  func deliver<system>(caller : Principal, c : Nat, idx : Nat32, bearer : Text, p : Principal, method : T.SwapMethod, proof : ?T.Proof) : Delivery {
    if (Map.has(swaps, Map.n32hash, idx)) return #already;
    let tid = Nat32.toNat(idx) + 1;
    switch (Map.get(owners, Map.nhash, tid)) {
      case (?o) if (not sameAccount(o, swapAccount())) {
        log_error(caller, c, "EXT card " # Nat32.toText(idx) # ": token " # Nat.toText(tid) # " is not in the swap account");
        return #unavailable;
      };
      case null {
        log_error(caller, c, "EXT card " # Nat32.toText(idx) # ": token " # Nat.toText(tid) # " does not exist");
        return #unavailable;
      };
    };
    let to : Account = { owner = p; subaccount = null };
    let xfer = moveToken<system>(tid, swapAccount(), to, null, null, null);
    let tx = Buffer.Buffer<(Text, Value)>(9);
    tx.add(("caller", pv(caller)));
    tx.add(("recipient", pv(p)));
    tx.add(("ext_index", #Nat(Nat32.toNat(idx))));
    tx.add(("tid", #Nat(tid)));
    tx.add(("method", #Text(switch method { case (#send) "send"; case (#proof) "proof" })));
    tx.add(("bearer", #Text(bearer)));
    tx.add(("xfer", #Nat(xfer)));
    switch (proof) {
      case (?pr) { tx.add(("ledger", pv(pr.ledger))); tx.add(("ledger_block", #Nat(pr.block_index))) };
      case null {};
    };
    let b = block<system>("dcswap", Buffer.toArray(tx));
    Map.set(swaps, Map.n32hash, idx, { ext_index = idx; token_id = tid; recipient = p; method; bearer; proof = Option.map<T.Proof, Text>(proof, func(x) = x.key); at = Time.now(); block = b });
    if (method == #proof) retired_count += 1;
    log_info(caller, c, "EXT card " # Nat32.toText(idx) # " swapped (" # (switch method { case (#send) "send"; case (#proof) "proof" }) # ") to " # Principal.toText(p) # ": token " # Nat.toText(tid));
    #delivered({ ext_index = idx; token_id = tid; block = xfer });
  };

  func deliverAll<system>(caller : Principal, c : Nat, registry : [(Nat32, Text)], bearers : [Text], p : Principal, method : T.SwapMethod, proof : ?T.Proof) : T.ClaimOutcome {
    let delivered = Buffer.Buffer<T.Delivered>(8);
    let already = Buffer.Buffer<Nat32>(8);
    let unavailable = Buffer.Buffer<Nat32>(0);
    let mine = Array.filter<(Nat32, Text)>(registry, func((_, h)) = Array.find<Text>(bearers, func(b) = b == Text.toLowercase(h)) != null);
    for ((idx, h) in Array.sort<(Nat32, Text)>(mine, func(a, b) = Nat32.compare(a.0, b.0)).vals()) {
      switch (deliver<system>(caller, c, idx, Text.toLowercase(h), p, method, proof)) {
        case (#delivered d) delivered.add(d);
        case (#already) already.add(idx);
        case (#unavailable) unavailable.add(idx);
      };
    };
    { delivered = Buffer.toArray(delivered); already_swapped = Buffer.toArray(already); unavailable = Buffer.toArray(unavailable) };
  };

  func swapOpen() : ?Text {
    if (not minting_locked or not metadata_frozen) return ?"The swap opens when the collection's load is done (metadata frozen, minting locked)";
    if (swaps_paused) return ?"The swap is paused";
    null;
  };

  /// Delivers every old card held by p's swap address and not swapped yet (anyone may call it for
  /// p; Sneed Hub does it for the user). The EXT canister's registry decides who holds what.
  public shared ({ caller }) func claim_swap(p : Principal) : async T.ClaimResult {
    if (Principal.isAnonymous(p) or p == self()) return #err("Not a valid recipient");
    switch (swapOpen()) { case (?e) return #err(e); case null {} };
    if (not rateTake(caller, "claim")) return #err("Too many claims: try again in a minute");
    if (not rateTake(self(), "claims_global")) return #err("Too many claims right now: try again in a minute");
    let c = cid();
    let addr = swapAddress(p);
    let registry = switch (await* readRegistry(false)) {
      case (#ok r) r;
      case (#err e) { log_error(caller, c, "claim_swap for " # Principal.toText(p) # ": " # e); return #err(e) };
    };
    // also cards sent to p's proof address by mistake: that account is p's too
    let r = deliverAll<system>(caller, c, registry, [addr, Ext.accountIdOf(self(), proofSub(p))], p, #send, null);
    log_info(caller, c, "claim_swap for " # Principal.toText(p) # " at " # addr # ": " # Nat.toText(r.delivered.size()) # " delivered, " # Nat.toText(r.already_swapped.size()) # " swapped before, " # Nat.toText(r.unavailable.size()) # " unavailable");
    #ok(r);
  };

  // ---------------------------------------------------------------------------------------------
  // The swap: proof by payment
  // ---------------------------------------------------------------------------------------------

  func proofLedger(l : Principal) : ?T.ProofLedger = Array.find<T.ProofLedger>(proof_ledgers, func(x) = x.ledger == l);
  func proofKey(l : Principal, i : Nat) : Text = Principal.toText(l) # ":" # Nat.toText(i);
  /// The refund's memo: SHA-256("sdc-refund" ‖ "<ledger>:<block>"), the same on every attempt.
  func refundMemo(key : Text) : Blob {
    let d = Sha256.Digest(#sha256);
    d.writeBlob(Text.encodeUtf8("sdc-refund"));
    d.writeBlob(Text.encodeUtf8(key));
    d.sum();
  };

  /// The EXT holders a payment's sender proves: the sender is a key (see claim_by_proof), which
  /// owns every subaccount of its principal, so its default account and the one it paid from.
  func bearersOf(a : Account) : [Text] {
    let d = Ext.accountId(a.owner);
    switch (a.subaccount) { case (?sub) { let x = Ext.accountIdOf(a.owner, sub); if (x == d) [d] else [d, x] }; case null [d] };
  };

  /// Proof by payment (spec §3.3.1): `block_index` on `ledger` (allow-listed) must be a plain
  /// transfer to p's proof address that has not been used before. Every unswapped old card whose
  /// bearer is the payment's sender is delivered to p and retired (the EXT card stays in the
  /// sender's wallet and is never swapped again), and the payment minus the ledger fee goes back
  /// to the sender. Anyone may call it for p.
  ///
  /// The sender must be a wallet's key (a self-authenticating principal), never a canister: a
  /// canister pays for whoever it serves (an exchange, a marketplace, an escrow). An ICRC-3 block
  /// names the sender's principal. The ICP ledger records only an account identifier, so for an
  /// ICP payment `sender` gives the principal and subaccount it was made from: they must hash to
  /// exactly that identifier (and the principal must be a key).
  public shared ({ caller }) func claim_by_proof(p : Principal, ledger : Principal, block_index : Nat, sender : ?Account) : async T.ProofResult {
    if (Principal.isAnonymous(p) or p == self()) return #err("Not a valid recipient");
    switch (swapOpen()) { case (?e) return #err(e); case null {} };
    let ?pl = proofLedger(ledger) else return #err("This ledger is not accepted for proofs");
    let key = proofKey(ledger, block_index);
    if (Map.has(proofs, Map.thash, key)) return #err("This payment was used already");
    if (not rateTake(caller, "proof")) return #err("Too many proofs: try again in a minute");
    if (not rateTake(self(), "claims_global")) return #err("Too many claims right now: try again in a minute");
    let c = cid();
    let to : Account = { owner = self(); subaccount = ?proofSub(p) };
    let toAid = Ext.accountIdOf(self(), proofSub(p));
    let pay = switch (await* Proof.readPayment(pl.kind, ledger, block_index, to, hexBlob(toAid))) {
      case (#ok x) x;
      case (#err e) { log_error(caller, c, "claim_by_proof " # key # " for " # Principal.toText(p) # ": " # e); return #err(e) };
    };
    // the paying account, with its principal: from the block, or (ICP) from `sender`, checked
    let payer : Account = switch (pay.sender) {
      case (#account a) a;
      case (#account_id aid) {
        let ?pre = sender else return #err("An ICP payment records only an account identifier: give the paying wallet's principal (and subaccount, if it paid from one) as sender");
        let sub = switch (pre.subaccount) { case (?s) s; case null Blob.fromArray(Array.tabulate<Nat8>(32, func _ = 0)) };
        if (sub.size() != 32 or Ext.accountIdOf(pre.owner, sub) != Hash.toHex(aid)) return #err("The sender given is not the account the payment came from");
        { owner = pre.owner; subaccount = normSub(?sub) };
      };
    };
    if (payer.owner == self()) return #err("A payment from this canister proves nothing");
    // a canister's payments are made by its code for whoever it serves (an exchange, a
    // marketplace, an escrow), not by the holder of a key: only a wallet's key proves anything
    if (not selfAuthenticating(payer.owner)) return #err("The payment must come from a wallet's own key (a self-authenticating principal), not from a canister");
    let fee = switch (await* Proof.fee(ledger)) { case (#ok f) f; case (#err e) { log_error(caller, c, "claim_by_proof " # key # ": " # e); return #err(e) } };
    // a fresh read: the cards the payer holds right now (one read at a time, see readRegistry)
    let registry = switch (await* readRegistry(true)) {
      case (#ok r) r;
      case (#err e) { log_error(caller, c, "claim_by_proof " # key # ": " # e); return #err(e) };
    };
    // from here on no await until the record is written: a racing call with the same payment stops here
    if (Map.has(proofs, Map.thash, key)) return #err("This payment was used already");
    if (proofLedger(ledger) == null) return #err("This ledger is not accepted for proofs");
    switch (swapOpen()) { case (?e) return #err(e); case null {} };
    let refund_amount : Nat = if (pay.amount > fee) pay.amount - fee else 0;
    let base : T.Proof = {
      key; ledger; block_index; recipient = p; sender = pay.sender; amount = pay.amount; fee; refund_amount;
      refund_created_at = Nat64.fromNat(nowNat()); refund = if (refund_amount == 0) #none else #pending; refund_attempted_at = null;
      delivered = []; at = Time.now(); by = caller;
    };
    Map.set(proofs, Map.thash, key, base);
    let r = deliverAll<system>(caller, c, registry, bearersOf(payer), p, #proof, ?base);
    let recorded = { base with delivered = r.delivered };
    Map.set(proofs, Map.thash, key, recorded);
    log_info(caller, c, "claim_by_proof " # key # " for " # Principal.toText(p) # " from " # debug_show (pay.sender) # ": " # Nat.toText(r.delivered.size()) # " delivered, " # Nat.toText(r.already_swapped.size()) # " swapped before; refund " # Nat.toText(refund_amount));
    if (refund_amount > 0) await* refund<system>(caller, key);
    #ok(Option.get(Map.get(proofs, Map.thash, key), recorded));
  };

  /// A principal derived from a public key (29 bytes ending in 0x02), as wallets' are.
  func selfAuthenticating(p : Principal) : Bool {
    let b = Blob.toArray(Principal.toBlob(p));
    b.size() == 29 and b[28] == 0x02;
  };

  func hexBlob(h : Text) : Blob {
    let cs = Iter.toArray(h.chars());
    let out = Buffer.Buffer<Nat8>(cs.size() / 2);
    func v(ch : Char) : Nat {
      let n = Nat32.toNat(Char.toNat32(ch));
      if (n >= 97) n - 87 else if (n >= 65) n - 55 else n - 48;
    };
    var i = 0;
    while (i + 1 < cs.size()) { out.add(Nat8.fromNat(v(cs[i]) * 16 + v(cs[i + 1]))); i += 2 };
    Blob.fromArray(Buffer.toArray(out));
  };

  /// One refund attempt of proof `key` (pending or failed). Always the same transfer, so the
  /// ledger deduplicates a retry of an attempt whose outcome was unknown.
  func refund<system>(caller : Principal, key : Text) : async* () {
    let ?pr = Map.get(proofs, Map.thash, key) else return;
    switch (pr.refund) {
      case (#pending or #failed _) {};
      case (#in_flight) if (not staleInFlight(pr)) return; // an attempt whose continuation never ran
      case _ return;
    };
    if (nowNat() > Nat64.toNat(pr.refund_created_at) + REFUND_RESEND_NS) {
      // the ledger would no longer recognise an earlier attempt: resending could pay twice
      Map.set(proofs, Map.thash, key, { pr with refund = #needs_admin("Too late to resend safely (the ledger's deduplication window is nearly over): check the ledger for an earlier refund before resetting it") });
      log_error(caller, cid(), "Refund of " # key # " needs an admin: past the resend window");
      return;
    };
    let ?pl = proofLedger(pr.ledger) else {
      Map.set(proofs, Map.thash, key, { pr with refund = #needs_admin("The ledger is no longer allow-listed") });
      return;
    };
    Map.set(proofs, Map.thash, key, { pr with refund = #in_flight; refund_attempted_at = ?Time.now() });
    let c = cid();
    let outcome = await* Proof.refund(pl.kind, pr.ledger, proofSub(pr.recipient), pr.sender, pr.refund_amount, pr.fee, refundMemo(key), pr.refund_created_at);
    let ?now = Map.get(proofs, Map.thash, key) else return;
    switch outcome {
      case (#done i) {
        Map.set(proofs, Map.thash, key, { now with refund = #done({ block = i }) });
        let to : Value = switch (pr.sender) { case (#account a) acct(a); case (#account_id aid) #Blob(aid) };
        ignore block<system>("dcrefund", [("caller", pv(caller)), ("ledger", pv(pr.ledger)), ("ledger_block", #Nat(pr.block_index)), ("to", to), ("amount", #Nat(pr.refund_amount)), ("fee", #Nat(pr.fee)), ("refund_block", #Nat(i))]);
        log_info(caller, c, "Refund of " # key # ": " # Nat.toText(pr.refund_amount) # " in block " # Nat.toText(i));
      };
      case (#failed e) {
        Map.set(proofs, Map.thash, key, { now with refund = #failed(e) });
        log_error(caller, c, "Refund of " # key # " failed: " # e);
      };
      case (#needs_admin e) {
        Map.set(proofs, Map.thash, key, { now with refund = #needs_admin(e) });
        log_error(caller, c, "Refund of " # key # " needs an admin: " # e);
      };
    };
  };

  /// An attempt marked in flight long after the bounded call must have answered: the canister
  /// trapped after the ledger call, so the outcome is unknown and the same transfer may be resent.
  func staleInFlight(pr : T.Proof) : Bool = switch (pr.refund_attempted_at) { case (?at) Time.now() - at > REFUND_STALE_NS; case null true };

  /// Retries a failed refund, or one stuck in flight (anyone; it only ever pays the original
  /// sender, with the same transfer, which the ledger deduplicates).
  public shared ({ caller }) func retry_refund(ledger : Principal, block_index : Nat) : async T.ProofResult {
    let key = proofKey(ledger, block_index);
    let ?pr = Map.get(proofs, Map.thash, key) else return #err("No proof with this payment");
    switch (pr.refund) {
      case (#pending or #failed _) {};
      case (#in_flight) if (not staleInFlight(pr)) return #err("A refund attempt is running");
      case _ return #err("Nothing to retry");
    };
    if (not rateTake(caller, "refund")) return #err("Too many retries: try again in a minute");
    await* refund<system>(caller, key);
    switch (Map.get(proofs, Map.thash, key)) { case (?x) #ok(x); case null #err("No proof with this payment") };
  };

  /// After an admin has checked on the ledger that no refund of this payment was made: a new
  /// created_at_time (and the current fee), then one attempt. For #needs_admin refunds only.
  public shared ({ caller }) func admin_reset_refund(ledger : Principal, block_index : Nat, checked_no_refund_on_ledger : Bool) : async T.ProofResult {
    if (not isAdmin(caller)) return #err("Admins only");
    if (not checked_no_refund_on_ledger) return #err("Check the ledger for an earlier refund first");
    let key = proofKey(ledger, block_index);
    let ?pr = Map.get(proofs, Map.thash, key) else return #err("No proof with this payment");
    switch (pr.refund) { case (#needs_admin _) {}; case _ return #err("Only a refund that needs an admin can be reset") };
    let fee = switch (await* Proof.fee(ledger)) { case (#ok f) f; case (#err e) return #err(e) };
    let ?again = Map.get(proofs, Map.thash, key) else return #err("No proof with this payment");
    switch (again.refund) { case (#needs_admin _) {}; case _ return #err("The refund changed meanwhile") };
    let refund_amount : Nat = if (again.amount > fee) again.amount - fee else 0;
    Map.set(proofs, Map.thash, key, { again with fee; refund_amount; refund_created_at = Nat64.fromNat(nowNat()); refund = if (refund_amount == 0) #none else #pending; refund_attempted_at = null });
    log_info(caller, cid(), "Refund of " # key # " reset by an admin (fee " # Nat.toText(fee) # ")");
    if (refund_amount > 0) await* refund<system>(caller, key);
    switch (Map.get(proofs, Map.thash, key)) { case (?x) #ok(x); case null #err("No proof with this payment") };
  };

  // ---- swap queries ----
  public query func get_swap(ext_index : Nat32) : async ?T.Swap { Map.get(swaps, Map.n32hash, ext_index) };
  public query func get_swaps(ext_indexes : [Nat32]) : async [?T.Swap] {
    Array.map<Nat32, ?T.Swap>(prefix(ext_indexes, MAX_TAKE), func(i) = Map.get(swaps, Map.n32hash, i));
  };
  func swapPage(filter : T.Swap -> Bool, prev : ?Nat32, take : ?Nat) : [T.Swap] {
    let n = Nat.min(Option.get(take, DEFAULT_TAKE), MAX_TAKE);
    let all = Array.sort<T.Swap>(Array.filter<T.Swap>(Iter.toArray(Map.vals(swaps)), filter), func(a, b) = Nat32.compare(a.ext_index, b.ext_index));
    let after = switch (prev) { case (?p) Array.filter<T.Swap>(all, func(s) = s.ext_index > p); case null all };
    prefix(after, n);
  };
  /// Every swap, by EXT index.
  public query func list_swaps(prev : ?Nat32, take : ?Nat) : async [T.Swap] { swapPage(func(_) = true, prev, take) };
  /// The retired EXT cards: swapped by proof, so the old card is still in a wallet but worthless
  /// (it can never be swapped again). Buyers of EXT cards check here.
  public query func list_retired(prev : ?Nat32, take : ?Nat) : async [T.Swap] { swapPage(func(s) = s.method == #proof, prev, take) };
  public query func get_proof(ledger : Principal, block_index : Nat) : async ?T.Proof { Map.get(proofs, Map.thash, proofKey(ledger, block_index)) };
  public query func list_proofs(start : Nat, take : ?Nat) : async [T.Proof] {
    let n = Nat.min(Option.get(take, DEFAULT_TAKE), MAX_TAKE);
    let all = Iter.toArray(Map.vals(proofs));
    if (start >= all.size()) [] else Array.subArray<T.Proof>(all, start, Nat.min(n, all.size() - start));
  };
  /// Proofs whose refund is not done (pending, failed, in flight or waiting for an admin).
  public query func pending_refunds() : async [T.Proof] {
    Array.filter<T.Proof>(Iter.toArray(Map.vals(proofs)), func(p) = switch (p.refund) { case (#none or #done _) false; case _ true });
  };

  // ---------------------------------------------------------------------------------------------
  // Admin settings (admins and, by dao_admin, Sneed DAO governance)
  // ---------------------------------------------------------------------------------------------

  func setProofLedgerImpl<system>(caller : Principal, l : T.ProofLedger) {
    proof_ledgers := Array.append(Array.filter<T.ProofLedger>(proof_ledgers, func(x) = x.ledger != l.ledger), [l]);
    ignore block<system>("sneednft_config", [("caller", pv(caller)), ("key", #Text("proof_ledger")), ("value", pv(l.ledger)), ("kind", #Text(switch (l.kind) { case (#icrc3) "icrc3"; case (#icp) "icp" }))]);
  };
  func removeProofLedgerImpl<system>(caller : Principal, l : Principal) : Bool {
    if (proofLedger(l) == null) return false;
    proof_ledgers := Array.filter<T.ProofLedger>(proof_ledgers, func(x) = x.ledger != l);
    ignore block<system>("sneednft_config", [("caller", pv(caller)), ("key", #Text("proof_ledger_removed")), ("value", pv(l))]);
    true;
  };
  func setExtImpl<system>(caller : Principal, p : Principal) { ext_canister := p; registry_cache := null; configBlock<system>(caller, "ext_canister", pv(p)) };
  func setPausedImpl<system>(caller : Principal, b : Bool) { swaps_paused := b; configBlock<system>(caller, "swaps_paused", #Nat(if b 1 else 0)) };
  func addAdminImpl<system>(caller : Principal, p : Principal) : Bool {
    if (Array.find<Principal>(admins, func(a) = a == p) != null) return false;
    admins := Array.append(admins, [p]);
    configBlock<system>(caller, "admin_added", pv(p));
    true;
  };
  func removeAdminImpl<system>(caller : Principal, p : Principal) : Bool {
    if (Array.find<Principal>(admins, func(a) = a == p) == null) return false;
    admins := Array.filter<Principal>(admins, func(a) = a != p);
    configBlock<system>(caller, "admin_removed", pv(p));
    true;
  };
  func setDedupCapImpl<system>(caller : Principal, n : Nat) { dedup_cap := n; configBlock<system>(caller, "dedup_cap", #Nat(n)) };
  func setIcrc3Impl<system>(caller : Principal, u : T3.SettingsUpdate) : { #Ok : T3.Settings; #Err : Text } {
    switch (Icrc3Log.applySettings(icrc3, u)) {
      case (#Err e) #Err(e);
      case (#Ok changes) {
        for ((k, old, new) in changes.vals()) ignore block<system>("sneednft_config", [("caller", pv(caller)), ("key", #Text("icrc3_" # k)), ("old_value", #Nat(old)), ("value", #Nat(new))]);
        Icrc3Log.armIfNeeded<system>(icrc3, icrc3_rt);
        #Ok(icrc3.settings);
      };
    };
  };
  func setRateImpl<system>(caller : Principal, action : Text, rule : ?RateLimit.Rule) : { #ok; #err : Text } {
    switch (RateRules.set(rate_rules, RATE_DEFAULTS, action, rule)) {
      case (#err e) #err(e);
      case (#ok r) {
        rate_rules := r;
        let v : Value = switch rule { case (?x) #Array([#Nat(x.capacity), #Nat(x.per_minute)]); case null #Text("default") };
        ignore block<system>("sneednft_config", [("caller", pv(caller)), ("key", #Text("rate_limit")), ("action", #Text(action)), ("value", v)]);
        #ok;
      };
    };
  };

  /// After the load (minting locked) the settings that decide who receives cards, or that guard
  /// the canister's cycles, change only by DAO proposal (dao_admin): an admin key could otherwise
  /// list a fake ledger, point the swap at another EXT canister or add admins, and take the
  /// unswapped cards. Pausing stays open to admins (an emergency brake), resuming does not.
  func daoOnly(caller : Principal) : ?Text {
    if (minting_locked and caller != governance) ?"After the load this changes only by DAO proposal (dao_admin)" else null;
  };

  public shared ({ caller }) func admin_set_proof_ledger(l : T.ProofLedger) : async { #ok; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (daoOnly(caller)) { case (?e) return #err(e); case null {} };
    setProofLedgerImpl<system>(caller, l);
    #ok;
  };
  public shared ({ caller }) func admin_remove_proof_ledger(l : Principal) : async { #ok; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (daoOnly(caller)) { case (?e) return #err(e); case null {} };
    if (not removeProofLedgerImpl<system>(caller, l)) return #err("Not on the list");
    #ok;
  };
  public shared ({ caller }) func admin_set_ext_canister(p : Principal) : async { #ok; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (daoOnly(caller)) { case (?e) return #err(e); case null {} };
    if (Map.size(swaps) > 0) return #err("Cards have been swapped from the current EXT canister: it cannot change");
    setExtImpl<system>(caller, p);
    #ok;
  };
  public shared ({ caller }) func admin_set_swaps_paused(b : Bool) : async { #ok; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    if (not b) switch (daoOnly(caller)) { case (?e) return #err(e); case null {} };
    setPausedImpl<system>(caller, b);
    #ok;
  };
  public shared ({ caller }) func admin_add_admin(p : Principal) : async { #ok; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (daoOnly(caller)) { case (?e) return #err(e); case null {} };
    if (not addAdminImpl<system>(caller, p)) return #err("Already an admin");
    #ok;
  };
  public shared ({ caller }) func admin_remove_admin(p : Principal) : async { #ok; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (daoOnly(caller)) { case (?e) return #err(e); case null {} };
    if (not removeAdminImpl<system>(caller, p)) return #err("Not an admin");
    #ok;
  };
  public shared ({ caller }) func admin_set_rate_limit(action : Text, rule : ?RateLimit.Rule) : async { #ok; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (daoOnly(caller)) { case (?e) return #err(e); case null {} };
    setRateImpl<system>(caller, action, rule);
  };
  /// How many recent ICRC-7 transfers with created_at_time are remembered for deduplication.
  public shared ({ caller }) func admin_set_dedup_cap(n : Nat) : async { #ok; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (daoOnly(caller)) { case (?e) return #err(e); case null {} };
    setDedupCapImpl<system>(caller, n);
    #ok;
  };
  /// Controllers only: the governance canister that may call dao_admin (staging has its own).
  public shared ({ caller }) func admin_set_governance(p : Principal) : async { #ok; #err : Text } {
    if (not Principal.isController(caller)) return #err("Controllers only");
    governance := p;
    configBlock<system>(caller, "governance", pv(p));
    #ok;
  };

  public query func get_admins() : async [Principal] { admins };
  public query func get_governance() : async Principal { governance };
  public query func get_proof_ledgers() : async [T.ProofLedger] { proof_ledgers };
  public query func get_rate_limits() : async [(Text, RateLimit.Rule)] { RateRules.all(rate_rules, RATE_DEFAULTS) };

  // ---- DAO admin: one GNSF (validator + target) for the admin actions that remain ----
  func daoPlan(a : T.DaoAction) : { #ok : Text; #err : Text } {
    switch a {
      case (#set_proof_ledger l) #ok("Accept payments on " # Principal.toText(l.ledger) # " (" # (switch (l.kind) { case (#icrc3) "ICRC-3 ledger"; case (#icp) "ICP ledger" }) # ") as proofs");
      case (#remove_proof_ledger l) if (proofLedger(l) == null) #err(Principal.toText(l) # " is not on the list") else #ok("Stop accepting payments on " # Principal.toText(l) # " as proofs");
      case (#set_ext_canister p) if (Map.size(swaps) > 0) #err("Cards have been swapped from the current EXT canister: it cannot change") else #ok("Swap cards of the EXT canister " # Principal.toText(p));
      case (#set_swaps_paused b) #ok(if b "Pause the swap" else "Resume the swap");
      case (#add_admin p) if (Array.find<Principal>(admins, func(x) = x == p) != null) #err(Principal.toText(p) # " is an admin already") else #ok("Add admin " # Principal.toText(p));
      case (#remove_admin p) if (Array.find<Principal>(admins, func(x) = x == p) == null) #err(Principal.toText(p) # " is not an admin") else #ok("Remove admin " # Principal.toText(p));
      case (#set_rate_limit { action; rule }) {
        switch (RateRules.set(rate_rules, RATE_DEFAULTS, action, rule)) {
          case (#err e) #err(e);
          case (#ok _) #ok("Rate limit of " # action # ": " # (switch rule { case (?r) Nat.toText(r.capacity) # " at once, " # Nat.toText(r.per_minute) # " a minute"; case null "the default" }));
        };
      };
      case (#set_dedup_cap n) #ok("Remember at most " # Nat.toText(n) # " recent ICRC-7 transfers for deduplication");
      case (#set_icrc3_settings u) {
        switch (Icrc3Log.planSettings(icrc3, u)) {
          case (#Err e) #err(e);
          case (#Ok(_, changes)) #ok("ICRC-3 log settings: " # debug_show changes);
        };
      };
    };
  };

  /// GNSF target: Sneed DAO governance only. Refusals reject, so the proposal fails with the reason.
  public shared ({ caller }) func dao_admin(a : T.DaoAction) : async Text {
    if (caller != governance) Debug.trap("Only Sneed DAO governance can call dao_admin");
    let rendering = switch (daoPlan(a)) { case (#ok r) r; case (#err e) throw Error.reject("sneed_nft: " # e) };
    switch a {
      case (#set_proof_ledger l) setProofLedgerImpl<system>(caller, l);
      case (#remove_proof_ledger l) ignore removeProofLedgerImpl<system>(caller, l);
      case (#set_ext_canister p) setExtImpl<system>(caller, p);
      case (#set_swaps_paused b) setPausedImpl<system>(caller, b);
      case (#add_admin p) ignore addAdminImpl<system>(caller, p);
      case (#remove_admin p) ignore removeAdminImpl<system>(caller, p);
      case (#set_rate_limit { action; rule }) switch (setRateImpl<system>(caller, action, rule)) { case (#err e) throw Error.reject(e); case (#ok) {} };
      case (#set_dedup_cap n) setDedupCapImpl<system>(caller, n);
      case (#set_icrc3_settings u) switch (setIcrc3Impl<system>(caller, u)) { case (#Err e) throw Error.reject(e); case (#Ok _) {} };
    };
    log_info(caller, cid(), "dao_admin: " # rendering);
    rendering;
  };
  public query func validate_dao_admin(a : T.DaoAction) : async DaoSettings.ValidationResult {
    switch (daoPlan(a)) { case (#ok r) #Ok(r); case (#err e) #Err(e) };
  };

  // ---------------------------------------------------------------------------------------------
  // Status and logs
  // ---------------------------------------------------------------------------------------------

  // get_api_doc (ICP service discoverability): a short guide for agents and integrators, with the
  // full reference at https://app.sneeddao.com/api/sneed_nft. A static text: no state read.
  public query func get_api_doc() : async Text { ApiDoc.text };

  public query func status() : async T.Status {
    var bytes = 0;
    for (i in Map.vals(images)) bytes += i.size;
    {
      name; symbol; total_supply = totalSupply(); supply_cap = effectiveCap(); metadata_frozen; minting_locked;
      manifest_entries = Map.size(manifest); manifest_sha256 = manifest_hash; images = Map.size(images); image_bytes = bytes;
      region_bytes = region_used; wasted_bytes; uploads_in_progress = Map.size(uploads); swaps = Map.size(swaps); retired = retired_count;
      swaps_paused; ext_canister; proof_ledgers;
      pending_refunds = Array.filter<T.Proof>(Iter.toArray(Map.vals(proofs)), func(p) = switch (p.refund) { case (#none or #done _) false; case _ true }).size();
      registry_reads; dedup_entries = Map.size(dedup);
      log_length = icrc3.log_length;
    };
  };

  /// The operational log (newest 2,000 lines): claims, refunds, failures. Admins only.
  public query ({ caller }) func get_log(start : Nat, length : Nat) : async [NT.LogEntry] {
    if (not isAdmin(caller)) Debug.trap("Admins only");
    TextLog.get(textlog, start, length);
  };

  // ---- ICRC-3 ----
  public query func icrc3_get_blocks(args : T3.GetBlocksArgs) : async T3.GetBlocksResult { Icrc3Log.getBlocks(icrc3, args) };
  public query func icrc3_get_archives(args : T3.GetArchivesArgs) : async T3.GetArchivesResult { Icrc3Log.getArchives(icrc3, args) };
  public query func icrc3_get_tip_certificate() : async ?T3.DataCertificate {
    switch (icrc3.last_hash, CertifiedData.getCertificate()) {
      case (?_, ?certificate) ?{ certificate; hash_tree = witness([["last_block_hash" : Blob], ["last_block_index" : Blob]]) };
      case _ null;
    };
  };
  public query func icrc3_supported_block_types() : async [T3.BlockType] {
    Array.map<(Text, Text), T3.BlockType>(BLOCK_TYPES, func((t, u)) = { block_type = t; url = u });
  };
  public query func icrc3_log_status() : async T3.LogStatus { Icrc3Log.status(icrc3, icrc3_rt) };
  public shared ({ caller }) func admin_set_icrc3_settings(u : T3.SettingsUpdate) : async { #Ok : T3.Settings; #Err : Text } {
    if (not isAdmin(caller)) return #Err("Admins only");
    switch (daoOnly(caller)) { case (?e) return #Err(e); case null {} };
    setIcrc3Impl<system>(caller, u);
  };
  public shared ({ caller }) func admin_icrc3_spill_now() : async { #Ok : Nat; #Err : Text } {
    if (not isAdmin(caller)) return #Err("Admins only");
    if (icrc3_rt.spilling) return #Err("A spill is already in progress");
    #Ok(await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), true));
  };

  // The log's spill job: no timer runs while the live store has room (Log.armIfNeeded arms a
  // one-shot run on the write that fills it).
  private func icrc3_timer_job() : async () { ignore await* Icrc3Log.spill(icrc3, icrc3_rt, icrc3_env(), false) };

  system func postupgrade() {
    if (cert_version != CERT_VERSION) {
      rebuildCert();
      cert_version := CERT_VERSION;
    } else publish();
    Icrc3Log.ensureSpill<system>(icrc3, icrc3_rt, 15 * 60, icrc3_timer_job);
  };

  /// Rebuilds the certified tree from the state (a repair tool; about as costly as 3,000 uploads).
  public shared ({ caller }) func admin_rebuild_certification() : async { #ok : { root : Blob; instructions : Nat64 }; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    let instructions = IC.countInstructions(rebuildCert);
    log_info(caller, cid(), "Certified tree rebuilt (" # Nat64.toText(instructions) # " instructions)");
    #ok({ root = MerkleTree.treeHash(cert_tree); instructions });
  };

  // ---------------------------------------------------------------------------------------------
  // Ingress guard (src/IngressGuard.mo): queries are never accepted as update calls, which would
  // go through consensus at our cost, and arguments are capped in size.
  // ---------------------------------------------------------------------------------------------

  func batchOk(arg : Blob, items : Nat) : Bool = items <= MAX_UPDATE_BATCH and arg.size() <= IngressGuard.SMALL_ARG + MAX_UPDATE_BATCH * (MAX_MEMO + 512);

  system func inspect({ caller : Principal; arg : Blob; msg : {
    #http_request : Any;
    #http_request_streaming_callback : Any;
    #icrc7_collection_metadata : Any;
    #icrc7_symbol : Any;
    #icrc7_name : Any;
    #icrc7_description : Any;
    #icrc7_logo : Any;
    #icrc7_total_supply : Any;
    #icrc7_supply_cap : Any;
    #icrc7_max_query_batch_size : Any;
    #icrc7_max_update_batch_size : Any;
    #icrc7_default_take_value : Any;
    #icrc7_max_take_value : Any;
    #icrc7_max_memo_size : Any;
    #icrc7_atomic_batch_transfers : Any;
    #icrc7_tx_window : Any;
    #icrc7_permitted_drift : Any;
    #icrc10_supported_standards : Any;
    #icrc7_token_metadata : Any;
    #icrc7_owner_of : Any;
    #icrc7_balance_of : Any;
    #icrc7_tokens : Any;
    #icrc7_tokens_of : Any;
    #icrc7_transfer : () -> [T.TransferArg];
    #icrc37_max_approvals_per_token_or_collection : Any;
    #icrc37_max_revoke_approvals : Any;
    #icrc37_is_approved : Any;
    #icrc37_get_token_approvals : Any;
    #icrc37_get_collection_approvals : Any;
    #icrc37_approve_tokens : () -> [T.ApproveTokenArg];
    #icrc37_approve_collection : () -> [T.ApproveCollectionArg];
    #icrc37_revoke_token_approvals : () -> [T.RevokeTokenApprovalArg];
    #icrc37_revoke_collection_approvals : () -> [T.RevokeCollectionApprovalArg];
    #icrc37_transfer_from : () -> [T.TransferFromArg];
    #set_collection : Any;
    #set_image_manifest : Any;
    #image_manifest_hash : Any;
    #get_image_manifest : Any;
    #icrcX_mint : Any;
    #freeze_metadata : Any;
    #lock_minting : Any;
    #image_upload_begin : Any;
    #image_upload_chunk : Any;
    #image_upload : Any;
    #image_upload_finish : Any;
    #image_upload_abort : Any;
    #admin_rebuild_certification : Any;
    #get_uploads : Any;
    #get_image_info : Any;
    #swap_address : Any;
    #swap_subaccount : Any;
    #proof_address : Any;
    #claim_swap : Any;
    #claim_by_proof : Any;
    #retry_refund : Any;
    #admin_reset_refund : Any;
    #get_swap : Any;
    #get_swaps : Any;
    #list_swaps : Any;
    #list_retired : Any;
    #get_proof : Any;
    #list_proofs : Any;
    #pending_refunds : Any;
    #admin_set_proof_ledger : Any;
    #admin_remove_proof_ledger : Any;
    #admin_set_ext_canister : Any;
    #admin_set_swaps_paused : Any;
    #admin_add_admin : Any;
    #admin_remove_admin : Any;
    #admin_set_rate_limit : Any;
    #admin_set_dedup_cap : Any;
    #admin_set_governance : Any;
    #get_admins : Any;
    #get_governance : Any;
    #get_proof_ledgers : Any;
    #get_rate_limits : Any;
    #dao_admin : Any;
    #validate_dao_admin : Any;
    #status : Any;
    #get_api_doc : Any;
    #get_log : Any;
    #icrc3_get_blocks : Any;
    #icrc3_get_archives : Any;
    #icrc3_get_tip_certificate : Any;
    #icrc3_supported_block_types : Any;
    #icrc3_log_status : Any;
    #admin_set_icrc3_settings : Any;
    #admin_icrc3_spill_now : Any;
  } }) : Bool {
    switch msg {
      // queries: never as update calls
      case (#http_request _ or #http_request_streaming_callback _ or #icrc7_collection_metadata _ or #icrc7_symbol _ or #icrc7_name _ or #icrc7_description _ or #icrc7_logo _ or #icrc7_total_supply _ or #icrc7_supply_cap _) false;
      case (#icrc7_max_query_batch_size _ or #icrc7_max_update_batch_size _ or #icrc7_default_take_value _ or #icrc7_max_take_value _ or #icrc7_max_memo_size _ or #icrc7_atomic_batch_transfers _ or #icrc7_tx_window _ or #icrc7_permitted_drift _) false;
      case (#icrc10_supported_standards _ or #icrc7_token_metadata _ or #icrc7_owner_of _ or #icrc7_balance_of _ or #icrc7_tokens _ or #icrc7_tokens_of _) false;
      case (#icrc37_max_approvals_per_token_or_collection _ or #icrc37_max_revoke_approvals _ or #icrc37_is_approved _ or #icrc37_get_token_approvals _ or #icrc37_get_collection_approvals _) false;
      case (#image_manifest_hash _ or #get_image_manifest _ or #get_uploads _ or #get_image_info _ or #swap_address _ or #swap_subaccount _ or #proof_address _) false;
      case (#get_swap _ or #get_swaps _ or #list_swaps _ or #list_retired _ or #get_proof _ or #list_proofs _ or #pending_refunds _) false;
      case (#get_admins _ or #get_governance _ or #get_proof_ledgers _ or #get_rate_limits _ or #validate_dao_admin _ or #status _ or #get_log _ or #get_api_doc _) false;
      case (#icrc3_get_blocks _ or #icrc3_get_archives _ or #icrc3_get_tip_certificate _ or #icrc3_supported_block_types _ or #icrc3_log_status _) false;
      // called by SNS governance, inter-canister (inspect never sees those calls)
      case (#dao_admin _) false;
      // ICRC-7 / ICRC-37 updates: holders, a bounded batch
      case (#icrc7_transfer f) not Principal.isAnonymous(caller) and batchOk(arg, f().size()) and rateAllows(caller, "nft_update");
      case (#icrc37_approve_tokens f) not Principal.isAnonymous(caller) and batchOk(arg, f().size()) and rateAllows(caller, "nft_update");
      case (#icrc37_approve_collection f) not Principal.isAnonymous(caller) and batchOk(arg, f().size()) and rateAllows(caller, "nft_update");
      case (#icrc37_revoke_token_approvals f) not Principal.isAnonymous(caller) and batchOk(arg, f().size()) and rateAllows(caller, "nft_update");
      case (#icrc37_revoke_collection_approvals f) not Principal.isAnonymous(caller) and batchOk(arg, f().size()) and rateAllows(caller, "nft_update");
      case (#icrc37_transfer_from f) not Principal.isAnonymous(caller) and batchOk(arg, f().size()) and rateAllows(caller, "nft_update");
      // the load (admins)
      case (#icrcX_mint _) isAdmin(caller) and arg.size() <= MAX_MINT_BATCH * (MAX_META_BYTES + 256) + IngressGuard.SMALL_ARG;
      case (#image_upload_chunk _ or #image_upload _) isAdmin(caller) and arg.size() <= MAX_UPLOAD_CHUNK + IngressGuard.SMALL_ARG;
      case (#set_image_manifest _) isAdmin(caller) and arg.size() <= MAX_MANIFEST * 64 + IngressGuard.SMALL_ARG;
      case (#set_collection _) isAdmin(caller) and arg.size() <= IngressGuard.textArg(MAX_NAME + MAX_SYMBOL + MAX_DESCRIPTION + MAX_LOGO);
      case (#freeze_metadata _ or #lock_minting _ or #image_upload_begin _ or #image_upload_finish _ or #image_upload_abort _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      // admin settings
      case (#admin_reset_refund _ or #admin_set_proof_ledger _ or #admin_remove_proof_ledger _ or #admin_set_ext_canister _ or #admin_set_swaps_paused _ or #admin_add_admin _ or #admin_remove_admin _ or #admin_set_rate_limit _ or #admin_set_dedup_cap _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#admin_set_icrc3_settings _ or #admin_icrc3_spill_now _ or #admin_rebuild_certification _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#admin_set_governance _) Principal.isController(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      // the swap: anyone signed in, rate-limited
      case (#claim_swap _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.SMALL_ARG and rateAllows(caller, "claim") and rateAllows(self(), "claims_global");
      case (#claim_by_proof _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.SMALL_ARG and rateAllows(caller, "proof") and rateAllows(self(), "claims_global");
      case (#retry_refund _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.SMALL_ARG and rateAllows(caller, "refund");
    };
  };

  // install: the certified tree (index and 404); upgrades keep it (see postupgrade). Also on every
  // upgrade, with enhanced orthogonal persistence: the log's spill job (armed only when the live
  // store is full)
  if (not cert_built) {
    rebuildCert();
    cert_built := true;
  };
  Icrc3Log.ensureSpill<system>(icrc3, icrc3_rt, 15 * 60, icrc3_timer_job);
};
