import type { SessionPayload } from './core';

export const EXTENSION_ID = 'lfnbhbifaakkolphooipdoinpknmacnf';
const LIMIT = 20 * 1024 * 1024;
const CHUNK = 192 * 1024;
type Runtime = { lastError?: { message?: string }; sendMessage: (id: string, message: unknown, callback: (value: any) => void) => void };
function request(message: unknown): Promise<any> {
  const runtime = (window as unknown as { chrome?: { runtime?: Runtime } }).chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.reject(new Error('A extensão Hidden não está disponível. Abre este site no Chrome com a extensão instalada, ou seleciona o PDF.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('A transferência foi interrompida. Abre novamente o PDF pela extensão.')), 10000);
    try {
      runtime.sendMessage(EXTENSION_ID, message, result => {
        clearTimeout(timer);
        if (runtime.lastError || result?.ok !== true) reject(new Error(result?.error || runtime.lastError?.message || 'A transferência expirou. Abre novamente o PDF pela extensão.'));
        else resolve(result);
      });
    } catch (error) { clearTimeout(timer); reject(error); }
  });
}
export async function importExtensionPdf(ticket: string): Promise<{ file: File; historyTicket: string }> {
  if (!/^[a-f0-9]{64}$/.test(ticket)) throw new Error('Identificador de transferência inválido.');
  // A newly opened site tab may start before its ID is persisted by the worker.
  let meta: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { meta = await request({ type: 'hidden-import-meta', ticket }); break; }
    catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 300)); }
  }
  if (!Number.isInteger(meta.size) || meta.size <= 0 || meta.size > LIMIT || meta.chunkSize !== CHUNK || !/^[a-f0-9]{64}$/.test(meta.sha256) || typeof meta.name !== 'string' || meta.name.length > 200) throw new Error('Metadados do PDF inválidos.');
  const bytes = new Uint8Array(meta.size);
  for (let offset = 0; offset < meta.size; offset += CHUNK) {
    const part = await request({ type: 'hidden-import-chunk', ticket, offset });
    if (part.offset !== offset || typeof part.data !== 'string' || part.data.length > CHUNK * 2) throw new Error('Bloco do PDF inválido.');
    const binary = atob(part.data);
    if (binary.length !== Math.min(CHUNK, meta.size - offset)) throw new Error('Transferência incompleta do PDF.');
    for (let i = 0; i < binary.length; i++) bytes[offset + i] = binary.charCodeAt(i);
  }
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw new Error('O ficheiro não é um PDF válido.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== meta.sha256) throw new Error('A identidade do PDF não corresponde. Abre-o novamente pela extensão.');
  const done = await request({ type: 'hidden-import-done', ticket });
  if (!/^[a-f0-9]{64}$/.test(done.historyTicket)) throw new Error('Confirmação da transferência inválida.');
  return { file: new File([bytes], meta.name, { type: 'application/pdf' }), historyTicket: done.historyTicket };
}
export async function rememberExtensionReview(ticket: string, session: SessionPayload): Promise<void> {
  await request({ type: 'hidden-history', ticket, session: { session_id: session.session_id, file_name: session.file_name, expires_at: session.expires_at } });
}
