-- Auditoria de motores Fase 2 — Pacote P5 (F4-3 + F4-4)
--
-- F4-3 — process_order_stock_out: motor LEGADO de baixa de BOM
-- ------------------------------------------------------------
-- Substituído pelo hybrid_debit_stock_for_order (FIX A3) mas nunca aposentado
-- no banco: debitava sheet_materials.quantity_per_unit × qty × (1+waste) DIRETO
-- (sem conversão dm²->unidade física, sem resolução de cor da OP, sem semântica
-- de variante), SECURITY DEFINER com GRANT a authenticated — 4º caminho de
-- débito latente invocável via RPC por qualquer usuário aprovado (cola debitada
-- fora de reserva/snapshot + duplo débito quando o hybrid_debit rodar depois).
-- Verificado via catálogo antes de aposentar: NENHUMA função/trigger viva o
-- referencia e o frontend não o chama (só resta no types.ts gerado).
-- Aposentadoria preservando a assinatura (histórico/PostgREST): corpo vira
-- RAISE EXCEPTION apontando o caminho novo + REVOKE EXECUTE.
--
-- F4-4 — check_stock_availability: piso inventado de 1 cm/par nas tiras
-- ---------------------------------------------------------------------
-- debit_strap_stock (Achado (b)) e o modal TS (strapConsumption.ts) tratam tira
-- SEM consumo configurado como 0 + warning (SEM piso). O ramo de tiras do
-- check_stock_availability ainda usava o piso legado:
--   v_consumption := COALESCE(consumption, 1); IF <= 0 THEN 1
-- gerando required fictício (qty × 1cm/100) quase sempre "verde" — mascarava a
-- tira sem consumo que o débito ia PULAR. Fix: espelhar o débito — consumo não
-- configurado emite linha de AVISO (product_id NULL, required 0, sufficient
-- false, sufixo '(sem consumo configurado)'), no mesmo padrão das linhas de
-- 'sem cor definida' / 'tira não cadastrada'. O fallback per-size passa a ser o
-- escalar real (0 quando ausente), como no débito.
--
-- Guards preservados: G12 (assinatura única com p_material_variant_id) e G19
-- (comentário CONS-7 no corpo) continuam passando. Diff mínimo sobre a
-- definição viva; sem UPDATE de dados.

