// Hidden background worker.
// 1. Detect PDFs and offer "Anonymize this document?" (popup).
// 3-4. Follow the backend job and, when ready, offer Download / Review.
// 5a. Download the masked PDF.  5b. Open the review page.
import {getSettings,pdfName,pdfURL,POLL_MS,SESSION_ID} from './config.js';
import {getSession} from './transport.js';

let pending = Promise.resolve();
const serial = task => { const run = pending.then(task); pending = run.catch(()=>{}); return run; };
const load = async key => (await chrome.storage.session.get(key))[key] || {};
const save = (key,value) => chrome.storage.session.set({[key]:value});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const polling = new Map();

async function badge(tabId, text, color) {
  await chrome.action.setBadgeText({tabId,text}).catch(()=>{});
  if (color) await chrome.action.setBadgeBackgroundColor?.({tabId,color}).catch(()=>{});
}

// ---------------------------------------------------------------- step 1
async function recordPDF(tabId,url,name) {
  const all = await load('pdfTabs');
  if (all[tabId]?.url !== url) all[tabId] = {url,name,prompted:false};
  await save('pdfTabs',all);
  const job = (await load('jobs'))[tabId];
  if (!job || job.url !== url) await badge(tabId,'PDF','#0a66d8');
}

async function openPopupFor(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(()=>null);
  if (!tab?.active) return false;
  const window = await chrome.windows.get(tab.windowId).catch(()=>null);
  if (!window?.focused) return false;
  try { await chrome.action.openPopup({windowId:tab.windowId}); return true; }
  catch { return false; /* The badge stays as a fallback. */ }
}

async function offer(tabId) {
  const all = await load('pdfTabs'); const candidate = all[tabId];
  if (!candidate || candidate.prompted || !(await getSettings()).autoPrompt) return;
  const tab = await chrome.tabs.get(tabId).catch(()=>null);
  if (!tab?.active || tab.status !== 'complete' || tab.url !== candidate.url) return;
  if (await openPopupFor(tabId)) { candidate.prompted = true; await save('pdfTabs',all); }
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
  if (all[details.tabId] && all[details.tabId].url !== details.url) {
    delete all[details.tabId]; await save('pdfTabs',all); await badge(details.tabId,'');
  }
  if (pdfURL(details.url)) await recordPDF(details.tabId,details.url,pdfName(details.url));
}));

chrome.tabs.onUpdated.addListener((id,change,tab) => serial(async () => {
  if (change.status !== 'complete') return;
  if (pdfURL(tab.url)) await recordPDF(id,tab.url,pdfName(tab.url));
  await offer(id);
}));
chrome.tabs.onActivated.addListener(({tabId}) => serial(()=>offer(tabId)));
chrome.tabs.onRemoved.addListener(id => serial(async () => {
  const all = await load('pdfTabs'); delete all[id]; await save('pdfTabs',all);
  const jobs = await load('jobs'); delete jobs[id]; await save('jobs',jobs);
}));

// -------------------------------------------------------------- steps 3-4
async function setJob(tabId, values) {
  return serial(async () => {
    const jobs = await load('jobs');
    if (!jobs[tabId]) return null;
    jobs[tabId] = {...jobs[tabId], ...values, updatedAt: Date.now()};
    await save('jobs', jobs);
    return jobs[tabId];
  });
}

export function follow(tabId) {
  if (!polling.has(tabId)) polling.set(tabId, poll(tabId).finally(() => polling.delete(tabId)));
  return polling.get(tabId);
}

async function poll(tabId) {
  {
    let failures = 0;
    while (true) {
      const job = (await load('jobs'))[tabId];
      if (!job || job.status === 'ready' || job.status === 'failed') return;
      const {apiBase} = await getSettings();
      try {
        const session = await getSession(apiBase, job.sessionId);
        failures = 0;
        await setJob(tabId, {status: session.status, stage: session.stage, progress: session.progress,
                             error: session.error || '', expiresAt: session.expires_at});
        if (session.status === 'ready') {
          await badge(tabId, '✓', '#1f8a4c');
          await openPopupFor(tabId); // Step 4: show [Download] / [Review].
          return;
        }
        if (session.status === 'failed') { await badge(tabId, '!', '#c4302b'); return; }
        await badge(tabId, `${Math.max(1, Math.min(99, session.progress || 1))}%`, '#6e6e73');
      } catch (error) {
        if (!error.retry || ++failures >= 5) {
          await setJob(tabId, {status: 'failed', error: error.message});
          await badge(tabId, '!', '#c4302b');
          return;
        }
      }
      await sleep(POLL_MS);
    }
  }
}

