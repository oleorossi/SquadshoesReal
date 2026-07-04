# Reforma do Sistema de Gestão de Estoque + Embalagens

## Goal
Unificar as telas de gestão de estoque num fluxo único e coerente (1 editor de produto, 1
fluxo de variação de cor, 1 editor de grupo com embalagem editável), reconciliar embalagem
numa fonte única de verdade, e fazer embalagem entrar no MRP — sem quebrar consumo, reserva,
custeio ou os contratos de paridade existentes.

## Background / Problem
O subsistema de estoque + embalagens do Squad Shoes (ERP React + TS + Vite + Supabase) tem
funcionalidade suficiente, mas está **fragmentado** — a mesma tarefa mora em vários lugares
divergentes, o que torna a edição confusa e a embalagem/visibilidade pouco confiáveis:

- **Editor de produto duplicado**: modal `ProductFormDialog.tsx` (1989 linhas) **e** página
  `ProductDetail.tsx` (`/estoque/:id`), com campos e normalizadores de unidade diferentes (a
  página ainda aceita `'metros'` não-canônico).
- **3 lugares editando variação de cor**, cada um reimplementando "aplicar a todas as cores":
  `MasterVariantDialog` (3 abas), modo multi-cor do `ProductFormDialog`, e o card mass-edit do
  `GroupEditDialog`.
- **Grupo**: embalagem (`pairs_per_box_*`) só editável na **criação**; hierarquia enterrada na
  aba "Geral"; setor-vs-categoria duplicados.
- **Embalagem em 3 sistemas paralelos**: `box_types` (é o que realmente é **debitado** na
  produção via `sole-packaging-debit.ts`), produtos `category='Embalagem'` (silo de exibição
  **nunca debitado**) e `packaging_configs` (camada de spec). Dois componentes com o mesmo
  nome `PackagingStockPanel` lendo tabelas diferentes. Página `/embalagens` fora do menu.
- **Embalagem invisível ao MRP**: `v_mrp_needs` só enxerga `products`.

## Scope
### In scope
- Editor de produto único (promover `ProductDetail` a canônico; modal só para criar).
- Gestão de variação de cor única (`useVariantPropagation` + `VariantManagerPanel`).
- Editor de grupo único (`GroupCreateDialog` + `GroupEditDialog` → `GroupDialog`), com
  embalagem editável e aba de Hierarquia própria.
- Reconciliação de embalagem: `box_types` como fonte única de estoque; retirar o silo
  `products/Embalagem`; `/embalagens` no menu lateral.
- Embalagem no MRP: demanda de caixas + `v_mrp_needs` estendida + "Gerar OC" para box_type.
- Mockup visual (artifact HTML) das telas novas, aprovado antes do código.

### Out of scope (explicitamente agora não)
- Reescrever o motor de consumo dm²→linear (`materialConsumption.ts`) ou o contrato
  `run_consumption_parity_tests`.
- Importação em massa por CSV de estoque.
- Mudar o fluxo de débito de embalagem na produção (`sole-packaging-debit.ts`).
- Migrar de projeto Supabase / mexer em ondas de produção / custeio.

## Requirements
1. Existe **um único** editor de produto; nenhum campo ou painel de solado
   (`SoleTechnicalDetails`, `SoleStandardItemsPanel`, `SoleSilkPanel`, `StockHistory`) é
   perdido; criar usa o mesmo conjunto de componentes de campo num shell de modal.
2. Normalização de unidade tem **uma** fonte (`src/lib/productUnits.ts`); o `'metros'`
   não-canônico do `ProductDetail` é eliminado.
3. Adicionar/editar cor e propagar para irmãs (`PROPAGABLE_FIELDS`) vivem em **um** hook +
   **um** painel; os 3 caminhos atuais convergem nele.
4. `GroupDialog` único (create/edit); embalagem (`pairs_per_box_*`, `box_type_*_id`)
   **editável após a criação**; hierarquia em aba própria (reusa `groupHierarchy.ts`); guardas
   de nome-duplicado e setor-obrigatório preservadas.
5. Setor do grupo é a **única** fonte; `products.category` continua derivado pelo trigger
   `tg_group_sector_cascade`.
6. `box_types` é a **fonte única** de estoque de embalagem; os dois `PackagingStockPanel` viram
   um só (`BoxTypesStockPanel`); silo `products/Embalagem` retirado com migração one-time de
   saldos reais; `/embalagens` aparece no menu.
7. MRP mostra caixas/sacos como necessidade de compra, usando a **mesma** regra de
   pares-por-caixa da NF/débito; "Gerar OC" cria linha contra o box_type.
8. `bunx tsc -p tsconfig.app.json --noEmit` limpo e `npm run check:tokens` sem violação ao fim
   de cada marco; nenhuma cor hardcoded nas telas novas (design tokens).

