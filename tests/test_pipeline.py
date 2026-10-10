"""Testes locais; não enviam documentos nem fazem chamadas à API."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "submission" / "main.py"
spec = importlib.util.spec_from_file_location("anonimizador", SCRIPT)
app = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = app
spec.loader.exec_module(app)


class PipelineTests(unittest.TestCase):
    def test_campos_corrigem_falsos_positivos_sem_remover_instituicoes(self):
        text = "Estado civil: Divorciada\nPrescrição: Losartana 50mg\nOcupação: Professora na Faculdade de Direito de Lisboa\nEspecialidade: Medicina Interna\n"
        values = [("Divorciada", "PERSON"), ("Losartana", "PERSON"), ("Faculdade de Direito de Lisboa", "OCUPACAO"), ("Medicina Interna", "OUTRO")]
        doc = app.Document(text, [app.Entity(text.index(v), text.index(v)+len(v), "IDENTIFICACAO", "presidio", subtype=t) for v,t in values])
        found = app.refine_field_categories(doc)
        self.assertEqual([(e.entity_type,e.subtype) for e in found], [("SENSIVEL", "ESTADO_CIVIL"), ("SAUDE", "PRESCRICAO")])

    def test_ocupacao_nao_inclui_instituicao_e_termo_nao_e_nome(self):
        text="Ocupação: Professora na Faculdade de Direito\nDefinição: Diabetes\n"
        left=text.index("Professora");right=text.index("\n"); term=text.index("Diabetes")
        doc=app.Document(text,[app.Entity(left,right,"SENSIVEL","llm",subtype="OCUPACAO"),app.Entity(term,term+8,"IDENTIFICACAO","presidio",subtype="PERSON")])
        found=app.refine_field_categories(doc)
        self.assertEqual(len(found),1)
        self.assertEqual(app.apply_mask(text,found),"Ocupação: * na Faculdade de Direito\nDefinição: Diabetes\n")

    def test_preserva_texto_e_remove_linhas_vazias(self):
        self.assertEqual(app.limpar_texto("Olá!  \n\n \nLinha 2.\n"), "Olá!\nLinha 2.\n")

    def test_mascara_por_palavra_e_preserva_linhas(self):
        text = "Nome: Ana Correia\nEmail: ana@example.com\n"
        entities = [app.Entity(6, 17, "IDENTIFICACAO"), app.Entity(25, 40, "CONTACTO")]
        self.assertEqual(app.apply_mask(text, entities), "Nome: * *\nEmail: *\n")

    def test_mascara_identificador_completo(self):
        text = "CRM: 12345-PT\n"
        self.assertEqual(app.apply_mask(text, [app.Entity(5, 8, "IDENTIFICACAO")]), "CRM: *\n")

    def test_sobreposicoes_e_rejeicao_manual(self):
        entities = [app.Entity(0, 3, "ID", "presidio"), app.Entity(0, 11, "ID", "llm")]
        merged = app.merge_entities(entities)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0].source, "llm+presidio")
        merged[0].status = app.REJECTED
        self.assertEqual(app.apply_mask("Ana Correia", merged), "Ana Correia")
        self.assertEqual(entities[0].end, 3)

    def test_intervalo_invalido(self):
        with self.assertRaises(ValueError):
            app.apply_mask("abc", [app.Entity(-1, 2, "ID")])

    def test_cache_depende_do_documento_prompt_e_modelo(self):
        response = {"entidades": [{"texto": "Ana Correia", "categoria": "IDENTIFICACAO"}]}
        with tempfile.TemporaryDirectory() as folder, patch.object(app, "chamar_gemini", return_value=response) as api:
            cache = Path(folder) / "cache.json"
            doc = app.Document("Ana Correia")
            app.detect_llm(doc, "prompt", "fake", "modelo", cache)
            app.detect_llm(doc, "prompt", "fake", "modelo", cache)
            self.assertEqual(api.call_count, 1)
            app.detect_llm(doc, "outro prompt", "fake", "modelo", cache)
            app.detect_llm(doc, "outro prompt", "fake", "outro modelo", cache)
            self.assertEqual(api.call_count, 3)

    def test_fragmento_llm_com_quebra_de_linha(self):
        response = {"entidades": [{"texto": "Ana Correia", "categoria": "IDENTIFICACAO"}]}
        with tempfile.TemporaryDirectory() as folder, patch.object(app, "chamar_gemini", return_value=response):
            doc = app.Document("Nome: Ana\nCorreia\n")
            found, unmatched = app.detect_llm(doc, "p", "fake", "fake", Path(folder) / "cache.json")
            self.assertEqual(unmatched, [])
            self.assertEqual(app.apply_mask(doc.text, found), "Nome: *\n*\n")

    def test_fragmento_inexistente_nao_e_aceite(self):
        response = {"entidades": [{"texto": "Pessoa inexistente", "categoria": "IDENTIFICACAO"}]}
        with tempfile.TemporaryDirectory() as folder, patch.object(app, "chamar_gemini", return_value=response):
            cache = Path(folder) / "cache.json"
            with self.assertRaises(ValueError):
                app.detect_llm(app.Document("Ana Correia"), "p", "fake", "fake", cache)
            self.assertFalse(cache.exists())

    def test_relatorio_nao_reproduz_valores(self):
        doc = app.Document("Ana Correia")
        report = app.build_report(doc, [app.Entity(0, 11, "IDENTIFICACAO")], [], "teste")
        self.assertNotIn(doc.text, report)

    def test_pdf_inexistente(self):
        with tempfile.TemporaryDirectory() as folder, self.assertRaises(ValueError):
            app.extrair_texto(Path(folder) / "inexistente.pdf")

    def test_gemini_so_recebe_texto_protegido_e_intervalos_sao_restaurados(self):
        text = "Nome: Ana Correia\nEmail: ana@example.com\nDiagnóstico: diabetes\n"
        local = [app.Entity(6, 17, "IDENTIFICACAO", "presidio"),
                 app.Entity(25, 40, "CONTACTO", "presidio")]
        doc = app.Document(text, local)
        protected, positions = app.preparar_para_gemini(doc)
        self.assertNotIn("Ana Correia", protected.text)
        self.assertNotIn("ana@example.com", protected.text)
        self.assertIn("diabetes", protected.text)
        start = protected.text.index("diabetes")
        projected = app.projetar_entidades([app.Entity(start, start + 8, "SAUDE", "llm")], positions)
        self.assertEqual(text[projected[0].start:projected[0].end], "diabetes")
        final = app.apply_mask(text, local + projected)
        self.assertEqual(final, "Nome: * *\nEmail: *\nDiagnóstico: *\n")

    def test_pipeline_presidio_antes_da_api(self):
        text = "Nome: Ana Correia\nDiagnóstico: diabetes\n"
        response = {"entidades": [{"texto": "diabetes", "categoria": "SAUDE"}]}
        def api(prompt, *args, **kwargs):
            self.assertNotIn("Ana Correia", prompt)
            if "AUDITORIA FINAL" in prompt:
                self.assertNotIn("diabetes", prompt)
                return {"entidades": []}
            self.assertIn("Nome: * *", prompt)
            self.assertIn("diabetes", prompt)
            return response
        with tempfile.TemporaryDirectory() as folder, \
             patch.object(app, "extrair_texto", return_value=text), \
             patch.object(app, "build_analyzer"), \
             patch.object(app, "detect_presidio", return_value=[app.Entity(6, 17, "IDENTIFICACAO", "presidio")]), \
             patch.object(app, "carregar_chave", return_value="fake"), \
             patch.object(app, "chamar_gemini", side_effect=api) as gemini:
            root = Path(folder)
            args = ["--pdf", str(root / "input.pdf"), "--saida", str(root / "out.txt"),
                    "--relatorio", str(root / "report.md"), "--prompt", str(root / "prompt.txt"),
                    "--cache", str(root / "cache.json")]
            self.assertEqual(app.main(args), 0)
            self.assertEqual((root / "out.txt").read_text(), "Nome: * *\nDiagnóstico: *\n")
            self.assertNotIn("Ana Correia", (root / "prompt.txt").read_text())
            self.assertEqual(gemini.call_count, 2)

    def test_localizacao_por_linha_nao_mascara_outra_ocorrencia(self):
        response = {"entidades": [{"texto": "123", "categoria": "FINANCEIRO", "tipo": "CVV", "linha": 2, "ocorrencia": 0}]}
        with tempfile.TemporaryDirectory() as folder, patch.object(app, "chamar_gemini", return_value=response):
            doc = app.Document("Referência administrativa: 123\nCVV: 123\n")
            found, _ = app.detect_llm(doc, "p", "fake", "fake", Path(folder) / "cache.json")
            self.assertEqual(app.apply_mask(doc.text, found), "Referência administrativa: 123\nCVV: *\n")

    def test_tipo_desconhecido_e_rejeitado(self):
        response = {"entidades": [{"texto": "123", "categoria": "SAUDE", "tipo": "DESCONHECIDO", "linha": 1, "ocorrencia": 0}]}
        with tempfile.TemporaryDirectory() as folder, patch.object(app, "chamar_gemini", return_value=response):
            with self.assertRaises(ValueError):
                app.detect_llm(app.Document("123"), "p", "fake", "fake", Path(folder) / "cache.json")

    def test_identificadores_com_hifen_e_campos_financeiros(self):
        import re
        samples = {"CITIZEN_CARD": "12345678-9ZX0", "BIOMETRIC_ID": "ID-BIO-12345 FACE-ID-78901", "CREDIT_CARD": "validade 09/27, CVV 123"}
        for kind, text in samples.items():
            matches = [m.group() for entity, _, pattern, _ in app._PATTERNS if entity == kind for m in re.finditer(pattern, text)]
            self.assertTrue(matches, kind)
        bio = [m.group() for entity, _, pattern, _ in app._PATTERNS if entity == "BIOMETRIC_ID" for m in re.finditer(pattern, samples["BIOMETRIC_ID"])]
        self.assertEqual(bio, ["ID-BIO-12345", "FACE-ID-78901"])

    def test_auditoria_cobre_dose_e_frequencia_sem_reenviar_nome(self):
        text = "Nome: Ana Correia\nPrescrição: Medicamento 50mg 1x/dia\n"
        response = {"entidades": [{"texto": "Medicamento", "categoria": "SAUDE", "tipo": "PRESCRICAO", "linha": 2, "ocorrencia": 0}]}
        audit = {"entidades": [{"texto": "50mg 1x/dia", "categoria": "SAUDE", "tipo": "PRESCRICAO", "linha": 2, "ocorrencia": 0}]}
        prompts = []
        def api(prompt, *args, **kwargs):
            prompts.append(prompt)
            self.assertNotIn("Ana Correia", prompt)
            if "AUDITORIA FINAL" in prompt:
                self.assertNotIn("Medicamento", prompt)
                return audit
            return response
        with tempfile.TemporaryDirectory() as folder, patch.object(app, "detect_presidio", return_value=[app.Entity(6, 17, "IDENTIFICACAO", "presidio")]), patch.object(app, "chamar_gemini", side_effect=api):
            doc = app.Document(text)
            app.process_document(doc, object(), "fake", "fake", Path(folder) / "cache.json")
            self.assertEqual(app.apply_mask(text, doc.entities), "Nome: * *\nPrescrição: * * *\n")
            self.assertEqual(len(prompts), 2)

    def test_tipo_especifico_determina_categoria_e_linha_errada_unica(self):
        response = {"entidades": [{"texto": "diabetes", "categoria": "IDENTIFICACAO", "tipo": "DIAGNOSTICO", "linha": 1, "ocorrencia": 0}]}
        with tempfile.TemporaryDirectory() as folder, patch.object(app, "chamar_gemini", return_value=response):
            doc = app.Document("Cabeçalho\nDiagnóstico: diabetes\n")
            found, _ = app.detect_llm(doc, "p", "fake", "fake", Path(folder) / "cache.json")
            self.assertEqual(found[0].entity_type, "SAUDE")
            self.assertEqual(doc.text[found[0].start:found[0].end], "diabetes")

    def test_contexto_geral_versus_pessoal_em_varias_categorias(self):
        cases = [("exame de glicemia", "SAUDE", "CLINICO"), ("rendimento anual", "FINANCEIRO", "RENDIMENTO"), ("católica", "RELIGIAO", "RELIGIAO"), ("política", "POLITICA", "POLITICA")]
        for value, category, subtype in cases:
            with self.subTest(category=category):
                text = f"Informação geral: {value}\nDados da paciente: {value}\n"
                first = text.index(value); last = text.rindex(value)
                doc = app.Document(text, [app.Entity(first, first+len(value), category, "llm", subtype=subtype), app.Entity(last,last+len(value),category,"llm",subtype=subtype)])
                found = app.filter_general_context(doc)
                self.assertEqual([(e.start,e.end) for e in found], [(last,last+len(value))])

    def test_nao_mascara_secao_inteira_e_preserva_identificadores(self):
        text = "Histórico Médico:\nAna tem diabetes. Informação administrativa permanece.\nOrientações gerais:\nExame de glicemia.\nConta: PT12345\n"
        name=text.index("Ana"); disease=text.index("diabetes"); general=text.index("glicemia"); account=text.index("PT12345")
        doc=app.Document(text,[app.Entity(name,name+3,"IDENTIFICACAO","presidio",subtype="PERSON"),app.Entity(disease,disease+8,"SAUDE","llm",subtype="DIAGNOSTICO"),app.Entity(general,general+8,"SAUDE","llm",subtype="CLINICO"),app.Entity(account,account+7,"FINANCEIRO","presidio",subtype="IBAN_CODE")])
        found=app.filter_general_context(doc)
        result=app.apply_mask(text,found)
        self.assertIn("Informação administrativa permanece",result)
        self.assertIn("Exame de glicemia",result)
        self.assertNotIn("PT12345",result)
        self.assertNotIn("Ana",result)



if __name__ == "__main__":
    unittest.main()
