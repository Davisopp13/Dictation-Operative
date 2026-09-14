'use client';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, post, errorMessage } from '@/lib/client';
import {
  AccountClient,
  randomSecret,
  receiveAccountInvite,
  validateAccount,
  type Account,
  type AccountState,
} from '@/lib/sync/account';
import {
  SyncClient,
  type Pair,
  type Device,
  type Payload,
} from '@/lib/sync/protocol';
import type { SettingsState } from '@/components/do/settings';
import { readClipboard, writeClipboard } from '@/lib/sync/clipboard';

// Keep browser account access behind the same signed-in account as the workspace.
const accountFetch: typeof fetch = (url, init) => {
  const value = new URL(url instanceof Request ? url.url : String(url));
  const path = value.pathname.match(/^\/v1\/accounts\/(.+)$/);
  return path
    ? fetch('/api/account-relay/' + path[1], {
        ...init,
        credentials: 'same-origin',
      })
    : fetch(url, init);
};
export function AccountPanel({
  owner,
  device,
  pair,
  disabled,
  onSettings,
}: {
  owner: string;
  device: Device;
  pair?: Pair;
  disabled: boolean;
  onSettings?: (settings: SettingsState) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [preview, setPreview] = useState<{
    payload: Payload;
    expires: number;
  } | null>(null);
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(
      () => setPreview(null),
      Math.max(0, preview.expires - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [preview]);
  const storage = `do-account-v1:${owner}`;
  const [account, setAccount] = useState<Account | null>(null);
  const [state, setState] = useState<AccountState | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState(''),
    [model, setModel] = useState('openai/gpt-oss-120b');
  function save(a: Account) {
    localStorage.setItem(storage, JSON.stringify(a));
    setAccount(a);
    setName(a.device.name);
  }
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const raw = localStorage.getItem(storage);
        const info = await api<{ id: string }>('account');
        if (raw && active) {
          const a = validateAccount(JSON.parse(raw));
          if (a.id !== info.id)
            throw new Error('This device belongs to a different account.');
          setAccount(a);
          setName(a.device.name);
        }
      } catch (e) {
        if (active) setError(errorMessage(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [storage]);
  useEffect(() => {
    if (!account) return;
    let active = true,
      running = false;
    async function refresh() {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const s = await new AccountClient(account!, accountFetch).state();
        if (active) setState(s);
      } catch (e) {
        if (active) {
          setState(null);
          setError(errorMessage(e));
        }
      } finally {
        running = false;
      }
    }
    void refresh();
    const timer = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [account]);
  useEffect(() => {
    if (!account || !state?.settings || editing) return;
    let active = true;
    void new AccountClient(account, accountFetch)
      .settings(state.settings)
      .then((value) => {
        if (active) setModel(value.model);
      })
      .catch(() => {
        if (active) setError('Shared settings could not be decrypted.');
      });
    return () => {
      active = false;
    };
  }, [account, state?.settings, editing]);
  async function run(action: () => Promise<void>) {
    if (busy || disabled) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      if (account && localStorage.getItem(storage))
        setState(await new AccountClient(account, accountFetch).state());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const blocked = busy || disabled;
  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      aria-label="Account and shared settings"
    >
      <h3 className="font-semibold">Account & shared clipboard</h3>
      {!account ? (
        <>
          <p className="subtle text-sm">
            Connect this browser to your signed-in account. Approve additional
            devices through a trusted pairing.
          </p>
          <Button
            disabled={blocked}
            onClick={() =>
              void run(async () => {
                const info = await api<{ id: string; exists: boolean }>(
                  'account',
                );
                if (info.exists)
                  throw new Error(
                    'Your account already has trusted devices. Pair with one, then choose Receive account invitation.',
                  );
                const a: Account = {
                  v: 1,
                  id: info.id,
                  label: 'DO account',
                  secret: randomSecret(),
                  token: randomSecret(),
                  device: { ...device, id: crypto.randomUUID() },
                };
                // Save before bootstrap so interrupted responses can be retried with the same credentials.
                localStorage.setItem(`${storage}:pending`, JSON.stringify(a));
                await post('account', {
                  device: { ...a.device, token: a.token },
                });
                save(a);
                localStorage.removeItem(`${storage}:pending`);
                setMessage('Account connected. Add your paired devices below.');
              })
            }
          >
            Set up account sync
          </Button>
          <Button
            variant="outline"
            disabled={blocked}
            onClick={() =>
              void run(async () => {
                const raw = localStorage.getItem(`${storage}:pending`);
                if (!raw) throw new Error('No interrupted setup to resume.');
                const a = validateAccount(JSON.parse(raw));
                await post('account', {
                  device: { ...a.device, token: a.token },
                });
                save(a);
                localStorage.removeItem(`${storage}:pending`);
              })
            }
          >
            Resume interrupted setup
          </Button>
          <Button
            variant="outline"
            disabled={blocked || !pair}
            onClick={() =>
              void run(async () => {
                const a = await receiveAccountInvite(pair!);
                const info = await api<{ id: string }>('account');
                if (a.id !== info.id)
                  throw new Error(
                    'The invitation belongs to a different signed-in account.',
                  );
                await new AccountClient(a, accountFetch).state();
                save(a);
                await new SyncClient(pair!).request(
                  'account-invite-ack',
                  'POST',
                  {},
                );
                setMessage('This browser is now trusted.');
              })
            }
          >
            Receive account invitation
          </Button>
        </>
      ) : (
        <>
          <p className="subtle text-sm">
            Connected as {account.device.name}. Shared content is encrypted for
            your trusted devices.
          </p>
          <label className="field-label" htmlFor="account-name">
            Account device name
          </label>
          <div className="flex gap-2">
            <Input
              id="account-name"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              disabled={blocked}
            />
            <Button
              variant="outline"
              disabled={blocked || !name.trim()}
              onClick={() =>
                void run(async () => {
                  await new AccountClient(account, accountFetch).request(
                    'rename',
                    { name },
                  );
                  save({
                    ...account,
                    device: { ...account.device, name: name.trim() },
                  });
                  setMessage('Device name saved.');
                })
              }
            >
              Save name
            </Button>
          </div>
          <Button
            variant="outline"
            disabled={blocked || !pair || !state}
            onClick={() =>
              void run(async () => {
                await new AccountClient(account, accountFetch).invite(pair!);
                setMessage(
                  'Invitation sent. Choose Receive account invitation on the paired device within 5 minutes.',
                );
              })
            }
          >
            Add paired device to account
          </Button>
          <ul className="space-y-2">
            {state?.devices.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span>
                  {d.name}
                  {d.id === account.device.id ? ' (this browser)' : ''} ·{' '}
                  {now - d.seen < 15000 ? 'Online' : 'Offline'}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={blocked}
                  onClick={() =>
                    void run(async () => {
                      await new AccountClient(account, accountFetch).request(
                        'revoke',
                        { id: d.id },
                      );
                      if (d.id === account.device.id) {
                        localStorage.removeItem(storage);
                        setAccount(null);
                        setState(null);
                      }
                      setMessage(
                        'Device access removed. Rotate any API key that device already received. Existing direct pairings can be removed separately.',
                      );
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <h4 className="font-semibold">Latest shared clipboards</h4>
          <p className="subtle text-sm">
            New items refresh automatically here. Connected Macs sync clipboard
            changes automatically when account clipboard sync is enabled. Browsers
            require a click to share or copy clipboard contents.
          </p>
          <Button
            disabled={blocked || !state}
            onClick={() => {
              const payload = readClipboard();
              void run(async () => {
                await new AccountClient(account, accountFetch).sendClipboard(
                  await payload,
                  state!.clipboardRevision,
                );
                setMessage(
                  'Clipboard shared with your trusted devices for 2 minutes.',
                );
              });
            }}
          >
            Share this clipboard
          </Button>
          {!state?.clipboards.length && (
            <p className="subtle text-sm">
              No unexpired clipboard items. Share one from any trusted device.
            </p>
          )}
          {state?.clipboards.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span>
                {state.devices.find((d) => d.id === e.sender)?.name ?? 'Device'}{' '}
                · {new Date(e.createdAt).toLocaleTimeString()}
              </span>
              <Button
                size="sm"
                disabled={blocked}
                onClick={() =>
                  void run(async () => {
                    // Receiving can reveal either supported MIME; the explicit second Copy click retains browser activation.
                    const payload = await new AccountClient(
                      account,
                      accountFetch,
                    ).clipboard(e);
                    setPreview({ payload, expires: e.expiresAt });
                  })
                }
              >
                View
              </Button>
            </div>
          ))}
          {preview && (
            <div className="space-y-2">
              <AccountClipboardPreview payload={preview.payload} />
              <Button
                disabled={blocked || preview.expires <= now}
                onClick={() => {
                  void run(async () => {
                    await writeClipboard(
                      preview.payload.mime,
                      Promise.resolve(preview.payload),
                    );
                    setMessage('Copied. Paste into another app.');
                  });
                }}
              >
                Copy to this device
              </Button>
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Dismiss
              </Button>
            </div>
          )}
          <h4 className="font-semibold">Shared Groq connection</h4>
          <p className="subtle text-sm">
            Publish once for your trusted devices. Leave the key blank to share
            preferences only. Each device chooses whether to apply the shared
            connection.
          </p>
          <label className="field-label" htmlFor="account-model">
            Groq model
          </label>
          <Input
            id="account-model"
            value={model}
            maxLength={120}
            onChange={(e) => {
              setEditing(true);
              setModel(e.target.value);
            }}
            disabled={blocked}
          />
          <label className="field-label" htmlFor="account-groq">
            Groq API key (optional)
          </label>
          <Input
            id="account-groq"
            type="password"
            autoComplete="off"
            value={key}
            maxLength={300}
            onChange={(e) => setKey(e.target.value)}
            disabled={blocked}
          />
          <Button
            disabled={blocked || !state}
            onClick={() =>
              void run(async () => {
                const client = new AccountClient(account, accountFetch);
                const previous = state!.settings
                  ? await client.settings(state!.settings)
                  : null;
                await client.publishSettings(
                  {
                    v: 1,
                    provider: 'groq',
                    model,
                    cleanupEnabled: previous?.cleanupEnabled ?? true,
                    vocabulary: previous?.vocabulary ?? [],
                    groqKey: key.trim() || null,
                  },
                  state!.settingsRevision,
                );
                setKey('');
                setEditing(false);
                setMessage(
                  'Encrypted Groq settings published. Approved devices can apply them.',
                );
              })
            }
          >
            Publish shared connection
          </Button>
          <Button
            variant="outline"
            disabled={blocked || !state?.settings}
            onClick={() =>
              void run(async () => {
                const shared = await new AccountClient(
                  account,
                  accountFetch,
                ).settings(state!.settings!);
                if (!shared.groqKey)
                  throw new Error(
                    'Shared preferences contain no API key. Publish one from a trusted device.',
                  );
                const connection = await post<SettingsState>('settings', {
                  action: 'connect',
                  key: shared.groqKey,
                  model: shared.model,
                });
                onSettings?.(connection);
                setMessage(
                  'Web connection updated. Cloud-processing consent is still controlled in Settings.',
                );
              })
            }
          >
            Use shared connection in web app
          </Button>
          <p className="subtle text-sm">
            Using the connection in the web app sends the decrypted key to its
            existing secure credential store so it can call Groq. Account sync
            itself stores only encrypted content. Browser trust keys remain in
            this browser’s site storage.
          </p>
        </>
      )}
      {message && <output className="block text-sm">{message}</output>}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}

function AccountClipboardPreview({ payload }: { payload: Payload }) {
  const [url, setURL] = useState('');
  useEffect(() => {
    if (payload.mime !== 'image/png') return;
    const value = URL.createObjectURL(
      new Blob([payload.bytes], { type: payload.mime }),
    );
    queueMicrotask(() => setURL(value));
    return () => URL.revokeObjectURL(value);
  }, [payload]);
  return payload.mime === 'text/plain' ? (
    <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-sm">
      {new TextDecoder().decode(payload.bytes)}
    </pre>
  ) : url ? (
    <Image
      unoptimized
      width={320}
      height={192}
      src={url}
      alt="Shared clipboard"
      className="max-h-48 max-w-full object-contain"
    />
  ) : null;
}
