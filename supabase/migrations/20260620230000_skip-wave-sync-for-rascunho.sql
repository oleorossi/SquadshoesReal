-- Bug: ao criar/editar itens de um PV em Rascunho, o trigger
-- trg_sync_wave_on_sale_order_items chamava sync_sale_order_wave_items
-- → auto_assign_sale_order_to_wave → INSERT em production_wave_item_sources
-- → trg_fn_block_rascunho_wave_assignment lança exceção e o INSERT do
-- sale_order_items é abortado. PV fica num loop: não salva, não deleta.
--
-- Fix: sync_sale_order_wave_items checa o status do PV no início e retorna
-- silenciosamente quando status ∉ ('Aprovado','Em Produção'). A guard
-- continua válida pra proteger ondas contra atribuições inválidas vindas
-- de outros caminhos; só ajustamos o caller automático pra não disparar
-- o guard com Rascunho/Faturado/Cancelado.

CREATE OR REPLACE FUNCTION public.sync_sale_order_wave_items(p_sale_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so_status text;
  v_current_wave_id uuid;
  v_current_wave_status text;
  v_current_wave_start date;
  v_target_week_start date;
  v_row RECORD;
  v_item_id uuid;
  v_orphan RECORD;
BEGIN
  -- 0) Guard: só sincroniza PVs aprovados/em produção. Rascunho/Faturado/
  -- Cancelado não devem tocar em ondas (caso contrário a guard
  -- trg_fn_block_rascunho_wave_assignment aborta o INSERT do item).
  SELECT status INTO v_so_status FROM sale_orders WHERE id = p_sale_order_id;
  IF v_so_status IS NULL OR v_so_status NOT IN ('Aprovado','Em Produção') THEN
    RETURN;
  END IF;

  v_target_week_start := resolve_billing_week_for_order(p_sale_order_id);

  SELECT pwi.wave_id, pw.status::text, pw.week_start
    INTO v_current_wave_id, v_current_wave_status, v_current_wave_start
    FROM production_wave_item_sources pwis
    JOIN production_wave_items pwi ON pwi.id = pwis.wave_item_id
    JOIN production_waves pw ON pw.id = pwi.wave_id
   WHERE pwis.sale_order_id = p_sale_order_id
     AND pw.status::text NOT IN ('cancelled','finished')
   LIMIT 1;

  IF v_current_wave_id IS NOT NULL AND v_target_week_start IS NOT NULL AND v_current_wave_start != v_target_week_start THEN
    IF v_current_wave_status IN ('draft','planning') THEN
      DELETE FROM production_wave_item_sources
       WHERE sale_order_id = p_sale_order_id
         AND wave_item_id IN (SELECT id FROM production_wave_items WHERE wave_id = v_current_wave_id);

      UPDATE production_wave_items pwi
         SET total_quantity = COALESCE((
            SELECT SUM(quantity) FROM production_wave_item_sources WHERE wave_item_id = pwi.id
         ), 0)
       WHERE pwi.wave_id = v_current_wave_id;

      DELETE FROM production_wave_items pwi
       WHERE pwi.wave_id = v_current_wave_id
         AND NOT EXISTS (SELECT 1 FROM production_wave_item_sources WHERE wave_item_id = pwi.id);

      UPDATE production_waves w SET
        total_pairs = COALESCE((SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = w.id),0),
        total_items = COALESCE((SELECT COUNT(*) FROM production_wave_items WHERE wave_id = w.id),0),
        updated_at = now()
      WHERE w.id = v_current_wave_id;

      v_current_wave_id := NULL;
    END IF;
  END IF;

  IF v_current_wave_id IS NULL THEN
    IF v_target_week_start IS NOT NULL THEN
      PERFORM auto_assign_sale_order_to_wave(p_sale_order_id);
    END IF;
    RETURN;
  END IF;

  FOR v_orphan IN
    SELECT pwis.id AS source_id, pwis.wave_item_id
      FROM production_wave_item_sources pwis
     WHERE pwis.sale_order_id = p_sale_order_id
       AND NOT EXISTS (
         SELECT 1 FROM sale_order_items soi
          WHERE soi.id = pwis.sale_order_item_id
       )
  LOOP
    DELETE FROM production_wave_item_sources WHERE id = v_orphan.source_id;
  END LOOP;

  FOR v_row IN
    SELECT
      soi.id AS source_item_id,
      so.id AS sale_order_id,
      so.client_id,
      COALESCE(c.razao_social, so.id::text) AS store_name,
      soi.reference_id,
      COALESCE(soi.color,'') AS color,
      COALESCE(soi.quantity,0)::numeric AS qty,
      COALESCE(soi.grade,'{}'::jsonb) AS grade,
      (SELECT sole_product_id FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color,''))) AS sole_id
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN clients c ON c.id = so.client_id
   WHERE so.id = p_sale_order_id
  LOOP
    INSERT INTO production_wave_items(wave_id, reference_id, sole_product_id, color, total_quantity, grade)
    VALUES (v_current_wave_id, v_row.reference_id, v_row.sole_id, v_row.color, 0, v_row.grade)
    ON CONFLICT (wave_id, reference_id, sole_product_id, color)
    DO UPDATE SET grade = EXCLUDED.grade
    RETURNING id INTO v_item_id;

    IF v_item_id IS NULL THEN
      SELECT id INTO v_item_id FROM production_wave_items
       WHERE wave_id = v_current_wave_id
         AND reference_id = v_row.reference_id
         AND COALESCE(sole_product_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_row.sole_id, '00000000-0000-0000-0000-000000000000'::uuid)
         AND color = v_row.color
       LIMIT 1;
    END IF;

    INSERT INTO production_wave_item_sources(
      wave_item_id, sale_order_id, sale_order_item_id, client_id, store_name, quantity, grade
    ) VALUES (
      v_item_id, v_row.sale_order_id, v_row.source_item_id, v_row.client_id, v_row.store_name,
      v_row.qty, v_row.grade
    )
    ON CONFLICT (wave_item_id, sale_order_id, sale_order_item_id) DO UPDATE SET
      quantity = EXCLUDED.quantity,
      grade = EXCLUDED.grade,
      store_name = EXCLUDED.store_name;
  END LOOP;

  UPDATE production_wave_items pwi
     SET total_quantity = COALESCE((
        SELECT SUM(quantity) FROM production_wave_item_sources WHERE wave_item_id = pwi.id
     ),0)
   WHERE pwi.wave_id = v_current_wave_id;

  DELETE FROM production_wave_items pwi
   WHERE pwi.wave_id = v_current_wave_id
     AND NOT EXISTS (SELECT 1 FROM production_wave_item_sources WHERE wave_item_id = pwi.id);

  UPDATE production_waves w SET
    total_pairs = COALESCE((SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = w.id),0),
    total_items = COALESCE((SELECT COUNT(*) FROM production_wave_items WHERE wave_id = w.id),0),
    updated_at = now()
  WHERE w.id = v_current_wave_id;
