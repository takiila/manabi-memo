import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import ts from 'typescript';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const scratch = await mkdtemp(path.join(tmpdir(), 'manabi-sync-browser-'));
const port = await new Promise(resolve => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
});
const origin = `http://127.0.0.1:${port}`;
const log = [];
const server = spawn(process.execPath, [path.join(root,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)], {
  cwd:root, stdio:['ignore','pipe','pipe'], env:{...process.env,
    DATABASE_URL:`sqlite:${path.join(scratch,'browser.sqlite')}`, LOCAL_FILE_STORE:path.join(scratch,'objects'),
    TRUST_CHATGPT_AUTH_HEADERS:'true', CAMPUS_ACCESS_MODE:'authenticated', ALLOWED_ACCOUNT_EMAILS:'browser@example.test',
    FIREBASE_API_KEY:'', FIREBASE_AUTH_DOMAIN:'', FIREBASE_PROJECT_ID:'', FIREBASE_APP_ID:'',
  },
});
server.stdout.on('data',value=>log.push(String(value)));
server.stderr.on('data',value=>log.push(String(value)));
let browser;
const errors=[];
const headers={'oai-authenticated-user-email':'browser@example.test'};
const pdfBytes='%PDF-1.4\n% synthetic local-only fixture';
const hash=createHash('sha256').update(pdfBytes).digest('hex');
const now='2026-09-30T00:00:00.000Z';
const fixture={
  courses:[{id:'browser-course',title:'同期テスト講義',term:'2026年度 後期',instructor:'テスト教員',room:'A101',weekday:3,period:1,createdAt:now}],
  sessions:[{id:'browser-session',courseId:'browser-course',course:'同期テスト講義',sessionNumber:'1',title:'同期テストノート',
    hasPdf:true,pdfSyncMode:'local-only',pdfSha256:hash,fileName:'local.pdf',pageCount:1,pageTexts:['資料本文'],topics:[],needsOcr:false,
    lastPdfPage:1,noteText:'desktop original',createdAt:now,updatedAt:now}],
  memos:[],terms:['2026年度 後期'],activeTerm:'2026年度 後期',tutorialSeen:true,
  campus:{betaAccess:{enabled:true,activatedAt:now},assignments:[{id:'assignment-1',courseId:'browser-course',termId:'2026年度 後期',title:'同期テスト課題',dueISO:'2026-10-05T17:00',status:'todo',createdAt:now}]},
};

