"""Funções para converter qualquer PDF para TXT com PyMuPDF.

Exemplo:
    converter_pdf_para_txt("documento.pdf", "resultado.txt")

Instalação da biblioteca: python3 -m pip install PyMuPDF
"""

from pathlib import Path
import re
import unicodedata

import pymupdf


def extrair_texto(caminho_pdf: str) -> str:
    """Extrai o texto de todas as páginas do PDF indicado."""
    with pymupdf.open(caminho_pdf) as documento:
        return "".join(pagina.get_text() for pagina in documento)


def limpar_texto(texto: str) -> str:
    """Remove acentos, pontuação e espaços repetidos, como no guião."""
    texto = unicodedata.normalize("NFD", texto)
    texto = texto.encode("ascii", "ignore").decode("utf-8")
    texto = re.sub(r"[^a-zA-Z0-9\s]", "", texto)
    texto = re.sub(r"\s+", " ", texto)
    return texto.strip()


def converter_pdf_para_txt(
    caminho_pdf: str,
    caminho_txt: str = None,
    limpar: bool = True,
) -> str:
    """Converte qualquer PDF para TXT e devolve o caminho do TXT criado.

    Se caminho_txt não for indicado, guarda junto do PDF com extensão .txt.
    Usa limpar=False para preservar acentos, pontuação e quebras de linha.
    """
    texto = extrair_texto(caminho_pdf)
    if limpar:
        texto = limpar_texto(texto)
    destino = Path(caminho_txt) if caminho_txt is not None else Path(caminho_pdf).with_suffix(".txt")
    destino.write_text(texto, encoding="utf-8")
    return str(destino)