END;
$function$;

-- auto_assign_sale_order_to_wave também é exposto via PostgREST/repair —
-- adicionamos o mesmo guard pra evitar que callers manuais (ou jobs de
-- repair) tentem atribuir um Rascunho.
CREATE OR REPLACE FUNCTION public.auto_assign_sale_order_to_wave(p_sale_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so_status text;
  v_week_start date;
  v_week_end date;
  v_code text;
  v_wave_id uuid;
  v_row RECORD;
  v_item_id uuid;
  v_already_in uuid;
BEGIN
  SELECT status INTO v_so_status FROM sale_orders WHERE id = p_sale_order_id;
  IF v_so_status IS NULL OR v_so_status NOT IN ('Aprovado','Em Produção') THEN
    RETURN NULL;
  END IF;

  v_week_start := resolve_billing_week_for_order(p_sale_order_id);
  IF v_week_start IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT pwi.wave_id INTO v_already_in
    FROM production_wave_item_sources pwis
    JOIN production_wave_items pwi ON pwi.id = pwis.wave_item_id
    JOIN production_waves pw ON pw.id = pwi.wave_id
   WHERE pwis.sale_order_id = p_sale_order_id
     AND pw.status::text NOT IN ('cancelled','finished')
   LIMIT 1;

  IF v_already_in IS NOT NULL THEN
    RETURN v_already_in;
  END IF;

  v_week_end := v_week_start + 6;
  v_code := 'W' || to_char(v_week_start, 'IYYY-IW');

  INSERT INTO production_waves(code, week_start, week_end, status, created_by)
  VALUES (v_code, v_week_start, v_week_end, 'draft', auth.uid())
  ON CONFLICT (code) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_wave_id;

  IF v_wave_id IS NULL THEN
    SELECT id INTO v_wave_id FROM production_waves WHERE code = v_code;
  END IF;

  INSERT INTO production_wave_stages(wave_id, stage, status)
  SELECT v_wave_id, s::production_stage_enum, 'pending'
  FROM unnest(ARRAY['corte','costura','montagem','solagem','acabamento']) AS s
  ON CONFLICT DO NOTHING;

  FOR v_row IN
    SELECT
      soi.id AS source_item_id,
      so.id AS sale_order_id,
      so.client_id,
      COALESCE(c.razao_social, so.id::text) AS store_name,
      soi.reference_id,
      COALESCE(soi.color,'') AS color,
      COALESCE(soi.quantity,0)::numeric AS qty,
      COALESCE(soi.grade,'{}'::jsonb) AS grade,
      (SELECT sole_product_id FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color,''))) AS sole_id
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
      v_item_id, v_row.sale_order_id, v_row.source_item_id, v_row.client_id, v_row.store_name,
      v_row.qty, v_row.grade
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  UPDATE production_waves w SET
    total_pairs = COALESCE((SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = w.id),0),
    total_items = COALESCE((SELECT COUNT(*) FROM production_wave_items WHERE wave_id = w.id),0),
    status = CASE WHEN status::text = 'draft' THEN 'planning' ELSE status END
  WHERE w.id = v_wave_id;

  RETURN v_wave_id;
END;
$function$;
