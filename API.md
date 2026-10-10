# Hidden session API (Python)

Same-origin API, normally `http://127.0.0.1:8787`; Vite proxies `/api` in development. Replaces the Lovable/Supabase routes. Single user, loopback only. Sessions are unguessable bearer identifiers stored in memory for one hour, periodically purged, lost on restart. Limits: 20 sessions, 5,000 non-empty lines, 200,000 characters/document, 4 MiB JSON/request. The browser extracts PDF text (20 MiB PDF limit); PDF bytes reach only the local export endpoint at download time, never Gemini. No silent truncation.

## Create and poll

`POST /api/public/sessions` JSON:

```json
{"file_name":"document.pdf","lines":["Document text"],"categories":["Name","Contact","Identifier","Date","Address","Health","Financial","Sensitive"]}
```

Returns **202**, then poll `GET /api/public/sessions/{session_id}`. Both return:

```json
{
  "session_id":"unguessable-id", "file_name":"document.pdf",
  "categories":["Name","Health"], "expires_at":"2026-10-10T20:00:00+00:00",
  "status":"ready", "stage":"Ready for your review", "progress":100,
  "lines":[[{"id":1,"text":"Document text"}]],
  "stats":{"presidio":0,"gemini":0,"total":0}
}
```

Statuses: `queued`, `processing`, `ready`, `failed`. `lines` is empty until ready. Failed sessions contain a safe `error` and cannot export. Progress denotes pipeline stages, not time remaining. Tokens optionally include `category` and `source` (`presidio`, `llm`, `llm+presidio`). IDs are unique per document. Joining each line's tokens exactly reconstructs the extracted line. Stats count entity spans; multiline entities may produce several UI tokens.

Categories select initial final masks; Presidio **always masks all its detections before Gemini**, including categories disabled for export. Health includes clinical context; Sensitive includes religion, politics, sexuality, biometrics, genetics and other sensitive data.

## Review and export

`POST /api/public/sessions/{id}/render`:

```json
{"lines":[[{"text":"Document ","masked":false},{"text":"text","masked":true}]]}
```

Manual splits are accepted only if concatenated text matches the original lines exactly. Returns `{ "file_name":"document.pdf", "text":"Document *\n", "report":"...Markdown..." }`. Each selected non-whitespace word becomes `*`; whitespace/lines remain. The report reflects current selections without personal values. Edits are local to the current browser view; reopening restores initial suggestions.

`GET /api/public/sessions/{id}/masked`: TXT download with initial category settings, not unsaved review edits.

`DELETE /api/public/sessions/{id}`: removes session, returns 204. An in-flight Gemini call cannot be recalled, but its result is discarded.

`GET /api/health`: `{status, gemini_configured, model}`. Checks key presence, not validity/quota.

## Errors and privacy

JSON `{ "error": "message" }`: 400 modified review text, 403 foreign origin, 404 unknown session/restart, 409 not ready, 410 expired (already purged becomes 404), 413 too large, 415 media type, 422 invalid input, 429 session limit, 503 missing key. Processing errors are also reported by polling. Responses use `Cache-Control: no-store`. Keys remain in Python, read from the environment or `submission/.env`. No document database; temporary Gemini cache is removed after processing.

## Original PDF export

`POST /api/public/sessions/{id}/export/pdf`: multipart form fields `file` (original PDF, maximum 20 MiB) and `review` (JSON string `{lines: RenderSegment[][]}`). Returns `application/pdf`. Request body limit: 24 MiB including review data. The session may include an optional `pdf_sha256` (64 lowercase hexadecimal characters) at creation; export verifies it. Legacy sessions without a fingerprint still require exact normalized text reconciliation. Password-protected or irreconcilable PDFs fail with 400; no substitute PDF is produced.

The local service composes a new, selectable-text PDF with PyMuPDF, one `*` per selected word, compact horizontal spaces and automatic pagination. Pages are A4, with 40-point margins and 11-point text. Source geometry and page count are not preserved. No original content streams, images, metadata, attachments, annotations or interactive widgets are embedded. PDF originals are not persisted. Each successful export saves `output/<name>-<unique-export-id>/anonimizado.txt` and `relatorio.md`, never overwriting earlier revisions. Review choices, including manual masks and preserved fragments, drive PDF, TXT and report together.

Detection uses two Gemini passes, both over text protected by previous stages. Model entities specify `texto`, `linha` (1-based), `ocorrencia` (0-based on that line), `categoria` and `tipo`. Types/categories are validated. Line-scoped matches prevent unrelated repeated values being masked. `stats.gemini` includes both passes. Legacy caches are accepted only for unambiguous locations. Reopened reviews require selecting the original PDF before export.

Detection is fragment-based and contextual in all categories. General, educational and administrative information is preserved; personal identifiers and sensitive facts linked to a person are masked. No blanket clinical-section completion is performed. Discarding a suggestion is a browser-local review edit: it restores visible text and excludes the detection from the changes list; render/export receive the resulting segment as unmasked. No endpoint or request schema change is required. Reopening restores initial suggestions.
