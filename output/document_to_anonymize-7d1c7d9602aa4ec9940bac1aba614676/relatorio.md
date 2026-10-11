# Relatório de anonimização

## Resumo
- Fragmentos mascarados: **28** (49 palavras substituídas por `*`)
- Rejeitados na validação manual: 0
- Modelo LLM: `gemini-3.1-flash-lite`

## Por categoria
| Categoria | Fragmentos |
|---|---|
| IDENTIFICACAO | 13 |
| CONTACTO | 8 |
| FINANCEIRO | 4 |
| BIOMETRICO | 2 |
| SENSIVEL | 1 |

## Por origem
| Origem | Fragmentos |
|---|---|
| presidio | 24 |
| llm | 4 |

## Deteções
| Linha | Categoria | Origem | Palavras | Justificação |
|---|---|---|---|---|
| 5 | IDENTIFICACAO | presidio | 4 | Seleção confirmada na revisão. |
| 6 | IDENTIFICACAO | llm | 1 | Seleção confirmada na revisão. |
| 8 | IDENTIFICACAO | presidio | 1 | Seleção confirmada na revisão. |
| 9 | IDENTIFICACAO | presidio | 1 | Seleção confirmada na revisão. |
| 10 | CONTACTO | llm | 8 | Seleção confirmada na revisão. |
| 11 | CONTACTO | presidio | 4 | Seleção confirmada na revisão. |
| 12 | CONTACTO | presidio | 1 | Seleção confirmada na revisão. |
| 13 | IDENTIFICACAO | presidio | 1 | Seleção confirmada na revisão. |
| 15 | IDENTIFICACAO | presidio | 2 | Seleção confirmada na revisão. |
| 23 | SENSIVEL | presidio | 1 | Seleção confirmada na revisão. |
| 24 | IDENTIFICACAO | llm | 1 | Seleção confirmada na revisão. |
| 24 | IDENTIFICACAO | presidio | 1 | Seleção confirmada na revisão. |
| 30 | IDENTIFICACAO | presidio | 1 | Seleção confirmada na revisão. |
| 31 | FINANCEIRO | presidio | 4 | Seleção confirmada na revisão. |
| 31 | FINANCEIRO | presidio | 1 | Seleção confirmada na revisão. |
| 31 | FINANCEIRO | presidio | 1 | Seleção confirmada na revisão. |
| 32 | FINANCEIRO | llm | 1 | Seleção confirmada na revisão. |
| 34 | BIOMETRICO | presidio | 1 | Seleção confirmada na revisão. |
| 35 | BIOMETRICO | presidio | 1 | Seleção confirmada na revisão. |
| 50 | IDENTIFICACAO | presidio | 2 | Seleção confirmada na revisão. |
| 51 | CONTACTO | presidio | 1 | Seleção confirmada na revisão. |
| 52 | CONTACTO | presidio | 1 | Seleção confirmada na revisão. |
| 53 | IDENTIFICACAO | presidio | 2 | Seleção confirmada na revisão. |
| 54 | CONTACTO | presidio | 1 | Seleção confirmada na revisão. |
| 56 | IDENTIFICACAO | presidio | 3 | Seleção confirmada na revisão. |
| 57 | IDENTIFICACAO | presidio | 1 | Seleção confirmada na revisão. |
| 59 | CONTACTO | presidio | 1 | Seleção confirmada na revisão. |
| 60 | CONTACTO | presidio | 1 | Seleção confirmada na revisão. |

- Contexto automático: saude

## Pipeline
- Presidio: 25 fragmentos protegidos antes do Gemini.
- Gemini: 13 deteções adicionais.
- O relatório reflete as seleções atuais da revisão.
