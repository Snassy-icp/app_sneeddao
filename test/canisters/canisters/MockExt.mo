/// Test double for an EXT NFT collection (the Toniq / Entrepot standard, e.g. the Sneed Diamond
/// Club): the read methods Sneed Hub uses (extensions, bearer, tokens, metadata, getRegistry),
/// transfer as the EXT reference implementation does it, and test helpers to mint, move a token
/// to another account id, and make bearer or transfer fail.
/// Holders are account identifiers (hex); tokens are TokenIdentifiers of this canister.
/// transfer: the owner is the account `from` names (a principal's default account, or an
/// address); it must hold the token, and the caller's account (caller + `subaccount`) must be
/// that owner, else #Unauthorized(owner) / #Unauthorized(spender), as the Diamond Club answers.
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Ext "../../../src/sneed_names/Ext";

persistent actor class MockExt() = this {
  type CommonError = { #InvalidToken : Text; #Other : Text };
  type Metadata = { #fungible : { name : Text; symbol : Text; decimals : Nat8; metadata : ?Blob }; #nonfungible : { metadata : ?Blob } };

  var holders : [Text] = []; // index -> account id
  var metas : [?Blob] = [];
  var failing : Bool = false;
  var transferFailing : Bool = false;
  var transfers : Nat = 0; // transfers done

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
  public shared func set_transfer_failing(f : Bool) : async () { transferFailing := f };
  public query func transfer_count() : async Nat { transfers };

  type User = { #address : Text; #principal : Principal };
  func toAid(u : User) : Text {
    switch (u) { case (#address(a)) Text.toLowercase(a); case (#principal(p)) Ext.accountId(p) };
  };

  public shared ({ caller }) func transfer(req : { from : User; to : User; token : Text; amount : Nat; memo : Blob; notify : Bool; subaccount : ?Blob }) : async {
    #ok : Nat;
    #err : { #Unauthorized : Text; #InsufficientBalance; #Rejected; #InvalidToken : Text; #CannotNotify : Text; #Other : Text };
  } {
    if (req.amount != 1) return #err(#Other("Must use amount of 1"));
    let i = switch (indexOf(req.token)) { case (?i) i; case null return #err(#InvalidToken(req.token)) };
    if (transferFailing) return #err(#Other("Transfers are paused"));
    let owner = toAid(req.from);
    if (owner != holders[i]) return #err(#Unauthorized(owner));
    let spender = switch (req.subaccount) { case (?s) Ext.accountIdOf(caller, s); case null Ext.accountId(caller) };
    if (spender != owner) return #err(#Unauthorized(spender));
    holders := Array.tabulate<Text>(holders.size(), func(j) = if (j == i) toAid(req.to) else holders[j]);
    transfers += 1;
    #ok(1);
  };

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
