/// Test double for the backend's names_moderate (spec/sneed_names.md §8): bans and a word
/// blacklist the tests set, and a record of every call.
import Array "mo:base/Array";
import Text "mo:base/Text";

persistent actor MockNamesModerator {
  stable var banned : [Principal] = [];
  stable var words : [Text] = [];
  stable var calls : [(Principal, Principal, Text, Bool)] = []; // (caller, user, text, is_public)
  stable var failing : Bool = false;

  public shared func set_banned(ps : [Principal]) : async () { banned := ps };
  public shared func set_words(ws : [Text]) : async () { words := ws };
  public shared func set_failing(f : Bool) : async () { failing := f };
  public query func get_calls() : async [(Principal, Principal, Text, Bool)] { calls };

  public shared ({ caller }) func names_moderate(args : { user : Principal; text : Text; is_public : Bool }) : async { #ok; #banned : Text; #blacklisted : Text } {
    assert (not failing);
    calls := Array.append(calls, [(caller, args.user, args.text, args.is_public)]);
    if (Array.find<Principal>(banned, func(p) = p == args.user) != null) return #banned("You are banned");
    let lower = Text.toLowercase(args.text);
    for (w in words.vals()) if (Text.contains(lower, #text w)) {
      if (args.is_public) banned := Array.append(banned, [args.user]);
      return #blacklisted("Name contains inappropriate content");
    };
    #ok;
  };
};
