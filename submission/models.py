"""Estruturas de dados partilhadas por todo o pipeline.

O texto original nunca é alterado. As deteções são uma camada por cima:
cada Entity aponta para um intervalo [start, end) de Document.text.
"""
from dataclasses import dataclass, field
from pathlib import Path

ACCEPTED = "accepted"
REJECTED = "rejected"


@dataclass
class Entity:
    """Um fragmento sensível localizado no texto."""

    start: int
    end: int
    entity_type: str          # categoria RGPD, ex.: "SAUDE"
    source: str = "manual"    # "presidio" | "llm" | "manual"
    reason: str = ""          # justificação (alimenta o relatório)
    status: str = ACCEPTED    # ACCEPTED | REJECTED (validação manual)


@dataclass
class Document:
    """Texto original + deteções acumuladas."""

    text: str
    entities: list[Entity] = field(default_factory=list)

    @classmethod
    def from_file(cls, path: str) -> "Document":
        return cls(text=Path(path).read_text(encoding="utf-8"))

    def line_of(self, offset: int) -> int:
        """Número da linha (a partir de 1) onde está o offset."""
        return self.text.count("\n", 0, offset) + 1

    def snippet(self, entity: Entity, margin: int = 30) -> str:
        """Excerto com contexto à volta da entidade, numa só linha."""
        left = self.text[max(0, entity.start - margin):entity.start]
        value = self.text[entity.start:entity.end]
        right = self.text[entity.end:entity.end + margin]
        return f"...{left}[[{value}]]{right}...".replace("\n", " ")