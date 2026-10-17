// A mock of the ICP ledger's block history for the donation tests: icrc1_transfer and a few test
// helpers record blocks the way the real ledger does (accounts as account identifiers), and
// query_blocks answers with the real ledger's types, serving the blocks below `archived_upto`
// through an archive callback (this canister's own archive_query_blocks). No balances are kept.
import Principal "mo:base/Principal";
import Blob "mo:base/Blob";
import Array "mo:base/Array";
import Buffer "mo:base/Buffer";
import Nat8 "mo:base/Nat8";
import Nat32 "mo:base/Nat32";
import Nat64 "mo:base/Nat64";
import Time "mo:base/Time";
import Int "mo:base/Int";
import Char "mo:base/Char";
import Sha256 "mo:sha2/Sha256";

persistent actor class MockIcpLedger() = this {
  type Account = { owner : Principal; subaccount : ?Blob };
  type Tokens = { e8s : Nat64 };
  type TimeStamp = { timestamp_nanos : Nat64 };
  type Operation = {
    #Mint : { to : Blob; amount : Tokens };
    #Burn : { from : Blob; spender : ?Blob; amount : Tokens };
    #Transfer : { from : Blob; to : Blob; amount : Tokens; fee : Tokens; spender : ?[Nat8] };
    #Approve : { from : Blob; spender : Blob; allowance_e8s : Int; allowance : Tokens; fee : Tokens; expires_at : ?TimeStamp; expected_allowance : ?Tokens };
  };
  type Transaction = { memo : Nat64; icrc1_memo : ?Blob; operation : ?Operation; created_at_time : TimeStamp };
  type Block = { parent_hash : ?Blob; transaction : Transaction; timestamp : TimeStamp };
  type GetBlocksArgs = { start : Nat64; length : Nat64 };
  type QueryArchiveResult = {
    #Ok : { blocks : [Block] };
    #Err : { #BadFirstBlockIndex : { requested_index : Nat64; first_valid_index : Nat64 }; #Other : { error_code : Nat64; error_message : Text } };
  };
  type QueryBlocksResponse = {
    chain_length : Nat64;
    certificate : ?Blob;
    blocks : [Block];
    first_block_index : Nat64;
    archived_blocks : [{ start : Nat64; length : Nat64; callback : shared query GetBlocksArgs -> async QueryArchiveResult }];
  };
  type TransferArg = { from_subaccount : ?Blob; to : Account; amount : Nat; fee : ?Nat; memo : ?Blob; created_at_time : ?Nat64 };
  type TransferResult = { #Ok : Nat; #Err : { #GenericError : { error_code : Nat; message : Text } } };

  var blocks : [Block] = [];
  var archived_upto : Nat = 0;

  func crc32(data : [Nat8]) : Nat32 {
    var crc : Nat32 = 0xFFFFFFFF;
    for (byte in data.vals()) {
      crc ^= Nat32.fromNat(Nat8.toNat(byte));
      var i = 0;
      while (i < 8) { crc := if (crc & 1 == 1) (crc >> 1) ^ 0xEDB88320 else crc >> 1; i += 1 };
    };
    crc ^ 0xFFFFFFFF;
  };
  func accountId(a : Account) : Blob {
    let sub : [Nat8] = switch (a.subaccount) { case (?b) Blob.toArray(b); case null Array.tabulate<Nat8>(32, func _ = 0) };
    let pre = Buffer.Buffer<Nat8>(64);
    pre.add(0x0A); for (c in "account-id".chars()) pre.add(Nat8.fromNat(Nat32.toNat(Char.toNat32(c))));
    for (b in Principal.toBlob(a.owner).vals()) pre.add(b);
    for (b in sub.vals()) pre.add(b);
    let h = Blob.toArray(Sha256.fromArray(#sha224, Buffer.toArray(pre)));
    let c = crc32(h);
    Blob.fromArray(Array.append<Nat8>([Nat8.fromNat(Nat32.toNat(c >> 24)), Nat8.fromNat(Nat32.toNat((c >> 16) & 0xFF)), Nat8.fromNat(Nat32.toNat((c >> 8) & 0xFF)), Nat8.fromNat(Nat32.toNat(c & 0xFF))], h));
  };
  func now() : TimeStamp = { timestamp_nanos = Nat64.fromNat(Int.abs(Time.now())) };
  func push(op : Operation) : Nat {
    let b : Block = { parent_hash = null; transaction = { memo = 0; icrc1_memo = null; operation = ?op; created_at_time = now() }; timestamp = now() };
    blocks := Array.append(blocks, [b]);
    blocks.size() - 1;
  };
  func range(start : Nat, length : Nat, upto : Nat) : [Block] {
    if (start >= upto) return [];
    let end = if (start + length > upto) upto else start + length;
    Array.tabulate<Block>(end - start, func(i) = blocks[start + i]);
  };

  public query func account_identifier(a : Account) : async Blob { accountId(a) };

  public shared ({ caller }) func icrc1_transfer(args : TransferArg) : async TransferResult {
    #Ok(push(#Transfer { from = accountId({ owner = caller; subaccount = args.from_subaccount }); to = accountId(args.to); amount = { e8s = Nat64.fromNat(args.amount) }; fee = { e8s = 10_000 }; spender = null }));
  };
  /// a transfer made by `spender` from `from`'s account with an approval
  public shared func test_transfer_from(from : Account, to : Account, spender : Account, amount : Nat) : async Nat {
    push(#Transfer { from = accountId(from); to = accountId(to); amount = { e8s = Nat64.fromNat(amount) }; fee = { e8s = 10_000 }; spender = ?Blob.toArray(accountId(spender)) });
  };
  public shared func test_mint(to : Account, amount : Nat) : async Nat {
    push(#Mint { to = accountId(to); amount = { e8s = Nat64.fromNat(amount) } });
  };
  public shared func test_approve(from : Account, spender : Account) : async Nat {
    push(#Approve { from = accountId(from); spender = accountId(spender); allowance_e8s = 1; allowance = { e8s = 1 }; fee = { e8s = 10_000 }; expires_at = null; expected_allowance = null });
  };
  /// blocks below `n` are served by the archive callback only
  public shared func set_archived_upto(n : Nat) : async () { archived_upto := n };

  public query func query_blocks(args : GetBlocksArgs) : async QueryBlocksResponse {
    let start = Nat64.toNat(args.start); let length = Nat64.toNat(args.length);
    let first = if (start < archived_upto) archived_upto else start;
    let archivedLen : Nat = if (start < archived_upto) (if (start + length > archived_upto) archived_upto - start else length) else 0;
    {
      chain_length = Nat64.fromNat(blocks.size());
      certificate = null;
      blocks = if (start + length <= archived_upto) [] else range(first, start + length - first, blocks.size());
      first_block_index = Nat64.fromNat(first);
      archived_blocks = if (archivedLen == 0) [] else [{ start = args.start; length = Nat64.fromNat(archivedLen); callback = archive_query_blocks }];
    };
  };

  public query func archive_query_blocks(args : GetBlocksArgs) : async QueryArchiveResult {
    #Ok({ blocks = range(Nat64.toNat(args.start), Nat64.toNat(args.length), archived_upto) });
  };
};
