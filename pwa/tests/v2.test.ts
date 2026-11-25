import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import 'fake-indexeddb/auto';
import * as store from '../lib/recording-store.js';
import { handleAPI } from '../lib/server';
import { validateTools, emptyTools } from '../lib/workspace-tools';
import { importClip } from '../lib/backup';
import {
  audioFileName,
  saveTranscript,
  type SavedRecording,
} from '../lib/recordings';
import { newClip, type Clip } from '../lib/domain';

// Writes a recording the way the retired recorder stored it, using the same
// database name, version and object stores.
function seedRecording(
  recording: Omit<SavedRecording, 'bytes'>,
  chunks: string[],
) {
  return new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('do-recordings-v2', 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('recordings', { keyPath: 'id' });
      open.result.createObjectStore('chunks', { keyPath: ['id', 'index'] });
      open.result.createObjectStore('session');
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['recordings', 'chunks'], 'readwrite');
      tx.objectStore('recordings').put({
        ...recording,
        bytes: chunks.reduce((n, c) => n + c.length, 0),
      });
      // Stored out of order on purpose: reads must sort by chunk index.
      chunks
        .map((text, index) => ({ id: recording.id, index, blob: new Blob([text]) }))
        .reverse()
        .forEach((chunk) => tx.objectStore('chunks').put(chunk));
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}
const recording = (
  account: string,
  transcript: string | null,
  mime = 'audio/webm',
): Omit<SavedRecording, 'bytes'> => ({
  id: crypto.randomUUID(),
  account,
  mime,
  target: { kind: 'note' },
  createdAt: Date.now(),
  state: 'ready',
  transcript,
});

