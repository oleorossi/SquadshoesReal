-- SPED Bloco K (Livro de Controle da Produção e do Estoque) — paridade Tutor32, fiscal #1.
--
-- Gera os registros do Bloco K a partir dos dados INTERNOS (sem provider/SEFAZ):
--   K230 — itens produzidos (OPs finalizadas no período)
--   K235 — insumos consumidos por OP (débitos de estoque 'out' vinculados à OP)
--   K200 — estoque escriturado no fim do período (reconstruído de stock_movements)
--
-- Fontes reais neste banco: orders (status='Finalizado') + technical_sheets (cód. do
-- produto acabado) + stock_movements (out por OP = consumo; new_stock = saldo).
-- production_consumptions está vazia, então o consumo vem de stock_movements.
--
-- A função retorna JSONB estruturado; o frontend monta o TXT EFD (pipe-delimited) e
-- registra a geração em sped_exports. Não transmite — a contabilidade valida no PVA.

CREATE OR REPLACE FUNCTION public.generate_bloco_k(
  p_period_start date,
  p_period_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_k230 jsonb;
  v_k200 jsonb;
BEGIN
  -- K230: produto acabado das OPs finalizadas no período, com K235 (insumos) aninhado.
  -- DT_FIN_OP usa last_sector_finished_at quando houver; senão planned_delivery; senão updated_at.
  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'dt_fin', r->>'cod_doc_op'), '[]'::jsonb) INTO v_k230
  FROM (
    SELECT jsonb_build_object(
      'cod_doc_op', o.order_number,
      'cod_item',   COALESCE(NULLIF(ts.code, ''), left(o.id::text, 8)),
      'descr',      COALESCE(ts.name, ''),
      'dt_ini',     COALESCE(o.planned_start, o.created_at::date),
      'dt_fin',     COALESCE(o.last_sector_finished_at::date, o.planned_delivery, o.updated_at::date),
      'qtd',        o.quantity,
      'insumos', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'cod_item', COALESCE(NULLIF(p.sku, ''), left(p.id::text, 8)),
                 'descr',    p.name,
                 'qtd',      s.qtd,
                 'dt_saida', s.dt
               ) ORDER BY p.name), '[]'::jsonb)
        FROM (
          SELECT sm.product_id, SUM(sm.quantity) AS qtd, MAX(sm.created_at)::date AS dt
          FROM public.stock_movements sm
          WHERE sm.order_id = o.id AND sm.movement_type = 'out'
          GROUP BY sm.product_id
        ) s
        JOIN public.products p ON p.id = s.product_id
      )
    ) AS r
    FROM public.orders o
    LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
    WHERE o.status = 'Finalizado'
      AND COALESCE(o.last_sector_finished_at::date, o.planned_delivery, o.updated_at::date)
          BETWEEN p_period_start AND p_period_end
  ) q;

  -- K200: saldo de estoque no fim do período = último new_stock de cada produto
  -- com movimento até p_period_end. IND_EST=0 (próprio em poder do informante).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'dt_est',   p_period_end,
           'cod_item', COALESCE(NULLIF(p.sku, ''), left(p.id::text, 8)),
           'descr',    p.name,
           'qtd',      last_mv.new_stock,
           'ind_est',  '0'
         ) ORDER BY p.name), '[]'::jsonb) INTO v_k200
  FROM public.products p
  JOIN LATERAL (
    SELECT sm.new_stock
    FROM public.stock_movements sm
    WHERE sm.product_id = p.id AND sm.created_at::date <= p_period_end
    ORDER BY sm.created_at DESC
    LIMIT 1
  ) last_mv ON true
  WHERE COALESCE(last_mv.new_stock, 0) <> 0;

  RETURN jsonb_build_object(
    'period_start', p_period_start,
    'period_end',   p_period_end,
    'k230', v_k230,
    'k200', v_k200
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_bloco_k(date, date) TO authenticated;
