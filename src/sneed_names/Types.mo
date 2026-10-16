import Blob "mo:base/Blob";
import Principal "mo:base/Principal";
import Text "mo:base/Text";

/// Types shared by the naming canisters (spec/sneed_names.md).
module {
  /// An avatar: an https link, or the SHA-256 of an image held in sneed_avatars.
  public type AvatarRef = { #url : Text; #blob : Blob };

  public type VerifySource = {
    #admin : Principal;
    #dao; // a Sneed DAO proposal (generic nervous system function)
    #sns_governance : Principal; // an SNS's governance canister, for its own neurons
    #import_; // carried over from the backend's verified flag
  };

  /// A checkmark belongs to the exact name it was given for: a rename clears it.
  public type Verification = { name : Text; source : VerifySource; at : Nat64 };

  public type Page<K> = { start_after : ?K; limit : Nat };

  public type Result = { #ok : Text; #err : Text };
  public type ResultNat = { #ok : Nat; #err : Text };

  /// What a generic nervous system function validator answers.
  public type ValidationResult = { #Ok : Text; #Err : Text };

  public type LogEntry = { id : Nat; ts : Int; level : { #info; #error }; cid : Nat; caller : Principal; message : Text };

  public let MAX_URL_LENGTH : Nat = 512;

  /// Why an avatar reference is refused; null when it is fine.
  public func avatarProblem(a : AvatarRef) : ?Text {
    switch a {
      case (#url(u)) {
        if (u.size() > MAX_URL_LENGTH) return ?"Avatar link too long (max 512 characters)";
        if (not Text.startsWith(u, #text "https://")) return ?"Avatar links must start with https://";
        null;
      };
      case (#blob(h)) if (h.size() != 32) ?"An avatar image is referenced by its 32-byte SHA-256" else null;
    };
  };

  /// Opaque principals are canister ids; Internet Identity and key principals are self-authenticating.
  public func isCanisterId(p : Principal) : Bool {
    let bytes = Blob.toArray(Principal.toBlob(p));
    bytes.size() > 0 and bytes[bytes.size() - 1] == 0x01;
  };
};
