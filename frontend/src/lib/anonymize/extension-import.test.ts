import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { importExtensionPdf, rememberExtensionReview, EXTENSION_ID } from './extension-import';
const ticket = 'a'.repeat(64);
const bytes = new TextEncoder().encode('%PDF-1.7\nsample');
async function mockBridge(corrupt = false) {
  const digest = await webcrypto.subtle.digest('SHA-256', bytes);
  const hash = Buffer.from(digest).toString('hex');
  const sendMessage = vi.fn((_id, message, callback) => {
    const results: Record<string, unknown> = {
      'hidden-import-meta': { ok: true, name: 'sample.pdf', size: bytes.length, chunkSize: 192 * 1024, sha256: corrupt ? 'b'.repeat(64) : hash },
      'hidden-import-chunk': { ok: true, offset: 0, data: Buffer.from(bytes).toString('base64') },
      'hidden-import-done': { ok: true, historyTicket: 'c'.repeat(64) },
      'hidden-history': { ok: true },
    };
    callback(results[message.type]);
  });
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(window, 'chrome', { configurable: true, value: { runtime: { sendMessage } } });
  return sendMessage;
}
afterEach(() => { vi.unstubAllGlobals(); delete (window as any).chrome; });
it('reconstructs the verified PDF and consumes its transfer without API calls', async () => {
  const send = await mockBridge();
  const fetch = vi.spyOn(globalThis, 'fetch');
  const result = await importExtensionPdf(ticket);
  expect(result.file.name).toBe('sample.pdf');
  expect(result.file.size).toBe(bytes.length);
  expect(result.historyTicket).toBe('c'.repeat(64));
  expect(send.mock.calls.map(c => c[1].type)).toEqual(['hidden-import-meta', 'hidden-import-chunk', 'hidden-import-done']);
  expect(send.mock.calls.every(c => c[0] === EXTENSION_ID)).toBe(true);
  expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
});
it('rejects corrupted bytes before consuming the transfer', async () => {
  const send = await mockBridge(true);
  await expect(importExtensionPdf(ticket)).rejects.toThrow('identidade');
  expect(send.mock.calls.some(c => c[1].type === 'hidden-import-done')).toBe(false);
});
it('rejects invalid tickets without contacting the extension', async () => {
  const send = await mockBridge();
  await expect(importExtensionPdf('bad')).rejects.toThrow('inválido');
  expect(send).not.toHaveBeenCalled();
});
it('only sends review metadata to extension history', async () => {
  const send = await mockBridge();
  await rememberExtensionReview(ticket, {session_id:'s',file_name:'sample.pdf',expires_at:'date',lines:[[{id:1,text:'private'}]]} as any);
  expect(send.mock.calls[0]![1].session).toEqual({session_id:'s',file_name:'sample.pdf',expires_at:'date'});
});
