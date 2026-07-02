-- ============================================================================
-- Tiras (SQL): warnings de cor vazia / consumo zero + comentário da fração exata
-- ============================================================================
-- Auditoria dos motores de consumo/compras/débito (2026-07-01), achados
-- confirmados no banco vivo:
--
-- (a) ALTA — tira com cor VAZIA era skip 100% SILENCIOSO.
--     order_strap_needs e debit_strap_stock faziam
--     `IF v_group_id IS NULL OR v_color IS NULL OR v_color = '' THEN CONTINUE`:
--     débito 0, custo 0, compra 0 — enquanto o modal TS de Consumo de Materiais
--     (src/lib/strapConsumption.ts, referência canônica) mostra o consumo.
--     Caso vivo: PV-00141, ~430 m de tira "fantasma" (consumo exibido, nada
--     debitado/custeado/comprado, sem nenhum aviso).
--     FIX (mantém o NÃO-débito — não inventamos cor):
--       • order_strap_needs: em vez de CONTINUE, emite linha de warning no
--         padrão "tira não cadastrada" já existente (product_id NULL,
--         resolved=false, required_m calculado). O caller calculate_order_cost_item
--         já transforma linhas assim em warning 'strap_color_not_registered:…'
--         (exibido no MarginDialog); compras/MRP (compute_materials_per_pv,
--         get_wave_material_needs) filtram product_id IS NOT NULL e seguem
--         inalterados.
--       • debit_strap_stock: registra a pendência como ANOTAÇÃO na OP
--         (orders.notes, prefixo "⚠", idempotente — mesmo espírito da anotação
--         "⚠ Faturado SEM baixar estoque (falta)" usada pra falta de estoque)
--         + RAISE WARNING pros logs. O débito daquela tira continua NÃO
--         acontecendo.
--
-- (b) BAIXA — piso inventado de 1 cm/par.
--     Ambas faziam `v_consumption := COALESCE(consumption, 1); IF <= 0 THEN 1`,
--     inventando consumo que o TS mostra como 0 (calculateStrapConsumptionCm
--     usa `Number(strap.consumption) || 0`).
--     FIX: consumo nulo/≤0 vale 0. Se não há NENHUMA config (nem escalar > 0,
--     nem consumption_per_size com valor > 0) e a OP tem quantidade > 0, a tira
--     é PULADA com warning (mesmo mecanismo do item a: linha resolved=false em
--     order_strap_needs; anotação da OP em debit_strap_stock). Se há config mas
--     o resultado é 0 (ex.: quantidade 0), mantém o skip silencioso de antes.
--
-- (c) BAIXA — comentário defasado em calculate_order_cost_item dizia
--     "fichas=ceil(qty/grade)", mas o motor usa FRAÇÃO EXATA
--     (fichas = qty/grade_total, sem ceil) via order_strap_needs desde
--     2026-07-01. FIX: função recriada IDÊNTICA ao def vivo, trocando só os
--     comentários do bloco de tiras (nada no corpo contradiz a fração exata:
--     required_m entra sem v_qty_multiplier porque já é o total pra qty real).
--
-- Base das edições: pg_get_functiondef das funções VIVAS em produção
-- (ssvxfoybzmjlypnipqzn, 2026-07-02) — NÃO os arquivos antigos do repo.
-- check_stock_availability tem a mesma lógica inline mas é de outro dono —
-- intocada aqui.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. order_strap_needs — linhas de warning p/ cor vazia (a) e consumo zero (b)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.order_strap_needs(p_strap_colors jsonb, p_order_quantity numeric, p_order_grade jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(product_id uuid, product_name text, color text, group_id uuid, required_m numeric, resolved boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_strap jsonb; v_group_id uuid; v_color text; v_color_norm text;
  v_pid uuid; v_pname text; v_per_size jsonb; v_consumption numeric;
  v_size text; v_pairs numeric; v_cm_per_pair numeric; v_total_cm numeric;
  v_grade_total numeric; v_fichas numeric; v_required numeric;
  v_label text; v_has_config boolean;
BEGIN
  IF p_strap_colors IS NULL OR jsonb_typeof(p_strap_colors) <> 'array'
     OR jsonb_array_length(p_strap_colors) = 0 THEN
    RETURN;
  END IF;
  FOR v_strap IN SELECT value FROM jsonb_array_elements(p_strap_colors) AS value
  LOOP
    v_color := v_strap ->> 'color';
    BEGIN v_group_id := (v_strap ->> 'group_id')::uuid; EXCEPTION WHEN OTHERS THEN v_group_id := NULL; END;
    -- Entrada sem grupo: não há material rastreável (registro legado/quebrado) →
    -- mantém o skip. O achado (a) é sobre cor vazia com grupo VÁLIDO.
    IF v_group_id IS NULL THEN CONTINUE; END IF;

    v_label := COALESCE(NULLIF(trim(v_strap ->> 'label'), ''), 'Tira');
    v_per_size := v_strap -> 'consumption_per_size';

    -- Achado (b): SEM piso inventado de 1 cm/par. Consumo nulo/≤0 vale 0,
    -- em paridade com o modal TS (calculateStrapConsumptionCm → `|| 0`).
    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 0);
    IF v_consumption < 0 THEN v_consumption := 0; END IF;
    v_has_config := v_consumption > 0
      OR (v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
          AND EXISTS (SELECT 1 FROM jsonb_each_text(v_per_size) ps
                       WHERE COALESCE((ps.value)::numeric, 0) > 0));

    IF v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      v_total_cm := 0; v_grade_total := 0;
      FOR v_size, v_pairs IN SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        v_cm_per_pair := COALESCE((v_per_size ->> v_size)::numeric, v_consumption);
        v_total_cm := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;
      -- FRAÇÃO EXATA (2026-07-01): fichas = qty/grade_total, SEM ceil.
      IF v_grade_total > 0 THEN v_fichas := (p_order_quantity::numeric / v_grade_total);
      ELSE v_fichas := 1; END IF;
      v_required := (v_total_cm * v_fichas) / 100;
    ELSE
      v_required := (v_consumption * p_order_quantity) / 100;
    END IF;

    IF v_required <= 0 THEN
      -- Achado (b): consumo não configurado → linha de warning (resolved=false)
      -- em vez de sumir em silêncio. required_m=0 mantém a linha fora do custeio
      -- e das compras (que filtram required_m > 0 / product_id NOT NULL); ela
      -- serve de sinal pra diagnóstico e callers que leem `resolved`.
      IF p_order_quantity > 0 AND NOT v_has_config THEN
        product_id := NULL;
        product_name := v_label || ' (sem consumo configurado)';
        color := COALESCE(v_color, '');
        group_id := v_group_id; required_m := 0; resolved := false;
        RETURN NEXT;
      END IF;
      CONTINUE;
    END IF;

    -- Achado (a): cor VAZIA → NÃO resolve produto (não inventa cor), mas emite
    -- linha de warning no padrão "tira não cadastrada": product_id NULL +
    -- resolved=false + required_m calculado. Assim o consumo fantasma aparece
    -- no warning 'strap_color_not_registered:…' do custeio em vez de sumir.
    -- O campo color leva o label pra mensagem do caller ficar legível.
    IF v_color IS NULL OR v_color = '' THEN
      product_id := NULL;
      product_name := v_label || ' (sem cor definida no PV)';
      color := v_label || ' (sem cor)';
      group_id := v_group_id; required_m := v_required; resolved := false;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_color_norm := lower(trim(unaccent(v_color)));
    SELECT p.id, p.name INTO v_pid, v_pname FROM public.products p
     WHERE p.active = true AND p.group_id = v_group_id
       AND lower(trim(unaccent(p.color))) = v_color_norm LIMIT 1;
    IF v_pid IS NULL THEN
      SELECT p.id, p.name INTO v_pid, v_pname FROM public.products p
       WHERE p.active = true AND p.group_id = v_group_id
         AND (p.color IS NULL OR trim(p.color) = '') LIMIT 1;
    END IF;
    product_id := v_pid; product_name := v_pname; color := v_color;
    group_id := v_group_id; required_m := v_required; resolved := (v_pid IS NOT NULL);
    RETURN NEXT;
  END LOOP;
END;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. debit_strap_stock — anota a OP quando pula tira (cor vazia / consumo zero)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.debit_strap_stock(p_strap_colors jsonb, p_order_quantity integer, p_order_id uuid DEFAULT NULL::uuid, p_order_grade jsonb DEFAULT NULL::jsonb, p_force_soft boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_strap jsonb;
  v_group_id uuid;
  v_color text;
  v_color_norm text;
  v_product_id uuid;
  v_product_name text;
  v_product_color text;
  v_current_qty numeric;
  v_required numeric;
  v_consumption numeric;
  v_per_size jsonb;
  v_size text;
  v_pairs numeric;
  v_cm_per_pair numeric;
  v_total_cm numeric;
  v_grade_total numeric;
  v_fichas numeric;
  v_lock_key bigint;
  v_label text;
  v_has_config boolean;
  v_warn text;
  v_warnings text[] := ARRAY[]::text[];
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Unauthorized: user not approved';
  END IF;

  IF p_strap_colors IS NULL OR jsonb_typeof(p_strap_colors) != 'array' OR jsonb_array_length(p_strap_colors) = 0 THEN
    RETURN;
  END IF;

  IF p_order_id IS NOT NULL THEN
    v_lock_key := ('x' || substr(md5('debit_strap:' || p_order_id::text), 1, 16))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    IF NOT p_force_soft AND EXISTS (
      SELECT 1 FROM public.stock_movements
       WHERE order_id = p_order_id
         AND movement_type = 'out'
         AND description LIKE 'Debito Tira%'
    ) THEN
      RETURN;
    END IF;

    IF p_force_soft AND EXISTS (
      SELECT 1 FROM public.material_reservations
       WHERE order_id = p_order_id
         AND status = 'reserved'
         AND (metadata ->> 'kind') = 'strap'
    ) THEN
      RETURN;
    END IF;
  END IF;

  FOR v_strap IN SELECT value FROM jsonb_array_elements(p_strap_colors) AS value
  LOOP
    v_color := v_strap ->> 'color';

    BEGIN
      v_group_id := (v_strap ->> 'group_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_group_id := NULL;
    END;

    -- Entrada sem grupo: não há material rastreável → mantém o skip.
    IF v_group_id IS NULL THEN
      CONTINUE;
    END IF;

    v_label := COALESCE(NULLIF(trim(v_strap ->> 'label'), ''), 'Tira');
    v_per_size := v_strap -> 'consumption_per_size';

    -- Achado (b): SEM piso inventado de 1 cm/par (paridade com o modal TS).
    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 0);
    IF v_consumption < 0 THEN v_consumption := 0; END IF;
    v_has_config := v_consumption > 0
      OR (v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
          AND EXISTS (SELECT 1 FROM jsonb_each_text(v_per_size) ps
                       WHERE COALESCE((ps.value)::numeric, 0) > 0));

    IF v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      v_total_cm := 0;
      v_grade_total := 0;

      FOR v_size, v_pairs IN SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        v_cm_per_pair := COALESCE((v_per_size ->> v_size)::numeric, v_consumption);
        v_total_cm := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;

      -- FRAÇÃO EXATA (2026-07-01): fichas = qty/grade_total, SEM ceil.
      IF v_grade_total > 0 THEN
        v_fichas := (p_order_quantity::numeric / v_grade_total);
      ELSE
        v_fichas := 1;
      END IF;

      v_required := (v_total_cm * v_fichas) / 100;
    ELSE
      v_required := (v_consumption * p_order_quantity) / 100;
    END IF;

    IF v_required <= 0 THEN
      -- Achado (b): consumo não configurado → pula COM warning (anotação na OP),
      -- em vez de debitar 1 cm/par inventado ou sumir em silêncio.
      IF p_order_quantity > 0 AND NOT v_has_config THEN
        v_warn := '⚠ Tira "' || v_label || '"'
          || CASE WHEN COALESCE(trim(v_color), '') <> '' THEN ' (cor: ' || v_color || ')' ELSE '' END
          || ' sem consumo configurado (cm/par) — estoque NÃO debitado. Cadastre o consumo na ficha técnica e reprocesse o débito.';
        RAISE WARNING '[debit_strap_stock] OP %: %', p_order_id, v_warn;
        v_warnings := array_append(v_warnings, v_warn);
      END IF;
      CONTINUE;
    END IF;

    -- Achado (a): cor VAZIA → mantém o NÃO-débito (não inventamos cor), mas
    -- registra a pendência como anotação na OP em vez do skip silencioso que
    -- deixava consumo fantasma (caso PV-00141, ~430 m exibidos e 0 debitados).
    IF v_color IS NULL OR v_color = '' THEN
      v_warn := '⚠ Tira "' || v_label || '" sem cor definida no PV — estoque NÃO debitado ('
        || round(v_required, 2) || ' m pendentes). Defina a cor da tira no item do PV e reprocesse o débito.';
      RAISE WARNING '[debit_strap_stock] OP %: %', p_order_id, v_warn;
      v_warnings := array_append(v_warnings, v_warn);
      CONTINUE;
    END IF;

    v_color_norm := lower(trim(unaccent(v_color)));

    SELECT p.id, p.name, p.quantity, p.color
    INTO v_product_id, v_product_name, v_current_qty, v_product_color
    FROM public.products p
    WHERE p.active = true
      AND p.group_id = v_group_id
      AND lower(trim(unaccent(p.color))) = v_color_norm
    LIMIT 1
    FOR UPDATE;

    IF v_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity, p.color
      INTO v_product_id, v_product_name, v_current_qty, v_product_color
      FROM public.products p
      WHERE p.active = true
        AND p.group_id = v_group_id
        AND (p.color IS NULL OR trim(p.color) = '')
      LIMIT 1
      FOR UPDATE;
    END IF;

    IF v_product_id IS NULL THEN
      DECLARE v_wrong_name text; v_wrong_color text;
      BEGIN
        SELECT p.name, p.color INTO v_wrong_name, v_wrong_color
        FROM public.products p
        WHERE p.active = true AND p.group_id = v_group_id
        LIMIT 1;
        IF v_wrong_name IS NOT NULL THEN
          RAISE EXCEPTION
            'Tira "%" cor "%" não encontrada no estoque. Produto disponível no grupo: "%" (cor "%"). Cadastre o material na cor correta.',
            COALESCE(v_strap ->> 'label', 'Tira'), v_color, v_wrong_name, COALESCE(v_wrong_color, 'sem cor');
        ELSE
          RAISE EXCEPTION
            'Material da tira "%" (cor: %) não encontrado no estoque (grupo: %).',
            COALESCE(v_strap ->> 'label', 'Tira'), v_color, v_group_id;
        END IF;
      END;
    END IF;

    IF p_force_soft THEN
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (
        p_order_id, v_product_id, v_required, 0, 'reserved', 'soft',
        jsonb_build_object(
          'kind', 'strap',
          'color', v_color,
          'label', v_strap ->> 'label',
          'order_pairs', p_order_quantity,
          'product_name', v_product_name
        )
      );
      CONTINUE;
    END IF;

    IF v_current_qty < v_required THEN
      RAISE EXCEPTION
        'Estoque insuficiente para tira "%" (cor: %): disponível %, necessário % metros.',
        v_product_name, v_color, round(v_current_qty, 4), round(v_required, 4);
    END IF;

    UPDATE public.products
    SET quantity = GREATEST(0, quantity - v_required), updated_at = now()
    WHERE id = v_product_id;

    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (
      v_product_id, 'out', v_required, v_current_qty, v_current_qty - v_required,
      'Debito Tira (' || COALESCE(v_product_name, '') || ') Cor: ' || v_color
        || ' - ' || round(v_required::numeric, 4) || 'm × ' || p_order_quantity || ' pares',
      p_order_id
    );
  END LOOP;

  -- Achados (a)/(b): anota a OP com as tiras puladas — mesmo espírito da anotação
  -- "⚠ Faturado SEM baixar estoque (falta)" já usada no fluxo de faturamento.
  -- Idempotente: só acrescenta o que ainda não está em orders.notes (retries do
  -- débito não duplicam a anotação).
  IF p_order_id IS NOT NULL AND COALESCE(array_length(v_warnings, 1), 0) > 0 THEN
    UPDATE public.orders o
       SET notes = COALESCE(o.notes, '')
                 || CASE WHEN COALESCE(o.notes, '') = '' THEN '' ELSE E'\n' END
                 || (SELECT string_agg(DISTINCT w.warn, E'\n')
                       FROM unnest(v_warnings) AS w(warn)
                      WHERE position(w.warn in COALESCE(o.notes, '')) = 0),
           updated_at = now()
     WHERE o.id = p_order_id
       AND EXISTS (SELECT 1 FROM unnest(v_warnings) AS w2(warn)
                    WHERE position(w2.warn in COALESCE(o.notes, '')) = 0);
  END IF;
END;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. calculate_order_cost_item — idêntica ao def vivo, só comentários do bloco
--    de tiras atualizados (achado c: "ceil" → fração exata)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_order_cost_item(p_sale_order_item_id uuid, p_persist boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item record;
  v_sale_order_id uuid;
  v_ref uuid; v_color text; v_qty numeric; v_unit_price numeric;
  v_grade jsonb; v_cons jsonb; v_line jsonb;
  v_material numeric := 0; v_labor numeric := 0;
  v_overhead_per_pair numeric; v_overhead numeric := 0;
  v_packaging_per_pair numeric := 0; v_packaging numeric := 0;
  v_total numeric := 0;
  v_breakdown_materials jsonb := '[]'::jsonb;
  v_breakdown_labor jsonb := '[]'::jsonb;
  v_revenue numeric; v_margin numeric; v_margin_pct numeric;
  v_op record; v_prod record; v_out jsonb;
  v_required_in_product_unit numeric; v_subtotal numeric;
  v_warnings text[] := ARRAY[]::text[];
  v_has_active_policy boolean;
  v_sheet_overhead numeric;
  v_grade_sum numeric := 0;
  v_qty_multiplier numeric := 1;
  v_scaled_required numeric;
  v_scaled_subtotal numeric;
  v_conv4 record;
  v_dm2_norm numeric;
  v_snap_qty numeric;
  v_cons_source text := 'computed';
  v_strap record;
  v_strap_colors jsonb;
BEGIN
  SELECT i.id, i.sale_order_id, i.reference_id, i.color, i.quantity, i.unit_price,
         CASE WHEN i.grade IS NOT NULL AND i.grade::text <> 'null' THEN i.grade ELSE NULL END AS grade,
         i.material_variant_id, i.strap_colors
    INTO v_item
    FROM public.sale_order_items i
   WHERE i.id = p_sale_order_item_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  v_sale_order_id := v_item.sale_order_id;
  v_ref := v_item.reference_id; v_color := v_item.color;
  v_qty := v_item.quantity; v_unit_price := COALESCE(v_item.unit_price, 0);
  v_grade := v_item.grade;
  v_strap_colors := v_item.strap_colors;

  IF v_grade IS NOT NULL AND v_grade::text <> '{}' THEN
    SELECT COALESCE(SUM((value)::numeric), 0) INTO v_grade_sum
      FROM jsonb_each_text(v_grade) WHERE key !~ '^_';
    IF v_grade_sum > 0 AND v_qty > 0 THEN
      v_qty_multiplier := v_qty / v_grade_sum;
    END IF;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.cost_policies WHERE active = true)
    INTO v_has_active_policy;

  SELECT COALESCE(custom_overhead, 0) INTO v_sheet_overhead
    FROM public.technical_sheets WHERE id = v_ref;
  v_overhead_per_pair := v_sheet_overhead;
  IF v_overhead_per_pair IS NULL OR v_overhead_per_pair = 0 THEN
    SELECT COALESCE(overhead_rate_per_pair, 0) INTO v_overhead_per_pair
      FROM public.cost_policies WHERE active = true LIMIT 1;
  END IF;
  v_overhead_per_pair := COALESCE(v_overhead_per_pair, 0);

  SELECT COALESCE(packaging_cost_per_pair, 0) INTO v_packaging_per_pair
    FROM public.cost_policies WHERE active = true LIMIT 1;
  v_packaging_per_pair := COALESCE(v_packaging_per_pair, 0);

  IF NOT v_has_active_policy AND COALESCE(v_sheet_overhead, 0) = 0 THEN
    v_warnings := array_append(v_warnings, 'no_active_cost_policy');
  END IF;

  SELECT consumption_snapshot, quantity INTO v_cons, v_snap_qty
    FROM public.technical_sheet_snapshots
   WHERE sale_order_id = v_sale_order_id
     AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id)
   LIMIT 1;

  IF v_cons IS NULL THEN
    IF v_grade IS NOT NULL AND v_grade <> '{}'::jsonb THEN
      v_cons := public.calculate_order_consumption_by_grade(
        v_ref, v_grade, COALESCE(v_color, ''), v_item.material_variant_id);
    ELSE
      -- calculate_order_consumption é ESCALAR (RETURNS jsonb, array plano) — o wrap
      -- jsonb_agg(to_jsonb(c)) legado produzia array aninhado e o loop pulava as
      -- linhas em silêncio no caminho sem grade (mesmo fix do freeze/hybrid, M1).
      v_cons := COALESCE(public.calculate_order_consumption(
        v_ref, v_qty, COALESCE(v_color,''), NULL::integer, v_item.material_variant_id), '[]'::jsonb);
    END IF;
  ELSE
    v_cons_source := 'snapshot';
    v_qty_multiplier := CASE WHEN COALESCE(v_snap_qty, 0) > 0
                             THEN v_qty / v_snap_qty
                             ELSE 1 END;
  END IF;

  v_cons := public.filter_caixa_by_packaging_mode(
    v_cons, (SELECT packaging_mode FROM public.sale_orders WHERE id = v_sale_order_id));

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_cons) AS value LOOP
    SELECT unit_price, name, unit INTO v_prod FROM public.products WHERE id = (v_line ->> 'product_id')::uuid;
    v_required_in_product_unit := public.convert_to_product_unit(
      (v_line ->> 'required')::numeric,
      v_line ->> 'unit',
      COALESCE(v_prod.unit, ''));
    IF v_required_in_product_unit IS NULL THEN
      v_dm2_norm := public.convert_to_product_unit((v_line ->> 'required')::numeric, v_line ->> 'unit', 'dm²');
      IF v_dm2_norm IS NOT NULL THEN
        SELECT * INTO v_conv4 FROM public.get_material_conversion_info((v_line ->> 'product_id')::uuid);
        IF v_conv4.dm2_per_unit IS NOT NULL AND v_conv4.dm2_per_unit > 0 THEN
          v_required_in_product_unit := v_dm2_norm / v_conv4.dm2_per_unit;
        END IF;
      END IF;
    END IF;
    IF v_required_in_product_unit IS NULL THEN
      v_warnings := array_append(v_warnings, 'unit_mismatch:' || COALESCE(v_prod.name, '?'));
      v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
        'product_id', v_line ->> 'product_id',
        'product_name', v_prod.name,
        'component', v_line ->> 'component',
        'required', (v_line ->> 'required')::numeric,
        'consumption_unit', v_line ->> 'unit',
        'product_unit', v_prod.unit,
        'unit_price', COALESCE(v_prod.unit_price, 0),
        'subtotal', 0,
        'conversion_warning', 'unit_mismatch');
      CONTINUE;
    END IF;
    v_scaled_required := v_required_in_product_unit * v_qty_multiplier;
    v_scaled_subtotal := COALESCE(v_prod.unit_price, 0) * v_scaled_required;
    v_material := v_material + v_scaled_subtotal;
    v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
      'product_id', v_line ->> 'product_id',
      'product_name', v_prod.name,
      'component', v_line ->> 'component',
      'required', v_scaled_required,
      'required_per_grade', v_required_in_product_unit,
      'qty_multiplier', v_qty_multiplier,
      'consumption_unit', v_line ->> 'unit',
      'product_unit', v_prod.unit,
      'unit_price', COALESCE(v_prod.unit_price, 0),
      'subtotal', v_scaled_subtotal);
  END LOOP;

  -- Tiras: consumo em metros via strap_colors do item. NÃO passam pelo snapshot/
  -- consumo genérico (debitadas à parte por debit_strap_stock) — então invisíveis ao
  -- custeio até esta soma. required_m já é o TOTAL p/ a qty em FRAÇÃO EXATA de ficha
  -- (fichas = qty/grade_total, SEM ceil — ver order_strap_needs, mudança 2026-07-01);
  -- por isso NÃO se aplica v_qty_multiplier aqui.
  -- Guard: pula se a tira também já apareceu no BOM (evita contagem dupla).
  FOR v_strap IN
    SELECT sn.product_id, sn.required_m
      FROM public.order_strap_needs(v_strap_colors, v_qty, v_grade) sn
     WHERE sn.product_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_cons) c
          WHERE (c ->> 'product_id') IS NOT NULL
            AND (c ->> 'product_id')::uuid = sn.product_id)
  LOOP
    SELECT unit_price, name, unit INTO v_prod FROM public.products WHERE id = v_strap.product_id;
    v_subtotal := COALESCE(v_prod.unit_price, 0) * v_strap.required_m;
    v_material := v_material + v_subtotal;
    v_breakdown_materials := v_breakdown_materials || jsonb_build_object(
      'product_id', v_strap.product_id,
      'product_name', v_prod.name,
      'component', 'Tira',
      'required', v_strap.required_m,
      'consumption_unit', 'm',
      'product_unit', v_prod.unit,
      'unit_price', COALESCE(v_prod.unit_price, 0),
      'subtotal', v_subtotal);
  END LOOP;

  -- Tira com cor não cadastrada no grupo → não dá pra precificar (custo subestimado).
  -- Avisa. Inclui tira com cor VAZIA no PV: order_strap_needs emite linha
  -- product_id NULL + required_m > 0 pra esse caso (migration 20260902130000).
  FOR v_strap IN
    SELECT DISTINCT sn.color AS color
      FROM public.order_strap_needs(v_strap_colors, v_qty, v_grade) sn
     WHERE sn.product_id IS NULL AND sn.required_m > 0
  LOOP
    v_warnings := array_append(v_warnings, 'strap_color_not_registered:' || COALESCE(v_strap.color, '?'));
  END LOOP;

  FOR v_op IN
    SELECT operation_name, cost_per_hour, standard_time_minutes
      FROM public.bom_operations
     WHERE sheet_id = v_ref AND active IS NOT FALSE
       AND standard_time_minutes IS NOT NULL AND cost_per_hour IS NOT NULL
  LOOP
    v_labor := v_labor + (v_op.standard_time_minutes / 60.0) * v_op.cost_per_hour * v_qty;
    v_breakdown_labor := v_breakdown_labor || jsonb_build_object(
      'operation', v_op.operation_name,
      'hour_cost', v_op.cost_per_hour,
      'minutes_per_unit', v_op.standard_time_minutes,
      'subtotal', (v_op.standard_time_minutes / 60.0) * v_op.cost_per_hour * v_qty);
  END LOOP;

  v_overhead := v_overhead_per_pair * v_qty;
  v_packaging := v_packaging_per_pair * v_qty;
  v_total := v_material + v_labor + v_overhead + v_packaging;
  v_revenue := v_unit_price * v_qty;
  v_margin := v_revenue - v_total;
  v_margin_pct := CASE WHEN v_revenue > 0 THEN v_margin / v_revenue ELSE 0 END;

  v_out := jsonb_build_object(
    'sale_order_item_id', v_item.id,
    'reference_id', v_ref,
    'color', v_color,
    'quantity', v_qty,
    'grade_sum', v_grade_sum,
    'qty_multiplier', v_qty_multiplier,
    'material_cost', v_material, 'labor_cost', v_labor,
    'overhead_cost', v_overhead, 'packaging_cost', v_packaging,
    'total_cost', v_total, 'revenue', v_revenue,
    'margin', v_margin, 'margin_pct', v_margin_pct,
    'warnings', to_jsonb(v_warnings),
    'breakdown', jsonb_build_object(
      'materials', v_breakdown_materials,
      'labor', v_breakdown_labor,
      'overhead_per_pair', v_overhead_per_pair,
      'packaging_per_pair', v_packaging_per_pair,
      'qty_multiplier', v_qty_multiplier,
      'consumption_source', v_cons_source,
      'used_grade', v_grade IS NOT NULL AND v_grade <> '{}'::jsonb));

  IF p_persist THEN
    INSERT INTO public.order_costs (
      sale_order_id, sale_order_item_id, reference_id, color, quantity,
      material_cost, labor_cost, overhead_cost, packaging_cost, total_cost,
      revenue, margin, margin_pct, breakdown
    ) VALUES (
      v_sale_order_id, v_item.id, v_ref, COALESCE(v_color,''), v_qty,
      v_material, v_labor, v_overhead, v_packaging, v_total,
      v_revenue, v_margin, v_margin_pct, v_out -> 'breakdown')
    ON CONFLICT (sale_order_id, sale_order_item_id) DO UPDATE SET
      material_cost = EXCLUDED.material_cost,
      labor_cost = EXCLUDED.labor_cost,
      overhead_cost = EXCLUDED.overhead_cost,
      packaging_cost = EXCLUDED.packaging_cost,
      total_cost = EXCLUDED.total_cost,
      revenue = EXCLUDED.revenue,
      margin = EXCLUDED.margin,
      margin_pct = EXCLUDED.margin_pct,
      breakdown = EXCLUDED.breakdown,
      calculated_at = now();
  END IF;

  RETURN v_out;
END;
$function$;


-- ────────────────────────────────────────────────────────────────────────────
-- Grants — espelham o estado vivo (CREATE OR REPLACE preserva ACLs em banco
-- existente; explícito aqui pra ambiente recriado do zero não divergir).
-- order_strap_needs mantém EXECUTE default pra PUBLIC (estado vivo atual).
-- ────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.order_strap_needs(jsonb, numeric, jsonb) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.debit_strap_stock(jsonb, integer, uuid, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debit_strap_stock(jsonb, integer, uuid, jsonb, boolean) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.calculate_order_cost_item(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_order_cost_item(uuid, boolean) TO authenticated, service_role;
