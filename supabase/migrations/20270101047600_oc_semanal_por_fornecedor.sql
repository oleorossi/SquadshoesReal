-- OC automática: uma por fornecedor na semana de faturamento, sempre rascunho.
-- Não envia. Não abre OS.
--
-- Quem compra o quê:
--   * napa de cabedal e componente do kit (não artesanal) → esta OC semanal;
--   * SKU de tira (is_artisanal_strap / buy_ready) → motor strap_demand, não esta OC;
--   * napa + OS do prestador da tira → só o clique
--     generate_atelier_strap_purchase_and_service. Esta função não é chamada aqui.
-- O kit do lote só debita na liberação.
--
-- Múltiplo de compra continua arredondando para cima. Mínimo de compra não
-- altera a quantidade: vira aviso no rascunho.

CREATE OR REPLACE FUNCTION public.purchase_week_start(p_sale_order_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d - (EXTRACT(ISODOW FROM d)::int - 1)
    FROM (
      SELECT COALESCE(public.resolve_billing_week_for_order(p_sale_order_id), CURRENT_DATE) AS d
    ) x;
$$;

REVOKE ALL ON FUNCTION public.purchase_week_start(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_week_start(uuid) TO authenticated, service_role;

DO $patch_weekly_oc$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.process_sale_order_purchase_shortages(uuid)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'process_sale_order_purchase_shortages ausente';
  END IF;

  IF strpos(v_def, 'purchase_week_start') > 0
     AND strpos(v_def, 'cabedal_prep_material_product_ids') = 0
     AND strpos(v_def, 'is_artisanal_strap') > 0 THEN
    RAISE NOTICE 'OC semanal já aplicada';
  ELSE
    IF strpos(v_def, 'v_is_new boolean;') = 0 THEN
      RAISE EXCEPTION 'declare de process_sale_order_purchase_shortages mudou';
    END IF;
    v_def := replace(v_def, 'v_is_new boolean;', E'v_is_new boolean;\n  v_detached uuid;');

    v_old := $old$  v_scope := public.sale_order_purchase_scope_key(p_sale_order_id);
  v_shared := v_scope LIKE 'eg:%';$old$;
    v_new := $new$  v_scope := 'week:' || to_char(public.purchase_week_start(p_sale_order_id), 'YYYY-MM-DD');
  v_shared := true;$new$;
    IF strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION 'âncora de escopo da OC não encontrada';
    END IF;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$         AND (
           NOT EXISTS (
             SELECT 1 FROM public.cabedal_prep_demands d
              WHERE d.sale_order_id = p_sale_order_id
                AND d.status <> 'cancelled'
           )
           OR need.material_id NOT IN (
             SELECT c.product_id
               FROM public.cabedal_prep_material_product_ids(p_sale_order_id) c
           )
         )$old$;
    v_new := $new$         AND NOT COALESCE(p.is_artisanal_strap, false)$new$;
    IF strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION 'exclusão do Ateliê não encontrada para trocar pela da tira artesanal';
    END IF;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$      SELECT need.*, p.min_stock, p.max_stock, p.active,
             p.category AS product_category,$old$;
    v_new := $new$      SELECT need.*, p.min_stock, p.max_stock, p.active,
             p.category AS product_category,
             p.min_order_quantity,$new$;
    IF strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION 'select de material da OC não encontrado';
    END IF;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$                 'color', NULLIF(v.color, '')
               )$old$;
    v_new := $new$                 'color', NULLIF(v.color, ''),
                 'min_order_warning', CASE
                   WHEN COALESCE(v.min_order_quantity, 0) > v.out_qty
                   THEN format(
                     'Mínimo de compra de %s é %s %s e não foi aplicado (pedido %s).',
                     v.product_name,
                     v.min_order_quantity,
                     v.out_unit,
                     trim(to_char(v.out_qty, 'FM999999990.999'))
                   )
                   ELSE NULL
                 END
               )$new$;
    IF strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION 'item da OC sem âncora de cor';
    END IF;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$          CASE WHEN v_supplier_id IS NULL THEN 'draft' ELSE 'suggested' END,$old$;
    v_new := $new$          'draft',$new$;
    IF strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION 'status suggested da OC automática não encontrado';
    END IF;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$    IF v_effect.id IS NOT NULL THEN
      v_po_id := v_effect.purchase_order_id;
    END IF;$old$;
    v_new := $new$    v_detached := NULL;
    IF v_effect.id IS NOT NULL THEN
      v_po_id := v_effect.purchase_order_id;
    END IF;
    IF v_po_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_orders po
          WHERE po.id = v_po_id
            AND po.idempotency_key = v_idem
       )
       AND public.pv_purchase_order_is_system_editable(v_po_id, false)
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_orders po
          WHERE po.idempotency_key = v_idem
       ) THEN
      UPDATE public.purchase_orders
         SET idempotency_key = v_idem,
             status = 'draft'
       WHERE id = v_po_id;
    ELSIF v_po_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.purchase_orders po
          WHERE po.id = v_po_id
            AND po.idempotency_key = v_idem
       )
       AND public.pv_purchase_order_is_system_editable(v_po_id, false) THEN
      v_detached := v_po_id;
      v_po_id := NULL;
    END IF;$new$;
    IF strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION 'carga do efeito da OC não encontrada';
    END IF;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$    PERFORM public.rebuild_pv_purchase_order_from_effects(v_po_id);$old$;
    v_new := $new$    IF v_detached IS NOT NULL AND v_detached IS DISTINCT FROM v_po_id THEN
      PERFORM public.rebuild_pv_purchase_order_from_effects(v_detached);
    END IF;
    PERFORM public.rebuild_pv_purchase_order_from_effects(v_po_id);$new$;
    IF strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION 'rebuild da OC não encontrado';
    END IF;
    v_def := replace(v_def, v_old, v_new);

    EXECUTE v_def;
  END IF;

  SELECT pg_get_functiondef('public.rebuild_pv_purchase_order_from_effects(uuid)'::regprocedure)
    INTO v_def;
  IF strpos(v_def, 'Rascunho semanal por fornecedor') = 0 THEN
    v_old := $old$         notes = CASE WHEN cardinality(v_pvs) > 1
                      THEN 'Sugestão versionada pela outbox — grupo econômico (' ||
                           cardinality(v_pvs) || ' PVs)'
                      ELSE notes END,$old$;
    v_new := $new$         status = CASE
           WHEN status IN ('draft', 'suggested') THEN 'draft'
           ELSE status
         END,
         notes = concat_ws(
           E'\n',
           'Rascunho semanal por fornecedor, para revisão. Não é enviada sozinha ('
             || cardinality(v_pvs)::text || ' PVs).',
           (
             SELECT string_agg(DISTINCT item.value ->> 'min_order_warning', E'\n')
               FROM public.sale_order_purchase_shortage_effects e
               CROSS JOIN LATERAL jsonb_array_elements(
                 CASE WHEN jsonb_typeof(e.desired_payload -> 'items') = 'array'
                      THEN e.desired_payload -> 'items' ELSE '[]'::jsonb END
               ) item(value)
              WHERE e.purchase_order_id = p_purchase_order_id
                AND e.effect_status = 'editable'
                AND NULLIF(btrim(COALESCE(item.value ->> 'min_order_warning', '')), '') IS NOT NULL
           )
         ),$new$;
    IF strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION 'notas do rebuild da OC não encontradas';
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END IF;
END;
$patch_weekly_oc$;
