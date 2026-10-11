"""Local HTTP API for Hidden.

The website sends extracted text; the Chrome extension uploads the PDF
itself (POST /api/public/sessions/upload), which stays in memory with
the session so masked/reviewed PDFs can be produced without re-upload.

One worker owns Presidio; a second one refreshes the submission files, so the
next document never waits for them. Sessions stay in memory for one hour.
Start through run_app.py. Keep this service on the loopback interface.
"""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager, suppress
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import re
import hashlib
import json
import uuid
import os
import secrets
import tempfile
import threading
import time
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

from submission import main as engine
from submission import anonymize as submission_delivery
from submission.pdf_export import redact_pdf, render_review_text

Category = Literal['Name', 'Contact', 'Identifier', 'Date', 'Address', 'Health', 'Financial', 'Sensitive']
CATEGORIES = ['Name', 'Contact', 'Identifier', 'Date', 'Address', 'Health', 'Financial', 'Sensitive']
TTL = 3600
MAX_SESSIONS = 20
MAX_CHARACTERS = 200_000
MAX_BODY = 4 * 1024 * 1024
DIST = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
MAX_PDF = 20 * 1024 * 1024
EXTENSION_ID = os.getenv('HIDDEN_EXTENSION_ID', 'lfnbhbifaakkolphooipdoinpknmacnf')
EXTENSION_ORIGIN = f'chrome-extension://{EXTENSION_ID}'
# Routes the extension may call (upload, poll, downloads). Review edits stay same-origin.
EXTENSION_ROUTES = re.compile(r'^/api/(health|public/sessions/upload|public/sessions/[A-Za-z0-9_-]{24,64}(/masked(\.pdf)?)?)$')


def pdf_lines(content: bytes) -> list[str]:
    """Extract lines exactly as the export check expects (PyMuPDF, sorted)."""
    import pymupdf
    try:
        document = pymupdf.open(stream=content, filetype='pdf')
    except Exception:
        raise HTTPException(415, 'The file is not a valid PDF.') from None
    with document:
        if document.needs_pass:
            raise HTTPException(400, 'Password-protected PDFs are not supported.')
        text = engine.limpar_texto('\n'.join(page.get_text(sort=True) for page in document))
    lines = text.splitlines()
    if not lines:
        raise HTTPException(422, 'No selectable text. Scanned PDFs need OCR first.')
    return lines


class SessionInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    file_name: str = Field(min_length=1, max_length=255)
    lines: list[str] = Field(min_length=1, max_length=5000)
    pdf_sha256: Optional[str] = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    categories: list[Category] = Field(default_factory=lambda: list(CATEGORIES), min_length=1)

    @field_validator('lines')
    @classmethod
    def validate_lines(cls, lines):
        if sum(len(line) + 1 for line in lines) > MAX_CHARACTERS:
            raise ValueError('Maximum 200,000 characters per document. Split the PDF into smaller files.')
        if any(len(line) > 20_000 or any(c in line for c in '\n\r\x00\u2028\u2029') for line in lines):
            raise ValueError('Invalid text lines.')
        cleaned = [line.rstrip() for line in lines if line.strip()]
        if not cleaned:
            raise ValueError('No selectable text. Scanned PDFs need OCR first.')
        return cleaned

    @field_validator('file_name')
    @classmethod
    def validate_name(cls, name):
        name = re.split(r'[/\\]', name)[-1]
        name = ''.join(c for c in name if ord(c) >= 32)
        if not name.strip():
            raise ValueError('Invalid file name.')
        return name


