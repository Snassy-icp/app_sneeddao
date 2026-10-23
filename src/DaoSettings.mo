import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Int "mo:base/Int";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Char "mo:base/Char";
import T3 "icrc3/Types";

/// DAO-settable settings: one generic nervous system function per canister (spec/dao_settings.md).
///
/// A canister keeps a table of the settings the DAO may change (name, kind, unit, bounds, getter,
/// setter) and exposes three methods built on this module:
/// - `dao_set(args)`: SNS governance only. Validates every change, then applies all of them in one
///   message (no await between them, so all or nothing). Traps on any refusal, so governance marks
///   the proposal failed; replies with the rendering of what changed.
/// - `validate_dao_set(args)` (query): the GNSF validator. `#Ok(rendering)` / `#Err(reason)`.
/// - `dao_settings()` (query): every setting with its kind, unit, bounds and current value.
///
/// Adding a setting is a table entry in the canister's code, i.e. part of a normal upgrade proposal.
module {
  // ---------------------------------------------------------------------------------------------
  // Candid types (the GNSF payload is the Candid encoding of `SetArgs`)
  // ---------------------------------------------------------------------------------------------

  public type Account = { owner : Principal; subaccount : ?Blob };

  /// A setting's value. `#Null` means "none" for optional settings (an unset override, no canister).
  public type Value = {
    #Nat : Nat;
    #Int : Int;
    #Bool : Bool;
    #Text : Text;
    #Principal : Principal;
    #Account : Account;
    #Null;
  };

  /// One change. `expected`, when given, is the value the proposer saw: if the setting holds
  /// something else when the proposal executes (an admin changed it meanwhile), the whole proposal
  /// fails instead of overwriting a value the voters never saw.
  public type Change = { setting : Text; value : Value; expected : ?Value };

  /// The argument of dao_set / validate_dao_set. A record, so fields can be added later (opt).
  public type SetArgs = { changes : [Change] };

  public type ValidationResult = { #Ok : Text; #Err : Text };

  public type Kind = { #Nat; #OptNat; #Int; #Bool; #Text; #Principal; #OptPrincipal; #Account };

  /// How a Nat is shown. Token amounts are base units of a token with `decimals`.
  public type Unit = {
    #None;
    #Token : { symbol : Text; decimals : Nat8 };
    #Bps; // basis points, 100 = 1%
    #Seconds;
    #Nanoseconds;
    #UsdCents;
    #Count;
    #BaseUnits; // base units of whichever token an offer uses
  };

  /// One row of dao_settings().
  public type Info = {
    name : Text;
    label_ : Text;
    description : Text;
    kind : Kind;
    unit : Unit;
    min : ?Nat; // Nat kinds: smallest value; Text: shortest
    max : ?Nat; // Nat kinds: largest value; Text: longest
    value : Value;
    rendered : Text;
  };

  // ---------------------------------------------------------------------------------------------
  // The table a canister keeps (transient: it holds closures over the canister's state)
  // ---------------------------------------------------------------------------------------------

  public type Setting = {
    name : Text; // also the key of the ICRC-3 config block
    label_ : Text; // "premium offer creation fee", used in "<Canister>: <label> old → new"
    description : Text;
    kind : Kind;
    unit : Unit;
    min : ?Nat;
    max : ?Nat;
    check : ?(Value -> ?Text); // an extra rule on the new value ("0 or at least 0.0001 ICP")
    get : () -> Value;
    set : Value -> ();
  };

  /// A validated change: the setting, the value it holds now, the value it will hold.
  public type Planned = { setting : Setting; old : Value; new : Value };

  public let MAX_CHANGES : Nat = 32;
  public let MAX_TEXT : Nat = 1_000;

  // ---------------------------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------------------------

  func find(table : [Setting], name : Text) : ?Setting {
    Array.find<Setting>(table, func(s) { s.name == name });
  };

  func kindText(k : Kind) : Text {
    switch k {
      case (#Nat) "nat";
      case (#OptNat) "nat or null";
      case (#Int) "int";
      case (#Bool) "bool";
      case (#Text) "text";
      case (#Principal) "principal";
      case (#OptPrincipal) "principal or null";
      case (#Account) "account";
    };
  };

  func fitsKind(k : Kind, v : Value) : Bool {
    switch (k, v) {
      case (#Nat, #Nat _) true;
      case (#OptNat, #Nat _ or #Null) true;
      case (#Int, #Int _) true;
      case (#Bool, #Bool _) true;
      case (#Text, #Text _) true;
      case (#Principal, #Principal _) true;
      case (#OptPrincipal, #Principal _ or #Null) true;
      case (#Account, #Account _) true;
      case _ false;
    };
  };

  /// The type, bounds and extra rule of one setting for a new value.
  public func checkValue(s : Setting, v : Value) : ?Text {
    if (not fitsKind(s.kind, v)) return ?(s.name # ": expected " # kindText(s.kind) # ", got " # raw(v));
    switch v {
      case (#Nat n) {
        switch (s.min) { case (?m) if (n < m) return ?(s.name # ": " # show(s.unit, #Nat n) # " is below the minimum " # show(s.unit, #Nat m)); case null {} };
        switch (s.max) { case (?m) if (n > m) return ?(s.name # ": " # show(s.unit, #Nat n) # " is above the maximum " # show(s.unit, #Nat m)); case null {} };
      };
      case (#Text t) {
        let max = switch (s.max) { case (?m) m; case null MAX_TEXT };
        if (t.size() > max) return ?(s.name # ": at most " # Nat.toText(max) # " characters");
        switch (s.min) { case (?m) if (t.size() < m) return ?(s.name # ": at least " # Nat.toText(m) # " characters"); case null {} };
      };
      case (#Account a) {
        switch (a.subaccount) { case (?b) if (b.size() != 32) return ?(s.name # ": a subaccount is 32 bytes"); case null {} };
      };
      case _ {};
    };
    switch (s.check) { case (?f) f(v); case null null };
  };

  /// Validate a whole batch against the table and the current state.
  /// - at least one change, at most MAX_CHANGES, each setting at most once;
  /// - every setting known, every value of the right kind and within bounds;
  /// - `expected`, when given, equals the current value;
  /// - `cross` (the canister's rules between settings, e.g. min ≤ target ≤ max) holds for the
  ///   state after the batch: it gets a lookup returning the new value of a setting in the batch
  ///   and the current value of any other.
  /// `refuseNoop`: the validator refuses a change to the value a setting already holds (a pointless
  /// proposal); at execution a no-op is planned anyway and skipped by apply (not logged).
  public func plan(table : [Setting], args : SetArgs, cross : (Text -> Value) -> ?Text, refuseNoop : Bool) : { #ok : [Planned]; #err : Text } {
    if (args.changes.size() == 0) return #err("no changes");
    if (args.changes.size() > MAX_CHANGES) return #err("at most " # Nat.toText(MAX_CHANGES) # " changes per proposal");
    let out = Buffer.Buffer<Planned>(args.changes.size());
    for (c in args.changes.vals()) {
      let s = switch (find(table, c.setting)) {
        case (?s) s;
        case null return #err("unknown setting " # c.setting # " (see dao_settings())");
      };
      for (p in out.vals()) { if (p.setting.name == c.setting) return #err(c.setting # " appears twice") };
      switch (checkValue(s, c.value)) { case (?e) return #err(e); case null {} };
      let old = s.get();
      switch (c.expected) {
        case (?e) if (e != old) return #err(c.setting # " is now " # raw(old) # ", the proposal expected " # raw(e) # " (changed since it was made)");
        case null {};
      };
      if (refuseNoop and old == c.value) return #err(c.setting # " is already " # raw(old));
      out.add({ setting = s; old; new = c.value });
    };
    let planned = Buffer.toArray(out);
    let after = func(name : Text) : Value {
      for (p in planned.vals()) { if (p.setting.name == name) return p.new };
      switch (find(table, name)) { case (?s) s.get(); case null #Null };
    };
    switch (cross(after)) { case (?e) #err(e); case null #ok(planned) };
  };

  /// Apply validated changes in order (call without an await since plan). Returns the ones that
  /// changed something; no-ops are skipped.
  public func apply(planned : [Planned]) : [Planned] {
    let done = Buffer.Buffer<Planned>(planned.size());
    for (p in planned.vals()) {
      if (p.old != p.new) {
        p.setting.set(p.new);
        done.add(p);
      };
    };
    Buffer.toArray(done);
  };

  /// "<Canister>: <label> old → new [name: raw old → raw new]", one line per change.
  public func render(canister : Text, planned : [Planned]) : Text {
    let lines = Array.map<Planned, Text>(planned, func(p) {
      canister # ": " # p.setting.label_ # " " # change(p.setting.unit, p.old, p.new) # " [" # p.setting.name # ": " # raw(p.old) # " → " # raw(p.new) # "]";
    });
    Text.join("\n", lines.vals());
  };

  public func info(table : [Setting]) : [Info] {
    Array.map<Setting, Info>(table, func(s) {
      let v = s.get();
      { name = s.name; label_ = s.label_; description = s.description; kind = s.kind; unit = s.unit; min = s.min; max = s.max; value = v; rendered = show(s.unit, v) };
    });
  };

  // ---------------------------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------------------------

  func pow10(d : Nat) : Nat { var p = 1; var i = 0; while (i < d) { p *= 10; i += 1 }; p };

  /// n / 10^d as a decimal, trailing zeros dropped: decimal(100_000, 8) = "0.001".
  public func decimal(n : Nat, d : Nat) : Text {
    if (d == 0) return Nat.toText(n);
    let p = pow10(d);
    let whole = Nat.toText(n / p);
    var frac = Nat.toText(n % p);
    while (frac.size() < d) { frac := "0" # frac };
    var chars = Text.toArray(frac);
    var keep = chars.size();
    while (keep > 0 and chars[keep - 1] == '0') { keep -= 1 };
    if (keep == 0) whole else whole # "." # Text.fromIter(Array.subArray<Char>(chars, 0, keep).vals());
  };

  /// Seconds as the largest whole unit: 3600 → "1 h", 90 → "90 s", 172800 → "2 d".
  public func duration(sec : Nat) : Text {
    if (sec == 0) "0 s"
    else if (sec % 86_400 == 0) Nat.toText(sec / 86_400) # " d"
    else if (sec % 3_600 == 0) Nat.toText(sec / 3_600) # " h"
    else if (sec % 60 == 0) Nat.toText(sec / 60) # " min"
    else Nat.toText(sec) # " s";
  };

  /// The value without its unit symbol (used on the left of "→").
  func bare(u : Unit, v : Value) : Text {
    switch (u, v) {
      case (#Token t, #Nat n) decimal(n, Nat8.toNat(t.decimals));
      case (#Bps, #Nat n) decimal(n, 2) # "%";
      case (#Seconds, #Nat n) duration(n);
      case (#Nanoseconds, #Nat n) if (n % 1_000_000_000 == 0) duration(n / 1_000_000_000) else Nat.toText(n) # " ns";
      case (#UsdCents, #Nat n) "$" # Nat.toText(n / 100) # "." # (if (n % 100 < 10) "0" else "") # Nat.toText(n % 100);
      case (#BaseUnits, #Nat n) Nat.toText(n);
      case (_, #Null) "none";
      case _ raw(v);
    };
  };

  func suffix(u : Unit, v : Value) : Text {
    switch (u, v) {
      case (#Token t, #Nat _) " " # t.symbol;
      case (#BaseUnits, #Nat _) " base units";
      case _ "";
    };
  };

  /// A value with its unit: "0.002 ICP", "2.5%", "1 h", "$5.00", "none".
  public func show(u : Unit, v : Value) : Text { bare(u, v) # suffix(u, v) };

  /// "0.001 → 0.002 ICP" (the unit once, at the end, when both sides have it).
  public func change(u : Unit, old : Value, new : Value) : Text {
    let so = suffix(u, old);
    let sn = suffix(u, new);
    if (so == sn) bare(u, old) # " → " # bare(u, new) # sn else show(u, old) # " → " # show(u, new);
  };

  func hex(b : Blob) : Text {
    let d = Text.toArray("0123456789abcdef");
    var out = "";
    for (x in b.vals()) { let n = Nat8.toNat(x); out #= Char.toText(d[n / 16]) # Char.toText(d[n % 16]) };
    out;
  };

  /// The exact value, as stored: "100000", "true", "aaaaa-aa", "aaaaa-aa.<hex>", "none".
  public func raw(v : Value) : Text {
    switch v {
      case (#Nat n) Nat.toText(n);
      case (#Int i) Int.toText(i);
      case (#Bool b) if b "true" else "false";
      case (#Text t) "\"" # t # "\"";
      case (#Principal p) Principal.toText(p);
      case (#Account a) switch (a.subaccount) { case (?s) Principal.toText(a.owner) # "." # hex(s); case null Principal.toText(a.owner) };
      case (#Null) "none";
    };
  };

  /// The value as an ICRC-3 block value (accounts as [owner, subaccount?] like the library does).
  public func icrc3(v : Value) : T3.Value {
    switch v {
      case (#Nat n) #Nat(n);
      case (#Int i) #Int(i);
      case (#Bool b) #Nat(if b 1 else 0);
      case (#Text t) #Text(t);
      case (#Principal p) #Blob(Principal.toBlob(p));
      case (#Account a) switch (a.subaccount) {
        case (?s) #Array([#Blob(Principal.toBlob(a.owner)), #Blob(s)]);
        case null #Array([#Blob(Principal.toBlob(a.owner))]);
      };
      case (#Null) #Text("none");
    };
  };

  // ---------------------------------------------------------------------------------------------
  // Helpers for tables
  // ---------------------------------------------------------------------------------------------

  /// The Nat of a validated #Nat value (0 otherwise; plan has checked the kind).
  public func nat(v : Value) : Nat { switch v { case (#Nat n) n; case _ 0 } };

  /// A validated #OptNat value.
  public func optNat(v : Value) : ?Nat { switch v { case (#Nat n) ?n; case _ null } };

  public func ofOptNat(o : ?Nat) : Value { switch o { case (?n) #Nat n; case null #Null } };

  /// A fee rule: 0 (free) or at least `minFee` (one ledger fee), in `unit`.
  public func zeroOrAtLeast(minFee : Nat, unit : Unit, name : Text) : Value -> ?Text {
    func(v : Value) : ?Text {
      switch v {
        case (#Nat n) if (n != 0 and n < minFee) ?(name # ": 0 (free) or at least " # show(unit, #Nat minFee)) else null;
        case _ null;
      };
    };
  };
};
