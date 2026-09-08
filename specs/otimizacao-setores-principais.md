# Otimização dos setores principais — Estoque, Ficha Técnica, Pedido de Venda

## Goal

Estruturar e executar um **programa único** que deixa os três eixos do dia a dia
da fábrica — **Estoque**, **Cadastro de Ficha Técnica** e **Pedido de Venda** —
mais rápidos, mais fáceis de manter e menos propensos a erro operacional.

Serve o dono/PCP (fluxo comercial → engenharia → estoque), o operador de
cadastro (ficha e materiais) e quem abre/edita PV. “Pronto” = cada fase abaixo
tem critérios mensuráveis de performance, arquitetura e UX, verificáveis por
outra pessoa sem reabrir a discussão de escopo.

## Background / Problem

Os três setores já têm auditorias e specs pontuais, mas o trabalho está
**espalhado**: performance num lugar, monólitos noutro, UX numa terceira lista.
Sem um programa-mestre, cada sessão reabre prioridades e otimiza o sintoma
errado (ex.: micro-refactor visual enquanto a lista ainda baixa o catálogo
inteiro).

### Estado medido (fontes vivas)

| Setor | Dor principal | Evidência |
|---|---|---|
| **Estoque** | `useProducts` ainda carrega o catálogo inteiro (~39 call sites); hub `/estoque` puxa abas + recharts no chunk; MaterialsTab duplo-carrega paginado + universo | `docs/AUDITORIA_UI_UX_2026-08-18.md`; `useProducts.ts` / `usePaginatedProducts.ts` |
| **Ficha técnica** | `TechnicalSheets.tsx` ~7k linhas / 18 componentes no arquivo; `useTechnicalSheets` faz `select('*')` (~227 kB / 53 fichas) enquanto o PV já tem lite (~6 kB); save já tem patch diferencial, mas pós-save invalida e resynca em cascata | `docs/AUDITORIA_FICHAS_TECNICAS_2026-08-16.md`; mig `20270101014200` |
| **Pedido de venda** | Lista monólito (`SaleOrders.tsx` ~3k+, 34 `useState`, cards+tabela sempre montados, sem paginação); promoção client-side já foi o gargalo 20–35s (spec de promoção); save ainda tinha laços seriais pós-RPC | `specs/pv-producao-performance-e-pendencias.md`; `docs/AUDITORIA_PEDIDOS_VENDA_2026-08-16.md` |
| **Transversal** | Cache React Query fragmentado (44 keys de products, 38 de sale_orders); ~50% do chunk de entrada = ícones Phosphor de `navigation.ts`; código morto em massa | `docs/AUDITORIA_UI_UX_2026-08-18.md` Top 10 |

### Trabalho já feito (não refazer)

- Estoque: `PRODUCT_LIST_SELECT`, `usePaginatedProducts` + `v_products_list`, `get_inventory_summary`, `adjustStockSafe`.
- Ficha: patch diferencial cliente (`technicalSheetPatch.ts`), mig de triggers no save, `useTechnicalSheetsLite` no PV, readiness rail.
- PV: RPC `create_sale_order_atomic`, motor de promoção server-side + aba Pendências (spec dedicada), lista slim, prefetch de consumo no hover.
- UI global: Fase 1 da auditoria 18/08 (delete confirm, isError no DataListPage, dirty dialogs parcial).

## Scope

### In scope

1. **Performance** — payload, round-trips, bundle das rotas dos 3 setores, invalidação de cache.
2. **Arquitetura** — extrair monólitos por aba/painel; consolidar query keys; matar caminhos mortos que tocam esses setores.
3. **UX / fluxo** — menos cliques e estados enganosos nos fluxos críticos (listar → abrir → editar → salvar → promover / ajustar estoque).
4. **Programa completo** — este documento como fonte de prioridade, fases, métricas e DoD; specs filhas só quando uma fase precisar de detalhe novo.

### Out of scope (explicitamente não agora)

- Redesign visual / troca de design system (Industrial Editorial Pro permanece).
- Novos módulos de negócio (financeiro, RH, terceirização, ondas) — só entram se forem dependência direta de um gargalo destes 3.
- Reabrir regras canônicas fechadas pelo dono (perda de corte, volumes NF × `box_grouping`, estorno histórico de OPs finalizadas, DEFAULT `waste_factor = 0`).
- Inventar dm² de solado / cadastro de engenharia — dado do dono.
- “Otimizar tudo o que é lento no ERP” fora destes 3 hubs.

## Requirements

### R1 — Baseline mensurável antes de cada fase

Antes de mudar código de uma fase, registrar no próprio PR (ou em
`docs/METRICAS_OTIMIZACAO_SETORES.md` se a fase for multi-PR):

