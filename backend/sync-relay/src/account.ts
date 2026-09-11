import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
export const accountHash = async (text: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const validID = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(v);
const validToken = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
type Device = { id: string; name: string; tokenHash: string; seen: number; revoked: number };
type Sealed = {
  v: number;
  id: string;
  account: string;
  sender: string;
  kind: string;
  revision: number;
  createdAt: number;
  expiresAt: number;
  iv: string;
  ciphertext: string;
};
function sealed(v: unknown, account: string, sender: string, kind: string): v is Sealed {
  const e = v as Sealed;
  return (
    !!e &&
    e.v === 1 &&
    validID(e.id) &&
    e.account === account &&
    e.sender === sender &&
    e.kind === kind &&
    Number.isSafeInteger(e.revision) &&
    e.revision > 0 &&
    Number.isSafeInteger(e.createdAt) &&
    e.createdAt <= Date.now() + 30000 &&
    e.createdAt >= Date.now() - 120000 &&
    Number.isSafeInteger(e.expiresAt) &&
    (kind === "settings"
      ? e.expiresAt === 0
      : e.expiresAt > Date.now() &&
        e.expiresAt <= e.createdAt + 120000 &&
        e.expiresAt <= Date.now() + 120000) &&
    typeof e.iv === "string" &&
    /^[A-Za-z0-9+/]{16}$/.test(e.iv) &&
    typeof e.ciphertext === "string" &&
    e.ciphertext.length >= 24 &&
    e.ciphertext.length <= (kind === "settings" ? 65536 : 12 * 1024 * 1024) &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(e.ciphertext)
  );
}
export async function accountBody(request: Request, max = 65536): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error("Request too large");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid request");
  return value;
}

