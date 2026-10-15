// LP locks as NFTs (spec/sneed_lock_v2.md, sections 2 and 3): the ICRC-7 and ICRC-37 types
// and the pure helpers. No state, no awaits; main.mo keeps the state and decides ownership
// (a position's owner is the principal holding its claim, the label says which of that
// principal's accounts holds the NFT).
//
// Standards: https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-7/ICRC-7.md
//            https://github.com/dfinity/ICRC/blob/main/ICRCs/ICRC-37/ICRC-37.md
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat64 "mo:base/Nat64";
import Principal "mo:base/Principal";
import Text "mo:base/Text";

module {
  public type Account = { owner : Principal; subaccount : ?Blob };
  public type Value = { #Blob : Blob; #Text : Text; #Nat : Nat; #Int : Int; #Array : [Value]; #Map : [(Text, Value)] };

  public type TransferArg = { from_subaccount : ?Blob; to : Account; token_id : Nat; memo : ?Blob; created_at_time : ?Nat64 };
  public type TransferError = {
    #NonExistingTokenId; #InvalidRecipient; #Unauthorized; #TooOld; #CreatedInFuture : { ledger_time : Nat64 };
    #Duplicate : { duplicate_of : Nat }; #GenericError : { error_code : Nat; message : Text }; #GenericBatchError : { error_code : Nat; message : Text };
  };
  public type TransferResult = { #Ok : Nat; #Err : TransferError };

  public type ApprovalInfo = { spender : Account; from_subaccount : ?Blob; expires_at : ?Nat64; memo : ?Blob; created_at_time : Nat64 };
  public type ApproveTokenArg = { token_id : Nat; approval_info : ApprovalInfo };
  public type ApproveTokenError = { #InvalidSpender; #Unauthorized; #NonExistingTokenId; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #GenericError : { error_code : Nat; message : Text }; #GenericBatchError : { error_code : Nat; message : Text } };
  public type ApproveTokenResult = { #Ok : Nat; #Err : ApproveTokenError };
  public type ApproveCollectionArg = { approval_info : ApprovalInfo };
  public type ApproveCollectionError = { #InvalidSpender; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #GenericError : { error_code : Nat; message : Text }; #GenericBatchError : { error_code : Nat; message : Text } };
  public type ApproveCollectionResult = { #Ok : Nat; #Err : ApproveCollectionError };
  public type RevokeTokenApprovalArg = { spender : ?Account; from_subaccount : ?Blob; token_id : Nat; memo : ?Blob; created_at_time : ?Nat64 };
  public type RevokeTokenApprovalError = { #ApprovalDoesNotExist; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #NonExistingTokenId; #Unauthorized; #GenericError : { error_code : Nat; message : Text }; #GenericBatchError : { error_code : Nat; message : Text } };
  public type RevokeTokenApprovalResult = { #Ok : Nat; #Err : RevokeTokenApprovalError };
  public type RevokeCollectionApprovalArg = { spender : ?Account; from_subaccount : ?Blob; memo : ?Blob; created_at_time : ?Nat64 };
  public type RevokeCollectionApprovalError = { #ApprovalDoesNotExist; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #GenericError : { error_code : Nat; message : Text }; #GenericBatchError : { error_code : Nat; message : Text } };
  public type RevokeCollectionApprovalResult = { #Ok : Nat; #Err : RevokeCollectionApprovalError };
  public type IsApprovedArg = { spender : Account; from_subaccount : ?Blob; token_id : Nat };
  public type TokenApproval = { token_id : Nat; approval_info : ApprovalInfo };
  public type CollectionApproval = ApprovalInfo;
  public type TransferFromArg = { spender_subaccount : ?Blob; from : Account; to : Account; token_id : Nat; memo : ?Blob; created_at_time : ?Nat64 };
  public type TransferFromError = { #InvalidRecipient; #Unauthorized; #NonExistingTokenId; #TooOld; #CreatedInFuture : { ledger_time : Nat64 }; #Duplicate : { duplicate_of : Nat }; #GenericError : { error_code : Nat; message : Text }; #GenericBatchError : { error_code : Nat; message : Text } };
  public type TransferFromResult = { #Ok : Nat; #Err : TransferFromError };

  /// The position an LP NFT stands for.
  public type Position = { swap : Principal; position_id : Nat; minted_at : Nat64 };

  public let MAX_QUERY_BATCH : Nat = 100;
  public let MAX_UPDATE_BATCH : Nat = 10;
  public let DEFAULT_TAKE : Nat = 100;
  public let MAX_TAKE : Nat = 500;
  public let MAX_MEMO : Nat = 32;
  public let MAX_APPROVALS : Nat = 10; // per token, and per account for the collection
  public let MAX_REVOKE : Nat = 10;
  public let TX_WINDOW_NS : Nat64 = 86_400_000_000_000;
  public let DRIFT_NS : Nat64 = 120_000_000_000;

  /// A subaccount of 32 zero bytes is the default account, the same as none.
  public func normSub(s : ?Blob) : ?Blob {
    switch (s) {
      case null null;
      case (?b) { for (x in b.vals()) { if (x != 0) { return ?b } }; null };
    };
  };

  public func sameSub(a : ?Blob, b : ?Blob) : Bool { normSub(a) == normSub(b) };

  public func sameAccount(a : Account, b : Account) : Bool { a.owner == b.owner and sameSub(a.subaccount, b.subaccount) };

  /// A subaccount must be 32 bytes when given.
  public func validSub(s : ?Blob) : Bool { switch (s) { case null true; case (?b) b.size() == 32 } };

  public func accountKey(a : Account) : Text {
    Principal.toText(a.owner) # "." # (switch (normSub(a.subaccount)) { case null ""; case (?b) hex(b) });
  };

  public func hex(b : Blob) : Text {
    let digits = "0123456789abcdef";
    let d = Text.toArray(digits);
    var out = "";
    for (x in b.vals()) {
      let n = Nat8.toNat(x);
      out := out # Text.fromChar(d[n / 16]) # Text.fromChar(d[n % 16]);
    };
    out;
  };

  public type TimeRefusal = { #TooOld; #CreatedInFuture : { ledger_time : Nat64 } };

  /// ICRC-7's transaction window: refused when older than the window or from the future.
  public func checkTime(t : ?Nat64, now : Nat64) : ?TimeRefusal {
    switch (t) {
      case null null;
      case (?x) {
        if (Nat64.toNat(x) + Nat64.toNat(TX_WINDOW_NS) + Nat64.toNat(DRIFT_NS) < Nat64.toNat(now)) { return ?#TooOld };
        if (Nat64.toNat(x) > Nat64.toNat(now) + Nat64.toNat(DRIFT_NS)) { return ?#CreatedInFuture({ ledger_time = now }) };
        null;
      };
    };
  };

  public func notExpired(i : ApprovalInfo, now : Nat64) : Bool { switch (i.expires_at) { case (?e) e > now; case null true } };

  /// Ascending ids after `prev`, at most `take` (capped).
  public func page(sorted : [Nat], prev : ?Nat, take : ?Nat) : [Nat] {
    let n = Nat.min(switch (take) { case (?t) t; case null DEFAULT_TAKE }, MAX_TAKE);
    let after = switch (prev) { case (?p) Array.filter<Nat>(sorted, func(id) { id > p }); case null sorted };
    if (after.size() <= n) after else Array.tabulate<Nat>(n, func(i) { after[i] });
  };

  func esc(t : Text) : Text {
    var r = t;
    r := Text.replace(r, #char '&', "&amp;");
    r := Text.replace(r, #char '<', "&lt;");
    r := Text.replace(r, #char '>', "&gt;");
    r := Text.replace(r, #char '\"', "&quot;");
    r;
  };

  /// The card wallets show: the pair, the lock state line and the lock id, as an SVG data URL.
  public func card(pair : Text, status : Text, token_id : Nat, position_id : Nat) : Text {
    let svg = "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'>"
      # "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#1e293b'/><stop offset='1' stop-color='#4c1d95'/></linearGradient></defs>"
      # "<rect width='400' height='400' rx='24' fill='url(#g)'/>"
      # "<text x='32' y='64' font-family='sans-serif' font-size='20' fill='#c4b5fd'>SNEED LOCK</text>"
      # "<text x='32' y='170' font-family='sans-serif' font-size='40' font-weight='bold' fill='#ffffff'>" # esc(pair) # "</text>"
      # "<text x='32' y='210' font-family='sans-serif' font-size='20' fill='#e2e8f0'>LP position #" # Nat.toText(position_id) # "</text>"
      # "<text x='32' y='300' font-family='sans-serif' font-size='18' fill='#fbbf24'>" # esc(status) # "</text>"
      # "<text x='32' y='360' font-family='monospace' font-size='16' fill='#94a3b8'>lock #" # Nat.toText(token_id) # "</text>"
      # "</svg>";
    "data:image/svg+xml;utf8," # percentEncode(svg);
  };

  /// Enough percent-encoding for an SVG in a data URL (`#`, `%`, quotes, angle brackets, spaces).
  func percentEncode(t : Text) : Text {
    var out = "";
    for (c in t.chars()) {
      out := out # (switch (c) {
        case '%' "%25"; case '#' "%23"; case '<' "%3C"; case '>' "%3E"; case '\"' "%22"; case ' ' "%20"; case '\n' "%0A";
        case _ Text.fromChar(c);
      });
    };
    out;
  };
};
