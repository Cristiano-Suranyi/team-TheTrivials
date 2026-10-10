import {getSettings,pdfName,pdfURL,MAX_PDF,CHUNK_SIZE,TRANSFER_TTL,ticket} from './config.js';
const bridgeURL = chrome.runtime.getURL('viewer.html');
const popupURL = chrome.runtime.getURL('popup.html');
let pending = Promise.resolve();
const serial = task => { const run = pending.then(task); pending = run.catch(()=>{}); return run; };
const load = async key => (await chrome.storage.session.get(key))[key] || {};
const save = (key,value) => chrome.storage.session.set({[key]:value});
// Metadata only. Original bytes live exclusively in the temporary extension page.
async function recordPDF(tabId,url,name) {
  const all = await load('pdfTabs');
  if (all[tabId]?.url !== url) all[tabId] = {url,name,prompted:false};
  await save('pdfTabs',all);
  await chrome.action.setBadgeText({tabId,text:'PDF'});
}
async function offer(tabId) {
  const all = await load('pdfTabs'); const candidate = all[tabId];
  if (!candidate || candidate.prompted || !(await getSettings()).autoPrompt) return;
  const tab = await chrome.tabs.get(tabId).catch(()=>null);
  if (!tab?.active || tab.status !== 'complete' || tab.url !== candidate.url) return;
  const window = await chrome.windows.get(tab.windowId);
  if (!window.focused) return;
  candidate.prompted = true; await save('pdfTabs',all);
  try { await chrome.action.openPopup({windowId:tab.windowId}); } catch { /* Badge remains available. */ }
}
chrome.webRequest.onHeadersReceived.addListener(details => serial(async () => {
  if (details.tabId < 0 || details.method !== 'GET') return;
  const header = name => details.responseHeaders?.find(h=>h.name.toLowerCase()===name)?.value || '';
  if (!/application\/pdf/i.test(header('content-type')) || /attachment/i.test(header('content-disposition'))) return;
  await recordPDF(details.tabId,details.url,pdfName(details.url,header('content-disposition')));
}), {urls:['http://*/*','https://*/*'],types:['main_frame']}, ['responseHeaders']);
chrome.webNavigation.onCommitted.addListener(details => serial(async () => {
  if (details.frameId !== 0) return;
  const all = await load('pdfTabs');
  if (all[details.tabId]?.url !== details.url) { delete all[details.tabId]; await save('pdfTabs',all); await chrome.action.setBadgeText({tabId:details.tabId,text:''}); }
  if (pdfURL(details.url)) await recordPDF(details.tabId,details.url,pdfName(details.url));
}));
chrome.tabs.onUpdated.addListener((id,change,tab) => serial(async () => {
  if (change.status !== 'complete') return;
  if (pdfURL(tab.url)) await recordPDF(id,tab.url,pdfName(tab.url));
  await offer(id);
}));
chrome.tabs.onActivated.addListener(({tabId}) => serial(()=>offer(tabId)));
async function removeTransfers(predicate) {
  const flights = await load('transfers');
  const close = [];
  for (const [key,entry] of Object.entries(flights)) {
    if (!predicate(entry)) continue;
    delete flights[key];
    if (entry.bridgeTabId) close.push(entry.bridgeTabId);
  }
  await save('transfers',flights);
  for (const id of close) await chrome.tabs.remove(id).catch(()=>{});
}
chrome.tabs.onRemoved.addListener(id => serial(async () => {
  const all = await load('pdfTabs'); delete all[id]; await save('pdfTabs',all);
  await removeTransfers(e=>e.siteTabId===id || e.bridgeTabId===id);
}));
chrome.alarms.create('expire-imports',{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(alarm => serial(async () => { if (alarm.name==='expire-imports') await removeTransfers(e=>e.expiresAt<=Date.now()); }));

export async function internal(message,sender) {
  const url = sender.url || '';
  if (url === popupURL) {
    if (message.type === 'active-pdf') {
      const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
      const candidate = tab ? (await load('pdfTabs'))[tab.id] : null;
      if (candidate?.url===tab?.url) return {...candidate,tabId:tab.id};
      return pdfURL(tab?.url) ? {url:tab.url,name:pdfName(tab.url),tabId:tab.id} : null;
    }
    if (message.type === 'open-hidden') {
      const candidate = await internal({type:'active-pdf'},sender);
      if (!candidate) throw new Error('Open a PDF in the active tab first.');
      const id = ticket(); const flights=await load('transfers');
      flights[id]={source:candidate.url,name:candidate.name,expiresAt:Date.now()+TRANSFER_TTL,siteBase:(await getSettings()).siteBase};
      await save('transfers',flights);
      const bridge = await chrome.tabs.create({url:`${bridgeURL}#${id}`,active:true});
      const latest=await load('transfers'); latest[id].bridgeTabId=bridge.id; await save('transfers',latest);
      return {ok:true};
    }
  }
  if (url.startsWith(`${bridgeURL}#`) && sender.tab?.id) {
    const id=url.slice(bridgeURL.length+1);const flights=await load('transfers'); const entry=flights[id];
    if (!entry || entry.expiresAt<=Date.now() || entry.bridgeTabId!==sender.tab.id) throw new Error('This PDF transfer has expired. Open it again from the extension.');
    if (message.type==='bridge-source') return {source:entry.source,name:entry.name,siteBase:entry.siteBase};
    if (message.type==='bridge-ready') {
      if (!Number.isInteger(message.size) || message.size<=0 || message.size>MAX_PDF || !/^[a-f0-9]{64}$/.test(message.sha256)) throw new Error('Invalid PDF transfer.');
      if (entry.siteTabId) return {ok:true};
      entry.size=message.size;entry.sha256=message.sha256;
      const target=await chrome.tabs.create({url:`${entry.siteBase}/#hidden-import=${id}`,active:true});
      entry.siteTabId=target.id;delete entry.source;
      const latest=await load('transfers');latest[id]=entry;await save('transfers',latest);
      return {ok:true};
    }
  }
  throw new Error('Unsupported extension request.');
}
export async function external(message,sender) {
  const flights=await load('transfers');const entry=flights[message.ticket];
  if (!entry || entry.expiresAt<=Date.now() || sender.tab?.id!==entry.siteTabId || new URL(sender.url).origin!==entry.siteBase || new URL(sender.url).pathname!=='/') throw new Error('This PDF transfer is unavailable or expired. Open the PDF again from the extension.');
  if (message.type==='hidden-history' && entry.history) {
    const s=message.session;
    if (!s || !/^[A-Za-z0-9_-]{24,64}$/.test(s.session_id) || typeof s.file_name!=='string' || !Number.isFinite(Date.parse(s.expires_at)) || Date.parse(s.expires_at)<=Date.now() || Date.parse(s.expires_at)>Date.now()+61*60*1000) throw new Error('Invalid review metadata.');
    const stored=await chrome.storage.local.get('sessions');
    const live=(stored.sessions||[]).filter(s=>s.id!==message.session.session_id && Date.parse(s.expires_at)>Date.now());
    await chrome.storage.local.set({sessions:[{id:s.session_id,name:s.file_name.slice(0,200),expires_at:s.expires_at},...live].slice(0,10)});
    return {ok:true};
  }
  if (entry.history || !entry.bridgeTabId) throw new Error('This PDF transfer was already consumed.');
  if (message.type==='hidden-import-meta') return {ok:true,name:entry.name,size:entry.size,sha256:entry.sha256,chunkSize:CHUNK_SIZE};
  if (message.type==='hidden-import-chunk') {
    if (!Number.isInteger(message.offset) || message.offset<0 || message.offset>=entry.size || message.offset%CHUNK_SIZE!==0) throw new Error('Invalid PDF chunk.');
    // Extension pages receive runtime messages, not tabs.sendMessage/content scripts.
    const chunk=await chrome.runtime.sendMessage({type:'read-pdf-chunk',ticket:message.ticket,offset:message.offset});
    if (!chunk?.ok) throw new Error('The PDF window was closed. Open it again from the extension.');
    return chunk;
  }
  if (message.type==='hidden-import-done') {
    const historyTicket=ticket();
    delete flights[message.ticket];
    flights[historyTicket]={siteBase:entry.siteBase,siteTabId:entry.siteTabId,history:true,expiresAt:Date.now()+60*60*1000};
    await save('transfers',flights);
    await chrome.tabs.remove(entry.bridgeTabId).catch(()=>{});
    return {ok:true,historyTicket};
  }
  throw new Error('Unsupported transfer request.');
}
const respond = handler => (message,sender,reply) => {
  if (message?.type==='read-pdf-chunk') return false;
  serial(()=>handler(message||{},sender)).then(value=>reply(value),error=>reply({ok:false,error:error.message||'Extension request failed.'}));
  return true;
};
chrome.runtime.onMessage.addListener(respond(internal));
chrome.runtime.onMessageExternal.addListener(respond(external));