/** Available only to the signed-in web Worker's service binding, never public HTTP. */
export class AccountAdmin extends WorkerEntrypoint<Env> {
  async fetch(request: Request) {
    try {
      const route = /^\/v1\/accounts\/([a-f0-9]{64})\/(.+)$/.exec(new URL(request.url).pathname);
      if (route) {
        const owner = request.headers.get("X-DO-Owner") ?? "";
        if (!owner || route[1] !== (await accountHash("DO-ACCOUNT/1\n" + owner)))
          return json({ error: "Account does not match sign-in." }, 403);
        return this.env.ACCOUNTS.getByName(route[1]).handle(request, route[1], route[2]);
      }
      const data = await accountBody(request, 2048);
      return this.account(
        request.headers.get("X-DO-Owner") ?? "",
        data.device as { id: string; name: string; token: string } | undefined,
      );
    } catch {
      return json({ error: "Invalid account request." }, 400);
    }
  }
  async account(owner: string, device?: { id: string; name: string; token: string }) {
    if (!owner || owner.length > 300) return json({ error: "Sign in first" }, 401);
    const id = await accountHash("DO-ACCOUNT/1\n" + owner);
    return this.env.ACCOUNTS.getByName(id).bootstrap(id, device);
  }
}
export class SyncAccount extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,tokenHash TEXT NOT NULL,seen INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS account_chunks(slot TEXT NOT NULL,idx INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(slot,idx))",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS items(slot TEXT PRIMARY KEY,revision INTEGER NOT NULL,sender TEXT NOT NULL,expires INTEGER NOT NULL,value TEXT NOT NULL)",
    );
  }
  private devices() {
    return this.ctx.storage.sql.exec<Device>("SELECT * FROM devices").toArray();
  }
  async bootstrap(id: string, device?: { id: string; name: string; token: string }) {
    if (!device) return json({ id, exists: this.devices().length > 0 });
    if (
      !validID(device.id) ||
      !validToken(device.token) ||
      typeof device.name !== "string" ||
      !device.name.trim() ||
      device.name.length > 60
    )
      return json({ error: "Invalid device" }, 400);
    const hash = await accountHash(device.token);
    const existing = this.devices();
    if (existing.length) {
      if (existing.some((d) => d.id === device.id && d.tokenHash === hash && !d.revoked))
        return json({ id, created: true });
      return json({ error: "Approve this browser from an existing trusted device." }, 409);
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO devices VALUES(?,?,?,?,0)",
      device.id,
      device.name.trim(),
      hash,
      Date.now(),
    );
    return json({ id, created: true });
  }
  private purge() {
    this.ctx.storage.sql.exec(
      "DELETE FROM account_chunks WHERE slot IN (SELECT slot FROM items WHERE expires>0 AND expires<=?)",
      Date.now(),
    );
    this.ctx.storage.sql.exec(
      "UPDATE items SET value='' WHERE expires>0 AND expires<=?",
      Date.now(),
    );
  }
  async alarm() {
    this.purge();
    const next = this.ctx.storage.sql
      .exec<{ expiry: number | null }>(
        "SELECT MIN(expires) AS expiry FROM items WHERE expires>? AND value<>''",
        Date.now(),
      )
      .one().expiry;
    if (next) await this.ctx.storage.setAlarm(next);
  }
  async handle(request: Request, account: string, action: string): Promise<Response> {
    try {
      const token = request.headers.get("Authorization")?.replace(/^Bearer /, "");
      if (!validToken(token)) return json({ error: "Sign in with a trusted device." }, 401);
      // Read and hash before checking authorization: no await between authorization and writes.
      const data =
        request.method === "POST"
          ? await accountBody(request, action === "clipboard" ? 12 * 1024 * 1024 + 4096 : 70000)
          : {};
      const hash = await accountHash(token);
      const device = this.devices().find((d) => d.tokenHash === hash && !d.revoked);
      if (!device) return json({ error: "Device removed or account unavailable." }, 401);
      this.purge();
      this.ctx.storage.sql.exec("UPDATE devices SET seen=? WHERE id=?", Date.now(), device.id);
      if (action === "state" && request.method === "GET") {
        const items = this.ctx.storage.sql
          .exec<{ slot: string; revision: number; value: string }>(
            "SELECT slot,revision,value FROM items",
          )
          .toArray();
        return json({
          id: account,
          devices: this.devices()
            .filter((d) => !d.revoked)
            .map(({ id, name, seen }) => ({ id, name, seen })),
          settingsRevision: items.find((i) => i.slot === "settings")?.revision ?? 0,
          settings: JSON.parse(items.find((i) => i.slot === "settings")?.value || "null"),
          clipboards: items
            .filter((i) => i.slot !== "settings" && i.value)
            .map((i) => JSON.parse(i.value)),
          clipboardRevision: items.find((i) => i.slot === device.id)?.revision ?? 0,
        });
      }
      if (action.startsWith("clipboard/") && request.method === "GET") {
        const sender = action.slice("clipboard/".length);
        if (!validID(sender)) return json({ error: "Invalid device" }, 400);
        const item = this.ctx.storage.sql
          .exec<{ value: string }>(
            "SELECT value FROM items WHERE slot=? AND value<>'' AND expires>?",
            sender,
            Date.now(),
          )
          .toArray()[0];
        if (!item) return json({ error: "Clipboard expired or was removed." }, 410);
        const envelope = JSON.parse(item.value);
        envelope.ciphertext = this.ctx.storage.sql
          .exec<{ value: string }>(
            "SELECT value FROM account_chunks WHERE slot=? ORDER BY idx",
            sender,
          )
          .toArray()
          .map((c) => c.value)
          .join("");
        return json(envelope);
      }
      if (action === "register" && request.method === "POST") {
        if (
          !validID(data.id) ||
          typeof data.name !== "string" ||
          !data.name.trim() ||
          data.name.length > 60 ||
          typeof data.tokenHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(data.tokenHash)
        )
          return json({ error: "Invalid device" }, 400);
        const devices = this.devices(),
          old = devices.find((d) => d.id === data.id);
        if (old)
          return old.tokenHash === data.tokenHash && !old.revoked
            ? json({ registered: true })
            : json(
                { error: "Device already registered. Remove it and pair with a new identity." },
                409,
              );
        if (devices.length >= 100) return json({ error: "Account device limit reached." }, 409);
        this.ctx.storage.sql.exec(
          "INSERT INTO devices VALUES(?,?,?,?,0)",
          data.id,
          data.name.trim(),
          data.tokenHash,
          0,
        );
        return json({ registered: true });
      }
      if (action === "rename" && request.method === "POST") {
        if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 60)
          return json({ error: "Name this device." }, 400);
        this.ctx.storage.sql.exec(
          "UPDATE devices SET name=? WHERE id=?",
          data.name.trim(),
          device.id,
        );
        return json({ renamed: true });
      }
      if (action === "revoke" && request.method === "POST") {
        if (!validID(data.id)) return json({ error: "Invalid device" }, 400);
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(
            "UPDATE devices SET revoked=1,name='Removed' WHERE id=?",
            data.id,
          );
          this.ctx.storage.sql.exec("UPDATE items SET value='' WHERE slot=?", data.id);
          this.ctx.storage.sql.exec("DELETE FROM account_chunks WHERE slot=?", data.id);
        });
        return json({ removed: true });
      }
      if (["settings", "clipboard"].includes(action) && request.method === "POST") {
        const e = data.envelope;
        if (!sealed(e, account, device.id, action))
          return json({ error: "Invalid encrypted update" }, 400);
        const slot = action === "settings" ? "settings" : device.id;
        const old = this.ctx.storage.sql
          .exec<{ revision: number; value: string }>(
            "SELECT revision,value FROM items WHERE slot=?",
            slot,
          )
          .toArray()[0];
        if (old?.value === JSON.stringify(e)) return json({ saved: true });
        if (e.revision !== (old?.revision ?? 0) + 1)
          return json({ error: "Settings changed on another device. Refresh before saving." }, 409);
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec("DELETE FROM account_chunks WHERE slot=?", slot);
          if (action === "clipboard") {
            for (let i = 0; i < e.ciphertext.length; i += 262144)
              this.ctx.storage.sql.exec(
                "INSERT INTO account_chunks VALUES(?,?,?)",
                slot,
                i / 262144,
                e.ciphertext.slice(i, i + 262144),
              );
          }
          this.ctx.storage.sql.exec(
            "INSERT INTO items VALUES(?,?,?,?,?) ON CONFLICT(slot) DO UPDATE SET revision=excluded.revision,sender=excluded.sender,expires=excluded.expires,value=excluded.value",
            slot,
            e.revision,
            device.id,
            e.expiresAt,
            JSON.stringify(action === "clipboard" ? { ...e, ciphertext: "" } : e),
          );
        });
        if (e.expiresAt) {
          const alarm = await this.ctx.storage.getAlarm();
          if (!alarm || alarm > e.expiresAt) await this.ctx.storage.setAlarm(e.expiresAt);
        }
        return json({ saved: true });
      }
      return json({ error: "Unknown account action" }, 404);
    } catch {
      return json({ error: "Account request could not be read." }, 400);
    }
  }
}
