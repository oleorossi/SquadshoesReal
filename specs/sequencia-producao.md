# Motor de sequência de produção (estoque → caixa → urgência → cor → ref)

> Spec fechada por grill em 03/10/2026 com o dono. **Canônica** para o
> sequenciador que senta **na frente** do motor diário de
> [`remodelagem-producao.md`](remodelagem-producao.md).
>
> **Status implementação (03/10/2026):** Fase 1 parcial entregue —
> lib `productionSequence.ts` + testes; Lookahead usa ordem oficial e porta
> ateliê `received_at_factory`; mig `20270101030900` (`close_score` na fila do
> recompute, `list_production_sequence`, release gated). Faltam hub UI (Fase 3),
> horizonte congelado no apontamento (Fase 2) e verificação live.
>
> **Relação com outras specs:**
> - Complementa e **corrige o perímetro global** de
>   [`fila-corte-lookahead.md`](fila-corte-lookahead.md): a v1 do Lookahead
>   entregou fila de Corte com score de caixa, mas **D17** proibia reordenar
>   `production_queue` / Planejamento. **Esta spec supersede D17** — passa a
>   existir **uma ordem oficial** (caixa → billing → cor → ref) consumida por
>   Lookahead, Planejamento, Kanban, Estouro e Apontamento. Lookahead vira
>   **vista** da mesma ordem, sem cérebro paralelo.
> - Porta de cabedal complexo alinha a
>   [`atelie-cabedal-complexo.md`](atelie-cabedal-complexo.md)
>   (`received_at_factory`).
> - Capacidade finita permanece em Setores (`daily_capacity_pairs`) —
>   **não** misturar com a porta de material (padrão APS / indústria).
> - Não substitui [`compras-producao-entrelacadas.md`](compras-producao-entrelacadas.md).

## Goal

Eliminar a decisão manual de “qual cor / referência entra agora”, com um
**motor de sequência oficial** que:

1. **filtra** quem pode entrar (material crítico de corte livre + prep de
   cabedal ok; complexo só após retorno do cabedal preparado);
2. **ordena** elegíveis para **fechar PV e faturar** (caixa), depois urgência
   de billing, depois mesma cor, depois referência;
3. **promove e libera** o 1º setor nessa ordem;
4. alimenta o motor diário **só com essa ordem** (capacidade / rolagem /
   estouro sem re-ranquear);
5. mora num **hub único** Sequência / Liberação como porta da Produção.

## Background / Problem

Diagnóstico do grill (03/10/2026) + inventário do código:

1. **Tempo de PCP gasto escolhendo cor/ref** — não há motor
   estoque → caixa → cor → ref na fila global.
2. **Dois rankings** — Lookahead (score TS: valor × urgência, % PV) vs
   `production_queue` (`pinned_position → due_date → created_at`). D17
   perpetuava a divergência de propósito.
3. **Gate de material da OP** usa BOM inteiro e é advisory; promote **não**
   aborta por falta; não é porta de corte.
4. **Sem horizonte congelado** — recalcular tudo bagunça o chão.
5. **Cor** só em print / sort UI do Kanban — não na queue.
6. **Catálogo ateliê** existe, mas `atelier_complex_references` pode estar
   vazio — regra de negócio “complexo só após retorno” não governa a fila.
7. Capacidade e material já se misturam na cabeça do usuário; a indústria
   (e esta spec) **separa**: porta ≠ pares/dia.

Exemplos de regra dados pelo dono (conceituais; não dependem do estado
atual dos PVs citados):

| Caso | Regra |
|---|---|
| Cabedal **simples** (ex. lógica PV-00196) | Material de corte livre → pode disputar fila (data planejada só baixa prioridade) |
| Cabedal **complexo** (ex. lógica “costura + fivela”) | Só entra na sequência de fábrica após **cabedal preparado de volta** (`received_at_factory`) |

## Decisões fechadas (grill)

