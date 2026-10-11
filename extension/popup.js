import {DEFAULTS,getSettings,localOrigin} from './config.js';
import {readPDF,uploadPDF} from './transport.js';

const $ = id => document.getElementById(id);
const views = ['empty','ask','working','ready','failed'];
let settings = await getSettings();
let current = null;
let busy = false;

const send = async message => {
  const result = await chrome.runtime.sendMessage(message);
  if (result?.ok === false) throw new Error(result.error);
  return result;
};

function show(view) {
  for (const name of views) $(name).hidden = name !== view;
  for (const el of document.querySelectorAll('.doc')) el.textContent = current?.name || '';
}

function render() {
  if (busy) return;
  const job = current?.job;
  if (!current) return show('empty');
  if (!job) return show('ask');
  if (job.status === 'ready') return show('ready');
  if (job.status === 'failed') { $('error').textContent = job.error || 'The document could not be processed.'; return show('failed'); }
  $('stage').textContent = job.stage || 'Processing…';
  $('bar').style.width = `${Math.max(5, job.progress || 5)}%`;
  show('working');
}

async function refresh() {
  try { current = await send({type:'active-pdf'}); } catch { current = null; }
  render();
}

// Step 2: Yes -> read the PDF and send it to the backend.
async function start() {
  if (!current || busy) return;
  busy = true; show('working');
  try {
    $('stage').textContent = 'Reading the PDF…'; $('bar').style.width = '3%';
    const bytes = await readPDF(current.url);
    $('stage').textContent = 'Sending to the local service…'; $('bar').style.width = '5%';
    const session = await uploadPDF(settings.apiBase, bytes, current.name);
    await send({type:'track', sessionId: session.session_id, expiresAt: session.expires_at});
  } catch (error) {
    busy = false;
    $('error').textContent = error.message || 'The PDF could not be sent.';
    show('failed');
    return;
  }
  busy = false;
  await refresh();
}

$('yes').addEventListener('click', start);
$('no').addEventListener('click', async () => { await send({type:'dismiss'}).catch(()=>{}); window.close(); });
$('retry').addEventListener('click', async () => { if (current?.job) await send({type:'reset'}).catch(()=>{}); await refresh(); start(); });
$('again').addEventListener('click', async () => { await send({type:'reset'}).catch(()=>{}); await refresh(); });
$('download').addEventListener('click', async () => {
  try { await send({type:'download'}); window.close(); }
  catch (error) { $('error').textContent = error.message; show('failed'); }
});
$('review').addEventListener('click', async () => {
  try { await send({type:'review'}); window.close(); }
  catch (error) { $('error').textContent = error.message; show('failed'); }
});

// Live progress while the popup is open.
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes.jobs) refresh(); });

// Settings and recent reviews.
$('service').value = settings.siteBase; $('manual').href = settings.siteBase + '/';
$('auto').setAttribute('aria-checked', String(settings.autoPrompt));
$('auto').addEventListener('click', async () => { const value = $('auto').getAttribute('aria-checked') !== 'true'; await chrome.storage.local.set({autoPrompt:value}); $('auto').setAttribute('aria-checked', String(value)); });
$('save').addEventListener('click', async () => { try { const value = localOrigin($('service').value); await chrome.storage.local.set({apiBase:value,siteBase:value}); settings = await getSettings(); $('manual').href = settings.siteBase + '/'; $('saved').textContent = 'Settings saved.'; } catch (error) { $('saved').textContent = error.message; } });
$('restore').addEventListener('click', async () => { await chrome.storage.local.set({apiBase:DEFAULTS.apiBase,siteBase:DEFAULTS.siteBase}); settings = await getSettings(); $('service').value = settings.siteBase; $('manual').href = settings.siteBase + '/'; });

const {sessions=[]} = await chrome.storage.local.get('sessions');
const live = sessions.filter(s => /^[A-Za-z0-9_-]{24,64}$/.test(s.id) && typeof s.name === 'string' && Date.parse(s.expires_at) > Date.now()).slice(0,10);
await chrome.storage.local.set({sessions: live});
if (!live.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'No documents yet'; $('sessions').append(li); }
for (const session of live) { const li = document.createElement('li'); const name = document.createElement('span'); name.className = 'name'; name.textContent = session.name; const link = document.createElement('a'); link.textContent = 'Review'; link.href = `${settings.siteBase}/review/${session.id}`; link.target = '_blank'; link.rel = 'noopener'; li.append(name, link); $('sessions').append(li); }

await refresh();
