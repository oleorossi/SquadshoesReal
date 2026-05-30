-- Correções da auditoria fiscal — paridade Tutor32.
--
-- (1) NCM normalizado nos dois lados do join (cobertura + apuração): hoje os NCMs
--     estão limpos (8 dígitos), mas o join por igualdade crua quebraria em silêncio
--     se um technical_sheets.ncm fosse salvo como "6402.20.00".
-- (2) Apuração: NF avulsa (item sem reference_id) passa a resolver NCM via products.ncm.
-- (3) mdfe_draft_from_manifest: lança exceção em vez de gravar UF inválida 'XX', e
--     retorna a contagem de chaves para a UI avisar quando vier vazio.

-- (1) Cobertura com NCM normalizado
CREATE OR REPLACE VIEW public.v_ncm_coverage AS
SELECT
  t.ncm,
  count(*) AS sheets_using,
  EXISTS (
    SELECT 1 FROM public.fiscal_tax_profiles fp
    WHERE regexp_replace(fp.ncm, '\D', '', 'g') = regexp_replace(t.ncm, '\D', '', 'g')
      AND fp.active
  ) AS has_profile
FROM public.technical_sheets t
WHERE t.ncm IS NOT NULL AND t.ncm <> ''
GROUP BY t.ncm;

-- (2) Apuração com NCM normalizado + fallback para products.ncm (NF avulsa)
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
  SELECT
    COALESCE(SUM(valor_total) FILTER (WHERE status = 'autorizada'), 0),
    COALESCE(SUM(valor_total) FILTER (WHERE status = 'cancelada'), 0),
    COUNT(*) FILTER (WHERE status = 'autorizada')
  INTO v_fat, v_canc, v_notes
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

-- (3) MDF-e: exceção em UF não resolvível + retorno com contagem de chaves
DROP FUNCTION IF EXISTS public.mdfe_draft_from_manifest(uuid);
CREATE FUNCTION public.mdfe_draft_from_manifest(p_manifest_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_m public.shipping_manifests%ROWTYPE;
  v_origin_uf text;
  v_dest_uf text;
  v_chaves text[];
  v_id uuid;
BEGIN
  SELECT * INTO v_m FROM public.shipping_manifests WHERE id = p_manifest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Romaneio % não encontrado', p_manifest_id;
  END IF;

  SELECT NULLIF(uf, '') INTO v_origin_uf FROM public.companies WHERE is_primary LIMIT 1;

  SELECT destination_uf INTO v_dest_uf
  FROM public.shipping_volumes
  WHERE manifest_id = p_manifest_id AND COALESCE(destination_uf, '') <> ''
  GROUP BY destination_uf
  ORDER BY count(*) DESC
  LIMIT 1;

  v_origin_uf := COALESCE(v_origin_uf, v_dest_uf);
  IF v_origin_uf IS NULL THEN
    RAISE EXCEPTION 'UF de origem não resolvível — configure a UF da empresa primária ou o destino dos volumes do romaneio';
  END IF;
  v_dest_uf := COALESCE(v_dest_uf, v_origin_uf);

  SELECT COALESCE(array_agg(DISTINCT n.chave_acesso), '{}')
  INTO v_chaves
  FROM public.nfe_emitidas n
  WHERE n.status = 'autorizada'
    AND COALESCE(n.chave_acesso, '') <> ''
    AND n.sale_order_id IN (
      SELECT sale_order_id FROM public.shipping_volumes
      WHERE manifest_id = p_manifest_id AND sale_order_id IS NOT NULL
    );

  INSERT INTO public.mdfe_emissions (
    mdfe_number, emission_date, origin_uf, destination_uf, modal,
    vehicle_plate, driver_name, total_pairs, total_value, total_weight_kg,
    related_nfe_chaves, status, notes
  ) VALUES (
    'MDF-' || COALESCE(NULLIF(v_m.manifest_number, ''), left(p_manifest_id::text, 8)),
    COALESCE(v_m.emission_date, current_date),
    v_origin_uf, v_dest_uf, 'rodoviario',
    COALESCE(v_m.vehicle_plate, ''), COALESCE(v_m.driver_name, ''),
    COALESCE(v_m.total_pairs, 0), COALESCE(v_m.total_value, 0), COALESCE(v_m.total_weight_kg, 0),
    v_chaves, 'rascunho',
    'Gerado a partir do romaneio ' || COALESCE(v_m.manifest_number, p_manifest_id::text)
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('mdfe_id', v_id, 'chaves_count', COALESCE(array_length(v_chaves, 1), 0));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mdfe_draft_from_manifest(uuid) TO authenticated;
