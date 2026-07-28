# Análise: Planejamento de Produção × Lead Time de Fornecedor × Débito de Estoque

- **Data:** 28/07/2026
- **Ferramenta:** Codex CLI (`gpt-5.6-terra`, xhigh), análise read-only em worktree isolado.
- **Fonte de verdade:** definições **vivas** das funções/views SQL puxadas via Supabase MCP (não migrations). Achados marcados *Suspeita* foram **verificados no banco vivo** e reclassificados abaixo.

---

## Resposta direta

**O planejamento respeita as datas de lead time de fornecedor?** → **Parcialmente NÃO.**
- O início da OP (`planned_start`) é calculado **só regressivamente pela produção** e **ignora** `material_ready_date`, falta de material e `supplier_lead_time`. Uma OP pode ser planejada pra cortar **antes de o material ter como chegar**.
- A **onda** até calcula uma data "comprar até" ciente do lead time, mas **não impõe** gate de estoque pra liberar o Corte, e a **OC automática que ela cria perde essa data** (sai sem `purchase_by_date`).

**O débito de estoque está correto e no tempo certo?** → **Não totalmente.**
- Reserva na aprovação: OK. Mas **não existe baixa por setor** — a finalização de setor (`apontar_producao_setor`) **não toca estoque** (verificado no banco). O consumo é all-or-nothing em *Reservado→Em Produção* ou no *faturamento*.
- **Embalagem baixa cedo demais** (no aceite comercial, antes do Corte).
- **OS artesanal automática** declara material enviado ao terceiro **sem debitar**.
- **Faturamento pode encerrar a OP mesmo sem baixa física integral** (registra o problema e finaliza assim mesmo).

---

## Linha do tempo real (reconstruída)

1. **PV novo** → `computeMinBillingForNewOrder` chama `compute_material_ready_date` (sugere data mínima de faturamento; não define a data da OP). `src/lib/minBillingDate.ts:120`
2. **PV aprovado** → cria OP `Reservado`; reserva híbrido/solado/tiras em modo *soft* e **embalagem em modo não-soft** (`p_force_soft:false`). `src/hooks/useSaleOrders.ts:1437,1455`
3. **OP** → trigger SQL vivo `compute_order_planned_dates()` grava `planned_start` **regressivo, sequencial, sem material**.
4. **Onda** → preview roda `compute_wave_timeline` ‖ `get_wave_material_needs`; ao criar, persiste timeline + faltas canônicas. `src/services/waveTimelineService.ts:94`
5. **OC da onda** → criada pra faltas **sem gravar PVs vinculados** → trigger `tg_set_po_purchase_by_date` (só INSERT, exige `linked_sale_order_ids`) **não preenche** `purchase_by_date`. `waveTimelineService.ts:230`
6. **Corte/produção** → `start_wave`; em outro caminho, OP `Reservado→Em Produção` chama `consume_all_reservations_for_order` (baixa tudo). `src/pages/Orders.tsx:744`
7. **Finalização de setor** → só `apontar_producao_setor` (**não debita estoque**). `src/hooks/useOrderStages.ts:320`
8. **Faturamento** → converte reservas; se faltar estoque, **anota e finaliza mesmo assim**. `useSaleOrders.ts:1697`

---

## Verificações no banco vivo (o que confirmei/refutei)

| Verificação | Resultado |
|---|---|
| `apontar_producao_setor` debita/consome estoque? | ❌ **NÃO** (`toca_estoque=false`) → **baixa por setor não existe** — CONFIRMADO |
| `consume_all_reservations_for_order` / `convert_reservation_to_out` / `record_order_consumption` existem e tocam estoque? | ✅ Sim (consumo ocorre em produção-start ou faturamento) |
| `compute_order_planned_dates` usa material_ready_date/lead time? | ❌ Não — regressivo puro (CONFIRMADO) |
| `compute_material_ready_date` converte dm²→física? | ❌ Não (soma `quantity_per_unit×qtd` cru) — CONFIRMADO |
| `get_wave_material_needs_core` converte área? | ✅ Sim (diverge da anterior) |
| `tg_set_po_purchase_by_date` roda em UPDATE? | ❌ Só INSERT (prazo fica estático) — CONFIRMADO |
| `purchase_projection_timeline` usa dias corridos? | ✅ **REFUTADO** — usa **dias úteis** (`add_business_days`) e **converte área**. A parte "dias corridos" do achado é falso positivo (migration superada). |