-- ============================================================================
-- 1. F4-3 — aposentar process_order_stock_out
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_order_stock_out(p_order_id uuid, p_product_id uuid, p_quantity integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- F4-3 (auditoria 2026-07-21): motor legado APOSENTADO — debitava o BOM cru
  -- (sem conversão dm²->unidade física, sem cor da OP, sem variante).
  RAISE EXCEPTION USING
    ERRCODE = 'feature_not_supported',
    MESSAGE = 'process_order_stock_out foi aposentada (auditoria de motores 2026-07-21). '
              || 'Use public.hybrid_debit_stock_for_order (componentes, com snapshot/cor/variante) '
              || 'e public.debit_sole_stock_by_grade (solado por numeração).';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.process_order_stock_out(uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_order_stock_out(uuid, uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_order_stock_out(uuid, uuid, integer) FROM authenticated;

-- ============================================================================
-- 2. F4-4 — check_stock_availability sem piso de 1 cm/par nas tiras
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_stock_availability(p_reference_id uuid, p_order_quantity integer, p_color text DEFAULT ''::text, p_order_grade jsonb DEFAULT NULL::jsonb, p_strap_colors jsonb DEFAULT NULL::jsonb, p_packaging_mode text DEFAULT NULL::text, p_material_variant_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(product_id uuid, product_name text, required numeric, available numeric, sufficient boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_conv RECORD;
  mat RECORD;
  v_required numeric;
  v_target_id uuid;
  v_target_name text;
  v_target_qty numeric;
  v_effective_straps jsonb;
  v_sheet_straps jsonb;
  v_strap jsonb;
  v_group_id uuid;
  v_color text;
  v_color_norm text;
  v_per_size jsonb;
  v_consumption numeric;
  v_size text;
  v_pairs numeric;
  v_cm_per_pair numeric;
  v_total_cm numeric;
  v_grade_total numeric;
  v_fichas numeric;
  -- Auditoria 2026-07-01:
  v_sheet RECORD;
  v_grade_valid boolean := false;
  v_cons jsonb;
  v_spec RECORD;
  v_emitted uuid[] := ARRAY[]::uuid[];
  v_caixa_target text;
  v_caixa_types text[];
  v_apply_caixa boolean := false;
  v_resolved RECORD;
  v_sole_pid uuid;
  v_is_palmilha_pronta boolean := false;
  v_palmilha_color text;
  v_lining_total numeric;
  v_strap_label text;
BEGIN
  SELECT * INTO v_sheet FROM public.technical_sheets WHERE id = p_reference_id;

  v_grade_valid := p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object'
    AND EXISTS (
      SELECT 1 FROM jsonb_each_text(p_order_grade) g
      WHERE g.key ~ '^[0-9]+(/[0-9]+)?$' AND (g.value)::numeric > 0);

  ---------------------------------------------------------------------------
  -- Achado (b): materiais das SPECS da ficha (Cabedal/Forração/Palmilha/
  -- Forração Palmilha/Fachete) entravam só no by_grade/débito, nunca aqui —
  -- NAPA usada em 20 fichas via specs nunca gerava shortage nem auto-OC.
  -- Com grade válida delegamos ao próprio by_grade (paridade por construção:
  -- resolve_*_material_for_variant/resolve_material_product por grupo+cor,
  -- conversão dm²→física, gate de palmilha pronta e waste); somamos por
  -- produto (Forração + Forração Palmilha podem cair no MESMO produto).
  -- Linhas com conversion_warning (largura faltando → valor ~100× em dm²)
  -- NÃO entram — emitir aqui geraria auto-OC 100× inflada; hoje elas já são
  -- invisíveis nesta checagem, então excluí-las não é regressão.
  -- Specs têm PRECEDÊNCIA sobre o BOM (mesma ordem do by_grade): o loop de
  -- BOM abaixo pula produtos já emitidos (anti-join por produto).
  ---------------------------------------------------------------------------
  IF v_sheet.id IS NOT NULL THEN
    IF v_grade_valid THEN
      BEGIN
        -- CONS-4: a variante do item do PV entra na explosão — antes NULL fixo
        -- fazia o badge avaliar o material da FICHA, não o da variante escolhida.
        v_cons := public.calculate_order_consumption_by_grade(
          p_reference_id, p_order_grade, COALESCE(p_color, ''), p_material_variant_id);
      EXCEPTION WHEN OTHERS THEN
        v_cons := NULL;
        RAISE WARNING 'check_stock_availability: by_grade falhou p/ ficha %: %', p_reference_id, SQLERRM;
      END;
      IF v_cons IS NOT NULL AND jsonb_typeof(v_cons) = 'array' THEN
        FOR v_spec IN
          SELECT (l ->> 'product_id')::uuid       AS pid,
                 MAX(l ->> 'product_name')        AS pname,
                 SUM((l ->> 'required')::numeric) AS req
            FROM jsonb_array_elements(v_cons) AS l
           WHERE (l ->> 'component') IN ('Cabedal','Forração','Palmilha','Forração Palmilha','Fachete')
             AND (l ->> 'product_id') IS NOT NULL
             AND (l ->> 'conversion_warning') IS NULL
             AND COALESCE((l ->> 'required')::numeric, 0) > 0
           GROUP BY (l ->> 'product_id')::uuid
        LOOP
          SELECT GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
            INTO v_target_qty FROM public.products p WHERE p.id = v_spec.pid;
          product_id := v_spec.pid; product_name := v_spec.pname;
          required := v_spec.req; available := COALESCE(v_target_qty, 0);
          sufficient := (COALESCE(v_target_qty, 0) >= v_spec.req);
          v_emitted := array_append(v_emitted, v_spec.pid);
          RETURN NEXT;
        END LOOP;
      END IF;
    ELSIF p_order_quantity > 0 THEN
      -- Fallback ESCALAR (sem grade — ex.: badge inline de disponibilidade):
      -- mesmos gates/resolvers do by_grade, consumo escalar da ficha × qty.
      SELECT rsc.sole_product_id INTO v_sole_pid
        FROM public.resolve_sole_color(p_reference_id, COALESCE(p_color, '')) rsc;
      v_is_palmilha_pronta := COALESCE(v_sheet.insole_ready_made, false)
        OR EXISTS (SELECT 1 FROM public.products
                    WHERE id = v_sole_pid AND sole_classification::text = 'palmilha_pronta');

      -- Cabedal
      IF v_sheet.upper_material IS NOT NULL AND v_sheet.upper_material <> ''
         AND COALESCE(v_sheet.upper_consumption, 0) > 0 THEN
        SELECT * INTO v_resolved FROM public.resolve_upper_material_for_variant(
          p_material_variant_id, v_sheet.upper_material, p_color, 0, v_sheet.upper_material_product_id);
        IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN
          SELECT * INTO v_conv FROM public.get_material_conversion_info(v_resolved.product_id);
          IF v_conv.conversion_warning IS NULL THEN
            v_required := (v_sheet.upper_consumption * p_order_quantity / NULLIF(v_conv.dm2_per_unit, 0))
                          * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
            IF COALESCE(v_required, 0) > 0 THEN
              SELECT GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
                INTO v_target_qty FROM public.products p WHERE p.id = v_resolved.product_id;
              product_id := v_resolved.product_id; product_name := v_resolved.product_name;
              required := v_required; available := COALESCE(v_target_qty, 0);
              sufficient := (COALESCE(v_target_qty, 0) >= v_required);
              v_emitted := array_append(v_emitted, v_resolved.product_id);
              RETURN NEXT;
            END IF;
          END IF;
        END IF;
      END IF;

      -- Forração (+ Forração Palmilha: mesmo produto de forro → SOMA, não
      -- duas linhas comparadas cada uma contra o estoque cheio)
      -- CONS-7: forro do CABEDAL sem gate de insole_has_lining (paridade com o
      -- motor TS); o gate segue valendo só pra parcela da FORRAÇÃO DA PALMILHA.
      IF v_sheet.lining_material IS NOT NULL AND v_sheet.lining_material <> '' THEN
        SELECT * INTO v_resolved FROM public.resolve_lining_material_for_variant(
          p_material_variant_id, v_sheet.lining_material, p_color, 0, v_sheet.lining_material_product_id);
        IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN
          v_lining_total := COALESCE(v_sheet.lining_consumption, 0);
          IF NOT v_is_palmilha_pronta AND COALESCE(v_sheet.insole_has_lining, true) = true THEN
            v_lining_total := v_lining_total + COALESCE(v_sheet.insole_lining_consumption, 0);
          END IF;
          IF v_lining_total > 0 THEN
            SELECT * INTO v_conv FROM public.get_material_conversion_info(v_resolved.product_id);
            IF v_conv.conversion_warning IS NULL THEN
              v_required := (v_lining_total * p_order_quantity / NULLIF(v_conv.dm2_per_unit, 0))
                            * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
              IF COALESCE(v_required, 0) > 0 THEN
                SELECT GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
                  INTO v_target_qty FROM public.products p WHERE p.id = v_resolved.product_id;
                product_id := v_resolved.product_id; product_name := v_resolved.product_name;
                required := v_required; available := COALESCE(v_target_qty, 0);
                sufficient := (COALESCE(v_target_qty, 0) >= v_required);
                v_emitted := array_append(v_emitted, v_resolved.product_id);
                RETURN NEXT;
              END IF;
            END IF;
          END IF;
        END IF;
      END IF;

      -- Palmilha (gate de palmilha pronta, cor via technical_sheet_palmilha_colors)
      IF v_sheet.insole_material IS NOT NULL AND v_sheet.insole_material <> ''
         AND NOT v_is_palmilha_pronta AND COALESCE(v_sheet.insole_consumption, 0) > 0 THEN
        v_palmilha_color := p_color;
        IF COALESCE(v_sheet.insole_has_lining, true) = false THEN
          SELECT palmilha_color INTO v_palmilha_color FROM public.technical_sheet_palmilha_colors
           WHERE sheet_id = p_reference_id AND (cabedal_color = p_color OR cabedal_color = '__DEFAULT__')
           ORDER BY (cabedal_color = p_color) DESC LIMIT 1;
          v_palmilha_color := COALESCE(v_palmilha_color, p_color);
        END IF;
        SELECT * INTO v_resolved FROM public.resolve_insole_material_for_variant(
          p_material_variant_id, v_sheet.insole_material, v_palmilha_color, 0);
        IF v_resolved.product_id IS NOT NULL AND NOT (v_resolved.product_id = ANY(v_emitted)) THEN
          SELECT * INTO v_conv FROM public.get_material_conversion_info(v_resolved.product_id);
          IF v_conv.conversion_warning IS NULL THEN
            v_required := (v_sheet.insole_consumption * p_order_quantity / NULLIF(v_conv.dm2_per_unit, 0))
                          * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
            IF COALESCE(v_required, 0) > 0 THEN
              SELECT GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
                INTO v_target_qty FROM public.products p WHERE p.id = v_resolved.product_id;
              product_id := v_resolved.product_id; product_name := v_resolved.product_name;
              required := v_required; available := COALESCE(v_target_qty, 0);
              sufficient := (COALESCE(v_target_qty, 0) >= v_required);
              v_emitted := array_append(v_emitted, v_resolved.product_id);
              RETURN NEXT;
            END IF;
          END IF;
        END IF;
      END IF;
      -- Fachete: consumo só existe por numeração (sole_technical_specs);
      -- sem grade não há como computar — coberto apenas no caminho graduado.
    END IF;
  END IF;

  ---------------------------------------------------------------------------
  -- Achado (c): filtro de caixa por packaging_mode — mesma regra de
  -- filter_caixa_by_packaging_mode (padrão do custeio): só filtra quando o
  -- BOM tem os DOIS tipos de caixa e o alvo do modo está entre eles.
  ---------------------------------------------------------------------------
  IF p_packaging_mode IS NOT NULL THEN
    v_caixa_target := public.packaging_mode_collective_type(p_packaging_mode);
    IF v_caixa_target IS NOT NULL THEN
      SELECT array_agg(DISTINCT s.t) INTO v_caixa_types
      FROM (SELECT public.caixa_collective_type(p.name) AS t
              FROM public.get_effective_bom(p_reference_id, p_material_variant_id) sm
              JOIN public.products p ON p.id = sm.product_id) s
      WHERE s.t IS NOT NULL;
      v_apply_caixa := v_caixa_types IS NOT NULL
        AND array_length(v_caixa_types, 1) >= 2
        AND v_caixa_target = ANY(v_caixa_types);
    END IF;
  END IF;

  FOR mat IN
    -- SQL-1 (paridade): BOM EFETIVO da variante, mesma semântica do by_grade.
    SELECT sm.product_id, sm.quantity_per_unit,
           GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) AS current_stock, p.name, p.group_id, p.color AS product_color
    FROM public.get_effective_bom(p_reference_id, p_material_variant_id) sm
    JOIN public.products p ON p.id = sm.product_id
  LOOP
    -- Achado (b): anti-join — specs (emitidas acima) têm precedência,
    -- mesma ordem do by_grade (BOM pula produto já coberto).
    IF mat.product_id = ANY(v_emitted) THEN CONTINUE; END IF;

    -- Achado (c): caixa do modo errado sai da checagem (padrão do custeio).
    IF v_apply_caixa AND public.caixa_collective_type(mat.name) IS NOT NULL
       AND public.caixa_collective_type(mat.name) <> v_caixa_target THEN
      CONTINUE;
    END IF;

    -- Achado (a): ESCALAR quantity_per_unit × qty — mesma fórmula do
    -- by_grade/modal/débito. O per-size do sheet_materials (via
    -- calc_required_for_grade) tinha dados em kg/cluster → 5000× (DS12) e
    -- alimentava a OC automática da aprovação do PV.
    v_required := COALESCE(mat.quantity_per_unit, 0) * p_order_quantity;
    v_target_id := mat.product_id; v_target_name := mat.name; v_target_qty := mat.current_stock;

    IF p_color IS NOT NULL AND p_color <> '' AND mat.product_color <> p_color THEN
      SELECT p.id, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) INTO v_target_id, v_target_name, v_target_qty
        FROM public.products p
       WHERE p.active = true AND p.color = p_color
         AND ((mat.group_id IS NOT NULL AND p.group_id = mat.group_id)
              OR (mat.group_id IS NULL AND p.name = mat.name))
       LIMIT 1;
      IF v_target_id IS NULL THEN
        v_target_id := mat.product_id; v_target_name := mat.name; v_target_qty := mat.current_stock;
      END IF;
    END IF;

    IF v_target_id = ANY(v_emitted) THEN CONTINUE; END IF;

    -- conv-d1 (auditoria 2026-06-10): material de área em dm²/par → unidade
    -- física do produto-alvo pela largura da ficha de componente (+ perda%).
    SELECT * INTO v_conv FROM public.get_material_conversion_info(v_target_id);
    IF COALESCE(v_conv.dm2_per_unit, 1) > 0 AND COALESCE(v_conv.dm2_per_unit, 1) <> 1 THEN
      v_required := (v_required / v_conv.dm2_per_unit) * (1 + COALESCE(v_conv.waste_pct, 0) / 100);
    END IF;

    product_id := v_target_id; product_name := v_target_name; required := v_required;
    available := v_target_qty; sufficient := (v_target_qty >= v_required);
    v_emitted := array_append(v_emitted, v_target_id);
    RETURN NEXT;
  END LOOP;

  IF p_strap_colors IS NOT NULL AND jsonb_typeof(p_strap_colors) = 'array'
     AND jsonb_array_length(p_strap_colors) > 0 THEN
    v_effective_straps := p_strap_colors;
  ELSE
    SELECT ts.strap_colors INTO v_sheet_straps
      FROM public.technical_sheets ts WHERE ts.id = p_reference_id;

    IF v_sheet_straps IS NULL OR jsonb_typeof(v_sheet_straps) <> 'array' OR jsonb_array_length(v_sheet_straps) = 0 THEN
      RETURN;
    END IF;

    SELECT jsonb_agg(
      CASE
        WHEN COALESCE(s ->> 'color', '') = '' AND p_color <> '' THEN s || jsonb_build_object('color', p_color)
        ELSE s
      END
    ) INTO v_effective_straps
    FROM jsonb_array_elements(v_sheet_straps) AS s;
  END IF;

  IF v_effective_straps IS NULL THEN RETURN; END IF;

  FOR v_strap IN SELECT value FROM jsonb_array_elements(v_effective_straps) AS value LOOP
    v_color := v_strap ->> 'color';
    BEGIN v_group_id := (v_strap ->> 'group_id')::uuid;
    EXCEPTION WHEN OTHERS THEN v_group_id := NULL; END;
    -- Sem grupo não há material rastreável (registro legado/quebrado) → skip.
    IF v_group_id IS NULL THEN CONTINUE; END IF;

    v_per_size := v_strap -> 'consumption_per_size';
    -- F4-4 (auditoria 2026-07-21): SEM piso inventado de 1 cm/par — paridade
    -- com debit_strap_stock (Achado (b)) e com o modal TS (strapConsumption.ts):
    -- consumo ausente/<=0 é 0, inclusive como fallback per-size.
    v_consumption := COALESCE((v_strap ->> 'consumption')::numeric, 0);
    IF v_consumption < 0 THEN v_consumption := 0; END IF;

    IF v_per_size IS NOT NULL AND jsonb_typeof(v_per_size) = 'object'
       AND p_order_grade IS NOT NULL AND jsonb_typeof(p_order_grade) = 'object' THEN
      v_total_cm := 0; v_grade_total := 0;
      FOR v_size, v_pairs IN
        SELECT key, value::numeric FROM jsonb_each_text(p_order_grade) WHERE value::numeric > 0
      LOOP
        v_cm_per_pair := COALESCE((v_per_size ->> v_size)::numeric, v_consumption);
        v_total_cm := v_total_cm + (v_pairs * v_cm_per_pair);
        v_grade_total := v_grade_total + v_pairs;
      END LOOP;
      IF v_grade_total > 0 THEN
        v_fichas := (p_order_quantity::numeric / v_grade_total);
      ELSE v_fichas := 1; END IF;
      v_required := (v_total_cm * v_fichas) / 100;
    ELSE
      -- Não-graduado: consumption em cm/par → ÷100 p/ metros (unidade do produto-tira).
      v_required := (v_consumption * p_order_quantity) / 100;
    END IF;

    -- F4-4: consumo NÃO configurado → o débito (debit_strap_stock) PULA esta
    -- tira com warning na OP; o badge espelha com linha de AVISO (product_id
    -- NULL ⇒ o caller mostra a pendência mas NÃO gera auto-OC), em vez do
    -- required fictício "verde" que o piso de 1 cm/par inventava.
    IF v_required <= 0 THEN
      IF p_order_quantity > 0 THEN
        v_strap_label := COALESCE(NULLIF(trim(v_strap ->> 'label'), ''), 'Tira');
        product_id := NULL;
        product_name := v_strap_label || ' (sem consumo configurado)';
        required := 0; available := 0; sufficient := false;
        RETURN NEXT;
      END IF;
      CONTINUE;
    END IF;

    -- Achado (d): cor VAZIA era skip silencioso — a tira sumia da checagem
    -- (nem shortage, nem MRP). Agora emite linha de warning no padrão do
    -- 'tira não cadastrada' abaixo (product_id NULL ⇒ o caller mostra a
    -- falta mas NÃO gera auto-OC — quem resolve é o dialog de tiras).
    -- Paridade com order_strap_needs (migration 20260902130000).
    IF v_color IS NULL OR v_color = '' THEN
      v_strap_label := COALESCE(NULLIF(trim(v_strap ->> 'label'), ''), 'Tira');
      product_id := NULL;
      product_name := v_strap_label || ' (sem cor definida no PV)';
      required := v_required; available := 0; sufficient := false;
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_color_norm := lower(trim(extensions.unaccent(v_color)));

    SELECT p.id, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0))
      INTO v_target_id, v_target_name, v_target_qty
      FROM public.products p
     WHERE p.active = true AND p.group_id = v_group_id
       AND lower(trim(extensions.unaccent(p.color))) = v_color_norm
     LIMIT 1;
    IF v_target_id IS NULL THEN
      SELECT p.id, p.name, GREATEST(0, p.quantity - COALESCE(p.reserved_stock, 0)) INTO v_target_id, v_target_name, v_target_qty
        FROM public.products p
       WHERE p.active = true AND p.group_id = v_group_id
         AND (p.color IS NULL OR trim(p.color) = '')
       LIMIT 1;
    END IF;
    IF v_target_id IS NULL THEN
      product_id := NULL;
      product_name := COALESCE(NULLIF(trim(v_color), ''), 'tira') || ' (tira não cadastrada)';
      required := v_required; available := 0; sufficient := false;
      RETURN NEXT;
      CONTINUE;
    END IF;

    product_id := v_target_id; product_name := v_target_name; required := v_required;
    available := COALESCE(v_target_qty, 0); sufficient := (COALESCE(v_target_qty,0) >= v_required);
    RETURN NEXT;
  END LOOP;
END;
$function$;
