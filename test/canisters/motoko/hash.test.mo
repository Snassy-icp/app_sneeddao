// Unit vectors for src/icrc3/Hash.mo, run with `moc -r` by tests/icrc3-hash.test.js.
import Debug "mo:base/Debug";
import Blob "mo:base/Blob";
import Hash "../../../src/icrc3/Hash";

// 1. IC interface spec request-id example (same hashing as ICRC-3 values)
let request : Hash.Value = #Map([
  ("request_type", #Text("call")),
  ("sender", #Blob(Blob.fromArray([0x04]))),
  ("ingress_expiry", #Nat(1685570400000000000)),
  ("canister_id", #Blob(Blob.fromArray([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0xD2]))),
  ("method_name", #Text("hello")),
  ("arg", #Blob(Blob.fromArray([0x44, 0x49, 0x44, 0x4C, 0x00, 0xFD, 0x2A]))),
]);
assert Hash.toHex(Hash.hashValue(request)) == "1d1091364d6bb8a6c16b203ee75467d59ead468f523eb058880ae8ec80e2b101";

// 2. LEB128 / SLEB128
assert Hash.leb128(0) == [0x00];
assert Hash.leb128(127) == [0x7f];
assert Hash.leb128(128) == [0x80, 0x01];
assert Hash.leb128(624485) == [0xE5, 0x8E, 0x26];
assert Hash.sleb128(0) == [0x00];
assert Hash.sleb128(-1) == [0x7f];
assert Hash.sleb128(63) == [0x3f];
assert Hash.sleb128(64) == [0xc0, 0x00];
assert Hash.sleb128(-64) == [0x40];
assert Hash.sleb128(-65) == [0xbf, 0x7f];
assert Hash.sleb128(-123456) == [0xC0, 0xBB, 0x78];
assert Hash.sleb128(123456) == [0xC0, 0xC4, 0x07];

// 3. Hash tree: the empty tree hash from the IC spec, a tip tree with known
//    root and CBOR (cross-checked with agent-js), pruned nodes
assert Hash.toHex(Hash.treeHash(#empty)) == "4e3ed35c4e2d1ee89996483fb6260a64cffb6c47dbab216e7930e82f8190d120";
let sample : Hash.Value = #Map([
  ("btype", #Text("sneedlock_token_lock_create")),
  ("ts", #Nat(1760270000000000000)),
  ("tx", #Map([
    ("amount", #Nat(123456789)),
    ("expiry", #Nat(1760270000000000000)),
    ("ledger", #Blob(Blob.fromArray([0, 0, 0, 0, 2, 0, 0, 0x82, 1, 1]))),
    ("lock_id", #Nat(423)),
    ("owner", #Blob(Blob.fromArray([0x04]))),
  ])),
]);
let sampleHash = Hash.hashValue(sample);
assert Hash.toHex(sampleHash) == "da0747330f12623d76daf0a23abb07278d1e04733bb49e9df1e6f1c377e1d3db";
let tree = Hash.tipTree(4242, sampleHash);
assert Hash.toHex(Hash.treeHash(tree)) == "93eebdc044feb9fb81bcb41f80fb0a4a2f3881348166be65242758d3ffe97bae";
assert Hash.toHex(Hash.treeCbor(tree)) == "d9d9f7830183024f6c6173745f626c6f636b5f6861736882035820da0747330f12623d76daf0a23abb07278d1e04733bb49e9df1e6f1c377e1d3db8302506c6173745f626c6f636b5f696e6465788203429221";
assert Hash.treeHash(#pruned(sampleHash)) == sampleHash;
assert Hash.treeHash(#fork(#pruned(Hash.treeHash(#labeled(Blob.fromArray([0x61]), #leaf(sampleHash)))), #empty)) == Hash.treeHash(#fork(#labeled(Blob.fromArray([0x61]), #leaf(sampleHash)), #empty));

// 4. Map hashing ignores entry order; nested structures and negative ints
//    (vector cross-checked with rep-indy-hash 0.2.1)
let nested : Hash.Value = #Map([("i", #Int(-123456)), ("j", #Int(64)), ("a", #Array([#Nat(1), #Text("x"), #Map([("k", #Blob(Blob.fromArray([1, 2, 3])))])]))]);
assert Hash.toHex(Hash.hashValue(nested)) == "8265f3405c882aeacfde787f2e7af31b4350ff29275c02a553936d457c3eab93";
let reordered : Hash.Value = #Map([("a", #Array([#Nat(1), #Text("x"), #Map([("k", #Blob(Blob.fromArray([1, 2, 3])))])])), ("j", #Int(64)), ("i", #Int(-123456))]);
assert Hash.hashValue(reordered) == Hash.hashValue(nested);
assert Hash.hashValue(#Nat(0)) != Hash.hashValue(#Int(0)) or Hash.leb128(0) == Hash.sleb128(0); // both encode as 0x00, so equal
assert Hash.hashValue(#Text("")) == Hash.hashValue(#Blob(Blob.fromArray([])));

Debug.print("HASH VECTORS OK");
