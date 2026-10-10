import { afterEach, describe, expect, it, vi } from "vitest";
import { createSession, getSession, renderSession } from "./client";
import { maskText, type SessionPayload } from "./core";
const session: SessionPayload = {
  session_id: "abc", file_name: "test.pdf", categories: ["Health"], lines: [],
  expires_at: "2026-01-01T00:00:00Z", status: "ready", stage: "Ready", progress: 100,
};
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("Python session integration", () => {
  it("waits for real processing and reports its progress", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ ...session, status: "queued", progress: 5 }))
      .mockResolvedValueOnce(Response.json({ ...session, status: "processing", progress: 60 }))
      .mockResolvedValueOnce(Response.json(session));
    vi.stubGlobal("fetch", fetcher);
    const progress = vi.fn();
    const pending = createSession("test.pdf", ["Diagnosis: diabetes"], ["Health"], progress);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(session);
    expect(progress.mock.calls.map(([s]) => s.progress)).toEqual([5, 60, 100]);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).lines).toEqual(["Diagnosis: diabetes"]);
  });
  it("does not return partial results on a failed job", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...session, status: "failed", error: "Quota exhausted" })));
    await expect(createSession("test.pdf", ["text"], ["Health"])).rejects.toThrow("Quota exhausted");
  });
  it("keeps expiration errors actionable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status: 410 })));
    await expect(getSession("abc")).rejects.toThrow("expired");
  });
  it("exports the current review choices including manual splits", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ text: "* visible", report: "report" }));
    vi.stubGlobal("fetch", fetcher);
    const lines = [[{ text: "hidden ", masked: true }, { text: "visible", masked: false }]];
    expect((await renderSession("abc", lines)).text).toBe("* visible");
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).lines).toEqual(lines);
    expect(maskText(" Ana  Correia\t")).toBe(" *  *\t");
  });
});
