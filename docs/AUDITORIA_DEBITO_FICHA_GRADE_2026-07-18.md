# Auditoria — Débito de estoque por ficha técnica × grade do pedido

**Data:** 2026-07-18/19 · **Spec:** [`specs/auditoria-debito-ficha-grade.md`](../specs/auditoria-debito-ficha-grade.md)
**Método:** motores lidos do **banco vivo** (`pg_get_functiondef`, projeto `ssvxfoybzmjlypnipqzn`) + repo TS; 4 auditores independentes (consumo SQL, débito SQL, reserva/ciclo SQL, motores TS) com **verificação adversarial** de cada achado (1 verificador por achado, instruído a REFUTAR); auditoria de dados = recálculo ficha × grade de todas as OPs com débito nos últimos 60 dias comparado com `stock_movements`, tolerância 1% + piso 0,01.

## TL;DR

- **36 achados de código** auditados adversarialmente → **34 confirmados** (1 CRÍTICO, 5 ALTOS, 15 MÉDIOS, 13 BAIXOS) e 2 refutados. **+1 achado de dados** (AUD-1, ALTO).
- **16 bugs corrigidos nesta auditoria** (todos os CRÍTICO/ALTO + os MÉDIO/BAIXO cirúrgicos), cada um com guarda de regressão (`run_debit_guard_tests()` no SQL — 10/10 verde pós-aplicação — e vitest no TS). Migrations aplicadas via MCP em produção com verificação.
- **Relatório vivo criado:** `debit_consistency_report()` — esperado × debitado por OP×produto, exposto em **/diagnostics → aba Consumo** junto com os guards.
- **Dados (coorte de OPs criadas desde 01/05, janela de 60 dias):** 44 OPs com **furo de baixa** (208 linhas de material esperado sem débito), 8 OPs **divergentes** >1% (21 linhas), 9 OPs com **débito extra** (15 linhas, produto diferente do previsto), 43 linhas ok. A lista completa e sempre-atual sai do relatório vivo. **Nenhum saldo foi corrigido** — por decisão da spec, divergência histórica é listada, não ajustada.

## 1. Como o débito funciona hoje (mapa verificado)

```
PV (item add/edit) ──trigger tg_sync_orders_from_sale_order_item──▶ OP criada
   (grade escalada; débitos SOFT: hybrid_debit/debit_sole/debit_strap/packaging
    ⇒ viram material_reservations 'reserved')
OP → produção/finalização ──▶ convert_reservation_to_out (reserva→stock_movements 'out',
    LEAST(estoque, reserva)) + debit_sole_stock_by_grade (por numeração via stock_grade)
Finalização ──▶ trg_record_consumption_on_finalize → record_order_consumption
    (recalcula esperado e grava production_consumptions esperado×real)
    → (agora DEPOIS) release de reservas remanescentes
```

Pontos estruturais confirmados como CORRETOS: `try_reserve_materials` deriva a demanda do motor unificado (`calculate_order_consumption_by_grade`) com grade escalada e variante; a anti-duplicidade do forro (cabedal×palmilha) está viva no SQL e no TS; o débito de solado resolve variante→cascata de cor e **não debita cor errada** (pula); `reserved_stock` sincronizado por trigger — **drift medido: 0** em todos os produtos.

## 2. Bugs de motor CORRIGIDOS (16)

Migrations: `20260915100000_debit-consistency-report.sql` + `20260915110000_audit-debito-ficha-grade-fixes.sql` (aplicadas via MCP em 2026-07-19; guards G1–G10 verdes). TS: commit desta auditoria.