try {
  await until(async()=>{try{return (await fetch(`${origin}/api/health`)).ok;}catch{return false;}},'server');
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  await verifyStorageCancellation();
  const desktop=await device({width:1440,height:1000},fixture,true);
  await enable(desktop.page);
  await until(async()=>(await cloud()).state?.sessions?.[0]?.noteText==='desktop original','desktop upload');
  const laptop=await device({width:1280,height:900});
  await enable(laptop.page);
  await until(async()=>(await local(laptop.page))?.sessions?.[0]?.noteText==='desktop original','laptop restore without PDF');
  const phone=await device({width:390,height:844});
  await enable(phone.page);
  await until(async()=>(await local(phone.page))?.sessions?.[0]?.noteText==='desktop original','phone restore without PDF');
  assert.equal((await cloud()).pdfs.length,0);
  await openNote(laptop.page);
  await laptop.page.getByLabel('ノート本文',{exact:true}).fill('laptop changed note');
  await until(async()=>(await cloud()).state?.sessions?.[0]?.noteText==='laptop changed note','automatic laptop upload');
  await until(async()=>(await local(phone.page))?.sessions?.[0]?.noteText==='laptop changed note','phone periodic receive');
  await until(async()=>(await local(desktop.page))?.sessions?.[0]?.noteText==='laptop changed note','desktop periodic receive');
  assert.equal(await pdfCount(desktop.page),1,'original desktop PDF survives remote restore');
  assert.equal(await pdfCount(phone.page),0,'phone never downloads local-only PDF bytes');
  await openNote(phone.page);
  assert.equal(await phone.page.getByLabel('PDF本体の保存',{exact:true}).inputValue(),'local-only');
  await phone.page.getByLabel('ノート本文',{exact:true}).fill('phone changed note');
  await until(async()=>(await cloud()).state?.sessions?.[0]?.noteText==='phone changed note','automatic phone upload');
  await until(async()=>(await local(laptop.page))?.sessions?.[0]?.noteText==='phone changed note','laptop receives phone edit while note stays open');
  assert.equal(await laptop.page.getByLabel('ノート本文',{exact:true}).inputValue(),'phone changed note');
  assert.equal(await phone.page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth),true,'phone layout fits viewport');

  // Changing a deadline from a third client reaches all mounted clients.
  const before=await cloud();
  const remote=structuredClone(before.state);
  remote.campus.assignments[0].dueISO='2026-10-08T17:00';
  remote.campus.assignments[0].status='done';
  await publish(remote,before.revision);
  await Promise.all([desktop,laptop,phone].map(({page})=>until(async()=>{
    const state=await local(page);
    return state?.campus?.assignments?.[0]?.dueISO==='2026-10-08T17:00' && state.campus.assignments[0].status==='done';
  },'deadline and completion receive')));

  // Offline edits remain local, then synchronize when only this side changed.
  await laptop.context.setOffline(true);
  await laptop.page.getByLabel('ノート本文',{exact:true}).fill('offline laptop note');
  await until(async()=>(await local(laptop.page))?.sessions?.[0]?.noteText==='offline laptop note','offline local save');
  await laptop.context.setOffline(false);
  await laptop.page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await until(async()=>(await cloud()).state?.sessions?.[0]?.noteText==='offline laptop note','online recovery');

  // Delay a real cloud response, type locally, then release it. The late
  // response must not overwrite the new text or leave sync running twice.
  await until(async()=>await laptop.page.locator('.account-sync-launcher.synced').count()===1,'laptop synced');
  let releaseResponse;
  let responseReady;
  const released=new Promise(resolve=>{releaseResponse=resolve;});
  let responseArrived=false;
  const ready=new Promise(resolve=>{responseReady=()=>{responseArrived=true;resolve();};});
  await laptop.page.route('**/api/sync/state',async route=>{
    if(route.request().method()!=='GET')return route.continue();
    const response=await route.fetch();
    responseReady();
    await released;
    await route.fulfill({response});
  });
  await laptop.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await until(async()=>responseArrived,'delayed cloud response');
  await ready;
  await laptop.page.getByLabel('ノート本文',{exact:true}).fill('edit during cloud check');
  releaseResponse();
  await until(async()=>await laptop.page.locator('.account-sync-launcher.conflict').count()===1,'in-flight edit protected');
  assert.equal(await laptop.page.getByLabel('ノート本文',{exact:true}).inputValue(),'edit during cloud check');
  assert.equal((await cloud()).state.sessions[0].noteText,'offline laptop note');
  await laptop.page.unroute('**/api/sync/state');
  const replacement=await cloud();
  replacement.state.sessions[0].pdfSha256='f'.repeat(64);
  await publish(replacement.state,replacement.revision);
  await desktop.page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await until(async()=>(await local(desktop.page)).sessions[0].pdfSha256==='f'.repeat(64),'PDF metadata replacement');
  const archived=await desktop.page.evaluate(async()=>new Promise(resolve=>{
    const request=indexedDB.open('manabi-memo-local-files',2);
    request.onsuccess=()=>{
      const db=request.result;const store=db.transaction('pdfs').objectStore('pdfs');
      const read=store.getAllKeys();
      read.onsuccess=()=>{resolve(read.result.map(String));db.close();};
    };
  }));
  assert.deepEqual(archived,[`retained-pdf:browser-session:${hash}`]);
  assert.deepEqual(errors,[]);
  console.log('browser sync passed: desktop/laptop/phone, periodic receive, local PDF retention, note editing, deadlines/completion, offline recovery, phone layout');
} finally {
  await browser?.close();
  server.kill();
  await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);});
  await rm(scratch,{recursive:true,force:true});
}

