// How to change one principal's permissions on an SNS neuron (the neuron page's Add/Update form).

const MANAGE_PRINCIPALS = 2;

/// The calls that take a principal from `existing` to `wanted` permissions (arrays of permission
/// numbers): `{ add, remove }` with only the permissions that change, or `{ error }`. A principal may
/// change its own permissions too, but may not give up Manage Principals while nobody else on the
/// neuron has it: that would lock everyone out of managing the neuron.
/// `permissions` is the neuron's whole list: [{ principal: text, permission_type: number[] }].
export function planPermissionChange({ principal, existing = [], wanted = [], permissions = [], me }) {
    const add = wanted.filter((p) => !existing.includes(p));
    const remove = existing.filter((p) => !wanted.includes(p));
    if (add.length === 0 && remove.length === 0) {
        return existing.length === 0 ? { error: 'Please select at least one permission' } : { add, remove };
    }
    if (remove.includes(MANAGE_PRINCIPALS)) {
        const otherManagers = permissions.filter((p) => String(p.principal) !== String(principal) && (p.permission_type || []).includes(MANAGE_PRINCIPALS));
        if (otherManagers.length === 0) {
            return { error: String(principal) === String(me)
                ? 'You are the only principal that can manage this neuron, so you cannot remove your own Manage Principals permission.'
                : 'This is the only principal that can manage this neuron, so its Manage Principals permission cannot be removed.' };
        }
    }
    return { add, remove };
}