| # | Tema | Escolha |
|---|---|---|
| D1 | Continuidade | Integrar/fechar gaps da remodelagem existente — **não** redesenhar Produção do zero (Q1-B) |
| D2 | Pronto | **Um número só** nas telas do perímetro **e** Setores manda na capacidade (Q2-A+C) |
| D3 | Personas | Gestão e chão em superfícies separadas, **mesmo motor** (Q3-C) |
| D4 | Perímetro telas | Setores + Planejamento + Kanban gestão + Estouro + Apontamento (Q4-A) |
| D5 | Dor #1 | Tempo decidindo cor/ref na mão (Q6) |
| D6 | Átomo | Cascata: item PV → OP herda posição → ajuste fino na fila diária (Q7-C) |
| D7 | Arquitetura | Sequenciador **na frente**; motor diário só agenda capacidade nessa ordem (Q9-A) |
| D8 | Hierarquia | Indústria adaptada a **caixa**: elegíveis → **fechar PV** → urgência billing → mesma cor → ref (Q10-A + Q18b-A) |
| D9 | Porta material | Críticos do **1º setor / Corte** (não BOM inteiro na v1) (Q11-A) |
| D10 | Prep cabedal | Sem prep pendente **e** críticos em estoque livre (Q20-C) |
| D11 | Complexo | Entra só após **cabedal preparado recebido na fábrica** (Q20b-B) |
| D12 | Data planejada | **Não é porta** — só reduz prioridade (Q20c-B) |
| D13 | Urgência | `billing_week` / `resolve_op_due_date` (Q17-B) |
| D14 | Cor v1 | Agrupar **mesma cor** como desempate (não matriz compatível) (Q18 indústria Corte) |
| D15 | Estabilidade | Horizonte congelado: liberado / já apontou 1º setor não remexe; resto recalcula (Q12-A) |
| D16 | Entrar | Promover item **e** gate de liberação no 1º setor; fim do ranking paralelo (Q13-C) |
| D17 | Pin | Exceção humana explícita; resto recalcula em volta (Q15-A) |
| D18 | UI | Hub novo **Sequência / Liberação** = porta da Produção; embute/atalha o perímetro D4 (Q16-A + Q16b-A) |
| D19 | Capacidade | Separada da porta: `daily_capacity_pairs` em Setores (Q19-A) |
| D20 | Lookahead D17 | **Superseded** — a ordem oficial de caixa **passa** a mandar na fila global |

## Scope

### In scope

1. **Motor de sequência** (SQL/RPC + lib TS de paridade) com elegibilidade + sort D8–D14.
2. **Persistência da ordem oficial** consumida por Planejamento, Kanban, Estouro, Apontamento e Lookahead.
3. **Promote + liberação 1º setor** respeitando a porta (D9–D11, D16).
4. **Horizonte congelado** (D15) + pin (D17).
5. **Hub** `/producao/sequencia` (nome de rota a cravar na Fase 3) como entrada de Produção.
6. **Alinhar um número** de capacidade/carga no perímetro D4 (utilization / efetiva de Setores).
7. Contratos/testes da hierarquia e da porta simples vs complexo.
8. Atualizar nota de status em `fila-corte-lookahead.md` (D17 superseded).

### Out of scope (explicitamente agora não)

- Matriz de cores “compatíveis” / claro→escuro como eixo primário.
- Capacidade auto = só RH × produtividade (sem pares/dia em Setores).
- Análises completas, Antecipação, Calculadora Grade, Imprimir Fichas, Produtividade por Modelo **dentro** do hub (podem linkar; não migram nesta leva).
- Kanban de status em `/orders`.
- Aposentadoria de código de Ondas (limpeza opcional depois).
- Inventar dm² / cadastro de consumo.
- App de operador com login por funcionário.
- Reabrir decisões de perda de corte / empacotamento NF.

## Requirements

### R1 — Fonte única de ordem

1.1. Existe uma função/RPC (nome sugerido: `compute_production_sequence` /
`list_production_sequence`) que devolve a ordem oficial de itens elegíveis e
OPs ainda na zona aberta.

1.2. Lookahead, Planejamento (ordem da fila), Kanban (ordem base da fila, antes
de sort de UI local) e qualquer liberação de 1º setor **leem essa ordem** —
proibido segundo score paralelo.