class Segment(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    text: str = Field(max_length=20_000)
    masked: bool


class RenderInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    lines: list[list[Segment]] = Field(min_length=1, max_length=5000)


def category_for(doc, entity):
    """Preserve all semantic categories; presentation hints only refine identity/contact."""
    kind = entity.entity_type
    subtype = entity.subtype
    explicit = {'NOME': 'Name', 'NASCIMENTO': 'Date', 'EMAIL': 'Contact', 'TELEFONE': 'Contact',
                'MORADA': 'Address', 'IDADE': 'Sensitive', 'SEXO': 'Sensitive', 'ESTADO_CIVIL': 'Sensitive',
                'OCUPACAO': 'Sensitive', 'DOCUMENTO': 'Identifier'}
    if subtype in explicit:
        return explicit[subtype]
    value = doc.text[entity.start:entity.end]
    line_start = doc.text.rfind('\n', 0, entity.start) + 1
    label = doc.text[line_start:entity.start].casefold()
    if kind == 'SAUDE':
        return 'Health'
    if kind == 'FINANCEIRO':
        return 'Financial'
    if kind in ('BIOMETRICO', 'GENETICO', 'RELIGIAO', 'POLITICA', 'ORIENTACAO_SEXUAL', 'OUTRO_SENSIVEL'):
        return 'Sensitive'
    if kind == 'CONTACTO' or any(k in entity.reason for k in ('EMAIL_ADDRESS', 'PHONE_NUMBER')):
        return 'Address' if any(k in label for k in ('morada', 'endereço', 'residência', 'address')) else 'Contact'
    if kind == 'IDENTIFICACAO':
        if 'DATE_OF_BIRTH' in entity.reason or re.fullmatch(r'\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}', value) or 'nascimento' in label:
            return 'Date'
        if subtype == 'PERSON' or 'PERSON' in entity.reason:
            return 'Name'
        return 'Identifier'
    return 'Sensitive'


def tokenize(doc):
    """Project merged original offsets into line tokens without changing a character."""
    result, offset, token_id = [], 0, 1
    entities = sorted(doc.entities, key=lambda e: e.start)
    for line in doc.text.splitlines():
        tokens, cursor = [], 0
        def add(text, entity=None):
            nonlocal token_id
            if not text:
                return
            token = {'id': token_id, 'text': text}
            token_id += 1
            if entity:
                token.update(category=category_for(doc, entity), source=entity.source)
            tokens.append(token)
        for entity in entities:
            start, end = max(entity.start - offset, 0), min(entity.end - offset, len(line))
            if end <= start:
                continue
            add(line[cursor:start])
            add(line[start:end], entity)
            cursor = end
        add(line[cursor:])
        result.append(tokens)
        offset += len(line) + 1
    return result


class SessionService:
    def __init__(self, model=None):
        self.model = model or os.getenv("GEMINI_MODEL", engine.DEFAULT_MODEL)
        self.sessions = {}
        self.lock = threading.RLock()
        self.delivery_model = model or os.getenv("GEMINI_MODEL", submission_delivery.DEFAULT_MODEL)
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='hidden')
        self.delivery_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='hidden-delivery')
        self.analyzer = None

    def warm(self):
        """Load the local detector at startup instead of during the first document."""
        with suppress(Exception):
            if self.analyzer is None:
                self.analyzer = engine.build_analyzer()
            self.analyzer.analyze(text='Olá', language=engine.LANGUAGE)

    def purge(self):
        with self.lock:
            for sid in list(self.sessions):
                if self.sessions[sid]['deadline'] <= time.time():
                    del self.sessions[sid]

    def get(self, sid):
        with self.lock:
            session = self.sessions.get(sid)
            if session is None:
                raise HTTPException(404, 'Review not found or server restarted.')
            if session['deadline'] <= time.time():
                del self.sessions[sid]
                raise HTTPException(410, 'Review expired. Open the PDF again.')
            return session

    def public(self, session):
        payload = deepcopy({k: v for k, v in session.items() if k not in ('deadline', 'original', 'doc', 'pdf_sha256', 'pdf')})
        payload['has_pdf'] = bool(session.get('pdf'))
        return payload

    def update(self, sid, **values):
        with self.lock:
            session = self.sessions.get(sid)
            if not session or session['deadline'] <= time.time():
                raise RuntimeError('Session cancelled or expired.')
            session.update(values)

    def create(self, data, pdf: bytes | None = None):
        try:
            engine.carregar_chave()
        except ValueError:
            raise HTTPException(503, 'Configure GEMINI_API_KEY in submission/.env and restart the application.')
        with self.lock:
            self.purge()
            if len(self.sessions) >= MAX_SESSIONS:
                raise HTTPException(429, 'Too many active reviews. Close a review or wait for it to expire.')
            deadline = time.time() + TTL
            sid = secrets.token_urlsafe(24)
            session = dict(session_id=sid, file_name=data.file_name, categories=list(dict.fromkeys(data.categories)),
                           lines=[], status='queued', stage='Waiting for the document processor', progress=5,
                           expires_at=datetime.fromtimestamp(deadline, timezone.utc).isoformat(),
                           deadline=deadline, original=data.lines, pdf_sha256=data.pdf_sha256, pdf=pdf)
            self.sessions[sid] = session
            payload = self.public(session)
            self.executor.submit(self.process, sid)
            return payload

    def process(self, sid):
        try:
            session = self.get(sid)
            self.update(sid, status='processing', stage='Loading the local detector', progress=15)
            if self.analyzer is None:
                self.analyzer = engine.build_analyzer()
            doc = engine.Document('\n'.join(session['original']) + '\n')
            with tempfile.TemporaryDirectory(prefix='hidden-') as folder:
                result = engine.process_document(
                    doc, self.analyzer, engine.carregar_chave(), self.model, Path(folder) / 'cache.json',
                    on_progress=lambda stage, progress: self.update(sid, stage=stage, progress=progress),
                )
            lines = tokenize(doc)
            # The user's review/download must not wait for, or depend on, the hackathon delivery text.
            self.update(sid, doc=doc, lines=lines, stats=result['stats'], context=result['context'],
                        status='ready', stage='Ready for your review', progress=100, delivery='pending')
        except Exception as error:
            # Never include third-party exceptions, document text or credentials in HTTP responses/logs.
            message = ('The document could not be processed. Check the Gemini key/quota and try again. '
                       'No partial result was published.')
            if isinstance(error, ValueError) and str(error).startswith(('Gemini:', 'Resposta Gemini inválida:', 'Não foi possível contactar o Gemini')):
                message = str(error)
            if isinstance(error, ValueError) and 'fragmentos ausentes' in str(error):
                message = 'Gemini returned text or locations that could not be matched safely after a correction attempt. Please try again.'
            with self.lock:
                if sid in self.sessions:
                    self.sessions[sid].update(status='failed', stage='Processing failed', error=message)
            return
        with suppress(RuntimeError):  # The service is shutting down.
            self.delivery_executor.submit(self.deliver, sid, doc, result)

    def deliver(self, sid, doc, result):
        """Best effort: refresh submission.txt/prompt.txt from the model; keep the previous pair on failure."""
        try:
            texto, prompt = submission_delivery.gerar_entrega(
                doc.text, self.analyzer, engine.carregar_chave(), self.delivery_model,
                texto_protegido=result['texto_protegido'])
            with self.lock:
                # Deleting/expiring a session during Gemini must not publish its delivery.
                if sid not in self.sessions:
                    return
                submission_delivery.guardar_entrega(texto, prompt)
                self.sessions[sid]['delivery'] = 'updated'
        except Exception:
            with self.lock:
                if sid in self.sessions:
                    self.sessions[sid]['delivery'] = 'kept_previous'

    def render(self, sid, request):
        with self.lock:
            session = self.get(sid)
            if session['status'] != 'ready':
                raise HTTPException(409, 'Wait until processing is complete.')
            if [''.join(s.text for s in line) for line in request.lines] != session['original']:
                raise HTTPException(400, 'Review text does not match the original document.')
            doc = session['doc']
            selected, output, offset = [], [], 0
            for line in request.lines:
                rendered = []
                for segment in line:
                    end = offset + len(segment.text)
                    if segment.masked and segment.text.strip():
                        matches = [e for e in doc.entities if e.start <= offset and e.end >= end]
                        entity = matches[0] if matches else None
                        selected.append(engine.Entity(offset, end, entity.entity_type if entity else 'MANUAL',
                                                      entity.source if entity else 'manual',
                                                      'Seleção confirmada na revisão.'))
                    rendered.append(re.sub(r'\S+', '*', segment.text) if segment.masked else segment.text)
                    offset = end
                output.append(''.join(rendered))
                offset += 1
            report = engine.build_report(doc, selected, [], self.model)
            stats = session['stats']
            report += f"\n- Contexto automático: {session['context']['tema']}\n"
            report += (f"\n## Pipeline\n- Presidio: {stats['presidio']} fragmentos protegidos antes do Gemini.\n"
                       f"- Gemini: {stats['gemini']} deteções adicionais.\n"
                       '- O relatório reflete as seleções atuais da revisão.\n')
            return {'file_name': session['file_name'], 'text': render_review_text(request.lines), 'report': report}


