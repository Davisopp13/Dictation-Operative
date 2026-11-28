import { installTestReleaseFence } from './release-fence-fixture.mjs';
import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = 'dist/server',
  origin = 'http://localhost';
const mf = new Miniflare({
  modulesRoot: root,
  modules: [
    'index.js',
    ...readdirSync(root, { recursive: true }).filter(
      (f) => f.endsWith('.js') && f !== 'index.js',
    ),
  ].map((file) => ({ type: 'ESModule', path: root + '/' + file })),
  compatibilityDate: '2026-05-22',
  compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  r2Buckets: ['IMAGES'],
  bindings: { WORKSPACE_WRITE_FENCE: 'on',
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: 'synthetic-built-shared-secret-32-characters',
  },
});
try {
  let db = await mf.getD1Database('DB');
  for (const file of readdirSync('drizzle')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    for (const sql of readFileSync('drizzle/' + file, 'utf8').split(
      '--> statement-breakpoint',
    ))
      if (sql.trim()) await db.prepare(sql.trim()).run();
  db = await installTestReleaseFence(db);
  async function signup(username) {
    const response = await mf.dispatchFetch(
      origin + '/api/auth/sign-up/email',
      {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          email: `${username}@example.test`,
          name: username,
          password: 'synthetic-shared-password',
        }),
      },
    );
    assert.equal(response.status, 200, await response.clone().text());
    const data = await response.json();
    return {
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
      owner: data.user.id,
    };
  }
  const alice = await signup('builtsharedalice'),
    bob = await signup('builtsharedbob');
  const request = (path, method = 'GET', body, cookie = alice.cookie) =>
    mf.dispatchFetch(origin + '/api/' + path, {
      method,
      headers: {
        Origin: origin,
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const get = async (path, method = 'GET', body) => {
    const response = await request(path, method, body);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const create = async () => {
    const r = await request('v1/text', 'POST', {
      id: crypto.randomUUID(),
      content: 'Synthetic shared item',
    });
    assert.equal(r.status, 201);
    return r.json();
  };
  const kept = await create(),
    loose = await create();
  await db.prepare('UPDATE clips SET created_at=0').run();
  const createInput = { operationId: crypto.randomUUID(), name: 'Errands' };
  const createdResponse = await request('v1/piles', 'POST', createInput);
  assert.equal(
    createdResponse.status,
    201,
    await createdResponse.clone().text(),
  );
  const created = await createdResponse.json(),
    pileId = created.pile.id;
  const creationRetry = await get('v1/piles', 'POST', createInput);
  assert.equal(creationRetry.pile.id, pileId);
  assert.equal(creationRetry.replayed, true);
  const input = {
    operationId: crypto.randomUUID(),
    revision: 1,
    action: 'add',
    ref: { kind: 'text', id: kept.id },
  };
  const added = await get(`v1/piles/${pileId}/members`, 'POST', input);
  assert.equal(added.item.cleanup.reason, 'pile');
  assert.equal(
    (await request(`v1/piles/${pileId}/members`, 'GET', undefined, bob.cookie))
      .status,
    404,
  );
  assert.equal(
    (await request('v1/items/text/' + kept.id, 'GET', undefined, bob.cookie))
      .status,
    404,
  );
  assert.equal((await get('v1/piles')).piles.length, 1);
  assert.equal((await get(`v1/piles/${pileId}`)).pile.memberCount, 1);
  const renamed = await get(`v1/piles/${pileId}`, 'PATCH', {
    operationId: crypto.randomUUID(),
    revision: 2,
    name: 'Saturday errands',
    color: 'mint',
  });
  assert.equal(renamed.pile.revision, 3);
  const page = await get('v1/items?limit=1');
  assert.ok(page.nextCursor);
  await get('settings', 'POST', { action: 'clipboard-cleanup', enabled: true });
  await (
    await mf.getWorker()
  ).scheduled({ scheduledTime: Date.now(), cron: '0 8 * * *' });
  assert.equal((await request('v1/text/' + loose.id)).status, 404);
  assert.equal((await request('v1/text/' + kept.id)).status, 200);
  assert.equal(
    (await request('v1/items?cursor=' + page.nextCursor)).status,
    409,
  );
  assert.equal((await get(`v1/piles/${pileId}/members`)).members.length, 1);
  const replay = await get(`v1/piles/${pileId}/members`, 'POST', input);
  assert.equal(replay.replayed, true);
  const removed = await get(`v1/piles/${pileId}/members`, 'POST', {
    ...input,
    operationId: crypto.randomUUID(),
    revision: 3,
    action: 'removeAndPin',
  });
  assert.equal(removed.item.cleanup.reason, 'pinned');
  await (
    await mf.getWorker()
  ).scheduled({ scheduledTime: Date.now(), cron: '0 8 * * *' });
  assert.equal((await request('v1/text/' + kept.id)).status, 200);
  // Legacy source mutation still observes text CAS, and deletion clears retained Undo slots.
  assert.equal(
    (
      await request('clips/' + kept.id, 'PATCH', {
        action: 'edit',
        revision: 1,
        content: 'stale',
      })
    ).status,
    409,
  );
  const current = await get('clips/' + kept.id);
  assert.equal(
    (
      await request('clips/' + kept.id, 'DELETE', {
        revision: current.revision,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await db
        .prepare('SELECT COUNT(*) AS n FROM pile_members WHERE item_id=?')
        .bind(kept.id)
        .first()
    ).n,
    0,
  );
  const linkResponse = await request('content', 'POST', {
    kind: 'link',
    name: 'Synthetic Google shortcut',
    url: 'https://docs.google.com/document/d/synthetic/edit',
  });
  assert.equal(linkResponse.status, 201);
  const link = await linkResponse.json();
  const addLink = await get(`v1/piles/${pileId}/members`, 'POST', {
    operationId: crypto.randomUUID(),
    revision: (await get(`v1/piles/${pileId}/members`)).pile.revision,
    action: 'add',
    ref: { kind: 'document', id: link.id },
  });
  assert.equal(addLink.item.cleanup.reason, 'pile');
  assert.equal((await request('content/' + link.id, 'DELETE')).status, 200);
  assert.equal((await get(`v1/piles/${pileId}/members`)).members.length, 0);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const uploaded = await mf.dispatchFetch(origin + '/api/images', {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: alice.cookie,
      'Content-Type': 'image/png',
    },
    body: png,
  });
  assert.equal(uploaded.status, 201);
  const image = await uploaded.json();
  await get(`v1/piles/${pileId}/members`, 'POST', {
    operationId: crypto.randomUUID(),
    revision: (await get(`v1/piles/${pileId}/members`)).pile.revision,
    action: 'add',
    ref: { kind: 'image', id: image.id },
  });
  assert.equal((await request('images/' + image.id, 'DELETE')).status, 200);
  assert.equal((await get(`v1/piles/${pileId}/members`)).members.length, 0);
  // Mixed initial selection, confirmation invalidation, both deletion choices,
  // historical receipts, real bytes/quota preservation and complete erasure.
  const source = await create();
  const imageResponse = await mf.dispatchFetch(origin + '/api/images', {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: alice.cookie,
      'Content-Type': 'image/png',
    },
    body: png,
  });
  assert.equal(imageResponse.status, 201);
  const retainedImage = await imageResponse.json();
  const shortcutResponse = await request('v1/documents', 'POST', {
    kind: 'link',
    name: 'Shopping list',
    url: 'https://docs.google.com/spreadsheets/d/synthetic/edit',
  });
  assert.equal(shortcutResponse.status, 201);
  const shortcut = await shortcutResponse.json();
  const refs = [
    { kind: 'image', id: retainedImage.id },
    { kind: 'text', id: source.id },
    { kind: 'document', id: shortcut.id },
  ];
  const mixedInput = {
    operationId: crypto.randomUUID(),
    name: 'Mixed',
    members: refs,
  };
  const mixedResponse = await request('v1/piles', 'POST', mixedInput);
  assert.equal(mixedResponse.status, 201);
  const mixed = (await mixedResponse.json()).pile;
  assert.deepEqual(
    (await get(`v1/piles/${mixed.id}/members`)).members.map((m) => m.ref),
    refs,
  );
  const budgetBefore = await get('v1/documents');
  const impact = await get(`v1/piles/${mixed.id}/deletion-impact`);
  assert.equal(impact.exposed.length, 2);
  const deletion = {
    operationId: crypto.randomUUID(),
    revision: impact.pile.revision,
    impactToken: impact.impactToken,
    mode: 'pin',
  };
  // Another device changes cleanup settings without changing this pile's revision.
  await get('settings', 'POST', {
    action: 'clipboard-cleanup',
    enabled: false,
  });
  const stale = await request(`v1/piles/${mixed.id}`, 'DELETE', deletion);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'impact_stale');
  await get('settings', 'POST', { action: 'clipboard-cleanup', enabled: true });
  const fresh = await get(`v1/piles/${mixed.id}/deletion-impact`);
  const confirmed = {
    ...deletion,
    operationId: crypto.randomUUID(),
    impactToken: fresh.impactToken,
  };
  const deleted = await get(`v1/piles/${mixed.id}`, 'DELETE', confirmed);
  assert.equal(deleted.pinned.length, 2);
  assert.equal(
    (await get(`v1/piles/${mixed.id}`, 'DELETE', confirmed)).replayed,
    true,
  );
  assert.equal((await get('v1/piles', 'POST', mixedInput)).replayed, true);
  assert.equal((await request(`v1/piles/${mixed.id}`)).status, 404);
  assert.equal((await get('v1/documents')).usedBytes, budgetBefore.usedBytes);
  const bytes = await request('v1/images/' + retainedImage.id + '/file');
  assert.equal(bytes.status, 200);
  assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), png);
  await (
    await mf.getWorker()
  ).scheduled({ scheduledTime: Date.now(), cron: '0 8 * * *' });
  assert.equal((await request('v1/text/' + source.id)).status, 200);
  const exposed = await create();
  await db
    .prepare('UPDATE clips SET created_at=0 WHERE id=?')
    .bind(exposed.id)
    .run();
  const exposureResponse = await request('v1/piles', 'POST', {
    operationId: crypto.randomUUID(),
    name: 'Expose',
    members: [{ kind: 'text', id: exposed.id }],
  });
  assert.equal(exposureResponse.status, 201);
  const exposurePile = (await exposureResponse.json()).pile.id;
  const exposureImpact = await get(`v1/piles/${exposurePile}/deletion-impact`);
  const expose = {
    operationId: crypto.randomUUID(),
    revision: exposureImpact.pile.revision,
    impactToken: exposureImpact.impactToken,
    mode: 'expose',
  };
  assert.equal(
    (await request(`v1/piles/${exposurePile}`, 'DELETE', expose)).status,
    400,
  );
  await get(`v1/piles/${exposurePile}`, 'DELETE', {
    ...expose,
    acknowledgeExposure: true,
  });
  assert.equal((await request('v1/text/' + exposed.id)).status, 200);
  await (
    await mf.getWorker()
  ).scheduled({ scheduledTime: Date.now(), cron: '0 8 * * *' });
  assert.equal((await request('v1/items/text/' + exposed.id)).status, 410);
  // P2 transition hold, bounded backfill, compatibility, provenance and Undo
  // through the built router and scheduler, with real session authentication.
  await db.prepare("INSERT INTO clips(id,owner,title,kind,content,original,segments,versions,collection,clipboard_item,created_at,updated_at) VALUES ('built-legacy-p2',?,'Legacy','note','body','original','[]','[]','Built collection',1,0,0)").bind(alice.owner).run();
  const pending=await get('v1/collection-backfill'); assert.equal(pending.pending,1);
  assert.equal((await get('v1/items/text/built-legacy-p2')).cleanup.reason,'collection_pending');
  await (await mf.getWorker()).scheduled({scheduledTime:Date.now(),cron:'0 8 * * *'});
  assert.equal((await request('clips/built-legacy-p2')).status,200);
  const denied=await mf.dispatchFetch(origin+'/api/v1/collection-backfill',{method:'POST',headers:{Cookie:alice.cookie,'Content-Type':'application/json'},body:'{}'}); assert.equal(denied.status,403);
  const foreign=await request('v1/collection-backfill','GET',undefined,bob.cookie); assert.equal((await foreign.json()).pending,0);
  const progressed=await get('v1/collection-backfill','POST',{limit:1}); assert.equal(progressed.processed,1); assert.equal(progressed.complete,true);
  assert.equal((await get('v1/collection-backfill','POST',{})).processed,0);
  const mappedItem=await get('v1/items/text/built-legacy-p2'), mappedPile=mappedItem.piles[0].id;
  const addManual=await get(`v1/piles/${mappedPile}/members`,'POST',{operationId:crypto.randomUUID(),revision:(await get(`v1/piles/${mappedPile}`)).pile.revision,ref:{kind:'text',id:'built-legacy-p2'},action:'add'}); assert.equal(addManual.changed,true);
  const removedMapped=await get(`v1/piles/${mappedPile}/members`,'POST',{operationId:crypto.randomUUID(),revision:addManual.pileRevision,ref:{kind:'text',id:'built-legacy-p2'},action:'removeAndPin'});
  assert.equal((await get('clips/built-legacy-p2')).collection,'');
  const restoredMapped=await get(`v1/piles/${mappedPile}/members`,'POST',{operationId:crypto.randomUUID(),revision:removedMapped.pileRevision,ref:{kind:'text',id:'built-legacy-p2'},action:'restore',undoOperationId:removedMapped.operationId});
  assert.equal(restoredMapped.item.pinned,true); assert.equal((await get('clips/built-legacy-p2')).collection,'Built collection');
  const mappedImpact=await get(`v1/piles/${mappedPile}/deletion-impact`);
  await get(`v1/piles/${mappedPile}`,'DELETE',{operationId:crypto.randomUUID(),revision:mappedImpact.pile.revision,impactToken:mappedImpact.impactToken,mode:'pin'});
  const legacyCurrent=await get('clips/built-legacy-p2');
  await get('clips/built-legacy-p2','PATCH',{action:'rename',title:'Unrelated',revision:legacyCurrent.revision});
  assert.equal((await get('v1/collection-backfill','POST',{})).suppressedKeys,1);
  assert.equal((await get('v1/items/text/built-legacy-p2')).piles.length,0);
  // B1: the actual sequential restore protocol crosses slot capacity and keeps
  // later unfiled rows; whole-file retry remains safe on the built session router.
  const capacity = await signup('builtcapacity');
  const capacityRequest = (path, method = 'GET', body) => request(path, method, body, capacity.cookie);
  await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<499)
    INSERT INTO clips(id,owner,title,kind,content,original,segments,versions,collection,collection_synced,created_at,updated_at)
    SELECT 'built-capacity-'||x,?,'Old','note','body','body','[]','[]','Inbox',1,0,0 FROM n`).bind(capacity.owner).run();
  const backup = ['Inbox', 'Inbox', ''].map((collection) => {
    const id = crypto.randomUUID();
    return { id, title: 'Restore '+id, kind: 'note', content: 'Restored body', original: 'Restored body', context: '', collection, tags: ['restore'], pinned: false, revision: 1, createdAt: 1, updatedAt: 1,
      segments: [{id: crypto.randomUUID(), text: 'Restored body', createdAt: 1}],
      versions: [{id: crypto.randomUUID(), text: 'Restored body', kind: 'original', createdAt: 1}] };
  });
  for (const imported of [true, false]) for (const clip of backup) {
    const response = await capacityRequest('import', 'POST', {clip});
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal((await response.json()).imported, imported);
  }
  assert.equal((await db.prepare('SELECT count(*) n FROM clips WHERE owner=?').bind(capacity.owner).first()).n,502);
  const blockedResponse = await capacityRequest('v1/collection-backfill', 'POST', {limit:50});
  assert.equal(blockedResponse.status,200);
  const blocked = await blockedResponse.json();
  assert.equal(blocked.status,'blocked'); assert.equal(blocked.pending,1); assert.equal(blocked.memberCapacity,1); assert.equal(blocked.processed,0);
  const deferred = await db.prepare(`SELECT id FROM clips WHERE owner=? AND collection_synced=0 AND collection<>''`).bind(capacity.owner).first();
  assert.equal((await (await capacityRequest('v1/items/text/'+deferred.id)).json()).cleanup.reason,'collection_pending');
  // A new clipboard capture also survives the real scheduled cleanup while blocked.
  const captureId = crypto.randomUUID();
  const capture = await capacityRequest('clips','POST',{id:captureId,content:'Keep pending capture',collection:'Inbox',clipboardItem:true});
  assert.equal(capture.status,201,await capture.clone().text());
  await db.prepare('UPDATE clips SET created_at=0 WHERE owner=? AND id=?').bind(capacity.owner,captureId).run();
  assert.equal((await capacityRequest('settings','POST',{action:'clipboard-cleanup',enabled:true})).status,200);
  await (await mf.getWorker()).scheduled({scheduledTime:Date.now(),cron:'0 8 * * *'});
  assert.equal((await capacityRequest('clips/'+captureId)).status,200);
  assert.equal((await (await capacityRequest('v1/items/text/'+captureId)).json()).cleanup.reason,'collection_pending');
  // P3 runs through the shipped authenticated routes, including a second session.
  const p3Note=await create();
  const p3LinkResponse=await request('v1/documents','POST',{id:crypto.randomUUID(),kind:'link',name:'Saturday shop',url:'https://shop.example.test/errands'});
  assert.equal(p3LinkResponse.status,201);const p3Link=await p3LinkResponse.json();
  const p3PdfBytes=Buffer.from('%PDF-1.4\nSynthetic receipt fixture\n%%EOF');
  const p3PdfResponse=await request('v1/documents','POST',{id:crypto.randomUUID(),kind:'file',name:'Saturday receipt',filename:'receipt.pdf',mime:'application/pdf',size:p3PdfBytes.length});
  assert.equal(p3PdfResponse.status,201);const p3Pdf=await p3PdfResponse.json();
  const p3Upload=await mf.dispatchFetch(origin+'/api/v1/documents/'+p3Pdf.id+'/file',{method:'PUT',headers:{Origin:origin,Cookie:alice.cookie,'Content-Type':'application/octet-stream','Content-Length':String(p3PdfBytes.length)},body:p3PdfBytes});
  assert.equal(p3Upload.status,200,await p3Upload.clone().text());
  const p3Refs=[{kind:'text',id:p3Note.id},{kind:'image',id:retainedImage.id},{kind:'document',id:p3Pdf.id},{kind:'document',id:p3Link.id}];
  const p3Budget=await get('v1/documents');
  const p3Create=await request('v1/piles','POST',{operationId:crypto.randomUUID(),name:'Saturday errands',color:'mint',members:p3Refs});assert.equal(p3Create.status,201);const p3Pile=(await p3Create.json()).pile;
  const p3Items=await get(`v1/piles/${p3Pile.id}/items`);assert.deepEqual(p3Items.items.map(i=>i.ref),p3Refs);assert.equal(p3Items.items[3].displayKind,'link');assert.equal(p3Items.items[3].preview.host,'shop.example.test');
  assert.equal((await get('v1/documents')).usedBytes,p3Budget.usedBytes);
  const p3Login=await request('auth/sign-in/email','POST',{email:'builtsharedalice@example.test',password:'synthetic-shared-password'},'');assert.equal(p3Login.status,200);const p3Cookie=p3Login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const p3Second=await request(`v1/piles/${p3Pile.id}/items`,'GET',undefined,p3Cookie);assert.equal(p3Second.status,200);assert.deepEqual((await p3Second.json()).items.map(i=>i.ref),p3Refs);
  assert.equal((await request(`v1/piles/${p3Pile.id}/items`,'GET',undefined,bob.cookie)).status,404);
  const p3Impact=await get(`v1/piles/${p3Pile.id}/members/text/${p3Note.id}/impact`);
  const p3Remove={operationId:crypto.randomUUID(),ref:p3Refs[0],action:'removeAndPin',revision:p3Impact.revision,workspaceRevision:p3Impact.workspaceRevision};
  await create();assert.equal((await request(`v1/piles/${p3Pile.id}/members`,'POST',p3Remove)).status,409);
  const p3Fresh=await get(`v1/piles/${p3Pile.id}/members/text/${p3Note.id}/impact`);p3Remove.workspaceRevision=p3Fresh.workspaceRevision;
  const p3Removed=await get(`v1/piles/${p3Pile.id}/members`,'POST',p3Remove);assert.equal(p3Removed.item.pinned,true);assert.equal((await get(`v1/piles/${p3Pile.id}/members`,'POST',p3Remove)).replayed,true);
  await get(`v1/piles/${p3Pile.id}/members`,'POST',{operationId:crypto.randomUUID(),ref:p3Refs[0],action:'restore',revision:p3Removed.pileRevision,undoOperationId:p3Remove.operationId});
  const p3Edited=await get('v1/documents/'+p3Link.id,'PATCH',{revision:p3Link.revision,name:'Saturday shop updated',url:'https://shop.example.test/receipt'});assert.equal(p3Edited.revision,p3Link.revision+1);
  assert.equal((await request('v1/documents/'+p3Link.id,'PATCH',{revision:p3Link.revision,name:'Stale'})).status,409);
  for(const bad of ['http://example.test','javascript:alert(1)','https://user:pass@example.test']) assert.equal((await request('v1/documents/'+p3Link.id,'PATCH',{revision:p3Edited.revision,url:bad})).status,400);
  const p3Pending=await (await capacityRequest('clips/'+captureId)).json();
  assert.equal((await capacityRequest('clips/'+captureId,'PATCH',{action:'pin',revision:p3Pending.revision,pinned:true})).status,200);
  const p3Projection=await (await capacityRequest('v1/items/text/'+captureId)).json();assert.equal(p3Projection.cleanup.reason,'pinned');assert.deepEqual(p3Projection.organization,{state:'member_capacity',pending:true});
  const erased = await request('auth/account-deletion', 'POST', {
    confirmEmail: 'builtsharedalice@example.test',
  });
  assert.equal(erased.status, 200, await erased.clone().text());
  for (const table of [
    'piles',
    'pile_members',
    'collection_mappings',
    'pile_operations',
    'item_deletions',
    'workspace_revision',
    'clips',
    'clipboard_images',
    'content_items',
  ])
    assert.equal(
      (
        await db
          .prepare(`SELECT count(*) n FROM ${table} WHERE owner=?`)
          .bind(alice.owner)
          .first()
      ).n,
      0,
      table,
    );
  assert.equal((await request('v1/piles', 'POST', mixedInput)).status, 401);
  assert.equal(
    (await request('v1/piles', 'GET', undefined, bob.cookie)).status,
    200,
  );
  console.log(
    'Built shared items Worker passed: P3 mixed ready sources, second session, bounded resolution, owner isolation, guarded removal/Undo, generic bookmark edits and independent pinned-pending projection; P2 capacity-safe restore/capture/retry/cleanup, mapping/backfill/provenance/suppression and P1 lifecycle, mixed selection, stale impact, pin/expose deletion, source bytes/quota preservation, complete erasure, owner isolation, F2 retries/Undo and cleanup.',
  );
} finally {
  await mf.dispose();
}
