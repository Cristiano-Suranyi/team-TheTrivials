# Relatório de anonimização

## Resumo
- Fragmentos mascarados: **82** (212 palavras substituídas por `*`)
- Rejeitados na validação manual: 0
- Modelo LLM: `gemini-3.1-flash-lite`

## Por categoria
| Categoria | Fragmentos |
|---|---|
| SAUDE | 43 |
| IDENTIFICACAO | 13 |
| CONTACTO | 8 |
| OUTRO_SENSIVEL | 5 |
| FINANCEIRO | 5 |
| MANUAL | 2 |
| SENSIVEL | 2 |
| BIOMETRICO | 2 |
| GENETICO | 1 |
| RELIGIAO | 1 |

## Por origem
| Origem | Fragmentos |
|---|---|
| llm | 34 |
| coverage | 25 |
| presidio | 21 |
| manual | 2 |

## Deteções
| Linha | Categoria | Origem | Palavras | Justificação |
|---|---|---|---|---|
| 4 | MANUAL | manual | 2 | Seleção confirmada na revisão. |
| 5 | MANUAL | manual | 1 | Seleção confirmada na revisão. |
| 8 | IDENTIFICACAO | presidio | 1 | Seleção confirmada na revisão. |
| 10 | CONTACTO | llm | 8 | Seleção confirmada na revisão. |
| 11 | CONTACTO | presidio | 4 | Seleção confirmada na revisão. |
| 12 | CONTACTO | presidio | 1 | Seleção confirmada na revisão. |
| 13 | IDENTIFICACAO | presidio | 1 | Seleção confirmada na revisão. |
| 15 | SAUDE | coverage | 1 | Seleção confirmada na revisão. |
| 15 | IDENTIFICACAO | llm | 1 | Seleção confirmada na revisão. |
| 15 | OUTRO_SENSIVEL | llm | 1 | Seleção confirmada na revisão. |
| 15 | SAUDE | coverage | 1 | Seleção confirmada na revisão. |
| 15 | IDENTIFICACAO | llm | 2 | Seleção confirmada na revisão. |
| 15 | SAUDE | llm | 1 | Seleção confirmada na revisão. |
| 16 | SAUDE | llm | 1 | Seleção confirmada na revisão. |
| 16 | SAUDE | coverage | 1 | Seleção confirmada na revisão. |
| 17 | SAUDE | llm | 2 | Seleção confirmada na revisão. |
| 18 | SAUDE | llm | 1 | Seleção confirmada na revisão. |
| 18 | SAUDE | coverage | 1 | Seleção confirmada na revisão. |
| 19 | SAUDE | coverage | 9 | Seleção confirmada na revisão. |
| 19 | SAUDE | llm | 3 | Seleção confirmada na revisão. |
| 19 | SAUDE | coverage | 5 | Seleção confirmada na revisão. |
| 20 | SAUDE | coverage | 1 | Seleção confirmada na revisão. |
| 20 | SAUDE | llm | 2 | Seleção confirmada na revisão. |
| 20 | SAUDE | coverage | 10 | Seleção confirmada na revisão. |
| 21 | SAUDE | coverage | 6 | Seleção confirmada na revisão. |
| 21 | GENETICO | llm | 3 | Seleção confirmada na revisão. |
| 21 | SAUDE | coverage | 1 | Seleção confirmada na revisão. |
| 23 | SENSIVEL | presidio | 1 | Seleção confirmada na revisão. |
| 24 | IDENTIFICACAO | llm | 1 | Seleção confirmada na revisão. |
| 24 | IDENTIFICACAO | llm | 2 | Seleção confirmada na revisão. |
| 24 | IDENTIFICACAO | presidio | 1 | Seleção confirmada na revisão. |
| 24 | IDENTIFICACAO | llm | 2 | Seleção confirmada na revisão. |
| 25 | RELIGIAO | llm | 2 | Seleção confirmada na revisão. |
| 26 | SENSIVEL | llm | 2 | Seleção confirmada na revisão. |
| 27 | SAUDE | llm | 1 | Seleção confirmada na revisão. |
| 27 | SAUDE | coverage | 4 | Seleção confirmada na revisão. |
| 27 | SAUDE | llm | 3 | Seleção confirmada na revisão. |
| 27 | SAUDE | coverage | 4 | Seleção confirmada na revisão. |
| 28 | SAUDE | coverage | 2 | Seleção confirmada na revisão. |
| 28 | SAUDE | llm | 3 | Seleção confirmada na revisão. |
| 28 | SAUDE | coverage | 2 | Seleção confirmada na revisão. |
| 30 | FINANCEIRO | llm | 4 | Seleção confirmada na revisão. |
| 30 | IDENTIFICACAO | presidio | 1 | Seleção confirmada na revisão. |
| 31 | FINANCEIRO | presidio | 4 | Seleção confirmada na revisão. |
| 31 | FINANCEIRO | presidio | 1 | Seleção confirmada na revisão. |
| 31 | FINANCEIRO | presidio | 1 | Seleção confirmada na revisão. |
| 32 | FINANCEIRO | llm | 1 | Seleção confirmada na revisão. |
| 34 | BIOMETRICO | presidio | 1 | Seleção confirmada na revisão. |
| 35 | BIOMETRICO | presidio | 1 | Seleção confirmada na revisão. |
| 36 | OUTRO_SENSIVEL | llm | 1 | Seleção confirmada na revisão. |
| 37 | OUTRO_SENSIVEL | llm | 1 | Seleção confirmada na revisão. |
| 38 | SAUDE | llm | 1 | Seleção confirmada na revisão. |
| 39 | SAUDE | llm | 2 | Seleção confirmada na revisão. |
| 41 | SAUDE | coverage | 11 | Seleção confirmada na revisão. |
| 42 | SAUDE | coverage | 10 | Seleção confirmada na revisão. |
| 42 | SAUDE | llm | 2 | Seleção confirmada na revisão. |
| 42 | SAUDE | coverage | 1 | Seleção confirmada na revisão. |
| 43 | SAUDE | coverage | 2 | Seleção confirmada na revisão. |
| 43 | SAUDE | llm | 1 | Seleção confirmada na revisão. |
| 43 | SAUDE | coverage | 12 | Seleção confirmada na revisão. |
| 44 | SAUDE | coverage | 6 | Seleção confirmada na revisão. |
| 45 | SAUDE | coverage | 10 | Seleção confirmada na revisão. |
| 46 | SAUDE | coverage | 3 | Seleção confirmada na revisão. |
| 47 | SAUDE | llm | 3 | Seleção confirmada na revisão. |
| 47 | SAUDE | coverage | 1 | Seleção confirmada na revisão. |
| 47 | SAUDE | presidio | 1 | Seleção confirmada na revisão. |
| 47 | SAUDE | llm | 2 | Seleção confirmada na revisão. |
| 47 | SAUDE | coverage | 1 | Seleção confirmada na revisão. |
| 47 | SAUDE | llm | 4 | Seleção confirmada na revisão. |
| 48 | SAUDE | llm | 5 | Seleção confirmada na revisão. |
| 48 | SAUDE | coverage | 1 | Seleção confirmada na revisão. |
| 50 | IDENTIFICACAO | presidio | 2 | Seleção confirmada na revisão. |
| 50 | OUTRO_SENSIVEL | llm | 1 | Seleção confirmada na revisão. |
| 51 | CONTACTO | presidio | 1 | Seleção confirmada na revisão. |
| 52 | CONTACTO | presidio | 1 | Seleção confirmada na revisão. |
| 53 | IDENTIFICACAO | presidio | 2 | Seleção confirmada na revisão. |
| 53 | OUTRO_SENSIVEL | llm | 2 | Seleção confirmada na revisão. |
| 54 | CONTACTO | presidio | 1 | Seleção confirmada na revisão. |
| 56 | IDENTIFICACAO | presidio | 3 | Seleção confirmada na revisão. |
| 57 | IDENTIFICACAO | llm | 1 | Seleção confirmada na revisão. |
| 59 | CONTACTO | presidio | 1 | Seleção confirmada na revisão. |
| 60 | CONTACTO | presidio | 1 | Seleção confirmada na revisão. |

## Pipeline
- Presidio: 24 fragmentos protegidos antes do Gemini.
- Gemini: 38 deteções adicionais.
- O relatório reflete as seleções atuais da revisão.