1.3. `recompute_production_schedule` **aloca capacidade** na ordem oficial;
não redefine ranking (exceto pin, D17).

### R2 — Porta de elegibilidade

2.1. Item/OP elegível só se materiais **críticos de Corte** do roteiro tiverem
saldo livre suficiente (mesmo espírito D8/D18 do Lookahead: não comer reserva
de outro PV).

2.2. Se houver prep de cabedal pendente (job ateliê não `received_at_factory`,
ou equivalente de tira/OS que bloqueie o 1º setor), **não elegível**.

2.3. Ref em `atelier_complex_references`: elegível para sequência de fábrica
somente após cabedal preparado **recebido** (D11). Enquanto `sent_to_contractor`
/ anterior, fora da disputa (pode aparecer como bloqueado visível).

2.4. Cabedal simples: 2.1 + 2.2 bastam.

2.5. Data planejada / `planned_start` **não** remove elegibilidade (D12); só
entra no desempate de urgência (piora quem está cedo demais).

### R3 — Sort entre elegíveis

Ordem estrita:

1. **Fechamento de PV** — favorece item que mais contribui a completar o PV
   para faturar (reusar espírito do score Lookahead: % completo / valor
   restante; documentar fórmula na implementação e travar em teste).
2. **Urgência** — `due_date` da fila = `resolve_op_due_date` / billing week;
   item sem OP usa a mesma regra a partir do PV.
3. **Mesma cor** — agrupar cor do item (string canônica do PV).
4. **Referência** — agrupar `reference` / ficha.
5. Desempate estável: `created_at`, depois `id`.

Inelegíveis: listados **abaixo** (ou aba bloqueados) com motivo estruturado —
não somem.

### R4 — Cascata item → OP

4.1. Antes de OP: sequência manda na ordem de **promote**.

4.2. Ao promover, a OP herda posição na ordem oficial (pin só se humano pinou).

4.3. Ajuste fino: pin (D17) ou republicação; sem segundo motor.

### R5 — Horizonte congelado

5.1. Zona congelada: OP já **liberada ao 1º setor** com apontamento > 0
**ou** flag/estado “liberada na sequência do ciclo” (definir na migração um
marcador claro — ex. `sequence_frozen_at`).

5.2. Recalc automático (estoque, PV novo, retorno ateliê) **não move** zona
congelada.

5.3. Zona aberta recalcula; pinados permanecem.

### R6 — Promote + liberação 1º setor

6.1. Promote de item fora da elegibilidade da porta → **recusa** com motivo
(ou exige pin/override admin explícito — default: recusa).

6.2. Liberação / apontamento no 1º setor só para OP elegível na ordem (ou
pinada). Soft-check atual de material vira alinhado a R2 (críticos de corte),
não BOM inteiro silencioso.

6.3. Lookahead `release_corte_lookahead_items` usa a mesma porta/ordem;
remove score TS paralelo como fonte de verdade.

### R7 — Capacidade (Setores)

7.1. `sector_settings.daily_capacity_pairs` continua sendo a capacidade do
motor diário / Estouro / barras de utilização.

7.2. Sequenciador **não** substitui capacidade por “quanto material tem”.

7.3. UI do perímetro usa `utilization` / `effective_capacity_pairs` (já
corrigidos em migrações anteriores) — um número só (D2).

### R8 — Hub Sequência / Liberação

8.1. Rota nova (sugerida `/producao/sequencia`) com `ProtectedRoute` +
`RouteGuard`, módulo Produção.

8.2. É a **entrada** do hub Produção (`navigation` / home do papel produção
pode apontar para cá).

8.3. Contém a fila de sequência/liberação + navegação embutida ou atalhos
claros para Planejamento, Kanban gestão, Estouro, Apontamento, Setores.

8.4. `/producao/corte-lookahead` permanece como vista/filtro por tipo de
corte **da mesma ordem**, ou redirect — sem ranking próprio.

### R9 — Auditoria

9.1. Toda linha mostra por que está elegível/bloqueada e os fatores do sort
(chips: caixa/PV, urgência, cor, ref, gaps).