async function verifyStorageCancellation() {
  const compile = source => ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const deadline = compile(await readFile(path.join(root,'app/async-deadline.ts'),'utf8'));
  const moduleSource = compile(await readFile(path.join(root,'app/local-files.ts'),'utf8'))
    .replace('"./async-deadline"', JSON.stringify(`data:text/javascript;base64,${Buffer.from(deadline).toString('base64')}`));
  const context=await browser.newContext();
  const page=await context.newPage();
  await page.goto(`${origin}/api/health`);
  const result=await page.evaluate(async ({moduleSource})=>{
    const moduleUrl=URL.createObjectURL(new Blob([moduleSource],{type:'text/javascript'}));
    const storage=await import(moduleUrl);
    URL.revokeObjectURL(moduleUrl);
    const original={note:'keep my edit'};
    const pdf={id:'original',blob:new Blob(['original PDF'])};
    const initial=await storage.restoreAppStateAndPdfs(original,[pdf],true,13);
    let checks=0;
    let guardRejected=false;
    try {
      await storage.restoreAppStateAndPdfs({note:'remote'},[],true,13,initial.revision,undefined,{assertCurrent:()=>{
        if(++checks===2)throw new Error('edited while waiting for storage');
      }});
    } catch { guardRejected=true; }
    const afterGuard=await storage.loadAppState();
    const controller=new AbortController();
    const reason=new Error('sync stopped after write queued');
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){
      const request=put.apply(this,args);
      if(this.name==='app-state')controller.abort(reason);
      return request;
    };
    let cancelled=false;
    try {
      await storage.restoreAppStateAndPdfs({note:'remote'},[],true,13,initial.revision,undefined,{signal:controller.signal});
    } catch (cause) { cancelled=cause===reason; }
    finally { IDBObjectStore.prototype.put=put; }
    const saved=await storage.loadAppState();
    const files=await storage.loadAllPdfs();
    return {guardRejected,cancelled,afterGuard:afterGuard.data,saved:saved.data,revision:saved.revision,pdf:await files[0].blob.text()};
  },{moduleSource});
  assert.deepEqual(result,{guardRejected:true,cancelled:true,afterGuard:{note:'keep my edit'},saved:{note:'keep my edit'},revision:1,pdf:'original PDF'});
  await context.close();
}

async function device(viewport,state={courses:[],sessions:[],memos:[],tutorialSeen:true},withPdf=false){
  const context=await browser.newContext({viewport,extraHTTPHeaders:headers,serviceWorkers:'block'});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(`${origin}/api/health`);
  await page.evaluate(async({state,withPdf,pdfBytes})=>{
    localStorage.setItem('manabi-memo-state-v7',JSON.stringify(state));
    if(withPdf)await new Promise((resolve,reject)=>{
      const request=indexedDB.open('manabi-memo-local-files',2);
      request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('pdfs');db.createObjectStore('app-state');db.createObjectStore('local-metrics',{keyPath:'id',autoIncrement:true});};
      request.onsuccess=()=>{const db=request.result;const tx=db.transaction('pdfs','readwrite');tx.objectStore('pdfs').put(new Blob([pdfBytes],{type:'application/pdf'}),'browser-session');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};
      request.onerror=()=>reject(request.error);
    });
  },{state,withPdf,pdfBytes});
  await page.goto(origin);
  await until(async()=>Boolean(await local(page)),'device hydration');
  return {context,page};
}
async function enable(page){
  await page.locator('.account-sync-launcher').click();
  await page.getByRole('button',{name:'クラウド同期を始める',exact:true}).click();
  await until(async()=>await page.locator('.account-sync-launcher.synced').count()===1,'sync enable');
  await page.locator('.account-sync-panel').getByRole('button',{name:'閉じる',exact:true}).click();
}
async function openNote(page){
  await page.getByRole('button').filter({hasText:'同期テスト講義'}).first().click();
  await page.locator('.session-library-open').first().click();
  await page.getByLabel('ノート本文',{exact:true}).waitFor();
}
async function local(page){return page.evaluate(async()=>new Promise(resolve=>{
  const request=indexedDB.open('manabi-memo-local-files',2);
  request.onsuccess=()=>{const db=request.result;const read=db.transaction('app-state').objectStore('app-state').get('current');read.onsuccess=()=>{resolve(read.result?.data);db.close();};read.onerror=()=>{resolve(null);db.close();};};
  request.onerror=()=>resolve(null);
}));}
async function pdfCount(page){return page.evaluate(async()=>new Promise(resolve=>{
  const request=indexedDB.open('manabi-memo-local-files',2);request.onsuccess=()=>{const db=request.result;const read=db.transaction('pdfs').objectStore('pdfs').count();read.onsuccess=()=>{resolve(read.result);db.close();};};
}));}
async function cloud(){return (await fetch(`${origin}/api/sync/state`,{headers})).json();}
async function publish(state,baseRevision){
  const h={...headers,origin,'content-type':'application/json','sec-fetch-site':'same-origin'};
  const response=await fetch(`${origin}/api/sync/state`,{method:'POST',headers:h,body:JSON.stringify({state,baseRevision,schemaVersion:13,deviceId:'fixture-desktop',pdfs:[],pdfIds:[]})});
  assert.equal(response.status,200);
  const {transactionId}=await response.json();
  const commit=await fetch(`${origin}/api/sync/state`,{method:'POST',headers:h,body:JSON.stringify({transactionId})});
  assert.equal(commit.status,200);
}
async function until(check,label){
  const end=Date.now()+35000;
  while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,150));}
  throw Error(`Timed out: ${label}\n${log.slice(-3).join('')}`);
}
