import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnonymizationWorkspace } from "./anonymization-workspace";
import * as extension from "@/lib/anonymize/extension-import";
import * as client from "@/lib/anonymize/client";
import type { SessionPayload } from "@/lib/anonymize/core";

const session: SessionPayload = {
  session_id: "test", file_name: "test.pdf", categories: ["Name"], status: "ready", stage: "Ready", progress: 100,
  expires_at: "2026-01-01", lines: [
    [{ id: 1, text: "Nome: " }, { id: 2, text: "Ana", category: "Name" }],
    [{ id: 3, text: "Outra pessoa: " }, { id: 4, text: "Ana", category: "Name" }],
  ],
};
const scroll = vi.fn();
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scroll });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const top = this.dataset["tokenId"] === "4" ? 600 : 0;
    return { top, bottom: top + 20, left: 0, right: 400, width: 400, height: 20, x: 0, y: top, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); scroll.mockClear(); });

describe("Review navigation", () => {
  it("navigates to the exact repeated occurrence in anonymized review", () => {
    const pageScroll = vi.spyOn(window, "scrollTo");
    const { container } = render(<AnonymizationWorkspace initialSession={session} />);
    scroll.mockClear();
    const rows = screen.getAllByRole("button", { name: /^Ana Name/ });
    fireEvent.click(rows[1]!);
    const target = container.querySelector('[data-token-id="4"]');
    expect(target?.getAttribute("data-active")).toBe("true");
    expect(container.querySelector('[data-token-id="2"]')?.getAttribute("data-active")).toBe("false");
    expect(target?.textContent).toBe("Ana");
    expect(target?.getAttribute("aria-pressed")).toBe("true");
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({top: 610}));
    expect(pageScroll).not.toHaveBeenCalled();
    // Clicking the already selected row must navigate again after manual scrolling.
    scroll.mockClear();
    fireEvent.click(rows[1]!);
    expect(scroll).toHaveBeenCalled();
  });
  it("discards one repeated suggestion, restores text and removes obsolete controls", () => {
    const { container } = render(<AnonymizationWorkspace initialSession={session} />);
    fireEvent.click(screen.getByRole("button", {name: "Remove suggestion 1"}));
    expect(screen.getAllByRole("button", {name: /^Ana Name/})).toHaveLength(1);
    expect(container.querySelector('[data-token-id="2"]')?.textContent).toBe("Ana");
    expect(container.querySelector('[data-token-id="4"]')?.textContent).toBe("Ana");
    expect(screen.getByRole("heading", {name: "Changes 1"})).toBeVisible();
    expect(screen.queryByRole("button", {name: "Report"})).toBeNull();
    expect(screen.queryByRole("button", {name: "Review original"})).toBeNull();
    expect(screen.queryByRole("button", {name: "Anonymized preview"})).toBeNull();
  });
  it("allows a discarded token to be masked again using manual selection", () => {
    const {container} = render(<AnonymizationWorkspace initialSession={session}/>);
    fireEvent.click(screen.getByRole("button", {name: "Remove suggestion 1"}));
    const element=container.querySelector('[data-token-id="2"]')!;
    const range=document.createRange(); range.selectNodeContents(element);
    Object.defineProperty(range,"getClientRects",{value:()=>[{top:10,left:10,right:50,width:40,height:20}]});
    Object.defineProperty(range,"getBoundingClientRect",{value:()=>({top:10,left:10,right:50,width:40,height:20})});
    const selection=window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    fireEvent.mouseUp(element);
    fireEvent.click(screen.getByRole("button",{name:/^Hide$/}));
    expect(screen.getByRole("button",{name:/^Ana Manual/})).toBeVisible();
    expect(container.querySelector('[data-token-id="100000"]')?.textContent).toBe("Ana");
    selection.removeAllRanges();
  });
  it("navigates after switching documents that reuse token IDs", async () => {
    vi.spyOn(client, "extractPdfLines").mockResolvedValue(["sample"]);
    vi.spyOn(client, "pdfFingerprint").mockResolvedValue("a".repeat(64));
    vi.spyOn(client, "createSession").mockImplementation(async (name) => ({ ...session, file_name: name, session_id: name,
      lines: [[{id: 1, text: "Nome: "}, {id: 2, text: name === "a.pdf" ? "Ana" : "Bruno", category: "Name"}]],
    }));
    const {container} = render(<AnonymizationWorkspace />);
    fireEvent.change(container.querySelector('input[type="file"]')!, {target: {files: [new File(["x"], "a.pdf", {type: "application/pdf"}), new File(["x"], "b.pdf", {type:"application/pdf"})]}});
    fireEvent.click(screen.getByRole("button", {name:"Anonymize document"}));
    await waitFor(() => expect(screen.getByRole("button", {name:"Download PDF"})).toBeVisible());
    fireEvent.click(screen.getByRole("button", {name:"b.pdf"}));
    fireEvent.click(screen.getByRole("button", {name:/^Bruno Name/}));
    expect(container.querySelector('[data-token-id="2"]')?.textContent).toBe("Bruno");
    expect(container.querySelector('[data-token-id="2"]')?.getAttribute("data-active")).toBe("true");
    expect(scroll).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Remove suggestion 1"}));
    expect(container.querySelector('[data-token-id="2"]')?.textContent).toBe("Bruno");
    fireEvent.click(screen.getByRole("button",{name:"a.pdf"}));
    expect(container.querySelector('[data-token-id="2"]')?.textContent).toBe("Ana");
    fireEvent.click(screen.getByRole("button",{name:"b.pdf"}));
    expect(container.querySelector('[data-token-id="2"]')?.textContent).toBe("Bruno");
    expect(screen.queryByRole("button",{name:/^Bruno Name/})).toBeNull();
  });

});