## Data model / Domain
- **`ProductGroup` type** (`useGroups.ts`): adicionar `pairs_per_box_{individual,master,
  colmeia,fitilho}` + `box_type_*_id`. Persistência já funciona via `useUpdateGroup`.
- **`box_types`**: fonte única de estoque de embalagem.
- **Migração one-time**: copiar `quantity/min_stock/unit_price` de produtos `Embalagem` com
  saldo para o `box_types` correspondente e inativar o produto.
- **Novas migrations** em `supabase/migrations/`:
  - `fn_projected_packaging_demand()` → `(box_type_id, boxes_required, earliest_deadline,
    orders_count)`, espelhando `CEIL(pairs / COALESCE(pairs_per_box,12))`.
  - `v_mrp_needs` estendida com `UNION ALL` de `box_types` como pseudo-produtos.
  - Verificar `purchase_order_items.box_type_id` (adicionar se faltar).

## User flows
### Happy path — editar material
1. `/estoque` → clica na linha → página editor única (`/estoque/:id`).
2. Abas: Geral · Compra & Conversão · Dimensões · Solado (condicional) · Variantes de Cor ·
   Histórico. Salva; propagação para irmãs opcional na aba Variantes.

### Happy path — grupo + embalagem
1. `/grupos` → `GroupDialog` (mesma tela cria e edita).
2. Aba Embalagem: pares/caixa por tipo + vincula box_type; salva a qualquer momento.
3. Aba Hierarquia: grupo-pai/subgrupos com guardas de ciclo.

### Happy path — embalagem no MRP
1. `/purchase-planning` → aba MRP mostra linhas de box_type (Estoque/Demanda/Sugestão).
2. "Gerar OC" cria PO contra o box_type.

## Edge cases & failure modes
- Produto `Embalagem` legado com saldo real → migrado antes de inativar; sem match → relatar,
  não apagar.
- box_type sem `reserved_stock` → termo reserva = 0 no MRP.
- `MrpNeedsTable.convCtxById` lê `products` por id → tolerar linhas box_type (pular conversão).
- Criar produto (sem `:id`) → shell de modal reusa os mesmos componentes de campo.
- Multi-cor create e size-range de solado → devem sobreviver ao merge de variação de cor.

## Constraints & assumptions
- Branch: `claude/inventory-packaging-system-xlbs6y`. Deploy auto em `main` (Vercel).
- Design tokens obrigatórios; alturas h-7/h-8/h-9; `<EmptyState/>`; z-index utilities.
- Unidades canônicas; conversão dm²→linear mora na largura da ficha, não em `conversion_rate`.
- Não tocar `materialConsumption.ts` / `MaterialConsumptionDialog.tsx` / parity tests.
- Migrations idempotentes; dry-run antes do M6 ir pra `main`.
- **Assumção (usuário deixou a critério):** um PR só, internamente em 6 marcos ordenados por
  risco crescente, com gates de typecheck/tokens entre eles.

## Milestones (um PR, ordem segura)
- **M1 — Fundação:** extrair `product-editor/*`, `useVariantPropagation.ts`,
  `src/lib/productUnits.ts`; tipar packaging no `ProductGroup`. *Baixo risco.*
- **M2 — Editor de grupo unificado:** `GroupDialog` com abas Hierarquia + Embalagem. *Médio.*
- **M3 — Editor de produto unificado:** promover `ProductDetail`, shell de criar. *Médio.*
- **M4 — Variação de cor:** `VariantManagerPanel`; `MasterVariantDialog` → wrapper → removido.
  ***Maior risco.***
- **M5 — Reconciliar embalagem:** `BoxTypesStockPanel`, retirar silo, `/embalagens` no menu.
  *Médio.*
- **M6 — Embalagem no MRP:** `fn_projected_packaging_demand` + `v_mrp_needs` UNION. ***Alto.***

## Open questions
- `purchase_order_items` já tem `box_type_id`? (verificar no M6).
- Existem produtos `Embalagem` com saldo real hoje? (checar no M5).

## Definition of Done
- [ ] **Mockup aprovado** pelo usuário antes do código.
- [ ] Editar material abre **um só** editor; criar usa o mesmo shell (nenhum entry point abre o
      modal antigo divergente).
- [ ] Nenhum caminho de UI aceita `'metros'`; `PRODUCTION_UNITS` divergente removido.
- [ ] Um único `PROPAGABLE_FIELDS`/`useVariantPropagation` (grep confirma).
- [ ] `GroupDialog` edita embalagem e hierarquia; pares/caixa persistem em `product_groups`.
- [ ] `/embalagens` no menu; um só `BoxTypesStockPanel`; sem chip "Embalagem"; saldos migrados.
- [ ] MRP lista box_types com Sugestão correta; "Gerar OC" cria PO contra o box_type.
- [ ] `bunx tsc -p tsconfig.app.json --noEmit` limpo; `npm run check:tokens` sem violações.
- [ ] `run_consumption_parity_tests()` e testes TS de consumo continuam passando.
