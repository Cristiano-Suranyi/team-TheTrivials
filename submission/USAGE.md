# Anonimizador de documentos

O `main.py` reúne a extração do PDF, deteção e máscara local com Presidio, deteção contextual do texto já protegido com Gemini, máscara final e relatório. Mantém acentos, pontuação e quebras de linha e remove linhas vazias. Substitui cada palavra sensível por `*`.

## Interface web

Executa `python3 run_app.py` na raiz do projeto e abre http://127.0.0.1:8787. No Windows usa `py run_app.py`. Instruções completas em [APP.md](../APP.md). Se o Hidden já estiver ativo, o comando mostra o endereço e termina sem criar outro servidor. Se a porta estiver ocupada por outro serviço, usa `python3 run_app.py --port 8788` ou encerra esse serviço.

Cada análise concluída no site gera também uma entrega TXT através do `prompt_template.txt` existente, numa chamada Gemini adicional com as deteções locais previamente protegidas. `submission/submission.txt` recebe exclusivamente o campo `texto_anonimizado` devolvido pelo modelo e `submission/prompt.txt` recebe o prompt exato dessa chamada. O último documento concluído substitui estes dois ficheiros; falhas da API, respostas com formatação inválida e sessões canceladas não os atualizam. A entrega web valida linhas e palavras antes de gravar; repete até três vezes com o mesmo prompt, sem reparar localmente a resposta do modelo. Alterações manuais da revisão e o PDF descarregado não alteram esta resposta do modelo. Para entregar ao hackathon, analisa por último `raw_data/document_to_anonymize.pdf`, confirma os ficheiros e inclui-os no commit.

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

## Pipeline de uma só chamada (`anonymize.py`)

Alternativa ao `main.py` que gera os ficheiros de submissão diretamente a partir do modelo:

```bash
python3 submission/anonymize.py              # PDF -> Presidio -> Gemini -> validação
python3 submission/anonymize.py --so-prompt  # só gera o prompt, sem chamar a API
```

1. O PDF é convertido em texto, sem linhas vazias.
2. O Presidio mascara os dados simples (um `*` por palavra).
3. Uma única chamada ao Gemini, com `prompt_template.txt` e saída JSON estruturada a `temperature=0`, devolve primeiro a lista `entidades` (com categoria e motivo) e depois `texto_anonimizado`.
4. As `entidades` são aplicadas em código, com um `*` por palavra, alinhadas com o início e o fim de cada palavra e mesmo quando um valor continua na linha seguinte. O `texto_anonimizado` do modelo é validado palavra a palavra (mesmo número de linhas e de palavras; cada palavra fica intacta ou passa a `*`, mantendo a pontuação exterior). Se for válido, as duas máscaras são unidas; se não for, usa-se a máscara feita a partir das entidades. A chamada só se repete (até 3 vezes) quando a resposta não é JSON válido.
5. `submission.txt` recebe exatamente o campo `texto_anonimizado` do modelo (a união local é apenas diagnóstico), `prompt.txt` o prompt exato enviado e `output/entidades.json` as entidades, as que não foram encontradas no texto e os erros do texto do modelo, para revisão.

O template usa o marcador `{DOCUMENTO}` e é preenchido com `str.replace()`, porque os exemplos contêm chavetas.
