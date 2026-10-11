import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readPDF,checkSite} from '../extension/transport.js';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
test('web PDF bytes are read with credentials without calling the analysis API',async()=>{
 const calls=[];globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return new Response('%PDF-1.7\nexample',{headers:{'Content-Type':'application/pdf'}});};
 assert.equal(new TextDecoder().decode(await readPDF('https://example.org/download')), '%PDF-1.7\nexample');
 assert.equal(calls.length,1);assert.equal(calls[0].opts.credentials,'include');assert.ok(!calls[0].url.includes('/api'));
});
test('local files require the Chrome file permission',async()=>{
 globalThis.chrome={extension:{isAllowedFileSchemeAccess:fn=>fn(false)}};
 globalThis.fetch=async()=>{throw new Error('should not fetch');};
 await assert.rejects(readPDF('file:///tmp/test.pdf'),/Allow access/);
 chrome.extension.isAllowedFileSchemeAccess=fn=>fn(true);globalThis.fetch=async()=>new Response('%PDF-1.7');
 assert.equal((await readPDF('file:///tmp/test.pdf')).length,8);
});
test('authentication, blob resources, wrong content and large PDFs give clear errors',async()=>{
 globalThis.fetch=async()=>new Response('denied',{status:403});
 await assert.rejects(readPDF('https://example.org/a.pdf'),/current access/);
 await assert.rejects(readPDF('blob:https://example.org/test'),/Select its downloaded/);
 globalThis.fetch=async()=>new Response('not PDF');await assert.rejects(readPDF('https://example.org/a.pdf'),/not a valid PDF/);
 globalThis.fetch=async()=>new Response('%PDF-', {headers:{'Content-Length':String(21*1024*1024)}});await assert.rejects(readPDF('https://example.org/a.pdf'),/20 MB/);
});
test('stopped service is retryable and only checks the website',async()=>{
 let url;globalThis.fetch=async value=>{url=value;throw new Error('connection refused');};
 await assert.rejects(checkSite('http://127.0.0.1:8787'),/Start python3 run_app.py/);
 assert.equal(url,'http://127.0.0.1:8787/');
});
test('upload sends the PDF to the backend and returns the session',async()=>{
 const {uploadPDF,getSession}=await import('../extension/transport.js');
 let call;globalThis.fetch=async(url,opts)=>{call={url,opts};return new Response(JSON.stringify({session_id:'a'.repeat(32),status:'queued'}),{status:202});};
 const session=await uploadPDF('http://127.0.0.1:8787',new Uint8Array([37,80,68,70]),'x.pdf');
 assert.equal(session.session_id,'a'.repeat(32));
 assert.equal(call.url,'http://127.0.0.1:8787/api/public/sessions/upload');assert.equal(call.opts.method,'POST');
 assert.equal(call.opts.body.get('file').name,'x.pdf');
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'Configure GEMINI_API_KEY'}),{status:503});
 await assert.rejects(uploadPDF('http://127.0.0.1:8787',new Uint8Array([1]),'x.pdf'),/GEMINI_API_KEY/);
 globalThis.fetch=async()=>{throw new Error('refused');};
 await assert.rejects(uploadPDF('http://127.0.0.1:8787',new Uint8Array([1]),'x.pdf'),/run_app.py/);
 await assert.rejects(getSession('http://127.0.0.1:8787','a'.repeat(32)),e=>e.retry===true);
 await assert.rejects(getSession('http://127.0.0.1:8787','../etc'),/Invalid session/);
});
