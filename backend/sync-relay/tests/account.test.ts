import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import {
  AccountClient,
  randomSecret,
  receiveAccountInvite,
  seal,
  open,
  type Account,
  type AISettings,
} from "../../../Shared/Sync/account";
import {
  SyncClient,
  credentials,
  invitation,
  parseInvitation,
  sha256,
  type Pair,
} from "../../../Shared/Sync/protocol";
let mf: Miniflare;
const fetcher: typeof fetch = ((url, init) =>
  mf.dispatchFetch(String(url), init as never)) as typeof fetch;
const encode = (v: string) => new TextEncoder().encode(v);
before(() => {
  mf = new Miniflare({
    modules: [
      {
        type: "ESModule",
        path: "test-worker.js",
        contents: `
        import worker, { SyncAccount, AccountAdmin } from './relay.js';
        export { SyncPair, PairingSession, AccountAdmin } from './relay.js';
        export class TestAccount extends SyncAccount {
          inspect() { return { devices: this.ctx.storage.sql.exec('SELECT * FROM devices').toArray(), items: this.ctx.storage.sql.exec('SELECT * FROM items').toArray() }; }
          async expire() { this.ctx.storage.sql.exec('UPDATE items SET expires=1 WHERE expires>0'); await this.alarm(); return this.inspect(); }
        }
        export default { async fetch(req, env, ctx) {
          const path = new URL(req.url).pathname;
          // Test-only control paths stand in for the signed-in Worker's service binding.
          if (path === '/test/bootstrap') {
            const data = await req.json();
            return env.ACCOUNTS.getByName(data.id).bootstrap(data.id, data.device);
          }
          if (path === '/test/inspect' || path === '/test/expire') {
            const data = await req.json(); const stub = env.ACCOUNTS.getByName(data.id);
            return Response.json(path.endsWith('expire') ? await stub.expire() : await stub.inspect());
          }
          return worker.fetch(req, env, ctx);
        } };
      `,
      },
      {
        type: "ESModule",
        path: "relay.js",
        contents: readFileSync(".wrangler/test-bundle/index.js", "utf8"),
      },
    ],
    compatibilityDate: "2026-05-22",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      ACCOUNTS: { className: "TestAccount", useSQLite: true },
      PAIRS: { className: "SyncPair", useSQLite: true },
      PAIRING: { className: "PairingSession", useSQLite: true },
    },
    bindings: { ALLOWED_ORIGINS: "http://localhost:3000" },
    ratelimits: {
      REQUEST_LIMITER: { simple: { limit: 10000, period: 60 } },
      PAIR_LIMITER: { simple: { limit: 10000, period: 60 } },
      CODE_LIMITER: { simple: { limit: 10000, period: 60 } },
    },
  });
});
after(async () => {
  await mf.dispose();
});
const control = (path: string, body: unknown) =>
  fetcher("https://relay.test/test/" + path, { method: "POST", body: JSON.stringify(body) });
