"""Exercise HTTP sessions and review exports without sending data to Gemini."""
import threading
import time
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from submission import main as engine
from submission.web_api import create_app, SessionService, tokenize, MAX_BODY


class WebTests(unittest.TestCase):
    def setUp(self):
        self.service = SessionService(model='test-model')
        self.key = patch.object(engine, 'carregar_chave', return_value='fake')
        self.analyzer = patch.object(engine, 'build_analyzer', return_value=object())
        self.local = patch.object(engine, 'detect_presidio', return_value=[engine.Entity(6, 17, 'IDENTIFICACAO', 'presidio', 'PERSON')])
        self.calls = []
        def api(prompt, *args, **kwargs):
            self.calls.append(prompt)
            self.assertNotIn('Ana Correia', prompt)
            self.assertIn('Nome: * *', prompt)
            if 'AUDITORIA FINAL' in prompt:
                self.assertNotIn('diabetes', prompt)
                return {'entidades': []}
            return {'entidades': [{'texto': 'diabetes', 'categoria': 'SAUDE'}]}
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = patch.object(engine, "ROOT", Path(self.folder.name))
        self.root.start()
        self.addCleanup(self.root.stop)
        self.api = patch.object(engine, 'chamar_gemini', side_effect=api)
        for p in (self.key, self.analyzer, self.local, self.api):
            p.start()
            self.addCleanup(p.stop)
        self.client = TestClient(create_app(self.service))
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def create(self, **overrides):
        body = {'file_name': 'sample.pdf', 'lines': ['Nome: Ana Correia', '', 'Diagnóstico: diabetes'],
                'categories': ['Name', 'Health']}
        body.update(overrides)
        response = self.client.post('/api/public/sessions', json=body)
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()['session_id']

    def ready(self, sid):
        for _ in range(200):
            payload = self.client.get('/api/public/sessions/' + sid).json()
            if payload['status'] in ('ready', 'failed'):
                return payload
            time.sleep(.01)
        self.fail('Worker did not finish')

    def test_full_flow_privacy_and_review_exports(self):
        sid = self.create()
        session = self.ready(sid)
        self.assertEqual(session['status'], 'ready')
        self.assertEqual(session['stats'], {'presidio': 1, 'gemini': 1, 'total': 2})
        self.assertEqual([''.join(t['text'] for t in line) for line in session['lines']], ['Nome: Ana Correia', 'Diagnóstico: diabetes'])
        self.assertEqual(len(self.calls), 2)
        segments = [[{'text': t['text'], 'masked': bool(t.get('category'))} for t in line] for line in session['lines']]
        response = self.client.post(f'/api/public/sessions/{sid}/render', json={'lines': segments})
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result['text'], 'Nome: * *\nDiagnóstico: *\n')
        self.assertNotIn('Ana Correia', result['report'])
        self.assertNotIn('diabetes', result['report'])
        self.assertEqual(response.headers['cache-control'], 'no-store')
        segments[0][1]['masked'] = False
        result = self.client.post(f'/api/public/sessions/{sid}/render', json={'lines': segments}).json()
        self.assertIn('Ana Correia', result['text'])
        self.assertIn('**1**', result['report'])
        self.assertEqual(self.client.get(f'/api/public/sessions/{sid}/masked').text, 'Nome: * *\nDiagnóstico: *\n')

    def test_rejects_modified_text(self):
        sid = self.create()
        self.ready(sid)
        response = self.client.post(f'/api/public/sessions/{sid}/render', json={'lines': [[{'text': 'changed', 'masked': True}]]})
        self.assertEqual(response.status_code, 400)

    def test_manual_split_preserves_spacing(self):
        sid = self.create()
        self.ready(sid)
        lines = [[{'text': 'Nome: ', 'masked': False}, {'text': 'Ana ', 'masked': True}, {'text': 'Correia', 'masked': False}],
                 [{'text': 'Diagnóstico: diabetes', 'masked': False}]]
        result = self.client.post(f'/api/public/sessions/{sid}/render', json={'lines': lines}).json()
        self.assertEqual(result['text'], 'Nome: * Correia\nDiagnóstico: diabetes\n')

    def test_errors_never_publish_partial_results(self):
        with patch.object(engine, 'chamar_gemini', side_effect=RuntimeError('SECRET')):
            sid = self.create()
            session = self.ready(sid)
        self.assertEqual(session['status'], 'failed')
        self.assertEqual(session['lines'], [])
        self.assertNotIn('SECRET', str(session))
        self.assertEqual(self.client.get(f'/api/public/sessions/{sid}/masked').status_code, 409)

    def test_invalid_input_does_not_echo_document(self):
        for body in ({'file_name': 'x', 'lines': ['PRIVATE\nTEXT']},
                     {'file_name': 'x', 'lines': ['PRIVATE'], 'categories': ['unknown']},
                     {'file_name': 'x', 'lines': ['PRIVATE' * 30000]},
                     {'file_name': 'x', 'lines': ['  ']}):
            response = self.client.post('/api/public/sessions', json=body)
            self.assertEqual(response.status_code, 422)
            self.assertNotIn('PRIVATE', response.text)

    def test_foreign_origin_and_large_body(self):
        self.assertEqual(self.client.post('/api/public/sessions', json={}, headers={'Origin': 'https://evil.example'}).status_code, 403)
        self.assertEqual(self.client.post('/api/public/sessions', content='x' * (MAX_BODY + 1), headers={'Content-Type': 'application/json'}).status_code, 413)

    def test_expiration_and_deletion(self):
        sid = self.create()
        self.ready(sid)
        with self.service.lock:
            self.service.sessions[sid]['deadline'] = 0
        self.assertEqual(self.client.get('/api/public/sessions/' + sid).status_code, 410)
        sid = self.create()
        self.ready(sid)
        self.assertEqual(self.client.delete('/api/public/sessions/' + sid).status_code, 204)
        self.assertEqual(self.client.get('/api/public/sessions/' + sid).status_code, 404)

    def test_category_settings_do_not_bypass_presidio_before_gemini(self):
        sid = self.create(categories=['Health'])
        self.assertEqual(self.ready(sid)['status'], 'ready')
        self.assertEqual(self.client.get(f'/api/public/sessions/{sid}/masked').text, 'Nome: Ana Correia\nDiagnóstico: *\n')
        self.assertNotIn('Ana Correia', self.calls[0])

    def test_multiline_and_unicode_offsets(self):
        text = '💡 Nome: Ana\nCorreia\n'
        doc = engine.Document(text, [engine.Entity(text.index('Ana'), text.index('Correia') + 7, 'IDENTIFICACAO', 'llm')])
        lines = tokenize(doc)
        self.assertEqual([''.join(t['text'] for t in line) for line in lines], text.splitlines())
        ids = [t['id'] for line in lines for t in line]
        self.assertEqual(len(ids), len(set(ids)))

    def test_pdf_export_reflows_current_choices(self):
        import hashlib
        import pymupdf
        pdf = pymupdf.open()
        pdf.new_page().insert_text((72, 72), "Nome: Ana Correia")
        pdf.new_page().insert_text((72, 72), "Diagnóstico: diabetes")
        content = pdf.tobytes()
        pdf.close()
        sid = self.create(pdf_sha256=hashlib.sha256(content).hexdigest())
        session = self.ready(sid)
        lines = [[{'text': t['text'], 'masked': t.get('category') == 'Health'} for t in line] for line in session['lines']]
        import json
        response = self.client.post(f'/api/public/sessions/{sid}/export/pdf', data={'review': json.dumps({'lines': lines})}, files={'file': ('sample.pdf', content, 'application/pdf')})
        self.assertEqual(response.status_code, 200, response.text if response.status_code != 200 else '')
        self.assertEqual(response.headers['content-type'], 'application/pdf')
        with pymupdf.open(stream=response.content, filetype='pdf') as result:
            self.assertEqual(len(result), 1)
            self.assertAlmostEqual(result[0].rect.width, 595.276, places=2)
            self.assertAlmostEqual(result[0].rect.height, 841.89, places=2)
            extracted = ''.join(p.get_text() for p in result)
            self.assertNotIn('diabetes', extracted)
            self.assertIn('Ana Correia', extracted)
            self.assertIn('*', extracted)
        outputs = list(Path(self.folder.name).glob('output/*/anonimizado.txt'))
        self.assertEqual(len(outputs), 1)
        self.assertEqual(outputs[0].read_text(), 'Nome: Ana Correia\nDiagnóstico: *\n')
        bad = self.client.post(f'/api/public/sessions/{sid}/export/pdf', data={'review': json.dumps({'lines': lines})}, files={'file': ('wrong.pdf', b'wrong', 'application/pdf')})
        self.assertEqual(bad.status_code, 400)


if __name__ == '__main__':
    unittest.main()
