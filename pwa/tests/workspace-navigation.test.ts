import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readWorkspaceNavigation,
  rememberWorkspacePage,
  saveStartPage,
  workspacePages,
} from '../lib/workspace-navigation';

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function browser() {
  let navigationType: string | undefined = 'navigate';
  return {
    localStorage: storage(),
    sessionStorage: storage(),
    performance: {
      getEntriesByType: () =>
        navigationType ? [{ type: navigationType }] : [],
    } as unknown as Performance,
    navigate: (type?: string) => {
      navigationType = type;
    },
  };
}

void test('Capture is the default on first visit and first reload', () => {
  const env = browser();
  for (const type of ['navigate', 'reload']) {
    env.navigate(type);
    assert.deepEqual(readWorkspaceNavigation('alice', env), {
      startPage: 'capture',
      view: 'capture',
    });
  }
});

void test('every start page opens on a fresh visit, ignoring a previous current tab', () => {
  const env = browser();
  for (const page of workspacePages) {
    saveStartPage('alice', page.value, env);
    rememberWorkspacePage(
      'alice',
      page.value === 'compose' ? 'capture' : 'compose',
      env,
    );
    assert.deepEqual(readWorkspaceNavigation('alice', env), {
      startPage: page.value,
      view: page.value,
    });
  }
});

void test('reload restores each current tab regardless of the chosen start page', () => {
  const env = browser();
  for (const start of workspacePages) {
    saveStartPage('alice', start.value, env);
    for (const current of workspacePages) {
      rememberWorkspacePage('alice', current.value, env);
      env.navigate('reload');
      assert.deepEqual(readWorkspaceNavigation('alice', env), {
        startPage: start.value,
        view: current.value,
      });
    }
  }
});

void test('changing start page does not change the current tab on refresh', () => {
  const env = browser();
  rememberWorkspacePage('alice', 'clipboard', env);
  saveStartPage('alice', 'compose', env);
  env.navigate('reload');
  assert.equal(readWorkspaceNavigation('alice', env).view, 'clipboard');
  env.navigate('navigate');
  assert.equal(readWorkspaceNavigation('alice', env).view, 'compose');
});

void test('browser tabs keep independent current pages and share the start preference', () => {
  const first = browser();
  const second = browser();
  second.localStorage = first.localStorage;
  saveStartPage('alice', 'compose', first);
  rememberWorkspacePage('alice', 'clipboard', first);
  rememberWorkspacePage('alice', 'capture', second);
  first.navigate('reload');
  second.navigate('reload');
  assert.equal(readWorkspaceNavigation('alice', first).view, 'clipboard');
  assert.equal(readWorkspaceNavigation('alice', second).view, 'capture');
  second.navigate('navigate');
  assert.equal(readWorkspaceNavigation('alice', second).view, 'compose');
});

void test('start and current pages are isolated between accounts', () => {
  const env = browser();
  saveStartPage('alice', 'compose', env);
  rememberWorkspacePage('alice', 'clipboard', env);
  for (const type of ['navigate', 'reload']) {
    env.navigate(type);
    assert.deepEqual(readWorkspaceNavigation('bob', env), {
      startPage: 'capture',
      view: 'capture',
    });
  }
});

void test('invalid storage and missing navigation timing fall back safely', () => {
  const env = browser();
  env.localStorage.setItem('do-start-page:alice', 'removed-tab');
  env.sessionStorage.setItem('do-current-page:alice', 'removed-tab');
  env.navigate('reload');
  assert.equal(readWorkspaceNavigation('alice', env).view, 'capture');
  saveStartPage('alice', 'compose', env);
  assert.equal(readWorkspaceNavigation('alice', env).view, 'compose');
  rememberWorkspacePage('alice', 'clipboard', env);
  env.navigate();
  assert.equal(readWorkspaceNavigation('alice', env).view, 'compose');
});

void test('history restoration keeps the current tab', () => {
  const env = browser();
  saveStartPage('alice', 'capture', env);
  rememberWorkspacePage('alice', 'compose', env);
  env.navigate('back_forward');
  assert.equal(readWorkspaceNavigation('alice', env).view, 'compose');
});

void test('blocked browser storage does not break navigation or silently report a saved preference', () => {
  const env = browser();
  for (const key of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(env, key, {
      get() {
        throw new Error('Storage blocked');
      },
    });
  }
  env.navigate('reload');
  assert.deepEqual(readWorkspaceNavigation('alice', env), {
    startPage: 'capture',
    view: 'capture',
  });
  assert.doesNotThrow(() => rememberWorkspacePage('alice', 'clipboard', env));
  assert.throws(
    () => saveStartPage('alice', 'compose', env),
    /Could not save your start page/,
  );
});