async function account() {
  const a: Account = {
    v: 1,
    id: await sha256(encode(crypto.randomUUID())),
    label: "Test account",
    secret: randomSecret(),
    token: randomSecret(),
    device: { id: crypto.randomUUID(), name: "Browser" },
  };
  assert.equal(
    (await control("bootstrap", { id: a.id, device: { ...a.device, token: a.token } })).status,
    200,
  );
  return new AccountClient(a, fetcher);
}
async function pair() {
  const p: Pair = {
    relay: "https://relay.test",
    secret: randomSecret(),
    auth: randomSecret(),
    guestAuth: randomSecret(),
    role: "host",
    device: { id: crypto.randomUUID(), name: "Browser" },
    peerName: "Mac",
  };
  const q = parseInvitation(invitation(p), { id: crypto.randomUUID(), name: "Mac" });
  const host = new SyncClient(p, fetcher),
    guest = new SyncClient(q, fetcher);
  await host.create();
  await guest.join();
  await host.approve(q.device.id);
  return { p, q, host, guest };
}
const settings: AISettings = {
  v: 1,
  provider: "groq",
  model: "test-model",
  cleanupEnabled: true,
  vocabulary: ["Dictation"],
  groqKey: "gsk_synthetic_test_key_123456789",
};
test("account bootstrap cannot replace an existing trust root; public HTTP cannot bootstrap", async () => {
  const c = await account();
  const r = await control("bootstrap", {
    id: c.account.id,
    device: { id: crypto.randomUUID(), name: "Stranger", token: randomSecret() },
  });
  assert.equal(r.status, 409);
  assert.equal(
    (await fetcher(`https://relay.test/v1/accounts/${c.account.id}/bootstrap`, { method: "POST" }))
      .status,
    404,
  );
  await assert.rejects(
    new AccountClient({ ...c.account, token: randomSecret() }, fetcher).state(),
    /removed|unavailable/,
  );
});
test("trusted pairing carries account invitation, persistent settings round trip, secrets absent from storage", async () => {
  const a = await account(),
    { p, q, host, guest } = await pair();
  await a.invite(p);
  const invited = await receiveAccountInvite(q, fetcher),
    b = new AccountClient(invited, fetcher);
  assert.equal(invited.id, a.account.id);
  assert.equal(invited.secret, a.account.secret);
  assert.notEqual(invited.token, a.account.token);
  await a.publishSettings(settings, 0);
  const state = await b.state();
  assert.equal(state.devices.length, 2);
  assert.deepEqual(await b.settings(state.settings!), settings);
  const raw = JSON.stringify(await (await control("inspect", { id: a.account.id })).json());
  for (const secret of [settings.groqKey!, a.account.secret, a.account.token, invited.token])
    assert.equal(raw.includes(secret), false);
  assert.equal((await guest.state()).latest, null); // account invitations never enter a clipboard mailbox
  await host.send({ mime: "text/plain", bytes: encode("separate clipboard") });
  assert.equal(
    new TextDecoder().decode((await guest.receive((await guest.state()).latest!)).bytes),
    "separate clipboard",
  );
  await host.revoke();
  await assert.rejects(receiveAccountInvite(q, fetcher));
});
test("settings revisions reject conflicting edits and keep keys optional", async () => {
  const a = await account();
  await a.publishSettings(settings, 0);
  await assert.rejects(a.publishSettings({ ...settings, model: "stale" }, 0), /changed/);
  assert.equal((await a.settings((await a.state()).settings!)).model, settings.model);
  await a.publishSettings({ ...settings, groqKey: null }, 1);
  assert.equal((await a.settings((await a.state()).settings!)).groqKey, null);
});
test("ciphertext cannot cross account, channel, sender, or revision; corrupt updates fail closed", async () => {
  const a = await account(),
    b = await account();
  const e = await seal(a.account, "settings", 1, encode(JSON.stringify(settings)));
  await assert.rejects(open(b.account, e, "settings"));
  await assert.rejects(open(a.account, e, "clipboard"));
  await assert.rejects(open(a.account, { ...e, sender: crypto.randomUUID() }, "settings"));
  await assert.rejects(open(a.account, { ...e, revision: 2 }, "settings"));
  await assert.rejects(
    a.request("settings", { envelope: { ...e, sender: crypto.randomUUID() } }),
    /Invalid/,
  );
  await assert.rejects(
    a.request("settings", { envelope: { ...e, ciphertext: "plaintext-groq-key" } }),
    /Invalid/,
  );
});
test("revocation blocks old token, removes that device clipboard, and never resurrects old identity", async () => {
  const a = await account(),
    { p, q } = await pair();
  await a.invite(p);
  const b = new AccountClient(await receiveAccountInvite(q, fetcher), fetcher);
  await b.sendClipboard({ mime: "text/plain", bytes: encode("private copy") }, 0);
  const state = await a.state();
  assert.equal(state.clipboards.length, 1);
  assert.equal(
    new TextDecoder().decode((await a.clipboard(state.clipboards[0])).bytes),
    "private copy",
  );
  await a.request("revoke", { id: b.account.device.id });
  await assert.rejects(b.state(), /removed/);
  await assert.rejects(b.publishSettings(settings, 0), /removed/);
  assert.equal((await a.state()).clipboards.length, 0);
  await assert.rejects(
    a.request("register", {
      ...b.account.device,
      tokenHash: await sha256(encode(b.account.token)),
    }),
    /already registered/,
  );
});
test("clipboard expiry purges ciphertext while persistent settings and sequence survive", async () => {
  const a = await account();
  await a.publishSettings(settings, 0);
  await a.sendClipboard({ mime: "text/plain", bytes: encode("expires") }, 0);
  const stored = (await (await control("expire", { id: a.account.id })).json()) as {
    items: { slot: string; value: string; revision: number }[];
  };
  assert.equal(stored.items.find((i) => i.slot === a.account.device.id)?.value, "");
  const state = await a.state();
  assert.equal(state.clipboards.length, 0);
  assert.equal(state.clipboardRevision, 1);
  assert.deepEqual(await a.settings(state.settings!), settings);
  await assert.rejects(
    a.sendClipboard({ mime: "text/plain", bytes: encode("stale") }, 0),
    /changed/,
  );
});
test("8 MiB account images use bounded SQLite chunks and state lists only metadata", async () => {
  const a = await account();
  const bytes = new Uint8Array(8 * 1024 * 1024);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set(encode("IHDR"), 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 1);
  view.setUint32(20, 1);
  await a.sendClipboard({ mime: "image/png", bytes }, 0);
  const state = await a.state();
  assert.equal(state.clipboards[0].ciphertext, "");
  assert.ok(JSON.stringify(state).length < 4096);
  const received = await a.clipboard(state.clipboards[0]);
  assert.deepEqual(received.bytes, bytes);
  await a.sendClipboard({ mime: "text/plain", bytes: encode("replacement") }, 1);
  await assert.rejects(a.clipboard(state.clipboards[0]), /replaced/);
});
