// Token Studio's "Minting account cannot mint at will" verdicts that need no chain read
// (src/app_sneeddao_frontend/src/tokensafety/mintingOwner.js). No canister needed.
//   Fixed 2026-10-25: a ledger whose minting account is the management canister (aaaaa-aa) was rated
//   "A user principal: its holder can mint without limit" (any id that isn't 27 characters long was
//   taken for a user), though aaaaa-aa never sends a ledger transfer, so nothing can mint.
import { describe, it, expect } from 'vitest';
import { knownMintingOwner } from '../../../src/app_sneeddao_frontend/src/tokensafety/mintingOwner.js';

const LEDGER = 'ryjl3-tyaaa-aaaaa-aaaba-cai';
const USER = 'd7zib-qo5mr-qzmpb-dtyof-l7yiu-pu52k-wk7ng-cbm3n-ffmys-crbkz-nae';

describe('knownMintingOwner', () => {
    it('passes the management canister: it cannot mint', () => {
        const v = knownMintingOwner('aaaaa-aa', LEDGER);
        expect(v.grade).toBe('pass');
        expect(v.label).toMatch(/management canister/);
    });
    it('still fails a user principal', () => {
        expect(knownMintingOwner(USER, LEDGER)).toMatchObject({ grade: 'fail', link: 'principal' });
    });
    it('keeps the other known owners', () => {
        expect(knownMintingOwner(LEDGER, LEDGER)).toMatchObject({ grade: 'pass', link: 'canister' });
        expect(knownMintingOwner('2vxsx-fae', LEDGER).grade).toBe('pass');
        expect(knownMintingOwner('rrkah-fqaaa-aaaaa-aaaaq-cai', LEDGER, { 'rrkah-fqaaa-aaaaa-aaaaq-cai': 'NNS governance' })).toMatchObject({ grade: 'pass', link: 'canister' });
        expect(knownMintingOwner('e3mmv-5qaaa-aaaah-aadma-cai', LEDGER, {}, { 'e3mmv-5qaaa-aaaah-aadma-cai': 'blackhole v0' }).grade).toBe('pass');
    });
    it('leaves other canisters to the chain lookup', () => {
        expect(knownMintingOwner('pqsms-lqaaa-aaaal-ajjza-cai', LEDGER)).toBeNull();
    });
});
