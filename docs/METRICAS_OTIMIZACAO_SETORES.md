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

**Ambiente da medição:** _preencher_  
**Data:** _preencher_  
**SHA:** _preencher_

## Baseline (Fase 0)

| Rota / ação | Tempo até útil | Payload principal | Round-trips save | Chunk lazy | Notas |
|---|---|---|---|---|---|
| `/estoque` (Materiais) | | | — | | |
| `/estoque` save/ajuste típico | | | | | |
| `/fichas-tecnicas` listagem | | | — | | |
| `/fichas-tecnicas` save patch | | | | | |
| `/sales` listagem | | | — | | |
| `/sales` save PV típico | | | | | |
| `/sales` promover (mediano) | | | | | ver spec PV promoção |

### Inventário de call sites

| Hook / padrão | Nº de call sites | Observação |
|---|---|---|
| `useProducts` | | |
| `usePaginatedProducts` | | |
| `useTechnicalSheets` (`select('*')`) | | |
| `useTechnicalSheetsLite` | | |
| `useSaleOrders` / lista | | |

## Pós-Fase 1 (remedir)

| Rota / ação | Antes | Depois | Delta |
|---|---|---|---|
| | | | |

## Pós-Fase 4 (guarda final)

| Meta R2 | Atingida? | Evidência |
|---|---|---|
| R2.1 Estoque sem catálogo completo na listagem | | |
| R2.2 Hub estoque lazy de Overview/recharts | | |
| R2.3 Ficha list lite | | |
| R2.4 Ficha save sem over-invalidation | | |
| R2.5 PV lista paginada/virtual + um layout | | |
| R2.6 PV promover ≤ 3 s (não regressão) | | |
