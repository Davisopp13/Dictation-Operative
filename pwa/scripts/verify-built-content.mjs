import { installTestReleaseFence } from './release-fence-fixture.mjs';
import { Miniflare } from 'miniflare';
import { readFileSync,readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const root='dist/server', origin='http://localhost';
const mf=new Miniflare({modulesRoot:root,modules:['index.js',...readdirSync(root,{recursive:true}).filter(f=>f.endsWith('.js')&&f!=='index.js')].map(file=>({type:'ESModule',path:root+'/'+file})),compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['IMAGES'],bindings:{ WORKSPACE_WRITE_FENCE: 'on',BETTER_AUTH_URL:origin,BETTER_AUTH_SECRET:'synthetic-built-content-secret-32-characters'}});
try {
 let db=await mf.getD1Database('DB');const bucket=await mf.getR2Bucket('IMAGES');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql.trim()).run();
  db = await installTestReleaseFence(db);
 async function signup(username){const response=await mf.dispatchFetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username,email:`${username}@example.test`,name:username,password:'synthetic-content-password'})});assert.equal(response.status,200,await response.clone().text());const data=await response.json();return {cookie:response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '),owner:data.user.id};}
 const alice=await signup('builtcontentalice'),bob=await signup('builtcontentbob');
 const request=(path,method='GET',body,cookie=alice.cookie,headers={})=>mf.dispatchFetch(origin+'/api/'+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':body instanceof Uint8Array?'application/octet-stream':'application/json',...headers},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)});
 assert.equal((await request('content','GET',undefined,'')).status,401);
 const bytes=new Uint8Array(1_000_000);bytes[0]=10;bytes[bytes.length-1]=20;
 const reservation=await request('content','POST',{kind:'file',name:'Synthetic range fixture',filename:'fixture.mp4',mime:'video/mp4',size:bytes.length});assert.equal(reservation.status,201);const item=await reservation.json();
 const upload=await request(`content/${item.id}/file`,'PUT',bytes,alice.cookie,{'Content-Length':String(bytes.length)});assert.equal(upload.status,200,await upload.clone().text());await upload.text();
 const part=await request(`content/${item.id}/file`,'GET',undefined,alice.cookie,{Range:'bytes=-1'});assert.equal(part.status,206);assert.equal(part.headers.get('Content-Range'),'bytes 999999-999999/1000000');assert.deepEqual(new Uint8Array(await part.arrayBuffer()),Uint8Array.of(20));
 const head=await request(`content/${item.id}/file`,'HEAD');assert.equal(head.headers.get('Content-Length'),'1000000');assert.equal(await head.text(),'');
 assert.equal((await request(`content/${item.id}/file`,'GET',undefined,bob.cookie)).status,404);assert.equal((await request(`content/${item.id}`,'DELETE',undefined,bob.cookie)).status,404);
 const ready=await(await request('content')).json();assert.equal(ready.items.length,1);
 await db.prepare("UPDATE content_items SET created_at=1 WHERE state='ready'").run();await(await mf.getWorker()).scheduled({scheduledTime:new Date(),cron:'0 8 * * *'});assert.ok(await bucket.head(`content/${item.id}`));
 assert.equal((await request(`content/${item.id}`,'DELETE')).status,200);assert.equal(await bucket.head(`content/${item.id}`),null);
 await db.prepare('DELETE FROM auth_session WHERE user_id=?').bind(alice.owner).run();assert.equal((await request('content')).status,401);
 console.log('Built Content Worker passed: sessions, streamed upload, suffix/HEAD reads, cross-account denial, retention, deletion, revocation.');
} finally {await mf.dispose();}
