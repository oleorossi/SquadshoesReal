-- =============================================================================
-- Reorder Point (ROP) automático — sugestões de compra
-- =============================================================================
-- Gap industrial P0: produtos caem abaixo de min_stock e ninguém é avisado.
-- A view v_mrp_needs mostra necessidades por OP, mas é passiva — quem não abre
-- a tela não vê. ROP industrial: ROTINA monitorando estoque vs min_stock,
-- gerando alertas/sugestões automáticas.
--
-- Esta migration:
--   1. View v_products_below_rop: produtos com (quantity - reserved_stock) ≤ min_stock
--      enriquecidos com supplier_lead_time_days e lote sugerido até max_stock.
--   2. Função public.generate_rop_purchase_suggestions() que cria entries em
--      purchase_orders (status='suggested', auto_generated=true) — uma OC por
--      fornecedor, agregando todos os produtos em ruptura desse fornecedor.
--      Idempotente: não duplica OC já existente em status='suggested'/'pending'.
--   3. pg_cron job 'rop-suggestions-daily' roda 1×/dia (06:00 horário do
--      servidor) — operador chega de manhã, abre /purchase-orders, vê
--      sugestões pra revisar/aprovar.
-- =============================================================================

-- ─── 1. View v_products_below_rop ───────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_products_below_rop AS
SELECT
  p.id AS product_id,
  p.name AS product_name,
  p.group_id,
  p.category,
  p.unit,
  p.unit_price,
  p.quantity AS stock_qty,
  COALESCE(p.reserved_stock, 0) AS reserved_stock,
  GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS available_qty,
  p.min_stock,
  p.max_stock,
  -- Quantidade sugerida = max_stock - available, com fallback min×2 se max=0
  CASE
    WHEN COALESCE(p.max_stock, 0) > 0
      THEN GREATEST(0, p.max_stock - GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)))
    ELSE GREATEST(p.min_stock, 1) * 2
  END AS suggested_qty,
  COALESCE(p.supplier_lead_time_days, 10) AS supplier_lead_days,
  -- Fornecedor default do grupo
  (SELECT gs.supplier_name FROM public.group_suppliers gs
    WHERE gs.group_id = p.group_id ORDER BY gs.updated_at DESC LIMIT 1) AS suggested_supplier,
  (SELECT gs.id FROM public.group_suppliers gs
    WHERE gs.group_id = p.group_id ORDER BY gs.updated_at DESC LIMIT 1) AS suggested_supplier_id,
  -- MOQ do grupo
  COALESCE(
    (SELECT gsm.minimum_order FROM public.group_supplier_materials gsm
      WHERE gsm.group_id = p.group_id AND gsm.active = true
      ORDER BY gsm.updated_at DESC LIMIT 1),
    1
  ) AS supplier_moq,
  -- Já tem OC ativa cobrindo este produto?
  EXISTS (
    SELECT 1 FROM public.purchase_order_items poi
    JOIN public.purchase_orders po ON po.id = poi.purchase_order_id
    WHERE poi.product_id = p.id
      AND po.status IN ('suggested', 'pending', 'approved')
  ) AS has_active_po
FROM public.products p
WHERE COALESCE(p.active, true) = true
  AND COALESCE(p.min_stock, 0) > 0
  AND GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) <= COALESCE(p.min_stock, 0);

GRANT SELECT ON public.v_products_below_rop TO authenticated;

COMMENT ON VIEW public.v_products_below_rop IS
  'Produtos com disponível (quantity - reserved_stock) ≤ min_stock. '
  'Suggested_qty = max_stock - available, fallback min×2. has_active_po '
  'sinaliza se já existe OC pendente cobrindo (evita sugestão redundante).';


-- ─── 2. Função geradora de OCs auto ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_rop_purchase_suggestions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_supplier RECORD;
  v_prod RECORD;
  v_po_id uuid;
  v_total numeric;
  v_qty numeric;
  v_created int := 0;
  v_appended int := 0;
  v_items_added int := 0;
