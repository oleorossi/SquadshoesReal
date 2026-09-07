-- Auditoria somente-leitura: I704 + variante Glow Metallic → napa-base das tiras.
-- Não grava nada. Rode no SQL Editor (projeto ssvxfoybzmjlypnipqzn) ou via psql.
--
-- Interpretação:
--   ok_resolve_glow     = resolve_strap_base_group_id(I704, glow) → GLOW METALIC
--   follow_reference    = posição herda a napa da variante no save do PV
--   fixed/select/finished = NÃO herdam Glow (regra de produto)
--   recipe_ok / sku_ok  = cadastro permite materializar intent + debitar a cor
BEGIN READ ONLY;

DO $audit$
DECLARE
  v_ref uuid;
  v_ref_name text;
  v_has_straps boolean;
  v_upper text;
  v_lining text;
  v_upper_gid uuid;
  v_strap_base uuid;
  v_drives_lining boolean;
  v_drives_upper boolean;
  v_variant uuid;
  v_variant_name text;
  v_main uuid;
  v_var_lining uuid;
  v_var_upper uuid;
  v_glow uuid;
  v_resolved uuid;
  v_resolved_name text;
  v_line jsonb;
  v_idx int := 0;
  v_basis text;
  v_mode text;
  v_color_mode text;
  v_label text;
  v_measure text;
  v_recipe_ok boolean;
  v_sku_count int;
  v_follow_count int := 0;
  v_other_count int := 0;
  v_gaps text[] := ARRAY[]::text[];
