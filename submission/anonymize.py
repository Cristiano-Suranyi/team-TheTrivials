"""Anonimização numa só chamada ao Gemini.

Pipeline:
  1. PDF -> texto (sem linhas vazias).
  2. Presidio mascara os dados simples (um * por palavra).
  3. Uma chamada ao Gemini com prompt_template.txt devolve
     "entidades" e "texto_anonimizado" (JSON estruturado, temperature 0).
  4. As "entidades" são aplicadas em código (um * por palavra). Se o
     "texto_anonimizado" do modelo passar na validação palavra a
     palavra, as duas máscaras são unidas; se não passar, usa-se só a
     máscara feita a partir das entidades. Só se repete a chamada
     quando a resposta não é JSON válido (até --tentativas vezes).
  5. Guarda: submission.txt (documento anonimizado), prompt.txt (prompt
     exato enviado) e output/entidades.json (entidades e diagnóstico).

Uso:
  python3 submission/anonymize.py
  python3 submission/anonymize.py --so-prompt   # sem chamar o Gemini
"""
from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
import re
import subprocess
import sys

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent
TEMPLATE = BASE / "prompt_template.txt"
PLACEHOLDER = "{DOCUMENTO}"
CATEGORIAS = [
    "IDENTIFICACAO", "CONTACTO", "FINANCEIRO", "SAUDE", "GENETICO",
    "BIOMETRICO", "RELIGIAO", "POLITICA", "ORIENTACAO_SEXUAL",
    "OUTRO_SENSIVEL",
]
TEMPERATURAS = (0.0, 0.2, 0.4)
log = logging.getLogger("anonymize")

sys.path.insert(0, str(BASE))


# --------------------------------------------------------------- ambiente
def usar_venv() -> None:
    """Reexecuta com o Python do venv local (criado por setup.py)."""
    venv = BASE / "venv"
    sub = "Scripts/python.exe" if os.name == "nt" else "bin/python"
    python = venv / sub
    if Path(sys.prefix).resolve() == venv.resolve():
        return
    if not python.is_file():
        subprocess.run([sys.executable, str(BASE / "setup.py")], check=True)
    args = [str(python), str(Path(__file__).resolve()), *sys.argv[1:]]
    raise SystemExit(subprocess.run(args).returncode)


# ----------------------------------------------------------------- prompt
def renderizar_prompt(texto: str, template: str | None = None) -> str:
    """Insere o documento no template.

    Usa replace() e não str.format(): os exemplos têm chavetas.
    """
    if template is None:
        template = TEMPLATE.read_text(encoding="utf-8")
    if template.count(PLACEHOLDER) != 1:
        raise ValueError(f"O template deve ter {PLACEHOLDER} uma vez.")
    return template.replace(PLACEHOLDER, texto.rstrip("\n"))


# -------------------------------------------------------------- Presidio
def mascarar_presidio(texto: str) -> str:
    """Mascara localmente os dados simples, como no main.py."""
    from main import (Document, apply_mask, build_analyzer,
                      detect_presidio, expandir_intervalo, merge_entities)
    doc = Document(texto)
    found = detect_presidio(doc, build_analyzer())
    entities = merge_entities([expandir_intervalo(texto, e) for e in found])
    return apply_mask(texto, entities)


# -------------------------------------------------------------- validação
_MASCARA = re.compile(r"^([^\w*]*)\*([^\w*]*)$")


def token_ok(original: str, novo: str) -> bool:
    """Palavra igual, ou '*' com a pontuação exterior do original."""
    if novo == original:
        return True
    match = _MASCARA.match(novo)
    if not match:
        return False
    antes, depois = match.groups()
    return (original.startswith(antes) and original.endswith(depois)
            and len(antes) + len(depois) < len(original))


def validar(enviado: str, devolvido: str) -> list[str]:
    """Erros de estrutura entre o texto enviado e o devolvido."""
    a = enviado.rstrip("\n").split("\n")
    b = devolvido.rstrip("\n").split("\n")
    if len(a) != len(b):
        return [f"linhas: enviadas {len(a)}, devolvidas {len(b)}"]
    erros = []
    for n, (orig, novo) in enumerate(zip(a, b), 1):
        wa, wb = orig.split(), novo.split()
        if len(wa) != len(wb):
            erros.append(f"linha {n}: {len(wa)} palavras -> {len(wb)}")
            continue
        maus = [i for i, (x, y) in enumerate(zip(wa, wb))
                if not token_ok(x, y)]
        if maus:
            erros.append(f"linha {n}: palavras alteradas nas posições "
                         f"{maus}")
    return erros


