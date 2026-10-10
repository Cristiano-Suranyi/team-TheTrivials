import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const listeners={};const event=name=>({addListener:fn=>listeners[name]=fn});
let session={},local={},removed=[],tabs=[],opened=0;
const store=()=>({get:async keys=>structuredClone(Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,session[k]]))),set:async values=>Object.assign(session,structuredClone(values))});
globalThis.chrome={runtime:{getURL:path=>'chrome-extension://lfnbhbifaakkolphooipdoinpknmacnf/'+path,onMessage:event('internal'),onMessageExternal:event('external'),sendMessage:async m=>({ok:true,offset:m.offset,data:'JVBERi0='})},storage:{session:store(),local:{get:async()=>structuredClone(local),set:async values=>Object.assign(local,values)}},action:{setBadgeText:async()=>{},openPopup:async()=>{opened++;}},tabs:{query:async()=>[{id:1,url:'https://example.org/test.pdf'}],create:async info=>{const tab={id:tabs.length+2,...info};tabs.push(tab);return tab;},get:async id=>({id,url:'https://example.org/test.pdf',active:true,status:'complete',windowId:1}),remove:async id=>removed.push(id),onUpdated:event('updated'),onActivated:event('activated'),onRemoved:event('removed')},windows:{get:async()=>({focused:true})},webRequest:{onHeadersReceived:event('headers')},webNavigation:{onCommitted:event('committed')},alarms:{create:()=>{},onAlarm:event('alarm')}};
const {internal,external}=await import('../extension/background.js');
const {localOrigin,pdfURL}=await import('../extension/config.js');
beforeEach(()=>{session={};local={};removed=[];tabs=[];opened=0;});
test('stable manifest identity and local-only settings',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url)));
 const id=createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,x=>String.fromCharCode(97+parseInt(x,16)));
 assert.equal(id,'lfnbhbifaakkolphooipdoinpknmacnf');
 assert.equal(localOrigin('http://localhost:8787/'),'http://localhost:8787');
 for(const address of ['https://example.org','http://127.0.0.1.evil.test','http://localhost:8787/path'])assert.throws(()=>localOrigin(address));
 assert.ok(pdfURL('file:///tmp/a.pdf')); assert.ok(!pdfURL('blob:https://example.org/a.pdf'));
});
test('Content-Type detection and repeated navigation offer only once',async()=>{
 await listeners.headers({tabId:1,method:'GET',url:'https://example.org/test.pdf',responseHeaders:[{name:'Content-Type',value:'application/pdf'}]});
 await listeners.updated(1,{status:'complete'},{url:'https://example.org/test.pdf'});
 await listeners.updated(1,{status:'complete'},{url:'https://example.org/test.pdf'});
 assert.equal(opened,1);
 local.autoPrompt=false;session.pdfTabs[1].prompted=false;await listeners.activated({tabId:1});assert.equal(opened,1);
});
test('opening only creates a browser bridge, then binds and consumes the transfer',async()=>{
 const popup={url:chrome.runtime.getURL('popup.html')};
 await internal({type:'open-hidden'},popup);
 const [ticket,entry]=Object.entries(session.transfers)[0];
 assert.equal(tabs.length,1); assert.equal(entry.source,'https://example.org/test.pdf');
 const bridge={url:tabs[0].url,tab:{id:tabs[0].id}};
 await internal({type:'bridge-ready',size:5,sha256:'a'.repeat(64)},bridge);
 const sender={url:'http://127.0.0.1:8787/',tab:{id:tabs[1].id}};
 await assert.rejects(external({type:'hidden-import-meta',ticket},{...sender,tab:{id:999}}));
 await assert.rejects(external({type:'hidden-import-meta',ticket},{...sender,url:'https://evil.test/'}));
 assert.equal((await external({type:'hidden-import-meta',ticket},sender)).size,5);
 const done=await external({type:'hidden-import-done',ticket},sender);
 assert.deepEqual(removed,[bridge.tab.id]);assert.ok(!session.transfers[ticket]);
 await assert.rejects(external({type:'hidden-import-meta',ticket},sender));
 assert.ok(session.transfers[done.historyTicket].history);
 assert.ok(!JSON.stringify(session).includes('JVBERi0='));
});
test('expired transfers are closed and removed',async()=>{
 session.transfers={test:{expiresAt:Date.now()-1,bridgeTabId:12}};
 await listeners.alarm({name:'expire-imports'});
 assert.deepEqual(session.transfers,{});assert.deepEqual(removed,[12]);
});
test('detects PDF responses without a filename suffix and clears on non-PDF navigation',async()=>{
 await listeners.headers({tabId:8,method:'GET',url:'https://example.org/download?id=3',responseHeaders:[{name:'Content-Type',value:'application/pdf'},{name:'Content-Disposition',value:'inline; filename="scan.pdf"'}]});
 assert.equal(session.pdfTabs[8].name,'scan.pdf');
 await listeners.committed({tabId:8,frameId:0,url:'https://example.org/page'});
 assert.ok(!session.pdfTabs[8]);
});
test('history retains only ten metadata entries and expired transfers reject requests',async()=>{
 const id='a'.repeat(64);const sender={url:'http://127.0.0.1:8787/',tab:{id:4}};
 session.transfers={[id]:{siteBase:'http://127.0.0.1:8787',siteTabId:4,history:true,expiresAt:Date.now()+10000}};
 for(let i=0;i<12;i++)await external({type:'hidden-history',ticket:id,session:{session_id:String(i).padStart(32,'0'),file_name:'sample.pdf',expires_at:new Date(Date.now()+3600000).toISOString(),text:'private'}},sender);
 assert.equal(local.sessions.length,10);assert.ok(!JSON.stringify(local).includes('private'));
 session.transfers[id].expiresAt=Date.now()-1;
 await assert.rejects(external({type:'hidden-history',ticket:id},sender));
});
