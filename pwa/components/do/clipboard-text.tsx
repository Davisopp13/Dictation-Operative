'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { post, errorMessage } from '@/lib/client';
import type { Clip } from '@/lib/domain';

export function ClipboardText({
  locked,
  onSaved,
}: {
  locked: boolean;
  onSaved: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const attempt = useRef({ id: '', content: '' });
  const saving = useRef(false);
  useEffect(() => {
    if (!text) return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [text]);
  async function paste() {
    setError('');
    setNotice('');
    try {
      const value = await navigator.clipboard.readText();
      if (value.length > 20000)
        throw new RangeError(
          'Clipboard text is too long. Paste a smaller selection (up to 20,000 characters).',
        );
      if (!value) throw new RangeError('Your clipboard has no text to paste.');
      setText(value);
    } catch (e) {
      setError(
        e instanceof RangeError
          ? e.message
          : 'Paste directly into the text field using your keyboard or touch menu.',
      );
    }
  }
  async function save() {
    if (saving.current || locked || !text.trim()) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    if (attempt.current.content !== text || !attempt.current.id)
      attempt.current = { id: crypto.randomUUID(), content: text };
    try {
      await post<Clip>('clips', {
        id: attempt.current.id,
        content: text,
        kind: 'note',
        pinned: false,
        clipboardItem: true,
      });
      setText('');
      attempt.current = { id: '', content: '' };
      setNotice(
        'Saved to your shared Clipboard. It will appear on your other signed-in devices.',
      );
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="space-y-3 rounded-xl border p-4"
      aria-label="Add text to Clipboard"
    >
      <label htmlFor="clipboard-text" className="font-semibold">
        Add text
      </label>
      <Textarea
        id="clipboard-text"
        placeholder="Paste or type text here…"
        value={text}
        maxLength={20000}
        rows={4}
        disabled={locked || busy}
        onChange={(event) => {
          setText(event.target.value);
          setNotice('');
        }}
      />
      <p className="subtle text-sm">
        Paste with Ctrl+V on Windows or ⌘V on Mac, then save.
      </p>
      <div className="actions m-0">
        <Button
          onClick={() => void save()}
          disabled={locked || busy || !text.trim()}
        >
          {busy ? 'Saving…' : 'Save to Clipboard'}
        </Button>
        <Button
          variant="outline"
          onClick={() => void paste()}
          disabled={locked || busy}
        >
          Paste from clipboard
        </Button>
      </div>
      {notice && <output className="block text-sm">{notice}</output>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