it("loads extension PDF at confirmation without starting detection", async () => {
  window.history.replaceState(null, "", "/#hidden-import=" + "a".repeat(64));
  vi.spyOn(extension, "importExtensionPdf").mockResolvedValue({file: new File(["%PDF-"], "extension.pdf", {type: "application/pdf"}), historyTicket: "b".repeat(64)});
  const create = vi.spyOn(client, "createSession");
  render(<AnonymizationWorkspace />);
  await waitFor(() => expect(screen.getByRole("button", {name: "Anonymize document"})).toBeVisible());
  expect(screen.getByText("extension.pdf")).toBeVisible();
  expect(create).not.toHaveBeenCalled();
  expect(window.location.hash).toBe("");
});

it("assesses context automatically without a purpose selector or early processing", async () => {
  vi.spyOn(client, "extractPdfLines").mockResolvedValue(["Nome: Ana", "Diagnóstico: diabetes"]);
  vi.spyOn(client, "pdfFingerprint").mockResolvedValue("a".repeat(64));
  const create = vi.spyOn(client, "createSession").mockResolvedValue(session);
  const {container} = render(<AnonymizationWorkspace />);
  fireEvent.change(container.querySelector('input[type="file"]')!, {target:{files:[new File(["%PDF-"],"clinical.pdf",{type:"application/pdf"})]}});
  expect(screen.queryByLabelText("Document purpose")).not.toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Anonymize document"}));
  await waitFor(() => expect(create).toHaveBeenCalled());
  expect(create.mock.calls[0]).toHaveLength(5);
});

it("reopens clinical review with medical text visible and identity selected", () => {
  const {container} = render(<AnonymizationWorkspace initialSession={{...session, context:{tema:"saude",preservar:[]}, lines:[
    [{id:1,text:"Nome: "},{id:2,text:"Ana",category:"Name"}],
    [{id:3,text:"Diagnóstico: diabetes. Prescrição: Losartana 50mg 1x/dia"}],
  ]}} />);
  expect(screen.queryByLabelText("Document purpose")).not.toBeInTheDocument();
  expect(container.querySelector('[data-token-id="3"]')?.textContent).toContain("Losartana 50mg 1x/dia");
  expect(container.querySelector('[data-token-id="3"]')?.getAttribute("aria-pressed")).toBeNull();
  expect(container.querySelector('[data-token-id="2"]')?.getAttribute("aria-pressed")).toBe("true");
});

it("downloads an extension review without asking for the original PDF again", async () => {
  const blob = new Blob(["%PDF-"], { type: "application/pdf" });
  const exportPdf = vi.spyOn(client, "exportPdf").mockResolvedValue(blob);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:test" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<AnonymizationWorkspace initialSession={{ ...session, has_pdf: true }} />);
  fireEvent.click(screen.getByRole("button", { name: /Download PDF/ }));
  await waitFor(() => expect(exportPdf).toHaveBeenCalled());
  expect(exportPdf.mock.calls[0]![0]).toBe("test");
  expect(exportPdf.mock.calls[0]![1]).toBeUndefined();
  expect(exportPdf.mock.calls[0]![2][0]).toEqual([{ text: "Nome: ", masked: false }, { text: "Ana", masked: true }]);
  await waitFor(() => expect(click).toHaveBeenCalled());
});