| # | Sev | Onde | Bug → Fix |
|---|-----|------|-----------|
| DEB-1/RES-2 | **CRÍTICO** | `convert_reservation_to_out` (ramo componente) | Debitava `LEAST(estoque, reserva)` mas gravava `quantity_consumed` = reserva CHEIA — ledger superdeclara consumo (OP-2026-01128: PLACA EVA consumed 1965,6 dm² com débito real 76,04; TIRA 1428 m com débito 0). → consumed = debitado real, flag `partial_debit`, linha de shortfall `reserved` reconciliável e aviso na OP (paridade com o ramo de solado). |
| DEB-2 | ALTO | `hybrid_debit_stock_for_order` | Só adiava solado `source='primary_sole'`; solado **pinado na variante** (`variant_sole`) seria debitado 2× (escalar + por grade). → adia `IN ('primary_sole','variant_sole')`. |
| DEB-3/RES-1 | ALTO | `record_order_consumption` | Passava `orders.grade` CRUA ao motor — OP legada com grade BASE (Σ=12, qty 600) tinha esperado computado pra 12 pares (OP-00801: std 70,1 pra 600 pares). → `resolve_effective_op_grade()` (helper novo, fonte única com o relatório). |
| DEB-6 | ALTO | `tg_debit_service_order_base` (OS artesanal) | Movimento gravado com qty CHEIA debitando clampado; idempotência por description colidia com `order_number` NULL (uma OS sem número bloqueava as seguintes). → movimento = débito real (+ sufixo parcial) + marcador `[os:<id>]`. |
| AUD-1 | ALTO | `tg_sync_orders_from_sale_order_item` | Falha dos débitos soft virava `RAISE WARNING` invisível — **OPs nasciam sem NENHUMA reserva** e finalizavam sem débito (OP-2026-01125/26/27, OP-2026-00890/91). → falha marca `material_status='erro_reserva'` + aviso em `orders.notes`. |
| BOM-1 | ALTO | `src/lib/bomConsumption.ts` | Lista de Separação **não emitia Forração Palmilha** (campo buscado e nunca usado) — napa da palmilha fora do picking. → bloco espelhando o motor canônico (área por número do solado, dm²→m pela largura). |
| DEB-4 | MÉDIO | `hybrid_debit_stock_for_order` | Item do PV derivado por `(reference_id, color) LIMIT 1` — dois itens de mesma ref+cor trocavam snapshot/variante. → usa `orders.sale_order_item_id` (fallback mantido). |
| RES-3 | MÉDIO | triggers de `orders` | Aviso "reservas ainda em aberto" do finalize era código morto: `trg_auto_release_...` ('a') rodava ANTES do record e cancelava tudo. → renomeado `trg_zz_release_reservations_on_op_cancel`. |
| BOM-3 | MÉDIO | `bomConsumption.ts` | Sem a supressão anti-duplicidade cabedal×palmilha — a mesma napa saía 2× no picking das sandálias. → mesma condição canônica das 3 flags. |
| TS-1 | MÉDIO | `OrderConsumptionDialog.tsx` | `fichas: 1` hardcoded — OP legada com grade base subcontava per-size/tiras ~50× na visão de consumo por OP. → `fichas: null` (fallback exato quantity÷gradeTotal, escala-invariante; mesmo fix já usado no bomConsumption). |
| RES-7 | BAIXO | `debit_sole_stock_by_grade` | Sem advisory lock nem guarda — retry podia debitar solado 2×. → lock por OP + idempotência por movimento existente. |
| DEB-7 | BAIXO | `debit_sole_stock_by_grade` | Chave conjugada usada sem checar existência no `stock_grade` (fallback da mig 20260426140000 tinha se perdido). → cai na numeração individual quando ela existe. |
| UNIT-1 | BAIXO | 3 arquivos TS | Listas de unidade inline omitiam `'m linear'` no caminho BOM. → `LINEAR_UNITS`/`PLATE_UNITS` exportados de `materialConsumption.ts` (fonte única; +`'m2'` defensivo). |
| TEST-1 | BAIXO | testes | Guard auto-derivado de colunas só cobria `orderConsumption.ts`. → estendido pro select inline do `bomConsumption.ts` + trava dos fixes BOM-1/BOM-3/TS-1. |
| COLOR-1 | BAIXO | `orderConsumption.ts` | `liningColorMap`/`palmilhaColorMap` com `toLowerCase` puro — "Café"≠"CAFE" escapava do mapeamento. → `normalizeColorKey` (case+acento) na construção e nos 8 lookups. |

