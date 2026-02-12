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
/// === Permission ID Ranges ===
/// Each bot type has a reserved range of numeric permission IDs.
/// Shared (base) permissions that apply to all bots use IDs 0–99.
/// Bot-specific permissions use their own reserved range:
///   - Shared/base:      0–99
///   - ICP Staking Bot: 100–199
///   - (future bots):   200–299, 300–399, etc.
///
/// Currently allocated shared permission IDs:
///   0 = FullPermissions (grants all permissions, including future unknown ones)
///   1 = ManagePermissions (add/remove botkey principals and their permissions)
///   2 = ViewChores (view bot chore statuses and configurations)
module {

    /// Reserved numeric IDs for shared base permissions (range 0–99).
    /// All bots must use these IDs for the base permissions.
    public module BasePermission {
        public let FullPermissions: Nat = 0;
        public let ManagePermissions: Nat = 1;
        public let ViewChores: Nat = 2;
    };

    /// Info about a botkey principal and their permissions (for API responses).
    /// Generic over the permission type so each bot can use its own variant.
    public type BotkeyPermissionInfo<P> = {
        principal: Principal;
        permissions: [P];
    };

};
