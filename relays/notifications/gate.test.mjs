// node --test: the relay pulls (a paid update call) only when there is work.
//   Fixed 2026-11-02: both relays called relay_pull every 15 s, idle or not, which cost the
//   notifications canister ~100B cycles a day on staging (and the same on prod).
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldPull, SAFETY_PULL_MS } from './gate.mjs';

const T = 1_800_000_000_000;

test('nothing pending: no pull (the free stats query is enough)', () => {
    assert.equal(shouldPull(0n, T, T + 15_000), false);
});
test('a job pending: pull', () => {
    assert.equal(shouldPull(1n, T, T + 15_000), true);
});
test('stats unreadable: pull anyway, deliveries never depend on the query', () => {
    assert.equal(shouldPull(null, T, T + 15_000), true);
});
test('a safety pull every 30 minutes even when idle', () => {
    assert.equal(shouldPull(0n, T, T + SAFETY_PULL_MS - 1), false);
    assert.equal(shouldPull(0n, T, T + SAFETY_PULL_MS), true);
});
test('idle for a day: at most 48 paid pulls per relay instead of 5760', () => {
    let last = T, pulls = 0;
    for (let t = T + 15_000; t <= T + 86_400_000; t += 15_000) if (shouldPull(0n, last, t)) { pulls++; last = t; }
    assert.ok(pulls <= 48, `pulls ${pulls}`);
});
