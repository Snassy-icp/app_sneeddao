import OrderedMap "mo:base/OrderedMap";

/// Types of sneed_drive phase 0 (spec/sneed_drive_phase0.md; full design spec/sneed_drive.md).
module {

  public type NodeId = Nat;
  public type VersionId = Nat;

  public type Kind = { #folder; #file };

  /// A grant's role. `manage` includes `write`, which includes `read`.
  public type Role = { #read; #write; #manage };

  /// What the caller may do at a node: a role, or everything as the owner.
  public type Access = { #read; #write; #manage; #owner };

  public type TrashInfo = {
    at : Int;
    by : Principal;
    root : Bool; // this node was deleted itself (it is a trash root), not only through an ancestor
  };

  /// A version's bytes. Phase 0 stores only `#inline`; `#chunks` is phase 1 (spec §3–4).
  public type Content = {
    #inline : Blob;
    #chunks : { hashes : [Blob] };
  };

  public type Version = {
    id : VersionId;
    node : NodeId;
    size : Nat;
    mime : Text;
    sha256 : Blob; // of the (plaintext) bytes
    content : Content;
    wrapped_key : ?Blob; // phase 1: the content key wrapped by the scope key; null = plaintext
    format_version : Nat; // 0 = inline plaintext
    created_at : Int;
    created_by : Principal;
  };

  public type Node = {
    id : NodeId;
    kind : Kind;
    var parent : ?NodeId; // null only for the root; kept while trashed
    var name : Text;
    var name_key : Text;
    var tags : [Text];
    var head : ?VersionId;
    var versions : [VersionId]; // oldest first
    var children : OrderedMap.Map<Text, NodeId>; // name_key -> child, live children only
    var trashed_children : [NodeId]; // trash roots whose parent is this folder
    var trashed : ?TrashInfo;
    created_at : Int;
    created_by : Principal;
    var modified_at : Int;
    var modified_by : Principal;
    var seq : Nat;
    // reserved for phase 1 (spec §3, §5); always plaintext in phase 0
    var scope : Nat;
    var key_epoch : Nat;
    var encrypted : Bool;
    var meta : Blob;
  };

  public type Retention = {
    keep_versions : Nat; // 0 = all, up to max_versions_per_node
    trash_days : Nat; // 0 = keep trash until purged
  };

  public type Settings = {
    max_nodes : Nat;
    max_versions_per_node : Nat;
    max_total_bytes : Nat;
    retention : Retention;
  };

  public type SettingsUpdate = {
    max_nodes : ?Nat;
    max_versions_per_node : ?Nat;
    max_total_bytes : ?Nat;
    retention : ?Retention;
  };

  public type InitArgs = {
    owner : ?Principal;
    settings : ?SettingsUpdate;
  };

  public type DriveError = {
    #not_found;
    #forbidden;
    #not_signed_in;
    #in_trash;
    #not_in_trash;
    #name_taken : NodeId;
    #conflict : { head : ?VersionId };
    #invalid : Text;
    #limit : Text;
  };

  public type Result<T> = { #ok : T; #err : DriveError };

  /// Content as written: UTF-8 text (the dfx-friendly form) or raw bytes.
  public type ContentIn = { #text : Text; #bytes : Blob };

  public type NodeInfo = {
    id : NodeId;
    kind : Kind;
    parent : ?NodeId;
    name : Text;
    tags : [Text];
    head : ?VersionId;
    versions : Nat;
    size : Nat; // the head version's size (files)
    mime : Text; // the head version's mime (files)
    children : Nat; // live children (folders)
    created_at : Int;
    created_by : Principal;
    modified_at : Int;
    modified_by : Principal;
    trashed : ?TrashInfo;
    in_trash : Bool; // this node or an ancestor is trashed
    encrypted : Bool;
    scope : Nat;
    seq : Nat;
    my_access : Access;
  };

  public type VersionInfo = {
    id : VersionId;
    size : Nat;
    mime : Text;
    sha256 : Blob;
    created_at : Int;
    created_by : Principal;
    is_head : Bool;
  };

  public type ContentOut = {
    node : NodeId;
    version : VersionId;
    mime : Text;
    size : Nat;
    sha256 : Blob;
    bytes : Blob;
    text : ?Text; // the bytes as text when they are valid UTF-8
  };

  public type PathEntry = { id : NodeId; name : Text };

  public type Grant = { principal : Principal; role : Role };
  public type InheritedGrant = { node : NodeId; principal : Principal; role : Role };
  public type Grants = { node : NodeId; direct : [Grant]; inherited : [InheritedGrant] };

  public type SharedEntry = { node : NodeInfo; role : Role };

  public type ChildrenPage = { items : [NodeInfo]; next : ?Text };
  public type NodePage = { items : [NodeInfo]; next : ?NodeId };
  public type VersionPage = { items : [VersionInfo]; next : ?VersionId };
  public type SharedPage = { items : [SharedEntry]; next : ?NodeId };

  public type SearchArgs = {
    query_ : Text; // empty = match on tags / kind only
    tags : [Text]; // all of them must be on the node
    under : ?NodeId; // only inside this folder
    kind : ?Kind;
    in_content : Bool; // also search the text of inline text files
    include_trash : Bool;
    after : ?NodeId;
    limit : Nat;
  };

  public type SearchHit = {
    node : NodeInfo;
    matched : { #name; #tag; #content; #filter };
    snippet : ?Text; // around the first content match
  };

  public type SearchPage = { hits : [SearchHit]; next : ?NodeId };

  public type TagCount = { tag : Text; count : Nat };
  public type TagPage = { tags : [TagCount]; next : ?NodeId };

  public type PurgeResult = { purged : Nat; done : Bool };

  public type Limits = {
    max_inline_bytes : Nat;
    hard_max_nodes : Nat;
    hard_max_versions_per_node : Nat;
    hard_max_total_bytes : Nat;
    max_children : Nat;
    max_depth : Nat;
    max_name_chars : Nat;
    max_tags_per_node : Nat;
    max_tag_chars : Nat;
    max_distinct_tags : Nat;
    max_grants_per_node : Nat;
    max_grants_per_principal : Nat;
    max_grants_total : Nat;
    max_page : Nat;
    max_search_hits : Nat;
    search_scan_nodes : Nat;
    search_scan_bytes : Nat;
    purge_batch : Nat;
  };

  public type DriveInfo = {
    owner : ?Principal; // null: the controllers own the drive
    nodes : Nat;
    files : Nat;
    folders : Nat;
    versions : Nat;
    total_bytes : Nat;
    trash_roots : Nat;
    grants : Nat;
    distinct_tags : Nat;
    seq : Nat;
    settings : Settings;
    limits : Limits;
    cycles : Nat;
    version : Text;
  };

  public type LogEntry = { id : Nat; ts : Int; level : { #info; #error }; cid : Nat; caller : Principal; message : Text };
};
