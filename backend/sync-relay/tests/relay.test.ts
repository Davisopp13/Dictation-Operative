import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import {
  SyncClient,
  credentials,
  invitation,
  parseInvitation,
  url64,
  type Pair,
  type Payload,
} from "../../../Shared/Sync/protocol";
import { deflateSync } from "node:zlib";
let mf: Miniflare;
const request: typeof fetch = ((url: string | URL | Request, init?: RequestInit) =>
  mf.dispatchFetch(String(url), init as never)) as typeof fetch;
before(() => {
  mf = new Miniflare({
    modules: true,
    scriptPath: ".wrangler/test-bundle/index.js",
    compatibilityDate: "2026-05-22",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { PAIRS: { className: "SyncPair", useSQLite: true } },
    bindings: {
      ALLOWED_ORIGINS: "https://do-voice-workspace.davisopp.chatgpt.site,http://localhost:3000",
    },
    ratelimits: {
      REQUEST_LIMITER: { simple: { limit: 10000, period: 60 } },
      PAIR_LIMITER: { simple: { limit: 10000, period: 60 } },
    },
  });
});
after(async () => {
  await mf.dispose();
});
async function pair() {
  const p: Pair = {
    relay: "https://relay.test",
    secret: url64(crypto.getRandomValues(new Uint8Array(32))),
    auth: url64(crypto.getRandomValues(new Uint8Array(32))),
    guestAuth: url64(crypto.getRandomValues(new Uint8Array(32))),
    role: "host",
    device: { id: crypto.randomUUID(), name: "Mac test" },
    peerName: "Browser test",
  };
  const q = parseInvitation(invitation(p), { id: crypto.randomUUID(), name: "Browser test" });
  const host = new SyncClient(p, request),
    guest = new SyncClient(q, request);
  await host.create();
  await guest.join();
  await host.approve(q.device.id);
  return { host, guest, p, q };
}
const text = (value: string): Payload => ({
  mime: "text/plain",
  bytes: new TextEncoder().encode(value),
});
function png() {
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const v of b) {
      c ^= v;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (name: string, bytes: Buffer) => {
    const prefix = Buffer.alloc(4),
      suffix = Buffer.alloc(4),
      b = Buffer.concat([Buffer.from(name), bytes]);
    prefix.writeUInt32BE(bytes.length);
    suffix.writeUInt32BE(crc(b));
    return Buffer.concat([prefix, b, suffix]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(512, 0);
  header.writeUInt32BE(512, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(512 * (512 * 4 + 1));
  let seed = 12345;
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 512 * 4; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      raw[y * 2049 + x + 1] = seed >>> 24;
    }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
test("explicit approval gates transfer; invitation round trips", async () => {
  const { host, guest, p } = await pair();
  assert.equal((await guest.state()).approved, true);
  const impostor = new SyncClient(
    { ...p, secret: url64(crypto.getRandomValues(new Uint8Array(32))) },
    request,
  );
  await assert.rejects(impostor.state());
  const third = new SyncClient(
    { ...p, auth: p.guestAuth!, role: "guest", device: { id: crypto.randomUUID(), name: "third" } },
    request,
  );
  await assert.rejects(third.join(), /Cannot join/);
  await host.revoke();
  await assert.rejects(guest.state(), /removed/);
});
test("bidirectional text and acknowledgement; relay has no plaintext", async () => {
  const { host, guest } = await pair();
  const e = await host.send(text("Synthetic clipboard café 🎙️"));
  const state = await guest.state();
  assert.equal(state.latest?.id, e.id);
  const received = await guest.receive(state.latest!);
  assert.deepEqual(received, text("Synthetic clipboard café 🎙️"));
  await guest.ack(e.id);
  assert.equal((await guest.state()).latest, null);
  assert.equal((await host.state()).ack?.id, e.id);
  const reverse = await guest.send(text("Return direction"));
  assert.deepEqual(await host.receive(reverse), text("Return direction"));
  await host.ack(reverse.id);
  await host.revoke();
});
test("chunked PNG preserves exact bytes, dimensions, and alpha", async () => {
  const { host, guest } = await pair();
  const payload: Payload = { mime: "image/png", bytes: png() };
  assert.ok(payload.bytes.length > 1000000);
  const progress: number[] = [];
  const e = await host.send(payload, (p) => progress.push(p));
  assert.ok(progress.length > 4);
  assert.equal(progress.at(-1), 100);
  const received = await guest.receive(e);
  assert.deepEqual(received, payload);
  await guest.ack(e.id);
  await host.revoke();
});
test("latest wins, stale sequence rejected, duplicate commit idempotent", async () => {
  const { host, guest } = await pair();
  const first = await host.send(text("first")),
    second = await host.send(text("second"));
  assert.equal((await guest.state()).latest?.id, second.id);
  await assert.rejects(guest.receive(first), /expired|replaced/);
  await assert.rejects(host.request("start", "POST", first), /newer/);
  await host.request(`commit/${second.id}`, "POST", {});
  await guest.ack(second.id);
  await host.request(`commit/${second.id}`, "POST", {});
  assert.equal((await guest.state()).latest, null);
  await host.revoke();
});
test("incomplete uploads stay invisible; a fresh retry supersedes interrupted image", async () => {
  const { host, guest, p } = await pair();
  const real = new SyncClient(p, async (url, init) => {
    if (String(url).includes("/chunk/") && String(url).endsWith("/1"))
      throw new Error("Synthetic network interruption");
    return request(url, init);
  });
  await assert.rejects(real.send({ mime: "image/png", bytes: png() }), /interruption/);
  assert.equal((await guest.state()).latest, null);
  const e = await host.send(text("Recovered after interruption"));
  assert.deepEqual(await guest.receive(e), text("Recovered after interruption"));
  await host.revoke();
});
test("authenticated metadata rejects tampering; concurrency retains both directions", async () => {
  const { host, guest } = await pair();
  const [a, b] = await Promise.all([host.send(text("A")), guest.send(text("B"))]);
  await assert.rejects(guest.receive({ ...a, sequence: a.sequence + 1 }));
  assert.deepEqual(await host.receive(b), text("B"));
  assert.deepEqual(await guest.receive(a), text("A"));
  await host.revoke();
});
test("size and format validation, CORS, unauthorized access", async () => {
  const { host, p } = await pair();
  await assert.rejects(host.send(text("x".repeat(262145))), /256 KiB/);
  await assert.rejects(
    host.send({ mime: "image/png", bytes: new Uint8Array([1, 2, 3]) }),
    /valid PNG/,
  );
  const c = await credentials(p);
  const unauthorized = await request(`${p.relay}/v1/rooms/${c.room}/state`);
  assert.equal(unauthorized.status, 401);
  const foreign = await request(`${p.relay}/v1/rooms/${c.room}/state`, {
    headers: { Origin: "https://evil.test" },
  });
  assert.equal(foreign.status, 403);
  await host.revoke();
});
test("guest cannot self-approve and unapproved transfers are denied", async () => {
  const p: Pair = {
    relay: "https://relay.test",
    secret: url64(crypto.getRandomValues(new Uint8Array(32))),
    auth: url64(crypto.getRandomValues(new Uint8Array(32))),
    guestAuth: url64(crypto.getRandomValues(new Uint8Array(32))),
    role: "host",
    device: { id: crypto.randomUUID(), name: "Host" },
    peerName: "Guest",
  };
  const q = parseInvitation(invitation(p), { id: crypto.randomUUID(), name: "Guest" });
  assert.equal(q.guestAuth, undefined);
  assert.notEqual(q.auth, p.auth);
  const host = new SyncClient(p, request),
    guest = new SyncClient(q, request);
  await host.create();
  await guest.join();
  await assert.rejects(guest.approve(q.device.id), /Check the requesting/);
  await assert.rejects(guest.send(text("must not send")), /Approve/);
  await host.revoke();
});
test("expired pending upload is purged and cannot be completed", async () => {
  const { host, guest } = await pair();
  const e = await host.send(text("original"));
  await guest.ack(e.id);
  const now = Date.now();
  const expired = {
    ...e,
    id: crypto.randomUUID(),
    sequence: e.sequence + 1,
    createdAt: now - 119950,
    expiresAt: now + 50,
  };
  await host.request("start", "POST", expired);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await guest.state()).latest, null);
  await assert.rejects(host.request(`commit/${expired.id}`, "POST", {}), /expired/);
  await host.revoke();
});
