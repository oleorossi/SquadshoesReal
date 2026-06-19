# Auditoria — Unidade de Estoque × Consumo × Conversões (2026-06-19)

> Auditoria completa do subsistema de unidades e conversões, cruzando código
> (TS + SQL) com o **banco de produção** `ssvxfoybzmjlypnipqzn`. 7 frentes de
> auditoria + síntese. Todas as contagens abaixo foram verificadas via SQL real.

## TL;DR

O subsistema está **majoritariamente saudável** (0 unidade fora do canônico, 0
`conversion_rate` nulo/zero, solado sempre em `par`, `list_materials_missing_width()`
vazio). Mas há uma constatação **estrutural** e um bug **crítico ativo**:

1. **Não existe fonte única de verdade.** ~8 motores calculam consumo/conversão,
   lendo campos diferentes e convertendo de formas levemente diferentes → divergem.
2. **🔴 CRÍTICO ATIVO:** itens-padrão de solado (COLA) não convertem massa no
   `calculate_order_consumption_by_grade` → reserva de COLA PVC **1000× inflada**
   (103.865 kg reservados vs **118,99 kg** reais). A próxima conversão de picking
   **zera o estoque físico de cola silenciosamente**.

## Blast radius (banco de produção, verificado)

| Métrica | Valor |
|---|---|
| products total | 154 |
| unit fora do canônico | 0 ✅ |
| conversion_rate NULL/0/negativo | 0 ✅ |
| solados com unit ≠ par | 0 ✅ |
| `list_materials_missing_width()` | 0 ✅ |
| **Invariante violado: purchase_order_unit='un' ≠ unit AND rate=1** | **47** (m:31, par:12, kg:3, L:1) |
| `audit_unit_divergences()` checa esse invariante? | ❌ NÃO (cego) |
| **reserved_stock > quantity (drift)** | **33 produtos** |
| **COLA PVC reserved vs estoque** | **103.865,16 kg vs 118,99 kg** |
| **component_sheets com largura/comprimento trocados (1000×1370)** | **25** |
| **NAPAs com preço placeholder R$ 0,8668/m (~15× abaixo)** | **25** |
| fichas com forro per-size 0,5 vs escalar 5,7 (~11× sub) | ~8 (a confirmar) |
| solados fachetados sem fachete_lining_consumption_dm2 | 2 (180 SALTO BLOCO) |
| `calculate_order_consumption_by_grade` chama `convert_to_product_unit` no bloco std? | ❌ NÃO |
| `get_wave_material_needs` lê upper/lining/insole_material? | ❌ NÃO |

## Causa-raiz estrutural: 8 motores, nenhuma fonte única

| Motor | lê forro/palmilha (ficha) | lê BOM | lê solado | converte dm²→física | converte massa g↔kg | usado por |
|---|---|---|---|---|---|---|
| `orderConsumption.ts` (TS) | ✅ | ✅ | ✅ | ✅ (placa→nº placas) | n/a | modal Consumo + ficha operador |
| `bomConsumption.ts` (TS) | ✅ | ✅ | parcial | ✅ | n/a | Lista de Separação |
| `weeklyPurchasingPlan.ts` (TS) | ❌ | ✅ | ❌ | ✅ | n/a | plano semanal |
| `PurchasePlanningWizard` (TS) | ✅ | ❌ | ✅ | ✅ | n/a | Wizard cria OC |
| **`calculate_order_consumption`** (SQL escalar) | ✅ | ✅ | ✅ | ✅ | sem bloco std-items | **custeio + wrap MRP/per-PV** |
| `calculate_order_consumption_by_grade` (SQL) | ✅ | ✅ | ✅ | ✅ | **❌ BUG (std-items)** | custeio by-grade + **reserva/débito** |
| `get_wave_material_needs` (SQL) | **❌** | ✅ | ✅ | ✅ (só BOM) | n/a | **ondas → auto-OC** |
| `fn_projected_demand` / `compute_materials_per_pv` (SQL) | ✅ (wrappers) | ✅ | ✅ | ✅ | herda do escalar | MRP / Compras por Pedido |

## Achados (por severidade)

### 🔴 HIGH

1. **COLA (std-items de solado) não converte massa → reserva 1000× inflada (ATIVO).**
   `calculate_order_consumption_by_grade` tem o bloco `sole_standard_items` mas não
   chama `convert_to_product_unit`: 23,33 **g**/par tratado como 23,33 **kg**/par.
   COLA PVC: 103.865 kg reservados vs 118,99 kg reais. `reserved_stock` é lido por
   todo o frontend → cola aparece esgotada em 9 OPs. `convert_reservation_to_out`
   debita o reservado cru com `LEAST(reserved, estoque)` → **zera os 118,99 kg
   físicos** sem deixar `quantity` negativo (corrupção silenciosa). Afeta COLA
   PVC/FORTE/HOTMELT (27 reservas, 9 OPs).

2. **`get_wave_material_needs` (ondas → auto-OC) é cego à ficha.** Lê BOM mas não lê
   `upper/lining/insole_material`. Ao gerar OC pela onda, a fábrica **não compra
   napa/forro/palmilha/diretos** (materiais dominantes) → ruptura silenciosa de
   compra. (O canal "Compras por Pedido" e o MRP já foram migrados pro motor
   canônico; falta a onda.)