# ------------------------------------------------- máscara por entidades
_PONTA = "()[]\"'.,;:!?"


def mascarar_palavra(palavra: str) -> str:
    """'Flores,' -> '*,'; '(João' -> '(*'; '12/03/1978' -> '*'."""
    nucleo = palavra.strip(_PONTA)
    if not nucleo or nucleo == "*":
        return palavra
    inicio = palavra.index(nucleo)
    return palavra[:inicio] + "*" + palavra[inicio + len(nucleo):]


def padrao_entidade(texto: str) -> re.Pattern | None:
    """Regex do fragmento, tolerante a quebras de linha e alinhado
    com o início e o fim de palavras (o "2" não apanha "2-3")."""
    palavras = texto.split()
    if not palavras or not texto.replace("*", "").strip():
        return None
    corpo = r"\s+".join(re.escape(p) for p in palavras)
    return re.compile(r"(?<![^\s(\[\"'])" + corpo
                      + r"(?=[)\]\"'.,;:!?]*(?:\s|$))")


def mascarar_entidades(texto: str,
                       entidades: list[dict]) -> tuple[str, list[str]]:
    """Aplica as entidades ao texto; devolve o texto e as não achadas."""
    marcar = [False] * len(texto)
    falta = []
    for entidade in entidades:
        padrao = padrao_entidade(entidade.get("texto", ""))
        if padrao is None:
            continue
        achou = False
        for match in padrao.finditer(texto):
            achou = True
            for i in range(match.start(), match.end()):
                marcar[i] = True
        if not achou:
            falta.append(entidade["texto"])
    saida = []
    for match in re.finditer(r"\S+|\s+", texto):
        bloco = match.group()
        if not bloco.isspace() and any(marcar[match.start():match.end()]):
            bloco = mascarar_palavra(bloco)
        saida.append(bloco)
    return "".join(saida), falta


def unir(a: str, b: str) -> str:
    """Une duas versões com a mesma estrutura: fica a palavra
    mascarada sempre que uma delas a mascarou."""
    linhas = []
    for la, lb in zip(a.rstrip("\n").split("\n"),
                      b.rstrip("\n").split("\n")):
        partes = re.findall(r"\S+|\s+", la)
        wb = iter(lb.split())
        linha = []
        for parte in partes:
            if parte.isspace():
                linha.append(parte)
                continue
            outra = next(wb)
            linha.append(outra if "*" in outra and "*" not in parte
                         else parte)
        linhas.append("".join(linha))
    return "\n".join(linhas) + "\n"


# ----------------------------------------------------------------- Gemini
SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "entidades": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "texto": {"type": "STRING"},
                    "categoria": {"type": "STRING", "enum": CATEGORIAS},
                    "motivo": {"type": "STRING"},
                },
                "required": ["texto", "categoria", "motivo"],
                "property_ordering": ["texto", "categoria", "motivo"],
            },
        },
        "texto_anonimizado": {"type": "STRING"},
    },
    "required": ["entidades", "texto_anonimizado"],
    "property_ordering": ["entidades", "texto_anonimizado"],
}


def chamar_gemini(prompt: str, api_key: str, model: str,
                  temperature: float) -> dict:
    from google import genai
    from google.genai import types
    config = types.GenerateContentConfig(
        temperature=temperature,
        response_mime_type="application/json",
        response_schema=SCHEMA,
        max_output_tokens=32768,
    )
    options = types.HttpOptions(timeout=120000)
    with genai.Client(api_key=api_key, http_options=options) as client:
        response = client.models.generate_content(
            model=model, contents=prompt, config=config)
    fim = ""
    if response.candidates:
        fim = str(response.candidates[0].finish_reason)
    if not response.text:
        raise ValueError(f"O Gemini não devolveu texto ({fim}).")
    try:
        data = json.loads(response.text)
    except json.JSONDecodeError as error:
        raise ValueError(f"JSON inválido ({fim}): {error}") from None
    if not isinstance(data.get("texto_anonimizado"), str) or \
            not isinstance(data.get("entidades"), list):
        raise ValueError("Resposta sem 'entidades'/'texto_anonimizado'.")
    return data


