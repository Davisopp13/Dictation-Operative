// Device-local unfinished audio only. No credentials or permanent audio history.
export const RECORDING_DB = 'do-recordings-v2';
function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(RECORDING_DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('recordings', { keyPath: 'id' });
      db.createObjectStore('chunks', { keyPath: ['id', 'index'] });
      db.createObjectStore('session');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function transaction(stores, mode, run) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('Local recording storage failed.'));
    };
    try {
      run(tx, (v) => {
        result = v;
      });
    } catch (e) {
      tx.abort();
      reject(e);
    }
  });
}
export const setAccount = (account) =>
  transaction(['session'], 'readwrite', (tx) =>
    tx.objectStore('session').put(account, 'account'),
  );
export const getAccount = () =>
  transaction(['session'], 'readonly', (tx, done) => {
    tx.objectStore('session').get('account').onsuccess = (e) =>
      done(e.target.result);
  });
export const listRecordings = (account) =>
  transaction(['recordings'], 'readonly', (tx, done) => {
    tx.objectStore('recordings').getAll().onsuccess = (e) =>
      done(
        e.target.result
          .filter((r) => r.account === account)
          .sort((a, b) => b.createdAt - a.createdAt),
      );
  });
export function beginRecording(account, id, mime, target) {
  return transaction(['recordings'], 'readwrite', (tx) => {
    const store = tx.objectStore('recordings');
    store.getAll().onsuccess = (e) => {
      const all = e.target.result;
      if (all.length >= 20 || all.reduce((n, r) => n + r.bytes, 0) > 80000000) {
        tx.abort();
        return;
      }
      store.add({
        account,
        id,
        mime,
        target,
        createdAt: Date.now(),
        bytes: 0,
        state: 'recording',
        transcript: null,
      });
    };
  });
}
export function appendChunk(account, id, index, blob) {
  return transaction(['recordings', 'chunks'], 'readwrite', (tx) => {
    const store = tx.objectStore('recordings');
    store.get(id).onsuccess = (e) => {
      const r = e.target.result;
      if (!r || r.account !== account) {
        tx.abort();
        return;
      }
      const chunks = tx.objectStore('chunks');
      chunks.get([id, index]).onsuccess = (e) => {
        if (e.target.result) return;
        if (r.bytes + blob.size > 20000000) {
          tx.abort();
          return;
        }
        chunks.add({ id, index, blob });
        store.put({ ...r, bytes: r.bytes + blob.size });
      };
    };
  });
}
export function updateRecording(account, id, change) {
  return transaction(['recordings'], 'readwrite', (tx) => {
    const store = tx.objectStore('recordings');
    store.get(id).onsuccess = (e) => {
      const r = e.target.result;
      if (!r || r.account !== account) {
        tx.abort();
        return;
      }
      store.put({
        ...r,
        state: change.state ?? r.state,
        transcript: change.transcript ?? r.transcript,
      });
    };
  });
}
export function readAudio(account, id) {
  return transaction(['recordings', 'chunks'], 'readonly', (tx, done) => {
    tx.objectStore('recordings').get(id).onsuccess = (e) => {
      const r = e.target.result;
      if (!r || r.account !== account) {
        tx.abort();
        return;
      }
      tx
        .objectStore('chunks')
        .getAll(
          IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]),
        ).onsuccess = (e) =>
        done(
          new Blob(
            e.target.result.map((c) => c.blob),
            { type: r.mime },
          ),
        );
    };
  });
}
export function deleteRecording(account, id) {
  return transaction(['recordings', 'chunks'], 'readwrite', (tx) => {
    const store = tx.objectStore('recordings');
    store.get(id).onsuccess = (e) => {
      if (e.target.result?.account !== account) {
        tx.abort();
        return;
      }
      store.delete(id);
      tx.objectStore('chunks').delete(
        IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]),
      );
    };
  });
}
