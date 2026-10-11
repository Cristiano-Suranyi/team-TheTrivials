import {
  Check,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  LockKeyhole,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { createSession, deleteSession, exportPdf, pdfFingerprint, extractPdfLines } from "@/lib/anonymize/client";
import { allCategories, maskText, type Category, type SessionPayload, type Token as ApiToken } from "@/lib/anonymize/core";

import { importExtensionPdf, rememberExtensionReview } from "@/lib/anonymize/extension-import";

type Phase = "upload" | "confirm" | "processing" | "review";
type Token = ApiToken & { masked?: boolean };
const processingSteps = ["Read PDF", "Presidio", "Gemini", "Review"];
const stageLabels: Record<string, string> = {
  "Detecting common personal data locally": "Presidio · detecting names, contacts and identifiers",
  "Analyzing protected text with Gemini": "Gemini · finding sensitive data in context",
  "Validating and combining detections": "Validating detections and preserving document lines",
  "Checking remaining sensitive data with Gemini": "Gemini · checking for remaining sensitive information",
};

const categoryStyles: Record<Category, string> = {
  Name: "bg-category-name text-category-name-foreground",
  Contact: "bg-category-contact text-category-contact-foreground",
  Identifier: "bg-category-identifier text-category-identifier-foreground",
  Date: "bg-category-date text-category-date-foreground",
  Address: "bg-category-address text-category-address-foreground",
  Health: "bg-category-name text-category-name-foreground",
  Financial: "bg-category-identifier text-category-identifier-foreground",
  Sensitive: "bg-category-date text-category-date-foreground",
};



const categoryLabels: Record<Category, { label: string; hint: string }> = {
  Name: { label: "Names", hint: "People" },
  Contact: { label: "Contacts", hint: "Email, phone" },
  Identifier: { label: "Identifiers", hint: "NIF, references" },
  Date: { label: "Dates", hint: "Days, years" },
  Address: { label: "Addresses", hint: "Street, city" },
  Health: { label: "Health", hint: "Conditions, treatments" },
  Financial: { label: "Financial", hint: "Accounts, payments" },
  Sensitive: { label: "Sensitive", hint: "Beliefs, genetics, biometrics" },
};

type AnonymizationSettings = { categories: Category[] };
type QueuedFile = { id: number; name: string; size: string; file?: File; sessionId?: string; stats?: SessionPayload["stats"] };
type DocState = { maskedIds: Set<number>; manualIds: Set<number>; docLines: Token[][]; activeTokenId: number };

function initialStateFor(docLines: Token[][], categories: Category[]): DocState {
  const ids = docLines
    .flat()
    .filter((t) => t.category && categories.includes(t.category))
    .map((t) => t.id);
  return { maskedIds: new Set(ids), manualIds: new Set<number>(), docLines, activeTokenId: ids[0] ?? 0 };
}

export function AnonymizationWorkspace({ initialSession }: { initialSession?: SessionPayload } = {}) {
  const sessionFile: QueuedFile | null = initialSession
    ? { id: 1, name: initialSession.file_name, size: "", sessionId: initialSession.session_id, stats: initialSession.stats }
    : null;
  const sessionState = initialSession
    ? initialStateFor(initialSession.lines as Token[][], initialSession.categories as Category[])
    : null;
  const [phase, setPhase] = useState<Phase>(initialSession ? "review" : "upload");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [activeStep, setActiveStep] = useState(0);
  const [files, setFiles] = useState<QueuedFile[]>(sessionFile ? [sessionFile] : []);
  const [activeFileId, setActiveFileId] = useState<number | null>(sessionFile ? 1 : null);
  const fileIdRef = useRef(2);
  const docStatesRef = useRef(new Map<number, DocState>());
  const activeFile = files.find((f) => f.id === activeFileId) ?? files[0];
  const fileName = activeFile?.name ?? "document_to_anonymize.pdf";
  const fileSize = activeFile?.size ?? "";
  const [maskedIds, setMaskedIds] = useState(() => sessionState?.maskedIds ?? new Set<number>());
  const [activeTokenId, setActiveTokenId] = useState(sessionState?.activeTokenId ?? 0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [enabledCategories, setEnabledCategories] = useState<Set<Category>>(
    () => new Set((initialSession?.categories as Category[] | undefined) ?? allCategories),
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [manualIds, setManualIds] = useState<Set<number>>(() => new Set());
  const [selectionPopup, setSelectionPopup] = useState<{ ids: number[]; top: number; center: number } | null>(null);
  const selectionPopupRef = useRef<HTMLDivElement | null>(null);
  const [docLines, setDocLines] = useState<Token[][]>(() => sessionState?.docLines ?? []);
  const [downloading, setDownloading] = useState(false);

  const [navigationRequest, setNavigationRequest] = useState(0);
  const pendingPdfRef = useRef<QueuedFile | null>(null);
  const nextTokenId = useRef(100000);
  const inputRef = useRef<HTMLInputElement>(null);
  const documentAreaRef = useRef<HTMLDivElement>(null);
  const documentTokenRefs = useRef(new Map<number, HTMLButtonElement>());
  const sidebarTokenRefs = useRef(new Map<number, HTMLButtonElement>());

  const importPromise = useRef<ReturnType<typeof importExtensionPdf> | null>(null);
  const historyTicket = useRef("");
  const [importing, setImporting] = useState(false);

  const chooseFiles = (list?: FileList | File[] | null) => {
    const incoming = Array.from(list ?? []);
    if (incoming.length === 0) return;
    const accepted: QueuedFile[] = [];
    let problem = "";
    for (const file of incoming) {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        problem = `${file.name} is not a PDF.`;
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        problem = `${file.name} is over the 20 MB limit.`;
        continue;
      }
      accepted.push({
        id: fileIdRef.current++,
        name: file.name,
        size: `${Math.max(file.size / 1024 / 1024, 0.1).toFixed(1)} MB`,
        file,
      });
    }
    setError(problem);
    if (inputRef.current) inputRef.current.value = "";
    if (accepted.length === 0) return;
    setFiles((current) => [...current, ...accepted]);
    setPhase("confirm");
  };

  useEffect(() => {
    if (initialSession) return;
    const ticket = new URLSearchParams(window.location.hash.slice(1)).get("hidden-import");
    if (!ticket && !importPromise.current) return;
    if (!importPromise.current) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      importPromise.current = importExtensionPdf(ticket!);
    }
    let cancelled = false;
    setImporting(true);
    importPromise.current.then(result => {
      if (cancelled) return;
      historyTicket.current = result.historyTicket;
      chooseFiles([result.file]);
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Não foi possível importar o PDF."); })
      .finally(() => { if (!cancelled) setImporting(false); });
    return () => { cancelled = true; };
  }, []);

  const removeFile = (id: number) => {
    const next = files.filter((f) => f.id !== id);
    setFiles(next);
    if (next.length === 0) reset();
  };

  const snapshot = (): DocState => ({ maskedIds, manualIds, docLines, activeTokenId });

  const loadState = (state: DocState) => {
    setMaskedIds(state.maskedIds);
    setManualIds(state.manualIds);
    setDocLines(state.docLines);
    setActiveTokenId(state.activeTokenId);
    setSelectionPopup(null);
  };

  const switchFile = (id: number) => {
    if (id === activeFileId) return;
    if (activeFileId !== null) docStatesRef.current.set(activeFileId, snapshot());
    const state = docStatesRef.current.get(id);
    if (state) loadState(state);
    setActiveFileId(id);
  };

  // Service boundary: text is extracted locally, detection runs on the session API
  // (built-in or the Python service — same contract, see API.md).
  const startAnonymization = async () => {
    if (phase !== "confirm" || enabledCategories.size === 0 || files.length === 0) return;
    const settings: AnonymizationSettings = { categories: [...enabledCategories] };
    setError("");
    setProgress(4);
    setPhase("processing");
    const states = new Map<number, DocState>();
    const updated: QueuedFile[] = [];
    try {
      for (const [index, f] of files.entries()) {
        const share = 100 / files.length;
        const base = index * share;
        setActiveStep(0);
        setStatusText(files.length > 1 ? `Reading ${f.name}` : "Reading the document");
        setProgress(base + share * 0.15);
        const pdfLines = f.file ? await extractPdfLines(f.file) : [];
        const fingerprint = f.file ? await pdfFingerprint(f.file) : undefined;
        if (!pdfLines.length) throw new Error(`${f.name} has no selectable text.`);
        setStatusText(files.length > 1 ? `Finding personal data in ${f.name}` : "Finding personal data");
        setProgress(base + share * 0.4);
        const session = await createSession(f.name, pdfLines, settings.categories, (current) => {
          setActiveStep(current.progress < 30 ? 0 : current.progress < 60 ? 1 : current.progress < 95 ? 2 : 3);
          setProgress(base + share * (0.1 + current.progress * 0.009));
          setStatusText(stageLabels[current.stage] ?? current.stage);
        }, fingerprint);
        if (historyTicket.current) void rememberExtensionReview(historyTicket.current, session).catch(() => {});
        setProgress(base + share);
        states.set(f.id, initialStateFor(session.lines as Token[][], settings.categories));
        updated.push({ ...f, sessionId: session.session_id, stats: session.stats });
      }
    } catch (err) {
      for (const complete of updated) if (complete.sessionId) void deleteSession(complete.sessionId).catch(() => {});
      setError(err instanceof Error ? err.message : "Could not process the document.");
      setPhase("confirm");
      return;
    }
    docStatesRef.current = states;
    setFiles(updated);
    const firstId = updated[0]!.id;
    loadState(states.get(firstId)!);
    setActiveFileId(firstId);
    setStatusText("Ready");
    setProgress(100);
    window.setTimeout(() => setPhase("review"), 250);
  };

  useEffect(() => {
    if (phase !== "confirm") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, input, label, [role=checkbox]")) return;
      event.preventDefault();
      startAnonymization();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const dropFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    chooseFiles(event.dataTransfer.files);
  };

  useEffect(() => {
    if (phase !== "review") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      const index = sensitiveTokens.findIndex((token) => token.id === activeTokenId);
      const nextIndex = event.key === "ArrowUp" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= sensitiveTokens.length) return;
      focusToken(nextIndex);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggleToken = (id: number) => {
    setActiveTokenId(id);
    setMaskedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (phase !== "review") return;
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setSelectionPopup(null);
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [phase]);

  const handleDocumentMouseUp = () => {
    if (phase !== "review") return;
    const selection = window.getSelection();
    const area = documentAreaRef.current;
    if (!selection || !area || selection.isCollapsed || !selection.rangeCount) {
      setSelectionPopup(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!area.contains(range.commonAncestorContainer)) return;
    const ids: number[] = [];
    area.querySelectorAll<HTMLElement>("[data-token-id]").forEach((element) => {
      if (range.intersectsNode(element)) ids.push(Number(element.dataset["tokenId"]));
    });
    if (!ids.length) {
      setSelectionPopup(null);
      return;
    }
    // Use the visible text boxes of the first selected line (ignoring empty
    // rects from line breaks) so the pill centers on the highlighted words.
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 0);
    const fallback = range.getBoundingClientRect();
    const firstTop = rects.length ? Math.min(...rects.map((r) => r.top)) : fallback.top;
    const lineRects = rects.filter((r) => Math.abs(r.top - firstTop) < 4);
    const left = lineRects.length ? Math.min(...lineRects.map((r) => r.left)) : fallback.left;
    const right = lineRects.length ? Math.max(...lineRects.map((r) => r.right)) : fallback.right;
    const areaRect = area.getBoundingClientRect();
    setSelectionPopup({
      ids,
      top: firstTop - areaRect.top - 8,
      center: (left + right) / 2 - areaRect.left,
    });
  };

  // Keep the Hide pill centered on the selection. It may overflow the text
  // column into the page margins; only clamp against the visible scroller so
  // words at the very start of a line still get a perfectly centered pill.
  useLayoutEffect(() => {
    if (!selectionPopup) return;
    const pill = selectionPopupRef.current;
    const area = documentAreaRef.current;
    if (!pill || !area) return;
    const scroller = area.closest<HTMLElement>("[data-document-scroller]") ?? area;
    const areaRect = area.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const half = pill.offsetWidth / 2 + 4;
    const min = scrollerRect.left - areaRect.left + half;
    const max = scrollerRect.right - areaRect.left - half;
    const clamped = Math.min(Math.max(selectionPopup.center, min), max);
    pill.style.left = `${clamped}px`;
  }, [selectionPopup]);

  const hideSelection = () => {
    const selection = window.getSelection();
    const area = documentAreaRef.current;
    if (!selection || !area || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const newManualIds: number[] = [];
    const retainedMasked: number[] = [];
    const retainedManual: number[] = [];
    const replacedIds: number[] = [];
    const nextLines = docLines.map((line) =>
      line.flatMap((token) => {
        const element = area.querySelector<HTMLElement>(`[data-token-id="${token.id}"]`);
        const textNode = element?.firstChild;
        if (!element || !textNode || !range.intersectsNode(element) ||
            (maskedIds.has(token.id) && (manualIds.has(token.id) || (token.category && enabledCategories.has(token.category))))) return [token];
        let start = 0;
        let end = token.text.length;
        if (element.contains(range.startContainer)) {
          start = range.startContainer === textNode ? range.startOffset : 0;
        }
        if (element.contains(range.endContainer)) {
          end = range.endContainer === textNode ? range.endOffset : token.text.length;
        }
        start = Math.max(0, Math.min(start, token.text.length));
        end = Math.max(start, Math.min(end, token.text.length));
        if (start === end) return [token];
        const parts: Token[] = [];
        replacedIds.push(token.id);
        const keepRemainder = (text: string) => {
          if (!text) return;
          const id = nextTokenId.current++;
          parts.push({ ...token, id, text });
          if (maskedIds.has(token.id)) retainedMasked.push(id);
          if (manualIds.has(token.id)) retainedManual.push(id);
        };
        const before = token.text.slice(0, start);
        const middle = token.text.slice(start, end);
        const after = token.text.slice(end);
        keepRemainder(before);
        const middleId = nextTokenId.current++;
        parts.push({ id: middleId, text: middle, masked: true });
        newManualIds.push(middleId);
        keepRemainder(after);
        return parts;
      }),
    );
    if (!newManualIds.length) return;
    setDocLines(nextLines);
    setMaskedIds((current) => new Set([...current].filter(id => !replacedIds.includes(id)).concat(retainedMasked, newManualIds)));
    setManualIds((current) => new Set([...current].filter(id => !replacedIds.includes(id)).concat(retainedManual, newManualIds)));
    setActiveTokenId(newManualIds[0] ?? 0);
    setSelectionPopup(null);
    window.getSelection()?.removeAllRanges();
  };

  const reset = () => {
    for (const f of files) if (f.sessionId) void deleteSession(f.sessionId).catch(() => {});
    if (initialSession) {
      window.location.href = "/";
      return;
    }
    setPhase("upload");
    setProgress(0);
    setError("");
    setFiles([]);
    setActiveFileId(null);
    docStatesRef.current = new Map();
    setMaskedIds(new Set<number>());
    setActiveTokenId(0);
    setManualIds(new Set());
    setSelectionPopup(null);
    setDocLines([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const isMasked = (state: DocState, token: Token) =>
    state.maskedIds.has(token.id) &&
    (state.manualIds.has(token.id) || (!!token.category && enabledCategories.has(token.category)));

  const buildMasked = (state: DocState) =>
    state.docLines
      .map((line) => line.map((token) => (isMasked(state, token) ? maskText(token.text) : token.text)).join(""))
      .filter((line) => line.trim().length > 0)
      .join("\n");

  // Exports are validated against the original text by the Python service.
  const renderFinal = async (file: QueuedFile, state: DocState, original = file.file) => {
    if (!file.sessionId) throw new Error("No processed session. Please open the PDF again.");
    const segments = state.docLines.map((line) =>
      line.map((token) => ({ text: token.text, masked: isMasked(state, token) })),
    );
    if (!original) throw new Error("Select the original PDF to export this review.");
    return exportPdf(file.sessionId, original, segments);
  };

  const savePdf = (name: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name.replace(/\.pdf$/i, "")}-anonymized.pdf`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const download = async (original?: File) => {
    if (!activeFile) return;
    if (!original && !activeFile.file) {
      pendingPdfRef.current = activeFile;
      setError("Select the exact original PDF. It will be used only by the local service to preserve the page layout.");
      inputRef.current?.click();
      return;
    }
    setDownloading(true);
    try {
      setError("");
      savePdf(activeFile.name, await renderFinal(activeFile, snapshot(), original ?? activeFile.file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  const downloadAll = async () => {
    if (activeFileId !== null) docStatesRef.current.set(activeFileId, snapshot());
    setDownloading(true);
    try {
      for (const f of files) {
        const state = docStatesRef.current.get(f.id);
        if (!state) continue;
        savePdf(f.name, await renderFinal(f, state));
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  const sensitiveTokens = docLines
    .flat()
    .filter(
      (token) =>
        manualIds.has(token.id) ||
        (token.category && enabledCategories.has(token.category)),
    );
  const activeTokenIndex = sensitiveTokens.findIndex((token) => token.id === activeTokenId);
  const counts = sensitiveTokens.reduce<Record<Category, number>>(
    (result, token) => {
      if (token.category && maskedIds.has(token.id)) result[token.category] += 1;
      return result;
    },
    { Name: 0, Contact: 0, Identifier: 0, Date: 0, Address: 0, Health: 0, Financial: 0, Sensitive: 0 },
  );

  const dismissToken = (id: number) => {
    const index = sensitiveTokens.findIndex(token => token.id === id);
    const remaining = sensitiveTokens.filter(token => token.id !== id);
    setDocLines(lines => lines.map(line => line.map(token => token.id === id ? {id: token.id, text: token.text} : token)));
    setMaskedIds(ids => new Set([...ids].filter(value => value !== id)));
    setManualIds(ids => new Set([...ids].filter(value => value !== id)));
    setSelectionPopup(null);
    if (activeTokenId === id) setActiveTokenId(remaining[Math.min(index, remaining.length - 1)]?.id ?? 0);
  };

  const focusToken = (index: number) => {
    const token = sensitiveTokens[index];
    if (!token) return;
    setActiveTokenId(token.id);
    setNavigationRequest(value => value + 1);
  };

  useLayoutEffect(() => {
    if (phase !== "review") return;
    const target = documentTokenRefs.current.get(activeTokenId);
    const scroller = documentAreaRef.current?.closest<HTMLElement>("[data-document-scroller]");
    if (!target || !scroller) return;
    const targetRect = target.getBoundingClientRect();
    const panelRect = scroller.getBoundingClientRect();
    const top = scroller.scrollTop + targetRect.top - panelRect.top - (scroller.clientHeight - targetRect.height) / 2;
    scroller.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [activeTokenId, navigationRequest, activeFileId, docLines, phase]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-screen bg-background text-foreground">
        <header className="session-toolbar sticky top-0 z-30">
          <div className="mx-auto flex h-16 max-w-[1480px] items-center justify-between px-5 sm:px-8">
            <div className="flex items-center gap-3">
              <div className="flex size-7 items-center justify-center rounded-md bg-foreground text-sm font-semibold text-background">
                *
              </div>
              <span className="text-base font-semibold">Hidden</span>
              <span className="hidden h-4 w-px bg-border sm:block" />
              <span className="hidden text-xs text-muted-foreground sm:block">NOS · JunctionX Lisbon</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-medium text-success">
              <LockKeyhole className="size-3.5" />
              <span>Temporary local session</span>
            </div>
          </div>
        </header>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(event) => {
            const pending = pendingPdfRef.current;
            if (!pending) { chooseFiles(event.target.files); return; }
            const original = event.target.files?.[0];
            pendingPdfRef.current = null;
            event.target.value = "";
            if (original) void download(original);
          }}
        />
        {importing && <p role="status" className="mb-4 text-sm text-muted-foreground">A importar o PDF da extensão…</p>}
        {phase === "upload" && (
          <main className="workspace-enter mx-auto flex max-w-5xl flex-col px-5 pb-12 pt-12 sm:px-8 sm:pt-16">
            <section className="mx-auto w-full max-w-3xl text-center">
              <h1 className="text-balance text-4xl font-semibold leading-[1.08] sm:text-5xl">
                Hidden
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
                A little less personal. Just as meaningful.
              </p>
            </section>

            <section className="mx-auto mt-9 w-full max-w-2xl">
              <div
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={dropFile}
                className={cn(
                  "relative flex min-h-[340px] flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed bg-card px-6 py-8 text-center transition-[background-color,border-color,box-shadow] duration-150",
                  dragging ? "border-primary bg-primary-soft shadow-focus" : "border-border",
                )}
              >
                <div className="mb-6 flex h-20 w-16 items-center justify-center rounded-md border border-border bg-background text-primary shadow-page" aria-hidden="true">
                  <FileText className="size-9" strokeWidth={1.2} />
                </div>
                <h2 className="text-xl font-semibold">{dragging ? "Ready when you are" : "Add a document"}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{dragging ? "Drop your PDFs to continue" : "Drop one or more PDFs here"}</p>
                <Button className="mt-6 h-11 rounded-full px-6" onClick={() => inputRef.current?.click()}>
                  <Upload /> Choose PDFs
                </Button>
                <p className="mt-5 text-xs text-muted-foreground">PDF only · Up to 20 MB each</p>
              </div>
              {error && (
                <p role="alert" className="mt-3 flex items-center justify-center gap-2 text-sm text-destructive">
                  <X className="size-4" /> {error}
                </p>
              )}
            </section>
          </main>
        )}

        {phase === "confirm" && (
          <main className="workspace-enter mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl flex-col justify-center px-5 py-12">
            <section className="w-full text-center">
              <p className="text-xs font-medium text-muted-foreground">Ready to send</p>
              <h1 className="mt-2 text-3xl font-semibold">Review before masking</h1>
            </section>

            <div className="mt-8 overflow-hidden rounded-lg border border-border bg-card shadow-xs">
              <ul className="divide-y divide-border">
                {files.map((file) => (
                  <li key={file.id} className="flex items-center gap-4 p-4">
                    <div className="flex h-12 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                      <FileText className="size-5" strokeWidth={1.4} />
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="break-all text-sm font-semibold">{file.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{file.size} · will be anonymized</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 rounded-full"
                      onClick={() => removeFile(file.id)}
                      aria-label={`Remove ${file.name}`}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 border-t border-border px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-secondary"
              >
                <Upload className="size-4" /> Add more
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-3 flex items-center justify-center gap-2 text-sm text-destructive">
                <X className="size-4" /> {error}
              </p>
            )}

            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Each document’s context is assessed automatically. Relevant content is preserved;
              personal identifiers are highlighted for review before download.
            </p>

            <div className="mt-4 rounded-lg border border-border bg-card">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                aria-expanded={showAdvanced}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium"
              >
                <span className="flex items-center gap-2">
                  <Settings2 className="size-4 text-muted-foreground" /> Advanced settings
                </span>
                <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                  {enabledCategories.size} of {allCategories.length} types
                  <ChevronDown className={cn("size-4 transition-transform", showAdvanced && "rotate-180")} />
                </span>
              </button>
              {showAdvanced && (
                <div className="border-t border-border px-4 pb-4 pt-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">What to mask</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setEnabledCategories(new Set(allCategories))}>
                        Select all
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setEnabledCategories(new Set())}>
                        Select none
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {allCategories.map((category) => (
                      <label key={category} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 hover:bg-secondary">
                        <Checkbox
                          checked={enabledCategories.has(category)}
                          onCheckedChange={(checked) =>
                            setEnabledCategories((current) => {
                              const next = new Set(current);
                              if (checked) next.add(category);
                              else next.delete(category);
                              return next;
                            })
                          }
                        />
                        <span className={cn("size-2 rounded-full", categoryStyles[category])} />
                        <span className="flex-1 text-sm">{categoryLabels[category].label}</span>
                        <span className="text-xs text-muted-foreground">{categoryLabels[category].hint}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
              Your PDF stays in this browser during detection. It is sent only to the local service for PDF export. Presidio masks common personal data locally,
              then Google Gemini receives the protected text to detect sensitive context.
              Reviews expire after one hour or when the server stops.
            </p>
            <div className="mt-8 flex flex-col items-center gap-2">
              <Button className="h-11 rounded-full px-8" disabled={enabledCategories.size === 0} onClick={startAnonymization}>
                Anonymize document <ArrowUpRight />
              </Button>
              <p className="text-xs text-muted-foreground">
                {enabledCategories.size === 0 ? "Select at least one category" : "Press Enter to start"}
              </p>
            </div>
          </main>
        )}

        {phase === "processing" && (
          <main className="workspace-enter mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl items-center px-5 py-12">
            <section className="w-full text-center" aria-live="polite">
              <div className="relative mx-auto mb-10 flex size-24 items-center justify-center rounded-3xl border border-border bg-card shadow-workspace">
                <FileText className="size-10 text-foreground" strokeWidth={1.4} />
                <span className="absolute -bottom-2 -right-2 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
                  <Sparkles className="size-4 animate-pulse" />
                </span>
              </div>
              <p className="break-all text-sm font-medium text-muted-foreground">
                {files.length > 1 ? `${files.length} documents` : fileName}
              </p>
              <h1 className="mt-2 text-3xl font-semibold">Preparing your review</h1>
              <p className="mt-3 text-sm text-muted-foreground">{statusText || "Starting"}</p>
              <Progress value={progress} className="mx-auto mt-9 h-1.5 max-w-sm bg-secondary" />
              <div className="mt-8 grid grid-cols-4 gap-2">
                {processingSteps.map((step, index) => (
                  <div key={step} className="flex flex-col items-center gap-2">
                    <span
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full border text-xs transition-colors",
                        index < activeStep
                          ? "border-success bg-success text-success-foreground"
                          : index === activeStep
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-muted-foreground",
                      )}
                    >
                      {index < activeStep ? <Check className="size-3.5" /> : index + 1}
                    </span>
                    <span className="text-xs font-medium text-muted-foreground">{step}</span>
                  </div>
                ))}
              </div>
            </section>
          </main>
        )}

        {phase === "review" && (
          <main className="workspace-enter mx-auto max-w-[1480px] px-5 pb-10 pt-7 sm:px-8">
            {files.length > 1 && (
              <nav aria-label="Documents" className="mb-6 flex gap-1 overflow-x-auto rounded-full bg-secondary p-1">
                {files.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => switchFile(file.id)}
                    aria-current={file.id === activeFile?.id ? "page" : undefined}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-sm transition-colors",
                      file.id === activeFile?.id
                        ? "bg-card font-semibold text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <FileText className="size-3.5" /> <span className="max-w-[200px] truncate">{file.name}</span>
                  </button>
                ))}
              </nav>
            )}
            <section className="flex flex-col justify-between gap-5 pb-6 md:flex-row md:items-center">
              <div className="min-w-0">
                <h1 className="break-all text-xl font-semibold sm:text-2xl">{fileName}</h1>
                {activeFile?.stats && <p className="mt-2 text-sm text-muted-foreground">
                  Presidio: {activeFile.stats.presidio} protected locally · Gemini: {activeFile.stats.gemini} additional detections
                </p>}
                <p className="mt-1 text-xs text-muted-foreground">Click a marked fragment to keep or hide it. Select other text to hide it manually.</p>
                {error && <p role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-11 rounded-full" onClick={reset} aria-label="Start over">
                      <RefreshCw />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Start over</TooltipContent>
                </Tooltip>
                {files.length > 1 && (
                  <Button variant="outline" className="h-11 rounded-full px-5" onClick={downloadAll} disabled={downloading}>
                    <Download /> Download all
                  </Button>
                )}
                <Button className="h-11 rounded-full px-5" onClick={() => void download()} disabled={downloading}>
                  <Download /> Download PDF
                </Button>
              </div>
            </section>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Os fragmentos destacados serão ocultados no download · PDF com nova paginação</span>
            </div>
            <section className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_320px]">
              <DocumentPanel size={fileSize}>
                <div ref={documentAreaRef} className="relative" onMouseUp={handleDocumentMouseUp}>
                  <DocumentLines
                    lines={docLines}
                    activeTokenId={activeTokenId}
                    enabledCategories={enabledCategories}
                    manualIds={manualIds}
                    maskedIds={maskedIds}
                    setTokenRef={(id, element) => {
                      if (element) documentTokenRefs.current.set(id, element);
                      else documentTokenRefs.current.delete(id);
                    }}
                    toggleToken={toggleToken}
                  />
                  {selectionPopup && (
                    <div
                      ref={selectionPopupRef}
                      role="dialog"
                      aria-label="Hide selected text"
                      className="absolute z-20 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-full border border-border bg-card p-1 shadow-workspace"
                      style={{ top: selectionPopup.top, left: selectionPopup.center }}
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      <Button size="sm" className="h-8 rounded-full px-4 text-xs" onClick={hideSelection}>
                        Hide
                      </Button>
                    </div>
                  )}
                </div>
              </DocumentPanel>
              <aside className="flex min-h-0 flex-col overflow-hidden md:max-h-[740px]" aria-label="Detected changes">
                <header className="border-b border-border px-2 pb-5 pt-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">Changes <span className="ml-1 font-normal text-muted-foreground">{sensitiveTokens.length}</span></h2>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="mr-1 text-xs tabular-nums text-muted-foreground">
                        {Math.max(0, activeTokenIndex + 1)} of {sensitiveTokens.length}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-10 w-9"
                            disabled={activeTokenIndex <= 0}
                            onClick={() => focusToken(activeTokenIndex - 1)}
                            aria-label="Previous change"
                          >
                            <ChevronUp />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Previous change</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-10 w-9"
                            disabled={!sensitiveTokens.length || activeTokenIndex >= sensitiveTokens.length - 1}
                            onClick={() => focusToken(activeTokenIndex + 1)}
                            aria-label="Next change"
                          >
                            <ChevronDown />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Next change</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-3 gap-y-2.5">
                    {(Object.keys(counts) as Category[]).map((category) => (
                      <div key={category} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={cn("size-2 rounded-full", categoryStyles[category])} />
                        <span>{category}</span>
                        <span className="tabular-nums">{counts[category]}</span>
                      </div>
                    ))}
                  </div>
                </header>
                <div className="min-h-60 max-h-[440px] flex-1 space-y-1 overflow-y-auto py-3 pr-1 md:max-h-none">
                  {sensitiveTokens.map((token, index) => {
                    const selected = maskedIds.has(token.id);
                    const active = token.id === activeTokenId;
                    const label = token.category ?? "Manual";
                    return (
                      <div key={token.id} className="flex items-center gap-1">
                      <Button
                        ref={(element) => {
                          if (element) sidebarTokenRefs.current.set(token.id, element);
                          else sidebarTokenRefs.current.delete(token.id);
                        }}
                        key={token.id}
                        type="button"
                        variant="ghost"
                        onClick={() => focusToken(index)}
                        className={cn(
                          "h-auto min-h-16 min-w-0 flex-1 justify-start gap-3 rounded-md border border-transparent px-3 py-3 text-left active:scale-100",
                          active && "border-border bg-card shadow-xs",
                        )}
                      >
                        <span className={cn("size-2.5 shrink-0 rounded-full", token.category ? categoryStyles[token.category] : "bg-foreground/50")} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{token.text}</span>
                          <span className="mt-1 block text-xs font-normal text-muted-foreground">
                            {label} · {selected ? "Hide" : "Keep"}
                          </span>
                        </span>
                        {active ? <ArrowUpRight className="size-4 shrink-0 text-primary" /> : <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>}
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Remove suggestion ${index + 1}`} title="Discard suggestion and keep text visible" onClick={() => dismissToken(token.id)}><X className="size-4" /></Button>
                      </div>
                    );
                  })}
                </div>
                <div className="border-t border-border px-2 py-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <ShieldCheck className="size-4" /> {maskedIds.size} selected for removal
                  </div>
                </div>
              </aside>
            </section>
          </main>
        )}
      </div>
    </TooltipProvider>
  );
}

function DocumentPanel({ children, size }: { children: ReactNode; size?: string }) {
  return (
    <article className="min-w-0 overflow-hidden rounded-lg border border-border bg-document">
      <header className="flex min-h-12 items-center border-b border-border bg-card px-3 py-2">
        <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] font-medium tabular-nums text-muted-foreground">
          Extracted text{size ? ` · ${size}` : ""}
        </span>
      </header>
      <div data-document-scroller className="h-[580px] overflow-auto overscroll-contain bg-document p-3 sm:h-[684px] sm:p-6">
        <div className="mx-auto min-h-[820px] max-w-[720px] bg-card px-5 py-10 shadow-page lg:px-12 lg:py-14">
          {children}
        </div>
      </div>
    </article>
  );
}

