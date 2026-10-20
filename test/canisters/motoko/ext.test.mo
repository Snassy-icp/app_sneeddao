// Unit vectors for src/sneed_names/Ext.mo (EXT account and token identifiers), run with `moc -r`
// by tests/names-rules.test.js. The expected values come from the frontend's ExtUtils.js
// (@noble/hashes sha224, @dfinity/utils bigEndianCrc32); the anonymous principal's account id
// is the well-known one of the ICP ledger.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Debug "mo:base/Debug";
import Principal "mo:base/Principal";
import Ext "../../../src/sneed_names/Ext";

func check(ok : Bool, what : Text) { if (not ok) Debug.trap("FAILED: " # what) };
let p = Principal.fromText;

check(Ext.accountId(p("2vxsx-fae")) == "1c7a48ba6a562aa9eaa2481a9049cdf0433b9738c992d698c31d8abf89cadc79", "anonymous account id");
check(Ext.accountId(p("ejz7n-lyaaa-aaaad-qmkzq-cai")) == "57b5c336d5d863d011359c711130005b4a4714b4e8ec410a953e9cd3372bab1f", "canister account id");
check(Ext.accountId(p("h4a5i-5vcfo-5rusv-fmb6m-vrkia-mjnkc-jpoow-h5mam-nthnm-ldqlr-bqe")) == "722488363080fac9465ab57bdeee0d5d7284afcdbb166873b8955a3c1464ce64", "user account id");
// a subaccount (32 bytes, the last one 7), as Sneedex's offer escrow accounts use; ExtUtils.accountId(anonymous, sub)
check(Ext.accountIdOf(p("2vxsx-fae"), Blob.fromArray(Array.tabulate<Nat8>(32, func i = if (i == 31) 7 else 0))) == "24384226d8f679235b95a44562e147a4a7069251644833ba86a1e80ab18e95bd", "subaccount account id");
check(Ext.accountIdOf(p("2vxsx-fae"), Blob.fromArray(Array.tabulate<Nat8>(32, func _ = 0))) == Ext.accountId(p("2vxsx-fae")), "zero subaccount = default account");
check(Ext.tokenIdentifier(p("gjv36-laaaa-aaaah-adyza-cai"), 0) == "2so2y-oykor-uwiaa-aaaaa-bya6g-iaqca-aaaaa-a", "tid 0");
check(Ext.tokenIdentifier(p("gjv36-laaaa-aaaah-adyza-cai"), 42) == "b4tgl-3ikor-uwiaa-aaaaa-bya6g-iaqca-aaaav-a", "tid 42");
check(Ext.tokenIdentifier(p("gjv36-laaaa-aaaah-adyza-cai"), 4294967295) == "bitiz-wakor-uwiaa-aaaaa-bya6g-iaqd7-77777-q", "tid max");
check(Ext.toHex([0x00, 0x0f, 0xa0, 0xff]) == "000fa0ff", "hex");
Debug.print("ext.test.mo: all passed");
