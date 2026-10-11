-- tira_material_funcoes_20270101035900
--
-- Fase 2 de specs/tira-material-de-estoque.md: as funções do modelo novo, AINDA
-- DESLIGADAS. Nenhum chamador existente aponta para elas; aplicar esta migration
-- não muda o comportamento do PV. A virada (migration própria) faz o writer
-- público `prepare_sale_order_item_internal_straps` delegar para o v2 abaixo.
--
--   private.strap_line_required_m      metros de uma linha de tira (R8)
--   private.resolve_strap_sku          SKU pela chave grupo + napa + cor (R2, R7, R7a)
--   private.prepare_sale_order_item_straps_v2
--                                      writer do PV sem Hub (R6, R7, R9, R10);
--                                      p_dry_run = prévia, nunca cria SKU nem levanta erro por linha
--   public.sale_order_item_strap_needs necessidade de tira do item / da OP (motor, R11)
--   public.preview_sale_order_strap_resolution
--                                      checagem prévia do "Duplicar para lojas" (R28, R29) —
--                                      mesma fonte do writer, sem regra duplicada no cliente

-- ── Metros de uma linha de tira ─────────────────────────────────────────────
-- Espelha order_strap_needs / calculateStrapConsumptionCm: cm/par por numeração
-- (pick_consumption_for_size, que entende grade conjugada) × pares, fração exata
-- de fichas (quantidade ÷ soma da grade), ÷ 100. Sem consumo por numeração, usa o
-- escalar `consumption` (cm/par) × quantidade.
CREATE OR REPLACE FUNCTION private.strap_line_required_m(
  p_line jsonb,
  p_grade jsonb,
  p_quantity numeric
) RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_per_size jsonb := p_line -> 'consumption_per_size';
  v_default numeric := 0;
  v_total_cm numeric := 0;
  v_grade_total numeric := 0;
  v_size text;
  v_pairs numeric;
  v_cm numeric;
