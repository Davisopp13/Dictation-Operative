'use client';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  SyncClient,
  DEFAULT_RELAY,
  parseInvitation,
  type Pair,
  type PairState,
  type Payload,
} from '@/lib/sync/protocol';
import {
  imagePayload,
  readClipboard,
  writeClipboard,
} from '@/lib/sync/clipboard';
import type { SettingsState } from '@/components/do/settings';
import { AccountPanel } from '@/components/do/account';
import { PairingPanel } from '@/components/do/pairing';
type Saved = {
  device: { id: string; name: string };
  pairs: Pair[];
  selected: string;
  paused: boolean;
};
export function SyncDialog({
  open,
  onOpenChange,
  account,
  draft,
  initialCode,
  onSettings,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  account: string;
  draft: string;
  initialCode?: { code: string; publicKey: string };
  onSettings?: (settings: SettingsState) => void;
}) {
  const key = `do-sync-v1:${account}`;
  const [saved, setSaved] = useState<Saved | null>(null),
    [state, setState] = useState<PairState | null>(null),
    [code, setCode] = useState(''),
    [pairingActive, setPairingActive] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [pasted, setPasted] = useState<Payload | null>(null),
    [pasteText, setPasteText] = useState('');
  const sent = useRef('');
  const pair = saved?.pairs.find((p) => p.secret === saved.selected);
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(key);
        setSaved(
          raw
            ? JSON.parse(raw)
            : {
                device: {
                  id: crypto.randomUUID(),
                  name: /iPhone|iPad/.test(navigator.userAgent)
                    ? 'My iPhone or iPad'
                    : 'My browser',
                },
                pairs: [],
                selected: '',
                paused: false,
              },
        );
      } catch {
        setError(
          'Device storage is unavailable. Enable site storage to pair this browser.',
        );
      }
    });
  }, [key]);
  function save(next: Saved) {
    localStorage.setItem(key, JSON.stringify(next));
    setSaved(next);
  }
  useEffect(() => {
    if (!open || !pair || saved?.paused) {
      queueMicrotask(() => setState(null));
      return;
    }
    let active = true;
    const client = new SyncClient(pair);
    async function poll() {
      try {
        const value = await client.state();
        if (active) {
          setState(value);
          if (sent.current && value.ack?.id === sent.current) {
            setMessage('Received and copied on your paired device.');
            sent.current = '';
          }
        }
      } catch {
        if (active) setState(null);
      }
    }
    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void poll();
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, pair, saved?.paused]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setProgress(0);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed. Try again.');
    } finally {
      setBusy(false);
    }
  }
  async function send(payload: Payload) {
    if (!pair || saved?.paused)
      throw new Error('Choose a paired device and resume Sync.');
    const execute = async () => {
      const e = await new SyncClient(pair).send(payload, setProgress);
      sent.current = e.id;
      setMessage(
        'Encrypted transfer sent. Receive it on the other device within 2 minutes.',
      );
      setPasted(null);
      setPasteText('');
    };
    if (navigator.locks)
      await navigator.locks.request(`do-sync-send:${pair.secret}`, execute);
    else await execute();
  }
  function receive() {
    if (!pair || !state?.latest || saved?.paused) return;
    const client = new SyncClient(pair),
      latest = state.latest;
    // Begin both clipboard write and its data promise in the original click gesture.
    const payload = client.receive(latest, setProgress);
    let write: Promise<void>;
    try {
      write = writeClipboard(latest.mime, payload);
    } catch (e) {
      void payload.catch(() => {});
      setError(e instanceof Error ? e.message : 'Clipboard writing failed.');
      return;
    }
    void run(async () => {
      await write;
      await client.ack(latest.id);
      setState((s) => (s ? { ...s, latest: null } : s));
      setMessage('Copied to this device. Paste into another app.');
    });
  }
  const enabled = !!pair && !!state?.approved && !saved?.paused && !busy;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy && !pairingActive) {
          setCode('');
          setPasted(null);
          setPasteText('');
          onOpenChange(v);
        }
      }}
    >
      <DialogContent className="sync-dialog">
        <DialogHeader>
          <DialogTitle>Dictation Operative Sync</DialogTitle>
          <DialogDescription>
            Pair once. Send text, screenshots, or dictation between your
            devices.
          </DialogDescription>
        </DialogHeader>
        {saved && (
          <>
            <AccountPanel key={`account:${account}`} owner={account} onSettings={onSettings} device={saved.device} pair={pair} disabled={busy || pairingActive || saved.paused} />
            <div className="sync-row">
              <label className="field-label" htmlFor="sync-name">
                This device
              </label>
              <Input
                id="sync-name"
                className="field"
                value={saved.device.name}
                disabled={busy || pairingActive}
                maxLength={60}
                onChange={(e) =>
                  save({
                    ...saved,
                    device: { ...saved.device, name: e.target.value },
                  })
                }
              />
              <Button
                variant="outline"
                disabled={busy || pairingActive || !saved.device.name.trim()}
                onClick={() =>
                  void run(async () => {
                    const pairs = [];
                    for (const p of saved.pairs) {
                      const updated = { ...p, device: saved.device };
                      await new SyncClient(p).rename(saved.device);
                      pairs.push(updated);
                    }
                    save({ ...saved, pairs });
                    setMessage('Device name saved.');
                  })
                }
              >
                Save name
              </Button>
            </div>
            <PairingPanel
              key={account}
              device={saved.device}
              initialCode={initialCode}
              onActiveChange={setPairingActive}
              onPaired={(p) => {
                save({
                  ...saved,
                  pairs: [
                    ...saved.pairs.filter((x) => x.secret !== p.secret),
                    p,
                  ],
                  selected: p.secret,
                  paused: false,
                });
                setState(null);
                setMessage(`Connected to ${p.peerName}.`);
              }}
            />
            {!!saved.pairs.length && (
              <Button
                variant="outline"
                disabled={busy || pairingActive}
                onClick={() => save({ ...saved, paused: !saved.paused })}
              >
                {saved.paused ? 'Resume Sync' : 'Pause Sync'}
              </Button>
            )}
            <details>
              <summary>Pair with an older app version</summary>
              <label className="sr-only" htmlFor="sync-code">
                Pairing invitation
              </label>
              <Textarea
                id="sync-code"
                className="field mt-2"
                placeholder="dosync1:…"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                maxLength={2048}
              />
              <Button
                disabled={busy || pairingActive || !code.trim()}
                onClick={() =>
                  void run(async () => {
                    const p = parseInvitation(code, saved.device);
                    if (saved.pairs.some((x) => x.secret === p.secret))
                      throw new Error(
                        'This device already has that invitation.',
                      );
                    if (p.relay !== DEFAULT_RELAY)
                      throw new Error(
                        'This version pairs only with the configured Dictation Operative relay.',
                      );
                    await new SyncClient(p).join();
                    save({
                      ...saved,
                      pairs: [...saved.pairs, p],
                      selected: p.secret,
                    });
                    setCode('');
                    setState(null);
                    setMessage('Approve this device on the inviting device.');
                  })
                }
              >
                Request pairing
              </Button>
            </details>
            {!!saved.pairs.length && (
              <>
                <label className="field-label" htmlFor="sync-device">
                  Send to
                </label>
                <NativeSelect
                  className="field"
                  id="sync-device"
                  disabled={busy || pairingActive}
                  value={saved.selected}
                  onChange={(e) => {
                    save({ ...saved, selected: e.target.value });
                    setState(null);
                  }}
                >
                  <option value="" disabled>
                    Choose a device
                  </option>
                  {saved.pairs.map((p) => (
                    <option key={p.secret} value={p.secret}>
                      {p.secret === pair?.secret && state
                        ? ((p.role === 'host'
                            ? state.guest?.name
                            : state.host.name) ?? 'Waiting for a device')
                        : p.peerName}
                    </option>
                  ))}
                </NativeSelect>
              </>
            )}
            {pair && (
              <>
                <output className="subtle text-sm">
                  {saved.paused
                    ? 'Sync is paused. Waiting transfers still expire after 2 minutes.'
                    : !state
                      ? 'Connecting… If this persists, check the connection or create a new invitation.'
                      : !state.approved
                        ? 'Waiting for pairing approval'
                        : state.peerOnline
                          ? 'Connected · end-to-end encrypted'
                          : 'Paired · other device is offline or asleep'}
                </output>
                {!state?.approved && state?.guest && pair.role === 'host' && (
                  <Button
                    disabled={busy || pairingActive}
                    onClick={() =>
                      void run(async () => {
                        await new SyncClient(pair).approve(state.guest!.id);
                        setState(await new SyncClient(pair).state());
                        const updated = {
                          ...pair,
                          peerName: state.guest!.name,
                        };
                        save({
                          ...saved,
                          pairs: saved.pairs.map((p) =>
                            p.secret === pair.secret ? updated : p,
                          ),
                        });
                        setMessage('Device paired.');
                      })
                    }
                  >
                    Trust and pair “{state.guest.name}”
                  </Button>
                )}
                <div className="actions">
                  <Button
                    disabled={!enabled}
                    onClick={() => {
                      const read = readClipboard();
                      void run(async () => send(await read));
                    }}
                  >
                    <Send /> Send clipboard
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!enabled || !state?.latest}
                    onClick={receive}
                  >
                    <RefreshCw /> Receive latest
                    {state?.latest?.mime === 'image/png' ? ' image' : ''}
                  </Button>
                  {draft && (
                    <Button
                      variant="outline"
                      disabled={!enabled}
                      onClick={() =>
                        void run(() =>
                          send({
                            mime: 'text/plain',
                            bytes: new TextEncoder().encode(draft),
                          }),
                        )
                      }
                    >
                      Send current dictation
                    </Button>
                  )}
                </div>
                <details>
                  <summary>
                    Clipboard access blocked? Paste here to send
                  </summary>
                  <Textarea
                    aria-label="Paste text or an image to send"
                    className="field mt-2"
                    rows={3}
                    value={pasteText}
                    placeholder="Paste text or an image here…"
                    onChange={(e) => {
                      setPasteText(e.target.value);
                      setPasted(null);
                    }}
                    onPaste={(e) => {
                      const file = Array.from(e.clipboardData.items)
                        .find((i) => i.type.startsWith('image/'))
                        ?.getAsFile();
                      if (file) {
                        e.preventDefault();
                        void run(async () => {
                          setPasted(await imagePayload(file));
                          setPasteText('');
                          setMessage('Image ready to send.');
                        });
                      }
                    }}
                  />
                  <Button
                    disabled={!enabled || (!pasted && !pasteText)}
                    onClick={() =>
                      void run(() =>
                        send(
                          pasted ?? {
                            mime: 'text/plain',
                            bytes: new TextEncoder().encode(pasteText),
                          },
                        ),
                      )
                    }
                  >
                    Send pasted {pasted ? 'image' : 'text'}
                  </Button>
                </details>
                <Button
                  variant="ghost"
                  disabled={busy || pairingActive}
                  onClick={() =>
                    void run(async () => {
                      await new SyncClient(pair).revoke();
                      const remaining = saved.pairs.filter(
                        (p) => p.secret !== pair.secret,
                      );
                      save({
                        ...saved,
                        pairs: remaining,
                        selected: remaining[0]?.secret ?? '',
                      });
                      setState(null);
                      setMessage(
                        'Trust revoked on both devices. Queued content deleted.',
                      );
                    })
                  }
                >
                  Remove selected device
                </Button>
              </>
            )}
          </>
        )}
        {busy && (
          <Progress
            aria-label="Sync transfer progress"
            max={100}
            value={progress}
            className="w-full"
          />
        )}
        {message && (
          <Alert className="success-message" aria-live="polite">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive" className="error-message" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <p className="subtle text-sm">
          Text up to 256 KiB · PNG images up to 8 MiB / 40 MP. Transfers expire
          after 2 minutes and are removed after receipt. This browser stores
          pairing keys locally, never clipboard history. Internet required.
          iPhone/iPad and browsers use explicit actions while open; automatic
          clipboard sync is available in the Mac app. Copied URLs remain text;
          file references are not transferred.
        </p>
      </DialogContent>
    </Dialog>
  );
}
