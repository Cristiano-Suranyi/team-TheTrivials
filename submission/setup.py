"""Instala o ambiente: python3 submission/setup.py (Windows: py submission/setup.py)."""
from pathlib import Path
import os
import subprocess
import sys
import venv


def preparar_ambiente() -> None:
    if sys.version_info < (3, 9):
        raise SystemExit("É necessário Python 3.9 ou superior.")
    pasta = Path(__file__).resolve().parent
    ambiente = pasta / "venv"
    python = ambiente / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.is_file():
        print("A criar o ambiente virtual...", flush=True)
        venv.EnvBuilder(with_pip=True).create(ambiente)
    subprocess.run([str(python), "-m", "pip", "install", "--upgrade", "pip"], check=True)
    subprocess.run([str(python), "-m", "pip", "install", "-r", str(pasta / "requirements.txt")], check=True)
    model = subprocess.run([str(python), "-c", 'import spacy; spacy.load("pt_core_news_lg")'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if model.returncode:
        subprocess.run([str(python), "-m", "spacy", "download", "pt_core_news_lg"], check=True)
    subprocess.run([str(python), "-m", "pip", "check"], check=True)
    print("Setup concluído. Executa main.py para processar o documento.")


if __name__ == "__main__":
    try:
        preparar_ambiente()
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"Falha no setup: {error}", file=sys.stderr)
        raise SystemExit(1)
