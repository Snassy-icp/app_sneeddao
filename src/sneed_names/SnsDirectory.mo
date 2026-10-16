import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat64 "mo:base/Nat64";
import Nat8 "mo:base/Nat8";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Sha256 "mo:sha2/Sha256";

/// Which SNSes exist, read from SNS-W (the NNS's registry of deployed SNSes), and the SNS
/// governance calls the naming canisters make. A root the caller passes in is only trusted
/// when SNS-W lists it: a made-up "root" could claim any governance canister and any neuron.
module {
  public type NeuronId = { id : Blob };
  public type Permission = { principal : ?Principal; permission_type : [Int32] };
  public type Neuron = { id : ?NeuronId; permissions : [Permission] };

  public let PERMISSION_MANAGE_PRINCIPALS : Int32 = 2;

  /// SNS-W on mainnet.
  public let SNS_W_MAINNET : Text = "qaa6y-5yaaa-aaaaa-aaafa-cai";

  /// How often SNS-W may be asked again for a root it did not list.
  public let REFRESH_INTERVAL_NS : Int = 60_000_000_000;

  public type State = {
    var snses : [(Principal, Principal)]; // (root, governance)
    var refreshed_at : Int;
  };

  public func init() : State = { var snses = []; var refreshed_at = 0 };

  type SnsW = actor {
    list_deployed_snses : shared query ({}) -> async {
      instances : [{ root_canister_id : ?Principal; governance_canister_id : ?Principal }];
    };
  };

  type Governance = actor {
    get_neuron : shared query ({ neuron_id : ?NeuronId }) -> async {
      result : ?{ #Neuron : Neuron; #Error : { error_message : Text; error_type : Int32 } };
    };
  };

  func cached(s : State, root : Principal) : ?Principal {
    switch (Array.find<(Principal, Principal)>(s.snses, func((r, _)) = r == root)) {
      case (?(_, g)) ?g;
      case null null;
    };
  };

  func refresh(s : State, snsw : Principal) : async* () {
    let reply = await (actor (Principal.toText(snsw)) : SnsW).list_deployed_snses({});
    s.snses := Array.mapFilter<{ root_canister_id : ?Principal; governance_canister_id : ?Principal }, (Principal, Principal)>(
      reply.instances,
      func(i) = switch (i.root_canister_id, i.governance_canister_id) {
        case (?r, ?g) ?(r, g);
        case _ null;
      },
    );
    s.refreshed_at := Time.now();
  };

  /// The governance canister of a deployed SNS, or null when `root` is not one.
  public func governanceOf(s : State, snsw : Principal, root : Principal) : async* ?Principal {
    switch (cached(s, root)) {
      case (?g) return ?g;
      case null {};
    };
    if (Time.now() - s.refreshed_at < REFRESH_INTERVAL_NS) return null;
    await* refresh(s, snsw);
    cached(s, root);
  };

  /// The root of the deployed SNS whose governance canister is `governance` (from the cache only:
  /// a governance canister calling us belongs to an SNS SNS-W listed when we last asked).
  public func rootOfGovernance(s : State, governance : Principal) : ?Principal {
    switch (Array.find<(Principal, Principal)>(s.snses, func((_, g)) = g == governance)) {
      case (?(r, _)) ?r;
      case null null;
    };
  };

  /// Make sure the cache is no older than REFRESH_INTERVAL_NS (callers that need rootOfGovernance).
  public func ensureFresh(s : State, snsw : Principal) : async* () {
    if (Time.now() - s.refreshed_at >= REFRESH_INTERVAL_NS) await* refresh(s, snsw);
  };

  /// The neuron as its SNS governance reports it.
  public func getNeuron(governance : Principal, neuronId : Blob) : async* ?Neuron {
    let reply = await (actor (Principal.toText(governance)) : Governance).get_neuron({ neuron_id = ?{ id = neuronId } });
    switch (reply.result) {
      case (?#Neuron(n)) ?n;
      case _ null;
    };
  };

  public func hasAnyPermission(n : Neuron, p : Principal) : Bool {
    Array.find<Permission>(n.permissions, func(x) = x.principal == ?p and x.permission_type.size() > 0) != null;
  };

  public func hasPermission(n : Neuron, p : Principal, perm : Int32) : Bool {
    Array.find<Permission>(n.permissions, func(x) = x.principal == ?p and Array.find<Int32>(x.permission_type, func(t) = t == perm) != null) != null;
  };

  /// The id of the neuron `controller` stakes with `memo` (SNS and NNS: the staking subaccount,
  /// SHA-256 of 0x0c "neuron-stake" ‖ principal bytes ‖ memo as 8 big-endian bytes).
  /// Nobody but `controller` can make a neuron with this id controlled by someone else: a claim of
  /// that subaccount gives `controller` the neuron's permissions.
  public func stakingNeuronId(controller : Principal, memo : Nat64) : Blob {
    let bytes = Array.flatten<Nat8>([
      [0x0c : Nat8],
      Blob.toArray(Text.encodeUtf8("neuron-stake")),
      Blob.toArray(Principal.toBlob(controller)),
      Array.tabulate<Nat8>(8, func(i) = Nat8.fromNat(Nat64.toNat((memo >> Nat64.fromNat(8 * (7 - i))) & 0xff))),
    ]);
    Sha256.fromArray(#sha256, bytes);
  };
};
