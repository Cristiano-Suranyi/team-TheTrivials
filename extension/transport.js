import {MAX_PDF,SESSION_ID} from './config.js';

// Step 2a: read the PDF that is open in the tab (web or, with permission, file://).
export async function readPDF(source) {
  if (!/^(https?:|file:)\/\//.test(source)) throw new Error('This PDF cannot be reopened directly. Select its downloaded file in Hidden.');
  if (source.startsWith('file:')) {
    const allowed=await new Promise(resolve=>chrome.extension.isAllowedFileSchemeAccess(resolve));
    if (!allowed) throw new Error('Enable “Allow access to file URLs” for Hidden in chrome://extensions, then try again.');
  }
  let response;
  try { response=await fetch(source,{credentials:'include',signal:AbortSignal.timeout(60000)}); }
  catch { throw new Error('The PDF is inaccessible or the request was interrupted. Select its downloaded file in Hidden.'); }
  if (!response.ok) throw new Error('This PDF cannot be read with your current access. Open its downloaded file in Hidden.');
  const size=Number(response.headers.get('content-length'));
  if (size>MAX_PDF) throw new Error('PDFs must be at most 20 MB.');
  const parts=[];let total=0;const reader=response.body.getReader();
  try {while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>MAX_PDF)throw new Error('PDFs must be at most 20 MB.');parts.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  if (!new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-')) throw new Error('The opened resource is not a valid PDF.');
  return bytes;
}

async function errorMessage(response, fallback) {
  try { return (await response.json()).error || fallback; } catch { return fallback; }
}

// Step 2b: send the PDF to the Python backend, which starts the pipeline (step 3).
export async function uploadPDF(apiBase, bytes, name) {
  const form=new FormData();
  form.append('file',new Blob([bytes],{type:'application/pdf'}),name);
  let response;
  try { response=await fetch(`${apiBase}/api/public/sessions/upload`,{method:'POST',body:form,signal:AbortSignal.timeout(60000)}); }
  catch { throw new Error('Start python3 run_app.py, then try again. The PDF stays in this browser.'); }
  if (!response.ok) throw new Error(await errorMessage(response,'The local service rejected this PDF.'));
  const session=await response.json();
  if (!SESSION_ID.test(session?.session_id || '')) throw new Error('The local service returned an invalid session.');
  return session;
}

export async function getSession(apiBase, sessionId) {
  if (!SESSION_ID.test(sessionId)) throw new Error('Invalid session.');
  let response;
  try { response=await fetch(`${apiBase}/api/public/sessions/${sessionId}`,{signal:AbortSignal.timeout(15000)}); }
  catch { throw Object.assign(new Error('The local service stopped. Start python3 run_app.py.'),{retry:true}); }
  if (!response.ok) throw new Error(await errorMessage(response,'This review is no longer available.'));
  return response.json();
}

export async function checkSite(siteBase) {
  try { const site=await fetch(siteBase+'/',{signal:AbortSignal.timeout(5000)}); if(!site.ok)throw new Error(); }
  catch { throw new Error('Start python3 run_app.py, then try again. The PDF stays in this browser.'); }
}
