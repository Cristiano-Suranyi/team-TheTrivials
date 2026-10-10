import os
import sys
from pathlib import Path

import httpx
from google import genai
from google.genai import errors, types


def _api_key() -> str:
    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if key:
        return key

    env_file = Path(__file__).with_name(".env")
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            name, separator, value = line.partition("=")
            if separator and name.strip() == "GEMINI_API_KEY":
                return value.strip().strip("\"'")
    return ""


def perguntar_gemini(pergunta: str) -> str:
    pergunta = pergunta.strip()
    if not pergunta:
        return "Escreve uma pergunta."
    key = _api_key()
    if not key:
        return "ERRO: Configura GEMINI_API_KEY no ambiente ou no .env junto deste ficheiro."
    try:
        with genai.Client(api_key=key, http_options=types.HttpOptions(timeout=30000)) as client:
            resposta = client.models.generate_content(
                model=os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite"),
                contents=pergunta,
                config=types.GenerateContentConfig(
                    system_instruction="Responde em português de Portugal, de forma simples, curta e direta.",
                ),
            )
            # Extrai apenas texto, sem avisos sobre assinaturas internas do modelo.
            texto = "".join(
                part.text
                for candidate in (resposta.candidates or [])[:1]
                if candidate.content
                for part in (candidate.content.parts or [])
                if part.text and not part.thought
            )
            return texto.strip() or "O Gemini não devolveu uma resposta de texto."
    except errors.APIError as erro:
        mensagens = {
            400: "Pedido inválido. Verifica a chave e o modelo.",
            403: "API key sem permissões.",
            404: "Modelo não disponível. Verifica GEMINI_MODEL.",
            429: "Quota deste modelo esgotada. Aguarda a reposição ou altera GEMINI_MODEL.",
        }
        return "ERRO: " + mensagens.get(erro.code, f"A API Gemini devolveu o código {erro.code}. Tenta novamente.")
    except httpx.HTTPError:
        return "ERRO: Não foi possível contactar o Gemini. Verifica a ligação à Internet e tenta novamente."