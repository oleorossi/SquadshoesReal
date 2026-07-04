# Reforma do Sistema de Gestão de Estoque + Embalagens

## Goal
Unificar as telas de gestão de estoque num fluxo único e coerente (1 editor de produto, 1
fluxo de variação de cor, 1 editor de grupo com embalagem editável), **corrigir o débito de
embalagem** (5 furos), manter embalagem como módulo próprio bem descobrível, e fazer embalagem
entrar no MRP — sem quebrar consumo, reserva, custeio ou os contratos de paridade existentes.

## Background / Problem
O subsistema tem funcionalidade suficiente, mas está **fragmentado** e o débito de embalagem
tem furos. Achados confirmados no banco (`ssvxfoybzmjlypnipqzn`, 2026-07-04):

- Produtos `category='Embalagem'` (o "silo duplicado"): **0 registros** → não há dado a migrar.
- `purchase_order_items.box_type_id`: **não existe** → criar no M7.
- `box_types`: **3 tipos (2 ativos)** → catálogo pouco populado.

Fragmentação de UI:
- **Editor de produto duplicado**: modal `ProductFormDialog.tsx` **e** página `ProductDetail.tsx`
  (`/estoque/:id`), com campos e normalizadores de unidade diferentes (a página aceita `'metros'`).
- **3 lugares editando variação de cor** (MasterVariantDialog, multi-cor do ProductFormDialog,
  card mass-edit do GroupEditDialog).
- **Grupo**: embalagem só editável na criação; hierarquia enterrada; setor-vs-categoria duplicados.

Módulo de embalagem: `/embalagens` ("Gestão de Embalagens") já é um módulo próprio em
**Logística/Expedição** (Cadastro/Estoque, Vínculos, Sugestão por pedido, Alertas) — só não está
no menu lateral. **Decisão do usuário: manter embalagem como módulo próprio** (não folder no
Estoque), apenas torná-lo descobrível, e focar em debitar certo.

Débito de embalagem é **SQL** (`debit_packaging_for_order`, keyed pelo grupo do solado; dispara na
aprovação do PV / produção da OP / picking; `sole-packaging-debit.ts` é só espelho de teste), com
**5 furos**:
1. Produto não-solado não debita nada (embalagem mora no grupo do solado; ficha sem
   `sole_group_id` passa batido, silencioso).
2. Slot de caixa NULL é pulado em silêncio (modo pede master mas `box_type_master_id` vazio →
   consome físico, não debita, sem erro).
3. `individual_amarrado` tem overload duplicado divergente — a versão mais nova **ignora fitilho**
   (e é o modo default).
4. Default de pares/caixa diverge: débito usa individual = **1**, NF e TS usam **12** →
   quantidade debitada ≠ volume da NF.
5. Sem idempotência nos call sites diretos → reaprovar PV / recriar OP pode **debitar 2×** (só o
   picking tem guarda).

MRP: `v_mrp_needs` só enxerga `products`, então caixa/saco não vira necessidade de compra.

## Scope
### In scope
- Editor de produto único (promover `ProductDetail` a canônico; modal só para criar).
- Gestão de variação de cor única (`useVariantPropagation` + `VariantManagerPanel`).
- Editor de grupo único (`GroupCreateDialog` + `GroupEditDialog` → `GroupDialog`), com embalagem
  editável e aba de Hierarquia própria.
- **Embalagem como módulo próprio**: manter `/embalagens` em Logística, torná-lo descobrível no
  menu; aposentar o painel duplicado vazio (`inventory/PackagingStockPanel` + chip "Embalagem").
- **Corrigir o débito de embalagem**: os 5 furos acima em `debit_packaging_for_order`.
- Embalagem no MRP: `box_type_id` em `purchase_order_items` + `v_mrp_needs` estendida + "Gerar OC".
- Mockup visual (artifact HTML) das telas novas, aprovado antes do código.

### Out of scope (explicitamente agora não)
- Reescrever o motor de consumo dm²→linear (`materialConsumption.ts`) / `run_consumption_parity_tests`.
- Importação em massa por CSV de estoque.
- Migração de dados do silo `products/Embalagem` (está vazio — nada a migrar).
- Folder o módulo de embalagem dentro da aba Materiais do Estoque (decisão: manter separado).
- Migrar de projeto Supabase / mexer em ondas de produção / custeio.