---

## Achados (Crítico → Baixo, com status verificado)

### [CRÍTICO] `planned_start` não respeita disponibilidade de material — *Confirmado*
**Onde:** SQL `compute_order_planned_dates()`; `src/pages/CapacityPlanning.tsx:272`.
**Problema:** `planned_start = entrega − Σ(dias de setor)`, sem `material_ready_date`/falta/`supplier_lead_time`.
**Impacto:** entrega 20/08 → Corte planejado 10/08, mas napa em falta só chega 15/08. Capacidade mostra carga sem MP; PCP vê plano inexequível.
**Correção:** início efetivo do Corte = `MAX(início_por_capacidade, material_ready_date)`; bloquear liberação com shortfall sem OC/ETA compatível.

### [CRÍTICO] OC automática da onda perde `purchase_by_date` e o vínculo do PV — *Confirmado*
**Onde:** `src/services/waveTimelineService.ts:230`; trigger `tg_set_po_purchase_by_date`.
**Problema:** a OC da onda não grava `linked_sale_order_ids`/`source_pv_ids`; o trigger (INSERT-only) precisa deles → `purchase_by_date` fica nulo. `supplier_lead_time_days` da necessidade não é usado.
**Impacto:** a tela mostra "Comprar até", mas a OC real fica **sem prazo**; comprador pode comprar tarde; cancelar PV não acha essa OC (procura por `linked_sale_order_ids`).
**Correção:** gravar os PVs da onda nos vínculos e persistir `purchase_by_date` na criação; ao agregar em OC aberta, unir arrays e reter o **menor** prazo.

### [CRÍTICO] Faturamento encerra a OP sem baixa física integral — *Confirmado*
**Onde:** `src/hooks/useSaleOrders.ts:1697`.
**Problema:** quando `convert_reservation_to_out` acusa insuficiência, o código registra aviso e segue pra `Finalizado`.
**Impacto:** OP faturada e fora da fila com material/solado **não debitado** → saldo físico > consumo real; rastreabilidade quebra.
**Correção:** bloquear, ou criar estado "faturado com backorder" com reserva pendente e reconciliação obrigatória. Não finalizar com consumo físico aberto.

### [ALTO] Baixa por setor **não existe** — consumo é all-or-nothing — *Confirmado (banco vivo)*
**Onde:** `apontar_producao_setor` (não toca estoque); `src/pages/Orders.tsx:744` (`consume_all_reservations_for_order` em Em Produção); faturamento (`convert_reservation_to_out`).
**Problema:** o consumo vira baixa de uma vez ao entrar em produção **ou** no faturamento, nunca por setor que consome. Dois caminhos ativos = risco de duplicidade/lacuna.
**Impacto:** o princípio "consumo no setor que consome" não é cumprido; estoque não reflete o WIP real por etapa.
**Correção:** eleger 1 dono do consumo; idealmente reservar na aprovação e **converter por componente/setor** no apontamento, via RPC única idempotente.

### [ALTO] Duas explosões de material incompatíveis — *Confirmado*
**Onde:** `compute_material_ready_date` (sem conversão dm²) vs `get_wave_material_needs_core` (com conversão); `src/lib/minBillingDate.ts:137`.
**Impacto:** a data mínima do PV acusa falta falsa de material de área (~100×) e empurra a entrega; a onda/compra usa outra conta. Comercial promete por uma lógica, fábrica compra por outra.
**Correção:** `compute_material_ready_date` deve usar o mesmo motor de `get_wave_material_needs_core` (grade, variante, cor, conversão, reserva própria).

