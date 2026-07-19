-- ============================================================================
-- debit_consistency_report() — relatório VIVO esperado × debitado por OP×produto
-- (spec specs/auditoria-debito-ficha-grade.md, R8)
-- ============================================================================
-- Recalcula o consumo esperado de cada OP (ficha técnica × grade, motor
-- calculate_order_consumption[_by_grade]) e compara com o total debitado em
-- stock_movements (movement_type='out') da OP. Classificação com tolerância
-- relativa de 1% e piso absoluto de 0,01 na unidade do produto (estoque guarda
-- dízimas com round(,4) — nunca comparar exato).
--
-- Guardas herdadas da auditoria 2026-07-18/19:
--   • grade BASE (soma ~12 com quantity real) é ESCALADA via scale_grade_to_total
--     antes de chamar o motor — 21 OPs legadas de maio/2026 tinham grade base e o
--     recálculo cru subestimava o consumo ~30-50× (achado RES-1/DEB-3).
--     A validação de chaves/valores espelha o try_reserve_materials.
--   • tiras entram via order_strap_needs (mesmo anti-join do record_order_consumption).
--   • débito de solado ANTERIOR a jul/2026 gravava stock_movements SEM order_id
--     (não atribuível por OP) — linhas de solado com débito zero ganham obs.
-- Idempotente.
-- ============================================================================