void test('recordings left by the retired recorder stay readable, ordered and isolated by account', async () => {
  const mine = recording('alice', 'Transcript preserved');
  await seedRecording(mine, ['first', 'second']);
  await assert.rejects(store.readAudio('bob', mine.id));
  await assert.rejects(store.deleteRecording('bob', mine.id));
  assert.equal(((await store.listRecordings('bob')) as unknown[]).length, 0);
  const listed = (await store.listRecordings('alice')) as SavedRecording[];
  assert.equal(listed.length, 1);
  assert.equal(listed[0].transcript, 'Transcript preserved');
  assert.equal(listed[0].bytes, 11);
  const audio = (await store.readAudio('alice', mine.id)) as Blob;
  assert.equal(await audio.text(), 'firstsecond');
  assert.equal(audio.type, 'audio/webm');
  assert.equal(audioFileName(listed[0]), `recording-${mine.id}.webm`);
  assert.equal(audioFileName({ id: 'x', mime: 'audio/mp4' }), 'recording-x.m4a');
  await store.deleteRecording('alice', mine.id);
  assert.equal(((await store.listRecordings('alice')) as unknown[]).length, 0);
  await assert.rejects(store.readAudio('alice', mine.id));
});
void test('the recording store no longer offers any way to create or change recordings', () => {
  assert.deepEqual(Object.keys(store).sort(), [
    'RECORDING_DB',
    'deleteRecording',
    'listRecordings',
    'readAudio',
  ]);
  assert.equal(store.RECORDING_DB, 'do-recordings-v2');
});
void test('workspace validators bound preferences and metadata survives backup', () => {
  assert.throws(() =>
    validateTools({ ...emptyTools, collections: ['Work', 'work'] }),
  );
  assert.throws(() =>
    validateTools({ ...emptyTools, vocabulary: ['x'.repeat(81)] }),
  );
  assert.throws(() =>
    validateTools({
      ...emptyTools,
      templates: [{ id: 'bad', name: 'a', instructions: 'b' }],
    }),
  );
  const clip = newClip({
    id: crypto.randomUUID(),
    content: 'Original',
    collection: 'Project',
    tags: ['Ideas', 'ideas', 'Next'],
  });
  assert.deepEqual(importClip(clip).tags, ['ideas', 'next']);
  assert.equal(importClip(clip).collection, 'Project');
});
void test('V2 D1 migration, owner isolation, filters and concurrent preference saves', async () => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-05-22',
    d1Databases: ['DB'],
  });
  try {
    const db = await mf.getD1Database('DB');
    for (const file of readdirSync(new URL('../drizzle/', import.meta.url))
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      for (const sql of readFileSync(
        new URL('../drizzle/' + file, import.meta.url),
        'utf8',
      ).split('--> statement-breakpoint'))
        if (sql.trim()) await db.prepare(sql.trim()).run();
    }
    const call = (
      path: string,
      method = 'GET',
      data?: unknown,
      owner = 'alice',
    ) =>
      handleAPI(
        new Request('https://do.test/api/' + path, {
          method,
          headers: {
            Origin: 'https://do.test',
            'Content-Type': 'application/json',
          },
          ...(data ? { body: JSON.stringify(data) } : {}),
        }),
        { db, owner },
      );
    const input = {
      ...emptyTools,
      collections: ['Work'],
      vocabulary: ['Oppenheimer'],
      templates: [
        {
          id: crypto.randomUUID(),
          name: 'Brief',
          instructions: 'Make a brief.',
        },
      ],
    };
    const results = await Promise.all([
      call('workspace-tools', 'PUT', input),
      call('workspace-tools', 'PUT', input),
    ]);
    assert.deepEqual(
      results.map((r) => r.status).sort((a, b) => a - b),
      [200, 409],
    );
    const saved = (await (
      await call('workspace-tools')
    ).json()) as typeof input;
    assert.equal(saved.revision, 2);
    assert.equal(
      (
        await call('workspace-tools', 'PUT', {
          ...saved,
          collections: ['Project'],
        })
      ).status,
      200,
    );
    assert.equal((await call('workspace-tools', 'PUT', saved)).status, 409);
    const bob = (await (
      await call('workspace-tools', 'GET', undefined, 'bob')
    ).json()) as typeof input;
    assert.deepEqual(bob.templates, []);
    const r = await call('clips', 'POST', {
      id: crypto.randomUUID(),
      content: 'Original',
      collection: 'Project',
      tags: ['Ideas', 'ideas'],
    });
    const clip = (await r.json()) as ReturnType<typeof newClip>;
    assert.deepEqual(clip.tags, ['ideas']);
    assert.equal(
      (
        (await (await call('library?collection=Project&tag=ideas')).json()) as {
          items: unknown[];
        }
      ).items.length,
      1,
    );
    assert.equal(
      (
        (await (await call('library?tag=missing')).json()) as {
          items: unknown[];
        }
      ).items.length,
      0,
    );
    assert.deepEqual(
      await (await call('organization', 'GET', undefined, 'bob')).json(),
      { collections: [], tags: [] },
    );
    const edited = (await (
      await call('clips/' + clip.id, 'PATCH', {
        revision: 1,
        action: 'organize',
        collection: 'Personal',
        tags: ['Home'],
      })
    ).json()) as typeof clip;
    assert.equal(edited.versions.length, 1);
    assert.equal(edited.original, 'Original');
    assert.deepEqual(edited.tags, ['home']);
    assert.equal(
      (
        await call('clips/' + clip.id, 'PATCH', {
          revision: 1,
          action: 'organize',
          collection: 'Stale',
          tags: [],
        })
      ).status,
      409,
    );
    // A cached transcript is saved as ordinary Clipboard text. The local
    // record stays, and saving again never creates a second copy.
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (input, init) =>
        call(
          (input instanceof Request ? input.url : input.toString()).replace(
            '/api/',
            '',
          ),
          init?.method ?? 'GET',
          typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        );
      const withTranscript = recording('alice', 'Words from an old recording.');
      await seedRecording(withTranscript, ['synthetic audio']);
      const stored = ((await store.listRecordings('alice')) as SavedRecording[]).find(
        (r) => r.id === withTranscript.id,
      )!;
      const saved = await saveTranscript(stored);
      assert.equal(saved.id, withTranscript.id);
      assert.equal(saved.content, 'Words from an old recording.');
      assert.equal(saved.kind, 'note');
      assert.equal((await saveTranscript(stored)).revision, saved.revision);
      const library = (await (await call('library?q=old+recording')).json()) as {
        items: Clip[];
      };
      assert.equal(library.items.length, 1);
      // Saved as history, not as a Clipboard item, so daily cleanup never removes it.
      assert.equal(
        (
          await db
            .prepare('SELECT clipboard_item FROM clips WHERE id=?')
            .bind(saved.id)
            .first<{ clipboard_item: number }>()
        )?.clipboard_item,
        0,
      );
      const kept = ((await store.listRecordings('alice')) as SavedRecording[]).find(
        (r) => r.id === withTranscript.id,
      );
      assert.equal(kept?.transcript, 'Words from an old recording.');
      assert.equal(
        await ((await store.readAudio('alice', withTranscript.id)) as Blob).text(),
        'synthetic audio',
      );
      const audioOnly = recording('alice', null);
      await seedRecording(audioOnly, ['audio']);
      await assert.rejects(
        saveTranscript(
          ((await store.listRecordings('alice')) as SavedRecording[]).find(
            (r) => r.id === audioOnly.id,
          )!,
        ),
        /no saved transcript/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await mf.dispose();
  }
});
