-- Fase 5 sequencia-producao: hard-gate de fábrica no promote (R6.1 / D11).
-- Porta Ateliê unica: cabedal complexo so promove apos received_at_factory.
-- Material critico (falta de estoque) permanece Q aberta #2 — nao hard-fail aqui.

CREATE OR REPLACE FUNCTION public.sale_order_item_factory_gate_block_reason(p_item_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reference_id uuid;
  v_prep_status text;
BEGIN
  IF p_item_id IS NULL THEN
    RETURN 'item ausente';
  END IF;

  SELECT soi.reference_id INTO v_reference_id
    FROM public.sale_order_items soi
   WHERE soi.id = p_item_id;

  IF NOT FOUND THEN
    RETURN 'item nao encontrado';
  END IF;

  IF v_reference_id IS NULL THEN
    RETURN 'item sem referencia';
  END IF;

  -- Cabedal simples / fora do catalogo Ateliê: liberado.
  IF NOT EXISTS (
    SELECT 1
      FROM public.atelier_complex_references a
     WHERE a.reference_id = v_reference_id
       AND COALESCE(a.active, true)
  ) THEN
    RETURN NULL;
  END IF;

  SELECT j.pipeline_status INTO v_prep_status
    FROM public.cabedal_prep_jobs j
   WHERE j.sale_order_item_id = p_item_id
     AND COALESCE(j.pipeline_status, '') <> 'cancelled'
   ORDER BY j.updated_at DESC NULLS LAST
   LIMIT 1;

  IF v_prep_status IS NOT DISTINCT FROM 'received_at_factory' THEN
    RETURN NULL;
  END IF;

  RETURN format(
    'cabedal complexo — so libera apos recebimento do cabedal (status atual: %s)',
    COALESCE(v_prep_status, 'sem job')
  );
END;
$$;

COMMENT ON FUNCTION public.sale_order_item_factory_gate_block_reason(uuid) IS
  'Null = elegivel pra promote/liberacao de fabrica; texto = motivo de bloqueio (Ateliê D11).';

GRANT EXECUTE ON FUNCTION public.sale_order_item_factory_gate_block_reason(uuid) TO authenticated;

-- ── promote_sale_order_item: skip (nao RAISE) pra nao abortar promote atomico ─
DO $patch_promote_gate$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.promote_sale_order_item(uuid, text, text, date, boolean, text)'::regprocedure
  ) INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'promote_sale_order_item nao encontrada';
  END IF;

  IF pg_catalog.strpos(v_def, 'sale_order_item_factory_gate_block_reason') > 0 THEN
    RAISE NOTICE 'promote_sale_order_item ja tem factory gate — skip';
    RETURN;
  END IF;

  v_old := $old$IF v_item.reference_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'item sem referência');
  END IF;

  SELECT so.order_number INTO v_so_number FROM public.sale_orders so WHERE so.id = v_so_id;$old$;

  v_new := $new$IF v_item.reference_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'item sem referência');
  END IF;

  -- Porta sequencia / Ateliê (R6.1): complexo so apos received_at_factory.
  IF public.sale_order_item_factory_gate_block_reason(p_item_id) IS NOT NULL THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', public.sale_order_item_factory_gate_block_reason(p_item_id)
    );
  END IF;

  SELECT so.order_number INTO v_so_number FROM public.sale_orders so WHERE so.id = v_so_id;$new$;

  IF pg_catalog.strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Ancora promote_sale_order_item (reference_id) nao encontrada';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_promote_gate$;

-- ── release_corte_lookahead: mesma porta (RAISE — usuario escolheu o item) ───
DO $patch_release_gate$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.release_corte_lookahead_items(uuid[])'::regprocedure
  ) INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'release_corte_lookahead_items nao encontrada';
  END IF;

  IF pg_catalog.strpos(v_def, 'sale_order_item_factory_gate_block_reason') > 0 THEN
    RAISE NOTICE 'release_corte_lookahead_items ja usa factory gate — skip';
    RETURN;
  END IF;

  v_old := $old$IF EXISTS (
      SELECT 1 FROM public.atelier_complex_references a
       WHERE a.reference_id = v_item.reference_id AND COALESCE(a.active, true)
    ) THEN
      SELECT j.pipeline_status INTO v_prep_status
        FROM public.cabedal_prep_jobs j
       WHERE j.sale_order_item_id = v_item.id
         AND COALESCE(j.pipeline_status, '') <> 'cancelled'
       ORDER BY j.updated_at DESC NULLS LAST
       LIMIT 1;

      IF v_prep_status IS DISTINCT FROM 'received_at_factory' THEN
        RAISE EXCEPTION
          'Item % é cabedal complexo — só libera após recebimento do cabedal (status atual: %)',
          v_item_id, COALESCE(v_prep_status, 'sem job');
      END IF;
    END IF;$old$;

  -- Variante com quebras do arquivo 30900 (mais espacada).
  IF pg_catalog.strpos(v_def, v_old) = 0 THEN
    v_old := $old$-- Cabedal complexo: só libera Corte interno após cabedal preparado na fábrica.
    IF EXISTS (
      SELECT 1 FROM public.atelier_complex_references a
       WHERE a.reference_id = v_item.reference_id
         AND COALESCE(a.active, true)
    ) THEN
      SELECT j.pipeline_status INTO v_prep_status
        FROM public.cabedal_prep_jobs j
       WHERE j.sale_order_item_id = v_item.id
         AND COALESCE(j.pipeline_status, '') <> 'cancelled'
       ORDER BY j.updated_at DESC NULLS LAST
       LIMIT 1;

      IF v_prep_status IS DISTINCT FROM 'received_at_factory' THEN
        RAISE EXCEPTION
          'Item % é cabedal complexo — só libera após recebimento do cabedal (status atual: %)',
          v_item_id,
          COALESCE(v_prep_status, 'sem job');
      END IF;
    END IF;$old$;
  END IF;

  v_new := $new$v_prep_status := public.sale_order_item_factory_gate_block_reason(v_item.id);
    IF v_prep_status IS NOT NULL THEN
      RAISE EXCEPTION 'Item %: %', v_item_id, v_prep_status;
    END IF;$new$;

  IF pg_catalog.strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Ancora atelier em release_corte_lookahead_items nao encontrada';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_release_gate$;
