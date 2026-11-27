'use client';
import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { post, errorMessage } from '@/lib/client';
import type { Clip } from '@/lib/domain';

/** The white "Add text" card inside the blue add panel. */
export function ClipboardText({
  locked,
  onSaved,
  onDirtyChange,
  initialText = '',
  onSavingChange,
}: {
  locked: boolean;
  onSaved: (id: string) => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  initialText?: string;
  onSavingChange?: (saving: boolean) => void;
}) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef({ id: '', content: '' });
  const saving = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!text) return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [text]);
  useEffect(() => {
    onDirtyChange?.(!!text);
  }, [text, onDirtyChange]);
  async function paste() {
    setError('');
    try {
      const value = await navigator.clipboard.readText();
      if (value.length > 20000)
        throw new RangeError(
          'Clipboard text is too long. Paste a smaller selection (up to 20,000 characters).',
        );
      if (!value) throw new RangeError('Your clipboard has no text to paste.');
      setText(value);
      setPasted(true);
    } catch (e) {
      setError(
        e instanceof RangeError
          ? e.message
          : 'Paste directly into the text box using your keyboard or touch menu.',
      );
    }
  }
  async function save() {
    if (saving.current || locked || !text.trim()) return;
    saving.current = true;
    setBusy(true);
    onSavingChange?.(true);
    setError('');
    if (attempt.current.content !== text || !attempt.current.id)
      attempt.current = { id: crypto.randomUUID(), content: text };
    try {
      const saved = await post<Clip>('clips', {
        id: attempt.current.id,
        content: text,
        kind: 'note',
        pinned: false,
        clipboardItem: true,
      });
      setText('');
      setPasted(false);
      attempt.current = { id: '', content: '' };
      await onSaved(saved.id);
      requestAnimationFrame(() => field.current?.focus());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      saving.current = false;
      setBusy(false);
      onSavingChange?.(false);
    }
  }
  return (
    <form
      className="add-text-card"
      aria-label="Add text to Clipboard"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="add-text-head">
        <label htmlFor="clipboard-text">Add text</label>
        {pasted && text && <span className="badge-mint">Pasted</span>}
      </div>
      <textarea
        ref={field}
        id="clipboard-text"
        placeholder="Paste or type text here"
        value={text}
        maxLength={20000}
        rows={5}
        disabled={locked}
        readOnly={busy}
        onChange={(event) => {
          setText(event.target.value);
          setPasted(false);
        }}
      />
      <div className="add-text-actions">
        <button
          type="button"
          className="button-secondary"
          onClick={() => void paste()}
          disabled={locked || busy}
        >
          <ClipboardPaste aria-hidden="true" /> Paste from clipboard
        </button>
        <button
          type="submit"
          className="button-primary"
          disabled={locked || busy || !text.trim()}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && (
        <p role="alert" className="add-text-error">
          {error}
        </p>
      )}
    </form>
  );
}
