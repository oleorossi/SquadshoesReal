-- Somente leitura. Prova funcional no PV-00125 (CF 09 PRETO):
-- matching conjugado 33/34 e 39/40 × RPC SQL vivo (ainda sem helper).
-- Não grava nada.

WITH helper AS (
  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'pick_consumption_for_size'
  ) AS present
),
pv AS (
  SELECT
    so.order_number,
    so.status,
    soi.color,
    soi.quantity,
    soi.grade,
    soi.fichas,
    soi.reference_id AS sheet_id,
    ts.name AS ficha,
    ts.code AS ficha_code,
    COALESCE(ts.upper_consumption, 0) AS upper_scalar,
    CASE WHEN jsonb_typeof(ts.upper_consumption_per_size) = 'object'
         THEN ts.upper_consumption_per_size ELSE '{}'::jsonb END AS upper_map
  FROM public.sale_orders so
  JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
  JOIN public.technical_sheets ts ON ts.id = soi.reference_id
  WHERE so.order_number = 'PV-00125'
    AND soi.color = 'PRETO'
    AND btrim(ts.name) ILIKE 'CF 09%'
  LIMIT 1
),
grade AS (
  SELECT p.*, k AS size_key, (v)::numeric AS pares
  FROM pv p
  CROSS JOIN LATERAL jsonb_each_text(p.grade) e(k, v)
  WHERE k ~ '^[0-9]+(/[0-9]+)?$'
    AND (v)::numeric > 0
),
look AS (
  SELECT
    g.*,
    NULLIF(COALESCE((g.upper_map ->> split_part(g.size_key, '/', 1))::numeric, 0), 0) AS old_v,
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
    ) AS new_v
  FROM grade g
),
rpc AS (
  SELECT public.calculate_order_consumption_by_grade(p.sheet_id, p.grade, p.color, NULL) AS rows
  FROM pv p
),
fichas_conj AS (
  SELECT
    ts.name,
    ts.code,
    COALESCE(ts.upper_consumption, 0) AS scalar,
    (
      SELECT bool_or(
        btrim(kv.value) <> ''
        AND (kv.value)::numeric IS DISTINCT FROM COALESCE(ts.upper_consumption, 0)
      )
      FROM jsonb_each_text(ts.upper_consumption_per_size) kv
      WHERE kv.key LIKE '%/%'
    ) AS conjugada_diferente_do_escalar,
    (
      SELECT bool_or(btrim(kv.value) = '0')
      FROM jsonb_each_text(ts.upper_consumption_per_size) kv
    ) AS tem_zero
  FROM public.technical_sheets ts
  WHERE jsonb_typeof(ts.upper_consumption_per_size) = 'object'
    AND EXISTS (
      SELECT 1 FROM jsonb_object_keys(ts.upper_consumption_per_size) k WHERE k LIKE '%/%'
    )
)
SELECT jsonb_build_object(
  'helper_no_banco', (SELECT present FROM helper),
  'pedido', (SELECT to_jsonb(p) - 'upper_map' FROM pv p),
  'mapa_cabedal', (SELECT upper_map FROM pv),
  'por_numeracao', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'numeracao', l.size_key,
      'pares', l.pares,
      'lookup_velho', l.old_v,
      'lookup_novo', l.new_v,
      'casou_conjugada', l.old_v IS NULL AND l.new_v IS NOT NULL,
      'aviso_sql_vivo_trataria_como_ausente', l.old_v IS NULL
    ) ORDER BY split_part(l.size_key, '/', 1)::int), '[]'::jsonb)
    FROM look l
  ),
  'totais_dm2', (
    SELECT jsonb_build_object(
      'velho_com_fallback_escalar', COALESCE(SUM(l.pares * COALESCE(l.old_v, l.upper_scalar)), 0),
      'novo_casando_conjugada', COALESCE(SUM(l.pares * COALESCE(l.new_v, l.upper_scalar)), 0)
    )
    FROM look l
  ),
  'rpc_sql_cabedal', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'component', e->>'component',
      'product_name', e->>'product_name',
      'required', e->>'required',
      'source', e->>'source',
      'consumption_warning', e->>'consumption_warning'
    )), '[]'::jsonb)
    FROM rpc r
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(r.rows) = 'array' THEN r.rows ELSE '[]'::jsonb END
    ) e
    WHERE e->>'component' = 'Cabedal'
  ),
  'fichas_conjugadas_nao_uniformes', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'ficha', f.name, 'code', f.code, 'scalar', f.scalar, 'tem_zero', f.tem_zero
    )), '[]'::jsonb)
    FROM fichas_conj f
    WHERE f.conjugada_diferente_do_escalar
  ),
  'fichas_conjugadas_com_zero', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'ficha', f.name, 'code', f.code
    )), '[]'::jsonb)
    FROM fichas_conj f
    WHERE f.tem_zero
  ),
  'qtd_fichas_conjugadas', (SELECT COUNT(*) FROM fichas_conj)
);
