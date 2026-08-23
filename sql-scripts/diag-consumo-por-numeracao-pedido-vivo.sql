-- Somente leitura. Prova o matching de consumo por numeração em um PV vivo:
-- conjugada 33/34 e zero explícito. Não grava nada.
--
-- Relatório:
--   helper_no_banco          → se pick_consumption_for_size já está no DB
--   candidatos               → PVs cujo cadastro dispara o redesenho
--   pedido_prova             → o melhor PV (conjugada primeiro, senão zero)
--   conferencias             → por numeração: lookup velho × lookup novo
--   totais                   → soma velha × soma nova (delta)

WITH helper AS (
  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'pick_consumption_for_size'
  ) AS present
),
sheets AS (
  SELECT
    ts.id, ts.name, ts.code,
    COALESCE(ts.upper_consumption, 0) AS upper_scalar,
    COALESCE(ts.lining_consumption, 0) AS lining_scalar,
    COALESCE(ts.insole_consumption, 0) AS insole_scalar,
    COALESCE(ts.insole_lining_consumption, 0) AS insole_lining_scalar,
    CASE WHEN jsonb_typeof(ts.upper_consumption_per_size) = 'object' THEN ts.upper_consumption_per_size ELSE '{}'::jsonb END AS upper_map,
    CASE WHEN jsonb_typeof(ts.lining_consumption_per_size) = 'object' THEN ts.lining_consumption_per_size ELSE '{}'::jsonb END AS lining_map,
    CASE WHEN jsonb_typeof(ts.insole_consumption_per_size) = 'object' THEN ts.insole_consumption_per_size ELSE '{}'::jsonb END AS insole_map,
    CASE WHEN jsonb_typeof(ts.insole_lining_consumption_per_size) = 'object' THEN ts.insole_lining_consumption_per_size ELSE '{}'::jsonb END AS insole_lining_map
  FROM public.technical_sheets ts
),
items AS (
  SELECT
    so.id AS order_id,
    so.order_number,
    so.status,
    so.created_at,
    soi.id AS item_id,
    soi.color,
    soi.quantity,
    soi.fichas,
    soi.grade,
    s.name AS ficha,
    s.code AS ficha_code,
    s.id AS sheet_id,
    s.upper_scalar, s.lining_scalar, s.insole_scalar, s.insole_lining_scalar,
    s.upper_map, s.lining_map, s.insole_map, s.insole_lining_map,
    EXISTS (
      SELECT 1 FROM jsonb_object_keys(soi.grade) k WHERE k LIKE '%/%'
    ) AS grade_conjugada,
    EXISTS (
      SELECT 1 FROM jsonb_object_keys(s.upper_map || s.lining_map || s.insole_map || s.insole_lining_map) k
       WHERE k LIKE '%/%'
    ) AS ficha_conjugada,
    EXISTS (
      SELECT 1
        FROM jsonb_each_text(s.upper_map || s.lining_map || s.insole_map || s.insole_lining_map) kv
       WHERE btrim(kv.value) = '0'
    ) AS tem_zero_explicito,
    EXISTS (
      SELECT 1 FROM jsonb_object_keys(soi.grade) gk
       WHERE gk ~ '^[0-9]+$'
         AND EXISTS (
           SELECT 1 FROM jsonb_object_keys(s.upper_map || s.lining_map || s.insole_map || s.insole_lining_map) fk
            WHERE fk LIKE '%/%' AND gk = ANY (string_to_array(fk, '/'))
         )
    ) AS grade_numerica_ficha_conjugada
  FROM public.sale_orders so
  JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
  JOIN sheets s ON s.id = soi.reference_id
  WHERE so.status IS DISTINCT FROM 'Cancelado'
    AND jsonb_typeof(soi.grade) = 'object'
    AND soi.quantity > 0
),
ranked AS (
  SELECT *
    FROM items
   WHERE grade_conjugada
      OR ficha_conjugada
      OR tem_zero_explicito
      OR grade_numerica_ficha_conjugada
   ORDER BY
     (grade_numerica_ficha_conjugada)::int DESC,
     (grade_conjugada)::int DESC,
     (ficha_conjugada)::int DESC,
     (tem_zero_explicito)::int DESC,
     created_at DESC
),
prova AS (
  SELECT * FROM ranked LIMIT 1
),
grade_rows AS (
  SELECT
    p.order_number, p.ficha, p.color, p.quantity, p.fichas,
    k AS size_key,
    (v)::numeric AS pares,
    p.upper_map, p.lining_map, p.insole_map, p.insole_lining_map,
    p.upper_scalar, p.lining_scalar, p.insole_scalar, p.insole_lining_scalar
  FROM prova p
  CROSS JOIN LATERAL jsonb_each_text(p.grade) e(k, v)
  WHERE k ~ '^[0-9]+(/[0-9]+)?$'
    AND (v)::numeric > 0
),
picked AS (
  SELECT
    g.*,
    split_part(g.size_key, '/', 1) AS size_num,
    -- lookup VELHO (espelha by_grade vivo): chave numérica + NULLIF 0
    NULLIF(COALESCE((g.upper_map ->> split_part(g.size_key, '/', 1))::numeric, 0), 0) AS old_upper,
    NULLIF(COALESCE((g.lining_map ->> split_part(g.size_key, '/', 1))::numeric, 0), 0) AS old_lining,
    NULLIF(COALESCE((g.insole_map ->> split_part(g.size_key, '/', 1))::numeric, 0), 0) AS old_insole,
    NULLIF(COALESCE((g.insole_lining_map ->> split_part(g.size_key, '/', 1))::numeric, 0), 0) AS old_insole_lining,
    -- lookup NOVO (mesma regra do pickConsumptionForSize / pick_consumption_for_size)
    COALESCE(
      CASE WHEN g.upper_map ? g.size_key AND btrim(g.upper_map ->> g.size_key) <> ''
           THEN (g.upper_map ->> g.size_key)::numeric END,
      CASE WHEN g.upper_map ? split_part(g.size_key, '/', 1)
            AND btrim(g.upper_map ->> split_part(g.size_key, '/', 1)) <> ''
           THEN (g.upper_map ->> split_part(g.size_key, '/', 1))::numeric END,
      (
        SELECT (g.upper_map ->> fk)::numeric
          FROM jsonb_object_keys(g.upper_map) fk
         WHERE fk LIKE '%/%'
           AND split_part(g.size_key, '/', 1) = ANY (string_to_array(fk, '/'))
           AND btrim(g.upper_map ->> fk) <> ''
         ORDER BY CASE WHEN split_part(fk, '/', 1) = split_part(g.size_key, '/', 1) THEN 0 ELSE 1 END, fk
         LIMIT 1
      )
    ) AS new_upper,
    COALESCE(
      CASE WHEN g.lining_map ? g.size_key AND btrim(g.lining_map ->> g.size_key) <> ''
           THEN (g.lining_map ->> g.size_key)::numeric END,
      CASE WHEN g.lining_map ? split_part(g.size_key, '/', 1)
            AND btrim(g.lining_map ->> split_part(g.size_key, '/', 1)) <> ''
           THEN (g.lining_map ->> split_part(g.size_key, '/', 1))::numeric END,
      (
        SELECT (g.lining_map ->> fk)::numeric
          FROM jsonb_object_keys(g.lining_map) fk
         WHERE fk LIKE '%/%'
           AND split_part(g.size_key, '/', 1) = ANY (string_to_array(fk, '/'))
           AND btrim(g.lining_map ->> fk) <> ''
         ORDER BY CASE WHEN split_part(fk, '/', 1) = split_part(g.size_key, '/', 1) THEN 0 ELSE 1 END, fk
         LIMIT 1
      )
    ) AS new_lining,
    COALESCE(
      CASE WHEN g.insole_map ? g.size_key AND btrim(g.insole_map ->> g.size_key) <> ''
           THEN (g.insole_map ->> g.size_key)::numeric END,
      CASE WHEN g.insole_map ? split_part(g.size_key, '/', 1)
            AND btrim(g.insole_map ->> split_part(g.size_key, '/', 1)) <> ''
           THEN (g.insole_map ->> split_part(g.size_key, '/', 1))::numeric END,
      (
        SELECT (g.insole_map ->> fk)::numeric
          FROM jsonb_object_keys(g.insole_map) fk
         WHERE fk LIKE '%/%'
           AND split_part(g.size_key, '/', 1) = ANY (string_to_array(fk, '/'))
           AND btrim(g.insole_map ->> fk) <> ''
         ORDER BY CASE WHEN split_part(fk, '/', 1) = split_part(g.size_key, '/', 1) THEN 0 ELSE 1 END, fk
         LIMIT 1
      )
    ) AS new_insole,
    COALESCE(
      CASE WHEN g.insole_lining_map ? g.size_key AND btrim(g.insole_lining_map ->> g.size_key) <> ''
           THEN (g.insole_lining_map ->> g.size_key)::numeric END,
      CASE WHEN g.insole_lining_map ? split_part(g.size_key, '/', 1)
            AND btrim(g.insole_lining_map ->> split_part(g.size_key, '/', 1)) <> ''
           THEN (g.insole_lining_map ->> split_part(g.size_key, '/', 1))::numeric END,
      (
        SELECT (g.insole_lining_map ->> fk)::numeric
          FROM jsonb_object_keys(g.insole_lining_map) fk
         WHERE fk LIKE '%/%'
           AND split_part(g.size_key, '/', 1) = ANY (string_to_array(fk, '/'))
           AND btrim(g.insole_lining_map ->> fk) <> ''
         ORDER BY CASE WHEN split_part(fk, '/', 1) = split_part(g.size_key, '/', 1) THEN 0 ELSE 1 END, fk
         LIMIT 1
      )
    ) AS new_insole_lining
  FROM grade_rows g
)
SELECT jsonb_build_object(
  'helper_no_banco', (SELECT present FROM helper),
  'candidatos', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'pedido', r.order_number,
      'ficha', r.ficha,
      'cor', r.color,
      'pares', r.quantity,
      'grade_conjugada', r.grade_conjugada,
      'ficha_conjugada', r.ficha_conjugada,
      'grade_numerica_ficha_conjugada', r.grade_numerica_ficha_conjugada,
      'zero_explicito', r.tem_zero_explicito
    ) ORDER BY r.created_at DESC), '[]'::jsonb)
    FROM (SELECT * FROM ranked LIMIT 8) r
  ),
  'pedido_prova', (
    SELECT jsonb_build_object(
      'pedido', p.order_number,
      'status', p.status,
      'ficha', p.ficha,
      'ficha_code', p.ficha_code,
      'cor', p.color,
      'pares', p.quantity,
      'fichas', p.fichas,
      'grade', p.grade,
      'upper_map', p.upper_map,
      'lining_map', p.lining_map,
      'insole_map', p.insole_map,
      'insole_lining_map', p.insole_lining_map,
      'upper_scalar', p.upper_scalar,
      'lining_scalar', p.lining_scalar,
      'insole_scalar', p.insole_scalar,
      'insole_lining_scalar', p.insole_lining_scalar,
      'porque', CASE
        WHEN p.grade_numerica_ficha_conjugada THEN 'grade numérica × ficha conjugada'
        WHEN p.grade_conjugada THEN 'grade conjugada'
        WHEN p.ficha_conjugada THEN 'ficha conjugada'
        WHEN p.tem_zero_explicito THEN 'zero explícito no per-size'
        ELSE '—'
      END
    )
    FROM prova p
  ),
  'conferencias', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'numeracao', x.size_key,
      'pares', x.pares,
      'cabedal', jsonb_build_object(
        'velho', x.old_upper,
        'novo', x.new_upper,
        'escalar_se_ausente', x.upper_scalar,
        'mudou', x.old_upper IS DISTINCT FROM x.new_upper
          OR (x.old_upper IS NULL) <> (x.new_upper IS NULL)
      ),
      'forro', jsonb_build_object(
        'velho', x.old_lining,
        'novo', x.new_lining,
        'escalar_se_ausente', x.lining_scalar,
        'mudou', x.old_lining IS DISTINCT FROM x.new_lining
          OR (x.old_lining IS NULL) <> (x.new_lining IS NULL)
      ),
      'palmilha', jsonb_build_object(
        'velho', x.old_insole,
        'novo', x.new_insole,
        'escalar_se_ausente', x.insole_scalar,
        'mudou', x.old_insole IS DISTINCT FROM x.new_insole
          OR (x.old_insole IS NULL) <> (x.new_insole IS NULL)
      ),
      'forro_palmilha', jsonb_build_object(
        'velho', x.old_insole_lining,
        'novo', x.new_insole_lining,
        'escalar_se_ausente', x.insole_lining_scalar,
        'mudou', x.old_insole_lining IS DISTINCT FROM x.new_insole_lining
          OR (x.old_insole_lining IS NULL) <> (x.new_insole_lining IS NULL)
      )
    ) ORDER BY split_part(x.size_key, '/', 1)::int, x.size_key), '[]'::jsonb)
    FROM picked x
  ),
  'totais_cabedal_dm2', (
    SELECT jsonb_build_object(
      'velho', COALESCE(SUM(x.pares * COALESCE(x.old_upper, x.upper_scalar)), 0),
      'novo', COALESCE(SUM(x.pares * COALESCE(x.new_upper, x.upper_scalar)), 0)
    )
    FROM picked x
  ),
  'totais_forro_dm2', (
    SELECT jsonb_build_object(
      'velho', COALESCE(SUM(x.pares * COALESCE(x.old_lining, x.lining_scalar)), 0),
      'novo', COALESCE(SUM(x.pares * COALESCE(x.new_lining, x.lining_scalar)), 0)
    )
    FROM picked x
  )
);