**Guardas de regressão:** SQL → `run_debit_guard_tests()` (G1–G10; painel em /diagnostics; wrapper `src/services/__tests__/debitGuards.integration.test.ts` com `RUN_DB_INTEGRATION=1`). TS → `src/lib/__tests__/orderConsumption.test.ts` (46 testes, incluindo os guards novos).

## 3. Achados CONFIRMADOS restantes — **APLICADOS em 2026-07-19** (17)

Nenhum era débito de valor errado acontecendo; eram avisos faltando, divergências latentes ou telas secundárias. **Todos os 17 foram aplicados**: SQL via migration `20260916120000_audit-debito-pendencias-secao3.sql` (construída a partir do `pg_get_functiondef` VIVO e aplicada em produção via Management API, com verificação embutida), TS no commit desta aplicação. Guards novos **G11–G22** em `run_debit_guard_tests()` (22/22 verdes) + casos 3b/3c/2c em `run_consumption_integration_tests()` (13/13 verdes) + testes vitest em `bomConsumption.test.ts` (19) — suíte completa 1117 verdes.

| # | Sev | Onde | Bug → Fix aplicado |
|---|-----|------|--------------------|
| CONS-1 | MÉDIO | `calculate_order_consumption_by_grade` | Contrato `source='fallback_average'`+`consumption_warning` (mig 20260518120000) tinha sumido da versão viva. → Reintroduzido por componente (Cabedal/Forração/Palmilha/Forração Palmilha), com lista dos tamanhos em fallback no warning; override de variante e forro alternativo/suprimido NÃO contam como fallback. Guard G11 + CASO 3b/3c/2c. |
| CONS-4 | MÉDIO | `check_stock_availability` | Badge do PV resolvia materiais com variante NULL. → Novo parâmetro `p_material_variant_id` (sobrecarga 6-arg dropada — sem ambiguidade no PostgREST), threading no by_grade + resolvers + BOM efetivo; callers TS (`useCheckStockAvailability`, `SaleOrderForm`, aprovação em `useSaleOrders`) passam a variante do item. Guard G12. |
| DEB-5 | MÉDIO | `debit_packaging_for_order` → `record_order_consumption` | Débito de embalagem grava `stock_movements.product_id = box_types.id` (sem FK); a finalização abortava na FK de `production_consumptions`. → `record_order_consumption` filtra movimentos cujo product_id não existe em `products` (o ledger de caixas continua onde está — idempotência e estorno dependem dele). Guard G13. |
| RES-5 | MÉDIO | `list_orphan_reservations` | Não via `partially_consumed` nem `reserved` com consumo parcial. → Órfã = reserva ativa com resíduo > 0 em OP terminal (matriz de status unificada com RES-6). Guard G14. |
| RES-9 | MÉDIO | `restore_product_stocks_for_order` | Pulava produto com `stock_grade` não-vazio em silêncio. → Estorna o RESÍDUO escalar (net de movimentos − o que o `restore_sole_grade_for_order` ainda vai devolver, via reservas `sole_grade` sem `sole_restored_at`), sem tocar a numeração; idempotente e seguro em qualquer ordem de chamada. Guard G15. |
| BOM-2 | MÉDIO | `bomConsumption.ts` | Solado só por pin da variante + mapping explícito. → Cascata canônica P0–P3 extraída pra `resolveSoleProductIdCanonical` (exportada de `orderConsumption.ts`, fonte única) e usada na Lista de Separação. |
| BOM-4 | MÉDIO | `bomConsumption.ts` | Placa ignorava `insole_consumption_dm2` do solado. → Per-size do solado prevalece (escalar como fallback), espelho do `computeInsoleDm2` canônico; override legado de variante suprime o per-size. |
| BOM-5 | MÉDIO | `bomConsumption.ts` | Sem componente Fachete. → Bloco espelhando o canônico: grupo por `products.fachete_material_group_id` (fallback `lining_material`), dm²→m pela largura; sem specs → linha de AVISO qtd 0. |
| BOM-6 | MÉDIO | `bomConsumption.ts` | Ignorava `direct_components`/componentes por cor. → Mesmo gate do SQL/motor canônico (lista POR COR substitui `direct_components`); BOM pula produto já emitido (sem duplicar). |
| SQL-1/CONS-2 | BAIXO | `calculate_order_consumption_by_grade` | Loop de `sheet_materials` sem escopo de variante. → `get_effective_bom(p_reference_id, p_material_variant_id)` no by_grade E no `check_stock_availability` (loop + pré-varredura de caixas). Guard G16. |
| CONS-5 | BAIXO | resolvers | Sobrecargas 4-arg mortas/divergentes (sem o pin da ficha). → DROP das 3 (varrido: nenhum caller em SQL/views/TS). Guard G17. |
| CONS-6 | BAIXO | Fachete SQL×TS | SQL usava só `lining_material`. → Prioriza `products.fachete_material_group_id` do solado (paridade TS). Guard G18. |
| CONS-7 | BAIXO | forro cabedal | SQL gateava o forro do CABEDAL em `insole_has_lining=true` (campo que descreve a PALMILHA); TS nunca teve o gate. → Gate removido no by_grade e no `check_stock_availability`; permanece SÓ na parcela de Forração Palmilha (igual TS). Guard G19. |
| CONS-8 | BAIXO | guard implausível | `sole_technical_specs` sem teto. → Trigger `tg_guard_implausible_sole_spec` (teto 50 dm²/par nas 4 colunas; máximo vivo hoje: 6,85). Guard G20. |
| RES-6 | BAIXO | triggers release | Matrizes divergentes. → Matriz ÚNICA nas duas triggers: terminal = {Finalizado, FINALIZADO, Faturado, Cancelado, Cancelada, Concluído, Concluido}; libera `reserved` + `partially_consumed` com sync de `reserved_stock`. Guard G21. |
| RES-8 | BAIXO | `confirm_picking_reservation` | Sem `is_approved_user()` e aceitava reserva de solado por grade. → Gate de usuário aprovado + rejeição de kind `sole_grade`/`sole_pending_grade` (picking escalar não baixa `stock_grade`). Guard G22. |
| BOM-7 | BAIXO | `bomConsumption.ts` | Linha Solado ignorava `sole_consumption>1` e sumia sem `sole_material` textual. → Grupo do produto-solado RESOLVIDO (qualquer fonte da cascata); consumo = override da variante > `sole_consumption` > default canônico 1 par/par. |