async function rememberReview(job) {
  const {sessions=[]} = await chrome.storage.local.get('sessions');
  const live = sessions.filter(s => s.id !== job.sessionId && Date.parse(s.expires_at) > Date.now());
  await chrome.storage.local.set({sessions: [{id: job.sessionId, name: job.name.slice(0,200), expires_at: job.expiresAt}, ...live].slice(0,10)});
}

// Resume jobs after the worker was suspended.
async function resume() {
  const jobs = await load('jobs');
  for (const [tabId, job] of Object.entries(jobs))
    if (job.status === 'queued' || job.status === 'processing') follow(Number(tabId));
}
chrome.alarms.create('resume-jobs',{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'resume-jobs') resume(); });
resume();

// ------------------------------------------------------- popup messages
const popupURL = chrome.runtime.getURL('popup.html');

async function activePDF() {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (!tab) return null;
  const candidate = (await load('pdfTabs'))[tab.id];
  const job = (await load('jobs'))[tab.id] || null;
  if (candidate?.url === tab.url) return {...candidate, tabId: tab.id, job};
  if (pdfURL(tab.url)) return {url: tab.url, name: pdfName(tab.url), tabId: tab.id, job};
  return job ? {url: job.url, name: job.name, tabId: tab.id, job} : null;
}

export async function handle(message, sender) {
  if (sender.url !== popupURL && !sender.url?.startsWith(popupURL + '?')) throw new Error('Unsupported request.');
  const current = await activePDF();
  if (message.type === 'active-pdf') return current;
  if (!current) throw new Error('Open a PDF in the active tab first.');
  const tabId = current.tabId;
  if (message.type === 'dismiss') {
    const all = await load('pdfTabs'); if (all[tabId]) { all[tabId].prompted = true; await save('pdfTabs', all); }
    return {ok: true};
  }
  if (message.type === 'track') {
    if (!SESSION_ID.test(message.sessionId || '')) throw new Error('Invalid session.');
    const job = {sessionId: message.sessionId, url: current.url, name: current.name, status: 'queued',
                 stage: 'Waiting for the document processor', progress: 5, error: '',
                 expiresAt: message.expiresAt || new Date(Date.now()+3600000).toISOString()};
    await serial(async () => { const jobs = await load('jobs'); jobs[tabId] = job; await save('jobs', jobs); });
    await rememberReview(job);
    follow(tabId);
    return {ok: true};
  }
  if (message.type === 'reset') {
    await serial(async () => { const jobs = await load('jobs'); delete jobs[tabId]; await save('jobs', jobs); });
    await badge(tabId, 'PDF', '#0a66d8');
    return {ok: true};
  }
  const job = current.job;
  if (!job || job.status !== 'ready') throw new Error('The document is not ready yet.');
  const {apiBase, siteBase} = await getSettings();
  if (message.type === 'download') {
    // Step 5a: masked output from the backend, saved by Chrome.
    const base = job.name.replace(/\.pdf$/i, '') || 'document';
    await chrome.downloads.download({url: `${apiBase}/api/public/sessions/${job.sessionId}/masked.pdf`,
                                     filename: `${base}-anonymized.pdf`, conflictAction: 'uniquify'});
    return {ok: true};
  }
  if (message.type === 'review') {
    // Step 5b: review UI on the local site.
    await chrome.tabs.create({url: `${siteBase}/review/${job.sessionId}`, active: true});
    return {ok: true};
  }
  throw new Error('Unsupported request.');
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  handle(message || {}, sender).then(reply, error => reply({ok:false, error: error.message || 'Extension request failed.'}));
  return true;
});
