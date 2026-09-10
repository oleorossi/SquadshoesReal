-- Somente leitura. Inventário: componentes diretos que somem na UI da ficha
-- (produto apagado OU inativo) mas ainda podem entrar no consumo SQL.
-- Inclui NL03 / Elástico 6MM e TODAS as outras referências.

WITH broken AS (
  SELECT
    ts.id AS sheet_id,
    ts.code,
    ts.name AS sheet_name,
    ts.version,
    ord.ordinality AS idx,
    dc ->> 'product_id' AS product_id,
    dc ->> 'product_name' AS product_name_snap,
    NULLIF(dc ->> 'quantity', '')::numeric AS qty_per_pair,
    dc ->> 'unit' AS unit_snap,
    p.name AS product_name_live,
    p.active AS product_active,
    pg.name AS group_name,
    CASE
      WHEN p.id IS NULL THEN 'deleted'
      WHEN p.active IS NOT TRUE THEN 'inactive'
      ELSE 'ok'
    END AS reason
  FROM public.technical_sheets ts
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(COALESCE(ts.direct_components, '[]'::jsonb)) = 'array'
         THEN COALESCE(ts.direct_components, '[]'::jsonb)
         ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS ord(dc, ordinality)
  LEFT JOIN public.products p ON p.id = NULLIF(dc ->> 'product_id', '')::uuid
  LEFT JOIN public.product_groups pg ON pg.id = p.group_id
  WHERE NULLIF(dc ->> 'product_id', '') IS NOT NULL
)
SELECT jsonb_build_object(
  'totais', (
    SELECT jsonb_build_object(
      'linhas_quebradas', count(*),
      'fichas_afetadas', count(DISTINCT sheet_id),
      'deleted', count(*) FILTER (WHERE reason = 'deleted'),
      'inactive', count(*) FILTER (WHERE reason = 'inactive')
    )
    FROM broken WHERE reason <> 'ok'
  ),
  'por_ficha', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'code', b.code,
      'name', b.sheet_name,
      'version', b.version,
      'reason', b.reason,
      'product_id', b.product_id,
      'product_name_snap', b.product_name_snap,
      'product_name_live', b.product_name_live,
      'group_name', b.group_name,
      'qty_per_pair', b.qty_per_pair,
      'unit', b.unit_snap,
      'idx', b.idx
    ) ORDER BY b.code, b.idx), '[]'::jsonb)
    FROM broken b
    WHERE b.reason <> 'ok'
  ),
  'nl03', (
    SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.idx), '[]'::jsonb)
    FROM broken b
    WHERE b.code = 'NL03'
  ),
  'elastico', (
    SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.code, b.idx), '[]'::jsonb)
    FROM broken b
    WHERE COALESCE(b.product_name_snap, '') ILIKE '%elástic%'
       OR COALESCE(b.product_name_live, '') ILIKE '%elástic%'
       OR COALESCE(b.group_name, '') ILIKE '%elástic%'
       OR COALESCE(b.product_name_snap, '') ILIKE '%forrad%'
       OR COALESCE(b.product_name_live, '') ILIKE '%forrad%'
  )
) AS audit_direct_components_blank_ui;