**Bônus da aplicação:** `run_consumption_integration_tests()` estava 100% abortando em produção (fixture sem `product_groups.sector`, NOT NULL desde a mig 20260901140000) e carregava expectativas fósseis de waste padrão 8% (o default vivo é 0, paridade com o TS) — fixture e expectativas corrigidos; suíte 13/13 verde.

**Refutados (2):** CONS-3 (o "caso vivo" tinha pin de produto que resolve) e RES-4 (`process_outdated_reservations` limpar o flag por VISITA é decisão de design documentada).

## 4. Auditoria de DADOS — divergências históricas (para decisão, SEM ajuste de saldo)

Fonte reproduzível: `debit_consistency_report()` (a qualquer momento, em /diagnostics ou SQL). Números do dia da auditoria, coorte de OPs criadas desde 2026-05-01:

| Classe | Linhas | OPs | Significado |
|--------|-------:|----:|-------------|
| furo | 208 | 44 | material esperado pela ficha × grade **sem débito nenhum** |
| divergente (>1%) | 21 | 8 | debitado ≠ esperado além da tolerância |
| extra | 15 | 9 | débito de produto **sem previsão** na ficha (mismatch de resolução) |
| ok | 43 | 22 | dentro da tolerância |

Casos estruturais por trás desses números:

1. **21 OPs de maio finalizadas em massa em 02/07 sem débito algum** (OP-00801…OP-2026-00882; ~7.400 pares): reservas todas `cancelled` com consumo 0, zero movimentos. Produção aconteceu → **estoque fantasma** (sistema mostra mais do que existe) — parcialmente mascarado pelos ajustes manuais de estoque feitos no período. Essas OPs também carregavam **grade BASE** (Σ=12) — legado pré-02/06; a geração PV→OP atual está correta (0 violações em OPs novas).
2. **5 OPs sem reserva desde a criação** (01125/26/27 de 30/06 + 00890/91 de 01/06): causa-raiz AUD-1 (falha engolida pelo trigger). O erro subjacente era transitório — `try_reserve`/`hybrid_debit` reproduzidos HOJE para os mesmos inputs funcionam 100% (`fully_reserved`) — compatível com o drift de ficha corrigido em `f060a5e`. Com AUD-1 corrigido, reincidência fica visível (`erro_reserva`).
3. **Débito segue a reserva CONGELADA da criação, não a ficha atual** (ex.: OP-2026-01128 NAPA SOFT reservada 31,45 m com o forro ainda duplicado, debitada 25 m; esperado atual 20,12 m → +24%). É o gap conhecido de invalidação de snapshot das tabelas `*_colors` (SPEC pendente, memória `percolor_tables_no_snapshot_invalidation`) — **não resolvido nesta auditoria** (mudança estrutural); o relatório vivo expõe cada ocorrência.
4. **Mismatch de resolução reserva×consumo** (as 15 linhas "extra" pareadas com furos): a reserva escolheu `PLACA 1.0 EVA 3.0` (dm²) onde o consumo atual espera `EVA 3MM` (m); `NAPA SOFT - COGUMELO` vs `NAPA SOFT`; `GLOW METALIC: PRATA`. Mesma família do item 3 (reserva de época ≠ ficha atual).
5. **Tiras com estoque ~zero**: débitos de 1–50 m onde o esperado é 800–1400 m/OP — o estoque de tiras não é mantido (produção artesanal interna). Furo de baixa contínuo e conhecido; com DEB-1 corrigido, o shortfall agora fica registrado (reserva parcial + aviso na OP) em vez de sumir.
6. **4 débitos de solado sem `order_id`** (jun/2026, versão antiga da função — 420+563+156+40 pares do solado "01"): não atribuíveis por OP; a função viva já grava `order_id`. Aparecem como furo de solado nas OPs correspondentes com obs explicativa no relatório.

**Ciclo de vida (R5) — checado, SEM achados:** drift de `reserved_stock` = 0 produto; reservas ativas presas em OP terminal = 0; OPs canceladas com débito não estornado = 0; os 8 "movimentos duplos" de napa são 2 componentes legítimos da mesma napa (cabedal+forração), não débito duplo.

## 5. O que mudou pra você (operacional)

- **/diagnostics → Consumo**: dois painéis novos — *Débito × Ficha técnica* (esperado×debitado, badges por classe, maiores divergências) e *Guards da auditoria de débito* (G1–G10). Rodar com o botão "Executar".
- **OP com problema de reserva agora GRITA**: `material_status='erro_reserva'` + nota na OP; baixa parcial/sem estoque na conversão vira nota na OP + reserva de shortfall reconciliável.
- **Decisão pendente sua**: o que fazer com o estoque fantasma das 21 OPs de maio (a contagem física + ajuste manual é o caminho — o relatório dá a lista por material); e se prioriza o SPEC de invalidação de snapshot por cor (item 4.3). ~~Os 17 pendentes da seção 3~~ → **aplicados em 2026-07-19** (mig `20260916120000`, guards G11–G22).