def create_app(service=None):
    service = service or SessionService()
    @asynccontextmanager
    async def lifespan(app):
        async def cleanup():
            while True:
                await asyncio.sleep(30)
                service.purge()
        cleaner = asyncio.create_task(cleanup())
        service.executor.submit(service.warm)
        yield
        cleaner.cancel()
        with suppress(asyncio.CancelledError):
            await cleaner
        service.executor.shutdown(wait=True, cancel_futures=True)
        service.delivery_executor.shutdown(wait=True, cancel_futures=True)
        service.sessions.clear()

    app = FastAPI(title='Hidden local API', lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.service = service
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', '[::1]', 'testserver'])

    @app.middleware('http')
    async def boundaries(request: Request, call_next):
        if request.url.path.startswith('/api'):
            origin = request.headers.get('origin')
            same_origin = origin == f'{request.url.scheme}://{request.headers.get("host", "")}'
            from_extension = origin == EXTENSION_ORIGIN and EXTENSION_ROUTES.match(request.url.path)
            if origin and not same_origin and not from_extension:
                return JSONResponse({'error': 'Use the application on the same local origin.'}, status_code=403)
            if request.method in ('POST', 'PUT', 'PATCH'):
                pdf_export = request.url.path.endswith(('/export/pdf', '/sessions/upload'))
                media_type = request.headers.get('content-type', '').split(';')[0]
                expected = 'multipart/form-data' if pdf_export else 'application/json'
                if media_type != expected:
                    return JSONResponse({'error': f'Expected {expected}.'}, status_code=415)
                limit = 24 * 1024 * 1024 if pdf_export else MAX_BODY
                size = 0
                chunks = []
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > limit:
                        return JSONResponse({'error': 'Request is too large.'}, status_code=413)
                    chunks.append(chunk)
                request._body = b''.join(chunks)
        response = await call_next(request)
        if request.headers.get('origin') == EXTENSION_ORIGIN:
            response.headers['Access-Control-Allow-Origin'] = EXTENSION_ORIGIN
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        return response

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        return JSONResponse({'error': error.detail}, status_code=error.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        # Pydantic's default response echoes input data; omit that deliberately.
        return JSONResponse({'error': 'Invalid document: use 1–5,000 text lines, at most 200,000 characters, and valid categories.'}, status_code=422)

    @app.get('/api/health')
    def health():
        try:
            configured = bool(engine.carregar_chave())
        except ValueError:
            configured = False
        return {'service': 'hidden', 'status': 'ok', 'gemini_configured': configured, 'model': service.model}

    @app.post('/api/public/sessions', status_code=202)
    def create(data: SessionInput):
        return service.create(data)

    @app.post('/api/public/sessions/upload', status_code=202)
    async def upload(file: UploadFile = File(...)):
        """Extension flow: receive the PDF, extract text locally, start the pipeline."""
        content = await file.read(MAX_PDF + 1)
        await file.close()
        if len(content) > MAX_PDF:
            raise HTTPException(413, 'PDF exceeds 20 MB.')
        if not content.startswith(b'%PDF-'):
            raise HTTPException(415, 'The file is not a valid PDF.')
        lines = await asyncio.to_thread(pdf_lines, content)
        try:
            data = SessionInput(file_name=file.filename or 'document.pdf', lines=lines,
                                pdf_sha256=hashlib.sha256(content).hexdigest())
        except ValueError:
            raise HTTPException(422, 'Invalid document: use at most 5,000 lines and 200,000 characters.') from None
        return service.create(data, pdf=content)

    @app.get('/api/public/sessions/{sid}')
    def get(sid: str):
        with service.lock:
            return service.public(service.get(sid))

    @app.delete('/api/public/sessions/{sid}', status_code=204)
    def delete(sid: str):
        with service.lock:
            service.sessions.pop(sid, None)
        return Response(status_code=204)

    @app.post('/api/public/sessions/{sid}/render')
    def render(sid: str, data: RenderInput):
        return service.render(sid, data)

    @app.post('/api/public/sessions/{sid}/export/pdf')
    async def export_pdf(sid: str, review: str = Form(...), file: Optional[UploadFile] = File(None)):
        try:
            data = RenderInput.model_validate_json(review)
        except ValueError:
            raise HTTPException(422, 'Invalid review selections.') from None
        content = None
        if file is not None:
            content = await file.read(MAX_PDF + 1)
            await file.close()
            if len(content) > MAX_PDF:
                raise HTTPException(413, 'PDF exceeds 20 MB.')
        with service.lock:
            session = service.get(sid)
            if content is None:
                content = session.get('pdf')
                if not content:
                    raise HTTPException(400, 'Select the original PDF to export this review.')
            digest = session.get('pdf_sha256')
            if digest and hashlib.sha256(content).hexdigest() != digest:
                raise HTTPException(400, 'Select the exact original PDF used for this review.')
            result = service.render(sid, data)
            original = list(session['original'])
            name = session['file_name']
        try:
            pdf = await asyncio.to_thread(redact_pdf, content, original, data.lines)
        except ValueError as error:
            raise HTTPException(400, str(error)) from None
        # One immutable export folder per revision; never overwrite previous work.
        safe_name = re.sub(r'[^\w.-]+', '_', Path(name).stem)[:80] or 'document'
        folder = engine.ROOT / 'output' / f'{safe_name}-{uuid.uuid4().hex}'
        folder.mkdir(parents=True, exist_ok=False)
        engine.guardar_texto(folder / 'anonimizado.txt', result['text'])
        engine.guardar_texto(folder / 'relatorio.md', result['report'])
        return Response(pdf, media_type='application/pdf',
                        headers={'Content-Disposition': 'attachment; filename="anonymized.pdf"'})

    def default_segments(session):
        return [[Segment(text=t['text'], masked=t.get('category') in session['categories']) for t in line]
                for line in session['lines']]

    @app.get('/api/public/sessions/{sid}/masked.pdf')
    async def masked_pdf(sid: str):
        """Extension "Download masked version": initial suggestions, stored PDF."""
        with service.lock:
            session = service.get(sid)
            if session['status'] != 'ready':
                raise HTTPException(409, 'Wait until processing is complete.')
            if not session.get('pdf'):
                raise HTTPException(409, 'This review has no stored PDF. Download it from the review page.')
            review = RenderInput(lines=default_segments(session))
            result = service.render(sid, review)
            content, original, name = session['pdf'], list(session['original']), session['file_name']
        try:
            pdf = await asyncio.to_thread(redact_pdf, content, original, review.lines)
        except ValueError as error:
            raise HTTPException(400, str(error)) from None
        safe_name = re.sub(r'[^\w.-]+', '_', Path(name).stem)[:80] or 'document'
        folder = engine.ROOT / 'output' / f'{safe_name}-{uuid.uuid4().hex}'
        folder.mkdir(parents=True, exist_ok=False)
        engine.guardar_texto(folder / 'anonimizado.txt', result['text'])
        engine.guardar_texto(folder / 'relatorio.md', result['report'])
        return Response(pdf, media_type='application/pdf',
                        headers={'Content-Disposition': f'attachment; filename="{safe_name}-anonymized.pdf"'})

    @app.get('/api/public/sessions/{sid}/masked')
    def masked(sid: str):
        with service.lock:
            session = service.get(sid)
            if session['status'] != 'ready':
                raise HTTPException(409, 'Wait until processing is complete.')
            segments = [[Segment(text=t['text'], masked=t.get('category') in session['categories']) for t in line] for line in session['lines']]
            result = service.render(sid, RenderInput(lines=segments))
            return Response(result['text'], media_type='text/plain; charset=utf-8',
                            headers={'Content-Disposition': 'attachment; filename="anonymized.txt"'})

    if (DIST / 'assets').is_dir():
        app.mount('/assets', StaticFiles(directory=DIST / 'assets'), name='assets')

    @app.get('/{path:path}')
    def frontend(path: str):
        if path and not re.fullmatch(r'review/[A-Za-z0-9_-]{24,64}', path):
            raise HTTPException(404, 'Not found.')
        if not (DIST / 'index.html').is_file():
            raise HTTPException(503, 'Build the frontend first: python run_app.py --build')
        return FileResponse(DIST / 'index.html')

    return app


app = create_app()
