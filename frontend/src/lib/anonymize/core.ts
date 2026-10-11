/** Shared browser / Python session contract. See API.md. */
export const allCategories = ["Name", "Contact", "Identifier", "Date", "Address", "Health", "Financial", "Sensitive"] as const;
export type Category = typeof allCategories[number];
export type Token = { id: number; text: string; category?: Category; source?: string };
export type SessionPayload = {
  session_id: string;
  file_name: string;
  categories: Category[];
  context?: { tema: string; preservar: { linha: number; tipos: string[] }[] };
  lines: Token[][];
  expires_at: string;
  status: "queued" | "processing" | "ready" | "failed";
  stage: string;
  progress: number;
  error?: string;
  stats?: { presidio: number; gemini: number; total: number; coverage?: number };
};
export type RenderSegment = { text: string; masked: boolean };
export const maskText = (text: string) => text.replace(/\S+/g, "*");
export const renderMasked = (lines: RenderSegment[][]) => lines
  .map(line => line.map(s => s.masked ? maskText(s.text) : s.text).join(""))
  .filter(line => line.trim()).join("\n");
export const renderDefault = (lines: Token[][], categories: Category[]) => renderMasked(
  lines.map(line => line.map(t => ({ text: t.text, masked: !!t.category && categories.includes(t.category) }))),
);
