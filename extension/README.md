# Hidden — extensão Chrome local

Requer Chrome 127 ou superior. Na raiz do projeto, inicia `python3 run_app.py` (Windows: `py run_app.py`). O endereço inicial é http://127.0.0.1:8787; site e API usam a mesma origem local.

## Instalação

1. Extrai `hidden-extension.zip` ou usa a pasta `extension` do projeto.
2. Abre `chrome://extensions`, ativa **Modo de programador** e escolhe **Carregar sem compactação**. Seleciona a pasta que contém `manifest.json`.
3. No menu de extensões, fixa **Hidden** para ter a ação manual sempre disponível.
4. Para PDFs locais, abre os detalhes de Hidden e ativa **Permitir acesso a URLs de ficheiros**. Esse acesso depende da tua autorização no Chrome.

Abre um PDF numa aba. Hidden mostra o nome e **Abrir no Hidden**. Se o Chrome impedir o popup automático, o ícone mostra **PDF**; clica nele. O documento original fica aberto. A ação transfere o ficheiro para o site e mostra a confirmação de categorias. Só **Anonymize document** inicia Presidio e Gemini.

Nas definições podes desligar o aviso automático ou alterar o endereço do serviço. Apenas `http://127.0.0.1` e `http://localhost`, com porta opcional, são aceites. A extensão aceita pedidos somente da origem configurada e da aba criada para essa transferência.

## Dados e limites

- Limite: 20 MB por PDF. PDFs sem texto selecionável requerem OCR separado.
- Os bytes ficam na memória de uma página temporária e chegam ao site em blocos verificados por SHA-256. O identificador é aleatório, vinculado à aba, de utilização única e expira em dez minutos. A página fecha e os bytes são libertados após a entrega.
- A importação não envia o PDF ao Python nem chama Gemini. O serviço local recebe o original apenas na exportação. Gemini recebe texto previamente protegido pelo Presidio.
- O histórico guarda até dez nomes, identificadores de revisão e expirações; não guarda texto ou PDF. As revisões expiram ao fim de uma hora ou ao parar o serviço. Reabrir uma revisão exige escolher o mesmo original para exportar.
- As permissões HTTP/HTTPS permitem reconhecer respostas `application/pdf`, incluindo endereços sem `.pdf`. Não há análise automática de outros sites. `file://` só funciona quando autorizado no Chrome.
- PDFs `blob:`, gerados por POST ou cujo acesso não possa ser repetido não são contornados: descarrega o PDF e seleciona-o no site. Se o serviço estiver parado, a página temporária permite tentar novamente.

A revisão mostra palavras originais com fundo nos fragmentos a ocultar. PDF e TXT recebem os asteriscos; TXT e relatório ficam em `output/`. Não há análise ou download TXT dentro da extensão.

## Testes

Na raiz do projeto: `node --test extension-tests/*.test.js`. O frontend tem testes da reconstrução, integridade e confirmação antes de analisar. Não é necessária publicação na Chrome Web Store.

Identidade fixa: `lfnbhbifaakkolphooipdoinpknmacnf`. O manifesto inclui somente a chave pública usada para manter esse identificador; não contém chaves Gemini.
