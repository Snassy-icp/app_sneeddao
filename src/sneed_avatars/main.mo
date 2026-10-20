import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Char "mo:base/Char";
import Debug "mo:base/Debug";
import Int "mo:base/Int";
import List "mo:base/List";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Region "mo:base/Region";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Map "mo:map/Map";
import Sha256 "mo:sha2/Sha256";

import IngressGuard "../IngressGuard";
import ApiDoc "ApiDoc";
import PremiumClient "../PremiumClient";

/// Avatar images for the naming service (spec/sneed_names.md §7): content-addressed by SHA-256,
/// bytes in stable memory, each image stored once however many people use it. Each principal
/// holds the images it uploaded (a limited number); an image nobody holds is freed. The name
/// canisters only keep the hash, so a record pointing at a freed image shows no avatar.
/// Served over HTTP at https://<canister>.raw.icp0.io/<hex hash>.
shared (deployer) persistent actor class SneedAvatars() = this {

  public type Result = { #ok : Text; #err : Text };
  public type Config = { max_held : Nat; max_held_premium : Nat; premium : ?Principal };
  public type Image = { content_type : Text; bytes : Blob };
  public type ImageInfo = { hash : Blob; content_type : Text; size : Nat; holders : Nat; created_at : Nat64 };
  public type HttpRequest = { method : Text; url : Text; headers : [(Text, Text)]; body : Blob };
  public type HttpResponse = { status_code : Nat16; headers : [(Text, Text)]; body : Blob };

  type Entry = {
    offset : Nat64;
    size : Nat;
    class_ : Nat; // slot size class
    content_type : Text;
    var holders : Nat;
    created_at : Nat64;
  };

  let MAX_IMAGE_BYTES : Nat = 49_152; // 48 KiB
  let CLASSES : [Nat] = [4_096, 8_192, 16_384, 32_768, 49_152];
  let PAGE : Nat64 = 65_536;
  let MAX_GET : Nat = 20; // images per get_images call (at most ~1 MB)

  var config : Config = { max_held = 20; max_held_premium = 200; premium = null };
  var admins : [Principal] = [];

  let data : Region.Region = Region.new();
  var next_offset : Nat64 = 0;
  let free : [var List.List<Nat64>] = Array.init<List.List<Nat64>>(CLASSES.size(), null); // freed slots per class
  let images = Map.new<Blob, Entry>();
  let held = Map.new<Principal, [Blob]>();
  let blocked = Map.new<Blob, ()>(); // removed by an admin: never stored again
  let premium_cache : PremiumClient.PremiumCache = PremiumClient.emptyCache();
  var bytes_stored : Nat = 0;

  func isAdmin(p : Principal) : Bool = Principal.isController(p) or Array.find<Principal>(admins, func(a) = a == p) != null;
  func now64() : Nat64 = Nat64.fromNat(Int.abs(Time.now()));

  // ---- storage ----

  func classOf(size : Nat) : ?Nat {
    var i = 0;
    while (i < CLASSES.size()) { if (size <= CLASSES[i]) return ?i; i += 1 };
    null;
  };

  func allocate(c : Nat) : Nat64 {
    switch (free[c]) {
      case (?(o, rest)) { free[c] := rest; return o };
      case null {};
    };
    let o = next_offset;
    let end = o + Nat64.fromNat(CLASSES[c]);
    let have = Region.size(data) * PAGE;
    if (end > have) {
      let more = (end - have + PAGE - 1) / PAGE;
      if (Region.grow(data, more) == 0xFFFF_FFFF_FFFF_FFFF) Debug.trap("Out of stable memory");
    };
    next_offset := end;
    o;
  };

  func release_slot(e : Entry) {
    free[e.class_] := ?(e.offset, free[e.class_]);
    bytes_stored -= e.size;
  };

  /// The image type, from its first bytes (the declared type is not trusted).
  func sniff(b : Blob) : ?Text {
    let a = Blob.toArray(b);
    let n = a.size();
    if (n >= 8 and a[0] == 0x89 and a[1] == 0x50 and a[2] == 0x4E and a[3] == 0x47) return ?"image/png";
    if (n >= 3 and a[0] == 0xFF and a[1] == 0xD8 and a[2] == 0xFF) return ?"image/jpeg";
    if (n >= 6 and a[0] == 0x47 and a[1] == 0x49 and a[2] == 0x46 and a[3] == 0x38) return ?"image/gif";
    if (n >= 12 and a[0] == 0x52 and a[1] == 0x49 and a[2] == 0x46 and a[3] == 0x46 and a[8] == 0x57 and a[9] == 0x45 and a[10] == 0x42 and a[11] == 0x50) return ?"image/webp";
    null;
  };

  /// The images a principal holds (images an admin removed are dropped from the list on the way).
  func heldBy(p : Principal) : [Blob] {
    let mine = switch (Map.get(held, Map.phash, p)) { case (?x) x; case null return [] };
    let live = Array.filter<Blob>(mine, func(h) = Map.has(images, Map.bhash, h));
    if (live.size() != mine.size()) {
      if (live.size() == 0) Map.delete(held, Map.phash, p) else Map.set(held, Map.phash, p, live);
    };
    live;
  };

  func check(bytes : Blob) : { #ok : (Text, Blob); #err : Text } {
    if (bytes.size() > MAX_IMAGE_BYTES) return #err("Images may be at most 48 KiB");
    let contentType = switch (sniff(bytes)) { case (?t) t; case null return #err("Only PNG, JPEG, GIF and WebP images") };
    let hash = Sha256.fromBlob(#sha256, bytes);
    if (Map.has(blocked, Map.bhash, hash)) return #err("This image was removed");
    #ok((contentType, hash));
  };

  /// `owner` holds the image (stored if new). The caller checked it is not held yet.
  func hold(owner : Principal, bytes : Blob, contentType : Text, hash : Blob) {
    switch (Map.get(images, Map.bhash, hash)) {
      case (?e) e.holders += 1;
      case null {
        let c = switch (classOf(bytes.size())) { case (?c) c; case null Debug.trap("checked") };
        let offset = allocate(c);
        Region.storeBlob(data, offset, bytes);
        Map.set<Blob, Entry>(images, Map.bhash, hash, { offset; size = bytes.size(); class_ = c; content_type = contentType; var holders = 1; created_at = now64() });
        bytes_stored += bytes.size();
      };
    };
    Map.set(held, Map.phash, owner, Array.append(heldBy(owner), [hash]));
  };

  func maxHeld(p : Principal) : async* Nat {
    switch (config.premium) {
      case (?id) {
        let premium = try { await* PremiumClient.isPremium(premium_cache, id, p) } catch (_) { false };
        if premium config.max_held_premium else config.max_held;
      };
      case null config.max_held;
    };
  };

  // ---- public ----

  /// Store an image (PNG, JPEG, GIF or WebP, at most 48 KiB) and hold it. Answers its SHA-256,
  /// which name records use as `#blob`. Uploading an image someone already stored just holds it.
  public shared ({ caller }) func upload(bytes : Blob) : async { #ok : Blob; #err : Text } {
    if (Principal.isAnonymous(caller)) return #err("Please sign in");
    let (contentType, hash) = switch (check(bytes)) { case (#ok(x)) x; case (#err(e)) return #err(e) };
    let mine = heldBy(caller);
    if (Array.find<Blob>(mine, func(h) = h == hash) != null) return #ok(hash);
    if (mine.size() >= config.max_held) {
      let max = await* maxHeld(caller);
      if (heldBy(caller).size() >= max) return #err("You hold " # Nat.toText(max) # " images already; release one first" # (if (max == config.max_held) " (Sneed Premium holds more)" else ""));
    };
    // after the premium call: hold it unless that happened meanwhile
    if (Array.find<Blob>(heldBy(caller), func(h) = h == hash) != null) return #ok(hash);
    if (Map.has(blocked, Map.bhash, hash)) return #err("This image was removed");
    hold(caller, bytes, contentType, hash);
    #ok(hash);
  };

  /// Stop holding an image; it is freed when nobody holds it.
  public shared ({ caller }) func release(hash : Blob) : async Result {
    let mine = heldBy(caller);
    if (Array.find<Blob>(mine, func(h) = h == hash) == null) return #err("You do not hold that image");
    let rest = Array.filter<Blob>(mine, func(h) = h != hash);
    if (rest.size() == 0) Map.delete(held, Map.phash, caller) else Map.set(held, Map.phash, caller, rest);
    switch (Map.get(images, Map.bhash, hash)) {
      case (?e) {
        e.holders -= 1;
        if (e.holders == 0) {
          release_slot(e);
          Map.delete(images, Map.bhash, hash);
        };
      };
      case null {}; // removed by an admin
    };
    #ok("Released");
  };

  public query ({ caller }) func my_images() : async [ImageInfo] {
    Array.mapFilter<Blob, ImageInfo>(heldBy(caller), func(h) = info(h));
  };

  func info(h : Blob) : ?ImageInfo = switch (Map.get(images, Map.bhash, h)) {
    case (?e) ?{ hash = h; content_type = e.content_type; size = e.size; holders = e.holders; created_at = e.created_at };
    case null null;
  };

  public query func get_info(hashes : [Blob]) : async [?ImageInfo] {
    if (hashes.size() > 500) Debug.trap("At most 500 hashes per call");
    Array.map<Blob, ?ImageInfo>(hashes, info);
  };

  /// Up to 20 images by hash.
  public query func get_images(hashes : [Blob]) : async [?Image] {
    if (hashes.size() > MAX_GET) Debug.trap("At most 20 images per call");
    Array.map<Blob, ?Image>(hashes, func(h) = switch (Map.get(images, Map.bhash, h)) {
      case (?e) ?{ content_type = e.content_type; bytes = Region.loadBlob(data, e.offset, e.size) };
      case null null;
    });
  };

  func hexDigit(c : Char) : ?Nat8 {
    let n = Char.toNat32(c);
    if (n >= 48 and n <= 57) return ?Nat8.fromNat(Nat32.toNat(n - 48));
    if (n >= 97 and n <= 102) return ?Nat8.fromNat(Nat32.toNat(n - 87));
    if (n >= 65 and n <= 70) return ?Nat8.fromNat(Nat32.toNat(n - 55));
    null;
  };

  func parseHash(t : Text) : ?Blob {
    let cs = Text.toArray(t);
    if (cs.size() != 64) return null;
    let out = Buffer.Buffer<Nat8>(32);
    var i = 0;
    while (i < 64) {
      switch (hexDigit(cs[i]), hexDigit(cs[i + 1])) {
        case (?a, ?b) out.add(a * 16 + b);
        case _ return null;
      };
      i += 2;
    };
    ?Blob.fromArray(Buffer.toArray(out));
  };

  /// GET /<64 hex characters of the SHA-256>. Content-addressed, so cached for good.
  public query func http_request(req : HttpRequest) : async HttpResponse {
    let path = switch (Text.split(req.url, #char '?').next()) { case (?p) p; case null "" };
    let name = Text.trimStart(path, #char '/');
    let notFound = { status_code = 404 : Nat16; headers = [("Content-Type", "text/plain")]; body = Text.encodeUtf8("Not found") };
    if (req.method != "GET" and req.method != "HEAD") return { status_code = 405; headers = []; body = "" };
    switch (parseHash(name)) {
      case (?h) switch (Map.get(images, Map.bhash, h)) {
        case (?e) {
          {
            status_code = 200;
            headers = [
              ("Content-Type", e.content_type),
              ("Cache-Control", "public, max-age=31536000, immutable"),
              ("X-Content-Type-Options", "nosniff"),
              ("Access-Control-Allow-Origin", "*"),
            ];
            body = if (req.method == "HEAD") "" else Region.loadBlob(data, e.offset, e.size);
          };
        };
        case null notFound;
      };
      case null notFound;
    };
  };

  public query func stats() : async { images : Nat; bytes : Nat; region_bytes : Nat64; holders : Nat } {
    { images = Map.size(images); bytes = bytes_stored; region_bytes = next_offset; holders = Map.size(held) };
  };

  // ---- administration ----

  public query func get_config() : async Config { config };
  public query func get_admins() : async [Principal] { admins };

  public shared ({ caller }) func admin_set_config(c : Config) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (c.max_held > c.max_held_premium or c.max_held_premium > 10_000) return #err("Need max_held <= max_held_premium <= 10000");
    config := c;
    #ok("Config updated");
  };

  public shared ({ caller }) func admin_add_admin(p : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    if (Array.find<Principal>(admins, func(a) = a == p) == null) admins := Array.append(admins, [p]);
    #ok("Added");
  };

  public shared ({ caller }) func admin_remove_admin(p : Principal) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    admins := Array.filter<Principal>(admins, func(a) = a != p);
    #ok("Removed");
  };

  /// Remove an abusive image for everyone, for good (it cannot be uploaded again).
  public shared ({ caller }) func admin_remove(hash : Blob) : async Result {
    if (not isAdmin(caller)) return #err("Admins only");
    switch (Map.get(images, Map.bhash, hash)) {
      case (?e) {
        release_slot(e);
        Map.delete(images, Map.bhash, hash);
        Map.set(blocked, Map.bhash, hash, ());
        #ok("Removed");
      };
      case null {
        Map.set(blocked, Map.bhash, hash, ());
        #ok("Blocked");
      };
    };
  };

  /// Upload on behalf of a principal, who then holds the image (migration of inline avatars).
  public shared ({ caller }) func admin_upload_for(owner : Principal, bytes : Blob) : async { #ok : Blob; #err : Text } {
    if (not isAdmin(caller)) return #err("Admins only");
    let (contentType, hash) = switch (check(bytes)) { case (#ok(x)) x; case (#err(e)) return #err(e) };
    if (Array.find<Blob>(heldBy(owner), func(h) = h == hash) == null) hold(owner, bytes, contentType, hash);
    #ok(hash);
  };

  // get_api_doc (ICP service discoverability): a short Markdown guide for agents and integrators,
  // with the full reference at https://app.sneeddao.com/api-docs/. A static text: no state read.
  public query func get_api_doc() : async Text { ApiDoc.text };

  // ---------------------------------------------------------------------------------------------
  // Ingress guard (src/IngressGuard.mo)
  // ---------------------------------------------------------------------------------------------

  system func inspect({ caller : Principal; arg : Blob; msg : {
    #get_api_doc : Any;
    #admin_add_admin : Any;
    #admin_remove : Any;
    #admin_remove_admin : Any;
    #admin_set_config : Any;
    #admin_upload_for : Any;
    #get_admins : Any;
    #get_config : Any;
    #get_images : Any;
    #get_info : Any;
    #http_request : Any;
    #my_images : Any;
    #release : Any;
    #stats : Any;
    #upload : Any;
  } }) : Bool {
    switch msg {
      // queries are free as queries; as updates the canister would pay for consensus
      case (#get_api_doc _ or #get_admins _ or #get_config _ or #get_images _ or #get_info _ or #http_request _ or #my_images _ or #stats _) false;
      case (#admin_set_config _) isAdmin(caller) and arg.size() <= IngressGuard.textArg(1_000);
      case (#admin_add_admin _ or #admin_remove _ or #admin_remove_admin _) isAdmin(caller) and arg.size() <= IngressGuard.SMALL_ARG;
      case (#admin_upload_for _) isAdmin(caller) and arg.size() <= IngressGuard.MEDIUM_ARG;
      case (#upload _) not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.MEDIUM_ARG;
      case _ not Principal.isAnonymous(caller) and arg.size() <= IngressGuard.SMALL_ARG;
    };
  };
};
