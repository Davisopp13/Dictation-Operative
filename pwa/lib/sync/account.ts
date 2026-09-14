import {
  base64,
  unbase64,
  url64,
  sha256,
  credentials,
  SyncClient,
  DEFAULT_RELAY,
  validatePayload,
  type Device,
  type Pair,
  type Payload,
} from "./protocol";
export type Account = {
  v: 1;
  id: string;
  label: string;
  secret: string;
  token: string;
  device: Device;
};
export type AccountEnvelope = {
  v: 1;
  id: string;
  account: string;
  sender: string;
  kind: "settings" | "clipboard";
  revision: number;
  createdAt: number;
  expiresAt: number;
  iv: string;
  ciphertext: string;
};
export type AISettings = {
  v: 1;
  provider: "groq";
  model: string;
  cleanupEnabled: boolean;
  vocabulary: string[];
  groqKey: string | null;
};
export type AccountState = {
  id: string;
  devices: (Device & { seen: number })[];
  settingsRevision: number;
  settings: AccountEnvelope | null;
  clipboardRevision: number;
  clipboards: AccountEnvelope[];
};
const encode = (v: string) => new TextEncoder().encode(v);
export const randomSecret = () => url64(crypto.getRandomValues(new Uint8Array(32)));
export function validateAccount(a: Account) {
  if (
    a?.v !== 1 ||
    !/^[a-f0-9]{64}$/.test(a.id) ||
    !/^[A-Za-z0-9_-]{43}$/.test(a.secret) ||
    !/^[A-Za-z0-9_-]{43}$/.test(a.token) ||
    !a.device ||
    !/^[a-zA-Z0-9_-]{8,80}$/.test(a.device.id) ||
    !a.device.name ||
    a.device.name.length > 60 ||
    typeof a.label !== "string" ||
    a.label.length > 300
  )
    throw new Error("Invalid account invitation.");
  return a;
}
export function validateAISettings(s: AISettings) {
  if (
    s?.v !== 1 ||
    s.provider !== "groq" ||
    typeof s.model !== "string" ||
    !/^[a-zA-Z0-9/_.-]{1,120}$/.test(s.model) ||
    typeof s.cleanupEnabled !== "boolean" ||
    !Array.isArray(s.vocabulary) ||
    s.vocabulary.length > 500 ||
    s.vocabulary.some((w) => typeof w !== "string" || w.length > 100) ||
    (s.groqKey !== null &&
      (typeof s.groqKey !== "string" || !/^gsk_[\w-]{15,296}$/.test(s.groqKey)))
  )
    throw new Error("Invalid shared Groq settings.");
  return s;
}
const aad = (e: AccountEnvelope) =>
  encode(
    ["DO-ACCOUNT/1", e.account, e.id, e.sender, e.kind, e.revision, e.createdAt, e.expiresAt].join(
      "\n",
    ),
  );