function DocumentLines({
  lines,
  activeTokenId,
  enabledCategories,
  manualIds,
  maskedIds,
  setTokenRef,
  toggleToken,
}: {
  lines: Token[][];
  activeTokenId: number;
  enabledCategories: Set<Category>;
  manualIds: Set<number>;
  maskedIds: Set<number>;
  setTokenRef: (id: number, element: HTMLButtonElement | null) => void;
  toggleToken: (id: number) => void;
}) {
  return (
    <div className="space-y-4 font-mono text-[13px] leading-6 text-document-foreground">
      {lines.map((line, lineIndex) => (
        <p key={line[0]?.id ?? lineIndex} className={cn("whitespace-pre-wrap", lineIndex === 0 && "mb-6 font-semibold")}>
          {line.map((token) => {
            if (!manualIds.has(token.id) && (!token.category || !enabledCategories.has(token.category)))
              return (
                <span key={token.id} data-token-id={token.id}>
                  {token.text}
                </span>
              );
            const selected = maskedIds.has(token.id);
            return (
              <Button
                ref={(element) => setTokenRef(token.id, element)}
                type="button"
                variant="ghost"
                key={token.id}
                data-token-id={token.id}
                onClick={() => toggleToken(token.id)}
                className={cn(
                  "inline h-auto whitespace-pre-wrap break-words rounded-sm px-0 py-0 text-left font-mono text-[13px] leading-6 shadow-none transition-colors active:scale-100",
                  selected
                    ? "bg-secondary text-document-foreground underline decoration-foreground/50 underline-offset-2"
                    : "bg-transparent text-document-foreground underline decoration-border decoration-dotted underline-offset-2",
                  activeTokenId === token.id && "ring-2 ring-primary ring-offset-2 ring-offset-card",
                )}
                aria-label={`${selected ? "Keep visible" : "Mask"} ${token.text}`}
                data-active={activeTokenId === token.id}
                aria-pressed={selected}
              >
                {token.text}
              </Button>
            );
          })}
        </p>
      ))}
    </div>
  );
}
