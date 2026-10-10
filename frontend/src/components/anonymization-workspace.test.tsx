import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnonymizationWorkspace } from "./anonymization-workspace";
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
    expect(target?.textContent).toBe("*");
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
    expect(container.querySelector('[data-token-id="4"]')?.textContent).toBe("*");
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
    expect(container.querySelector('[data-token-id="100000"]')?.textContent).toBe("*");
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
    expect(container.querySelector('[data-token-id="2"]')?.textContent).toBe("*");
    expect(container.querySelector('[data-token-id="2"]')?.getAttribute("data-active")).toBe("true");
    expect(scroll).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Remove suggestion 1"}));
    expect(container.querySelector('[data-token-id="2"]')?.textContent).toBe("Bruno");
    fireEvent.click(screen.getByRole("button",{name:"a.pdf"}));
    expect(container.querySelector('[data-token-id="2"]')?.textContent).toBe("*");
    fireEvent.click(screen.getByRole("button",{name:"b.pdf"}));
    expect(container.querySelector('[data-token-id="2"]')?.textContent).toBe("Bruno");
    expect(screen.queryByRole("button",{name:/^Bruno Name/})).toBeNull();
  });

});
