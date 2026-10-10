import {DEFAULTS,getSettings,localOrigin} from './config.js';
const $=id=>document.getElementById(id);let settings=await getSettings();
$('service').value=settings.siteBase;$('manual').href=settings.siteBase+'/';$('auto').setAttribute('aria-checked',String(settings.autoPrompt));
$('auto').addEventListener('click',async()=>{const value=$('auto').getAttribute('aria-checked')!=='true';await chrome.storage.local.set({autoPrompt:value});$('auto').setAttribute('aria-checked',String(value));});
$('save').addEventListener('click',async()=>{try{const value=localOrigin($('service').value);await chrome.storage.local.set({apiBase:value,siteBase:value});settings=await getSettings();$('manual').href=settings.siteBase+'/';$('error').textContent='Settings saved.';}catch(error){$('error').textContent=error.message;}});
$('restore').addEventListener('click',async()=>{await chrome.storage.local.set({apiBase:DEFAULTS.apiBase,siteBase:DEFAULTS.siteBase});settings=await getSettings();$('service').value=settings.siteBase;$('manual').href=settings.siteBase+'/';});
try{
  const current=await chrome.runtime.sendMessage({type:'active-pdf'});
  if(current?.url){$('document').textContent=current.name;$('now').hidden=false;}
}catch{$('error').textContent='The PDF detector is unavailable. Reload the extension.';}
$('now').addEventListener('click',async()=>{try{$('now').disabled=true;const result=await chrome.runtime.sendMessage({type:'open-hidden'});if(!result?.ok)throw new Error(result?.error||'Could not open Hidden.');window.close();}catch(error){$('error').textContent=error.message;$('now').disabled=false;}});
const {sessions=[]}=await chrome.storage.local.get('sessions');const live=sessions.filter(s=>/^[A-Za-z0-9_-]{24,64}$/.test(s.id) && typeof s.name==='string' && Date.parse(s.expires_at)>Date.now()).slice(0,10);
await chrome.storage.local.set({sessions:live});
if(!live.length){const li=document.createElement('li');li.className='muted';li.textContent='No documents yet';$('sessions').append(li);}
for(const session of live){const li=document.createElement('li');const name=document.createElement('span');name.className='name';name.textContent=session.name;const link=document.createElement('a');link.textContent='Review';link.href=`${settings.siteBase}/review/${session.id}`;link.target='_blank';link.rel='noopener';li.append(name,link);$('sessions').append(li);}
