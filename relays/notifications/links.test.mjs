// node --test (npm test): what a relayed notification links to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hubLink, notificationPage, pushLink, shownLink, titleHash } from './links.mjs';

const PROD = 'https://app.sneeddao.com';
const STAGING = 'https://staging-hub.example.io';
const sms = { app: 'Sneed SMS', title: 'New message from Mr Sneed', body: 'gm', link: ['https://app.sneeddao.com/msg/42'], created_at: 1761000000000000000n };

test('a tapped Sneed SMS push opens the message, not the inbox', () => {
    assert.equal(pushLink(sms, PROD, false), 'https://app.sneeddao.com/msg/42');
    assert.equal(pushLink(sms, PROD, true), 'https://app.sneeddao.com/msg/42');
});

test('the staging relay opens the message on staging', () => {
    assert.equal(pushLink(sms, STAGING, false), `${STAGING}/msg/42`);
    assert.equal(pushLink({ ...sms, link: [`${STAGING}/msg/7?x=1#r`] }, STAGING, false), `${STAGING}/msg/7?x=1#r`);
});

test('no link, or an off-site link: the notification page, as before', () => {
    for (const link of [[], ['https://evil.example/msg/42'], ['http://app.sneeddao.com/msg/42'], ['javascript:alert(1)'], ['not a url'], ['https://app.sneeddao.com.evil.example/x']]) {
        const job = { ...sms, link };
        assert.equal(pushLink(job, PROD, false), `${PROD}/notifications`, String(link));
        assert.equal(pushLink(job, PROD, true), `${PROD}/notifications/push?t=${job.created_at}&h=${titleHash(job.title)}`, String(link));
    }
});

test('a local hub on http may link to itself', () => {
    assert.equal(hubLink('http://localhost:3000/sms', 'http://localhost:3000'), 'http://localhost:3000/sms');
    assert.equal(hubLink('http://localhost:3001/sms', 'http://localhost:3000'), null);
});

test('Discord shows Sneed Hub links on the relay\'s hub and other links as sent', () => {
    assert.equal(shownLink(sms, STAGING), `${STAGING}/msg/42`);
    assert.equal(shownLink({ ...sms, link: ['https://example.com/a'] }, STAGING), 'https://example.com/a');
    assert.equal(shownLink({ ...sms, link: [] }, STAGING), null);
});

test('notificationPage and titleHash are unchanged (the frontend matches the hash)', () => {
    assert.equal(notificationPage(sms, PROD, false), `${PROD}/notifications`);
    assert.equal(titleHash(''), (0x811c9dc5).toString(36));
});
