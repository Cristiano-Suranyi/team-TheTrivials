
## Pipeline de uma só chamada (`anonymize.py`)

Alternativa ao `main.py` que gera os ficheiros de submissão diretamente a partir do modelo:

```bash
python3 submission/anonymize.py              # PDF -> Presidio -> Gemini -> validação
python3 submission/anonymize.py --so-prompt  # só gera o prompt, sem chamar a API
```

1. O PDF é convertido em texto, sem linhas vazias.
2. O Presidio mascara os dados simples (um `*` por palavra).
3. Uma única chamada ao Gemini, com `prompt_template.txt` e saída JSON estruturada a `temperature=0`, devolve primeiro a lista `entidades` (com categoria e motivo) e depois `texto_anonimizado`.
4. O texto devolvido é validado palavra a palavra: o número de linhas e de palavras tem de ser igual, e cada palavra fica intacta ou passa a `*` (mantendo a pontuação exterior). Se a validação falhar, repete até 3 vezes; a última resposta inválida fica em `output/resposta_invalida.json`.
5. `submission.txt` recebe o `texto_anonimizado` tal como o modelo o devolveu, `prompt.txt` o prompt exato enviado e `output/entidades.json` a lista de entidades para revisão.

O template usa o marcador `{DOCUMENTO}` e é preenchido com `str.replace()`, porque os exemplos contêm chavetas.
