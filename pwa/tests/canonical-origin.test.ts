import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mainAddressRedirect } from '../lib/canonical-origin';
import { pairingLink, parsePairingLink } from '../lib/sync/pairing';

const MAIN = 'https://dictationoperative.com';
const OLD = 'https://do-voice-workspace.davisopp.workers.dev';
const config = { BETTER_AUTH_URL: MAIN, AUTH_ADDITIONAL_ORIGINS: OLD };
const get = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

void test('a page opened on the old address moves to the main one', () => {
  const moved = mainAddressRedirect(
    get(OLD + '/login?returnTo=%2Faccount%2Fsign-in', { 'Sec-Fetch-Mode': 'navigate' }),
    config,
  );
  assert.equal(moved?.status, 302);
  assert.equal(moved?.headers.get('Location'), MAIN + '/login?returnTo=%2Faccount%2Fsign-in');
  assert.equal(moved?.headers.get('Cache-Control'), 'no-store');
  // A link followed from another app sends no fetch metadata at all.
  assert.equal(mainAddressRedirect(get(OLD + '/pair'), config)?.headers.get('Location'), MAIN + '/pair');
});

void test('everything else is left where it is', () => {
  const stays = (request: Request, c = config) => assert.equal(mainAddressRedirect(request, c), null);
  stays(get(MAIN + '/login', { 'Sec-Fetch-Mode': 'navigate' }));
  // APIs keep answering on the old address for apps that already call it.
  stays(get(OLD + '/api/auth/get-session'));
  stays(get(OLD + '/api/v1/workspace'));
  stays(new Request(OLD + '/login', { method: 'POST' }));
  // A page's own requests would fail on a cross-origin redirect.
  stays(get(OLD + '/login', { 'Sec-Fetch-Mode': 'cors' }));
  stays(get(OLD + '/sw.js', { 'Sec-Fetch-Mode': 'same-origin' }));
  // Addresses nobody listed: local development and preview deployments.
  stays(get('http://localhost:3000/login'), { BETTER_AUTH_URL: 'http://localhost:3000', AUTH_ADDITIONAL_ORIGINS: '' });
  stays(get('https://abc123-do-voice-workspace.davisopp.workers.dev/login'));
  stays(get(OLD + '/login'), { BETTER_AUTH_URL: '', AUTH_ADDITIONAL_ORIGINS: OLD });
});

void test('a pairing link opens on the main address and on the old one', () => {
  const key = 'A'.repeat(87);
  const link = pairingLink('abc234', key);
  assert.equal(link, `${MAIN}/pair#code=ABC234&key=${key}`);
  assert.deepEqual(parsePairingLink(link), { code: 'ABC234', publicKey: key });
  // What an installed Mac app shows, before and after the redirect above.
  assert.deepEqual(parsePairingLink(`${OLD}/pair#code=ABC234&key=${key}`), { code: 'ABC234', publicKey: key });
  assert.equal(parsePairingLink(`https://example.com/pair#code=ABC234&key=${key}`), null);
});