9.2. Breakdown auditável do “número” de carga no Planejamento/Kanban/Estouro
(já pedido na remodelagem R — religar ao mesmo grid).

### R10 — Contratos de teste

10.1. Hierarquia D8 (fixture: dois PVs, mesma cor vs fechar PV).

10.2. Porta simples vs complexo (ateliê `sent_to_contractor` vs
`received_at_factory`).

10.3. Frozen zone não remexe após apontamento no 1º setor.

10.4. `recompute_production_schedule` preserva ordem oficial (salvo pin).

10.5. Lookahead e listagem da sequência devolvem a **mesma** ordenação para
o mesmo snapshot.

## Data model / Domain

### Reusar

| Peça | Papel |
|---|---|
| `sale_orders` / `sale_order_items` | Demanda; billing week; delivery |
| `orders` / `production_queue` | OP + fila; pin; due_date |
| `promote_sale_order_item` / materialize | Criação de OP |
| `sector_settings` + `recompute_production_schedule` | Capacidade + agenda |
| `atelier_complex_references` + `cabedal_prep_jobs` | Porta complexo |
| Lookahead resolvers de material principal de corte | Porta R2.1 |
| `resolve_op_due_date` | Urgência D13 |
| `v_production_schedule_grid` / queue detail / overloads | Um número |

### Novo / extensão (orientação — cravar na migração)

| Peça | Notas |
|---|---|
| RPC `list_production_sequence` / `compute_…` | Fonte única R1 |
| Posição/ordem oficial | Coluna(s) em fila ou tabela `production_sequence_positions` — evitar drift Lookahead vs queue |
| `sequence_frozen_at` (ou equivalente) | R5 |
| Motivos estruturados | JSON/chips para UI R9 |
| Override de promote | Flag/auditoria se um dia houver furo admin (default off) |

### Fórmula de fechamento PV (v1 sugerida)

Alinhar ao Lookahead existente para não ter terceiro score:

```
valor_restante ≈ total_PV × (pares_sem_OP / pares_totais)   # ou pares ainda não liberados
urgency_billing = f(due_date / billing_week)               # mais cedo = maior
prioridade_caixa = g(valor_restante, %_já_completo)        # documentar g= igual D7 Lookahead ou evolução
```

Data planejada cedo demais: aplicar penalidade em `urgency_billing` (D12),
não zerar elegibilidade.

## User flows

### Happy path — cabedal simples

1. Gestor abre **Sequência / Liberação**.
2. Vê elegíveis (material ok) ordenados por fechar PV → billing → cor → ref.
3. Seleciona o topo → promove / libera 1º setor.
4. OPs entram no Kanban/Planejamento **nessa ordem**; capacidade do dia corta
   o que não cabe (Estouro se passar).
5. Apontamento no Corte consome a mesma liberação.

### Happy path — cabedal complexo

1. Ref está no catálogo ateliê; job enviado ao prestador.
2. Item aparece **bloqueado** (“aguardando retorno cabedal”).
3. Prestador devolve → `received_at_factory` → item vira elegível e entra no
   recalc da zona aberta.
4. Sequência promove/libera Corte na fábrica.

### Override

1. Gestor pina OP/item (exceção).
2. Pin aparece marcado; resto recalcula em volta.
3. Chão não “escolhe outra cor” fora da ordem sem pin/liberação.

## Edge cases & failure modes

| Caso | Comportamento |
|---|---|
| Catálogo ateliê vazio | Nenhuma ref tratada como complexa; porta = simples (material corte). Cadastro é operação do dono. |
| Dois itens esgotam a mesma napa | Alocação simulada na lista (como R6 Lookahead); segundo fica bloqueado/gap |
| NF entra no meio do dia | Recalc zona aberta; congelados intactos |
| PV novo urgente | Entra no recalc; pode passar elegíveis não congelados se caixa/billing mandarem |
| Ficha sem setor de corte | Fora da disputa do 1º setor; motivo visível |
| Pin vs recalc | Pin vence |
| Divergência utilization vs planned/capacity | Tratar como bug do perímetro D4 — corrigir leitores, não inventar 2º capacidade |

## Design / UX notes

