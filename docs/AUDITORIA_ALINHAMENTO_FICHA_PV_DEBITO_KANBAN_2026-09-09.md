# Planejamento inicial de auditoria — Ficha → PV → Débito → Kanban

> **Status: FECHADO** (2026-09-09)  
> Branch: `cursor/alinhamento-ficha-pv-debito-kanban-43d3`  
> Compare: https://github.com/oleorossi/SquadshoesReal/compare/main...cursor/alinhamento-ficha-pv-debito-kanban-43d3?expand=1

Este documento fecha o **planejamento inicial** da auditoria de alinhamento. Escopo,
método, matriz de checagem, decisões, achados, correções aplicadas e pendências
explícitas fora deste ciclo.

---

## 1. Objetivo

Garantir que a **ficha técnica**, o **pedido de venda (PV)**, o **débito/consumo** e o
**Kanban de gestão** contam a mesma história operacional nos dois eixos abaixo.

| Eixo | Pergunta de auditoria |
|---|---|
| **A — Consumo / débito** | A Lista de Separação (`bomConsumption`) espelha o motor canônico (`orderConsumption` / SQL) nos pontos que afetam picking e baixa? |
| **B — Promote / Kanban** | O setor **Corte Cabedal** cadastrado na ficha sobrevive ao promote PV→OP e aparece no Kanban de gestão? |

**Done deste planejamento** = matriz A1–A6 e B1–B6 executada; gaps P0 corrigidos com
teste; documento + commits na branch. A7/A8 (live) ficam **fora** deste ciclo.

---

## 2. Contexto / problema

1. O painel de Construção da ficha grava **Corte Cabedal**, mas taxonomia front,
   `sector_settings`, fallback de `promote_sale_order_item` e aliases do Kanban
   divergiam — Cabedal sumia ou virava Fibra / Mesa / Palmilha.
2. A Lista de Separação (BOM) e o motor canônico de consumo evoluíram em paralelo.
   Três gaps concretos faziam a lista **mostrar número/cor errados** frente ao
   modal / SQL / débito.

---

## 3. Escopo

### 3.1 In scope (ciclo inicial)

| # | Item |
|---|---|
| B | Taxonomia de setores (`src/lib/sectors.ts`): normalize, labels, DISPLAY, FLOW, PARALLEL |
| B | Seed/upsert `sector_settings` para Corte Cabedal (`flow_order=15`, `parallel_group='corte'`) |
| B | Fallback de rota em `promote_sale_order_item` (sem Mesa/Palmilha legado; normalização via `canonical_stage_name`) |
| B | Default de rota da ficha **sem** Cabedal (opt-in) — contrato trava |
| B | Kanban gestão: aliases `Corte Palmilha→Corte Fibra`, `Mesa→Aviamento`; match canônico |
| B | `stageFlow` + `useBomOperations` reconhecem Cabedal |
| A | Paridade BOM × canônico: override de variante (cabedal/forro) |
| A | Paridade BOM × canônico: cor mapeada da forração |
| A | Paridade BOM × canônico: tiras sem cor (não inventar cor do cabedal; STRASS permanece) |
| — | Contratos/testes + typecheck sem erro **novo** |

### 3.2 Out of scope (explícito)

- Recálculo / reconciliação de estoque histórico.
- Inventar dm² de solado faltantes (dado de engenharia).
- Unificação total Lista de Separação × SQL (a lista mantém camada líquida de
  picking — especialização deliberada).
- Diagnósticos live em produção (bloqueados neste ambiente: sem `.env` /
  Supabase MCP autenticado) → A7/A8.
- Refatorar `src/components/groups/GroupEditDialog.tsx` (erro TS pré-existente).

---

## 4. Método (como a auditoria foi planejada e executada)

1. **Mapear o fluxo ponta a ponta:** ficha (setores + consumo) → PV → promote →
   débito híbrido → Kanban gestão / pointing.
2. **Fixar fonte de verdade por eixo:**
   - Eixo A: `orderConsumption.ts` (+ SQL de consumo) como canônico; `bomConsumption.ts`
     como espelho de picking.
   - Eixo B: painel de Construção + `sector_settings` + `promote_sale_order_item` +
     derive/aliases do Kanban.
3. **Checar contratos existentes** antes de mudar comportamento (rota default sem
   Cabedal; lista líquida de picking).
4. **Corrigir só gaps confirmados** com migração/front/teste no mesmo ciclo.
5. **Não reabrir escopo** por divergência live TS×SQL além dos 3 gaps A — isso vira
   auditoria pontual nova.

---

## 5. Hipóteses iniciais → veredito

| Hipótese | Veredito |
|---|---|
| H1 — Cabedal some no promote/Kanban por seed/fallback/aliases | **Confirmada (P0-B)** |
| H2 — Lista de Separação diverge do canônico em override/cor/tiras | **Confirmada (P0-A, 3 gaps)** |
| H3 — Default de rota deveria incluir Cabedal | **Refutada** (opt-in intencional) |
| H4 — Promote → hybrid debit por `sale_order_item_id` está quebrado | **Refutada** (sem bug novo) |
| H5 — `suppressCabedalForracao` diverge BOM × canônico | **Refutada** (já alinhado) |

---

## 6. Matriz de checagem (planejado → status)

