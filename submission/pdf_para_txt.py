"""Funções para converter qualquer PDF para TXT com PyMuPDF.

Exemplo:
    converter_pdf_para_txt("documento.pdf", "resultado.txt")

Instalação da biblioteca: python3 -m pip install PyMuPDF
"""

from pathlib import Path
import re

import pymupdf


def extrair_texto(caminho_pdf: str) -> str:
    """Extrai o texto de todas as páginas do PDF indicado."""
    with pymupdf.open(caminho_pdf) as documento:
        paginas = [pagina.get_text(sort=True).rstrip("\n") for pagina in documento]
        return "\n\n".join(paginas) + "\n" if paginas else ""


def limpar_texto(texto: str) -> str:
    """Remove linhas vazias e espaços finais, preservando acentos e linhas de texto."""
    texto = texto.replace("\r\n", "\n").replace("\r", "\n")
    texto = re.sub(r"[ \t]+$", "", texto, flags=re.MULTILINE)
    linhas = [linha for linha in texto.splitlines() if linha.strip()]
    return "\n".join(linhas) + "\n" if linhas else ""


def converter_pdf_para_txt(
    caminho_pdf: str,
    caminho_txt: str = None,
    limpar: bool = True,
) -> str:
    """Converte qualquer PDF para TXT e devolve o caminho do TXT criado.

    Se caminho_txt não for indicado, guarda junto do PDF com extensão .txt.
    Preserva acentos, pontuação e quebras de linha por defeito.
    Remove linhas vazias e espaços finais por defeito.
    Usa limpar=False para manter o texto extraído sem limpeza.
    """
    texto = extrair_texto(caminho_pdf)
    if limpar:
        texto = limpar_texto(texto)
    destino = Path(caminho_txt) if caminho_txt is not None else Path(caminho_pdf).with_suffix(".txt")
    destino.write_text(texto, encoding="utf-8")
    return str(destino)
