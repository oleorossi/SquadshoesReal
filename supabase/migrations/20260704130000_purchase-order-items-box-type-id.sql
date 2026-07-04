-- ════════════════════════════════════════════════════════════════════════════
-- M7 (parte 1/2) — Pré-requisito: OC pode apontar para um box_type
--
-- Adiciona purchase_order_items.box_type_id (FK nullable pra box_types). É o elo
-- que faltava pra uma linha de ordem de compra representar embalagem (caixa/saco)
-- em vez de um produto de estoque. Aditivo e idempotente — não altera nada do
-- fluxo atual (linhas existentes têm box_type_id = NULL).
--
-- ── POR QUE O RESTO DO M7 NÃO ENTRA AQUI (gated por validação com dado real) ──
-- Fazer box_types aparecer no MRP como necessidade de compra exige mais dois
-- passos que mexem no caminho CANÔNICO de compras e cuja CORREÇÃO depende de
-- dados reais (hoje 0 grupos de solado têm caixa vinculada → demanda vazia):
--
--   (a) fn_projected_packaging_demand() → (box_type_id, boxes_required,
--       earliest_deadline, orders_count). Precisa espelhar a resolução do débito
--       (pedido aberto → technical_sheets.sole_group_id → product_groups.box_type_*
--       + pares/caixa), somando CEIL(pares / pares_por_caixa). ATENÇÃO: o caminho
--       de demanda de material (fn_projected_demand → filter_caixa_by_packaging_mode)
--       trata caixa como `products` (classificada por nome via caixa_collective_type),
--       modelo DIFERENTE de box_types. Por isso a demanda de box_types é uma
--       derivação nova, não reaproveita as linhas de caixa do consumo.
--
--   (b) v_mrp_needs estendida com UNION ALL de box_types como pseudo-produtos
--       (on_hand=quantity, reserved=0, projected_demand=boxes_required,
--       suggested_qty=GREATEST(demanda+min_stock-on_hand-qty_in_po,0),
--       qty_in_po via purchase_order_items.box_type_id), + um flag is_packaging
--       pra o MrpNeedsTable renderizar essas linhas e rotear o "Gerar OC" delas
--       (product_id é NOT NULL em purchase_order_items → linha só-de-caixa exige
--       relaxar essa constraint e o gerador de OC aceitar box_type_id).
--
-- Esses dois passos alimentam a view canônica que dispara o "Gerar OC". Devem ser
-- feitos numa branch Supabase de dry-run, com grupos de solado JÁ vinculados a
-- caixas (dado real), validando os números no app antes de ir pro main. O módulo
-- /embalagens já tem alertas de estoque baixo de caixa (PackagingAlerts) cobrindo
-- a necessidade imediata enquanto isso.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS box_type_id uuid REFERENCES public.box_types(id);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_box_type_id
  ON public.purchase_order_items (box_type_id)
  WHERE box_type_id IS NOT NULL;

COMMENT ON COLUMN public.purchase_order_items.box_type_id IS
  'Quando a linha da OC é embalagem (caixa/saco), aponta pra box_types.id. '
  'Mutuamente informativa com product_id (linha de produto). Ver migration '
  '20260704130000 pra o desenho do restante do M7 (MRP de embalagem).';
