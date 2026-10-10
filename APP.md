# Hidden — interface e motor de anonimização

O frontend fornecido está integrado em `frontend/`, com o desenho e a revisão interativa originais. A API `submission/web_api.py` reutiliza o motor `submission/main.py`. A pasta original em Downloads permanece intacta.

## Arrancar

Na raiz do projeto, executa `python3 run_app.py` (Windows: `py run_app.py`) e abre **http://127.0.0.1:8787**. Ctrl+C termina o serviço. Não é necessário ativar o venv.

O primeiro arranque prepara o Python e compila a interface quando necessário. Requer Python 3.9+ e Node.js 22.12+ com npm ou pnpm para a compilação inicial; depois de compilada, a aplicação só precisa de Python. A instalação inicial requer Internet. Para uma instalação nova recomenda-se Python 3.11/3.12.

```bash
python3 run_app.py --setup   # instalar, compilar e terminar
python3 run_app.py --build   # recompilar o frontend e arrancar
python3 run_app.py --port 8788
```

A chave continua no ficheiro local `submission/.env`: `GEMINI_API_KEY=...`, ignorado pelo Git. Também aceita `GEMINI_API_KEY` ou `GOOGLE_API_KEY` do ambiente. `GEMINI_MODEL` seleciona outro modelo disponível na conta. Não colocar chaves no frontend.

## Fluxo

1. Escolher um ou vários PDFs com texto selecionável, até 20 MB cada.
2. Confirmar categorias e iniciar a anonimização.
3. O navegador extrai as linhas. Presidio mascara os dados simples localmente. Gemini recebe esse texto protegido e procura dados sensíveis pelo contexto. As posições são reconstruídas sobre o original.
4. Clicar nos fragmentos para manter/ocultar, ou selecionar texto para o ocultar manualmente. A pré-visualização mostra o TXT final.
5. Descarregar o PDF com «Download PDF». O original só é enviado ao serviço Python local no momento da exportação. O TXT anonimizado e o relatório ficam numa pasta exclusiva em `output/`. O relatório mantém-se apenas na pasta de saída; não existe botão de relatório na interface.

A interface mostra contagens reais de cada etapa. O resultado só é disponibilizado quando ambas terminam e a resposta do modelo é validada. O TXT mantém espaços e quebras de linha, elimina linhas vazias e usa um `*` por palavra ocultada. A exportação compõe um PDF novo, com texto compacto em páginas A4, margens de 40 pontos, fonte de 11 pontos e paginação automática. O desenho e o número de páginas do original podem mudar. O original nunca é incorporado no resultado. A CLI mantém a extração com PyMuPDF; a interface usa PDF.js durante a deteção; apenas na exportação o original chega ao serviço local. A CLI guarda o TXT em `output/anonimizado.txt`.

As sessões ficam na memória durante uma hora e desaparecem ao parar/reiniciar. «Start over» remove as sessões dessa revisão. As alterações manuais ficam apenas na vista atual: descarrega antes de recarregar. O Gemini recebe dados contextuais ainda não reconhecidos localmente. Revê sempre as deteções. PDFs sem texto precisam de OCR. Acima de 200 mil caracteres, divide o documento; não há truncamento silencioso.

## Desenvolvimento

```bash
submission/venv/bin/python -m unittest discover -s tests -v
cd frontend
pnpm install --frozen-lockfile
pnpm test
pnpm run build
pnpm dev
```

No Windows, usa `submission\venv\Scripts\python.exe`. Também é possível usar `npm install`, `npm test`, `npm run build` e `npm run dev`. O lockfile fornecido é `pnpm-lock.yaml`. Em desenvolvimento, mantém `python3 run_app.py` aberto: Vite encaminha `/api` para a porta 8787. O serviço é local, de um só utilizador e sem autenticação multiutilizador; mantém o bind em `127.0.0.1`. O contrato está em `API.md` e `frontend/API.md`.

## Precisão, navegação e PDF

Após a deteção contextual, uma segunda passagem Gemini verifica omissões no texto já mascarado. Ambas recebem texto protegido. Tipos e categorias são validados e as deteções são localizadas por linha e ocorrência. Todas as categorias ficam selecionadas por defeito.

Clicar na lista direita centra o fragmento exato na vista anonimizada única. Cada sugestão mostra categoria e Hide/Keep. O botão de remover descarta a sugestão, conserva o texto e atualiza contagens; o texto pode voltar a ser selecionado e ocultado manualmente. As escolhas mantêm-se ao alternar documentos, mas reabrir a sessão recupera as sugestões iniciais.

Uma revisão reaberta pede o mesmo PDF original para exportar. PDFs sem texto, protegidos ou cujo texto não se consiga reconciliar com a revisão são rejeitados com um erro claro. O PDF novo não incorpora imagens, campos interativos, anotações, anexos ou assinaturas do original. A deteção cobre texto, não identidades em fotografias. Cada exportação cria uma nova pasta em `output/`, sem substituir anteriores.

A deteção decide por fragmento e contexto em todas as categorias: informação geral, educativa e administrativa permanece; identificadores e factos sensíveis atribuídos a uma pessoa são sugeridos para ocultação. Não há cobertura automática de secções clínicas inteiras. Ambas as passagens Gemini recebem texto protegido. Os filtros corrigem falsos positivos contextuais sem reenviar valores já protegidos.
