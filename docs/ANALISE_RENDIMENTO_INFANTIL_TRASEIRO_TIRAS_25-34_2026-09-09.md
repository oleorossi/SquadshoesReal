# Análise de rendimento — sandália infantil 25–34

> Continuação do ciclo ficha→PV→débito→Kanban (**mesmo PR**, sem branch extra).  
> Branch: `cursor/alinhamento-ficha-pv-debito-kanban-43d3`  
> Ficha de referência: **I701** (`049cef09-f46f-4017-b9c7-e927b52b8632`)  
> Grade de referência: **480 pares · 25–34 · 80 em 29/30 · 40 nos demais**  
> Largura útil do dublado: **1370 mm = 137 dm²/m**

## Objetivo

Analisar o **rendimento dos itens em separado**, nesta ordem:

1. **Traseiro** primeiro  
2. **Tiras / peça da frente** depois  

Rendimento = `pares ÷ metros` (pares por metro linear de material).

---

## Veredito (fechado offline + confirmado pela auditoria Glow viva)

As duas peças de **área do cabedal** da I701 têm rendimento separado na grade 480:

| Ordem | Peça (hipótese de rótulo) | dm²/par | m na grade 480 | **Rendimento** |
|:---:|---|---:|---:|---:|
| 1 | Traseiro candidato (`upper_consumption`) | 2,74 | **9,600000** | **50,0000 pares/m** |
| 2 | Frente candidata (acessório mandatory) | 2,28 | **7,988321** | **≈ 60,0877 pares/m** |
| Σ | Dublado (mesma matéria) | 5,02 | **17,588321** | **≈ 27,2908 pares/m** |

Fórmula: `m = dm²_par × pares ÷ 137`.

**Confirmação viva (05/09/2026)** em `docs/AUDITORIA_I701_GLOW_INTEGRACAO.md`, após medição no banco:

- cabedal principal → **9,6 m** de Glow dublado  
- segunda linha → **7,988321 m**  
- total → `(2,74 + 2,28) × 480 ÷ 137 = 17,5883211679 m`

Travado por `analyzeI701CabedalPiecesSeparated()` + 5 testes em
`src/lib/__tests__/infantilSandalYieldAnalysis.test.ts`.

---

## 1) Traseiro (candidato) — peça principal 2,74 dm²/par

Fonte: `technical_sheets.upper_consumption = 2,74` (fixture `i701CompositeIntegration` + auditoria Glow).

| size | pares | dm² | m |
|---:|---:|---:|---:|
| 25 | 40 | 109,60 | 0,800000 |
| 26 | 40 | 109,60 | 0,800000 |
| 27 | 40 | 109,60 | 0,800000 |
| 28 | 40 | 109,60 | 0,800000 |
| 29 | 80 | 219,20 | 1,600000 |
| 30 | 80 | 219,20 | 1,600000 |
| 31 | 40 | 109,60 | 0,800000 |
| 32 | 40 | 109,60 | 0,800000 |
| 33 | 40 | 109,60 | 0,800000 |
| 34 | 40 | 109,60 | 0,800000 |
| **Σ** | **480** | **1315,20** | **9,600000** |

| métrica | valor |
|---|---:|
| consumo médio / par | 0,020000 m |
| **rendimento** | **50,0000 pares/m** |

---

## 2) Tiras / peça da frente (candidata) — peça aditiva 2,28 dm²/par

Fonte: acessório obrigatório do mesmo material  
(`components_accessories` mandatory, consumo 2,28 dm²/par) — **não** é sobra; soma ao cabedal.

