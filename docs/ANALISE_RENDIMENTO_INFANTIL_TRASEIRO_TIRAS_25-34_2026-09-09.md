# Análise de rendimento — sandália infantil 25–34

> Continuação do ciclo de alinhamento ficha→PV→débito→Kanban (mesmo PR).  
> Branch: `cursor/alinhamento-ficha-pv-debito-kanban-43d3`  
> Ficha de referência: **I701** (`049cef09-f46f-4017-b9c7-e927b52b8632`)  
> Grade de referência (auditoria 05/09/2026): **480 pares · 25–34 · 80 em 29/30 · 40 nos demais**

## Objetivo

Analisar o **rendimento dos itens em separado**, nesta ordem:

1. **Traseiro** (elástico/acessório/tira com rótulo de traseiro)
2. **Tiras da frente** (`strap_colors` restantes + acessórios de frente)

Rendimento = `pares ÷ consumo_total` (pares por unidade de material).

## Método

| Passo | Onde |
|---|---|
| Classificar linhas por rótulo (`traseiro` / `frente`) | `src/lib/infantilSandalYieldAnalysis.ts` |
| Consumo por tamanho 25–34 (mapa → conjugada → escalar) | `pickConsumptionForSize` |
| Totais na grade I701 de 480 pares | mesma lib + SQL |
| Extração live da ficha | `sql-scripts/audit-i701-rendimento-traseiro-tiras-25-34.sql` |

### Regras de classificação

- **Traseiro:** label/material contém `traseiro`, `talão`, `counter`, `heel`, `calcanhar`.
- **Tira da frente:** label contém `frente`/`front`, **ou** é linha de `strap_colors` sem rótulo de traseiro.
- Acessório sem esses sinais fica fora das duas seções (não mistura com a análise pedida).

## 1) Traseiro

Fonte viva: `technical_sheets.components_accessories` (e eventualmente `strap_colors` se rotulada).

Para cada numeração 25–34:

| size | pares (grade ref.) | consumo/par | total |
|---|---:|---:|---:|
| 25–34 | ver SQL `traseiro_por_tamanho` | mapa da ficha | pares × consumo |

**Totais** (preencher após rodar o SQL):

| métrica | valor |
|---|---|
| consumo total na grade | _pendente live_ |
| consumo médio / par | _pendente live_ |
| rendimento (pares / unidade) | _pendente live_ |

Unidade típica do traseiro infantil: **m** (elástico) — não dm².

## 2) Tiras da frente

Fonte viva: `technical_sheets.strap_colors` (cm/par) + acessórios rotulados de frente.

| size | pares | cm/par | total cm | total m |
|---|---:|---:|---:|---:|
| 25–34 | grade ref. | mapa | · | · |

**Totais** (preencher após rodar o SQL):

| métrica | valor |
|---|---|
| total cm / total m na grade | _pendente live_ |
| cm médio / par | _pendente live_ |
| rendimento (pares / m de tira) | _pendente live_ |

Se houver receita artesanal (`confirmed_yield_m_per_m`), a necessidade de napa-base é:

`metros_napa = metros_tira ÷ rendimento_confirmado`

(isso é passo seguinte — não misturar com o consumo cm/par da ficha).

## Cabedal I701 (contexto, fora do pedido)

Já auditado: duas peças aditivas **2,74 + 2,28 dm²/par**, largura 1370 mm → 137 dm²/m.

Na grade de 480 pares: `(2,74 + 2,28) × 480 ÷ 137 ≈ 17,588 m` de dublado.

Isso **não** substitui traseiro/tiras — é só o cabedal composto Glow.

## Como obter os números vivos

```bash
gh workflow run "Supabase — Exec SQL file (Management API)" \
  --ref cursor/alinhamento-ficha-pv-debito-kanban-43d3 \
  -f sql_path=sql-scripts/audit-i701-rendimento-traseiro-tiras-25-34.sql \
  -f dry_run=false \
  -f strict=true
```

Ou colar o SQL no SQL Editor do projeto.

## Artefatos

| Tipo | Caminho |
|---|---|
| Analisador TS | `src/lib/infantilSandalYieldAnalysis.ts` |
| Testes | `src/lib/__tests__/infantilSandalYieldAnalysis.test.ts` |
| SQL live | `sql-scripts/audit-i701-rendimento-traseiro-tiras-25-34.sql` |
| Planejamento auditoria (fechado) | `docs/AUDITORIA_ALINHAMENTO_FICHA_PV_DEBITO_KANBAN_2026-09-09.md` |

## Status

- [x] Método e ordem (traseiro → tiras da frente) travados em código + teste
- [x] Grade 25–34 / 480 pares como referência
- [ ] Números vivos da ficha I701 (SQL no banco) — depende de credencial Supabase neste ambiente
- [ ] Se a sandália **não** for a I701, informar o código da ficha para reapontar o SQL

**Mesmo PR** — sem branch/PR separados.
