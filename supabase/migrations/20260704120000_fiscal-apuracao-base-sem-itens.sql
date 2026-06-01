-- =============================================================================
-- AUDITORIA FISCAL C3: apuração ignorava NFs autorizadas sem sale_order_id
-- =============================================================================
-- estimate_tax_apuration faz JOIN em sale_order_items por sale_order_id. NFs
-- sincronizadas do GestaoClick não têm sale_order_id → não geram item → ~60%
-- do faturamento autorizado sumia da base, sem aviso (só entrava em
-- faturamento_bruto). Agora soma o valor dessas NFs num bucket `base_sem_itens`
-- (não entra na base por NCM, mas fica visível) + conta `notes_sem_itens`.
-- Aplicada via Supabase MCP em 2026-06-01. Idempotente (CREATE OR REPLACE).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.estimate_tax_apuration(p_period_start date, p_period_end date, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fat numeric;
  v_canc numeric;
  v_notes int;
  v_base_sem_itens numeric;
  v_notes_sem_itens int;
  v_apuracao jsonb;
BEGIN
  SELECT
    COALESCE(SUM(valor_total) FILTER (WHERE status = 'autorizada'), 0),
    COALESCE(SUM(valor_total) FILTER (WHERE status = 'cancelada'), 0),
    COUNT(*) FILTER (WHERE status = 'autorizada'),
    COALESCE(SUM(valor_total) FILTER (WHERE status = 'autorizada' AND sale_order_id IS NULL), 0),
    COUNT(*) FILTER (WHERE status = 'autorizada' AND sale_order_id IS NULL)
  INTO v_fat, v_canc, v_notes, v_base_sem_itens, v_notes_sem_itens
  FROM public.nfe_emitidas
  WHERE COALESCE(data_emissao::date, created_at::date) BETWEEN p_period_start AND p_period_end
    AND (p_company_id IS NULL OR company_id = p_company_id);

  WITH items AS (
    SELECT
      COALESCE(NULLIF(ts.ncm, ''), p.ncm) AS ncm,
      (soi.unit_price * soi.quantity) AS item_value,
      fp.aliquota_icms, fp.aliquota_ipi, fp.aliquota_pis, fp.aliquota_cofins,
      (fp.id IS NOT NULL) AS has_profile
    FROM public.nfe_emitidas n
    JOIN public.sale_order_items soi ON soi.sale_order_id = n.sale_order_id
    LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
    LEFT JOIN public.products p ON p.id = soi.product_id
    LEFT JOIN public.fiscal_tax_profiles fp
      ON regexp_replace(fp.ncm, '\D', '', 'g') = regexp_replace(COALESCE(NULLIF(ts.ncm, ''), p.ncm, ''), '\D', '', 'g')
     AND fp.active
    WHERE n.status = 'autorizada'
      AND COALESCE(n.data_emissao::date, n.created_at::date) BETWEEN p_period_start AND p_period_end
      AND (p_company_id IS NULL OR n.company_id = p_company_id)
  )
  SELECT jsonb_build_object(
    'base_apuravel',   COALESCE(SUM(item_value) FILTER (WHERE has_profile), 0),
    'base_sem_perfil', COALESCE(SUM(item_value) FILTER (WHERE NOT has_profile), 0),
    'base_sem_itens',  v_base_sem_itens,
    'notes_sem_itens', v_notes_sem_itens,
    'icms',   COALESCE(SUM(item_value * aliquota_icms   / 100) FILTER (WHERE has_profile), 0),
    'ipi',    COALESCE(SUM(item_value * aliquota_ipi    / 100) FILTER (WHERE has_profile), 0),
    'pis',    COALESCE(SUM(item_value * aliquota_pis    / 100) FILTER (WHERE has_profile), 0),
    'cofins', COALESCE(SUM(item_value * aliquota_cofins / 100) FILTER (WHERE has_profile), 0),
    'by_ncm', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'ncm', COALESCE(NULLIF(ncm, ''), '(sem NCM)'),
               'has_profile', has_profile,
               'base', base, 'icms', icms, 'ipi', ipi, 'pis', pis, 'cofins', cofins
             ) ORDER BY base DESC), '[]'::jsonb)
      FROM (
        SELECT ncm, has_profile,
          SUM(item_value) AS base,
          SUM(item_value * COALESCE(aliquota_icms, 0)   / 100) AS icms,
          SUM(item_value * COALESCE(aliquota_ipi, 0)    / 100) AS ipi,
          SUM(item_value * COALESCE(aliquota_pis, 0)    / 100) AS pis,
          SUM(item_value * COALESCE(aliquota_cofins, 0) / 100) AS cofins
        FROM items GROUP BY ncm, has_profile
      ) g
    )
  ) INTO v_apuracao FROM items;

  RETURN jsonb_build_object(
    'period_start', p_period_start,
    'period_end', p_period_end,
    'notes_count', v_notes,
    'faturamento_bruto', v_fat,
    'faturamento_cancelado', v_canc,
    'base_sem_itens', v_base_sem_itens,
    'notes_sem_itens', v_notes_sem_itens,
    'apuracao', COALESCE(v_apuracao, jsonb_build_object(
      'base_apuravel', 0, 'base_sem_perfil', 0, 'base_sem_itens', v_base_sem_itens,
      'notes_sem_itens', v_notes_sem_itens, 'icms', 0, 'ipi', 0, 'pis', 0, 'cofins', 0, 'by_ncm', '[]'::jsonb))
  );
END;
$function$;
