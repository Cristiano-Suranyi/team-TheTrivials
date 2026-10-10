"""Pipeline de anonimização de documentos (NOS Gen-AI Hackathon).

PDF -> TXT -> deteção (Presidio + Gemini) -> união -> máscara -> relatório

Uso:
    export GEMINI_API_KEY="..."
    python main.py                # corre tudo
    python main.py --review       # valida manualmente cada deteção
    python main.py --refresh      # ignora a cache da resposta do LLM
"""
import argparse
import logging
import os
import sys
from pathlib import Path


import presidio_detector
from masking import apply_mask, merge_entities
from models import ACCEPTED, REJECTED, Document
from pdf_para_txt import converter_pdf_para_txt
from report import build_report

PDF_PATH = "raw_data/document_to_anonymize.pdf"
TXT_PATH = "raw_data/document_to_anonymize.txt"
SUBMISSION_PATH = "submission/submission.txt"
PROMPT_PATH = "submission/prompt.txt"
REPORT_PATH = "output/report.md"
CACHE_PATH = "output/llm_cache.json"

log = logging.getLogger("anonimizador")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--review", action="store_true",
        help="validação manual: aceitar/rejeitar cada deteção",
    )
    parser.add_argument(
        "--refresh", action="store_true",
        help="ignora a cache e volta a chamar o LLM",
    )
    parser.add_argument(
        "--show-values", action="store_true",
        help="inclui os valores originais no relatório (só para debug)",
    )
    return parser.parse_args(argv)


def review(doc: Document) -> None:
    """Validação manual (opcional no enunciado): corrige falsos positivos."""
    for i, ent in enumerate(doc.entities, start=1):
        print(f"\n[{i}/{len(doc.entities)}] {ent.entity_type} "
              f"({ent.source}) - {ent.reason}")
        print(doc.snippet(ent))
        answer = input("Manter máscara? [S/n] ").strip().lower()
        if answer in ("n", "nao", "não"):
            ent.status = REJECTED


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(levelname)s: %(message)s"
    )

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        log.error("Define a variável de ambiente GEMINI_API_KEY.")
        return 1
    model = os.environ.get("GEMINI_MODEL", llm_detector.DEFAULT_MODEL)

    # 1. PDF -> TXT -> Document
    converter_pdf_para_txt(PDF_PATH, TXT_PATH)
    doc = Document.from_file(TXT_PATH)
    log.info("Documento carregado: %d caracteres", len(doc.text))

    # 2. Deteção determinística (regex + NER)
    analyzer = presidio_detector.build_analyzer()
    doc.entities += presidio_detector.detect(doc, analyzer)
    log.info("Presidio: %d deteções", len(doc.entities))

    # 3. Deteção contextual (LLM). O prompt exato fica em prompt.txt.
    prompt = llm_detector.build_prompt(doc.text)
    Path(PROMPT_PATH).write_text(prompt, encoding="utf-8")
    llm_entities, unmatched = llm_detector.detect(
        doc, prompt, api_key, model,
        cache_path=Path(CACHE_PATH), refresh=args.refresh,
    )
    doc.entities += llm_entities
    log.info("LLM: %d deteções (%d fragmentos sem correspondência)",
             len(llm_entities), len(unmatched))

    # 4. União de sobreposições (+ validação manual opcional)
    doc.entities = merge_entities(doc.entities)
    if args.review:
        review(doc)

    # 5. Máscara e relatório
    Path(SUBMISSION_PATH).write_text(
        apply_mask(doc.text, doc.entities), encoding="utf-8"
    )
    Path(REPORT_PATH).parent.mkdir(parents=True, exist_ok=True)
    Path(REPORT_PATH).write_text(
        build_report(doc, doc.entities, unmatched, model, args.show_values),
        encoding="utf-8",
    )

    kept = sum(e.status == ACCEPTED for e in doc.entities)
    log.info("Concluído: %d fragmentos mascarados -> %s",
             kept, SUBMISSION_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())