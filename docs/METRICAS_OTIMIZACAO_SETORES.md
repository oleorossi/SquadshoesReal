# Métricas — otimização dos setores principais

> Preenchido na **Fase 0** do programa
> [`specs/otimizacao-setores-principais.md`](../specs/otimizacao-setores-principais.md).
> Não inventar números: só medições reais (preview ou produção).

## Como medir

| Métrica | Método |
|---|---|
| Tempo até lista útil | Chrome DevTools → Performance / Network; cold load da rota |
| Payload JSON | Aba Network → resposta Supabase da query principal (tamanho) |
| Round-trips no save | Contar `from`/`rpc` no caminho feliz (código + Network) |
| Chunk da rota | `bun run build` → tamanho do chunk lazy da página |
| Query keys | `rg "queryKey:.*products" src` (e equivalentes) |

**Ambiente da medição:** análise estática no repo (Fase 0) + remedir Network em preview após deploy  
**Data:** 2026-09-07  
**SHA:** branch `cursor/otimizacao-setores-principais-1c60`

## Baseline (Fase 0) — inventário de código

| Rota / ação | Tempo até útil | Payload principal | Round-trips save | Chunk lazy | Notas |
|---|---|---|---|---|---|
| `/estoque` (Materiais) | _remedir em preview_ | paginado `v_products_list` + (antes) `useProducts` em paralelo | — | hub puxava Overview/recharts eager | double-fetch medido no código |
| `/estoque` save/ajuste | _remedir_ | — | RPC `adjustStockSafe` | — | |
| `/fichas-tecnicas` listagem | _remedir_ | antes: `select('*')` ~227 kB / 53 fichas (audit PV) | — | monólito ~7k linhas | lite PV já existia (~6 kB úteis) |
| `/fichas-tecnicas` save patch | _remedir_ | patch diferencial | 1 UPDATE + propagação | — | mig `20270101014200` |
| `/sales` listagem | _remedir_ | `SALE_ORDER_LIST_SELECT` + limit 1000 | — | cards+tabela sempre montados | |
| `/sales` save PV típico | _remedir_ | RPC atômica | ver spec promoção | — | |
| `/sales` promover (mediano) | ≤ 3 s (contrato) | motor server-side | 1 RPC | — | `pv-producao-performance-e-pendencias.md` |

### Inventário de call sites (produção, excl. testes)

| Hook / padrão | Nº de call sites | Observação |
|---|---|---|
| `useProducts` | 39 arquivos | universo completo; MaterialsTab agora adia até página útil |
| `usePaginatedProducts` | 2 | lista Materiais |
| `useTechnicalSheets` (`select('*')`) | 19 arquivos | mantido p/ consumidores legados; hub usa catalog |
| `useTechnicalSheetsLite` | 2 | lista PV |
| `useTechnicalSheetsCatalog` | novo | hub `/fichas-tecnicas` |
| `useTechnicalSheetDetail` | novo | editor ao abrir ficha |
| `useSaleOrders` | 15 arquivos | lista slim já existia |

## Pós-Fase 1 (código)

| Item | Mudança |
|---|---|
| 1.1 Ficha | `useTechnicalSheetsCatalog` + `useTechnicalSheetDetail`; lista sem `*` |
| 1.2 Estoque | lazy Overview/Alertas/Conversões/Histórico/Org/Auditoria (+ recharts via ReportTab) |
| 1.3 MaterialsTab | `useProducts({ enabled: pageFetched })`; barcode por SKU direto |
| 1.4 PV | `useIsMobile` → um layout; `paginateInMemory` + `ListPagination` |

Remedir Network/chunks em preview e colar abaixo.

| Rota / ação | Antes | Depois | Delta |
|---|---|---|---|
| `/fichas-tecnicas` payload lista | ~227 kB (`*`) | catalog columns | _medir_ |
| `/estoque` first paint | paginado + products paralelo | só paginado primeiro | _medir_ |
| `/sales` DOM nodes lista | cards + tabela | um dos dois | _medir_ |

## Pós-Fase 2 (modularização)

| Item | Mudança |
|---|---|
| 2.1 Ficha | Extraídos `SheetBOM`, `CostsAnalysisTab`, `PhotosByColorTab`, `ProductionSectorsTab`, `SheetImageUpload`, `sheetFormFields`, `componentCategories`, `technicalSheetSizes` — página ~5,3k linhas (era ~7k) |
| 2.2 PV | Extraídos `saleOrderListConstants`, `SaleOrderSortHead`, `SaleOrderMobileCard`, `useMinBillingMap` |
| 2.3 Keys | `src/lib/queryKeys.ts` + wire em `useProducts` / `useTechnicalSheets` / `useSaleOrders` |

## Pós-Fase 3 (UX)

| Item | Mudança |
|---|---|
| 3.1 | Ficha catálogo/detail, Materiais e PV distinguem `isError` de empty |
| 3.2 | `ProductFormDialog` confirma ao fechar com edição suja |
| 3.3 | `DeferredMount` + lazy `SheetBOM`/`CostsTab` na Engenharia |
| 3.4 | Deep-links `?view=consumo|pendencias`, `?ref=`, `useUrlTabState` preservados (contrato) |
| 3.5 | Ajuste de estoque usa `toastError` no catch genérico |

## Pós-Fase 4 (guarda final)

### Delta de código (medido no repo — Network em preview continua sob demanda)

| Métrica | Baseline (Fase 0) | Depois (Fases 1–3) | Delta |
|---|---|---|---|
| `/fichas-tecnicas` select lista | `*` (~dezenas de cols / ~227 kB audit) | `TECHNICAL_SHEET_CATALOG_COLUMNS` (25 cols) | payload lista enxuto; `*` só no detail |
| Ficha lite (PV) ⊆ catalog | n/d | 5 cols lite ⊂ 25 catalog | contrato Fase 4 |
| `TechnicalSheets.tsx` linhas | ~7k monólito | ~5,3k + módulos extraídos | split Fase 2 |
| Hub `/estoque` first paint | Overview/recharts eager | lazy fora de Materiais | chunk Overview adiado |
| Materiais double-fetch | paginado + `useProducts` paralelo | `useProducts` só após página útil | menos round-trip inicial |
| `/sales` DOM | cards + tabela juntos | um layout (`useIsMobile`) + pager | menos nós |
| Query keys canônicas | strings soltas | `src/lib/queryKeys.ts` + invalidate helpers | invalidação por prefixo |
| Hub listagens erro vs vazio | Ficha/Materiais fingiam empty | `isError` + retry nos 3 | Fase 3.1 |

| Meta R2 | Atingida? | Evidência |
|---|---|---|
| R2.1 Estoque sem catálogo completo na listagem | parcial | listagem = paginado; universo adiado pós-página |
| R2.2 Hub estoque lazy de Overview/recharts | sim (código) | `Index.tsx` lazy + Suspense |
| R2.3 Ficha list lite | sim (código) | `TECHNICAL_SHEET_CATALOG_COLUMNS` |
| R2.4 Ficha save sem over-invalidation | parcial | patch cache catalog/detail/lite/editor; propagação intacta |
| R2.5 PV lista paginada/virtual + um layout | sim (código) | `paginateInMemory` + `useIsMobile` |
| R2.6 PV promover ≤ 3 s (não regressão) | n/d nesta entrega | contrato pré-existente |

**Remedir Network/TTFB em preview** (quando houver): colar números reais na tabela “Pós-Fase 1” acima — o inventário de código já fecha o DoD da Fase 4 para o que é verificável em CI.
