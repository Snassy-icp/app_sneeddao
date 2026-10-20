/// Test double for an EXT NFT collection (the Toniq / Entrepot standard, e.g. the Sneed Diamond
/// Club): the read methods Sneed Hub uses (extensions, bearer, tokens, metadata, getRegistry) and
/// test helpers to mint, move a token to another account id, and make bearer fail.
/// Holders are account identifiers (hex); tokens are TokenIdentifiers of this canister.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Principal "mo:base/Principal";

persistent actor class MockExt() = this {
  type CommonError = { #InvalidToken : Text; #Other : Text };
  type Metadata = { #fungible : { name : Text; symbol : Text; decimals : Nat8; metadata : ?Blob }; #nonfungible : { metadata : ?Blob } };

  var holders : [Text] = []; // index -> account id
  var metas : [?Blob] = [];
  var failing : Bool = false;

  /// The token index a TokenIdentifier of this canister names (null: not one of ours).
  func indexOf(tid : Text) : ?Nat {
    let b = Blob.toArray(Principal.toBlob(Principal.fromText(tid)));
    let me = Blob.toArray(Principal.toBlob(Principal.fromActor(this)));
    if (b.size() != 4 + me.size() + 4 or b[0] != 0x0A or b[1] != 0x74 or b[2] != 0x69 or b[3] != 0x64) return null;
    if (Array.subArray<Nat8>(b, 4, me.size()) != me) return null;
    let n = b.size();
    let i = (Nat8.toNat(b[n - 4]) * 16777216) + (Nat8.toNat(b[n - 3]) * 65536) + (Nat8.toNat(b[n - 2]) * 256) + Nat8.toNat(b[n - 1]);
    if (i < holders.size()) ?i else null;
  };

  public shared func mint(holder : Text, metadata : ?Blob) : async Nat32 {
    holders := Array.append(holders, [holder]);
    metas := Array.append(metas, [metadata]);
    Nat32.fromNat(holders.size() - 1);
  };
  public shared func set_bearer(index : Nat32, holder : Text) : async () {
    holders := Array.tabulate<Text>(holders.size(), func(i) = if (i == Nat32.toNat(index)) holder else holders[i]);
  };
  public shared func set_failing(f : Bool) : async () { failing := f };

  public query func extensions() : async [Text] { ["@ext/common", "@ext/nonfungible"] };

  public query func bearer(tid : Text) : async { #ok : Text; #err : CommonError } {
    if (failing) return #err(#Other("The collection is paused"));
    switch (indexOf(tid)) { case (?i) #ok(holders[i]); case null #err(#InvalidToken(tid)) };
  };

  public query func tokens(aid : Text) : async { #ok : [Nat32]; #err : CommonError } {
    var out : [Nat32] = [];
    for (i in holders.keys()) if (holders[i] == aid) out := Array.append(out, [Nat32.fromNat(i)]);
    if (out.size() == 0) #err(#Other("No tokens")) else #ok(out);
  };

  public query func metadata(tid : Text) : async { #ok : Metadata; #err : CommonError } {
    switch (indexOf(tid)) { case (?i) #ok(#nonfungible({ metadata = metas[i] })); case null #err(#InvalidToken(tid)) };
  };

  public query func getRegistry() : async [(Nat32, Text)] {
    Array.tabulate<(Nat32, Text)>(holders.size(), func(i) = (Nat32.fromNat(i), holders[i]));
  };
};
