-- Auditoria somente leitura do domínio de embalagens.
-- Executar pela workflow supabase-db-exec.yml. Não altera dados nem esquema.

WITH
box_summary AS (
  SELECT jsonb_build_object(
    'total', count(*),
    'ativas', count(*) FILTER (WHERE active),
    'estoque_total', COALESCE(sum(quantity) FILTER (WHERE active), 0),
    'sem_preco', count(*) FILTER (WHERE active AND COALESCE(unit_price, 0) <= 0),
    'sem_tara', count(*) FILTER (WHERE active AND COALESCE(empty_weight_kg, 0) <= 0),
    'sem_capacidade', count(*) FILTER (WHERE active AND COALESCE(pairs_per_box_default, 0) <= 0),
    'abaixo_minimo', count(*) FILTER (
      WHERE active AND COALESCE(min_stock, 0) > 0 AND COALESCE(quantity, 0) <= min_stock
    )
  ) AS value
  FROM public.box_types
),
sole_summary AS (
  SELECT jsonb_build_object(
    'total', count(*),
    'sem_nenhum_modo', count(*) FILTER (
      WHERE box_type_id IS NULL AND box_type_master_id IS NULL
        AND box_type_colmeia_id IS NULL AND box_type_fitilho_id IS NULL
    ),
    'tradicional_incompleto', count(*) FILTER (
      WHERE box_type_id IS NULL OR box_type_master_id IS NULL
    ),
    'amarrado_incompleto', count(*) FILTER (
      WHERE box_type_id IS NULL OR box_type_fitilho_id IS NULL
    ),
    'colmeia_incompleta', count(*) FILTER (WHERE box_type_colmeia_id IS NULL),
    'slot_aponta_caixa_inativa_ou_ausente', count(*) FILTER (
      WHERE EXISTS (
        SELECT 1
        FROM unnest(ARRAY[
          product_groups.box_type_id,
          product_groups.box_type_master_id,
          product_groups.box_type_colmeia_id,
          product_groups.box_type_fitilho_id
        ]) slot_id
        WHERE slot_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.box_types bt WHERE bt.id = slot_id AND bt.active
          )
      )
    )
  ) AS value
  FROM public.product_groups
  WHERE sector = 'Solado'
),
legacy_summary AS (
  SELECT jsonb_build_object(
    'packaging_configs', (SELECT count(*) FROM public.packaging_configs),
    'technical_sheet_box_types', (SELECT count(*) FROM public.technical_sheet_box_types),
    'products_categoria_embalagem', (
      SELECT count(*) FROM public.products
      WHERE lower(COALESCE(category, '')) IN ('embalagem', 'embalagens')
    ),
    'ops_com_embalagem_manual', (
      SELECT count(*) FROM public.orders
      WHERE packaging_product_id IS NOT NULL OR COALESCE(packaging_quantity, 0) > 0
    )
  ) AS value
),
sheet_summary AS (
  SELECT jsonb_build_object(
    'fichas_sem_solado', count(*),
    'fichas_sem_solado_com_item_pv', count(*) FILTER (WHERE itens_pv > 0),
    'itens_pv_afetados', COALESCE(sum(itens_pv), 0)
  ) AS value
  FROM (
    SELECT ts.id, count(soi.id)::integer AS itens_pv
    FROM public.technical_sheets ts
    LEFT JOIN public.sale_order_items soi ON soi.reference_id = ts.id
    WHERE ts.sole_group_id IS NULL
    GROUP BY ts.id
  ) x
),
movement_summary AS (
  SELECT jsonb_build_object(
    'movimentos_total', count(*),
    'saidas', count(*) FILTER (WHERE movement_type = 'out'),
    'entradas_estorno', count(*) FILTER (WHERE movement_type = 'in'),
    'ops_com_saida', count(DISTINCT order_id) FILTER (WHERE movement_type = 'out'),
    'primeiro_movimento', min(created_at),
    'ultimo_movimento', max(created_at)
  ) AS value
  FROM public.stock_movements
  WHERE product_id IN (SELECT id FROM public.box_types)
),
op_base AS (
  SELECT o.id, o.status, ts.sole_group_id,
         EXISTS (
           SELECT 1 FROM public.stock_movements sm
           WHERE sm.order_id = o.id
             AND sm.product_id IN (SELECT id FROM public.box_types)
             AND sm.movement_type = 'out'
         ) AS tem_saida
  FROM public.orders o
  LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
  WHERE o.status NOT IN ('Rascunho', 'Cancelada')
),
op_by_status AS (
  SELECT status, count(*) AS quantidade
  FROM op_base
  GROUP BY status
),
op_summary AS (
  SELECT jsonb_build_object(
    'ops_vivas', (SELECT count(*) FROM op_base),
    'ops_vivas_sem_movimento_saida', (SELECT count(*) FROM op_base WHERE NOT tem_saida),
    'ops_vivas_sem_solado', (SELECT count(*) FROM op_base WHERE sole_group_id IS NULL),
    'por_status', COALESCE((
      SELECT jsonb_object_agg(status, quantidade ORDER BY status) FROM op_by_status
    ), '{}'::jsonb)
  ) AS value
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'box_types', (SELECT value FROM box_summary),
  'sole_groups', (SELECT value FROM sole_summary),
  'legacy_sources', (SELECT value FROM legacy_summary),
  'technical_sheets', (SELECT value FROM sheet_summary),
  'stock_movements', (SELECT value FROM movement_summary),
  'orders', (SELECT value FROM op_summary)
) AS packaging_audit;