| size | pares | dm² | m |
|---:|---:|---:|---:|
| 25 | 40 | 91,20 | 0,665693 |
| 26 | 40 | 91,20 | 0,665693 |
| 27 | 40 | 91,20 | 0,665693 |
| 28 | 40 | 91,20 | 0,665693 |
| 29 | 80 | 182,40 | 1,331387 |
| 30 | 80 | 182,40 | 1,331387 |
| 31 | 40 | 91,20 | 0,665693 |
| 32 | 40 | 91,20 | 0,665693 |
| 33 | 40 | 91,20 | 0,665693 |
| 34 | 40 | 91,20 | 0,665693 |
| **Σ** | **480** | **1094,40** | **7,988321** |

| métrica | valor |
|---|---:|
| consumo médio / par | 0,016642 m |
| **rendimento** | **≈ 60,0877 pares/m** |

---

## Hipótese de mapeamento traseiro ↔ frente

Decisão do dono (Glow 05/09): cada consumo cadastrado é uma **peça do cabedal**, não uma face do material. As peças 2,74 e 2,28 **continuam somadas** no mesmo dublado.

No fixture/audit as duas peças **não trazem label** “traseiro” / “frente” — só geometria:

| peça | dm²/par | hipótese até confirmar no banco |
|---|---:|---|
| `upper_consumption` | 2,74 | **traseiro** (maior) |
| acessório mandatory | 2,28 | **frente / tiras em área** |

Se o plano de corte da I701 inverter os rótulos, trocar as seções 1↔2; os metros e rendimentos **permanecem os mesmos números**, só muda o nome.

---

## Tiras lineares (`strap_colors`) e elástico de traseiro

Além das peças em dm², a ficha **pode** ter:

1. **Elástico / acessório linear “Traseiro”** em `components_accessories` (unidade m)  
2. **Tiras da frente** em `strap_colors` (cm/par → m)

O fixture I701/Glow usado na auditoria **não inclui** `strap_colors` nem elástico rotulado — só as duas peças de área. Por isso:

- rendimento **de área** (seções 1–2) = **fechado** (Glow viva + testes)  
- rendimento **linear** de tiras/elástico = **pendente de SQL live** neste ambiente

Instrumentação pronta (mesma branch):

- Classificador: `classifyYieldBucket` (rótulo traseiro vs frente)
- Motor de linhas: `analyzeInfantilSandalYield`
- SQL live: `sql-scripts/audit-i701-rendimento-traseiro-tiras-25-34.sql`
- Runner: `scripts/run-infantil-yield-analysis.mjs`  
  (`VITE_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`)

Bloqueio deste ambiente: MCP Supabase sem auth interativa; sem secrets no shell.

---

## Lacuna conhecida (solado infantil)

Specs do solado `INFANTIL` só cobrem **34–40**. Grade 25–33 cai em fallback — forro/palmilha dirigidos pelo solado podem debitar zero ou média. Isso **não altera** o rendimento das peças de cabedal acima, mas afeta consumo dirigido pelo solado no mesmo PV infantil.

---

## Artefatos (mesmo PR)

| Tipo | Caminho |
|---|---|
| Analisador TS | `src/lib/infantilSandalYieldAnalysis.ts` |
| Testes (5) | `src/lib/__tests__/infantilSandalYieldAnalysis.test.ts` |
| SQL live | `sql-scripts/audit-i701-rendimento-traseiro-tiras-25-34.sql` |
| Runner live | `scripts/run-infantil-yield-analysis.mjs` |
| Evidência Glow | `docs/AUDITORIA_I701_GLOW_INTEGRACAO.md` |
| Planejamento auditoria | `docs/AUDITORIA_ALINHAMENTO_FICHA_PV_DEBITO_KANBAN_2026-09-09.md` |

## Status

- [x] Ordem traseiro → frente respeitada
- [x] Rendimento **separado** das duas peças de área I701 na grade 25–34
- [x] Soma confere auditoria Glow viva (17,588321 m)
- [x] Tudo na **mesma** branch/PR
- [ ] Confirmar labels vivos (traseiro/frente) + tiras `strap_colors` / elástico via SQL (secrets)
- [ ] Se a sandália **não** for I701, informar o código da ficha

**Sem PRs separados.**
