import Error "mo:base/Error";
import Principal "mo:base/Principal";

/// The backend stays the moderation authority (bans and the word blacklist, spec/sneed_names.md §8).
module {
  public type Verdict = { #ok; #banned : Text; #blacklisted : Text };

  type Moderator = actor {
    names_moderate : shared ({ user : Principal; text : Text; is_public : Bool }) -> async Verdict;
  };

  /// Ask the moderator about `text` from `user`. No moderator configured: #ok (tests, a fresh
  /// staging install). A failing moderator refuses: names are not set unmoderated.
  public func check(moderator : ?Principal, user : Principal, text : Text, isPublic : Bool) : async* { #ok; #err : Text } {
    switch moderator {
      case null #ok;
      case (?m) {
        try {
          switch (await (actor (Principal.toText(m)) : Moderator).names_moderate({ user; text; is_public = isPublic })) {
            case (#ok) #ok;
            case (#banned(why)) #err(why);
            case (#blacklisted(why)) #err(why);
          };
        } catch (e) {
          #err("The name check is unavailable right now, please try again (" # Error.message(e) # ")");
        };
      };
    };
  };
};
