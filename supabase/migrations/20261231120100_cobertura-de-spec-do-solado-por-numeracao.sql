-- ============================================================================
-- COBERTURA de spec do solado por NUMERAÇÃO — não basta "tem spec"
-- ============================================================================
--
-- `consumption_consistency_report()` tinha um ponto cego: o check
-- `solado_dirige_consumo_sem_specs` pergunta se EXISTE alguma linha em
-- `sole_technical_specs` para o solado. Existindo uma, ele dá verde.
--
-- O que estava acontecendo (auditoria 07/08/2026):
--   Os 3 solados que dirigem consumo — `01`, `INFANTIL`, `180 SALTO BLOCO` —
--   têm specs SÓ para 34-40. O `INFANTIL` inclusive tem estoque cadastrado na
--   faixa 23-36: as specs 34-40 foram copiadas do adulto. As fichas infantis
--   (I90, I100, I110, I50, 120, 140, 170...) vendem 25-34.
--
--   Para todo tamanho sem linha de spec o motor cai no escalar da ficha. E
--   `insole_lining_consumption` é NULL ou 0 em 26 das 27 fichas com
--   `sole_drives_consumption` (só a SP105 tem valor) ⇒ o forro da palmilha
--   contribui **ZERO** nesses tamanhos.
--
--   Caso vivo: PV-00151 / I90 OFF WHITE, 180 pares na grade 28-34. O snapshot
--   congelou `Forração Palmilha = 1,000 m` — só os 24 pares do nº 34 entraram.
--   156 dos 180 pares saíram da fábrica sem débito de forro (~7,5x a menos).
--
--   Alcance medido: 6.148 pares vendidos em tamanhos 25-33 sem linha de spec,
--   contra 25.112 pares em 34-40 com spec (~20% do volume).
--
-- ⚠ Esta migration NÃO inventa os dm² que faltam — isso é dado de engenharia
-- do dono. Ela faz o gap PARAR DE SER SILENCIOSO e entrega a lista exata do
-- que precisa ser preenchido. Extrapolar consumo por numeração seria fabricar
-- número de cadastro dentro de uma migration.
-- ============================================================================

