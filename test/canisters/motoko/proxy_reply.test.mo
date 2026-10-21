// Unit tests for src/sneed_proxy/CandidReply.mo (the top-level reply reader of `reply = #result`
// allowlist entries), run with `moc -r` by tests/sneed-proxy.test.js. The vectors were encoded by
// @icp-sdk/core/candid (the interpreter has no to_candid); the shapes are the ones the inventoried
// admin methods reply with (spec/sneed_proxy.md §6). Motoko's own encodings of the same shapes are
// covered end to end by the mock target in tests/sneed-proxy.test.js.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Char "mo:base/Char";
import Debug "mo:base/Debug";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Text "mo:base/Text";
import R "../../../src/sneed_proxy/CandidReply";

func nib(c : Char) : Nat8 {
  let n = Char.toNat32(c);
  Nat8.fromNat(Nat32.toNat(if (n >= 97) n - 87 else n - 48));
};
func hex(t : Text) : Blob {
  let cs = Text.toArray(t);
  Blob.fromArray(Array.tabulate<Nat8>(cs.size() / 2, func(i) = nib(cs[2 * i]) * 16 + nib(cs[2 * i + 1])));
};
func ok(t : Text) : Bool = R.classify(hex(t)) == #ok;
func err(t : Text) : ?Text = switch (R.classify(hex(t))) { case (#err(m)) m; case (#ok) ?"<ok>" };
func errNoText(t : Text) : Bool = R.classify(hex(t)) == #err(null);

// Field-name hashes (Candid spec)
assert R.idlHash("") == 0;
assert R.idlHash("a") == 97;
assert R.idlHash("ok") == 24_860; // 0x9cc2 01 as LEB128 above

// () and plain values: success
assert ok("4449444c0000");
assert ok("4449444c0001710568656c6c6f"); // "hello"
assert ok("4449444c00017d2a"); // 42
assert ok("4449444c016c02617d62710100010178"); // record
assert ok("4449444c00027d7d0102"); // two values

// variant { ok : text; err : text } (profiles, forum, sms)
assert ok("4449444c016b029cc20171e58eb4027101000004646f6e65");
assert err("4449444c016b029cc20171e58eb402710100010b41646d696e73206f6e6c79") == ?"Admins only";
// variant { Ok : text; Err : text } (sneed_lock)
assert ok("4449444c016b02bc8a0171c5fed20171010000114c6f636b20666565732075706461746564");
assert err("4449444c016b02bc8a0171c5fed201710100011d4f6e6c792061646d696e732063616e20736574206c6f636b2066656573") == ?"Only admins can set lock fees";
// variant { ok; err : SneedexError } (sneedex: #err(#NotAuthorized))
assert ok("4449444c026b03b38b96dc0271cb8393e4047fee82c1ea077f6b029cc2017fe58eb40200010100");
assert errNoText("4449444c026b03b38b96dc0271cb8393e4047fee82c1ea077f6b029cc2017fe58eb4020001010102");
assert errNoText("4449444c026b03b38b96dc0271cb8393e4047fee82c1ea077f6b029cc2017fe58eb402000101010008746f6f2068696768");
// variant { Ok : Settings; Err : text } (ICRC-3 settings)
assert ok("4449444c026c02deea8cd0067d99c1d8e3097d6b02bc8a0100c5fed201710101000102");
assert err("4449444c026c02deea8cd0067d99c1d8e3097d6b02bc8a0100c5fed2017101010103626164") == ?"bad";
// a variant with other tags: success
assert ok("4449444c016b02d7b0b2df027d82e1b793047f010001");
assert ok("4449444c016b02d7b0b2df027d82e1b793047f01000003");
// opt / vec of a result: not a top-level variant, success
assert ok("4449444c026b029cc20171e58eb402716e00010101010178");
assert ok("4449444c026b029cc20171e58eb402716d00010101010178");
// UTF-8 error text
assert err("4449444c016b029cc20171e58eb402710100011c476562c3bc6872207a7520686f636820c2b720e6898be695b0e69699") == ?"Gebühr zu hoch · 手数料";
// func and service entries in the type table are skipped
assert err("4449444c026a017d017101016b029cc20100e58eb4027101010112776974682066756e6320696e207461626c65") == ?"with func in table";
assert err("4449444c036a00000069010161006b029cc20101e58eb402710102011577697468207365727669636520696e207461626c65") == ?"with service in table";

// garbage: success (unparseable shapes count as success; the bytes are logged)
assert ok("");
assert ok("444944");
assert ok("0001020304");
assert ok("4449444cffffffffffffffffffff01");
assert ok("4449444c01"); // truncated table
// an err whose text is cut off: failure without a message
assert errNoText("4449444c016b029cc20171e58eb402710100010b41646d696e73206f6e6c");

Debug.print("PROXY REPLY READER OK");
