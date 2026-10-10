"""Junção de deteções e aplicação da máscara."""
import re
from dataclasses import replace

from models import ACCEPTED, Entity

_WORD = re.compile(r"\S+")


def merge_entities(entities: list[Entity]) -> list[Entity]:
    """Junta spans sobrepostos (Presidio + LLM) num só.

    Fica o span mais abrangente. O tipo e a justificação vêm do span
    mais longo e as origens são combinadas (ex.: "llm+presidio").
    Não altera as entidades recebidas.
    """
    ordered = sorted(entities, key=lambda e: (e.start, e.start - e.end))
    merged: list[Entity] = []
    for ent in ordered:
        if merged and ent.start < merged[-1].end:
            last = merged[-1]
            longest = last
            if ent.end - ent.start > last.end - last.start:
                longest = ent
            sources = sorted(set(last.source.split("+")) | {ent.source})
            merged[-1] = replace(
                longest,
                start=last.start,
                end=max(last.end, ent.end),
                source="+".join(sources),
            )
        else:
            merged.append(replace(ent))
    return merged


def apply_mask(text: str, entities: list[Entity]) -> str:
    """Substitui cada palavra de cada span aceite por '*'.

    Os espaços e as quebras de linha são preservados, por isso a
    formatação original mantém-se. Ex.: "Ana Correia" -> "* *".
    """
    accepted = [e for e in entities if e.status == ACCEPTED]
    parts: list[str] = []
    cursor = 0
    for ent in merge_entities(accepted):
        parts.append(text[cursor:ent.start])
        parts.append(_WORD.sub("*", text[ent.start:ent.end]))
        cursor = ent.end
    parts.append(text[cursor:])
    return "".join(parts)