async function key(secret: string, purpose: string) {
  const source = await crypto.subtle.importKey("raw", unbase64(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encode("DO-ACCOUNT/1"), info: encode(purpose) },
    source,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(
  account: Account,
  kind: AccountEnvelope["kind"],
  revision: number,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<AccountEnvelope> {
  validateAccount(account);
  const now = Date.now(),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const e: AccountEnvelope = {
    v: 1,
    id: crypto.randomUUID(),
    account: account.id,
    sender: account.device.id,
    kind,
    revision,
    createdAt: now,
    expiresAt: kind === "clipboard" ? now + 120000 : 0,
    iv: base64(iv),
    ciphertext: "",
  };
  if (kind === "settings" && bytes.length > 49000)
    throw new Error("Shared settings are too large. Shorten the vocabulary.");
  e.ciphertext = base64(
    new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad(e) },
        await key(account.secret, kind),
        bytes,
      ),
    ),
  );
  return e;
}
export async function open(account: Account, e: AccountEnvelope, kind: AccountEnvelope["kind"]) {
  validateAccount(account);
  if (
    e.v !== 1 ||
    e.account !== account.id ||
    e.kind !== kind ||
    !Number.isSafeInteger(e.revision) ||
    e.revision < 1 ||
    !Number.isSafeInteger(e.createdAt) ||
    e.createdAt > Date.now() + 30000 ||
    !Number.isSafeInteger(e.expiresAt) ||
    (kind === "clipboard"
      ? e.expiresAt <= Date.now() || e.expiresAt > e.createdAt + 120000
      : e.expiresAt !== 0) ||
    e.ciphertext.length > (kind === "settings" ? 65536 : 12 * 1024 * 1024)
  )
    throw new Error("Invalid or expired shared item.");
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unbase64(e.iv), additionalData: aad(e) },
      await key(account.secret, kind),
      unbase64(e.ciphertext),
    ),
  );
}
export class AccountClient {
  constructor(
    readonly account: Account,
    private fetcher: typeof fetch = (...args) => fetch(...args),
  ) {
    validateAccount(account);
  }
  async request<T>(action: string, body?: unknown): Promise<T> {
    const response = await this.fetcher(
      `${DEFAULT_RELAY}/v1/accounts/${this.account.id}/${action}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${this.account.token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      },
    );
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error || "Account sync failed.");
    return data;
  }
  state() {
    return this.request<AccountState>("state");
  }
  async publishSettings(settings: AISettings, revision: number) {
    const envelope = await seal(
      this.account,
      "settings",
      revision + 1,
      encode(JSON.stringify(validateAISettings(settings))),
    );
    await this.request("settings", { envelope });
  }
  async settings(e: AccountEnvelope) {
    return validateAISettings(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(await open(this.account, e, "settings")),
      ),
    );
  }
  async sendClipboard(payload: Payload, revision: number) {
    validatePayload(payload);
    const bytes = new Uint8Array(payload.bytes.length + 1);
    bytes[0] = payload.mime === "text/plain" ? 0 : 1;
    bytes.set(payload.bytes, 1);
    const envelope = await seal(this.account, "clipboard", revision + 1, bytes);
    await this.request("clipboard", { envelope });
  }
  async clipboard(e: AccountEnvelope): Promise<Payload> {
    const current = await this.request<AccountEnvelope>(`clipboard/${e.sender}`);
    if (current.id !== e.id)
      throw new Error("This clipboard was replaced. Refresh to see the latest.");
    const bytes = await open(this.account, current, "clipboard");
    if (bytes[0] !== 0 && bytes[0] !== 1) throw new Error("Invalid clipboard item.");
    const payload: Payload = {
      mime: bytes[0] === 0 ? "text/plain" : "image/png",
      bytes: bytes.slice(1),
    };
    validatePayload(payload);
    return payload;
  }

  async invite(pair: Pair) {
    const state = await new SyncClient(pair, this.fetcher).state();
    if (!state.approved) throw new Error("Approve this device pairing first.");
    const peer = pair.role === "host" ? state.guest : state.host;
    if (!peer) throw new Error("Pair a device first.");
    const next: Account = {
      ...this.account,
      device: { ...peer, id: crypto.randomUUID() },
      token: randomSecret(),
    };
    await this.request("register", { ...next.device, tokenHash: await sha256(encode(next.token)) });
    try {
      await sendAccountInvite(pair, next, this.fetcher);
    } catch (e) {
      await this.request("revoke", { id: next.device.id });
      throw e;
    }
  }
}
type Invitation = { iv: string; ciphertext: string; expiresAt: number };
const inviteAAD = (room: string, recipient: string, expires: number) =>
  encode(["DO-ACCOUNT-INVITE/1", room, recipient, expires].join("\n"));
export async function sendAccountInvite(
  pair: Pair,
  account: Account,
  fetcher: typeof fetch = fetch,
) {
  const c = await credentials(pair),
    expiresAt = Date.now() + 300000,
    iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = base64(
    new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: inviteAAD(c.room, pair.role === "host" ? "guest" : "host", expiresAt),
        },
        await key(pair.secret, "invitation"),
        encode(JSON.stringify(validateAccount(account))),
      ),
    ),
  );
  await new SyncClient(pair, fetcher).request("account-invite", "POST", {
    iv: base64(iv),
    ciphertext,
    expiresAt,
  });
}
export async function receiveAccountInvite(pair: Pair, fetcher: typeof fetch = fetch) {
  const { invitation: e } = await new SyncClient(pair, fetcher).request<{
    invitation: Invitation | null;
  }>("account-invite");
  if (!e || e.expiresAt <= Date.now())
    throw new Error("No account invitation is waiting. Send one from a trusted device.");
  const c = await credentials(pair);
  const bytes = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unbase64(e.iv),
      additionalData: inviteAAD(c.room, pair.role, e.expiresAt),
    },
    await key(pair.secret, "invitation"),
    unbase64(e.ciphertext),
  );
  return validateAccount(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}
