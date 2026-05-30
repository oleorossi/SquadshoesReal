-- Apuração mensal de impostos (ESTIMATIVA) — paridade Tutor32, fiscal #3.
--
-- Os valores reais de imposto vêm do XML (calculado pelo provider GestaoClick) e
-- não são persistidos por nota hoje. Esta apuração é uma ESTIMATIVA grounded nos
-- perfis tributários por NCM (fiscal #2): para cada NF-e autorizada no período,
-- resolve os itens do PV → ficha técnica → NCM → perfil → alíquotas, e estima os
-- débitos de ICMS/IPI/PIS/COFINS. Itens sem perfil entram como "base sem perfil"
-- (não apurável) pra deixar explícito o que falta configurar.

CREATE OR REPLACE FUNCTION public.estimate_tax_apuration(
  p_period_start date,
  p_period_end date,
  p_company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_fat numeric;
  v_canc numeric;
  v_notes int;
  v_apuracao jsonb;
BEGIN
  -- Faturamento bruto (autorizada) e cancelado no período.
  SELECT
    COALESCE(SUM(valor_total) FILTER (WHERE status = 'autorizada'), 0),
    COALESCE(SUM(valor_total) FILTER (WHERE status = 'cancelada'), 0),
    COUNT(*) FILTER (WHERE status = 'autorizada')
  INTO v_fat, v_canc, v_notes
  FROM public.nfe_emitidas
  WHERE COALESCE(data_emissao::date, created_at::date) BETWEEN p_period_start AND p_period_end
    AND (p_company_id IS NULL OR company_id = p_company_id);

  -- Base e impostos estimados via itens × NCM × perfil tributário ativo.
  WITH items AS (
    SELECT
      ts.ncm,
      (soi.unit_price * soi.quantity) AS item_value,
      fp.aliquota_icms, fp.aliquota_ipi, fp.aliquota_pis, fp.aliquota_cofins,
      (fp.id IS NOT NULL) AS has_profile
    FROM public.nfe_emitidas n
    JOIN public.sale_order_items soi ON soi.sale_order_id = n.sale_order_id
    LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
    LEFT JOIN public.fiscal_tax_profiles fp ON fp.ncm = ts.ncm AND fp.active
    WHERE n.status = 'autorizada'
      AND COALESCE(n.data_emissao::date, n.created_at::date) BETWEEN p_period_start AND p_period_end
      AND (p_company_id IS NULL OR n.company_id = p_company_id)
  )
  SELECT jsonb_build_object(
    'base_apuravel',   COALESCE(SUM(item_value) FILTER (WHERE has_profile), 0),
    'base_sem_perfil', COALESCE(SUM(item_value) FILTER (WHERE NOT has_profile), 0),
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
    'apuracao', COALESCE(v_apuracao, jsonb_build_object(
      'base_apuravel', 0, 'base_sem_perfil', 0, 'icms', 0, 'ipi', 0, 'pis', 0, 'cofins', 0, 'by_ncm', '[]'::jsonb))
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.estimate_tax_apuration(date, date, uuid) TO authenticated;
