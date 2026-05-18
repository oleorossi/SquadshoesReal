-- =============================================================================
-- create_solo_wave idempotente — se PV já está em onda ativa, retorna ela
-- =============================================================================
--
-- 🔴 Sintoma reportado (18/05/2026): ao mover um PV pra "Em Produção" pela
--    segunda vez (ex: depois de voltar de Faturado pra Em Produção, ou em
--    reabertura de status), o trigger create_solo_wave tentava criar uma
--    onda nova mas o trigger check_sale_order_single_active_wave bloqueava
--    com "O pedido PV-XXX já está atribuído à onda ativa AUTO-YYYY-NN
--    (status: running). Finalize ou cancele a onda atual antes de incluí-lo
--    em outra." — a UI mostrava warning e o operador precisava ir
--    manualmente até Ondas pra resolver.
--
--    Caso real: PV-00115 estava na onda AUTO-2026-23 (multi-PV ainda
--    running por causa de outros PVs Em Produção). Voltar PV-00115 pra
--    Em Produção disparava o erro.
--
-- ✅ Fix: create_solo_wave faz check ANTES de tentar criar:
--    Se já existe wave ativa (status NOT IN ('finished','cancelled'))
--    vinculada ao mesmo p_sale_order_id, retorna o ID dela sem criar nada.
--    Operação vira no-op silenciosa em vez de erro.
--
--    Trigger check_sale_order_single_active_wave continua intocado — ele
--    ainda protege contra inserts manuais maliciosos no UI/SQL direto.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_solo_wave(p_sale_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_wave_id uuid;
  v_wave_id    uuid;
  v_wave_code  text;
  v_week_start date;
  v_week_end   date;
  v_order_num  text;
  v_item_id    uuid;
  v_row        RECORD;
  v_mesa_cap   int := 0;
  v_needs_palm boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  -- Idempotência: se o PV já está em uma onda ATIVA (status não finished
  -- nem cancelled), retorna o ID dela sem tentar criar nada novo. Evita
  -- conflito com check_sale_order_single_active_wave que bloquearia o
  -- insert de duplicate source. Caso comum: PV reaberto pra Em Produção
  -- ainda vinculado à onda multi-PV anterior.
  SELECT wi.wave_id INTO v_existing_wave_id
  FROM public.production_wave_item_sources s
  JOIN public.production_wave_items wi ON wi.id = s.wave_item_id
  JOIN public.production_waves pw ON pw.id = wi.wave_id
  WHERE s.sale_order_id = p_sale_order_id
    AND pw.status NOT IN ('finished', 'cancelled')
  LIMIT 1;

  IF v_existing_wave_id IS NOT NULL THEN
    RETURN v_existing_wave_id;
  END IF;

  v_week_start := date_trunc('week', current_date)::date;
  v_week_end   := v_week_start + 6;

  SELECT COALESCE(order_number, id::text) INTO v_order_num
    FROM sale_orders WHERE id = p_sale_order_id;

  v_wave_code := 'PV-' || v_order_num;

  INSERT INTO production_waves(code, week_start, week_end, status, created_by)
  VALUES (v_wave_code, v_week_start, v_week_end, 'draft', auth.uid())
  ON CONFLICT (code) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_wave_id;

  INSERT INTO production_wave_stages(wave_id, stage, status)
  SELECT v_wave_id, s::production_stage_enum, 'pending'
  FROM unnest(ARRAY['corte','costura','montagem','solagem','acabamento']) AS s
  ON CONFLICT DO NOTHING;

  SELECT EXISTS (
    SELECT 1 FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
    WHERE soi.sale_order_id = p_sale_order_id
      AND (ts.insole_ready_made IS NULL OR ts.insole_ready_made = false)
  ) INTO v_needs_palm;

  IF v_needs_palm THEN
    INSERT INTO production_wave_stages(wave_id, stage, status)
    VALUES (v_wave_id, 'palmilha', 'pending')
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT COALESCE(MAX(ts.mesa_daily_capacity), 0) INTO v_mesa_cap
    FROM sale_order_items soi
    JOIN technical_sheets ts ON ts.id = soi.reference_id
   WHERE soi.sale_order_id = p_sale_order_id
     AND ts.mesa_daily_capacity > 0;

  IF v_mesa_cap > 0 THEN
    INSERT INTO production_wave_stages(wave_id, stage, status, capacity_per_day)
    VALUES (v_wave_id, 'mesa', 'pending', v_mesa_cap)
    ON CONFLICT DO NOTHING;
  END IF;

  FOR v_row IN
    SELECT
      soi.id                                 AS source_item_id,
      so.id                                  AS sale_order_id,
      so.client_id,
      COALESCE(c.razao_social, so.id::text)  AS store_name,
      soi.reference_id,
      COALESCE(soi.color, '')                AS color,
      COALESCE(soi.quantity, 0)::numeric     AS qty,
      COALESCE(soi.grade, '{}'::jsonb)       AS grade,
      (SELECT sole_product_id
         FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color, ''))) AS sole_id
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN clients c ON c.id = so.client_id
    WHERE so.id = p_sale_order_id
  LOOP
    INSERT INTO production_wave_items(wave_id, reference_id, sole_product_id, color, total_quantity, grade)
    VALUES (v_wave_id, v_row.reference_id, v_row.sole_id, v_row.color, v_row.qty, v_row.grade)
    ON CONFLICT (wave_id, reference_id, sole_product_id, color)
    DO UPDATE SET total_quantity = production_wave_items.total_quantity + EXCLUDED.total_quantity
    RETURNING id INTO v_item_id;

    INSERT INTO production_wave_item_sources(
      wave_item_id, sale_order_id, sale_order_item_id, client_id, store_name, quantity, grade
    ) VALUES (
      v_item_id, v_row.sale_order_id, v_row.source_item_id,
      v_row.client_id, v_row.store_name, v_row.qty, v_row.grade
    );
  END LOOP;

  UPDATE production_waves SET
    total_pairs = COALESCE((SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = v_wave_id), 0),
    total_items = COALESCE((SELECT COUNT(*) FROM production_wave_items WHERE wave_id = v_wave_id), 0),
    status = 'planning'
  WHERE id = v_wave_id;

  PERFORM public.start_wave(v_wave_id);

  RETURN v_wave_id;
END;
$function$;

COMMENT ON FUNCTION public.create_solo_wave(uuid) IS
  'Cria onda dedicada pra um único PV. Idempotente: se PV já está em onda '
  'ativa (status != finished/cancelled), retorna o ID da onda existente '
  'sem criar duplicata. Evita conflito com check_sale_order_single_active_wave.';
