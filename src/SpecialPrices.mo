/// Special prices (spec/special_prices.md): an admin price and partner prices next to the
/// regular and premium prices of every Sneed canister that charges users.
///
/// - The admin price applies when the caller is on the canister's own admin list and is a
///   person (a self-authenticating principal): canisters on an admin list, such as SNS
///   governance or the proposal proxy, never buy anything, so they never get it.
/// - A partner price applies to one named principal (usually a partner canister that
///   integrates with ours), optionally until an expiry time.
/// - The price charged is the lowest applicable one among regular, premium (members),
///   admin (admins) and partner (that partner, before expiry). On a tie the earlier tier in
///   that order is reported, so `price_tier` only says admin or partner when it made a
///   difference.
/// - Every override is optional: unset means "no special price for this fee". With nothing
///   set the canister charges exactly as before.
///
/// Each canister defines its own override record (one `?Nat` per fee it charges) and keeps
/// `admin_prices : Prices` and `partner_prices : Map<Principal, Partner<Prices>>` in stable state.
import Principal "mo:base/Principal";
import Blob "mo:base/Blob";
import Text "mo:base/Text";
import Array "mo:base/Array";
import Map "mo:map/Map";
import { phash } "mo:map/Map";
import T3 "icrc3/Types";

module {

  /// Which price a purchase paid (`price_tier` in purchase records and ICRC-3 blocks).
  public type Tier = { #regular; #premium; #admin; #partner };

  /// A partner's entry: a public label (`label_` in Motoko, `label` in Candid), the overrides (the canister's record of `?Nat`) and an
  /// optional expiry (nanoseconds since 1970; null = no expiry).
  public type Partner<P> = { label_ : Text; prices : P; expires_at : ?Int };

  /// How a partner entry is listed publicly.
  public type PartnerListing<P> = { principal : Principal; label_ : Text; prices : P; expires_at : ?Int };

  public let MAX_PARTNERS : Nat = 200;
  public let MAX_LABEL_CHARS : Nat = 100;

  public func tierText(t : Tier) : Text {
    switch (t) { case (#regular) "regular"; case (#premium) "premium"; case (#admin) "admin"; case (#partner) "partner" };
  };

  /// The lowest applicable price and the tier that gave it. `premium`, `admin` and `partner`
  /// are null when the caller does not qualify or no override is set. Ties keep the earlier
  /// tier (regular, premium, admin, partner).
  public func lowest(regular : Nat, premium : ?Nat, admin : ?Nat, partner : ?Nat) : (Nat, Tier) {
    var best : Nat = regular;
    var tier : Tier = #regular;
    switch (premium) { case (?p) { if (p < best) { best := p; tier := #premium } }; case null {} };
    switch (admin) { case (?p) { if (p < best) { best := p; tier := #admin } }; case null {} };
    switch (partner) { case (?p) { if (p < best) { best := p; tier := #partner } }; case null {} };
    (best, tier);
  };

  /// A person's key (self-authenticating principal: 29 bytes ending in 0x02), not a canister.
  public func isPerson(p : Principal) : Bool {
    let b = Blob.toArray(Principal.toBlob(p));
    b.size() == 29 and b[28] == 0x02;
  };

  /// The partner entry of `p`, if there is one and it has not expired.
  public func activePartner<P>(m : Map.Map<Principal, Partner<P>>, p : Principal, now : Int) : ?Partner<P> {
    switch (Map.get(m, phash, p)) {
      case (?e) { if (isActive(e, now)) { ?e } else { null } };
      case null { null };
    };
  };

  public func isActive<P>(e : Partner<P>, now : Int) : Bool {
    switch (e.expires_at) { case (?t) { t > now }; case null { true } };
  };

  /// Every partner entry (expired ones too: the listing is public and shows the expiry).
  public func listing<P>(m : Map.Map<Principal, Partner<P>>) : [PartnerListing<P>] {
    Array.map<(Principal, Partner<P>), PartnerListing<P>>(
      Map.toArray(m),
      func((p, e)) { { principal = p; label_ = e.label_; prices = e.prices; expires_at = e.expires_at } },
    );
  };

  /// Checks shared by every canister's `set_partner_prices`: an anonymous principal, an empty or
  /// overlong label, an expiry in the past, or one partner too many (for a new entry).
  public func validatePartner<P>(m : Map.Map<Principal, Partner<P>>, p : Principal, e : Partner<P>, now : Int) : ?Text {
    if (Principal.isAnonymous(p)) { return ?"the anonymous principal cannot be a partner" };
    if (Text.trim(e.label_, #char ' ').size() == 0) { return ?"a partner needs a label" };
    if (e.label_.size() > MAX_LABEL_CHARS) { return ?("a label has at most " # debug_show (MAX_LABEL_CHARS) # " characters") };
    switch (e.expires_at) { case (?t) { if (t <= now) { return ?"the expiry is in the past" } }; case null {} };
    if (not Map.has(m, phash, p) and Map.size(m) >= MAX_PARTNERS) {
      return ?("at most " # debug_show (MAX_PARTNERS) # " partners");
    };
    null;
  };

  // ICRC-3 values for config-change blocks: an override record as a map of its set fields.
  public func overridesValue(fields : [(Text, ?Nat)]) : T3.Value {
    #Map(Array.mapFilter<(Text, ?Nat), (Text, T3.Value)>(fields, func((k, v)) { switch (v) { case (?n) { ?(k, #Nat(n)) }; case null { null } } }));
  };

  /// A partner entry as an ICRC-3 value (label, the set overrides, expiry when set).
  public func partnerValue(label_ : Text, fields : [(Text, ?Nat)], expires_at : ?Int) : T3.Value {
    let base : [(Text, T3.Value)] = [("label", #Text(label_)), ("prices", overridesValue(fields))];
    #Map(switch (expires_at) { case (?t) { Array.append(base, [("expires_at", #Int(t))]) }; case null { base } });
  };
};
