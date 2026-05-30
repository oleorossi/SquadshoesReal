-- MDF-e a partir do romaneio — paridade Tutor32, fiscal #4.
--
-- CT-e e MDF-e já têm CRUD de rascunho + autorização manual + encerramento. O gap
-- real era o trabalho manual de colar as chaves de NF-e. Esta RPC monta um rascunho
-- de MDF-e a partir de um romaneio (shipping_manifest): puxa veículo/motorista/UF e
-- AGREGA automaticamente as chaves das NF-e autorizadas dos PVs do romaneio.
-- A transmissão real à SEFAZ continua externa (depende do provider) — igual ao
-- modelo atual de "registrar protocolo após emissão externa".

CREATE OR REPLACE FUNCTION public.mdfe_draft_from_manifest(p_manifest_id uuid)
RETURNS uuid
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

  -- UF de origem = UF da empresa primária (emitente); fallback p/ destino.
  SELECT NULLIF(uf, '') INTO v_origin_uf FROM public.companies WHERE is_primary LIMIT 1;

  -- UF de destino = a mais frequente entre os volumes do romaneio.
  SELECT destination_uf INTO v_dest_uf
  FROM public.shipping_volumes
  WHERE manifest_id = p_manifest_id AND COALESCE(destination_uf, '') <> ''
  GROUP BY destination_uf
  ORDER BY count(*) DESC
  LIMIT 1;

  v_origin_uf := COALESCE(v_origin_uf, v_dest_uf, 'XX');
  v_dest_uf := COALESCE(v_dest_uf, v_origin_uf);

  -- Chaves das NF-e autorizadas dos PVs presentes no romaneio.
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

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mdfe_draft_from_manifest(uuid) TO authenticated;
