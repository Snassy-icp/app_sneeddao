import Principal "mo:base/Principal";
import Array "mo:base/Array";
import Buffer "mo:base/Buffer";

import BotkeyTypes "BotkeyTypes";

/// Reusable botkey permission engine.
/// 
/// Generic over the bot's permission variant type <P>.
/// Each bot instantiates this module with its own permission type, permission map,
/// and variant<->ID conversion functions.
///
/// Usage in a bot canister:
/// ```
///   let permEngine = BotkeyPermissions.Engine<T.MyPermissionType>({
///       permissionMap = MY_PERMISSION_MAP;
///       variantToId = myVariantToId;
///       idToVariant = myIdToVariant;
///   });
/// ```
module {

    /// Configuration needed to create a permission engine for a specific bot.
    public type Config<P> = {
        /// The full permission map: numeric ID -> variant, for all permissions this bot supports.
        /// Must include (0, #FullPermissions) and (1, #ManagePermissions).
        permissionMap: [(Nat, P)];
        /// Convert a permission variant to its numeric ID.
        variantToId: (P) -> Nat;
        /// Convert a numeric ID to a permission variant (null if unknown).
        idToVariant: (Nat) -> ?P;
    };

    /// The permission engine, generic over permission type P.
    /// Provides all the logic for checking, querying, adding, and removing permissions.
    public class Engine<P>(config: Config<P>) {

        let permissionMap = config.permissionMap;
        let variantToId = config.variantToId;
        let idToVariant = config.idToVariant;

        // ============================================
        // CONVERSION HELPERS
        // ============================================

        /// Convert an array of permission variants to numeric IDs.
        public func variantsToIds(perms: [P]): [Nat] {
            Array.map<P, Nat>(perms, variantToId)
        };

        /// Convert an array of numeric IDs to permission variants (skipping unknown IDs).
        public func idsToVariants(ids: [Nat]): [P] {
            let result = Buffer.Buffer<P>(ids.size());
            for (id in ids.vals()) {
                switch (idToVariant(id)) {
                    case (?v) { result.add(v) };
                    case null {}; // Skip unknown IDs from future versions
                };
            };
            Buffer.toArray(result)
        };

        // ============================================
        // PERMISSION CHECKING
        // ============================================

        /// Check if an array contains a specific Nat value.
        public func arrayContainsNat(arr: [Nat], val: Nat): Bool {
            for (item in arr.vals()) {
                if (item == val) return true;
            };
            false
        };

        /// Check if a caller has a specific permission.
        /// Controllers always have all permissions.
        /// FullPermissions (ID 0) grants all permissions, including future unknown ones.
        public func callerHasPermission(
            caller: Principal,
            permissionId: Nat,
            botkeyPermissions: [(Principal, [Nat])]
        ): Bool {
            if (Principal.isController(caller)) return true;
            for ((p, ids) in botkeyPermissions.vals()) {
                if (Principal.equal(p, caller)) {
                    // FullPermissions (ID 0) implies every permission
                    if (arrayContainsNat(ids, BotkeyTypes.BasePermission.FullPermissions)) return true;
                    return arrayContainsNat(ids, permissionId);
                };
            };
            false
        };

        /// Assert that the caller has a specific permission (traps if not).
        public func assertPermission(
            caller: Principal,
            permissionId: Nat,
            botkeyPermissions: [(Principal, [Nat])]
        ) {
            assert(callerHasPermission(caller, permissionId, botkeyPermissions));
        };

        // ============================================
        // QUERY HELPERS
        // ============================================

        /// Get permissions for a specific botkey principal (as variants).
        public func getPermissions(
            principal: Principal,
            botkeyPermissions: [(Principal, [Nat])]
        ): [P] {
            for ((p, ids) in botkeyPermissions.vals()) {
                if (Principal.equal(p, principal)) {
                    return idsToVariants(ids);
                };
            };
            []
        };

        /// List all botkey principals and their permissions.
        public func listPrincipals(
            botkeyPermissions: [(Principal, [Nat])]
        ): [BotkeyTypes.BotkeyPermissionInfo<P>] {
            let result = Buffer.Buffer<BotkeyTypes.BotkeyPermissionInfo<P>>(botkeyPermissions.size());
            for ((p, ids) in botkeyPermissions.vals()) {
                result.add({ principal = p; permissions = idsToVariants(ids) });
            };
            Buffer.toArray(result)
        };

        /// Get the full permission map (all known permission types and their IDs).
        public func listPermissionTypes(): [(Nat, P)] {
            permissionMap
        };

        /// Get all permission variants for a caller.
        /// Controllers and principals with FullPermissions get all permissions.
        public func getCallerPermissions(
            caller: Principal,
            botkeyPermissions: [(Principal, [Nat])]
        ): [P] {
            if (Principal.isController(caller)) {
                return getAllPermissionVariants();
            };
            for ((p, ids) in botkeyPermissions.vals()) {
                if (Principal.equal(p, caller)) {
                    if (arrayContainsNat(ids, BotkeyTypes.BasePermission.FullPermissions)) {
                        return getAllPermissionVariants();
                    };
                    return idsToVariants(ids);
                };
            };
            []
        };

        /// Check if a caller has a specific permission (variant version).
        public func checkPermission(
            caller: Principal,
            permission: P,
            botkeyPermissions: [(Principal, [Nat])]
        ): Bool {
            callerHasPermission(caller, variantToId(permission), botkeyPermissions)
        };

        // ============================================
        // MUTATION HELPERS
        // ============================================

        /// Add permissions to a botkey principal (merges with existing permissions).
        /// Returns the updated botkeyPermissions array.
        public func addPermissions(
            principal: Principal,
            permissions: [P],
            botkeyPermissions: [(Principal, [Nat])]
        ): [(Principal, [Nat])] {
            let newIds = variantsToIds(permissions);
            let updated = Buffer.Buffer<(Principal, [Nat])>(botkeyPermissions.size() + 1);
            var found = false;
            for ((p, ids) in botkeyPermissions.vals()) {
                if (Principal.equal(p, principal)) {
                    found := true;
                    let merged = Buffer.Buffer<Nat>(ids.size() + newIds.size());
                    for (id in ids.vals()) { merged.add(id) };
                    for (id in newIds.vals()) {
                        if (not arrayContainsNat(Buffer.toArray(merged), id)) {
                            merged.add(id);
                        };
                    };
                    updated.add((p, Buffer.toArray(merged)));
                } else {
                    updated.add((p, ids));
                };
            };
            if (not found) {
                updated.add((principal, newIds));
            };
            Buffer.toArray(updated)
        };

        /// Remove specific permissions from a botkey principal.
        /// If all permissions are removed, the principal is removed entirely.
        /// Returns the updated botkeyPermissions array.
        public func removePermissions(
            principal: Principal,
            permissions: [P],
            botkeyPermissions: [(Principal, [Nat])]
        ): [(Principal, [Nat])] {
            let removeIds = variantsToIds(permissions);
            let updated = Buffer.Buffer<(Principal, [Nat])>(botkeyPermissions.size());
            for ((p, ids) in botkeyPermissions.vals()) {
                if (Principal.equal(p, principal)) {
                    let remaining = Array.filter<Nat>(ids, func(id) {
                        not arrayContainsNat(removeIds, id)
                    });
                    if (remaining.size() > 0) {
                        updated.add((p, remaining));
                    };
                } else {
                    updated.add((p, ids));
                };
            };
            Buffer.toArray(updated)
        };

        /// Remove a botkey principal entirely (removes all their permissions).
        /// Returns the updated botkeyPermissions array.
        public func removePrincipal(
            principal: Principal,
            botkeyPermissions: [(Principal, [Nat])]
        ): [(Principal, [Nat])] {
            Array.filter<(Principal, [Nat])>(
                botkeyPermissions,
                func((p, _)) { not Principal.equal(p, principal) }
            )
        };

        // ============================================
        // INTERNAL HELPERS
        // ============================================

        /// Get all permission variants from the map.
        func getAllPermissionVariants(): [P] {
            let all = Buffer.Buffer<P>(permissionMap.size());
            for ((_, v) in permissionMap.vals()) {
                all.add(v);
            };
            Buffer.toArray(all)
        };
    };
};
