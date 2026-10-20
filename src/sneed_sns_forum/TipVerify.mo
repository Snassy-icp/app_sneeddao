// Tip verification: the tipper's wallet sends the tokens straight to the post's author, then the
// client records the tip here with the transfer's block index. The forum reads that block on the
// token's ledger, once, when the tip is recorded, and checks it is a plain transfer of exactly
// the tip's amount from the caller's main account (default subaccount) to the author's main
// account. One call to the ledger, plus one to an archive when the block has been archived.
//
// Ledgers: ICRC-3 (icrc3_get_blocks) first; ledgers without it are read with the ICRC ledger
// suite's get_transactions; the ICP ledger with query_blocks (account identifiers). Every call is
// a bounded-wait call, so a ledger that never answers cannot hold up the forum or its upgrades.
//
// The ledger is the one the client names, so a tip is only as real as its token: "verified" means
// the token's own ledger records the transfer, not that the token is worth anything.
import Principal "mo:base/Principal";
import Blob "mo:base/Blob";
import Array "mo:base/Array";
import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Error "mo:base/Error";
import Sha256 "mo:sha2/Sha256";

module {
    public type Account = { owner : Principal; subaccount : ?Blob };

    /// What the forum makes of a reported tip.
    public type Outcome = {
        #verified;
        #rejected : Text;  // the ledger contradicts the tip: it is not recorded
        #unchecked : Text; // the ledger could not be read: recorded as unverified
    };

    public let ICP_LEDGER : Text = "ryjl3-tyaaa-aaaaa-aaaba-cai";
    let TIMEOUT : Nat32 = 30; // seconds, for every ledger and archive call

    /// The key of a (ledger, block) pair in the set of blocks already used by tips.
    public func blockKey(ledger : Principal, index : Nat) : Text = Principal.toText(ledger) # ":" # Nat.toText(index);

    // ---- accounts ----

    func isDefault(sub : ?Blob) : Bool {
        switch (sub) {
            case null true;
            case (?b) { for (x in b.vals()) { if (x != 0) return false }; true };
        };
    };

    /// The main account of `owner` (no subaccount, or 32 zero bytes).
    public func isMainAccountOf(a : Account, owner : Principal) : Bool = a.owner == owner and isDefault(a.subaccount);

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

    /// The ICP ledger's account identifier of a principal's main account:
    /// CRC32 (big endian) ++ SHA-224("\x0Aaccount-id" ++ owner ++ 32 zero bytes).
    public func mainAccountIdentifier(owner : Principal) : Blob {
        let domain : [Nat8] = [0x0A, 0x61, 0x63, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x2d, 0x69, 0x64];
        let hash = Blob.toArray(Sha256.fromArray(#sha224, Array.flatten<Nat8>([domain, Blob.toArray(Principal.toBlob(owner)), Array.tabulate<Nat8>(32, func _ = 0)])));
        let c = crc32(hash);
        let check : [Nat8] = [Nat8.fromNat(Nat32.toNat((c >> 24) & 0xFF)), Nat8.fromNat(Nat32.toNat((c >> 16) & 0xFF)), Nat8.fromNat(Nat32.toNat((c >> 8) & 0xFF)), Nat8.fromNat(Nat32.toNat(c & 0xFF))];
        Blob.fromArray(Array.append<Nat8>(check, hash));
    };

    /// A transfer as read from any of the ledgers.
    type Transfer = { from : Account; to : Account; amount : Nat };
    type Read = { #transfer : Transfer; #other : Text; #missing; #failed : Text };

    func check(r : Read, index : Nat, from : Principal, to : Principal, amount : Nat) : Outcome {
        let b = "Block " # Nat.toText(index);
        switch (r) {
            case (#missing) #rejected("The ledger has no block " # Nat.toText(index));
            case (#failed m) #unchecked("Could not read the ledger: " # m);
            case (#other what) #rejected(b # " is " # what # ", not a plain transfer");
            case (#transfer t) {
                if (not isMainAccountOf(t.from, from)) return #rejected(b # " was not sent from the tipper's main account");
                if (not isMainAccountOf(t.to, to)) return #rejected(b # " was not sent to the post author's main account");
                if (t.amount != amount) return #rejected(b # " moved " # Nat.toText(t.amount) # ", not " # Nat.toText(amount));
                #verified;
            };
        };
    };

    // ---- ICRC-3 ledgers ----

    public type Value = { #Blob : Blob; #Text : Text; #Nat : Nat; #Int : Int; #Array : [Value]; #Map : [(Text, Value)] };
    type BlocksArgs = [{ start : Nat; length : Nat }];
    type BlocksResult = {
        blocks : [{ id : Nat; block : Value }];
        archived_blocks : [{ args : BlocksArgs; callback : shared query BlocksArgs -> async BlocksResult }];
    };
    type Icrc3Ledger = actor { icrc3_get_blocks : shared query BlocksArgs -> async BlocksResult };

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

    /// What an ICRC-3 block records: a plain ICRC-1 transfer (op "xfer", or btype "1xfer"), or
    /// something else (a mint, a burn, an approval, a transfer made with an approval).
    public func icrc3Read(block : Value) : Read {
        let tx = switch (field(block, "tx")) { case (?t) t; case null return #other("not a transaction") };
        let op = switch (textOf(field(tx, "op"))) { case (?o) o; case null switch (textOf(field(block, "btype"))) { case (?b) b; case null "" } };
        if (op != "xfer" and op != "1xfer") return #other(if (op == "mint" or op == "1mint") "a mint" else if (op == "burn" or op == "1burn") "a burn" else if (op == "approve" or op == "2approve") "an approval" else "\"" # op # "\"");
        if (field(tx, "spender") != null) return #other("a transfer made with an approval");
        let ?from = accountOf(field(tx, "from")) else return #other("a transfer without a sender");
        let ?to = accountOf(field(tx, "to")) else return #other("a transfer without a recipient");
        let ?amount = natOf(field(tx, "amt")) else return #other("a transfer without an amount");
        #transfer({ from; to; amount });
    };

    // ---- ledgers without ICRC-3: the ICRC ledger suite's get_transactions ----
    // Only the fields read here are declared.

    type LTransfer = { from : Account; to : Account; amount : Nat; spender : ?Account };
    type LTransaction = { kind : Text; transfer : ?LTransfer };
    type GetTxArgs = { start : Nat; length : Nat };
    type GetTxResult = {
        first_index : Nat;
        transactions : [LTransaction];
        archived_transactions : [{ start : Nat; length : Nat; callback : shared query GetTxArgs -> async { transactions : [LTransaction] } }];
    };
    type LegacyLedger = actor { get_transactions : shared query GetTxArgs -> async GetTxResult };

    func legacyRead(t : LTransaction) : Read {
        switch (t.transfer) {
            case (?x) if (x.spender != null) #other("a transfer made with an approval") else #transfer({ from = x.from; to = x.to; amount = x.amount });
            case null #other(if (t.kind == "mint") "a mint" else if (t.kind == "burn") "a burn" else if (t.kind == "approve") "an approval" else "\"" # t.kind # "\"");
        };
    };

    func legacyBlock(ledger : Principal, index : Nat) : async* Read {
        let l : LegacyLedger = actor (Principal.toText(ledger));
        let args = { start = index; length = 1 };
        try {
            let r = await (with timeout = TIMEOUT) l.get_transactions(args);
            if (r.first_index == index and r.transactions.size() > 0) return legacyRead(r.transactions[0]);
            for (a in r.archived_transactions.vals()) {
                if (a.start <= index and index < a.start + a.length) {
                    let ar = await (with timeout = TIMEOUT) a.callback(args);
                    if (ar.transactions.size() > 0) return legacyRead(ar.transactions[0]);
                    return #missing;
                };
            };
            #missing;
        } catch (e) { #failed(Error.message(e)) };
    };

    func icrcBlock(ledger : Principal, index : Nat) : async* Read {
        let l : Icrc3Ledger = actor (Principal.toText(ledger));
        let args = [{ start = index; length = 1 }];
        let r = try { await (with timeout = TIMEOUT) l.icrc3_get_blocks(args) } catch (_) {
            // no ICRC-3 (or it failed): the ledger suite's older method
            return await* legacyBlock(ledger, index);
        };
        try {
            for (b in r.blocks.vals()) if (b.id == index) return icrc3Read(b.block);
            for (a in r.archived_blocks.vals()) {
                let ar = await (with timeout = TIMEOUT) a.callback(a.args);
                for (b in ar.blocks.vals()) if (b.id == index) return icrc3Read(b.block);
            };
            #missing;
        } catch (e) { #failed(Error.message(e)) };
    };

    // ---- the ICP ledger (query_blocks; it has no ICRC-3) ----

    type Tokens = { e8s : Nat64 };
    type IcpOperation = {
        #Mint : {};
        #Burn : {};
        #Approve : {};
        #Transfer : { from : Blob; to : Blob; amount : Tokens; spender : ?[Nat8] };
    };
    type IcpBlock = { transaction : { operation : ?IcpOperation } };
    type IcpBlocksArgs = { start : Nat64; length : Nat64 };
    type IcpArchiveResult = { #Ok : { blocks : [IcpBlock] }; #Err : { #BadFirstBlockIndex : {}; #Other : {} } };
    type IcpQueryBlocksResponse = {
        blocks : [IcpBlock];
        first_block_index : Nat64;
        archived_blocks : [{ start : Nat64; length : Nat64; callback : shared query IcpBlocksArgs -> async IcpArchiveResult }];
    };
    type IcpLedger = actor { query_blocks : shared query IcpBlocksArgs -> async IcpQueryBlocksResponse };

    func icpCheck(ledger : Principal, index : Nat, from : Principal, to : Principal, amount : Nat) : async* Outcome {
        if (index >= 2 ** 64) return #rejected("The ledger has no block " # Nat.toText(index));
        let l : IcpLedger = actor (Principal.toText(ledger));
        let args = { start = Nat64.fromNat(index); length = 1 : Nat64 };
        let block : ?IcpBlock = try {
            let r = await (with timeout = TIMEOUT) l.query_blocks(args);
            if (r.blocks.size() > 0 and Nat64.toNat(r.first_block_index) == index) ?r.blocks[0] else {
                var found : ?IcpBlock = null;
                label search for (a in r.archived_blocks.vals()) {
                    if (Nat64.toNat(a.start) <= index and index < Nat64.toNat(a.start) + Nat64.toNat(a.length)) {
                        switch (await (with timeout = TIMEOUT) a.callback(args)) {
                            case (#Ok { blocks }) if (blocks.size() > 0) found := ?blocks[0];
                            case _ {};
                        };
                        break search;
                    };
                };
                found;
            };
        } catch (e) { return #unchecked("Could not read the ledger: " # Error.message(e)) };
        let b = "Block " # Nat.toText(index);
        let ?blk = block else return #rejected("The ledger has no block " # Nat.toText(index));
        switch (blk.transaction.operation) {
            case (?#Transfer t) {
                if (t.spender != null) return #rejected(b # " is a transfer made with an approval, not a plain transfer");
                if (t.from != mainAccountIdentifier(from)) return #rejected(b # " was not sent from the tipper's main account");
                if (t.to != mainAccountIdentifier(to)) return #rejected(b # " was not sent to the post author's main account");
                if (Nat64.toNat(t.amount.e8s) != amount) return #rejected(b # " moved " # Nat64.toText(t.amount.e8s) # ", not " # Nat.toText(amount));
                #verified;
            };
            case (?#Mint _) #rejected(b # " is a mint, not a plain transfer");
            case (?#Burn _) #rejected(b # " is a burn, not a plain transfer");
            case _ #rejected(b # " is not a plain transfer");
        };
    };

    /// Reads block `index` of `ledger` and checks it is a plain transfer of exactly `amount` from
    /// `from`'s main account to `to`'s main account. Never traps.
    public func verify(ledger : Principal, index : Nat, from : Principal, to : Principal, amount : Nat) : async* Outcome {
        if (Principal.toText(ledger) == ICP_LEDGER) return await* icpCheck(ledger, index, from, to, amount);
        check(await* icrcBlock(ledger, index), index, from, to, amount);
    };
};
