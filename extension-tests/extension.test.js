import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const listeners={};const event=name=>({addListener:fn=>listeners[name]=fn});
let session={},local={},tabs=[],opened=0,downloads=[],badges={},fetches=[],responses=[];
const store=()=>({get:async keys=>structuredClone(Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,session[k]]))),set:async values=>Object.assign(session,structuredClone(values))});
const POPUP='chrome-extension://lfnbhbifaakkolphooipdoinpknmacnf/popup.html';
let activeTab={id:1,url:'https://example.org/test.pdf',active:true,status:'complete',windowId:1};
globalThis.chrome={runtime:{getURL:path=>'chrome-extension://lfnbhbifaakkolphooipdoinpknmacnf/'+path,onMessage:event('message')},
 storage:{session:store(),local:{get:async()=>structuredClone(local),set:async values=>Object.assign(local,values)}},
 action:{setBadgeText:async({tabId,text})=>{badges[tabId]=text;},setBadgeBackgroundColor:async()=>{},openPopup:async()=>{opened++;}},
 tabs:{query:async()=>[activeTab],create:async info=>{tabs.push(info);return {id:99,...info};},get:async id=>({...activeTab,id}),onUpdated:event('updated'),onActivated:event('activated'),onRemoved:event('removed')},
 windows:{get:async()=>({focused:true})},downloads:{download:async options=>{downloads.push(options);return 1;}},
 webRequest:{onHeadersReceived:event('headers')},webNavigation:{onCommitted:event('committed')},alarms:{create:()=>{},onAlarm:event('alarm')}};
globalThis.fetch=async url=>{fetches.push(url);const next=responses.shift();return new Response(JSON.stringify(next),{status:200});};
const {handle,follow}=await import('../extension/background.js');
const {localOrigin,pdfURL}=await import('../extension/config.js');
const SID='s'.repeat(32);
beforeEach(()=>{session={};local={};tabs=[];opened=0;downloads=[];badges={};fetches=[];responses=[];});

test('stable manifest identity, downloads permission and local-only settings',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url)));
 const id=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,x=>String.fromCharCode(97+parseInt(x,16)));
 assert.equal(id,'lfnbhbifaakkolphooipdoinpknmacnf');
 assert.ok(manifest.permissions.includes('downloads'));
 assert.equal(localOrigin('http://localhost:8787/'),'http://localhost:8787');
 for(const address of ['https://example.org','http://127.0.0.1.evil.test','http://localhost:8787/path'])assert.throws(()=>localOrigin(address));
 assert.ok(pdfURL('file:///tmp/a.pdf')); assert.ok(!pdfURL('blob:https://example.org/a.pdf'));
});

test('step 1: a PDF opens the prompt once; "No" keeps it closed',async()=>{
 await listeners.headers({tabId:1,method:'GET',url:'https://example.org/test.pdf',responseHeaders:[{name:'Content-Type',value:'application/pdf'}]});
 assert.equal(badges[1],'PDF');
 await listeners.updated(1,{status:'complete'},{url:'https://example.org/test.pdf'});
 await listeners.updated(1,{status:'complete'},{url:'https://example.org/test.pdf'});
 assert.equal(opened,1);
 session.pdfTabs[1].prompted=false;
 await handle({type:'dismiss'},{url:POPUP});
 await listeners.activated({tabId:1});
 assert.equal(opened,1);
});

test('steps 3-5: track the backend job, reopen when ready, download and review',async()=>{
 await listeners.headers({tabId:1,method:'GET',url:'https://example.org/test.pdf',responseHeaders:[{name:'Content-Type',value:'application/pdf'}]});
 responses=[{status:'processing',stage:'Analyzing',progress:60},{status:'ready',stage:'Ready',progress:100}];
 await assert.rejects(handle({type:'download'},{url:POPUP}),/not ready/);
 await handle({type:'track',sessionId:SID},{url:POPUP});
 await follow(1);
 const job=session.jobs[1];
 assert.equal(job.status,'ready');assert.equal(badges[1],'✓');assert.ok(opened>=1);
 assert.ok(fetches.every(u=>u===`http://127.0.0.1:8787/api/public/sessions/${SID}`));
 assert.equal(local.sessions[0].id,SID);
 await handle({type:'download'},{url:POPUP});
 assert.deepEqual(downloads[0],{url:`http://127.0.0.1:8787/api/public/sessions/${SID}/masked.pdf`,filename:'test-anonymized.pdf',conflictAction:'uniquify'});
 await handle({type:'review'},{url:POPUP});
 assert.equal(tabs[0].url,`http://127.0.0.1:8787/review/${SID}`);
});

test('failed jobs surface the backend error; only the popup may send commands',async()=>{
 await listeners.headers({tabId:1,method:'GET',url:'https://example.org/test.pdf',responseHeaders:[{name:'Content-Type',value:'application/pdf'}]});
 responses=[{status:'failed',stage:'Processing failed',error:'quota'}];
 await handle({type:'track',sessionId:SID},{url:POPUP});
 await follow(1);
 assert.equal(session.jobs[1].status,'failed');assert.equal(session.jobs[1].error,'quota');assert.equal(badges[1],'!');
 await assert.rejects(handle({type:'active-pdf'},{url:'https://evil.test/'}));
 await assert.rejects(handle({type:'track',sessionId:'../x'},{url:POPUP}),/Invalid session/);
});

test('detects PDF responses without a filename suffix and clears on non-PDF navigation',async()=>{
 await listeners.headers({tabId:8,method:'GET',url:'https://example.org/download?id=3',responseHeaders:[{name:'Content-Type',value:'application/pdf'},{name:'Content-Disposition',value:'inline; filename="scan.pdf"'}]});
 assert.equal(session.pdfTabs[8].name,'scan.pdf');
 await listeners.committed({tabId:8,frameId:0,url:'https://example.org/page'});
 assert.ok(!session.pdfTabs[8]);
});
