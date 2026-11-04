// HTTP response certification, version 2 (the IC's response verification, as the HTTP gateways
// on icp0.io check it), for sneed_nft's own few routes. Pure functions only; the canister keeps
// the certified tree (cert/MerkleTree.mo) and publishes its root with CertifiedData.
//
// What a certified response carries, and what the gateway checks:
//  - `IC-CertificateExpression: <EXPRESSION>`: no request certification, the response's status,
//    body and the headers in CERTIFIED_HEADERS certified.
//  - `IC-Certificate: certificate=:<b64>:, tree=:<b64>:, expr_path=:<b64>:, version=2`: the
//    subnet's certificate (its certified_data is our tree's root), a witness (CBOR hash tree,
//    self-describing tag), and the CBOR array of the expression path the response is certified at.
//  - In the tree, the leaf ["http_expr", <path segments>, "<$>" | "<*>", sha256(EXPRESSION), "",
//    response_hash] (the "" is "no request certification"). response_hash = sha256(
//    hash(certified headers + the expression header + ":ic-cert-status") ‖ sha256(body)), the
//    header map hashed as an ICRC-3 / representation-independent map of lowercase names.
//  - The expression path is the most specific one for the request path: an exact path ("<$>"),
//    else the closest wildcard ("<*>"); every more specific candidate must be provably absent from
//    the witness. The canister serves exact paths, and a 404 at the root wildcard.
//
// Bodies over CHUNK bytes are streamed (streaming_strategy callback); the certified hash is of the
// whole body, which the gateway assembles before it checks it.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Char "mo:base/Char";
import Iter "mo:base/Iter";
import Nat8 "mo:base/Nat8";
import Nat16 "mo:base/Nat16";
import Nat32 "mo:base/Nat32";
import Text "mo:base/Text";
import Sha256 "mo:sha2/Sha256";

import Hash "../icrc3/Hash";