BEGIN
  IF coalesce(p_quantity, 0) <= 0 THEN
    RETURN 0;
  END IF;
  IF coalesce(p_line ->> 'consumption', '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' THEN
    v_default := greatest((p_line ->> 'consumption')::numeric, 0);
  END IF;

  IF jsonb_typeof(v_per_size) = 'object'
     AND EXISTS (SELECT 1 FROM jsonb_object_keys(v_per_size))
     AND jsonb_typeof(p_grade) = 'object' THEN
    FOR v_size, v_pairs IN
      SELECT g.key, g.value::numeric
        FROM jsonb_each_text(p_grade) g
       WHERE left(g.key, 1) <> '_'
         AND g.value ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
         AND g.value::numeric > 0
    LOOP
      v_cm := coalesce(public.pick_consumption_for_size(v_per_size, v_size), v_default);
      v_total_cm := v_total_cm + v_pairs * v_cm;
      v_grade_total := v_grade_total + v_pairs;
    END LOOP;
    IF v_grade_total > 0 THEN
      RETURN round(v_total_cm * (p_quantity / v_grade_total) / 100, 4);
    END IF;
  END IF;

  RETURN round(v_default * p_quantity / 100, 4);
END;
$function$;

REVOKE ALL ON FUNCTION private.strap_line_required_m(jsonb, jsonb, numeric) FROM PUBLIC;

-- ── SKU da tira pela chave ──────────────────────────────────────────────────
-- Ordem (R7a, decisão do dono 11/10/2026):
--   1. SKU ativo com a chave exata (grupo + napa + cor; napa NULL no grupo sem napa);
--   2. tira com napa: SKU ativo SEM napa da mesma cor (SKU antigo de antes do Hub — reserva);
--   3. cria o SKU (estoque 0, unidade m, nome GRUPO · NAPA · COR) — só com p_create.
-- Duplicata dentro da chave não bloqueia o PV: vence o de maior estoque, depois o mais antigo.
CREATE OR REPLACE FUNCTION private.resolve_strap_sku(
  p_group_id uuid,
  p_napa_group_id uuid,
  p_color_id uuid,
  p_create boolean
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_group public.product_groups%ROWTYPE;
  v_napa uuid := p_napa_group_id;
  v_napa_name text;
  v_color_name text;
  v_pid uuid;
  v_pname text;
  v_match text;
  v_name text;
BEGIN
  SELECT * INTO v_group FROM public.product_groups g WHERE g.id = p_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'o grupo de estoque da tira não existe mais — corrija a ficha técnica';
  END IF;
  SELECT c.name INTO v_color_name
    FROM public.canonical_colors c
   WHERE c.id = p_color_id AND c.active;
  IF v_color_name IS NULL THEN
    RAISE EXCEPTION 'a cor da tira não existe ou está inativa';
  END IF;
  IF NOT coalesce(v_group.strap_uses_napa, true) THEN
    v_napa := NULL;
  END IF;
  IF v_napa IS NOT NULL THEN
    SELECT g.name INTO v_napa_name FROM public.product_groups g WHERE g.id = v_napa;
  END IF;

  IF p_create THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'strap-sku:' || p_group_id::text || ':' || coalesce(v_napa::text, '-') || ':' || p_color_id::text,
      0
    ));
  END IF;

  SELECT p.id, p.name INTO v_pid, v_pname
    FROM public.products p
   WHERE p.active
     AND p.group_id = p_group_id
     AND p.strap_base_group_id IS NOT DISTINCT FROM v_napa
     AND public.resolve_strap_canonical_color_id(p.color) = p_color_id
   ORDER BY p.quantity DESC NULLS LAST, p.created_at, p.id
   LIMIT 1;
  IF v_pid IS NOT NULL THEN
    v_match := 'exact';
  ELSIF v_napa IS NOT NULL THEN
    SELECT p.id, p.name INTO v_pid, v_pname
      FROM public.products p
     WHERE p.active
       AND p.group_id = p_group_id
       AND p.strap_base_group_id IS NULL
       AND public.resolve_strap_canonical_color_id(p.color) = p_color_id
     ORDER BY p.quantity DESC NULLS LAST, p.created_at, p.id
     LIMIT 1;
    IF v_pid IS NOT NULL THEN
      v_match := 'sem_napa';
    END IF;
  END IF;

  IF v_pid IS NULL THEN
    v_name := upper(concat_ws(' · ', v_group.name, v_napa_name, v_color_name));
    IF NOT p_create THEN
      RETURN jsonb_build_object(
        'product_id', NULL, 'product_name', v_name, 'match', 'would_create',
        'group_name', v_group.name, 'napa_group_id', v_napa, 'napa_name', v_napa_name,
        'color_id', p_color_id, 'color_name', v_color_name
      );
    END IF;
    -- Token do guard do motor antigo (some no DROP; inofensivo depois).
    PERFORM pg_catalog.set_config('app.artisanal_strap_catalog_write', '1', true);
    INSERT INTO public.products (
      name, sku, category, group_id, color,
      quantity, min_stock, unit, unit_price, location, active, is_artisanal,
      purchase_unit, conversion_rate, min_order_quantity, purchase_multiple,
      strap_base_group_id
    ) VALUES (
      v_name,
      'TP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24)),
      coalesce(nullif(v_group.sector, ''), 'Material Base'),
      p_group_id,
      v_color_name,
      0, 0, 'm', 0, '', true, false,
      'm', 1, 1, 1,
      v_napa
    )
    RETURNING id, name INTO v_pid, v_pname;
    v_match := 'created';
  END IF;

  RETURN jsonb_build_object(
    'product_id', v_pid, 'product_name', v_pname, 'match', v_match,
    'group_name', v_group.name, 'napa_group_id', v_napa, 'napa_name', v_napa_name,
    'color_id', p_color_id, 'color_name', v_color_name
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.resolve_strap_sku(uuid, uuid, uuid, boolean) FROM PUBLIC;

-- ── Writer do PV sem Hub ────────────────────────────────────────────────────
-- Estrutura vem da FICHA (fonte de verdade); do item vêm só as escolhas do PV
-- (cor da tira multicolor, napa da tira, origem na exceção). Retorno compatível
-- com o writer antigo: todos os chamadores leem `-> 'item'`.
CREATE OR REPLACE FUNCTION private.prepare_sale_order_item_straps_v2(
  p_item jsonb,
  p_dry_run boolean DEFAULT false
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_item_id uuid;
  v_reference_id uuid;
  v_variant_id uuid;
  v_in_lines jsonb := CASE WHEN jsonb_typeof(p_item -> 'strap_colors') = 'array'
                           THEN p_item -> 'strap_colors' ELSE '[]'::jsonb END;
  v_grade jsonb := p_item -> 'grade';
  v_qty numeric := 0;
  v_sheet public.technical_sheets%ROWTYPE;
  v_sheet_lines jsonb;
  v_current public.sale_order_items%ROWTYPE;
  v_status text;
  v_model text;
  v_item_color text := coalesce(nullif(trim(p_item ->> 'color'), ''), 'sem cor principal');
  v_sheet_line jsonb;
  v_ord bigint;
  v_in_line jsonb;
  v_line_id uuid;
  v_label text;
  v_gid uuid;
  v_group public.product_groups%ROWTYPE;
  v_color_mode text;
  v_color_id uuid;
  v_color_name text;
  v_selected_napa uuid;
  v_ctx jsonb;
  v_napa uuid;
  v_explicit_origin text;
  v_origin text;
  v_sku jsonb;
  v_required numeric;
  v_line_out jsonb;
  v_out_lines jsonb := '[]'::jsonb;
  v_sourcing jsonb := '{}'::jsonb;
  v_report jsonb := '[]'::jsonb;
  v_created jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_item) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Item do PV deve ser objeto';
  END IF;
  BEGIN
    v_item_id := nullif(p_item ->> 'id', '')::uuid;
    v_reference_id := nullif(p_item ->> 'reference_id', '')::uuid;
    v_variant_id := nullif(p_item ->> 'material_variant_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Referência ou variante de material inválida no item';
  END;
  IF coalesce(p_item ->> 'quantity', '') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' THEN
    v_qty := (p_item ->> 'quantity')::numeric;
  END IF;

  SELECT * INTO v_sheet FROM public.technical_sheets ts WHERE ts.id = v_reference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha técnica inexistente';
  END IF;
  v_model := coalesce(nullif(v_sheet.code, ''), nullif(v_sheet.name, ''), v_reference_id::text);
  v_sheet_lines := CASE WHEN jsonb_typeof(v_sheet.strap_colors) = 'array'
                        THEN v_sheet.strap_colors ELSE '[]'::jsonb END;

  IF v_variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.reference_material_variants rmv
     WHERE rmv.id = v_variant_id
       AND rmv.reference_id = v_reference_id
       AND coalesce(rmv.active, true)
  ) THEN
    RAISE EXCEPTION 'Modelo % / %: a variante de material não pertence à referência ou está inativa',
      v_model, v_item_color;
  END IF;

  -- Item já Aprovado/Em Produção e intocado nas tiras continua congelado: não
  -- re-resolve SKU por edição alheia (mesma regra do writer antigo).
  IF NOT p_dry_run AND v_item_id IS NOT NULL THEN
    SELECT * INTO v_current FROM public.sale_order_items i WHERE i.id = v_item_id;
    IF FOUND THEN
      SELECT so.status INTO v_status FROM public.sale_orders so WHERE so.id = v_current.sale_order_id;
      IF v_status IN ('Aprovado', 'Em Produção')
         AND current_setting('app.strap_force_revalidate', true) IS DISTINCT FROM '1'
         AND v_reference_id IS NOT DISTINCT FROM v_current.reference_id
         AND v_variant_id IS NOT DISTINCT FROM v_current.material_variant_id
         AND (p_item ->> 'color') IS NOT DISTINCT FROM v_current.color
         AND (
           SELECT coalesce(jsonb_agg(l.value ORDER BY l.value::text), '[]'::jsonb)
             FROM jsonb_array_elements(v_in_lines) l(value)
         ) IS NOT DISTINCT FROM (
           SELECT coalesce(jsonb_agg(l.value ORDER BY l.value::text), '[]'::jsonb)
             FROM jsonb_array_elements(coalesce(v_current.strap_colors, '[]'::jsonb)) l(value)
         ) THEN
        RETURN jsonb_build_object(
          'item', p_item || jsonb_build_object(
            'strap_colors', coalesce(v_current.strap_colors, '[]'::jsonb),
            'strap_sourcing', coalesce(v_current.strap_sourcing, '{}'::jsonb),
            'strap_sourcing_revision', v_current.strap_sourcing_revision
          ),
          'ensured', '[]'::jsonb,
          'lines_report', '[]'::jsonb,
          'created_skus', '[]'::jsonb,
          'frozen', true
        );
      END IF;
    END IF;
  END IF;

  FOR v_sheet_line, v_ord IN
    SELECT l.value, l.ordinality FROM jsonb_array_elements(v_sheet_lines) WITH ORDINALITY l(value, ordinality)
  LOOP
    v_label := coalesce(nullif(trim(v_sheet_line ->> 'label'), ''), 'TIRA ' || v_ord);
    v_line_id := NULL;
    v_in_line := NULL;
    BEGIN
      BEGIN
        v_line_id := nullif(v_sheet_line ->> 'technical_strap_line_id', '')::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_line_id := NULL;
      END;
      IF v_line_id IS NULL THEN
        RAISE EXCEPTION 'a ficha tem esta tira sem identificador estável — abra e salve a ficha técnica';
      END IF;

      SELECT l.value INTO v_in_line
        FROM jsonb_array_elements(v_in_lines) l(value)
       WHERE l.value ->> 'technical_strap_line_id' = v_line_id::text
          OR l.value ->> 'id' = v_line_id::text
       LIMIT 1;
      IF v_in_line IS NULL THEN
        SELECT l.value INTO v_in_line
          FROM jsonb_array_elements(v_in_lines) l(value)
         WHERE coalesce(l.value ->> 'technical_strap_line_id', '') = ''
           AND upper(trim(coalesce(l.value ->> 'label', ''))) = upper(v_label)
         LIMIT 1;
      END IF;
      v_in_line := coalesce(v_in_line, '{}'::jsonb);

      -- Grupo de estoque = tipo de tira (R1, R4).
      v_gid := NULL;
      BEGIN
        v_gid := coalesce(
          nullif(v_sheet_line ->> 'group_id', '')::uuid,
          nullif(v_sheet_line ->> 'identity_group_id', '')::uuid
        );
      EXCEPTION WHEN OTHERS THEN
        v_gid := NULL;
      END;
      IF v_gid IS NULL THEN
        RAISE EXCEPTION 'a ficha não diz qual tira (grupo de estoque) usar — corrija a ficha técnica';
      END IF;
      SELECT * INTO v_group FROM public.product_groups g WHERE g.id = v_gid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'o grupo de estoque da tira não existe mais — corrija a ficha técnica';
      END IF;

      -- Cor.
      v_color_mode := coalesce(
        nullif(v_sheet_line ->> 'color_mode', ''),
        CASE WHEN coalesce(v_group.strap_uses_napa, true) THEN 'follow_main' ELSE 'select_on_order' END
      );
      IF v_color_mode NOT IN ('follow_main', 'select_on_order') THEN
        RAISE EXCEPTION 'a ficha tem política de cor inválida nesta tira';
      END IF;
      v_color_id := NULL;
      IF v_color_mode = 'follow_main' THEN
        v_color_id := public.resolve_strap_canonical_color_id(p_item ->> 'color');
        IF v_color_id IS NULL THEN
          RAISE EXCEPTION 'a cor do item não corresponde a uma única cor cadastrada';
        END IF;
      ELSE
        BEGIN
          v_color_id := nullif(v_in_line ->> 'color_id', '')::uuid;
        EXCEPTION WHEN OTHERS THEN
          v_color_id := NULL;
        END;
        IF v_color_id IS NULL AND nullif(trim(v_in_line ->> 'color'), '') IS NOT NULL THEN
          v_color_id := public.resolve_strap_canonical_color_id(v_in_line ->> 'color');
          IF v_color_id IS NULL THEN
            RAISE EXCEPTION 'a cor "%" não corresponde a uma única cor cadastrada', trim(v_in_line ->> 'color');
          END IF;
        END IF;
        IF v_color_id IS NULL THEN
          RAISE EXCEPTION 'escolha a cor desta tira no PV';
        END IF;
      END IF;
      SELECT c.name INTO v_color_name FROM public.canonical_colors c WHERE c.id = v_color_id AND c.active;
      IF v_color_name IS NULL THEN
        RAISE EXCEPTION 'a cor escolhida para a tira não existe ou está inativa';
      END IF;

      -- Napa-base (só grupo feito de napa). O resolvedor da referência preserva o
      -- ramo napas_da_referencia_por_tira_20270101035700 (napa por tira).
      v_ctx := NULL;
      v_napa := NULL;
      IF coalesce(v_group.strap_uses_napa, true) THEN
        v_selected_napa := NULL;
        BEGIN
          v_selected_napa := nullif(v_in_line ->> 'base_group_id', '')::uuid;
        EXCEPTION WHEN OTHERS THEN
          v_selected_napa := NULL;
        END;
        v_ctx := private.resolve_technical_strap_material(
          v_reference_id, v_variant_id, v_line_id, v_selected_napa, true
        );
        v_napa := nullif(v_ctx ->> 'base_group_id', '')::uuid;
        -- Napa desconhecida não trava o PV: a chave cai no SKU sem napa (R7a).
      END IF;

      -- Origem: escolha explícita do PV na exceção > grupo > Comprar pronto (R9).
      v_explicit_origin := CASE v_in_line ->> 'pv_origem'
        WHEN 'sku_acabado' THEN 'comprar_pronto'
        WHEN 'comprar_pronto' THEN 'comprar_pronto'
        WHEN 'fabrica' THEN 'fabrica'
        WHEN 'prestador' THEN 'prestador'
        ELSE NULL
      END;
      v_origin := coalesce(v_explicit_origin, v_group.strap_origin, 'comprar_pronto');

      v_sku := private.resolve_strap_sku(v_gid, v_napa, v_color_id, NOT p_dry_run);
      v_required := private.strap_line_required_m(v_sheet_line, v_grade, v_qty);

      v_line_out := (
        v_sheet_line
          - 'identity_basis' - 'identity_group_id' - 'measure_id' - 'strap_type_id'
          - 'internal_production_enabled' - 'color' - 'color_id' - 'base_group_id'
          - 'base_group_name' - 'pv_origem' - 'group_name' - 'id' - 'label'
      ) || jsonb_build_object(
        'id', v_line_id,
        'technical_strap_line_id', v_line_id,
        'label', v_label,
        'group_id', v_gid,
        'group_name', v_group.name,
        'color_mode', v_color_mode,
        'color', v_color_name,
        'color_id', v_color_id,
        'base_group_id', v_napa,
        'base_group_name', v_sku ->> 'napa_name'
      ) || CASE WHEN v_explicit_origin IS NOT NULL
                THEN jsonb_build_object('pv_origem', v_explicit_origin)
                ELSE '{}'::jsonb END
        || CASE WHEN v_ctx IS NOT NULL THEN jsonb_build_object(
             'material_mode', v_ctx -> 'material_mode',
             'material_group_id', v_ctx -> 'material_group_id',
             'allowed_material_group_ids', v_ctx -> 'allowed_material_group_ids'
           ) ELSE '{}'::jsonb END;

      v_sourcing := v_sourcing || jsonb_build_object(v_line_id::text, jsonb_build_object(
        'origin', v_origin,
        'source_mode', CASE WHEN v_origin = 'comprar_pronto' THEN 'buy_ready' ELSE 'internal' END,
        'color_id', v_color_id,
        'base_group_id', v_napa,
        'base_group_name', v_sku ->> 'napa_name',
        'product_id', v_sku -> 'product_id',
        'finished_product_id', v_sku -> 'product_id',
        'product_name', v_sku ->> 'product_name',
        'sku_match', v_sku ->> 'match',
        'required_m', v_required
      ));
      v_report := v_report || jsonb_build_array(jsonb_build_object(
        'technical_strap_line_id', v_line_id,
        'label', v_label,
        'status', CASE v_sku ->> 'match'
                    WHEN 'would_create' THEN 'create_sku'
                    WHEN 'created' THEN 'created'
                    ELSE 'ok' END,
        'group_id', v_gid,
        'group_name', v_group.name,
        'uses_napa', coalesce(v_group.strap_uses_napa, true),
        'napa_group_id', v_napa,
        'napa_name', v_sku ->> 'napa_name',
        'color_mode', v_color_mode,
        'color_id', v_color_id,
        'color_name', v_color_name,
        'product_id', v_sku -> 'product_id',
        'product_name', v_sku ->> 'product_name',
        'sku_match', v_sku ->> 'match',
        'origin', v_origin,
        'required_m', v_required
      ));
      IF v_sku ->> 'match' = 'created' THEN
        v_created := v_created || jsonb_build_array(jsonb_build_object(
          'product_id', v_sku -> 'product_id', 'product_name', v_sku ->> 'product_name'
        ));
      END IF;
      v_out_lines := v_out_lines || jsonb_build_array(v_line_out);
    EXCEPTION WHEN OTHERS THEN
      IF p_dry_run THEN
        v_report := v_report || jsonb_build_array(jsonb_build_object(
          'technical_strap_line_id', v_line_id,
          'label', v_label,
          'status', 'pending',
          'message', SQLERRM
        ));
        v_out_lines := v_out_lines || jsonb_build_array(coalesce(nullif(v_in_line, '{}'::jsonb), v_sheet_line));
      ELSE
        -- R10: todo erro de tira diz modelo, cor do item e nome da tira.
        RAISE EXCEPTION 'Modelo % / %, %: %', v_model, v_item_color, v_label, SQLERRM
          USING ERRCODE = SQLSTATE;
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'item', p_item || jsonb_build_object(
      'strap_colors', v_out_lines,
      'strap_sourcing', v_sourcing
    ),
    'ensured', '[]'::jsonb,
    'lines_report', v_report,
    'created_skus', v_created
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.prepare_sale_order_item_straps_v2(jsonb, boolean) FROM PUBLIC;

-- ── Necessidade de tira do item (ou de uma OP do item) ─────────────────────
-- Lê o snapshot congelado no item (linha + SKU resolvido). p_grade/p_quantity
-- permitem calcular a parte de uma OP; nulos = o item inteiro.
CREATE OR REPLACE FUNCTION public.sale_order_item_strap_needs(
  p_item_id uuid,
  p_grade jsonb DEFAULT NULL,
  p_quantity numeric DEFAULT NULL
) RETURNS TABLE(
  technical_strap_line_id uuid,
  label text,
  product_id uuid,
  product_name text,
  required_m numeric,
  origin text,
  group_id uuid,
  base_group_id uuid,
  color_id uuid
)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_item public.sale_order_items%ROWTYPE;
  v_line jsonb;
  v_src jsonb;
  v_lid text;
BEGIN
  SELECT * INTO v_item FROM public.sale_order_items i WHERE i.id = p_item_id;
  IF NOT FOUND OR jsonb_typeof(v_item.strap_colors) IS DISTINCT FROM 'array' THEN
    RETURN;
  END IF;
  FOR v_line IN SELECT l.value FROM jsonb_array_elements(v_item.strap_colors) l(value)
  LOOP
    v_lid := coalesce(nullif(v_line ->> 'technical_strap_line_id', ''), v_line ->> 'id');
    v_src := coalesce(v_item.strap_sourcing, '{}'::jsonb) -> v_lid;
    IF v_src IS NULL OR coalesce(v_src ->> 'product_id', '') !~* '^[0-9a-f-]{36}$' THEN
      CONTINUE;
    END IF;
    technical_strap_line_id := v_lid::uuid;
    label := coalesce(nullif(v_line ->> 'label', ''), 'TIRA');
    product_id := (v_src ->> 'product_id')::uuid;
    product_name := v_src ->> 'product_name';
    required_m := private.strap_line_required_m(
      v_line,
      coalesce(p_grade, v_item.grade),
      coalesce(p_quantity, v_item.quantity::numeric)
    );
    origin := coalesce(nullif(v_src ->> 'origin', ''), 'comprar_pronto');
    group_id := nullif(v_line ->> 'group_id', '')::uuid;
    base_group_id := nullif(v_src ->> 'base_group_id', '')::uuid;
    color_id := nullif(v_src ->> 'color_id', '')::uuid;
    IF required_m > 0 THEN
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.sale_order_item_strap_needs(uuid, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sale_order_item_strap_needs(uuid, jsonb, numeric) TO authenticated;

-- ── Prévia da resolução de tiras (checagem prévia do Duplicar, R28/R29) ────
-- Recebe itens no formato do payload do PV ({reference_id, material_variant_id,
-- color, quantity, grade, strap_colors}). Para cada item devolve, por tira:
--   ok          resolve para SKU existente (exato ou SKU antigo sem napa);
--   create_sku  vai criar SKU novo (aviso, não bloqueia) + `alternatives`: cores do
--               mesmo grupo/napa que já têm SKU ativo;
--   pending     o save vai recusar (cor/material a escolher, ficha incompleta) —
--               bloqueia a confirmação.
CREATE OR REPLACE FUNCTION public.preview_sale_order_strap_resolution(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_item jsonb;
  v_ord bigint;
  v_res jsonb;
  v_line jsonb;
  v_lines jsonb;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial']) THEN
    RAISE EXCEPTION 'Somente Comercial/Gerência pode conferir as tiras do PV'
      USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_items deve ser array';
  END IF;

  FOR v_item, v_ord IN
    SELECT i.value, i.ordinality FROM jsonb_array_elements(p_items) WITH ORDINALITY i(value, ordinality)
  LOOP
    BEGIN
      v_res := private.prepare_sale_order_item_straps_v2(v_item - 'id', true);
      v_lines := '[]'::jsonb;
      FOR v_line IN SELECT l.value FROM jsonb_array_elements(v_res -> 'lines_report') l(value)
      LOOP
        IF v_line ->> 'status' = 'create_sku' THEN
          v_line := v_line || jsonb_build_object('alternatives', (
            SELECT coalesce(jsonb_agg(alt ORDER BY alt ->> 'color_name'), '[]'::jsonb)
              FROM (
                SELECT DISTINCT ON (cid)
                       jsonb_build_object(
                         'color_id', cid, 'color_name', c.name,
                         'product_id', p.id, 'product_name', p.name, 'quantity', p.quantity
                       ) AS alt
                  FROM public.products p
                  CROSS JOIN LATERAL (SELECT public.resolve_strap_canonical_color_id(p.color) AS cid) rc
                  JOIN public.canonical_colors c ON c.id = rc.cid AND c.active
                 WHERE p.active
                   AND p.group_id = (v_line ->> 'group_id')::uuid
                   AND (
                     p.strap_base_group_id IS NOT DISTINCT FROM nullif(v_line ->> 'napa_group_id', '')::uuid
                     OR p.strap_base_group_id IS NULL
                   )
                 ORDER BY cid, (p.strap_base_group_id IS NULL), p.quantity DESC NULLS LAST
              ) s
          ));
        END IF;
        v_lines := v_lines || jsonb_build_array(v_line);
      END LOOP;
      v_out := v_out || jsonb_build_array(jsonb_build_object('index', v_ord - 1, 'lines', v_lines));
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'index', v_ord - 1, 'lines', '[]'::jsonb, 'error', SQLERRM
      ));
    END;
  END LOOP;
  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_sale_order_strap_resolution(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_sale_order_strap_resolution(jsonb) TO authenticated;
