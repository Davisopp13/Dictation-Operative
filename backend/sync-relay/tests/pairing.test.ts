import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { PairingClient, validCode, displayCode, parsePairingLink } from '../../../Shared/Sync/pairing';
import { SyncClient, url64 } from '../../../Shared/Sync/protocol';

let mf: Miniflare;
const request: typeof fetch = ((url: string | URL | Request, init?: RequestInit) => mf.dispatchFetch(String(url), init as never)) as typeof fetch;
const device = (name: string) => ({ id: crypto.randomUUID(), name });
before(() => {
  // Test-only subclass allows clock expiry and storage assertions without exposing production routes.
  mf = new Miniflare({
    modules: [
      { type: 'ESModule', path: 'test-worker.js', contents: `
        import worker, { PairingSession } from './relay.js';
        export { SyncPair } from './relay.js';
        export class TestPairingSession extends PairingSession {
          inspect() { return this.ctx.storage.sql.exec('SELECT value FROM pairing').toArray(); }
          expire() {
            const row = this.inspect()[0];
            const s = JSON.parse(row.value); s.expiresAt = Date.now() - 1;
            this.ctx.storage.sql.exec('UPDATE pairing SET value=?', JSON.stringify(s));
          }
          async purgeNow() { await this.alarm(); }
        }
        export default { async fetch(req, env) {
          const action = new URL(req.url).pathname;
          if (action.startsWith('/test/')) {
            const { code } = await req.json(), stub = env.PAIRING.getByName(code);
            if (action === '/test/expire') await stub.expire();
            if (action === '/test/purge') await stub.purgeNow();
            return Response.json(await stub.inspect());
          }
          return worker.fetch(req, env);
        } };
      ` },
      { type: 'ESModule', path: 'relay.js', contents: readFileSync('.wrangler/test-bundle/index.js', 'utf8') },
    ],
    compatibilityDate: '2026-05-22', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { PAIRS: { className: 'SyncPair', useSQLite: true }, PAIRING: { className: 'TestPairingSession', useSQLite: true } },
    bindings: { ALLOWED_ORIGINS: 'http://localhost:3000' },
    ratelimits: { REQUEST_LIMITER: { simple: { limit: 10000, period: 60 } }, PAIR_LIMITER: { simple: { limit: 10000, period: 60 } }, CODE_LIMITER: { simple: { limit: 5, period: 60 } } },
  });
});
after(async () => { await mf.dispose(); });
// Each scenario gets an independent client IP; the final test explicitly exhausts its budget.
const isolatedFetch = (): typeof fetch => {
  const ip = crypto.randomUUID();
  return ((url, init) => request(url, { ...init, headers: { ...init?.headers, 'CF-Connecting-IP': ip } })) as typeof fetch;
};
async function newPair() {
  const fetcher = isolatedFetch();
  const host = await PairingClient.create(device('Mac'), 'https://relay.test', fetcher);
  const guest = await PairingClient.claim(displayCode(host.code).toLowerCase(), device('Phone'), undefined, 'https://relay.test', fetcher);
  await host.poll();
  return { host, guest, fetcher };
}
const inspect = async (code: string, action = 'inspect') => (await request(`https://relay.test/test/${action}`, { method: 'POST', body: JSON.stringify({ code }) })).json();

test('code and QR share one ECDH exchange; approval permits encrypted transfer both ways', async () => {
  const { host, guest, fetcher } = await newPair();
  assert.equal(validCode(host.code), true);
  assert.deepEqual(parsePairingLink(host.link), { code: host.code, publicKey: host.publicKey });
  assert.equal(await host.verification(), await guest.verification());
  const h = await host.pair(), g = await guest.pair();
  assert.equal(h.secret, g.secret);
  assert.equal(h.guestAuth, g.auth);
  assert.notEqual(h.auth, g.auth);
  assert.equal(g.guestAuth, undefined);
  const stored = JSON.stringify(await inspect(host.code));
  for (const secret of [h.secret, h.auth, g.auth, host.token, guest.token]) assert.equal(stored.includes(secret), false);
  await assert.rejects(guest.finish(), /Waiting for approval/);
  await assert.rejects(guest.approve(), /Approve on/);
  await assert.rejects(guest.request('approve', { guestKey: guest.publicKey }), /Check the requesting/);
  await host.approve();
  await guest.poll();
  const saved = await guest.finish();
  const a = new SyncClient(h, fetcher), b = new SyncClient(saved, fetcher);
  const payload = { mime: 'text/plain' as const, bytes: new TextEncoder().encode('QR ↔ code: paired securely') };
  const out = await a.send(payload); assert.deepEqual(await b.receive(out), payload); await b.ack(out.id);
  const back = await b.send(payload); assert.deepEqual(await a.receive(back), payload); await a.ack(back.id);
  // Lost approval responses can be retried without a second room or changing credentials.
  assert.equal((await host.approve()).auth, h.auth);
  await a.revoke();
});

