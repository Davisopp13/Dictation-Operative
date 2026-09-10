import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import 'fake-indexeddb/auto';
import * as store from '../public/recording-store.js';
import { handleAPI } from '../lib/server';
import { validateTools, emptyTools } from '../lib/workspace-tools';
import { transformText, transcribeAudio } from '../lib/provider';
import { importClip } from '../lib/backup';
import { recoverRecording, type SavedRecording } from '../lib/recordings';
import { newClip } from '../lib/domain';
void test('recording chunks survive reopened connections, preserve order and isolate owners', async () => {
  const id = crypto.randomUUID();
  await store.setAccount('alice');
  assert.equal(await store.getAccount(), 'alice');
  await store.beginRecording('alice', id, 'audio/webm', {
    clipId: 'existing-thought',
  });
  await store.appendChunk('alice', id, 1, new Blob(['second']));
  await store.appendChunk('alice', id, 0, new Blob(['first']));
  await store.appendChunk('alice', id, 0, new Blob(['duplicate']));
  await assert.rejects(store.readAudio('bob', id));
  await assert.rejects(store.deleteRecording('bob', id));
  await assert.rejects(
    store.updateRecording('bob', id, { transcript: 'attack' }),
  );
  assert.equal(((await store.listRecordings('bob')) as unknown[]).length, 0);
  assert.equal(
    await ((await store.readAudio('alice', id)) as Blob).text(),
    'firstsecond',
  );
  await store.updateRecording('alice', id, {
    state: 'ready',
    transcript: 'Transcript preserved',
  });
  const records = (await store.listRecordings('alice')) as {
    target: { clipId: string };
    transcript: string;
    bytes: number;
  }[];
  assert.equal(records[0].target.clipId, 'existing-thought');
  assert.equal(records[0].transcript, 'Transcript preserved');
  assert.equal(records[0].bytes, 11);
  await store.deleteRecording('alice', id);
  assert.equal(((await store.listRecordings('alice')) as unknown[]).length, 0);
  await assert.rejects(store.readAudio('alice', id));
});
void test('device storage enforces count and byte limits without deleting prior audio', async () => {
  const ids = Array.from({ length: 20 }, () => crypto.randomUUID());
  for (const id of ids)
    await store.beginRecording('limit', id, 'audio/webm', { kind: 'note' });
  await assert.rejects(
    store.beginRecording('limit', crypto.randomUUID(), 'audio/webm', {}),
  );
  await assert.rejects(
    store.appendChunk('limit', ids[0], 0, new Blob([new Uint8Array(20000001)])),
  );
  assert.equal(((await store.readAudio('limit', ids[0])) as Blob).size, 0);
  for (const id of ids) await store.deleteRecording('limit', id);
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
void test('vocabulary and templates reach the provider without changing source data', async () => {
  await transcribeAudio(
    'synthetic',
    new File(['audio'], 'sample.webm', { type: 'audio/webm' }),
    async (_url, init) => {
      assert.equal(
        (init!.body as FormData).get('prompt'),
        'Oppenheimer, Dictation Operative',
      );
      return Response.json({ text: 'Words' });
    },
    ['Oppenheimer', 'Dictation Operative'],
  );
  await transformText(
    'synthetic',
    'rewrite',
    'Unchanged source',
    '',
    async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      assert.match(body.messages[0].content, /Use three paragraphs/);
      assert.match(body.messages[0].content, /Oppenheimer/);
      assert.equal(
        JSON.parse(body.messages[1].content).sourceText,
        'Unchanged source',
      );
      return Response.json({
        choices: [{ message: { content: 'Result' }, finish_reason: 'stop' }],
      });
    },
    { instructions: 'Use three paragraphs.', vocabulary: ['Oppenheimer'] },
  );
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
        { db, owner, encryptionKey: '' },
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
    assert.equal(
      (
        await call(
          'transform',
          'POST',
          {
            kind: 'rewrite',
            text: 'Private',
            templateId: input.templates[0].id,
          },
          'bob',
        )
      ).status,
      404,
    );
    // Lose a library write response after the server commits, then recover from a fresh IDB read.
    const originalFetch = globalThis.fetch;
    try {
      const recordingId = crypto.randomUUID();
      await store.beginRecording('alice', recordingId, 'audio/webm', {
        clipId: clip.id,
      });
      await store.appendChunk(
        'alice',
        recordingId,
        0,
        new Blob(['synthetic audio'.repeat(20)]),
      );
      let transcriptions = 0,
        loseResponse = true;
      globalThis.fetch = async (input, init) => {
        const path = (
          input instanceof Request ? input.url : input.toString()
        ).replace('/api/', '');
        if (path === 'transcribe') {
          transcriptions++;
          return Response.json({ text: 'Recovered addition.' });
        }
        const response = await call(
          path,
          init?.method ?? 'GET',
          typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        );
        if (init?.method === 'PATCH' && loseResponse) {
          loseResponse = false;
          throw new Error('Connection lost after commit');
        }
        return response;
      };
      const first = (
        (await store.listRecordings('alice')) as SavedRecording[]
      ).find((r) => r.id === recordingId)!;
      await assert.rejects(recoverRecording(first), /offline|interrupted/);
      const persisted = (
        (await store.listRecordings('alice')) as SavedRecording[]
      ).find((r) => r.id === recordingId)!;
      assert.equal(persisted.transcript, 'Recovered addition.');
      const recovered = await recoverRecording(persisted);
      assert.equal(transcriptions, 1);
      assert.equal(
        recovered.segments.filter((s) => s.id === recordingId).length,
        1,
      );
      assert.equal(
        ((await store.listRecordings('alice')) as SavedRecording[]).some(
          (r) => r.id === recordingId,
        ),
        false,
      );
      const missingId = crypto.randomUUID();
      await store.beginRecording('alice', missingId, 'audio/webm', {
        clipId: crypto.randomUUID(),
      });
      await store.updateRecording('alice', missingId, {
        transcript: 'Keep this',
      });
      await assert.rejects(
        recoverRecording(
          ((await store.listRecordings('alice')) as SavedRecording[]).find(
            (r) => r.id === missingId,
          )!,
        ),
        /not found/,
      );
      assert.equal(
        ((await store.listRecordings('alice')) as SavedRecording[]).some(
          (r) => r.id === missingId,
        ),
        true,
      );
      await store.deleteRecording('alice', missingId);
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await mf.dispose();
  }
});
