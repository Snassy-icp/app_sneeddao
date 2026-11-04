// Unit tests for sneed_nft's certification pieces, run with `moc -r` by tests/sneed-nft.test.js:
// - cert/MerkleTree.mo (vendored): every witness, of present and absent keys, alone and merged,
//   reconstructs to the tree's root, also in trees where a key is a prefix of other keys (the
//   case upstream's revealMinKey got wrong: `MERKLE=upstream` in the test shows it failing)
// - HttpCert.mo: path segments, normalization, query parameters, base64, the CBOR expr_path, and
//   the candidate expression paths of a 404
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Debug "mo:base/Debug";
import Text "mo:base/Text";
import MT "../../../src/sneed_nft/cert/MerkleTree";
import Http "../../../src/sneed_nft/HttpCert";

func check(ok : Bool, what : Text) { if (not ok) Debug.trap("FAILED: " # what) };
func b(t : Text) : Blob = Text.encodeUtf8(t);

// ---- MerkleTree witnesses ----
func treeOf(paths : [[Text]]) : MT.Tree {
  var t = MT.empty();
  for (p in paths.vals()) t := MT.put(t, Array.map<Text, Blob>(p, b), b(debug_show p));
  t;
};
func witnessesOk(t : MT.Tree, needles : [[Text]], what : Text) {
  let root = MT.treeHash(t);
  for (n in needles.vals()) {
    check(MT.reconstruct(MT.reveal(t, Array.map<Text, Blob>(n, b))) == root, what # ": reveal " # debug_show n);
  };
  // all of them merged into one witness (as a 404 reveals its absence proofs together)
  check(MT.reconstruct(MT.reveals(t, Array.map<[Text], [Blob]>(needles, func(n) = Array.map<Text, Blob>(n, b)).vals())) == root, what # ": all merged");
};

// keys that are prefixes of other keys, at the top level and below
let prefixy = treeOf([["b"], ["ba"], ["c"], ["card"], ["card1", "x"], ["card10", "y"], [""], ["", "<$>"]]);
witnessesOk(prefixy, [["a"], [""], ["0"], ["b"], ["b", "x"], ["ba"], ["bb"], ["c"], ["ca"], ["card"], ["card0"], ["card1"], ["card1", "x"], ["card1", "z"], ["card2"], ["~"]], "prefix keys");
// a key that is the prefix of the next one, and a needle before both
witnessesOk(treeOf([["b"], ["ba"]]), [["a"], ["b"], ["ba"], ["bb"], ["c"]], "b, ba");
// the shape sneed_nft certifies: http_expr with "", "<*>", "card", and the ICRC-3 tip
let shape = treeOf([
  ["http_expr", "", "<$>", "e", "", "r1"],
  ["http_expr", "<*>", "e", "", "r2"],
  ["http_expr", "card", "1.jpg", "<$>", "e", "", "r3"],
  ["http_expr", "card", "1.jpg", "<$>", "e", "", "r4"],
  ["http_expr", "card", "10.jpg", "<$>", "e", "", "r5"],
  ["http_expr", "card", "100.jpg", "<$>", "e", "", "r6"],
  ["http_expr", "logo.jpg", "<$>", "e", "", "r7"],
  ["last_block_hash"],
  ["last_block_index"],
]);
witnessesOk(shape, [
  ["http_expr", "<*>", "e", "", "r2"], ["http_expr", "card", "1.jpg", "<$>", "e", "", "r4"], ["http_expr", "card", "2.jpg", "<$>"],
  ["http_expr", "card", "<*>"], ["http_expr", "card", "", "<*>"], ["http_expr", "", "<*>"], ["http_expr", "x", "<*>"], ["http_expr", "", "", "<*>"],
  ["http_expr", "card", "1", "<$>"], ["last_block_hash"], ["last_block_index"], ["a"], ["zzz"],
], "sneed_nft shape");

// ---- HttpCert ----
check(Http.segments("/") == [""], "segments /");
check(Http.segments("/card/1.jpg?size=web") == ["card", "1.jpg"], "segments with query");
check(Http.segments("/card/1.jpg#x") == ["card", "1.jpg"], "segments with fragment");
check(Http.segments("/%63ard/%31.jpg") == ["card", "1.jpg"], "percent-decoded");
check(Http.segments("/card/") == ["card", ""], "trailing slash");
check(Http.normalized(["card", "", "1.jpg"]) == ["card", "1.jpg"], "empty segment dropped");
check(Http.normalized(["", "card", "1.jpg"]) == ["card", "1.jpg"], "leading empty segment dropped");
check(Http.normalized(["card", ""]) == ["card", ""], "trailing empty segment kept");
check(Http.normalized(["", ""]) == [""], "// is /");
check(Http.queryParam("/card/1.jpg?x=1&size=thumb", "size") == ?"thumb", "query param");
check(Http.queryParam("/card/1.jpg", "size") == null, "no query");
check(Http.base64("") == "" and Http.base64("f") == "Zg==" and Http.base64("fo") == "Zm8=" and Http.base64("foo") == "Zm9v" and Http.base64("foobar") == "Zm9vYmFy", "base64 (RFC 4648 vectors)");
// CBOR with the self-describing tag: ["http_expr", "<*>"]
check(Http.cborTexts(["http_expr", "<*>"]) == ("\d9\d9\f7\82\69http_expr\63<*>" : Blob), "cbor expr_path");
let cs = Http.candidates(["card", "9.jpg"]);
check(cs[0] == ["http_expr", "card", "9.jpg", "<$>"], "exact candidate first");
for (c in [["http_expr", "card", "9.jpg", "<*>"], ["http_expr", "card", "<*>"], ["http_expr", "card", "", "<*>"], ["http_expr", "", "<*>"], ["http_expr", "<*>"]].vals()) {
  check(Array.find<[Text]>(cs, func(x) = x == c) != null, "candidate " # debug_show c);
};
Debug.print("nft_cert.test.mo: all passed");
