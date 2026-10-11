# Hidden — extensão Chrome local

Requer Chrome 127 ou superior. Na raiz do projeto, inicia `python3 run_app.py` (Windows: `py run_app.py`). O endereço inicial é http://127.0.0.1:8787; site e API usam a mesma origem local.

## Instalação

1. Extrai `hidden-extension.zip` ou usa a pasta `extension` do projeto.
2. Abre `chrome://extensions`, ativa **Modo de programador** e escolhe **Carregar sem compactação**. Seleciona a pasta que contém `manifest.json`.
3. No menu de extensões, fixa **Hidden** para ter a ação manual sempre disponível.
4. Para PDFs locais, abre os detalhes de Hidden e ativa **Permitir acesso a URLs de ficheiros**. Esse acesso depende da tua autorização no Chrome.

## Fluxo

1. Abres um PDF e o Hidden pergunta **"Anonymize this document?"**. Se o Chrome não abrir o popup sozinho, o ícone mostra **PDF**: clica nele.
2. **Yes**: a extensão lê o PDF e envia-o ao backend Python (`POST /api/public/sessions/upload`).
3. O backend extrai o texto, corre Presidio + Gemini e guarda o resultado numa sessão. O ícone mostra o progresso (`42%`) e podes fechar o popup.
4. Quando termina, o ícone mostra **✓** e o popup reabre com **Download masked version** e **Review changes**.
5. **Download** guarda o PDF mascarado (`GET /api/public/sessions/<id>/masked.pdf`). **Review** abre `http://127.0.0.1:8787/review/<id>`.
6. A página de revisão carrega o original e as deteções do backend.
7. Ativas ou desativas palavras e descarregas a versão final. O backend já tem o PDF, por isso não é preciso escolhê-lo de novo.

Para não teres de correr `run_app.py` à mão (macOS): abre `scripts/install_autostart.command` uma vez. O servidor fica sempre ligado em `127.0.0.1:8787` e arranca sozinho quando inicias sessão. Para desfazer: `scripts/uninstall_autostart.command`.

Teste ponta a ponta sem Chrome (servidor + Gemini reais): `scripts/e2e_extension_flow.sh`.

## Dados e limites

- Limite: 20 MB por PDF. PDFs sem texto selecionável requerem OCR separado.
- O PDF é enviado apenas ao serviço local (`127.0.0.1`) e fica em memória com a sessão (uma hora, ou até parar o serviço). O Gemini recebe só texto já protegido pelo Presidio.
- A importação não envia o PDF ao Python nem chama Gemini. O serviço local recebe o original apenas na exportação. Gemini recebe texto previamente protegido pelo Presidio.
- O histórico guarda até dez nomes, identificadores de revisão e expirações; não guarda texto ou PDF. As revisões expiram ao fim de uma hora ou ao parar o serviço. Reabrir uma revisão exige escolher o mesmo original para exportar.
- As permissões HTTP/HTTPS permitem reconhecer respostas `application/pdf`, incluindo endereços sem `.pdf`. Não há análise automática de outros sites. `file://` só funciona quando autorizado no Chrome.
- PDFs `blob:`, gerados por POST ou cujo acesso não possa ser repetido não são contornados: descarrega o PDF e seleciona-o no site. Se o serviço estiver parado, a página temporária permite tentar novamente.

A revisão mostra palavras originais com fundo nos fragmentos a ocultar. PDF e TXT recebem os asteriscos; TXT e relatório ficam em `output/`. Não há análise ou download TXT dentro da extensão.

## Testes

Na raiz do projeto: `node --test extension-tests/*.test.js`. O frontend tem testes da reconstrução, integridade e confirmação antes de analisar. Não é necessária publicação na Chrome Web Store.

Identidade fixa: `lfnbhbifaakkolphooipdoinpknmacnf`. O manifesto inclui somente a chave pública usada para manter esse identificador; não contém chaves Gemini.
