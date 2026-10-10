"""Relatório explicativo da anonimização.

Por defeito não reproduz os valores sensíveis (um relatório de
anonimização que copia os dados originais anulava o seu propósito).
Com show_values=True inclui-os, útil para depurar e validar.
"""
from collections import Counter

from models import ACCEPTED, REJECTED, Document, Entity


def _cell(value: str) -> str:
    return value.replace("|", "/").replace("\n", " ")


def build_report(
    doc: Document,
    entities: list[Entity],
    unmatched: list[str],
    model: str,
    show_values: bool = False,
) -> str:
    """Devolve o relatório em Markdown."""
    accepted = [e for e in entities if e.status == ACCEPTED]
    rejected = [e for e in entities if e.status == REJECTED]
    words = sum(len(doc.text[e.start:e.end].split()) for e in accepted)

    by_category = Counter(e.entity_type for e in accepted)
    by_source = Counter(e.source for e in accepted)

    lines = [
        "# Relatório de anonimização",
        "",
        "## Resumo",
        f"- Fragmentos mascarados: **{len(accepted)}** "
        f"({words} palavras substituídas por `*`)",
        f"- Rejeitados na validação manual: {len(rejected)}",
        f"- Modelo LLM: `{model}`",
        "",
        "## Por categoria",
        "| Categoria | Fragmentos |",
        "|---|---|",
    ]
    lines += [f"| {cat} | {n} |" for cat, n in by_category.most_common()]

    lines += ["", "## Por origem", "| Origem | Fragmentos |", "|---|---|"]
    lines += [f"| {src} | {n} |" for src, n in by_source.most_common()]

    header = "| Linha | Categoria | Origem | Palavras | Justificação |"
    divider = "|---|---|---|---|---|"
    if show_values:
        header += " Valor |"
        divider += "---|"
    lines += ["", "## Deteções", header, divider]
    for ent in accepted:
        n_words = len(doc.text[ent.start:ent.end].split())
        row = (
            f"| {doc.line_of(ent.start)} | {ent.entity_type} | "
            f"{ent.source} | {n_words} | {_cell(ent.reason)} |"
        )
        if show_values:
            row += f" {_cell(doc.text[ent.start:ent.end])} |"
        lines.append(row)

    if unmatched:
        lines += [
            "",
            "## Fragmentos do LLM não encontrados no texto",
            "Ignorados por não existirem no documento (possíveis "
            "alucinações ou diferenças de transcrição):",
        ]
        lines += [
            f"- {u}" if show_values else f"- ({len(u.split())} palavras)"
            for u in unmatched
        ]

    return "\n".join(lines) + "\n"
