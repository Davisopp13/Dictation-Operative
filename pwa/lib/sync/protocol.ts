/** Portable Sync protocol. No browser, transcription, or persistence dependencies. */
export const CHUNK = 262144;
export const IMAGE_LIMIT = 8 * 1024 * 1024;
export const DEFAULT_RELAY = "https://dictation-operative-sync.davisopp.workers.dev";
export type Role = "host" | "guest";
export type Device = { id: string; name: string };
export type Pair = {
  relay: string;
  secret: string;
  auth: string;
  guestAuth?: string;
  role: Role;
  device: Device;
  peerName: string;
};
export type Envelope = {
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
export type PairState = {
  approved: boolean;
  host: Device;
  guest: Device | null;
  peerOnline: boolean;
  sequence: number;
  latest: Envelope | null;
  ack: { id: string; at: number } | null;
  serverTime: number;
};
export type Payload = { mime: Envelope["mime"]; bytes: Uint8Array<ArrayBuffer> };
const encoder = new TextEncoder();
export const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
export const base64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
export function unbase64(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}
export const url64 = (bytes: Uint8Array) =>
  base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  hex(await crypto.subtle.digest("SHA-256", bytes));
export function validateRelay(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw new Error("Use an HTTPS relay origin.");
  return u.origin;
}
export async function credentials(pair: Pair) {
  const secret = unbase64(pair.secret);
  if (secret.length !== 32) throw new Error("Invalid pairing secret.");
  const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  const derive = async (info: string) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: encoder.encode("Dictation Operative Sync v1"),
          info: encoder.encode(info),
        },
        key,
        256,
      ),
    );
  const [room, content] = await Promise.all(["room", "content-key"].map(derive));
  if (!/^[A-Za-z0-9_-]{43}$/.test(pair.auth)) throw new Error("Invalid device authorization.");
  return {
    room: hex(room.buffer),
    token: pair.auth,
    guestHash: pair.guestAuth ? await sha256(encoder.encode(pair.guestAuth)) : "",
    key: await crypto.subtle.importKey("raw", content, "AES-GCM", false, ["encrypt", "decrypt"]),
  };
}
export function aad(e: Envelope) {
  return encoder.encode(
    ["DO-SYNC/1", e.room, e.id, e.from, e.to, e.sequence, e.createdAt, e.expiresAt, e.mime].join(
      "\n",
    ),
  );
}
export function validatePayload(payload: Payload) {
  const { bytes, mime } = payload;
  if (!bytes.length || bytes.length > (mime === "image/png" ? IMAGE_LIMIT : CHUNK))
    throw new Error(
      mime === "image/png"
        ? "Images must be 8 MiB or smaller."
        : "Text must be between 1 byte and 256 KiB.",
    );
  if (mime === "image/png") {
    if (
      bytes.length < 33 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b) ||
      String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR"
    )
      throw new Error("This clipboard image is not a valid PNG.");
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      w = d.getUint32(16),
      h = d.getUint32(20);
    if (!w || !h || w > 16384 || h > 16384 || w * h > 40000000)
      throw new Error("Image dimensions exceed the 40 megapixel limit.");
  } else new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export function invitation(pair: Pair) {
  return (
    "dosync1:" +
    url64(
      encoder.encode(
        JSON.stringify({
          relay: pair.relay,
          secret: pair.secret,
          auth: pair.guestAuth,
          name: pair.device.name,
        }),
      ),
    )
  );
}
export function parseInvitation(code: string, device: Device): Pair {
  if (!code.trim().startsWith("dosync1:") || code.length > 2048)
    throw new Error("Paste a complete Dictation Operative Sync invitation.");
  const data = JSON.parse(new TextDecoder().decode(unbase64(code.trim().slice(8))));
  if (
    typeof data.auth !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(data.auth) ||
    typeof data.secret !== "string" ||
    unbase64(data.secret).length !== 32 ||
    typeof data.name !== "string" ||
    data.name.length > 60
  )
    throw new Error("Invalid invitation.");
  return {
    relay: validateRelay(data.relay),
    secret: data.secret,
    auth: data.auth,
    role: "guest",
    device,
    peerName: data.name,
  };
}
export class SyncClient {
  constructor(
    readonly pair: Pair,
    private fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}
  async request<T>(action: string, method = "GET", body?: unknown): Promise<T> {
    const c = await credentials(this.pair);
    const response = await this.fetcher(`${this.pair.relay}/v1/rooms/${c.room}/${action}`, {
      method,
      headers: {
        Authorization: `Bearer ${c.token}`,
        ...(body
          ? {
              "Content-Type":
                body instanceof Uint8Array ? "application/octet-stream" : "application/json",
            }
          : {}),
      },
      body:
        body instanceof Uint8Array
          ? (body as Uint8Array<ArrayBuffer>)
          : body
            ? JSON.stringify(body)
            : undefined,
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(problem.error ?? `Sync connection failed (${response.status}).`);
    }
    return (
      action.startsWith("download/")
        ? new Uint8Array(await response.arrayBuffer())
        : await response.json()
    ) as T;
  }
  async create() {
    const c = await credentials(this.pair);
    return this.request("create", "POST", { guestHash: c.guestHash, device: this.pair.device });
  }
  join() {
    return this.request("join", "POST", { device: this.pair.device });
  }
  state() {
    return this.request<PairState>("state");
  }
  approve(deviceId: string) {
    return this.request("approve", "POST", { deviceId });
  }
  async revoke() {
    try {
      return await this.request("revoke", "POST", {});
    } catch (e) {
      if (e instanceof Error && e.message === "Pairing removed or unavailable") return;
      throw e;
    }
  }
  rename(device: Device) {
    return this.request("rename", "POST", { device });
  }
  async send(payload: Payload, progress: (percent: number) => void = () => {}) {
    validatePayload(payload);
    const state = await this.state();
    if (!state.approved) throw new Error("Approve this pairing first.");
    const c = await credentials(this.pair),
      nonce = crypto.getRandomValues(new Uint8Array(12)),
      now = Date.now();
    const e: Envelope = {
      v: 1,
      room: c.room,
      id: crypto.randomUUID(),
      from: this.pair.role,
      to: this.pair.role === "host" ? "guest" : "host",
      sequence: state.sequence + 1,
      createdAt: now,
      expiresAt: now + 120000,
      mime: payload.mime,
      iv: base64(nonce),
      size: payload.bytes.length + 16,
      digest: "",
    };
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce, additionalData: aad(e) },
        c.key,
        payload.bytes,
      ),
    );
    e.digest = await sha256(encrypted);
    const start = await this.request<{ committed?: boolean; received?: number[] }>(
      "start",
      "POST",
      e,
    );
    if (!start.committed) {
      for (let i = 0; i < Math.ceil(encrypted.length / CHUNK); i++) {
        if (!start.received?.includes(i))
          await this.request(
            `chunk/${e.id}/${i}`,
            "PUT",
            encrypted.slice(i * CHUNK, (i + 1) * CHUNK),
          );
        progress(Math.round((Math.min(encrypted.length, (i + 1) * CHUNK) / encrypted.length) * 95));
      }
      await this.request(`commit/${e.id}`, "POST", {});
    }
    progress(100);
    return e;
  }
  async receive(e: Envelope, progress: (percent: number) => void = () => {}): Promise<Payload> {
    const c = await credentials(this.pair);
    if (
      e.v !== 1 ||
      e.room !== c.room ||
      e.to !== this.pair.role ||
      e.from === e.to ||
      !["text/plain", "image/png"].includes(e.mime) ||
      e.expiresAt <= Date.now() ||
      e.createdAt > Date.now() + 30000 ||
      e.expiresAt - e.createdAt > 120000 ||
      !Number.isSafeInteger(e.size) ||
      e.size < 17 ||
      e.size > IMAGE_LIMIT + 16
    )
      throw new Error("This transfer is invalid or has expired. Send it again.");
    const encrypted = new Uint8Array(e.size);
    for (let i = 0; i < Math.ceil(e.size / CHUNK); i++) {
      const part = await this.request<Uint8Array<ArrayBuffer>>(`download/${e.id}/${i}`);
      if (part.length !== Math.min(CHUNK, e.size - i * CHUNK))
        throw new Error("Incomplete image transfer. Send it again.");
      encrypted.set(part, i * CHUNK);
      progress(Math.round((Math.min(e.size, (i + 1) * CHUNK) / e.size) * 95));
    }
    if ((await sha256(encrypted)) !== e.digest) throw new Error("Transfer integrity check failed.");
    const payload = {
      mime: e.mime,
      bytes: new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: unbase64(e.iv), additionalData: aad(e) },
          c.key,
          encrypted,
        ),
      ),
    };
    validatePayload(payload);
    progress(100);
    return payload;
  }
  ack(id: string) {
    return this.request(`ack/${id}`, "POST", {});
  }
}
