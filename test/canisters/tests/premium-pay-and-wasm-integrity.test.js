// Two frontend fixes found while building the MCP's write tools (2026-10-30). No canister needed.
//   1. Bot upgrades (UpgradeBotsDialog, BotManagementPanel, IcpNeuronManager) installed a wasm
//      downloaded from the version's URL after checking only its magic bytes: a file swapped at the URL
//      would have been installed. Now its sha256 must be the version's published wasmHash
//      (src/app_sneeddao_frontend/src/utils/wasmIntegrity.js).
//   2. Premium "Pay Now" always sent the tier's full price. purchaseWithIcp matches the WHOLE deposit
//      to a tier, so with anything already in the deposit no tier matched and the ICP sat there. Now
//      only the shortfall is sent, and a deposit above the price is offered back first
//      (src/app_sneeddao_frontend/src/utils/premiumPayPlan.js).
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { verifyDownloadedWasm } from '../../../src/app_sneeddao_frontend/src/utils/wasmIntegrity.js';
import { planPremiumPayment } from '../../../src/app_sneeddao_frontend/src/utils/premiumPayPlan.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 1, 2, 3]);
const GZ = new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 3]);
const OTHER = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 9, 9, 9]); // a valid-looking but different module

describe('verifyDownloadedWasm', () => {
    it('accepts the published module, plain or gzipped, with the hash as text or as an opt text', () => {
        expect(() => verifyDownloadedWasm(WASM, sha(WASM))).not.toThrow();
        expect(() => verifyDownloadedWasm(GZ, sha(GZ).toUpperCase())).not.toThrow();
        expect(() => verifyDownloadedWasm(WASM, [sha(WASM)])).not.toThrow();
    });
    it('refuses a different module behind the URL, even though it looks like a wasm', () => {
        expect(() => verifyDownloadedWasm(OTHER, sha(WASM), 'v0.9.5')).toThrow(/does not match its published hash/);
    });
    it('refuses a version without a published hash, an empty file and a non-wasm file', () => {
        expect(() => verifyDownloadedWasm(WASM, '')).toThrow(/No published WASM hash/);
        expect(() => verifyDownloadedWasm(WASM, [])).toThrow(/No published WASM hash/);
        expect(() => verifyDownloadedWasm(new Uint8Array([]), sha(WASM))).toThrow(/empty/);
        const html = new TextEncoder().encode('<html>');
        expect(() => verifyDownloadedWasm(html, sha(html))).toThrow(/not a valid WASM/);
    });
});

// The canister's tier match (sneed_premium matchIcpTier): the whole deposit must equal a price.
const matches = (deposit, price) => deposit === price;

describe('planPremiumPayment', () => {
    const PRICE = 100_000_000n;
    it('an empty deposit: sends the full price, and the deposit then matches the tier', () => {
        const p = planPremiumPayment(0n, PRICE);
        expect(p.send).toBe(PRICE);
        expect(matches(0n + p.send, PRICE)).toBe(true);
    });
    it('part of the price already in the deposit (an earlier failed purchase): sends only the rest, so the purchase matches', () => {
        const p = planPremiumPayment(30_000_000n, PRICE);
        expect(p.send).toBe(70_000_000n);
        expect(matches(30_000_000n + p.send, PRICE)).toBe(true);
    });
    it('the deposit already holds exactly the price: sends nothing, the purchase uses it', () => {
        expect(planPremiumPayment(PRICE, PRICE)).toEqual({ send: 0n });
    });
    it('the deposit holds more than the price: nothing is sent, the page offers to withdraw it first', () => {
        expect(planPremiumPayment(PRICE + 1n, PRICE)).toEqual({ tooMuch: true });
    });
});
