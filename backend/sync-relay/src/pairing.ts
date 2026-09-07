import { DurableObject } from "cloudflare:workers";

type Peer = { device: { id: string; name: string }; publicKey: string };
type Session = {
  host: Peer;
  hostHash: string;
  guest?: Peer;
  guestHash?: string;
  expiresAt: number;
  approved: boolean;
  cancelled: boolean;
};
const reply = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

/** One short-lived rendezvous per code. Only public keys ever reach this object. */
export class PairingSession extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS pairing (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  }
  private get state(): Session | undefined {
    const row = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM pairing WHERE id=1").toArray()[0];
    return row ? JSON.parse(row.value) : undefined;
  }
  private save(s: Session) {
    this.ctx.storage.sql.exec("INSERT INTO pairing VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", JSON.stringify(s));
  }
  async alarm() {
    const s = this.state;
    if (!s || s.expiresAt <= Date.now()) this.ctx.storage.sql.exec("DELETE FROM pairing");
    else await this.ctx.storage.setAlarm(s.expiresAt);
  }
  async handle(action: string, token: string, data: Record<string, unknown>): Promise<Response> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return reply({ error: "Pairing authorization required." }, 401);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    let peer: Peer | undefined;
    if (action === "create" || action === "claim") {
      peer = data.peer as Peer;
      if (!peer?.device || typeof peer.device.id !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(peer.device.id)
        || typeof peer.device.name !== "string" || !peer.device.name.trim() || peer.device.name.length > 60
        || typeof peer.publicKey !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(peer.publicKey))
        return reply({ error: "Name this device and try again." }, 400);
      try {
        const bytes = Uint8Array.from(atob(peer.publicKey.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
        await crypto.subtle.importKey("raw", bytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
      } catch { return reply({ error: "Invalid device key." }, 400); }
      peer = { device: { id: peer.device.id, name: peer.device.name.trim() }, publicKey: peer.publicKey };
    }
    // No awaits between reading and writing: competing claims cannot replace a guest.
    let s = this.state;
    if (action === "create") {
      if (s && s.expiresAt > Date.now()) {
        if (s.hostHash === tokenHash && s.host.publicKey === peer!.publicKey && !s.cancelled)
          return reply({ host: s.host, guest: s.guest ?? null, expiresAt: s.expiresAt, approved: s.approved });
        return reply({ error: "Code already in use." }, 409);
      }
      s = { host: peer!, hostHash: tokenHash, expiresAt: Date.now() + 300000, approved: false, cancelled: false };
      this.save(s);
      await this.ctx.storage.setAlarm(s.expiresAt);
      return reply({ host: s.host, guest: null, expiresAt: s.expiresAt, approved: false });
    }
    if (!s || s.expiresAt <= Date.now() || s.cancelled)
      return reply({ error: "Code expired or unavailable. Create a new code on the other device." }, 410);
    if (action === "claim") {
      if (tokenHash === s.hostHash || peer!.device.id === s.host.device.id || peer!.publicKey === s.host.publicKey)
        return reply({ error: "Enter this code on your other device." }, 400);
      if (data.expectedHostKey && data.expectedHostKey !== s.host.publicKey)
        return reply({ error: "This QR code no longer matches. Scan a new code." }, 409);
      if (s.guest && (s.guestHash !== tokenHash || s.guest.publicKey !== peer!.publicKey || s.guest.device.id !== peer!.device.id))
        return reply({ error: "Code already used. Create a new code on the other device." }, 409);
      if (!s.guest) {
        s.guest = peer!;
        s.guestHash = tokenHash;
        this.save(s);
      }
    }
    const host = tokenHash === s.hostHash;
    if (!host && tokenHash !== s.guestHash) return reply({ error: "Pairing authorization rejected." }, 401);
    if (action === "approve") {
      if (!host || !s.guest || data.guestKey !== s.guest.publicKey)
        return reply({ error: "Check the requesting device before approving." }, 403);
      s.approved = true;
      this.save(s);
    } else if (action === "cancel") {
      if (s.approved) return reply({ error: "Already paired. Remove the device in Sync settings." }, 409);
      s.cancelled = true;
      this.save(s);
    } else if (action !== "status" && action !== "claim") return reply({ error: "Unknown pairing action." }, 404);
    return reply({ host: s.host, guest: s.guest ?? null, expiresAt: s.expiresAt, approved: s.approved });
  }
}
