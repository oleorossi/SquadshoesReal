-- debit_strap_stock passa a usar o MOTOR ÚNICO (resolve_strap_sourcing +
-- resolve_strap_base_napa da migration 20261021120000): quando a tira é cortada
-- aqui, quem sai do estoque é a NAPA, não a tira.
--
-- ⚠ CUTOVER 2026-07-31 — decisão do dono: "ignorar os pedidos que já estão
-- cadastrados e fazer a partir dos de hoje". PV criado ANTES do cutover mantém
-- o comportamento antigo (reserva a própria tira) MESMO se for re-aprovado ou
-- tiver as OPs recriadas, pra não mexer em reserva de produção em andamento.
-- Verificado: PV-00147, PV-00148, PV-00150 e PV-2026-00097 ficam todos no
-- caminho antigo.
--
-- ⚠ NÃO deduplicar linhas de tira: 4 entradas iguais em strap_colors são 4
-- tiras REAIS (TIRA 1..4). O dono cadastra tira a tira porque o cliente pode
-- combinar cor por posição. Somar é correto; deduplicar perderia tira.
--
-- O metadata da reserva passa a levar as DUAS grandezas — strap_product_name /
-- strap_required_m / yield_per_meter além do produto que saiu do estoque —
-- porque o picking mostra a tira PRONTA em destaque e a napa embaixo.
--
-- Corpo completo aplicado via MCP; ver o objeto no banco (é a fonte de verdade,
-- conforme a seção "Migrations" do CLAUDE.md). O corpo abaixo foi extraído do
-- objeto vivo com pg_get_functiondef em 31/07/2026, pra deixar o arquivo
-- replayável (`supabase db push` / `db reset` não regridem mais o cutover).