| Métrica | Como medir |
|---|---|
| TTFB / tempo até lista útil | DevTools Network + Performance na rota alvo (produção ou preview) |
| Payload JSON da query principal | tamanho da resposta Supabase (ex.: fichas `select('*')` vs lite) |
| Nº de round-trips no save | contagem de `supabase.from` / `rpc` no caminho feliz |
| Tamanho do chunk da rota | `bun run build` + análise do chunk lazy da página |
| Query keys por entidade | grep de `queryKey` para `products` / `technical-sheets` / `sale-orders` |

### R2 — Performance por setor (metas)

1. **Estoque `/estoque` (aba Materiais):** abertura não dispara download do catálogo
   completo via `useProducts` só para listar; lista usa caminho paginado
   (`usePaginatedProducts` / `v_products_list`). Call sites que ainda precisam do
   universo (dialogs, filtros) usam variante **lite** explícita, não o select
   gordo por acidente.
2. **Hub `/estoque`:** abas e gráficos (recharts / Visão geral) entram por
   `React.lazy` / `import()` — abrir Materiais não paga o chunk de Overview.
3. **Ficha `/fichas-tecnicas`:** listagem usa select **lite** (id, referência,
   status, cor, solado nome, flags de prontidão). `select('*')` só no detalhe da
   ficha aberta (`useTechnicalSheetDetail` ou equivalente).
4. **Ficha save:** permanece patch diferencial; pós-save não invalida o mundo
   inteiro se a coluna alterada não afeta consumo/produção (honrar a mig
   `20270101014200` e espelhar no cliente).
5. **PV `/sales`:** lista paginada ou virtualizada (não montar cards mobile +
   tabela desktop com o dataset inteiro ao mesmo tempo). Alerta “DATA INVIÁVEL”
   continua no caminho cacheado (`get_min_billing_cached` / equivalente) — sem
   recalcular o motor por linha na abertura.
6. **PV save / promover:** zero laço serial pós-RPC para dados que a RPC atômica
   já grava; promoção ≤ 3 s no caso mediano da spec
   `pv-producao-performance-e-pendencias.md` (já é contrato — este programa só
   **guarda** regressão).

### R3 — Arquitetura / modularização

1. Extrair `TechnicalSheets.tsx` em: página casca + catálogo + 1 arquivo por aba
   já existente (`engineering`, `range-aviamento`, `production`, `costs`,
   `variants`, `ficha-corte`, `media`, `terceirizados`), sem mudar comportamento.
2. Extrair `SaleOrders.tsx` em: lista + toolbar/filtros + views (`consumo`,
   `pendencias`) + row/card — um único caminho de render por viewport (mobile
   **ou** desktop, não os dois montados).
3. Hub de estoque: cada tab em `components/inventory/tabs/*` já parcialmente
   separado; completar a fronteira (nenhuma lógica de Overview dentro do chunk
   de Materiais).
4. Consolidar React Query keys canônicas:
   - `['products']` / `['products', 'lite']` / `['products', 'paginated', …]`
   - `['technical-sheets']` / `['technical-sheets', 'lite']` / `['technical-sheet', id]`
   - `['sale-orders']` / `['sale-order', id]` / `['sale-order-items', id]`
   Invalidação só via helpers (`invalidateProducts`, etc.) — sem string solta nova.
5. Remover, num PR dedicado, código morto **que toca estes setores** (hooks/páginas
   órfãs de ficha/estoque/PV listados na auditoria UI) — sem expandir para purge
   global do repo.

### R4 — UX / fluxo operacional

1. **Estoque:** fluxo Materiais → detalhe → ajuste permanece; busca/debounce já
   existente no ajuste não regride; empty/error distintos (padrão `isError` da
   Fase 1 UI).
2. **Ficha:** trilho de prontidão (Identificação → Engenharia → Estoque →
   Produção → Liberação) permanece a bússola; salvar dirty não fecha dialogs no
   erro; abas pesadas (mídia, custos) não bloqueiam a primeira pintura da
   engenharia.
3. **PV:** criar/editar item com readiness de tiras **antes** do save (já existe —
   não regredir); promover falha → Pendências retentável; lista não mostra
   “nenhum pedido” quando a query falhou.
4. Toasts e labels em pt-BR; sem queryKey em inglês na UI.
5. Não inventar cards/hero/marketing — seguir o design system industrial atual.

### R5 — Governança do programa

1. Este arquivo é a **fonte de prioridade**. Specs filhas só para detalhe de
   implementação de uma fase (ex.: já existe `pv-producao-performance-e-pendencias.md`).
2. Ordem canônica das fases (abaixo). Pular fase só com nota explícita no PR
   (“Fase N adiada porque…”).
3. Cada PR de implementação cita a fase (`Fase 2.1 — …`) e atualiza o checklist
   do DoD deste doc (marcar `[x]`).

## Data model / Domain

