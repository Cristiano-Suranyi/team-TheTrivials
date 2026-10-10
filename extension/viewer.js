import {readPDF,checkSite} from './transport.js';
import {CHUNK_SIZE,TRANSFER_TTL} from './config.js';
const id=location.hash.slice(1);
const status=document.getElementById('status');const retry=document.getElementById('retry');
let data=null;let busy=false;const expiry=Date.now()+TRANSFER_TTL;
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if (message?.type!=='read-pdf-chunk' || message.ticket!==id || sender.id!==chrome.runtime.id) return false;
  if (!data || Date.now()>=expiry || !Number.isInteger(message.offset) || message.offset<0 || message.offset>=data.length || message.offset%CHUNK_SIZE!==0) {reply({ok:false});return false;}
  const bytes=data.subarray(message.offset,Math.min(data.length,message.offset+CHUNK_SIZE));
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  reply({ok:true,offset:message.offset,data:btoa(binary)});return false;
});
setTimeout(()=>{data=null;status.textContent='The transfer expired. Open the PDF again from the extension.';retry.hidden=true;},TRANSFER_TTL);
async function request(message) {
  const result=await chrome.runtime.sendMessage(message);
  if (result?.ok===false) throw new Error(result.error || 'This PDF transfer is unavailable.');
  return result;
}

async function run(){
  if(busy||Date.now()>=expiry)return;busy=true;retry.hidden=true;
  try{
    status.textContent='Reading the opened PDF…';
    const meta=await request({type:'bridge-source'});
    if(!data)data=await readPDF(meta.source);
    status.textContent='Connecting to Hidden…';
    await checkSite(meta.siteBase);
    const digest=await crypto.subtle.digest('SHA-256',data);
    const sha256=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    await request({type:'bridge-ready',size:data.length,sha256});
    status.textContent='PDF ready. Continue in Hidden; this temporary page closes after the transfer.';
  }catch(error){status.textContent=error.message||'The PDF could not be imported.';retry.hidden=false;}
  finally{busy=false;}
}
retry.addEventListener('click',run);
document.getElementById('close').addEventListener('click',()=>window.close());
run();