def anonimizar(prompt: str, enviado: str, api_key: str, model: str,
               tentativas: int) -> dict:
    """Chama o Gemini e constrói o texto final validado."""
    for i in range(tentativas):
        temp = TEMPERATURAS[min(i, len(TEMPERATURAS) - 1)]
        log.info("Tentativa %d/%d (temperature %.1f)", i + 1,
                 tentativas, temp)
        try:
            data = chamar_gemini(prompt, api_key, model, temp)
        except ValueError as error:
            log.warning("Resposta inválida: %s", error)
            continue
        por_entidades, falta = mascarar_entidades(enviado,
                                                  data["entidades"])
        erros = validar(enviado, data["texto_anonimizado"])
        if erros:
            log.warning("Texto do modelo rejeitado (%d erros); uso a "
                        "máscara feita a partir das entidades.",
                        len(erros))
            for erro in erros[:10]:
                log.warning("  %s", erro)
            final = por_entidades
        else:
            final = unir(data["texto_anonimizado"], por_entidades)
        problemas = validar(enviado, final)
        if problemas:  # nunca deve acontecer
            raise ValueError(f"Texto final inválido: {problemas[:3]}")
        return {"texto": final, "entidades": data["entidades"],
                "nao_encontradas": falta, "erros_texto_modelo": erros,
                "texto_modelo": data["texto_anonimizado"],
                "tentativa": i + 1, "temperature": temp}
    raise ValueError(f"Nenhuma resposta JSON válida em {tentativas} "
                     "tentativas.")


# ------------------------------------------------------------------- main
def guardar(path: Path, texto: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(texto)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--pdf", type=Path,
                        default=ROOT / "raw_data/document_to_anonymize.pdf")
    parser.add_argument("--model", default=os.getenv("GEMINI_MODEL"))
    parser.add_argument("--tentativas", type=int, default=3)
    parser.add_argument("--submission", type=Path,
                        default=BASE / "submission.txt")
    parser.add_argument("--prompt", type=Path, default=BASE / "prompt.txt")
    parser.add_argument("--entidades", type=Path,
                        default=ROOT / "output/entidades.json")
    parser.add_argument("--so-prompt", action="store_true",
                        help="só gera o prompt; não chama o Gemini")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    for name in ("presidio-analyzer", "httpx", "google_genai"):
        logging.getLogger(name).setLevel(logging.ERROR)
    from main import DEFAULT_MODEL, carregar_chave, extrair_texto
    model = args.model or DEFAULT_MODEL
    try:
        texto = extrair_texto(args.pdf)
        enviado = mascarar_presidio(texto)
        prompt = renderizar_prompt(enviado)
        if args.so_prompt:
            guardar(args.prompt, prompt)
            log.info("Prompt guardado em %s", args.prompt)
            return 0
        r = anonimizar(prompt, enviado, carregar_chave(), model,
                       args.tentativas)
        guardar(args.submission, r["texto"])
        guardar(args.prompt, prompt)
        meta = {k: v for k, v in r.items() if k != "texto"}
        meta["modelo"] = model
        guardar(args.entidades,
                json.dumps(meta, ensure_ascii=False, indent=2))
        log.info("OK: %d entidades (tentativa %d); texto do modelo %s.",
                 len(r["entidades"]), r["tentativa"],
                 "rejeitado" if r["erros_texto_modelo"] else "válido")
        if r["nao_encontradas"]:
            log.warning("Entidades não encontradas no texto: %s",
                        r["nao_encontradas"])
        log.info("submission.txt, prompt.txt e %s atualizados.",
                 args.entidades.name)
        return 0
    except (ValueError, OSError) as error:
        log.error("%s", error)
        return 1


if __name__ == "__main__":
    if not any(a in {"-h", "--help"} for a in sys.argv[1:]):
        usar_venv()
    raise SystemExit(main())