module {
  public type HeaderField = (Text, Text);
  public type HttpRequest = { method : Text; url : Text; headers : [HeaderField]; body : Blob; certificate_version : ?Nat16 };
  /// key: the image's key; sha256: the image the stream started with (a replaced image ends it).
  public type StreamingToken = { key : Text; sha256 : Blob; index : Nat };
  public type StreamingCallbackResponse = { body : Blob; token : ?StreamingToken };
  public type StreamingStrategy = {
    #Callback : { callback : shared query StreamingToken -> async StreamingCallbackResponse; token : StreamingToken };
  };
  public type HttpResponse = { status_code : Nat16; headers : [HeaderField]; body : Blob; streaming_strategy : ?StreamingStrategy; upgrade : ?Bool };

  /// Body bytes per response (the first one and each streamed one), well under the query
  /// response limit with room for the certificate headers.
  public let CHUNK : Nat = 1_500_000;

  public let CERTIFICATE_HEADER : Text = "ic-certificate";
  public let EXPRESSION_HEADER : Text = "ic-certificateexpression";
  public let EXPRESSION : Text = "default_certification(ValidationArgs{certification:Certification{no_request_certification:Empty{},response_certification:ResponseCertification{certified_response_headers:ResponseHeaderList{headers:[\"content-type\",\"cache-control\",\"access-control-allow-origin\",\"x-content-type-options\"]}}}})";

  public func expressionHash() : Blob = Sha256.fromBlob(#sha256, Text.encodeUtf8(EXPRESSION));

  /// The headers of every response (all certified): the four of EXPRESSION, then the expression.
  public func headers(contentType : Text, cacheControl : Text) : [HeaderField] = [
    ("content-type", contentType),
    ("cache-control", cacheControl),
    ("access-control-allow-origin", "*"),
    ("x-content-type-options", "nosniff"),
    (EXPRESSION_HEADER, EXPRESSION),
  ];

  /// response_hash of a response with these (certified) headers, status and body hash.
  public func responseHash(status : Nat, hs : [HeaderField], bodyHash : Blob) : Blob {
    let entries = Buffer.Buffer<(Text, Hash.Value)>(hs.size() + 1);
    for ((k, v) in hs.vals()) entries.add((Text.toLowercase(k), #Text(v)));
    entries.add((":ic-cert-status", #Nat(status)));
    let headerHash = Hash.hashValue(#Map(Buffer.toArray(entries)));
    let d = Sha256.Digest(#sha256);
    d.writeBlob(headerHash);
    d.writeBlob(bodyHash);
    d.sum();
  };

  // ---------------------------------------------------------------------------------------------
  // Paths
  // ---------------------------------------------------------------------------------------------

  /// The URL without query and fragment.
  func pathPart(url : Text) : Text {
    var p = switch (Text.split(url, #char '?').next()) { case (?x) x; case null "" };
    p := switch (Text.split(p, #char '#').next()) { case (?x) x; case null "" };
    p;
  };

  func hexVal(c : Char) : ?Nat {
    let n = Char.toNat32(c);
    if (n >= 48 and n <= 57) return ?Nat32.toNat(n - 48);
    if (n >= 97 and n <= 102) return ?Nat32.toNat(n - 87);
    if (n >= 65 and n <= 70) return ?Nat32.toNat(n - 55);
    null;
  };

  /// Percent-decoding of one path segment (the gateway decodes segments before it looks them up).
  /// A segment that does not decode to UTF-8 is kept as it is.
  public func percentDecode(s : Text) : Text {
    if (not Text.contains(s, #char '%')) return s;
    let chars = Iter.toArray(s.chars());
    let out = Buffer.Buffer<Nat8>(chars.size());
    var i = 0;
    while (i < chars.size()) {
      let c = chars[i];
      if (c == '%' and i + 2 < chars.size()) {
        switch (hexVal(chars[i + 1]), hexVal(chars[i + 2])) {
          case (?h, ?l) { out.add(Nat8.fromNat(h * 16 + l)); i += 3 };
          case _ { for (b in Text.encodeUtf8(Text.fromChar(c)).vals()) out.add(b); i += 1 };
        };
      } else {
        for (b in Text.encodeUtf8(Text.fromChar(c)).vals()) out.add(b);
        i += 1;
      };
    };
    switch (Text.decodeUtf8(Blob.fromArray(Buffer.toArray(out)))) { case (?t) t; case null s };
  };

  /// The request path's segments, decoded: "/" -> [""], "/card/1.jpg" -> ["card", "1.jpg"].
  public func segments(url : Text) : [Text] {
    var p = pathPart(url);
    p := switch (Text.stripStart(p, #char '/')) { case (?x) x; case null p };
    if (p == "") return [""]; // Text.split of "" yields nothing
    Array.map<Text, Text>(Iter.toArray(Text.split(p, #char '/')), percentDecode);
  };

  /// The segments with empty ones dropped except a trailing one ("/card//1.jpg" is "/card/1.jpg"
  /// to the gateway's verifier, "/card/" stays a directory): what routes and exact paths use.
  public func normalized(segs : [Text]) : [Text] {
    let out = Buffer.Buffer<Text>(segs.size());
    for (i in segs.keys()) if (segs[i] != "" or i + 1 == segs.size()) out.add(segs[i]);
    if (out.size() == 0) [""] else Buffer.toArray(out);
  };

  /// The value of query parameter `name` (the first one), if present.
  public func queryParam(url : Text, name : Text) : ?Text {
    let parts = Iter.toArray(Text.split(url, #char '?'));
    if (parts.size() < 2) return null;
    let q = switch (Text.split(parts[1], #char '#').next()) { case (?x) x; case null "" };
    for (kv in Text.split(q, #char '&')) {
      let pair = Iter.toArray(Text.split(kv, #char '='));
      if (pair.size() >= 1 and pair[0] == name) return ?(if (pair.size() >= 2) percentDecode(pair[1]) else "");
    };
    null;
  };

  func blobs(ts : [Text]) : [Blob] = Array.map<Text, Blob>(ts, Text.encodeUtf8);

  /// The expression path of an exact route: ["http_expr", ...segments, "<$>"].
  public func exactPath(segs : [Text]) : [Text] = Array.flatten<Text>([["http_expr"], segs, ["<$>"]]);

  /// The root wildcard's expression path (the 404 of every path without its own route).
  public let ROOT_WILDCARD : [Text] = ["http_expr", "<*>"];

  /// Every expression path a gateway may look for before the root wildcard: the exact path, and
  /// the wildcards of the path and of each of its parents, both as a file ([..., "<*>"]) and as a
  /// directory ([..., "", "<*>"]; "/" is the directory [""]). A superset of what the verifier
  /// checks, so a 404 at the root wildcard proves every more specific path absent.
  public func candidates(segs : [Text]) : [[Text]] {
    let out = Buffer.Buffer<[Text]>(2 * segs.size() + 4);
    out.add(exactPath(segs));
    var j = segs.size();
    loop {
      let head = Array.flatten<Text>([["http_expr"], Array.subArray<Text>(segs, 0, j)]);
      out.add(Array.append(head, ["<*>"]));
      out.add(Array.append(head, ["", "<*>"]));
      if (j == 0) return Buffer.toArray(out);
      j -= 1;
    };
  };

  /// The tree path of a certified response's leaf: expression path, expression hash, "" (no
  /// request certification), response hash.
  public func leafPath(exprPath : [Text], exprHash : Blob, responseHash : Blob) : [Blob] {
    Array.flatten<Blob>([blobs(exprPath), [exprHash, "" : Blob, responseHash]]);
  };

  public func treePath(path : [Text]) : [Blob] = blobs(path);

  // ---------------------------------------------------------------------------------------------
  // The IC-Certificate header
  // ---------------------------------------------------------------------------------------------

  public func base64(b : Blob) : Text {
    let B64 : [Char] = Iter.toArray("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".chars());
    let bytes = Blob.toArray(b);
    let n = bytes.size();
    var out = "";
    var i = 0;
    while (i + 2 < n) {
      let x = Nat8.toNat(bytes[i]) * 65536 + Nat8.toNat(bytes[i + 1]) * 256 + Nat8.toNat(bytes[i + 2]);
      out #= Text.fromChar(B64[x / 262144]) # Text.fromChar(B64[(x / 4096) % 64]) # Text.fromChar(B64[(x / 64) % 64]) # Text.fromChar(B64[x % 64]);
      i += 3;
    };
    if (n - i == 1) {
      let x = Nat8.toNat(bytes[i]) * 65536;
      out #= Text.fromChar(B64[x / 262144]) # Text.fromChar(B64[(x / 4096) % 64]) # "==";
    } else if (n - i == 2) {
      let x = Nat8.toNat(bytes[i]) * 65536 + Nat8.toNat(bytes[i + 1]) * 256;
      out #= Text.fromChar(B64[x / 262144]) # Text.fromChar(B64[(x / 4096) % 64]) # Text.fromChar(B64[(x / 64) % 64]) # "=";
    };
    out;
  };

  func cborHead(out : Buffer.Buffer<Nat8>, major : Nat8, n : Nat) {
    let m = major * 32;
    if (n < 24) { out.add(m + Nat8.fromNat(n)) } else if (n < 256) { out.add(m + 24); out.add(Nat8.fromNat(n)) } else if (n < 65536) {
      out.add(m + 25);
      out.add(Nat8.fromNat(n / 256));
      out.add(Nat8.fromNat(n % 256));
    } else {
      out.add(m + 26);
      out.add(Nat8.fromNat((n / 16777216) % 256));
      out.add(Nat8.fromNat((n / 65536) % 256));
      out.add(Nat8.fromNat((n / 256) % 256));
      out.add(Nat8.fromNat(n % 256));
    };
  };

  /// CBOR (with the self-describing tag) of an array of texts: the expr_path of the header.
  public func cborTexts(ts : [Text]) : Blob {
    let out = Buffer.Buffer<Nat8>(64);
    out.add(0xd9);
    out.add(0xd9);
    out.add(0xf7);
    cborHead(out, 4, ts.size());
    for (t in ts.vals()) {
      let b = Blob.toArray(Text.encodeUtf8(t));
      cborHead(out, 3, b.size());
      for (x in b.vals()) out.add(x);
    };
    Blob.fromArray(Buffer.toArray(out));
  };

  public func certificateHeader(certificate : Blob, witness : Blob, exprPath : [Text]) : HeaderField {
    (CERTIFICATE_HEADER, "certificate=:" # base64(certificate) # ":, tree=:" # base64(witness) # ":, expr_path=:" # base64(cborTexts(exprPath)) # ":, version=2");
  };

  public func status(n : Nat) : Nat16 = Nat16.fromNat(n);
};
