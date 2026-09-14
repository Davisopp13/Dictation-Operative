import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PairingClient, type PairingState } from '../lib/sync/pairing';

void test('default pairing fetch keeps the browser receiver for creation and code entry', async () => {
  const original = globalThis.fetch;
  let state: PairingState;
  const actions: string[] = [];
  // Browsers reject native fetch when a class instance is supplied as `this`.
  globalThis.fetch = async function (this: unknown, input, init) {
    assert.ok(
      this === globalThis,
      'Illegal invocation: fetch requires the browser global receiver',
    );
    assert.equal(typeof input, 'string');
    const action = (input as string).split('/').at(-1)!;
    assert.equal(typeof init?.body, 'string');
    const body = JSON.parse(init?.body as string);
    actions.push(action);
    if (action === 'create')
      state = {
        host: body.peer,
        guest: null,
        expiresAt: Date.now() + 300000,
        approved: false,
      };
    if (action === 'claim') state.guest = body.peer;
    return Response.json(state);
  };
  try {
    const host = await PairingClient.create({
      id: 'host-browser',
      name: 'Browser',
    });
    const guest = await PairingClient.claim(host.code, {
      id: 'guest-browser',
      name: 'Phone',
    });
    await host.poll();
    assert.equal(await host.verification(), await guest.verification());
    await guest.cancel();
    assert.deepEqual(actions, ['create', 'claim', 'status', 'cancel']);
  } finally {
    globalThis.fetch = original;
  }
});
