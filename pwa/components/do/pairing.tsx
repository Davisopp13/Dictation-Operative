'use client';
import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, Copy, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from '@/components/ui/input-otp';
import {
  PairingClient,
  PairingError,
  displayCode,
  normalizeCode,
  validCode,
  type PairingState,
} from '@/lib/sync/pairing';
import type { Device, Pair } from '@/lib/sync/protocol';

export function PairingPanel({
  device,
  onPaired,
  onActiveChange,
  initialCode,
}: {
  device: Device;
  onPaired: (pair: Pair) => void;
  onActiveChange: (active: boolean) => void;
  initialCode?: { code: string; publicKey: string };
}) {
  const [client, setClient] = useState<PairingClient | null>(null);
  const [state, setState] = useState<PairingState | null>(null);
  const [code, setCode] = useState(initialCode?.code ?? '');
  const [verification, setVerification] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now()),
    [expired, setExpired] = useState(false);
  const [connected, setConnected] = useState(''),
    [copied, setCopied] = useState(false);
  const callbacks = useRef({ onPaired, onActiveChange });
  useEffect(() => {
    callbacks.current = { onPaired, onActiveChange };
  }, [onPaired, onActiveChange]);
  const working = useRef(false);
  const seconds = state
    ? Math.max(0, Math.ceil((state.expiresAt - now) / 1000))
    : 0;
  const isExpired = expired || (!!state && seconds === 0);
  async function run(fn: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pairing failed. Try again.');
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function activate(next: PairingClient) {
    setClient(next);
    setState(next.state);
    setNow(Date.now());
    setExpired(false);
    setVerification('');
    setConnected('');
    setCopied(false);
    callbacks.current.onActiveChange(true);
  }
  function complete(pair: Pair) {
    callbacks.current.onPaired(pair); // Persist before discarding the temporary keys.
    setConnected(pair.peerName);
    setClient(null);
    setState(null);
    setCode('');
    setVerification('');
    callbacks.current.onActiveChange(false);
  }
  async function cancel() {
    if (client) {
      try {
        await client.cancel();
      } catch (e) {
        if (!(e instanceof PairingError) || e.status !== 410) throw e;
      }
    }
    setClient(null);
    setState(null);
    setVerification('');
    setExpired(false);
    callbacks.current.onActiveChange(false);
  }
  useEffect(() => {
    if (!client) return;
    let active = true,
      polling = false;
    async function poll() {
      if (
        !active ||
        polling ||
        working.current ||
        Date.now() >= client!.state.expiresAt
      )
        return;
      polling = true;
      try {
        const value = await client!.poll();
        const match = value.guest ? await client!.verification() : '';
        if (!active || working.current) return;
        setState(value);
        setVerification(match);
        setError('');
        if (value.approved && client!.role === 'guest') {
          const pair = await client!.finish();
          if (active && !working.current) complete(pair);
        }
      } catch (e) {
        if (active && !working.current) {
          setError(
            e instanceof Error
              ? e.message
              : 'Connection interrupted. Retrying…',
          );
          if (e instanceof PairingError && e.status === 410) setExpired(true);
        }
      } finally {
        polling = false;
      }
    }
    void poll();
    const pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void poll();
    }, 2000);
    const clockTimer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      clearInterval(pollTimer);
      clearInterval(clockTimer);
    };
  }, [client]);
  return (
    <section className="pairing-panel" aria-label="Pair another device">
      <div className="pairing-heading">
        <Link2 size={20} />
        <h3>Pair another device</h3>
      </div>
      {connected && (
        <output className="pairing-connected">
          <CheckCircle2 size={20} />
          Connected to {connected}
        </output>
      )}
      {!client ? (
        <>
          <p className="subtle">
            Create a code here, or enter the code from your other device.
          </p>
          <Button
            disabled={busy || !device.name.trim()}
            onClick={() =>
              void run(async () => activate(await PairingClient.create(device)))
            }
          >
            {busy ? 'Connecting…' : 'Pair a device'}
          </Button>
          <form
            className="pairing-entry"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const pin =
                  initialCode && normalizeCode(code) === initialCode.code
                    ? initialCode.publicKey
                    : undefined;
                activate(await PairingClient.claim(code, device, pin));
              });
            }}
          >
            <label htmlFor="pairing-code" className="field-label">
              {initialCode
                ? 'Scanned code — ready to connect'
                : 'Have a code? Enter it here'}
            </label>
            <InputOTP
              id="pairing-code"
              aria-label="Six-character pairing code"
              value={code}
              onChange={(v) => setCode(normalizeCode(v))}
              maxLength={6}
              pattern="[a-zA-Z2-9]*"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              pasteTransformer={normalizeCode}
              disabled={busy}
            >
              <InputOTPGroup>
                {[0, 1, 2].map((i) => (
                  <InputOTPSlot key={i} index={i} className="size-10 text-lg" />
                ))}
              </InputOTPGroup>
              <InputOTPSeparator className="px-2" />
              <InputOTPGroup>
                {[3, 4, 5].map((i) => (
                  <InputOTPSlot key={i} index={i} className="size-10 text-lg" />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <Button
              type="submit"
              variant="outline"
              disabled={busy || !validCode(code) || !device.name.trim()}
            >
              Connect with code
            </Button>
          </form>
        </>
      ) : isExpired ? (
        <div>
          <h4>Code expired or cancelled</h4>
          <p>Create a new code and try again.</p>
          <div className="actions">
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const host = client.role === 'host';
                  await cancel();
                  if (host) activate(await PairingClient.create(device));
                })
              }
            >
              {client.role === 'host'
                ? 'Create new code'
                : 'Enter another code'}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(cancel)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : (
        <>
          {client.role === 'host' && !state?.guest ? (
            <div className="pairing-invitation">
              <div className="pairing-qr">
                <QRCodeSVG
                  value={client.link}
                  size={192}
                  level="M"
                  marginSize={4}
                  title="Scan to pair with this device"
                />
              </div>
              <div>
                <h4>Scan with your phone’s camera</h4>
                <p className="subtle">
                  Or open Sync on your other device and enter:
                </p>
                <p
                  className="pairing-code"
                  aria-label={`Pairing code ${client.code.split('').join(' ')}`}
                >
                  {displayCode(client.code)}
                </p>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await navigator.clipboard.writeText(client.code);
                      setCopied(true);
                    })
                  }
                >
                  <Copy size={16} />
                  {copied ? 'Copied' : 'Copy code'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="pairing-confirmation">
              <h4>
                {client.role === 'host'
                  ? `Pair with “${state?.guest?.device.name}”?`
                  : `Waiting for “${state?.host.device.name}”`}
              </h4>
              <p>Check that this confirmation matches on both devices.</p>
              <p
                className="pairing-verification"
                aria-label="Confirmation fingerprint"
              >
                {verification || 'Checking…'}
              </p>
              {client.role === 'host' ? (
                <Button
                  disabled={busy || !verification}
                  onClick={() =>
                    void run(async () => complete(await client.approve()))
                  }
                >
                  {busy ? 'Pairing…' : 'They match — pair devices'}
                </Button>
              ) : (
                <p className="subtle">
                  Approve on your other device to finish. This screen will
                  connect automatically.
                </p>
              )}
            </div>
          )}
          <div className="pairing-footer">
            <span>
              Expires in {Math.floor(seconds / 60)}:
              {String(seconds % 60).padStart(2, '0')}
            </span>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run(cancel)}
            >
              Cancel pairing
            </Button>
          </div>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
