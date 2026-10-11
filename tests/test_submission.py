"""Submission fidelity: local mask processing must never replace the model answer."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from submission import anonymize as app
import main as engine


class SubmissionTests(unittest.TestCase):
    def test_web_delivery_protects_input_and_preserves_model_text(self):
        answer = 'Nome: * *\nSaldo: 50 €'
        from submission import main as web_engine
        with patch.object(web_engine, 'detect_presidio', return_value=[engine.Entity(6, 17, 'IDENTIFICACAO', 'presidio', 'PERSON')]), \
             patch.object(app, 'chamar_gemini', return_value={'entidades': [], 'texto_anonimizado': answer}) as api:
            text, prompt = app.gerar_entrega('Nome: Ana Correia\nSaldo: 50 €\n', object(), 'fake', 'model')
        self.assertEqual(text, answer)
        self.assertNotIn('Ana Correia', prompt.split('<documento>')[-1])
        self.assertEqual(prompt, api.call_args.args[0])
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            app.guardar_entrega(text, prompt, root)
            self.assertEqual((root / 'submission.txt').read_bytes(), answer.encode())
            self.assertEqual((root / 'prompt.txt').read_bytes(), prompt.encode())
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['prompt.txt', 'submission.txt'])

    def test_invalid_layout_is_retried_without_changing_prompt_or_answer(self):
        sent = 'Nome: * *\nSaldo: 50 €\n'
        good = 'Nome: * *\nSaldo: * *'
        with patch.object(app, 'chamar_gemini', side_effect=[
                {'entidades': [], 'texto_anonimizado': 'Nome: * * Saldo: * *'},
                {'entidades': [], 'texto_anonimizado': good}]) as api:
            result = app.anonimizar('exact prompt', sent, 'fake', 'model', 3, exigir_formatacao=True)
        self.assertEqual(result['texto_modelo'], good)
        self.assertEqual([call.args[0] for call in api.call_args_list], ['exact prompt'] * 2)
        with patch.object(app, 'chamar_gemini', return_value={'entidades': [], 'texto_anonimizado': 'bad'}) as api:
            with self.assertRaises(ValueError):
                app.anonimizar('exact prompt', sent, 'fake', 'model', 3, exigir_formatacao=True)
        self.assertEqual(api.call_count, 3)

    def test_failed_second_write_restores_previous_delivery(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            app.guardar_entrega('old answer', 'old prompt', root)
            replace = app.os.replace
            calls = []
            def fail_second(source, destination):
                calls.append(destination)
                if len(calls) == 2:
                    raise OSError('disk failure')
                return replace(source, destination)
            with patch.object(app.os, 'replace', side_effect=fail_second):
                with self.assertRaises(OSError):
                    app.guardar_entrega('new answer', 'new prompt', root)
            self.assertEqual((root / 'submission.txt').read_text(), 'old answer')
            self.assertEqual((root / 'prompt.txt').read_text(), 'old prompt')
            self.assertEqual(len(list(root.iterdir())), 2)

    def test_protected_snapshot_is_reused_without_local_redetection(self):
        from submission import main as web_engine
        with patch.object(web_engine, 'detect_presidio') as detect, \
             patch.object(app, 'chamar_gemini', return_value={'entidades': [], 'texto_anonimizado': 'Nome: * *'}) as api:
            answer, prompt = app.gerar_entrega('Nome: Ana Correia', object(), 'fake', 'model', texto_protegido='Nome: * *')
        detect.assert_not_called()
        self.assertEqual(answer, 'Nome: * *')
        self.assertNotIn('Ana Correia', api.call_args.args[0].split('<documento>')[-1])

    def test_web_delivery_saves_model_output_even_when_lines_differ(self):
        answer = 'Nome: * * Saldo: * *'
        with patch.object(app, 'chamar_gemini', return_value={'entidades': [], 'texto_anonimizado': answer}) as api:
            text, prompt = app.gerar_entrega('Nome: Ana Correia\nSaldo: 50 €', object(), 'fake', 'model',
                                            texto_protegido='Nome: * *\nSaldo: 50 €')
        self.assertEqual(text, answer)
        self.assertEqual(prompt, api.call_args.args[0])
        self.assertEqual(api.call_count, 1)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            app.guardar_entrega(text, prompt, root)
            self.assertEqual((root / 'submission.txt').read_bytes(), answer.encode('utf-8'))
            self.assertEqual((root / 'prompt.txt').read_bytes(), prompt.encode('utf-8'))

    def test_main_saves_model_text_exactly_even_when_local_union_differs(self):
        sent='Nome: * *\nDiagnóstico: diabetes\n'
        answer='Nome: * *\nDiagnóstico: diabetes'
        payload={'entidades': [{'texto': 'diabetes', 'categoria': 'SAUDE', 'motivo': 'diagnóstico'}],
                 'texto_anonimizado': answer}
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);dest=root/'submission.txt';prompt=root/'prompt.txt';meta=root/'meta.json'
            with patch.object(engine, 'extrair_texto', return_value=sent), \
                 patch.object(app, 'mascarar_presidio', return_value=sent), \
                 patch.object(engine, 'carregar_chave', return_value='fake'), \
                 patch.object(app, 'chamar_gemini', return_value=payload) as api:
                code=app.main(['--pdf',str(root/'input.pdf'),'--submission',str(dest),
                               '--prompt',str(prompt),'--entidades',str(meta)])
            self.assertEqual(code,0)
            self.assertEqual(dest.read_bytes(),answer.encode('utf-8'))
            self.assertEqual(prompt.read_text(),api.call_args.args[0])
            self.assertIn('diabetes',dest.read_text())

    def test_validation_does_not_replace_the_model_answer_with_local_fallback(self):
        answer='Resposta do modelo com linhas diferentes'
        payload={'entidades': [],'texto_anonimizado':answer}
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);dest=root/'submission.txt'
            with patch.object(engine, 'extrair_texto', return_value='Nome: *\n'), \
                 patch.object(app, 'mascarar_presidio', return_value='Nome: *\n'), \
                 patch.object(engine, 'carregar_chave', return_value='fake'), \
                 patch.object(app, 'chamar_gemini', return_value=payload):
                code=app.main(['--pdf',str(root/'input.pdf'),'--submission',str(dest),
                               '--prompt',str(root/'prompt.txt'),'--entidades',str(root/'meta.json')])
            self.assertEqual(code,0)
            self.assertEqual(dest.read_bytes(),answer.encode('utf-8'))
