-- Auditoria de consumo — B1 + M2. Aplicado via MCP em 2026-06-23 (ssvxfoybzmjlypnipqzn).
--
-- B1: get_material_conversion_info só emite o aviso "100x errado" quando o produto
--     linear sem largura TEM component_sheet (material de área que deveria ter largura).
--     Tira/elástico linear direto no BOM (sem component_sheet) NÃO converte → o aviso
--     era falso-positivo (a math já está correta, dm2_per_unit=1).
--
-- M2: consumption_consistency_report ganha 2 guards de plausibilidade que teriam pego
--     A1 (forro per-size 0,5 vs escalar 5,7) e A2 (elástico 2000):
--       · persize_diverge_do_escalar: avg(per-size) >3× ou <1/3 do escalar.
--       · consumo_implausivel_alto: cabedal/forro/palmilha > 100 por par (absurdo).
--     Não altera a regra de primário (per-size vence) — só sinaliza no /diagnostics.

CREATE OR REPLACE FUNCTION public.get_material_conversion_info(p_product_id uuid)
 RETURNS TABLE(dm2_per_unit numeric, waste_pct numeric, target_unit text, conversion_warning text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_width numeric; v_length numeric; v_dim numeric; v_dim_unit text;
  v_prod_unit text; v_waste numeric; v_group_id uuid; v_is_linear boolean;
  v_has_cs boolean;
BEGIN
  SELECT unit, group_id INTO v_prod_unit, v_group_id FROM public.products WHERE id = p_product_id;
  SELECT dimensions_width, dimensions_length, dimensions_unit, cs.waste_pct
    INTO v_width, v_length, v_dim_unit, v_waste
    FROM public.component_sheets cs WHERE cs.product_id = p_product_id;
  v_dim := GREATEST(COALESCE(v_width, 0), COALESCE(v_length, 0));
  IF v_dim <= 0 THEN
    SELECT GREATEST(COALESCE(cs.dimensions_width,0), COALESCE(cs.dimensions_length,0)),
           cs.dimensions_unit, COALESCE(v_waste, cs.waste_pct)
      INTO v_dim, v_dim_unit, v_waste
      FROM public.component_sheets cs
      WHERE cs.group_id = v_group_id
        AND GREATEST(COALESCE(cs.dimensions_width,0), COALESCE(cs.dimensions_length,0)) > 0
      LIMIT 1;
  END IF;
  v_waste := COALESCE(v_waste, 8);
  v_prod_unit := LOWER(v_prod_unit);
  v_is_linear := v_prod_unit IN ('m','meters','metros','mt','cm');
  IF v_is_linear THEN
    IF v_dim IS NOT NULL AND v_dim > 0 THEN
      IF LOWER(v_dim_unit) = 'cm' THEN v_dim := v_dim * 10;
      ELSIF LOWER(v_dim_unit) = 'm' THEN v_dim := v_dim * 1000; END IF;
      dm2_per_unit := v_dim / 10;
      IF v_prod_unit = 'cm' THEN dm2_per_unit := dm2_per_unit / 100; END IF;
      conversion_warning := NULL;
    ELSE
      dm2_per_unit := 1;
      SELECT EXISTS (SELECT 1 FROM public.component_sheets cs
                     WHERE cs.product_id = p_product_id OR cs.group_id = v_group_id)
        INTO v_has_cs;
      IF v_has_cs THEN
        conversion_warning := 'Material em "' || v_prod_unit || '" sem dimensions_width em component_sheets. '
          'Resultado pode estar 100x errado. Configurar largura em Materiais > Ficha de Componente.';
      ELSE
        conversion_warning := NULL;  -- item linear direto (tira/elástico), não converte
      END IF;
    END IF;
  ELSE
    dm2_per_unit := 1;
    conversion_warning := NULL;
  END IF;
  waste_pct := v_waste;
  target_unit := v_prod_unit;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consumption_consistency_report()
 RETURNS TABLE(check_name text, severity text, item_count integer, sample text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY SELECT 'material_linear_sem_largura'::text, 'alto'::text, COALESCE(count(*),0)::int,
    COALESCE(string_agg(product_name || ' ('||product_unit||')', ' · ' ORDER BY product_name), '—')
    FROM (SELECT * FROM public.list_materials_missing_width() LIMIT 200) m;

  RETURN QUERY SELECT 'palmilha_pronta_com_consumo_area'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM public.technical_sheets ts WHERE ts.insole_ready_made = true AND COALESCE(ts.insole_consumption,0) > 1;

  RETURN QUERY SELECT 'solado_dirige_consumo_sem_specs'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM public.technical_sheets ts WHERE ts.sole_drives_consumption = true AND ts.primary_sole_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.sole_technical_specs sts WHERE sts.sole_id = ts.primary_sole_id);

  RETURN QUERY SELECT 'solado_fachetado_sem_specs_fachete'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(p.name, ' · ' ORDER BY p.name), '—')
    FROM public.products p WHERE p.is_fachetado = true AND lower(COALESCE(p.category,'')) LIKE '%solado%'
      AND NOT EXISTS (SELECT 1 FROM public.sole_technical_specs sts WHERE sts.sole_id = p.id AND COALESCE(sts.fachete_lining_consumption_dm2,0) > 0);

  RETURN QUERY
  WITH persize AS (
    SELECT ts.name, 'cabedal' AS comp, ts.upper_consumption AS escalar,
           (SELECT avg(NULLIF(v,'')::numeric) FROM jsonb_each_text(ts.upper_consumption_per_size) e(k,v) WHERE NULLIF(v,'')::numeric > 0) AS media
      FROM public.technical_sheets ts WHERE jsonb_typeof(ts.upper_consumption_per_size)='object'
    UNION ALL
    SELECT ts.name, 'forro', ts.lining_consumption,
           (SELECT avg(NULLIF(v,'')::numeric) FROM jsonb_each_text(ts.lining_consumption_per_size) e(k,v) WHERE NULLIF(v,'')::numeric > 0)
      FROM public.technical_sheets ts WHERE jsonb_typeof(ts.lining_consumption_per_size)='object'
    UNION ALL
    SELECT ts.name, 'palmilha', ts.insole_consumption,
           (SELECT avg(NULLIF(v,'')::numeric) FROM jsonb_each_text(ts.insole_consumption_per_size) e(k,v) WHERE NULLIF(v,'')::numeric > 0)
      FROM public.technical_sheets ts WHERE jsonb_typeof(ts.insole_consumption_per_size)='object'
  )
  SELECT 'persize_diverge_do_escalar'::text, 'alto'::text, count(*)::int,
         COALESCE(string_agg(name||' ('||comp||' '||round(media,2)||'<>'||round(escalar,2)||')', ' · ' ORDER BY name), '—')
    FROM persize
   WHERE media IS NOT NULL AND escalar IS NOT NULL AND escalar > 0
     AND (media > escalar * 3 OR media < escalar / 3.0);

  RETURN QUERY
  SELECT 'consumo_implausivel_alto'::text, 'alto'::text, count(*)::int,
         COALESCE(string_agg(name||' ('||comp||' '||round(val,0)||')', ' · ' ORDER BY name), '—')
    FROM (
      SELECT ts.name, 'cabedal' AS comp, GREATEST(COALESCE(ts.upper_consumption,0),
        COALESCE((SELECT max(NULLIF(v,'')::numeric) FROM jsonb_each_text(CASE WHEN jsonb_typeof(ts.upper_consumption_per_size)='object' THEN ts.upper_consumption_per_size ELSE '{}'::jsonb END) e(k,v)),0)) AS val
        FROM public.technical_sheets ts
      UNION ALL
      SELECT ts.name, 'forro', GREATEST(COALESCE(ts.lining_consumption,0),
        COALESCE((SELECT max(NULLIF(v,'')::numeric) FROM jsonb_each_text(CASE WHEN jsonb_typeof(ts.lining_consumption_per_size)='object' THEN ts.lining_consumption_per_size ELSE '{}'::jsonb END) e(k,v)),0))
        FROM public.technical_sheets ts
      UNION ALL
      SELECT ts.name, 'palmilha', GREATEST(COALESCE(ts.insole_consumption,0),
        COALESCE((SELECT max(NULLIF(v,'')::numeric) FROM jsonb_each_text(CASE WHEN jsonb_typeof(ts.insole_consumption_per_size)='object' THEN ts.insole_consumption_per_size ELSE '{}'::jsonb END) e(k,v)),0))
        FROM public.technical_sheets ts
    ) x
   WHERE val > 100;
END;
$function$;