3. **25 fichas com largura/comprimento TROCADOS (1000×1370).** O SQL
   (`get_material_conversion_info`) usa só `dimensions_width=1000` → divisor 100; o
   TS usa `max=1370` → divisor 137. Como a largura real do rolo é 1370, o **SQL
   superestima ~37%** custo/MRP/ondas. Afeta NAPA ONÇA (19) + GLOW (8).

4. **25 NAPAs com preço placeholder R$ 0,8668/m (~15× abaixo).** Ex.: NAPA SUDANI
   CAPUCCINO 0,8668 vs OFF WHITE 13,34 (mesmo grupo/largura). Custo de cabedal
   subestimado → margem inflada.

### 🟠 MEDIUM
5. ~8 fichas com forro `per-size`=0,5 vs escalar 5,7 (~11× sub-consumo; per-size é fonte primária).
6. 47 produtos violam o invariante purchase_unit×unit×rate (default `'un'`) **e** `audit_unit_divergences` é cego a isso.
7. EVA sai em **dm²** no caminho SQL (OC) e em **placa** no modal → risco de comprar "5166 placas".
8. 2 solados fachetados sem `fachete_lining_consumption_dm2` (forro extra não custeado).
9. `convert_reservation_to_out` debita reservado cru com cap → mascara e propaga erro de unidade.

### 🟡 LOW
10. 33 produtos com `reserved_stock > quantity` (núcleo é a cola do #1).
11. Funções de débito legadas sem conversão (`debit_stock_for_order` text, `process_order_stock_out`) — órfãs mas religáveis.
12. `chapa→placa` diverge entre `toCanonical` (TS) e `normalize_product_unit` (SQL).
13. `waste%` default TS=0 vs SQL=8 (só no fallback sem ficha).
14. Falso-positivo do auditor em CF 03 (elástico linear flagado como área; ficha órfã).

## Arquitetura-alvo ("a melhor forma de resolver")

1. **Fonte única de verdade.** UM engine SQL canônico (`calculate_order_consumption[_by_grade]`)
   decide "quanto de cada material, em qual unidade física". Todo consumidor (custeio,
   MRP, ondas, per-PV, **débito, reserva**) vira wrapper fino. Faltam dois: rebasear
   `get_wave_material_needs` no canônico, e o débito/reserva by-grade usar a mesma
   conversão do custeio.
2. **Uma regra de conversão.** dm²→física SEMPRE na largura/área da `component_sheet`
   (nunca em `conversion_rate`); massa/volume via `convert_to_product_unit` em TODOS os
   caminhos (custeio E débito).
3. **Travar dado inválido na ESCRITA** (preventivo, não reativo): CHECK `conversion_rate>0`;
   `purchase_order_unit` default = `unit`; trigger exigindo `dimensions_width>0` p/ material
   de área em ficha/BOM; rejeitar std-item com unidade kind-incompatível.
4. **Diagnóstico que cobre os próprios invariantes.** Estender `audit_unit_divergences`
   (invariante de compra, ficha trocada, preço placeholder) e surfar em `/diagnostics`.
5. **Paridade travada por teste.** Estender `run_consumption_parity_tests()` + wrappers
   vitest p/ cobrir std-items (g→kg), largura linear e paridade cross-engine. Como as
   funções SQL são alteradas via MCP (fora dos arquivos de migration), o teste de
   paridade é o cinto de segurança contra regressão silenciosa.

## Plano priorizado

### P0 — agora (bug ativo + dados que corrompem hoje)
- **P0.1** Corrigir `calculate_order_consumption_by_grade`: aplicar `convert_to_product_unit(cons*pairs, ssic.unit, products.unit)` no bloco std-items; bloquear se NULL. ⚠ datar a migration **depois** da última que redefine a função.
- **P0.2** Repair: `sync_product_reserved_stock` em massa + auditar as 27 reservas de cola (COLA PVC deve cair de 103.865 kg → ~0,03 kg/par × pares).
- **P0.3** Corrigir os 25 `component_sheets` 1000×1370 (trocar width↔length).
- **P0.4** Rebasear `get_wave_material_needs` em `calculate_order_consumption` (preservando campos artesanais).

### P1 — curto prazo (acurácia + prevenção)
- **P1.1** Corrigir os 25 preços de NAPA (0,8668 → R$/m real) + check "napa/couro < R$3/m".
- **P1.2** Corrigir as ~8 fichas de forro per-size=0,5.
- **P1.3** Estender `audit_unit_divergences` (invariante compra, ficha trocada, preço placeholder).
- **P1.4** Backfill `purchase_order_unit=unit` nos 47 produtos com rate=1; herdar `unit` no cadastro.
- **P1.5** OC expor `needed_qty` na unidade de compra (EVA dm²→placa).
- **P1.6** Estender `run_consumption_parity_tests()` (std-items g→kg; largura; cross-engine).

### P2 — endurecimento
- **P2.1** Cadastrar fachete do 180 SALTO BLOCO (ou desmarcar is_fachetado).
- **P2.2** Defesa em profundidade no `convert_reservation_to_out`.
- **P2.3** DROP das funções de débito legadas; alinhar `chapa→placa`.
- **P2.4** CHECK/trigger no banco (conversion_rate>0; purchase_order_unit default=unit; width obrigatória).

## Notas de confiança
- "~8 fichas de forro per-size=0,5": reportado por uma frente, **a confirmar** a contagem exata por ficha (o `audit_unit_divergences` live agregou 69 chaves, todas da ficha órfã CF 03).
- Todo o resto tem evidência SQL direta (def viva das funções + contagens reais).
