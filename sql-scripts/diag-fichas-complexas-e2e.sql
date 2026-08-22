-- Somente leitura: ranqueia fichas publicadas/validadas pela complexidade
-- operacional (setores, tiras, solado, palmilha, forro, consumo por tamanho).
-- Uso: supabase-db-exec.yml, strict=true.

SELECT jsonb_build_object(
  'top_fichas', (
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.score DESC), '[]'::jsonb)
    FROM (
      SELECT
        ts.code,
        ts.name,
        ts.status_ficha,
        ts.shoe_category,
        ts.id,
        COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(ts.production_sectors) = 'array' THEN ts.production_sectors ELSE '[]'::jsonb END), 0) AS n_sectors,
        CASE WHEN jsonb_typeof(ts.production_sectors) = 'array' THEN ts.production_sectors ELSE '[]'::jsonb END AS sectors,
        COALESCE(ts.has_straps, false) AS has_straps,
        CASE WHEN jsonb_typeof(ts.strap_colors) = 'array' THEN jsonb_array_length(ts.strap_colors) ELSE 0 END AS n_strap_lines,
        (ts.sole_group_id IS NOT NULL) AS has_sole_group,
        (ts.primary_sole_id IS NOT NULL) AS has_primary_sole,
        (COALESCE(ts.upper_material, '') <> '') AS has_upper,
        (COALESCE(ts.lining_material, '') <> '' OR COALESCE(ts.lining_consumption, 0) > 0) AS has_lining,
        (COALESCE(ts.insole_material, '') <> '' OR COALESCE(ts.insole_ready_made, false)) AS has_insole,
        COALESCE(ts.insole_ready_made, false) AS insole_ready_made,
        EXISTS (
          SELECT 1 FROM jsonb_each_text(COALESCE(ts.upper_consumption_per_size, '{}'::jsonb)) kv
          WHERE kv.value ~ '^[0-9]+(\.[0-9]+)?$' AND kv.value::numeric > 0
        ) AS upper_per_size,
        COALESCE(NULLIF(ts.ncm, '') ~ '^[0-9]{8}$', false) AS ncm_ok,
        (SELECT count(*) FROM public.reference_color_variants rcv WHERE rcv.reference_id = ts.id AND rcv.active) AS n_variants,
        (SELECT count(DISTINCT soi.color) FROM public.sale_order_items soi WHERE soi.reference_id = ts.id AND COALESCE(soi.color, '') <> '') AS n_pv_colors,
        (
          COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(ts.production_sectors) = 'array' THEN ts.production_sectors ELSE '[]'::jsonb END), 0)
          + CASE WHEN COALESCE(ts.has_straps, false) THEN 8 ELSE 0 END
          + CASE WHEN ts.sole_group_id IS NOT NULL THEN 4 ELSE 0 END
          + CASE WHEN ts.primary_sole_id IS NOT NULL THEN 2 ELSE 0 END
          + CASE WHEN COALESCE(ts.lining_material, '') <> '' THEN 3 ELSE 0 END
          + CASE WHEN COALESCE(ts.insole_material, '') <> '' OR COALESCE(ts.insole_ready_made, false) THEN 3 ELSE 0 END
          + CASE WHEN EXISTS (
              SELECT 1 FROM jsonb_each_text(COALESCE(ts.upper_consumption_per_size, '{}'::jsonb)) kv
              WHERE kv.value ~ '^[0-9]+(\.[0-9]+)?$' AND kv.value::numeric > 0
            ) THEN 3 ELSE 0 END
          + CASE WHEN COALESCE(NULLIF(ts.ncm, '') ~ '^[0-9]{8}$', false) THEN 1 ELSE 0 END
          + LEAST(CASE WHEN jsonb_typeof(ts.strap_colors) = 'array' THEN jsonb_array_length(ts.strap_colors) ELSE 0 END, 6)
          + LEAST((SELECT count(*) FROM public.reference_color_variants rcv WHERE rcv.reference_id = ts.id AND rcv.active), 8)
          + LEAST((SELECT count(DISTINCT soi.color) FROM public.sale_order_items soi WHERE soi.reference_id = ts.id AND COALESCE(soi.color, '') <> ''), 6)
        ) AS score
      FROM public.technical_sheets ts
      WHERE COALESCE(ts.status_ficha, '') IN ('publicada', 'validada')
      ORDER BY score DESC, n_sectors DESC, n_variants DESC
      LIMIT 8
    ) x
  ),
  'setores_canonico', jsonb_build_array(
    'Corte Fibra','Corte Forração','Corte Cabedal','Costura Palmilha','Costura Cabedal',
    'Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ),
  'fichas_com_12_setores', (
    SELECT count(*) FROM public.technical_sheets ts
    WHERE COALESCE(ts.status_ficha, '') IN ('publicada', 'validada')
      AND jsonb_typeof(ts.production_sectors) = 'array'
      AND jsonb_array_length(ts.production_sectors) >= 12
  ),
  'publicadas', (SELECT count(*) FROM public.technical_sheets WHERE status_ficha = 'publicada'),
  'validadas', (SELECT count(*) FROM public.technical_sheets WHERE status_ficha = 'validada')
);