- Hub editorial alinhado às outras telas de Produção (`EditorialPageHeader`,
  tokens — sem cores hardcoded).
- Chips de motivo obrigatórios (padrão Lookahead).
- Gestão ≠ chão: Apontamento continua telas por setor; hub é a porta de
  decisão de sequência.
- Não usar `PageContainer` (briga com `AppLayout`).

## Plan de build (fases)

### Fase 0 — Spec + âncoras (esta entrega)

- [x] `specs/sequencia-producao.md`
- [x] Nota em `fila-corte-lookahead.md`: D17 superseded por esta spec
- [x] Contratos vitest (`productionSequence.test.ts` + extensão Lookahead)

### Fase 1 — Cérebro (SQL + TS) — em andamento

| Área | Arquivos | Status |
|---|---|---|
| Migration | `supabase/migrations/20270101030900_production_sequence_engine.sql` | ✅ aplicada |
| Paridade TS | `src/lib/production/productionSequence.ts` (+ testes) | ✅ |
| Lookahead | `corteLookahead.ts`, `useCorteLookahead.ts` — ordem oficial + porta ateliê | ✅ |
| Queue/schedule | `recompute_production_schedule_impl_249` ORDER BY close_score→due→cor→ref | ✅ |
| Release | `release_corte_lookahead_items` — complexo só `received_at_factory` | ✅ |
| Lista | RPC `list_production_sequence()` | ✅ |
| Frozen / promote hard-gate amplo | apontamento 1º setor | ⏳ Fase 2 |

### Fase 2 — Perímetro um número (D4)

| Área | Arquivos |
|---|---|
| Engine hook | `src/hooks/useProductionEngine.ts` |
| Telas | `ProducaoPlanejamento.tsx`, `ProducaoKanbanGestao.tsx`, `ProducaoEstouro.tsx`, `ProducaoSetoresConfig.tsx` |
| Apontamento | `Setores.tsx` + shells; gate 1º setor |
| Kanban pointing | `pointingPlan.ts` / `applyPointing` — respeitar liberação |

### Fase 3 — Hub UI

| Área | Arquivos |
|---|---|
| Página | `src/pages/ProducaoSequencia.tsx` (novo) |
| Nav | `src/data/navigation.ts`, `src/App.tsx`, `ROUTE_MODULE_MAP` |
| Hub | `ProducaoHub.tsx` — entrada = sequência |
| Lookahead | rebaixar a vista / redirect documentado |

### Fase 4 — Operação + verificação produção

- Popular/manter `atelier_complex_references` para refs realmente complexas.
- Conferir críticos de corte = resolvers Lookahead.
- Após merge em `main` + deploy: agente `computerUse` em
  https://squadshoes-real.vercel.app no fluxo sequenciar → liberar → mesma
  ordem no Kanban/Apontamento (regra do dono).

## Success criteria (DoD)

- [ ] Uma RPC/lista é a ordem oficial; Lookahead não tem score paralelo.
- [ ] Fechar PV vence mesma cor de outro PV no teste de contrato.
- [ ] Complexo `sent_to_contractor` não promove; `received_at_factory` promove.
- [ ] Apontamento no 1º setor congela posição.
- [ ] Pin fura regra sem desligar o motor.
- [ ] Planejamento/Kanban/Estouro usam a mesma ordem + mesma capacidade Setores.
- [ ] Hub Sequência é a entrada de Produção do perímetro D4.
- [ ] Verificado no site live após deploy.

## Open questions (não bloqueiam v1)

1. Nome final da rota (`/producao/sequencia` vs `/producao/liberacao`).
2. Se promote com falta de material crítico é sempre hard-fail ou override
   admin auditado.
3. Penalidade exata da “data planejada cedo” no score (constante vs função).
4. Migração de pins antigos quando a ordem oficial nascer.

## Non-goals / anti-patterns

- Não criar terceiro kanban.
- Não usar BOM inteiro como porta de entrada na v1.
- Não derivar capacidade só de estoque de napa.
- Não reabrir perda de corte.
- Não “completar” OPs Finalizado antigas por coerência de rota.
- Não forçar `PageContainer` / cores hardcoded no hub.