CREATE OR REPLACE FUNCTION public.debit_strap_stock(p_strap_colors jsonb, p_order_quantity integer, p_order_id uuid DEFAULT NULL::uuid, p_order_grade jsonb DEFAULT NULL::jsonb, p_force_soft boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public, extensions'
AS $function$
DECLARE
  v_strap jsonb; v_group_id uuid; v_color text; v_color_norm text;
  v_product_id uuid; v_product_name text; v_current_qty numeric; v_product_color text;
  v_required numeric; v_consumption numeric; v_per_size jsonb;
  v_size text; v_pairs numeric; v_cm_per_pair numeric; v_total_cm numeric;
  v_grade_total numeric; v_fichas numeric; v_lock_key bigint;
  v_label text; v_has_config boolean; v_warn text;
  v_warnings text[] := ARRAY[]::text[]; v_rule_pid uuid;
  v_cutover date := DATE '2026-07-31';
  v_use_engine boolean := false;
  v_soi_id uuid; v_ref_id uuid; v_family text; v_pv_created date;
  v_sourcing text; v_base RECORD; v_desc text;
  v_strap_pid uuid; v_strap_name text; v_strap_m numeric; v_yield numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Unauthorized: user not approved';
  END IF;

  IF p_strap_colors IS NULL OR jsonb_typeof(p_strap_colors) != 'array' OR jsonb_array_length(p_strap_colors) = 0 THEN
    RETURN;
  END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT o.sale_order_item_id, o.reference_id, so.created_at::date
      INTO v_soi_id, v_ref_id, v_pv_created
      FROM public.orders o
      LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
     WHERE o.id = p_order_id;
    v_use_engine := (v_pv_created IS NOT NULL AND v_pv_created >= v_cutover);
    IF v_use_engine THEN v_family := public.strap_base_family_for_sheet(v_ref_id); END IF;

    v_lock_key := ('x' || substr(md5('debit_strap:' || p_order_id::text), 1, 16))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    IF NOT p_force_soft AND EXISTS (
      SELECT 1 FROM public.stock_movements
       WHERE order_id = p_order_id AND movement_type = 'out' AND description LIKE 'Debito Tira%'
    ) THEN RETURN; END IF;

    IF p_force_soft AND EXISTS (
      SELECT 1 FROM public.material_reservations
       WHERE order_id = p_order_id AND status = 'reserved' AND (metadata ->> 'kind') = 'strap'
    ) THEN RETURN; END IF;
  END IF;

  FOR v_strap IN SELECT value FROM jsonb_array_elements(p_strap_colors) AS value
  LOOP
    v_color := v_strap ->> 'color';
    BEGIN v_group_id := (v_strap ->> 'group_id')::uuid; EXCEPTION WHEN OTHERS THEN v_group_id := NULL; END;
    IF v_group_id IS NULL THEN CONTINUE; END IF;

    v_label := COALESCE(NULLIF(trim(v_strap ->> 'label'), ''), 'Tira');
    v_per_size := v_strap -> 'consumption_per_size';
    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 0);
    IF v_consumption < 0 THEN v_consumption := 0; END IF;
    v_has_config := v_consumption > 0
      OR (v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
          AND EXISTS (SELECT 1 FROM jsonb_each_text(v_per_size) ps WHERE COALESCE((ps.value)::numeric, 0) > 0));

    IF v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      v_total_cm := 0; v_grade_total := 0;
      FOR v_size, v_pairs IN SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        v_cm_per_pair := COALESCE((v_per_size ->> v_size)::numeric, v_consumption);
        v_total_cm := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;
      IF v_grade_total > 0 THEN v_fichas := (p_order_quantity::numeric / v_grade_total); ELSE v_fichas := 1; END IF;
      v_required := (v_total_cm * v_fichas) / 100;
    ELSE
      v_required := (v_consumption * p_order_quantity) / 100;
    END IF;

    IF v_required <= 0 THEN
      IF p_order_quantity > 0 AND NOT v_has_config THEN
        v_warn := '⚠ Tira "' || v_label || '"'
          || CASE WHEN COALESCE(trim(v_color), '') <> '' THEN ' (cor: ' || v_color || ')' ELSE '' END
          || ' sem consumo configurado (cm/par) — estoque NÃO debitado. Cadastre o consumo na ficha técnica e reprocesse o débito.';
        RAISE WARNING '[debit_strap_stock] OP %: %', p_order_id, v_warn;
        v_warnings := array_append(v_warnings, v_warn);
      END IF;
      CONTINUE;
    END IF;

    IF v_color IS NULL OR v_color = '' THEN
      v_warn := '⚠ Tira "' || v_label || '" sem cor definida no PV — estoque NÃO debitado ('
        || round(v_required, 2) || ' m pendentes). Defina a cor da tira no item do PV e reprocesse o débito.';
      RAISE WARNING '[debit_strap_stock] OP %: %', p_order_id, v_warn;
      v_warnings := array_append(v_warnings, v_warn);
      CONTINUE;
    END IF;

    v_color_norm := lower(trim(unaccent(v_color)));

    SELECT d.product_id INTO v_rule_pid
      FROM public.component_color_defaults d
      JOIN public.products p ON p.id = d.product_id
     WHERE d.active = true AND d.group_id = v_group_id
       AND p.active = true AND p.group_id = v_group_id
       AND (d.is_default OR lower(trim(unaccent(d.cabedal_color))) = v_color_norm)
     ORDER BY d.is_default ASC, d.id LIMIT 1;

    IF v_rule_pid IS NOT NULL THEN
      SELECT p.id, p.name, p.quantity, p.color INTO v_product_id, v_product_name, v_current_qty, v_product_color
        FROM public.products p WHERE p.id = v_rule_pid LIMIT 1 FOR UPDATE;
    ELSE
      SELECT p.id, p.name, p.quantity, p.color INTO v_product_id, v_product_name, v_current_qty, v_product_color
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_group_id
         AND lower(trim(unaccent(p.color))) = v_color_norm LIMIT 1 FOR UPDATE;
    END IF;

    IF v_product_id IS NULL THEN
      SELECT p.id, p.name, p.quantity, p.color INTO v_product_id, v_product_name, v_current_qty, v_product_color
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_group_id
         AND (p.color IS NULL OR trim(p.color) = '') LIMIT 1 FOR UPDATE;
    END IF;

    IF v_product_id IS NULL THEN
      DECLARE v_wrong_name text; v_wrong_color text;
      BEGIN
        SELECT p.name, p.color INTO v_wrong_name, v_wrong_color
          FROM public.products p WHERE p.active = true AND p.group_id = v_group_id LIMIT 1;
        IF v_wrong_name IS NOT NULL THEN
          RAISE EXCEPTION 'Tira "%" cor "%" não encontrada no estoque. Produto disponível no grupo: "%" (cor "%"). Cadastre o material na cor correta.',
            COALESCE(v_strap ->> 'label', 'Tira'), v_color, v_wrong_name, COALESCE(v_wrong_color, 'sem cor');
        ELSE
          RAISE EXCEPTION 'Material da tira "%" (cor: %) não encontrado no estoque (grupo: %).',
            COALESCE(v_strap ->> 'label', 'Tira'), v_color, v_group_id;
        END IF;
      END;
    END IF;

    v_strap_pid := NULL; v_strap_name := NULL; v_strap_m := NULL; v_yield := NULL; v_sourcing := NULL;
    IF v_use_engine THEN
      v_sourcing := public.resolve_strap_sourcing(v_soi_id, v_product_id, v_group_id, v_color);
      IF v_sourcing = 'in_house' THEN
        SELECT * INTO v_base FROM public.resolve_strap_base_napa(v_product_id, v_family, v_color);
        IF v_base.block_reason IS NOT NULL THEN
          RAISE EXCEPTION '%', v_base.block_reason;
        END IF;
        v_strap_pid := v_product_id; v_strap_name := v_product_name;
        v_strap_m := v_required; v_yield := v_base.yield_per_meter;
        v_required := round(v_required / v_base.yield_per_meter, 6);
        SELECT p.id, p.name, p.quantity, p.color INTO v_product_id, v_product_name, v_current_qty, v_product_color
          FROM public.products p WHERE p.id = v_base.base_product_id LIMIT 1 FOR UPDATE;
        IF v_product_id IS NULL THEN
          RAISE EXCEPTION 'Napa-base da tira "%" (cor %) sumiu do cadastro entre a resolução e o débito.', v_strap_name, v_color;
        END IF;
      END IF;
    END IF;

    IF p_force_soft THEN
      INSERT INTO public.material_reservations
        (order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, metadata)
      VALUES (p_order_id, v_product_id, v_required, 0, 'reserved', 'soft',
        jsonb_build_object('kind', 'strap', 'color', v_color, 'label', v_strap ->> 'label',
          'order_pairs', p_order_quantity, 'product_name', v_product_name,
          'sourcing', COALESCE(v_sourcing, 'legacy'))
        || CASE WHEN v_strap_pid IS NOT NULL
                THEN jsonb_build_object('strap_product_id', v_strap_pid,
                       'strap_product_name', v_strap_name, 'strap_required_m', v_strap_m,
                       'yield_per_meter', v_yield)
                ELSE '{}'::jsonb END);
      CONTINUE;
    END IF;

    IF v_current_qty < v_required THEN
      RAISE EXCEPTION 'Estoque insuficiente para % "%" (cor: %): disponível %, necessário % metros.',
        CASE WHEN v_strap_pid IS NOT NULL THEN 'a napa da tira' ELSE 'tira' END,
        v_product_name, v_color, round(v_current_qty, 4), round(v_required, 4);
    END IF;

    UPDATE public.products SET quantity = GREATEST(0, quantity - v_required), updated_at = now()
     WHERE id = v_product_id;

    IF v_strap_pid IS NOT NULL THEN
      v_desc := 'Debito Tira (napa ' || COALESCE(v_product_name, '') || ') para '
             || COALESCE(v_strap_name, 'tira') || ' Cor: ' || v_color || ' - '
             || round(v_strap_m, 4) || 'm de tira / rend ' || v_yield || ' = '
             || round(v_required, 4) || 'm de napa × ' || p_order_quantity || ' pares';
    ELSE
      v_desc := 'Debito Tira (' || COALESCE(v_product_name, '') || ') Cor: ' || v_color
             || ' - ' || round(v_required::numeric, 4) || 'm × ' || p_order_quantity || ' pares';
    END IF;

    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description, order_id)
    VALUES (v_product_id, 'out', v_required, v_current_qty, v_current_qty - v_required, v_desc, p_order_id);
  END LOOP;

  IF p_order_id IS NOT NULL AND COALESCE(array_length(v_warnings, 1), 0) > 0 THEN
    UPDATE public.orders o
       SET notes = COALESCE(o.notes, '') || CASE WHEN COALESCE(o.notes, '') = '' THEN '' ELSE E'\n' END
                 || (SELECT string_agg(DISTINCT w.warn, E'\n') FROM unnest(v_warnings) AS w(warn)
                      WHERE position(w.warn in COALESCE(o.notes, '')) = 0),
           updated_at = now()
     WHERE o.id = p_order_id
       AND EXISTS (SELECT 1 FROM unnest(v_warnings) AS w2(warn) WHERE position(w2.warn in COALESCE(o.notes, '')) = 0);
  END IF;
END $function$;