| # | Checagem | Resultado | Evidência |
|---|---|---|---|
| B1 | `sector_settings` aceita Corte Cabedal no grupo corte | ✅ Corrigido | mig `20270101022300_…` |
| B2 | Promote fallback canônico (Fibra…Expedição) | ✅ Corrigido | mesma mig + contrato |
| B3 | Default de rota **sem** Cabedal (opt-in) | ✅ OK (intencional) | contrato |
| B4 | Front: normalize/labels/DISPLAY/FLOW/PARALLEL | ✅ Corrigido | `sectors.ts`, `ProductionSectorsTab.tsx` |
| B5 | Kanban: aliases + match canônico | ✅ Corrigido | `kanbanDerive.ts`, `pointingPlan.ts` |
| B6 | `stageFlow` / BOM ops listam Cabedal | ✅ Corrigido | `stageFlow.ts`, `useBomOperations.ts` |
| A1 | Colunas de consumo da ficha × motor | ✅ OK (sem gap) | select canônico alinhado |
| A2 | `suppressCabedalForracao` BOM × canônico | ✅ OK (sem gap) | `bomConsumption.ts` |
| A3 | Variante: override cabedal/forro na Lista | ✅ Corrigido | `6e1396ab` |
| A4 | Forração usa cor mapeada (não cor do PV) | ✅ Corrigido | `6e1396ab` |
| A5 | Tira sem cor não herda cor do cabedal | ✅ Corrigido | `6e1396ab` |
| A6 | Promote → `hybrid_debit` via `sale_order_item_id` | ✅ OK (sem bug novo) | trilha já canônica |
| A7 | Diagnósticos live `/system-diagnostics` | ⏸ Bloqueado | sem credencial neste ambiente |
| A8 | Casos vivos PV (amostra) | ⏸ Bloqueado | depende de A7 |

---

## 7. Achados e correções

### P0-B — Corte Cabedal quebrava promote/Kanban

- **Sintoma:** ficha com Cabedal; OP/Kanban não reconheciam o setor (ou mapeavam errado).
- **Causa:** seed ausente em `sector_settings` + fallback do promote com nomes legados +
  aliases incompletos no Kanban.
- **Fix:** `supabase/migrations/20270101022300_align_corte_cabedal_kanban_and_promote_fallback.sql`
  + alinhamento front + `src/__tests__/corteCabedalKanbanAlign.contract.test.ts`.
- **Commit:** `06b6f059`.

### P0-A — Lista de Separação divergia do motor canônico

Três gaps:

1. Override de consumo da variante ignorado (escalar da ficha; per-size não suprimido).
2. Forração / Forração Palmilha com a cor do cabedal do PV.
3. Tira sem cor ganhava a cor do cabedal (falsa demanda); STRASS sem texto de cor permanece.

- **Fix:** `bomConsumption.ts` espelhando `orderConsumption.ts` + testes de paridade.
- **Commit:** `6e1396ab`.

### Não-achados (OK neste escopo)

- Rota default sem Cabedal (opt-in).
- Supressão cabedal×forração quando solado dirige forro de palmilha.
- Promote → hybrid debit por `sale_order_item_id`.

---

## 8. Decisões travadas

| Decisão | Motivo |
|---|---|
| Cabedal **opt-in** na rota default | Contrato e produto: não forçar setor que a ficha não pediu |
| Lista de Separação **não** unifica 100% com SQL | Camada líquida de picking é especialização deliberada |
| A7/A8 fora deste ciclo | Ambiente cloud sem credencial Supabase; validação live pós-merge |
| Não reconciliar estoque histórico aqui | Escopo de auditoria de motor, não de saldo |

---

## 9. Definition of done — checklist

- [x] Matriz A/B planejada e executada (B1–B6, A1–A6).
- [x] Gaps P0 corrigidos com teste de regressão.
- [x] Suíte focada verde: `bomConsumption` (51) + `orderConsumption` (93) +
  contrato Cabedal (5) = **149**.
- [x] Typecheck sem erro **novo** (`GroupEditDialog.tsx` pré-existente permanece).
- [x] Commits na feature branch e push remoto.
- [x] Documento de fechamento do planejamento (este arquivo).
- [ ] PR aberto / mergeado.
- [ ] Migration aplicada em produção (CI / MCP).
- [ ] Diagnósticos live pós-migração (`/system-diagnostics` → Consumo) — **fora deste ambiente**.

---

## 10. Artefatos

| Tipo | Caminho / ref |
|---|---|
| Migration | `supabase/migrations/20270101022300_align_corte_cabedal_kanban_and_promote_fallback.sql` |
| Contrato B | `src/__tests__/corteCabedalKanbanAlign.contract.test.ts` |
| Motor Lista | `src/lib/bomConsumption.ts` |
| Motor canônico | `src/lib/orderConsumption.ts` |
| Fluxo de etapas | `src/lib/production/stageFlow.ts` |
| Setores | `src/lib/sectors.ts` |
| Kanban | `src/components/production/kanban/kanbanDerive.ts`, `src/components/production/kanban/pointingPlan.ts` |
| Testes A | `src/lib/__tests__/bomConsumption.test.ts` (bloco paridade eixo A) |
| Commits | `06b6f059`, `6e1396ab` |

---

## 11. Próximos passos (fora do planejamento inicial)

1. Abrir/mergear o PR e deixar o CI aplicar a migration.
2. Rodar `/system-diagnostics` → Consumo em 1–2 PVs com variante + mapa de forro +
   tira STRASS, para fechar A7/A8.
3. Se surgir divergência live TS×SQL além dos 3 gaps, abrir **auditoria pontual**
   nova — não reabrir este escopo.

---

**Planejamento inicial: FECHADO.**  
Execução dos itens in-scope: **concluída**. Pendências restantes são pós-merge / live.