-- Helper puro: grade efetiva da OP pro motor de consumo.
-- Retorna a grade ESCALADA pro total da OP quando a grade é um objeto válido
-- (chaves numéricas/conjugadas, algum valor > 0); senão NULL (⇒ caminho escalar).
-- Fonte única usada por record_order_consumption e debit_consistency_report —
-- garante que finalização e relatório enxergam a MESMA demanda.
CREATE OR REPLACE FUNCTION public.resolve_effective_op_grade(p_grade jsonb, p_quantity numeric)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_grade IS NOT NULL AND jsonb_typeof(p_grade) = 'object'
         AND EXISTS (
           SELECT 1 FROM jsonb_each_text(p_grade) g
            WHERE g.key ~ '^[0-9]+(/[0-9]+)?$'
              AND g.value ~ '^[0-9]+(\.[0-9]+)?$'
              AND (g.value)::numeric > 0
         )
    THEN public.scale_grade_to_total(p_grade, COALESCE(p_quantity, 0))
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.debit_consistency_report(
  p_start date DEFAULT (current_date - 60),
  p_end date DEFAULT current_date,
  p_include_open boolean DEFAULT false
)
RETURNS TABLE (
  order_number text,
  op_status text,
  product_id uuid,
  product_name text,
  unit text,
  component text,
  esperado numeric,
  debitado numeric,
  delta numeric,
  delta_pct numeric,
  classe text,
  obs text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuario nao aprovado';
  END IF;

  RETURN QUERY
  WITH ops AS (
    SELECT o.id, o.order_number, o.status, o.reference_id, o.quantity, o.color, o.grade,
           soi.material_variant_id, soi.strap_colors,
           public.resolve_effective_op_grade(o.grade, o.quantity::numeric) AS grade_efetiva,
           (SELECT COALESCE(sum(g.value::numeric), 0)
              FROM jsonb_each_text(o.grade) g
             WHERE g.value ~ '^[0-9]+(\.[0-9]+)?$') AS grade_total_bruta
      FROM public.orders o
      LEFT JOIN public.sale_order_items soi ON soi.id = o.sale_order_item_id
     WHERE o.deleted_at IS NULL
       AND o.reference_id IS NOT NULL
       AND (
             EXISTS (SELECT 1 FROM public.stock_movements sm
                      WHERE sm.order_id = o.id AND sm.movement_type = 'out'
                        AND sm.created_at::date BETWEEN p_start AND p_end)
          OR (o.status = 'Finalizado' AND o.updated_at::date BETWEEN p_start AND p_end)
          OR (p_include_open AND o.status IN ('Em Produção', 'Reservado')
              AND o.created_at::date BETWEEN p_start AND p_end)
       )
  ),
  std_raw AS (
    SELECT ops.id AS order_id,
           (e ->> 'product_id')::uuid AS product_id,
           COALESCE(NULLIF(e ->> 'component', ''), 'Material') AS component,
           (e ->> 'required')::numeric AS required,
           e ->> 'unit' AS req_unit
      FROM ops,
      LATERAL jsonb_array_elements(
        COALESCE(
          CASE WHEN ops.grade_efetiva IS NOT NULL
               THEN public.calculate_order_consumption_by_grade(
                      ops.reference_id, ops.grade_efetiva, COALESCE(ops.color, ''), ops.material_variant_id)
               ELSE public.calculate_order_consumption(
                      ops.reference_id, COALESCE(ops.quantity, 0)::numeric, COALESCE(ops.color, ''),
                      NULL::integer, ops.material_variant_id)
          END, '[]'::jsonb)
      ) e
     WHERE (e ->> 'product_id') IS NOT NULL
       AND COALESCE((e ->> 'required')::numeric, 0) > 0
  ),
  std_conv AS (
    SELECT s.order_id, s.product_id, s.component,
           COALESCE(
             public.convert_to_product_unit(s.required, s.req_unit, COALESCE(p.unit, '')),
             CASE WHEN conv.dm2_per_unit IS NOT NULL AND conv.dm2_per_unit > 0
                       AND public.convert_to_product_unit(s.required, s.req_unit, 'dm²') IS NOT NULL
                  THEN public.convert_to_product_unit(s.required, s.req_unit, 'dm²') / conv.dm2_per_unit
             END,
             s.required) AS required_prod_unit
      FROM std_raw s
      LEFT JOIN public.products p ON p.id = s.product_id
      LEFT JOIN LATERAL public.get_material_conversion_info(s.product_id) conv ON true
  ),
  std AS (
    SELECT sc.order_id, sc.product_id,
           string_agg(DISTINCT sc.component, ' + ') AS component,
           sum(sc.required_prod_unit) AS esperado
      FROM std_conv sc
     GROUP BY sc.order_id, sc.product_id
  ),
  straps AS (
    SELECT ops.id AS order_id, sn.product_id,
           'Tira'::text AS component, sum(sn.required_m) AS esperado
      FROM ops,
      LATERAL public.order_strap_needs(ops.strap_colors, COALESCE(ops.quantity, 0), ops.grade_efetiva) sn
     WHERE ops.strap_colors IS NOT NULL
       AND jsonb_typeof(ops.strap_colors) = 'array'
       AND jsonb_array_length(ops.strap_colors) > 0
       AND sn.product_id IS NOT NULL AND sn.required_m > 0
       AND NOT EXISTS (SELECT 1 FROM std WHERE std.order_id = ops.id AND std.product_id = sn.product_id)
     GROUP BY ops.id, sn.product_id
  ),
  std_all AS (
    SELECT * FROM std
    UNION ALL
    SELECT * FROM straps
  ),
  act AS (
    SELECT sm.order_id, sm.product_id, sum(sm.quantity) AS debitado
      FROM public.stock_movements sm
     WHERE sm.movement_type = 'out'
       AND sm.order_id IN (SELECT ops.id FROM ops)
     GROUP BY sm.order_id, sm.product_id
  ),
  merged AS (
    SELECT COALESCE(s.order_id, a.order_id) AS order_id,
           COALESCE(s.product_id, a.product_id) AS product_id,
           s.component,
           COALESCE(s.esperado, 0) AS esperado,
           COALESCE(a.debitado, 0) AS debitado
      FROM std_all s
      FULL OUTER JOIN act a ON a.order_id = s.order_id AND a.product_id = s.product_id
  )
  SELECT o.order_number,
         o.status AS op_status,
         m.product_id,
         COALESCE(pr.name, m.product_id::text) AS product_name,
         pr.unit,
         COALESCE(m.component, 'Movimento sem par no motor') AS component,
         round(m.esperado, 4) AS esperado,
         round(m.debitado, 4) AS debitado,
         round(m.debitado - m.esperado, 4) AS delta,
         CASE WHEN m.esperado > 0 THEN round((m.debitado - m.esperado) / m.esperado * 100, 1) END AS delta_pct,
         CASE
           WHEN m.esperado > 0.01 AND m.debitado <= 0.01 THEN 'furo'
           WHEN m.esperado <= 0.01 AND m.debitado > 0.01 THEN 'extra'
           WHEN m.esperado > 0
                AND abs(m.debitado - m.esperado) / m.esperado > 0.01
                AND abs(m.debitado - m.esperado) > 0.01 THEN 'divergente'
           ELSE 'ok'
         END AS classe,
         NULLIF(concat_ws('; ',
           CASE WHEN o.grade_total_bruta > 0 AND abs(o.grade_total_bruta - o.quantity) > GREATEST(1, o.quantity * 0.02)
                THEN 'grade base (' || o.grade_total_bruta || ') escalada para ' || o.quantity END,
           CASE WHEN pr.category = 'Solado' AND m.debitado <= 0.01 AND m.esperado > 0.01
                THEN 'débito de solado legado pode estar sem order_id (não atribuível)' END
         ), '') AS obs
    FROM merged m
    JOIN ops o ON o.id = m.order_id
    LEFT JOIN public.products pr ON pr.id = m.product_id
   WHERE m.esperado > 0.01 OR m.debitado > 0.01
   -- posições (1=order_number, 11=classe, 4=product_name): nomes bater com os
   -- OUT params do RETURNS TABLE causaria "column reference is ambiguous".
   ORDER BY 1, 11, 4;
END;
$$;

COMMENT ON FUNCTION public.debit_consistency_report(date, date, boolean) IS
  'Auditoria viva esperado×debitado por OP×produto (ficha × grade → stock_movements). Tolerância 1% + piso 0,01. Ver specs/auditoria-debito-ficha-grade.md e /diagnostics.';
