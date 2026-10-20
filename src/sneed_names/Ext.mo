import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Sha256 "mo:sha2/Sha256";

/// EXT NFTs (the Toniq / Entrepot standard, e.g. the Sneed Diamond Club): the identifiers a
/// collection uses. A holder is an ICP-style account identifier (hex), a token a TokenIdentifier
/// (principal text of "\x0Atid" ++ collection bytes ++ 4-byte big-endian index). The same
/// encodings as src/app_sneeddao_frontend/src/utils/ExtUtils.js.
module {
  public type CommonError = { #InvalidToken : Text; #Other : Text };
  public type Collection = actor {
    bearer : shared query Text -> async { #ok : Text; #err : CommonError };
  };

  public let MAX_INDEX : Nat = 4_294_967_295;

  func crc32(data : [Nat8]) : Nat32 {
    var crc : Nat32 = 0xFFFFFFFF;
    for (byte in data.vals()) {
      crc ^= Nat32.fromNat(Nat8.toNat(byte));
      var i = 0;
      while (i < 8) {
        crc := if (crc & 1 == 1) (crc >> 1) ^ 0xEDB88320 else crc >> 1;
        i += 1;
      };
    };
    crc ^ 0xFFFFFFFF;
  };

  func be32(n : Nat32) : [Nat8] = [
    Nat8.fromNat(Nat32.toNat((n >> 24) & 0xFF)),
    Nat8.fromNat(Nat32.toNat((n >> 16) & 0xFF)),
    Nat8.fromNat(Nat32.toNat((n >> 8) & 0xFF)),
    Nat8.fromNat(Nat32.toNat(n & 0xFF)),
  ];

  let HEX : [Char] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
  public func toHex(bytes : [Nat8]) : Text {
    var t = "";
    for (b in bytes.vals()) {
      let n = Nat8.toNat(b);
      t #= Text.fromChar(HEX[n / 16]) # Text.fromChar(HEX[n % 16]);
    };
    t;
  };

  /// The account identifier (64 lowercase hex chars) of a principal's default account:
  /// CRC32 (big endian) ++ SHA-224("\x0Aaccount-id" ++ principal ++ 32 zero bytes).
  public func accountId(p : Principal) : Text {
    let domain : [Nat8] = [0x0A, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x2d, 0x69, 0x64]; // "\x0Aaccount-id"
    let hash = Blob.toArray(Sha256.fromArray(#sha224, Array.flatten<Nat8>([domain, Blob.toArray(Principal.toBlob(p)), Array.tabulate<Nat8>(32, func _ = 0)])));
    toHex(Array.append<Nat8>(be32(crc32(hash)), hash));
  };

  /// The TokenIdentifier of token `index` in `collection`.
  public func tokenIdentifier(collection : Principal, index : Nat32) : Text {
    let tid : [Nat8] = [0x0A, 0x74, 0x69, 0x64]; // "\x0Atid"
    Principal.toText(Principal.fromBlob(Blob.fromArray(Array.flatten<Nat8>([tid, Blob.toArray(Principal.toBlob(collection)), be32(index)]))));
  };
};