Nenhuma entidade nova obrigatória. O programa opera sobre:

| Domínio | Tabelas / views centrais |
|---|---|
| Estoque | `products`, `product_groups`, `v_products_list`, `stock_movements`, `material_reservations`, `v_product_abc` |
| Ficha | `technical_sheets`, `sheet_materials`, `sole_technical_specs`, `reference_material_variants`, `component_sheets` |
| PV | `sale_orders`, `sale_order_items`, `orders` (OP), RPCs `create_sale_order_atomic`, `promote_sale_order_to_production`, pendências |

Migrations só quando a fase provar necessidade (índice, view lite materializada,
RPC de snapshot). Carimbo = `max(banco, arquivos locais) + 1` (regra do guia).

## User flows

### Happy path do programa (execução)

1. **Fase 0 — Baseline:** medir as métricas de R1 nos 3 hubs em produção/preview; gravar números.
2. **Fase 1 — Performance quick wins:** lite selects, lazy de abas/gráficos, cortar double-fetch, paginação/virtualização da lista de PV.
3. **Fase 2 — Modularização:** extrair monólitos sem mudar UX; consolidar query keys + invalidadores.
4. **Fase 3 — UX de fluxo:** fechar gaps de feedback (erro vs vazio, dirty save, pendências), polish dos fluxos críticos medidos na baseline.
5. **Fase 4 — Guarda:** testes de contrato de payload/keys + checklist de não-regressão das metas R2; atualizar este doc como “fase concluída”.

### Fluxos de produto que não podem piorar

- Estoque: listar materiais → abrir produto → ajustar quantidade com `adjustStockSafe`.
- Ficha: abrir referência → editar engenharia/BOM/variantes → salvar patch → readiness atualiza.
- PV: listar → novo/editar → item com grade/cor/variante → save atômico → aprovar → promover → pendência se falhar.

### Alternate / edge

- Catálogo grande (≫ 200 produtos): lista estoque e PV continuam usáveis (paginado/virtual).
- Ficha com muitas variantes/BOM: detalhe pode ser pesado; listagem não.
- Rede lenta (Brasil → us-west-2): save/promover não reintroduz laços seriais.
- Query Supabase falha: UI de erro, nunca empty state falso.

## Edge cases & failure modes

| Caso | Comportamento esperado |
|---|---|
| Call site ainda precisa do catálogo completo | Usa hook/variante nomeada (`useProductsLite` / paginado); comentário no call site se for exceção |
| Extração de monólito quebra deep-link `?tab=` / `?ref=` | Deep-links preservados; teste ou checklist manual por aba |
| Invalidação consolidada esquece um consumer | Helper único + teste que lista keys canônicas (padrão `dataListPageKey`) |
| Otimização de select omite coluna lida pelo motor | Guard espelhando o padrão `TECHNICAL_SHEET_CONSUMPTION_COLUMNS` (colunas lidas ⊆ select) |
| Lazy de Overview falha o chunk | Error boundary na aba, Materiais segue utilizável |
| Paginação de PV esconde pedido recente | Ordenação default = mais recente; deep-link `?view=` intacto |

## Constraints & assumptions

- Package manager **Bun**; typecheck canônico `bunx tsc -p tsconfig.app.json --noEmit`.
- Tokens de design — sem cores hardcoded nas telas app (print continua exempt).
- Ícones `@phosphor-icons/react` (nunca `lucide-react`).
- Domínio pt-BR / keys React Query em inglês.
- TS loose de propósito — typecheck da app é a rede de segurança.
- **Assunção (usuário pediu os 4 pontos):** o entregável inicial deste trabalho é a
  **estrutura do programa** (este spec). Implementação das fases vem em PRs
  seguintes, na ordem da Fase 0 → 4.
- **Assunção de meta numérica:** onde não há medição nova ainda, as metas de R2
  usam “não pior que o melhor caminho já existente no código” (ex.: lite do PV
  para fichas) até a Fase 0 gravar números absolutos.

## Fases detalhadas

```mermaid
flowchart LR
  F0[Fase0 Baseline] --> F1[Fase1 Performance]
  F1 --> F2[Fase2 Modularizacao]
  F2 --> F3[Fase3 UX fluxo]
  F3 --> F4[Fase4 Guarda]
```

### Fase 0 — Baseline (1 PR de docs/métricas, zero mudança de produto)

- Medir `/estoque`, `/fichas-tecnicas`, `/sales` (abertura + save típico).
- Inventariar call sites de `useProducts`, `useTechnicalSheets`, `useSaleOrders`.
- Entregável: tabela preenchida em `docs/METRICAS_OTIMIZACAO_SETORES.md`.

### Fase 1 — Performance

