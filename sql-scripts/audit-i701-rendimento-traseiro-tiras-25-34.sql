-- Somente leitura.
-- Rendimento da sandália infantil I701 (ou ficha infantil 25–34), em duas
-- seções separadas: (1) TRASEIRO  (2) TIRAS DA FRENTE.
--
-- Grade de referência da auditoria I701 (imagem 05/09/2026):
--   480 pares · 25–34 · 80 pares em 29 e 30 · 40 nos demais.
--
-- Relatório (CTEs finais em UNION ALL com coluna `secao`):
--   ficha                 → identidade da ficha usada
--   traseiro_itens        → linhas classificadas como traseiro
--   traseiro_por_tamanho  → consumo/par e total na grade 25–34
--   traseiro_totais       → totais + rendimento (pares/m ou pares/dm²)
--   tiras_frente_itens    → linhas classificadas como tira da frente
--   tiras_frente_por_tamanho
--   tiras_frente_totais
--   alertas               → gaps (sem mapa por tamanho, sem largura, etc.)

WITH params AS (
  SELECT
    ARRAY['25','26','27','28','29','30','31','32','33','34']::text[] AS sizes,
    jsonb_build_object(
      '25',40,'26',40,'27',40,'28',40,'29',80,
      '30',80,'31',40,'32',40,'33',40,'34',40
    ) AS grade_ref,
    480::numeric AS pares_ref,
    '049cef09-f46f-4017-b9c7-e927b52b8632'::uuid AS i701_id
),
ficha AS (
  SELECT
    ts.id,
    ts.code,
    ts.name,
    ts.shoe_category,
    ts.sizes,
    ts.has_straps,
    ts.status_ficha,
    ts.upper_consumption,
    ts.upper_consumption_per_size,
    CASE WHEN jsonb_typeof(ts.components_accessories) = 'array'
         THEN ts.components_accessories ELSE '[]'::jsonb END AS accessories,
    CASE WHEN jsonb_typeof(ts.strap_colors) = 'array'
         THEN ts.strap_colors ELSE '[]'::jsonb END AS straps
  FROM public.technical_sheets ts
  CROSS JOIN params p
  WHERE ts.id = p.i701_id
     OR (
       ts.id <> p.i701_id
       AND coalesce(ts.shoe_category, '') ILIKE '%infantil%'
       AND coalesce(ts.status_ficha, ts.status, '') NOT IN ('inativa', 'retired', 'arquivada')
       AND coalesce(ts.name, ts.code, '') ILIKE '%I701%'
     )
  ORDER BY CASE WHEN ts.id = p.i701_id THEN 0 ELSE 1 END
  LIMIT 1
),
-- Classificação por rótulo (traseiro ≠ frente).
acc_rows AS (
  SELECT
    f.id AS sheet_id,
    ord.ordinality AS idx,
    coalesce(nullif(trim(elem->>'label'), ''), nullif(trim(elem->>'material'), ''), format('acessorio#%s', ord.ordinality)) AS label,
    coalesce(elem->>'material', elem->>'label') AS material,
    coalesce((elem->>'mandatory')::boolean, (elem->>'required')::boolean, false) AS mandatory,
    nullif(elem->>'material_unit', '') AS unit,
    nullif(elem->>'consumption', '')::numeric AS consumption_scalar,
    CASE WHEN jsonb_typeof(elem->'consumption_per_size') = 'object'
         THEN elem->'consumption_per_size' ELSE '{}'::jsonb END AS consumption_per_size
  FROM ficha f
  CROSS JOIN LATERAL jsonb_array_elements(f.accessories) WITH ORDINALITY AS ord(elem, ordinality)
),
strap_rows AS (
  SELECT
    f.id AS sheet_id,
    ord.ordinality AS idx,
    coalesce(
      nullif(trim(elem->>'label'), ''),
      nullif(trim(elem->>'group_name'), ''),
      format('tira#%s', ord.ordinality)
    ) AS label,
    nullif(elem->>'group_name', '') AS group_name,
    nullif(elem->>'color', '') AS color,
    nullif(elem->>'consumption', '')::numeric AS consumption_scalar_cm,
    CASE WHEN jsonb_typeof(elem->'consumption_per_size') = 'object'
         THEN elem->'consumption_per_size' ELSE '{}'::jsonb END AS consumption_per_size,
    nullif(elem->>'technical_strap_line_id', '') AS technical_strap_line_id,
    nullif(elem->>'group_id', '') AS group_id
  FROM ficha f
  CROSS JOIN LATERAL jsonb_array_elements(f.straps) WITH ORDINALITY AS ord(elem, ordinality)
),
classified AS (
  SELECT
    'accessory'::text AS source,
    a.idx,
    a.label,
    a.material,
    a.unit,
    a.consumption_scalar,
    a.consumption_per_size,
    CASE
      WHEN a.label ~* '(traseiro|tal[aã]o|counter|heel|calcanhar)' THEN 'traseiro'
      WHEN a.label ~* '(frente|front)' THEN 'tira_frente'
      WHEN a.material ~* '(traseiro|tal[aã]o|counter|heel|calcanhar)' THEN 'traseiro'
      WHEN a.material ~* '(frente|front)' THEN 'tira_frente'
      ELSE 'outro_acessorio'
    END AS bucket
  FROM acc_rows a
  UNION ALL
  SELECT
    'strap'::text,
    s.idx,
    s.label,
    coalesce(s.group_name, s.label),
    'cm'::text,
    s.consumption_scalar_cm,
    s.consumption_per_size,
    CASE
      WHEN s.label ~* '(traseiro|tal[aã]o|counter|heel|calcanhar)' THEN 'traseiro'
      WHEN s.label ~* '(frente|front)' THEN 'tira_frente'
      -- default: tiras da ficha infantil = frente, salvo rótulo explícito de traseiro
      ELSE 'tira_frente'
    END
  FROM strap_rows s
),
size_grid AS (
  SELECT unnest(sizes) AS size_key FROM params
),
grade_pairs AS (
  SELECT key AS size_key, value::numeric AS pairs
  FROM params p
  CROSS JOIN LATERAL jsonb_each_text(p.grade_ref) AS e(key, value)
),
pick AS (
  -- consumo por tamanho: mapa → conjugada → escalar
  SELECT
    c.source,
    c.idx,
    c.label,
    c.material,
    c.unit,
    c.bucket,
    g.size_key,
    COALESCE(
      NULLIF(c.consumption_per_size->>g.size_key, '')::numeric,
      (
        SELECT NULLIF(kv.value, '')::numeric
        FROM jsonb_each_text(c.consumption_per_size) kv
        WHERE kv.key LIKE '%' || g.size_key || '%'
        LIMIT 1
      ),
      c.consumption_scalar,
      0
    ) AS consumption_per_pair,
    CASE
      WHEN c.consumption_per_size ? g.size_key THEN 'mapa'
      WHEN EXISTS (
        SELECT 1 FROM jsonb_each_text(c.consumption_per_size) kv
        WHERE kv.key LIKE '%' || g.size_key || '%'
      ) THEN 'conjugada'
      WHEN c.consumption_scalar IS NOT NULL THEN 'escalar'
      ELSE 'zero'
    END AS fonte
  FROM classified c
  CROSS JOIN size_grid g
),
expanded AS (
  SELECT
    p.*,
    coalesce(gp.pairs, 0) AS pairs,
    coalesce(gp.pairs, 0) * p.consumption_per_pair AS total_for_size
  FROM pick p
  LEFT JOIN grade_pairs gp ON gp.size_key = p.size_key
),
-- ── seções do relatório ─────────────────────────────────────────────────────
sec_ficha AS (
  SELECT
    'ficha'::text AS secao,
    jsonb_build_object(
      'id', f.id,
      'code', f.code,
      'name', f.name,
      'shoe_category', f.shoe_category,
      'sizes', f.sizes,
      'has_straps', f.has_straps,
      'upper_consumption', f.upper_consumption,
      'accessories_count', jsonb_array_length(f.accessories),
      'straps_count', jsonb_array_length(f.straps),
      'grade_ref_pares', (SELECT pares_ref FROM params)
    ) AS payload
  FROM ficha f
),
sec_traseiro_itens AS (
  SELECT
    'traseiro_itens'::text,
    coalesce(jsonb_agg(jsonb_build_object(
      'source', source, 'idx', idx, 'label', label, 'material', material, 'unit', unit
    ) ORDER BY source, idx), '[]'::jsonb)
  FROM classified
  WHERE bucket = 'traseiro'
),
sec_traseiro_por_tamanho AS (
  SELECT
    'traseiro_por_tamanho'::text,
    coalesce(jsonb_agg(jsonb_build_object(
      'label', label,
      'size', size_key,
      'pairs', pairs,
      'consumption_per_pair', consumption_per_pair,
      'total', total_for_size,
      'unit', unit,
      'fonte', fonte
    ) ORDER BY label, size_key), '[]'::jsonb)
  FROM expanded
  WHERE bucket = 'traseiro'
),
sec_traseiro_totais AS (
  SELECT
    'traseiro_totais'::text,
    jsonb_build_object(
      'itens', count(DISTINCT label),
      'total_consumo_grade', coalesce(sum(total_for_size), 0),
      'pares_ref', (SELECT pares_ref FROM params),
      -- rendimento: pares por unidade de material (m ou dm² conforme unit dominante)
      'consumo_medio_por_par', CASE WHEN (SELECT pares_ref FROM params) > 0
        THEN coalesce(sum(total_for_size), 0) / (SELECT pares_ref FROM params) ELSE 0 END,
      'unidades', coalesce(jsonb_agg(DISTINCT unit) FILTER (WHERE unit IS NOT NULL), '[]'::jsonb)
    )
  FROM expanded
  WHERE bucket = 'traseiro'
),
sec_frente_itens AS (
  SELECT
    'tiras_frente_itens'::text,
    coalesce(jsonb_agg(jsonb_build_object(
      'source', source, 'idx', idx, 'label', label, 'material', material, 'unit', unit
    ) ORDER BY source, idx), '[]'::jsonb)
  FROM classified
  WHERE bucket = 'tira_frente'
),
sec_frente_por_tamanho AS (
  SELECT
    'tiras_frente_por_tamanho'::text,
    coalesce(jsonb_agg(jsonb_build_object(
      'label', label,
      'size', size_key,
      'pairs', pairs,
      'consumption_per_pair_cm', consumption_per_pair,
      'total_cm', total_for_size,
      'total_m', total_for_size / 100.0,
      'fonte', fonte
    ) ORDER BY label, size_key), '[]'::jsonb)
  FROM expanded
  WHERE bucket = 'tira_frente'
),
sec_frente_totais AS (
  SELECT
    'tiras_frente_totais'::text,
    jsonb_build_object(
      'itens', count(DISTINCT label),
      'total_cm_grade', coalesce(sum(total_for_size), 0),
      'total_m_grade', coalesce(sum(total_for_size), 0) / 100.0,
      'pares_ref', (SELECT pares_ref FROM params),
      'cm_medio_por_par', CASE WHEN (SELECT pares_ref FROM params) > 0
        THEN coalesce(sum(total_for_size), 0) / (SELECT pares_ref FROM params) ELSE 0 END,
      'm_medio_por_par', CASE WHEN (SELECT pares_ref FROM params) > 0
        THEN coalesce(sum(total_for_size), 0) / (SELECT pares_ref FROM params) / 100.0 ELSE 0 END
    )
  FROM expanded
  WHERE bucket = 'tira_frente'
),
sec_alertas AS (
  SELECT
    'alertas'::text,
    coalesce(jsonb_agg(msg), '[]'::jsonb)
  FROM (
    SELECT 'ficha_nao_encontrada' AS msg WHERE NOT EXISTS (SELECT 1 FROM ficha)
    UNION ALL
    SELECT 'sem_itens_traseiro' WHERE NOT EXISTS (SELECT 1 FROM classified WHERE bucket = 'traseiro')
    UNION ALL
    SELECT 'sem_itens_tira_frente' WHERE NOT EXISTS (SELECT 1 FROM classified WHERE bucket = 'tira_frente')
    UNION ALL
    SELECT DISTINCT 'traseiro_sem_mapa_tamanho:' || label
    FROM expanded
    WHERE bucket = 'traseiro' AND fonte IN ('escalar', 'zero')
    UNION ALL
    SELECT DISTINCT 'tira_frente_sem_mapa_tamanho:' || label
    FROM expanded
    WHERE bucket = 'tira_frente' AND fonte IN ('escalar', 'zero')
  ) a
)
SELECT secao, payload FROM sec_ficha
UNION ALL SELECT * FROM sec_traseiro_itens
UNION ALL SELECT * FROM sec_traseiro_por_tamanho
UNION ALL SELECT * FROM sec_traseiro_totais
UNION ALL SELECT * FROM sec_frente_itens
UNION ALL SELECT * FROM sec_frente_por_tamanho
UNION ALL SELECT * FROM sec_frente_totais
UNION ALL SELECT * FROM sec_alertas
ORDER BY
  CASE secao
    WHEN 'ficha' THEN 1
    WHEN 'traseiro_itens' THEN 2
    WHEN 'traseiro_por_tamanho' THEN 3
    WHEN 'traseiro_totais' THEN 4
    WHEN 'tiras_frente_itens' THEN 5
    WHEN 'tiras_frente_por_tamanho' THEN 6
    WHEN 'tiras_frente_totais' THEN 7
    ELSE 8
  END;