BEGIN
  -- Agrupa produtos em ruptura por fornecedor sugerido, ignorando os que já
  -- têm OC ativa (evita criar 2× a mesma demanda).
  FOR v_supplier IN
    SELECT
      suggested_supplier_id,
      COALESCE(suggested_supplier, 'A definir') AS supplier_name
      FROM public.v_products_below_rop
     WHERE NOT has_active_po
     GROUP BY suggested_supplier_id, suggested_supplier
  LOOP
    -- Existe OC 'suggested' aberta pra esse fornecedor que possamos anexar?
    SELECT id INTO v_po_id
      FROM public.purchase_orders
     WHERE COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE(v_supplier.suggested_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
       AND status = 'suggested'
       AND auto_generated = true
       AND created_at > now() - interval '7 days' -- só consolida dentro de 1 semana
     ORDER BY created_at DESC LIMIT 1;

    IF v_po_id IS NULL THEN
      INSERT INTO public.purchase_orders (
        status, supplier_id, supplier_name, total_value, auto_generated, notes
      ) VALUES (
        'suggested',
        v_supplier.suggested_supplier_id,
        v_supplier.supplier_name,
        0,
        true,
        'Sugestão gerada automaticamente por ROP em ' || to_char(now(), 'DD/MM/YYYY HH24:MI')
        || '. Produtos com estoque ≤ min_stock — revisar e aprovar antes de enviar pro fornecedor.'
      ) RETURNING id INTO v_po_id;
      v_created := v_created + 1;
    ELSE
      v_appended := v_appended + 1;
    END IF;

    v_total := COALESCE((SELECT total_value FROM public.purchase_orders WHERE id = v_po_id), 0);

    FOR v_prod IN
      SELECT *
        FROM public.v_products_below_rop
       WHERE NOT has_active_po
         AND COALESCE(suggested_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE(v_supplier.suggested_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
    LOOP
      -- Idempotência: pula se item já existe pro mesmo product+po
      IF EXISTS (
        SELECT 1 FROM public.purchase_order_items
         WHERE purchase_order_id = v_po_id AND product_id = v_prod.product_id
      ) THEN CONTINUE; END IF;

      v_qty := GREATEST(v_prod.suggested_qty, COALESCE(v_prod.supplier_moq, 1));

      INSERT INTO public.purchase_order_items (
        purchase_order_id, product_id, current_stock,
        min_stock, max_stock,
        suggested_quantity, quantity, unit_price, unit
      ) VALUES (
        v_po_id, v_prod.product_id, v_prod.stock_qty,
        v_prod.min_stock, v_prod.max_stock,
        v_qty, v_qty, COALESCE(v_prod.unit_price, 0), v_prod.unit
      );

      v_total := v_total + v_qty * COALESCE(v_prod.unit_price, 0);
      v_items_added := v_items_added + 1;
    END LOOP;

    UPDATE public.purchase_orders SET total_value = v_total WHERE id = v_po_id;
  END LOOP;

  RETURN jsonb_build_object(
    'pos_created', v_created,
    'pos_appended', v_appended,
    'items_added', v_items_added,
    'run_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_rop_purchase_suggestions() TO authenticated;

COMMENT ON FUNCTION public.generate_rop_purchase_suggestions() IS
  'ROP automático: cria/anexa OCs suggested pra produtos com disponível '
  '≤ min_stock. Agrupa por fornecedor pra reduzir freight. Idempotente '
  '(skipa produtos já cobertos por OC ativa). Rodada via cron diário ou '
  'manualmente sob demanda. Operador revisa em /purchase-orders e aprova.';


-- ─── 3. pg_cron diário às 06:00 ─────────────────────────────────────────────
DO $$
DECLARE v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'rop-suggestions-daily';
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
END $$;

SELECT cron.schedule(
  'rop-suggestions-daily',
  '0 6 * * *', -- todo dia às 06:00 UTC (~03:00 BRT)
  $cron$ SELECT public.generate_rop_purchase_suggestions(); $cron$
);
