-- ============================================================================
-- 20260902121000_caixa-packaging-mode-freeze-hybrid.sql
--
-- ACHADO (auditoria motores 2026-07-01, severidade ALTA, confirmado no banco
-- vivo): o BOM das fichas técnicas carrega as DUAS caixas alternativas de
-- embalagem (CAIXA COLMEIA e CAIXA INDIVIDUAL). A função
-- filter_caixa_by_packaging_mode() já existe e é aplicada em
-- calculate_order_cost_item, compute_materials_per_pv, fn_projected_demand e
-- get_wave_material_needs — mas NÃO em freeze_technical_sheet (congela o
-- snapshot com as duas caixas) nem em hybrid_debit_stock_for_order (reserva/
-- debita as duas). Resultado: 11/11 OPs vivas com caixa tinham reserva DUPLA
-- (colmeia E individual), inflando reserved_stock e o consumo de embalagem.
--
-- FIX:
--   1. freeze_technical_sheet: deriva o packaging_mode do pedido (a função já
--      recebe p_sale_order_id — sem mudança de assinatura) e aplica
--      filter_caixa_by_packaging_mode no bom_snapshot e no
--      consumption_snapshot antes de congelar.
--   2. hybrid_debit_stock_for_order: aplica o mesmo filtro sobre v_items
--      DEPOIS de resolvido (snapshot existente, freeze novo ou fallback) —
--      cobre também snapshots ANTIGOS congelados antes deste fix, que ainda
--      contêm as duas caixas. Filtro é no-op quando o modo é NULL ou quando
--      só existe um tipo de caixa na lista (mesma semântica do filtro).
--   3. BÔNUS (mesmo dono): as duas funções agora repassam
--      sale_order_items.material_variant_id ao motor de consumo
--      (calculate_order_consumption_by_grade / calculate_order_consumption já
--      aceitam p_material_variant_id) — antes o freeze chamava o by_grade com
--      3 args e ignorava a variante do item.
--   4. Drive-by necessário nas MESMAS funções: calculate_order_consumption
--      hoje é escalar (RETURNS jsonb, delega ao by_grade). O wrap legado
--      `SELECT jsonb_agg(to_jsonb(c)) FROM calculate_order_consumption(...) c`
--      produzia array ANINHADO ([[{...}]]) no caminho sem grade — quebrando
--      jsonb_array_elements downstream e o próprio filtro de caixa. Trocado
--      por atribuição direta (verificado contra o retorno vivo da função).
--
-- REPAIR (bloco final): cancela as reservas VIVAS (status='reserved') de
-- caixa do modo errado — produto é caixa presente no BOM da ficha da OP, a OP
-- tem reserva dos DOIS tipos de caixa (evidência do processamento duplo) e o
-- tipo não casa com o packaging_mode do pedido — e ressincroniza
-- products.reserved_stock via sync_product_reserved_stock(). Dry-run no banco
-- vivo (2026-07-02): 4 reservas em 4 OPs, 1 produto (CAIXA INDIVIDUAL 11);
-- reservas já 'converted' (consumidas) NÃO são tocadas.
--
-- Idempotente: CREATE OR REPLACE (assinaturas inalteradas — ACLs preservadas)
-- + REPAIR com WHERE estrito que zera na segunda execução.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) freeze_technical_sheet — filtra caixa pelo packaging_mode do pedido e
--    repassa material_variant_id do item ao motor de consumo
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.freeze_technical_sheet(
  p_reference_id uuid,
  p_sale_order_id uuid,
  p_sale_order_item_id uuid,
  p_color text,
  p_quantity numeric,
  p_size integer DEFAULT NULL::integer,
  p_grade jsonb DEFAULT NULL::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snap_id uuid;
  v_sheet record;
  v_bom jsonb;
  v_consumption jsonb;
  v_packaging_mode text;
  v_variant_id uuid;
BEGIN
  SELECT id, name, version, primary_sole_id, sole_drives_consumption, reference_size
    INTO v_sheet
    FROM public.technical_sheets
   WHERE id = p_reference_id
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica % não encontrada', p_reference_id;
  END IF;

  -- Contexto do pedido: modo de embalagem (colmeia vs individual/master/fitilho)
  -- e variante de material do item — a função já recebe pedido e item.
  IF p_sale_order_id IS NOT NULL THEN
    SELECT packaging_mode INTO v_packaging_mode
      FROM public.sale_orders
     WHERE id = p_sale_order_id;
  END IF;

  IF p_sale_order_item_id IS NOT NULL THEN
    SELECT material_variant_id INTO v_variant_id
      FROM public.sale_order_items
     WHERE id = p_sale_order_item_id;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(sm)), '[]'::jsonb)
    INTO v_bom
    FROM public.sheet_materials sm
   WHERE sm.sheet_id = p_reference_id;

  -- Prefere cálculo por grade quando disponível — repassando a variante do item
  IF p_grade IS NOT NULL AND jsonb_typeof(p_grade) = 'object' THEN
    v_consumption := public.calculate_order_consumption_by_grade(
      p_reference_id, p_grade, p_color, v_variant_id);
  ELSE
    -- calculate_order_consumption é escalar (RETURNS jsonb array); o wrap
    -- legado jsonb_agg(to_jsonb(c)) aninhava o array e corrompia o snapshot.
    v_consumption := public.calculate_order_consumption(
      p_reference_id, p_quantity, p_color, p_size, v_variant_id);
  END IF;

  -- ACHADO caixa dupla: BOM tem as DUAS caixas alternativas. Congela apenas a
  -- caixa compatível com o packaging_mode do pedido (mesmo padrão de
  -- calculate_order_cost_item). No-op quando o modo é NULL ou há só um tipo.
  v_bom         := public.filter_caixa_by_packaging_mode(v_bom, v_packaging_mode);
  v_consumption := public.filter_caixa_by_packaging_mode(v_consumption, v_packaging_mode);

  INSERT INTO public.technical_sheet_snapshots (
    sheet_id, sale_order_id, sale_order_item_id,
    sheet_name, sheet_version, primary_sole_id, sole_drives_consumption,
    reference_size, bom_snapshot, consumption_snapshot,
    color, quantity, frozen_by
  ) VALUES (
    v_sheet.id, p_sale_order_id, p_sale_order_item_id,
    v_sheet.name, v_sheet.version, v_sheet.primary_sole_id, v_sheet.sole_drives_consumption,
    COALESCE(p_size, v_sheet.reference_size), v_bom, v_consumption,
    COALESCE(p_color, ''), p_quantity, auth.uid()
  )
  ON CONFLICT (sale_order_id, sale_order_item_id)
  DO UPDATE SET
    bom_snapshot = EXCLUDED.bom_snapshot,
    consumption_snapshot = EXCLUDED.consumption_snapshot,
    sheet_version = EXCLUDED.sheet_version,
    frozen_at = now(),
    frozen_by = auth.uid()
  RETURNING id INTO v_snap_id;

  RETURN v_snap_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.freeze_technical_sheet(uuid, uuid, uuid, text, numeric, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freeze_technical_sheet(uuid, uuid, uuid, text, numeric, integer, jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2) hybrid_debit_stock_for_order — filtra caixa pelo packaging_mode ANTES de
--    reservar/debitar (cobre snapshots antigos com as duas caixas)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hybrid_debit_stock_for_order(
  p_reference_id uuid,
  p_order_quantity numeric,
  p_color text,
  p_order_id uuid,
  p_order_grade jsonb DEFAULT NULL::jsonb,
  p_force_soft boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_pid uuid;
  v_name text;
  v_required numeric;
  v_available numeric;
  v_mode text;
  v_source text;
  v_result jsonb := '[]'::jsonb;
  v_size integer;
  v_snap_id uuid;
  v_soi_id uuid;
  v_sale_order_id uuid;
  v_product record;
  v_sole_handled_by_grade boolean;
  v_already_debited boolean;
  v_eff_grade jsonb;
  v_packaging_mode text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('hybrid_debit:' || p_order_id::text));

  SELECT EXISTS (
    SELECT 1 FROM public.material_reservations
     WHERE order_id = p_order_id
       AND status <> 'cancelled'
  ) INTO v_already_debited;

  IF v_already_debited THEN
    RETURN jsonb_build_object('snapshot_id', NULL, 'items', '[]'::jsonb, 'idempotent_skip', true);
  END IF;

  v_sole_handled_by_grade := (p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object');

  v_eff_grade := CASE WHEN v_sole_handled_by_grade THEN public.scale_grade_to_total(p_order_grade, p_order_quantity) ELSE p_order_grade END;

  v_size := NULL;
  IF v_sole_handled_by_grade THEN
    SELECT split_part(key, '/', 1)::integer INTO v_size
      FROM jsonb_each_text(v_eff_grade)
     WHERE key ~ '^[0-9]+(/[0-9]+)?$'
     ORDER BY value::numeric DESC
     LIMIT 1;
  END IF;

  SELECT sale_order_id INTO v_sale_order_id FROM public.orders WHERE id = p_order_id;

  -- Modo de embalagem do pedido (colmeia vs individual/master/fitilho) — usado
  -- pra descartar a caixa alternativa do BOM antes de reservar/debitar.
  IF v_sale_order_id IS NOT NULL THEN
    SELECT packaging_mode INTO v_packaging_mode
      FROM public.sale_orders
     WHERE id = v_sale_order_id;
  END IF;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT id INTO v_soi_id
      FROM public.sale_order_items
     WHERE sale_order_id = v_sale_order_id
       AND reference_id = p_reference_id
       AND COALESCE(color,'') = COALESCE(p_color,'')
     LIMIT 1;
  END IF;

  IF v_sale_order_id IS NOT NULL THEN
    SELECT consumption_snapshot, id INTO v_items, v_snap_id
      FROM public.technical_sheet_snapshots
     WHERE sale_order_id = v_sale_order_id
       AND (sale_order_item_id IS NOT DISTINCT FROM v_soi_id)
     LIMIT 1;
  END IF;

  IF v_items IS NULL THEN
    IF v_sale_order_id IS NOT NULL THEN
      -- freeze_technical_sheet deriva packaging_mode + material_variant_id do
      -- próprio pedido/item e já congela o snapshot filtrado.
      v_snap_id := public.freeze_technical_sheet(
        p_reference_id, v_sale_order_id, v_soi_id, p_color, p_order_quantity, v_size, v_eff_grade
      );
      SELECT consumption_snapshot INTO v_items
        FROM public.technical_sheet_snapshots WHERE id = v_snap_id;
    ELSE
      -- Sem PV vinculado não há item ⇒ sem variante de material a repassar.
      IF v_sole_handled_by_grade THEN
        v_items := public.calculate_order_consumption_by_grade(p_reference_id, v_eff_grade, p_color, NULL);
      ELSE
        -- calculate_order_consumption é escalar (RETURNS jsonb array); o wrap
        -- legado jsonb_agg(to_jsonb(c)) aninhava o array ([[...]]).
        v_items := public.calculate_order_consumption(p_reference_id, p_order_quantity, p_color, v_size, NULL);
      END IF;
    END IF;
  END IF;

  -- ACHADO caixa dupla: snapshots antigos (congelados antes do fix no freeze)
  -- ainda contêm as DUAS caixas alternativas do BOM. Filtrar na leitura
  -- garante que reserva/débito processem só a caixa do packaging_mode do
  -- pedido. No-op quando modo é NULL ou só há um tipo de caixa na lista.
  v_items := public.filter_caixa_by_packaging_mode(v_items, v_packaging_mode);

  IF NOT p_force_soft THEN
    FOR v_item IN
      SELECT value FROM jsonb_array_elements(v_items) AS value
       ORDER BY value ->> 'product_id'
    LOOP
      IF (v_item ->> 'matched_by') = 'color_mismatch' THEN
        CONTINUE;
      END IF;

      v_pid    := (v_item ->> 'product_id')::uuid;
      v_source := v_item ->> 'source';

      IF v_sole_handled_by_grade AND v_source = 'primary_sole' THEN
        CONTINUE;
      END IF;

      SELECT id, quantity, name INTO v_product
        FROM public.products WHERE id = v_pid FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Produto % do snapshot não encontrado', v_pid;
      END IF;

      v_required := (v_item ->> 'required')::numeric;
      IF v_product.quantity < v_required AND (v_item ->> 'debit_mode') = 'hard' THEN
        RAISE EXCEPTION
          'Estoque insuficiente para % "%": disponível %, necessário %',
          v_item ->> 'component', v_product.name, v_product.quantity, v_required;
      END IF;
    END LOOP;
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(v_items) AS value
     ORDER BY value ->> 'product_id'
  LOOP
    v_pid    := (v_item ->> 'product_id')::uuid;
    v_name   := v_item ->> 'product_name';
    v_required := (v_item ->> 'required')::numeric;
    v_mode   := v_item ->> 'debit_mode';
    v_source := v_item ->> 'source';

    IF (v_item ->> 'matched_by') = 'color_mismatch' THEN
      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name, 'required', v_required,
        'type', 'skipped_color_not_registered',
        'component', v_item ->> 'component', 'color', p_color);
      CONTINUE;
    END IF;

    SELECT quantity INTO v_available FROM public.products WHERE id = v_pid;

    IF v_sole_handled_by_grade AND v_source = 'primary_sole' THEN
      IF p_force_soft THEN
        v_result := v_result || jsonb_build_object(
          'product_id', v_pid, 'product_name', v_name,
          'required', v_required, 'type', 'sole_deferred_to_grade_soft'
        );
        CONTINUE;
      END IF;

      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft',
              jsonb_build_object('kind', 'sole_pending_grade', 'component', v_item->>'component'));

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'sole_deferred_to_grade'
      );
      CONTINUE;
    END IF;

    IF p_force_soft OR v_mode = 'soft' THEN
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_pid, v_required, 0, 'reserved', 'soft',
              jsonb_build_object(
                'kind', 'component',
                'component', v_item->>'component',
                'source', v_source,
                'color', p_color
              ));

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'reserved'
      );
    ELSE
      UPDATE public.products
         SET quantity = GREATEST(0, quantity - v_required), updated_at = now()
       WHERE id = v_pid;

      INSERT INTO public.stock_movements
        (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
      VALUES
        (v_pid, 'out', v_required, v_available, v_available - v_required,
         'Débito OP ' || COALESCE(v_name,'') ||
         CASE WHEN COALESCE(p_color,'') <> '' THEN ' Cor: ' || p_color ELSE '' END, p_order_id);

      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_pid, v_required, v_required, 'consumed', 'hard',
              jsonb_build_object('kind', 'component', 'component', v_item->>'component'));

      v_result := v_result || jsonb_build_object(
        'product_id', v_pid, 'product_name', v_name,
        'required', v_required, 'type', 'debited'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('snapshot_id', v_snap_id, 'items', v_result, 'force_soft', p_force_soft);
END;
$function$;

REVOKE ALL ON FUNCTION public.hybrid_debit_stock_for_order(uuid, numeric, text, uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hybrid_debit_stock_for_order(uuid, numeric, text, uuid, jsonb, boolean) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3) REPAIR — cancela reservas VIVAS de caixa do modo errado e ressincroniza
--    products.reserved_stock
--
-- Espelha a semântica de filter_caixa_by_packaging_mode: só age quando a OP
-- tem reservas de caixa de ≥ 2 tipos E o tipo-alvo (do packaging_mode do
-- pedido) está entre elas — evidência do processamento duplo. Reservas já
-- consumidas ('converted'/'consumed') NÃO são tocadas: cancelar o registro
-- não devolveria estoque e falsearia o histórico.
-- Dry-run 2026-07-02 no banco vivo: 4 reservas / 4 OPs / 1 produto.
-- ----------------------------------------------------------------------------
DO $repair$
DECLARE
  v_res_ids   uuid[];
  v_prod_ids  uuid[];
  v_cancelled integer := 0;
  v_pid       uuid;
BEGIN
  WITH caixa_res AS (
    SELECT mr.id,
           mr.order_id,
           mr.product_id,
           mr.status,
           public.caixa_collective_type(pr.name)                    AS box_type,
           public.packaging_mode_collective_type(so.packaging_mode) AS target_type,
           EXISTS (
             SELECT 1
               FROM public.sheet_materials sm
              WHERE sm.sheet_id   = o.reference_id
                AND sm.product_id = mr.product_id
           ) AS caixa_no_bom
      FROM public.material_reservations mr
      JOIN public.products    pr ON pr.id = mr.product_id
      JOIN public.orders      o  ON o.id  = mr.order_id
      JOIN public.sale_orders so ON so.id = o.sale_order_id
     WHERE mr.status <> 'cancelled'
       AND so.packaging_mode IS NOT NULL
       AND public.caixa_collective_type(pr.name) IS NOT NULL
  ),
  elegiveis AS (
    -- OPs com evidência de processamento duplo: ≥ 2 tipos de caixa reservados
    -- e o tipo-alvo presente (mesma condição de disparo do filtro).
    SELECT order_id
      FROM caixa_res
     GROUP BY order_id
    HAVING count(DISTINCT box_type) >= 2
       AND bool_or(box_type = target_type)
  )
  SELECT array_agg(cr.id), array_agg(DISTINCT cr.product_id)
    INTO v_res_ids, v_prod_ids
    FROM caixa_res cr
    JOIN elegiveis e ON e.order_id = cr.order_id
   WHERE cr.status = 'reserved'          -- só reservas VIVAS (não consumidas)
     AND cr.box_type <> cr.target_type   -- caixa do modo errado
     AND cr.caixa_no_bom;                -- e que veio do BOM da ficha da OP

  IF v_res_ids IS NULL THEN
    RAISE NOTICE 'REPAIR caixa/packaging_mode: nenhuma reserva viva de caixa do modo errado — nada a fazer.';
    RETURN;
  END IF;

  UPDATE public.material_reservations
     SET status     = 'cancelled',
         updated_at = now(),
         notes      = CASE
                        WHEN COALESCE(notes, '') = ''
                        THEN 'repair 20260902120000: caixa alternativa do modo errado (reserva dupla colmeia+individual)'
                        ELSE notes || ' | repair 20260902120000: caixa alternativa do modo errado (reserva dupla colmeia+individual)'
                      END
   WHERE id = ANY (v_res_ids)
     AND status = 'reserved';

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  RAISE NOTICE 'REPAIR caixa/packaging_mode: % reserva(s) cancelada(s) em % produto(s) de caixa.',
    v_cancelled, COALESCE(array_length(v_prod_ids, 1), 0);

  -- reserved_stock é derivado — ressincroniza cada produto afetado
  -- (UPDATE em material_reservations não é coberto pelo trigger de INSERT).
  FOREACH v_pid IN ARRAY v_prod_ids LOOP
    PERFORM public.sync_product_reserved_stock(v_pid);
  END LOOP;
END
$repair$;
