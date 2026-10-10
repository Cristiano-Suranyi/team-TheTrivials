import type { Category, RenderSegment, SessionPayload } from "./core";
export const apiBase = () => (import.meta.env["VITE_ANONYMIZE_API_URL"] as string | undefined) ?? "";

/** The PDF stays in the browser. Only extracted lines reach the Python service. */
export async function extractPdfLines(file: Blob): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const out: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let line = "";
      let previous: { x: number; y: number; height: number } | undefined;
      const flush = () => { if (line.trim()) out.push(line.trimEnd()); line = ""; previous = undefined; };
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const x = item.transform[4] ?? 0, y = item.transform[5] ?? 0;
        if (previous && Math.abs(y - previous.y) > Math.max(2, previous.height * 0.5)) flush();
        if (previous && line && !/\s$/.test(line) && !/^\s/.test(item.str) && x - previous.x > Math.max(1, item.height * 0.15)) line += " ";
        line += item.str;
        previous = { x: x + item.width, y, height: item.height };
        if (item.hasEOL) flush();
      }
      flush();
      page.cleanup();
    }
    return out;
  } finally { await doc.destroy(); }
}
export class SessionError extends Error {
  constructor(public code: "not_found" | "expired" | "failed", message: string) { super(message); }
}
async function handle<T>(res: Response): Promise<T> {
  if (res.ok) return await res.json() as T;
  if (res.status === 404) throw new SessionError("not_found", "This review doesn't exist or the server restarted.");
  if (res.status === 410) throw new SessionError("expired", "This review has expired. Open the PDF again.");
  const body = await res.json().catch(() => ({})) as { error?: string };
  throw new SessionError("failed", body.error ?? "The service couldn't complete this request.");
}
async function request(path: string, init?: RequestInit) {
  try { return await fetch(`${apiBase()}${path}`, { ...init, signal: AbortSignal.timeout(30000) }); }
  catch { throw new SessionError("failed", "Can't reach the Python service. Start python run_app.py and try again."); }
}
export const getSession = async (id: string) => handle<SessionPayload>(await request(`/api/public/sessions/${encodeURIComponent(id)}`));
export async function waitForSession(session: SessionPayload, onProgress?: (session: SessionPayload) => void) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (true) {
    onProgress?.(session);
    if (session.status === "ready") return session;
    if (session.status === "failed") throw new SessionError("failed", session.error ?? "Processing failed. Try again.");
    if (Date.now() > deadline) throw new SessionError("failed", `Processing is taking longer than expected. Resume at /review/${session.session_id}`);
    await new Promise(resolve => setTimeout(resolve, 750));
    session = await getSession(session.session_id);
  }
}
export async function createSession(fileName: string, lines: string[], categories: Category[], onProgress?: (session: SessionPayload) => void, pdfSha256?: string) {
  const session = await handle<SessionPayload>(await request("/api/public/sessions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_name: fileName, lines, categories, pdf_sha256: pdfSha256 }),
  }));
  return waitForSession(session, onProgress);
}
export const deleteSession = async (id: string) => request(`/api/public/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
export async function renderSession(id: string, lines: RenderSegment[][]) {
  return handle<{ file_name: string; text: string; report: string }>(await request(`/api/public/sessions/${encodeURIComponent(id)}/render`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }),
  }));
}

/** Original bytes reach only the local export service, never Gemini. */
export async function exportPdf(id: string, file: File, lines: RenderSegment[][]) {
  const form = new FormData();
  form.append("file", file);
  form.append("review", JSON.stringify({ lines }));
  const response = await request(`/api/public/sessions/${encodeURIComponent(id)}/export/pdf`, { method: "POST", body: form });
  if (!response.ok) await handle(response);
  return response.blob();
}
export async function pdfFingerprint(file: File) {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
