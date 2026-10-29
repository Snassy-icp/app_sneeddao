// The neuron page's permission form (src/app_sneeddao_frontend/src/utils/neuronPermissionPlan.js). No canister needed.
//   Fixed 2026-10-29: "Update" on a principal's permissions did nothing for your own principal (the page
//   refused every change to it, and showed the error far above the button), and for others it removed
//   ALL permissions before re-adding the new set, so a failed second call left the principal with fewer
//   permissions than before. Now only the difference is sent (add first, then remove), and only giving
//   up the last Manage Principals is refused.
import { describe, it, expect } from 'vitest';
import { planPermissionChange } from '../../../src/app_sneeddao_frontend/src/utils/neuronPermissionPlan.js';

const ME = 'me-principal', OTHER = 'other-principal';
const FULL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('planPermissionChange', () => {
    it('lets you remove Vote from your own principal (the reported case), sending only that change', () => {
        const plan = planPermissionChange({ principal: ME, me: ME, existing: FULL, wanted: FULL.filter((p) => p !== 4), permissions: [{ principal: ME, permission_type: FULL }] });
        expect(plan).toEqual({ add: [], remove: [4] });
    });
    it('only sends the difference', () => {
        expect(planPermissionChange({ principal: OTHER, me: ME, existing: [3, 4], wanted: [4, 8], permissions: [] })).toEqual({ add: [8], remove: [3] });
    });
    it('refuses to remove the last Manage Principals, yours or anyone else\'s', () => {
        const perms = [{ principal: ME, permission_type: FULL }, { principal: OTHER, permission_type: [4] }];
        expect(planPermissionChange({ principal: ME, me: ME, existing: FULL, wanted: [4], permissions: perms }).error).toMatch(/only principal/);
    });
    it('allows removing Manage Principals when someone else still has it', () => {
        const perms = [{ principal: ME, permission_type: FULL }, { principal: OTHER, permission_type: [2] }];
        expect(planPermissionChange({ principal: ME, me: ME, existing: FULL, wanted: [4], permissions: perms }).remove).toContain(2);
    });
    it('asks for a permission when adding a principal with none', () => {
        expect(planPermissionChange({ principal: OTHER, me: ME, existing: [], wanted: [], permissions: [] }).error).toMatch(/at least one/);
    });
});
