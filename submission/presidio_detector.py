"""Deteção determinística com Microsoft Presidio (regex + NER spaCy).

Cobre dados com formato reconhecível (telefone, email, cartão, IDs) e
nomes de pessoas. O contexto semântico (saúde, religião, política...)
fica a cargo do LLM em llm_detector.py.
"""
from presidio_analyzer import (
    AnalyzerEngine,
    Pattern,
    PatternRecognizer,
    RecognizerRegistry,
)
from presidio_analyzer.nlp_engine import NlpEngineProvider

from models import Document, Entity

LANGUAGE = "pt"
SPACY_MODEL = "pt_core_news_lg"
SCORE_THRESHOLD = 0.5

# Tipo Presidio -> categoria RGPD (a mesma taxonomia usada pelo LLM).
# Datas e locais genéricos do NER ficam de fora de propósito: o exemplo
# do enunciado mantém "Data: 15 de abril de 2025" e o nome do centro.
CATEGORY = {
    "PERSON": "IDENTIFICACAO",
    "EMAIL_ADDRESS": "IDENTIFICACAO",
    "PHONE_NUMBER": "IDENTIFICACAO",
    "DATE_OF_BIRTH": "IDENTIFICACAO",
    "NISS": "IDENTIFICACAO",
    "CPF": "IDENTIFICACAO",
    "CITIZEN_CARD": "IDENTIFICACAO",
    "CREDIT_CARD": "FINANCEIRO",
    "IBAN_CODE": "FINANCEIRO",
    "BIOMETRIC_ID": "BIOMETRICO",
}

# (tipo, nome do padrão, regex, score)
_PATTERNS = [
    ("PHONE_NUMBER", "pt_intl",
     r"(?:\+|00)351[ .-]?\d{3}[ .-]?\d{3}[ .-]?\d{3}", 0.85),
    ("DATE_OF_BIRTH", "dd_mm_yyyy",
     r"\b\d{2}[/.-]\d{2}[/.-]\d{4}\b", 0.6),
    ("CPF", "cpf_formatado",
     r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b", 0.85),
    # NISS tem 11 dígitos (o CPF sem pontuação também).
    ("NISS", "onze_digitos", r"\b\d{11}\b", 0.6),
    ("CITIZEN_CARD", "cc_pt",
     r"\b\d{8}[ ]?\d[ ]?[A-Z]{2}\d\b", 0.85),
    # Sem validação Luhn: números de teste/fictícios falham o checksum
    # e o reconhecedor nativo descarta-os.
    ("CREDIT_CARD", "cartao_formato",
     r"\b(?:\d{4}[ -]?){3}\d{4}\b", 0.7),
    ("BIOMETRIC_ID", "id_biometrico",
     r"\b(?:IDBIO|FACEID)\d+\b", 0.9),
]


def _custom_recognizers() -> list[PatternRecognizer]:
    return [
        PatternRecognizer(
            supported_entity=entity,
            supported_language=LANGUAGE,
            patterns=[Pattern(name, regex, score)],
            name=f"{entity}_{name}",
        )
        for entity, name, regex, score in _PATTERNS
    ]


def build_analyzer() -> AnalyzerEngine:
    """Cria o AnalyzerEngine para português com os padrões custom."""
    nlp_engine = NlpEngineProvider(nlp_configuration={
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": LANGUAGE, "model_name": SPACY_MODEL}],
    }).create_engine()

    registry = RecognizerRegistry(supported_languages=[LANGUAGE])
    registry.load_predefined_recognizers(
        languages=[LANGUAGE], nlp_engine=nlp_engine
    )
    for recognizer in _custom_recognizers():
        registry.add_recognizer(recognizer)

    return AnalyzerEngine(
        nlp_engine=nlp_engine,
        registry=registry,
        supported_languages=[LANGUAGE],
    )


def _clip_to_line(text: str, start: int, end: int) -> int:
    """Novo fim do span, cortado na primeira quebra de linha.

    O NER do spaCy às vezes junta o nome ao rótulo da linha seguinte
    ("Maria Santos\\nData de Nascimento"). Um dado sensível não atravessa
    linhas neste formato, por isso cortamos aí.
    """
    newline = text.find("\n", start, end)
    return start + len(text[start:newline].rstrip()) if newline != -1 else end


def detect(doc: Document, analyzer: AnalyzerEngine) -> list[Entity]:
    """Corre o Presidio e converte os resultados em Entity."""
    results = analyzer.analyze(
        text=doc.text,
        language=LANGUAGE,
        entities=list(CATEGORY),
        score_threshold=SCORE_THRESHOLD,
    )
    return [
        Entity(
            start=r.start,
            end=_clip_to_line(doc.text, r.start, r.end),
            entity_type=CATEGORY[r.entity_type],
            source="presidio",
            reason=f"{r.entity_type} (Presidio, score {r.score:.2f})",
        )
        for r in results
    ]
