# Remover estoque mínimo do sistema

> Decidido em grill com o dono em 10/10/2026 (Q23–Q25 da sessão de tiras).

## Goal

Compra passa a ser **só sob demanda dos PVs**. Estoque mínimo deixa de existir
em todos os setores.

## Background (medido em 10/10/2026)

Produtos com `min_stock > 0`: Material Base 56/101, Componente 47/65,
Forração da Palmilha 34/52, Solado 3/12, Cabedal 3/28 (143 no total) + 2
`box_types` + 4 `artisanal_strap_variants.min_stock_m`.

Onde mora: colunas `products.min_stock`, `products.min_stock_grade`,
`box_types.min_stock`, `purchase_order_items.min_stock`,
`artisanal_strap_variants.min_stock_m`/`min_stock_replenishment_mode`; views
`product_stock_with_reservations`, `purchase_projection_timeline`,
`v_mrp_needs`, `v_products_list`; **46 funções** SQL que citam `min_stock`;
**89 arquivos** em `src/` (lib, hooks, páginas, inventory, packaging,
financial, purchase, soles-hub, artisanal-straps).

## Decisões

- Sem mínimo em nenhum setor; a reposição sem pedido deixa de existir. O dono
  aceitou o risco de prazo de fornecedor (Q24).
- Spec separada do redesenho de tiras, entregue **antes** (Q25).

## Entregas

1. **E1 — Desligar (reversível):** zerar `min_stock`/`min_stock_grade` (143
   produtos, 2 caixas, 4 variantes), esconder o campo em todos os formulários e
   listas, tirar o termo "abaixo do mínimo" de alertas, dashboards e sugestão de
   compra. Antes de zerar, exportar os valores atuais (CSV), para poder voltar.
2. **E2 — Remover (após algumas semanas sem problema):** dropar colunas, ajustar
   as 46 funções e 4 views (varrer `pg_proc` **e** `pg_views`), apagar o código
   morto do front, regenerar `types.ts`.

## Definition of Done
- [ ] Nenhuma tela mostra ou pede estoque mínimo.
- [ ] Sugestão de compra / MRP / projeção só refletem demanda de PV.
- [ ] Export dos valores antigos guardado.
- [ ] (E2) `select … from pg_proc/pg_views where def ilike '%min_stock%'` = 0.
- [ ] typecheck (`-p tsconfig.app.json`), lint e testes verdes; verificado em produção.