### [ALTO] OS artesanal automática declara material enviado sem debitar — *Confirmado*
**Onde:** `src/services/waveTimelineService.ts:306`; `src/lib/serviceOrderStock.ts:59`.
**Problema:** a OS automática da onda grava `materials_sent` mas não chama `debitStockForServiceOrder` (o form manual chama).
**Impacto:** napa base consta "enviada ao terceiro" e continua disponível pra outra OP → estoque superavaliado, compra a menos.
**Correção:** criar OS + reservar/debitar base numa RPC atômica; abortar se sem saldo ou registrar material em trânsito.

### [ALTO] `purchase_by_date` estático após criar a OC — *Confirmado*
**Onde:** trigger `tg_set_po_purchase_by_date` (INSERT-only); `src/components/sale-orders/SaleOrdersOverviewDialog.tsx:153`.
**Problema:** antecipar a entrega do PV não recalcula a data de compra já gravada na OC.
**Correção:** trigger/rotina de UPDATE que recalcula OCs abertas do PV usando sempre o menor `purchase_by_date`.

### [ALTO] Embalagem baixa cedo; política "imediata" opaca — *Confirmado (args/categorias); Suspeita (idempotência)*
**Onde:** `useSaleOrders.ts:1455,1549`; `_is_immediate_debit_category` (classifica quase todo o BOM como imediato).
**Problema:** embalagem sai fisicamente no aceite comercial (`p_force_soft:false`), antes do Corte; há ainda picking que se anuncia incluindo embalagem.
**Correção:** matriz única por categoria×evento (reservar na aprovação, separar no picking, consumir no setor); embalagem com 1 transição física idempotente. *Verificar idempotência das RPCs de débito.*

### [MÉDIO] Wizard de compras cai pra data de entrega quando falta prazo — *Confirmado (fallback)*
**Onde:** `src/components/financial/PurchasePlanningWizard.tsx:351`.
**Problema:** sem linha na view, o Wizard usa `deliveryDate` como "comprar até". *(A suspeita de que a view usa dias corridos foi **refutada**: a view viva usa dias úteis e converte área.)*
**Correção:** não permitir fallback pra entrega; item sem prazo = erro de planejamento a resolver.

### [MÉDIO] UI trata `material_ready_date` como ETA e deixa criar onda sem OC — *Confirmado (UI)*
**Onde:** `src/components/production/WaveBuilder.tsx:69,592`.
**Correção:** rotular como "material requerido até"; mostrar ETA/promessa/recebimento real por OC; exigir override auditado pra onda com falta.

### [MÉDIO] Três calendários divergentes (OP sequencial × onda paralela × projeção) — *Confirmado (OP×onda)*
**Onde:** `compute_order_planned_dates` (sequencial) vs `compute_wave_timeline` (paralelo) vs projeção de compra.
**Impacto:** custeio, capacidade, onda e compra podem apontar semanas diferentes pro mesmo Corte.
**Correção:** 1 motor de calendário persistido por OP, com dependência de materiais, alimentando todas as telas.

---

## Recomendação (ordem de ataque)

1. **Gate de material antes do Corte** (Crítico #1) + **material_ready_date usando o motor canônico** (Alto #4) — sem isso, o plano promete o que a fábrica não tem como cortar.
2. **OC da onda com PV + `purchase_by_date`** (Crítico #2) e **recalcular OC ao mudar prazo** (Alto #7) — pra a compra realmente respeitar o lead time.
3. **Faturamento não finaliza sem baixa** (Crítico #3) e **1 dono do consumo, por setor** (Alto #5) — integridade do estoque.
4. **OS artesanal debita atômico** (Alto #6) e **matriz de débito por categoria/evento** (Alto embalagem).
