# Anonimizador de documentos

O `main.py` reúne a extração do PDF, deteção e máscara local com Presidio, deteção contextual do texto já protegido com Gemini, máscara final e relatório. Mantém acentos, pontuação e quebras de linha e remove linhas vazias. Substitui cada palavra sensível por `*`.

## Interface web

Executa `python3 run_app.py` na raiz do projeto e abre http://127.0.0.1:8787. No Windows usa `py run_app.py`. Instruções completas em [APP.md](../APP.md).

## Executar

Requer Python 3.9 ou superior. Na primeira execução instala as dependências e o modelo português no venv local; é necessária Internet. No Windows usa `py` em vez de `python3`.

```bash
python3 submission/main.py
python3 submission/main.py --pdf "documento.pdf" --saida "resultado.txt"
python3 submission/main.py --help
```

Não é necessário ativar o venv. Para instalar antecipadamente:

```bash
python3 submission/setup.py
```

Configura `GEMINI_API_KEY` ou `GOOGLE_API_KEY` no ambiente, ou no ficheiro local `submission/.env`, ignorado pelo Git. Nunca incluas a chave no código. `--model` ou `GEMINI_MODEL` permite escolher o modelo.

## Resultados e opções

Por defeito usa `raw_data/document_to_anonymize.pdf` e guarda o documento anonimizado em `output/anonimizado.txt`, o prompt exato em `submission/prompt.txt` e o relatório em `output/report.md`. Os caminhos predefinidos são relativos ao projeto; os caminhos passados na linha de comandos são relativos à pasta atual.

- `--saida`, `--relatorio`, `--prompt` e `--cache`: caminhos dos resultados.
- `--review`: aceitar/rejeitar manualmente cada fragmento antes de mascarar.
- `--refresh`: repetir a chamada Gemini, ignorando a cache.
- `--sem-gemini`: usar apenas Presidio; não cobre todos os dados clínicos e contextuais.
- `--pergunta "Quanto é 2+2?"`: pergunta simples ao Gemini, sem processar PDF.
- `--show-values`: incluir valores originais no relatório para revisão local.

No modo normal, o Presidio mascara primeiro os dados simples reconhecidos localmente. Só esse texto já protegido é enviado ao Gemini, que procura dados contextuais ainda visíveis. Um mapa de posições converte as deteções do texto protegido para o original antes de aplicar a máscara final. O documento completo continua a fornecer contexto ao modelo; dados sensíveis não reconhecidos localmente podem ainda ser enviados à API Google Gemini. O TXT original, o prompt e a cache podem conter dados contextuais ainda não reconhecidos localmente; protege esses ficheiros ao trabalhar com dados reais. O relatório não inclui valores originais por defeito. A cache só é reutilizada para o mesmo documento, prompt e modelo.

PDFs digitalizados sem camada de texto precisam de OCR, que não está incluído. PDFs protegidos, ficheiros inexistentes e falhas da API são apresentados como erros. Uma falha na deteção impede a publicação do novo documento anonimizado. Revê o resultado antes de o utilizar: nenhum detetor garante identificar todos os dados sensíveis.

## Testes

```bash
python3 -m unittest discover -s tests -v
```

Usa o Python do venv para o teste de leitura de PDF, caso o PyMuPDF não esteja instalado no Python do sistema.
