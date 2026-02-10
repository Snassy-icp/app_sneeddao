import Principal "mo:base/Principal";

/// Reusable types for the Botkey permission system.
/// 
/// Botkeys grant specific principals granular permissions to operate a bot canister 
/// without being a controller. This module defines the base types shared by all bots.
///
/// Each bot defines its own permission variant type that must include at minimum
/// #FullPermissions and #ManagePermissions from this base. Bot-specific permissions
/// are added to the bot's own variant type.
///
/// Permission IDs 0 and 1 are reserved:
///   0 = FullPermissions (grants all permissions, including future unknown ones)
///   1 = ManagePermissions (add/remove botkey principals and their permissions)
/// Bot-specific permissions start at ID 2.
module {

    /// Reserved numeric IDs for base permissions.
    /// All bots must use these IDs for the base permissions.
    public module BasePermission {
        public let FullPermissions: Nat = 0;
        public let ManagePermissions: Nat = 1;
    };

    /// Info about a botkey principal and their permissions (for API responses).
    /// Generic over the permission type so each bot can use its own variant.
    public type BotkeyPermissionInfo<P> = {
        principal: Principal;
        permissions: [P];
    };

};
