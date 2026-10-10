#!/bin/bash

echo "A criar o ambiente virtual (venv)..."
python3 -m venv venv

echo "A ativar o ambiente e a instalar as bibliotecas..."
source venv/bin/activate
pip install --upgrade pip
pip install presidio-analyzer presidio-anonymizer
pip install pymupdf
python3 -m pip install --upgrade google-genai httpx


echo ""
echo "✅ Setup concluído com sucesso!"
echo "👉 Para começares a trabalhar, corre: source venv/bin/activate"
echo ""