BEGIN
  SELECT ts.id, ts.name, coalesce(ts.has_straps, false),
         nullif(btrim(ts.upper_material), ''),
         nullif(btrim(ts.lining_material), ''),
         ts.upper_material_group_id, ts.strap_base_group_id,
         coalesce(ts.variant_drives_lining, false),
         coalesce(ts.variant_drives_upper, false)
    INTO v_ref, v_ref_name, v_has_straps, v_upper, v_lining, v_upper_gid,
         v_strap_base, v_drives_lining, v_drives_upper
    FROM public.technical_sheets ts
   WHERE upper(btrim(ts.name)) IN ('I704', '704')
      OR upper(btrim(coalesce(ts.code, ''))) IN ('I704', '704')
   ORDER BY CASE WHEN upper(btrim(ts.name)) = 'I704' THEN 0 ELSE 1 END
   LIMIT 1;

  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'Referência I704 não encontrada em technical_sheets.';
  END IF;

  SELECT id INTO v_glow
    FROM public.product_groups
   WHERE upper(btrim(name)) IN ('GLOW METALIC', 'GLOW METALLIC')
   ORDER BY CASE WHEN upper(btrim(name)) = 'GLOW METALIC' THEN 0 ELSE 1 END
   LIMIT 1;

  IF v_glow IS NULL THEN
    RAISE EXCEPTION 'Grupo GLOW METALIC não encontrado.';
  END IF;

  SELECT rmv.id, rmv.material_name, rmv.main_material_group_id,
         rmv.lining_material_group_id, rmv.upper_material_group_id
    INTO v_variant, v_variant_name, v_main, v_var_lining, v_var_upper
    FROM public.reference_material_variants rmv
   WHERE rmv.reference_id = v_ref
     AND coalesce(rmv.active, true)
     AND (
       rmv.main_material_group_id = v_glow
       OR rmv.lining_material_group_id = v_glow
       OR rmv.upper_material_group_id = v_glow
       OR upper(coalesce(rmv.material_name, '')) LIKE '%GLOW%'
     )
   ORDER BY rmv.sort_order NULLS LAST, rmv.created_at
   LIMIT 1;

  IF v_variant IS NULL THEN
    SELECT rmv.id, rmv.material_name, rmv.main_material_group_id,
           rmv.lining_material_group_id, rmv.upper_material_group_id
      INTO v_variant, v_variant_name, v_main, v_var_lining, v_var_upper
      FROM public.reference_material_variants rmv
     WHERE rmv.reference_id = v_ref AND coalesce(rmv.active, true)
     ORDER BY rmv.sort_order NULLS LAST, rmv.created_at
     LIMIT 1;
  END IF;

  IF v_variant IS NULL THEN
    RAISE EXCEPTION 'I704 (%) sem variante ativa.', v_ref_name;
  END IF;

  v_resolved := public.resolve_strap_base_group_id(v_ref, v_variant);
  SELECT name INTO v_resolved_name FROM public.product_groups WHERE id = v_resolved;

  RAISE NOTICE '=== I704 GLOW STRAPS AUDIT ===';
  RAISE NOTICE 'ref=% name=% has_straps=%', v_ref, v_ref_name, v_has_straps;
  RAISE NOTICE 'upper=% lining=% upper_gid=% strap_base=%',
    coalesce(v_upper, '<vazio>'), coalesce(v_lining, '<vazio>'), v_upper_gid, v_strap_base;
  RAISE NOTICE 'variant_drives_upper=% variant_drives_lining=%', v_drives_upper, v_drives_lining;
  RAISE NOTICE 'variant=% (%) main=% lining_pin=% upper_pin=%',
    v_variant, v_variant_name, v_main, v_var_lining, v_var_upper;
  RAISE NOTICE 'resolve_strap_base_group_id → % (%)', v_resolved, coalesce(v_resolved_name, '<null>');
  RAISE NOTICE 'ok_resolve_glow=%', (v_resolved = v_glow);

  IF NOT v_has_straps THEN
    v_gaps := array_append(v_gaps, 'has_straps=false — motor de tiras artesanais não governa esta ficha');
  END IF;
  IF v_resolved IS DISTINCT FROM v_glow THEN
    v_gaps := array_append(v_gaps,
      format('resolve devolve %s em vez de GLOW METALIC — pin lining da variante ou variant_drives_lining',
             coalesce(v_resolved_name, 'NULL')));
  END IF;

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(
      coalesce((SELECT strap_colors FROM public.technical_sheets WHERE id = v_ref), '[]'::jsonb)
    )
  LOOP
    v_idx := v_idx + 1;
    v_basis := coalesce(nullif(btrim(v_line ->> 'identity_basis'), ''), 'reference_base');
    v_mode := coalesce(nullif(btrim(v_line ->> 'material_mode'), ''), 'follow_reference');
    v_color_mode := coalesce(nullif(btrim(v_line ->> 'color_mode'), ''), 'follow_main');
    v_label := coalesce(v_line ->> 'label', v_line ->> 'group_name', format('#%s', v_idx));
    v_measure := coalesce(v_line ->> 'measure_id', v_line ->> 'group_name', '?');

    IF v_basis = 'reference_base' AND v_mode = 'follow_reference' THEN
      v_follow_count := v_follow_count + 1;
      SELECT EXISTS (
        SELECT 1 FROM public.artisanal_strap_recipes r
         WHERE r.base_group_id = v_glow
           AND r.status = 'approved'
           AND (v_line ->> 'measure_id') IS NOT NULL
           AND r.measure_id = (v_line ->> 'measure_id')::uuid
           AND r.valid_from <= now()
           AND (r.valid_to IS NULL OR r.valid_to > now())
      ) INTO v_recipe_ok;
      IF (v_line ->> 'measure_id') IS NULL THEN
        v_recipe_ok := EXISTS (
          SELECT 1 FROM public.artisanal_strap_recipes r
           WHERE r.base_group_id = v_glow AND r.status = 'approved'
             AND r.valid_from <= now()
             AND (r.valid_to IS NULL OR r.valid_to > now())
        );
      END IF;
      IF NOT coalesce(v_recipe_ok, false) THEN
        v_gaps := array_append(v_gaps,
          format('posição %s (%s): sem receita aprovada medida×GLOW METALIC', v_label, v_measure));
      END IF;
    ELSE
      v_other_count := v_other_count + 1;
    END IF;

    RAISE NOTICE 'strap[%] label=% basis=% material_mode=% color_mode=% inherits_glow=%',
      v_idx, v_label, v_basis, v_mode, v_color_mode,
      (v_basis = 'reference_base' AND v_mode = 'follow_reference' AND v_resolved = v_glow);
  END LOOP;

  SELECT count(*)::int INTO v_sku_count
    FROM public.products p
   WHERE p.group_id = v_glow AND coalesce(p.active, true);

  RAISE NOTICE 'follow_reference_positions=% other_positions=% glow_active_skus=%',
    v_follow_count, v_other_count, v_sku_count;

  IF v_sku_count = 0 THEN
    v_gaps := array_append(v_gaps, 'GLOW METALIC sem SKU ativo — PV sem cores / débito impossível');
  END IF;

  IF coalesce(array_length(v_gaps, 1), 0) = 0 THEN
    RAISE NOTICE 'VEREDITO: OK — follow_reference herda GLOW; cadastro de receita/SKU parece suficiente.';
  ELSE
    RAISE NOTICE 'VEREDITO: GAPS (%)', array_length(v_gaps, 1);
    FOR v_idx IN 1 .. array_length(v_gaps, 1) LOOP
      RAISE NOTICE '  - %', v_gaps[v_idx];
    END LOOP;
  END IF;
END
$audit$;

ROLLBACK;
