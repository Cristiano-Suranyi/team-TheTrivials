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
4. Clicar nos fragmentos para manter/ocultar, ou selecionar texto para o ocultar manualmente. A revisão mantém as palavras originais; os fragmentos com fundo serão ocultados no download. Os asteriscos aparecem apenas no PDF/TXT de saída.
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

## Extensão Chrome

A pasta `extension/` contém a extensão integrada, com ícones e estilo fornecidos. Consulta `extension/README.md` para carregar no Chrome 127+, fixar o ícone e autorizar PDFs locais. Abrir um PDF e clicar em «Abrir no Hidden» entrega-o ao site sem nova seleção e aguarda a confirmação das categorias. A transferência permanece no navegador; o popup não inicia análise. O aviso automático pode ser desligado e o histórico conserva apenas metadados das últimas dez revisões.

## Redução de falsos positivos

Depois das duas passagens protegidas do Gemini, a validação local restringe as sugestões aos valores: conserva rótulos, referências administrativas, datas do relatório, instituições e expressões de ligação. Informação educativa geral não é classificada como pessoal apenas por mencionar pacientes. Nomes e identificadores concretos continuam protegidos antes de qualquer chamada. O CRM tem um padrão contextual próprio, distinto de referências administrativas. As sugestões continuam editáveis na revisão; os testes cobrem pares de contexto geral/pessoal e verificam que a redução de máscaras não liberta identificadores; doses e outros factos úteis dependem do contexto. Estes filtros melhoram os casos verificados, sem garantir deteção perfeita em todos os documentos.

## Contexto automático por documento

Não existe seletor de finalidade nem parâmetro `policy`. O motor partilhado `submission/main.py` infere o contexto de cada documento na primeira passagem Gemini e avalia a utilidade de cada facto na respetiva linha. A decisão não depende do nome do ficheiro nem de um modo exclusivo para medicina: informação substantiva clínica, financeira, educativa ou de outros assuntos pode permanecer, enquanto identificadores pessoais são protegidos. Factos pessoais periféricos continuam sujeitos a ocultação e revisão.

A resposta da sessão inclui `context`: `tema` (enumeração) e `preservar` (decisões com `linha` 1-based e `tipos` não identificadores). Só decisões validadas por linha podem conservar deteções locais. Nomes, documentos e contactos não são tipos conserváveis. A segunda passagem recebe o contexto validado, sem valores pessoais nem explicações livres, e não amplia as permissões de conservação. Todas as deteções locais são protegidas antes das duas chamadas; a conservação aplica-se apenas no resultado local. As escolhas manuais prevalecem no PDF, TXT e relatório. O relatório regista o tema inferido. Sem contexto disponível, não se libertam deteções com base na finalidade.

A classificação automática pode falhar: a revisão permite conservar ou ocultar qualquer fragmento. O script alternativo `submission/anonymize.py` tem um fluxo independente.

Uma correspondência textual inválida permite uma única tentativa de correção por passagem, sobre o mesmo texto protegido. A resposta rejeitada não é reenviada. Se a correção também falhar, nenhum resultado parcial é publicado.
