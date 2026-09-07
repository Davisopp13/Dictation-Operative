import {
  DEFAULT_RELAY,
  SyncClient,
  url64,
  unbase64,
  sha256,
  validateRelay,
  type Device,
  type Pair,
  type Role,
} from './protocol';

export const PAIRING_SITE = 'https://do-voice-workspace.davisopp.chatgpt.site';
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export type PairingPeer = { device: Device; publicKey: string };
export type PairingState = {
  host: PairingPeer;
  guest: PairingPeer | null;
  expiresAt: number;
  approved: boolean;
};
const utf8 = new TextEncoder();
export function normalizeCode(value: string) {
  return value.replace(/[\s-]/g, '').toUpperCase();
}
export function validCode(value: string) {
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(normalizeCode(value));
}
export function displayCode(code: string) {
  return normalizeCode(code).replace(/(.{3})(?=.)/g, '$1 ');
}
export function pairingLink(
  code: string,
  publicKey: string,
  origin = PAIRING_SITE,
) {
  return `${origin}/pair#code=${normalizeCode(code)}&key=${publicKey}`;
}
export function parsePairingLink(
  value: string,
): { code: string; publicKey: string } | null {
  try {
    const u = new URL(value);
    if (
      u.pathname !== '/pair' ||
      (u.origin !== PAIRING_SITE && u.origin !== 'http://localhost:3000')
    )
      return null;
    const params = new URLSearchParams(u.hash.slice(1));
    const code = normalizeCode(params.get('code') ?? ''),
      publicKey = params.get('key') ?? '';
    return validCode(code) && /^[A-Za-z0-9_-]{87}$/.test(publicKey)
      ? { code, publicKey }
      : null;
  } catch {
    return null;
  }
}
export class PairingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** P-256 ECDH + HKDF; the short code locates public keys, never derives encryption keys. */
export class PairingClient {
  state!: PairingState;
  readonly roomAuth = url64(crypto.getRandomValues(new Uint8Array(32)));
  private constructor(
    readonly code: string,
    readonly role: Role,
    readonly device: Device,
    readonly token: string,
    readonly keys: CryptoKeyPair,
    readonly publicKey: string,
    readonly relay: string,
    private fetcher: typeof fetch,
  ) {}
  private static async make(
    code: string,
    role: Role,
    device: Device,
    relay: string,
    fetcher: typeof fetch,
  ) {
    if (!device.name.trim() || device.name.length > 60)
      throw new Error('Name this device first (up to 60 characters).');
    const keys = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    const publicKey = url64(
      new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)),
    );
    return new PairingClient(
      code,
      role,
      { ...device, name: device.name.trim() },
      url64(crypto.getRandomValues(new Uint8Array(32))),
      keys,
      publicKey,
      validateRelay(relay),
      fetcher,
    );
  }
  static async create(
    device: Device,
    relay = DEFAULT_RELAY,
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = Array.from(
        crypto.getRandomValues(new Uint8Array(6)),
        (b) => CODE_ALPHABET[b % 32],
      ).join('');
      const client = await this.make(code, 'host', device, relay, fetcher);
      try {
        await client.request('create', {
          peer: { device: client.device, publicKey: client.publicKey },
        });
        return client;
      } catch (e) {
        if (!(e instanceof PairingError) || e.status !== 409) throw e;
      }
    }
    throw new Error('Could not create a code. Try again.');
  }
  static async claim(
    code: string,
    device: Device,
    expectedHostKey?: string,
    relay = DEFAULT_RELAY,
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {
    if (!validCode(code))
      throw new Error(
        'Enter the six-character code shown on your other device.',
      );
    const client = await this.make(
      normalizeCode(code),
      'guest',
      device,
      relay,
      fetcher,
    );
    await client.request('claim', {
      peer: { device: client.device, publicKey: client.publicKey },
      expectedHostKey,
    });
    if (expectedHostKey && client.state.host.publicKey !== expectedHostKey)
      throw new Error('QR code does not match. Scan a new code.');
    return client;
  }
  async request(action: string, data: Record<string, unknown> = {}) {
    const response = await this.fetcher(`${this.relay}/v2/pairing/${action}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...data, code: this.code }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new PairingError(
        problem.error ?? 'Pairing could not connect. Try again.',
        response.status,
      );
    }
    const state = (await response.json()) as PairingState;
    const own = this.role === 'host' ? state.host : state.guest;
    if (
      own?.publicKey !== this.publicKey ||
      own.device.id !== this.device.id ||
      (this.state &&
        (state.host.publicKey !== this.state.host.publicKey ||
          state.host.device.id !== this.state.host.device.id)) ||
      (this.state?.guest &&
        (state.guest?.publicKey !== this.state.guest.publicKey ||
          state.guest.device.id !== this.state.guest.device.id))
    )
      throw new Error(
        'The pairing devices changed. Cancel and create a new code.',
      );
    this.state = state;
    return state;
  }
  poll() {
    return this.request('status');
  }
  cancel() {
    return this.request('cancel');
  }
  get link() {
    return pairingLink(this.code, this.publicKey);
  }
  private derive(info: string) {
    return derivePairingKey(
      this.keys.privateKey,
      this.role,
      this.code,
      this.state,
      info,
    );
  }
  async verification() {
    const value = (await sha256(await this.derive('verification')))
      .slice(0, 12)
      .toUpperCase();
    return value.match(/.{4}/g)!.join(' ');
  }
  async pair(): Promise<Pair> {
    const secret = url64(await this.derive('content-secret'));
    const guestAuth = url64(await this.derive('guest-authorization'));
    return {
      relay: this.relay,
      secret,
      auth: this.role === 'host' ? this.roomAuth : guestAuth,
      ...(this.role === 'host' ? { guestAuth } : {}),
      role: this.role,
      device: this.device,
      peerName: (this.role === 'host' ? this.state.guest! : this.state.host)
        .device.name,
    };
  }
  async approve() {
    if (this.role !== 'host' || !this.state.guest)
      throw new Error('Approve on the device displaying the QR code.');
    const guest = this.state.guest;
    const pair = await this.pair(),
      host = new SyncClient(pair, this.fetcher);
    await host.create();
    const current = await host.state();
    if (!current.approved) {
      await new SyncClient(
        {
          ...pair,
          auth: pair.guestAuth!,
          guestAuth: undefined,
          role: 'guest',
          device: guest.device,
        },
        this.fetcher,
      ).join();
      await host.approve(guest.device.id);
    }
    try {
      await this.request('approve', { guestKey: guest.publicKey });
    } catch (error) {
      if (error instanceof PairingError && [409, 410].includes(error.status))
        await host.revoke();
      throw error;
    }
    return pair;
  }
  async finish() {
    if (this.role !== 'guest' || !this.state.approved)
      throw new Error('Waiting for approval on your other device.');
    const pair = await this.pair(),
      current = await new SyncClient(pair, this.fetcher).state();
    if (
      !current.approved ||
      current.host.id !== this.state.host.device.id ||
      current.guest?.id !== this.device.id
    )
      throw new Error('Pairing is not ready. Try again.');
    return pair;
  }
}

export async function derivePairingKey(
  privateKey: CryptoKey,
  role: Role,
  code: string,
  state: PairingState,
  info: string,
) {
  const { host, guest } = state;
  if (!guest) throw new Error('Waiting for your other device.');
  const remote = role === 'host' ? guest : host;
  const publicKey = await crypto.subtle.importKey(
    'raw',
    unbase64(remote.publicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  );
  const key = await crypto.subtle.importKey('raw', shared, 'HKDF', false, [
    'deriveBits',
  ]);
  const transcript = [
    'DO-PAIR/2',
    code,
    host.publicKey,
    guest.publicKey,
    host.device.id,
    guest.device.id,
  ].join('\n');
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: utf8.encode(transcript),
        info: utf8.encode(info),
      },
      key,
      256,
    ),
  );
}