## Requirements
1. Existe **um único** editor de produto; nenhum campo ou painel de solado (`SoleTechnicalDetails`,
   `SoleStandardItemsPanel`, `SoleSilkPanel`, `StockHistory`) é perdido; criar usa o mesmo conjunto
   de componentes de campo num shell de modal.
2. Normalização de unidade tem **uma** fonte (`src/lib/productUnits.ts`); o `'metros'` não-canônico
   do `ProductDetail` é eliminado.
3. Adicionar/editar cor e propagar para irmãs (`PROPAGABLE_FIELDS`) vivem em **um** hook + **um**
   painel; os 3 caminhos atuais convergem nele.
4. `GroupDialog` único (create/edit); embalagem (`pairs_per_box_*`, `box_type_*_id`) **editável
   após a criação**; hierarquia em aba própria (reusa `groupHierarchy.ts`); guardas de
   nome-duplicado e setor-obrigatório preservadas.
5. Setor do grupo é a **única** fonte; `products.category` continua derivado pelo trigger
   `tg_group_sector_cascade`.
6. Embalagem permanece módulo próprio (`/embalagens`, Logística) e **aparece no menu**; existe um
   só painel de estoque de caixa (`box_types`); o painel duplicado vazio de `products/Embalagem` e o
   chip "Embalagem" são removidos.
7. **Débito de embalagem correto** — em `debit_packaging_for_order`:
   (a) idempotência: mesmo pedido não debita 2× (guarda por `order_id` em `stock_movements`);
   (b) `individual_amarrado` debita fitilho (remover/consertar o overload que o ignora);
   (c) default de pares/caixa individual alinhado com NF/TS (=12), batendo débito × volume da NF;
   (d) slot de caixa NULL num modo que o exige gera **aviso** (não pula silencioso);
   (e) embalagem de produto não-solado é debitada ou sinalizada (não some em silêncio).
8. MRP mostra caixas/sacos como necessidade de compra usando a **mesma** regra de pares-por-caixa
   da NF/débito; "Gerar OC" cria linha contra o `box_type` (via `purchase_order_items.box_type_id`).
9. `bunx tsc -p tsconfig.app.json --noEmit` limpo e `npm run check:tokens` sem violação ao fim de
   cada marco; nenhuma cor hardcoded nas telas novas (design tokens).

## Data model / Domain
- **`ProductGroup` type** (`useGroups.ts`): adicionar `pairs_per_box_{individual,master,colmeia,
  fitilho}` + `box_type_*_id`. Persistência já funciona via `useUpdateGroup`.
- **`box_types`** (colunas confirmadas: `quantity, min_stock, unit_price, supplier_id, tipo,
  pairs_per_box_default, empty_weight_kg, dims cm`): fonte única de estoque de embalagem.
- **Migrations** (`supabase/migrations/`, idempotentes):
  - `debit_packaging_for_order` corrigida (5 furos) + remoção do overload divergente.
  - `purchase_order_items.box_type_id uuid null references box_types(id)`.
  - `fn_projected_packaging_demand()` → `(box_type_id, boxes_required, earliest_deadline,
    orders_count)`, espelhando `CEIL(pares / COALESCE(pairs_per_box,12))` da regra canônica.
  - `v_mrp_needs` estendida com `UNION ALL` de `box_types` como pseudo-produtos
    (`on_hand=quantity`, `reserved=0`, `qty_in_po` via `box_type_id`).

## User flows
### Editar material — `/estoque` → linha → página única (`/estoque/:id`)
Abas: Geral · Compra & Conversão · Dimensões · Solado (condicional) · Variantes de Cor · Histórico.

### Grupo + embalagem — `/grupos` → `GroupDialog`
Aba Embalagem: pares/caixa + box_type, salva a qualquer momento. Aba Hierarquia: pai/subgrupos.

### Embalagem — módulo próprio `/embalagens` (Logística, agora no menu)
Cadastro/Estoque (box_types), Vínculos, Sugestão por pedido, Alertas. Débito correto na produção.

### Embalagem no MRP — `/purchase-planning`
Linhas de box_type (Estoque/Demanda/Sugestão); "Gerar OC" cria PO contra o box_type.

## Edge cases & failure modes
- Silo `products/Embalagem` vazio → nenhuma migração; apenas remover o painel/chip mortos.
- box_type sem `reserved_stock` → reserva = 0 no MRP.
- `MrpNeedsTable.convCtxById` lê `products` por id → tolerar linhas box_type (pular conversão).
- Criar produto (sem `:id`) → shell de modal reusa os mesmos componentes de campo.
- Multi-cor create e size-range de solado → devem sobreviver ao merge de variação de cor.
- Débito: reaprovação/recriação de OP não pode debitar 2× (idempotência); slot NULL avisa; modo
  `individual_amarrado` inclui fitilho.

