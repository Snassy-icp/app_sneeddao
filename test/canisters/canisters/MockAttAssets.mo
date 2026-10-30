import Array "mo:base/Array";
import Nat "mo:base/Nat";

/// Stands in for an asset canister's `list` for sneed_attestations' tests: pages of `page_size`
/// entries from `start` (like ic-certified-assets), or every entry whatever `start` says
/// (`ignore_start`, like an older asset canister). `list` is an update here, to count the calls.
persistent actor MockAttAssets {
  type Encoding = { content_encoding : Text; sha256 : ?Blob; length : Nat; modified : Int };
  type Asset = { key : Text; content_type : Text; encodings : [Encoding] };

  var assets : [Asset] = [];
  var page_size : Nat = 2;
  var ignore_start : Bool = false;
  var list_calls : Nat = 0;

  public func set_assets(a : [Asset], page : Nat, ignoreStart : Bool) : async () {
    assets := a;
    page_size := page;
    ignore_start := ignoreStart;
  };

  public shared func list(args : { start : ?Nat; length : ?Nat }) : async [Asset] {
    list_calls += 1;
    if (ignore_start) return assets;
    let s = switch (args.start) { case (?x) x; case null 0 };
    if (s >= assets.size()) return [];
    Array.subArray<Asset>(assets, s, Nat.min(page_size, assets.size() - s));
  };

  public query func calls() : async Nat { list_calls };
};