test('only one guest can claim a code, including concurrent attempts and after approval', async () => {
  const fetcher = isolatedFetch();
  const host = await PairingClient.create(device('Host'), 'https://relay.test', fetcher);
  const results = await Promise.allSettled(['A', 'B'].map(name => PairingClient.claim(host.code, device(name), undefined, 'https://relay.test', fetcher)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  await host.poll();
  const pair = await host.approve();
  await assert.rejects(PairingClient.claim(host.code, device('C'), undefined, 'https://relay.test', fetcher), /already used/);
  await new SyncClient(pair, fetcher).revoke();
});

test('QR pin mismatch, same-device pairing, and invalid codes are rejected before claiming', async () => {
  const fetcher = isolatedFetch(), own = device('Mac');
  const host = await PairingClient.create(own, 'https://relay.test', fetcher);
  await assert.rejects(PairingClient.claim(host.code, device('Phone'), 'wrong-key', 'https://relay.test', fetcher), /no longer matches/);
  await assert.rejects(PairingClient.claim(host.code, own, undefined, 'https://relay.test', fetcher), /other device/);
  await host.poll(); assert.equal(host.state.guest, null);
  await assert.rejects(PairingClient.claim('OI01', own, undefined, 'https://relay.test', fetcher), /six-character/);
  const guest = await PairingClient.claim(host.code, device('Phone'), host.publicKey, 'https://relay.test', fetcher);
  await guest.cancel(); await assert.rejects(host.poll(), /expired or unavailable/);
});

test('expired and cancelled sessions cannot be reclaimed; alarms remove public metadata', async () => {
  const { host, guest } = await newPair();
  await inspect(host.code, 'expire');
  await assert.rejects(host.poll(), /expired or unavailable/);
  await assert.rejects(guest.poll(), /expired or unavailable/);
  await inspect(host.code, 'purge'); assert.deepEqual(await inspect(host.code), []);
  const other = await newPair(); await other.host.cancel();
  await assert.rejects(other.guest.poll(), /expired or unavailable/);
});

test('unauthenticated guessing is limited and errors retain CORS and no-store', async () => {
  const fetcher = isolatedFetch();
  for (let n = 0; n < 6; n++) {
    const r = await fetcher('https://relay.test/v2/pairing/claim', { method: 'POST', headers: { Origin: 'http://localhost:3000' }, body: JSON.stringify({ code: 'ABC234' }) });
    assert.equal(r.status, n < 5 ? 401 : 429);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
  }
  const foreign = await request('https://relay.test/v2/pairing/create', { method: 'POST', headers: { Origin: 'https://evil.test' }, body: '{}' });
  assert.equal(foreign.status, 403);
});

test('request credentials cannot poll another session or replace a claimed public key', async () => {
  const { host, guest } = await newPair();
  const r = await request('https://relay.test/v2/pairing/status', { method: 'POST', headers: { Authorization: `Bearer ${url64(crypto.getRandomValues(new Uint8Array(32)))}` }, body: JSON.stringify({ code: host.code }) });
  assert.equal(r.status, 401);
  await assert.rejects(guest.request('claim', { peer: { device: guest.device, publicKey: host.publicKey } }), /other device/);
  await host.cancel();
});

test('guest cancellation during approval revokes the newly created transfer room', async () => {
  const fetcher = isolatedFetch();
  let guest: PairingClient;
  const interrupted: typeof fetch = (url, init) => {
    if (String(url).endsWith('/v2/pairing/approve')) return guest.cancel().then(() => fetcher(url, init));
    return fetcher(url, init);
  };
  const host = await PairingClient.create(device('Mac'), 'https://relay.test', interrupted);
  guest = await PairingClient.claim(host.code, device('Phone'), undefined, 'https://relay.test', fetcher);
  await host.poll();
  const pair = await host.pair();
  await assert.rejects(host.approve(), /expired or unavailable/);
  await assert.rejects(new SyncClient(pair, fetcher).state(), /removed or unavailable/);
});

test('an approval response lost after commit can be retried with the same credentials', async () => {
  const fetcher = isolatedFetch();
  let drop = true;
  const interrupted: typeof fetch = async (url, init) => {
    const response = await fetcher(url, init);
    if (drop && String(url).endsWith('/v2/pairing/approve')) { drop = false; throw new Error('Synthetic lost response'); }
    return response;
  };
  const host = await PairingClient.create(device('Mac'), 'https://relay.test', interrupted);
  const guest = await PairingClient.claim(host.code, device('Phone'), undefined, 'https://relay.test', fetcher);
  await host.poll();
  const expected = await host.pair();
  await assert.rejects(host.approve(), /lost response/);
  assert.deepEqual(await host.approve(), expected);
  await guest.poll(); assert.equal((await guest.finish()).secret, expected.secret);
  await new SyncClient(expected, fetcher).revoke();
});