| ID | Item | Setor |
|---|---|---|
| 1.1 | Separar list lite vs detail na ficha; listagem sem `select('*')` | Ficha |
| 1.2 | Lazy das abas Overview/Alertas/Histórico + recharts no hub estoque | Estoque |
| 1.3 | Eliminar double-fetch MaterialsTab (paginado para lista; lite só onde preciso) | Estoque |
| 1.4 | Lista PV: um layout montado + paginação ou virtualização | PV |
| 1.5 | Auditar save PV/ficha por round-trips residuais pós-RPC/patch | PV + Ficha |

### Fase 2 — Modularização

| ID | Item | Setor |
|---|---|---|
| 2.1 | Split `TechnicalSheets.tsx` por aba | Ficha |
| 2.2 | Split `SaleOrders.tsx` (lista / views / row) | PV |
| 2.3 | Helpers de invalidação + keys canônicas (products, sheets, sale-orders) | Transversal |
| 2.4 | Purge de mortos ligados aos 3 setores | Transversal |

### Fase 3 — UX de fluxo

| ID | Item | Setor |
|---|---|---|
| 3.1 | isError vs empty em listagens dos 3 hubs | Todos |
| 3.2 | Dirty-guard / fechar dialog só no success nos forms restantes destes setores | Todos |
| 3.3 | Ficha: primeira aba útil (engenharia) interativa antes das abas pesadas | Ficha |
| 3.4 | PV: atalhos e feedback de Pendências/Consumo sem regressão de deep-link | PV |
| 3.5 | Estoque: ajuste e reservas com feedback de falha estruturado (não string crua do Postgres quando já houver mapper) | Estoque |

### Fase 4 — Guarda

| ID | Item |
|---|---|
| 4.1 | Testes de contrato: select lite ⊆ colunas necessárias; keys canônicas |
| 4.2 | Remedir métricas da Fase 0; colar delta neste spec / doc de métricas |
| 4.3 | Atualizar `CLAUDE.md` / `AGENTS.md` só se nascer padrão novo load-bearing (ex.: “listas de ficha usam lite”) |

## Specs e docs relacionados (não duplicar)

| Documento | Papel |
|---|---|
| `specs/pv-producao-performance-e-pendencias.md` | Contrato de promoção ≤ 3 s + Pendências |
| `specs/grupos-estoque.md` | Árvore Organização (produto; coordenar com Fase 1.2/1.3) |
| `specs/estoque-cores-e-editores.md` | Editores de cor no estoque |
| `specs/melhorias-busca-sistema.md` | Busca global (transversal; não bloqueia este programa) |
| `docs/AUDITORIA_UI_UX_2026-08-18.md` | Backlog UI/bundle/monólitos |
| `docs/AUDITORIA_FICHAS_TECNICAS_2026-08-16.md` | Integridade do cadastro de ficha |
| `docs/AUDITORIA_PEDIDOS_VENDA_2026-08-16.md` | Integridade comercial do PV |
| `docs/AUDITORIA_MOTORES_CONSUMO_COMPRA_ESTOQUE_2026-08-25.md` | Motores — só tocar se performance exigir |

## Open questions

Nenhuma bloqueante para a estrutura. Na Fase 0, decidir só:

- Meta absoluta de abertura da lista de PV (ex.: ≤ 1,5 s até primeiro paint útil) com base na medição — até lá vale R2.5 (não regredir o caminho cacheado).

## Definition of Done

### Estrutura (esta entrega)

- [x] Spec-mestre existe em `specs/otimizacao-setores-principais.md` cobrindo os 4 eixos e os 3 setores.
- [x] Fases 0–4 ordenadas com IDs rastreáveis e links às auditorias/specs filhas.
- [x] Fora de escopo e regras canônicas intocáveis explícitos.

### Programa (quando as fases forem implementadas)

- [x] Fase 0: `docs/METRICAS_OTIMIZACAO_SETORES.md` preenchido com inventário de código — Network/chunks remedir em preview.
- [x] Fase 1: metas R2.1–R2.5 atendidas no código (1.1–1.4) — verificado por contrato `setoresPrincipaisOtimizacao.contract.test.ts` + Network em preview.
- [x] Fase 2: `TechnicalSheets.tsx` e `SaleOrders.tsx` deixam de ser monólitos god-file (casca + módulos por aba/view); keys canônicas via helpers — verificado por estrutura de pastas + grep de `queryKey` solta.
- [ ] Fase 3: listagens dos 3 hubs distinguem erro vs vazio; deep-links `?tab=` / `?view=` / `?ref=` intactos — verificado manualmente nas 3 rotas.
- [ ] Fase 4: testes de contrato verdes (`bun run test` no subconjunto novo) + delta de métricas documentado.
- [ ] `bunx tsc -p tsconfig.app.json --noEmit` limpo em todo PR do programa.
- [ ] Após edits visuais: `bun run check:tokens` limpo.
