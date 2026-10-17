// Donations to the people who build Sneed Hub: the frontend sends them straight from the donor's
// wallet to the configured account, then registers the transfer here. Registering reads the
// transfer's block from the ledger and checks it: a plain transfer from the caller to the donation
// account. Only then is it listed on the thank-you wall, so nobody can put a donation there that
// they did not make. Donations are public: the wall shows every donor's principal.
import Principal "mo:base/Principal";
import Blob "mo:base/Blob";
import Array "mo:base/Array";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Text "mo:base/Text";
import Error "mo:base/Error";
import Sha256 "mo:sha2/Sha256";

module {
    public type Account = { owner : Principal; subaccount : ?Blob };

    /// A verified donation on the wall.
    public type Donation = {
        id : Nat;
        donor : Principal; // the account it came from (owner)
        from_subaccount : ?Blob;
        to : Account; // the donation account at the time
        ledger : Principal;
        block_index : Nat;
        amount : Nat;
        created_at : Int; // the block's time, nanoseconds
        registered_at : Int;
        message : ?Text;
        hidden : Bool; // hidden from the wall by an admin
    };

    public type RegisterArgs = {
        ledger : Principal;
        block_index : Nat;
        from_subaccount : ?Blob;
        message : ?Text;
    };

    /// What the ledger says a transfer did.
    public type Transfer = { amount : Nat; created_at : Int };

    public let ICP_LEDGER : Text = "ryjl3-tyaaa-aaaaa-aaaba-cai";
    public let MAX_MESSAGE : Nat = 200;

    // ---- accounts ----

    func isDefault(sub : ?Blob) : Bool {
        switch (sub) {
            case null true;
            case (?b) { for (x in b.vals()) { if (x != 0) return false }; true };
        };
    };

    /// Two ICRC-1 accounts are the same (an absent subaccount equals 32 zero bytes).
    public func sameAccount(a : Account, b : Account) : Bool {
        if (a.owner != b.owner) return false;
        if (isDefault(a.subaccount) and isDefault(b.subaccount)) return true;
        a.subaccount == b.subaccount;
    };

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

    /// The ICP ledger's account identifier: CRC32 (big endian) ++ SHA-224("\x0Aaccount-id" ++ owner ++ subaccount).
    public func accountIdentifier(a : Account) : Blob {
        let sub : [Nat8] = switch (a.subaccount) {
            case (?b) if (b.size() == 32) Blob.toArray(b) else Array.tabulate<Nat8>(32, func _ = 0);
            case null Array.tabulate<Nat8>(32, func _ = 0);
        };
        let domain : [Nat8] = [0x0A, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x2d, 0x69, 0x64]; // "\x0Aaccount-id"
        let hash = Blob.toArray(Sha256.fromArray(#sha224, Array.flatten<Nat8>([domain, Blob.toArray(Principal.toBlob(a.owner)), sub])));
        let c = crc32(hash);
        let check : [Nat8] = [Nat8.fromNat(Nat32.toNat((c >> 24) & 0xFF)), Nat8.fromNat(Nat32.toNat((c >> 16) & 0xFF)), Nat8.fromNat(Nat32.toNat((c >> 8) & 0xFF)), Nat8.fromNat(Nat32.toNat(c & 0xFF))];
        Blob.fromArray(Array.append<Nat8>(check, hash));
    };

    // ---- the ICP ledger (query_blocks; it has no ICRC-3) ----
    // Only the fields read here are declared; every variant case is, so any block decodes.

    type Tokens = { e8s : Nat64 };
    type IcpOperation = {
        #Mint : {};
        #Burn : {};
        #Approve : {};
        #Transfer : { from : Blob; to : Blob; amount : Tokens; spender : ?[Nat8] };
    };
    type IcpBlock = { transaction : { operation : ?IcpOperation }; timestamp : { timestamp_nanos : Nat64 } };
    type IcpBlocksArgs = { start : Nat64; length : Nat64 };
    type IcpArchiveResult = { #Ok : { blocks : [IcpBlock] }; #Err : { #BadFirstBlockIndex : {}; #Other : {} } };
    type IcpQueryBlocksResponse = {
        blocks : [IcpBlock];
        first_block_index : Nat64;
        archived_blocks : [{ start : Nat64; length : Nat64; callback : shared query IcpBlocksArgs -> async IcpArchiveResult }];
    };
    type IcpLedger = actor { query_blocks : shared query IcpBlocksArgs -> async IcpQueryBlocksResponse };

    func icpBlock(ledger : Principal, index : Nat) : async* ?IcpBlock {
        let l : IcpLedger = actor (Principal.toText(ledger));
        let args = { start = Nat64.fromNat(index); length = 1 : Nat64 };
        let r = await l.query_blocks(args);
        if (r.blocks.size() > 0 and Nat64.toNat(r.first_block_index) == index) return ?r.blocks[0];
        for (a in r.archived_blocks.vals()) {
            if (Nat64.toNat(a.start) <= index and index < Nat64.toNat(a.start + a.length)) {
                switch (await a.callback(args)) {
                    case (#Ok { blocks }) if (blocks.size() > 0) return ?blocks[0];
                    case _ {};
                };
            };
        };
        null;
    };

    // ---- ICRC-3 ledgers ----

    public type Value = { #Blob : Blob; #Text : Text; #Nat : Nat; #Int : Int; #Array : [Value]; #Map : [(Text, Value)] };
    type BlocksArgs = [{ start : Nat; length : Nat }];
    type BlocksResult = {
        blocks : [{ id : Nat; block : Value }];
        archived_blocks : [{ args : BlocksArgs; callback : shared query BlocksArgs -> async BlocksResult }];
    };
    type Icrc3Ledger = actor { icrc3_get_blocks : shared query BlocksArgs -> async BlocksResult };

    func icrc3Block(ledger : Principal, index : Nat) : async* ?Value {
        let l : Icrc3Ledger = actor (Principal.toText(ledger));
        let args = [{ start = index; length = 1 }];
        let r = await l.icrc3_get_blocks(args);
        for (b in r.blocks.vals()) if (b.id == index) return ?b.block;
        for (a in r.archived_blocks.vals()) {
            let ar = await a.callback(a.args);
            for (b in ar.blocks.vals()) if (b.id == index) return ?b.block;
        };
        null;
    };

    func field(v : Value, name : Text) : ?Value {
        switch (v) {
            case (#Map entries) { for ((k, x) in entries.vals()) if (k == name) return ?x; null };
            case _ null;
        };
    };
    func textOf(v : ?Value) : ?Text { switch (v) { case (?#Text t) ?t; case _ null } };
    func natOf(v : ?Value) : ?Nat { switch (v) { case (?#Nat n) ?n; case _ null } };
    func accountOf(v : ?Value) : ?Account {
        // [owner] or [owner, subaccount], both blobs
        let ?#Array(parts) = v else return null;
        if (parts.size() == 0 or parts.size() > 2) return null;
        let #Blob(owner) = parts[0] else return null;
        if (owner.size() > 29) return null;
        if (parts.size() == 1) return ?{ owner = Principal.fromBlob(owner); subaccount = null };
        let #Blob(sub) = parts[1] else return null;
        ?{ owner = Principal.fromBlob(owner); subaccount = ?sub };
    };

    /// A plain ICRC-1 transfer in an ICRC-3 block (op "xfer", or btype "1xfer"), not a transfer_from.
    public func icrc3Transfer(block : Value) : ?{ from : Account; to : Account; amount : Nat; ts : Nat } {
        let ?tx = field(block, "tx") else return null;
        let isXfer = textOf(field(tx, "op")) == ?"xfer" or textOf(field(block, "btype")) == ?"1xfer";
        if (not isXfer or field(tx, "spender") != null) return null;
        let ?from = accountOf(field(tx, "from")) else return null;
        let ?to = accountOf(field(tx, "to")) else return null;
        let ?amount = natOf(field(tx, "amt")) else return null;
        let ts = switch (natOf(field(block, "ts"))) { case (?t) t; case null 0 };
        ?{ from; to; amount; ts };
    };

    /// Reads block `index` of `ledger` and checks it is a plain transfer from `from` to `to`.
    public func verify(ledger : Principal, index : Nat, from : Account, to : Account) : async* { #ok : Transfer; #err : Text } {
        try {
            if (Principal.toText(ledger) == ICP_LEDGER) {
                let ?b = await* icpBlock(ledger, index) else return #err("The ledger has no block " # debug_show index);
                switch (b.transaction.operation) {
                    case (?#Transfer t) {
                        if (t.spender != null) return #err("Block " # debug_show index # " is a transfer made with an approval, not a donation");
                        if (t.from != accountIdentifier(from)) return #err("Block " # debug_show index # " was not sent from your account");
                        if (t.to != accountIdentifier(to)) return #err("Block " # debug_show index # " was not sent to the donation account");
                        #ok({ amount = Nat64.toNat(t.amount.e8s); created_at = Nat64.toNat(b.timestamp.timestamp_nanos) });
                    };
                    case _ #err("Block " # debug_show index # " is not a transfer");
                };
            } else {
                let ?b = await* icrc3Block(ledger, index) else return #err("The ledger has no block " # debug_show index);
                let ?t = icrc3Transfer(b) else return #err("Block " # debug_show index # " is not a plain transfer");
                if (not sameAccount(t.from, from)) return #err("Block " # debug_show index # " was not sent from your account");
                if (not sameAccount(t.to, to)) return #err("Block " # debug_show index # " was not sent to the donation account");
                #ok({ amount = t.amount; created_at = t.ts });
            };
        } catch (e) {
            #err("Could not read the ledger: " # Error.message(e));
        };
    };

    /// A message as stored: trimmed, at most MAX_MESSAGE characters, none when empty.
    public func cleanMessage(m : ?Text) : ?Text {
        switch (m) {
            case null null;
            case (?t) {
                let s = Text.trim(t, #char ' ');
                if (s == "") null else {
                    var out = ""; var n = 0;
                    label l for (c in s.chars()) { if (n >= MAX_MESSAGE) break l; out #= Text.fromChar(c); n += 1 };
                    ?out;
                };
            };
        };
    };
};
