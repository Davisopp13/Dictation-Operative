import { DurableObject } from "cloudflare:workers";
type Role = "host" | "guest";
type Device = { id: string; name: string };
type Envelope = {
  v: 1;
  room: string;
  id: string;
  from: Role;
  to: Role;
  sequence: number;
  createdAt: number;
  expiresAt: number;
  mime: "text/plain" | "image/png";
  iv: string;
  size: number;
  digest: string;
};
type RecordState = {
  hostHash: string;
  guestHash: string;
  host: Device;
  guest?: Device;
  approved: boolean;
  revoked: boolean;
  pairExpires: number;
  sequences: Record<Role, number>;
  lastIds: Partial<Record<Role, string>>;
  seen: Partial<Record<Role, number>>;
  acks: Partial<Record<Role, { id: string; at: number }>>;
};
type Transfer = { envelope: Envelope; count: number; received: number[]; acceptedAt?: number };
const CHUNK = 262144,
  MAX = 8 * 1024 * 1024 + 16,
  TTL = 120000;
class SyncError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
function validID(x: unknown) {
  if (typeof x !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(x))
    throw new SyncError("Invalid identifier");
  return x;
}
function device(x: unknown): Device {
  const d = x as Device;
  if (!d || typeof d.name !== "string" || !d.name.trim() || d.name.length > 60)
    throw new SyncError("Name this device (up to 60 characters).");
  return { id: validID(d.id), name: d.name.trim() };
}
function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function hash(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
async function bounded(request: Request, max: number) {
  if (Number(request.headers.get("Content-Length")) > max)
    throw new SyncError("Transfer too large", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > max) {
      await reader.cancel();
      throw new SyncError("Transfer too large", 413);
    }
    chunks.push(r.value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
function envelope(value: unknown, room: string, role: Role): Envelope {
  const e = value as Envelope;
  const now = Date.now();
  if (
    !e ||
    e.v !== 1 ||
    e.room !== room ||
    e.from !== role ||
    e.to == role ||
    !["host", "guest"].includes(e.to) ||
    !["text/plain", "image/png"].includes(e.mime) ||
    !Number.isSafeInteger(e.sequence) ||
    e.sequence < 1 ||
    !Number.isSafeInteger(e.createdAt) ||
    !Number.isSafeInteger(e.expiresAt) ||
    e.createdAt > now + 30000 ||
    e.createdAt < now - TTL ||
    e.expiresAt <= now ||
    e.expiresAt > e.createdAt + TTL ||
    !Number.isSafeInteger(e.size) ||
    e.size < 17 ||
    e.size > MAX ||
    (e.mime === "text/plain" && e.size > 262144 + 16) ||
    !/^[a-f0-9]{64}$/.test(e.digest) ||
    !/^[A-Za-z0-9+/]{16}$/.test(e.iv)
  )
    throw new SyncError("Invalid or expired transfer");
  validID(e.id);
  return e;
}
export class SyncPair extends DurableObject<Env> {
  // SQLite transactions stay synchronous: payload hashes and request bodies are read before mutation.
  private get state() {
    const rows = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM state WHERE id=1")
      .toArray();
    return rows.length ? (JSON.parse(rows[0].value) as RecordState) : null;
  }
  private save(s: RecordState) {
    this.ctx.storage.sql.exec(
      "INSERT INTO state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      JSON.stringify(s),
    );
  }
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY,value TEXT NOT NULL)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS transfers(id TEXT PRIMARY KEY,sender TEXT NOT NULL,recipient TEXT NOT NULL,expires INTEGER NOT NULL,complete INTEGER NOT NULL,meta TEXT NOT NULL)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS chunks(transfer_id TEXT NOT NULL,idx INTEGER NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(transfer_id,idx))",
    );
  }
  private purge() {
    this.ctx.storage.sql.exec(
      "DELETE FROM chunks WHERE transfer_id IN (SELECT id FROM transfers WHERE expires<=?)",
      Date.now(),
    );
    this.ctx.storage.sql.exec("DELETE FROM transfers WHERE expires<=?", Date.now());
  }
  private drop(id: string) {
    this.ctx.storage.sql.exec("DELETE FROM chunks WHERE transfer_id=?", id);
    this.ctx.storage.sql.exec("DELETE FROM transfers WHERE id=?", id);
  }
  async alarm() {
    this.purge();
    const pending = this.ctx.storage.sql
      .exec<{ expiry: number }>("SELECT MIN(expires) AS expiry FROM transfers")
      .toArray()[0]?.expiry;
    if (pending) await this.ctx.storage.setAlarm(pending);
  }
  async handle(request: Request, room: string, action: string): Promise<Response> {
    try {
      const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
      if (!/^[A-Za-z0-9_-]{43}$/.test(token))
        throw new SyncError("Device authorization required", 401);
      const tokenHash = await hash(token);
      const data =
        request.method === "POST"
          ? JSON.parse(new TextDecoder().decode(await bounded(request, 4096)) || "{}")
          : {};
      const raw = request.method === "PUT" ? await bounded(request, CHUNK) : null;
      this.purge();
      let s = this.state;
      if (action === "create" && request.method === "POST") {
        if (s) throw new SyncError("Pairing already exists", 409);
        if (!/^[a-f0-9]{64}$/.test(data.guestHash)) throw new SyncError("Invalid pairing");
        s = {
          hostHash: tokenHash,
          guestHash: data.guestHash,
          host: device(data.device),
          approved: false,
          revoked: false,
          pairExpires: Date.now() + 300000,
          sequences: { host: 0, guest: 0 },
          lastIds: {},
          seen: { host: Date.now() },
          acks: {},
        };
        this.save(s);
        return json({ created: true, expiresAt: s.pairExpires });
      }
      if (!s || s.revoked) throw new SyncError("Pairing removed or unavailable", 410);
      const role: Role =
        tokenHash === s.hostHash
          ? "host"
          : tokenHash === s.guestHash
            ? "guest"
            : (() => {
                throw new SyncError("Device authorization rejected", 401);
              })();
      const other: Role = role === "host" ? "guest" : "host";
      if (action === "revoke" && request.method === "POST") {
        s.revoked = true;
        s.host.name = "Removed";
        if (s.guest) s.guest.name = "Removed";
        this.ctx.storage.transactionSync(() => {
          this.save(s!);
          this.ctx.storage.sql.exec("DELETE FROM chunks");
          this.ctx.storage.sql.exec("DELETE FROM transfers");
        });
        return json({ removed: true });
      }
      if (!s.approved && s.pairExpires < Date.now())
        throw new SyncError("Pairing code expired. Create a new invitation.", 410);
      if (action === "join" && request.method === "POST") {
        if (role !== "guest" || s.approved) throw new SyncError("Cannot join this pairing", 403);
        const guest = device(data.device);
        if (s.guest && s.guest.id !== guest.id)
          throw new SyncError("Invitation already claimed", 409);
        s.guest = guest;
        this.save(s);
        return json({ waiting: true });
      }
      if (action === "approve" && request.method === "POST") {
        if (role !== "host" || !s.guest || data.deviceId !== s.guest.id)
          throw new SyncError("Check the requesting device before approving", 403);
        s.approved = true;
        this.save(s);
        return json({ paired: true });
      }
      if (action === "rename" && request.method === "POST") {
        const renamed = device(data.device);
        if (renamed.id !== s[role]?.id) throw new SyncError("Device identity cannot change");
        s[role] = renamed;
        this.save(s);
        return json({ renamed: true });
      }
      if (action === "state" && request.method === "GET") {
        s.seen[role] = Date.now();
        this.save(s);
        const latest = this.ctx.storage.sql
          .exec<{ meta: string }>(
            "SELECT meta FROM transfers WHERE recipient=? AND complete=1 ORDER BY expires DESC LIMIT 1",
            role,
          )
          .toArray()[0];
        return json({
          approved: s.approved,
          host: s.host,
          guest: s.guest ?? null,
          peerOnline: Date.now() - (s.seen[other] ?? 0) < 12000,
          sequence: s.sequences[role],
          latest: latest ? JSON.parse(latest.meta).envelope : null,
          ack: s.acks[role] ?? null,
          serverTime: Date.now(),
        });
      }
      if (!s.approved) throw new SyncError("Approve this device on the inviting device first", 403);
      if (action === "start" && request.method === "POST") {
        const e = envelope(data, room, role);
        if (e.sequence <= s.sequences[role]) {
          if (s.lastIds[role] === e.id) return json({ committed: true });
          throw new SyncError("A newer transfer already exists", 409);
        }
        const old = this.ctx.storage.sql
          .exec<{ id: string; meta: string }>(
            "SELECT id,meta FROM transfers WHERE sender=? AND complete<>1",
            role,
          )
          .toArray();
        if (old.some((x) => JSON.parse(x.meta).envelope.sequence > e.sequence))
          throw new SyncError("A newer upload is in progress", 409);
        const existing = old.find((x) => x.id === e.id);
        if (existing) {
          if (JSON.stringify(JSON.parse(existing.meta).envelope) !== JSON.stringify(e))
            throw new SyncError("Transfer identifiers cannot be reused", 409);
          return json({ received: JSON.parse(existing.meta).received });
        }
        const meta: Transfer = { envelope: e, count: Math.ceil(e.size / CHUNK), received: [] };
        this.ctx.storage.transactionSync(() => {
          for (const item of old) this.drop(item.id);
          this.ctx.storage.sql.exec(
            "INSERT INTO transfers VALUES(?,?,?,?,0,?)",
            e.id,
            role,
            other,
            e.expiresAt,
            JSON.stringify(meta),
          );
        });
        const nextAlarm = await this.ctx.storage.getAlarm();
        if (!nextAlarm || nextAlarm > e.expiresAt) await this.ctx.storage.setAlarm(e.expiresAt);
        return json({ received: [] });
      }
      const parts = action.split("/");
      if (parts[0] === "chunk" && request.method === "PUT") {
        const transfer = this.ctx.storage.sql
          .exec<{ meta: string; sender: string; complete: number }>(
            "SELECT meta,sender,complete FROM transfers WHERE id=?",
            validID(parts[1]),
          )
          .toArray()[0];
        if (!transfer || transfer.sender !== role || transfer.complete)
          throw new SyncError("Upload expired or superseded", 409);
        const meta = JSON.parse(transfer.meta) as Transfer,
          index = Number(parts[2]);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= meta.count ||
          !raw ||
          raw.length !== Math.min(CHUNK, meta.envelope.size - index * CHUNK)
        )
          throw new SyncError("Invalid upload chunk");
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(
            "INSERT INTO chunks VALUES(?,?,?) ON CONFLICT(transfer_id,idx) DO UPDATE SET bytes=excluded.bytes",
            parts[1],
            index,
            raw,
          );
          if (!meta.received.includes(index)) meta.received.push(index);
          this.ctx.storage.sql.exec(
            "UPDATE transfers SET meta=? WHERE id=?",
            JSON.stringify(meta),
            parts[1],
          );
        });
        return json({ received: meta.received.length, total: meta.count });
      }
      if (parts[0] === "commit" && request.method === "POST") {
        const transfer = this.ctx.storage.sql
          .exec<{ meta: string; sender: string; complete: number }>(
            "SELECT meta,sender,complete FROM transfers WHERE id=?",
            validID(parts[1]),
          )
          .toArray()[0];
        if (!transfer || transfer.sender !== role) {
          if (s.lastIds[role] === parts[1]) return json({ committed: true });
          throw new SyncError("Upload expired or superseded", 409);
        }
        if (transfer.complete === 1) return json({ committed: true });
        if (transfer.complete === 2) throw new SyncError("Commit in progress. Retry shortly.", 409);
        const meta = JSON.parse(transfer.meta) as Transfer;
        if (meta.received.length !== meta.count)
          throw new SyncError("Upload incomplete. Retry the transfer.", 409);
        const bytes = new Uint8Array(meta.envelope.size);
        for (const row of this.ctx.storage.sql.exec<{ idx: number; bytes: ArrayBuffer }>(
          "SELECT idx,bytes FROM chunks WHERE transfer_id=? ORDER BY idx",
          parts[1],
        ))
          bytes.set(new Uint8Array(row.bytes), row.idx * CHUNK);
        this.ctx.storage.sql.exec("UPDATE transfers SET complete=2 WHERE id=?", parts[1]);
        const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
        s = this.state!;
        if (!s || s.revoked) throw new SyncError("Pairing removed", 410);
        if (
          !this.ctx.storage.sql
            .exec("SELECT id FROM transfers WHERE id=? AND expires>?", parts[1], Date.now())
            .toArray().length ||
          meta.envelope.sequence <= s.sequences[role]
        )
          throw new SyncError("Transfer expired or superseded", 409);
        if (digest !== meta.envelope.digest) {
          this.drop(parts[1]);
          throw new SyncError("Transfer integrity check failed");
        }
        this.ctx.storage.transactionSync(() => {
          for (const old of this.ctx.storage.sql
            .exec<{ id: string }>(
              "SELECT id FROM transfers WHERE recipient=? AND complete=1",
              other,
            )
            .toArray())
            this.drop(old.id);
          s!.sequences[role] = meta.envelope.sequence;
          s!.lastIds[role] = meta.envelope.id;
          meta.acceptedAt = Date.now();
          this.save(s!);
          this.ctx.storage.sql.exec(
            "UPDATE transfers SET complete=1,meta=? WHERE id=?",
            JSON.stringify(meta),
            parts[1],
          );
        });
        return json({ committed: true });
      }
      if (parts[0] === "download" && request.method === "GET") {
        const transfer = this.ctx.storage.sql
          .exec<{ meta: string; recipient: string; complete: number }>(
            "SELECT meta,recipient,complete FROM transfers WHERE id=?",
            validID(parts[1]),
          )
          .toArray()[0];
        if (!transfer || transfer.recipient !== role || transfer.complete !== 1)
          throw new SyncError("Transfer expired or replaced. Send it again.", 410);
        const index = Number(parts[2]);
        if (!Number.isInteger(index) || index < 0) throw new SyncError("Invalid chunk");
        const row = this.ctx.storage.sql
          .exec<{ bytes: ArrayBuffer }>(
            "SELECT bytes FROM chunks WHERE transfer_id=? AND idx=?",
            parts[1],
            index,
          )
          .toArray()[0];
        if (!row) throw new SyncError("Missing transfer chunk", 404);
        return new Response(row.bytes, {
          headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" },
        });
      }
      if (parts[0] === "ack" && request.method === "POST") {
        const transfer = this.ctx.storage.sql
          .exec<{ recipient: string; sender: Role }>(
            "SELECT recipient,sender FROM transfers WHERE id=? AND complete=1",
            validID(parts[1]),
          )
          .toArray()[0];
        if (transfer && transfer.recipient === role) {
          s.acks[transfer.sender] = { id: parts[1], at: Date.now() };
          this.ctx.storage.transactionSync(() => {
            this.save(s!);
            this.drop(parts[1]);
          });
        }
        return json({ acknowledged: true });
      }
      throw new SyncError("Unknown Sync action", 404);
    } catch (error) {
      return json(
        { error: error instanceof SyncError ? error.message : "Sync request failed" },
        error instanceof SyncError ? error.status : error instanceof SyntaxError ? 400 : 500,
      );
    }
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url),
      origin = request.headers.get("Origin");
    const allowed = env.ALLOWED_ORIGINS.split(",");
    if (origin && !allowed.includes(origin)) return json({ error: "Origin not allowed" }, 403);
    const cors = {
      "Access-Control-Allow-Origin": origin ?? allowed[0],
      Vary: "Origin",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type",
      "Access-Control-Max-Age": "600",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const match = /^\/v1\/rooms\/([a-f0-9]{64})\/(.+)$/.exec(url.pathname);
    if (!match) return json({ error: "Not found" }, 404);
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    const limiter = match[2] === "create" ? env.PAIR_LIMITER : env.REQUEST_LIMITER;
    if (!(await limiter.limit({ key: ip })).success)
      return new Response(JSON.stringify({ error: "Too many requests. Wait a minute." }), {
        status: 429,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    const response = await env.PAIRS.getByName(match[1]).handle(request, match[1], match[2]);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
