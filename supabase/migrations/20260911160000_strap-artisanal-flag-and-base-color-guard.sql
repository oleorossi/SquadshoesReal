-- Tira artesanal: is_artisanal consistente por grupo + guards em /diagnostics.
--
-- CONTEXTO (auditoria PV-00146, 2026-07-10, Issue B): produtos do MESMO grupo com
-- receita artesanal ativa (ex.: "Tira chata 8mm", "TIRA OVERLOCK 5MM") tinham
-- `is_artisanal` INCONSISTENTE entre cores. As tiras artesanais (cortadas de napa)
-- só são convertidas pro material BASE (NAPA SOFT ÷ yield) no canal de Compras/MRP
-- quando is_artisanal=true; as flageadas false ficavam como "tira crua" não-comprável
-- (sem fornecedor), divergindo do que o outro relatório mostrava.
--
-- User confirmou: essas tiras SÃO cortadas de napa → is_artisanal deve ser true.
-- is_artisanal é lido SÓ pelos motores de COMPRA/MRP (auto_create_purchase_order,
-- get_purchase_projection, get_wave_material_needs, compute_materials_per_pv) —
-- nenhum caminho de débito/reserva/estoque — então o flip é seguro.

-- 1) Backfill: todo produto ativo cujo GRUPO tem receita artesanal ativa é artesanal.
UPDATE public.products p
   SET is_artisanal = true
  FROM public.product_groups g, public.artisanal_recipes ar
 WHERE p.group_id = g.id
   AND ar.active = true
   AND lower(trim(extensions.unaccent(ar.artisanal_product_name))) = lower(trim(extensions.unaccent(g.name)))
   AND p.active = true
   AND COALESCE(p.is_artisanal, false) = false;

-- 2) Guards no relatório de /diagnostics:
--    (a) produto em grupo com receita artesanal ativa mas is_artisanal=false
--        (reintroduz a inconsistência — trava recorrência do flip acima);
--    (b) tira artesanal cuja napa BASE não existe cadastrada NA COR do produto
--        (ex.: "Tira chata 8mm: CAPUCCINO" sem "NAPA SOFT CAPUCCINO") → Compras não
--        consegue converter tira→napa e a linha fica como tira crua. Ação: cadastrar
--        o produto base na cor.
CREATE OR REPLACE FUNCTION public.consumption_consistency_report()
 RETURNS TABLE(check_name text, severity text, item_count integer, sample text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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

  -- Forração cabedal duplicada com palmilha (anti-duplicidade, mig 20260911120000).
  RETURN QUERY
  SELECT 'forro_cabedal_duplicado_com_palmilha'::text, 'baixo'::text, count(*)::int,
    COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM public.technical_sheets ts
   WHERE COALESCE(ts.sole_drives_consumption,false) = true
     AND COALESCE(ts.lining_consumption,0) > 0
     AND ts.primary_sole_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.sole_technical_specs sts
                  WHERE sts.sole_id = ts.primary_sole_id AND COALESCE(sts.insole_lining_consumption_dm2,0) > 0)
     AND NOT EXISTS (SELECT 1 FROM public.sole_technical_specs sts
                  WHERE sts.sole_id = ts.primary_sole_id AND COALESCE(sts.lining_consumption_dm2,0) > 0);

  -- (a) Produto artesanal com flag inconsistente (grupo tem receita, produto não é artesanal).
  RETURN QUERY
  SELECT 'produto_artesanal_flag_inconsistente'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(p.name, ' · ' ORDER BY p.name), '—')
    FROM public.products p
    JOIN public.product_groups g ON g.id = p.group_id
    JOIN public.artisanal_recipes ar ON ar.active = true
      AND lower(trim(extensions.unaccent(ar.artisanal_product_name))) = lower(trim(extensions.unaccent(g.name)))
   WHERE p.active = true AND COALESCE(p.is_artisanal, false) = false;

  -- (b) Tira artesanal cuja napa base não existe cadastrada na cor → Compras não converte.
  RETURN QUERY
  SELECT 'material_base_artesanal_sem_cor'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(p.name || ' → ' || ar.base_product_name, ' · ' ORDER BY p.name), '—')
    FROM public.products p
    JOIN public.product_groups g ON g.id = p.group_id
    JOIN public.artisanal_recipes ar ON ar.active = true
      AND lower(trim(extensions.unaccent(ar.artisanal_product_name))) = lower(trim(extensions.unaccent(g.name)))
   WHERE p.active = true AND COALESCE(p.is_artisanal, false) = true
     AND COALESCE(p.color, '') <> ''
     AND NOT EXISTS (
       SELECT 1 FROM public.products bp
       LEFT JOIN public.product_groups bg ON bg.id = bp.group_id
       WHERE bp.active = true
         AND (lower(trim(extensions.unaccent(COALESCE(bg.name,'')))) = lower(trim(extensions.unaccent(ar.base_product_name)))
              OR lower(trim(extensions.unaccent(bp.name))) = lower(trim(extensions.unaccent(ar.base_product_name))))
         AND lower(trim(extensions.unaccent(COALESCE(bp.color,'')))) = lower(trim(extensions.unaccent(p.color))));
END;
$function$;