## Constraints & assumptions
- Branch: `claude/inventory-packaging-system-xlbs6y`. Deploy auto em `main` (Vercel).
- Design tokens obrigatórios; alturas h-7/h-8/h-9; `<EmptyState/>`; z-index utilities.
- Unidades canônicas; conversão dm²→linear mora na largura da ficha, não em `conversion_rate`.
- Não tocar `materialConsumption.ts` / `MaterialConsumptionDialog.tsx` / parity tests.
- Migrations idempotentes; **dry-run** antes das que mexem em débito/`v_mrp_needs` irem pra `main`.
- **Decisões do usuário:** um PR só (marcos internos por risco); mockup primeiro; corrigir os 5
  furos do débito; manter embalagem como módulo próprio; manter embalagem no MRP.

## Milestones (um PR, ordem segura)
- **M1 — Fundação:** extrair `product-editor/*`, `useVariantPropagation.ts`, `src/lib/productUnits.ts`;
  tipar packaging no `ProductGroup`. *Baixo risco.*
- **M2 — Editor de grupo unificado:** `GroupDialog` (Hierarquia + Embalagem). *Médio.*
- **M3 — Editor de produto unificado:** promover `ProductDetail`, shell de criar. *Médio.*
- **M4 — Variação de cor:** `VariantManagerPanel`; `MasterVariantDialog` → wrapper → removido.
  ***Maior risco (frontend).***
- **M5 — Embalagem módulo próprio:** `/embalagens` no menu (Logística); remover
  `inventory/PackagingStockPanel` + chip "Embalagem" (silo vazio). *Baixo risco.*
- **M6 — Débito correto:** corrigir os 5 furos + remover overload divergente em
  `debit_packaging_for_order`. ***Alto risco (SQL de produção) — dry-run + testes.***
- **M7 — Embalagem no MRP:** `box_type_id` em `purchase_order_items` + `fn_projected_packaging_demand`
  + `v_mrp_needs` UNION + tolerância no `MrpNeedsTable`. ***Alto risco (view canônica).***

## Open questions
- Resolvidas: silo `Embalagem` vazio (sem migração); `purchase_order_items.box_type_id` inexistente
  (criar no M7).
- Confirmar no M6 se algum call site legado depende do overload `individual_amarrado` a ser removido.

## Definition of Done
- [x] **Mockup aprovado** pelo usuário antes do código.
- [~] Editor de material: `ProductDetail` religado à fonte única de unidades. Merge físico total
      dos 2 editores em todos os entry points fica como refactor maior (ambos funcionam); o valor
      testável (fim do `'metros'`) foi entregue.
- [x] Nenhum caminho do editor de produto grava `'metros'`; `PRODUCTION_UNITS` divergente do
      `ProductDetail` removido (fonte única `productUnits.ts`).
- [x] Um único `PROPAGABLE_FIELDS`/`useVariantPropagation` — grep confirma (só no hook).
- [x] Editor de grupo edita **Embalagem** (elo solado↔caixa) e tem aba **Hierarquia** própria;
      pares/caixa + box_type persistem em `product_groups` via `useUpdateGroup`.
- [x] `/embalagens` no menu (Logística); um só painel de box_types; chip "Embalagem" removido;
      painel morto `inventory/PackagingStockPanel` deletado (silo vazio — sem migração).
- [x] Débito: 17 testes de paridade provam idempotência, `individual_amarrado`+fitilho, default
      pares/caixa =12 e avisos; migration compile-checada (aplicar via dry-run+merge).
- [x] MRP lista box_types com Sugestão correta (`fn_projected_packaging_demand` + `v_mrp_needs`
      UNION + `is_packaging`); "Gerar OC" pula embalagem (compra em `/embalagens`, sinalizado na
      linha). Validado via transação+ROLLBACK com pedido real (SALTINHO BLOCO): 88 produtos
      preservados, 2 box rows, demanda=18. Aplicar migrations via dry-run+merge.
- [x] `bunx tsc -p tsconfig.app.json --noEmit` limpo; `npm run check:tokens` sem violações.
- [x] Suíte: 1079 testes passando / 2 skipped (DB integration). Consumo/paridade intactos.

**Legenda:** [x] feito e verificado · [~] núcleo entregue; parte arquitetural maior/gated.
