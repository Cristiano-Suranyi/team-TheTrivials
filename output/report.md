# Relatório de anonimização

## Resumo
- Fragmentos mascarados: **59** (115 palavras substituídas por `*`)
- Rejeitados na validação manual: 0
- Modelo LLM: `gemini-3.1-flash-lite`

## Por categoria
| Categoria | Fragmentos |
|---|---|
| IDENTIFICACAO | 29 |
| SAUDE | 19 |
| FINANCEIRO | 5 |
| OUTRO_SENSIVEL | 2 |
| CONTACTO | 1 |
| GENETICO | 1 |
| RELIGIAO | 1 |
| BIOMETRICO | 1 |

## Por origem
| Origem | Fragmentos |
|---|---|
| llm | 40 |
| presidio | 19 |

## Deteções
| Linha | Categoria | Origem | Palavras | Justificação |
|---|---|---|---|---|
| 5 | IDENTIFICACAO | presidio | 4 | PERSON (Presidio, score 0.85) |
| 6 | IDENTIFICACAO | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 7 | IDENTIFICACAO | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 8 | IDENTIFICACAO | presidio | 1 | PT_NIF (Presidio, score 0.65) |
| 9 | IDENTIFICACAO | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 10 | CONTACTO | llm | 8 | Dado pessoal ou sensível identificado pelo modelo. |
| 11 | IDENTIFICACAO | presidio | 4 | PHONE_NUMBER (Presidio, score 0.85) |
| 12 | IDENTIFICACAO | presidio | 1 | EMAIL_ADDRESS (Presidio, score 1.00) |
| 13 | IDENTIFICACAO | presidio | 1 | NISS (Presidio, score 0.60) |
| 15 | IDENTIFICACAO | presidio | 2 | PERSON (Presidio, score 0.85) |
| 15 | OUTRO_SENSIVEL | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 15 | IDENTIFICACAO | llm | 2 | Dado pessoal ou sensível identificado pelo modelo. |
| 15 | SAUDE | llm | 3 | Dado pessoal ou sensível identificado pelo modelo. |
| 16 | SAUDE | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 16 | SAUDE | llm | 3 | Dado pessoal ou sensível identificado pelo modelo. |
| 17 | SAUDE | llm | 2 | Dado pessoal ou sensível identificado pelo modelo. |
| 18 | SAUDE | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 19 | SAUDE | llm | 3 | Dado pessoal ou sensível identificado pelo modelo. |
| 20 | SAUDE | llm | 2 | Dado pessoal ou sensível identificado pelo modelo. |
| 21 | GENETICO | llm | 3 | Dado pessoal ou sensível identificado pelo modelo. |
| 23 | IDENTIFICACAO | presidio | 1 | PERSON (Presidio, score 0.85) |
| 24 | IDENTIFICACAO | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 24 | IDENTIFICACAO | llm | 2 | Dado pessoal ou sensível identificado pelo modelo. |
| 24 | IDENTIFICACAO | presidio | 1 | PERSON (Presidio, score 0.85) |
| 24 | IDENTIFICACAO | llm | 2 | Dado pessoal ou sensível identificado pelo modelo. |
| 25 | RELIGIAO | llm | 2 | Dado pessoal ou sensível identificado pelo modelo. |
| 26 | IDENTIFICACAO | llm | 2 | Dado pessoal ou sensível identificado pelo modelo. |
| 27 | SAUDE | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 27 | SAUDE | llm | 3 | Dado pessoal ou sensível identificado pelo modelo. |
| 28 | SAUDE | llm | 5 | Dado pessoal ou sensível identificado pelo modelo. |
| 30 | IDENTIFICACAO | presidio | 1 | PT_NIF (Presidio, score 0.65) |
| 31 | FINANCEIRO | presidio | 4 | CREDIT_CARD (Presidio, score 0.70) |
| 31 | FINANCEIRO | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 32 | FINANCEIRO | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 34 | FINANCEIRO | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 35 | BIOMETRICO | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 36 | SAUDE | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 37 | SAUDE | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 38 | SAUDE | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 39 | SAUDE | llm | 2 | Dado pessoal ou sensível identificado pelo modelo. |
| 41 | SAUDE | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 41 | OUTRO_SENSIVEL | llm | 3 | Dado pessoal ou sensível identificado pelo modelo. |
| 42 | SAUDE | llm | 5 | Dado pessoal ou sensível identificado pelo modelo. |
| 43 | SAUDE | llm | 3 | Dado pessoal ou sensível identificado pelo modelo. |
| 47 | SAUDE | llm | 3 | Dado pessoal ou sensível identificado pelo modelo. |
| 47 | IDENTIFICACAO | presidio | 1 | PERSON (Presidio, score 0.85) |
| 47 | SAUDE | llm | 2 | Dado pessoal ou sensível identificado pelo modelo. |
| 50 | IDENTIFICACAO | presidio | 2 | PERSON (Presidio, score 0.85) |
| 50 | IDENTIFICACAO | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 51 | IDENTIFICACAO | presidio | 1 | PHONE_NUMBER (Presidio, score 0.85) |
| 52 | IDENTIFICACAO | presidio | 1 | EMAIL_ADDRESS (Presidio, score 1.00) |
| 53 | IDENTIFICACAO | presidio | 2 | PERSON (Presidio, score 0.85) |
| 53 | IDENTIFICACAO | llm | 2 | Dado pessoal ou sensível identificado pelo modelo. |
| 54 | IDENTIFICACAO | presidio | 1 | PHONE_NUMBER (Presidio, score 0.85) |
| 56 | IDENTIFICACAO | presidio | 3 | PERSON (Presidio, score 0.85) |
| 57 | FINANCEIRO | llm | 1 | Dado pessoal ou sensível identificado pelo modelo. |
| 58 | IDENTIFICACAO | llm | 2 | Dado pessoal ou sensível identificado pelo modelo. |
| 59 | IDENTIFICACAO | presidio | 1 | EMAIL_ADDRESS (Presidio, score 1.00) |
| 60 | IDENTIFICACAO | presidio | 1 | PHONE_NUMBER (Presidio, score 0.85) |