-- ── Lista acionável: que numeração falta em qual solado, e quanto já foi vendido
CREATE OR REPLACE FUNCTION public.list_sole_spec_gaps()
 RETURNS TABLE(
   solado text, solado_id uuid, numeracao integer, pares_vendidos numeric,
   fichas text, pvs text, forro_palmilha_zera boolean
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH vendido AS (
    SELECT ts.primary_sole_id AS sole_id,
           e.key::int          AS numeracao,
           ts.name             AS ficha,
           so.order_number     AS pv,
           e.value::numeric * COALESCE(soi.fichas, 1) AS pares,
           -- o forro da palmilha zera quando a ficha não tem escalar nem
           -- per_size próprio: sem spec do solado, nada sobra pra multiplicar
           COALESCE(ts.insole_lining_consumption, 0) = 0
             AND COALESCE(NULLIF(ts.insole_lining_consumption_per_size::text, '{}'), '') = ''
             AND COALESCE(ts.insole_has_lining, true) = true
             AND COALESCE(ts.insole_ready_made, false) = false AS zera_forro
      FROM public.sale_order_items soi
      JOIN public.sale_orders so     ON so.id = soi.sale_order_id
      JOIN public.technical_sheets ts ON ts.id = soi.reference_id
      CROSS JOIN LATERAL jsonb_each_text(soi.grade) e
     WHERE COALESCE(ts.sole_drives_consumption, false) = true
       AND ts.primary_sole_id IS NOT NULL
       AND so.status <> 'Cancelado'
       AND e.key ~ '^[0-9]+$'
       AND e.value::numeric > 0
  )
  SELECT p.name, v.sole_id, v.numeracao,
         SUM(v.pares),
         string_agg(DISTINCT v.ficha, ', ' ORDER BY v.ficha),
         string_agg(DISTINCT v.pv, ', ' ORDER BY v.pv),
         bool_or(v.zera_forro)
    FROM vendido v
    JOIN public.products p ON p.id = v.sole_id
   WHERE NOT EXISTS (
     SELECT 1 FROM public.sole_technical_specs s
      WHERE s.sole_id = v.sole_id AND s.size = v.numeracao)
   GROUP BY p.name, v.sole_id, v.numeracao
   ORDER BY p.name, v.numeracao;
$function$;

COMMENT ON FUNCTION public.list_sole_spec_gaps() IS
  'Numerações JÁ VENDIDAS que não têm linha em sole_technical_specs para o solado '
  'que dirige o consumo da ficha. forro_palmilha_zera = true significa que esses '
  'pares saíram (ou vão sair) com consumo de forro de palmilha ZERO.';

GRANT EXECUTE ON FUNCTION public.list_sole_spec_gaps() TO authenticated;

-- ── O report deixa de dar verde por existência e passa a olhar COBERTURA ────
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

  -- NOVO (07/08/2026): existência de spec não é cobertura. Este é o check que
  -- teria pego o forro-zero da linha infantil — o de cima dava verde.
  RETURN QUERY SELECT 'solado_sem_spec_na_faixa_vendida'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(g.solado || ' nº' || g.numeracao || ' (' || round(g.pares_vendidos)::text || ' pares)',
                        ' · ' ORDER BY g.solado, g.numeracao), '—')
    FROM public.list_sole_spec_gaps() g;

  -- NOVO: o subconjunto que não só cai no escalar, mas contribui ZERO ao
  -- consumo — material sai da fábrica sem reserva nem débito.
  RETURN QUERY SELECT 'forro_palmilha_debita_zero'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(g.solado || ' nº' || g.numeracao || ' → ' || g.fichas
                        || ' (' || round(g.pares_vendidos)::text || ' pares)',
                        ' · ' ORDER BY g.solado, g.numeracao), '—')
    FROM public.list_sole_spec_gaps() g WHERE g.forro_palmilha_zera;

  RETURN QUERY SELECT 'solado_fachetado_sem_specs_fachete'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(p.name, ' · ' ORDER BY p.name), '—')
    FROM public.products p WHERE p.is_fachetado = true AND lower(COALESCE(p.category,'')) LIKE '%solado%'
      AND NOT COALESCE(
        (SELECT NULLIF(bool_or(NULLIF(kv.value, '')::numeric > 0), false)
           FROM jsonb_each_text(public.get_sole_consumption_per_size(
             p.id, 'fachete_lining_consumption_per_size'
           )) kv),
        EXISTS (
          SELECT 1 FROM public.sole_technical_specs sts
          WHERE sts.sole_id = p.id AND COALESCE(sts.fachete_lining_consumption_dm2, 0) > 0
        )
      );

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

  RETURN QUERY
  SELECT 'forro_cabedal_duplicado_com_palmilha'::text, 'baixo'::text, count(*)::int,
    COALESCE(string_agg(ts.name, ' · ' ORDER BY ts.name), '—')
    FROM public.technical_sheets ts
   WHERE COALESCE(ts.sole_drives_consumption,false) = true
     AND COALESCE(ts.lining_consumption,0) > 0
     AND ts.primary_sole_id IS NOT NULL
     AND COALESCE(
       (SELECT NULLIF(bool_or(NULLIF(kv.value, '')::numeric > 0), false)
          FROM jsonb_each_text(public.get_sole_consumption_per_size(
            ts.primary_sole_id, 'insole_lining_consumption_per_size'
          )) kv),
       EXISTS (
         SELECT 1 FROM public.sole_technical_specs sts
         WHERE sts.sole_id = ts.primary_sole_id AND COALESCE(sts.insole_lining_consumption_dm2, 0) > 0
       )
     )
     AND NOT COALESCE(
       (SELECT NULLIF(bool_or(NULLIF(kv.value, '')::numeric > 0), false)
          FROM jsonb_each_text(public.get_sole_consumption_per_size(
            ts.primary_sole_id, 'lining_consumption_per_size'
          )) kv),
       EXISTS (
         SELECT 1 FROM public.sole_technical_specs sts
         WHERE sts.sole_id = ts.primary_sole_id AND COALESCE(sts.lining_consumption_dm2, 0) > 0
       )
     );

  RETURN QUERY
  SELECT 'produto_artesanal_flag_inconsistente'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(p.name, ' · ' ORDER BY p.name), '—')
    FROM public.products p
    JOIN public.product_groups g ON g.id = p.group_id
    JOIN public.artisanal_recipes ar ON ar.active = true
      AND lower(trim(extensions.unaccent(ar.artisanal_product_name))) = lower(trim(extensions.unaccent(g.name)))
   WHERE p.active = true AND COALESCE(p.is_artisanal, false) = false;

  RETURN QUERY
  SELECT 'material_base_artesanal_sem_cor'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(x.nome || ' (' || x.cor || ')', ' · ' ORDER BY x.nome), '—')
    FROM (
      SELECT DISTINCT p.name AS nome, p.color AS cor
        FROM public.products p
        JOIN public.product_groups g ON g.id = p.group_id
       WHERE p.active = true
         AND COALESCE(p.is_artisanal, false) = true
         AND COALESCE(p.color, '') <> ''
         AND EXISTS (
           SELECT 1 FROM public.artisanal_recipes ar0
            WHERE ar0.active = true
              AND lower(trim(extensions.unaccent(ar0.artisanal_product_name)))
                = lower(trim(extensions.unaccent(g.name))))
         AND NOT EXISTS (
           SELECT 1
             FROM public.artisanal_recipes ar
             JOIN public.products bp ON bp.active = true
             LEFT JOIN public.product_groups bg ON bg.id = bp.group_id
            WHERE ar.active = true
              AND lower(trim(extensions.unaccent(ar.artisanal_product_name)))
                = lower(trim(extensions.unaccent(g.name)))
              AND (lower(trim(extensions.unaccent(COALESCE(bg.name, ''))))
                     = lower(trim(extensions.unaccent(ar.base_product_name)))
                OR lower(trim(extensions.unaccent(bp.name)))
                     = lower(trim(extensions.unaccent(ar.base_product_name))))
              AND lower(trim(extensions.unaccent(COALESCE(bp.color, ''))))
                = lower(trim(extensions.unaccent(COALESCE(p.color, '')))))
    ) x;

  RETURN QUERY
  SELECT 'cor_sem_mapeamento_componentes_por_cor'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(DISTINCT ts.name || ' / ' || soi.color, ' · '), '—')
    FROM public.sale_order_items soi
    JOIN public.sale_orders so ON so.id = soi.sale_order_id
    JOIN public.technical_sheets ts ON ts.id = soi.reference_id
   WHERE COALESCE(ts.component_colors_enabled, false) = true
     AND COALESCE(soi.color, '') <> ''
     AND jsonb_typeof(ts.direct_components) = 'array'
     AND jsonb_array_length(ts.direct_components) > 0
     AND so.status NOT IN ('Faturado', 'Cancelado', 'Finalizado s/ NF', 'Rascunho')
     AND NOT EXISTS (
       SELECT 1 FROM public.technical_sheet_component_colors c
        WHERE c.sheet_id = ts.id
          AND lower(trim(extensions.unaccent(c.cabedal_color))) = lower(trim(extensions.unaccent(soi.color))));

  RETURN QUERY
  SELECT 'direct_components_produto_inexistente'::text, 'alto'::text, count(*)::int,
    COALESCE(string_agg(DISTINCT ts.name || ' / ' || COALESCE(dc->>'product_name','?'), ' · '), '—')
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(ts.direct_components) dc
   WHERE jsonb_typeof(ts.direct_components) = 'array'
     AND (dc->>'product_id') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.products p
        WHERE p.id = (dc->>'product_id')::uuid AND p.active = true);

  RETURN QUERY
  SELECT 'direct_components_nome_desatualizado'::text, 'medio'::text, count(*)::int,
    COALESCE(string_agg(DISTINCT ts.name || ': "' || (dc->>'product_name') || '" <> "' || p.name || '"', ' · '), '—')
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(ts.direct_components) dc
    JOIN public.products p ON p.id = (dc->>'product_id')::uuid
   WHERE jsonb_typeof(ts.direct_components) = 'array'
     AND NULLIF(trim(dc->>'product_name'), '') IS NOT NULL
     AND lower(trim(extensions.unaccent(dc->>'product_name'))) <> lower(trim(extensions.unaccent(p.name)));
END;
$function$;
