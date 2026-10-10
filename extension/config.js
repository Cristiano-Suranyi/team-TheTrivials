export const DEFAULTS = { apiBase: 'http://127.0.0.1:8787', siteBase: 'http://127.0.0.1:8787', autoPrompt: true };
export const MAX_PDF = 20 * 1024 * 1024;
export const CHUNK_SIZE = 192 * 1024;
export const TRANSFER_TTL = 10 * 60 * 1000;
export function localOrigin(value) {
  const url = new URL(String(value).trim());
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw new Error('Use a local address such as http://127.0.0.1:8787.');
  return url.origin;
}
export async function getSettings() {
  const stored = await chrome.storage.local.get(['apiBase','siteBase','autoPrompt']);
  try {
    const siteBase = localOrigin(stored.siteBase || DEFAULTS.siteBase);
    const apiBase = localOrigin(stored.apiBase || siteBase);
    if (siteBase !== apiBase) throw new Error('The site and API must use the same local address.');
    return {siteBase,apiBase,autoPrompt:stored.autoPrompt !== false};
  } catch { return {...DEFAULTS,autoPrompt:stored.autoPrompt !== false}; }
}
export function pdfName(url, disposition = '') {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const quoted = /filename="([^"]+)"/i.exec(disposition)?.[1];
  let name = encoded || quoted || new URL(url).pathname.split('/').pop() || 'document.pdf';
  try { name = decodeURIComponent(name); } catch {}
  name = name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,180);
  return /\.pdf$/i.test(name) ? name : `${name || 'document'}.pdf`;
}
export const pdfURL = value => /^(https?:|file:)\/\//i.test(value || '') && /\.pdf(?:[?#]|$)/i.test(value);
export const ticket = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
