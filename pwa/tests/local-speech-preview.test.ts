import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalSpeechPreview,
  type Recognition,
} from '../lib/local-speech-preview';

function harness() {
  const pending: Array<{
    resolve: (status: string) => void;
    reject: (error: Error) => void;
  }> = [];
  const engines: FakeRecognition[] = [];
  const results: string[][] = [];
  let recording = true;
  class FakeRecognition implements Recognition {
    continuous = false;
    interimResults = false;
    lang = '';
    processLocally = false;
    running = false;
    aborted = false;
    onresult: Recognition['onresult'] = null;
    onerror: Recognition['onerror'] = null;
    onend: Recognition['onend'] = null;
    static available(options: { langs: string[]; processLocally: boolean }) {
      assert.deepEqual(options, { langs: ['en-US'], processLocally: true });
      return new Promise<string>((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
    }
    constructor() {
      engines.push(this);
    }
    start() {
      assert.equal(this.processLocally, true);
      this.running = true;
    }
    abort() {
      this.running = false;
      this.aborted = true;
    }
  }
  const preview = new LocalSpeechPreview();
  return {
    preview,
    pending,
    engines,
    results,
    FakeRecognition,
    endRecording: () => {
      recording = false;
    },
    start: () =>
      preview.start(
        FakeRecognition,
        'en-US',
        () => recording,
        (settled, tail) => results.push([settled, tail]),
      ),
  };
}

for (const order of ['old-first', 'new-first'] as const) {
  void test(`stale availability cannot start a recognizer in another recording (${order})`, async () => {
    const h = harness();
    const first = h.start();
    h.preview.stop();
    const second = h.start();
    if (order === 'old-first') {
      h.pending[0].resolve('available');
      await first;
      assert.equal(h.engines.length, 0);
      h.pending[1].resolve('available');
      await second;
    } else {
      h.pending[1].resolve('available');
      await second;
      h.pending[0].resolve('available');
      await first;
    }
    assert.equal(h.engines.length, 1);
    assert.equal(h.engines[0].running, true);
    h.preview.stop();
    assert.equal(h.engines.filter((engine) => engine.running).length, 0);
  });
}

void test('stop/unmount invalidates pending availability before an engine exists', async () => {
  const h = harness();
  const start = h.start();
  h.preview.stop();
  h.pending[0].resolve('available');
  await start;
  assert.equal(h.engines.length, 0);
});

void test('an ended recording cannot start preview even before cleanup runs', async () => {
  const h = harness();
  const start = h.start();
  h.endRecording();
  h.pending[0].resolve('available');
  await start;
  assert.equal(h.engines.length, 0);
});

void test('missing, unavailable, and failed local checks never construct a recognizer', async () => {
  const h = harness();
  await h.preview.start(
    undefined,
    'en-US',
    () => true,
    () => {},
  );
  class WithoutAvailability {
    constructor() {
      assert.fail('remote-only recognizer must not be constructed');
    }
  }
  await h.preview.start(
    WithoutAvailability as unknown as typeof h.FakeRecognition,
    'en-US',
    () => true,
    () => {},
  );
  for (const status of [
    'unavailable',
    'downloadable',
    'downloading',
    'unknown',
  ]) {
    const start = h.start();
    h.pending.at(-1)!.resolve(status);
    await start;
  }
  const failed = h.start();
  h.pending.at(-1)!.reject(new Error('availability failed'));
  await failed;
  assert.equal(h.engines.length, 0);
});

void test('a stale availability rejection does not abort a newer preview', async () => {
  const h = harness();
  const first = h.start();
  h.preview.stop();
  const second = h.start();
  h.pending[1].resolve('available');
  await second;
  h.pending[0].reject(new Error('old request failed'));
  await first;
  assert.equal(h.engines[0].running, true);
  h.preview.stop();
  assert.equal(h.engines[0].running, false);
});

void test('replacement aborts the old engine and ignores its queued results', async () => {
  const h = harness();
  const first = h.start();
  h.pending[0].resolve('available');
  await first;
  const queuedResult = h.engines[0].onresult!;
  queuedResult({
    resultIndex: 0,
    results: [
      { 0: { transcript: 'Settled ' }, isFinal: true },
      { 0: { transcript: 'pending' }, isFinal: false },
    ],
  });
  assert.deepEqual(h.results, [['Settled ', 'pending']]);
  const second = h.start();
  assert.equal(h.engines[0].aborted, true);
  assert.equal(h.engines[0].onresult, null);
  queuedResult({
    resultIndex: 0,
    results: [{ 0: { transcript: 'stale' }, isFinal: true }],
  });
  assert.equal(h.results.length, 1);
  h.pending[1].resolve('available');
  await second;
  h.preview.stop();
  assert.equal(
    h.engines.every((engine) => !engine.running),
    true,
  );
});

void test('a recognizer that throws during startup is aborted', async () => {
  const h = harness();
  class BrokenRecognition extends h.FakeRecognition {
    start() {
      super.start();
      throw new Error('start failed');
    }
  }
  const start = h.preview.start(
    BrokenRecognition,
    'en-US',
    () => true,
    () => {},
  );
  h.pending[0].resolve('available');
  await start;
  assert.equal(h.engines[0].aborted, true);
  assert.equal(h.engines[0].running, false);
});
