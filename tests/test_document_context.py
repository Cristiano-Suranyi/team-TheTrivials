"""Automatic document context must preserve useful facts without releasing identities."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from submission import main as app


class DocumentContextTests(unittest.TestCase):
    def test_context_only_accepts_safe_types_and_valid_lines(self):
        self.assertEqual(app.validate_context(None, 3)["preservar"], [])
        for value in (
            {"tema": "saude", "preservar": [{"linha": 1, "tipos": ["NOME"]}]},
            {"tema": "saude", "preservar": [{"linha": 4, "tipos": ["CLINICO"]}]},
            {"tema": "arbitrary", "preservar": []},
            {"tema": "saude", "preservar": [{"linha": True, "tipos": ["CLINICO"]}]},
        ):
            with self.assertRaises(ValueError):
                app.validate_context(value, 3)
        value = app.validate_context({"tema": "saude", "preservar": [], "details": "Ana"}, 3)
        self.assertNotIn("details", value)

    def test_medical_values_remain_but_identities_stay_hidden_in_both_calls(self):
        text = ("Relatório clínico\nNome: Ana Correia\nDiagnóstico: diabetes\n"
                "Prescrição: Losartana 50mg 1x/dia\nTipo sanguíneo: O+\n"
                "Altura: 1,68m\nGenética: mutação BRCA1 positiva\n"
                "Impressão digital registrada no sistema: ID-BIO-12345\n"
                "Familia: João tem diabetes\n")
        def entity(value, kind, subtype):
            start = text.index(value)
            return app.Entity(start, start + len(value), kind, "presidio", subtype=subtype)
        local = [entity("Ana Correia", "IDENTIFICACAO", "PERSON"),
                 entity("Losartana", "IDENTIFICACAO", "PERSON"),
                 entity("ID-BIO-12345", "BIOMETRICO", "BIOMETRIC_ID")]
        context = {"tema": "saude", "preservar": [
            {"linha": 3, "tipos": ["DIAGNOSTICO"]},
            {"linha": 4, "tipos": ["PRESCRICAO"]},
            {"linha": 5, "tipos": ["CLINICO"]},
            {"linha": 6, "tipos": ["BIOMETRICO"]},
            {"linha": 7, "tipos": ["GENETICO"]},
            {"linha": 8, "tipos": ["BIOMETRICO"]},
            {"linha": 9, "tipos": ["CLINICO"]},
        ]}
        response = {"contexto": context, "entidades": [
            {"texto": "diabetes", "linha": 3, "ocorrencia": 0, "categoria": "SAUDE", "tipo": "DIAGNOSTICO"},
            {"texto": "50mg 1x/dia", "categoria": "SAUDE", "tipo": "PRESCRICAO"},
            {"texto": "O+", "categoria": "SAUDE", "tipo": "CLINICO"},
            {"texto": "1,68m", "categoria": "BIOMETRICO", "tipo": "BIOMETRICO"},
            {"texto": "mutação BRCA1 positiva", "categoria": "GENETICO", "tipo": "GENETICO"},
            # Overlapping medical and name detections must not release the name.
            {"texto": "João tem diabetes", "categoria": "SAUDE", "tipo": "CLINICO"},
            {"texto": "João", "categoria": "IDENTIFICACAO", "tipo": "NOME"},
        ]}
        calls = []
        def api(prompt, *args, **kwargs):
            calls.append(prompt)
            self.assertIn("infere o assunto e a função do documento", prompt)
            for hidden in ("Ana Correia", "Losartana", "ID-BIO-12345"):
                self.assertNotIn(hidden, prompt)
            if "AUDITORIA FINAL" in prompt:
                self.assertNotIn("João", prompt)
                self.assertIn('"tema": "saude"', prompt)
                # The audit is not allowed to broaden the first pass decisions.
                return {"contexto": {"tema": "financas", "preservar": []}, "entidades": []}
            return response
        with tempfile.TemporaryDirectory() as folder, patch.object(app, "detect_presidio", return_value=local), patch.object(app, "chamar_gemini", side_effect=api):
            doc = app.Document(text)
            result = app.process_document(doc, object(), "fake", "fake", Path(folder) / "cache.json")
        rendered = app.apply_mask(text, doc.entities)
        self.assertEqual(result["context"]["tema"], "saude")
        self.assertEqual(len(calls), 2)
        for value in ("diabetes", "Losartana 50mg 1x/dia", "O+", "1,68m", "mutação BRCA1 positiva"):
            self.assertIn(value, rendered)
        for value in ("Ana Correia", "João", "ID-BIO-12345"):
            self.assertNotIn(value, rendered)
        self.assertIn("Familia: * tem diabetes", rendered)

    def test_same_fact_is_only_kept_on_relevant_lines_across_domains(self):
        for subtype, topic, value in (("DIAGNOSTICO", "saude", "diabetes"),
                                      ("RENDIMENTO", "financas", "500 euros"),
                                      ("OCUPACAO", "trabalho", "professor")):
            text = value + "\n" + value + "\nAna"
            doc = app.Document(text, [
                app.Entity(0, len(value), app.SEMANTIC_TYPES[subtype], "llm", subtype=subtype),
                app.Entity(len(value)+1, 2*len(value)+1, app.SEMANTIC_TYPES[subtype], "llm", subtype=subtype),
                app.Entity(len(text)-3, len(text), "IDENTIFICACAO", "llm", subtype="NOME"),
            ])
            context = {"tema": topic, "preservar": [{"linha": 1, "tipos": [subtype]}]}
            rendered = app.apply_mask(text, app.apply_document_context(doc, context))
            self.assertEqual(rendered.splitlines(), [value, ' '.join('*' for _ in value.split()), '*'])
            self.assertNotIn(value, app.apply_mask(text, app.apply_document_context(doc, {"tema": "outro", "preservar": []})))

    def test_wrong_ordinal_is_recovered_only_for_unique_match_on_declared_line(self):
        doc = app.Document("Idade: 12\nOutro: 12\n")
        payload = {"entidades": [{"texto": "12", "linha": 2, "ocorrencia": 1,
                                  "categoria": "IDENTIFICACAO", "tipo": "IDADE"}]}
        with tempfile.TemporaryDirectory() as folder, patch.object(app, "chamar_gemini", return_value=payload):
            found, _ = app.detect_llm(doc, "p", "fake", "fake", Path(folder)/"cache.json")
            self.assertEqual(found[0].start, doc.text.rindex("12"))
            payload["entidades"][0]["ocorrencia"] = 2
            with self.assertRaises(ValueError):
                app.detect_llm(app.Document("12 12\n12 12\n"), "p2", "fake", "fake", Path(folder)/"cache.json")

    def test_prescribing_doctor_is_not_misclassified_as_a_drug(self):
        text = "Prescrição: Dr. Carlos recomenda repouso\n"
        doc = app.Document(text, [app.Entity(12, 22, "IDENTIFICACAO", "presidio", subtype="PERSON")])
        doc.entities = app.refine_field_categories(doc)
        self.assertNotIn("Dr. Carlos", app.apply_mask(text, app.apply_document_context(doc, {"tema": "saude", "preservar": [{"linha": 1, "tipos": ["PRESCRICAO"]}]})))

    def test_relationships_preserve_context_but_associated_names_are_hidden(self):
        text = "Nome: António (irmão)\nNome: Joana (amiga próxima)\nNome: Irmão\nA paciente foi observada. Antecedentes: avô paterno.\n"
        values = [("António", "NOME"), ("irmão", "OUTRO"), ("Joana", "NOME"),
                  ("amiga próxima", "OUTRO"), ("Irmão", "NOME"), ("paciente", "NOME"), ("avô paterno", "NOME")]
        doc = app.Document(text, [app.Entity(text.index(v), text.index(v)+len(v),
                           app.SEMANTIC_TYPES[t], "llm", subtype=t) for v, t in values])
        doc.entities = app.refine_field_categories(doc)
        self.assertEqual(app.apply_mask(text, doc.entities),
                         "Nome: * (irmão)\nNome: * (amiga próxima)\nNome: *\nA paciente foi observada. Antecedentes: avô paterno.\n")

    def test_invalid_match_retry_is_bounded_and_never_echoes_rejected_values(self):
        invalid = {"entidades": [{"texto": "invented-private-value", "categoria": "IDENTIFICACAO"}]}
        valid = {"entidades": []}
        doc = app.Document("Nome: * *\n")
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder)/"cache.json"
            with patch.object(app, "chamar_gemini", side_effect=[invalid, valid]) as call:
                found, _ = app.detect_validated_pass(doc, app.build_prompt(doc.text), "fake", "fake", cache)
                self.assertEqual(found, [])
                self.assertEqual(call.call_count, 2)
                for args in call.call_args_list:
                    self.assertIn("Nome: * *", args.args[0])
                    self.assertNotIn("invented-private-value", args.args[0])
            with patch.object(app, "chamar_gemini", return_value=invalid) as call:
                with self.assertRaises(ValueError):
                    app.detect_validated_pass(doc, app.build_prompt(doc.text), "fake", "fake", cache, True)
                self.assertEqual(call.call_count, 2)
