-- Ateliê: a fila passa a conhecer o PRAZO DE ENTREGA DO PV.
--
-- Decisão do dono (12/10/2026): nos relatórios de corte o pedido vem de cima
-- pra baixo pelo prazo de entrega (`sale_orders.delivery_deadline`) e os itens
-- ficam agrupados por referência. A fila do Ateliê não tinha esse dado: o
-- payload trazia `billing_week` e `min_ready_date`, e ordenava por
-- `min_ready_date` — que é a data RECUADA pela agenda do Ateliê (offsets de
-- Costura/Aviamento), não o prazo que o cliente combinou.
--
-- O que entra:
--   • `delivery_deadline` em cada pedido do array `orders`
--   • `min_delivery_deadline` no lote — o prazo mais próximo entre os PVs dele
--   • ordem default: prazo mais próximo primeiro, NULLS LAST
--
-- ⚠ `min_ready_date` FICA no payload e no cartão ("pronto até"): é outra data,
-- com outro papel (quando o lote tem que voltar do prestador). Trocar uma pela
-- outra tiraria do cartão a informação que governa o envio.
--
-- ⚠ O lote é `referência × cor` e atravessa VÁRIOS PVs — por isso o prazo do
-- lote é o MÍNIMO entre os pedidos, não "o prazo do pedido". `atelier_confirm_lot_cut`
-- opera por lote, então a hierarquia pedido → referência da tela de relatório
-- não cabe nesta fila: aqui o agrupamento é por referência e a ordem é a do
-- prazo mais apertado que o lote carrega.
--
-- Corpo baseado na definição VIVA lida com `pg_get_functiondef` em 12/10/2026,
-- não no arquivo da migration anterior (a verdade é o banco).

CREATE OR REPLACE FUNCTION public.list_atelier_lots()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH lots AS (
    SELECT l.* FROM public.atelier_lots l
     WHERE l.status <> 'cancelled'
       AND EXISTS (SELECT 1 FROM public.cabedal_prep_jobs j WHERE j.lot_id = l.id AND j.pipeline_status <> 'cancelled')
  ),
  items AS (
    SELECT d.lot_id, d.id AS demand_id, d.sale_order_item_id, d.pairs, d.ready_date,
           so.id AS sale_order_id, so.order_number, so.client_name, so.billing_week,
           so.delivery_deadline,
           soi.grade, GREATEST(COALESCE(soi.fichas, 1), 1) AS fichas
      FROM public.cabedal_prep_demands d
      JOIN lots ON lots.id = d.lot_id
      JOIN public.sale_orders so ON so.id = d.sale_order_id
      JOIN public.sale_order_items soi ON soi.id = d.sale_order_item_id
     WHERE d.status <> 'cancelled'
  ),
  grade AS (
    SELECT i.lot_id, g.key AS size, SUM(COALESCE(NULLIF(g.value, '')::numeric, 0) * i.fichas) AS qty
      FROM items i CROSS JOIN LATERAL jsonb_each_text(COALESCE(i.grade, '{}'::jsonb)) g
     GROUP BY i.lot_id, g.key
  )
  SELECT COALESCE(jsonb_agg(row ORDER BY
            (row ->> 'min_delivery_deadline') NULLS LAST,
            row ->> 'reference_code',
            row ->> 'lot_number'), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'id', l.id, 'lot_number', l.lot_number, 'status', l.status, 'reference_id', l.reference_id,
        'reference_code', COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.model), ''), ts.name),
        'reference_name', ts.name, 'color', l.color, 'material_variant_id', l.material_variant_id,
        'cut_at', l.cut_at,
        'pairs', (SELECT COALESCE(SUM(i.pairs), 0) FROM items i WHERE i.lot_id = l.id),
        'min_ready_date', (SELECT MIN(i.ready_date) FROM items i WHERE i.lot_id = l.id),
        'min_delivery_deadline', (SELECT MIN(i.delivery_deadline) FROM items i WHERE i.lot_id = l.id),
        'grade', (SELECT COALESCE(jsonb_object_agg(g.size, g.qty), '{}'::jsonb) FROM grade g WHERE g.lot_id = l.id AND g.qty > 0),
        -- PARES POR PEDIDO dentro do lote. O `jsonb_agg(DISTINCT ...)` anterior
        -- só dava a identidade do PV; sem os pares não há como montar o
        -- relatório pedido → referência, porque `pairs` do lote é a soma de
        -- todos os PVs dele.
        -- ⚠ Agrupa por PEDIDO, não por job: um mesmo item pode ter job de
        -- Costura E de Aviamento, e somar os jobs dobraria os pares.
        'orders', (SELECT COALESCE(jsonb_agg(y.o ORDER BY
                      y.o ->> 'delivery_deadline' NULLS LAST, y.o ->> 'order_number'), '[]'::jsonb)
                     FROM (
                       SELECT jsonb_build_object(
                                'sale_order_id', i.sale_order_id, 'order_number', i.order_number,
                                'client_name', i.client_name, 'billing_week', i.billing_week,
                                'delivery_deadline', i.delivery_deadline,
                                'pairs', COALESCE(SUM(i.pairs), 0)) AS o
                         FROM items i
                        WHERE i.lot_id = l.id
                        GROUP BY i.sale_order_id, i.order_number, i.client_name,
                                 i.billing_week, i.delivery_deadline
                     ) y),
        'jobs', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', j.id, 'sector', j.sector, 'pipeline_status', j.pipeline_status, 'pairs', j.pairs,
                    'sale_order_item_id', j.sale_order_item_id, 'order_number', so.order_number,
                    'contractor_id', j.contractor_id, 'contractor_name', c.name,
                    'atelier_service_number', j.atelier_service_number, 'target_end', j.target_end
                  ) ORDER BY j.sector, so.order_number), '[]'::jsonb)
                   FROM public.cabedal_prep_jobs j
                   JOIN public.sale_orders so ON so.id = j.sale_order_id
                   LEFT JOIN public.contractors c ON c.id = j.contractor_id
                  WHERE j.lot_id = l.id AND j.pipeline_status <> 'cancelled'),
        'debits', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'product_id', s.product_id, 'product_name', p.name, 'unit', p.unit,
                     'component', s.component, 'required_qty', s.required_qty,
                     'quantity', s.quantity, 'pending_qty', s.pending_qty
                   ) ORDER BY p.name), '[]'::jsonb)
                    FROM public.cabedal_prep_stock_debits s
                    JOIN public.products p ON p.id = s.product_id
                   WHERE s.lot_id = l.id)
      ) AS row
      FROM lots l JOIN public.technical_sheets ts ON ts.id = l.reference_id
    ) x;
$function$;
